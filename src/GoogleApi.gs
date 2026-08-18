/**
 * GoogleApi.gs — Retry partagé + panne de CONFIG pour les appels REST aux API Google
 * (Tasks, Calendar — cf. Tasks.gs, Calendar.gs). Même schéma que DriveRest.gs.
 *
 * Jeton : depuis l'ADR-0041, Tasks/Calendar utilisent le jeton du projet HUBPERSO (`jetonHubperso_`,
 * JetonHubperso.gs) — le projet GCP par défaut du script est CACHÉ (inadministrable, API jamais
 * activables) ; Drive/Sheets/Gmail restent sur le jeton du script (`jetonDrive_`, DriveRest.gs).
 */

/**
 * Appel REST avec un retry léger borné sur erreurs transitoires (429, 5xx). Même politique
 * que `fetchDriveAvecRetry_` (DriveRest.gs) : évite qu'un pic de quota fasse échouer une
 * création et déclenche un re-traitement complet du mail au tick suivant.
 * @param {string} url
 * @param {Object} options
 * @return {HTTPResponse}
 */
function fetchGoogleAvecRetry_(url, options) {
  var rep = UrlFetchApp.fetch(url, options);
  var code = rep.getResponseCode();
  if (code === 429 || (code >= 500 && code < 600)) {
    Utilities.sleep(1000);
    rep = UrlFetchApp.fetch(url, options);
  }
  return rep;
}

/* ---------- C28-22 (ADR-0022) : panne de CONFIGURATION d'API Google (permanente) ---------- */

// Une API Google non activée dans le projet GCP répond 403 « … has not been used in project … »
// (Tasks jamais activée jusqu'au 14/07). C'est une panne PERMANENTE (jusqu'à activation par Marc),
// pas un échec du mail : on suspend la création d'intentions 24 h (persistée) pour ne pas
// re-analyser chaque mail actionnable à chaque tick — ce qui drainait le quota Gmail. Même patron
// que la panne de compte LLM (R2) et le quota Gmail (C28-15) : détecter → suspendre → re-sonder.
var _panneConfigApiCeRun = false;

/**
 * À appeler en tête de tick : charge l'état de panne config PERSISTÉ (< re-sonde ⇒ suspendu).
 *
 * C28-48 : la fenêtre de 24 h reste la borne EXTÉRIEURE, mais elle n'est plus le délai de reprise.
 * Tant que la suspension court, on SONDE l'API (appel léger, ≤ 1×/`PANNE_CONFIG_SONDE_MS`) : dès
 * que Marc active l'API dans la console GCP, DriveAI le voit tout seul au tick suivant et reprend
 * — au lieu d'attendre jusqu'à 24 h une re-sonde qui, elle, coûte un scan Gmail + des appels LLM.
 * (Leçon §7 « un garde-fou qui met des items HORS CIRCUIT exige un chemin de RETOUR auto ».)
 */
function chargerPanneConfigApi_() {
  _panneConfigApiCeRun = false;
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return; }
  var t = 0;
  try { t = Number(props.getProperty('DriveAI_PANNE_CONFIG_API')) || 0; } catch (e) { }
  if (!t) return; // pas de panne
  if (Date.now() - t >= CONFIG.PANNE_CONFIG_RESONDE_MS) {
    // Fenêtre écoulée : ce run EST la re-sonde (le chemin historique, par le scan lui-même). On
    // efface l'état PÉRIMÉ — sinon, si la création repasse, la Property survit indéfiniment et
    // `Santé` continuerait d'annoncer une panne finie (un état d'observabilité qui MENT).
    try {
      props.deleteProperty('DriveAI_PANNE_CONFIG_API');
      props.deleteProperty('DriveAI_PANNE_CONFIG_MSG');
    } catch (e) { }
    return;
  }
  _panneConfigApiCeRun = true;
  // `chargerPanneConfigApi_` est appelée NUE en tête de tick (le `try` de `tickDriveAI` n'a qu'un
  // `finally`) : une exception ici GÈLERAIT tout le pipeline. La sonde — qui ajoute un appel
  // réseau et une écriture de Journal — est donc enveloppée et dégrade en « on reste suspendu ».
  try { sonderEtLeverPanneConfig_(props); }
  catch (e) { /* la suspension tient : c'est le comportement d'avant la sonde */ }
}

/**
 * Sonde l'API (≤ 1×/`PANNE_CONFIG_SONDE_MS`) et LÈVE la suspension si elle répond. Appelée
 * uniquement quand une panne est en cours. Peut lever : l'appelant dégrade.
 * @param {Properties} props
 */
function sonderEtLeverPanneConfig_(props) {
  // Sonde bornée dans le temps : l'horodatage est posé AVANT l'appel — une sonde qui lève ne doit
  // pas se rejouer à chaque tick (même patron que les autres re-sondes de panne).
  var derniere = 0;
  try { derniere = Number(props.getProperty('DriveAI_PANNE_CONFIG_SONDE')) || 0; } catch (e) { }
  if (Date.now() - derniere < CONFIG.PANNE_CONFIG_SONDE_MS) return;
  // Si l'anti-boucle n'a PAS pu être armé (magasin d'état en panne), on ne sonde pas du tout :
  // sans horodatage, la sonde repartirait à CHAQUE tick (288×2 requêtes/j) précisément pendant
  // que les Properties sont indisponibles. Pas d'anti-boucle ⇒ pas de sonde (revue quotas C28-48).
  var arme = false;
  try { props.setProperty('DriveAI_PANNE_CONFIG_SONDE', String(Date.now())); arme = true; } catch (e) { }
  if (!arme) return;

  var verdict = sonderApiConfig_();
  // Verdict de la DERNIÈRE sonde, toujours persisté (revue code C28-48) : sans lui, une sonde qui
  // ne conclut JAMAIS (ex. Google resserre la validation de l'identifiant sondé ⇒ 400 systématique
  // ⇒ `indetermine` sous l'allowlist) rendrait la reprise inopérante À VIE et SANS AUCUNE TRACE.
  try { props.setProperty('DriveAI_PANNE_CONFIG_SONDE_ETAT', tronquer_(verdict.etat + (verdict.api ? ' (' + verdict.api + ')' : ''), 60)); }
  catch (e) { }

  if (verdict.etat === 'desactivee') {
    // Toujours refusée : on rafraîchit le message EXPLOITABLE (il nomme le projet GCP et l'URL
    // d'activation) pour que `Santé` dise POURQUOI sans que Marc ait à ouvrir le Journal.
    memoriserMessageConfigApi_(props, verdict.api, verdict.message);
    // …et on RAFRAÎCHIT la suspension (revue code C28-48). Sans ça, la fenêtre de 24 h expirait,
    // l'état était effacé comme « périmé », la sonde — qui n'existe QUE pendant une panne —
    // s'éteignait, et `Santé` repassait au vert alors que la sonde venait juste de prouver le
    // contraire ; il fallait alors qu'un mail actionnable repose la panne par le chemin coûteux.
    // La suspension vit désormais tant que la sonde CONFIRME, et meurt quand elle infirme : c'est
    // le même signal certain (403 + signature) que celui du chemin de création.
    try { props.setProperty('DriveAI_PANNE_CONFIG_API', String(Date.now())); } catch (e) { }
    return;
  }
  if (verdict.etat !== 'active') return; // indéterminé (5xx, réseau) : on ne lève RIEN (échec fermé)

  // Les deux API répondent : la panne est finie. On efface la suspension → les intentions
  // reprennent DÈS CE TICK, sans aucun geste de Marc.
  _panneConfigApiCeRun = false;
  try {
    props.deleteProperty('DriveAI_PANNE_CONFIG_API');
    props.deleteProperty('DriveAI_PANNE_CONFIG_MSG');
    // Horodatage de la dernière sonde POSITIVE : c'est lui qui permet à `Santé` de dire « actives,
    // sondées le … » au lieu d'affirmer « opérationnelles » sans preuve (no-fake-data).
    props.setProperty('DriveAI_PANNE_CONFIG_OK', String(Date.now()));
  } catch (e) { }
  journalInfo_('GoogleApi', 'REPRISE : les API Google (Tasks & Calendar) répondent à nouveau — ' +
    'création d\'intentions réactivée automatiquement.');
}

/**
 * Mémorise (borné, sur UNE ligne) le dernier refus, pour l'onglet Santé. Best-effort.
 *
 * FILTRE DE PROVENANCE (revue sécurité C28-48) : ce texte finit dans une Sheet. Il ne doit porter
 * QUE le diagnostic d'infrastructure (API, projet GCP, URL d'activation). `signalerPanneConfigApi_`
 * reçoit une exception dont le message est CONSTRUIT par nous (`'config-api <API> : …'`) — mais
 * elle est levée depuis un `try` qui enveloppe toute la création d'intention : un futur `throw`
 * ajouté là contiendrait le TITRE du mail. On n'accepte donc que le préfixe attendu, sinon on
 * dégrade vers un libellé générique (ADR-0007 : métadonnées seulement, jamais de contenu).
 */
var PREFIXE_CONFIG_API = /^config-api [A-Za-z]+ : /;

function memoriserMessageConfigApi_(props, api, message) {
  var txt = String(message || '').replace(/\s+/g, ' ').trim();
  if (!api && !PREFIXE_CONFIG_API.test(txt)) txt = 'API Google non activée (détail non exposé)';
  if (api) txt = api + ' — ' + txt;
  try { props.setProperty('DriveAI_PANNE_CONFIG_MSG', tronquer_(txt, 300)); }
  catch (e) { /* best-effort : l'absence de message ne change rien au comportement */ }
}

/**
 * État lisible de la panne de config, pour l'onglet Santé (lecture seule, jamais de décision).
 * `actif` applique EXACTEMENT la même règle de fenêtre que `chargerPanneConfigApi_` : une
 * observabilité qui divergerait de la décision serait pire que pas d'observabilité du tout.
 * @return {{actif:boolean, depuisMs:number, message:string, sondeOkMs:number, sonde:string}}
 */
function etatPanneConfigApi_() {
  var t = 0, msg = '', ok = 0, sonde = '';
  try {
    var props = PropertiesService.getScriptProperties();
    t = Number(props.getProperty('DriveAI_PANNE_CONFIG_API')) || 0;
    msg = props.getProperty('DriveAI_PANNE_CONFIG_MSG') || '';
    ok = Number(props.getProperty('DriveAI_PANNE_CONFIG_OK')) || 0;
    sonde = props.getProperty('DriveAI_PANNE_CONFIG_SONDE_ETAT') || '';
  } catch (e) { }
  var actif = !!t && Date.now() - t < CONFIG.PANNE_CONFIG_RESONDE_MS;
  // Un « ✅ actives (sondées le …) » PÉRIMÉ est un mensonge (revue code C28-48) : après une panne
  // résolue puis une nouvelle panne, l'horodatage positif d'il y a des semaines survivrait et
  // Santé afficherait ce vert rassurant. Au-delà de la fenêtre de re-sonde, la preuve n'en est
  // plus une : on retombe sur « aucune panne détectée ».
  var okFrais = ok && Date.now() - ok < CONFIG.PANNE_CONFIG_RESONDE_MS ? ok : 0;
  return { actif: actif, depuisMs: t, message: actif ? msg : '', sondeOkMs: okFrais, sonde: actif ? sonde : '' };
}

/* ---------- C28-48 : sonde LÉGÈRE « l'API est-elle activée ? » ---------- */

// Identifiant volontairement INEXISTANT : la sonde ne lit AUCUNE donnée de Marc (elle attend un
// 404), elle n'énumère rien, elle n'écrit rien. Elle sert uniquement à distinguer « l'API refuse
// le projet » (403 SERVICE_DISABLED) de « l'API répond » (n'importe quelle autre réponse métier).
// Le garde-fou Tasks.gs/Calendar.gs (« création uniquement, jamais les éléments EXISTANTS de
// Marc ») reste donc entier : aucun événement ni aucune tâche réelle n'est touché.
var SONDE_CONFIG_ID = 'driveaisondeconfigapi';

var SONDES_CONFIG_API = [
  { api: 'Tasks', url: 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/' + SONDE_CONFIG_ID },
  { api: 'Calendar', url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events/' + SONDE_CONFIG_ID }
];

/**
 * Interprète UNE réponse de sonde. PURE (testée).
 *
 * ALLOWLIST, pas de `else` optimiste (revue quotas C28-48) : `active` est le SEUL verdict qui
 * rouvre `traiterIntentionsMail_`, c'est-à-dire un scan Gmail + jusqu'à `INTENTIONS_MAX_PAR_RUN`
 * analyses LLM par run — exactement la boucle que C28-22 a été écrite pour arrêter. Se tromper
 * dans ce sens la rejoue 96×/jour au lieu d'1×/24 h ; se tromper dans l'autre sens coûte au pire
 * l'attente d'avant C28-48. La direction chère exige donc une PREUVE POSITIVE :
 *  - 403 portant la signature « API non activée » → 'desactivee' (verdict certain)
 *  - 404 ou 2xx → 'active' : l'API a SERVI la requête sur l'identifiant inexistant, elle est donc
 *    bien activée dans le projet (404 est la réponse NOMINALE de la sonde).
 *  - tout le reste (400, 401, 403 de droits, 429, 5xx) → 'indetermine' : on ne lève RIEN. Un 403
 *    de droits « prouve » certes que l'API répond, mais la création échouerait de toute façon.
 * @param {number} code
 * @param {string} corps
 * @return {string} 'active' | 'desactivee' | 'indetermine'
 */
function verdictSondeApi_(code, corps) {
  if (code === 403 && estMessageApiDesactivee_(corps)) return 'desactivee';
  if (code === 404 || (code >= 200 && code < 300)) return 'active';
  return 'indetermine';
}

/**
 * Sonde les DEUX API dont dépendent les intentions (une seule suspension les couvre toutes deux).
 * Verdict global : 'desactivee' dès qu'une API refuse (avec son message exploitable), 'active'
 * seulement si les DEUX répondent, 'indetermine' sinon.
 * @return {{etat:string, api:string, message:string}}
 */
function sonderApiConfig_() {
  // GARDE-TEMPS **DANS** la boucle (leçon §7) : `UrlFetchApp` n'accepte AUCUN timeout en Apps
  // Script (plafond empirique ~60 s/appel) et la sonde tourne en tête de tick. Deux endpoints qui
  // pendent, c'est ~2 min prélevées sur la marge budget→mur de 6 min — et le jour où Google pend,
  // 96 sondes/jour dépasseraient à elles seules le quota DUR de runtime. On abandonne alors la
  // passe (verdict indéterminé : rien n'est levé), la suivante réessaiera.
  // L'horloge démarre AVANT `jetonHubperso_()` (revue quotas F1) : le refresh OAuth est lui aussi un
  // fetch sans timeout — hors du cumul, il ré-introduisait le cas « 2 × 60 s » que ce garde a été
  // écrit pour supprimer. Abandonner après un refresh lent ne perd rien : le token refreshé est
  // persisté, la sonde suivante est servie du cache.
  var debutSonde = Date.now();
  // ADR-0041 : la sonde teste les API DU PROJET HUBPERSO — celles que les créations utilisent
  // réellement. C'est AUSSI le chemin de reprise : dès que Marc lie le compte, la sonde suivante
  // (≤ 13 min) obtient un jeton, voit les API répondre et lève la suspension toute seule.
  var jeton = jetonHubperso_();
  if (!jeton) {
    // Credentials ABSENTS = verdict certain (jamais lié / révoqué-purgé) : les créations sont
    // impossibles, la suspension se rafraîchit avec la consigne actionnable. Credentials PRÉSENTS
    // = échec TRANSITOIRE du refresh (5xx, réseau) : on ne conclut RIEN (revue quotas F2 — dire
    // « re-lier le compte » sur un blip Google enverrait Marc re-consentir pour rien).
    if (etatLiaisonHubperso_() === 'absent') {
      return { etat: 'desactivee', api: 'hubperso',
        message: 'compte hubperso non lié ou consentement révoqué — exécuter lierCompteHubperso (docs/HUBPERSO.md)' };
    }
    return { etat: 'indetermine', api: 'hubperso', message: 'refresh OAuth hubperso momentanément impossible' };
  }
  if (Date.now() - debutSonde > CONFIG.PANNE_CONFIG_SONDE_MAX_MS) {
    return { etat: 'indetermine', api: 'hubperso', message: 'sonde interrompue (refresh OAuth trop lent)' };
  }
  var doute = null;
  for (var i = 0; i < SONDES_CONFIG_API.length; i++) {
    var s = SONDES_CONFIG_API[i];
    if (Date.now() - debutSonde > CONFIG.PANNE_CONFIG_SONDE_MAX_MS) {
      return doute || { etat: 'indetermine', api: s.api, message: 'sonde interrompue (trop lente)' };
    }
    var code = 0, corps = '';
    try {
      var rep = UrlFetchApp.fetch(s.url, {
        method: 'get',
        headers: { Authorization: 'Bearer ' + jeton },
        muteHttpExceptions: true
      });
      code = rep.getResponseCode();
      corps = rep.getContentText();
    } catch (e) {
      doute = doute || { etat: 'indetermine', api: s.api, message: 'sonde impossible : ' + tronquer_(String(e), 150) };
      continue;
    }
    var verdict = verdictSondeApi_(code, corps);
    if (verdict === 'desactivee') {
      return { etat: 'desactivee', api: s.api, message: messageErreurGoogle_(corps) };
    }
    if (verdict === 'indetermine') {
      doute = doute || { etat: 'indetermine', api: s.api, message: 'HTTP ' + code };
    }
  }
  return doute || { etat: 'active', api: '', message: '' };
}

/**
 * Extrait le message EXPLOITABLE d'une réponse d'erreur Google. PURE (testée).
 * Le corps brut est un JSON INDENTÉ : dans les vues tronquées (cellule d'erreur de Progression,
 * 40 caractères) on n'y lisait que « { error : { » — rien d'actionnable. `error.message` porte au
 * contraire le NUMÉRO DU PROJET GCP et l'URL d'activation, c'est-à-dire exactement ce qui permet
 * de distinguer « pas activée » de « activée dans un AUTRE projet que celui du script ».
 * @param {string} corps
 * @return {string}
 */
function messageErreurGoogle_(corps) {
  var brut = String(corps || '');
  try {
    var j = JSON.parse(brut);
    if (j && j.error && typeof j.error.message === 'string' && j.error.message) return j.error.message;
  } catch (e) { /* pas du JSON (page HTML, texte) : on rend le brut */ }
  return brut.replace(/\s+/g, ' ').trim();
}

/** Vrai si la création d'intentions est suspendue pour ce run (API non activée, re-sonde pas due). */
function estPanneConfigApi_() { return _panneConfigApiCeRun; }

/** Pour les tests / la ré-init de run. */
function reinitialiserPanneConfigApi_() { _panneConfigApiCeRun = false; }

/**
 * Vrai si le TEXTE d'une réponse Google révèle une API non activée dans le projet (403 de config,
 * permanent) — vs un échec transitoire (500/429) ou une vraie erreur de requête (400). PURE (testée).
 * @param {string} texte  corps de la réponse HTTP (ou message d'exception)
 * @return {boolean}
 */
function estMessageApiDesactivee_(texte) {
  var m = String(texte || '').toLowerCase();
  return m.indexOf('has not been used') !== -1 ||
    m.indexOf('accessnotconfigured') !== -1 ||
    m.indexOf('service_disabled') !== -1 ||
    (m.indexOf('api') !== -1 && m.indexOf('is disabled') !== -1);
}

/**
 * À appeler dans le catch autour d'une création Tasks/Calendar : reconnaît une panne de CONFIG
 * (API non activée), pose la suspension persistée (une seule ligne de Journal par épuisement) et
 * retourne true — l'appelant doit alors STOPPER le traitement d'intentions du run (rien imputé au
 * mail). Toute autre erreur → false (le traitement d'échec transitoire s'applique).
 * @param {*} e
 * @return {boolean}
 */
function signalerPanneConfigApi_(e) {
  var m = String(e && e.message ? e.message : e);
  // Le PRÉFIXE canonique vaut verdict — ne JAMAIS re-dériver une décision déjà rendue (revue code
  // C28-48, régression trouvée avant merge). `creerTache_`/`creerEvenement_` ont testé la signature
  // sur le corps 403 BRUT, puis lèvent `'config-api <API> : ' + messageErreurGoogle_(corps)`. Or
  // deux des quatre signatures (`accessNotConfigured`, `SERVICE_DISABLED`) vivent dans
  // `error.errors[].reason` / `error.status`, PAS dans `error.message` : re-tester la signature sur
  // le message EXTRAIT rendait `false` sur un 403 « Access Not Configured » pourtant reconnu en
  // amont ⇒ aucune suspension posée ⇒ le mail re-analysé à chaque tick (l'incident C28-22 de
  // retour) ET la sonde C28-48 jamais armée. Panne SILENCIEUSE et conditionnelle.
  if (!PREFIXE_CONFIG_API.test(m) && !estMessageApiDesactivee_(m)) return false;
  if (!_panneConfigApiCeRun) {
    // Texte NEUTRE sur la cause (revue code 🟡3, comme le titre Santé) : depuis l'ADR-0041 la
    // panne peut venir d'une API non activée dans hubperso OU d'un compte hubperso non lié — le détail
    // vit dans Santé (message mémorisé), pas ici.
    journalErreur_('GoogleApi', 'PANNE CONFIG : les créations Tasks/Calendar sont indisponibles ' +
      '(API non activée dans le projet hubperso, ou compte hubperso non lié — détail dans Santé) : ' +
      'création d\'intentions suspendue. Sonde automatique toutes les ' +
      Math.round(CONFIG.PANNE_CONFIG_SONDE_MS / 60000) + ' min : reprise automatique dès que la ' +
      'cause est levée.');
    try {
      var props = PropertiesService.getScriptProperties();
      props.setProperty('DriveAI_PANNE_CONFIG_API', String(Date.now()));
      // Message EXPLOITABLE conservé pour `Santé` (C28-48) : il nomme le projet GCP et l'URL
      // d'activation — le seul moyen de distinguer « pas activée » de « activée ailleurs ».
      memoriserMessageConfigApi_(props, '', m);
      // La preuve positive précédente est CADUQUE : sans ça, `Santé` pourrait encore afficher
      // « actives (sondées le …) » alors qu'une panne vient d'être constatée.
      props.deleteProperty('DriveAI_PANNE_CONFIG_OK');
    }
    catch (e2) { /* Property indisponible : la suspension mémoire couvre au moins ce run */ }
  }
  _panneConfigApiCeRun = true;
  return true;
}
