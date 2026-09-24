'use strict';
/**
 * test/piece-vision.test.js — L1 : lire l'IMAGE du papier, et l'auditer sur vingt (ADR-0063).
 *
 * Ce que ces cas défendent :
 *   1. la VOIE dépend du format, et un format que l'API refuse passe par l'aperçu de Drive ;
 *   2. l'APPARENCE ne part que pour Marc — une garde dans le CODE, pas dans le prompt ;
 *   3. Sonnet 5 est compté à SON prix, et une réponse COUPÉE se dit coupée ;
 *   4. la pièce envoyée porte le nom v3 et ses bornes — sans elles, la Mémoire refuserait ;
 *   5. l'échantillon est stratifié par ISSUE, déterministe, et un papier y entre une fois ;
 *   6. l'onglet d'audit ne porte AUCUNE valeur, seulement des comptes et des oui/non ;
 *   7. une panne de canal laisse la ligne « à faire » ; un défaut du papier est une mesure.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const M = 1e6;

function ctxVision(reponse, opts) {
  const o = opts || {};
  const c = load(['Config.gs', 'Cout.gs', 'Journal.gs', 'Consolidation.gs', 'Piece.gs', 'PieceVision.gs', 'Memoire.gs', 'AuditVision.gs']);
  c.appels = [];
  c.journal = [];
  c.estPannePlateforme_ = () => false;
  c.getCleAnthropic_ = () => 'CLE';
  c.signalerPannePlateforme_ = () => false;
  c.signalerRetablissement_ = () => {};
  c.journalErreur_ = (s, m) => { c.journal.push(s + ' ' + m); };
  c.tronquer_ = (t) => String(t);
  c.texteReponse_ = (d) => (d.content || []).map((b) => b.text || '').join('');
  c.Utilities.base64Encode = () => 'QkFTRTY0';
  c.extraireTexte_ = () => (o.texte === undefined ? 'texte exact du docx' : o.texte);
  c.fetchAvecRetry_ = (url, options) => {
    c.appels.push(JSON.parse(options.payload));
    if (!reponse) return null;
    return { getResponseCode: () => reponse.code || 200, getContentText: () => JSON.stringify(reponse.corps) };
  };
  c.reinitialiserUsage_();
  return c;
}

function fichier(nom, mime, octets) {
  return {
    getName: () => nom, getMimeType: () => mime, getSize: () => octets, getId: () => 'ID_' + nom,
    getBlob: () => ({ getBytes: () => [1, 2, 3], getContentType: () => mime }),
    getAs: () => ({ getBytes: () => [4, 5], getContentType: () => 'application/pdf' }),
  };
}

const EXTRACTION = {
  lisible: true, resume: 'Passeport de Marc.', type: 'passeport', emetteur: 'Gouvernement du Canada',
  langue: 'fr', date_document: '2024-01-10', date_echeance: '2034-01-10',
  titulaire: 'Marc Richard', titulaire_confiance: 0.97,
  champs: { numeros: [{ libelle: 'numéro de passeport', valeur: 'AB123456' }] },
  libres: { 'date de naissance': '1990-05-01', 'apparence (photo)': 'cheveux courts bruns' },
  confiance: 0.95
};

function reponseOk(extraction, extra) {
  return { corps: Object.assign({
    content: [{ type: 'text', text: JSON.stringify(extraction || EXTRACTION) }],
    usage: { input_tokens: 3000, output_tokens: 900, cache_read_input_tokens: 1200 },
    stop_reason: 'end_turn'
  }, extra || {}) };
}

/* ---------- 1. la voie ---------- */

test('la VOIE suit le format — et ce que l\'API refuse passe par l\'aperçu de Drive', () => {
  const c = ctxVision();
  assert.strictEqual(c.voieVision_('application/pdf', 'a.pdf', 200000), 'pdf');
  assert.strictEqual(c.voieVision_('application/pdf', 'scan.pdf', 30 * 1024 * 1024), 'texte',
    'un PDF énorme coûterait le prix de trente papiers : il passe par le texte');
  assert.strictEqual(c.voieVision_('image/jpeg', 'p.jpg', 500000), 'image');
  assert.strictEqual(c.voieVision_('image/jpeg', 'p.jpg', 6 * 1024 * 1024), 'apercu',
    'au-delà de 5 Mo l\'API refuse l\'image');
  assert.strictEqual(c.voieVision_('image/tiff', 'c.tiff', 1000), 'apercu', 'TIFF : refusé par l\'API');
  assert.strictEqual(c.voieVision_('image/heic', 'c.heic', 1000), 'apercu');
  assert.strictEqual(c.voieVision_('application/vnd.google-apps.document', 'doc', 0), 'export-pdf');
  assert.strictEqual(c.voieVision_(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx', 1000), 'texte',
    'un format bureautique a un texte EXACT, qu\'une image lirait moins bien');
  assert.strictEqual(c.voieVision_('text/html', 'm.html', 1000), 'texte');
});

/* ---------- 2. l'apparence ---------- */

test('le titulaire « Marc » se reconnaît en mot entier, accents et ordre ignorés', () => {
  const c = ctxVision();
  assert.strictEqual(c.titulaireEstMarc_('Marc Richard'), true);
  assert.strictEqual(c.titulaireEstMarc_('RICHARD, Marc'), true);
  assert.strictEqual(c.titulaireEstMarc_('Marc Richard (Canada)'), true);
  assert.strictEqual(c.titulaireEstMarc_('Marcel Richardson'), false);
  assert.strictEqual(c.titulaireEstMarc_('Marc-André Richard'), false, 'le trait d\'union colle');
  assert.strictEqual(c.titulaireEstMarc_('Julie Richard'), false);
  assert.strictEqual(c.titulaireEstMarc_(null), false);
});

test('L\'APPARENCE NE PART QUE POUR MARC — et l\'extraction de l\'appelant n\'est pas mutée', () => {
  const c = ctxVision();
  const proche = Object.assign({}, EXTRACTION, { titulaire: 'Julie Richard' });
  const f = c.filtrerApparence_(proche);
  assert.strictEqual(f.libres['apparence (photo)'], undefined);
  assert.strictEqual(f.libres['date de naissance'], '1990-05-01', 'le reste des libres reste');
  assert.strictEqual(proche.libres['apparence (photo)'], 'cheveux courts bruns', 'copie, pas mutation');
  // Un titulaire INCONNU n'est pas Marc : le défaut prudent n'attribue rien.
  assert.strictEqual(c.filtrerApparence_(Object.assign({}, EXTRACTION, { titulaire: null }))
    .libres['apparence (photo)'], undefined);
  assert.strictEqual(c.filtrerApparence_(EXTRACTION).libres['apparence (photo)'], 'cheveux courts bruns');
});

/* ---------- 3. l'appel ---------- */

test('un PDF part en bloc `document`, sous Sonnet 5, SANS réflexion, et revient signé v3', () => {
  const c = ctxVision(reponseOk());
  const hors = {};
  const e = c.extrairePieceVision_(fichier('passeport.pdf', 'application/pdf', 1000), hors);
  assert.ok(e);
  const p = c.appels[0];
  assert.strictEqual(p.model, 'claude-sonnet-5');
  assert.deepStrictEqual(p.thinking, { type: 'disabled' });
  assert.strictEqual(p.messages[0].content[1].type, 'document');
  assert.strictEqual(p.messages[0].content[1].source.media_type, 'application/pdf');
  assert.strictEqual(e.extracteur, 'sonnet-5-vision-piece-v3');
  assert.strictEqual(hors.motif, 'ok');
  assert.strictEqual(hors.voie, 'pdf');
  // Compté à SON prix : 3 000 × 2 + 900 × 10 + 1 200 × 0,2 = 15 240 $/M.
  assert.ok(Math.abs(c.coutVisionDollars_(hors.usage) - 15240 / M) < 1e-12);
  assert.strictEqual(c.usageRunSnapshot_().s5in, 3000);
  assert.strictEqual(c.usageRunSnapshot_().sin, 0);
});

test('une photo part en bloc `image`, un .docx en TEXTE exact', () => {
  const c = ctxVision(reponseOk());
  c.extrairePieceVision_(fichier('p.jpg', 'image/jpeg', 1000), {});
  assert.strictEqual(c.appels[0].messages[0].content[1].type, 'image');
  assert.strictEqual(c.appels[0].messages[0].content[1].source.media_type, 'image/jpeg');
  c.extrairePieceVision_(fichier('a.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000), {});
  assert.strictEqual(c.appels[1].messages[0].content.length, 1);
  assert.ok(/texte exact du docx/.test(c.appels[1].messages[0].content[0].text));
});

test('une réponse COUPÉE par le plafond se dit « coupee », jamais « rien tiré »', () => {
  const c = ctxVision({ corps: { content: [{ type: 'text', text: '{"lisible": true, "resume": "Relevé de' }],
    usage: { input_tokens: 10, output_tokens: 8000 }, stop_reason: 'max_tokens' } });
  const hors = {};
  assert.strictEqual(c.extrairePieceVision_(fichier('r.pdf', 'application/pdf', 1000), hors), null);
  assert.strictEqual(hors.motif, 'coupee');
  assert.ok(hors.usage, 'l\'appel a été payé : son usage est rendu quand même');
});

test('« lisible: false » reste un refus DIT — la vision ne fabrique pas plus qu\'Haiku', () => {
  const c = ctxVision({ corps: { content: [{ type: 'text', text: '{"lisible": false}' }],
    usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' } });
  const hors = {};
  assert.strictEqual(c.extrairePieceVision_(fichier('p.jpg', 'image/jpeg', 1000), hors), null);
  assert.strictEqual(hors.motif, 'illisible');
});

test('un .docx sans texte ne paie AUCUN appel', () => {
  const c = ctxVision(reponseOk(), { texte: '   ' });
  const hors = {};
  assert.strictEqual(c.extrairePieceVision_(fichier('v.docx', 'application/msword', 10), hors), null);
  assert.strictEqual(hors.motif, 'sans-texte');
  assert.strictEqual(c.appels.length, 0);
});

/* ---------- 4. la pièce envoyée ---------- */

test('la pièce v3 porte SON nom et SES bornes ; toute autre garde celles d\'avant', () => {
  const c = ctxVision();
  assert.strictEqual(c.EXTRACTEUR_PIECE_VISION, c.EXTRACTEUR_PIECE_VISION_MEMOIRE,
    'deux copies d\'un même nom : un test les tient égales');
  const libres = {};
  for (let i = 0; i < 90; i++) libres['c' + i] = 'v';
  const ligne = { cle: 'drive|X', nom: '2024-01-10_Passeport_Canada.pdf', domaine: '04 · Immigration',
    statut: 'classé', chemin: '', fileId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345' };
  const v3 = c.pieceMemoire_(ligne, { resume: 'x'.repeat(2000), libres: libres, extracteur: 'sonnet-5-vision-piece-v3' });
  assert.strictEqual(v3.extracteur, 'sonnet-5-vision-piece-v3');
  assert.strictEqual(v3.resume.length, 1500);
  assert.strictEqual(Object.keys(v3.champs_libres).length, 80);
  const v2 = c.pieceMemoire_(ligne, { resume: 'x'.repeat(2000), libres: libres });
  assert.strictEqual(v2.extracteur, 'haiku-4.5-piece-v2');
  assert.strictEqual(v2.resume.length, 600);
  assert.strictEqual(Object.keys(v2.champs_libres).length, 40);
  // Un nom que l'extraction s'attribuerait elle-même ne franchit pas : il retombe sur v2.
  assert.strictEqual(c.pieceMemoire_(ligne, { resume: 'r', extracteur: 'je-suis-v9' }).extracteur,
    'haiku-4.5-piece-v2');
});

/* ---------- 5. l'échantillon ---------- */

/** Un fileId PLAUSIBLE (≥ 20 caractères) : `fileIdDeLigneIndex_` ignore les autres, à raison. */
const FID = (s) => (s + 'x'.repeat(25)).slice(0, 25);

function ligneIndex(fileId, nom, domaine) {
  return ['drive|' + fileId, '', nom, domaine, '', 'classé', '', '', fileId];
}

test('l\'échantillon suit les quotas par ISSUE, met les photos d\'abord, et fait 20', () => {
  const c = ctxVision();
  const motifs = {};
  const lignes = [];
  const issues = ['illisible', 'ocr-echec', 'sans-texte', 'lecture-impossible', 'extraction-vide', 'ok'];
  issues.forEach((m, k) => {
    for (let i = 0; i < 8; i++) {
      const id = FID('F' + k + '_' + i);
      motifs[id] = m;
      lignes.push(ligneIndex(id, (i === 7 ? 'photo' : 'doc' + i) + (i === 7 ? '.jpg' : '.pdf'),
        i % 2 ? '02 · Finances' : '04 · Immigration'));
    }
  });
  motifs[FID('DISPARU')] = 'introuvable';
  lignes.push(ligneIndex(FID('DISPARU'), 'x.jpg', '04 · Immigration'));
  const e = c.composerEchantillonVision_(motifs, lignes, c.fileIdDeLigneIndex_);
  assert.strictEqual(e.length, c.tailleAuditVision_());
  assert.strictEqual(e.length, 20);
  const compte = {};
  e.forEach((d) => { compte[d.avant] = (compte[d.avant] || 0) + 1; });
  assert.deepStrictEqual(compte, { 'illisible': 5, 'ocr-echec': 4, 'sans-texte': 3,
    'lecture-impossible': 2, 'extraction-vide': 2, 'ok': 4 });
  assert.strictEqual(e[0].nom, 'photo.jpg', 'la photo passe devant : c\'est là que la vision a à prouver');
  assert.ok(!e.some((d) => d.fileId === FID('DISPARU')), 'un fichier supprimé ne mesure rien');
  // Déterministe : même entrée, même liste.
  assert.deepStrictEqual(c.composerEchantillonVision_(motifs, lignes, c.fileIdDeLigneIndex_)
    .map((d) => d.fileId), e.map((d) => d.fileId));
});

test('un papier entre UNE fois, sous sa ligne d\'Index la plus RÉCENTE', () => {
  const c = ctxVision();
  const e = c.composerEchantillonVision_({ [FID('A')]: 'illisible' },
    [ligneIndex(FID('A'), 'a.pdf', '01 · Administratif & identité'), ligneIndex(FID('A'), 'a.pdf', '04 · Immigration')],
    c.fileIdDeLigneIndex_);
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0].domaine, '04 · Immigration');
});

test('ce qu\'une issue ne fournit pas revient aux autres — la taille promise est la taille rendue', () => {
  const c = ctxVision();
  const motifs = {};
  const lignes = [];
  for (let i = 0; i < 30; i++) { motifs[FID('K' + i)] = 'ok'; lignes.push(ligneIndex(FID('K' + i), 'k' + i + '.pdf', '02')); }
  assert.strictEqual(c.composerEchantillonVision_(motifs, lignes, c.fileIdDeLigneIndex_).length, 20);
});

/* ---------- 6. l'onglet ne porte aucune valeur ---------- */

test('L\'ONGLET NE PORTE AUCUNE VALEUR — des comptes et des oui/non, jamais un numéro', () => {
  const c = ctxVision();
  const piece = c.pieceMemoire_(
    { cle: 'k', nom: 'p.jpg', domaine: '04 · Immigration', statut: 'classé', fileId: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ012345' },
    Object.assign({}, EXTRACTION, { extracteur: 'sonnet-5-vision-piece-v3' }));
  const cellules = c.cellulesAuditVision_({
    motif: 'ok', acceptees: 1, remplacees: 1, piece: piece,
    vision: { voie: 'image', motif: 'ok', usage: { input_tokens: 1000, output_tokens: 500 }, dureeMs: 12345 }
  }, '2026-09-24 20:00');
  const texte = JSON.stringify(cellules);
  ['AB123456', '1990-05-01', 'cheveux', 'Marc Richard', 'Passeport de Marc'].forEach((v) => {
    assert.ok(texte.indexOf(v) === -1, 'valeur en clair dans l\'onglet : ' + v);
  });
  assert.strictEqual(cellules.length, c.COLONNES_AUDIT_VISION.length - c.COL_STATUT_AUDIT_VISION);
  const col = (nom) => cellules[c.COLONNES_AUDIT_VISION.indexOf(nom) - c.COL_STATUT_AUDIT_VISION];
  assert.strictEqual(col('Statut'), 'fait');
  assert.strictEqual(col('Titulaire'), 'Marc');
  assert.strictEqual(col('Naissance'), 'oui');
  assert.strictEqual(col('Apparence'), 'oui');
  assert.strictEqual(col('Numéros'), 1);
  assert.strictEqual(col('Mémoire'), 'remplace la lecture précédente');
  assert.strictEqual(col('Durée s'), 12.3);
  assert.ok(Math.abs(col('Coût $') - 0.007) < 1e-9);
});

/* ---------- 7. panne ou mesure ---------- */

test('une panne de CANAL ou un hoquet de l\'appel laisse la ligne à faire ; un défaut du papier est une MESURE', () => {
  const c = ctxVision();
  assert.strictEqual(c.issueAuditVision_({ motif: 'jeton-refuse' }), 'panne');
  assert.strictEqual(c.issueAuditVision_({ motif: 'frein-budget' }), 'panne');
  assert.strictEqual(c.issueAuditVision_({ motif: 'extraction-vide', vision: { motif: 'reseau' } }), 'panne');
  assert.strictEqual(c.issueAuditVision_({ motif: 'extraction-vide', vision: { motif: 'http-529' } }), 'panne');
  assert.strictEqual(c.issueAuditVision_({ motif: 'plafond-run' }), 'plafond');
  assert.strictEqual(c.issueAuditVision_({ motif: 'extraction-vide', vision: { motif: 'http-400' } }), 'echec',
    'un 400 est déterministe : le format que l\'API refuse, c\'est une mesure');
  assert.strictEqual(c.issueAuditVision_({ motif: 'illisible', vision: { motif: 'illisible' } }), 'echec');
  assert.strictEqual(c.issueAuditVision_({ motif: 'ok', piece: {} }), 'fait');
  assert.strictEqual(c.issueAuditVision_({ motif: 'refusee', piece: {} }), 'fait');
});

test('la gate lit le TAG : posé et pas fini → tourne ; fini ou vide → non', () => {
  const c = ctxVision();
  assert.strictEqual(c.auditVisionDoitTourner_('l1-a', null), true);
  assert.strictEqual(c.auditVisionDoitTourner_('l1-a', 'l1-a'), false);
  assert.strictEqual(c.auditVisionDoitTourner_('l1-b', 'l1-a'), true, 'changer le tag relance');
  assert.strictEqual(c.auditVisionDoitTourner_('', null), false);
});

test('la phrase de Santé dit le reste, le coût, et « à toi de juger » à zéro', () => {
  const c = ctxVision();
  assert.ok(/non armé/.test(c.phraseFinAuditVision_('', '')));
  assert.ok(/jamais passé/.test(c.phraseFinAuditVision_('', 'l1-a')));
  const fini = c.phraseFinAuditVision_('2026-09-24T20:00:00Z|termine|18/2|0|0.84', 'l1-a');
  assert.ok(/0 restants sur 20/.test(fini) && /0\.84 \$/.test(fini) && /à toi de juger/.test(fini), fini);
  // « je ne sais pas » ne se lit jamais « terminé ».
  assert.ok(!/à toi de juger/.test(c.phraseFinAuditVision_('2026-09-24T20:00:00Z|canal|0/0||0', 'l1-a')));
});

/* ---------- 8. LA CHAÎNE ENTIÈRE — étape → extraction → pièce → Mémoire → onglet ---------- */

/**
 * ⚠️ POURQUOI CE CAS : chaque moitié ci-dessus est testée chez elle (la voie, l'appel, la
 * pièce, les cellules), et un TROU ENTRE DEUX MOITIÉS N'APPARTIENT À PERSONNE. Ici tout est
 * réel sauf les frontières (Drive, Anthropic, la Mémoire, la Sheet) : si `pousserPieceApres
 * Classement_` exigeait encore un texte OCR sous la voie vision, ou si l'extracteur v3 se
 * perdait en route, ce cas rougirait — les autres non.
 */
function chaine(reponseMemoire, opts) {
  const o = opts || {};
  const props = new Map([['DriveAI_MEMORYAI_TOKEN', 'jeton']]);
  const c = load(['Config.gs', 'Cout.gs', 'Journal.gs', 'Consolidation.gs', 'Gmail.gs', 'Piece.gs',
    'PieceVision.gs', 'Memoire.gs', 'AuditPiece.gs', 'AuditVision.gs'], {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
    }) },
  });
  c.props = props;
  c.estPannePlateforme_ = () => false;
  c.getCleAnthropic_ = () => 'CLE';
  c.signalerPannePlateforme_ = () => false;
  c.signalerRetablissement_ = () => {};
  c.journalErreur_ = () => {};
  c.tronquer_ = (t) => String(t);
  c.texteReponse_ = (d) => (d.content || []).map((b) => b.text || '').join('');
  c.Utilities.base64Encode = () => 'QkFTRTY0';
  c.budgetCampagnesAtteint_ = () => false;
  c.fetchAvecRetry_ = () => ({ getResponseCode: () => 200,
    getContentText: () => JSON.stringify(reponseOk().corps) });
  c.envoyes = [];
  c.UrlFetchApp = { fetch: (url, options) => {
    c.envoyes.push({ url: url, corps: JSON.parse(options.payload) });
    return { getResponseCode: () => reponseMemoire.code || 200,
      getContentText: () => JSON.stringify(reponseMemoire.corps || {}) };
  } };
  c.DriveApp = { getFileById: (id) => fichier('passeport_' + id + '.jpg', 'image/jpeg', 1000) };
  const lignes = [
    [1, FID('P1'), 'p1.jpg', '04 · Immigration', 'illisible', 'à faire'],
    [2, FID('P2'), 'p2.jpg', '04 · Immigration', 'ok', 'à faire'],
  ].map((l) => { while (l.length < c.COLONNES_AUDIT_VISION.length) l.push(''); return l; });
  c.ecrits = {};
  c.ongletAuditVision_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: (ligne, col, n, largeur) => ({
      getValues: () => lignes,
      setValues: (v) => { c.ecrits[ligne] = { col: col, valeurs: v[0] }; },
    }),
  });
  if (o.tagVide) c.CONFIG.AUDIT_VISION_TAG = '';
  return c;
}

test('LA CHAÎNE : deux papiers lus par l\'image, envoyés en v3, et mesurés dans l\'onglet', () => {
  const c = chaine({ corps: { recus: 1, acceptees: 1, remplacees: 1, dejaPresentes: 0, refusees: [] } });
  const res = c.etapeAuditVision_(() => false, { manuel: true });
  assert.strictEqual(res.faits, 2);
  assert.strictEqual(res.restants, 0);
  assert.strictEqual(c.envoyes.length, 2);
  const piece = c.envoyes[0].corps.pieces[0];
  assert.strictEqual(piece.extracteur, 'sonnet-5-vision-piece-v3', 'le nom v3 doit arriver à la Mémoire');
  assert.strictEqual(piece.champs_libres['apparence (photo)'], 'cheveux courts bruns', 'papier de Marc');
  assert.strictEqual(piece.exemplaires[0].file_id, FID('P1'));
  const cellules = c.ecrits[2].valeurs;
  assert.strictEqual(cellules[0], 'fait');
  assert.strictEqual(cellules[cellules.length - 2], 'remplace la lecture précédente');
  assert.ok(res.dollars > 0, 'le coût se MESURE sur la réponse');
  assert.strictEqual(c.props.get('DriveAI_AUDIT_VISION_FINI'), c.CONFIG.AUDIT_VISION_TAG,
    'à zéro restant, la gate se referme d\'elle-même');
});

test('LA CHAÎNE : une Mémoire qui refuse le jeton laisse les lignes « à faire », rien n\'est marqué', () => {
  const c = chaine({ code: 401 });
  const res = c.etapeAuditVision_(() => false, { manuel: true });
  assert.strictEqual(res.fin, 'canal');
  assert.deepStrictEqual(Object.keys(c.ecrits), [], 'une panne de canal ne s\'écrit pas comme une mesure');
  assert.notStrictEqual(c.props.get('DriveAI_AUDIT_VISION_FINI'), c.CONFIG.AUDIT_VISION_TAG);
});

test('LA CHAÎNE : tag vide et hors chemin manuel, la vision n\'envoie RIEN', () => {
  const c = chaine({ corps: { acceptees: 1 } }, { tagVide: true });
  const env = c.pousserPieceApresClassement_({ cle: '' },
    { nom: 'p.jpg', domaine: '04 · Immigration', statut: 'classé', fileId: FID('P1') }, '',
    { vision: { fichier: fichier('p.jpg', 'image/jpeg', 10) } });
  assert.strictEqual(env.motif, 'desactive');
  assert.strictEqual(c.envoyes.length, 0);
});
