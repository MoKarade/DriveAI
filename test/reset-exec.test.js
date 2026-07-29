'use strict';
/**
 * RESET C28-33 (ADR-0030) — partie I/O (PR2) : rassemblement 01-09 (04 exclu) → `_TRI 2026/<domaine>`,
 * dédup + rapport quasi-doublons, placement par `cheminCibleReset_` (règle PURE de PR1, exercée
 * pour de vrai ici) avec re-pointage d'entité, réorganisation INTERNE de 04 (CLAUDE.md §2.1b révisé —
 * cible TOUJOURS construite depuis la racine 04, jamais un chemin arbitraire), suspension de conso-2/
 * réorg-auto pendant le reset. Mêmes gardes que ConsolidationExec (§1 par mutation, multi-parents
 * jamais déplacés, déplacement seul — verrou de surface).
 *
 * Isolation à la ConsolidationExec.gs : seules les dépendances RÉELLES et déjà testées (`normaliserCle_`,
 * `analyserNomClasse_`, `cheminCibleReset_`) sont chargées ; le reste (Drive, Sheet, résolveurs
 * cross-module) est injecté, pour des tests rapides et non fragiles.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctxPur = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);

/* ---------- Fonctions PURES ---------- */

test('budgetJourReset_ : ms réelles du jour seulement (rollover → 0)', () => {
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(ctxPur.budgetJourReset_(props({ X: '2026/07/29|180000' }), 'X', '2026/07/29'), 180000);
  assert.strictEqual(ctxPur.budgetJourReset_(props({ X: '2026/07/28|180000' }), 'X', '2026/07/29'), 0);
  assert.strictEqual(ctxPur.budgetJourReset_(props({}), 'X', '2026/07/29'), 0);
});

test('domainesRassemblesReset_ : 04 EXCLU, les domaines AUTO (07/09) inclus', () => {
  const doms = ctxPur.domainesRassemblesReset_();
  assert.ok(doms.indexOf('04 · Immigration') === -1, '04 jamais rassemblée (ADR-0030 §4)');
  assert.ok(doms.indexOf('02 · Finances') !== -1);
  assert.ok(doms.indexOf('07 · Santé') !== -1, 'domaine AUTO inclus');
  assert.ok(doms.indexOf('09 · Voyages') !== -1, 'domaine AUTO inclus');
});

test('resetTermine_ / resetEnCours_ : les 3 phases doivent être au tag courant ; RESET_ACTIF: false libère immédiatement', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const props = {};
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
  const tag = c.CONFIG.RESET_TAG;

  assert.strictEqual(c.resetTermine_(), false, 'rien de fait → pas terminé');
  assert.strictEqual(c.resetEnCours_(), true, 'RESET_ACTIF par défaut → en cours');

  props.DriveAI_RESET_RASSEMBLEMENT = tag;
  props.DriveAI_RESET_PLACEMENT = tag;
  assert.strictEqual(c.resetTermine_(), false, '04 interne pas encore fait');

  props.DriveAI_RESET_04 = tag;
  assert.strictEqual(c.resetTermine_(), true, 'les 3 phases au tag → terminé');
  assert.strictEqual(c.resetEnCours_(), false);

  // RESET_ACTIF: false (suspension manuelle) → plus « en cours », MÊME si les phases ne sont pas finies.
  delete props.DriveAI_RESET_04;
  c.CONFIG.RESET_ACTIF = false;
  assert.strictEqual(c.resetEnCours_(), false, 'suspension manuelle libère conso-2/réorg-auto immédiatement');
});

/* ---------- Rassemblement : domaine → `_TRI 2026/<domaine>` ---------- */

function fakeFichierReset(opts) {
  opts = opts || {};
  return {
    getId: () => opts.id || 'F1',
    getName: () => opts.nom || 'f.pdf',
    getSize: () => (opts.taille !== undefined ? opts.taille : 100),
    getBlob: () => ({ id: opts.id || 'F1' }), // porte l'id pour que le mock empreinteBlob_ varie PAR FICHIER
    getParents: () => {
      const arr = opts.parents || [];
      let i = 0;
      return { hasNext: () => i < arr.length, next: () => arr[i++] };
    },
  };
}

function fakeDossierReset(id, log) {
  return {
    getId: () => id,
    addFile: (f) => log.push({ op: 'add', dossier: id, file: f.getId() }),
    removeFile: (f) => log.push({ op: 'remove', dossier: id, file: f.getId() }),
  };
}

function ctxRassemblement(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = {};
  const ajouts = [];
  const log = [];
  const videAppels = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec) => { index[cle] = true; ajouts.push({ cle: cle, statut: dec.statut, domaine: dec.domaine, chemin: dec.chemin }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.nbParentsBorne_ = () => (opts.multiParents ? 2 : 1);
  c.detecterDossierVide_ = (parent) => videAppels.push(parent.getId());
  c.dossierRacineParNom_ = (nom) => fakeDossierReset('RACINE:' + nom, log);
  c.sousDossier_ = (parent, nom) => fakeDossierReset(parent.getId() + '/' + nom, log);
  const ancienParent = opts.sansParent ? null : fakeDossierReset(opts.ancienId || 'ANCIEN', log);
  const fichier = fakeFichierReset({ id: opts.id || 'F1', nom: opts.nom || 'f.pdf', parents: ancienParent ? [ancienParent] : [] });
  c.DriveApp = { getFileById: (id) => { if (opts.absent) throw new Error('absent'); return fichier; } };
  return { c, ajouts, log, videAppels };
}

test('rassemblerUnFichier_ : zone protégée → JAMAIS déplacé (échec-fermé §1)', () => {
  const { c, log, ajouts } = ctxRassemblement({ protege: true });
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-protege');
});

test('rassemblerUnFichier_ : multi-parents → jamais déplacé (prudence, patron ConsolidationExec)', () => {
  const { c, log, ajouts } = ctxRassemblement({ multiParents: true });
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-multiparents');
});

test('rassemblerUnFichier_ : cas nominal → addFile(_TRI/<domaine>) PUIS removeFile(ancien), clé posée, coquille vide vérifiée', () => {
  const { c, log, ajouts, videAppels } = ctxRassemblement({ ancienId: 'ENGIE' });
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, true);
  assert.deepStrictEqual(log, [
    { op: 'add', dossier: 'RACINE:' + c.CONFIG.RESET_TRI_NOM + '/02 · Finances', file: 'F1' },
    { op: 'remove', dossier: 'ENGIE', file: 'F1' },
  ], 'ajoute la cible AVANT de retirer (jamais orphelin)');
  assert.strictEqual(ajouts[0].statut, 'tri33-rassemble');
  assert.strictEqual(ajouts[0].chemin, c.CONFIG.RESET_TRI_NOM + '/02 · Finances');
  assert.deepStrictEqual(videAppels, ['ENGIE'], 'le dossier QUITTÉ est vérifié pour un vide-candidat');
});

test('rassemblerUnFichier_ : déjà dans `_TRI` (rejeu) → aucun mouvement, mais la clé se pose', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  const cibleId = 'RACINE:' + c0.CONFIG.RESET_TRI_NOM + '/02 · Finances';
  const { c, log, ajouts, videAppels } = ctxRassemblement({ ancienId: cibleId });
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-rassemble');
  assert.deepStrictEqual(videAppels, [], 'déjà en place : pas de coquille vide à vérifier');
});

test('rassemblerUnFichier_ : déjà tenté (clé présente) → court-circuit total, zéro appel Drive', () => {
  const { c, log, ajouts } = ctxRassemblement({});
  c.indexContient_ = () => true;
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.deepStrictEqual(ajouts, []);
});

test('rassemblerUnFichier_ : fichier disparu (getFileById lève) → tracé, jamais bloquant', () => {
  const { c, ajouts } = ctxRassemblement({ absent: true });
  const r = c.rassemblerUnFichier_('F1', '02 · Finances', 'tag', {}, {});
  assert.strictEqual(r, false);
  assert.strictEqual(ajouts[0].statut, 'tri33-absent');
});

/* ---------- Placement : dédup + routage par le NOM depuis `_TRI 2026/<domaine>` ---------- */

function ctxPlacement(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = {};
  const ajouts = [];
  const log = [];
  const videAppels = [];
  const repointages = [];
  let lignesReset = [['Clé']];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec, emp) => { index[cle] = true; ajouts.push({ cle: cle, statut: dec.statut, domaine: dec.domaine, chemin: dec.chemin, empreinte: emp }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.nbParentsBorne_ = () => (opts.multiParents ? 2 : 1);
  // Dérivée du BLOB (donc du fichier réellement passé) — jamais figée sur le fichier de construction du
  // contexte, sinon un 2ᵉ fichier traité avec le MÊME `c` (mêmes mocks) hériterait de la 1ʳᵉ empreinte.
  c.empreinteBlob_ = (blob) => (opts.empreinte !== undefined ? opts.empreinte : 'EMP:' + blob.id);
  c.dossierDoublons_ = () => fakeDossierReset('DOUBLONS', log);
  c.idDomaine_ = (dom) => 'DOM:' + dom;
  c.sousDossier_ = (parent, nom) => fakeDossierReset(parent.getId() + '/' + nom, log);
  c.cleCanoniqueEntite_ = () => (opts.cleEntite !== undefined ? opts.cleEntite : null);
  c.repointerEntites_ = (src, cible) => repointages.push([src, cible]);
  c.detecterDossierVide_ = (parent) => videAppels.push(parent.getId());
  c.feuille_ = () => ({
    getLastRow: () => lignesReset.length,
    getRange: (r, col, nb) => ({ getValues: () => lignesReset.slice(r - 1, r - 1 + nb).map((row) => [row[0]]) }),
    appendRow: (row) => { lignesReset.push([row[0]]); ajoutsRapport.push(row); },
  });
  const ajoutsRapport = [];
  c.DriveApp = { getFolderById: (id) => fakeDossierReset(id, log) };
  const ancienParent = opts.sansParent ? null : fakeDossierReset(opts.ancienId || ('RACINE:' + c.CONFIG.RESET_TRI_NOM + '/' + (opts.domaine || '02 · Finances')), log);
  const fichier = fakeFichierReset({ id: opts.id || 'F1', nom: opts.nom, taille: opts.taille, parents: ancienParent ? [ancienParent] : [] });
  return { c, ajouts, log, videAppels, repointages, ajoutsRapport, fichier };
}

test('placerUnFichierReset_ : zone protégée → JAMAIS déplacé (§1 re-vérifiée au PLACEMENT, pas seulement au rassemblement — revue sécurité C28-33)', () => {
  // Le rassemblement et le placement sont deux campagnes SÉPARÉES, bornées par des budgets
  // quotidiens INDÉPENDANTS : un fichier peut attendre des jours dans `_TRI` avant d'être placé.
  // Pendant cette fenêtre, un geste Drive normal (« Ajouter à un dossier ») peut lui donner un
  // second parent sous 04 · Immigration — la garde doit donc se re-vérifier ICI aussi, pas
  // seulement à la collecte du rassemblement.
  const { c, log, ajouts, fichier } = ctxPlacement({ id: 'F9', nom: 'x.pdf', domaine: '02 · Finances', protege: true });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const r = c.placerUnFichierReset_(fichier, '02 · Finances', 'tri33p|tag|F9', ctxObj);
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33p-protege');
});

test('placerUnFichierReset_ : multi-parents → jamais déplacé au placement (même prudence que le rassemblement)', () => {
  const { c, log, ajouts, fichier } = ctxPlacement({ id: 'F10', nom: 'x.pdf', domaine: '02 · Finances', multiParents: true });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const r = c.placerUnFichierReset_(fichier, '02 · Finances', 'tri33p|tag|F10', ctxObj);
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33p-multiparents');
});

test('placerUnFichierReset_ : DOUBLON exact (empreinte déjà vue) → `_Doublons` (déplacement seul), jamais deviné par le nom', () => {
  const { c, log, ajouts, fichier } = ctxPlacement({ id: 'F2', nom: 'copie.pdf', domaine: '02 · Finances' });
  const ctxObj = { empreintesVues: { 'EMP:F2': 'F1' }, validees: {}, repointes: {} }; // F1 porte déjà cette empreinte
  const cle = 'tri33p|tag|F2';
  const r = c.placerUnFichierReset_(fichier, '02 · Finances', cle, ctxObj);
  assert.strictEqual(r, true);
  assert.deepStrictEqual(log.filter((l) => l.op === 'add'), [{ op: 'add', dossier: 'DOUBLONS', file: 'F2' }]);
  assert.strictEqual(ajouts[0].statut, 'tri33-doublon');
  assert.strictEqual(ajouts[0].chemin, '_Doublons');
});

test('placerUnFichierReset_ : routé PAR LE NOM (règle PURE de PR1) → dossier structuré sous le domaine', () => {
  const { c, log, ajouts, fichier } = ctxPlacement({ id: 'F3', nom: '2026-03_Relevé_Desjardins.pdf', domaine: '02 · Finances' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const r = c.placerUnFichierReset_(fichier, '02 · Finances', 'tri33p|tag|F3', ctxObj);
  assert.strictEqual(r, true);
  assert.deepStrictEqual(log.filter((l) => l.op === 'add'), [{ op: 'add', dossier: 'DOM:02 · Finances/Relevés/2026', file: 'F3' }]);
  assert.strictEqual(ajouts[0].statut, 'tri33-route');
  assert.strictEqual(ajouts[0].chemin, '02 · Finances/Relevés/2026');
});

test('placerUnFichierReset_ : NON routé → reste dans `_TRI`, rapporté (jamais déplacé, jamais deviné)', () => {
  const { c, log, ajouts, ajoutsRapport, fichier } = ctxPlacement({ id: 'F4', nom: 'IMG_20240101_123456.jpg', domaine: '08 · Perso & projets' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const r = c.placerUnFichierReset_(fichier, '08 · Perso & projets', 'tri33p|tag|F4', ctxObj);
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, [], 'aucun mouvement Drive');
  assert.strictEqual(ajouts[0].statut, 'tri33-reste');
  assert.strictEqual(ajoutsRapport.length, 1);
  assert.strictEqual(ajoutsRapport[0][0], 'nonroute|F4');
  assert.strictEqual(ajoutsRapport[0][5], 'reste en _TRI');
});

test('placerUnFichierReset_ : QUASI-doublon (même nom normalisé, taille différente) → RAPPORT seul, jamais déplacé d\'office', () => {
  const ctx1 = ctxPlacement({ id: 'F5', nom: 'export.jpg', taille: 100, domaine: '08 · Perso & projets' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  ctx1.c.placerUnFichierReset_(ctx1.fichier, '08 · Perso & projets', 'tri33p|tag|F5', ctxObj);

  // Même contexte c (mêmes mocks/feuille), 2ᵉ fichier : même nom normalisé, taille DIFFÉRENTE.
  const fichier2 = fakeFichierReset({ id: 'F6', nom: 'export.jpg', taille: 250, parents: [] });
  ctx1.c.placerUnFichierReset_(fichier2, '08 · Perso & projets', 'tri33p|tag|F6', ctxObj);

  const quasi = ctx1.ajoutsRapport.filter((r) => String(r[0]).indexOf('quasidoublon|') === 0);
  assert.strictEqual(quasi.length, 1, 'un seul signal quasi-doublon (F6, le 2ᵉ vu)');
  assert.strictEqual(quasi[0][0], 'quasidoublon|F6');
  assert.strictEqual(quasi[0][5], 'doublon-probable');
});

test('placerUnFichierReset_ : QUASI-doublon — deux gros fichiers JAMAIS hashés (> OCR_TAILLE_MAX), MÊME taille → rapporté quand même (revue code C28-33)', () => {
  // Une taille identique ne prouve « déjà couvert par le hash » QUE si les deux fichiers ont été
  // RÉELLEMENT hashés (empreinteBlob_ n'est jamais appelée au-delà de OCR_TAILLE_MAX). Sans ce
  // correctif, deux gros homonymes de même taille mais de contenu différent passaient inaperçus
  // des DEUX dédups (ni le hash exact — jamais calculé — ni ce rapport, court-circuité à tort).
  const ctx1 = ctxPlacement({ id: 'G1', nom: 'scan.pdf', taille: 500, empreinte: '', domaine: '08 · Perso & projets' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  ctx1.c.placerUnFichierReset_(ctx1.fichier, '08 · Perso & projets', 'tri33p|tag|G1', ctxObj);

  const fichier2 = fakeFichierReset({ id: 'G2', nom: 'scan.pdf', taille: 500, parents: [] });
  ctx1.c.placerUnFichierReset_(fichier2, '08 · Perso & projets', 'tri33p|tag|G2', ctxObj); // empreinte '' aussi (opts.empreinte fige toute la fonction mockée)

  const quasi = ctx1.ajoutsRapport.filter((r) => String(r[0]).indexOf('quasidoublon|') === 0);
  assert.strictEqual(quasi.length, 1, 'même taille mais NON hashés → rapporté (pas de faux « déjà couvert »)');
  assert.strictEqual(quasi[0][0], 'quasidoublon|G2');
  assert.ok(String(quasi[0][6]).indexOf('NON confirmée par hash') !== -1);
});

test('placerUnFichierReset_ : QUASI-doublon — même taille, LES DEUX vraiment hashés (empreintes différentes → contenu réellement distinct) → aucun rapport', () => {
  // Les deux fichiers SONT hashés (sous OCR_TAILLE_MAX) et ont des empreintes DIFFÉRENTES — le hash
  // exact a donc déjà tranché « pas un doublon » : la coïncidence de taille seule n'a rien à ajouter.
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = {};
  const ajouts = [];
  const log = [];
  let lignesReset = [['Clé']];
  const ajoutsRapport = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec) => { index[cle] = true; ajouts.push({ statut: dec.statut }); };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.aParentProtege_ = () => false; c.nbParentsBorne_ = () => 1;
  c.empreinteBlob_ = (blob) => 'HASH:' + blob.id; // distincte par fichier — jamais un doublon exact
  c.dossierDoublons_ = () => fakeDossierReset('DOUBLONS', log);
  c.idDomaine_ = (dom) => 'DOM:' + dom;
  c.sousDossier_ = (parent, nom) => fakeDossierReset(parent.getId() + '/' + nom, log);
  c.cleCanoniqueEntite_ = () => null;
  c.detecterDossierVide_ = () => {};
  c.feuille_ = () => ({
    getLastRow: () => lignesReset.length,
    getRange: (r, col, nb) => ({ getValues: () => lignesReset.slice(r - 1, r - 1 + nb).map((row) => [row[0]]) }),
    appendRow: (row) => { lignesReset.push([row[0]]); ajoutsRapport.push(row); },
  });
  c.DriveApp = { getFolderById: (id) => fakeDossierReset(id, log) };

  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const f1 = fakeFichierReset({ id: 'H1', nom: 'petit.pdf', taille: 50, parents: [] });
  c.placerUnFichierReset_(f1, '08 · Perso & projets', 'tri33p|tag|H1', ctxObj);
  const f2 = fakeFichierReset({ id: 'H2', nom: 'petit.pdf', taille: 50, parents: [] });
  c.placerUnFichierReset_(f2, '08 · Perso & projets', 'tri33p|tag|H2', ctxObj);

  const quasi = ajoutsRapport.filter((r) => String(r[0]).indexOf('quasidoublon|') === 0);
  assert.strictEqual(quasi.length, 0, 'même taille, tous deux RÉELLEMENT hashés, empreintes différentes → pas un faux positif');
});

test('placerUnFichierReset_ : re-pointe l\'entité VALIDÉE dont le Dossier ID pointait l\'ANCIEN emplacement — DÉDUP réellement exercée sur un 2ᵉ fichier', () => {
  const { c, repointages, fichier } = ctxPlacement({ id: 'F7', nom: '2022-08_Attestation_Boursorama Banque.pdf', domaine: '02 · Finances' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: { CLE: { nom: 'Boursorama', dossierId: 'ANCIEN_BOURSO' } }, repointes: {} };
  c.cleCanoniqueEntite_ = () => 'CLE';
  c.placerUnFichierReset_(fichier, '02 · Finances', 'tri33p|tag|F7', ctxObj);
  assert.deepStrictEqual(repointages, [['ANCIEN_BOURSO', 'DOM:02 · Finances/Banques/Boursorama']]);
  assert.deepStrictEqual(ctxObj.repointes, { ANCIEN_BOURSO: true });

  // 2ᵉ fichier, MÊME entité cible, MÊME ctxObj (même run) : la garde de dédup doit RÉELLEMENT
  // empêcher un 2ᵉ appel — vérifié en rappelant placerUnFichierReset_, pas seulement en relisant l'état.
  const fichier2 = fakeFichierReset({ id: 'F11', nom: '2023-05_Attestation_Boursorama.pdf', parents: [] });
  c.placerUnFichierReset_(fichier2, '02 · Finances', 'tri33p|tag|F11', ctxObj);
  assert.deepStrictEqual(repointages, [['ANCIEN_BOURSO', 'DOM:02 · Finances/Banques/Boursorama']],
    'dédup : un 2ᵉ fichier vers la même entité ne re-pointe pas une 2ᵉ fois');
});

test('placerUnFichierReset_ : déjà en place (rejeu) → aucun addFile/removeFile, clé posée quand même', () => {
  const cibleId = 'DOM:02 · Finances/Relevés/2026';
  const { c, log, ajouts, fichier } = ctxPlacement({ id: 'F8', nom: '2026-03_Relevé_Desjardins.pdf', domaine: '02 · Finances', ancienId: cibleId });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  const r = c.placerUnFichierReset_(fichier, '02 · Finances', 'tri33p|tag|F8', ctxObj);
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-route');
});

/* ---------- 04 · Immigration : réorganisation INTERNE (CLAUDE.md §2.1b révisé) ---------- */

function ctxInterne04(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = {};
  const ajouts = [];
  const log = [];
  const videAppels = [];
  const erreurs = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec) => { index[cle] = true; ajouts.push({ cle: cle, statut: dec.statut }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = (src, msg) => erreurs.push(msg);
  c.nbParentsBorne_ = () => (opts.multiParents ? 2 : 1);
  c.sousDossier_ = (parent, nom) => fakeDossierReset(parent.getId() + '/' + nom, log);
  c.segmentsSousDomaine_ = () => (opts.horsDomaine ? null : []); // [] = descend bien du domaine
  c.detecterDossierVide_ = (parent) => videAppels.push(parent.getId());
  const ancienParent = opts.sansParent ? null : fakeDossierReset(opts.ancienId || 'RACINE04/Formulaires & correspondance', log);
  const fichier = fakeFichierReset({ id: opts.id || 'F1', nom: opts.nom, parents: ancienParent ? [ancienParent] : [] });
  c.DriveApp = { getFolderById: (id) => { if (opts.racineAbsente) throw new Error('racine absente'); return fakeDossierReset('RACINE04', log); }, getFileById: () => fichier };
  return { c, ajouts, log, videAppels, erreurs };
}

test('reorganiserInterne04_ : multi-parents → jamais déplacé (même prudence que ConsolidationExec)', () => {
  const { c, log, ajouts } = ctxInterne04({ multiParents: true, nom: '2024-11_Permis de travail_IRCC.pdf' });
  const r = c.reorganiserInterne04_('F1', 'tag', {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-04-multiparents');
});

test('reorganiserInterne04_ : non routé (ex. doc bancaire ambigu « CIC ») → reste À SA PLACE, jamais de sortie', () => {
  const { c, log, ajouts } = ctxInterne04({ nom: '2015-01_Relevé_CIC Nord Ouest.pdf' });
  const r = c.reorganiserInterne04_('F1', 'tag', {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(ajouts[0].statut, 'tri33-04-reste');
});

test('reorganiserInterne04_ : routé → déplacé DEDANS 04, cible construite depuis la racine 04', () => {
  const { c, log, ajouts, videAppels } = ctxInterne04({ nom: '2024-11_Permis de travail_IRCC.pdf', ancienId: 'RACINE04/Formulaires & correspondance' });
  const r = c.reorganiserInterne04_('F1', 'tag', {});
  assert.strictEqual(r, true);
  assert.deepStrictEqual(log, [
    { op: 'add', dossier: 'RACINE04/Permis de travail & EIMT', file: 'F1' },
    { op: 'remove', dossier: 'RACINE04/Formulaires & correspondance', file: 'F1' },
  ]);
  assert.strictEqual(ajouts[0].statut, 'tri33-04-route');
  assert.deepStrictEqual(videAppels, ['RACINE04/Formulaires & correspondance']);
});

test('reorganiserInterne04_ : défense en profondeur — cible qui échouerait à segmentsSousDomaine_ (ne devrait jamais arriver) → REFUSÉE, jamais déplacée', () => {
  const { c, log, ajouts, erreurs } = ctxInterne04({ nom: '2024-11_Permis de travail_IRCC.pdf', horsDomaine: true });
  const r = c.reorganiserInterne04_('F1', 'tag', {});
  assert.strictEqual(r, false);
  assert.deepStrictEqual(log, [], 'échec-fermé : zéro mutation malgré une cible résolue');
  assert.strictEqual(ajouts[0].statut, 'tri33-04-refus');
  assert.strictEqual(erreurs.length, 1);
});

test('dossierInterne04Reset_ : construit TOUJOURS depuis dossierRacine04Reset_ — jamais un ID arbitraire (CLAUDE.md §2.1b)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  const debut = src.indexOf('function dossierInterne04Reset_(');
  const fin = src.indexOf('\n}', debut);
  const corps = src.slice(debut, fin);
  assert.ok(corps.includes('dossierRacine04Reset_()'), 'part TOUJOURS de la racine 04');
  assert.ok(!/DriveApp\.getFolderById/.test(corps), 'aucun ID arbitraire injectable — structurellement impossible de sortir de 04');
});

/* ---------- Verrou de surface : addFile/removeFile sont les SEULES mutations (déplacement seul, §2) ---------- */

test('Reset.gs (section I/O) : aucune mutation hors addFile/removeFile (jamais de suppression/renommage/copie/partage/REST)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  const debutIO = src.indexOf('PR2 — CAMPAGNES I/O');
  assert.ok(debutIO !== -1, 'section I/O introuvable');
  const corpsIO = src.slice(debutIO);
  ['setTrashed(', 'setName(', '.createFile(', 'moveTo(', 'removeFolder(', 'addFolder(',
    'makeCopy(', 'setContent(', 'UrlFetchApp', 'files.delete', "'delete'", 'setSharing(', 'addEditor(', 'addViewer(']
    .forEach((motif) => {
      assert.ok(!corpsIO.includes(motif), 'mutation interdite dans Reset.gs (I/O) : ' + motif);
    });
  assert.ok(corpsIO.includes('.addFile('), 'addFile doit être présent (mécanisme de déplacement)');
  assert.ok(corpsIO.includes('.removeFile('), 'removeFile doit être présent (mécanisme de déplacement)');
});

/* ---------- CLAUDE.md §2.1b : la révision et le code partent ATOMIQUEMENT (leçon « verrou codé ») ---------- */

test('tripwire constitution : CLAUDE.md documente la réorg INTERNE de 04 SEULEMENT si le code l\'implémente (et réciproquement)', () => {
  const fs = require('fs');
  const path = require('path');
  const claudeMd = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf-8');
  const reset = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf-8');
  const codeImplemente04Interne = reset.includes('function reorganiserInterne04_(') && reset.includes('function dossierInterne04Reset_(');
  const constitutionAutorise = claudeMd.includes('réorganisation INTERNE permise');
  assert.strictEqual(codeImplemente04Interne, constitutionAutorise,
    'code et CLAUDE.md §2.1b doivent être en phase : la réorg interne de 04 est une révision ATOMIQUE (code + doc + tripwire), jamais l\'un sans l\'autre');
  // La sortie de 04 reste NON négociable quel que soit l'état ci-dessus.
  assert.ok(claudeMd.includes('sortie JAMAIS automatique') || claudeMd.includes('jamais hors de 04'),
    'la constitution doit continuer d\'interdire toute SORTIE automatique de 04');
});

/* ---------- Fonctions UN-CLIC : verrou partagé avec le tick (revue quota C28-33) ---------- */

test('les 4 fonctions UN-CLIC prennent TOUTES le verrou partagé (source) — un oubli sur une seule romprait la garde', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  ['lancerResetTout', 'lancerResetRassemblement', 'lancerResetPlacement', 'lancerReset04Interne'].forEach((nom) => {
    const debut = src.indexOf('function ' + nom + '(');
    assert.ok(debut !== -1, nom + ' introuvable');
    const fin = src.indexOf('\n}', debut);
    const corps = src.slice(debut, fin);
    assert.ok(corps.includes('acquerirVerrouReset_('), nom + ' doit acquérir le verrou partagé du tick avant de muter');
    assert.ok(corps.includes('verrou.releaseLock()'), nom + ' doit relâcher le verrou (finally)');
  });
});

function fakeLock(disponible) {
  const appels = { tryLock: 0, release: 0 };
  return {
    lock: {
      tryLock: () => { appels.tryLock++; return disponible; },
      releaseLock: () => { appels.release++; },
    },
    appels,
  };
}

test('acquerirVerrouReset_ : verrou indisponible (tick en cours) → null, aucune mutation tentée', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const { lock, appels } = fakeLock(false);
  c.LockService = { getScriptLock: () => lock };
  c.journalInfo_ = () => {};
  const r = c.acquerirVerrouReset_('lancerResetRassemblement');
  assert.strictEqual(r, null);
  assert.strictEqual(appels.tryLock, 1);
  assert.strictEqual(appels.release, 0, 'un verrou jamais acquis ne doit jamais être relâché');
});

test('lancerResetRassemblement : verrou INDISPONIBLE → sort tôt, ne relance AUCUNE phase (course avec le tick évitée)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const { lock, appels } = fakeLock(false);
  c.LockService = { getScriptLock: () => lock };
  c.journalInfo_ = () => {};
  let appele = false;
  c.rassemblerReset_ = () => { appele = true; };
  c.notifierEchec_ = () => {};
  c.lancerResetRassemblement();
  assert.strictEqual(appele, false, 'rassemblerReset_ ne doit JAMAIS tourner sans le verrou');
  assert.strictEqual(appels.release, 0);
});

test('lancerResetRassemblement : verrou acquis → relâché même si la phase LÈVE (finally)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const { lock, appels } = fakeLock(true);
  c.LockService = { getScriptLock: () => lock };
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.rassemblerReset_ = () => { throw new Error('panne Drive'); };
  c.lancerResetRassemblement();
  assert.strictEqual(appels.tryLock, 1);
  assert.strictEqual(appels.release, 1, 'le verrou doit être relâché malgré l\'exception');
});

/* ---------- Budget QUOTIDIEN : le TICK est borné, l'UN-CLIC ne l'est PAS (incident 1er run réel) ---------- */

// Monte une phase isolée : Properties en mémoire + la passe de travail mockée (on teste le GATE, pas le travail).
function ctxPhase(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const store = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.dateGmail_ = () => '2026/07/29';
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.ensembleDomainesProteges_ = () => ({});
  let passes = 0;
  c.rassemblerUnePageReset_ = () => { passes++; return { examines: 1, deplaces: 1, complet: false }; };
  return { c, store, nbPasses: () => passes };
}

test('rassemblerReset_ (TICK) : budget quotidien ÉPUISÉ → ne travaille pas (le quota des déclencheurs reste protégé)', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  const plein = '2026/07/29|' + c0.CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS; // dérivé de la CONFIG, jamais une valeur du jour
  const t = ctxPhase({ props: { DriveAI_RESET_RASS_JOUR: plein } });
  t.c.rassemblerReset_(() => false); // pas de `manuel` → chemin TICK, comportement inchangé
  assert.strictEqual(t.nbPasses(), 0, 'le tick respecte le budget quotidien');
});

test('rassemblerReset_ (UN-CLIC) : budget quotidien épuisé → travaille QUAND MÊME et ne CONSOMME PAS le budget du tick', () => {
  // Le budget quotidien protège le quota RUNTIME des DÉCLENCHEURS ; une exécution d'éditeur en est
  // HORS. Sans ce correctif : (1) Marc bloqué jusqu'au lendemain après quelques relances manuelles,
  // (2) pire — son run manuel consommait le budget du tick, donc l'AUTO ne faisait plus rien de la
  // journée (le manuel affamait l'auto). Les deux sont verrouillés ici.
  const c0 = load(['Config.gs', 'Reset.gs']);
  const plein = '2026/07/29|' + c0.CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS;
  const t = ctxPhase({ props: { DriveAI_RESET_RASS_JOUR: plein } });
  t.c.rassemblerReset_(() => false, true); // manuel
  assert.strictEqual(t.nbPasses(), 1, 'l\'un-clic n\'est PAS gaté par le budget quotidien');
  assert.strictEqual(t.store.DriveAI_RESET_RASS_JOUR, plein,
    'l\'un-clic ne consomme RIEN du budget quotidien — sinon il affamerait le tick automatique');
});

test('placerReset_ / appliquerReset04Interne_ : même contrat manuel (gate + comptage) que le rassemblement', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  for (const cas of [
    { fn: 'placerReset_', cle: 'DriveAI_RESET_PLACE_JOUR', budget: c0.CONFIG.RESET_PLACEMENT_BUDGET_JOUR_MS, passe: 'placerUnePageReset_' },
    { fn: 'appliquerReset04Interne_', cle: 'DriveAI_RESET_04_JOUR', budget: c0.CONFIG.RESET_04_BUDGET_JOUR_MS, passe: 'reorganiserPageInterne04_' },
  ]) {
    const plein = '2026/07/29|' + cas.budget;
    const t = ctxPhase({ props: { [cas.cle]: plein } });
    let passes = 0;
    t.c[cas.passe] = () => { passes++; return { examines: 1, deplaces: 1, complet: false }; };
    t.c.entitesValideesParCle_ = () => ({});
    t.c.empreintesPlanConsolidation_ = () => ({});

    t.c[cas.fn](() => false);        // TICK : gaté
    assert.strictEqual(passes, 0, cas.fn + ' (tick) doit respecter le budget quotidien');
    t.c[cas.fn](() => false, true);  // UN-CLIC : libre
    assert.strictEqual(passes, 1, cas.fn + ' (un-clic) ne doit PAS être gaté');
    assert.strictEqual(t.store[cas.cle], plein, cas.fn + ' (un-clic) ne doit rien consommer du budget du tick');
  }
});

test('les 4 fonctions UN-CLIC passent `true` (manuel) aux phases — sinon le budget du tick les brimerait à nouveau', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  const debutUnClic = src.indexOf('Fonctions UN-CLIC');
  assert.ok(debutUnClic !== -1);
  const corps = src.slice(debutUnClic);
  ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_'].forEach((phase) => {
    const appels = corps.match(new RegExp(phase + '\\(estBudgetDepasse[^)]*\\)', 'g')) || [];
    assert.ok(appels.length > 0, 'aucun appel de ' + phase + ' dans les fonctions un-clic');
    appels.forEach((appel) => {
      assert.ok(/,\s*true\s*\)/.test(appel), 'appel un-clic sans le drapeau manuel : ' + appel);
    });
  });
});
