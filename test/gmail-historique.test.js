'use strict';
/**
 * Chantier #12 (ADR-0010 §1) — historique Gmail complet, scan ANCRÉ rétrograde :
 *  - primitives PURES : `dateGmail_`, `requeteHisto_`, `curseurSuivantHisto_` (le curseur ne va
 *    que vers le passé, re-couvre le jour entier — la leçon « pagination mouvante » codifiée) ;
 *  - orchestration `traiterGmailHistorique_` : init du curseur, avancée, terminaison, budget.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Gmail.gs']);

test('dateGmail_ : format yyyy/MM/dd zéro-paddé', () => {
  assert.strictEqual(ctx.dateGmail_(new Date(2026, 6, 2)), '2026/07/02');
  assert.strictEqual(ctx.dateGmail_(new Date(2019, 0, 5)), '2019/01/05');
});

test('requeteHisto_ : base PJ + before: exclusif', () => {
  assert.strictEqual(ctx.requeteHisto_('2026/06/02'), 'has:attachment before:2026/06/02');
});

test('curseurSuivantHisto_ : jour de la plus ANCIENNE date + 1 (re-couvre le jour, jamais de trou)', () => {
  const dates = [new Date(2024, 4, 20, 15, 0), new Date(2024, 4, 15, 9, 30), new Date(2024, 4, 18)];
  assert.strictEqual(ctx.curseurSuivantHisto_(dates), '2024/05/16'); // 15 mai + 1
  // bascule de mois
  assert.strictEqual(ctx.curseurSuivantHisto_([new Date(2023, 11, 31, 23, 59)]), '2024/01/01');
});

/* ---------- orchestration (mocks) ---------- */

function ctxHisto(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  const calls = { props: { ...(opts.props || {}) }, pj: [], journaux: [] };
  c.journalInfo_ = (s, m) => calls.journaux.push(m);
  c.journalErreur_ = (s, m) => calls.journaux.push('ERR:' + m);
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => calls.props[k] ?? null,
      setProperty: (k, v) => { calls.props[k] = v; },
      deleteProperty: (k) => { delete calls.props[k]; },
    }),
  };
  c.pageFilsHisto_ = opts.pageFilsHisto_;
  c.piecesJointes_ = (msg) => msg.pjs || [];
  c.traiterPjGmail_ = (msg, i, pj) => calls.pj.push(pj);
  return { c, calls };
}

function fil(datesMessages, pjsParMessage) {
  return {
    getMessages: () => datesMessages.map((d, i) => ({ getDate: () => d, pjs: pjsParMessage?.[i] || ['pj'] })),
    getLastMessageDate: () => datesMessages[datesMessages.length - 1],
  };
}

test('historique : tranche vide → campagne TERMINÉE (property figée), plus jamais de scan', () => {
  const { c, calls } = ctxHisto({ props: { DriveAI_GMAIL_HISTO_AVANT: '2019/01/01' }, pageFilsHisto_: () => [] });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
  // appel suivant : no-op total (pageFilsHisto_ lèverait s'il était appelé)
  c.pageFilsHisto_ = () => { throw new Error('ne doit pas être appelé'); };
  c.traiterGmailHistorique_(() => false);
});

test('historique : 1ᵉʳ run → curseur initialisé ~30 j en arrière puis tranche traitée', () => {
  const f = fil([new Date(2026, 5, 1)]);
  const { c, calls } = ctxHisto({ pageFilsHisto_: () => [f] });
  c.traiterGmailHistorique_(() => false);
  assert.match(calls.props.DriveAI_GMAIL_HISTO_AVANT, /^\d{4}\/\d{2}\/\d{2}$/);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_AVANT, '2026/06/02'); // 1ᵉʳ juin + 1
  assert.strictEqual(calls.pj.length, 1);
});

test('historique : budget en cours de page → PJ traitées comptées, curseur = plus ancienne TRAITÉE + 1', () => {
  const f1 = fil([new Date(2026, 4, 20)]);
  const f2 = fil([new Date(2026, 4, 10)]); // jamais atteint (budget)
  let appels = 0;
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_AVANT: '2026/06/02' },
    pageFilsHisto_: () => [f1, f2],
  });
  c.traiterGmailHistorique_(() => ++appels > 1); // budget tombe après le 1ᵉʳ fil
  assert.strictEqual(calls.pj.length, 1);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_AVANT, '2026/05/21'); // f2 (10 mai) reste < curseur : aucun trou
});

test('historique : fil en erreur → SAUTÉ mais le curseur avance (convergence, erreur journalisée)', () => {
  const poison = { getMessages: () => { throw new Error('boom'); }, getLastMessageDate: () => new Date(2026, 3, 5) };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_AVANT: '2026/06/02' },
    pageFilsHisto_: () => [poison],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_AVANT, '2026/04/06');
  assert.ok(calls.journaux.some((j) => j.startsWith('ERR:')));
});
