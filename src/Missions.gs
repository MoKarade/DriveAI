/**
 * Missions.gs — Missions de curation (C28-49, ADR-0039) : le rangement FIN, dossier par dossier,
 * spécifié par Marc (brief 2026-08-17). PR1 : socle générique + les 4 missions 03/06.
 *
 * Contrat du socle (invariants hérités de ConsolidationExec/Reset — « quels gardes mes voisins
 * ont-ils ? ») :
 *  - LA SEULE MUTATION est `moveTo` (déplacement, réversible) + une PEINTURE de couleur de dossier
 *    (métadonnée, réversible). JAMAIS de suppression (§2) — les dossiers vidés sont peints en
 *    ROUGE pour que Marc choisisse lui-même ce qu'il corbeille.
 *  - Zone protégée (04 · Immigration) exclue à la COLLECTE et RE-VÉRIFIÉE strictement avant
 *    CHAQUE mutation. Multi-parents : jamais déplacé.
 *  - Idempotence VERSIONNÉE : `mission|<tag>|<version>|<fileId>`, posée APRÈS le déplacement.
 *    Les REFUS (non appariés) sont aussi inscrits — sinon re-collecte à vie — et la version dans
 *    la clé rend l'affinage des règles effectif (leçon C28-33 : un verdict NÉGATIF se fige par
 *    version, jamais à vie).
 *  - Convergence : terminée quand une passe COMPLÈTE ne collecte plus rien de traitable.
 *  - Budget QUOTIDIEN partagé (ms réelles persistées, `DriveAI_MISSIONS_JOUR`) + garde-temps
 *    évalué À CHAQUE item, collecte comprise. Zéro LLM : tout se décide par le NOM
 *    (`AAAA-MM-JJ_Type_Émetteur`) et la structure.
 */

/* ================= Table des missions (PR1 : 03 + 06) ================= */

/**
 * Chaque mission : { tag, cle (registre/Progression), sources: [folderId], router(nom, info, ctx),
 * batirCtx() } — `router` est PUR (testé) : rend { cibleId, sousDossier: ?string } ou null
 * (non apparié → laissé en place + rapporté, jamais deviné).
 * @return {Array<Object>}
 */
function tableMissions_() {
  var IDS = CONFIG.MISSIONS_IDS;
  return [
    {
      tag: 'vehicule', cle: 'mission-vehicule',
      sources: [IDS.vehiculesPluriel, IDS.toyotaBzIsole],
      batirCtx: function () { return { cibles: ciblesAvecJetons_(IDS.vehiculeCible, EXTRA_JETONS_VEHICULES) }; },
      router: function (nom, info, ctx) {
        // Le dossier `Toyota bZ` isolé part EN BLOC vers Véhicule/Toyota bZ (ordre explicite de Marc).
        if (info.sourceId === IDS.toyotaBzIsole) {
          return { cibleParentId: IDS.vehiculeCible, cibleNom: 'Toyota bZ', sousDossier: info.sousChemin };
        }
        // `Véhicules/<X>/…` : le sous-dossier d'origine désigne le véhicule → contenu à plat.
        var parSous = info.sousChemin ? apparierUnique_(info.sousChemin, ctx.cibles) : null;
        if (parSous) return { cibleParentId: IDS.vehiculeCible, cibleNom: parSous.nom, sousDossier: '' };
        // Sinon le NOM désigne le véhicule ; un sous-dossier d'origine NON-véhicule est un THÈME
        // (« Véhicules/Assurance/… ») — préservé sous le véhicule, comme dispatch03 (revue code).
        var parNom = apparierUnique_(nom, ctx.cibles);
        return parNom
          ? { cibleParentId: IDS.vehiculeCible, cibleNom: parNom.nom, sousDossier: info.sousChemin || '' }
          : null;
      },
    },
    {
      tag: 'logement', cle: 'mission-logement',
      sources: [IDS.logementsPluriel],
      batirCtx: function () { return { cibles: ciblesAvecJetons_(IDS.logementCible, {}) }; },
      router: function (nom, info, ctx) {
        var c = apparierUnique_(info.sousChemin || nom, ctx.cibles) || apparierUnique_(nom, ctx.cibles);
        return c ? { cibleId: c.id, sousDossier: '' } : null;
      },
    },
    {
      tag: 'dispatch03', cle: 'mission-dispatch-03',
      sources: [IDS.contrats03, IDS.correspondance03, IDS.assuranceHab03, IDS.energieServices03],
      batirCtx: function () {
        var logements = ciblesAvecJetons_(IDS.logementCible, {});
        return {
          vehicules: ciblesAvecJetons_(IDS.vehiculeCible, EXTRA_JETONS_VEHICULES),
          logements: logements,
          fenetres: fenetresOccupation_(logements),
          themePar: (function () { // le sous-dossier de destination = le THÈME du dossier source
            var m = {};
            m[IDS.contrats03] = 'Contrats';
            m[IDS.correspondance03] = 'Correspondance';
            m[IDS.assuranceHab03] = 'Assurance habitation';
            m[IDS.energieServices03] = 'Énergie & services';
            return m;
          })(),
        };
      },
      router: function (nom, info, ctx) {
        var theme = ctx.themePar[info.sourceId] || '';
        // 1. Véhicule nommé dans le fichier (un contrat « …_Toyota » part côté véhicule).
        var v = apparierUnique_(nom, ctx.vehicules);
        if (v) return { cibleParentId: CONFIG.MISSIONS_IDS.vehiculeCible, cibleNom: v.nom, sousDossier: theme };
        // 2. Adresse nommée dans le fichier.
        var l = apparierUnique_(nom, ctx.logements);
        if (l) return { cibleId: l.id, sousDossier: theme };
        // 3. Correspondance sans indice : la DATE tranche si elle tombe dans EXACTEMENT une
        //    fenêtre d'occupation (demande Marc « regarde les dates pour déterminer »).
        if (info.sourceId === CONFIG.MISSIONS_IDS.correspondance03) {
          var parDate = logementParDate_(nom, ctx.fenetres);
          if (parDate) return { cibleId: parDate, sousDossier: theme };
        }
        return null;
      },
    },
    {
      tag: 'archives06', cle: 'mission-archives-06',
      sources: (IDS.archives06 || []).map(function (p) { return p.src; }),
      batirCtx: function () {
        var parSource = {};
        (IDS.archives06 || []).forEach(function (p) { parSource[p.src] = p.cible; });
        return { parSource: parSource };
      },
      router: function (nom, info, ctx) {
        // Table d'alias EXPLICITE (ADR-0039) : la source désigne l'archive, le contenu part en bloc
        // (un niveau de sous-dossier préservé). Pas d'alias = pas une source = jamais deviné.
        var cible = ctx.parSource[info.sourceId];
        return cible ? { cibleId: cible, sousDossier: info.sousChemin } : null;
      },
      // Après le transfert, le flux vivant doit VISER l'archive, pas le dossier vidé (sinon il
      // re-remplit ce que la mission vide — leçon §7 « référentiel consulté par les deux »).
      // PEUT LEVER, volontairement (revue sécurité C28-49) : un échec doit EMPÊCHER le drapeau
      // FINI pour être re-tenté à la passe suivante — `repointerEntites_` est idempotent (une
      // ligne déjà re-pointée ne matche plus la source), rejouer la boucle est sans danger.
      apresConvergence: function () {
        (IDS.archives06 || []).forEach(function (p) { repointerEntites_(p.src, p.cible); });
      },
    },
  ];
}

/** Jetons SUPPLÉMENTAIRES par cible (synonymes de marque que le nom du dossier ne porte pas). */
var EXTRA_JETONS_VEHICULES = { 'vw jetta': ['volkswagen'], 'toyota bz': ['bz4x'] };

/* ================= Fonctions PURES (appariement, dates, jetons) ================= */

/** Mots d'adresse/génériques qui ne DISCRIMINENT pas une cible (jamais des jetons). */
var MOTS_OUTILS_MISSIONS = {
  avenue: true, ave: true, rue: true, route: true, rte: true, boulevard: true, boul: true,
  quebec: true, montreal: true, canada: true, appartement: true, app: true, apt: true,
};

/** Normalise pour l'appariement : minuscules, sans accents, séparateurs unifiés. PURE. */
function normaliserMission_(texte) {
  return String(texte || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // diacritiques en échappé (revue : lisible, robuste au copier-coller)
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Jetons DISCRIMINANTS d'un nom de cible : les NOMBRES toujours (un n° civique identifie une
 * adresse), les mots ≥ 4 lettres hors mots-outils. PURE (testée).
 * @param {string} nom
 * @return {string[]}
 */
function jetonsCible_(nom) {
  return normaliserMission_(nom).split(' ').filter(function (t) {
    if (!t) return false;
    // ≥ 3 chiffres (revue code) : à 2 chiffres, un n° d'appartement matcherait les composants
    // JJ/MM résiduels d'une date en plein nom (le préfixe est retiré, pas une date citée ailleurs).
    if (/^\d+$/.test(t)) return t.length >= 3;
    if (/^\d/.test(t)) return false;                   // ordinaux d'adresse (« 4e », « 3e ») : jamais discriminants
    return t.length >= 4 && !MOTS_OUTILS_MISSIONS[t];
  });
}

/**
 * Apparie un texte à UNE SEULE cible : au moins un jeton discriminant présent en MOT ENTIER, et
 * pas d'ambiguïté (deux cibles qui matchent ⇒ null — on ne devine jamais, ADR-0039). PURE (testée).
 *
 * MOT ENTIER seulement (revues quotas + sécurité C28-49) : un match par sous-chaîne non ancrée
 * (« mont » dans « montreal », « 783 » dans « 7834 ») produirait un faux appariement UNIQUE —
 * fichier déplacé au MAUVAIS endroit avec une clé de SUCCÈS : parti de la source, même un bump
 * de version ne le ré-évaluerait jamais. La normalisation transforme toute ponctuation en
 * espaces, donc les frontières de mots existent toujours.
 * @param {string} texte
 * @param {Array<{nom:string, id:string, jetons:string[]}>} cibles
 * @return {?{nom:string, id:string}}
 */
function apparierUnique_(texte, cibles) {
  // Le préfixe de date `AAAA-MM[-JJ]` est RETIRÉ avant l'appariement (revue code) : normalisé, il
  // devient « 2024 05 12 » — un jeton NUMÉRIQUE de cible pourrait matcher un composant de date.
  var n = ' ' + normaliserMission_(String(texte || '').replace(/^\d{4}-\d{2}(-\d{2})?/, '')) + ' ';
  var trouve = null;
  for (var i = 0; i < (cibles || []).length; i++) {
    var c = cibles[i];
    var touche = (c.jetons || []).some(function (j) { return n.indexOf(' ' + j + ' ') !== -1; });
    if (!touche) continue;
    if (trouve && trouve.id !== c.id) return null; // ambigu
    trouve = c;
  }
  return trouve;
}

/** Date (ms) du préfixe `AAAA-MM[-JJ]` d'un nom classé ; null sinon. PURE (testée). */
function dateDuNomMission_(nom) {
  var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(nom || ''));
  if (!m) return null;
  var ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 15));
  return isNaN(ts) ? null : ts;
}

/**
 * Choisit le logement dont la FENÊTRE d'occupation contient la date du nom — seulement si la date
 * tombe dans EXACTEMENT une fenêtre (chevauchement ⇒ null). PURE (testée).
 * @param {string} nom
 * @param {Array<{id:string, min:number, max:number}>} fenetres
 * @return {?string} id du logement
 */
function logementParDate_(nom, fenetres) {
  var ts = dateDuNomMission_(nom);
  if (ts === null) return null;
  var trouve = null;
  for (var i = 0; i < (fenetres || []).length; i++) {
    var f = fenetres[i];
    if (ts >= f.min && ts <= f.max) {
      if (trouve) return null; // deux fenêtres possibles → on ne devine pas
      trouve = f.id;
    }
  }
  return trouve;
}

/* ================= I/O bornées (contextes, collecte, peinture) ================= */

/** Enfants-dossiers d'une cible, avec leurs jetons (+ extras par nom normalisé). */
function ciblesAvecJetons_(parentId, extras) {
  var cibles = [];
  var it = DriveApp.getFolderById(parentId).getFolders();
  while (it.hasNext()) {
    var d = it.next();
    var nom = d.getName();
    var jetons = jetonsCible_(nom).concat((extras || {})[normaliserMission_(nom)] || []);
    cibles.push({ nom: nom, id: d.getId(), jetons: jetons });
  }
  return cibles;
}

/**
 * Fenêtres d'occupation DÉRIVÉES des fichiers déjà classés dans chaque logement (min/max des dates
 * de noms, ± `MISSIONS_FENETRE_MARGE_MS`). Un logement sans fichier daté n'a pas de fenêtre (il
 * ne capte rien par date — prudence).
 *
 * SANS garde-temps, ASSUMÉ (revue sécurité C28-49) : la borne est STRUCTURELLE (≤ 100 noms lus
 * par logement × ~5 logements, pur `getName()` — quelques secondes au pire), et `batirCtx()` ne
 * tourne qu'une fois par run de mission NON convergée. Si un jour une mission a des cibles non
 * bornées, lui passer le garde — la promesse « garde à chaque item » de l'ADR vaut pour tout
 * parcours NON borné.
 * @param {Array<{nom:string,id:string}>} logements
 * @return {Array<{id:string,min:number,max:number}>}
 */
function fenetresOccupation_(logements) {
  var fenetres = [];
  (logements || []).forEach(function (l) {
    try {
      var it = DriveApp.getFolderById(l.id).getFiles();
      var min = Infinity, max = -Infinity, lus = 0;
      while (it.hasNext() && lus < 100) {
        var ts = dateDuNomMission_(it.next().getName());
        lus++;
        if (ts === null) continue;
        if (ts < min) min = ts;
        if (ts > max) max = ts;
      }
      if (min !== Infinity) {
        fenetres.push({ id: l.id, min: min - CONFIG.MISSIONS_FENETRE_MARGE_MS, max: max + CONFIG.MISSIONS_FENETRE_MARGE_MS });
      }
    } catch (e) { /* logement illisible → pas de fenêtre (aucun routage par date vers lui) */ }
  });
  return fenetres;
}

/**
 * Collecte les fichiers TRAITABLES d'une source (profondeur ≤ 2 : racine + un niveau de
 * sous-dossiers, `sousChemin` préservé). Filtres À LA COLLECTE (une page = du traitable
 * seulement) : clé d'idempotence absente, zone protégée exclue. Garde-temps À CHAQUE item.
 * @return {{items:Array, coupe:boolean}}  coupe = collecte interrompue (garde/plafond)
 */
function collecterMission_(sourceId, tag, garde, proteges) {
  var items = [], coupe = false, profond = false;
  var pousse = function (fichier, sousChemin) {
    if (items.length >= CONFIG.MISSIONS_MAX_PAR_RUN) { coupe = true; return false; }
    if (garde()) { coupe = true; return false; }
    var cle = cleMission_(tag, fichier.getId());
    if (indexContient_(cle)) return true; // déjà traité (succès OU refus versionné)
    items.push({ fichier: fichier, sousChemin: sousChemin, sourceId: sourceId });
    return true;
  };
  // RÉCURSIVE bornée (revue code : à profondeur ≤ 2, `Véhicules/<X>/<thème>/f.pdf` était INVISIBLE
  // et la mission se déclarait « terminée » en l'ignorant). `sousChemin` = PREMIER segment (le seul
  // niveau que les cibles préservent). Au-delà de la borne : signalé, et la passe reste INCOMPLÈTE
  // — jamais un « terminé » qui ignore des fichiers en silence.
  var descendre = function (dossier, premierSegment, profondeur) {
    if (profondeur > CONFIG.MISSIONS_PROFONDEUR_MAX) { profond = true; return true; }
    var fs = dossier.getFiles();
    while (fs.hasNext()) { if (!pousse(fs.next(), premierSegment)) return false; }
    var ds = dossier.getFolders();
    while (ds.hasNext()) {
      if (garde()) { coupe = true; return false; }
      var sous = ds.next();
      if (!descendre(sous, premierSegment || sous.getName(), profondeur + 1)) return false;
    }
    return true;
  };
  try {
    var racine = DriveApp.getFolderById(sourceId);
    // Verdict de protection par DOSSIER, pas par fichier (revue quotas C28-49) : tous les fichiers
    // d'un même dossier partagent leur chaîne d'ancêtres — la vérifier PAR ITEM coûtait 3-5 RPC ×
    // items pour la même réponse. Un fichier MULTI-PARENTS dont l'AUTRE parent serait protégé
    // échappe à ce filtre de collecte : la re-vérif STRICTE par item avant mutation (§1) le bloque.
    if (aParentProtege_(racine, proteges, false)) return { items: items, coupe: coupe };
    descendre(racine, '', 0);
    if (profond) {
      journalErreur_('Missions', 'Source ' + sourceId + ' : arborescence plus profonde que ' +
        CONFIG.MISSIONS_PROFONDEUR_MAX + ' niveaux — fichiers hors portée, mission maintenue OUVERTE.');
      return { items: items, coupe: coupe, erreur: true };
    }
  } catch (e) {
    journalErreur_('Missions', 'Collecte impossible (source ' + sourceId + ') : ' + e);
    return { items: items, coupe: coupe, erreur: true }; // jamais « passe complète » sur une erreur
  }
  return { items: items, coupe: coupe };
}

/** Clé d'idempotence VERSIONNÉE (ADR-0039 — succès ET refus, re-évaluables par bump de version). */
function cleMission_(tag, fileId) {
  return 'mission|' + tag + '|' + CONFIG.MISSIONS_REGLES_VERSION + '|' + fileId;
}

/**
 * Peint un dossier en ROUGE (`folderColorRgb`) — signal « vidé, bon pour suppression » pour Marc.
 * Métadonnée RÉVERSIBLE, jamais une suppression. Best-effort (un échec ne remet rien en cause).
 */
function peindreDossierRouge_(folderId) {
  try {
    var rep = fetchDriveAvecRetry_(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId) + '?fields=id',
      {
        method: 'patch', contentType: 'application/json',
        payload: JSON.stringify({ folderColorRgb: CONFIG.MISSIONS_COULEUR_VIDE }),
        headers: { Authorization: 'Bearer ' + jetonDrive_() },
        muteHttpExceptions: true,
      }
    );
    if (rep.getResponseCode() !== 200) {
      journalInfo_('Missions', 'Peinture rouge refusée (HTTP ' + rep.getResponseCode() + ') pour ' + folderId);
    }
  } catch (e) { journalInfo_('Missions', 'Peinture rouge différée : ' + e); }
}

/** Vrai si le dossier est STRICTEMENT vide (aucun fichier, aucun sous-dossier non corbeillés). */
function estDossierVideMission_(dossier) {
  try { return !dossier.getFiles().hasNext() && !dossier.getFolders().hasNext(); }
  catch (e) { return false; } // illisible → on ne peint pas (prudence)
}

/**
 * À la CONVERGENCE : peint en rouge la source + ses sous-dossiers directs devenus vides.
 * BEST-EFFORT one-shot (assumé, revue quotas) : exécutée APRÈS le drapeau FINI — un PATCH raté
 * (403 quota Drive) laisse un dossier non peint, sans jamais remettre en cause la mission ; Marc
 * voit de toute façon les dossiers vides dans l'app (constat `vide-candidat`). Bornée par le
 * `garde` : une source à très nombreux sous-dossiers ne file jamais vers le mur des 6 min.
 */
function peindreSourcesVides_(sources, garde) {
  (sources || []).forEach(function (id) {
    if (garde && garde()) return;
    try {
      var racine = DriveApp.getFolderById(id);
      var ds = racine.getFolders();
      while (ds.hasNext()) {
        if (garde && garde()) return;
        var sous = ds.next();
        if (estDossierVideMission_(sous)) peindreDossierRouge_(sous.getId());
      }
      if (estDossierVideMission_(racine)) peindreDossierRouge_(id);
    } catch (e) { journalInfo_('Missions', 'Peinture de la source ' + id + ' différée : ' + e); }
  });
}

/* ================= Compteurs (Progression) & budget quotidien ================= */

/** Consommation du budget QUOTIDIEN partagé des missions (`AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourMissions_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_MISSIONS_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/** Compteurs compacts par mission `{<tag>:{t,b,na}}` (~40 o/mission — loin des 9 Ko). */
function chargerEtatMissions_(props) {
  try { return JSON.parse(props.getProperty('DriveAI_MISSIONS_ETAT') || '{}') || {}; }
  catch (e) { return {}; }
}

/**
 * Gate de tick : `dispatch03` n'ouvre qu'après la convergence de `vehicule` ET `logement` (revue
 * code C28-49). Sans ça, ses verdicts NÉGATIFS se figent pendant que la DONNÉE mûrit : les
 * fenêtres d'occupation dérivent des fichiers que `mission-logement` est EN TRAIN d'ajouter, et
 * la cible « Toyota bZ » n'existe qu'après le premier move de `mission-vehicule` — une
 * correspondance refusée au jour 1 serait keyée alors que la fenêtre l'aurait routée au jour 3
 * (la version ne protège pas : c'est l'état Drive qui bouge, pas la table de règles).
 */
function gMissionsAmont03_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = CONFIG.MISSIONS_REGLES_VERSION;
    return props.getProperty('DriveAI_MISSION_FINI_vehicule') === v &&
      props.getProperty('DriveAI_MISSION_FINI_logement') === v
      ? null : 'en attente (missions 03)';
  } catch (e) { return 'en attente (missions 03)'; } // état illisible → prudence (un tick d'attente)
}

/** Gate de tick : budget quotidien des missions épuisé ? (raison de skip pour le suivi C28-44). */
function gMissionsJour_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return budgetJourMissions_(props, dateGmail_(new Date())) >= CONFIG.MISSIONS_BUDGET_JOUR_MS
      ? 'budget du jour épuisé' : null;
  } catch (e) { return null; } // état illisible : on laisse passer, le runner re-vérifie
}

/* ================= Runner ================= */

/**
 * Exécute UNE mission (une passe bornée par tick). Appelée par `etapeSuivie_` (Main.gs), donc
 * enveloppée — mais AUCUN throw attendu ici : chaque item dégrade en skip journalisé.
 * @param {string} tag
 * @param {function():boolean} estBudgetDepasse  garde standard (mur 4,5 min)
 */
function executerMission_(tag, estBudgetDepasse) {
  if (!CONFIG.MISSIONS_ACTIF) return;
  var spec = null;
  tableMissions_().forEach(function (m) { if (m.tag === tag) spec = m; });
  if (!spec) return;

  var props = PropertiesService.getScriptProperties();
  var version = CONFIG.MISSIONS_REGLES_VERSION;
  // Court-circuit TERMINAL : mission convergée = cette lecture + celle de la gate `gMissionsJour_`
  // (2 lectures Property par tick et par mission — chiffré en revue quotas, négligeable).
  if (props.getProperty('DriveAI_MISSION_FINI_' + tag) === version) return;

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourMissions_(props, aujourdhui);
  if (consommeJour >= CONFIG.MISSIONS_BUDGET_JOUR_MS) return; // repris demain (gate + re-vérif)

  // FILET anti-brûlage (revue quotas C28-49) : une source en erreur PERMANENTE (dossier supprimé
  // par Marc, ID mal épinglé) rejouerait collecte + Journal À CHAQUE tick, jusqu'à 10 min/j à
  // vie, mission jamais « terminée ». Après MISSIONS_ERREURS_MAX runs consécutifs en erreur, on
  // ne réessaie plus qu'UNE fois par jour — et toute passe SAINE remet le compteur à zéro (un
  // blip transitoire ne fige jamais rien : « chemin de retour », §7).
  var etatM0 = chargerEtatMissions_(props);
  var m0 = etatM0[tag] || {};
  if ((m0.err || 0) >= CONFIG.MISSIONS_ERREURS_MAX && m0.errJour === aujourdhui) return;

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.MISSIONS_BUDGET_MS, CONFIG.MISSIONS_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  try {
    var ctx = spec.batirCtx ? spec.batirCtx() : {};
    var proteges = ensembleDomainesProteges_();
    // DEUX drapeaux distincts (🔴 revue code) : `coupe` = garde/plafond ⇒ on ARRÊTE (le reste du
    // tick attend) ; `passeIncomplete` = un item transitoire / une source en erreur ⇒ on CONTINUE
    // les autres items et les autres sources (sinon un fichier POISON — « Access denied » permanent,
    // cas réel documenté — affame toutes les sources suivantes À VIE), mais la convergence est
    // bloquée pour ce run.
    var traites = 0, refus = 0, coupe = false, passeIncomplete = false, erreurCollecte = false;

    for (var s = 0; s < spec.sources.length && !coupe; s++) {
      var collecte = collecterMission_(spec.sources[s], tag, garde, proteges);
      coupe = coupe || collecte.coupe;
      if (collecte.erreur) { erreurCollecte = true; passeIncomplete = true; }
      for (var i = 0; i < collecte.items.length; i++) {
        if (garde()) { coupe = true; break; }
        var item = collecte.items[i];
        var resultat = traiterItemMission_(spec, item, ctx, proteges);
        if (resultat === 'fait') traites++;
        else if (resultat === 'refus') refus++;
        else passeIncomplete = true; // 'transitoire' : re-tenté au prochain run — on CONTINUE
      }
    }

    // Compteurs Progression : numérateur MONOTONE, base re-basable (jamais > 100 %) — le
    // « terminé » vient de la passe vide, jamais de `traites >= base` (leçon §7).
    var etatM = chargerEtatMissions_(props);
    var m = etatM[tag] || { t: 0, b: 0, na: 0 };
    // Les refus sont KEYÉS (plus jamais re-vus par la collecte) : leur compte est CUMULATIF, comme
    // les traités. Un bump de version rouvre leur ré-évaluation → le compte repart de zéro.
    if (m.v !== version) { m.na = 0; m.b = 0; m.v = version; }
    m.t += traites;
    m.na += refus;
    // BASE HONNÊTE (revue code : `t + reste-au-moins-1` affichait 98 % dès la première page d'une
    // source de milliers de fichiers, et « reste 1 » pendant des jours). La base n'existe qu'après
    // une passe COMPLÈTE — avant, PAS de barre plutôt qu'une barre fausse (précédent histo-gmail).
    if (!coupe && !passeIncomplete) m.b = m.t + m.na;
    // Compteur d'erreurs de collecte CONSÉCUTIVES (filet anti-brûlage ci-dessus) : une passe
    // saine le remet à zéro, au-delà du seuil on marque le jour de la dernière tentative.
    if (erreurCollecte) {
      m.err = (m.err || 0) + 1;
      if (m.err >= CONFIG.MISSIONS_ERREURS_MAX) m.errJour = aujourdhui;
    } else { delete m.err; delete m.errJour; }
    etatM[tag] = m;
    try { props.setProperty('DriveAI_MISSIONS_ETAT', JSON.stringify(etatM)); } catch (e) { }

    // CONVERGENCE : passe COMPLÈTE (ni coupée, ni trouée par un transitoire/une erreur) qui n'a
    // plus RIEN déplacé ni refusé de neuf.
    if (!coupe && !passeIncomplete && traites === 0 && refus === 0) {
      // `apresConvergence` (re-pointage du référentiel) AVANT le drapeau FINI (revue sécurité
      // C28-49) : FINI posé d'abord + court-circuit terminal = un échec ici ne serait JAMAIS
      // re-tenté (« un retour qui est un délai n'est pas un chemin de retour », §7) — le flux
      // vivant re-remplirait le dossier vidé/peint que Marc s'apprête à corbeiller. En échouant
      // AVANT le drapeau, la prochaine passe (vide, quasi gratuite : tout est keyé) re-tente.
      if (spec.apresConvergence) spec.apresConvergence(); // peut lever → pas de FINI, re-tenté
      props.setProperty('DriveAI_MISSION_FINI_' + tag, version);
      peindreSourcesVides_(spec.sources, garde);
      journalInfo_('Missions', 'Mission « ' + tag + ' » TERMINÉE (version ' + version + ') : ' +
        m.t + ' déplacé(s), ' + m.na + ' non apparié(s). Dossiers vidés peints en rouge.');
    }
  } finally {
    // Budget quotidien : ms RÉELLES consommées, écrites même sur exception (jamais de fuite).
    try { props.setProperty('DriveAI_MISSIONS_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut))); }
    catch (e) { }
  }
}

/**
 * Traite UN item : route, RE-VÉRIFIE les gardes (strict), déplace, inscrit la clé APRÈS.
 * @return {string} 'fait' | 'refus' (non apparié/multi-parents, inscrit) | 'transitoire' (re-tenté)
 */
function traiterItemMission_(spec, item, ctx, proteges) {
  var f = item.fichier;
  var nom = f.getName();
  var cle = cleMission_(spec.tag, f.getId());

  var cible = null;
  try { cible = spec.router(nom, { sousChemin: item.sousChemin, sourceId: item.sourceId }, ctx); }
  catch (e) { journalErreur_('Missions', 'Routage impossible (« ' + nom + ' ») : ' + e); return 'transitoire'; }

  // MULTI-PARENTS (moveTo retirerait TOUS les parents = détachement interdit) et NON-APPARIÉ :
  // deux REFUS définitifs sous cette version de règles — inscrits pour la convergence.
  var refus = '';
  if (!cible) refus = 'mission-non-apparie';
  else if (nbParentsBorne_(f) > 1) refus = 'mission-multi-parents';
  if (refus) {
    indexAjouter_(cle, { statut: refus, nom: nom, domaine: '', chemin: '' }, '');
    return 'refus';
  }

  // Zone protégée : RE-VÉRIFIÉE strictement au moment de la mutation (échec fermé).
  if (aParentProtege_(f, proteges, true)) {
    indexAjouter_(cle, { statut: 'mission-protege', nom: nom, domaine: '', chemin: '' }, '');
    return 'refus';
  }

  try {
    // Résolutions MÉMOÏSÉES à portée RUN (revue quotas C28-49 : `sousDossier_` = getFoldersByName
    // find-or-create PAR ITEM, or les combinaisons se répètent massivement — 5 logements × 4
    // thèmes, Toyota bZ…). Le cache vit dans `ctx` (construit par run, survit à tous les items du
    // run — pas le piège de la structure reconstruite par item, leçon Vague 3c).
    var memo = ctx.__memo || (ctx.__memo = {});
    var ouvrir = function (id) { return memo['id|' + id] || (memo['id|' + id] = DriveApp.getFolderById(id)); };
    var sous = function (parent, nomSous) {
      var k = 'sous|' + parent.getId() + '|' + nomSous;
      return memo[k] || (memo[k] = sousDossier_(parent, nomSous));
    };
    var dossier = cible.cibleId ? ouvrir(cible.cibleId) : sous(ouvrir(cible.cibleParentId), cible.cibleNom);
    if (cible.sousDossier) dossier = sous(dossier, cible.sousDossier);
    f.moveTo(dossier); // LA seule mutation — déplacement, jamais suppression
    // NB (revue quotas) : un crash ENTRE le move et la clé laisse un déplacement sans trace Index —
    // sans double traitement (le fichier a quitté la source, la collecte est source-scopée), la clé
    // ne sera simplement jamais posée pour lui (compteur t −1, bruit possible en réconciliation).
    indexAjouter_(cle, { statut: 'mission', nom: nom, domaine: '', chemin: dossier.getName() }, '');
    return 'fait';
  } catch (e) {
    // Échec de déplacement : pas de clé → re-tenté au prochain run, la passe reste incomplète.
    // ESSAIS BORNÉS (🔴 revue code, patron `gererEchec_`/QUARANTAINE_MAX) : un échec PERMANENT
    // (« Access denied » sur un partagé sans droit — cas réel documenté) serait sinon re-tenté à
    // chaque run À VIE, avec une ligne de Journal par run. Au-delà du plafond, REFUS inscrit sous
    // la clé versionnée (`mission-echec`) : plus jamais re-collecté, ré-évaluable par bump.
    var essais = 0;
    try { essais = incrementerEchec_(cle); } catch (e2) { /* compteur indisponible : on re-tentera */ }
    if (essais >= CONFIG.QUARANTAINE_MAX) {
      journalErreur_('Missions', 'ABANDON après ' + essais + ' essais (« ' + nom + ' ») : ' + e);
      indexAjouter_(cle, { statut: 'mission-echec', nom: nom, domaine: '', chemin: '' }, '');
      return 'refus';
    }
    journalErreur_('Missions', 'Déplacement différé (essai ' + essais + '/' + CONFIG.QUARANTAINE_MAX +
      ', « ' + nom + ' ») : ' + e);
    return 'transitoire';
  }
}
