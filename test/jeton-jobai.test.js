'use strict';
/**
 * C28-52 (ADR-0041) — jeton OAuth du projet jobai pour Tasks & Calendar (JetonJobai.gs).
 *
 * Ce que ces tests verrouillent :
 *  - le CACHE du jeton (marge d'expiration DÉRIVÉE de la constante, jamais de sa valeur du jour) ;
 *  - l'analyse de la réponse du endpoint de jeton : `invalid_grant` est la SEULE signature qui
 *    détruit le refresh token (asymétrie des verdicts — la direction chère exige la preuve) ;
 *  - le callback de consentement : `state` vérifié AVANT tout appel réseau (l'URL /exec est
 *    publique — sans ça, un tiers pourrait lier SON compte et recevoir les intentions de Marc) ;
 *  - l'échec FERMÉ de `jetonJobai_` (pas de config → null, zéro réseau ; révocation → purge +
 *    consigne UNE fois ; transitoire → null sans rien détruire).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** Contexte avec Properties/UrlFetch/Journal mockés. `reponses` : file de réponses HTTP. */
function ctxJobai(props, reponses) {
  const c = load(['Config.gs', 'JetonJobai.gs']);
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
  c.UrlFetchApp = { fetch: (url, options) => {
    fetchs.push({ url, options });
    const r = (reponses || []).shift();
    if (r instanceof Error) throw r;
    if (!r) throw new Error('aucune réponse HTTP programmée pour ' + url);
    return { getResponseCode: () => r.code, getContentText: () => r.corps || '' };
  } };
  return { c, store, journaux, infos, fetchs };
}

/* ---------- fonctions PURES ---------- */

test('jetonCacheValide_ : la marge d\'expiration vient de la CONSTANTE (seuil−δ/seuil+δ)', () => {
  const { c } = ctxJobai({});
  const marge = c.JOBAI_MARGE_EXPIRATION_MS;
  assert.ok(marge > 0, 'constante présente');
  const exp = 1000000000;
  // Bien avant la marge : le jeton sert. Passé (exp − marge) : périmé, même s'il reste du temps.
  assert.strictEqual(c.jetonCacheValide_(exp + '|jeton-abc', exp - marge - 1), 'jeton-abc');
  assert.strictEqual(c.jetonCacheValide_(exp + '|jeton-abc', exp - marge), null);
  assert.strictEqual(c.jetonCacheValide_(exp + '|jeton-abc', exp + 1), null);
  // Formes invalides : jamais un jeton, jamais une exception.
  assert.strictEqual(c.jetonCacheValide_(null, 0), null);
  assert.strictEqual(c.jetonCacheValide_('', 0), null);
  assert.strictEqual(c.jetonCacheValide_('pas-de-separateur', 0), null);
  assert.strictEqual(c.jetonCacheValide_('|jeton-sans-expiration', 0), null);
  assert.strictEqual(c.jetonCacheValide_(exp + '|', 0), null);
  assert.strictEqual(c.jetonCacheValide_('abc|jeton', 0), null, 'expiration non numérique');
});

test('analyserReponseJetonJobai_ : seul `invalid_grant` (400/401) révoque — tout le reste est transitoire', () => {
  const { c } = ctxJobai({});
  const f = c.analyserReponseJetonJobai_;
  const ok = f(200, JSON.stringify({ access_token: 'at-1', expires_in: 3599 }), 1000);
  assert.strictEqual(ok.jeton, 'at-1');
  assert.strictEqual(ok.expireMs, 1000 + 3599 * 1000);
  // expires_in absent/illisible : durée par défaut (1 h) plutôt qu'un cache qui ne périme jamais.
  assert.strictEqual(f(200, JSON.stringify({ access_token: 'at-2' }), 0).expireMs, 3600 * 1000);

  assert.strictEqual(f(400, JSON.stringify({ error: 'invalid_grant' }), 0).revoque, true);
  assert.strictEqual(f(401, JSON.stringify({ error: 'invalid_grant' }), 0).revoque, true);
  // La direction CHÈRE (jeter le refresh token) exige la preuve : un secret mal collé
  // (`invalid_client`), un 5xx ou un corps illisible ne détruisent RIEN.
  for (const [code, corps] of [
    [400, JSON.stringify({ error: 'invalid_client' })],
    [500, 'Internal Server Error'],
    [200, 'pas du JSON'],
    [200, JSON.stringify({})],
    [400, JSON.stringify({ error_description: 'invalid_grant mentionné ailleurs' })],
  ]) {
    const r = f(code, corps, 0);
    assert.ok(!r.revoque && !r.jeton, `transitoire attendu pour HTTP ${code} : ${corps}`);
  }
});

test('urlConsentementJobai_ : offline + prompt=consent (sinon pas de refresh token), tout encodé', () => {
  const { c } = ctxJobai({});
  const url = c.urlConsentementJobai_('id-1', 'https://script.google.com/macros/s/X/exec', 'state-α');
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(url.includes('access_type=offline'), 'offline : la condition du refresh token');
  assert.ok(url.includes('prompt=consent'), 'consent : un RE-consentement rend aussi le refresh token');
  assert.ok(url.includes('redirect_uri=' + encodeURIComponent('https://script.google.com/macros/s/X/exec')));
  assert.ok(url.includes('state=' + encodeURIComponent('state-α')), 'state encodé');
  assert.ok(url.includes(encodeURIComponent('auth/tasks')) && url.includes(encodeURIComponent('auth/calendar.events')),
    'exactement les deux scopes concernés');
});

test('validerCallbackJobai_ : state vérifié, refus fermé sur toute forme inattendue', () => {
  const { c } = ctxJobai({});
  const f = c.validerCallbackJobai_;
  const attendu = 's-1|1000'; // Property « uuid|poseMs »
  const t = 2000; // bien avant la péremption
  assert.strictEqual(f({ jobai: '1', code: 'c-1', state: 's-1' }, attendu, t), 'c-1');
  assert.strictEqual(f({ jobai: '1', code: 'c-1', state: 'AUTRE' }, attendu, t), '', 'state faux → refus');
  assert.strictEqual(f({ jobai: '1', code: 'c-1' }, attendu, t), '', 'state absent → refus');
  assert.strictEqual(f({ jobai: '1', state: 's-1' }, attendu, t), '', 'code absent → refus');
  assert.strictEqual(f({ code: 'c-1', state: 's-1' }, attendu, t), '', 'pas l\'action jobai → refus');
  assert.strictEqual(f({ jobai: '1', code: 'c-1', state: 's-1' }, null, t), '',
    'aucun state attendu (liaison jamais lancée) → refus — jamais une comparaison à null qui passe');
  assert.strictEqual(f({ jobai: '1', code: 'c-1', state: 's-1' }, 's-1', t), '',
    'Property sans horodatage (format inattendu) → refus fermé');
  assert.strictEqual(f(null, attendu, t), '');
});

test('validerCallbackJobai_ : le state PÉRIME — bornes dérivées de la CONSTANTE (revue sécurité A)', () => {
  // Un `lierCompteJobai` abandonné laisse son URL (avec le state) dans le journal d'exécution et
  // l'historique navigateur : sans péremption, ce state resterait valable À VIE.
  const { c } = ctxJobai({});
  const maxAge = c.JOBAI_STATE_MAX_AGE_MS;
  assert.ok(maxAge > 0, 'constante présente');
  const pose = 100000;
  const params = { jobai: '1', code: 'c-1', state: 's-1' };
  assert.strictEqual(c.validerCallbackJobai_(params, 's-1|' + pose, pose + maxAge), 'c-1',
    'au seuil pile : encore valable');
  assert.strictEqual(c.validerCallbackJobai_(params, 's-1|' + pose, pose + maxAge + 1), '',
    'au-delà : refus (même avec le BON state)');
});

test('scopesJobaiComplets_ (PURE) : les DEUX scopes exigés — consentement granulaire refusé sinon', () => {
  const { c } = ctxJobai({});
  const f = c.scopesJobaiComplets_;
  const tasks = 'https://www.googleapis.com/auth/tasks';
  const cal = 'https://www.googleapis.com/auth/calendar.events';
  assert.strictEqual(f(tasks + ' ' + cal), true);
  assert.strictEqual(f(cal + ' ' + tasks + ' openid'), true, 'l\'ordre et des scopes en plus ne gênent pas');
  assert.strictEqual(f(tasks), false, 'Tasks seul (case Agenda décochée) → incomplet');
  assert.strictEqual(f(cal), false);
  assert.strictEqual(f(''), false);
  assert.strictEqual(f(undefined), false);
  assert.strictEqual(f(tasks + 'x ' + cal), false, 'préfixe ≠ égalité (jamais un match par sous-chaîne)');
});

test('comparaisonConstante_ : égalité stricte, sans jamais lever', () => {
  const { c } = ctxJobai({});
  assert.strictEqual(c.comparaisonConstante_('abc', 'abc'), true);
  assert.strictEqual(c.comparaisonConstante_('abc', 'abd'), false);
  assert.strictEqual(c.comparaisonConstante_('abc', 'ab'), false);
  assert.strictEqual(c.comparaisonConstante_('', ''), true);
});

/* ---------- jetonJobai_ (I/O mockées) ---------- */

test('jetonJobai_ : cache Property valide → aucun appel réseau', () => {
  const futur = Date.now() + 30 * 60 * 1000;
  const { c, fetchs } = ctxJobai({ DriveAI_JOBAI_ACCES: futur + '|jeton-cache' });
  assert.strictEqual(c.jetonJobai_(), 'jeton-cache');
  assert.strictEqual(fetchs.length, 0);
});

test('jetonJobai_ : pas de configuration (jamais lié) → null, zéro réseau, zéro journal', () => {
  const { c, fetchs, journaux } = ctxJobai({});
  assert.strictEqual(c.jetonJobai_(), null);
  assert.strictEqual(fetchs.length, 0);
  assert.strictEqual(journaux.length, 0, 'le « jamais lié » ne journalise pas à chaque appel (bruit)');
});

test('jetonJobai_ : refresh OK → jeton rendu ET mis en cache (« expiration|jeton »)', () => {
  const { c, store, fetchs } = ctxJobai({
    DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1', DriveAI_JOBAI_REFRESH: 'rt-1',
  }, [{ code: 200, corps: JSON.stringify({ access_token: 'at-neuf', expires_in: 3599 }) }]);
  assert.strictEqual(c.jetonJobai_(), 'at-neuf');
  assert.strictEqual(fetchs.length, 1);
  assert.strictEqual(fetchs[0].url, 'https://oauth2.googleapis.com/token');
  assert.strictEqual(fetchs[0].options.payload.grant_type, 'refresh_token');
  assert.ok(String(store.DriveAI_JOBAI_ACCES).endsWith('|at-neuf'), 'cache posé');
  // Deuxième appel : servi par le cache, pas de 2ᵉ refresh.
  assert.strictEqual(c.jetonJobai_(), 'at-neuf');
  assert.strictEqual(fetchs.length, 1);
});

test('jetonJobai_ : invalid_grant → PURGE du refresh token + consigne journalisée UNE fois', () => {
  const { c, store, fetchs, journaux } = ctxJobai({
    DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1', DriveAI_JOBAI_REFRESH: 'rt-revoque',
    DriveAI_JOBAI_ACCES: '1|perime',
  }, [{ code: 400, corps: JSON.stringify({ error: 'invalid_grant' }) }]);
  assert.strictEqual(c.jetonJobai_(), null);
  assert.ok(!('DriveAI_JOBAI_REFRESH' in store), 'refresh token purgé — plus de re-frappe du endpoint');
  assert.ok(!('DriveAI_JOBAI_ACCES' in store), 'cache purgé aussi');
  assert.strictEqual(journaux.filter((m) => m.includes('lierCompteJobai')).length, 1, 'consigne actionnable');
  // Appel suivant : sort en « jamais lié » — aucun réseau, aucune 2ᵉ ligne de Journal.
  assert.strictEqual(c.jetonJobai_(), null);
  assert.strictEqual(fetchs.length, 1);
  assert.strictEqual(journaux.length, 1);
});

test('jetonJobai_ : échec TRANSITOIRE (5xx, réseau) → null sans RIEN détruire (re-essai à l\'appel suivant)', () => {
  const base = {
    DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1', DriveAI_JOBAI_REFRESH: 'rt-1',
  };
  const cinqCents = ctxJobai(base, [{ code: 500, corps: 'oops' }]);
  assert.strictEqual(cinqCents.c.jetonJobai_(), null);
  assert.strictEqual(cinqCents.store.DriveAI_JOBAI_REFRESH, 'rt-1', 'le refresh token SURVIT au blip');

  const reseau = ctxJobai(base, [new Error('DNS')]);
  assert.strictEqual(reseau.c.jetonJobai_(), null);
  assert.strictEqual(reseau.store.DriveAI_JOBAI_REFRESH, 'rt-1');
});

/* ---------- echangerCodeJobai_ (callback de consentement) ---------- */

const SCOPES_COMPLETS = 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events';
const PROPS_LIAISON = {
  DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1',
  DriveAI_JOBAI_STATE: 'state-attendu|' + Date.now(),
  DriveAI_JOBAI_REDIRECT: 'https://script.google.com/macros/s/X/exec',
};

test('echangerCodeJobai_ : state valide → refresh token persisté, state consommé (usage unique)', () => {
  const { c, store, fetchs, infos } = ctxJobai(PROPS_LIAISON,
    [{ code: 200, corps: JSON.stringify({ refresh_token: 'rt-neuf', access_token: 'at-1', expires_in: 3599, scope: SCOPES_COMPLETS }) }]);
  assert.strictEqual(c.echangerCodeJobai_({ jobai: '1', code: 'code-1', state: 'state-attendu' }), true);
  assert.strictEqual(store.DriveAI_JOBAI_REFRESH, 'rt-neuf');
  assert.ok(String(store.DriveAI_JOBAI_ACCES).endsWith('|at-1'), 'access token encaissé au passage');
  assert.ok(!('DriveAI_JOBAI_STATE' in store), 'state à usage UNIQUE — un rejeu du callback est refusé');
  assert.strictEqual(fetchs[0].options.payload.grant_type, 'authorization_code');
  assert.strictEqual(fetchs[0].options.payload.redirect_uri, PROPS_LIAISON.DriveAI_JOBAI_REDIRECT,
    'l\'URI de l\'échange est CELLE du consentement (persistée) — à l\'octet près');
  assert.strictEqual(infos.length, 1, 'liaison annoncée au Journal');
});

test('echangerCodeJobai_ : state faux/absent → refus AVANT tout appel réseau, rien d\'écrit', () => {
  for (const params of [
    { jobai: '1', code: 'code-1', state: 'FORGÉ' },
    { jobai: '1', code: 'code-1' },
    { jobai: '1', state: 'state-attendu' },
  ]) {
    const { c, store, fetchs } = ctxJobai(PROPS_LIAISON, []);
    assert.strictEqual(c.echangerCodeJobai_(params), false);
    assert.strictEqual(fetchs.length, 0, 'une requête forgée ne coûte JAMAIS un appel réseau');
    assert.ok(!('DriveAI_JOBAI_REFRESH' in store));
    assert.strictEqual(store.DriveAI_JOBAI_STATE, PROPS_LIAISON.DriveAI_JOBAI_STATE, 'un refus ne consomme pas le state');
  }
});

test('echangerCodeJobai_ : réponse sans refresh_token → échec journalisé, rien de persisté', () => {
  // Cas réel : `prompt=consent` manquant sur un RE-consentement — Google rend un access token
  // SANS refresh token. Accepter l'access token seul « marcherait » ~1 h puis mourrait en silence.
  const { c, store, journaux } = ctxJobai(PROPS_LIAISON,
    [{ code: 200, corps: JSON.stringify({ access_token: 'at-seul', expires_in: 3599, scope: SCOPES_COMPLETS }) }]);
  assert.strictEqual(c.echangerCodeJobai_({ jobai: '1', code: 'code-1', state: 'state-attendu' }), false);
  assert.ok(!('DriveAI_JOBAI_REFRESH' in store));
  assert.ok(!('DriveAI_JOBAI_ACCES' in store), 'jamais un demi-état (access sans refresh)');
  assert.strictEqual(journaux.length, 1);
});

test('echangerCodeJobai_ : autorisations INCOMPLÈTES au consentement → liaison refusée EN ENTIER (revue 🟠1)', () => {
  // Consentement granulaire : Marc décoche « Agenda » → refresh token émis pour Tasks seul. Le
  // persister « réussirait » la liaison puis ferait mourir chaque création Calendar en 403 de
  // droits — un échec que ni la panne config ni la sonde ne reclassent (3 strikes → intention
  // abandonnée sous clé de succès). Le refus TOTAL force un re-consentement propre.
  const { c, store, journaux } = ctxJobai(PROPS_LIAISON,
    [{ code: 200, corps: JSON.stringify({ refresh_token: 'rt-partiel', access_token: 'at-1',
      expires_in: 3599, scope: 'https://www.googleapis.com/auth/tasks' }) }]);
  assert.strictEqual(c.echangerCodeJobai_({ jobai: '1', code: 'code-1', state: 'state-attendu' }), false);
  assert.ok(!('DriveAI_JOBAI_REFRESH' in store), 'rien persisté — pas de demi-liaison');
  assert.ok(!('DriveAI_JOBAI_ACCES' in store));
  assert.strictEqual(journaux.filter((m) => m.includes('COCHER')).length, 1, 'consigne : re-consentir en cochant tout');
});

test('jetonJobai_ : invalid_grant d\'un VIEUX refresh ne purge JAMAIS le refresh NEUF (course re-liaison, revue F3)', () => {
  // Pendant une re-liaison, le callback écrit un refresh token NEUF pendant qu'une sonde vole
  // encore avec l'ANCIEN : la réponse invalid_grant de l'ancien ne doit pas effacer le neuf
  // (sinon « ✅ lié » à l'écran puis « non lié » dans Santé, silencieux).
  const { c, store, journaux, fetchs } = ctxJobai({
    DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1', DriveAI_JOBAI_REFRESH: 'rt-vieux',
  }, []);
  c.UrlFetchApp = { fetch: (url, options) => {
    fetchs.push({ url, options });
    store.DriveAI_JOBAI_REFRESH = 'rt-neuf'; // le callback de re-liaison écrit PENDANT le vol
    return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: 'invalid_grant' }) };
  } };
  assert.strictEqual(c.jetonJobai_(), null);
  assert.strictEqual(store.DriveAI_JOBAI_REFRESH, 'rt-neuf', 'le refresh NEUF survit');
  assert.strictEqual(journaux.length, 0, 'pas de fausse annonce « RÉVOQUÉ » quand rien n\'est purgé');
});

test('etatLiaisonJobai_ / messageJetonJobaiIndisponible_ : « re-lier » SEULEMENT si les creds manquent (revue F2)', () => {
  const complet = ctxJobai({
    DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1', DriveAI_JOBAI_REFRESH: 'rt-1',
  });
  assert.strictEqual(complet.c.etatLiaisonJobai_(), 'present');
  assert.ok(complet.c.messageJetonJobaiIndisponible_().includes('momentanément'),
    'creds présentes + pas de jeton = blip : jamais « re-lier le compte » (Marc re-consentirait pour rien)');

  const vide = ctxJobai({ DriveAI_JOBAI_CLIENT_ID: 'id-1', DriveAI_JOBAI_CLIENT_SECRET: 'secret-1' });
  assert.strictEqual(vide.c.etatLiaisonJobai_(), 'absent');
  assert.ok(vide.c.messageJetonJobaiIndisponible_().includes('lierCompteJobai'), 'consigne de liaison');

  const casse = ctxJobai({});
  casse.c.PropertiesService = { getScriptProperties: () => { throw new Error('quota'); } };
  assert.strictEqual(casse.c.etatLiaisonJobai_(), 'inconnu', 'Properties illisibles : ne rien affirmer');
});

test('purgerCacheJetonJobai_ : efface le CACHE seul (jamais le refresh token), sans lever', () => {
  const { c, store } = ctxJobai({ DriveAI_JOBAI_ACCES: '123|at-1', DriveAI_JOBAI_REFRESH: 'rt-1' });
  c.purgerCacheJetonJobai_();
  assert.ok(!('DriveAI_JOBAI_ACCES' in store));
  assert.strictEqual(store.DriveAI_JOBAI_REFRESH, 'rt-1');
  c.PropertiesService = { getScriptProperties: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => c.purgerCacheJetonJobai_(), 'best-effort — appelée depuis le chemin d\'échec des créations');
});

test('doGet : seul `?jobai=1` route vers le callback — tout le reste rend une page neutre', () => {
  const c = load(['Config.gs', 'WebApp.gs']);
  const appels = [];
  c.traiterCallbackJobai_ = (p) => { appels.push(p); return { page: 'jobai' }; };
  c.ContentService = { createTextOutput: (t) => ({ texte: t, setMimeType: () => ({ texte: t }) }) };
  assert.strictEqual(c.doGet({ parameter: { jobai: '1', code: 'c', state: 's' } }).page, 'jobai');
  assert.strictEqual(appels.length, 1);
  for (const e of [null, undefined, {}, { parameter: {} }, { parameter: { jobai: '2' } }, { parameter: { jobai: 1 } }]) {
    assert.strictEqual(c.doGet(e).texte, 'DriveAI', 'page neutre pour ' + JSON.stringify(e && e.parameter));
  }
  assert.strictEqual(appels.length, 1, 'le callback n\'est JAMAIS appelé hors ?jobai=1 strict');
});

test('traiterCallbackJobai_ : la page ne REFLÈTE jamais un paramètre reçu (pas d\'écho → pas d\'XSS)', () => {
  const { c } = ctxJobai(PROPS_LIAISON, []);
  const capture = [];
  c.HtmlService = { createHtmlOutput: (html) => { capture.push(html); return { html }; } };
  c.traiterCallbackJobai_({ jobai: '1', code: '<script>alert(1)</script>', state: 'FORGÉ' });
  assert.strictEqual(capture.length, 1);
  assert.ok(!capture[0].includes('<script>alert'), 'aucun paramètre reçu dans la page');
  assert.ok(capture[0].includes('lierCompteJobai'), 'page d\'échec : consigne de relance');
});
