'use strict';
/**
 * Chantier #7 — fichiers partagés (ADR-0005), décisions PURES de Partages.gs :
 *  - `estTypeDocumentPartage_` : allowlist stricte (images + PDF/Office), tout le reste ignoré.
 *  - `partageRecent_` : fenêtre de récence glissante, prudent si date absente/illisible.
 *  - `stockagePresquePleinCalc_` : garde storage-aware, illimité/inconnu ne bloque jamais.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Partages.gs']);

test('estTypeDocumentPartage_ : PDF/Office/images acceptés', () => {
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/pdf'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('image/jpeg'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('image/png'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('image/tiff'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/msword'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.ms-excel'), true);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.oasis.opendocument.text'), true);
});

test('estTypeDocumentPartage_ : média, Google natif, archives, dossiers → ignorés', () => {
  assert.strictEqual(ctx.estTypeDocumentPartage_('video/mp4'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('audio/mpeg'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.google-apps.document'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.google-apps.spreadsheet'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.google-apps.folder'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/vnd.google-apps.shortcut'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_('application/zip'), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_(''), false);
  assert.strictEqual(ctx.estTypeDocumentPartage_(null), false);
});

test('classerRecencePartage_ : dans la fenêtre → recent, au-delà → vieux', () => {
  const maintenant = Date.parse('2026-07-02T12:00:00Z');
  const jour = 24 * 60 * 60 * 1000;
  assert.strictEqual(ctx.classerRecencePartage_(new Date(maintenant - 5 * jour).toISOString(), maintenant, 30), 'recent');
  assert.strictEqual(ctx.classerRecencePartage_(new Date(maintenant - 29 * jour).toISOString(), maintenant, 30), 'recent');
  assert.strictEqual(ctx.classerRecencePartage_(new Date(maintenant - 30 * jour).toISOString(), maintenant, 30), 'recent'); // borne exacte incluse
  assert.strictEqual(ctx.classerRecencePartage_(new Date(maintenant - 31 * jour).toISOString(), maintenant, 30), 'vieux');
});

test('classerRecencePartage_ : date absente/illisible → inconnu (saut de l\'item, JAMAIS un STOP global)', () => {
  const maintenant = Date.parse('2026-07-02T12:00:00Z');
  assert.strictEqual(ctx.classerRecencePartage_(null, maintenant, 30), 'inconnu');
  assert.strictEqual(ctx.classerRecencePartage_('', maintenant, 30), 'inconnu');
  assert.strictEqual(ctx.classerRecencePartage_('pas une date', maintenant, 30), 'inconnu');
});

test('stockagePresquePleinCalc_ : au-delà du seuil → true, en dessous → false', () => {
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ limit: '100', usage: '96' }, 0.95), true);
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ limit: '100', usage: '95' }, 0.95), true); // ≥ seuil
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ limit: '100', usage: '50' }, 0.95), false);
});

test('stockagePresquePleinCalc_ : illimité / inconnu / absent → jamais plein (ne bloque pas)', () => {
  assert.strictEqual(ctx.stockagePresquePleinCalc_(null, 0.95), false);
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ usage: '96' }, 0.95), false);          // pas de limit (Workspace illimité)
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ limit: '0', usage: '5' }, 0.95), false);
  assert.strictEqual(ctx.stockagePresquePleinCalc_({ limit: 'x', usage: 'y' }, 0.95), false); // illisible
});
