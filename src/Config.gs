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
  // la version stockée diffère, le moteur renvoie automatiquement les DÉPÔTS partis
  // en revue vers 00·À trier pour reclassement (cf. Main.appliquerRejeuSiNouvelleVersion_)
  // — borné, réversible, sans toucher aux PJ Gmail ni aux docs déjà classés. Zéro clic.
  VERSION: 'P2.5',

  // --- Seuils & modèle ---
  SEUIL_CONFIANCE: 0.50,                 // sous ce seuil → file de revue (abaissé de 0.80 sur demande)
  LLM_MODELE: 'claude-haiku-4-5',        // Haiku par défaut (le moins cher)
  LLM_MODELE_FALLBACK: 'claude-sonnet-4-6', // fallback ponctuel si Haiku échoue
  LLM_MAX_TOKENS: 400,
  LLM_OCR_MAX_CARS: 4000,                // troncature de l'extrait envoyé au LLM (coût)
  // Escalade : si Haiku rend une confiance < SEUIL (et doc NON sensible), on relance
  // une analyse approfondie avec Sonnet, plusieurs passes, et on garde la meilleure (consensus
  // de domaine puis confiance max). 3 passes (impair → vote utile). Borné pour le budget
  // (< 10 $/mois) : ne concerne que les cas peu sûrs, et plafonné par run ci-dessous.
  LLM_ESCALADE_PASSES: 3,
  LLM_ESCALADE_MAX_PAR_RUN: 25,           // au-delà : on garde le résultat Haiku (dégradation propre)
  // Prix Anthropic par MILLION de tokens (input/output), pour MESURER le coût réel (Cout.gs, P1-09).
  // À ajuster si la grille de prix change. Haiku 4.5 : 1$/5$ ; Sonnet 4.6 : 3$/15$.
  LLM_PRIX: { haiku_in: 1, haiku_out: 5, sonnet_in: 3, sonnet_out: 15 },
  // Résumé hebdomadaire automatique (mail récap à soi-même, scope script.send_mail existant).
  RESUME_JOUR: 'MONDAY',                  // jour du déclencheur hebdo (WeekDay Apps Script)
  RESUME_HEURE: 8,                        // heure locale d'envoi
  RESUME_JOURS: 7,                        // fenêtre d'activité résumée (jours)
  RESUME_MAX_LIGNES: 15000,               // ne lit que les N dernières lignes Index/Journal (le
                                          // Journal grossit vite : borne la lecture hebdo, large
                                          // marge devant une semaine d'un usage personnel)

  // Intervalle du déclencheur temporel (minutes). Valeurs Apps Script admises : 1, 5, 10, 15, 30.
  // Modifiable à chaud : au tick suivant un déploiement, le moteur réinstalle le déclencheur
  // au nouvel intervalle tout seul (cf. Main.assurerIntervalleTick_). Aucun re-installerTrigger manuel.
  TICK_MINUTES: 10,

  // --- Gmail (lecture seule) & lots ---
  // Idempotence assurée par l'Index (clé messageId|i|nom|taille), PAS par un
  // label : le scope gmail.readonly interdit toute écriture dans la boîte.
  GMAIL_REQUETE: 'has:attachment newer_than:30d',
  PAGE_FILS: 20,                         // taille de page de la recherche Gmail
  BUDGET_MS: 4.5 * 60 * 1000,            // garde-temps (exécution Apps Script < 6 min)

  // --- Phase 3 : tâches & agenda depuis TOUS les mails récents ---
  // Requête séparée de GMAIL_REQUETE (PJ) : ici TOUS les mails, pas seulement ceux avec PJ
  // (une action/un rdv peut être dans un mail sans pièce jointe). Toujours gmail.readonly.
  GMAIL_REQUETE_ACTIONS: 'newer_than:30d',
  PAGE_FILS_ACTIONS: 20,                  // taille de page de cette recherche
  INTENTIONS_MAX_PAR_RUN: 200,            // plafond de messages ANALYSÉS (pré-filtre inclus) par run
  CREATIONS_MAX_PAR_RUN: 30,              // plafond de tâches/événements CRÉÉS par run (pas de rafale)
  LLM_MAX_TOKENS_MINICHECK: 10,           // mini-check binaire (expéditeur+sujet seuls, pas le corps)
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
  // Sous ce nombre de caractères, l'extrait OCR est jugé NON exploitable (garde-fou §1, voir
  // Pipeline.traiterDocument_) : pour un DÉPÔT (manuel ou rangement, sans expéditeur/sujet réels),
  // un OCR vide ne permet pas d'évaluer `sensible` → revue forcée plutôt qu'un classement à l'aveugle.
  OCR_MIN_CARS_EXPLOITABLE: 20,

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
    '07 · Perso & projets': '19uwSc1A47d_q32Dd2YJ4Wi9StllvyLey'
  },

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

  // --- Phase 2 : référentiel d'entités ---
  // Dossier d'entrée scanné pour le dépôt manuel (réutilise A_TRIER ci-dessus).
  INTAKE_PAGE: 50,                        // nb de fichiers de 00·À trier traités par run
  REJEU_PAGE: 100,                        // nb de dépôts renvoyés par run lors d'un auto-rejeu
  RANGEMENT_MAX_PAR_RUN: 200,             // grand rangement : nb de fichiers renvoyés vers 00·À trier par run
  // Grand rangement initial AUTO (zéro clic) : tant que le tag stocké (Script Property
  // `DriveAI_RANGEMENT`) diffère de celui-ci, le moteur renvoie au fil des ticks TOUT le contenu
  // « en vrac » des domaines vers 00·À trier pour reclassement/renommage (cf. Main.appliquerRangementInitial_).
  // Borné/run, reprenable, déplacement seul (jamais de suppression). Bumper ce tag relance un rangement complet.
  RANGEMENT_TAG: 'r2',                    // r2 : inclut désormais l'ancien Drive (RANGEMENT_RACINES_SUP)
  // Racines SUPPLÉMENTAIRES à reclasser en plus des 7 domaines (ancien Drive). Tout leur contenu
  // « en vrac » est renvoyé dans 00·À trier puis re-classé par le pipeline (mêmes garde-fous : zone
  // protégée multi-parents, format normalisé sauté, garde-temps). « Ancienne structure » = ancien Drive de Marc.
  RANGEMENT_RACINES_SUP: ['1W3b0KkKFfXa77YSynCy9-4lgwPSFft-L'],

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

/** Liste des domaines autorisés (pour le prompt et la validation). */
function domainesAutorises_() {
  return Object.keys(CONFIG.DOMAINES);
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
 * Classeur d'état (Entités / Index / Journal / Revue).
 * Auto-créé au premier run si DriveAI_SHEET_ID est absent.
 * @return {Spreadsheet}
 */
function getSheetEtat_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DriveAI_SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // ID invalide (classeur supprimé) → on en recrée un ci-dessous.
    }
  }
  var ss = SpreadsheetApp.create('DriveAI — État');
  props.setProperty('DriveAI_SHEET_ID', ss.getId());
  initialiserSheet_(ss);
  return ss;
}
