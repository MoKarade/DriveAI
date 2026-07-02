'use strict';
/**
 * C15 (ADR-0011) — relances de quarantaine pilotées par la Sheet : l'app APPEND une demande
 * (onglet Relances), le MOTEUR consomme au tick — retire la ligne Index « quarantaine » de la
 * clé demandée + son compteur Échecs + la demande. Jamais une ligne d'un AUTRE statut.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctxRelances(relances, index, echecs) {
  const c = load(['Config.gs', 'Maintenance.gs']);
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.indexContient_ = () => false;
  const calls = { suppr: { Index: [], 'Échecs': [] }, deleteRows: [] };
  const feuilles = {
    Relances: {
      getLastRow: () => 1 + relances.length,
      getRange: () => ({ getValues: () => relances }),
      deleteRows: (debut, n) => calls.deleteRows.push({ debut, n }),
    },
    Index: {
      getLastRow: () => 1 + index.length,
      getRange: () => ({ getValues: () => index }),
      deleteRow: (l) => calls.suppr.Index.push(l),
    },
    'Échecs': {
      getLastRow: () => 1 + echecs.length,
      getRange: () => ({ getValues: () => echecs }),
      deleteRow: (l) => calls.suppr['Échecs'].push(l),
    },
  };
  c.feuille_ = (nom) => feuilles[nom];
  return { c, calls };
}

test('relance : ligne Index QUARANTAINE de la clé retirée + compteur Échecs + demande consommée', () => {
  const { c, calls } = ctxRelances(
    [['drive|Q1'], ['drive|ABSENTE']],
    [
      ['drive|Q1', '', 'a.pdf', '', '', 'quarantaine'],
      ['drive|Q1', '', 'a.pdf', '02', 'x', 'classé'],     // même clé mais statut ≠ quarantaine → intouchée
      ['drive|AUTRE', '', 'b.pdf', '', '', 'quarantaine'], // non demandée → intouchée
    ],
    [['drive|Q1'], ['drive|AUTRE']],
  );
  c.appliquerRelancesQuarantaine_(() => false);
  assert.deepStrictEqual(calls.suppr.Index, [2]);            // seule la ligne quarantaine demandée
  assert.deepStrictEqual(calls.suppr['Échecs'], [2]);        // compteur remis à zéro
  assert.deepStrictEqual(calls.deleteRows, [{ debut: 2, n: 2 }]); // demandes consommées
});

test('relance : budget épuisé → AUCUNE mutation (demandes conservées, reprise au tick suivant)', () => {
  const { c, calls } = ctxRelances([['drive|Q1']], [['drive|Q1', '', 'a.pdf', '', '', 'quarantaine']], []);
  c.appliquerRelancesQuarantaine_(() => true);
  assert.strictEqual(calls.suppr.Index.length, 0);
  assert.strictEqual(calls.deleteRows.length, 0);
});

test('relance : onglet vide → no-op total', () => {
  const { c, calls } = ctxRelances([], [], []);
  c.appliquerRelancesQuarantaine_(() => false);
  assert.strictEqual(calls.deleteRows.length, 0);
});
