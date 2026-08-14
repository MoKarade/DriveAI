/**
 * Tasks.gs — Création de tâches Google Tasks via l'API REST (UrlFetchApp), Phase 3.
 *
 * Comme Drive (cf. DriveRest.gs) et l'OCR : REST plutôt que service avancé, pour la
 * robustesse après `clasp push` (cf. LESSONS « API Google via REST »). Le jeton OAuth
 * du script couvre tous les scopes déclarés dans `appsscript.json` (dont `tasks`).
 *
 * Garde-fou : CRÉATION uniquement — jamais de modification ni de suppression, et jamais de
 * LECTURE d'une tâche EXISTANTE de Marc. UNIQUE exception, étroite (C28-48, révision ADR-0022) :
 * la sonde de configuration `sonderApiConfig_` (GoogleApi.gs) fait un GET sur l'identifiant
 * LITTÉRAL et volontairement INEXISTANT `SONDE_CONFIG_ID` — elle attend un 404, n'énumère rien et
 * ne renvoie aucune donnée de Marc ; elle sert seulement à distinguer « API désactivée dans le
 * projet GCP » de « API activée ». Verrouillé par `test/surface-tasks-calendar.test.js`.
 * Échec d'API = dégradation propre (Journal + null), jamais de plantage du tick.
 */

/**
 * Crée une tâche dans la liste Google Tasks par défaut (« @default »).
 * @param {string} titre
 * @param {string} [echeance]   date AAAA-MM-JJ (l'API Tasks n'utilise que la date, pas l'heure)
 * @param {string} [notes]
 * @return {string} l'ID de la tâche créée, ou '' en cas d'échec.
 */
function creerTache_(titre, echeance, notes) {
  var payload = { title: titre };
  if (notes) payload.notes = notes;
  if (echeance) payload.due = echeance + 'T00:00:00.000Z'; // Tasks : seule la date compte (UTC)

  var rep = fetchGoogleAvecRetry_(
    'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: { Authorization: 'Bearer ' + jetonGoogle_() },
      muteHttpExceptions: true
    }
  );

  if (rep.getResponseCode() === 200) {
    return JSON.parse(rep.getContentText()).id;
  }
  var corps = rep.getContentText();
  // API non activée dans le projet GCP (403 permanent, C28-22) : LÈVE — l'appelant
  // (creerIntentionIdempotente_) la classe en panne de CONFIG et suspend le run, plutôt que de
  // renvoyer un échec qui ferait re-analyser le mail à chaque tick (boucle qui drainait le quota).
  // Message EXPLOITABLE (C28-48, cf. Calendar.gs) : `error.message` nomme le projet GCP et l'URL
  // d'activation, là où le JSON INDENTÉ de Google ne laissait voir, une fois tronqué pour
  // l'affichage, que « { error : { ».
  if (rep.getResponseCode() === 403 && estMessageApiDesactivee_(corps)) {
    throw new Error('config-api Tasks : ' + tronquer_(messageErreurGoogle_(corps), 300));
  }
  journalErreur_('Tasks', 'Création HTTP ' + rep.getResponseCode() + ' (« ' + titre + ' ») : ' +
    tronquer_(corps, 300));
  return '';
}
