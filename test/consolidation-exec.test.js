'use strict';
/**
 * EXÉCUTION du plan de consolidation (C28-26, ADR-0024 — ConsolidationExec.gs) : cible parsée et
 * VALIDÉE (jamais un chemin arbitraire), seules les lignes Déplacer/Doublon s'appliquent, §1
 * re-vérifiée par mutation, multi-parents jamais déplacé, curseur append-only, moveTo = seule
 * mutation du module (verrou de surface).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'ConsolidationExec.gs']);
const DOMAINES = ['01 · Administratif & identité', '02 · Finances', '03 · Logement & véhicule'];

/* ---------- decouperCiblePlan_ : validation stricte de la cible ---------- */

test('decouperCiblePlan_ : domaine seul, domaine/segment, _Doublons — et REJET de tout chemin arbitraire', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.decouperCiblePlan_('02 · Finances', DOMAINES))),
    { doublons: false, domaine: '02 · Finances', segments: [] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.decouperCiblePlan_('02 · Finances/2026', DOMAINES))),
    { doublons: false, domaine: '02 · Finances', segments: ['2026'] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.decouperCiblePlan_('03 · Logement & véhicule/3325 4e Avenue', DOMAINES))),
    { doublons: false, domaine: '03 · Logement & véhicule', segments: ['3325 4e Avenue'] });
  assert.strictEqual(ctx.decouperCiblePlan_('_Doublons', DOMAINES).doublons, true);
  // Rejets : domaine inconnu, segment système/vide/remontée, profondeur > 2, cible vide
  assert.strictEqual(ctx.decouperCiblePlan_('99 · Bidon/2026', DOMAINES), null);
  assert.strictEqual(ctx.decouperCiblePlan_('02 · Finances/_Doublons', DOMAINES), null);
  assert.strictEqual(ctx.decouperCiblePlan_('02 · Finances/..', DOMAINES), null);
  assert.strictEqual(ctx.decouperCiblePlan_('02 · Finances//x', DOMAINES), null);
  assert.strictEqual(ctx.decouperCiblePlan_('02 · Finances/a/b/c', DOMAINES), null);
  assert.strictEqual(ctx.decouperCiblePlan_('', DOMAINES), null);
});

test('ligneAAppliquer_ : Déplacer/Doublon seulement — OK et Ignoré ne se touchent JAMAIS', () => {
  assert.strictEqual(ctx.ligneAAppliquer_('Déplacer'), true);
  assert.strictEqual(ctx.ligneAAppliquer_('Doublon'), true);
  assert.strictEqual(ctx.ligneAAppliquer_('OK'), false);
  assert.strictEqual(ctx.ligneAAppliquer_('Ignoré'), false);
  assert.strictEqual(ctx.ligneAAppliquer_(''), false);
});

test('budgetJourConsoExec_ : ms réelles du jour seulement (rollover → 0)', () => {
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(ctx.budgetJourConsoExec_(props({ DriveAI_CONSO_EXEC_JOUR: '2026/07/21|300000' }), '2026/07/21'), 300000);
  assert.strictEqual(ctx.budgetJourConsoExec_(props({ DriveAI_CONSO_EXEC_JOUR: '2026/07/20|300000' }), '2026/07/21'), 0);
  assert.strictEqual(ctx.budgetJourConsoExec_(props({}), '2026/07/21'), 0);
});

/* ---------- appliquerLigneConsolidation_ : gardes par mutation (mocks) ---------- */

function ctxLigne(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'ConsolidationExec.gs']);
  const index = {};
  const ajouts = [];
  const moves = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec) => { index[cle] = true; ajouts.push({ cle, statut: dec.statut }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.dossierDoublons_ = () => ({ getId: () => 'DOUBLONS' });
  c.idDomaine_ = () => 'DOM';
  c.sousDossier_ = (parent, nom) => ({ getId: () => parent.getId() + '/' + nom });
  const fichier = {
    // next() avance l'index LUI-MÊME (comme DriveApp) — un incrément caché dans getId() fausserait
    // le compteur de parents (vécu : hasNext éternel → faux « multi-parents »).
    getParents: () => {
      let i = 0; const p = opts.parents || ['AUTRE'];
      return { hasNext: () => i < p.length, next: () => { const id = p[i++]; return { getId: () => id }; } };
    },
    moveTo: (dossier) => moves.push(dossier.getId()),
  };
  c.DriveApp = { getFolderById: (id) => ({ getId: () => id }), getFileById: () => { if (opts.absent) throw new Error('absent'); return fichier; } };
  return { c, ajouts, moves };
}

const CTX_EXEC = { proteges: {}, domainesConnus: DOMAINES, tag: 'conso-1' };

test('appliquerLigneConsolidation_ : Déplacer → moveTo vers la cible résolue, clé posée APRÈS', () => {
  const { c, moves, ajouts } = ctxLigne({ parents: ['AILLEURS'] });
  const r = c.appliquerLigneConsolidation_({ fileId: 'F1', nom: 'f.pdf', action: 'Déplacer', cible: '02 · Finances/2026' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(moves, ['DOM/2026']);
  assert.strictEqual(ajouts[0].statut, 'consolidé');
});

test('appliquerLigneConsolidation_ : §1 au vif → JAMAIS de moveTo (abstention tracée)', () => {
  const { c, moves, ajouts } = ctxLigne({ protege: true });
  const r = c.appliquerLigneConsolidation_({ fileId: 'F2', nom: 'p.pdf', action: 'Déplacer', cible: '02 · Finances' }, CTX_EXEC);
  assert.strictEqual(r, 'saute');
  assert.deepStrictEqual(moves, [], 'zone protégée : zéro mutation');
  assert.strictEqual(ajouts[0].statut, 'consolidé-protégé');
});

test('appliquerLigneConsolidation_ : MULTI-PARENTS → jamais déplacé (moveTo retirerait tous les parents)', () => {
  const { c, moves } = ctxLigne({ parents: ['P1', 'P2'] });
  const r = c.appliquerLigneConsolidation_({ fileId: 'F3', nom: 'm.pdf', action: 'Déplacer', cible: '02 · Finances' }, CTX_EXEC);
  assert.strictEqual(r, 'saute');
  assert.deepStrictEqual(moves, []);
});

test('appliquerLigneConsolidation_ : déjà dans la cible → no-op (rejeu sûr) ; cible invalide → refus tracé sans mutation', () => {
  const dansCible = ctxLigne({ parents: ['DOM/2026'] });
  const r1 = dansCible.c.appliquerLigneConsolidation_({ fileId: 'F4', nom: 'ok.pdf', action: 'Déplacer', cible: '02 · Finances/2026' }, CTX_EXEC);
  assert.strictEqual(r1, 'fait');
  assert.deepStrictEqual(dansCible.moves, [], 'déjà en place : aucun moveTo');

  const invalide = ctxLigne({});
  const r2 = invalide.c.appliquerLigneConsolidation_({ fileId: 'F5', nom: 'x.pdf', action: 'Déplacer', cible: 'Chemin/Arbitraire' }, CTX_EXEC);
  assert.strictEqual(r2, 'saute');
  assert.deepStrictEqual(invalide.moves, []);
  assert.strictEqual(invalide.ajouts[0].statut, 'consolidé-refus');
});

test('appliquerLigneConsolidation_ : Doublon → moveTo vers _Doublons (déplacement seul, §2)', () => {
  const { c, moves, ajouts } = ctxLigne({ parents: ['AILLEURS'] });
  const r = c.appliquerLigneConsolidation_({ fileId: 'F6', nom: 'd.pdf', action: 'Doublon', cible: '_Doublons' }, CTX_EXEC);
  assert.strictEqual(r, 'fait');
  assert.deepStrictEqual(moves, ['DOUBLONS']);
  assert.strictEqual(ajouts[0].statut, 'consolidé-doublon');
});

/* ---------- Verrou de surface : moveTo est la SEULE mutation du module ---------- */

test('ConsolidationExec.gs : aucune mutation hors moveTo (jamais de suppression/renommage/copie/REST)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'ConsolidationExec.gs'), 'utf8');
  ['setTrashed(', 'setName(', '.createFile(', 'removeFile(', 'addFile(', 'addFolder(', 'removeFolder(',
    'makeCopy(', 'setContent(', 'UrlFetchApp', 'files.delete', "'delete'"]
    .forEach((motif) => {
      assert.ok(!src.includes(motif), 'mutation interdite dans ConsolidationExec.gs : ' + motif);
    });
  assert.ok(src.includes('moveTo('), 'le déplacement est bien le mécanisme du module');
});
