'use strict';
/**
 * Deviner le type depuis le nom d'origine (ADR-0002 §5) — `devinerTypeDepuisNom_` /
 * `enrichirClassifDepuisNom_`. Filet quand le LLM ne rend pas de type ; ne l'écrase jamais s'il existe.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);

test('devinerTypeDepuisNom_ : sépare les mots collés par _ - . et reconnaît le type', () => {
  assert.strictEqual(ctx.devinerTypeDepuisNom_('MODE2D_TP4_MARC_RICHARD.pdf'), 'TP');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('Facture-Hydro-2024.pdf'), 'Facture');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('CV_Marc_Richard.docx'), 'CV');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('releve_mars_desjardins.pdf'), 'Relevé');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('contrat.bail.appartement.pdf'), 'Contrat');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('bulletin_de_paie_03.pdf'), 'Bulletin de paie');
});

test('devinerTypeDepuisNom_ : rien de sûr → "" (pas de faux type)', () => {
  assert.strictEqual(ctx.devinerTypeDepuisNom_('IMG_2734.jpg'), '');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('scan001.pdf'), '');
  assert.strictEqual(ctx.devinerTypeDepuisNom_(''), '');
  assert.strictEqual(ctx.devinerTypeDepuisNom_('recu_de_paiement.pdf'), ''); // « paiement » ≠ paie (motif ancré)
});

test('enrichirClassifDepuisNom_ : complète un type manquant, sans écraser un type trouvé', () => {
  var c1 = { type_doc: '', emetteur: 'Inconnu' };
  ctx.enrichirClassifDepuisNom_(c1, 'MODE2D_TP4.pdf');
  assert.strictEqual(c1.type_doc, 'TP');

  var c2 = { type_doc: 'Inconnu' };
  ctx.enrichirClassifDepuisNom_(c2, 'CV_Marc.docx');
  assert.strictEqual(c2.type_doc, 'CV');

  var c3 = { type_doc: 'Facture' }; // déjà trouvé → intact
  ctx.enrichirClassifDepuisNom_(c3, 'CV_Marc.docx');
  assert.strictEqual(c3.type_doc, 'Facture');

  var c4 = { type_doc: '' }; // rien à deviner → reste vide (défaut prudent au nommage)
  ctx.enrichirClassifDepuisNom_(c4, 'photo.jpg');
  assert.strictEqual(c4.type_doc, '');
});

test('bout-en-bout : un TP mal typé par le LLM sort en nom annuel via le nom d\'origine', () => {
  var c = { domaine: '06 · Études & diplômes', type_doc: '', emetteur: 'IUT ULCO' };
  ctx.enrichirClassifDepuisNom_(c, '2019_MODE2D_TP4.pdf');
  // Le type deviné « TP » est un type d'études → granularité ANNÉE dans nomParType_.
  assert.strictEqual(ctx.nomParType_('2019-05-01', c.type_doc, c.emetteur, '.pdf'), '2019_TP_IUT ULCO.pdf');
});
