/**
 * Maintenance.gs — Utilitaires à exécuter À LA MAIN (pas dans le pipeline auto).
 *
 * Ces fonctions ne sont jamais appelées par le trigger : elles servent aux
 * opérations ponctuelles de maintenance (ex. rejouer la file de revue après un
 * recalibrage du classement).
 */

/**
 * Rejoue les documents partis en revue avec les réglages COURANTS.
 *
 * À lancer une seule fois (clic « Exécuter ») après un recalibrage. Concrètement :
 *   1. pour chaque copie « [REVUE] … » du dossier 00·À vérifier, selon sa SOURCE
 *      (lue dans l'Index) :
 *        - PJ Gmail  → mise à la corbeille (réversible) ; l'ORIGINAL est dans Gmail ;
 *        - dépôt manuel → l'« original » a été DÉPLACÉ ici, donc on le RENVOIE dans
 *          00·À trier pour qu'il soit re-trié (jamais de corbeille → aucune perte) ;
 *        - source inconnue → laissé en place par prudence ;
 *   2. vide les onglets Index et Revue (garde les en-têtes) ;
 *   3. relance le pipeline, qui re-traite les PJ Gmail et les dépôts renvoyés.
 *
 * Garde-fou : on ne met JAMAIS à la corbeille un fichier dont l'unique exemplaire
 * est ici (dépôt manuel déplacé). Le pipeline automatique, lui, ne supprime jamais
 * de fichier utilisateur.
 */
function rejouerLaRevue() {
  var source = sourceParNomRevue_(); // nom de fichier « [REVUE] … » → 'gmail' | 'drive'

  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER);
  var it = dossier.getFiles();
  var corbeille = 0, renvoyes = 0, laisses = 0;
  while (it.hasNext()) {
    var f = it.next();
    var nom = f.getName();
    if (nom.indexOf('[REVUE]') !== 0) continue;

    var s = source[nom];
    if (s === 'gmail') {
      f.setTrashed(true); // copie créée par nous, original dans Gmail → rejouable sans perte
      corbeille++;
    } else if (s === 'drive') {
      // Original déposé manuellement (déplacé ici) : on le renvoie pour rejeu, jamais corbeille.
      deplacerEtRenommer_(f.getId(), CONFIG.DOSSIERS.A_TRIER, CONFIG.DOSSIERS.A_VERIFIER, nom);
      renvoyes++;
    } else {
      laisses++; // source inconnue → on ne touche à rien (prudence : pas de suppression)
    }
  }
  journalInfo_('Maintenance', corbeille + ' copie(s) Gmail à la corbeille, ' +
    renvoyes + ' dépôt(s) renvoyé(s) dans 00·À trier, ' + laisses + ' laissé(s) en place.');

  viderOnglet_('Index');
  viderOnglet_('Revue');
  journalInfo_('Maintenance', 'Index et Revue vidés — rejeu du pipeline.');

  tickDriveAI();
}

/**
 * Cartographie « nom de fichier en revue » → source, d'après l'Index.
 * La clé d'un dépôt manuel commence par « drive| » ; sinon c'est une PJ Gmail.
 * @return {Object} { nomFichier: 'gmail' | 'drive' }
 */
function sourceParNomRevue_() {
  var f = feuille_('Index');
  var map = {};
  var dern = f.getLastRow();
  if (dern < 2) return map;
  var v = f.getRange(2, 1, dern - 1, 6).getValues(); // A=Clé … C=Fichier … F=Statut
  for (var i = 0; i < v.length; i++) {
    var cle = v[i][0], fichier = v[i][2], statut = v[i][5];
    if (statut !== 'revue' || !fichier) continue;
    if (map[fichier] === 'drive') continue; // 'drive' (exemplaire unique) prime → jamais corbeille
    map[fichier] = (String(cle).indexOf('drive|') === 0) ? 'drive' : 'gmail';
  }
  return map;
}

/**
 * Vide les lignes de données d'un onglet (conserve la ligne d'en-tête).
 * @param {string} nom
 */
function viderOnglet_(nom) {
  var f = feuille_(nom);
  var dernLigne = f.getLastRow();
  var dernCol = f.getLastColumn();
  if (dernLigne > 1 && dernCol > 0) {
    f.getRange(2, 1, dernLigne - 1, dernCol).clearContent();
  }
}

/* ============================================================================
 * GRAND RANGEMENT — réorganiser tout le contenu existant des domaines.
 * ==========================================================================*/

/**
 * Passe tout le contenu DÉJÀ présent dans les 7 domaines à travers le pipeline.
 *
 * Pour chaque fichier « en vrac » (nom NON encore au format `AAAA-MM-JJ_…`), on le
 * DÉPLACE vers `00·À trier` (réversible) ; l'intake le reprend ensuite (OCR → analyse
 * approfondie → renommage → classement au bon endroit + sous-dossiers créés au besoin).
 *
 * Garde-fous (réutilise tout le pipeline, donc tous ses garde-fous) :
 *   - DÉPLACEMENT seul, JAMAIS de suppression (le fichier reste dans le Drive) ;
 *   - `04 · Immigration` (zone protégée) n'est JAMAIS parcourue ; et — garde-fou §1 —
 *     tout fichier ayant ne serait-ce qu'UN parent dans (ou sous) un domaine protégé est
 *     ÉCARTÉ : on ne le déplace pas, pour ne jamais le détacher de la zone protégée (cas
 *     d'un fichier multi-parents). Tout doc jugé `sensible` au re-traitement repart en revue ;
 *   - fichiers déjà normalisés (`AAAA-MM-JJ_…`) et fichiers Google natifs : SAUTÉS
 *     (idempotent → relancer ne re-coûte rien, pas de churn) ;
 *   - borné par le garde-temps partagé (coupure 6 min) ET par run (`RANGEMENT_MAX_PAR_RUN`) :
 *     si la collecte est interrompue ou le plafond atteint, le Journal le dit → relancer
 *     `rangerToutLeDrive()`. L'archive `_Archive 2025` n'est pas concernée.
 *
 * Déclenché AUTOMATIQUEMENT (zéro clic) au déploiement via `CONFIG.RANGEMENT_TAG`
 * (cf. Main.appliquerRangementInitial_), et reste lançable À LA MAIN pour un re-run ponctuel.
 * Coût : OCR + LLM sur chaque fichier en vrac (one-shot, réparti sur plusieurs ticks).
 */
function rangerToutLeDrive() {
  try {
    var debut = Date.now();
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var r = rangerUnePage_(estBudgetDepasse, ensembleDomainesProteges_());
    journalInfo_('Rangement', r.deplaces + ' fichier(s) en vrac renvoyé(s) dans 00·À trier pour reclassement' +
      (r.reste ? ' (interrompu/plafond — relance rangerToutLeDrive()).' : '.'));

    // Amorce le re-traitement SEULEMENT s'il reste du budget : tickDriveAI() repart sur son
    // propre budget de 4.5 min ; l'enchaîner après un rangement déjà long dépasserait la limite
    // dure de 6 min d'Apps Script. Sinon, les fichiers sont déjà dans 00·À trier → le trigger reprend.
    if (r.deplaces && !estBudgetDepasse()) tickDriveAI();
  } catch (e) {
    notifierEchec_('Rangement', 'Grand rangement interrompu : ' + e);
  }
}

/**
 * UNE passe bornée du grand rangement : collecte (lecture seule) jusqu'à `RANGEMENT_MAX_PAR_RUN`
 * fichiers en vrac dans les domaines NON protégés, puis les DÉPLACE vers `00·À trier`. Tout est
 * borné par le garde-temps + le plafond/run, et reprenable (déplacement seul, idempotent au format).
 * Partagé entre le lancement manuel (`rangerToutLeDrive`) et l'auto (`appliquerRangementInitial_`).
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {{deplaces:number, collectes:number, reste:boolean}}
 */
function rangerUnePage_(estBudgetDepasse, proteges) {
  var ids = [];
  var domaines = domainesAutorises_();
  for (var d = 0; d < domaines.length && ids.length < CONFIG.RANGEMENT_MAX_PAR_RUN; d++) {
    if (estBudgetDepasse()) break;
    var dom = domaines[d];
    if (CONFIG.DOMAINES_PROTEGES.indexOf(dom) !== -1) continue; // zone protégée : intouchée
    collecterAReclasser_(
      DriveApp.getFolderById(CONFIG.DOMAINES[dom]), ids, CONFIG.RANGEMENT_MAX_PAR_RUN, estBudgetDepasse, proteges);
  }
  var collecteInterrompue = estBudgetDepasse();

  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { collecteInterrompue = true; break; }
    if (deplacerVersATrier_(ids[i], proteges)) n++;
  }
  return {
    deplaces: n,
    collectes: ids.length,
    reste: collecteInterrompue || ids.length >= CONFIG.RANGEMENT_MAX_PAR_RUN
  };
}

/**
 * Parcourt récursivement un dossier et collecte les IDs des fichiers à reclasser.
 * Lecture seule (aucun déplacement ici → pas d'invalidation d'itérateur). Borné par le
 * garde-temps : sur un gros Drive, la collecte s'arrête proprement et reprend au prochain run.
 * @param {Folder} dossier
 * @param {string[]} ids  accumulateur
 * @param {number} max
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 */
function collecterAReclasser_(dossier, ids, max, estBudgetDepasse, proteges) {
  var fi = dossier.getFiles();
  while (fi.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    var f = fi.next();
    if (estAReclasser_(f, proteges)) ids.push(f.getId());
  }
  var fo = dossier.getFolders();
  while (fo.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    collecterAReclasser_(fo.next(), ids, max, estBudgetDepasse, proteges);
  }
}

/**
 * Un fichier est « à reclasser » s'il n'est PAS déjà au format normalisé, n'est pas un
 * fichier Google natif (Docs/Sheets/Slides — pas de blob exploitable) ni un raccourci, et
 * n'a AUCUN parent dans (ou sous) un domaine protégé (garde-fou §1 : ne jamais détacher de
 * la zone protégée un fichier multi-parents).
 * @param {File} f
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {boolean}
 */
function estAReclasser_(f, proteges) {
  if (/^\d{4}-\d{2}-\d{2}_/.test(f.getName())) return false; // déjà rangé/renommé
  var mime = f.getMimeType() || '';
  if (mime.indexOf('application/vnd.google-apps') === 0) return false; // natif ou raccourci
  if (aParentProtege_(f, proteges)) return false; // un parent en zone protégée → on n'y touche pas
  return true;
}

/**
 * Déplace un fichier (par ID) vers `00·À trier` : ajoute le dossier cible puis retire les
 * parents actuels. JAMAIS de suppression — le fichier reste dans le Drive, à un seul endroit.
 *
 * Sécurité (défense en profondeur, garde-fou §1) : on REVÉRIFIE qu'aucun parent n'est en zone
 * protégée juste avant de muter ; si c'est le cas on s'abstient (ne rien ajouter/retirer) pour
 * ne jamais détacher un fichier de `04 · Immigration`.
 * @param {string} fileId
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {boolean} vrai si déplacé.
 */
function deplacerVersATrier_(fileId, proteges) {
  try {
    var f = DriveApp.getFileById(fileId);
    if (aParentProtege_(f, proteges)) {
      journalInfo_('Rangement', 'Fichier en zone protégée ignoré (non déplacé) : ' + fileId);
      return false;
    }
    var cibleId = CONFIG.DOSSIERS.A_TRIER;
    var cible = DriveApp.getFolderById(cibleId);
    cible.addFile(f); // ajoute la cible AVANT de retirer (jamais orphelin)
    var parents = f.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (p.getId() !== cibleId) p.removeFile(f); // retire l'ancien parent (pas une suppression)
    }
    return true;
  } catch (e) {
    journalErreur_('Rangement', 'Déplacement impossible (' + fileId + ') : ' + e);
    return false;
  }
}

/**
 * Ensemble des IDs de dossiers racines des domaines protégés (garde-fou §1).
 * @return {Object} { idDossier: true }
 */
function ensembleDomainesProteges_() {
  var set = {};
  CONFIG.DOMAINES_PROTEGES.forEach(function (dom) {
    var id = CONFIG.DOMAINES[dom];
    if (id) set[id] = true;
  });
  return set;
}

/**
 * Vrai si le fichier a au moins un parent qui EST, ou DESCEND de, un domaine protégé.
 * Remonte toute la chaîne d'ancêtres (multi-parents inclus), bornée en profondeur.
 * @param {File} f
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {boolean}
 */
function aParentProtege_(f, proteges) {
  var parents = f.getParents();
  while (parents.hasNext()) {
    if (chaineMonteVersProtege_(parents.next(), proteges, 0)) return true;
  }
  return false;
}

/**
 * Remonte récursivement les parents d'un dossier jusqu'à trouver une racine protégée
 * (ou épuisement). Bornée à 50 niveaux (sécurité anti-cycle/profondeur).
 * @param {Folder} dossier
 * @param {Object} proteges
 * @param {number} profondeur
 * @return {boolean}
 */
function chaineMonteVersProtege_(dossier, proteges, profondeur) {
  if (!dossier || profondeur > 50) return false;
  if (proteges[dossier.getId()]) return true;
  var ps = dossier.getParents();
  while (ps.hasNext()) {
    if (chaineMonteVersProtege_(ps.next(), proteges, profondeur + 1)) return true;
  }
  return false;
}
