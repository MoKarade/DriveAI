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
