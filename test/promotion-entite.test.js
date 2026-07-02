'use strict';
/**
 * C6-04 — `promouvoirEntiteValidee_` (Entites.gs) : une correction de Marc promeut une entité en
 * « validée ». On mocke `feuille_` (comme privacy.test.js) et on injecte le cache d'entités pour
 * tester la logique EFFECTFUL : find-or-create, no-op sans I/O si déjà validée, `en_attente`→`validée`
 * par `setValue`, et mise à jour du cache (anti-double-append).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];

function setup(lignes) {
  const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
  ctx.journalInfo_ = () => {};   // silencieux (sinon appendRow Journal)
  ctx.journalErreur_ = () => {};
  const calls = { feuille: 0, append: [], setValue: [] };
  ctx.feuille_ = () => {
    calls.feuille++;
    return {
      getLastColumn: () => ENTETES.length,
      getLastRow: () => 1 + (lignes ? lignes.length : 0),
      getRange: () => ({
        getValues: () => [ENTETES.slice()],           // en-têtes lus par colonnesEntites_
        setValue: (v) => calls.setValue.push(v),
      }),
      appendRow: (row) => calls.append.push(row),
    };
  };
  // Injecte le cache directement (évite chargerEntitesCache_, qui lirait la Sheet).
  const parCle = {};
  (lignes || []).forEach((l) => { parCle[ctx.cleEntite_(l.domaine, l.entite)] = l; });
  ctx._entitesCache = { lignes: (lignes || []).slice(), parCle };
  return { ctx, calls };
}

test('promouvoirEntiteValidee_ : entité inconnue → append 1 ligne « validée » + cache à jour', () => {
  const { ctx, calls } = setup([]);
  const r = ctx.promouvoirEntiteValidee_({ domaine: '02 · Finances', entite: 'Desjardins' });
  assert.strictEqual(r, true);
  assert.strictEqual(calls.append.length, 1);
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Statut')], 'validée');
  const cle = ctx.cleEntite_('02 · Finances', 'Desjardins');
  assert.strictEqual(ctx._entitesCache.parCle[cle].statut, 'validee'); // normalisé, comme chargerEntitesCache_
});

test('promouvoirEntiteValidee_ : entité en_attente → setValue Statut (aucun append)', () => {
  const ligne = { ligneSheet: 5, entite: 'EDF', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' };
  const { ctx, calls } = setup([ligne]);
  const r = ctx.promouvoirEntiteValidee_({ domaine: '03 · Logement & véhicule', entite: 'EDF' });
  assert.strictEqual(r, true);
  assert.strictEqual(calls.append.length, 0);
  assert.deepStrictEqual([...calls.setValue], ['validée']);
  assert.strictEqual(ligne.statut, 'validee'); // cache mis à jour
});

test('promouvoirEntiteValidee_ : déjà validée → no-op SANS aucune I/O Sheet', () => {
  const ligne = { ligneSheet: 5, entite: 'EDF', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'validee', dossierId: 'xyz' };
  const { ctx, calls } = setup([ligne]);
  const r = ctx.promouvoirEntiteValidee_({ domaine: '03 · Logement & véhicule', entite: 'EDF' });
  assert.strictEqual(r, false);
  assert.strictEqual(calls.feuille, 0);      // n'ouvre même pas la feuille
  assert.strictEqual(calls.append.length, 0);
  assert.strictEqual(calls.setValue.length, 0);
});

test('promouvoirEntiteValidee_ : 2 appels même entité dans le run → 1 seul append', () => {
  const { ctx, calls } = setup([]);
  ctx.promouvoirEntiteValidee_({ domaine: '02 · Finances', entite: 'Desjardins' });
  ctx.promouvoirEntiteValidee_({ domaine: '02 · Finances', entite: 'Desjardins' }); // 2e = no-op (cache validee)
  assert.strictEqual(calls.append.length, 1);
});

test('promouvoirEntiteValidee_ : correction incomplète (domaine manquant) → false, aucune I/O', () => {
  const { ctx, calls } = setup([]);
  assert.strictEqual(ctx.promouvoirEntiteValidee_({ entite: 'EDF' }), false);
  assert.strictEqual(calls.feuille, 0);
});

test('promouvoirEntiteValidee_ : quasi-doublon d\'une entité existante → signalé dans « Variante possible ? »', () => {
  const ligne = { ligneSheet: 2, entite: 'Desjardins', domaine: '02 · Finances', categorie: '', type: '', statut: 'validee', dossierId: 'id1' };
  const { ctx, calls } = setup([ligne]);
  ctx.promouvoirEntiteValidee_({ domaine: '02 · Finances', entite: 'Caisse Desjardins' }); // explicite → créée quand même
  assert.strictEqual(calls.append.length, 1);
  const variante = calls.append[0][ENTETES.indexOf('Variante possible ?')];
  assert.ok(variante && variante.indexOf('Desjardins') !== -1, 'signale le quasi-doublon, sans fusionner');
});
