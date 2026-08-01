'use strict';
/**
 * TRIPWIRE ADR-0033 — le flux vivant DÉLÈGUE son sous-chemin à la MÊME fonction pure que le Reset
 * (`cheminCibleReset_`), sur le nom FINAL. Ce test verrouille la convergence : pour tout document que
 * le Reset sait router (non-null), la sortie du flux (`planRoutageV2_`) est IDENTIQUE au chemin
 * thématique du Reset. Si quelqu'un modifie un côté sans l'autre (retire la délégation, change une
 * table), ce test casse — c'est la fin structurelle du « déplacer en boucle » flux↔reset.
 *
 * La convergence flux↔CONSOLIDATION est verrouillée séparément dans `consolidation.test.js` (les 3
 * consommateurs — flux, conso, reset — passent par la même règle).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Router.gs']);
const meta = (nom) => ({ nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' });

// Échantillon stratifié par domaine — des documents que le Reset route dans son arbre thématique.
const CAS = [
  { classif: { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins' }, date: '2026-03-15', ext: '.pdf' },
  { classif: { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Cleverbridge' }, date: '2026-01-10', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Paie', emetteur: 'Robovic' }, date: '2026-06-01', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Lettre de motivation', emetteur: 'Airbus' }, date: '2026-06-30', ext: '.docx' },
  { classif: { domaine: '01 · Administratif & identité', type_doc: 'Attestation', emetteur: 'CNAM' }, date: '2022-03-04', ext: '.pdf' },
  { classif: { estDocumentIdentite: true, sousDossierType: 'Permis de conduire', titulaire: 'Marc Richard' }, date: '2023-02-01', ext: '.pdf' },
];

test('TRIPWIRE flux vivant ↔ Reset (ADR-0033) : sous-chemin IDENTIQUE pour tout doc que le Reset route', () => {
  let couverts = 0;
  for (const cas of CAS) {
    const classif = Object.assign({ date_doc: cas.date }, cas.classif);
    const plan = ctx.planRoutageV2_(classif, meta('f' + cas.ext), cas.date, cas.ext, {});
    assert.strictEqual(plan.type, 'classé', JSON.stringify(plan));
    const rel = ctx.cheminCibleReset_(plan.domaine, plan.nom);
    if (rel) {
      couverts++;
      assert.strictEqual(plan.sousDossier, rel,
        'divergence flux↔reset pour ' + plan.nom + ' : flux="' + plan.sousDossier + '" vs reset="' + rel + '"');
      assert.strictEqual(plan.dossierIdCible, '', 'chemin thématique → jamais un ID d\'entité (le chemin EST la structure)');
    }
  }
  assert.ok(couverts >= 4, 'au moins 4 cas doivent réellement passer par le Reset (sinon le tripwire ne prouve rien) — couverts=' + couverts);
});

test('REPLI (jamais de limbo) : un doc que le Reset NE route PAS retombe sur le classement historique', () => {
  // Un devoir 06 sans motif Reset → le Reset rend null, mais le flux CLASSE quand même (repli à plat).
  const plan = ctx.planRoutageV2_(
    { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', date_doc: '2026-06-30' },
    meta('TP.docx'), '2026-06-30', '.docx', {});
  assert.strictEqual(ctx.cheminCibleReset_('06 · Études & diplômes', plan.nom), null, 'le Reset ne route pas ce doc');
  assert.strictEqual(plan.type, 'classé', 'le flux le classe quand même (repli) — jamais laissé sans dossier');
  assert.ok(!/inconnu/i.test(plan.nom), 'et jamais « Inconnu » dans le nom : ' + plan.nom);
});

/* ---------- Forward des années (ADR-0033, revue structure-keeper) : le flux AVANCE dans le temps ---------- */

test('resetBucketAnnee_ : une année POSTÉRIEURE aux buckets figés rend son propre segment (jamais Archives)', () => {
  const noeud = { '2026': {}, '2025': {}, '2024': {}, '2023': {}, '2022': {}, '2021': {}, Archives: {} };
  assert.strictEqual(ctx.resetBucketAnnee_('2026', noeud), '2026', 'année listée → elle-même');
  assert.strictEqual(ctx.resetBucketAnnee_('2027', noeud), '2027', 'FORWARD : 2027+ crée son dossier (pas Archives)');
  assert.strictEqual(ctx.resetBucketAnnee_('2031', noeud), '2031');
  assert.strictEqual(ctx.resetBucketAnnee_('2018', noeud), 'Archives', 'PASSÉ hors fenêtre → Archives (borné)');
  assert.strictEqual(ctx.resetBucketAnnee_('', noeud), 'Archives', 'année absente → Archives');
});

test('bout-en-bout : un relevé 2027 (flux vivant délégué) va dans Relevés/2027, plus jamais Archives (anti-régression 2027)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2027-06_Relevé_Desjardins.pdf'), 'Relevés/2027');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2027-01-10_Facture_Cleverbridge.pdf'), 'Reçus & factures/2027');
});

/* ---------- Invariance d'assainissement (revue code-reviewer) : flux(segment brut) == conso(champ_) ---------- */

function cheminsPossiblesReset_(structure) {
  const out = [];
  const walk = (noeud, prefix) => {
    const enfants = Object.keys(noeud || {});
    if (!enfants.length) { if (prefix) out.push(prefix); return; }
    for (const e of enfants) walk(noeud[e], prefix ? prefix + '/' + e : e);
  };
  for (const dom of Object.keys(structure || {})) {
    for (const e of Object.keys(structure[dom] || {})) walk(structure[dom][e], e);
  }
  return out;
}

test('INVARIANCE : toute sortie de STRUCTURE_CIBLE_RESET est invariante par champ_ et sans segment vide', () => {
  // Le flux/reset gardent les segments BRUTS ; la conso applique champ_ (ConsolidationExec.gs:163).
  // Aujourd'hui tous les chemins de la table sont invariants — ce test le VERROUILLE : le jour où
  // quelqu'un ajoute un dossier contenant un caractère interdit (_ / \ : * ? etc.), la conso le
  // renommerait alors que flux+Reset garderaient le brut → « Déplacer » en boucle silencieux.
  const chemins = cheminsPossiblesReset_(ctx.STRUCTURE_CIBLE_RESET);
  assert.ok(chemins.length >= 40, 'la table doit produire de nombreux chemins : ' + chemins.length);
  for (const ch of chemins) {
    for (const seg of ch.split('/')) {
      assert.ok(seg.length > 0, 'segment vide dans : ' + ch);
      assert.strictEqual(ctx.champ_(seg), seg, 'segment non invariant par champ_ (flux brut ≠ conso assainie) : « ' + seg + ' » dans ' + ch);
    }
  }
});

/* ---------- Couverture REPLI du tripwire flux↔conso (revue code-reviewer) ---------- */

test('REPLI flux↔conso : un doc que le Reset NE route pas converge encore (branche historique)', () => {
  // Le tripwire consolidation ne couvre plus que la branche DÉLÉGUÉE (ses 4 cas y passent). Ici on
  // exerce la branche REPLI (Reset null) : flux et conso doivent rendre le MÊME sous-chemin.
  const validees = {};
  const classif = { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', date_doc: '2026-06-30' };
  const plan = ctx.planRoutageV2_(classif, meta('2026-06-30_Devoir_TP Python.docx'), '2026-06-30', '.docx', validees);
  assert.strictEqual(ctx.cheminCibleReset_(plan.domaine, plan.nom), null, 'branche repli (le Reset ne route pas)');
  const conso = ctx.cheminCibleConsolidation_(plan.domaine, plan.nom, validees);
  assert.strictEqual(conso.nom, plan.sousDossier, 'repli : flux↔conso convergent (« ' + plan.sousDossier + ' » vs « ' + conso.nom + ' »)');
  assert.strictEqual(conso.id, plan.dossierIdCible || '', 'repli : les IDs convergent aussi');
});

/* ---------- Point 4 (revue structure-keeper) : le flux délégué re-pointe le référentiel d'entité ---------- */

test('deciderRoutageV2_ : entité-table au Dossier ID PÉRIMÉ → re-pointée vers le nœud thématique (jamais orpheline)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Router.gs']);
  const cle = c.cleCanoniqueEntite_('05 · Carrière', 'Robovic');
  const validees = {}; validees[cle] = { nom: 'Robovic', dossierId: 'ANCIEN_ID' }; // pointe AILLEURS
  const repoints = [];
  c.entitesValideesParCle_ = () => validees;
  c.idDomaine_ = () => 'DOM_05';
  c.DriveApp = { getFolderById: () => ({ getId: () => 'DOM_05' }) };
  c.sousDossier_ = (parent, name) => ({ getId: () => 'F_' + name }); // Employeurs → Robovic ⇒ F_Robovic
  c.repointerEntites_ = (src, dst) => { repoints.push([src, dst]); };
  c.garantirNomUnique_ = (n) => n;
  c.nomsDansDossier_ = () => [];

  const r = c.deciderRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Paie', emetteur: 'Robovic', date_doc: '2026-06-01' },
    { nomFichier: 'paie.pdf', taille: 1000, extraitOcr: 'texte lisible '.repeat(5), emetteur: 'Robovic' },
    new Date('2026-06-01T00:00:00Z'), '.pdf');

  assert.strictEqual(r.chemin, '05 · Carrière/Employeurs/Robovic', 'doc placé dans le nœud thématique');
  assert.deepStrictEqual(repoints, [['ANCIEN_ID', 'F_Robovic']], 'référentiel re-pointé de l\'ancien ID vers le dossier thématique');
  assert.strictEqual(validees[cle].dossierId, 'F_Robovic', 'carte en cache mise à jour → jamais re-pointé 2× le même run');

  // Idempotence : un 2ᵉ doc de la même entité (Dossier ID déjà à jour) ne re-pointe PLUS.
  repoints.length = 0;
  c.deciderRoutageV2_(
    { domaine: '05 · Carrière', type_doc: 'Paie', emetteur: 'Robovic', date_doc: '2026-07-01' },
    { nomFichier: 'paie2.pdf', taille: 1000, extraitOcr: 'texte lisible '.repeat(5), emetteur: 'Robovic' },
    new Date('2026-07-01T00:00:00Z'), '.pdf');
  assert.deepStrictEqual(repoints, [], 'Dossier ID déjà thématique → aucun re-pointage (zéro I/O en régime)');
});
