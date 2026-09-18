/**
 * Piece.gs — LIRE ce qu'un papier contient (ADR-0061, chantier #49 lot C49-2).
 *
 * ── UN PROMPT DÉDIÉ, ET JAMAIS MÊLÉ À CELUI DU CLASSEMENT ───────────────────────────────
 *
 * Le classement répond à « où ranger ce document ». L'extraction répond à « que dit-il ».
 * Ce sont deux questions, et l'ADR-0061 §5.1 exige qu'elles restent deux prompts : mêlées,
 * la première se dégrade au profit de la seconde sans que rien ne le signale — le classement
 * marche depuis des mois, et il n'y a aucune raison de le remettre en jeu pour lire un
 * numéro de téléphone.
 *
 * ── POURQUOI C'EST QUASI GRATUIT SUR LE FLUX VIVANT ─────────────────────────────────────
 *
 * Le TEXTE est déjà en main au moment du classement (OCR déjà payé, `meta.extrait`). Une
 * passe Haiku de plus ne relit rien : elle ne coûte que ses jetons. C'est le rattrapage des
 * ~19 900 documents déjà classés qui coûte, et lui passe par le runner (C49-4) — pas ici.
 *
 * ── JAMAIS BLOQUANTE ────────────────────────────────────────────────────────────────────
 *
 * Appelée sous try/catch, APRÈS que le classement a décidé. Une extraction qui échoue laisse
 * le document rangé comme avant : c'est une INFORMATION EN PLUS, jamais une condition.
 *
 * ⚠️ LE PARSEUR EST TOLÉRANT SUR LA FORME, STRICT SUR LE FOND. Un modèle varie dans sa façon
 * de rendre (une liste au lieu d'un texte, un nombre en chaîne) : jeter une extraction juste
 * après avoir payé l'appel serait absurde. Mais on ne DEVINE jamais le fond — « environ 4 »
 * ne devient pas 4, et une date incomplète n'est pas une date.
 */

/** Le modèle de l'extraction. Haiku UNE passe (ADR-0061 §5.1) : lire n'est pas classer. */
var PIECE_MODELE = 'claude-haiku-4-5-20251001';

/** Bornes alignées sur ce que la Mémoire accepte — on n'envoie pas un lot qu'on sait refusé. */
var PIECE_MAX_TOKENS = 1500;

var PROMPT_PIECE =
  'Tu lis un document personnel de Marc Richard et tu rapportes CE QU\'IL CONTIENT. ' +
  'Tu ne le classes pas : son rangement est déjà décidé.\n' +
  'Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après :\n' +
  '{\n' +
  '  "resume": <2 ou 3 phrases, DANS LA LANGUE DU DOCUMENT, ce que le papier dit>,\n' +
  '  "type": <type court et précis ("bail", "avis de cotisation", "police d\'assurance") ou null>,\n' +
  '  "emetteur": <l\'ORGANISATION qui émet le document, ou null>,\n' +
  '  "langue": <"fr", "en"… ou null>,\n' +
  '  "date_document": <"AAAA-MM-JJ" ou null — JAMAIS une date partielle>,\n' +
  '  "date_echeance": <"AAAA-MM-JJ" ou null — fin de bail, expiration, échéance de paiement>,\n' +
  '  "titulaire": <À QUI ce papier appartient (Marc ou un proche), ou null si tu n\'es pas sûr>,\n' +
  '  "titulaire_confiance": <0..1 — ta certitude SUR LE TITULAIRE, obligatoire si titulaire>,\n' +
  '  "champs": {\n' +
  '    "montants":  [{"libelle": <ce que le montant est>, "valeur": <tel qu\'écrit>}],\n' +
  '    "numeros":   [{"libelle": <ce que le numéro identifie>, "valeur": <tel qu\'écrit>}],\n' +
  '    "personnes": [{"libelle": <son rôle>, "valeur": <son nom>}],\n' +
  '    "lieux":     [{"libelle": <ce que le lieu est>, "valeur": <tel qu\'écrit>}]\n' +
  '  },\n' +
  '  "libres": { <toute autre information utile : "clé": "valeur"> },\n' +
  '  "confiance": <0..1, honnête>\n' +
  '}\n' +
  'TITULAIRE : si le document est au nom de deux personnes, s\'il est vierge, ou si aucun nom ' +
  'n\'apparaît, réponds null. « Inconnu » est une bonne réponse ; deviner ne l\'est pas.\n' +
  'MONTANTS ET NUMÉROS : recopie-les TELS QU\'ÉCRITS, sans les convertir ni les arrondir.\n' +
  'LIBRES : au plus 40 clés, courtes. Ce qui ne rentre dans aucune famille va là.\n' +
  'NE DEVINE RIEN : un champ que le document ne porte pas vaut null. Une date incomplète vaut null.';

/**
 * Le parseur de l'extraction. PUR, testable sans réseau.
 *
 * ⚠️ TOLÉRANT SUR LA FORME : un modèle rend parfois une liste là où on attend un texte, un
 * nombre en chaîne, ou entoure son JSON de ```json. Jeter une extraction JUSTE après avoir
 * payé l'appel est le pire des deux mondes.
 *
 * ⚠️ STRICT SUR LE FOND : rien n'est deviné, rien n'est complété. Ce que le modèle n'a pas
 * dit reste absent — c'est `pieceMemoire_` qui décidera de retomber sur ce que le NOM classé
 * portait déjà.
 *
 * @param {string} texte  la réponse brute du modèle
 * @return {?Object} l'extraction, ou null si elle n'est pas exploitable
 */
function parserExtractionPiece_(texte) {
  var brut = String(texte == null ? '' : texte).trim();
  if (!brut) return null;
  // Les clôtures Markdown : le modèle en met parfois malgré la consigne.
  brut = brut.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  var debut = brut.indexOf('{');
  var fin = brut.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;

  var o;
  try { o = JSON.parse(brut.slice(debut, fin + 1)); } catch (e) { return null; }
  if (!o || typeof o !== 'object') return null;

  var out = {
    resume: aplatirTextePiece_(o.resume),
    type: aplatirTextePiece_(o.type),
    emetteur: aplatirTextePiece_(o.emetteur),
    langue: aplatirTextePiece_(o.langue),
    date_document: aplatirTextePiece_(o.date_document),
    date_echeance: aplatirTextePiece_(o.date_echeance),
    titulaire: aplatirTextePiece_(o.titulaire),
    titulaire_confiance: aplatirNombrePiece_(o.titulaire_confiance),
    champs: (o.champs && typeof o.champs === 'object') ? o.champs : null,
    libres: (o.libres && typeof o.libres === 'object') ? o.libres : null,
    confiance: aplatirNombrePiece_(o.confiance)
  };

  // ⚠️ UNE EXTRACTION QUI NE PORTE RIEN N'EST PAS UNE EXTRACTION. Sans ce test, un appel
  // muet produirait une pièce vide — et une pièce vide est pire qu'une pièce absente : elle
  // occupe la place de celle qu'on aurait pu extraire, et l'idempotence empêche de réessayer.
  var porteQuelqueChose = !!(out.resume || out.type || out.emetteur || out.date_document ||
    out.date_echeance || out.titulaire ||
    (out.champs && Object.keys(out.champs).length) ||
    (out.libres && Object.keys(out.libres).length));
  return porteQuelqueChose ? out : null;
}

/**
 * Un texte, quelle que soit la forme rendue. Une LISTE est jointe (le modèle rend parfois
 * des instructions en tableau), un nombre devient sa chaîne, un objet est REFUSÉ — « [object
 * Object] » présenté comme un contenu serait un mensonge, pas une tolérance.
 */
function aplatirTextePiece_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { var s = v.replace(/\s+/g, ' ').trim(); return s || null; }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var morceaux = [];
    for (var i = 0; i < v.length; i++) {
      var m = aplatirTextePiece_(v[i]);
      if (m) morceaux.push(m);
    }
    return morceaux.length ? morceaux.join(' ') : null;
  }
  return null;
}

/**
 * Un nombre, y compris rendu en chaîne. ⚠️ `null` reste `null` : « absent » n'est pas
 * « zéro », et `Number(null)` vaut 0 — c'est le défaut que le test de C49-1 a attrapé sur
 * la confiance du titulaire.
 */
function aplatirNombrePiece_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

/* ---------- I/O (réseau) ---------- */

/**
 * Extrait le contenu d'un document, UNE passe Haiku.
 *
 * ⚠️ APRÈS le classement, jamais avant : le rangement du document ne dépend pas de ce qui est
 * lu ici, et une extraction qui échoue ne doit rien changer à ce qui marchait.
 *
 * ⚠️ AUCUN APPEL SI LE TEXTE EST VIDE. Sans extrait, le modèle n'a que le nom du fichier —
 * qu'on connaît déjà. Payer un appel pour se faire répéter ce qu'on sait, c'est le genre de
 * dépense qui ne se voit que dans la facture.
 *
 * @param {{nomFichier:string, extrait:string}} meta
 * @return {?Object} l'extraction, ou null
 */
function extrairePiece_(meta) {
  if (!meta || !String(meta.extrait || '').trim()) return null;
  if (estPannePlateforme_()) return null;

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: PIECE_MODELE,
      max_tokens: PIECE_MAX_TOKENS,
      // Le prompt est CONSTANT : en cache éphémère il n'est facturé plein tarif qu'une fois
      // par fenêtre. Sur le flux vivant épars le gain est proche de nul (TTL expiré entre
      // deux documents) ; sur le rattrapage batché il compte. Dit ici plutôt que promis.
      system: [{ type: 'text', text: PROMPT_PIECE, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: 'Nom du fichier : ' + String(meta.nomFichier || '') + '\n' +
          'Texte du document :\n' + String(meta.extrait || '')
      }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, PIECE_MODELE);
  if (!reponse) return null;
  if (reponse.getResponseCode() !== 200) {
    // Une panne de PLATEFORME n'est pas un échec du document (§9) : elle se signale, et les
    // appels restants du run échouent vite sans réseau.
    if (!signalerPannePlateforme_(reponse.getResponseCode(), reponse.getContentText(), PIECE_MODELE)) {
      journalErreur_('Pièce', 'HTTP ' + reponse.getResponseCode() + ' : ' +
        tronquer_(reponse.getContentText(), 300));
    }
    return null;
  }

  var data;
  try { data = JSON.parse(reponse.getContentText()); } catch (e) {
    journalErreur_('Pièce', 'Réponse non-JSON : ' + e);
    return null;
  }
  signalerRetablissement_();
  enregistrerUsage_(PIECE_MODELE, data.usage);
  return parserExtractionPiece_(texteReponse_(data));
}
