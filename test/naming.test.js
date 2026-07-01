'use strict';
/**
 * Nommage (docs/NAMING.md) — logique pure de Router.gs.
 * Convention : `AAAA-MM-JJ_Type_Émetteur.ext`. L'entité vit dans le CHEMIN, pas dans le nom.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Router.gs']);

test('champ_ : caractères interdits Drive → "-"', () => {
  assert.strictEqual(ctx.champ_('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
});

test('champ_ : underscores internes → "-" (le "_" est réservé au séparateur du nom)', () => {
  assert.strictEqual(ctx.champ_('IUT_ULCO'), 'IUT-ULCO');
  assert.strictEqual(ctx.champ_('Relevé_bancaire'), 'Relevé-bancaire');
});

test('champ_ : trim + valeurs vides/nulles', () => {
  assert.strictEqual(ctx.champ_('  Desjardins  '), 'Desjardins');
  assert.strictEqual(ctx.champ_(null), '');
  assert.strictEqual(ctx.champ_(undefined), '');
  assert.strictEqual(ctx.champ_(''), '');
});

test('champ_ : les accents sont PRÉSERVÉS (nettoyage ≠ translittération)', () => {
  assert.strictEqual(ctx.champ_('Éléctricité'), 'Éléctricité');
});

test('nomNormalise_ : format complet AAAA-MM-JJ_Type_Émetteur.ext', () => {
  assert.strictEqual(
    ctx.nomNormalise_('2026-01-15', 'Facture', 'EDF', '.pdf'),
    '2026-01-15_Facture_EDF.pdf'
  );
});

test('nomNormalise_ : défauts prudents quand type/émetteur manquent', () => {
  assert.strictEqual(ctx.nomNormalise_('2026-01-15', '', '', '.pdf'), '2026-01-15_Document_Inconnu.pdf');
  assert.strictEqual(ctx.nomNormalise_('2026-01-15', null, null, ''), '2026-01-15_Document_Inconnu');
});

test('nomNormalise_ : type/émetteur nettoyés (pas d\'underscore parasite qui casserait le parsing)', () => {
  // « Relevé_bancaire » nettoyé en « Relevé-bancaire » → un seul "_" structurel de chaque côté.
  assert.strictEqual(
    ctx.nomNormalise_('2026-03-01', 'Relevé_bancaire', 'Banque/Nationale', '.pdf'),
    '2026-03-01_Relevé-bancaire_Banque-Nationale.pdf'
  );
});

test('extension_ : dernière extension, casse préservée', () => {
  assert.strictEqual(ctx.extension_('photo.JPG'), '.JPG');
  assert.strictEqual(ctx.extension_('archive.tar.gz'), '.gz');
  assert.strictEqual(ctx.extension_('doc.pdf'), '.pdf');
});

test('extension_ : aucune extension → ""', () => {
  assert.strictEqual(ctx.extension_('IMG_2734'), '');
  assert.strictEqual(ctx.extension_(''), '');
  assert.strictEqual(ctx.extension_(null), '');
});

test('cheminLisible_ : Domaine[/Catégorie]', () => {
  assert.strictEqual(ctx.cheminLisible_({ domaine: '02 · Finances', categorie: 'Impôts' }), '02 · Finances/Impôts');
  assert.strictEqual(ctx.cheminLisible_({ domaine: '02 · Finances' }), '02 · Finances');
  assert.strictEqual(ctx.cheminLisible_({ domaine: '', categorie: '' }), 'Domaine ?');
});
