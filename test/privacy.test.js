'use strict';
/**
 * INVARIANT VIE PRIVÉE (ADR-0007 / CLAUDE.md §7) — l'état ne stocke QUE des métadonnées :
 * jamais le corps d'un document (texte OCR, contenu). `indexAjouter_` (Journal.gs) doit n'écrire
 * que les 7 colonnes métadonnées connues (Clé, Traité le, Fichier, Domaine, Chemin, Statut,
 * Empreinte=hash), même si on lui glisse un `resultat` porteur de contenu. Ce test verrouille
 * l'invariant : tout nouveau champ d'état qui ferait fuiter un corps de doc le casserait.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const SECRET = 'CORPS SECRET DU DOCUMENT — numéro de passeport AB1234567, texte OCR intégral';

function chargerAvecFeuilleMock() {
  const ctx = load(['Journal.gs']);
  const rows = [];
  // On remplace le global feuille_ (défini par Journal.gs) par un mock qui capture les appendRow.
  ctx.feuille_ = (nom) => ({ appendRow: (row) => rows.push({ nom, row }) });
  return { ctx, rows };
}

test('indexAjouter_ : n\'écrit que les 7 colonnes métadonnées (aucun corps de doc)', () => {
  const { ctx, rows } = chargerAvecFeuilleMock();
  ctx.indexAjouter_('m|0|passeport.pdf|999', {
    statut: 'classé',
    nom: '2026-01-15_Passeport_IRCC.pdf',
    domaine: '04 · Immigration',
    chemin: '04 · Immigration/Documents',
    // Champs « corps de document » qu'on tente (à tort) de faire persister :
    texteOCR: SECRET,
    contenu: SECRET,
    corps: SECRET,
  }, 'HASH_ABCDEF0123');

  const indexRows = rows.filter((r) => r.nom === 'Index');
  assert.strictEqual(indexRows.length, 1, 'exactement une ligne Index');
  const row = indexRows[0].row;

  assert.strictEqual(row.length, 7, '7 colonnes métadonnées, ni plus ni moins');
  assert.strictEqual(row[0], 'm|0|passeport.pdf|999'); // Clé
  assert.ok(row[1] instanceof Date, 'Traité le = Date');
  assert.strictEqual(row[2], '2026-01-15_Passeport_IRCC.pdf'); // Fichier (nom final)
  assert.strictEqual(row[3], '04 · Immigration'); // Domaine
  assert.strictEqual(row[4], '04 · Immigration/Documents'); // Chemin
  assert.strictEqual(row[5], 'classé'); // Statut
  assert.strictEqual(row[6], 'HASH_ABCDEF0123'); // Empreinte = hash (métadonnée, non réversible)

  // Aucune cellule ne contient le corps du document.
  assert.ok(!JSON.stringify(row).includes(SECRET), 'aucun corps de document dans la ligne Index');
});

test('indexAjouter_ : empreinte absente → cellule vide (jamais de fuite de contenu à la place)', () => {
  const { ctx, rows } = chargerAvecFeuilleMock();
  ctx.indexAjouter_('m|1|doc.pdf|10', { statut: 'classé', nom: '2026-01-01_Document_Inconnu.pdf', domaine: '01', chemin: '01' });
  const row = rows.filter((r) => r.nom === 'Index')[0].row;
  assert.strictEqual(row[6], ''); // pas d'empreinte → '' (et surtout pas un extrait de contenu)
});

test('indexAjouter_ : branche « revue » vestigiale n\'écrit que des métadonnées', () => {
  const { ctx, rows } = chargerAvecFeuilleMock();
  ctx.indexAjouter_('m|2|x.pdf|5', { statut: 'revue', nom: '2026-01-02_Document_Inconnu.pdf', domaine: '01', chemin: '01', texteOCR: SECRET }, 'H2');
  for (const r of rows) {
    assert.ok(!JSON.stringify(r.row).includes(SECRET), 'ni Index ni Revue ne contiennent le corps du doc');
  }
});
