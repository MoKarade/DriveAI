'use strict';
/**
 * test/fileImport.test.js — la FILE D'IMPORT publiée en Santé (C49-23).
 *
 * Marc, le 21/09 : « fil d'attente pour import et fil d'attente pour lecture ». La seconde
 * existait déjà en chiffres (`Lecture — file`) ; la première n'existait que dans DEUX phrases
 * françaises, donc dans une forme que l'app n'a pas le droit de lire.
 *
 * Ce que ces cas défendent :
 *   1. la cible est `classees` du périmètre, JAMAIS `candidats` ni `lues` — trois nombres
 *      voisins dans le même champ, et deux d'entre eux répondent à une autre question ;
 *   2. un périmètre jamais mesuré rend un MOTIF, jamais « N/0 » — une jauge pleine sur un
 *      comptage qui n'a pas eu lieu ;
 *   3. le format encodé est celui que l'app parse : `<poussés>/<cible>`.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'Memoire.gs']);
}

/** Une Property de périmètre RÉELLE, telle que `encoderPerimetrePiece_` l'écrit. */
const PERIMETRE = [
  '2026-09-17T17:27:00.000Z', 'c49-4-b',
  '3972/4240/26550',          // candidats / classées / lignes d'Index
  '268',
  '06=1169,02=976',
  'pdf=3000',
  '734',
  '04=23,01=87'
].join('|');

test('C49-23 : la cible est le nombre de documents CLASSÉS, pas les candidats', () => {
  const c = ctx();
  // ⚠️ Le cas qui discrimine : les trois nombres du champ sont distincts, donc lire le mauvais
  // se voit. Avec `3972/3972/3972` ce test passerait quel que soit l'indice choisi.
  assert.strictEqual(c.cibleImportMemoire_(PERIMETRE), 4240);
  assert.strictEqual(c.ligneFileImport_(2731, PERIMETRE), '2731/4240');
});

test('C49-23 : un périmètre jamais mesuré rend un motif, jamais un dénominateur inventé', () => {
  const c = ctx();
  assert.strictEqual(c.cibleImportMemoire_(''), null);
  const ligne = c.ligneFileImport_(2731, '');
  assert.ok(/cible non mesurée/.test(ligne), ligne);
  // Le point qui compte : rien qui ressemble à un couple parsable, donc aucune jauge affichée.
  assert.ok(!/^\d+\/\d+$/.test(ligne), ligne);
});

test('C49-23 : une cible à zéro ou illisible se comporte comme une cible absente', () => {
  const c = ctx();
  const zero = PERIMETRE.replace('3972/4240/26550', '0/0/0');
  assert.strictEqual(c.cibleImportMemoire_(zero), null);
  const casse = PERIMETRE.replace('3972/4240/26550', 'trois-mille/?/x');
  assert.strictEqual(c.cibleImportMemoire_(casse), null);
});

test('C49-23 : un compteur de poussés absent ou négatif vaut zéro, jamais du texte', () => {
  const c = ctx();
  assert.strictEqual(c.ligneFileImport_(undefined, PERIMETRE), '0/4240');
  assert.strictEqual(c.ligneFileImport_(-5, PERIMETRE), '0/4240');
  assert.strictEqual(c.ligneFileImport_('2731', PERIMETRE), '2731/4240');
});

test('C49-23 : la ligne est bien celle que la Santé publie', () => {
  const c = ctx();
  // Le CÂBLAGE, pas la fonction : une fonction juste qu'aucune ligne n'appelle est une
  // intention jamais livrée (leçon C28-137).
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  assert.ok(src.indexOf("'Import — file : ' + texteSanteFileImport_()") !== -1,
    'la ligne « Import — file » doit être écrite par majSante_');
  assert.strictEqual(typeof c.texteSanteFileImport_, 'function');
});
