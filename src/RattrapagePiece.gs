/**
 * RattrapagePiece.gs — C49-5, étape B : faire partir vers la Mémoire le CONTENU des papiers
 * DÉJÀ classés, `04 · Immigration` et `01 · Administratif & identité` en premier.
 *
 * ⚠️ POURQUOI CE MODULE EXISTE, ET POURQUOI ALLUMER UN FLAG NE SUFFISAIT PAS. Le canal des
 * pièces (`pousserPieceApresClassement_`) n'a qu'UN appelant : `Pipeline.gs`, juste après le
 * classement. Il ne voit donc QUE le flux vivant. Les 110 papiers de `04`+`01` sont rangés
 * depuis des semaines : ils ne repasseront jamais par `traiterDocument_`, et `PIECE_PUSH`
 * allumé ne leur ferait rien — le tableau afficherait « canal actif » pendant que le stock
 * que Marc voulait voir resterait invisible. C'est la classe `UN-CHAMP-TYPE-SANS-PRODUCTEUR`
 * vue depuis l'autre bout : le consommateur existe, c'est la POPULATION qui ne lui arrive pas.
 *
 * ⚠️ CE QUE CE MODULE NE FAIT PAS. Il n'allume pas le flux vivant. Marc a tranché le 17/09
 * (« le rattrapage seul ») : `PIECE_PUSH` reste `false`, parce que l'allumer re-tarife les
 * HUIT sites d'appel de `traiterDocument_`, dont `Reset.gs` et `Migration.gs` — c'est mot pour
 * mot le piège d'`ANALYSE_V2`, qui a doublé un mois en une nuit. Ici le périmètre est une
 * LISTE de documents choisie à l'avance, donc le coût est borné avant de partir.
 *
 * ⚠️ IL S'ARRÊTE TOUT SEUL À LA FIN DE LA TRANCHE, et c'est le cœur de la décision de Marc :
 * « 04 et 01 en PREMIER, pour voir tout de suite ce que la Mémoire sait de mes papiers
 * d'identité — et si c'est mauvais, on arrête avant d'avoir dépensé ». Élargir la tranche est
 * un geste DÉLIBÉRÉ (`PREFIXES_DOMAINE_DECISIF_PIECE`), jamais un défaut — 04 + 01, puis 02,
 * puis « tout le reste » le 23/09 (C49-26) : les neuf domaines.
 *
 * ⚠️ LE BUDGET N'EST PAS UNE ADDITION. Ce module ne reçoit aucune constante à lui : il
 * consomme le budget quotidien des PIÈCES (`AUDIT_PIECE_BUDGET_JOUR_MS`, 54 min : 11 prélevées
 * à la réconciliation en C49-3, 47 aux sept campagnes arrêtées en C49-20, moins 4 rendues à
 * l'envoi Mémoire le 23/09 — le détail
 * par donneur vit dans `AUDIT_PIECE_DONNEURS_MIN`) et il ne démarre que quand l'audit n'a plus
 * rien à extraire.
 * Les deux sont donc mutuellement exclusifs, l'enveloppe de 63 min/j ne bouge pas d'une
 * minute, et il n'y a aucun transfert à verrouiller — la leçon « RÉALLOUER, jamais AUGMENTER »
 * est respectée en ne prenant rien à personne.
 */

/**
 * Le plafond de la LISTE des documents déjà faits, persistée en Script Property.
 *
 * ⚠️ Ce nombre n'est pas une préférence : une Property plafonne à ~9 Ko et un `fileId` pèse
 * ~33 caractères plus un séparateur. 400 entrées ≈ 13,6 Ko — au-dessus de la limite. On borne
 * donc à ce que la tranche EXIGE (110 documents mesurés le 17/09), avec de la marge, et
 * `etapeRattrapagePiece_` REFUSE de démarrer une tranche plus grande au lieu de découvrir la
 * limite en production. La tranche suivante (3 862 papiers) ne tiendra JAMAIS ici : elle
 * demandera un autre mécanisme d'idempotence, et c'est écrit plutôt que découvert.
 */
/**
 * ⚠️ CE PLAFOND EST MORT LE 21/09/2026, ET IL RESTE ÉCRIT — il ne borne plus l'idempotence, il
 * borne encore le chemin MANUEL (`choixSansPlafondRattrapage_`). Sa valeur disait « ce qu'une
 * Script Property peut porter » ; l'idempotence vit maintenant dans l'onglet `PiecesFaites`,
 * qui n'a pas ce plafond. Le supprimer laisserait croire que la limite n'a jamais existé, et
 * la prochaine session re-poserait une liste dans une Property « parce que c'est plus simple ».
 */
var RATTRAPAGE_PIECE_MAX_FAITS = 200;

/**
 * Le plafond d'extractions par run du TICK. Aligné sur celui du flux : même unité de coût.
 *
 * ⚠️ Il ne s'applique PAS au chemin manuel, et c'est la leçon C28-33 : « un budget calibré pour
 * UN CHEMIN d'exécution ne doit ni brider, ni être consommé par, un AUTRE chemin ». Cinq
 * documents protègent un tick de 5 minutes qui a dix autres étapes à servir ; imposés à une
 * exécution que Marc lance lui-même avec 4,5 minutes devant elle, ils lui demanderaient de
 * cliquer VINGT-DEUX fois pour 110 documents. Le seul frein du chemin manuel est le
 * garde-temps — plus le jeton, la suspension, la panne et le frein en dollars, qui sont
 * re-évalués à CHAQUE document et qu'aucun drapeau ne lève.
 */
var RATTRAPAGE_PIECE_MAX_PAR_RUN = 5;

/**
 * Les domaines de la tranche, DANS L'ORDRE où Marc les veut. C'est la même liste que celle
 * qui a servi à les compter (`PREFIXES_DOMAINE_DECISIF_PIECE`) : une seule liste, deux
 * consommateurs — sinon le comptage promettrait une tranche et le rattrapage en traiterait
 * une autre, et personne ne le verrait puisque les deux auraient l'air de marcher.
 */
function prefixesRattrapage_() {
  return PREFIXES_DOMAINE_DECISIF_PIECE;
}

/** Le préfixe de domaine d'une ligne (`04 · Immigration` → `04`). PURE. */
function prefixeDomainePiece_(domaine) {
  return String(domaine == null ? '' : domaine).trim().slice(0, 2);
}

/**
 * Choisit les prochains documents à rattraper. PURE — aucune I/O, aucune horloge.
 *
 * L'ordre des préfixes EST la priorité : on ne passe à `01` que quand `04` est épuisé. Un tri
 * global par domaine donnerait le même ensemble mais pas le même ORDRE d'arrivée, et l'ordre
 * est justement ce que Marc a demandé.
 *
 * @param {Array<Array>} lignes    lignes d'Index (Clé, Traité le, Fichier, Domaine, Chemin, Statut)
 * @param {Function} fileIdDe      lit le fileId d'une LIGNE d'Index (injecté pour le test)
 * @param {Object} faits           { fileId: 1 } déjà traités sous le tag courant
 * @param {Array<string>} prefixes domaines de la tranche, dans l'ordre
 * @param {number} max             plafond de la sélection rendue
 * @return {{choisies: Array<Object>, restants: number, tranche: number}}
 */
function selectionnerRattrapage_(lignes, fileIdDe, faits, prefixes, max) {
  var parPrefixe = {};
  var i;
  for (i = 0; i < prefixes.length; i++) parPrefixe[prefixes[i]] = [];
  // ⚠️ `parDomaine` n'est pas un compteur de plus : c'est la réponse à « quel dossier » et
  // à « quelle direction ». L'ordre des préfixes EST la direction, et il est déjà celui de
  // la boucle de choix — donc la file affichée et le travail réel ne peuvent pas diverger.
  var res = { choisies: [], restants: 0, tranche: 0, parDomaine: {} };
  for (i = 0; i < prefixes.length; i++) res.parDomaine[prefixes[i]] = { tranche: 0, restants: 0 };
  if (!lignes || !lignes.length) return res;

  // ⚠️ C49-26 — UN DOCUMENT, PAS UNE LIGNE. L'Index est append-only : un même fichier y porte
  // souvent plusieurs lignes (`drive|…`, `migre|…`, `reanalyse|…`), et c'est justement le cas
  // des dossiers que la tranche « tout le reste » ouvre (06 a été re-analysé, m1 a migré les
  // autres). Compter et choisir des LIGNES faisait lire — et PAYER — le même papier deux fois
  // dans un même run, et gonflait les restants affichés. On garde la ligne la PLUS RÉCENTE : son
  // domaine est celui où le document vit aujourd'hui, et c'est lui qui décide du niveau.
  var qualifiees = [];
  var derniere = {};
  for (i = 0; i < lignes.length; i++) {
    var statut = String(lignes[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;

    var fileId = fileIdDe(lignes[i]);
    // Sans fileId — ni en clé, ni en colonne — le canal ne sait pas désigner ce document. Depuis
    // C49-16 c'est devenu RARE (la colonne est écrite à la pose, et la résolution rattrape
    // l'existant) : il reste les lignes que la résolution a REFUSÉES faute de preuve. Elles sont
    // HORS de ce rattrapage et ne comptent pas non plus dans les restants, sinon le compteur ne
    // tomberait jamais à zéro et la tranche ne se terminerait jamais.
    if (!fileId) continue;

    if (!estCandidatPiece_(String(lignes[i][2] || ''))) continue;

    var prefLigne = prefixeDomainePiece_(lignes[i][3]);
    if (!Object.prototype.hasOwnProperty.call(parPrefixe, prefLigne)) continue;

    qualifiees.push({ i: i, fileId: fileId, pref: prefLigne });
    derniere[fileId] = i;
  }

  for (var k = 0; k < qualifiees.length; k++) {
    var q = qualifiees[k];
    if (derniere[q.fileId] !== q.i) continue; // une ligne plus récente du même document existe
    var cle = String(lignes[q.i][0] || '');
    var nom = String(lignes[q.i][2] || '');
    var pref = q.pref;
    fileId = q.fileId;
    i = q.i;

    res.tranche++;
    res.parDomaine[pref].tranche++;
    if (faits && faits[fileId] === 1) continue;
    res.restants++;
    res.parDomaine[pref].restants++;
    parPrefixe[pref].push({
      cle: cle,
      nom: nom,
      domaine: String(lignes[i][3] || ''),
      chemin: String(lignes[i][4] || ''),
      statut: String(lignes[i][5] || ''),
      fileId: fileId
    });
  }

  for (i = 0; i < prefixes.length && res.choisies.length < max; i++) {
    var lot = parPrefixe[prefixes[i]];
    for (var j = 0; j < lot.length && res.choisies.length < max; j++) res.choisies.push(lot[j]);
  }
  return res;
}

/**
 * PURE. La liste des documents déjà faits, à partir des lignes de l'onglet `PiecesFaites`.
 *
 * ⚠️ Le TAG filtre : sans lui, bumper le tag pour tout refaire laisserait l'ancienne liste en
 * place et la campagne relancée ne traiterait rien — le « remède gaté par un tag rendu inerte »
 * payé le 17/09 sur l'audit, à l'identique. Les lignes des tags précédents restent DANS
 * l'onglet (il est append-only) : elles racontent ce qui a été fait, elles ne freinent rien.
 *
 * @param {Array<Array>} lignes  `[FileId, Tag, Le]`, sans l'en-tête
 * @param {string} tag
 * @return {!Object} `{fileId: 1}`
 */
function filtrerFaitsParTag_(lignes, tag) {
  var out = {};
  var t = String(tag || '');
  var src = lignes || [];
  for (var i = 0; i < src.length; i++) {
    var id = String(src[i] && src[i][0] != null ? src[i][0] : '').trim();
    if (id && String(src[i][1] == null ? '' : src[i][1]).trim() === t) out[id] = 1;
  }
  return out;
}

/**
 * L'idempotence, LUE DEPUIS LA SHEET. I/O.
 *
 * ⚠️⚠️ POURQUOI ELLE A QUITTÉ LA SCRIPT PROPERTY, le 21/09/2026. Elle y tenait sous la forme
 * `<tag>|<fileId>|<fileId>…`, et une Property plafonne autour de 9 Ko — soit ~200 documents.
 * La garde qui refusait une tranche plus grande a fait exactement son travail le jour où Marc
 * a demandé les 976 papiers de `02 · Finances` : elle a REFUSÉ de démarrer plutôt que de
 * découvrir le plafond en production, où une Property qui déborde lève À L'ÉCRITURE — la
 * campagne aurait alors re-traité les mêmes documents à chaque passe, en payant un appel LLM
 * à chaque fois, sans jamais avancer.
 *
 * Un onglet n'a pas ce plafond (l'Index en porte 26 550 lignes), et il est déjà le mécanisme
 * que ce dépôt emploie pour toute liste qui grandit.
 *
 * ⚠️ Rien n'est migré depuis l'ancienne Property, et c'est mesuré plutôt que négligé : elle
 * portait le tag `c49-5-a`, que le bump du 21/09 a rendu caduc. Sa lecture aurait rendu vide
 * de toute façon.
 */
function lireFaitsRattrapage_(tag) {
  try {
    var f = feuille_('PiecesFaites');
    var n = f.getLastRow();
    if (n < 2) return {};
    return filtrerFaitsParTag_(f.getRange(2, 1, n - 1, 2).getValues(), tag);
  } catch (e) {
    // ⚠️ ÉCHEC FERMÉ : une liste illisible rendue VIDE ferait re-traiter toute la tranche, en
    // payant un appel par document. On rend `null`, et l'appelant s'abstient.
    journalErreur_('RattrapagePiece', 'Liste des faits illisible (' + e + ') : la passe '
      + 's\'abstient plutôt que de re-payer une extraction par document.');
    return null;
  }
}

/** Ajoute les documents de ce run à l'onglet. I/O. */
function ajouterFaitsRattrapage_(tag, entrees, quand) {
  if (!entrees || !entrees.length) return;
  var lignes = [];
  for (var i = 0; i < entrees.length; i++) {
    var e = entrees[i] || {};
    lignes.push([String(e.id || ''), String(tag || ''), quand,
      String(e.nom || ''), String(e.motif || ''), String(e.domaine || '')]);
  }
  var f = feuille_('PiecesFaites');
  // ⚠️ RÉPARATION D'EN-TÊTE, posée ICI et pas dans `initialiserSheet_` : celle-là ne tourne
  // qu'à la création de la Sheet ou quand l'onglet est ABSENT. L'onglet existe déjà en prod
  // avec trois colonnes — le cas même où la réparation est nécessaire — donc l'y mettre
  // serait du code mort (leçon de la colonne `Erreur` d'`HistoriqueVrac`, §9).
  if (f.getLastColumn() < COLONNES_PIECES_FAITES.length) {
    f.getRange(1, 1, 1, COLONNES_PIECES_FAITES.length).setValues([COLONNES_PIECES_FAITES]);
  }
  // ⚠️ La largeur vient de la LIGNE, pas de la constante d'en-tête : celle-ci vit dans
  // `Journal.gs`, et un appelant qui ne le charge pas ferait lever `.length` — dans un
  // `try/catch` qui avale, donc la liste ne serait jamais écrite, EN SILENCE. Un test lie
  // quand même les deux largeurs, pour qu'un en-tête élargi ne décale pas les colonnes.
  f.getRange(f.getLastRow() + 1, 1, lignes.length, lignes[0].length).setValues(lignes);
}

/**
 * La GATE du tick : faut-il faire tourner l'étape ? PURE.
 *
 * ⚠️ Elle lit le TAG en PREMIER, et c'est la leçon du 17/09 : une gate d'extinction qui ne
 * regarde que le compteur rend INERTE tout remède gaté par le tag — l'étape ne tourne plus,
 * donc le tag n'est jamais lu, donc rien ne remet de travail, donc l'étape ne tournera
 * jamais. Interblocage parfait, et la Santé affiche l'état normal.
 *
 * ⚠️ `restants === null` veut dire « je ne sais pas », jamais « zéro » : au premier passage
 * la Property n'existe pas, et éteindre sur une ignorance serait éteindre pour toujours.
 */
function rattrapageDoitTourner_(restants, tagPersiste, tagCourant) {
  if (!String(tagCourant || '')) return false;            // tranche non armée : rien à faire
  if (String(tagPersiste || '') !== String(tagCourant || '')) return true;
  return restants !== 0;
}

/**
 * Le « pas de plafond » du chemin manuel. Une constante nommée plutôt qu'un `Infinity` en
 * ligne : la sélection le compare à une longueur, et un plafond qui ne peut pas être dépassé
 * par la tranche (elle-même bornée à `RATTRAPAGE_PIECE_MAX_FAITS`) est plus lisible qu'un
 * infini qu'on doit vérifier à chaque lecture. PURE.
 */
function choixSansPlafondRattrapage_() {
  return RATTRAPAGE_PIECE_MAX_FAITS + 1;
}

/** Ce qui reste à faire sous le tag courant, ou `null` si on ne sait pas encore. */
function restantsRattrapage_(props) {
  var brut = props.getProperty('DriveAI_RATTRAPAGE_PIECE_RESTANTS');
  if (brut === null || brut === '') return null;
  return Number(brut) || 0;
}

/**
 * Le SIGNAL, et un seul endroit l'écrit — donc aucune sortie ne peut l'oublier.
 *
 * ⚠️ C'est la leçon C28-135 appliquée d'avance : une étape qui sort sur son garde-temps sans
 * rien écrire rend « rien à envoyer », « jamais atteinte » et « suspendue » indiscernables,
 * et les trois appellent des gestes opposés. Chaque `return` de `etapeRattrapagePiece_` passe
 * par ici, avec son motif.
 *
 * `DriveAI_RATTRAPAGE_PIECE_FIN` = `<ISO>|<fin>|<faits>/<echecs>/<sansTexte>/<illisibles>|<restants>|<tick|manuel>`
 */
function ligneFinRattrapage_(maintenant, res, manuel) {
  return [
    maintenant.toISOString().slice(0, 16).replace('T', ' '),
    res.fin,
    res.faits + '/' + res.echecs + '/' + res.sansTexte + '/' + res.illisibles,
    // Un reste non mesuré s'écrit VIDE, jamais 'null' ni '0' : le lecteur doit pouvoir le
    // distinguer d'un vrai zéro, et c'est cette distinction qui a manqué le 17/09.
    (typeof res.restants === 'number' && isFinite(res.restants)) ? String(res.restants) : '',
    manuel ? 'manuel' : 'tick'
  ].join('|');
}

/**
 * Le CUMUL de la campagne, lu puis réécrit. PUR sur son entrée (une chaîne), pour qu'il se
 * teste sans Properties.
 *
 * ⚠️ POURQUOI IL EXISTE. Le signal de fin ne porte que la DERNIÈRE passe : après 110
 * documents, il annonçait « 0/0/0 — tranche terminée », c'est-à-dire exactement ce qu'il
 * annonce quand il n'y avait rien à faire. Marc a demandé un import « mesuré » le 19/09 ;
 * une campagne qui dit « terminée » sans dire ce qu'elle a PRODUIT n'est pas mesurée, et
 * c'est ce qui a rendu inexplicable l'écart de 32 entre 110 documents et 78 pièces.
 *
 * ⚠️ Le cumul est porté par sa PROPRE Property, jamais par un 6ᵉ champ du signal de fin : ce
 * signal est réécrit à chaque passe, y compris par les sorties précoces, et un cumul qu'une
 * sortie précoce peut remettre à zéro ne cumule rien (le bug du 17/09, d'un cran plus loin).
 *
 * @param {string} brut  `<faits>/<echecs>/<sansTexte>/<acceptees>/<illisibles>` ou vide
 * @return {{faits:number, echecs:number, sansTexte:number, acceptees:number, illisibles:number}}
 *
 * ⚠️ `illisibles` est en QUEUE, et son absence se lit ZÉRO : une Property écrite avant ce lot
 * porte quatre champs, et c'est la bonne valeur pour elle — le compteur n'existait pas.
 */
function decoderCumulRattrapage_(brut) {
  var p = String(brut || '').split('/');
  var n = function (i) { var v = Number(p[i]); return isFinite(v) && v >= 0 ? v : 0; };
  return { faits: n(0), echecs: n(1), sansTexte: n(2), acceptees: n(3), illisibles: n(4) };
}

/** @return {string} la forme persistée du cumul. PURE. */
function encoderCumulRattrapage_(c) {
  return [c.faits, c.echecs, c.sansTexte, c.acceptees, c.illisibles].join('/');
}

/** Le cumul APRÈS cette passe. PURE — l'addition est ici, l'I/O chez l'appelant. */
function cumulerRattrapage_(cumul, res) {
  return {
    faits: cumul.faits + (Number(res.faits) || 0),
    echecs: cumul.echecs + (Number(res.echecs) || 0),
    sansTexte: cumul.sansTexte + (Number(res.sansTexte) || 0),
    illisibles: cumul.illisibles + (Number(res.illisibles) || 0),
    acceptees: cumul.acceptees + (Number(res.acceptees) || 0)
  };
}

/** Le cumul persisté sous le tag COURANT, remis à zéro si le tag a changé. */
function lireCumulRattrapage_(props, tagCourant) {
  var brut;
  try { brut = props.getProperty('DriveAI_RATTRAPAGE_PIECE_CUMUL'); } catch (e) { brut = null; }
  var p = String(brut || '').split('|');
  // ⚠️ Le cumul porte SON tag, comme la liste d'idempotence : un cumul écrit sous une
  // campagne précédente additionnerait deux populations et personne ne le verrait.
  if (p.length < 2 || p[0] !== String(tagCourant || '')) return decoderCumulRattrapage_('');
  return decoderCumulRattrapage_(p[1]);
}

function noterFinRattrapage_(props, res, manuel) {
  try {
    props.setProperty('DriveAI_RATTRAPAGE_PIECE_FIN', ligneFinRattrapage_(new Date(), res, manuel));
    var tag = String(CONFIG.RATTRAPAGE_PIECE_TAG || '');
    var cumul = cumulerRattrapage_(lireCumulRattrapage_(props, tag), res);
    props.setProperty('DriveAI_RATTRAPAGE_PIECE_CUMUL', tag + '|' + encoderCumulRattrapage_(cumul));
    // ⚠️ LE COMPTEUR N'EST ÉCRIT QUE S'IL A ÉTÉ MESURÉ. C'est lui que la gate du tick relit :
    // une sortie précoce qui y poserait `0` faute de savoir refermerait la campagne à vie. Le
    // motif de fin, lui, s'écrit TOUJOURS — c'est la moitié qui dit pourquoi on s'est arrêté.
    if (typeof res.restants === 'number' && isFinite(res.restants)) {
      props.setProperty('DriveAI_RATTRAPAGE_PIECE_RESTANTS', String(res.restants));
    }
  } catch (e) { /* observabilité best-effort : jamais au prix de l'étape */ }
  return res;
}

/**
 * Ce que chaque sortie de la passe VEUT DIRE, en français.
 *
 * ⚠️ POURQUOI CETTE TABLE EXISTE. Le 21/09/2026, la campagne a extrait UN document, s'est
 * fait refuser par la Mémoire, et la ligne de Santé a affiché « suspendu ». Marc : « ça ne
 * m'explique toujours pas l'avancement ». Un motif brut est un identifiant de code : il dit
 * QUE ça s'est arrêté, jamais ce qu'il faut faire — et quinze motifs partagent la même case.
 *
 * ⚠️ Un motif INCONNU se CITE (« sortie « x » »), jamais ne tombe dans le cas le plus
 * fréquent : un écran qui range une nouveauté dans une catégorie existante fait croire qu'on
 * a diagnostiqué ce qu'on n'a pas lu. `test/rattrapage-piece.test.js` dérive la liste des
 * motifs DU CODE et exige une phrase pour chacun.
 */
var PHRASES_FIN_RATTRAPAGE_ = {
  'termine': 'passe terminée',
  'tranche-terminee': '✅ plus rien à lire dans cette tranche',
  'budget': 'plafond de CETTE exécution atteint — reprend au tick suivant (~5 min)',
  'budget-jour': 'budget du JOUR épuisé — reprise demain',
  'frein-budget': 'en pause — frein budget campagnes atteint',
  'non-armee': 'tranche non armée (CONFIG.RATTRAPAGE_PIECE_TAG vide)',
  'jeton-absent': '⚠️ aucun jeton pour la Mémoire (`DriveAI_MEMORYAI_TOKEN`) — geste de Marc requis',
  'suspendu': '⚠️ ARRÊTÉE : la Mémoire a refusé la dernière pièce. Re-sonde automatique',
  'panne-plateforme': '⚠️ panne de plateforme LLM — aucun appel tenté',
  'audit-en-cours': 'en attente : l\'audit des 100 documents tourne encore',
  'index-vide': '⚠️ l\'Index n\'a rien rendu — lecture de la feuille impossible',
  'faits-illisibles': '⚠️ la liste des documents déjà lus est illisible — la passe s\'abstient plutôt que de tout re-payer',
  'tranche-trop-grande': '⚠️ tranche plus grande que ce que l\'idempotence supporte — refus AVANT de dépenser',
  'drive-illisible': '⚠️ trois lectures Drive ratées d\'affilée — coupe-circuit, rien n\'est marqué fait'
};

/**
 * PURE. Traduit un motif de fin, y compris les pannes de canal (`canal-<motif>`), dont le
 * détail vit dans le vocabulaire de la Mémoire (`PHRASES_FIN_PIECE_`).
 */
/**
 * PURE. Ce qu'on sait de la rupture, composé à partir des DEUX traces que le moteur garde.
 *
 * ⚠️ Elles ne disent pas la même chose et aucune ne remplace l'autre : la RAISON de la
 * suspension dit ce qui a coupé le canal (jeton refusé, périmètre retiré, réseau), le dernier
 * REFUS dit ce que la Mémoire a répondu sur la dernière pièce (champ hors contrat, valeur
 * refusée). N'en afficher qu'une envoie chercher au mauvais endroit une fois sur deux.
 */
function diagnosticCanal_(raisonSuspension, refusPiece) {
  var bouts = [];
  var r = String(raisonSuspension || '').trim();
  var f = String(refusPiece || '').trim();
  if (r) bouts.push('canal coupé : ' + r);
  if (f && f !== r) bouts.push('dernier refus de pièce : ' + f);
  return bouts.join(' · ');
}

/** PURE. Cette sortie est-elle une rupture du canal vers la Mémoire ? */
function estFinDeCanal_(motif) {
  var m = String(motif || '');
  return m === 'suspendu' || m === 'jeton-absent' || m.indexOf('canal-') === 0;
}

function phraseMotifRattrapage_(motif) {
  var m = String(motif || '');
  if (!m) return 'sortie inconnue';
  if (PHRASES_FIN_RATTRAPAGE_[m]) return PHRASES_FIN_RATTRAPAGE_[m];
  if (m.indexOf('canal-') === 0) {
    var sous = m.slice('canal-'.length);
    return '⚠️ le canal vers la Mémoire a rompu : '
      + (PHRASES_FIN_PIECE_[sous] || ('« ' + sous + ' »'));
  }
  return 'sortie « ' + m + ' »';
}

/**
 * La phrase lue par `majSante_` — sans rien exécuter, ce que le piège 3 (§9) exige. PURE.
 */
function phraseFinRattrapage_(brut, tagCourant, dernierRefus) {
  if (!String(tagCourant || '')) {
    return 'tranche non armée — poser CONFIG.RATTRAPAGE_PIECE_TAG pour lancer la lecture';
  }
  if (!brut) return 'armée (« ' + tagCourant + ' »), jamais passée';
  var p = String(brut).split('|');
  // ⚠️ `Number('')` vaut 0 et `Number('null')` vaut NaN : une sortie qui n'a rien compté ne doit
  // pas se lire « 0 restants », donc « terminée ». On ne fait confiance qu'à un vrai nombre.
  var restants = (p[3] === '' || p[3] === undefined || p[3] === 'null') ? NaN : Number(p[3]);
  var phrase = (isFinite(restants) ? restants + ' restants' : 'reste inconnu')
    // ⚠️ DÉRIVÉ, jamais écrit : la phrase a dit « 04 + 01 » jusqu'au 21/09, et `02` y est entré
    // le jour même. Un lot qui change ce qu'un écran MONTRE périme ce qu'il AFFIRME, et une
    // phrase fausse ne fait rougir aucun test — elle envoie juste chercher au mauvais endroit.
    + ' dans la tranche ' + prefixesRattrapage_().join(' + ')
    // ⚠️ C49-15 — QUATRE noms pour QUATRE chiffres. Le compteur écrit `faits/echecs/sansTexte/
    // illisibles` (voir plus haut) et ce libellé n'en nommait que trois : le quatrième — les
    // documents dont la PHOTO est à refaire — se lisait comme un chiffre de trop. Mesuré en
    // production le 21/09 : « dernière passe : 3/0/1/1 (faits/échecs/sans texte) ». Le compteur
    // était juste ; c'est le libellé qui était resté derrière quand `illisibles` est entré.
    + ' · dernière passe : ' + (p[2] || '?') + ' (faits/échecs/sans texte/illisibles) — '
    // ⚠️ Le motif se TRADUIT, et une panne de canal NOMME son refus. Jusqu'au 21/09, le seul
    // endroit qui affichait `DriveAI_PIECE_DERNIER_REFUS` était la ligne « Mémoire (pièces) »,
    // court-circuitée par `if (!CONFIG.PIECE_PUSH) return 'désactivée (CONFIG)'` — or ce flag ne
    // gouverne PAS le rattrapage, qui a son propre chemin. La campagne s'est donc arrêtée sur
    // un refus que personne ne pouvait lire.
    + phraseMotifRattrapage_(p[1])
    + (String(dernierRefus || '') && estFinDeCanal_(p[1])
        ? ' · ' + String(dernierRefus) : '')
    + ' · ' + (p[0] || '?')
    // ⚠️ Qui l'a lancée : une passe MANUELLE prouve que le code est bon, jamais que le
    // déclencheur l'exécute. Sans ce mot, on lit « ça marche » sur la preuve d'un geste humain.
    + ' · ' + (p[4] === 'manuel' ? 'lancée à la main' : 'par le tick');
  if (isFinite(restants) && restants === 0) {
    phrase += ' · ✅ tranche terminée — à toi de juger avant d\'élargir';
  }
  return phrase;
}

/**
 * La phrase du CUMUL, ou une chaîne vide s'il n'y a rien à dire. PURE.
 *
 * ⚠️ « rien produit » et « rien à produire » ne se disent pas pareil : un cumul entièrement à
 * zéro se TAIT (la campagne n'a pas encore tourné), mais dès qu'un seul document est passé,
 * les nombres s'affichent — y compris les zéros, qui sont alors des mesures.
 *
 * ⚠️ CHAQUE compteur est normalisé à zéro À L'ENTRÉE. Un `undefined` dans une addition rend
 * `NaN`, `NaN` est falsy, et la phrase se TAIRAIT — donc un compteur ajouté plus tard ferait
 * disparaître toute l'observabilité au lieu de manquer une colonne. Mesuré sur `illisibles`.
 */
function phraseCumulRattrapage_(cumul) {
  var c = cumul || {};
  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var faits = n(c.faits), echecs = n(c.echecs), sansTexte = n(c.sansTexte);
  var illisibles = n(c.illisibles), acceptees = n(c.acceptees);
  var total = faits + echecs + sansTexte + illisibles;
  if (!total) return '';
  return 'depuis le début : ' + faits + ' extraits ('
    + acceptees + ' acceptés par la Mémoire), '
    + sansTexte + ' sans texte, ' + illisibles + ' illisibles (photo à refaire), '
    + echecs + ' en échec';
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * C49-14 — CE QUE LA CAMPAGNE EST EN TRAIN DE FAIRE.
 *
 * ⚠️ POURQUOI CE BLOC EXISTE. Marc, le 21/09 : « je sais pas ça traite quoi en ce moment,
 * quel dossier, quel fichier, quelle direction, quelles infos il lui manque ». Aucune de ces
 * quatre questions n'avait de réponse quelque part — pas « mal affichée » : ABSENTE. Le
 * moteur n'écrivait un document qu'APRÈS l'avoir lu, et jamais son dossier.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * La file, encodée pour être relue : `04:12/23·01:40/87·02:900/976`. PURE.
 *
 * ⚠️ Un domaine à ZÉRO RESTANT reste dans la chaîne, et c'est le point : « 04:0/23 » dit que
 * l'immigration est FINIE, ce qu'une absence ne dirait pas — elle se lirait « pas encore
 * commencé », l'exact contraire.
 */
function encoderFilePiece_(parDomaine, prefixes) {
  var out = [];
  for (var i = 0; i < (prefixes || []).length; i++) {
    var p = prefixes[i];
    var d = (parDomaine || {})[p];
    if (!d) continue;
    // ⚠️ C49-26 — un dossier SANS rien à lire ne s'écrit pas : `07` et `09` sont des domaines
    // auto, parfois vides, et « 07 ✅ (0) » s'affichait AVANT le dossier en cours — la direction
    // lue devenait « 04 · 01 · 02 · 07 · 09 · 05 ». Rien à lire n'est pas « terminé ».
    if (Number(d.tranche || 0) === 0) continue;
    out.push(p + ':' + Number(d.restants || 0) + '/' + Number(d.tranche || 0));
  }
  return out.join('·');
}

/**
 * La file en une phrase, pour la Santé. PURE.
 *
 * ⚠️ Elle nomme le domaine EN COURS — le premier qui a encore du reste — parce que c'est
 * littéralement « quelle direction ». Les suivants sont annoncés dans l'ordre, ce qui dit ce
 * qui vient après sans qu'on ait à le deviner.
 */
function phraseFilePiece_(encode) {
  var brut = String(encode == null ? '' : encode).trim();
  if (!brut) return 'pas encore mesurée';
  var parts = brut.split('·');
  var faites = [], reste = [];
  for (var i = 0; i < parts.length; i++) {
    var m = /^(\S+?):(\d+)\/(\d+)$/.exec(parts[i]);
    if (!m) continue;
    var r = Number(m[2]), t = Number(m[3]);
    if (r === 0) faites.push(m[1] + ' ✅ (' + t + ')');
    else reste.push({ pref: m[1], reste: r, tranche: t });
  }
  if (!faites.length && !reste.length) return 'illisible';
  if (!reste.length) return faites.join(' · ') + ' — tranche terminée';
  var tete = reste[0];
  var phrase = 'EN COURS ' + tete.pref + ' : ' + (tete.tranche - tete.reste) + '/' + tete.tranche
    + ' lus, ' + tete.reste + ' à lire';
  if (faites.length) phrase = faites.join(' · ') + ' · ' + phrase;
  if (reste.length > 1) {
    var suite = [];
    for (var k = 1; k < reste.length; k++) suite.push(reste[k].pref + ' (' + reste[k].reste + ')');
    phrase += ' · ensuite ' + suite.join(', ');
  }
  return phrase;
}

/** L'encodage du document en cours. PURE. */
function encoderEnCoursPiece_(doc, quandMs) {
  var d = doc || {};
  var propre = function (v) { return String(v == null ? '' : v).replace(/[|\r\n]+/g, ' ').trim(); };
  return String(quandMs || 0) + '|' + propre(d.fileId) + '|' + propre(d.nom) + '|' + propre(d.domaine);
}

/**
 * Le document en cours, en une phrase — ou RIEN. PURE.
 *
 * ⚠️⚠️ LA PÉREMPTION N'EST PAS UN DÉTAIL. Le tick d'Apps Script peut mourir sur son mur de
 * six minutes ; la Property reste alors écrite, et sans borne l'écran afficherait « en train
 * de lire X » pendant des heures. Ce dépôt a déjà payé exactement ça — un état qui ne se
 * réécrit jamais devient une vérité permanente (`HistoriqueVrac`, 0 affiché à vie). Au-delà
 * de la borne, on ne dit RIEN plutôt qu'une chose fausse : l'appelant affichera le dernier
 * document lu, qui est vrai.
 */
function phraseEnCoursPiece_(brut, maintenantMs, perimeMs) {
  var s = String(brut == null ? '' : brut);
  if (!s) return '';
  var p = s.split('|');
  var t = parseInt(p[0], 10);
  if (!isFinite(t) || !t) return '';
  if ((Number(maintenantMs || 0) - t) > Number(perimeMs || 0)) return '';
  var nom = String(p[2] || '').trim();
  var dom = String(p[3] || '').trim();
  if (!nom) return '';
  return nom + (dom ? ' (' + dom + ')' : '');
}

function texteSanteFilePiece_() {
  try {
    return phraseFilePiece_(PropertiesService.getScriptProperties().getProperty('DriveAI_PIECE_FILE'));
  } catch (e) { return 'état illisible'; }
}

function texteSanteEnCoursPiece_() {
  var brut;
  try {
    brut = PropertiesService.getScriptProperties().getProperty('DriveAI_PIECE_EN_COURS');
  } catch (e) { return 'état illisible'; }
  var phrase = phraseEnCoursPiece_(brut, Date.now(), CONFIG.PIECE_EN_COURS_PERIME_MS);
  // ⚠️ « rien en ce moment » n'est PAS une panne, et le dire évite la lecture inverse : la
  // campagne travaille par rafales de quelques secondes toutes les cinq minutes, donc elle est
  // au repos l'essentiel du temps. Un vide non expliqué se lirait « c'est arrêté ».
  return phrase || 'rien en ce moment (la campagne lit par rafales, à chaque tick)';
}

function texteSanteRattrapagePiece_() {
  var brut, cumul;
  try {
    var props = PropertiesService.getScriptProperties();
    brut = props.getProperty('DriveAI_RATTRAPAGE_PIECE_FIN');
    cumul = lireCumulRattrapage_(props, CONFIG.RATTRAPAGE_PIECE_TAG);
  } catch (e) { return 'état illisible'; }
  var refus = '', raison = '';
  try {
    var pr = PropertiesService.getScriptProperties();
    refus = pr.getProperty('DriveAI_PIECE_DERNIER_REFUS') || '';
    raison = pr.getProperty('DriveAI_MEMOIRE_SUSPENDU_RAISON') || '';
  } catch (e) { refus = ''; raison = ''; }
  var phrase = phraseFinRattrapage_(brut, CONFIG.RATTRAPAGE_PIECE_TAG, diagnosticCanal_(raison, refus));
  var cum = phraseCumulRattrapage_(cumul);
  return cum ? (phrase + ' · ' + cum) : phrase;
}

/**
 * L'étape. Lit l'Index, choisit, extrait, envoie, et DIT pourquoi elle s'arrête.
 *
 * @param {Function} garde  le garde-temps du tick
 * @param {Object=} opts    `{manuel: true}` depuis l'éditeur : hors budget QUOTIDIEN
 */
function etapeRattrapagePiece_(garde, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  // ⚠️ `restants: null` = « je ne sais pas », JAMAIS zéro. Ce champ est écrit dans la Property
  // que la GATE du tick relit : un zéro posé par une sortie qui n'a rien compté referme la
  // campagne POUR TOUJOURS, et la Santé annonce « ✅ tranche terminée ». Vécu en production le
  // 17/09 à 18:35, avec 85 papiers restants — la gate d'extinction du 17/09 au matin, reprise
  // par l'autre bout : ce n'était pas la gate qui était fausse, c'était le COMPTEUR qu'une
  // branche de sortie précoce avait écrasé avec une ignorance.
  var res = { faits: 0, echecs: 0, sansTexte: 0, illisibles: 0, envoyees: 0, acceptees: 0,
              restants: null, fin: 'desactive', dernierMotif: '' };

  var tag = String(CONFIG.RATTRAPAGE_PIECE_TAG || '');
  if (!tag && !opts.manuel) { res.fin = 'non-armee'; return noterFinRattrapage_(props, res, false); }

  var jeton = props.getProperty('DriveAI_MEMORYAI_TOKEN');
  // « Armé sans jeton » et « éteint » ne sont pas la même situation, et le premier demande un
  // geste de Marc. On le dit plutôt que de rendre un zéro qui ressemble à du calme.
  if (!jeton) { res.fin = 'jeton-absent'; return noterFinRattrapage_(props, res, !!opts.manuel); }
  if (memoireSuspendue_(props)) { res.fin = 'suspendu'; return noterFinRattrapage_(props, res, !!opts.manuel); }
  if (estPannePlateforme_()) { res.fin = 'panne-plateforme'; return noterFinRattrapage_(props, res, !!opts.manuel); }
  // Le frein en DOLLARS est l'unité du quota protégé : le rattrapage s'y soumet comme une
  // campagne, parce que c'en est une.
  if (budgetCampagnesAtteint_()) { res.fin = 'frein-budget'; return noterFinRattrapage_(props, res, !!opts.manuel); }

  // ⚠️ LA PORTE DE L'ADR-0061, et elle est ici plutôt que dans un commentaire : tant que
  // l'audit a des documents à extraire, rien ne part. Marc a choisi le 17/09 « après le
  // jugement de l'audit ». Le chemin MANUEL, lui, est son geste à lui — il passe outre, et la
  // Santé dira que c'était une passe manuelle.
  if (!opts.manuel && resteAuditPiece_(props) !== 0) {
    res.fin = 'audit-en-cours';
    // Ce qu'on SAIT, ou rien — `restantsRattrapage_` rend déjà `null` quand elle l'ignore.
    res.restants = restantsRattrapage_(props);
    return noterFinRattrapage_(props, res, false);
  }

  // Le budget des PIÈCES est PARTAGÉ avec l'audit : même constante, même Property, et les deux
  // étapes sont mutuellement exclusives (celle-ci ne démarre que quand l'audit est vide). Rien
  // n'est donc ajouté à l'enveloppe de 63 min/j, et il n'y a aucun transfert à verrouiller.
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = opts.manuel ? 0 : budgetJourAudit_(props, aujourdhui);
  if (consommeJour >= CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS) {
    res.fin = 'budget-jour';
    res.restants = restantsRattrapage_(props);
    return noterFinRattrapage_(props, res, false);
  }

  var lignes = lireLignesIndexPerimetre_();
  if (!lignes) { res.fin = 'index-vide'; return noterFinRattrapage_(props, res, !!opts.manuel); }

  var tagFaits = tag || 'manuel';
  var faits = lireFaitsRattrapage_(tagFaits);
  if (faits === null) { res.fin = 'faits-illisibles'; return noterFinRattrapage_(props, res, !!opts.manuel); }
  var maxParRun = opts.manuel ? choixSansPlafondRattrapage_() : RATTRAPAGE_PIECE_MAX_PAR_RUN;
  var choix = selectionnerRattrapage_(
    lignes, fileIdDeLigneIndex_, faits, prefixesRattrapage_(), maxParRun);
  res.restants = choix.restants;
  // ⚠️ La file s'écrit AVANT la sortie « tranche terminée » : c'est justement quand il ne
  // reste rien qu'on veut lire « 04 ✅ · 01 ✅ · 02 ✅ », et non une file vide qui se lirait
  // « pas encore mesurée ». Une garde qui n'écrit que dans le cas actif ne dit rien du cas fini.
  try {
    props.setProperty('DriveAI_PIECE_FILE',
      encoderFilePiece_(choix.parDomaine, prefixesRattrapage_()));
  } catch (e) { /* la file est un confort d'affichage : elle ne bloque jamais la lecture */ }

  if (!choix.choisies.length) {
    res.fin = 'tranche-terminee';
    return noterFinRattrapage_(props, res, !!opts.manuel);
  }

  var debutRun = Date.now();
  var aEcrire = [];
  var plafondRun = opts.manuel
    ? CONFIG.BUDGET_MS
    : Math.min(CONFIG.AUDIT_PIECE_BUDGET_MS, CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS - consommeJour);
  var gardeRun = function () {
    return (garde && garde()) || (Date.now() - debutRun) > plafondRun;
  };

  // ⚠️ COUPE-CIRCUIT. Une lecture Drive impossible est traitée comme un verdict du document
  // (droits manquants, fichier disparu) — c'est le cas courant, et l'audit fait pareil. Mais
  // la MÊME erreur porte une cause d'une autre ÉCHELLE : un scope perdu ou un throttle les
  // fait toutes échouer, et marquer « fait » viderait la tranche entière sans rien envoyer.
  // La question de la §9 — « si cette cause est vraie, combien de lignes échouent ? » — ne se
  // tranche pas sur UNE ligne : elle se tranche sur la SÉRIE.
  // ⚠️ Et les marques posées AVANT que la série ne se révèle se retirent : sans ça, les deux
  // premiers documents d'une panne Drive globale seraient perdus pour toujours — le coupe-
  // circuit protégerait le troisième et pas eux.
  var lecturesRatees = 0;
  var introuvables = 0;
  var marquesFragiles = [];
  res.fin = 'termine';
  for (var i = 0; i < choix.choisies.length; i++) {
    if (gardeRun()) { res.fin = 'budget'; break; }
    var doc = choix.choisies[i];
    // ⚠️ Filet de la sélection dédoublonnée : un document déjà lu CE run (ou sous ce tag) ne se
    // relit pas, quelle que soit la ligne d'Index qui l'a amené ici.
    if (faits[doc.fileId] === 1) continue;
    // ⚠️ AVANT l'appel, jamais après : un état écrit après coup répond à « qu'est-ce qui a
    // été lu », pas à « qu'est-ce qui est en train d'être lu ». C'est toute la question.
    try { props.setProperty('DriveAI_PIECE_EN_COURS', encoderEnCoursPiece_(doc, Date.now())); }
    catch (e) { /* jamais bloquant */ }
    var motif = rattraperUnDocument_(doc, !!opts.manuel);
    res.dernierMotif = motif;
    var issue = issueRattrapage_(motif);

    // ⚠️ UNE PANNE DE CANAL NE SE MARQUE PAS, et elle arrête la boucle. Marquer « fait » sur
    // un jeton refusé ou un frein budget perdrait le document À VIE : il ne reviendrait ni par
    // le rattrapage, ni par le flux (qui ne le verra jamais, il est déjà classé). Et continuer
    // la boucle brûlerait une extraction par document pour le même refus.
    if (issue === 'panne') { res.fin = 'canal-' + motif; break; }

    if (motif === 'lecture-impossible' || motif === 'introuvable') {
      lecturesRatees++;
      if (motif === 'introuvable') introuvables++;
      marquesFragiles.push(doc.fileId);
      // ⚠️ C49-26 — TROIS FICHIERS DISPARUS NE SONT PAS UNE PANNE. Sans cette sonde, trois
      // documents supprimés qui se suivent dans l'Index refermaient le coupe-circuit, les
      // marques étaient retirées, et le tick suivant les reprenait dans le MÊME ordre : la
      // campagne s'arrêtait là pour toujours. Quand la série n'est faite QUE de fichiers
      // introuvables et que Drive répond (le dossier racine se lit), ce sont trois verdicts :
      // leurs marques restent, la série repart de zéro. Un throttle ou un refus, eux, gardent
      // le comportement d'avant — c'est la cause d'échelle « tout le lot ».
      if (lecturesRatees >= 3 && introuvables === lecturesRatees && driveRepondRattrapage_()) {
        lecturesRatees = 0;
        introuvables = 0;
        marquesFragiles = [];
      } else if (lecturesRatees >= 3) {
        res.fin = 'drive-illisible';
        for (var f = 0; f < marquesFragiles.length; f++) {
          if (faits[marquesFragiles[f]] === 1) { delete faits[marquesFragiles[f]]; res.restants++; res.echecs--; }
          // ⚠️ ET de la liste à ÉCRIRE : depuis que l'idempotence vit dans un onglet, retirer la
          // marque en mémoire ne suffit plus — sans cette ligne, le document serait quand même
          // inscrit « fait » et jamais repris, ce que ce coupe-circuit existe pour empêcher.
          var pos = -1;
          for (var q = 0; q < aEcrire.length; q++) {
            if (aEcrire[q].id === marquesFragiles[f]) { pos = q; break; }
          }
          if (pos !== -1) aEcrire.splice(pos, 1);
        }
        break;
      }
    } else {
      // Le canal répond : un refus définitif est une réponse, donc la série est rompue et ce
      // qu'elle avait mis en doute est confirmé.
      lecturesRatees = 0;
      introuvables = 0;
      marquesFragiles = [];
    }

    if (issue === 'sans-texte') res.sansTexte++;
    else if (issue === 'illisible') res.illisibles++;
    else if (issue === 'echec') res.echecs++;
    else { res.faits++; res.envoyees++; if (motif === 'ok') res.acceptees++; }

    // ⚠️ La marque se pose sur toute issue DÉFINITIVE, « sans texte » et « échec » compris :
    // sans ça, une photo illisible serait re-téléchargée et re-extraite à chaque passe, à vie,
    // et la tranche ne se terminerait jamais.
    faits[doc.fileId] = 1;
    // ⚠️ Le NOM et le MOTIF partent avec l'identifiant : un `fileId` est opaque, donc une
    // liste qui n'en porte que lui ne répond à aucune question qu'un humain se pose.
    // ⚠️ Le DOMAINE part avec le reste : un nom de fichier seul ne dit pas d'où il vient,
    // et « quel dossier » est la question que Marc a posée deux fois.
    aEcrire.push({ id: doc.fileId, nom: doc.nom, motif: motif, domaine: doc.domaine });
    res.restants--;
  }

  // ⚠️ L'en-cours s'efface DÈS la sortie de boucle, quelle qu'en soit la raison (budget,
  // panne de canal, coupe-circuit Drive) : le laisser ferait afficher un document en cours
  // sur une campagne arrêtée. La péremption côté lecture est le filet, pas la règle.
  try { props.deleteProperty('DriveAI_PIECE_EN_COURS'); } catch (e) { /* jamais bloquant */ }

  try {
    ajouterFaitsRattrapage_(tagFaits, aEcrire,
      new Date().toISOString().slice(0, 16).replace('T', ' '));
  } catch (e) {
    journalErreur_('RattrapagePiece', 'Liste des faits non persistée (' + e + ') : les documents '
      + 'de ce run repartiront au prochain passage, et ils coûteront une seconde extraction.');
  }
  // Le budget consommé se pose ICI, jamais avant : une passe qui n'a rien pu faire ne doit pas
  // manger la journée.
  if (!opts.manuel) {
    props.setProperty('DriveAI_AUDIT_PIECE_JOUR_MS',
      aujourdhui + '|' + (consommeJour + (Date.now() - debutRun)));
  }
  return noterFinRattrapage_(props, res, !!opts.manuel);
}

/**
 * Range le motif rendu par le canal en une ISSUE. PURE.
 *
 * ⚠️ La question qui la gouverne est celle de la §9 : « si cette cause est vraie, combien de
 * lignes échouent ? » — une seule (ce document n'a pas de texte, le modèle n'a rien tiré) ⇒
 * c'est un VERDICT propre au document, il se marque « fait » ; toutes (jeton, suspension,
 * frein, panne, plafond, réseau) ⇒ c'est une PANNE, elle ne se marque pas et elle rend la
 * main. Les confondre coûte, dans un sens, un document perdu pour toujours — il ne reviendra
 * ni par ce rattrapage, ni par le flux, qui ne le verra jamais puisqu'il est déjà classé — et
 * dans l'autre, une extraction payée à chaque passe pour le même refus.
 *
 * ⚠️ LA LISTE ÉNUMÈRE LES VERDICTS, PAS LES PANNES, et le sens n'est pas indifférent : une
 * liste d'exceptions se périme au premier motif ajouté ailleurs, et le dépôt a déjà payé ça
 * (« une garde par LISTE d'exceptions se périme ; préférer une garde par CAPACITÉ »). Dans ce
 * sens-ci, un motif inconnu tombe du côté PANNE — on garde le document à faire, ce qui coûte
 * un re-examen. Dans l'autre, il aurait été marqué fait et perdu.
 *
 * `desactive` n'est donc pas listé, et c'est voulu : il veut dire que le canal a été appelé
 * sans le drapeau de rattrapage, donc que le câblage est cassé — le marquer « fait » viderait
 * la tranche sans avoir rien envoyé, en silence.
 */
var VERDICTS_DOCUMENT_RATTRAPAGE_ = {
  'ok': 'fait',
  'refusee': 'fait',           // la Mémoire a répondu et refuse CE contenu : le renvoyer tel
                               // quel donnerait le même refus, au prix d'une extraction.
  'sans-texte': 'sans-texte',
  'non-classe': 'echec',       // ne devrait pas arriver : la sélection ne prend que des classés.
  'extraction-vide': 'echec',  // le modèle n'a rien tiré de ce document-ci.
  'illisible': 'illisible',    // le modèle DIT qu'il n'a pas pu lire : ni une panne, ni un
                               // document pauvre — une photo à refaire. Issue DÉFINITIVE (la
                               // marque se pose), comptée à part : la noyer dans `echecs`
                               // ferait chercher une panne de canal là où il n'y en a pas.
  'piece-vide': 'echec',
  'lecture-impossible': 'echec', // droits manquants, throttle — voir le coupe-circuit
  'introuvable': 'echec',        // fichier supprimé depuis son classement — idem, et il a une
                                 // sonde à lui dans le coupe-circuit (C49-26).
                                 // de la boucle : en SÉRIE, la cause n'est plus le document.
  'ocr-echec': 'echec'
};
function issueRattrapage_(motif) {
  var m = String(motif || '');
  if (!m) return 'panne';
  return VERDICTS_DOCUMENT_RATTRAPAGE_[m] || 'panne';
}

/**
 * La sonde du coupe-circuit (C49-26) : Drive répond-il ? Une lecture de MÉTADONNÉE du dossier
 * racine — aucun contenu, aucun document de Marc. Une exception veut dire que c'est le CANAL
 * qui tombe, pas les trois fichiers.
 */
function driveRepondRattrapage_() {
  try { return !!DriveApp.getRootFolder().getId(); } catch (e) { return false; }
}

/**
 * Un document : le lire, l'extraire, l'envoyer. Rend l'issue, jamais une exception.
 *
 * ⚠️ Il passe par `pousserPieceApresClassement_` — la MÊME fonction que le flux vivant, avec
 * les mêmes gardes (`verdictPiece_`) et la même mise en forme (`pieceMemoire_`). Une seconde
 * implémentation ici serait « une règle et demie » : un papier rattrapé arriverait à la
 * Mémoire autrement qu'un papier classé aujourd'hui, et rien ne le dirait.
 */
function rattraperUnDocument_(doc, manuel) {
  var blob;
  try {
    var fichier = DriveApp.getFileById(doc.fileId);
    if (fichier.getSize() > CONFIG.OCR_TAILLE_MAX) return 'sans-texte';
    blob = fichier.getBlob();
  } catch (e) {
    journalErreur_('RattrapagePiece', 'Lecture impossible : ' + e);
    // ⚠️ C49-26 — « ce fichier n'existe plus » se dit À PART : c'est la forme que prend un
    // document supprimé après son classement (l'Index ne se réécrit jamais), et elle ne doit
    // pas se confondre avec un throttle ou un refus, qui touchent tout le lot. Le coupe-circuit
    // de la boucle s'en sert pour ne pas se refermer, à chaque tick, sur les trois mêmes
    // fichiers disparus en tête de tranche.
    return /No item with the given ID/i.test(String(e)) ? 'introuvable' : 'lecture-impossible';
  }

  var texte = extraireTexte_(blob);
  if (texte === null) return 'ocr-echec';
  if (!String(texte).trim()) return 'sans-texte';

  // ⚠️ C49-16 — LE `fileId` VOYAGE, ET SANS LUI TOUT LE LOT EST INERTE ICI. `pieceMemoire_`
  // lit `fileIdDeLigneIndex_(ligne)` : sans ce champ, il retombe sur la CLÉ, qui n'en porte
  // aucun pour une pièce jointe Gmail — donc il rend `null`, le verdict devient « piece-vide »,
  // et le document est marqué « fait » DÉFINITIVEMENT sous le tag courant… après avoir payé
  // l'extraction Haiku. Une boucle inerte qui facture, et qui aurait frappé `04` en premier.
  // Trouvé en revue adversariale, prouvé par sonde : clé Gmail sans fileId ⇒ `pieceMemoire_`
  // rend `null` ; avec fileId ⇒ une pièce.
  var envoi = pousserPieceApresClassement_(
    { cle: doc.cle },
    { nom: doc.nom, domaine: doc.domaine, statut: doc.statut, chemin: doc.chemin,
      fileId: doc.fileId },
    texte,
    { rattrapage: true, manuel: !!manuel }
  );
  return envoi && envoi.motif ? envoi.motif : 'echec';
}

/**
 * ⚠️ LE CHEMIN MANUEL. Il existe pour la raison exacte de C28-137 : un `opts` lu par le moteur
 * et passé par personne est une intention jamais livrée, et on s'en aperçoit le jour où le
 * budget du tick est épuisé et qu'il n'y a plus rien pour vérifier une réparation avant minuit.
 *
 * Il passe outre le budget QUOTIDIEN et la porte de l'audit — c'est le geste de Marc, pas une
 * décision du moteur — mais PAS le garde-temps, ni le jeton, ni la suspension, ni le frein en
 * dollars. Et la Santé dira « lancée à la main », pour qu'on ne lise pas « ça marche » sur la
 * preuve d'un geste humain.
 *
 * À lancer depuis `RattrapagePiece.gs` → `rattraperPiecesMaintenant` → Exécuter.
 */
function rattraperPiecesMaintenant() {
  var debut = Date.now();
  // Ventilation du coût, patron de `WebApp.gs` : une exécution manuelle ne passe par aucune
  // étape de tick, donc ses appels Haiku tombaient dans « (hors étape) » — indistinguables de
  // ceux du chat. Restauré en `finally` : l'éditeur Apps Script réutilise le contexte.
  var opAvant = '';
  try { opAvant = operationCourante_(); poserOperationCourante_('rattrapage-piece-manuel'); } catch (eOp) { }
  var res;
  try {
    res = etapeRattrapagePiece_(
      function () { return (Date.now() - debut) > CONFIG.BUDGET_MS; },
      { manuel: true }
    );
  } finally {
    try { poserOperationCourante_(opAvant); } catch (eOp2) { }
  }
  // ⚠️ LES ACCEPTÉES SONT DITES. Sans elles, « 24 faits » couvre aussi bien 24 pièces arrivées
  // que 24 refusées par le contrat de la Mémoire — c'est la panne du 16/09 (4 000 faits refusés
  // sous un HTTP 200) en plus discret, puisque ici personne ne compterait.
  var ligne = 'Rattrapage des pièces (manuel) : ' + res.faits + ' extraits dont '
    + res.acceptees + ' acceptés par la Mémoire / ' + res.echecs
    + ' échecs / ' + res.sansTexte + ' sans texte / ' + res.illisibles + ' illisibles — '
    + res.restants + ' restants — ' + res.fin
    + (res.dernierMotif ? ' — dernier motif : ' + res.dernierMotif : '');
  Logger.log(ligne);
  return ligne;
}

/**
 * Diagnostic un-clic, LECTURE SEULE : ce que la tranche contient, sans rien envoyer.
 *
 * ⚠️ Il existe parce qu'un « combien ça va coûter » doit se lire AVANT de dépenser, et parce
 * qu'un point d'observation promis se committe dans le même geste que ce qu'il observe.
 * À lancer depuis `RattrapagePiece.gs` → `diagnosticRattrapagePiece` → Exécuter.
 */
function diagnosticRattrapagePiece() {
  var props = PropertiesService.getScriptProperties();
  var lignes = lireLignesIndexPerimetre_();
  if (!lignes) { Logger.log('Index vide ou illisible.'); return 'index-vide'; }
  var tag = String(CONFIG.RATTRAPAGE_PIECE_TAG || '') || 'manuel';
  var faits = lireFaitsRattrapage_(tag) || {};
  var choix = selectionnerRattrapage_(
    lignes, fileIdDeLigneIndex_, faits, prefixesRattrapage_(), 10000);

  var parPref = {};
  for (var i = 0; i < choix.choisies.length; i++) {
    var p = prefixeDomainePiece_(choix.choisies[i].domaine);
    parPref[p] = (parPref[p] || 0) + 1;
  }
  var detail = [];
  var prefixes = prefixesRattrapage_();
  for (var k = 0; k < prefixes.length; k++) {
    detail.push(prefixes[k] + '=' + (parPref[prefixes[k]] || 0));
  }

  var ligne = 'Tranche « ' + tag + ' » : ' + choix.tranche + ' documents au total, '
    + choix.restants + ' encore à faire (' + detail.join(', ') + ')'
    + ' · 1 appel Haiku par document'
    + ' · idempotence : onglet PiecesFaites (sans plafond)'
    + ' · état : ' + phraseFinRattrapage_(
        props.getProperty('DriveAI_RATTRAPAGE_PIECE_FIN'), CONFIG.RATTRAPAGE_PIECE_TAG);
  Logger.log(ligne);
  return ligne;
}
