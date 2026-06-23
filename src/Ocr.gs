/**
 * Ocr.gs — Extraction du texte d'une pièce jointe.
 *
 * - text/*           : lu directement.
 * - image/* ou PDF   : OCR via conversion Drive (Google Doc temporaire → export → suppression).
 * - autres types     : pas de texte (le LLM se rabat sur les métadonnées).
 *
 * Le Google Doc temporaire est créé PAR NOUS puis supprimé : c'est la seule
 * suppression autorisée par les garde-fous (jamais un fichier de l'utilisateur).
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
 * OCR via l'API Drive avancée (v2) : insert avec ocr=true, puis export texte.
 * @param {Blob} blob
 * @return {string}
 */
function ocrViaDrive_(blob) {
  var doc = Drive.Files.insert(
    { title: 'DriveAI_OCR_temp', mimeType: 'application/vnd.google-apps.document' },
    blob,
    { ocr: true, ocrLanguage: 'fr' }
  );
  var id = doc.id;
  try {
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v2/files/' + id + '/export?mimeType=text/plain',
      {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      }
    );
    return resp.getResponseCode() === 200 ? resp.getContentText() : '';
  } finally {
    try {
      Drive.Files.remove(id); // suppression de NOTRE doc temporaire uniquement
    } catch (e) {
      journalErreur_('OCR', 'Doc OCR temporaire non supprimé (' + id + ') : ' + e);
    }
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
