'use strict';
/**
 * Recherche IA du doPost (C21-03) — les deux fonctions PURES qui encadrent le LLM :
 * `validerQuestionIA_` (donnée UTILISATEUR via HTTP) et `parserPlanIA_` (sortie LLM = donnée
 * non fiable : whitelist stricte, types forcés, domaine borné à la taxonomie, plan vide rejeté).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'WebApp.gs']);
const DOMAINES = ['02 · Finances', '03 · Logement & véhicule', '04 · Immigration'];

// Les objets nés dans le contexte vm ont d'autres prototypes → normalisés avant deepStrictEqual.
const plat = (o) => JSON.parse(JSON.stringify(o));

test('validerQuestionIA_ : chaîne 3..300, espaces compactés, tout le reste → null', () => {
  assert.strictEqual(ctx.validerQuestionIA_('  les factures   Hydro  '), 'les factures Hydro');
  assert.strictEqual(ctx.validerQuestionIA_('ab'), null);              // trop court
  assert.strictEqual(ctx.validerQuestionIA_('x'.repeat(301)), null);   // trop long
  assert.strictEqual(ctx.validerQuestionIA_(42), null);                // pas une chaîne
  assert.strictEqual(ctx.validerQuestionIA_(null), null);
  assert.strictEqual(ctx.validerQuestionIA_(undefined), null);
  assert.strictEqual(ctx.validerQuestionIA_({ question: 'x' }), null); // objet
});

test('parserPlanIA_ : JSON strict accepté, champs whitelistés et bornés', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    texte: ' hydro ',
    domaine: '02 · Finances',
    annee: '2024',
    motsCles: ['facture', 'électricité'],
    explication: 'Factures Hydro-Québec de 2024.',
    champInconnu: 'jeté',
  }), DOMAINES);
  assert.deepStrictEqual(plat(plan), {
    texte: 'hydro',
    domaine: '02 · Finances',
    annee: '2024',
    motsCles: ['facture', 'électricité'],
    explication: 'Factures Hydro-Québec de 2024.',
  });
});

test('parserPlanIA_ : JSON enrobé de texte (bavardage LLM) → extrait le 1er objet', () => {
  const plan = ctx.parserPlanIA_('Voici le plan :\n{"motsCles": ["bail"]}\nVoilà.', DOMAINES);
  assert.deepStrictEqual(plat(plan.motsCles), ['bail']);
});

test('parserPlanIA_ : domaine HORS taxonomie jeté, année non-AAAA jetée, types non-chaîne jetés', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    domaine: '99 · Inventé',
    annee: 'l’an dernier',
    texte: 12,
    motsCles: ['ok', 7, '', ' aussi '],
  }), DOMAINES);
  assert.strictEqual(plan.domaine, undefined);
  assert.strictEqual(plan.annee, undefined);
  assert.strictEqual(plan.texte, undefined);
  assert.deepStrictEqual(plat(plan.motsCles), ['ok', 'aussi']); // non-chaînes et vides filtrés
});

test('parserPlanIA_ : motsCles plafonnés à 5, valeurs tronquées', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    motsCles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    texte: 'x'.repeat(500),
  }), DOMAINES);
  assert.strictEqual(plan.motsCles.length, 5);
  assert.strictEqual(plan.texte.length, 100);
});

test('parserPlanIA_ : bloc markdown ```json … ``` → extrait quand même l’objet', () => {
  const plan = ctx.parserPlanIA_('```json\n{"motsCles": ["bail"]}\n```', DOMAINES);
  assert.deepStrictEqual(plat(plan.motsCles), ['bail']);
});

test('parserPlanIA_ : DEUX objets JSON dans la sortie → repli null (regex gourmande, comportement figé)', () => {
  assert.strictEqual(ctx.parserPlanIA_('{"motsCles":["a"]} puis {"motsCles":["b"]}', DOMAINES), null);
});

test('parserPlanIA_ : illisible ou VIDE → null (jamais un plan fantôme)', () => {
  assert.strictEqual(ctx.parserPlanIA_(null, DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('', DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('pas de JSON ici', DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('[1,2]', DOMAINES), null); // pas un objet exploitable
  // Tous les champs invalides ⇒ plan vide ⇒ null (l'app ne doit rien exécuter).
  assert.strictEqual(ctx.parserPlanIA_(JSON.stringify({ domaine: 'inconnu', motsCles: [] }), DOMAINES), null);
});
