'use strict';
/**
 * FAIL-SAFE HYBRIDE ULTRA-STRICT (ADR-0016, révision §2.1). Un document ne part dans « 00 · À vérifier »
 * QUE si l'analyse est TOUT-NULL — domaine inconnu ET émetteur ET type_doc tous absents. Un seul fait
 * présent ⇒ classé au mieux. La conjonction ET est l'anti-saturation (leçon : revue large = auto-rangement
 * neutralisé). Inclut les faux-positifs historiques de NON-RÉGRESSION (protocole de précision, phase 3).
 * Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const meta = (nom, opts) => Object.assign(
  { nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' }, opts || {});

/* ---------- estRenseigne_ ---------- */

test('estRenseigne_ : vrai seulement pour une valeur réellement remplie', () => {
  assert.strictEqual(ctx.estRenseigne_('Hydro-Québec'), true);
  assert.strictEqual(ctx.estRenseigne_('Facture'), true);
  assert.strictEqual(ctx.estRenseigne_(''), false);
  assert.strictEqual(ctx.estRenseigne_('   '), false);
  assert.strictEqual(ctx.estRenseigne_(null), false);
  assert.strictEqual(ctx.estRenseigne_(undefined), false);
});

/* ---------- estClassificationVide_ : conjonction ET (ultra-strict) ---------- */

test('estClassificationVide_ : VRAI seulement si domaine inconnu ET émetteur ET type tous absents', () => {
  // tout-NULL → true
  assert.strictEqual(ctx.estClassificationVide_({ domaine: null, emetteur: null, type_doc: null }), true);
  assert.strictEqual(ctx.estClassificationVide_({}), true);
  assert.strictEqual(ctx.estClassificationVide_(null), true);
  // domaine hors-liste compte comme absent → tout-NULL → true
  assert.strictEqual(ctx.estClassificationVide_({ domaine: 'Bidon inexistant', emetteur: '', type_doc: '' }), true);
});

test('estClassificationVide_ : UN SEUL fait présent ⇒ FAUX (on classe au mieux)', () => {
  // domaine valide seul
  assert.strictEqual(ctx.estClassificationVide_({ domaine: '02 · Finances' }), false);
  // émetteur seul (domaine inconnu)
  assert.strictEqual(ctx.estClassificationVide_({ domaine: null, emetteur: 'EDF', type_doc: null }), false);
  // type seul (domaine inconnu)
  assert.strictEqual(ctx.estClassificationVide_({ domaine: null, emetteur: null, type_doc: 'Facture' }), false);
});

/* ---------- Câblage v2 (planRoutageV2_) : type « à vérifier » ---------- */

test('planRoutageV2_ : analyse TOUT-NULL → type « à vérifier »', () => {
  const p = ctx.planRoutageV2_(
    { domaine: null, emetteur: null, type_doc: null }, meta('scan.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'à vérifier');
});

test('planRoutageV2_ : une pièce d\'identité « vide » par ailleurs n\'est JAMAIS déviée en revue', () => {
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Marc Richard' },
    meta('passeport.pdf'), '2019-09-17', '.pdf');
  assert.strictEqual(p.type, 'classé'); // l'identité prime — jamais « à vérifier »
});

/* ---------- NON-RÉGRESSION : faux-positifs historiques qui NE doivent PAS partir en revue ---------- */

test('NON-RÉGRESSION : un CV sans émetteur reste CLASSÉ (type présent)', () => {
  // Historiquement, un CV n'a pas d'émetteur — il ne doit surtout pas partir en revue.
  assert.strictEqual(ctx.estClassificationVide_({ domaine: '05 · Carrière', type_doc: 'CV', emetteur: null }), false);
  const p = ctx.planRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'CV', descripteur: 'CV Marc Richard' }, meta('cv.pdf'), '2026-06-01', '.pdf');
  assert.strictEqual(p.type, 'classé');
});

test('NON-RÉGRESSION : une note perso (domaine présent, ni émetteur ni type) reste CLASSÉE', () => {
  assert.strictEqual(ctx.estClassificationVide_({ domaine: '08 · Perso & projets', emetteur: null, type_doc: null }), false);
  const p = ctx.planRoutageV2_(
    { domaine: '08 · Perso & projets', sousDossier: 'Notes', descripteur: 'Note manuscrite idées' },
    meta('note.jpg'), '2026-07-01', '.jpg');
  assert.strictEqual(p.type, 'classé');
});

test('NON-RÉGRESSION : un export de données (non-document) part en _Technique, PAS en revue', () => {
  // Le non-document est intercepté AVANT le fail-safe → jamais « à vérifier ».
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, routageHorsDomaine: '_Technique', domaine: null, emetteur: null, type_doc: null },
    meta('votre information facebook.html', { taille: 600000 }), '2026-07-01', '.html');
  assert.strictEqual(p.type, 'non-doc');
  assert.notStrictEqual(p.type, 'à vérifier');
});

test('NON-RÉGRESSION : un doc avec émetteur mais domaine inconnu → domaine par défaut, PAS la revue', () => {
  assert.strictEqual(ctx.estClassificationVide_({ domaine: 'Zzz', emetteur: 'IRCC', type_doc: 'Attestation' }), false);
  const p = ctx.planRoutageV2_(
    { domaine: 'Zzz inconnu', emetteur: 'IRCC', type_doc: 'Attestation' }, meta('att.pdf'), '2026-01-22', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, ctx.CONFIG.DOMAINE_DEFAUT);
});
