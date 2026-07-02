'use strict';
/**
 * Chantier #12 (ADR-0010 §1) — historique Gmail : ancre FIXE + pagination par OFFSET,
 * terminaison par PASSE DE VÉRIFICATION propre.
 * Design issu de DEUX vérifications adversariales : l'APPARTENANCE à `before:<ancre>` est stable
 * → l'offset est sûr ; mais l'ORDRE peut bouger (fil ravivé sans PJ, suppression) → une page vide
 * ne termine la campagne que si la passe n'a RIEN collecté (sinon offset remis à 0 et on re-vérifie).
 * Garde-temps et plafond d'inédites vérifiés PAR PJ (message dense ≠ hard-kill 6 min) ; fil en
 * erreur sauté avec compteur d'Échecs (revisité, abandonné après QUARANTAINE_MAX essais).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctxPur = load(['Config.gs', 'Gmail.gs']);

test('dateGmail_ / requeteHisto_ : format et requête d\'ancre', () => {
  assert.strictEqual(ctxPur.dateGmail_(new Date(2026, 6, 2)), '2026/07/02');
  assert.strictEqual(ctxPur.dateGmail_(new Date(2019, 0, 5)), '2019/01/05');
  assert.strictEqual(ctxPur.requeteHisto_('2026/06/02'), 'has:attachment before:2026/06/02');
});

/* ---------- orchestration (mocks) ---------- */

function ctxHisto(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  const calls = { props: { ...(opts.props || {}) }, pj: [], journaux: [], pages: [], echecs: { ...(opts.echecs || {}) } };
  c.journalInfo_ = (s, m) => calls.journaux.push(m);
  c.journalErreur_ = (s, m) => calls.journaux.push('ERR:' + m);
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => calls.props[k] ?? null,
      setProperty: (k, v) => { calls.props[k] = v; },
      deleteProperty: (k) => { delete calls.props[k]; },
    }),
  };
  c.pageFilsHisto_ = (ancre, offset) => { calls.pages.push({ ancre, offset }); return opts.page(ancre, offset); };
  c.piecesJointes_ = (msg) => msg.pjs;
  c.traiterPjGmail_ = (msg, i, pj) => calls.pj.push(pj);
  c.indexContient_ = opts.indexContient_ || (() => false);
  c.cleAttachement_ = (msg, i, pj) => `k|${pj}`;
  c.incrementerEchec_ = (cle) => { calls.echecs[cle] = (calls.echecs[cle] || 0) + 1; return calls.echecs[cle]; };
  return { c, calls };
}

let filSeq = 0;
function fil(pjsParMessage) {
  const id = 'fil' + (++filSeq);
  return { getId: () => id, getMessages: () => pjsParMessage.map((pjs) => ({ pjs })) };
}

test('historique : page vide sur passe PROPRE → campagne TERMINÉE, plus jamais de recherche', () => {
  const { c, calls } = ctxHisto({ props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' }, page: () => [] });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
  c.pageFilsHisto_ = () => { throw new Error('ne doit plus être appelé'); };
  c.traiterGmailHistorique_(() => false);
});

test('historique : page vide sur passe SALE → PAS terminé, offset remis à 0 (passe de vérification)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '30', DriveAI_GMAIL_HISTO_PASSE_SALE: 'oui' },
    page: () => [],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, undefined);         // pas terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '0');        // on re-vérifie depuis 0
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined); // nouvelle passe = propre
  // La passe de vérification ne collecte rien → page vide PROPRE → terminé.
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
});

test('historique : une PJ inédite marque la passe SALE (une vérification suivra)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    page: () => [fil([['a']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, 'oui');
});

test('historique : passe de re-lecture 100 % indexée → PROPRE (pas de marque, terminaison possible)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    page: (ancre, offset) => (offset === 0 ? [fil([['a'], ['b']])] : []),
    indexContient_: () => true, // tout est déjà à l'Index
  });
  c.traiterGmailHistorique_(() => false); // page re-passée, 0 inédite
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined);
  c.traiterGmailHistorique_(() => false); // page vide → passe propre → terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
});

test('historique : 1ᵉʳ run → ancre posée UNE FOIS, offset 0 ; l\'ancre ne bouge JAMAIS ensuite', () => {
  const { c, calls } = ctxHisto({ page: () => [fil([['a']])] });
  c.traiterGmailHistorique_(() => false);
  const ancre = calls.props.DriveAI_GMAIL_HISTO_ANCRE;
  assert.match(ancre, /^\d{4}\/\d{2}\/\d{2}$/);
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_ANCRE, ancre); // fixe
  assert.deepStrictEqual(calls.pages.map((p) => p.ancre), [ancre, ancre]);
});

test('historique : page entièrement parcourue → offset += nb de fils', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '20' },
    page: () => [fil([['a']]), fil([['b']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '22');
  assert.deepStrictEqual(calls.pj, ['a', 'b']);
});

test('historique : plafond d\'INÉDITES atteint mi-page → offset INCHANGÉ (rejeu idempotent qui converge)', () => {
  // 3 messages à 1 PJ inédite chacun ; plafond = 2 → arrêt après 2, page rejouée.
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '0' },
    page: () => [fil([['a'], ['b'], ['c']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.deepStrictEqual(calls.pj, ['a', 'b']); // 2 inédites traitées
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET ?? '0', '0'); // rejouée
  // rejeu : a et b désormais indexées (gratuites) → c traitée, page complète → offset avance
  c.indexContient_ = (cle) => cle === 'k|a' || cle === 'k|b';
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '1');
});

test('historique : plafond vérifié PAR PJ — un MESSAGE dense s\'interrompt en son milieu (pas de hard-kill)', () => {
  // UN message à 4 PJ inédites, plafond 2 → 2 traitées puis arrêt AU MILIEU du message.
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '0' },
    page: () => [fil([['a', 'b', 'c', 'd']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.deepStrictEqual(calls.pj, ['a', 'b']);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET ?? '0', '0'); // page rejouée
  // rejeu : a/b indexées → c/d traitées, message épuisé → page complète, offset avance.
  c.indexContient_ = (cle) => cle === 'k|a' || cle === 'k|b';
  c.traiterGmailHistorique_(() => false);
  assert.deepStrictEqual(calls.pj, ['a', 'b', 'a', 'b', 'c', 'd']);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '1');
});

test('historique : déjà-indexées GRATUITES (ne comptent pas dans le plafond)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    page: () => [fil([['v1'], ['v2'], ['v3'], ['n1'], ['n2']])],
    indexContient_: (cle) => cle.startsWith('k|v'),
  });
  c.traiterGmailHistorique_(() => false);
  assert.deepStrictEqual(calls.pj, ['v1', 'v2', 'v3', 'n1', 'n2']); // tout re-passé (skip pipeline), 2 inédites
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '1'); // page complète malgré le plafond
});

test('historique : fil en erreur → sauté avec Échec compté, offset AVANCE, passe marquée SALE (revisite)', () => {
  const poison = { getId: () => 'POISON', getMessages: () => { throw new Error('boom'); } };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '5' },
    page: () => [poison, fil([['x']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '7'); // le poison n'immobilise pas la campagne
  assert.strictEqual(calls.echecs['histo|fil|POISON'], 1);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, 'oui'); // il sera revisité
  assert.ok(calls.journaux.some((j) => j.startsWith('ERR:') && j.includes('sauté')));
  assert.deepStrictEqual(calls.pj, ['x']);
});

test('historique : fil-poison ABANDONNÉ au 3ᵉ essai (ne marque plus SALE — la campagne peut finir)', () => {
  const poison = { getId: () => 'POISON', getMessages: () => { throw new Error('boom'); } };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    echecs: { 'histo|fil|POISON': 2 }, // déjà sauté par 2 passes
    page: (ancre, offset) => (offset === 0 ? [poison] : []),
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.echecs['histo|fil|POISON'], 3);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined); // abandon = pas de re-passe
  assert.ok(calls.journaux.some((j) => j.includes('ABANDONNÉ')));
  c.traiterGmailHistorique_(() => false); // page vide, passe restée propre → terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
});

test('historique : budget épuisé mi-page → offset inchangé (aucune perte, rejeu)', () => {
  let appels = 0;
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '10' },
    page: () => [fil([['a'], ['b']])],
  });
  c.traiterGmailHistorique_(() => ++appels > 1);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '10');
});
