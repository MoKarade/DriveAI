/**
 * PerimetrePiece.gs — C49-4, étape A : COMBIEN de documents la Mémoire aurait à lire.
 *
 * ⚠️ POURQUOI CE FICHIER EST LE PREMIER DU LOT, ET PAS UNE NOTE DANS UN ADR. Marc a demandé
 * le 17/09 de « commencer à mettre en place la lecture de tout mon Drive ». Tout le reste —
 * combien de temps la campagne dure, ce qu'elle coûte, le budget à lui prélever, l'ordre des
 * domaines — se dérive d'UN nombre que PERSONNE n'a mesuré : combien de documents sont des
 * PAPIERS. « 20 346 » est le compte de l'Index, pas celui du périmètre : il porte des photos,
 * des exports, des vidéos, des archives. Annoncer une durée ou un coût sur 20 346 serait un
 * chiffre inventé, et la §9 de ce dépôt a déjà payé deux fois « un seuil écrit avant sa mesure
 * est un chiffre inventé ».
 *
 * ⚠️ CE QUE CETTE ÉTAPE NE FAIT PAS : aucun appel LLM, aucune lecture de CONTENU, aucun octet
 * qui sort du compte Google. Elle lit l'Index — des métadonnées — et écrit un compte. Elle ne
 * peut donc rien coûter et rien exposer ; c'est ce qui permet de la livrer avant la porte
 * C49-3, qui, elle, garde l'ENVOI.
 *
 * ⚠️ L'EXCLUSION EST FERMÉE, L'INCLUSION EST OUVERTE, et c'est le sens sûr POUR L'EXTENSION.
 * Ce qu'on exclut est une liste ÉCRITE d'extensions qui ne peuvent porter aucun texte (vidéo,
 * son, archive) ; tout le reste est candidat, y compris ce qu'on ne connaît pas. Dans l'autre
 * sens — une liste fermée de ce qui EST un papier — une extension oubliée sous-compte le
 * périmètre, et l'erreur ne se verrait qu'une fois la campagne lancée et plus chère que promis.
 *
 * ⚠️⚠️ MAIS LE COMPTE EST QUAND MÊME UN PLANCHER, ET CE N'EST PAS L'EXTENSION QUI LE CAUSE —
 * C'EST LA CLÉ. Mesuré au premier usage réel, le 17/09 : 4 240 lignes `classé` porteuses d'un
 * fileId, sur 26 550 lignes d'Index. `fileIdDeCleIndex_` n'accepte que quatre préfixes de clé
 * (`drive`, `tri33p`, `migre`, `reanalyse`) ; or la clé d'une pièce jointe Gmail est
 * `<messageId>|<rang>|<nom>|<taille>` (`cleAttachement_`) et ne commence par aucun d'eux. Tout
 * document entré par Gmail — l'intake PRINCIPAL du moteur — est donc invisible à ce comptage,
 * bien qu'il soit rangé dans le Drive et porte un vrai fileId.
 * Ces lignes se COMPTENT désormais (`classeesSansFileId`) au lieu d'être sautées en silence :
 * une population qu'on ne sait pas mesurer doit au moins se dire, sinon « 3 972 » se lit comme
 * un total alors que c'est un début. La première rédaction de cet en-tête affirmait
 * « sur-compter se voit tout de suite » — c'était vrai de l'extension et faux du périmètre.
 * ⚠️ MÊME ANGLE MORT CÔTÉ MÉMOIRE : `faitInventaireMemoire_` et `pieceMemoire_` appliquent les
 * DEUX mêmes conditions. Ce que ce comptage ne voit pas, le canal ne l'enverra jamais non plus.
 *
 * ⚠️ ET CE QUI EST COMPTÉ RESTE UNE BORNE HAUTE, pas une promesse. « Ce fichier peut porter du
 * texte » ne veut pas dire « l'OCR en rendra ». La seule mesure de ce taux-là est l'audit
 * C49-3, qui compte ses « sans texte » sur un échantillon stratifié : c'est LUI qui convertira
 * cette borne en prévision, pas ce fichier. Dire les deux séparément est tout l'intérêt.
 */

/**
 * Les extensions qui ne peuvent porter AUCUN texte lisible. Liste FERMÉE — voir l'en-tête :
 * c'est l'exclusion qui est écrite, jamais l'inclusion.
 */
var EXTENSIONS_SANS_TEXTE_PIECE = {
  mp4: 1, mov: 1, avi: 1, mkv: 1, wmv: 1, webm: 1, m4v: 1, mpg: 1, mpeg: 1,
  mp3: 1, m4a: 1, wav: 1, aac: 1, flac: 1, ogg: 1, wma: 1,
  zip: 1, rar: 1, '7z': 1, gz: 1, tar: 1, bz2: 1, dmg: 1, iso: 1,
  exe: 1, msi: 1, apk: 1, app: 1, bin: 1, dll: 1,
  ttf: 1, otf: 1, woff: 1, woff2: 1, ics: 1
};

/** Combien de lignes de détail (domaines, extensions) tiennent dans la Property de suivi. */
var PERIMETRE_PIECE_TOP = 6;

/**
 * Les domaines que Marc a choisi de pousser EN PREMIER (17/09), donc ceux dont le compte
 * DÉCIDE — toujours publiés, même à zéro.
 *
 * ⚠️ POURQUOI ILS NE PEUVENT PAS SORTIR DE LA TÊTE. Au premier usage réel, la tête des six
 * plus gros domaines ne contenait NI `04` NI `01` : ils sont petits (87 pour `01`, et `04`
 * quelque part dans les 68 restants), donc précisément invisibles à une troncature par
 * volume. Une surface bornée qui cache le seul chiffre pour lequel on l'a écrite ne mesure
 * rien — et « absent de la tête » se lit comme « zéro », qui est une autre information.
 *
 * Reconnus par le PRÉFIXE, jamais par le libellé entier, qui se renomme (même règle que
 * `estDomaineMasqueAudit_`, et pour la même raison).
 *
 * ⚠️ C'est AUSSI la tranche de lecture (`prefixesRattrapage_`), DANS L'ORDRE : une seule liste,
 * deux consommateurs. Le 23/09, Marc a choisi « tout le reste » après `04 + 01 + 02` :
 * `05` (531) → `03` (284) → `08` (857) → `06` (1 169) — l'ordre du plan qu'il a validé (le
 * plus gros, 06, en dernier) —, puis `07` et `09`, domaines auto qui peuvent être vides.
 * (Comptes en LIGNES d'Index au 17/09 : la tranche compte des documents depuis C49-26.)
 * Les trois premiers RESTENT en tête : lus sous le tag courant, ils sont marqués faits dans
 * `PiecesFaites` et ne coûtent rien — les retirer ferait disparaître leur ✅ de la file.
 * ⚠️ Élargir la liste SANS bumper `RATTRAPAGE_PIECE_TAG` est voulu : bumper ferait RELIRE les
 * 1 210 papiers déjà lus (~6 $ pour rien — même extracteur, donc la Mémoire les garderait tels
 * quels). ⚠️ La gate du tick ne rouvre PAS d'elle-même : elle s'ouvre parce que
 * `DriveAI_RATTRAPAGE_PIECE_TAG` n'est écrit par personne (bug préexistant, BACKLOG C49-26), et
 * un tripwire de `test/rattrapage-piece.test.js` rougira le jour où quelqu'un le persistera sans
 * mettre cette liste dans la signature. Le test voisin, lui, ne prouve que la SÉLECTION.
 */
var PREFIXES_DOMAINE_DECISIF_PIECE = ['04', '01', '02', '05', '03', '08', '06', '07', '09'];

/* ---------- PUR ---------- */

/**
 * PURE. L'extension d'un nom de fichier, en minuscules, ou `(sans)`.
 *
 * ⚠️ Le point doit être dans le DERNIER segment : « 2026-03-01_Permis_IRCC » n'a pas
 * d'extension, et un `lastIndexOf('.')` naïf lui en trouverait une sur une date écrite
 * « 2026.03.01 ». On borne donc la longueur de ce qui suit le point — une extension réelle
 * fait 1 à 5 caractères alphanumériques, jamais « 01_Permis_IRCC ».
 */
function extensionPerimetre_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  var p = s.lastIndexOf('.');
  if (p <= 0 || p === s.length - 1) return '(sans)';
  var ext = s.slice(p + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : '(sans)';
}

/**
 * PURE. Ce fichier peut-il porter du texte ? Voir l'en-tête : exclusion fermée, inclusion
 * ouverte. Un nom vide reste candidat — l'absence de nom n'est pas une preuve d'absence de
 * texte, et c'est le sens qui sur-compte.
 */
function estCandidatPiece_(nom) {
  return EXTENSIONS_SANS_TEXTE_PIECE[extensionPerimetre_(nom)] !== 1;
}

/**
 * PURE. Le périmètre, depuis les lignes BRUTES de l'Index (colonnes A..F).
 *
 * @param {!Array<!Array<*>>} lignes  [clé, traité le, fichier, domaine, chemin, statut]
 * @param {function(Array):string} fileIdDe  extracteur de fileId (injecté : la règle vit
 *     dans `Journal.gs`, et la recopier ici en ferait une règle et demie). ⚠️ Il reçoit la
 *     LIGNE ENTIÈRE depuis C49-16, plus seulement sa clé : le fileId vit désormais dans une
 *     colonne, et une pièce jointe Gmail n'en a jamais eu dans sa clé.
 * @return {!Object} { lues, classees, candidats, exclus, parDomaine, parExtension }
 */
function compterPerimetrePiece_(lignes, fileIdDe) {
  var res = { lues: 0, classees: 0, classeesSansFileId: 0, candidats: 0, exclus: 0,
    distinctes: 0, parDomaine: {}, parExtension: {} };
  if (!lignes || !lignes.length) return res;
  // ⚠️ `classees` compte des LIGNES, et un même document en porte plusieurs dans l'Index
  // (`drive|…`, `migre|…`, `reanalyse|…` finissent tous par son fileId). `distinctes` compte les
  // DOCUMENTS (23/09/2026) : c'est lui qui se compare à ce que la Mémoire a reçu — un écart
  // mesuré contre un nombre de lignes accuserait la vitesse d'envoi d'un doublon de comptage.
  var vus = {};

  for (var i = 0; i < lignes.length; i++) {
    res.lues++;
    var statut = String(lignes[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;
    if (!fileIdDe(lignes[i])) {
      // ⚠️ RANGÉ, et NI sa clé NI sa colonne ne portent de fileId — une pièce jointe Gmail dont
      // la résolution n'a pas encore tourné, ou qui a été refusée. Sauter en silence ferait
      // passer un PLANCHER pour un total (voir l'en-tête). On compte.
      res.classeesSansFileId++;
      continue;
    }
    res.classees++;
    var id = String(fileIdDe(lignes[i]));
    if (!vus[id]) { vus[id] = 1; res.distinctes++; }

    var nom = String(lignes[i][2] || '');
    var ext = extensionPerimetre_(nom);
    if (!estCandidatPiece_(nom)) {
      res.exclus++;
      continue;
    }
    res.candidats++;

    var dom = String(lignes[i][3] || '(sans domaine)');
    res.parDomaine[dom] = (res.parDomaine[dom] || 0) + 1;
    res.parExtension[ext] = (res.parExtension[ext] || 0) + 1;
  }
  return res;
}

/**
 * PURE. Le compte des domaines DÉCISIFS, par préfixe, dans l'ordre de la constante.
 * Rend toujours une entrée par préfixe — un zéro est une mesure, une absence n'en est pas une.
 */
function decisifsPerimetre_(parDomaine) {
  var out = [];
  for (var i = 0; i < PREFIXES_DOMAINE_DECISIF_PIECE.length; i++) {
    var prefixe = PREFIXES_DOMAINE_DECISIF_PIECE[i];
    var n = 0;
    for (var d in parDomaine) {
      if (!Object.prototype.hasOwnProperty.call(parDomaine, d)) continue;
      if (String(d).trim().slice(0, 2) === prefixe) n += parDomaine[d];
    }
    out.push(prefixe + '=' + n);
  }
  return out;
}

/**
 * PURE. Les `n` premières entrées d'une carte nom → compte, par compte DÉCROISSANT puis par
 * nom, pour que la sortie soit déterministe à égalité (sinon deux runs sur le même Drive
 * rendent deux phrases différentes, et on croit que quelque chose a bougé).
 */
function tetePerimetre_(carte, n) {
  var cles = [];
  for (var k in carte) if (Object.prototype.hasOwnProperty.call(carte, k)) cles.push(k);
  cles.sort(function (a, b) {
    if (carte[b] !== carte[a]) return carte[b] - carte[a];
    return a < b ? -1 : (a > b ? 1 : 0);
  });
  return cles.slice(0, n);
}

/**
 * PURE. Ce qu'on persiste, en UNE chaîne compacte et BORNÉE.
 *
 * ⚠️ Le registre de suivi C28-44 est saturé (§9) et une Property plafonne vers 9 Ko : on ne
 * persiste donc PAS la carte complète des domaines et des extensions, mais leur TÊTE, et le
 * reste est agrégé sous `…`. Le détail complet se lit par `diagnosticPerimetrePiece()`, qui
 * ne persiste rien — un diagnostic n'a pas à tenir dans un budget d'écriture.
 */
function encoderPerimetrePiece_(res, tag, iso) {
  var doms = tetePerimetre_(res.parDomaine, PERIMETRE_PIECE_TOP);
  var exts = tetePerimetre_(res.parExtension, PERIMETRE_PIECE_TOP);
  var morceaux = [];
  var i;
  for (i = 0; i < doms.length; i++) morceaux.push(doms[i] + '=' + res.parDomaine[doms[i]]);
  var extraits = [];
  for (i = 0; i < exts.length; i++) extraits.push(exts[i] + '=' + res.parExtension[exts[i]]);
  // ⚠️ Les deux derniers champs sont AJOUTÉS EN QUEUE : une chaîne écrite par la version
  // précédente se relit sans décalage, et son absence se lit comme « pas encore mesuré par
  // cette version » plutôt que comme un zéro (C28-44, appliqué à une Property).
  return [
    iso, tag,
    res.candidats + '/' + res.classees + '/' + res.lues,
    String(res.exclus),
    morceaux.join(','),
    extraits.join(','),
    String(res.classeesSansFileId || 0),
    decisifsPerimetre_(res.parDomaine).join(','),
    // ⚠️ EN QUEUE (C28-44) : une chaîne écrite avant le 23/09 n'a pas ce champ, et son absence
    // se lit « pas encore mesuré », jamais zéro.
    String(res.distinctes || 0)
  ].join('|');
}

/**
 * PURE. La décision du tick : cette étape doit-elle tourner ?
 *
 * ⚠️ Elle NE consulte PAS un compteur de restants, contrairement à l'audit — c'est une passe
 * ONE-SHOT : elle relit tout l'Index d'un coup, donc soit elle a tourné sous ce tag, soit
 * non. Bumper `CONFIG.PERIMETRE_PIECE_TAG` la relance ; rien d'autre ne le fait, et c'est
 * voulu : un recomptage par tick lirait 20 000 lignes toutes les 5 minutes pour un nombre qui
 * bouge de quelques unités par jour.
 *
 * ⚠️ C49-26 — ET UNE FOIS PAR JOUR, quand on lui passe les jours. Depuis que le compte des
 * documents DISTINCTS sert de dénominateur à « Import — file », un compte figé par tag ne suit
 * plus : le numérateur (`DriveAI_MEMOIRE_EMIS`) est un cumul qui monte avec chaque document
 * classé ensuite, et la jauge finirait par dépasser 100 % — un chiffre qui dit le contraire de
 * ce qu'il mesure. Une lecture d'Index par jour (un `getValues`, quelques secondes) règle ça ;
 * une par tick coûterait 288 fois plus pour rien.
 */
function perimetreDoitTourner_(tagPersiste, tagCourant, jourPersiste, jourCourant) {
  if (String(tagPersiste || '') !== String(tagCourant || '')) return true;
  if (jourCourant === undefined) return false;
  return String(jourPersiste || '') !== String(jourCourant || '');
}

/**
 * PURE. La ligne de Santé, depuis la chaîne persistée.
 *
 * ⚠️ « jamais mesuré » et « mesuré, 0 candidat » ne se ressemblent pas ici, et c'est tout
 * l'objet de cette phrase : le premier appelle un bump de tag, le second appelle une enquête
 * sur l'Index. La panne du 16/09 est née d'exactement cette confusion.
 */
function phrasePerimetrePiece_(brut) {
  if (!brut) return 'jamais mesuré — bumper CONFIG.PERIMETRE_PIECE_TAG pour lancer le comptage';
  var p = String(brut).split('|');
  var comptes = String(p[2] || '').split('/');
  var candidats = comptes[0] || '?';
  var classees = comptes[1] || '?';
  var lues = comptes[2] || '?';
  var phrase = candidats + ' papiers candidats sur ' + classees + ' documents classés (' +
    lues + ' lignes d\'Index) · ' + (p[3] || '0') + ' écartés (sans texte possible)';
  // ⚠️ Le compte des DOCUMENTS, quand cette version l'a mesuré : « documents classés » compte
  // des LIGNES d'Index, et un document en porte souvent plusieurs.
  var distinctes = Number(p[8]);
  if (p[8] && !isNaN(distinctes) && distinctes > 0) {
    phrase += ' · ' + distinctes + ' documents DISTINCTS (un document peut porter plusieurs lignes)';
  }
  // ⚠️ Les domaines que Marc pousse EN PREMIER, TOUJOURS — ils sont trop petits pour entrer
  // dans la tête par volume, donc la troncature cacherait le seul chiffre qui décide.
  if (p[7]) phrase += ' · à pousser d\'abord : ' + p[7];
  if (p[4]) phrase += ' · ' + p[4];
  // ⚠️ LE PLANCHER, avant la borne haute : une ligne « classé » dont la CLÉ ne porte pas de
  // fileId (une pièce jointe Gmail) est hors de ce comptage ET hors du canal de la Mémoire.
  // Sans ce nombre, « 3 972 » se lit comme un total alors que c'est un début.
  var sansId = Number(p[6]);
  if (!isNaN(sansId) && sansId > 0) {
    phrase += ' · ⚠️ ' + sansId + ' lignes classées SANS fileId de clé (PJ Gmail) — hors de ce ' +
      'compte ET hors du canal Mémoire : le total est donc un PLANCHER';
  }
  phrase += ' · mesuré le ' + String(p[0] || '?').slice(0, 16).replace('T', ' ');
  // ⚠️ Ce qui EST compté reste une BORNE HAUTE : « peut porter du texte » n'est pas « en
  // porte ». Le dire ICI, pas seulement dans l'en-tête — c'est cette ligne que Marc lit.
  return phrase + ' · borne HAUTE (le taux de texte réel se lit dans l\'audit)';
}

/* ---------- I/O ---------- */

/** Les lignes A..I de l'Index, ou `null` si l'onglet est vide/absent. */
function lireLignesIndexPerimetre_() {
  var idx = feuille_('Index');
  if (!idx || idx.getLastRow() < 2) return null;
  // ⚠️ NEUF colonnes depuis C49-16, pas six : la 9ᵉ porte le fileId. Une plage trop courte rend
  // `undefined` sans lever, et le lecteur retomberait en silence sur la clé — c'est-à-dire sur
  // l'angle mort qu'on vient de fermer.
  return idx.getRange(2, 1, idx.getLastRow() - 1, 9).getValues();
}

/**
 * L'étape du tick. ONE-SHOT par tag, sans appel LLM, sans budget quotidien à elle.
 *
 * ⚠️ PAS DE `*_BUDGET_JOUR_MS`, et c'est une décision, pas un oubli. La §9 dit qu'une étape
 * sans constante est une ADDITION nette à l'enveloppe, et c'est vrai d'une étape PERPÉTUELLE.
 * Celle-ci tourne UNE fois par tag : une lecture de 20 000 lignes en un `getValues`, quelques
 * secondes, puis plus jamais — la gate la coupe avant tout travail. Lui prélever une minute
 * par jour à une autre campagne coûterait cette minute TOUS LES JOURS pour une passe unique.
 *
 * ⚠️ Elle DIT toujours ce qu'elle a fait (C28-135) : l'Index vide, la lecture impossible et le
 * comptage réussi écrivent chacun leur état. Une étape qui sort en silence est indiscernable
 * d'une étape jamais atteinte.
 */
function etapePerimetrePiece_() {
  var props = PropertiesService.getScriptProperties();
  var iso = new Date().toISOString();
  var lignes;
  try {
    lignes = lireLignesIndexPerimetre_();
  } catch (e) {
    journalErreur_('PerimetrePiece', 'Index illisible : ' + e);
    return null;
  }
  if (!lignes) {
    // Le tag N'EST PAS posé : un Index vide n'est pas une mesure, et re-essayer au tick
    // suivant est exactement ce qu'on veut.
    journalInfo_('PerimetrePiece', 'Index vide — rien à compter, le tag reste ouvert');
    return null;
  }

  var res = compterPerimetrePiece_(lignes, fileIdDeLigneIndex_);
  props.setProperty('DriveAI_PERIMETRE_PIECE', encoderPerimetrePiece_(res, CONFIG.PERIMETRE_PIECE_TAG, iso));
  props.setProperty('DriveAI_PERIMETRE_PIECE_TAG', CONFIG.PERIMETRE_PIECE_TAG);
  // Le jour se pose APRÈS le compte, comme le tag : une mesure ratée laisse la gate ouverte.
  props.setProperty('DriveAI_PERIMETRE_PIECE_JOUR', dateGmail_(new Date()));
  journalInfo_('PerimetrePiece',
    'Périmètre mesuré : ' + res.candidats + ' candidats sur ' + res.classees +
    ' classés (' + res.exclus + ' écartés)');
  return res;
}

/** La ligne de Santé. Impure (Properties) ; la mise en mots est PURE et testée. */
function texteSantePerimetrePiece_() {
  try {
    return phrasePerimetrePiece_(PropertiesService.getScriptProperties().getProperty('DriveAI_PERIMETRE_PIECE') || '');
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * DIAGNOSTIC UN CLIC — `PerimetrePiece.gs` → `diagnosticPerimetrePiece` → Exécuter.
 *
 * Rend le détail COMPLET (tous les domaines, toutes les extensions) dans le journal
 * d'exécution, sans rien persister et sans rien envoyer. C'est ce tableau qui dimensionne la
 * campagne C49-4 : combien de papiers dans `04` et `01`, que Marc a choisi de pousser EN
 * PREMIER, et combien dans le reste.
 *
 * ⚠️ Lecture SEULE, et exécutable même quand la gate du tick est éteinte : un diagnostic qui
 * ne peut pas tourner quand on en a besoin ne diagnostique rien.
 */
function diagnosticPerimetrePiece() {
  var lignes = lireLignesIndexPerimetre_();
  if (!lignes) {
    Logger.log('Index vide ou absent — aucun comptage possible.');
    return null;
  }
  var res = compterPerimetrePiece_(lignes, fileIdDeLigneIndex_);
  Logger.log('Lignes d\'Index : ' + res.lues);
  Logger.log('Classés avec fileId : ' + res.classees);
  // ⚠️ Le PLANCHER : ces lignes sont rangées dans le Drive et invisibles au comptage comme au
  // canal de la Mémoire, parce que leur CLÉ ne porte pas de fileId (PJ Gmail).
  Logger.log('Classés SANS fileId de clé (hors compte, hors Mémoire) : ' + res.classeesSansFileId);
  Logger.log('Candidats (peuvent porter du texte) : ' + res.candidats);
  Logger.log('Écartés (extension sans texte possible) : ' + res.exclus);
  Logger.log('À pousser d\'abord : ' + decisifsPerimetre_(res.parDomaine).join(' · '));
  Logger.log('--- par domaine ---');
  var doms = tetePerimetre_(res.parDomaine, 1000);
  var i;
  for (i = 0; i < doms.length; i++) Logger.log(doms[i] + ' : ' + res.parDomaine[doms[i]]);
  Logger.log('--- par extension ---');
  var exts = tetePerimetre_(res.parExtension, 1000);
  for (i = 0; i < exts.length; i++) Logger.log(exts[i] + ' : ' + res.parExtension[exts[i]]);
  return res;
}
