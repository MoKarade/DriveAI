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
 * d'identité — et si c'est mauvais, on arrête avant d'avoir dépensé ». Une campagne qui
 * enchaînerait sur les 3 862 autres papiers lui retirerait ce point d'arrêt sans rien dire.
 * Élargir la tranche est un geste DÉLIBÉRÉ (`RATTRAPAGE_PIECE_PREFIXES`), jamais un défaut.
 *
 * ⚠️ LE BUDGET N'EST PAS UNE ADDITION. Ce module ne reçoit aucune constante à lui : il
 * consomme le budget quotidien des PIÈCES (`AUDIT_PIECE_BUDGET_JOUR_MS`, 11 min prélevées à
 * la réconciliation en C49-3) et il ne démarre que quand l'audit n'a plus rien à extraire.
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
 * @param {Function} fileIdDe      lit le fileId d'une clé (injecté pour le test)
 * @param {Object} faits           { fileId: 1 } déjà traités sous le tag courant
 * @param {Array<string>} prefixes domaines de la tranche, dans l'ordre
 * @param {number} max             plafond de la sélection rendue
 * @return {{choisies: Array<Object>, restants: number, tranche: number}}
 */
function selectionnerRattrapage_(lignes, fileIdDe, faits, prefixes, max) {
  var parPrefixe = {};
  var i;
  for (i = 0; i < prefixes.length; i++) parPrefixe[prefixes[i]] = [];
  var res = { choisies: [], restants: 0, tranche: 0 };
  if (!lignes || !lignes.length) return res;

  for (i = 0; i < lignes.length; i++) {
    var statut = String(lignes[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;

    var cle = String(lignes[i][0] || '');
    var fileId = fileIdDe(cle);
    // Une clé sans fileId est une pièce jointe Gmail : rangée pour de vrai, mais le canal ne
    // sait pas la désigner. Elle est HORS de ce rattrapage, et le périmètre le dit déjà comme
    // un PLANCHER (C49-4) — on ne la compte donc pas non plus dans les restants, sinon le
    // compteur ne tomberait jamais à zéro et la tranche ne se terminerait jamais.
    if (!fileId) continue;

    var nom = String(lignes[i][2] || '');
    if (!estCandidatPiece_(nom)) continue;

    var pref = prefixeDomainePiece_(lignes[i][3]);
    if (!Object.prototype.hasOwnProperty.call(parPrefixe, pref)) continue;

    res.tranche++;
    if (faits && faits[fileId] === 1) continue;
    res.restants++;
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
 * La liste des documents déjà faits, encodée `<tag>|<fileId>|<fileId>…`.
 *
 * ⚠️ Le TAG est DANS la valeur, pas à côté : sans lui, bumper le tag pour tout refaire
 * laisserait l'ancienne liste en place et la campagne relancée ne traiterait rien — le
 * « remède gaté par un tag rendu inerte » payé le 17/09 sur l'audit, à l'identique.
 */
function encoderFaitsRattrapage_(tag, faits) {
  var ids = [];
  for (var id in faits) {
    if (Object.prototype.hasOwnProperty.call(faits, id) && faits[id] === 1) ids.push(id);
  }
  return String(tag || '') + '|' + ids.join('|');
}

/** Décode la liste, et rend VIDE si elle a été écrite sous un autre tag. PURE. */
function decoderFaitsRattrapage_(brut, tag) {
  var out = {};
  var parts = String(brut == null ? '' : brut).split('|');
  if (parts.length < 1 || parts[0] !== String(tag || '')) return out;
  for (var i = 1; i < parts.length; i++) if (parts[i]) out[parts[i]] = 1;
  return out;
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
 * `DriveAI_RATTRAPAGE_PIECE_FIN` = `<ISO>|<fin>|<faits>/<echecs>/<sansTexte>|<restants>|<tick|manuel>`
 */
function ligneFinRattrapage_(maintenant, res, manuel) {
  return [
    maintenant.toISOString().slice(0, 16).replace('T', ' '),
    res.fin,
    res.faits + '/' + res.echecs + '/' + res.sansTexte,
    // Un reste non mesuré s'écrit VIDE, jamais 'null' ni '0' : le lecteur doit pouvoir le
    // distinguer d'un vrai zéro, et c'est cette distinction qui a manqué le 17/09.
    (typeof res.restants === 'number' && isFinite(res.restants)) ? String(res.restants) : '',
    manuel ? 'manuel' : 'tick'
  ].join('|');
}

function noterFinRattrapage_(props, res, manuel) {
  try {
    props.setProperty('DriveAI_RATTRAPAGE_PIECE_FIN', ligneFinRattrapage_(new Date(), res, manuel));
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
 * La phrase lue par `majSante_` — sans rien exécuter, ce que le piège 3 (§9) exige. PURE.
 */
function phraseFinRattrapage_(brut, tagCourant) {
  if (!String(tagCourant || '')) {
    return 'tranche non armée — poser CONFIG.RATTRAPAGE_PIECE_TAG pour lancer 04 + 01';
  }
  if (!brut) return 'armée (« ' + tagCourant + ' »), jamais passée';
  var p = String(brut).split('|');
  // ⚠️ `Number('')` vaut 0 et `Number('null')` vaut NaN : une sortie qui n'a rien compté ne doit
  // pas se lire « 0 restants », donc « terminée ». On ne fait confiance qu'à un vrai nombre.
  var restants = (p[3] === '' || p[3] === undefined || p[3] === 'null') ? NaN : Number(p[3]);
  var phrase = (isFinite(restants) ? restants + ' restants' : 'reste inconnu')
    + ' dans la tranche 04 + 01'
    + ' · dernière passe : ' + (p[2] || '?') + ' (faits/échecs/sans texte) — ' + (p[1] || '?')
    + ' · ' + (p[0] || '?')
    // ⚠️ Qui l'a lancée : une passe MANUELLE prouve que le code est bon, jamais que le
    // déclencheur l'exécute. Sans ce mot, on lit « ça marche » sur la preuve d'un geste humain.
    + ' · ' + (p[4] === 'manuel' ? 'lancée à la main' : 'par le tick');
  if (isFinite(restants) && restants === 0) {
    phrase += ' · ✅ tranche terminée — à toi de juger avant d\'élargir';
  }
  return phrase;
}

function texteSanteRattrapagePiece_() {
  var brut;
  try { brut = PropertiesService.getScriptProperties().getProperty('DriveAI_RATTRAPAGE_PIECE_FIN'); }
  catch (e) { return 'état illisible'; }
  return phraseFinRattrapage_(brut, CONFIG.RATTRAPAGE_PIECE_TAG);
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
  var res = { faits: 0, echecs: 0, sansTexte: 0, envoyees: 0, acceptees: 0,
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
  var faits = decoderFaitsRattrapage_(
    props.getProperty('DriveAI_RATTRAPAGE_PIECE_FAITS'), tagFaits);
  var maxParRun = opts.manuel ? choixSansPlafondRattrapage_() : RATTRAPAGE_PIECE_MAX_PAR_RUN;
  var choix = selectionnerRattrapage_(
    lignes, fileIdDeCleIndex_, faits, prefixesRattrapage_(), maxParRun);
  res.restants = choix.restants;

  // ⚠️ Le REFUS de démarrer une tranche trop grande, plutôt que la découverte du plafond en
  // production. Une Property qui déborde lève à l'écriture : la campagne re-traiterait alors
  // les mêmes documents à chaque passe, en payant un appel LLM à chaque fois, sans jamais
  // avancer — et le compteur de restants ne bougerait pas d'un cran.
  if (choix.tranche > RATTRAPAGE_PIECE_MAX_FAITS) {
    res.fin = 'tranche-trop-grande';
    journalErreur_('RattrapagePiece', 'Tranche de ' + choix.tranche + ' documents > plafond '
      + RATTRAPAGE_PIECE_MAX_FAITS + ' : l\'idempotence tient dans une Script Property et ne '
      + 'passera pas à cette échelle. Élargir la tranche exige un autre mécanisme.');
    return noterFinRattrapage_(props, res, !!opts.manuel);
  }

  if (!choix.choisies.length) {
    res.fin = 'tranche-terminee';
    return noterFinRattrapage_(props, res, !!opts.manuel);
  }

  var debutRun = Date.now();
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
  var marquesFragiles = [];
  res.fin = 'termine';
  for (var i = 0; i < choix.choisies.length; i++) {
    if (gardeRun()) { res.fin = 'budget'; break; }
    var doc = choix.choisies[i];
    var motif = rattraperUnDocument_(doc, !!opts.manuel);
    res.dernierMotif = motif;
    var issue = issueRattrapage_(motif);

    // ⚠️ UNE PANNE DE CANAL NE SE MARQUE PAS, et elle arrête la boucle. Marquer « fait » sur
    // un jeton refusé ou un frein budget perdrait le document À VIE : il ne reviendrait ni par
    // le rattrapage, ni par le flux (qui ne le verra jamais, il est déjà classé). Et continuer
    // la boucle brûlerait une extraction par document pour le même refus.
    if (issue === 'panne') { res.fin = 'canal-' + motif; break; }

    if (motif === 'lecture-impossible') {
      lecturesRatees++;
      marquesFragiles.push(doc.fileId);
      if (lecturesRatees >= 3) {
        res.fin = 'drive-illisible';
        for (var f = 0; f < marquesFragiles.length; f++) {
          if (faits[marquesFragiles[f]] === 1) { delete faits[marquesFragiles[f]]; res.restants++; res.echecs--; }
        }
        break;
      }
    } else {
      // Le canal répond : un refus définitif est une réponse, donc la série est rompue et ce
      // qu'elle avait mis en doute est confirmé.
      lecturesRatees = 0;
      marquesFragiles = [];
    }

    if (issue === 'sans-texte') res.sansTexte++;
    else if (issue === 'echec') res.echecs++;
    else { res.faits++; res.envoyees++; if (motif === 'ok') res.acceptees++; }

    // ⚠️ La marque se pose sur toute issue DÉFINITIVE, « sans texte » et « échec » compris :
    // sans ça, une photo illisible serait re-téléchargée et re-extraite à chaque passe, à vie,
    // et la tranche ne se terminerait jamais.
    faits[doc.fileId] = 1;
    res.restants--;
  }

  try {
    props.setProperty('DriveAI_RATTRAPAGE_PIECE_FAITS', encoderFaitsRattrapage_(tagFaits, faits));
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
  'piece-vide': 'echec',
  'lecture-impossible': 'echec', // droits manquants, fichier disparu — voir le coupe-circuit
                                 // de la boucle : en SÉRIE, la cause n'est plus le document.
  'ocr-echec': 'echec'
};
function issueRattrapage_(motif) {
  var m = String(motif || '');
  if (!m) return 'panne';
  return VERDICTS_DOCUMENT_RATTRAPAGE_[m] || 'panne';
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
    return 'lecture-impossible';
  }

  var texte = extraireTexte_(blob);
  if (texte === null) return 'ocr-echec';
  if (!String(texte).trim()) return 'sans-texte';

  var envoi = pousserPieceApresClassement_(
    { cle: doc.cle },
    { nom: doc.nom, domaine: doc.domaine, statut: doc.statut, chemin: doc.chemin },
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
  var res = etapeRattrapagePiece_(
    function () { return (Date.now() - debut) > CONFIG.BUDGET_MS; },
    { manuel: true }
  );
  var ligne = 'Rattrapage des pièces (manuel) : ' + res.faits + ' faits / ' + res.echecs
    + ' échecs / ' + res.sansTexte + ' sans texte — ' + res.restants + ' restants — ' + res.fin
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
  var faits = decoderFaitsRattrapage_(props.getProperty('DriveAI_RATTRAPAGE_PIECE_FAITS'), tag);
  var choix = selectionnerRattrapage_(
    lignes, fileIdDeCleIndex_, faits, prefixesRattrapage_(), 10000);

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
    + ' · plafond de la liste d\'idempotence : ' + RATTRAPAGE_PIECE_MAX_FAITS
    + ' · état : ' + phraseFinRattrapage_(
        props.getProperty('DriveAI_RATTRAPAGE_PIECE_FIN'), CONFIG.RATTRAPAGE_PIECE_TAG);
  Logger.log(ligne);
  return ligne;
}
