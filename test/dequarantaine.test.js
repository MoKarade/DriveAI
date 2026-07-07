'use strict';
/**
 * DÉ-QUARANTAINE (R3) — le tick appelle le NOYAU `dequarantainerLignes_('drive|')` :
 *   - JAMAIS `dequarantaine()` (son tickDriveAI() final serait RÉENTRANT depuis le tick : le
 *     finally du tick imbriqué relâche le verrou → anti-chevauchement neutralisé — bloquant
 *     des 3 revues R3) ;
 *   - clés `drive|` seulement : une clé Gmail/partage hors fenêtre serait libérée « dans le
 *     vide » (la source ne la re-présentera jamais) ET disparaîtrait de la liste Relancer de
 *     l'app — le clic MANUEL, lui, libère tout (geste assumé) ;
 *   - compteurs Échecs purgés AVANT les lignes Index : une coupure au milieu laisse le doc
 *     quarantainé (re-run répare) ; l'inverse laisserait un compteur orphelin à 3 →
 *     re-quarantaine au 1ᵉʳ échec transitoire.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** Faux onglet Sheet : lignes 2..n ; capture les deleteRow dans une séquence PARTAGÉE. */
function fauxOnglet(nom, lignes, sequence) {
  return {
    getLastRow: () => lignes.length + 1,
    getRange: (l, c, n, w) =>
      ({ getValues: () => lignes.slice(l - 2, l - 2 + n).map((r) => r.slice(c - 1, c - 1 + w)) }),
    deleteRow: (i) => sequence.push([nom, i]),
  };
}

function ctxQuarantaine(lignesIndex, lignesEchecs) {
  const sequence = [];
  const onglets = {
    Index: fauxOnglet('Index', lignesIndex, sequence),
    'Échecs': fauxOnglet('Échecs', lignesEchecs || [], sequence),
  };
  const ctx = load(['Config.gs', 'Maintenance.gs']);
  ctx.feuille_ = (nom) => onglets[nom];
  ctx.reinitialiserIndexCache_ = () => sequence.push(['cache', 0]);
  return { ctx, sequence };
}

// Ligne Index : A=Clé … F=Statut (6 colonnes lues).
const ligne = (cle, statut) => [cle, '', '', '', '', statut];

test('dequarantainerLignes_(\'drive|\') : ne libère QUE les clés drive| en quarantaine', () => {
  const { ctx, sequence } = ctxQuarantaine([
    ligne('drive|a', 'quarantaine'),   // ligne 2 → libérée
    ligne('m|1|x.pdf|9', 'quarantaine'), // ligne 3 → clé Gmail : reste visible/relançable
    ligne('drive|b', 'classé'),        // ligne 4 → pas en quarantaine
    ligne('drive|c', 'quarantaine'),   // ligne 5 → libérée
  ], [['drive|a'], ['m|1|x.pdf|9'], ['drive|c']]); // Échecs lignes 2, 3, 4
  const n = ctx.dequarantainerLignes_('drive|');
  assert.strictEqual(n, 2);
  const index = sequence.filter(([o]) => o === 'Index').map(([, i]) => i);
  const echecs = sequence.filter(([o]) => o === 'Échecs').map(([, i]) => i);
  assert.deepStrictEqual(index, [5, 2], 'lignes Index drive| seulement, ordre décroissant');
  assert.deepStrictEqual(echecs, [4, 2], 'compteurs Échecs des clés libérées seulement');
});

test('dequarantainerLignes_ : Échecs purgé AVANT Index, cache invalidé en fin', () => {
  const { ctx, sequence } = ctxQuarantaine(
    [ligne('drive|a', 'quarantaine')], [['drive|a']]);
  ctx.dequarantainerLignes_('drive|');
  const ordres = sequence.map(([o]) => o);
  assert.ok(ordres.indexOf('Échecs') < ordres.indexOf('Index'),
    'l\'état « quarantainé » (Index) tombe en DERNIER — une coupure laisse un re-run réparer');
  assert.strictEqual(ordres[ordres.length - 1], 'cache', 'caches Index/Échecs invalidés (lignes supprimées)');
});

test('dequarantainerLignes_ sans préfixe (manuel) : libère tout, renvoie le compte', () => {
  const { ctx, sequence } = ctxQuarantaine([
    ligne('drive|a', 'quarantaine'),
    ligne('m|1|x.pdf|9', 'quarantaine'),
  ]);
  assert.strictEqual(ctx.dequarantainerLignes_(), 2);
  assert.strictEqual(sequence.filter(([o]) => o === 'Index').length, 2);
});

test('dequarantainerLignes_ : rien en quarantaine → 0, journalisé, aucune écriture', () => {
  const { ctx, sequence } = ctxQuarantaine([ligne('drive|a', 'classé')]);
  assert.strictEqual(ctx.dequarantainerLignes_('drive|'), 0);
  assert.deepStrictEqual(sequence, []);
  assert.ok(ctx.__logs.some(([, src, msg]) => src === 'Maintenance' && /Aucun document/.test(msg)));
});

test('dequarantaine() (manuel) : noyau PUIS relance du pipeline — jamais l\'inverse ni sans libération', () => {
  const ctx = load(['Config.gs', 'Maintenance.gs']);
  const appels = [];
  ctx.dequarantainerLignes_ = () => { appels.push('noyau'); return 2; };
  ctx.tickDriveAI = () => appels.push('tick');
  ctx.dequarantaine();
  assert.deepStrictEqual(appels, ['noyau', 'tick']);

  appels.length = 0;
  ctx.dequarantainerLignes_ = () => { appels.push('noyau'); return 0; };
  ctx.dequarantaine();
  assert.deepStrictEqual(appels, ['noyau'], 'rien libéré → pas de tick à vide');
});
