/**
 * Intake.gs — Dépôt manuel : scan du dossier `00 · À trier` (Phase 2).
 *
 * Seconde source d'intake, à parité avec Gmail : chaque fichier déposé est
 * OCRisé, analysé et routé par le même pipeline (Pipeline.gs / Router.gs).
 *
 * Différence clé : un dépôt est explicitement là POUR être trié → on le DÉPLACE
 * (jamais de copie, jamais de suppression) vers sa destination finale. Le déplacement préserve l'ID Drive, donc la clé d'idempotence
 * `drive|fileId` reste valable et le fichier n'est pas re-traité.
 */

/**
 * Traite un lot de fichiers de `00 · À trier`.
 * @param {function():boolean} estBudgetDepasse  garde-temps partagé du run
 */
function traiterDepots_(estBudgetDepasse) {
  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);

  // On collecte d'abord les IDs (le déplacement pendant l'itération invaliderait l'itérateur).
  var it = dossier.getFiles();
  var ids = [];
  while (it.hasNext() && ids.length < CONFIG.INTAKE_PAGE) ids.push(it.next().getId());

  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) {
      journalInfo_('Intake', 'Budget temps atteint — reprise au prochain tick.');
      return;
    }
    traiterFichierDepose_(ids[i]);
  }
}

/**
 * Construit le descripteur d'un fichier déposé et le passe au pipeline.
 * Le `getFileById` et la lecture des métadonnées sont protégés : si Marc a
 * supprimé/déplacé le fichier entre la collecte des IDs et son traitement,
 * on journalise et on continue le lot (jamais d'arrêt brutal).
 * @param {string} fileId
 */
function traiterFichierDepose_(fileId) {
  var f, mime, nom;
  try {
    f = DriveApp.getFileById(fileId);
    mime = f.getMimeType();
    nom = f.getName();
  } catch (e) {
    journalErreur_('Intake', 'Fichier déposé illisible (' + fileId + ') : ' + e);
    return;
  }

  // Les fichiers Google natifs (Docs/Sheets/Slides déposés) n'ont pas de blob/octets
  // exploitables (getSize() = 0) → on les laisse en place plutôt que de mal les traiter.
  if (mime && mime.indexOf('application/vnd.google-apps') === 0) {
    journalInfo_('Intake', 'Fichier Google natif laissé dans 00·À trier : ' + nom);
    return;
  }

  var aTrier = CONFIG.DOSSIERS.A_TRIER;
  traiterDocument_({
    cle: 'drive|' + fileId, // l'ID Drive est unique et stable, y compris après déplacement/renommage
    nom: nom,
    taille: f.getSize(),
    expediteur: '',
    sujet: 'Dépôt manuel',
    date: f.getLastUpdated(),
    blob: function () { return f.getBlob(); },
    placer: function (dossierId, nouveauNom) {
      return deplacerEtRenommer_(fileId, dossierId, aTrier, nouveauNom) ? fileId : '';
    }
  });
}
