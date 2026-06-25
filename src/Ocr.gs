/**
 * Ocr.gs — Extraction du texte d'une pièce jointe.
 *
 * - text/*           : lu directement.
 * - image/* ou PDF   : OCR via l'API Drive (REST) appelée par UrlFetchApp —
 *                      conversion en Google Doc temporaire (ocr=true) → export texte → suppression.
 * - autres types     : pas de texte (le LLM se rabat sur les métadonnées).
 *
 * On passe par l'API REST (et pas le « service avancé Drive ») pour éviter toute
 * dépendance à une activation manuelle dans l'éditeur. Scopes utilisés : drive +
 * script.external_request (déjà déclarés). Échec d'OCR = dégradation propre (texte vide).
 *
 * Le Google Doc temporaire est créé PAR NOUS puis supprimé : seule suppression
 * autorisée par les garde-fous (jamais un fichier de l'utilisateur).
 */

/**
 * @param {Blob} blob
 * @return {string} texte extrait (tronqué), ou '' si indisponible.
 */
function extraireTexte_(blob) {
  var type = blob.getContentType() || '';
  try {
    if (type.indexOf('text/') === 0) {
      return tronquer_(blob.getDataAsString(), CONFIG.LLM_OCR_MAX_CARS);
    }
    if (type === 'application/pdf' || type.indexOf('image/') === 0) {
      return tronquer_(ocrViaDrive_(blob), CONFIG.LLM_OCR_MAX_CARS);
    }
  } catch (e) {
    journalErreur_('OCR', 'Extraction échouée pour « ' + blob.getName() + ' » : ' + e);
  }
  return '';
}

/**
 * OCR via l'API Drive REST (v3) : upload multipart avec ocrLanguage, puis export texte.
 * @param {Blob} blob
 * @return {string}
 */
function ocrViaDrive_(blob) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'driveai' + Utilities.getUuid();
  var metadata = JSON.stringify({
    name: 'DriveAI_OCR_temp',
    mimeType: 'application/vnd.google-apps.document'
  });

  // Corps multipart/related : 1) métadonnées JSON, 2) contenu binaire de la PJ.
  var avant = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + (blob.getContentType() || 'application/octet-stream') + '\r\n\r\n';
  var apres = '\r\n--' + boundary + '--';

  var corps = Utilities.newBlob(avant).getBytes()
    .concat(blob.getBytes())
    .concat(Utilities.newBlob(apres).getBytes());

  var insert = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=fr&fields=id',
    {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: corps,
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    }
  );
  if (insert.getResponseCode() !== 200) {
    journalErreur_('OCR', 'Conversion HTTP ' + insert.getResponseCode() + ' : ' +
      tronquer_(insert.getContentText(), 300));
    return '';
  }

  var id = JSON.parse(insert.getContentText()).id;
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    return exp.getResponseCode() === 200 ? exp.getContentText() : '';
  } finally {
    // Supprime NOTRE Doc temporaire (jamais un fichier utilisateur).
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
  }
}

/**
 * Tronque une chaîne à n caractères (protège le budget LLM).
 * @param {string} texte
 * @param {number} n
 * @return {string}
 */
function tronquer_(texte, n) {
  if (!texte) return '';
  return texte.length > n ? texte.substring(0, n) : texte;
}
