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

test('cheminCibleConsolidation_ : arbitrage « entité OU année » (02) — entité validée SANS année, sinon AAAA', () => {
  // la CONSTANTE pilote le test (jamais la valeur du jour en dur)
  const domAnnee = ctx.CONFIG.DOMAINES_PAR_ANNEE[0];
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03-01_Facture_EDF.pdf', validees),
    '2026', 'émetteur non validé → année seule');
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03_Relevé_Desjardins.pdf', validees),
    'Desjardins', 'entité validée → UN dossier d\'entité, JAMAIS fragmentée par année (2026/Desjardins interdit)');
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

test('cheminCibleConsolidation_ : pièce d\'identité → dossier de TYPE — UNIQUEMENT dans le domaine du type', () => {
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2020-01-01_Passeport_Marc Richard.pdf', validees),
    'Passeport');
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2023-02-01_Permis de conduire_Marc Richard.pdf', {}),
    'Permis de conduire', 'même sans référentiel d\'entités');
  // Un passeport ÉGARÉ dans 02 ne fabrique pas de dossier « Passeport » hors 01 : ciblé par la règle
  // du domaine courant (année en 02) — le re-DOMAINE est hors périmètre de la consolidation (O2).
  assert.strictEqual(ctx.cheminCibleConsolidation_('02 · Finances', '2020-01-01_Passeport_Marc Richard.pdf', validees),
    '2020', 'l\'exception identité est scopée à son domaine');
});

/* ---------- TRIPWIRE : la cible de consolidation == la sortie du flux vivant (règle UNIQUE) ---------- */

test('TRIPWIRE flux vivant ↔ consolidation : pour un même document, le sous-chemin est IDENTIQUE (sinon « Déplacer » en boucle)', () => {
  const cas = [
    // [classif, date, ext, domaine attendu]
    [{ domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Cleverbridge', date_doc: '2026-01-10' }, '2026-01-10', '.pdf'],
    [{ domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sousDossier: 'Desjardins Inc.', date_doc: '2026-03-15' }, '2026-03-15', '.pdf'],
    [{ domaine: '05 · Carrière', type_doc: 'Lettre', emetteur: 'Schneider Electric', date_doc: '2026-01-05' }, '2026-01-05', '.pdf'],
    [{ estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Marc Richard', domaine: '01 · Administratif & identité', date_doc: '2020-01-01' }, '2020-01-01', '.pdf'],
  ];
  for (const [classif, date, ext] of cas) {
    const meta = { nomFichier: 'f' + ext, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: classif.emetteur || '' };
    const plan = ctx.planRoutageV2_(classif, meta, date, ext, validees);
    assert.strictEqual(plan.type, 'classé', JSON.stringify(plan));
    // Le fichier que le flux vivant vient de produire (plan.nom, dans plan.domaine) doit être « OK »
    // pour la consolidation : même sous-chemin par la règle unique.
    const cible = ctx.cheminCibleConsolidation_(plan.domaine, plan.nom, validees);
    assert.strictEqual(cible, plan.sousDossier,
      'divergence flux↔plan pour ' + plan.nom + ' (' + plan.domaine + ') : flux="' + plan.sousDossier + '" vs conso="' + cible + '"');
  }
});

/* ---------- budgetJourConsolidation_ : ms réelles persistées, remises à zéro au rollover ---------- */

test('budgetJourConsolidation_ : la valeur ne vaut que si la date persistée est AUJOURD\'HUI (sinon 0), format date|ms', () => {
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(ctx.budgetJourConsolidation_(props({ DriveAI_CONSO_JOUR: '2026/07/16|540000' }), '2026/07/16'), 540000);
  assert.strictEqual(ctx.budgetJourConsolidation_(props({ DriveAI_CONSO_JOUR: '2026/07/15|540000' }), '2026/07/16'), 0,
    'rollover : la consommation de la veille ne compte pas aujourd\'hui');
  assert.strictEqual(ctx.budgetJourConsolidation_(props({}), '2026/07/16'), 0);
  assert.strictEqual(ctx.budgetJourConsolidation_(props({ DriveAI_CONSO_JOUR: 'corrompu' }), '2026/07/16'), 0);
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

test('decisionConsolidation_ : contrôle §1 ILLISIBLE → « Ignoré » avec une raison HONNÊTE (jamais « Zone protégée » à tort)', () => {
  const d = ctx.decisionConsolidation_({
    domaine: '02 · Finances', sousCheminActuel: 'X', sousCheminCible: '',
    protege: false, protegeIllisible: true, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(d.action, 'Ignoré', 'abstention prudente (échec-fermé §1)');
  assert.ok(/illisible/i.test(d.raison), 'la raison dit la vérité (le plan que Marc valide ne ment pas) : ' + d.raison);
  assert.ok(!/Zone protégée \(04\) intouchable/.test(d.raison), 'jamais étiqueté « zone protégée » sans preuve : ' + d.raison);
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
  // `UrlFetchApp` (sans parenthèse) : la voie REST Drive passerait sous les motifs DriveApp — le
  // module n'en a AUCUN besoin légitime (revue sécurité C28-26 : promesse de verrou = couverture réelle).
  ['moveTo(', 'setTrashed(', 'setName(', '.createFolder(', '.createFile(', 'removeFile(', 'addFile(',
    'addFolder(', 'removeFolder(', 'makeCopy(', 'setContent(', 'UrlFetchApp']
    .forEach((motif) => {
      assert.ok(!src.includes(motif), 'mutation interdite trouvée dans Consolidation.gs : ' + motif);
    });
});
