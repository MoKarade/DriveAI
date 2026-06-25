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
 *   1. pour chaque copie « [REVUE] … » du dossier 00·À vérifier, selon sa SOURCE
 *      (lue dans l'Index) :
 *        - PJ Gmail  → mise à la corbeille (réversible) ; l'ORIGINAL est dans Gmail ;
 *        - dépôt manuel → l'« original » a été DÉPLACÉ ici, donc on le RENVOIE dans
 *          00·À trier pour qu'il soit re-trié (jamais de corbeille → aucune perte) ;
 *        - source inconnue → laissé en place par prudence ;
 *   2. vide les onglets Index et Revue (garde les en-têtes) ;
 *   3. relance le pipeline, qui re-traite les PJ Gmail et les dépôts renvoyés.
 *
 * Garde-fou : on ne met JAMAIS à la corbeille un fichier dont l'unique exemplaire
 * est ici (dépôt manuel déplacé). Le pipeline automatique, lui, ne supprime jamais
 * de fichier utilisateur.
 */
function rejouerLaRevue() {
  var source = sourceParNomRevue_(); // nom de fichier « [REVUE] … » → 'gmail' | 'drive'

  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER);
  var it = dossier.getFiles();
  var corbeille = 0, renvoyes = 0, laisses = 0;
  while (it.hasNext()) {
    var f = it.next();
    var nom = f.getName();
    if (nom.indexOf('[REVUE]') !== 0) continue;

    var s = source[nom];
    if (s === 'gmail') {
      f.setTrashed(true); // copie créée par nous, original dans Gmail → rejouable sans perte
      corbeille++;
    } else if (s === 'drive') {
      // Original déposé manuellement (déplacé ici) : on le renvoie pour rejeu, jamais corbeille.
      deplacerEtRenommer_(f.getId(), CONFIG.DOSSIERS.A_TRIER, CONFIG.DOSSIERS.A_VERIFIER, nom);
      renvoyes++;
    } else {
      laisses++; // source inconnue → on ne touche à rien (prudence : pas de suppression)
    }
  }
  journalInfo_('Maintenance', corbeille + ' copie(s) Gmail à la corbeille, ' +
    renvoyes + ' dépôt(s) renvoyé(s) dans 00·À trier, ' + laisses + ' laissé(s) en place.');

  viderOnglet_('Index');
  viderOnglet_('Revue');
  journalInfo_('Maintenance', 'Index et Revue vidés — rejeu du pipeline.');

  tickDriveAI();
}

/**
 * Cartographie « nom de fichier en revue » → source, d'après l'Index.
 * La clé d'un dépôt manuel commence par « drive| » ; sinon c'est une PJ Gmail.
 * @return {Object} { nomFichier: 'gmail' | 'drive' }
 */
function sourceParNomRevue_() {
  var f = feuille_('Index');
  var map = {};
  var dern = f.getLastRow();
  if (dern < 2) return map;
  var v = f.getRange(2, 1, dern - 1, 6).getValues(); // A=Clé … C=Fichier … F=Statut
  for (var i = 0; i < v.length; i++) {
    var cle = v[i][0], fichier = v[i][2], statut = v[i][5];
    if (statut !== 'revue' || !fichier) continue;
    if (map[fichier] === 'drive') continue; // 'drive' (exemplaire unique) prime → jamais corbeille
    map[fichier] = (String(cle).indexOf('drive|') === 0) ? 'drive' : 'gmail';
  }
  return map;
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
