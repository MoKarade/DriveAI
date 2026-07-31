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
 *  - `action=pousser-reset` (ADR-0032) : GitHub Actions pousse UNE passe du grand rangement,
 *    exécutée SYNCHRONEMENT ici — hors du quota des DÉCLENCHEURS, comme un clic de Marc dans
 *    l'éditeur. ⚠️ Ne JAMAIS router vers `actionTickPonctuel_` (elle CRÉE un déclencheur, donc
 *    consommerait le quota que tout ce montage protège). Secret CI.
 *  - `action=assurer-trigger` (ADR-0032) : ré-installe le déclencheur après un déploiement —
 *    remplace le dernier geste manuel de Marc. Secret CI.
 *
 * Secrets — DEUX, jamais confondus :
 *  - `DriveAI_WEBAPP_SECRET` (défaut, recherche-ia) : exposé côté NAVIGATEUR par conception
 *    (app/src/config.ts — « la sécurité vient du login Google, pas du secret »).
 *  - `DriveAI_SYNC_SECRET` (sync-miroir, pousser-reset, assurer-trigger) : DÉDIÉ, JAMAIS exposé
 *    à un navigateur — connu seulement de GitHub Actions (secret CI) et du script.
 *    ⚠️ POUVOIR RÉEL s'il fuit, énoncé sans euphémisme (corrigé en revue C28-43 — la version
 *    précédente prétendait « jamais une lecture de document », ce qui était FAUX) : écrire des
 *    fichiers texte dans `_Miroir du dépôt` ; faire avancer le rangement, donc DÉPLACER et RENOMMER
 *    des documents classés ; écrire l'état (Index/Journal/Reset) ; déclencher un OCR et l'envoi de
 *    TEXTE DE DOCUMENT à l'API Anthropic aux frais de Marc (borné par le frein §2.6 et par
 *    `PILOTE_BUDGET_JOUR_MS`) ; réinstaller les déclencheurs ; monopoliser le verrou du moteur.
 *    Restent IMPOSSIBLES : toute suppression, toute sortie de `04 · Immigration`, et toute
 *    EXFILTRATION (les réponses ne portent que des compteurs — jamais un contenu de document).
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
    } else if (action === 'pousser-reset') {
      reponse = verifierSecretSync_(e)
        ? (antiRafalePilote_('DriveAI_DERNIER_PILOTE', CONFIG.TICK_MINUTES * 60 * 1000)
          ? pousserResetPilote_()
          : { ok: true, termine: false, rondes: 0, progres: false, message: 'passe trop rapprochée — ignorée' })
        : { ok: false, erreur: 'refusé' };
    } else if (action === 'assurer-trigger') {
      reponse = verifierSecretSync_(e)
        ? (antiRafalePilote_('DriveAI_DERNIER_ASSURE_TRIGGER', 10 * 60 * 1000)
          ? actionAssurerTrigger_()
          : { ok: true, version: versionPilote_(), message: 'déclencheur déjà assuré il y a moins de 10 min' })
        : { ok: false, erreur: 'refusé' };
    } else {
      var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_WEBAPP_SECRET');
      var recu = e && e.parameter ? e.parameter.secret : '';
      if (!attendu || !recu || recu !== attendu) {
        reponse.erreur = 'refusé';
      } else if (action === 'recherche-ia') {
        reponse = actionRechercheIA_(e);
      } else if (action === 'chat-assistant') {
        reponse = actionChatAssistant_(e);
      } else if (action === 'pas-suspect') {
        reponse = actionPasSuspect_(e);
      } else if (action === 'hub-summary') {
        reponse = actionHubSummary_();
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

/* ---------- Pilote CI (ADR-0032) : ré-installation du déclencheur, sans Marc ---------- */

/**
 * Ré-installe le déclencheur temporel — EXACTEMENT ce que Marc faisait à la main dans l'éditeur
 * après chaque merge moteur (`Main.gs` → `installerTrigger`). Appelée par `deploy.yml` APRÈS
 * `clasp push` + `clasp deploy`, elle ferme le piège de déploiement (3) : un `clasp push` vert ne
 * garantit pas que le déclencheur exécute le NOUVEAU code — supprimer/recréer le déclencheur le
 * force (prod figée ~4 j vécue, CI verte, zéro erreur).
 *
 * Le champ `version` de la réponse est le SIGNAL INDÉPENDANT attendu par la CI : s'il manque, c'est
 * que la web app `/exec` sert encore une version qui ne connaît pas cette action (piège (4) : l'appel
 * tombe alors dans le `else` du `doPost` et « réussit » en silence) — le workflow le détecte au lieu
 * de conclure à tort que le déclencheur a été réinstallé.
 */
function actionAssurerTrigger_() {
  installerTrigger();
  return {
    ok: true,
    version: versionPilote_(),
    message: 'déclencheur réinstallé (' + CONFIG.TICK_MINUTES + ' min) — plus aucun geste manuel requis'
  };
}

/** Empreinte de la version SERVIE par `/exec` — signal indépendant pour la CI (piège de déploiement (4)). */
function versionPilote_() {
  return String(CONFIG.TICK_MINUTES) + 'min|' + CONFIG.RESET_TABLE_VERSION;
}

/**
 * Anti-rafale dédié aux actions du pilote (l'en-tête de ce fichier le promet pour TOUTE action —
 * cette promesse doit être CODÉE, pas seulement écrite). Deux abus concrets qu'il ferme, pour qui
 * détiendrait le secret CI : `assurer-trigger` en boucle fait `delete`+`create` du déclencheur, donc
 * en le rappelant plus vite que `TICK_MINUTES` le tick ne se déclencherait JAMAIS (gel silencieux) ;
 * `pousser-reset` en rafale monopoliserait le verrou et affamerait le flux vivant.
 * @return {boolean} vrai si l'appel peut procéder (et la fenêtre est alors consommée).
 */
function antiRafalePilote_(cle, intervalleMs) {
  var props = PropertiesService.getScriptProperties();
  var dernier = Number(props.getProperty(cle)) || 0;
  if (Date.now() - dernier < intervalleMs) return false;
  props.setProperty(cle, String(Date.now()));
  return true;
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

/* ---------- Assistant CHAT (C28-30, ADR-0026) : Q&A qui LIT le contenu + PROPOSE des opérations ----
 * Boucle Tool Use (Llm.appelAnthropicChat_) : l'app envoie l'historique éphémère, le moteur cherche
 * (nom → contenu) et LIT les fichiers à la volée, répond, oublie tout (ADR-0007 : rien de persisté).
 * PR2 : l'outil `proposer_reorg` écrit des lignes `proposé` dans l'onglet `Réorg` — le chat ne MUTE
 * JAMAIS le Drive lui-même ; l'application reste confinée à Reorg.gs (`appliquerUneAction_`, chemin
 * GARDÉ C21-06) après validation de Marc dans l'app.
 */

/** Consommation $ du chat AUJOURD'HUI (Script Property `AAAA-MM-JJ|dollars`). PURE sur props. */
function coutChatJour_(props, jour) {
  var brut = String(props.getProperty('DriveAI_CHAT_COUT_JOUR') || '');
  return brut.indexOf(jour + '|') === 0 ? (Number(brut.split('|')[1]) || 0) : 0;
}

/**
 * Ne garde que les `maxN` DERNIERS messages de l'historique (tokens + latence ; et un chat long ne
 * casse plus l'appel — avant : rejet au-delà de la borne). Coupe sur une frontière PAIRE pour garder
 * un `user` en tête : l'API Messages exige 1er tour = user + alternance stricte, et un historique
 * valide a un `user` à chaque indice pair. Le dernier message (question courante) est toujours
 * conservé. Ne touche PAS au prompt système (hors `messages`). PURE (testée) ; n'assainit rien —
 * `validerHistoriqueChat_` valide APRÈS (un `brut` malformé sera rejeté là, jamais faussement accepté).
 * @param {Array} brut
 * @param {number} maxN
 * @return {Array}
 */
function tronquerHistoriqueChat_(brut, maxN) {
  if (!Array.isArray(brut)) return []; // contrat @return {Array} (chemin mort : garde amont de validerHistoriqueChat_)
  if (brut.length <= maxN) return brut;
  var debut = brut.length - maxN;
  if (debut % 2 !== 0) debut++; // frontière paire = message `user` en tête (jamais un `assistant`)
  return brut.slice(debut);
}

/**
 * Valide l'historique reçu : tableau non vide de {role:'user'|'assistant', content:string}
 * (≤ MAX_CARS), 1er tour = user, alternance stricte, se terminant par un tour `user`. TRONQUE d'abord
 * aux `CHAT_HISTORIQUE_MAX` derniers messages (tokens + latence). Renvoie les messages assainis, ou
 * null. PURE (testée).
 */
function validerHistoriqueChat_(brut) {
  if (!Array.isArray(brut) || !brut.length) return null;
  brut = tronquerHistoriqueChat_(brut, CONFIG.CHAT_HISTORIQUE_MAX); // garde les N derniers (user en tête)
  var messages = [];
  for (var i = 0; i < brut.length; i++) {
    var m = brut[i];
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    var contenu = m.content.trim();
    if (!contenu || contenu.length > CONFIG.CHAT_MESSAGE_MAX_CARS) return null;
    // L'API Messages exige : 1er tour = user, alternance stricte user/assistant, dernier = user.
    var attendu = (i % 2 === 0) ? 'user' : 'assistant';
    if (m.role !== attendu) return null;
    messages.push({ role: m.role, content: contenu });
  }
  if (messages[messages.length - 1].role !== 'user') return null; // le dernier tour est une question de Marc
  return messages;
}

/** Définitions des outils LECTURE offerts au modèle (format `tools` Anthropic). */
function outilsChatAssistant_() {
  return [
    { name: 'recherche_nom',
      description: 'Cherche des fichiers du Drive de Marc par leur NOM (rapide). Renvoie une liste avec l\'id et le dossier de chacun.',
      input_schema: { type: 'object', properties: { requete: { type: 'string', description: 'terme à chercher dans le nom du fichier' } }, required: ['requete'] } },
    { name: 'recherche_contenu',
      description: 'Cherche des fichiers par leur CONTENU (plein-texte). Plus lent — n\'utilise que si la recherche par nom ne suffit pas.',
      input_schema: { type: 'object', properties: { requete: { type: 'string', description: 'terme à chercher dans le contenu' } }, required: ['requete'] } },
    { name: 'lire_fichier',
      description: 'Lit le TEXTE d\'un fichier (par son id) pour en extraire une information. Coûteux : ne lis que les fichiers vraiment pertinents.',
      input_schema: { type: 'object', properties: { fileId: { type: 'string', description: 'id du fichier à lire (obtenu via une recherche)' } }, required: ['fileId'] } },
    { name: 'proposer_reorg',
      description: 'PROPOSE des opérations sur les dossiers/fichiers (Marc les VALIDE ensuite dans l\'app — tu n\'appliques rien toi-même). Utilise les id EXACTS obtenus via tes recherches. Types : ' +
        '"deplacer-fichier" (source=id du FICHIER, cible=id du DOSSIER destination) ; "creer" (cible=id du dossier PARENT, nom=nom du nouveau dossier) ; ' +
        '"deplacer" (source=id d\'un DOSSIER, cible=id du dossier destination) ; "fusionner" (source=id d\'un DOSSIER vidé dans cible=id destination) ; "renommer" (source=id d\'un DOSSIER, nom=nouveau nom).',
      input_schema: { type: 'object', properties: {
        actions: { type: 'array', description: 'liste des opérations proposées', items: { type: 'object', properties: {
          type: { type: 'string', enum: ['deplacer-fichier', 'creer', 'deplacer', 'fusionner', 'renommer'] },
          source: { type: 'string', description: 'id du fichier/dossier source (selon le type)' },
          cible: { type: 'string', description: 'id du dossier cible/parent (selon le type)' },
          nom: { type: 'string', description: 'nouveau nom (creer/renommer)' },
          source_nom: { type: 'string', description: 'nom lisible de la source (pour l\'aperçu de Marc)' },
          cible_nom: { type: 'string', description: 'nom lisible du dossier cible (pour l\'aperçu)' },
          raison: { type: 'string', description: 'justification courte' },
        }, required: ['type'] } },
        synthese: { type: 'string', description: 'résumé en 1-2 phrases de ce que tu proposes' },
      }, required: ['actions'] } },
  ];
}

/** Exécute UN outil demandé par le modèle. Renvoie toujours une string (rendue au modèle). */
function executerOutilChatAssistant_(nom, input) {
  if (nom === 'recherche_nom') return rechercheDriveChat_('title', input && input.requete);
  if (nom === 'recherche_contenu') return rechercheDriveChat_('fullText', input && input.requete);
  if (nom === 'lire_fichier') return lireFichierChat_(input && input.fileId);
  if (nom === 'proposer_reorg') return proposerReorgChat_(input || {});
  return 'Outil inconnu : ' + nom;
}

/** Recherche Drive (champ = 'title' ou 'fullText'), bornée, non corbeillés. Renvoie un texte lisible. */
function rechercheDriveChat_(champ, requete) {
  var q = String(requete == null ? '' : requete).trim();
  if (!q) return 'Requête vide.';
  var sain = q.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); // échappe pour la requête Drive
  var it;
  try { it = DriveApp.searchFiles(champ + " contains '" + sain + "' and trashed = false"); }
  catch (e) { return 'Recherche impossible : ' + e; }
  var lignes = [], n = 0;
  while (it.hasNext() && n < CONFIG.CHAT_RECHERCHE_MAX) {
    var f = it.next();
    var dossier = '';
    try { var ps = f.getParents(); if (ps.hasNext()) dossier = ps.next().getName(); } catch (e2) { /* dossier ? */ }
    lignes.push('- ' + f.getName() + ' [id:' + f.getId() + '] (dossier: ' + (dossier || '?') + ')');
    n++;
  }
  if (!lignes.length) return 'Aucun fichier trouvé pour « ' + q + ' ».';
  return lignes.length + ' fichier(s) :\n' + lignes.join('\n') +
    (it.hasNext() ? '\n(… d\'autres résultats existent, affine si besoin)' : '');
}

/** Lit le texte d'un fichier (borné en taille + caractères). Renvoie un texte lisible pour le modèle. */
function lireFichierChat_(fileId) {
  var id = String(fileId == null ? '' : fileId).trim();
  if (!id) return 'fileId manquant.';
  var f;
  try { f = DriveApp.getFileById(id); } catch (e) { return 'Fichier introuvable : ' + id; }
  try {
    if (f.getSize() > CONFIG.OCR_TAILLE_MAX) {
      return 'Fichier trop volumineux pour être lu (> ' + Math.round(CONFIG.OCR_TAILLE_MAX / 1048576) + ' Mo).';
    }
    var texte = extraireTexte_(f.getBlob(), CONFIG.CHAT_LIRE_MAX_CARS);
    if (texte === null) return 'Contenu illisible (échec d\'extraction transitoire).';
    if (texte === '') return 'Ce fichier ne contient pas de texte extractible (image/média sans OCR ?).';
    return 'Contenu de « ' + f.getName() + ' » :\n' + texte;
  } catch (e) { return 'Lecture impossible : ' + e; }
}

/* ---------- proposer_reorg (C28-30 PR2) : le chat PROPOSE, Marc VALIDE, le moteur APPLIQUE ----------
 * Le modèle fournit des actions avec de VRAIS id Drive (obtenus par ses recherches). On les WHITELISTE
 * (PURE) puis on écrit des lignes `proposé` dans l'onglet `Réorg` — SANS jamais muter le Drive ici :
 * l'application (déplacements/créations, re-vérif zone 04 par mutation) reste confinée à Reorg.gs
 * (`appliquerUneAction_`) après validation de Marc dans l'app (réutilisation du chemin GARDÉ C21-06).
 */

/** Champs par type d'action (id requis + nom requis). PURE. @return {?{src:boolean, cib:boolean, nom:boolean}} */
function champsActionChat_(type) {
  if (type === 'deplacer-fichier' || type === 'deplacer' || type === 'fusionner') return { src: true, cib: true, nom: false };
  if (type === 'creer') return { src: false, cib: true, nom: true };
  if (type === 'renommer') return { src: true, cib: false, nom: true };
  return null;
}

/**
 * WHITELISTE les actions proposées par le modèle (donnée NON fiable). PURE (testée). Ne valide QUE la
 * FORME (type connu, id requis non vides, nom sans « / » borné) — l'EXISTENCE des id et les gardes de
 * zone protégée sont re-vérifiées à l'APPLICATION (Reorg.gs, échec-fermé par mutation). Rejet PAR
 * action (jamais tout le plan). @return {?{actions: Array, ignorees: number}} — null si aucune valide.
 */
function parserActionsChat_(brut) {
  if (!Array.isArray(brut) || !brut.length) return null;
  var actions = [];
  var ignorees = 0;
  for (var i = 0; i < brut.length && actions.length < CONFIG.REORG_ACTIONS_MAX; i++) {
    var a = brut[i];
    var champs = a && typeof a === 'object' ? champsActionChat_(String(a.type)) : null;
    if (!champs) { ignorees++; continue; }
    // « → » retiré : c'est le séparateur de la colonne ID de l'onglet Réorg — un id Drive n'en
    // contient jamais ; l'invariant « source→cible » reste non ambigu (défense en profondeur).
    var source = typeof a.source === 'string' ? a.source.trim().replace(/→/g, '') : '';
    var cible = typeof a.cible === 'string' ? a.cible.trim().replace(/→/g, '') : '';
    var nom = typeof a.nom === 'string' ? a.nom.trim().slice(0, 80) : '';
    if (champs.src && !source) { ignorees++; continue; }
    if (champs.cib && !cible) { ignorees++; continue; }
    if (champs.nom && (!nom || nom.indexOf('/') !== -1)) { ignorees++; continue; }
    actions.push({
      type: String(a.type), source: source, cible: cible, nom: nom,
      sourceNom: (typeof a.source_nom === 'string' ? a.source_nom : '').trim().slice(0, 120),
      cibleNom: (typeof a.cible_nom === 'string' ? a.cible_nom : '').trim().slice(0, 120),
      raison: (typeof a.raison === 'string' ? a.raison : '').trim().slice(0, 150),
    });
  }
  if (!actions.length) return null;
  return { actions: actions, ignorees: ignorees + Math.max(0, brut.length - CONFIG.REORG_ACTIONS_MAX - ignorees) };
}

/**
 * Ligne d'onglet `Réorg` (8 col : Clé|Type|ID|Chemin actuel|Chemin proposé|Statut|Détail|Horodaté)
 * pour une action de CHAT. PURE (testée). Colonne ID = « source→cible » (comme `lignePourAction_`) :
 * deplacer-fichier/deplacer/fusionner portent les deux, creer « →parent », renommer la source seule.
 * Les chemins sont les LIBELLÉS lisibles fournis par le modèle (aperçu de Marc) ; l'application
 * raisonne par ID, jamais par ces libellés.
 */
function ligneActionChat_(tag, n, a, horodate) {
  var cle = tag + '|' + n;
  var actuel = a.sourceNom || '';
  var propose;
  var idCol;
  if (a.type === 'creer') { idCol = '→' + a.cible; propose = (a.cibleNom ? a.cibleNom + '/' : '') + a.nom; }
  else if (a.type === 'renommer') { idCol = a.source; propose = a.nom; }
  else { idCol = a.source + '→' + a.cible; propose = a.cibleNom || ''; } // deplacer-fichier / deplacer / fusionner
  return [cle, a.type, idCol, actuel, propose, 'proposé', a.raison, horodate];
}

/**
 * Outil `proposer_reorg` : whiteliste les actions et les écrit `proposé` dans l'onglet `Réorg`
 * (append par ligne). Le tick n'APPLIQUE que les lignes `validé` → une ligne fraîchement `proposé`
 * n'est jamais consommée avant validation de Marc. (Fenêtre de course résiduelle, minuscule et
 * PRÉ-EXISTANTE — l'app écrit déjà des lignes depuis le navigateur pendant le tick : au pire une
 * proposition perdue si un append tombe dans le `setValues`-bloc du tick ; Marc reformule. Aucune
 * garde-fou perdue.) AUCUNE mutation Drive. Renvoie un compte-rendu lisible pour le modèle.
 */
function proposerReorgChat_(input) {
  var parse = parserActionsChat_(input.actions);
  if (!parse) return 'Aucune action valide à proposer (vérifie les id et les types).';
  var tag = 'chatreorg|' + Date.now();
  var horodate = new Date().toISOString();
  var f = feuille_('Réorg');
  for (var i = 0; i < parse.actions.length; i++) {
    f.appendRow(ligneActionChat_(tag, i + 1, parse.actions[i], horodate));
  }
  return 'J\'ai proposé ' + parse.actions.length + ' opération(s) dans l\'onglet Assistant' +
    (parse.ignorees ? ' (' + parse.ignorees + ' ignorée(s), mal formée(s))' : '') +
    '. Marc doit les VALIDER pour que je les applique — préviens-le et résume-lui ce que tu proposes.';
}

/** Prompt système de l'assistant : Q&A LECTURE + PROPOSITION d'opérations (jamais d'application directe). */
function promptChatAssistant_() {
  return 'Tu es l\'assistant personnel de DriveAI, le classeur de documents de Marc Richard. Tu réponds à ' +
    'ses questions en retrouvant et en LISANT ses fichiers. Méthode : cherche d\'abord par NOM ' +
    '(recherche_nom), puis par CONTENU (recherche_contenu) si le nom ne suffit pas, puis LIS ' +
    '(lire_fichier) le ou les fichiers pertinents pour en extraire l\'info demandée. Va au but en le ' +
    'moins d\'étapes possible : ne relis jamais un fichier déjà lu et arrête-toi dès que tu as l\'info. ' +
    'Cite TOUJOURS le nom du fichier d\'où vient l\'information. Réponds en français, clair et concis. Si tu ne trouves pas, ' +
    'dis-le honnêtement — n\'invente JAMAIS une réponse.\n' +
    'Tu peux aussi ORGANISER le Drive : créer/renommer/fusionner des dossiers, et déplacer des ' +
    'fichiers (« range ce fichier dans… », « crée un dossier Garage dans Véhicule », « organise tel ' +
    'dossier » = retrouve par recherche les fichiers qui y ont leur place et propose de les y déplacer). ' +
    'Pour cela, appelle proposer_reorg avec les id EXACTS que tes recherches ont renvoyés (cherche ' +
    'd\'abord les DOSSIERS cibles pour avoir leurs id). Garde ton analyse en texte COURTE : dès que tu ' +
    'proposes une réorganisation, tu DOIS appeler l\'outil proposer_reorg — ne décris JAMAIS les ' +
    'déplacements uniquement en texte (sans appel d\'outil, rien n\'arrive dans la file de validation ' +
    'de Marc). Une réponse qui annonce « je te propose… » sans appel proposer_reorg est une ERREUR. ' +
    'LISIBILITÉ (loi de Miller, ADR-0027) : un dossier ne devrait pas contenir plus de ' +
    CONFIG.REORG_MAX_SOUS_DOSSIERS_IDEAL + ' à ' + CONFIG.REORG_MAX_SOUS_DOSSIERS_TOLERANCE +
    ' sous-dossiers. Tu n\'as AUCUN outil qui liste le contenu d\'un dossier : n\'affirme donc JAMAIS ' +
    'qu\'un dossier est trop plein — ne le propose que si MARC te le dit ou si tes recherches te l\'ont ' +
    'MONTRÉ. Dans ce cas, propose de créer un dossier de REGROUPEMENT thématique (ex. « Anciens ' +
    'véhicules », « Anciens employeurs ») et d\'y déplacer les entités les moins utilisées. Comme un ' +
    'dossier dont tu viens de proposer la création n\'a pas encore d\'id, propose D\'ABORD sa création ' +
    'seule : les déplacements dedans se proposeront APRÈS validation de Marc, quand une recherche te ' +
    'rendra son id. Les sous-dossiers d\'année (« 2025 »), de schéma (Factures, Assurance, …) et de ' +
    'type de pièce d\'identité (Passeport, …) ne se regroupent JAMAIS. Pour regrouper, utilise '
    'TOUJOURS un DÉPLACEMENT : une FUSION détruit le dossier source et ferait disparaître l\'entité '
    '(elle ne sert qu\'à réunir deux dossiers de la MÊME entité).\n' +
    'IMPORTANT : tu ne fais que PROPOSER — c\'est MARC qui valide chaque opération dans l\'app, et le ' +
    'moteur les applique ensuite (avec ses garde-fous : jamais toucher les documents d\'immigration, ' +
    'jamais rien supprimer). Ne prétends JAMAIS avoir déjà déplacé/créé quelque chose : dis que tu l\'as ' +
    'proposé et qu\'il doit valider. Date du jour : ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.';
}

/**
 * Action `chat-assistant` : une réponse de l'assistant à partir de l'historique éphémère. Anti-rafale
 * + plafond QUOTIDIEN en $ (échec fermé au-delà) + panne de compte gérée (jamais imputée au plafond).
 * Rien n'est persisté du contenu (ADR-0007) : l'historique vit côté navigateur, le contenu lu ne fait
 * que transiter vers Claude.
 * @return {{ok:boolean, reponse?:string, erreur?:string, coutJour?:number, plafond?:number}}
 *   coutJour/plafond accompagnent la réponse (et le refus de budget) → compteur visible côté app.
 */
function actionChatAssistant_(e) {
  var props = PropertiesService.getScriptProperties();
  var jour = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var derniere = Number(props.getProperty('DriveAI_CHAT_DERNIER')) || 0;
  if (Date.now() - derniere < CONFIG.CHAT_MIN_INTERVALLE_MS) {
    return { ok: false, erreur: 'trop de messages — réessaie dans quelques secondes' };
  }
  var coutJour = coutChatJour_(props, jour);
  if (coutJour >= CONFIG.CHAT_COUT_JOUR_MAX) {
    return { ok: false, erreur: 'Budget chat quotidien épuisé — reviens demain.', coutJour: coutJour, plafond: CONFIG.CHAT_COUT_JOUR_MAX };
  }

  var messages = null;
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    messages = validerHistoriqueChat_(corps.historique);
  } catch (err) { messages = null; }
  if (messages === null) return { ok: false, erreur: 'historique de chat invalide' };
  props.setProperty('DriveAI_CHAT_DERNIER', String(Date.now()));

  // Contexte web app ≠ tick : panne persistée chargée, compteur d'usage PROPRE (le tick n'a pas tourné).
  chargerPannePlateforme_();
  if (estPannePlateforme_()) {
    return { ok: false, erreur: 'Assistant momentanément indisponible (compte API en panne) — réessaie plus tard' };
  }

  reinitialiserUsage_();
  // On TRACKE si le chat a APPELÉ `proposer_reorg` (des lignes ONT PU être écrites dans l'onglet
  // Réorg — sauf si toutes les actions étaient invalides) → renvoyé à l'app pour qu'elle invalide son
  // cache et re-rende la file de validation. Un refresh « pour rien » (actions invalides) est
  // idempotent et inoffensif ; ne PAS refléter l'appel serait le vrai bug (« propositions pas à jour »).
  var actionsProposees = false;
  var executer = function (nom, input) {
    if (nom === 'proposer_reorg') actionsProposees = true;
    return executerOutilChatAssistant_(nom, input);
  };
  var reponse = null;
  try {
    reponse = appelAnthropicChat_(promptChatAssistant_(), messages, outilsChatAssistant_(), executer);
  } finally {
    // Coût de CE run ajouté au total du jour (même usage que le flush mensuel — mesuré une fois).
    try { props.setProperty('DriveAI_CHAT_COUT_JOUR', jour + '|' + (coutJour + coutDollars_(usageRunSnapshot_()))); }
    catch (e2) { /* mesure du jour perdue — accepté (le mensuel reste tenu par flushUsage_) */ }
    try { flushUsage_(); } catch (e3) { /* comptabilité mensuelle perdue pour ce run — accepté */ }
  }

  if (!reponse) return { ok: false, erreur: 'Assistant indisponible (aucune réponse) — réessaie' };
  var coutMaj = coutChatJour_(props, jour);
  journalInfo_('WebApp', 'Chat assistant servi (coût du jour ≈ ' + coutMaj.toFixed(3) + ' $).');
  // coutJour/plafond : compteur de budget VISIBLE côté app (demande Marc — métadonnées seulement).
  return { ok: true, reponse: reponse, actionsProposees: actionsProposees, coutJour: coutMaj, plafond: CONFIG.CHAT_COUT_JOUR_MAX };
}

/* (Actions « analyse-ciblee », « demande-tri », « demande-intentions » : RETIRÉES par
   l'ADR-0031 — leurs boutons n'existent plus depuis la refonte C28-41 PR1. Les scans
   AUTOMATIQUES du tick sont inchangés.) */

/**
 * « PAS SUSPECT » 1-clic (C28-19, ADR-0020) : apprend l'expéditeur DE CONFIANCE (onglet
 * `Confiance`, dédupliqué) et dépose la demande de re-tri (Property `DriveAI_PAS_SUSPECT`,
 * liste additive) consommée par le tick SOUS SON VERROU — JAMAIS de suppression de lignes
 * d'Index ici : doPost court en concurrence du run (déviation documentée vs plan C28-19).
 * Le libellé ⚠ Gmail du fil n'est jamais retiré (§2.3) : le moteur l'ignore désormais.
 * PAS d'anti-rafale (C28-24, décision Marc) : Marc retire souvent PLUSIEURS suspects d'affilée —
 * l'action est bon marché (1 lecture de fil + 2 écritures idempotentes/dédupliquées), la
 * validation stricte du threadId et la liste additive bornent déjà tout abus.
 */
function actionPasSuspect_(e) {
  var props = PropertiesService.getScriptProperties();

  var threadId = '';
  try {
    var corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    threadId = validerThreadId_(corps.threadId);
  } catch (err) {
    threadId = '';
  }
  if (!threadId) return { ok: false, erreur: 'threadId invalide' };

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

  // Demande de re-tri : une Property PAR fil — écriture ATOMIQUE (revue flotte C28-24). Sans
  // anti-rafale, deux doPost concurrents s'écrasaient sur la LISTE partagée (lecture → push →
  // écriture : dernier écrivain gagnant, clic perdu en SILENCE — l'app masque la ligne de façon
  // optimiste). Le LockService est indisponible ici : le tick le tient jusqu'à ~6 min. Le
  // threadId ne peut pas contenir `|` (validerThreadId_) — l'espace de clés est sûr.
  props.setProperty('DriveAI_PAS_SUSPECT|' + threadId, '1');

  journalInfo_('WebApp', 'Pas-suspect : « ' + adresse + ' » ajouté à Confiance (fil re-trié au prochain passage).');
  actionTickPonctuel_(); // passage immédiat — le fil est re-jugé « sain » dans la ~minute
  return { ok: true, message: 'Expéditeur de confiance : ' + adresse + ' — le fil est re-trié dans la minute.' };
}

/* ---------- Résumé pour le hub perso (C28-27, CLAUDE.md §6 bis) ---------- */

/**
 * Métadonnées du moteur pour le widget hubperso.com — servies au BROKER Vercel
 * (`api/hub/_engineState.ts`), JAMAIS directement au hub (le jeton `x-hub-token` est vérifié
 * côté Vercel ; ici c'est `DriveAI_WEBAPP_SECRET` qui garde la porte, comme les autres actions).
 * ADR-0007 : 4 compteurs + 1 horodatage — aucun nom de fichier, aucun contenu.
 *
 * LECTURE SEULE d'une Property PRÉ-CALCULÉE au tick (`DriveAI_HUB_SUMMARY`, cf. majResumeHub_) :
 * le calcul (getValues Index+Journal + liste Drive de la file) dépassait le délai du broker Vercel
 * quand il était fait à chaque appel → 500 en boucle (C28-27, mise en service). Ici, réponse en ms.
 * Property absente (aucun tick depuis le déploiement) → `lastRunAt:null` : le broker rend « building »
 * honnête (no-fake-data). Échec fermé : toute exception remonte au try/catch du doPost.
 */
function actionHubSummary_() {
  var brut = PropertiesService.getScriptProperties().getProperty('DriveAI_HUB_SUMMARY');
  var etat = brut ? JSON.parse(brut) : null;
  if (!etat || typeof etat !== 'object') {
    return { ok: true, etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: null } };
  }
  return { ok: true, etat: etat };
}

/**
 * Pré-calcule les 4 métriques du widget hub et les persiste (Property `DriveAI_HUB_SUMMARY`, JSON
 * compact ~90 octets ≪ 9 Ko). Appelée UNE fois par tick, dans le finally, ENVELOPPÉE (Main.gs) :
 * un échec ne bloque jamais l'intake. Le calcul (getValues + liste Drive) est ici sans risque de
 * délai — le tick a son propre garde-temps. `lastRunAt` = heartbeat DriveAI_LAST_TICK (écrit juste
 * avant dans le même finally). ADR-0007 : métadonnées seulement.
 */
function majResumeHub_() {
  var props = PropertiesService.getScriptProperties();
  var lastTick = Number(props.getProperty('DriveAI_LAST_TICK')) || 0;
  // THROTTLE (C28-34, 2026-07-31) : ce calcul relit l'Index ENTIER + le Journal entier. Le Journal
  // est borné (20 000), l'Index NE L'EST PAS (append-only, §2) — il est à ~10 800 lignes et le reset
  // en ajoute ~2 par fichier. Le faire à CHAQUE tick (×288/j) est devenu le plus gros poste du socle
  // non budgété, au point de retarder le heartbeat (constaté : 24 min de retard le 2026-07-31).
  // Le widget hub n'a aucun besoin d'une fraîcheur à la minute : on recalcule au plus 1×/15 min.
  // La Property n'est écrite qu'APRÈS un calcul réussi (une panne rejoue au tick suivant).
  var dernierCalcul = Number(props.getProperty('DriveAI_HUB_MAJ_MS')) || 0;
  if (dernierCalcul && (Date.now() - dernierCalcul) < CONFIG.HUB_RESUME_INTERVALLE_MS) return;
  var compte = compterMetriquesHub_(
    feuille_('Index').getDataRange().getValues(),
    feuille_('Journal').getDataRange().getValues(),
    Date.now()
  );
  // Coûts & quotas (bloc `usage` du hub) : coût LLM MENSUEL mesuré + activité Gmail du jour
  // + état du quota Gmail. Métadonnées agrégées seulement (ADR-0007). Enveloppé : une panne
  // de mesure ne doit pas priver le hub des 4 compteurs.
  var llmCostMonthUsd = null, gmailThreadsToday = null, gmailQuotaSuspended = false;
  try {
    llmCostMonthUsd = syntheseCoutMois_().dollars;
    var aujourdhui = dateGmail_(new Date());
    gmailThreadsToday =
      compteurFilsJour_(props, 'DriveAI_GMAIL_HISTO', aujourdhui) +
      compteurFilsJour_(props, 'DriveAI_TRI_CYCLIQUE', aujourdhui) +
      compteurFilsJour_(props, 'DriveAI_TRI_BOITE', aujourdhui);
    var quotaDepuis = Number(props.getProperty('DriveAI_GMAIL_QUOTA')) || 0;
    gmailQuotaSuspended = !!quotaDepuis && Date.now() - quotaDepuis < CONFIG.GMAIL_QUOTA_RESONDE_MS;
  } catch (e) {
    journalErreur_('Hub', 'Mesure usage indisponible : ' + e);
  }
  var etat = {
    reviewQueueCount: compterDossierRevue_(),
    filedLast7d: compte.classes7j,
    errorsLast7d: compte.erreurs7j,
    lastRunAt: lastTick ? new Date(lastTick).toISOString() : null,
    // Champs additifs (bloc usage) : le broker Vercel les mappe si présents, les ignore sinon.
    llmCostMonthUsd: llmCostMonthUsd,
    gmailThreadsToday: gmailThreadsToday,
    gmailQuotaSuspended: gmailQuotaSuspended
  };
  props.setProperty('DriveAI_HUB_SUMMARY', JSON.stringify(etat));
  props.setProperty('DriveAI_HUB_MAJ_MS', String(Date.now())); // APRÈS succès (cf. throttle en tête)
}

/**
 * Taille RÉELLE de la file de revue = fichiers du dossier `00 · À vérifier` (source de vérité :
 * l'Index garde ses lignes `à vérifier` même après que Marc a vidé la file — compter l'Index
 * ne redescendrait jamais). Boucle bornée (plafond) : la file est ~vide en régime normal
 * (ADR-0016, revue = exception rare) — le plafond ne borne que le cas pathologique.
 */
function compterDossierRevue_() {
  var fichiers = DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER).getFiles();
  var n = 0;
  while (fichiers.hasNext() && n < 500) {
    fichiers.next();
    n++;
  }
  return n;
}

/**
 * Compte, sur les lignes BRUTES de l'Index et du Journal (`getDataRange().getValues()`,
 * en-têtes incluses), les documents CLASSÉS et les ERREURS des 7 derniers jours. PURE (testée).
 * Schémas réels : Index = [clé, Date, nom, domaine, chemin, STATUT(5), empreinte, confiance] ;
 * Journal = [Date(0), NIVEAU(1), source, message]. Les cellules datetime arrivent en objets
 * Date (tsCellule_ absorbe Date ou chaîne). Un document re-classé par une campagne (`migre|…`)
 * ou redéposé (`drive|…`) compte UNE fois : clés normalisées par cleDocumentIndex_.
 * @param {Array[]} lignesIndex
 * @param {Array[]} lignesJournal
 * @param {number} maintenantMs
 * @return {{classes7j:number, erreurs7j:number}}
 */
function compterMetriquesHub_(lignesIndex, lignesJournal, maintenantMs) {
  var seuil = maintenantMs - 7 * 24 * 60 * 60 * 1000;

  var parDocument = {};
  for (var i = 1; i < lignesIndex.length; i++) {
    var ligne = lignesIndex[i];
    if (String(ligne[5]) !== 'classé') continue;
    var ts = tsCellule_(ligne[1]);
    if (isNaN(ts) || ts < seuil) continue;
    parDocument[cleDocumentIndex_(String(ligne[0]))] = true;
  }
  var classes7j = Object.keys(parDocument).length;

  var erreurs7j = 0;
  for (var j = 1; j < lignesJournal.length; j++) {
    if (String(lignesJournal[j][1]) !== 'ERREUR') continue;
    var tsJ = tsCellule_(lignesJournal[j][0]);
    if (!isNaN(tsJ) && tsJ >= seuil) erreurs7j++;
  }

  return { classes7j: classes7j, erreurs7j: erreurs7j };
}

/**
 * Normalise une clé d'Index vers l'identité du DOCUMENT qu'elle vise, pour dédoublonner les
 * comptes (le même fichier re-classé par une campagne ne compte pas deux fois). PURE (testée).
 * `drive|<fileId>` / `shared|<fileId>` → `doc|<fileId>` ; `migre|<tag>|<fileId>` → `doc|<fileId>` ;
 * toute autre clé (PJ Gmail `messageId|i|nom|taille`…) reste elle-même (déjà unique par document).
 * @param {string} cle
 * @return {string}
 */
function cleDocumentIndex_(cle) {
  var seg = cle.split('|');
  if ((seg[0] === 'drive' || seg[0] === 'shared') && seg[1]) return 'doc|' + seg[1];
  if (seg[0] === 'migre' && seg[2]) return 'doc|' + seg[2];
  return cle;
}

/**
 * Horodatage ms d'une cellule Sheet : objet Date (`getValues()` sur une colonne datetime) ou
 * chaîne ISO — NaN si illisible. PURE (testée).
 * @param {*} v
 * @return {number}
 */
function tsCellule_(v) {
  if (v instanceof Date) return v.getTime();
  return Date.parse(String(v));
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
