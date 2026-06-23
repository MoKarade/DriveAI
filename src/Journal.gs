/**
 * Journal.gs — État dans la Google Sheet + notifications d'échec.
 *
 * Onglets : Entités | Index | Journal | Revue (créés au premier run).
 * - Index   : catalogue des fichiers traités (sert l'idempotence + la recherche Phase 4).
 * - Journal : log d'exécution + erreurs.
 * Une erreur déclenche TOUJOURS une notif mail immédiate + une ligne de Journal.
 */

/** Crée les onglets et leurs en-têtes si absents. */
function initialiserSheet_(ss) {
  creerOnglet_(ss, 'Entités', ['Entité', 'Domaine', 'Catégorie', 'Dossier ID', 'Ajoutée le']);
  creerOnglet_(ss, 'Index', ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut']);
  creerOnglet_(ss, 'Journal', ['Horodatage', 'Niveau', 'Source', 'Message']);
  creerOnglet_(ss, 'Revue', ['Détectée le', 'Fichier', 'Domaine', 'Suggestion']);
  var defaut = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (defaut && ss.getSheets().length > 1) ss.deleteSheet(defaut);
}

function creerOnglet_(ss, nom, entetes) {
  var f = ss.getSheetByName(nom);
  if (!f) {
    f = ss.insertSheet(nom);
    f.appendRow(entetes);
    f.setFrozenRows(1);
  }
}

function feuille_(nom) {
  var ss = getSheetEtat_();
  return ss.getSheetByName(nom) || (initialiserSheet_(ss), ss.getSheetByName(nom));
}

/* ---------- Journal ---------- */

function journalInfo_(source, message) {
  feuille_('Journal').appendRow([new Date(), 'INFO', source, message]);
}

function journalErreur_(source, message) {
  feuille_('Journal').appendRow([new Date(), 'ERREUR', source, message]);
}

/**
 * Échec : ligne d'erreur + notif mail immédiate à soi-même.
 * @param {string} source
 * @param {string} message
 */
function notifierEchec_(source, message) {
  journalErreur_(source, message);
  try {
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      '[DriveAI] Échec — ' + source,
      'DriveAI a rencontré une erreur.\n\nSource : ' + source + '\nDétail : ' + message
    );
  } catch (e) {
    journalErreur_('Notif', 'Envoi du mail d\'échec impossible : ' + e);
  }
}

/* ---------- Index (idempotence) ---------- */

/**
 * Clé stable d'une pièce jointe. Inclut l'index de PJ pour distinguer deux PJ
 * jumelles (même nom + même taille) dans un même message.
 * @param {GmailMessage} message
 * @param {number} indexPj
 * @param {GmailAttachment} pj
 * @return {string}
 */
function cleAttachement_(message, indexPj, pj) {
  return message.getId() + '|' + indexPj + '|' + pj.getName() + '|' + pj.getSize();
}

// Cache des clés déjà indexées, chargé une fois par run (évite une lecture Sheet par PJ).
var _indexCache = null;

/** À appeler en tête de chaque run pour repartir d'un cache neuf. */
function reinitialiserIndexCache_() {
  _indexCache = null;
}

function chargerIndexCache_() {
  _indexCache = {};
  var valeurs = feuille_('Index').getRange('A2:A').getValues();
  for (var i = 0; i < valeurs.length; i++) {
    if (valeurs[i][0]) _indexCache[valeurs[i][0]] = true;
  }
}

/** @return {boolean} vrai si la clé est déjà dans l'Index. */
function indexContient_(cle) {
  if (_indexCache === null) chargerIndexCache_();
  return _indexCache[cle] === true;
}

/**
 * Enregistre un fichier traité. La ligne Revue est écrite AVANT la ligne Index :
 * si une coupure survient entre les deux, la PJ reste non-indexée donc re-traitée
 * (jamais un cas sensible perdu silencieusement).
 * @param {string} cle
 * @param {{statut:string, domaine:string, chemin:string, nom:string}} resultat
 */
function indexAjouter_(cle, resultat) {
  if (resultat.statut === 'revue') {
    feuille_('Revue').appendRow([new Date(), resultat.nom, resultat.domaine || '', resultat.nom]);
  }
  feuille_('Index').appendRow([
    cle, new Date(), resultat.nom, resultat.domaine || '', resultat.chemin || '', resultat.statut
  ]);
  if (_indexCache !== null) _indexCache[cle] = true;
}
