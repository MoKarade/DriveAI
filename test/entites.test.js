'use strict';
/**
 * Entités & sous-dossiers par type.
 *  - `normaliserCle_` (Entites.gs) : matching insensible casse/accents/espaces.
 *  - `sousDossierPourType_` (Router.gs) : type_doc → sous-dossier d'entité, MAIS seulement s'il
 *    appartient au schéma FIXE du type d'entité (garde-fou « pas de dossier hors schéma »).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);

test('normaliserCle_ : minuscules, sans accents, espaces compactés', () => {
  assert.strictEqual(ctx.normaliserCle_('Éléctricité De France'), 'electricite de france');
  assert.strictEqual(ctx.normaliserCle_('  IRCC  '), 'ircc');
  assert.strictEqual(ctx.normaliserCle_('Desjardins\t\n  Banque'), 'desjardins banque');
  assert.strictEqual(ctx.normaliserCle_(null), '');
});

test('normaliserCle_ : apostrophes (droite ET typographique U+2019) → espace, matching uniforme', () => {
  assert.strictEqual(ctx.normaliserCle_('Avis d’imposition'), 'avis d imposition'); // U+2019
  assert.strictEqual(ctx.normaliserCle_("Avis d'imposition"), 'avis d imposition');  // U+0027
  assert.strictEqual(ctx.normaliserCle_('l’IUT'), 'l iut');
});

test('cleEntite_ : domaine|entité normalisés (évite les collisions inter-domaines)', () => {
  assert.strictEqual(ctx.cleEntite_('05 · Carrière', 'IUT ULCO'), ctx.normaliserCle_('05 · Carrière') + '|' + 'iut ulco');
});

test('sousDossierPourType_ : type mappé ET présent au schéma → le sous-dossier', () => {
  assert.strictEqual(ctx.sousDossierPourType_('Facture', 'Logement'), 'Factures');
  assert.strictEqual(ctx.sousDossierPourType_('Relevé', 'Compte financier'), 'Relevés');
  assert.strictEqual(ctx.sousDossierPourType_('Bail', 'Logement'), 'Bail & contrat');
});

test('sousDossierPourType_ : mapping insensible à la casse/aux accents', () => {
  assert.strictEqual(ctx.sousDossierPourType_('FACTURE', 'Logement'), 'Factures');
  assert.strictEqual(ctx.sousDossierPourType_('relevé', 'Compte financier'), 'Relevés');
});

test('sousDossierPourType_ : type mappé mais HORS schéma du type d\'entité → null (garde-fou)', () => {
  // « Relevé » → « Relevés », mais « Relevés » n\'est pas dans le schéma « Logement ».
  assert.strictEqual(ctx.sousDossierPourType_('Relevé', 'Logement'), null);
});

test('sousDossierPourType_ : type inconnu → null (racine d\'entité, pas de dossier inventé)', () => {
  assert.strictEqual(ctx.sousDossierPourType_('Truc bizarre', 'Logement'), null);
  assert.strictEqual(ctx.sousDossierPourType_('Facture', 'Type inexistant'), null);
});

test('correctionValideUneEntite_ (C6-04) : entité + domaine requis pour valider une entité', () => {
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'EDF', domaine: '03 · Logement & véhicule' }), true);
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'EDF', domaine: '' }), false); // domaine manquant → pas de routage
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: '', domaine: '02 · Finances' }), false);
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: '   ', domaine: '02 · Finances' }), false); // trim
  assert.strictEqual(ctx.correctionValideUneEntite_({ entite: 'EDF' }), false); // domaine absent
  assert.strictEqual(ctx.correctionValideUneEntite_(null), false);
});
