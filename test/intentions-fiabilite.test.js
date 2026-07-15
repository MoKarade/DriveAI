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

function ctxPanne(props) {
  const c = load(['Config.gs', 'GoogleApi.gs']);
  const store = Object.assign({}, props);
  const journaux = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.journalErreur_ = (s, m) => journaux.push(m);
  return { c, store, journaux };
}

test('chargerPanneConfigApi_ : Property FRAÎCHE → run suspendu ; fenêtre écoulée → run de re-sonde', () => {
  const frais = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 1000) });
  frais.c.chargerPanneConfigApi_();
  assert.strictEqual(frais.c.estPanneConfigApi_(), true);

  const vieux = ctxPanne({ DriveAI_PANNE_CONFIG_API: String(Date.now() - 25 * 3600 * 1000) }); // > 24 h
  vieux.c.chargerPanneConfigApi_();
  assert.strictEqual(vieux.c.estPanneConfigApi_(), false, 're-sonde après la fenêtre');
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
  assert.strictEqual(Object.values(echecs)[0], MAX, 'compté par intention (clé dédiée)');
  assert.strictEqual(journaux.filter((m) => m.includes('ABANDONNÉE')).length, 1);
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
  c.balayerAnalyseCiblee_ = () => { scanne = true; };
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
