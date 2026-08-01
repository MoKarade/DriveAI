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

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Router.gs']);
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

// Entités validées de test : carte cleCanoniqueEntite_ → {nom, dossierId} (comme
// entitesValideesParCle_ depuis l'ADR-0028 — l'ID est la vérité topologique, le nom un repli).
const validees = {};
[['02 · Finances', 'Desjardins'], ['05 · Carrière', 'Robovic']].forEach(([dom, ent]) => {
  validees[ctx.cleCanoniqueEntite_(dom, ent)] = { nom: ent, dossierId: 'ID_' + ent };
});

test('cheminCibleConsolidation_ : DÉLÈGUE à la structure Reset (ADR-0033) — 02 par TYPE, plus par entité', () => {
  // La consolidation calcule sa cible par la MÊME règle que le flux ET le Reset (`cheminCibleReset_`).
  // Décision Marc « unifier sur la structure validée » : une facture/un relevé va dans l'arbre
  // thématique du Reset, PAS dans un dossier d'entité — une banque validée regroupe par TYPE.
  const domAnnee = ctx.CONFIG.DOMAINES_PAR_ANNEE[0]; // 02 · Finances
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03-01_Facture_EDF.pdf', validees).nom,
    'Reçus & factures/2026', 'facture → arbre thématique Reçus & factures/AAAA');
  assert.strictEqual(ctx.cheminCibleConsolidation_(domAnnee, '2026-03_Relevé_Desjardins.pdf', validees).nom,
    'Relevés/2026', 'relevé (même d\'une entité validée) → Relevés/AAAA, plus un dossier d\'entité (ADR-0033)');
});

test('cheminCibleConsolidation_ : employeur/recherche via Reset ; REPLI à plat quand le Reset ne route pas', () => {
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-06_Bulletin de paie_Robovic.pdf', validees).nom,
    'Employeurs/Robovic', 'paie d\'employeur → arbre Employeurs/X (Reset)');
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-01-05_Lettre_Schneider Electric.pdf', validees).nom,
    'Recherche d\'emploi', 'une lettre de démarche 05 → Recherche d\'emploi (Reset), jamais un dossier d\'entreprise');
  assert.strictEqual(ctx.cheminCibleConsolidation_('08 · Perso & projets', 'PXL_20240101_123.jpg', validees).nom,
    '', 'hors convention → le Reset rend null → repli à plat au domaine (jamais de limbo)');
  // une entité validée dans un AUTRE domaine ne crée pas de dossier ici (le Reset ne route pas → repli)
  assert.strictEqual(ctx.cheminCibleConsolidation_('05 · Carrière', '2026-03_Relevé_Desjardins.pdf', validees).nom,
    '', 'Desjardins est validée en 02, pas en 05 : repli à plat');
});

test('cheminCibleConsolidation_ : pièce d\'identité → arbre Reset (Pièces d\'identité/…) dans SON domaine', () => {
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2020-01-01_Passeport_Marc Richard.pdf', validees).nom,
    'Pièces d\'identité/Marc');
  assert.strictEqual(ctx.cheminCibleConsolidation_('01 · Administratif & identité', '2023-02-01_Permis de conduire_Marc Richard.pdf', {}).nom,
    'Pièces d\'identité/Marc', 'même sans référentiel d\'entités');
  // Un passeport ÉGARÉ dans 02 : le Reset ne route pas une identité hors 01 (null) → repli année en 02.
  // Le re-DOMAINE reste hors périmètre de la consolidation (O2) — garde-fou préservé.
  assert.strictEqual(ctx.cheminCibleConsolidation_('02 · Finances', '2020-01-01_Passeport_Marc Richard.pdf', validees).nom,
    '2020', 'l\'exception identité reste scopée à son domaine (repli année en 02)');
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
    assert.strictEqual(cible.nom, plan.sousDossier,
      'divergence flux↔plan pour ' + plan.nom + ' (' + plan.domaine + ') : flux="' + plan.sousDossier + '" vs conso="' + cible.nom + '"');
    // ADR-0028 : l'ID cible doit AUSSI coïncider — sinon le flux rangerait par ID et la
    // consolidation jugerait par nom (l'un déferait l'autre, à l'envers du bug corrigé).
    assert.strictEqual(cible.id, plan.dossierIdCible || '',
      'divergence d\'ID flux↔plan pour ' + plan.nom + ' (' + plan.domaine + ')');
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

test('decisionConsolidation_ : entité à la PROFONDEUR 2 → « OK » par ID, jamais « Déplacer » (ADR-0028)', () => {
  // LE test de non-régression du chantier : le dossier d'entité « Robovic » a été déplacé sous un
  // regroupement « Anciens employeurs » (ADR-0027, validé par Marc). Le sous-chemin TEXTUEL diffère
  // de la cible à plat — avant l'ADR-0028, la consolidation ressortait les fichiers à chaque passe
  // (puis proposait de corbeiller le dossier vidé). L'égalité d'ID doit primer.
  const d = ctx.decisionConsolidation_({
    domaine: '05 · Carrière',
    sousCheminActuel: 'Anciens employeurs/Robovic',
    sousCheminCible: 'Robovic',
    dossierIdCible: 'ID_Robovic',
    parentId: 'ID_Robovic',       // le fichier EST dans le dossier de l'entité, quelle que soit sa profondeur
    protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(d.action, 'OK');
  assert.match(d.raison, /ID/);

  // Contre-épreuve : même configuration mais le fichier est AILLEURS → « Déplacer » (on n'a pas
  // neutralisé la consolidation en la rendant permissive).
  const ailleurs = ctx.decisionConsolidation_({
    domaine: '05 · Carrière',
    sousCheminActuel: 'Vrac',
    sousCheminCible: 'Robovic',
    dossierIdCible: 'ID_Robovic',
    parentId: 'ID_AUTRE',
    protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(ailleurs.action, 'Déplacer');

  // Sans ID (entité validée dont le dossier n'existe pas encore) : comportement TEXTUEL d'avant.
  const sansId = ctx.decisionConsolidation_({
    domaine: '05 · Carrière', sousCheminActuel: 'Anciens employeurs/Robovic', sousCheminCible: 'Robovic',
    dossierIdCible: '', parentId: 'ID_Robovic',
    protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(sansId.action, 'Déplacer', 'repli textuel : jamais un OK inventé sans ID');

  // La zone protégée prime TOUJOURS sur la nouvelle règle (ordre des gardes inchangé, §1).
  const protege = ctx.decisionConsolidation_({
    domaine: '04 · Immigration', sousCheminActuel: 'X', sousCheminCible: 'Robovic',
    dossierIdCible: 'ID_Robovic', parentId: 'ID_Robovic',
    protege: true, protegeIllisible: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(protege.action, 'Ignoré');
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
