'use strict';
/**
 * test/audit-piece.test.js — C49-3, la PORTE avant d'allumer `PIECE_PUSH`.
 *
 * Ce que ces cas défendent :
 *   1. l'échantillon est STRATIFIÉ — le mot n'est pas décoratif : au prorata, le domaine dont
 *      une erreur coûte le plus cher se retrouve avec deux lignes sur cent ;
 *   2. le masquage de `04` et `01` (arbitrage de Marc, 17/09) s'applique aux valeurs qui
 *      NOMMENT, et il ne rend pas une absence indiscernable d'une présence — sinon le
 *      masquage supprime la mesure au lieu de la protéger ;
 *   3. « non jugé » reste une catégorie à part : un audit à moitié rempli ne ressemble pas à
 *      un audit qui a échoué ;
 *   4. le rapport ne peut pas porter le TEXTE OCR, quoi qu'on lui donne.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'AuditPiece.gs']);
}

// ⚠️ CE CAS A ÉTÉ RÉÉCRIT APRÈS UNE MUTATION MUETTE. Il défendait « un plancher par
// domaine » ; retirer le plancher laissait les onze cas verts, parce que la distribution
// tour par tour donne déjà à chacun sa part. Le plancher était donc redondant — et NUISIBLE
// sur un petit échantillon (10 documents, 3 domaines, plancher 8 ⇒ `8, 2, 0`, un domaine
// jamais audité). Ce que le cas ancre maintenant est la propriété RÉELLE et utile :
// l'échantillon ne suit PAS le stock.
test('l\'échantillon est ÉGALITAIRE entre domaines, jamais au prorata du stock', () => {
  const c = ctx();
  const part = c.repartirAudit_({ '02 · Finances': 10000, '04 · Immigration': 30 }, 100);
  assert.strictEqual(part['04 · Immigration'], 30,
    '04 donne tout ce qu\'il a — au prorata il aurait eu 0 ligne sur 100');
  assert.strictEqual(part['02 · Finances'] + part['04 · Immigration'], 100);
});

test('un petit échantillon n\'EXCLUT aucun domaine — le piège du plancher', () => {
  const c = ctx();
  const part = c.repartirAudit_({ a: 100, b: 100, cc: 100 }, 10);
  assert.ok(part.a > 0 && part.b > 0 && part.cc > 0,
    'aucun domaine ne doit tomber à zéro quand l\'échantillon est plus petit que le parc');
  assert.strictEqual(part.a + part.b + part.cc, 10);
});

test('un domaine trop petit donne ce qu\'il a, et le reste retourne au pot', () => {
  const c = ctx();
  const part = c.repartirAudit_({ a: 3, b: 500 }, 50);
  assert.strictEqual(part.a, 3, 'jamais plus que ce que le domaine contient');
  assert.strictEqual(part.a + part.b, 50, 'le total promis est le total rendu');
});

test('la somme ne dépasse JAMAIS le stock réel', () => {
  const c = ctx();
  const part = c.repartirAudit_({ a: 2, b: 3 }, 100);
  assert.strictEqual(part.a + part.b, 5, 'on n\'invente pas de documents');
});

test('les domaines masqués sont reconnus par leur PRÉFIXE, pas par leur libellé', () => {
  const c = ctx();
  assert.strictEqual(c.estDomaineMasqueAudit_('04 · Immigration'), true);
  assert.strictEqual(c.estDomaineMasqueAudit_('01 · Administratif & identité'), true);
  // Le libellé se renomme (`assurerNomsDomaines_` le fait) ; le numéro, non.
  assert.strictEqual(c.estDomaineMasqueAudit_('04 · Immigration & résidence'), true);
  assert.strictEqual(c.estDomaineMasqueAudit_('02 · Finances'), false);
});

test('le masque garde la FORME — sinon absence et présence deviennent la même case vide', () => {
  const c = ctx();
  assert.strictEqual(c.masquerAudit_(null), '(absent)');
  assert.strictEqual(c.masquerAudit_(''), '(absent)');
  const masque = c.masquerAudit_('123456789');
  assert.notStrictEqual(masque, '(absent)',
    'un numéro présent doit se distinguer d\'un champ vide, sinon le masquage tue la mesure');
  assert.ok(!masque.includes('123456789'), 'et la valeur, elle, ne sort pas');
});

test('sur 04 : le titulaire et les champs sont masqués, le type et la date restent', () => {
  const c = ctx();
  const extrait = {
    type: 'Passeport', emetteur: 'IRCC', date_document: '2024-03-01',
    titulaire: 'Marc Richard', titulaire_confiance: 0.9,
    champs: { numero: 'AB1234567' }
  };
  const cel = c.cellulesAuditPiece_({ domaine: '04 · Immigration' }, extrait, 'extrait');
  const tout = JSON.stringify(cel);
  assert.ok(!tout.includes('AB1234567'), 'le numéro ne s\'écrit pas');
  assert.ok(!tout.includes('Marc Richard'), 'le nom ne s\'écrit pas');
  assert.ok(tout.includes('Passeport'), 'le type reste : c\'est lui qui dit si l\'extraction a confondu');
  assert.ok(tout.includes('2024-03-01'), 'la date reste');
  assert.ok(tout.includes('numero'), 'la CLÉ du champ reste — c\'est le sujet de l\'audit');
});

test('hors 04 et 01, les valeurs sont EN CLAIR — sans quoi l\'audit ne juge que la forme', () => {
  const c = ctx();
  const cel = c.cellulesAuditPiece_(
    { domaine: '02 · Finances' },
    { type: 'Facture', champs: { montant: '42,00 $' } },
    'extrait'
  );
  assert.ok(JSON.stringify(cel).includes('42,00'),
    'sur un domaine non masqué, Marc doit pouvoir comparer la valeur au papier');
});

test('« non jugé » est une catégorie à PART, jamais fondue dans « faux »', () => {
  const c = ctx();
  const r = c.compterVerdictsAudit_(['juste', 'faux', '', '   ', 'JUSTE', 'partiel']);
  assert.deepStrictEqual(
    { juste: r.juste, partiel: r.partiel, faux: r.faux, nonJuge: r.nonJuge, total: r.total },
    { juste: 2, partiel: 1, faux: 1, nonJuge: 2, total: 6 }
  );
  assert.ok(c.phraseVerdictAudit_(r).includes('non jugés'));
});

test('un tableau rempli mais JAMAIS jugé le dit, au lieu de rendre un score', () => {
  const c = ctx();
  const phrase = c.phraseVerdictAudit_(c.compterVerdictsAudit_(['', '', '']));
  assert.ok(/AUCUN jugé/.test(phrase), phrase);
  assert.ok(!/0 justes/.test(phrase), 'un audit non rempli n\'est pas un audit à zéro juste');
});

test('le TEXTE OCR ne peut pas entrer dans le rapport, quoi qu\'on donne à la ligne', () => {
  const c = ctx();
  const SECRET = 'CORPS SECRET — texte OCR intégral du passeport';
  const cel = c.cellulesAuditPiece_(
    { domaine: '02 · Finances', extrait: SECRET, texte: SECRET },
    { type: 'Facture', extrait: SECRET, texte_ocr: SECRET },
    'extrait'
  );
  assert.ok(!JSON.stringify(cel).includes('CORPS SECRET'),
    'les cellules sont composées champ par champ : ce qui n\'est pas nommé n\'existe pas');
});

test('les colonnes sont une liste FERMÉE, et le verdict est la 12e', () => {
  const c = ctx();
  assert.strictEqual(c.COLONNES_AUDIT_PIECE.length, 13);
  assert.strictEqual(c.COLONNES_AUDIT_PIECE[11], 'Verdict (à toi)');
  // `verdictAuditPieces` lit la colonne 12 en dur : si l'ordre bouge, il compte autre chose.
  assert.strictEqual(c.COLONNES_AUDIT_PIECE[4], 'Statut');
});
