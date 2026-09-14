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

const ctxPur = load(['Config.gs', 'Router.gs', 'Consolidation.gs', 'ConsolidationExec.gs']);

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
  const c = load(['Config.gs', 'Router.gs', 'Consolidation.gs', 'ConsolidationExec.gs']);
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
  // (plus de stub `champ_` : Router.gs est chargé, donc `segmentsChemin_` — la règle de
  // découpage partagée avec le flux vivant — s'exécute POUR DE VRAI ici.)
  // La cible est RECALCULÉE via la règle unique — mockée ici (testée pour de vrai dans consolidation.test.js).
  c.cheminCibleConsolidation_ = () => ({
    nom: opts.cibleRecalculee !== undefined ? opts.cibleRecalculee : '2026',
    id: opts.dossierIdCible || '', faible: !!opts.cibleFaible, // {nom,id,faible} — ADR-0028 + D8
  });
  // ADR-0028 : le RÉSOLVEUR PARTAGÉ vit dans Router.gs (non chargé ici) — mocké. Par défaut null
  // ⇒ repli par NOM, c'est-à-dire le comportement historique que ces tests verrouillent.
  c.dossierEntiteParId_ = (id) => (id && opts.entiteResoluble !== false
    ? { dossier: { getId: () => 'ENT:' + id }, segments: ['Anciens employeurs', 'Robovic'] } : null);
  // ANCÊTRES : { id: { nom, parent } } — la chaîne que `positionActuelleFichier_` remonte POUR DE
  // VRAI (nom des dossiers traversés = sous-chemin actuel). Sans elle, un parent n'avait jamais de
  // parent : impossible de tester un fichier rangé PLUS PROFOND que la racine du domaine, donc
  // impossible de voir que D8/D9 n'étaient pas rejouées à la mutation (revue sécurité C28-90).
  const ancetres = opts.ancetres || {};
  const iter = (ids) => { let i = 0; return { hasNext: () => i < ids.length, next: () => dossierMock(ids[i++]) }; };
  function dossierMock(id) {
    return {
      getId: () => id,
      getName: () => (ancetres[id] ? ancetres[id].nom : id),
      getParents: () => iter(ancetres[id] ? [ancetres[id].parent] : []),
    };
  }
  const fichier = {
    // next() avance l'index LUI-MÊME (comme DriveApp) — un incrément caché dans getId() fausserait
    // le compteur de parents (vécu : hasNext éternel → faux « multi-parents »).
    getParents: () => iter(opts.parents || ['DOMID']),
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

test('appliquerLigneConsolidation_ : une cible VIDE ne remonte JAMAIS un fichier rangé à la racine', () => {
  // ⚠️ Ce test assertait l'INVERSE jusqu'au 13/09 (`moves === ['DOM']`) : il figeait en contrat un
  // défaut latent — la consolidation, récursive sur tout le domaine, proposait de remonter à la
  // RACINE tout fichier bien rangé dont le nom n'apprend rien. Mesuré par la revue sécurité sur le
  // corpus réel : 332 des 475 noms de `06` placés dans un dossier d'école repartaient à la racine,
  // c'est-à-dire l'exact inverse du mandat de la campagne (revue sécurité C28-90, 🔴).
  const plat = ctxLigne({ cibleRecalculee: '', parents: ['SOUS'], ancetres: { SOUS: { nom: 'Relevés', parent: 'DOMID' } } });
  const r1 = plat.c.appliquerLigneConsolidation_({ fileId: 'F2', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r1, 'saute');
  assert.deepStrictEqual(plat.moves, [], 'aucune règle ne sait le placer ⇒ on ne défait pas le rangement');
  assert.strictEqual(plat.ajouts[0].statut, 'consolidé-sur-place');
  assert.strictEqual(plat.ajouts[0].chemin, '02 · Finances/Relevés');

  // Fichier DÉJÀ à la racine du domaine et recalcul '' → aucun moveTo, et plus aucune I/O : c'est
  // `decisionConsolidation_` (« Déjà au bon endroit ») qui tranche, avant même de résoudre la cible.
  const enPlace = ctxLigne({ cibleRecalculee: '' });
  const r2 = enPlace.c.appliquerLigneConsolidation_({ fileId: 'F3', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r2, 'saute');
  assert.deepStrictEqual(enPlace.moves, [], 'déjà en place : aucun moveTo (rejeu sûr)');
  assert.strictEqual(enPlace.ajouts[0].statut, 'consolidé-sur-place');
});

/* ---------- D8 / D9 RE-APPLIQUÉES À LA MUTATION (revue sécurité C28-90, 🔴 2) ----------
 * Le plan est un INSTANTANÉ : entre sa génération et son exécution, les missions et le flux
 * tournent (dans le MÊME tick, APRÈS l'exécuteur). Un fichier peut donc avoir été rangé PLUS
 * FINEMENT entre-temps. L'exécuteur recalculait la CIBLE à l'état courant mais jugeait la
 * POSITION sur l'instantané : les deux gardes n'existaient qu'au dry-run.
 * Mutation qui doit faire tomber ces trois tests : retirer l'appel à `decisionConsolidation_`
 * dans `appliquerLigneConsolidation_` (le `moveTo` redevient inconditionnel). */
test('appliquerLigneConsolidation_ : D9 à la MUTATION — un fichier rangé plus finement n\'est JAMAIS remonté', () => {
  // Position réelle : « Assurance habitation/Desjardins » (bucket par émetteur créé par la mission
  // le 12/09). Cible recalculée : « Assurance habitation » — un ANCÊTRE de la position, atteint par
  // une règle FORTE (le thème est dans le nom, mais pas l'assureur). Le plan disait « Déplacer ».
  const t = ctxLigne({
    cibleRecalculee: 'Assurance habitation', parents: ['DESJ'],
    ancetres: {
      DESJ: { nom: 'Desjardins', parent: 'ASSUR' },
      ASSUR: { nom: 'Assurance habitation', parent: 'DOMID' },
    },
  });
  const r = t.c.appliquerLigneConsolidation_({ fileId: 'F20', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r, 'saute');
  assert.deepStrictEqual(t.moves, [], 'D9 : la cible est un ancêtre de la position — zéro mutation');
  assert.strictEqual(t.ajouts[0].statut, 'consolidé-sur-place');
  assert.strictEqual(t.ajouts[0].chemin, '02 · Finances/Assurance habitation/Desjardins');
});

test('appliquerLigneConsolidation_ : D8 à la MUTATION — un repli par TYPE ne sort pas un fichier d\'un sous-dossier', () => {
  // Cible FAIBLE (filet par type) et position LATÉRALE (pas un ancêtre) : seul D8 peut l'arrêter.
  const t = ctxLigne({
    cibleRecalculee: 'Contrats', cibleFaible: true, parents: ['ACHAT'],
    ancetres: {
      ACHAT: { nom: 'Recherche & achat', parent: 'VEHIC' },
      VEHIC: { nom: 'Véhicule', parent: 'DOMID' },
    },
  });
  const r = t.c.appliquerLigneConsolidation_({ fileId: 'F21', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r, 'saute');
  assert.deepStrictEqual(t.moves, [], 'D8 : le type seul ne déplace pas ce qui est déjà rangé');

  // MÊME cible faible, fichier à la RACINE du domaine → il DOIT partir (D8 ne gèle pas le vrac :
  // c'est tout l'objet de la campagne — « plus aucun fichier à plat »).
  const racine = ctxLigne({ cibleRecalculee: 'Contrats', cibleFaible: true });
  assert.strictEqual(racine.c.appliquerLigneConsolidation_({ fileId: 'F22', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC), 'fait');
  assert.deepStrictEqual(racine.moves, ['DOM/Contrats']);
});

test('appliquerLigneConsolidation_ : un déplacement LATÉRAL à signal FORT reste appliqué (la garde ne gèle pas le rattrapage)', () => {
  const t = ctxLigne({
    cibleRecalculee: 'Logement/3325 4e avenue', parents: ['CONTRATS'],
    ancetres: { CONTRATS: { nom: 'Contrats', parent: 'DOMID' } },
  });
  const r = t.c.appliquerLigneConsolidation_({ fileId: 'F23', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(t.moves, ['DOM/Logement/3325 4e avenue'], 'ni ancêtre ni signal faible : le rattrapage garde son pouvoir');
});

test('appliquerLigneConsolidation_ : dossier d\'entité REGROUPÉ → déplacé DEDANS par ID, jamais recréé à plat (ADR-0028)', () => {
  // Le scénario du bug : le plan (écrit avant le regroupement) dit « Déplacer vers Robovic ».
  // Sans résolution par ID, l'exécution find-or-create un « 02/Robovic » à PLAT tout neuf et sort le
  // fichier du dossier regroupé — puis le dossier vidé part en vide-candidat. Avec l'ID : on ouvre
  // le VRAI dossier, où qu'il soit sous le domaine.
  const t = ctxLigne({ cibleRecalculee: 'Robovic', dossierIdCible: 'ID_ROBO' });
  const r = t.c.appliquerLigneConsolidation_({ fileId: 'F9', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(t.moves, ['ENT:ID_ROBO'], 'ouvert par ID, pas de dossier à plat recréé');

  // Repli : le résolveur refuse l'ID (corbeillé, hors domaine, mort) → find-or-create par NOM,
  // c'est-à-dire exactement le comportement d'avant l'ADR-0028.
  const repli = ctxLigne({ cibleRecalculee: 'Robovic', dossierIdCible: 'ID_ROBO', entiteResoluble: false });
  const r2 = repli.c.appliquerLigneConsolidation_({ fileId: 'F10', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, CTX_EXEC);
  assert.strictEqual(r2, 'fait');
  assert.deepStrictEqual(repli.moves, ['DOM/Robovic'], 'repli par nom sous le domaine');
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
  // `Reset.gs` + `Reorg.gs` chargés POUR DE VRAI : la garde par capacité (`estNoeudRecreable_`) lit
  // la table de la taxonomie. La mocker reviendrait à tester ma propre copie de la question.
  const c = load(['Config.gs', 'Router.gs', 'Reset.gs', 'Reorg.gs', 'Consolidation.gs', 'ConsolidationExec.gs']);
  const appends = [];
  const ecrits = [];
  const reorgData = [['Clé', 'Type', 'ID', 'CheminA', 'CheminP', 'Statut', 'Détail', 'H']].concat(opts.reorgData || []);
  c.indexContient_ = () => false;
  c.indexAjouter_ = () => {};
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => false;
  c.idDomaine_ = () => 'DOM';
  c.dossierDoublons_ = () => ({ getId: () => 'DOUBLONS' });
  c.sousDossier_ = (parent, nom) => ({ getId: () => parent.getId() + '/' + nom });
  // (plus de stub `champ_` : Router.gs est chargé, donc `segmentsChemin_` — la règle de
  // découpage partagée avec le flux vivant — s'exécute POUR DE VRAI ici.)
  // Cible NON vide par défaut : depuis C28-90, une cible vide sur un fichier déjà rangé ne
  // déplace plus rien — et ces tests ont besoin d'un déplacement pour qu'un dossier se vide.
  c.cheminCibleConsolidation_ = () => ({ nom: opts.cibleRecalculee !== undefined ? opts.cibleRecalculee : 'Relevés', id: opts.dossierIdCible || '', faible: false });
  c.dossierEntiteParId_ = (id) => (id && opts.entiteResoluble !== false
    ? { dossier: { getId: () => 'ENT:' + id }, segments: ['Anciens employeurs', 'Robovic'] } : null);
  // Injections cross-module (Reorg.gs / Maintenance.gs non chargés dans ce contexte de test).
  c.ensembleIntouchables_ = () => (opts.intouchables || {});
  // Référentiel d'entités : NON VIDE par défaut. Depuis la revue quotas C28-93, un référentiel MUET
  // (illisible → `null`, ou vide) fait S'ABSTENIR de tout constat — « une panne n'est pas un
  // verdict ». Un stub vide ferait donc passer au vert un code qui ne constate plus rien.
  c.entitesValideesOuNull_ = () => (opts.validees !== undefined
    ? opts.validees
    : { 'referentiel|non-vide': { nom: '\u0000aucun-dossier-reel', dossierId: '' } });
  c.entitesValideesParCle_ = () => (c.entitesValideesOuNull_() || {});
  if (opts.structurel) c.estSegmentStructurel_ = () => true; // sinon : la VRAIE fonction de Reorg.gs
  c.chaineMonteVersProtege_ = (dossier, proteges) => !!(proteges && proteges[dossier.getId()]);
  c.feuille_ = () => {
    if (opts.feuilleLeve) throw new Error('Sheet indisponible');
    return {
      getLastRow: () => reorgData.length,
      // Rend la COLONNE DEMANDÉE, pas toujours la A : `chargerVidesConnus_` lit A (clés) PUIS F
      // (statuts). Un mock qui rendrait A pour les deux ferait passer un code qui confond les deux.
      getRange: (r, col, nbL, nbC) => ({
        getValues: () => reorgData.slice(r - 1, r - 1 + (nbL || 1)).map((row) => row.slice(col - 1, col - 1 + (nbC || 1))),
        setValues: (v) => {
          ecrits.push({ rang: r, col: col, valeurs: v[0] });
          for (let j = 0; j < v[0].length; j++) reorgData[r - 1][col - 1 + j] = v[0][j];
        },
      }),
      appendRow: (row) => { appends.push(row); },
    };
  };
  // Chaîne d'ancêtres CONFIGURABLE (du plus proche au plus lointain) : `positionActuelleFichier_`
  // ET `cheminPourConstat_` la remontent pour de vrai. Défaut : un seul niveau, la racine `DOMID`.
  const chaine = opts.chaineAncetres || [{ id: 'DOMID', nom: 'DOM' }];
  const ancetreDepuis = (rang) => {
    if (rang >= chaine.length) return { hasNext: () => false, next: () => null };
    let servi = false;
    return {
      hasNext: () => !servi,
      next: () => {
        servi = true;
        return { getId: () => chaine[rang].id, getName: () => chaine[rang].nom, getParents: () => ancetreDepuis(rang + 1) };
      },
    };
  };
  const ancienParent = {
    getId: () => opts.parentId || 'PARENT',
    getName: () => opts.parentNom || 'Colles', // nom RÉEL d'un dossier obsolète (décompte 13/09)
    getParents: () => { if (opts.chaineIllisible) throw new Error('illisible'); return ancetreDepuis(0); },
    getFiles: () => ({ hasNext: () => !!opts.resteFichier }),
    getFolders: () => ({ hasNext: () => !!opts.resteDossier }),
  };
  const fichier = {
    getParents: () => { let i = 0; const p = [ancienParent]; return { hasNext: () => i < p.length, next: () => p[i++] }; },
    getName: () => 'f.pdf', getMimeType: () => 'application/pdf', moveTo: () => {},
  };
  c.DriveApp = { getFolderById: (id) => ({ getId: () => id }), getFileById: () => fichier };
  return { c, appends, ecrits, reorgData };
}

function ctxV() { return { proteges: {}, tag: 'conso-2', validees: {}, parId: PAR_ID }; }

test('détection vide : le dossier QUITTÉ devenu vide → UNE ligne vide-candidat (constat seul, jamais de suppression)', () => {
  const v = ctxVide({ parentId: 'ENGIEID', parentNom: 'Colles' }); // vacuité par défaut (rien ne reste)
  const r = v.c.appliquerLigneConsolidation_({ fileId: 'F1', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(r, 'fait');
  assert.strictEqual(v.appends.length, 1, 'une inscription vide-candidat');
  assert.strictEqual(v.appends[0][0], 'videcandidat|ENGIEID');
  assert.strictEqual(v.appends[0][1], 'dossier-vide');
  assert.strictEqual(v.appends[0][5], 'vide-candidat', 'statut lu par l\'app (jamais corbeillé par le moteur)');
});

test('détection vide : JAMAIS un dossier que la taxonomie sait RECRÉER (C28-93)', () => {
  // Le décompte du 13/09 a trouvé, dans la liste des dossiers proposés à la corbeille de Marc :
  // `Robovic`, `Automatech`, `DriveAI`, `Novel Software`, `Candidatures` (des nœuds que la table
  // recrée PAR NOM) et deux dossiers NOMMÉS comme des domaines. Proposer de supprimer ce que le
  // moteur recrée au premier document ne mène nulle part — et le premier de la liste étant un nom
  // que l'app REFUSE, le bouton « tout corbeiller » s'arrêtait dessus pour les 123 suivants.
  // Mutation : retirer l'appel à `estNoeudRecreable_` dans `detecterDossierVide_` ⇒ ce test tombe.
  for (const nom of ['Robovic', 'Automatech', 'DriveAI', 'Novel Software', 'Candidatures',
    'Contrats', 'Cours & travaux', '02 · Finances', '05 · Carrière', '_Doublons', '2024']) {
    const v = ctxVide({ parentId: 'ID_' + nom, parentNom: nom });
    v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
    assert.strictEqual(v.appends.length, 0, nom + ' : la taxonomie le recrée ⇒ jamais proposé');
  }
  // …et un dossier VRAIMENT obsolète reste proposé : la garde ne gèle pas la fonctionnalité.
  const obsolete = ctxVide({ parentId: 'ID_OBS', parentNom: 'IUT GIM 1' });
  obsolete.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(obsolete.appends.length, 1, 'un dossier que rien ne recrée reste un candidat');
});

test('détection vide : le constat porte le CHEMIN, pas seulement le nom (C28-93)', () => {
  // Deux « Mémoire », deux « Exercices », quatre graphies d'« IUT Du Littoral » dans la même liste :
  // sans chemin, Marc ne peut pas savoir lequel est lequel, donc ne peut pas trancher autrement
  // qu'en bloc. Mutation : réécrire `nom` à la place de `cheminPourConstat_(...)` ⇒ ce test tombe.
  const v = ctxVide({ parentId: 'ID_MEM', parentNom: 'Mémoire' });
  v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(v.appends.length, 1);
  assert.strictEqual(v.appends[0][3], 'DOM/Mémoire', 'le chemin remonte jusqu\'à la racine de domaine');
});

test('détection vide : le référentiel d\'entités est résolu MÊME quand le ctx ne le porte pas', () => {
  // Sur les 5 appelants de `detecterDossierVide_`, TROIS construisaient un ctx sans `validees` —
  // dont `FusionExec`, celui qui vide justement les dossiers d'ENTITÉ (il vient d'appeler
  // `repointerEntites_`). La branche « entité validée » était donc morte là où elle sert le plus.
  // Mutation : retirer la résolution lazy ⇒ ce test tombe.
  const v = ctxVide({ parentId: 'ID_ENT', parentNom: 'Kim Pinsonneault' });
  v.c.entitesValideesOuNull_ = () => ({ 'cle|kim': { nom: 'Kim Pinsonneault', dossierId: 'ID_ENT' } });
  const ctxSansValidees = { proteges: {}, tag: 'conso-2', parId: PAR_ID }; // comme FusionExec
  v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxSansValidees);
  assert.strictEqual(v.appends.length, 0, 'dossier d\'entité validée : jamais proposé à la corbeille');

  // …et le référentiel n'est lu QU'UNE fois par run (mémoïsé sur le ctx, comme `intouchables`).
  const compte = ctxVide({ parentId: 'ID_AUTRE', parentNom: 'IUT GIM 1' });
  let lectures = 0;
  compte.c.entitesValideesOuNull_ = () => { lectures++; return { 'k|x': { nom: 'Zzz', dossierId: '' } }; };
  const ctxPartage = { proteges: {}, tag: 'conso-2', parId: PAR_ID };
  compte.c.appliquerLigneConsolidation_({ fileId: 'F1', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxPartage);
  compte.c.appliquerLigneConsolidation_({ fileId: 'F2', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxPartage);
  assert.strictEqual(lectures, 1, 'une seule lecture du référentiel pour tout le run');
});

test('détection vide : un référentiel MUET fait s\'abstenir — une panne n\'est pas un verdict (revue quotas C28-93)', () => {
  // `entitesValideesParCle_` échoue OUVERT : elle avale son exception et rend `{}`. Pour le ROUTAGE
  // c'est la bonne dégradation (classement à plat, réversible) ; ici c'est un faux verdict
  // DÉFINITIF — la clé `videcandidat|<id>` n'est jamais ré-évaluée, et l'app ne protège pas les
  // dossiers d'entité : Marc verrait « Robovic » dans sa liste, et il cliquerait. Symétrique exact
  // du 🔴 `ascendance-illisible` côté app.
  // Mutation : remettre `estNoeudRecreable_` (nu) à la place de `estNoeudRecreablePrudent_`, ou
  // rendre `{}` acceptable ⇒ ces deux cas tombent.
  for (const muet of [null, {}]) {
    const v = ctxVide({ parentId: 'ID_ENT2', parentNom: 'Kim Pinsonneault', validees: muet });
    v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
    assert.strictEqual(v.appends.length, 0,
      'référentiel ' + (muet === null ? 'illisible' : 'vide') + ' : aucun constat écrit');
  }
  // …et le référentiel RÉPOND ⇒ la fonction vit toujours (la garde ne la gèle pas).
  const ok = ctxVide({ parentId: 'ID_OBS2', parentNom: 'IUT GIM 1' });
  ok.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(ok.appends.length, 1, 'référentiel lu : le constat est écrit');
});

test('détection vide : `vide-repris` est RÉVISABLE — un dossier re-vidé est re-proposé (revue C28-93)', () => {
  // Des quatre statuts que l'app écrit, `vide-repris` est le seul qui fige un fait RÉVISABLE : « il
  // n'était plus vide AU MOMENT DU CLIC ». Il redevient faux dès que la consolidation le re-vide.
  // Cas fréquent et sournois : `compterEnfantsStrict` compte aussi les enfants CORBEILLÉS — un
  // dossier qui n'a plus que des corbeillés rend `non-vide` → `vide-repris` alors que rien ne l'a
  // re-rempli. Mutation : retirer le `continue` sur `vide-repris` ⇒ ce test tombe.
  const ligne = (statut) => [['videcandidat|REPRIS', 'dossier-vide', 'REPRIS', 'DOM/X', '', statut, '', '']];
  const repris = ctxVide({ parentId: 'REPRIS', parentNom: 'IUT GIM 1', reorgData: ligne('vide-repris') });
  repris.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  // ⚠️ RÉ-ARMÉE SUR PLACE, pas appendée (relevé en 3ᵉ revue) : appendre une seconde ligne de même
  // clé dans un onglet append-only la ferait croître à chaque cycle rempli→vidé, et laisserait deux
  // lignes contradictoires sous la même clé. Mutation : revenir à `appendRow` ⇒ ce test tombe.
  assert.strictEqual(repris.appends.length, 0, 'aucune seconde ligne de même clé');
  assert.strictEqual(repris.ecrits.length, 1, 'la ligne existante est réécrite');
  assert.strictEqual(repris.ecrits[0].rang, 2);
  assert.strictEqual(repris.ecrits[0].valeurs[2], 'vide-candidat', 'un dossier re-vidé revient dans la liste');

  // …alors que les statuts DÉFINITIFS, eux, tiennent : la ligne ne revient jamais.
  for (const fige of ['vide-protégé', 'vide-disparu', 'corbeillé', 'vide-candidat']) {
    const v = ctxVide({ parentId: 'REPRIS', parentNom: 'IUT GIM 1', reorgData: ligne(fige) });
    v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
    assert.strictEqual(v.appends.length, 0, fige + ' : verdict définitif, jamais re-proposé');
  }
});

test('cheminPourConstat_ : s\'arrête à la racine de domaine, borné, et dégrade sans jamais lever', () => {
  // Testée DIRECTEMENT : par le bout du pipeline, la chaîne d'ancêtres sert AUSSI à
  // `positionActuelleFichier_`, et la rendre illisible fait sortir la ligne bien avant la détection.
  // Les deux branches (arrêt au domaine, borne de profondeur) étaient passées non verrouillées :
  // la revue les a fait tomber par mutation sans qu'aucun test ne bouge.
  const { c } = ctxVide({});
  const faux = (chaine) => {
    const noeud = (rang) => ({
      getId: () => chaine[rang].id,
      getName: () => chaine[rang].nom,
      getParents: () => {
        let servi = rang + 1 >= chaine.length;
        return { hasNext: () => !servi, next: () => { servi = true; return noeud(rang + 1); } };
      },
    });
    return noeud(0);
  };

  // (a) ARRÊT au domaine : ce qui est AU-DESSUS n'apparaît jamais.
  const chaine = [{ id: 'ID_X', nom: 'Colles' }, { id: 'ID_ARCH', nom: 'Archives scolaires' },
    { id: 'DOMID', nom: '06 · Études & diplômes' }, { id: 'RACINE', nom: 'Mon Drive' }];
  assert.strictEqual(
    c.cheminPourConstat_(faux(chaine), 'Colles', { intouchables: { DOMID: true } }),
    '06 · Études & diplômes/Archives scolaires/Colles',
    'le domaine ferme le chemin : ni « Mon Drive », ni au-dessus',
  );

  // (b) BORNE : une chaîne sans racine connue s'arrête sur la borne, jamais à l'infini.
  const profonde = Array.from({ length: 20 }, (_, i) => ({ id: 'N' + i, nom: 'n' + i }));
  const segments = c.cheminPourConstat_(faux(profonde), 'n0', { intouchables: {} }).split('/');
  assert.strictEqual(segments.length, 11, '10 ancêtres au plus, + le dossier lui-même');
  assert.strictEqual(segments[segments.length - 1], 'n0');

  // (c) CHAÎNE ILLISIBLE : dégrade sur le nom, jamais une exception — un constat ne doit pas
  // échouer pour un libellé (c'est pour ça que le nom vient de l'appelant, hors du `try`).
  const casse = { getName: () => { throw new Error('jamais appelé'); }, getParents: () => { throw new Error('illisible'); } };
  assert.strictEqual(c.cheminPourConstat_(casse, 'Colles', { intouchables: {} }), 'Colles');
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
  const c = load(['Config.gs', 'Router.gs', 'Consolidation.gs', 'ConsolidationExec.gs']);
  c.CONFIG.CONSOLIDATION_TAG = 'conso-2'; // FORCÉ : ces fixtures encodent 'conso-2' ; le défaut prod
  // est passé à 'conso-3' (2026-08-05, ADR-0035, bump anti-plan-périmé). Leçon §7 : forcer la valeur
  // dans le contexte, jamais dépendre du défaut du jour.
  // Le plan de l'onglet est posé SOUS LE TAG COURANT — sans quoi l'exécuteur refuse d'appliquer
  // quoi que ce soit (garde de campagne, revue sécurité C28-90 🟠 6). Surchargeable par `props`.
  const store = Object.assign({ DriveAI_CONSO_PLAN_TAG: 'conso-2' }, opts.props);
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

test('appliquerPlanConsolidation_ : un plan posé sous un AUTRE tag n\'est JAMAIS appliqué', () => {
  // Revue sécurité C28-90 (🟠 6) : l'exécuteur tourne AVANT le générateur dans le tick, et c'est le
  // GÉNÉRATEUR qui purge le plan périmé au changement de tag. Au premier tick d'un bump, l'onglet
  // porte donc encore les lignes de la campagne précédente. Pour un « Déplacer », la cible est
  // recalculée (atténué) ; pour un « Doublon », la décision par CONTENU serait appliquée telle
  // quelle, sur une comparaison d'empreintes vieille d'un mois — et sous la clé du NOUVEAU tag,
  // donc jamais rejouée. Mutation : retirer la garde de tag → ce test tombe.
  const { c, store, tentatives } = ctxPlan({
    props: { DriveAI_CONSO_PLAN_TAG: 'conso-1' }, // plan de la campagne PRÉCÉDENTE
    lignes: [L('A', 'Déplacer'), L('B', 'Doublon')],
  });
  c.feuille_ = () => { throw new Error('feuille_ ne doit JAMAIS être appelée sur un plan périmé'); };
  c.appliquerPlanConsolidation_(() => false); // ne lève pas : on sort avant toute I/O Sheet
  assert.deepStrictEqual(tentatives, [], 'aucune ligne du plan périmé n\'est appliquée');
  assert.strictEqual(store.DriveAI_CONSO_EXEC_LIGNE, undefined, 'aucun curseur posé');

  // …et dès que le générateur a purgé/reposé le plan sous le tag courant, l'exécution reprend.
  const ok = ctxPlan({ lignes: [L('A', 'Déplacer')] }); // DriveAI_CONSO_PLAN_TAG = 'conso-2' par défaut
  ok.c.appliquerPlanConsolidation_(() => false);
  assert.deepStrictEqual(ok.tentatives, ['A']);
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

test('détection vide : sans l\'ensemble des racines PROTÉGÉES, on ne constate rien (§1, échec dur)', () => {
  // `ctx.proteges || {}` faisait échouer le garde §1 OUVERT : avec un ensemble vide,
  // `chaineMonteVersProtege_` rend `false` pour TOUT — la zone protégée cesse d'exister sans que
  // rien ne lève. C'est la forme exacte du défaut corrigé juste avant pour `ctx.validees`, sur le
  // garde-fou le moins négociable du projet. Mutation : remettre `ctx.proteges || {}` ⇒ tombe.
  const v = ctxVide({ parentId: 'ID_X', parentNom: 'IUT GIM 1' });
  const sansProteges = { tag: 'conso-2', validees: {}, parId: PAR_ID }; // pas de `proteges`
  v.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, sansProteges);
  assert.strictEqual(v.appends.length, 0, 'pas d\'ensemble protégé ⇒ pas de constat');
  // …et avec l'ensemble (même vide mais PRÉSENT), le constat repart : la garde ne gèle rien.
  const ok = ctxVide({ parentId: 'ID_Y', parentNom: 'IUT GIM 1' });
  ok.c.appliquerLigneConsolidation_({ fileId: 'F', nom: 'f.pdf', action: 'Déplacer', cible: 'x' }, ctxV());
  assert.strictEqual(ok.appends.length, 1);
});
