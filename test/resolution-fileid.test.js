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
  // ⚠️ `Ocr.gs` pour `tronquer_`, que `suspendreResolutionFileId_` emploie. C'est la garde
  // « panne-ecriture » qui l'a révélé : le `try/catch` qui protège la persistance avalait aussi
  // la fonction absente, donc la Property n'était jamais écrite — en silence. « Un try/catch qui
  // protège une persistance avale aussi les fautes de frappe » (§9), payé une seconde fois.
  return load(['Config.gs', 'Consolidation.gs', 'Ocr.gs', 'Journal.gs', 'ResolutionFileId.gs'],
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
  return verdict4(c, candidats, empreinte, chemin, false);
}

function verdict4(c, candidats, empreinte, chemin, tropNombreux) {
  const v = c.choisirResolutionFileId_(candidats, empreinte, chemin, tropNombreux);
  return { fileId: v.fileId, motif: v.motif };
}

test('choisirResolutionFileId_ : l\'EMPREINTE tranche, et son absence REFUSE au lieu de se rabattre', () => {
  const c = ctx();
  const candidats = [
    { id: ID('a'), empreinte: 'HASH_A', chemins: ['02 · Finances/2025'] },
    { id: ID('b'), empreinte: 'HASH_B', chemins: ['02 · Finances/2025'] },
  ];
  assert.deepStrictEqual(verdict(c, candidats, 'HASH_B', '02 · Finances/2025'),
    { fileId: ID('b'), motif: 'empreinte' });
  // ⚠️ LE CAS QUI COMMANDE TOUT LE MODULE : deux fichiers portent le bon nom, dans le bon
  // dossier, et AUCUN ne porte l'empreinte attendue. Se rabattre sur le chemin désignerait un
  // AUTRE document — et l'enverrait à la Mémoire sous l'identité de celui-ci. On refuse.
  assert.deepStrictEqual(verdict(c, candidats, 'HASH_INCONNU', '02 · Finances/2025'),
    { fileId: '', motif: 'empreinte-differente' });
});

test('choisirResolutionFileId_ : sans empreinte, le CHEMIN décide — et l\'homonymie refuse', () => {
  const c = ctx();
  const P25 = '02 · Finances/2025';
  const deuxDansLeMemeDossier = [
    { id: ID('a'), empreinte: '', chemins: [P25] },
    { id: ID('b'), empreinte: '', chemins: [P25] },
  ];
  assert.deepStrictEqual(verdict(c, deuxDansLeMemeDossier, '', P25),
    { fileId: '', motif: 'ambigu' }, 'deux homonymes dans le même dossier : aucune preuve');
  assert.deepStrictEqual(
    verdict(c, [{ id: ID('a'), empreinte: '', chemins: ['02 · Finances/2024'] }], '', P25),
    { fileId: '', motif: 'hors-chemin' });
  assert.deepStrictEqual(verdict(c, [{ id: ID('a'), empreinte: '', chemins: [P25] }], '', P25),
    { fileId: ID('a'), motif: 'chemin' });
  assert.deepStrictEqual(verdict(c, [], '', P25), { fileId: '', motif: 'introuvable' });
  // Un chemin d'Index vide ne peut rien prouver : refus, jamais « le premier de la liste ».
  assert.deepStrictEqual(verdict(c, deuxDansLeMemeDossier, '', ''),
    { fileId: '', motif: 'ambigu' });
});

test('choisirResolutionFileId_ : DEUX copies identiques, le chemin départage sans écraser la preuve', () => {
  const c = ctx();
  // Cas réel : le même document rangé ET son exemplaire écarté dans `_Doublons`. Même contenu,
  // donc même empreinte — choisir au hasard désignerait peut-être celui qu'on a mis de côté.
  const copies = [
    { id: ID('a'), empreinte: 'HASH', chemins: ['02 · Finances/_Doublons'] },
    { id: ID('b'), empreinte: 'HASH', chemins: ['02 · Finances/2025'] },
  ];
  assert.deepStrictEqual(verdict(c, copies, 'HASH', '02 · Finances/2025'),
    { fileId: ID('b'), motif: 'empreinte-chemin' });
  assert.deepStrictEqual(verdict(c, copies, 'HASH', '02 · Finances/ailleurs'),
    { fileId: '', motif: 'hors-chemin' }, 'aucune des deux copies n\'est dans le dossier attendu');
});

/* ---------- PUR : la requête Drive ---------- */

test('qNomDrive_ : l\'APOSTROPHE française est échappée, et l\'antislash AVANT elle', () => {
  const c = ctx();
  // ⚠️ Le `q` de l'API Drive délimite ses chaînes par des apostrophes simples, et un nom de
  // document français en contient sans arrêt. Non échappée, elle ne lève pas une erreur : elle
  // change la REQUÊTE, donc les candidats, donc le verdict.
  assert.match(c.qNomDrive_("Contrat d'assurance.pdf"), /^name = 'Contrat d\\'assurance\.pdf'/);
  // L'antislash d'abord, sinon on échappe l'échappement qu'on vient de poser.
  assert.match(c.qNomDrive_('a\\b'), /^name = 'a\\\\b'/);
  assert.match(c.qNomDrive_('x.pdf'), /trashed = false/, 'un fichier à la corbeille n\'est pas un candidat');
  // ⚠️ Les RACCOURCIS sont écartés : ce dépôt en fabrique (`creerRaccourcisEntites_`), avec le
  // MÊME nom que le document et SANS empreinte — un raccourci pouvait devenir l'unique candidat
  // d'une ligne sans empreinte, et le verdict positif portait alors sur un objet qui n'est même
  // pas le fichier (revue de code).
  assert.match(c.qNomDrive_('x.pdf'), /mimeType != 'application\/vnd\.google-apps\.shortcut'/);
});

test('segmentsChemin_ : le chemin ENTIER, pas seulement le dernier dossier', () => {
  const c = ctx();
  // ⚠️ REMPLACE `dernierSegmentChemin_`, retirée après la revue de sécurité : le nom d'un
  // dossier ne prouve pas son identité. `2025` existe sous chacun des neuf domaines, et un
  // homonyme rangé sous `03 · Logement/2025` serait devenu l'unique candidat d'une ligne
  // `02 · Finances/2025` — verdict POSITIF, donc définitif de fait.
  assert.deepStrictEqual(Array.from(c.segmentsChemin_('02 · Finances/2025')), ['02 · Finances', '2025']);
  assert.deepStrictEqual(Array.from(c.segmentsChemin_('02 · Finances/2025/')), ['02 · Finances', '2025'],
    'une barre finale ne crée pas un dossier');
  assert.deepStrictEqual(Array.from(c.segmentsChemin_('04 · Immigration')), ['04 · Immigration']);
  assert.deepStrictEqual(Array.from(c.segmentsChemin_('')), []);
});

test('le chemin COMPLET discrimine là où le dernier segment acceptait un homonyme', () => {
  const c = ctx();
  // LE scénario de la revue de sécurité, joué en entier : ligne d'Index sans empreinte, sous
  // `02 · Finances/2025` ; le fichier d'origine a été renommé depuis ; un homonyme existe sous
  // `03 · Logement/2025`. Avec l'ancien prédicat, son dossier s'appelait `2025` ⇒ accepté.
  const homonyme = [{ id: ID('z'), empreinte: '', chemins: ['03 · Logement/2025'] }];
  assert.deepStrictEqual(verdict(c, homonyme, '', '02 · Finances/2025'),
    { fileId: '', motif: 'hors-chemin' });
  // Et le multi-parents reste servi : un fichier qui EST sous les deux est accepté.
  const deuxParents = [{ id: ID('z'), empreinte: '', chemins: ['03 · Logement/2025', '02 · Finances/2025'] }];
  assert.deepStrictEqual(verdict(c, deuxParents, '', '02 · Finances/2025'),
    { fileId: ID('z'), motif: 'chemin' });
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
  c.feuille_ = () => {
    if (opts.indexLeve) throw new Error('Sheet indisponible (simulé)');
    return {
      getLastRow: () => (opts.lignes || []).length + 1,
      getRange: (r, col, n) => (n === undefined
        ? { setValue: (v) => {
            if (opts.ecritureLeve) throw new Error('plage protégée (simulé)');
            ecrits[r + ':' + col] = v;
          } }
        : { getValues: () => opts.lignes }),
    };
  };
  c.candidatsPourNom_ = (nom, profondeur) => {
    cherches.push(nom + '@' + profondeur);
    if (opts.leve) throw new Error('réseau indisponible (simulé)');
    return { candidats: (opts.candidats || {})[nom] || [], tropNombreux: !!opts.tropNombreux };
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
    candidats: { 'Trouve.pdf': [{ id: ID('a'), empreinte: 'HASH', chemins: ['02 · Finances/2025'] }] },
  });
  c.etapeResolutionFileId_(() => false, {});
  // ⚠️ Cellule par cellule et non un `setValues` en bloc : les rangs choisis ne sont PAS
  // contigus (seules les lignes sans fileId entrent), donc un bloc écraserait les voisines —
  // c'est-à-dire précisément les lignes qui portent déjà un identifiant.
  assert.strictEqual(ecrits['2:9'], ID('a'), 'ligne 1 de données ⇒ rangée 2, colonne 9');
  assert.strictEqual(ecrits['3:9'], '!introuvable|' + c.CONFIG.RESOLUTION_FILEID_TAG);
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|1\/1\/2\|/,
    'résolus / refusés / ÉCRITES — décider n\'est pas écrire, et le troisième chiffre le dit');
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

/* ---------- CORRECTIFS DE REVUE (21/09) ---------- */

test('une page PLEINE refuse — la troncature RETIRE des candidats, donc elle fabrique des uniques', () => {
  const c = ctx();
  // ⚠️ Le commentaire d'origine affirmait l'inverse : « au-delà du plafond, le choix refusera de
  // toute façon ». FAUX, et dans le sens dangereux — le refus vient d'avoir DEUX candidats.
  assert.deepStrictEqual(
    verdict4(c, [{ id: ID('a'), empreinte: '', chemins: ['02 · Finances/2025'] }], '', '02 · Finances/2025', true),
    { fileId: '', motif: 'trop-d-homonymes' });
});

test('le seul exemplaire qui porte l\'empreinte, mais dans `_Doublons`, est REFUSÉ', () => {
  const c = ctx();
  const rebut = [{ id: ID('a'), empreinte: 'HASH', chemins: ['02 · Finances/_Doublons'] }];
  // Le contenu est PROUVÉ, le LIEU ne l'est pas : accepter ferait pointer la Mémoire sur
  // l'exemplaire qu'on a délibérément écarté, avec le chemin de l'Index qui dit autre chose.
  assert.deepStrictEqual(verdict(c, rebut, 'HASH', '02 · Finances/2025'),
    { fileId: '', motif: 'exemplaire-ecarte' });
  // ⚠️ Contrôle inverse : une ligne que l'Index range DANS `_Doublons` n'est pas concernée.
  assert.deepStrictEqual(verdict(c, rebut, 'HASH', '02 · Finances/_Doublons'),
    { fileId: ID('a'), motif: 'empreinte' });
});

test('une chaîne de dossiers ILLISIBLE est une panne, jamais un refus figé', () => {
  const c = ctx();
  const v = c.choisirResolutionFileId_(
    [{ id: ID('a'), empreinte: '', chemins: [], illisible: true }], '', '02 · Finances/2025', false);
  assert.strictEqual(v.motif, 'chemin-illisible');
  assert.strictEqual(v.panne, true,
    'un blip Drive sur UN dossier ne doit pas écrire « hors-chemin » jusqu\'au prochain bump');
});

test('un candidat sans identifiant plausible ne devient JAMAIS un verdict positif', () => {
  const c = ctx();
  // `String(null)` vaut « null », une chaîne TRUTHY : elle aurait été comptée « retrouvée » et
  // écrite dans la colonne. Le module refuse dans le doute partout ailleurs.
  assert.deepStrictEqual(
    verdict(c, [{ id: null, empreinte: '', chemins: ['02 · Finances/2025'] }], '', '02 · Finances/2025'),
    { fileId: '', motif: 'id-illisible' });
  assert.deepStrictEqual(verdict(c, [{ id: 'trop-court', empreinte: 'H', chemins: [] }], 'H', ''),
    { fileId: '', motif: 'id-illisible' });
});

test('« aucun candidat n\'a d\'empreinte » n\'est pas « ce n\'est pas ce document »', () => {
  const c = ctx();
  // Un Google Doc natif n'a pas de md5. Confondre les deux causes envoie chercher au mauvais
  // endroit : l'une dit « le fichier a changé », l'autre « ce type de fichier n'a pas d'empreinte ».
  assert.deepStrictEqual(
    verdict(c, [{ id: ID('a'), empreinte: '', chemins: ['02 · Finances/2025'] }], 'HASH', '02 · Finances/2025'),
    { fileId: '', motif: 'candidats-sans-empreinte' });
  assert.deepStrictEqual(
    verdict(c, [{ id: ID('a'), empreinte: 'AUTRE', chemins: [] }], 'HASH', ''),
    { fileId: '', motif: 'empreinte-differente' });
});

test('une coupure au PREMIER item ne fait pas sauter une page entière', () => {
  const lignes = [];
  for (let i = 0; i < 100; i++) lignes.push(ligne(CLE_GMAIL, 'f' + i + '.pdf', '02 · Finances', 'classé'));
  // Passe 1 : complète (40 lignes), curseur à 40.
  const p1 = passe({ lignes });
  p1.c.etapeResolutionFileId_(() => false, {});
  assert.strictEqual(p1.props.DriveAI_RESOLUTION_FILEID_FIN.split('|')[4], '40');
  // Passe 2 : le garde tire AVANT le premier item — rien n'est examiné.
  const p2 = passe({ lignes, props: p1.props });
  p2.c.etapeResolutionFileId_(() => true, {});
  assert.strictEqual(p2.cherches.length, 0, 'aucun item traité');
  // ⚠️ LE DÉFAUT : le curseur valait « après la 40ᵉ de CETTE page », soit 80 — quarante lignes
  // jamais examinées, perdues pour toujours, et la Santé annonçait « termine ». Mesuré en revue :
  // 60 résolues sur 100.
  assert.strictEqual(p2.props.DriveAI_RESOLUTION_FILEID_FIN.split('|')[4], '40',
    'le curseur reste où la sélection a COMMENCÉ tant que rien n\'a été tranché');
});

test('« terminé » ne se prononce que sur un tour parti de ZÉRO', () => {
  // Deux lignes déjà tranchées, curseur persisté sur la SECONDE : le scan ne dit rien de la
  // première. Prononcer « terminé » là-dessus fermerait la porte à vie sur une campagne
  // incomplète — et trois mécanismes y laissent des lignes (coupure, échec d'écriture,
  // suppression de lignes d'Index qui décale la numérotation).
  const lignes = [
    ligne(CLE_GMAIL, 'a.pdf', '02 · Finances', 'classé', '', ID('y')),
    ligne(CLE_GMAIL, 'b.pdf', '02 · Finances', 'classé', '', ID('z')),
  ];
  const p = passe({
    lignes,
    props: {
      DriveAI_RESOLUTION_FILEID_TAG: 'c49-16-a',
      DriveAI_RESOLUTION_FILEID_FIN: '2026-09-21T10:00:00.000Z|page|1/0/1|0|1|',
    },
  });
  p.c.etapeResolutionFileId_(() => false, {});
  const champs = p.props.DriveAI_RESOLUTION_FILEID_FIN.split('|');
  assert.strictEqual(champs[1], 'tour', 'un scan partiel rend la main, il ne ferme pas la porte');
  assert.strictEqual(champs[4], '0', 'et il remet le curseur à zéro pour un dernier tour complet');
});

test('la phrase terminale lit le CUMUL de campagne, pas la dernière passe', () => {
  const c = ctx();
  // ⚠️ La passe qui CONCLUT est justement celle qui n'a plus rien trouvé : sans cumul, la seule
  // ligne qui dise si les 734 documents sont redevenus désignables annonce « 0 retrouvés ».
  const p = c.phraseResolutionFileId_(
    { ts: 'x', fin: 'termine', fini: true, restants: 0, resolus: 0, refuses: 0,
      cumul: { resolus: 700, refuses: 34 } });
  assert.match(p, /✅ terminée — 700 retrouvés, 34 sans preuve/);
  // Une chaîne d'avant ce correctif n'invente pas un zéro : elle dit qu'elle ne sait pas.
  assert.match(
    c.phraseResolutionFileId_({ ts: 'x', fin: 'termine', fini: true, restants: 0, cumul: null }),
    /compteurs de campagne absents/);
});

test('une PANNE suspend la passe, et la Santé dit depuis quand ET pourquoi', () => {
  const c = ctx();
  const ilYaDixMinutes = Date.now() - 10 * 60 * 1000;
  // ⚠️ Sans suspension, un refus Drive persistant fait re-lire l'Index ENTIER à chaque tick pour
  // re-échouer : ~20-30 min de runtime par jour, indéfiniment, et INVISIBLES au test d'enveloppe
  // (qui ne somme que des constantes `*_BUDGET_JOUR_MS` nommées).
  assert.strictEqual(
    c.resolutionFileIdDoitTourner_({ ts: 'x' }, 'c49-16-a', 'c49-16-a',
      ilYaDixMinutes + c.CONFIG.RESOLUTION_FILEID_RESONDE_MS, Date.now()),
    false);
  // Mais un BUMP passe AVANT la suspension : elle ne doit jamais empêcher Marc de relancer.
  assert.strictEqual(
    c.resolutionFileIdDoitTourner_({ ts: 'x' }, 'vieux', 'c49-16-a',
      ilYaDixMinutes + c.CONFIG.RESOLUTION_FILEID_RESONDE_MS, Date.now()),
    true);
  const phrase = c.phraseResolutionFileId_({ ts: 'x', resolus: 12 },
    { depuisMs: ilYaDixMinutes, cause: 'drive : 403 quota' });
  assert.match(phrase, /suspendue depuis/);
  assert.match(phrase, /403 quota/, 'quatre causes, quatre gestes — « panne » seul les confond');
  assert.doesNotMatch(phrase, /12 retrouvés/, 'un compteur vrai est trompeur quand la passe est morte');
});

test('la passe se suspend quand AUCUNE cellule ne s\'écrit', () => {
  const { c, props, ecrits } = passe({
    lignes: [ligne(CLE_GMAIL, 'f.pdf', '02 · Finances', 'classé')],
    ecritureLeve: true,
  });
  c.etapeResolutionFileId_(() => false, {});
  assert.deepStrictEqual(ecrits, {});
  // Sans ça : la ligne est re-sélectionnée au run suivant, donc re-payée en recherche Drive,
  // indéfiniment — pendant que « 1 retrouvé » s'affiche. Un compteur d'envoyés, pas d'écrits.
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|panne-ecriture\|/);
  assert.ok(props.DriveAI_RESOLUTION_FILEID_PANNE, 'et la panne est persistée, donc la gate se ferme');
});

test('un Index illisible le DIT, au lieu de laisser la Santé sur la passe précédente', () => {
  const { c, props } = passe({ lignes: [], indexLeve: true });
  c.etapeResolutionFileId_(() => false, {});
  assert.match(props.DriveAI_RESOLUTION_FILEID_FIN, /\|index-illisible\|/,
    '« Index illisible », « jamais atteinte » et « tout va bien » ne doivent pas se ressembler');
});

test('une ligne SANS NOM ne paie pas de recherche Drive', () => {
  const c = ctx();
  const r = c.selectionnerAResoudre_(
    [ligne(CLE_GMAIL, '', '02 · Finances', 'classé')], 'c49-16-a', 0, 10);
  assert.strictEqual(r.choisies.length, 0);
  assert.strictEqual(r.restants, 0,
    'et elle ne compte pas dans les restants, sinon le compteur ne tombe jamais à zéro');
});

test('le RATTRAPAGE transmet le fileId — sans lui, tout le lot est inerte sur son seul consommateur', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RattrapagePiece.gs'), 'utf8');
  // ⚠️ GARDE DE CHAÎNON. `pieceMemoire_` lit `fileIdDeLigneIndex_(ligne)` : sans ce champ, il
  // retombe sur la CLÉ — qui n'en porte aucun pour une pièce jointe Gmail — donc il rend `null`,
  // le verdict devient « piece-vide », et le document est marqué « fait » DÉFINITIVEMENT… après
  // avoir payé l'extraction Haiku. Une boucle inerte qui facture, sur `04` en premier.
  const appel = src.slice(src.indexOf('var envoi = pousserPieceApresClassement_('));
  assert.ok(appel.slice(0, 400).includes('fileId: doc.fileId'),
    'le fileId doit voyager jusqu\'à `pousserPieceApresClassement_`');
});
