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
  // Décision Marc 2026-07-06 : plus de mail immédiat — l'épisode est journalisé et l'état
  // « silencieux » apparaît dans le résumé hebdo (etatSysteme_). L'AUTO-RÉPARATION, elle, a déjà
  // été tentée avant d'arriver ici et reste le vrai filet.
  journalErreur_('Chien de garde', 'Moteur silencieux (dernier tick : ' + quand + ') — ' + corps.split('\n')[0]);
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
  var voulu = intervalleTickVoulu_();
  if (props.getProperty('DriveAI_TICK_MINUTES') === String(voulu)) return;

  var nouveau = ScriptApp.newTrigger('tickDriveAI').timeBased().everyMinutes(voulu).create();
  props.setProperty('DriveAI_TICK_MINUTES', String(voulu)); // marqué FAIT dès la création
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tickDriveAI' && t.getUniqueId() !== nouveau.getUniqueId()) {
      ScriptApp.deleteTrigger(t);
    }
  });
  journalInfo_('Setup', 'Intervalle du déclencheur ajusté à ' + voulu + ' min.');
}

/**
 * Intervalle SOUHAITÉ du tick (#22, choix Marc : un réglage global) : l'app écrit
 * `Réglages!B2` (A2 = TICK_MINUTES) ; valeur absente/invalide → CONFIG.TICK_MINUTES.
 * Une lecture Sheet par tick (2 cellules) — négligeable.
 */
function intervalleTickVoulu_() {
  try {
    var v = feuille_('Réglages').getRange('B2').getValue();
    var valide = validerTickMinutes_(v);
    if (valide !== null) return valide;
  } catch (e) { /* onglet illisible → défaut */ }
  return CONFIG.TICK_MINUTES;
}

/**
 * Valide une valeur de tick venue de la Sheet (donnée UTILISATEUR) : seules les valeurs
 * qu'Apps Script accepte ET qui respectent les quotas sont admises — jamais < 5 min
 * (1 min ferait 1440 runs/j : quotas Sheet/Gmail). PURE (testée).
 * @param {*} v
 * @return {?number} minutes valides, ou null
 */
function validerTickMinutes_(v) {
  var n = Number(v);
  return (n === 5 || n === 10 || n === 15 || n === 30) ? n : null;
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
    chargerPannePlateforme_(); // panne de compte PERSISTÉE (R2) : suspend les sources, re-sonde ≤ 1×/h
    chargerPanneGmail_();      // quota Gmail JOURNALIER épuisé (C28-15) : suspend les scans Gmail, re-sonde ≤ 2 h
    chargerPanneConfigApi_();  // API Tasks/Calendar non activée (C28-22) : suspend les intentions, re-sonde ≤ 24 h
    reinitialiserTriApprisCache_();  // table adresse→libellé du tri (#16), rechargée 1×/run
    reinitialiserConfianceCache_();  // expéditeurs « pas suspect » (C28-19), rechargés 1×/run
    reinitialiserLibellesCache_();   // libellés Gmail de Marc, rechargés 1×/run
    reinitialiserPromoSetCache_();   // fils CATEGORY_PROMOTIONS (signal déterministe), 1×/run
    reinitialiserPanneEcriture_();   // panne d'ÉCRITURE Gmail : nouvelle chance à chaque run
    reinitialiserUsage_();     // compteur de coût LLM du run (mesure réelle, P1-09)
    reinitialiserFreinBudget_(); // frein budget des campagnes (R3, §2.6), relu 1×/run

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
    var estBudgetDepasse = function () { return Date.now() - debut > budgetMsRun_(); };
    // « BUDGET TAIL » (incident 2026-07-23) : garde-temps ÉTENDU au VRAI mur Apps Script
    // (CONFIG.BUDGET_MS = 4,5 min) pour les tâches PURE I/O Drive/Sheet SANS risque LLM — la
    // consolidation (moveTo + hash MD5). Le flux vivant reste borné au budget de tick 3 min
    // (budgetMsRun_ sous ANALYSE_V2, marge de sécurité face aux appels Sonnet) ; la consolidation,
    // remontée juste après lui, n'utilise que le RELIQUAT jusqu'à 4,5 min : elle est ainsi GARANTIE
    // de s'exécuter à chaque tick sans jamais voler une ms au flux vivant (leçon §7 « tôt + gated »).
    var estBudgetDepasseStandard = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };

    // Auto-rejeu sur nouvelle version du classement : renvoie les DÉPÔTS partis en revue vers
    // 00·À trier pour reclassement. SECONDAIRE → enveloppé d'un try/catch : un échec ne doit
    // JAMAIS bloquer l'intake (même principe que l'ajustement du déclencheur ci-dessus).
    try { appliquerRejeuSiNouvelleVersion_(estBudgetDepasse); }
    catch (e) { journalErreur_('Maintenance', 'Rejeu de version différé : ' + e); }

    // Dé-quarantaine AUTOMATIQUE one-shot (R3, gatée par CONFIG.DEQUARANTAINE_TAG) : relance les
    // quarantainés — les 3 échecs datant d'une panne de compte sont des faux positifs (vécu :
    // 32 fichiers de la panne du 1ᵉʳ juillet sautés en silence 6 jours). Le RÉTABLISSEMENT d'une
    // panne ré-arme ce one-shot tout seul (Llm.signalerRetablissement_). NOYAU seulement
    // (`dequarantainerLignes_`, JAMAIS `dequarantaine()` : son tickDriveAI() final serait
    // réentrant — verrou relâché par le finally du tick imbriqué, bloquant revue R3), et clés
    // `drive|` seulement (re-présentables par la collecte ; une clé Gmail hors fenêtre serait
    // libérée « dans le vide » et perdrait son bouton Relancer dans l'app). Le noyau invalide les
    // caches → les libérés sont re-traités dès CE tick. SECONDAIRE → enveloppée.
    try {
      var propsDQ = PropertiesService.getScriptProperties();
      if (propsDQ.getProperty('DriveAI_DEQUARANTAINE') !== CONFIG.DEQUARANTAINE_TAG) {
        dequarantainerLignes_('drive|');
        propsDQ.setProperty('DriveAI_DEQUARANTAINE', CONFIG.DEQUARANTAINE_TAG);
      }
    } catch (e) { journalErreur_('Maintenance', 'Dé-quarantaine automatique différée : ' + e); }

    // SEED des entités de Marc (C28-26, décision Marc 2026-07-17 : « c'est toi qui le fais ») —
    // one-shot gaté par tag : valide d'office SES listes (4 logements, 3 véhicules, 2 employeurs,
    // 6 écoles) et DÉVALIDE les entités bancaires de 02 (« pas de dossier par banque »).
    // SECONDAIRE → enveloppée.
    try { seedEntitesMarc_(); }
    catch (e) { journalErreur_('Entités', 'Seed des entités différé : ' + e); }

    // #18 (décision Marc : seuil 3) : auto-valide les entités en_attente vues ≥ 3 fois, AVANT la
    // matérialisation (le dossier naît au même tick). Jamais une variante, jamais un générique,
    // jamais la zone protégée. SECONDAIRE → enveloppée. COUPÉE depuis le 2026-07-17
    // (ENTITES_AUTO_VALIDATION: false — « l'ajout de dossiers vraiment sécurisé, utile seulement » :
    // seuls le seed, le formulaire de correction et l'app de Marc valident désormais une entité).
    if (CONFIG.ENTITES_AUTO_VALIDATION) {
      try { autoValiderEntitesFrequentes_(estBudgetDepasse); }
      catch (e) { journalErreur_('Entités', 'Auto-validation différée : ' + e); }
    }

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
    if (!estBudgetDepasse() && !estPannePlateforme_() && !rangementTermine_() &&
        !budgetCampagnesAtteint_() &&
        nbFichiersATrier_(CONFIG.RANGEMENT_SEUIL_FILE) < CONFIG.RANGEMENT_SEUIL_FILE) {
      try { appliquerRangementInitial_(estBudgetDepasse); }
      catch (e) { journalErreur_('Rangement', 'Grand rangement différé : ' + e); }
    }

    // INTAKE : draine la file (dépôts manuels + sortie du grand rangement) et les PJ Gmail.
    // R2 : pendant une panne de COMPTE API persistée, TOUTES les sources sont suspendues — les
    // scans ne produiraient rien (les docs sont sautés) et re-parcourir la fenêtre Gmail à chaque
    // tick brûle le quota de lecture quotidien (vécu 07-06 : moteur re-bloqué 24 h APRÈS la
    // recharge). La re-sonde (chargerPannePlateforme_) rouvre tout automatiquement, ≤ 1 h.
    if (!estPannePlateforme_()) {
    traiterGmail_(estBudgetDepasse);                       // source 1 : PJ Gmail
    if (!estBudgetDepasse()) traiterDepots_(estBudgetDepasse); // source 2 : 00·À trier (draine la file)

    // Source 3 : fichiers PARTAGÉS récents (ADR-0005). COPIE dans l'arbo (comme Gmail), pipeline commun.
    // ENVELOPPÉE : un échec réseau (liste/quota Drive) ne doit jamais bloquer les intentions ci-dessous
    // ni le reste du tick. Budget-gatée : ne démarre pas si l'intake documentaire a déjà épuisé le budget.
    if (!estBudgetDepasse()) {
      try { collecterPartages_(estBudgetDepasse); }
      catch (e) { journalErreur_('Partages', 'Collecte des fichiers partagés différée : ' + e); }
    }

    // ⚖️ ORDRE D'ÉQUITÉ STRICT (C28-15, décision Marc « équilibre strict » 2026-07-10) : le FLUX
    // VIVANT Gmail (intentions puis tri — le tri dépend du flag `important` posé par les
    // intentions) passe AVANT toutes les campagnes de masse. Avant, il passait en DERNIER : la
    // campagne historique épuisait le quota d'appels Gmail dès ~08h10 et les mails de Marc
    // n'étaient plus ni triés ni archivés de la journée (vécu : 4-17 fils/j au lieu de ~90).
    // Le premier arrivé se sert — désormais c'est le vivant. ENVELOPPÉS : une erreur (quota
    // compris — détectée par signalerPanneGmail_ dans le catch) ne bloque jamais la suite du tick.
    if (!estBudgetDepasse()) {
      try { traiterIntentionsMail_(estBudgetDepasse); }
      catch (e) {
        if (!signalerPanneGmail_(e)) journalErreur_('Intentions', 'Intentions différées : ' + e);
      }
    }
    if (!estBudgetDepasse()) {
      try { trierFilsGmail_(estBudgetDepasse); }
      catch (e) {
        if (!signalerPanneGmail_(e)) journalErreur_('TriGmail', 'Tri Gmail différé : ' + e);
      }
    }

    // ⚖️ CONSOLIDATION de l'arborescence (C28-26, ADR-0024) — REMONTÉE ICI, juste après le flux
    // vivant et AVANT les campagnes legacy + la réconciliation (incident 2026-07-23 : placée EN
    // DERNIER, elle était affamée et ne draînait JAMAIS — anti-patron leçon §7). « BUDGET TAIL » :
    // gatée par estBudgetDepasseStandard (mur 4,5 min) et non par le budget de tick 3 min — elle est
    // PURE I/O Drive (moveTo + hash MD5, aucun risque LLM). Le flux vivant ci-dessus (borné à 3 min)
    // a déjà eu sa part ; la consolidation n'utilise que le reliquat → GARANTIE à chaque tick sans
    // rien lui voler. EXÉCUTION avant GÉNÉRATION (drainer avant d'alimenter). Bornée par ses budgets
    // run + quotidien (12/20 min) + la contre-pression. SECONDAIRES → enveloppées (jamais bloquer l'intake).
    if (CONFIG.CONSOLIDATION_EXEC_ACTIF && !estBudgetDepasseStandard()) {
      try { appliquerPlanConsolidation_(estBudgetDepasseStandard); }
      catch (e) { journalErreur_('ConsolidationExec', 'Exécution du plan différée : ' + e); }
    }
    if (CONFIG.CONSOLIDATION_ACTIF && !estBudgetDepasseStandard()) {
      try { genererPlanConsolidation_(estBudgetDepasseStandard); }
      catch (e) { journalErreur_('Consolidation', 'Génération du plan différée : ' + e); }
    }

    // Campagne HISTORIQUE Gmail (#12, ADR-0010 §1) : remonte tout l'historique de PJ par tranches
    // ancrées. APRÈS le flux vivant (priorité stricte C28-15). Coût nul une fois finie.
    // SECONDAIRE → enveloppée : un échec Gmail ne bloque jamais la suite du tick.
    if (!estBudgetDepasse() && !budgetCampagnesAtteint_()) {
      try { traiterGmailHistorique_(estBudgetDepasse); }
      catch (e) {
        if (!signalerPanneGmail_(e)) journalErreur_('Gmail', 'Campagne historique différée : ' + e);
      }
    }

    // Migration taxonomie (#8, ADR-0002) : re-classe l'EXISTANT (pré-refonte) vers la nouvelle
    // taxonomie, EN PLACE, une page par tick. APRÈS l'intake (le flux vivant garde la priorité),
    // AVANT les intentions (la précision documentaire prime, cap produit ADR-0001). Campagne finie
    // → 1 Property lue, coût nul. ENVELOPPÉE : un échec ne doit jamais bloquer la suite du tick.
    if (!estBudgetDepasse() && !budgetCampagnesAtteint_()) {
      try { appliquerMigrationTaxonomie_(estBudgetDepasse); }
      catch (e) { journalErreur_('Migration', 'Migration taxonomie différée : ' + e); }
    }

    // Re-analyse v2 CIBLÉE (#26, C26-08, ADR-0018) : re-passe les domaines mal classés
    // (REANALYSE_CIBLES : 03, 08) au pipeline v2, EN PLACE, une page par tick. Ne démarre qu'après
    // la FIN de m1 (une seule campagne de masse à la fois — garde dans appliquerReanalyseCiblee_).
    // Même famille que la migration : après l'intake, gatée par le frein budget, enveloppée.
    if (!estBudgetDepasse() && !budgetCampagnesAtteint_()) {
      try { appliquerReanalyseCiblee_(estBudgetDepasse); }
      catch (e) { journalErreur_('Réanalyse', 'Re-analyse ciblée différée : ' + e); }
    }

    // Dry-run v2 (#26, C26-07, ADR-0015) : preuve avant/après sur échantillon réel, ZÉRO mutation
    // Drive (planRoutageV2_ seul — jamais deciderRoutageV2_). Interrupteur DÉDIÉ (DRYRUN_V2_ACTIF,
    // OFF par défaut) : n'affecte JAMAIS le flux vivant ni CONFIG.ANALYSE_V2. Même famille que la
    // migration (après l'intake, gatée par le frein budget campagnes, enveloppée).
    if (!estBudgetDepasse() && !budgetCampagnesAtteint_()) {
      try { appliquerDryRunV2_(estBudgetDepasse); }
      catch (e) { journalErreur_('DryRunV2', 'Dry-run v2 différé : ' + e); }
    }

    // (Intentions et tri Gmail : remontés AVANT les campagnes — ordre d'équité strict C28-15.)

    // Réorg IA (#21, C21-04/06) : APPLIQUE d'abord les actions validées par Marc (déplacements/
    // renommages de dossiers, re-vérif zone protégée par mutation — jamais de suppression), PUIS
    // propose un nouveau plan si demandé (drainer avant d'alimenter). Tout en DERNIER (à la
    // demande, jamais prioritaire sur l'intake), budget-gaté, enveloppé.
    if (!estBudgetDepasse()) {
      try { etapeReorg_(estBudgetDepasse); }
      catch (e) { journalErreur_('Reorg', 'Étape réorg différée : ' + e); }
    }

    // Réconciliation Index↔Drive (C28-07, plan P3) : campagne de fond PERPÉTUELLE sur le
    // reliquat de budget — OBSERVE Drive (jamais ne le modifie) et aligne l'Index append-only
    // (statuts `déplacé`/`corbeillé`). SECONDAIRE → enveloppée : un échec ne bloque jamais l'intake.
    if (!estBudgetDepasse()) {
      try { synchroniserIndex_(estBudgetDepasse); }
      catch (e) { journalErreur_('Maintenance', 'Réconciliation Index différée : ' + e); }
    }

    // (Consolidation C28-26 : REMONTÉE juste après le flux vivant — voir bloc « BUDGET TAIL » plus
    // haut. Elle était ici EN DERNIER et se faisait affamer par la réconciliation + les campagnes
    // legacy, incident 2026-07-23.)

    } // fin de la suspension R2 (panne de compte API)
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
      // Progression LIVE des opérations (C28-18) : rendu centralisé UNE fois par tick, dans le
      // finally — les avancées PARTIELLES d'un run interrompu sont capturées aussi. Enveloppé.
      try { majProgressions_(); } catch (e) { journalErreur_('Progression', 'MàJ progression impossible : ' + e); }
      // Télémétrie coûts & quotas (C28-24) : même contrat que Progression — une seule écriture
      // par tick, lue en poll par l'app. Enveloppée : un échec ne bloque jamais le reste.
      try { majTelemetrie_(); } catch (e) { journalErreur_('Télémétrie', 'MàJ télémétrie impossible : ' + e); }
      // Résumé hub (C28-27) : les 4 métriques du widget hubperso.com sont PRÉ-CALCULÉES ici, une
      // fois par tick, et persistées (Property DriveAI_HUB_SUMMARY). L'action hub-summary de la web
      // app ne fait plus que LIRE cette Property → réponse en ms (le calcul à la volée dépassait le
      // délai du broker Vercel — 500 en boucle). SECONDAIRE et enveloppée : un échec ne bloque rien.
      try { majResumeHub_(); } catch (e) { journalErreur_('Hub', 'MàJ résumé hub impossible : ' + e); }
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
  // (Le RENDU de la barre est centralisé dans majProgressions_ au finally du tick — C28-18.)
  if (props.getProperty('DriveAI_RANGEMENT_BASE') === null) {
    var essaisFaits = Number(props.getProperty('DriveAI_RANGEMENT_RECENS')) || 0;
    var rec = compterVracRacines_(estBudgetDepasse);
    var essais = essaisFaits + 1;
    if (!rec.complet && essais < CONFIG.RANGEMENT_RECENS_ESSAIS_MAX) {
      props.setProperty('DriveAI_RANGEMENT_RECENS', String(essais)); // partiel → réessai au prochain tick
      return;
    }
    props.setProperty('DriveAI_RANGEMENT_BASE', String(rec.n || 0)); // complet, ou partiel accepté (filet)
    props.setProperty('DriveAI_RANGEMENT_TRAITES', '0');
    props.deleteProperty('DriveAI_RANGEMENT_RECENS'); // compteur d'essais soldé avec le recensement
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
  if (estPanneGmail_()) return; // quota Gmail épuisé (C28-15) : suspendu jusqu'à la re-sonde
  var debutPage = 0;
  // La panne de compte peut être détectée EN COURS de run (re-sonde qui échoue) : on sort tôt —
  // continuer à lister des fils dont chaque document sera sauté ne ferait que brûler du quota Gmail.
  while (!estBudgetDepasse() && !estPannePlateforme_() && !estPanneGmail_()) {
    var fils;
    try {
      fils = pageFils_(debutPage);
    } catch (e) {
      if (signalerPanneGmail_(e)) return; // quota épuisé : suspension posée, jamais un « échec »
      notifierEchec_('Gmail', 'Recherche des mails impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_(); // re-sonde concluante : la suspension persistée est levée
    if (!fils.length) break; // fin de la fenêtre 30 jours

    for (var i = 0; i < fils.length; i++) {
      if (estBudgetDepasse()) {
        journalInfo_('Pipeline', 'Budget temps atteint — reprise au prochain tick.');
        return;
      }
      if (estPannePlateforme_()) return; // détectée en cours de run → stop (cf. ci-dessus)
      // Erreur isolée par fil (ex. getMessages/piecesJointes) : on saute ce fil sans
      // interrompre le scan Gmail — chaque PJ est déjà protégée dans traiterDocument_.
      // SAUF le quota (C28-15) : il frappe TOUS les fils suivants — suspension et sortie.
      try { traiterFil_(fils[i], estBudgetDepasse); }
      catch (e) {
        if (signalerPanneGmail_(e)) return;
        journalErreur_('Gmail', 'Fil ignoré (erreur) : ' + e);
      }
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
    if (estBudgetDepasse()) return; // aussi PAR MESSAGE : un long fil sans PJ « réelles » ne doit
    var message = messages[m];      // pas enchaîner les getAttachments après l'épuisement du budget
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
 * Discipline de quota (2ᵉ contre-vérification) : le quota RUNTIME des déclencheurs (~90 min/j) est
 * LA borne, et un plafond PAR RUN ne la protège pas (288 ticks × 25 s = 2 h/j !). Deux étages :
 * (1) budget QUOTIDIEN `GMAIL_HISTO_BUDGET_JOUR_MS` (ms réellement consommées, comptées par jour
 * dans les Properties) — la campagne s'arrête pour la journée, le vivant garde son quota ;
 * (2) par run, au plus `GMAIL_HISTO_MAX_PJ_INEDITES` PJ inédites, garde-temps et plafond vérifiés
 * à CHAQUE niveau de boucle — fil, message, PJ (une page de fils bavards sans PJ « réelles » ne
 * fait plus d'appels Gmail après le budget ; un message dense ne crève plus le mur des 6 min).
 * L'offset n'avance que si la page a été entièrement parcourue : une page interrompue est rejouée
 * (idempotente) et converge. Un fil en erreur n'est COMPTÉ (compteur d'Échecs `histo|fil|<id>`)
 * qu'à la COMPLÉTION de la page — jamais sur un rejeu (sinon une erreur transitoire de 15 min
 * brûlerait les 3 essais en 3 ticks) : une erreur qui guérit avant la complétion ne laisse AUCUNE
 * trace, une erreur persistante donne un essai par PASSE, puis ABANDON définitif à
 * `QUARANTAINE_MAX` (la terminaison n'est jamais bloquée — l'onglet Échecs garde la trace).
 * Terminaison : il faut DEUX passes propres consécutives (une mutation d'ordre — suppression —
 * peut masquer un fil pendant la passe de vérification elle-même ; la re-passe est quasi gratuite).
 * @param {function():boolean} estBudgetDepasse
 */
function traiterGmailHistorique_(estBudgetDepasse) {
  if (estPanneGmail_()) return; // quota Gmail épuisé (C28-15) : suspendu jusqu'à la re-sonde
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_GMAIL_HISTO') === 'terminé') return; // campagne finie (1 lecture)

  // Budget QUOTIDIEN : borne la JOURNÉE, pas seulement le run (quota runtime ~90 min/j).
  var aujourdhui = dateGmail_(new Date());
  var msJour = props.getProperty('DriveAI_GMAIL_HISTO_JOUR') === aujourdhui
    ? Number(props.getProperty('DriveAI_GMAIL_HISTO_MS_JOUR')) || 0
    : 0;
  if (msJour >= CONFIG.GMAIL_HISTO_BUDGET_JOUR_MS) return; // repris demain (le vivant garde le quota)

  var debutRunMs = Date.now();
  try {
    traiterPageHistorique_(props, estBudgetDepasse);
  } finally {
    // Comptage RÉEL (une passe de re-lecture, quasi gratuite, n'entame presque pas le budget).
    props.setProperty('DriveAI_GMAIL_HISTO_JOUR', aujourdhui);
    props.setProperty('DriveAI_GMAIL_HISTO_MS_JOUR', String(msJour + (Date.now() - debutRunMs)));
  }
}

/**
 * Un run de la campagne historique : une page de fils, sous plafonds. Voir traiterGmailHistorique_.
 * @param {Properties} props
 * @param {function():boolean} estBudgetDepasse
 */
function traiterPageHistorique_(props, estBudgetDepasse) {
  // Plafond QUOTIDIEN de FILS (C28-21, plan architecte) : le budget en ms ne borne pas un quota
  // d'APPELS — la passe de VÉRIFICATION, « gratuite » côté traitement (Index), lisait des
  // centaines de fils en 20 min et drainait le quota Gmail du compte en continu (vécu 11-13/07 :
  // re-mort en 8 s-6 min à chaque re-sonde, flux vivant affamé). Compté dans SON unité (fils).
  var aujourdhui = dateGmail_(new Date());
  var filsJour = props.getProperty('DriveAI_GMAIL_HISTO_JOUR') === aujourdhui
    ? Number(props.getProperty('DriveAI_GMAIL_HISTO_FILS_JOUR')) || 0
    : 0;
  if (props.getProperty('DriveAI_GMAIL_HISTO_JOUR') !== aujourdhui) {
    // Purge au ROLLOVER (revue flotte C28-21) : la date est écrite par le finally de
    // traiterGmailHistorique_ à CHAQUE run, mais le compteur seulement quand des fils sont lus —
    // sans cette purge, un 1ᵉʳ run du jour à 0 fil (page VIDE de fin de passe, erreur de
    // recherche) laisse le compteur de la VEILLE sous la date du jour : maxCeRun = 0 → campagne
    // silencieusement bloquée une journée entière à chaque frontière de passe.
    props.setProperty('DriveAI_GMAIL_HISTO_FILS_JOUR', '0');
  }
  var maxCeRun = Math.min(CONFIG.GMAIL_HISTO_MAX_FILS_PAR_RUN,
    Math.max(0, CONFIG.GMAIL_HISTO_MAX_FILS_JOUR - filsJour));
  if (maxCeRun <= 0) return; // plafond de fils du jour atteint — repris demain (aucune recherche)

  var ancre = props.getProperty('DriveAI_GMAIL_HISTO_ANCRE');
  if (!ancre) {
    // 1ᵉʳ run : ancre posée UNE FOIS à −29 j — `before:` est EXCLUSIF et `newer_than:30d` peut être
    // glissant (30×24 h) : −29 garantit un VRAI chevauchement d'un jour avec le scan vivant
    // (idempotent par l'Index), quel que soit l'arrondi — jamais de trou entre les deux scans.
    var d = new Date();
    d.setDate(d.getDate() - 29);
    ancre = dateGmail_(d);
    props.setProperty('DriveAI_GMAIL_HISTO_ANCRE', ancre);
  }
  var offset = Number(props.getProperty('DriveAI_GMAIL_HISTO_OFFSET')) || 0;

  var fils;
  try {
    fils = pageFilsHisto_(ancre, offset);
  } catch (e) {
    if (signalerPanneGmail_(e)) return; // quota épuisé : suspension posée, offset inchangé
    journalErreur_('Gmail', 'Recherche historique impossible : ' + e);
    return; // re-tenté au tick suivant, offset inchangé
  }
  signalerRetablissementGmail_();
  if (!fils.length) {
    // Fin d'une PASSE — pas forcément de la campagne. Si la passe a eu de l'activité (inédite,
    // fil sauté), un fil a PU être manqué par un décalage d'ordre : on re-vérifie depuis 0.
    // Ordre des écritures VOULU (leçon « écritures d'état ») : l'offset d'abord, les marques
    // ensuite — une coupure laisse au pire une passe de plus, jamais un « terminé » prématuré.
    if (props.getProperty('DriveAI_GMAIL_HISTO_PASSE_SALE') === 'oui') {
      props.setProperty('DriveAI_GMAIL_HISTO_OFFSET', '0');
      props.deleteProperty('DriveAI_GMAIL_HISTO_PASSES_PROPRES');
      props.deleteProperty('DriveAI_GMAIL_HISTO_PASSE_SALE');
      journalInfo_('Gmail', 'Passe historique finie avec activité (' + offset + ' fils) — ' +
        'passe de VÉRIFICATION relancée depuis l\'offset 0.');
      return;
    }
    // Passe propre : il en faut DEUX consécutives (l'ordre peut avoir muté PENDANT la passe).
    var propres = (Number(props.getProperty('DriveAI_GMAIL_HISTO_PASSES_PROPRES')) || 0) + 1;
    if (propres >= 2) {
      props.setProperty('DriveAI_GMAIL_HISTO', 'terminé');
      journalInfo_('Gmail', 'Campagne HISTORIQUE terminée : ' + propres + ' passes complètes sans rien ' +
        'collecter (' + offset + ' fils, ancre ' + ancre + ').');
    } else {
      props.setProperty('DriveAI_GMAIL_HISTO_OFFSET', '0');
      props.setProperty('DriveAI_GMAIL_HISTO_PASSES_PROPRES', String(propres));
      journalInfo_('Gmail', 'Passe historique propre (' + propres + '/2) — passe de confirmation relancée.');
    }
    return;
  }

  var inedites = 0;
  var filsParcourus = 0; // frein d'appels API (C28-15) : chaque fil LU coûte du quota Gmail
  var pageComplete = true;
  var echecsRun = []; // fils en erreur de CE run — comptés seulement si la page se complète
  var saleMarquee = props.getProperty('DriveAI_GMAIL_HISTO_PASSE_SALE') === 'oui';
  var marquerSale = function () {
    if (!saleMarquee) { props.setProperty('DriveAI_GMAIL_HISTO_PASSE_SALE', 'oui'); saleMarquee = true; }
  };
  // Garde-temps ET plafond à CHAQUE niveau (fil, message, PJ) : sans la garde au niveau fil/message,
  // une page de vieux fils bavards SANS PJ « réelles » (inline seulement — `has:attachment` matche
  // aussi l'inline) ferait des centaines d'appels Gmail APRÈS l'épuisement du budget.
  var doitSarreter = function () {
    return estBudgetDepasse() || estPannePlateforme_() || estPanneGmail_() ||
      inedites >= CONFIG.GMAIL_HISTO_MAX_PJ_INEDITES ||
      filsParcourus >= maxCeRun; // par-run ET reliquat du plafond quotidien (C28-21)
  };
  for (var i = 0; i < fils.length && pageComplete; i++) {
    if (doitSarreter()) { pageComplete = false; break; }
    var filId = 'offset ' + (offset + i); // repli si getId échoue aussi
    try {
      filId = fils[i].getId(); // clé STABLE du compteur d'échecs (la position ne l'est pas)
      filsParcourus++;
      var messages = fils[i].getMessages();
      for (var mi = 0; mi < messages.length && pageComplete; mi++) {
        if (doitSarreter()) { pageComplete = false; break; }
        var pjs = piecesJointes_(messages[mi]);
        for (var p = 0; p < pjs.length; p++) {
          // La page interrompue est rejouée au tick suivant (les PJ déjà traitées, inscrites à
          // l'Index au fil de l'eau, seront gratuites) — l'offset n'avance pas.
          if (doitSarreter()) { pageComplete = false; break; }
          if (!indexContient_(cleAttachement_(messages[mi], p, pjs[p]))) {
            inedites++;
            marquerSale(); // la passe a collecté → une passe de vérification suivra
          }
          traiterPjGmail_(messages[mi], p, pjs[p]);
        }
      }
    } catch (e) {
      // Quota Gmail épuisé (C28-15) : panne de PLATEFORME — jamais imputée au fil, la page
      // interrompue rejouera après la re-sonde (offset inchangé, PJ indexées gratuites).
      if (signalerPanneGmail_(e)) { pageComplete = false; break; }
      // Compté PLUS TARD, seulement si la page se complète : une page rejouée (plafond/budget) ne
      // doit pas brûler les essais d'un fil toutes les 5 min — un essai par PASSE, pas par tick.
      echecsRun.push({ filId: filId, erreur: String(e) });
    }
  }
  // Coût RÉEL compté même sur page INTERROMPUE (déviation documentée au plan C28-21, qui comptait
  // dans `pageComplete`) : le rejeu re-lira ces fils — le quota de LECTURE est consommé, page
  // complétée ou non. Sinon, dès que le reliquat du jour devient plus petit qu'une page, la page
  // ne se complète jamais et ses re-lectures ne seraient JAMAIS comptées : drainage silencieux à
  // chaque tick, le bug même que ce plafond corrige. La DATE du compteur reste écrite par
  // `traiterGmailHistorique_` (finally), SEUL écrivain de DriveAI_GMAIL_HISTO_JOUR.
  if (filsParcourus > 0) {
    props.setProperty('DriveAI_GMAIL_HISTO_FILS_JOUR', String(filsJour + filsParcourus));
  }
  if (pageComplete) {
    for (var k = 0; k < echecsRun.length; k++) {
      var essais = 0;
      try { essais = incrementerEchec_('histo|fil|' + echecsRun[k].filId); } catch (e2) { /* compteur indisponible */ }
      if (essais === CONFIG.QUARANTAINE_MAX) {
        // Abandon DÉFINITIF (pas de marque « sale ») : un fil irrécupérable ne doit pas empêcher
        // la campagne de se terminer — l'onglet Échecs garde la trace pour un rejeu manuel.
        journalErreur_('Gmail', 'Fil historique ABANDONNÉ après ' + essais + ' essais (' +
          echecsRun[k].filId + ') : ' + echecsRun[k].erreur);
      } else if (essais < CONFIG.QUARANTAINE_MAX) {
        marquerSale(); // le fil sera revisité par la passe de vérification
        journalErreur_('Gmail', 'Fil historique sauté (' + echecsRun[k].filId + ', essai ' +
          (essais || '?') + ') : ' + echecsRun[k].erreur);
      }
      // essais > QUARANTAINE_MAX : déjà annoncé abandonné — silencieux, pas de marque « sale ».
    }
    props.setProperty('DriveAI_GMAIL_HISTO_OFFSET', String(offset + fils.length));
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
    placer: function (dossierId, nom) { return deposer_(pj.copyBlob(), dossierId, nom); }
  });
}
