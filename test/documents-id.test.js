'use strict';
/**
 * documents-id.test.js — drainage de la structure héritée `Documents ID` (C28-73, ADR-0048).
 *
 * Ce qui doit être verrouillé ici n'est PAS « ça déplace bien » : c'est que ça passe par le
 * PIPELINE (donc renommage), avec `ignorerDoublon`, en refusant la zone protégée, les dossiers et
 * les raccourcis — et que le garde-temps vive dans la boucle qui fait l'I/O.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { load } = require('./harness');

function ctx() { return load(['Config.gs', 'DocumentsID.gs']); }
/** Normalise une valeur construite DANS le realm vm (prototypes distincts) — patron du harness. */
function plat(x) { return JSON.parse(JSON.stringify(x)); }

/* ---------- fonctions PURES ---------- */

test('dossiersDrainageDocumentsID_ : racine + sous-dossiers, dédupliqués, dans l\'ordre', () => {
  const c = ctx();
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({ racine: 'R', sousDossiers: ['A', 'B', 'A'] })),
    ['R', 'A', 'B']);
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({ sousDossiers: ['A'] })), ['A']);
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({})), [], 'config vide = campagne INERTE');
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_(null)), []);
});

test('estDrainableDocumentsID_ : ni dossier, ni RACCOURCI', () => {
  const c = ctx();
  assert.strictEqual(c.estDrainableDocumentsID_('application/pdf'), true);
  assert.strictEqual(c.estDrainableDocumentsID_('image/jpeg'), true);
  assert.strictEqual(c.estDrainableDocumentsID_('application/vnd.google-apps.folder'), false);
  // Un raccourci pointe un fichier qui vit AILLEURS : le « déplacer » ne bougerait que le pointeur,
  // et le pipeline le renommerait comme s'il l'avait classé.
  assert.strictEqual(c.estDrainableDocumentsID_('application/vnd.google-apps.shortcut'), false);
});

test('cleDrainageDocumentsID_ : namespace DÉDIÉ (jamais `drive|`, déjà celui des dépôts classés)', () => {
  const c = ctx();
  assert.strictEqual(c.cleDrainageDocumentsID_('d1', 'F1'), 'drainid|d1|F1');
  assert.ok(c.cleDrainageDocumentsID_('d1', 'F1').indexOf('drive|') !== 0);
});

test('CONFIG.DOCUMENTS_ID : périmètre par IDENTITÉ, jamais par nom', () => {
  const c = ctx();
  const ids = c.dossiersDrainageDocumentsID_(c.CONFIG.DOCUMENTS_ID);
  assert.ok(ids.length >= 6, 'racine + 5 sous-dossiers déclarés');
  ids.forEach((id) => assert.ok(/^[A-Za-z0-9_-]{20,}$/.test(id), 'ID Drive attendu, reçu : ' + id));
});

/* ---------- orchestration ---------- */

function ctxDrain(opts) {
  opts = opts || {};
  const traites = [];
  const index = Object.assign({}, opts.index);
  let horloge = 0;
  const fichier = (id, mime, nom) => ({
    getId: () => id, getMimeType: () => mime, getName: () => nom || (id + '.pdf'),
    getSize: () => 1000, getDateCreated: () => new Date(0), getBlob: () => ({ id }),
    getParents: () => ({ hasNext: () => false }),
  });
  const parDossier = opts.parDossier || {};
  // `Config.gs` n'est PAS chargé ici : sa déclaration `var CONFIG = {…}` ÉCRASERAIT l'injection
  // (patron déjà établi par historique-vrac.test.js pour `feuille_`). On injecte donc la config
  // minimale dont le module a besoin.
  const c = load(['DocumentsID.gs'], {
    CONFIG: {
      DOCUMENTS_ID: opts.cfg !== undefined ? opts.cfg : { tag: 'd1', racine: 'R', sousDossiers: [] },
      BUDGET_MS: opts.budgetMs === undefined ? 1e9 : opts.budgetMs,
    },
    Date: { now: () => (horloge += (opts.pasMs || 0)) },
    DriveApp: {
      getFolderById: (id) => {
        if (opts.dossierIllisible === id) throw new Error('boum');
        const fs2 = (parDossier[id] || []).slice();
        let i = 0;
        return { getFiles: () => ({ hasNext: () => i < fs2.length, next: () => fs2[i++] }) };
      },
    },
    indexContient_: (cle) => index[cle] === true,
    ensembleDomainesProteges_: () => ({}),
    aParentProtege_: (f) => (opts.proteges || []).indexOf(f.getId()) !== -1,
    traiterDocument_: (src) => { traites.push({ cle: src.cle, nom: src.nom, ignorerDoublon: src.ignorerDoublon }); },
    renommer_: () => true,
    deplacerEtRenommer_: () => true,
    journalInfo_: () => {},
    journalErreur_: () => {},
  });
  return { c, traites, fichier, parDossier };
}

test('drainerDocumentsID : passe par le PIPELINE avec ignorerDoublon — jamais un simple déplacement', () => {
  const h = ctxDrain({});
  h.parDossier.R = [h.fichier('F1', 'application/pdf', 'Passeport_Marc_RICHARD.pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 1);
  assert.strictEqual(h.traites[0].cle, 'drainid|d1|F1');
  // Sans ce flag, les 2 fichiers dont le jumeau dort dans `_Doublons` repartiraient dans `_Doublons`
  // (« doublon d'eux-mêmes ») — le défaut qu'ADR-0047 mesure sur 1 076 fichiers.
  assert.strictEqual(h.traites[0].ignorerDoublon, true);
  assert.ok(/1 document\(s\) drainé/.test(bilan), bilan);
});

test('drainerDocumentsID : dossiers, raccourcis, déjà-faits et zone PROTÉGÉE sont écartés, chacun compté', () => {
  const h = ctxDrain({ index: { 'drainid|d1|DEJA': true }, proteges: ['PROT'] });
  h.parDossier.R = [
    h.fichier('F1', 'application/pdf'),
    h.fichier('SOUS', 'application/vnd.google-apps.folder'),
    h.fichier('RACC', 'application/vnd.google-apps.shortcut'),
    h.fichier('DEJA', 'application/pdf'),
    h.fichier('PROT', 'application/pdf'),
  ];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1'], 'seul F1 est traité');
  assert.ok(/1 document\(s\) drainé/.test(bilan), bilan);
  assert.ok(/1 déjà fait/.test(bilan), bilan);
  assert.ok(/1 protégé/.test(bilan), bilan);
  assert.ok(/2 ignoré/.test(bilan), bilan);
});

test('drainerDocumentsID : config VIDE → campagne inerte, aucun appel au pipeline', () => {
  const h = ctxDrain({ cfg: {} });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0);
  assert.ok(/AUCUN dossier source/.test(bilan), bilan);
});

test('drainerDocumentsID : le garde-temps coupe DANS la boucle, et le bilan le DIT', () => {
  // Chaque lecture d'horloge avance de 100 ms pour un budget de 150 ms : le 2e fichier est coupé.
  const h = ctxDrain({ budgetMs: 150, pasMs: 100 });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf'),
    h.fichier('F3', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.ok(h.traites.length < 3, 'la boucle a bien été coupée (' + h.traites.length + ' traités)');
  assert.ok(/INTERROMPU/.test(bilan), 'une interruption qui ne se dit pas se lit comme une fin : ' + bilan);
  assert.ok(/reprend/.test(bilan), 'et elle dit comment reprendre');
});

test('drainerDocumentsID : un dossier ILLISIBLE ne fait pas tomber les autres', () => {
  const h = ctxDrain({ cfg: { tag: 'd1', racine: 'R', sousDossiers: ['KO', 'B'] }, dossierIllisible: 'KO' });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  h.parDossier.B = [h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1', 'drainid|d1|F2'],
    'un poison ne doit pas affamer les sources suivantes');
  assert.ok(/1 échec/.test(bilan), bilan);
});

/* ---------- TRIPWIRE §2 ---------- */

test('TRIPWIRE §2 : DocumentsID.gs ne SUPPRIME rien (déplacement et renommage seuls)', () => {
  const brut = fs.readFileSync(require.resolve('../src/DocumentsID.gs'), 'utf8');
  const src = brut.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  [/setTrashed\s*\(/, /trashed"?\s*:\s*true/i, /removeFile\s*\(/, /method:\s*['"]delete['"]/i,
    /emptyTrash/, /createFolder\s*\(/, /makeCopy\s*\(/, /setSharing\s*\(/].forEach((re) => {
    assert.ok(!re.test(src), 'opération interdite dans DocumentsID.gs : ' + re);
  });
});
