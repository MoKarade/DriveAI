/**
 * Maintenance.gs — Utilitaires à exécuter À LA MAIN (pas dans le pipeline auto).
 *
 * Ces fonctions ne sont jamais appelées par le trigger : elles servent aux
 * opérations ponctuelles de maintenance (ex. rejouer la file de revue après un
 * recalibrage du classement).
 */

/**
 * Rejoue les documents partis en revue avec les réglages COURANTS.
 *
 * À lancer une seule fois (clic « Exécuter ») après un recalibrage. Concrètement :
 *   1. met à la corbeille NOS copies « [REVUE] … » du dossier 00·À vérifier —
 *      leurs ORIGINAUX restent intacts dans Gmail, donc aucune perte ;
 *   2. vide les onglets Index et Revue (garde les en-têtes) ;
 *   3. relance le pipeline, qui re-traite les PJ Gmail (re-classées proprement).
 *
 * Garde-fou : suppression manuelle, réversible (corbeille), limitée à nos propres
 * fichiers préfixés « [REVUE] ». Le pipeline automatique, lui, ne supprime jamais
 * de fichier utilisateur.
 */
function rejouerLaRevue() {
  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER);
  var it = dossier.getFiles();
  var n = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('[REVUE]') === 0) {
      f.setTrashed(true); // corbeille (réversible) — copie créée par nous, original dans Gmail
      n++;
    }
  }
  journalInfo_('Maintenance', n + ' copie(s) « [REVUE] » mises à la corbeille.');

  viderOnglet_('Index');
  viderOnglet_('Revue');
  journalInfo_('Maintenance', 'Index et Revue vidés — rejeu du pipeline.');

  tickDriveAI();
}

/**
 * Vide les lignes de données d'un onglet (conserve la ligne d'en-tête).
 * @param {string} nom
 */
function viderOnglet_(nom) {
  var f = feuille_(nom);
  var dernLigne = f.getLastRow();
  var dernCol = f.getLastColumn();
  if (dernLigne > 1 && dernCol > 0) {
    f.getRange(2, 1, dernLigne - 1, dernCol).clearContent();
  }
}
