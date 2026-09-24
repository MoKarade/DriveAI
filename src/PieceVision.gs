/**
 * PieceVision.gs — LIRE L'IMAGE du papier, et tout ce qu'elle porte (ADR-0063, lot L1).
 *
 * ── POURQUOI L'OCR NE SUFFISAIT PLUS ────────────────────────────────────────────────────
 *
 * `Piece.gs` lit le TEXTE que l'OCR de Drive a tiré du document. Mesuré le 24/09 : quand l'OCR
 * rate, le modèle n'a rien à lire — un passeport photographié rendait « HARD FLEX T 014 », un
 * PDF chiffré ou un TIFF rendait un refus 400 (C49-28). Le papier était lisible ; sa
 * transcription ne l'était pas. Ici, le modèle reçoit le FICHIER : le PDF en bloc `document`,
 * la photo en bloc `image`. Il voit la page comme Marc la voit.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────────────────
 *
 * Il ne classe rien, ne déplace rien, n'écrit rien dans l'Index ni le Journal. Il rend une
 * extraction au même format que `Piece.gs` (même parseur, même porte « lisible »), et c'est
 * `pousserPieceApresClassement_` qui la met en forme et l'envoie — un seul chemin d'envoi.
 *
 * ⚠️ CE QUI SORT DU COMPTE GOOGLE CHANGE ENCORE, et l'ADR-0063 le nomme : le fichier lui-même
 * (l'image, le PDF) transite par Anthropic, là où seul son OCR transitait. Rien de plus n'est
 * PERSISTÉ nulle part — ni ici, ni dans la Mémoire, qui ne reçoit toujours que des champs.
 */

/** Le modèle. Sonnet 5 : il lit l'image en haute résolution (jusqu'à 2 576 px). */
var PIECE_VISION_MODELE = 'claude-sonnet-5';

/**
 * Le nom de l'extracteur. Il DOIT figurer en queue de `LIGNEE_EXTRACTEURS` côté MemoryAI
 * (son ADR 0010) : sans lui, la Mémoire range chaque lecture payée en « déjà présente ».
 */
var EXTRACTEUR_PIECE_VISION = 'sonnet-5-vision-piece-v3';

/**
 * Plafond de SORTIE. Le prompt demande tout : un relevé de trois pages porte des dizaines de
 * lignes. Trop bas, le JSON est coupé en plein milieu et le parseur le jette APRÈS l'avoir payé.
 */
var PIECE_VISION_MAX_TOKENS = 8000;

/**
 * Au-delà, un PDF passe par le texte : chaque page est une image facturée, et un scan de
 * 40 pages coûterait à lui seul le prix de trente papiers. Le seuil est un FILET contre
 * l'exception, pas une politique — l'audit dira s'il mord.
 */
var PIECE_VISION_PDF_OCTETS_MAX = 10 * 1024 * 1024;

/**
 * Au-delà, une photo passe par l'APERÇU de Drive : l'API refuse une image de plus de 5 Mo, et
 * la base64 grossit de 4/3. 3,5 Mo bruts restent sous la limite avec de la marge.
 */
var PIECE_VISION_IMAGE_OCTETS_MAX = 3.5 * 1024 * 1024;

/**
 * C49-30 — Marc, 24/09 : « texte si le PDF en a ». Un PDF dont l'OCR rend au moins ce nombre de
 * caractères LISIBLES part en TEXTE, pas en image : l'audit a mesuré 15 ¢ pour un PDF de ~20
 * pages lu en image (chaque page facturée comme une photo), contre ~1 ¢ pour une photo. En
 * dessous — un scan dont l'OCR ne rend presque rien —, l'image reste la seule façon de le lire.
 */
var PIECE_VISION_PDF_TEXTE_MIN = 400;

/**
 * Le texte envoyé au modèle, borné. ⚠️ PAS les 12 000 caractères de l'analyse : ils coupaient
 * un relevé de trois pages en son milieu, et « TOUT est à récupérer ». 60 000 caractères
 * ≈ 17 000 jetons ≈ 3,4 ¢ d'entrée au pire — encore deux fois moins qu'un gros PDF en image.
 */
var PIECE_VISION_TEXTE_MAX_CARS = 60000;

/** La taille demandée à l'aperçu de Drive : celle que Sonnet 5 lit sans la réduire. */
var PIECE_VISION_APERCU_PX = 2400;

/** Les images que l'API accepte telles quelles. Le reste (TIFF, HEIC, BMP) passe par l'aperçu. */
var MIMES_IMAGE_VISION = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

var PROMPT_PIECE_VISION =
  'Tu lis un document personnel de Marc Richard — tu VOIS le fichier lui-même — et tu en ' +
  'rapportes TOUT CE QU\'IL CONTIENT. Tu ne le classes pas : son rangement est déjà décidé.\n' +
  'Le but : que Marc retrouve plus tard n\'importe quelle information de ce papier sans le ' +
  'rouvrir. Un numéro, une date, un nom, une adresse, un montant oubliés sont perdus.\n' +
  'Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après :\n' +
  '{\n' +
  '  "lisible": <true si tu peux VRAIMENT lire ce document, false sinon>,\n' +
  '  "resume": <un résumé DÉTAILLÉ, 4 à 10 phrases, DANS LA LANGUE DU DOCUMENT : ce que c\'est, ' +
  'qui l\'émet, pour qui, ce qu\'il établit, ses chiffres et dates clés, ce qu\'il demande de faire>,\n' +
  '  "type": <type court et précis ("passeport", "bail", "avis de cotisation") ou null>,\n' +
  '  "emetteur": <l\'ORGANISATION qui émet le document, ou null>,\n' +
  '  "langue": <"fr", "en"… ou null>,\n' +
  '  "date_document": <"AAAA-MM-JJ" ou null — JAMAIS une date partielle>,\n' +
  '  "date_echeance": <"AAAA-MM-JJ" ou null — expiration, fin de bail, échéance de paiement>,\n' +
  '  "titulaire": <À QUI ce papier appartient (Marc ou un proche), ou null si tu n\'es pas sûr>,\n' +
  '  "titulaire_confiance": <0..1 — ta certitude SUR LE TITULAIRE, obligatoire si titulaire>,\n' +
  '  "champs": {\n' +
  '    "montants":  [{"libelle": <ce que le montant est>, "valeur": <tel qu\'écrit>}],\n' +
  '    "numeros":   [{"libelle": <ce que le numéro identifie>, "valeur": <tel qu\'écrit>}],\n' +
  '    "personnes": [{"libelle": <son rôle>, "valeur": <son nom complet>}],\n' +
  '    "lieux":     [{"libelle": <ce que le lieu est>, "valeur": <adresse ou lieu tel qu\'écrit>}]\n' +
  '  },\n' +
  '  "libres": { <TOUTE autre information : "clé courte": "valeur"> },\n' +
  '  "confiance": <0..1, honnête>\n' +
  '}\n' +
  'EXHAUSTIVITÉ : relève CHAQUE numéro (document, dossier, client, contrat, compte, référence, ' +
  'téléphone, NAS, IUC…), CHAQUE montant, CHAQUE personne nommée, CHAQUE adresse, CHAQUE date. ' +
  'Pour un relevé ou une facture, chaque ligne significative. Recopie les valeurs TELLES ' +
  'QU\'ÉCRITES, sans les convertir ni les arrondir.\n' +
  'LIBRES : jusqu\'à 80 clés. Tout ce qui n\'entre pas dans une famille va là : courriels, ' +
  'sites, conditions, mentions, taille, couleur des yeux, sexe, nationalité, lieu de naissance, ' +
  'autorité, catégories, restrictions… Clés courtes et explicites, en français.\n' +
  'DATES D\'UNE PERSONNE : une date de NAISSANCE va dans "libres" sous la clé exacte ' +
  '"date de naissance", au format AAAA-MM-JJ. Idem "date de délivrance". (`date_document` est ' +
  'la date du PAPIER, `date_echeance` sa fin de validité.)\n' +
  'ZONE LISIBLE PAR MACHINE (les lignes <<< d\'un passeport ou d\'une carte) : décode-la, et ' +
  'si elle contredit la zone imprimée, rapporte les deux sous deux clés distinctes.\n' +
  'PHOTO DE LA PERSONNE : si le document porte la photo de son titulaire, décris ce qui est ' +
  'VISIBLE, factuellement, dans "libres" sous la clé exacte "apparence (photo)" : cheveux, ' +
  'barbe, lunettes, forme du visage, signes distinctifs, âge apparent. Jamais d\'origine ' +
  'ethnique, jamais de jugement. Cette description n\'apparaît NULLE PART ailleurs (ni dans le ' +
  'résumé, ni sous une autre clé).\n' +
  'TITULAIRE : si le document est au nom de deux personnes, s\'il est vierge, ou si aucun nom ' +
  'n\'apparaît, réponds null. « Inconnu » est une bonne réponse ; deviner ne l\'est pas.\n' +
  'DOCUMENT ILLISIBLE : si la page est blanche, floue au point de ne rien lire, ou ne porte ' +
  'que des fragments sans rapport, réponds "lisible": false et laisse TOUT LE RESTE à null. ' +
  'Ne fabrique JAMAIS un document plausible : « je n\'ai pas pu lire » est une bonne réponse.\n' +
  'NE DEVINE RIEN : un champ que le document ne porte pas vaut null. Une date incomplète vaut null.';

/* ---------- PUR ---------- */

/**
 * PURE. Par quelle VOIE ce fichier arrive-t-il au modèle ?
 *
 * ⚠️ `texte` n'est pas un échec : un .docx, un courriel HTML, un tableur ont un texte EXACT,
 * que l'export rend mieux qu'une image. Seuls les formats que l'OCR lit MAL passent par l'image.
 * ⚠️ `apercu` est le repli de tout ce que l'API refuse (TIFF, HEIC, BMP, photo trop lourde) :
 * Drive en fabrique une vignette PNG/JPEG, qu'on demande grande.
 *
 * @param {string} mime
 * @param {string} nom
 * @param {number} octets
 * @return {string} 'pdf' | 'image' | 'apercu' | 'export-pdf' | 'texte'
 */
function voieVision_(mime, nom, octets) {
  var m = String(mime || '').toLowerCase();
  var ext = (/\.([a-z0-9]{1,5})$/i.exec(String(nom || '')) || [])[1];
  ext = String(ext || '').toLowerCase();
  var n = Number(octets) || 0;
  if (m === 'application/pdf' || (!m && ext === 'pdf')) {
    return n > PIECE_VISION_PDF_OCTETS_MAX ? 'texte' : 'pdf';
  }
  if (m === 'application/vnd.google-apps.document' ||
      m === 'application/vnd.google-apps.presentation' ||
      m === 'application/vnd.google-apps.drawing') return 'export-pdf';
  if (m.indexOf('image/') === 0) {
    if (MIMES_IMAGE_VISION.indexOf(m) === -1) return 'apercu';
    return n > PIECE_VISION_IMAGE_OCTETS_MAX ? 'apercu' : 'image';
  }
  return 'texte';
}

/**
 * PURE. Le titulaire lu est-il MARC lui-même ?
 *
 * ⚠️ C'est la seule condition sous laquelle « l'apparence » part (ADR-0063 §3). Marc a demandé
 * « une analyse de MA tête » ; ses proches n'ont rien demandé. La garde est dans le CODE, pas
 * dans le prompt : un modèle qui se tromperait de titulaire ne doit pas pouvoir décider seul.
 * Mot entier, accents ignorés : « Marcel Richardson » n'est pas Marc Richard.
 */
function titulaireEstMarc_(titulaire) {
  var t = String(titulaire || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // ⚠️ Un papier au nom de DEUX personnes n'est pas celui de Marc seul (revue #418 : « Marc
  // Richard et Julie Tremblay » passait). La photo pourrait être celle de l'autre.
  if (/\s(et|and)\s|[&\/;+]/.test(t)) return false;
  // ⚠️ Le trait d'union COLLE : « Marc-André Richard » est une autre personne que Marc.
  return /(^|[^a-z-])marc([^a-z-]|$)/.test(t) && /(^|[^a-z-])richard([^a-z-]|$)/.test(t);
}

/**
 * PURE. Retire « l'apparence » si le papier n'est pas celui de Marc. Rend une COPIE : on ne
 * mute pas l'extraction que l'appelant tient.
 */
/**
 * Les clés qui décrivent ce qu'on VOIT sur la photo. ⚠️ Une LISTE, pas un préfixe : la revue #418
 * a sondé « description de la photo » passant sous une garde qui ne retirait que « apparence… ».
 * Les mentions IMPRIMÉES sur le document (taille, couleur des yeux d'un passeport) ne sont PAS
 * ici : ce sont des champs du papier, que Marc a demandé de lire pour ses proches aussi.
 */
var CLES_APPARENCE_VISION = /apparence|photo|visage|cheveux|coiffure|barbe|moustache|lunettes|expression|age apparent|âge apparent|signes? distinctifs?|teint/i;

/** Sous ce seuil, « c'est Marc » est une lecture trop incertaine pour décrire un visage. */
var APPARENCE_CONFIANCE_MIN = 0.8;

function filtrerApparence_(extraction) {
  if (!extraction || !extraction.libres) return extraction;
  var confiance = Number(extraction.titulaire_confiance);
  if (titulaireEstMarc_(extraction.titulaire) && isFinite(confiance) &&
      confiance >= APPARENCE_CONFIANCE_MIN) return extraction;
  var libres = {};
  var retire = false;
  for (var cle in extraction.libres) {
    if (!Object.prototype.hasOwnProperty.call(extraction.libres, cle)) continue;
    if (CLES_APPARENCE_VISION.test(cle)) { retire = true; continue; }
    libres[cle] = extraction.libres[cle];
  }
  if (!retire) return extraction;
  var copie = {};
  for (var k in extraction) if (Object.prototype.hasOwnProperty.call(extraction, k)) copie[k] = extraction[k];
  copie.libres = libres;
  return copie;
}

/** PURE. Le coût d'UN appel Sonnet 5, en dollars, d'après `CONFIG.LLM_PRIX`. */
function coutVisionDollars_(usage) {
  var u = usage || {};
  return coutDollars_({
    s5in: u.input_tokens || 0, s5out: u.output_tokens || 0,
    s5cw: u.cache_creation_input_tokens || 0, s5cr: u.cache_read_input_tokens || 0
  });
}

/**
 * PURE. Ce texte suffit-il à LIRE le PDF sans le voir ?
 *
 * ⚠️ La LONGUEUR seule ne suffit pas : l'OCR d'un scan de travers rend des milliers de
 * caractères de bruit (« ‹‹ ;: ~ . , »), et la longueur les compterait comme une lecture. On
 * exige aussi que la moitié des caractères non blancs soient des lettres ou des chiffres.
 */
function texteSuffisantVision_(texte) {
  var t = String(texte == null ? '' : texte).trim();
  if (t.length < PIECE_VISION_PDF_TEXTE_MIN) return false;
  var pleins = t.replace(/\s+/g, '');
  if (!pleins.length) return false;
  var lisibles = (pleins.match(/[0-9A-Za-z\u00C0-\u024F]/g) || []).length;
  return lisibles / pleins.length >= 0.5;
}

/** PURE. Les deux usages d'un papier lu en deux appels, additionnés (le coût est la SOMME). */
function sommerUsageVision_(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  var cles = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
  var r = {};
  for (var i = 0; i < cles.length; i++) r[cles[i]] = (Number(a[cles[i]]) || 0) + (Number(b[cles[i]]) || 0);
  return r;
}

/* ---------- I/O ---------- */

/**
 * L'aperçu que Drive fabrique d'un fichier, demandé grand. `null` si Drive n'en a pas.
 * ⚠️ `thumbnailLink` finit par `=s220` : sans le remplacer, le modèle lirait une vignette de
 * timbre-poste et répondrait « illisible » — honnêtement, et à tort.
 */
function apercuDrive_(fileId) {
  var meta = fetchDriveAvecRetry_(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?fields=thumbnailLink&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true });
  // ⚠️ Un 429/5xx sur l'aperçu est une PANNE, pas un verdict du papier (revue #418) : sans cette
  // distinction, un hoquet de Drive se publiait « voie aperçu impossible ».
  if (!meta || estCodeTransitoire_(meta.getResponseCode())) return { motif: 'apercu-panne' };
  if (meta.getResponseCode() !== 200) return { motif: 'apercu-absent' };
  var lien;
  try { lien = JSON.parse(meta.getContentText()).thumbnailLink; } catch (e) { return { motif: 'apercu-panne' }; }
  if (!lien) return { motif: 'apercu-absent' };
  // ⚠️ Deux tailles : un scan de 2 400 px en PNG peut dépasser les 5 Mo que l'API accepte, et un
  // refus 400 serait alors « mesuré » contre la voie alors que c'est la taille demandée.
  var tailles = [PIECE_VISION_APERCU_PX, 1600];
  for (var i = 0; i < tailles.length; i++) {
    var img = fetchDriveAvecRetry_(String(lien).replace(/=s\d+$/, '') + '=s' + tailles[i],
      { headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true });
    if (!img || estCodeTransitoire_(img.getResponseCode())) return { motif: 'apercu-panne' };
    if (img.getResponseCode() !== 200) return { motif: 'apercu-absent' };
    var blob = img.getBlob();
    if (blob.getBytes().length <= PIECE_VISION_IMAGE_OCTETS_MAX) return { blob: blob };
  }
  return { motif: 'apercu-absent' };
}

/** PURE. 429 et 5xx : le service a hoqueté, le fichier n'y est pour rien. */
function estCodeTransitoire_(code) {
  return code === 429 || (code >= 500 && code < 600);
}

/**
 * PURE. Le type d'une image, lu dans ses PREMIERS OCTETS. Le type déclaré par Drive ou par
 * l'aperçu ne suffit pas : un `media_type` qui contredit les octets est un refus 400 de l'API.
 * `null` si ce n'est aucun des quatre formats que l'API lit.
 */
function typeImageDesOctets_(octets) {
  var b = octets || [];
  var o = function (i) { return (b[i] + 256) % 256; };
  if (b.length < 12) return null;
  if (o(0) === 0xFF && o(1) === 0xD8) return 'image/jpeg';
  if (o(0) === 0x89 && o(1) === 0x50 && o(2) === 0x4E && o(3) === 0x47) return 'image/png';
  if (o(0) === 0x47 && o(1) === 0x49 && o(2) === 0x46) return 'image/gif';
  if (o(0) === 0x52 && o(1) === 0x49 && o(8) === 0x57 && o(9) === 0x45) return 'image/webp';
  return null;
}

/**
 * Le contenu du message : le fichier sous la forme que l'API lit, plus son nom.
 * Rend `{blocs, voie}` ou `{blocs:null, voie, motif}` — jamais une exception.
 */
function blocsVision_(fichier, forcerImage) {
  var nom = fichier.getName();
  var mime = fichier.getMimeType();
  var voie = voieVision_(mime, nom, fichier.getSize());
  var entete = { type: 'text', text: 'Nom du fichier : ' + nom };
  try {
    // ⚠️ C49-30 — un PDF qui a du TEXTE part en texte (Marc, 24/09). L'image ne sert qu'aux
    // scans : c'est eux qu'on ne sait pas lire autrement. `forcerImage` est le second essai
    // d'`extrairePieceVision_` quand la lecture du texte n'a rien donné.
    if (voie === 'pdf' && !forcerImage) {
      var couche = extraireTexte_(fichier.getBlob(), PIECE_VISION_TEXTE_MAX_CARS);
      if (couche !== null && texteSuffisantVision_(couche)) {
        return { voie: 'pdf-texte', blocs: [{ type: 'text',
          text: 'Nom du fichier : ' + nom + '\nCe PDF t\'arrive sous forme de TEXTE (sa couche '
            + 'texte) : lis-le comme le document lui-même. Il n\'y a pas de photo à décrire.\n'
            + 'Texte du document :\n' + couche }] };
      }
    }
    if (voie === 'pdf' || voie === 'export-pdf') {
      var pdf = voie === 'pdf' ? fichier.getBlob() : fichier.getAs('application/pdf');
      return { voie: voie, blocs: [entete, { type: 'document', source: {
        type: 'base64', media_type: 'application/pdf',
        data: Utilities.base64Encode(pdf.getBytes()) } }] };
    }
    if (voie === 'image' || voie === 'apercu') {
      var img;
      if (voie === 'image') {
        img = fichier.getBlob();
      } else {
        var ap = apercuDrive_(fichier.getId());
        if (!ap.blob) return { voie: voie, blocs: null, motif: ap.motif };
        img = ap.blob;
      }
      var octets = img.getBytes();
      var type = typeImageDesOctets_(octets);
      // Des octets qu'on ne reconnaît pas donneraient un 400 à coup sûr : on le dit sans payer.
      if (!type) return { voie: voie, blocs: null, motif: 'http-400' };
      return { voie: voie, blocs: [entete, { type: 'image', source: {
        type: 'base64', media_type: type, data: Utilities.base64Encode(octets) } }] };
    }
    // Voie texte : le texte EXACT d'un format bureautique, via l'extraction existante.
    var texte = extraireTexte_(fichier.getBlob(), PIECE_VISION_TEXTE_MAX_CARS);
    if (texte === null) return { voie: voie, blocs: null, motif: 'ocr-echec' };
    if (!String(texte).trim()) return { voie: voie, blocs: null, motif: 'sans-texte' };
    return { voie: voie, blocs: [{ type: 'text',
      text: 'Nom du fichier : ' + nom + '\nTexte du document :\n' + texte }] };
  } catch (e) {
    journalErreur_('PieceVision', 'Préparation impossible (' + voie + ') : ' + e);
    return { voie: voie, blocs: null, motif: 'lecture-impossible' };
  }
}

/**
 * Lit un document par son IMAGE, UNE passe Sonnet 5. Même contrat que `extrairePiece_` : rend
 * l'extraction (ou null), et `hors` reçoit le motif d'un refus — plus la voie et l'usage, que
 * l'audit publie pour que le coût soit MESURÉ et non estimé.
 *
 * @param {GoogleAppsScript.Drive.File} fichier
 * @param {Object=} hors  objet de sortie : `{motif, voie, usage, dureeMs}`
 * @return {?Object}
 */
function extrairePieceVision_(fichier, hors) {
  hors = hors || {};
  hors.motif = 'vide';
  hors.usage = null;
  if (estPannePlateforme_()) { hors.motif = 'panne-llm'; return null; }
  var debut = Date.now();
  var prep = blocsVision_(fichier);
  hors.voie = prep.voie;
  if (!prep.blocs) { hors.motif = prep.motif || 'vide'; return null; }
  var ext = appelVision_(prep, hors);
  // ⚠️ C49-30 — LE TEXTE D'UN PDF PEUT MENTIR SUR SA LISIBILITÉ. Un scan dont l'OCR rend assez
  // de caractères passe le seuil et part en texte ; si le modèle n'en tire rien (« illisible »,
  // « vide »), le papier n'est pas condamné pour autant : on le lui MONTRE. Un seul second
  // essai, et seulement sur ces deux verdicts — une panne (réseau, crédit) ne se rejoue pas ici,
  // elle remonte à l'étape, qui sait s'arrêter.
  if (!ext && prep.voie === 'pdf-texte' && (hors.motif === 'illisible' || hors.motif === 'vide')) {
    var image = blocsVision_(fichier, true);
    if (image.blocs) {
      hors.voie = 'pdf-texte+pdf';
      ext = appelVision_(image, hors);
    }
  }
  hors.dureeMs = Date.now() - debut;
  return ext;
}

/**
 * UN appel Sonnet 5 sur des blocs préparés. Rend l'extraction filtrée ou `null` ; `hors` reçoit
 * le motif, et son `usage` CUMULE les appels du même papier — le coût d'un papier lu deux fois
 * est la somme, jamais le dernier.
 */
function appelVision_(prep, hors) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': getCleAnthropic_(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: PIECE_VISION_MODELE,
      max_tokens: PIECE_VISION_MAX_TOKENS,
      // Lire n'est pas raisonner : sans ce réglage Sonnet 5 pense par défaut (adaptatif), et
      // chaque papier paierait des jetons de réflexion qui ne changent pas ce qui est écrit.
      thinking: { type: 'disabled' },
      system: [{ type: 'text', text: PROMPT_PIECE_VISION, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prep.blocs }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, PIECE_VISION_MODELE);
  if (!reponse) { hors.motif = 'reseau'; return null; }
  if (reponse.getResponseCode() !== 200) {
    // ⚠️ Une panne de COMPTE (401, crédit épuisé) ne s'impute JAMAIS au papier (§9) : sans ce
    // motif, le premier papier touché était marqué « échec » à vie (revue #418, sondé).
    if (signalerPannePlateforme_(reponse.getResponseCode(), reponse.getContentText(), PIECE_VISION_MODELE)) {
      hors.motif = 'panne-llm';
      return null;
    }
    journalErreur_('PieceVision', 'HTTP ' + reponse.getResponseCode() + ' (' + prep.voie + ') : ' +
      tronquer_(reponse.getContentText(), 300));
    hors.motif = 'http-' + reponse.getResponseCode();
    return null;
  }

  var data;
  try { data = JSON.parse(reponse.getContentText()); } catch (e) {
    // Un 200 illisible est un hoquet, pas un verdict : motif hors des verdicts, donc rejoué.
    journalErreur_('PieceVision', 'Réponse non-JSON : ' + e);
    hors.motif = 'reponse-illisible';
    return null;
  }
  signalerRetablissement_();
  enregistrerUsage_(PIECE_VISION_MODELE, data.usage);
  hors.usage = sommerUsageVision_(hors.usage, data.usage || null);
  // ⚠️ Une réponse COUPÉE par le plafond est un JSON incomplet : le parseur la jette, et sans ce
  // motif on lirait « le modèle n'a rien tiré » sur un papier dont il a tiré TROP.
  var coupee = data.stop_reason === 'max_tokens';
  if (coupee) {
    hors.motif = 'coupee';
    journalErreur_('PieceVision', 'Réponse coupée à ' + PIECE_VISION_MAX_TOKENS + ' jetons (' + prep.voie + ').');
  }
  var brut = parserExtractionPiece_(texteReponse_(data));
  if (!brut) {
    if (!coupee) hors.motif = motifRefusExtraction_(lisibiliteDeclaree_(texteReponse_(data)));
    return null;
  }
  hors.motif = 'ok';
  var ext = filtrerApparence_(brut);
  ext.extracteur = EXTRACTEUR_PIECE_VISION;
  return ext;
}
