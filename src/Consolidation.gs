/**
 * Consolidation.gs — CAMPAGNE DE CONSOLIDATION de l'arborescence (C28-26, ADR-0023).
 *
 * GÉNÈRE un PLAN dans l'onglet Sheet `PlanConsolidation` (Fichier | ID | Action | Cible | Raison |
 * Empreinte) : pour chaque fichier des domaines, où il DEVRAIT être sous la taxonomie à plat
 * (domaine [+ /AAAA si domaine par année] [+ /Entité si entité VALIDÉE] ; pièce d'identité → dossier
 * de TYPE), s'il est un DOUBLON (même empreinte MD5 qu'un fichier déjà recensé PAR CETTE CAMPAGNE),
 * ou s'il est INTOUCHABLE (zone protégée §1).
 *
 * DRY-RUN PUR : ce module ne DÉPLACE rien, ne renomme rien, ne supprime rien — il ne fait que des
 * LECTURES Drive et des écritures de RAPPORT (Sheet + Index). L'exécution des déplacements est un
 * chantier ULTÉRIEUR, après validation du plan par Marc (§8.6 : toute opération de masse ⇒ dry-run).
 * Gaté par `CONFIG.CONSOLIDATION_ACTIF` (false par défaut) : inerte tant que Marc n'allume pas.
 *
 * Garde-fous :
 *  - §1 zone protégée : `aParentProtege_(f, proteges, true)` (remontée multi-parents, échec-FERMÉ)
 *    → Action « Ignoré », même si le fichier est mal rangé OU en doublon (constat inscrit, jamais
 *    de proposition de déplacement) ;
 *  - §2 aucune suppression : les seules actions proposées sont OK / Déplacer / Doublon (déplacement
 *    seul vers `_Doublons`) / Ignoré ;
 *  - doublons : la mémoire d'empreintes est PROPRE À LA CAMPAGNE (colonne Empreinte de l'onglet,
 *    rechargée 1×/run + carte empreinte→fileId du run) — JAMAIS l'Index (`estDoublon_`), sinon tout
 *    fichier déjà traité par le pipeline serait « doublon de lui-même » (leçon C28, bypass
 *    `ignorerDoublon`). Elle vit dans la SHEET, pas en Script Properties (~2 900 empreintes ≈ 93 Ko
 *    ≫ la limite ~9 Ko d'une Property — leçon « une Property qui persiste une liste se borne ») ;
 *  - convergence : clé d'idempotence DÉDIÉE `conso|<tag>|<fileId>` (patron Migration/DryRunV2),
 *    posée en DERNIER ; un domaine dont une passe ENTIÈRE ne collecte plus rien est marqué épuisé
 *    (`conso|<tag>|dom|<nom>`) et sauté en O(1) — anti re-walk du mur de déjà-faits ; campagne
 *    « terminée » quand TOUS les domaines sont épuisés ; l'empreinte ne va JAMAIS dans l'Index
 *    (elle alimenterait le fast-path doublon de l'intake — auto-doublon) ;
 *  - bornes : garde-temps partagé + sous-budget `CONSOLIDATION_BUDGET_MS` par run + budget
 *    QUOTIDIEN `CONSOLIDATION_BUDGET_JOUR_MS` en ms réelles persistées (un plafond par run ne
 *    borne pas la journée — ×288 ticks) + garde de COLLECTE à mi-budget (réserve du temps au
 *    traitement : progrès garanti à chaque run) + plafond `CONSOLIDATION_MAX_PAR_RUN` ; le hash
 *    suit la même borne de taille que l'OCR ;
 *  - la CIBLE délègue à la règle UNIQUE `sousCheminDomaine_` (Router.gs) partagée avec le flux
 *    vivant (arbitrage Marc 2026-07-16 « entité OU année ») — divergence = « Déplacer » en boucle.
 */

/* ---------- Fonctions PURES (testées par test/consolidation.test.js) ---------- */

/**
 * Décompose un nom de fichier CLASSÉ (`AAAA[-MM[-JJ]]_Type_Tiers.ext`) en ses segments.
 * Un nom hors convention rend des champs null (le fichier sera ciblé « à plat » au domaine). PUR.
 * @param {string} nom
 * @return {{annee:?string, type:?string, tiers:?string}}
 */
function analyserNomClasse_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  var ext = /\.[^.\/]+$/.exec(s); // extension retirée D'ABORD (sinon un nom sans tiers l'avale dans le type)
  var base = ext ? s.slice(0, s.length - ext[0].length) : s;
  var m = /^(\d{4})(?:-\d{2})?(?:-\d{2})?_([^_]+)(?:_(.+))?$/.exec(base);
  if (!m) return { annee: null, type: null, tiers: null };
  return { annee: m[1], type: m[2] || null, tiers: m[3] || null };
}

/**
 * SOUS-CHEMIN CIBLE d'un fichier sous son domaine — délègue à la RÈGLE UNIQUE `sousCheminDomaine_`
 * (Router.gs), la même que le flux vivant (arbitrage Marc 2026-07-16 « entité OU année » ;
 * tripwire test : divergence = « Déplacer » en boucle sur ce que le flux vient de classer) :
 *  1. type d'IDENTITÉ → dossier de TYPE — UNIQUEMENT dans le domaine du type (un passeport égaré
 *     dans 02 est ciblé à plat : le re-DOMAINE est hors périmètre de la consolidation, zéro LLM) ;
 *  2. ENTITÉ VALIDÉE (le tiers du nom se canonise vers une entité validée de CE domaine) → dossier
 *     d'entité, sans année ;
 *  3. domaine par ANNÉE → « AAAA » ;  4. sinon '' = à plat.
 * PUR (les entités validées arrivent en paramètre : {cleCanonique → nom canonique}).
 * @param {string} domaine
 * @param {string} nom  nom ACTUEL du fichier
 * @param {Object} validees  carte cleCanoniqueEntite_ → libellé canonique (entités VALIDÉES seules)
 * @return {string} sous-chemin relatif ('' = racine du domaine)
 */
function cheminCibleConsolidation_(domaine, nom, validees) {
  var seg = analyserNomClasse_(nom);
  var typeId = null;
  if (seg.type) {
    var t = normaliserTypeIdentite_(seg.type);
    if (TYPES_IDENTITE.indexOf(t) !== -1 && dossierIdentite_({ sousDossierType: seg.type }).domaine === domaine) {
      typeId = t;
    }
  }
  var entite = null;
  if (seg.tiers) {
    var cle = cleCanoniqueEntite_(domaine, seg.tiers);
    if (cle && validees && validees[cle]) entite = validees[cle];
  }
  return sousCheminDomaine_({ domaine: domaine, typeIdentite: typeId, entite: entite, annee: seg.annee });
}

/**
 * DÉCISION du plan pour un fichier (PURE — tout l'état arrive en paramètres) :
 *  - protégé (§1)  → « Ignoré » (constat de doublon éventuel dans la Raison, jamais de déplacement) ;
 *  - raccourci     → « Ignoré » (un raccourci d'entité est un artefact voulu du pipeline, pas un doc) ;
 *  - doublon       → « Doublon », cible `_Doublons` (déplacement seul, jamais de suppression §2) ;
 *  - déjà en place → « OK » ;
 *  - sinon         → « Déplacer » vers `domaine[/sousCheminCible]`.
 * @param {{domaine:string, sousCheminActuel:string, sousCheminCible:string, protege:boolean,
 *          protegeIllisible:boolean, raccourci:boolean, doublonDe:?string}} d
 *   protege = zone protégée CONSTATÉE (détection positive) ; protegeIllisible = contrôle §1
 *   illisible (abstention prudente, raison HONNÊTE — le plan que Marc valide ne doit pas mentir).
 * @return {{action:string, cible:string, raison:string}}
 */
function decisionConsolidation_(d) {
  if (d.protege) {
    return {
      action: 'Ignoré', cible: '',
      raison: 'Zone protégée (04) intouchable' + (d.doublonDe ? ' — doublon constaté de ' + d.doublonDe : ''),
    };
  }
  if (d.protegeIllisible) {
    return {
      action: 'Ignoré', cible: '',
      raison: 'Contrôle zone protégée ILLISIBLE — abstention (§1), à re-vérifier avant toute exécution',
    };
  }
  if (d.raccourci) return { action: 'Ignoré', cible: '', raison: 'Raccourci Drive (artefact d\'entité, jamais déplacé)' };
  if (d.doublonDe) return { action: 'Doublon', cible: '_Doublons', raison: 'Même empreinte que ' + d.doublonDe + ' (déplacement seul, §2)' };
  var cible = d.domaine + (d.sousCheminCible ? '/' + d.sousCheminCible : '');
  if (String(d.sousCheminActuel || '') === String(d.sousCheminCible || '')) {
    return { action: 'OK', cible: cible, raison: 'Déjà au bon endroit (taxonomie à plat, ADR-0023)' };
  }
  return { action: 'Déplacer', cible: cible, raison: 'Taxonomie à plat (ADR-0023) : ' + (d.sousCheminCible ? 'entité/année validée' : 'racine du domaine') };
}

/* ---------- I/O (lecture Drive + rapport Sheet, ZÉRO mutation Drive) ---------- */

/**
 * Mémoire d'empreintes de LA CAMPAGNE : carte empreinte → fileId du PREMIER porteur, rechargée
 * depuis l'onglet `PlanConsolidation` (colonnes ID/Empreinte) une fois par run. Propre au plan —
 * jamais l'Index (auto-doublon). Un onglet illisible rend une carte vide (dédup intra-run seule).
 * @return {Object} {empreinte: fileId}
 */
function empreintesPlanConsolidation_() {
  var vues = {};
  try {
    var f = feuille_('PlanConsolidation');
    var dern = f.getLastRow();
    if (dern < 2) return vues;
    var lignes = f.getRange(2, 1, dern - 1, COLONNES_PLAN_CONSOLIDATION.length).getValues();
    for (var i = 0; i < lignes.length; i++) {
      var emp = String(lignes[i][6] || ''); // colonne Empreinte
      var id = String(lignes[i][2] || '');  // colonne ID
      if (emp && id && !vues[emp]) vues[emp] = id; // 1er porteur seulement
    }
  } catch (e) {
    journalErreur_('Consolidation', 'Plan existant illisible (dédup intra-run seule ce run) : ' + e);
  }
  return vues;
}

/** Consommation du budget QUOTIDIEN de la campagne (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourConsolidation_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_CONSO_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * Collecte récursive des fichiers d'un domaine PAS ENCORE au plan (clé `conso|<tag>|<id>` absente
 * de l'Index — prédicat de convergence, filtré À LA COLLECTE : un mur de déjà-faits n'occupe
 * aucune place de page). Lecture seule, bornée par `max` et le garde. `etat.complet` passe à false
 * dès que le walk s'arrête AVANT la fin de l'arbre (garde ou page pleine) — il permet de marquer
 * un domaine « épuisé » SEULEMENT sur une passe entière (revue apps-script-quota : sans ce
 * marquage, le re-walk du mur de déjà-faits brûlait tout le budget en fin de campagne). `vusRun`
 * dédoublonne par fileId dans le run (multi-parents/pagination — leçon « raisonner par fileId »).
 * @param {Folder} dossier
 * @param {string} domaine
 * @param {Array<{id:string, domaine:string}>} items  muté en place
 * @param {number} max
 * @param {function():boolean} garde
 * @param {string} tag
 * @param {{complet:boolean}} etat  muté en place
 * @param {Object} vusRun  {fileId: true} — partagé sur tout le run
 */
function collecterConsolidation_(dossier, domaine, items, max, garde, tag, etat, vusRun) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (garde() || items.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      var id = f.getId();
      if (vusRun[id]) continue;
      vusRun[id] = true;
      if (!indexContient_('conso|' + tag + '|' + id)) items.push({ id: id, domaine: domaine });
    } catch (e) { etat.complet = false; /* fichier illisible : re-vu à la passe suivante */ }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (garde() || items.length >= max) { etat.complet = false; return; }
    try { collecterConsolidation_(fo.next(), domaine, items, max, garde, tag, etat, vusRun); }
    catch (e) { etat.complet = false; /* sous-dossier illisible : jamais un plantage */ }
  }
}

/**
 * Traite UN fichier du plan : chemin actuel, empreinte (même borne de taille que l'OCR), garde §1
 * en mode STRICT (échec-fermé), décision PURE, ligne de rapport, puis clé de convergence en DERNIER
 * (ordre des écritures d'état : une coupure rejoue au lieu de perdre). ZÉRO mutation Drive.
 * @param {string} fileId
 * @param {string} domaine
 * @param {string} tag
 * @param {{proteges:Object, validees:Object, empreintesVues:Object}} ctx
 * @return {boolean} vrai si une ligne a été écrite
 */
function traiterUnConsolidation_(fileId, domaine, tag, ctx) {
  var cle = 'conso|' + tag + '|' + fileId;
  var f, nom, mime;
  try {
    f = DriveApp.getFileById(fileId);
    nom = f.getName();
    mime = f.getMimeType();
  } catch (e) {
    // Fichier disparu/illisible entre la collecte et le traitement : ligne quand même (jamais un
    // no-op silencieux — le plan que Marc lit doit porter la trace), convergence posée.
    ctx.feuille.appendRow([new Date(), fileId, fileId, 'Ignoré', '', 'Fichier illisible : ' + e, '']);
    indexAjouter_(cle, { statut: 'consolidation-plan', nom: fileId, domaine: domaine, chemin: '' }, '');
    return true;
  }

  var raccourci = mime === 'application/vnd.google-apps.shortcut';
  // Garde §1 en DEUX temps pour une raison HONNÊTE : détection POSITIVE (vraie zone protégée) vs
  // contrôle ILLISIBLE (le strict échec-fermé rattrape les deux, mais le plan que Marc valide ne
  // doit pas étiqueter « Zone protégée » un simple blip de lecture). Le 2ᵉ appel (non strict) ne
  // coûte que sur les fichiers où le strict a dit vrai (rares).
  var protegeStrict = aParentProtege_(f, ctx.proteges, true);
  var protegeConstate = protegeStrict && aParentProtege_(f, ctx.proteges, false);

  // Empreinte : même borne de taille que l'OCR (mémoire) ; Google Docs natifs / blob illisible → ''.
  var empreinte = '';
  if (!raccourci) {
    try { if (f.getSize() <= CONFIG.OCR_TAILLE_MAX) empreinte = empreinteBlob_(f.getBlob()); }
    catch (e) { empreinte = ''; }
  }
  // Doublon = même empreinte qu'un AUTRE fichier déjà recensé PAR LA CAMPAGNE (jamais l'Index —
  // auto-doublon ; jamais lui-même — rejeu après coupure entre la ligne et la clé).
  var doublonDe = (empreinte && ctx.empreintesVues[empreinte] && ctx.empreintesVues[empreinte] !== fileId)
    ? ctx.empreintesVues[empreinte] : null;
  if (empreinte && !ctx.empreintesVues[empreinte]) ctx.empreintesVues[empreinte] = fileId;

  var cheminComplet = cheminActuelDryRunV2_(f, domaine); // « domaine[/sous/chemin] » (réutilisé tel quel)
  var sousCheminActuel = cheminComplet === domaine ? '' : cheminComplet.slice(domaine.length + 1);

  var d = decisionConsolidation_({
    domaine: domaine,
    sousCheminActuel: sousCheminActuel,
    sousCheminCible: cheminCibleConsolidation_(domaine, nom, ctx.validees),
    protege: protegeConstate,
    protegeIllisible: protegeStrict && !protegeConstate,
    raccourci: raccourci,
    doublonDe: doublonDe,
  });

  // L'empreinte va dans la COLONNE du plan (mémoire de campagne) mais JAMAIS dans l'Index : elle y
  // alimenterait `estDoublon_` (fast-path intake) et fabriquerait des « doublons de lui-même » si un
  // rangement futur re-présentait le fichier (revue code C28-26 — leçon bypass `ignorerDoublon`).
  ctx.feuille.appendRow([new Date(), nom, fileId, d.action, d.cible, d.raison, empreinte]);
  indexAjouter_(cle, { statut: 'consolidation-plan', nom: nom, domaine: domaine, chemin: d.cible }, '');
  return true;
}

/**
 * ÉTAPE DE TICK de la campagne (appelée en fin de tick, gatée par `CONFIG.CONSOLIDATION_ACTIF` +
 * budget — étape SECONDAIRE enveloppée par l'appelant). Une page par run : collecte (filtrée par la
 * clé de convergence) puis traitement, sous-budget PROPRE. « Terminé » (Property
 * `DriveAI_CONSOLIDATION` = tag) UNIQUEMENT quand une passe complète ne collecte plus rien (jamais
 * sur une passe interrompue/en erreur — patron anti-« faux terminé » du rangement).
 * @param {function():boolean} estBudgetDepasse
 */
function genererPlanConsolidation_(estBudgetDepasse) {
  if (!CONFIG.CONSOLIDATION_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.CONSOLIDATION_TAG;

  // ROTATION de campagne (revue flotte 2026-07-21) : un NOUVEAU tag purge le plan PÉRIMÉ (des
  // lignes calculées contre un ancien référentiel — ex. conso-1 généré AVANT le seed des entités
  // ciblait encore des dossiers de banque) et remet les curseurs à zéro. Purge d'un RAPPORT
  // (jamais de documents, §2 intact — même famille que la rotation du Journal).
  if (props.getProperty('DriveAI_CONSO_PLAN_TAG') !== tag) {
    var fPlan = feuille_('PlanConsolidation');
    var dernL = fPlan.getLastRow();
    if (dernL > 1) fPlan.getRange(2, 1, dernL - 1, COLONNES_PLAN_CONSOLIDATION.length).clearContent();
    props.deleteProperty('DriveAI_CONSOLIDATION');
    props.deleteProperty('DriveAI_CONSO_EXEC_LIGNE');
    props.deleteProperty('DriveAI_CONSO_EXEC_FINI');
    props.setProperty('DriveAI_CONSO_PLAN_TAG', tag);
    journalInfo_('Consolidation', 'Nouveau tag de campagne « ' + tag + ' » : plan purgé, curseurs remis à zéro.');
  }

  if (props.getProperty('DriveAI_CONSOLIDATION') === tag) return; // campagne finie (1 lecture)
  if (estBudgetDepasse()) return;

  // CONTRE-PRESSION (drainer avant d'alimenter, tôt + gated) : si l'EXÉCUTEUR a trop de lignes de
  // retard, on n'alimente pas le plan ce run — il rattrape d'abord (revue quotas 2026-07-21).
  if (CONFIG.CONSOLIDATION_EXEC_ACTIF) {
    var curseurExec = Number(props.getProperty('DriveAI_CONSO_EXEC_LIGNE')) || 1;
    if (feuille_('PlanConsolidation').getLastRow() - curseurExec >= CONFIG.CONSOLIDATION_BACKLOG_MAX) return;
  }

  // Budget QUOTIDIEN en ms RÉELLES persistées (leçon §7 : un plafond par RUN ne borne pas la
  // JOURNÉE — ×288 ticks > quota runtime ~90 min/j, la campagne affamerait l'intake).
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourConsolidation_(props, aujourdhui);
  if (consommeJour >= CONFIG.CONSOLIDATION_BUDGET_JOUR_MS) return; // repris demain

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.CONSOLIDATION_BUDGET_MS, CONFIG.CONSOLIDATION_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  // Garde de COLLECTE : moitié du budget au plus — réserve du temps au TRAITEMENT, sinon un walk
  // long laisse n=0 à chaque run (plateau silencieux, revue apps-script-quota) : progrès garanti.
  var gardeCollecte = function () { return garde() || (Date.now() - debut) > budgetRun / 2; };

  try {
    // Périmètre : domaines FIXES (04 INCLUS — en CONSTAT seul, la garde §1 force « Ignoré ») + domaines
    // AUTO déjà nés (ID en Script Property — jamais `dossierDomaineAuto_` ici : il CRÉERAIT le dossier,
    // or ce module ne mute rien). `_Doublons`/`_Technique`/`_Médias`/files 00 : pas des domaines, jamais parcourus.
    var domaines = [];
    Object.keys(CONFIG.DOMAINES).forEach(function (nom) { domaines.push({ nom: nom, id: CONFIG.DOMAINES[nom] }); });
    (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
      var id = props.getProperty('DriveAI_DOM_' + nom);
      if (id) domaines.push({ nom: nom, id: id });
    });

    var items = [];
    var vusRun = {};
    for (var i = 0; i < domaines.length && items.length < CONFIG.CONSOLIDATION_MAX_PAR_RUN; i++) {
      if (gardeCollecte()) break;
      var cleDom = 'conso|' + tag + '|dom|' + domaines[i].nom;
      if (indexContient_(cleDom)) continue; // domaine ÉPUISÉ pour le tag : sauté en O(1) (anti re-walk)
      var etatDom = { complet: true };
      var avantDom = items.length;
      try {
        collecterConsolidation_(DriveApp.getFolderById(domaines[i].id), domaines[i].nom, items,
          CONFIG.CONSOLIDATION_MAX_PAR_RUN, gardeCollecte, tag, etatDom, vusRun);
      } catch (e) {
        etatDom.complet = false;
        journalErreur_('Consolidation', 'Domaine inaccessible (' + domaines[i].nom + ') : ' + e);
      }
      // Passe ENTIÈRE de CE domaine sans y collecter → plus rien à y faire pour ce tag : marqué
      // épuisé (les fichiers ajoutés PLUS TARD sont l'affaire du flux vivant, pas de la campagne).
      if (etatDom.complet && items.length === avantDom) {
        indexAjouter_(cleDom, { statut: 'consolidation-domaine-epuise', nom: domaines[i].nom, domaine: domaines[i].nom, chemin: '' }, '');
      }
    }

    if (!items.length) {
      // Fin de campagne = TOUS les domaines marqués épuisés (jamais sur interruption : un domaine
      // coupé par la garde n'est pas marqué — anti-faux-terminé).
      var tousEpuises = true;
      for (var k = 0; k < domaines.length; k++) {
        if (!indexContient_('conso|' + tag + '|dom|' + domaines[k].nom)) { tousEpuises = false; break; }
      }
      if (tousEpuises) {
        props.setProperty('DriveAI_CONSOLIDATION', tag);
        journalInfo_('Consolidation', 'Plan de consolidation TERMINÉ (tag « ' + tag + ' ») — onglet PlanConsolidation prêt pour validation.');
      }
      return;
    }

    var ctx = {
      proteges: ensembleDomainesProteges_(),
      validees: entitesValideesParCle_(),
      empreintesVues: empreintesPlanConsolidation_(),
      feuille: feuille_('PlanConsolidation'), // hissée : ~2 appendRow/fichier sans re-résolution d'onglet
    };
    var n = 0;
    for (var j = 0; j < items.length; j++) {
      if (garde()) break;
      // Try PAR ITEM : un fichier empoisonné ne doit jamais avorter le reste de la page.
      try { if (traiterUnConsolidation_(items[j].id, items[j].domaine, tag, ctx)) n++; }
      catch (e) { journalErreur_('Consolidation', 'Item sauté (' + items[j].id + ') : ' + e); }
    }
    if (n) journalInfo_('Consolidation', n + ' fichier(s) ajoutés au plan de consolidation (dry-run, aucune mutation).');
  } finally {
    // ms RÉELLES consommées ce run, persistées (date|ms) — même sur interruption/exception.
    props.setProperty('DriveAI_CONSO_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}
