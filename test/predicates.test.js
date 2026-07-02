'use strict';
/**
 * Prédicats de collecte du grand rangement (Maintenance.gs).
 *  - `estAReclasserLeger_` (nom + mime seulement) : recensement de la barre — doit CONVERGER
 *    (un fichier déjà renommé `AAAA-MM-JJ_` n'est jamais re-collecté → sinon re-OCR/LLM en boucle).
 *  - `estAReclasser_` : collecte réelle = léger + garde zone protégée §1.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, fakeFolder, fakeFile } = require('./harness');

const ctx = load(['Config.gs', 'Maintenance.gs']);
ctx.indexContient_ = () => false; // Index vide par défaut (P3 : cf. test dédié)
const PROTEGES = { IMM: true };

test('estAReclasserLeger_ : un fichier déjà renommé AAAA-MM-JJ_ n\'est PAS re-collecté (convergence)', () => {
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: '2026-01-15_Facture_EDF.pdf' })), false);
});

test('estAReclasserLeger_ : fichier « en vrac » (nom quelconque) → à reclasser', () => {
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'scan001.pdf' })), true);
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'IMG_2734.jpg', mime: 'image/jpeg' })), true);
});

test('estAReclasserLeger_ : fichier Google natif / raccourci → ignoré (pas de blob exploitable)', () => {
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'Notes', mime: 'application/vnd.google-apps.document' })), false);
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'lien', mime: 'application/vnd.google-apps.shortcut' })), false);
});

test('estAReclasser_ : idem léger MAIS un fichier sous zone protégée est écarté (§1)', () => {
  const protege = fakeFile({ name: 'passeport-scan.pdf', parents: [fakeFolder('IMM')] });
  assert.strictEqual(ctx.estAReclasser_(protege, PROTEGES), false);
});

test('estAReclasser_ : fichier normal hors zone protégée → à reclasser', () => {
  const normal = fakeFile({ name: 'scan001.pdf', parents: [fakeFolder('X', [fakeFolder('ROOT')])] });
  assert.strictEqual(ctx.estAReclasser_(normal, PROTEGES), true);
});

test('estAReclasser_ : déjà renommé → false même hors zone protégée (convergence prioritaire)', () => {
  const deja = fakeFile({ name: '2026-02-02_Relevé_Desjardins.pdf', parents: [fakeFolder('X')] });
  assert.strictEqual(ctx.estAReclasser_(deja, PROTEGES), false);
});


test('P3 (#11) : un fichier déjà TRAITÉ (clé drive| à l\'Index) n\'est JAMAIS re-collecté', () => {
  const { fakeFile } = require('./harness');
  const avant = ctx.indexContient_;
  ctx.indexContient_ = (cle) => cle === 'drive|DEJA';
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ id: 'DEJA', name: 'IMG_0001.jpg' })), false);
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ id: 'NEUF', name: 'IMG_0002.jpg' })), true);
  ctx.indexContient_ = avant;
});
