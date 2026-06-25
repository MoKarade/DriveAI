/**
 * DriveRest.gs — Opérations Drive via l'API REST (UrlFetchApp), Phase 2.
 *
 * On passe par REST (et pas le « service avancé Drive ») pour la même raison que
 * l'OCR : robustesse après `clasp push`, sans activation manuelle (cf. LESSONS).
 * Scopes utilisés : drive + script.external_request (déjà déclarés).
 *
 * Garde-fous : ces helpers DÉPLACENT ou créent des RACCOURCIS — jamais de
 * suppression d'un fichier utilisateur (un déplacement n'est pas une suppression).
 */

/** @return {string} jeton OAuth du script (compte de Marc). */
function jetonDrive_() {
  return ScriptApp.getOAuthToken();
}

/**
 * Appel Drive REST avec un retry léger borné sur erreurs transitoires (429, 5xx).
 * Évite qu'un pic de quota fasse échouer un placement et déclenche un re-OCR +
 * re-LLM complet au tick suivant.
 * @param {string} url
 * @param {Object} options
 * @return {HTTPResponse}
 */
function fetchDriveAvecRetry_(url, options) {
  var rep = UrlFetchApp.fetch(url, options);
  var code = rep.getResponseCode();
  if (code === 429 || (code >= 500 && code < 600)) {
    Utilities.sleep(1000);
    rep = UrlFetchApp.fetch(url, options);
  }
  return rep;
}

/**
 * Déplace un fichier vers un nouveau parent et le renomme, en un seul appel.
 * Le déplacement préserve l'ID Drive (donc la clé d'idempotence reste valable).
 *
 * @param {string} fileId        fichier à déplacer
 * @param {string} nouveauParent dossier cible
 * @param {string} ancienParent  dossier d'origine (retiré des parents)
 * @param {string} nouveauNom    nouveau nom du fichier
 * @return {boolean} vrai si le déplacement a réussi.
 */
function deplacerEtRenommer_(fileId, nouveauParent, ancienParent, nouveauNom) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?addParents=' + encodeURIComponent(nouveauParent) +
    '&removeParents=' + encodeURIComponent(ancienParent) +
    '&fields=id';
  var rep = fetchDriveAvecRetry_(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ name: nouveauNom }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Déplacement HTTP ' + rep.getResponseCode() + ' : ' +
    tronquer_(rep.getContentText(), 300));
  return false;
}

/**
 * Crée un raccourci Drive vers un fichier, dans un dossier donné.
 * Sert au multi-entités (jamais de copie physique).
 *
 * @param {string} cibleId  fichier réel pointé
 * @param {string} parentId dossier où poser le raccourci
 * @param {string} nom      nom du raccourci
 * @return {boolean} vrai si le raccourci a été créé.
 */
function creerRaccourci_(cibleId, parentId, nom) {
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      name: nom,
      mimeType: 'application/vnd.google-apps.shortcut',
      parents: [parentId],
      shortcutDetails: { targetId: cibleId }
    }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Raccourci HTTP ' + rep.getResponseCode() + ' : ' +
    tronquer_(rep.getContentText(), 300));
  return false;
}
