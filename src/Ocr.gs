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
 *
 * ⚠️ LES APPELS IDEMPOTENTS RETENTENT, L'UPLOAD NON — ET CE N'EST PAS UNE HARMONISATION
 * OUBLIÉE. `fetchDriveAvecRetry_` (DriveRest.gs) rejoue une fois sur 429/5xx : c'est sûr pour
 * les deux EXPORTS et pour la suppression, qui sont des opérations sans effet de bord
 * cumulable. Ça ne l'est pas pour l'upload multipart, qui CRÉE un fichier — un 5xx peut
 * arriver APRÈS la création (c'est la réponse qui est perdue, pas l'effet), donc rejouer
 * fabriquerait un second `DriveAI_extract_temp` dont on n'apprend jamais l'identifiant. Or on
 * ne sait supprimer que celui que la réponse nous rend : l'orphelin resterait dans le Drive
 * pour toujours, et le garde-fou « aucune suppression automatique » interdit d'aller le
 * chercher par son nom. Un lot qui « mettrait le retry partout » est donc une régression —
 * `test/ocr-retry.test.js` le refuse.
 */

/**
 * @param {Blob} blob
 * @param {number} [maxCarsOverride]  borne de troncature explicite — sert au dry-run C26-07 qui
 *   doit répliquer la troncature v2 (12000 car.) SANS activer CONFIG.ANALYSE_V2 (le flag pilote
 *   aussi le flux vivant). Omis ⇒ comportement historique inchangé (branché sur le flag).
 * @return {?string} texte extrait (tronqué) ; '' si le fichier est SANS texte ; null si
 *   l'extraction a ÉCHOUÉ (panne/quota — un échec n'est pas un verdict « vide », cf. P2 #11).
 */
function extraireTexte_(blob, maxCarsOverride) {
  var type = blob.getContentType() || '';
  // Refonte #26 : quand l'analyse v2 est active, on tronque MOINS (texte plus complet → analyse plus
  // fiable). OFF ⇒ borne historique inchangée (Haiku, 4000 car.).
  var maxCars = maxCarsOverride || (CONFIG.ANALYSE_V2 ? CONFIG.ANALYSE_V2_OCR_MAX_CARS : CONFIG.LLM_OCR_MAX_CARS);
  try {
    if (type.indexOf('text/') === 0) {
      var brut = blob.getDataAsString();
      // ⚠️ C49-11 — LE BALISAGE SE RETIRE AVANT LA TRONCATURE, JAMAIS APRÈS. Mesuré le 21/09/2026
      // sur un vrai export Facebook du Drive de Marc (18 685 octets) : les 12 000 caractères du
      // budget étaient du `<style>` DE BOUT EN BOUT, coupés en plein milieu d'une règle CSS. Le
      // modèle n'a jamais vu une ligne du document — et il a quand même répondu, en devinant.
      // Nettoyer APRÈS aurait été inutile : le contenu n'est plus là.
      return tronquer_(estHtml_(type, blob.getName()) ? texteDepuisHtml_(brut) : brut, maxCars);
    }
    var conv = cibleConversion_(type, blob.getName());
    if (conv) {
      var texte = convertirEtExtraire_(blob, conv.cible, conv.exportMime, conv.ocr);
      if (texte === null) return null; // échec technique ≠ document sans texte
      return tronquer_(texte, maxCars);
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
    // Un export est un GET : le rejouer ne crée rien. Sans retry, un 429 ou un 503 passager
    // rendait `null`, que le rattrapage range en `ocr-echec` — donc le document est marqué
    // « fait » DÉFINITIVEMENT sous le tag courant, pour une cause qui aurait disparu d'elle-même.
    var rep = fetchDriveAvecRetry_(
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
 * @param {boolean} [dejaReencode]  vrai au second essai d'une image ré-encodée (borne le rejeu à un)
 * @return {string}
 */
function convertirEtExtraire_(blob, cibleMime, exportMime, ocr, dejaReencode) {
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
  // ⚠️ `UrlFetchApp.fetch` NU, jamais `fetchDriveAvecRetry_` : cet appel CRÉE un fichier (voir
  // l'en-tête). Le rejouer sur un 5xx fabriquerait un temporaire orphelin qu'on ne pourrait
  // plus supprimer. Conséquence assumée et NON corrigée ici : un 5xx à cet endroit perd la
  // conversion, et le rattrapage marque le document « fait » — c'est le sujet de `[C49-19]`.
  var insert = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'multipart/related; boundary=' + boundary,
    payload: corps,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (insert.getResponseCode() !== 200) {
    var code = insert.getResponseCode();
    var typeSource = blob.getContentType() || '';
    // ⚠️ C49-28 — UN 400 SUR UNE IMAGE SE REJOUE UNE FOIS, RÉ-ENCODÉE. Mesuré le 24/09 : un PNG
    // valide en palette 16 couleurs est refusé à chaque essai (« Bad Request », rien de plus),
    // alors qu'un PNG couleur standard passe. Un 400 dit que la requête a été REFUSÉE avant
    // toute création : le rejeu ne peut pas fabriquer d'orphelin, contrairement à un 5xx (voir
    // l'en-tête — ce cas-là ne rejoue toujours pas). Une seule fois, et seulement avec un
    // CONTENU différent : rejouer le même octet pour octet ne changerait rien.
    if (code === 400 && !dejaReencode && peutReencoderImage_(typeSource)) {
      var reencode = reencoderImage_(blob);
      if (reencode) return convertirEtExtraire_(reencode, cibleMime, exportMime, ocr, true);
    }
    // ⚠️ C49-28 — LE JOURNAL NOMME LE FICHIER. Jusqu'ici il ne disait que le type CIBLE, le même
    // pour tous les PDF et toutes les images : 15 refus d'affilée le 23/09 au soir, et aucun
    // moyen de savoir lesquels sans recouper à la main. Le nom, le type d'ORIGINE, la taille,
    // et pour un PDF s'il est CHIFFRÉ — la seule cause de refus prouvée sur un PDF à ce jour.
    journalErreur_('OCR', 'Conversion HTTP ' + code + ' — ' + descriptionSource_(blob, typeSource) +
      (dejaReencode ? ' · déjà ré-encodé' : '') + ' : ' + tronquer_(insert.getContentText(), 200));
    return null; // échec technique (cf. contrat extraireTexte_)
  }

  var id = JSON.parse(insert.getContentText()).id;
  try {
    // ⚠️ C'est l'appel où un retry rapporte le plus : la conversion vient d'être PAYÉE (upload
    // fait, fichier temporaire créé), et un 5xx ici jetait tout ce travail. Un export est un
    // GET, donc le rejouer est sans effet de bord.
    var exp = fetchDriveAvecRetry_(
      'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent(exportMime),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    return exp.getResponseCode() === 200 ? exp.getContentText() : null; // échec technique ≠ sans texte (contrat extraireTexte_)
  } finally {
    // Supprime NOTRE fichier temporaire (jamais un fichier utilisateur).
    // Idempotent : supprimer deux fois le même identifiant ne retire rien de plus. Sans retry,
    // un 5xx laissait un `DriveAI_extract_temp` dans le Drive, et rien n'allait le chercher.
    fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files/' + id, {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
  }
}

/**
 * Les types d'image que Apps Script sait RÉ-ENCODER (`Blob.getAs`). PURE.
 *
 * ⚠️ TIFF n'en fait PAS partie : `getAs` ne convertit que BMP, GIF, JPEG et PNG. Un TIFF refusé
 * reste refusé ici, et le journal le dit — le lire demande un autre chemin (aperçu Drive ou
 * lecture par le modèle), hors de ce lot.
 * ⚠️ Un JPEG n'est pas ré-encodé en JPEG : ce serait rejouer le même contenu.
 */
function peutReencoderImage_(type) {
  var t = String(type || '').toLowerCase();
  return t === 'image/png' || t === 'image/gif' || t === 'image/bmp' || t === 'image/x-ms-bmp';
}

/** Ré-encode une image en JPEG. I/O. `null` si Apps Script refuse — jamais une exception. */
function reencoderImage_(blob) {
  try {
    var r = blob.getAs('image/jpeg');
    return r && r.getBytes && r.getBytes().length ? r : null;
  } catch (e) {
    return null;
  }
}

/**
 * Vrai si ce PDF est CHIFFRÉ. PURE (prend le texte latin-1 du fichier).
 *
 * Un PDF protégé porte `/Encrypt` dans son dictionnaire de fin : c'était le cas du seul PDF
 * refusé à coup sûr lors de la mesure du 24/09, et d'aucun des PDF lus avec succès.
 */
function estPdfChiffre_(texteLatin1) {
  return /\/Encrypt\b/.test(String(texteLatin1 || ''));
}

/** « nom » (type, taille[, PDF chiffré]) — ce que le journal doit dire d'un refus. I/O légère. */
function descriptionSource_(blob, type) {
  var nom = '', taille = 0, chiffre = false;
  try { nom = blob.getName() || ''; } catch (e) { /* le nom est un confort, jamais un blocage */ }
  try {
    var octets = blob.getBytes();
    taille = octets.length;
    if (String(type).toLowerCase() === 'application/pdf') {
      chiffre = estPdfChiffre_(Utilities.newBlob(octets).getDataAsString('ISO-8859-1'));
    }
  } catch (e) { /* idem */ }
  return '« ' + nom + ' » (' + (type || 'type inconnu') + ', ' + Math.round(taille / 1024) + ' Ko' +
    (chiffre ? ', PDF CHIFFRÉ' : '') + ')';
}

/**
 * Tronque une chaîne à n caractères (protège le budget LLM).
 * @param {string} texte
 * @param {number} n
 * @return {string}
 */
/**
 * Vrai si ce `text/*` est du BALISAGE, donc à nettoyer avant d'être lu. PURE.
 *
 * ⚠️ `text/plain` et `text/csv` n'y entrent JAMAIS : un bloc-notes qui contient « 3 < 5 » ou une
 * colonne CSV avec des chevrons serait mutilé par le retrait de balises. On reconnaît le balisage
 * par le MIME **et** par l'extension — Drive type parfois un `.html` en `text/plain`, et c'est
 * précisément ce fichier-là qu'on veut nettoyer.
 */
function estHtml_(type, nom) {
  var t = String(type || '').toLowerCase();
  if (t.indexOf('text/html') === 0 || t.indexOf('text/xml') === 0 || t.indexOf('application/xhtml') === 0) return true;
  return /\.(x?html?|xml)$/i.test(String(nom || ''));
}

/**
 * Les entités HTML usuelles, décodées. PURE.
 *
 * ⚠️ `&amp;` se décode EN DERNIER, sinon `&amp;lt;` devient `<` — un décodage de trop, qui
 * fabrique une balise là où le document écrivait le texte « &lt; ». (Leçon JobAI, 19/08.)
 * ⚠️ Et la table doit être COMPLÈTE : `&apos;` manquait chez JobAI, et une entité non décodée ne
 * lève rien — elle survit dans le texte et fait rater toute comparaison qui suit.
 */
function decoderEntites_(texte) {
  var s = String(texte == null ? '' : texte);
  s = s.replace(/&(nbsp|#160);/gi, ' ')
    .replace(/&(lt|#60);/gi, '<')
    .replace(/&(gt|#62);/gi, '>')
    .replace(/&(quot|#34);/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&(eacute);/gi, '\u00e9')
    .replace(/&(egrave);/gi, '\u00e8')
    .replace(/&(agrave);/gi, '\u00e0')
    .replace(/&(ccedil);/gi, '\u00e7');
  // Numériques (décimales et hexadécimales). Un point de code invalide reste TEL QUEL : un flux
  // mal formé n'est pas une raison de perdre le reste du document.
  s = s.replace(/&#(\d{1,7});/g, function (m, d) {
    var n = parseInt(d, 10);
    return (n > 0 && n <= 0x10ffff) ? String.fromCharCode(n) : m;
  });
  s = s.replace(/&#x([0-9a-f]{1,6});/gi, function (m, h) {
    var n = parseInt(h, 16);
    return (n > 0 && n <= 0x10ffff) ? String.fromCharCode(n) : m;
  });
  return s.replace(/&(amp|#38);/gi, '&'); // EN DERNIER, toujours.
}

/**
 * Le TEXTE d'un document HTML : ce qu'un humain lirait à l'écran. PURE.
 *
 * ⚠️ `<head>` n'est PAS retiré en bloc, et c'est délibéré : le `<title>` y vit, et c'est souvent
 * l'information la plus utile de tout le fichier (« Pages et profils que vous suivez » pour
 * l'export mesuré). On retire ce qui n'est JAMAIS du texte — style, script, commentaires — et on
 * garde le reste.
 * ⚠️ Les balises de BLOC deviennent des sauts de ligne : sans ça, deux cellules voisines se
 * collent en un seul mot et le modèle lit « Marc RichardLe Mercredi 18 mars ».
 * ⚠️ Un nettoyage qui ne rend RIEN alors que le brut portait quelque chose rend le BRUT : « je
 * n'ai pas su lire » n'est pas « ce document est vide », et c'est le second qui se fige en verdict.
 */
function texteDepuisHtml_(html) {
  var brut = String(html == null ? '' : html);
  if (!brut) return '';
  var s = brut
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|main|table|blockquote|hr|title)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  s = decoderEntites_(s)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s || brut;
}

function tronquer_(texte, n) {
  if (!texte) return '';
  return texte.length > n ? texte.substring(0, n) : texte;
}
