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

test('ligneFinMemoire_ : la ligne persistée porte le motif, les comptes, la position ET le mode', () => {
  const c = ctx();
  const res = { fin: 'budget', envoyes: 50, acceptes: 48, dejaPresents: 2, ligne: 900, dernLigne: 19900 };
  const quand = new Date('2026-09-16T15:00:00.000Z');
  // ⚠️ Le mode est le 5ᵉ champ, AJOUTÉ EN QUEUE (C28-137) : les quatre premiers ne bougent
  // pas d'un caractère, sinon la ligne déjà persistée en production se lirait de travers.
  assert.strictEqual(c.ligneFinMemoire_(quand, res, false), '2026-09-16T15:00:00.000Z|budget|50/48/2|900/19900|tick');
  assert.strictEqual(c.ligneFinMemoire_(quand, res, true), '2026-09-16T15:00:00.000Z|budget|50/48/2|900/19900|manuel');
});

// ── C28-137 : une passe MANUELLE le DIT, et le chemin manuel EXISTE ────────────────────────
//
// ⚠️ Pourquoi ces cas valent le lot : `opts.manuel` était lu en TROIS endroits de
// `passeMemoire_` et AUCUN appelant ne le passait — un champ lu par le moteur sans
// producteur. Et le jour où on lui en donne un, le signal doit distinguer les deux : le
// 16/09, `diagnosticMemoire` a poussé 2 348 faits depuis l'éditeur pendant que le tick n'en
// poussait aucun, et le compteur qui montait a fait conclure « ça marche ».

test('une passe MANUELLE se DIT dans la ligne de Santé — sinon elle se lit comme un tick', () => {
  const c = ctx();
  const tick = c.phraseFinMemoire_('2026-09-16T15:00:00.000Z|termine|50/48/2|900/19900|tick', 2466, 0, 60_000);
  const main = c.phraseFinMemoire_('2026-09-16T15:00:00.000Z|termine|50/48/2|900/19900|manuel', 2466, 0, 60_000);
  assert.doesNotMatch(tick, /MANUELLE/);
  assert.match(main, /MANUELLE/);
  assert.match(main, /ne prouve PAS que le tick tourne/,
    'le piège est de CONCLURE depuis une main : la phrase doit le dire, pas le suggérer');
  // Rétrocompatibilité : la ligne déjà en PRODUCTION n'a que quatre champs.
  assert.doesNotMatch(c.phraseFinMemoire_('2026-09-16T15:00:00.000Z|termine|50/48/2|900/19900', 1, 0, 60_000), /MANUELLE/);
});

test('le chemin manuel EXISTE, et il s\'INSCRIT comme manuel', () => {
  // ⚠️ Le cas voisin (« un run MANUEL ne mange pas le budget du tick ») appelle
  // `pousserInventaireMemoire_(…, {manuel:true})` DIRECTEMENT — ce qu'aucun code de
  // production ne faisait : `opts.manuel` était lu en trois endroits et personne ne le
  // passait. C'est donc la fonction PUBLIQUE qui manquait, et c'est elle qu'on exerce ici,
  // sans la mocker : une fonction qu'on remplace par un faux ne prouve pas qu'elle existe.
  const LIGNE = ['drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01', '', 'doc.pdf', '02 · Finances', '', 'classé'];
  const props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c = ctxPasse(props, [LIGNE]);
  // Budget du jour ÉPUISÉ : sans le chemin manuel, il n'y a plus rien à faire avant minuit.
  props.setProperty('DriveAI_MEMOIRE_JOUR_MS', c.dateGmail_(new Date()) + '|' + (99 * 60 * 1000));
  c.Logger = { log: () => {} };
  c.UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ recus: 1, acceptes: 1, dejaPresents: 0, refuses: [] })
    })
  };

  assert.strictEqual(typeof c.pousserMemoireMaintenant, 'function',
    'sans producteur, `opts.manuel` est une intention jamais livrée');
  const ligne = c.pousserMemoireMaintenant();
  assert.match(String(ligne), /Mémoire \(manuel\)/, 'la fonction rend un compte lisible dans l\'éditeur');
  assert.doesNotMatch(props.ecrit.DriveAI_MEMOIRE_FIN, /\|budget-jour\|/,
    'une main traverse le budget du jour — c\'est tout l\'intérêt du chemin');
  assert.match(props.ecrit.DriveAI_MEMOIRE_FIN, /\|manuel$/,
    'et elle s\'INSCRIT comme manuelle : une passe à la main qui ressemble à un tick fait conclure « ça marche »');
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

/* ========================================================================================
 * LES PIÈCES (ADR-0061, lot D1) — la frontière s'élargit, les gardes se déplacent
 * ======================================================================================== */

const LIGNE_BAIL = {
  cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01',
  nom: '2026-01-15_Bail_GestionImmo.pdf',
  domaine: '03 · Logement & véhicule',
  statut: 'classé',
  chemin: '/03 · Logement & véhicule/Bail'
};

const EXTRAIT_BAIL = {
  type: 'bail',
  emetteur: 'Gestion Immo',
  langue: 'fr',
  date_document: '2026-01-15',
  date_echeance: '2027-01-14',
  resume: 'Bail de 12 mois, reconduction tacite.',
  champs: { montants: [{ libelle: 'loyer mensuel', valeur: '1 250 $' }] },
  libres: { 'téléphone du propriétaire': '418 555 0199' },
  confiance: 0.9
};

test('une pièce porte le CONTENU du papier — c\'est la frontière que l\'ADR-0061 franchit', () => {
  const c = ctx();
  const p = c.pieceMemoire_(LIGNE_BAIL, EXTRAIT_BAIL);
  assert.strictEqual(p.type, 'bail');
  assert.strictEqual(p.emetteur, 'Gestion Immo');
  assert.strictEqual(p.resume, 'Bail de 12 mois, reconduction tacite.');
  assert.deepEqual(p.champs_structures.montants, [{ libelle: 'loyer mensuel', valeur: '1 250 $' }]);
  assert.strictEqual(p.champs_libres['téléphone du propriétaire'], '418 555 0199');
  assert.deepEqual(p.exemplaires, [{ file_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz01', chemin: '/03 · Logement & véhicule/Bail' }]);
  // Le niveau reste DÉRIVÉ par le code, et seulement PROPOSÉ : la Mémoire prend le MAX.
  assert.strictEqual(p.niveau_propose, 2);
});

test('la liste des champs poussés est FERMÉE — pour les pièces aussi', () => {
  const c = ctx();
  const p = c.pieceMemoire_(LIGNE_BAIL, EXTRAIT_BAIL);
  for (const k of Object.keys(p)) {
    assert.ok(c.CHAMPS_PIECE_MEMOIRE.includes(k), `champ inattendu poussé : ${k}`);
  }
});

test('CHAQUE champ de pièce poussé est un champ que la Mémoire ACCEPTE', () => {
  const c = ctx();
  // Le même chaînon que pour les faits, et la même panne à éviter : un `champ_inconnu`
  // refuse le LOT ENTIER dans un HTTP 200.
  for (const champ of c.CHAMPS_PIECE_MEMOIRE) {
    assert.ok(c.CHAMPS_ACCEPTES_PIECE_MEMOIRE.includes(champ),
      `« ${champ} » est poussé mais n'est pas dans le contrat des pièces`);
  }
  const p = c.pieceMemoire_(LIGNE_BAIL, EXTRAIT_BAIL);
  for (const champ of Object.keys(p)) {
    assert.ok(c.CHAMPS_ACCEPTES_PIECE_MEMOIRE.includes(champ), `champ hors contrat produit : ${champ}`);
  }
});

test('le TITULAIRE vaut « inconnu » dès qu\'on n\'est pas sûr — jamais « Marc » par défaut', () => {
  const c = ctx();
  // Quatre formes du doute, et la même réponse : rien. C'est l'arbitrage de Marc du 16/09.
  assert.deepEqual(c.titulaireMemoire_('', 0.9), { titulaire: null, confiance: null });
  assert.deepEqual(c.titulaireMemoire_('Inconnu', 0.9), { titulaire: null, confiance: null });
  assert.deepEqual(c.titulaireMemoire_('N/A', 0.9), { titulaire: null, confiance: null });
  assert.deepEqual(c.titulaireMemoire_(null, null), { titulaire: null, confiance: null });
  // Et le cas nominal, sinon la règle serait satisfaite par « ne rien rendre jamais ».
  assert.deepEqual(c.titulaireMemoire_('Julie', 0.8), { titulaire: 'Julie', confiance: 0.8 });
});

test('un titulaire SANS confiance n\'est pas envoyé — la Mémoire refuserait la paire', () => {
  const c = ctx();
  assert.deepEqual(c.titulaireMemoire_('Julie', null), { titulaire: null, confiance: null });
  assert.deepEqual(c.titulaireMemoire_('Julie', 'beaucoup'), { titulaire: null, confiance: null });
  assert.deepEqual(c.titulaireMemoire_('Julie', 1.5), { titulaire: null, confiance: null });
  const p = c.pieceMemoire_(LIGNE_BAIL, Object.assign({}, EXTRAIT_BAIL, { titulaire: 'Julie' }));
  assert.ok(!('titulaire' in p), 'un titulaire sans confiance ne doit pas partir');
  assert.ok(!('titulaire_confiance' in p));
});

test('le titulaire ne DÉCIDE de rien ici — ni niveau, ni domaine', () => {
  const c = ctx();
  const sans = c.pieceMemoire_(LIGNE_BAIL, EXTRAIT_BAIL);
  const avec = c.pieceMemoire_(LIGNE_BAIL, Object.assign({}, EXTRAIT_BAIL, { titulaire: 'Julie', titulaire_confiance: 0.9 }));
  // Une garde bâtie sur une lecture de modèle n'est pas une garde : le champ voyage, il ne
  // pilote rien (ADR-0061 §9).
  assert.strictEqual(avec.niveau_propose, sans.niveau_propose);
  assert.strictEqual(avec.domaine, sans.domaine);
});

test('une extraction MUETTE ne fait pas perdre ce que le nom classé disait déjà', () => {
  const c = ctx();
  const p = c.pieceMemoire_(LIGNE_BAIL, { resume: 'Rien de lisible.' });
  assert.strictEqual(p.type, 'Bail');
  assert.strictEqual(p.emetteur, 'GestionImmo');
  assert.strictEqual(p.date_document, '2026-01-15');
});

test('une famille de champs structurés INCONNUE est écartée, pas envoyée', () => {
  const c = ctx();
  // Le schéma de la Mémoire est `.strict()` sur cet objet aussi : une famille inventée
  // refuserait le lot entier.
  const p = c.pieceMemoire_(LIGNE_BAIL, Object.assign({}, EXTRAIT_BAIL, {
    champs: { montants: [{ libelle: 'loyer', valeur: '1 250 $' }], recettes: [{ libelle: 'x', valeur: 'y' }] }
  }));
  assert.deepEqual(Object.keys(p.champs_structures), ['montants']);
});

test('les champs libres sont bornés au plafond de la Mémoire', () => {
  const c = ctx();
  const libres = {};
  for (let i = 0; i < c.MAX_CHAMPS_LIBRES_MEMOIRE + 10; i++) libres['c' + i] = 'v';
  const p = c.pieceMemoire_(LIGNE_BAIL, Object.assign({}, EXTRAIT_BAIL, { libres: libres }));
  assert.strictEqual(Object.keys(p.champs_libres).length, c.MAX_CHAMPS_LIBRES_MEMOIRE);
});

test('une échéance ANTÉRIEURE à la date du document n\'est pas envoyée', () => {
  const c = ctx();
  // La Mémoire la refuse (`date-invalide`) : on n'envoie pas un lot qu'on sait refusé.
  const p = c.pieceMemoire_(LIGNE_BAIL, Object.assign({}, EXTRAIT_BAIL, { date_echeance: '2020-01-01' }));
  assert.ok(!('date_echeance' in p));
});

test('pas de pièce sans fileId, ni pour un document non classé', () => {
  const c = ctx();
  assert.strictEqual(c.pieceMemoire_({ cle: 'gmail|abc', nom: 'x.pdf', domaine: '02 · Finances', statut: 'classé' }, EXTRAIT_BAIL), null);
  assert.strictEqual(c.pieceMemoire_(Object.assign({}, LIGNE_BAIL, { statut: 'doublon' }), EXTRAIT_BAIL), null);
  assert.strictEqual(c.pieceMemoire_(null, EXTRAIT_BAIL), null);
});

/* ========================================================================================
 * LE CÂBLAGE (C49-2 bis) — ce qui fait qu'une pièce existe VRAIMENT
 * ======================================================================================== */

/**
 * ⚠️ Ce bloc défend la moitié qui manquait. `extrairePiece_` et `pieceMemoire_` étaient
 * corrects, testés… et appelés par PERSONNE : la classe de défaut que ce dépôt nomme
 * `UN-CHAMP-TYPE-SANS-PRODUCTEUR`. Du code vert qui ne peut rien produire.
 */

test('verdictPiece_ : le canal passe AVANT le document, et c\'est la décision', () => {
  const c = ctx();
  const sain = {
    push: true, jeton: true, suspendue: false, freinBudget: false, pannePlateforme: false,
    faitesCeRun: 0, maxParRun: 5, statutClasse: true, aDuTexte: true
  };
  assert.strictEqual(c.verdictPiece_(sain), null, 'un état sain n\'a aucun motif de refus');

  // Chaque garde, une par une : la perturbation d'UN champ doit produire SON motif.
  const cas = [
    ['push', false, 'desactive'],
    ['jeton', false, 'jeton-absent'],
    ['suspendue', true, 'suspendu'],
    ['freinBudget', true, 'frein-budget'],
    ['pannePlateforme', true, 'panne-llm'],
    ['faitesCeRun', 5, 'plafond-run'],
    ['statutClasse', false, 'non-classe'],
    ['aDuTexte', false, 'sans-texte']
  ];
  for (const [champ, valeur, motif] of cas) {
    const etat = Object.assign({}, sain); etat[champ] = valeur;
    assert.strictEqual(c.verdictPiece_(etat), motif, 'garde « ' + champ + ' »');
  }

  // ⚠️ LE CAS QUI ANCRE L'ORDRE. Les deux s'appliquent : ce qu'on doit lire est l'état du
  // CANAL. Inverser les deux blocs de gardes ferait écrire « sans-texte » pendant qu'un
  // jeton est refusé depuis trois jours, et le geste à faire disparaîtrait de l'écran.
  assert.strictEqual(
    c.verdictPiece_(Object.assign({}, sain, { jeton: false, aDuTexte: false })),
    'jeton-absent',
    'quand le canal ET le document bloquent, c\'est le canal qui est rapporté');
});

test('le plafond par exécution borne le RUN, et il se remet à zéro', () => {
  const c = ctx();
  const sain = {
    push: true, jeton: true, suspendue: false, freinBudget: false, pannePlateforme: false,
    faitesCeRun: 4, maxParRun: 5, statutClasse: true, aDuTexte: true
  };
  assert.strictEqual(c.verdictPiece_(sain), null, 'la 5ᵉ passe encore');
  assert.strictEqual(c.verdictPiece_(Object.assign({}, sain, { faitesCeRun: 5 })), 'plafond-run',
    'la 6ᵉ est refusée');
  // Le compteur existe ET se remet à zéro : sans ce reset, le 2ᵉ tick d'une même exécution
  // (cas des campagnes) n'extrairait plus rien et le motif serait « plafond-run » à vie.
  assert.strictEqual(typeof c.reinitialiserPiecesRun_, 'function');
});

test('ligneFinPiece_ : quatre champs, le document NOMMÉ, et une borne', () => {
  const c = ctx();
  const ligne = c.ligneFinPiece_(new Date('2026-09-16T12:34:56Z'), {
    motif: 'ok', envoyees: 1, acceptees: 1, dejaPresentes: 0, document: 'x'.repeat(200)
  });
  const p = ligne.split('|');
  assert.strictEqual(p.length, 4);
  assert.strictEqual(p[0], '2026-09-16T12:34:56.000Z');
  assert.strictEqual(p[1], 'ok');
  assert.strictEqual(p[2], '1/1/0');
  assert.strictEqual(p[3].length, 120, 'le nom du document est borné (Property ~9 Ko, §9)');
});

test('phraseFinPiece_ : « jamais tourné » est un état À PART', () => {
  const c = ctx();
  assert.match(c.phraseFinPiece_('', 0, ''), /jamais tourné/,
    'une Property absente ne se lit pas comme une journée sans document');
  const dite = c.phraseFinPiece_('2026-09-16T12:00:00.000Z|jeton-absent|0/0/0|Facture.pdf', 7, '');
  assert.match(dite, /7 pièces acceptées/);
  assert.match(dite, /Facture\.pdf/);
  assert.match(dite, /geste de Marc requis/, 'le motif DÉSIGNE le geste, il ne le décrit pas');
  // Un refus persistant s'affiche à côté du motif courant, sans l'écraser.
  assert.match(c.phraseFinPiece_('2026-09-16T12:00:00.000Z|ok|1/1/0|F.pdf', 7, 'champ_inconnu : titulaire'),
    /dernier refus : champ_inconnu/);
  // Un motif inconnu n'est PAS avalé : il se lit tel quel plutôt que de disparaître.
  assert.match(c.phraseFinPiece_('2026-09-16T12:00:00.000Z|xyz|0/0/0|F.pdf', 0, ''), /sortie « xyz »/);
});

test('EXHAUSTIVITÉ : tout motif que le code peut émettre a sa phrase', () => {
  const c = ctx();
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'Memoire.gs'), 'utf8');
  // Les formes par lesquelles un motif naît : le `return` des gardes pures, et l'affectation
  // dans l'orchestrateur. Le motif d'un envoi raté vient de `envoi.raison`, dont les valeurs
  // sont recensées à part ci-dessous.
  // ⚠️ L'affectation se lit jusqu'au `;`, pas comme un littéral collé au `=` : le 21/09/2026,
  // remplacer `res.motif = 'extraction-vide'` par un TERNAIRE a fait disparaître le motif du
  // recensement — et le témoin avec, ce qui est la seule raison pour laquelle on l'a vu. Un
  // recenseur ancré sur la forme ne couvre que les formes que son auteur avait sous les yeux.
  const trouves = new Set();
  const bloc = src.slice(src.indexOf('function verdictPiece_'), src.indexOf('\n}', src.indexOf('function verdictPiece_')));
  for (const m of bloc.matchAll(/return '([a-z-]+)'/g)) trouves.add(m[1]);
  for (const m of src.matchAll(/res\.motif = ([^;]+);/g)) {
    for (const lit of m[1].matchAll(/'([a-z-]+)'/g)) trouves.add(lit[1]);
  }
  for (const m of src.matchAll(/raison: '([a-z-]+)' \}/g)) trouves.add(m[1]);
  for (const m of src.matchAll(/raison: code === 401 \? '([a-z-]+)' : '([a-z-]+)'/g)) { trouves.add(m[1]); trouves.add(m[2]); }

  // Anti-vacuité : un scan qui ne trouve rien prouverait « aucun motif manquant » à partir
  // de « il n'y a aucun motif ». Les deux témoins viennent des DEUX formes scannées.
  assert.ok(trouves.size >= 10, 'le scan a trouvé ' + trouves.size + ' motifs — trop peu, le motif est cassé');
  assert.ok(trouves.has('plafond-run'), 'témoin de la forme `return`');
  assert.ok(trouves.has('extraction-vide'), 'témoin de la forme `res.motif =`');

  for (const motif of trouves) {
    assert.ok(Object.prototype.hasOwnProperty.call(c.PHRASES_FIN_PIECE_, motif),
      'motif « ' + motif + ' » émis par le code mais sans phrase : la Santé dirait « sortie « ' +
      motif + ' » » au lieu de désigner un geste');
  }
});

test('le câblage APPELLE l\'extraction puis l\'envoi, et compte ce qui est accepté', () => {
  const c = ctx();
  const props = {};
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  props.DriveAI_MEMORYAI_TOKEN = 'jeton';
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.reinitialiserPiecesRun_();

  const vus = [];
  c.extrairePiece_ = (meta) => { vus.push(meta.nomFichier); return { resume: 'Une facture', type: 'Facture' }; };
  const envoyes = [];
  c.envoyerLotPiecesMemoire_ = (lot) => {
    envoyes.push(lot);
    return { ok: true, recus: 1, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0, premierRefus: null };
  };

  const decision = {
    nom: '2026-01-15_Facture_Hydro-Québec.pdf', domaine: '02 · Finances',
    statut: 'classé', chemin: '02 · Finances/2026'
  };
  const res = c.pousserPieceApresClassement_(
    { cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' }, decision, 'Texte du document, facture Hydro.');

  assert.strictEqual(res.motif, 'ok');
  assert.strictEqual(res.acceptees, 1);
  // ⚠️ L'ARGUMENT, pas seulement le fait d'avoir appelé : c'est le nom CLASSÉ qui part au
  // modèle, jamais le nom d'origine — sinon le prompt lit « scan0012.pdf ».
  assert.deepEqual(vus, ['2026-01-15_Facture_Hydro-Québec.pdf']);
  assert.strictEqual(envoyes.length, 1);
  assert.strictEqual(envoyes[0][0].exemplaires[0].file_id, '1AbCdEfGhIjKlMnOpQrStUvWxYz01');
  assert.strictEqual(props.DriveAI_PIECE_EMISES, '1');
  assert.match(props.DriveAI_PIECE_FIN, /\|ok\|1\/1\/0\|2026-01-15_Facture_Hydro-Québec\.pdf$/);
});

// ⚠️ GARDE QUI TRAVERSE — de la RÉPONSE DU MODÈLE jusqu'au motif posé par l'orchestrateur.
// Les deux moitiés étaient testées chacune chez elle (le parseur dans `piece.test.js`, la
// table des issues dans `rattrapage-piece.test.js`) et le CHAÎNON n'appartenait à personne :
// couper le fil dans `Memoire.gs` laissait les 1 472 cas VERTS, mesuré le 21/09/2026. Le
// vrai `extrairePiece_` tourne ici — seul le RÉSEAU est simulé.
function ctxReel() {
  const c = load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'Llm.gs', 'Piece.gs', 'Memoire.gs']);
  const props = {};
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  props.DriveAI_MEMORYAI_TOKEN = 'jeton';
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.getCleAnthropic_ = () => 'cle';
  c.enregistrerUsage_ = () => {};
  c.signalerRetablissement_ = () => {};
  c.envoyerLotPiecesMemoire_ = () => ({
    ok: true, recus: 1, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0, premierRefus: null
  });
  c.reinitialiserPiecesRun_();
  return { c, props };
}

function pousser(c, reponseDuModele) {
  c.fetchAvecRetry_ = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ content: [{ type: 'text', text: reponseDuModele }] })
  });
  return c.pousserPieceApresClassement_(
    { cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'photo-passeport.jpg', domaine: '04 · Immigration', statut: 'classé', chemin: '04 · Immigration' },
    'HARD FLEX T 014 Vol PASSEPORT 966 /EXPL ITD OSS C1966 WINDOW/HUBLOT CANADA');
}

test('LE REFUS DU MODÈLE TRAVERSE : « je n\'ai pas pu lire » devient le motif `illisible`', () => {
  const { c } = ctxReel();
  // La réponse EXACTE que le passeport aurait dû produire : le modèle déclare son échec, et
  // remplit quand même — c'est le cas qui compte, parce qu'une extraction riche passe tous
  // les tests de « porte quelque chose ».
  const res = pousser(c, JSON.stringify({
    lisible: false,
    resume: 'Passeport canadiense emitido por el Gobierno de Canadá.',
    type: 'passeport',
    emetteur: 'Gouvernement du Canada',
    libres: { reference_vol: 'HARD FLEX T 014' }
  }));
  assert.strictEqual(res.motif, 'illisible',
    'le motif doit REMONTER : sans lui, une photo illisible se lit « le modèle n\'a rien rendu »');
  assert.strictEqual(res.envoyees, 0, 'et rien ne part à la Mémoire');
});

test('CONTRÔLE NÉGATIF : la même chaîne rend `ok` sur une vraie lecture', () => {
  const { c } = ctxReel();
  // Sans ce cas, la garde ci-dessus prouverait « rien ne passe jamais » aussi bien que « le
  // refus remonte ».
  const res = pousser(c, JSON.stringify({ resume: 'Un vrai passeport.', type: 'passeport' }));
  assert.strictEqual(res.motif, 'ok');
  assert.strictEqual(res.envoyees, 1);
});

test('un non-événement PROPRE AU DOCUMENT n\'écrase pas le signal du CANAL', () => {
  const c = ctx();
  const props = { DriveAI_PIECE_FIN: 'ANCIENNE|jeton-absent|0/0/0|Passeport.pdf' };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  props.DriveAI_MEMORYAI_TOKEN = 'jeton';
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.reinitialiserPiecesRun_();
  c.extrairePiece_ = () => { throw new Error('ne doit jamais être appelée sans texte'); };

  const res = c.pousserPieceApresClassement_(
    { cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'photo.jpg', domaine: '08 · Perso & projets', statut: 'classé', chemin: '_Médias' },
    '   ');

  assert.strictEqual(res.motif, 'sans-texte');
  assert.strictEqual(props.DriveAI_PIECE_FIN, 'ANCIENNE|jeton-absent|0/0/0|Passeport.pdf',
    'une photo sans texte ne doit pas effacer « jeton refusé » : le geste à faire disparaîtrait');
});

test('un refus de contrat est NOMMÉ et SURVIT au succès suivant', () => {
  const c = ctx();
  const props = { DriveAI_MEMORYAI_TOKEN: 'jeton' };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.reinitialiserPiecesRun_();
  c.extrairePiece_ = () => ({ resume: 'r' });

  c.envoyerLotPiecesMemoire_ = () => ({
    ok: true, recus: 1, acceptees: 0, dejaPresentes: 0, oubliees: 0, refusees: 1,
    premierRefus: 'champ_inconnu : titulaire_confiance'
  });
  const ko = c.pousserPieceApresClassement_({ cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'a.pdf', domaine: '02 · Finances', statut: 'classé', chemin: 'x' }, 'texte');
  assert.strictEqual(ko.motif, 'refusee');
  assert.match(props.DriveAI_PIECE_DERNIER_REFUS, /champ_inconnu/);

  // Le succès suivant remet le motif à « ok » — et ne doit PAS effacer la trace du refus,
  // seule chose qu'on cherche quand le canal a l'air de marcher (16/09, 4 000 faits refusés
  // dans des HTTP 200).
  c.envoyerLotPiecesMemoire_ = () => ({
    ok: true, recus: 1, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0, premierRefus: null
  });
  const ok = c.pousserPieceApresClassement_({ cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'b.pdf', domaine: '02 · Finances', statut: 'classé', chemin: 'x' }, 'texte');
  assert.strictEqual(ok.motif, 'ok');
  assert.match(props.DriveAI_PIECE_DERNIER_REFUS, /champ_inconnu/,
    'un succès n\'efface pas la trace du refus précédent');
});

test('une pièce OUBLIÉE par Marc est un SUCCÈS silencieux, jamais un refus', () => {
  const c = ctx();
  const props = { DriveAI_MEMORYAI_TOKEN: 'jeton' };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.reinitialiserPiecesRun_();
  c.extrairePiece_ = () => ({ resume: 'r' });
  c.envoyerLotPiecesMemoire_ = () => ({
    ok: true, recus: 1, acceptees: 0, dejaPresentes: 0, oubliees: 1, refusees: 0, premierRefus: null
  });
  const res = c.pousserPieceApresClassement_({ cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'a.pdf', domaine: '02 · Finances', statut: 'classé', chemin: 'x' }, 'texte');
  assert.strictEqual(res.motif, 'ok', 'oubliée ≠ refusée : sinon on la re-pousserait à chaque passage');
  assert.strictEqual(res.dejaPresentes, 1);
});

test('livrée ÉTEINTE : CONFIG.PIECE_PUSH est false, et c\'est une décision', () => {
  const c = ctx();
  assert.strictEqual(c.CONFIG.PIECE_PUSH, false,
    'allumer ce flag ajoute un appel LLM par document classé, sur les HUIT appelants de ' +
    '`traiterDocument_` — campagnes comprises. Marc l\'allume APRÈS l\'audit C49-3.');
});

test('envoyerLotPiecesMemoire_ lit les compteurs AU FÉMININ — le contrat, pas l\'habitude', () => {
  const c = ctx();
  // ⚠️ `POST /api/pieces` rend `acceptees`/`dejaPresentes`/`refusees`. Les lire au masculin
  // (comme `/api/faits`) rendrait 0 partout, dans un HTTP 200, sans qu'aucune erreur ne
  // remonte : la panne du 16/09 vue par l'autre bout. Ce cas est le seul endroit qui le
  // prouve — partout ailleurs la fonction est mockée.
  c.UrlFetchApp = { fetch: () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      recus: 1, acceptees: 1, dejaPresentes: 2, oubliees: 3,
      refusees: [{ index: 0, code: 'champ_inconnu', raison: 'titulaire' }]
    })
  }) };
  const r = c.envoyerLotPiecesMemoire_([{}], 'jeton', { setProperty() {} });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.acceptees, 1);
  assert.strictEqual(r.dejaPresentes, 2);
  assert.strictEqual(r.oubliees, 3);
  assert.strictEqual(r.refusees, 1);
  assert.match(r.premierRefus, /^champ_inconnu : titulaire$/,
    'un refus se NOMME — « 4 000 refusés » ne dit pas s\'il faut corriger un champ ou une valeur');
});

test('CÂBLAGE RÉEL : Pipeline.gs appelle bien la fonction, sur le SEUL chemin classé', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'Pipeline.gs'), 'utf8');
  // ⚠️ Ce cas existe parce que le test de SURFACE ne voit que l'EXISTENCE : une fonction
  // parfaite que personne n'appelle reste verte partout (`UN-CHAMP-TYPE-SANS-PRODUCTEUR`).
  // On vise donc l'APPEL, et son enveloppe.
  const appels = src.match(/pousserPieceApresClassement_\(/g) || [];
  assert.strictEqual(appels.length, 1,
    'un seul appel : les deux chemins `_Médias` n\'ont aucune pièce à rendre, et payer un ' +
    'appel LLM pour l\'apprendre serait un coût sans information');
  assert.match(src, /try \{ pousserPieceApresClassement_\(src, decision, extrait\); \}\s*\n\s*catch/,
    'sous try/catch : le document est déjà classé, l\'extraction ne doit JAMAIS le défaire');
  // Et l'ORDRE : l'appel vient APRÈS l'inscription à l'Index, jamais avant. Sinon une
  // coupure entre les deux laisserait une pièce envoyée pour un document non indexé.
  assert.ok(src.indexOf('pousserPieceApresClassement_(') >
    src.indexOf('indexAjouter_(src.cle, decision, empreinte)'),
    'l\'appel suit l\'inscription à l\'Index');
});

test('CÂBLAGE RÉEL : la ligne de Santé et le reset de run sont branchés', () => {
  const fs = require('node:fs'), path = require('node:path');
  const journal = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  assert.match(journal, /texteSantePiece_\(\)/,
    'une étape muette est indiscernable d\'une étape jamais atteinte (C28-135)');
  assert.match(main, /reinitialiserPiecesRun_\(\)/,
    'sans ce reset, le plafond par exécution devient un plafond à vie');
});

test('le plafond MORD vraiment : le compteur avance d\'un appel à l\'autre', () => {
  const c = ctx();
  // ⚠️ Ce cas est né d'une perturbation MUETTE : retirer `_piecesCeRun++` laissait les
  // 45 autres verts. Le plafond avait l'air posé et ne bornait RIEN — or c'est lui qui
  // empêche qu'un run de campagne (`Reset.gs`, `Migration.gs`) parte en rafale d'appels LLM.
  const props = { DriveAI_MEMORYAI_TOKEN: 'jeton' };
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }
    })
  };
  c.CONFIG.PIECE_PUSH = true;
  c.budgetCampagnesAtteint_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.reinitialiserPiecesRun_();

  let appels = 0;
  c.extrairePiece_ = () => { appels++; return { resume: 'r' }; };
  c.envoyerLotPiecesMemoire_ = () => ({
    ok: true, recus: 1, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0, premierRefus: null
  });

  // Le nombre de tours se DÉRIVE de la constante : codé en dur, il mentirait au premier
  // rajustement de `PIECE_MAX_PAR_RUN` (§9, « un test paramétré par CONFIG dérive ses cas »).
  const max = c.CONFIG.PIECE_MAX_PAR_RUN;
  const motifs = [];
  for (let i = 0; i <= max; i++) {
    motifs.push(c.pousserPieceApresClassement_(
      { cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz0' + (i % 10) },
      { nom: 'doc' + i + '.pdf', domaine: '02 · Finances', statut: 'classé', chemin: 'x' },
      'texte').motif);
  }
  assert.deepEqual(motifs.slice(0, max), new Array(max).fill('ok'));
  assert.strictEqual(motifs[max], 'plafond-run', 'le ' + (max + 1) + 'ᵉ est refusé');
  assert.strictEqual(appels, max, 'et surtout : l\'appel LLM N\'A PAS eu lieu — le plafond ' +
    'borne le COÛT, pas seulement le compte rendu');

  // Le reset le remet à zéro : sans lui le plafond deviendrait définitif au premier run plein.
  c.reinitialiserPiecesRun_();
  assert.strictEqual(c.pousserPieceApresClassement_(
    { cle: 'drive|1AbCdEfGhIjKlMnOpQrStUvWxYz01' },
    { nom: 'apres.pdf', domaine: '02 · Finances', statut: 'classé', chemin: 'x' }, 'texte').motif, 'ok');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA RAISON DE LA SUSPENSION, écrite depuis toujours et lue par personne.
//
// `suspendreMemoire_` persiste `DriveAI_MEMOIRE_SUSPENDU_RAISON` depuis l'origine, et AUCUNE
// surface ne l'affichait : la ligne de Santé disait « SUSPENDUE après un refus de la Mémoire »,
// phrase vraie d'un jeton refusé, d'un périmètre retiré, d'un champ hors contrat et d'une
// coupure réseau — quatre causes, quatre gestes différents. Mesuré le 21/09 : le canal était
// suspendu, la campagne à l'arrêt, et rien nulle part ne disait pourquoi.
//
// ⚠️ La mutation qui coupe ce fil est restée MUETTE au premier jet : ces deux cas existent
// parce qu'un correctif sans garde se fait retirer au lot suivant.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('la ligne de Santé de la Mémoire DIT pourquoi le canal est coupé', () => {
  const c = ctx();
  const brut = '2026-09-21T13:58:00.000Z|refusee|1/0/0|12/4240';

  const avec = c.phraseFinMemoire_(brut, 2731, 0, 4 * 60 * 1000, 'jeton refusé (401)');
  assert.match(avec, /raison : jeton refusé \(401\)/);

  // ⚠️ Contrôle inverse : sans raison persistée, la phrase n'en fabrique aucune. Sans ce cas,
  // « la raison s'affiche » serait vrai d'une phrase qui l'invente.
  assert.doesNotMatch(c.phraseFinMemoire_(brut, 2731, 0, 4 * 60 * 1000, ''), /raison :/);
});

test('texteSanteMemoire_ LIT la raison, et seulement quand la suspension tient', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'Memoire.gs'), 'utf8');
  // ⚠️ Garde de FORME, faute de mieux : la fonction lit les Properties. Ce qu'elle défend est
  // le FIL — la Property lue et passée à la phrase —, pas la mise en mots, couverte au-dessus.
  assert.match(src,
    /texteSanteMemoire_[\s\S]{0,800}DriveAI_MEMOIRE_SUSPENDU_RAISON/,
    'le fil est coupé : la raison est écrite et plus personne ne la lit');
  // ⚠️ Et elle ne s'affiche que si la suspension TIENT encore : une raison survivante après la
  // re-sonde ferait croire à une panne en cours sur un canal réparé.
  assert.match(src, /memoireSuspendue_\(props\) \?[\s\S]{0,120}SUSPENDU_RAISON/);
});

// ── C49-26 : l'envoi ne SAUTE plus ce qu'il a lu sans l'envoyer ─────────────────────────────
//
// ⚠️ Deux défauts, tous deux trouvés en revue le 23/09 en doublant le budget d'envoi, et qui
// ralentissaient l'inventaire sans qu'aucun compteur ne le montre :
//   1. une lecture de 200 lignes pouvait porter jusqu'à 200 faits, mais UN SEUL lot de 50
//      partait par lecture — le tampon grossissait plus vite qu'il ne se vidait, et le dernier
//      envoi de la passe dépassait le lot maximal que la Mémoire accepte ;
//   2. à la coupure (budget, refus), le curseur se posait après la dernière ligne LUE : tout
//      le tampon non envoyé était sauté jusqu'au tour complet suivant de l'Index.

function indexDeN(n) {
  const lignes = [];
  for (let i = 0; i < n; i++) {
    lignes.push(['drive|1AbCdEfGhIjKlMnOpQrStUv' + String(1000 + i), '', 'doc' + i + '.pdf',
      '02 · Finances', '', 'classé']);
  }
  return lignes;
}

function ctxEnvoi(props, index, envois) {
  const c = ctxPasse(props, index);
  c.Logger = { log: () => {} };
  c.UrlFetchApp = {
    fetch: (_url, opts) => {
      const lot = JSON.parse(opts.payload).faits;
      envois.push(lot.length);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ recus: lot.length, acceptes: lot.length, dejaPresents: 0, refuses: [] })
      };
    }
  };
  return c;
}

test('curseurDeReprise_ : on reprend au premier fait NON ENVOYÉ, jamais après la dernière ligne lue', () => {
  const c = ctx();
  assert.strictEqual(c.curseurDeReprise_(122, []), 122, 'tampon vide ⇒ la ligne qui suit');
  assert.strictEqual(c.curseurDeReprise_(122, [{ fait: {}, ligne: 52 }, { fait: {}, ligne: 60 }]), 52);
});

test('une passe complète envoie TOUT, par lots de 50 au plus', () => {
  const envois = [];
  const props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c = ctxEnvoi(props, indexDeN(120), envois);
  const res = c.pousserInventaireMemoire_(() => false);
  assert.strictEqual(res.fin, 'termine');
  assert.strictEqual(envois.reduce((a, b) => a + b, 0), 120, 'aucun fait perdu');
  assert.ok(envois.every((n) => n <= 50), 'aucun lot au-delà du maximum : ' + envois.join(','));
});

test('une coupure BUDGET ramène le curseur au premier fait non envoyé', () => {
  const envois = [];
  const props = faussesProps({ DriveAI_MEMORYAI_TOKEN: 'jeton' });
  const c = ctxEnvoi(props, indexDeN(120), envois);
  // La garde laisse passer la lecture et le PREMIER envoi, puis coupe.
  const res = c.pousserInventaireMemoire_(() => envois.length >= 1);
  assert.strictEqual(res.fin, 'budget');
  assert.deepStrictEqual(envois, [50]);
  // 50 faits envoyés depuis la ligne 2 ⇒ le 51ᵉ est en ligne 52. L'ancien code posait 122 et
  // sautait les 70 autres jusqu'au tour complet suivant.
  assert.strictEqual(props.ecrit.DriveAI_MEMOIRE_CURSEUR, '52');

  // Et la passe suivante reprend là, sans rien perdre.
  const suite = [];
  const c2 = ctxEnvoi(props, indexDeN(120), suite);
  c2.pousserInventaireMemoire_(() => false);
  assert.strictEqual(suite.reduce((a, b) => a + b, 0), 70);
});
