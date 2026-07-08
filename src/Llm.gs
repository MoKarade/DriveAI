/**
 * Llm.gs — Appel à l'API Anthropic (Claude) pour classer un document.
 *
 * Endpoint : POST https://api.anthropic.com/v1/messages
 * En-têtes : x-api-key, anthropic-version: 2023-06-01, content-type: application/json
 *
 * Sortie attendue : JSON strict (schéma PLAN.md §4). On force le JSON par le
 * prompt et on parse défensivement (pas de dépendance dure à une option d'API).
 * Haiku par défaut ; Sonnet en fallback ponctuel si Haiku échoue.
 */

var PROMPT_SYSTEME =
  'Tu classes des documents personnels (mails, factures, contrats, relevés, courriers officiels...).\n' +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, selon ce schéma :\n' +
  '{\n' +
  '  "domaine": <un des domaines autorisés, exactement>,\n' +
  '  "categorie": <une des catégories connues ci-dessous, ou null>,\n' +
  '  "entite": <NOM PROPRE identifiable concerné — entreprise, institution, établissement, personne,\n' +
  '    adresse précise, modèle+immatriculation... ex "Desjardins", "IUT du Littoral", "3325 4e Avenue,\n' +
  '    Québec". JAMAIS un terme générique ("banque", "cours", "véhicule", "logement", "diplôme",\n' +
  '    "établissement scolaire"...) : si tu n\'as pas de nom propre, mets null>,\n' +
  '  "entites": <liste d\'entités SI le document en concerne plusieurs, sinon omets ce champ>,\n' +
  '  "type_doc": <type court: "Facture", "Relevé", "Contrat", "Attestation"...>,\n' +
  '  "date_doc": <date du document "AAAA-MM-JJ" ou null si absente>,\n' +
  '  "emetteur": <émetteur, ex "Hydro-Quebec", "Desjardins", "IRCC" ou null>,\n' +
  '  "sensible": <booléen, voir règle ci-dessous>,\n' +
  '  "confiance": <nombre entre 0 et 1, honnête>\n' +
  '}\n' +
  'RÈGLE DE SÉCURITÉ (zone protégée) : "sensible"=true UNIQUEMENT si le document touche\n' +
  'l\'immigration ou le statut (CSQ, IRCC, visa, passeport, permis de travail/séjour, résidence)\n' +
  'OU la fiscalité (déclaration d\'impôts, avis de cotisation). En cas de doute SUR CES\n' +
  'catégories, mets true. Pour TOUT le reste (paie, banque, factures, diplômes, logement,\n' +
  'véhicule, correspondance...), mets false : ces documents se classent automatiquement.\n' +
  'Domaines autorisés : ' + domainesAutorises_().join(' | ') + '\n' +
  'Catégories connues : ' + categoriesConnues_().join(' | ') + ' (sinon null)';

// Prompt d'ESCALADE : pour les documents que Haiku a mal cernés. On pousse le modèle
// à raisonner et à TOUJOURS proposer son meilleur domaine/catégorie (jamais « inconnu »),
// tout en gardant la même règle de sécurité (sensible).
var PROMPT_ESCALADE = PROMPT_SYSTEME + '\n\n' +
  'CONTEXTE : ce document a été jugé difficile à classer. Analyse-le EN PROFONDEUR (émetteur, ' +
  'type, contenu, indices du nom de fichier) et donne ta MEILLEURE estimation de domaine et de ' +
  'catégorie, même si tu n\'es pas totalement certain — ne laisse jamais le domaine vide ou hors ' +
  'liste. La règle de sécurité (sensible = immigration/statut ou fiscalité) reste prioritaire.';

/* ============================================================================
 * REFONTE #26 (C26-05) — ANALYSE EN 2 PASSES (extraction + vérification adversariale).
 * Prompts et schéma issus de la PREUVE validée sur 38 documents réels (workflow preuve-refonte-v2,
 * exigences relevées de Marc 2026-07-07 : zéro « Inconnu » via un descripteur précis + tout en
 * sous-dossier). ÉTEINT tant que `CONFIG.ANALYSE_V2` est false (Sonnet ×2/doc, §2.6).
 * ==========================================================================*/

// Règles de NOMMAGE + RANGEMENT partagées par les deux passes (le nom ne contient JAMAIS « Inconnu »,
// et tout document va dans un SOUS-DOSSIER, jamais à la racine d'un domaine).
var REGLES_V2 =
  'RÈGLES DE NOMMAGE ET DE RANGEMENT (exigences de Marc) :\n' +
  'A) NOM — JAMAIS « Inconnu ». Le 3ᵉ segment X de « AAAA-MM-JJ_Type_X.ext » est TOUJOURS renseigné et PRÉCIS, par priorité :\n' +
  '   1. TITULAIRE si pièce d\'identité (Passeport/Permis…) — « …_Passeport_Marc Richard ».\n' +
  '   2. sinon ÉMETTEUR (organisation qui a produit/envoyé) — « …_Facture_Hydro-Québec ».\n' +
  '   3. sinon DESCRIPTEUR (champ `descripteur`) : 2 à 6 mots PRÉCIS = ce que c\'est + le sujet + qui l\'a produit si repérable.\n' +
  '      Ex. « Notes de maintenance ligne robot Robovic », « CV Marc Richard », « Cours de physique DUT GIM »,\n' +
  '      « Devoir algorithmique Python », « Lettre de motivation poste automaticien ». JAMAIS « Inconnu », jamais un mot vague seul.\n' +
  '   `type_doc` PRÉCIS aussi (« Notes de cours », « Bulletin de paie », « Attestation de vaccination »… jamais « Document »).\n' +
  'B) SOUS-DOSSIER OBLIGATOIRE — rien à la RACINE d\'un domaine. `sousDossier` NON VIDE pour tout document :\n' +
  '   - de préférence l\'ENTITÉ (établissement, entreprise, banque, école, administration) : « IUT du Littoral », « Desjardins », « Air Transat »…\n' +
  '   - sinon une CATÉGORIE claire et STABLE du domaine (Études → « Cours »/« Diplômes »/« Devoirs » ; Finances → « Relevés »/« Reçus »/« Impôts » ; Perso → « Captures »/« Notes »).\n' +
  '   Pour une pièce d\'identité, `sousDossier` = le TYPE (« Passeport », « Permis de conduire »). Pour un non-document, `sousDossier` reste vide (il va dans _Technique/_Médias).';

var PROMPT_PASSE1 =
  'Tu es l\'analyste documentaire de DriveAI (PASSE 1 — EXTRACTION). Document personnel de Marc Richard ' +
  '(propriétaire) : nom, expéditeur, sujet et TEXTE. Analyse EN PROFONDEUR et ne bloque JAMAIS.\n' +
  'Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, selon ce schéma :\n' +
  '{\n' +
  '  "estNonDocument": <bool — export de données / capture sans texte / fichier système, PAS un document à classer>,\n' +
  '  "routageHorsDomaine": <"_Technique" | "_Médias" | null — seulement si estNonDocument>,\n' +
  '  "estDocumentIdentite": <bool — pièce d\'identité (passeport, permis, acte, carte)>,\n' +
  '  "sousDossierType": <type d\'identité si estDocumentIdentite ("Passeport", "Permis de conduire"…), sinon null>,\n' +
  '  "titulaire": <personne concernée par la pièce d\'identité (Marc OU un proche), sinon null>,\n' +
  '  "domaine": <un des domaines autorisés, EXACTEMENT>,\n' +
  '  "sousDossier": <ENTITÉ ou CATÉGORIE — le sous-dossier sans le domaine ; NON VIDE sauf non-document>,\n' +
  '  "categorie": <catégorie connue ou null>,\n' +
  '  "type_doc": <type court et PRÉCIS>,\n' +
  '  "date_doc": <"AAAA-MM-JJ" ou null>,\n' +
  '  "emetteur": <ORGANISATION émettrice (cherche en-tête/logo/pied/adresse) ou null>,\n' +
  '  "entite": <NOM PROPRE canonique concerné ou null (jamais générique, jamais Marc ; retire Inc./SAS ; véhicule = "Marque Modèle")>,\n' +
  '  "descripteur": <2 à 6 mots précis pour le NOM si NI émetteur NI titulaire, sinon "">,\n' +
  '  "sensible": <bool — voir règle>,\n' +
  '  "confiance": <nombre 0..1, honnête>\n' +
  '}\n' +
  'NON-DOCUMENT d\'abord : export .html/.json ou dump de compte (Facebook…) → _Technique ; photo/capture SANS texte → _Médias. ' +
  'GARDE : un VRAI scan (passeport, facture) reste CLASSÉ ; JAMAIS _Médias sur une pièce d\'identité ou un doc 01/04 ; un non-document (export/dump/capture) n\'est JAMAIS rangé dans un domaine (encore moins 04) — mets estNonDocument=true + routageHorsDomaine, le champ domaine peut rester null.\n' +
  'IDENTITÉ : estDocumentIdentite=true → renseigne sousDossierType ET titulaire (Marc OU un proche : MÊME dossier de type, jamais « Tiers »).\n' +
  'ÉMETTEUR = l\'organisation émettrice. Marc n\'est JAMAIS émetteur/entité d\'un document d\'organisation. ENTITÉ = nom propre canonique.\n' +
  'SENSIBLE = immigration/statut (CSQ, IRCC, visa, passeport, permis de séjour, résidence) OU fiscalité (impôts, avis de cotisation) UNIQUEMENT ; sinon false.\n' +
  'Domaines autorisés : ' + domainesAutorises_().join(' | ') + '\n' +
  REGLES_V2;

var PROMPT_PASSE2 =
  'Tu es le VÉRIFICATEUR ADVERSARIAL de DriveAI (PASSE 2). On te donne le document ET la proposition ' +
  'de la PASSE 1. CONTESTE-la, puis renvoie le JSON FINAL (MÊME schéma que la passe 1, UNIQUEMENT du JSON).\n' +
  'ANTI-RÉGRESSION : ne remplace un champ que sur une raison CONCRÈTE tirée du document — sinon garde la passe 1.\n' +
  'Vérifie en particulier : non-document (export/média vs vrai scan) ; domaine exact ; émetteur RE-CHERCHÉ activement si null ; ' +
  'identité + titulaire ; entité non générique et canonique ; sensible (immigration/impôts seulement) ; date et type précis. Et les DEUX exigences :\n' +
  '- `descripteur` : si NI émetteur NI titulaire, il DOIT être présent, précis et parlant (ce que c\'est + sujet + auteur si repérable) — JAMAIS « Inconnu » ni un mot vague. Améliore-le si la passe 1 est restée vague.\n' +
  '- `sousDossier` : DOIT être non vide pour tout document (entité de préférence, sinon catégorie claire du domaine). Rien à la racine du domaine. Corrige si vide ou incohérent.\n' +
  'Domaines autorisés : ' + domainesAutorises_().join(' | ') + '\n' +
  REGLES_V2;

/**
 * Analyse V2 en 2 passes Sonnet : PASSE 1 extrait le schéma étendu, PASSE 2 le conteste et finalise.
 * Anti-régression : une passe 2 illisible/échec garde la passe 1 (jamais de perte). Un échec de la
 * passe 1 renvoie null → géré par `gererEchec_` (compté, re-tenté), SANS fallback multi-passes (coût).
 * @param {{nomFichier:string, expediteur:string, sujet:string, extrait:string}} meta
 * @return {Object|null}
 */
function classifierDeuxPasses_(meta) {
  var modele = CONFIG.ANALYSE_V2_MODELE;
  var p1 = appelAnthropicV2_(modele, meta, PROMPT_PASSE1, null);
  if (!p1) return null;
  var p2 = appelAnthropicV2_(modele, meta, PROMPT_PASSE2, p1);
  return p2 || p1;
}

/**
 * Un appel de l'analyse V2 (une passe). Réutilise toute la robustesse de l'appel de classification
 * (retry, panne de compte signalée/persistée, coût mesuré) mais avec le schéma v2 (parser partagé).
 * @param {string} modele
 * @param {Object} meta
 * @param {string} systeme  PROMPT_PASSE1 ou PROMPT_PASSE2
 * @param {Object|null} propositionPasse1  la sortie de la passe 1 (jointe pour la passe 2), sinon null
 * @return {Object|null}
 */
function appelAnthropicV2_(modele, meta, systeme, propositionPasse1) {
  if (estPannePlateforme_()) return null; // panne de compte → échec rapide, sans réseau

  var contenu =
    'Nom du fichier : ' + meta.nomFichier + '\n' +
    'Expéditeur : ' + (meta.expediteur || '') + '\n' +
    'Sujet : ' + (meta.sujet || '') + '\n' +
    'Extrait du contenu (peut être vide) :\n' + (meta.extrait || '(aucun)');
  if (propositionPasse1) {
    contenu += '\n\nPROPOSITION DE LA PASSE 1 (à contester puis finaliser) :\n' +
      JSON.stringify(propositionPasse1);
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: CONFIG.ANALYSE_V2_MAX_TOKENS,
      system: systeme,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    if (!signalerPannePlateforme_(code, reponse.getContentText(), modele)) {
      journalErreur_('LLM', 'HTTP ' + code + ' (' + modele + ', v2) : ' +
        tronquer_(reponse.getContentText(), 500));
    }
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse non-JSON (' + modele + ', v2) : ' + e);
    return null;
  }
  if (data.stop_reason === 'refusal') {
    journalErreur_('LLM', 'Refus du modèle (' + modele + ', v2)');
    return null;
  }
  if (data.stop_reason === 'max_tokens') {
    journalErreur_('LLM', 'Réponse v2 tronquée à max_tokens (' + modele + ') — augmenter ANALYSE_V2_MAX_TOKENS ?');
  }

  signalerRetablissement_();
  enregistrerUsage_(modele, data.usage);
  return parserClassification_(texteReponse_(data));
}

/**
 * Classe un document. Haiku d'abord ; si échec ou confiance basse (et NON sensible),
 * escalade vers une analyse approfondie (Sonnet, plusieurs passes) et garde la meilleure.
 * @param {{nomFichier:string, expediteur:string, sujet:string, extrait:string}} meta
 * @return {Object|null} la classification, ou null si échec total.
 */
function classifier_(meta) {
  // Refonte #26 (flag) : analyse en 2 passes Sonnet (extraction + vérification adversariale), schéma
  // étendu. ÉTEINT par défaut (Sonnet coûteux sur le flux vivant, §2.6) — allumé au feu vert de Marc.
  if (CONFIG.ANALYSE_V2) return classifierDeuxPasses_(meta);

  var classif = appelAnthropic_(CONFIG.LLM_MODELE, meta);

  // Échec TOTAL de Haiku → fallback Sonnet SIMPLE (1 appel), comme en Phase 1. On n'escalade
  // PAS en multi-passes sur un échec : sinon un doc qui fait systématiquement planter le parsing
  // (jamais inscrit à l'Index) rejouerait Haiku + N×Sonnet à chaque tick → emballement de coût.
  if (!classif) {
    journalInfo_('LLM', 'Haiku a échoué, fallback Sonnet pour « ' + meta.nomFichier + ' »');
    return appelAnthropic_(CONFIG.LLM_MODELE_FALLBACK, meta);
  }

  // Confiance basse + doc NON sensible → analyse approfondie (multi-passes), bornée par run
  // Un doc SENSIBLE n'est jamais escaladé (choix délibéré, à re-trancher si besoin) : il est
  // auto-classé par Haiku (politique 2026-07-01) et l'escalade multiplierait par 3 les envois
  // de son contenu au LLM pour un gain marginal — prudence + coût.
  if (classif.confiance < CONFIG.SEUIL_CONFIANCE && classif.sensible !== true && escaladeAutorisee_()) {
    journalInfo_('LLM', 'Analyse approfondie (Sonnet ×' + CONFIG.LLM_ESCALADE_PASSES +
      ') pour « ' + meta.nomFichier + ' »');
    var approfondi = analyseApprofondie_(meta);
    if (approfondi && approfondi.confiance >= classif.confiance) classif = approfondi;
  }
  return classif;
}

// Compteur d'escalades par run (plafond anti-emballement de coût). Remis à zéro au tick.
var _escaladesCeRun = 0;
function reinitialiserEscalades_() { _escaladesCeRun = 0; }
function escaladeAutorisee_() { return _escaladesCeRun < CONFIG.LLM_ESCALADE_MAX_PAR_RUN; }

/* ---------- Panne de PLATEFORME (compte API) — check-up 2026-07-03 ---------- */
// Un crédit épuisé / une clé invalide n'est PAS un échec du document : sans ce garde, une panne
// de compte brûle les 3 essais de CHAQUE document de la file et met TOUT en quarantaine à tort
// (vécu : crédit épuisé le 2026-07-01 20:56 → 1330 échecs HTTP 400, ~89 docs quarantainés en
// 2 jours, sans alerte). Une fois la panne détectée, les appels LLM restants du run échouent
// VITE (sans réseau) et AUCUN échec n'est compté aux documents (cf. Pipeline.gererEchec_) ;
// le tick suivant re-sonde naturellement (1ᵉʳ appel réel du run).
var _pannePlateformeCeRun = false;
var _retablissementVerifie = false;
// Série d'échecs SYSTÉMIQUES consécutifs (429/529/5xx, tous documents confondus) — persistée
// entre les ticks (`DriveAI_LLM_ECHECS_SYST`) pour détecter une panne DURABLE qui s'étale sur
// plusieurs runs. Cassée par le premier succès (signalerRetablissement_).
var _echecsSystemiques = 0;
function reinitialiserPannePlateforme_() { _pannePlateformeCeRun = false; _retablissementVerifie = false; _echecsSystemiques = 0; }
function estPannePlateforme_() { return _pannePlateformeCeRun; }

/**
 * À appeler en tête de run (R2) : charge l'état de panne PERSISTÉ (`DriveAI_LLM_PANNE`).
 * Panne fraîche (< LLM_PANNE_RESONDE_MS) → le run entier est suspendu côté sources (le tick saute
 * Gmail/dépôts/campagnes : rien à y faire, et re-scanner brûlerait le quota Gmail — vécu 07-06).
 * Fenêtre écoulée → run « re-sonde » : on tourne NORMALEMENT, le 1ᵉʳ appel LLM réel tranche
 * (200 → `signalerRetablissement_` efface la Property ; échec compte → elle est re-posée à neuf).
 */
function chargerPannePlateforme_() {
  _pannePlateformeCeRun = false;
  _retablissementVerifie = false;
  _echecsSystemiques = 0;
  var t = 0;
  try {
    var props = PropertiesService.getScriptProperties();
    t = Number(props.getProperty('DriveAI_LLM_PANNE')) || 0;
    // Série systémique en cours (panne durable naissante) : reprise d'où elle en était — une
    // panne qui s'étale sur plusieurs ticks (2 échecs au run N, 1 au run N+1) doit déclencher.
    _echecsSystemiques = Number(props.getProperty('DriveAI_LLM_ECHECS_SYST')) || 0;
  } catch (e) { }
  if (t && Date.now() - t < CONFIG.LLM_PANNE_RESONDE_MS) _pannePlateformeCeRun = true;
}

/** Premier appel LLM réussi du run : efface la panne persistée (si posée) et le journalise. */
function signalerRetablissement_() {
  // Panne DURABLE (C28-12) : tout succès CASSE la série d'échecs systémiques — en mémoire ET
  // persistée (sinon une série entamée hier + un hoquet isolé aujourd'hui déclencherait à tort).
  // Avant le memo `_retablissementVerifie` : la série peut naître EN COURS de run, après le
  // premier succès. Écriture Property seulement si une série existait (rare) — coût nul sinon.
  if (_echecsSystemiques > 0) {
    _echecsSystemiques = 0;
    try { PropertiesService.getScriptProperties().deleteProperty('DriveAI_LLM_ECHECS_SYST'); } catch (e0) { }
  }
  if (_retablissementVerifie) return; // 1 lecture de Property par run au maximum
  _retablissementVerifie = true;
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('DriveAI_LLM_PANNE')) {
      props.deleteProperty('DriveAI_LLM_PANNE');
      // R3 : les documents quarantainés PENDANT la panne sont des faux positifs (3 échecs de
      // compte, pas du document) → ré-arme la dé-quarantaine automatique du prochain tick.
      // Assumé : elle libère TOUS les quarantainés `drive|`, y compris les cassés « pour de
      // bon » (re-tentés 3×, puis re-quarantainés) — volume borné, pannes rares ; avec le garde
      // R1 (gererEchec_ ne compte rien pendant une panne), ce cas devrait rester marginal.
      try { props.deleteProperty('DriveAI_DEQUARANTAINE'); } catch (e2) { /* best-effort */ }
      journalInfo_('LLM', 'Compte API RÉTABLI — reprise normale des sources au prochain tick (quarantaine de panne relancée).');
    }
  } catch (e) { /* best-effort : au pire une re-sonde de plus */ }
}

/**
 * Vrai si la réponse HTTP révèle une panne de COMPTE (crédit/clé), pas un problème du document. PUR.
 * @param {number} code
 * @param {string} corps
 * @return {boolean}
 */
function detecterPannePlateforme_(code, corps) {
  if (code === 401) return true; // clé invalide/révoquée
  return code === 400 && !!corps && corps.indexOf('credit balance') !== -1;
}

/**
 * Vrai si le code HTTP est de nature SYSTÉMIQUE (l'API, pas le document) : 429 (quota/rate limit)
 * ou 5xx (dont 529 « overloaded » Anthropic). Un cas ISOLÉ est normal (hoquet) — seule une SÉRIE
 * consécutive (LLM_ECHECS_SYST_MAX) déclenche la panne durable (C28-12). PUR.
 * @param {number} code
 * @return {boolean}
 */
function estCodeSystemique_(code) {
  return code === 429 || code >= 500;
}

/** Pose la panne plateforme : journal UNE fois par run + Property (suspension des ticks suivants). */
function poserPannePlateforme_(message) {
  if (!_pannePlateformeCeRun) journalErreur_('LLM', message);
  _pannePlateformeCeRun = true;
  // R2 : panne PERSISTÉE — les ticks suivants suspendent leurs sources sans re-scanner Gmail,
  // jusqu'à la prochaine fenêtre de re-sonde (LLM_PANNE_RESONDE_MS).
  try { PropertiesService.getScriptProperties().setProperty('DriveAI_LLM_PANNE', String(Date.now())); } catch (e2) { }
}

/**
 * Marque la panne (journal UNE fois par run) si la réponse la révèle — soit une panne de COMPTE
 * (immédiate : crédit/clé), soit une panne DURABLE (série de LLM_ECHECS_SYST_MAX échecs
 * 429/529/5xx consécutifs, tous documents confondus, persistée entre les ticks — C28-12).
 * @return {boolean} vrai si une panne de plateforme est POSÉE (l'appelant ne journalise pas
 *   l'échec par document ; gererEchec_ ne compte rien) ; faux = échec normal du document.
 */
function signalerPannePlateforme_(code, corps, modele) {
  if (detecterPannePlateforme_(code, corps)) {
    poserPannePlateforme_('PANNE DE COMPTE API (HTTP ' + code + ', ' + modele + ') — sources ' +
      'suspendues (re-sonde auto dans ≤ ' + Math.round(CONFIG.LLM_PANNE_RESONDE_MS / 3600000) + ' h), ' +
      'aucun échec compté aux documents. ' +
      'Recharger le crédit Anthropic (console.anthropic.com → Billing).');
    return true;
  }
  if (estCodeSystemique_(code)) {
    _echecsSystemiques++;
    try { PropertiesService.getScriptProperties().setProperty('DriveAI_LLM_ECHECS_SYST', String(_echecsSystemiques)); } catch (e3) { }
    if (_echecsSystemiques >= CONFIG.LLM_ECHECS_SYST_MAX) {
      poserPannePlateforme_('PANNE API DURABLE (HTTP ' + code + ' ×' + _echecsSystemiques +
        ' consécutifs, ' + modele + ') — API saturée ou quota atteint, sources suspendues ' +
        '(re-sonde auto dans ≤ ' + Math.round(CONFIG.LLM_PANNE_RESONDE_MS / 3600000) + ' h), ' +
        'aucun échec compté aux documents. Rien à faire : reprise automatique au rétablissement.');
      return true;
    }
    return false; // hoquet isolé : échec normal (retry/fallback existants), la série reste armée
  }
  return false;
}

/**
 * Analyse approfondie : plusieurs passes Sonnet avec le prompt d'escalade ; renvoie la
 * meilleure classification (domaine majoritaire, puis confiance la plus haute).
 * @param {Object} meta
 * @return {Object|null}
 */
function analyseApprofondie_(meta) {
  _escaladesCeRun++;
  var resultats = [];
  for (var i = 0; i < CONFIG.LLM_ESCALADE_PASSES; i++) {
    var r = appelAnthropic_(CONFIG.LLM_MODELE_FALLBACK, meta, PROMPT_ESCALADE);
    if (r) resultats.push(r);
  }
  return resultats.length ? meilleureClassification_(resultats) : null;
}

/**
 * Choisit la meilleure classification d'un lot : domaine le plus fréquent (consensus),
 * puis, à égalité, la confiance la plus haute.
 * @param {Object[]} resultats
 * @return {Object}
 */
function meilleureClassification_(resultats) {
  var freq = {};
  resultats.forEach(function (r) { freq[r.domaine] = (freq[r.domaine] || 0) + 1; });
  var meilleur = resultats[0];
  for (var i = 1; i < resultats.length; i++) {
    var r = resultats[i];
    var fR = freq[r.domaine], fM = freq[meilleur.domaine];
    if (fR > fM || (fR === fM && r.confiance > meilleur.confiance)) meilleur = r;
  }
  return meilleur;
}

/**
 * @param {string} modele
 * @param {Object} meta
 * @param {string} [systeme]  prompt système (défaut : PROMPT_SYSTEME)
 * @return {Object|null}
 */
function appelAnthropic_(modele, meta, systeme) {
  if (estPannePlateforme_()) return null; // panne de compte détectée ce run → échec rapide, sans réseau

  // Apprentissage (ADR-0003) : préfixe les corrections passées les plus proches (même émetteur) en
  // exemples few-shot — borné (top-N), vide si aucune. Dégrade proprement si l'onglet est illisible.
  var exemples = '';
  try { exemples = exemplesFewShot_(meta); } catch (e) { exemples = ''; }

  var contenu =
    (exemples ? exemples + '\n\n' : '') +
    'Nom du fichier : ' + meta.nomFichier + '\n' +
    'Expéditeur : ' + meta.expediteur + '\n' +
    'Sujet : ' + meta.sujet + '\n' +
    'Extrait du contenu (peut être vide) :\n' + (meta.extrait || '(aucun)');

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: CONFIG.LLM_MAX_TOKENS,
      system: systeme || PROMPT_SYSTEME,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    // Panne de COMPTE (crédit/clé) : journalisée UNE fois par run, jamais imputée aux documents.
    if (!signalerPannePlateforme_(code, reponse.getContentText(), modele)) {
      journalErreur_('LLM', 'HTTP ' + code + ' (' + modele + ') : ' +
        tronquer_(reponse.getContentText(), 500));
    }
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse non-JSON (' + modele + ') : ' + e);
    return null;
  }

  if (data.stop_reason === 'refusal') {
    journalErreur_('LLM', 'Refus du modèle (' + modele + ')');
    return null;
  }

  signalerRetablissement_(); // efface une éventuelle panne persistée (le compte répond)
  enregistrerUsage_(modele, data.usage); // mesure de coût réel (P1-09)
  return parserClassification_(texteReponse_(data));
}

/**
 * Appel Anthropic GÉNÉRIQUE (C21-03) : un prompt système + un contenu → le TEXTE brut de la
 * réponse. Réutilise toute la robustesse de l'appel de classification (retry, panne de compte
 * signalée/persistée, coût mesuré) sans son bagage métier (few-shot, meta). Sert à la recherche
 * IA du doPost ; d'autres usages ponctuels peuvent s'y brancher (toujours Haiku, toujours borné).
 * @param {string} modele
 * @param {string} systeme
 * @param {string} contenu
 * @param {number} [maxTokens] défaut CONFIG.LLM_MAX_TOKENS
 * @return {string|null}
 */
function appelAnthropicTexte_(modele, systeme, contenu, maxTokens) {
  if (estPannePlateforme_()) return null; // panne de compte → échec rapide, sans réseau

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: maxTokens || CONFIG.LLM_MAX_TOKENS,
      system: systeme,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    if (!signalerPannePlateforme_(code, reponse.getContentText(), modele)) {
      journalErreur_('LLM', 'HTTP ' + code + ' (' + modele + ', texte) : ' +
        tronquer_(reponse.getContentText(), 500));
    }
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse non-JSON (' + modele + ', texte) : ' + e);
    return null;
  }
  if (data.stop_reason === 'refusal') {
    journalErreur_('LLM', 'Refus du modèle (' + modele + ', texte)');
    return null;
  }
  if (data.stop_reason === 'max_tokens') {
    // Réponse TRONQUÉE : le JSON aval sera illisible — dit explicitement (diagnostic en 1 lecture).
    journalErreur_('LLM', 'Réponse tronquée à max_tokens (' + modele + ', texte) — augmenter le plafond de l\'appelant ?');
  }

  signalerRetablissement_();
  enregistrerUsage_(modele, data.usage);
  return texteReponse_(data);
}

/**
 * Appel avec un retry léger borné sur erreurs transitoires (429, 529, 5xx).
 * @return {HTTPResponse|null}
 */
function fetchAvecRetry_(url, options, modele) {
  var reponse;
  try {
    reponse = UrlFetchApp.fetch(url, options);
  } catch (e) {
    journalErreur_('LLM', 'Appel réseau échoué (' + modele + ') : ' + e);
    return null;
  }
  var code = reponse.getResponseCode();
  if (code === 429 || code === 529 || (code >= 500 && code < 600)) {
    Utilities.sleep(1500);
    try {
      reponse = UrlFetchApp.fetch(url, options);
    } catch (e) {
      journalErreur_('LLM', 'Retry réseau échoué (' + modele + ') : ' + e);
      return null;
    }
  }
  return reponse;
}

/**
 * Concatène les blocs de texte de la réponse Anthropic.
 * @param {Object} data
 * @return {string}
 */
function texteReponse_(data) {
  if (!data || !data.content) return '';
  var morceaux = [];
  for (var i = 0; i < data.content.length; i++) {
    if (data.content[i].type === 'text') morceaux.push(data.content[i].text);
  }
  return morceaux.join('');
}

/**
 * Parse robuste : tente le JSON brut, sinon extrait le 1er objet { ... }.
 * Valide les champs essentiels.
 * @param {string} texte
 * @return {Object|null}
 */
function parserClassification_(texte) {
  if (!texte) return null;
  var obj = null;
  try {
    obj = JSON.parse(texte);
  } catch (e) {
    var debut = texte.indexOf('{');
    var fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      try {
        obj = JSON.parse(texte.substring(debut, fin + 1));
      } catch (e2) {
        obj = null;
      }
    }
  }
  // Un NON-DOCUMENT v2 (export/dump/média) n'a pas besoin de domaine : le prompt lui dit « ne range
  // jamais dans un domaine » → le modèle peut légitimement renvoyer domaine:null. On le TOLÈRE (le
  // routage v2 l'écarte vers _Technique/_Médias, où le domaine est ignoré) au lieu de le rejeter →
  // sinon quarantaine À TORT du cas même que la refonte #26 visait (revue code #26). Le chemin Haiku
  // (aucun champ v2) garde l'exigence STRICTE d'un domaine string — comportement OFF inchangé.
  var estNonDocV2 = !!(obj && (obj.estNonDocument === true ||
    obj.routageHorsDomaine === '_Technique' || obj.routageHorsDomaine === '_Médias'));
  if (!obj || typeof obj.confiance !== 'number' ||
      (typeof obj.domaine !== 'string' && !estNonDocV2)) {
    journalErreur_('LLM', 'JSON de classification invalide : ' + tronquer_(texte, 300));
    return null;
  }
  // Garde-fou : en l'absence d'info claire, on traite comme sensible.
  if (typeof obj.sensible !== 'boolean') obj.sensible = true;
  // Multi-entités : `entites` n'est l'autorité que s'il liste ≥2 entités distinctes ;
  // sinon `entite` (mono) fait foi. (Le flag `sensible` reste produit mais ne route plus en
  // revue — décision Marc 2026-07-01 : tout est classé au mieux, cf. Router.deciderRoutage_.)
  if (Array.isArray(obj.entites)) {
    var vues = {}, propres = [];
    for (var k = 0; k < obj.entites.length; k++) {
      var e = obj.entites[k];
      if (typeof e === 'string' && e.trim() && !vues[e]) { vues[e] = true; propres.push(e); }
    }
    if (propres.length >= 2) obj.entites = propres; else delete obj.entites;
  } else if (obj.entites) {
    delete obj.entites;
  }
  return normaliserChampsV2_(obj);
}

/**
 * Normalise les champs du schéma V2 (refonte #26) QUAND ils sont présents. Sur une réponse Haiku
 * classique (aucun champ v2), l'objet est renvoyé INTACT — le chemin OFF reste identique. PUR.
 * Booléens durcis (présent mais non-booléen → false), routageHorsDomaine borné à _Technique/_Médias
 * (sinon null), chaînes trimées (vide → retirée pour que `champ_`/absence se comportent pareil).
 * @param {Object} obj
 * @return {Object}
 */
function normaliserChampsV2_(obj) {
  if (!obj) return obj;
  var clesV2 = ['estNonDocument', 'estDocumentIdentite', 'routageHorsDomaine',
    'sousDossierType', 'titulaire', 'sousDossier', 'descripteur'];
  var aV2 = clesV2.some(function (k) { return k in obj; });
  if (!aV2) return obj; // réponse Haiku classique → intacte (octet pour octet)

  obj.estNonDocument = obj.estNonDocument === true;
  obj.estDocumentIdentite = obj.estDocumentIdentite === true;
  if (obj.routageHorsDomaine !== '_Technique' && obj.routageHorsDomaine !== '_Médias') {
    obj.routageHorsDomaine = null;
  }
  ['sousDossierType', 'titulaire', 'sousDossier', 'descripteur'].forEach(function (k) {
    if (typeof obj[k] === 'string') { obj[k] = obj[k].trim(); if (!obj[k]) delete obj[k]; }
    else if (k in obj) delete obj[k]; // null/non-chaîne → absent (les fonctions aval testent la présence)
  });
  return obj;
}

/* ============================================================================
 * PHASE 3 — Extraction d'intentions (tâches / événements) depuis un mail.
 * ==========================================================================*/

// Prompt d'EXTRACTION D'INTENTIONS : distinct du prompt de classement documentaire ci-dessus.
// La zone protégée s'applique ICI AUSSI (jamais d'intention sur un mail immigration/fiscal) —
// en plus du filtre déterministe indépendant `toucheZoneProtegee_` (Prefiltre.gs, défense en
// profondeur : on ne fait pas reposer le garde-fou sur le seul respect du prompt par le LLM).
var PROMPT_INTENTIONS =
  'Tu repères des ACTIONS À FAIRE et des RENDEZ-VOUS DATÉS dans un email personnel.\n' +
  'Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, selon ce schéma :\n' +
  '{\n' +
  '  "intentions": [\n' +
  '    {\n' +
  '      "type": <"tache" ou "evenement">,\n' +
  '      "titre": <court et actionnable, ex "Payer la facture Hydro-Québec">,\n' +
  '      "date": <"AAAA-MM-JJ" ou null>,\n' +
  '      "heure": <"HH:MM" (24h) ou null, UNIQUEMENT si une heure précise est donnée>,\n' +
  '      "confiance": <nombre entre 0 et 1, honnête>\n' +
  '    }\n' +
  '  ]\n' +
  '}\n' +
  'Routage : date ET heure précises (rendez-vous, réunion, appel planifié) → "evenement". ' +
  'Action/échéance sans heure précise (payer, renvoyer, répondre, renouveler...) → "tache", ' +
  'même avec une date limite.\n' +
  'RÈGLE DE SÉCURITÉ (zone protégée) : ne propose AUCUNE intention si le mail touche ' +
  'l\'immigration ou le statut (CSQ, IRCC, visa, passeport, permis de travail/séjour, résidence) ' +
  'OU la fiscalité (déclaration d\'impôts, avis de cotisation) — renvoie {"intentions": []} pour ' +
  'ces mails (ils restent gérés par le classement documentaire existant, jamais ici).\n' +
  'Si aucune action ni rendez-vous clair n\'est détecté, renvoie {"intentions": []}.';

/**
 * Extrait les intentions (tâches/événements) d'un mail. Haiku d'abord ; fallback Sonnet
 * SIMPLE (1 appel) sur échec total — même politique anti-emballement que `classifier_`
 * (pas d'escalade multi-passes ici, ce n'est pas une zone d'incertitude à arbitrer).
 * @param {{expediteur:string, sujet:string, corps:string}} meta
 * @return {Object[]|null}  liste d'intentions ([] si aucune), ou null si échec total.
 */
function extraireIntentions_(meta) {
  var resultat = appelIntentions_(CONFIG.LLM_MODELE, meta);
  if (!resultat) {
    journalInfo_('LLM', 'Extraction d\'intentions : Haiku a échoué, fallback Sonnet pour « ' + meta.sujet + ' »');
    resultat = appelIntentions_(CONFIG.LLM_MODELE_FALLBACK, meta);
  }
  return resultat ? resultat.intentions : null;
}

/**
 * @param {string} modele
 * @param {{expediteur:string, sujet:string, corps:string}} meta
 * @return {{intentions:Object[]}|null}
 */
function appelIntentions_(modele, meta) {
  if (estPannePlateforme_()) return null; // panne de compte détectée ce run → échec rapide, sans réseau
  var contenu =
    'Expéditeur : ' + meta.expediteur + '\n' +
    'Sujet : ' + meta.sujet + '\n' +
    'Corps (extrait) :\n' + (meta.corps || '(vide)');

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getCleAnthropic_(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: modele,
      max_tokens: CONFIG.LLM_MAX_TOKENS_INTENTIONS,
      system: PROMPT_INTENTIONS,
      messages: [{ role: 'user', content: contenu }]
    }),
    muteHttpExceptions: true
  };

  var reponse = fetchAvecRetry_('https://api.anthropic.com/v1/messages', options, modele);
  if (!reponse) return null;

  var code = reponse.getResponseCode();
  if (code !== 200) {
    if (!signalerPannePlateforme_(code, reponse.getContentText(), modele)) {
      journalErreur_('LLM', 'Intentions HTTP ' + code + ' (' + modele + ') : ' +
        tronquer_(reponse.getContentText(), 500));
    }
    return null;
  }

  var data;
  try {
    data = JSON.parse(reponse.getContentText());
  } catch (e) {
    journalErreur_('LLM', 'Réponse intentions non-JSON (' + modele + ') : ' + e);
    return null;
  }
  if (data.stop_reason === 'refusal') return null;

  signalerRetablissement_(); // efface une éventuelle panne persistée (le compte répond)
  enregistrerUsage_(modele, data.usage); // mesure de coût réel (P1-09)
  return parserIntentions_(texteReponse_(data));
}

/**
 * Parse robuste de la réponse d'extraction d'intentions. Normalise et VALIDE chaque champ
 * (jamais de confiance aveugle dans la sortie LLM) ; un type "evenement" sans date+heure
 * valides est dégradé en "tache" plutôt que rejeté (l'info n'est jamais perdue).
 * @param {string} texte
 * @return {{intentions:Object[]}|null}
 */
function parserIntentions_(texte) {
  if (!texte) return null;
  var obj = null;
  try {
    obj = JSON.parse(texte);
  } catch (e) {
    var debut = texte.indexOf('{');
    var fin = texte.lastIndexOf('}');
    if (debut !== -1 && fin > debut) {
      try {
        obj = JSON.parse(texte.substring(debut, fin + 1));
      } catch (e2) {
        obj = null;
      }
    }
  }
  if (!obj || !Array.isArray(obj.intentions)) {
    journalErreur_('LLM', 'JSON d\'intentions invalide : ' + tronquer_(texte, 300));
    return null;
  }

  var propres = [];
  for (var i = 0; i < obj.intentions.length; i++) {
    var it = obj.intentions[i];
    if (!it || typeof it.titre !== 'string' || !it.titre.trim()) continue;
    var date = (typeof it.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.date)) ? it.date : null;
    var heure = (typeof it.heure === 'string' && /^\d{2}:\d{2}$/.test(it.heure)) ? it.heure : null;
    var type = (it.type === 'evenement' && date && heure) ? 'evenement' : 'tache';
    propres.push({
      type: type,
      titre: it.titre.trim(),
      date: date,
      heure: heure,
      confiance: typeof it.confiance === 'number' ? it.confiance : 0
    });
  }
  return { intentions: propres };
}
