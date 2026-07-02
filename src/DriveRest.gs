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
 * Renomme un fichier SANS le déplacer (PATCH du nom seul). Sert à la migration (#8) quand la
 * destination calculée est le dossier COURANT : passer le même ID en addParents ET removeParents
 * serait ambigu côté API — ici on ne touche qu'au nom.
 * @param {string} fileId
 * @param {string} nouveauNom
 * @return {boolean} vrai si le renommage a réussi.
 */
function renommer_(fileId, nouveauNom) {
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=id', {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify({ name: nouveauNom }),
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Drive', 'Renommage HTTP ' + rep.getResponseCode() + ' : ' +
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
  // Idempotent : si un raccourci vers la MÊME cible existe déjà dans ce dossier, ne rien recréer.
  // Nécessaire depuis la migration (#8) : un doc re-classé re-crée ses raccourcis multi-entités —
  // sans ce garde, chaque campagne (ou rejeu après coupure) dupliquerait les raccourcis. Best-effort :
  // si la vérification échoue, on crée quand même (un doublon de raccourci est bénin, un manquant non).
  if (raccourciExiste_(cibleId, parentId)) return true;
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

/**
 * Vrai si le dossier contient déjà un raccourci pointant `cibleId`. L'API ne permet pas de filtrer
 * `shortcutDetails.targetId` dans `q` → on liste les raccourcis du dossier (rarement plus de quelques-uns)
 * et on compare côté client. Ne propage jamais d'exception (false au moindre doute → l'appelant crée).
 * @param {string} cibleId
 * @param {string} parentId
 * @return {boolean}
 */
function raccourciExiste_(cibleId, parentId) {
  try {
    var q = "'" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.shortcut' and trashed = false";
    var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(shortcutDetails/targetId)') + '&pageSize=100', {
      method: 'get', headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) return false;
    var fichiers = (JSON.parse(rep.getContentText()).files) || [];
    for (var i = 0; i < fichiers.length; i++) {
      if (fichiers[i].shortcutDetails && fichiers[i].shortcutDetails.targetId === cibleId) return true;
    }
  } catch (e) { /* au moindre doute : false → création (un doublon de raccourci est bénin) */ }
  return false;
}
