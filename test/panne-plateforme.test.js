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

/* ---------- R2 : panne PERSISTÉE entre les runs, sources suspendues, re-sonde bornée ---------- */

function ctxPersistance(props) {
  const c = load(['Config.gs', 'Llm.gs']);
  const calls = { props: { ...props }, journaux: [] };
  c.journalErreur_ = (s2, m) => calls.journaux.push('ERR:' + m);
  c.journalInfo_ = (s2, m) => calls.journaux.push(m);
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => calls.props[k] ?? null,
      setProperty: (k, v) => { calls.props[k] = v; },
      deleteProperty: (k) => { delete calls.props[k]; },
    }),
  };
  return { c, calls };
}

test('chargerPannePlateforme_ : panne FRAÎCHE persistée → run suspendu ; fenêtre écoulée → run de re-sonde', () => {
  const fraiche = ctxPersistance({ DriveAI_LLM_PANNE: String(Date.now() - 5 * 60 * 1000) });
  fraiche.c.chargerPannePlateforme_();
  assert.strictEqual(fraiche.c.estPannePlateforme_(), true);   // < 1 h → suspendu

  const vieille = ctxPersistance({ DriveAI_LLM_PANNE: String(Date.now() - 2 * 60 * 60 * 1000) });
  vieille.c.chargerPannePlateforme_();
  assert.strictEqual(vieille.c.estPannePlateforme_(), false);  // ≥ 1 h → re-sonde (run normal)
  assert.ok(vieille.calls.props.DriveAI_LLM_PANNE);            // la Property reste : c'est l'APPEL qui tranche

  const sans = ctxPersistance({});
  sans.c.chargerPannePlateforme_();
  assert.strictEqual(sans.c.estPannePlateforme_(), false);
});

test('signalerPannePlateforme_ : pose la Property (les ticks suivants suspendront leurs sources)', () => {
  const { c, calls } = ctxPersistance({});
  c.chargerPannePlateforme_();
  c.signalerPannePlateforme_(400, 'Your credit balance is too low', 'claude-haiku-4-5');
  assert.ok(Number(calls.props.DriveAI_LLM_PANNE) > 0);
});

test('signalerRetablissement_ : un appel 200 efface la panne persistée et le journalise (une fois par run)', () => {
  const { c, calls } = ctxPersistance({ DriveAI_LLM_PANNE: String(Date.now() - 2 * 60 * 60 * 1000) });
  c.chargerPannePlateforme_(); // fenêtre écoulée → run de re-sonde
  c.exemplesFewShot_ = () => '';
  c.getCleAnthropic_ = () => 'k';
  c.enregistrerUsage_ = () => {};
  c.tronquer_ = (t) => t;
  c.UrlFetchApp = { fetch: () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ content: [{ type: 'text', text: '{"domaine":"02 · Finances","confiance":0.9,"sensible":false}' }] }),
  }) };
  c.appelAnthropic_('claude-haiku-4-5', { nomFichier: 'a.pdf' });
  assert.strictEqual(calls.props.DriveAI_LLM_PANNE, undefined); // effacée
  assert.ok(calls.journaux.some((j) => j.includes('RÉTABLI')));
});

test('traiterIntentionsMail_ : panne active → AUCUNE recherche Gmail (le quota de lecture est préservé)', () => {
  const c = load(['Config.gs', 'Intentions.gs']);
  let recherches = 0;
  c.estPannePlateforme_ = () => true;
  c.pageFilsActions_ = () => { recherches++; return []; };
  c.GmailApp = { search: () => { recherches++; return []; } };
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) };
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.traiterIntentionsMail_(() => false);
  assert.strictEqual(recherches, 0);
});

test('traiterGmail_ : panne active → AUCUNE recherche Gmail', () => {
  const c = load(['Config.gs', 'Main.gs']);
  let recherches = 0;
  c.estPannePlateforme_ = () => true;
  c.pageFils_ = () => { recherches++; return []; };
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.traiterGmail_(() => false);
  assert.strictEqual(recherches, 0);
});

/* ---------- bruit : fichier Google natif signalé UNE fois ---------- */

test('signalerNatifUneFois_ : 1 ligne de Journal par FICHIER, pas par tick', () => {
  const c = load(['Config.gs', 'Intake.gs']);
  const props = {};
  const journaux = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = v; },
  }) };
  c.journalInfo_ = (s2, m) => journaux.push(m);
  c.signalerNatifUneFois_('F1', 'releves_combines');
  c.signalerNatifUneFois_('F1', 'releves_combines'); // tick suivant
  c.signalerNatifUneFois_('F2', 'autre_natif');
  assert.strictEqual(journaux.length, 2); // F1 une fois + F2 une fois
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

test('notifierEchec_ : JAMAIS de mail immédiat (décision Marc 2026-07-06) — journal seul, même avec DriveAI_EMAIL', () => {
  const avec = ctxAlerte({ DriveAI_EMAIL: 'marc@exemple.com' }, false);
  avec.c.notifierEchec_('Test', 'boom');
  assert.deepStrictEqual(avec.calls.mails, []); // tout se découvre au résumé hebdo
  assert.ok(avec.calls.journaux.some((m) => String(m).includes('boom')));
  const sans = ctxAlerte({}, false);
  sans.c.notifierEchec_('Test', 'boom'); // et jamais de plantage sans destinataire
  assert.deepStrictEqual(sans.calls.mails, []);
});

test('emailAlerte_ reste utilisée par le RÉSUMÉ HEBDO (seul mail restant du moteur)', () => {
  const { c } = ctxAlerte({ DriveAI_EMAIL: 'marc@exemple.com' }, false);
  assert.strictEqual(c.emailAlerte_(), 'marc@exemple.com');
});
