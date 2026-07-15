/**
 * TriGmail.gs — Chantier #16 (ADR-0012) : tri natif de la boîte Gmail, au fil de l'eau.
 * Remplace la tâche Cowork hebdomadaire de Marc. Durci par 4 lentilles adversariales (2 rondes).
 *
 * PREMIÈRE surface d'ÉCRITURE Gmail du moteur (scope `gmail.modify`, décision explicite de Marc
 * 2026-07-06). Écritures autorisées : poser un libellé EXISTANT sur un fil, archiver un fil
 * (retrait de la boîte — réversible). INTERDITS À JAMAIS (verrou par test de surface CI) :
 * corbeille, suppression, Spam, création/destruction/retrait de libellés, service avancé Gmail,
 * API REST Gmail.
 *
 * Architecture :
 *   - scan AVANT (`TRI_REQUETE` = boîte, 30 j) : le courrier NEUF + les fils dont l'état a changé
 *     (nouveau message OU passage lu/non-lu — la clé d'idempotence inclut les deux) ; s'arrête au
 *     mur de fils déjà à jour. C'est lui qui archive un mail LU APRÈS son tri initial.
 *   - scan ARRIÈRE (rattrapage du STOCK une seule fois) : ancre FIXE posée au déploiement +
 *     OFFSET persistant sur l'ensemble figé `after:<ancre−31j> before:<ancre>` (leçon C12 :
 *     l'appartenance d'un ensemble borné par des dates fixes est stable → l'offset y est sûr ;
 *     le jour-frontière d'un curseur de date n'existe plus). Les fils déjà HORS boîte sont sautés
 *     sans coût (`isInInbox`). « terminé » figé sur page vide.
 *   - une panne d'ÉCRITURE (scope manquant, API Gmail en panne) est SYSTÉMIQUE : elle stoppe le
 *     run sans imputer d'échec aux fils (même principe que la panne de compte LLM, R1).
 */

/**
 * Décision PURE du tri d'un fil (testée exhaustivement — c'est ELLE qui porte les règles).
 * @param {{categorie:?string, important:boolean, suspect:boolean, zoneProtegee:boolean,
 *          promoDeterministe:boolean, entierementLu:boolean}} f
 * @return {{libelles:string[], archiver:boolean, statut:string}}
 */
function decisionTri_(f) {
  // 1. Suspect : prime sur tout — visible en boîte, aucune autre écriture que le libellé.
  if (f.suspect) {
    return { libelles: [CONFIG.TRI_LIBELLES.SUSPECT], archiver: false, statut: 'suspect' };
  }
  // 2. Catégorie introuvable/incertaine → À vérifier, jamais archivé (règle de sûreté Cowork).
  if (!f.categorie) {
    return { libelles: [CONFIG.TRI_LIBELLES.A_VERIFIER], archiver: false, statut: 'tri-a-verifier' };
  }
  var libelles = [f.categorie];
  if (f.important) libelles.push(CONFIG.TRI_LIBELLES.A_TRAITER);
  var archiver;
  if (f.important) {
    archiver = false; // ⏰ : la boîte de Marc sert de todo — seul MARC archive ces fils
  } else if (f.promoDeterministe && !f.zoneProtegee) {
    archiver = true;  // promo/newsletter : archivée même non lue (signaux DÉTERMINISTES uniquement)
  } else {
    archiver = f.entierementLu; // règle générale de Marc : archivé seulement s'il l'a OUVERT
  }
  return { libelles: libelles, archiver: archiver, statut: 'trié' };
}

/**
 * Heuristiques phishing DÉTERMINISTES, volontairement ÉTROITES (leçon « garde-fou étroit ») :
 * (a) PJ exécutable (.exe/.scr — jamais légitime) ; (b) PJ archive/page (.zip/.html) SEULEMENT
 * combinée à un sujet d'urgence ou d'identifiants (un .zip de photos ne doit pas marquer ⚠️
 * définitivement — revue flotte) ; (c) sujet cumulant urgence ET identifiants/paiement.
 * Le signal LLM (miniCategorie_) complète — l'un OU l'autre suffit à marquer Suspect. PURE.
 * @param {string} sujet
 * @param {string[]} nomsPj
 * @return {boolean}
 */
function heuristiquePhishing_(sujet, nomsPj) {
  var s = String(sujet || '').toLowerCase();
  var urgence = false, credentiels = false;
  for (var u = 0; u < CONFIG.TRI_MOTS_URGENCE.length; u++) {
    if (s.indexOf(CONFIG.TRI_MOTS_URGENCE[u]) !== -1) { urgence = true; break; }
  }
  for (var c = 0; c < CONFIG.TRI_MOTS_CREDENTIELS.length; c++) {
    if (s.indexOf(CONFIG.TRI_MOTS_CREDENTIELS[c]) !== -1) { credentiels = true; break; }
  }
  for (var i = 0; i < (nomsPj || []).length; i++) {
    var nom = String(nomsPj[i]).toLowerCase();
    for (var e = 0; e < CONFIG.TRI_PJ_EXECUTABLES.length; e++) {
      if (nom.slice(-CONFIG.TRI_PJ_EXECUTABLES[e].length) === CONFIG.TRI_PJ_EXECUTABLES[e]) return true;
    }
    for (var d = 0; d < CONFIG.TRI_PJ_DOUTEUSES.length; d++) {
      if (nom.slice(-CONFIG.TRI_PJ_DOUTEUSES[d].length) === CONFIG.TRI_PJ_DOUTEUSES[d] &&
          (urgence || credentiels)) return true;
    }
  }
  return urgence && credentiels;
}

/**
 * Adresse e-mail nue d'un champ expéditeur (« Nom Affiché <a@b.c> » → « a@b.c »), minuscule.
 * La table apprise est clée là-dessus — JAMAIS sur le nom affiché (usurpable). PURE.
 * @param {string} expediteur
 * @return {string}
 */
function adresseExpediteur_(expediteur) {
  var m = String(expediteur || '').match(/<([^>]+)>/);
  var brut = m ? m[1] : String(expediteur || '');
  return brut.trim().toLowerCase();
}

/**
 * Forme NORMALISÉE d'un libellé (minuscule, sans accents) — pour tolérer les variantes du LLM
 * (« finance/impôt » ↔ « Finance/Impôt ») sans jamais inventer : on rend TOUJOURS le nom EXACT
 * du libellé de Marc. PURE.
 * @param {string} libelle
 * @return {string}
 */
function normaliserLibelle_(libelle) {
  return String(libelle || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Parse PUR de la réponse du mini-appel catégorie. La catégorie n'est acceptée que si elle
 * correspond à un libellé de Marc (exactement, ou à accents/casse près — on rend le nom EXACT) ;
 * sinon null → `À vérifier`. `suspect` fermé par défaut (vrai seulement sur booléen explicite).
 * @param {?string} texte
 * @param {string[]} libellesValides
 * @return {{categorie:?string, suspect:boolean}}
 */
function parserMiniCategorie_(texte, libellesValides) {
  var defaut = { categorie: null, suspect: false };
  if (!texte) return defaut;
  var obj = null;
  try {
    obj = JSON.parse(texte);
  } catch (e) {
    var debut = texte.indexOf('{');
    var fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      try { obj = JSON.parse(texte.substring(debut, fin + 1)); } catch (e2) { obj = null; }
    }
  }
  if (!obj) return defaut;
  var cat = null;
  if (typeof obj.categorie === 'string') {
    if (libellesValides.indexOf(obj.categorie) !== -1) {
      cat = obj.categorie; // correspondance exacte
    } else {
      // Tolérance accents/casse (revue flotte : « finance/impôts » rejeté = tout part en À vérifier
      // et la table n'apprend jamais — neutralisation, leçon « garde-fou étroit »).
      var voulu = normaliserLibelle_(obj.categorie);
      for (var i = 0; i < libellesValides.length; i++) {
        if (normaliserLibelle_(libellesValides[i]) === voulu) { cat = libellesValides[i]; break; }
      }
    }
  }
  return { categorie: cat, suspect: obj.suspect === true };
}

/**
 * Mini-appel LLM : catégorie (parmi les libellés EXISTANTS) + signal suspect, sur expéditeur+sujet
 * seuls. TRI-ÉTAT (revue flotte) : un échec TRANSITOIRE (réseau/429/5xx/panne de compte) renvoie
 * **null** — l'appelant NE consomme PAS la clé et re-tentera ; un doute LÉGITIME du modèle renvoie
 * {categorie:null,…} → « À vérifier ». Retry léger via `fetchAvecRetry_` (comme `classifier_`).
 * @param {string} expediteur
 * @param {string} sujet
 * @param {string[]} libelles  libellés candidats (les 3 spéciaux exclus)
 * @return {?{categorie:?string, suspect:boolean}}  null = panne transitoire, à re-tenter
 */
function miniCategorie_(expediteur, sujet, libelles) {
  if (estPannePlateforme_()) return null; // re-tenté après la panne — jamais « À vérifier » pour ça
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': getCleAnthropic_(), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: CONFIG.LLM_MODELE,
      max_tokens: CONFIG.LLM_MAX_TOKENS_MINICAT,
      system: 'Tu tries la boîte mail personnelle de Marc. Réponds UNIQUEMENT avec un objet JSON ' +
        '{"categorie": "<un libellé de la liste, EXACTEMENT>" | null, "suspect": true|false}. ' +
        'Choisis le libellé le plus PRÉCIS de la liste ; si aucun ne convient AVEC CERTITUDE, mets ' +
        'null (jamais le plus probable).\n' +
        // Recalibration 2026-07-07 (workflow validé : 14 faux positifs → ~1, 8/8 phishing détectés).
        // L'ancien prompt assimilait « urgence/identifiants/paiement » à du phishing → il flaguait TOUT
        // mail transactionnel légitime (alertes Google, codes 2FA, réclamations Desjardins…). On inverse
        // la charge de la preuve : suspect exige un signal de TROMPERIE sur l'IDENTITÉ du domaine, pas le ton.
        'Gmail a DÉJÀ écarté le spam et le phishing : ce qui arrive dans cette boîte est presque ' +
        'toujours LÉGITIME. Ne mets "suspect": true QUE si l\'EXPÉDITEUR ou le SUJET montrent un signal ' +
        'de TROMPERIE CONCRET :\n' +
        '- le domaine de l\'expéditeur NE CORRESPOND PAS à l\'organisation prétendue (ex. « La Poste » ' +
        'depuis un .info, une banque depuis un domaine inconnu) ;\n' +
        '- domaine SOSIE / typosquat d\'une vraie marque (caractère en trop, tiret, mot ajouté, TLD douteux) ;\n' +
        '- webmail gratuit (gmail, outlook, yahoo…) se faisant passer pour une INSTITUTION (banque, ' +
        'impôts, gouvernement, assureur) ;\n' +
        '- arnaque MANIFESTE : loterie/héritage/gain, sextorsion/chantage, faux remboursement, virement inattendu.\n' +
        'N\'est PAS suspect (false) — même si le ton est pressant — dès lors que le domaine est COHÉRENT ' +
        'avec l\'organisation : alerte de sécurité, code de connexion/2FA, confirmation de commande/réception, ' +
        'relance ou avis de paiement, document de réclamation, facture, notification de service. Une ' +
        'newsletter ou une promo n\'est pas suspecte. Un message personnel d\'un particulier n\'est pas suspect.\n' +
        'En cas de DOUTE, mets "suspect": false : Gmail filtre déjà le vrai phishing, et un faux positif ' +
        'sur du courrier légitime est PIRE qu\'un rare manqué.\n' +
        'Libellés autorisés : ' + libelles.join(' | '),
      messages: [{ role: 'user', content: 'Expéditeur : ' + expediteur + '\nSujet : ' + sujet }]
    }),
    muteHttpExceptions: true
  };
  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, CONFIG.LLM_MODELE);
  if (!reponse) return null; // réseau mort après retry → transitoire
  var code = reponse.getResponseCode();
  if (code !== 200) {
    signalerPannePlateforme_(code, reponse.getContentText(), CONFIG.LLM_MODELE);
    return null; // 429/5xx/panne : transitoire — la clé n'est pas consommée
  }
  var data;
  try { data = JSON.parse(reponse.getContentText()); } catch (e) { return null; }
  signalerRetablissement_();
  enregistrerUsage_(CONFIG.LLM_MODELE, data.usage);
  return parserMiniCategorie_(texteReponse_(data), libelles);
}

/* ---------- table apprise adresse → libellé (onglet `TriAppris`) ---------- */

var _triApprisCache = null;
function reinitialiserTriApprisCache_() { _triApprisCache = null; }

/** Charge la table apprise UNE fois par run. { adresse: libellé } */
function triApprisCache_() {
  if (_triApprisCache !== null) return _triApprisCache;
  _triApprisCache = {};
  try {
    var f = feuille_('TriAppris');
    var dern = f.getLastRow();
    if (dern >= 2) {
      var v = f.getRange(2, 1, dern - 1, 2).getValues();
      for (var i = 0; i < v.length; i++) {
        if (v[i][0]) _triApprisCache[String(v[i][0])] = String(v[i][1]);
      }
    }
  } catch (e) { /* onglet illisible → table vide, le LLM prendra le relais */ }
  return _triApprisCache;
}

/** Apprend un mapping adresse → libellé (si inédit). L'adresse, JAMAIS le nom affiché. */
function apprendreTri_(adresse, libelle) {
  var t = triApprisCache_();
  if (!adresse || t[adresse]) return;
  t[adresse] = libelle;
  try { feuille_('TriAppris').appendRow([adresse, libelle, new Date()]); } catch (e) { /* best-effort */ }
}

/* ---------- table des expéditeurs DE CONFIANCE (onglet `Confiance`, C28-19/ADR-0020) ---------- */

var _confianceCache = null;
function reinitialiserConfianceCache_() { _confianceCache = null; }

/**
 * Expéditeurs marqués « pas suspect » par Marc (1-clic app). Chargée UNE fois par run.
 * { adresse: true } — adresse nue en minuscules (jamais le nom affiché, usurpable).
 */
function confianceCache_() {
  if (_confianceCache !== null) return _confianceCache;
  _confianceCache = {};
  try {
    var f = feuille_('Confiance');
    var dern = f.getLastRow();
    if (dern >= 2) {
      var v = f.getRange(2, 1, dern - 1, 1).getValues();
      for (var i = 0; i < v.length; i++) {
        if (v[i][0]) _confianceCache[String(v[i][0]).toLowerCase()] = true;
      }
    }
  } catch (e) { /* onglet illisible → personne n'est de confiance ce run (prudent) */ }
  return _confianceCache;
}

/** Apprend un expéditeur de confiance (dédupliqué — un double clic n'écrit qu'une ligne). */
function apprendreConfiance_(adresse) {
  var c = confianceCache_();
  var a = String(adresse || '').toLowerCase();
  if (!a || c[a]) return;
  c[a] = true;
  try { feuille_('Confiance').appendRow([a, new Date()]); } catch (e) { /* best-effort */ }
}

/**
 * Décision PURE du signal SUSPECT (C28-19, ADR-0020 — auditée §8.5). La CONFIANCE (clic
 * « pas suspect » de Marc) outrepasse TOUT : l'heuristique, le LLM ET le libellé ⚠ déjà posé —
 * le libellé Gmail physique reste (§2.3 : jamais retiré), mais le système l'ignore désormais.
 * Sinon, règle 2026-07-07 inchangée : heuristique déterministe d'abord ; signal LLM seulement
 * hors Marc et hors expéditeur appris (sauf chemin dangereux) ; ⚠ déjà posé conservé.
 * @param {{deConfiance:boolean, heuristique:boolean, llm:boolean, estMoi:boolean,
 *          appris:boolean, cheminDangereux:boolean, dejaPoseSuspect:boolean}} s
 * @return {boolean}
 */
function decisionSuspect_(s) {
  if (s.deConfiance) return false;
  return s.heuristique ||
    (s.llm && !s.estMoi && (!s.appris || s.cheminDangereux)) ||
    s.dejaPoseSuspect;
}

/* ---------- signaux Gmail par run ---------- */

/**
 * Libellés utilisateur de Marc, chargés UNE fois par run : { nom: GmailLabel }.
 * Le moteur ne CRÉE jamais de libellé — il n'utilise que ceux-ci.
 */
var _libellesCache = null;
function reinitialiserLibellesCache_() { _libellesCache = null; }
function libellesUtilisateur_() {
  if (_libellesCache !== null) return _libellesCache;
  _libellesCache = {};
  var tous = GmailApp.getUserLabels();
  for (var i = 0; i < tous.length; i++) _libellesCache[tous[i].getName()] = tous[i];
  return _libellesCache;
}

/**
 * Fils classés « Promotions » PAR GMAIL (catégorie côté Google — non forgeable par le seul
 * expéditeur, contrairement à l'en-tête List-Unsubscribe qu'un attaquant pose lui-même — revue
 * sécurité). Chargé paresseusement, 1×/run, borné à 200 fils. { threadId: true }
 */
var _promoSetCache = null;
function reinitialiserPromoSetCache_() { _promoSetCache = null; }
function estPromoGmail_(threadId) {
  if (_promoSetCache === null) {
    _promoSetCache = {};
    try {
      var fils = GmailApp.search('category:promotions newer_than:32d', 0, 100);
      for (var i = 0; i < fils.length; i++) _promoSetCache[fils[i].getId()] = true;
      if (fils.length === 100) {
        var suite = GmailApp.search('category:promotions newer_than:32d', 100, 100);
        for (var j = 0; j < suite.length; j++) _promoSetCache[suite[j].getId()] = true;
      }
    } catch (e) { /* indisponible → personne n'est « promo » ce run (prudent : pas d'archivage non-lu) */ }
  }
  return !!_promoSetCache[threadId];
}

// Panne d'ÉCRITURE Gmail (scope manquant pendant la fenêtre de ré-autorisation, API en panne) :
// SYSTÉMIQUE — le run s'arrête, AUCUN échec n'est imputé aux fils (revue flotte : sinon 3 ticks
// de panne d'écriture abandonneraient définitivement des dizaines de fils). Journal 1×/run.
var _panneEcritureCeRun = false;
function reinitialiserPanneEcriture_() { _panneEcritureCeRun = false; }
function signalerPanneEcriture_(e) {
  if (!_panneEcritureCeRun) {
    journalErreur_('TriGmail', 'PANNE D\'ÉCRITURE Gmail — tri suspendu pour ce run, aucun échec ' +
      'imputé aux fils (scope manquant ? API en panne ?) : ' + e);
  }
  _panneEcritureCeRun = true;
}

/* ---------- orchestration ---------- */

/**
 * Trie les fils récents — SCAN À DEUX VOIES. Plafonds par run : `TRI_MAX_FILS_PAR_RUN` écritures,
 * `TRI_MAX_ATTENTES` fils en attente des intentions (chaque attente re-coûtera un chargement au
 * tick suivant — on borne la facture).
 * @param {function():boolean} estBudgetDepasse
 */
function trierFilsGmail_(estBudgetDepasse) {
  if (estPanneGmail_()) return; // quota Gmail épuisé (C28-15) : suspendu jusqu'à la re-sonde
  var libelles = libellesUtilisateur_();
  var speciaux = [CONFIG.TRI_LIBELLES.A_VERIFIER, CONFIG.TRI_LIBELLES.SUSPECT, CONFIG.TRI_LIBELLES.A_TRAITER];
  var candidats = [];
  for (var nom in libelles) { if (speciaux.indexOf(nom) === -1) candidats.push(nom); }

  var etat = { traites: 0, attentes: 0 };
  var plafondAtteint = function () {
    // `estPanneGmail_` (C28-15) : le quota peut s'épuiser EN COURS de run — stop immédiat.
    return estBudgetDepasse() || estPannePlateforme_() || estPanneGmail_() || _panneEcritureCeRun ||
      etat.traites >= CONFIG.TRI_MAX_FILS_PAR_RUN || etat.attentes >= CONFIG.TRI_MAX_ATTENTES;
  };

  // « Pas suspect » (C28-19) : les clics de Marc d'abord — purge des clés d'Index + re-tri
  // immédiat des fils concernés, SOUS le verrou du tick (jamais depuis doPost : une suppression
  // de lignes d'Index en concurrence du run serait une course).
  appliquerPasSuspect_(etat, plafondAtteint, candidats, libelles);
  // Tri À LA DEMANDE (C28-16, recentré C28-24) : la demande de Marc (archiver/plafond posée par
  // l'app) passe ensuite. Elle s'étale sur plusieurs ticks si besoin (offset/faits persistés),
  // toujours sous les plafonds par run du tri.
  if (!plafondAtteint()) scanDemandeTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanAvantTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanCycliqueTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanArriereTri_(etat, plafondAtteint, candidats, libelles);
}

/**
 * Scan À LA DEMANDE (C28-16, recentré C28-24) : consomme la Property `DriveAI_TRI_DEMANDE`
 * posée par l'app (`actionDemandeTri_` — archiver oui/non, plafond de fils TRAITÉS). Objectif
 * de Marc : « archiver TOUS les mails LUS de la boîte » — requête FIGÉE `in:inbox is:read`,
 * plus de fenêtre. FILE MOUVANTE assumée : chaque fil ARCHIVÉ sort du résultat de recherche →
 * l'offset persistant n'avance que des fils RESTÉS en boîte ('archive' exclu) — avancer d'une
 * page pleine SAUTERAIT autant de fils que la page en a archivés (leçon « pagination sur une
 * file mouvante : prouver que le plus ancien sort un jour »). Les fils déjà à jour (clé
 * `tri|fil|ts|lu` à l'Index) restent sautés gratuitement. Plafond QUOTIDIEN de LECTURES en sus
 * (patron C28-21) : page RÉTRÉCIE au reliquat du jour (complétable → l'offset avance), compteur
 * écrit en finally sur le coût CONSOMMÉ — une grosse boîte se draine sur plusieurs jours sans
 * épuiser le quota Gmail partagé, la demande reste posée entre-temps. Elle est effacée quand
 * ENTIÈREMENT servie (plafond atteint ou boîte parcourue) — reprenable si coupée.
 * @param {{traites:number, attentes:number}} etat
 * @param {function():boolean} plafondAtteint
 * @param {string[]} candidats
 * @param {Object} libelles
 */
function scanDemandeTri_(etat, plafondAtteint, candidats, libelles) {
  var props = PropertiesService.getScriptProperties();
  var brut = props.getProperty('DriveAI_TRI_DEMANDE');
  if (!brut) return;
  var demande = null;
  try { demande = JSON.parse(brut); } catch (e) { }
  if (!demande || !demande.plafond) {
    // Demande illisible (Property corrompue) : purgée — jamais une boucle d'erreurs à chaque tick.
    effacerDemandeTri_(props, 0, 'demande illisible — annulée');
    return;
  }
  if (demande.fenetre) {
    // Demande posée par une ANCIENNE version de l'app (avant C28-24) : son offset était calé sur
    // la requête fenêtrée — l'appliquer à `in:inbox is:read` sauterait des fils jamais vus (revue
    // flotte). Soldée proprement : Marc re-clique « Trier » depuis l'app à jour (cas transitoire).
    effacerDemandeTri_(props, Number(props.getProperty('DriveAI_TRI_DEMANDE_FAITS')) || 0,
      'demande d\'une ancienne version de l\'app — re-clique « Trier »');
    return;
  }
  var requete = 'in:inbox is:read'; // C28-24 : tous les mails LUS de la boîte, sans fenêtre

  var aujourdhui = dateGmail_(new Date());
  var filsJour = props.getProperty('DriveAI_TRI_DEMANDE_JOUR') === aujourdhui
    ? Number(props.getProperty('DriveAI_TRI_DEMANDE_FILS_JOUR')) || 0
    : 0;
  var filsLus = 0;
  try {
    while (!plafondAtteint()) {
      var faits = Number(props.getProperty('DriveAI_TRI_DEMANDE_FAITS')) || 0;
      if (faits >= demande.plafond) {
        effacerDemandeTri_(props, faits, 'plafond atteint');
        return;
      }
      // Page RÉTRÉCIE au reliquat du jour (patron C28-21) : interrompue à mi-page, elle
      // rejouerait chaque tick sans avancer — plus petite, elle reste COMPLÉTABLE. Bornée AUSSI
      // au reliquat d'ATTENTES (revue flotte C28-24) : une page coupée à mi-course par
      // TRI_MAX_ATTENTES gèlerait l'offset et relirait les MÊMES fils à chaque tick.
      var taille = Math.min(CONFIG.PAGE_FILS_ACTIONS,
        CONFIG.TRI_DEMANDE_MAX_FILS_JOUR - filsJour - filsLus,
        CONFIG.TRI_MAX_ATTENTES - etat.attentes);
      if (taille <= 0) return; // plafond quotidien atteint : demande INTACTE, reprise demain (aucune recherche)
      var offset = Number(props.getProperty('DriveAI_TRI_DEMANDE_OFFSET')) || 0;
      var fils;
      try {
        fils = GmailApp.search(requete, offset, taille);
      } catch (e) {
        if (signalerPanneGmail_(e)) return; // quota : demande INTACTE, reprise après la re-sonde
        journalErreur_('TriGmail', 'Recherche du tri à la demande impossible : ' + e);
        return;
      }
      signalerRetablissementGmail_();
      if (!fils.length) {
        effacerDemandeTri_(props, faits, 'boîte parcourue');
        return;
      }
      var restants = 0; // fils encore EN BOÎTE après traitement — seuls eux font avancer l'offset
      var pageComplete = true;
      for (var i = 0; i < fils.length; i++) {
        if (plafondAtteint() || faits >= demande.plafond) { pageComplete = false; break; } // rejeu (déjà-vus gratuits)
        filsLus++; // le fil va être LU (trierFil_) : coût quota réel, page complétée ou non (C28-21)
        var r = trierFil_(fils[i], candidats, libelles, false, !demande.archiver);
        if (r === 'archive') { etat.traites++; faits++; }
        else {
          restants++;
          if (r === 'traite') { etat.traites++; faits++; }
          if (r === 'attend') etat.attentes++;
          // Fil en ÉCHEC : page NON complète → offset figé, rejeu au tick suivant (revue flotte
          // C28-24, alignement sur le scan arrière) — jamais sauté pour toute la demande. Un fil
          // durablement malade finit `tri-abandon` (QUARANTAINE_MAX) puis 'deja' : l'offset passe.
          if (r === 'erreur') pageComplete = false;
        }
      }
      props.setProperty('DriveAI_TRI_DEMANDE_FAITS', String(faits));
      if (faits >= demande.plafond) {
        effacerDemandeTri_(props, faits, 'plafond atteint');
        return;
      }
      if (!pageComplete) return; // page interrompue par le run : offset INCHANGÉ (rejeu gratuit)
      props.setProperty('DriveAI_TRI_DEMANDE_OFFSET', String(offset + restants));
    }
  } finally {
    if (filsLus > 0) {
      props.setProperty('DriveAI_TRI_DEMANDE_JOUR', aujourdhui);
      props.setProperty('DriveAI_TRI_DEMANDE_FILS_JOUR', String(filsJour + filsLus));
    }
  }
}

/** Solde une demande de tri : Properties purgées + bilan journalisé (une seule ligne). */
function effacerDemandeTri_(props, faits, motif) {
  props.deleteProperty('DriveAI_TRI_DEMANDE');
  props.deleteProperty('DriveAI_TRI_DEMANDE_OFFSET');
  props.deleteProperty('DriveAI_TRI_DEMANDE_FAITS');
  // Instantané pour le widget Progression (C28-18) : une demande servie EN UN TICK resterait
  // sinon invisible (Properties déjà purgées quand majProgressions_ passe). Purgé après 48 h.
  props.setProperty('DriveAI_TRI_DEMANDE_SOLDE', JSON.stringify({ faits: faits, quand: Date.now() }));
  journalInfo_('TriGmail', 'Tri à la demande terminé (' + faits + ' fil(s) trié(s) — ' + motif + ').');
}

/**
 * Scan AVANT : pages de la BOÎTE depuis l'offset 0 — le courrier neuf ET les fils dont l'état a
 * changé (nouveau message, lu/non-lu : la clé d'idempotence change → re-tri — c'est ainsi qu'un
 * mail lu APRÈS son tri initial finit archivé). S'arrête au mur de fils déjà à jour.
 */
function scanAvantTri_(etat, plafondAtteint, candidats, libelles) {
  var debutPage = 0;
  while (!plafondAtteint()) {
    var fils;
    try {
      fils = GmailApp.search(CONFIG.TRI_REQUETE, debutPage, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      if (signalerPanneGmail_(e)) return; // quota épuisé (C28-15) : suspension, pas un échec
      journalErreur_('TriGmail', 'Recherche des fils (avant) impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_();
    if (!fils.length) return;
    var pageAJour = true;
    for (var i = 0; i < fils.length; i++) {
      if (plafondAtteint()) return;
      var r = trierFil_(fils[i], candidats, libelles, false);
      if (r === 'traite' || r === 'archive') etat.traites++;
      if (r === 'attend') etat.attentes++;
      if (r !== 'deja') pageAJour = false;
    }
    if (pageAJour) return; // mur du déjà-à-jour : le stock appartient au scan arrière
    debutPage += CONFIG.PAGE_FILS_ACTIONS;
  }
}

/**
 * Scan CYCLIQUE (C28-19, ADR-0020) : garantit que TOUT fil de la fenêtre `TRI_REQUETE` est
 * revisité un jour — un fil LU des jours après son tri est ENFOUI sous le mur « déjà à jour »
 * du scan avant et n'était JAMAIS re-trié (⇒ jamais archivé ; vécu : 2-11 fils/j au lieu de
 * ~90). Offset persistant (`DriveAI_TRI_CYCLIQUE_OFFSET`) qui avance page après page et REPART à 0
 * en fin de fenêtre — tour complet en ~1-3 jours (plafond quotidien `TRI_CYCLIQUE_MAX_FILS_JOUR`,
 * C28-21) ; le scan AVANT garde la latence ~5 min sur le courrier neuf.
 * DÉVIATION documentée vs plan C28-19 (« remplacer le mur ») : le scan AVANT et son arrêt tôt
 * sont CONSERVÉS — sans eux, (a) le courrier NEUF perdrait sa latence ~5 min (leçon « scan du
 * neuf qui s'arrête tôt »), (b) un balayage libre relirait TOUTE la boîte à chaque tick (leçon
 * quota partagé C28-15 : les lectures se bornent dans LEUR unité — ici PAGES/tick, plafond
 * `TRI_CYCLIQUE_PAGES_PAR_RUN`). File MOUVANTE assumée : une insertion en tête décale l'offset
 * (fils sautés/revus) — sans gravité, le cycle repasse en boucle et les revisites sont
 * gratuites (idempotence par clé `tri|fil|ts|lu`).
 */
function scanCycliqueTri_(etat, plafondAtteint, candidats, libelles) {
  var props = PropertiesService.getScriptProperties();
  // Plafond QUOTIDIEN de lectures (C28-21, plan architecte) : les revisites du cyclique sont
  // « gratuites » côté traitement (déjà-vus servis par l'Index) mais chaque fil visité coûte des
  // appels Gmail — sans plafond, 1 page × 288 ticks ≈ 5 760 lectures/jour sur le quota PARTAGÉ
  // (leçon « la re-passe n'est gratuite que côté traitement »). Compté dans SON unité (fils).
  var aujourdhui = dateGmail_(new Date());
  var filsJour = props.getProperty('DriveAI_TRI_CYCLIQUE_JOUR') === aujourdhui
    ? Number(props.getProperty('DriveAI_TRI_CYCLIQUE_FILS_JOUR')) || 0
    : 0;
  var filsLus = 0;
  try {
    for (var page = 0; page < CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN; page++) {
      if (plafondAtteint()) return;
      // Page RÉTRÉCIE au reliquat du jour (déviation documentée vs plan : interrompre une page
      // pleine à `maxCeRun` la ferait REJOUER chaque tick sans avancer l'offset — des re-lectures
      // en boucle, le bug même que ce plafond corrige) : plus petite, elle reste COMPLÉTABLE.
      var taille = Math.min(CONFIG.PAGE_FILS_ACTIONS,
        CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR - filsJour - filsLus);
      if (taille <= 0) return; // plafond quotidien atteint — le tour reprend demain (aucune recherche)
      var offset = Number(props.getProperty('DriveAI_TRI_CYCLIQUE_OFFSET')) || 0;
      var fils;
      try {
        fils = GmailApp.search(CONFIG.TRI_REQUETE, offset, taille);
      } catch (e) {
        if (signalerPanneGmail_(e)) return; // quota épuisé (C28-15) : suspension, offset inchangé
        journalErreur_('TriGmail', 'Recherche des fils (cyclique) impossible : ' + e);
        return;
      }
      signalerRetablissementGmail_();
      if (!fils.length) {
        props.setProperty('DriveAI_TRI_CYCLIQUE_OFFSET', '0'); // tour complet : on repart du haut
        return;
      }
      var pageComplete = true;
      for (var i = 0; i < fils.length; i++) {
        if (plafondAtteint()) { pageComplete = false; break; }
        filsLus++; // le fil va être LU (trierFil_) : coût quota réel, page complétée ou non
        var r = trierFil_(fils[i], candidats, libelles, false);
        if (r === 'traite' || r === 'archive') etat.traites++;
        if (r === 'attend') etat.attentes++;
      }
      if (!pageComplete) return; // page interrompue rejouée au tick suivant (déjà-vus gratuits)
      props.setProperty('DriveAI_TRI_CYCLIQUE_OFFSET', String(offset + fils.length));
    }
  } finally {
    if (filsLus > 0) {
      props.setProperty('DriveAI_TRI_CYCLIQUE_JOUR', aujourdhui);
      props.setProperty('DriveAI_TRI_CYCLIQUE_FILS_JOUR', String(filsJour + filsLus));
    }
  }
}

/**
 * Consomme les demandes « PAS SUSPECT » de Marc (C28-19) : pour chaque threadId posé par l'app
 * (une Property PAR fil `DriveAI_PAS_SUSPECT|<id>` — écriture atomique côté doPost, revue flotte
 * C28-24 ; l'ancienne LISTE JSON `DriveAI_PAS_SUSPECT` est consommée en compat puis convertie),
 * PURGE les lignes d'état du fil (clés `tri|<id>|…`, cf. purgerClesTriIndex_) puis RE-TRIE
 * immédiatement — l'expéditeur étant désormais dans `Confiance`, le fil redevient « sain »
 * (libellés normaux, archivé si lu). Le libellé ⚠ Gmail n'est JAMAIS retiré (§2.3) — le système
 * l'ignore. Borné par le plafond du run ; un fil non traité (coupure, attente d'intentions)
 * survit pour le tick suivant, jamais perdu ; une clé ajoutée par un doPost PENDANT ce run n'est
 * pas touchée (jamais écrasée). Les écritures d'état ne se font qu'EN FIN de consommation : une
 * coupure dure re-présente tout (rejeu idempotent).
 */
function appliquerPasSuspect_(etat, plafondAtteint, candidats, libelles) {
  var props = PropertiesService.getScriptProperties();
  var PREFIXE = 'DriveAI_PAS_SUSPECT|';
  var ids = [];
  var brut = props.getProperty('DriveAI_PAS_SUSPECT'); // ancien format (liste JSON, avant C28-24)
  if (brut) { try { ids = JSON.parse(brut) || []; } catch (e) { ids = []; } }
  var tous = {};
  try { tous = props.getProperties(); } catch (e) { }
  for (var k in tous) {
    if (k.indexOf(PREFIXE) === 0) {
      var idCle = k.slice(PREFIXE.length);
      if (ids.indexOf(idCle) === -1) ids.push(idCle);
    }
  }
  if (!ids.length) { if (brut) props.deleteProperty('DriveAI_PAS_SUSPECT'); return; }

  var restants = {};
  for (var i = 0; i < ids.length; i++) {
    if (plafondAtteint()) { for (var ri = i; ri < ids.length; ri++) restants[ids[ri]] = true; break; }
    var threadId = String(ids[i]);
    try {
      purgerClesTriIndex_(threadId); // idempotent (0 ligne au rejeu)
      var fil = GmailApp.getThreadById(threadId);
      if (fil) {
        var r = trierFil_(fil, candidats, libelles, false);
        if (r === 'traite' || r === 'archive') etat.traites++;
        if (r === 'attend') { etat.attentes++; restants[threadId] = true; } // re-tenté au tick suivant
      }
    } catch (e) {
      if (signalerPanneGmail_(e)) { for (var rq = i; rq < ids.length; rq++) restants[ids[rq]] = true; break; }
      journalErreur_('TriGmail', 'Pas-suspect inapplicable (' + threadId + ') : ' + e);
    }
  }
  // Persistance par CLÉ (écritures atomiques) : servi → purgé ; à re-tenter → re-posé (les ids de
  // l'ancienne liste sont convertis au passage) ; la liste héritée est soldée en dernier.
  for (var p = 0; p < ids.length; p++) {
    if (restants[ids[p]]) props.setProperty(PREFIXE + ids[p], '1');
    else props.deleteProperty(PREFIXE + ids[p]);
  }
  if (brut) props.deleteProperty('DriveAI_PAS_SUSPECT');
}

/**
 * Scan ARRIÈRE : rattrape le STOCK une seule fois — ancre FIXE (posée au déploiement) + OFFSET
 * persistant sur l'ensemble FIGÉ `after:<ancre−31j> before:<ancre>` (leçon C12 : l'appartenance
 * d'un ensemble borné par des dates fixes est stable ⇒ l'offset y est sûr ; le « jour-frontière »
 * d'un curseur de date n'existe plus — revue flotte : `before:` exclusif y perdait les jours à
 * plus d'une page). L'offset n'avance que si le lot est COMPLET sans attente ni erreur (rejeu
 * idempotent sinon). Les fils déjà HORS boîte sont sautés sans coût (`isInInbox`).
 * Page vide → `DriveAI_TRI_RATTRAPAGE = 'terminé'` : coût nul ensuite.
 */
function scanArriereTri_(etat, plafondAtteint, candidats, libelles) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_TRI_RATTRAPAGE') === 'terminé') return;

  var ancre = props.getProperty('DriveAI_TRI_ANCRE');
  if (!ancre) {
    var d = new Date();
    d.setDate(d.getDate() + 1); // before:<demain> ⇒ aujourd'hui inclus (chevauche l'avant — idempotent)
    ancre = dateGmail_(d);
    var borne = new Date();
    borne.setDate(borne.getDate() - 31);
    // Ordre voulu (leçon « écritures d'état ») : la borne d'abord, l'ancre ensuite — une coupure
    // entre les deux re-posera simplement les deux au tick suivant.
    props.setProperty('DriveAI_TRI_BORNE', dateGmail_(borne));
    props.setProperty('DriveAI_TRI_ANCRE', ancre);
  }
  var borneBasse = props.getProperty('DriveAI_TRI_BORNE') || '';
  var requete = 'after:' + borneBasse + ' before:' + ancre; // ensemble FIGÉ (deux dates fixes)

  while (!plafondAtteint()) {
    var offset = Number(props.getProperty('DriveAI_TRI_OFFSET')) || 0;
    var fils;
    try {
      fils = GmailApp.search(requete, offset, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      if (signalerPanneGmail_(e)) return; // quota épuisé (C28-15) : suspension, offset inchangé
      journalErreur_('TriGmail', 'Recherche des fils (rattrapage) impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_();
    if (!fils.length) {
      props.setProperty('DriveAI_TRI_RATTRAPAGE', 'terminé');
      journalInfo_('TriGmail', 'Rattrapage du stock TERMINÉ (' + offset + ' fils) — le scan avant suffit désormais.');
      return;
    }
    var lotComplet = true;
    for (var i = 0; i < fils.length; i++) {
      if (plafondAtteint()) { lotComplet = false; break; }
      var r = trierFil_(fils[i], candidats, libelles, true);
      if (r === 'traite' || r === 'archive') etat.traites++;
      if (r === 'attend') { etat.attentes++; lotComplet = false; }
      if (r === 'erreur') lotComplet = false; // rejoué (l'abandon par fil borne les fils malades)
    }
    if (!lotComplet) return; // rejeu du lot au prochain tick (idempotence = gratuit)
    props.setProperty('DriveAI_TRI_OFFSET', String(offset + fils.length));
  }
}

/**
 * Fenêtre (en jours) couverte par l'analyse des INTENTIONS, dérivée de la CONSTANTE
 * `CONFIG.GMAIL_REQUETE_ACTIONS` (jamais « 30 » en dur — leçon « cas dérivés de la constante »).
 * PURE. @return {?number} jours, ou null si la requête ne porte pas de fenêtre lisible.
 */
function joursFenetreIntentions_() {
  var m = /newer_than:(\d+)d/.exec(String(CONFIG.GMAIL_REQUETE_ACTIONS || ''));
  return m ? Number(m[1]) : null;
}

/**
 * Vrai si un fil dont le DERNIER message date de `tsMs` est HORS de la fenêtre des intentions :
 * sa clé `intention|` n'arrivera JAMAIS (tous les scans d'intentions sont bornés à cette
 * fenêtre) — l'attendre serait un « attend » PERMANENT (revue flotte C28-24 : la demande
 * `in:inbox is:read` sautait tout le stock ancien en brûlant le quota, leçon « un garde-fou qui
 * met des items hors circuit exige un chemin de retour »). PURE (testée).
 * Fenêtre illisible → false (statu quo prudent : on attend).
 * @param {number} tsMs  date du dernier message (ms epoch)
 * @param {number} maintenantMs
 * @return {boolean}
 */
function estHorsFenetreIntentions_(tsMs, maintenantMs) {
  var jours = joursFenetreIntentions_();
  if (jours === null) return false;
  return maintenantMs - tsMs > jours * 24 * 60 * 60 * 1000;
}

/**
 * Trie UN fil. @return {'deja'|'attend'|'traite'|'archive'|'erreur'} — 'archive' = traité ET
 * retiré de la boîte (C28-24 : l'offset du tri à la demande n'avance que des fils RESTANTS en
 * boîte ; pour le comptage, 'archive' se compte partout comme 'traite').
 * @param {GmailThread} fil
 * @param {string[]} candidats
 * @param {Object} libelles
 * @param {boolean} verifierBoite  vrai pour le scan arrière : un fil déjà HORS boîte est sauté
 *   (l'objectif est « boîte propre » — pas de libellés/coût LLM pour l'archivé d'avant).
 */
function trierFil_(fil, candidats, libelles, verifierBoite, forcerNonArchivage) {
  var filId = '';
  var ts = '';
  try {
    filId = fil.getId();
    if (verifierBoite && !fil.isInInbox()) return 'deja'; // déjà hors boîte — rien à faire
    // Fil ILLISIBLE abandonné (son `ts` n'a jamais pu être lu → marqueur sans ts) : vérifié AVANT
    // de relire la date, sinon il replanterait — et se re-journaliserait — à chaque tick.
    if (indexContient_('tri-abandon|' + filId + '|')) return 'deja';
    ts = String(fil.getLastMessageDate().getTime());
    if (indexContient_('tri-abandon|' + filId + '|' + ts)) return 'deja'; // abandonné DANS CET ÉTAT
    var nonLu = fil.isUnread();
    // La clé d'état inclut le DERNIER MESSAGE et l'état LU : un nouveau message OU une lecture
    // re-déclenche le tri (revue flotte : sinon un mail lu après son tri n'était JAMAIS archivé).
    var cle = 'tri|' + filId + '|' + ts + (nonLu ? '|nonlu' : '|lu');
    if (indexContient_(cle)) return 'deja';

    // Libellés DÉJÀ posés sur le fil : ⏰/⚠️ sont des décisions antérieures qui survivent aux
    // nouveaux messages (un fil marqué ⏰ ne doit JAMAIS être archivé, quel que soit le suivi).
    var dejaPoses = {};
    try {
      var poses = fil.getLabels();
      for (var lp = 0; lp < poses.length; lp++) dejaPoses[poses[lp].getName()] = true;
    } catch (e) { /* illisible → on fait sans */ }

    var messages = fil.getMessages();
    var dernier = messages[messages.length - 1];
    var dernierId = dernier.getId();
    // Le tri passe APRÈS la Phase 3 : tant que le dernier message n'a pas été analysé (intentions),
    // on attend — c'est elle qui pose le flag `important|` dont dépend le ⏰/l'archivage.
    // SAUF fil HORS fenêtre intentions (revue flotte C28-24) : la clé n'arrivera JAMAIS — on trie
    // sans attendre (`important|` structurellement absent ; le ⏰ déjà posé reste honoré via
    // dejaPoses, les gardes suspect/zone protégée s'appliquent au vif comme pour tout fil).
    if (!indexContient_('intention|' + dernierId) &&
        !estHorsFenetreIntentions_(Number(ts), Date.now())) return 'attend';

    // Message de RÉFÉRENCE pour la catégorisation : le plus récent qui ne vient PAS de Marc —
    // sinon un fil où il a répondu en dernier apprendrait « marc@… → libellé » et catégoriserait
    // sur SA réponse (empoisonnement global, revue flotte).
    var proprio = (CONFIG.PROPRIETAIRE_EMAIL || '').toLowerCase();
    var ref = dernier;
    if (proprio) {
      for (var mi = messages.length - 1; mi >= 0; mi--) {
        if (adresseExpediteur_(messages[mi].getFrom()) !== proprio) { ref = messages[mi]; break; }
      }
    }
    var expediteur = ref.getFrom() || '';
    var sujet = ref.getSubject() || '';
    var adresse = adresseExpediteur_(expediteur);

    var nomsPj = [];
    try {
      var pjs = piecesJointes_(ref);
      for (var p = 0; p < pjs.length; p++) nomsPj.push(pjs[p].getName());
    } catch (e) { /* PJ illisibles → heuristique sur sujet seul */ }

    // Promo DÉTERMINISTE = en-tête List-Unsubscribe ET catégorie Promotions de GMAIL (le header
    // seul est sous le contrôle de l'expéditeur — un phishing se l'ajoute ; la catégorie est
    // attribuée par Google — revue sécurité).
    var promoDeterministe = false;
    try { promoDeterministe = !!ref.getHeader('List-Unsubscribe') && estPromoGmail_(filId); } catch (e) { }

    var suspectHeuristique = heuristiquePhishing_(sujet, nomsPj);
    var zoneProtegee = toucheZoneProtegee_(expediteur + ' ' + sujet);

    // Catégorie : table apprise d'abord (gratuite), sinon mini-appel LLM. Sur le chemin DANGEREUX
    // « promo non lue » (archivage sans lecture), le signal suspect LLM est TOUJOURS re-demandé,
    // même pour une adresse apprise (anti-empoisonnement).
    var categorie = triApprisCache_()[adresse] || null;
    var expediteurAppris = !!triApprisCache_()[adresse]; // Marc a déjà ouvert/laissé classer ce fil → de confiance
    var suspectLlm = false;
    var cheminDangereux = promoDeterministe && nonLu;
    if ((!categorie || cheminDangereux) && !suspectHeuristique) {
      var mc = miniCategorie_(expediteur, sujet, candidats);
      if (mc === null) return 'attend'; // panne TRANSITOIRE : clé non consommée, re-tenté (≠ doute)
      suspectLlm = mc.suspect;
      if (!categorie) categorie = mc.categorie;
      // Apprentissage RESTREINT (anti-empoisonnement) : fil LU, non-promo, jamais l'adresse de
      // Marc, jamais sur signal suspect — un expéditeur n'entre dans la table qu'après qu'un
      // humain a réellement ouvert son courrier.
      if (mc.categorie && !mc.suspect && !nonLu && !promoDeterministe &&
          adresse !== proprio && !triApprisCache_()[adresse]) {
        apprendreTri_(adresse, mc.categorie);
      }
    }
    if (categorie && candidats.indexOf(categorie) === -1) categorie = null; // table corrompue → doute

    // Chemin dangereux : la garde zone protégée regarde AUSSI le corps (comme les intentions).
    if (cheminDangereux && !zoneProtegee) {
      try { zoneProtegee = toucheZoneProtegee_(tronquer_(ref.getPlainBody(), CONFIG.LLM_CORPS_MAX_CARS)); } catch (e) { }
    }

    var important = indexContient_('important|' + dernierId) ||
      !!dejaPoses[CONFIG.TRI_LIBELLES.A_TRAITER]; // ⏰ déjà posé (message antérieur) → jamais archivé

    // SUSPECT : décision PURE `decisionSuspect_` (C28-19) — la table Confiance (clic « pas
    // suspect » de Marc) outrepasse tout, y compris le libellé ⚠ déjà posé (qui reste sur le
    // fil Gmail, §2.3, mais que le système ignore désormais).
    var estMoi = adresse === proprio;
    var suspect = decisionSuspect_({
      deConfiance: !!confianceCache_()[adresse],
      heuristique: suspectHeuristique,
      llm: suspectLlm,
      estMoi: estMoi,
      appris: expediteurAppris,
      cheminDangereux: cheminDangereux,
      dejaPoseSuspect: !!dejaPoses[CONFIG.TRI_LIBELLES.SUSPECT]
    });

    var decision = decisionTri_({
      categorie: categorie,
      important: important,
      suspect: suspect,
      zoneProtegee: zoneProtegee,
      promoDeterministe: promoDeterministe,
      entierementLu: !nonLu
    });
    // Tri À LA DEMANDE (C28-16) : Marc a décoché « archiver » pour CE déclenchement — l'archivage
    // est suspendu juste avant la mutation (libellés et clé Index INCHANGÉS). NB (revue flotte
    // C28-24) : la clé posée est la même que celle du tri normal → le fil restera NON archivé
    // tant que son état (nouveau message, lu/non-lu) ne change pas — assumé : « étiqueter sans
    // archiver » est le sens du choix de Marc ; un fil qu'il relit/re-reçoit est re-trié normal.
    if (forcerNonArchivage) decision.archiver = false;

    // ÉCRITURES (les seules du module) : libellés existants + archivage réversible. Une panne ICI
    // est SYSTÉMIQUE (scope, API) : elle stoppe le run sans imputer d'échec au fil.
    try {
      for (var l = 0; l < decision.libelles.length; l++) {
        if (dejaPoses[decision.libelles[l]]) continue; // déjà posé — pas de ré-écriture
        var lab = libelles[decision.libelles[l]];
        if (lab) lab.addToThread(fil);
        else journalErreur_('TriGmail', 'Libellé absent de Gmail (jamais créé par le moteur) : ' + decision.libelles[l]);
      }
      if (decision.archiver) fil.moveToArchive();
    } catch (eEcriture) {
      signalerPanneEcriture_(eEcriture);
      return 'erreur';
    }

    indexAjouter_(cle, { statut: decision.statut, nom: sujet });
    return decision.archiver ? 'archive' : 'traite';
  } catch (e) {
    // Panne de PLATEFORME d'abord (revue flotte C28-24, leçon « classer par ORIGINE avant de
    // compter ») : un quota Gmail mort ENTRE la recherche et le traitement imputerait sinon un
    // échec à CHAQUE fil de la page (jusqu'à l'abandon `tri-abandon` à tort) — suspension posée,
    // aucun échec compté, aucune ligne par fil, le run s'arrête via plafondAtteint().
    if (signalerPanneGmail_(e)) return 'erreur';
    // Fil malade (lecture) : compté PAR ÉTAT (un nouveau message redonne sa chance), ABANDONNÉ
    // après QUARANTAINE_MAX essais — sinon : une ligne de Journal par tick pendant 30 jours.
    var essais = 0;
    try { essais = incrementerEchec_('tri|fil|' + filId + '|' + ts); } catch (e2) { }
    if (essais >= CONFIG.QUARANTAINE_MAX && filId) {
      indexAjouter_('tri-abandon|' + filId + '|' + ts, { statut: 'tri-erreur', nom: '' });
      journalErreur_('TriGmail', 'Fil ABANDONNÉ après ' + essais + ' essais (' + filId + ') : ' + e);
    } else {
      journalErreur_('TriGmail', 'Fil non trié (' + (filId || '?') + ', essai ' + (essais || '?') + ') : ' + e);
    }
    return 'erreur';
  }
}
