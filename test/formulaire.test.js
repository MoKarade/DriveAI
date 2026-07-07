'use strict';
/**
 * Canal de correction (ADR-0003 §1, chantier #6) — logique PURE :
 * conversion d'une réponse de formulaire en correction + liste des domaines proposés. La création du
 * formulaire et la lecture des réponses (FormApp) sont effectful → non testées ici.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Formulaire.gs']);

test('domainesPourFormulaire_ : domaines de config + auto (Santé, Voyages), triés', () => {
  const doms = [...ctx.domainesPourFormulaire_()]; // realm hôte pour comparer
  assert.ok(doms.indexOf('07 · Santé') !== -1, 'inclut Santé (auto-créé)');
  assert.ok(doms.indexOf('09 · Voyages') !== -1, 'inclut Voyages (auto-créé, refonte)');
  assert.ok(doms.indexOf('01 · Administratif & identité') !== -1);
  assert.strictEqual(doms.length, Object.keys(ctx.CONFIG.DOMAINES).length + ctx.CONFIG.DOMAINES_AUTO.length);
  const sorted = [...doms].sort();
  assert.deepStrictEqual(doms, sorted);
});

test('reponseVersCorrection_ : réponse complète → correction', () => {
  const champs = {
    [ctx.FORM_Q_EMETTEUR]: 'EDF',
    [ctx.FORM_Q_DOMAINE]: '03 · Logement & véhicule',
    [ctx.FORM_Q_ENTITE]: 'EDF',
    [ctx.FORM_Q_FICHIER]: 'facture janvier.pdf'
  };
  const c = ctx.reponseVersCorrection_(champs);
  assert.strictEqual(c.emetteur, 'EDF');
  assert.strictEqual(c.domaine, '03 · Logement & véhicule');
  assert.strictEqual(c.entite, 'EDF');
  assert.strictEqual(c.fichier, 'facture janvier.pdf');
});

test('reponseVersCorrection_ : émetteur seul → correction minimale (autres champs vides)', () => {
  const c = ctx.reponseVersCorrection_({ [ctx.FORM_Q_EMETTEUR]: 'Desjardins' });
  assert.strictEqual(c.emetteur, 'Desjardins');
  assert.strictEqual(c.domaine, '');
  assert.strictEqual(c.entite, '');
});

test('reponseVersCorrection_ : sans émetteur (clé few-shot) → null', () => {
  assert.strictEqual(ctx.reponseVersCorrection_({ [ctx.FORM_Q_DOMAINE]: '02 · Finances' }), null);
  assert.strictEqual(ctx.reponseVersCorrection_({ [ctx.FORM_Q_EMETTEUR]: '   ' }), null); // trim
  assert.strictEqual(ctx.reponseVersCorrection_(null), null);
  assert.strictEqual(ctx.reponseVersCorrection_({}), null);
});

test('reponseVersCorrection_ : trim les espaces parasites', () => {
  const c = ctx.reponseVersCorrection_({ [ctx.FORM_Q_EMETTEUR]: '  Hydro-Québec  ', [ctx.FORM_Q_DOMAINE]: ' 03 · Logement & véhicule ' });
  assert.strictEqual(c.emetteur, 'Hydro-Québec');
  assert.strictEqual(c.domaine, '03 · Logement & véhicule');
});
