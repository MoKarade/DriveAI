/**
 * Prefiltre.gs — Écarte les mails sans intérêt AVANT tout appel LLM coûteux, Phase 3.
 *
 * Trois étages, du moins cher au plus cher (objectif : tenir le budget < 10 $/mois même en
 * scannant TOUS les mails récents, pas seulement ceux avec PJ) :
 *   1. `ecarteParMotsCles_` — déterministe (expéditeur/sujet), gratuit.
 *   2. `toucheZoneProtegee_` — déterministe (expéditeur/sujet/corps), gratuit. Défense en
 *      profondeur du garde-fou §1 (immigration/fiscal), INDÉPENDANTE du jugement du LLM.
 *   3. `miniCheckMail_` — mini-check Haiku (expéditeur+sujet SEULS, ~20 tokens de sortie) :
 *      écarte le reste avant de payer l'extraction complète, ET porte le flag `important`
 *      du chantier #14 (deux signaux pour le prix d'un appel).
 */

/**
 * Étage 1 — filtre déterministe sur expéditeur/sujet. Gratuit.
 * @param {string} expediteur
 * @param {string} sujet
 * @return {boolean} vrai si le mail doit être écarté SANS appel LLM.
 */
function ecarteParMotsCles_(expediteur, sujet) {
  return contientMotif_((expediteur || '') + ' ' + (sujet || ''), CONFIG.PREFILTRE_MOTIFS_REJET);
}

/**
 * Garde-fou §1, défense en profondeur : vrai si le texte touche l'immigration/le statut ou la
 * fiscalité. Indépendant du `sensible` renvoyé par le LLM — sert de filet AVANT (on n'envoie même
 * pas le mail à l'extraction) et peut aussi re-vérifier la réponse du LLM en sortie.
 * @param {string} texte
 * @return {boolean}
 */
function toucheZoneProtegee_(texte) {
  return contientMotif_(texte || '', CONFIG.MOTS_CLES_PROTEGES_INTENTIONS);
}

/** @return {boolean} vrai si `texte` (normalisé, insensible à la casse) contient un des `motifs`. */
function contientMotif_(texte, motifs) {
  var t = texte.toLowerCase();
  for (var i = 0; i < motifs.length; i++) {
    if (correspondMotif_(t, motifs[i].toLowerCase())) return true;
  }
  return false;
}

/**
 * Un motif COURT (≤ 4 caractères — sigles type « arc », « csq », « visa ») n'est reconnu qu'en
 * MOT ENTIER : en sous-chaîne libre, « arc » matcherait « Marc » (le prénom de l'utilisateur !)
 * et « cra » matcherait « écran » — un faux positif neutraliserait silencieusement la création
 * de tâches/événements sur un grand nombre de mails anodins (même piège que « sensible » trop
 * large, cf. LESSONS « garde-fou étroit »). Un motif plus long reste en sous-chaîne simple
 * (suffisamment spécifique pour qu'une sous-chaîne soit déjà un signal fiable).
 * @param {string} texteMinuscule
 * @param {string} motifMinuscule
 * @return {boolean}
 */
function correspondMotif_(texteMinuscule, motifMinuscule) {
  if (motifMinuscule.length > 4) return texteMinuscule.indexOf(motifMinuscule) !== -1;
  var echappe = motifMinuscule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-zà-ÿ0-9])' + echappe + '($|[^a-zà-ÿ0-9])').test(texteMinuscule);
}

/**
 * Étage 3 — mini-check Haiku (chantier #14, ADR-0010 §3) : DEUX signaux en UN appel,
 * EXPÉDITEUR+SUJET seuls (jamais le corps, pour rester très peu coûteux) :
 *   - `action`    : le mail peut plausiblement contenir une action/un rendez-vous (comme avant) ;
 *   - `important` : le mail demande l'ATTENTION de Marc (question directe, échéance,
 *     administration/officiel) → section « À traiter » du résumé hebdo, rien d'autre
 *     (aucune écriture Gmail — lecture seule §3 —, aucune notification immédiate).
 * Dégradations ASYMÉTRIQUES voulues (cf. parserMiniCheck_) : `action` LAISSE PASSER sur échec
 * (rater une vraie action coûte cher, un faux passage ne coûte qu'une extraction qui rendra []) ;
 * `important` reste FERMÉ sur échec (un faux « important » spamme la section « À traiter » —
 * anti-bruit, décision Marc).
 * @param {string} expediteur
 * @param {string} sujet
 * @return {{action:boolean, important:boolean}}
 */
function miniCheckMail_(expediteur, sujet) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: CONFIG.LLM_MODELE,
      max_tokens: CONFIG.LLM_MAX_TOKENS_MINICHECK,
      system: 'Réponds UNIQUEMENT avec un objet JSON {"action": true|false, "important": true|false}, ' +
        'sans rien d\'autre. "action"=true si ce mail peut PLAUSIBLEMENT contenir une action à faire ' +
        '(échéance, paiement, formulaire) ou un rendez-vous daté ; false pour une newsletter, une ' +
        'notification automatique, une pub, ou tout mail clairement informatif. "important"=true ' +
        'UNIQUEMENT si une réponse ou une action PERSONNELLE du destinataire est attendue : question ' +
        'directe qui attend SA réponse, mise en demeure ou relance d\'une administration, échéance ' +
        'qui exige un geste de SA part. JAMAIS pour un relevé disponible, une confirmation, un reçu, ' +
        'une facture récurrente ou une offre commerciale. En cas de doute, "important"=false.',
      messages: [{ role: 'user', content: 'Expéditeur : ' + expediteur + '\nSujet : ' + sujet }]
    }),
    muteHttpExceptions: true
  };

  var reponse;
  try {
    reponse = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  } catch (e) {
    journalErreur_('Prefiltre', 'Mini-check réseau échoué : ' + e);
    return parserMiniCheck_(null); // dégradation asymétrique (action passe, important fermé)
  }
  if (reponse.getResponseCode() !== 200) return parserMiniCheck_(null);

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    return parserMiniCheck_(null);
  }
  enregistrerUsage_(CONFIG.LLM_MODELE, data.usage); // mesure de coût réel (P1-09)
  return parserMiniCheck_(texteReponse_(data));
}

/**
 * Parse PUR (testé) de la réponse du mini-check. Jamais de confiance aveugle dans la sortie LLM :
 * seul un booléen JSON explicite est pris tel quel. Défauts sur réponse absente/illisible :
 * `action: true` (ouvert — ne jamais rater une vraie action pour une panne de mini-check),
 * `important: false` (fermé — anti-bruit : la section « À traiter » ne se remplit que sur un
 * signal explicite). Compat : une réponse texte contenant explicitement NON ferme `action`
 * (ancien format binaire, au cas où le modèle répondrait hors JSON).
 * @param {?string} texte
 * @return {{action:boolean, important:boolean}}
 */
function parserMiniCheck_(texte) {
  var defaut = { action: true, important: false };
  if (!texte) return defaut;
  var obj = null;
  try {
    obj = JSON.parse(texte);
  } catch (e) {
    var debut = texte.indexOf('{');
    var fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      try { obj = JSON.parse(texte.substring(debut, fin + 1)); } catch (e2) { obj = null; }
    }
  }
  if (!obj) {
    // Hors JSON : seul un « NON » explicite ferme l'action (comportement de l'ancien mini-check).
    return { action: texte.toUpperCase().indexOf('NON') === -1, important: false };
  }
  return {
    action: typeof obj.action === 'boolean' ? obj.action : true,
    important: obj.important === true
  };
}
