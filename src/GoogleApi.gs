/**
 * GoogleApi.gs — Jeton OAuth + retry partagés pour les appels REST aux API Google
 * (Tasks, Calendar — cf. Tasks.gs, Calendar.gs). Même schéma que DriveRest.gs.
 *
 * Un seul jeton OAuth de script couvre tous les scopes déclarés dans `appsscript.json`
 * (Drive, Tasks, Calendar...) — pas besoin d'un jeton par API.
 */

/** @return {string} jeton OAuth du script (compte de Marc), valable pour tous les scopes déclarés. */
function jetonGoogle_() {
  return ScriptApp.getOAuthToken();
}

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

/** À appeler en tête de tick : charge l'état de panne config PERSISTÉ (< re-sonde ⇒ suspendu). */
function chargerPanneConfigApi_() {
  _panneConfigApiCeRun = false;
  var t = 0;
  try { t = Number(PropertiesService.getScriptProperties().getProperty('DriveAI_PANNE_CONFIG_API')) || 0; }
  catch (e) { }
  if (t && Date.now() - t < CONFIG.PANNE_CONFIG_RESONDE_MS) _panneConfigApiCeRun = true;
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
  if (!estMessageApiDesactivee_(String(e))) return false;
  if (!_panneConfigApiCeRun) {
    journalErreur_('GoogleApi', 'PANNE CONFIG : une API Google (Tasks/Calendar) n\'est pas activée ' +
      'dans le projet — création d\'intentions suspendue ' +
      Math.round(CONFIG.PANNE_CONFIG_RESONDE_MS / 3600000) + ' h. Active l\'API dans la console GCP.');
    try { PropertiesService.getScriptProperties().setProperty('DriveAI_PANNE_CONFIG_API', String(Date.now())); }
    catch (e2) { /* Property indisponible : la suspension mémoire couvre au moins ce run */ }
  }
  _panneConfigApiCeRun = true;
  return true;
}
