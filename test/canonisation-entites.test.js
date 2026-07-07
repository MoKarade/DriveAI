'use strict';
/**
 * CANONICALISATION & FUSION D'ENTITÉS (refonte 2026-07-07) — né du désordre RÉEL observé dans le
 * Drive de Marc (285 entités) : lui-même ×4, des génériques, la même chose éclatée (« Ford Fiesta »
 * / « Ford Fiesta 2011 » / « Ford Fiesta SE 2011 » ; une adresse en 6 variantes ; « Desjardins » en
 * 5 ; « maTech Robotik » = OCR corrompu). Ces fonctions PURES ramènent chaque entité réelle à UNE
 * forme canonique, sans jamais fusionner deux entités DIFFÉRENTES (Ford ≠ Ford Fiesta, années/villes).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs']);

/* ---------- estProprietaireMarc_ : Marc n'est jamais l'entité d'un doc d'organisation ---------- */

test('estProprietaireMarc_ : reconnaît Marc sous ses variantes, rejette les autres', () => {
  for (const oui of ['Marc Alexis Claude Richard', 'Marc A. Richard', 'Richard, Marc', 'Marc RICHARD']) {
    assert.strictEqual(ctx.estProprietaireMarc_(oui), true, `« ${oui} » = Marc`);
  }
  // Rejetés : autres personnes, et « M. Richard »/« Baptiste Richard » (un autre Richard de la
  // famille ne doit PAS être confondu avec Marc — il reste une entité/titulaire légitime).
  for (const non of ['Sophie Tremblay', 'Richard Hydro', 'Marc Tremblay', 'M. Richard',
    'Baptiste Julien Patrick Richard', 'Desjardins', '']) {
    assert.strictEqual(ctx.estProprietaireMarc_(non), false, `« ${non} » ≠ Marc`);
  }
});

/* ---------- retirerSuffixeJuridique_ ---------- */

test('retirerSuffixeJuridique_ : retire un suffixe FINAL, jamais un « SA » interne', () => {
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Anthropic PBC'), 'Anthropic');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Desjardins Inc.'), 'Desjardins');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('ROBOVIC Inc'), 'ROBOVIC');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Air Transat'), 'Air Transat');
  assert.strictEqual(ctx.retirerSuffixeJuridique_('Sassone'), 'Sassone'); // ne mange pas un « SA » interne
});

/* ---------- canoniserVehicule_ : marque + modèle seuls ---------- */

test('canoniserVehicule_ : retire année et finition, garde marque + modèle', () => {
  assert.strictEqual(ctx.canoniserVehicule_('Ford Fiesta SE 2011'), 'Ford Fiesta');
  assert.strictEqual(ctx.canoniserVehicule_('Ford Fiesta 2011'), 'Ford Fiesta');
  assert.strictEqual(ctx.canoniserVehicule_('Honda Civic'), 'Honda Civic');
  assert.strictEqual(ctx.canoniserVehicule_('Ford'), 'Ford');
});

/* ---------- canoniserAdresse_ : les 6 variantes d'une adresse → une forme ---------- */

test('canoniserAdresse_ : réduit à « numéro voie, ville », retire compléments et code postal', () => {
  assert.strictEqual(ctx.canoniserAdresse_('3325 4e Avenue, App. 5, Québec G1J 3H3'), '3325 4e Avenue, Québec');
  assert.strictEqual(ctx.canoniserAdresse_('3325 4e Avenue, Québec G1J 3H3'), '3325 4e Avenue, Québec');
  assert.strictEqual(ctx.canoniserAdresse_('3325 4th Ave, Quebec'), '3325 4e Avenue, Quebec');
  assert.strictEqual(ctx.canoniserAdresse_('Desjardins'), 'Desjardins'); // pas une adresse → inchangé
});

/* ---------- corrigerOcrConnu_ ---------- */

test('corrigerOcrConnu_ : corrige une corruption connue, n\'invente jamais', () => {
  assert.strictEqual(ctx.corrigerOcrConnu_('maTech Robotik'), 'Automatech');
  assert.strictEqual(ctx.corrigerOcrConnu_('automatech robotik'), 'Automatech');
  assert.strictEqual(ctx.corrigerOcrConnu_('Desjardins'), 'Desjardins'); // absent de la table → inchangé
});

/* ---------- canoniserEntite_ : l'orchestrateur (le résultat visible) ---------- */

test('canoniserEntite_ : ramène chaque cas réel à sa forme canonique', () => {
  assert.strictEqual(ctx.canoniserEntite_('Ford Fiesta SE 2011'), 'Ford Fiesta');
  assert.strictEqual(ctx.canoniserEntite_('Desjardins Inc.'), 'Desjardins');
  assert.strictEqual(ctx.canoniserEntite_('maTech Robotik'), 'Automatech');
  assert.strictEqual(ctx.canoniserEntite_('  hydro   quebec '), 'Hydro Quebec');
  assert.strictEqual(ctx.canoniserEntite_('IRCC'), 'IRCC'); // acronyme préservé
});

test('canoniserEntite_ : rejette (null) les génériques et le propriétaire', () => {
  assert.strictEqual(ctx.canoniserEntite_('banque'), null);
  assert.strictEqual(ctx.canoniserEntite_('cours de physique'), null);
  assert.strictEqual(ctx.canoniserEntite_('Marc RICHARD'), null);
  assert.strictEqual(ctx.canoniserEntite_(''), null);
  assert.strictEqual(ctx.canoniserEntite_(null), null);
});

/* ---------- cleCanoniqueEntite_ : la clé de déduplication ---------- */

test('cleCanoniqueEntite_ : deux variantes de la même entité partagent la clé', () => {
  assert.strictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Fiesta 2011'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Fiesta SE 2011'));
  assert.strictEqual(
    ctx.cleCanoniqueEntite_('02 · Finances', 'Desjardins Inc.'),
    ctx.cleCanoniqueEntite_('02 · Finances', 'Desjardins'));
  assert.strictEqual(ctx.cleCanoniqueEntite_('02 · Finances', 'banque'), null); // générique → pas de clé
});

test('cleCanoniqueEntite_ : deux MODÈLES/marques différents ne collisionnent pas', () => {
  assert.notStrictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Fiesta'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Focus'));
  assert.notStrictEqual(
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Ford Fiesta'),
    ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Toyota Corolla'));
});

test('cleCanoniqueEntite_ : les variantes ANNÉE/FINITION d\'un même modèle fusionnent (choix : plainte Ford Fiesta)', () => {
  // Décision assumée : « Ford Fiesta »/« 2011 »/« SE 2011 » = UNE voiture. Corollaire documenté :
  // « Honda Civic 2014 » et « 2017 » fusionnent aussi au niveau modèle (Marc peut les re-séparer).
  const k = ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Honda Civic');
  assert.strictEqual(ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Honda Civic 2014'), k);
  assert.strictEqual(ctx.cleCanoniqueEntite_('03 · Logement & véhicule', 'Honda Civic 2017'), k);
});

/* ---------- estFusionnableEntite_ durci : Ford ≠ Ford Fiesta ---------- */

test('estFusionnableEntite_ durci : « Ford » (marque seule) NE fusionne PAS avec « Ford Fiesta » (modèle)', () => {
  assert.strictEqual(ctx.estFusionnableEntite_('Ford', 'Ford Fiesta'), false);
  assert.strictEqual(ctx.estFusionnableEntite_('Honda', 'Honda Civic'), false);
  // mais un complément GÉNÉRIQUE reste fusionnable (le cas Desjardins des tests existants)
  assert.strictEqual(ctx.estFusionnableEntite_('Desjardins', 'carte de crédit Desjardins'), true);
  assert.strictEqual(ctx.estFusionnableEntite_('banque Desjardins', 'Desjardins'), true);
  // et les adresses (≥2 jetons courts) ne sont pas visées par la garde
  assert.strictEqual(ctx.estFusionnableEntite_('3325 4e avenue', '3325 4e Avenue, App. 5, Québec'), true);
});
