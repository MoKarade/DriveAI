/**
 * Main.gs — Orchestration du pipeline et installation du déclencheur (CONFIG.TICK_MINUTES).
 *
 * À lancer une fois à la main : installerTrigger().
 *
 * Sources d'intake : PJ Gmail, dépôt manuel `00·À trier`, fichiers partagés (ADR-0005) —
 * plus la migration (#8) qui re-passe l'existant. Chaque document
 * passe par le pipeline partagé (Pipeline.gs). Avant le routage, on matérialise
 * les entités fraîchement validées par Marc (création des dossiers).
 *
 * Idempotence : la clé Index est posée APRÈS placement réussi. Concurrence : un
 * verrou empêche deux exécutions de se chevaucher. Coupure : un garde-temps borne
 * le run ; le reste est repris au tick suivant.
 */

/**
 * Installe (idempotemment) le déclencheur temporel (CONFIG.TICK_MINUTES).
 * Appelé (a) À LA MAIN par Marc et (b) AUTOMATIQUEMENT par le chien de garde (`chienDeGarde`) en
 * auto-réparation. Dans les deux cas on est hors du run `tickDriveAI` lui-même (le watchdog est un
 * déclencheur DISTINCT) → l'ordre delete-then-create est sûr (le bref instant à 0 déclencheur, ou un
 * tick manqué, est sans conséquence — c'est justement l'état qu'on répare). L'ajustement AUTOMATIQUE
 * en cours de run, lui, utilise l'ordre inverse (create-then-delete) — cf. assurerIntervalleTick_.
 */
function installerTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(CONFIG.TICK_MINUTES).create();
  PropertiesService.getScriptProperties().setProperty('DriveAI_TICK_MINUTES', String(CONFIG.TICK_MINUTES));
  journalInfo_('Setup', 'Déclencheur ' + CONFIG.TICK_MINUTES + ' min installé.');
  assurerTriggerResume_();      // installe aussi le résumé hebdo (idempotent)
  assurerTriggerChienDeGarde_(); // et le chien de garde (idempotent, ADR-0004)
}

/**
 * Installe (si absent) le déclencheur du CHIEN DE GARDE (`chienDeGarde`, toutes les
 * `CONFIG.WATCHDOG_MINUTES`). Idempotent (crée seulement s'il n'existe pas → anti-saturation du
 * quota de déclencheurs ~20). Appelé par `installerTrigger` ET en tête de tick (enveloppé) pour
 * s'auto-installer sur un déploiement existant sans re-`installerTrigger` manuel.
 */
function assurerTriggerChienDeGarde_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'chienDeGarde') return; // déjà installé
  }
  ScriptApp.newTrigger('chienDeGarde').timeBased().everyMinutes(CONFIG.WATCHDOG_MINUTES).create();
  journalInfo_('Setup', 'Chien de garde installé (toutes les ' + CONFIG.WATCHDOG_MINUTES + ' min).');
}

/**
 * Aligne le NOM des dossiers de domaine sur les clés de `CONFIG.DOMAINES` (source de vérité).
 * Gated par `CONFIG.NOMS_DOMAINES_TAG` (Script Property) → ne parcourt les domaines qu'une fois par tag,
 * pas à chaque tick. Sert notamment au renumérotage « 07 · Perso » → « 08 · Perso » (ADR-0002). Renommage
 * seul (jamais de suppression/déplacement), réversible (bumper le tag + rétablir la clé rejoue). Enveloppé.
 */
function assurerNomsDomaines_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_NOMS_DOMAINES') === CONFIG.NOMS_DOMAINES_TAG) return; // déjà fait pour ce tag
  var noms = Object.keys(CONFIG.DOMAINES);
  var renommes = 0;
  for (var i = 0; i < noms.length; i++) {
    try {
      var d = DriveApp.getFolderById(CONFIG.DOMAINES[noms[i]]);
      if (d.getName() !== noms[i]) { d.setName(noms[i]); renommes++; }
    } catch (e) {
      journalErreur_('Setup', 'Renommage du domaine « ' + noms[i] + ' » impossible : ' + e);
    }
  }
  props.setProperty('DriveAI_NOMS_DOMAINES', CONFIG.NOMS_DOMAINES_TAG);
  if (renommes) journalInfo_('Setup', renommes + ' dossier(s) de domaine renommé(s) pour coller à la config.');
}

/* ---------- Chien de garde (watchdog, ADR-0004) ---------- */

/**
 * Vrai s'il existe au moins un déclencheur `tickDriveAI`. Sert à confirmer qu'une auto-réparation a
 * bien recréé le déclencheur même si un log annexe a levé ensuite (ne propage jamais d'exception).
 * @return {boolean}
 */
function presenceTriggerTick_() {
  try {
    var t = ScriptApp.getProjectTriggers();
    for (var i = 0; i < t.length; i++) {
      if (t[i].getHandlerFunction() === 'tickDriveAI') return true;
    }
  } catch (e) { /* lecture des déclencheurs impossible → on ne peut pas confirmer */ }
  return false;
}

/**
 * Décision PURE du chien de garde (testée), machine à 3 états — détecter → réparer → (si toujours
 * en panne) alerter UNE fois. Les clés `*Tick` identifient l'ÉPISODE de panne (= la valeur du
 * heartbeat figé pendant la panne) pour ne réparer/alerter qu'une fois par épisode.
 * @param {number} maintenant   ms (Date.now())
 * @param {number} dernierTick  ms du dernier heartbeat (0 = jamais tourné)
 * @param {number} seuil        ms de silence au-delà duquel on agit
 * @param {number} repareTick   heartbeat pour lequel une réparation a déjà été tentée
 * @param {number} alerteTick   heartbeat pour lequel une alerte a déjà été envoyée
 * @return {'rien'|'reparer'|'alerter'}
 */
function actionChienDeGarde_(maintenant, dernierTick, seuil, repareTick, alerteTick) {
  if (!dernierTick) return 'rien';                        // jamais tourné → rien à réparer (trigger assuré ailleurs)
  if ((maintenant - dernierTick) <= seuil) return 'rien'; // le moteur tourne (heartbeat frais)
  if (alerteTick === dernierTick) return 'rien';          // déjà alerté pour CET épisode → silence
  if (repareTick === dernierTick) return 'alerter';       // réparation déjà tentée, toujours en panne → escalade
  return 'reparer';                                        // première détection de l'épisode → auto-réparation
}

/**
 * Chien de garde — 2ᵉ déclencheur, doit être TRIVIALEMENT robuste (jamais d'exception propagée,
 * sinon Google le désactiverait lui aussi). Lit le heartbeat, décide, et au besoin ré-installe le
 * déclencheur principal (auto-réparation) puis, si ça ne suffit pas, alerte UNE fois. Public (cible
 * d'un déclencheur → pas de suffixe `_`).
 */
function chienDeGarde() {
  try {
    var props = PropertiesService.getScriptProperties();
    var dernierTick = Number(props.getProperty('DriveAI_LAST_TICK')) || 0;
    var action = actionChienDeGarde_(
      Date.now(), dernierTick, CONFIG.WATCHDOG_SEUIL_MS,
      Number(props.getProperty('DriveAI_WATCHDOG_REPARE')) || 0,
      Number(props.getProperty('DriveAI_WATCHDOG_ALERTE')) || 0
    );
    if (action === 'reparer') {
      var repare = false;
      try {
        installerTrigger(); // delete+create du déclencheur principal (auto-réparation)
        repare = true;
      } catch (e) {
        // `installerTrigger` a pu RECRÉER le déclencheur avant qu'un log annexe (Sheet HS, cause de panne
        // corrélée) ne lève : on ne croit pas l'exception sur parole, on RE-VÉRIFIE la présence réelle du
        // déclencheur. Un simple échec de log ne doit jamais requalifier une réparation réussie en alerte.
        repare = presenceTriggerTick_();
        if (!repare) { // réparation VRAIMENT impossible → on alerte tout de suite (marqué, non répété)
          props.setProperty('DriveAI_WATCHDOG_ALERTE', String(dernierTick));
          alerterChienDeGarde_(dernierTick, e);
        }
      }
      if (repare) {
        props.setProperty('DriveAI_WATCHDOG_REPARE', String(dernierTick));
        try { journalInfo_('Chien de garde', 'Moteur silencieux → déclencheur principal ré-installé (auto-réparation).'); }
        catch (e2) { /* log best-effort : ne doit pas défaire une réparation réussie */ }
      }
    } else if (action === 'alerter') {
      props.setProperty('DriveAI_WATCHDOG_ALERTE', String(dernierTick));
      alerterChienDeGarde_(dernierTick, null);
    }
  } catch (e) {
    // Le chien de garde ne DOIT jamais planter (invariant ADR-0004). On avale tout en silence.
  }
}

/**
 * Envoie l'UNIQUE alerte de panne (mail rassurant : souvent le quota quotidien, sinon un clic).
 * Ne propage jamais d'exception (appelé depuis le chien de garde).
 * @param {number} dernierTick
 * @param {*} err  cause d'échec de réparation, ou null (réparation tentée sans effet)
 */
function alerterChienDeGarde_(dernierTick, err) {
  var quand = dernierTick
    ? Utilities.formatDate(new Date(dernierTick), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')
    : 'inconnu';
  var corps = 'DriveAI ne semble plus traiter depuis ' + quand + '.\n\n' +
    'Souvent bénin : le quota quotidien du compte gratuit (~90 min/jour) est atteint — ça reprend seul demain.\n' +
    'Si rien ne repart d\'ici demain, un seul geste : ouvrir le projet Apps Script « DriveAI » et exécuter installerTrigger.\n' +
    (err ? '\n(Auto-réparation impossible : ' + err + ')' : '\n(Auto-réparation tentée, sans effet pour l\'instant.)');
  try {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[DriveAI] Moteur silencieux — à vérifier', corps);
  } catch (e) { /* mail impossible : le chien de garde ne plante pas pour autant */ }
  journalErreur_('Chien de garde', 'Alerte « moteur silencieux » envoyée (dernier tick : ' + quand + ').');
}

/**
 * Installe (si absent) le déclencheur HEBDOMADAIRE du résumé (`resumeHebdo`). Idempotent :
 * crée UNIQUEMENT s'il n'existe encore aucun déclencheur `resumeHebdo`, pour ne pas en
 * accumuler à chaque tick (anti-saturation du quota ~20, cf. audit quotas). Jour/heure : CONFIG.
 * Appelé en tête de tick, enveloppé d'un try/catch par l'appelant : un échec ne bloque pas l'intake.
 */
function assurerTriggerResume_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'resumeHebdo') return; // déjà installé
  }
  ScriptApp.newTrigger('resumeHebdo').timeBased()
    .onWeekDay(ScriptApp.WeekDay[CONFIG.RESUME_JOUR]).atHour(CONFIG.RESUME_HEURE).create();
  journalInfo_('Setup', 'Déclencheur du résumé hebdo installé (' +
    CONFIG.RESUME_JOUR + ' ' + CONFIG.RESUME_HEURE + 'h).');
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

/** Un passage du pipeline : Gmail + dépôts + partagés (+ migration, intentions) → tout est CLASSÉ (plus de revue depuis 2026-07-01). */
function tickDriveAI() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(5000)) {
    journalInfo_('Pipeline', 'Run précédent encore actif — on saute ce tick.');
    return;
  }
  try {
    reinitialiserIndexCache_();
    reinitialiserEntitesCache_();
    reinitialiserCorrectionsCache_(); // référentiel d'apprentissage relu 1×/run (few-shot, ADR-0003)
    reinitialiserEscalades_(); // plafond d'escalades LLM par run (anti-emballement de coût)
    reinitialiserUsage_();     // compteur de coût LLM du run (mesure réelle, P1-09)

    // Applique un éventuel changement d'intervalle (CONFIG.TICK_MINUTES) sans action manuelle,
    // et installe le déclencheur du résumé hebdo s'il manque. Secondaire : un échec ne doit
    // JAMAIS bloquer l'intake (cf. audit quotas).
    try { assurerIntervalleTick_(); }
    catch (e) { journalInfo_('Setup', 'Ajustement d\'intervalle différé : ' + e); }
    try { assurerTriggerResume_(); }
    catch (e) { journalInfo_('Setup', 'Installation du résumé hebdo différée : ' + e); }
    try { assurerTriggerChienDeGarde_(); }
    catch (e) { journalInfo_('Setup', 'Installation du chien de garde différée : ' + e); }
    try { assurerNomsDomaines_(); }
    catch (e) { journalErreur_('Setup', 'Sync des noms de domaines différée : ' + e); }

    var debut = Date.now();
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };

    // Auto-rejeu sur nouvelle version du classement : renvoie les DÉPÔTS partis en revue vers
    // 00·À trier pour reclassement. SECONDAIRE → enveloppé d'un try/catch : un échec ne doit
    // JAMAIS bloquer l'intake (même principe que l'ajustement du déclencheur ci-dessus).
    try { appliquerRejeuSiNouvelleVersion_(estBudgetDepasse); }
    catch (e) { journalErreur_('Maintenance', 'Rejeu de version différé : ' + e); }

    // Matérialise les entités validées par Marc (Statut = « validée ») avant le routage, bornée par
    // le garde-temps. SECONDAIRE → enveloppée : une erreur Drive/Sheet ne doit jamais geler l'intake.
    try { creerDossiersEntitesValidees_(estBudgetDepasse); }
    catch (e) { journalErreur_('Entités', 'Création des dossiers d\'entités différée : ' + e); }

    // Curation one-shot de la file d'entités (#10, ADR-0009) : génériques refusés, variantes
    // regroupées — statuts seulement, gatée par tag. SECONDAIRE → enveloppée + budget-gatée.
    if (!estBudgetDepasse()) {
      try { appliquerCurationEntites_(estBudgetDepasse); }
      catch (e) { journalErreur_('Entités', 'Curation de la file différée : ' + e); }
    }

    // Relances de quarantaine demandées depuis l'app web (#15, ADR-0011) : le tick consomme
    // l'onglet `Relances` (l'app n'exécute jamais de fonction moteur). SECONDAIRE → enveloppée.
    if (!estBudgetDepasse()) {
      try { appliquerRelancesQuarantaine_(estBudgetDepasse); }
      catch (e) { journalErreur_('Maintenance', 'Relances de quarantaine différées : ' + e); }
    }

    // Lit les corrections soumises par Marc (formulaire Google) et les enregistre AVANT l'intake, pour
    // que les documents classés dans ce même tick profitent des règles fraîchement apprises (few-shot).
    // SECONDAIRE → enveloppée : un formulaire absent/illisible ne doit jamais geler l'intake. Budget-gatée
    // comme ses pairs : si une étape amont a épuisé le budget, on ne lance pas la lecture (protège l'intake).
    if (!estBudgetDepasse()) {
      try { lireEtAppliquerCorrections_(estBudgetDepasse); }
      catch (e) { journalErreur_('Corrections', 'Lecture des corrections différée : ' + e); }
    }

    // Grand rangement (zéro clic, une fois par `CONFIG.RANGEMENT_TAG`) : COLLECTE une page de l'ancien
    // Drive vers 00·À trier. Tourne TÔT pour ne pas être affamé par l'intake (sinon l'ancien Drive ne
    // se vide jamais), MAIS uniquement si la file a de la place — DRAINER AVANT D'ALIMENTER : on ne
    // collecte de nouveaux fichiers que si 00·À trier en compte moins que `RANGEMENT_SEUIL_FILE`, ce qui
    // empêche à la fois l'engorgement de la file ET la famine du rangement. ENVELOPPÉ : une erreur de
    // collecte Drive ne gèle jamais l'intake (le `try` du tick n'a qu'un `finally`).
    // `rangementTermine_()` (1 Property, cheap) court-circuite le comptage Drive une fois le rangement
    // fini — sinon on itérerait jusqu'à 40 fichiers de 00·À trier à chaque tick pour rien, à vie.
    if (!estBudgetDepasse() && !rangementTermine_() &&
        nbFichiersATrier_(CONFIG.RANGEMENT_SEUIL_FILE) < CONFIG.RANGEMENT_SEUIL_FILE) {
      try { appliquerRangementInitial_(estBudgetDepasse); }
      catch (e) { journalErreur_('Rangement', 'Grand rangement différé : ' + e); }
    }

    // INTAKE : draine la file (dépôts manuels + sortie du grand rangement) et les PJ Gmail.
    traiterGmail_(estBudgetDepasse);                       // source 1 : PJ Gmail
    if (!estBudgetDepasse()) traiterDepots_(estBudgetDepasse); // source 2 : 00·À trier (draine la file)

    // Source 3 : fichiers PARTAGÉS récents (ADR-0005). COPIE dans l'arbo (comme Gmail), pipeline commun.
    // ENVELOPPÉE : un échec réseau (liste/quota Drive) ne doit jamais bloquer les intentions ci-dessous
    // ni le reste du tick. Budget-gatée : ne démarre pas si l'intake documentaire a déjà épuisé le budget.
    if (!estBudgetDepasse()) {
      try { collecterPartages_(estBudgetDepasse); }
      catch (e) { journalErreur_('Partages', 'Collecte des fichiers partagés différée : ' + e); }
    }

    // Campagne HISTORIQUE Gmail (#12, ADR-0010 §1) : remonte tout l'historique de PJ par tranches
    // ancrées. APRÈS le flux vivant (priorité), AVANT migration/intentions. Coût nul une fois finie.
    // SECONDAIRE → enveloppée : un échec Gmail ne bloque jamais la suite du tick.
    if (!estBudgetDepasse()) {
      try { traiterGmailHistorique_(estBudgetDepasse); }
      catch (e) { journalErreur_('Gmail', 'Campagne historique différée : ' + e); }
    }

    // Migration taxonomie (#8, ADR-0002) : re-classe l'EXISTANT (pré-refonte) vers la nouvelle
    // taxonomie, EN PLACE, une page par tick. APRÈS l'intake (le flux vivant garde la priorité),
    // AVANT les intentions (la précision documentaire prime, cap produit ADR-0001). Campagne finie
    // → 1 Property lue, coût nul. ENVELOPPÉE : un échec ne doit jamais bloquer la suite du tick.
    if (!estBudgetDepasse()) {
      try { appliquerMigrationTaxonomie_(estBudgetDepasse); }
      catch (e) { journalErreur_('Migration', 'Migration taxonomie différée : ' + e); }
    }

    // Phase 3 : détection d'actions/rdv dans TOUS les mails récents → Tasks/Calendar.
    // En dernier, budget restant seulement : le classement documentaire (déjà validé en
    // prod) garde toujours la priorité sur ce nouveau flux.
    if (!estBudgetDepasse()) traiterIntentionsMail_(estBudgetDepasse);
  } finally {
    // `releaseLock` DOIT toujours s'exécuter : un try/finally imbriqué garantit sa libération même si
    // un `journalErreur_` d'un catch ci-dessous lève à son tour (panne Sheet) — sinon le verrou resterait
    // pris jusqu'à expiration (revue apps-script-quota).
    try {
      // Heartbeat (ADR-0004) EN PREMIER dans le finally : « le moteur a exécuté un tick ». Écrit même si
      // l'intake a partiellement échoué — c'est ce timestamp que le chien de garde surveille. Property
      // unique, robuste ; un échec ici ne doit rien casser (enveloppé).
      try { PropertiesService.getScriptProperties().setProperty('DriveAI_LAST_TICK', String(Date.now())); }
      catch (e) { /* écriture Property impossible : rien de plus à faire */ }
      try { flushUsage_(); } catch (e) { journalErreur_('Cout', 'Flush usage impossible : ' + e); }
      // Observabilité (ADR-0006), SECONDAIRE et enveloppé : un échec ne doit jamais bloquer le tick.
      // Le heartbeat Santé s'écrit même si l'intake a partiellement échoué (d'où le finally).
      try { majSante_(); } catch (e) { journalErreur_('Santé', 'MàJ Santé impossible : ' + e); }
      try { bornerJournal_(); } catch (e) { journalErreur_('Santé', 'Journal borné impossible : ' + e); }
    } finally {
      verrou.releaseLock();
    }
  }
}

/**
 * Auto-rejeu sur changement de version de classement.
 *
 * Compare `CONFIG.VERSION` (figée dans le code déployé) à la dernière version vue
 * (Script Property `DriveAI_VERSION`). Si elles diffèrent — juste après un déploiement
 * qui change la logique — on RENVOIE les dépôts manuels partis en revue vers 00·À trier
 * pour qu'ils soient reclassés par le tick courant (l'ancien outil manuel `rejouerLaRevue` a été retiré — audit 2026-07-02).
 *
 * Sûreté (audits flotte) : opération **réversible uniquement** (déplacement, jamais de
 * corbeille), **bornée** par le garde-temps + un plafond/run, et **reprenable** — la
 * version n'est posée QUE lorsque tout le rejeu est consommé. La passe 2 reprend AUSSI les
 * copies legacy « [REVUE] confiance » d'origine Gmail (cf. sa docstring) ; les docs déjà
 * classés ne sont jamais touchés (idempotence préservée → pas de re-OCR/re-LLM inutile).
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
 * Placé TÔT dans le tick (AVANT l'intake) pour ne jamais être affamé — sinon l'ancien Drive ne se
 * vide jamais (cf. incident file figée : le rangement en dernier ne recevait plus de budget). Mais
 * gated sur une file BASSE (`nbFichiersATrier_ < RANGEMENT_SEUIL_FILE`, cf. tickDriveAI) : on ne
 * collecte de NOUVEAUX fichiers que si 00·À trier a de la place — on DRAINE avant d'ALIMENTER.
 * L'intake du même tick (puis des suivants) reprend ensuite la file ; borné, reprenable.
 *
 * Barre de progression (onglet `Progression`) : le total « en vrac » est RECENSÉ dans un tick DÉDIÉ —
 * tant que la base n'est pas posée, ce tick NE range PAS et consacre son budget au comptage — sinon,
 * sur un gros Drive, un recensement lancé APRÈS une page de rangement ne finirait jamais et la barre
 * n'apparaîtrait pas (cf. revue quotas). Filet anti-blocage : après `RANGEMENT_RECENS_ESSAIS_MAX`
 * recensements incomplets, on accepte le compte PARTIEL comme base approximative — le rangement n'est
 * JAMAIS bloqué par le recensement ; la re-base (`majProgression_`) et la finalisation sur le vrai
 * signal de fin corrigent tout écart.
 *
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerRangementInitial_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RANGEMENT') === CONFIG.RANGEMENT_TAG) return; // déjà fait pour ce tag
  if (estBudgetDepasse()) return; // pas de budget ce tick → repris au prochain

  var proteges = ensembleDomainesProteges_();

  // Nouveau tag = nouvelle campagne de rangement → on repart d'une barre VIERGE (re-recensement du
  // total). Sinon la barre resterait figée sur le total de la campagne précédente.
  if (props.getProperty('DriveAI_RANGEMENT_BARRE_TAG') !== CONFIG.RANGEMENT_TAG) {
    props.deleteProperty('DriveAI_RANGEMENT_BASE');
    props.deleteProperty('DriveAI_RANGEMENT_TRAITES');
    props.deleteProperty('DriveAI_RANGEMENT_RECENS');
    props.setProperty('DriveAI_RANGEMENT_BARRE_TAG', CONFIG.RANGEMENT_TAG);
  }

  // PHASE 1 — RECENSEMENT (tick dédié, une fois) : pose la base de la barre. Ce tick NE range pas.
  if (props.getProperty('DriveAI_RANGEMENT_BASE') === null) {
    var essaisFaits = Number(props.getProperty('DriveAI_RANGEMENT_RECENS')) || 0;
    // Onglet visible DÈS ce tick, même avant la fin du comptage (recensement léger = rapide, mais
    // filet si un très gros Drive l'étale malgré tout sur plusieurs passes).
    try { ecrireRecensement_(essaisFaits); }
    catch (e) { journalErreur_('Progression', 'Init barre impossible : ' + e); }

    var rec = compterVracRacines_(estBudgetDepasse);
    var essais = essaisFaits + 1;
    if (!rec.complet && essais < CONFIG.RANGEMENT_RECENS_ESSAIS_MAX) {
      props.setProperty('DriveAI_RANGEMENT_RECENS', String(essais)); // partiel → réessai au prochain tick
      return;
    }
    props.setProperty('DriveAI_RANGEMENT_BASE', String(rec.n || 0)); // complet, ou partiel accepté (filet)
    props.setProperty('DriveAI_RANGEMENT_TRAITES', '0');
    try { ecrireProgression_(0, rec.n || 0, false); }
    catch (e) { journalErreur_('Progression', 'Init barre impossible : ' + e); }
    return; // barre initialisée ; le rangement démarre au tick suivant
  }

  // PHASE 2 — RANGEMENT : une page bornée, puis mise à jour de la barre (cumul des fichiers sortis).
  var r = rangerUnePage_(estBudgetDepasse, proteges);
  if (r.deplaces) {
    try { majProgression_(r.deplaces); }
    catch (e) { journalErreur_('Progression', 'MàJ barre impossible : ' + e); }
    journalInfo_('Rangement', r.deplaces + ' fichier(s) en vrac renvoyé(s) dans 00·À trier (rangement initial auto).');
  }
  // Terminé seulement quand une passe NON interrompue ne collecte plus aucun fichier en vrac.
  if (!r.reste && r.collectes === 0) {
    try { finaliserProgression_(); } // vrai signal de fin → barre à 100 %
    catch (e) { journalErreur_('Progression', 'Finalisation barre impossible : ' + e); }
    props.setProperty('DriveAI_RANGEMENT', CONFIG.RANGEMENT_TAG);
    journalInfo_('Rangement', 'Rangement initial terminé — tout le Drive est passé au pipeline (tag « ' + CONFIG.RANGEMENT_TAG + ' »).');
  }
}

/** Vrai si le grand rangement initial est déjà terminé pour le tag courant (lecture cheap, 1 Property). */
function rangementTermine_() {
  return PropertiesService.getScriptProperties().getProperty('DriveAI_RANGEMENT') === CONFIG.RANGEMENT_TAG;
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
  // Marc peut avoir SUPPRIMÉ le dossier `00·À vérifier` (vide depuis P1-16, on l'y a invité) : dans
  // ce cas il n'y a rien à rejouer — sans ce garde, l'exception ferait échouer le rejeu À CHAQUE
  // tick après un bump de VERSION (la Property ne se poserait jamais), pour toujours.
  var dossier;
  try { dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER); }
  catch (e) { return false; } // plus de dossier revue = plus de legacy à reprendre
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
      // Erreur isolée par fil (ex. getMessages/piecesJointes) : on saute ce fil sans
      // interrompre le scan Gmail — chaque PJ est déjà protégée dans traiterDocument_.
      try { traiterFil_(fils[i], estBudgetDepasse); }
      catch (e) { journalErreur_('Gmail', 'Fil ignoré (erreur) : ' + e); }
    }
    debutPage += CONFIG.PAGE_FILS;
  }
}

/**
 * Traite toutes les PJ d'un fil. Chaque PJ est indépendante (idempotence par clé).
 * Garde-temps vérifié PAR PJ (revue C12) : un message dense (20 PJ inédites) ne doit pas crever
 * le mur des 6 min — le fil interrompu est rejoué au tick suivant (offset 0, PJ indexées sautées).
 * @param {GmailThread} fil
 * @param {function():boolean} estBudgetDepasse
 */
function traiterFil_(fil, estBudgetDepasse) {
  var messages = fil.getMessages();
  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var pjs = piecesJointes_(message);
    for (var p = 0; p < pjs.length; p++) {
      if (estBudgetDepasse()) return;
      traiterPjGmail_(message, p, pjs[p]);
    }
  }
}

/**
 * Chantier #12 (ADR-0010 §1) — HISTORIQUE Gmail complet : ancre FIXE + pagination par OFFSET,
 * terminée par une PASSE DE VÉRIFICATION propre.
 *
 * Le scan vivant ne voit que 30 j. Cette campagne parcourt tout l'historique de PJ : l'ancre
 * (`before:<date>`) est posée au 1ᵉʳ run et NE BOUGE JAMAIS — l'ensemble de recherche est donc
 * STABLE pour le courrier normal (le passé ne reçoit pas de nouveaux mails), ce qui rend l'offset
 * persistant sûr (leçon « pagination mouvante » : le piège est l'insertion en tête, pas l'offset).
 * MAIS l'ORDRE, lui, peut bouger (contre-vérification adversariale) : Gmail trie les fils par
 * DERNIER message — un vieux fil qui reçoit un message SANS PJ se téléporte derrière l'offset sans
 * jamais entrer dans le scan vivant ; une suppression en zone déjà scannée décale un fil innocent
 * sous l'offset ; une erreur transitoire fait sauter un fil. Ces trois pertes silencieuses ont le
 * MÊME antidote (leçon durable « ne figer le fait que quand une passe ne collecte plus rien ») :
 * une page vide ne termine PAS la campagne — si la passe qui s'achève a eu la moindre activité
 * (PJ inédite, fil sauté), l'offset repart à 0 pour une passe de VÉRIFICATION ; « terminé » ne se
 * fige que sur une passe 100 % propre. Une passe de re-lecture est quasi gratuite (PJ indexées =
 * métadonnées seules, cf. Pipeline) et la convergence est garantie : l'Index ne fait que croître.
 *
 * Discipline de quota (revue flotte) : le quota RUNTIME des déclencheurs (~90 min/j) est LA borne —
 * chaque run traite au plus `GMAIL_HISTO_MAX_PJ_INEDITES` PJ inédites, garde-temps et plafond
 * vérifiés PAR PJ (un message dense de 20 PJ ne crève plus le mur des 6 min). L'offset n'avance
 * que si la page a été entièrement parcourue : une page interrompue est rejouée (idempotente) et
 * converge — chaque rejeu indexe jusqu'au plafond d'inédites, jusqu'au rejeu qui parcourt tout.
 * Un fil en erreur est sauté avec un compteur d'Échecs (revisité par la passe suivante, ABANDONNÉ
 * après `QUARANTAINE_MAX` essais pour ne pas bloquer la terminaison — l'Échec reste inscrit).
 * @param {function():boolean} estBudgetDepasse
 */
function traiterGmailHistorique_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_GMAIL_HISTO') === 'terminé') return; // campagne finie (1 lecture)

  var ancre = props.getProperty('DriveAI_GMAIL_HISTO_ANCRE');
  if (!ancre) {
    // 1ᵉʳ run : ancre posée UNE FOIS à −30 j (le vivant couvre le récent ; le chevauchement d'un
    // jour autour de la borne est idempotent — aucun souci de fuseau de `before:`).
    var d = new Date();
    d.setDate(d.getDate() - 30);
    ancre = dateGmail_(d);
    props.setProperty('DriveAI_GMAIL_HISTO_ANCRE', ancre);
  }
  var offset = Number(props.getProperty('DriveAI_GMAIL_HISTO_OFFSET')) || 0;

  var fils;
  try {
    fils = pageFilsHisto_(ancre, offset);
  } catch (e) {
    journalErreur_('Gmail', 'Recherche historique impossible : ' + e);
    return; // re-tenté au tick suivant, offset inchangé
  }
  if (!fils.length) {
    // Fin d'une PASSE — pas forcément de la campagne. Si la passe a eu de l'activité (inédite,
    // fil sauté), un fil a PU être manqué par un décalage d'ordre : on re-vérifie depuis 0.
    if (props.getProperty('DriveAI_GMAIL_HISTO_PASSE_SALE') === 'oui') {
      // Ordre VOULU (leçon « écritures d'état ») : l'offset d'abord, la marque ensuite — une coupure
      // entre les deux laisse SALE posé (une passe de plus, bénin) au lieu d'un « terminé » prématuré.
      props.setProperty('DriveAI_GMAIL_HISTO_OFFSET', '0');
      props.deleteProperty('DriveAI_GMAIL_HISTO_PASSE_SALE');
      journalInfo_('Gmail', 'Passe historique finie avec activité (' + offset + ' fils) — ' +
        'passe de VÉRIFICATION relancée depuis l\'offset 0.');
    } else {
      props.setProperty('DriveAI_GMAIL_HISTO', 'terminé');
      journalInfo_('Gmail', 'Campagne HISTORIQUE terminée : une passe complète sans rien collecter (' +
        offset + ' fils, ancre ' + ancre + ').');
    }
    return;
  }

  var inedites = 0;
  var pageComplete = true;
  var saleMarquee = props.getProperty('DriveAI_GMAIL_HISTO_PASSE_SALE') === 'oui';
  var marquerSale = function () {
    if (!saleMarquee) { props.setProperty('DriveAI_GMAIL_HISTO_PASSE_SALE', 'oui'); saleMarquee = true; }
  };
  for (var i = 0; i < fils.length && pageComplete; i++) {
    var filId = 'offset ' + (offset + i); // repli si getId échoue aussi
    try {
      filId = fils[i].getId(); // clé STABLE du compteur d'échecs (la position ne l'est pas)
      var messages = fils[i].getMessages();
      for (var mi = 0; mi < messages.length && pageComplete; mi++) {
        var pjs = piecesJointes_(messages[mi]);
        for (var p = 0; p < pjs.length; p++) {
          // Garde-temps ET plafond PAR PJ : la page interrompue est rejouée au tick suivant
          // (les PJ déjà traitées, inscrites à l'Index au fil de l'eau, seront gratuites).
          if (estBudgetDepasse() || inedites >= CONFIG.GMAIL_HISTO_MAX_PJ_INEDITES) {
            pageComplete = false;
            break;
          }
          if (!indexContient_(cleAttachement_(messages[mi], p, pjs[p]))) {
            inedites++;
            marquerSale(); // la passe a collecté → une passe de vérification suivra
          }
          traiterPjGmail_(messages[mi], p, pjs[p]);
        }
      }
    } catch (e) {
      var essais = 0;
      try { essais = incrementerEchec_('histo|fil|' + filId); } catch (e2) { /* compteur indisponible */ }
      if (essais >= CONFIG.QUARANTAINE_MAX) {
        // Abandon DÉFINITIF (pas de marque « sale ») : un fil irrécupérable ne doit pas empêcher
        // la campagne de se terminer — l'onglet Échecs garde la trace pour un rejeu manuel.
        journalErreur_('Gmail', 'Fil historique ABANDONNÉ après ' + essais + ' essais (' + filId + ') : ' + e);
      } else {
        marquerSale(); // le fil sera revisité par la passe de vérification
        journalErreur_('Gmail', 'Fil historique sauté (' + filId + ', essai ' + (essais || '?') + ') : ' + e);
      }
    }
  }
  if (pageComplete) props.setProperty('DriveAI_GMAIL_HISTO_OFFSET', String(offset + fils.length));
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
    placer: function (dossierId, nom) { return deposer_(pj.copyBlob(), dossierId, nom); }
  });
}
