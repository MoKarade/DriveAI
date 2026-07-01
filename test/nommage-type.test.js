'use strict';
/**
 * Nommage PAR TYPE de document (ADR-0002 §6) — `nomParType_` / `schemaNommage_` / `tronquerDate_`.
 * La granularité de date et le libellé s'adaptent au type ; un type inconnu retombe sur le format
 * historique (jour). Logique pure, testée contre la table de l'ADR.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const D = '2024-03-15'; // une date de référence complète

test('relevé bancaire → mensuel, libellé « Relevé »', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Relevé bancaire', 'Desjardins', '.pdf'), '2024-03_Relevé_Desjardins.pdf');
  assert.strictEqual(ctx.nomParType_(D, 'Relevé', 'CIC', ''), '2024-03_Relevé_CIC');
});

test('bulletin de paie → mensuel, libellé « Paie »', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Bulletin de paie', 'Robovic', '.pdf'), '2024-03_Paie_Robovic.pdf');
});

test('diplôme / relevé de notes → annuel (et « relevé de notes » ne tombe PAS dans « relevé » mensuel)', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Diplôme', 'IUT ULCO', '.pdf'), '2024_Diplôme_IUT ULCO.pdf');
  assert.strictEqual(ctx.nomParType_(D, 'Relevé de notes', 'IUT ULCO', '.pdf'), '2024_Relevé de notes_IUT ULCO.pdf');
});

test('impôt / avis → annuel', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Avis d\'imposition', 'Revenu Québec', '.pdf'), '2024_Avis d\'imposition_Revenu Québec.pdf');
});

test('CV → annuel, libellé « CV »', () => {
  assert.strictEqual(ctx.nomParType_('2024-09-01', 'CV', 'Marc Richard', '.pdf'), '2024_CV_Marc Richard.pdf');
});

test('facture → jour (défaut historique)', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Facture', 'Hydro-Québec', '.pdf'), '2024-03-15_Facture_Hydro-Québec.pdf');
});

test('type inconnu → format historique jour, jamais un blocage', () => {
  assert.strictEqual(ctx.nomParType_(D, 'Attestation', 'Ville de Montréal', '.pdf'), '2024-03-15_Attestation_Ville de Montréal.pdf');
  // Défauts prudents conservés :
  assert.strictEqual(ctx.nomParType_(D, '', '', '.pdf'), '2024-03-15_Document_Inconnu.pdf');
});

test('schemaNommage_ : priorité des règles (releve de notes AVANT releve)', () => {
  assert.strictEqual(ctx.schemaNommage_('Relevé de notes').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('Relevé bancaire').gran, 'mois');
  assert.strictEqual(ctx.schemaNommage_('Relevé bancaire').label, 'Relevé');
  assert.strictEqual(ctx.schemaNommage_('Facture').gran, 'jour');
  assert.strictEqual(ctx.schemaNommage_('truc inconnu').label, undefined);
});

test('tronquerDate_ : granularités', () => {
  assert.strictEqual(ctx.tronquerDate_('2024-03-15', 'annee'), '2024');
  assert.strictEqual(ctx.tronquerDate_('2024-03-15', 'mois'), '2024-03');
  assert.strictEqual(ctx.tronquerDate_('2024-03-15', 'jour'), '2024-03-15');
});

/* --- Compléments demandés par la revue (naming-validator + code-reviewer) --- */

test('« Relevé de compte » → mensuel (piège de priorité, pas annuel)', () => {
  assert.strictEqual(ctx.schemaNommage_('Relevé de compte').gran, 'mois');
  assert.strictEqual(ctx.schemaNommage_('Relevé de compte').label, 'Relevé');
});

test('casse / accents indifférents (normaliserCle_)', () => {
  assert.strictEqual(ctx.schemaNommage_('RELEVÉ BANCAIRE').gran, 'mois');
  assert.strictEqual(ctx.schemaNommage_('Relevé De Notes').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('DIPLÔME').gran, 'annee');
});

test('apostrophe typographique U+2019 : « Avis d’imposition » → annuel (bug OCR québécois)', () => {
  // Le MATCHING normalise l'apostrophe (→ espace) donc le type est bien reconnu « impôt » = annuel ;
  // le LIBELLÉ affiché, lui, garde l'orthographe réelle (apostrophe préservée — valide dans un nom Drive).
  assert.strictEqual(ctx.schemaNommage_('Avis d’imposition').gran, 'annee');
  assert.strictEqual(ctx.nomParType_('2024-05-02', 'Avis d’imposition', 'Revenu Québec', '.pdf'),
    '2024_Avis d’imposition_Revenu Québec.pdf'); // granularité annuelle (2024), apostrophe réelle conservée
});

test('études : TP / TP4 / travaux pratiques → annuel', () => {
  assert.strictEqual(ctx.schemaNommage_('TP').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('TP4').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('Travaux pratiques').gran, 'annee');
});

test('paie : synonymes salaire → Paie mensuel, MAIS « paiement » n\'est pas de la paie', () => {
  assert.strictEqual(ctx.schemaNommage_('Bulletin de salaire').label, 'Paie');
  assert.strictEqual(ctx.schemaNommage_('salaire').gran, 'mois');
  // Faux positif évité (motif ancré) : un reçu de paiement ≠ bulletin de paie.
  assert.strictEqual(ctx.schemaNommage_('Reçu de paiement').gran, 'jour');
  assert.strictEqual(ctx.schemaNommage_('Reçu de paiement').label, undefined);
});

test('impôt : feuillet / avis de cotisation → annuel', () => {
  assert.strictEqual(ctx.schemaNommage_('Feuillet T4').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('Avis de cotisation').gran, 'annee');
  assert.strictEqual(ctx.schemaNommage_('Impôt').gran, 'annee');
});
