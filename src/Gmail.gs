/**
 * Gmail.gs — Lecture SEULE de Gmail.
 *
 * Scope : gmail.readonly uniquement. Aucune écriture (pas de label) : l'idempotence
 * est portée par l'Index (voir Journal.gs). On pagine la fenêtre 30 jours pour ne
 * pas affamer les anciens fils quand le volume dépasse une page.
 */

/* ---------- C28-15 : panne de QUOTA Gmail journalier (suspension persistée, patron R2) ---------- */

// Le quota d'APPELS Gmail est JOURNALIER et PARTAGÉ par tous les scans (vivant, tri, intentions,
// campagnes). Épuisé, chaque tentative répond « Service invoked too many times for one day:
// gmail. » — re-scanner ne produit RIEN et gaspille du runtime (vécu 10/07 : 267 lignes d'erreur
// en une matinée). Même patron éprouvé que la panne de compte LLM (R2) : détecter → suspendre
// (Property persistée) → re-sonder après CONFIG.GMAIL_QUOTA_RESONDE_MS. La suspension ne touche
// QUE Gmail : le Drive (dépôts, campagnes de re-analyse) garde tout le runtime libéré.
var _panneGmailCeRun = false;
var _retablissementGmailVerifie = false;

/** Chargé 1×/run par le tick : la suspension persistée (< re-sonde) vaut pour tout le run. */
function chargerPanneGmail_() {
  _panneGmailCeRun = false;
  _retablissementGmailVerifie = false;
  var t = 0;
  try { t = Number(PropertiesService.getScriptProperties().getProperty('DriveAI_GMAIL_QUOTA')) || 0; }
  catch (e) { }
  if (t && Date.now() - t < CONFIG.GMAIL_QUOTA_RESONDE_MS) _panneGmailCeRun = true;
}

/** Vrai si les scans Gmail sont suspendus pour ce run (quota épuisé, re-sonde pas encore due). */
function estPanneGmail_() {
  return _panneGmailCeRun;
}

/**
 * À appeler EN PREMIER dans tout catch autour d'un appel Gmail : reconnaît l'erreur de quota
 * journalier, pose la suspension persistée (une seule ligne de Journal par épuisement) et
 * retourne true — l'appelant doit alors sortir sans compter d'échec (panne de PLATEFORME,
 * jamais imputée à un fil). Toute autre erreur → false (le traitement d'erreur normal s'applique).
 * @param {*} e
 * @return {boolean}
 */
function signalerPanneGmail_(e) {
  var m = String(e).toLowerCase();
  if (m.indexOf('too many times') === -1 || m.indexOf('gmail') === -1) return false;
  if (!_panneGmailCeRun) {
    journalErreur_('Gmail', 'QUOTA GMAIL ÉPUISÉ — scans Gmail suspendus pour protéger le reste du ' +
      'run (reprise auto dans ≤ ' + Math.round(CONFIG.GMAIL_QUOTA_RESONDE_MS / 3600000) + ' h).');
    try { PropertiesService.getScriptProperties().setProperty('DriveAI_GMAIL_QUOTA', String(Date.now())); }
    catch (e2) { /* Property indisponible : la suspension mémoire couvre au moins ce run */ }
  }
  _panneGmailCeRun = true;
  return true;
}

/**
 * Premier appel Gmail RÉUSSI du run : efface la suspension persistée si elle existait (re-sonde
 * concluante) et le journalise. Mémoïsé : au plus 1 lecture de Property par run.
 */
function signalerRetablissementGmail_() {
  if (_panneGmailCeRun || _retablissementGmailVerifie) return;
  _retablissementGmailVerifie = true;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('DriveAI_GMAIL_QUOTA')) {
      props.deleteProperty('DriveAI_GMAIL_QUOTA');
      journalInfo_('Gmail', 'Quota Gmail RÉTABLI — reprise normale des scans.');
    }
  } catch (e) { }
}

/**
 * Une page de fils Gmail avec PJ, récents.
 * @param {number} debut  offset de pagination
 * @return {GmailThread[]}
 */
function pageFils_(debut) {
  return GmailApp.search(CONFIG.GMAIL_REQUETE, debut, CONFIG.PAGE_FILS);
}

/**
 * Pièces jointes « réelles » d'un message (hors images inline).
 * @param {GmailMessage} message
 * @return {GmailAttachment[]}
 */
function piecesJointes_(message) {
  return message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true
  });
}

/**
 * Une page de fils Gmail récents, TOUS (Phase 3 — détection d'actions/rdv), pas seulement
 * ceux avec PJ. Requête séparée de `pageFils_` (PJ) : même fenêtre 30 jours, même lecture seule.
 * @param {number} debut  offset de pagination
 * @return {GmailThread[]}
 */
function pageFilsActions_(debut) {
  return GmailApp.search(CONFIG.GMAIL_REQUETE_ACTIONS, debut, CONFIG.PAGE_FILS_ACTIONS);
}

/* ---------- Chantier #12 (ADR-0010 §1) : historique sur ANCRE FIXE + offset ---------- */

/**
 * Formate une date en `yyyy/MM/dd` pour l'opérateur Gmail `before:`. PUR.
 * @param {Date} d
 * @return {string}
 */
function dateGmail_(d) {
  var m = d.getMonth() + 1, j = d.getDate();
  return d.getFullYear() + '/' + (m < 10 ? '0' + m : m) + '/' + (j < 10 ? '0' + j : j);
}

/**
 * Requête de la campagne historique. L'ANCRE est FIXE (posée une fois) : l'APPARTENANCE à
 * l'ensemble `has:attachment before:<ancre>` est stable (le passé ne reçoit pas de nouveaux
 * mails) — c'est ce qui rend la pagination par OFFSET sûre, contrairement au scan vivant (leçon
 * « pagination mouvante » : le piège était l'insertion en TÊTE, impossible sur le passé).
 * ATTENTION (contre-vérification) : l'ORDRE, lui, n'est PAS immuable — Gmail trie les fils par
 * DERNIER message, donc un fil ravivé se téléporte en tête (et s'il est ravivé par un message
 * SANS PJ, le scan vivant ne le voit pas : `has:attachment newer_than:30d` matche PAR MESSAGE) ;
 * une suppression fait glisser les fils d'un cran. La complétude n'est donc PAS garantie par
 * l'offset seul : c'est la PASSE DE VÉRIFICATION de `traiterGmailHistorique_` qui la porte
 * (« terminé » seulement quand une passe complète ne collecte plus rien). PUR.
 * @param {string} ancre  `yyyy/MM/dd`
 * @return {string}
 */
function requeteHisto_(ancre) {
  return CONFIG.GMAIL_REQUETE_HISTO_BASE + ' before:' + ancre;
}

/**
 * Une page de fils AVEC PJ antérieurs à l'ancre, à partir d'un offset persistant.
 * @param {string} ancre   `yyyy/MM/dd`
 * @param {number} offset
 * @return {GmailThread[]}
 */
function pageFilsHisto_(ancre, offset) {
  return GmailApp.search(requeteHisto_(ancre), offset, CONFIG.GMAIL_HISTO_PAGE_FILS);
}
