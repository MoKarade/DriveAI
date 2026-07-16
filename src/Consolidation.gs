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
 *    posée en DERNIER ; campagne « terminée » quand une passe complète ne collecte plus rien ;
 *  - bornes : garde-temps partagé + sous-budget `CONSOLIDATION_BUDGET_MS` + plafond
 *    `CONSOLIDATION_MAX_PAR_RUN` par run ; le hash suit la même borne de taille que l'OCR.
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
 * SOUS-CHEMIN CIBLE d'un fichier sous son domaine, selon la taxonomie à plat (ADR-0023) :
 *  1. pièce d'identité (le segment Type se normalise vers un TYPE_IDENTITE) → dossier de TYPE
 *     (« Passeport »…) — l'exception identité reste des dossiers, jamais aplatie ;
 *  2. sinon : [AAAA si le domaine est dans DOMAINES_PAR_ANNEE et la date est lisible]
 *             [+ Entité si le tiers du nom se canonise vers une entité VALIDÉE de ce domaine] ;
 *  3. sinon '' = À PLAT à la racine du domaine.
 * PUR (les entités validées arrivent en paramètre : {cleCanonique → nom canonique}).
 * @param {string} domaine
 * @param {string} nom  nom ACTUEL du fichier
 * @param {Object} validees  carte cleCanoniqueEntite_ → libellé canonique (entités VALIDÉES seules)
 * @return {string} sous-chemin relatif ('' = racine du domaine, sinon 'AAAA', 'Entité' ou 'AAAA/Entité')
 */
function cheminCibleConsolidation_(domaine, nom, validees) {
  var seg = analyserNomClasse_(nom);
  if (seg.type) {
    var typeId = normaliserTypeIdentite_(seg.type);
    if (TYPES_IDENTITE.indexOf(typeId) !== -1) return typeId; // identité → dossier de type (inchangé)
  }
  var parts = [];
  if (seg.annee && (CONFIG.DOMAINES_PAR_ANNEE || []).indexOf(domaine) !== -1) parts.push(seg.annee);
  if (seg.tiers) {
    var cle = cleCanoniqueEntite_(domaine, seg.tiers);
    if (cle && validees && validees[cle]) parts.push(validees[cle]);
  }
  return parts.join('/');
}

/**
 * DÉCISION du plan pour un fichier (PURE — tout l'état arrive en paramètres) :
 *  - protégé (§1)  → « Ignoré » (constat de doublon éventuel dans la Raison, jamais de déplacement) ;
 *  - raccourci     → « Ignoré » (un raccourci d'entité est un artefact voulu du pipeline, pas un doc) ;
 *  - doublon       → « Doublon », cible `_Doublons` (déplacement seul, jamais de suppression §2) ;
 *  - déjà en place → « OK » ;
 *  - sinon         → « Déplacer » vers `domaine[/sousCheminCible]`.
 * @param {{domaine:string, sousCheminActuel:string, sousCheminCible:string, protege:boolean,
 *          raccourci:boolean, doublonDe:?string}} d  doublonDe = fileId du 1er porteur de l'empreinte
 * @return {{action:string, cible:string, raison:string}}
 */
function decisionConsolidation_(d) {
  if (d.protege) {
    return {
      action: 'Ignoré', cible: '',
      raison: 'Zone protégée (04) intouchable' + (d.doublonDe ? ' — doublon constaté de ' + d.doublonDe : ''),
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

/** Carte des entités VALIDÉES du référentiel : cleCanoniqueEntite_ → libellé canonique. 1 lecture/run. */
function entitesValideesParCle_() {
  var validees = {};
  try {
    var cache = chargerEntitesCache_();
    for (var i = 0; i < cache.lignes.length; i++) {
      var l = cache.lignes[i];
      if (!estValidee_(l.statut)) continue;
      var cle = cleCanoniqueEntite_(l.domaine, l.entite);
      if (cle) validees[cle] = canoniserEntite_(l.entite);
    }
  } catch (e) {
    journalErreur_('Consolidation', 'Référentiel d\'entités illisible (plan sans dossiers d\'entité ce run) : ' + e);
  }
  return validees;
}

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

/**
 * Collecte récursive des fichiers d'un domaine PAS ENCORE au plan (clé `conso|<tag>|<id>` absente
 * de l'Index — prédicat de convergence, filtré À LA COLLECTE : un mur de déjà-faits n'occupe
 * aucune place). Lecture seule, bornée par `max` et le garde. Même squelette que la Migration.
 * @param {Folder} dossier
 * @param {string} domaine
 * @param {Array<{id:string, domaine:string}>} items  muté en place
 * @param {number} max
 * @param {function():boolean} garde
 * @param {string} tag
 */
function collecterConsolidation_(dossier, domaine, items, max, garde, tag) {
  var fi = dossier.getFiles();
  while (fi.hasNext() && items.length < max) {
    if (garde()) return;
    try {
      var f = fi.next();
      if (!indexContient_('conso|' + tag + '|' + f.getId())) items.push({ id: f.getId(), domaine: domaine });
    } catch (e) { /* fichier illisible : sauté, re-vu à la passe suivante */ }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext() && items.length < max) {
    if (garde()) return;
    try { collecterConsolidation_(fo.next(), domaine, items, max, garde, tag); }
    catch (e) { /* sous-dossier illisible : la passe reste incomplète, jamais un plantage */ }
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
    feuille_('PlanConsolidation').appendRow([new Date(), fileId, fileId, 'Ignoré', '', 'Fichier illisible : ' + e, '']);
    indexAjouter_(cle, { statut: 'consolidation-plan', nom: fileId, domaine: domaine, chemin: '' }, '');
    return true;
  }

  var raccourci = mime === 'application/vnd.google-apps.shortcut';
  var protege = aParentProtege_(f, ctx.proteges, true); // STRICT : illisible = protégé (abstention §1)

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
    protege: protege,
    raccourci: raccourci,
    doublonDe: doublonDe,
  });

  feuille_('PlanConsolidation').appendRow([new Date(), nom, fileId, d.action, d.cible, d.raison, empreinte]);
  indexAjouter_(cle, { statut: 'consolidation-plan', nom: nom, domaine: domaine, chemin: d.cible }, empreinte);
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
  if (props.getProperty('DriveAI_CONSOLIDATION') === tag) return; // campagne finie (1 lecture)
  if (estBudgetDepasse()) return;

  var debut = Date.now();
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > CONFIG.CONSOLIDATION_BUDGET_MS; };

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
  var erreurCollecte = false;
  for (var i = 0; i < domaines.length && items.length < CONFIG.CONSOLIDATION_MAX_PAR_RUN; i++) {
    if (garde()) break;
    try {
      collecterConsolidation_(DriveApp.getFolderById(domaines[i].id), domaines[i].nom, items,
        CONFIG.CONSOLIDATION_MAX_PAR_RUN, garde, tag);
    } catch (e) {
      erreurCollecte = true;
      journalErreur_('Consolidation', 'Domaine inaccessible (' + domaines[i].nom + ') : ' + e);
    }
  }

  var interrompue = garde();
  if (!items.length) {
    // Passe COMPLÈTE et vide = vrai signal de fin (jamais sur interruption/erreur — anti-faux-terminé).
    if (!interrompue && !erreurCollecte) {
      props.setProperty('DriveAI_CONSOLIDATION', tag);
      journalInfo_('Consolidation', 'Plan de consolidation TERMINÉ (tag « ' + tag + ' ») — onglet PlanConsolidation prêt pour validation.');
    }
    return;
  }

  var ctx = {
    proteges: ensembleDomainesProteges_(),
    validees: entitesValideesParCle_(),
    empreintesVues: empreintesPlanConsolidation_(),
  };
  var n = 0;
  for (var j = 0; j < items.length; j++) {
    if (garde()) break;
    // Try PAR ITEM : un fichier empoisonné ne doit jamais avorter le reste de la page.
    try { if (traiterUnConsolidation_(items[j].id, items[j].domaine, tag, ctx)) n++; }
    catch (e) { journalErreur_('Consolidation', 'Item sauté (' + items[j].id + ') : ' + e); }
  }
  if (n) journalInfo_('Consolidation', n + ' fichier(s) ajoutés au plan de consolidation (dry-run, aucune mutation).');
}
