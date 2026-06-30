/**
 * Main.gs — Orchestration du pipeline et installation du déclencheur (CONFIG.TICK_MINUTES).
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

/**
 * Installe (idempotemment) le déclencheur temporel (CONFIG.TICK_MINUTES).
 * Lancé À LA MAIN par Marc (hors d'un run déclenché) → l'ordre delete-then-create est sûr ici
 * (le bref instant à 0 déclencheur est sans conséquence). L'ajustement AUTOMATIQUE en cours de
 * run, lui, utilise l'ordre inverse (create-then-delete) — cf. assurerIntervalleTick_.
 */
function installerTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(CONFIG.TICK_MINUTES).create();
  PropertiesService.getScriptProperties().setProperty('DriveAI_TICK_MINUTES', String(CONFIG.TICK_MINUTES));
  journalInfo_('Setup', 'Déclencheur ' + CONFIG.TICK_MINUTES + ' min installé.');
}

/**
 * Réinstalle le déclencheur si son intervalle (CONFIG.TICK_MINUTES) a changé depuis le
 * dernier réglage (Script Property `DriveAI_TICK_MINUTES`). Permet de changer la fréquence
 * par config seule, appliquée automatiquement au déploiement suivant — sans re-`installerTrigger`.
 *
 * Sûreté (audit quotas) :
 *   1. on CRÉE le nouveau déclencheur d'ABORD → jamais 0 déclencheur (qui figerait le moteur) :
 *      si la création échoue, l'ancien subsiste et on retentera au tick suivant ;
 *   2. on pose la propriété JUSTE APRÈS la création réussie → empêche d'accumuler un nouveau
 *      déclencheur à chaque tick si la purge échoue ensuite (anti-saturation du quota ~20) ;
 *   3. on purge enfin les autres `tickDriveAI` (au pire un doublon résiduel, dédupliqué par le verrou).
 * L'appelant enveloppe d'un try/catch : un échec d'ajustement ne doit jamais bloquer l'intake.
 */
function assurerIntervalleTick_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_TICK_MINUTES') === String(CONFIG.TICK_MINUTES)) return;

  var nouveau = ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(CONFIG.TICK_MINUTES).create();
  props.setProperty('DriveAI_TICK_MINUTES', String(CONFIG.TICK_MINUTES)); // marqué FAIT dès la création
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI' && t.getUniqueId() !== nouveau.getUniqueId()) {
      ScriptApp.deleteTrigger(t);
    }
  });
  journalInfo_('Setup', 'Intervalle du déclencheur ajusté à ' + CONFIG.TICK_MINUTES + ' min.');
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
    reinitialiserEscalades_(); // plafond d'escalades LLM par run (anti-emballement de coût)

    // Applique un éventuel changement d'intervalle (CONFIG.TICK_MINUTES) sans action manuelle.
    // Secondaire : un échec ne doit JAMAIS bloquer l'intake (cf. audit quotas).
    try { assurerIntervalleTick_(); }
    catch (e) { journalInfo_('Setup', 'Ajustement d\'intervalle différé : ' + e); }

    var debut = Date.now();
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };

    // Auto-rejeu sur nouvelle version du classement : renvoie les DÉPÔTS partis en
    // revue vers 00·À trier pour reclassement (zéro action manuelle, zéro suppression).
    appliquerRejeuSiNouvelleVersion_(estBudgetDepasse);

    // Grand rangement initial (zéro clic, une fois par `CONFIG.RANGEMENT_TAG`) : renvoie au fil
    // des ticks tout le contenu « en vrac » des domaines vers 00·À trier (déplacement seul, borné).
    appliquerRangementInitial_(estBudgetDepasse);

    // Matérialise les entités validées par Marc (Statut = « validée ») avant le routage,
    // mais bornée par le garde-temps (et un plafond par run) : pas de coupure des 6 min.
    creerDossiersEntitesValidees_(estBudgetDepasse);

    traiterGmail_(estBudgetDepasse);                       // source 1 : PJ Gmail
    if (!estBudgetDepasse()) traiterDepots_(estBudgetDepasse); // source 2 : 00·À trier

    // Phase 3 : détection d'actions/rdv dans TOUS les mails récents → Tasks/Calendar.
    // En dernier, budget restant seulement : le classement documentaire (déjà validé en
    // prod) garde toujours la priorité sur ce nouveau flux.
    if (!estBudgetDepasse()) traiterIntentionsMail_(estBudgetDepasse);
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

  // Deux passes, toutes deux en DÉPLACEMENT seul (réversible, aucune corbeille) :
  //  1. dépôts manuels partis en revue (clé Index `drive|…`) ;
  //  2. docs « [REVUE] confiance … » (confiance basse) — touchés par un changement de seuil.
  // La zone protégée (« [REVUE] sensible … ») n'est JAMAIS reprise (garde-fou §1).
  var reste1 = rejeuAutoDesDepots_(estBudgetDepasse);
  var reste2 = rejeuAutoDesConfiances_(estBudgetDepasse);
  if (!reste1 && !reste2) {
    // Rejeu entièrement consommé → on fige la version (anti-re-déclenchement).
    props.setProperty('DriveAI_VERSION', CONFIG.VERSION);
    journalInfo_('Maintenance', 'Rejeu auto terminé — version « ' + CONFIG.VERSION + ' » figée.');
  }
}

/**
 * Grand rangement initial AUTOMATIQUE (zéro clic), gated par `CONFIG.RANGEMENT_TAG`.
 *
 * Tant que le tag stocké (`DriveAI_RANGEMENT`) diffère du tag courant, chaque tick renvoie UNE
 * page (`rangerUnePage_`, bornée par le garde-temps + `RANGEMENT_MAX_PAR_RUN`) du contenu « en
 * vrac » des domaines NON protégés vers 00·À trier. L'intake les reprend ensuite (OCR → analyse
 * → renommage → classement). Le tag n'est figé QUE lorsqu'une passe complète ne collecte plus
 * AUCUN fichier en vrac (tout le Drive est passé au format `AAAA-MM-JJ_` ou parti à l'intake) :
 * l'opération est donc reprenable sur autant de ticks que nécessaire, sans jamais re-coûter sur
 * les fichiers déjà normalisés (idempotent). Déplacement seul — aucune suppression (garde-fous §1/§2).
 *
 * Placé APRÈS le rejeu de version mais AVANT l'intake : les fichiers renvoyés ce tick sont repris
 * dès `traiterDepots_` du même run s'il reste du budget.
 *
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerRangementInitial_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RANGEMENT') === CONFIG.RANGEMENT_TAG) return; // déjà fait pour ce tag
  if (estBudgetDepasse()) return; // pas de budget ce tick → repris au prochain

  var r = rangerUnePage_(estBudgetDepasse, ensembleDomainesProteges_());
  if (r.deplaces) {
    journalInfo_('Rangement', r.deplaces + ' fichier(s) en vrac renvoyé(s) dans 00·À trier (rangement initial auto).');
  }
  // Terminé seulement quand une passe NON interrompue ne trouve plus aucun fichier en vrac.
  if (!r.reste && r.collectes === 0) {
    props.setProperty('DriveAI_RANGEMENT', CONFIG.RANGEMENT_TAG);
    journalInfo_('Rangement', 'Rangement initial terminé — tout le Drive est passé au pipeline (tag « ' + CONFIG.RANGEMENT_TAG + ' »).');
  }
}

/**
 * Renvoie les docs « [REVUE] confiance … » de `00·À vérifier` vers `00·À trier` pour
 * reclassement avec le seuil courant. **Déplacement seul** (réversible) : aucune corbeille,
 * aucune écriture d'Index. La copie déplacée se re-traite comme un dépôt (clé `drive|nouvelId`,
 * non indexée) ; la PJ Gmail d'origine reste « faite » dans l'Index → pas de doublon. La zone
 * protégée (« [REVUE] sensible … ») est ignorée (jamais reprise).
 *
 * @param {function():boolean} estBudgetDepasse
 * @return {boolean} vrai s'il reste des docs à renvoyer (plafond/budget atteint).
 */
function rejeuAutoDesConfiances_(estBudgetDepasse) {
  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER);
  var it = dossier.getFiles();
  var ids = [];
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf('[REVUE] confiance') === 0) ids.push(f.getId());
  }
  if (!ids.length) return false;

  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (n >= CONFIG.REJEU_PAGE || estBudgetDepasse()) break;
    var fid = ids[i];
    var nom = DriveApp.getFileById(fid).getName();
    if (deplacerEtRenommer_(fid, CONFIG.DOSSIERS.A_TRIER, CONFIG.DOSSIERS.A_VERIFIER, nom)) n++;
  }
  if (n) {
    journalInfo_('Maintenance', n + ' doc(s) « confiance basse » renvoyé(s) dans 00·À trier (rejeu auto).');
  }
  return ids.length > n;
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
