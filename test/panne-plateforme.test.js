'use strict';
/**
 * Check-up 2026-07-03 — PANNE DE COMPTE API (crédit épuisé / clé invalide) & canal d'alerte.
 * Incident réel : crédit épuisé le 2026-07-01 20:56 → 1330 échecs HTTP 400 en 2 jours, ~89 docs
 * quarantainés À TORT (3 « échecs » brûlés contre un mur de plateforme), et AUCUNE alerte reçue
 * (Session.getEffectiveUser exige un scope absent → 597 envois morts, résumé hebdo compris).
 *  - Une panne de COMPTE n'est jamais imputée aux documents (ni compteur, ni quarantaine).
 *  - Les appels LLM suivants du run échouent VITE (sans réseau) ; re-sonde au run suivant.
 *  - `emailAlerte_` : Script Property `DriveAI_EMAIL` (pas de nouveau scope = pas de gel).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- détection (pure) ---------- */

const ctxPur = load(['Config.gs', 'Llm.gs']);

test('detecterPannePlateforme_ : crédit épuisé (400+credit balance) et clé invalide (401) → panne', () => {
  assert.strictEqual(ctxPur.detecterPannePlateforme_(400, '{"error":{"message":"Your credit balance is too low"}}'), true);
  assert.strictEqual(ctxPur.detecterPannePlateforme_(401, 'invalid x-api-key'), true);
});

test('detecterPannePlateforme_ : erreurs NORMALES → pas une panne de compte', () => {
  assert.strictEqual(ctxPur.detecterPannePlateforme_(400, '{"error":{"message":"max_tokens invalide"}}'), false);
  assert.strictEqual(ctxPur.detecterPannePlateforme_(429, 'rate limited'), false);
  assert.strictEqual(ctxPur.detecterPannePlateforme_(529, 'overloaded'), false);
  assert.strictEqual(ctxPur.detecterPannePlateforme_(400, ''), false);
});

/* ---------- LLM : panne signalée UNE fois, appels suivants sans réseau ---------- */

function ctxLlm() {
  const c = load(['Config.gs', 'Llm.gs']);
  const calls = { fetch: 0, journaux: [] };
  c.journalErreur_ = (s, m) => calls.journaux.push(m);
  c.journalInfo_ = () => {};
  c.exemplesFewShot_ = () => '';
  c.getCleAnthropic_ = () => 'k';
  c.enregistrerUsage_ = () => {};
  c.tronquer_ = (t) => t;
  c.UrlFetchApp = {
    fetch: () => {
      calls.fetch++;
      return {
        getResponseCode: () => 400,
        getContentText: () => '{"error":{"message":"Your credit balance is too low"}}',
      };
    },
  };
  return { c, calls };
}

test('appelAnthropic_ : crédit épuisé → panne signalée UNE fois, appels suivants SANS réseau', () => {
  const { c, calls } = ctxLlm();
  assert.strictEqual(c.appelAnthropic_('claude-haiku-4-5', { nomFichier: 'a.pdf' }), null);
  assert.strictEqual(calls.fetch, 1);
  assert.strictEqual(c.estPannePlateforme_(), true);
  // 2ᵉ appel du même run (ex. fallback Sonnet, doc suivant) : échec rapide, AUCUN fetch de plus.
  assert.strictEqual(c.appelAnthropic_('claude-sonnet-4-6', { nomFichier: 'b.pdf' }), null);
  assert.strictEqual(calls.fetch, 1);
  assert.strictEqual(calls.journaux.filter((j) => j.includes('PANNE DE COMPTE')).length, 1);
  // Run suivant : re-sonde (le fetch repart).
  c.reinitialiserPannePlateforme_();
  c.appelAnthropic_('claude-haiku-4-5', { nomFichier: 'c.pdf' });
  assert.strictEqual(calls.fetch, 2);
});

/* ---------- Pipeline : la panne n'est JAMAIS imputée aux documents ---------- */

test('gererEchec_ : pendant une panne de compte → NI compteur, NI quarantaine, NI notification', () => {
  const c = load(['Config.gs', 'Pipeline.gs']);
  const calls = { echecs: 0, index: 0, notifs: 0 };
  c.estPannePlateforme_ = () => true;
  c.incrementerEchec_ = () => { calls.echecs++; return 3; };
  c.indexAjouter_ = () => { calls.index++; };
  c.notifierEchec_ = () => { calls.notifs++; };
  c.journalErreur_ = () => {};
  c.gererEchec_({ cle: 'drive|X', nom: 'doc.pdf' }, 'classification impossible');
  assert.deepStrictEqual(calls, { echecs: 0, index: 0, notifs: 0 });
});

test('traiterDocument_ : pendant une panne de compte → document INTOUCHÉ (pas d\'OCR, pas d\'index)', () => {
  const c = load(['Config.gs', 'Pipeline.gs']);
  const calls = { ocr: 0, index: 0 };
  c.estPannePlateforme_ = () => true;
  c.indexContient_ = () => false;
  c.journalInfo_ = () => {};
  c.extraireTexte_ = () => { calls.ocr++; return ''; };
  c.indexAjouter_ = () => { calls.index++; };
  c.traiterDocument_({ cle: 'drive|X', nom: 'doc.pdf', taille: 10, blob: () => ({}), placer: () => 'X' });
  assert.deepStrictEqual(calls, { ocr: 0, index: 0 });
});

/* ---------- canal d'alerte : DriveAI_EMAIL, jamais un plantage ---------- */

function ctxAlerte(props, sessionOk) {
  const c = load(['Config.gs', 'Journal.gs']);
  const calls = { mails: [], journaux: [] };
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) };
  c.Session = {
    getEffectiveUser: () => {
      if (!sessionOk) throw new Error('Specified permissions are not sufficient');
      return { getEmail: () => 'session@exemple.com' };
    },
    getScriptTimeZone: () => 'UTC',
  };
  c.MailApp = { sendEmail: (dest, sujet) => calls.mails.push({ dest, sujet }) };
  c.feuille_ = () => ({ appendRow: (l) => calls.journaux.push(l[3] || ''), getLastRow: () => 1 });
  return { c, calls };
}

test('emailAlerte_ : la Script Property DriveAI_EMAIL prime ; sans elle ni scope Session → \'\'', () => {
  assert.strictEqual(ctxAlerte({ DriveAI_EMAIL: 'marc@exemple.com' }, false).c.emailAlerte_(), 'marc@exemple.com');
  assert.strictEqual(ctxAlerte({}, true).c.emailAlerte_(), 'session@exemple.com'); // repli si le scope existe
  assert.strictEqual(ctxAlerte({}, false).c.emailAlerte_(), ''); // l'état RÉEL du manifeste (pas de scope)
});

test('notifierEchec_ : sans destinataire → PAS de plantage, trace « pose DriveAI_EMAIL » au Journal', () => {
  const { c, calls } = ctxAlerte({}, false);
  c.notifierEchec_('Test', 'boom');
  assert.deepStrictEqual(calls.mails, []);
  assert.ok(calls.journaux.some((m) => String(m).includes('DriveAI_EMAIL')));
});

test('notifierEchec_ : avec DriveAI_EMAIL posée → le mail part vers cette adresse', () => {
  const { c, calls } = ctxAlerte({ DriveAI_EMAIL: 'marc@exemple.com' }, false);
  c.notifierEchec_('Test', 'boom');
  assert.strictEqual(calls.mails.length, 1);
  assert.strictEqual(calls.mails[0].dest, 'marc@exemple.com');
});
