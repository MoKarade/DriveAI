'use strict';
/**
 * Chantier #12 (ADR-0010 §1) — historique Gmail : ancre FIXE + pagination par OFFSET,
 * terminaison par DEUX passes de VÉRIFICATION propres, budget QUOTIDIEN.
 * Design issu de TROIS vérifications adversariales : l'APPARTENANCE à `before:<ancre>` est stable
 * → l'offset est sûr ; mais l'ORDRE peut bouger (fil ravivé sans PJ, suppression) → une page vide
 * ne termine la campagne qu'après DEUX passes complètes consécutives sans rien collecter.
 * Garde-temps et plafond d'inédites vérifiés à CHAQUE niveau (fil, message, PJ) ; fil en erreur
 * compté seulement à la COMPLÉTION de page (un rejeu ne brûle pas les essais), abandonné après
 * QUARANTAINE_MAX essais ; budget QUOTIDIEN en ms (le plafond par run ne borne pas la journée).
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
  c.estPannePlateforme_ = () => false; // garde panne de compte (Llm.gs non chargé ici)
  return { c, calls };
}

let filSeq = 0;
function fil(pjsParMessage) {
  const id = 'fil' + (++filSeq);
  return { getId: () => id, getMessages: () => pjsParMessage.map((pjs) => ({ pjs })) };
}

/* ---------- terminaison : deux passes propres ---------- */

test('historique : DEUX pages vides propres consécutives → TERMINÉE, plus jamais de recherche', () => {
  const { c, calls } = ctxHisto({ props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' }, page: () => [] });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, undefined);            // 1 passe propre ne suffit pas
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSES_PROPRES, '1');
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '0');
  c.traiterGmailHistorique_(() => false);                                    // 2ᵉ passe propre (vide aussi)
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
  c.pageFilsHisto_ = () => { throw new Error('ne doit plus être appelé'); };
  c.traiterGmailHistorique_(() => false);
});

test('historique : page vide sur passe SALE → PAS terminé, offset à 0 et compteur de passes propres remis', () => {
  const { c, calls } = ctxHisto({
    props: {
      DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '30',
      DriveAI_GMAIL_HISTO_PASSE_SALE: 'oui', DriveAI_GMAIL_HISTO_PASSES_PROPRES: '1',
    },
    page: () => [],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, undefined);            // pas terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '0');           // on re-vérifie depuis 0
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined); // nouvelle passe = propre
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSES_PROPRES, undefined); // série remise à zéro
  c.traiterGmailHistorique_(() => false); // passe de vérif 1 : vide, propre
  c.traiterGmailHistorique_(() => false); // passe de vérif 2 : vide, propre → terminé
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

test('historique : passe de re-lecture 100 % indexée → PROPRE (cycle complet jusqu\'à terminé)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    page: (ancre, offset) => (offset === 0 ? [fil([['a'], ['b']])] : []),
    indexContient_: () => true, // tout est déjà à l'Index
  });
  c.traiterGmailHistorique_(() => false); // page re-passée, 0 inédite
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined);
  c.traiterGmailHistorique_(() => false); // page vide → passe propre 1/2, offset 0
  c.traiterGmailHistorique_(() => false); // page 0 re-lue (indexée, propre)
  c.traiterGmailHistorique_(() => false); // page vide → passe propre 2/2 → terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
});

/* ---------- ancre & offset ---------- */

test('historique : 1ᵉʳ run → ancre posée UNE FOIS à −29 j (vrai chevauchement avec le vivant), jamais bougée', () => {
  const { c, calls } = ctxHisto({ page: () => [fil([['a']])] });
  const attendue = (() => { const d = new Date(); d.setDate(d.getDate() - 29); return ctxPur.dateGmail_(d); })();
  c.traiterGmailHistorique_(() => false);
  const ancre = calls.props.DriveAI_GMAIL_HISTO_ANCRE;
  assert.strictEqual(ancre, attendue);
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

/* ---------- plafonds par run ---------- */

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

test('historique : budget épuisé → plus AUCUN appel Gmail sur les fils restants (garde au niveau fil)', () => {
  let espionGetMessages = 0;
  const espion = { getId: () => 'ESPION', getMessages: () => { espionGetMessages++; return []; } };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '10' },
    page: () => [fil([['a']]), espion],
  });
  c.traiterGmailHistorique_(() => calls.pj.length >= 1); // budget « épuisé » dès la 1ʳᵉ PJ traitée
  assert.deepStrictEqual(calls.pj, ['a']);
  assert.strictEqual(espionGetMessages, 0);                          // jamais touché après le budget
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '10');  // page rejouée
});

/* ---------- fils en erreur : un essai par PASSE, jamais par rejeu ---------- */

test('historique : fil en erreur sur page COMPLÈTE → 1 Échec compté, offset avance, passe SALE (revisite)', () => {
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

test('historique : page REJOUÉE (plafond) avec fil en erreur → l\'Échec n\'est PAS compté (un essai par passe)', () => {
  // Sans ce garde, une erreur transitoire co-pagée avec des inédites brûlerait 3 essais en 15 min.
  const poison = { getId: () => 'POISON', getMessages: () => { throw new Error('transitoire'); } };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '0' },
    page: () => [poison, fil([['a'], ['b'], ['c']])], // 3 inédites, plafond 2 → page interrompue
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET ?? '0', '0'); // rejouée
  assert.strictEqual(calls.echecs['histo|fil|POISON'], undefined);        // PAS compté sur un rejeu
  // rejeu : l'erreur a GUÉRI (1 PJ p1), a/b indexées → page complète, compteur vierge (aucune trace).
  c.pageFilsHisto_ = () => [fil([['p1']]), fil([['a'], ['b'], ['c']])];
  c.indexContient_ = (cle) => cle === 'k|a' || cle === 'k|b';
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.echecs['histo|fil|POISON'], undefined);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '2');
});

test('historique : fil-poison ABANDONNÉ au 3ᵉ essai — annoncé UNE fois, puis silencieux, la campagne finit', () => {
  const poison = { getId: () => 'POISON', getMessages: () => { throw new Error('boom'); } };
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02' },
    echecs: { 'histo|fil|POISON': 2 }, // déjà sauté par 2 passes
    page: (ancre, offset) => (offset === 0 ? [poison] : []),
  });
  c.traiterGmailHistorique_(() => false); // page complète → essai 3 → ABANDONNÉ (pas de SALE)
  assert.strictEqual(calls.echecs['histo|fil|POISON'], 3);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined);
  assert.strictEqual(calls.journaux.filter((j) => j.includes('ABANDONNÉ')).length, 1);
  c.traiterGmailHistorique_(() => false); // page vide, passe propre 1/2 → offset 0
  c.traiterGmailHistorique_(() => false); // poison re-rencontré : essai 4 → SILENCIEUX, pas de SALE
  assert.strictEqual(calls.journaux.filter((j) => j.includes('ABANDONNÉ')).length, 1);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_PASSE_SALE, undefined);
  c.traiterGmailHistorique_(() => false); // page vide, passe propre 2/2 → terminé
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO, 'terminé');
});

/* ---------- budget quotidien ---------- */

test('historique : budget QUOTIDIEN épuisé → aucun appel, repris le lendemain (compteur remis à zéro)', () => {
  const auj = ctxPur.dateGmail_(new Date());
  const { c, calls } = ctxHisto({
    props: {
      DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02',
      DriveAI_GMAIL_HISTO_JOUR: auj,
      DriveAI_GMAIL_HISTO_MS_JOUR: String(20 * 60 * 1000), // plafond atteint aujourd'hui
    },
    page: () => [fil([['a']])],
  });
  c.traiterGmailHistorique_(() => false);
  assert.strictEqual(calls.pages.length, 0); // pas même une recherche
  assert.deepStrictEqual(calls.pj, []);
  // « Lendemain » : la Property JOUR ne matche plus → compteur reparti de zéro → la campagne tourne.
  calls.props.DriveAI_GMAIL_HISTO_JOUR = '2020/01/01';
  c.traiterGmailHistorique_(() => false);
  assert.deepStrictEqual(calls.pj, ['a']);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_JOUR, auj); // comptage re-daté
  assert.ok(Number(calls.props.DriveAI_GMAIL_HISTO_MS_JOUR) >= 0);
});

test('historique : chaque run AJOUTE ses ms au compteur du jour', () => {
  const auj = ctxPur.dateGmail_(new Date());
  const { c, calls } = ctxHisto({
    props: {
      DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02',
      DriveAI_GMAIL_HISTO_JOUR: auj,
      DriveAI_GMAIL_HISTO_MS_JOUR: '500000',
    },
    page: () => [],
  });
  c.traiterGmailHistorique_(() => false);
  assert.ok(Number(calls.props.DriveAI_GMAIL_HISTO_MS_JOUR) >= 500000); // cumul, jamais remis à zéro le même jour
});

test('historique : budget épuisé mi-page → offset inchangé (aucune perte, rejeu)', () => {
  const { c, calls } = ctxHisto({
    props: { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/02', DriveAI_GMAIL_HISTO_OFFSET: '10' },
    page: () => [fil([['a'], ['b']])],
  });
  c.traiterGmailHistorique_(() => calls.pj.length >= 1); // budget tombe après la 1ʳᵉ PJ
  assert.deepStrictEqual(calls.pj, ['a']);
  assert.strictEqual(calls.props.DriveAI_GMAIL_HISTO_OFFSET, '10');
});
