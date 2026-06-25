/**
 * Config.gs — Configuration centrale de DriveAI (Phase 1).
 *
 * Aucune donnée secrète ici : la clé API vit dans les Script Properties
 * (`DriveAI_ANTHROPIC_KEY`). Les IDs de dossiers viennent de docs/TAXONOMY.md.
 */

var CONFIG = {
  // --- Seuils & modèle ---
  SEUIL_CONFIANCE: 0.80,                 // sous ce seuil → file de revue
  LLM_MODELE: 'claude-haiku-4-5',        // Haiku par défaut (le moins cher)
  LLM_MODELE_FALLBACK: 'claude-sonnet-4-6', // fallback ponctuel si Haiku échoue
  LLM_MAX_TOKENS: 400,
  LLM_OCR_MAX_CARS: 4000,                // troncature de l'extrait envoyé au LLM (coût)

  // --- Gmail (lecture seule) & lots ---
  // Idempotence assurée par l'Index (clé messageId|i|nom|taille), PAS par un
  // label : le scope gmail.readonly interdit toute écriture dans la boîte.
  GMAIL_REQUETE: 'has:attachment newer_than:30d',
  PAGE_FILS: 20,                         // taille de page de la recherche Gmail
  BUDGET_MS: 4.5 * 60 * 1000,            // garde-temps (exécution Apps Script < 6 min)
  OCR_TAILLE_MAX: 20 * 1024 * 1024,      // au-delà : pas d'OCR (mémoire) → métadonnées seules

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
