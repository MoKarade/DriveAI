/**
 * Gmail.gs — Lecture SEULE de Gmail.
 *
 * Scope : gmail.readonly uniquement. Aucune écriture (pas de label) : l'idempotence
 * est portée par l'Index (voir Journal.gs). On pagine la fenêtre 30 jours pour ne
 * pas affamer les anciens fils quand le volume dépasse une page.
 */

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

/* ---------- Chantier #12 (ADR-0010 §1) : scan ANCRÉ rétrograde de l'historique ---------- */

/**
 * Formate une date en `yyyy/MM/dd` pour l'opérateur Gmail `before:` (exclusif). PUR.
 * @param {Date} d
 * @return {string}
 */
function dateGmail_(d) {
  var m = d.getMonth() + 1, j = d.getDate();
  return d.getFullYear() + '/' + (m < 10 ? '0' + m : m) + '/' + (j < 10 ? '0' + j : j);
}

/**
 * Requête de la tranche historique courante. PUR.
 * @param {string} curseur  `yyyy/MM/dd` (borne EXCLUSIVE)
 * @return {string}
 */
function requeteHisto_(curseur) {
  return CONFIG.GMAIL_REQUETE_HISTO_BASE + ' before:' + curseur;
}

/**
 * Prochain curseur après une page : le JOUR de la plus ANCIENNE date vue + 1 jour — `before:` étant
 * exclusif, la tranche suivante RE-couvre ce jour entier (aucun trou possible si la page s'est arrêtée
 * au milieu d'un jour chargé) ; l'idempotence de l'Index rend la re-couverture gratuite. Le curseur ne
 * va que dans UN sens (vers le passé) : jamais de plateau (leçon durable). PUR.
 * @param {Date[]} datesVues  dates des messages traités dans la page (non vide)
 * @return {string} `yyyy/MM/dd`
 */
function curseurSuivantHisto_(datesVues) {
  var plusAncienne = datesVues[0];
  for (var i = 1; i < datesVues.length; i++) {
    if (datesVues[i] < plusAncienne) plusAncienne = datesVues[i];
  }
  var lendemain = new Date(plusAncienne.getFullYear(), plusAncienne.getMonth(), plusAncienne.getDate() + 1);
  return dateGmail_(lendemain);
}

/**
 * Une page de fils AVEC PJ antérieurs au curseur (tri Gmail : du plus récent au plus ancien).
 * @param {string} curseur  `yyyy/MM/dd`
 * @return {GmailThread[]}
 */
function pageFilsHisto_(curseur) {
  return GmailApp.search(requeteHisto_(curseur), 0, CONFIG.GMAIL_HISTO_PAGE_FILS);
}
