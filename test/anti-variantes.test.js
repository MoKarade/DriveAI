'use strict';
/**
 * Garde anti-variantes (ADR-0002 §4) — évite les entités quasi-doublons. Logique PURE :
 * jetons significatifs, Jaccard, distance de Levenshtein, similarité combinée, recherche de variante.
 * La fusion reste MANUELLE (1 clic de Marc) — ici on ne teste que la DÉTECTION/suggestion.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs']);

test('tokensEntite_ : jetons significatifs (mots-outils + séparateurs retirés)', () => {
  // Spread → tableau du realm hôte (le résultat vient du bac à sable vm, prototype Array différent).
  assert.deepStrictEqual([...ctx.tokensEntite_('Caisse de Desjardins')], ['caisse', 'desjardins']);
  assert.deepStrictEqual([...ctx.tokensEntite_('Hydro-Québec')], ['hydro', 'quebec']);
  assert.deepStrictEqual([...ctx.tokensEntite_("l'IUT du Littoral")], ['iut', 'littoral']);
});

test('jaccardTokens_ : recouvrement d\'ensembles', () => {
  assert.strictEqual(ctx.jaccardTokens_(['a', 'b'], ['a', 'b']), 1);
  assert.strictEqual(ctx.jaccardTokens_(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.strictEqual(ctx.jaccardTokens_([], []), 0);
  assert.strictEqual(ctx.jaccardTokens_(['a', 'a', 'b'], ['a', 'b']), 1); // doublons comptés une fois
});

test('distanceLevenshtein_ : cas de référence', () => {
  assert.strictEqual(ctx.distanceLevenshtein_('kitten', 'sitting'), 3);
  assert.strictEqual(ctx.distanceLevenshtein_('abc', 'abc'), 0);
  assert.strictEqual(ctx.distanceLevenshtein_('', 'abc'), 3);
  assert.strictEqual(ctx.distanceLevenshtein_('desjardin', 'desjardins'), 1);
});

test('similariteEntite_ : détecte les vraies variantes', () => {
  assert.strictEqual(ctx.similariteEntite_('Desjardins', 'Desjardins'), 1);
  assert.ok(ctx.similariteEntite_('Desjardins', 'Caisse Desjardins') >= 0.6, 'inclusion');
  assert.ok(ctx.similariteEntite_('Hydro Quebec', 'Hydro-Québec') >= 0.9, 'ponctuation/accents');
  assert.ok(ctx.similariteEntite_('Desjardin', 'Desjardins') >= 0.6, 'faute de frappe');
});

test('similariteEntite_ : n\'appaire PAS deux entités distinctes', () => {
  assert.ok(ctx.similariteEntite_('Boulangerie Paul', 'Desjardins') < 0.6);
  // Deux IUT différents ne doivent pas être fusionnés (partagent « iut » mais rien d'autre).
  assert.ok(ctx.similariteEntite_('IUT ULCO', 'IUT Nancy') < 0.6);
});

test('chercherVariante_ : renvoie la meilleure au-dessus du seuil, sinon null', () => {
  const existants = ['Desjardins', 'Hydro-Québec', 'IUT Nancy'];
  const v = ctx.chercherVariante_('Caisse Desjardins', existants, ctx.CONFIG.SEUIL_VARIANTE);
  assert.ok(v && v.nom === 'Desjardins');
  assert.strictEqual(ctx.chercherVariante_('Boulangerie Paul', existants, ctx.CONFIG.SEUIL_VARIANTE), null);
});

test('chercherVariante_ : ignore un libellé strictement identique (= même entité, pas variante)', () => {
  assert.strictEqual(ctx.chercherVariante_('Desjardins', ['Desjardins'], ctx.CONFIG.SEUIL_VARIANTE), null);
  // mais une casse/accent différent EST une variante à signaler (dédup) :
  const v = ctx.chercherVariante_('desjardins', ['Desjardins'], ctx.CONFIG.SEUIL_VARIANTE);
  // normaliserCle rend les deux égaux → identique → ignoré (le parCle gère déjà ce cas exact).
  assert.strictEqual(v, null);
});
