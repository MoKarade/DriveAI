'use strict';
/**
 * PHASE AUDIT (PoC) — protocole de précision de Marc, phase 1 : exécuter la logique de décision sur
 * un échantillon de ~20 DOCUMENTS RÉELS (dérivés des 38 docs de la preuve #26, vrais noms + domaines
 * lus dans le Drive de Marc) AVANT de valider un changement de tri. Rend le tableau
 * [nom | domaine | émetteur | type | verdict fail-safe] et PROUVE que le fail-safe (ADR-0016) ne se
 * déclenche QUE sur du tout-NULL — jamais sur un document réel normal (anti-saturation §2.1).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);

// 20 documents RÉELS (noms tels que lus dans le Drive lors de la preuve #26) + leur domaine classé.
// L'émetteur/type sont dérivés du nom (« Inconnu » ⇒ champ absent, comme le produirait l'analyse).
const REELS = [
  ["2026-06-29_Photo d'identité_Inconnu.jpeg", '01 · Administratif & identité'],
  ['2017-12-19_Attestation_Inconnu.pdf', '01 · Administratif & identité'],
  ['2022-03-04_Attestation_CNAM.pdf', '01 · Administratif & identité'],
  ['2026-06-16_Relevé_Inconnu.pdf', '02 · Finances'],
  ['2026-06-09_Attestation_Lyonnaise de Banque (CIC).pdf', '02 · Finances'],
  ['2016-03-03_Reçu_TPE.jpg', '02 · Finances'],
  ['2026-06-23_Réclamation_Desjardins Assurances Générales.pdf', '03 · Logement & véhicule'],
  ['2026-01-22_Attestation_CCI Paris Ile-de-France.pdf', '04 · Immigration'],
  ['2025-05-27_Attestation_Robovic.pdf', '04 · Immigration'],
  ['2019-09-17_Passeport_Préfecture du Nord.pdf', '04 · Immigration'],
  ['2026-06-30_Lettre de motivation_Inconnu.docx', '05 · Carrière'],
  ['2026-06-01_CV_Marc Richard.pdf', '05 · Carrière'],
  ['2018-06-01_CV_Marc Richard.pdf', '05 · Carrière'],
  ['2026-06-30_Devoir_Inconnu.docx', '06 · Études & diplômes'],
  ['2026-06-16_Certification professionnelle_IMERIR.pdf', '06 · Études & diplômes'],
  ["2020-07-09_Attestation_Université du Littoral - Côte d'Opale.pdf", '06 · Études & diplômes'],
  ['2018-10-03_Revue de presse_Europresse.pdf', '07 · Perso & projets'],
  ['2026-06-30_Questionnaire_TM MECA.png', '07 · Perso & projets'],
  ['2026-07-01_Itinéraire de voyage_SNCF.jpg', '08 · Perso & projets'],
  ['2026-07-01_Note manuscrite_Inconnu.jpg', '08 · Perso & projets'],
];

// Dérive une classification plausible d'un nom « AAAA-MM-JJ_Type_Émetteur.ext » (comme la sortie LLM).
function classifDepuisNom(nom, domaine) {
  const base = nom.replace(/\.[^.]+$/, '');
  const seg = base.split('_');
  const type = seg[1] || null;
  const emetteurBrut = seg.slice(2).join('_');
  const emetteur = (!emetteurBrut || /inconnu/i.test(emetteurBrut)) ? null : emetteurBrut;
  return { domaine: domaine, type_doc: type, emetteur: emetteur };
}

test('AUDIT (PoC) : le fail-safe ne se déclenche sur AUCUN document réel (anti-saturation prouvée)', () => {
  const lignes = REELS.map(([nom, dom]) => {
    const c = classifDepuisNom(nom, dom);
    const vide = ctx.estClassificationVide_(c);
    return { nom: nom.slice(0, 40), domaine: dom.slice(0, 22), emetteur: c.emetteur || '—', type: c.type_doc || '—', verdict: vide ? 'À VÉRIFIER' : 'classé' };
  });
  // Tableau lisible pour Marc (protocole phase 1) — visible avec `node --test` en mode verbeux.
  console.table(lignes);

  const enRevue = lignes.filter((l) => l.verdict === 'À VÉRIFIER');
  assert.strictEqual(enRevue.length, 0,
    'AUCUN document réel ne doit partir en revue : ' + enRevue.map((l) => l.nom).join(', '));
});

test('AUDIT (PoC) : contre-épreuve — une analyse réellement VIDE, elle, part bien en revue', () => {
  // Le seul cas qui déclenche : aucune extraction exploitable (réponse LLM quasi vide mais parsable).
  assert.strictEqual(ctx.estClassificationVide_({ domaine: null, emetteur: null, type_doc: null }), true);
  assert.strictEqual(ctx.estClassificationVide_({ domaine: 'xxx', emetteur: '', type_doc: '' }), true);
});
