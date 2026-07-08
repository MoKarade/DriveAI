'use strict';
/**
 * MIROIR DRIVE (ADR-0017, demande Marc : accès de partout + NotebookLM lit depuis Drive). Fonctions
 * PURES qui décident QUOI inclure et COMMENT nommer/ranger un fichier du dépôt dans le miroir texte.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Router.gs', 'Miroir.gs']);

/* ---------- estFichierMiroirable_ ---------- */

test('estFichierMiroirable_ : les fichiers TEXTE (code, docs, config) sont inclus', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('src/Router.gs'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('docs/adr/0016-fail-safe.md'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('README.md'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('app/src/config.ts'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('package.json'), true);
});

test('estFichierMiroirable_ : les binaires UTILES à NotebookLM (vision multimodale) sont INCLUS (rév. 2026-07-08)', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('app/public/logo.png'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('assets/photo.jpeg'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('rapport.pdf'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('app/public/icone.svg'), true);
});

test('estFichierMiroirable_ : les binaires INUTILES (polices, archives) restent exclus', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('fonts/inter.woff2'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('fonts/inter.ttf'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('archive.zip'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('anim.gif'), false);
});

test('estFichierMiroirable_ : jamais de remontée de chemin ; jamais vide', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('../../etc/passwd'), false);
  assert.strictEqual(ctx.estFichierMiroirable_(''), false);
  assert.strictEqual(ctx.estFichierMiroirable_(null), false);
});

/* ---------- nettoyerSegmentChemin_ ---------- */

test('nettoyerSegmentChemin_ : caractères interdits Drive → « - »', () => {
  assert.strictEqual(ctx.nettoyerSegmentChemin_('normal'), 'normal');
  assert.strictEqual(ctx.nettoyerSegmentChemin_('a:b*c?d'), 'a-b-c-d');
});

/* ---------- nomFichierMiroir_ : chemin APLATI (`/` → `---`), toujours .txt ---------- */

test('nomFichierMiroir_ : chemin aplati par --- et suffixé .txt (révision 2026-07-08 — NotebookLM sélectionne sur UN niveau)', () => {
  assert.strictEqual(ctx.nomFichierMiroir_('src/Router.gs'), 'src---Router.gs.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('app/src/config.ts'), 'app---src---config.ts.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('docs/adr/0016-fail-safe.md'), 'docs---adr---0016-fail-safe.md.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('README.md'), 'README.md.txt'); // racine : inchangé
  assert.strictEqual(ctx.nomFichierMiroir_('docs/notes.txt'), 'docs---notes.txt'); // déjà .txt, pas doublé
});

test('nomFichierMiroir_ : chemin vide ou sans nom → chaîne vide (jamais planter)', () => {
  assert.strictEqual(ctx.nomFichierMiroir_(''), '');
  assert.strictEqual(ctx.nomFichierMiroir_('src/'), '');
});

test('nomFichierMiroir_ : caractères interdits Drive nettoyés PAR SEGMENT avant l\'aplatissement', () => {
  assert.strictEqual(ctx.nomFichierMiroir_('docs/a:b*c.md'), 'docs---a-b-c.md.txt');
});

test('nomFichierMiroir_ : BINAIRE → extension d\'ORIGINE conservée (jamais .txt — le type porte la vision multimodale)', () => {
  assert.strictEqual(ctx.nomFichierMiroir_('app/public/logo.png', true), 'app---public---logo.png');
  assert.strictEqual(ctx.nomFichierMiroir_('rapport.pdf', true), 'rapport.pdf');
  // Le même chemin SANS le flag reste la voie texte (suffixe .txt) — le flag fait foi.
  assert.strictEqual(ctx.nomFichierMiroir_('rapport.pdf', false), 'rapport.pdf.txt');
});

/* ---------- mimeTypePourMiroir_ : le bon type à la création Drive ---------- */

test('mimeTypePourMiroir_ : MIME correct par extension (une image doit arriver lisible, jamais text/plain)', () => {
  assert.strictEqual(ctx.mimeTypePourMiroir_('app---public---logo.png'), 'image/png');
  assert.strictEqual(ctx.mimeTypePourMiroir_('photo.jpeg'), 'image/jpeg');
  assert.strictEqual(ctx.mimeTypePourMiroir_('photo.jpg'), 'image/jpeg');
  assert.strictEqual(ctx.mimeTypePourMiroir_('icone.svg'), 'image/svg+xml');
  assert.strictEqual(ctx.mimeTypePourMiroir_('rapport.pdf'), 'application/pdf');
  assert.strictEqual(ctx.mimeTypePourMiroir_('src---Router.gs.txt'), 'text/plain');
});

/* ---------- ecrireFichierMiroir_ : allowlist binaire (défense en profondeur) ---------- */

test('ecrireFichierMiroir_ : binaire:true sur une extension HORS allowlist → refusé sans toucher Drive', () => {
  const c = load(['Config.gs', 'Router.gs', 'Miroir.gs'], {
    DriveApp: { getFolderById: () => { throw new Error('ne doit pas être atteint'); } },
  });
  c.journalErreur_ = () => {};
  // .exe bloqué nulle part par la blocklist mais PAS dans l'allowlist binaire → refusé.
  assert.strictEqual(c.ecrireFichierMiroir_('malware.exe', 'AAAA', true), false);
  // .gs en binaire : pas dans l'allowlist non plus → refusé (un vol de secret ne peut pas pousser
  // du pseudo-binaire sous un nom de code).
  assert.strictEqual(c.ecrireFichierMiroir_('src/Router.gs', 'AAAA', true), false);
});

/* ---------- verifierSecretSync_ : secret DÉDIÉ, distinct de celui de l'app ---------- */

test('verifierSecretSync_ : valide seulement avec le bon secret DÉDIÉ (DriveAI_SYNC_SECRET)', () => {
  const ctxSecret = load(['Config.gs', 'Router.gs', 'Miroir.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_SYNC_SECRET' ? 'bon-secret' : null)
      })
    }
  });
  assert.strictEqual(ctxSecret.verifierSecretSync_({ parameter: { secret: 'bon-secret' } }), true);
  assert.strictEqual(ctxSecret.verifierSecretSync_({ parameter: { secret: 'mauvais' } }), false);
  assert.strictEqual(ctxSecret.verifierSecretSync_({ parameter: {} }), false);
  assert.strictEqual(ctxSecret.verifierSecretSync_(null), false);
});

test('verifierSecretSync_ : Property absente → toujours refusé (jamais de secret vide qui matche)', () => {
  const ctxVide = load(['Config.gs', 'Router.gs', 'Miroir.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }
  });
  assert.strictEqual(ctxVide.verifierSecretSync_({ parameter: { secret: '' } }), false);
});

/* ---------- actionSyncMiroir_ : parsing + garde-temps (sans I/O réelle Drive) ---------- */

test('actionSyncMiroir_ : corps JSON invalide ou sans fichiers → erreur propre, jamais une exception', () => {
  const c = load(['Config.gs', 'Router.gs', 'Miroir.gs'], {
    DriveApp: {}, // pas d'écriture attendue dans ces cas
  });
  assert.strictEqual(c.actionSyncMiroir_({ postData: { contents: 'pas du json' } }).ok, false);
  assert.strictEqual(c.actionSyncMiroir_({ postData: { contents: '{}' } }).ok, false);
  assert.strictEqual(c.actionSyncMiroir_({}).ok, false);
});
