/**
 * Main.gs — Orchestration du pipeline et installation du trigger 15 min.
 *
 * À lancer une fois à la main : installerTrigger().
 *
 * Idempotence : la clé Index (messageId|i|nom|taille) est posée APRÈS dépôt réussi.
 * Concurrence : un verrou empêche deux exécutions de se chevaucher. Coupure :
 * un garde-temps borne le run ; le reste est repris au tick suivant.
 */

/** Installe (idempotemment) le déclencheur temporel de 15 minutes. */
function installerTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(15).create();
  journalInfo_('Setup', 'Trigger 15 min installé.');
}

/** Un passage du pipeline : mails Gmail non traités → classement / revue. */
function tickDriveAI() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) {
    journalInfo_('Pipeline', 'Run précédent encore actif — on saute ce tick.');
    return;
  }
  try {
    reinitialiserIndexCache_();
    var debut = Date.now();
    var debutPage = 0;

    while (Date.now() - debut < CONFIG.BUDGET_MS) {
      var fils;
      try {
        fils = pageFils_(debutPage);
      } catch (e) {
        notifierEchec_('Gmail', 'Recherche des mails impossible : ' + e);
        return;
      }
      if (!fils.length) break; // fin de la fenêtre 30 jours

      for (var i = 0; i < fils.length; i++) {
        if (Date.now() - debut > CONFIG.BUDGET_MS) {
          journalInfo_('Pipeline', 'Budget temps atteint — reprise au prochain tick.');
          return;
        }
        traiterFil_(fils[i]);
      }
      debutPage += CONFIG.PAGE_FILS;
    }
  } finally {
    verrou.releaseLock();
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
      var pj = pjs[p];
      var cle = cleAttachement_(message, p, pj);

      try {
        if (indexContient_(cle)) continue; // déjà traité → idempotence

        var blob = pj.copyBlob();
        var extrait = pj.getSize() > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob);

        var classif = classifier_({
          nomFichier: blob.getName(),
          expediteur: message.getFrom(),
          sujet: message.getSubject(),
          extrait: extrait
        });

        if (!classif) {
          // On n'inscrit rien à l'Index → la PJ sera re-tentée au prochain tick.
          notifierEchec_('Pipeline', 'Classification impossible pour « ' + blob.getName() + ' »');
          continue;
        }

        var resultat = router_(blob, classif, message.getDate());
        indexAjouter_(cle, resultat);
        journalInfo_('Pipeline', resultat.statut + ' → ' + resultat.chemin + ' : ' + resultat.nom);
      } catch (e) {
        notifierEchec_('Pipeline', 'Échec sur « ' + pj.getName() + ' » : ' + e);
      }
    }
  }
}
