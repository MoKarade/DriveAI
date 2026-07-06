'use strict';
/**
 * Réorg IA (C21-04) — les fonctions PURES autour du LLM : `resumeArborescence_` (entrée du
 * prompt), `parserPropositionReorg_` (sortie LLM = donnée non fiable : whitelist stricte,
 * indices bornés à l'inventaire, RACINES de domaine intouchables, cycles et « / » rejetés),
 * `lignePourAction_` (contrat de lecture de l'app, C21-05).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

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
