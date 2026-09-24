'use strict';
/**
 * C49-18 — L'OCR REJOUE SES APPELS IDEMPOTENTS, ET SEULEMENT CEUX-LÀ.
 *
 * `fetchDriveAvecRetry_` (DriveRest.gs) existe depuis la phase 2 et rejoue une fois sur 429/5xx.
 * `Ocr.gs` ne l'employait nulle part : ses quatre appels Drive étaient des `UrlFetchApp.fetch`
 * nus, donc un 503 passager rendait `null` — que le rattrapage range en `ocr-echec`, une issue
 * DÉFINITIVE : le document est marqué « fait » sous le tag courant et ne revient ni par le
 * rattrapage, ni par le flux (il est déjà classé). Une cause qui aurait disparu d'elle-même
 * coûtait un document.
 *
 * ⚠️ CE FICHIER GARDE LES DEUX SENS, et le second est le plus important : l'upload multipart
 * NE DOIT PAS rejouer. Il crée un fichier, et un 5xx peut arriver APRÈS la création — rejouer
 * fabriquerait un `DriveAI_extract_temp` orphelin dont on n'apprend jamais l'identifiant, donc
 * qu'on ne peut plus supprimer (on ne supprime que celui que la réponse rend). Un lot futur qui
 * « harmoniserait » en mettant le retry partout fait rougir le 4ᵉ cas.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** Un faux UrlFetchApp scripté par URL : rend les codes dans l'ordre et compte les appels. */
function faussesReponses(plan) {
  const appels = [];
  const restes = {};
  Object.keys(plan).forEach((k) => { restes[k] = plan[k].slice(); });
  return {
    appels,
    // ⚠️ Un motif TEXTE sur-compte : l'URL d'export du temporaire contient `files/<id>` elle
    // aussi. Une expression régulière ancrée est le seul moyen de compter LA suppression.
    compte(motif) {
      return appels.filter((u) => (motif instanceof RegExp ? motif.test(u) : u.indexOf(motif) !== -1)).length;
    },
    app: {
      fetch(url) {
        appels.push(url);
        const cle = Object.keys(restes).find((k) => url.indexOf(k) !== -1);
        assert.ok(cle, 'URL non prévue par le plan : ' + url);
        const r = restes[cle].length > 1 ? restes[cle].shift() : restes[cle][0];
        return { getResponseCode: () => r.code, getContentText: () => (r.corps || '') };
      },
    },
  };
}

function ctxOcr(faux) {
  const ctx = load(['Config.gs', 'DriveRest.gs', 'Ocr.gs']);
  ctx.UrlFetchApp = faux.app;
  ctx.ScriptApp = { getOAuthToken: () => 'JETON' };
  ctx.Utilities.sleep = () => {};            // le retry dort 1 s en production
  ctx.Utilities.getUuid = () => 'UUID';
  ctx.Utilities.newBlob = () => ({ getBytes: () => [] });
  return ctx;
}

const blobPdf = { getContentType: () => 'application/pdf', getName: () => 'facture.pdf', getBytes: () => [] };

test('export natif : un 503 passager est rejoué, et le texte est rendu', () => {
  const faux = faussesReponses({ '/export?': [{ code: 503 }, { code: 200, corps: 'le texte du document' }] });
  const ctx = ctxOcr(faux);
  const r = ctx.exporterTexteNatif_('ID1', 'application/vnd.google-apps.document');
  assert.strictEqual(r, 'le texte du document');
  assert.strictEqual(faux.compte('/export?'), 2, 'exactement un rejeu');
});

test('export natif : le rejeu est BORNÉ à un — deux 503 rendent null, jamais une boucle', () => {
  const faux = faussesReponses({ '/export?': [{ code: 503 }] });
  const ctx = ctxOcr(faux);
  assert.strictEqual(ctx.exporterTexteNatif_('ID1', 'application/vnd.google-apps.document'), null);
  assert.strictEqual(faux.compte('/export?'), 2, 'deux appels au total, pas davantage');
});

test('conversion : un 503 sur l\'export du temporaire est rejoué — la conversion PAYÉE n\'est pas jetée', () => {
  const faux = faussesReponses({
    '/upload/': [{ code: 200, corps: '{"id":"TMP1"}' }],
    '/export?': [{ code: 503 }, { code: 200, corps: 'texte OCR' }],
    'files/TMP1': [{ code: 204 }],
  });
  const ctx = ctxOcr(faux);
  const r = ctx.convertirEtExtraire_(blobPdf, 'application/vnd.google-apps.document', 'text/plain', true);
  assert.strictEqual(r, 'texte OCR');
  assert.strictEqual(faux.compte('/export?'), 2, 'l\'export a rejoué');
  assert.strictEqual(faux.compte('/upload/'), 1, 'l\'upload, lui, n\'a été fait qu\'une fois');
});

test('⚠️ l\'upload multipart n\'est JAMAIS rejoué : un 5xx rend null après UN SEUL appel', () => {
  const faux = faussesReponses({ '/upload/': [{ code: 503, corps: 'backend error' }] });
  const ctx = ctxOcr(faux);
  const r = ctx.convertirEtExtraire_(blobPdf, 'application/vnd.google-apps.document', 'text/plain', true);
  assert.strictEqual(r, null, 'échec technique, jamais « sans texte »');
  assert.strictEqual(faux.compte('/upload/'), 1,
    'un second appel créerait un DriveAI_extract_temp orphelin, non supprimable');
});

test('la suppression du temporaire rejoue sur 5xx (idempotente) — sinon l\'orphelin reste dans le Drive', () => {
  const faux = faussesReponses({
    '/upload/': [{ code: 200, corps: '{"id":"TMP2"}' }],
    '/export?': [{ code: 200, corps: 'texte' }],
    'files/TMP2': [{ code: 503 }, { code: 204 }],
  });
  const ctx = ctxOcr(faux);
  assert.strictEqual(ctx.convertirEtExtraire_(blobPdf, 'application/vnd.google-apps.document', 'text/plain', true), 'texte');
  assert.strictEqual(faux.compte(/files\/TMP2$/), 2, 'la suppression a rejoué');
});

// ─── C49-28 — un refus 400 se DIT, et sur une image il se rejoue UNE fois, ré-encodée ─────────

function blobImage(type, nom, reencode) {
  return {
    getContentType: () => type,
    getName: () => nom,
    getBytes: () => [1, 2, 3],
    getAs: (t) => {
      assert.strictEqual(t, 'image/jpeg');
      if (!reencode) throw new Error('conversion impossible');
      return { getContentType: () => 'image/jpeg', getName: () => nom, getBytes: () => [9, 9] };
    },
  };
}

test('C49-28 : un PNG refusé en 400 est ré-encodé en JPEG et rejoué UNE fois — le texte revient', () => {
  const faux = faussesReponses({
    '/upload/': [{ code: 400, corps: 'Bad Request' }, { code: 200, corps: '{"id":"TMP3"}' }],
    '/export?': [{ code: 200, corps: 'texte du graphique' }],
    'files/TMP3': [{ code: 204 }],
  });
  const ctx = ctxOcr(faux);
  const r = ctx.convertirEtExtraire_(blobImage('image/png', 'graphique.png', true),
    'application/vnd.google-apps.document', 'text/plain', true);
  assert.strictEqual(r, 'texte du graphique');
  assert.strictEqual(faux.compte('/upload/'), 2, 'un seul rejeu, avec un contenu DIFFÉRENT');
});

test('C49-28 : le rejeu est BORNÉ — deux 400 rendent null après deux téléversements, jamais trois', () => {
  const faux = faussesReponses({ '/upload/': [{ code: 400, corps: 'Bad Request' }] });
  const ctx = ctxOcr(faux);
  const journal = [];
  ctx.journalErreur_ = (src, msg) => journal.push(msg);
  assert.strictEqual(ctx.convertirEtExtraire_(blobImage('image/png', 'graphique.png', true),
    'application/vnd.google-apps.document', 'text/plain', true), null);
  assert.strictEqual(faux.compte('/upload/'), 2);
  assert.match(journal.join('\n'), /déjà ré-encodé/);
});

test('C49-28 : un 5xx sur une image ne déclenche PAS le rejeu ré-encodé (l\'upload a pu créer)', () => {
  const faux = faussesReponses({ '/upload/': [{ code: 503, corps: 'backend' }] });
  const ctx = ctxOcr(faux);
  assert.strictEqual(ctx.convertirEtExtraire_(blobImage('image/png', 'x.png', true),
    'application/vnd.google-apps.document', 'text/plain', true), null);
  assert.strictEqual(faux.compte('/upload/'), 1);
});

test('C49-28 : un PDF refusé ne se ré-encode pas, et un TIFF non plus (getAs ne sait pas)', () => {
  assert.strictEqual(require('./harness').load(['Ocr.gs']).peutReencoderImage_('application/pdf'), false);
  const ctx = load(['Ocr.gs']);
  assert.strictEqual(ctx.peutReencoderImage_('image/tiff'), false);
  assert.strictEqual(ctx.peutReencoderImage_('image/jpeg'), false, 'rejouer un JPEG en JPEG ne change rien');
  assert.strictEqual(ctx.peutReencoderImage_('image/png'), true);
});

test('C49-28 : le journal NOMME le fichier, son type d\'origine, et dit si le PDF est chiffré', () => {
  const faux = faussesReponses({ '/upload/': [{ code: 400, corps: 'Bad Request' }] });
  const ctx = ctxOcr(faux);
  const journal = [];
  ctx.journalErreur_ = (src, msg) => journal.push(msg);
  ctx.Utilities.newBlob = () => ({ getBytes: () => [], getDataAsString: () => '%PDF-1.3 … trailer << /Encrypt 1 0 R >>' });
  const pdf = { getContentType: () => 'application/pdf', getName: () => 'attestation.pdf', getBytes: () => new Array(2048).fill(0) };
  assert.strictEqual(ctx.convertirEtExtraire_(pdf, 'application/vnd.google-apps.document', 'text/plain', true), null);
  assert.strictEqual(faux.compte('/upload/'), 1, 'un PDF n\'est pas rejoué');
  assert.match(journal[0], /« attestation\.pdf »/);
  assert.match(journal[0], /application\/pdf, 2 Ko, PDF CHIFFRÉ/);
});

test('C49-28 : estPdfChiffre_ — le marqueur exact, pas une sous-chaîne voisine', () => {
  const ctx = load(['Ocr.gs']);
  assert.strictEqual(ctx.estPdfChiffre_('trailer << /Encrypt 1 0 R >>'), true);
  assert.strictEqual(ctx.estPdfChiffre_('trailer << /Root 1 0 R >>'), false);
  assert.strictEqual(ctx.estPdfChiffre_('/EncryptMetadata false'), false);
  assert.strictEqual(ctx.estPdfChiffre_(null), false);
});
