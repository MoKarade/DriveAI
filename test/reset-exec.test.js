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
  props.DriveAI_RESET_PLACEMENT = tag + '|' + c.CONFIG.RESET_TABLE_VERSION; // drapeau VERSIONNÉ (revue #227)
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
    // Par défaut un vrai fichier binaire : les Google natifs (`application/vnd.google-apps.*`) sont
    // EXCLUS de la dédup par empreinte (revue sécurité #229) — leur hash d'Index est celui du texte
    // exporté, pas du fichier. Les tests qui veulent ce cas passent `mime` explicitement.
    getMimeType: () => (opts.mime !== undefined ? opts.mime : 'application/pdf'),
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

test('ecarterEchecMutationReset_ : un fichier « empoisonné » (mutation qui lève) est COMPTÉ puis ÉCARTÉ après N échecs → le reset converge (jamais bloqué à vie)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const MAX = c.CONFIG.QUARANTAINE_MAX;
  let compteur = 0;
  c.incrementerEchec_ = () => ++compteur; // simule l'onglet Échecs
  const ajouts = [];
  c.indexAjouter_ = (cle, dec) => ajouts.push({ cle: cle, statut: dec.statut });
  c.journalErreur_ = () => {};

  // Sous le seuil : journalisé seulement, AUCUNE clé posée → le fichier reste re-tentable.
  for (let i = 1; i < MAX; i++) c.ecarterEchecMutationReset_('tri33|t|POISON', 'permission-tiers.pdf', 'addFile a levé');
  assert.strictEqual(ajouts.length, 0, 'sous le seuil : re-tenté, aucune clé');

  // Au seuil : la clé (celle que le succès aurait posée) est inscrite avec un statut d'écart.
  // La collecte teste `indexContient_(cle)` → elle skippera désormais ce fichier → convergence.
  c.ecarterEchecMutationReset_('tri33|t|POISON', 'permission-tiers.pdf', 'addFile a levé');
  assert.strictEqual(ajouts.length, 1);
  assert.strictEqual(ajouts[0].cle, 'tri33|t|POISON', 'clé = celle testée par la collecte (skip garanti)');
  assert.strictEqual(ajouts[0].statut, 'tri33-ecart');
});

test('collecte : un fichier ÉPINGLÉ par Marc n\'est JAMAIS aspiré vers `_TRI` ni réorganisé dans 04 (ADR-0026 — les autres campagnes l\'immunisent déjà)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = { 'epingle|EPINGLE': true };
  c.indexContient_ = (cle) => !!index[cle];
  c.journalErreur_ = () => {};
  const faireDossier = (files) => {
    let i = 0;
    return {
      getFiles: () => ({ hasNext: () => i < files.length, next: () => files[i++] }),
      getFolders: () => ({ hasNext: () => false, next: () => null }), // pas de sous-dossiers (04 récurse)
    };
  };
  const epingle = () => fakeFichierReset({ id: 'EPINGLE', nom: '2026-03_Facture_EDF.pdf' });
  const libre = () => fakeFichierReset({ id: 'LIBRE', nom: '2026-03_Facture_Hydro.pdf' });

  // Rassemblement (aspiration depuis les domaines vers `_TRI`) : l'épinglé reste où Marc l'a rangé.
  let ids = [];
  c.collecterRassemblementReset_(faireDossier([epingle(), libre()]), ids, 100, () => false, 'tag', { complet: true });
  assert.deepStrictEqual(ids, ['LIBRE'], 'rassemblement : seul le non-épinglé est collecté');

  // Réorg interne 04 : idem, un fichier épinglé sous 04 n'est jamais déplacé entre sous-dossiers.
  ids = [];
  c.collecterInterne04Reset_(faireDossier([epingle(), libre()]), ids, 100, () => false, 'tag', { complet: true });
  assert.deepStrictEqual(ids, ['LIBRE'], '04 interne : l\'épinglé est immunisé aussi');
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
  // Cross-module (Journal.gs) : par défaut AUCUNE empreinte déjà connue → le hash est bien calculé.
  c.empreinteConnueParId_ = (id) => (opts.empreintesConnues || {})[id] || '';
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
  assert.strictEqual(ajoutsRapport[0][0], 'nonroute|' + ctxPur.CONFIG.RESET_TABLE_VERSION + '|F4',
    'clé de rapport VERSIONNÉE : chaque version produit son instantané honnête du reliquat');
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
  assert.strictEqual(quasi[0][0], 'quasidoublon|' + ctxPur.CONFIG.RESET_TABLE_VERSION + '|F6');
  assert.strictEqual(quasi[0][5], 'doublon-probable');
});

test('placerUnFichierReset_ : QUASI-doublon — deux gros fichiers JAMAIS hashés (> RESET_HASH_TAILLE_MAX), MÊME taille → rapporté quand même (revue code C28-33)', () => {
  // Une taille identique ne prouve « déjà couvert par le hash » QUE si les deux fichiers ont été
  // RÉELLEMENT hashés (empreinteBlob_ n'est jamais appelee au-dela de RESET_HASH_TAILLE_MAX). Sans ce
  // correctif, deux gros homonymes de même taille mais de contenu différent passaient inaperçus
  // des DEUX dédups (ni le hash exact — jamais calculé — ni ce rapport, court-circuité à tort).
  const ctx1 = ctxPlacement({ id: 'G1', nom: 'scan.pdf', taille: 500, empreinte: '', domaine: '08 · Perso & projets' });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} };
  ctx1.c.placerUnFichierReset_(ctx1.fichier, '08 · Perso & projets', 'tri33p|tag|G1', ctxObj);

  const fichier2 = fakeFichierReset({ id: 'G2', nom: 'scan.pdf', taille: 500, parents: [] });
  ctx1.c.placerUnFichierReset_(fichier2, '08 · Perso & projets', 'tri33p|tag|G2', ctxObj); // empreinte '' aussi (opts.empreinte fige toute la fonction mockée)

  const quasi = ctx1.ajoutsRapport.filter((r) => String(r[0]).indexOf('quasidoublon|') === 0);
  assert.strictEqual(quasi.length, 1, 'même taille mais NON hashés → rapporté (pas de faux « déjà couvert »)');
  assert.strictEqual(quasi[0][0], 'quasidoublon|' + ctxPur.CONFIG.RESET_TABLE_VERSION + '|G2');
  assert.ok(String(quasi[0][6]).indexOf('NON confirmée par hash') !== -1);
});

test('placerUnFichierReset_ : QUASI-doublon — même taille, LES DEUX vraiment hashés (empreintes différentes → contenu réellement distinct) → aucun rapport', () => {
  // Les deux fichiers SONT hashés (sous RESET_HASH_TAILLE_MAX) et ont des empreintes DIFFÉRENTES — le hash
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
  c.empreinteConnueParId_ = () => '';
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

test('Reset.gs (section I/O) : aucune mutation hors addFile/removeFile — renommage par INDIRECTION permis dans la SEULE sous-section PR5', () => {
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
  // EXCEPTION PR5 (ADR-0030, revue sécurité C28-42 — promesse de verrou tenue À JOUR) : la passe LLM
  // renomme/déplace par INDIRECTION (`renommer_`/`deplacerEtRenommer_`, DriveRest.gs — déplacement +
  // rename REST, toujours SANS suppression). Ces indirections ne doivent apparaître QUE dans la
  // sous-section PR5, jamais dans le rassemblement/placement/04 (qui restent addFile/removeFile purs).
  const debutPR5 = corpsIO.indexOf('Passe LLM du RELIQUAT (ADR-0030 PR5');
  const finPR5 = corpsIO.indexOf('04 · Immigration : réorganisation INTERNE');
  assert.ok(debutPR5 !== -1, 'sous-section PR5 introuvable');
  assert.ok(finPR5 > debutPR5, 'la sous-section 04 doit suivre la PR5 (borne de fin du périmètre)');
  const horsPR5 = corpsIO.slice(0, debutPR5) + corpsIO.slice(finPR5);
  ['renommer_(', 'deplacerEtRenommer_('].forEach((motif) => {
    assert.ok(!horsPR5.includes(motif),
      motif + ' est réservé à la sous-section PR5 — le reste de l\'I/O reset reste addFile/removeFile pur');
  });
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

/* ---------- Anti-spin : une ronde STÉRILE arrête la boucle un-clic (revue quota) ---------- */

test('rondeSterileReset_ : rien examiné ET rien déplacé (ou phase muette) = stérile ; le moindre travail ne l\'est pas', () => {
  assert.strictEqual(ctxPur.rondeSterileReset_(null), true, 'phase sortie tôt (undefined/null) → stérile');
  assert.strictEqual(ctxPur.rondeSterileReset_({ examines: 0, deplaces: 0, complet: true }), true);
  assert.strictEqual(ctxPur.rondeSterileReset_({ examines: 0, deplaces: 0, complet: false }), true,
    'passe interrompue sans rien produire : stérile aussi (sinon spin sur une racine illisible)');
  assert.strictEqual(ctxPur.rondeSterileReset_({ examines: 5, deplaces: 0, complet: true }), false,
    'examiné sans déplacer (tout était déjà en place) = travail réel');
  assert.strictEqual(ctxPur.rondeSterileReset_({ examines: 0, deplaces: 3, complet: true }), false);
});

// Contexte de boucle un-clic : verrou libre, phases injectées, Properties en mémoire.
function ctxBoucle(phases) {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const store = {};
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {}; c.notifierEchec_ = () => {};
  const appels = { rass: 0, place: 0, i04: 0 };
  c.rassemblerReset_ = () => { appels.rass++; return phases.rass; };
  c.placerReset_ = () => { appels.place++; return phases.place; };
  c.appliquerReset04Interne_ = () => { appels.i04++; return phases.i04; };
  return { c, appels, store };
}

const STERILE = { examines: 0, deplaces: 0, complet: true };
const TRAVAIL = { examines: 3, deplaces: 3, complet: false };

test('lancerResetPlacement : ronde STÉRILE → sort IMMÉDIATEMENT (le tag ne peut pas servir de signal — il ne se pose qu\'après le rassemblement)', () => {
  // Le bug corrigé : dans l'état STABLE « placement oisif, rassemblement non fini », le tag n'est
  // JAMAIS posé → l'ancienne condition de break ne pouvait structurellement pas tirer et la boucle
  // spinnait jusqu'au mur (4,5 min), en relisant tout PlanConsolidation à chaque ronde.
  const t = ctxBoucle({ place: STERILE });
  t.c.lancerResetPlacement();
  assert.strictEqual(t.appels.place, 1, 'une seule passe : on ne re-scanne pas en boucle pour rien');
  assert.strictEqual(t.store.DriveAI_RESET_PLACEMENT, undefined, 'et ce, SANS que le tag soit posé');
});

test('boucles un-clic : testées par leur LIBÉRATION — du travail fait continue, puis une ronde stérile arrête', () => {
  // Leçon §7 : un gate se teste par sa libération, pas seulement par son blocage. Ici : la boucle
  // doit ENCHAÎNER tant qu'il y a du travail, et ne s'arrêter que quand il n'y en a plus.
  let restant = 3;
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const store = {};
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: () => {},
  }) };
  c.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {}; c.notifierEchec_ = () => {};
  let passes = 0;
  c.rassemblerReset_ = () => { passes++; return restant-- > 0 ? TRAVAIL : STERILE; };
  c.lancerResetRassemblement();
  assert.strictEqual(passes, 4, '3 passes productives enchaînées, puis la 4ᵉ (stérile) arrête');
});

test('lancerResetTout : s\'arrête quand les 3 phases sont stériles, mais CONTINUE si UNE seule travaille encore', () => {
  const rienAFaire = ctxBoucle({ rass: STERILE, place: STERILE, i04: STERILE });
  rienAFaire.c.lancerResetTout();
  assert.strictEqual(rienAFaire.appels.rass, 1, 'une ronde et on sort');
  assert.strictEqual(rienAFaire.appels.place, 1);
  assert.strictEqual(rienAFaire.appels.i04, 1);

  // Une seule phase productive → la boucle DOIT continuer (sinon on s'arrêterait trop tôt).
  let reste = 2;
  const t = ctxBoucle({ rass: STERILE, place: STERILE, i04: STERILE });
  t.c.placerReset_ = () => { t.appels.place++; return reste-- > 0 ? TRAVAIL : STERILE; };
  t.c.lancerResetTout();
  assert.strictEqual(t.appels.place, 3, 'continue tant qu\'UNE phase produit du travail');
});

/* ---------- Un-clic : jamais par un déclencheur, et signal de vie pour le chien de garde ---------- */

test('estAppelParDeclencheur_ : un event object de trigger est reconnu ; une exécution d\'éditeur non', () => {
  assert.strictEqual(ctxPur.estAppelParDeclencheur_({ triggerUid: '123' }), true);
  assert.strictEqual(ctxPur.estAppelParDeclencheur_(undefined), false, 'exécution manuelle depuis l\'éditeur');
  assert.strictEqual(ctxPur.estAppelParDeclencheur_({}), false);
});

test('les 4 un-clic REFUSENT de tourner si un déclencheur les appelle (le drapeau manuel ne vaut que hors quota des déclencheurs)', () => {
  for (const nom of ['lancerResetTout', 'lancerResetRassemblement', 'lancerResetPlacement', 'lancerReset04Interne']) {
    const t = ctxBoucle({ rass: TRAVAIL, place: TRAVAIL, i04: TRAVAIL });
    let verrouPris = false;
    t.c.LockService = { getScriptLock: () => { verrouPris = true; return { tryLock: () => true, releaseLock: () => {} }; } };
    t.c[nom]({ triggerUid: 'abc' }); // appelée COMME un handler de déclencheur
    assert.strictEqual(verrouPris, false, nom + ' ne doit même pas prendre le verrou sous déclencheur');
    assert.strictEqual(t.appels.rass + t.appels.place + t.appels.i04, 0, nom + ' ne doit RIEN exécuter sous déclencheur');
  }
});

test('les un-clic écrivent DriveAI_LAST_MANUEL — sinon le chien de garde crie « moteur silencieux » à tort pendant une séance', () => {
  const t = ctxBoucle({ rass: STERILE, place: STERILE, i04: STERILE });
  t.c.lancerResetTout();
  assert.ok(Number(t.store.DriveAI_LAST_MANUEL) > 0, 'signal de vie manuel persisté');
});

test('chienDeGarde : DriveAI_LAST_MANUEL frais compte comme un signal de VIE (pas d\'alerte pendant une séance manuelle)', () => {
  const c = load(['Config.gs', 'Main.gs']);
  const maintenant = Date.now();
  const store = {
    // Heartbeat de tick VIEUX (les ticks sautent : le verrou est tenu par la séance manuelle)…
    DriveAI_LAST_TICK: String(maintenant - 3 * 60 * 60 * 1000),
    // …mais une exécution manuelle vient d'avoir lieu.
    DriveAI_LAST_MANUEL: String(maintenant - 60 * 1000),
  };
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); }, deleteProperty: () => {},
  }) };
  let repare = false;
  c.installerTrigger = () => { repare = true; };
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.chienDeGarde();
  assert.strictEqual(repare, false, 'aucune réparation : le moteur donne signe de vie par le canal manuel');
  assert.strictEqual(store.DriveAI_WATCHDOG_ALERTE, undefined, 'et aucune alerte « moteur silencieux »');
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

/* ---------- Version de TABLE : un affinage des règles re-tente le RELIQUAT, jamais le rangé ---------- */

// Page de placement isolée : un dossier `_TRI 2026/<domaine>` contenant N fichiers, clés en mémoire.
function ctxPage(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const index = Object.assign({}, opts.index);
  const traites = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.dossierTriReset_ = () => ({
    getFoldersByName: (nom) => {
      if (nom !== (opts.domaine || '02 · Finances')) return { hasNext: () => false };
      let rendu = false;
      return {
        hasNext: () => !rendu,
        next: () => { rendu = true; return { getFiles: () => iterFichiers(opts.fichiers || []) }; },
      };
    },
  });
  c.placerUnFichierReset_ = (f, dom, cle) => { traites.push({ id: f.getId(), cle: cle }); return true; };
  return { c, traites, index };
}

function iterFichiers(ids) {
  let i = 0;
  return {
    hasNext: () => i < ids.length,
    next: () => { const id = ids[i++]; return { getId: () => id, getName: () => id + '.pdf' }; },
  };
}

test('placement : la clé porte la VERSION DE TABLE — bumper la version re-tente le reliquat resté en _TRI', () => {
  const V = ctxPur.CONFIG.RESET_TABLE_VERSION;
  const TAG = ctxPur.CONFIG.RESET_TAG;
  // F1 a DÉJÀ été tenté sous la version COURANTE → sauté ; F2 jamais vu → traité.
  const dejaVu = {};
  dejaVu['tri33p|' + TAG + '|' + V + '|F1'] = true;
  const t = ctxPage({ fichiers: ['F1', 'F2'], index: dejaVu });
  t.c.placerUnePageReset_(() => false, { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} });
  assert.deepStrictEqual(t.traites.map((x) => x.id), ['F2'], 'un fichier déjà tenté sous CETTE version est sauté');
  assert.ok(t.traites[0].cle.indexOf('|' + V + '|') !== -1, 'la clé posée porte bien la version de table');

  // MÊME fichier, marqué sous une ANCIENNE version de table → RE-TENTÉ (c'est tout l'intérêt).
  const ancienne = {};
  ancienne['tri33p|' + TAG + '|v-ancienne|F1'] = true;
  const t2 = ctxPage({ fichiers: ['F1'], index: ancienne });
  t2.c.placerUnePageReset_(() => false, { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} });
  assert.deepStrictEqual(t2.traites.map((x) => x.id), ['F1'],
    'affiner la table doit re-présenter le reliquat — sinon les non-routés resteraient « déjà tentés » à vie');
});

test('placement : la collecte n\'itère QUE sur `_TRI` — bumper la version ne peut PAS re-déplacer un fichier déjà rangé', () => {
  // Le dossier `_TRI 2026/<domaine>` est VIDE (tout a été placé) : quelle que soit la version de
  // table, il n'y a rien à re-présenter. C'est la garantie donnée à Marc (« sans rien re-déplacer »).
  const t = ctxPage({ fichiers: [] });
  const r = t.c.placerUnePageReset_(() => false, { proteges: {}, empreintesVues: {}, validees: {}, repointes: {} });
  assert.deepStrictEqual(t.traites, [], 'rien dans _TRI ⇒ rien traité, quelle que soit la version de table');
  assert.strictEqual(r.examines, 0);
});

/* ---------- Drapeau de FIN DE PHASE versionné : le bump ré-ouvre le placement (revue #227) ---------- */

// Phase de placement isolée, avec la passe de travail mockée : on teste le GARDE de fin, pas le travail.
function ctxPlacementPhase(props) {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const store = Object.assign({}, props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.dateGmail_ = () => '2026/07/29';
  c.journalInfo_ = () => {}; c.journalErreur_ = () => {};
  c.ensembleDomainesProteges_ = () => ({});
  c.entitesValideesParCle_ = () => ({});
  c.empreintesPlanConsolidation_ = () => ({});
  let passes = 0;
  c.placerUnePageReset_ = () => { passes++; return { examines: 0, deplaces: 0, complet: true }; };
  return { c, store, nbPasses: () => passes };
}

test('placerReset_ : drapeau de fin à la version COURANTE → phase close (aucune passe) — le blocage', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  const t = ctxPlacementPhase({
    DriveAI_RESET_PLACEMENT: c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION,
    DriveAI_RESET_RASSEMBLEMENT: c0.CONFIG.RESET_TAG,
  });
  t.c.placerReset_(() => false);
  assert.strictEqual(t.nbPasses(), 0, 'convergé pour CETTE version : rien à refaire');
});

test('placerReset_ : drapeau de fin à une ANCIENNE version → la phase SE RÉ-OUVRE (testé par la LIBÉRATION, leçon C28-32)', () => {
  // LE bug que la revue #227 a trouvé : le drapeau de phase ne portait que le TAG et était testé
  // AVANT la construction des clés versionnées. Une fois le placement convergé, bumper
  // RESET_TABLE_VERSION ne re-présentait plus RIEN — en silence, sans erreur, et le seul
  // contournement (bumper RESET_TAG) aurait renvoyé TOUT le Drive dans `_TRI` pour un cycle complet.
  const c0 = load(['Config.gs', 'Reset.gs']);
  const t = ctxPlacementPhase({
    DriveAI_RESET_PLACEMENT: c0.CONFIG.RESET_TAG + '|v-ancienne',
    DriveAI_RESET_RASSEMBLEMENT: c0.CONFIG.RESET_TAG,
  });
  t.c.placerReset_(() => false);
  assert.strictEqual(t.nbPasses(), 1, 'un affinage de table DOIT ré-ouvrir le placement');
  assert.strictEqual(t.store.DriveAI_RESET_PLACEMENT, c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION,
    'et le drapeau se repose à la NOUVELLE version (convergence de la nouvelle passe)');
});

test('placerReset_ : drapeau LEGACY sans version (état de la prod avant ce PR) → se ré-ouvre UNE fois, puis converge', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  const t = ctxPlacementPhase({
    DriveAI_RESET_PLACEMENT: c0.CONFIG.RESET_TAG, // valeur écrite par le code déployé aujourd'hui
    DriveAI_RESET_RASSEMBLEMENT: c0.CONFIG.RESET_TAG,
  });
  t.c.placerReset_(() => false);
  assert.strictEqual(t.nbPasses(), 1, 'migration gratuite : une re-passe sur `_TRI`, inoffensive');
  t.c.placerReset_(() => false);
  assert.strictEqual(t.nbPasses(), 1, 'puis close — pas de ré-ouverture en boucle');
});

test('resetTermine_ : exige la VERSION côté placement (un bump rouvre le reset ⇒ campagnes re-suspendues, effet assumé)', () => {
  const c0 = load(['Config.gs', 'Reset.gs']);
  const TAG = c0.CONFIG.RESET_TAG;
  const V = c0.CONFIG.RESET_TABLE_VERSION;
  const monter = (placement) => {
    const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
    const store = { DriveAI_RESET_RASSEMBLEMENT: TAG, DriveAI_RESET_04: TAG, DriveAI_RESET_PLACEMENT: placement };
    c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null) }) };
    return c;
  };
  assert.strictEqual(monter(TAG + '|' + V).resetTermine_(), true, 'version courante → terminé');
  assert.strictEqual(monter(TAG + '|v-ancienne').resetTermine_(), false, 'version périmée → PAS terminé (le reliquat est à re-tenter)');
  assert.strictEqual(monter(TAG).resetTermine_(), false, 'drapeau legacy sans version → PAS terminé');
  // Conséquence directe : les campagnes suspendues le restent tant que la nouvelle passe n'a pas convergé.
  assert.strictEqual(monter(TAG + '|v-ancienne').resetEnCours_(), true);
});

/* ---------- DÉBIT du placement (revue #229) : ne plus re-télécharger ce qui est déjà hashé ---------- */

/** Contexte minimal pour `empreinteReutiliseeReset_` : compte les hashs RÉELLEMENT calculés. */
function ctxEmpreinte(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const hashs = [];
  c.empreinteBlob_ = (blob) => { hashs.push(blob.id); return 'CALC:' + blob.id; };
  c.empreinteConnueParId_ = (id) => (opts.index || {})[id] || '';
  return { c, hashs };
}

test('empreinteReutiliseeReset_ : empreinte connue du PLAN → réutilisée, AUCUN téléchargement d\'octets', () => {
  const { c, hashs } = ctxEmpreinte();
  const f = fakeFichierReset({ id: 'K1', nom: 'a.pdf', taille: 100, parents: [] });
  const emp = c.empreinteReutiliseeReset_(f, { empreintesConnues: { K1: 'DEJA' } });
  assert.strictEqual(emp, 'DEJA');
  assert.deepStrictEqual(hashs, [], 'empreinteBlob_ ne doit PAS être appelée quand la valeur est connue');
});

test('empreinteReutiliseeReset_ : empreinte connue de l\'INDEX → réutilisée (un bump de RESET_TABLE_VERSION ne re-hashe rien)', () => {
  const { c, hashs } = ctxEmpreinte({ index: { K2: 'INDEX' } });
  const f = fakeFichierReset({ id: 'K2', nom: 'b.pdf', taille: 100, parents: [] });
  assert.strictEqual(c.empreinteReutiliseeReset_(f, { empreintesConnues: {} }), 'INDEX');
  assert.deepStrictEqual(hashs, []);
});

test('empreinteReutiliseeReset_ : inconnue → hashée pour de vrai (la dédup exacte reste possible)', () => {
  const { c, hashs } = ctxEmpreinte();
  const f = fakeFichierReset({ id: 'K3', nom: 'c.pdf', taille: 100, parents: [] });
  assert.strictEqual(c.empreinteReutiliseeReset_(f, { empreintesConnues: {} }), 'CALC:K3');
  assert.deepStrictEqual(hashs, ['K3']);
});

test('empreinteReutiliseeReset_ : un Google NATIF n\'est JAMAIS dédupliqué par empreinte (revue sécurité #229)', () => {
  // 🔴 Le cas qui aurait envoyé des ORIGINAUX dans `_Doublons`. Pour un natif, l'empreinte d'Index
  // est le MD5 du TEXTE EXPORTÉ (Intake.gs), pas du fichier : deux Sheets/Slides quasi vides y
  // portent la MÊME valeur. L'intake s'en protège par `ignorerDoublon`, un flag qui NE SURVIT PAS
  // dans l'Index — d'où l'exclusion ici, côté consommateur.
  const { c, hashs } = ctxEmpreinte({ index: { N1: 'd41d8cd98f00b204e9800998ecf8427e' } });
  const natif = fakeFichierReset({ id: 'N1', nom: 'Budget.gsheet', taille: 0, mime: 'application/vnd.google-apps.spreadsheet', parents: [] });
  assert.strictEqual(c.empreinteReutiliseeReset_(natif, { empreintesConnues: { N1: 'PLAN' } }), '',
    'ni le plan ni l\'Index ne doivent servir de source pour un natif');
  assert.deepStrictEqual(hashs, [], 'et on ne hashe pas non plus son export (deux docs vides peuvent coïncider)');
});

test('placerUnFichierReset_ : deux Google NATIFS de même empreinte d\'Index restent CHACUN classé (aucun `_Doublons`)', () => {
  // Preuve de bout en bout du garde-fou : c'est le scénario exact relevé en revue (deux tableurs
  // quasi vides, même MD5 de texte exporté). Le second doit être ROUTÉ, jamais écarté.
  const MEME = 'd41d8cd98f00b204e9800998ecf8427e';
  const t = ctxPlacement({ id: 'N1', nom: '2026-01-01_Relevé_Desjardins.pdf', domaine: '02 · Finances',
    empreintesConnues: { N1: MEME, N2: MEME } });
  const ctxObj = { proteges: {}, empreintesVues: {}, validees: {}, repointes: {}, ciblesResolues: {} };
  const f1 = fakeFichierReset({ id: 'N1', nom: '2026-01-01_Relevé_Desjardins.pdf', taille: 0, mime: 'application/vnd.google-apps.spreadsheet', parents: [] });
  const f2 = fakeFichierReset({ id: 'N2', nom: '2026-02-01_Relevé_Desjardins.pdf', taille: 0, mime: 'application/vnd.google-apps.spreadsheet', parents: [] });
  t.c.placerUnFichierReset_(f1, '02 · Finances', 'tri33p|tag|N1', ctxObj);
  t.c.placerUnFichierReset_(f2, '02 · Finances', 'tri33p|tag|N2', ctxObj);
  const statuts = t.ajouts.map((a) => a.statut);
  assert.deepStrictEqual(statuts.filter((x) => x === 'tri33-doublon'), [], 'AUCUN natif ne part en _Doublons');
  assert.strictEqual(statuts.length, 2);
  statuts.forEach((x) => assert.strictEqual(x, 'tri33-route', 'chacun est routé normalement'));
});

test('empreinteReutiliseeReset_ : mime ILLISIBLE → abstention (échec-fermé, jamais un déplacement risqué)', () => {
  const { c, hashs } = ctxEmpreinte({ index: { X1: 'EMP' } });
  const casse = fakeFichierReset({ id: 'X1', nom: 'x.pdf', taille: 10, parents: [] });
  casse.getMimeType = () => { throw new Error('Drive indisponible'); };
  assert.strictEqual(c.empreinteReutiliseeReset_(casse, {}), '');
  assert.deepStrictEqual(hashs, []);
});

test('empreinteReutiliseeReset_ : borne de taille DÉRIVÉE de CONFIG.RESET_HASH_TAILLE_MAX (seuil / seuil+1)', () => {
  // Cas dérivés de la CONSTANTE, jamais de sa valeur du jour (leçon §7) : la rajuster ne doit pas
  // rendre ce test menteur. Au-delà du seuil, empreinte vide ⇒ jamais déplacé comme doublon.
  const SEUIL = load(['Config.gs']).CONFIG.RESET_HASH_TAILLE_MAX;
  const a = ctxEmpreinte();
  const sous = fakeFichierReset({ id: 'L1', nom: 'ok.pdf', taille: SEUIL, parents: [] });
  assert.strictEqual(a.c.empreinteReutiliseeReset_(sous, {}), 'CALC:L1', 'au seuil exact → hashé');
  const b = ctxEmpreinte();
  const gros = fakeFichierReset({ id: 'L2', nom: 'gros.pdf', taille: SEUIL + 1, parents: [] });
  assert.strictEqual(b.c.empreinteReutiliseeReset_(gros, {}), '', 'au-delà du seuil → vide');
  assert.deepStrictEqual(b.hashs, [], 'et surtout : AUCUN téléchargement (c\'est le point du garde-fou 6 min)');
});

test('empreinteReutiliseeReset_ : la borne du reset est STRICTEMENT sous celle de l\'OCR (anti-mur 6 min)', () => {
  const CFG = load(['Config.gs']).CONFIG;
  assert.ok(CFG.RESET_HASH_TAILLE_MAX < CFG.OCR_TAILLE_MAX,
    'hasher 20 Mo coûte 10-60 s : le placement doit avoir sa PROPRE borne, plus basse');
});

test('resoudreCibleReset_ : la cible d\'un même sous-chemin n\'est résolue qu\'UNE fois par run (mémoïsation)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const appels = [];
  const log = [];
  c.sousDossier_ = (parent, nom) => { appels.push(nom); return fakeDossierReset(parent.getId() + '/' + nom, log); };
  c.cleCanoniqueEntite_ = () => null;
  const dom = fakeDossierReset('DOM:02 · Finances', log);
  const ctxObj = { validees: {}, repointes: {}, ciblesResolues: {} };
  const a = c.resoudreCibleReset_(dom, '02 · Finances', 'Banques/Desjardins', ctxObj);
  const b = c.resoudreCibleReset_(dom, '02 · Finances', 'Banques/Desjardins', ctxObj);
  assert.strictEqual(b, a, 'même objet dossier rendu');
  assert.deepStrictEqual(appels, ['Banques', 'Desjardins'], '2 appels au 1er passage, ZÉRO au second');
  // Un AUTRE sous-chemin reste résolu normalement (la mémoïsation ne doit pas confondre les cibles).
  c.resoudreCibleReset_(dom, '02 · Finances', 'Impôts & déclarations', ctxObj);
  assert.deepStrictEqual(appels, ['Banques', 'Desjardins', 'Impôts & déclarations']);
});

test('dossierDomaineMemo_ : un domaine n\'est résolu qu\'UNE fois par run, et sans ctx ça marche quand même', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
  const log = [];
  let appels = 0;
  c.idDomaine_ = (d) => { appels++; return 'DOM:' + d; };
  c.DriveApp = { getFolderById: (id) => fakeDossierReset(id, log) };
  const ctxObj = {};
  c.dossierDomaineMemo_('02 · Finances', ctxObj);
  c.dossierDomaineMemo_('02 · Finances', ctxObj);
  assert.strictEqual(appels, 1, 'mémoïsé sur ctx');
  c.dossierDomaineMemo_('03 · Santé', ctxObj);
  assert.strictEqual(appels, 2, 'un autre domaine est bien résolu');
  c.dossierDomaineMemo_('02 · Finances', null); // dégradation propre : pas de ctx → appel direct
  assert.strictEqual(appels, 3);
});

/* ---------- UN-CLIC : partage du mur entre les 3 phases (revue #229) ---------- */

test('partPhaseReset_ (PURE) : le temps restant se partage entre les phases NON encore servies', () => {
  const c = load(['Config.gs', 'Reset.gs']);
  // 1re phase sur 3 → un tiers seulement : c'est ça qui empêche `lancerResetTout` de dégénérer en
  // rassemblement seul dès que le plafond d'items est haut (revue #229).
  assert.strictEqual(c.partPhaseReset_(90000, 3), 30000);
  // Adaptatif : une phase qui n'a rien eu à faire rend sa part aux suivantes.
  assert.strictEqual(c.partPhaseReset_(88000, 2), 44000);
  assert.strictEqual(c.partPhaseReset_(86000, 1), 86000, 'dernière phase → tout le reliquat');
  // Plus rien à distribuer → 0 (la phase est coupée d'emblée, jamais une part négative).
  assert.strictEqual(c.partPhaseReset_(0, 3), 0);
  assert.strictEqual(c.partPhaseReset_(-5000, 3), 0);
  assert.strictEqual(c.partPhaseReset_(90000, 0), 90000, 'garde anti-division par zéro');
});

test('gardePartReset_ : borné par la part ET par le mur GLOBAL de l\'exécution', () => {
  const c = load(['Config.gs', 'Reset.gs']);
  const MUR = c.CONFIG.BUDGET_MS;
  // Exécution qui vient de démarrer : la phase peut travailler.
  assert.strictEqual(c.gardePartReset_(Date.now(), 3)(), false);
  // Mur global déjà dépassé : part nulle ET `maintenant - debut > MUR` → coupé, quelle que soit
  // la phase. Sans cette borne, une part calculée sur un reliquat négatif laisserait tourner.
  assert.strictEqual(c.gardePartReset_(Date.now() - MUR - 1000, 1)(), true);
});

test('lancerResetTout : les 3 phases sont appelées avec une PART, jamais avec le mur entier', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  const i = src.indexOf('function lancerResetTout(');
  const corps = src.slice(i, src.indexOf('\n}', i));
  ['rassemblerReset_(gardePartReset_(debut, 3), true)', 'placerReset_(gardePartReset_(debut, 2), true)',
    'appliquerReset04Interne_(gardePartReset_(debut, 1), true)'].forEach((appel) => {
    assert.ok(corps.indexOf(appel) !== -1,
      'sans partage, la 1re phase consomme les 4,5 min et le clic « tout faire » ne place plus rien : ' + appel);
  });
});
