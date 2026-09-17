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

/* ======================================================================================
 * LA PASSE AUTOMATIQUE (C49-3, 17/09) — « je veux rien faire à la main », décision de Marc.
 *
 * Ce que ces cas défendent, et pourquoi chacun a coûté quelque chose ailleurs dans le parc :
 *   5. le TICK N'AMORCE JAMAIS — tirer 100 documents, c'est lancer une campagne LLM que
 *      personne n'a demandée ;
 *   6. une passe qui sort DIT pourquoi — « rien à faire », « jamais atteinte » et « suspendue »
 *      ont le même symptôme (le silence) et trois gestes différents (incident C28-135) ;
 *   7. une passe MANUELLE se voit dans la ligne de Santé — sinon on conclut « le tick tourne »
 *      sur la preuve d'une main (leçon du 16/09) ;
 *   8. « je ne sais pas encore » n'est pas « zéro » : la gate d'extinction doit laisser passer
 *      un audit commencé AVANT que ce code n'existe — le cas de Marc aujourd'hui.
 * ==================================================================================== */

test('le compteur de restants distingue « pas encore compté » de « zéro » — sinon l\'audit de Marc ne repart jamais', () => {
  const c = ctx();
  const props = (v) => ({ getProperty: () => v });
  // ABSENT ⇒ null (« je ne sais pas ») : la gate laisse passer, la passe comptera.
  assert.strictEqual(c.resteAuditPiece_(props(null)), null);
  assert.strictEqual(c.resteAuditPiece_(props('')), null);
  // PRÉSENT ⇒ un nombre, et 0 éteint l'étape.
  assert.strictEqual(c.resteAuditPiece_(props('0')), 0);
  assert.strictEqual(c.resteAuditPiece_(props('66')), 66);
  // Une valeur illisible ne doit pas se lire comme « il en reste » à vie, ni lever.
  assert.strictEqual(c.resteAuditPiece_(props('bof')), 0);
});

test('le budget quotidien ne compte QUE la journée en cours (un compteur d\'hier vaut zéro)', () => {
  const c = ctx();
  const props = (v) => ({ getProperty: () => v });
  assert.strictEqual(c.budgetJourAudit_(props('2026/09/17|120000'), '2026/09/17'), 120000);
  assert.strictEqual(c.budgetJourAudit_(props('2026/09/16|720000'), '2026/09/17'), 0,
    'un budget épuisé HIER bloquerait la campagne à vie');
  assert.strictEqual(c.budgetJourAudit_(props(''), '2026/09/17'), 0);
  assert.strictEqual(c.budgetJourAudit_(props('n\'importe quoi'), '2026/09/17'), 0);
});

test('une passe qui n\'a rien fait DIT pourquoi — le silence ne se lit pas comme « rien à faire »', () => {
  const c = ctx();
  const budget = 12 * 60 * 1000;
  // Jamais tourné : c'est un état à part, pas un zéro.
  assert.match(c.phraseFinAuditPiece_('', 0, budget), /n'a pas encore tourné/);
  // Chaque motif a sa phrase, et elle nomme le geste quand il y en a un.
  const fin = (motif, restants) => ['2026-09-17T13:00:00Z', motif, '27/5/2', restants, 'tick'].join('|');
  assert.match(c.phraseFinAuditPiece_(fin('budget-jour', 66), 720000, budget), /reprise demain/);
  assert.match(c.phraseFinAuditPiece_(fin('frein budget LLM atteint', 66), 0, budget), /LLM_BUDGET_CAMPAGNES/);
  assert.match(c.phraseFinAuditPiece_(fin('vide', 0), 0, budget), /aucun échantillon/);
  assert.match(c.phraseFinAuditPiece_(fin('termine', 0), 660000, budget), /à toi de juger/);
  // Un motif INCONNU se cite tel quel plutôt que de se fondre dans le plus proche : c'est ce qui
  // permet d'ajouter une sortie sans que son silence ressemble à une sortie connue.
  assert.match(c.phraseFinAuditPiece_(fin('sortie-neuve', 3), 0, budget), /sortie « sortie-neuve »/);
});

test('une passe MANUELLE se DIT — sinon on conclut « le tick tourne » sur la preuve d\'une main', () => {
  const c = ctx();
  const budget = 12 * 60 * 1000;
  const ligne = (mode) => ['2026-09-17T13:00:00Z', 'termine', '27/5/2', 0, mode].join('|');
  assert.match(c.phraseFinAuditPiece_(ligne('manuel'), 0, budget), /passe MANUELLE/);
  assert.doesNotMatch(c.phraseFinAuditPiece_(ligne('tick'), 0, budget), /passe MANUELLE/);
  // Une ligne d'AVANT ce champ (4 champs) doit se lire comme un tick, pas planter ni mentir.
  const ancienne = ['2026-09-17T13:00:00Z', 'termine', '27/5/2', 0].join('|');
  assert.doesNotMatch(c.phraseFinAuditPiece_(ancienne, 0, budget), /passe MANUELLE/);
});

test('la phrase porte les RESTANTS et les minutes — les deux chiffres qui disent s\'il faut attendre', () => {
  const c = ctx();
  const p = c.phraseFinAuditPiece_(
    ['2026-09-17T13:00:00Z', 'budget-jour', '27/5/2', 66, 'tick'].join('|'), 720000, 12 * 60 * 1000);
  assert.match(p, /66 restants/);
  assert.match(p, /12 des 12 min\/j/);
});

test('l\'étape est RÉELLEMENT branchée dans le tick, gatée, et enveloppée — sinon elle est correcte et inerte', () => {
  // ⚠️ Ce cas existe parce que l'étape ne passe PAS par `etapeSuivie_` (registre C28-44 saturé) :
  // aucun test de gates ne la voit, et le parc a déjà payé deux fois « un correctif vert en test,
  // inerte en prod ». Il scanne donc la SOURCE, décommentée — un scan brut se ferait satisfaire
  // par le commentaire qui explique le motif (leçon §9, la garde qui lit son propre commentaire).
  const fs = require('node:fs');
  const { stripComments } = require('./harness');
  const brut = fs.readFileSync(require('node:path').join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  const code = typeof stripComments === 'function' ? stripComments(brut) : brut.replace(/\/\/[^\n]*/g, '');
  // Anti-vacuité : le décommentage n'a pas mangé le fichier.
  assert.ok(code.length > brut.length * 0.4, 'source décommentée trop courte — scan vacueux');
  assert.ok(/etapeAuditPiece_\(/.test(code), 'le tick doit APPELER la passe, pas seulement la définir');
  assert.ok(/resteAuditPiece_\(/.test(code), 'la gate d\'extinction doit être consultée par le tick');
  // ⚠️ APPELER la gate ne suffit pas : son résultat doit GARDER l'appel. Sans la comparaison à
  // zéro, l'étape reste allumée à vie une fois l'audit fini — elle relirait l'onglet toutes les
  // 5 minutes pour n'y rien trouver. Mutation qui le prouve : retirer `resteAudit !== 0`.
  // Les trois gates de campagne, dans le même esprit que `gBudgetTick, gFreinCampagnes, gResetEnCours`.
  // ⚠️ La fenêtre part de `resteAuditPiece_` et s'arrête à l'appel : une fenêtre plus large est
  // satisfaite par les gates des étapes VOISINES, et la mutation qui retire `!resetEnCours_()`
  // reste alors VERTE (mesuré — c'est le piège « une garde qui lit son voisinage » du §9).
  const debutBloc = code.indexOf('resteAuditPiece_(');
  const finBloc = code.indexOf('etapeAuditPiece_(');
  assert.ok(debutBloc !== -1 && finBloc > debutBloc, 'la gate doit précéder l\'appel');
  const bloc = code.slice(debutBloc, finBloc);
  assert.ok(/budgetCampagnesAtteint_\(\)/.test(bloc), 'le frein budget LLM doit garder l\'étape');
  assert.ok(/resetEnCours_\(\)/.test(bloc), 'une seule main déplace : gatée par le reset');
  assert.ok(/estBudgetDepasse\(\)/.test(bloc), 'budget de TICK (appels LLM), jamais le budget TAIL');
  assert.match(bloc, /!==\s*0/, 'le compte de restants doit ÉTEINDRE l\'étape, pas seulement être lu');
  // L'ENVELOPPE se prouve par son CATCH, en aval de l'appel — un `try {` en amont serait
  // satisfait par n'importe quel try du tick, et il y en a une douzaine.
  const apres = code.slice(finBloc, finBloc + 400);
  assert.match(apres, /catch[\s\S]{0,40}journalErreur_\('AuditPiece'/,
    'ENVELOPPÉE : un échec de l\'audit ne doit jamais bloquer l\'intake, et il doit se DIRE');
});
