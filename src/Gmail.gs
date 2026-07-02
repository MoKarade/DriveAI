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
