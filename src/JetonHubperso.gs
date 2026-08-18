/**
 * JetonHubperso.gs — jeton OAuth du projet GCP « hubperso » (hubperso) pour Tasks & Calendar (ADR-0041).
 *
 * POURQUOI (incident 14-17/08) : le projet GCP PAR DÉFAUT d'Apps Script est CACHÉ — aucune console
 * n'y donne accès, à personne, propriétaire compris — donc l'API Tasks n'y sera jamais « activée »
 * par un clic. Décision Marc 2026-08-17 : les API Tasks/Calendar s'administrent dans SON projet
 * « hubperso » ; le moteur obtient un jeton OAuth de CE projet (client OAuth de Marc, consentement
 * UNIQUE → refresh token en Script Properties, access token rafraîchi par REST) et ne passe PLUS
 * par `ScriptApp.getOAuthToken()` pour ces deux API. Gmail/Drive/Sheets restent sur le jeton du
 * script : `gmail.modify` est un scope RESTREINT — sur un projet standard il exigerait une
 * vérification Google (CASA) ou le mode Test à re-consentement hebdomadaire (ADR-0041 §1).
 *
 * Garde-fous :
 *  - AUCUN secret ici (§2.4) : client id/secret/refresh token vivent dans les Script Properties.
 *  - Le `client_secret` ne transite QUE vers `HUBPERSO_URL_JETON` — seul point `UrlFetchApp.fetch`
 *    du fichier, verrouillé par `test/surface-tasks-calendar.test.js`.
 *  - ÉCHEC FERMÉ : pas de jeton → `null` (les appelants suspendent proprement, patron config-api —
 *    jamais de retry en boucle) ; `invalid_grant` (consentement révoqué) → purge + consigne Journal.
 *  - Le callback `?hubperso=1` (doGet, WebApp.gs) vérifie `state` en comparaison constante : l'URL
 *    `/exec` est PUBLIQUE — sans state, un tiers pourrait lier SON compte Google au moteur et
 *    recevoir les intentions (tâches/événements) extraites des mails de Marc. Refus MUET.
 *
 * Mise en service (une fois, pas-à-pas : docs/HUBPERSO.md) : Marc crée un client OAuth « Web » dans
 * hubperso, pose `DriveAI_HUBPERSO_CLIENT_ID` + `DriveAI_HUBPERSO_CLIENT_SECRET`, exécute
 * `lierCompteHubperso` (ce fichier) et clique l'URL de consentement que la fonction affiche.
 */

var HUBPERSO_URL_JETON = 'https://oauth2.googleapis.com/token';
var HUBPERSO_URL_CONSENTEMENT = 'https://accounts.google.com/o/oauth2/v2/auth';
// Scopes SENSIBLES mais pas restreints (autorisés sur une app perso « En production » non
// vérifiée, jetons persistants) — exactement les deux API concernées, rien de plus (§2.3).
var HUBPERSO_SCOPES = 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events';
// Marge avant expiration : un access token Google vit ~60 min ; on le considère périmé 7 min
// avant l'échéance — PLUS que le mur d'exécution Apps Script (6 min), donc un jeton servi du
// cache en début de run reste valable jusqu'à la DERNIÈRE création du run (revue quotas F5 :
// à 5 min, une création tardive pouvait présenter un jeton expiré → 401 → strike à tort).
var HUBPERSO_MARGE_EXPIRATION_MS = 7 * 60 * 1000;
// Péremption du state anti-CSRF (revue sécurité A) : un `lierCompteHubperso` abandonné ne doit pas
// laisser un state valable À VIE dans le journal d'exécution / l'historique navigateur. 1 h
// couvre large, y compris « redéploiement pas encore passé, re-clic un peu plus tard ».
var HUBPERSO_STATE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Rend un access token VALIDE du projet hubperso, ou `null` — ÉCHEC FERMÉ (l'appelant suspend via la
 * mécanique config-api, il ne re-tente jamais en boucle). Cache en Script Property
 * (`DriveAI_HUBPERSO_ACCES` = « expirationMs|token »), rafraîchi via REST quand périmé.
 * @return {?string}
 */
function jetonHubperso_() {
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return null; }

  var enCache = null;
  try { enCache = jetonCacheValide_(props.getProperty('DriveAI_HUBPERSO_ACCES'), Date.now()); } catch (e) { }
  if (enCache) return enCache;

  var clientId = '', clientSecret = '', refresh = '';
  try {
    clientId = props.getProperty('DriveAI_HUBPERSO_CLIENT_ID') || '';
    clientSecret = props.getProperty('DriveAI_HUBPERSO_CLIENT_SECRET') || '';
    refresh = props.getProperty('DriveAI_HUBPERSO_REFRESH') || '';
  } catch (e) { return null; }
  if (!clientId || !clientSecret || !refresh) return null; // jamais lié (ou purgé) : docs/HUBPERSO.md

  var rep;
  try {
    rep = UrlFetchApp.fetch(HUBPERSO_URL_JETON, {
      method: 'post',
      payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret },
      muteHttpExceptions: true
    });
  } catch (e) { return null; } // réseau : transitoire, le prochain appel réessaiera

  var resultat = analyserReponseJetonHubperso_(rep.getResponseCode(), rep.getContentText(), Date.now());
  if (resultat.revoque) {
    // Consentement révoqué (sécurité Google, changement de mot de passe…) : on PURGE — sans quoi
    // chaque appel re-frapperait le endpoint pour le même refus. La consigne est journalisée UNE
    // fois (les appels suivants sortent en « jamais lié » sans re-journaliser).
    // COURSE re-liaison (revue quotas F3) : c'est précisément pendant une re-liaison que les
    // `invalid_grant` circulent — si le callback vient d'écrire un refresh token NEUF pendant que
    // ce refresh-ci volait avec l'ANCIEN, purger effacerait la liaison toute fraîche (« ✅ lié »
    // à l'écran puis « non lié » dans Santé). On ne purge que si le token n'a pas changé.
    try {
      if (props.getProperty('DriveAI_HUBPERSO_REFRESH') === refresh) {
        props.deleteProperty('DriveAI_HUBPERSO_REFRESH');
        props.deleteProperty('DriveAI_HUBPERSO_ACCES');
        journalErreur_('Hubperso', 'Consentement hubperso RÉVOQUÉ (invalid_grant) — re-lier le compte : ' +
          'exécuter lierCompteHubperso (JetonHubperso.gs) et suivre docs/HUBPERSO.md.');
      }
    } catch (e) { }
    return null;
  }
  if (!resultat.jeton) return null; // transitoire (5xx, réponse illisible) : échec fermé

  try { props.setProperty('DriveAI_HUBPERSO_ACCES', resultat.expireMs + '|' + resultat.jeton); } catch (e) { }
  return resultat.jeton;
}

/**
 * Extrait le token d'un cache « expirationMs|token » s'il est encore valide (marge
 * `HUBPERSO_MARGE_EXPIRATION_MS` incluse). PURE (testée).
 * @param {?string} brut
 * @param {number} maintenantMs
 * @return {?string}
 */
function jetonCacheValide_(brut, maintenantMs) {
  var texte = String(brut || '');
  var sep = texte.indexOf('|');
  if (sep <= 0) return null;
  var expireMs = Number(texte.slice(0, sep));
  var jeton = texte.slice(sep + 1);
  if (!expireMs || !jeton) return null;
  return maintenantMs < expireMs - HUBPERSO_MARGE_EXPIRATION_MS ? jeton : null;
}

/**
 * État de la LIAISON hubperso (credentials présents ?), pour distinguer « jamais lié / révoqué »
 * (certain — la consigne « re-lier » est juste) d'un échec TRANSITOIRE de refresh (revue quotas
 * F2 : un blip 5xx du endpoint de jeton ne doit JAMAIS envoyer Marc re-consentir pour rien).
 * @return {string} 'present' | 'absent' | 'inconnu' (Properties illisibles — ne rien affirmer)
 */
function etatLiaisonHubperso_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return (props.getProperty('DriveAI_HUBPERSO_CLIENT_ID') && props.getProperty('DriveAI_HUBPERSO_CLIENT_SECRET') &&
      props.getProperty('DriveAI_HUBPERSO_REFRESH')) ? 'present' : 'absent';
  } catch (e) { return 'inconnu'; }
}

/**
 * Message de panne quand `jetonHubperso_()` rend null — HONNÊTE sur la cause (revue quotas F2).
 * Le préfixe `config-api <API> : ` est posé par l'appelant ; la suspension joue dans les deux
 * cas (chemin le moins cher), seule la CONSIGNE change.
 * @return {string}
 */
function messageJetonHubpersoIndisponible_() {
  return etatLiaisonHubperso_() === 'absent'
    ? 'compte hubperso non lié — exécuter lierCompteHubperso (docs/HUBPERSO.md)'
    : 'jeton hubperso momentanément indisponible (échec transitoire du refresh OAuth)';
}

/**
 * Purge le CACHE d'access token (jamais le refresh token). À appeler sur un 401 d'une création
 * (revue code 🟠2 : révocation pendant la durée de vie du cache — jusqu'à ~53 min de 401
 * « transitoires » brûleraient sinon les 3 essais des intentions sous clé de succès) : l'appel
 * suivant repasse par le refresh, qui tranche `invalid_grant` (purge + consigne) vs blip.
 * Best-effort, appelée depuis Tasks.gs/Calendar.gs (la Property reste confinée à ce fichier).
 */
function purgerCacheJetonHubperso_() {
  try { PropertiesService.getScriptProperties().deleteProperty('DriveAI_HUBPERSO_ACCES'); } catch (e) { }
}

/**
 * Interprète une réponse du endpoint de jeton. PURE (testée).
 * `revoque` n'est vrai que sur la signature CERTAINE `invalid_grant` (400/401) — la seule qui
 * justifie de jeter le refresh token. Tout le reste (5xx, réseau déjà filtré, `invalid_client`
 * d'un secret mal collé, JSON illisible) est traité en transitoire : `{}` — on ne détruit JAMAIS
 * l'état sur un doute (même asymétrie que `verdictSondeApi_` : la direction chère exige la preuve).
 * @param {number} code
 * @param {string} corps
 * @param {number} maintenantMs
 * @return {{jeton:(string|undefined), expireMs:(number|undefined), revoque:(boolean|undefined)}}
 */
function analyserReponseJetonHubperso_(code, corps, maintenantMs) {
  var j = null;
  try { j = JSON.parse(String(corps || '')); } catch (e) { j = null; }
  if (code === 200 && j && typeof j.access_token === 'string' && j.access_token) {
    var dureeS = Number(j.expires_in) > 0 ? Number(j.expires_in) : 3600;
    return { jeton: j.access_token, expireMs: maintenantMs + dureeS * 1000 };
  }
  if ((code === 400 || code === 401) && j && j.error === 'invalid_grant') return { revoque: true };
  return {};
}

/* ---------- Liaison (consentement UNIQUE de Marc) ---------- */

/**
 * À EXÉCUTER PAR MARC dans l'éditeur (ouvre `JetonHubperso.gs` → `lierCompteHubperso` → Exécuter),
 * APRÈS avoir posé `DriveAI_HUBPERSO_CLIENT_ID` et `DriveAI_HUBPERSO_CLIENT_SECRET` (docs/HUBPERSO.md).
 * Affiche DEUX choses dans le journal d'exécution : (1) l'URI de redirection à déclarer dans le
 * client OAuth hubperso (EXACTEMENT, à l'octet près), (2) l'URL de consentement à ouvrir.
 * Le `state` (anti-CSRF) est GÉNÉRÉ ici (UUID) — jamais choisi à la main ; l'URI de redirection
 * utilisée est PERSISTÉE pour que l'échange du code (callback) envoie la même à l'octet près.
 * @return {string} l'URL de consentement.
 */
function lierCompteHubperso() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('DriveAI_HUBPERSO_CLIENT_ID');
  if (!clientId || !props.getProperty('DriveAI_HUBPERSO_CLIENT_SECRET')) {
    throw new Error('Poser d\'abord DriveAI_HUBPERSO_CLIENT_ID et DriveAI_HUBPERSO_CLIENT_SECRET ' +
      'dans les Script Properties (docs/HUBPERSO.md, étapes 1-2).');
  }
  // URI de rappel : l'URL /exec de la web app (déploiement épinglé — stable). Redéfinissable par
  // la Property si un jour getUrl() ne rendait pas l'URL attendue.
  var rappel = props.getProperty('DriveAI_HUBPERSO_REDIRECT') || ScriptApp.getService().getUrl();
  if (!rappel) throw new Error('Web app non déployée : impossible de construire l\'URI de rappel.');
  props.setProperty('DriveAI_HUBPERSO_REDIRECT', rappel);
  var state = Utilities.getUuid();
  // Horodaté : le callback refuse un state plus vieux que HUBPERSO_STATE_MAX_AGE_MS (revue sécurité
  // A — une liaison abandonnée ne laisse pas un state valable à vie). L'URL ne porte que l'UUID.
  props.setProperty('DriveAI_HUBPERSO_STATE', state + '|' + Date.now());
  var url = urlConsentementHubperso_(clientId, rappel, state);
  Logger.log('1) URI de redirection à déclarer dans le client OAuth hubperso (exactement) :\n' + rappel +
    '\n\n2) Puis ouvre cette URL pour consentir (une fois) :\n' + url);
  return url;
}

/**
 * URL de consentement OAuth. PURE (testée). `access_type=offline` + `prompt=consent` : c'est ce
 * qui garantit qu'un refresh token est rendu (sans `prompt=consent`, un 2ᵉ consentement n'en
 * renvoie pas et la liaison échouerait en silence).
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} state
 * @return {string}
 */
function urlConsentementHubperso_(clientId, redirectUri, state) {
  return HUBPERSO_URL_CONSENTEMENT +
    '?client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&response_type=code' +
    '&scope=' + encodeURIComponent(HUBPERSO_SCOPES) +
    '&access_type=offline' +
    '&prompt=consent' +
    '&state=' + encodeURIComponent(state);
}

/* ---------- Callback (doGet ?hubperso=1) ---------- */

/**
 * Traite le retour de consentement. Appelée par `doGet` (WebApp.gs). La page rendue ne REFLÈTE
 * JAMAIS un paramètre reçu (pas d'écho de `code`/`state`/`error` → pas d'XSS), et le refus
 * (state invalide) rend la MÊME page neutre que l'échec technique — aucun oracle pour un tiers
 * qui sonderait l'URL publique.
 * @param {Object} params  `e.parameter`
 * @return {HtmlOutput}
 */
function traiterCallbackHubperso_(params) {
  var ok = false;
  try { ok = echangerCodeHubperso_(params); }
  catch (e) {
    try { journalErreur_('Hubperso', 'Callback de liaison en échec : ' + e); } catch (e2) { }
  }
  return HtmlService.createHtmlOutput(ok
    ? '<p>✅ Compte hubperso lié — DriveAI passe désormais par ton projet pour Tasks &amp; Calendar. ' +
      'Tu peux fermer cet onglet (reprise automatique au prochain tick).</p>'
    : '<p>❌ Liaison non aboutie. Relance <b>lierCompteHubperso</b> (fichier JetonHubperso.gs) ' +
      'et suis docs/HUBPERSO.md.</p>');
}

/**
 * Vérifie le callback puis échange le code contre le refresh token (persisté). L'ORDRE est le
 * garde-fou : validation du `state` AVANT tout appel réseau — une requête forgée ne coûte que
 * deux lectures de Properties, et surtout ne LIE jamais un compte tiers.
 * @param {Object} params
 * @return {boolean} vrai si le compte est lié.
 */
function echangerCodeHubperso_(params) {
  var props = PropertiesService.getScriptProperties();
  var code = validerCallbackHubperso_(params, props.getProperty('DriveAI_HUBPERSO_STATE'), Date.now());
  if (!code) return false; // refus MUET (state absent/inconnu/périmé) — voir traiterCallbackHubperso_
  var clientId = props.getProperty('DriveAI_HUBPERSO_CLIENT_ID');
  var clientSecret = props.getProperty('DriveAI_HUBPERSO_CLIENT_SECRET');
  var rappel = props.getProperty('DriveAI_HUBPERSO_REDIRECT'); // celle du consentement, à l'octet près
  if (!clientId || !clientSecret || !rappel) return false;

  var rep = UrlFetchApp.fetch(HUBPERSO_URL_JETON, {
    method: 'post',
    payload: { grant_type: 'authorization_code', code: code, client_id: clientId,
      client_secret: clientSecret, redirect_uri: rappel },
    muteHttpExceptions: true
  });
  var j = null;
  try { j = JSON.parse(rep.getContentText()); } catch (e) { j = null; }
  if (rep.getResponseCode() !== 200 || !j || typeof j.refresh_token !== 'string' || !j.refresh_token) {
    journalErreur_('Hubperso', 'Échange du code refusé (HTTP ' + rep.getResponseCode() +
      ') — relancer lierCompteHubperso (docs/HUBPERSO.md).');
    return false;
  }
  // Consentement GRANULAIRE (revue code 🟠1) : Google laisse DÉCOCHER chaque autorisation — un
  // refresh token émis sans l'un des deux scopes « réussirait » la liaison puis ferait mourir
  // chaque création en 403 de droits, un échec que NI la panne config NI la sonde ne reclassent
  // (3 strikes → intention abandonnée sous clé de succès, en silence). On refuse la liaison
  // ENTIÈRE : rien n'est persisté, la consigne dit de re-consentir en cochant TOUT.
  if (!scopesHubpersoComplets_(j.scope)) {
    journalErreur_('Hubperso', 'Liaison REFUSÉE : autorisations incomplètes au consentement — ' +
      'relancer lierCompteHubperso et COCHER les deux autorisations (Tasks ET Agenda).');
    return false;
  }
  props.setProperty('DriveAI_HUBPERSO_REFRESH', j.refresh_token);
  if (typeof j.access_token === 'string' && j.access_token && Number(j.expires_in) > 0) {
    props.setProperty('DriveAI_HUBPERSO_ACCES', (Date.now() + Number(j.expires_in) * 1000) + '|' + j.access_token);
  }
  props.deleteProperty('DriveAI_HUBPERSO_STATE'); // state à usage UNIQUE
  journalInfo_('Hubperso', 'Compte hubperso lié — Tasks & Calendar passent par le projet hubperso ' +
    '(reprise des intentions au prochain tick, via la sonde config-api).');
  return true;
}

/**
 * Valide les paramètres du callback : action `hubperso=1`, `code` présent, `state` identique à
 * l'UUID généré par `lierCompteHubperso` (comparaison CONSTANTE) et pas plus vieux que
 * `HUBPERSO_STATE_MAX_AGE_MS` (revue sécurité A). PURE (testée).
 * @param {Object} params
 * @param {?string} stateAttendu  Property « uuid|poseMs »
 * @param {number} maintenantMs
 * @return {string} le code d'autorisation, ou '' (refus).
 */
function validerCallbackHubperso_(params, stateAttendu, maintenantMs) {
  if (!params || params.hubperso !== '1') return '';
  var code = typeof params.code === 'string' ? params.code : '';
  var state = typeof params.state === 'string' ? params.state : '';
  if (!code || !state || !stateAttendu) return '';
  var texte = String(stateAttendu);
  var sep = texte.indexOf('|');
  if (sep <= 0) return ''; // format inattendu (ancienne valeur, corruption) → refus fermé
  var poseMs = Number(texte.slice(sep + 1));
  if (!poseMs || maintenantMs - poseMs > HUBPERSO_STATE_MAX_AGE_MS) return ''; // state périmé
  return comparaisonConstante_(state, texte.slice(0, sep)) ? code : '';
}

/**
 * Vrai si le champ `scope` (espace-délimité) rendu par le endpoint de jeton couvre les DEUX API.
 * PURE (testée). Cf. le refus de liaison dans `echangerCodeHubperso_` (consentement granulaire).
 * @param {*} scopes
 * @return {boolean}
 */
function scopesHubpersoComplets_(scopes) {
  var liste = String(scopes || '').split(' ');
  return liste.indexOf('https://www.googleapis.com/auth/tasks') !== -1 &&
    liste.indexOf('https://www.googleapis.com/auth/calendar.events') !== -1;
}

/**
 * Comparaison de chaînes en temps CONSTANT (pas de sortie anticipée au premier octet différent —
 * même exigence que le `timingSafeEqual` du endpoint hub côté Vercel). PURE (testée).
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function comparaisonConstante_(a, b) {
  var x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  var diff = 0;
  for (var i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
