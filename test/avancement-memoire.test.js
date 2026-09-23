'use strict';
/**
 * test/avancement-memoire.test.js — ce que DriveAI POUSSE à la Mémoire pour son onglet
 * Avancement (C49-27, ADR 0009 de MemoryAI).
 *
 * Ce que ces cas défendent :
 *   1. le corps ne porte QUE les champs que le contrat d'en face accepte — la liste est recopiée
 *      ici avec sa source, parce qu'un contrat entre deux dépôts n'est testé par aucun des deux ;
 *   2. « pas mesuré » part en `null`, jamais en zéro ;
 *   3. aucune chaîne libre ne part : dates, codes, tag, horodatage ;
 *   4. la cadence (30 min), l'horodatage posé AVANT l'appel, et un échec qui se NOMME.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'Memoire.gs', 'AvancementMemoire.gs']);
}

// ⚠️ RECOPIÉ de MemoryAI `lib/avancement/contrat.ts` (schéma `.strict()`), le 23/09/2026. Ce
// test ne prouve pas que la recopie est fraîche : il OBLIGE à rouvrir le contrat au prochain
// champ ajouté ici (leçon §9, « un contrat entre deux dépôts n'appartient à aucun des deux »).
const CONTRAT = {
  racine: ['version', 'mesureLe', 'classes', 'envoi', 'fileLecture', 'joursLus'],
  classes: ['lignes', 'distincts', 'sansFileId', 'candidats'],
  envoi: ['acceptes'],
  dossier: ['code', 'lus', 'restants', 'enCours'],
  jour: ['jour', 'restants', 'extraits', 'acceptes', 'illisibles', 'sansTexte', 'echecs', 'tag'],
};

const PERIMETRE = '2026-09-23T21:14:00.000Z|c49-4-c|2900/4240/26550|268|06=1169|pdf=3000|383|04=23,01=87|3100';
const FILE = '04:0/48·01:0/110·02:0/1052·05:528/531·03:284/284';
const HISTO = [
  ['2026/09/22', 12, 60, 60, 3, 1, 0, 'c49-5-b'],
  [new Date(2026, 8, 23), 2841, 5, 5, 0, 0, 0, 'c49-5-b'],
  ['hier', 1, 1, 1, 0, 0, 0, 'c49-5-b'],             // date illisible : sautée
  ['2026/09/21', 1, 1, 1, 0, 0, 0, 'Relevé Marc.pdf'], // tag qui ressemble à un nom : sauté
  ['2026/09/20', '', 1, 1, 0, 0, 0, 'c49-5-b'],       // reste inconnu : null, pas 0
];

test('le corps ne porte QUE les champs du contrat d\'en face, à tous les niveaux', () => {
  const c = ctx();
  const b = c.corpsAvancement_(PERIMETRE, '2974', FILE, HISTO, Date.parse('2026-09-23T22:00:00Z'));
  assert.deepStrictEqual(Object.keys(b).sort(), [...CONTRAT.racine].sort());
  assert.deepStrictEqual(Object.keys(b.classes).sort(), [...CONTRAT.classes].sort());
  assert.deepStrictEqual(Object.keys(b.envoi).sort(), [...CONTRAT.envoi].sort());
  for (const d of b.fileLecture) assert.deepStrictEqual(Object.keys(d).sort(), [...CONTRAT.dossier].sort());
  for (const j of b.joursLus) assert.deepStrictEqual(Object.keys(j).sort(), [...CONTRAT.jour].sort());
});

test('les valeurs : documents distincts, envoyés, dossier EN COURS, jours convertis', () => {
  const c = ctx();
  const b = c.corpsAvancement_(PERIMETRE, '2974', FILE, HISTO, Date.parse('2026-09-23T22:00:00Z'));
  assert.strictEqual(b.version, 1);
  assert.strictEqual(b.mesureLe, '2026-09-23T22:00:00.000Z');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.classes)), { lignes: 26550, distincts: 3100, sansFileId: 383, candidats: 2900 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.envoi)), { acceptes: 2974 });
  const cinq = b.fileLecture.find((d) => d.code === '05');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cinq)), { code: '05', lus: 3, restants: 528, enCours: true });
  assert.strictEqual(b.fileLecture.filter((d) => d.enCours).length, 1, 'UN seul dossier en cours : le premier qui a du reste');
  assert.deepStrictEqual(Array.from(b.joursLus.map((j) => j.jour)), ['2026-09-22', '2026-09-23', '2026-09-20']);
  assert.strictEqual(b.joursLus[2].restants, null, 'un reste inconnu part en null, jamais en zéro');
});

test('« pas mesuré » part en NULL, jamais en zéro (mutation : `|| 0`)', () => {
  const c = ctx();
  const b = c.corpsAvancement_(null, null, null, [], Date.parse('2026-09-23T22:00:00Z'));
  assert.strictEqual(b.classes, null, 'périmètre jamais recompté');
  assert.strictEqual(b.envoi, null, 'envoi jamais fait');
  assert.deepStrictEqual(Array.from(b.fileLecture), []);
  // Un périmètre écrit par une version qui ne comptait pas les documents distincts : `null`.
  const ancien = c.classesAvancement_('2026-09-17T17:27:00.000Z|c49-4-b|3972/4240/26550|268|x|y|734|04=23');
  assert.strictEqual(ancien.distincts, null);
});

test('aucune chaîne libre ne part : seulement dates, codes, tag et horodatage', () => {
  const c = ctx();
  const b = c.corpsAvancement_(PERIMETRE, '2974', FILE, HISTO, Date.now());
  const chaines = [];
  (function parcourir(v) {
    if (typeof v === 'string') chaines.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(parcourir);
  })(JSON.parse(JSON.stringify(b)));
  const formes = [/^\d{4}-\d{2}-\d{2}$/, /^\d{2}$/, /^[a-z0-9-]{1,32}$/, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/];
  for (const s of chaines) assert.ok(formes.some((f) => f.test(s)), 'chaîne libre : ' + s);
  assert.ok(!JSON.stringify(b).includes('Relevé'));
});

test('au plus 60 jours, les plus RÉCENTS', () => {
  const c = ctx();
  const beaucoup = Array.from({ length: 90 }, (_, i) => [
    '2026/' + String(7 + Math.floor(i / 28)).padStart(2, '0') + '/' + String((i % 28) + 1).padStart(2, '0'),
    i, 1, 1, 0, 0, 0, 'c49-5-b']);
  const j = c.joursAvancement_(beaucoup);
  assert.strictEqual(j.length, 60);
  assert.strictEqual(j[59].restants, 89);
});

function faussesProps(depart) {
  const m = Object.assign({}, depart || {});
  return { ecrit: m, getProperty: (k) => (k in m ? m[k] : null), setProperty: (k, v) => { m[k] = String(v); } };
}

function ctxEnvoi(props, reponse) {
  const c = ctx();
  c.PropertiesService = { getScriptProperties: () => props };
  c.feuille_ = () => ({ getLastRow: () => 1, getRange: () => ({ getValues: () => [] }) });
  c.envois = [];
  c.UrlFetchApp = {
    fetch: (url, opts) => {
      c.envois.push({ url, corps: JSON.parse(opts.payload), auth: opts.headers.Authorization });
      if (reponse === 'reseau') throw new Error('DNS');
      return { getResponseCode: () => reponse.code, getContentText: () => JSON.stringify(reponse.corps || {}) };
    }
  };
  return c;
}

test('un envoi réussi se dit, et l\'horodatage de tentative empêche un second envoi avant 30 min', () => {
  const props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton', DriveAI_MEMOIRE_EMIS: '2974', DriveAI_PERIMETRE_PIECE: PERIMETRE });
  const c = ctxEnvoi(props, { code: 200, corps: { ok: true } });
  const t = Date.parse('2026-09-23T22:00:00Z');
  c.pousserAvancementMemoire_(props, t);
  assert.strictEqual(c.envois.length, 1);
  assert.match(c.envois[0].url, /\/api\/avancement$/);
  assert.strictEqual(c.envois[0].auth, 'Bearer jeton');
  assert.match(props.ecrit.DriveAI_AVANCEMENT_ENVOI, /\|ok$/);
  c.pousserAvancementMemoire_(props, t + 10 * 60 * 1000);
  assert.strictEqual(c.envois.length, 1, 'pas avant 30 min');
  c.pousserAvancementMemoire_(props, t + 31 * 60 * 1000);
  assert.strictEqual(c.envois.length, 2);
});

test('un refus 422 NOMME les champs ; une panne réseau se dit ; un échec ne se retente pas au tick suivant', () => {
  const props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c = ctxEnvoi(props, { code: 422, corps: { error: 'schema_refuse', champs: ['classes.distincts'] } });
  c.pousserAvancementMemoire_(props, Date.parse('2026-09-23T22:00:00Z'));
  assert.match(props.ecrit.DriveAI_AVANCEMENT_ENVOI, /!HTTP 422 \(champs : classes\.distincts\)/);
  assert.match(c.ligneAvancementMemoire_(props.ecrit.DriveAI_AVANCEMENT_ENVOI), /^envoi en échec le 2026-09-23 22:00 UTC — HTTP 422/);

  const p2 = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c2 = ctxEnvoi(p2, 'reseau');
  c2.pousserAvancementMemoire_(p2, Date.parse('2026-09-23T22:00:00Z'));
  assert.match(p2.ecrit.DriveAI_AVANCEMENT_ENVOI, /\|!réseau$/);
  // L'horodatage de TENTATIVE est posé avant l'appel : la panne ne se re-sonde pas à chaque tick.
  c2.pousserAvancementMemoire_(p2, Date.parse('2026-09-23T22:05:00Z'));
  assert.strictEqual(c2.envois.length, 1);
});

test('canal éteint ou sans jeton : rien ne part, et la ligne dit « jamais envoyé »', () => {
  const props = faussesProps({});
  const c = ctxEnvoi(props, { code: 200 });
  c.pousserAvancementMemoire_(props, Date.now());
  assert.strictEqual(c.envois.length, 0);
  assert.match(c.ligneAvancementMemoire_(null), /jamais envoyé/);
  const p2 = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c2 = ctxEnvoi(p2, { code: 200 });
  c2.CONFIG.MEMOIRE_PUSH = false;
  c2.pousserAvancementMemoire_(p2, Date.now());
  assert.strictEqual(c2.envois.length, 0);
});
