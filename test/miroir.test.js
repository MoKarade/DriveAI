'use strict';
/**
 * MIROIR DRIVE (ADR-0017, demande Marc : accès de partout + NotebookLM lit depuis Drive). Fonctions
 * PURES qui décident QUOI inclure et COMMENT nommer/ranger un fichier du dépôt dans le miroir texte.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Router.gs', 'Miroir.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

/* ---------- estFichierMiroirable_ ---------- */

test('estFichierMiroirable_ : les fichiers TEXTE (code, docs, config) sont inclus', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('src/Router.gs'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('docs/adr/0016-fail-safe.md'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('README.md'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('app/src/config.ts'), true);
  assert.strictEqual(ctx.estFichierMiroirable_('package.json'), true);
});

test('estFichierMiroirable_ : les formats BINAIRES sont exclus (illisibles en .txt)', () => {
  assert.strictEqual(ctx.estFichierMiroirable_('app/public/logo.png'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('assets/photo.jpeg'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('fonts/inter.woff2'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('archive.zip'), false);
  assert.strictEqual(ctx.estFichierMiroirable_('rapport.pdf'), false);
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

/* ---------- nomFichierMiroir_ : toujours .txt ---------- */

test('nomFichierMiroir_ : ajoute .txt quelle que soit l\'extension d\'origine', () => {
  assert.strictEqual(ctx.nomFichierMiroir_('src/Router.gs'), 'Router.gs.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('app/src/config.ts'), 'config.ts.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('README.md'), 'README.md.txt');
  assert.strictEqual(ctx.nomFichierMiroir_('docs/notes.txt'), 'notes.txt'); // déjà .txt, pas doublé
});

test('nomFichierMiroir_ : chemin vide ou sans nom → chaîne vide (jamais planter)', () => {
  assert.strictEqual(ctx.nomFichierMiroir_(''), '');
  assert.strictEqual(ctx.nomFichierMiroir_('src/'), '');
});

/* ---------- dossiersMiroir_ : segments de dossier, sans le fichier ---------- */

test('dossiersMiroir_ : segments de dossier nettoyés, jamais le nom de fichier', () => {
  assert.deepStrictEqual(plat(ctx.dossiersMiroir_('src/Router.gs')), ['src']);
  assert.deepStrictEqual(plat(ctx.dossiersMiroir_('docs/adr/0016-fail-safe.md')), ['docs', 'adr']);
  assert.deepStrictEqual(plat(ctx.dossiersMiroir_('README.md')), []); // racine du miroir
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
