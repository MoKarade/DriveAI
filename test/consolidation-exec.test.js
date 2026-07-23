'use strict';
/**
 * EXÉCUTION du plan de consolidation (C28-26, ADR-0024 — ConsolidationExec.gs) : cible RECALCULÉE
 * au moment du move (la colonne Cible du plan est un instantané périmable — revue flotte), seules
 * les lignes Déplacer/Doublon s'appliquent, §1 re-vérifiée par mutation, multi-parents/dossier
 * jamais déplacés, curseur append-only (suite des offsets d'une page mixte testée), échec compté
 * ≤ 1×/JOUR (abandon = 3 jours distincts), moveTo = seule mutation (verrou de surface).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctxPur = load(['Config.gs', 'ConsolidationExec.gs']);

test('ligneAAppliquer_ : Déplacer/Doublon seulement — OK et Ignoré ne se touchent JAMAIS', () => {
  assert.strictEqual(ctxPur.ligneAAppliquer_('Déplacer'), true);
  assert.strictEqual(ctxPur.ligneAAppliquer_('Doublon'), true);
  assert.strictEqual(ctxPur.ligneAAppliquer_('OK'), false);
  assert.strictEqual(ctxPur.ligneAAppliquer_('Ignoré'), false);
  assert.strictEqual(ctxPur.ligneAAppliquer_(''), false);
});

test('budgetJourConsoExec_ : ms réelles du jour seulement (rollover → 0)', () => {
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(ctxPur.budgetJourConsoExec_(props({ DriveAI_CONSO_EXEC_JOUR: '2026/07/21|300000' }), '2026/07/21'), 300000);
  assert.strictEqual(ctxPur.budgetJourConsoExec_(props({ DriveAI_CONSO_EXEC_JOUR: '2026/07/20|300000' }), '2026/07/21'), 0);
  assert.strictEqual(ctxPur.budgetJourConsoExec_(props({}), '2026/07/21'), 0);
});

/* ---------- appliquerLigneConsolidation_ : recalcul de cible + gardes par mutation (mocks) ---------- */

// parId de test : le dossier 'DOMID' est la racine du domaine 02.
const PAR_ID = { DOMID: '02 · Finances' };

function ctxLigne(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'ConsolidationExec.gs']);
  const index = {};
  const ajouts = [];
  const moves = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec) => { index[cle] = true; ajouts.push({ cle, statut: dec.statut, chemin: dec.chemin }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.dossierDoublons_ = () => ({ getId: () => 'DOUBLONS' });
  c.idDomaine_ = () => 'DOM';
  c.sousDossier_ = (parent, nom) => ({ getId: () => parent.getId() + '/' + nom });
  c.champ_ = (s) => String(s == null ? '' : s).trim();
  // La cible est RECALCULÉE via la règle unique — mockée ici (testée pour de vrai dans consolidation.test.js).
  c.cheminCibleConsolidation_ = () => (opts.cibleRecalculee !== undefined ? opts.cibleRecalculee : '2026');
  const fichier = {
    // next() avance l'index LUI-MÊME (comme DriveApp) — un incrément caché dans getId() fausserait
    // le compteur de parents (vécu : hasNext éternel → faux « multi-parents »).
    getParents: () => {
      let i = 0; const p = opts.parents || ['DOMID'];
      return {
        hasNext: () => i < p.length,
        next: () => {
          const id = p[i++];
          // Le parent-dossier expose aussi getParents (chaîne) : vide par défaut (racine atteinte).
          return { getId: () => id, getParents: () => ({ hasNext: () => false, next: () => null }) };
        },
      };
    },
    getName: () => opts.nom || 'f.pdf',
    getMimeType: () => opts.mime || 'application/pdf',
    moveTo: (dossier) => moves.push(dossier.getId()),
  };
  c.DriveApp = { getFolderById: (id) => ({ getId: () => id }), getFileById: () => { if (opts.absent) throw new Error('absent'); return fichier; } };
  return { c, ajouts, moves };
}

const CTX_EXEC = { proteges: {}, tag: 'conso-2', validees: {}, parId: PAR_ID };

test('appliquerLigneConsolidation_ : Déplacer → cible RECALCULÉE (la colonne Cible périmée est IGNORÉE)', () => {
  const { c, moves, ajouts } = ctxLigne({ cibleRecalculee: '2026' });
  // La ligne du plan (pré-seed) disait « 02 · Finances/Desjardins » — le recalcul dit « 2026 ».
  const r = c.appliquerLigneConsolidation_({ fileId: 'F1', nom: 'f.pdf', action: 'Déplacer', cible: '02 · Finances/Desjardins' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(moves, ['DOM/2026'], 'jamais le dossier de banque périmé : la règle unique du jour prime');
  assert.strictEqual(ajouts[0].statut, 'consolidé');
  assert.strictEqual(ajouts[0].chemin, '02 · Finances/2026');
});

test('appliquerLigneConsolidation_ : recalcul « à plat » → racine du domaine ; recalcul = position actuelle → no-op', () => {
  const plat = ctxLigne({ cibleRecalculee: '' });
  const r1 = plat.c.appliquerLigneConsolidation_({ fileId: 'F2', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r1, 'fait');
  assert.deepStrictEqual(plat.moves, ['DOM'], 'sous-chemin vide = racine du domaine');

  // Fichier DÉJÀ à la racine du domaine (parent = idDomaine_ 'DOM') et recalcul '' → aucun moveTo.
  const enPlace = ctxLigne({ cibleRecalculee: '', parents: ['DOM'] });
  enPlace.c.domaineActuelFichier_ = () => '02 · Finances'; // parent 'DOM' n'est pas dans PAR_ID — court-circuité
  const r2 = enPlace.c.appliquerLigneConsolidation_({ fileId: 'F3', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r2, 'fait');
  assert.deepStrictEqual(enPlace.moves, [], 'déjà en place : aucun moveTo (rejeu sûr)');
});

test('appliquerLigneConsolidation_ : hors domaines (déplacé ailleurs par Marc) → saute, jamais ramené de force', () => {
  const { c, moves, ajouts } = ctxLigne({ parents: ['AILLEURS'] }); // 'AILLEURS' ∉ parId, chaîne vide ensuite
  const r = c.appliquerLigneConsolidation_({ fileId: 'F4', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r, 'saute');
  assert.deepStrictEqual(moves, []);
  assert.strictEqual(ajouts[0].statut, 'consolidé-hors-domaine');
});

test('appliquerLigneConsolidation_ : §1 au vif → JAMAIS de moveTo ; multi-parents → jamais déplacé ; ID de DOSSIER → refusé', () => {
  const protege = ctxLigne({ protege: true });
  assert.strictEqual(protege.c.appliquerLigneConsolidation_({ fileId: 'F5', nom: 'p.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC), 'saute');
  assert.deepStrictEqual(protege.moves, [], 'zone protégée : zéro mutation');
  assert.strictEqual(protege.ajouts[0].statut, 'consolidé-protégé');

  const multi = ctxLigne({ parents: ['P1', 'P2'] });
  assert.strictEqual(multi.c.appliquerLigneConsolidation_({ fileId: 'F6', nom: 'm.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC), 'saute');
  assert.deepStrictEqual(multi.moves, []);

  const dossier = ctxLigne({ mime: 'application/vnd.google-apps.folder' });
  assert.strictEqual(dossier.c.appliquerLigneConsolidation_({ fileId: '1VBK', nom: '04 · Immigration', action: 'Déplacer', cible: 'x' }, CTX_EXEC), 'saute');
  assert.deepStrictEqual(dossier.moves, [], 'une ligne forgée portant un ID de dossier ne déplace RIEN');
  assert.strictEqual(dossier.ajouts[0].statut, 'consolidé-refus');
});

test('appliquerLigneConsolidation_ : Doublon → moveTo vers _Doublons (décision par CONTENU, appliquée telle quelle)', () => {
  const { c, moves, ajouts } = ctxLigne({});
  const r = c.appliquerLigneConsolidation_({ fileId: 'F7', nom: 'd.pdf', action: 'Doublon', cible: '_Doublons' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(moves, ['DOUBLONS']);
  assert.strictEqual(ajouts[0].statut, 'consolidé-doublon');
});

/* ---------- détection auto des coquilles vides (ADR-0025, axe 1) : CONSTAT seul dans Réorg ---------- */

// Le parent QUITTÉ est un dossier RICHE (getName/getFiles/getFolders) dont la vacuité est configurable ;
// les fonctions cross-module (Reorg.gs non chargé ici) sont injectées ; feuille_ capte les appendRow.
function ctxVide(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'ConsolidationExec.gs']);
  const appends = [];
  const reorgData = [['Clé', 'Type', 'ID', 'CheminA', 'CheminP', 'Statut', 'Détail', 'H']].concat(opts.reorgData || []);
  c.indexContient_ = () => false;
  c.indexAjouter_ = () => {};
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => false;
  c.idDomaine_ = () => 'DOM';
  c.dossierDoublons_ = () => ({ getId: () => 'DOUBLONS' });
  c.sousDossier_ = (parent, nom) => ({ getId: () => parent.getId() + '/' + nom });
  c.champ_ = (s) => String(s == null ? '' : s).trim();
  c.cheminCibleConsolidation_ = () => (opts.cibleRecalculee !== undefined ? opts.cibleRecalculee : '');
  c.domaineActuelFichier_ = () => '02 · Finances';
  // Injections cross-module (Reorg.gs non chargé dans ce contexte de test).
  c.ensembleIntouchables_ = () => (opts.intouchables || {});
  c.estSegmentStructurel_ = () => !!opts.structurel;
  c.feuille_ = () => {
    if (opts.feuilleLeve) throw new Error('Sheet indisponible');
    return { getDataRange: () => ({ getValues: () => reorgData }), appendRow: (row) => { appends.push(row); } };
  };
  const ancienParent = {
    getId: () => opts.parentId || 'PARENT',
    getName: () => opts.parentNom || 'ENGIE',
    getParents: () => ({ hasNext: () => false, next: () => null }),
    getFiles: () => ({ hasNext: () => !!opts.resteFichier }),
    getFolders: () => ({ hasNext: () => !!opts.resteDossier }),
  };
  const fichier = {
    getParents: () => { let i = 0; const p = [ancienParent]; return { hasNext: () => i < p.length, next: () => p[i++] }; },
    getName: () => 'f.pdf', getMimeType: () => 'application/pdf', moveTo: () => {},
  };
  c.DriveApp = { getFolderById: (id) => ({ getId: () => id }), getFileById: () => fichier };
  return { c, appends };
}

function ctxV() { return { proteges: {}, tag: 'conso-2', validees: {}, parId: PAR_ID }; }

test('détection vide : le dossier QUITTÉ devenu vide → UNE ligne vide-candidat (constat seul, jamais de suppression)', () => {
  const v = ctxVide({ parentId: 'ENGIEID', parentNom: 'ENGIE' }); // vacuité par défaut (rien ne reste)
  const r = v.c.appliquerLigneConsolidation_({ fileId: 'F1', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(r, 'fait');
  assert.strictEqual(v.appends.length, 1, 'une inscription vide-candidat');
  assert.strictEqual(v.appends[0][0], 'videcandidat|ENGIEID');
  assert.strictEqual(v.appends[0][1], 'dossier-vide');
  assert.strictEqual(v.appends[0][5], 'vide-candidat', 'statut lu par l\'app (jamais corbeillé par le moteur)');
});

test('détection vide : un dossier qui reste NON vide → aucune inscription', () => {
  const resteF = ctxVide({ resteFichier: true });
  resteF.c.appliquerLigneConsolidation_({ fileId: 'F2', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(resteF.appends.length, 0, 'un fichier reste → pas un candidat');
  const resteD = ctxVide({ resteDossier: true });
  resteD.c.appliquerLigneConsolidation_({ fileId: 'F3', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(resteD.appends.length, 0, 'un sous-dossier reste → pas un candidat');
});

test('détection vide : jamais un dossier STRUCTUREL/INTOUCHABLE/PROTÉGÉ, même vide', () => {
  const struct = ctxVide({ structurel: true });
  struct.c.appliquerLigneConsolidation_({ fileId: 'F4', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(struct.appends.length, 0, 'année AAAA / schéma d\'entité : jamais corbeillable');

  const intouch = ctxVide({ parentId: 'ENGIEID', intouchables: { ENGIEID: true } });
  intouch.c.appliquerLigneConsolidation_({ fileId: 'F5', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(intouch.appends.length, 0, 'racine de domaine / catégorie / file système : jamais candidat');

  const prot = ctxVide({ parentId: 'ENGIEID' });
  const ctxP = ctxV(); ctxP.proteges = { ENGIEID: true };
  prot.c.appliquerLigneConsolidation_({ fileId: 'F6', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxP);
  assert.strictEqual(prot.appends.length, 0, 'zone protégée : jamais candidat (défense en profondeur)');
});

test('détection vide : dédup (déjà signalé) ; et un échec d\'inscription ne remet PAS en cause le déplacement', () => {
  const deja = ctxVide({ parentId: 'ENGIEID', reorgData: [['videcandidat|ENGIEID', 'dossier-vide', 'ENGIEID', '', '', 'vide-candidat', '', '']] });
  deja.c.appliquerLigneConsolidation_({ fileId: 'F7', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(deja.appends.length, 0, 'clé déjà présente → jamais un doublon de ligne');

  const casse = ctxVide({ feuilleLeve: true });
  const r = casse.c.appliquerLigneConsolidation_({ fileId: 'F8', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(r, 'fait', 'l\'inscription enveloppée ne casse jamais le déplacement déjà acquis');
});

/* ---------- appliquerPlanConsolidation_ : suite des curseurs d'une page mixte + échec ≤ 1×/jour ---------- */

function ctxPlan(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'ConsolidationExec.gs']);
  const store = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.COLONNES_PLAN_CONSOLIDATION = ['Horodaté', 'Fichier', 'ID', 'Action', 'Cible', 'Raison', 'Empreinte']; // Journal.gs
  const lignes = opts.lignes || []; // lignes de données (après l'en-tête)
  c.feuille_ = () => ({
    getLastRow: () => 1 + lignes.length,
    getRange: (ligne, col, nb) => ({ getValues: () => lignes.slice(ligne - 2, ligne - 2 + nb) }),
  });
  c.dateGmail_ = () => opts.jour || '2026/07/21';
  c.ensembleDomainesProteges_ = () => ({});
  c.entitesValideesParCle_ = () => ({});
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  const echecs = {};
  c.incrementerEchec_ = (cle) => { echecs[cle] = (echecs[cle] || 0) + 1; return echecs[cle]; };
  c.indexAjouter_ = () => {};
  const tentatives = [];
  c.appliquerLigneConsolidation_ = (ligne) => {
    tentatives.push(ligne.fileId);
    if ((opts.echouent || []).indexOf(ligne.fileId) !== -1) throw new Error('blip Drive');
    return 'fait';
  };
  return { c, store, tentatives, echecs };
}

const L = (fileId, action) => ['2026-07-21', fileId + '.pdf', fileId, action, 'cible', 'raison', ''];

test('appliquerPlanConsolidation_ : page MIXTE (OK sauté, Déplacer fait, Ignoré sauté, échec) → le curseur s\'arrête SUR la ligne en échec', () => {
  const { c, store, tentatives } = ctxPlan({
    lignes: [L('A', 'OK'), L('B', 'Déplacer'), L('C', 'Ignoré'), L('D', 'Déplacer'), L('E', 'Déplacer')],
    echouent: ['D'],
  });
  c.appliquerPlanConsolidation_(() => false);
  assert.deepStrictEqual(tentatives, ['B', 'D'], 'seules les lignes applicables sont tentées');
  // Lignes 2 (A/OK), 3 (B/fait), 4 (C/Ignoré) consommées → curseur = 4 ; D (ligne 5) re-tentée.
  assert.strictEqual(store.DriveAI_CONSO_EXEC_LIGNE, '4', 'curseur figé AVANT la ligne en échec');
  assert.ok(store.DriveAI_CONSO_EXEC_JOUR.startsWith('2026/07/21|'), 'ms réelles du jour écrites au finally');

  // Run suivant, MÊME jour : D échoue encore → PAS de 2ᵉ strike le même jour.
  const { c: c2, store: s2, echecs: e2 } = ctxPlan({
    props: { DriveAI_CONSO_EXEC_LIGNE: '4', DriveAI_CONSO_EXEC_EJ: '2026/07/21' },
    lignes: [L('A', 'OK'), L('B', 'Déplacer'), L('C', 'Ignoré'), L('D', 'Déplacer'), L('E', 'Déplacer')],
    echouent: ['D'],
  });
  c2.appliquerPlanConsolidation_(() => false);
  assert.deepStrictEqual(Object.keys(e2), [], 'échec déjà compté aujourd\'hui : aucun nouveau strike (leçon « par passe, jamais par rejeu »)');
  assert.strictEqual(s2.DriveAI_CONSO_EXEC_LIGNE, '4', 'curseur inchangé (aucune ligne consommée ce run)');
});

test('appliquerPlanConsolidation_ : l\'abandon exige QUARANTAINE_MAX JOURS distincts, puis le curseur avance', () => {
  const MAX = ctxPur.CONFIG.QUARANTAINE_MAX;
  // Le compteur porte déjà MAX-1 échecs (MAX-1 jours passés) ; aujourd'hui = jour non compté → 3ᵉ strike.
  const { c, store, echecs } = ctxPlan({
    props: { DriveAI_CONSO_EXEC_EJ: '2026/07/20' }, // dernier strike HIER → aujourd'hui compte
    lignes: [L('D', 'Déplacer'), L('E', 'Déplacer')],
    echouent: ['D'],
  });
  // Pré-charge le compteur à MAX-1 (jours précédents).
  for (let i = 0; i < MAX - 1; i++) c.incrementerEchec_('consoexec|essai|conso-2|D');
  c.appliquerPlanConsolidation_(() => false);
  assert.strictEqual(echecs['consoexec|essai|conso-2|D'], MAX, 'strike du jour porté au seuil');
  // D abandonnée (consommée) PUIS la boucle continue : E traitée → curseur = 3 (jamais gelé à vie).
  assert.strictEqual(store.DriveAI_CONSO_EXEC_LIGNE, '3', 'abandon consommé ET la page continue derrière');
});

test('appliquerPlanConsolidation_ : plan consommé + génération finie → FINI posé, puis COURT-CIRCUIT total (aucune I/O Sheet)', () => {
  const { c, store } = ctxPlan({
    props: { DriveAI_CONSO_EXEC_LIGNE: '3', DriveAI_CONSOLIDATION: 'conso-2' },
    lignes: [L('A', 'OK'), L('B', 'OK')], // dern = 3 = curseur
  });
  c.appliquerPlanConsolidation_(() => false);
  assert.strictEqual(store.DriveAI_CONSO_EXEC_FINI, 'conso-2');

  // Run suivant : le court-circuit sort AVANT feuille_ (une lecture de Property seulement).
  const { c: c2 } = ctxPlan({ props: { DriveAI_CONSO_EXEC_FINI: 'conso-2' } });
  c2.feuille_ = () => { throw new Error('feuille_ ne doit JAMAIS être appelée après FINI'); };
  c2.appliquerPlanConsolidation_(() => false); // ne lève pas
});

/* ---------- Verrou de surface : moveTo est la SEULE mutation du module ---------- */

test('ConsolidationExec.gs : aucune mutation hors moveTo (jamais de suppression/renommage/copie/partage/REST)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ConsolidationExec.gs'), 'utf8');
  ['setTrashed(', 'setName(', '.createFile(', '.createFolder(', 'removeFile(', 'addFile(', 'addFolder(', 'removeFolder(',
    'makeCopy(', 'setContent(', 'UrlFetchApp', 'files.delete', "'delete'", 'setSharing(', 'addEditor(', 'addViewer(']
    .forEach((motif) => {
      assert.ok(!src.includes(motif), 'mutation interdite dans ConsolidationExec.gs : ' + motif);
    });
  assert.ok(src.includes('moveTo('), 'le déplacement est bien le mécanisme du module');
});
