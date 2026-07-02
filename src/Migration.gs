/**
 * Migration.gs — Chantier #8 (ADR-0002) : migration de l'EXISTANT vers la nouvelle taxonomie.
 *
 * Les documents classés AVANT les chantiers #3-#6 (nommage par type, entités, 07·Santé, few-shot)
 * portent l'ancienne convention. Cette campagne — gatée par `CONFIG.MIGRATION_TAG`, une seule fois
 * par tag — les repasse au pipeline COMPLET (OCR → LLM → routage → renommage) pour qu'ils épousent
 * la taxonomie courante. Réutilise la mécanique éprouvée du grand rangement (page bornée, reprenable,
 * « terminé » seulement quand une passe complète ne collecte plus rien), avec 3 différences décisives :
 *
 *  1. EN PLACE, pas via `00·À trier` : un doc classé a déjà une clé Index (`drive|`/`messageId|`/`shared|`)
 *     — déposé dans la file, l'intake le SAUTERAIT (idempotence) et il y resterait à vie. On le traite
 *     directement avec `traiterDocument_` et un placement déplacement/renommage (jamais de copie).
 *  2. Clé d'idempotence DÉDIÉE `migre|<tag>|fileId` : purement ADDITIVE (aucune ligne d'Index supprimée,
 *     l'idempotence Gmail/dépôts/partages reste intacte) ; c'est AUSSI le prédicat de convergence de la
 *     collecte (un doc re-traité — ou en quarantaine — n'est jamais re-collecté dans la même campagne).
 *  3. `ignorerDoublon` : l'empreinte du doc est déjà dans l'Index (il est classé !) — sans bypass du
 *     fast-path, chaque doc migré serait « doublon de lui-même » et TOUT le Drive partirait en `_Doublons`.
 *
 * Garde-fous : zone protégée exclue de la collecte ET revérifiée (strict) avant mutation — un refus est
 * inscrit `zone protégée` sous la clé de migration (le fichier n'est PAS touché, mais la campagne converge
 * au lieu de le re-collecter à chaque passe). Déplacement/renommage seul, jamais de suppression (§2).
 */

/* ---------- Décision PURE (testée) ---------- */

/**
 * Un fichier est à migrer s'il n'est ni Google natif/raccourci (pas de blob exploitable), ni déjà
 * re-traité dans CETTE campagne (clé `migre|<tag>|fileId` dans l'Index — convergence). Pas de filtre
 * par nom : la migration ré-évalue TOUT (ancienne convention, vrac résiduel, placement pré-entités).
 * @param {File} f  (interface : getId, getMimeType)
 * @param {string} tag  campagne courante (CONFIG.MIGRATION_TAG)
 * @return {boolean}
 */
function estAMigrer_(f, tag) {
  var mime = f.getMimeType() || '';
  if (mime.indexOf('application/vnd.google-apps') === 0) return false; // natif ou raccourci
  return !indexContient_('migre|' + tag + '|' + f.getId());
}

/* ---------- Campagne (gatée par tag, une page par tick) ---------- */

/**
 * Applique une page de migration si la campagne courante n'est pas terminée. Appelé à chaque tick
 * (enveloppé + budget-gaté par l'appelant), APRÈS l'intake : le flux vivant garde la priorité.
 * Attend la fin du grand rangement (une seule campagne de masse à la fois — sinon les deux se
 * marcheraient dessus sur les mêmes arbres).
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerMigrationTaxonomie_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_MIGRATION') === CONFIG.MIGRATION_TAG) return; // campagne déjà terminée
  if (!rangementTermine_()) return; // le grand rangement d'abord (même famille d'arbres)
  if (estBudgetDepasse()) return;

  // SOUS-budget propre à la migration (en plus du garde-temps du tick) : sans lui, chaque tick de
  // campagne consommerait ~tout BUDGET_MS en OCR+LLM et le quota JOURNALIER d'exécution des triggers
  // (~90 min/jour, compte gratuit) tomberait en quelques heures — plus d'intake le reste de la journée.
  // Borné à MIGRATION_BUDGET_MS, la campagne s'étale mais l'intake vivant garde son quota quotidien.
  var debutMigration = Date.now();
  var garde = function () {
    return estBudgetDepasse() || (Date.now() - debutMigration) > CONFIG.MIGRATION_BUDGET_MS;
  };

  var r = migrerUnePage_(garde, ensembleDomainesProteges_());
  if (r.traites) {
    journalInfo_('Migration', r.traites + ' document(s) re-classé(s) vers la nouvelle taxonomie (campagne « ' +
      CONFIG.MIGRATION_TAG + ' »).');
  }
  // Terminé SEULEMENT quand une passe complète (non interrompue, sans erreur) ne collecte plus rien.
  if (!r.reste && r.collectes === 0) {
    props.setProperty('DriveAI_MIGRATION', CONFIG.MIGRATION_TAG);
    journalInfo_('Migration', 'Migration vers la nouvelle taxonomie terminée (tag « ' + CONFIG.MIGRATION_TAG + ' »).');
  }
}

/**
 * Une page de migration : collecte jusqu'à `MIGRATION_MAX_PAR_RUN` documents à re-traiter dans les
 * domaines fixes NON protégés, puis les repasse au pipeline. Même discipline anti-« faux terminé »
 * que le rangement (cf. P1-17) : une collecte en erreur force `reste = true`.
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {{traites:number, collectes:number, reste:boolean}}
 */
function migrerUnePage_(estBudgetDepasse, proteges) {
  var ids = [];
  var erreurCollecte = false;

  // Domaines FIXES non protégés seulement. Les domaines AUTO (07·Santé) sont nés du pipeline
  // post-refonte : leur contenu est déjà à la nouvelle taxonomie (et `getFolderById(undefined)`
  // lèverait — même piège que le rangement, cf. P1-17). `_Doublons`/`_Technique`/files d'attente
  // ne sont pas des domaines : jamais parcourus.
  var domaines = Object.keys(CONFIG.DOMAINES);
  for (var d = 0; d < domaines.length && ids.length < CONFIG.MIGRATION_MAX_PAR_RUN; d++) {
    if (estBudgetDepasse()) break;
    var dom = domaines[d];
    if (CONFIG.DOMAINES_PROTEGES.indexOf(dom) !== -1) continue; // zone protégée : intouchée
    try {
      collecterAMigrer_(DriveApp.getFolderById(CONFIG.DOMAINES[dom]), ids, CONFIG.MIGRATION_MAX_PAR_RUN, estBudgetDepasse);
    } catch (e) {
      erreurCollecte = true;
      journalErreur_('Migration', 'Domaine inaccessible (' + dom + ') : ' + e);
    }
  }

  var interrompue = estBudgetDepasse();
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { interrompue = true; break; }
    // Try PAR ITEM (ceinture-bretelles) : un item empoisonné ne doit jamais avorter le reste de la
    // page — sinon les fichiers collectés APRÈS lui sont affamés à chaque tick (même ordre de collecte).
    try {
      if (migrerFichier_(ids[i], proteges)) n++;
    } catch (e) {
      journalErreur_('Migration', 'Item sauté (' + ids[i] + ') : ' + e);
    }
  }

  return {
    traites: n,
    collectes: ids.length,
    reste: interrompue || erreurCollecte || ids.length >= CONFIG.MIGRATION_MAX_PAR_RUN
  };
}

/**
 * Collecte récursive des fichiers à migrer d'un dossier (IDs seuls — le déplacement pendant
 * l'itération invaliderait l'itérateur). Un fichier illisible ne doit JAMAIS avorter la collecte
 * (cf. incident r2/P1-17) : sauté, les autres continuent.
 * @param {Folder} dossier
 * @param {string[]} ids  accumulateur
 * @param {number} max
 * @param {function():boolean} estBudgetDepasse
 */
function collecterAMigrer_(dossier, ids, max, estBudgetDepasse) {
  var fi = dossier.getFiles();
  while (fi.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    var f = fi.next();
    try {
      if (estAMigrer_(f, CONFIG.MIGRATION_TAG)) ids.push(f.getId());
    } catch (e) {
      journalErreur_('Migration', 'Fichier ignoré à la collecte (' + e + ')');
    }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    collecterAMigrer_(fo.next(), ids, max, estBudgetDepasse);
  }
}

/**
 * Re-passe UN document classé au pipeline complet. Défense en profondeur (§1) : la zone protégée
 * est revérifiée en STRICT juste avant — un fichier multi-parents accroché à `04 · Immigration`
 * n'est JAMAIS touché ; on l'inscrit « zone protégée » sous la clé de migration pour que la
 * campagne converge (sinon il serait re-collecté à chaque passe, à vie).
 * Le nom COURANT (`AAAA-MM-JJ_Type_Émetteur`) est passé au LLM : c'est un excellent signal
 * (deviner-du-nom, chantier #3). Blob téléchargé 1× (mémoïsé), comme pour les partages.
 * @param {string} fileId
 * @param {Object} proteges
 * @return {boolean} vrai si le document a été soumis au pipeline.
 */
function migrerFichier_(fileId, proteges) {
  var cle = 'migre|' + CONFIG.MIGRATION_TAG + '|' + fileId;
  var f, nom, parentId, taille, date;
  try {
    f = DriveApp.getFileById(fileId);
    nom = f.getName();
    if (aParentProtege_(f, proteges, true)) { // STRICT : abstention si indéterminable (jamais détacher, §1)
      indexAjouter_(cle, { statut: 'zone protégée', nom: nom, domaine: '', chemin: '' }, '');
      journalInfo_('Migration', 'Fichier en zone protégée ignoré (non touché) : ' + nom);
      return false;
    }
    var parents = f.getParents();
    parentId = parents.hasNext() ? parents.next().getId() : '';
    // TOUTES les lectures de métadonnées restent DANS le try : un fichier devenu illisible entre la
    // collecte et ici doit être sauté (journalisé), jamais avorter la page ni bloquer la campagne.
    taille = f.getSize();
    date = f.getLastUpdated();
  } catch (e) {
    // Passe par la QUARANTAINE (compteur d'échecs) et non un simple log : un doc durablement
    // illisible finirait sinon re-collecté à chaque passe, à vie — `collectes` ne retomberait
    // jamais à 0 et la campagne ne se figerait JAMAIS (même filet que les échecs pipeline).
    gererEchec_({ cle: cle, nom: nom || fileId }, 'document illisible (migration) : ' + e);
    return false;
  }

  var blobMemo = null;
  function blobUneFois_() {
    if (blobMemo === null) blobMemo = f.getBlob();
    return blobMemo;
  }
  traiterDocument_({
    cle: cle,
    nom: nom,
    taille: taille,
    expediteur: '',
    sujet: 'Reclassement (migration taxonomie)',
    date: date,
    ignorerDoublon: true, // son empreinte est déjà dans l'Index (il est classé) — pas « doublon de lui-même »
    blob: blobUneFois_,
    placer: function (dossierId, nouveauNom) {
      if (dossierId === parentId) return renommer_(fileId, nouveauNom) ? fileId : ''; // déjà au bon endroit
      return deplacerEtRenommer_(fileId, dossierId, parentId, nouveauNom) ? fileId : '';
    }
  });
  return true;
}
