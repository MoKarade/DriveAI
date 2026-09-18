/**
 * LectureFile.gs — L36 : lire TOUT le stock, en demandant à la Mémoire « qu'est-ce que je lis
 * ensuite ? » (MemoryAI ADR 0007, ADR-0061 §9 amendement du 18/09).
 *
 * ⚠️ POURQUOI CE MODULE EXISTE, À CÔTÉ DE `RattrapagePiece.gs`. Le rattrapage C49-5 tient son
 * idempotence dans une Script Property — 200 `fileId`, ~9 Ko — et REFUSE une tranche plus
 * grande, par conception : « la tranche suivante demandera un autre mécanisme d'idempotence ».
 * Le voici, et il ne vit PAS ici : depuis l'ADR 0006 de MemoryAI, une vraie lecture REMPLACE
 * la pièce d'inventaire, donc la Mémoire SAIT ce qui est lu. Sa file (`GET /api/pieces/file`)
 * rend les papiers encore d'inventaire ; un papier lu en sort TOUT SEUL. Ce module ne tient
 * donc AUCUNE liste : perdre ses Properties coûte une re-sonde, jamais une relecture payée.
 *
 * ⚠️ CE QU'IL NE REFAIT PAS. Lire, extraire, mettre en forme, envoyer : tout passe par
 * `rattraperUnDocumentDetail_` → `pousserPieceApresClassement_`, le MÊME chemin que le flux
 * vivant et que C49-5, avec les mêmes gardes. Une seconde implémentation serait « une règle
 * et demie » : un papier lu par la file arriverait à la Mémoire autrement qu'un papier classé
 * aujourd'hui, et rien ne le dirait.
 *
 * ⚠️ L'ORDRE N'EST PAS DÉCIDÉ ICI. Marc l'a choisi le 18/09 (émetteurs nommés d'abord, export
 * Facebook en dernier) et c'est la Mémoire qui l'applique, sur des clés keyées. Ce module lit
 * la file DANS L'ORDRE REÇU et ne la retrie jamais — un tri local « par domaine » déferait sa
 * décision sans que personne ne le voie.
 *
 * ⚠️ UN DOCUMENT QUI NE DONNE RIEN SE DIT À LA MÉMOIRE (`POST /api/pieces/file`). Il ne
 * remplace rien, donc il resterait EN TÊTE de file pour toujours et chaque passe repaierait
 * son OCR — parfois son appel Haiku. C'est la marque « sur toute issue DÉFINITIVE » de C49-5,
 * déplacée là où vit désormais l'idempotence. Une PANNE de canal, elle, ne se note JAMAIS :
 * elle sortirait de la file des papiers parfaitement lisibles (et la Mémoire la refuse).
 *
 * ⚠️ LE BUDGET N'EST PAS UNE ADDITION. Aucune constante `*_BUDGET_JOUR_MS` à lui : il consomme
 * le budget quotidien des PIÈCES (`AUDIT_PIECE_BUDGET_JOUR_MS`), et ne démarre que quand
 * l'audit C49-3 ET le rattrapage C49-5 n'ont plus rien à faire. Les trois sont mutuellement
 * exclusifs : l'enveloppe de 63 min/j ne bouge pas d'une minute.
 *
 * ⚠️ LA VOIE : le TICK, frontière ÉTROITE (seuls les champs sortent du compte Google). La Q1
 * de l'ADR-0061 prévoyait un runner pour le stock complet ; l'amendement du 18/09 dit
 * pourquoi ce module prend la voie étroite, ce que ça coûte en calendrier, et que la file
 * sert les deux voies à l'identique si Marc veut rouvrir la question.
 */

/** Plafond d'extractions par run du TICK. Même unité de coût que C49-5 et que le flux. */
var LECTURE_FILE_MAX_PAR_RUN = 5;

/**
 * Quand la file est VIDE, on ne la re-sonde qu'à cet intervalle.
 *
 * ⚠️ Sans lui, une campagne TERMINÉE ferait un appel réseau par tick — 288 par jour — pour
 * apprendre 288 fois qu'il n'y a rien. Avec un zéro définitif, l'inverse : l'inventaire
 * continue d'arriver (chaque document classé y ajoute une ligne), donc « vide » n'est jamais
 * un état final, et une gate qui s'éteindrait pour toujours laisserait les papiers de demain
 * sans lecteur — l'interblocage du 17/09, par l'autre bout.
 */
var LECTURE_FILE_RESONDE_MS = 6 * 60 * 60 * 1000;

/**
 * Les verdicts que la Mémoire ACCEPTE — copie de `MOTIFS_VERDICT` (MemoryAI,
 * `lib/pieces/fileDeLecture.ts`). ⚠️ Duplication IRRÉDUCTIBLE (deux dépôts, deux langages),
 * donc TESTÉE et non documentée : `test/lecture-file.test.js` exige que tout verdict que ce
 * module peut émettre soit dans cette liste. Un motif hors liste fait refuser le LOT ENTIER
 * (HTTP 400) — les verdicts valides du même envoi seraient perdus avec lui.
 */
var VERDICTS_ACCEPTES_MEMOIRE_ = ['sans-texte', 'ocr-echec', 'lecture-impossible', 'introuvable',
  'extraction-vide', 'piece-vide', 'refusee', 'sans-effet'];

/**
 * Le verdict à noter pour une issue, ou `null` s'il n'y a RIEN à noter. PURE.
 *
 * ⚠️ `null` recouvre deux cas opposés, et l'appelant les distingue par `issueRattrapage_` :
 * le papier est LU (il sortira de la file tout seul), ou c'est une PANNE (il doit y rester).
 *
 * ⚠️⚠️ `sans-effet` : le document a été lu et la pièce envoyée, mais la Mémoire n'a RIEN
 * accepté (déjà présente, ou oubliée par Marc). Sans ce verdict, il reviendrait en tête de
 * file à chaque passe et coûterait un OCR ET un appel Haiku à chaque fois — mot pour mot
 * l'écriture inerte que l'ADR 0006 de MemoryAI a corrigée, recommise par la file.
 *
 * @param {string} motif      rendu par le canal
 * @param {number} acceptees  ce que la Mémoire dit avoir écrit
 */
function verdictDeLecture_(motif, acceptees) {
  var m = String(motif || '');
  if (issueRattrapage_(m) === 'panne') return null;
  if (m === 'ok') return (Number(acceptees) || 0) > 0 ? null : 'sans-effet';
  // Ne devrait pas arriver (la file ne sert que ce que l'Index dit classé) ; si ça arrive, le
  // document n'est plus où l'inventaire l'a vu.
  if (m === 'non-classe') return 'introuvable';
  return VERDICTS_ACCEPTES_MEMOIRE_.indexOf(m) !== -1 ? m : null;
}

/**
 * L'Index vu PAR `fileId`. PURE.
 *
 * ⚠️ La DERNIÈRE ligne gagne : un document re-classé a deux lignes, et c'est son état le plus
 * récent (nom, domaine, chemin) qui doit partir avec la pièce.
 */
function indexParFileId_(lignes, fileIdDe) {
  var out = {};
  if (!lignes) return out;
  for (var i = 0; i < lignes.length; i++) {
    var cle = String(lignes[i][0] || '');
    var fileId = fileIdDe(cle);
    if (!fileId) continue;
    out[fileId] = {
      cle: cle,
      nom: String(lignes[i][2] || ''),
      domaine: String(lignes[i][3] || ''),
      chemin: String(lignes[i][4] || ''),
      statut: String(lignes[i][5] || ''),
      fileId: fileId
    };
  }
  return out;
}

/** `<tag>|<restants>|<ms de la dernière sonde>` — le TAG est dans la valeur (leçon du 17/09). PURE. */
function encoderEtatLectureFile_(tag, restants, ms) {
  return String(tag || '') + '|'
    + ((typeof restants === 'number' && isFinite(restants)) ? String(restants) : '') + '|'
    + String(ms || '');
}

/** Rend `{restants, sondeMs}`, tous deux `null` si l'état est absent ou écrit sous un autre tag. PURE. */
function decoderEtatLectureFile_(brut, tag) {
  var vide = { restants: null, sondeMs: null };
  var p = String(brut == null ? '' : brut).split('|');
  if (p.length < 3 || p[0] !== String(tag || '')) return vide;
  // ⚠️ `Number('')` vaut 0 : un reste non mesuré ne doit JAMAIS se lire « file vide ».
  var restants = p[1] === '' ? null : Number(p[1]);
  var sondeMs = p[2] === '' ? null : Number(p[2]);
  return {
    restants: (restants !== null && isFinite(restants)) ? restants : null,
    sondeMs: (sondeMs !== null && isFinite(sondeMs)) ? sondeMs : null
  };
}

/**
 * La GATE du tick. PURE.
 *
 * ⚠️ « Je ne sais pas » fait TOURNER, « zéro » fait ATTENDRE la prochaine re-sonde — jamais
 * s'éteindre (voir `LECTURE_FILE_RESONDE_MS`).
 */
function lectureFileDoitTourner_(tagCourant, etat, maintenantMs) {
  if (!String(tagCourant || '')) return false;
  if (!etat || etat.restants === null || etat.restants > 0) return true;
  if (etat.sondeMs === null) return true;
  return (maintenantMs - etat.sondeMs) >= LECTURE_FILE_RESONDE_MS;
}

/** I/O. Demande la file. Rend `{ok, file, restants}` ou `{ok:false, raison}`. */
function demanderFileLecture_(jeton, props, limite) {
  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/pieces/file'
    + '?extracteur=' + encodeURIComponent(EXTRACTEUR_PIECE_MEMOIRE) + '&limite=' + limite;
  var rep;
  try {
    rep = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + jeton },
      muteHttpExceptions: true
    });
  } catch (e) {
    suspendreMemoire_(props, 'réseau (file de lecture) : ' + e);
    return { ok: false, raison: 'reseau' };
  }
  var code = rep.getResponseCode();
  if (code === 200) {
    var corps = null;
    try { corps = JSON.parse(rep.getContentText()); } catch (e) { corps = null; }
    // ⚠️ Un 200 ILLISIBLE n'est pas une file vide : le lire « rien à faire » éteindrait la
    // campagne pour six heures sur une réponse qu'on n'a pas comprise.
    if (!corps || !Array.isArray(corps.file) || typeof corps.restants !== 'number') {
      return { ok: false, raison: 'reponse-illisible' };
    }
    var ids = [];
    for (var i = 0; i < corps.file.length; i++) {
      var id = corps.file[i] && corps.file[i].file_id;
      if (typeof id === 'string' && id) ids.push(id);
    }
    return { ok: true, file: ids, restants: corps.restants };
  }
  if (code === 401 || code === 403) {
    journalErreur_('LectureFile', 'Jeton refusé (' + code + ') par la file de lecture. Geste de Marc requis.');
    return { ok: false, raison: code === 401 ? 'jeton-refuse' : 'perimetre-retire' };
  }
  // ⚠️ 404 = la Mémoire déployée ne connaît pas ENCORE la route. Ce n'est pas une panne du
  // serveur : suspendre couperait AUSSI l'inventaire et les pièces du flux, qui marchent.
  if (code === 404) return { ok: false, raison: 'file-absente' };
  suspendreMemoire_(props, 'HTTP ' + code + ' (file de lecture)');
  return { ok: false, raison: 'panne' };
}

/** I/O. Note les verdicts. Best-effort : un échec coûte une re-tentative, jamais une donnée. */
function noterVerdictsLecture_(jeton, verdicts) {
  if (!verdicts.length) return { ok: true, notes: 0 };
  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/pieces/file';
  try {
    var rep = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + jeton },
      payload: JSON.stringify({ extracteur: EXTRACTEUR_PIECE_MEMOIRE, verdicts: verdicts }),
      muteHttpExceptions: true
    });
    if (rep.getResponseCode() === 200) {
      var corps = {};
      try { corps = JSON.parse(rep.getContentText()); } catch (e) { corps = {}; }
      return { ok: true, notes: Number(corps.notes) || 0 };
    }
    journalErreur_('LectureFile', 'Verdicts non notés (HTTP ' + rep.getResponseCode() + ') : ces '
      + verdicts.length + ' documents reviendront dans la file et re-coûteront leur lecture.');
  } catch (e) {
    journalErreur_('LectureFile', 'Verdicts non notés (' + e + ') : ces ' + verdicts.length
      + ' documents reviendront dans la file et re-coûteront leur lecture.');
  }
  return { ok: false, notes: 0 };
}

/**
 * Le SIGNAL — un seul endroit l'écrit, donc aucune sortie ne peut l'oublier (C28-135).
 * `DriveAI_LECTURE_FILE_FIN` = `<ISO>|<fin>|<lus>/<sans résultat>|<restants>|<tick|manuel>`
 */
function ligneFinLectureFile_(maintenant, res, manuel) {
  return [
    maintenant.toISOString().slice(0, 16).replace('T', ' '),
    res.fin,
    res.lus + '/' + res.sansResultat,
    (typeof res.restants === 'number' && isFinite(res.restants)) ? String(res.restants) : '',
    manuel ? 'manuel' : 'tick'
  ].join('|');
}

function noterFinLectureFile_(props, res, manuel, tag) {
  try {
    props.setProperty('DriveAI_LECTURE_FILE_FIN', ligneFinLectureFile_(new Date(), res, manuel));
    // ⚠️ L'ÉTAT DE LA GATE N'EST ÉCRIT QUE S'IL A ÉTÉ MESURÉ. Une sortie précoce (jeton absent,
    // budget, panne) n'a rien appris de la file : y poser un zéro ferait attendre six heures
    // une campagne qui a du travail — le compteur écrasé par une ignorance, vécu le 17/09.
    if (res.sonde && typeof res.restants === 'number' && isFinite(res.restants)) {
      props.setProperty('DriveAI_LECTURE_FILE_ETAT', encoderEtatLectureFile_(tag, res.restants, Date.now()));
    }
  } catch (e) { /* observabilité best-effort : jamais au prix de l'étape */ }
  return res;
}

/** La phrase de Santé, lue sans rien exécuter. PURE. */
function phraseFinLectureFile_(brut, tagCourant) {
  if (!String(tagCourant || '')) return 'non armée — poser CONFIG.LECTURE_FILE_TAG pour lire le stock';
  if (!brut) return 'armée (« ' + tagCourant + ' »), jamais passée';
  var p = String(brut).split('|');
  var restants = (p[3] === '' || p[3] === undefined) ? NaN : Number(p[3]);
  var phrase = (isFinite(restants) ? restants + ' papiers restants dans la file' : 'reste inconnu')
    + ' · dernière passe : ' + (p[2] || '?') + ' (lus/sans résultat) — ' + (p[1] || '?')
    + ' · ' + (p[0] || '?')
    + ' · ' + (p[4] === 'manuel' ? 'lancée à la main' : 'par le tick');
  if (isFinite(restants) && restants === 0) phrase += ' · ✅ file vide — re-sondée toutes les 6 h';
  return phrase;
}

function texteSanteLectureFile_() {
  var brut;
  try { brut = PropertiesService.getScriptProperties().getProperty('DriveAI_LECTURE_FILE_FIN'); }
  catch (e) { return 'état illisible'; }
  return phraseFinLectureFile_(brut, CONFIG.LECTURE_FILE_TAG);
}

/**
 * L'étape. Demande la file, lit dans l'ordre reçu, note ce qui ne donne rien, DIT pourquoi
 * elle s'arrête.
 *
 * @param {Function} garde  le garde-temps du tick
 * @param {Object=} opts    `{manuel: true}` depuis l'éditeur : hors budget QUOTIDIEN
 */
function etapeLectureFile_(garde, opts) {
  opts = opts || {};
  var manuel = !!opts.manuel;
  var props = PropertiesService.getScriptProperties();
  var tag = String(CONFIG.LECTURE_FILE_TAG || '');
  // `sonde: false` tant que la file n'a pas répondu : c'est ce qui interdit à une sortie
  // précoce d'écrire un reste qu'elle n'a pas mesuré.
  var res = { lus: 0, sansResultat: 0, restants: null, fin: 'desactive', dernierMotif: '', sonde: false };
  var finir = function () { return noterFinLectureFile_(props, res, manuel, tag || 'manuel'); };

  if (!tag && !manuel) { res.fin = 'non-armee'; return finir(); }

  var jeton = props.getProperty('DriveAI_MEMORYAI_TOKEN');
  if (!jeton) { res.fin = 'jeton-absent'; return finir(); }
  if (memoireSuspendue_(props)) { res.fin = 'suspendu'; return finir(); }
  if (estPannePlateforme_()) { res.fin = 'panne-plateforme'; return finir(); }
  if (budgetCampagnesAtteint_()) { res.fin = 'frein-budget'; return finir(); }

  // ⚠️ LES TROIS CAMPAGNES DES PIÈCES SONT MUTUELLEMENT EXCLUSIVES, et c'est ce qui fait que
  // ce module n'ajoute rien à l'enveloppe : il passe APRÈS l'audit et APRÈS la tranche C49-5.
  if (!manuel) {
    if (resteAuditPiece_(props) !== 0) { res.fin = 'audit-en-cours'; return finir(); }
    if (String(CONFIG.RATTRAPAGE_PIECE_TAG || '') && restantsRattrapage_(props) !== 0) {
      res.fin = 'rattrapage-en-cours'; return finir();
    }
  }

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = manuel ? 0 : budgetJourAudit_(props, aujourdhui);
  if (consommeJour >= CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS) { res.fin = 'budget-jour'; return finir(); }

  var limite = manuel ? 50 : LECTURE_FILE_MAX_PAR_RUN;
  var demande = demanderFileLecture_(jeton, props, limite);
  if (!demande.ok) { res.fin = 'canal-' + demande.raison; return finir(); }
  res.sonde = true;
  res.restants = demande.restants;
  if (!demande.file.length) { res.fin = 'file-vide'; return finir(); }

  var lignes = lireLignesIndexPerimetre_();
  if (!lignes) { res.fin = 'index-vide'; return finir(); }
  var parFileId = indexParFileId_(lignes, fileIdDeCleIndex_);

  var debutRun = Date.now();
  var plafondRun = manuel
    ? CONFIG.BUDGET_MS
    : Math.min(CONFIG.AUDIT_PIECE_BUDGET_MS, CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS - consommeJour);
  var gardeRun = function () { return (garde && garde()) || (Date.now() - debutRun) > plafondRun; };

  var verdicts = [];
  // ⚠️ COUPE-CIRCUIT, repris de C49-5 : UNE lecture Drive impossible est un verdict du
  // document ; TROIS d'affilée sont une panne de Drive (scope perdu, throttle), et noter ces
  // verdicts viderait la file de papiers lisibles. Les verdicts fragiles se RETIRENT.
  var lecturesRatees = 0;
  var fragiles = 0;
  res.fin = 'termine';
  for (var i = 0; i < demande.file.length; i++) {
    if (gardeRun()) { res.fin = 'budget'; break; }
    var fileId = demande.file[i];
    var doc = parFileId[fileId];

    var motif, acceptees = 0;
    if (!doc || String(doc.statut).toLowerCase().indexOf('class') !== 0) {
      // L'inventaire l'a vu, l'Index ne le connaît plus comme classé : déplacé, supprimé, ou
      // reparti en quarantaine. Aucune lecture n'est tentée — donc rien n'est payé.
      motif = 'non-classe';
    } else if (!estCandidatPiece_(doc.nom)) {
      motif = 'sans-texte';
    } else {
      var detail = rattraperUnDocumentDetail_(doc, manuel, { file: true, manuel: manuel });
      motif = detail.motif;
      acceptees = detail.acceptees;
    }
    res.dernierMotif = motif;

    // ⚠️ UNE PANNE DE CANAL NE SE NOTE PAS, et elle arrête la boucle : le papier doit rester
    // dans la file, et continuer brûlerait une extraction par document pour le même refus.
    if (motif !== 'non-classe' && issueRattrapage_(motif) === 'panne') { res.fin = 'canal-' + motif; break; }

    if (motif === 'lecture-impossible') {
      lecturesRatees++;
      fragiles++;
      if (lecturesRatees >= 3) {
        res.fin = 'drive-illisible';
        verdicts.splice(verdicts.length - (fragiles - 1), fragiles - 1);
        res.sansResultat -= (fragiles - 1);
        // Ils restent dans la file : le reste annoncé ne doit pas les compter partis.
        if (typeof res.restants === 'number') res.restants += (fragiles - 1);
        break;
      }
    } else {
      lecturesRatees = 0;
      fragiles = 0;
    }

    var verdict = verdictDeLecture_(motif, acceptees);
    if (verdict) {
      verdicts.push({ file_id: fileId, motif: verdict });
      res.sansResultat++;
    } else {
      res.lus++;
    }
    if (typeof res.restants === 'number') res.restants = Math.max(0, res.restants - 1);
  }

  var notes = noterVerdictsLecture_(jeton, verdicts);
  // ⚠️ Des verdicts non notés reviendront : le reste annoncé ne doit pas les compter partis.
  if (!notes.ok && typeof res.restants === 'number') res.restants += verdicts.length;

  if (!manuel) {
    try {
      props.setProperty('DriveAI_AUDIT_PIECE_JOUR_MS',
        aujourdhui + '|' + (consommeJour + (Date.now() - debutRun)));
    } catch (e) { /* le budget se re-mesurera ; jamais au prix de l'étape */ }
  }
  return finir();
}

/**
 * ⚠️ LE CHEMIN MANUEL (leçon C28-137 : un `opts` lu par le moteur et passé par personne est
 * une intention jamais livrée). Passe outre le budget QUOTIDIEN et l'ordre des campagnes —
 * c'est le geste de Marc — mais PAS le garde-temps, ni le jeton, ni la suspension, ni le
 * frein en dollars. La Santé dira « lancée à la main ».
 *
 * À lancer depuis `LectureFile.gs` → `lireFileMaintenant` → Exécuter.
 */
function lireFileMaintenant() {
  var debut = Date.now();
  var res = etapeLectureFile_(
    function () { return (Date.now() - debut) > CONFIG.BUDGET_MS; },
    { manuel: true }
  );
  var ligne = 'Lecture par la file (manuel) : ' + res.lus + ' lus / ' + res.sansResultat
    + ' sans résultat — ' + res.restants + ' restants — ' + res.fin
    + (res.dernierMotif ? ' — dernier motif : ' + res.dernierMotif : '');
  Logger.log(ligne);
  return ligne;
}
