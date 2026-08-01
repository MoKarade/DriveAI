'use strict';
/**
 * TRIPWIRE ADR-0033 — le flux vivant DÉLÈGUE son sous-chemin à la MÊME fonction pure que le Reset
 * (`cheminCibleReset_`), sur le nom FINAL. Ce test verrouille la convergence : pour tout document que
 * le Reset sait router (non-null), la sortie du flux (`planRoutageV2_`) est IDENTIQUE au chemin
 * thématique du Reset. Si quelqu'un modifie un côté sans l'autre (retire la délégation, change une
 * table), ce test casse — c'est la fin structurelle du « déplacer en boucle » flux↔reset.
 *
 * La convergence flux↔CONSOLIDATION est verrouillée séparément dans `consolidation.test.js` (les 3
 * consommateurs — flux, conso, reset — passent par la même règle).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Router.gs']);
const meta = (nom) => ({ nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' });

// Échantillon stratifié par domaine — des documents que le Reset route dans son arbre thématique.
const CAS = [
  { classif: { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins' }, date: '2026-03-15', ext: '.pdf' },
  { classif: { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Cleverbridge' }, date: '2026-01-10', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Paie', emetteur: 'Robovic' }, date: '2026-06-01', ext: '.pdf' },
  { classif: { domaine: '05 · Carrière', type_doc: 'Lettre de motivation', emetteur: 'Airbus' }, date: '2026-06-30', ext: '.docx' },
  { classif: { domaine: '01 · Administratif & identité', type_doc: 'Attestation', emetteur: 'CNAM' }, date: '2022-03-04', ext: '.pdf' },
  { classif: { estDocumentIdentite: true, sousDossierType: 'Permis de conduire', titulaire: 'Marc Richard' }, date: '2023-02-01', ext: '.pdf' },
];

test('TRIPWIRE flux vivant ↔ Reset (ADR-0033) : sous-chemin IDENTIQUE pour tout doc que le Reset route', () => {
  let couverts = 0;
  for (const cas of CAS) {
    const classif = Object.assign({ date_doc: cas.date }, cas.classif);
    const plan = ctx.planRoutageV2_(classif, meta('f' + cas.ext), cas.date, cas.ext, {});
    assert.strictEqual(plan.type, 'classé', JSON.stringify(plan));
    const rel = ctx.cheminCibleReset_(plan.domaine, plan.nom);
    if (rel) {
      couverts++;
      assert.strictEqual(plan.sousDossier, rel,
        'divergence flux↔reset pour ' + plan.nom + ' : flux="' + plan.sousDossier + '" vs reset="' + rel + '"');
      assert.strictEqual(plan.dossierIdCible, '', 'chemin thématique → jamais un ID d\'entité (le chemin EST la structure)');
    }
  }
  assert.ok(couverts >= 4, 'au moins 4 cas doivent réellement passer par le Reset (sinon le tripwire ne prouve rien) — couverts=' + couverts);
});

test('REPLI (jamais de limbo) : un doc que le Reset NE route PAS retombe sur le classement historique', () => {
  // Un devoir 06 sans motif Reset → le Reset rend null, mais le flux CLASSE quand même (repli à plat).
  const plan = ctx.planRoutageV2_(
    { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'TP Python', date_doc: '2026-06-30' },
    meta('TP.docx'), '2026-06-30', '.docx', {});
  assert.strictEqual(ctx.cheminCibleReset_('06 · Études & diplômes', plan.nom), null, 'le Reset ne route pas ce doc');
  assert.strictEqual(plan.type, 'classé', 'le flux le classe quand même (repli) — jamais laissé sans dossier');
  assert.ok(!/inconnu/i.test(plan.nom), 'et jamais « Inconnu » dans le nom : ' + plan.nom);
});
