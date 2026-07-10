'use strict';
/**
 * C28-15 — panne de QUOTA Gmail journalier (Gmail.gs) + ordre d'équité strict du tick :
 *  - `signalerPanneGmail_` reconnaît l'erreur RÉELLE de Google (« Service invoked too many times
 *    for one day: gmail. »), pose la suspension persistée UNE fois, et retourne true — l'appelant
 *    sort sans compter d'échec (panne de plateforme, jamais imputée à un fil).
 *  - `chargerPanneGmail_` : suspension fraîche (< GMAIL_QUOTA_RESONDE_MS) → tout le run est
 *    suspendu ; suspension périmée → re-sonde permise. Cas dérivés de la CONSTANTE (seuil−δ /
 *    seuil+δ), jamais de sa valeur du jour.
 *  - `signalerRetablissementGmail_` : un appel réussi APRÈS re-sonde efface la Property et le
 *    journalise (1 lecture de Property max par run) ; un run suspendu ne l'efface JAMAIS.
 *  - Les points d'entrée (tri, intentions, scans PJ, historique) sortent immédiatement sous
 *    suspension — plus un seul appel Gmail gaspillé (vécu : 267 lignes d'erreur le matin du 10/07).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ERREUR_QUOTA = 'Exception: Service invoked too many times for one day: gmail.';

function ctxQuota(options) {
  options = options || {};
  const props = Object.assign({}, options.props);
  const journal = [];
  const c = load(['Config.gs', 'Gmail.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
  });
  c.journalErreur_ = (s, m) => journal.push({ niveau: 'ERREUR', m });
  c.journalInfo_ = (s, m) => journal.push({ niveau: 'INFO', m });
  return { c, props, journal };
}

test('signalerPanneGmail_ : erreur de quota RÉELLE → suspension posée UNE fois, true ; autre erreur → false, rien', () => {
  const { c, props, journal } = ctxQuota();
  c.chargerPanneGmail_();
  assert.strictEqual(c.signalerPanneGmail_(new Error('Access denied: DriveApp')), false);
  assert.ok(!('DriveAI_GMAIL_QUOTA' in props), 'une erreur non-quota ne suspend jamais');

  assert.strictEqual(c.signalerPanneGmail_(new Error(ERREUR_QUOTA)), true);
  assert.strictEqual(c.estPanneGmail_(), true);
  assert.ok('DriveAI_GMAIL_QUOTA' in props, 'suspension persistée posée');
  assert.strictEqual(journal.filter((l) => l.m.indexOf('QUOTA GMAIL ÉPUISÉ') !== -1).length, 1);

  // Deuxième signal du même run : silencieux (jamais 267 lignes de journal — vécu 10/07).
  assert.strictEqual(c.signalerPanneGmail_(ERREUR_QUOTA), true); // accepte aussi une chaîne
  assert.strictEqual(journal.filter((l) => l.niveau === 'ERREUR').length, 1);
});

test('chargerPanneGmail_ : suspension fraîche → run suspendu ; périmée → re-sonde permise ; absente → normal', () => {
  const seuil = null; // les cas se dérivent de la CONSTANTE lue dans le contexte chargé
  const frais = ctxQuota({ props: {} });
  const RESONDE = frais.c.CONFIG.GMAIL_QUOTA_RESONDE_MS;

  frais.props['DriveAI_GMAIL_QUOTA'] = String(Date.now() - (RESONDE - 60 * 1000)); // seuil − 1 min
  frais.c.chargerPanneGmail_();
  assert.strictEqual(frais.c.estPanneGmail_(), true, 'suspension fraîche → suspendu');

  const perime = ctxQuota({ props: { DriveAI_GMAIL_QUOTA: String(Date.now() - (RESONDE + 60 * 1000)) } });
  perime.c.chargerPanneGmail_();
  assert.strictEqual(perime.c.estPanneGmail_(), false, 'suspension périmée → re-sonde permise');

  const vierge = ctxQuota();
  vierge.c.chargerPanneGmail_();
  assert.strictEqual(vierge.c.estPanneGmail_(), false);
});

test('signalerRetablissementGmail_ : re-sonde concluante → Property effacée + journal ; run suspendu → JAMAIS', () => {
  // Re-sonde : la Property existe encore (périmée), le run n'est PAS suspendu, un appel réussit.
  const ok = ctxQuota({ props: { DriveAI_GMAIL_QUOTA: '1' } });
  ok.c.chargerPanneGmail_(); // périmée → pas suspendu
  ok.c.signalerRetablissementGmail_();
  assert.ok(!('DriveAI_GMAIL_QUOTA' in ok.props), 'suspension levée après un succès');
  assert.strictEqual(ok.journal.filter((l) => l.m.indexOf('RÉTABLI') !== -1).length, 1);
  ok.c.signalerRetablissementGmail_(); // mémoïsé : pas de 2ᵉ lecture/journal
  assert.strictEqual(ok.journal.length, 1);

  // Run SUSPENDU : le rétablissement ne doit jamais lever la suspension (aucun appel n'a réussi).
  const susp = ctxQuota();
  susp.c.chargerPanneGmail_();
  susp.c.signalerPanneGmail_(ERREUR_QUOTA);
  susp.c.signalerRetablissementGmail_();
  assert.ok('DriveAI_GMAIL_QUOTA' in susp.props, 'un run suspendu ne se rétablit pas lui-même');
});

test('points d\'entrée sous suspension : tri, scans PJ et historique sortent SANS le moindre appel Gmail', () => {
  const appels = { gmail: 0 };
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs', 'TriGmail.gs'], {
    GmailApp: { search: () => { appels.gmail++; throw new Error('ne doit pas être appelé'); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_GMAIL_QUOTA' ? String(Date.now()) : null),
        setProperty: () => {},
        deleteProperty: () => {},
      }),
    },
  });
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  c.libellesUtilisateur_ = () => { appels.gmail++; return {}; }; // lecture Gmail aussi
  c.chargerPanneGmail_(); // suspension fraîche chargée comme au début d'un tick

  c.traiterGmail_(() => false);
  c.traiterGmailHistorique_(() => false);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(appels.gmail, 0, 'zéro appel Gmail pendant la suspension');
});

test('traiterPageHistorique_ : le frein GMAIL_HISTO_MAX_FILS_PAR_RUN borne les fils PARCOURUS d\'un run', () => {
  const { c } = ctxQuota();
  // Contexte dédié : page de fils factices plus grande que le frein (cas dérivé de la CONSTANTE).
  const ctx = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  const FREIN = ctx.CONFIG.GMAIL_HISTO_MAX_FILS_PAR_RUN;
  let filsLus = 0;
  const faireFil = (i) => ({
    getId: () => { filsLus++; return 'F' + i; },
    getMessages: () => [],
  });
  const page = [];
  for (let i = 0; i < FREIN + 5; i++) page.push(faireFil(i));
  const props = { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/10', DriveAI_GMAIL_HISTO_OFFSET: '0' };
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };
  ctx.pageFilsHisto_ = () => page;
  ctx.estPannePlateforme_ = () => false;
  ctx.chargerPanneGmail_();
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = () => true; // tout déjà indexé : la « passe de vérification » type
  ctx.piecesJointes_ = () => [];
  ctx.traiterPjGmail_ = () => {};
  ctx.incrementerEchec_ = () => 0;

  ctx.traiterPageHistorique_(ctx.PropertiesService.getScriptProperties(), () => false);
  assert.ok(filsLus <= FREIN, 'fils lus (' + filsLus + ') ≤ frein (' + FREIN + ')');
  // Page interrompue par le frein → l'offset n'avance PAS (la page rejouera, idempotente).
  assert.strictEqual(props['DriveAI_GMAIL_HISTO_OFFSET'], '0');
});