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

test('bornerJournal_ : la rotation est REPORTÉE quand le tick a déjà consommé son garde-temps (anti-mur 6 min)', () => {
  // Le `deleteRows` en lot coûte 10-30 s et tombe en TOUTE FIN de `finally` : c'est lui qui
  // franchirait le mur (revue #229). Le reporter d'un tick n'a aucune conséquence.
  const c = load(['Config.gs', 'Journal.gs']);
  const suppressions = [];
  c.journalInfo_ = () => {};
  c.feuille_ = () => ({
    getLastRow: () => c.CONFIG.JOURNAL_MAX_LIGNES + c.CONFIG.JOURNAL_MARGE + 500, // rotation DUE
    deleteRows: (debut, nb) => suppressions.push(nb),
  });

  c.bornerJournal_(() => true);
  assert.deepStrictEqual(suppressions, [], 'tick chargé → aucune rotation ce tick-ci');

  c.bornerJournal_(() => false);
  assert.strictEqual(suppressions.length, 1, 'tick tranquille → la rotation a bien lieu');

  c.bornerJournal_(); // appelant historique sans garde : comportement inchangé
  assert.strictEqual(suppressions.length, 2, 'sans garde fourni, on rotationne comme avant');
});

test('bornerJournal_ : rien à supprimer → le garde n\'est même pas consulté (cas dominant, coût nul)', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  let consulte = false;
  c.journalInfo_ = () => {};
  c.feuille_ = () => ({ getLastRow: () => 10, deleteRows: () => { throw new Error('ne doit pas rotationner'); } });
  c.bornerJournal_(() => { consulte = true; return true; });
  assert.strictEqual(consulte, false);
});
