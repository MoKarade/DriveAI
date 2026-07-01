'use strict';
/**
 * Onglet Santé (ADR-0006) + invariant vie privée (ADR-0007) — `majSante_` ne doit écrire
 * QUE des métadonnées : horodatage, COMPTEUR de l'Index (pas les clés), coût agrégé, statut.
 * Jamais un nom de fichier, une clé de cache ou un corps de document.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** PropertiesService mocké : aucune Property (coût du mois = 0). */
function mockProps() {
  return {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
      deleteProperty: () => {},
    }),
  };
}

function chargerAvecSanteMock(indexCache) {
  const ctx = load(['Config.gs', 'Cout.gs', 'Journal.gs'], { PropertiesService: mockProps() });
  const captured = [];
  // feuille_('Santé') mocké : capture l'unique setValues (5 lignes × 1 colonne).
  ctx.feuille_ = () => ({ getRange: () => ({ setValues: (rows) => rows.forEach((r) => captured.push(r[0])) }) });
  if (indexCache !== undefined) ctx._indexCache = indexCache;
  return { ctx, captured };
}

test('majSante_ écrit exactement 5 lignes de métadonnées (une seule écriture Sheet)', () => {
  const { ctx, captured } = chargerAvecSanteMock({ 'a|1': true, 'b|2': true });
  ctx.majSante_();
  assert.strictEqual(captured.length, 5);
  assert.ok(captured.every((l) => typeof l === 'string'));
});

test('majSante_ écrit le COMPTE de l\'Index, jamais les clés (aucune fuite de nom/clé)', () => {
  // Une clé qui ressemble à un nom de fichier sensible : elle ne doit JAMAIS apparaître dans Santé.
  const { ctx, captured } = chargerAvecSanteMock({ 'passeport-secret.pdf|999': true, 'autre': true });
  ctx.majSante_();
  const flat = JSON.stringify(captured);
  assert.ok(!flat.includes('passeport-secret'), 'aucune clé/contenu du cache dans l\'onglet Santé');
  assert.ok(flat.includes('Documents au catalogue (Index) : 2'), 'écrit le compte (2), pas les clés');
});

test('majSante_ : cache non chargé (null) → "—", pas d\'erreur', () => {
  const { ctx, captured } = chargerAvecSanteMock(null);
  assert.doesNotThrow(() => ctx.majSante_());
  assert.ok(JSON.stringify(captured).includes('—'));
});

test('majSante_ : coût affiché à 0.00 $ quand aucune Property (jamais NaN/undefined)', () => {
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligneCout = captured.find((l) => l.indexOf('Coût LLM') === 0);
  assert.ok(ligneCout && ligneCout.includes('0.00 $'), 'coût numérique formaté, pas NaN');
});
