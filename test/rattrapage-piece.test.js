'use strict';
/**
 * test/rattrapage-piece.test.js — C49-5 étape B : faire partir le CONTENU des papiers déjà
 * classés, `04` puis `01`.
 *
 * Ce que ces cas défendent, et pourquoi chacun a été écrit :
 *   1. l'ORDRE est la demande de Marc, pas un effet de bord d'un tri — `04` passe avant `01` ;
 *   2. une PANNE DE CANAL ne se marque jamais « fait » : le document ne reviendrait ni par ce
 *      rattrapage ni par le flux, qui ne le verra plus jamais puisqu'il est déjà classé ;
 *   3. la gate lit le TAG avant le compteur — sinon l'étape s'éteint, donc le tag n'est jamais
 *      lu, donc rien ne remet de travail : l'interblocage payé le 17/09 sur l'audit ;
 *   4. la liste des documents faits vit SOUS le tag, donc un bump la vide vraiment ;
 *   5. l'idempotence tient dans une Script Property, donc elle a un plafond, et l'étape REFUSE
 *      une tranche plus grande au lieu de découvrir la limite en production ;
 *   6. trois lectures Drive impossibles D'AFFILÉE ne sont plus un verdict de document : les
 *      marques déjà posées se retirent, sinon le coupe-circuit protège le troisième et pas les
 *      deux premiers ;
 *   7. la porte de l'ADR-0061 est une LIGNE de code, pas une phrase : rien ne part tant que
 *      l'audit a des documents à extraire ;
 *   8. l'étape est branchée au tick ET à la Santé, et le canal reçoit bien le drapeau — une
 *      campagne que personne ne déclenche et que personne ne lit n'envoie rien.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

// ⚠️ `Memoire.gs` est chargé pour son VOCABULAIRE (`PHRASES_FIN_PIECE_`) : une panne de
// canal (`canal-<motif>`) se traduit avec les mots de la Mémoire, jamais avec une seconde
// table qui divergerait de la première.
const MODULES = ['Config.gs', 'Consolidation.gs', 'Journal.gs', 'PerimetrePiece.gs',
  'Memoire.gs', 'RattrapagePiece.gs'];

function ctx() { return load(MODULES); }

/** Une ligne d'Index : [clé, traité le, fichier, domaine, chemin, statut]. */
const ligne = (cle, nom, domaine, statut) => [cle, '', nom, domaine, '', statut || 'classé'];
const ID = (n) => String(n).repeat(28);
const CLE = (id) => 'drive|' + id;
const PREFIXES = ['04', '01'];

/* ---------- PUR : la sélection ---------- */

test('selectionnerRattrapage_ : 04 passe AVANT 01, et ce n\'est pas un tri', () => {
  const c = ctx();
  // L'Index est dans l'ordre inverse de la priorité : un parcours naïf rendrait `01` d'abord.
  const res = c.selectionnerRattrapage_([
    ligne(CLE(ID(1)), 'a.pdf', '01 · Administratif & identité'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
    ligne(CLE(ID(3)), 'c.pdf', '01 · Administratif & identité'),
  ], c.fileIdDeLigneIndex_, {}, PREFIXES, 10);

  assert.deepStrictEqual(Array.from(res.choisies.map((d) => d.domaine)), [
    '04 · Immigration',
    '01 · Administratif & identité',
    '01 · Administratif & identité',
  ]);
  assert.strictEqual(res.tranche, 3);
  assert.strictEqual(res.restants, 3);
});

test('selectionnerRattrapage_ : hors tranche, non classé, sans fileId et sans texte possible sortent', () => {
  const c = ctx();
  const res = c.selectionnerRattrapage_([
    ligne(CLE(ID(1)), 'garde.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'hors.pdf', '06 · Études & diplômes'),
    ligne(CLE(ID(3)), 'brouillon.pdf', '04 · Immigration', 'à vérifier'),
    // ⚠️ Une PJ Gmail : rangée pour de vrai, mais sa clé ne porte aucun fileId. Elle est hors
    // du canal — et surtout hors des RESTANTS, sinon le compteur ne tomberait jamais à zéro et
    // la tranche ne se terminerait jamais.
    ['msg123|0|scan.pdf|8421', '', 'scan.pdf', '04 · Immigration', '', 'classé'],
    ligne(CLE(ID(5)), 'clip.mp4', '04 · Immigration'),
  ], c.fileIdDeLigneIndex_, {}, PREFIXES, 10);

  assert.strictEqual(res.choisies.length, 1);
  assert.strictEqual(res.choisies[0].nom, 'garde.pdf');
  assert.strictEqual(res.tranche, 1);
});

test('selectionnerRattrapage_ : les faits sortent de la sélection mais restent dans la TRANCHE', () => {
  const c = ctx();
  const faits = {}; faits[ID(1)] = 1;
  const res = c.selectionnerRattrapage_([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], c.fileIdDeLigneIndex_, faits, PREFIXES, 10);

  assert.strictEqual(res.choisies.length, 1, 'un document fait ne repart pas');
  assert.strictEqual(res.restants, 1);
  // ⚠️ La TRANCHE compte tout : c'est elle qui se compare au plafond de la Property, et un
  // compte qui rétrécirait à mesure qu'on avance laisserait la liste déborder en silence.
  assert.strictEqual(res.tranche, 2);
});

test('selectionnerRattrapage_ : le plafond borne la SÉLECTION, jamais le compte', () => {
  const c = ctx();
  const lignes = [];
  for (let i = 0; i < 9; i++) lignes.push(ligne(CLE(ID(i)), i + '.pdf', '04 · Immigration'));
  const res = c.selectionnerRattrapage_(lignes, c.fileIdDeLigneIndex_, {}, PREFIXES, 3);
  assert.strictEqual(res.choisies.length, 3);
  assert.strictEqual(res.restants, 9);
});

/* ---------- PUR : le classement des issues ---------- */

test('issueRattrapage_ : un motif INCONNU est une PANNE, jamais un fait', () => {
  const c = ctx();
  assert.strictEqual(c.issueRattrapage_('ok'), 'fait');
  assert.strictEqual(c.issueRattrapage_('refusee'), 'fait');
  assert.strictEqual(c.issueRattrapage_('sans-texte'), 'sans-texte');
  assert.strictEqual(c.issueRattrapage_('extraction-vide'), 'echec');
  assert.strictEqual(c.issueRattrapage_('lecture-impossible'), 'echec');
  // Les six gardes de `verdictPiece_` et les quatre raisons d'envoi : toutes des pannes.
  ['desactive', 'jeton-absent', 'suspendu', 'frein-budget', 'panne-llm', 'plafond-run',
    'reseau', 'jeton-refuse', 'perimetre-retire', 'panne'].forEach((m) => {
    assert.strictEqual(c.issueRattrapage_(m), 'panne', m + ' doit être une panne');
  });
  // ⚠️ LE CAS QUI COMPTE : un motif que personne n'a prévu. La table énumère les VERDICTS, donc
  // l'inconnu tombe du côté panne — le document reste à faire, ce qui coûte un re-examen. Dans
  // l'autre sens il serait marqué fait, donc perdu pour toujours.
  assert.strictEqual(c.issueRattrapage_('motif-invente-demain'), 'panne');
  assert.strictEqual(c.issueRattrapage_(''), 'panne');
  assert.strictEqual(c.issueRattrapage_(null), 'panne');
});

/* ---------- PUR : la gate et la liste des faits ---------- */

test('rattrapageDoitTourner_ : le TAG est lu AVANT le compteur', () => {
  const c = ctx();
  // Tranche non armée : rien ne tourne, quoi que dise le compteur.
  assert.strictEqual(c.rattrapageDoitTourner_(42, '', ''), false);
  assert.strictEqual(c.rattrapageDoitTourner_(null, '', ''), false);
  // ⚠️ LE CAS QUI DISCRIMINE, et c'est l'interblocage du 17/09 : le compteur dit « plus rien à
  // faire » ET le tag vient de changer. Une gate qui ne lirait que le compteur resterait
  // éteinte pour toujours — donc ne lirait jamais le tag, donc ne remettrait jamais de travail.
  assert.strictEqual(c.rattrapageDoitTourner_(0, 'c49-5-a', 'c49-5-b'), true);
  assert.strictEqual(c.rattrapageDoitTourner_(0, 'c49-5-b', 'c49-5-b'), false);
  assert.strictEqual(c.rattrapageDoitTourner_(7, 'c49-5-b', 'c49-5-b'), true);
  // « je ne sais pas » n'est pas « zéro » : au premier passage la Property n'existe pas, et
  // s'éteindre sur une ignorance serait s'éteindre définitivement.
  assert.strictEqual(c.rattrapageDoitTourner_(null, 'c49-5-b', 'c49-5-b'), true);
});

test('la liste des faits vit SOUS le tag : un bump la vide vraiment', () => {
  const c = ctx();
  // ⚠️ L'idempotence a quitté la Script Property le 21/09/2026 (voir le cas du plafond plus
  // bas) : elle vit dans l'onglet `PiecesFaites`, une ligne par document. Ce que ce cas défend
  // n'a PAS changé — c'est le filtrage par tag, sans lequel bumper pour tout refaire
  // laisserait l'ancienne liste en place et la campagne relancée ne traiterait rien.
  const lignes = [[ID(1), 'c49-5-a', '2026-09-18 10:00'], [ID(2), 'c49-5-a', '2026-09-18 10:01']];

  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(lignes, 'c49-5-a')).sort(), [ID(1), ID(2)].sort());
  // ⚠️ `deepStrictEqual` contre `{}` échoue ici : l'objet naît dans le sandbox `vm` et n'a
  // donc pas le `Object.prototype` de l'hôte — « same structure but not reference-equal ».
  // On compare les CLÉS, qui reviennent en tableau de l'hôte.
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_(lignes, 'c49-5-b')), [],
    'les lignes d\'un tag précédent RESTENT dans l\'onglet — elles ne doivent rien freiner');
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_(null, 'c49-5-a')), []);
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_([], 'c49-5-a')), []);
  // Une ligne sans fileId ne compte pas : elle rendrait « fait » un document vide.
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_([['', 'c49-5-a', '']], 'c49-5-a')), []);
});

/* ---------- PUR : ce que la Santé dit ---------- */

test('phraseFinRattrapage_ : « non armée », « jamais passée » et « terminée » ne se ressemblent pas', () => {
  const c = ctx();
  assert.match(c.phraseFinRattrapage_(null, ''), /non armée/);
  assert.match(c.phraseFinRattrapage_('2026-09-18 12:00|termine|3/0/0|5|tick', ''), /non armée/,
    'un tag retiré éteint la campagne : la phrase doit le dire avant tout le reste');
  assert.match(c.phraseFinRattrapage_(null, 'c49-5-a'), /jamais passée/);
  assert.match(c.phraseFinRattrapage_('2026-09-18 12:00|termine|3/0/0|5|tick', 'c49-5-a'),
    /5 restants.*3\/0\/0.*passe terminée.*par le tick/s);
  const finie = c.phraseFinRattrapage_('2026-09-18 12:00|tranche-terminee|0/0/0|0|tick', 'c49-5-a');
  assert.match(finie, /tranche terminée/);
  // ⚠️ Qui l'a lancée : une passe MANUELLE prouve que le code est bon, jamais que le
  // déclencheur l'exécute. Sans ce mot, on lit « ça marche » sur la preuve d'un geste humain.
  assert.match(c.phraseFinRattrapage_('2026-09-18 12:00|termine|1/0/0|4|manuel', 'c49-5-a'),
    /lancée à la main/);
});

/* ---------- IMPUR : l'étape ---------- */

function montage(lignesIndex, props, options) {
  const o = options || {};
  const feuille = lignesIndex === null ? null : {
    getLastRow: () => lignesIndex.length + 1,
    getRange: () => ({ getValues: () => lignesIndex }),
  };
  const c = load(MODULES.concat(['AuditPiece.gs', 'Memoire.gs']), {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
      }),
    },
  });
  // ⚠️ APRÈS le chargement : `Config.gs` définit `feuille_`, donc un override passé au sandbox
  // serait ÉCRASÉ au load et la mutation resterait muette.
  //
  // ⚠️ DEUX onglets depuis le 21/09/2026 : l'Index, et `PiecesFaites` qui porte l'idempotence
  // (elle a quitté la Script Property, plafonnée à ~200 documents). Un seul faux `feuille_`
  // rendrait l'Index pour les deux, et la liste des faits lirait des lignes d'Index — donc des
  // clés qui ne sont pas des fileId, donc une idempotence toujours vide, en silence.
  c.faitsEcrits = [];
  // ⚠️ L'ONGLET PORTE UNE LARGEUR, et le faux doit la porter aussi : sans `getLastColumn`,
  // la réparation d'en-tête lève, le `try/catch` qui protège la persistance l'AVALE, et rien
  // n'est jamais écrit — la panne exacte déjà payée le 21/09 au matin sur `maintenant`.
  // Un faux trop pauvre ne rate pas un cas : il en fabrique un faux.
  c.largeurFaits = 3; // l'onglet déjà en prod, avant l'ajout de `Nom` et `Motif`
  c.enTetesEcrits = [];
  const feuilleFaits = {
    getLastRow: () => c.faitsEcrits.length + 1,
    getLastColumn: () => c.largeurFaits,
    getRange: (ligne, col, n) => ({
      getValues: () => c.faitsEcrits.slice(ligne - 2, ligne - 2 + n),
      setValues: (v) => {
        // La ligne 1 est l'EN-TÊTE : elle ne rejoint pas les faits, sinon le compte de
        // documents traités grandirait d'un à chaque réparation.
        if (ligne === 1) { c.enTetesEcrits.push(v[0]); c.largeurFaits = v[0].length; return; }
        for (const l of v) c.faitsEcrits.push(l);
      },
    }),
  };
  c.feuille_ = (nom) => (nom === 'PiecesFaites' ? feuilleFaits : feuille);
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  // `dateGmail_` vit dans `Gmail.gs`, non chargé ici : le charger tirerait tout l'intake pour
  // une date. Posé APRÈS le load, comme les autres.
  c.dateGmail_ = () => '2026-09-18';
  c.memoireSuspendue_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.resteAuditPiece_ = () => (o.resteAudit === undefined ? 0 : o.resteAudit);
  c.CONFIG.RATTRAPAGE_PIECE_TAG = o.tag === undefined ? 'c49-5-a' : o.tag;
  c.appels = [];
  // ⚠️ Chaque mock lit son propre ARGUMENT, jamais une fermeture figée à la construction :
  // deux documents du même run doivent pouvoir rendre deux réponses différentes (C28-33).
  c.DriveApp = { getFileById: (id) => ({ getSize: () => 10, getBlob: () => ({ id: id }) }) };
  c.extraireTexte_ = (blob) => (o.texte ? o.texte(blob.id) : 'du texte de ' + blob.id);
  c.pousserPieceApresClassement_ = (src, decision, texte, opts) => {
    c.appels.push({ cle: src.cle, nom: decision.nom, opts: opts });
    return { motif: o.motif ? o.motif(src.cle) : 'ok' };
  };
  return c;
}

test('l\'étape envoie 04 d\'abord, marque les faits et le DIT dans son signal', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '01 · Administratif & identité'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], props);

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'termine');
  assert.strictEqual(res.faits, 2);
  assert.strictEqual(res.restants, 0);
  assert.deepStrictEqual(Array.from(c.appels.map((a) => a.nom)), ['b.pdf', 'a.pdf']);
  assert.strictEqual(c.appels[0].opts.rattrapage, true,
    'le canal doit recevoir le drapeau, sinon il répond « désactivé » et rien ne part');

  const faits = c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a');
  assert.deepStrictEqual(Object.keys(faits).sort(), [ID(1), ID(2)].sort());
  assert.match(props.get('DriveAI_RATTRAPAGE_PIECE_FIN'), /\|termine\|2\/0\/0\/0\|0\|tick$/);
  assert.strictEqual(props.get('DriveAI_RATTRAPAGE_PIECE_RESTANTS'), '0');
});

test('UN DOCUMENT ILLISIBLE est compté à part, et il est MARQUÉ fait', () => {
  // ⚠️ Deux exigences opposées dans le même cas, et il faut les deux. (1) Compté À PART :
  //     noyé dans `echecs`, un lot de photos illisibles ferait chercher une panne de canal
  //     là où il n'y en a pas. (2) MARQUÉ fait : une photo illisible le reste tant que Marc
  //     ne l'a pas reprise — sans la marque, elle est re-téléchargée et re-extraite à chaque
  //     passe, à vie, et la tranche ne se termine jamais.
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'photo-passeport.jpg', '04 · Immigration'),
  ], props, { motif: () => 'illisible' });

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.illisibles, 1, 'le refus du modèle a son propre compteur');
  assert.strictEqual(res.echecs, 0, 'et il ne doit PAS ressembler à une panne');
  assert.strictEqual(res.faits, 0, 'rien n\'a été extrait : ce n\'est pas une lecture');
  const faits = c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a');
  assert.deepStrictEqual(Object.keys(faits), [ID(1)],
    'sans la marque, la photo revient à chaque passe et la tranche ne finit jamais');
  assert.strictEqual(res.restants, 0);
});

test('UNE PANNE DE CANAL ne marque rien et rend la main', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], props, { motif: () => 'jeton-refuse' });

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'canal-jeton-refuse');
  assert.strictEqual(res.faits, 0);
  // ⚠️ LE CAS LE PLUS COÛTEUX DU FICHIER. Marquer « fait » ici perdrait les deux documents À
  // VIE : ils ne reviendraient ni par le rattrapage (marqués), ni par le flux (déjà classés).
  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')), []);
  assert.strictEqual(c.appels.length, 1, 'et la boucle s\'arrête : le refus serait identique');
});

test('un verdict PROPRE AU DOCUMENT se marque, lui', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], props, { texte: (id) => (id === ID(1) ? '   ' : 'du texte') });

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.sansTexte, 1);
  assert.strictEqual(res.faits, 1);
  // Une photo illisible se marque : sans ça elle serait re-téléchargée à chaque passe, à vie,
  // et la tranche ne se terminerait jamais.
  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')).sort(),
    [ID(1), ID(2)].sort());
});

test('trois lectures Drive impossibles D\'AFFILÉE retirent les marques déjà posées', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
    ligne(CLE(ID(3)), 'c.pdf', '04 · Immigration'),
    ligne(CLE(ID(4)), 'd.pdf', '04 · Immigration'),
  ], props);
  c.DriveApp = { getFileById: () => { throw new Error('scope perdu'); } };

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'drive-illisible');
  // ⚠️ Sans le retrait des marques, le coupe-circuit protégerait le troisième document et pas
  // les deux premiers : une panne GLOBALE (scope perdu, throttle) viderait la tranche par le
  // bord. La même erreur porte des causes d'ÉCHELLES différentes, et c'est la SÉRIE qui tranche.
  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')), []);
  assert.strictEqual(res.echecs, 0);
  assert.strictEqual(res.restants, 4, 'les quatre restent à faire');
});

test('une lecture impossible ISOLÉE reste un verdict du document', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], props);
  c.DriveApp = { getFileById: (id) => {
    if (id === ID(1)) throw new Error('droits manquants sur CE fichier');
    return { getSize: () => 10, getBlob: () => ({ id: id }) };
  } };

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'termine');
  assert.strictEqual(res.echecs, 1);
  assert.strictEqual(res.faits, 1);
  // Le canal a répondu pour le second : la série est rompue, donc ce qu'elle mettait en doute
  // est confirmé et les deux marques tiennent.
  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')).sort(),
    [ID(1), ID(2)].sort());
});

test('LA PORTE DE L\'ADR-0061 : rien ne part tant que l\'audit a des documents à extraire', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props, { resteAudit: 33 });

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'audit-en-cours');
  assert.strictEqual(c.appels.length, 0);
});

test('les cinq silences du canal se distinguent, et aucun ne ressemble à « rien à faire »', () => {
  const lignes = [ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')];
  const cas = [
    ['non-armee', { tag: '' }, new Map([['DriveAI_MEMORYAI_TOKEN', 'j']])],
    ['jeton-absent', {}, new Map()],
    ['suspendu', { mock: (c) => { c.memoireSuspendue_ = () => true; } },
      new Map([['DriveAI_MEMORYAI_TOKEN', 'j']])],
    ['frein-budget', { mock: (c) => { c.budgetCampagnesAtteint_ = () => true; } },
      new Map([['DriveAI_MEMORYAI_TOKEN', 'j']])],
    ['panne-plateforme', { mock: (c) => { c.estPannePlateforme_ = () => true; } },
      new Map([['DriveAI_MEMORYAI_TOKEN', 'j']])],
  ];
  cas.forEach(([attendu, opt, props]) => {
    const c = montage(lignes, props, opt);
    if (opt.mock) opt.mock(c);
    const res = c.etapeRattrapagePiece_(() => false, {});
    assert.strictEqual(res.fin, attendu, 'motif attendu : ' + attendu);
    assert.strictEqual(c.appels.length, 0);
  });
});

test('la tranche TERMINÉE le dit, et ne réenvoie rien', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props);
  c.faitsEcrits.push([ID(1), 'c49-5-a', '2026-09-18 10:00']);

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'tranche-terminee');
  assert.strictEqual(c.appels.length, 0);
  assert.strictEqual(props.get('DriveAI_RATTRAPAGE_PIECE_RESTANTS'), '0');
});

test('⚠️ UNE TRANCHE DE PLUS DE 200 TOURNE — le plafond de la Property est levé', () => {
  // ⚠️⚠️ CE CAS S'EST INVERSÉ LE 21/09/2026, IL N'A PAS ÉTÉ SUPPRIMÉ. Il défendait « une
  // tranche plus grande que ce qu'une Script Property peut porter est REFUSÉE » — et ce refus
  // était juste : une Property qui déborde lève À L'ÉCRITURE, donc la campagne re-traiterait
  // les mêmes documents à chaque passe, en payant un appel LLM à chaque fois, sans jamais
  // avancer. La garde a d'ailleurs tiré en production le jour où Marc a demandé les 976
  // papiers de « 02 · Finances ».
  //
  // Ce qui a changé n'est pas le jugement, c'est le MÉCANISME : l'idempotence vit maintenant
  // dans l'onglet `PiecesFaites`, qui n'a pas ce plafond. Ce que ce cas défend désormais est
  // l'autre moitié de la même règle — que la levée soit RÉELLE, et pas seulement annoncée.
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const lignes = [];
  const c0 = ctx();
  for (let i = 0; i <= c0.RATTRAPAGE_PIECE_MAX_FAITS; i++) {
    lignes.push(ligne(CLE(ID(1) + i), i + '.pdf', '04 · Immigration'));
  }
  const c = montage(lignes, props);
  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.notStrictEqual(res.fin, 'tranche-trop-grande', 'le refus ne doit plus exister');
  // ⚠️ RESTANTS + TRAITÉS, jamais les seuls restants : le run en traite 5 (le plafond PAR RUN,
  // qui lui n'a pas bougé), donc le compteur redescend sous la barre au premier passage et
  // l'assertion mesurerait le plafond de run au lieu de celui de la tranche.
  assert.ok(res.restants + c.appels.length > c0.RATTRAPAGE_PIECE_MAX_FAITS,
    'la tranche entière est vue : ' + res.restants + ' restants + ' + c.appels.length + ' traités');
  assert.ok(c.appels.length > 0, 'et elle AVANCE — sinon la levée ne serait qu\'un mot');
});

test('⚠️ UNE LISTE ILLISIBLE fait S\'ABSTENIR, elle ne se lit pas « rien de fait »', () => {
  // ⚠️ ÉCHEC FERMÉ. Rendre `{}` sur une lecture ratée est la pire issue : la tranche entière
  // repartirait de zéro, en payant UN APPEL DE MODÈLE PAR DOCUMENT — et ça se répéterait à
  // chaque passe tant que l'onglet reste illisible. Une panne de Sheet deviendrait une
  // facture. Mesuré : sans le refus, 5 appels partent sur un onglet en panne.
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ], props);
  const vrai = c.feuille_;
  c.feuille_ = (nom) => {
    if (nom === 'PiecesFaites') throw new Error('Sheet indisponible');
    return vrai(nom);
  };
  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'faits-illisibles');
  assert.strictEqual(c.appels.length, 0, 'et RIEN n\'est dépensé');
});

test('⚠️ L\'IDEMPOTENCE NE REVIENT PAS DANS UNE SCRIPT PROPERTY', () => {
  // ⚠️ L'inverse du cas d'avant, et il est nécessaire : sans lui, « on a levé le plafond » se
  // réduirait à un commentaire. Ce qui est interdit ici est le RETOUR EN ARRIÈRE — une
  // prochaine session qui re-poserait la liste dans une Property « parce que c'est plus
  // simple » re-fabriquerait le mur de ~200 documents, et il ne se verrait qu'en production.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'RattrapagePiece.gs'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/setProperty\([^)]*RATTRAPAGE_PIECE_FAITS/.test(code),
    'la liste des faits ne s\'écrit plus dans une Property');
  assert.ok(/feuille_\('PiecesFaites'\)/.test(code),
    'elle vit dans l\'onglet — anti-vacuité : si ce jeton disparaît, le scan ne prouve plus rien');
  // Et la largeur ÉCRITE suit l'en-tête : une colonne ajoutée à l'un sans l'autre décalerait
  // tout ce qui suit, sans erreur, dans un onglet append-only qui ne se corrige pas.
  // ⚠️ DÉRIVÉE, jamais épinglée : `length === 3` se re-baserait mécaniquement au premier
  // ajout légitime (c'est arrivé le 21/09 avec `Nom` et `Motif`), donc la garde cesserait de
  // protéger ce qu'elle défend : que la LIGNE écrite ait la largeur de l'EN-TÊTE.
  const d = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')],
    new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]));
  d.etapeRattrapagePiece_(() => false, {});
  assert.ok(d.faitsEcrits.length >= 1, 'rien n\'a été écrit : la garde ne mesurerait rien');
  for (const l of d.faitsEcrits) {
    assert.strictEqual(l.length, d.COLONNES_PIECES_FAITES.length,
      'une colonne ajoutée à l\'en-tête sans l\'autre décalerait tout ce qui suit');
  }
});

test('le budget quotidien est PARTAGÉ avec l\'audit : aucune addition à l\'enveloppe', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props);
  // La journée des pièces est déjà consommée par l'audit : le rattrapage n'a rien de plus.
  c.dateGmail_ = () => '2026-09-18';
  props.set('DriveAI_AUDIT_PIECE_JOUR_MS',
    '2026-09-18|' + (c.CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS + 1));

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'budget-jour');
  assert.strictEqual(c.appels.length, 0);

  // ⚠️ Et le module ne déclare AUCUNE constante `*_BUDGET_JOUR_MS` à lui : l'invariant
  // d'enveloppe (63 min/j) est structurellement AVEUGLE à une étape qui en ajouterait une sans
  // le dire, et c'est l'angle mort payé en C28-42 puis re-payé en C28-135.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RattrapagePiece.gs'), 'utf8');
  assert.strictEqual(/RATTRAPAGE_PIECE_BUDGET_JOUR_MS/.test(src), false);
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  assert.strictEqual(/RATTRAPAGE_PIECE_BUDGET_JOUR_MS/.test(cfg), false);
});

test('le chemin MANUEL passe outre le budget du jour et la porte, jamais les autres gardes', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props,
    { tag: '', resteAudit: 33 });
  c.dateGmail_ = () => '2026-09-18';
  props.set('DriveAI_AUDIT_PIECE_JOUR_MS',
    '2026-09-18|' + (c.CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS + 1));

  const res = c.etapeRattrapagePiece_(() => false, { manuel: true });
  assert.strictEqual(res.fin, 'termine');
  assert.strictEqual(c.appels.length, 1);
  // ⚠️ Le drapeau voyage jusqu'au CANAL : sans lui, `pousserPieceApresClassement_` relit un tag
  // vide, répond « désactivé », et le geste de Marc n'envoie rien en affichant un succès.
  assert.strictEqual(c.appels[0].opts.manuel, true);
  assert.match(props.get('DriveAI_RATTRAPAGE_PIECE_FIN'), /\|manuel$/);
  // Le budget du jour n'est PAS mangé par un run manuel (C28-33, la double peine).
  assert.strictEqual(props.get('DriveAI_AUDIT_PIECE_JOUR_MS'),
    '2026-09-18|' + (c.CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS + 1));
});

test('le canal REFUSE tout quand le rattrapage n\'est pas armé — donc rien ne part par accident', () => {
  const c = load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'Memoire.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k === 'DriveAI_MEMORYAI_TOKEN' ? 'jeton' : null),
      setProperty: () => {},
    }) },
  });
  c.CONFIG.PIECE_PUSH = false;
  c.CONFIG.RATTRAPAGE_PIECE_TAG = '';
  c.journalErreur_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.memoireSuspendue_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.extrairePiece_ = () => ({ type: 'Permis' });
  c.envoyerLotPiecesMemoire_ = () => ({ ok: true, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0 });
  const dec = { nom: 'a.pdf', domaine: '04 · Immigration', statut: 'classé', chemin: '' };
  assert.strictEqual(
    c.pousserPieceApresClassement_({ cle: CLE(ID(1)) }, dec, 'du texte', { rattrapage: true }).motif,
    'desactive');
  // ⚠️ La garde est RE-VÉRIFIÉE ici, au point d'envoi, pas seulement dans l'étape : une garde
  // n'existe qu'aux endroits qui la consultent.
  c.CONFIG.RATTRAPAGE_PIECE_TAG = 'c49-5-a';
  assert.notStrictEqual(
    c.pousserPieceApresClassement_({ cle: CLE(ID(1)) }, dec, 'du texte', { rattrapage: true }).motif,
    'desactive');
  // Et le flux vivant reste éteint : allumer le rattrapage n'allume pas les huit sites d'appel.
  assert.strictEqual(
    c.pousserPieceApresClassement_({ cle: CLE(ID(1)) }, dec, 'du texte').motif, 'desactive');
});

/* ---------- LE CÂBLAGE ---------- */

test('l\'étape est branchée au TICK, gatée sur le tag, et sa ligne est dans la Santé', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  assert.match(main, /rattrapageDoitTourner_\(/);
  assert.match(main, /etapeRattrapagePiece_\(estBudgetDepasse/);
  // ⚠️ Cette campagne DÉPENSE : le frein en dollars doit la garder, contrairement au comptage
  // du périmètre qui ne peut rien coûter.
  const bloc = main.slice(main.indexOf('rattrapageDoitTourner_'));
  assert.match(bloc.slice(0, 400), /budgetCampagnesAtteint_\(\)/);
  assert.match(main, /journalErreur_\('RattrapagePiece'/,
    'enveloppée : un échec ne doit jamais bloquer l\'intake');

  const journal = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  assert.match(journal, /texteSanteRattrapagePiece_\(\)/);
});

/* ---------- LE CHEMIN MANUEL N'EST PAS BRIDÉ PAR LE PLAFOND DU TICK ---------- */

test('le chemin MANUEL ne s\'arrête pas au plafond de 5 : il va jusqu\'au garde-temps', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const lignes = [];
  for (let i = 0; i < 12; i++) lignes.push(ligne(CLE(ID(1) + i), i + '.pdf', '04 · Immigration'));
  const c = montage(lignes, props);

  // Par le TICK : cinq, pas plus — le tick a dix autres étapes à servir en 5 minutes.
  const parTick = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(parTick.faits, c.RATTRAPAGE_PIECE_MAX_PAR_RUN);

  // ⚠️ À LA MAIN : les douze. C28-33 — « un budget calibré pour UN CHEMIN d'exécution ne doit
  // ni brider, ni être consommé par, un AUTRE chemin ». Bridé à cinq, le geste de Marc
  // demanderait VINGT-DEUX exécutions pour les 110 papiers de la tranche.
  const c2 = montage(lignes, new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]));
  const parMain = c2.etapeRattrapagePiece_(() => false, { manuel: true });
  assert.strictEqual(parMain.faits, 12);
});

test('le garde-temps, lui, borne AUSSI le chemin manuel', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const lignes = [];
  for (let i = 0; i < 12; i++) lignes.push(ligne(CLE(ID(1) + i), i + '.pdf', '04 · Immigration'));
  const c = montage(lignes, props);
  // ⚠️ Ce que `manuel` ne lève JAMAIS : sans cette borne, la boucle irait au mur des 6 minutes
  // d'Apps Script et LÈVERAIT au lieu de rendre son compte — Marc ne saurait pas où elle en est.
  let n = 0;
  const res = c.etapeRattrapagePiece_(() => (++n > 3), { manuel: true });
  assert.strictEqual(res.fin, 'budget');
  assert.ok(res.faits < 12 && res.faits > 0, 'il a fait quelque chose, puis s\'est arrêté');
  assert.strictEqual(res.restants, 12 - res.faits, 'et le reste est annoncé pour la prochaine fois');
});

test('le CANAL lève son propre plafond par run sous `manuel`, et rien d\'autre', () => {
  const etats = [];
  const c = load(['Config.gs', 'Consolidation.gs', 'Journal.gs', 'Memoire.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k === 'DriveAI_MEMORYAI_TOKEN' ? 'jeton' : null),
      setProperty: () => {},
    }) },
  });
  c.CONFIG.RATTRAPAGE_PIECE_TAG = 'c49-5-a';
  c.journalErreur_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.memoireSuspendue_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.extrairePiece_ = () => ({ type: 'Permis' });
  c.envoyerLotPiecesMemoire_ = () => ({ ok: true, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0 });
  c.verdictPiece_ = (etat) => { etats.push(etat); return null; };

  const dec = { nom: 'a.pdf', domaine: '04 · Immigration', statut: 'classé', chemin: '' };
  c.pousserPieceApresClassement_({ cle: CLE(ID(1)) }, dec, 'du texte', { rattrapage: true });
  c.pousserPieceApresClassement_({ cle: CLE(ID(1)) }, dec, 'du texte', { rattrapage: true, manuel: true });

  assert.strictEqual(etats[0].maxParRun, c.CONFIG.PIECE_MAX_PAR_RUN, 'le tick garde son plafond');
  assert.strictEqual(etats[1].maxParRun, Infinity, 'la main ne l\'a pas');
  // ⚠️ Et ce que `manuel` ne lève PAS — les quatre gardes qui protègent autre chose que le tick.
  assert.strictEqual(etats[1].jeton, true);
  assert.strictEqual(etats[1].suspendue, false);
  assert.strictEqual(etats[1].freinBudget, false);
  assert.strictEqual(etats[1].pannePlateforme, false);
});

test('la tranche est ARMÉE, et changer cette valeur est une DÉCISION', () => {
  const c = ctx();
  // ⚠️ Armée le 17/09 par Marc : « ok jugé, pose le tag, extrait tous les docs aujd ». Ce test
  // ne défend pas la chaîne `c49-5-a` — il défend le fait que le tag ne redevienne pas VIDE par
  // distraction, ce qui éteindrait la campagne en silence, et que le bumper soit délibéré (un
  // bump REFAIT toute la tranche : la liste des faits est écrite sous le tag, chaque document
  // re-coûte son appel Haiku). Le re-baser en même temps qu'un bump volontaire est normal.
  // Re-basé le 21/09 sur `c49-5-b` : la tranche accueille `02 · Finances` ET relit les 110
  // papiers de `04` + `01` sous le prompt v2 (ADR 0008 de la Mémoire). Un bump volontaire.
  assert.strictEqual(c.CONFIG.RATTRAPAGE_PIECE_TAG, 'c49-5-b');
  assert.strictEqual(c.rattrapageDoitTourner_(null, null, c.CONFIG.RATTRAPAGE_PIECE_TAG), true);
  // Et le flux vivant reste ÉTEINT : armer le rattrapage n'allume pas les huit sites d'appel.
  assert.strictEqual(c.CONFIG.PIECE_PUSH, false);
});

/* ---------- LE COMPTEUR DE LA GATE : « je ne sais pas » n'est JAMAIS zéro ---------- */

test('une SORTIE PRÉCOCE n\'écrase pas le compteur que la gate relit', () => {
  // ⚠️ VÉCU EN PRODUCTION LE 17/09 À 18:35. La Property des restants n'existait pas encore ; la
  // branche « audit-en-cours » faisait `restantsRattrapage_(props) || 0` et écrivait donc `0`.
  // Conséquences en chaîne : la gate du tick lit 0, `rattrapageDoitTourner_` rend false, l'étape
  // ne tourne PLUS JAMAIS — et la Santé annonce « ✅ tranche terminée » alors qu'il restait 85
  // papiers. C'est l'interblocage du 17/09 au matin repris par l'autre bout : ce n'est pas la
  // gate qui était fausse, c'est le compteur qu'une sortie qui n'avait rien compté avait écrasé.
  ['audit-en-cours', 'budget-jour'].forEach((attendu) => {
    const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
    const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props,
      attendu === 'audit-en-cours' ? { resteAudit: 33 } : {});
    if (attendu === 'budget-jour') {
      c.dateGmail_ = () => '2026-09-18';
      props.set('DriveAI_AUDIT_PIECE_JOUR_MS',
        '2026-09-18|' + (c.CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS + 1));
    }

    const res = c.etapeRattrapagePiece_(() => false, {});
    assert.strictEqual(res.fin, attendu);
    assert.strictEqual(props.has('DriveAI_RATTRAPAGE_PIECE_RESTANTS'), false,
      attendu + ' : rien de mesuré, donc rien d\'écrit');

    // Et la conséquence qui compte : la gate reste OUVERTE au tick suivant.
    assert.strictEqual(
      c.rattrapageDoitTourner_(c.restantsRattrapage_({ getProperty: () => null }),
        'c49-5-a', 'c49-5-a'), true);
  });
});

test('une sortie précoce CONSERVE un compte déjà mesuré, elle ne l\'invente pas', () => {
  const props = new Map([
    ['DriveAI_MEMORYAI_TOKEN', 'jeton'],
    ['DriveAI_RATTRAPAGE_PIECE_RESTANTS', '85'],
  ]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props, { resteAudit: 33 });
  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'audit-en-cours');
  assert.strictEqual(res.restants, 85, 'ce qui était connu le reste');
  assert.strictEqual(props.get('DriveAI_RATTRAPAGE_PIECE_RESTANTS'), '85');
});

test('la Santé distingue « 0 restants » de « reste inconnu »', () => {
  const c = ctx();
  // ⚠️ Le champ VIDE est ce qu'écrit une sortie qui n'a rien compté. `Number('')` vaut ZÉRO :
  // sans garde explicite, « je ne sais pas » s'afficherait « ✅ tranche terminée », qui est
  // exactement le message rassurant et faux servi en production le 17/09.
  const inconnu = c.phraseFinRattrapage_('2026-09-17 18:35|audit-en-cours|0/0/0||tick', 'c49-5-a');
  assert.match(inconnu, /reste inconnu/);
  assert.doesNotMatch(inconnu, /tranche terminée/);

  const fini = c.phraseFinRattrapage_('2026-09-17 18:35|tranche-terminee|0/0/0|0|tick', 'c49-5-a');
  assert.match(fini, /0 restants/);
  assert.match(fini, /tranche terminée/);
});

// ────────────────────────────────────────────────────────────────────────────────────────
// LE CUMUL (C49-6, demande de Marc du 19/09 : « je veux que l'import se fasse automatiquement
// et MESURÉ »). Le signal de fin ne porte que la DERNIÈRE passe : après 110 documents il
// annonçait « 0/0/0 — tranche terminée », c'est-à-dire exactement ce qu'il annonce quand il
// n'y avait rien à faire. C'est ce qui a rendu inexplicable l'écart entre 110 documents
// traités et 78 pièces arrivées.
// ────────────────────────────────────────────────────────────────────────────────────────

test('le cumul ADDITIONNE les passes au lieu de les écraser', () => {
  const c = ctx();
  const zero = c.decoderCumulRattrapage_('');
  assert.deepStrictEqual(
    { f: zero.faits, e: zero.echecs, s: zero.sansTexte, a: zero.acceptees },
    { f: 0, e: 0, s: 0, a: 0 });

  const p1 = c.cumulerRattrapage_(zero, { faits: 24, echecs: 0, sansTexte: 1, acceptees: 24 });
  const p2 = c.cumulerRattrapage_(p1, { faits: 53, echecs: 4, sansTexte: 28, acceptees: 53 });
  assert.strictEqual(p2.faits, 77, 'deux passes s\'additionnent');
  assert.strictEqual(p2.sansTexte, 29);
  assert.strictEqual(p2.echecs, 4);
  assert.strictEqual(p2.acceptees, 77);
  // Et l'aller-retour par la forme persistée ne perd rien.
  assert.deepStrictEqual(c.decoderCumulRattrapage_(c.encoderCumulRattrapage_(p2)), p2);
});

test('une passe VIDE ne détruit pas le cumul — c\'est le bug du 17/09 un cran plus loin', () => {
  const c = ctx();
  const avant = c.decoderCumulRattrapage_('77/4/29/77');
  const apres = c.cumulerRattrapage_(avant, { faits: 0, echecs: 0, sansTexte: 0, acceptees: 0 });
  assert.deepStrictEqual(apres, avant, 'une sortie précoce ne remet aucun compteur à zéro');
});

test('un cumul écrit sous un AUTRE tag ne compte pas — deux populations ne s\'additionnent pas', () => {
  const c = ctx();
  const props = {
    getProperty: () => 'c49-5-a|77/4/29/77',
    setProperty: () => { }
  };
  const meme = c.lireCumulRattrapage_(props, 'c49-5-a');
  assert.strictEqual(meme.faits, 77, 'même tag : le cumul se poursuit');
  const autre = c.lireCumulRattrapage_(props, 'c49-6-a');
  assert.strictEqual(autre.faits, 0, 'tag différent : on repart de zéro, jamais on n\'additionne');
  // ⚠️ Une Property ILLISIBLE vaut zéro, pas une exception : l'observabilité ne fait pas
  // échouer l'étape qu'elle observe.
  const casse = c.lireCumulRattrapage_({ getProperty: () => { throw new Error('boom'); } }, 'c49-5-a');
  assert.strictEqual(casse.faits, 0);
});

test('la Santé se TAIT tant que rien n\'a été produit, et parle dès le premier document', () => {
  const c = ctx();
  assert.strictEqual(c.phraseCumulRattrapage_({ faits: 0, echecs: 0, sansTexte: 0, acceptees: 0 }), '',
    'un cumul vide ne dit rien : « rien produit » et « rien à produire » ne sont pas la même chose');
  const p = c.phraseCumulRattrapage_({ faits: 77, echecs: 4, sansTexte: 29, acceptees: 77 });
  assert.ok(/77 extraits/.test(p) && /77 acceptés/.test(p), p);
  assert.ok(/29 sans texte/.test(p) && /4 en échec/.test(p), p);
  // ⚠️ Un compteur ABSENT vaut zéro, jamais NaN : sans la normalisation d'entrée, `illisibles`
  // manquant rendait le total NaN, donc falsy, donc la phrase VIDE — un compteur ajouté aurait
  // fait taire toute l'observabilité au lieu de manquer une colonne.
  assert.ok(/0 illisibles/.test(p), 'un compteur absent se lit zéro, et il s\'affiche : ' + p);
  const avec = c.phraseCumulRattrapage_({ faits: 3, echecs: 0, sansTexte: 1, acceptees: 3, illisibles: 6 });
  assert.ok(/6 illisibles \(photo à refaire\)/.test(avec),
    'le compteur doit DIRE le geste : une photo illisible se reprend, elle ne se re-extrait pas');
  // ⚠️ Un zéro MESURÉ s'affiche : c'est lui qui distingue « aucun échec » de « on ne sait pas ».
  assert.ok(/0 en échec/.test(c.phraseCumulRattrapage_({ faits: 5, echecs: 0, sansTexte: 0, acceptees: 5 })));
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 9. CE QUI S'AFFICHE QUAND ÇA S'ARRÊTE.
//
// Écrit le 21/09/2026. La campagne a extrait UN document, s'est fait refuser par la Mémoire,
// et la ligne de Santé a affiché « suspendu ». Marc : « ça ne m'explique toujours pas
// l'avancement ». Le motif du refus ÉTAIT persisté — `DriveAI_PIECE_DERNIER_REFUS` — et le
// seul endroit qui l'affichait, la ligne « Mémoire (pièces) », commence par
// `if (!CONFIG.PIECE_PUSH) return 'désactivée (CONFIG)'`. Or ce flag ne gouverne PAS le
// rattrapage, qui a son propre chemin (décision de Marc du 17/09). Le diagnostic existait et
// était inatteignable.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les motifs de fin, DÉRIVÉS du code plutôt que recopiés.
 *
 * ⚠️ La lecture va jusqu'au `;`, pas jusqu'à la fin de ligne : un motif posé par un ternaire
 * disparaîtrait d'un scan ancré sur `res.fin = '<littéral>'`, et le témoin qui prouve que le
 * scan voit quelque chose partirait avec lui (leçon du 21/09 sur `memoire.test.js`).
 */
function motifsDuCode() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RattrapagePiece.gs'), 'utf8');
  const motifs = new Set();
  const re = /res\.fin\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) motifs.add(lit[1]);
  }
  return [...motifs];
}

test('chaque sortie de la passe a une phrase en français', () => {
  const c = ctx();
  const motifs = motifsDuCode();
  // Anti-vacuité : un motif cassé rendrait l'ensemble vide et « toutes traduites » serait vrai
  // d'un scan mort.
  assert.ok(motifs.length >= 12, 'le recenseur ne voit presque rien : ' + motifs.length);
  assert.ok(motifs.includes('suspendu'), 'témoin absent : le scan ne lit pas les sorties');

  for (const motif of motifs) {
    // `canal-` est un PRÉFIXE : sa partie variable vit dans le vocabulaire de la Mémoire.
    const phrase = c.phraseMotifRattrapage_(motif === 'canal-' ? 'canal-refusee' : motif);
    assert.ok(phrase && !/^sortie /.test(phrase),
      'motif sans phrase : ' + motif + ' → ' + phrase);
  }
});

test('un motif INCONNU se cite, il ne tombe pas dans une catégorie existante', () => {
  const c = ctx();
  assert.match(c.phraseMotifRattrapage_('motif-de-demain'), /motif-de-demain/);
});

test('une panne de canal NOMME le refus de la Mémoire', () => {
  const c = ctx();
  const brut = '2026-09-21 13:58|suspendu|0/0/0/0|42|tick';
  const avec = c.phraseFinRattrapage_(brut, 'c49-5-b',
    c.diagnosticCanal_('jeton refusé (401)', 'champ_inconnu: lisible'));
  // ⚠️ LES DEUX traces, distinctement : la RAISON dit ce qui a coupé le canal, le REFUS ce
  // que la Mémoire a répondu sur la dernière pièce. N'en afficher qu'une envoie chercher au
  // mauvais endroit une fois sur deux.
  assert.match(avec, /canal coupé : jeton refusé \(401\)/);
  assert.match(avec, /dernier refus de pièce : champ_inconnu: lisible/);
  assert.match(avec, /Mémoire a refusé/);

  // ⚠️ Contrôle inverse : sans refus persisté, la phrase ne fabrique rien. Sans ce cas, « le
  // refus s'affiche » serait vrai d'une phrase qui l'invente.
  assert.doesNotMatch(c.phraseFinRattrapage_(brut, 'c49-5-b', ''),
    /canal coupé :|dernier refus de pièce :/,
    'sans trace persistée, la phrase ne fabrique aucun diagnostic');

  // ⚠️ Et un refus ne se colle PAS à une fin qui n'est pas une panne de canal : « budget du
  // jour épuisé · refus : … » ferait chercher une panne là où la campagne va bien.
  const sain = '2026-09-21 13:58|budget-jour|3/0/0/0|42|tick';
  assert.doesNotMatch(c.phraseFinRattrapage_(sain, 'c49-5-b', 'canal coupé : x'), /canal coupé/);
});

test('diagnosticCanal_ : deux traces, jamais inventées, jamais répétées', () => {
  const c = ctx();
  assert.strictEqual(c.diagnosticCanal_('', ''), '', 'rien à dire ne se dit pas');
  assert.strictEqual(c.diagnosticCanal_('réseau', ''), 'canal coupé : réseau');
  assert.strictEqual(c.diagnosticCanal_('', 'champ_inconnu'), 'dernier refus de pièce : champ_inconnu');
  // ⚠️ Quand les deux portent le MÊME texte, on ne l'écrit pas deux fois : une phrase qui se
  // répète fait croire à deux causes là où il n'y en a qu'une.
  assert.strictEqual(c.diagnosticCanal_('401', '401'), 'canal coupé : 401');
});

test('la ligne de Santé du rattrapage LIT le dernier refus', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'RattrapagePiece.gs'), 'utf8');
  // ⚠️ Une garde de FORME, faute de mieux : `texteSanteRattrapagePiece_` lit les Properties,
  // donc elle ne se teste pas sans sandbox. Ce qu'elle défend est le FIL — la Property lue et
  // passée à la phrase —, pas la mise en forme, qui est couverte par le cas précédent.
  assert.match(src, /texteSanteRattrapagePiece_[\s\S]{0,600}DriveAI_PIECE_DERNIER_REFUS/);
  assert.match(src, /DriveAI_MEMOIRE_SUSPENDU_RAISON/);
  assert.match(src, /phraseFinRattrapage_\(brut, CONFIG\.RATTRAPAGE_PIECE_TAG, diagnosticCanal_\(raison, refus\)\)/);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 10. LA LISTE DES DOCUMENTS LUS DIT CE QU'ILS SONT ET CE QU'IL EN EST SORTI.
//
// Décision de Marc, 21/09 : « je veux un onglet précis pour l'avancement, avec ce qui est en
// train d'être lu, ce qui a déjà été lu ». `PiecesFaites` ne portait qu'un `fileId` — opaque,
// donc une liste qui n'en porte que lui ne répond à aucune question qu'un humain se pose.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('chaque document lu est inscrit avec son NOM et son MOTIF', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), '2026-01-02_Passeport_IRCC.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), '2026-03-04_Relevé_Desjardins.pdf', '01 · Administratif & identité'),
  ], props);
  // Le second est illisible : un verdict DÉFINITIF, donc marqué fait — et il faut pouvoir le
  // distinguer d'une vraie lecture, sinon « 2 traités » ne dit rien de ce qu'on a obtenu.
  let n = 0;
  c.pousserPieceApresClassement_ = () => ({ motif: (++n === 1 ? 'ok' : 'illisible') });

  c.etapeRattrapagePiece_(() => false, {});

  assert.strictEqual(c.faitsEcrits.length, 2);
  // ⚠️ Le DOMAINE a rejoint le nom et le motif le 21/09 (C49-14) : Marc demandait « quel
  // dossier », et un nom de fichier seul ne le dit pas. Ce cas n'a pas été RE-BASÉ — il
  // affirme désormais le fait de plus, parce que c'est le fait que le lot ajoute.
  assert.deepStrictEqual(Array.from(c.faitsEcrits[0]).slice(3),
    ['2026-01-02_Passeport_IRCC.pdf', 'ok', '04 · Immigration']);
  assert.deepStrictEqual(Array.from(c.faitsEcrits[1]).slice(3),
    ['2026-03-04_Relevé_Desjardins.pdf', 'illisible', '01 · Administratif & identité']);
  // ⚠️ Et l'identifiant reste en colonne 1 : c'est lui que lit l'idempotence, et il ne bouge
  // pas parce qu'on a ajouté des colonnes EN QUEUE.
  assert.strictEqual(c.faitsEcrits[0][0], ID(1));
});

test('l\'en-tête de PiecesFaites se RÉPARE là où on écrit, pas à la création', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props);
  // L'onglet tel qu'il existe EN PROD : trois colonnes, créé avant l'ajout de `Nom`/`Motif`.
  c.largeurFaits = 3;

  c.etapeRattrapagePiece_(() => false, {});

  assert.strictEqual(c.enTetesEcrits.length, 1, 'l\'en-tête étroit n\'a pas été réparé');
  assert.deepStrictEqual(Array.from(c.enTetesEcrits[0]), Array.from(c.COLONNES_PIECES_FAITES));

  // ⚠️ Contrôle inverse : un onglet DÉJÀ à la bonne largeur ne se fait pas réécrire à chaque
  // passe. Sans ce cas, « la réparation tire » serait vrai d'un code qui écrit toujours.
  const d = montage([ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration')],
    new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]));
  d.largeurFaits = d.COLONNES_PIECES_FAITES.length;
  d.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(d.enTetesEcrits.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 11. CE QUE LA CAMPAGNE EST EN TRAIN DE FAIRE (C49-14).
//
// Marc, le 21/09 : « je sais pas ça traite quoi en ce moment, quel dossier, quel fichier,
// quelle direction, quelles infos il lui manque ». Quatre questions sans réponse — pas mal
// affichées : ABSENTES du moteur.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('la file par domaine SUIT l\'ordre de la tranche, et garde les domaines finis', () => {
  const c = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  // `04` entièrement fait, `01` à moitié, `02` intact.
  const parDomaine = {
    '04': { tranche: 23, restants: 0 },
    '01': { tranche: 87, restants: 40 },
    '02': { tranche: 976, restants: 976 },
  };
  const encode = c.encoderFilePiece_(parDomaine, ['04', '01', '02']);
  assert.strictEqual(encode, '04:0/23·01:40/87·02:976/976');

  const phrase = c.phraseFilePiece_(encode);
  // ⚠️ Ce que la phrase doit DIRE, et c'est la demande mot à mot : quel dossier maintenant,
  // combien y sont lus, et ce qui vient ensuite.
  assert.match(phrase, /04 ✅ \(23\)/);
  assert.match(phrase, /EN COURS 01 : 47\/87 lus, 40 à lire/);
  assert.match(phrase, /ensuite 02 \(976\)/);
});

test('un domaine à ZÉRO restant reste dans la file — l\'absence se lirait « pas commencé »', () => {
  const c = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  const encode = c.encoderFilePiece_({ '04': { tranche: 23, restants: 0 } }, ['04']);
  assert.strictEqual(encode, '04:0/23');
  assert.match(c.phraseFilePiece_(encode), /tranche terminée/);
  // ⚠️ Contrôle inverse : une file VIDE ne dit pas « terminée », elle dit qu'on n'a pas mesuré.
  assert.strictEqual(c.phraseFilePiece_(''), 'pas encore mesurée');
});

test('le document EN COURS s\'efface tout seul quand il a trop vieilli', () => {
  const c = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  const t0 = 1_700_000_000_000;
  const brut = c.encoderEnCoursPiece_(
    { fileId: 'abc', nom: 'Passeport.pdf', domaine: '04 · Immigration' }, t0);

  // Frais : il se dit.
  assert.strictEqual(c.phraseEnCoursPiece_(brut, t0 + 1000, 8 * 60 * 1000),
    'Passeport.pdf (04 · Immigration)');
  // ⚠️ Périmé : RIEN. Un run tué par le mur des six minutes laisse la Property en place ; sans
  // cette borne, l'écran afficherait « en train de lire » pendant des heures — exactement le
  // « faux 0 permanent » d'`HistoriqueVrac`.
  assert.strictEqual(c.phraseEnCoursPiece_(brut, t0 + 9 * 60 * 1000, 8 * 60 * 1000), '');
  // Ni horodatage, ni nom ⇒ rien non plus : on n'invente pas un document en cours.
  assert.strictEqual(c.phraseEnCoursPiece_('', t0, 1000), '');
  assert.strictEqual(c.phraseEnCoursPiece_('abc|x|y|z', t0, 1000), '');
  assert.strictEqual(c.phraseEnCoursPiece_(String(t0) + '|abc||04', t0, 1000), '');
});

test('un nom qui porte le séparateur ne casse pas l\'encodage', () => {
  const c = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  // ⚠️ `|` est le séparateur : un nom qui en contient couperait la chaîne et ferait lire le
  // domaine à la place du nom. Les retours à la ligne feraient pire — ils casseraient la ligne
  // de Santé, qui est UNE cellule.
  const brut = c.encoderEnCoursPiece_(
    { fileId: 'i', nom: 'a|b\nc', domaine: '04 · X' }, 1000);
  assert.strictEqual(brut.split('|').length, 4);
  assert.strictEqual(c.phraseEnCoursPiece_(brut, 1000, 1000), 'a b c (04 · X)');
});

test('la file et l\'en-cours sont ÉCRITS par la passe, et l\'en-cours est effacé à la sortie', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '01 · Administratif & identité'),
  ], props);
  const vus = [];
  c.pousserPieceApresClassement_ = () => {
    // ⚠️ On observe la Property PENDANT la lecture : c'est la seule façon de prouver qu'elle
    // est écrite AVANT l'appel. La lire après la passe ne prouverait que l'effacement.
    vus.push(props.get('DriveAI_PIECE_EN_COURS'));
    return { motif: 'ok' };
  };

  c.etapeRattrapagePiece_(() => false, {});

  assert.strictEqual(vus.length, 2);
  assert.match(String(vus[0]), /\|a\.pdf\|04 · Immigration$/);
  assert.match(String(vus[1]), /\|b\.pdf\|01 · Administratif & identité$/);
  // La file dit la tranche ET ce qui y reste, dans l'ordre des préfixes.
  assert.strictEqual(typeof props.get('DriveAI_PIECE_FILE'), 'string');
  assert.match(props.get('DriveAI_PIECE_FILE'), /^04:\d+\/\d+·01:\d+\/\d+/);
  // ⚠️ Et la campagne ne laisse RIEN en cours derrière elle.
  assert.strictEqual(props.get('DriveAI_PIECE_EN_COURS'), undefined);
});

test('la file s\'écrit AUSSI quand il ne reste rien — « terminée » n\'est pas « non mesurée »', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  // Tout est déjà fait : la sélection ne rend aucun document.
  const c = montage([ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration')], props);
  // ⚠️ L'idempotence se lit dans l'onglet `PiecesFaites`, filtrée par TAG : poser un champ
  // sur le contexte ne simulerait rien. On écrit donc une vraie ligne déjà faite.
  c.faitsEcrits.push([ID(1), c.CONFIG.RATTRAPAGE_PIECE_TAG, '2026-09-21 10:00', 'a.pdf', 'ok', '04 · Immigration']);

  const res = c.etapeRattrapagePiece_(() => false, {});

  assert.strictEqual(res.fin, 'tranche-terminee');
  assert.match(props.get('DriveAI_PIECE_FILE'), /04:0\/1/);
});


/* ══════════════════════════════════════════════════════════════════════════════════════════
   C49-15 — AUTANT DE NOMS QUE DE CHIFFRES.

   ⚠️ Trouvé le 21/09/2026 en vérifiant C49-14 en PRODUCTION, pas dans un diff : la Santé
   affichait « dernière passe : 3/0/1/1 (faits/échecs/sans texte) » — quatre chiffres, trois
   noms. Le quatrième, les documents dont la photo est à refaire, n'avait pas de nom : il se
   lisait comme un chiffre de trop. Le compteur était juste ; le libellé était resté derrière
   quand `illisibles` est entré (C49-7/8, le même jour).

   ⚠️ La garde est COMPORTEMENTALE et DÉRIVÉE : elle compte les chiffres que la passe écrit et
   les noms que la phrase affiche, et exige l'égalité. Épingler le texte se re-baserait
   mécaniquement au prochain compteur ajouté — c'est-à-dire exactement le jour où il faut que
   quelque chose rougisse.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

test('C49-15 : la phrase de Santé nomme AUTANT de compteurs que la passe en écrit', () => {
  const ctx = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  const compteurs = '3/0/1/1'; // ce que `etapeRattrapagePiece_` sérialise (p[2])
  const brut = ['2026-09-21 15:06', 'termine', compteurs, '1051'].join('|');

  const phrase = ctx.phraseFinRattrapage_(brut, 'c49-5-b', '');

  const chiffres = compteurs.split('/').length;
  const libelle = /\(([^)]*\/[^)]*)\)/.exec(phrase);
  assert.ok(libelle, 'la phrase doit porter un libellé entre parenthèses — sinon rien ne nomme les chiffres');
  const noms = libelle[1].split('/').length;

  assert.strictEqual(noms, chiffres,
    'chaque chiffre de la dernière passe doit avoir son nom : ' + phrase);
});

test('C49-15 : le libellé nomme bien les QUATRE compteurs, dans l\'ordre où ils sont écrits', () => {
  const ctx = load(['Config.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs']);
  const phrase = ctx.phraseFinRattrapage_('2026-09-21 15:06|termine|4/1/0/2|1051', 'c49-5-b', '');
  // ⚠️ L'ORDRE compte autant que le compte : `res.faits + '/' + res.echecs + '/' + res.sansTexte
  // + '/' + res.illisibles`. Un libellé dans le désordre est pire qu'un libellé absent — on lit
  // un chiffre pour un autre sans qu'aucun signe ne l'indique.
  assert.ok(/faits.*échecs.*sans texte.*illisibles/.test(phrase),
    'les quatre noms, dans l\'ordre de la sérialisation : ' + phrase);
});

/* ---------- C49-26 : élargir la tranche SANS relire ce qui est lu ---------- */

test('C49-26 — élargir la liste rouvre la lecture sur les NOUVEAUX dossiers, sans relire les anciens', () => {
  const c = ctx();
  const lignes = [
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '02 · Finances'),
    ligne(CLE(ID(3)), 'c.pdf', '05 · Carrière'),
    ligne(CLE(ID(4)), 'd.pdf', '03 · Logement & véhicule'),
  ];
  // Ce que la tranche `04 + 01 + 02` a déjà lu, sous le MÊME tag.
  const faits = {};
  faits[ID(1)] = 1;
  faits[ID(2)] = 1;
  const avant = c.selectionnerRattrapage_(lignes, c.fileIdDeLigneIndex_, faits, ['04', '01', '02'], 10);
  assert.strictEqual(avant.choisies.length, 0, 'l\'ancienne tranche est bien finie');
  assert.strictEqual(avant.restants, 0);

  const apres = c.selectionnerRattrapage_(
    lignes, c.fileIdDeLigneIndex_, faits, c.prefixesRattrapage_(), 10);
  // ⚠️ `05` AVANT `03` : c'est l'ordre choisi par Marc, pas l'ordre de l'Index.
  assert.deepStrictEqual(Array.from(apres.choisies.map((d) => d.domaine)),
    ['05 · Carrière', '03 · Logement & véhicule']);
  assert.strictEqual(apres.restants, 2, 'le compteur que relit la gate repasse au-dessus de zéro');
  // Les deux déjà lus ne reviennent PAS : les relire coûterait un appel de modèle chacun pour
  // une pièce que la Mémoire garderait telle quelle (même extracteur).
  assert.ok(apres.choisies.every((d) => d.fileId !== ID(1) && d.fileId !== ID(2)));
});

test('C49-26 — TRIPWIRE : rien n\'écrit le tag persisté de la tranche, et l\'élargissement en DÉPEND', () => {
  // ⚠️ La gate du tick compare `DriveAI_RATTRAPAGE_PIECE_TAG` au tag de CONFIG. Aucun code ne
  // l'écrit (mesuré le 23/09) : elle rend donc toujours `true`, l'étape tourne à chaque tick, et
  // c'est ce qui permet d'élargir la liste sans bumper le tag. Le jour où quelqu'un « répare » la
  // persistance, une tranche finie se refermera POUR TOUJOURS sur `restants === 0`, et un
  // élargissement ne rouvrira plus rien — l'interblocage du 17/09. Ce test rougit à ce moment-là :
  // la persistance doit alors porter la LISTE en plus du tag (signature `tag|04+01+…`).
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src');
  // ⚠️ Le motif couvre toutes les ÉCRITURES plausibles — `setProperty`, `setProperties({…})`,
  // guillemets simples ou doubles, clé dans une constante nommée — et pas seulement la forme
  // qu'avait le premier jet (revue du 23/09 : trois écritures sur quatre passaient au travers).
  const ECRITURE = /(setProperty|setProperties)[\s\S]{0,120}RATTRAPAGE_PIECE_TAG|RATTRAPAGE_PIECE_TAG['"]?\s*:|['"]DriveAI_RATTRAPAGE_PIECE_TAG['"]\s*[;)]\s*$/m;
  const ecrit = fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).some((f) => {
    // Les lectures connues ne comptent pas : on retire la ligne de `Main.gs` qui LIT le tag.
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
      .replace(/getProperty\('DriveAI_RATTRAPAGE_PIECE_TAG'\)/g, '')
      .replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');
    return ECRITURE.test(src.split('\n').filter((l) => !/CONFIG\.RATTRAPAGE_PIECE_TAG|RATTRAPAGE_PIECE_TAG:\s*'c/.test(l)).join('\n'));
  });
  // Témoins du motif, pour qu'un motif cassé ne rende pas ce test vert à vide.
  assert.ok(ECRITURE.test("props.setProperty('DriveAI_RATTRAPAGE_PIECE_TAG', t);"));
  assert.ok(ECRITURE.test('props.setProperties({ "DriveAI_RATTRAPAGE_PIECE_TAG": t });'));
  assert.ok(ECRITURE.test('var K = "DriveAI_RATTRAPAGE_PIECE_TAG";'));
  assert.strictEqual(ecrit, false,
    'le tag de tranche est désormais persisté : faire porter la LISTE des dossiers à la signature ' +
    'persistée, sinon élargir la tranche ne la rouvrira jamais');
  // Anti-vacuité : la gate le LIT bien, sinon ce test ne protégerait rien.
  assert.match(fs.readFileSync(path.join(dir, 'Main.gs'), 'utf8'),
    /getProperty\('DriveAI_RATTRAPAGE_PIECE_TAG'\)/);
});

/* ---------- C49-26 : un DOCUMENT, pas une ligne ; et des fichiers disparus ne sont pas une panne ---------- */

test('C49-26 — deux lignes d\'Index pour UN document : lu une fois, sous son domaine le plus RÉCENT', () => {
  const c = ctx();
  // Le cas réel des dossiers que la tranche ouvre : 06 a été re-analysé (c28-92), m1 a migré.
  const res = c.selectionnerRattrapage_([
    ligne(CLE(ID(5)), 'releve.pdf', '02 · Finances'),
    ligne('reanalyse|c28-92|' + ID(5), 'releve.pdf', '06 · Études & diplômes'),
    ligne(CLE(ID(6)), 'autre.pdf', '06 · Études & diplômes'),
  ], c.fileIdDeLigneIndex_, {}, ['02', '06'], 10);

  assert.strictEqual(res.choisies.length, 2, 'le document en double ne se lit — ni ne se PAIE — qu\'une fois');
  assert.strictEqual(res.tranche, 2);
  assert.strictEqual(res.restants, 2);
  const doublon = res.choisies.find((d) => d.fileId === ID(5));
  assert.strictEqual(doublon.domaine, '06 · Études & diplômes',
    'la ligne la plus récente décide : c\'est là que le document vit aujourd\'hui');
  assert.strictEqual(res.parDomaine['02'].tranche, 0);
  assert.strictEqual(res.parDomaine['06'].tranche, 2);
});

test('C49-26 — trois fichiers DISPARUS d\'affilée, Drive qui répond : trois verdicts, la campagne continue', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
    ligne(CLE(ID(3)), 'c.pdf', '04 · Immigration'),
    ligne(CLE(ID(4)), 'd.pdf', '04 · Immigration'),
  ], props);
  c.DriveApp = {
    getRootFolder: () => ({ getId: () => 'racine' }),
    getFileById: (id) => {
      if (id !== ID(4)) {
        throw new Error('Exception: No item with the given ID could be found. Possibly because you have not edited this item');
      }
      return { getSize: () => 10, getBlob: () => ({ id: id }) };
    },
  };

  const res = c.etapeRattrapagePiece_(() => false, {});
  // ⚠️ Avant C49-26 : `drive-illisible`, marques retirées, et le tick suivant retombait sur
  // les MÊMES trois fichiers en tête — la campagne s'arrêtait là pour toujours.
  assert.strictEqual(res.fin, 'termine');
  assert.strictEqual(res.faits, 1, 'le quatrième document est lu');
  assert.strictEqual(res.echecs, 3);
  assert.deepStrictEqual(
    Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')).sort(),
    [ID(1), ID(2), ID(3), ID(4)].sort(), 'les trois disparus sont marqués : ils ne bloqueront plus la tête de file');
});

test('C49-26 — trois fichiers « disparus » mais Drive MUET : c\'est le canal, les marques se retirent', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
    ligne(CLE(ID(3)), 'c.pdf', '04 · Immigration'),
  ], props);
  c.DriveApp = {
    getRootFolder: () => { throw new Error('Drive indisponible'); },
    getFileById: () => { throw new Error('No item with the given ID could be found.'); },
  };

  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'drive-illisible');
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')), []);
  assert.strictEqual(res.restants, 3);
});

test('C49-26 — une série MIXTE (disparu + refus) garde le coupe-circuit d\'avant', () => {
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = montage([
    ligne(CLE(ID(1)), 'a.pdf', '04 · Immigration'),
    ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
    ligne(CLE(ID(3)), 'c.pdf', '04 · Immigration'),
  ], props);
  let n = 0;
  c.DriveApp = {
    getRootFolder: () => ({ getId: () => 'racine' }),
    getFileById: () => {
      n++;
      // Un throttle au milieu : c'est une cause qui touche TOUT le lot.
      throw new Error(n === 2 ? 'Bandwidth quota exceeded' : 'No item with the given ID could be found.');
    },
  };
  const res = c.etapeRattrapagePiece_(() => false, {});
  assert.strictEqual(res.fin, 'drive-illisible');
  assert.deepStrictEqual(Object.keys(c.filtrerFaitsParTag_(c.faitsEcrits, 'c49-5-a')), []);
});
