/**
 * TriGmail.gs — Chantier #16 (ADR-0012) : tri natif de la boîte Gmail, au fil de l'eau.
 * Remplace la tâche Cowork hebdomadaire de Marc.
 *
 * PREMIÈRE surface d'ÉCRITURE Gmail du moteur (scope `gmail.modify`, décision explicite de Marc
 * 2026-07-06). Écritures autorisées : poser un libellé EXISTANT sur un fil, archiver un fil
 * (retrait de la boîte — réversible). INTERDITS À JAMAIS (verrou par test de surface CI) :
 * corbeille, suppression, Spam, destruction de libellés, création silencieuse de libellés.
 *
 * Par fil de la fenêtre vivante (30 j) :
 *   1. idempotence : clé Index `tri|<threadId>|<ts dernier message>` — un fil ne se re-trie que
 *      s'il a reçu un nouveau message (la clé change) ; le skip ne charge PAS les messages.
 *   2. le tri passe APRÈS les intentions : on attend que le dernier message du fil ait été analysé
 *      par la Phase 3 (clé `intention|<id>`) pour que le libellé ⏰ (important) soit déjà posé —
 *      sinon on re-tentera au tick suivant, sans consommer la clé.
 *   3. phishing d'abord (heuristiques déterministes + signal LLM) → `⚠️ Suspect`, JAMAIS archivé.
 *   4. catégorie : table apprise `adresse → libellé` (gratuite) sinon mini-appel LLM parmi les
 *      libellés EXISTANTS de Marc ; introuvable/doute → `À vérifier`, jamais « le plus probable ».
 *   5. archivage prudent (règles Marc) : fil entièrement LU seulement ; promo/newsletter archivée
 *      même non lue mais UNIQUEMENT sur signal DÉTERMINISTE (en-tête List-Unsubscribe) et jamais
 *      pour la zone protégée ; jamais `⏰ À traiter`/`À vérifier`/`⚠️ Suspect`.
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
    archiver = true;  // promo/newsletter : archivée même non lue (signal DÉTERMINISTE uniquement)
  } else {
    archiver = f.entierementLu; // règle générale de Marc : archivé seulement s'il l'a OUVERT
  }
  return { libelles: libelles, archiver: archiver, statut: 'trié' };
}

/**
 * Heuristiques phishing DÉTERMINISTES, volontairement ÉTROITES (leçon « garde-fou étroit ») :
 * (a) pièce jointe à extension risquée ; (b) sujet cumulant urgence ET identifiants/paiement.
 * Le signal LLM (miniCategorie_) complète — l'un OU l'autre suffit à marquer Suspect. PURE.
 * @param {string} sujet
 * @param {string[]} nomsPj
 * @return {boolean}
 */
function heuristiquePhishing_(sujet, nomsPj) {
  for (var i = 0; i < (nomsPj || []).length; i++) {
    var nom = String(nomsPj[i]).toLowerCase();
    for (var e = 0; e < CONFIG.TRI_PJ_RISQUEES.length; e++) {
      if (nom.slice(-CONFIG.TRI_PJ_RISQUEES[e].length) === CONFIG.TRI_PJ_RISQUEES[e]) return true;
    }
  }
  var s = String(sujet || '').toLowerCase();
  var urgence = false, credentiels = false;
  for (var u = 0; u < CONFIG.TRI_MOTS_URGENCE.length; u++) {
    if (s.indexOf(CONFIG.TRI_MOTS_URGENCE[u]) !== -1) { urgence = true; break; }
  }
  for (var c = 0; c < CONFIG.TRI_MOTS_CREDENTIELS.length; c++) {
    if (s.indexOf(CONFIG.TRI_MOTS_CREDENTIELS[c]) !== -1) { credentiels = true; break; }
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
  return String(libelle || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Parse PUR de la réponse du mini-appel catégorie. La catégorie n'est acceptée que si elle est
 * EXACTEMENT dans la liste des libellés de Marc (jamais de catégorie inventée) ; sinon null →
 * `À vérifier`. `suspect` fermé par défaut (n'est vrai que sur booléen explicite).
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
      // et la table n'apprend jamais — neutralisation, leçon « garde-fou étroit ») : on matche la
      // forme normalisée mais on rend le nom EXACT du libellé de Marc.
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
        'null (jamais le plus probable). "suspect"=true si le mail ressemble à du phishing ' +
        '(usurpation d\'expéditeur, urgence artificielle, demande d\'identifiants ou de paiement).\n' +
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

/* ---------- orchestration ---------- */

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
 * Trie les fils récents — SCAN À DEUX VOIES (même patron éprouvé que les intentions, revue flotte :
 * une pagination simple re-parcourait TOUTE la fenêtre à chaque tick pendant le rattrapage — même
 * classe d'incident que le quota Gmail brûlé du 2026-07-06) :
 *   1. scan AVANT (offset 0) : capte le courrier NEUF ; s'arrête au mur de fils déjà triés.
 *   2. scan ARRIÈRE (curseur de date persistant `DriveAI_TRI_AVANT`) : draine le STOCK initial
 *      une seule fois, du plus récent au plus ancien ; « terminé » figé quand la recherche est vide.
 * Plafonds par run : `TRI_MAX_FILS_PAR_RUN` écritures, `TRI_MAX_ATTENTES` fils en attente des
 * intentions (chaque attente re-coûtera un chargement au tick suivant — on borne la facture).
 * @param {function():boolean} estBudgetDepasse
 */
function trierFilsGmail_(estBudgetDepasse) {
  var libelles = libellesUtilisateur_();
  var speciaux = [CONFIG.TRI_LIBELLES.A_VERIFIER, CONFIG.TRI_LIBELLES.SUSPECT, CONFIG.TRI_LIBELLES.A_TRAITER];
  var candidats = [];
  for (var nom in libelles) { if (speciaux.indexOf(nom) === -1) candidats.push(nom); }

  var etat = { traites: 0, attentes: 0 };
  var plafondAtteint = function () {
    return estBudgetDepasse() || estPannePlateforme_() ||
      etat.traites >= CONFIG.TRI_MAX_FILS_PAR_RUN || etat.attentes >= CONFIG.TRI_MAX_ATTENTES;
  };

  scanAvantTri_(etat, plafondAtteint, candidats, libelles);
  if (!plafondAtteint()) scanArriereTri_(etat, plafondAtteint, candidats, libelles);
}

/**
 * Scan AVANT : pages depuis l'offset 0 — là où apparaît le courrier neuf. S'arrête dès qu'une
 * page entière est déjà triée (mur du déjà-vu) : au-delà, c'est le scan ARRIÈRE qui draine.
 */
function scanAvantTri_(etat, plafondAtteint, candidats, libelles) {
  var debutPage = 0;
  while (!plafondAtteint()) {
    var fils;
    try {
      fils = GmailApp.search(CONFIG.TRI_REQUETE, debutPage, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      journalErreur_('TriGmail', 'Recherche des fils (avant) impossible : ' + e);
      return;
    }
    if (!fils.length) return;
    var pageDejaTriee = true;
    for (var i = 0; i < fils.length; i++) {
      if (plafondAtteint()) return;
      var r = trierFil_(fils[i], candidats, libelles);
      if (r === 'traite') etat.traites++;
      if (r === 'attend') etat.attentes++;
      if (r !== 'deja') pageDejaTriee = false;
    }
    if (pageDejaTriee) return; // mur du déjà-vu : le NEUF est couvert, le stock appartient à l'arrière
    debutPage += CONFIG.PAGE_FILS_ACTIONS;
  }
}

/**
 * Scan ARRIÈRE : rattrape le STOCK (fenêtre 30 j au déploiement), ancré sur une date ABSOLUE
 * persistée (`DriveAI_TRI_AVANT`) — jamais un offset numérique (leçon « pagination mouvante »).
 * Le curseur n'avance PAS si un fil du lot attend encore les intentions (il sera re-couvert) ;
 * `before:` exclusif ⇒ le jour frontière est re-couvert, l'idempotence `tri|` rend ça gratuit.
 * Recherche vide → `DriveAI_TRI_RATTRAPAGE = 'terminé'` : coût nul ensuite.
 */
function scanArriereTri_(etat, plafondAtteint, candidats, libelles) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_TRI_RATTRAPAGE') === 'terminé') return;

  while (!plafondAtteint()) {
    var avant = props.getProperty('DriveAI_TRI_AVANT');
    var requete = CONFIG.TRI_REQUETE + (avant ? ' before:' + avant : '');
    var fils;
    try {
      fils = GmailApp.search(requete, 0, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      journalErreur_('TriGmail', 'Recherche des fils (rattrapage) impossible : ' + e);
      return;
    }
    if (!fils.length) {
      props.setProperty('DriveAI_TRI_RATTRAPAGE', 'terminé');
      journalInfo_('TriGmail', 'Rattrapage du stock TERMINÉ — le scan avant suffit désormais.');
      return;
    }
    var plusAncienne = null;
    var lotEnAttente = false;
    for (var i = 0; i < fils.length; i++) {
      if (plafondAtteint()) break;
      var r = trierFil_(fils[i], candidats, libelles);
      if (r === 'traite') etat.traites++;
      if (r === 'attend') { etat.attentes++; lotEnAttente = true; }
      try {
        var d = fils[i].getLastMessageDate();
        if (!plusAncienne || d < plusAncienne) plusAncienne = d;
      } catch (e) { /* date illisible → le curseur n'avancera pas sur ce lot */ }
    }
    // Le curseur n'avance que si le lot est COMPLET et sans attente (sinon on re-couvre — gratuit).
    if (plafondAtteint() || lotEnAttente || !plusAncienne) return;
    props.setProperty('DriveAI_TRI_AVANT', dateGmail_(plusAncienne));
  }
}

/**
 * Trie UN fil. @return {'deja'|'attend'|'traite'|'erreur'}
 */
function trierFil_(fil, candidats, libelles) {
  var filId = '';
  try {
    filId = fil.getId();
    if (indexContient_('tri-abandon|' + filId)) return 'deja'; // fil malade abandonné (3 échecs)
    var cle = 'tri|' + filId + '|' + fil.getLastMessageDate().getTime();
    if (indexContient_(cle)) return 'deja'; // déjà trié dans cet état (aucun chargement de messages)

    // Libellés DÉJÀ posés sur le fil : ⏰/⚠️/À vérifier sont des décisions antérieures qui
    // survivent aux nouveaux messages (revue flotte : « important » ne se lit pas que sur le
    // dernier message — un fil marqué ⏰ ne doit JAMAIS être archivé, quel que soit le suivi).
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
    // sinon un fil où il a répondu en dernier apprendrait « marc.richard4@… → libellé » et
    // catégoriserait sur SA réponse (empoisonnement global, revue flotte). L'idempotence et le
    // gate intentions restent sur le VRAI dernier message.
    var proprio = '';
    try { proprio = (emailAlerte_() || '').toLowerCase(); } catch (e) { }
    var ref = dernier;
    if (proprio) {
      for (var mi = messages.length - 1; mi >= 0; mi--) {
        if (adresseExpediteur_(messages[mi].getFrom()) !== proprio) { ref = messages[mi]; break; }
      }
    }
    var expediteur = ref.getFrom() || '';
    var sujet = ref.getSubject() || '';
    var adresse = adresseExpediteur_(expediteur);
    var nonLu = fil.isUnread();

    var nomsPj = [];
    try {
      var pjs = piecesJointes_(ref);
      for (var p = 0; p < pjs.length; p++) nomsPj.push(pjs[p].getName());
    } catch (e) { /* PJ illisibles → heuristique sur sujet seul */ }

    var promoDeterministe = false;
    try { promoDeterministe = !!ref.getHeader('List-Unsubscribe'); } catch (e) { }

    var suspectHeuristique = heuristiquePhishing_(sujet, nomsPj);
    var zoneProtegee = toucheZoneProtegee_(expediteur + ' ' + sujet);

    // Catégorie : table apprise d'abord (gratuite), sinon mini-appel LLM. DURCISSEMENT (revue
    // flotte, anti-empoisonnement) : sur le chemin DANGEREUX « promo non lue » (archivage sans
    // lecture), le signal suspect LLM est TOUJOURS re-demandé, même pour une adresse apprise —
    // sinon un attaquant apprivoise la table avec un mail anodin puis envoie son phishing.
    var categorie = triApprisCache_()[adresse] || null;
    var suspectLlm = false;
    var cheminDangereux = promoDeterministe && nonLu;
    if ((!categorie || cheminDangereux) && !suspectHeuristique) {
      var mc = miniCategorie_(expediteur, sujet, candidats);
      if (mc === null) return 'attend'; // panne TRANSITOIRE : clé non consommée, re-tenté (≠ doute)
      suspectLlm = mc.suspect;
      if (!categorie) categorie = mc.categorie;
      // Jamais d'apprentissage sur l'adresse de Marc (fil auto-adressé) ni sur un signal suspect.
      if (mc.categorie && !mc.suspect && adresse !== proprio && !triApprisCache_()[adresse]) {
        apprendreTri_(adresse, mc.categorie);
      }
    }
    if (categorie && candidats.indexOf(categorie) === -1) categorie = null; // table corrompue → doute

    // Chemin dangereux (archivage sans lecture) : la garde zone protégée regarde AUSSI le corps
    // (comme les intentions) — un mail IRCC au sujet neutre ne doit jamais disparaître non lu.
    if (cheminDangereux && !zoneProtegee) {
      try { zoneProtegee = toucheZoneProtegee_(tronquer_(ref.getPlainBody(), CONFIG.LLM_CORPS_MAX_CARS)); } catch (e) { }
    }

    var important = indexContient_('important|' + dernierId) ||
      !!dejaPoses[CONFIG.TRI_LIBELLES.A_TRAITER]; // ⏰ déjà posé (message antérieur) → jamais archivé

    var decision = decisionTri_({
      categorie: categorie,
      important: important,
      suspect: suspectHeuristique || suspectLlm || !!dejaPoses[CONFIG.TRI_LIBELLES.SUSPECT],
      zoneProtegee: zoneProtegee,
      promoDeterministe: promoDeterministe,
      entierementLu: !nonLu
    });

    // ÉCRITURES (les seules du module) : libellés existants + archivage réversible.
    for (var l = 0; l < decision.libelles.length; l++) {
      if (dejaPoses[decision.libelles[l]]) continue; // déjà posé — pas de ré-écriture
      var lab = libelles[decision.libelles[l]];
      if (lab) lab.addToThread(fil);
      else journalErreur_('TriGmail', 'Libellé absent de Gmail (jamais créé par le moteur) : ' + decision.libelles[l]);
    }
    if (decision.archiver) fil.moveToArchive();

    indexAjouter_(cle, { statut: decision.statut, nom: sujet });
    return 'traite';
  } catch (e) {
    // Fil malade : compté, puis ABANDONNÉ après QUARANTAINE_MAX essais (sinon : une ligne de
    // Journal par tick pendant 30 jours + pagination forcée — revue flotte).
    var essais = 0;
    try { essais = incrementerEchec_('tri|fil|' + filId); } catch (e2) { }
    if (essais >= CONFIG.QUARANTAINE_MAX && filId) {
      indexAjouter_('tri-abandon|' + filId, { statut: 'tri-erreur', nom: '' });
      journalErreur_('TriGmail', 'Fil ABANDONNÉ après ' + essais + ' essais (' + filId + ') : ' + e);
    } else {
      journalErreur_('TriGmail', 'Fil non trié (' + (filId || '?') + ', essai ' + (essais || '?') + ') : ' + e);
    }
    return 'erreur';
  }
}
