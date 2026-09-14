'use strict';
/**
 * Réorg IA (C21-04) — les fonctions PURES autour du LLM : `resumeArborescence_` (entrée du
 * prompt), `parserPropositionReorg_` (sortie LLM = donnée non fiable : whitelist stricte,
 * indices bornés à l'inventaire, RACINES de domaine intouchables, cycles et « / » rejetés),
 * `lignePourAction_` (contrat de lecture de l'app, C21-05).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Reorg.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o));

const INVENTAIRE = [
  { id: 'idA', chemin: '03 · Logement & véhicule', nbFichiers: 2, exemples: ['bail.pdf'] }, // racine
  { id: 'idB', chemin: '03 · Logement & véhicule/KIA', nbFichiers: 12, exemples: [] },
  { id: 'idC', chemin: '08 · Perso & projets/Vrac', nbFichiers: 0, exemples: [] },
];

test('resumeArborescence_ : « #n | chemin (x fichiers ; ex. …) », exemples omis si vides et tronqués à 60', () => {
  const s = ctx.resumeArborescence_(INVENTAIRE);
  assert.strictEqual(s.split('\n')[0], '#1 | 03 · Logement & véhicule (2 fichiers ; ex. bail.pdf)');
  assert.strictEqual(s.split('\n')[2], '#3 | 08 · Perso & projets/Vrac (0 fichiers)');
  const long = ctx.resumeArborescence_([{ id: 'x', chemin: 'X', nbFichiers: 1, exemples: ['n'.repeat(200)] }]);
  assert.ok(long.length < 120); // nom d'exemple borné (entrée LLM bornée)
});

test('resumeArborescence_ : flag « TROP DE DOSSIERS » au-delà de la TOLÉRANCE seulement (ADR-0027)', () => {
  const T = ctx.CONFIG.REORG_MAX_SOUS_DOSSIERS_TOLERANCE; // cas dérivés de la CONFIG, jamais de sa valeur du jour
  const ligne = (nbSousDossiers) => ctx.resumeArborescence_(
    [{ id: 'i', chemin: '05 · Carrière', nbFichiers: 12, exemples: [], nbSousDossiers: nbSousDossiers }]);

  // Sous la tolérance : AUCUN flag (un dossier sain ne coûte pas un token de plus).
  assert.strictEqual(ligne(T - 1), '#1 | 05 · Carrière (12 fichiers)');
  // À la tolérance et au-delà : flag explicite, avec le compte réel.
  assert.strictEqual(ligne(T), '#1 | 05 · Carrière (12 fichiers, ' + T + ' sous-dossiers ⚠️ TROP DE DOSSIERS, À REGROUPER)');
  assert.ok(ligne(T + 5).includes(', ' + (T + 5) + ' sous-dossiers ⚠️ TROP DE DOSSIERS, À REGROUPER'));
  // L'idéal (7) n'est PAS un seuil d'alerte : on n'embête pas Marc pour un 8e dossier (7 ± 2).
  assert.ok(ctx.CONFIG.REORG_MAX_SOUS_DOSSIERS_IDEAL < T, 'idéal < tolérance');
  assert.ok(!ligne(ctx.CONFIG.REORG_MAX_SOUS_DOSSIERS_IDEAL).includes('⚠️'));
  // Champ absent / non numérique (inventaire d'une version antérieure) : jamais d'alerte inventée.
  assert.strictEqual(ctx.resumeArborescence_([{ id: 'i', chemin: 'X', nbFichiers: 0, exemples: [] }]),
    '#1 | X (0 fichiers)');
  assert.ok(!ligne(null).includes('⚠️'));
  assert.ok(!ligne('beaucoup').includes('⚠️'));
  // Le flag se place AVANT les exemples (lisibilité du prompt).
  const avecEx = ctx.resumeArborescence_(
    [{ id: 'i', chemin: 'X', nbFichiers: 1, exemples: ['CV.pdf'], nbSousDossiers: T }]);
  assert.strictEqual(avecEx, '#1 | X (1 fichiers, ' + T + ' sous-dossiers ⚠️ TROP DE DOSSIERS, À REGROUPER ; ex. CV.pdf)');
});

/**
 * Faux dossier Drive complet (nom + contenu + parents) pour `inventaireDossiers_`.
 * `parents` sert à la garde multi-parents (`aParentEtrangerProtege_`).
 */
const dossierFake = (id, nom, sousDossiers, parents) => {
  const self = {
    getId: () => id,
    getName: () => nom,
    getFiles: () => iter([]),
    getFolders: () => iter(sousDossiers || []),
    getParents: () => iter(parents || []),
  };
  return self;
};

test('inventaireDossiers_ : nbSousDossiers ne compte QUE les regroupables (années/schémas/_ exclus, ADR-0027)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Reorg.gs']);
  const racine = dossierFake('idRacine', '05 · Carrière', []);
  // 2 entités (regroupables) + 1 année + 1 schéma + 1 système « _… » → seules les 2 entités comptent.
  const enfants = [
    dossierFake('e1', 'Robovic', [], [racine]),
    dossierFake('e2', 'Ubisoft', [], [racine]),
    dossierFake('a1', '2024', [], [racine]),        // année : STRUCTURELLE (jamais regroupée)
    dossierFake('s1', 'Factures', [], [racine]),    // schéma : le router route PAR NOM
    dossierFake('x1', '_Doublons', [], [racine]),   // racine système
  ];
  racine.getFolders = () => iter(enfants);
  c.ensembleDomainesProteges_ = () => ({});
  c.DriveApp = { getFolderById: (id) => (id === 'idRacine' ? racine : null) };

  const res = c.inventaireDossiers_('idRacine', () => false);
  const parChemin = {};
  res.dossiers.forEach((d) => { parChemin[d.chemin] = d; });
  assert.strictEqual(parChemin['05 · Carrière'].nbSousDossiers, 2, 'seules les 2 entités comptent');
  // Les enfants sont bien inventoriés (le comptage ne change pas la collecte) — sauf « _… ».
  assert.strictEqual(parChemin['05 · Carrière/Robovic'].nbSousDossiers, 0);
  assert.strictEqual(parChemin['05 · Carrière/2024'].nbSousDossiers, 0);
  assert.ok(!parChemin['05 · Carrière/_Doublons'], 'racine système hors inventaire');
  // Le champ alimente le flag du prompt (contrat entre les deux fonctions).
  assert.ok(c.resumeArborescence_(res.dossiers).indexOf('⚠️') === -1, 'sous la tolérance : aucun flag');
});

test('inventaireDossiers_ : le flag SE DÉCLENCHE bien au-delà de la tolérance (test POSITIF, ADR-0027)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Reorg.gs']);
  const T = c.CONFIG.REORG_MAX_SOUS_DOSSIERS_TOLERANCE; // dérivé de la CONFIG, jamais d'une valeur en dur
  const racine = dossierFake('idRacine', '05 · Carrière', []);
  // T entités regroupables → le flag DOIT apparaître. Sans ce test, élargir les exclusions
  // neutraliserait la règle en silence (le test négatif seul resterait vert).
  racine.getFolders = () => iter(Array.from({ length: T }, (_, i) => dossierFake('e' + i, 'Employeur ' + i, [], [racine])));
  c.ensembleDomainesProteges_ = () => ({});
  c.DriveApp = { getFolderById: (id) => (id === 'idRacine' ? racine : null) };

  const res = c.inventaireDossiers_('idRacine', () => false);
  const racineInv = res.dossiers.filter((d) => d.chemin === '05 · Carrière')[0];
  assert.strictEqual(racineInv.nbSousDossiers, T);
  assert.ok(c.resumeArborescence_(res.dossiers).includes('⚠️ TROP DE DOSSIERS'), 'le flag doit être émis');
});

test('inventaireDossiers_ : les dossiers de TYPE D\'IDENTITÉ ne comptent pas (créés par nom, jamais regroupables)', () => {
  // Router.gs est chargé ICI parce que `estSegmentStructurel_` lit `TYPES_IDENTITE`, qui y est
  // défini — comme en production (surface-moteur charge tout). Sans lui, la liste est vide et le
  // test passerait à tort : c'est exactement la dépendance inter-module qu'on veut voir.
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Reorg.gs']);
  const racine = dossierFake('idRacine', '01 · Administratif & identité', []);
  racine.getFolders = () => iter([
    dossierFake('p1', 'Passeport', [], [racine]),
    dossierFake('p2', 'Permis de conduire', [], [racine]),
    dossierFake('e1', 'Revenu Québec', [], [racine]), // entité : seule regroupable
  ]);
  c.ensembleDomainesProteges_ = () => ({});
  c.DriveApp = { getFolderById: (id) => (id === 'idRacine' ? racine : null) };

  const res = c.inventaireDossiers_('idRacine', () => false);
  const racineInv = res.dossiers.filter((d) => d.chemin === '01 · Administratif & identité')[0];
  assert.strictEqual(racineInv.nbSousDossiers, 1, 'Passeport/Permis sont STRUCTURELS (le router les recrée par nom)');
});

test('inventaireDossiers_ : un sous-dossier au nom ILLISIBLE n’est pas compté et ne plante pas', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Reorg.gs']);
  const racine = dossierFake('idRacine', '05 · Carrière', []);
  const casse = dossierFake('k1', 'x', [], [racine]);
  casse.getName = () => { throw new Error('nom illisible (Drive vivant)'); };
  racine.getFolders = () => iter([dossierFake('e1', 'Robovic', [], [racine]), casse]);
  c.ensembleDomainesProteges_ = () => ({});
  c.DriveApp = { getFolderById: (id) => (id === 'idRacine' ? racine : null) };

  const res = c.inventaireDossiers_('idRacine', () => false);
  const racineInv = res.dossiers.filter((d) => d.chemin === '05 · Carrière')[0];
  assert.strictEqual(racineInv.nbSousDossiers, 1, 'illisible non compté, jamais une alerte inventée');
});

test('parserPropositionReorg_ : plan sain accepté, chaque type validé', () => {
  const p = ctx.parserPropositionReorg_(JSON.stringify({
    actions: [
      { type: 'deplacer', dossier: 3, vers: 1, raison: 'Vrac remonte sous Logement' },
      { type: 'fusionner', dossier: 3, vers: 2, raison: 'doublon' },
      { type: 'creer', parent: 1, nom: 'Assurances', raison: 'regrouper' },
      { type: 'renommer', dossier: 2, nom: 'KIA Sportage', raison: 'précision' },
    ],
    synthese: 'Deux regroupements.',
  }), INVENTAIRE);
  assert.strictEqual(p.actions.length, 4);
  assert.strictEqual(p.synthese, 'Deux regroupements.');
});

test('parserPropositionReorg_ : index hors inventaire, non entier, auto-référence, type interdit → action rejetée', () => {
  const p = ctx.parserPropositionReorg_(JSON.stringify({
    actions: [
      { type: 'deplacer', dossier: 99, vers: 1, raison: 'index inventé' },
      { type: 'deplacer', dossier: 1.5, vers: 2, raison: 'non entier' },
      { type: 'fusionner', dossier: 2, vers: 2, raison: 'sur lui-même' },
      { type: 'supprimer', dossier: 2, raison: 'type interdit' }, // jamais de suppression
      { type: 'creer', parent: 2, nom: '  ', raison: 'nom vide' },
      { type: 'renommer', dossier: 2, nom: 'Bon', raison: 'seule valide' },
    ],
  }), INVENTAIRE);
  assert.strictEqual(p.actions.length, 1);
  assert.strictEqual(p.actions[0].type, 'renommer');
});

test('parserPropositionReorg_ : RACINES de domaine intouchables, « / » rejeté, indices-chaînes tolérés', () => {
  const p = ctx.parserPropositionReorg_(JSON.stringify({
    actions: [
      { type: 'deplacer', dossier: 1, vers: 3, raison: 'racine mutée' },   // rejeté
      { type: 'renommer', dossier: 1, nom: 'Autre', raison: 'racine' },    // rejeté
      { type: 'fusionner', dossier: 1, vers: 2, raison: 'racine' },        // rejeté
      { type: 'renommer', dossier: 2, nom: 'a/b', raison: 'slash' },       // rejeté
      { type: 'deplacer', dossier: '3', vers: '#1', raison: 'chaînes' },   // toléré (coercition)
    ],
  }), INVENTAIRE);
  assert.strictEqual(p.actions.length, 1);
  assert.deepStrictEqual(plat(p.actions[0]), { type: 'deplacer', dossier: 3, vers: 1, raison: 'chaînes' });
});

test('parserPropositionReorg_ : cycle (cible DESCENDANTE du dossier muté) et même id sous 2 chemins → rejetés', () => {
  const inv = [
    { id: 'r', chemin: '03 · Logement', nbFichiers: 0, exemples: [] },
    { id: 'a', chemin: '03 · Logement/A', nbFichiers: 0, exemples: [] },
    { id: 'b', chemin: '03 · Logement/A/B', nbFichiers: 0, exemples: [] },
    { id: 'a', chemin: '08 · Perso/AliasDeA', nbFichiers: 0, exemples: [] }, // même id (multi-parents)
  ];
  assert.strictEqual(ctx.parserPropositionReorg_(JSON.stringify({
    actions: [
      { type: 'deplacer', dossier: 2, vers: 3, raison: 'cycle' },     // B descend de A
      { type: 'fusionner', dossier: 2, vers: 4, raison: 'même id' },  // A → alias de A
    ],
  }), inv), null); // toutes invalides → plan illisible
});

test('parserPropositionReorg_ : TOUTES les actions invalides → null (plan illisible, retenté)', () => {
  assert.strictEqual(ctx.parserPropositionReorg_(JSON.stringify({
    actions: [{ type: 'supprimer', dossier: 2 }],
  }), INVENTAIRE), null);
});

test('parserPropositionReorg_ : plan explicitement VIDE = résultat honnête (pas null)', () => {
  const p = ctx.parserPropositionReorg_(JSON.stringify({ actions: [], synthese: 'Rien à changer.' }), INVENTAIRE);
  assert.deepStrictEqual(plat(p), { actions: [], synthese: 'Rien à changer.' });
});

test('parserPropositionReorg_ : illisible → null ; plafond REORG_ACTIONS_MAX respecté', () => {
  assert.strictEqual(ctx.parserPropositionReorg_(null, INVENTAIRE), null);
  assert.strictEqual(ctx.parserPropositionReorg_('pas de JSON', INVENTAIRE), null);
  const beaucoup = [];
  for (let i = 0; i < 100; i++) beaucoup.push({ type: 'renommer', dossier: 2, nom: 'n' + i });
  const p = ctx.parserPropositionReorg_(JSON.stringify({ actions: beaucoup }), INVENTAIRE);
  assert.strictEqual(p.actions.length, ctx.CONFIG.REORG_ACTIONS_MAX);
});

test('lignePourAction_ : contrat de colonnes — ID = « source→cible » (contrat C21-06)', () => {
  const t = '2026-07-06T00:00:00Z';
  const dep = ctx.lignePourAction_('reorg|d|1', 1, { type: 'deplacer', dossier: 3, vers: 1, raison: 'r' }, INVENTAIRE, t);
  assert.deepStrictEqual(plat(dep), ['reorg|d|1|1', 'deplacer', 'idC→idA',
    '08 · Perso & projets/Vrac', '03 · Logement & véhicule/Vrac', 'proposé', 'r', t]);
  const fus = ctx.lignePourAction_('reorg|d|1', 2, { type: 'fusionner', dossier: 3, vers: 2, raison: '' }, INVENTAIRE, t);
  assert.strictEqual(fus[2], 'idC→idB');
  const cre = ctx.lignePourAction_('reorg|d|1', 3, { type: 'creer', parent: 1, nom: 'Assurances', raison: '' }, INVENTAIRE, t);
  assert.strictEqual(cre[4], '03 · Logement & véhicule/Assurances');
  assert.strictEqual(cre[2], '→idA');
  const ren = ctx.lignePourAction_('reorg|d|1', 4, { type: 'renommer', dossier: 2, nom: 'KIA Sportage', raison: '' }, INVENTAIRE, t);
  assert.strictEqual(ren[4], '03 · Logement & véhicule/KIA Sportage');
  assert.strictEqual(ren[2], 'idB');
});

/* ---------- C21-06 : application — helpers PURS ---------- */

test('estSegmentStructurel_ : années AAAA et noms de schéma d’entité (le router route par NOM)', () => {
  assert.strictEqual(ctx.estSegmentStructurel_('2024'), true);
  assert.strictEqual(ctx.estSegmentStructurel_('Factures'), true);
  assert.strictEqual(ctx.estSegmentStructurel_('Bail & contrat'), true);
  assert.strictEqual(ctx.estSegmentStructurel_('Relevés de notes'), true);
  assert.strictEqual(ctx.estSegmentStructurel_('KIA'), false);
  assert.strictEqual(ctx.estSegmentStructurel_('Vrac'), false);
  assert.strictEqual(ctx.estSegmentStructurel_(''), false);
});

test('parserPropositionReorg_ : segments STRUCTURELS jamais mutés, noms réservés rejetés', () => {
  const inv = [
    { id: 'r', chemin: '02 · Finances', nbFichiers: 0, exemples: [] },
    { id: 'f', chemin: '02 · Finances/Factures', nbFichiers: 5, exemples: [] },   // schéma
    { id: 'a', chemin: '02 · Finances/Factures/2024', nbFichiers: 3, exemples: [] }, // année
    { id: 'v', chemin: '02 · Finances/Vieux papiers', nbFichiers: 2, exemples: [] },
  ];
  const p = ctx.parserPropositionReorg_(JSON.stringify({
    actions: [
      { type: 'renommer', dossier: 2, nom: 'Mes factures' },     // schéma → rejeté
      { type: 'fusionner', dossier: 3, vers: 4 },                // année → rejeté
      { type: 'deplacer', dossier: 2, vers: 4 },                 // schéma → rejeté
      { type: 'renommer', dossier: 4, nom: '_Archives' },        // nom réservé → rejeté
      { type: 'creer', parent: 1, nom: '09 · Nouveau' },         // nom réservé → rejeté
      { type: 'renommer', dossier: 4, nom: 'Archives papier' },  // valide
    ],
  }), inv);
  assert.strictEqual(p.actions.length, 1);
  assert.deepStrictEqual(plat(p.actions[0]), { type: 'renommer', dossier: 4, nom: 'Archives papier', raison: '' });
});

test('partiesId_ : « source→cible », côtés optionnels', () => {
  assert.deepStrictEqual(plat(ctx.partiesId_('a→b')), { source: 'a', cible: 'b' });
  assert.deepStrictEqual(plat(ctx.partiesId_('→p')), { source: '', cible: 'p' });
  assert.deepStrictEqual(plat(ctx.partiesId_('seul')), { source: 'seul', cible: '' });
  assert.deepStrictEqual(plat(ctx.partiesId_('')), { source: '', cible: '' });
});

test('dernierSegment_ : nom depuis le chemin proposé', () => {
  assert.strictEqual(ctx.dernierSegment_('03 · Logement/KIA Sportage'), 'KIA Sportage');
  assert.strictEqual(ctx.dernierSegment_('SansSlash'), 'SansSlash');
  assert.strictEqual(ctx.dernierSegment_(''), '');
});

test('actionsValidees_ : ne prend QUE les actions « validé » des 4 types, avec ids découpés', () => {
  const lignes = [
    ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'],
    ['demande-1', 'demande', '', '', '', 'analyse demandée', 'tout', 'T'],          // pas une action
    ['reorg|demande-1|1', 'deplacer', 'a→b', '08/Vrac', '03/Vrac', 'validé', '', 'T'],
    ['reorg|demande-1|2', 'renommer', 'c', '03/KIA', '03/KIA Sportage', 'proposé', '', 'T'], // pas validé
    ['reorg|demande-1|3', 'creer', '→p', '', '02/Assurances', 'validé', 'raison', 'T'],
    ['videcandidat|x', 'dossier-vide', 'x', '08/Vieux', '', 'vide-candidat', '', 'T'],       // pas un type d'action
    ['reorg|demande-1|4', 'fusionner', 'x→y', '08/Vieux', '02/Neuf', 'écarté', '', 'T'],     // écarté
  ];
  const v = ctx.actionsValidees_(lignes);
  assert.strictEqual(v.length, 2);
  assert.deepStrictEqual(plat(v[0]), {
    rang: 3, cle: 'reorg|demande-1|1', type: 'deplacer', source: 'a', cible: 'b',
    cheminActuel: '08/Vrac', cheminPropose: '03/Vrac', detail: '',
  });
  assert.strictEqual(v[1].rang, 5);
  assert.strictEqual(v[1].cible, 'p');
});

/* ---------- Verrous de regroupement (revue C28-31) : fusion d'entité et cibles interdites ---------- */

test('parserPropositionReorg_ : JAMAIS fusionner une ENTITÉ dans un dossier de REGROUPEMENT (destruction + Dossier ID re-pointé)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Reorg.gs']); // Router.gs : TYPES_IDENTITE
  const inv = [
    { id: 'r', chemin: '05 · Carrière', nbFichiers: 0, exemples: [] },
    { id: 'ID_ROBO', chemin: '05 · Carrière/Robovic', nbFichiers: 8, exemples: [] },     // entité validée
    { id: 'g', chemin: '05 · Carrière/Anciens employeurs', nbFichiers: 0, exemples: [] },// regroupement
    { id: 'ID_ROBO2', chemin: '05 · Carrière/Robovic Inc.', nbFichiers: 2, exemples: [] },// doublon d'entité
  ];
  const idsEntites = { ID_ROBO: true, ID_ROBO2: true };
  const plan = (actions) => c.parserPropositionReorg_(JSON.stringify({ actions, synthese: 's' }), inv, idsEntites);

  // REFUSÉ : fusionner l'entité dans le regroupement — `fusionner` détruit la source et
  // `repointerEntites_` ferait pointer l'entité sur le fourre-tout.
  assert.strictEqual(plan([{ type: 'fusionner', dossier: 2, vers: 3, raison: 'regrouper' }]), null,
    'seule action invalide → plan null');
  // PERMIS : déplacer l'entité dans le regroupement (c'est LA façon de regrouper).
  assert.strictEqual(plat(plan([{ type: 'deplacer', dossier: 2, vers: 3, raison: 'regrouper' }])).actions.length, 1);
  // PERMIS : fusionner deux dossiers de la MÊME entité (doublons de graphie, C21-06).
  assert.strictEqual(plat(plan([{ type: 'fusionner', dossier: 4, vers: 2, raison: 'doublon' }])).actions.length, 1);
});

test('estCibleInterdite_ / parser : une ANNÉE ou un TYPE D\'IDENTITÉ n\'est jamais parent d\'un regroupement', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Reorg.gs']);
  assert.strictEqual(c.estCibleInterdite_('2026'), true);
  assert.strictEqual(c.estCibleInterdite_('Passeport'), true);
  assert.strictEqual(c.estCibleInterdite_('Anciens employeurs'), false);
  assert.strictEqual(c.estCibleInterdite_('Factures'), false, 'un schéma reste une cible de fusion légitime');

  // ADR-0023 : « 02 · Finances/2026/Robovic » est interdit — le parser doit refuser l'action.
  const inv = [
    { id: 'r', chemin: '02 · Finances', nbFichiers: 0, exemples: [] },
    { id: 'e', chemin: '02 · Finances/Desjardins', nbFichiers: 5, exemples: [] },
    { id: 'a', chemin: '02 · Finances/2026', nbFichiers: 3, exemples: [] },
  ];
  assert.strictEqual(
    c.parserPropositionReorg_(JSON.stringify({ actions: [{ type: 'deplacer', dossier: 2, vers: 3, raison: 'x' }] }), inv, {}),
    null, 'déplacer une entité dans un dossier d\'année : refusé');
});

/* ---------- C28-32 (ADR-0029) : mesure de la loi de Miller pour l'auto-scan ---------- */

/* (Skip-list + choix du dossier saturé + dépôt AUTO C28-32/ADR-0029 : RETIRÉS — ADR-0031.) */

test('estSegmentStructurel_ : les dossiers COMMUNS de « Véhicule » sont protégés (ADR-0044)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Reorg.gs']); // Router.gs : TYPES_IDENTITE
  // Ces 3 dossiers sont find-or-créés PAR NOM par le flux vivant (`cheminCibleReset_`) ET par la
  // mission véhicule : les laisser passer pour « regroupables » ferait proposer au LLM de les
  // fusionner, et l'exécution serait aussitôt défaite par le producteur suivant (ping-pong #47).
  // ⚠️ C'est le SEUL verrou : `estAncreStructurelleFusion_` (Fusion.gs) ne consulte que le premier
  // niveau de STRUCTURE_CIBLE_RESET, or ces nœuds sont imbriqués sous « Véhicule » (revue C28-62).
  const communs = JSON.parse(JSON.stringify(c.CONFIG.MISSIONS_VEHICULE_COMMUNS)).map((x) => x.nom);
  assert.ok(communs.length >= 3, 'la CONFIG porte bien les communs');
  communs.forEach((nom) => assert.strictEqual(c.estSegmentStructurel_(nom), true,
    'commun protégé de la Réorg : ' + nom));
  // « Locations » et « À attribuer » n'étaient couverts par RIEN avant ce correctif : ni
  // /^\d{4}$/, ni TYPES_IDENTITE, ni SCHEMAS_ENTITE, ni MISSIONS_CATEGORIES_VEHICULE.
  assert.strictEqual((c.CONFIG.MISSIONS_CATEGORIES_VEHICULE || []).indexOf('Locations'), -1,
    'preuve que la protection ne vient PAS de la liste voisine');
  // Contre-épreuve : un nom quelconque n'est pas structurel (le prédicat ne dit pas oui à tout).
  assert.strictEqual(c.estSegmentStructurel_('Desjardins'), false);
});

test('estSegmentStructurel_ : « Autres employeurs » est protégé (ADR-0044 D11)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Router.gs', 'Reorg.gs']);
  // Calque exact du trou `Locations`/`À attribuer` corrigé en PR1 : ce dossier est IMBRIQUÉ sous
  // « Employeurs », donc invisible d'`estAncreStructurelleFusion_` (niveau 1 seulement). Il est
  // find-or-créé PAR NOM par le flux ET la mission ; sans cette protection il était exposé à
  // l'inventaire RÉCURSIF de la Réorg et à `detecterDossierVide_` — donc proposé à la corbeille.
  assert.strictEqual(c.estSegmentStructurel_(c.CONFIG.MISSIONS_EMPLOYEURS_COMMUN), true);
  // Contre-épreuve : la protection ne vient PAS de la liste voisine des employeurs canoniques.
  assert.ok(c.CONFIG.MISSIONS_EMPLOYEURS.every((e) => e.nom !== c.CONFIG.MISSIONS_EMPLOYEURS_COMMUN));
  assert.strictEqual(c.estSegmentStructurel_('Robovic'), false,
    'un dossier d\'employeur NOMMÉ reste mutable — seul le commun est structurel');
});

test('estSegmentStructurel_ : les buckets de NIVEAU 1 de STRUCTURE_CIBLE_RESET sont immuables (ADR-0044 §6.3)', () => {
  // Reset.gs est REQUIS ici : c'est lui qui porte la table. Sans lui la protection est inerte —
  // c'est d'ailleurs ce qui a fait passer la mutation correspondante en silence, et c'est la
  // raison d'être de ce test (le contexte doit refléter le moteur, où tout est chargé).
  const c = load(['Config.gs', 'Router.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Reorg.gs']);
  // Ces dossiers sont find-or-créés PAR NOM par le flux : les fusionner/renommer est NON
  // convergent (le flux les recrée au document suivant), et un bucket VIDE est justement le
  // candidat idéal d'un plan de regroupement LLM.
  ['Travaux & équipements', 'Recherche d\'emploi', 'Contrats', 'Correspondance', 'Logement', 'Véhicule',
  ].forEach((n) => assert.strictEqual(c.estSegmentStructurel_(n), true, 'bucket de niveau 1 : ' + n));
  // Contre-épreuve : un dossier d'ENTITÉ reste mutable (sinon la Réorg n'aurait plus rien à faire).
  assert.strictEqual(c.estSegmentStructurel_('Desjardins'), false);
  assert.strictEqual(c.estSegmentStructurel_('Robovic'), false);
  // …et la protection vient bien de la TABLE, pas d'une liste voisine.
  const t = JSON.parse(JSON.stringify(c.STRUCTURE_CIBLE_RESET));
  assert.ok(Object.keys(t).some((d) => Object.prototype.hasOwnProperty.call(t[d], 'Travaux & équipements')));
});

/* ---------- C28-93 : la garde par CAPACITÉ de la liste « dossiers vides » ---------- */

/**
 * Contexte chargé AVEC la table de la taxonomie : `estNoeudRecreable_` l'interroge pour de vrai.
 * Mocker la table reviendrait à tester ma propre copie de la question (leçon §9).
 */
const ctxCap = load(['Config.gs', 'Entites.gs', 'Reset.gs', 'Reorg.gs']);

test('estNoeudRecreable_ : tout ce que la TAXONOMIE recrée par nom, à toute profondeur', () => {
  // Les 5 vrais cas du décompte du 13/09 (liste des dossiers proposés à la corbeille de Marc).
  for (const nom of ['Robovic', 'Automatech', 'DriveAI', 'Novel Software', 'Candidatures']) {
    assert.strictEqual(ctxCap.estNoeudRecreable_(nom), true, nom);
  }
  // Nœuds de la table à des profondeurs différentes : niveau 1, niveau 2, sous-dossier d'école.
  assert.strictEqual(ctxCap.estNoeudRecreable_('Contrats'), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('Hydro-Québec'), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('Cours & travaux'), true);
  // Noms de racine de domaine — ce sont EUX qui bloquaient le bouton « tout corbeiller ».
  assert.strictEqual(ctxCap.estNoeudRecreable_('02 · Finances'), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('05 · Carrière'), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('00 · À trier'), true);
  // Racine système, année, schéma d'entité : déjà couverts, on le VÉRIFIE plutôt que le supposer.
  assert.strictEqual(ctxCap.estNoeudRecreable_('_Doublons'), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('2024'), true);
  // Sans nom : échec FERMÉ (on ne propose jamais un dossier qu'on ne sait pas nommer).
  assert.strictEqual(ctxCap.estNoeudRecreable_(''), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_(null), true);
  // …et l'inverse, sinon la garde gèlerait la fonctionnalité : de VRAIS dossiers obsolètes du
  // décompte, que rien dans la taxonomie ne recrée, restent proposables.
  for (const nom of ['IUT GIM 1', 'Colles', 'Omnivox', 'Notes de Terminale', 'Cegep De Sherbrooke']) {
    assert.strictEqual(ctxCap.estNoeudRecreable_(nom), false, nom);
  }
});

test('estNoeudRecreable_ : un dossier d\'ENTITÉ VALIDÉE n\'est jamais proposé', () => {
  // Le référentiel est passé en paramètre (PURE) : le flux et les missions recréent ces dossiers
  // par nom dès qu'un document vise l'entité.
  const validees = { 'cle|x': { nom: 'Kim Pinsonneault', dossierId: 'ID1' } };
  assert.strictEqual(ctxCap.estNoeudRecreable_('Kim Pinsonneault', validees), true);
  assert.strictEqual(ctxCap.estNoeudRecreable_('Kim Pinsonneault'), false, 'sans référentiel : rien à dire');
  assert.strictEqual(ctxCap.estNoeudRecreable_('Inconnu SARL', validees), false);
  // ⚠️ Comparaison NORMALISÉE (casse, accents, apostrophes) — le décompte du 13/09 contenait QUATRE
  // graphies d'« IUT Du Littoral ». Une comparaison stricte n'en protégeait qu'une, sur la
  // population même de la plainte. La garde doit protéger LARGE : c'est le sens où se tromper coûte
  // le moins. Mutation : revenir à `String(nom).trim() === propre` ⇒ ces trois assertions tombent.
  const iut = { 'cle|iut': { nom: 'IUT Du Littoral', dossierId: 'ID2' } };
  for (const graphie of ['IUT du Littoral', 'iut du littoral', 'IUT DU LITTORAL']) {
    assert.strictEqual(ctxCap.estNoeudRecreable_(graphie, iut), true, graphie);
  }
});

test('estNoeudRecreable_ : `Projets` aussi — le décompte en comptait SIX noms, pas cinq', () => {
  // Relevé en revue : ma liste de cinq oubliait `Projets` (nœud de niveau 1 de `05 · Carrière`).
  // Ce test le dérive de la TABLE plutôt que de la recopier — le décompte réel du 13/09 est de
  // 7 LIGNES pour 6 NOMS (`Robovic` y figure deux fois).
  for (const nom of ['Robovic', 'Projets', 'Automatech', 'DriveAI', 'Novel Software', 'Candidatures']) {
    assert.strictEqual(ctxCap.estNoeudRecreable_(nom), true, nom);
  }
});

test('estNoeudRecreablePrudent_ : référentiel MUET ⇒ on s\'abstient de proposer', () => {
  // Variante à échec FERMÉ pour les appelants qui écrivent du DÉFINITIF. `entitesValideesParCle_`
  // échoue OUVERT (`{}` sur exception) : le prédicat nu répondrait « ce n'est pas une entité
  // validée » et laisserait passer la proposition. Mutation : rendre `false` sur `null`/`{}`
  // ⇒ ce test tombe.
  assert.strictEqual(ctxCap.estNoeudRecreablePrudent_('Kim Pinsonneault', null), true, 'illisible');
  assert.strictEqual(ctxCap.estNoeudRecreablePrudent_('Kim Pinsonneault', {}), true, 'vide');
  // …et quand le référentiel RÉPOND, la variante prudente est le prédicat nu : elle ne gèle rien.
  const validees = { 'cle|x': { nom: 'Kim Pinsonneault', dossierId: 'ID1' } };
  assert.strictEqual(ctxCap.estNoeudRecreablePrudent_('IUT GIM 1', validees), false);
  assert.strictEqual(ctxCap.estNoeudRecreablePrudent_('Kim Pinsonneault', validees), true);
});

/* ---------- C28-93 (revue) : la garde s'applique aussi au STOCK déjà proposé ---------- */

/** Un onglet Réorg factice : en-tête + les lignes données. */
function ongletReorg(lignes) {
  return [['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté']]
    .concat(lignes);
}
const vc = (id, chemin, statut) =>
  ['videcandidat|' + id, 'dossier-vide', id, chemin, '', statut || 'vide-candidat', '', ''];

test('videsCandidatsRecreables_ : le STOCK déjà écrit passe par la même garde que le flux', () => {
  // 🔴 de la revue, trouvé par DEUX agents en convergence : `estNoeudRecreable_` n'avait qu'un site
  // d'appel, sur le chemin d'ÉCRITURE. Les 124 lignes d'août étaient déjà dans l'onglet, et le même
  // lot rendait le bouton « Tout corbeiller » OPÉRANT — donc au clic, `Robovic`, `Projets`,
  // `Automatech`, `DriveAI`, `Novel Software`, `Candidatures` et `IUT Du Littoral` partaient à la
  // corbeille : exactement les « dossiers utiles » de la plainte de Marc.
  const validees = { 'cle|iut': { nom: 'IUT Du Littoral', dossierId: 'ID9' } };
  const lignes = ongletReorg([
    vc('A', '05 · Carrière/Projets'),                 // nœud de table, chemin complet (après C28-93)
    vc('B', 'Robovic'),                               // nœud de table, nom nu (lignes d'août)
    vc('C', 'IUT Du Littoral'),                       // entité VALIDÉE du référentiel
    vc('D', '06 · Études & diplômes/Archives/Colles'), // vraiment obsolète : reste proposé
    vc('E', 'Robovic', 'corbeillé'),                  // déjà soldée : on n'y touche pas
    ['reorg|x', 'action', 'Z', 'a', 'b', 'proposé', '', ''], // autre type de ligne : ignorée
  ]);
  // `join` plutôt que `deepStrictEqual` : le tableau vient du contexte VM, donc son prototype
  // n'est pas celui de l'hôte (« same structure but not reference-equal »).
  const cibles = Array.from(ctxCap.videsCandidatsRecreables_(lignes, validees, 'c2893-1'));
  assert.strictEqual(cibles.map((x) => x.nom).join('|'), 'Projets|Robovic|IUT Du Littoral');
  assert.strictEqual(cibles.map((x) => x.rang).join('|'), '2|3|4', 'rangs 1-based, en-tête comprise');
  assert.strictEqual(cibles.map((x) => x.statut).join('|'), 'vide-protégé|vide-protégé|vide-protégé');
});

/**
 * Onglet Réorg factice qui rend la COLONNE DEMANDÉE et enregistre les écritures — pas un mock qui
 * compose sa réponse : `filtrerVidesCandidatsRecreables_` relit la colonne F pour ne pas écraser ce
 * que l'app vient d'y écrire, et un mock aveugle à la colonne ne verrait pas la différence.
 */
function feuilleReorg(lignes) {
  const grille = ongletReorg(lignes);
  const ecrits = [];
  return {
    grille,
    ecrits,
    getLastRow: () => grille.length,
    getRange: (r, col, nbL, nbC) => ({
      getValues: () => grille.slice(r - 1, r - 1 + (nbL || 1)).map((row) => row.slice(col - 1, col - 1 + (nbC || 1))),
      setValues: (v) => {
        ecrits.push({ rang: r, valeurs: v[0] });
        for (let j = 0; j < v[0].length; j++) grille[r - 1][col - 1 + j] = v[0][j];
      },
    }),
  };
}

function ctxFiltre(props) {
  const c = load(['Config.gs', 'Entites.gs', 'Reset.gs', 'Reorg.gs']);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }) };
  c.journalInfo_ = () => {};
  c.entitesValideesOuNull_ = () => ({ 'k|z': { nom: 'Zzz', dossierId: '' } });
  return c;
}

test('filtrerVidesCandidatsRecreables_ : one-shot versionné, et un référentiel MUET ne retire RIEN', () => {
  const props = {};
  const c = ctxFiltre(props);
  const f = feuilleReorg([vc('A', 'Robovic'), vc('D', 'Colles')]);

  // 1) Référentiel ILLISIBLE : aucune ligne retirée, et surtout AUCUN tag posé — sinon un blip de
  //    lecture aurait clos la passe à vide, pour toujours. Symétrique du 🔴 `ascendance-illisible`.
  c.entitesValideesOuNull_ = () => null;
  c.filtrerVidesCandidatsRecreables_(f, f.grille);
  assert.strictEqual(f.ecrits.length, 0, 'référentiel illisible : on ne retire rien');
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, undefined, 'et on n\'a pas conclu la passe');

  // 2) Référentiel VIDE : idem (indiscernable d'un illisible, cf. `chargerEntitesCache_`).
  c.entitesValideesOuNull_ = () => ({});
  c.filtrerVidesCandidatsRecreables_(f, f.grille);
  assert.strictEqual(f.ecrits.length, 0, 'référentiel vide : on ne retire rien non plus');

  // 3) Référentiel lu : la ligne fautive passe à `vide-protégé`, l'obsolète reste proposée.
  c.entitesValideesOuNull_ = () => ({ 'k|z': { nom: 'Zzz', dossierId: '' } });
  c.filtrerVidesCandidatsRecreables_(f, f.grille);
  assert.strictEqual(f.ecrits.length, 1);
  assert.strictEqual(f.ecrits[0].rang, 2);
  assert.strictEqual(f.ecrits[0].valeurs[0], 'vide-protégé');
  assert.ok(String(f.ecrits[0].valeurs[1]).includes('Robovic'),
    'le détail NOMME le dossier : Marc doit pouvoir vérifier');
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, c.VIDES_FILTRE_TAG, 'passe complète ⇒ tag posé');

  // 4) One-shot : au tick suivant, plus rien n'est relu.
  c.filtrerVidesCandidatsRecreables_(f, f.grille);
  assert.strictEqual(f.ecrits.length, 1, 'tag posé : la passe ne repasse pas');

  // 5) …mais bumper la VERSION des règles la rejoue (leçon §9 : la version de la table de règles
  //    fait partie de l'état — sinon ajouter un nœud à la taxonomie n'aurait aucun effet ici).
  //    La ligne 2 est déjà `vide-protégé`, donc la re-passe n'a plus de cible : le tag se repose.
  props.DriveAI_VIDES_FILTRES = 'c2893-0';
  const f2 = feuilleReorg([vc('A', 'Robovic'), vc('D', 'Colles')]);
  c.filtrerVidesCandidatsRecreables_(f2, f2.grille);
  assert.strictEqual(f2.ecrits.length, 1, 'version différente ⇒ le stock est re-filtré');
});

test('filtrerVidesCandidatsRecreables_ : une passe ÉCRÊTÉE ne pose pas le tag', () => {
  // Le tag est le « c'est fini » : le poser sur une passe partielle laisserait le reliquat proposé
  // à vie. Mutation : poser le tag inconditionnellement ⇒ ce test tombe.
  const props = {};
  const c = ctxFiltre(props);
  c.CONFIG = Object.assign({}, c.CONFIG, { REORG_VIDES_FILTRE_LOT: 1 });
  const f = feuilleReorg([vc('A', 'Robovic'), vc('B', 'Projets')]);
  c.filtrerVidesCandidatsRecreables_(f, f.grille);
  assert.strictEqual(f.ecrits.length, 1, 'écrêté au lot');
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, undefined, 'passe incomplète ⇒ jamais « fini »');
});

test('filtrerVidesCandidatsRecreables_ : le garde-temps coupe la boucle d\'écritures', () => {
  // §9 « garde-temps sur TOUT lot » : la passe tourne dans la DERNIÈRE étape du tick et peut
  // démarrer à quelques secondes du mur DUR de 6 min, qu'aucun `try` ne capture — un tick tué
  // emporterait tout ce qui suit. Le plafond par lot ne remplace pas le garde-temps : il est
  // volontairement dimensionné AU-DESSUS du stock, pour finir en un run.
  // Mutation : passer `null` comme garde ⇒ 3 écritures au lieu de 2, ce test tombe.
  const props = {};
  const c = ctxFiltre(props);
  const f = feuilleReorg([vc('A', 'Robovic'), vc('B', 'Projets'), vc('C', 'Automatech')]);
  let appels = 0;
  c.filtrerVidesCandidatsRecreables_(f, f.grille, () => (appels++ >= 2));
  assert.strictEqual(f.ecrits.length, 2, 'coupé au garde-temps');
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, undefined, 'coupé ⇒ jamais « fini »');
  // …et la passe REPREND : le reliquat est re-collecté au tick suivant.
  c.filtrerVidesCandidatsRecreables_(f, f.grille, () => false);
  assert.strictEqual(f.ecrits.length, 3);
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, c.VIDES_FILTRE_TAG);
});

test('filtrerVidesCandidatsRecreables_ : une ligne PROTÉGÉE par le filtre revient au bump (bout en bout)', () => {
  // 🟠 de la 4ᵉ revue : `videsCandidatsRecreables_` avait son test de verdict révisable, mais le
  // WRAPPER n'était jamais exercé sur une ligne dont le statut FRAIS est `vide-protégé` — tous ses
  // tests partaient de `vide-candidat`. Deux mutations restaient vertes sur 1278 tests : supprimer
  // le bras `vide-protégé && duFiltre` de la relecture, et forcer le statut écrit à `vide-protégé`.
  // C'est le défaut même que la 3ᵉ revue avait relevé, reproduit sur le 3ᵉ câblage neuf.
  const props = { DriveAI_VIDES_FILTRES: 'c2893-0' };
  const c = ctxFiltre(props);
  const M = c.MARQUE_FILTRE_VIDES;
  const f = feuilleReorg([
    // Protégée sous un ANCIEN tag, et la taxonomie ne la connaît plus ⇒ elle doit REVENIR.
    ['videcandidat|X', 'dossier-vide', 'X', 'IUT GIM 1', '', 'vide-protégé',
      'raison ' + M + 'c2893-0 → vide-protégé]', ''],
    // Protégée sous un ANCIEN tag, mais c'est MARC qui a échoué au clic (l'app n'écrit que la
    // colonne F : la marque dit « → vide-candidat », le statut relu dit `vide-protégé`) ⇒ définitif.
    ['videcandidat|Y', 'dossier-vide', 'Y', 'IUT GIM 1', '', 'vide-protégé',
      'raison ' + M + 'c2893-0 → vide-candidat]', ''],
  ]);
  c.filtrerVidesCandidatsRecreables_(f, f.grille, () => false);
  assert.strictEqual(f.ecrits.length, 1, 'une seule ligne re-jugée');
  assert.strictEqual(f.ecrits[0].rang, 2);
  assert.strictEqual(f.ecrits[0].valeurs[0], 'vide-candidat', 'elle revient dans la liste de Marc');
  assert.ok(String(f.ecrits[0].valeurs[1]).includes(M + c.VIDES_FILTRE_TAG + ' → vide-candidat]'),
    'la marque porte le tag COURANT et le statut écrit');
  assert.strictEqual(f.grille[2][5], 'vide-protégé', 'le refus subi par Marc, lui, tient');
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, c.VIDES_FILTRE_TAG);
});

test('filtrerVidesCandidatsRecreables_ : ce que l\'APP vient d\'écrire n\'est jamais écrasé', () => {
  // `lignes` est un instantané pris en tête d'étape ; l'app écrit dans le même onglet au clic de
  // Marc. Sans relecture de la colonne F, un `corbeillé` posé entre-temps serait remplacé par
  // `vide-protégé` — une ligne qui affiche « protégé » pour un dossier qui est DANS la corbeille et
  // sera purgé à 30 jours, sans autre trace. Mutation : lire le statut dans `lignes` au lieu de le
  // relire ⇒ ce test tombe.
  const props = {};
  const c = ctxFiltre(props);
  const f = feuilleReorg([vc('A', 'Robovic'), vc('B', 'Projets')]);
  const instantane = JSON.parse(JSON.stringify(f.grille)); // l'état AU DÉBUT de l'étape
  f.grille[1][5] = 'corbeillé';                            // …et l'app clique pendant ce temps
  c.filtrerVidesCandidatsRecreables_(f, instantane);
  assert.strictEqual(f.ecrits.length, 1, 'une seule ligne réécrite');
  assert.strictEqual(f.ecrits[0].rang, 3, 'celle que l\'app n\'a pas touchée');
  assert.strictEqual(f.grille[1][5], 'corbeillé', 'le verdict de l\'app tient');
  // La ligne écartée compte quand même comme EXAMINÉE : la passe est complète.
  assert.strictEqual(props.DriveAI_VIDES_FILTRES, c.VIDES_FILTRE_TAG);
});

test('proposerSourceFusion_ : le SECOND producteur de `videcandidat|` est gardé lui aussi', () => {
  // 🟠 de la revue : après une fusion validée, le moteur appendait directement une ligne
  // `vide-candidat` pour la source drainée, sans passer par `detecterDossierVide_` — donc sans la
  // garde par capacité, alors que l'ADR affirmait le contraire.
  // Mutation : rendre `true` inconditionnellement ⇒ ce test tombe.
  const validees = { 'k|z': { nom: 'Zzz', dossierId: '' } };
  // Un nœud de la TABLE fusionné ailleurs : jamais proposé (la table le recrée ⇒ ping-pong).
  assert.strictEqual(ctxCap.proposerSourceFusion_('05 · Carrière/Projets', '05 · Carrière/Travaux', validees), false);
  // Un dossier vraiment obsolète : proposé, comme avant.
  assert.strictEqual(ctxCap.proposerSourceFusion_('06 · Études/IUT GIM 1', '06 · Études/IUT', validees), true);
  // ⚠️ UN CHEMIN NON ANCRÉ SE LIT DES DEUX FAÇONS, et un seul « oui » suffit à refuser (4ᵉ revue).
  // Une version précédente ne découpait que les chaînes commençant par une racine de domaine — or
  // l'inventaire à PORTÉE (`inventaireDossiers_`, bouton « Analyser la structure » sur un dossier)
  // produit `Robovic/Projets`, sans racine : `Projets` et `Candidatures` redevenaient proposables,
  // les noms MÊMES de la plainte de Marc. Mutation : ne lire que la chaîne entière ⇒ tombe.
  assert.strictEqual(ctxCap.proposerSourceFusion_('Robovic/Projets', 'ailleurs', validees), false);
  assert.strictEqual(ctxCap.proposerSourceFusion_('Robovic/Candidatures', 'ailleurs', validees), false);
  // Un chemin ANCRÉ, lui, ne se lit QUE par son dernier segment — sinon `NN · ` protégerait tout.
  assert.strictEqual(ctxCap.proposerSourceFusion_('06 · Études/Archives/Colles', 'x', validees), true);
  assert.strictEqual(ctxCap.proposerSourceFusion_('06 · Études/Archives', 'ailleurs', validees), false);
  // Conséquence ASSUMÉE de la double lecture : un dossier réellement nommé « Impôts/Archives » n'est
  // plus proposé. Un dossier vide qui subsiste coûte moins qu'un dossier utile corbeillé.
  assert.strictEqual(ctxCap.proposerSourceFusion_('Impôts/Archives', 'ailleurs', validees), false);
  // …et la lecture EN BLOC n'est pas décorative : elle seule protège une entité dont le nom PORTE
  // une barre oblique (Drive l'autorise), dont le dernier segment ne dit rien.
  // Mutation : ne lire que le dernier segment ⇒ cette assertion tombe.
  const slash = { 'cle|s': { nom: 'Dupont/Martin', dossierId: 'ID3' } };
  assert.strictEqual(ctxCap.proposerSourceFusion_('Dupont/Martin', 'ailleurs', slash), false);
  assert.strictEqual(ctxCap.proposerSourceFusion_('Autre/Martin', 'ailleurs', slash), true);
  // ⚠️ MÊME NOM, MÊME VERDICT — et c'est le correctif de la 3ᵉ revue. Une première écriture exemptait
  // les fusions de doublons de même nom : `Robovic` était alors REFUSÉ par `detecterDossierVide_` et
  // PROPOSÉ ici dès que la cible portait le même nom. Trois règles, deux verdicts (corollaire §9).
  // Mutation : remettre `if (nomSource === nomCible) return true;` ⇒ ces deux assertions tombent.
  assert.strictEqual(ctxCap.proposerSourceFusion_('05 · Carrière/A/Projets', '05 · Carrière/B/Projets', validees), false);
  assert.strictEqual(ctxCap.proposerSourceFusion_('x/Kim Pinsonneault', 'y/Kim Pinsonneault', null), false);
  // Référentiel MUET : on s'abstient (échec fermé).
  assert.strictEqual(ctxCap.proposerSourceFusion_('05 · Carrière/x/Kim Pinsonneault', 'y/Kim P.', null), false);
  // Sans nom de source : jamais de proposition.
  assert.strictEqual(ctxCap.proposerSourceFusion_('', 'x/y', validees), false);
});

test('nomDepuisConstat_ : un nom NU n\'est jamais découpé sur « / » (Drive l\'autorise)', () => {
  // 🟠 de la 3ᵉ revue : les lignes d'août portent le nom NU, celles d'après le chemin complet.
  // Découper à l'aveugle lisait « Impôts/Archives » comme « Archives » — un nœud de la table — et
  // retirait la ligne DÉFINITIVEMENT. Ce qui distingue les deux formats : un chemin produit par
  // `cheminPourConstat_` commence TOUJOURS par une racine de domaine.
  assert.strictEqual(ctxCap.nomDepuisConstat_('06 · Études & diplômes/Archives/Colles'), 'Colles');
  assert.strictEqual(ctxCap.nomDepuisConstat_('Impôts/Archives'), 'Impôts/Archives');
  assert.strictEqual(ctxCap.nomDepuisConstat_('Robovic'), 'Robovic');
  assert.strictEqual(ctxCap.nomDepuisConstat_(''), '');
  assert.strictEqual(ctxCap.nomDepuisConstat_(null), '');
  // …et l'effet sur la garde : le dossier à barre oblique reste proposable.
  assert.strictEqual(ctxCap.estNoeudRecreable_(ctxCap.nomDepuisConstat_('Impôts/Archives'), {}), false);
});

test('videsCandidatsRecreables_ : le verdict du FILTRE est révisable DANS LES DEUX SENS', () => {
  // 🟠 de la 3ᵉ revue : `VIDES_FILTRE_TAG` ne rendait l'affinage effectif que dans le sens
  // RESTRICTIF. Une ligne passée à `vide-protégé` n'était jamais relue — or C28-89 a réellement
  // RETIRÉ `Modèles & formulaires` de la table : la ligne correspondante serait restée « protégée »
  // à vie pour un dossier que plus rien ne recrée. §9 : un refus keyé sur « je n'ai pas su faire »
  // exige sa version. Mutation : ignorer les `vide-protégé` dans la collecte ⇒ ce test tombe.
  const M = ctxCap.MARQUE_FILTRE_VIDES;
  const marque = (tag, statut) => 'raison ' + M + tag + ' → ' + statut + ']';
  const prot = (id, chemin, tag) =>
    ['videcandidat|' + id, 'dossier-vide', id, chemin, '', 'vide-protégé', marque(tag, 'vide-protégé'), ''];
  const lignes = ongletReorg([
    prot('A', 'Robovic', 'c2893-0'),        // ancien tag, TOUJOURS un nœud ⇒ ré-écrit sous le neuf
    prot('B', 'IUT GIM 1', 'c2893-0'),      // ancien tag, plus un nœud ⇒ REDEVIENT candidat
    prot('C', 'Robovic', 'c2893-1'),        // déjà jugé sous les règles COURANTES ⇒ rien à faire
    ['videcandidat|D', 'dossier-vide', 'D', 'Robovic', '', 'vide-protégé', 'zone-protegee', ''], // APP
    // ⚠️ Le cas que la marque « tag seul » laissait fuir (4ᵉ revue) : le filtre avait rendu cette
    // ligne candidate, Marc a cliqué, Drive a REFUSÉ, l'app a écrit `vide-protégé` en colonne F —
    // et seulement F, jamais G. La marque porte donc « → vide-candidat » alors que le statut relu
    // dit `vide-protégé` : c'est un verdict de l'APP, définitif. Sans le statut dans la marque, la
    // ligne redevenait candidate à CHAQUE bump et Marc ne pouvait plus s'en débarrasser.
    ['videcandidat|E', 'dossier-vide', 'E', 'Robovic', '', 'vide-protégé', marque('c2893-0', 'vide-candidat'), ''],
  ]);
  // Référentiel NON VIDE — c'est le contrat de la fonction (l'appelant s'abstient sur un
  // référentiel muet). Un `{}` ferait abstenir la garde et le test ne prouverait plus rien.
  const out = Array.from(ctxCap.videsCandidatsRecreables_(lignes, { 'k|z': { nom: 'Zzz' } }, 'c2893-1'));
  assert.strictEqual(out.map((x) => x.rang).join('|'), '2|3');
  assert.strictEqual(out.map((x) => x.statut).join('|'), 'vide-protégé|vide-candidat');
});

/* ---------- 3ᵉ revue : les CÂBLAGES, pas seulement les fonctions pures ---------- */

test('etapeReorg_ APPELLE bien le filtre du stock (câblage, pas seulement la fonction)', () => {
  // 🟠 de la 3ᵉ revue, prouvé par mutation chez elle : retirer l'appel dans `etapeReorg_` laissait
  // 1268/1268 verts. C'est la forme EXACTE du 🔴 d'origine — `estNoeudRecreable_` existait, était
  // testée, et n'avait qu'un site d'appel. Une fonction bien testée qui n'est pas APPELÉE ne
  // protège rien (§9, 3ᵉ question : « que se passe-t-il si je la neutralise ? »).
  const c = load(['Config.gs', 'Entites.gs', 'Reset.gs', 'Reorg.gs']);
  const f = feuilleReorg([vc('A', 'Robovic')]);
  const props = {};
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; },
  }) };
  c.feuille_ = () => Object.assign({ getDataRange: () => ({ getValues: () => f.grille }) }, f);
  c.journalInfo_ = () => {};
  c.journalErreur_ = (s, m) => { throw new Error('aucune erreur attendue : ' + m); };
  c.entitesValideesOuNull_ = () => ({ 'k|z': { nom: 'Zzz', dossierId: '' } });
  c.appliquerReorgValidee_ = () => false;
  c.appliquerReorgIA_ = () => {};
  c.etapeReorg_(() => false);
  assert.strictEqual(f.ecrits.length, 1, 'le filtre a tourné DEPUIS l\'étape de tick');
  assert.strictEqual(f.ecrits[0].valeurs[0], 'vide-protégé');
});

test('appliquerReorgValidee_ APPELLE bien la garde de fusion (câblage)', () => {
  // Même mutation, même verdict chez la revue : retirer l'appel à `proposerSourceFusion_` laissait
  // la suite verte. Ici on exerce le chemin RÉEL : une fusion `appliqué` dont la source est un nœud
  // de la table ne doit produire AUCUNE ligne `vide-candidat`.
  const c = load(['Config.gs', 'Entites.gs', 'Reset.gs', 'Reorg.gs']);
  const appends = [];
  const enTete = ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'];
  const action = (cle, source, chemin, propose) =>
    [cle, 'fusionner', source + ' → CIBLE', chemin, propose, 'validé', '', ''];
  const f = {
    getRange: () => ({ setValue: () => {} }),
    appendRow: (row) => { appends.push(row); },
  };
  c.ensembleDomainesProteges_ = () => ({});
  c.ensembleIntouchables_ = () => ({});
  c.repointerEntites_ = () => {};
  c.appliquerUneAction_ = () => ({ statut: 'appliqué', detail: '' });
  c.entitesValideesOuNull_ = () => ({ 'k|z': { nom: 'Zzz', dossierId: '' } });

  // 1) Source = nœud de la table ⇒ AUCUNE proposition de corbeille.
  const lignes1 = [enTete, action('r|1', 'SRC1', '05 · Carrière/Projets', '05 · Carrière/Travaux')];
  c.appliquerReorgValidee_(f, lignes1, () => false);
  assert.strictEqual(appends.length, 0, 'un nœud que la table recrée n\'est jamais proposé');

  // 2) Contre-épreuve : source vraiment obsolète ⇒ la ligne est bien proposée (rien n'est gelé).
  const lignes2 = [enTete, action('r|2', 'SRC2', '06 · Études/IUT GIM 1', '06 · Études/IUT')];
  c.appliquerReorgValidee_(f, lignes2, () => false);
  assert.strictEqual(appends.length, 1);
  assert.strictEqual(appends[0][5], 'vide-candidat');
});
