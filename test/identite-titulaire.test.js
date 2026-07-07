'use strict';
/**
 * DOCUMENTS D'IDENTITÉ & TITULAIRE (refonte 2026-07-07, demande Marc) — les pièces d'identité se
 * rangent PAR TYPE (dossier « Passeport »/« Permis de conduire »…) contenant Marc ET les autres, le
 * nom de la PERSONNE dans le fichier. Pas de dossier « Tiers ». Anti-écrasement pour ne jamais perdre
 * deux pièces distinctes qui porteraient le même nom. Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

/* ---------- normaliserTypeIdentite_ : un type = un dossier partagé ---------- */

test('normaliserTypeIdentite_ : variantes → forme canonique (dossier partagé par tous les titulaires)', () => {
  assert.strictEqual(ctx.normaliserTypeIdentite_('PASSEPORT'), 'Passeport');
  assert.strictEqual(ctx.normaliserTypeIdentite_('passport'), 'Passeport');
  assert.strictEqual(ctx.normaliserTypeIdentite_('permis'), 'Permis de conduire');
  assert.strictEqual(ctx.normaliserTypeIdentite_('Permis de conduire'), 'Permis de conduire');
  assert.strictEqual(ctx.normaliserTypeIdentite_('acte de naissance'), 'Acte de naissance');
  assert.strictEqual(ctx.normaliserTypeIdentite_('carte d\'assurance maladie'), 'Carte d’assurance maladie');
});

/* ---------- estDocumentIdentitePersonnel_ ---------- */

test('estDocumentIdentitePersonnel_ : vrai seulement pour une pièce d\'identité reconnue', () => {
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'Passeport' }), true);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'permis' }), true);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: false }), false);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'Facture' }), false);
});

/* ---------- dossierIdentite_ : par type, jamais par personne ---------- */

test('dossierIdentite_ : domaine + sous-dossier de type (statut → 04, assurance maladie → 07)', () => {
  assert.deepStrictEqual(plat(ctx.dossierIdentite_({ sousDossierType: 'Passeport' })),
    { domaine: '01 · Administratif & identité', sousDossier: 'Passeport' });
  assert.deepStrictEqual(plat(ctx.dossierIdentite_({ sousDossierType: 'Carte de résident permanent' })),
    { domaine: '04 · Immigration', sousDossier: 'Carte de résident permanent' });
  assert.strictEqual(ctx.dossierIdentite_({ sousDossierType: 'ramq' }).domaine, '07 · Santé');
});

/* ---------- titulairePourNom_ : Marc y est VALIDE (contrairement à l'entité) ---------- */

test('titulairePourNom_ : nom de personne en Casse Titre, même depuis de l\'ALL-CAPS ; null si absent', () => {
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: 'MARC RICHARD' }), 'Marc Richard');
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: 'Baptiste Julien Patrick Richard' }), 'Baptiste Julien Patrick Richard');
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: '' }), null);
  assert.strictEqual(ctx.titulairePourNom_({}), null);
});

/* ---------- nommerDocument_ : l'aiguillage titulaire vs émetteur ---------- */

test('nommerDocument_ : pièce d\'identité → titulaire dans le nom (Marc ET les autres, même dossier)', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Marc Richard', date_doc: '2019-09-17' }, '2026-07-07', '.pdf'),
    '2019-09-17_Passeport_Marc Richard.pdf');
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Sophie Tremblay', date_doc: '2020-01-01' }, '2026-07-07', '.pdf'),
    '2020-01-01_Passeport_Sophie Tremblay.pdf');
});

test('nommerDocument_ : document normal → émetteur ; date absente → date de réception', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture', emetteur: 'Hydro-Québec', date_doc: '2026-03-01' }, '2026-07-07', '.pdf'),
    '2026-03-01_Facture_Hydro-Québec.pdf');
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture', emetteur: 'Hydro-Québec' }, '2026-07-07', '.pdf'),
    '2026-07-07_Facture_Hydro-Québec.pdf');
});

test('nommerDocument_ : émetteur ET titulaire absents → « …_Type.ext » (jamais un blocage, jamais _Inconnu)', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture' }, '2026-03-01', '.pdf'), '2026-03-01_Facture_Inconnu.pdf'); // doc normal : garde le repli historique
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport' }, '2026-03-01', '.pdf'),
    '2026-03-01_Passeport.pdf'); // pièce d'identité sans titulaire lisible : pas de « _Inconnu »
});

/* ---------- garantirNomUnique_ : jamais d'écrasement ---------- */

test('garantirNomUnique_ : insère un suffixe si le nom existe déjà (deux pièces distinctes, pas des doublons)', () => {
  assert.strictEqual(ctx.garantirNomUnique_('2020_Passeport.pdf', ['2020_Passeport.pdf']), '2020_Passeport_2.pdf');
  assert.strictEqual(ctx.garantirNomUnique_('2020_Passeport.pdf', ['2020_Passeport.pdf', '2020_Passeport_2.pdf']), '2020_Passeport_3.pdf');
  assert.strictEqual(ctx.garantirNomUnique_('a.pdf', []), 'a.pdf');
});
