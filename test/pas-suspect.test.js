'use strict';
/**
 * C28-19 (ADR-0020) — curation des mails :
 *  - `decisionSuspect_` PURE : la Confiance outrepasse heuristique + LLM + libellé ⚠ déjà posé ;
 *    sans confiance, la règle 2026-07-07 est INCHANGÉE (non-régression).
 *  - `confianceCache_`/`apprendreConfiance_` : adresse nue minuscule, dédupliquée.
 *  - `scanCycliqueTri_` : offset persistant qui avance par PAGE COMPLÈTE, repart à 0 en fin de
 *    fenêtre, borné à TRI_CYCLIQUE_PAGES_PAR_RUN pages/tick (dérivé de la CONSTANTE) ; une page
 *    interrompue ne bouge pas l'offset (rejeu gratuit).
 *  - `appliquerPasSuspect_` : consommation ADDITIVE de la Property (purge Index + re-tri par fil,
 *    reste re-présenté après coupure/attente, jamais perdu).
 *  - `purgerClesTriIndex_` : ne purge QUE les clés `tri|<id>|…`, ordre décroissant, cache invalidé.
 *  - Tripwires : les prompts intentions/mini-check portent bien l'élargissement « facture à payer ».
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

/* ---------- decisionSuspect_ (PURE) ---------- */

const ctxPur = load(['Config.gs', 'TriGmail.gs']);

test('decisionSuspect_ : matrice — confiance > tout ; règle 2026-07-07 inchangée sans confiance', () => {
  const d = ctxPur.decisionSuspect_;
  const base = { deConfiance: false, heuristique: false, llm: false, estMoi: false, appris: false, cheminDangereux: false, dejaPoseSuspect: false };
  assert.strictEqual(d(base), false);
  assert.strictEqual(d({ ...base, heuristique: true }), true);
  assert.strictEqual(d({ ...base, llm: true }), true);
  assert.strictEqual(d({ ...base, llm: true, estMoi: true }), false, 'on ne se phishe pas soi-même');
  assert.strictEqual(d({ ...base, llm: true, appris: true }), false, 'expéditeur appris : signal LLM ignoré');
  assert.strictEqual(d({ ...base, llm: true, appris: true, cheminDangereux: true }), true, 'sauf chemin dangereux');
  assert.strictEqual(d({ ...base, dejaPoseSuspect: true }), true, '⚠ déjà posé conservé par défaut');
  // La CONFIANCE (clic de Marc) outrepasse chacun des trois signaux, y compris combinés.
  assert.strictEqual(d({ ...base, deConfiance: true, heuristique: true, llm: true, dejaPoseSuspect: true }), false);
});

/* ---------- confiance : cache + apprentissage dédupliqué ---------- */

function ctxConfiance(lignes) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const ajouts = [];
  c.feuille_ = (nom) => {
    assert.strictEqual(nom, 'Confiance');
    return {
      getLastRow: () => lignes.length + 1,
      getRange: (l, col, n, cols) => ({ getValues: () => lignes.map((a) => [a]) }),
      appendRow: (r) => ajouts.push(r),
    };
  };
  return { c, ajouts };
}

test('confianceCache_/apprendreConfiance_ : minuscules, dédup (cache + onglet), 1 lecture par run', () => {
  const { c, ajouts } = ctxConfiance(['no-reply@google.com']);
  assert.strictEqual(c.confianceCache_()['no-reply@google.com'], true);
  c.apprendreConfiance_('No-Reply@Google.com'); // déjà connue (casse ignorée) → aucune écriture
  assert.strictEqual(ajouts.length, 0);
  c.apprendreConfiance_('Notification@Desjardins.com');
  assert.strictEqual(ajouts.length, 1);
  assert.strictEqual(ajouts[0][0], 'notification@desjardins.com');
  c.apprendreConfiance_('notification@desjardins.com'); // double clic → toujours 1 ligne
  assert.strictEqual(ajouts.length, 1);
});

/* ---------- scanCycliqueTri_ ---------- */

function ctxCyclique(opts) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const props = Object.assign({}, opts.props);
  const recherches = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.GmailApp = { search: (req, offset, n) => { recherches.push(offset); return opts.pages(offset, n); } };
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {};
  c.trierFil_ = opts.trierFil || (() => 'deja');
  c.dateGmail_ = () => opts.jour || '2026/07/13'; // Gmail.gs non chargé — le « jour » est piloté par le test
  return { c, props, recherches };
}

test('scanCycliqueTri_ : borné à TRI_CYCLIQUE_PAGES_PAR_RUN pages/tick, offset avancé par page complète', () => {
  const fil = (id) => ({ getId: () => id });
  const { c, props, recherches } = ctxCyclique({
    props: {},
    pages: (offset, n) => Array.from({ length: n }, (_, i) => fil('f' + (offset + i))),
  });
  const PAGES = c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN; // dérivé de la CONSTANTE, jamais de sa valeur
  const PAGE = c.CONFIG.PAGE_FILS_ACTIONS;
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(recherches.length, PAGES, 'jamais plus de pages que la constante (quota partagé)');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, String(PAGES * PAGE));
});

test('scanCycliqueTri_ : fin de fenêtre (page vide) → offset remis à 0 (le tour repart du haut)', () => {
  const { c, props } = ctxCyclique({ props: { DriveAI_TRI_CYCLIQUE_OFFSET: '120' }, pages: () => [] });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '0');
});

test('scanCycliqueTri_ : page interrompue par le plafond → offset INCHANGÉ (rejeu gratuit au tick suivant)', () => {
  const etat = { traites: 0, attentes: 0 };
  const { c, props } = ctxCyclique({
    props: { DriveAI_TRI_CYCLIQUE_OFFSET: '40' },
    pages: (offset, n) => Array.from({ length: n }, (_, i) => ({ getId: () => 'f' + (offset + i) })),
    trierFil: () => 'traite', // le scan compte lui-même etat.traites
  });
  c.scanCycliqueTri_(etat, () => etat.traites >= 3, [], {}); // plafond au 3ᵉ fil, page de 20
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '40', 'page incomplète → offset figé');
  assert.strictEqual(etat.traites, 3);
  // C28-21 : les fils LUS comptent au plafond quotidien MÊME sur page interrompue — le rejeu
  // re-lira ces fils, le coût de LECTURE est consommé, page complétée ou non. 3 lus : le plafond
  // du run coupe AVANT la lecture du 4ᵉ (jamais un fil lu « pour rien » de ce côté-là).
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, '3');
});

/* ---------- C28-21 : plafond QUOTIDIEN de lectures du cyclique ---------- */

test('scanCycliqueTri_ : plafond quotidien ATTEINT → retour immédiat SANS GmailApp.search', () => {
  const MAX = load(['Config.gs']).CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR; // dérivé de la CONSTANTE
  const { c, recherches } = ctxCyclique({
    jour: '2026/07/13',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX) },
    pages: () => { throw new Error('aucune recherche ne doit partir au plafond'); },
  });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(recherches.length, 0, 'plafond du jour atteint = zéro appel Gmail');
});

test('scanCycliqueTri_ : page RÉTRÉCIE au reliquat (complétable → offset avance) ; compteur remis à zéro le lendemain', () => {
  const c0 = load(['Config.gs']);
  const MAX = c0.CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR;
  const PAGE = c0.CONFIG.PAGE_FILS_ACTIONS;
  const tailles = [];
  // Reliquat du jour = 3 (< PAGE) → la recherche demande 3 fils, la page se COMPLÈTE : jamais un
  // rejeu en boucle qui re-lirait la même page à chaque tick sans avancer.
  const { c, props } = ctxCyclique({
    jour: '2026/07/13',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX - 3), DriveAI_TRI_CYCLIQUE_OFFSET: '60' },
    pages: (offset, n) => { tailles.push(n); return Array.from({ length: n }, (_, i) => ({ getId: () => 'f' + i })); },
  });
  c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.ok(tailles[0] === 3 && tailles[0] < PAGE, 'page bornée au reliquat du jour');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_OFFSET, '63', 'page complète → offset avance');
  assert.strictEqual(props.DriveAI_TRI_CYCLIQUE_FILS_JOUR, String(MAX), 'cumul du jour');
  // Lendemain : la Property JOUR ne matche plus → compteur reparti de zéro, pleine page de nouveau.
  const lendemain = ctxCyclique({
    jour: '2026/07/14',
    props: { DriveAI_TRI_CYCLIQUE_JOUR: '2026/07/13', DriveAI_TRI_CYCLIQUE_FILS_JOUR: String(MAX) },
    pages: (offset, n) => { tailles.push(n); return []; },
  });
  lendemain.c.scanCycliqueTri_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.strictEqual(tailles[1], Math.min(PAGE, MAX), 'nouveau jour → plafond re-ouvert');
});

/* ---------- appliquerPasSuspect_ ---------- */

function ctxPasSuspect(opts) {
  const c = load(['Config.gs', 'TriGmail.gs']);
  const props = Object.assign({}, opts.props);
  const purges = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.purgerClesTriIndex_ = (id) => { purges.push(id); return 2; };
  c.GmailApp = { getThreadById: (id) => (opts.filInconnu ? null : { getId: () => id }) };
  c.signalerPanneGmail_ = () => false;
  c.journalErreur_ = () => {};
  c.trierFil_ = opts.trierFil || (() => 'traite');
  return { c, props, purges };
}

test('appliquerPasSuspect_ : purge + re-tri immédiat de chaque fil, Property effacée quand tout est servi', () => {
  const { c, props, purges } = ctxPasSuspect({ props: { DriveAI_PAS_SUSPECT: JSON.stringify(['fA', 'fB']) } });
  const etat = { traites: 0, attentes: 0 };
  c.appliquerPasSuspect_(etat, () => false, [], {});
  assert.deepStrictEqual(purges, ['fA', 'fB']);
  assert.strictEqual(etat.traites, 2);
  assert.ok(!('DriveAI_PAS_SUSPECT' in props), 'liste entièrement servie → Property effacée');
});

test('appliquerPasSuspect_ : coupure (plafond) et « attend » → le RESTE survit pour le tick suivant', () => {
  const etat = { traites: 0, attentes: 0 };
  const { c, props } = ctxPasSuspect({
    props: { DriveAI_PAS_SUSPECT: JSON.stringify(['fA', 'fB', 'fC']) },
    trierFil: (fil) => (fil.getId() === 'fA' ? 'attend' : 'traite'),
  });
  c.appliquerPasSuspect_(etat, () => etat.traites >= 1, [], {}); // plafond après le 1ᵉʳ traité (fB)
  const restants = JSON.parse(props.DriveAI_PAS_SUSPECT);
  assert.deepStrictEqual(restants, ['fA', 'fC'], '« attend » (fA) ET non-atteint (fC) re-présentés');
});

test('appliquerPasSuspect_ : Property corrompue → purgée, jamais une boucle d\'erreurs par tick', () => {
  const { c, props } = ctxPasSuspect({ props: { DriveAI_PAS_SUSPECT: '{pas du json' } });
  c.appliquerPasSuspect_({ traites: 0, attentes: 0 }, () => false, [], {});
  assert.ok(!('DriveAI_PAS_SUSPECT' in props));
});

/* ---------- purgerClesTriIndex_ (Journal.gs) ---------- */

test('purgerClesTriIndex_ : ne purge QUE tri|<id>|…, ordre décroissant, cache du run invalidé', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const lignes = [['tri|fA|1|lu'], ['drive|fA'], ['tri|fAB|2|lu'], ['tri|fA|2|nonlu'], ['intention|fA']];
  const supprimees = [];
  c.feuille_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: () => ({ getValues: () => lignes }),
    deleteRow: (n) => supprimees.push(n),
  });
  c._indexCache = { 'tri|fA|1|lu': true, 'tri|fA|2|nonlu': true, 'drive|fA': true };
  const n = c.purgerClesTriIndex_('fA');
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(supprimees, [5, 2], 'décroissant (pas de décalage) ; fAB/drive|/intention| intacts');
  assert.ok(!('tri|fA|1|lu' in c._indexCache) && !('tri|fA|2|nonlu' in c._indexCache));
  assert.ok(c._indexCache['drive|fA'], 'les clés documentaires ne sont JAMAIS touchées');
});

/* ---------- tripwires : prompts élargis (décision Marc 2026-07-13) ---------- */

test('tripwire : mini-check et PROMPT_INTENTIONS portent l\'élargissement « facture à payer / action requise »', () => {
  const prefiltre = fs.readFileSync(path.join(__dirname, '..', 'src', 'Prefiltre.gs'), 'utf8');
  assert.ok(prefiltre.includes('FACTURE À PAYER'), 'mini-check : action=true pour une facture à payer');
  assert.ok(!prefiltre.includes('une facture récurrente ou une offre commerciale'),
    'l\'ancienne exclusion « facture récurrente » (cause du bug vécu) ne doit pas revenir');
  const ctxLlm = load(['Config.gs', 'Llm.gs']);
  assert.ok(String(ctxLlm.PROMPT_INTENTIONS).includes('ACTION REQUISE'),
    'intentions : payer une facture / action requise = toujours une tache');
});
