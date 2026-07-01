'use strict';
/**
 * Dates — Router.dateNormalisee_ : une date_doc AAAA-MM-JJ valide passe telle quelle ;
 * sinon on retombe sur la date de réception (Gmail) / dépôt (intake). (CLAUDE.md §3.)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Router.gs']);
const REF = new Date(Date.UTC(2026, 2, 9)); // 2026-03-09 (mois 0-based)

test('date_doc valide (AAAA-MM-JJ) → renvoyée telle quelle', () => {
  assert.strictEqual(ctx.dateNormalisee_('2025-12-31', REF), '2025-12-31');
});

test('date_doc absente → date de référence (formatée)', () => {
  assert.strictEqual(ctx.dateNormalisee_('', REF), '2026-03-09');
  assert.strictEqual(ctx.dateNormalisee_(null, REF), '2026-03-09');
  assert.strictEqual(ctx.dateNormalisee_(undefined, REF), '2026-03-09');
});

test('date_doc au mauvais format → date de référence (jamais une date bancale dans le nom)', () => {
  assert.strictEqual(ctx.dateNormalisee_('2026/01/15', REF), '2026-03-09');
  assert.strictEqual(ctx.dateNormalisee_('15-01-2026', REF), '2026-03-09');
  assert.strictEqual(ctx.dateNormalisee_('pas une date', REF), '2026-03-09');
  assert.strictEqual(ctx.dateNormalisee_('2026-1-5', REF), '2026-03-09'); // exige zéro-padding strict
});
