'use strict';
/**
 * test/historique-import.test.js — la SÉRIE de l'avancement (demande Marc, 21/09/2026).
 *
 * ⚠️⚠️ POURQUOI CE FICHIER EXISTE. L'onglet est APPEND-ONLY : une valeur fausse écrite ici ne se
 * corrige JAMAIS, contrairement à Progression et Santé qui se réécrivent à chaque tick. Les deux
 * cas qui comptent ne sont donc pas « le bon nombre s'écrit » mais « le faux nombre ne s'écrit
 * pas » : un `restants` inconnu reste VIDE (0 dirait « c'est fini », et une courbe qui touche
 * l'axe ne se distingue pas d'une courbe sans point), et un compteur absent vaut 0 sans jamais
 * rendre la ligne NaN.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'HistoriqueImport.gs']);
}

const CUMUL = { faits: 77, acceptees: 70, illisibles: 4, sansTexte: 29, echecs: 2 };

test('une seule ligne par jour — la série se lit en jours, pas en ticks', () => {
  const c = ctx();
  assert.strictEqual(c.doitEcrireHistoriqueImport_('', '2026/09/21'), true);
  assert.strictEqual(c.doitEcrireHistoriqueImport_('2026/09/20', '2026/09/21'), true);
  assert.strictEqual(c.doitEcrireHistoriqueImport_('2026/09/21', '2026/09/21'), false,
    '288 lignes par jour rendraient l\'onglet illisible sans rien apprendre de plus');
  // Un jour COURANT vide est une panne d'horloge : on n'écrit rien plutôt qu'une ligne sans date.
  assert.strictEqual(c.doitEcrireHistoriqueImport_('2026/09/20', ''), false);
});

test('⚠️ « JE NE SAIS PAS » NE S\'ÉCRIT PAS ZÉRO', () => {
  const c = ctx();
  const inconnu = c.ligneHistoriqueImport_('2026/09/21', CUMUL, null, 'c49-5-b');
  assert.strictEqual(inconnu[1], '',
    'un 0 dirait « terminé » dans un journal qui ne se corrige jamais');
  // Et un zéro MESURÉ, lui, s'écrit : c'est ce qui distingue « fini » de « on ne sait pas ».
  const fini = c.ligneHistoriqueImport_('2026/09/21', CUMUL, 0, 'c49-5-b');
  assert.strictEqual(fini[1], 0);
  // Une valeur illisible retombe du côté « je ne sais pas », jamais sur un nombre inventé.
  assert.strictEqual(c.ligneHistoriqueImport_('2026/09/21', CUMUL, 'douze', 'c49-5-b')[1], '');
});

test('un compteur ABSENT vaut zéro — jamais NaN, qui contaminerait la ligne', () => {
  const c = ctx();
  const l = c.ligneHistoriqueImport_('2026/09/21', { faits: 5 }, 3, 'c49-5-b');
  assert.deepStrictEqual(Array.from(l), ['2026/09/21', 3, 5, 0, 0, 0, 0, 'c49-5-b']);
  const vide = c.ligneHistoriqueImport_('2026/09/21', null, null, '');
  assert.deepStrictEqual(Array.from(vide), ['2026/09/21', '', 0, 0, 0, 0, 0, '']);
});

test('⚠️ LE TAG EST DANS LA LIGNE, et sans lui la série ment', () => {
  const c = ctx();
  // Bumper le tag de campagne remet les cumuls à zéro (la liste des faits est écrite SOUS le
  // tag). Une série sans cette colonne montrerait une CHUTE VERTICALE inexplicable là où il n'y
  // a eu qu'un changement de périmètre — et personne ne pourrait le savoir en la relisant.
  const avant = c.ligneHistoriqueImport_('2026/09/20', CUMUL, 110, 'c49-5-a');
  const apres = c.ligneHistoriqueImport_('2026/09/21', { faits: 0 }, 1086, 'c49-5-b');
  assert.strictEqual(avant[7], 'c49-5-a');
  assert.strictEqual(apres[7], 'c49-5-b');
  assert.ok(apres[2] < avant[2], 'le cumul redescend : c\'est le tag qui l\'explique');
});

test('la ligne a EXACTEMENT les colonnes de l\'en-tête', () => {
  const c = load(['Config.gs', 'Journal.gs', 'HistoriqueImport.gs']);
  const l = c.ligneHistoriqueImport_('2026/09/21', CUMUL, 12, 'c49-5-b');
  assert.strictEqual(l.length, c.COLONNES_HISTORIQUE_IMPORT.length,
    'une ligne plus courte ou plus longue que son en-tête décale TOUTES les colonnes suivantes, '
    + 'et l\'app les lit par index');
});
