'use strict';
/**
 * Coût LLM — `coutDollars_` (Cout.gs) : conversion pure tokens → dollars via CONFIG.LLM_PRIX
 * (prix par MILLION de tokens). Sert le suivi budget (< 10 $/mois) et l'onglet Santé.
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
