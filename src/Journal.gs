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
  creerOnglet_(ss, 'Entités', COLONNES_ENTITES); // Entité|Domaine|Catégorie|Type|Statut|Dossier ID|Ajoutée le
  creerOnglet_(ss, 'Index', ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte']);
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

// Caches chargés une fois par run (évite une lecture Sheet par PJ) :
//  _indexCache       : clés d'idempotence déjà traitées
//  _empreintesCache  : empreintes de contenu déjà vues (détection de doublons)
var _indexCache = null;
var _empreintesCache = null;

/** À appeler en tête de chaque run pour repartir de caches neufs. */
function reinitialiserIndexCache_() {
  _indexCache = null;
  _empreintesCache = null;
}

function chargerIndexCache_() {
  _indexCache = {};
  _empreintesCache = {};
  var f = feuille_('Index');
  // Auto-réparation : assure la colonne « Empreinte » (G) sur un Index existant.
  if (f.getRange(1, 7).getValue() !== 'Empreinte') f.getRange(1, 7).setValue('Empreinte');

  var dern = f.getLastRow();
  if (dern < 2) return;
  var valeurs = f.getRange(2, 1, dern - 1, 7).getValues(); // colonnes A..G
  for (var i = 0; i < valeurs.length; i++) {
    if (valeurs[i][0]) _indexCache[valeurs[i][0]] = true;
    if (valeurs[i][6]) _empreintesCache[valeurs[i][6]] = true;
  }
}

/** @return {boolean} vrai si la clé est déjà dans l'Index. */
function indexContient_(cle) {
  if (_indexCache === null) chargerIndexCache_();
  return _indexCache[cle] === true;
}

/** @return {boolean} vrai si cette empreinte de contenu a déjà été vue (doublon). */
function estDoublon_(empreinte) {
  if (_empreintesCache === null) chargerIndexCache_();
  return _empreintesCache[empreinte] === true;
}

/**
 * Enregistre un fichier traité. La ligne Revue est écrite AVANT la ligne Index :
 * si une coupure survient entre les deux, la PJ reste non-indexée donc re-traitée
 * (jamais un cas sensible perdu silencieusement).
 * @param {string} cle
 * @param {{statut:string, domaine:string, chemin:string, nom:string}} resultat
 * @param {string} [empreinte]  empreinte MD5 du contenu (détection de doublons)
 */
function indexAjouter_(cle, resultat, empreinte) {
  if (resultat.statut === 'revue') {
    feuille_('Revue').appendRow([new Date(), resultat.nom, resultat.domaine || '', resultat.nom]);
  }
  feuille_('Index').appendRow([
    cle, new Date(), resultat.nom, resultat.domaine || '', resultat.chemin || '',
    resultat.statut, empreinte || ''
  ]);
  if (_indexCache !== null) _indexCache[cle] = true;
  if (_empreintesCache !== null && empreinte) _empreintesCache[empreinte] = true;
}
