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

const ctx = load(['Config.gs', 'Reorg.gs']);
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
  const c = load(['Config.gs', 'Reorg.gs']);
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
  const c = load(['Config.gs', 'Reorg.gs']);
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
  const c = load(['Config.gs', 'Router.gs', 'Reorg.gs']);
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
  const c = load(['Config.gs', 'Reorg.gs']);
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
  const c = load(['Config.gs', 'Router.gs', 'Reorg.gs']); // Router.gs : TYPES_IDENTITE
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
  const c = load(['Config.gs', 'Router.gs', 'Reorg.gs']);
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
