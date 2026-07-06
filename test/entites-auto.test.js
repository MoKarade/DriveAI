'use strict';
/**
 * Auto-validation des entités fréquentes (#18, décision Marc : seuil 3) — l'éligibilité PURE
 * `estAutoValidable_` et l'extension d'`estValidee_` au statut « validée (auto ≥3) ».
 * Gardes figées : jamais une variante, jamais un générique, JAMAIS un domaine protégé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs']);
const PROTEGES = ['04 · Immigration'];
const BASE = {
  entite: 'Hydro-Québec', domaine: '02 · Finances', statut: 'en_attente',
  variante: '', vuNFois: 3,
};

test('estAutoValidable_ : en_attente + vue ≥ 3 + sans variante + non générique + hors zone protégée', () => {
  assert.strictEqual(ctx.estAutoValidable_(BASE, 3, PROTEGES), true);
});

test('estAutoValidable_ : chaque garde refuse indépendamment', () => {
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, vuNFois: 2 }, 3, PROTEGES), false);       // pas assez vue
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, statut: 'validee' }, 3, PROTEGES), false); // déjà validée
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, statut: 'variante de : X' }, 3, PROTEGES), false);
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, variante: 'Desjardins' }, 3, PROTEGES), false); // fusion = Marc
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, entite: 'banque' }, 3, PROTEGES), false);  // générique (lexique #10)
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, domaine: '04 · Immigration' }, 3, PROTEGES), false); // zone protégée
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, vuNFois: undefined }, 3, PROTEGES), false); // défaut = 1
  // Déjà matérialisée un jour (dossierId) : une réédition de Marc vers en_attente PRIME — jamais re-validée.
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, dossierId: 'idX' }, 3, PROTEGES), false);
  // Déjà auto-validée : pas re-éligible (pas de boucle).
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, statut: 'validee (auto ≥3)' }, 3, PROTEGES), false);
  // Zone protégée : la garde tient aussi sur une graphie déviante (normalisée des deux côtés).
  assert.strictEqual(ctx.estAutoValidable_({ ...BASE, domaine: '04 · IMMIGRATION' }, 3, PROTEGES), false);
});

test('round-trip : normaliserCle_ PRODUIT la forme que estValidee_ accepte (contrat cache ↔ Sheet)', () => {
  const libelle = 'Validée (auto ≥3)';
  assert.strictEqual(ctx.normaliserCle_(libelle), 'validee (auto ≥3)');
  assert.strictEqual(ctx.estValidee_(ctx.normaliserCle_(libelle)), true);
});

test('estValidee_ : accepte « validée » ET « validée (auto ≥3) » (formes normalisées incluses)', () => {
  assert.strictEqual(ctx.estValidee_('validee'), true);
  assert.strictEqual(ctx.estValidee_('validée'), true);
  assert.strictEqual(ctx.estValidee_('validee (auto ≥3)'), true);  // forme normalisée du cache
  assert.strictEqual(ctx.estValidee_('validée (auto ≥3)'), true);  // forme brute de la Sheet
  assert.strictEqual(ctx.estValidee_('en_attente'), false);
  assert.strictEqual(ctx.estValidee_('refusée (générique)'), false);
});
