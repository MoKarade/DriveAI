'use strict';
/**
 * Chantier #10 (ADR-0009 §1) — qualité des propositions d'entités :
 *  - `estEntiteGenerique_` : calibré sur la FILE RÉELLE du 2026-07-02 (génériques refusés,
 *    vrais noms propres TOUJOURS gardés — filtre étroit, haute précision).
 *  - `estFusionnableEntite_` : inclusion de jetons SEULEMENT (jamais la distance d'édition —
 *    « Honda Civic 2014 » ≠ « Honda Civic 2017 »).
 *  - `entiteEnAttenteAjouter_` : générique → aucune ligne ; fusionnable → incrément « Vu N fois » ;
 *    inédit → append avec Vu=1.
 *  - `appliquerCurationEntites_` : one-shot gaté (statuts seulement, tag figé après passe complète).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs']);

/* ---------- estEntiteGenerique_ (calibrage réel) ---------- */

test('estEntiteGenerique_ : les génériques de la file réelle sont refusés', () => {
  const generiques = [
    'banque', 'diplôme', 'véhicule', 'logement', 'cours',
    'Banque/Service en ligne', 'Banque/Institution financière', 'Compte bancaire',
    'carte de crédit', 'Banque ou service de paiement',
    'cours de physique', 'Cours d\'anglais', 'Anglais - Examen écrit', 'Devoir de mathématiques',
    'classe préparatoire', 'Classe préparatoire PTSI', 'établissement scolaire',
    'Diplôme/Certification technique', 'mémoire de fin d\'études', 'Études secondaires ou universitaires',
    'École/Établissement scolaire', 'Épreuves de synthèse — Anglais', 'Préparation aux concours',
    'Physique (classe de première)', 'Algorithmique / Programmation Python',
    'Transport ferroviaire', 'Assurance santé', 'projet académique',
  ];
  for (const g of generiques) {
    assert.strictEqual(ctx.estEntiteGenerique_(g), true, `« ${g} » devrait être générique`);
  }
});

test('estEntiteGenerique_ : les VRAIS noms propres de la file réelle sont TOUS gardés', () => {
  const propres = [
    'Desjardins', 'Robovic Inc.', 'lycée Thérèse d\'Avila', 'Lyonnaise de Banque (CIC)',
    'IUT du Littoral Côte d\'Opale', 'IUT de Lyon', 'CPE Lyon', 'Hydro-Québec', 'XTB',
    'Wealthsimple', 'CFE (Caisse des Français de l\'Étranger)', 'SCI MRic',
    '3325 4e Avenue, Québec G1J 3H3', '3987 Rte des Rivières, Lévis', 'VW Jetta',
    'Ford Fiesta 2011', 'Honda Civic 2014', 'Lycée Gustave Eiffel', 'HAMK International',
    'Automatech Robotik', 'Safran', 'Schneider Electric', 'Airbus', 'Kinova', 'Efrei Paris',
    'banque Desjardins', // « banque » générique + « desjardins » identifiant → GARDÉE
    'carte de crédit Desjardins',
  ];
  for (const p of propres) {
    assert.strictEqual(ctx.estEntiteGenerique_(p), false, `« ${p} » devrait être gardée`);
  }
});

test('estEntiteGenerique_ : vide / null / que des stopwords → générique', () => {
  assert.strictEqual(ctx.estEntiteGenerique_(''), true);
  assert.strictEqual(ctx.estEntiteGenerique_(null), true);
  assert.strictEqual(ctx.estEntiteGenerique_('de la du'), true);
});

/* ---------- estFusionnableEntite_ (inclusion seulement) ---------- */

test('estFusionnableEntite_ : inclusion → fusionnable (adresses, banque, casse/accents)', () => {
  assert.strictEqual(ctx.estFusionnableEntite_('Desjardins', 'carte de crédit Desjardins'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('banque Desjardins', 'Desjardins'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('3325 4e avenue', '3325 4e Avenue, App. 5, Québec'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('Honda Civic', 'Honda Civic 2014'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('ROBOVIC Inc', 'Robovic Inc.'), true);
});

test('estFusionnableEntite_ : JAMAIS par simple proximité — années/villes distinctes', () => {
  assert.strictEqual(ctx.estFusionnableEntite_('Honda Civic 2014', 'Honda Civic 2017'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('IUT de Lyon', 'IUT de Nantes'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('Ford Fiesta 2011', 'Toyota Corolla 2014'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('', 'Desjardins'), false);
});

/* ---------- entiteEnAttenteAjouter_ (effectful, mocks) ---------- */

function ctxProposition(lignesExistantes) {
  const c = load(['Config.gs', 'Entites.gs']);
  const calls = { append: [], setValue: [] };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  c.feuille_ = () => ({
    getLastColumn: () => ENTETES.length,
    getLastRow: () => 1 + (lignesExistantes || []).length,
    getRange: (l, col) => ({
      getValues: () => [ENTETES.slice()],
      getValue: () => 1,
      setValue: (v) => calls.setValue.push({ ligne: l, col, v }),
    }),
    appendRow: (row) => calls.append.push(row),
  });
  const parCle = {};
  (lignesExistantes || []).forEach((l) => { parCle[c.cleEntite_(l.domaine, l.entite)] = l; });
  c._entitesCache = { lignes: (lignesExistantes || []).slice(), parCle };
  return { c, calls };
}

test('entiteEnAttenteAjouter_ : GÉNÉRIQUE → aucune ligne, aucune I/O', () => {
  const { c, calls } = ctxProposition([]);
  c.entiteEnAttenteAjouter_({ entite: 'Banque/Service en ligne', domaine: '02 · Finances' });
  assert.strictEqual(calls.append.length, 0);
  assert.strictEqual(calls.setValue.length, 0);
});

test('entiteEnAttenteAjouter_ : FUSIONNABLE avec une ligne existante → incrément Vu, pas d\'append', () => {
  const existante = { ligneSheet: 2, entite: 'Desjardins', domaine: '02 · Finances', categorie: '', type: '', statut: 'en_attente', dossierId: '' };
  const { c, calls } = ctxProposition([existante]);
  c.entiteEnAttenteAjouter_({ entite: 'banque Desjardins', domaine: '02 · Finances' });
  assert.strictEqual(calls.append.length, 0);
  assert.strictEqual(calls.setValue.length, 1); // Vu N fois incrémenté (1 → 2)
  assert.strictEqual(calls.setValue[0].v, 2);
});

test('entiteEnAttenteAjouter_ : entité INÉDITE → append avec Vu N fois = 1', () => {
  const { c, calls } = ctxProposition([]);
  c.entiteEnAttenteAjouter_({ entite: 'Wealthsimple', domaine: '02 · Finances' });
  assert.strictEqual(calls.append.length, 1);
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Vu N fois')], 1);
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Statut')], 'en_attente');
});

/* ---------- appliquerCurationEntites_ (one-shot gaté) ---------- */

function ctxCuration(lignes, dejaFaite) {
  const c = load(['Config.gs', 'Entites.gs']);
  const calls = { statuts: [], props: {} };
  c.journalInfo_ = () => {};
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  c.feuille_ = () => ({
    getLastColumn: () => ENTETES.length,
    getLastRow: () => 1 + lignes.length,
    getRange: (l, col) => ({
      getValues: () => [ENTETES.slice()],
      getValue: () => 1,
      setValue: (v) => calls.statuts.push({ ligne: l, col, v }),
    }),
    appendRow: () => {},
  });
  c._entitesCache = { lignes: lignes.slice(), parCle: {} };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (dejaFaite && k === 'DriveAI_CURATION_ENTITES' ? c.CONFIG.CURATION_ENTITES_TAG : calls.props[k] ?? null),
      setProperty: (k, v) => { calls.props[k] = v; },
      deleteProperty: () => {},
    }),
  };
  return { c, calls };
}

function ligne(n, entite, domaine, statut) {
  return { ligneSheet: n, entite, domaine, categorie: '', type: '', statut, dossierId: '' };
}

test('appliquerCurationEntites_ : génériques refusés, variantes regroupées (canonique = la plus courte), tag figé', () => {
  const lignes = [
    ligne(2, 'banque', '02 · Finances', 'en_attente'),                       // générique → refusée
    ligne(3, 'Desjardins', '02 · Finances', 'en_attente'),                   // canonique (la plus courte)
    ligne(4, 'carte de crédit Desjardins', '02 · Finances', 'en_attente'),   // variante de Desjardins
    ligne(5, 'IUT de Lyon', '06 · Études & diplômes', 'en_attente'),         // gardée (pas fusionnable avec Nantes)
    ligne(6, 'IUT de Nantes', '06 · Études & diplômes', 'en_attente'),       // gardée
    ligne(7, 'Safran', '05 · Carrière', 'validée'),                          // pas en_attente → intouchée
  ];
  const { c, calls } = ctxCuration(lignes, false);
  c.appliquerCurationEntites_(() => false);

  const statuts = calls.statuts.filter((s) => typeof s.v === 'string');
  assert.deepStrictEqual(
    statuts.map((s) => [s.ligne, s.v]),
    [[2, 'refusée (générique)'], [4, 'variante de : Desjardins']],
  );
  assert.strictEqual(calls.props['DriveAI_CURATION_ENTITES'], c.CONFIG.CURATION_ENTITES_TAG); // passe complète → tag
});

test('appliquerCurationEntites_ : budget épuisé en cours → PAS de tag (reprise au tick suivant)', () => {
  const lignes = [ligne(2, 'banque', '02 · Finances', 'en_attente'), ligne(3, 'cours', '06 · Études & diplômes', 'en_attente')];
  const { c, calls } = ctxCuration(lignes, false);
  let appels = 0;
  c.appliquerCurationEntites_(() => ++appels > 2); // le budget tombe après le 1er traitement
  assert.strictEqual(calls.props['DriveAI_CURATION_ENTITES'], undefined);
});

test('appliquerCurationEntites_ : tag déjà posé → no-op total', () => {
  const { c, calls } = ctxCuration([ligne(2, 'banque', '02 · Finances', 'en_attente')], true);
  c.appliquerCurationEntites_(() => false);
  assert.strictEqual(calls.statuts.length, 0);
});
