/**
 * Llm.gs — Appel à l'API Anthropic (Claude) pour classer un document.
 *
 * Endpoint : POST https://api.anthropic.com/v1/messages
 * En-têtes : x-api-key, anthropic-version: 2023-06-01, content-type: application/json
 *
 * Sortie attendue : JSON strict (schéma PLAN.md §4). On force le JSON par le
 * prompt et on parse défensivement (pas de dépendance dure à une option d'API).
 * Haiku par défaut ; Sonnet en fallback ponctuel si Haiku échoue.
 */

var PROMPT_SYSTEME =
  'Tu classes des documents personnels (mails, factures, contrats, relevés, courriers officiels...).\n' +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, selon ce schéma :\n' +
  '{\n' +
  '  "domaine": <un des domaines autorisés, exactement>,\n' +
  '  "categorie": <une des catégories connues ci-dessous, ou null>,\n' +
  '  "entite": <entité concernée (logement, véhicule, banque, diplôme...) ou null>,\n' +
  '  "type_doc": <type court: "Facture", "Relevé", "Contrat", "Attestation"...>,\n' +
  '  "date_doc": <date du document "AAAA-MM-JJ" ou null si absente>,\n' +
  '  "emetteur": <émetteur, ex "Hydro-Quebec", "Desjardins", "IRCC" ou null>,\n' +
  '  "sensible": <booléen, voir règle ci-dessous>,\n' +
  '  "confiance": <nombre entre 0 et 1, honnête>\n' +
  '}\n' +
  'RÈGLE DE SÉCURITÉ (prioritaire) : "sensible" vaut true PAR DÉFAUT. Ne mets false que si\n' +
  'tu es certain que le document ne touche NI l\'immigration/le statut, NI la fiscalité, NI des\n' +
  'données d\'identité sensibles.\n' +
  'Domaines autorisés : ' + domainesAutorises_().join(' | ') + '\n' +
  'Catégories connues : ' + categoriesConnues_().join(' | ') + ' (sinon null)';

/**
 * Classe un document. Tente Haiku, puis Sonnet en secours.
 * @param {{nomFichier:string, expediteur:string, sujet:string, extrait:string}} meta
 * @return {Object|null} la classification, ou null si échec total.
 */
function classifier_(meta) {
  var classif = appelAnthropic_(CONFIG.LLM_MODELE, meta);
  if (!classif) {
    journalInfo_('LLM', 'Haiku a échoué, tentative Sonnet pour « ' + meta.nomFichier + ' »');
    classif = appelAnthropic_(CONFIG.LLM_MODELE_FALLBACK, meta);
  }
  return classif;
}

/**
 * @param {string} modele
 * @param {Object} meta
 * @return {Object|null}
 */
function appelAnthropic_(modele, meta) {
  var contenu =
    'Nom du fichier : ' + meta.nomFichier + '\n' +
    'Expéditeur : ' + meta.expediteur + '\n' +
    'Sujet : ' + meta.sujet + '\n' +
    'Extrait du contenu (peut être vide) :\n' + (meta.extrait || '(aucun)');

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: CONFIG.LLM_MAX_TOKENS,
      system: PROMPT_SYSTEME,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    journalErreur_('LLM', 'HTTP ' + code + ' (' + modele + ') : ' +
      tronquer_(reponse.getContentText(), 500));
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse non-JSON (' + modele + ') : ' + e);
    return null;
  }

  if (data.stop_reason === 'refusal') {
    journalErreur_('LLM', 'Refus du modèle (' + modele + ')');
    return null;
  }

  return parserClassification_(texteReponse_(data));
}

/**
 * Appel avec un retry léger borné sur erreurs transitoires (429, 529, 5xx).
 * @return {HTTPResponse|null}
 */
function fetchAvecRetry_(url, options, modele) {
  var reponse;
  try {
    reponse = UrlFetchApp.fetch(url, options);
  } catch (e) {
    journalErreur_('LLM', 'Appel réseau échoué (' + modele + ') : ' + e);
    return null;
  }
  var code = reponse.getResponseCode();
  if (code === 429 || code === 529 || (code >= 500 && code < 600)) {
    Utilities.sleep(1500);
    try {
      reponse = UrlFetchApp.fetch(url, options);
    } catch (e) {
      journalErreur_('LLM', 'Retry réseau échoué (' + modele + ') : ' + e);
      return null;
    }
  }
  return reponse;
}

/**
 * Concatène les blocs de texte de la réponse Anthropic.
 * @param {Object} data
 * @return {string}
 */
function texteReponse_(data) {
  if (!data || !data.content) return '';
  var morceaux = [];
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') morceaux.push(data.content[i].text);
  }
  return morceaux.join('');
}

/**
 * Parse robuste : tente le JSON brut, sinon extrait le 1er objet { ... }.
 * Valide les champs essentiels.
 * @param {string} texte
 * @return {Object|null}
 */
function parserClassification_(texte) {
  if (!texte) return null;
  var obj = null;
  try {
    obj = JSON.parse(texte);
  } catch (e) {
    var debut = texte.indexOf('{');
    var fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      try {
        obj = JSON.parse(texte.substring(debut, fin + 1));
      } catch (e2) {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj.domaine !== 'string' || typeof obj.confiance !== 'number') {
    journalErreur_('LLM', 'JSON de classification invalide : ' + tronquer_(texte, 300));
    return null;
  }
  // Garde-fou : en l'absence d'info claire, on traite comme sensible.
  if (typeof obj.sensible !== 'boolean') obj.sensible = true;
  return obj;
}
