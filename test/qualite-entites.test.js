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

test('estEntiteGenerique_ : pluriels couverts (jeton OU jeton sans « s » final)', () => {
  assert.strictEqual(ctx.estEntiteGenerique_('Relevés bancaires'), true);
  assert.strictEqual(ctx.estEntiteGenerique_('factures'), true);
  assert.strictEqual(ctx.estEntiteGenerique_('diplômes'), true);
  assert.strictEqual(ctx.estEntiteGenerique_('Desjardins'), false); // « desjardin » n'est pas du lexique
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
  assert.strictEqual(ctx.estFusionnableEntite_('ROBOVIC Inc', 'Robovic Inc.'), true);
});

test('estFusionnableEntite_ : JAMAIS par simple proximité — années/villes distinctes', () => {
  assert.strictEqual(ctx.estFusionnableEntite_('Honda Civic 2014', 'Honda Civic 2017'), false);
  // Garde anti-effondrement transitif (revue flotte) : une ANNÉE excédentaire = entité distincte.
  assert.strictEqual(ctx.estFusionnableEntite_('Honda Civic', 'Honda Civic 2014'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('Ford Fiesta', 'Ford Fiesta 2011'), false);
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

test('entiteEnAttenteAjouter_ : canonique VALIDÉE → Vu incrémenté, AUCUN alias (pas de fusion de facto)', () => {
  const validee = { ligneSheet: 2, entite: 'Desjardins', domaine: '02 · Finances', categorie: '', type: '', statut: 'validee', dossierId: 'DOSSIER' };
  const { c, calls } = ctxProposition([validee]);
  c.entiteEnAttenteAjouter_({ entite: 'banque Desjardins', domaine: '02 · Finances' });
  assert.strictEqual(calls.append.length, 0);
  assert.strictEqual(calls.setValue.length, 1); // Vu N fois
  // PAS d'alias : la clé de la variante n'entre pas dans parCle → resoudreEntite_ ne routera JAMAIS
  // « banque Desjardins » dans le dossier de « Desjardins » sans fusion explicite de Marc.
  const cleVariante = c.cleEntite_('02 · Finances', 'banque Desjardins');
  assert.strictEqual(c._entitesCache.parCle[cleVariante], undefined);
});

test('appliquerCurationEntites_ : passe 1.5 (P4/C28-10) — les millésimes d\'un MÊME véhicule se regroupent sous la forme canonique', () => {
  // Révision du comportement (plan NotebookLM P4 validé par Marc, 2026-07-08) : la canonicalisation
  // véhicule (C26-02) retire les années/finitions — « Honda Civic 2014 » et « Honda Civic 2017 »
  // SONT le même véhicule que « Honda Civic » (la plainte d'origine : « Ford Fiesta en 3 dossiers »).
  // Le regroupement est par ÉGALITÉ de clé canonique (jamais l'inclusion transitive d'antan) et
  // reste réversible (statuts seulement).
  const lignes = [
    { ligneSheet: 2, entite: 'Honda Civic', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
    { ligneSheet: 3, entite: 'Honda Civic 2014', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
    { ligneSheet: 4, entite: 'Honda Civic 2017', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
  ];
  const { c, calls } = ctxCuration(lignes, false);
  c.appliquerCurationEntites_(() => false);
  const variantes = calls.statuts.filter((s) => typeof s.v === 'string' && s.v.indexOf('variante') === 0);
  assert.strictEqual(variantes.length, 2, '2014 et 2017 rejoignent la forme canonique');
  variantes.forEach((s) => assert.strictEqual(s.v, 'variante de : Honda Civic'));
});

test('appliquerCurationEntites_ : passe 1.5 — une en_attente dont le canonique rejoint une ligne VALIDÉE devient sa variante', () => {
  const lignes = [
    { ligneSheet: 2, entite: 'Ford Fiesta', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'validee', dossierId: 'DOSSIER-FIESTA' },
    { ligneSheet: 3, entite: 'Ford Fiesta SE 2011', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
  ];
  const { c, calls } = ctxCuration(lignes, false);
  c.appliquerCurationEntites_(() => false);
  const variantes = calls.statuts.filter((s) => typeof s.v === 'string' && s.v.indexOf('variante') === 0);
  assert.strictEqual(variantes.length, 1);
  assert.strictEqual(variantes[0].v, 'variante de : Ford Fiesta');
  assert.strictEqual(variantes[0].ligne, 3, 'c\'est la ligne en_attente qui est requalifiée, jamais la validée');
});

test('appliquerCurationEntites_ : deux domaines DIFFÉRENTS ne se regroupent jamais (clé canonique = domaine + nom)', () => {
  const lignes = [
    { ligneSheet: 2, entite: 'Desjardins', domaine: '02 · Finances', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
    { ligneSheet: 3, entite: 'Desjardins', domaine: '03 · Logement & véhicule', categorie: '', type: '', statut: 'en_attente', dossierId: '' },
  ];
  const { c, calls } = ctxCuration(lignes, false);
  c.appliquerCurationEntites_(() => false);
  const variantes = calls.statuts.filter((s) => typeof s.v === 'string' && s.v.indexOf('variante') === 0);
  assert.strictEqual(variantes.length, 0);
});

test('entiteEnAttenteAjouter_ : entité INÉDITE → append avec Vu N fois = 1', () => {
  const { c, calls } = ctxProposition([]);
  c.entiteEnAttenteAjouter_({ entite: 'Wealthsimple', domaine: '02 · Finances' });
  assert.strictEqual(calls.append.length, 1);
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Vu N fois')], 1);
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Statut')], 'en_attente');
});

/* ---------- P4 (C28-10) : canonicalisation à la SOURCE + « reality check » Drive ---------- */

test('entiteEnAttenteAjouter_ : deux formes du MÊME véhicule → UNE seule ligne, sous la forme canonique', () => {
  const { c, calls } = ctxProposition([]);
  c.entiteEnAttenteAjouter_({ entite: 'Ford Fiesta SE 2011', domaine: '03 · Logement & véhicule', categorie: 'Véhicule' });
  c.entiteEnAttenteAjouter_({ entite: 'Ford Fiesta 2011', domaine: '03 · Logement & véhicule', categorie: 'Véhicule' });
  assert.strictEqual(calls.append.length, 1, 'la 2e forme rejoint la clé canonique de la 1re');
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Entité')], 'Ford Fiesta', 'proposée sous sa forme canonique (années/finitions retirées)');
});

test('entiteEnAttenteAjouter_ : un dossier du domaine porte DÉJÀ ce nom → ligne directement VALIDÉE, liée au dossier', () => {
  const { c, calls } = ctxProposition([]);
  c.idDomaine_ = () => 'ID-DOMAINE-03';
  c.DriveApp = {
    getFolderById: (id) => {
      assert.strictEqual(id, 'ID-DOMAINE-03');
      let servi = false;
      return {
        getFolders: () => ({
          hasNext: () => !servi,
          next: () => { servi = true; return { getName: () => '3325 4e Avenue, Québec', getId: () => 'DOSSIER-APPART' }; },
        }),
      };
    },
  };
  // Variante d'adresse (« ave », complément « app 5 ») : canonisée puis matchée au dossier existant.
  c.entiteEnAttenteAjouter_({ entite: '3325 4e ave, app 5, Québec', domaine: '03 · Logement & véhicule', categorie: 'Logement' });
  assert.strictEqual(calls.append.length, 1);
  const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Statut')], 'validée', 'jamais en_attente quand le dossier existe déjà');
  assert.strictEqual(calls.append[0][ENTETES.indexOf('Dossier ID')], 'DOSSIER-APPART');
});

test('dossiersExistantsDomaine_ : 1 listage Drive par domaine et par run (cache), échec → table vide sans planter', () => {
  const { c } = ctxProposition([]);
  let listages = 0;
  c.idDomaine_ = () => 'ID-DOM';
  c.DriveApp = {
    getFolderById: () => { listages++; return { getFolders: () => ({ hasNext: () => false, next: () => null }) }; },
  };
  c.dossiersExistantsDomaine_('02 · Finances');
  c.dossiersExistantsDomaine_('02 · Finances');
  assert.strictEqual(listages, 1, 'le 2e appel sert le cache');
  // Échec Drive (autre domaine) : table vide, cachée elle aussi — jamais une exception qui remonte.
  c.DriveApp = { getFolderById: () => { throw new Error('Drive indisponible'); } };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.dossiersExistantsDomaine_('05 · Carrière'))), {});
});

test('resoudreEntite_ : la requête est canonisée avant le matching — une variante d\'adresse résout vers la ligne validée', () => {
  const validee = { ligneSheet: 2, entite: '3325 4e Avenue, Québec', domaine: '03 · Logement & véhicule', categorie: 'Logement', type: 'Logement', statut: 'validee', dossierId: 'DOSSIER-APPART' };
  const { c } = ctxProposition([validee]);
  const r = c.resoudreEntite_({ entite: '3325 4e ave, app 5, Québec', domaine: '03 · Logement & véhicule' });
  assert.strictEqual(r.etat, 'connue');
  assert.strictEqual(r.dossierId, 'DOSSIER-APPART');
});

test('resoudreEntite_ : canonique NULL (générique, propriétaire) → transverse (document classé au domaine)', () => {
  const { c } = ctxProposition([]);
  assert.strictEqual(c.resoudreEntite_({ entite: 'Banque/Service en ligne', domaine: '02 · Finances' }).etat, 'transverse');
  assert.strictEqual(c.resoudreEntite_({ entite: 'Marc Richard', domaine: '01 · Administratif & identité' }).etat, 'transverse');
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
