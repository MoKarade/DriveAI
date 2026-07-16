'use strict';
/**
 * CONSOLIDATION (C28-26, ADR-0023) — fonctions PURES du plan de consolidation (Consolidation.gs) :
 * décomposition du nom classé, chemin CIBLE sous la taxonomie à plat (année/entité validée/type
 * d'identité), et DÉCISION (OK / Déplacer / Doublon / Ignoré). Les exigences du plan architecte :
 * un fichier mal rangé → « Déplacer » ; un hash déjà vu → « Doublon » ; un fichier sous 04 →
 * « Ignoré » MÊME s'il est mal rangé ou en double (§1). Aucune I/O ici.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Consolidation.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

/* ---------- analyserNomClasse_ : décomposition du nom AAAA[-MM[-JJ]]_Type_Tiers.ext ---------- */

test('analyserNomClasse_ : nom au jour, au mois, à l\'année — et hors convention → null', () => {
  assert.deepStrictEqual(plat(ctx.analyserNomClasse_('2026-03-01_Facture_EDF.pdf')),
    { annee: '2026', type: 'Facture', tiers: 'EDF' });
  assert.deepStrictEqual(plat(ctx.analyserNomClasse_('2026-03_Relevé_Desjardins.pdf')),
    { annee: '2026', type: 'Relevé', tiers: 'Desjardins' });
  assert.deepStrictEqual(plat(ctx.analyserNomClasse_('2023_Bulletin de notes_IMERIR.pdf')),
    { annee: '2023', type: 'Bulletin de notes', tiers: 'IMERIR' });
  // sans tiers (nomSansTiers_) : le type reste lisible
  assert.deepStrictEqual(plat(ctx.analyserNomClasse_('2026-06-16_Rapport.pdf')),
    { annee: '2026', type: 'Rapport', tiers: null });
  // hors convention → tout null (le fichier sera ciblé à plat au domaine)
  assert.deepStrictEqual(plat(ctx.analyserNomClasse_('PXL_20240101_123.jpg')),
    { annee: null, type: null, tiers: null });
});

/* ---------- cheminCibleConsolidation_ : la formule du plan (année si domaine par année + entité VALIDÉE, sinon plat) ---------- */

// Entités validées de test : carte cleCanoniqueEntite_ → libellé canonique (comme entitesValideesParCle_).
const validees = {};
[['02 · Finances', 'Desjardins'], ['05 · Carrière', 'Robovic']].forEach(([dom, ent]) => {
  validees[ctx.cleCanoniqueEntite_(dom, ent)] = ent;
});

test('cheminCibleConsolidation_ : domaine par ANNÉE (02) → /AAAA ; + entité VALIDÉE → /AAAA/Entité', () => {
  // la CONSTANTE pilote le test (jamais la valeur du jour en dur)
  const domAnnee = ctx.CONFIG.DOMAINES_PAR_ANNEE[0];
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03-01_Facture_EDF.pdf', validees),
    '2026', 'émetteur non validé → année seule');
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03_Relevé_Desjardins.pdf', validees),
    '2026/Desjardins', 'entité validée du domaine → année + entité');
});

test('cheminCibleConsolidation_ : domaine SANS année → entité validée seule, sinon À PLAT', () => {
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-06_Bulletin de paie_Robovic.pdf', validees),
    'Robovic', 'entité validée → dossier d\'entité');
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-01-05_Lettre_Schneider Electric.pdf', validees),
    '', 'candidature (entité NON validée) → à plat');
  assert.strictEqual(ctx.cheminCibleConsolidation_('08 · Perso & projets', 'PXL_20240101_123.jpg', validees),
    '', 'hors convention → à plat au domaine');
  // une entité validée dans un AUTRE domaine ne crée pas de dossier ici (clé par domaine)
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-03_Relevé_Desjardins.pdf', validees),
    '', 'Desjardins est validée en 02, pas en 05');
});

test('cheminCibleConsolidation_ : pièce d\'identité → dossier de TYPE (l\'exception au « à plat », jamais aplatie)', () => {
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2020-01-01_Passeport_Marc Richard.pdf', validees),
    'Passeport');
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2023-02-01_Permis de conduire_Marc Richard.pdf', {}),
    'Permis de conduire', 'même sans référentiel d\'entités');
});

/* ---------- decisionConsolidation_ : OK / Déplacer / Doublon / Ignoré ---------- */

test('decisionConsolidation_ : fichier mal rangé → « Déplacer » vers la cible complète', () => {
  const d = ctx.decisionConsolidation_({
    domaine: '05 · Carrière', sousCheminActuel: 'Schneider Electric', sousCheminCible: '',
    protege: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(d.action, 'Déplacer');
  assert.strictEqual(d.cible, '05 · Carrière', 'cible = racine du domaine (à plat)');
});

test('decisionConsolidation_ : déjà au bon endroit → « OK » (le plan converge, rien à faire)', () => {
  const d = ctx.decisionConsolidation_({
    domaine: '02 · Finances', sousCheminActuel: '2026/Desjardins', sousCheminCible: '2026/Desjardins',
    protege: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(d.action, 'OK');
  assert.strictEqual(d.cible, '02 · Finances/2026/Desjardins');
});

test('decisionConsolidation_ : hash déjà vu par la campagne → « Doublon », cible _Doublons (déplacement seul, §2)', () => {
  const d = ctx.decisionConsolidation_({
    domaine: '02 · Finances', sousCheminActuel: '2026', sousCheminCible: '2026',
    protege: false, raccourci: false, doublonDe: 'id-premier-porteur',
  });
  assert.strictEqual(d.action, 'Doublon');
  assert.strictEqual(d.cible, '_Doublons');
  assert.ok(d.raison.includes('id-premier-porteur'), 'la raison nomme le premier porteur : ' + d.raison);
});

test('decisionConsolidation_ : zone protégée (04) → « Ignoré » MÊME mal rangé, MÊME en doublon (§1)', () => {
  const malRange = ctx.decisionConsolidation_({
    domaine: '04 · Immigration', sousCheminActuel: 'IRCC', sousCheminCible: '',
    protege: true, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(malRange.action, 'Ignoré', 'jamais de déplacement proposé en zone protégée');
  const doublon = ctx.decisionConsolidation_({
    domaine: '04 · Immigration', sousCheminActuel: '', sousCheminCible: '',
    protege: true, raccourci: false, doublonDe: 'id-x',
  });
  assert.strictEqual(doublon.action, 'Ignoré');
  assert.ok(doublon.raison.includes('doublon constaté'), 'le doublon est CONSTATÉ sans être déplacé : ' + doublon.raison);
  assert.ok(doublon.raison.includes('Zone protégée'), doublon.raison);
});

test('decisionConsolidation_ : raccourci Drive → « Ignoré » (artefact d\'entité voulu, jamais déplacé)', () => {
  const d = ctx.decisionConsolidation_({
    domaine: '02 · Finances', sousCheminActuel: 'Société Générale', sousCheminCible: '',
    protege: false, raccourci: true, doublonDe: null,
  });
  assert.strictEqual(d.action, 'Ignoré');
  assert.ok(/raccourci/i.test(d.raison), d.raison);
});

/* ---------- Garde-fous de surface : le module ne porte AUCUNE mutation Drive ---------- */

test('Consolidation.gs : aucun appel de mutation Drive (dry-run PUR par construction)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Consolidation.gs'), 'utf8');
  // Motifs d'APPEL réels (parenthèse ouvrante) — les mentions en commentaire ne matchent pas.
  ['moveTo(', 'setTrashed(', 'setName(', '.createFolder(', '.createFile(', 'removeFile(', 'addFile(']
    .forEach((motif) => {
      assert.ok(!src.includes(motif), 'mutation interdite trouvée dans Consolidation.gs : ' + motif);
    });
});
