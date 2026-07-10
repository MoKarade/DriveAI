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

  // Tri À LA DEMANDE (C28-16) : la demande de Marc (fenêtre/archiver/plafond posée par l'app)
  // passe EN PREMIER — c'est lui qui a cliqué. Elle s'étale sur plusieurs ticks si besoin
  // (offset/faits persistés), toujours sous les plafonds par run du tri.
  scanDemandeTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanAvantTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanArriereTri_(etat, plafondAtteint, candidats, libelles);
}

/**
 * Scan À LA DEMANDE (C28-16) : consomme la Property `DriveAI_TRI_DEMANDE` posée par l'app
 * (`actionDemandeTri_` — fenêtre ∈ {1,7,30} j, archiver oui/non, plafond de fils TRAITÉS).
 * Pages depuis un offset persistant ; les fils déjà à jour (clé `tri|fil|ts|lu` à l'Index)
 * sont sautés gratuitement — re-trier une fenêtre déjà triée ne re-paie ni ne re-archive rien.
 * Le plafond compte les fils réellement TRAITÉS (écritures) ; une page interrompue par le
 * budget du run rejouera au tick suivant (offset inchangé, déjà-vus gratuits). La demande est
 * effacée quand ENTIÈREMENT servie (plafond atteint ou fenêtre épuisée) — reprenable si coupée.
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
  if (!demande || !demande.fenetre || !demande.plafond) {
    // Demande illisible (Property corrompue) : purgée — jamais une boucle d'erreurs à chaque tick.
    effacerDemandeTri_(props, 0, 'demande illisible — annulée');
    return;
  }
  var requete = 'newer_than:' + demande.fenetre + 'd in:inbox';

  while (!plafondAtteint()) {
    var faits = Number(props.getProperty('DriveAI_TRI_DEMANDE_FAITS')) || 0;
    if (faits >= demande.plafond) {
      effacerDemandeTri_(props, faits, 'plafond atteint');
      return;
    }
    var offset = Number(props.getProperty('DriveAI_TRI_DEMANDE_OFFSET')) || 0;
    var fils;
    try {
      fils = GmailApp.search(requete, offset, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      if (signalerPanneGmail_(e)) return; // quota : demande INTACTE, reprise après la re-sonde
      journalErreur_('TriGmail', 'Recherche du tri à la demande impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_();
    if (!fils.length) {
      effacerDemandeTri_(props, faits, 'fenêtre épuisée');
      return;
    }
    for (var i = 0; i < fils.length; i++) {
      if (plafondAtteint() || faits >= demande.plafond) break; // la page rejouera (déjà-vus gratuits)
      var r = trierFil_(fils[i], candidats, libelles, false, !demande.archiver);
      if (r === 'traite') { etat.traites++; faits++; }
      if (r === 'attend') etat.attentes++;
    }
    props.setProperty('DriveAI_TRI_DEMANDE_FAITS', String(faits));
    if (faits >= demande.plafond) {
      effacerDemandeTri_(props, faits, 'plafond atteint');
      return;
    }
    if (plafondAtteint()) return; // page interrompue par le run : offset INCHANGÉ (rejeu gratuit)
    props.setProperty('DriveAI_TRI_DEMANDE_OFFSET', String(offset + fils.length));
  }
}

/** Solde une demande de tri : Properties purgées + bilan journalisé (une seule ligne). */
function effacerDemandeTri_(props, faits, motif) {
  props.deleteProperty('DriveAI_TRI_DEMANDE');
  props.deleteProperty('DriveAI_TRI_DEMANDE_OFFSET');
  props.deleteProperty('DriveAI_TRI_DEMANDE_FAITS');
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
      if (r === 'traite') etat.traites++;
      if (r === 'attend') etat.attentes++;
      if (r !== 'deja') pageAJour = false;
    }
    if (pageAJour) return; // mur du déjà-à-jour : le stock appartient au scan arrière
    debutPage += CONFIG.PAGE_FILS_ACTIONS;
  }
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
      if (r === 'traite') etat.traites++;
      if (r === 'attend') { etat.attentes++; lotComplet = false; }
      if (r === 'erreur') lotComplet = false; // rejoué (l'abandon par fil borne les fils malades)
    }
    if (!lotComplet) return; // rejeu du lot au prochain tick (idempotence = gratuit)
    props.setProperty('DriveAI_TRI_OFFSET', String(offset + fils.length));
  }
}

/**
 * Trie UN fil. @return {'deja'|'attend'|'traite'|'erreur'}
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
    if (!indexContient_('intention|' + dernierId)) return 'attend';

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

    // SUSPECT (recalibré 2026-07-07) : l'heuristique déterministe (.exe/.scr) prime toujours ; le signal
    // LLM ne compte QUE s'il vise un expéditeur qui n'est ni Marc lui-même (G1 : on ne se phishe pas) ni
    // un expéditeur DÉJÀ de confiance (G2 : dans TriAppris) — SAUF sur le chemin dangereux « promo non lue
    // archivée sans lecture » où l'on re-vérifie même un expéditeur appris (anti-empoisonnement, inchangé).
    // Un fil déjà marqué ⚠️ le reste (le moteur ne retire jamais un libellé — garde-fou).
    var estMoi = adresse === proprio;
    var suspect = suspectHeuristique ||
      (suspectLlm && !estMoi && (!expediteurAppris || cheminDangereux)) ||
      !!dejaPoses[CONFIG.TRI_LIBELLES.SUSPECT];

    var decision = decisionTri_({
      categorie: categorie,
      important: important,
      suspect: suspect,
      zoneProtegee: zoneProtegee,
      promoDeterministe: promoDeterministe,
      entierementLu: !nonLu
    });
    // Tri À LA DEMANDE (C28-16) : Marc a décoché « archiver » pour CE déclenchement — l'archivage
    // est suspendu juste avant la mutation (libellés et clé Index INCHANGÉS) ; la politique du
    // tri automatique quotidien n'est pas modifiée.
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
    return 'traite';
  } catch (e) {
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
