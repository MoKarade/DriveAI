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
  // ⚠️ `Gmail.gs` est chargé pour `dateGmail_` SEUL : c'est lui qui donne le jour du budget
  // quotidien (`AAAA/MM/JJ`, fuseau du script). Sans lui, la passe lève au lieu de tourner.
  return load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'Memoire.gs']);
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
  assert.strictEqual(f.niveau_propose, 2);
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

test('CHAQUE champ poussé est un champ que la Mémoire ACCEPTE', () => {
  const c = ctx();
  // ⚠️ LE TROU QUI A COÛTÉ 4 000 FAITS LE 2026-09-16. Les deux côtés étaient testés — la
  // liste fermée ici (vie privée), le schéma strict là-bas (injection) — et le CHAÎNON
  // n'était le sujet d'aucun test : nous poussions `niveau`, la Mémoire n'accepte que
  // `niveau_propose`, elle refusait tout, et elle le faisait dans un HTTP 200. Un canal
  // vert des deux bouts, muet au milieu.
  //
  // Ce cas n'affirme pas que la recopie est à jour (rien ici ne peut le savoir) : il
  // affirme que ce qu'on FABRIQUE reste dans ce qu'on a ÉCRIT du contrat. Un champ ajouté
  // au fait sans être ajouté à la recopie fait rougir — donc oblige à rouvrir
  // `lib/validerFait.ts` de la Mémoire pour vérifier qu'il y est vraiment.
  for (const champ of c.CHAMPS_FAIT_MEMOIRE) {
    assert.ok(c.CHAMPS_ACCEPTES_MEMOIRE.includes(champ),
      `« ${champ} » est poussé mais n'est pas dans le contrat de la Mémoire : elle refuserait le LOT ENTIER en \`champ_inconnu\`, dans un HTTP 200`);
  }
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', nom: '2026-01-15_Facture_Hydro.pdf', domaine: '02 · Finances', statut: 'classé'
  });
  for (const champ of Object.keys(f)) {
    assert.ok(c.CHAMPS_ACCEPTES_MEMOIRE.includes(champ), `champ hors contrat produit : ${champ}`);
  }
});

test('un document de niveau 3 ne fait PAS sortir son émetteur', () => {
  const c = ctx();
  const f = c.faitInventaireMemoire_({
    cle: 'drive|1ZzYyXxWwVvUuTtSsRrQqPpOoNn', nom: '2024-06-01_Passeport_IRCC.pdf', domaine: '04 · Immigration', statut: 'classé'
  });
  assert.strictEqual(f.niveau_propose, 3);
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

// ── C28-135 : la passe DIT pourquoi elle s'arrête, et elle a son budget quotidien ──────────
//
// ⚠️ Le défaut que ces cas ferment a coûté une heure de diagnostic à l'aveugle le 16/09 : le
// canal venait d'accepter 2 348 faits À LA MAIN, le tick tournait toutes les 5 min, et rien —
// ni Journal, ni Santé, ni compteur — ne pouvait dire si l'étape était ATTEINTE, SUSPENDUE ou
// coupée par son garde-temps. Trois situations, un seul symptôme : le silence.

test('phraseFinMemoire_ : « jamais tourné » n\'est PAS « rien à envoyer »', () => {
  const c = ctx();
  const jamais = c.phraseFinMemoire_('', 0, 0, 4 * 60 * 1000);
  assert.match(jamais, /jamais tourné/,
    'aucune passe enregistrée = la question du piège 3 (le code déployé s\'exécute-t-il ?)');

  const finie = c.phraseFinMemoire_('2026-09-16T15:00:00.000Z|termine|120/118/2|900/19900', 2466, 30_000, 4 * 60 * 1000);
  assert.match(finie, /2466 faits acceptés/);
  assert.match(finie, /120\/118\/2/);
  assert.doesNotMatch(finie, /jamais tourné/);
});

test('phraseFinMemoire_ : CHAQUE motif de sortie a sa phrase, et elle désigne le geste', () => {
  const c = ctx();
  // La liste se DÉRIVE du code qui produit les motifs — jamais recopiée à la main : c'est ce
  // qui fait rougir ce test le jour où une sortie nouvelle est ajoutée sans sa phrase.
  const motifs = Object.keys(c.PHRASES_FIN_MEMOIRE_);
  assert.ok(motifs.length >= 8, 'les huit sorties connues au 16/09');
  for (const m of motifs) {
    const p = c.phraseFinMemoire_('2026-09-16T15:00:00.000Z|' + m + '|0/0/0|2/2', 0, 0, 60_000);
    assert.doesNotMatch(p, /sortie « /, 'le motif « ' + m + ' » doit avoir sa phrase, pas son code brut');
  }
  // Les deux qui demandent un GESTE de Marc le disent, sinon elles se lisent comme une pause.
  for (const m of ['jeton-absent', 'jeton-refuse', 'suspendu']) {
    assert.match(c.phraseFinMemoire_('x|' + m + '|0/0/0|2/2', 0, 0, 60_000), /⚠️/,
      '« ' + m +' » n\'est pas une pause : il demande un geste');
  }
  // Un motif INCONNU ne se tait pas non plus — il se cite.
  assert.match(c.phraseFinMemoire_('x|motif-neuf|0/0/0|2/2', 0, 0, 60_000), /sortie « motif-neuf »/);
});

test('ligneFinMemoire_ : la ligne persistée porte le motif, les comptes ET la position', () => {
  const c = ctx();
  const l = c.ligneFinMemoire_(new Date('2026-09-16T15:00:00.000Z'),
    { fin: 'budget', envoyes: 50, acceptes: 48, dejaPresents: 2, ligne: 900, dernLigne: 19900 });
  assert.strictEqual(l, '2026-09-16T15:00:00.000Z|budget|50/48/2|900/19900');
});

test('budgetJourMemoire_ : le budget d\'HIER ne borne pas AUJOURD\'HUI', () => {
  const c = ctx();
  const props = { getProperty: (k) => (k === 'DriveAI_MEMOIRE_JOUR_MS' ? '2026/09/15|240000' : null) };
  assert.strictEqual(c.budgetJourMemoire_(props, '2026/09/15'), 240000);
  assert.strictEqual(c.budgetJourMemoire_(props, '2026/09/16'), 0, 'un autre jour repart à zéro');
  assert.strictEqual(c.budgetJourMemoire_({ getProperty: () => null }, '2026/09/16'), 0);
});

// ── La garde COMPORTEMENTALE : aucune sortie ne peut se taire ──────────────────────────────
//
// ⚠️ Un scan de source prouverait la PRÉSENCE d'un `setProperty`, jamais que TOUTES les
// sorties y passent. Ici on EXÉCUTE la passe sur chaque chemin et on lit ce qui a été écrit.
// C'est ce test qui rougit si quelqu'un ajoute une sortie anticipée sans son signal.

/** Un faux `PropertiesService` qui enregistre ce qu'on lui écrit. */
function faussesProps(depart) {
  const m = Object.assign({}, depart || {});
  return {
    ecrit: m,
    getProperty: (k) => (k in m ? m[k] : null),
    setProperty: (k, v) => { m[k] = String(v); },
    deleteProperty: (k) => { delete m[k]; }
  };
}

function ctxPasse(props, index) {
  const c = ctx();
  c.PropertiesService = { getScriptProperties: () => props };
  // `feuille_('Index')` : l'Index rendu ligne par ligne (clé, _, nom, domaine, _, statut).
  c.feuille_ = () => ({
    getLastRow: () => (index || []).length + 1,
    getRange: (l, _c, n) => ({ getValues: () => (index || []).slice(l - 2, l - 2 + n) })
  });
  return c;
}

test('CHAQUE sortie de la passe écrit son motif — aucune ne se tait', () => {
  const LIGNE = ['drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', '', '2026-01-15_Facture_Hydro.pdf', '02 · Finances', '', 'classé'];

  // 1. Allumée SANS jeton — le cas qui demande un geste de Marc.
  let props = faussesProps({});
  let c = ctxPasse(props, [LIGNE]);
  assert.strictEqual(c.pousserInventaireMemoire_(() => false).fin, 'jeton-absent');
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|jeton-absent\|/);

  // 2. Suspendue après un refus — un silence d'une heure qui doit se DIRE.
  props = faussesProps({
    DriveAI_MEMORYAI_TOKEN: 'jeton',
    DriveAI_MEMOIRE_SUSPENDU: String(Date.now())
  });
  c = ctxPasse(props, [LIGNE]);
  assert.strictEqual(c.pousserInventaireMemoire_(() => false).fin, 'suspendu');
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|suspendu\|/);

  // 3. Budget du JOUR épuisé — « repris demain », pas « rien à envoyer ».
  props = faussesProps({
    DriveAI_MEMORYAI_TOKEN: 'jeton',
    DriveAI_MEMOIRE_JOUR_MS: c.dateGmail_(new Date()) + '|' + (99 * 60 * 1000)
  });
  c = ctxPasse(props, [LIGNE]);
  assert.strictEqual(c.pousserInventaireMemoire_(() => false).fin, 'budget-jour');
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|budget-jour\|/);

  // 4. Coupée par le garde-temps du TICK, dès la première ligne : ZÉRO envoyé, zéro erreur —
  //    c'est EXACTEMENT le silence du 16/09, et c'est lui que le signal rend visible.
  props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  c = ctxPasse(props, [LIGNE]);
  const r = c.pousserInventaireMemoire_(() => true);
  assert.strictEqual(r.fin, 'budget');
  assert.strictEqual(r.envoyes, 0);
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|budget\|0\/0\/0\|/);

  // 5. Éteinte par CONFIG — « désactivée » et « jamais tourné » ne sont pas la même chose.
  props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  c = ctxPasse(props, [LIGNE]);
  c.CONFIG.MEMOIRE_PUSH = false;
  assert.strictEqual(c.pousserInventaireMemoire_(() => false).fin, 'desactive');
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|desactive\|/);
});

test('un run MANUEL ne mange pas le budget du tick, et n\'est pas bridé par lui', () => {
  // Leçon C28-33 : les budgets quotidiens protègent le quota des DÉCLENCHEURS ; une exécution
  // depuis l'éditeur en est HORS. Sans le drapeau, Marc serait bloqué jusqu'au lendemain ET
  // son run affamerait l'automatique. Testé dans les DEUX sens.
  const LIGNE = ['drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', '', 'doc.pdf', '02 · Finances', '', 'classé'];
  const jourPlein = { DriveAI_MEMORYAI_TOKEN: 'jeton' };
  let props = faussesProps(jourPlein);
  let c = ctxPasse(props, [LIGNE]);
  props.setProperty('DriveAI_MEMOIRE_JOUR_MS', c.dateGmail_(new Date()) + '|' + (99 * 60 * 1000));

  // Le TICK est bridé…
  assert.strictEqual(c.pousserInventaireMemoire_(() => false).fin, 'budget-jour');
  // …le run MANUEL ne l'est pas, et il ne réécrit pas le compteur du jour.
  const avant = props.ecrit.DriveAI_MEMOIRE_JOUR_MS;
  const r = c.pousserInventaireMemoire_(() => false, { manuel: true });
  assert.notStrictEqual(r.fin, 'budget-jour', 'un run manuel traverse le budget quotidien');
  assert.strictEqual(props.ecrit.DriveAI_MEMOIRE_JOUR_MS, avant,
    'et il ne CONSOMME pas le budget du tick (la double peine de C28-33)');
});
