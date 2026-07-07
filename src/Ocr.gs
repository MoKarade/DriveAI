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
 * Type d'EXPORT texte d'un fichier Google NATIF (déjà converti par nature — R3, correctif
 * « file À trier » 2026-07-07). PURE (testée). Les types sans texte exploitable (Forms,
 * dessins, raccourcis, dossiers…) → null (laissés en place, comme avant).
 * @param {string} mime
 * @return {?string}
 */
function exportNatifMime_(mime) {
  if (mime === 'application/vnd.google-apps.document') return 'text/plain';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'text/csv';
  if (mime === 'application/vnd.google-apps.presentation') return 'text/plain';
  return null;
}

/**
 * Exporte le TEXTE d'un fichier Google natif via l'API Drive REST — la capacité qui manquait à
 * l'intake (leçon 2026-07-01 : corriger la CAPACITÉ, pas le garde-fou ; deux Google Sheets ont
 * stagné 3 semaines dans 00·À trier faute de lecteur). Aucune conversion ni fichier temporaire :
 * le natif s'exporte directement. Dégrade proprement : null si type non exportable ou échec HTTP
 * (l'appelant décide — échec compté, type sans export inscrit `natif`). Le texte est retourné
 * (quasi) ENTIER — borne mémoire NATIF_EXPORT_MAX_CARS seulement : il sert d'EMPREINTE de doublon
 * (hash sur 4000 cars = faux doublons entre gros exports au même début) ; la troncature LLM
 * (LLM_OCR_MAX_CARS) est appliquée en aval par extraireTexte_, comme pour tout texte.
 * @param {string} fileId
 * @param {string} mime
 * @return {?string} texte (borné à NATIF_EXPORT_MAX_CARS), ou null
 */
function exporterTexteNatif_(fileId, mime) {
  var exportMime = exportNatifMime_(mime);
  if (!exportMime) return null;
  try {
    var rep = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=' + encodeURIComponent(exportMime),
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
    );
    if (rep.getResponseCode() !== 200) {
      journalErreur_('OCR', 'Export natif HTTP ' + rep.getResponseCode() + ' (' + mime + ') : ' +
        tronquer_(rep.getContentText(), 200));
      return null;
    }
    return tronquer_(rep.getContentText(), CONFIG.NATIF_EXPORT_MAX_CARS);
  } catch (e) {
    journalErreur_('OCR', 'Export natif impossible (' + fileId + ') : ' + e);
    return null;
  }
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
    return exp.getResponseCode() === 200 ? exp.getContentText() : null; // échec technique ≠ sans texte (contrat extraireTexte_)
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
