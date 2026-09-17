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
  'Type', 'Émetteur', 'Date doc', 'Titulaire', 'Confiance', 'Champs',
  'Verdict (à toi)', 'Note (à toi)'
];

/**
 * Les domaines dont les valeurs NOMINATIVES sont masquées (arbitrage de Marc, 17/09).
 * Reconnus par leur PRÉFIXE numéroté : le libellé complet peut être renommé
 * (`assurerNomsDomaines_` le fait), le numéro non.
 */
var PREFIXES_DOMAINE_MASQUE_AUDIT = ['01', '04'];

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

/** PURE. L'objet des champs structurés, masqué CLÉ PAR CLÉ — les clés, elles, sont le sujet. */
function masquerChampsAudit_(champs) {
  if (!champs || typeof champs !== 'object') return '(absent)';
  var out = [];
  for (var k in champs) {
    if (!Object.prototype.hasOwnProperty.call(champs, k)) continue;
    out.push(k + ' : ' + masquerAudit_(champs[k]));
  }
  return out.length ? out.join(' · ') : '(aucun)';
}

/** PURE. Les champs structurés en clair, lisibles à l'œil. */
function champsEnClairAudit_(champs) {
  if (!champs || typeof champs !== 'object') return '';
  var out = [];
  for (var k in champs) {
    if (!Object.prototype.hasOwnProperty.call(champs, k)) continue;
    var v = champs[k];
    if (v === null || v === undefined || v === '') continue;
    out.push(k + ' : ' + String(v));
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
  return [
    statut,
    e.type === null || e.type === undefined ? '' : String(e.type),
    e.emetteur === null || e.emetteur === undefined ? '' : String(e.emetteur),
    e.date_document === null || e.date_document === undefined ? '' : String(e.date_document),
    tit,
    e.titulaire_confiance === null || e.titulaire_confiance === undefined ? '' : e.titulaire_confiance,
    champs
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
  var debut = Date.now();
  var f = feuille_(ONGLET_AUDIT_PIECE);
  if (!f) return 'Onglet ' + ONGLET_AUDIT_PIECE + ' introuvable (initialiserSheet_ ne l\'a pas créé).';

  var poses = 0;
  if (f.getLastRow() < 2) {
    poses = composerEchantillonAudit_(f);
    if (!poses) return 'Aucun document classé à auditer — l\'Index est vide ou rien n\'est classé.';
  }

  var res = extraireLotAudit_(f, function () { return (Date.now() - debut) > CONFIG.BUDGET_MS; });
  var ligne = 'Audit pièces : ' + (poses ? poses + ' tirés · ' : '')
    + res.faits + ' extraits · ' + res.sansTexte + ' sans texte · ' + res.echecs + ' en échec · '
    + res.restants + ' restants — ' + res.fin;
  Logger.log(ligne);
  journalInfo_('AuditPiece', ligne);
  return ligne;
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
    f.getRange(i + 2, 5, 1, 7).setValues([cellules]);
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
  var verdicts = f.getRange(2, 12, n, 1).getValues();
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
