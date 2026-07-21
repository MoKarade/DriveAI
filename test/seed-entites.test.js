'use strict';
/**
 * SEED des entités de Marc (C28-26, décision 2026-07-17 « c'est toi qui le fais ») — Entites.gs :
 * les listes RÉELLES (4 logements, 3 véhicules, 2 employeurs, 6 écoles) sont validées d'office,
 * les entités bancaires de 02 sont DÉVALIDÉES (« pas de dossier par banque »), one-shot gaté par
 * tag, jamais de suppression (statuts seulement).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctxPur = load(['Config.gs', 'Entites.gs', 'Router.gs']);

test('SEED_ENTITES : 15 entités (4 logements + 3 véhicules + 2 employeurs + 6 écoles), libellés = POINTS FIXES de canoniserEntite_', () => {
  assert.strictEqual(ctxPur.SEED_ENTITES.length, 15);
  const parDomaine = {};
  const cles = new Set();
  for (const e of ctxPur.SEED_ENTITES) {
    // Le libellé stocké DOIT être sa propre forme canonique — sinon la clé du référentiel et la
    // clé de routage divergeraient (le dossier créé ne serait jamais celui que le routeur cherche).
    assert.strictEqual(ctxPur.canoniserEntite_(e.entite), e.entite,
      'libellé non canonique dans le seed : ' + e.entite);
    const cle = ctxPur.cleCanoniqueEntite_(e.domaine, e.entite);
    assert.ok(cle && !cles.has(cle), 'clé absente ou dupliquée : ' + e.entite);
    cles.add(cle);
    parDomaine[e.domaine] = (parDomaine[e.domaine] || 0) + 1;
  }
  assert.strictEqual(parDomaine['03 · Logement & véhicule'], 7, '4 logements + 3 véhicules');
  assert.strictEqual(parDomaine['05 · Carrière'], 2, 'Automatech + Robovic seulement');
  assert.strictEqual(parDomaine['06 · Études & diplômes'], 6, 'les 6 étapes du parcours');
  assert.strictEqual(parDomaine['02 · Finances'], undefined, 'JAMAIS d\'entité bancaire seedée (pas de dossier par banque)');
});

function ctxSeed(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs']);
  const store = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
  }) };
  const promues = [];
  c.promouvoirEntiteValidee_ = (corr) => {
    if (opts.promouvoirLeve) throw new Error('Sheet indisponible');
    promues.push(corr.domaine + '|' + corr.entite);
    return true;
  };
  const lignes = opts.lignes || [];
  c.entitesCache_ = () => ({ lignes, parCle: {} });
  c.colonnesEntites_ = () => ({ 'Statut': 4 });
  const setValues = [];
  c.feuille_ = () => ({ getRange: (l, col) => ({ setValue: (v) => setValues.push({ ligne: l, col, v }) }) });
  c.journalInfo_ = () => {};
  return { c, store, promues, setValues, lignes };
}

test('seedEntitesMarc_ : promeut les 15 entités, dévalide les entités 02 validées, pose le tag (one-shot)', () => {
  const banque = { ligneSheet: 7, entite: 'Desjardins', domaine: '02 · Finances', statut: 'validee', dossierId: 'X' };
  const employeur = { ligneSheet: 9, entite: 'Robovic', domaine: '05 · Carrière', statut: 'validee', dossierId: 'Y' };
  const { c, store, promues, setValues } = ctxSeed({ lignes: [banque, employeur] });

  c.seedEntitesMarc_();
  assert.strictEqual(promues.length, 15, 'les 15 entités du seed sont promues');
  assert.strictEqual(setValues.length, 1, 'UNE seule dévalidation : la banque 02 (jamais Robovic en 05)');
  assert.strictEqual(setValues[0].ligne, 7);
  assert.ok(/refusée .*banque/.test(setValues[0].v), setValues[0].v);
  assert.ok(/refus/.test(banque.statut), 'cache tenu à jour');
  assert.strictEqual(store.DriveAI_SEED_ENTITES, c.CONFIG.SEED_ENTITES_TAG, 'tag posé après passe complète');

  // Re-run : one-shot — plus AUCUNE écriture.
  c.seedEntitesMarc_();
  assert.strictEqual(promues.length, 15);
  assert.strictEqual(setValues.length, 1);
});

test('seedEntitesMarc_ : une exception AVANT la fin ne pose PAS le tag (re-tenté au tick suivant)', () => {
  const { c, store } = ctxSeed({ promouvoirLeve: true });
  assert.throws(() => c.seedEntitesMarc_(), /Sheet indisponible/);
  assert.strictEqual(store.DriveAI_SEED_ENTITES, undefined, 'tag jamais posé sur passe incomplète');
});
