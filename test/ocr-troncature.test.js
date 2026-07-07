'use strict';
/**
 * `extraireTexte_` (Ocr.gs) : borne de troncature. C26-07 (ADR-0015) a besoin de répliquer la
 * troncature v2 (12000 car., ANALYSE_V2_OCR_MAX_CARS) SANS activer `CONFIG.ANALYSE_V2` — le flag
 * pilote aussi le flux vivant, et le dry-run ne doit jamais y toucher. Le paramètre optionnel
 * `maxCarsOverride` permet ça, sans changer le comportement des appelants existants (omis).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function fakeBlobTexte(texte) {
  return { getContentType: () => 'text/plain', getDataAsString: () => texte, getName: () => 'note.txt' };
}

test('extraireTexte_ : sans override, ANALYSE_V2 OFF → borne historique (LLM_OCR_MAX_CARS)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = false;
  ctx.CONFIG.LLM_OCR_MAX_CARS = 10;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 100;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)));
  assert.strictEqual(r.length, 10);
});

test('extraireTexte_ : override explicite → prime sur le flag, même quand ANALYSE_V2 est OFF (dry-run C26-07)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = false; // le flux vivant reste Haiku — le dry-run ne le touche jamais
  ctx.CONFIG.LLM_OCR_MAX_CARS = 10;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)), 30);
  assert.strictEqual(r.length, 30, 'override respecté, PAS la borne historique (10)');
});

test('extraireTexte_ : sans override, ANALYSE_V2 ON → borne v2 inchangée (comportement existant)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = true;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 25;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)));
  assert.strictEqual(r.length, 25);
});
