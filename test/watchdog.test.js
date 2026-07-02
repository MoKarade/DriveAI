'use strict';
/**
 * Chien de garde (ADR-0004) — `actionChienDeGarde_` : machine PURE à 3 états.
 * détecter → réparer (1×) → (si toujours en panne) alerter (1×). Les clés d'épisode évitent
 * de réparer/alerter en boucle : on n'agit qu'une fois par épisode de panne (heartbeat figé).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Main.gs', 'Resume.gs']);
const SEUIL = 45 * 60 * 1000; // 45 min
const T = 1_000_000_000_000;  // un « maintenant » de référence (ms)

test('moteur qui tourne (heartbeat frais) → rien', () => {
  assert.strictEqual(ctx.actionChienDeGarde_(T, T - 60_000, SEUIL, 0, 0), 'rien');          // 1 min
  assert.strictEqual(ctx.actionChienDeGarde_(T, T - SEUIL, SEUIL, 0, 0), 'rien');           // pile au seuil (<=)
});

test('jamais tourné (pas de heartbeat) → rien (pas de fausse alerte au démarrage)', () => {
  assert.strictEqual(ctx.actionChienDeGarde_(T, 0, SEUIL, 0, 0), 'rien');
});

test('silencieux au-delà du seuil, 1re détection → reparer', () => {
  const dernierTick = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, 0, 0), 'reparer');
});

test('toujours en panne après une réparation déjà tentée pour cet épisode → alerter', () => {
  const dernierTick = T - (SEUIL + 60_000);
  // repareTick == dernierTick : on a déjà réparé pour CE heartbeat, il n'a pas bougé → escalade.
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, dernierTick, 0), 'alerter');
});

test('déjà alerté pour cet épisode → rien (pas de spam)', () => {
  const dernierTick = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dernierTick, SEUIL, dernierTick, dernierTick), 'rien');
});

test('nouvel épisode (heartbeat différent des marqueurs) → reparer à nouveau', () => {
  // Le moteur avait repris (nouveau heartbeat) puis re-planté : repare/alerteTick pointent l'ANCIEN épisode.
  const ancien = T - 10 * SEUIL;
  const nouveauMaisEnPanne = T - (SEUIL + 60_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, nouveauMaisEnPanne, SEUIL, ancien, ancien), 'reparer');
});

test('escalade complète d\'un épisode : reparer → alerter → rien', () => {
  const dt = T - (SEUIL + 120_000);
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, 0, 0), 'reparer');    // 1er passage
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, dt, 0), 'alerter');   // 2e passage (réparé, tjs en panne)
  assert.strictEqual(ctx.actionChienDeGarde_(T, dt, SEUIL, dt, dt), 'rien');     // 3e passage (déjà alerté)
});

/* --- État du système (résumé hebdo, ADR-0004 point 4) --- */

test('etatSysteme_ : heartbeat frais → actif avec l\'âge en minutes', () => {
  const s = ctx.etatSysteme_(T - 12 * 60000, T, SEUIL);
  assert.ok(s.includes('🟢') && s.includes('12 min'));
});

test('etatSysteme_ : au-delà du seuil → silencieux', () => {
  const s = ctx.etatSysteme_(T - (SEUIL + 5 * 60000), T, SEUIL);
  assert.ok(s.includes('🔴') && s.includes('silencieux'));
});

test('etatSysteme_ : jamais de heartbeat → démarrage, pas de faux « silencieux »', () => {
  const s = ctx.etatSysteme_(0, T, SEUIL);
  assert.ok(s.includes('démarrage') && !s.includes('🔴'));
});
