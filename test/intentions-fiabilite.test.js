'use strict';
/**
 * C28-22 (ADR-0022) — fiabilité des créations Tasks/Calendar :
 *  - `estMessageApiDesactivee_` (PURE) : distingue une API non activée (403 config, permanent)
 *    d'un échec transitoire (500/429) ou d'une vraie erreur de requête (400).
 *  - `chargerPanneConfigApi_`/`estPanneConfigApi_`/`signalerPanneConfigApi_` : suspension
 *    persistée 24 h (patron panne de plateforme R2 / quota Gmail C28-15).
 *  - `creerIntentionIdempotente_` : panne CONFIG → relève (suspend le run, rien imputé) ;
 *    échec TRANSITOIRE → 3-strikes puis `'deja-faite'` (le message est débloqué, plus de boucle).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- estMessageApiDesactivee_ (PURE) ---------- */

const ctxPur = load(['Config.gs', 'GoogleApi.gs']);

test('estMessageApiDesactivee_ : signatures « API non activée » vraies ; transitoire/400/vide fausses', () => {
  const f = ctxPur.estMessageApiDesactivee_;
  assert.strictEqual(f('Google Tasks API has not been used in project 123 before or it is disabled.'), true);
  assert.strictEqual(f('{"error":{"status":"PERMISSION_DENIED","reason":"accessNotConfigured"}}'), true);
  assert.strictEqual(f('SERVICE_DISABLED'), true);
  assert.strictEqual(f('Calendar API is disabled for this project'), true);
  assert.strictEqual(f('Internal error, please try again (500)'), false); // transitoire
  assert.strictEqual(f('Invalid value for field due'), false);            // 400 requête
  assert.strictEqual(f(''), false);
  assert.strictEqual(f(null), false);
});

/* ---------- suspension persistée (charge / sonde / signalement) ---------- */

/**
 * @param {Object} props  Script Properties initiales
 * @param {Object|Error} [reponses]  réponses de la sonde HTTP (C28-48), choisies d'après l'URL
 *   REÇUE (jamais d'après l'ordre d'appel — leçon §7 « un mock lit son ARGUMENT ») :
 *   soit `{code, corps}` / une `Error` appliquée aux DEUX API, soit `{Tasks: …, Calendar: …}`.
 *   Les URL appelées sont enregistrées dans `fetchs`.
 */
function ctxPanne(props, reponses) {
  // `Ocr.gs` pour `tronquer_` (utilisé par la mémorisation du message exploitable).
  const c = load(['Config.gs', 'Ocr.gs', 'GoogleApi.gs']);
  const store = Object.assign({}, props);
  const journaux = [];
  const infos = [];
  const fetchs = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.journalErreur_ = (s, m) => journaux.push(m);
  c.journalInfo_ = (s, m) => infos.push(m);
  // ADR-0041 : la sonde utilise le jeton du projet HUBPERSO (JetonHubperso.gs, non chargé ici). Le mock
  // rend un jeton valide — le cas « pas de jeton » a son test dédié plus bas.
  c.jetonHubperso_ = () => 'jeton-test';
  const opts = { retardMs: 0 }; // le test peut rendre la sonde LENTE (garde-temps)
  /** L'URL REÇUE choisit la réponse — pas un compteur d'appels. */
  const pourUrl = (url) => {
    if (!reponses) return null;
    if (reponses instanceof Error || !(reponses.Tasks || reponses.Calendar)) return reponses;
    return url.indexOf('tasks.googleapis.com') !== -1 ? reponses.Tasks : reponses.Calendar;
  };
  c.UrlFetchApp = { fetch: (url) => {
    fetchs.push(url);
    if (opts.retardMs) { const t = Date.now(); while (Date.now() - t < opts.retardMs) { /* attente active */ } }
    const r = pourUrl(url);
    if (r instanceof Error) throw r;
    if (!r) throw new Error('aucune réponse de sonde programmée pour ' + url);
    return { getResponseCode: () => r.code, getContentText: () => r.corps || '' };
  } };
  return { c, store, journaux, infos, fetchs, opts };
}

/** Corps 403 réaliste d'une API Google non activée (indenté, comme le vrai). */
function corps403(api, projet) {
  return JSON.stringify({
    error: {
      code: 403,
      message: 'Google ' + api + ' API has not been used in project ' + projet + ' before or it is ' +
        'disabled. Enable it by visiting https://console.developers.google.com/apis/api/' +
        api.toLowerCase() + '.googleapis.com/overview?project=' + projet + ' then retry.',
      status: 'PERMISSION_DENIED',
    },
  }, null, 2);
}

test('chargerPanneConfigApi_ : Property FRAÎCHE → run suspendu ; fenêtre écoulée → run de re-sonde', () => {
  // Sonde RÉCENTE (C28-48) : pas de sonde ce tick-ci, la suspension tient sur la seule Property.
  const frais = ctxPanne({
    DriveAI_PANNE_CONFIG_API: String(Date.now() - 1000),
    DriveAI_PANNE_CONFIG_SONDE: String(Date.now() - 1000),
  });
  frais.c.chargerPanneConfigApi_();
  assert.strictEqual(frais.c.estPanneConfigApi_(), true);
  assert.strictEqual(frais.fetchs.length, 0, 'aucune sonde tant que la fenêtre de sonde court');

  const vieux = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 25 * 3600 * 1000) }); // > 24 h
  vieux.c.chargerPanneConfigApi_();
  assert.strictEqual(vieux.c.estPanneConfigApi_(), false, 're-sonde après la fenêtre');
  assert.ok(!('DriveAI_PANNE_CONFIG_API' in vieux.store), 'état PÉRIMÉ effacé (Santé ne doit pas mentir)');
});

test('signalerPanneConfigApi_ : erreur config → pose la suspension + 1 seule ligne Journal, retourne true', () => {
  const { c, store, journaux } = ctxPanne({});
  const e = new Error('config-api Tasks : has not been used in project');
  assert.strictEqual(c.signalerPanneConfigApi_(e), true);
  assert.ok('DriveAI_PANNE_CONFIG_API' in store, 'suspension persistée');
  assert.strictEqual(journaux.filter((m) => m.includes('PANNE CONFIG')).length, 1);
  // Re-signalée dans le même run → aucune 2ᵉ ligne (annonce unique).
  c.signalerPanneConfigApi_(e);
  assert.strictEqual(journaux.filter((m) => m.includes('PANNE CONFIG')).length, 1);
});

test('signalerPanneConfigApi_ : erreur TRANSITOIRE → false, aucune suspension (pas une panne de config)', () => {
  const { c, store } = ctxPanne({});
  assert.strictEqual(c.signalerPanneConfigApi_(new Error('HTTP 500 internal')), false);
  assert.ok(!('DriveAI_PANNE_CONFIG_API' in store));
});

/* ---------- C28-48 : message EXPLOITABLE + sonde légère + reprise automatique ---------- */

test('messageErreurGoogle_ : extrait error.message (projet GCP + URL), sinon rend le brut compacté', () => {
  const f = ctxPur.messageErreurGoogle_;
  const msg = f(corps403('Calendar', '987654321'));
  assert.ok(msg.includes('project 987654321'), 'le NUMÉRO DE PROJET survit — c\'est tout l\'intérêt');
  assert.ok(msg.includes('console.developers.google.com'), 'l\'URL d\'activation aussi');
  assert.ok(msg.indexOf('{') !== 0, 'plus de JSON indenté illisible');
  // Le vrai gain porte sur les vues TRONQUÉES (cellule d'erreur de Progression : 40 caractères —
  // en prod on n'y lisait que « config-api Calendar : {    error : {  »). Sur les 40 premiers
  // caractères, le corps brut ne dit RIEN, le message extrait dit tout.
  const brut = corps403('Calendar', '987654321');
  assert.ok(!/[A-Za-z]{4,}/.test(brut.slice(0, 25).replace(/error|code/g, '')), 'brut : que de la ponctuation');
  assert.ok(msg.slice(0, 40).includes('Calendar API'), 'extrait : l\'API fautive est lisible d\'emblée');
  assert.strictEqual(f('<html>Sorry, unable to open</html>'), '<html>Sorry, unable to open</html>');
  assert.strictEqual(f('  a\n b '), 'a b', 'brut compacté sur une ligne');
  assert.strictEqual(f(''), '');
  assert.strictEqual(f('{"error":{}}'), '{"error":{}}', 'JSON sans message → brut (jamais undefined)');
});

test('verdictSondeApi_ (PURE) : ALLOWLIST — seuls 404/2xx lèvent la suspension, tout le reste doute', () => {
  const f = ctxPur.verdictSondeApi_;
  assert.strictEqual(f(403, corps403('Tasks', '1')), 'desactivee');
  assert.strictEqual(f(404, '{"error":{"message":"Not Found"}}'), 'active', 'réponse NOMINALE : l\'ID sondé n\'existe pas');
  assert.strictEqual(f(200, '{}'), 'active');
  // Le verdict `active` est le SEUL qui rouvre le scan Gmail + les analyses LLM : il exige une
  // preuve POSITIVE. Se tromper ici rejoue la boucle que C28-22 a arrêtée ~96×/jour ; se tromper
  // dans l'autre sens ne coûte que l'attente d'avant C28-48.
  assert.strictEqual(f(400, 'Invalid id'), 'indetermine');
  assert.strictEqual(f(401, 'invalid credentials'), 'indetermine');
  assert.strictEqual(f(403, '{"error":{"message":"insufficient authentication scopes"}}'), 'indetermine',
    'un 403 de DROITS prouve que l\'API répond, mais la création échouerait de toute façon');
  assert.strictEqual(f(500, 'internal'), 'indetermine');
  assert.strictEqual(f(429, 'rate'), 'indetermine');
});

test('sonderApiConfig_ : verdict global — les DEUX API doivent répondre pour conclure « active »', () => {
  const ok = ctxPanne({}, { code: 404, corps: 'Not Found' });
  assert.strictEqual(ok.c.sonderApiConfig_().etat, 'active');
  assert.strictEqual(ok.fetchs.length, 2, 'Tasks ET Calendar sondées');

  // Tasks répond, Calendar refuse → verdict « désactivée », avec l'API fautive et son message.
  const ko = ctxPanne({}, { Tasks: { code: 404, corps: 'Not Found' }, Calendar: { code: 403, corps: corps403('Calendar', '42') } });
  const v = ko.c.sonderApiConfig_();
  assert.strictEqual(v.etat, 'desactivee');
  assert.strictEqual(v.api, 'Calendar');
  assert.ok(v.message.includes('project 42'));

  // 5xx : on ne conclut RIEN (échec fermé) — surtout pas « active ».
  const blip = ctxPanne({}, { Tasks: { code: 503, corps: 'backend error' }, Calendar: { code: 404, corps: '' } });
  assert.strictEqual(blip.c.sonderApiConfig_().etat, 'indetermine');

  // …y compris quand le doute vient de la SECONDE API (trou de couverture repéré en revue : la
  // mutation « ne retenir le doute que pour i === 0 » survivait à toute la suite).
  const blip2 = ctxPanne({}, { Tasks: { code: 404, corps: '' }, Calendar: { code: 503, corps: 'backend error' } });
  assert.strictEqual(blip2.c.sonderApiConfig_().etat, 'indetermine',
    'une seule API prouvée active ne suffit pas : les DEUX doivent répondre');

  // Réseau coupé : même prudence.
  const reseau = ctxPanne({}, new Error('DNS'));
  assert.strictEqual(reseau.c.sonderApiConfig_().etat, 'indetermine');
});

test('sonderApiConfig_ : un doute HTTP porte le POURQUOI de Google, pas seulement le code', () => {
  // Vécu 19/08 : « indetermine (Tasks) — HTTP 400 » ⇒ impossible de savoir À DISTANCE si c'est
  // l'identifiant sondé, un paramètre ou le projet — donc impossible de corriger la sonde. Le
  // message de Google tranche. Vie privée : la requête vise un ID INEXISTANT choisi par nous,
  // le corps d'erreur ne peut porter aucune donnée de Marc.
  const ctx = ctxPanne({}, {
    Tasks: { code: 400, corps: '{"error":{"code":400,"message":"Invalid task ID value"}}' },
    Calendar: { code: 404, corps: 'Not Found' },
  });
  const v = ctx.c.sonderApiConfig_();
  assert.strictEqual(v.etat, 'indetermine');
  assert.strictEqual(v.api, 'Tasks');
  assert.ok(v.message.includes('HTTP 400'), 'le code reste');
  assert.ok(v.message.includes('Invalid task ID value'), 'et la RAISON de Google est jointe');
});

test('sonde indéterminée APRÈS avoir joint l\'API : la cause affichée est rafraîchie (jamais périmée)', () => {
  // Le message de Santé disait « compte hubperso non lié — exécuter lierCompteHubperso » alors
  // que la sonde venait d'obtenir un jeton et d'appeler Tasks : une consigne PROUVÉE périmée, qui
  // envoie Marc refaire un geste déjà fait (vécu 19/08). Un verdict indéterminé ne lève toujours
  // RIEN — mais il corrige ce que Santé affirme.
  const perime = 'hubperso — compte hubperso non lié ou consentement révoqué — exécuter lierCompteHubperso';
  const ctx = ctxPanne(
    { DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000), DriveAI_PANNE_CONFIG_MSG: perime },
    { Tasks: { code: 400, corps: '{"error":{"message":"Invalid task ID value"}}' }, Calendar: { code: 404, corps: '' } });
  ctx.c.chargerPanneConfigApi_();
  assert.strictEqual(ctx.c.estPanneConfigApi_(), true, 'échec fermé : un doute ne lève RIEN');
  assert.ok(!ctx.store.DriveAI_PANNE_CONFIG_MSG.includes('lierCompteHubperso'),
    'la consigne périmée ne doit plus s\'afficher — la sonde l\'a démentie');
  assert.ok(ctx.store.DriveAI_PANNE_CONFIG_MSG.includes('Tasks'), 'la cause observée la remplace');

  // …mais un échec de REFRESH (api « hubperso ») n'apprend rien : l'ancienne cause reste la
  // meilleure information disponible, on ne l'écrase pas avec « blip ».
  const blip = ctxPanne(
    { DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000), DriveAI_PANNE_CONFIG_MSG: perime },
    { code: 404, corps: '' });
  blip.c.jetonHubperso_ = () => null;
  blip.c.etatLiaisonHubperso_ = () => 'present';
  blip.c.chargerPanneConfigApi_();
  assert.strictEqual(blip.store.DriveAI_PANNE_CONFIG_MSG, perime, 'un blip n\'efface pas le diagnostic');

  // FRONTIÈRE : la seule cause qu'un jeton DÉMENT est « compte non lié ». Un diagnostic d'API non
  // activée reste vrai tant qu'une sonde ne l'infirme pas — un doute ne doit JAMAIS l'effacer
  // (sinon on perd le numéro de projet GCP et l'URL d'activation, seules infos actionnables).
  const certain = 'Calendar — Google Calendar API has not been used in project 777 before';
  const autre = ctxPanne(
    { DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000), DriveAI_PANNE_CONFIG_MSG: certain },
    { Tasks: { code: 400, corps: 'Invalid' }, Calendar: { code: 404, corps: '' } });
  autre.c.chargerPanneConfigApi_();
  assert.strictEqual(autre.store.DriveAI_PANNE_CONFIG_MSG, certain,
    'un doute ne remplace QUE la cause qu\'il a démentie');
});

test('sonderApiConfig_ : SANS jeton hubperso → « desactivee (hubperso) », zéro appel réseau (ADR-0041)', () => {
  // Compte jamais lié ou consentement révoqué (credentials ABSENTS) : les créations sont
  // IMPOSSIBLES — le verdict doit être certain (la suspension se rafraîchit, Santé porte la
  // consigne actionnable), et la sonde ne doit toucher AUCUNE API (pas de jeton à présenter).
  const sansJeton = ctxPanne({}, { code: 404, corps: '' });
  sansJeton.c.jetonHubperso_ = () => null;
  sansJeton.c.etatLiaisonHubperso_ = () => 'absent';
  const v = sansJeton.c.sonderApiConfig_();
  assert.strictEqual(v.etat, 'desactivee');
  assert.strictEqual(v.api, 'hubperso', 'la cause est nommée — Santé doit dire « lier le compte », pas « activer l\'API »');
  assert.ok(v.message.includes('lierCompteHubperso'), 'la consigne actionnable est dans le message');
  assert.strictEqual(sansJeton.fetchs.length, 0, 'aucun appel réseau sans jeton');

  // …et la suspension déjà en cours se MAINTIENT avec ce diagnostic (chemin sonderEtLeverPanneConfig_).
  const suspendu = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { code: 404, corps: '' });
  suspendu.c.jetonHubperso_ = () => null;
  suspendu.c.etatLiaisonHubperso_ = () => 'absent';
  suspendu.c.chargerPanneConfigApi_();
  assert.strictEqual(suspendu.c.estPanneConfigApi_(), true, 'pas de jeton ⇒ la suspension tient');
  assert.ok(suspendu.store.DriveAI_PANNE_CONFIG_MSG.includes('hubperso'), 'le diagnostic hubperso est mémorisé pour Santé');
});

test('sonderApiConfig_ : refresh en échec TRANSITOIRE (creds présentes) → indéterminé, jamais « re-lier » (revue F2)', () => {
  // Un blip 5xx du endpoint de jeton rend jetonHubperso_() null alors que la liaison EXISTE : dire
  // « compte non lié » enverrait Marc re-consentir pour rien, et rafraîchirait la suspension sur
  // un doute. Le verdict indéterminé ne lève rien, n'affirme rien — la sonde suivante tranchera.
  for (const liaison of ['present', 'inconnu']) {
    const blip = ctxPanne({}, { code: 404, corps: '' });
    blip.c.jetonHubperso_ = () => null;
    blip.c.etatLiaisonHubperso_ = () => liaison;
    const v = blip.c.sonderApiConfig_();
    assert.strictEqual(v.etat, 'indetermine', 'liaison ' + liaison + ' : on ne conclut RIEN');
    assert.ok(!v.message.includes('lierCompteHubperso'), 'jamais la consigne de re-liaison sur un blip');
    assert.strictEqual(blip.fetchs.length, 0);
  }
});

test('sonderApiConfig_ : le garde-temps est DANS la boucle — une sonde lente ne mange pas le tick', () => {
  // `UrlFetchApp` n'a AUCUN timeout en Apps Script : deux endpoints qui pendent, c'est ~2 min
  // prélevées en tête de tick. Le garde doit couper ENTRE les deux appels, pas seulement avant
  // le premier (leçon §7 : « un garde-temps vit DANS la boucle qu'il protège »).
  const lent = ctxPanne({}, { code: 404, corps: '' });
  lent.c.CONFIG.PANNE_CONFIG_SONDE_MAX_MS = 1;
  lent.opts.retardMs = 5;
  assert.strictEqual(lent.c.sonderApiConfig_().etat, 'indetermine', 'passe abandonnée, rien n\'est levé');
  assert.strictEqual(lent.fetchs.length, 1, 'le 2e appel est coupé par le garde, pas exécuté');

  // Sonde normale : les deux API sont bien interrogées.
  const rapide = ctxPanne({}, { code: 404, corps: '' });
  assert.strictEqual(rapide.c.sonderApiConfig_().etat, 'active');
  assert.strictEqual(rapide.fetchs.length, 2);
});

test('chargerPanneConfigApi_ : anti-boucle NON armé (Property en panne) ⇒ aucune sonde du tout', () => {
  const { c, fetchs } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { code: 404, corps: '' });
  const props = c.PropertiesService.getScriptProperties();
  const vrai = props.setProperty;
  props.setProperty = (k, v) => { if (k === 'DriveAI_PANNE_CONFIG_SONDE') throw new Error('quota'); vrai(k, v); };
  c.PropertiesService = { getScriptProperties: () => props };
  c.chargerPanneConfigApi_();
  assert.strictEqual(fetchs.length, 0, 'sans horodatage, la sonde repartirait à CHAQUE tick — donc on ne sonde pas');
  assert.strictEqual(c.estPanneConfigApi_(), true, 'et la suspension tient');
});

test('chargerPanneConfigApi_ : API réactivée → la suspension se lève TOUTE SEULE dès le tick suivant', () => {
  const { c, store, infos, fetchs } = ctxPanne({
    DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000),
    DriveAI_PANNE_CONFIG_MSG: 'Calendar — not been used in project 42',
  }, { code: 404, corps: 'Not Found' });
  c.chargerPanneConfigApi_();
  assert.strictEqual(c.estPanneConfigApi_(), false, 'les intentions repartent DÈS CE TICK');
  assert.ok(!('DriveAI_PANNE_CONFIG_API' in store), 'suspension effacée');
  assert.ok(!('DriveAI_PANNE_CONFIG_MSG' in store), 'message périmé effacé');
  assert.strictEqual(infos.filter((m) => m.includes('REPRISE')).length, 1);
  assert.ok(fetchs.length > 0, 'la reprise vient d\'une SONDE réelle, jamais d\'un délai qui expire');
  assert.ok(Number(store.DriveAI_PANNE_CONFIG_OK) > 0,
    'la sonde POSITIVE est datée — c\'est la preuve qui autorise Santé à dire « actives »');
});

test('signalerPanneConfigApi_ : un message qui ne vient PAS du diagnostic d\'API ne fuite pas dans Santé', () => {
  // Défense en profondeur (ADR-0007) : le `catch` de `creerIntentionIdempotente_` enveloppe toute
  // la création — un futur `throw` ajouté là pourrait porter le TITRE d'un mail. Le filtre de
  // PROVENANCE (préfixe `config-api <API> : `) dégrade alors vers un libellé générique.
  const { c, store } = ctxPanne({});
  c.signalerPanneConfigApi_(new Error('Facture EDF de Marc — accessNotConfigured'));
  assert.ok(!store.DriveAI_PANNE_CONFIG_MSG.includes('Facture EDF'), 'aucun contenu utilisateur persisté');
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.includes('non activée'));
});

test('chargerPanneConfigApi_ : toujours désactivée → reste suspendu et MÉMORISE le message exploitable', () => {
  const { c, store } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { Tasks: { code: 404, corps: '' }, Calendar: { code: 403, corps: corps403('Calendar', '777') } });
  c.chargerPanneConfigApi_();
  assert.strictEqual(c.estPanneConfigApi_(), true);
  assert.ok('DriveAI_PANNE_CONFIG_API' in store, 'suspension maintenue');
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.includes('Calendar'), 'l\'API fautive est nommée');
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.includes('project 777'), 'le projet GCP est lisible dans Santé');
});

test('chargerPanneConfigApi_ : sonde INDÉTERMINÉE → reste suspendu, et n\'ÉCRASE PAS le diagnostic connu', () => {
  const { c, store } = ctxPanne({
    DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000),
    DriveAI_PANNE_CONFIG_MSG: 'Calendar — has not been used in project 777',
  }, { code: 500, corps: 'oops' });
  c.chargerPanneConfigApi_();
  assert.strictEqual(c.estPanneConfigApi_(), true, 'un doute ne lève JAMAIS la suspension');
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.includes('project 777'), 'le vrai diagnostic survit au blip');
});

test('chargerPanneConfigApi_ : la fenêtre de sonde est armée AVANT l\'appel, même si la sonde échoue', () => {
  const { c, store, fetchs } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    new Error('UrlFetch indisponible'));
  // L'ORDRE est l'invariant : au moment où le réseau est sollicité, l'anti-boucle doit DÉJÀ être
  // posé. Sans cette assertion, déplacer le `setProperty` après la sonde laissait la suite verte
  // (mutation vérifiée en revue) — le test ne prouvait alors pas son propre titre.
  let armeAuMomentDuFetch = null;
  const fetchReel = c.UrlFetchApp.fetch;
  c.UrlFetchApp = { fetch: (url) => {
    if (armeAuMomentDuFetch === null) armeAuMomentDuFetch = 'DriveAI_PANNE_CONFIG_SONDE' in store;
    return fetchReel(url);
  } };
  c.chargerPanneConfigApi_();
  assert.strictEqual(armeAuMomentDuFetch, true, 'anti-boucle posé AVANT le premier appel réseau');
  assert.strictEqual(c.estPanneConfigApi_(), true);
  assert.ok('DriveAI_PANNE_CONFIG_SONDE' in store, 'la fenêtre reste armée malgré l\'échec');
  const n = fetchs.length;
  c.chargerPanneConfigApi_(); // tick suivant, immédiat
  assert.strictEqual(fetchs.length, n, 'pas de re-sonde tant que la fenêtre court');
});

test('signalerPanneConfigApi_ : un 403 dont la signature n\'est PAS dans error.message suspend quand même', () => {
  // 🔴 trouvé en revue AVANT merge. `creerTache_`/`creerEvenement_` testent la signature sur le
  // corps BRUT, puis lèvent `'config-api X : ' + messageErreurGoogle_(corps)`. Or
  // `accessNotConfigured` / `SERVICE_DISABLED` vivent dans `error.errors[].reason` / `error.status`,
  // JAMAIS dans `error.message` : re-dériver le verdict sur le message EXTRAIT rendait `false` —
  // aucune suspension posée, le mail re-analysé à chaque tick (l'incident C28-22 de retour) et la
  // sonde jamais armée. Le PRÉFIXE canonique fait désormais foi.
  const corpsESF = JSON.stringify({ error: { code: 403,
    message: 'Access Not Configured. The API (tasks) is not enabled for your project.',
    errors: [{ domain: 'usageLimits', reason: 'accessNotConfigured' }], status: 'PERMISSION_DENIED' } }, null, 2);
  const c0 = ctxPur;
  assert.strictEqual(c0.estMessageApiDesactivee_(corpsESF), true, 'le corps BRUT porte bien la signature');
  const extrait = 'config-api Tasks : ' + c0.messageErreurGoogle_(corpsESF);
  assert.strictEqual(c0.estMessageApiDesactivee_(extrait), false, 'mais le message EXTRAIT ne la porte plus');

  const { c, store } = ctxPanne({});
  assert.strictEqual(c.signalerPanneConfigApi_(new Error(extrait)), true, 'suspendu quand même');
  assert.ok('DriveAI_PANNE_CONFIG_API' in store);
});

test('chargerPanneConfigApi_ : une sonde qui CONFIRME le refus garde la suspension (et la sonde) vivante', () => {
  // Sans ce rafraîchissement, la fenêtre de 24 h expirait, l'état était effacé comme « périmé »,
  // la sonde s'éteignait (elle n'existe que pendant une panne) et Santé repassait au vert alors
  // que la sonde venait de prouver le contraire (revue code C28-48).
  const t0 = Date.now() - 20 * 3600 * 1000; // panne posée il y a 20 h
  const { c, store } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(t0) },
    { Tasks: { code: 404, corps: '' }, Calendar: { code: 403, corps: corps403('Calendar', '42') } });
  c.chargerPanneConfigApi_();
  assert.strictEqual(c.estPanneConfigApi_(), true);
  assert.ok(Number(store.DriveAI_PANNE_CONFIG_API) > t0, 'suspension rafraîchie par la sonde qui confirme');
  assert.strictEqual(store.DriveAI_PANNE_CONFIG_SONDE_ETAT.indexOf('desactivee'), 0, 'verdict de sonde tracé');
});

test('sonde MUETTE impossible : un verdict indéterminé répété reste visible dans l\'état', () => {
  // Avec l'allowlist, un 400 systématique (ex. Google resserre la validation de l'identifiant
  // sondé) rendrait la reprise inopérante À VIE. Le verdict est donc persisté à chaque passe.
  const { c, store } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { code: 400, corps: 'Invalid id' });
  c.chargerPanneConfigApi_();
  assert.strictEqual(store.DriveAI_PANNE_CONFIG_SONDE_ETAT.indexOf('indetermine'), 0);
  assert.strictEqual(c.etatPanneConfigApi_().sonde.indexOf('indetermine'), 0, 'et remonté jusqu\'à Santé');
});

test('etatPanneConfigApi_ : une preuve positive PÉRIMÉE ne verdit plus Santé', () => {
  // Panne #1 résolue il y a des semaines (OK ancien), puis panne #2 dont la fenêtre a expiré :
  // `actif` est faux, mais afficher « actives (sondées le <vieille date>) » serait un mensonge.
  const vieux = ctxPanne({ DriveAI_PANNE_CONFIG_OK: String(Date.now() - 30 * 24 * 3600 * 1000) });
  assert.strictEqual(vieux.c.etatPanneConfigApi_().sondeOkMs, 0, 'preuve trop vieille = plus une preuve');
  const frais = ctxPanne({ DriveAI_PANNE_CONFIG_OK: String(Date.now() - 60 * 1000) });
  assert.ok(frais.c.etatPanneConfigApi_().sondeOkMs > 0);
  // Et une panne constatée EFFACE la preuve positive précédente.
  const apres = ctxPanne({ DriveAI_PANNE_CONFIG_OK: String(Date.now() - 60 * 1000) });
  apres.c.signalerPanneConfigApi_(new Error('config-api Calendar : has not been used in project 42'));
  assert.ok(!('DriveAI_PANNE_CONFIG_OK' in apres.store), 'preuve caduque supprimée');
});

test('chargerPanneConfigApi_ : appelée NUE en tête de tick, elle ne LÈVE JAMAIS (sinon le tick gèle)', () => {
  const { c, store } = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { code: 404, corps: '' });
  c.journalInfo_ = () => { throw new Error('Sheet indisponible'); }; // pire cas : le Journal casse
  assert.doesNotThrow(() => c.chargerPanneConfigApi_());
  // …et la reprise a quand même eu lieu : l'état est levé AVANT l'écriture de confort.
  assert.strictEqual(c.estPanneConfigApi_(), false);
  assert.ok(!('DriveAI_PANNE_CONFIG_API' in store));
});

test('etatPanneConfigApi_ : n\'annonce une panne que DANS la fenêtre (même règle que la décision)', () => {
  const dedans = ctxPanne({
    DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000),
    DriveAI_PANNE_CONFIG_MSG: 'Calendar — project 777',
  });
  const e1 = dedans.c.etatPanneConfigApi_();
  assert.strictEqual(e1.actif, true);
  assert.ok(e1.message.includes('777'));

  const dehors = ctxPanne({
    DriveAI_PANNE_CONFIG_API: String(Date.now() - 25 * 3600 * 1000),
    DriveAI_PANNE_CONFIG_MSG: 'Calendar — project 777',
  });
  const e2 = dehors.c.etatPanneConfigApi_();
  assert.strictEqual(e2.actif, false, 'fenêtre écoulée = plus de suspension, donc plus d\'alarme');
  assert.strictEqual(e2.message, '', 'et surtout plus de message périmé');
});

test('signalerPanneConfigApi_ : mémorise aussi le message pour Santé (sans le préfixe d\'API vide)', () => {
  const { c, store } = ctxPanne({});
  c.signalerPanneConfigApi_(new Error('config-api Calendar : Google Calendar API has not been used in project 555'));
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.indexOf('config-api Calendar') === 0);
  assert.ok(store.DriveAI_PANNE_CONFIG_MSG.includes('project 555'));
});

/* ---------- creerIntentionIdempotente_ : classement des échecs ---------- */

function ctxCreation(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'GoogleApi.gs', 'Intentions.gs']);
  const store = Object.assign({}, opts.props);
  const index = {};
  const ajouts = [];
  const journaux = [];
  const echecs = {};
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, r) => { index[cle] = true; ajouts.push({ cle, statut: r.statut }); };
  c.journalErreur_ = (s, m) => journaux.push(m);
  c.tronquer_ = (s) => s;
  c.incrementerEchec_ = (cle) => { echecs[cle] = (echecs[cle] || 0) + 1; return echecs[cle]; };
  c.creerTache_ = opts.creerTache_ || (() => 't-id');
  c.creerEvenement_ = opts.creerEvenement_ || (() => 'e-id');
  c.hashHex_ = (s) => 'h' + String(s).length; // Utilities.computeDigest absent du harness — stub déterministe
  return { c, store, ajouts, journaux, echecs };
}

const TACHE = { type: 'tache', titre: 'Payer facture', date: '2026-07-20', heure: null };

test('creerIntentionIdempotente_ : succès → indexée « creee »', () => {
  const { c, ajouts } = ctxCreation({});
  assert.strictEqual(c.creerIntentionIdempotente_('M1', TACHE), 'creee');
  assert.ok(ajouts.some((a) => a.cle.indexOf('tache|M1|') === 0 && a.statut === 'tache'));
});

test('creerIntentionIdempotente_ : API non activée → panne CONFIG posée + RELÈVE (suspend le run)', () => {
  const { c, store } = ctxCreation({
    creerTache_: () => { throw new Error('config-api Tasks : has not been used in project'); },
  });
  assert.throws(() => c.creerIntentionIdempotente_('M1', TACHE), /has not been used/);
  assert.ok('DriveAI_PANNE_CONFIG_API' in store, 'suspension persistée posée avant la relève');
});

test('creerIntentionIdempotente_ : échec TRANSITOIRE (retour vide) → 3-strikes puis « deja-faite » débloque le message', () => {
  const { c, journaux, echecs } = ctxCreation({ creerTache_: () => '' }); // 500/400 déjà journalisé, retour vide
  const MAX = ctxPur.CONFIG.QUARANTAINE_MAX; // dérivé de la CONSTANTE
  for (let i = 1; i < MAX; i++) {
    assert.strictEqual(c.creerIntentionIdempotente_('M1', TACHE), 'echec', `essai ${i} → retenté`);
  }
  assert.strictEqual(c.creerIntentionIdempotente_('M1', TACHE), 'deja-faite', 'au 3ᵉ essai → abandon (message libéré)');
  assert.strictEqual(echecs['api-intention|M1'], MAX, 'compteur clé sur le messageId SEUL');
  assert.strictEqual(journaux.filter((m) => m.includes('ABANDONNÉE')).length, 1);
});

test('creerIntentionIdempotente_ : convergence même si le TITRE fluctue (compteur clé sur messageId, pas le contenu)', () => {
  // Régression du correctif revue flotte : le titre LLM (Sonnet 2 passes) peut CHANGER d'un run à
  // l'autre. Un compteur clé sur le contenu ne s'accumulerait jamais → NON-CONVERGENCE (re-tenté à
  // vie, quota drainé). Clé sur le messageId : il converge malgré la fluctuation.
  const { c, journaux, echecs } = ctxCreation({ creerTache_: () => '' });
  const MAX = ctxPur.CONFIG.QUARANTAINE_MAX;
  let r = 'echec';
  for (let i = 1; i <= MAX; i++) {
    // Titre différent à CHAQUE appel → `cle` (index) différent, mais le compteur reste api-intention|M1.
    r = c.creerIntentionIdempotente_('M1', { type: 'tache', titre: 'Payer facture v' + i, date: '2026-07-20', heure: null });
  }
  assert.strictEqual(r, 'deja-faite', 'converge et abandonne malgré le titre changeant');
  assert.strictEqual(echecs['api-intention|M1'], MAX, 'un seul compteur (messageId), accumulé sur tous les titres');
  assert.strictEqual(Object.keys(echecs).length, 1, 'jamais un compteur par contenu (sinon jamais de convergence)');
  assert.strictEqual(journaux.filter((m) => m.includes('ABANDONNÉE')).length, 1, 'journalisé une seule fois');
});

test('creerIntentionIdempotente_ : au-delà du seuil (essais > MAX) → « deja-faite » SANS re-journaliser', () => {
  const { c, journaux } = ctxCreation({ creerTache_: () => '' });
  const MAX = ctxPur.CONFIG.QUARANTAINE_MAX;
  for (let i = 0; i < MAX + 3; i++) {
    // Titre fluctuant → jamais court-circuité par l'Index ; on vérifie que le journal ne re-spamme pas.
    c.creerIntentionIdempotente_('M1', { type: 'tache', titre: 'Facture ' + i, date: '2026-07-20', heure: null });
  }
  assert.strictEqual(journaux.filter((m) => m.includes('ABANDONNÉE')).length, 1, 'journal UNE fois (=== seuil), jamais à chaque tick au-delà');
});

test('creerIntentionIdempotente_ : déjà indexée → « deja-faite » sans appel API', () => {
  const { c } = ctxCreation({ creerTache_: () => { throw new Error('ne doit pas être appelé'); } });
  const hash = c.hashHex_(TACHE.titre + '|' + TACHE.date + '|');
  c.indexAjouter_('tache|M1|' + hash, { statut: 'tache', nom: TACHE.titre }); // pré-indexée
  assert.strictEqual(c.creerIntentionIdempotente_('M1', TACHE), 'deja-faite');
});

/* ---------- traiterIntentionsMail_ suspendu pendant la panne config ---------- */

test('traiterIntentionsMail_ : panne config active → retour immédiat, aucun scan Gmail', () => {
  const c = load(['Config.gs', 'GoogleApi.gs', 'Intentions.gs']);
  c.estPanneGmail_ = () => false;
  c.chargerPanneConfigApi_ = () => {};
  c.estPanneConfigApi_ = () => true; // panne active
  let scanne = false;
  c.balayerNouveauxMails_ = () => { scanne = true; };
  c.balayerArriereHistorique_ = () => { scanne = true; };
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(scanne, false, 'aucun balayage tant que l\'API est en panne de config');
});

/* ---------- bouclier ANTI-ARNAQUES (heuristiquePhishing_ / promo non lue, AVANT le LLM) ---------- */

function ctxBouclier(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Intentions.gs']);
  const index = {};
  const ajouts = [];
  let miniCheckAppels = 0;
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, r) => { index[cle] = true; ajouts.push({ cle, statut: r.statut }); };
  c.ecarteParMotsCles_ = () => false;
  c.toucheZoneProtegee_ = () => false;
  c.piecesJointes_ = () => (opts.pj || []).map((n) => ({ getName: () => n }));
  c.estPromoGmail_ = () => !!opts.promo;
  c.miniCheckMail_ = () => { miniCheckAppels++; return { action: true, important: false }; };
  c.extraireIntentions_ = () => [];
  c.tronquer_ = (s) => s;
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.libellesUtilisateur_ = () => ({});
  return { c, ajouts, appelsLlm: () => miniCheckAppels };
}

function messageBouclier(opts) {
  opts = opts || {};
  return {
    getId: () => 'MB', getFrom: () => 'x@y.z', getSubject: () => (opts.sujet || 'Bonjour'),
    getPlainBody: () => 'corps', getThread: () => ({}),
    getHeader: (h) => (h === 'List-Unsubscribe' && opts.unsub ? '<mailto:u@x>' : ''),
    isUnread: () => !!opts.nonLu,
  };
}

test('bouclier : PJ EXÉCUTABLE → mail ÉCARTÉ (0), AUCUN appel LLM (tripwire anti-arnaque)', () => {
  const { c, ajouts, appelsLlm } = ctxBouclier({ pj: ['facture.exe'] });
  assert.strictEqual(c.traiterMessagePourIntentions_(messageBouclier({}), 'F1'), 0);
  assert.strictEqual(appelsLlm(), 0, 'écarté AVANT le mini-check LLM (gratuit)');
  assert.ok(ajouts.some((a) => a.cle === 'intention|MB' && a.statut === 'intention-ecartee'));
});

test('bouclier : PROMO déterministe NON LUE → mail ÉCARTÉ (0), AUCUN appel LLM', () => {
  const { c, ajouts, appelsLlm } = ctxBouclier({ promo: true });
  assert.strictEqual(c.traiterMessagePourIntentions_(messageBouclier({ unsub: true, nonLu: true }), 'F1'), 0);
  assert.strictEqual(appelsLlm(), 0);
  assert.ok(ajouts.some((a) => a.cle === 'intention|MB' && a.statut === 'intention-ecartee'));
});

test('bouclier : promo LUE (Marc l\'a ouverte) → PAS écartée par ce chemin, mini-check appelé (non-régression)', () => {
  const { c, appelsLlm } = ctxBouclier({ promo: true });
  c.traiterMessagePourIntentions_(messageBouclier({ unsub: true, nonLu: false }), 'F1');
  assert.strictEqual(appelsLlm(), 1, 'une promo LUE peut porter une action que Marc veut suivre');
});

test('bouclier : mail sain (ni suspect ni promo) → mini-check appelé normalement (non-régression)', () => {
  const { c, appelsLlm } = ctxBouclier({ pj: ['releve.pdf'] });
  c.traiterMessagePourIntentions_(messageBouclier({ sujet: 'Relevé mensuel' }), 'F1');
  assert.strictEqual(appelsLlm(), 1);
});

test('sonde INDÉTERMINÉE : le POURQUOI (code HTTP) est PERSISTÉ — sinon impossible de trancher à distance', () => {
  // Vécu 19/08 : Santé affichait « indetermine (Tasks) » sans le code HTTP → impossible de savoir
  // si l'API était non activée, si l'identifiant sondé était refusé (400) ou si le jeton était
  // invalide (401). Une observabilité qui ne dit pas POURQUOI ne sert à rien.
  const h = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { Tasks: { code: 400, corps: 'Invalid task id' }, Calendar: { code: 404, corps: '' } });
  h.c.chargerPanneConfigApi_();
  const etat = String(h.store.DriveAI_PANNE_CONFIG_SONDE_ETAT || '');
  assert.ok(etat.indexOf('indetermine') === 0, 'verdict conservé : ' + etat);
  assert.ok(etat.includes('Tasks'), 'l\'API concernée est nommée');
  assert.ok(etat.includes('400'), 'le code HTTP est LISIBLE dans Santé : ' + etat);
  assert.strictEqual(h.c.estPanneConfigApi_(), true, 'un doute ne lève JAMAIS la suspension');
});

test('sonde DÉSACTIVÉE : pas de doublon du message (son canal dédié reste DriveAI_PANNE_CONFIG_MSG)', () => {
  const h = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { Tasks: { code: 403, corps: corps403('Tasks', '777') }, Calendar: { code: 404, corps: '' } });
  h.c.chargerPanneConfigApi_();
  const etat = String(h.store.DriveAI_PANNE_CONFIG_SONDE_ETAT || '');
  assert.strictEqual(etat, 'desactivee (Tasks)', 'état court ; le détail vit dans _MSG');
  assert.ok(String(h.store.DriveAI_PANNE_CONFIG_MSG).includes('project 777'));
});
