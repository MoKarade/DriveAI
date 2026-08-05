/**
 * Fusion.gs — Chantier #47 (ADR-0036) : FUSION des dossiers d'entité en double/synonymes.
 *
 * PR1 = DRY-RUN SEUL, ZÉRO mutation Drive. `genererPlanFusion` (un-clic) liste les sous-dossiers de
 * chaque domaine, les CLUSTERISE (union-find sur des liens déterministes : clé canonique, recouvrement
 * de jetons, inclusion, acronyme commun) et écrit un PLAN dans l'onglet `PlanFusion` que Marc relit et
 * CURE (colonne Action : `Fusionner` / `Ignorer`). Le clustering est un RADAR avec des faux positifs
 * assumés (ex. « IUT De Lyon » ≠ « IUT Du Littoral », groupés par le jeton « IUT ») ⇒ Marc tranche.
 *
 * L'EXÉCUTION (déplacement des fichiers vers la cible, `moveTo` seul, 04 interne, §2) est PR2, gardée,
 * livrée atomiquement avec sa revue flotte. Ce fichier ne contient AUCUNE mutation (verrou de surface).
 */

/* ---------- Fonctions PURES : clustering + choix de cible ---------- */

/** Acronymes (jetons EN MAJUSCULES ≥2 car.) d'un nom, en minuscules. PURE. @param {string} nom @return {string[]} */
function acronymesFusion_(nom) {
  return (String(nom == null ? '' : nom).match(/\b[A-Z]{2,}\b/g) || []).map(function (s) { return s.toLowerCase(); });
}

/**
 * Vrai si `a` et `b` portent des ANNÉES (19xx/20xx) DISTINCTES — deux millésimes = deux entités RÉELLES
 * différentes (« Honda Civic 2014 » ≠ « Honda Civic 2017 » : deux véhicules). C'est la règle du moteur
 * (`estFusionnableEntite_`, `Entites.gs` : « une année excédentaire bloque la fusion ») : sans cette
 * garde, ni le recouvrement de jetons (jaccard 2/4 = 0,5) ni la clé canonique (`canoniserVehicule_`
 * RETIRE l'année) ne les distingueraient. VETO en TÊTE de `dossiersLies_` (avant tout autre lien). PURE.
 * @param {string} a @param {string} b @return {boolean}
 */
function anneesDistinctes_(a, b) {
  var an = function (nom) {
    return tokensEntite_(nom).filter(function (t) { return /^(19|20)\d{2}$/.test(t); });
  };
  var aa = an(a), ab = an(b);
  if (!aa.length && !ab.length) return false; // aucune année : rien à distinguer
  var seulDansA = aa.some(function (y) { return ab.indexOf(y) === -1; });
  var seulDansB = ab.some(function (y) { return aa.indexOf(y) === -1; });
  return seulDansA || seulDansB; // même(s) année(s) des deux côtés ⇒ non distinctif ⇒ false
}

/**
 * Deux dossiers désignent-ils PROBABLEMENT la même entité ? Lien si : clé canonique identique
 * (`cleCanoniqueEntite_`), OU recouvrement de jetons fort (`jaccardTokens_ ≥ 0,4`), OU inclusion d'un
 * ensemble de jetons dans l'autre, OU acronyme commun. RADAR (faux positifs assumés). PURE.
 * @param {string} domaine @param {string} a @param {string} b @return {boolean}
 */
function dossiersLies_(domaine, a, b) {
  // Millésimes distincts d'ABORD : deux véhicules réels (« Honda Civic 2014 » ≠ « … 2017 », TAXONOMY
  // §véhicules). Placé AVANT la clé canonique car `canoniserVehicule_` RETIRE l'année (unification
  // DOCUMENT→entité) → sans ce veto, la clé canonique les fondrait à tort pour la FUSION de DOSSIERS.
  if (anneesDistinctes_(a, b)) return false;
  var ka = null, kb = null;
  try { ka = cleCanoniqueEntite_(domaine, a); kb = cleCanoniqueEntite_(domaine, b); } catch (e) { }
  if (ka && ka === kb) return true; // clé canonique identique : signal fort, on fait confiance
  var ta = tokensEntite_(a), tb = tokensEntite_(b);
  if (ta.length && tb.length) {
    if (jaccardTokens_(ta, tb) >= 0.4) return true;
    var inclAB = ta.every(function (t) { return tb.indexOf(t) !== -1; });
    var inclBA = tb.every(function (t) { return ta.indexOf(t) !== -1; });
    if (inclAB || inclBA) return true;
  }
  var aa = acronymesFusion_(a), ab = acronymesFusion_(b);
  return aa.some(function (x) { return ab.indexOf(x) !== -1; });
}

/**
 * Regroupe les sous-dossiers d'un domaine en CLUSTERS (composantes connexes du graphe des liens).
 * Ne renvoie que les clusters de taille ≥ 2 (les doublons/synonymes). PURE.
 * @param {string} domaine
 * @param {{nom:string, id:string, nfiles:number}[]} dossiers
 * @return {Array<Array<{nom:string, id:string, nfiles:number}>>}
 */
function clusteriserDossiers_(domaine, dossiers) {
  var n = (dossiers || []).length;
  var par = [];
  for (var k = 0; k < n; k++) par.push(k);
  var find = function (x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (var a = 0; a < n; a++) {
    for (var b = a + 1; b < n; b++) {
      if (dossiersLies_(domaine, dossiers[a].nom, dossiers[b].nom)) par[find(a)] = find(b);
    }
  }
  var grp = {};
  for (var i = 0; i < n; i++) { var r = find(i); (grp[r] = grp[r] || []).push(dossiers[i]); }
  var out = [];
  Object.keys(grp).forEach(function (key) { if (grp[key].length > 1) out.push(grp[key]); });
  return out;
}

/**
 * Choisit la CIBLE d'un cluster (le dossier à GARDER, où les autres seront fondus). Ordre de priorité :
 * (0) une ANCRE STRUCTURELLE (bucket de `STRUCTURE_CIBLE_RESET`, segment `estSegmentStructurel_`, type
 * d'identité) est GARDÉE d'office — le reset la recrée PAR NOM, la vider serait non convergent (revue
 * structure-keeper #47) ; (1) le plus de fichiers (ne pas déplacer le gros) ; (2) le nom le plus
 * DESCRIPTIF (le plus long) ; (3) alpha (déterministe). `estAncre` optionnel (le flux vivant le fournit ;
 * les tests purs peuvent l'omettre → ordre historique). PURE.
 * @param {Array<{nom,id,nfiles}>} cluster @param {function(string):boolean} [estAncre]
 * @return {{nom,id,nfiles}}
 */
function cibleFusion_(cluster, estAncre) {
  return cluster.slice().sort(function (x, y) {
    var ax = estAncre && estAncre(x.nom) ? 1 : 0, ay = estAncre && estAncre(y.nom) ? 1 : 0;
    if (ax !== ay) return ay - ax; // une ancre structurelle prime : on la garde comme cible, jamais vidée
    if (y.nfiles !== x.nfiles) return y.nfiles - x.nfiles;
    if (y.nom.length !== x.nom.length) return y.nom.length - x.nom.length;
    return x.nom < y.nom ? -1 : (x.nom > y.nom ? 1 : 0);
  })[0];
}

/**
 * Lignes du plan pour un cluster : une par dossier (la CIBLE en tête). L'Action est éditée PAR LIGNE
 * SOURCE (Marc met `Fusionner`/`Ignorer` par source vers la CIBLE — pas « par groupe » : un cluster peut
 * mélanger un vrai synonyme et un faux positif, cf. IUT). Défaut `À VALIDER`. EXCEPTION : une source qui
 * est elle-même une ANCRE STRUCTURELLE (cas rare d'un cluster multi-ancres) ne doit JAMAIS être vidée
 * (le reset la recrée) → défaut `Ignorer (structurel)` (opt-OUT : Marc doit consciemment l'override).
 * PURE. @param {string} domaine @param {string} groupeId @param {Array<{nom,id,nfiles}>} cluster
 * @param {{nom,id,nfiles}} cible @param {function(string):boolean} [estAncre]
 * @return {Array[]} (colonnes cf. COLONNES_PLAN_FUSION)
 */
function lignesPlanFusion_(domaine, groupeId, cluster, cible, estAncre) {
  var quand = new Date();
  var ordonne = cluster.slice().sort(function (x, y) {
    return (x.id === cible.id ? 0 : 1) - (y.id === cible.id ? 0 : 1);
  });
  return ordonne.map(function (d) {
    var estCible = d.id === cible.id;
    var ancreSource = !estCible && estAncre && estAncre(d.nom); // bucket structurel proposé à la VIDANGE
    return [quand, domaine, groupeId, estCible ? 'CIBLE' : 'source',
      d.nom, d.nfiles, d.id, ancreSource ? 'Ignorer (structurel)' : 'À VALIDER', ''];
  });
}

/* ---------- Dry-run I/O (lecture + écriture du RAPPORT seul, ZÉRO mutation Drive) ---------- */

/** Domaines à examiner : 7 fixes + AUTO déjà nés (ID lu en Property, jamais créé). @return {{nom,id}[]} */
function domainesFusion_() {
  var liste = [];
  Object.keys(CONFIG.DOMAINES).forEach(function (d) { liste.push({ nom: d, id: CONFIG.DOMAINES[d] }); });
  (CONFIG.DOMAINES_AUTO || []).forEach(function (d) {
    var id = PropertiesService.getScriptProperties().getProperty('DriveAI_DOM_' + d);
    if (id) liste.push({ nom: d, id: id });
  });
  return liste;
}

/**
 * Liste les sous-dossiers DIRECTS d'un domaine avec leur nb de fichiers directs (borné). Lecture seule.
 * Un dossier illisible est sauté. Le garde-temps est évalué PAR SOUS-DOSSIER (revue apps-script-quota :
 * un domaine à fort volume — jusqu'à 500 dossiers × 200 fichiers — franchirait le mur 6 min sans point
 * de contrôle interne) : dès qu'il bascule, on rend le partiel collecté (l'appelant marque INCOMPLET).
 * @param {string} domaineId @param {function():boolean} [garde] @return {{nom,id,nfiles}[]}
 */
function collecterSousDossiersFusion_(domaineId, garde) {
  var out = [], it;
  try { it = DriveApp.getFolderById(domaineId).getFolders(); } catch (e) { return out; }
  var g = 0;
  while (it.hasNext() && g < CONFIG.FUSION_MAX_SOUSDOSSIERS) {
    if (garde && garde()) break; // garde-temps par sous-dossier (mur 6 min)
    g++;
    try {
      var f = it.next(), nf = 0;
      try { var fi = f.getFiles(), c = 0; while (fi.hasNext() && c < CONFIG.FUSION_MAX_FICHIERS_COMPTE) { c++; fi.next(); nf++; } } catch (e2) { }
      out.push({ nom: f.getName(), id: f.getId(), nfiles: nf });
    } catch (e3) { /* dossier illisible : sauté */ }
  }
  return out;
}

/**
 * UN-CLIC (Marc, éditeur) : régénère le plan de fusion dans l'onglet `PlanFusion`. LECTURE SEULE côté
 * Drive (liste dossiers + compte fichiers) + écriture du RAPPORT. Idempotent. Garde-temps évalué PAR
 * SOUS-DOSSIER (dans la collecte) et après chaque domaine. Une relance REPART DE ZÉRO (pas de curseur :
 * inutile au volume actuel — 353 sous-dossiers tiennent en un run ; revue apps-script-quota). La purge
 * de l'ancien plan est RAPPROCHÉE de l'écriture : un kill dur pendant le scan préserve l'ancien plan
 * (et donc les éditions Action de Marc en cours de curation). @return {string} résumé
 */
function genererPlanFusion() {
  var domaines = domainesFusion_();
  var debut = Date.now();
  var garde = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
  var lignes = [], nGroupes = 0, nTrop = 0, complet = true;
  for (var i = 0; i < domaines.length; i++) {
    if (garde()) { complet = false; break; }
    var domaineNom = domaines[i].nom;
    // Une ANCRE STRUCTURELLE (bucket du reset pour CE domaine, ou segment `estSegmentStructurel_` :
    // année/schéma/type d'identité) est find-or-créée PAR NOM par le reset : la vider serait non
    // convergent. `cibleFusion_` la garde comme cible, `lignesPlanFusion_` écarte toute ancre-source.
    var estAncre = (function (dom) {
      return function (nom) {
        if (estSegmentStructurel_(nom)) return true;
        var t = (typeof STRUCTURE_CIBLE_RESET !== 'undefined') ? STRUCTURE_CIBLE_RESET[dom] : null;
        return !!(t && Object.prototype.hasOwnProperty.call(t, nom));
      };
    })(domaineNom);
    var dossiers = collecterSousDossiersFusion_(domaines[i].id, garde);
    var clusters = clusteriserDossiers_(domaineNom, dossiers);
    for (var g = 0; g < clusters.length; g++) {
      nGroupes++;
      nTrop += clusters[g].length - 1;
      var cible = cibleFusion_(clusters[g], estAncre);
      lignes = lignes.concat(lignesPlanFusion_(domaineNom, domaineNom + '#' + (g + 1), clusters[g], cible, estAncre));
    }
    if (garde()) { complet = false; break; } // le garde a pu basculer PENDANT la collecte de ce domaine
  }
  // Purge + écriture RAPPROCHÉES (crash-safe) : tout est calculé AVANT de toucher l'onglet.
  var feuille = feuille_('PlanFusion');
  var dern = feuille.getLastRow();
  if (dern > 1) feuille.getRange(2, 1, dern - 1, COLONNES_PLAN_FUSION.length).clearContent();
  if (lignes.length) feuille.getRange(2, 1, lignes.length, COLONNES_PLAN_FUSION.length).setValues(lignes);
  var msg = 'Plan de fusion : ' + nGroupes + ' groupe(s), ' + nTrop + ' dossier(s) en trop' +
    (complet ? '' : ' (INCOMPLET — garde-temps ; relance : elle repart de zéro, le volume actuel tient en un run)') +
    '. Édite la colonne Action (Fusionner/Ignorer) dans l\'onglet PlanFusion.';
  journalInfo_('Fusion', msg);
  return msg;
}
