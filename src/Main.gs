/**
 * Main.gs — Orchestration du pipeline et installation du trigger 15 min.
 *
 * À lancer une fois à la main : installerTrigger().
 *
 * Deux sources d'intake : PJ Gmail + dépôt manuel `00·À trier`. Chaque document
 * passe par le pipeline partagé (Pipeline.gs). Avant le routage, on matérialise
 * les entités fraîchement validées par Marc (création des dossiers).
 *
 * Idempotence : la clé Index est posée APRÈS placement réussi. Concurrence : un
 * verrou empêche deux exécutions de se chevaucher. Coupure : un garde-temps borne
 * le run ; le reste est repris au tick suivant.
 */

/** Installe (idempotemment) le déclencheur temporel de 15 minutes. */
function installerTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(15).create();
  journalInfo_('Setup', 'Trigger 15 min installé.');
}

/** Un passage du pipeline : Gmail + dépôt manuel → classement / revue. */
function tickDriveAI() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) {
    journalInfo_('Pipeline', 'Run précédent encore actif — on saute ce tick.');
    return;
  }
  try {
    reinitialiserIndexCache_();
    reinitialiserEntitesCache_();

    var debut = Date.now();
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };

    // Auto-rejeu sur nouvelle version du classement : renvoie les DÉPÔTS partis en
    // revue vers 00·À trier pour reclassement (zéro action manuelle, zéro suppression).
    appliquerRejeuSiNouvelleVersion_(estBudgetDepasse);

    // Matérialise les entités validées par Marc (Statut = « validée ») avant le routage,
    // mais bornée par le garde-temps (et un plafond par run) : pas de coupure des 6 min.
    creerDossiersEntitesValidees_(estBudgetDepasse);

    traiterGmail_(estBudgetDepasse);                       // source 1 : PJ Gmail
    if (!estBudgetDepasse()) traiterDepots_(estBudgetDepasse); // source 2 : 00·À trier
  } finally {
    verrou.releaseLock();
  }
}

/**
 * Auto-rejeu sur changement de version de classement.
 *
 * Compare `CONFIG.VERSION` (figée dans le code déployé) à la dernière version vue
 * (Script Property `DriveAI_VERSION`). Si elles diffèrent — juste après un déploiement
 * qui change la logique — on RENVOIE les dépôts manuels partis en revue vers 00·À trier
 * pour qu'ils soient reclassés par le tick courant. Plus besoin de `rejouerLaRevue`.
 *
 * Sûreté (audits flotte) : opération **réversible uniquement** (déplacement, jamais de
 * corbeille), **bornée** par le garde-temps + un plafond/run, et **reprenable** — la
 * version n'est posée QUE lorsque tout le rejeu est consommé. Ne touche PAS aux PJ Gmail
 * en revue (sensibles/peu sûres : elles ont vocation à y rester) ni aux docs déjà classés
 * (leur idempotence est préservée → pas de re-OCR/re-LLM inutile).
 *
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerRejeuSiNouvelleVersion_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_VERSION') === CONFIG.VERSION) return;

  var reste = rejeuAutoDesDepots_(estBudgetDepasse);
  if (!reste) {
    // Rejeu entièrement consommé → on fige la version (anti-re-déclenchement).
    props.setProperty('DriveAI_VERSION', CONFIG.VERSION);
    journalInfo_('Maintenance', 'Rejeu auto terminé — version « ' + CONFIG.VERSION + ' » figée.');
  }
}

/**
 * Renvoie les DÉPÔTS MANUELS partis en revue (clé Index `drive|…`, statut `revue`)
 * vers 00·À trier pour reclassement, et retire leur ligne d'Index (sinon l'intake
 * les sauterait). Borné (garde-temps + plafond). Aucune corbeille, aucune perte :
 * un déplacement est réversible et l'original déposé reste unique mais retrouvable.
 *
 * @param {function():boolean} estBudgetDepasse
 * @return {boolean} vrai s'il reste des dépôts à renvoyer (rejeu non terminé).
 */
function rejeuAutoDesDepots_(estBudgetDepasse) {
  var f = feuille_('Index');
  var dern = f.getLastRow();
  if (dern < 2) return false;

  var v = f.getRange(2, 1, dern - 1, 6).getValues(); // A=Clé … C=Fichier … F=Statut
  var cibles = [];
  for (var i = 0; i < v.length; i++) {
    var cle = String(v[i][0]);
    if (v[i][5] === 'revue' && cle.indexOf('drive|') === 0) {
      cibles.push({ ligne: i + 2, fileId: cle.substring(6), nom: v[i][2] });
    }
  }
  if (!cibles.length) return false;

  var lignes = [], renvoyes = 0;
  for (var j = 0; j < cibles.length; j++) {
    if (lignes.length >= CONFIG.REJEU_PAGE || estBudgetDepasse()) break;
    var c = cibles[j];
    // Tentative de déplacement (réversible). On retire la ligne d'Index DANS TOUS LES CAS
    // après tentative : un dépôt définitivement immobile (supprimé par Marc, etc.) ne doit
    // pas bloquer l'avancée de la version à chaque tick. Le retry transitoire est déjà géré
    // dans deplacerEtRenommer_.
    if (deplacerEtRenommer_(c.fileId, CONFIG.DOSSIERS.A_TRIER, CONFIG.DOSSIERS.A_VERIFIER, c.nom)) {
      renvoyes++;
    }
    lignes.push(c.ligne);
  }
  // Retire les lignes d'Index traitées (ordre décroissant : pas de décalage).
  lignes.sort(function (a, b) { return b - a; });
  for (var k = 0; k < lignes.length; k++) f.deleteRow(lignes[k]);

  if (renvoyes) {
    journalInfo_('Maintenance', renvoyes + ' dépôt(s) renvoyé(s) dans 00·À trier (rejeu auto).');
  }
  return cibles.length > lignes.length; // reste-t-il des cibles non traitées (plafond/budget) ?
}

/**
 * Parcourt les fils Gmail récents avec PJ, paginés, dans le budget temps.
 * @param {function():boolean} estBudgetDepasse
 */
function traiterGmail_(estBudgetDepasse) {
  var debutPage = 0;
  while (!estBudgetDepasse()) {
    var fils;
    try {
      fils = pageFils_(debutPage);
    } catch (e) {
      notifierEchec_('Gmail', 'Recherche des mails impossible : ' + e);
      return;
    }
    if (!fils.length) break; // fin de la fenêtre 30 jours

    for (var i = 0; i < fils.length; i++) {
      if (estBudgetDepasse()) {
        journalInfo_('Pipeline', 'Budget temps atteint — reprise au prochain tick.');
        return;
      }
      traiterFil_(fils[i]);
    }
    debutPage += CONFIG.PAGE_FILS;
  }
}

/**
 * Traite toutes les PJ d'un fil. Chaque PJ est indépendante (idempotence par clé).
 * @param {GmailThread} fil
 */
function traiterFil_(fil) {
  var messages = fil.getMessages();
  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var pjs = piecesJointes_(message);
    for (var p = 0; p < pjs.length; p++) {
      traiterPjGmail_(message, p, pjs[p]);
    }
  }
}

/**
 * Construit le descripteur d'une PJ Gmail et le passe au pipeline.
 * Source en lecture seule : on COPIE la PJ vers sa destination (l'original reste
 * dans Gmail), à la différence d'un dépôt manuel qui est déplacé.
 * @param {GmailMessage} message
 * @param {number} indexPj
 * @param {GmailAttachment} pj
 */
function traiterPjGmail_(message, indexPj, pj) {
  traiterDocument_({
    cle: cleAttachement_(message, indexPj, pj),
    nom: pj.getName(),
    taille: pj.getSize(),
    expediteur: message.getFrom(),
    sujet: message.getSubject(),
    date: message.getDate(),
    blob: function () { return pj.copyBlob(); },
    placer: function (dossierId, nom) { return deposer_(pj.copyBlob(), dossierId, nom); },
    placerRevue: function (nom) { return deposer_(pj.copyBlob(), CONFIG.DOSSIERS.A_VERIFIER, nom); }
  });
}
