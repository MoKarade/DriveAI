/**
 * Prefiltre.gs — Écarte les mails sans intérêt AVANT tout appel LLM coûteux, Phase 3.
 *
 * Trois étages, du moins cher au plus cher (objectif : tenir le budget < 10 $/mois même en
 * scannant TOUS les mails récents, pas seulement ceux avec PJ) :
 *   1. `ecarteParMotsCles_` — déterministe (expéditeur/sujet), gratuit.
 *   2. `toucheZoneProtegee_` — déterministe (expéditeur/sujet/corps), gratuit. Défense en
 *      profondeur du garde-fou §1 (immigration/fiscal), INDÉPENDANTE du jugement du LLM.
 *   3. `miniVerifActionRdv_` — mini-check Haiku (expéditeur+sujet SEULS, ~10 tokens de
 *      sortie), écarte le reste avant de payer le coût plus élevé de l'extraction complète.
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
 * Étage 3 — mini-check Haiku : question binaire, EXPÉDITEUR+SUJET seuls (jamais le corps,
 * pour rester très peu coûteux). Dégrade en LAISSANT PASSER (true) sur échec LLM : un
 * faux-négatif ici coûterait au pire un appel d'extraction complète en plus (qui répondra
 * probablement []), alors qu'un faux-positif raterait silencieusement une vraie action.
 * @param {string} expediteur
 * @param {string} sujet
 * @return {boolean}
 */
function miniVerifActionRdv_(expediteur, sujet) {
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
      system: 'Réponds UNIQUEMENT par OUI ou NON, sans rien d\'autre. OUI si ce mail peut ' +
        'PLAUSIBLEMENT contenir une action à faire (échéance, paiement, formulaire) ou un ' +
        'rendez-vous daté. NON pour une newsletter, une notification automatique, une pub, ou ' +
        'tout mail clairement informatif sans action attendue.',
      messages: [{ role: 'user', content: 'Expéditeur : ' + expediteur + '\nSujet : ' + sujet }]
    }),
    muteHttpExceptions: true
  };

  var reponse;
  try {
    reponse = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  } catch (e) {
    journalErreur_('Prefiltre', 'Mini-check réseau échoué : ' + e);
    return true; // dégradation : laisse passer plutôt que de risquer de rater une vraie action
  }
  if (reponse.getResponseCode() !== 200) return true;

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    return true;
  }
  enregistrerUsage_(CONFIG.LLM_MODELE, data.usage); // mesure de coût réel (P1-09)
  var texte = texteReponse_(data).toUpperCase();
  return texte.indexOf('NON') === -1; // tout ce qui n'est pas explicitement "NON" passe
}
