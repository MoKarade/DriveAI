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
  'ethnique, jamais de jugement.\n' +
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  // ⚠️ Le trait d'union COLLE : « Marc-André Richard » est une autre personne que Marc.
  return /(^|[^a-z-])marc([^a-z-]|$)/.test(t) && /(^|[^a-z-])richard([^a-z-]|$)/.test(t);
}

/**
 * PURE. Retire « l'apparence » si le papier n'est pas celui de Marc. Rend une COPIE : on ne
 * mute pas l'extraction que l'appelant tient.
 */
function filtrerApparence_(extraction) {
  if (!extraction || !extraction.libres) return extraction;
  if (titulaireEstMarc_(extraction.titulaire)) return extraction;
  var libres = {};
  var retire = false;
  for (var cle in extraction.libres) {
    if (!Object.prototype.hasOwnProperty.call(extraction.libres, cle)) continue;
    if (/^\s*apparence/i.test(cle)) { retire = true; continue; }
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
  if (!meta || meta.getResponseCode() !== 200) return null;
  var lien;
  try { lien = JSON.parse(meta.getContentText()).thumbnailLink; } catch (e) { return null; }
  if (!lien) return null;
  lien = String(lien).replace(/=s\d+$/, '') + '=s' + PIECE_VISION_APERCU_PX;
  var img = fetchDriveAvecRetry_(lien,
    { headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true });
  if (!img || img.getResponseCode() !== 200) return null;
  return img.getBlob();
}

/**
 * Le contenu du message : le fichier sous la forme que l'API lit, plus son nom.
 * Rend `{blocs, voie}` ou `{blocs:null, voie, motif}` — jamais une exception.
 */
function blocsVision_(fichier) {
  var nom = fichier.getName();
  var mime = fichier.getMimeType();
  var voie = voieVision_(mime, nom, fichier.getSize());
  var entete = { type: 'text', text: 'Nom du fichier : ' + nom };
  try {
    if (voie === 'pdf' || voie === 'export-pdf') {
      var pdf = voie === 'pdf' ? fichier.getBlob() : fichier.getAs('application/pdf');
      return { voie: voie, blocs: [entete, { type: 'document', source: {
        type: 'base64', media_type: 'application/pdf',
        data: Utilities.base64Encode(pdf.getBytes()) } }] };
    }
    if (voie === 'image' || voie === 'apercu') {
      var img = voie === 'image' ? fichier.getBlob() : apercuDrive_(fichier.getId());
      if (!img) return { voie: voie, blocs: null, motif: 'apercu-absent' };
      var type = String(img.getContentType() || '').toLowerCase();
      if (MIMES_IMAGE_VISION.indexOf(type) === -1) type = 'image/png';
      return { voie: voie, blocs: [entete, { type: 'image', source: {
        type: 'base64', media_type: type, data: Utilities.base64Encode(img.getBytes()) } }] };
    }
    // Voie texte : le texte EXACT d'un format bureautique, via l'extraction existante.
    var texte = extraireTexte_(fichier.getBlob());
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
  if (estPannePlateforme_()) { hors.motif = 'panne-llm'; return null; }
  var debut = Date.now();
  var prep = blocsVision_(fichier);
  hors.voie = prep.voie;
  if (!prep.blocs) { hors.motif = prep.motif || 'vide'; return null; }

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
  hors.dureeMs = Date.now() - debut;
  if (!reponse) { hors.motif = 'reseau'; return null; }
  if (reponse.getResponseCode() !== 200) {
    if (!signalerPannePlateforme_(reponse.getResponseCode(), reponse.getContentText(), PIECE_VISION_MODELE)) {
      journalErreur_('PieceVision', 'HTTP ' + reponse.getResponseCode() + ' (' + prep.voie + ') : ' +
        tronquer_(reponse.getContentText(), 300));
    }
    hors.motif = 'http-' + reponse.getResponseCode();
    return null;
  }

  var data;
  try { data = JSON.parse(reponse.getContentText()); } catch (e) {
    journalErreur_('PieceVision', 'Réponse non-JSON : ' + e);
    return null;
  }
  signalerRetablissement_();
  enregistrerUsage_(PIECE_VISION_MODELE, data.usage);
  hors.usage = data.usage || null;
  // ⚠️ Une réponse COUPÉE par le plafond est un JSON incomplet : le parseur la jette, et sans ce
  // motif on lirait « le modèle n'a rien tiré » sur un papier dont il a tiré TROP.
  if (data.stop_reason === 'max_tokens') {
    hors.motif = 'coupee';
    journalErreur_('PieceVision', 'Réponse coupée à ' + PIECE_VISION_MAX_TOKENS + ' jetons (' + prep.voie + ').');
  }
  var brut = parserExtractionPiece_(texteReponse_(data));
  if (!brut) {
    if (hors.motif !== 'coupee') hors.motif = motifRefusExtraction_(lisibiliteDeclaree_(texteReponse_(data)));
    return null;
  }
  hors.motif = 'ok';
  var ext = filtrerApparence_(brut);
  ext.extracteur = EXTRACTEUR_PIECE_VISION;
  return ext;
}
