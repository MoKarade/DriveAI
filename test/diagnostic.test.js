'use strict';
/**
 * diagnostic.test.js — verrouille la LOGIQUE PURE du diagnostic un-clic (Diagnostic.gs) :
 * formatage lisible, décompte du plan (par action + travail restant après le curseur), et
 * comptage de vrac borné/dégradé. Les chemins I/O lourds (`etatCampagnesRangement`) restent
 * couverts par le filet de SURFACE (existence) — ici on prouve la DÉCISION.
 */
const test = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

/** Faux onglet PlanConsolidation : `actions` = colonne Action des lignes de données (hors en-tête). */
function fakeFeuillePlan(actions) {
  return {
    getLastRow: () => actions.length + 1, // +1 pour la ligne d'en-têtes
    getRange: (ligne, col, nbLignes /* , nbCols */) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nbLignes; i++) out.push([actions[i]]);
        return out;
      },
    }),
  };
}

/** Faux Spreadsheet d'état : `getSheetByName('PlanConsolidation')` → onglet (ou null si absent).
 *  `statPlanConsolidation_` lit STRICTEMENT via `getSheetEtat_().getSheetByName` (jamais `feuille_`,
 *  qui créerait les onglets manquants) — le mock reflète ce contrat lecture seule. */
function fakeSheetEtat(actionsOuNull) {
  return { getSheetByName: (nom) => (nom === 'PlanConsolidation' && actionsOuNull !== null ? fakeFeuillePlan(actionsOuNull) : null) };
}

test('minutesLisibles_ : ms → minutes lisibles (1 décimale)', () => {
  const ctx = load(['Diagnostic.gs']);
  assert.strictEqual(ctx.minutesLisibles_(0), '0 min');
  assert.strictEqual(ctx.minutesLisibles_(6 * 60 * 1000), '6 min');   // 360000 ms → 6
  assert.strictEqual(ctx.minutesLisibles_(90 * 1000), '1.5 min');     // 90000 ms → 1.5
  assert.strictEqual(ctx.minutesLisibles_(12 * 60 * 1000), '12 min'); // budget conso typique
});

test('statPlanConsolidation_ : décompte par action + restant à appliquer (curseur en tête)', () => {
  const actions = ['Déplacer', 'Déplacer', 'OK', 'Doublon', 'Ignoré', 'Déplacer'];
  const ctx = load(['Diagnostic.gs'], { getSheetEtat_: () => fakeSheetEtat(actions) });
  const r = ctx.statPlanConsolidation_(1); // 1 = ligne d'en-têtes ⇒ tout est « après le curseur »
  assert.strictEqual(r.total, 6);
  assert.strictEqual(r.deplacer, 3);
  assert.strictEqual(r.doublon, 1);
  assert.strictEqual(r.ok, 1);
  assert.strictEqual(r.ignore, 1);
  assert.strictEqual(r.restantAAppliquer, 4); // 3 Déplacer + 1 Doublon, tous non encore exécutés
});

test('statPlanConsolidation_ : le curseur exclut les lignes DÉJÀ exécutées du « restant »', () => {
  // Lignes physiques : 2 Déplacer, 3 Déplacer, 4 OK, 5 Doublon, 6 Ignoré, 7 Déplacer.
  const actions = ['Déplacer', 'Déplacer', 'OK', 'Doublon', 'Ignoré', 'Déplacer'];
  const ctx = load(['Diagnostic.gs'], { getSheetEtat_: () => fakeSheetEtat(actions) });
  const r = ctx.statPlanConsolidation_(4); // lignes 2-4 déjà consommées
  // Restant à appliquer après la ligne 4 : Doublon(5) + Déplacer(7) = 2 (l'Ignoré(6) ne compte pas).
  assert.strictEqual(r.restantAAppliquer, 2);
  assert.strictEqual(r.deplacer, 3); // le décompte GLOBAL par action reste sur tout le plan
});

test('statPlanConsolidation_ : plan vide (seulement l\'en-tête) ⇒ zéros', () => {
  const ctx = load(['Diagnostic.gs'], { getSheetEtat_: () => fakeSheetEtat([]) });
  const r = ctx.statPlanConsolidation_(1);
  // Champ par champ (objet créé DANS le contexte vm → prototype d'un autre realm : deepStrictEqual
  // échoue sur l'identité de prototype même à structure identique — patron du harness).
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.deplacer, 0);
  assert.strictEqual(r.doublon, 0);
  assert.strictEqual(r.ok, 0);
  assert.strictEqual(r.ignore, 0);
  assert.strictEqual(r.restantAAppliquer, 0);
});

test('statPlanConsolidation_ : onglet PlanConsolidation ABSENT ⇒ zéros (lecture stricte, rien créé)', () => {
  // getSheetByName renvoie null : la fonction NE DOIT PAS planter ni tenter de créer l'onglet.
  const ctx = load(['Diagnostic.gs'], { getSheetEtat_: () => fakeSheetEtat(null) });
  const r = ctx.statPlanConsolidation_(1);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.restantAAppliquer, 0);
});

test('compterVracRacineDomaine_ : compte, tronque au plafond, dégrade à 0 si illisible', () => {
  const vingt = new Array(20).fill(0);
  const mille1 = new Array(1001).fill(0);
  const ctx = load(['Diagnostic.gs'], {
    DriveApp: {
      getFolderById: (id) => {
        if (id === 'boom') throw new Error('dossier illisible (blip Google)');
        return { getFiles: () => iter(id === 'plein' ? mille1 : vingt) };
      },
    },
  });
  const ok = ctx.compterVracRacineDomaine_('ok');
  assert.strictEqual(ok.n, 20); assert.strictEqual(ok.tronque, false);
  const plein = ctx.compterVracRacineDomaine_('plein');
  assert.strictEqual(plein.n, 1000); assert.strictEqual(plein.tronque, true); // plafond 1000, marqué « 1000+ »
  const boom = ctx.compterVracRacineDomaine_('boom');
  assert.strictEqual(boom.n, 0); assert.strictEqual(boom.tronque, false); // illisible ⇒ 0, jamais un plantage
});
