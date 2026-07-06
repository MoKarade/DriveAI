/**
 * WebApp.gs — bouton « Vérifier maintenant » de l'app (#20, demande Marc 2026-07-06).
 *
 * L'app (SPA) ne peut PAS exécuter de fonction Apps Script (frontière d'exécution) : ce
 * doPost, déployé en APPLICATION WEB (« Exécuter en tant que : moi », accès « Tout le monde »),
 * est le pont. Sécurité : secret partagé OBLIGATOIRE (Script Property `DriveAI_WEBAPP_SECRET`,
 * jamais dans le code) + anti-rafale 60 s. Le pire abus possible = déclencher le tick normal
 * (idempotent, LockService, garde-temps) — aucune donnée n'est renvoyée ni lisible (l'app
 * appelle en no-cors).
 *
 * Un déclencheur PONCTUEL est créé (échéance ~1 min) plutôt que d'exécuter le tick dans la
 * requête (réponse immédiate, pas de double-run grâce au LockService). `tickPonctuel` nettoie
 * ses propres déclencheurs (quota ~20 déclencheurs).
 */

function doPost(e) {
  var reponse = { ok: false };
  try {
    var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_WEBAPP_SECRET');
    var recu = e && e.parameter ? e.parameter.secret : '';
    if (!attendu || !recu || recu !== attendu) {
      reponse.erreur = 'refusé';
    } else {
      var props = PropertiesService.getScriptProperties();
      var dernier = Number(props.getProperty('DriveAI_DERNIER_PONCTUEL')) || 0;
      if (Date.now() - dernier < 60 * 1000) {
        reponse.ok = true;
        reponse.message = 'déjà demandé il y a moins d’une minute';
      } else {
        props.setProperty('DriveAI_DERNIER_PONCTUEL', String(Date.now()));
        ScriptApp.newTrigger('tickPonctuel').timeBased().after(1000).create();
        journalInfo_('WebApp', 'Passage immédiat demandé depuis l’app.');
        reponse.ok = true;
        reponse.message = 'passage lancé';
      }
    }
  } catch (err) {
    reponse.erreur = String(err);
  }
  return ContentService.createTextOutput(JSON.stringify(reponse))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Cible du déclencheur ponctuel : nettoie ses déclencheurs puis lance le tick normal. */
function tickPonctuel() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'tickPonctuel') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* best-effort — le tick prime */ }
  tickDriveAI();
}
