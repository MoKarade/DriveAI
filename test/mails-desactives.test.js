'use strict';
/**
 * C28-75 (décision Marc 2026-09-07) — plus AUCUN mail du moteur.
 *
 * Ce que ces tests verrouillent :
 *  - `resumeHebdo` n'envoie rien (ni ne calcule rien) quand `CONFIG.MAILS_ACTIFS` est faux ;
 *  - `assurerTriggerResume_` RETIRE un déclencheur `resumeHebdo` existant quand les mails sont
 *    coupés — c'est la moitié qui compte : sans elle, un déclencheur déjà posé continuait de
 *    partir chaque lundi, et le tick le réinstallait derrière Marc ;
 *  - le comportement d'origine (création idempotente, envoi) reste intact quand le flag est vrai ;
 *  - `MailApp.sendEmail` n'existe QUE dans Resume.gs, derrière ce flag (tripwire de surface).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

/* ---------- resumeHebdo ---------- */

function ctxResume(mailsActifs) {
  const c = load(['Config.gs', 'Resume.gs']);
  c.CONFIG.MAILS_ACTIFS = mailsActifs;
  const calls = { mails: [], infos: [], calculs: 0 };
  c.journalInfo_ = (s, m) => calls.infos.push(m);
  c.notifierEchec_ = (s, m) => calls.infos.push('ECHEC:' + m);
  c.MailApp = { sendEmail: (dest, sujet) => calls.mails.push({ dest, sujet }) };
  // Tout le calcul du résumé est mocké et COMPTÉ : un résumé coupé ne doit rien lire.
  const compte = (v) => () => { calls.calculs++; return v; };
  c.statsSemaine_ = compte({});
  c.erreursSemaine_ = compte([]);
  c.syntheseCoutMois_ = compte({ dollars: 0, appels: 0 });
  c.newslettersJamaisLues_ = compte([]);
  c.apprentissagesSemaine_ = compte(null);
  c.etatSysteme_ = compte('ok');
  c.urlFormulaireCorrection_ = compte('');
  c.construireResume_ = compte('corps');
  c.emailAlerte_ = () => 'marc@exemple.com';
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => '0' }) };
  return { c, calls };
}

test('resumeHebdo : mails COUPÉS → aucun envoi, aucun calcul, une ligne de journal (déclencheur résiduel inoffensif)', () => {
  const { c, calls } = ctxResume(false);
  c.resumeHebdo();
  assert.deepStrictEqual(calls.mails, [], 'rien n\'est envoyé');
  assert.strictEqual(calls.calculs, 0, 'et rien n\'est calculé (un déclencheur résiduel ne coûte rien)');
  assert.ok(calls.infos.some((m) => /MAILS_ACTIFS/.test(m)), 'le pourquoi est journalisé');
});

test('resumeHebdo : mails ACTIFS → envoi (non-régression du comportement d\'origine)', () => {
  const { c, calls } = ctxResume(true);
  c.resumeHebdo();
  assert.strictEqual(calls.mails.length, 1);
  assert.strictEqual(calls.mails[0].dest, 'marc@exemple.com');
  assert.ok(calls.calculs > 0);
});

test('CONFIG.MAILS_ACTIFS vaut FAUX (tripwire de VALEUR — décision Marc 2026-09-07, pas un défaut)', () => {
  const c = load(['Config.gs']);
  assert.strictEqual(c.CONFIG.MAILS_ACTIFS, false);
});

/* ---------- assurerTriggerResume_ ---------- */

function ctxTriggers(mailsActifs, existants) {
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  c.CONFIG.MAILS_ACTIFS = mailsActifs;
  const calls = { supprimes: [], crees: [], infos: [] };
  const triggers = (existants || []).map((h) => ({ getHandlerFunction: () => h, __h: h }));
  c.journalInfo_ = (s, m) => calls.infos.push(m);
  c.ScriptApp = {
    WeekDay: { MONDAY: 'MONDAY' },
    getProjectTriggers: () => triggers,
    deleteTrigger: (t) => calls.supprimes.push(t.__h),
    newTrigger: (h) => ({ timeBased: () => ({ onWeekDay: () => ({ atHour: () => ({ create: () => calls.crees.push(h) }) }) }) }),
  };
  return { c, calls };
}

test('assurerTriggerResume_ : mails COUPÉS → le déclencheur existant est RETIRÉ, aucun n\'est créé', () => {
  const { c, calls } = ctxTriggers(false, ['tickDriveAI', 'resumeHebdo', 'chienDeGarde']);
  c.assurerTriggerResume_();
  assert.deepStrictEqual(calls.supprimes, ['resumeHebdo'], 'SEUL le résumé est retiré — jamais le tick ni le chien de garde');
  assert.deepStrictEqual(calls.crees, []);
  assert.ok(calls.infos.some((m) => /RETIRÉ/.test(m)));
});

test('assurerTriggerResume_ : mails COUPÉS et rien à retirer → idempotent, zéro écriture, zéro journal', () => {
  const { c, calls } = ctxTriggers(false, ['tickDriveAI']);
  c.assurerTriggerResume_();
  assert.deepStrictEqual(calls.supprimes, []);
  assert.deepStrictEqual(calls.crees, []);
  assert.deepStrictEqual(calls.infos, [], 'appelé à CHAQUE tick : ne rien journaliser en régime');
});

test('assurerTriggerResume_ : mails ACTIFS → comportement d\'origine (crée si absent, rien si présent)', () => {
  const absent = ctxTriggers(true, ['tickDriveAI']);
  absent.c.assurerTriggerResume_();
  assert.deepStrictEqual(absent.calls.crees, ['resumeHebdo']);
  assert.deepStrictEqual(absent.calls.supprimes, []);
  const present = ctxTriggers(true, ['tickDriveAI', 'resumeHebdo']);
  present.c.assurerTriggerResume_();
  assert.deepStrictEqual(present.calls.crees, [], 'idempotent');
  assert.deepStrictEqual(present.calls.supprimes, []);
});

/* ---------- surface : un seul point d'envoi, gardé par le flag ---------- */

test('surface : `MailApp.sendEmail` n\'existe que dans Resume.gs, et Resume.gs teste CONFIG.MAILS_ACTIFS avant', () => {
  const src = path.join(__dirname, '..', 'src');
  const envois = [];
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.gs'))) {
    const t = fs.readFileSync(path.join(src, f), 'utf8');
    if (/MailApp\.sendEmail|GmailApp\.sendEmail|createDraft\(/.test(t)) envois.push(f);
  }
  assert.deepStrictEqual(envois, ['Resume.gs'], 'tout nouveau point d\'envoi doit passer par le même flag (revue)');
  const resume = fs.readFileSync(path.join(src, 'Resume.gs'), 'utf8');
  const iFlag = resume.indexOf('CONFIG.MAILS_ACTIFS');
  const iEnvoi = resume.indexOf('MailApp.sendEmail');
  assert.ok(iFlag > 0 && iFlag < iEnvoi, 'le flag est testé AVANT l\'envoi');
});
