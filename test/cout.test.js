'use strict';
/**
 * Coût LLM — `coutDollars_` (Cout.gs) : conversion pure tokens → dollars via CONFIG.LLM_PRIX
 * (prix par MILLION de tokens). Sert le suivi budget (< 10 $/mois) et l'onglet Santé.
 * + FREIN BUDGET des campagnes (R3, §2.6) : `budgetCampagnesAtteint_` met rangement/migration/
 * historique en pause quand le coût mensuel MESURÉ atteint CONFIG.LLM_BUDGET_CAMPAGNES —
 * le flux vivant (Gmail, dépôts, intentions, tri) n'est JAMAIS gaté par ce frein (vécu :
 * 15,62 $ le 7 juillet, budget §2.6 crevé par le rangement de masse nocturne).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Cout.gs']);
const M = 1e6;
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

test('coût nul', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0 }), 0);
});

test('prix unitaires par MTok (Haiku 1/5, Sonnet 3/15)', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: M, hout: 0, sin: 0, sout: 0 }), 1);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: M, sin: 0, sout: 0 }), 5);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: M, sout: 0 }), 3);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: M }), 15);
});

test('somme pondérée cohérente', () => {
  // 2 MTok in Haiku (2$) + 1 MTok out Haiku (5$) + 1 MTok in Sonnet (3$) = 10 $.
  assert.strictEqual(ctx.coutDollars_({ hin: 2 * M, hout: M, sin: M, sout: 0 }), 10);
});

test('proportionnel sous le million (pas d\'arrondi masquant)', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: 500000, hout: 0, sin: 0, sout: 0 }), 0.5);
});

test('coutDollarsDelta_ : différence de 2 relevés (dry-run C26-07, coût PAR document)', () => {
  const avant = { hin: 0, hout: 0, sin: 0, sout: 0 };
  const apres = { hin: 0, hout: 0, sin: M, sout: 0 }; // 1 MTok Sonnet in = 3 $
  assert.strictEqual(ctx.coutDollarsDelta_(avant, apres), 3);
  assert.strictEqual(ctx.coutDollarsDelta_(apres, apres), 0); // pas de progrès entre 2 relevés → 0
});

test('usageRunSnapshot_ : copie (jamais la référence), {} si aucun run en cours', () => {
  const c = load(['Config.gs', 'Cout.gs']);
  assert.deepStrictEqual(plat(c.usageRunSnapshot_()), { hin: 0, hout: 0, sin: 0, sout: 0, appels: 0 });
  c.reinitialiserUsage_();
  c.enregistrerUsage_('claude-sonnet-4-6', { input_tokens: 100, output_tokens: 20 });
  const s1 = c.usageRunSnapshot_();
  assert.strictEqual(s1.sin, 100);
  c.enregistrerUsage_('claude-sonnet-4-6', { input_tokens: 900, output_tokens: 80 });
  assert.strictEqual(s1.sin, 100, 'le relevé pris AVANT le 2e appel ne doit pas bouger (copie)');
  assert.strictEqual(c.usageRunSnapshot_().sin, 1000);
});

// ---------------------------------------------------------------------------
// budgetCampagnesAtteint_ (frein des campagnes, R3)
// ---------------------------------------------------------------------------

/**
 * Contexte avec Script Properties EN MÉMOIRE. `deltaDollars` positionne le coût du mois PAR
 * RAPPORT au seuil CONFIG.LLM_BUDGET_CAMPAGNES (les tests restent vrais si Marc rajuste le
 * plafond — vécu : 10 → 30 le 07-07, les tests codés « 16 $ ≥ 10 » auraient menti).
 */
function ctxFrein(deltaDollars) {
  const store = {};
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
  });
  const poserCout = (delta) => {
    // haiku_in = 1 $/MTok → dollars × 1e6 tokens.
    const hin = Math.max(0, (c.CONFIG.LLM_BUDGET_CAMPAGNES + delta)) * 1e6;
    store[c.cleCoutMois_()] = JSON.stringify({ hin, hout: 0, sin: 0, sout: 0, appels: 1 });
  };
  if (deltaDollars != null) poserCout(deltaDollars);
  return { c, store, poserCout };
}

test('frein : sous le budget → false, aucun journal', () => {
  const { c } = ctxFrein(-1); // seuil − 1 $
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  assert.strictEqual(c.__logs.length, 0);
});

test('frein : budget atteint → true + journalisé UNE seule fois par mois', () => {
  const { c, store } = ctxFrein(+6); // seuil + 6 $
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  const infos = c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout');
  assert.strictEqual(infos.length, 1, 'enclenchement journalisé');
  assert.strictEqual(store.DriveAI_FREIN_BUDGET,
    c.cleCoutMois_() + '|' + c.CONFIG.LLM_BUDGET_CAMPAGNES,
    'mémoire « déjà signalé ce mois, à ce seuil »');

  // Run suivant (cache remis à zéro) : toujours freiné, mais PAS de nouvelle ligne de journal.
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  assert.strictEqual(c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout').length, 1);
});

test('frein : plafond RELEVÉ en cours de mois → campagnes reprennent ; re-déclenché plus haut → re-annoncé', () => {
  // Le scénario réel du 07-07 : frein posé à 10 $, Marc dit « continue le tri au complet ».
  const { c, store, poserCout } = ctxFrein(+2); // au-dessus du seuil courant
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  const seuilInitial = c.CONFIG.LLM_BUDGET_CAMPAGNES;

  c.CONFIG.LLM_BUDGET_CAMPAGNES = seuilInitial + 20; // Marc relève le plafond
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), false, 'les campagnes reprennent au tick suivant');

  poserCout(+1); // le coût finit par atteindre le NOUVEAU plafond (relatif au seuil courant)
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 're-freiné au nouveau niveau');
  assert.strictEqual(c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout').length, 2,
    'la re-pause au seuil relevé est RE-annoncée (jamais silencieuse)');
});

test('frein : lu au plus 1×/run (cache) — pas une lecture Properties par campagne', () => {
  const { c, poserCout } = ctxFrein(-1);
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  // Le coût explose ENTRE deux appels du même run : la valeur cachée reste servie.
  poserCout(+99);
  assert.strictEqual(c.budgetCampagnesAtteint_(), false, 'même run → valeur du cache');
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 'run suivant → relu');
});

test('frein : Properties illisibles → false (une panne d\'état ne bloque jamais les campagnes)', () => {
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: { getScriptProperties: () => { throw new Error('indisponible (simulé)'); } },
  });
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
});

test('frein : une panne de JOURNALISATION ne relève pas un frein correctement mesuré', () => {
  const { c } = ctxFrein(16e6); // 16 $ ≥ 10
  c.journalInfo_ = () => { throw new Error('journal indisponible (simulé)'); };
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 'la mesure prime sur l\'annonce');
});
