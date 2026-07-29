/**
 * Reset.gs — RESET complet du Drive (C28-33, ADR-0030) : partie PURE (PR1).
 *
 * Décision Marc 2026-07-29 : tout rassembler dans `_TRI 2026`, écarter les doublons, repartir sur
 * une structure NEUVE où chaque niveau a ≤ 7 sous-dossiers (récursif). Structure cible AMENDÉE puis
 * validée par Marc (pièces d'identité Marc/Autres ; 3325 4e Avenue (LCP) ; Employeurs = Robovic +
 * Automatech seuls ; 06 par ÉCOLE ; 04 restructurée en INTERNE — jamais de sortie automatique).
 *
 * Ce module PR1 ne contient AUCUN I/O : la table `STRUCTURE_CIBLE_RESET` (source de vérité, ≤ 7
 * verrouillé par test DÉRIVÉ de la table) et le routage PUR `cheminCibleReset_` (par le NOM :
 * 97 % des fichiers sont conformes `AAAA[-MM[-JJ]]_Type_Émetteur.ext` — inventaire 2026-07-29).
 * Un fichier NON ROUTÉ rend null : il RESTE dans `_TRI 2026` (visible, compté au rapport) — jamais
 * un classement deviné. Les campagnes I/O (rassemblement, dédup, placement, 04 interne) = PR2.
 */

/* ================= STRUCTURE CIBLE (validée par Marc, ≤ 7 par niveau) ================= */

/** Sous-dossiers standard d'une ÉCOLE (06). Prépa reçoit en plus « Concours ». */
var SOUS_DOSSIERS_ECOLE_RESET = ['Cours & travaux', 'Examens & khôlles', 'Résultats', 'Administratif'];

/** Construit le nœud d'une école depuis la constante (UNE source — revue PR1). PURE. */
function ecoleReset_(avecConcours) {
  var n = {};
  for (var i = 0; i < SOUS_DOSSIERS_ECOLE_RESET.length; i++) n[SOUS_DOSSIERS_ECOLE_RESET[i]] = {};
  if (avecConcours) n['Concours'] = {};
  return n;
}

var STRUCTURE_CIBLE_RESET = {
  '01 · Administratif & identité': {
    'Pièces d\'identité': { 'Marc': {}, 'Autres': {} }, // Autres/<personne> créé dynamiquement (≤ ~4 proches)
    'État civil & notarial': {},
    'Attestations & certificats': {},
    'Correspondance': {},
    'Contrats & fournisseurs': { 'EDF': {}, 'ENGIE': {}, 'Virgin Plus': {}, 'Transport scolaire': {}, 'Filia-MAIF': {}, 'INO': {} },
    'Sécurité & codes': {},
  },
  '02 · Finances': {
    'Banques': { 'Desjardins': {}, 'Boursorama': {}, 'CIC': {}, 'Banque Transatlantique': {}, 'Banques France': {}, 'Coordonnées & chèques': {} },
    'Relevés': { '2026': {}, '2025': {}, '2024': {}, '2023': {}, '2022': {}, '2021': {}, 'Archives': {} },
    'Reçus & factures': { '2026': {}, '2025': {}, '2024': {}, 'Archives': {} },
    'Impôts & déclarations': {},
    'Assurances & prévoyance': {},
    'Placements & crypto': {},
    'Donations & successions': {},
  },
  '03 · Logement & véhicule': {
    // Fichiers À PLAT dans chaque logement (noms triables par date) — plus de squelettes de schéma.
    'Logements': { '1548 avenue de la Roselière': {}, '3987 route des Rivières': {}, '3325 4e Avenue (LCP Groupe Immobilier)': {}, 'Anciens logements': {} },
    'Véhicules': { 'KIA': {}, 'Anciens véhicules': {} },
    'Énergie & services': {},
    'Assurance habitation': {},
  },
  // 04 : structure INTERNE (ADR-0030 §4) — les fichiers ne sortent JAMAIS de 04 automatiquement.
  '04 · Immigration': {
    'IRCC (fédéral)': {},
    'MIFI (Québec)': {},
    'Permis de travail & EIMT': {},
    'Résidence permanente': {},
    'Formulaires & correspondance': {},
  },
  '05 · Carrière': {
    'Employeurs': { 'Robovic': {}, 'Automatech': {} }, // décision Marc : les autres = recherche d'emploi
    'Recherche d\'emploi': { 'Candidatures': {}, 'Suivi': {}, 'Archive 2021-2025': {} },
    'Alternance & stages': {},
    'CV & lettres': {},
    'Entreprise — MRic (SCI)': {},
    'Formation & bilans': {},
    'Réseaux & présentations': {},
  },
  '06 · Études & diplômes': {
    'Lycée Thérèse d\'Avila': ecoleReset_(false),
    'Prépa Gustave Eiffel (PTSI)': ecoleReset_(true),
    'DUT ULCO Saint-Omer': ecoleReset_(false),
    'Cégep de Sherbrooke': ecoleReset_(false),
    'IMERIR': ecoleReset_(false),
    'Autres établissements': {},
    'Diplômes & relevés officiels': {},
  },
  '07 · Santé': {
    'Médecins & consultations': {},
    'Hôpitaux & centres': {},
    'Assurances santé': {},
    'Factures & reçus': {},
    'Examens & résultats': {},
    'Médecine scolaire & travail': {},
  },
  '08 · Perso & projets': {
    'Projets': { 'DriveAI': {}, 'Novel Software': {}, 'Projets techniques': {}, 'Autres': {} },
    'Écrits & rédactions': {},
    'Schémas & technique': {},
    'Photos & loisirs': {},
    'Notes': {},
    'Données & exports': {},
  },
  '09 · Voyages': {
    'Réservations & billets': { '2026': {}, '2025': {}, '2024': {}, 'Archives': {} },
    'Par voyage': { 'Chine': {}, 'Finlande': {}, 'Pérou': {}, 'New York': {}, 'Autres': {} },
    'Assurances voyage': {},
  },
};

/**
 * Vérifie la contrainte « ≤ maxParNiveau enfants à CHAQUE niveau » sur toute la table. Rend la
 * liste des violations (chemin : n) — vide = conforme. PURE (le test dérive ses cas de la table,
 * jamais d'une valeur du jour — leçon §7).
 * EXEMPTION EXPLICITE (revue PR1) : le niveau RACINE (les 9 domaines 01→09, préexistants et validés
 * par Marc avec la structure) n'est PAS compté — la contrainte porte sur l'INTÉRIEUR des domaines.
 * Les enfants DYNAMIQUES (« Pièces d'identité/Autres/<personne> ») sont bornés par la liste
 * RESET_PERSONNES_AUTRES, pas par cette table.
 */
function verifierStructureCibleReset_(structure, maxParNiveau) {
  var violations = [];
  var marcher = function (noeud, chemin) {
    var enfants = Object.keys(noeud || {});
    if (enfants.length > maxParNiveau) violations.push(chemin + ' : ' + enfants.length + ' sous-dossiers');
    for (var i = 0; i < enfants.length; i++) marcher(noeud[enfants[i]], chemin + '/' + enfants[i]);
  };
  Object.keys(structure || {}).forEach(function (dom) { marcher(structure[dom], dom); });
  return violations;
}

/* ================= ROUTAGE PAR LE NOM (PUR) ================= */

/** Vrai si la clé normalisée contient l'UN des motifs (déjà normalisés). PURE. */
function resetContient_(cle, motifs) {
  for (var i = 0; i < motifs.length; i++) { if (cle.indexOf(motifs[i]) !== -1) return true; }
  return false;
}

/** Année → nom de sous-dossier d'un nœud à années (l'année si elle existe dans le nœud, sinon Archives). */
function resetBucketAnnee_(annee, noeudAnnees) {
  return (annee && noeudAnnees[annee]) ? annee : 'Archives';
}

/** Personnes « Autres » connues (pièces d'identité) : clé normalisée → libellé de dossier. */
var RESET_PERSONNES_AUTRES = { 'francine richard': 'Francine Richard', 'leandre labyt': 'Léandre LABYT' };

/**
 * Dossiers/fichiers JAMAIS touchés par le reset (en plus des `00 ·`, `_…` et de la zone gérée à
 * part) : artefacts du moteur identifiés par NOM. PURE.
 */
function estExcluDuReset_(nom) {
  return /^(DriveAI|Rapports agent|00 · Guide)/.test(String(nom == null ? '' : nom).trim());
}

/**
 * CHEMIN CIBLE d'un fichier dans la NOUVELLE structure — par le NOM seul, zéro LLM.
 * @param {string} domaine  domaine d'ORIGINE (enregistré au rassemblement, clé `tri33|`)
 * @param {string} nom      nom actuel du fichier
 * @return {?string} chemin relatif au domaine (« Banques/Desjardins ») — null = NON ROUTÉ : le
 *   fichier RESTE dans `_TRI 2026` (rapport → affinage de table ou passe LLM). Jamais deviné.
 */
function cheminCibleReset_(domaine, nom) {
  var s = STRUCTURE_CIBLE_RESET[domaine];
  if (!s) return null;
  var seg = analyserNomClasse_(nom);
  var t = normaliserCle_(seg.type || '');
  var e = normaliserCle_(seg.tiers || '');
  var tout = normaliserCle_(nom);

  if (domaine === '01 · Administratif & identité') {
    if (resetContient_(t, ['passeport', 'carte nationale d identite', 'carte d identite', 'permis de conduire', 'carte d assurance maladie', 'carte vitale', 'carte de resident'])) {
      for (var p in RESET_PERSONNES_AUTRES) { if (e.indexOf(p) !== -1) return 'Pièces d\'identité/Autres/' + RESET_PERSONNES_AUTRES[p]; }
      // « Marc » SEULEMENT si le tiers est Marc lui-même OU une AUTORITÉ émettrice (cas majoritaire :
      // Préfecture, SAAQ, RAMQ… — le titulaire n'est alors pas dans le nom). Un tiers INCONNU qui
      // ressemble à une personne rend null (revue PR1) : le contrat du module est « jamais deviné » —
      // le passeport d'un proche non listé doit RESTER en _TRI au rapport, pas finir chez Marc.
      if (e.indexOf('marc') !== -1 && e.indexOf('richard') !== -1) return 'Pièces d\'identité/Marc';
      if (e === '' || resetContient_(e, ['prefecture', 'saaq', 'societe de l assurance', 'ramq', 'gouvernement', 'republique', 'mairie', 'ministere', 'service'])) {
        return 'Pièces d\'identité/Marc';
      }
      return null;
    }
    if (resetContient_(t, ['acte de naissance', 'acte de mariage', 'fiche d etat civil', 'fiche individuelle', 'livret de famille']) ||
        resetContient_(e, ['office notarial', 'notaire'])) return 'État civil & notarial';
    if (resetContient_(t, ['attestation', 'certificat'])) return 'Attestations & certificats';
    if (e.indexOf('edf') !== -1) return 'Contrats & fournisseurs/EDF';
    if (e.indexOf('engie') !== -1) return 'Contrats & fournisseurs/ENGIE';
    if (e.indexOf('virgin') !== -1) return 'Contrats & fournisseurs/Virgin Plus';
    if (resetContient_(e, ['tesco', 'transport scolaire'])) return 'Contrats & fournisseurs/Transport scolaire';
    if (e.indexOf('maif') !== -1) return 'Contrats & fournisseurs/Filia-MAIF';
    if (e === 'ino') return 'Contrats & fournisseurs/INO';
    if (resetContient_(tout, ['code de securite', 'codes de securite', 'mot de passe', 'sauvegarde'])) return 'Sécurité & codes';
    if (resetContient_(t, ['lettre', 'courrier', 'correspondance', 'mise en demeure'])) return 'Correspondance';
    return null;
  }

  if (domaine === '02 · Finances') {
    if (t.indexOf('releve') !== -1) return 'Relevés/' + resetBucketAnnee_(seg.annee, s['Relevés']);
    if (resetContient_(t, ['avis d imposition', 'declaration de revenus', 'impot', 'taxe'])) return 'Impôts & déclarations';
    if (resetContient_(tout, ['donation', 'succession'])) return 'Donations & successions';
    if (resetContient_(tout, ['assurance vie', 'prevoyance'])) return 'Assurances & prévoyance';
    if (resetContient_(tout, ['tether', 'usdt', 'crypto', 'securities', 'portefeuille', 'bourse'])) return 'Placements & crypto';
    if (resetContient_(tout, ['coordonnees bancaires', 'rib', 'cheque'])) return 'Banques/Coordonnées & chèques';
    if (resetContient_(t, ['recu', 'facture'])) return 'Reçus & factures/' + resetBucketAnnee_(seg.annee, s['Reçus & factures']);
    if (e.indexOf('desjardins') !== -1) return 'Banques/Desjardins';
    if (e.indexOf('boursorama') !== -1) return 'Banques/Boursorama';
    if (e.indexOf('transatlantique') !== -1) return 'Banques/Banque Transatlantique';
    if (e.indexOf('cic') !== -1) return 'Banques/CIC';
    if (resetContient_(e, ['societe generale', 'banque de savoie', 'lyonnaise de banque', 'bcque', 'banque 10096', 'credit industriel'])) return 'Banques/Banques France';
    return null;
  }

  if (domaine === '03 · Logement & véhicule') {
    if (tout.indexOf('roseliere') !== -1) return 'Logements/1548 avenue de la Roselière';
    if (tout.indexOf('rivieres') !== -1) return 'Logements/3987 route des Rivières';
    if (resetContient_(tout, ['lcp', '3325', '4e avenue'])) return 'Logements/3325 4e Avenue (LCP Groupe Immobilier)';
    if (resetContient_(tout, ['kia', 'sportage'])) return 'Véhicules/KIA';
    if (resetContient_(t, ['immatriculation', 'carte grise']) || e.indexOf('saaq') !== -1) return 'Véhicules';
    if (resetContient_(e, ['edf', 'engie', 'hydro'])) return 'Énergie & services';
    if (tout.indexOf('assurance habitation') !== -1 || e.indexOf('maif') !== -1) return 'Assurance habitation';
    if (resetContient_(t, ['bail', 'etat des lieux', 'quittance', 'loyer'])) return 'Logements';
    return null;
  }

  // 04 : routage INTERNE seulement (ADR-0030 §4) — jamais appliqué à un fichier hors de 04, et
  // jamais de sortie : un fichier de 04 non routé reste À SA PLACE (pas dans _TRI).
  if (domaine === '04 · Immigration') {
    if (resetContient_(tout, ['mifi', 'francisation'])) return 'MIFI (Québec)';
    if (resetContient_(tout, ['permis de travail', 'eimt', 'ptet'])) return 'Permis de travail & EIMT';
    if (resetContient_(tout, ['residence permanente', 'resident permanent'])) return 'Résidence permanente';
    if (resetContient_(tout, ['ircc', 'citoyennete', 'citizenship', 'immigration'])) return 'IRCC (fédéral)';
    if (resetContient_(t, ['formulaire', 'lettre', 'correspondance'])) return 'Formulaires & correspondance';
    return null;
  }

  if (domaine === '05 · Carrière') {
    if (t === 'cv' || tout.indexOf('cv') === 0 || resetContient_(tout, ['curriculum', 'lettre de motivation'])) return 'CV & lettres';
    if (t.indexOf('candidature') !== -1) return 'Recherche d\'emploi/Candidatures';
    if (tout.indexOf('suivi recherche') !== -1) return 'Recherche d\'emploi/Suivi';
    if (e.indexOf('robovic') !== -1) return 'Employeurs/Robovic';
    if (e.indexOf('automatech') !== -1) return 'Employeurs/Automatech';
    if (resetContient_(e, ['mric', 'm ric'])) return 'Entreprise — MRic (SCI)';
    if (resetContient_(tout, ['alternance', 'stage'])) return 'Alternance & stages';
    if (resetContient_(t, ['bilan', 'formation'])) return 'Formation & bilans';
    if (resetContient_(tout, ['linkedin', 'presentation', 'reseau'])) return 'Réseaux & présentations';
    // Décision Marc : les AUTRES entreprises = recherche d'emploi (jamais employeurs).
    if (e === 'ute' || resetContient_(e, ['arkema', 'eaton', 'siemens', 'schneider', 'wiio', 'bluewrist', 'pierre fabre', 'lactalis', 'gravelines', 'cnpe'])) return 'Recherche d\'emploi';
    return null;
  }

  if (domaine === '06 · Études & diplômes') {
    if (resetContient_(t, ['diplome', 'releve de notes', 'bulletin', 'attestation de reussite'])) return 'Diplômes & relevés officiels';
    var ecole = null;
    if (resetContient_(tout, ['therese', 'avila'])) ecole = 'Lycée Thérèse d\'Avila';
    else if (resetContient_(tout, ['gustave eiffel', 'ptsi', 'kholle', 'concours avenir', 'tetard', 'le meur', 'salwa', 'parcevaux', 'leroux'])) ecole = 'Prépa Gustave Eiffel (PTSI)';
    else if (resetContient_(tout, ['iut', 'ulco', 'littoral', 'saint omer', 'cote d opale'])) ecole = 'DUT ULCO Saint-Omer';
    else if (tout.indexOf('sherbrooke') !== -1) ecole = 'Cégep de Sherbrooke';
    else if (tout.indexOf('imerir') !== -1) ecole = 'IMERIR';
    else if (resetContient_(tout, ['hamk', 'hame', 'erasmus', 'esiee', 'hei campus', 'limoilou', 'saint hyacinthe', 'hubhouse'])) ecole = 'Autres établissements';
    if (!ecole) return null;
    if (ecole === 'Autres établissements') return ecole; // à plat (rapport → affinage si volume)
    if (t.indexOf('concours') !== -1 && ecole === 'Prépa Gustave Eiffel (PTSI)') return ecole + '/Concours';
    if (resetContient_(t, ['examen', 'devoir surveille', 'controle', 'partiel', 'kholle']) || t === 'ds') return ecole + '/Examens & khôlles';
    if (resetContient_(t, ['resultat', 'note', 'evaluation'])) return ecole + '/Résultats';
    if (resetContient_(t, ['certificat de scolarite', 'inscription', 'convention', 'attestation'])) return ecole + '/Administratif';
    if (resetContient_(t, ['cours', 'fiche', 'travaux', 'projet', 'memoire', 'devoir']) || t === 'td' || t === 'tp') return ecole + '/Cours & travaux';
    return ecole; // racine de l'école : mieux que _TRI, l'école est sûre
  }

  if (domaine === '07 · Santé') {
    if (resetContient_(t, ['consultation', 'ordonnance', 'compte rendu'])) return 'Médecins & consultations';
    if (resetContient_(t, ['facture', 'recu'])) return 'Factures & reçus';
    if (resetContient_(t, ['resultat', 'analyse', 'examen', 'radiographie'])) return 'Examens & résultats';
    if (resetContient_(tout, ['medecine scolaire', 'medecine du travail', 'aptitude', 'scolaire'])) return 'Médecine scolaire & travail';
    if (resetContient_(e, ['hopital', 'chu', 'cisss', 'ciusss', 'clinique', 'centre hospitalier'])) return 'Hôpitaux & centres';
    if (resetContient_(tout, ['cnam', 'ramq', 'assurance'])) return 'Assurances santé';
    return null;
  }

  if (domaine === '08 · Perso & projets') {
    if (tout.indexOf('driveai') !== -1) return 'Projets/DriveAI';
    if (tout.indexOf('novel software') !== -1) return 'Projets/Novel Software';
    if (t === 'note' || t === 'notes') return 'Notes';
    if (resetContient_(t, ['memoire', 'article', 'redaction', 'essai', 'ecrit'])) return 'Écrits & rédactions';
    if (resetContient_(t, ['schema', 'plan', 'diagramme', 'guide'])) return 'Schémas & technique';
    if (resetContient_(tout, ['photo', 'evenement', 'classe de neige', 'loisir'])) return 'Photos & loisirs';
    if (resetContient_(tout, ['export', 'donnees'])) return 'Données & exports';
    if (t.indexOf('projet') !== -1) return 'Projets/Autres';
    return null;
  }

  if (domaine === '09 · Voyages') {
    if (resetContient_(tout, ['assurance', 'manuvie'])) return 'Assurances voyage';
    if (resetContient_(tout, ['chine', 'zhongguo'])) return 'Par voyage/Chine';
    if (resetContient_(tout, ['finlande', 'finnair', 'finnlines', 'viking line', 'eckero', 'vr group', 'vr yhtyma', 'chemins de fer finlandais', 'helsinki']) || e === 'vr') return 'Par voyage/Finlande';
    if (resetContient_(tout, ['perurail', 'perou', 'machu', 'cusco'])) return 'Par voyage/Pérou';
    if (tout.indexOf('new york') !== -1) return 'Par voyage/New York';
    if (resetContient_(t, ['confirmation de reservation', 'confirmation de vol', 'billet', 'carte d embarquement', 'carte d acces a bord', 'itineraire', 'reservation'])) {
      return 'Réservations & billets/' + resetBucketAnnee_(seg.annee, s['Réservations & billets']);
    }
    return null;
  }

  return null;
}
