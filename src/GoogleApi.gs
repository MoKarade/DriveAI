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
