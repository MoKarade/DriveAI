'use strict';
/**
 * 2ᵉ PASSE CONDITIONNELLE (Vague 3c) — gate PUR `passe1SuffisammentSure_` + branchement dans
 * `classifierDeuxPasses_`. Le flag `ANALYSE_V2_2E_PASSE_CONDITIONNELLE` est ÉTEINT par défaut (à
 * valider sur du réel avant allumage, §8) : ce test verrouille (a) le gate conservateur — SENSIBLE /
 * identité / non-doc / confiance basse / faits manquants ⇒ 2 passes ; (b) le respect du flag.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// `passe1SuffisammentSure_` (Llm.gs) appelle `estRenseigne_` (Router.gs) → charger les deux.
const ctx = load(['Config.gs', 'Router.gs', 'Llm.gs'], { tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n) });

// Une passe 1 « idéale » (sûre + complète + non sensible) : le SEUL cas qui autorise à sauter la passe 2.
const P1_SURE = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', confiance: 0.95, sensible: false };

test('passe1SuffisammentSure_ : passe 1 sûre + complète + non sensible → true (peut sauter la passe 2)', () => {
  assert.strictEqual(ctx.passe1SuffisammentSure_(P1_SURE), true);
});

test('passe1SuffisammentSure_ : garde §2 — un doc SENSIBLE (immigration/fiscal) refuse TOUJOURS de sauter', () => {
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { sensible: true })), false);
});

test('passe1SuffisammentSure_ : non-document et pièce d\'identité → toujours 2 passes (cas à arbitrage)', () => {
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { estNonDocument: true })), false);
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { estDocumentIdentite: true })), false);
});

test('passe1SuffisammentSure_ : confiance absente ou < seuil → 2 passes', () => {
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { confiance: undefined })), false);
  const sousSeuil = ctx.CONFIG.ANALYSE_V2_SEUIL_1PASSE - 0.01;
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { confiance: sousSeuil })), false);
  // Juste au seuil → autorisé (cas dérivé de la CONSTANTE, jamais de sa valeur du jour).
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { confiance: ctx.CONFIG.ANALYSE_V2_SEUIL_1PASSE })), true);
});

test('passe1SuffisammentSure_ : un fait clé manquant → 2 passes (domaine, type, ou tout émetteur/titulaire/descripteur)', () => {
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { domaine: null })), false);
  assert.strictEqual(ctx.passe1SuffisammentSure_(Object.assign({}, P1_SURE, { type_doc: null })), false);
  // Ni émetteur, ni titulaire, ni descripteur → incomplet.
  assert.strictEqual(ctx.passe1SuffisammentSure_({ domaine: '02 · Finances', type_doc: 'Relevé', confiance: 0.95 }), false);
  // Mais un descripteur seul (ni émetteur ni titulaire) suffit à compléter.
  assert.strictEqual(ctx.passe1SuffisammentSure_({ domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', confiance: 0.95 }), true);
  // Sentinelle « Inconnu » comptée comme ABSENTE (estRenseigne_).
  assert.strictEqual(ctx.passe1SuffisammentSure_({ domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Inconnu', confiance: 0.95 }), false);
});

test('classifierDeuxPasses_ : flag ÉTEINT (défaut) → TOUJOURS 2 passes, même si la passe 1 est sûre', () => {
  const c = load(['Config.gs', 'Router.gs', 'Llm.gs']);
  let appels = 0;
  c.appelAnthropicV2_ = () => { appels++; return P1_SURE; };
  assert.strictEqual(c.CONFIG.ANALYSE_V2_2E_PASSE_CONDITIONNELLE, false, 'flag éteint par défaut (§8, à valider avant allumage)');
  c.classifierDeuxPasses_({ nomFichier: 'x.pdf' });
  assert.strictEqual(appels, 2, 'flag OFF → passe 1 + passe 2, toujours');
});

test('classifierDeuxPasses_ : flag ALLUMÉ + passe 1 sûre → 1 passe ; passe 1 sensible → 2 passes (garde tenue)', () => {
  const c = load(['Config.gs', 'Router.gs', 'Llm.gs']);
  c.CONFIG.ANALYSE_V2_2E_PASSE_CONDITIONNELLE = true; // forcé DANS le test (jamais un invariant : le flag prod reste OFF)

  let appels = 0;
  c.appelAnthropicV2_ = () => { appels++; return P1_SURE; };
  c.classifierDeuxPasses_({ nomFichier: 'x.pdf' });
  assert.strictEqual(appels, 1, 'flag ON + passe 1 sûre → passe 2 sautée');

  appels = 0;
  c.appelAnthropicV2_ = () => { appels++; return Object.assign({}, P1_SURE, { sensible: true }); };
  c.classifierDeuxPasses_({ nomFichier: 'y.pdf' });
  assert.strictEqual(appels, 2, 'flag ON mais doc SENSIBLE → 2 passes (garde §2 jamais sautée)');
});
