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

/* ---------- Tri & intentions à la demande (C28-16) ---------- */

test('validerDemandeTri_ : fenêtre ∈ {1,7,30}, archiver booléen, plafond entier borné par la CONSTANTE — tout le reste → null', () => {
  const MAX = ctx.CONFIG.TRI_DEMANDE_PLAFOND_MAX;
  assert.deepStrictEqual(plat(ctx.validerDemandeTri_({ fenetre: 7, archiver: true, plafond: 100 })),
    { fenetre: 7, archiver: true, plafond: 100 });
  assert.deepStrictEqual(plat(ctx.validerDemandeTri_({ fenetre: '30', archiver: false, plafond: MAX })),
    { fenetre: 30, archiver: false, plafond: MAX }); // fenêtre numérique-chaîne tolérée (Number)
  assert.strictEqual(ctx.validerDemandeTri_({ fenetre: 2, archiver: true, plafond: 10 }), null);   // fenêtre hors liste
  assert.strictEqual(ctx.validerDemandeTri_({ fenetre: 7, archiver: 'oui', plafond: 10 }), null);  // archiver non booléen
  assert.strictEqual(ctx.validerDemandeTri_({ fenetre: 7, archiver: true, plafond: 0 }), null);    // plafond < 1
  assert.strictEqual(ctx.validerDemandeTri_({ fenetre: 7, archiver: true, plafond: MAX + 1 }), null); // > constante
  assert.strictEqual(ctx.validerDemandeTri_({ fenetre: 7, archiver: true, plafond: 2.5 }), null);  // non entier
  assert.strictEqual(ctx.validerDemandeTri_(null), null);
  assert.strictEqual(ctx.validerDemandeTri_('fenetre=7'), null);
});

function ctxDemande(sondeOk) {
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = {};
  const journaux = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.journalInfo_ = (s, m) => journaux.push(m);
  c.forcerSondeQuotaGmail_ = () => sondeOk;
  c.actionTickPonctuel_ = () => ({ ok: true, message: 'passage lancé' });
  return { c, props, journaux };
}

test('actionDemandeTri_ : quota mort (sonde forcée en échec) → { ok:false, erreur:QUOTA_GMAIL }, AUCUNE demande posée', () => {
  const { c, props } = ctxDemande(false);
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ fenetre: 7, archiver: true, plafond: 50 }) } });
  assert.deepStrictEqual(plat(r), { ok: false, erreur: 'QUOTA_GMAIL' });
  assert.ok(!('DriveAI_TRI_DEMANDE' in props));
});

test('actionDemandeTri_ : demande valide → Property posée, progression d\'une ancienne demande PURGÉE, tick ponctuel lancé', () => {
  const { c, props } = ctxDemande(true);
  props['DriveAI_TRI_DEMANDE_OFFSET'] = '40'; // reliquat d'une demande précédente
  props['DriveAI_TRI_DEMANDE_FAITS'] = '12';
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ fenetre: 1, archiver: false, plafond: 20 }) } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(JSON.parse(props['DriveAI_TRI_DEMANDE']), { fenetre: 1, archiver: false, plafond: 20 });
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in props), 'offset de l\'ancienne demande purgé');
  assert.ok(!('DriveAI_TRI_DEMANDE_FAITS' in props));
});

test('actionDemandeTri_ : paramètres invalides → refus AVANT la sonde quota (une demande cassée ne coûte rien)', () => {
  const { c, props } = ctxDemande(false); // la sonde échouerait — elle ne doit pas être atteinte
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ fenetre: 3, archiver: true, plafond: 10 }) } });
  assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.erreur, 'QUOTA_GMAIL'); // c'est bien la VALIDATION qui a refusé
  assert.ok(!('DriveAI_TRI_DEMANDE' in props));
});

test('actionDemandeIntentions_ : demande posée + offset purgé ; quota mort → QUOTA_GMAIL sans demande', () => {
  const ok = ctxDemande(true);
  ok.props['DriveAI_INTENTIONS_DEMANDE_OFFSET'] = '60';
  const r1 = ok.c.actionDemandeIntentions_({});
  assert.strictEqual(r1.ok, true);
  assert.ok('DriveAI_INTENTIONS_DEMANDE' in ok.props);
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE_OFFSET' in ok.props));

  const ko = ctxDemande(false);
  const r2 = ko.c.actionDemandeIntentions_({});
  assert.deepStrictEqual(plat(r2), { ok: false, erreur: 'QUOTA_GMAIL' });
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE' in ko.props));
});
