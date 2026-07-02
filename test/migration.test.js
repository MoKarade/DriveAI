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
  ctx.indexContient_ = () => false;
  ctx.empreinteBlob_ = () => 'EMPREINTE';
  ctx.estDoublon_ = () => true;                       // le contenu EST déjà connu de l'Index
  ctx.doublonRapide_ = (nom) => ({ dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '' });
  ctx.indexAjouter_ = () => {};
  ctx.estTechnique_ = () => false;
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

/* ---------- Fix convergence rangement : 3 granularités de date ---------- */

test('estAReclasserLeger_ : les noms produits par le nommage PAR TYPE sont « déjà rangés » (convergence)', () => {
  const ctx = load(['Config.gs', 'Maintenance.gs']);
  ctx.journalErreur_ = () => {};
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
