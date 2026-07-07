'use strict';
/**
 * Chantier #26, C26-07 (ADR-0015) — dry-run v2 : PREUVE avant/après sur échantillon réel, ZÉRO
 * mutation Drive (DryRunV2.gs).
 *  - `stratifierEchantillonDryRunV2_` : round-robin par domaine, plafonné, déterministe.
 *  - `ligneDryRunV2_` : formatage de la ligne (classé / non-document / à vérifier / échec).
 *  - `domainesAEchantillonner_` : domaines fixes + AUTO déjà nés (jamais créés ici).
 *  - `collecterCandidatsDomaine_` : walk récursif borné, natifs Google écartés, illisible sauté.
 *  - `traiterUnDryRunV2_`/`appliquerDryRunV2_` : idempotence (clé `dryrunv2|<tag>|fileId`),
 *    convergence, borne par tick — et surtout le VERROU zéro-mutation (tripwire statique).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, iter, fakeFile } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

/* ---------- stratifierEchantillonDryRunV2_ (PURE) ---------- */

function ctxStrat() {
  return load(['Config.gs', 'DryRunV2.gs']);
}

test('stratifierEchantillonDryRunV2_ : round-robin — un domaine énorme ne monopolise pas l\'échantillon', () => {
  const ctx = ctxStrat();
  const candidats = {
    A: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'],
    B: ['b1', 'b2'],
  };
  const r = ctx.stratifierEchantillonDryRunV2_(candidats, 15, 6);
  assert.strictEqual(r.length, 6);
  // B (petit domaine) est représenté malgré A bien plus fourni — jamais 6×A avant le moindre B.
  assert.ok(r.some((x) => x.domaine === 'B'), 'B doit apparaître (round-robin, pas ordre alphabétique brut)');
  assert.deepStrictEqual(plat(r.slice(0, 2).map((x) => x.domaine)).sort(), ['A', 'B']); // 1er tour = 1 de chaque
});

test('stratifierEchantillonDryRunV2_ : plafond PAR DOMAINE respecté même si le total le permettrait', () => {
  const ctx = ctxStrat();
  const candidats = { A: ['a1', 'a2', 'a3', 'a4', 'a5'], B: ['b1'] };
  const r = ctx.stratifierEchantillonDryRunV2_(candidats, 2, 10); // max 2/domaine, cible 10
  assert.strictEqual(r.filter((x) => x.domaine === 'A').length, 2); // plafonné malgré 5 dispo
  assert.strictEqual(r.filter((x) => x.domaine === 'B').length, 1); // B épuisé, pas plus
  assert.strictEqual(r.length, 3); // jamais bloqué en attendant un domaine tari
});

test('stratifierEchantillonDryRunV2_ : domaine vide/absent → ignoré sans planter', () => {
  const ctx = ctxStrat();
  const r = ctx.stratifierEchantillonDryRunV2_({ A: [], B: ['b1'] }, 5, 10);
  assert.deepStrictEqual(plat(r), [{ domaine: 'B', id: 'b1' }]);
});

test('stratifierEchantillonDryRunV2_ : déterministe — 2 appels identiques → même résultat (reproductibilité)', () => {
  const ctx = ctxStrat();
  const candidats = { A: ['a1', 'a2', 'a3'], B: ['b1', 'b2'], C: ['c1'] };
  const r1 = ctx.stratifierEchantillonDryRunV2_(candidats, 5, 4);
  const r2 = ctx.stratifierEchantillonDryRunV2_(candidats, 5, 4);
  assert.deepStrictEqual(r1, r2);
});

/* ---------- ligneDryRunV2_ (PURE) ---------- */

function ctxLigne() {
  return load(['Config.gs', 'Entites.gs', 'Router.gs', 'DryRunV2.gs']);
}

test('ligneDryRunV2_ : document CLASSÉ → domaine/sous-dossier/nom proposés remplis, fail-safe = non', () => {
  const ctx = ctxLigne();
  const classif = { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Québec', confiance: 0.95 };
  const meta = { nomFichier: 'facture.pdf', taille: 1000, extraitOcr: 'texte du document '.repeat(5), emetteur: 'Hydro-Québec' };
  const plan = ctx.planRoutageV2_(classif, meta, '2026-03-01', '.pdf');
  const ligne = ctx.ligneDryRunV2_(
    { id: 'F1', nom: 'ancien-nom.pdf', domaineActuel: '01 · Administratif & identité', cheminActuel: '01 · Administratif & identité/vrac' },
    classif, plan, 0.035
  );
  assert.strictEqual(ligne[1], 'F1');
  assert.strictEqual(ligne[3], '01 · Administratif & identité'); // domaine actuel
  assert.strictEqual(ligne[5], 'classé');                        // type v2
  assert.strictEqual(ligne[6], '02 · Finances');                  // domaine proposé
  assert.strictEqual(ligne[8], plan.nom);                         // nom proposé
  assert.strictEqual(ligne[9], 'non');                            // fail-safe
  assert.strictEqual(ligne[10], 0.95);                            // confiance
  assert.strictEqual(ligne[11], 0.035);                           // coût
});

test('ligneDryRunV2_ : NON-DOCUMENT → jamais de domaine proposé, type annote le bucket', () => {
  const ctx = ctxLigne();
  const classif = { estNonDocument: true, routageHorsDomaine: '_Technique', domaine: '08 · Perso & projets' };
  const meta = { nomFichier: 'export.html', taille: 500000, extraitOcr: '', emetteur: '' };
  const plan = ctx.planRoutageV2_(classif, meta, '2026-07-01', '.html');
  const ligne = ctx.ligneDryRunV2_({ id: 'F2', nom: 'export.html', domaineActuel: '08 · Perso & projets', cheminActuel: '' }, classif, plan, 0.02);
  assert.strictEqual(ligne[5], 'non-document (_Technique)');
  assert.strictEqual(ligne[6], ''); // jamais un domaine pour un non-document
  assert.strictEqual(ligne[9], 'non');
});

test('ligneDryRunV2_ : FAIL-SAFE (tout-null) → « à vérifier », fail-safe = oui', () => {
  const ctx = ctxLigne();
  const classif = { domaine: null, emetteur: null, type_doc: null, entite: null, descripteur: null };
  const meta = { nomFichier: 'mystere.pdf', taille: 1000, extraitOcr: '', emetteur: '' };
  const plan = ctx.planRoutageV2_(classif, meta, '2026-07-01', '.pdf');
  const ligne = ctx.ligneDryRunV2_({ id: 'F3', nom: 'mystere.pdf', domaineActuel: '01 · Administratif & identité', cheminActuel: '' }, classif, plan, 0.03);
  assert.strictEqual(ligne[5], 'à vérifier');
  assert.strictEqual(ligne[9], 'oui');
  assert.strictEqual(ligne[6], ''); // pas de domaine proposé quand à vérifier
});

test('ligneDryRunV2_ : ÉCHEC de classification (LLM muet) → compté, jamais un plantage', () => {
  const ctx = ctxLigne();
  const ligne = ctx.ligneDryRunV2_({ id: 'F4', nom: 'panne.pdf', domaineActuel: '02 · Finances', cheminActuel: '' }, null, null, 0);
  assert.strictEqual(ligne[5], 'échec classification');
  assert.strictEqual(ligne[6], '');
  assert.strictEqual(ligne[10], ''); // confiance vide, jamais 0 trompeur
});

/* ---------- domainesAEchantillonner_ : fixes + AUTO (jamais créés) ---------- */

test('domainesAEchantillonner_ : les 7 domaines fixes + AUTO seulement s\'ils existent déjà (aucune création)', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_DOM_07 · Santé' ? 'ID_SANTE' : null),
      }),
    },
  });
  const r = ctx.domainesAEchantillonner_();
  const noms = r.map((x) => x.domaine);
  assert.strictEqual(noms.filter((d) => d === '04 · Immigration').length, 1,
    'la zone protégée EST échantillonnée (le dry-run ne mute jamais, donc peut lire 04)');
  assert.ok(noms.includes('07 · Santé'), 'domaine AUTO déjà né → inclus');
  assert.ok(!noms.includes('09 · Voyages'), 'domaine AUTO jamais né → sauté, PAS créé');
  assert.strictEqual(r.length, Object.keys(ctx.CONFIG.DOMAINES).length + 1); // 7 fixes + Santé seul
});

/* ---------- collecterCandidatsDomaine_ : walk récursif borné ---------- */

function fauxDossier(fichiers, sousDossiers) {
  return { getFiles: () => iter(fichiers || []), getFolders: () => iter(sousDossiers || []) };
}

test('collecterCandidatsDomaine_ : récursif, natifs Google écartés, fichier illisible sauté', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const cassé = { getMimeType: () => { throw new Error('illisible'); } };
  const sous = fauxDossier([fakeFile({ id: 'S1', mime: 'application/pdf' })]);
  const racine = fauxDossier(
    [fakeFile({ id: 'R1', mime: 'application/pdf' }), cassé, fakeFile({ id: 'NATIF', mime: 'application/vnd.google-apps.document' })],
    [sous]
  );
  const ids = [];
  ctx.collecterCandidatsDomaine_(racine, ids, 10, () => false);
  assert.deepStrictEqual(ids, ['R1', 'S1']); // natif écarté, cassé sauté, récursion OK
});

test('collecterCandidatsDomaine_ : budget épuisé → arrêt immédiat', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const racine = fauxDossier([fakeFile({ id: 'R1', mime: 'application/pdf' })]);
  const ids = [];
  ctx.collecterCandidatsDomaine_(racine, ids, 10, () => true);
  assert.strictEqual(ids.length, 0);
});

/* ---------- collecterCandidatsDryRunV2_ : orchestration multi-domaines, complétude ---------- */

function ctxCollecte(dossiersParId) {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.journalErreur_ = () => {};
  ctx.domainesAEchantillonner_ = () => Object.keys(dossiersParId).map((id) => ({ domaine: id, dossierId: id }));
  ctx.DriveApp = { getFolderById: (id) => dossiersParId[id] };
  return ctx;
}

test('collecterCandidatsDryRunV2_ : tous les domaines collectés, budget jamais atteint → complet', () => {
  const ctx = ctxCollecte({
    A: fauxDossier([fakeFile({ id: 'a1', mime: 'application/pdf' })]),
    B: fauxDossier([fakeFile({ id: 'b1', mime: 'application/pdf' })]),
  });
  const r = ctx.collecterCandidatsDryRunV2_(() => false);
  assert.strictEqual(r.complet, true);
  assert.deepStrictEqual(plat(r.candidats), { A: ['a1'], B: ['b1'] });
});

test('collecterCandidatsDryRunV2_ : budget dépassé AVANT un domaine → incomplet (jamais persisté)', () => {
  const ctx = ctxCollecte({ A: fauxDossier([]), B: fauxDossier([]) });
  let appels = 0;
  const r = ctx.collecterCandidatsDryRunV2_(() => { appels++; return appels > 1; }); // dépassé au 2e domaine
  assert.strictEqual(r.complet, false);
});

test('collecterCandidatsDryRunV2_ : budget dépassé PENDANT la collecte du DERNIER domaine → incomplet (fix code-reviewer #26)', () => {
  // Le budget ne bascule PAS en tête de boucle (le test entre dans le dernier domaine), mais
  // `estBudgetDepasse` devient vrai APRÈS la collecte de ce domaine — sans le fix, `complet`
  // resterait `true` malgré une collecte potentiellement partielle sur ce domaine.
  const ctx = ctxCollecte({ A: fauxDossier([fakeFile({ id: 'a1', mime: 'application/pdf' })]) });
  let appels = 0;
  const r = ctx.collecterCandidatsDryRunV2_(() => { appels++; return appels > 1; }); // faux au 1er (entrée), vrai ensuite
  assert.strictEqual(r.complet, false, 'une bascule du budget APRÈS le dernier domaine doit être détectée');
});

test('collecterCandidatsDryRunV2_ : domaine INACCESSIBLE (dossier introuvable) → sauté (journalisé), les autres continuent, reste complet', () => {
  // Distinct du cas « fichier illisible dans un dossier accessible » (déjà couvert par
  // `collecterCandidatsDomaine_`, qui l'avale silencieusement) : ici c'est le DOMAINE entier
  // (`getFolderById`) qui échoue — le seul cas que le try/catch de `collecterCandidatsDryRunV2_` couvre.
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.domainesAEchantillonner_ = () => [{ domaine: 'A', dossierId: 'IDA' }, { domaine: 'B', dossierId: 'IDB' }];
  ctx.DriveApp = {
    getFolderById: (id) => {
      if (id === 'IDA') throw new Error('dossier supprimé');
      return fauxDossier([fakeFile({ id: 'b1', mime: 'application/pdf' })]);
    },
  };
  const journaux = [];
  ctx.journalErreur_ = (s, m) => journaux.push(m);
  const r = ctx.collecterCandidatsDryRunV2_(() => false);
  assert.strictEqual(r.complet, true);
  assert.deepStrictEqual(plat(r.candidats.B), ['b1']);
  assert.strictEqual(journaux.length, 1);
});

/* ---------- encoderEchantillonDryRunV2_ / decoderEchantillonDryRunV2_ : compact + round-trip ---------- */

test('encoderEchantillonDryRunV2_ / decoderEchantillonDryRunV2_ : round-trip fidèle', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const echantillon = [
    { domaine: 'A', id: 'x1' }, { domaine: 'A', id: 'x2' }, { domaine: 'B', id: 'y1' },
  ];
  const encode = ctx.encoderEchantillonDryRunV2_(echantillon);
  assert.deepStrictEqual(plat(encode.domaines), ['A', 'B']); // table courte, sans répétition
  const decode = ctx.decoderEchantillonDryRunV2_(encode);
  assert.deepStrictEqual(plat(decode), echantillon);
});

test('encoderEchantillonDryRunV2_ : reste sous la limite Property (~9 Ko) même au plafond DRYRUN_V2_TAILLE=150', () => {
  // Preuve mesurée (revue code-reviewer #26) : l'encodage NAÏF (domaine en clair par item) dépasse
  // ~12,5 Ko à 150 documents. Dérivé de CONFIG (jamais un nombre en dur, cf. leçon « seuil dans la clé »).
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const domaines = Object.keys(ctx.CONFIG.DOMAINES).concat(ctx.CONFIG.DOMAINES_AUTO);
  const gros = Array.from({ length: 150 }, (_, i) => ({
    domaine: domaines[i % domaines.length],
    id: '1' + 'a'.repeat(32), // longueur d'ID Drive réaliste (33 car.)
  }));
  const taille = JSON.stringify(ctx.encoderEchantillonDryRunV2_(gros)).length;
  assert.ok(taille < 8500, `encodage = ${taille} car., doit rester sous la marge de sécurité (limite Property ~9 Ko)`);
});

/* ---------- chargerOuGenererEchantillonDryRunV2_ : persistance, régénération, corruption ---------- */

test('chargerOuGenererEchantillonDryRunV2_ : génère + persiste (encodé) au 1er appel, relit ensuite', () => {
  const store = {};
  const ctx = load(['Config.gs', 'DryRunV2.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }) },
  });
  ctx.journalInfo_ = () => {};
  ctx.collecterCandidatsDryRunV2_ = () => ({ candidats: { A: ['a1', 'a2'] }, complet: true });
  const r1 = ctx.chargerOuGenererEchantillonDryRunV2_(() => false);
  assert.deepStrictEqual(plat(r1), [{ domaine: 'A', id: 'a1' }, { domaine: 'A', id: 'a2' }]);
  const cle = 'DriveAI_DRYRUNV2_ECHANTILLON_' + ctx.CONFIG.DRYRUN_V2_TAG;
  assert.ok(store[cle], 'persisté en Property');
  assert.ok(!store[cle].includes('"domaine":"A"'), 'forme COMPACTE (jamais le nom de domaine en clair par item)');

  ctx.collecterCandidatsDryRunV2_ = () => { throw new Error('ne doit PAS être re-collecté'); };
  const r2 = ctx.chargerOuGenererEchantillonDryRunV2_(() => false);
  assert.deepStrictEqual(plat(r2), plat(r1));
});

test('chargerOuGenererEchantillonDryRunV2_ : collecte incomplète → null, RIEN persisté (reprise au tick suivant)', () => {
  const store = {};
  const ctx = load(['Config.gs', 'DryRunV2.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }) },
  });
  ctx.collecterCandidatsDryRunV2_ = () => ({ candidats: { A: ['a1'] }, complet: false });
  const r = ctx.chargerOuGenererEchantillonDryRunV2_(() => true);
  assert.strictEqual(r, null);
  assert.strictEqual(Object.keys(store).length, 0, 'jamais un échantillon partiel persisté');
});

test('chargerOuGenererEchantillonDryRunV2_ : Property corrompue → régénère proprement (jamais un plantage)', () => {
  const store = { DriveAI_DRYRUNV2_ECHANTILLON_d1: '{pas du json valide' };
  const ctx = load(['Config.gs', 'DryRunV2.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }) },
  });
  ctx.journalInfo_ = () => {};
  ctx.collecterCandidatsDryRunV2_ = () => ({ candidats: { A: ['a1'] }, complet: true });
  const r = ctx.chargerOuGenererEchantillonDryRunV2_(() => false);
  assert.deepStrictEqual(plat(r), [{ domaine: 'A', id: 'a1' }]);
});

/* ---------- cheminActuelDryRunV2_ : profondeur multi-niveaux, bornée, dégradation ---------- */

function fauxFichierParents(chaineNoms) {
  // Construit un file → parent → parent → … depuis une liste de noms (ordre feuille→racine).
  let courant = null;
  for (let i = chaineNoms.length - 1; i >= 0; i--) {
    const nom = chaineNoms[i];
    const suivant = courant;
    courant = { getName: () => nom, getParents: () => iter(suivant ? [suivant] : []) };
  }
  return { getParents: () => iter(courant ? [courant] : []) };
}

test('cheminActuelDryRunV2_ : multi-niveaux (entité + sous-dossier), s\'arrête AU domaine (exclu)', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const f = fauxFichierParents(['Entretien & réparations', 'Véhicule — Honda Civic', 'Véhicule', '03 · Logement & véhicule']);
  const r = ctx.cheminActuelDryRunV2_(f, '03 · Logement & véhicule');
  assert.strictEqual(r, '03 · Logement & véhicule/Véhicule/Véhicule — Honda Civic/Entretien & réparations');
});

test('cheminActuelDryRunV2_ : à la racine du domaine (aucun sous-dossier) → domaine seul', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const f = fauxFichierParents(['02 · Finances']);
  assert.strictEqual(ctx.cheminActuelDryRunV2_(f, '02 · Finances'), '02 · Finances');
});

test('cheminActuelDryRunV2_ : borné à 5 niveaux (anti-boucle), jamais un plantage sur une chaîne trop profonde', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const chaine = Array.from({ length: 10 }, (_, i) => 'niveau' + i); // jamais « 08 · Perso & projets »
  const f = fauxFichierParents(chaine.concat(['08 · Perso & projets']));
  const r = ctx.cheminActuelDryRunV2_(f, '08 · Perso & projets');
  assert.strictEqual(r.split('/').length - 1, 5, 'au plus 5 segments au-delà du domaine');
});

test('cheminActuelDryRunV2_ : ancêtre illisible → dégrade sur ce qui a pu être lu, jamais un plantage', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  const cassé = { getParents: () => { throw new Error('illisible'); } };
  const f = { getParents: () => iter([{ getName: () => 'sous-dossier', getParents: () => iter([cassé]) }]) };
  assert.strictEqual(ctx.cheminActuelDryRunV2_(f, '01 · Administratif & identité'), '01 · Administratif & identité/sous-dossier');
});

/* ---------- traiterUnDryRunV2_ / appliquerDryRunV2_ : idempotence, convergence, bornage ---------- */

function ctxTraiter(opts) {
  opts = opts || {};
  const calls = { rows: [], index: [], journaux: [] };
  const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs', 'DryRunV2.gs']);
  ctx.journalInfo_ = (s, m) => calls.journaux.push(m);
  ctx.journalErreur_ = (s, m) => calls.journaux.push('ERR:' + m);
  ctx.indexAjouter_ = (cle, res, emp) => calls.index.push({ cle, res, emp });
  ctx.feuille_ = (nom) => ({ appendRow: (ligne) => calls.rows.push({ nom, ligne }) });
  ctx.extraireTexte_ = () => 'texte extrait '.repeat(10);
  ctx.classifierDeuxPasses_ = opts.classif !== undefined ? () => opts.classif :
    () => ({ domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Québec', confiance: 0.9 });
  ctx.usageRunSnapshot_ = () => ({ hin: 0, hout: 0, sin: 0, sout: 0 });
  ctx.coutDollarsDelta_ = () => 0.035;
  // Spies : preuve qu'AUCUNE fonction de mutation n'est jamais appelée par ce module.
  ['deciderRoutageV2_', 'sousDossier_', 'renommer_', 'deplacerEtRenommer_', 'garantirNomUnique_', 'creerRaccourci_'].forEach((fn) => {
    ctx[fn] = () => { throw new Error(fn + ' ne doit JAMAIS être appelée par DryRunV2.gs'); };
  });
  ctx.DriveApp = {
    getFileById: (id) => ({
      getName: () => opts.nom || 'doc.pdf',
      getSize: () => 1000,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => (opts.blobKo ? (() => { throw new Error('blob illisible'); })() : {}),
      getParents: () => iter(opts.parents === undefined ? [{ getName: () => 'sous-dossier' }] : opts.parents),
      getMimeType: () => 'application/pdf',
    }),
  };
  return { ctx, calls };
}

test('traiterUnDryRunV2_ : document classé → 1 ligne écrite, clé Index marquée, ZÉRO mutation', () => {
  const { ctx, calls } = ctxTraiter();
  const r = ctx.traiterUnDryRunV2_('F1', '02 · Finances', 'd1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.rows.length, 1);
  assert.strictEqual(calls.rows[0].nom, 'DryRunV2');
  assert.strictEqual(calls.rows[0].ligne[5], 'classé');
  assert.strictEqual(calls.index.length, 1);
  assert.strictEqual(calls.index[0].cle, 'dryrunv2|d1|F1'); // clé DÉDIÉE, jamais la clé de prod
});

test('traiterUnDryRunV2_ : échec LLM (classif null) → ligne « échec », toujours marqué (convergence)', () => {
  const { ctx, calls } = ctxTraiter({ classif: null });
  const r = ctx.traiterUnDryRunV2_('F2', '02 · Finances', 'd1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.rows[0].ligne[5], 'échec classification');
  assert.strictEqual(calls.index.length, 1); // jamais re-collecté à vie
});

test('traiterUnDryRunV2_ : fichier illisible → jamais fatal, marqué ET une ligne écrite (jamais un no-op silencieux)', () => {
  const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs', 'DryRunV2.gs']);
  const calls = { index: [], journaux: [], rows: [] };
  ctx.journalErreur_ = (s, m) => calls.journaux.push(m);
  ctx.indexAjouter_ = (cle, res) => calls.index.push({ cle, res });
  ctx.feuille_ = (nom) => ({ appendRow: (ligne) => calls.rows.push({ nom, ligne }) });
  ctx.DriveApp = { getFileById: () => { throw new Error('introuvable'); } };
  const r = ctx.traiterUnDryRunV2_('KO', '02 · Finances', 'd1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.index[0].cle, 'dryrunv2|d1|KO');
  assert.strictEqual(calls.index[0].res.statut, 'dry-run illisible');
  // Un fichier supprimé/permission retirée entre la collecte et le traitement ne doit PAS
  // disparaître du rapport que Marc lit pour valider C26-08 (fix code-reviewer #26).
  assert.strictEqual(calls.rows.length, 1);
  assert.strictEqual(calls.rows[0].nom, 'DryRunV2');
  assert.strictEqual(calls.rows[0].ligne[5], 'échec classification');
});

test('appliquerDryRunV2_ : interrupteur DÉDIÉ éteint par défaut → no-op total, zéro appel Drive', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.DriveApp = { getFolderById: () => { throw new Error('ne doit jamais être appelé (flag OFF)'); } };
  assert.strictEqual(ctx.CONFIG.DRYRUN_V2_ACTIF, false);
  assert.doesNotThrow(() => ctx.appliquerDryRunV2_(() => false));
});

test('appliquerDryRunV2_ : borné par tick (DRYRUN_V2_MAX_PAR_RUN), reprenable, convergence finale', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.CONFIG.DRYRUN_V2_ACTIF = true;
  ctx.CONFIG.DRYRUN_V2_MAX_PAR_RUN = 2;
  const store = {};
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }),
  };
  const echantillon = [
    { domaine: 'A', id: 'x1' }, { domaine: 'A', id: 'x2' }, { domaine: 'B', id: 'x3' },
  ];
  ctx.chargerOuGenererEchantillonDryRunV2_ = () => echantillon;
  const traites = [];
  const fait = new Set();
  ctx.indexContient_ = (cle) => fait.has(cle);
  ctx.traiterUnDryRunV2_ = (id, dom, tag) => { traites.push(id); fait.add('dryrunv2|' + tag + '|' + id); return true; };
  ctx.journalInfo_ = () => {};

  ctx.appliquerDryRunV2_(() => false); // tick 1 : plafonné à 2
  assert.deepStrictEqual(traites, ['x1', 'x2']);
  assert.notStrictEqual(store.DriveAI_DRYRUNV2, 'd1'); // pas encore terminé

  ctx.appliquerDryRunV2_(() => false); // tick 2 : reprend là où ça s'est arrêté
  assert.deepStrictEqual(traites, ['x1', 'x2', 'x3']);
  assert.strictEqual(store.DriveAI_DRYRUNV2, ctx.CONFIG.DRYRUN_V2_TAG); // converge : plus rien à traiter

  ctx.appliquerDryRunV2_(() => false); // tick 3 : campagne finie → no-op, jamais re-traité
  assert.deepStrictEqual(traites, ['x1', 'x2', 'x3']);
});

/* ---------- Tripwire statique : ZÉRO mutation Drive dans DryRunV2.gs ---------- */

test('VERROU zéro-mutation : DryRunV2.gs n\'appelle JAMAIS une fonction de mutation Drive', () => {
  const chemin = path.join(__dirname, '..', 'src', 'DryRunV2.gs');
  const contenu = fs.readFileSync(chemin, 'utf-8');
  // Adjacence STRICTE nom+« ( » (un vrai appel) : les mentions en prose dans les commentaires
  // (ex. « jamais deciderRoutageV2_ (qui crée... ») ne portent jamais ce motif — jamais de faux positif.
  // Liste PROUVÉE exhaustive par la revue security-auditor #26 (injection empirique de 3 mutations
  // natives absentes de la 1ʳᵉ version — setName/createFile/addFile — confirmées NON détectées avant
  // cet ajout) : wrappers du moteur + API Drive natives de mutation (renommage, création, multi-parents).
  const INTERDITS = [
    'deciderRoutageV2_(', 'sousDossier_(', 'renommer_(', 'deplacerEtRenommer_(',
    'garantirNomUnique_(', 'creerRaccourci_(',
    'setTrashed(', '.moveTo(', 'createFolder(', '.setName(', '.createFile(',
    '.addFile(', '.removeFile(', '.createShortcut(',
  ];
  const violations = INTERDITS.filter((motif) => contenu.includes(motif));
  assert.deepStrictEqual(violations, [],
    'appel(s) de mutation détecté(s) dans DryRunV2.gs (doit rester lecture seule) : ' + violations.join(', '));
});
