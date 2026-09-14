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

test('entitesValideesParCle_ / entitesValideesOuNull_ : même carte, deux réponses à « la lecture a-t-elle abouti ? »', () => {
  // C28-93 : le routage doit continuer à recevoir la carte PARTIELLE construite avant l'exception
  // (dégradation réversible : le document part à plat, le run suivant le reprend), tandis que les
  // consommateurs qui écrivent du DÉFINITIF — une proposition de corbeille — ont besoin de savoir
  // que la lecture a échoué. Mutation : faire rendre `{}` à `entitesValideesParCle_` sur exception
  // (ce qu'une première écriture faisait) ⇒ l'assertion « partielle » tombe.
  const c = load(['Config.gs', 'Entites.gs']);
  const lignes = [
    { entite: 'Robovic', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID1' },
    { entite: 'POISON', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID2' },
    { entite: 'Jamais lue', domaine: '05 · Carrière', statut: 'validee', dossierId: 'ID3' },
  ];
  c.entitesCache_ = () => ({ lignes: lignes, parCle: {} });
  c.estValidee_ = () => true;
  c.journalErreur_ = () => {};
  const vrai = c.cleCanoniqueEntite_;
  c.cleCanoniqueEntite_ = (d, e) => { if (e === 'POISON') throw new Error('libellé pathologique'); return vrai(d, e); };

  const partielle = c.entitesValideesParCle_();
  assert.strictEqual(Object.keys(partielle).length, 1, 'ce qui a été lu AVANT l\'exception reste utilisable');
  assert.strictEqual(c.entitesValideesOuNull_(), null, 'mais la lecture n\'a PAS abouti, et ça se dit');

  // Cas nominal : les deux rendent la même chose.
  c.cleCanoniqueEntite_ = vrai;
  assert.strictEqual(Object.keys(c.entitesValideesParCle_()).length, 3);
  assert.strictEqual(Object.keys(c.entitesValideesOuNull_()).length, 3);
});
