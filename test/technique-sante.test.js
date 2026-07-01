'use strict';
/**
 * Dossiers `07 · Santé` (domaine auto-créé) et `_Technique` (code/CAO hors domaines) — ADR-0002 §3.
 * On teste les décisions pures (extension technique, domaine reconnu, résolution d'ID) + la forme
 * du routage technique (avec DriveApp/Properties mockés).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);

test('estTechnique_ : code/CAO par extension, insensible à la casse', () => {
  assert.strictEqual(ctx.estTechnique_('Main.java'), true);
  assert.strictEqual(ctx.estTechnique_('piece.STEP'), true);
  assert.strictEqual(ctx.estTechnique_('model.STL'), true);
  assert.strictEqual(ctx.estTechnique_('script.py'), true);
});

test('estTechnique_ : un vrai document n\'est JAMAIS technique (pdf/office/image/csv)', () => {
  assert.strictEqual(ctx.estTechnique_('rapport.pdf'), false);
  assert.strictEqual(ctx.estTechnique_('cv.docx'), false);
  assert.strictEqual(ctx.estTechnique_('scan.jpg'), false);
  assert.strictEqual(ctx.estTechnique_('data.csv'), false);
  assert.strictEqual(ctx.estTechnique_('sansext'), false);
  assert.strictEqual(ctx.estTechnique_(''), false);
});

test('domaineConnu_ : 7 fixes + auto (07 · Santé), pas les autres', () => {
  assert.strictEqual(ctx.domaineConnu_('01 · Administratif & identité'), true);
  assert.strictEqual(ctx.domaineConnu_('04 · Immigration'), true);
  assert.strictEqual(ctx.domaineConnu_('07 · Santé'), true);   // auto-créé
  assert.strictEqual(ctx.domaineConnu_('99 · Inexistant'), false);
  assert.strictEqual(ctx.domaineConnu_(''), false);
});

test('idDomaine_ : domaine fixe → ID en dur (sans toucher Drive)', () => {
  assert.strictEqual(ctx.idDomaine_('02 · Finances'), ctx.CONFIG.DOMAINES['02 · Finances']);
});

test('07 · Santé est proposé au LLM (domainesAutorises_)', () => {
  assert.ok(ctx.domainesAutorises_().indexOf('07 · Santé') !== -1);
  assert.strictEqual(ctx.domainesAutorises_().length, Object.keys(ctx.CONFIG.DOMAINES).length + ctx.CONFIG.DOMAINES_AUTO.length);
});

test('NON-RÉGRESSION convergence rangement : les domaines FIXES ont tous un ID, les AUTO n\'y sont PAS', () => {
  // Le grand rangement itère `Object.keys(CONFIG.DOMAINES)` et résout l'ID par `CONFIG.DOMAINES[dom]`.
  // Si un domaine sans ID (auto) s'y glissait, `getFolderById(undefined)` lèverait → faux « non-terminé »
  // (piège P1-17). On verrouille : tout domaine fixe a un ID, aucun domaine AUTO n'est dans la map fixe.
  for (const d of Object.keys(ctx.CONFIG.DOMAINES)) {
    assert.ok(ctx.CONFIG.DOMAINES[d], 'le domaine fixe « ' + d + ' » doit avoir un ID');
  }
  for (const d of ctx.CONFIG.DOMAINES_AUTO) {
    assert.strictEqual(ctx.CONFIG.DOMAINES[d], undefined, 'un domaine AUTO ne doit PAS être dans CONFIG.DOMAINES (sinon collecté sans ID)');
  }
});

test('routageTechnique_ : _Technique, nom daté depuis l\'origine (DriveApp/Properties mockés)', () => {
  // Mocks minimaux pour la création find-or-create de `_Technique`.
  const props = {};
  const overrides = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: {
      getFolderById: () => ({ getParents: () => iter([{ getFoldersByName: () => iter([]), createFolder: () => ({ getId: () => 'tech-id' }) }]) }),
      getRootFolder: () => ({ getFoldersByName: () => iter([]), createFolder: () => ({ getId: () => 'tech-id' }) }),
    },
  };
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs'], overrides);
  const dec = c.routageTechnique_('MonProjet_v2.java', new Date(Date.UTC(2024, 2, 15)), '.java');
  assert.strictEqual(dec.statut, 'technique');
  assert.strictEqual(dec.chemin, '_Technique');
  assert.strictEqual(dec.nom, '2024-03-15_MonProjet-v2.java'); // date + base nettoyée (_ → -) + ext
  assert.strictEqual(dec.dossierId, 'tech-id');
});
