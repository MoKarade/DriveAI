'use strict';
/**
 * test/perimetre-piece.test.js — C49-4 étape A : COMBIEN de documents la Mémoire aurait à lire.
 *
 * Ce que ces cas défendent :
 *   1. le compte ne porte QUE ce qui est classé et identifiable — l'Index contient aussi des
 *      lignes qui ne désignent aucun fichier, et les compter gonflerait une promesse ;
 *   2. l'EXCLUSION est fermée, l'inclusion est ouverte : une extension inconnue reste
 *      candidate, parce que le sens qui SOUS-compte fait promettre une campagne moins chère
 *      qu'elle ne l'est, et l'erreur ne se voit qu'une fois lancée ;
 *   3. la gate est un TAG, pas un compteur : la passe est ONE-SHOT et doit pouvoir être
 *      relancée sans qu'on la laisse relire 20 000 lignes toutes les cinq minutes ;
 *   4. « jamais mesuré » et « mesuré, zéro candidat » ne se ressemblent pas — c'est
 *      exactement la confusion qui a rendu une panne muette le 16/09 ;
 *   5. l'étape est branchée au tick ET à la Santé : un comptage que personne ne déclenche et
 *      que personne ne lit ne mesure rien.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'PerimetrePiece.gs']);
}

/** Une ligne d'Index : [clé, traité le, fichier, domaine, chemin, statut]. */
const ligne = (cle, nom, domaine, statut) => [cle, '', nom, domaine, '', statut];
const CLE = (id) => 'drive|' + id;
const ID = 'a'.repeat(28);

/* ---------- PUR : l'extension ---------- */

test('extensionPerimetre_ : le point d\'une DATE n\'est pas une extension', () => {
  const c = ctx();
  assert.strictEqual(c.extensionPerimetre_('2026-03-01_Permis_IRCC.pdf'), 'pdf');
  assert.strictEqual(c.extensionPerimetre_('RELEVE.PDF'), 'pdf', 'la casse ne décide de rien');
  assert.strictEqual(c.extensionPerimetre_('2026-03-01_Permis_IRCC'), '(sans)');
  // ⚠️ LE CAS QUI DISCRIMINE : un `lastIndexOf('.')` naïf rendrait « 01_permis_ircc » comme
  // extension, donc une extension INCONNUE — sans conséquence ici (inclusion ouverte), mais
  // le tableau par extension deviendrait illisible, et c'est lui qui dimensionne la campagne.
  assert.strictEqual(c.extensionPerimetre_('2026.03.01_Permis_IRCC'), '(sans)');
  assert.strictEqual(c.extensionPerimetre_(''), '(sans)');
  assert.strictEqual(c.extensionPerimetre_(null), '(sans)');
});

test('estCandidatPiece_ : l\'exclusion est FERMÉE, l\'inclusion est OUVERTE', () => {
  const c = ctx();
  assert.strictEqual(c.estCandidatPiece_('vacances.mp4'), false);
  assert.strictEqual(c.estCandidatPiece_('sauvegarde.zip'), false);
  assert.strictEqual(c.estCandidatPiece_('note.pdf'), true);
  assert.strictEqual(c.estCandidatPiece_('photo.jpg'), true, 'une photo de papier EST un papier');
  // ⚠️ Le sens du doute : une extension que personne n'a prévue reste CANDIDATE. Dans l'autre
  // sens, elle disparaîtrait du compte, donc de la durée annoncée et du coût annoncé — et
  // l'écart ne se verrait qu'une fois la campagne lancée.
  assert.strictEqual(c.estCandidatPiece_('truc.xyz9'), true);
  assert.strictEqual(c.estCandidatPiece_('sans_extension'), true);
});

/* ---------- PUR : le comptage ---------- */

test('compterPerimetrePiece_ ne compte que le CLASSÉ et l\'IDENTIFIABLE', () => {
  const c = ctx();
  const lignes = [
    ligne(CLE(ID + '1'), 'a.pdf', '04 · Immigration', 'classé'),
    ligne(CLE(ID + '2'), 'b.pdf', '04 · Immigration', 'en revue'),   // pas classé
    ligne('intention|fil123', 'c.pdf', '04 · Immigration', 'classé'), // aucun fileId
    ligne(CLE(ID + '3'), 'film.mp4', '09 · Voyages', 'classé'),       // écarté
    ligne(CLE(ID + '4'), 'd.jpg', '01 · Administratif', 'classé'),
  ];
  const res = c.compterPerimetrePiece_(lignes, c.fileIdDeLigneIndex_);
  assert.strictEqual(res.lues, 5);
  assert.strictEqual(res.classees, 3, 'trois lignes classées ET porteuses d\'un fileId');
  assert.strictEqual(res.candidats, 2);
  assert.strictEqual(res.exclus, 1, 'la vidéo est écartée, et elle se COMPTE');
  // ⚠️ `deepStrictEqual` échoue ici sur l'IDENTITÉ du prototype : les objets naissent dans le
  // bac à sable `vm`, donc leur `Object.prototype` n'est pas celui du test. On compare donc la
  // VALEUR (aller-retour JSON), jamais la référence.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.parDomaine)),
    { '04 · Immigration': 1, '01 · Administratif': 1 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.parExtension)), { pdf: 1, jpg: 1 });
  // ⚠️ L'arithmétique doit fermer : candidats + exclus = classées. Sans elle, une ligne qui
  // disparaît entre les deux compteurs ne se voit nulle part.
  assert.strictEqual(res.candidats + res.exclus, res.classees);
});

test('un Index vide rend des zéros, jamais une exception', () => {
  const c = ctx();
  const res = c.compterPerimetrePiece_([], c.fileIdDeLigneIndex_);
  assert.strictEqual(res.candidats, 0);
  assert.strictEqual(res.lues, 0);
});

test('tetePerimetre_ est DÉTERMINISTE à égalité de compte', () => {
  const c = ctx();
  // Sans le départage par nom, deux exécutions sur le même Drive peuvent rendre deux phrases
  // différentes — et on croit que quelque chose a bougé.
  assert.deepStrictEqual(Array.from(c.tetePerimetre_({ b: 3, a: 3, z: 9 }, 3)), ['z', 'a', 'b']);
  assert.deepStrictEqual(Array.from(c.tetePerimetre_({ b: 3, a: 3, z: 9 }, 1)), ['z']);
});

/* ---------- PUR : la gate et la phrase ---------- */

test('perimetreDoitTourner_ : le TAG décide, et lui seul', () => {
  const c = ctx();
  assert.strictEqual(c.perimetreDoitTourner_(null, 'c49-4-a'), true, 'jamais mesuré');
  assert.strictEqual(c.perimetreDoitTourner_('c49-4-a', 'c49-4-a'), false, 'déjà mesuré sous ce tag');
  assert.strictEqual(c.perimetreDoitTourner_('c49-4-a', 'c49-4-b'), true, 'un bump relance');
});

test('C49-26 — perimetreDoitTourner_ : une fois par JOUR aussi, quand on lui passe les jours', () => {
  const c = ctx();
  assert.strictEqual(c.perimetreDoitTourner_('t', 't', '2026/09/23', '2026/09/23'), false, 'déjà compté aujourd\'hui');
  assert.strictEqual(c.perimetreDoitTourner_('t', 't', '2026/09/22', '2026/09/23'), true,
    'un nouveau jour recompte : le dénominateur de « Import » doit suivre les documents classés depuis');
  assert.strictEqual(c.perimetreDoitTourner_('t', 't', null, '2026/09/23'), true, 'jour jamais posé ⇒ on compte');
  assert.strictEqual(c.perimetreDoitTourner_('t', 'u', '2026/09/23', '2026/09/23'), true, 'le tag décide toujours');
});

test('« jamais mesuré » et « mesuré, zéro candidat » ne se ressemblent pas', () => {
  const c = ctx();
  const jamais = c.phrasePerimetrePiece_('');
  assert.match(jamais, /jamais mesuré/);
  assert.match(jamais, /PERIMETRE_PIECE_TAG/, 'la phrase doit dire le GESTE, pas seulement l\'état');

  const zero = c.phrasePerimetrePiece_('2026-09-17T16:00:00.000Z|c49-4-a|0/0/20346|0||');
  assert.match(zero, /0 papiers candidats/);
  assert.doesNotMatch(zero, /jamais mesuré/,
    'un comptage qui rend zéro est une MESURE : elle appelle une enquête, pas un bump de tag');
});

test('la phrase de Santé annonce une BORNE HAUTE, jamais une prévision', () => {
  const c = ctx();
  const p = c.phrasePerimetrePiece_(
    '2026-09-17T16:04:00.000Z|c49-4-a|15000/18000/20346|3000|04=900,01=800|pdf=12000,jpg=2000');
  assert.match(p, /15000 papiers candidats sur 18000 documents classés/);
  assert.match(p, /3000 écartés/);
  assert.match(p, /04=900/);
  // ⚠️ « peut porter du texte » n'est pas « en porte ». Sans cette mention, le nombre se lit
  // comme une promesse, et c'est le taux de « sans texte » de l'audit qui la démentirait.
  assert.match(p, /borne HAUTE/);
});

test('encoderPerimetrePiece_ BORNE ce qu\'il persiste', () => {
  const c = ctx();
  const parDomaine = {};
  for (let i = 0; i < 40; i++) parDomaine['dom' + i] = 100 - i;
  const chaine = c.encoderPerimetrePiece_(
    { lues: 1, classees: 1, candidats: 1, exclus: 0, parDomaine, parExtension: {} },
    'c49-4-a', '2026-09-17T16:00:00.000Z');
  const doms = chaine.split('|')[4].split(',');
  // ⚠️ Une Property plafonne vers 9 Ko et le registre de suivi C28-44 est déjà saturé : la
  // carte complète n'y entre pas. Le détail COMPLET se lit par le diagnostic, qui ne persiste
  // rien — un diagnostic n'a pas à tenir dans un budget d'écriture.
  assert.strictEqual(doms.length, c.PERIMETRE_PIECE_TOP);
  assert.ok(chaine.length < 500, 'la chaîne persistée reste petite quoi qu\'il arrive');
});

/* ---------- L'ÉTAPE : ce qu'elle écrit, et ce qu'elle n'écrit pas ---------- */

function montage(lignesIndex, props) {
  const feuille = lignesIndex === null ? null : {
    getLastRow: () => lignesIndex.length + 1,
    getRange: () => ({ getValues: () => lignesIndex }),
  };
  const c = load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'PerimetrePiece.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
      }),
    },
  });
  // ⚠️ APRÈS le chargement : `Config.gs` définit `feuille_`, donc un override passé au sandbox
  // serait ÉCRASÉ au load et la mutation resterait muette.
  c.feuille_ = () => feuille;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  return c;
}

test('l\'étape écrit le compte ET le tag, et la gate se referme', () => {
  const props = new Map();
  const c = montage([
    ligne(CLE(ID + '1'), 'a.pdf', '04 · Immigration', 'classé'),
    ligne(CLE(ID + '2'), 'b.mp4', '09 · Voyages', 'classé'),
  ], props);

  const res = c.etapePerimetrePiece_();
  assert.strictEqual(res.candidats, 1);
  assert.strictEqual(props.get('DriveAI_PERIMETRE_PIECE_TAG'), c.CONFIG.PERIMETRE_PIECE_TAG);
  assert.match(props.get('DriveAI_PERIMETRE_PIECE'), /\|1\/2\/2\|1\|/);
  // La boucle est complète : ce que l'étape écrit referme bien la gate qui l'appelle.
  assert.strictEqual(
    c.perimetreDoitTourner_(props.get('DriveAI_PERIMETRE_PIECE_TAG'), c.CONFIG.PERIMETRE_PIECE_TAG),
    false);
});

test('un Index VIDE ne pose pas le tag — sinon la mesure n\'a jamais lieu', () => {
  const props = new Map();
  const c = montage(null, props);
  assert.strictEqual(c.etapePerimetrePiece_(), null);
  // ⚠️ Poser le tag ici figerait « jamais mesuré » à vie sur un Index momentanément illisible :
  // un blip Google deviendrait une absence de mesure permanente, sans rien de rouge.
  assert.strictEqual(props.has('DriveAI_PERIMETRE_PIECE_TAG'), false);
  assert.strictEqual(
    c.perimetreDoitTourner_(props.get('DriveAI_PERIMETRE_PIECE_TAG') || null, c.CONFIG.PERIMETRE_PIECE_TAG),
    true, 'la gate doit rester OUVERTE');
});

/* ---------- LE CÂBLAGE : appelée par le tick, lue par la Santé ---------- */

test('le tick appelle l\'étape, gatée par le TAG, et l\'enveloppe', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  assert.ok(/etapePerimetrePiece_\(/.test(code), 'le tick doit APPELER la passe, pas seulement la définir');
  const debut = code.indexOf('perimetreDoitTourner_(');
  const fin = code.indexOf('etapePerimetrePiece_(');
  assert.ok(debut !== -1 && fin > debut, 'la gate pure doit précéder l\'appel');
  const bloc = code.slice(debut, fin);
  assert.match(bloc, /PERIMETRE_PIECE_TAG/, 'la gate lit le TAG de la config, jamais un littéral');
  // ⚠️ Le budget de TICK garde l'étape (elle lit 20 000 lignes), mais PAS le frein LLM : elle
  // ne peut dépenser aucun dollar, et l'y soumettre ferait attendre la MESURE qui dimensionne
  // la campagne à cause d'un budget qu'elle ne consomme pas.
  assert.match(bloc, /estBudgetDepasse\(\)/, 'le budget de tick garde l\'étape');
  const apres = code.slice(fin, fin + 400);
  assert.match(apres, /catch[\s\S]{0,60}journalErreur_\('PerimetrePiece'/,
    'ENVELOPPÉE : un échec du comptage ne doit jamais bloquer l\'intake, et il doit se DIRE');
});

test('la Santé publie la ligne — un comptage que personne ne lit ne mesure rien', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  assert.match(code, /Périmètre des pièces \(C49-4\) : ' \+ texteSantePerimetrePiece_\(\)/);
});

test('aucun budget quotidien ne lui est prélevé — c\'est une passe ONE-SHOT', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  // ⚠️ Ce test défend une DÉCISION, pas un oubli : une constante `PERIMETRE_*_BUDGET_JOUR_MS`
  // coûterait sa minute TOUS LES JOURS pour une mesure qui se fait une fois, et l'invariant
  // d'enveloppe (`test/orchestration.test.js`) est aveugle à ce genre d'ajout tant que la
  // somme tient. Si un jour cette étape devient perpétuelle, ce test tombe — et c'est le
  // moment où la question « à qui prend-on la minute ? » doit être posée.
  assert.doesNotMatch(config, /PERIMETRE_[A-Z_]*BUDGET_JOUR_MS/);
});

/* ---------- LE PLANCHER : ce que la CLÉ fait disparaître (mesuré le 17/09) ---------- */

test('une ligne classée dont la CLÉ ne porte pas de fileId se COMPTE, jamais ne se saute', () => {
  const c = ctx();
  // ⚠️ LE CAS RÉEL, et il est majoritaire : la clé d'une pièce jointe Gmail est
  // `<messageId>|<rang>|<nom>|<taille>` (`cleAttachement_`), dont le premier segment n'est
  // AUCUN des quatre préfixes acceptés par `fileIdDeCleIndex_`. Le document est rangé dans le
  // Drive, il a un vrai fileId — et il est invisible ici comme il l'est pour la Mémoire
  // (`faitInventaireMemoire_` applique les deux MÊMES conditions).
  const lignes = [
    ligne(CLE(ID + '1'), 'a.pdf', '04 · Immigration', 'classé'),
    ligne('18f3c2a1b9d0e4f5|0|Facture.pdf|48213', 'Facture.pdf', '02 · Finances', 'classé'),
  ];
  const res = c.compterPerimetrePiece_(lignes, c.fileIdDeLigneIndex_);
  assert.strictEqual(res.classees, 1);
  assert.strictEqual(res.classeesSansFileId, 1,
    'la PJ Gmail doit être COMPTÉE : sans ce nombre, le total se lit comme un périmètre alors que c\'est un plancher');
  assert.strictEqual(res.candidats, 1, 'elle n\'entre pas dans les candidats — on ne sait pas la viser');
});

test('les domaines DÉCISIFS sont toujours rendus, même à zéro, et par PRÉFIXE', () => {
  const c = ctx();
  // Mesuré le 17/09 : `01` valait 87 et `04` était sous la barre des six plus gros. Une
  // troncature par volume cache donc exactement le chiffre pour lequel on mesure.
  // ⚠️ `02` a rejoint la tête le 21/09 (demande de Marc) : la liste des décisifs est aussi
  // celle que le RATTRAPAGE parcourt, une seule liste et deux consommateurs — sinon le
  // comptage promettrait une tranche et la campagne en traiterait une autre.
  assert.deepStrictEqual(
    Array.from(c.decisifsPerimetre_({ '06 · Études & diplômes': 1169, '01 · Administratif & identité': 87 })),
    ['04=0', '01=87', '02=0', '05=0', '03=0', '08=0', '06=1169', '07=0', '09=0']);
  // ⚠️ Par PRÉFIXE : le libellé se renomme, le numéro non. Un appariement sur le libellé
  // entier rendrait 0 au premier « 04 · Immigration & statut ».
  assert.deepStrictEqual(
    Array.from(c.decisifsPerimetre_({ '04 · Immigration & statut': 12, '04 · Immigration': 5 })),
    ['04=17', '01=0', '02=0', '05=0', '03=0', '08=0', '06=0', '07=0', '09=0']);
});

test('C49-26 — la tranche « tout le reste » : ordre voulu par Marc, et 04/01/02 restent en tête', () => {
  const c = ctx();
  // ⚠️ L'ORDRE est la priorité de lecture : on ne passe à `03` que quand `05` est épuisé. Le
  // 23/09, Marc a choisi « du plus court au plus long » pour que des dossiers ENTIERS finissent.
  assert.deepStrictEqual(Array.from(c.PREFIXES_DOMAINE_DECISIF_PIECE),
    ['04', '01', '02', '05', '03', '08', '06', '07', '09']);
});

test('C49-26 — les documents DISTINCTS : un document porté par plusieurs lignes ne compte qu\'une fois', () => {
  const c = ctx();
  const ID = 'a'.repeat(33);
  const ID2 = 'b'.repeat(33);
  // Trois lignes d'Index pour UN document (classé, puis migré, puis ré-analysé), une pour un autre.
  const lignes = [
    ['drive|' + ID, '', '2026-01-01_Bail_X.pdf', '03 · Logement', '', 'classé'],
    ['migre|t|' + ID, '', '2026-01-01_Bail_X.pdf', '03 · Logement', '', 'classé'],
    ['reanalyse|t|' + ID, '', '2026-01-01_Bail_X.pdf', '03 · Logement', '', 'classé'],
    ['drive|' + ID2, '', '2026-02-01_Facture_Y.pdf', '02 · Finances', '', 'classé'],
  ];
  const res = c.compterPerimetrePiece_(lignes, c.fileIdDeLigneIndex_);
  assert.strictEqual(res.classees, 4, 'les LIGNES restent comptées telles quelles');
  assert.strictEqual(res.distinctes, 2, 'mais deux DOCUMENTS seulement');
  const chaine = c.encoderPerimetrePiece_(res, 'c49-4-c', '2026-09-23T21:00:00.000Z');
  assert.strictEqual(chaine.split('|')[8], '2', 'le compte part EN QUEUE de la Property');
  assert.match(c.phrasePerimetrePiece_(chaine), /2 documents DISTINCTS/);
});

test('la phrase ANNONCE le plancher, et ne l\'invente pas quand il n\'y en a pas', () => {
  const c = ctx();
  const avecPlancher = c.phrasePerimetrePiece_(
    '2026-09-17T16:39:00.000Z|c49-4-a|3972/4240/26550|268|06=1169|pdf=3000|18000|04=31,01=87');
  assert.match(avecPlancher, /18000 lignes classées SANS fileId/);
  assert.match(avecPlancher, /PLANCHER/);
  assert.match(avecPlancher, /à pousser d'abord : 04=31,01=87/,
    'les domaines que Marc pousse en premier sont TOUJOURS nommés');

  const sansPlancher = c.phrasePerimetrePiece_(
    '2026-09-17T16:39:00.000Z|c49-4-a|3972/4240/26550|268|06=1169|pdf=3000|0|04=31,01=87');
  assert.doesNotMatch(sansPlancher, /PLANCHER/,
    'à zéro, annoncer un plancher serait une alarme permanente — donc une alarme morte');
});

test('une chaîne de l\'ANCIENNE version se relit sans inventer un zéro', () => {
  const c = ctx();
  // Six champs : la Property écrite avant ce correctif. Elle doit rester lisible, et surtout
  // ne PAS afficher « 0 lignes sans fileId », qui serait une mesure qu'on n'a pas faite.
  const p = c.phrasePerimetrePiece_('2026-09-17T16:39:00.000Z|c49-4-a|3972/4240/26550|268|06=1169|pdf=3000');
  assert.match(p, /3972 papiers candidats/);
  assert.doesNotMatch(p, /PLANCHER/);
  assert.doesNotMatch(p, /à pousser d'abord/);
});
