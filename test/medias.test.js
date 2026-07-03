'use strict';
/**
 * Chantier #11 (ADR-0009 §2) — fast-path médias bruts :
 *  - `estMediaDirect_` / `estPhoto_` / `estNomNonDocumentaire_` (purs, calibrés sur l'export
 *    Facebook réel en file au 2026-07-02).
 *  - Pipeline : vidéo → `_Médias` sans OCR ; photo « nom non-doc + OCR vide » → `_Médias` sans LLM ;
 *    photo AVEC texte (scan de passeport mal nommé) → garde son analyse complète (garde-fou §1).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Router.gs']);

/* ---------- prédicats purs ---------- */

test('estMediaDirect_ : vidéo/audio/gif → true ; documents/photos → false', () => {
  for (const oui of ['212818161875215.mp4', 'clip.MOV', 'note vocale.m4a', '1571887172846960.gif']) {
    assert.strictEqual(ctx.estMediaDirect_(oui), true, oui);
  }
  for (const non of ['doc.pdf', 'IMG_2734.jpg', 'relevé.png', 'message_1.html', 'sans-extension']) {
    assert.strictEqual(ctx.estMediaDirect_(non), false, non);
  }
});

test('estNomNonDocumentaire_ : identifiants d\'export Facebook réels + compteurs d\'appareil → true', () => {
  const nonDoc = [
    '251319877474117.jpg',      // export Facebook réel (file du 2026-07-02)
    '1030579961714558.jpg',
    '3433870680161939.png',
    'IMG_2734.jpg', 'DSC_0042.JPG', 'PXL_20230504_123456.jpg', 'IMG-20240101-WA0003.jpg',
    'Screenshot 2024-05-01 at 10.00.00.png', 'WhatsApp Image 2024-01-01.jpeg',
  ];
  for (const n of nonDoc) assert.strictEqual(ctx.estNomNonDocumentaire_(n), true, n);
});

test('estNomNonDocumentaire_ : un nom PORTEUR DE SENS → false (le doc garde son analyse)', () => {
  const doc = [
    'CV Marc 2024.jpg',
    '2024-03-05_Facture_Hydro-Québec.jpg',
    'passeport scan.jpg',
    'bail Le Trieste page 1.png',
    'attestation.png',
    '4032.jpg',                  // numérique mais COURT (< 8 chiffres) → doute → analyse complète
  ];
  for (const n of doc) assert.strictEqual(ctx.estNomNonDocumentaire_(n), false, n);
});

test('estNomNonDocumentaire_ : mot-clé PROTÉGÉ dans le nom → documentaire (R3, défense en profondeur)', () => {
  assert.strictEqual(ctx.estNomNonDocumentaire_('Photo 2024 passeport.jpg'), false);
  assert.strictEqual(ctx.estNomNonDocumentaire_('IMG_2734 visa canada.jpg'), false);
  assert.strictEqual(ctx.estNomNonDocumentaire_('Photo 123 vacances.jpg'), true); // sans mot protégé → média
});

test('pipeline : photo > OCR_TAILLE_MAX (OCR jamais TENTÉ) → analyse complète, jamais _Médias (R1)', () => {
  const { c, calls, src } = ctxPipelineTaille('251319877474117.jpg', 25 * 1024 * 1024);
  c.traiterDocument_(src);
  assert.strictEqual(calls.classif, 1);       // le LLM est consulté (métadonnées seules)
  assert.strictEqual(calls.places.length, 0); // pas parti en _Médias
});

test('routageMedia_ : `_Médias`, nom d\'ORIGINE conservé (traçabilité)', () => {
  ctx.dossierMedias_ = () => ({ getId: () => 'ID_MEDIAS' });
  const d = ctx.routageMedia_('251319877474117.jpg');
  assert.strictEqual(d.dossierId, 'ID_MEDIAS');
  assert.strictEqual(d.nom, '251319877474117.jpg'); // jamais renommé
  assert.strictEqual(d.statut, 'média');
  assert.strictEqual(d.chemin, '_Médias');
});

/* ---------- branches du pipeline ---------- */

function ctxPipelineTaille(nom, taille) {
  const base = ctxPipeline(nom, '');
  base.src.taille = taille;
  return base;
}

function ctxPipeline(nom, extrait) {
  const c = load(['Config.gs', 'Pipeline.gs', 'Router.gs']);
  const calls = { places: [], classif: 0, ocr: 0 };
  c.journalInfo_ = () => {};
  c.estPannePlateforme_ = () => false; // garde panne de compte (Llm.gs non chargé ici)
  c.indexContient_ = () => false;
  c.empreinteBlob_ = () => 'EMP';
  c.estDoublon_ = () => false;
  c.indexAjouter_ = () => {};
  c.estTechnique_ = () => false;
  c.extraireTexte_ = () => { calls.ocr++; return extrait; };
  c.classifier_ = () => { calls.classif++; return null; }; // stoppe après (test ciblé)
  c.gererEchec_ = () => {};
  c.dossierMedias_ = () => ({ getId: () => 'ID_MEDIAS' });
  c.Session = { getScriptTimeZone: () => 'UTC' };
  const src = {
    cle: 'drive|X', nom, taille: 10, date: new Date('2026-07-01T00:00:00Z'),
    blob: () => ({}),
    placer: (dossierId, n) => { calls.places.push({ dossierId, n }); return 'X'; },
  };
  return { c, calls, src };
}

test('pipeline : vidéo → _Médias SANS OCR ni LLM', () => {
  const { c, calls, src } = ctxPipeline('212818161875215.mp4', 'peu importe');
  c.traiterDocument_(src);
  assert.deepStrictEqual(calls.places, [{ dossierId: 'ID_MEDIAS', n: '212818161875215.mp4' }]);
  assert.strictEqual(calls.ocr, 0);      // pas de lecture
  assert.strictEqual(calls.classif, 0);  // pas de LLM
});

test('pipeline : photo nom non-doc + OCR VIDE → _Médias sans LLM (mais l\'OCR a été tenté)', () => {
  const { c, calls, src } = ctxPipeline('251319877474117.jpg', '');
  c.traiterDocument_(src);
  assert.strictEqual(calls.ocr, 1);      // l'OCR reste le juge
  assert.strictEqual(calls.classif, 0);  // pas de LLM
  assert.deepStrictEqual(calls.places, [{ dossierId: 'ID_MEDIAS', n: '251319877474117.jpg' }]);
});

test('pipeline : photo nom non-doc mais OCR AVEC TEXTE (passeport mal nommé) → analyse complète (§1)', () => {
  const { c, calls, src } = ctxPipeline('IMG_2734.jpg', 'PASSEPORT — RÉPUBLIQUE FRANÇAISE — RICHARD Marc');
  c.traiterDocument_(src);
  assert.strictEqual(calls.classif, 1);            // le LLM est bien consulté
  assert.strictEqual(calls.places.length, 0);      // (classifier_ mocké null → pas de placement)
});

test('pipeline : photo au nom PORTEUR DE SENS + OCR vide → analyse complète quand même', () => {
  const { c, calls, src } = ctxPipeline('bail Le Trieste page 3.jpg', '');
  c.traiterDocument_(src);
  assert.strictEqual(calls.classif, 1); // nom documentaire → jamais fast-pathé
});
