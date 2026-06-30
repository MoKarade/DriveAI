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
  '  "entites": <liste d\'entités SI le document en concerne plusieurs, sinon omets ce champ>,\n' +
  '  "type_doc": <type court: "Facture", "Relevé", "Contrat", "Attestation"...>,\n' +
  '  "date_doc": <date du document "AAAA-MM-JJ" ou null si absente>,\n' +
  '  "emetteur": <émetteur, ex "Hydro-Quebec", "Desjardins", "IRCC" ou null>,\n' +
  '  "sensible": <booléen, voir règle ci-dessous>,\n' +
  '  "confiance": <nombre entre 0 et 1, honnête>\n' +
  '}\n' +
  'RÈGLE DE SÉCURITÉ (zone protégée) : "sensible"=true UNIQUEMENT si le document touche\n' +
  'l\'immigration ou le statut (CSQ, IRCC, visa, passeport, permis de travail/séjour, résidence)\n' +
  'OU la fiscalité (déclaration d\'impôts, avis de cotisation). En cas de doute SUR CES\n' +
  'catégories, mets true. Pour TOUT le reste (paie, banque, factures, diplômes, logement,\n' +
  'véhicule, correspondance...), mets false : ces documents se classent automatiquement.\n' +
  'Domaines autorisés : ' + domainesAutorises_().join(' | ') + '\n' +
  'Catégories connues : ' + categoriesConnues_().join(' | ') + ' (sinon null)';

// Prompt d'ESCALADE : pour les documents que Haiku a mal cernés. On pousse le modèle
// à raisonner et à TOUJOURS proposer son meilleur domaine/catégorie (jamais « inconnu »),
// tout en gardant la même règle de sécurité (sensible).
var PROMPT_ESCALADE = PROMPT_SYSTEME + '\n\n' +
  'CONTEXTE : ce document a été jugé difficile à classer. Analyse-le EN PROFONDEUR (émetteur, ' +
  'type, contenu, indices du nom de fichier) et donne ta MEILLEURE estimation de domaine et de ' +
  'catégorie, même si tu n\'es pas totalement certain — ne laisse jamais le domaine vide ou hors ' +
  'liste. La règle de sécurité (sensible = immigration/statut ou fiscalité) reste prioritaire.';

/**
 * Classe un document. Haiku d'abord ; si échec ou confiance basse (et NON sensible),
 * escalade vers une analyse approfondie (Sonnet, plusieurs passes) et garde la meilleure.
 * @param {{nomFichier:string, expediteur:string, sujet:string, extrait:string}} meta
 * @return {Object|null} la classification, ou null si échec total.
 */
function classifier_(meta) {
  var classif = appelAnthropic_(CONFIG.LLM_MODELE, meta);

  // Échec TOTAL de Haiku → fallback Sonnet SIMPLE (1 appel), comme en Phase 1. On n'escalade
  // PAS en multi-passes sur un échec : sinon un doc qui fait systématiquement planter le parsing
  // (jamais inscrit à l'Index) rejouerait Haiku + N×Sonnet à chaque tick → emballement de coût.
  if (!classif) {
    journalInfo_('LLM', 'Haiku a échoué, fallback Sonnet pour « ' + meta.nomFichier + ' »');
    return appelAnthropic_(CONFIG.LLM_MODELE_FALLBACK, meta);
  }

  // Confiance basse + doc NON sensible → analyse approfondie (multi-passes), bornée par run
  // (un doc sensible part en revue de toute façon — inutile de dépenser du Sonnet).
  if (classif.confiance < CONFIG.SEUIL_CONFIANCE && classif.sensible !== true && escaladeAutorisee_()) {
    journalInfo_('LLM', 'Analyse approfondie (Sonnet ×' + CONFIG.LLM_ESCALADE_PASSES +
      ') pour « ' + meta.nomFichier + ' »');
    var approfondi = analyseApprofondie_(meta);
    if (approfondi && approfondi.confiance >= classif.confiance) classif = approfondi;
  }
  return classif;
}

// Compteur d'escalades par run (plafond anti-emballement de coût). Remis à zéro au tick.
var _escaladesCeRun = 0;
function reinitialiserEscalades_() { _escaladesCeRun = 0; }
function escaladeAutorisee_() { return _escaladesCeRun < CONFIG.LLM_ESCALADE_MAX_PAR_RUN; }

/**
 * Analyse approfondie : plusieurs passes Sonnet avec le prompt d'escalade ; renvoie la
 * meilleure classification (domaine majoritaire, puis confiance la plus haute).
 * @param {Object} meta
 * @return {Object|null}
 */
function analyseApprofondie_(meta) {
  _escaladesCeRun++;
  var resultats = [];
  for (var i = 0; i < CONFIG.LLM_ESCALADE_PASSES; i++) {
    var r = appelAnthropic_(CONFIG.LLM_MODELE_FALLBACK, meta, PROMPT_ESCALADE);
    if (r) resultats.push(r);
  }
  return resultats.length ? meilleureClassification_(resultats) : null;
}

/**
 * Choisit la meilleure classification d'un lot : domaine le plus fréquent (consensus),
 * puis, à égalité, la confiance la plus haute.
 * @param {Object[]} resultats
 * @return {Object}
 */
function meilleureClassification_(resultats) {
  var freq = {};
  resultats.forEach(function (r) { freq[r.domaine] = (freq[r.domaine] || 0) + 1; });
  var meilleur = resultats[0];
  for (var i = 1; i < resultats.length; i++) {
    var r = resultats[i];
    var fR = freq[r.domaine], fM = freq[meilleur.domaine];
    if (fR > fM || (fR === fM && r.confiance > meilleur.confiance)) meilleur = r;
  }
  return meilleur;
}

/**
 * @param {string} modele
 * @param {Object} meta
 * @param {string} [systeme]  prompt système (défaut : PROMPT_SYSTEME)
 * @return {Object|null}
 */
function appelAnthropic_(modele, meta, systeme) {
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
      system: systeme || PROMPT_SYSTEME,
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
  // Multi-entités : `entites` n'est l'autorité que s'il liste ≥2 entités distinctes ;
  // sinon `entite` (mono) fait foi. (La zone protégée reste pilotée par `sensible`,
  // jamais par les entités, cf. motifDeRevue_.)
  if (Array.isArray(obj.entites)) {
    var vues = {}, propres = [];
    for (var k = 0; k < obj.entites.length; k++) {
      var e = obj.entites[k];
      if (typeof e === 'string' && e.trim() && !vues[e]) { vues[e] = true; propres.push(e); }
    }
    if (propres.length >= 2) obj.entites = propres; else delete obj.entites;
  } else if (obj.entites) {
    delete obj.entites;
  }
  return obj;
}

/* ============================================================================
 * PHASE 3 — Extraction d'intentions (tâches / événements) depuis un mail.
 * ==========================================================================*/

// Prompt d'EXTRACTION D'INTENTIONS : distinct du prompt de classement documentaire ci-dessus.
// La zone protégée s'applique ICI AUSSI (jamais d'intention sur un mail immigration/fiscal) —
// en plus du filtre déterministe indépendant `toucheZoneProtegee_` (Prefiltre.gs, défense en
// profondeur : on ne fait pas reposer le garde-fou sur le seul respect du prompt par le LLM).
var PROMPT_INTENTIONS =
  'Tu repères des ACTIONS À FAIRE et des RENDEZ-VOUS DATÉS dans un email personnel.\n' +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, selon ce schéma :\n' +
  '{\n' +
  '  "intentions": [\n' +
  '    {\n' +
  '      "type": <"tache" ou "evenement">,\n' +
  '      "titre": <court et actionnable, ex "Payer la facture Hydro-Québec">,\n' +
  '      "date": <"AAAA-MM-JJ" ou null>,\n' +
  '      "heure": <"HH:MM" (24h) ou null, UNIQUEMENT si une heure précise est donnée>,\n' +
  '      "confiance": <nombre entre 0 et 1, honnête>\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  'Routage : date ET heure précises (rendez-vous, réunion, appel planifié) → "evenement". ' +
  'Action/échéance sans heure précise (payer, renvoyer, répondre, renouveler...) → "tache", ' +
  'même avec une date limite.\n' +
  'RÈGLE DE SÉCURITÉ (zone protégée) : ne propose AUCUNE intention si le mail touche ' +
  'l\'immigration ou le statut (CSQ, IRCC, visa, passeport, permis de travail/séjour, résidence) ' +
  'OU la fiscalité (déclaration d\'impôts, avis de cotisation) — renvoie {"intentions": []} pour ' +
  'ces mails (ils restent gérés par le classement documentaire existant, jamais ici).\n' +
  'Si aucune action ni rendez-vous clair n\'est détecté, renvoie {"intentions": []}.';

/**
 * Extrait les intentions (tâches/événements) d'un mail. Haiku d'abord ; fallback Sonnet
 * SIMPLE (1 appel) sur échec total — même politique anti-emballement que `classifier_`
 * (pas d'escalade multi-passes ici, ce n'est pas une zone d'incertitude à arbitrer).
 * @param {{expediteur:string, sujet:string, corps:string}} meta
 * @return {Object[]|null}  liste d'intentions ([] si aucune), ou null si échec total.
 */
function extraireIntentions_(meta) {
  var resultat = appelIntentions_(CONFIG.LLM_MODELE, meta);
  if (!resultat) {
    journalInfo_('LLM', 'Extraction d\'intentions : Haiku a échoué, fallback Sonnet pour « ' + meta.sujet + ' »');
    resultat = appelIntentions_(CONFIG.LLM_MODELE_FALLBACK, meta);
  }
  return resultat ? resultat.intentions : null;
}

/**
 * @param {string} modele
 * @param {{expediteur:string, sujet:string, corps:string}} meta
 * @return {{intentions:Object[]}|null}
 */
function appelIntentions_(modele, meta) {
  var contenu =
    'Expéditeur : ' + meta.expediteur + '\n' +
    'Sujet : ' + meta.sujet + '\n' +
    'Corps (extrait) :\n' + (meta.corps || '(vide)');

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: CONFIG.LLM_MAX_TOKENS_INTENTIONS,
      system: PROMPT_INTENTIONS,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    journalErreur_('LLM', 'Intentions HTTP ' + code + ' (' + modele + ') : ' +
      tronquer_(reponse.getContentText(), 500));
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse intentions non-JSON (' + modele + ') : ' + e);
    return null;
  }
  if (data.stop_reason === 'refusal') return null;

  return parserIntentions_(texteReponse_(data));
}

/**
 * Parse robuste de la réponse d'extraction d'intentions. Normalise et VALIDE chaque champ
 * (jamais de confiance aveugle dans la sortie LLM) ; un type "evenement" sans date+heure
 * valides est dégradé en "tache" plutôt que rejeté (l'info n'est jamais perdue).
 * @param {string} texte
 * @return {{intentions:Object[]}|null}
 */
function parserIntentions_(texte) {
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
  if (!obj || !Array.isArray(obj.intentions)) {
    journalErreur_('LLM', 'JSON d\'intentions invalide : ' + tronquer_(texte, 300));
    return null;
  }

  var propres = [];
  for (var i = 0; i < obj.intentions.length; i++) {
    var it = obj.intentions[i];
    if (!it || typeof it.titre !== 'string' || !it.titre.trim()) continue;
    var date = (typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.date)) ? it.date : null;
    var heure = (typeof it.heure === 'string' && /^\d{2}:\d{2}$/.test(it.heure)) ? it.heure : null;
    var type = (it.type === 'evenement' && date && heure) ? 'evenement' : 'tache';
    propres.push({
      type: type,
      titre: it.titre.trim(),
      date: date,
      heure: heure,
      confiance: typeof it.confiance === 'number' ? it.confiance : 0
    });
  }
  return { intentions: propres };
}
