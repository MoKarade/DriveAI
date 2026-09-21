'use strict';
/**
 * test/resolution-fileid.test.js — C49-16 : retrouver le `fileId` des lignes d'Index qui n'en
 * portent pas (les pièces jointes Gmail, dont la clé n'en contient aucun).
 *
 * Ce que ces cas défendent :
 *   1. le prédicat est STRICT et refuse dans le doute — un faux positif attribue un papier de
 *      Marc à quelqu'un d'autre dans la Mémoire, et c'est un verdict définitif de fait ;
 *   2. un REFUS est mémorisé (sinon la campagne ne finit jamais) mais RÉVISABLE par le tag ;
 *   3. le garde-temps vit DANS la boucle qui fait l'I/O, jamais dans la sélection pure ;
 *   4. une PANNE n'écrit aucun verdict — un blip réseau ne doit pas figer un refus ;
 *   5. le tag se pose AVANT toute sortie possible, sinon la passe repart de zéro à chaque tick ;
 *   6. l'étape est branchée au tick AVANT ses deux consommateurs, et lisible dans la Santé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

function mockProps(table) {
  const t = table || {};
  return {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(t, k) ? t[k] : null),
      setProperty: (k, v) => { t[k] = String(v); },
      deleteProperty: (k) => { delete t[k]; },
    }),
  };
}

function ctx(props) {
  return load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'ResolutionFileId.gs'],
    { PropertiesService: mockProps(props) });
}

const ID = (c) => String(c).repeat(28);
/** Une ligne d'Index : [Clé, Traité le, Fichier, Domaine, Chemin, Statut, Empreinte, Confiance, FileId]. */
const ligne = (cle, nom, chemin, statut, empreinte, fileId) =>
  [cle, '', nom, '02 · Finances', chemin, statut, empreinte || '', '', fileId || ''];
const CLE_GMAIL = '18f3c2a1b9d0e4f5|0|Facture.pdf|48213';

/* ---------- PUR : l'état d'une cellule ---------- */

test('dejaTrancheFileId_ : trois états, et un refus d\'un ANCIEN tag redevient à faire', () => {
  const c = ctx();
  assert.strictEqual(c.dejaTrancheFileId_('', 'c49-16-a'), false, 'vide = jamais tentée');
  assert.strictEqual(c.dejaTrancheFileId_(ID('a'), 'c49-16-a'), true, 'un id = résolue');
  assert.strictEqual(c.dejaTrancheFileId_('!introuvable|c49-16-a', 'c49-16-a'), true);
  // ⚠️ LE CAS QUI FAIT VIVRE LA RÈGLE : un verdict NÉGATIF est révisable par version (C28-33).
  // Sans ça, un fichier introuvable un jour de panne Drive le reste À VIE.
  assert.strictEqual(c.dejaTrancheFileId_('!introuvable|c49-16-a', 'c49-16-b'), false,
    'un refus posé sous un autre tag doit se re-tenter — sinon affiner la règle est sans effet');
  // Une cellule abîmée à la main n'est ni un id ni un refus : on re-tente plutôt que de la croire.
  assert.strictEqual(c.dejaTrancheFileId_('bidon', 'c49-16-a'), false);
});

test('refusFileId_ : le TAG est en queue, et un motif à rallonge ne casse pas la comparaison', () => {
  const c = ctx();
  assert.strictEqual(c.refusFileId_('ambigu', 'c49-16-a'), '!ambigu|c49-16-a');
  // ⚠️ Le tag en QUEUE et non en tête : comparé par `split('|').pop()`, un motif qui
  // contiendrait une barre (aujourd'hui aucun, demain peut-être) ne décalerait rien.
  assert.strictEqual(c.dejaTrancheFileId_(c.refusFileId_('a|b', 'c49-16-a'), 'c49-16-a'), true);
  // ⚠️ Un refus ne doit JAMAIS ressembler à un id, sinon la lecture le rendrait comme fileId.
  assert.strictEqual(c.estFileIdPlausible_(c.refusFileId_('introuvable', 'c49-16-a')), false);
});

/* ---------- PUR : la sélection ---------- */

test('selectionnerAResoudre_ : seules les lignes CLASSÉES et sans fileId connu entrent', () => {
  const c = ctx();
  const lignes = [
    ligne('drive|' + ID('a'), 'a.pdf', '02 · Finances', 'classé'),   // clé porte déjà l'id
    ligne(CLE_GMAIL, 'Facture.pdf', '02 · Finances/2025', 'classé'), // LE cas visé
    ligne(CLE_GMAIL, 'Autre.pdf', '02 · Finances', 'à vérifier'),    // pas classée
    ligne(CLE_GMAIL, 'Deja.pdf', '02 · Finances', 'classé', '', ID('b')), // colonne déjà remplie
    ligne('tri|fil|123|lu', '', '', 'traité'),                       // ligne de tri Gmail
  ];
  const r = c.selectionnerAResoudre_(lignes, 'c49-16-a', 0, 10);
  assert.strictEqual(r.choisies.length, 1);
  assert.strictEqual(r.choisies[0].nom, 'Facture.pdf');
  assert.strictEqual(r.choisies[0].rang, 1);
  assert.strictEqual(r.choisies[0].chemin, '02 · Finances/2025');
  assert.strictEqual(r.restants, 1);
  assert.strictEqual(r.fini, true);
});

test('selectionnerAResoudre_ : la page est bornée, et le RESTE est dit — jamais confondu', () => {
  const c = ctx();
  const lignes = [];
  for (let i = 0; i < 5; i++) lignes.push(ligne(CLE_GMAIL, 'f' + i + '.pdf', '02 · Finances', 'classé'));
  const r = c.selectionnerAResoudre_(lignes, 'c49-16-a', 0, 2);
  assert.strictEqual(r.choisies.length, 2, 'la page rend au plus `max`');
  assert.strictEqual(r.restants, 5, 'le reste compte TOUT ce qui attend, pas ce qui tient dans la page');
  assert.strictEqual(r.fini, false, 'il reste du travail au-delà : la passe n\'est pas terminée');
  assert.strictEqual(r.curseur, 2, 'le curseur reprend après la dernière ligne choisie');

  // ⚠️ Reprise : depuis le curseur, on ne re-scanne pas ce qui a déjà été tranché.
  const suite = c.selectionnerAResoudre_(lignes, 'c49-16-a', 2, 2);
  assert.strictEqual(suite.choisies[0].nom, 'f2.pdf');
});

test('selectionnerAResoudre_ : à la FIN, le curseur repart de zéro', () => {
  const c = ctx();
  const lignes = [ligne(CLE_GMAIL, 'f.pdf', '02 · Finances', 'classé')];
  const r = c.selectionnerAResoudre_(lignes, 'c49-16-a', 0, 10);
  assert.strictEqual(r.fini, true);
  assert.strictEqual(r.curseur, 0,
    'sinon la passe suivante démarrerait au-delà de la fin et ne verrait plus jamais rien');
});

/* ---------- PUR : le verdict ---------- */

/**
 * ⚠️ Les objets rendus par le moteur naissent dans le contexte `vm` du harnais : leur prototype
 * n'est PAS celui de ce realm, et `deepStrictEqual` refuse alors une structure pourtant
 * identique. On recopie donc les deux champs ici — le verdict reste comparé en entier (un champ
 * oublié se verrait), on ne compare simplement plus la provenance de l'objet.
 */
function verdict(c, candidats, empreinte, chemin) {
  const v = c.choisirResolutionFileId_(candidats, empreinte, chemin);
  return { fileId: v.fileId, motif: v.motif };
}

test('choisirResolutionFileId_ : l\'EMPREINTE tranche, et son absence REFUSE au lieu de se rabattre', () => {
  const c = ctx();
  const candidats = [
    { id: ID('a'), empreinte: 'HASH_A', chemin: '2025' },
    { id: ID('b'), empreinte: 'HASH_B', chemin: '2025' },
  ];
  assert.deepStrictEqual(verdict(c, candidats, 'HASH_B', '2025'),
    { fileId: ID('b'), motif: 'empreinte' });
  // ⚠️ LE CAS QUI COMMANDE TOUT LE MODULE : deux fichiers portent le bon nom, dans le bon
  // dossier, et AUCUN ne porte l'empreinte attendue. Se rabattre sur le chemin désignerait un
  // AUTRE document — et l'enverrait à la Mémoire sous l'identité de celui-ci. On refuse.
  assert.deepStrictEqual(verdict(c, candidats, 'HASH_INCONNU', '2025'),
    { fileId: '', motif: 'empreinte-differente' });
});

test('choisirResolutionFileId_ : sans empreinte, le CHEMIN décide — et l\'homonymie refuse', () => {
  const c = ctx();
  const deuxDansLeMemeDossier = [
    { id: ID('a'), empreinte: '', chemin: '2025' },
    { id: ID('b'), empreinte: '', chemin: '2025' },
  ];
  assert.deepStrictEqual(verdict(c, deuxDansLeMemeDossier, '', '2025'),
    { fileId: '', motif: 'ambigu' }, 'deux homonymes dans le même dossier : aucune preuve');
  assert.deepStrictEqual(verdict(c, [{ id: ID('a'), empreinte: '', chemin: '2024' }], '', '2025'),
    { fileId: '', motif: 'hors-chemin' });
  assert.deepStrictEqual(verdict(c, [{ id: ID('a'), empreinte: '', chemin: '2025' }], '', '2025'),
    { fileId: ID('a'), motif: 'chemin' });
  assert.deepStrictEqual(verdict(c, [], '', '2025'), { fileId: '', motif: 'introuvable' });
  // Un chemin d'Index vide ne peut rien prouver : refus, jamais « le premier de la liste ».
  assert.deepStrictEqual(verdict(c, deuxDansLeMemeDossier, '', ''),
    { fileId: '', motif: 'ambigu' });
});

test('choisirResolutionFileId_ : DEUX copies identiques, le chemin départage sans écraser la preuve', () => {
  const c = ctx();
  // Cas réel : le même document rangé ET son exemplaire écarté dans `_Doublons`. Même contenu,
  // donc même empreinte — choisir au hasard désignerait peut-être celui qu'on a mis de côté.
  const copies = [
    { id: ID('a'), empreinte: 'HASH', chemin: '_Doublons' },
    { id: ID('b'), empreinte: 'HASH', chemin: '2025' },
  ];
  assert.deepStrictEqual(verdict(c, copies, 'HASH', '2025'),
    { fileId: ID('b'), motif: 'empreinte-chemin' });
  assert.deepStrictEqual(verdict(c, copies, 'HASH', 'ailleurs'),
    { fileId: '', motif: 'hors-chemin' }, 'aucune des deux copies n\'est dans le dossier attendu');
});

/* ---------- PUR : la requête Drive ---------- */

test('qNomDrive_ : l\'APOSTROPHE française est échappée, et l\'antislash AVANT elle', () => {
  const c = ctx();
  // ⚠️ Le `q` de l'API Drive délimite ses chaînes par des apostrophes simples, et un nom de
  // document français en contient sans arrêt. Non échappée, elle ne lève pas une erreur : elle
  // change la REQUÊTE, donc les candidats, donc le verdict.
  assert.strictEqual(c.qNomDrive_("Contrat d'assurance.pdf"),
    "name = 'Contrat d\\'assurance.pdf' and trashed = false");
  // L'antislash d'abord, sinon on échappe l'échappement qu'on vient de poser.
  assert.strictEqual(c.qNomDrive_('a\\b'), "name = 'a\\\\b' and trashed = false");
  assert.match(c.qNomDrive_('x.pdf'), /trashed = false$/, 'un fichier à la corbeille n\'est pas un candidat');
});

test('dernierSegmentChemin_ : le dossier CONTENANT, sans payer la remontée des ancêtres', () => {
  const c = ctx();
  assert.strictEqual(c.dernierSegmentChemin_('02 · Finances/2025'), '2025');
  assert.strictEqual(c.dernierSegmentChemin_('02 · Finances/2025/'), '2025', 'une barre finale ne crée pas un dossier');
  assert.strictEqual(c.dernierSegmentChemin_('04 · Immigration'), '04 · Immigration');
  assert.strictEqual(c.dernierSegmentChemin_(''), '');
});

/* ---------- PUR : l'état et sa phrase ---------- */

test('les motifs de refus sont NOMMÉS, jamais fondus dans un total', () => {
  const c = ctx();
  // « introuvable » (le fichier n'est plus là), « ambigu » (deux homonymes) et
  // « empreinte-differente » (ce n'est pas ce document) appellent trois gestes différents.
  const encode = c.encoderMotifsResolution_({ introuvable: 3, ambigu: 1 });
  assert.deepStrictEqual(Object.assign({}, c.decoderMotifsResolution_(encode)),
    { introuvable: 3, ambigu: 1 });
  assert.match(c.detailMotifsResolution_({ introuvable: 3, ambigu: 1 }), /3 introuvable, 1 ambigu/,
    'triés du plus fréquent au moins fréquent : c\'est le plus fréquent qui désigne le geste');
  assert.strictEqual(c.detailMotifsResolution_({}), '',
    'aucun refus ⇒ aucune mention : un avertissement permanent est un avertissement mort');
});

test('la phrase distingue « jamais passée », « en cours » et « terminée »', () => {
  const c = ctx();
  assert.match(c.phraseResolutionFileId_({}), /jamais passée/);
  const enCours = c.phraseResolutionFileId_({
    ts: 'x', fin: 'budget', resolus: 12, refuses: 3, restants: 700, motifs: { introuvable: 3 },
  });
  assert.match(enCours, /12 retrouvés/);
  assert.match(enCours, /700 à examiner/);
  assert.match(enCours, /budget/, 'le MOTIF de fin est toujours dit (leçon C28-135)');
  assert.match(enCours, /3 introuvable/);
  assert.match(c.phraseResolutionFileId_({ ts: 'x', fin: 'termine', fini: true, restants: 0, resolus: 700 }),
    /✅ terminée/);
});

test('une chaîne d\'état de l\'ANCIENNE version se relit sans inventer de refus', () => {
  const c = ctx({ DriveAI_RESOLUTION_FILEID_FIN: '2026-09-21T10:00:00.000Z|page|5/2|100|7' });
  const etat = c.etatResolutionFileId_(c.PropertiesService.getScriptProperties());
  assert.strictEqual(etat.resolus, 5);
  assert.strictEqual(etat.refuses, 2);
  assert.deepStrictEqual(Object.assign({}, etat.motifs), {},
    'le 6ᵉ champ absent vaut « passe d\'avant C49-16 », jamais « aucun refus »');
  assert.doesNotMatch(c.phraseResolutionFileId_(etat), /dernière passe/);
});

test('resolutionFileIdDoitTourner_ : la gate lit le TAG **et** l\'état', () => {
  const c = ctx();
  assert.strictEqual(c.resolutionFileIdDoitTourner_({ ts: '' }, 'c49-16-a', 'c49-16-a'), true,
    'jamais passée');
  assert.strictEqual(c.resolutionFileIdDoitTourner_({ ts: 'x', fini: true }, 'c49-16-a', 'c49-16-a'), false,
    'terminée : plus qu\'une lecture de Property par tick');
  // ⚠️ L'INTERBLOCAGE DU 17/09, ÉVITÉ : une gate qui ne lirait que « terminée » s'éteindrait pour
  // toujours, et bumper le tag ne réveillerait plus rien — le remède gaté par le tag serait inerte.
  assert.strictEqual(c.resolutionFileIdDoitTourner_({ ts: 'x', fini: true }, 'c49-16-a', 'c49-16-b'), true,
    'un bump du tag doit TOUT relancer, terminée ou pas');
});

/* ---------- I/O : la passe ---------- */

function passe(opts) {
  opts = opts || {};
  const props = opts.props || {};
  const c = ctx(props);
  const ecrits = {};
  const cherches = [];
  c.feuille_ = () => ({
    getLastRow: () => (opts.lignes || []).length + 1,
    getRange: (r, col, n) => (n === undefined
      ? { setValue: (v) => { ecrits[r + ':' + col] = v; } }
      : { getValues: () => opts.lignes }),
  });
  c.candidatsPourNom_ = (nom) => {
    cherches.push(nom);
    if (opts.leve) throw new Error('réseau indisponible (simulé)');
    return (opts.candidats || {})[nom] || [];
  };
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  return { c, props, ecrits, cherches };
}

test('le TAG se pose AVANT toute sortie, même quand il n\'y a rien à faire', () => {
  const { c, props } = passe({ lignes: [] });
  c.etapeResolutionFileId_(() => false, {});
  // ⚠️ Posé après un `return`, il resterait absent : la passe se croirait « bumpée » à chaque
  // tick, remettrait son curseur à zéro éternellement et ne finirait jamais.
  assert.strictEqual(props.DriveAI_RESOLUTION_FILEID_TAG, c.CONFIG.RESOLUTION_FILEID_TAG);
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|index-vide\|/,
    'et le MOTIF de sortie s\'écrit : « rien à faire » ne doit pas ressembler à « jamais atteinte »');
});

test('la passe ÉCRIT l\'id trouvé sur la bonne ligne, et le refus sur l\'autre', () => {
  const { c, props, ecrits } = passe({
    lignes: [
      ligne(CLE_GMAIL, 'Trouve.pdf', '02 · Finances/2025', 'classé', 'HASH'),
      ligne(CLE_GMAIL, 'Perdu.pdf', '02 · Finances/2025', 'classé', 'HASH2'),
    ],
    candidats: { 'Trouve.pdf': [{ id: ID('a'), empreinte: 'HASH', chemin: '2025' }] },
  });
  c.etapeResolutionFileId_(() => false, {});
  // ⚠️ Cellule par cellule et non un `setValues` en bloc : les rangs choisis ne sont PAS
  // contigus (seules les lignes sans fileId entrent), donc un bloc écraserait les voisines —
  // c'est-à-dire précisément les lignes qui portent déjà un identifiant.
  assert.strictEqual(ecrits['2:9'], ID('a'), 'ligne 1 de données ⇒ rangée 2, colonne 9');
  assert.strictEqual(ecrits['3:9'], '!introuvable|' + c.CONFIG.RESOLUTION_FILEID_TAG);
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|1\/1\|/);
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /introuvable:1/);
});

test('le GARDE-TEMPS coupe DANS la boucle d\'I/O, pas après elle', () => {
  const lignes = [];
  for (let i = 0; i < 5; i++) lignes.push(ligne(CLE_GMAIL, 'f' + i + '.pdf', '02 · Finances', 'classé'));
  let appels = 0;
  const { c, props, cherches } = passe({ lignes });
  c.etapeResolutionFileId_(() => (++appels > 2), {});
  // ⚠️ Le vrai contrôle est le nombre de RECHERCHES DRIVE réellement parties, pas la taille du
  // résultat : un garde évalué dans la sélection pure (qui ne fait aucune I/O) s'exécute en
  // microsecondes et ne peut jamais couper — toute la tranche passerait d'un coup (leçon §9).
  assert.strictEqual(cherches.length, 2, 'deux items traités, puis la main rendue');
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|budget\|/);
});

test('une exécution MANUELLE ignore le garde-temps du tick', () => {
  const lignes = [];
  for (let i = 0; i < 3; i++) lignes.push(ligne(CLE_GMAIL, 'f' + i + '.pdf', '02 · Finances', 'classé'));
  const { c, cherches } = passe({ lignes });
  c.etapeResolutionFileId_(() => true, { manuel: true });
  // Le budget du tick protège le quota des DÉCLENCHEURS ; un run depuis l'éditeur en est hors
  // (leçon C28-33). Sans ce drapeau, Marc ne peut rien finir avant minuit.
  assert.strictEqual(cherches.length, 3);
});

test('une PANNE n\'écrit AUCUN verdict — un blip réseau ne fige pas un refus', () => {
  const { c, props, ecrits } = passe({
    lignes: [ligne(CLE_GMAIL, 'f.pdf', '02 · Finances', 'classé')],
    leve: true,
  });
  c.etapeResolutionFileId_(() => false, {});
  assert.deepStrictEqual(ecrits, {},
    'marquer ici figerait « introuvable » sur une coupure réseau, et le tag seul le déferait');
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|panne\|/,
    'et la panne se DIT : sinon elle a le même silence qu\'une passe sans travail');
});

test('un BUMP du tag repart du début, même si l\'état disait « terminée »', () => {
  const { c, cherches, props } = passe({
    lignes: [ligne(CLE_GMAIL, 'f.pdf', '02 · Finances', 'classé', '', '!introuvable|vieux-tag')],
    props: {
      DriveAI_RESOLUTION_FILEID_TAG: 'vieux-tag',
      DriveAI_RESOLUTION_FILEID_FIN: '2026-09-20T10:00:00.000Z|termine|0/1|0|0|introuvable:1',
    },
  });
  c.etapeResolutionFileId_(() => false, {});
  assert.strictEqual(cherches.length, 1, 'le refus de l\'ancien tag est re-tenté');
  assert.strictEqual(props.DriveAI_RESOLUTION_FILEID_TAG, c.CONFIG.RESOLUTION_FILEID_TAG);
});

/* ---------- BRANCHEMENT ---------- */

test('l\'étape est branchée au tick AVANT ses deux consommateurs', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  const res = main.indexOf('etapeResolutionFileId_(');
  const ratt = main.indexOf('etapeRattrapagePiece_(estBudgetDepasse');
  const peri = main.indexOf('etapePerimetrePiece_(');
  assert.ok(res > 0, 'une passe que le tick n\'appelle pas ne tourne jamais');
  // ⚠️ L'ORDRE EST LE SUJET : elle ALIMENTE le rattrapage (qui envoie) et le périmètre (qui
  // compte). Placée après eux, sa première tranche ne servirait qu'au tick suivant.
  assert.ok(res < ratt, 'la résolution doit précéder le rattrapage : elle lui fournit ses entrées');
  assert.ok(res < peri, 'et le périmètre, dont elle change le total');
  assert.ok(main.indexOf('resolutionFileIdDoitTourner_(') > 0, 'gatée par le TAG et l\'état');
  // Pas de frein LLM : elle ne dépense aucun dollar. Le vérifier, sinon une revue future
  // « harmonisera » les gates et fera attendre une réparation à un budget qu'elle ne consomme pas.
  const bloc = main.slice(res - 900, res + 120);
  assert.ok(bloc.indexOf('budgetCampagnesAtteint_()') === -1,
    'aucune garde de frein LLM : cette étape ne peut pas dépenser un dollar');
});

test('la Santé PUBLIE la ligne — un état que personne ne lit n\'observe rien', () => {
  const journal = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  assert.match(journal, /texteSanteResolutionFileId_\(\)/);
  assert.match(journal, /Résolution des identifiants \(C49-16\)/);
});
