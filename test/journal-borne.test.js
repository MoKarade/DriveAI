'use strict';
/**
 * Journal borné (ADR-0006) — `lignesJournalASupprimer_` : logique PURE de rotation.
 * Hystérésis : ne purge qu'au-delà de `max + marge` (purge en lot, pas ligne-à-ligne),
 * puis ramène à exactement `max`. En-tête (ligne 1) hors compte.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Journal.gs']);
const MAX = 20000, MARGE = 5000;

test('sous le plafond → aucune purge', () => {
  assert.strictEqual(ctx.lignesJournalASupprimer_(1, MAX, MARGE), 0);        // journal vide (en-tête seul)
  assert.strictEqual(ctx.lignesJournalASupprimer_(0, MAX, MARGE), 0);        // dernLigne aberrant → 0, pas négatif
  assert.strictEqual(ctx.lignesJournalASupprimer_(MAX + 1, MAX, MARGE), 0);  // pile MAX données, sous le seuil
});

test('au seuil (max + marge) exact → toujours aucune purge (hystérésis)', () => {
  // dernLigne = max + marge + 1 (en-tête) → données = max + marge → NON déclenché.
  assert.strictEqual(ctx.lignesJournalASupprimer_(MAX + MARGE + 1, MAX, MARGE), 0);
});

test('juste au-dessus du seuil → purge pour ramener à max', () => {
  // données = max + marge + 1 → supprime (données - max) = marge + 1.
  assert.strictEqual(ctx.lignesJournalASupprimer_(MAX + MARGE + 2, MAX, MARGE), MARGE + 1);
});

test('très gros journal → ramène exactement à max', () => {
  // dernLigne = 100001 → données 100000 → supprime 80000, il reste max=20000.
  assert.strictEqual(ctx.lignesJournalASupprimer_(100001, MAX, MARGE), 80000);
  assert.strictEqual(100000 - ctx.lignesJournalASupprimer_(100001, MAX, MARGE), MAX);
});

test('CONFIG cohérent : le plafond du Journal couvre la fenêtre du résumé hebdo', () => {
  // Sinon la rotation pourrait supprimer des lignes encore lues par le résumé hebdo.
  assert.ok(ctx.CONFIG.JOURNAL_MAX_LIGNES >= ctx.CONFIG.RESUME_MAX_LIGNES,
    'JOURNAL_MAX_LIGNES doit être ≥ RESUME_MAX_LIGNES');
  assert.ok(ctx.CONFIG.JOURNAL_MARGE > 0, 'une marge > 0 évite une purge à chaque tick');
});
