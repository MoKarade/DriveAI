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
