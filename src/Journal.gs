/**
 * Journal.gs — État dans la Google Sheet + notifications d'échec.
 *
 * Onglets : Entités | Corrections | Index | Journal | Échecs | Santé | Progression (créés au premier run).
 * - Index   : catalogue des fichiers traités (sert l'idempotence + la recherche Phase 4).
 * - Journal : log d'exécution + erreurs.
 * Une erreur déclenche TOUJOURS une notif mail immédiate + une ligne de Journal.
 */

/** Crée les onglets et leurs en-têtes si absents. */
function initialiserSheet_(ss) {
  creerOnglet_(ss, 'Entités', COLONNES_ENTITES); // cf. COLONNES_ENTITES (9 colonnes, dont Variante possible ? et Vu N fois)
  creerOnglet_(ss, 'Corrections', COLONNES_CORRECTIONS); // apprentissage : doc corrigé → exemples few-shot (ADR-0003)
  creerOnglet_(ss, 'Index', ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance']);
  // #17 : la Sheet existante n'a pas l'en-tête H — réparé ici (initialiserSheet_ ne tourne que
  // quand un onglet manque : coût nul en régime normal).
  var fIndex = ss.getSheetByName('Index');
  if (fIndex && String(fIndex.getRange('H1').getValue()) === '') fIndex.getRange('H1').setValue('Confiance');
  creerOnglet_(ss, 'Journal', ['Horodatage', 'Niveau', 'Source', 'Message']);
  creerOnglet_(ss, 'Échecs', ['Clé', 'Tentatives', 'Dernière tentative']); // compteur de quarantaine
  creerOnglet_(ss, 'Relances', ['Clé', 'Demandé le']); // demandes de relance de quarantaine (app web, ADR-0011)
  creerOnglet_(ss, 'TriAppris', ['Adresse', 'Libellé', 'Appris le']); // table adresse→libellé du tri Gmail (#16)
  creerOnglet_(ss, 'Réglages', ['Clé', 'Valeur']); // réglages modifiables depuis l'app (#22)
  // Seed du réglage #22 (position FIXE : A2/B2 — contrat avec l'app) — seulement si absent.
  var fReg = ss.getSheetByName('Réglages');
  if (fReg && String(fReg.getRange('A2').getValue()) === '') {
    fReg.getRange('A2:B2').setValues([['TICK_MINUTES', CONFIG.TICK_MINUTES]]);
  }
  creerOnglet_(ss, 'Progression', ['Rangement de l\'ancien Drive']);        // barre de chargement (cf. Maintenance)
  creerOnglet_(ss, 'Santé', ['Santé DriveAI']);                             // vue lisible (heartbeat + métriques, ADR-0006)
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

/* ---------- Journal borné + onglet Santé (ADR-0006) ---------- */

/**
 * Nombre de lignes de données les plus VIEILLES à supprimer du Journal pour le borner.
 * Logique PURE (testée) : ne déclenche la rotation qu'au-delà de `max + marge` (purge en lot,
 * pas ligne-à-ligne à chaque tick), puis ramène à exactement `max`. En-tête (ligne 1) hors compte.
 * @param {number} dernLigne  résultat de getLastRow() (en-tête inclus)
 * @param {number} max        nb de lignes de données à conserver
 * @param {number} marge      hystérésis : on ne purge que si données > max + marge
 * @return {number} nb de lignes à supprimer à partir de la ligne 2 (0 = rien à faire)
 */
function lignesJournalASupprimer_(dernLigne, max, marge) {
  var donnees = Math.max(0, (dernLigne || 0) - 1); // hors en-tête
  if (donnees <= max + marge) return 0;            // sous le seuil de déclenchement
  return donnees - max;                            // ramène à `max`
}

/**
 * Borne le Journal : supprime en LOT les lignes de log les plus anciennes au-delà du plafond
 * (rotation d'historique — jamais de documents, §2 intact). Enveloppé par l'appelant (secondaire :
 * ne doit jamais bloquer l'intake). Cheap : la plupart des ticks ne font qu'un getLastRow().
 */
function bornerJournal_() {
  var f = feuille_('Journal');
  var aSupprimer = lignesJournalASupprimer_(f.getLastRow(), CONFIG.JOURNAL_MAX_LIGNES, CONFIG.JOURNAL_MARGE);
  if (aSupprimer > 0) {
    f.deleteRows(2, aSupprimer); // supprime les plus vieilles, juste après l'en-tête
    journalInfo_('Santé', 'Journal borné : ' + aSupprimer + ' vieille(s) ligne(s) purgée(s) (max ' + CONFIG.JOURNAL_MAX_LIGNES + ').');
  }
}

/**
 * Met à jour l'onglet `Santé` — vue lisible de référence (heartbeat + métriques). Métadonnées
 * seulement (ADR-0007) : horodatage, compteurs, coût, statut — jamais de contenu de document.
 * Écrit après `flushUsage_` (le coût du mois inclut alors le run courant). Enveloppé par l'appelant.
 */
function majSante_() {
  var f = feuille_('Santé');
  var tz = Session.getScriptTimeZone();
  var cout = syntheseCoutMois_();
  var mois = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var nbCatalogue = _indexCache ? Object.keys(_indexCache).length : '—';
  var rangement = (typeof rangementTermine_ === 'function' && rangementTermine_()) ? 'terminé ✅' : 'en cours';
  var lignes = [
    ['Dernier passage OK : ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')],
    ['Documents au catalogue (Index) : ' + nbCatalogue],
    ['Coût LLM ' + mois + ' : ' + cout.dollars.toFixed(2) + ' $  (' + cout.appels + ' appels)  ·  cible < 10 $/mois' + (cout.dollars >= 10 ? '  ⚠️ DÉPASSÉE' : '  ✅')],
    ['Rangement ancien Drive : ' + rangement],
    ['Mis à jour : ' + new Date()]
  ];
  f.getRange(2, 1, lignes.length, 1).setValues(lignes); // une seule écriture Sheet (I/O borné/tick)
}

/**
 * Échec : ligne d'erreur + notif mail immédiate à soi-même.
 * @param {string} source
 * @param {string} message
 */
function notifierEchec_(source, message) {
  // Décision Marc 2026-07-06 (calibrage) : AUCUN mail d'alerte immédiat — tout se découvre au
  // résumé hebdo (compteur d'erreurs + quarantaines ; la liste vit dans l'app avec « Relancer »).
  // L'auto-réparation du chien de garde reste entièrement active ; seul le MAIL disparaît.
  // (Revenir en arrière = restaurer l'envoi via emailAlerte_ ici et dans alerterChienDeGarde_.)
  journalErreur_(source, message);
}

/**
 * Destinataire des alertes et mails du moteur — check-up 2026-07-03 : `Session.getEffectiveUser()`
 * exige un scope (userinfo.email) ABSENT du manifeste → l'appel LÈVE et toutes les alertes
 * échouaient en silence depuis le début (597 tentatives mortes constatées, résumé hebdo compris).
 * On n'ajoute PAS le scope (leçon durable : tout nouveau scope FIGE les déclencheurs jusqu'à
 * ré-autorisation manuelle de Marc) : l'adresse vit dans la Script Property `DriveAI_EMAIL`
 * (posée une fois, comme la clé API), avec repli best-effort sur Session au cas où le scope
 * existerait un jour. Ne lève JAMAIS.
 * @return {string} adresse mail, ou '' si indisponible (l'appelant journalise sans envoyer).
 */
function emailAlerte_() {
  var e = '';
  try { e = PropertiesService.getScriptProperties().getProperty('DriveAI_EMAIL') || ''; } catch (err) { }
  if (e) return e;
  try { return Session.getEffectiveUser().getEmail(); } catch (err) { return ''; }
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
  feuille_('Index').appendRow([
    cle, new Date(), resultat.nom, resultat.domaine || '', resultat.chemin || '',
    resultat.statut, empreinte || '',
    // #17 (App v3 « Documents ») : confiance du classement — vide pour tout ce qui n'est pas
    // une classification LLM (mails, doublons, quarantaine…).
    resultat.confiance != null && resultat.confiance !== '' ? resultat.confiance : ''
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
