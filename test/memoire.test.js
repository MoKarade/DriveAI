'use strict';
/**
 * test/memoire.test.js — CE QUI SORT du compte Google de Marc, et rien d'autre (ADR-0059).
 *
 * Ce que ces cas défendent :
 *   1. la liste des champs poussés est FERMÉE — un champ de plus est une DÉCISION, jamais
 *      le résultat d'une refacto ;
 *   2. aucun corps de document, aucun montant, aucun extrait OCR ne peut s'y glisser, même
 *      si on en glisse dans la ligne d'Index ;
 *   3. le niveau est dérivé par le CODE, et tout domaine connu a sa ligne — un domaine
 *      ajouté sans décision fait rougir ce fichier, il ne tombe pas en silence sur un défaut ;
 *   4. un document N3 ne fait pas sortir son émetteur ;
 *   5. la valeur du flag d'envoi est une DÉCISION, dans les deux sens.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const SECRET = 'CORPS SECRET — numéro de passeport AB1234567, solde 12 345,67 $, texte OCR intégral';

function ctx() {
  return load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'Memoire.gs']);
}

// ⚠️ Ce cas s'est INVERSÉ le 2026-09-16, il ne s'est pas supprimé. Il a défendu « ce flag
// ne s'allume pas tout seul » jusqu'à ce que Marc l'allume ; ce qu'il défend maintenant est
// l'autre moitié de la même règle — il ne s'ÉTEINT pas tout seul non plus. Le supprimer
// laisserait croire que la valeur n'a jamais été une décision, et le prochain refactor la
// retournerait sans que rien ne rougisse.
test('allumé par DÉCISION (Marc, 2026-09-16) : CONFIG.MEMOIRE_PUSH est true', () => {
  const c = ctx();
  assert.strictEqual(c.CONFIG.MEMOIRE_PUSH, true,
    'ce flag fait SORTIR des métadonnées du compte Google : sa valeur est une décision, dans les deux sens');
});

test('un document classé devient UN fait document.existe, et rien de plus', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01',
    nom: '2026-01-15_Facture_Hydro-Québec.pdf',
    domaine: '02 · Finances',
    statut: 'classé'
  });
  assert.ok(f, 'un document classé produit un fait');
  assert.strictEqual(f.predicat, 'document.existe');
  assert.strictEqual(f.valeur_type, 'ref_document');
  assert.strictEqual(f.valeur, '1AbCdEfGhIjKlMnOpQrStUvWxYz01');
  assert.strictEqual(f.niveau, 2);
  assert.strictEqual(f.valide_de, '2026-01-15');
  assert.deepEqual(f.attributs, { type: 'Facture', annee: '2026', emetteur: 'Hydro-Québec' });
});

test('la liste des champs poussés est FERMÉE — à tous les étages', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', nom: '2026-01-15_Facture_Hydro.pdf', domaine: '02 · Finances', statut: 'classé'
  });
  // ⚠️ Ce cas est le cœur du fichier : il transforme « on fait attention » en « le test
  // échoue ». Un champ ajouté au fait sans être ajouté À CETTE LISTE fait rougir la suite.
  assert.deepEqual(Object.keys(f).sort(), Array.from(c.CHAMPS_FAIT_MEMOIRE).filter((k) => k in f).sort());
  for (const k of Object.keys(f)) {
    assert.ok(c.CHAMPS_FAIT_MEMOIRE.includes(k), `champ inattendu poussé : ${k}`);
  }
  for (const k of Object.keys(f.attributs)) {
    assert.ok(c.CHAMPS_ATTRIBUTS_MEMOIRE.includes(k), `attribut inattendu poussé : ${k}`);
  }
  for (const k of Object.keys(f.provenance)) {
    assert.ok(c.CHAMPS_PROVENANCE_MEMOIRE.includes(k), `champ de provenance inattendu : ${k}`);
  }
});

test('aucun corps de document ne sort, même glissé dans la ligne d\'Index', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01',
    nom: '2026-01-15_Facture_Hydro.pdf',
    domaine: '02 · Finances',
    statut: 'classé',
    // Les champs « corps » qu'on tente (à tort) de faire sortir :
    texte: SECRET, ocr: SECRET, extrait: SECRET, montant: '12 345,67 $', resume: SECRET
  });
  const rendu = JSON.stringify(f);
  assert.ok(!rendu.includes('CORPS SECRET'), 'un corps de document ne doit jamais sortir');
  assert.ok(!rendu.includes('12 345'), 'un montant ne doit jamais sortir');
  assert.ok(!rendu.includes('AB1234567'), 'un numéro d\'identité ne doit jamais sortir');
});

test('un document de niveau 3 ne fait PAS sortir son émetteur', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1ZzYyXxWwVvUuTtSsRrQqPpOoNn', nom: '2024-06-01_Passeport_IRCC.pdf', domaine: '04 · Immigration', statut: 'classé'
  });
  assert.strictEqual(f.niveau, 3);
  // L'ADR-0001 de la Mémoire énumère ce qu'un fait N3 porte : existence, type, date,
  // échéance, pointeur. L'émetteur n'y est pas — et la Mémoire l'accepterait, ce qui est
  // justement la raison de s'abstenir ICI.
  assert.strictEqual(f.attributs.emetteur, undefined);
  assert.strictEqual(f.attributs.type, 'Passeport');
});

test('CHAQUE domaine connu a son niveau — un domaine ajouté fait rougir ce test', () => {
  const c = ctx();
  const connus = Object.keys(c.CONFIG.DOMAINES).concat(c.CONFIG.DOMAINES_AUTO);
  for (const d of connus) {
    assert.ok(Object.prototype.hasOwnProperty.call(c.NIVEAU_PAR_DOMAINE_MEMOIRE, d),
      `le domaine « ${d} » n'a pas de niveau déclaré : décide-le, ne le laisse pas tomber sur le défaut`);
  }
  // Et l'inverse : une ligne qui ne correspond à aucun domaine réel est une ligne morte.
  for (const d of Object.keys(c.NIVEAU_PAR_DOMAINE_MEMOIRE)) {
    assert.ok(connus.includes(d), `« ${d} » n'est plus un domaine : retire sa ligne`);
  }
});

test('un domaine INCONNU tombe sur un défaut prudent, jamais sur « clair »', () => {
  const c = ctx();
  assert.strictEqual(c.niveauMemoire_('42 · Inventé'), c.NIVEAU_MEMOIRE_INCONNU);
  assert.ok(c.NIVEAU_MEMOIRE_INCONNU >= 2, 'le défaut doit être restrictif');
  assert.ok(c.NIVEAU_MEMOIRE_INCONNU < 3, 'mais pas mentir : un document inconnu n\'est pas de l\'identité');
});

test('rien n\'est poussé pour ce qui n\'est pas rangé', () => {
  const c = ctx();
  for (const statut of ['doublon', 'quarantaine', 'à vérifier', '']) {
    assert.strictEqual(
      c.faitInventaireMemoire_({ cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', nom: '2026-01-15_X_Y.pdf', domaine: '02 · Finances', statut }),
      null,
      `statut « ${statut} » : dire qu'un document « existe et est là » serait faux`
    );
  }
});

test('rien n\'est poussé sans identifiant de fichier', () => {
  const c = ctx();
  assert.strictEqual(
    c.faitInventaireMemoire_({ cle: 'tri|fil123|0|1', nom: 'x', domaine: '02 · Finances', statut: 'classé' }),
    null,
    'une clé de tri Gmail ne désigne aucun fichier'
  );
});

test('un nom hors convention passe quand même — sans inventer d\'attributs', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', nom: 'scan 3.pdf', domaine: '08 · Perso & projets', statut: 'classé'
  });
  // Le document EXISTE et il est quelque part : c'est vrai, et c'est utile. Ce qu'on ne sait
  // pas ne se devine pas — pas de type inventé, pas d'année déduite du jour.
  assert.ok(f);
  assert.strictEqual(f.attributs, undefined);
  assert.strictEqual(f.valide_de, undefined);
});

test('une date PARTIELLE n\'est pas une date', () => {
  const c = ctx();
  assert.strictEqual(c.dateDuNomClasse_('2026_Facture_Hydro.pdf'), null);
  assert.strictEqual(c.dateDuNomClasse_('2026-01_Facture_Hydro.pdf'), null);
  assert.strictEqual(c.dateDuNomClasse_('2026-01-15_Facture_Hydro.pdf'), '2026-01-15');
});

test('les lots sont bornés à ce que la Mémoire accepte', () => {
  const c = ctx();
  assert.strictEqual(c.MEMOIRE_LOT_MAX, 50, 'la Mémoire refuse un lot de plus de 50 (422)');
  const faits = Array.from({ length: 120 }, (_, i) => ({ i }));
  const lots = c.lotsMemoire_(faits, c.MEMOIRE_LOT_MAX);
  assert.deepEqual(lots.map((l) => l.length), [50, 50, 20]);
  assert.strictEqual(lots.reduce((n, l) => n + l.length, 0), 120, 'aucun fait perdu au découpage');
});
