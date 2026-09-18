'use strict';
/**
 * test/lecture-file.test.js — L36 : lire le stock COMPLET en demandant sa file à la Mémoire.
 *
 * Ce que ces cas défendent, et pourquoi chacun a été écrit :
 *   1. l'ORDRE est celui de la Mémoire (donc celui de Marc) — le module ne retrie JAMAIS ;
 *   2. un document qui ne DONNE RIEN est NOTÉ, sinon il reste en tête de file et chaque passe
 *      repaie son OCR ;
 *   3. un « ok » que la Mémoire n'a PAS accepté est noté `sans-effet` — sinon le document
 *      revient et coûte un appel Haiku à chaque passe, pour toujours ;
 *   4. une PANNE DE CANAL ne se note jamais et arrête la boucle — la noter sortirait de la
 *      file des papiers parfaitement lisibles ;
 *   5. trois lectures Drive impossibles D'AFFILÉE retirent les verdicts déjà posés ;
 *   6. le reste n'est écrit dans la gate QUE s'il a été MESURÉ — une sortie précoce qui y
 *      poserait un zéro ferait attendre six heures une campagne qui a du travail ;
 *   7. file vide ⇒ re-sonde périodique, jamais extinction ;
 *   8. les trois campagnes des pièces sont mutuellement exclusives (aucune minute ajoutée) ;
 *   9. tout verdict émis est dans la liste que la Mémoire accepte — un seul motif inconnu fait
 *      refuser le LOT ENTIER ;
 *  10. l'étape est branchée au tick, à la Santé et au canal.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const MODULES = ['Config.gs', 'Consolidation.gs', 'Journal.gs', 'PerimetrePiece.gs',
  'RattrapagePiece.gs', 'LectureFile.gs'];

const ligne = (cle, nom, domaine, statut) => [cle, '', nom, domaine, '', statut || 'classé'];
const ID = (n) => String(n).repeat(28);
const CLE = (id) => 'drive|' + id;
const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

/* ---------- PUR ---------- */

test('verdictDeLecture_ : un papier LU ne se note pas, un « ok » SANS EFFET si', () => {
  const c = load(MODULES);
  assert.strictEqual(c.verdictDeLecture_('ok', 1), null);
  assert.strictEqual(c.verdictDeLecture_('ok', 0), 'sans-effet',
    'un ok non accepté reviendrait en tête de file et re-coûterait un appel Haiku à chaque passe');
  assert.strictEqual(c.verdictDeLecture_('sans-texte', 0), 'sans-texte');
  assert.strictEqual(c.verdictDeLecture_('refusee', 0), 'refusee');
  assert.strictEqual(c.verdictDeLecture_('non-classe', 0), 'introuvable');
});

test('verdictDeLecture_ : une PANNE DE CANAL n\'est JAMAIS un verdict', () => {
  const c = load(MODULES);
  ['jeton-refuse', 'perimetre-retire', 'reseau', 'panne', 'suspendu', 'frein-budget',
    'panne-llm', 'plafond-run', 'jeton-absent', 'desactive', '', 'motif-inconnu-demain']
    .forEach((m) => assert.strictEqual(c.verdictDeLecture_(m, 0), null,
      '« ' + m + ' » sortirait de la file un papier parfaitement lisible'));
});

test('tout verdict ÉMIS est dans la liste que la Mémoire accepte — sinon le LOT ENTIER est refusé', () => {
  const c = load(MODULES);
  // ⚠️ La liste de référence est recopiée de MemoryAI (`MOTIFS_VERDICT`). Duplication
  // irréductible — deux dépôts, deux langages — donc testée des DEUX côtés.
  const MEMOIRE = ['sans-texte', 'ocr-echec', 'lecture-impossible', 'introuvable',
    'extraction-vide', 'piece-vide', 'refusee', 'sans-effet'];
  assert.deepStrictEqual(Array.from(c.VERDICTS_ACCEPTES_MEMOIRE_).sort(), MEMOIRE.slice().sort());
  // Tous les VERDICTS de document du canal doivent trouver leur place, sauf `ok`.
  Object.keys(c.VERDICTS_DOCUMENT_RATTRAPAGE_).forEach((m) => {
    const v = c.verdictDeLecture_(m, 0);
    assert.ok(v !== null && MEMOIRE.indexOf(v) !== -1,
      'le motif « ' + m + ' » du canal ne rend aucun verdict accepté : le document bouclerait');
  });
});

test('indexParFileId_ : la DERNIÈRE ligne gagne, une clé sans fileId est sautée', () => {
  const c = load(MODULES);
  const idx = c.indexParFileId_([
    ligne(CLE(ID(1)), 'ancien.pdf', '02 · Finances'),
    ligne('gmail|abc', 'pj.pdf', '02 · Finances'),
    ligne(CLE(ID(1)), 'nouveau.pdf', '03 · Logement & véhicule'),
  ], (cle) => (cle.indexOf('drive|') === 0 ? cle.slice(6) : ''));
  assert.deepStrictEqual(Object.keys(idx), [ID(1)]);
  assert.strictEqual(idx[ID(1)].nom, 'nouveau.pdf');
});

test('l\'état de la gate : le TAG est dans la valeur, et « non mesuré » n\'est jamais zéro', () => {
  const c = load(MODULES);
  const brut = c.encoderEtatLectureFile_('l36-a', 12, 1000);
  assert.deepStrictEqual({ ...c.decoderEtatLectureFile_(brut, 'l36-a') }, { restants: 12, sondeMs: 1000 });
  assert.deepStrictEqual({ ...c.decoderEtatLectureFile_(brut, 'l36-b') }, { restants: null, sondeMs: null },
    'un tag bumpé doit faire re-sonder tout de suite');
  assert.strictEqual(c.decoderEtatLectureFile_(c.encoderEtatLectureFile_('t', null, 5), 't').restants, null,
    '`Number(\'\')` vaut 0 : un reste non mesuré se lirait « file vide »');
  assert.strictEqual(c.decoderEtatLectureFile_(null, 't').restants, null);
});

test('la gate : inconnu ⇒ tourne, zéro ⇒ ATTEND la re-sonde, jamais ne s\'éteint', () => {
  const c = load(MODULES);
  const H = 60 * 60 * 1000;
  assert.strictEqual(c.lectureFileDoitTourner_('', { restants: 5, sondeMs: 0 }, 10 * H), false, 'non armée');
  assert.strictEqual(c.lectureFileDoitTourner_('t', null, 0), true);
  assert.strictEqual(c.lectureFileDoitTourner_('t', { restants: null, sondeMs: null }, 0), true);
  assert.strictEqual(c.lectureFileDoitTourner_('t', { restants: 3, sondeMs: 0 }, 1), true);
  assert.strictEqual(c.lectureFileDoitTourner_('t', { restants: 0, sondeMs: 0 }, 5 * H), false,
    'file vide : pas 288 appels réseau par jour pour apprendre qu\'il n\'y a rien');
  assert.strictEqual(c.lectureFileDoitTourner_('t', { restants: 0, sondeMs: 0 }, 6 * H), true,
    'l\'inventaire continue d\'arriver : « vide » n\'est jamais un état final');
});

test('phraseFinLectureFile_ : non armée, jamais passée, reste inconnu et file vide se distinguent', () => {
  const c = load(MODULES);
  assert.match(c.phraseFinLectureFile_('', ''), /non armée/);
  assert.match(c.phraseFinLectureFile_('', 'l36-a'), /jamais passée/);
  assert.match(c.phraseFinLectureFile_('2026-09-18 20:00|canal-reseau|0/0||tick', 'l36-a'), /reste inconnu/);
  assert.match(c.phraseFinLectureFile_('2026-09-18 20:00|file-vide|0/0|0|tick', 'l36-a'), /file vide/);
  assert.match(c.phraseFinLectureFile_('2026-09-18 20:00|termine|4/1|2640|manuel', 'l36-a'), /2640 papiers restants.*lancée à la main/);
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
      }),
    },
  });
  c.feuille_ = () => feuille;
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.dateGmail_ = () => '2026-09-18';
  c.memoireSuspendue_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.resteAuditPiece_ = () => (o.resteAudit === undefined ? 0 : o.resteAudit);
  c.restantsRattrapage_ = () => (o.resteRattrapage === undefined ? 0 : o.resteRattrapage);
  c.CONFIG.LECTURE_FILE_TAG = o.tag === undefined ? 'l36-a' : o.tag;
  c.appels = [];
  c.verdictsNotes = [];
  c.demandes = 0;
  c.demanderFileLecture_ = () => {
    c.demandes++;
    return o.file ? o.file() : { ok: true, file: [], restants: 0 };
  };
  c.noterVerdictsLecture_ = (jeton, verdicts) => {
    c.verdictsNotes = c.verdictsNotes.concat(Array.from(verdicts));
    return o.noteKo ? { ok: false, notes: 0 } : { ok: true, notes: verdicts.length };
  };
  c.DriveApp = { getFileById: (id) => ({ getSize: () => 10, getBlob: () => ({ id: id }) }) };
  c.extraireTexte_ = (blob) => (o.texte ? o.texte(blob.id) : 'du texte de ' + blob.id);
  c.pousserPieceApresClassement_ = (src, decision, texte, opts) => {
    c.appels.push({ cle: src.cle, nom: decision.nom, opts: opts });
    const r = o.envoi ? o.envoi(src.cle) : { motif: 'ok', acceptees: 1 };
    return r;
  };
  return c;
}

const JETON = () => new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
const INDEX = [
  ligne(CLE(ID(1)), 'a.pdf', '02 · Finances'),
  ligne(CLE(ID(2)), 'b.pdf', '04 · Immigration'),
  ligne(CLE(ID(3)), 'c.pdf', '02 · Finances'),
  ligne(CLE(ID(4)), 'd.pdf', '02 · Finances'),
];

test('l\'étape lit DANS L\'ORDRE DE LA FILE — jamais celui de l\'Index, jamais un tri par domaine', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(3), ID(1), ID(2)], restants: 40 }) });
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'termine');
  assert.deepStrictEqual(Array.from(c.appels.map((a) => a.nom)), ['c.pdf', 'a.pdf', 'b.pdf']);
  assert.strictEqual(res.lus, 3);
  assert.strictEqual(res.restants, 37);
  assert.strictEqual(c.appels[0].opts.file, true,
    'le canal doit recevoir SON drapeau, sinon il répond « désactivé » et rien ne part');
  assert.strictEqual(c.verdictsNotes.length, 0, 'un papier LU ne se note pas : il sort de la file tout seul');
});

test('un document qui ne DONNE RIEN est NOTÉ, et la boucle CONTINUE', () => {
  const props = JETON();
  const c = montage(INDEX, props, {
    file: () => ({ ok: true, file: [ID(1), ID(2)], restants: 2 }),
    texte: (id) => (id === ID(1) ? '   ' : 'du texte'),
  });
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.lus, 1);
  assert.strictEqual(res.sansResultat, 1);
  assert.deepStrictEqual(c.verdictsNotes.map((v) => ({ ...v })), [{ file_id: ID(1), motif: 'sans-texte' }]);
  assert.strictEqual(res.restants, 0);
});

test('⚠️ un « ok » que la Mémoire n\'a PAS accepté est noté sans-effet — sinon il boucle en payant', () => {
  const props = JETON();
  const c = montage(INDEX, props, {
    file: () => ({ ok: true, file: [ID(1)], restants: 1 }),
    envoi: () => ({ motif: 'ok', acceptees: 0 }),
  });
  const res = c.etapeLectureFile_(() => false, {});
  assert.deepStrictEqual(c.verdictsNotes.map((v) => v.motif), ['sans-effet']);
  assert.strictEqual(res.lus, 0);
});

test('un fichier que l\'Index ne connaît plus est noté SANS rien lire ni payer', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: ['fichier-disparu', ID(2)], restants: 2 }) });
  c.etapeLectureFile_(() => false, {});
  assert.deepStrictEqual(c.verdictsNotes.map((v) => ({ ...v })), [{ file_id: 'fichier-disparu', motif: 'introuvable' }]);
  assert.deepStrictEqual(Array.from(c.appels.map((a) => a.nom)), ['b.pdf']);
});

test('⚠️ une PANNE DE CANAL ne se note PAS, arrête la boucle, et le papier RESTE dans la file', () => {
  const props = JETON();
  const c = montage(INDEX, props, {
    file: () => ({ ok: true, file: [ID(1), ID(2), ID(3)], restants: 3 }),
    envoi: () => ({ motif: 'jeton-refuse', acceptees: 0 }),
  });
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'canal-jeton-refuse');
  assert.strictEqual(c.appels.length, 1, 'continuer brûlerait une extraction par document pour le même refus');
  assert.strictEqual(c.verdictsNotes.length, 0);
  assert.strictEqual(res.restants, 3);
});

test('trois lectures Drive impossibles D\'AFFILÉE : les verdicts déjà posés se RETIRENT', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(1), ID(2), ID(3), ID(4)], restants: 4 }) });
  c.DriveApp = { getFileById: () => { throw new Error('scope perdu'); } };
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'drive-illisible');
  assert.strictEqual(c.verdictsNotes.length, 0, 'une panne Drive globale viderait la file de papiers lisibles');
  assert.strictEqual(res.sansResultat, 0);
  assert.strictEqual(res.restants, 4);
});

test('UNE lecture impossible isolée reste un verdict du document', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(1), ID(2)], restants: 2 }) });
  c.DriveApp = { getFileById: (id) => {
    if (id === ID(1)) throw new Error('fichier disparu');
    return { getSize: () => 10, getBlob: () => ({ id: id }) };
  } };
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'termine');
  assert.deepStrictEqual(c.verdictsNotes.map((v) => v.motif), ['lecture-impossible']);
});

test('⚠️ le reste n\'entre dans la GATE que s\'il a été MESURÉ', () => {
  [
    ['jeton-absent', (c, props) => { props.delete('DriveAI_MEMORYAI_TOKEN'); }],
    ['suspendu', (c) => { c.memoireSuspendue_ = () => true; }],
    ['frein-budget', (c) => { c.budgetCampagnesAtteint_ = () => true; }],
    ['panne-plateforme', (c) => { c.estPannePlateforme_ = () => true; }],
  ].forEach(([attendu, preparer]) => {
    const props = JETON();
    const c = montage(INDEX, props, {});
    preparer(c, props);
    const res = c.etapeLectureFile_(() => false, {});
    assert.strictEqual(res.fin, attendu);
    assert.strictEqual(props.has('DriveAI_LECTURE_FILE_ETAT'), false,
      attendu + ' : un zéro posé par ignorance ferait attendre six heures une campagne qui a du travail');
    assert.ok(props.get('DriveAI_LECTURE_FILE_FIN').indexOf('|' + attendu + '|') !== -1, 'le MOTIF, lui, s\'écrit toujours');
  });
});

test('un canal en échec ne pose pas de reste non plus, et dit lequel', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: false, raison: 'file-absente' }) });
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'canal-file-absente');
  assert.strictEqual(props.has('DriveAI_LECTURE_FILE_ETAT'), false);
});

test('file vide : l\'état est POSÉ (mesuré), et la gate attendra la re-sonde', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: [], restants: 0 }) });
  const res = c.etapeLectureFile_(() => false, {});
  assert.strictEqual(res.fin, 'file-vide');
  const etat = c.decoderEtatLectureFile_(props.get('DriveAI_LECTURE_FILE_ETAT'), 'l36-a');
  assert.strictEqual(etat.restants, 0);
  assert.strictEqual(c.lectureFileDoitTourner_('l36-a', etat, etat.sondeMs + 1000), false);
});

test('les trois campagnes des pièces sont MUTUELLEMENT EXCLUSIVES — aucune minute ajoutée', () => {
  let props = JETON();
  let c = montage(INDEX, props, { resteAudit: 4, file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).fin, 'audit-en-cours');
  assert.strictEqual(c.demandes, 0, 'rien ne part, pas même la sonde');

  props = JETON();
  c = montage(INDEX, props, { resteRattrapage: 7, file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).fin, 'rattrapage-en-cours');

  props = JETON();
  c = montage(INDEX, props, { resteRattrapage: null, file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).fin, 'rattrapage-en-cours',
    '« je ne sais pas » n\'est pas zéro : la tranche de Marc passe d\'abord');
});

test('le budget quotidien PARTAGÉ des pièces arrête l\'étape, et elle y inscrit ce qu\'elle consomme', () => {
  let props = JETON();
  props.set('DriveAI_AUDIT_PIECE_JOUR_MS', '2026-09-18|' + (17 * 60 * 1000));
  let c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).fin, 'budget-jour');
  assert.strictEqual(c.demandes, 0);

  // Le temps PASSE pendant la lecture (attente active de quelques ms) : sans ca, « consomme »
  // vaut 0 et le test ne distingue pas un budget INSCRIT d'un budget recopie tel quel —
  // la perturbation restait verte, mesure faite.
  props = JETON();
  props.set('DriveAI_AUDIT_PIECE_JOUR_MS', '2026-09-18|1000');
  c = montage(INDEX, props, {
    file: () => ({ ok: true, file: [ID(1)], restants: 1 }),
    texte: () => { const t = Date.now(); while (Date.now() - t < 8) { /* le temps passe */ } return 'du texte'; },
  });
  c.etapeLectureFile_(() => false, {});
  const inscrit = Number(props.get('DriveAI_AUDIT_PIECE_JOUR_MS').split('|')[1]);
  assert.ok(inscrit > 1000, 'le temps de la passe s ajoute au consommé du jour, il ne le remplace pas (' + inscrit + ')');

  // Le chemin MANUEL passe outre le budget du jour ET ne le consomme pas (C28-33).
  props = JETON();
  props.set('DriveAI_AUDIT_PIECE_JOUR_MS', '2026-09-18|' + (17 * 60 * 1000));
  c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, { manuel: true }).fin, 'termine');
  assert.strictEqual(props.get('DriveAI_AUDIT_PIECE_JOUR_MS'), '2026-09-18|' + (17 * 60 * 1000));
});

test('non armée : l\'étape ne sonde même pas', () => {
  const props = JETON();
  const c = montage(INDEX, props, { tag: '', file: () => ({ ok: true, file: [ID(1)], restants: 1 }) });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).fin, 'non-armee');
  assert.strictEqual(c.demandes, 0);
});

test('des verdicts NON notés reviendront : le reste annoncé ne les compte pas partis', () => {
  const props = JETON();
  const c = montage(INDEX, props, {
    file: () => ({ ok: true, file: [ID(1)], restants: 10 }),
    texte: () => '   ',
    noteKo: true,
  });
  assert.strictEqual(c.etapeLectureFile_(() => false, {}).restants, 10);
});

test('le garde-temps rend la main en cours de tranche', () => {
  const props = JETON();
  const c = montage(INDEX, props, { file: () => ({ ok: true, file: [ID(1), ID(2), ID(3)], restants: 3 }) });
  let n = 0;
  const res = c.etapeLectureFile_(() => (++n > 1), {});
  assert.strictEqual(res.fin, 'budget');
  assert.strictEqual(c.appels.length, 1);
});

/* ---------- Le canal et le câblage ---------- */

test('le canal a TROIS interrupteurs : vider LECTURE_FILE_TAG éteint la file et elle seule', () => {
  const props = JETON();
  const c = load(MODULES.concat(['AuditPiece.gs', 'Memoire.gs']), {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
    }) },
  });
  c.journalErreur_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.memoireSuspendue_ = () => false;
  c.budgetCampagnesAtteint_ = () => false;
  c.extrairePiece_ = () => ({ type: 'Permis' });
  c.pieceMemoire_ = () => ({ type: 'Permis' });
  c.envoyerLotPiecesMemoire_ = () => ({ ok: true, acceptees: 1, dejaPresentes: 0, oubliees: 0, refusees: 0 });
  const decision = { nom: 'a.pdf', domaine: '02 · Finances', statut: 'classé', chemin: '' };

  c.CONFIG.PIECE_PUSH = false;
  c.CONFIG.RATTRAPAGE_PIECE_TAG = 'c49-5-a';
  c.CONFIG.LECTURE_FILE_TAG = '';
  assert.strictEqual(c.pousserPieceApresClassement_({ cle: 'k' }, decision, 'texte', { file: true }).motif, 'desactive',
    'le tag du RATTRAPAGE ne doit pas allumer la FILE');

  c.CONFIG.LECTURE_FILE_TAG = 'l36-a';
  c.CONFIG.RATTRAPAGE_PIECE_TAG = '';
  const r = c.pousserPieceApresClassement_({ cle: 'k' }, decision, 'texte', { file: true });
  assert.strictEqual(r.motif, 'ok');
  assert.strictEqual(r.acceptees, 1, 'l\'étape a besoin de `acceptees` pour reconnaître un envoi sans effet');
  assert.strictEqual(c.pousserPieceApresClassement_({ cle: 'k' }, decision, 'texte', { rattrapage: true }).motif, 'desactive',
    'et le tag de la FILE ne doit pas allumer le RATTRAPAGE');
});

test('l\'étape est branchée au tick, à la Santé, et passe APRÈS le rattrapage', () => {
  const main = SRC('Main.gs');
  assert.match(main, /lectureFileDoitTourner_\(CONFIG\.LECTURE_FILE_TAG, etatFile, Date\.now\(\)\)/);
  assert.match(main, /etapeLectureFile_\(estBudgetDepasse/);
  assert.ok(main.indexOf('etapeLectureFile_(') > main.indexOf('etapeRattrapagePiece_('),
    'l\'ORDRE prime : la tranche de Marc passe avant le stock');
  assert.match(SRC('Journal.gs'), /texteSanteLectureFile_\(\)/);
});

test('le module n\'AJOUTE aucune constante de budget quotidien — il partage celle des pièces', () => {
  const config = SRC('Config.gs');
  assert.ok(!/LECTURE_FILE\w*BUDGET/.test(config),
    'une constante à lui serait une ADDITION à l\'enveloppe de 63 min/j (§9 : RÉALLOUER, jamais AUGMENTER)');
  assert.match(SRC('LectureFile.gs'), /CONFIG\.AUDIT_PIECE_BUDGET_JOUR_MS/);
});
