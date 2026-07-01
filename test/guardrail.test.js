'use strict';
/**
 * GARDE-FOU NON NÉGOCIABLE §1 — un fichier ayant un parent dans (ou sous) `04 · Immigration`
 * n'est JAMAIS détaché. `aParentProtege_` / `chaineMonteVersProtege_` (Maintenance.gs) remontent
 * TOUTE la chaîne d'ancêtres (multi-parents inclus). Deux régimes sur lecture impossible :
 *   - strict (re-vérif AVANT mutation) → échoue-FERMÉ (traité protégé → abstention) ;
 *   - non strict (collecte) → échoue-OUVERT (laisse progresser ; re-vérifié strict avant tout déplacement).
 * C'est le cœur du garde-fou : ces tests doivent rester verts quoi qu'il arrive au reste.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, fakeFolder, fakeFile, iter } = require('./harness');

const ctx = load(['Config.gs', 'Maintenance.gs']);
const PROTEGES = { IMM: true }; // ensemble {idDossierProtégé: true} (04 · Immigration)

test('parent direct protégé → protégé', () => {
  const f = fakeFile({ parents: [fakeFolder('IMM')] });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES), true);
});

test('grand-parent protégé (remonte la chaîne) → protégé', () => {
  const imm = fakeFolder('IMM');
  const sous = fakeFolder('sous-dossier', [imm]);
  const f = fakeFile({ parents: [sous] });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES), true);
});

test('multi-parents dont UN protégé → protégé (jamais détaché)', () => {
  const f = fakeFile({ parents: [fakeFolder('autre', [fakeFolder('ROOT')]), fakeFolder('IMM')] });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES), true);
});

test('aucun ancêtre protégé → non protégé', () => {
  const f = fakeFile({ parents: [fakeFolder('X', [fakeFolder('ROOT')])] });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES), false);
});

test('getParents() indisponible : strict → protégé (échoue-fermé, prudence §1)', () => {
  const f = fakeFile({ throwsParents: true });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES, true), true);
});

test('getParents() indisponible : non strict → non protégé (échoue-ouvert, laisse progresser la collecte)', () => {
  const f = fakeFile({ throwsParents: true });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES, false), false);
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES), false); // strict par défaut = undefined → ouvert
});

test('branche d\'ancêtre illisible au milieu de la chaîne : strict → protégé, non strict → non protégé', () => {
  const illisible = fakeFolder('cassé', null, true); // getParents lève
  const f = fakeFile({ parents: [illisible] });
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES, true), true);
  assert.strictEqual(ctx.aParentProtege_(f, PROTEGES, false), false);
});

test('chaineMonteVersProtege_ : bornée à 50 niveaux (anti-cycle/profondeur) — pas de boucle infinie', () => {
  // Chaîne de 60 dossiers non protégés ; le protégé est au-delà de la borne → non trouvé, mais pas de hang.
  let sommet = fakeFolder('IMM'); // protégé, tout en haut (profond)
  for (let i = 0; i < 60; i++) sommet = fakeFolder('n' + i, [sommet]);
  assert.strictEqual(ctx.chaineMonteVersProtege_(sommet, PROTEGES, 0), false);

  // Protégé à faible profondeur (dans la borne) → trouvé.
  const imm = fakeFolder('IMM');
  const proche = fakeFolder('p1', [fakeFolder('p2', [imm])]);
  assert.strictEqual(ctx.chaineMonteVersProtege_(proche, PROTEGES, 0), true);
});

test('cycle de parents (a↔b, itérateurs finis comme un vrai Drive) → borne de profondeur, pas de boucle infinie', () => {
  // Un vrai cycle Drive : chaque dossier a UN parent (itérateur fini d'un élément) qui reboucle.
  // La borne de profondeur (50) coupe la récursion → termine en renvoyant false (aucun protégé trouvé).
  const a = fakeFolder('a');
  const b = fakeFolder('b');
  a.getParents = () => iter([b]);
  b.getParents = () => iter([a]);
  assert.strictEqual(ctx.chaineMonteVersProtege_(a, PROTEGES, 0), false);
});
