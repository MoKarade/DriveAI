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
  c.messageJetonHubpersoIndisponible_ = () => 'refresh OAuth hubperso momentanément impossible'; // JetonHubperso.gs non chargé
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

test('memoriserMessageConfigApi_ : les call sites à `api` RENSEIGNÉ viennent TOUS de la sonde (M3)', () => {
  // Le filtre de provenance (`PREFIXE_CONFIG_API`) ne s'applique QUE si `api` est vide : sur
  // l'autre branche, la garantie « aucune donnée de Marc » repose sur la PROVENANCE de l'appel,
  // pas sur le contenu. Ce n'est pas déductible du code de la fonction — donc on le verrouille
  // ici (revue sécurité) : tout nouvel appelant à `api` renseigné doit prouver la même provenance.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'GoogleApi.gs'), 'utf8');
  const appels = src.split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter((x) => /^memoriserMessageConfigApi_\(/.test(x.l));
  assert.strictEqual(appels.length, 3, 'call sites connus : 2 sonde + 1 signalement (sinon : revue)');
  const avecApi = appels.filter((x) => !/,\s*''\s*,/.test(x.l));
  assert.strictEqual(avecApi.length, 2, 'exactement 2 appels à `api` renseigné');
  for (const a of avecApi) {
    assert.match(a.l, /^memoriserMessageConfigApi_\(props, verdict\.api, verdict\.message\);$/,
      'GoogleApi.gs:' + a.n + ' : un `api` renseigné ne peut venir que d\'un VERDICT de sonde — ' +
      'tout autre message (exception enveloppant la création d\'intention, titre de mail…) doit ' +
      'passer par `api = \'\'` pour retomber sous le filtre de provenance');
  }
  // …et le filtre protège toujours l'autre branche (le cas historique).
  const sansApi = appels.filter((x) => /,\s*''\s*,/.test(x.l));
  assert.strictEqual(sansApi.length, 1, 'le signalement d\'exception reste filtré');
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

test('la cause n\'est remplacée que par une RÉPONSE d\'API, et jamais par un 401 (revue 1/2/5)', () => {
  const consigne = 'hubperso — compte non lié — exécuter lierCompteHubperso (docs/HUBPERSO.md)';
  const props = () => ({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000), DriveAI_PANNE_CONFIG_MSG: consigne });

  // (a) 401 : `jetonHubperso_` sert un access token du CACHE ~53 min — un consentement révoqué
  //     reste invisible jusqu'à ce 401. L'effacer effacerait la SEULE consigne actionnable.
  const nonAutorise = ctxPanne(props(), { Tasks: { code: 401, corps: 'Invalid Credentials' }, Calendar: { code: 404, corps: '' } });
  nonAutorise.c.chargerPanneConfigApi_();
  assert.strictEqual(nonAutorise.store.DriveAI_PANNE_CONFIG_MSG, consigne, '401 : la consigne reste');

  // (b) exception réseau : aucune API n'a répondu, donc rien n'est prouvé.
  const reseau = ctxPanne(props(), new Error('DNS'));
  reseau.c.chargerPanneConfigApi_();
  assert.strictEqual(reseau.store.DriveAI_PANNE_CONFIG_MSG, consigne, 'réseau : la consigne reste');

  // (c) 400 : l'API a bien répondu (et pas 401) ⇒ les credentials sont valides ⇒ la consigne tombe.
  const repond = ctxPanne(props(), { Tasks: { code: 400, corps: 'Invalid' }, Calendar: { code: 404, corps: '' } });
  repond.c.chargerPanneConfigApi_();
  assert.ok(!repond.store.DriveAI_PANNE_CONFIG_MSG.includes('lierCompteHubperso'), '400 : la consigne démentie tombe');

  // (d) le prédicat vise la CONSIGNE, pas le préfixe `hubperso — ` : d'autres causes le portent
  //     (« sonde interrompue ») et ne sont PAS démenties — sinon le prédicat restait vrai à vie et
  //     un blip finissait par écraser un diagnostic certain (revue code 1).
  const f = ctxPur.causeLiaisonHubperso_;
  assert.strictEqual(f(consigne), true);
  assert.strictEqual(f('hubperso — sonde interrompue (refresh OAuth trop lent)'), false);
  assert.strictEqual(f('hubperso — refresh OAuth hubperso momentanément impossible'), false);
  assert.strictEqual(f('Tasks — HTTP 500 — backend error'), false);
  assert.strictEqual(f(''), false);
  assert.strictEqual(f(null), false);
});

test('une passe ABANDONNÉE se distingue d\'une passe complète (revue code 3)', () => {
  // Sinon l'état persisté est STRICTEMENT identique et on croit à tort que la 2ᵉ API a répondu —
  // alors qu'elle n'a peut-être jamais été appelée. On ne peut alors rien conclure sur elle.
  const lent = ctxPanne({}, { Tasks: { code: 400, corps: 'Invalid' }, Calendar: { code: 404, corps: '' } });
  lent.c.CONFIG.PANNE_CONFIG_SONDE_MAX_MS = 1;
  lent.opts.retardMs = 5;
  const v = lent.c.sonderApiConfig_();
  assert.strictEqual(lent.fetchs.length, 1, 'la 2ᵉ API n\'a PAS été sondée');
  assert.ok(v.message.includes('passe abandonnée'), 'et le verdict le DIT');
  assert.ok(v.message.includes('HTTP 400'), 'sans perdre ce qui a été observé');
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
  // sondé) supprimerait la reprise rapide sans aucune trace. Le verdict est persisté à chaque passe.
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

test('traiterIntentionsMail_ : panne config active → le scan TOURNE quand même (ADR-0049 : seule la création est suspendue)', () => {
  // Avant ADR-0049 : « retour immédiat, aucun scan » — et donc aucune clé `important|`, donc un tri
  // qui n'archivait plus rien pendant toute la panne (six jours en septembre 2026).
  const c = load(['Config.gs', 'GoogleApi.gs', 'Intentions.gs']);
  c.estPanneGmail_ = () => false;
  c.chargerPanneConfigApi_ = () => {};
  c.estPanneConfigApi_ = () => true; // panne active
  c.estPannePlateforme_ = () => false;
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) };
  let scanne = false;
  c.balayerNouveauxMails_ = () => { scanne = true; };
  c.balayerArriereHistorique_ = () => { scanne = true; };
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(scanne, true, 'l\'analyse continue pendant une panne de config');
});

/* ---------- ADR-0049 (C28-76) : l'analyse continue pendant une panne de création ---------- */

/**
 * Contexte du scan avant + traitement par message, avec Index/Properties en mémoire et TOUS les
 * coûts comptés (mini-check, extraction, lecture du corps, pages Gmail, créations).
 * @param {Object} opts  { pages: [[fil…], …], index: {…}, props: {…}, panneConfig: bool,
 *   check: {action,important}, zoneProtegee: fn }
 */
function ctxDiffere(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs', 'Intentions.gs']);
  const calls = { index: { ...(opts.index || {}) }, ajouts: [], props: { ...(opts.props || {}) }, ecritures: [],
    miniChecks: 0, extractions: 0, corps: 0, pages: [], creations: [], importants: [], infos: [] };
  let panne = !!opts.panneConfig;
  c.estPanneConfigApi_ = () => panne;
  c.estPannePlateforme_ = () => false;
  c.estPanneGmail_ = () => false;
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.indexContient_ = (cle) => !!calls.index[cle];
  c.indexAjouter_ = (cle, r) => { calls.index[cle] = true; calls.ajouts.push({ cle, statut: r.statut }); };
  c.ecarteParMotsCles_ = () => false;
  c.toucheZoneProtegee_ = opts.zoneProtegee || (() => false);
  c.piecesJointes_ = () => [];
  c.estPromoGmail_ = () => false;
  c.miniCheckMail_ = () => { calls.miniChecks++; return opts.check || { action: true, important: false }; };
  c.marquerMailImportant_ = (id) => { calls.importants.push(id); calls.index['important|' + id] = true; };
  c.extraireIntentions_ = () => { calls.extractions++; return [{ type: 'tache', titre: 'T', date: null, heure: null, confiance: 1 }]; };
  c.creerIntentionIdempotente_ = (id) => { calls.creations.push(id); return 'creee'; };
  c.tronquer_ = (t) => t;
  c.journalInfo_ = (s, m) => calls.infos.push(m);
  c.journalErreur_ = () => {};
  c.notifierEchec_ = () => {};
  c.libellesUtilisateur_ = () => ({});
  c.PropertiesService = { getScriptProperties: () => {
    if (opts.propsHS) throw new Error('Properties HS');
    return {
      getProperty: (k) => calls.props[k] ?? null,
      setProperty: (k, v) => { calls.props[k] = v; calls.ecritures.push(['set', k]); },
      deleteProperty: (k) => { delete calls.props[k]; calls.ecritures.push(['del', k]); },
    };
  } };
  const pages = opts.pages || []; // même tableau : le test peut le remplir APRÈS la construction
  c.pageFilsActions_ = (debut) => { calls.pages.push(debut); return pages[debut / c.CONFIG.PAGE_FILS_ACTIONS] || []; };
  c.balayerArriereHistorique_ = () => {}; // isolé : on teste le scan AVANT
  return { c, calls, setPanne: (v) => { panne = v; } };
}

function msgD(id, calls) {
  return {
    getId: () => id, getFrom: () => 'x@y.z', getSubject: () => 'Facture à payer',
    getPlainBody: () => { calls.corps++; return 'corps'; }, getHeader: () => '', isUnread: () => false,
  };
}
function filD(id, messages) { return { getId: () => id, getMessages: () => messages }; }

test('différé : panne de création + mail actionnable → analyse| posé, important| posé, AUCUNE extraction', () => {
  const { c, calls } = ctxDiffere({ panneConfig: true, check: { action: true, important: true } });
  const etat = { differes: 0 };
  assert.strictEqual(c.traiterMessagePourIntentions_(msgD('M1', calls), 'F1', etat), 0);
  assert.strictEqual(calls.miniChecks, 1, 'l\'analyse a bien eu lieu');
  assert.deepStrictEqual(calls.importants, ['M1'], 'le verdict que le TRI attend est posé');
  assert.ok(calls.ajouts.some((a) => a.cle === 'analyse|M1' && a.statut === 'intention-en-attente-api'));
  assert.ok(!calls.ajouts.some((a) => a.cle === 'intention|M1'), 'PAS « entièrement traité » : la création attend');
  assert.strictEqual(calls.extractions, 0, 'aucun appel LLM dont le résultat ne pourrait servir');
  assert.strictEqual(calls.creations.length, 0);
  assert.strictEqual(etat.differes, 1, 'le bord du backlog est rapporté à l\'orchestrateur');
});

test('différé : mail SANS action pendant la panne → écarté définitivement (intention|), comme d\'habitude', () => {
  const { c, calls } = ctxDiffere({ panneConfig: true, check: { action: false, important: true } });
  c.traiterMessagePourIntentions_(msgD('M2', calls), 'F1', { differes: 0 });
  assert.deepStrictEqual(calls.importants, ['M2']);
  assert.ok(calls.ajouts.some((a) => a.cle === 'intention|M2' && a.statut === 'intention-ecartee'));
  assert.ok(!calls.ajouts.some((a) => a.cle === 'analyse|M2'), 'rien à différer : aucune création attendue');
});

test('différé : revisite PENDANT la panne → zéro mini-check, zéro corps, zéro extraction (quota et coût nuls)', () => {
  const { c, calls } = ctxDiffere({ panneConfig: true, index: { 'analyse|M1': true } });
  assert.strictEqual(c.traiterMessagePourIntentions_(msgD('M1', calls), 'F1', { differes: 0 }), 0);
  assert.strictEqual(calls.miniChecks + calls.corps + calls.extractions, 0);
  assert.deepStrictEqual(calls.ajouts, []);
});

test('différé : revisite au RETOUR de l\'API → pas de mini-check, extraction + création, intention| posé', () => {
  const { c, calls } = ctxDiffere({ panneConfig: false, index: { 'analyse|M1': true } });
  assert.strictEqual(c.traiterMessagePourIntentions_(msgD('M1', calls), 'F1', { differes: 0 }), 1);
  assert.strictEqual(calls.miniChecks, 0, 'le verdict de l\'analyse est déjà à l\'Index');
  assert.strictEqual(calls.extractions, 1);
  assert.deepStrictEqual(calls.creations, ['M1']);
  assert.ok(calls.ajouts.some((a) => a.cle === 'intention|M1' && a.statut === 'intention-traitee'));
});

test('différé : au retour, la garde ZONE PROTÉGÉE est re-vérifiée sur le corps (défense en profondeur)', () => {
  const { c, calls } = ctxDiffere({ panneConfig: false, index: { 'analyse|M1': true }, zoneProtegee: () => true });
  assert.strictEqual(c.traiterMessagePourIntentions_(msgD('M1', calls), 'F1', { differes: 0 }), 0);
  assert.strictEqual(calls.extractions, 0, 'jamais d\'extraction sur un corps protégé');
  assert.ok(calls.ajouts.some((a) => a.cle === 'intention|M1' && a.statut === 'intention-zone-protegee'));
});

test('mur : PENDANT la panne, une page faite de intention| et analyse| est un MUR (1 seule page lue)', () => {
  // C'est le quota que l'ancienne suspension totale protégeait : pendant une panne longue, les
  // différés ne doivent pas faire repaginer la fenêtre entière à chaque tick.
  const { c, calls } = ctxDiffere({ panneConfig: true,
    index: { 'intention|A': true, 'analyse|B': true },
    pages: [[filD('F1', [msgD('A', {}), msgD('B', {})])], [filD('F2', [msgD('C', {})])]] });
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0], 'mur en page 0');
  assert.strictEqual(calls.miniChecks, 0);
});

test('mur : au RETOUR de l\'API avec un retard armé, analyse| redevient INÉDIT, le mur s\'OUVRE, la fenêtre est vidée et le retard LEVÉ', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'intention|A': true, 'intention|C': true, 'analyse|D': true }, pages });
  pages.push([filD('F1', [msgD('A', calls)])], [filD('F2', [msgD('C', calls), msgD('D', calls)])], []);
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0, 20, 40], 'page 0 « à jour » n\'arrête PLUS le scan : D est en page 1');
  assert.deepStrictEqual(calls.creations, ['D'], 'le différé derrière le mur est enfin créé');
  assert.ok(!('DriveAI_INTENTIONS_RETARD' in calls.props), 'fin de fenêtre atteinte → retard levé');
  assert.ok(calls.ecritures.some((e) => e[0] === 'del'));
});

test('mur : PENDANT la panne avec un retard déjà armé, l\'arrêt sur le mur ne LÈVE pas le drapeau (les différés attendent)', () => {
  const { c, calls } = ctxDiffere({ panneConfig: true, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'analyse|B': true },
    pages: [[filD('F1', [msgD('B', {})])], [filD('F2', [msgD('Z', {})])]] });
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0], 'mur : la fenêtre n\'est pas repaginée pendant la panne');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'et le retard reste armé pour le retour de l\'API');
  assert.deepStrictEqual(calls.ecritures, []);
});

test('mur : en RÉGIME (pas de retard, pas de panne), page 0 à jour = mur, et AUCUNE écriture de Property', () => {
  const { c, calls } = ctxDiffere({ panneConfig: false,
    index: { 'intention|A': true },
    pages: [[filD('F1', [msgD('A', {})])], [filD('F2', [msgD('Z', {})])]] });
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0]);
  assert.deepStrictEqual(calls.ecritures, [], 'zéro écriture en régime — le drapeau ne bouge qu\'aux bords');
});

test('drapeau : un DIFFÉRÉ dans ce run ARME le retard, même si la fenêtre a été vidée (il attend l\'API)', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: true, pages });
  pages.push([filD('F1', [msgD('N', calls)])], []);
  c.traiterIntentionsMail_(() => false);
  assert.ok(calls.ajouts.some((a) => a.cle === 'analyse|N'));
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'sans ça, au retour de l\'API le mur cacherait N ; « d » = différés à drainer');
});

test('drapeau : un scan COUPÉ avant la fin (plafond/run) ARME le retard — les pages suivantes ne remontent jamais en page 0', () => {
  // Trou PRÉEXISTANT rendu visible par l\'ADR-0049 : après une coupe, le tick suivant repartait de
  // la page 0 (désormais à jour) et s\'arrêtait au mur — les messages des pages 1+ étaient orphelins.
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, pages });
  pages.push([filD('F1', [msgD('P', calls), msgD('Q', calls), msgD('R', calls)])], [filD('F2', [msgD('S', calls)])], []);
  c.CONFIG.INTENTIONS_MAX_PAR_RUN = 2;
  c.traiterIntentionsMail_(() => false);
  assert.ok(calls.infos.some((m) => /plafond/.test(m)), 'coupé par le plafond/run');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'c:0', 'armé en COUPE à la page 0 : pages non analysées, à drainer panne ou pas');
});

test('plafond/run : les DÉJÀ-VUS ne comptent pas — sinon un scan sans mur se figeait au même point à chaque tick', () => {
  const dejaVus = {};
  const msgs = [];
  for (let i = 0; i < 5; i++) { dejaVus['intention|V' + i] = true; msgs.push(msgD('V' + i, {})); }
  msgs.push(msgD('X1', {}), msgD('X2', {}));
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: dejaVus, pages: [[filD('F1', msgs)], []] });
  c.CONFIG.INTENTIONS_MAX_PAR_RUN = 2; // strictement < 5 déjà-vus + 2 inédits
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(calls.miniChecks, 2, 'les DEUX inédits sont analysés malgré 5 déjà-vus devant eux');
});

test('drapeau : un différé posé par le scan ARRIÈRE arme aussi le retard (son curseur ne repasse jamais dessus)', () => {
  const { c, calls } = ctxDiffere({ panneConfig: true, pages: [[]] }); // scan avant : fenêtre vide
  // Scan arrière RÉEL (pas mocké ici) : une page, puis plus rien.
  const fils = [filD('FA', [Object.assign(msgD('H1', calls), { getDate: () => new Date(2026, 8, 1) })])];
  let appels = 0;
  c.GmailApp = { search: () => (appels++ === 0 ? fils : []) };
  c.Utilities = { formatDate: () => '2026/09/01' };
  c.Session = { getScriptTimeZone: () => 'UTC' };
  delete c.balayerArriereHistorique_; // remet la vraie fonction du module
  c.traiterIntentionsMail_(() => false);
  assert.ok(calls.ajouts.some((a) => a.cle === 'analyse|H1'), 'différé par le scan arrière');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'sans ça, H1 resterait orphelin derrière le mur');
});

test('drainage REPRENABLE : offset persisté 60 → le neuf (page 0), puis SAUT à la page 40, puis jusqu\'à la fin, puis LEVÉ', () => {
  // Le 🔴 de la revue quotas : avec 300-450 fils, aucun tick n'est certain de lire toute la fenêtre.
  // Un drapeau booléen repartait de zéro à chaque tick — quota Gmail brûlé, tri affamé, zéro progrès.
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'c:60' },
    index: { 'intention|A': true, 'intention|B': true, 'intention|C': true, 'intention|D': true, 'analyse|E': true }, pages });
  pages.push(
    [filD('F0', [msgD('NEUF', calls), msgD('A', calls)])], // page 0 : du neuf
    [filD('F1', [msgD('B', calls)])],                      // page 20 : entièrement vue ⇒ saut (20+20 < 40 ? non : 40 < 40 faux) …
    [filD('F2', [msgD('C', calls)])],                      // page 40 = point de reprise (60 − 20)
    [filD('F3', [msgD('D', calls)])],                      // page 60
    [filD('F4', [msgD('E', calls)])],                      // page 80 : le différé
    []);
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0, 20, 40, 60, 80, 100], 'page 1 vue n\'arrête pas : drainage jusqu\'à la fin');
  assert.ok(calls.creations.includes('E'), 'le différé derrière le mur est créé (NEUF, actionnable, l\'est aussi)');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'fin de fenêtre sous « c » ⇒ « d » : les pages sautées (20→40) peuvent cacher des différés');
  // 2e tick, API toujours là : le drainage « d » relit tout depuis 0 et, sans différé ni reprise, LÈVE.
  const t2 = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'intention|A': true, 'intention|B': true, 'intention|C': true, 'intention|D': true, 'intention|E': true, 'intention|NEUF': true },
    pages: [[filD('F0', [msgD('A', {})])], [filD('F1', [msgD('B', {})])], []] });
  t2.c.traiterIntentionsMail_(() => false);
  assert.ok(!('DriveAI_INTENTIONS_RETARD' in t2.calls.props), 'levé au 2e tick');
});

test('drainage REPRENABLE : page 1 vue AVANT le point de reprise ⇒ on SAUTE (les pages déjà drainées ne sont pas relues)', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'c:200' },
    index: { 'intention|A': true, 'intention|B': true }, pages });
  pages.push([filD('F0', [msgD('A', calls)])], [filD('F1', [msgD('B', calls)])]);
  for (let p = 2; p < 9; p++) pages.push([filD('F' + p, [msgD('V' + p, calls)])]); // pages 40..160 : déjà drainées
  pages.push([filD('F9', [msgD('Z', calls)])], []);                                // 180 = reprise (200 − 20)
  for (let p = 2; p < 9; p++) calls.index['intention|V' + p] = true;
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0, 180, 200], 'saut de la page 0 (vue) au point de reprise 180');
});

test('drainage REPRENABLE : coupé par le plafond à la page 60 ⇒ l\'offset persisté AVANCE à 60 (jamais ne recule)', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'c:20' },
    index: { 'intention|A': true }, pages });
  pages.push([filD('F0', [msgD('A', calls)])]); // page 0 vue ; reprise = 0
  pages.push([filD('F1', [msgD('X1', calls)])], [filD('F2', [msgD('X2', calls)])], [filD('F3', [msgD('X3', calls), msgD('X4', calls)])], []);
  c.CONFIG.INTENTIONS_MAX_PAR_RUN = 3; // X1, X2, X3 puis coupe sur X4 (page 60)
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'c:60', 'progrès persisté : le tick suivant reprend à 40');
  // Et un tick où la coupe tombe AVANT l'offset connu ne fait pas reculer.
  const r2 = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'c:100' }, pages: [[filD('G0', [msgD('Y', {})])]] });
  r2.c.CONFIG.INTENTIONS_MAX_PAR_RUN = 0; // coupe immédiate en page 0
  r2.c.traiterIntentionsMail_(() => false);
  assert.strictEqual(r2.calls.props.DriveAI_INTENTIONS_RETARD, 'c:100', 'max(100, 0) : jamais en arrière');
});

test('drapeau : une création qui RELÈVE (panne détectée en cours de run) arme quand même le retard, puis re-lève', () => {
  // Le 🟠 de la revue quotas : sans `finally`, ce chemin sautait le bloc drapeau — le message qui a
  // révélé la panne et ses suivants de page restaient derrière le mur au tick suivant.
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, pages });
  pages.push([filD('F0', [msgD('K1', calls)])]);
  c.creerIntentionIdempotente_ = () => { throw new Error('config-api Tasks : boum'); };
  assert.throws(() => c.traiterIntentionsMail_(() => false), /boum/, 'l\'exception est bien RE-LEVÉE (patron ADR-0022)');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'c:0', 'et le retard est armé malgré l\'exception (coupe : pages non analysées)');
});

test('drapeau : différé PENDANT un drainage (l\'API rebascule en panne) ⇒ offset remis à 0 (prudent)', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: true, props: { DriveAI_INTENTIONS_RETARD: 'c:80' }, pages });
  pages.push([filD('F0', [msgD('N', calls)])], []);
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'fin de fenêtre sous panne : les pages sautées peuvent cacher des différés ⇒ « d »');
});

test('armerOuLeverRetardIntentions_ (PURE) : table de transition, une écriture au plus, seulement si la valeur change', () => {
  const c = load(['Config.gs', 'Intentions.gs']);
  const ecritures = [];
  const props = { setProperty: (k, v) => ecritures.push(v), deleteProperty: () => ecritures.push('del') };
  const b = { retard: 'c', retardOffset: 40, differes: 0, reprises: 0, coupe: false, coupeA: -1, fenetreAJour: false, panne: false };
  // Rien à écrire :
  c.armerOuLeverRetardIntentions_(props, b);                                        // arrêt sur le mur
  c.armerOuLeverRetardIntentions_(props, { ...b, coupe: true, coupeA: 20 });        // max(40,20)=40, inchangé
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: '', });                     // régime, mur
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: 'd', differes: 1 });        // déjà « d »
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: 'd', fenetreAJour: true, panne: true }); // reste « d »
  assert.deepStrictEqual(ecritures, []);
  c.armerOuLeverRetardIntentions_(props, { ...b, coupe: true, coupeA: 60 });                        // c:60
  c.armerOuLeverRetardIntentions_(props, { ...b, fenetreAJour: true });                             // c → d
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: 'd', fenetreAJour: true });                // levé
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: 'd', fenetreAJour: true, reprises: 1 });   // reste d : rien
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: '', fenetreAJour: true, differes: 1 });    // d
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: '', coupe: true, coupeA: 0 });             // c:0
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: 'd', coupe: true, coupeA: 80 });           // d + coupe ⇒ c:80
  c.armerOuLeverRetardIntentions_(props, { ...b, retard: '', reprises: 1 });                        // d
  assert.deepStrictEqual(ecritures, ['c:60', 'd', 'del', 'd', 'c:0', 'c:80', 'd']);
});

test('lireRetardIntentions_ (PURE) : « d », « c:<n> », absent, valeur inconnue (ancien format) ⇒ le plus prudent', () => {
  const c = load(['Config.gs', 'Intentions.gs']);
  const lire = (v) => JSON.parse(JSON.stringify(c.lireRetardIntentions_(v))); // objets d'un autre contexte vm
  assert.deepStrictEqual(lire(null), { retard: '', offset: 0 });
  assert.deepStrictEqual(lire(''), { retard: '', offset: 0 });
  assert.deepStrictEqual(lire('d'), { retard: 'd', offset: 0 });
  assert.deepStrictEqual(lire('c:120'), { retard: 'c', offset: 120 });
  assert.deepStrictEqual(lire('c:-5'), { retard: 'c', offset: 0 });
  assert.deepStrictEqual(lire('1'), { retard: 'c', offset: 0 }, 'un format inconnu draine tout');
});

test('🔴 F1 : sous « c » PENDANT la panne, le mur est OUVERT — le backlog jamais analysé est drainé sans attendre l\'API', () => {
  // Le scénario du déploiement : six jours de mails sans aucune clé. Tick 1 analyse page 0 puis
  // coupe ; tick 2, page 0 est à clé ⇒ sans ce correctif, mur ⇒ le reste du backlog n'était analysé
  // qu'au retour de l'API — le tri de ces fils restait « attend » et l'incident persistait.
  const { c, calls } = ctxDiffere({ panneConfig: true, props: { DriveAI_INTENTIONS_RETARD: 'c:0' },
    index: { 'intention|A': true },
    pages: [[filD('F0', [msgD('A', {})])], [filD('F1', [msgD('Z', {})])], []] });
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0, 20, 40], 'page 0 à clé n\'arrête pas sous « c »');
  assert.ok(calls.ajouts.some((a) => a.cle === 'analyse|Z'), 'Z est analysé (et différé) PENDANT la panne');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'fin de fenêtre sous panne : redescend à « d »');
});

test('levée INTERDITE sous panne : fenêtre vidée sans nouveau différé, mais un analyse| antérieur attend ⇒ le drapeau reste', () => {
  // code-reviewer 🟠1 : sous panne un différé antérieur compte « vu » (pas de `differes`), donc
  // « fenêtre vidée ∧ 0 différé » ne prouve rien. Le lever cachait D derrière le mur au retour.
  const { c, calls } = ctxDiffere({ panneConfig: true, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'analyse|D': true }, check: { action: false, important: false },
    pages: [[filD('F0', [msgD('N1', {})])], []] }); // N1 inédit non actionnable ⇒ page 0 pas à jour ⇒ page 20 vide
  c.traiterIntentionsMail_(() => false);
  assert.deepStrictEqual(calls.pages, [0, 20], 'fenêtre vidée');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'JAMAIS levé sous panne');
  assert.deepStrictEqual(calls.ecritures, [], 'et rien de réécrit (déjà « d »)');
});

test('🔴 F2 : au drainage, un différé dont l\'EXTRACTION échoue reste en attente ⇒ le drapeau ne se lève pas', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'analyse|M': true, 'intention|A': true }, pages });
  pages.push([filD('F0', [msgD('A', {})])], [filD('F1', [msgD('M', calls)])], []);
  c.extraireIntentions_ = () => null; // refus LLM / JSON invalide / 5xx hors panne de compte
  c.incrementerEchec_ = () => 1;
  c.traiterIntentionsMail_(() => false);
  assert.ok(!calls.ajouts.some((a) => a.cle === 'intention|M'), 'pas de clé terminale : M attend encore');
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd', 'reste armé — sinon M, profond dans la fenêtre, était orphelin À VIE');
});

test('🔴 F2 : un échec LLM DÉTERMINISTE est BORNÉ — après QUARANTAINE_MAX essais le message est abandonné (tracé), le drapeau se lève', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'analyse|M': true }, pages });
  pages.push([filD('F0', [msgD('M', calls)])], []);
  const journaux = [];
  c.journalErreur_ = (s, m) => journaux.push(m);
  c.extraireIntentions_ = () => null;
  c.incrementerEchec_ = () => c.CONFIG.QUARANTAINE_MAX;
  c.traiterIntentionsMail_(() => false);
  assert.ok(calls.ajouts.some((a) => a.cle === 'intention|M' && a.statut === 'intention-abandonnee'), 'abandon TRACÉ par une clé terminale');
  assert.ok(journaux.some((m) => /ABANDONNÉE/.test(m)));
  assert.ok(!('DriveAI_INTENTIONS_RETARD' in calls.props), 'plus rien en attente ⇒ levé (sinon repagination 30 jours)');
});

test('F2 : une création PARTIELLE au drainage compte comme reprise (le drapeau reste)', () => {
  const pages = [];
  const { c, calls } = ctxDiffere({ panneConfig: false, props: { DriveAI_INTENTIONS_RETARD: 'd' },
    index: { 'analyse|M': true }, pages });
  pages.push([filD('F0', [msgD('M', calls)])], []);
  c.creerIntentionIdempotente_ = () => 'echec';
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(calls.props.DriveAI_INTENTIONS_RETARD, 'd');
});

test('drapeau : Properties ILLISIBLES → « c:0 » par défaut (complétude : tout drainer), aucune exception, aucune écriture', () => {
  const { c, calls } = ctxDiffere({ panneConfig: false, propsHS: true,
    index: { 'intention|A': true }, pages: [[filD('F1', [msgD('A', {})])], []] });
  assert.doesNotThrow(() => c.traiterIntentionsMail_(() => false));
  assert.deepStrictEqual(calls.pages, [0, 20], 'mur désactivé ce tick (défaut prudent) : la fenêtre est repaginée');
  assert.deepStrictEqual(calls.ecritures, []);
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
  c.estPanneConfigApi_ = () => false; // ADR-0049 : création possible par défaut
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

test('sonde INDÉTERMINÉE (hubperso) : le texte DURABLE de C28-77 survit à la troncature 160 de Santé, consigne comprise', () => {
  const h = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) }, { code: 404, corps: '' });
  h.c.jetonHubperso_ = () => null;
  h.c.etatLiaisonHubperso_ = () => 'present';
  const jh = load(['Config.gs', 'JetonHubperso.gs']);
  const durable = jh.texteEchecJetonHubperso_({ depuisMs: 0, raison: 'invalid_client' }, 6 * 24 * 3600 * 1000 + 1, jh.CONFIG.HUBPERSO_ECHEC_DURABLE_MS);
  h.c.messageJetonHubpersoIndisponible_ = () => durable;
  h.c.chargerPanneConfigApi_();
  const etat = String(h.store.DriveAI_PANNE_CONFIG_SONDE_ETAT || '');
  assert.ok(etat.includes('EN ÉCHEC depuis 6 j') && etat.includes('invalid_client'), etat);
  assert.ok(etat.includes('lierCompteHubperso'), 'la CONSIGNE n\'est pas coupée : ' + etat);
});

test('sonde DÉSACTIVÉE : pas de doublon du message (son canal dédié reste DriveAI_PANNE_CONFIG_MSG)', () => {
  const h = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 3600 * 1000) },
    { Tasks: { code: 403, corps: corps403('Tasks', '777') }, Calendar: { code: 404, corps: '' } });
  h.c.chargerPanneConfigApi_();
  const etat = String(h.store.DriveAI_PANNE_CONFIG_SONDE_ETAT || '');
  assert.strictEqual(etat, 'desactivee (Tasks)', 'état court ; le détail vit dans _MSG');
  assert.ok(String(h.store.DriveAI_PANNE_CONFIG_MSG).includes('project 777'));
});
