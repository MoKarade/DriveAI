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
  creerOnglet_(ss, 'Échecs', ['Clé', 'Tentatives', 'Dernière tentative']); // compteur de quarantaine
  creerOnglet_(ss, 'Progression', ['Rangement de l\'ancien Drive']);        // barre de chargement (cf. Maintenance)
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
//  _echecsCache      : clé → { tentatives, ligne } (compteur de quarantaine)
var _indexCache = null;
var _empreintesCache = null;
var _echecsCache = null;

/** À appeler en tête de chaque run pour repartir de caches neufs. */
function reinitialiserIndexCache_() {
  _indexCache = null;
  _empreintesCache = null;
  _echecsCache = null;
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
 * Enregistre un fichier traité. L'inscription Index (« c'est fini ») est écrite en DERNIER :
 * si une coupure survient avant, la PJ reste non-indexée donc re-traitée (jamais perdue).
 * (Le statut 'revue' n'est plus produit par le pipeline depuis 2026-07-01 — la branche Revue
 * ci-dessous ne sert que d'éventuelle compat de lignes historiques.)
 * @param {string} cle
 * @param {{statut:string, domaine:string, chemin:string, nom:string}} resultat
 * @param {string} [empreinte]  empreinte MD5 du contenu (détection de doublons)
 */
function indexAjouter_(cle, resultat, empreinte) {
  if (resultat.statut === 'revue') { // vestigial : le pipeline ne route plus en revue
    feuille_('Revue').appendRow([new Date(), resultat.nom, resultat.domaine || '', resultat.nom]);
  }
  feuille_('Index').appendRow([
    cle, new Date(), resultat.nom, resultat.domaine || '', resultat.chemin || '',
    resultat.statut, empreinte || ''
  ]);
  if (_indexCache !== null) _indexCache[cle] = true;
  if (_empreintesCache !== null && empreinte) _empreintesCache[empreinte] = true;
}

/* ---------- Quarantaine (compteur d'échecs) ---------- */

/** Charge l'onglet « Échecs » en cache (clé → {tentatives, ligne}) — 1× par run. */
function chargerEchecsCache_() {
  _echecsCache = {};
  var f = feuille_('Échecs');
  var dern = f.getLastRow();
  if (dern < 2) return;
  var v = f.getRange(2, 1, dern - 1, 2).getValues(); // A=Clé, B=Tentatives
  for (var i = 0; i < v.length; i++) {
    if (v[i][0]) _echecsCache[v[i][0]] = { tentatives: Number(v[i][1]) || 0, ligne: i + 2 };
  }
}

/**
 * Incrémente le compteur d'échecs d'une clé et renvoie le nouveau total. Crée la ligne si absente.
 * @param {string} cle
 * @return {number} nombre de tentatives échouées (incluant celle-ci).
 */
function incrementerEchec_(cle) {
  if (_echecsCache === null) chargerEchecsCache_();
  var f = feuille_('Échecs');
  var e = _echecsCache[cle];
  if (e) {
    e.tentatives += 1;
    f.getRange(e.ligne, 2, 1, 2).setValues([[e.tentatives, new Date()]]);
    return e.tentatives;
  }
  f.appendRow([cle, 1, new Date()]);
  _echecsCache[cle] = { tentatives: 1, ligne: f.getLastRow() };
  return 1;
}
// (Pas d'effacement sur succès : un doc qui réussit est inscrit à l'Index avec un statut
//  terminal → jamais re-traité, donc son compteur d'échecs devient mort. On évite ainsi de
//  charger l'onglet « Échecs » sur le chemin nominal — il n'est touché que lors d'un échec.)
