/**
 * Config.gs — Configuration centrale de DriveAI (Phase 1).
 *
 * Aucune donnée secrète ici : la clé API vit dans les Script Properties
 * (`DriveAI_ANTHROPIC_KEY`). Les IDs de dossiers viennent de docs/TAXONOMY.md.
 */

var CONFIG = {
  // Version du comportement de CLASSEMENT. À incrémenter UNIQUEMENT quand une
  // évolution change la façon de ranger (prompt, routage, seuils, schémas) — PAS à
  // chaque commit (sinon coût LLM/quota inutile). Au tick suivant un déploiement, si
  // la version stockée diffère, le moteur renvoie automatiquement les copies LEGACY parties
  // en revue (avant P1-16) vers 00·À trier pour reclassement (cf. Main.appliquerRejeuSiNouvelleVersion_)
  // — borné, réversible, sans toucher aux PJ Gmail ni aux docs déjà classés. Zéro clic.
  VERSION: 'P3.0',

  // --- Seuils & modèle ---
  SEUIL_CONFIANCE: 0.50,                 // sous ce seuil → analyse approfondie (escalade Sonnet), puis
                                         // classé au mieux — plus jamais de file de revue (décision Marc)
  LLM_MODELE: 'claude-haiku-4-5',        // Haiku par défaut (le moins cher)
  LLM_MODELE_FALLBACK: 'claude-sonnet-4-6', // fallback ponctuel si Haiku échoue
  LLM_MAX_TOKENS: 400,
  LLM_OCR_MAX_CARS: 4000,                // troncature de l'extrait envoyé au LLM (coût)
  // Export texte d'un fichier Google natif (R3). Le hash de doublon porte sur le texte ENTIER
  // (tronqué à 4000, deux gros CSV au même en-tête = « doublons » — faux) ; la borne large ne
  // protège que la mémoire. Sous le seuil MIN, jamais de fast-path doublon (MD5 d'un export
  // vide/quasi vide = collision garantie entre documents différents sans texte).
  NATIF_EXPORT_MAX_CARS: 2000000,
  OCR_MIN_CARS_EXPLOITABLE: 20,

  // --- REFONTE #26 : analyse en 2 passes (extraction + vérification adversariale) ---
  // Chantier #26 (demande Marc 2026-07-07 : « fiabilité maximale, Sonnet 2 passes, quitte à coûter
  // plus cher »). ALLUMÉ 2026-07-09 (ADR-0018) : FEU VERT explicite de Marc après la preuve dry-run
  // C26-07 (100 docs réels, 0 fail-safe, confiance médiane 0,93, 0,026 $/doc — onglet DryRunV2).
  // Quand ON : `classifierDeuxPasses_` (Llm.gs) remplace `classifier_`, et `deciderRoutageV2_`
  // (Router.gs) remplace `deciderRoutage_` — schéma étendu (non-document, identité par type, entité
  // unifiée, descripteur jamais « Inconnu », sous-dossier obligatoire). OFF ⇒ pipeline Haiku 1 passe.
  ANALYSE_V2: true,
  ANALYSE_V2_MODELE: 'claude-sonnet-4-6',   // les 2 passes tournent sur Sonnet (fiabilité > coût, quand ON)
  ANALYSE_V2_MAX_TOKENS: 1000,              // schéma étendu (15 champs) → marge large (un JSON tronqué = doc en échec)
  ANALYSE_V2_OCR_MAX_CARS: 12000,           // texte envoyé au LLM moins tronqué qu'en Haiku (4000) — analyse plus fine
  // Escalade : si Haiku rend une confiance < SEUIL (et doc NON sensible), on relance
  // une analyse approfondie avec Sonnet, plusieurs passes, et on garde la meilleure (consensus
  // de domaine puis confiance max). 3 passes (impair → vote utile). Borné pour le budget
  // (< 10 $/mois) : ne concerne que les cas peu sûrs, et plafonné par run ci-dessous.
  LLM_ESCALADE_PASSES: 3,
  LLM_ESCALADE_MAX_PAR_RUN: 8,            // abaissé (25→8) pour ACCÉLÉRER le rangement de masse : l'escalade
                                          // Sonnet ×3 est le plus gros coût-temps/tick ; au-delà on garde le
                                          // résultat Haiku (« classer au mieux », décision Marc). Débit ↑.
  // Prix Anthropic par MILLION de tokens (input/output), pour MESURER le coût réel (Cout.gs, P1-09).
  // À ajuster si la grille de prix change. Haiku 4.5 : 1$/5$ ; Sonnet 4.6 : 3$/15$.
  LLM_PRIX: { haiku_in: 1, haiku_out: 5, sonnet_in: 3, sonnet_out: 15 },
  // FREIN BUDGET des CAMPAGNES (R3, garde-fou §2.6 rendu EFFECTIF — vécu : 15,62 $ le 7 juillet,
  // le grand rangement churnait l'ancien Drive toute la nuit) : au-delà de ce coût MENSUEL mesuré,
  // les campagnes de MASSE (grand rangement, migration, historique Gmail) se mettent en pause
  // jusqu'au mois suivant — le FLUX VIVANT (Gmail 30 j, dépôts, partages, intentions, tri)
  // continue, lui. Relevé 10 → 30 (décision Marc 2026-07-07 : « je veux que tu continues le tri
  // au complet »), puis 30 → 65 (décision Marc 2026-07-09, ADR-0018 : campagne C26-08 ciblée
  // ~924 docs ≈ 24 $ en plus des 27 $ du mois entamé), puis 65 → 110 (décision Marc 2026-07-10,
  // « b » — révision ADR-0018 : m1 re-analyse désormais en V2 depuis l'allumage du flag, coût/doc
  // ×10 non chiffré dans le plan initial ; 54,59 $ au compteur le 10/07 au matin, finir m1 +
  // C26-08 ≈ 40-50 $ de plus, dans le crédit disponible). Les campagnes de RATTRAPAGE sont un
  // coût one-shot ; la cible < 10 $/mois reste celle du régime de croisière — Marc REDESCEND ce
  // plafond à 10 (en éditant cette ligne) à la fin de C26-08. Jamais 0/Infinity : le frein reste
  // le filet anti-emballement (boucle de re-OCR, erreur de convergence).
  LLM_BUDGET_CAMPAGNES: 110,
  // Résumé hebdomadaire automatique (mail récap à soi-même, scope script.send_mail existant).
  RESUME_JOUR: 'MONDAY',                  // jour du déclencheur hebdo (WeekDay Apps Script)
  RESUME_HEURE: 8,                        // heure locale d'envoi
  RESUME_JOURS: 7,                        // fenêtre d'activité résumée (jours)
  // Chantiers #13-#14 (ADR-0010 §2-3) : plafonds d'AFFICHAGE des nouvelles sections du résumé
  // hebdo (anti-bruit, décision Marc : jamais de notification immédiate, le résumé suffit).
  RESUME_ACTIONS_MAX: 15,                 // « Actions & RDV détectés » : lignes listées au maximum
  RESUME_IMPORTANTS_MAX: 10,              // « À traiter » : mails importants listés au maximum
  RESUME_MAX_LIGNES: 15000,               // ne lit que les N dernières lignes Index/Journal (le
                                          // Journal grossit vite : borne la lecture hebdo, large
                                          // marge devant une semaine d'un usage personnel)

  // Journal borné (ADR-0006) : le Journal grossit sans fin → illisible (incident 2026-07-01, débogage
  // gêné par une Sheet énorme + tronquée). Le Journal oscille entre `MAX` et `MAX + MARGE` lignes : la
  // rotation ne se déclenche qu'au-delà de `MAX + MARGE` (purge en lot, pas ligne-à-ligne à chaque tick)
  // et ramène à `MAX`. Le PLANCHER post-rotation (`MAX`) doit rester > `RESUME_MAX_LIGNES` pour que le
  // résumé hebdo lise toujours une fenêtre complète (20000 > 15000 ✔). Purge de LOG (rotation
  // d'historique), jamais de documents ni de l'Index (§2 intact).
  JOURNAL_MAX_LIGNES: 20000,
  JOURNAL_MARGE: 5000,

  // Intervalle du déclencheur temporel (minutes). Valeurs Apps Script admises : 1, 5, 10, 15, 30.
  // Modifiable à chaud : au tick suivant un déploiement, le moteur réinstalle le déclencheur
  // au nouvel intervalle tout seul (cf. Main.assurerIntervalleTick_). Aucun re-installerTrigger manuel.
  TICK_MINUTES: 5,

  // Chien de garde (ADR-0004) : un 2ᵉ déclencheur léger et quasi-infaillible surveille le heartbeat
  // du tick principal (`DriveAI_LAST_TICK`). Si le moteur est silencieux depuis > `WATCHDOG_SEUIL_MS`,
  // il tente de RÉ-INSTALLER le déclencheur principal (auto-réparation) ; s'il ne peut pas (ou si la
  // panne persiste après réparation), il envoie UNE alerte. Le seuil dépasse largement l'intervalle du
  // tick (5 min) pour ne jamais alerter sur un simple retard/quota momentané. Valeurs everyMinutes : 30.
  WATCHDOG_MINUTES: 30,                  // intervalle du déclencheur chien de garde
  WATCHDOG_SEUIL_MS: 45 * 60 * 1000,     // moteur « silencieux » au-delà → auto-réparation puis alerte

  // Quarantaine : après ce nombre d'échecs CUMULÉS sur un même document (LLM ou placement) — le
  // compteur n'est pas remis à zéro, mais un doc qui réussit quitte le scan donc la distinction
  // avec « consécutifs » est sans effet — on cesse de le re-tenter à chaque tick (re-OCR/re-LLM =
  // coût + spam mail). Il est marqué « quarantaine » dans l'Index (donc sauté) + UNE seule alerte
  // mail. Les échecs intermédiaires ne journalisent qu'une ligne (pas de mail), anti-spam. Pour
  // re-tenter un doc quarantiné à tort (panne transitoire), lancer `dequarantaine()` (Maintenance.gs).
  QUARANTAINE_MAX: 3,
  // Dé-quarantaine AUTOMATIQUE one-shot (R3, 2026-07-07) : tant que le tag stocké
  // (`DriveAI_DEQUARANTAINE`) diffère, le tick relance UNE fois tous les quarantainés (les
  // 3 échecs datant d'une panne de compte sont des faux positifs — vécu : 32 fichiers de la
  // panne du 1ᵉʳ juillet sautés en silence pendant 6 jours). Le RÉTABLISSEMENT d'une panne
  // efface aussi la Property → re-déclenche tout seul après chaque panne. Bumper le tag rejoue.
  DEQUARANTAINE_TAG: 'q1',

  // Panne de COMPTE API persistée (R2, check-up 2026-07-06) : pendant une panne (crédit/clé), les
  // SOURCES du tick sont suspendues (Gmail/dépôts/partages/campagnes/intentions) — sinon les scans
  // re-parcourent toute la fenêtre à chaque tick SANS rien marquer et brûlent le quota de lecture
  // Gmail quotidien (vécu : 4 j de panne crédit → quota Gmail épuisé, moteur re-bloqué 24 h de plus
  // APRÈS la recharge). Re-sonde automatique : au plus un run « normal » par fenêtre ci-dessous.
  LLM_PANNE_RESONDE_MS: 60 * 60 * 1000,
  // Panne API DURABLE (C28-12, plan NotebookLM P5) : une panne plateforme d'une AUTRE signature
  // que crédit/clé (529 « overloaded » Anthropic prolongé, 429 persistant, 5xx) doit finir par
  // déclencher la MÊME suspension que la panne de compte — sinon chaque document brûle ses essais
  // sur une API saturée (fausses quarantaines + spam Journal, scénario du 2026-07-02 par une autre
  // porte). Seuil = nombre d'APPELS LLM consécutifs en échec 429/529/5xx (tous documents confondus,
  // persisté entre les ticks) avant de déclarer la panne. Un hoquet isolé (1-2 échecs) reste un
  // échec normal (retry/fallback existants) — « classer les échecs par ORIGINE avant de compter ».
  LLM_ECHECS_SYST_MAX: 3,

  // --- Gmail (lecture seule) & lots ---
  // Idempotence assurée par l'Index (clé messageId|i|nom|taille), PAS par un
  // label : le scope gmail.readonly interdit toute écriture dans la boîte.
  GMAIL_REQUETE: 'has:attachment newer_than:30d',
  // --- Chantier #12 (ADR-0010 §1) : HISTORIQUE Gmail complet, ancre FIXE + offset ---
  // Le scan récent ci-dessus ne voit que 30 j. Ce scan-ci parcourt tout l'historique : une ancre
  // posée UNE fois (`before:<ancre>`, Property) fige l'ensemble de recherche → l'offset persistant
  // est sûr (leçon « pagination mouvante » : le mouvant est interdit, pas l'offset). L'ORDRE peut
  // toutefois bouger (fil ravivé, suppression) : la campagne ne se fige « terminé » qu'après une
  // passe de VÉRIFICATION propre (offset 0 → page vide sans rien collecter) — coût nul ensuite.
  GMAIL_REQUETE_HISTO_BASE: 'has:attachment',
  GMAIL_HISTO_PAGE_FILS: 10,              // fils par page de recherche
  // Plafond de PJ INÉDITES traitées par run : borne le PIC d'un run (mur des 6 min). « Inédite » =
  // clé absente de l'Index — un doublon MD5 compte donc (copyBlob + hash + placement `_Doublons` :
  // pas gratuit ; conservateur). Seules les PJ déjà INDEXÉES sont gratuites (métadonnées seules).
  GMAIL_HISTO_MAX_PJ_INEDITES: 2,
  // Budget QUOTIDIEN de la campagne (2ᵉ contre-vérification) : le plafond par run ne borne PAS la
  // journée — 288 ticks × 20-30 s = 96-144 min/j, soit PLUS que le quota runtime des déclencheurs
  // (~90 min/j, compte gratuit) : tous les déclencheurs (chien de garde inclus) seraient gelés
  // chaque après-midi de campagne. On compte les ms RÉELLEMENT consommées par jour (Properties).
  // Redescendu 60 → 20 min/j (C28-15, décision Marc « équilibre strict » 2026-07-10) : à 60 min/j
  // la campagne épuisait le quota d'APPELS Gmail journalier dès ~08h10 (804 erreurs « too many
  // times » le 06/07) et le TRI vivant était affamé toute la journée (4-17 fils triés/j). Le quota
  // d'appels est PARTAGÉ : la seule protection du tri est de borner la consommation TOTALE de la
  // campagne, pas seulement son runtime. La campagne finit plus lentement — c'est le prix accepté.
  GMAIL_HISTO_BUDGET_JOUR_MS: 20 * 60 * 1000,
  // Frein d'appels API par RUN (C28-15) : au plus N fils PARCOURUS par run (lus depuis Gmail,
  // indexés ou non) — les passes de VÉRIFICATION re-lisent des fils entiers « pour rien » côté
  // quota d'appels (les PJ indexées sont gratuites côté LLM, PAS côté Gmail). NB : une page fait
  // GMAIL_HISTO_PAGE_FILS (10) fils — ce frein ne borne donc que si la page grossit un jour ;
  // c'est le budget quotidien ci-dessus qui porte la protection principale.
  GMAIL_HISTO_MAX_FILS_PAR_RUN: 50,
  // Suspension PERSISTÉE sur quota Gmail épuisé (C28-15, patron panne de compte LLM R2) : quand
  // Google répond « Service invoked too many times for one day: gmail. », TOUS les scans Gmail
  // sont suspendus (Property DriveAI_GMAIL_QUOTA) puis re-sondés après ce délai — sans elle,
  // chaque tick re-brûlait des appels en pure perte (267 lignes d'erreur le matin du 10/07).
  GMAIL_QUOTA_RESONDE_MS: 2 * 60 * 60 * 1000,
  PAGE_FILS: 20,                         // taille de page de la recherche Gmail
  BUDGET_MS: 4.5 * 60 * 1000,            // garde-temps (exécution Apps Script < 6 min)
  // Sous ANALYSE_V2 (Sonnet ×2/doc, 12000 car., retries possibles), un document est BEAUCOUP plus
  // long ; le garde-temps est abaissé pour qu'un doc pire-cas démarré juste sous le budget finisse
  // LOIN du mur dur des 6 min (ADR-0015) — la fenêtre placer→Index reste éloignée du kill (anti 2ᵉ
  // copie au rejeu). Le reste est repris au tick suivant. Inerte tant que ANALYSE_V2 est false.
  ANALYSE_V2_BUDGET_MS: 3 * 60 * 1000,

  // --- Phase 3 : tâches & agenda depuis TOUS les mails récents ---
  // Requête séparée de GMAIL_REQUETE (PJ) : ici TOUS les mails, pas seulement ceux avec PJ
  // (une action/un rdv peut être dans un mail sans pièce jointe). Toujours gmail.readonly.
  GMAIL_REQUETE_ACTIONS: 'newer_than:30d',
  PAGE_FILS_ACTIONS: 20,                  // taille de page de cette recherche

  // --- Chantier #16 (ADR-0012) : tri Gmail natif (libellés + archivage réversible) ---
  // Périmètre du tri : la BOÎTE seulement (revue flotte : sans in:inbox, le stock paierait des
  // mini-appels pour des fils DÉJÀ archivés par Marc/l'ancien Cowork — hors objectif « boîte propre »).
  TRI_REQUETE: 'newer_than:30d in:inbox',
  TRI_MAX_FILS_PAR_RUN: 30,               // écritures Gmail bornées par run (quotas)
  TRI_DEMANDE_PLAFOND_MAX: 1000,          // borne DURE du plafond réglable au clic (C28-16) — la
                                          // demande s'étale sur plusieurs ticks, jamais plus par run
                                          // que TRI_MAX_FILS_PAR_RUN (le quota reste protégé)
  TRI_MAX_ATTENTES: 20,                   // fils « en attente des intentions » chargés par run (borne
                                          // la re-facture de lecture — revue flotte, classe R2)
  LLM_MAX_TOKENS_MINICAT: 64,             // mini-appel catégorie : JSON {categorie, suspect} — marge pour le plus long libellé + clôture markdown
  // Noms EXACTS des libellés spéciaux existants dans le Gmail de Marc (vérifiés le 2026-07-06).
  TRI_LIBELLES: { A_VERIFIER: 'À vérifier', SUSPECT: '⚠️ Suspect', A_TRAITER: '⏰ À traiter' },
  // Heuristiques phishing DÉTERMINISTES, étroites (le signal LLM complète). Deux niveaux
  // (revue flotte, ronde 2) : une PJ EXÉCUTABLE est suspecte SEULE (aucun envoi légitime attendu) ;
  // une PJ DOUTEUSE (.zip d'un photographe, facture .html) ne l'est que COMBINÉE à un signal
  // d'urgence ou de demande d'identifiants — sinon les vrais mails satureraient ⚠️ Suspect.
  TRI_PJ_EXECUTABLES: ['.exe', '.scr'],
  TRI_PJ_DOUTEUSES: ['.zip', '.html', '.htm'],
  // Adresse de MARC : un fil dont le DERNIER message vient de lui n'apprend jamais dans TriAppris
  // (anti auto-empoisonnement : ses propres réponses ne « votent » pas pour une catégorie).
  PROPRIETAIRE_EMAIL: 'marc.richard4@gmail.com',
  TRI_MOTS_URGENCE: ['urgent', 'immédiat', 'dernier rappel', 'compte suspendu', 'sera suspendu'],
  TRI_MOTS_CREDENTIELS: ['mot de passe', 'password', 'identifiant', 'vérifiez votre compte',
    'confirmez votre identité', 'coordonnées bancaires', 'carte de crédit'],
  RESUME_SUSPECTS_MAX: 10,                // « ⚠️ Suspects » listés au résumé hebdo (en tête)
  RESUME_NEWSLETTERS_MAX: 10,             // « newsletters jamais ouvertes » listées au résumé
  TRI_NEWSLETTERS_SEUIL: 3,               // n fils promo non lus (30 j) pour qualifier un expéditeur
  INTENTIONS_MAX_PAR_RUN: 200,            // plafond de messages ANALYSÉS (pré-filtre inclus) par run
  CREATIONS_MAX_PAR_RUN: 30,              // plafond de tâches/événements CRÉÉS par run (pas de rafale)
  CIBLEE_ECHECS_MAX: 3,                   // échecs de recherche CONSÉCUTIFS avant abandon tracé de l'analyse ciblée (C28-06)
  LLM_MAX_TOKENS_MINICHECK: 24,           // mini-check JSON {action, important} (expéditeur+sujet seuls)
  LLM_MAX_TOKENS_INTENTIONS: 500,
  EVENT_DUREE_MIN_DEFAUT: 60,             // durée par défaut d'un événement créé (minutes)
  // Pré-filtre déterministe (avant tout appel LLM) : un expéditeur/sujet qui matche l'un de ces
  // motifs (recherche insensible à la casse) est écarté sans coût — newsletters/notifs/pubs.
  // Liste ÉTROITE et à haute confiance (faux positif = action manquée) ; le mini-check LLM
  // rattrape les cas moins évidents. Cf. LESSONS « garde-fou étroit, calibré sur du réel ».
  PREFILTRE_MOTIFS_REJET: [
    'no-reply', 'noreply', 'donotreply', 'ne-pas-repondre',
    'newsletter', 'unsubscribe', 'desabonner', 'désabonner',
    'notifications@', 'notification@'
  ],
  LLM_CORPS_MAX_CARS: 3000,               // troncature du corps de mail envoyé au LLM (coût)
  // Défense en profondeur (garde-fou §1, indépendante du jugement du LLM) : si l'expéditeur,
  // le sujet OU le corps touche un de ces mots-clés, AUCUNE tâche/événement n'est créé pour ce
  // mail, quoi que renvoie le LLM. Le mail reste géré par le classement documentaire existant.
  // Motifs ≤ 4 caractères (arc, csq, cra...) sont reconnus en MOT ENTIER seulement
  // (cf. Prefiltre.correspondMotif_) — jamais en sous-chaîne libre (« arc » dans « Marc »).
  MOTS_CLES_PROTEGES_INTENTIONS: [
    'ircc', 'csq', 'visa', 'passeport', 'arc', 'cra',
    'résidence permanente', 'residence permanente', 'permis de travail', 'permis de séjour',
    'permis de sejour', "statut d'immigration", 'statut immigration',
    'impôt', 'impot', 'déclaration de revenus', 'declaration de revenus',
    'avis de cotisation', 'revenu québec', 'revenu quebec', 'agence du revenu'
  ],
  OCR_TAILLE_MAX: 20 * 1024 * 1024,      // au-delà : pas d'OCR (mémoire) → métadonnées seules

  // --- Chantier #7 : fichiers PARTAGÉS avec Marc (source d'intake #3, ADR-0005) ---
  // Traitement automatique des partages RÉCENTS (fenêtre glissante, comme Gmail). Un fichier partagé
  // n'appartient pas à Marc → DriveAI en fait une COPIE dans son arbo (l'original reste chez la personne).
  // Aucun nouveau scope OAuth : `drive` couvre déjà la lecture des fichiers partagés.
  PARTAGES_ACTIF: true,                   // interrupteur de la source (coupe la collecte sans retirer le code)
  PARTAGES_FENETRE_JOURS: 30,             // fenêtre de récence (comme Gmail) — borne naturellement le scan
  PARTAGES_MAX_PAR_RUN: 15,               // plafond de fichiers COPIÉS par run (pas de rafale ; storage-aware)
  PARTAGES_PAGE: 100,                     // taille de page REST files.list
  // Garde de TAILLE propre aux partages : contrairement aux PJ Gmail (plafonnées ~25 Mo), un fichier
  // partagé n'a aucune borne. Au-delà de ce seuil on ne COPIE pas (téléchargement complet coûteux, storage) :
  // on saute avec une ligne Journal (visibilité, jamais un silence). Large devant un vrai document.
  PARTAGES_TAILLE_MAX: 50 * 1024 * 1024,  // 50 Mo

  // ALLOWLIST stricte de types « document » (anti-bruit + anti-storage, ADR-0005 §Garde-fous) : PDF + Office.
  // Les images (`image/*`) sont acceptées à part (scans). Tout le reste — vidéo, audio, Google natif
  // collaboratif (Docs/Sheets/Slides), archives — est IGNORÉ (jamais copié).
  PARTAGES_MIME_DOC: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
    'application/msword',                                                         // .doc
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',          // .xlsx
    'application/vnd.ms-excel',                                                   // .xls
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',  // .pptx
    'application/vnd.ms-powerpoint',                                              // .ppt
    'application/vnd.oasis.opendocument.text',                                    // .odt
    'application/vnd.oasis.opendocument.spreadsheet',                             // .ods
    'application/vnd.oasis.opendocument.presentation'                             // .odp
  ],
  STORAGE_SEUIL: 0.95,                    // ≥ 95 % du quota (compte gratuit = 15 Go) → on cesse de COPIER
                                          // (jamais de suppression) + alerte unique ; reprise auto quand ça baisse

  // --- Dossiers (IDs : docs/TAXONOMY.md) ---
  DOSSIERS: {
    A_TRIER: '1zFTPL9iADzjJ83F4keX2zaZ9myXBPB-k',
    A_VERIFIER: '1oay2F7j1BzYeQGuPbIXKNrA1XBCNibUP'
  },

  DOMAINES: {
    '01 · Administratif & identité': '1Bozg3oLNUVXehm1cQl4gTKs6_XpwolWx',
    '02 · Finances': '1B9jNRpAKrAWdUs6Gn5_ojle3ZH7JbFDW',
    '03 · Logement & véhicule': '1oI1inPX3nWr_1I74A3jDM-ovr6talQlN',
    '04 · Immigration': '1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC',
    '05 · Carrière': '1BAg7k7RVrJ4ifoeh9U0XW5hKWXjRI1CC',
    '06 · Études & diplômes': '1PeeKG8XgZB6gJdZo03cO7F0s_iMgw6Ec',
    // Perso renuméroté 07 → 08 (ADR-0002 : 07 est désormais « Santé »). MÊME dossier (ID inchangé) ;
    // `assurerNomsDomaines_` renomme le dossier physique pour coller à cette clé (zéro clic, réversible).
    '08 · Perso & projets': '19uwSc1A47d_q32Dd2YJ4Wi9StllvyLey'
  },

  // Synchronisation des NOMS de dossiers de domaine avec les clés de DOMAINES ci-dessus (self-healing).
  // Bumper ce tag rejoue le renommage (ex. après un renumérotage). Gated par une Script Property → ~1 fois.
  NOMS_DOMAINES_TAG: 's1',                // s1 : renumérote « 07 · Perso » → « 08 · Perso » (07 = Santé)

  // Garde anti-variantes (ADR-0002 §4) : score de similarité minimal (0..1) au-delà duquel une nouvelle
  // entité proposée est signalée comme VARIANTE possible d'une entité existante (« Desjardins » vs « Caisse
  // Desjardins »), pour fusion en 1 clic par Marc. Suggestion seulement — jamais de fusion automatique.
  SEUIL_VARIANTE: 0.6,

  // Curation one-shot de la file d'entités (#10, ADR-0009) : tant que le tag stocké
  // (`DriveAI_CURATION_ENTITES`) diffère, chaque tick passe la file `en_attente` au filtre
  // anti-génériques + au regroupement de variantes (statuts seulement — AUCUN document touché,
  // 100 % réversible en rééditant le Statut). Bumper le tag rejoue une curation complète.
  CURATION_ENTITES_TAG: 'c2',            // c2 (P4/C28-10) : rejoue la curation avec la passe 1.5
                                          // (canonicalisation rétroactive) sur la file actuelle de Marc

  // Boucle d'apprentissage (ADR-0003 §3) : à chaque classement, on injecte dans le prompt les
  // corrections passées les PLUS PROCHES (même émetteur) comme exemples few-shot. Borné pour le coût
  // (< 10 $/mois) : au plus FEWSHOT_MAX exemples, et seulement au-dessus de FEWSHOT_SEUIL de pertinence
  // (proportion des jetons d'émetteur retrouvés dans le doc) — pas de bruit sur des émetteurs sans rapport.
  FEWSHOT_MAX: 3,
  FEWSHOT_SEUIL: 0.6,

  // Canal de correction (ADR-0003 §1, chantier #6) : nombre max de corrections APPLIQUÉES (écrites) par
  // run (le reste est repris au tick suivant — anti-rafale, borné comme les autres lots ; les réponses
  // en double/invalides ne comptent pas et sont bornées par le garde-temps). Usage perso : largement
  // suffisant, Marc soumet quelques corrections à la fois.
  CORRECTIONS_MAX_PAR_RUN: 20,

  // Sous-dossiers de catégorie connus (Phase 1 : seuls ceux de 03).
  CATEGORIES: {
    '03 · Logement & véhicule': {
      'Logement': '13ISBh6ZrwK9YHgmIM20tWTgWh4x9wI79',
      'Véhicule': '1Hqmg1eV4q28saCreUyrfUIfKLwV972Wc'
    }
  },

  // Domaines à fort volume → sous-dossier par année (AAAA) créé au besoin.
  DOMAINES_PAR_ANNEE: ['02 · Finances'],

  // Zone protégée : domaines jamais rangés auto (garde-fou non négociable).
  DOMAINES_PROTEGES: ['04 · Immigration'],

  // Domaine par défaut (catch-all) quand le LLM ne rend pas un domaine valide. Décision Marc
  // 2026-07-01 : plus de file de revue — un document non classable est rangé AU MIEUX ici (avec
  // son nom final propre), jamais laissé en limbo. « Administratif » = bucket générique le plus sûr.
  DOMAINE_DEFAUT: '01 · Administratif & identité',

  // Domaines AUTO-créés (ADR-0002 §3) : nouveaux domaines sans ID en dur — le dossier est trouvé/créé
  // par le code À CÔTÉ des domaines existants (find-or-create, cf. Router.dossierDomaineAuto_), zéro clic.
  // Ils sont autorisés dans le prompt LLM (domainesAutorises_) et routés comme les 7 domaines fixes.
  // 09 · Voyages ajouté (refonte 2026-07-07, demande Marc) : vols, trains, hôtels, réservations,
  // locations de voyage — le domaine manquant qui éparpillait les billets dans Administratif/Perso.
  DOMAINES_AUTO: ['07 · Santé', '09 · Voyages'],

  // Fichiers TECHNIQUES (ADR-0002 §3, `_Technique` hors domaines) : code, CAO — écartés du classement
  // documentaire (ni OCR ni LLM : ce ne sont pas des documents à classer par domaine). Rangés dans
  // `_Technique` (find-or-create à côté de `_Doublons`) pour ne pas polluer les domaines. Détection par
  // EXTENSION uniquement (jamais PDF/Office/images/CSV, qui peuvent être de vrais documents).
  EXT_TECHNIQUES: [
    '.java', '.class', '.jar', '.py', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php',
    '.sh', '.sql', '.m', '.ino', '.v', '.vhd',                         // code
    '.step', '.stp', '.stl', '.igs', '.iges', '.dwg', '.dxf', '.obj', '.fbx', '.blend', '.sldprt', '.ipt' // CAO
  ],

  // --- Chantier #11 : MÉDIAS BRUTS (ADR-0009 §2, `_Médias` hors domaines) ---
  // Un média personnel manifeste est écarté SANS LLM : vidéo/audio/gif TOUJOURS (jamais un document) ;
  // photo SEULEMENT si nom non-documentaire (export Facebook, IMG_…) ET OCR vide — l'OCR reste le juge :
  // un scan de passeport nommé IMG_2734.jpg contient du texte → il garde son analyse complète (§1).
  EXT_MEDIAS_DIRECT: [
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.wmv',   // vidéo
    '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',                    // audio
    '.gif'                                                              // animation (jamais un scan)
  ],
  EXT_PHOTOS: ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff'],
  MEDIAS_OCR_MAX_CARS: 20,               // extrait OCR sous ce seuil = « photo sans texte »
  // Exports de compte (Facebook/Instagram…) : un gros HTML/JSON de navigation, jamais un document
  // (refonte 2026-07-07). Au-delà de ce poids ET sans émetteur identifié, un .html/.htm est traité
  // comme un export → _Technique (une facture .html légitime porte un émetteur et reste plus petite).
  EXPORT_TAILLE_MIN: 40000,
  // Incident « BACAR » (2026-07-06) : photo de plat classée « Reçu de dépôt_BACAR » — l'OCR avait
  // lu les étiquettes de bouteilles (> 20 cars) et le LLM a inventé un document. Le seuil OCR reste
  // BAS (un passeport mal photographié doit atteindre le juge, §1) ; c'est la CONFIANCE du verdict
  // qui tranche : une PHOTO au nom NON documentaire classée sous ce seuil n'est JAMAIS « classée au
  // mieux » → _Médias (réversible, nom conservé). Exception : zone protégée/sensible — jamais
  // rétrogradée en média (un passeport à 0,6 reste classé dans son domaine).
  MEDIAS_CONFIANCE_MIN: 0.7,

  // --- Recherche IA depuis l'app (C21-03, via doPost) : bornes de budget ---
  IA_RECHERCHE_MIN_INTERVALLE_MS: 5000,   // anti-rafale dédié (5 s entre deux questions)
  IA_RECHERCHE_MAX_JOUR: 50,              // plafond quotidien d'appels SERVIS (≈ 0,002 $/question Haiku pire cas — ~3 $/mois au plafond)
  LLM_MAX_TOKENS_RECHERCHE: 300,          // le plan JSON tient largement dedans

  // --- Miroir Drive du dépôt (ADR-0017, demande Marc : accès de partout + NotebookLM lit depuis
  // Drive) : copie TEXTE (.txt) du dépôt, écrite par la web app (action=sync-miroir, GitHub Actions
  // à chaque push sur main). Garde-temps par LOT (la boucle complète vit côté Action, en plusieurs
  // requêtes) — jamais de suppression (§2), un fichier retiré du dépôt laisse une copie obsolète.
  MIROIR_BUDGET_MS: 4 * 60 * 1000,

  // --- Auto-validation des entités fréquentes (#18, décision Marc : seuil 3) ---
  ENTITES_AUTO_SEUIL: 3,                  // vue ≥ N fois → auto-validée (dossier créé au même tick)
  ENTITES_AUTO_MAX_PAR_RUN: 5,            // bornée par run (le reste au tick suivant)

  // --- Réorg IA (#21, C21-04) : proposition de réorganisation des DOSSIERS ---
  REORG_DOSSIERS_MAX: 250,                // inventaire borné (au-delà : abandon honnête, jamais un plan partiel)
  REORG_EXEMPLES_PAR_DOSSIER: 3,          // noms de fichiers donnés en exemple au LLM (métadonnées seules)
  REORG_ACTIONS_MAX: 40,                  // un plan reste digeste — au-delà, tronqué
  REORG_ESSAIS_MAX: 3,                    // tentatives par demande (inventaire/LLM) avant « échec »
  REORG_MAX_JOUR: 5,                      // plafond quotidien d'appels LLM de réorg (borne une app boguée qui re-demanderait en boucle)
  REORG_FUSION_LOT: 40,                   // éléments déplacés par run lors d'une FUSION (reprenable — garde-temps partagé)
  LLM_MAX_TOKENS_REORG: 3000,             // 40 actions pretty-printées + synthèse SANS troncature (analyse ≈ 0,02 $, à la demande seulement)

  // --- Phase 2 : référentiel d'entités ---
  // Dossier d'entrée scanné pour le dépôt manuel (réutilise A_TRIER ci-dessus).
  INTAKE_SCAN_MAX: 400,                   // fichiers PARCOURUS par run pour composer la page (mur de skips borné)
  INTAKE_PAGE: 150,                       // nb de fichiers de 00·À trier traités par run (50→150 pour le
                                          // rangement de masse : chaque tick utilise tout son budget-temps
                                          // au lieu de s'arrêter à 50 — le garde-temps reste la vraie borne)
  REJEU_PAGE: 100,                        // nb de dépôts renvoyés par run lors d'un auto-rejeu
  RANGEMENT_MAX_PAR_RUN: 60,              // grand rangement : nb de fichiers renvoyés vers 00·À trier par run
                                          // (200→60 : la boucle de déplacement fait la re-vérif §1 stricte
                                          // par fichier ; bornée à 60, elle laisse ~3 min de budget/tick à
                                          // l'INTAKE — sinon le rangement affame le classement, cf. P1-19)
  RANGEMENT_SEUIL_FILE: 40,               // ne collecte de NOUVEAUX fichiers que si 00·À trier en a moins
                                          // (drainer avant d'alimenter, sans affamer ni déborder la file)
  RANGEMENT_RECENS_ESSAIS_MAX: 3,         // barre de progression : nb de recensements incomplets tolérés
                                          // avant d'accepter un compte PARTIEL comme base (anti-blocage
                                          // sur un Drive énorme — la re-base/finalisation corrigent l'écart)
  // Grand rangement initial AUTO (zéro clic) : tant que le tag stocké (Script Property
  // `DriveAI_RANGEMENT`) diffère de celui-ci, le moteur renvoie au fil des ticks TOUT le contenu
  // « en vrac » des domaines vers 00·À trier pour reclassement/renommage (cf. Main.appliquerRangementInitial_).
  // Borné/run, reprenable, déplacement seul (jamais de suppression). Bumper ce tag relance un rangement complet.
  RANGEMENT_TAG: 'r3',                    // r3 : relance après le fix « collecte avortée → faux terminé »
                                          // (r2 s'était figé « terminé » sans rien ranger — cf. P1-17)
  // Racines SUPPLÉMENTAIRES à reclasser en plus des 7 domaines (ancien Drive). Tout leur contenu
  // « en vrac » est renvoyé dans 00·À trier puis re-classé par le pipeline (mêmes garde-fous : zone
  // protégée multi-parents, format normalisé sauté, garde-temps).
  // VIDE depuis 2026-07-07 (décision Marc « retire ») : la racine « Ancienne structure »
  // (1W3b0…) est devenue INACCESSIBLE (supprimée/déplacée par Marc). Son `getFolderById` levait à
  // chaque passe ⇒ `erreurCollecte=true` ⇒ `reste=true` permanent ⇒ le rangement ne pouvait plus
  // jamais figer « terminé » (barre bloquée à 99 %). Le rattrapage étant fini (2796/2796 classés,
  // 0 restant), on retire la racine : la prochaine passe collecte 0 sans erreur ⇒ « terminé » + 100 %.
  // Ré-ajouter un ID ici (et bumper RANGEMENT_TAG) relancerait un rangement sur cette racine.
  RANGEMENT_RACINES_SUP: [],
  // Réconciliation Index↔Drive (C28-07, plan P3) : campagne de fond perpétuelle, lecture seule.
  SYNC_LIGNES_PAR_RUN: 50,            // lignes d'Index re-visitées par tick (sur le reliquat de budget)
  SYNC_BUDGET_JOUR_MS: 12 * 60 * 1000, // budget QUOTIDIEN en ms RÉELLES (leçon §7 : ~90 min/j de runtime partagé — jamais un compteur d'items)
  SYNC_AGE_MIN_H: 48,                 // une ligne plus fraîche que ça n'a pas eu le temps de dériver — pas de vérif Drive

  // --- Chantier #8 : MIGRATION de l'existant vers la nouvelle taxonomie (ADR-0002) ---
  // Re-classe les documents DÉJÀ CLASSÉS (avant le nommage par type, les entités, 07·Santé, le few-shot)
  // en les repassant au pipeline complet, EN PLACE (déplacement/renommage seul — jamais via 00·À trier :
  // leur clé Index `drive|`/`messageId|` existante y bloquerait le re-traitement). Idempotence et
  // convergence par une clé DÉDIÉE `migre|<tag>|fileId` : chaque document est re-traité UNE fois par
  // campagne ; la campagne se fige quand une passe complète ne collecte plus rien. Zone protégée (04)
  // exclue de la collecte ET revérifiée avant mutation. Bumper le tag relance une campagne complète —
  // utile après une validation d'entités en masse (les docs rangés au domaine redescendent aux entités).
  MIGRATION_TAG: 'm1',                    // m1 : 1ʳᵉ migration (nommage par type + entités + 07·Santé + few-shot)
  MIGRATION_MAX_PAR_RUN: 12,              // docs re-traités (OCR+LLM complets, lourds) par run — le flux
                                          // VIVANT (intake) garde la priorité ; campagne finie en fond
  MIGRATION_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK de la migration (< BUDGET_MS) : protège le
                                          // quota JOURNALIER des triggers (~90 min/j, compte gratuit) — sans
                                          // lui, la campagne épuiserait le quota en quelques heures et
                                          // l'intake serait mort le reste de la journée

  // --- C26-08 (ADR-0018) : RE-ANALYSE v2 CIBLÉE des domaines mal classés ---
  // Décision Marc 2026-07-09 (« go 2 ») après la preuve dry-run C26-07 : re-passe au pipeline v2
  // (Sonnet 2 passes) les SEULS domaines où l'échantillon a montré un fort taux de mal-classés
  // (03 : 9 propositions/12 ; 08 : 4/11) — ~924 docs ≈ 24 $ au coût mesuré (0,026 $/doc).
  // Même mécanique éprouvée que la migration (clé dédiée additive `reanalyse|<tag>|fileId`,
  // convergence par passe vide, zone protégée revérifiée, ignorerDoublon), avec 2 différences :
  // la collecte itère UNIQUEMENT sur REANALYSE_CIBLES, et la campagne ne démarre qu'après la FIN
  // de m1 (une seule campagne de masse à la fois — les collecteurs se marcheraient dessus).
  // Ces domaines sont exclus de m1 dès ce merge : jamais payés DEUX fois (v1 puis v2).
  REANALYSE_TAG: 'c26-08',                // bumper le tag relance une campagne complète (re-facture)
  REANALYSE_CIBLES: ['03 · Logement & véhicule', '08 · Perso & projets'],
  REANALYSE_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK (même famille que MIGRATION_BUDGET_MS) ;
                                          // la page réutilise MIGRATION_MAX_PAR_RUN (docs lourds/run)

  // --- C26-07 (ADR-0015) : PREUVE dry-run avant/après du pipeline v2, sur un échantillon RÉEL ---
  // Prérequis à la campagne C26-08 et à l'allumage de ANALYSE_V2. Interrupteur DÉDIÉ, distinct
  // d'ANALYSE_V2 : n'affecte JAMAIS le flux vivant (Haiku 1 passe reste actif tant qu'ANALYSE_V2
  // est éteint). Exécute classifierDeuxPasses_ + planRoutageV2_ (PUR, aucune I/O) sur un échantillon
  // stratifié, écrit l'avant/après dans l'onglet Sheet « DryRunV2 » — NE DÉPLACE NI NE RENOMME RIEN.
  // Coût réel engagé quand ON (Sonnet ×2/doc, ~0,03-0,04 $/doc, ADR-0015) : n'allumer qu'après feu
  // vert explicite de Marc sur la taille de l'échantillon (docs/RUNBOOK.md).
  // ALLUMÉ 2026-07-08 (feu vert Marc : ~100 docs, ~3-6 $) ; CLOS 2026-07-09 : onglet DryRunV2
  // rempli (100/100, coût 2,61 $) et validé par Marc → « go » à C26-08 (ADR-0018). Rebrancher
  // exige un NOUVEAU tag (re-facture, décision explicite).
  DRYRUN_V2_ACTIF: false,
  DRYRUN_V2_TAG: 'd1',                    // bumper relance un NOUVEL échantillon (re-facture, décision explicite)
  DRYRUN_V2_TAILLE: 100,                  // taille cible de l'échantillon global (marge 50-150, à confirmer avec Marc)
  DRYRUN_V2_MAX_PAR_DOMAINE: 15,          // plafond par domaine — anti-déséquilibre (un domaine énorme n'écrase pas les autres)
  DRYRUN_V2_MAX_PAR_RUN: 8,               // docs traités (OCR + Sonnet ×2, lourds) par tick — flux vivant reste prioritaire
  DRYRUN_V2_BUDGET_MS: 2 * 60 * 1000,     // sous-budget PAR TICK (même famille que MIGRATION_BUDGET_MS)

  // Schémas de sous-dossiers FIXES créés à la validation d'une entité (docs/TAXONOMY.md).
  // Clé = Type d'entité ; valeur = liste ordonnée de sous-dossiers.
  SCHEMAS_ENTITE: {
    'Logement': ['Bail & contrat', 'Factures', 'Assurance', 'État des lieux & photos', 'Correspondance'],
    'Véhicule': ['Achat & financement', 'Assurance', 'Entretien & réparations', 'Immatriculation (SAAQ)'],
    'Compte financier': ['Relevés', 'Contrats & produits', 'Correspondance'],
    'Diplôme': ['Diplôme & attestation', 'Relevés de notes', 'Mémoire & travaux']
  },

  // Sous-dossiers d'entité à découper PAR ANNÉE (fort volume).
  SOUS_DOSSIERS_PAR_ANNEE: ['Factures', 'Relevés'],

  // Aiguillage type_doc → sous-dossier d'entité (heuristique ; sinon racine d'entité).
  // Clés en minuscules sans accents (cf. normaliserCle_).
  SOUS_DOSSIER_PAR_TYPE: {
    'facture': 'Factures',
    'releve': 'Relevés',
    'bail': 'Bail & contrat',
    'contrat': 'Bail & contrat',
    'assurance': 'Assurance',
    'etat des lieux': 'État des lieux & photos',
    'entretien': 'Entretien & réparations',
    'reparation': 'Entretien & réparations',
    'immatriculation': 'Immatriculation (SAAQ)',
    'diplome': 'Diplôme & attestation',
    'attestation': 'Diplôme & attestation',
    'releve de notes': 'Relevés de notes',
    'bulletin': 'Relevés de notes',
    'memoire': 'Mémoire & travaux'
  }
};

/** Liste des domaines autorisés (pour le prompt et la validation) : les 7 fixes + les auto-créés.
 *  Triée (préfixes `NN ·` → ordre 01→08) pour un prompt LLM lisible, même avec les domaines auto. */
function domainesAutorises_() {
  return Object.keys(CONFIG.DOMAINES).concat(CONFIG.DOMAINES_AUTO || []).sort();
}

/**
 * Garde-temps effectif du run : abaissé quand un document du tick peut passer par le pipeline
 * Sonnet ×2 (documents bien plus longs) pour tenir le mur dur des 6 min avec de la marge
 * (ADR-0015). Couvre `ANALYSE_V2` (flux vivant) ET `DRYRUN_V2_ACTIF` (C26-07) : le dry-run exécute
 * EXACTEMENT le même pipeline lourd (`classifierDeuxPasses_`) alors qu'`ANALYSE_V2` reste ÉTEINT
 * par construction (interrupteur dédié) — sans ce OU, le dry-run tournerait avec le budget
 * calibré Haiku (270 s) au lieu des 180 s prévus pour ce coût-temps, revue llm-cost-optimizer #26.
 * Haiku seul (aucun des deux ON) → budget nominal. PUR.
 * @return {number} millisecondes
 */
function budgetMsRun_() {
  return (CONFIG.ANALYSE_V2 || CONFIG.DRYRUN_V2_ACTIF) ? CONFIG.ANALYSE_V2_BUDGET_MS : CONFIG.BUDGET_MS;
}

/** Catégories connues (Phase 1), pour borner la sortie du LLM. */
function categoriesConnues_() {
  var noms = [];
  Object.keys(CONFIG.CATEGORIES).forEach(function (dom) {
    Object.keys(CONFIG.CATEGORIES[dom]).forEach(function (c) {
      if (noms.indexOf(c) === -1) noms.push(c);
    });
  });
  return noms;
}

/**
 * Clé API Anthropic — lue depuis les Script Properties, jamais en dur.
 * @return {string}
 */
function getCleAnthropic_() {
  var cle = PropertiesService.getScriptProperties().getProperty('DriveAI_ANTHROPIC_KEY');
  if (!cle) {
    throw new Error('Clé API absente : définis DriveAI_ANTHROPIC_KEY dans les Script Properties.');
  }
  return cle;
}

/**
 * Classeur d'état (Entités / Corrections / Index / Journal / Échecs / Santé / Progression).
 * Auto-créé au premier run UNIQUEMENT si DriveAI_SHEET_ID est ABSENT (première installation).
 *
 * ÉCHEC FERMÉ (incident 2026-07-08, leçon durable §7) : « absente » ≠ « inaccessible ». Un
 * `openById` qui échoue TRANSITOIREMENT (panne API Google, blip d'accès) ne doit JAMAIS
 * recréer la ressource ni écraser son ID — c'est arrivé une fois : nouvelle Sheet VIDE créée
 * en plein tick, tout l'état forké en silence (~87 PJ re-déposées, validations orphelines).
 * On lève : le run échoue proprement, le tick suivant réessaie. L'IDENTITÉ de la Sheet d'état
 * est un invariant (verrou : test/sheet-etat.test.js).
 * @return {Spreadsheet}
 */
function getSheetEtat_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DriveAI_SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('Panne API Google ou accès refusé à la Sheet d\'état. Abandon pour protéger l\'idempotence : ' + e);
    }
  }
  var ss = SpreadsheetApp.create('DriveAI — État');
  props.setProperty('DriveAI_SHEET_ID', ss.getId());
  initialiserSheet_(ss);
  return ss;
}
