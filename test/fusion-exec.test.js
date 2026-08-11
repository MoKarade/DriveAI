'use strict';
/**
 * EXÉCUTION du plan de fusion (#47 PR2, ADR-0037 — FusionExec.gs). Verrouille la DÉCISION pure
 * (`fusionsAExecuter_` : join groupe→cible, STRICT « Fusionner », source==cible exclu) ET les gardes
 * de mutation (04 INTERNE permis / hors-04 protégé refusé / multi-parents / sous-dossier / cible
 * invalide / idempotence / drainage → re-pointage + coquille vide). `moveTo` = seule mutation (verrou
 * de surface). Mocks calqués sur consolidation-exec.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o));

const ctxPur = load(['Config.gs', 'FusionExec.gs']);

/* ---------- PURES ---------- */

test('ligneFusionAAppliquer_ : STRICTEMENT « Fusionner » (opt-in) — tout le reste est ignoré', () => {
  assert.strictEqual(ctxPur.ligneFusionAAppliquer_('Fusionner'), true);
  ['Ignorer', 'Ignorer (structurel)', 'À VALIDER', '', 'fusionner', 'Fusionner '].forEach((a) => {
    assert.strictEqual(ctxPur.ligneFusionAAppliquer_(a), false, 'jamais : ' + JSON.stringify(a));
  });
});

test('budgetJourFusionExec_ : ms réelles du jour seulement (rollover → 0)', () => {
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(ctxPur.budgetJourFusionExec_(props({ DriveAI_FUSION_EXEC_JOUR: '2026/08/05|120000' }), '2026/08/05'), 120000);
  assert.strictEqual(ctxPur.budgetJourFusionExec_(props({ DriveAI_FUSION_EXEC_JOUR: '2026/08/04|120000' }), '2026/08/05'), 0);
  assert.strictEqual(ctxPur.budgetJourFusionExec_(props({}), '2026/08/05'), 0);
});

const row = (domaine, groupe, role, nom, id, action) => ['t', domaine, groupe, role, nom, 0, id, action, ''];
const HEAD = ['Horodaté', 'Domaine', 'Groupe', 'Rôle', 'Dossier', 'Nb fichiers', 'ID dossier', 'Action', 'Statut'];

test('fusionsAExecuter_ : join groupe→cible ; seul « Fusionner » ; Ignorer/structurel/À VALIDER et source==cible exclus', () => {
  const lignes = [
    HEAD,
    row('04 · Immigration', '04 · Immigration#1', 'CIBLE', 'IRCC (fédéral)', 'CIB1', 'À VALIDER'),
    row('04 · Immigration', '04 · Immigration#1', 'source', 'IRCC', 'S1', 'Fusionner'),
    row('04 · Immigration', '04 · Immigration#1', 'source', 'Immigration, R.C.C.', 'S2', 'Ignorer'),
    row('04 · Immigration', '04 · Immigration#1', 'source', 'MIFI (Québec)', 'S5', 'Ignorer (structurel)'),
    row('04 · Immigration', '04 · Immigration#1', 'source', 'copie-de-la-cible', 'CIB1', 'Fusionner'), // source==cible → exclu
    row('06 · Études & diplômes', '06 · Études & diplômes#1', 'CIBLE', 'IUT Du Littoral', 'CIB2', 'À VALIDER'),
    row('06 · Études & diplômes', '06 · Études & diplômes#1', 'source', 'IUT De Lyon', 'S3', 'Ignorer'), // faux positif rejeté
    row('06 · Études & diplômes', '06 · Études & diplômes#1', 'source', 'IUT Littoral (bis)', 'S4', 'À VALIDER'), // non curé
  ];
  const out = ctxPur.fusionsAExecuter_(lignes);
  assert.strictEqual(out.length, 1, 'une seule fusion à exécuter');
  assert.deepStrictEqual(plat(out[0]), { sourceId: 'S1', sourceNom: 'IRCC', cibleId: 'CIB1', domaine: '04 · Immigration', groupe: '04 · Immigration#1' });
});

test('fusionsAExecuter_ : un groupe SANS ligne CIBLE ne produit aucune fusion (fail-safe)', () => {
  const lignes = [HEAD, row('05 · Carrière', 'g', 'source', 'Robovic Inc.', 'S9', 'Fusionner')];
  assert.strictEqual(ctxPur.fusionsAExecuter_(lignes).length, 0);
});

/* ---------- Gardes de mutation (mocks) : deplacerFichierFusion_ ---------- */

function mkFichier(opts) {
  opts = opts || {};
  const moves = [];
  const parents = opts.parents || ['SRC'];
  const f = {
    getId: () => opts.id || 'F1',
    getName: () => opts.nom || 'doc.pdf',
    getMimeType: () => opts.mime || 'application/pdf',
    getParents: () => { let i = 0; return { hasNext: () => i < parents.length, next: () => ({ getId: () => parents[i++] }) }; },
    moveTo: (d) => moves.push(d.getId()),
  };
  return { f, moves };
}

function ctxFile(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'FusionExec.gs']);
  const index = {}; const ajouts = [];
  c.indexContient_ = (k) => !!index[k] || (opts.dejaKeye && k === opts.dejaKeye);
  c.indexAjouter_ = (k, dec) => { index[k] = true; ajouts.push({ cle: k, statut: dec.statut }); };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.nbParentsBorne_ = (f) => (opts.multiParents ? 2 : 1);
  return { c, ajouts };
}

const CIBLE = { getId: () => 'CIBLE' };

test('deplacerFichierFusion_ : cas nominal → moveTo vers la cible + clé fusionexec posée APRÈS', () => {
  const { c, ajouts } = ctxFile();
  const { f, moves } = mkFichier({ id: 'F1' });
  assert.strictEqual(c.deplacerFichierFusion_(f, CIBLE, false, { proteges: {}, tag: 'fusionexec-1' }), 'fait');
  assert.deepStrictEqual(moves, ['CIBLE']);
  assert.deepStrictEqual(ajouts, [{ cle: 'fusionexec|fusionexec-1|F1', statut: 'fusionné' }]);
});

test('deplacerFichierFusion_ : hors-04, un fichier sous ZONE PROTÉGÉE n\'est JAMAIS déplacé (§1 échec-fermé)', () => {
  const { c } = ctxFile({ protege: true });
  const { f, moves } = mkFichier();
  assert.strictEqual(c.deplacerFichierFusion_(f, CIBLE, false /* hors 04 */, { proteges: { X: true }, tag: 't' }), 'saute');
  assert.deepStrictEqual(moves, [], 'aucun moveTo : abstention §1');
});

test('deplacerFichierFusion_ : en 04 (interne §2.1b), la garde §1 ne bloque PAS le déplacement interne', () => {
  const { c } = ctxFile({ protege: true }); // aParentProtege_ dirait true, mais domaine04=true court-circuite
  const { f, moves } = mkFichier();
  assert.strictEqual(c.deplacerFichierFusion_(f, CIBLE, true /* 04 interne */, { proteges: { X: true }, tag: 't' }), 'fait');
  assert.deepStrictEqual(moves, ['CIBLE'], 'interne 04 autorisé (cible déjà validée sous 04 par cibleFusionValide_)');
});

test('deplacerFichierFusion_ : MULTI-PARENTS jamais déplacé (moveTo détacherait tous les parents)', () => {
  const { c } = ctxFile({ multiParents: true });
  const { f, moves } = mkFichier();
  assert.strictEqual(c.deplacerFichierFusion_(f, CIBLE, false, { proteges: {}, tag: 't' }), 'saute');
  assert.deepStrictEqual(moves, []);
});

test('deplacerFichierFusion_ : un SOUS-DOSSIER n\'est jamais déplacé (on ne fond que les fichiers directs)', () => {
  const { c } = ctxFile();
  const { f, moves } = mkFichier({ mime: 'application/vnd.google-apps.folder' });
  assert.strictEqual(c.deplacerFichierFusion_(f, CIBLE, false, { proteges: {}, tag: 't' }), 'saute');
  assert.deepStrictEqual(moves, []);
});

test('deplacerFichierFusion_ : déjà keyé (rejeu) → no-op ; déjà DANS la cible → aucun moveTo', () => {
  const rejeu = ctxFile({ dejaKeye: 'fusionexec|t|F1' });
  const a = mkFichier({ id: 'F1' });
  assert.strictEqual(rejeu.c.deplacerFichierFusion_(a.f, CIBLE, false, { proteges: {}, tag: 't' }), 'saute');
  assert.deepStrictEqual(a.moves, []);

  const enPlace = ctxFile();
  const b = mkFichier({ id: 'F2', parents: ['CIBLE'] }); // parent = la cible
  assert.strictEqual(enPlace.c.deplacerFichierFusion_(b.f, CIBLE, false, { proteges: {}, tag: 't' }), 'fait');
  assert.deepStrictEqual(b.moves, [], 'déjà en place : aucun moveTo (rejeu sûr)');
});

/* ---------- cibleFusionValide_ : cible sous le domaine, non corbeillée ---------- */

function ctxCible(opts) {
  const c = load(['Config.gs', 'FusionExec.gs']);
  c.segmentsSousDomaine_ = (dossier) => (opts.sousDomaine ? ['x'] : null);
  c.DriveApp = { getFolderById: (id) => { if (opts.absent) throw new Error('absent'); return { getId: () => id, isTrashed: () => !!opts.corbeille }; } };
  return c;
}

test('cibleFusionValide_ : refuse une cible corbeillée / hors domaine / illisible ; accepte sous le domaine', () => {
  assert.ok(ctxCible({ sousDomaine: true }).cibleFusionValide_('CIB', '04 · Immigration'), 'sous 04 → OK');
  assert.strictEqual(ctxCible({ sousDomaine: false }).cibleFusionValide_('CIB', '04 · Immigration'), null, 'hors domaine → refus (04 : anti-sortie §2.1b)');
  assert.strictEqual(ctxCible({ sousDomaine: true, corbeille: true }).cibleFusionValide_('CIB', '02 · Finances'), null, 'corbeillée → refus');
  assert.strictEqual(ctxCible({ absent: true }).cibleFusionValide_('CIB', '02 · Finances'), null, 'illisible → refus');
  assert.strictEqual(ctxCible({ sousDomaine: true }).cibleFusionValide_('CIB', 'Domaine inconnu'), null, 'domaine inconnu → refus');
});

/* ---------- appliquerUneSourceFusion_ : drainage → re-pointage + coquille vide + clé de ligne ---------- */

function ctxSource(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'FusionExec.gs']);
  const index = {}; const ajouts = []; const repoints = []; const vides = [];
  c.indexContient_ = (k) => !!index[k];
  c.indexAjouter_ = (k, dec) => { index[k] = true; ajouts.push({ cle: k, statut: dec.statut }); };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.aParentProtege_ = () => false;
  c.nbParentsBorne_ = () => 1;
  c.segmentsSousDomaine_ = () => (opts.sourceHorsDomaine ? null : ['x']);
  c.estAncreStructurelleFusion_ = (dom, nom) => !!(opts.structurel && opts.structurel(nom)); // par défaut : rien de structurel
  c.repointerEntites_ = (a, b) => repoints.push([a, b]);
  c.detecterDossierVide_ = (d) => vides.push(d.getId());
  const files = (opts.fichiers || ['A', 'B']).map((id) => ({
    getId: () => id, getName: () => id + '.pdf', getMimeType: () => 'application/pdf',
    getParents: () => ({ hasNext: () => false, next: () => null }),
    moveTo: () => { if (opts.moveThrow && opts.moveThrow(id)) throw new Error('move refusé'); },
  }));
  const src = { getId: () => opts.sourceId || 'SRC', getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; } };
  c.DriveApp = { getFolderById: (id) => { if (opts.sourceAbsente) throw new Error('absent'); return src; }, getFileById: (id) => files.find((f) => f.getId() === id) };
  return { c, ajouts, repoints, vides };
}

test('appliquerUneSourceFusion_ : source drainée → repointerEntites_(source→cible) + vide-candidat + clé fusrow', () => {
  const { c, ajouts, repoints, vides } = ctxSource({ sourceId: 'SRC', fichiers: ['A', 'B'] });
  const cible = { getId: () => 'CIBLE', getName: () => 'Cible' };
  const r = c.appliquerUneSourceFusion_({ sourceId: 'SRC', sourceNom: 'Robovic Inc.', cibleId: 'CIBLE', domaine: '05 · Carrière', groupe: 'g' }, cible, { proteges: {}, tag: 'fusionexec-1' }, () => false);
  assert.strictEqual(r.draine, true);
  assert.strictEqual(r.faits, 2, 'les 2 fichiers directs fondus');
  assert.deepStrictEqual(repoints, [['SRC', 'CIBLE']], 'contrat C21-06 : entités re-pointées vers la cible');
  assert.deepStrictEqual(vides, ['SRC'], 'la coquille vidée est signalée (vide-candidat, corbeille = app)');
  assert.ok(ajouts.some((a) => a.cle === 'fusrow|fusionexec-1|SRC' && a.statut === 'fusion-source-drainée'));
});

test('appliquerUneSourceFusion_ : source hors de son domaine → REFUS fail-closed (aucun move, aucune coquille)', () => {
  const { c, repoints, vides, ajouts } = ctxSource({ sourceHorsDomaine: true });
  const cible = { getId: () => 'CIBLE', getName: () => 'Cible' };
  const r = c.appliquerUneSourceFusion_({ sourceId: 'SRC', sourceNom: 'X', cibleId: 'CIBLE', domaine: '05 · Carrière', groupe: 'g' }, cible, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r.faits, 0);
  assert.deepStrictEqual(repoints, []);
  assert.deepStrictEqual(vides, []);
  assert.ok(ajouts.some((a) => a.statut === 'fusion-source-hors-domaine'));
});

test('appliquerUneSourceFusion_ : une SOURCE structurelle (bucket reset) est REFUSÉE (jamais vidée) — sauf dédup de même nom', () => {
  // Défense en profondeur (revue structure-keeper) : même si Marc force « Fusionner » sur un bucket du
  // reset, PR2 refuse de le vider (le reset le recrée PAR NOM → non convergent + corbeille d'un canonique).
  const refus = ctxSource({ sourceId: 'BANQUES', structurel: (nom) => nom === 'Banques' });
  const cible = { getId: () => 'AUTRE', getName: () => 'Comptes' };
  const r = refus.c.appliquerUneSourceFusion_({ sourceId: 'BANQUES', sourceNom: 'Banques', cibleId: 'AUTRE', domaine: '02 · Finances', groupe: 'g' }, cible, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r.faits, 0);
  assert.deepStrictEqual(refus.repoints, [], 'aucun move, aucun re-pointage');
  assert.ok(refus.ajouts.some((a) => a.statut === 'fusion-source-structurelle'));

  // Exception : dé-duplication d'un doublon de MÊME NOM (source.nom === cible.nom) — autorisée.
  const dedup = ctxSource({ sourceId: 'DUP', fichiers: ['A'], structurel: (nom) => nom === 'Banques' });
  const cibleMemeNom = { getId: () => 'CANON', getName: () => 'Banques' };
  const r2 = dedup.c.appliquerUneSourceFusion_({ sourceId: 'DUP', sourceNom: 'Banques', cibleId: 'CANON', domaine: '02 · Finances', groupe: 'g' }, cibleMemeNom, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r2.faits, 1, 'dédup de même nom : le doublon est fondu dans le canonique');
});

test('appliquerUneSourceFusion_ : cible STRUCTURELLE → fichiers fondus MAIS pas de re-pointage d\'entité (jamais vers un fourre-tout)', () => {
  // Ex. 04 : fondre « IRCC » (legacy) dans le bucket « IRCC (fédéral) ». Les fichiers bougent, mais on
  // ne re-pointe AUCUNE entité vers un bucket structurel (taxonomie : un regroupement n'est pas une cible de routage).
  const { c, repoints, ajouts } = ctxSource({ sourceId: 'IRCCLEG', fichiers: ['A'], structurel: (nom) => nom === 'IRCC (fédéral)' });
  const cible = { getId: () => 'IRCCBUCKET', getName: () => 'IRCC (fédéral)' };
  const r = c.appliquerUneSourceFusion_({ sourceId: 'IRCCLEG', sourceNom: 'IRCC', cibleId: 'IRCCBUCKET', domaine: '04 · Immigration', groupe: 'g' }, cible, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r.faits, 1, 'les fichiers legacy sont bien fondus dans le bucket');
  assert.deepStrictEqual(repoints, [], 'aucun re-pointage vers un bucket structurel');
  assert.ok(ajouts.some((a) => a.statut === 'fusion-source-drainée'));
});

test('fondreSourceFichiers_ : un moveTo qui ÉCHOUE laisse le fichier en place SANS bloquer le drainage de la source', () => {
  // Convergence (revue code-reviewer/security) : pas de compteur d'essais — un fichier au move en échec
  // est laissé + journalisé, la source draine quand même (jamais re-scannée à vie sur un fichier bloqué).
  const { c } = ctxSource({ sourceId: 'SRC', fichiers: ['A', 'BAD', 'C'], moveThrow: (id) => id === 'BAD' });
  const cible = { getId: () => 'CIBLE', getName: () => 'Cible' };
  const r = c.appliquerUneSourceFusion_({ sourceId: 'SRC', sourceNom: 'Robovic', cibleId: 'CIBLE', domaine: '05 · Carrière', groupe: 'g' }, cible, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r.draine, true, 'la source draine malgré le fichier en échec');
  assert.strictEqual(r.faits, 2, 'les 2 fichiers OK sont fondus, le 3ᵉ (échec) reste en place');
});

test('fondreSourceFichiers_ : STALL — ≥ cap fichiers indéplaçables ⇒ source « bloquée » (ne re-scanne pas à vie)', () => {
  // ≥ FUSION_EXEC_MAX_FICHIERS_PAR_SOURCE fichiers de tête tous multi-parents ⇒ jamais drainée. On la
  // marque « bloquée » pour que FINI puisse être posé (sinon re-scan indéfini).
  const c = load(['Config.gs', 'FusionExec.gs']);
  const N = c.CONFIG.FUSION_EXEC_MAX_FICHIERS_PAR_SOURCE + 5;
  const ajouts = [];
  c.indexContient_ = () => false; c.indexAjouter_ = (k, d) => ajouts.push(d.statut);
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.aParentProtege_ = () => false; c.nbParentsBorne_ = () => 2; // TOUS multi-parents → tous « saute »
  c.segmentsSousDomaine_ = () => ['x']; c.estAncreStructurelleFusion_ = () => false;
  c.repointerEntites_ = () => {}; c.detecterDossierVide_ = () => {};
  const files = Array.from({ length: N }, (_, i) => ({ getId: () => 'F' + i, getName: () => 'f', getMimeType: () => 'application/pdf', getParents: () => ({ hasNext: () => false, next: () => null }), moveTo: () => {} }));
  const src = { getId: () => 'SRC', getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; } };
  c.DriveApp = { getFolderById: () => src, getFileById: (id) => files.find((f) => f.getId() === id) };
  const r = c.appliquerUneSourceFusion_({ sourceId: 'SRC', sourceNom: 'X', cibleId: 'C', domaine: '05 · Carrière', groupe: 'g' }, { getId: () => 'C', getName: () => 'C' }, { proteges: {}, tag: 't' }, () => false);
  assert.strictEqual(r.draine, true, '« bloquée » compte comme terminée (ne pas re-scanner)');
  assert.strictEqual(r.faits, 0);
  assert.ok(ajouts.includes('fusion-source-bloquée'));
});

/* ---------- appliquerPlanFusion_ : orchestration (FINI / resteAFaire / plafond / cible invalide) ---------- */

function ctxPlan(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'FusionExec.gs']);
  c.COLONNES_PLAN_FUSION = HEAD; // défini dans Journal.gs (non chargé) — seule sa .length sert (range)
  c.CONFIG.FUSION_EXEC_ACTIF = true; // FORCE le flag (décision de campagne, jamais un invariant de test)
  c.CONFIG.FUSION_EXEC_BUDGET_JOUR_MS = 6 * 60 * 1000; // idem : le budget prod est PARKÉ à 0 (réalloc 2026-08-11
  // → CONSOLIDATION_EXEC pendant que la fusion est OFF) ; ce test exerce la LOGIQUE de l'exécuteur, il force
  // donc un budget de travail comme il force le flag (sinon `0 >= 0` court-circuiterait le chemin testé).
  const store = Object.assign({}, opts.props);
  const P = { getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } };
  c.PropertiesService = { getScriptProperties: () => P };
  c.dateGmail_ = () => '2026/08/05';
  c.ensembleDomainesProteges_ = () => ({});
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  const keyes = {}; (opts.dejaKeyes || []).forEach((k) => { keyes[k] = true; });
  c.indexContient_ = (k) => !!keyes[k];
  c.indexAjouter_ = (k) => { keyes[k] = true; };
  const rows = opts.rows || [];
  const full = [HEAD].concat(rows);
  c.feuille_ = () => ({ getLastRow: () => (rows.length ? rows.length + 1 : 1), getRange: () => ({ getValues: () => full }) });
  c.cibleFusionValide_ = (id) => (opts.cibleInvalide ? null : { getId: () => id, getName: () => 'C' });
  const traites = [];
  c.appliquerUneSourceFusion_ = (s) => { traites.push(s.sourceId); return (opts.outcome ? opts.outcome(s) : { draine: true, faits: 1 }); };
  return { c, store, traites };
}

test('appliquerPlanFusion_ : plan vide → FINI posé (court-circuit ensuite)', () => {
  const { c, store } = ctxPlan({ rows: [] });
  c.appliquerPlanFusion_(() => false);
  assert.strictEqual(store.DriveAI_FUSION_EXEC_FINI, 'fusionexec-1');
});

test('appliquerPlanFusion_ : toutes les sources drainées → sources traitées + FINI posé', () => {
  const rows = [
    row('05 · Carrière', 'g1', 'CIBLE', 'Robovic', 'CIB', 'À VALIDER'),
    row('05 · Carrière', 'g1', 'source', 'Robovic Inc.', 'S1', 'Fusionner'),
  ];
  const { c, store, traites } = ctxPlan({ rows });
  c.appliquerPlanFusion_(() => false);
  assert.deepStrictEqual(traites, ['S1']);
  assert.strictEqual(store.DriveAI_FUSION_EXEC_FINI, 'fusionexec-1', 'plan drainé → terminal');
});

test('appliquerPlanFusion_ : une source NON drainée (budget coupé au milieu) → PAS de FINI (reprise au run suivant)', () => {
  const rows = [
    row('05 · Carrière', 'g1', 'CIBLE', 'Robovic', 'CIB', 'À VALIDER'),
    row('05 · Carrière', 'g1', 'source', 'Robovic Inc.', 'S1', 'Fusionner'),
  ];
  const { c, store } = ctxPlan({ rows, outcome: () => ({ draine: false, faits: 3 }) });
  c.appliquerPlanFusion_(() => false);
  assert.strictEqual(store.DriveAI_FUSION_EXEC_FINI, undefined, 'travail restant ⇒ jamais FINI');
});

test('appliquerPlanFusion_ : cible invalide → source NON traitée (fusrow inscrit) mais le plan peut se terminer', () => {
  const rows = [
    row('05 · Carrière', 'g1', 'CIBLE', 'Robovic', 'CIB', 'À VALIDER'),
    row('05 · Carrière', 'g1', 'source', 'Robovic Inc.', 'S1', 'Fusionner'),
  ];
  const { c, store, traites } = ctxPlan({ rows, cibleInvalide: true });
  c.appliquerPlanFusion_(() => false);
  assert.deepStrictEqual(traites, [], 'cible invalide : appliquerUneSourceFusion_ jamais appelée');
  assert.strictEqual(store.DriveAI_FUSION_EXEC_FINI, 'fusionexec-1', 'la source terminale n\'empêche pas FINI');
});

test('appliquerPlanFusion_ : FINI déjà posé pour le tag → court-circuit immédiat (aucune source traitée)', () => {
  const rows = [
    row('05 · Carrière', 'g1', 'CIBLE', 'Robovic', 'CIB', 'À VALIDER'),
    row('05 · Carrière', 'g1', 'source', 'Robovic Inc.', 'S1', 'Fusionner'),
  ];
  const { c, traites } = ctxPlan({ rows, props: { DriveAI_FUSION_EXEC_FINI: 'fusionexec-1' } });
  c.appliquerPlanFusion_(() => false);
  assert.deepStrictEqual(traites, [], 'tag terminal : rien n\'est re-traité');
});

test('appliquerPlanFusion_ : une source déjà drainée (fusrow keyé) est sautée sans être re-traitée', () => {
  const rows = [
    row('05 · Carrière', 'g1', 'CIBLE', 'Robovic', 'CIB', 'À VALIDER'),
    row('05 · Carrière', 'g1', 'source', 'Robovic Inc.', 'S1', 'Fusionner'),
  ];
  const { c, traites } = ctxPlan({ rows, dejaKeyes: ['fusrow|fusionexec-1|S1'] });
  c.appliquerPlanFusion_(() => false);
  assert.deepStrictEqual(traites, [], 'rejeu : la source déjà drainée n\'est pas re-traitée');
});

/* ---------- VERROU de surface : moveTo = seule mutation Drive de FusionExec.gs ---------- */

test('VERROU surface : FusionExec.gs ne contient AUCUNE mutation Drive hormis moveTo', () => {
  const contenu = fs.readFileSync(path.join(__dirname, '..', 'src', 'FusionExec.gs'), 'utf-8');
  const INTERDITS = ['setTrashed(', '.setName(', 'createFolder(', '.createFile(', 'createShortcut(',
    'addFile(', 'removeFile(', 'UrlFetchApp.fetch(', 'setContent('];
  const viol = INTERDITS.filter((m) => contenu.includes(m));
  assert.deepStrictEqual(viol, [], 'moveTo est la SEULE mutation permise (jamais de suppression/renommage/création) : ' + viol.join(', '));
});
