/**
 * Ocr.gs — Extraction du texte d'une pièce jointe.
 *
 * - text/*                     : lu directement.
 * - image/* ou PDF             : OCR via l'API Drive (conversion Google Doc, ocr=true).
 * - Word / PowerPoint / Excel  : CONVERSION native Google (Docs/Slides/Sheets, sans OCR) → export texte.
 *                                (Un .docx/.ppt/.xlsx contient déjà du texte : Drive le convertit sans OCR.)
 * - autres types               : pas de texte (le LLM se rabat sur les métadonnées).
 *
 * On passe par l'API REST (et pas le « service avancé Drive ») pour éviter toute
 * dépendance à une activation manuelle dans l'éditeur. Scopes utilisés : drive +
 * script.external_request (déjà déclarés). Échec = dégradation propre (texte vide).
 *
 * Le fichier Google temporaire est créé PAR NOUS puis supprimé : seule suppression
 * autorisée par les garde-fous (jamais un fichier de l'utilisateur).
 */

/**
 * @param {Blob} blob
 * @return {?string} texte extrait (tronqué) ; '' si le fichier est SANS texte ; null si
 *   l'extraction a ÉCHOUÉ (panne/quota — un échec n'est pas un verdict « vide », cf. P2 #11).
 */
function extraireTexte_(blob) {
  var type = blob.getContentType() || '';
  try {
    if (type.indexOf('text/') === 0) {
      return tronquer_(blob.getDataAsString(), CONFIG.LLM_OCR_MAX_CARS);
    }
    var conv = cibleConversion_(type, blob.getName());
    if (conv) {
      var texte = convertirEtExtraire_(blob, conv.cible, conv.exportMime, conv.ocr);
      if (texte === null) return null; // échec technique ≠ document sans texte
      return tronquer_(texte, CONFIG.LLM_OCR_MAX_CARS);
    }
  } catch (e) {
    journalErreur_('OCR', 'Extraction échouée pour « ' + blob.getName() + ' » : ' + e);
    return null; // échec (panne transitoire) — jamais confondu avec « sans texte »
  }
  return ''; // type sans texte extractible (pas un échec)
}

/**
 * Décide comment convertir un type de fichier en Google natif pour en extraire le texte.
 * @param {string} type  MIME
 * @param {string} nom   nom du fichier (secours par extension si le MIME est générique)
 * @return {?{cible:string, exportMime:string, ocr:boolean}}
 */
function cibleConversion_(type, nom) {
  var ext = String(nom || '').toLowerCase();
  // Images & PDF → Google Doc AVEC OCR (le texte est dans l'image).
  if (type === 'application/pdf' || type.indexOf('image/') === 0) {
    return { cible: 'application/vnd.google-apps.document', exportMime: 'text/plain', ocr: true };
  }
  // Word → Google Doc (conversion native, pas d'OCR — le texte existe déjà).
  if (type.indexOf('wordprocessingml') !== -1 || type === 'application/msword' || /\.docx?$/.test(ext)) {
    return { cible: 'application/vnd.google-apps.document', exportMime: 'text/plain', ocr: false };
  }
  // PowerPoint → Google Slides.
  if (type.indexOf('presentationml') !== -1 || type === 'application/vnd.ms-powerpoint' || /\.pptx?$/.test(ext)) {
    return { cible: 'application/vnd.google-apps.presentation', exportMime: 'text/plain', ocr: false };
  }
  // Excel → Google Sheets (export CSV : le texte des cellules).
  if (type.indexOf('spreadsheetml') !== -1 || type === 'application/vnd.ms-excel' || /\.xlsx?$/.test(ext)) {
    return { cible: 'application/vnd.google-apps.spreadsheet', exportMime: 'text/csv', ocr: false };
  }
  return null;
}

/**
 * Convertit un blob en fichier Google temporaire (Doc/Slides/Sheets) via l'API Drive REST (v3),
 * en exporte le texte, puis supprime le temporaire. `ocr=true` ajoute l'OCR (images/PDF).
 * @param {Blob} blob
 * @param {string} cibleMime    type Google cible (google-apps.document/presentation/spreadsheet)
 * @param {string} exportMime   type d'export (text/plain, text/csv)
 * @param {boolean} ocr         active l'OCR (images/PDF uniquement)
 * @return {string}
 */
function convertirEtExtraire_(blob, cibleMime, exportMime, ocr) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'driveai' + Utilities.getUuid();
  var metadata = JSON.stringify({ name: 'DriveAI_extract_temp', mimeType: cibleMime });

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

  var url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id' +
    (ocr ? '&ocrLanguage=fr' : '');
  var insert = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: corps,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (insert.getResponseCode() !== 200) {
    journalErreur_('OCR', 'Conversion HTTP ' + insert.getResponseCode() + ' (' + cibleMime + ') : ' +
      tronquer_(insert.getContentText(), 300));
    return null; // échec technique (cf. contrat extraireTexte_)
  }

  var id = JSON.parse(insert.getContentText()).id;
  try {
    var exp = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent(exportMime),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    return exp.getResponseCode() === 200 ? exp.getContentText() : '';
  } finally {
    // Supprime NOTRE fichier temporaire (jamais un fichier utilisateur).
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
