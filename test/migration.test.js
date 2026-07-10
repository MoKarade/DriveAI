'use strict';
/**
 * Chantier #8 (ADR-0002) — migration de l'existant vers la nouvelle taxonomie (Migration.gs) :
 *  - `estAMigrer_` : prédicat de collecte (convergence par clé `migre|<tag>|fileId`).
 *  - `collecterAMigrer_` : walk récursif borné, un fichier illisible n'avorte jamais la collecte.
 *  - `migrerFichier_` : zone protégée revérifiée STRICT avant mutation (inscrite → convergence),
 *    placement = renommage seul quand la destination est le dossier courant.
 *  - Pipeline `ignorerDoublon` : un doc migré n'est jamais « doublon de lui-même ».
 *  - Fix convergence rangement : `estAReclasserLeger_` reconnaît les 3 granularités de date.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter, fakeFile } = require('./harness');

/* ---------- estAMigrer_ + collecterAMigrer_ ---------- */

function ctxMigration(clesIndexees) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = (cle) => (clesIndexees || []).indexOf(cle) !== -1;
  return ctx;
}

test('estAMigrer_ : fichier classique non traité → true ; Google natif / raccourci → false', () => {
  const ctx = ctxMigration([]);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'A', mime: 'application/pdf' }), 'm1'), true);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'B', mime: 'image/jpeg' }), 'm1'), true);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'C', mime: 'application/vnd.google-apps.document' }), 'm1'), false);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'D', mime: 'application/vnd.google-apps.shortcut' }), 'm1'), false);
});

test('estAMigrer_ : déjà re-traité dans CETTE campagne (clé migre|) → false (convergence)', () => {
  const ctx = ctxMigration(['migre|m1|DEJA']);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'm1'), false);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'm2'), true); // autre campagne
});

function fauxDossier(fichiers, sousDossiers) {
  return {
    getFiles: () => iter(fichiers || []),
    getFolders: () => iter(sousDossiers || []),
  };
}

test('collecterAMigrer_ : walk récursif, plafond respecté, fichier illisible sauté', () => {
  const ctx = ctxMigration([]);
  const cassé = {
    getMimeType: () => { throw new Error('métadonnée illisible'); },
    getId: () => 'KO',
  };
  const sous = fauxDossier([fakeFile({ id: 'S1' }), fakeFile({ id: 'S2' })]);
  const racine = fauxDossier([fakeFile({ id: 'R1' }), cassé, fakeFile({ id: 'R2' })], [sous]);

  const ids = [];
  ctx.collecterAMigrer_(racine, ids, 10, () => false);
  assert.deepStrictEqual(ids, ['R1', 'R2', 'S1', 'S2']); // cassé sauté, récursion OK

  const ids2 = [];
  ctx.collecterAMigrer_(racine, ids2, 3, () => false);
  assert.strictEqual(ids2.length, 3); // plafond

  const ids3 = [];
  ctx.collecterAMigrer_(racine, ids3, 10, () => true); // budget épuisé → stop immédiat
  assert.strictEqual(ids3.length, 0);
});

/* ---------- migrerFichier_ : zone protégée + placement ---------- */

function ctxMigrerFichier(opts) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const calls = { index: [], traites: [], renomme: [], deplace: [], journaux: [] };
  ctx.journalInfo_ = (s, m) => calls.journaux.push(m);
  ctx.journalErreur_ = () => {};
  ctx.indexAjouter_ = (cle, res, emp) => calls.index.push({ cle, res, emp });
  ctx.traiterDocument_ = (src) => calls.traites.push(src);
  ctx.renommer_ = (id, nom) => { calls.renomme.push({ id, nom }); return true; };
  ctx.deplacerEtRenommer_ = (id, nouveau, ancien, nom) => { calls.deplace.push({ id, nouveau, ancien, nom }); return true; };
  ctx.aParentProtege_ = () => !!opts.protege;
  ctx.DriveApp = {
    getFileById: () => ({
      getName: () => 'doc 2024.pdf',
      getSize: () => 1234,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => ({}),
      getParents: () => iter([{ getId: () => 'PARENT' }]),
    }),
  };
  return { ctx, calls };
}

test('migrerFichier_ : zone protégée (strict) → non touché, inscrit « zone protégée » (convergence)', () => {
  const { ctx, calls } = ctxMigrerFichier({ protege: true });
  const r = ctx.migrerFichier_('F1', {});
  assert.strictEqual(r, false);
  assert.strictEqual(calls.traites.length, 0);                       // jamais passé au pipeline
  assert.strictEqual(calls.index.length, 1);                          // mais inscrit → plus jamais re-collecté
  assert.strictEqual(calls.index[0].cle, 'migre|m1|F1');
  assert.strictEqual(calls.index[0].res.statut, 'zone protégée');
});

test('migrerFichier_ : descripteur pipeline (clé migre|, ignorerDoublon) + placement in-place', () => {
  const { ctx, calls } = ctxMigrerFichier({ protege: false });
  const r = ctx.migrerFichier_('F2', {});
  assert.strictEqual(r, true);
  assert.strictEqual(calls.traites.length, 1);
  const src = calls.traites[0];
  assert.strictEqual(src.cle, 'migre|m1|F2');
  assert.strictEqual(src.ignorerDoublon, true);
  assert.strictEqual(src.nom, 'doc 2024.pdf');

  // Destination = dossier COURANT → renommage seul (jamais addParents==removeParents).
  assert.strictEqual(src.placer('PARENT', 'nouveau.pdf'), 'F2');
  assert.deepStrictEqual(calls.renomme, [{ id: 'F2', nom: 'nouveau.pdf' }]);
  assert.strictEqual(calls.deplace.length, 0);

  // Destination différente → déplacement + renommage (move-only, ancien parent retiré).
  assert.strictEqual(src.placer('AILLEURS', 'n2.pdf'), 'F2');
  assert.deepStrictEqual(calls.deplace, [{ id: 'F2', nouveau: 'AILLEURS', ancien: 'PARENT', nom: 'n2.pdf' }]);
});

test('migrerFichier_ : document illisible → quarantaine (gererEchec_), jamais un blocage de campagne', () => {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const echecs = [];
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.gererEchec_ = (src, motif) => echecs.push({ cle: src.cle, motif });
  ctx.traiterDocument_ = () => { throw new Error('ne doit pas être atteint'); };
  ctx.aParentProtege_ = () => false;
  ctx.DriveApp = { getFileById: () => { throw new Error('introuvable'); } };
  assert.strictEqual(ctx.migrerFichier_('KO', {}), false);
  assert.strictEqual(echecs.length, 1);                 // → compteur d'échecs → quarantaine après N
  assert.strictEqual(echecs[0].cle, 'migre|m1|KO');     // sous la clé de campagne (convergence)
});

/* ---------- Pipeline : bypass du fast-path doublon ---------- */

function ctxPipeline(ignorer) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const calls = { placerDoublon: [], echecs: [] };
  ctx.journalInfo_ = () => {};
  ctx.estPannePlateforme_ = () => false; // garde panne de compte (Llm.gs non chargé ici)
  ctx.indexContient_ = () => false;
  ctx.empreinteBlob_ = () => 'EMPREINTE';
  ctx.estDoublon_ = () => true;                       // le contenu EST déjà connu de l'Index
  ctx.doublonRapide_ = (nom) => ({ dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '' });
  ctx.indexAjouter_ = () => {};
  ctx.estTechnique_ = () => false;
  ctx.estMediaDirect_ = () => false;
  ctx.estPhoto_ = () => false;
  ctx.extension_ = () => '.pdf';
  ctx.extraireTexte_ = () => '';
  ctx.classifier_ = () => null;                       // stoppe le pipeline après le fast-path (test ciblé)
  ctx.gererEchec_ = (src, motif) => calls.echecs.push(motif);
  const src = {
    cle: 'migre|m1|X', nom: 'doc.pdf', taille: 10, date: new Date('2026-07-01T00:00:00Z'),
    ignorerDoublon: !!ignorer,
    blob: () => ({}),
    placer: (dossierId, nom) => { calls.placerDoublon.push({ dossierId, nom }); return 'X'; },
  };
  return { ctx, calls, src };
}

test('traiterDocument_ : SANS ignorerDoublon, contenu connu → fast-path _Doublons', () => {
  const { ctx, calls, src } = ctxPipeline(false);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 1);
  assert.strictEqual(calls.placerDoublon[0].dossierId, 'DUP');
});

test('traiterDocument_ : AVEC ignorerDoublon (migration), le fast-path est sauté (pas « doublon de soi »)', () => {
  const { ctx, calls, src } = ctxPipeline(true);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 0);   // pas parti en _Doublons
  assert.deepStrictEqual(calls.echecs, ['classification impossible']); // preuve : a continué jusqu'au LLM (mocké null)
});

/* ---------- C26-08 (ADR-0018) : re-analyse v2 ciblée ---------- */

test('TRIPWIRE cibles : REANALYSE_CIBLES existent dans DOMAINES et n\'intersectent JAMAIS la zone protégée', () => {
  const ctx = load(['Config.gs']);
  const cibles = ctx.CONFIG.REANALYSE_CIBLES;
  assert.ok(Array.isArray(cibles) && cibles.length > 0);
  cibles.forEach((dom) => {
    // Un libellé absent de DOMAINES ⇒ getFolderById(undefined) lève à CHAQUE tick → erreurCollecte
    // permanente → la campagne ne se figerait JAMAIS (reste=true à vie).
    assert.ok(dom in ctx.CONFIG.DOMAINES, 'cible hors DOMAINES fixes : ' + dom);
    assert.strictEqual(ctx.CONFIG.DOMAINES_PROTEGES.indexOf(dom), -1, 'cible protégée interdite : ' + dom);
  });
});

test('migrerUnePage_ : les domaines de REANALYSE_CIBLES sont EXCLUS de m1 (jamais payés deux fois v1+v2)', () => {
  const ctx = ctxMigration([]);
  const visites = [];
  // Cas dérivés de la CONFIG (jamais des libellés du jour) : on note l'ID de chaque dossier ouvert.
  ctx.DriveApp = { getFolderById: (id) => { visites.push(id); return fauxDossier([]); } };
  ctx.ensembleDomainesProteges_ = () => ({});
  ctx.migrerUnePage_(() => false, {});
  const cibles = ctx.CONFIG.REANALYSE_CIBLES.map((dom) => ctx.CONFIG.DOMAINES[dom]);
  const protges = ctx.CONFIG.DOMAINES_PROTEGES.map((dom) => ctx.CONFIG.DOMAINES[dom]);
  cibles.forEach((id) => assert.strictEqual(visites.indexOf(id), -1, 'cible C26-08 visitée par m1 : ' + id));
  protges.forEach((id) => assert.strictEqual(visites.indexOf(id), -1, 'zone protégée visitée par m1 : ' + id));
  // Non-régression : m1 visite toujours les AUTRES domaines fixes.
  const attendus = Object.keys(ctx.CONFIG.DOMAINES)
    .filter((d) => ctx.CONFIG.DOMAINES_PROTEGES.indexOf(d) === -1 && ctx.CONFIG.REANALYSE_CIBLES.indexOf(d) === -1)
    .map((d) => ctx.CONFIG.DOMAINES[d]);
  assert.deepStrictEqual(visites, attendus);
});

test('estAReanalyser_ : convergence par clé reanalyse|<tag>| ; natifs exclus ; indépendant des clés migre|', () => {
  const ctx = ctxMigration(['reanalyse|c26-08|DEJA', 'migre|m1|AUTRE']);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'LIBRE', mime: 'application/pdf' }), 'c26-08'), true);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'c26-08'), false);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'c27'), true); // autre campagne
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'AUTRE', mime: 'application/pdf' }), 'c26-08'), true); // migre| ≠ reanalyse|
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'N', mime: 'application/vnd.google-apps.document' }), 'c26-08'), false);
});

function ctxReanalyseCampagne(props) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const journal = [];
  ctx.journalInfo_ = (s, m) => journal.push(m);
  ctx.journalErreur_ = () => {};
  ctx.rangementTermine_ = () => props.rangement !== false;
  ctx.ensembleDomainesProteges_ = () => ({});
  // Compteurs de barre (C28-18, Maintenance.gs) : hors sujet ici — l'orchestration seule est testée.
  ctx.majCompteurCampagne_ = () => {};
  ctx.finaliserCompteurCampagne_ = () => {};
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props.valeurs ? props.valeurs[k] : null),
      setProperty: (k, v) => { props.valeurs[k] = String(v); },
      deleteProperty: (k) => { delete props.valeurs[k]; },
    }),
  };
  return { ctx, journal };
}

test('appliquerReanalyseCiblee_ : ne démarre JAMAIS tant que m1 n\'est pas finie (une campagne de masse à la fois)', () => {
  const props = { valeurs: {} }; // DriveAI_MIGRATION absent → m1 en cours
  const { ctx } = ctxReanalyseCampagne(props);
  ctx.reanalyserUnePage_ = () => { throw new Error('ne doit pas collecter pendant m1'); };
  ctx.appliquerReanalyseCiblee_(() => false); // ne lève pas → la garde a court-circuité
  assert.ok(!('DriveAI_REANALYSE' in props.valeurs));
});

test('appliquerReanalyseCiblee_ : m1 finie + passe complète VIDE → Property figée (terminé) ; page pleine → jamais figée', () => {
  // Barre pré-recensée POUR LE TAG COURANT (C28-18) : sans elle, le premier tick est un tick
  // DÉDIÉ de recensement (et un BARRE_TAG absent/étranger purge la base — leçon « seuil dans la clé »).
  const props1 = { valeurs: { DriveAI_MIGRATION: 'm1', DriveAI_REANALYSE_BASE: '0' } };
  const ctx1 = ctxReanalyseCampagne(props1);
  props1.valeurs.DriveAI_REANALYSE_BARRE_TAG = ctx1.ctx.CONFIG.REANALYSE_TAG;
  ctx1.ctx.reanalyserUnePage_ = () => ({ traites: 0, collectes: 0, reste: false });
  ctx1.ctx.appliquerReanalyseCiblee_(() => false);
  assert.strictEqual(ctx1.ctx.PropertiesService.getScriptProperties().getProperty('DriveAI_REANALYSE'),
    ctx1.ctx.CONFIG.REANALYSE_TAG);

  const props2 = { valeurs: { DriveAI_MIGRATION: 'm1', DriveAI_REANALYSE_BASE: '900' } };
  const ctx2 = ctxReanalyseCampagne(props2);
  props2.valeurs.DriveAI_REANALYSE_BARRE_TAG = ctx2.ctx.CONFIG.REANALYSE_TAG;
  ctx2.ctx.reanalyserUnePage_ = () => ({ traites: 12, collectes: 12, reste: true });
  ctx2.ctx.appliquerReanalyseCiblee_(() => false);
  assert.ok(!('DriveAI_REANALYSE' in props2.valeurs), 'une page PLEINE ne doit jamais figer la campagne');
  // Et une fois figée, plus aucune collecte (idempotence du re-lancement).
  ctx1.ctx.reanalyserUnePage_ = () => { throw new Error('campagne finie : ne doit plus collecter'); };
  ctx1.ctx.appliquerReanalyseCiblee_(() => false);
});

test('appliquerReanalyseCiblee_ : tick DÉDIÉ de recensement (C28-18) — pose la base SANS collecter, filet du partiel', () => {
  // 1ᵉʳ tick : recensement complet → BASE/TRAITES posés, la page n'est PAS lancée.
  const props = { valeurs: { DriveAI_MIGRATION: 'm1' } };
  const { ctx } = ctxReanalyseCampagne(props);
  ctx.reanalyserUnePage_ = () => { throw new Error('le tick de recensement ne collecte pas'); };
  ctx.compterRestantReanalyse_ = () => ({ n: 924, complet: true });
  ctx.appliquerReanalyseCiblee_(() => false);
  assert.deepStrictEqual(
    [props.valeurs.DriveAI_REANALYSE_BASE, props.valeurs.DriveAI_REANALYSE_TRAITES], ['924', '0']);

  // Recensement PARTIEL : réessais comptés, base non posée — puis filet (compte partiel accepté)
  // au bout d'ESSAIS_MAX passes (cas dérivés de la CONSTANTE, jamais de sa valeur du jour).
  const props2 = { valeurs: { DriveAI_MIGRATION: 'm1' } };
  const c2 = ctxReanalyseCampagne(props2);
  c2.ctx.reanalyserUnePage_ = () => { throw new Error('ne collecte pas pendant le recensement'); };
  c2.ctx.compterRestantReanalyse_ = () => ({ n: 40, complet: false });
  const ESSAIS_MAX = c2.ctx.CONFIG.RANGEMENT_RECENS_ESSAIS_MAX;
  for (let i = 1; i < ESSAIS_MAX; i++) {
    c2.ctx.appliquerReanalyseCiblee_(() => false);
    assert.ok(!('DriveAI_REANALYSE_BASE' in props2.valeurs), 'partiel → base non posée (essai ' + i + ')');
    assert.strictEqual(props2.valeurs.DriveAI_REANALYSE_RECENS, String(i));
  }
  c2.ctx.appliquerReanalyseCiblee_(() => false); // essai n° ESSAIS_MAX → filet : partiel ACCEPTÉ
  assert.strictEqual(props2.valeurs.DriveAI_REANALYSE_BASE, '40',
    'après ' + ESSAIS_MAX + ' recensements incomplets, le compte partiel devient la base (jamais bloqué)');

  // Leçon §7 « le seuil va dans la clé » : la barre d'une campagne PRÉCÉDENTE (autre tag) est
  // purgée — la nouvelle campagne re-recense au lieu d'hériter d'une barre figée à 100 %.
  const props3 = { valeurs: { DriveAI_MIGRATION: 'm1', DriveAI_REANALYSE_BARRE_TAG: 'ancien-tag', DriveAI_REANALYSE_BASE: '900', DriveAI_REANALYSE_TRAITES: '900' } };
  const c3 = ctxReanalyseCampagne(props3);
  c3.ctx.reanalyserUnePage_ = () => { throw new Error('ne collecte pas pendant le recensement'); };
  c3.ctx.compterRestantReanalyse_ = () => ({ n: 500, complet: true });
  c3.ctx.appliquerReanalyseCiblee_(() => false);
  assert.strictEqual(props3.valeurs.DriveAI_REANALYSE_BARRE_TAG, c3.ctx.CONFIG.REANALYSE_TAG);
  assert.strictEqual(props3.valeurs.DriveAI_REANALYSE_BASE, '500', 'barre héritée purgée → re-recensée pour CE tag');
});

test('reanalyserFichier_ : zone protégée inscrite sous la clé reanalyse| ; pipeline v2 reçu avec ignorerDoublon', () => {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const calls = { index: [], traites: [] };
  ctx.journalInfo_ = () => {};
  ctx.indexAjouter_ = (cle, res) => calls.index.push({ cle, statut: res.statut });
  ctx.traiterDocument_ = (src) => calls.traites.push(src);
  ctx.renommer_ = () => true;
  ctx.deplacerEtRenommer_ = () => true;
  ctx.DriveApp = {
    getFileById: () => ({
      getName: () => '2024-01-01_Facture_EDF.pdf',
      getSize: () => 99,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => ({}),
      getParents: () => iter([{ getId: () => 'PARENT' }]),
    }),
  };

  ctx.aParentProtege_ = () => true; // multi-parents accroché à 04 → refus inscrit, jamais muté
  assert.strictEqual(ctx.reanalyserFichier_('F1', {}), false);
  assert.deepStrictEqual(calls.index, [{ cle: 'reanalyse|c26-08|F1', statut: 'zone protégée' }]);
  assert.strictEqual(calls.traites.length, 0);

  ctx.aParentProtege_ = () => false;
  assert.strictEqual(ctx.reanalyserFichier_('F2', {}), true);
  assert.strictEqual(calls.traites.length, 1);
  assert.strictEqual(calls.traites[0].cle, 'reanalyse|c26-08|F2');
  assert.strictEqual(calls.traites[0].ignorerDoublon, true);
});

/* ---------- Fix convergence rangement : 3 granularités de date ---------- */

test('estAReclasserLeger_ : les noms produits par le nommage PAR TYPE sont « déjà rangés » (convergence)', () => {
  const ctx = load(['Config.gs', 'Maintenance.gs']);
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = () => false; // Index vide (P3 testé dans predicates.test.js)
  const casRanges = [
    '2024-03-05_Facture_Hydro-Québec.pdf', // jour (historique)
    '2024-03_Relevé_Desjardins.pdf',       // mois (nouveau)
    '2021_Diplôme_IUT-ULCO.pdf',           // année (nouveau)
  ];
  casRanges.forEach((nom) => {
    assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: nom })), false,
      nom + ' ne doit JAMAIS être re-collecté (sinon boucle infinie de la campagne)');
  });
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'IMG_2734.jpg' })), true);  // vrac
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'CV Marc 2024.pdf' })), true); // vrac
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'x.gdoc', mime: 'application/vnd.google-apps.document' })), false);
});
