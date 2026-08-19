/**
 * Mcp.gs — actions /exec du connecteur MCP DriveAI (ADR-0042).
 *
 * La passerelle MCP (Vercel, `api/mcp/*`) appelle ces actions pour servir les outils exposés à
 * claude.ai : état du moteur (Santé + avancement par mission + dernières erreurs + checkup mail),
 * recherche/lecture de documents, propositions de réorg, création d'intentions.
 *
 * Garde-fous :
 *  - SECRET DÉDIÉ serveur-à-serveur (`DriveAI_MCP_SECRET`, 3ᵉ secret de la doctrine WebApp.gs) :
 *    jamais exposé à un navigateur (≠ `DriveAI_WEBAPP_SECRET`), jamais en CI (≠ `DriveAI_SYNC_SECRET`).
 *    Non posé ⇒ MCP DÉSACTIVÉ (échec fermé). Comparaison constante (`comparaisonConstante_`).
 *  - AUCUNE nouvelle capacité moteur : chaque action RÉUTILISE une fonction existante et ses
 *    bornes (`rechercheDriveChat_`/`lireFichierChat_` : CHAT_RECHERCHE_MAX / CHAT_LIRE_MAX_CARS ;
 *    `proposerReorgChat_` : whitelist PURE + lignes `proposé` que Marc VALIDE dans l'app ;
 *    `creerTache_`/`creerEvenement_` : création seule, jeton hubperso ADR-0041).
 *  - Anti-rafale PAR action (2 s lecture / 5 s écriture, patron `antiRafalePilote_`).
 *  - `versionMcp` dans CHAQUE réponse : signal indépendant pour la passerelle — une version /exec
 *    pas encore déployée ferait tomber l'action dans le défaut du doPost (secret webapp absent ⇒
 *    « refusé »), jamais un faux succès silencieux (piège de déploiement 4).
 *  - ADR-0007 : l'état renvoyé est métadonnées seulement ; `mcp-lire` fait TRANSITER le texte
 *    d'un document (jamais stocké) — révision assumée par l'ADR-0042 §3.
 *
 * POUVOIR RÉEL si `DriveAI_MCP_SECRET` fuit, énoncé sans euphémisme (doctrine WebApp.gs, revue
 * C28-53 F3) : LIRE le TEXTE INTÉGRAL de N'IMPORTE QUEL fichier du Drive — `04 · Immigration` et
 * documents sensibles INCLUS (`mcp-lire` n'a aucun garde de zone en LECTURE ; c'est la première
 * action /exec qui EXFILTRE du contenu — à l'inverse du secret SYNC) ; rechercher en plein texte
 * tout le Drive ; inonder la file de validation Réorg (propositions seulement — Marc valide) ;
 * créer des tâches/événements ; lire l'état moteur ; déclencher l'OCR (envoi de texte à l'API,
 * aux frais de Marc), le tout borné par l'anti-rafale. Restent IMPOSSIBLES : toute suppression,
 * tout déplacement DIRECT (la réorg n'est que proposée, appliquée par le chemin gardé Reorg.gs
 * après validation de Marc), toute sortie de `04`, la lecture de la clé Anthropic, et toute
 * mutation d'état au-delà des lignes `proposé` + des Properties d'anti-rafale. Le secret ne vit
 * QUE côté serveur (Script Property ↔ env Vercel `MCP_ENGINE_SECRET`) — jamais un navigateur.
 */

var MCP_VERSION = 1;
// Dernières erreurs Journal renvoyées par mcp-etat : bornées (le Journal fait ~20 000 lignes,
// on ne lit qu'une FENÊTRE DE QUEUE — jamais l'onglet entier, leçon « borne haute »).
var MCP_ERREURS_MAX = 15;
var MCP_JOURNAL_FENETRE = 300;
// Progression : ~30 opérations/tick (réécrites, jamais append-only) — 60 couvre large. Borne de
// sécurité (leçon « borne haute sur une source qui croît ») : au-delà, on tronque la tête plutôt
// que de lire un onglet inattendu.
var MCP_PROGRESSION_MAX = 60;
/** Postes de coût renvoyés au plus (les plus chers d'abord — le reste est du bruit). */
var MCP_COUTS_MAX = 25;

/**
 * Vérifie le secret MCP dédié. FERMÉ : Property absente (MCP jamais activé) ou illisible ⇒ refus.
 * @param {Object} e  événement doPost
 * @return {boolean}
 */
function verifierSecretMcp_(e) {
  var attendu = null;
  try { attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_MCP_SECRET'); }
  catch (er) { return false; }
  var recu = e && e.parameter ? e.parameter.secret : '';
  if (!attendu || !recu || typeof recu !== 'string') return false;
  return comparaisonConstante_(recu, attendu);
}

// Actions connues et leur mode (écriture = anti-rafale plus long). La validation contre cette
// table se fait AVANT l'anti-rafale (revue sécurité F2) : une action inconnue ne doit NI lire NI
// écrire une Property de rafale — sinon un nom d'action arbitraire (`mcp-x1`, `mcp-x2`, …) crée
// une Property NEUVE à chaque requête et sature le store (~500 Ko) → tout `setProperty` du moteur
// lève (heartbeat, idempotence, budgets) = moteur cassé.
var MCP_ACTIONS = { 'mcp-etat': false, 'mcp-recherche': false, 'mcp-lire': false, 'mcp-reorg': true, 'mcp-intention': true };

/**
 * Routeur des actions `mcp-*` (appelé par doPost APRÈS vérification du secret).
 * @param {string} action
 * @param {Object} e
 * @return {Object} réponse JSON (porte TOUJOURS `versionMcp` — y compris sur exception : c'est le
 *   signal qui distingue « action connue mais en échec » de « version /exec pas déployée », revue F2/🟠1).
 */
function actionMcp_(action, e) {
  var r;
  if (!(action in MCP_ACTIONS)) {
    r = { ok: false, erreur: 'action MCP inconnue : ' + action }; // AVANT l'anti-rafale : rien écrit
  } else if (!antiRafalePilote_('DriveAI_MCP_' + action, (MCP_ACTIONS[action] ? 5 : 2) * 1000)) {
    r = { ok: false, erreur: 'trop de requêtes — réessaie dans quelques secondes' };
  } else {
    var corps = {};
    try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
    catch (er) { corps = {}; }
    // Le dispatch est ENVELOPPÉ : un blip Sheet/Drive dans une action (ex. appendRow Réorg) ne
    // doit pas faire remonter l'exception jusqu'au catch de doPost, qui rendrait `{ok:false}` SANS
    // `versionMcp` — la passerelle le lirait comme « version pas déployée » (revue 🟠1).
    try {
      if (action === 'mcp-etat') r = actionMcpEtat_();
      else if (action === 'mcp-recherche') r = actionMcpRecherche_(corps);
      else if (action === 'mcp-lire') r = actionMcpLire_(corps);
      else if (action === 'mcp-reorg') r = actionMcpReorg_(corps);
      else r = actionMcpIntention_(corps);
    } catch (er2) {
      r = { ok: false, erreur: 'erreur moteur : ' + (er2 && er2.message ? er2.message : String(er2)) };
    }
  }
  r.versionMcp = MCP_VERSION;
  return r;
}

/* ---------- mcp-etat : Santé + missions + erreurs + checkup mail ---------- */

/**
 * État complet du moteur, LECTURE SEULE, métadonnées seulement. Chaque section est enveloppée :
 * une Sheet illisible dégrade SA section (signalée explicitement), jamais toute la réponse —
 * même règle que « une erreur ne devient jamais un compte de repos ».
 * @return {Object}
 */
function actionMcpEtat_() {
  var r = { ok: true };
  try {
    // Plage DÉRIVÉE de la feuille, jamais un nombre de lignes figé (revue quotas C28-54 : passer
    // Santé de 6 à 7 lignes avait fait tomber « Mis à jour » en silence — leçon C28-45 « ajouter
    // une ligne oblige à vérifier CHAQUE plage de lecture existante »). `majSante_` réécrit
    // toujours à partir du rang 2 ; on lit donc tout ce qui existe.
    var fSante = feuille_('Santé');
    var nbSante = Math.max(0, fSante.getLastRow() - 1);
    r.sante = nbSante
      ? fSante.getRange(2, 1, nbSante, 1).getValues()
        .map(function (l) { return String(l[0] || ''); }).filter(function (t) { return !!t; })
      : [];
  } catch (e) { r.sante = null; r.santeErreur = String(e); }
  try {
    r.missions = missionsDepuisProgression_(lireOngletBorne_('Progression', MCP_PROGRESSION_MAX));
  } catch (e) { r.missions = null; r.missionsErreur = String(e); }
  // Détail du coût par usage (C28-58, demande Marc) : la même ventilation que l'onglet `Coûts`,
  // lisible depuis le connecteur — sans avoir à ouvrir la Sheet.
  try {
    var totalCout = syntheseCoutMois_();
    var vent = ventilationCoutMois_(
      lireCoutMois_(PropertiesService.getScriptProperties(), cleCoutMois_()), totalCout.dollars);
    r.couts = {
      moisDollars: Math.round(totalCout.dollars * 100) / 100,
      moisAppels: totalCout.appels,
      // `nonVentile` : ce que le total porte EN PLUS de la somme des postes (dépensé avant la mise
      // en place du détail). L'exposer évite de laisser croire que les postes couvrent tout.
      nonVentile: Math.round(vent.restant * 100) / 100,
      postes: vent.lignes.slice(0, MCP_COUTS_MAX)
    };
  } catch (e) { r.couts = null; r.coutsErreur = String(e); }
  try {
    r.erreurs = erreursDepuisJournal_(fenetreQueueJournal_(), MCP_ERREURS_MAX);
  } catch (e) { r.erreurs = null; r.erreursErreur = String(e); }
  try {
    r.mail = mailDepuisTelemetrie_(lireOngletBorne_('Télémétrie', 20));
  } catch (e) { r.mail = null; r.mailErreur = String(e); }
  // Intentions/tri : la suspension config-api (compte hubperso / API) fait partie du checkup mail.
  try {
    var config = etatPanneConfigApi_();
    r.intentionsSuspendues = !!config.actif;
    r.intentionsDetail = config.actif ? String(config.message || '') : '';
    // Verdict de la DERNIÈRE sonde (19/08) : c'est lui qui dit si la reprise automatique
    // progresse ou tourne à vide (« indetermine … » à répétition = sonde stérile). Sans ce champ,
    // il fallait aller le lire à la main dans l'onglet Santé — le MCP est justement là pour ça.
    r.intentionsSonde = config.actif ? String(config.sonde || '') : '';
  } catch (e) { r.intentionsSuspendues = null; r.intentionsErreur = String(e); }
  // Panne PLATEFORME LLM (revue 🟠3) : LE scénario « le moteur tourne mais rien ne se classe »
  // (crédit épuisé, 401, 529 prolongé). Lue à la MÊME fenêtre que la décision (`chargerPannePlateforme_`,
  // LLM_PANNE_RESONDE_MS) — une observabilité qui divergerait de la décision serait pire que rien.
  // La ligne ERREUR du Journal, elle, est posée à la POSE de la panne : sur plusieurs jours elle sort
  // de la fenêtre de queue — ce champ dédié ne ment jamais.
  try {
    var props = PropertiesService.getScriptProperties();
    var tLlm = Number(props.getProperty('DriveAI_LLM_PANNE')) || 0;
    r.llmSuspendu = !!tLlm && Date.now() - tLlm < CONFIG.LLM_PANNE_RESONDE_MS;
  } catch (e) { r.llmSuspendu = null; r.llmErreur = String(e); }
  return r;
}

/** Lit les lignes de données d'un onglet, bornées à `maxLignes` (jamais l'onglet entier). */
function lireOngletBorne_(nom, maxLignes) {
  var f = feuille_(nom);
  var dern = f.getLastRow();
  if (dern < 2) return [];
  var n = Math.min(dern - 1, maxLignes);
  return f.getRange(2, 1, n, f.getLastColumn()).getValues();
}

/**
 * Lignes Progression (13 col, cf. COLONNES_PROGRESSION) → objets « avancement par mission ».
 * PURE (testée). L'app lit ces mêmes colonnes : on réplique EXACTEMENT les index du contrat
 * (leçon : toute surface qui ré-affiche réplique la même conversion), sans re-calculer.
 * @param {Array[]} lignes
 * @return {Array<Object>}
 */
function missionsDepuisProgression_(lignes) {
  return (lignes || []).filter(function (l) { return l && String(l[1] || '') !== ''; })
    .map(function (l) {
      return {
        operation: String(l[1]), traites: l[2] === '' ? null : Number(l[2]),
        base: l[3] === '' ? null : Number(l[3]), unite: String(l[4] || ''),
        statut: String(l[5] || ''), detail: String(l[7] || ''),
        derniereActivite: String(l[8] || ''), derniereErreur: String(l[9] || ''),
        type: String(l[10] || ''), dernierePasse: String(l[11] || ''), finEstimee: String(l[12] || '')
      };
    });
}

/** Fenêtre de QUEUE du Journal (dernières `MCP_JOURNAL_FENETRE` lignes) — jamais tout l'onglet. */
function fenetreQueueJournal_() {
  var f = feuille_('Journal');
  var dern = f.getLastRow();
  if (dern < 2) return [];
  var n = Math.min(dern - 1, MCP_JOURNAL_FENETRE);
  return f.getRange(dern - n + 1, 1, n, 4).getValues();
}

/**
 * Extrait les N DERNIÈRES erreurs d'une fenêtre de Journal ([Date, Niveau, Source, Message]).
 * PURE (testée). Les plus récentes d'abord.
 * @param {Array[]} lignes
 * @param {number} n
 * @return {Array<Object>}
 */
function erreursDepuisJournal_(lignes, n) {
  var erreurs = [];
  for (var i = (lignes || []).length - 1; i >= 0 && erreurs.length < n; i--) {
    if (String(lignes[i][1]) !== 'ERREUR') continue;
    var ts = lignes[i][0];
    erreurs.push({
      date: ts instanceof Date ? ts.toISOString() : String(ts),
      // Défense en profondeur (revue F6, ADR-0007) : les écrivains du Journal ne portent que des
      // métadonnées, mais on tronque tout de même — un message ne doit jamais devenir un canal de
      // contenu, même par un futur `journalErreur_` plus bavard.
      source: String(lignes[i][2] || ''), message: String(lignes[i][3] || '').slice(0, 300)
    });
  }
  return erreurs;
}

/**
 * Lignes Télémétrie ([Clé, Valeur, Unité, Détail] — cf. COLONNES_TELEMETRIE) → checkup mail/quotas.
 * PURE (testée). Le champ de sortie garde le nom `note` (le Détail EST une note pour l'app).
 * @param {Array[]} lignes
 * @return {Array<Object>}
 */
function mailDepuisTelemetrie_(lignes) {
  return (lignes || []).filter(function (l) { return l && String(l[0] || '') !== ''; })
    .map(function (l) {
      return { cle: String(l[0]), valeur: String(l[1]), unite: String(l[2] || ''), note: String(l[3] || '') };
    });
}

/* ---------- mcp-recherche / mcp-lire : documents ---------- */

/**
 * Recherche par NOM (défaut) ou par CONTENU (`mode:"contenu"`). Réutilise `rechercheDriveChat_`
 * (bornes et format inclus). @param {Object} corps  {requete, mode?}
 */
function actionMcpRecherche_(corps) {
  var requete = typeof corps.requete === 'string' ? corps.requete.trim() : '';
  if (!requete || requete.length > 200) return { ok: false, erreur: 'requete invalide (1 à 200 caractères)' };
  var champ = corps.mode === 'contenu' ? 'fullText' : 'title';
  return { ok: true, resultat: rechercheDriveChat_(champ, requete) };
}

/**
 * Texte d'un document (borné : CHAT_LIRE_MAX_CARS / OCR_TAILLE_MAX — hérités de `lireFichierChat_`).
 * @param {Object} corps  {fileId}
 */
function actionMcpLire_(corps) {
  var fileId = typeof corps.fileId === 'string' ? corps.fileId.trim() : '';
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(fileId)) return { ok: false, erreur: 'fileId invalide' };
  return { ok: true, contenu: lireFichierChat_(fileId) };
}

/* ---------- mcp-reorg : PROPOSITIONS (Marc valide dans l'app, jamais d'application ici) ---------- */

/** @param {Object} corps  {actions:[…]} — même schéma que l'outil chat `proposer_reorg`. */
function actionMcpReorg_(corps) {
  if (!Array.isArray(corps.actions) || !corps.actions.length) {
    return { ok: false, erreur: 'actions[] requis (types : deplacer-fichier, creer, deplacer, fusionner, renommer)' };
  }
  return { ok: true, resultat: proposerReorgChat_({ actions: corps.actions }) };
}

/* ---------- mcp-intention : création Tasks/Calendar (jeton hubperso, ADR-0041) ---------- */

/**
 * Crée UNE tâche ou UN événement. Compte hubperso non lié / API non activée : erreur CLAIRE
 * (le message config-api est actionnable), jamais un plantage — et on ne touche PAS à l'état de
 * suspension du moteur (le scan d'intentions gère le sien ; un échec MCP n'est pas une panne du tick).
 * @param {Object} corps  {type:'tache'|'evenement', titre, echeance?, dateHeure?, dureeMinutes?, notes?}
 */
function actionMcpIntention_(corps) {
  var type = corps.type === 'evenement' ? 'evenement' : (corps.type === 'tache' ? 'tache' : '');
  var titre = typeof corps.titre === 'string' ? corps.titre.trim().slice(0, 200) : '';
  if (!type || !titre) return { ok: false, erreur: 'type (« tache » ou « evenement ») et titre requis' };
  var notes = typeof corps.notes === 'string' ? corps.notes.slice(0, 1000) : '';
  try {
    if (type === 'tache') {
      var echeance = typeof corps.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(corps.echeance)
        ? corps.echeance : '';
      var id = creerTache_(titre, echeance, notes);
      return id ? { ok: true, cree: 'tache', id: id }
        : { ok: false, erreur: 'création refusée par l\'API Tasks (détail au Journal)' };
    }
    var dateHeure = typeof corps.dateHeure === 'string' ? corps.dateHeure : '';
    var idE = creerEvenement_(titre, dateHeure, Number(corps.dureeMinutes) || 60, notes);
    return idE ? { ok: true, cree: 'evenement', id: idE }
      : { ok: false, erreur: 'création refusée — dateHeure au format « AAAA-MM-JJTHH:MM:SS » ? (détail au Journal)' };
  } catch (er) {
    // `config-api …` (compte hubperso non lié, API non activée) — message actionnable tel quel.
    return { ok: false, erreur: 'indisponible : ' + (er && er.message ? er.message : String(er)) };
  }
}
