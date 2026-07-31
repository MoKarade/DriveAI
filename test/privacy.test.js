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

test('indexAjouter_ : n\'écrit que les 8 colonnes métadonnées (aucun corps de doc)', () => {
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
    confiance: 0.87, // #17 — seule addition légitime (nombre, jamais un texte)
  }, 'HASH_ABCDEF0123');

  const indexRows = rows.filter((r) => r.nom === 'Index');
  assert.strictEqual(indexRows.length, 1, 'exactement une ligne Index');
  const row = indexRows[0].row;

  assert.strictEqual(row.length, 8, '8 colonnes métadonnées, ni plus ni moins');
  assert.strictEqual(row[0], 'm|0|passeport.pdf|999'); // Clé
  assert.ok(row[1] instanceof Date, 'Traité le = Date');
  assert.strictEqual(row[2], '2026-01-15_Passeport_IRCC.pdf'); // Fichier (nom final)
  assert.strictEqual(row[3], '04 · Immigration'); // Domaine
  assert.strictEqual(row[4], '04 · Immigration/Documents'); // Chemin
  assert.strictEqual(row[5], 'classé'); // Statut
  assert.strictEqual(row[6], 'HASH_ABCDEF0123'); // Empreinte = hash (métadonnée, non réversible)
  assert.strictEqual(row[7], 0.87); // Confiance (#17) = NOMBRE — jamais un texte libre

  // Aucune cellule ne contient le corps du document.
  assert.ok(!JSON.stringify(row).includes(SECRET), 'aucun corps de document dans la ligne Index');
});

test('indexAjouter_ : empreinte absente → cellule vide (jamais de fuite de contenu à la place)', () => {
  const { ctx, rows } = chargerAvecFeuilleMock();
  ctx.indexAjouter_('m|1|doc.pdf|10', { statut: 'classé', nom: '2026-01-01_Document_Inconnu.pdf', domaine: '01', chemin: '01' });
  const row = rows.filter((r) => r.nom === 'Index')[0].row;
  assert.strictEqual(row[6], ''); // pas d'empreinte → '' (et surtout pas un extrait de contenu)
  assert.strictEqual(row[7], ''); // pas de confiance (ligne non-LLM) → '' aussi
});

/* --- Onglet Réorg (#21, C21-04) : mêmes règles — métadonnées seulement, contrat d'en-têtes --- */

test('lignePourAction_ (Réorg) : 8 colonnes métadonnées, jamais un corps de document', () => {
  const ctx = load(['Config.gs', 'Reorg.gs']);
  const inventaire = [
    { id: 'idA', chemin: '02 · Finances', nbFichiers: 3, exemples: [] },
    { id: 'idB', chemin: '02 · Finances/Vieux', nbFichiers: 1, exemples: [] },
  ];
  const row = ctx.lignePourAction_('reorg|d', 1,
    { type: 'deplacer', dossier: 2, vers: 1, raison: SECRET.slice(0, 150) }, inventaire, 'T');
  assert.strictEqual(row.length, 8, '8 colonnes (Clé|Type|ID|Chemin actuel|Chemin proposé|Statut|Détail|Horodaté)');
  // La « raison » vient du LLM (tronquée en amont par parserPropositionReorg_ à 150) — c'est un
  // libellé, pas un contenu de document : le moteur n'envoie au LLM que chemins + NOMS de fichiers.
  assert.ok(['deplacer', 'fusionner', 'creer', 'renommer'].includes(row[1]));
  assert.strictEqual(row[5], 'proposé');
});


/* ---------- Réutilisation d'empreinte : la clé d'Index doit désigner le BON fichier (revue #229) ---------- */

test('fileIdDeCleIndex_ (PURE) : n\'accepte QUE les clés qui identifient un fichier — jamais une clé Gmail', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

  // Clés DOCUMENTAIRES : le dernier segment est bien un fileId.
  assert.strictEqual(c.fileIdDeCleIndex_('drive|' + ID), ID);
  assert.strictEqual(c.fileIdDeCleIndex_('conso|conso-2|' + ID), ID);
  assert.strictEqual(c.fileIdDeCleIndex_('tri33p|tri33|t3|' + ID), ID, 'clé versionnée du placement');
  assert.strictEqual(c.fileIdDeCleIndex_('migre|m1|' + ID), ID);
  assert.strictEqual(c.fileIdDeCleIndex_('reanalyse|c26-08|' + ID), ID);

  // Clés GMAIL : attribuer une empreinte au « fileId » qu'on y lirait ferait partir un ORIGINAL
  // dans `_Doublons`. Elles doivent être rejetées par le préfixe, pas par chance.
  assert.strictEqual(c.fileIdDeCleIndex_('19abc123def456|0|facture.pdf|48213'), '', 'PJ Gmail');
  assert.strictEqual(c.fileIdDeCleIndex_('tri|19abc123def456|1753900000000|lu'), '', 'état de tri d\'un fil');
  assert.strictEqual(c.fileIdDeCleIndex_('intention|19abc123def456'), '', 'préfixe hors whitelist');
  assert.strictEqual(c.fileIdDeCleIndex_('epingle|' + ID), '', 'épinglé : pas de colonne empreinte à réutiliser');

  // Formes dégénérées.
  assert.strictEqual(c.fileIdDeCleIndex_(''), '');
  assert.strictEqual(c.fileIdDeCleIndex_(null), '');
  assert.strictEqual(c.fileIdDeCleIndex_('drive'), '', 'un seul segment');
  assert.strictEqual(c.fileIdDeCleIndex_('drive|trop-court'), '', 'ne ressemble pas à un ID Drive');
});

test('empreinteConnueParId_ : alimenté par le chargement de l\'Index ET par les écritures du run', () => {
  const c = load(['Config.gs', 'Journal.gs']);
  const ID1 = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ID2 = '1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const lignes = [
    ['drive|' + ID1, '', '', '', '', 'natif', 'EMP-1', ''],
    ['19zz|0|piece.pdf|1234', '', '', '', '', 'classé', 'EMP-PJ', ''], // clé Gmail : JAMAIS indexée par id
  ];
  const ajouts = [];
  c.feuille_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: (r, col, nb) => ({
      getValue: () => 'Empreinte',
      setValue: () => {},
      getValues: () => lignes,
    }),
    appendRow: (row) => ajouts.push(row),
  });

  assert.strictEqual(c.empreinteConnueParId_(ID1), 'EMP-1', 'lu depuis l\'Index');
  assert.strictEqual(c.empreinteConnueParId_('19zz'), '', 'une clé Gmail ne peuple pas la table par id');
  assert.strictEqual(c.empreinteConnueParId_(ID2), '', 'inconnu → vide (le hash sera calculé)');

  // Une écriture du run doit être immédiatement visible (sinon on re-hasherait dans le même run).
  c.indexAjouter_('tri33p|tri33|t3|' + ID2, { statut: 'tri33-route', nom: 'x', domaine: '', chemin: '' }, 'EMP-2');
  assert.strictEqual(c.empreinteConnueParId_(ID2), 'EMP-2');
});
