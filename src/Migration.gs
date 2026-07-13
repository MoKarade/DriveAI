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
 * Un fichier est à migrer s'il porte « Inconnu » dans son NOM (héritage v1 — plan C28-21 : sous le
 * mur des ~90 min/j de runtime, le périmètre est RÉDUIT au vrai problème ; c26-08 rattrape ensuite
 * les mal-classés bien nommés de 03/08), s'il n'est ni Google natif/raccourci (pas de blob
 * exploitable), ni déjà re-traité dans CETTE campagne (clé `migre|<tag>|fileId` — convergence).
 * @param {File} f  (interface : getId, getMimeType, getName)
 * @param {string} tag  campagne courante (CONFIG.MIGRATION_TAG)
 * @return {boolean}
 */
function estAMigrer_(f, tag) {
  var mime = f.getMimeType() || '';
  if (mime.indexOf('application/vnd.google-apps') === 0) return false; // natif ou raccourci
  if ((f.getName() || '').toLowerCase().indexOf('inconnu') === -1) return false; // hors périmètre m2
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

  // Nouveau tag = nouvelle campagne → barre VIERGE (leçon §7 « le seuil va dans la clé » : sans ce
  // reset, une future m2 hériterait de la barre figée à 100 % de m1 et sauterait son recensement).
  if (props.getProperty('DriveAI_MIGRATION_BARRE_TAG') !== CONFIG.MIGRATION_TAG) {
    props.deleteProperty('DriveAI_MIGRATION_BASE');
    props.deleteProperty('DriveAI_MIGRATION_TRAITES');
    props.deleteProperty('DriveAI_MIGRATION_RECENS');
    props.setProperty('DriveAI_MIGRATION_BARRE_TAG', CONFIG.MIGRATION_TAG);
  }

  // PHASE RECENSEMENT (C28-18, leçon « barre de masse ») : la BASE de la barre se pose dans des
  // ticks DÉDIÉS (ce tick ne migre pas — un comptage en concurrence du traitement ne finirait
  // jamais). Filet : après RANGEMENT_RECENS_ESSAIS_MAX passes incomplètes, le compte PARTIEL est
  // accepté — la campagne n'est JAMAIS bloquée par sa barre (re-base + finalisation corrigent).
  if (props.getProperty('DriveAI_MIGRATION_BASE') === null) {
    var essaisRecens = Number(props.getProperty('DriveAI_MIGRATION_RECENS')) || 0;
    var rec = compterRestantMigration_(garde);
    if (!rec.complet && essaisRecens + 1 < CONFIG.RANGEMENT_RECENS_ESSAIS_MAX) {
      props.setProperty('DriveAI_MIGRATION_RECENS', String(essaisRecens + 1)); // partiel → réessai
      return;
    }
    props.setProperty('DriveAI_MIGRATION_BASE', String(rec.n || 0)); // complet, ou partiel accepté
    props.setProperty('DriveAI_MIGRATION_TRAITES', '0');
    props.deleteProperty('DriveAI_MIGRATION_RECENS'); // compteur d'essais soldé avec le recensement
    return; // tick dédié : la migration reprend au tick suivant
  }

  var r = migrerUnePage_(garde, ensembleDomainesProteges_());
  if (r.traites) {
    majCompteurCampagne_('DriveAI_MIGRATION', r.traites); // barre (C28-18) — Properties seules
    journalInfo_('Migration', r.traites + ' document(s) re-classé(s) vers la nouvelle taxonomie (campagne « ' +
      CONFIG.MIGRATION_TAG + ' »).');
  }
  // Terminé SEULEMENT quand une passe complète (non interrompue, sans erreur) ne collecte plus rien.
  if (!r.reste && r.collectes === 0) {
    props.setProperty('DriveAI_MIGRATION', CONFIG.MIGRATION_TAG);
    finaliserCompteurCampagne_('DriveAI_MIGRATION'); // barre à 100 % sur le VRAI signal de fin
    journalInfo_('Migration', 'Migration vers la nouvelle taxonomie terminée (tag « ' + CONFIG.MIGRATION_TAG + ' »).');
  }
}

/**
 * Recense (compte, sans rien toucher) les documents RESTANT à migrer — même périmètre exact que
 * `migrerUnePage_` (domaines fixes non protégés, hors cibles C26-08), même prédicat `estAMigrer_`
 * (léger : mime + lookup O(1) sur le cache Index). Borné par le garde (sous-budget migration).
 * @param {function():boolean} estBudgetDepasse
 * @return {{n:number, complet:boolean}}
 */
function compterRestantMigration_(estBudgetDepasse) {
  var etat = { n: 0, complet: true };
  var domaines = Object.keys(CONFIG.DOMAINES);
  for (var d = 0; d < domaines.length; d++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    var dom = domaines[d];
    if (CONFIG.DOMAINES_PROTEGES.indexOf(dom) !== -1) continue;
    if ((CONFIG.REANALYSE_CIBLES || []).indexOf(dom) !== -1) continue;
    try {
      compterCampagneDossier_(DriveApp.getFolderById(CONFIG.DOMAINES[dom]), etat, estBudgetDepasse,
        function (f) { return estAMigrer_(f, CONFIG.MIGRATION_TAG); });
    } catch (e) {
      etat.complet = false; // domaine illisible → compte non fiable, on réessaiera (ou filet partiel)
    }
  }
  return etat;
}

/**
 * Recense les documents RESTANT à re-analyser (C26-08) — même périmètre que `reanalyserUnePage_`
 * (les seuls domaines de REANALYSE_CIBLES), même prédicat `estAReanalyser_`.
 * @param {function():boolean} estBudgetDepasse
 * @return {{n:number, complet:boolean}}
 */
function compterRestantReanalyse_(estBudgetDepasse) {
  var etat = { n: 0, complet: true };
  var cibles = CONFIG.REANALYSE_CIBLES;
  for (var d = 0; d < cibles.length; d++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    if (CONFIG.DOMAINES_PROTEGES.indexOf(cibles[d]) !== -1) continue; // défense en profondeur
    try {
      compterCampagneDossier_(DriveApp.getFolderById(CONFIG.DOMAINES[cibles[d]]), etat, estBudgetDepasse,
        function (f) { return estAReanalyser_(f, CONFIG.REANALYSE_TAG); });
    } catch (e) {
      etat.complet = false;
    }
  }
  return etat;
}

/**
 * Compte récursif des fichiers d'un dossier qui matchent `predicat` (lecture seule, borné —
 * même squelette que `compterVracDossier_` du rangement). Un fichier illisible n'est pas compté
 * et n'avorte jamais le comptage.
 * @param {Folder} dossier
 * @param {{n:number, complet:boolean}} etat  muté en place
 * @param {function():boolean} estBudgetDepasse
 * @param {function(File):boolean} predicat
 */
function compterCampagneDossier_(dossier, etat, estBudgetDepasse, predicat) {
  if (etat.n > 20000) { etat.complet = false; return; } // plafond dur de sécurité
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse()) { etat.complet = false; return; }
    try { if (predicat(fi.next())) etat.n++; } catch (e) { /* illisible : pas compté */ }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse()) { etat.complet = false; return; }
    compterCampagneDossier_(fo.next(), etat, estBudgetDepasse, predicat);
    if (!etat.complet) return;
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
    // Territoires C26-08 (ADR-0018) : ces domaines sont re-analysés en V2 par la campagne dédiée —
    // les laisser à m1 paierait DEUX analyses (v1 puis v2) sur les mêmes fichiers.
    if ((CONFIG.REANALYSE_CIBLES || []).indexOf(dom) !== -1) continue;
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

/* ---------- C26-08 (ADR-0018) : campagne de RE-ANALYSE v2 CIBLÉE ---------- */

/**
 * Un fichier est à re-analyser s'il n'est ni Google natif/raccourci, ni déjà re-traité dans CETTE
 * campagne (clé `reanalyse|<tag>|fileId` — convergence). Pas de filtre par nom : les documents des
 * domaines ciblés sont DÉJÀ au format `AAAA-MM-JJ_…` (le prédicat du grand rangement ne s'applique
 * pas), c'est la clé de campagne SEULE qui porte la convergence.
 * @param {File} f  (interface : getId, getMimeType)
 * @param {string} tag  campagne courante (CONFIG.REANALYSE_TAG)
 * @return {boolean}
 */
function estAReanalyser_(f, tag) {
  var mime = f.getMimeType() || '';
  if (mime.indexOf('application/vnd.google-apps') === 0) return false; // natif ou raccourci
  return !indexContient_('reanalyse|' + tag + '|' + f.getId());
}

/**
 * Applique une page de re-analyse v2 si la campagne n'est pas terminée. Appelé à chaque tick
 * (enveloppé + budget-gaté par l'appelant), APRÈS la migration : UNE SEULE campagne de masse à la
 * fois — C26-08 ne démarre qu'après la FIN de m1 (Property `DriveAI_MIGRATION` posée), sinon les
 * deux collecteurs se marcheraient dessus et paieraient double sur les arbres partagés.
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerReanalyseCiblee_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_REANALYSE') === CONFIG.REANALYSE_TAG) return; // campagne déjà terminée
  if (!rangementTermine_()) return; // le grand rangement d'abord (même famille d'arbres)
  if (props.getProperty('DriveAI_MIGRATION') !== CONFIG.MIGRATION_TAG) return; // m1 d'abord (une campagne à la fois)
  if (estBudgetDepasse()) return;

  // SOUS-budget propre (même raison que MIGRATION_BUDGET_MS) : sans lui, chaque tick de campagne
  // consommerait ~tout le budget en OCR + Sonnet ×2 et épuiserait le quota JOURNALIER des triggers.
  var debutReanalyse = Date.now();
  var garde = function () {
    return estBudgetDepasse() || (Date.now() - debutReanalyse) > CONFIG.REANALYSE_BUDGET_MS;
  };

  // Nouveau tag = nouvelle campagne → barre VIERGE (même patron BARRE_TAG que m1/rangement).
  if (props.getProperty('DriveAI_REANALYSE_BARRE_TAG') !== CONFIG.REANALYSE_TAG) {
    props.deleteProperty('DriveAI_REANALYSE_BASE');
    props.deleteProperty('DriveAI_REANALYSE_TRAITES');
    props.deleteProperty('DriveAI_REANALYSE_RECENS');
    props.setProperty('DriveAI_REANALYSE_BARRE_TAG', CONFIG.REANALYSE_TAG);
  }

  // PHASE RECENSEMENT (C28-18) : même mécanique que m1 — ticks dédiés, filet du compte partiel.
  if (props.getProperty('DriveAI_REANALYSE_BASE') === null) {
    var essaisRecens = Number(props.getProperty('DriveAI_REANALYSE_RECENS')) || 0;
    var rec = compterRestantReanalyse_(garde);
    if (!rec.complet && essaisRecens + 1 < CONFIG.RANGEMENT_RECENS_ESSAIS_MAX) {
      props.setProperty('DriveAI_REANALYSE_RECENS', String(essaisRecens + 1)); // partiel → réessai
      return;
    }
    props.setProperty('DriveAI_REANALYSE_BASE', String(rec.n || 0)); // complet, ou partiel accepté
    props.setProperty('DriveAI_REANALYSE_TRAITES', '0');
    props.deleteProperty('DriveAI_REANALYSE_RECENS'); // compteur d'essais soldé avec le recensement
    return; // tick dédié : la re-analyse reprend au tick suivant
  }

  var r = reanalyserUnePage_(garde, ensembleDomainesProteges_());
  if (r.traites) {
    majCompteurCampagne_('DriveAI_REANALYSE', r.traites); // barre (C28-18) — Properties seules
    journalInfo_('Réanalyse', r.traites + ' document(s) soumis à la re-analyse v2 (campagne « ' +
      CONFIG.REANALYSE_TAG + ' »).');
  }
  // Terminé SEULEMENT quand une passe complète (non interrompue, sans erreur) ne collecte plus rien.
  if (!r.reste && r.collectes === 0) {
    props.setProperty('DriveAI_REANALYSE', CONFIG.REANALYSE_TAG);
    finaliserCompteurCampagne_('DriveAI_REANALYSE'); // barre à 100 % sur le VRAI signal de fin
    journalInfo_('Réanalyse', 'Re-analyse v2 ciblée terminée (tag « ' + CONFIG.REANALYSE_TAG + ' »).');
  }
}

/**
 * Une page de re-analyse : collecte jusqu'à `MIGRATION_MAX_PAR_RUN` documents (même unité de coût :
 * OCR + LLM lourds) dans les SEULS domaines de `REANALYSE_CIBLES`, puis les repasse au pipeline v2.
 * Même discipline anti-« faux terminé » que la migration : une collecte en erreur force `reste = true`.
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {{traites:number, collectes:number, reste:boolean}}
 */
function reanalyserUnePage_(estBudgetDepasse, proteges) {
  var ids = [];
  var erreurCollecte = false;

  var cibles = CONFIG.REANALYSE_CIBLES;
  for (var d = 0; d < cibles.length && ids.length < CONFIG.MIGRATION_MAX_PAR_RUN; d++) {
    if (estBudgetDepasse()) break;
    var dom = cibles[d];
    if (CONFIG.DOMAINES_PROTEGES.indexOf(dom) !== -1) continue; // défense en profondeur (cibles fixes non protégées, verrouillé par test)
    try {
      collecterAReanalyser_(DriveApp.getFolderById(CONFIG.DOMAINES[dom]), ids, CONFIG.MIGRATION_MAX_PAR_RUN, estBudgetDepasse);
    } catch (e) {
      erreurCollecte = true;
      journalErreur_('Réanalyse', 'Domaine inaccessible (' + dom + ') : ' + e);
    }
  }

  var interrompue = estBudgetDepasse();
  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { interrompue = true; break; }
    // Try PAR ITEM : un item empoisonné ne doit jamais avorter le reste de la page (même ordre de
    // collecte à chaque tick → les suivants seraient affamés à vie).
    try {
      if (reanalyserFichier_(ids[i], proteges)) n++;
    } catch (e) {
      journalErreur_('Réanalyse', 'Item sauté (' + ids[i] + ') : ' + e);
    }
  }

  return {
    traites: n,
    collectes: ids.length,
    reste: interrompue || erreurCollecte || ids.length >= CONFIG.MIGRATION_MAX_PAR_RUN
  };
}

/**
 * Collecte récursive des fichiers à re-analyser d'un dossier (IDs seuls — le déplacement pendant
 * l'itération invaliderait l'itérateur). Un fichier illisible ne doit JAMAIS avorter la collecte :
 * sauté, les autres continuent.
 * @param {Folder} dossier
 * @param {string[]} ids  accumulateur
 * @param {number} max
 * @param {function():boolean} estBudgetDepasse
 */
function collecterAReanalyser_(dossier, ids, max, estBudgetDepasse) {
  var fi = dossier.getFiles();
  while (fi.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    var f = fi.next();
    try {
      if (estAReanalyser_(f, CONFIG.REANALYSE_TAG)) ids.push(f.getId());
    } catch (e) {
      journalErreur_('Réanalyse', 'Fichier ignoré à la collecte (' + e + ')');
    }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    collecterAReanalyser_(fo.next(), ids, max, estBudgetDepasse);
  }
}

/**
 * Re-passe UN document classé au pipeline v2. Défense en profondeur (§1) : la zone protégée est
 * revérifiée en STRICT juste avant — un fichier multi-parents accroché à `04 · Immigration` n'est
 * JAMAIS touché ; on l'inscrit « zone protégée » sous la clé de campagne pour que la collecte
 * converge. Le nom COURANT (déjà `AAAA-MM-JJ_Type_Émetteur`) est passé au LLM : excellent signal.
 * Blob téléchargé 1× (mémoïsé). Échec de PLATEFORME (panne de compte) : `traiterDocument_` échoue
 * SANS inscrire la clé — le document est re-soumis au tick suivant, jamais mis en quarantaine à tort.
 * @param {string} fileId
 * @param {Object} proteges
 * @return {boolean} vrai si le document a été soumis au pipeline.
 */
function reanalyserFichier_(fileId, proteges) {
  var cle = 'reanalyse|' + CONFIG.REANALYSE_TAG + '|' + fileId;
  var f, nom, parentId, taille, date;
  try {
    f = DriveApp.getFileById(fileId);
    nom = f.getName();
    if (aParentProtege_(f, proteges, true)) { // STRICT : abstention si indéterminable (jamais détacher, §1)
      indexAjouter_(cle, { statut: 'zone protégée', nom: nom, domaine: '', chemin: '' }, '');
      journalInfo_('Réanalyse', 'Fichier en zone protégée ignoré (non touché) : ' + nom);
      return false;
    }
    var parents = f.getParents();
    parentId = parents.hasNext() ? parents.next().getId() : '';
    // TOUTES les lectures de métadonnées restent DANS le try : un fichier devenu illisible entre la
    // collecte et ici doit être sauté (quarantaine), jamais avorter la page ni bloquer la campagne.
    taille = f.getSize();
    date = f.getLastUpdated();
  } catch (e) {
    // Quarantaine (compteur d'échecs) et non simple log : un doc durablement illisible serait sinon
    // re-collecté à chaque passe, à vie — `collectes` ne retomberait jamais à 0.
    gererEchec_({ cle: cle, nom: nom || fileId }, 'document illisible (re-analyse v2) : ' + e);
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
    sujet: 'Re-analyse v2 ciblée (C26-08)',
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
