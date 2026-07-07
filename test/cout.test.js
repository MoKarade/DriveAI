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

// ---------------------------------------------------------------------------
// budgetCampagnesAtteint_ (frein des campagnes, R3)
// ---------------------------------------------------------------------------

/** Contexte avec Script Properties EN MÉMOIRE, pré-remplies avec un coût mensuel donné. */
function ctxFrein(tokensHaikuIn) {
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
  if (tokensHaikuIn != null) {
    store[c.cleCoutMois_()] = JSON.stringify({ hin: tokensHaikuIn, hout: 0, sin: 0, sout: 0, appels: 1 });
  }
  return { c, store };
}

test('frein : sous le budget → false, aucun journal', () => {
  const { c } = ctxFrein(1e6); // 1 $ < 10 $
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  assert.strictEqual(c.__logs.length, 0);
});

test('frein : budget atteint → true + journalisé UNE seule fois par mois', () => {
  const { c, store } = ctxFrein(16e6); // 16 $ ≥ LLM_BUDGET_CAMPAGNES (10)
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  const infos = c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout');
  assert.strictEqual(infos.length, 1, 'enclenchement journalisé');
  assert.strictEqual(store.DriveAI_FREIN_BUDGET, c.cleCoutMois_(), 'mémoire « déjà signalé ce mois »');

  // Run suivant (cache remis à zéro) : toujours freiné, mais PAS de nouvelle ligne de journal.
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  assert.strictEqual(c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout').length, 1);
});

test('frein : lu au plus 1×/run (cache) — pas une lecture Properties par campagne', () => {
  const { c, store } = ctxFrein(1e6);
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  // Le coût explose ENTRE deux appels du même run : la valeur cachée reste servie.
  store[c.cleCoutMois_()] = JSON.stringify({ hin: 99e6, hout: 0, sin: 0, sout: 0, appels: 2 });
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
