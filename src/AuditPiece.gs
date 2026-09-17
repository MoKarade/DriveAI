/**
 * AuditPiece.gs — C49-3, l'audit des 100 documents stratifiés. UNE porte, pas une étape.
 *
 * ⚠️ POURQUOI CETTE FONCTION EXISTE. `CONFIG.PIECE_PUSH` ouvre un canal qui fait sortir du
 * compte Google le CONTENU des papiers de Marc, numéros d'identité compris. L'ADR-0061 exige
 * de mesurer AVANT d'ouvrir : si l'extraction se trompe, il vaut mieux le découvrir sur 100
 * documents que sur 19 900. Rien ici n'envoie quoi que ce soit à la Mémoire — l'audit est
 * LOCAL, et il le reste même si le flag est allumé.
 *
 * ⚠️ L'ONGLET EST L'ÉTAT, et ce n'est pas un détail d'implémentation. 100 extractions Haiku
 * dépassent le mur des 6 minutes d'Apps Script : la passe doit être REPRENABLE. Un curseur en
 * Property tiendrait, mais il ne montrerait rien ; l'échantillon écrit d'avance en lignes
 * « à faire » sert des DEUX côtés — il reprend, et il dit à Marc où ça en est sans rien
 * exécuter. C'est la règle du parc « du code de surveillance se juge à ce qu'on peut en lire ».
 *
 * ⚠️ L'ÉCHANTILLON EST TIRÉ UNE FOIS, PUIS FIGÉ. Le re-tirer à chaque reprise donnerait « 100
 * documents » qui ne sont jamais les mêmes cent — et aucune mesure ne conclurait.
 *
 * ⚠️ CE QUI EST MASQUÉ, ET C'EST UN ARBITRAGE DE MARC (17/09), contre ma recommandation.
 * Pour `04 · Immigration` et `01 · Administratif & identité`, le TITULAIRE et les CHAMPS
 * STRUCTURÉS ne sont pas écrits en clair : seule leur FORME l'est. Le reste du tableau (type,
 * émetteur, dates) reste lisible, parce que c'est lui qui dit si l'extraction a confondu un
 * passeport avec une facture. La frontière retenue est celle que l'ADR 0004 de MemoryAI pose
 * déjà pour le niveau 3 : existence, type, date, échéance — jamais la valeur qui nomme.
 * ⚠️ CONSÉQUENCE À ASSUMER, et elle est dite plutôt que tue : sur ces deux domaines l'audit
 * ne peut constater que la PRÉSENCE et la FORME. Un numéro parfaitement formé mais FAUX passe.
 * Ce sont aussi les deux domaines où une erreur coûterait le plus cher. Pour les juger
 * vraiment, il faut ouvrir les documents à côté du tableau — le lien est dans la colonne.
 *
 * ⚠️ L'onglet porte des valeurs extraites : il est TEMPORAIRE. `viderAuditPieces` est livrée
 * avec, dans le même geste — un rapport qu'on ne peut pas effacer devient un stock.
 *
 * À lancer depuis l'éditeur : `AuditPiece.gs` → `auditPiecesMaintenant` → Exécuter.
 * Autant de fois que nécessaire : chaque passage reprend où le précédent s'est arrêté.
 */

/** L'onglet de l'audit. TEMPORAIRE — cf. `viderAuditPieces`. */
var ONGLET_AUDIT_PIECE = 'AuditPieces';

var COLONNES_AUDIT_PIECE = [
  'Rang', 'Domaine', 'Fichier', 'Lien', 'Statut',
  'Type', 'Émetteur', 'Date doc', 'Titulaire', 'Confiance', 'Champs', 'Résumé',
  'Verdict (à toi)', 'Note (à toi)'
];

/**
 * Les domaines dont les valeurs NOMINATIVES sont masquées (arbitrage de Marc, 17/09).
 * Reconnus par leur PRÉFIXE numéroté : le libellé complet peut être renommé
 * (`assurerNomsDomaines_` le fait), le numéro non.
 */
var PREFIXES_DOMAINE_MASQUE_AUDIT = ['01', '04'];

/**
 * La colonne « Verdict (à toi) », en numérotation Sheet (1-indexée). DÉRIVÉE de la liste des
 * colonnes : écrite en dur, elle se décale en silence au prochain champ ajouté — et un verdict
 * posé dans la mauvaise colonne ÉCRASE une valeur extraite.
 */
var COL_VERDICT_AUDIT_PIECE = COLONNES_AUDIT_PIECE.indexOf('Verdict (à toi)') + 1;

/** Les verdicts que Marc peut écrire. Tout le reste compte comme « non jugé ». */
var VERDICTS_AUDIT = ['juste', 'partiel', 'faux'];

/* ---------- PUR : la répartition, le masquage, le comptage ---------- */

/**
 * PURE. Combien de documents auditer par domaine — ÉGALITAIREMENT, un tour à la fois.
 *
 * ⚠️ SURTOUT PAS un prorata du stock : c'est tout le sens du mot « stratifié ». Au prorata,
 * `02 · Finances` (des milliers de factures) raflerait l'échantillon et `04 · Immigration` —
 * celui dont une erreur d'extraction coûte le plus cher — aurait deux lignes sur cent. On
 * sert donc un document à chaque domaine, puis on recommence, jusqu'à épuiser l'échantillon
 * ou les stocks. Un domaine trop petit donne ce qu'il a et cesse d'être servi ; ce qui reste
 * va aux autres, donc le total promis est toujours le total rendu.
 *
 * ⚠️ IL Y AVAIT UN PLANCHER ICI, ET IL A ÉTÉ RETIRÉ — une mutation l'a démasqué. Le supprimer
 * ne changeait AUCUN test : la distribution tour par tour donne déjà à chacun sa part. Pire,
 * il NUISAIT sur un petit échantillon — à 10 documents pour 3 domaines et un plancher de 8,
 * il rendait `8, 2, 0`, c'est-à-dire un domaine entier jamais audité, exactement ce qu'il
 * prétendait empêcher. Ne pas le réintroduire en croyant ajouter une garantie.
 *
 * @param {!Object} comptes  domaine → nombre de documents classés
 * @param {number} total     taille voulue de l'échantillon
 * @return {!Object} domaine → nombre à auditer
 */
function repartirAudit_(comptes, total) {
  var domaines = [];
  for (var d in comptes) {
    if (Object.prototype.hasOwnProperty.call(comptes, d) && comptes[d] > 0) domaines.push(d);
  }
  domaines.sort();
  if (!domaines.length || total <= 0) return {};

  var part = {};
  var restant = total;
  var i;
  for (i = 0; i < domaines.length; i++) part[domaines[i]] = 0;

  // Un document par domaine, puis on recommence. `progres` est ce qui arrête la boucle quand
  // plus aucun domaine n'a de stock : sans lui, un échantillon plus grand que le Drive
  // tournerait à l'infini.
  var progres = true;
  while (restant > 0 && progres) {
    progres = false;
    for (i = 0; i < domaines.length && restant > 0; i++) {
      var dom = domaines[i];
      if (part[dom] >= comptes[dom]) continue;
      part[dom]++;
      restant--;
      progres = true;
    }
  }
  return part;
}

/**
 * PURE. Ce domaine cache-t-il ses valeurs nominatives ?
 * Reconnu par le PRÉFIXE, jamais par le libellé entier (qui se renomme).
 */
function estDomaineMasqueAudit_(domaine) {
  var prefixe = String(domaine == null ? '' : domaine).trim().slice(0, 2);
  for (var i = 0; i < PREFIXES_DOMAINE_MASQUE_AUDIT.length; i++) {
    if (PREFIXES_DOMAINE_MASQUE_AUDIT[i] === prefixe) return true;
  }
  return false;
}

/**
 * PURE. La FORME d'une valeur, sans la valeur.
 *
 * ⚠️ Elle doit rester assez informative pour qu'une extraction ABSENTE se distingue d'une
 * extraction PRÉSENTE — sinon le masquage transforme « le modèle n'a rien lu » et « le modèle
 * a lu un numéro » en la même case vide, et l'audit ne mesure plus rien du tout.
 */
function masquerAudit_(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return '(absent)';
  if (typeof valeur === 'number') return '(un nombre)';
  var s = String(valeur);
  var chiffres = (s.match(/\d/g) || []).length;
  var lettres = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (chiffres && !lettres) return '(' + chiffres + ' chiffres)';
  if (chiffres) return '(' + lettres + ' lettres, ' + chiffres + ' chiffres)';
  return '(' + lettres + ' lettres)';
}

/**
 * PURE. Une valeur de champ, mise en texte LISIBLE.
 *
 * ⚠️ CE QUI A CASSÉ, ET POURQUOI ÇA NE SE VOYAIT PAS EN TEST. `champs` n'est PAS une carte de
 * scalaires : le prompt demande `{"montants": [{"libelle", "valeur"}], "numeros": [...], …}`.
 * Un `String()` sur ce tableau rend `[object Object],[object Object]` — du JavaScript qui ne
 * lève pas, s'écrit sans erreur, et donne une ligne d'audit INJUGEABLE. Marc l'a vu au premier
 * usage réel ; mes fixtures, elles, portaient des scalaires, donc aucun test ne pouvait le dire.
 * La leçon est déjà dans ce dépôt sous un autre nom : une fixture qui ne ressemble pas à la
 * donnée RÉELLE valide une hypothèse, pas un format.
 *
 * Trois formes, parce que le modèle en rend trois : la liste `{libelle, valeur}` (le cas
 * nominal), l'objet simple, et le scalaire. `rendre` décide du sort de chaque VALEUR — c'est
 * par lui que passe le masquage, et c'est pour ça qu'il est un paramètre plutôt que deux
 * copies de cette fonction qui divergeraient au premier format ajouté.
 */
function valeurChampAudit_(v, rendre) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Array]') {
    var items = [];
    for (var i = 0; i < v.length; i++) {
      var t = valeurChampAudit_(v[i], rendre);
      if (t) items.push(t);
    }
    return items.join(', ');
  }
  if (typeof v === 'object') {
    // La paire du prompt : le LIBELLÉ dit ce que la valeur est, la VALEUR est ce qu'on masque.
    var aLibelle = Object.prototype.hasOwnProperty.call(v, 'libelle');
    var aValeur = Object.prototype.hasOwnProperty.call(v, 'valeur');
    if (aLibelle || aValeur) {
      var lib = aLibelle && v.libelle != null ? String(v.libelle) : '';
      var val = aValeur ? rendre(v.valeur) : '';
      if (lib && val) return lib + ' ' + val;
      return lib || val;
    }
    // Un objet quelconque : on l'aplatit clé par clé plutôt que de rendre « [object Object] ».
    var out = [];
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      var t2 = valeurChampAudit_(v[k], rendre);
      if (t2) out.push(k + ' ' + t2);
    }
    return out.join(', ');
  }
  return rendre(v);
}

/** PURE. L'objet des champs structurés, masqué — les LIBELLÉS restent, ce sont eux le sujet. */
function masquerChampsAudit_(champs) {
  if (!champs || typeof champs !== 'object') return '(absent)';
  var out = [];
  for (var k in champs) {
    if (!Object.prototype.hasOwnProperty.call(champs, k)) continue;
    var t = valeurChampAudit_(champs[k], masquerAudit_);
    if (t) out.push(k + ' : ' + t);
  }
  return out.length ? out.join(' · ') : '(aucun)';
}

/** PURE. Les champs structurés en clair, lisibles à l'œil. */
function champsEnClairAudit_(champs) {
  if (!champs || typeof champs !== 'object') return '';
  var out = [];
  for (var k in champs) {
    if (!Object.prototype.hasOwnProperty.call(champs, k)) continue;
    var t = valeurChampAudit_(champs[k], function (x) { return String(x); });
    if (t) out.push(k + ' : ' + t);
  }
  return out.join(' · ');
}

/**
 * PURE. La ligne du tableau. Ni Drive, ni réseau, ni horloge.
 *
 * @param {{domaine:string}} ligne  la ligne d'Index auditée
 * @param {?Object} extrait  ce que `extrairePiece_` a rendu, ou null
 * @param {string} statut    'extrait' | 'sans texte' | 'échec'
 * @return {!Array} les 7 cellules de résultat (Statut → Champs)
 */
function cellulesAuditPiece_(ligne, extrait, statut) {
  var masque = estDomaineMasqueAudit_(ligne && ligne.domaine);
  var e = extrait || {};
  var tit = e.titulaire === null || e.titulaire === undefined || e.titulaire === ''
    ? '(absent)'
    : (masque ? masquerAudit_(e.titulaire) : String(e.titulaire));
  var champs = masque ? masquerChampsAudit_(e.champs) : champsEnClairAudit_(e.champs);
  // ⚠️ LE RÉSUMÉ EST LE SEUL CHAMP QUI DIT SI LE MODÈLE A COMPRIS LE DOCUMENT. Les autres
  // disent ce qu'il en a TIRÉ : on peut extraire « facture / Hydro / 2026-07-01 » d'un papier
  // qu'on a lu de travers. Marc, au premier usage : « je jugerai mieux une analyse de IA avec
  // des vraies infos ». C'est ça, l'analyse.
  // ⚠️ MASQUÉ SUR 01 ET 04, et ce n'est pas de la prudence en trop : le résumé est du texte
  // LIBRE, il peut porter le numéro que le masquage des champs vient justement de retirer.
  // L'afficher là rouvrirait par la fenêtre ce que l'arbitrage du 17/09 a fermé par la porte.
  var resume = e.resume === null || e.resume === undefined ? '' : String(e.resume);
  return [
    statut,
    e.type === null || e.type === undefined ? '' : String(e.type),
    e.emetteur === null || e.emetteur === undefined ? '' : String(e.emetteur),
    e.date_document === null || e.date_document === undefined ? '' : String(e.date_document),
    tit,
    e.titulaire_confiance === null || e.titulaire_confiance === undefined ? '' : e.titulaire_confiance,
    champs,
    masque ? (resume ? '(masqué — ouvre le document)' : '') : resume
  ];
}

/**
 * PURE. Le verdict d'ensemble, à partir de ce que MARC a écrit.
 *
 * ⚠️ « non jugé » est une catégorie à part ENTIÈRE, jamais fondue dans « faux » : un audit à
 * moitié rempli ne doit pas ressembler à un audit qui a échoué. C'est la leçon « 0/0 et 0/6 ne
 * disent pas la même chose », appliquée à un tableau de jugement.
 */
function compterVerdictsAudit_(valeurs) {
  var res = { juste: 0, partiel: 0, faux: 0, nonJuge: 0, total: 0 };
  var liste = valeurs || [];
  for (var i = 0; i < liste.length; i++) {
    res.total++;
    var v = String(liste[i] == null ? '' : liste[i]).trim().toLowerCase();
    if (v === 'juste') res.juste++;
    else if (v === 'partiel') res.partiel++;
    else if (v === 'faux') res.faux++;
    else res.nonJuge++;
  }
  return res;
}

/** PURE. La phrase du verdict — une seule écriture, pour que tous les appelants la partagent. */
function phraseVerdictAudit_(c) {
  if (!c.total) return 'Aucune ligne : lance `auditPiecesMaintenant` d\'abord.';
  var juges = c.juste + c.partiel + c.faux;
  if (!juges) {
    return c.total + ' documents extraits, AUCUN jugé — écris `juste`, `partiel` ou `faux` en '
      + 'colonne « Verdict », puis relance `verdictAuditPieces`.';
  }
  return juges + ' jugés sur ' + c.total + ' : ' + c.juste + ' justes · ' + c.partiel
    + ' partiels · ' + c.faux + ' faux' + (c.nonJuge ? ' · ' + c.nonJuge + ' non jugés' : '');
}

/* ---------- I/O ---------- */

/**
 * Compose l'échantillon s'il n'existe pas, puis extrait ce que le temps permet.
 *
 * Relançable : chaque exécution reprend à la première ligne « à faire ».
 * @return {string} ce qui s'est passé — rendu ET journalisé.
 */
function auditPiecesMaintenant() {
  var res = etapeAuditPiece_(function () { return false; }, { manuel: true, amorcer: true });
  var ligne = 'Audit pièces : ' + (res.poses ? res.poses + ' tirés · ' : '')
    + res.faits + ' extraits · ' + res.sansTexte + ' sans texte · ' + res.echecs + ' en échec · '
    + res.restants + ' restants — ' + res.fin;
  Logger.log(ligne);
  journalInfo_('AuditPiece', ligne);
  return ligne;
}

/* ---------- La passe AUTOMATIQUE : le tick finit ce que Marc a commencé ---------- */

/**
 * Consommation du budget QUOTIDIEN (ms réelles persistées `AAAA/MM/JJ|ms`). PUR sur props.
 * Même patron que `budgetJourMemoire_` — une seule forme de stockage pour tout le parc.
 */
function budgetJourAudit_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_AUDIT_PIECE_JOUR_MS') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * La GATE du tick : reste-t-il quelque chose à extraire ?
 *
 * ⚠️ Elle lit une PROPERTY, jamais la Sheet. Interroger l'onglet à chaque tick coûterait une
 * lecture Sheet toutes les 5 minutes pour apprendre, 287 fois sur 288, qu'il n'y a rien à faire —
 * et cette campagne est éteinte la quasi-totalité du temps. Le compteur est écrit par la passe
 * elle-même ; ABSENT, on laisse passer UNE fois pour qu'elle le pose (sinon un audit lancé
 * avant ce code ne repartirait jamais, ce qui est exactement le cas de Marc aujourd'hui).
 */
function resteAuditPiece_(props) {
  var brut = props.getProperty('DriveAI_AUDIT_PIECE_RESTANTS');
  if (brut === null || brut === '') return null; // « je ne sais pas » ≠ « zéro »
  return Number(brut) || 0;
}

/**
 * Le point d'entrée UNIQUE de l'audit — le tick comme la main y passent, et c'est ce qui fait
 * que les deux comptent pareil. Tous les retours passent par `noterFinAuditPiece_`.
 *
 * ⚠️ LE TICK N'AMORCE JAMAIS (`opts.amorcer` faux) : tirer un échantillon de 100 documents
 * lance une campagne LLM que personne n'a demandée. Il ne fait que TERMINER celui qui existe.
 * Composer reste un geste explicite — aujourd'hui `auditPiecesMaintenant`, demain un bouton.
 *
 * ⚠️ `opts.manuel` coupe le gate ET le comptage du budget quotidien (C28-33, la DOUBLE peine) :
 * une exécution depuis l'éditeur est hors du quota runtime des déclencheurs, l'y soumettre
 * bloquerait Marc jusqu'au lendemain sans qu'aucun quota réel ne soit en cause — et son run
 * mangerait le budget du tick.
 */
function etapeAuditPiece_(garde, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var res = { poses: 0, faits: 0, sansTexte: 0, echecs: 0, restants: 0, fin: 'vide' };

  var f = feuille_(ONGLET_AUDIT_PIECE);
  if (!f) { res.fin = 'onglet-absent'; return noterFinAuditPiece_(props, res, !!opts.manuel); }

  if (f.getLastRow() < 2) {
    if (!opts.amorcer) { res.fin = 'vide'; return noterFinAuditPiece_(props, res, !!opts.manuel); }
    res.poses = composerEchantillonAudit_(f);
    if (!res.poses) { res.fin = 'index-vide'; return noterFinAuditPiece_(props, res, !!opts.manuel); }
  }

  // ⚠️ RE-EXTRACTION one-shot, gatée par tag (patron `MIGRATION_TAG` du parc). Elle existe
  // parce qu'une extraction déjà écrite ne se répare pas en corrigeant le code qui l'écrit :
  // les 100 lignes du 17/09 portent « [object Object] » dans la colonne Champs et aucun
  // résumé, donc elles sont INJUGEABLES — et l'audit est la porte de l'ADR-0061.
  // ⚠️ Elle EFFACE les verdicts déjà posés. C'est délibéré et ce n'est pas anodin : un verdict
  // rendu sur une ligne illisible ne dit rien de l'extraction, et le garder fausserait le seul
  // chiffre que la porte mesure. Les NOTES, elles, restent — elles parlent du document.
  // ⚠️ Elle n'AMORCE toujours rien : elle re-lit un échantillon qui existe déjà.
  reparerEnTeteAudit_(f);
  if (props.getProperty('DriveAI_AUDIT_PIECE_TAG') !== CONFIG.AUDIT_PIECE_TAG) {
    var remises = reextraireAudit_(f);
    props.setProperty('DriveAI_AUDIT_PIECE_TAG', CONFIG.AUDIT_PIECE_TAG);
    journalInfo_('AuditPiece', 'Re-extraction « ' + CONFIG.AUDIT_PIECE_TAG + ' » : '
      + remises + ' ligne(s) remise(s) à faire (verdicts effacés, notes gardées).');
  }

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = opts.manuel ? 0 : budgetJourAudit_(props, aujourdhui);
  if (consommeJour >= CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS) {
    res.restants = resteAuditPiece_(props) || 0;
    res.fin = 'budget-jour';
    return noterFinAuditPiece_(props, res, !!opts.manuel);
  }

  // Le garde-temps effectif : le plus SERRÉ des trois — celui du tick (passé par l'appelant),
  // le sous-budget par run, et ce qui reste du budget du jour. Un seul d'entre eux manquant, la
  // borne qu'on croit poser est doublée en silence (leçon §9).
  var debutRun = Date.now();
  var plafondRun = opts.manuel
    ? CONFIG.BUDGET_MS
    : Math.min(CONFIG.AUDIT_PIECE_BUDGET_MS, CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS - consommeJour);
  var gardeEffective = function () {
    return garde() || (Date.now() - debutRun) > plafondRun;
  };

  var lot = extraireLotAudit_(f, gardeEffective);
  res.faits = lot.faits;
  res.sansTexte = lot.sansTexte;
  res.echecs = lot.echecs;
  res.restants = lot.restants;
  res.fin = lot.fin;

  // Le budget consommé se pose ICI, jamais avant : une passe qui n'a rien pu faire ne doit pas
  // manger la journée (patron `passeMemoire_`).
  if (!opts.manuel) {
    props.setProperty('DriveAI_AUDIT_PIECE_JOUR_MS',
      aujourdhui + '|' + (consommeJour + (Date.now() - debutRun)));
  }
  return noterFinAuditPiece_(props, res, !!opts.manuel);
}

/**
 * Répare l'en-tête d'un onglet DÉJÀ créé. `creerOnglet_` ne tourne qu'à la création : une
 * colonne ajoutée plus tard n'y arrive jamais, et la réparation posée là serait du code mort
 * (leçon §9 du parc, payée sur `HistoriqueVrac`). Elle vit donc ICI, sur le chemin qui lit
 * l'onglet à chaque passe. Idempotente : elle ne réécrit que si la ligne 1 a dérivé.
 */
function reparerEnTeteAudit_(f) {
  try {
    var n = COLONNES_AUDIT_PIECE.length;
    var actuel = f.getRange(1, 1, 1, n).getValues()[0];
    for (var i = 0; i < n; i++) {
      if (String(actuel[i] || '') !== COLONNES_AUDIT_PIECE[i]) {
        f.getRange(1, 1, 1, n).setValues([COLONNES_AUDIT_PIECE]);
        return true;
      }
    }
  } catch (e) {
    journalErreur_('AuditPiece', 'En-tête non réparé : ' + e);
  }
  return false;
}

/**
 * Remet à « à faire » toutes les lignes déjà traitées et efface leur verdict. Rend le nombre
 * de lignes remises. Les colonnes de Marc : le VERDICT part (il portait sur une extraction
 * illisible), la NOTE reste (elle parle du document, pas de ce qu'on en a lu).
 */
function reextraireAudit_(f) {
  var n = f.getLastRow() - 1;
  if (n <= 0) return 0;
  var large = COLONNES_AUDIT_PIECE.length;
  var lignes = f.getRange(2, 1, n, large).getValues();
  var remises = 0;
  for (var i = 0; i < lignes.length; i++) {
    if (!String(lignes[i][2] || '')) continue;           // ligne vide : rien à refaire
    if (String(lignes[i][4] || '') === 'à faire') continue; // déjà en attente
    var vide = [];
    for (var c = 0; c < 8; c++) vide.push('');           // Statut → Résumé
    vide[0] = 'à faire';
    f.getRange(i + 2, 5, 1, 8).setValues([vide]);
    f.getRange(i + 2, COL_VERDICT_AUDIT_PIECE, 1, 1).setValues([['']]);
    remises++;
  }
  return remises;
}

/**
 * Écrit l'état de la dernière passe — UNE seule fonction, pour qu'aucune sortie ne l'oublie.
 * C'est la leçon C28-135 : une étape qui sort sans rien dire rend « rien à faire », « jamais
 * atteinte » et « suspendue » indiscernables, et la panne se cache derrière le silence.
 *
 * ⚠️ Le compteur de RESTANTS est écrit ici, parce que c'est lui que lit la gate du tick :
 * l'étape s'éteint donc d'elle-même, sans tag, sans drapeau à poser à la main.
 */
function noterFinAuditPiece_(props, res, manuel) {
  try {
    props.setProperty('DriveAI_AUDIT_PIECE_RESTANTS', String(res.restants));
    props.setProperty('DriveAI_AUDIT_PIECE_FIN', [
      new Date().toISOString(),
      res.fin,
      res.faits + '/' + res.sansTexte + '/' + res.echecs,
      res.restants,
      manuel ? 'manuel' : 'tick'
    ].join('|'));
  } catch (e) {
    journalErreur_('AuditPiece', 'État de fin non écrit : ' + e);
  }
  return res;
}

/** PURE. Le motif de fin, en français, avec le geste qu'il appelle. */
var PHRASES_FIN_AUDIT_ = {
  'termine': 'les 100 documents sont extraits — à toi de juger',
  'garde-temps — relance pour continuer': 'coupée par le garde-temps du tick (reprend au tick suivant)',
  'budget-jour': 'budget du jour épuisé — reprise demain',
  'frein budget LLM atteint': '⚠️ frein budget LLM atteint (CONFIG.LLM_BUDGET_CAMPAGNES)',
  'panne de plateforme LLM': '⚠️ panne de plateforme LLM — re-sonde automatique',
  'vide': 'aucun échantillon en cours',
  'index-vide': 'Index vide — rien de classé à auditer',
  'onglet-absent': '⚠️ onglet AuditPieces introuvable'
};

/**
 * PURE. La ligne que Marc lit. Un « 0 restant » et un « jamais lancé » ne disent pas la même
 * chose, et cette phrase les distingue.
 */
function phraseFinAuditPiece_(brut, consommeJour, budgetJour) {
  if (!brut) return 'aucune passe enregistrée — l\'audit n\'a pas encore tourné';
  var p = String(brut).split('|');
  var fin = p[1] || '?';
  var motif = PHRASES_FIN_AUDIT_[fin] || ('sortie « ' + fin + ' »');
  var restants = Number(p[3]);
  var minutes = Math.round((consommeJour / 60000) * 10) / 10;
  var mode = (p[4] === 'manuel')
    ? ' ⚠️ passe MANUELLE (éditeur) — ne prouve PAS que le tick tourne'
    : '';
  return (isNaN(restants) ? '?' : restants) + ' restants · dernière passe : ' + (p[2] || '?') +
    ' (extraits/sans texte/échecs) — ' + motif +
    ' · ' + minutes + ' des ' + Math.round(budgetJour / 60000) + ' min/j consommées' + mode;
}

/** La ligne de Santé. Impure (Properties) ; la mise en mots est PURE et testée. */
function texteSanteAuditPiece_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return phraseFinAuditPiece_(
      props.getProperty('DriveAI_AUDIT_PIECE_FIN') || '',
      budgetJourAudit_(props, dateGmail_(new Date())),
      CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS
    );
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * Tire l'échantillon STRATIFIÉ et pose les lignes « à faire ».
 *
 * ⚠️ Déterministe à stock constant : l'Index est lu dans son ordre, et on prend les N premiers
 * de chaque domaine. Un tirage au hasard donnerait un échantillon différent à chaque reprise
 * de la composition, et « les 100 documents » cesserait de désigner quoi que ce soit.
 */
function composerEchantillonAudit_(f) {
  var idx = feuille_('Index');
  if (!idx || idx.getLastRow() < 2) return 0;

  var n = idx.getLastRow() - 1;
  var v = idx.getRange(2, 1, n, 6).getValues();

  // 1) Compter par domaine, en ne gardant que ce qui est CLASSÉ et porte un fileId.
  var parDomaine = {};
  var comptes = {};
  for (var i = 0; i < v.length; i++) {
    var statut = String(v[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;
    var fileId = fileIdDeCleIndex_(String(v[i][0] || ''));
    if (!fileId) continue;
    var dom = String(v[i][3] || '(sans domaine)');
    if (!parDomaine[dom]) { parDomaine[dom] = []; comptes[dom] = 0; }
    parDomaine[dom].push({ fileId: fileId, nom: String(v[i][2] || ''), domaine: dom });
    comptes[dom]++;
  }

  var part = repartirAudit_(comptes, CONFIG.AUDIT_PIECE_TAILLE);
  var lignes = [];
  var rang = 0;
  var domaines = [];
  for (var d in part) if (Object.prototype.hasOwnProperty.call(part, d)) domaines.push(d);
  domaines.sort();

  for (var k = 0; k < domaines.length; k++) {
    var dom2 = domaines[k];
    var docs = parDomaine[dom2] || [];
    for (var j = 0; j < part[dom2] && j < docs.length; j++) {
      rang++;
      lignes.push([
        rang, dom2, docs[j].nom, 'https://drive.google.com/file/d/' + docs[j].fileId + '/view',
        'à faire', '', '', '', '', '', '', '', ''
      ]);
    }
  }
  if (!lignes.length) return 0;
  f.getRange(2, 1, lignes.length, COLONNES_AUDIT_PIECE.length).setValues(lignes);
  return lignes.length;
}

/**
 * Extrait les lignes « à faire », dans l'ordre, tant que le temps et le budget le permettent.
 *
 * ⚠️ Le frein de campagne s'applique : un audit est une dépense LLM comme une autre, et il se
 * soumet au même plafond en dollars que le reste. Sortir sur le frein est un motif NOMMÉ —
 * sans lui, « le budget est atteint » et « il n'y avait rien à faire » auraient le même
 * symptôme, le silence, qui est la panne que ce dépôt a payée le 16/09.
 */
function extraireLotAudit_(f, garde) {
  var res = { faits: 0, sansTexte: 0, echecs: 0, restants: 0, fin: 'termine' };
  var n = f.getLastRow() - 1;
  if (n <= 0) return res;

  var lignes = f.getRange(2, 1, n, COLONNES_AUDIT_PIECE.length).getValues();
  for (var i = 0; i < lignes.length; i++) {
    if (String(lignes[i][4] || '') !== 'à faire') continue;

    if (garde()) { res.fin = 'garde-temps — relance pour continuer'; break; }
    if (budgetCampagnesAtteint_()) { res.fin = 'frein budget LLM atteint'; break; }
    if (estPannePlateforme_()) { res.fin = 'panne de plateforme LLM'; break; }

    var cellules = auditerUnDocumentAudit_({
      lien: String(lignes[i][3] || ''),
      nom: String(lignes[i][2] || ''),
      domaine: String(lignes[i][1] || '')
    });
    f.getRange(i + 2, 5, 1, 8).setValues([cellules]);
    if (cellules[0] === 'extrait') res.faits++;
    else if (cellules[0] === 'sans texte') res.sansTexte++;
    else res.echecs++;
  }

  for (var j = 0; j < lignes.length; j++) {
    if (String(lignes[j][4] || '') === 'à faire') res.restants++;
  }
  res.restants -= (res.faits + res.sansTexte + res.echecs);
  if (res.restants < 0) res.restants = 0;
  return res;
}

/**
 * Lit UN document et rend ses cellules. Le texte OCR ne sort pas d'ici — il n'est ni écrit,
 * ni rendu, ni journalisé (`CLAUDE.md` §9 : jamais le corps d'un document dans un état).
 */
function auditerUnDocumentAudit_(ligne) {
  var fileId = (String(ligne.lien || '').match(/\/d\/([A-Za-z0-9_-]{20,})/) || [])[1];
  if (!fileId) return cellulesAuditPiece_(ligne, null, 'échec');

  var blob;
  try {
    var fichier = DriveApp.getFileById(fileId);
    if (fichier.getSize() > CONFIG.OCR_TAILLE_MAX) return cellulesAuditPiece_(ligne, null, 'sans texte');
    blob = fichier.getBlob();
  } catch (e) {
    journalErreur_('AuditPiece', 'Lecture impossible : ' + e);
    return cellulesAuditPiece_(ligne, null, 'échec');
  }

  var texte = extraireTexte_(blob);
  if (texte === null) return cellulesAuditPiece_(ligne, null, 'échec');
  if (!String(texte).trim()) return cellulesAuditPiece_(ligne, null, 'sans texte');

  var extrait = extrairePiece_({ nomFichier: ligne.nom, extrait: texte });
  return extrait
    ? cellulesAuditPiece_(ligne, extrait, 'extrait')
    : cellulesAuditPiece_(ligne, null, 'échec');
}

/**
 * Le VERDICT — ce que Marc a jugé, compté. C'est lui qui répond à la porte de l'ADR-0061.
 * À lancer quand la colonne « Verdict » est remplie.
 */
function verdictAuditPieces() {
  var f = feuille_(ONGLET_AUDIT_PIECE);
  if (!f || f.getLastRow() < 2) return phraseVerdictAudit_(compterVerdictsAudit_([]));
  var n = f.getLastRow() - 1;
  var statuts = f.getRange(2, 5, n, 1).getValues();
  var verdicts = f.getRange(2, COL_VERDICT_AUDIT_PIECE, n, 1).getValues();
  var juges = [];
  for (var i = 0; i < n; i++) {
    // Seules les lignes EXTRAITES se jugent : une ligne « à faire » non remplie n'est pas un
    // document mal lu, c'est un document pas encore lu.
    if (String(statuts[i][0] || '') === 'extrait') juges.push(verdicts[i][0]);
  }
  var ligne = phraseVerdictAudit_(compterVerdictsAudit_(juges));
  Logger.log(ligne);
  return ligne;
}

/**
 * Efface le rapport. Livré DANS LE MÊME GESTE que ce qui l'écrit : l'onglet porte des valeurs
 * extraites de vrais papiers, et un rapport qu'on ne peut pas effacer devient un stock.
 */
function viderAuditPieces() {
  var f = feuille_(ONGLET_AUDIT_PIECE);
  if (!f || f.getLastRow() < 2) return 'Rien à effacer.';
  var n = f.getLastRow() - 1;
  f.getRange(2, 1, n, COLONNES_AUDIT_PIECE.length).clearContent();
  var ligne = 'Audit pièces : ' + n + ' ligne(s) effacée(s).';
  Logger.log(ligne);
  return ligne;
}
