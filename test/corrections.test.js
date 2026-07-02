'use strict';
/**
 * Boucle d'apprentissage (ADR-0003 §3, chantier #5) — sélection few-shot PURE :
 * pertinence par émetteur, top-N borné, formatage du bloc d'exemples. La lecture de l'onglet et
 * l'injection dans le prompt LLM ne sont pas testées ici (effectful) — seule la logique pure l'est.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Corrections.gs réutilise normaliserCle_/tokensEntite_ d'Entites.gs.
const ctx = load(['Config.gs', 'Entites.gs', 'Corrections.gs']);

const metaEDF = { nomFichier: 'facture EDF janvier.pdf', expediteur: 'contact@edf.fr', sujet: 'Votre facture' };

test('scoreCorrection_ : émetteur présent dans le doc → 1 ; absent → 0', () => {
  assert.strictEqual(ctx.scoreCorrection_(metaEDF, { emetteur: 'EDF' }), 1);
  assert.strictEqual(ctx.scoreCorrection_(metaEDF, { emetteur: 'Desjardins' }), 0);
  assert.strictEqual(ctx.scoreCorrection_(metaEDF, { emetteur: '' }), 0);
  assert.strictEqual(ctx.scoreCorrection_({ nomFichier: '', expediteur: '', sujet: '' }, { emetteur: 'EDF' }), 0);
});

test('scoreCorrection_ : recouvrement partiel des jetons d\'émetteur', () => {
  // « Caisse Desjardins » vs un doc qui ne mentionne que « desjardins » → 1 jeton sur 2 = 0.5
  const meta = { nomFichier: 'releve desjardins.pdf', expediteur: 'x@y.com', sujet: '' };
  assert.strictEqual(ctx.scoreCorrection_(meta, { emetteur: 'Caisse Desjardins' }), 0.5);
});

test('correctionsPertinentes_ : ne garde que les pertinents, triés, bornés à maxN', () => {
  const corrections = [
    { emetteur: 'Desjardins', domaine: '02 · Finances' },
    { emetteur: 'EDF', domaine: '03 · Logement & véhicule' },
    { emetteur: 'Hydro-Québec', domaine: '03 · Logement & véhicule' }
  ];
  const r = ctx.correctionsPertinentes_(metaEDF, corrections, 3, ctx.CONFIG.FEWSHOT_SEUIL);
  assert.strictEqual(r.length, 1);        // seul EDF matche ce document
  assert.strictEqual(r[0].emetteur, 'EDF');
});

test('correctionsPertinentes_ : maxN borne le nombre d\'exemples', () => {
  const meta = { nomFichier: 'edf edf edf', expediteur: 'edf', sujet: 'edf' };
  const corrections = [
    { emetteur: 'EDF', domaine: 'A' }, { emetteur: 'edf', domaine: 'B' }, { emetteur: 'E.D.F', domaine: 'C' }
  ];
  const r = ctx.correctionsPertinentes_(meta, corrections, 2, ctx.CONFIG.FEWSHOT_SEUIL);
  assert.strictEqual(r.length, 2); // 3 candidats pertinents, mais borné à 2
});

test('blocFewShot_ : vide si aucune correction ; sinon liste lisible', () => {
  assert.strictEqual(ctx.blocFewShot_([]), '');
  assert.strictEqual(ctx.blocFewShot_(null), '');
  const bloc = ctx.blocFewShot_([{ emetteur: 'EDF', domaine: '03 · Logement & véhicule', entite: 'EDF' }]);
  assert.ok(bloc.indexOf('Émetteur « EDF »') !== -1);
  assert.ok(bloc.indexOf('domaine « 03 · Logement & véhicule »') !== -1);
  assert.ok(bloc.indexOf('entité « EDF »') !== -1);
});

test('cleCorrection_ : normalise pour l\'idempotence (casse/accents/apostrophes)', () => {
  const a = ctx.cleCorrection_({ emetteur: 'EDF', domaine: 'A', categorie: '', entite: 'É', type: '' });
  const b = ctx.cleCorrection_({ emetteur: 'edf', domaine: 'a', categorie: '', entite: 'e', type: '' });
  assert.strictEqual(a, b);
});
