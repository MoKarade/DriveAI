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
