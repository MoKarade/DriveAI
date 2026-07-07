'use strict';
/**
 * ANALYSE V2 (refonte #26, C26-05) — parser du schéma étendu + contenu des prompts 2 passes.
 * `normaliserChampsV2_` durcit les champs v2 QUAND ils sont présents, et laisse une réponse Haiku
 * classique INTACTE (le chemin OFF ne change pas). Les prompts PASSE1/PASSE2 portent les 9 domaines
 * et les règles relevées de Marc (zéro « Inconnu », sous-dossier obligatoire). Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Llm.gs']);

/* ---------- normaliserChampsV2_ : intact sur Haiku, durci sur v2 ---------- */

test('normaliserChampsV2_ : une réponse Haiku classique (aucun champ v2) est renvoyée INTACTE', () => {
  const haiku = { domaine: '02 · Finances', categorie: null, entite: 'Desjardins', type_doc: 'Relevé',
    date_doc: '2026-03-01', emetteur: 'Desjardins', sensible: false, confiance: 0.9 };
  const avant = JSON.parse(JSON.stringify(haiku));
  assert.deepStrictEqual(ctx.normaliserChampsV2_(haiku), avant); // aucune clé ajoutée/retirée
});

test('normaliserChampsV2_ : booléens durcis (non-booléen → false)', () => {
  const o = ctx.normaliserChampsV2_({ domaine: '01 · Administratif & identité', confiance: 0.5,
    estNonDocument: 'true', estDocumentIdentite: 1 });
  assert.strictEqual(o.estNonDocument, false);   // 'true' (chaîne) n'est pas true
  assert.strictEqual(o.estDocumentIdentite, false);
});

test('normaliserChampsV2_ : routageHorsDomaine borné à _Technique/_Médias, sinon null', () => {
  assert.strictEqual(ctx.normaliserChampsV2_({ estNonDocument: true, routageHorsDomaine: '_Technique' }).routageHorsDomaine, '_Technique');
  assert.strictEqual(ctx.normaliserChampsV2_({ estNonDocument: true, routageHorsDomaine: '_Médias' }).routageHorsDomaine, '_Médias');
  assert.strictEqual(ctx.normaliserChampsV2_({ estNonDocument: true, routageHorsDomaine: '04 · Immigration' }).routageHorsDomaine, null);
});

test('normaliserChampsV2_ : chaînes v2 trimées ; vide/null → clé retirée (les fonctions aval testent la présence)', () => {
  const o = ctx.normaliserChampsV2_({ domaine: '01 · Administratif & identité', confiance: 0.5,
    titulaire: '  Marc Richard  ', sousDossier: '   ', descripteur: null, sousDossierType: 'Passeport' });
  assert.strictEqual(o.titulaire, 'Marc Richard');
  assert.ok(!('sousDossier' in o), 'sousDossier vide doit être retiré');
  assert.ok(!('descripteur' in o), 'descripteur null doit être retiré');
  assert.strictEqual(o.sousDossierType, 'Passeport');
});

test('normaliserChampsV2_ : null/undefined ne plante pas', () => {
  assert.strictEqual(ctx.normaliserChampsV2_(null), null);
});

/* ---------- Prompts 2 passes : portent les 9 domaines + les règles v2 ---------- */

test('PROMPT_PASSE1 : porte les 9 domaines autorisés et les champs clés du schéma v2', () => {
  const p = ctx.PROMPT_PASSE1;
  ctx.domainesAutorises_().forEach((d) => assert.ok(p.indexOf(d) !== -1, 'domaine manquant du prompt : ' + d));
  ['estNonDocument', 'estDocumentIdentite', 'sousDossierType', 'titulaire', 'sousDossier', 'descripteur', 'emetteur']
    .forEach((champ) => assert.ok(p.indexOf(champ) !== -1, 'champ manquant du prompt : ' + champ));
  assert.ok(/Inconnu/.test(p), 'la règle « jamais Inconnu » doit être dans le prompt');
});

test('PROMPT_PASSE2 : vérificateur adversarial avec anti-régression et les deux exigences v2', () => {
  const p = ctx.PROMPT_PASSE2;
  assert.ok(/ADVERSARIAL|VÉRIFICATEUR/.test(p));
  assert.ok(/ANTI-RÉGRESSION/.test(p));
  assert.ok(p.indexOf('descripteur') !== -1 && p.indexOf('sousDossier') !== -1);
  ctx.domainesAutorises_().forEach((d) => assert.ok(p.indexOf(d) !== -1, 'domaine manquant du prompt 2 : ' + d));
});

test('CONFIG : le flag ANALYSE_V2 est ÉTEINT par défaut (pas de Sonnet sur le flux vivant sans feu vert)', () => {
  assert.strictEqual(ctx.CONFIG.ANALYSE_V2, false);
});
