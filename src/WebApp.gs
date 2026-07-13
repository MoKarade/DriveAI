/**
 * WebApp.gs — pont HTTP entre l'app (SPA)/GitHub Actions et le moteur. Trois actions :
 *
 *  - (défaut) « Vérifier maintenant » (#20) : déclencheur PONCTUEL du tick (idempotent,
 *    LockService, garde-temps) — réponse non lue par l'app (no-cors).
 *  - `action=recherche-ia` (C21-03) : traduit une question libre de Marc en PLAN de recherche
 *    (filtres Index + mots-clés plein texte) via Haiku JSON strict. Le LLM ne voit QUE la
 *    question et les noms de domaines (jamais un contenu de document — ADR-0007) ; l'app
 *    exécute elle-même les recherches avec le jeton de Marc. La clé Anthropic reste dans les
 *    Script Properties. L'app lit la réponse : elle POSTe en Content-Type text/plain (requête
 *    « simple », pas de préflight) — Apps Script renvoie alors un CORS lisible (`*`).
 *  - `action=sync-miroir` (ADR-0017) : GitHub Actions y POSTe un lot de fichiers du dépôt →
 *    copiés en texte dans un dossier Drive dédié (`Miroir.gs`). Secret DÉDIÉ (voir ci-dessous).
 *
 * Secrets — DEUX, jamais confondus :
 *  - `DriveAI_WEBAPP_SECRET` (défaut, recherche-ia) : exposé côté NAVIGATEUR par conception
 *    (app/src/config.ts — « la sécurité vient du login Google, pas du secret »).
 *  - `DriveAI_SYNC_SECRET` (sync-miroir) : DÉDIÉ, JAMAIS exposé à un navigateur — connu
 *    seulement de GitHub Actions (secret CI) et du script. Pire abus s'il fuit : écrire des
 *    fichiers texte dans UN dossier dédié (`_Miroir du dépôt`), jamais toucher à un document
 *    classé ni à l'état (Index/Journal/Entités).
 *
 * Garde-fous communs : anti-rafale par action, plafonds bornés, sortie whitelistée par un
 * parseur strict (fonctions PURES testées).
 */

function doPost(e) {
  var reponse = { ok: false };
  try {
    var action = e && e.parameter ? e.parameter.action : '';
    if (action === 'sync-miroir') {
      reponse = verifierSecretSync_(e) ? actionSyncMiroir_(e) : { ok: false, erreur: 'refusé' };
    } else {
      var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_WEBAPP_SECRET');
      var recu = e && e.parameter ? e.parameter.secret : '';
      if (!attendu || !recu || recu !== attendu) {
        reponse.erreur = 'refusé';
      } else if (action === 'recherche-ia') {
        reponse = actionRechercheIA_(e);
      } else if (action === 'analyse-ciblee') {
        reponse = actionAnalyseCiblee_(e);
      } else if (action === 'demande-tri') {
        reponse = actionDemandeTri_(e);
      } else if (action === 'demande-intentions') {
        reponse = actionDemandeIntentions_(e);
      } else if (action === 'pas-suspect') {
        reponse = actionPasSuspect_(e);
      } else {
        reponse = actionTickPonctuel_();
      }
    }
  } catch (err) {
    reponse.erreur = String(err);
  }
  return ContentService.createTextOutput(JSON.stringify(reponse))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Action par défaut : passage immédiat (#20) ---------- */

function actionTickPonctuel_() {
  var reponse = { ok: false };
  var props = PropertiesService.getScriptProperties();
  var dernier = Number(props.getProperty('DriveAI_DERNIER_PONCTUEL')) || 0;
  if (Date.now() - dernier < 60 * 1000) {
    reponse.ok = true;
    reponse.message = 'déjà demandé il y a moins d’une minute';
  } else {
    props.setProperty('DriveAI_DERNIER_PONCTUEL', String(Date.now()));
    ScriptApp.newTrigger('tickPonctuel').timeBased().after(1000).create();
    journalInfo_('WebApp', 'Passage immédiat demandé depuis l’app.');
    reponse.ok = true;
    reponse.message = 'passage lancé';
  }
  return reponse;
}

/** Cible du déclencheur ponctuel : nettoie ses déclencheurs puis lance le tick normal. */
function tickPonctuel() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'tickPonctuel') ScriptApp.deleteTrigger(t);
    });
  } catch (e) { /* best-effort — le tick prime */ }
  tickDriveAI();
}

/* ---------- Recherche IA (C21-03) ---------- */

/**
 * Question libre → plan de recherche. La requête porte la question dans le CORPS
 * (JSON `{question}` en text/plain) ; jamais dans l'URL (les URL finissent dans des logs).
 */
function actionRechercheIA_(e) {
  var props = PropertiesService.getScriptProperties();

  // Anti-rafale dédié (5 s) — indépendant de celui du tick. (Contrôlé ici, mais consommé
  // seulement après validation : une question invalide ne coûte rien, elle ne bloque rien.)
  var derniere = Number(props.getProperty('DriveAI_DERNIERE_RECHERCHE_IA')) || 0;
  if (Date.now() - derniere < CONFIG.IA_RECHERCHE_MIN_INTERVALLE_MS) {
    return { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  }

  // Plafond QUOTIDIEN (budget LLM < 10 $/mois) : compteur `AAAA-MM-JJ|n`. Sans LockService
  // exprès : le verrou du script est tenu jusqu'à 6 min par le tick — le prendre ici rendrait
  // la recherche inutilisable. Une rafale concurrente peut dépasser marginalement le plafond,
  // seulement si le secret a déjà fui (risque borné, quelques cents).
  var jour = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var brut = String(props.getProperty('DriveAI_RECHERCHES_IA_JOUR') || '');
  var compteur = brut.indexOf(jour + '|') === 0 ? Number(brut.split('|')[1]) || 0 : 0;
  if (compteur >= CONFIG.IA_RECHERCHE_MAX_JOUR) {
    return { ok: false, erreur: 'plafond quotidien de recherches IA atteint' };
  }

  var question = null;
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    question = validerQuestionIA_(corps.question);
  } catch (err) {
    question = null;
  }
  if (question === null) {
    return { ok: false, erreur: 'question invalide (3 à 300 caractères)' };
  }
  props.setProperty('DriveAI_DERNIERE_RECHERCHE_IA', String(Date.now()));

  // Contexte d'exécution web app ≠ tick : panne persistée chargée, compteur d'usage propre.
  chargerPannePlateforme_();
  if (estPannePlateforme_()) {
    // Panne de compte API : échec rapide SANS consommer le plafond (leçon R1 : une panne de
    // plateforme ne s'impute jamais au flux — sinon Marc reste bloqué après la recharge).
    return { ok: false, erreur: 'IA momentanément indisponible (compte API en panne) — réessaie plus tard' };
  }
  reinitialiserUsage_();
  var texte;
  try {
    texte = appelAnthropicTexte_(
      CONFIG.LLM_MODELE,
      promptRechercheIA_(),
      'Question : ' + question,
      CONFIG.LLM_MAX_TOKENS_RECHERCHE
    );
  } finally {
    try { flushUsage_(); } catch (err) { /* mesure de coût perdue pour cet appel — accepté */ }
  }
  // Le plafond compte les appels SERVIS (texte reçu) — jamais les échecs réseau/panne.
  if (texte !== null) {
    props.setProperty('DriveAI_RECHERCHES_IA_JOUR', jour + '|' + (compteur + 1));
  }

  var plan = parserPlanIA_(texte, domainesAutorises_());
  if (!plan) {
    return { ok: false, erreur: 'recherche IA indisponible (LLM muet ou réponse illisible)' };
  }
  journalInfo_('WebApp', 'Recherche IA servie (' + (compteur + 1) + '/' + CONFIG.IA_RECHERCHE_MAX_JOUR + ' aujourd’hui).');
  return { ok: true, plan: plan };
}

/** Prompt système : sortie JSON STRICTE, domaines bornés à la taxonomie réelle. */
function promptRechercheIA_() {
  return 'Tu traduis une question en langage naturel sur des documents personnels en un plan de ' +
    'recherche JSON STRICT (aucun texte hors du JSON).\n' +
    'Schéma : {"texte": string|null, "domaine": string|null, "annee": string|null, ' +
    '"motsCles": string[], "explication": string}\n' +
    '- "texte" : le terme le plus discriminant pour filtrer par NOM de fichier (null si aucun).\n' +
    '- "domaine" : EXACTEMENT un de : ' + domainesAutorises_().join(' | ') + ' — ou null.\n' +
    '- "annee" : "AAAA" si la question vise une année, sinon null.\n' +
    '- "motsCles" : 1 à 5 mots-clés PLEIN TEXTE, tels qu\'ils apparaîtraient DANS le document, ' +
    'sans mots vides (peu de mots précis > beaucoup de mots vagues).\n' +
    '- "explication" : une phrase COURTE en français (≤ 15 mots), ce que tu as compris.\n' +
    'Exemple — Question : « mes factures Hydro de l\'an dernier » → ' +
    '{"texte":"hydro","domaine":"02 · Finances","annee":"2025","motsCles":["facture","Hydro-Québec"],' +
    '"explication":"Factures Hydro-Québec de 2025."}\n' +
    'Date du jour : ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.';
}

/* ---------- Analyse ciblée des mails (C28-06, plan P2) ---------- */

/**
 * Dépose une requête Gmail LIBRE que le tick balaiera par pages (`balayerAnalyseCiblee_`,
 * Intentions.gs). AUCUN coût ici : le dépôt écrit deux Script Properties — le vrai travail
 * (Gmail + LLM) est borné côté tick (plafonds/run + frein budget campagnes §2.6). Une nouvelle
 * requête REMPLACE la campagne en cours (offset remis à zéro). La requête voyage dans le CORPS
 * (JSON `{requete}` en text/plain) — jamais dans l'URL (les URL finissent dans des logs).
 */
function actionAnalyseCiblee_(e) {
  var props = PropertiesService.getScriptProperties();

  // Anti-rafale (5 s) — même politique que la recherche IA : consommé après validation.
  var derniere = Number(props.getProperty('DriveAI_DERNIERE_ANALYSE_CIBLEE')) || 0;
  if (Date.now() - derniere < 5000) {
    return { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  }

  var requete = null;
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    requete = validerRequeteCiblee_(corps.requete);
  } catch (err) {
    requete = null;
  }
  if (requete === null) {
    return { ok: false, erreur: 'requête invalide (3 à 200 caractères, une seule ligne, sans in:spam/in:trash/in:anywhere)' };
  }
  props.setProperty('DriveAI_DERNIERE_ANALYSE_CIBLEE', String(Date.now()));

  // Progression/série d'échecs de l'ancienne campagne effacées AVANT de poser la nouvelle
  // requête (ordre d'écritures : une coupure entre les deux donne un re-scan quasi gratuit,
  // jamais une nouvelle requête accrochée à un vieil offset — revue quotas).
  props.deleteProperty('DriveAI_CUSTOM_SCAN_OFFSET');
  props.deleteProperty('DriveAI_CUSTOM_SCAN_ECHECS');
  props.deleteProperty('DriveAI_CUSTOM_SCAN_PAUSE');
  props.setProperty('DriveAI_CUSTOM_SCAN_QUERY', requete);
  // La requête n'est PAS journalisée (comme la question de la recherche IA : elle peut révéler
  // une intention personnelle — la réponse HTTP, elle, ne va qu'au navigateur de Marc).
  journalInfo_('WebApp', 'Analyse ciblée programmée (requête de ' + requete.length + ' caractères).');
  return { ok: true, message: 'analyse programmée — le moteur balaie « ' + requete + ' » à ses prochains passages' };
}

/* ---------- Tri & intentions À LA DEMANDE (C28-16) ---------- */

/**
 * Dépose une demande de TRI paramétrée par Marc depuis l'app (fenêtre / archiver / plafond).
 * AUCUN travail ici : validation stricte + Property de demande — c'est `scanDemandeTri_`
 * (TriGmail.gs) qui exécute au tick, EN TÊTE du flux vivant. Si le quota Gmail est suspendu,
 * une sonde FORCÉE re-teste tout de suite (décision Marc : « tenter une fois quand même ») —
 * toujours mort → `QUOTA_GMAIL`, l'app affiche l'heure de reprise.
 */
function actionDemandeTri_(e) {
  var props = PropertiesService.getScriptProperties();

  // Anti-rafale (5 s) — même politique que l'analyse ciblée : consommé après validation.
  var derniere = Number(props.getProperty('DriveAI_DERNIERE_DEMANDE_TRI')) || 0;
  if (Date.now() - derniere < 5000) {
    return { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  }

  var demande = null;
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    demande = validerDemandeTri_(corps);
  } catch (err) {
    demande = null;
  }
  if (demande === null) {
    return { ok: false, erreur: 'paramètres invalides (fenêtre 1/7/30, archiver booléen, plafond 1..' + CONFIG.TRI_DEMANDE_PLAFOND_MAX + ')' };
  }
  props.setProperty('DriveAI_DERNIERE_DEMANDE_TRI', String(Date.now()));

  if (!forcerSondeQuotaGmail_()) {
    return { ok: false, erreur: 'QUOTA_GMAIL' };
  }

  // Progression d'une éventuelle demande précédente effacée AVANT la nouvelle (ordre d'écritures :
  // une coupure donne au pire un re-scan quasi gratuit, jamais une demande accrochée à un vieil offset).
  props.deleteProperty('DriveAI_TRI_DEMANDE_OFFSET');
  props.deleteProperty('DriveAI_TRI_DEMANDE_FAITS');
  props.setProperty('DriveAI_TRI_DEMANDE', JSON.stringify(demande));
  journalInfo_('WebApp', 'Tri à la demande programmé (fenêtre ' + demande.fenetre + ' j, archiver : ' +
    (demande.archiver ? 'oui' : 'non') + ', plafond ' + demande.plafond + ' fils).');
  return actionTickPonctuel_(); // passage immédiat : le tri démarre dans la ~minute
}

/**
 * Relance l'analyse des INTENTIONS (tâches/RDV) sur toute la fenêtre 30 j, en ignorant le mur
 * « déjà vu » du scan avant (c'est tout l'intérêt du bouton). Même mécanique de demande.
 */
function actionDemandeIntentions_(e) {
  var props = PropertiesService.getScriptProperties();

  var derniere = Number(props.getProperty('DriveAI_DERNIERE_DEMANDE_INTENTIONS')) || 0;
  if (Date.now() - derniere < 5000) {
    return { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  }
  props.setProperty('DriveAI_DERNIERE_DEMANDE_INTENTIONS', String(Date.now()));

  if (!forcerSondeQuotaGmail_()) {
    return { ok: false, erreur: 'QUOTA_GMAIL' };
  }

  props.deleteProperty('DriveAI_INTENTIONS_DEMANDE_OFFSET');
  props.setProperty('DriveAI_INTENTIONS_DEMANDE', String(Date.now()));
  journalInfo_('WebApp', 'Analyse des intentions à la demande programmée (fenêtre 30 j complète).');
  return actionTickPonctuel_();
}

/**
 * « PAS SUSPECT » 1-clic (C28-19, ADR-0020) : apprend l'expéditeur DE CONFIANCE (onglet
 * `Confiance`, dédupliqué) et dépose la demande de re-tri (Property `DriveAI_PAS_SUSPECT`,
 * liste additive) consommée par le tick SOUS SON VERROU — JAMAIS de suppression de lignes
 * d'Index ici : doPost court en concurrence du run (déviation documentée vs plan C28-19).
 * Le libellé ⚠ Gmail du fil n'est jamais retiré (§2.3) : le moteur l'ignore désormais.
 */
function actionPasSuspect_(e) {
  var props = PropertiesService.getScriptProperties();

  var derniere = Number(props.getProperty('DriveAI_DERNIER_PAS_SUSPECT')) || 0;
  if (Date.now() - derniere < 5000) {
    return { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  }

  var threadId = '';
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    threadId = validerThreadId_(corps.threadId);
  } catch (err) {
    threadId = '';
  }
  if (!threadId) return { ok: false, erreur: 'threadId invalide' };
  props.setProperty('DriveAI_DERNIER_PAS_SUSPECT', String(Date.now()));

  // Lecture du fil (adresse de l'expéditeur) — même règle de référence que le tri : le dernier
  // message qui ne vient PAS de Marc (sinon un fil où il a répondu apprendrait SA propre adresse).
  var adresse = '';
  try {
    var fil = GmailApp.getThreadById(threadId);
    if (!fil) return { ok: false, erreur: 'fil introuvable' };
    var messages = fil.getMessages();
    var proprio = (CONFIG.PROPRIETAIRE_EMAIL || '').toLowerCase();
    for (var i = messages.length - 1; i >= 0; i--) {
      var a = adresseExpediteur_(messages[i].getFrom());
      if (a && a !== proprio) { adresse = a; break; }
    }
  } catch (err) {
    if (signalerPanneGmail_(err)) return { ok: false, erreur: 'QUOTA_GMAIL' };
    return { ok: false, erreur: 'fil illisible : ' + err };
  }
  if (!adresse) return { ok: false, erreur: 'expéditeur introuvable sur ce fil' };

  apprendreConfiance_(adresse);

  // Demande de re-tri ADDITIVE (plusieurs clics avant le prochain tick s'accumulent, jamais écrasés).
  var ids = [];
  try { ids = JSON.parse(props.getProperty('DriveAI_PAS_SUSPECT') || '[]') || []; } catch (err) { ids = []; }
  if (ids.indexOf(threadId) === -1) ids.push(threadId);
  props.setProperty('DriveAI_PAS_SUSPECT', JSON.stringify(ids));

  journalInfo_('WebApp', 'Pas-suspect : « ' + adresse + ' » ajouté à Confiance (fil re-trié au prochain passage).');
  actionTickPonctuel_(); // passage immédiat — le fil est re-jugé « sain » dans la ~minute
  return { ok: true, message: 'Expéditeur de confiance : ' + adresse + ' — le fil est re-trié dans la minute.' };
}

/**
 * Valide un threadId Gmail (donnée UTILISATEUR via HTTP) : hexadécimal court, jamais un
 * séparateur de clé d'Index (`|`) — il entre dans le préfixe `tri|<id>|` purgé par le tick.
 * PURE (testée). @return {string} threadId propre, ou ''
 */
function validerThreadId_(brut) {
  var t = String(brut || '').trim();
  return /^[a-zA-Z0-9]{8,32}$/.test(t) ? t : '';
}

/**
 * Valide les paramètres du tri à la demande (données UTILISATEUR via HTTP). PURE (testée).
 * @param {*} corps  `{fenetre, archiver, plafond}`
 * @return {?{fenetre:number, archiver:boolean, plafond:number}} demande propre, ou null
 */
function validerDemandeTri_(corps) {
  if (!corps || typeof corps !== 'object') return null;
  var fenetre = Number(corps.fenetre);
  if (fenetre !== 1 && fenetre !== 7 && fenetre !== 30) return null;
  if (typeof corps.archiver !== 'boolean') return null;
  var plafond = Number(corps.plafond);
  if (!isFinite(plafond) || plafond !== Math.floor(plafond)) return null;
  if (plafond < 1 || plafond > CONFIG.TRI_DEMANDE_PLAFOND_MAX) return null;
  return { fenetre: fenetre, archiver: corps.archiver, plafond: plafond };
}

/**
 * Valide la requête Gmail de l'analyse ciblée (donnée UTILISATEUR via HTTP) : chaîne 3..200
 * caractères, une seule ligne (les caractères de contrôle sont refusés — une Property ne doit
 * jamais transporter autre chose qu'une requête de recherche), jamais de spam/corbeille
 * (`in:spam`/`in:trash`/`in:anywhere` refusés — les scans du moteur n'y mettent JAMAIS les
 * pieds ; le balayeur suffixe en plus `-in:spam -in:trash`, défense en profondeur). PURE (testée).
 * @param {*} q
 * @return {?string} requête nettoyée, ou null
 */
function validerRequeteCiblee_(q) {
  if (typeof q !== 'string') return null;
  if (/[\u0000-\u001F\u007F]/.test(q)) return null; // saut de ligne, tab, contrôle → refus
  var propre = q.replace(/\s+/g, ' ').trim();
  if (propre.length < 3 || propre.length > 200) return null;
  if (/(^|[\s(])-?in:(spam|trash|anywhere)\b/i.test(propre)) return null; // jamais de spam/corbeille
  return propre;
}

/**
 * Valide la question (donnée UTILISATEUR via HTTP) : chaîne 3..300 caractères. PURE (testée).
 * @param {*} q
 * @return {?string} question nettoyée, ou null
 */
function validerQuestionIA_(q) {
  if (typeof q !== 'string') return null;
  var propre = q.replace(/\s+/g, ' ').trim();
  if (propre.length < 3 || propre.length > 300) return null;
  return propre;
}

/**
 * Parse et WHITELISTE le plan renvoyé par le LLM (sortie LLM = donnée non fiable). PURE (testée).
 * Champs inconnus jetés, types forcés, domaine borné à la taxonomie, année AAAA, ≤ 5 mots-clés.
 * @param {?string} texte
 * @param {string[]} domaines
 * @return {?Object}
 */
function parserPlanIA_(texte, domaines) {
  if (!texte) return null;
  var brut = null;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    var m = String(texte).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { brut = JSON.parse(m[0]); } catch (e2) { return null; }
  }
  if (!brut || typeof brut !== 'object') return null;

  var plan = {};
  if (typeof brut.texte === 'string' && brut.texte.trim()) plan.texte = brut.texte.trim().slice(0, 100);
  if (typeof brut.domaine === 'string' && domaines.indexOf(brut.domaine) !== -1) plan.domaine = brut.domaine;
  if (typeof brut.annee === 'string' && /^\d{4}$/.test(brut.annee)) plan.annee = brut.annee;
  var mots = [];
  if (Array.isArray(brut.motsCles)) {
    for (var i = 0; i < brut.motsCles.length && mots.length < 5; i++) {
      if (typeof brut.motsCles[i] === 'string' && brut.motsCles[i].trim()) {
        mots.push(brut.motsCles[i].trim().slice(0, 50));
      }
    }
  }
  plan.motsCles = mots;
  if (typeof brut.explication === 'string') plan.explication = brut.explication.trim().slice(0, 200);
  if (!plan.texte && !plan.domaine && !plan.annee && mots.length === 0) return null; // plan vide = inutilisable
  return plan;
}
