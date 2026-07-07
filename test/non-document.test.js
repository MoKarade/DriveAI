'use strict';
/**
 * DÉCISION NON-DOCUMENT (refonte 2026-07-07) — née de l'incident réel : des exports Facebook `.html`
 * (87 Ko de code) étaient OCRisés et classés jusque dans « 04 · Immigration » (zone protégée). Le
 * filtre les envoie en `_Technique`, JAMAIS un domaine. Garde DOMINANTE : une pièce d'identité ou un
 * doc 01/04 photographié (même OCR pauvre) n'est JAMAIS jeté en `_Médias`. Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o));

/* ---------- estExportDonnees_ ---------- */

test('estExportDonnees_ : export Facebook → true ; facture .html légitime (émetteur) → false', () => {
  assert.strictEqual(ctx.estExportDonnees_({ nomFichier: 'facebook/your_posts.html' }), true);
  assert.strictEqual(ctx.estExportDonnees_({ nomFichier: '2026-07-01_Export données_Facebook.html' }), true);
  assert.strictEqual(ctx.estExportDonnees_({ nomFichier: 'gros_site.html', taille: 90000 }), true); // gros HTML sans émetteur
  assert.strictEqual(ctx.estExportDonnees_({ nomFichier: 'facture-hydro.html', taille: 90000, emetteur: 'Hydro-Québec' }), false);
  assert.strictEqual(ctx.estExportDonnees_({ nomFichier: 'releve.pdf' }), false); // pas un .html/.json
});

/* ---------- estMediaSansTexte_ ---------- */

test('estMediaSansTexte_ : vidéo/gif toujours ; photo si nom non-doc ET OCR pauvre ; scan riche → non', () => {
  assert.strictEqual(ctx.estMediaSansTexte_({ nomFichier: 'video.mp4' }, ''), true);
  assert.strictEqual(ctx.estMediaSansTexte_({ nomFichier: 'IMG_2734.jpg' }, ''), true);
  assert.strictEqual(ctx.estMediaSansTexte_({ nomFichier: 'IMG_2734.jpg' }, 'x'.repeat(500)), false); // OCR riche
  assert.strictEqual(ctx.estMediaSansTexte_({ nomFichier: 'CV Marc.jpg' }, ''), false); // nom porteur de sens
});

/* ---------- distinguerVraiScan_ : garde DOMINANTE ---------- */

test('distinguerVraiScan_ : pièce d\'identité / doc 01|04 / (domaine + type + émetteur|titulaire) → vrai document', () => {
  assert.strictEqual(ctx.distinguerVraiScan_({ estDocumentIdentite: true }), true);
  assert.strictEqual(ctx.distinguerVraiScan_({ domaine: '04 · Immigration' }), true);
  assert.strictEqual(ctx.distinguerVraiScan_({ domaine: '01 · Administratif & identité' }), true);
  assert.strictEqual(ctx.distinguerVraiScan_({ domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Québec' }), true);
  // rien d'identifiable → pas garanti « vrai scan »
  assert.strictEqual(ctx.distinguerVraiScan_({ domaine: '08 · Perso & projets', type_doc: null, emetteur: null, titulaire: null }), false);
});

/* ---------- decisionNonDocument_ : l'orchestration ordonnée ---------- */

test('decisionNonDocument_ : passeport photographié (OCR riche OU pauvre) → JAMAIS écarté', () => {
  const passeport = { estDocumentIdentite: true, sousDossierType: 'Passeport', domaine: '01 · Administratif & identité' };
  assert.deepStrictEqual(plat(ctx.decisionNonDocument_(passeport, { nomFichier: 'IMG_2734.jpg', extraitOcr: 'RÉPUBLIQUE FRANÇAISE PASSEPORT...' })),
    { estNonDoc: false, routage: null });
  assert.deepStrictEqual(plat(ctx.decisionNonDocument_(passeport, { nomFichier: 'IMG_2734.jpg', extraitOcr: '' })),
    { estNonDoc: false, routage: null }); // même OCR pauvre : garde dominante (jamais média-isé)
});

test('decisionNonDocument_ : export Facebook → _Technique MÊME s\'il a été (mal) classé en 04', () => {
  // le cas réel : l'export s'était retrouvé sous Immigration. L'export DÉTERMINISTE prime sur la garde.
  const malClasse = { domaine: '04 · Immigration', type_doc: 'Formulaire', emetteur: 'Facebook' };
  assert.deepStrictEqual(plat(ctx.decisionNonDocument_(malClasse, { nomFichier: 'Export données_Facebook.html', taille: 87000 })),
    { estNonDoc: true, routage: '_Technique' });
});

test('decisionNonDocument_ : vrai document normal → non écarté ; photo sans texte → _Médias ; code → _Technique', () => {
  assert.strictEqual(ctx.decisionNonDocument_({ domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins' },
    { nomFichier: 'releve.pdf' }).estNonDoc, false);
  assert.deepStrictEqual(plat(ctx.decisionNonDocument_({ domaine: '08 · Perso & projets' }, { nomFichier: '251319877474117.jpg', extraitOcr: '' })),
    { estNonDoc: true, routage: '_Médias' });
  assert.deepStrictEqual(plat(ctx.decisionNonDocument_({ domaine: '08 · Perso & projets' }, { nomFichier: 'main.py' })),
    { estNonDoc: true, routage: '_Technique' });
});
