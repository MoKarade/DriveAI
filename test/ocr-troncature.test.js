'use strict';
/**
 * `extraireTexte_` (Ocr.gs) : borne de troncature. C26-07 (ADR-0015) a besoin de répliquer la
 * troncature v2 (12000 car., ANALYSE_V2_OCR_MAX_CARS) SANS activer `CONFIG.ANALYSE_V2` — le flag
 * pilote aussi le flux vivant, et le dry-run ne doit jamais y toucher. Le paramètre optionnel
 * `maxCarsOverride` permet ça, sans changer le comportement des appelants existants (omis).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function fakeBlobTexte(texte) {
  return { getContentType: () => 'text/plain', getDataAsString: () => texte, getName: () => 'note.txt' };
}

test('extraireTexte_ : sans override, ANALYSE_V2 OFF → borne historique (LLM_OCR_MAX_CARS)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = false;
  ctx.CONFIG.LLM_OCR_MAX_CARS = 10;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 100;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)));
  assert.strictEqual(r.length, 10);
});

test('extraireTexte_ : override explicite → prime sur le flag, même quand ANALYSE_V2 est OFF (dry-run C26-07)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = false; // le flux vivant reste Haiku — le dry-run ne le touche jamais
  ctx.CONFIG.LLM_OCR_MAX_CARS = 10;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)), 30);
  assert.strictEqual(r.length, 30, 'override respecté, PAS la borne historique (10)');
});

test('extraireTexte_ : sans override, ANALYSE_V2 ON → borne v2 inchangée (comportement existant)', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = true;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 25;
  const r = ctx.extraireTexte_(fakeBlobTexte('x'.repeat(50)));
  assert.strictEqual(r.length, 25);
});


/* ══════════════════════════════════════════════════════════════════════════════════════════
   C49-11 — LE BALISAGE SE RETIRE AVANT LA TRONCATURE.

   ⚠️ Mesuré le 21/09/2026 sur un vrai export du Drive de Marc (18 685 octets), via l'outil
   `lire_document` du moteur DÉPLOYÉ : les 12 000 caractères servis au modèle étaient du
   `<style>` de bout en bout, coupés en plein milieu d'une règle CSS. Zéro caractère du
   document. Le modèle a quand même répondu — il a deviné.

   Le CSS ci-dessous est le gabarit PUBLIC de Facebook (du code, pas une donnée de Marc) ;
   tout le reste est neutre. §9 : aucun contenu de document ne se persiste, un test encore
   moins qu'un journal.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const PREAMBULE_CSS =
  '<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />' +
  '<base href="../../" /><style type="text/css" nonce="KYIj6aWD">' +
  'html{touch-action:manipulation}body{background:#fff;color:#1c1e21;direction:ltr}' +
  'h1,h2,h3{color:#1c1e21;font-size:13px;font-weight:600;margin:0;padding:0}' +
  '.inputsearch{background:#fff url(https://static.xx.fbcdn.net/rsrc.php/v4/yL.png) no-repeat}' +
  '</style>';

function fakeBlobHtml(html, nom) {
  return {
    getContentType: () => 'text/html',
    getDataAsString: () => html,
    getName: () => nom || 'export.html',
  };
}

test('C49-11 : le CSS est retiré AVANT la troncature — sinon le budget part en feuille de style', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = true;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 200; // budget ÉTROIT : c'est tout l'enjeu
  const html = PREAMBULE_CSS + '<title>Titre du document</title></head><body>' +
    '<h2>Section A</h2><div>valeur attendue</div></body></html>';

  const r = ctx.extraireTexte_(fakeBlobHtml(html));

  // ⚠️ Le préambule CSS fait à lui seul plus que le budget : sans nettoyage préalable, rien de
  // ce qui suit n'atteindrait jamais le modèle.
  assert.ok(PREAMBULE_CSS.length > 200, 'la fixture doit saturer le budget, sinon le test ne mesure rien');
  assert.ok(r.indexOf('valeur attendue') !== -1, 'le CONTENU doit survivre à la troncature');
  assert.strictEqual(r.indexOf('touch-action'), -1, 'aucune règle CSS ne doit rester');
  assert.strictEqual(r.indexOf('fbcdn.net'), -1, "l'URL d'une image de style n'est pas du texte");
});

test('C49-11 : le <title> survit — `<head>` n\'est pas retiré en bloc', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  // ⚠️ Sur les exports mesurés, le titre est l'information la PLUS utile du fichier. Retirer
  // `<head>` entier serait plus simple et jetterait exactement ça.
  const r = ctx.texteDepuisHtml_(PREAMBULE_CSS + '<title>Titre du document</title></head><body>x</body></html>');
  assert.ok(r.indexOf('Titre du document') !== -1);
});

test('C49-11 : les balises de BLOC deviennent des sauts de ligne — deux cellules ne se collent pas', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  const r = ctx.texteDepuisHtml_('<div>Alpha</div><div>Beta</div>');
  // ⚠️ Sans ça, le modèle lit « AlphaBeta » : un mot qui n'existe dans aucun document.
  assert.strictEqual(r.indexOf('AlphaBeta'), -1);
  assert.ok(/Alpha\s+Beta/.test(r), 'les deux blocs restent séparés');
});

test('C49-11 : un HTML qui ne rend RIEN une fois nettoyé rend le BRUT', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  // ⚠️ « je n'ai pas su lire » n'est pas « ce document est vide », et c'est le second qui se fige
  // en verdict (`sans-texte`) pour toujours. Dans le doute, le modèle voit le brut : dégradé,
  // mais pas menteur.
  const brut = '<style>a{b:c}</style>'; // que du style : le nettoyage rend vide
  assert.strictEqual(ctx.texteDepuisHtml_(brut), brut);
});

test('C49-11 : `text/plain` et `text/csv` ne sont JAMAIS nettoyés', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  ctx.CONFIG.ANALYSE_V2 = true;
  ctx.CONFIG.ANALYSE_V2_OCR_MAX_CARS = 500;
  // ⚠️ Un bloc-notes qui écrit « 3 < 5 et 7 > 2 » serait mutilé par un retrait de balises.
  const txt = 'seuil : 3 < 5 et 7 > 2';
  const blob = { getContentType: () => 'text/plain', getDataAsString: () => txt, getName: () => 'note.txt' };
  assert.strictEqual(ctx.extraireTexte_(blob), txt);
  assert.strictEqual(ctx.estHtml_('text/csv', 'export.csv'), false);
});

test('C49-11 : un .html typé `text/plain` par Drive est quand même reconnu', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  // ⚠️ Le MIME vient de Drive et il n'est pas fiable ; l'extension, elle, vient du fichier.
  assert.strictEqual(ctx.estHtml_('text/plain', 'export.html'), true);
  assert.strictEqual(ctx.estHtml_('text/plain', 'donnees.xml'), true);
  assert.strictEqual(ctx.estHtml_('text/plain', 'note.txt'), false);
});

test('C49-11 : les entités se décodent, et `&amp;` EN DERNIER', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  // ⚠️ Décodé trop tôt, `&amp;lt;` devient `<` — un décodage de TROP, qui fabrique une balise là
  // où le document écrivait le texte « &lt; ». (Leçon JobAI, 19/08.)
  assert.strictEqual(ctx.decoderEntites_('&amp;lt;'), '&lt;');
  assert.strictEqual(ctx.decoderEntites_('L&#039;article &amp; la suite'), "L'article & la suite");
  assert.strictEqual(ctx.decoderEntites_('a&apos;b'), "a'b", '&apos; manquait chez JobAI');
  assert.strictEqual(ctx.decoderEntites_('&#x41;&#66;'), 'AB');
  // Un point de code invalide reste TEL QUEL : un flux mal formé ne fait pas perdre le reste.
  assert.strictEqual(ctx.decoderEntites_('&#0;'), '&#0;');
});
