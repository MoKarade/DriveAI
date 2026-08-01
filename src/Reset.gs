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
    // « Revenus & paie » REMPLACE « Donations & successions » (décision Marc 2026-07-30, sur le
    // reliquat réel : 10 bulletins de paie bloqués faute de dossier d'accueil). 02 était PLEIN à 7 :
    // la place est prise sur le seul nœud que le reset n'avait JAMAIS créé (vérifié dans Drive —
    // aucun fichier n'y a été routé), donc AUCUN dossier déjà rempli n'est touché. Les rares
    // donations/successions vont désormais en « Impôts & déclarations » (leur versant fiscal) ;
    // leur versant NOTARIAL est déjà couvert par `01 · État civil & notarial`.
    'Revenus & paie': {},
  },
  '03 · Logement & véhicule': {
    // Fichiers À PLAT dans chaque logement (noms triables par date) — plus de squelettes de schéma.
    'Logements': { '1548 avenue de la Roselière': {}, '3987 route des Rivières': {}, '3325 4e Avenue (LCP Groupe Immobilier)': {}, 'Anciens logements': {} },
    // 4 nœuds AUTO ajoutés sur le reliquat réel (décision Marc 2026-07-31, t4) : ~64 fichiers de 03
    // n'avaient aucun dossier d'accueil. Ils sont placés SOUS « Véhicules » (6 enfants ≤ 7 ✔) et non
    // au niveau de 03, qui est à 6/7 — la place restante y est ainsi préservée.
    'Véhicules': { 'KIA': {}, 'Anciens véhicules': {}, 'Entretien & réparations': {}, 'Assurance auto': {}, 'Recherche & achat': {}, 'Contraventions': {} },
    'Énergie & services': {},
    'Assurance habitation': {},
    // Ajoutés sur le reliquat réel (décision Marc 2026-07-30) : 18 « Contrat » et 16
    // « Correspondance » de 03 n'avaient aucun dossier d'accueil. 03 passe à 6 nœuds (≤ 7 ✔).
    'Contrats': {},
    'Correspondance': {},
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

/**
 * Année → nom de sous-dossier d'un nœud à années. L'année si elle existe dans le nœud ; sinon, une
 * année POSTÉRIEURE au dernier bucket figé rend SON PROPRE segment (`2027`), une année ANTÉRIEURE
 * tombe dans `Archives`.
 * ADR-0033 (revue structure-keeper) : les buckets de `STRUCTURE_CIBLE_RESET` sont un instantané
 * HISTORIQUE (2021-2026 + Archives) conçu pour le grand rangement one-shot. Depuis l'unification, le
 * FLUX VIVANT délègue ici — et il AVANCE dans le temps : sans ce forward, tout relevé/reçu/billet de
 * 2027+ atterrirait dans `Archives` (= « ancien », faux). On laisse donc l'année courante et à venir
 * créer son dossier (léger dépassement ≤ 7 au fil des ans, ASSUMÉ vs un mauvais rangement ; la
 * fenêtre glissante avec purge est une évolution possible, cf. ADR-0033 §6). Le PASSÉ reste borné.
 */
function resetBucketAnnee_(annee, noeudAnnees) {
  if (annee && noeudAnnees[annee]) return annee;
  var a = parseInt(annee, 10);
  if (!a || String(a) !== String(annee)) return 'Archives'; // année illisible → Archives (prudent)
  var maxAnnee = 0;
  for (var k in noeudAnnees) { var n = parseInt(k, 10); if (String(n) === k && n > maxAnnee) maxAnnee = n; }
  return a > maxAnnee ? String(a) : 'Archives'; // postérieure aux buckets → son segment ; antérieure → Archives
}

/**
 * Personnes « Autres » connues (pièces d'identité) : clé normalisée → libellé de dossier.
 * Liste EXPLICITE, jamais devinée : une pièce d'identité dont le titulaire n'est pas ici (et qui
 * n'est pas émise par une autorité) reste en `_TRI` au rapport — c'est Marc qui tranche, à qui
 * appartient le dossier. Anna Malaval ajoutée sur sa validation (2026-07-30, après remontée du
 * reliquat réel : `2022-09-07_Passeport_Anna Malaval_2.pdf`).
 */
var RESET_PERSONNES_AUTRES = {
  'francine richard': 'Francine Richard',
  'leandre labyt': 'Léandre LABYT',
  'anna malaval': 'Anna Malaval',
};

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
 *   fichier RESTE dans `_TRI 2026` (rapport → affinage de table ou passe LLM) ; pour 04 (jamais
 *   rassemblée) null = reste À SA PLACE dans 04. Jamais deviné.
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
      if (e === '' || resetContient_(e, ['prefecture', 'saaq', 'societe de l assurance', 'ramq', 'gouvernement', 'republique', 'mairie', 'ministere', 'service', 'consulat', 'ambassade'])) {
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
    // Le pluriel n'est PAS couvert par le singulier (« codes de … » ne contient pas « code de … ») :
    // chaque forme est listée. `codes de recuperation`/`double facteur` ajoutés sur le reliquat réel
    // du 2026-07-30 (fichier resté en _TRI faute de règle).
    if (resetContient_(tout, ['code de securite', 'codes de securite', 'code de recuperation',
      'codes de recuperation', 'mot de passe', 'double facteur', 'authentification a deux facteurs']) ||
        (tout.indexOf('sauvegarde') !== -1 && e.indexOf('gmf') === -1)) return 'Sécurité & codes'; // GMF La Sauvegarde = un ASSUREUR (revue)
    if (resetContient_(t, ['lettre', 'courrier', 'correspondance', 'mise en demeure'])) return 'Correspondance';
    return null;
  }

  if (domaine === '02 · Finances') {
    // FEUILLETS FISCAUX québécois AVANT « Relevés » : le RL-1 (revenus d'emploi) et le RL-31
    // (logement) sont des documents d'IMPÔT, pas des relevés bancaires — sans cette ligne,
    // `t = 'releve 1'` partait dans `Relevés/AAAA` (correction du commentaire de revue : je l'avais
    // affirmé couvert par la règle fiscale, à tort — elle est APRÈS). Motif ANCRÉ sur le nombre pour
    // ne jamais toucher « Relevé 10 » ou un relevé bancaire ordinaire. « Relevé d'emploi » n'est PAS
    // inclus : c'est un document de CARRIÈRE (05), à trancher avec Marc s'il s'en présente.
    if (/(^| )releve (1|31)( |$)/.test(t)) return 'Impôts & déclarations';
    // PAIE — motif ANCRÉ SUR LE MOT, jamais une sous-chaîne : « paie » est contenu dans
    // « paiement », et un « Relevé de paiement » (Hydro-Québec, Retraite Québec, assureurs) n'est
    // PAS un bulletin de salaire. Ma 1ʳᵉ version testait `t === 'paie'` (exact, correct) MAIS aussi
    // `resetContient_(t, [… 'releve de paie'])` — qui rouvrait le piège en grand puisque
    // « releve de paiement » COMMENCE par « releve de paie » (attrapé en revue #228).
    // Même idiome que `Router.schemaNommage_`/`devinerTypeDepuisNom_`, et c'est précisément le motif
    // qui produit le libellé `_Paie_` au renommage : une seule règle de mot aux deux bouts de la
    // chaîne. Couvre paie / bulletin de paie / fiche de paie / feuille de paie / relevé de paie /
    // bulletin de salaire / sommaire de paie… et exclut « paiement » par construction.
    if (/(^| )(paie|salaire)( |$)/.test(t)) return 'Revenus & paie';
    if (t.indexOf('releve') !== -1 && t.indexOf('releve d identite bancaire') === -1) return 'Relevés/' + resetBucketAnnee_(seg.annee, s['Relevés']);
    // Fiscal (dont les feuillets québécois T4/Relevé 1) et remboursements d'IMPÔT (revue : 'bourse'
    // ⊂ « remboursement » envoyait les remboursements en Placements — jamais de motif court sur tout).
    if (resetContient_(t, ['avis d imposition', 'declaration de revenus', 'impot', 'taxe', 'feuillet', 't4']) ||
        (t.indexOf('remboursement') !== -1 && e.indexOf('revenu') !== -1)) return 'Impôts & déclarations';
    // Donations/successions → versant FISCAL (le versant notarial est couvert par `01 · État civil
    // & notarial`, où les actes partent déjà). Le nœud dédié a cédé sa place à « Revenus & paie ».
    if (resetContient_(tout, ['donation', 'succession'])) return 'Impôts & déclarations';
    // Assurance AVANT le rattrapage bancaire (revue : « Desjardins Assurance » partait en Banques).
    if (resetContient_(tout, ['assurance vie', 'prevoyance']) || e.indexOf('assurance') !== -1) return 'Assurances & prévoyance';
    if (resetContient_(tout, ['tether', 'usdt', 'crypto', 'securities', 'boursier', 'bourse de', 'portefeuille'])) return 'Placements & crypto';
    // 'rib' n'est plus une sous-chaîne (revue : ⊂ « contribution »/« distribution ») : type exact.
    if (t === 'rib' || resetContient_(tout, ['coordonnees bancaires', 'releve d identite bancaire', 'chequier']) || t.indexOf('cheque') !== -1) return 'Banques/Coordonnées & chèques';
    if (resetContient_(t, ['recu', 'facture', 'remboursement'])) return 'Reçus & factures/' + resetBucketAnnee_(seg.annee, s['Reçus & factures']);
    if (e.indexOf('desjardins') !== -1) return 'Banques/Desjardins';
    if (e.indexOf('boursorama') !== -1) return 'Banques/Boursorama';
    if (e.indexOf('transatlantique') !== -1) return 'Banques/Banque Transatlantique';
    if (e.indexOf('cic') !== -1 || e.indexOf('credit industriel') !== -1) return 'Banques/CIC'; // même banque, deux graphies (revue)
    if (resetContient_(e, ['societe generale', 'banque de savoie', 'lyonnaise de banque', 'bcque', 'banque 10096'])) return 'Banques/Banques France';
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
    if (resetContient_(tout, ['trieste', 'moreau'])) return 'Logements/Anciens logements'; // stock réel (revue)
    if (resetContient_(tout, ['jetta', 'fiesta'])) return 'Véhicules/Anciens véhicules';
    if (resetContient_(t, ['bail', 'etat des lieux', 'quittance', 'loyer'])) return 'Logements';

    /* ---- AUTO (t4, décision Marc 2026-07-31 sur le reliquat réel) ----
     * Ordre VOULU : ces règles passent APRÈS les règles par entité/logement ci-dessus (un
     * « Contrat_LCP » reste chez LCP) et AVANT les filets « Contrats »/« Correspondance », qui
     * captureraient sinon tout ce qui porte le type « contrat », « devis » ou « correspondance ».
     */
    // Ferroviaire : Marc les veut dans « 08 · Perso & projets/Voyages », ce que le reset NE PEUT PAS
    // faire — il place toujours dans le domaine d'ORIGINE (ici 03). On les laisse donc en `_TRI`,
    // rapportés, plutôt que de les mal ranger : « Recherche-Devis_SNCF » contient « devis » et
    // partirait sinon dans « Contrats ». À lever si le déplacement inter-domaines est décidé.
    if (resetContient_(tout, ['sncf', 'billet de train'])) return null;
    if (resetContient_(t, ['constat d infraction', 'contravention', 'amende'])) return 'Véhicules/Contraventions';
    // RECHERCHE & ACHAT par le TYPE, AVANT l'entretien par l'émetteur : une « Capture
    // d'écran_Drummondville Volkswagen » (stock réel) est de la RECHERCHE chez un concessionnaire,
    // pas une réparation — pour ces artefacts (annonce, capture, comparatif, catalogue), le type
    // dit ce que c'est, l'émetteur dit seulement où ça a été pris.
    if (resetContient_(t, ['annonce', 'capture d ecran', 'comparatif', 'catalogue', 'simulation',
      'information commerciale'])) return 'Véhicules/Recherche & achat';
    // ASSURANCE AUTO — l'habitation est déjà partie plus haut, donc le reste de l'assurance en 03 est
    // automobile. Le contexte « assurance » est EXIGÉ sur le type OU l'émetteur : sans ça,
    // « Réclamation_Virgin » (télécom, dans le stock réel) serait pris pour un sinistre auto.
    // 'insurance'/'igo'/'manuvie' : le courtier écrit en anglais (« IGO Insurance - Manuvie »).
    if (resetContient_(e, ['assurance', 'insurance', 'igo', 'manuvie']) || t.indexOf('assurance') !== -1) return 'Véhicules/Assurance auto';
    // ENTRETIEN & RÉPARATIONS — routage par l'ÉMETTEUR (garage/concession/carrossier), qui est le
    // signal stable : les types varient (facture, devis, estimation, rendez-vous, certificat de
    // garantie) mais l'émetteur reste le même atelier.
    if (resetContient_(e, ['garage', 'carrossier', 'procolor', 'mecanique', 'certi', 'vezin',
      'volkswagen', 'toyota', 'expertise auto', 'yamaha'])) return 'Véhicules/Entretien & réparations';
    // FILETS DE FIN (décision Marc 2026-07-30, sur le reliquat : 18 « Contrat » + 16
    // « Correspondance » sans dossier d'accueil). Placés en DERNIER, APRÈS toutes les règles par
    // entité (Roselière, Rivières, LCP, KIA…) et par type spécifique : un « Contrat_LCP » part donc
    // toujours chez LCP, jamais dans le fourre-tout. Ne capturent que ce qui rendait `null`.
    if (resetContient_(t, ['contrat', 'devis', 'consentement', 'formulaire de demande de location'])) return 'Contrats';
    if (resetContient_(t, ['correspondance', 'lettre', 'courrier', 'avis de sejour', 'mise en demeure'])) return 'Correspondance';
    return null;
  }

  // 04 : routage INTERNE seulement (ADR-0030 §4) — jamais appliqué à un fichier hors de 04, et
  // jamais de sortie : un fichier de 04 non routé reste À SA PLACE (pas dans _TRI).
  if (domaine === '04 · Immigration') {
    if (resetContient_(tout, ['mifi', 'francisation', 'caq', 'certificat d acceptation', 'diversite et de l inclusion'])) return 'MIFI (Québec)';
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
    if (tout.indexOf('archive candidatures') !== -1) return 'Recherche d\'emploi/Archive 2021-2025';
    if (e.indexOf('robovic') !== -1) return 'Employeurs/Robovic';
    if (e.indexOf('automatech') !== -1) return 'Employeurs/Automatech';
    if (resetContient_(e, ['mric', 'm ric'])) return 'Entreprise — MRic (SCI)';
    if (resetContient_(tout, ['alternance', 'stage'])) return 'Alternance & stages';
    if (t.indexOf('bilan') !== -1 || (' ' + t).indexOf(' formation') !== -1) return 'Formation & bilans'; // ' formation' : jamais « information » (revue)
    if (resetContient_(tout, ['linkedin', 'presentation', 'reseau'])) return 'Réseaux & présentations';
    // Décision Marc : les AUTRES entreprises = recherche d'emploi (jamais employeurs).
    if (e === 'ute' || resetContient_(e, ['arkema', 'eaton', 'siemens', 'schneider', 'wiio', 'bluewrist', 'pierre fabre', 'lactalis', 'gravelines', 'cnpe'])) return 'Recherche d\'emploi';
    return null;
  }

  if (domaine === '06 · Études & diplômes') {
    if (resetContient_(t, ['diplome', 'releve de notes', 'bulletin', 'attestation de reussite'])) return 'Diplômes & relevés officiels';
    var ecole = null;
    if (resetContient_(tout, ['therese', 'avila'])) ecole = 'Lycée Thérèse d\'Avila';
    // Le COLLÈGE Gustave Eiffel et le Hubhouse (ULCO-CEL) ne sont PAS la prépa/le DUT (revue) :
    // testés AVANT leurs mots-pièges ('gustave eiffel', 'ulco').
    else if (resetContient_(tout, ['college', 'hubhouse'])) ecole = 'Autres établissements';
    else if (resetContient_(tout, ['gustave eiffel', 'ptsi', 'kholle', ' colles', 'concours avenir', 'tetard', 'le meur', 'salwa', 'parcevaux', 'leroux'])) ecole = 'Prépa Gustave Eiffel (PTSI)';
    else if (resetContient_(tout, ['iut', 'ulco', 'littoral', 'saint omer', 'cote d opale'])) ecole = 'DUT ULCO Saint-Omer';
    else if (tout.indexOf('sherbrooke') !== -1) ecole = 'Cégep de Sherbrooke';
    else if (tout.indexOf('imerir') !== -1) ecole = 'IMERIR';
    else if (resetContient_(tout, ['hamk', 'hame', 'erasmus', 'esiee', 'hei campus', 'limoilou', 'saint hyacinthe', 'hubhouse'])) ecole = 'Autres établissements';
    if (!ecole) return null;
    if (ecole === 'Autres établissements') return ecole; // à plat (rapport → affinage si volume)
    if (t.indexOf('concours') !== -1 && ecole === 'Prépa Gustave Eiffel (PTSI)') return ecole + '/Concours';
    if (resetContient_(t, ['examen', 'devoir surveille', 'controle', 'partiel', 'kholle', 'colles']) || t === 'ds') return ecole + '/Examens & khôlles';
    if (resetContient_(t, ['resultat', 'note', 'evaluation'])) return ecole + '/Résultats';
    if (resetContient_(t, ['certificat de scolarite', 'inscription', 'convention', 'attestation'])) return ecole + '/Administratif';
    if (resetContient_(t, ['cours', 'fiche', 'travaux', 'projet', 'memoire', 'devoir']) || t === 'td' || t === 'tp') return ecole + '/Cours & travaux';
    return ecole; // racine de l'école : mieux que _TRI, l'école est sûre
  }

  if (domaine === '07 · Santé') {
    if (resetContient_(t, ['consultation', 'ordonnance', 'compte rendu'])) return 'Médecins & consultations';
    if (resetContient_(t, ['facture', 'recu'])) return 'Factures & reçus';
    if (resetContient_(t, ['resultat', 'analyse', 'examen', 'radiographie'])) return 'Examens & résultats';
    if (resetContient_(tout, ['medecine scolaire', 'medecine du travail', 'aptitude'])) return 'Médecine scolaire & travail';
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
    // ' chine' : jamais « machine » (revue). Mais normaliserCle_ garde les underscores : un émetteur
    // exact « _Chine.pdf » n'a PAS d'espace devant → l'égalité sur l'émetteur couvre ce cas.
    if (resetContient_(tout, [' chine', 'zhongguo']) || tout.indexOf('chine') === 0 || e === 'chine') return 'Par voyage/Chine';
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

/* =================================================================================================
 * PR2 — CAMPAGNES I/O (C28-33, ADR-0030 §Exécution + §Transition) : rassemblement récursif vers
 * `_TRI 2026/<domaine>`, dédup par empreinte (+ rapport quasi-doublons), placement par
 * `cheminCibleReset_`, réorganisation INTERNE de 04 (CLAUDE.md §2.1b révisé, PR2). Exécution DIRECTE
 * (décision Marc « change tout live », comme ConsolidationExec) : déplacement seul (§2, jamais de
 * suppression), §1 re-vérifiée par mutation, multi-parents jamais déplacés. Patron « campagne bornée
 * reprenable » partout : collecte lecture seule → mutation par lots, garde-temps, plafond/run, budget
 * QUOTIDIEN en ms réelles persistées, tag de convergence (« passe qui ne collecte plus rien »).
 * ================================================================================================= */

/**
 * Le budget QUOTIDIEN d'une phase (`RESET_*_BUDGET_JOUR_MS`) protège le quota RUNTIME des
 * DÉCLENCHEURS (~90 min/j, compte gratuit) — il ne concerne QUE le tick. Une exécution UN-CLIC
 * depuis l'éditeur Apps Script est HORS de ce quota (c'est sa raison d'être, ADR-0030 §Exécution) :
 * lui appliquer le même budget causait DEUX effets pervers (constatés au 1ᵉʳ run réel de Marc,
 * 2026-07-29) — (1) après quelques relances manuelles, Marc était BLOQUÉ jusqu'au lendemain sans
 * qu'aucun quota réel ne soit en cause ; (2) pire, son run manuel CONSOMMAIT le budget du tick, donc
 * l'automatique ne faisait plus rien de la journée : le manuel affamait l'auto. D'où le drapeau
 * `manuel` porté par les 3 phases : ni gaté, ni compté — seul le mur des 6 min de l'exécution
 * manuelle elle-même la borne (garde passé par l'appelant). Le tick, lui, est inchangé.
 */

/** Consommation du budget QUOTIDIEN d'une phase du reset (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourReset_(props, cle, aujourdhui) {
  var brut = String(props.getProperty(cle) || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/** Domaines soumis au rassemblement/placement : tous SAUF 04 (ADR-0030 §4 — jamais rassemblée). PUR. */
function domainesRassemblesReset_() {
  return Object.keys(CONFIG.DOMAINES).concat(CONFIG.DOMAINES_AUTO || [])
    .filter(function (d) { return d !== '04 · Immigration'; });
}

/**
 * Valeur du drapeau de fin du PLACEMENT. Elle porte la VERSION DE TABLE, contrairement aux deux
 * autres phases (revue #227 — BLOQUANT) : le drapeau de phase EST une clé d'idempotence, en gros.
 * Sans la version, il est testé AVANT que les clés par fichier ne soient construites — une fois le
 * placement convergé, bumper `RESET_TABLE_VERSION` ne re-présenterait plus RIEN, en silence, et le
 * seul contournement (bumper `RESET_TAG`) serait DESTRUCTEUR (les clés du rassemblement n'ont pas de
 * version : tout le Drive repartirait dans `_TRI` pour un cycle complet).
 *
 * DISSYMÉTRIE VOULUE : les drapeaux du RASSEMBLEMENT et de 04 ne prennent PAS la version — leurs
 * clés PAR FICHIER n'en portent pas non plus, et l'y ajouter relancerait un rassemblement complet.
 * Seul le placement dépend de la table de routage, donc seul son drapeau la suit.
 *
 * EFFET DE BORD ASSUMÉ d'un bump : `resetTermine_()` repasse à faux ⇒ conso-2, réorg auto,
 * historique Gmail et réconciliation Index sont RE-SUSPENDUS le temps de la re-convergence
 * (« une seule main déplace à la fois », ADR-0030 « Transition »). C'est une décision, pas une
 * surprise : re-trancher le reliquat coûte une courte pause aux campagnes de fond.
 */
function finPlacementReset_() {
  return CONFIG.RESET_TAG + '|' + CONFIG.RESET_TABLE_VERSION;
}

/** Vrai si TOUTES les phases du reset sont terminées pour le tag (et la version, côté placement). */
function resetTermine_() {
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  return props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag &&
    props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_() &&
    props.getProperty('DriveAI_RESET_04') === tag;
}

/**
 * Vrai si le reset est EN COURS (ADR-0030 « Transition ») : conso-2 (génération + exécution) et la
 * réorg auto C28-32 doivent alors être SUSPENDUES — une seule main déplace à la fois, sinon le flux
 * concurrent re-remplit ce que le reset vide (non-convergence structurelle, leçon §7 C28-26). Le
 * flux VIVANT n'est JAMAIS suspendu (garde-fou §2.6) — seules les CAMPAGNES le sont. `RESET_ACTIF:
 * false` (suspension manuelle par Marc) libère IMMÉDIATEMENT conso-2/réorg-auto.
 */
function resetEnCours_() {
  return !!CONFIG.RESET_ACTIF && !resetTermine_();
}

/* ---------- Rassemblement : domaines 01-09 (04 exclu) → `_TRI 2026/<domaine>` ---------- */

/** Renvoie (ou crée) la racine `_TRI 2026`, à côté de `_Doublons`/`_Technique` (racine DriveAI). */
function dossierTriReset_() {
  return dossierRacineParNom_(CONFIG.RESET_TRI_NOM, 'DriveAI_TRI_ID');
}

/** Renvoie (ou crée) le sous-dossier de provenance d'un domaine sous `_TRI 2026`. */
function dossierTriDomaineReset_(domaine) {
  return sousDossier_(dossierTriReset_(), domaine);
}

/**
 * Mémoïsation PAR RUN des dossiers résolus par domaine (revue #229) : `dossierTriDomaineReset_` et
 * `DriveApp.getFolderById(idDomaine_(…))` coûtent 2 appels Drive et étaient refaits POUR CHAQUE
 * FICHIER, alors qu'il y a ≤ 9 domaines. Sans cache disponible (`ctx` absent), retombe sur l'appel
 * direct — jamais un changement de comportement, seulement moins d'allers-retours.
 * @param {string} domaine
 * @param {Object} ctx
 * @param {boolean} [tri]  vrai = dossier de provenance sous `_TRI 2026` ; faux = racine du domaine
 */
function dossierDomaineMemo_(domaine, ctx, tri) {
  var cle = (tri ? 'tri:' : 'dom:') + domaine;
  if (ctx && ctx.dossiersDomaine && ctx.dossiersDomaine[cle]) return ctx.dossiersDomaine[cle];
  var d = tri ? dossierTriDomaineReset_(domaine) : DriveApp.getFolderById(idDomaine_(domaine));
  if (ctx) {
    if (!ctx.dossiersDomaine) ctx.dossiersDomaine = {};
    ctx.dossiersDomaine[cle] = d;
  }
  return d;
}

/**
 * Collecte récursive des fichiers d'un domaine ENCORE à rassembler (clé `tri33|<tag>|id` absente —
 * prédicat de convergence, filtré À LA COLLECTE : un mur de déjà-faits n'occupe aucune place de
 * page). Lecture seule, bornée par `max` et le garde-temps. `etat.complet` passe à false dès que le
 * walk s'arrête AVANT la fin de l'arbre (garde ou page pleine) — seule une passe entièrement
 * parcourue peut déclarer la campagne terminée (patron `collecterConsolidation_`).
 */
function collecterRassemblementReset_(dossier, ids, max, estBudgetDepasse, tag, etat) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      if (estExcluDuReset_(f.getName())) continue;
      if (indexContient_('epingle|' + f.getId())) continue; // épinglé par Marc (chat) → immunisé (ADR-0026 ; les autres campagnes le testent déjà)
      if (indexContient_('tri33|' + tag + '|' + f.getId())) continue;
      ids.push(f.getId());
    } catch (e) {
      etat.complet = false;
      journalErreur_('Reset', 'Fichier ignoré à la collecte du rassemblement (' + e + ')');
    }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try { collecterRassemblementReset_(fo.next(), ids, max, estBudgetDepasse, tag, etat); }
    catch (e) { etat.complet = false; journalErreur_('Reset', 'Sous-dossier ignoré à la collecte (' + e + ')'); }
  }
}

/**
 * Déplace UN fichier depuis un domaine vers `_TRI 2026/<domaine>`. §1 STRICT re-vérifiée juste avant
 * (échec-fermé — un fichier PARTAGÉ collecté hors 04 peut avoir un second parent sous 04) : abstention
 * si indéterminable. MULTI-PARENTS jamais déplacé (prudence, patron ConsolidationExec — `moveTo`-style
 * détacherait tous les autres parents). Clé `tri33|<tag>|id` posée APRÈS le déplacement (ordre des
 * écritures d'état) — le domaine d'ORIGINE est en métadonnée (jamais le contenu, ADR-0007) : la phase
 * de PLACEMENT le lit directement via le sous-dossier `_TRI 2026/<domaine>` parcouru, pas l'Index.
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call (faux si déjà en place, protégé ou multi-parents).
 */
function rassemblerUnFichier_(fileId, domaine, tag, proteges, ctx) {
  var cle = 'tri33|' + tag + '|' + fileId;
  if (indexContient_(cle)) return false; // déjà rassemblé (rejeu)
  var f;
  try { f = DriveApp.getFileById(fileId); }
  catch (e) {
    indexAjouter_(cle, { statut: 'tri33-absent', nom: fileId, domaine: domaine, chemin: '' }, '');
    return false;
  }
  var nom = f.getName();
  if (aParentProtege_(f, proteges, true)) {
    journalInfo_('Reset', 'Fichier en zone protégée ignoré au rassemblement (non déplacé) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-protege', nom: nom, domaine: domaine, chemin: '' }, '');
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('Reset', 'Multi-parents, jamais déplacé au rassemblement : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-multiparents', nom: nom, domaine: domaine, chemin: '' }, '');
    return false;
  }

  var cible = dossierDomaineMemo_(domaine, ctx, true);
  var cibleId = cible.getId();
  var ancienParent = null;
  try { var parents = f.getParents(); if (parents.hasNext()) ancienParent = parents.next(); } catch (e) { ancienParent = null; }

  var deplace = false;
  if (!(ancienParent && ancienParent.getId() === cibleId)) {
    cible.addFile(f); // ajoute la cible AVANT de retirer (jamais orphelin)
    if (ancienParent) {
      try { ancienParent.removeFile(f); }
      catch (e) { journalErreur_('Reset', 'Retrait de l\'ancien parent impossible (' + nom + ') : ' + e); }
    }
    deplace = true;
  }
  indexAjouter_(cle, { statut: 'tri33-rassemble', nom: nom, domaine: domaine, chemin: CONFIG.RESET_TRI_NOM + '/' + domaine }, '');
  if (ancienParent && ancienParent.getId() !== cibleId) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide (rassemblement) différée : ' + e); }
  }
  return deplace;
}

/**
 * Échec de MUTATION Drive pendant le reset (rassemblement/placement). Sans ce compteur, un fichier
 * qui lève SYSTÉMATIQUEMENT à `addFile`/`removeFile` (permission d'un tiers, blip Drive prolongé)
 * était RE-COLLECTÉ à chaque passe — sa clé de succès n'étant jamais posée : le reset ne convergeait
 * JAMAIS, `resetTermine_()` restait faux, et toutes les campagnes gatées `!resetEnCours_()` (histo
 * Gmail, migration, réanalyse, conso, réconciliation) demeuraient suspendues À VIE, heartbeat vert
 * (revue de fond 2026-07-31). Ici on COMPTE l'échec (onglet Échecs, patron `gererEchec_`) et, au-delà
 * de `QUARANTAINE_MAX`, on inscrit la clé (même clé que le succès aurait posée) avec un statut
 * d'écart → la collecte le skippe → convergence. Récupérable : un bump de `RESET_TAG` (rassemblement)
 * ou de `RESET_TABLE_VERSION` (placement) le re-présente. PAS de garde panne-plateforme (un échec
 * `addFile` Drive n'est pas une panne de compte LLM — sinon une panne LLM figerait la convergence I/O).
 *
 * `tentes` (leçon §7, revue Vague 1b) : compter PAR PASSE, jamais PAR RE-RENCONTRE. Sous le pilote /
 * les un-clic, un même fichier est re-collecté à CHAQUE ronde (sa clé n'est posée qu'à l'écart) — sans
 * cette mémoire d'exécution, un blip Drive TRANSITOIRE brûlerait ses 3 essais en quelques secondes
 * (écart à tort). Avec `tentes`, l'incrément est plafonné à 1 par exécution → atteindre `QUARANTAINE_MAX`
 * exige 3 exécutions distinctes (ticks/invocations espacés). Le tick (1 passe/tick) est déjà correct.
 */
function ecarterEchecMutationReset_(cle, nom, message, tentes) {
  if (tentes) {
    if (tentes[cle]) { journalErreur_('Reset', 'Échec mutation reset (déjà compté cette exécution, ' + (nom || '?') + ') : ' + message); return; }
    tentes[cle] = true;
  }
  var n = incrementerEchec_(cle);
  if (n >= CONFIG.QUARANTAINE_MAX) {
    indexAjouter_(cle, { statut: 'tri33-ecart', domaine: '', chemin: '', nom: nom || '' });
    journalErreur_('Reset', 'Fichier écarté du reset après ' + n + ' échecs de mutation (' + (nom || '?') + ') : ' + message);
  } else {
    journalErreur_('Reset', 'Échec mutation reset ' + n + '/' + CONFIG.QUARANTAINE_MAX + ' (' + (nom || '?') + ') : ' + message);
  }
}

/** UNE passe bornée de rassemblement (tous domaines confondus). @return {{examines, deplaces, complet}} */
function rassemblerUnePageReset_(estBudgetDepasse, proteges, ctx, tentes) {
  var tag = CONFIG.RESET_TAG;
  var domaines = domainesRassemblesReset_();
  var ids = []; // [{id, domaine}]
  var etat = { complet: true };
  for (var i = 0; i < domaines.length; i++) {
    if (estBudgetDepasse() || ids.length >= CONFIG.RESET_RASSEMBLEMENT_MAX_PAR_RUN) { etat.complet = false; break; }
    var dom = domaines[i];
    var racine;
    try { racine = DriveApp.getFolderById(idDomaine_(dom)); }
    catch (e) {
      journalErreur_('Reset', 'Domaine illisible au rassemblement (' + dom + ') : ' + e);
      etat.complet = false;
      continue;
    }
    var idsDom = [];
    collecterRassemblementReset_(racine, idsDom, CONFIG.RESET_RASSEMBLEMENT_MAX_PAR_RUN - ids.length, estBudgetDepasse, tag, etat);
    for (var j = 0; j < idsDom.length; j++) ids.push({ id: idsDom[j], domaine: dom });
  }
  var deplaces = 0;
  for (var k = 0; k < ids.length; k++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    try { if (rassemblerUnFichier_(ids[k].id, ids[k].domaine, tag, proteges, ctx)) deplaces++; }
    catch (e) {
      etat.complet = false;
      // Compté + écarté après N échecs : sinon ce fichier bloquerait la convergence du reset À VIE.
      ecarterEchecMutationReset_('tri33|' + tag + '|' + ids[k].id, ids[k].id, String(e), tentes);
    }
  }
  return { examines: ids.length, deplaces: deplaces, complet: etat.complet };
}

/**
 * ÉTAPE DE TICK : rassemblement, gatée flag + budgets (run + quotidien en ms réelles).
 * @param {function():boolean} estBudgetDepasse
 * @param {boolean} [manuel]  exécution UN-CLIC depuis l'éditeur — voir le bloc « budget QUOTIDIEN
 *   vs exécution UN-CLIC » en tête de section (ni gaté, ni compté).
 * @return {?{examines:number, deplaces:number, complet:boolean}} résultat de la passe (null si la
 *   phase n'a rien tenté) — l'appelant UN-CLIC s'arrête sur une ronde stérile.
 */
function rassemblerReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  if (props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag) return; // déjà terminé pour ce tag
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_RASS_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS) return; // repris demain

  // `tentes` (leçon §7) : mémoire des échecs de mutation PAR EXÉCUTION. Fourni par le pilote/un-clic
  // (partagé entre rondes) ; en tick (1 passe) un local frais suffit.
  tentes = tentes || {};
  var debut = Date.now();
  // En MANUEL, seul le garde de l'appelant (mur 6 min de SON exécution) borne le run.
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS - consommeJour, 3 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var proteges = ensembleDomainesProteges_();
    var ctx = { proteges: proteges };
    var r = rassemblerUnePageReset_(garde, proteges, ctx, tentes);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) rassemblé(s) vers ' + CONFIG.RESET_TRI_NOM + ' (reset).');
    if (r.complet && r.examines === 0) {
      props.setProperty('DriveAI_RESET_RASSEMBLEMENT', tag);
      journalInfo_('Reset', 'Rassemblement TERMINÉ (tag « ' + tag + ' ») — plus rien à déplacer vers ' + CONFIG.RESET_TRI_NOM + '.');
    }
    return r; // l'appelant UN-CLIC s'arrête sur une ronde STÉRILE (revue quota : anti-spin)
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_RASS_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Placement : dédup + routage depuis `_TRI 2026/<domaine>` ---------- */

/**
 * Inscrit (DÉDUPLIQUÉ) une ligne au rapport `Reset` — même patron que `inscrireDossierVideCandidat_`
 * (ConsolidationExec.gs) : le set des clés existantes est chargé UNE fois par run (lazy, sur `ctx`).
 * Colonnes : Clé | Type | Nom | Domaine | Cible | Statut | Détail | Horodaté.
 */
function inscrireLigneReset_(cle, type, nom, domaine, cible, statut, detail, ctx) {
  var feuille = feuille_('Reset');
  if (!ctx.lignesConnues) {
    ctx.lignesConnues = {};
    var dern = feuille.getLastRow();
    var cles = dern >= 1 ? feuille.getRange(1, 1, dern, 1).getValues() : [];
    for (var i = 0; i < cles.length; i++) {
      var k = String(cles[i][0]);
      if (k) ctx.lignesConnues[k] = true;
    }
  }
  if (ctx.lignesConnues[cle]) return;
  feuille.appendRow([cle, type, nom, domaine, cible, statut, detail, new Date().toISOString()]);
  ctx.lignesConnues[cle] = true;
}

/**
 * QUASI-doublon probable (même nom NORMALISÉ, taille DIFFÉRENTE — hors de portée du hash exact,
 * ADR-0030 §2) : jamais déplacé, RAPPORT seul, tranché par Marc. Comparaison bornée au MÊME domaine
 * d'origine (deux homonymes de domaines différents ne sont pas nécessairement liés). Mémoire de
 * campagne (`ctx.taillesVues`, ce run) — best-effort, jamais une preuve ; le hash exact reste la
 * SEULE dédup qui déplace un fichier.
 *
 * `hashee` (revue code C28-33) : une taille IDENTIQUE ne prouve « déjà couvert par le hash » que si
 * LES DEUX fichiers comparés ont RÉELLEMENT été hashés (`empreinteBlob_` n'est jamais appelée
 * au-delà de `CONFIG.OCR_TAILLE_MAX`, cf. `placerUnFichierReset_`) — sinon, deux gros fichiers
 * homonymes de même taille mais de contenu DIFFÉRENT passeraient inaperçus des deux dédups (ni le
 * hash exact, jamais calculé, ni ce rapport, court-circuité à tort par l'égalité de taille seule).
 */
function signalerQuasiDoublonReset_(nom, taille, hashee, fileId, domaine, ctx) {
  var cleTaille = domaine + '|' + normaliserCle_(nom);
  if (!ctx.taillesVues) ctx.taillesVues = {};
  var vu = ctx.taillesVues[cleTaille];
  if (vu === undefined) { ctx.taillesVues[cleTaille] = { taille: taille, hashee: hashee }; return; }
  if (vu.taille === taille && vu.hashee && hashee) return; // tailles égales ET LES DEUX hashées → déjà couvert
  // Clé VERSIONNÉE (revue #227) : sans la version, un cas résolu par un affinage de table garderait
  // sa ligne « à trancher » à vie et le rapport que Marc lit surévaluerait le reliquat.
  inscrireLigneReset_('quasidoublon|' + CONFIG.RESET_TABLE_VERSION + '|' + fileId, 'quasi-doublon', nom, domaine, '', 'doublon-probable',
    'même nom, taille ' + (vu.taille === taille ? 'identique mais NON confirmée par hash' : 'différente') +
    ' (' + taille + ' vs ' + vu.taille + ' octets)', ctx);
}

/** Fichier NON ROUTÉ (ADR-0030 §3) : reste dans `_TRI`, RAPPORTÉ — jamais deviné. */
function signalerNonRouteReset_(nom, fileId, domaine, ctx) {
  // Clé VERSIONNÉE (revue #227) : chaque version de table produit son instantané HONNÊTE du
  // reliquat. Sans ça, un fichier non routé en t1 puis correctement placé en t2 resterait affiché
  // « aucune règle ne matche » — on écrirait des règles t3 pour des cas déjà résolus.
  inscrireLigneReset_('nonroute|' + CONFIG.RESET_TABLE_VERSION + '|' + fileId, 'non-routé', nom, domaine, CONFIG.RESET_TRI_NOM + '/' + domaine,
    'reste en _TRI', 'aucune règle de STRUCTURE_CIBLE_RESET ne matche ce nom — affiner la table ou décision Marc', ctx);
}

/**
 * Empreinte du fichier SANS re-télécharger ses octets quand elle est DÉJÀ connue — d'abord le plan de
 * consolidation (`ctx.empreintesConnues`, lu une fois par run), puis l'Index (`empreinteConnueParId_`,
 * qui couvre le flux vivant `drive|…` ET les placements d'une version de table précédente : bumper
 * `RESET_TABLE_VERSION` ne re-hashe donc RIEN). `empreinteBlob_` reste le SEUL producteur : toute
 * valeur réutilisée en vient, la sémantique de dédup est inchangée (revue #229).
 *
 * Borne de taille PROPRE au reset (`RESET_HASH_TAILLE_MAX`, 5 Mo) et non `OCR_TAILLE_MAX` (20 Mo) :
 * hasher 20 Mo coûte 10-60 s et peut franchir le mur des 6 min sur le dernier item d'un run. Au-delà,
 * empreinte vide ⇒ jamais déplacé comme doublon, mais `signalerQuasiDoublonReset_` le RAPPORTE (le
 * flag `hashee` transmet honnêtement « non hashé », donc aucun cas n'est court-circuité à tort).
 */
function empreinteReutiliseeReset_(f, ctx) {
  // 🔴 EXCLUSION des fichiers Google NATIFS (revue sécurité #229) — sans elle, ce commit enverrait
  // des ORIGINAUX dans `_Doublons`. Pour un natif, l'empreinte inscrite à l'Index par l'intake N'EST
  // PAS le hash du fichier : `Intake.gs` hashe le TEXTE EXPORTÉ (`Utilities.newBlob(texte, …)`).
  // L'intake le sait — c'est la raison d'être de son flag `ignorerDoublon` (« deux exports vides
  // partagent le même MD5 ») — mais ce flag NE SURVIT PAS dans l'Index. Deux Sheets quasi vides y
  // portent donc le même MD5 : réutilisée ici, cette valeur ferait partir le second en `_Doublons`.
  // On ne hashe pas non plus le blob d'un natif (export PDF : deux documents vides peuvent
  // coïncider, et `getSize()` vaut 0 donc la borne de taille ne protège rien). Empreinte vide ⇒
  // JAMAIS déplacé comme doublon — le sens sûr ; le quasi-doublon reste RAPPORTÉ par le nom.
  // Illisible ⇒ traité comme natif (échec-fermé : on s'abstient plutôt que de risquer un déplacement).
  var mime;
  try { mime = String(f.getMimeType() || ''); } catch (e) { return ''; }
  if (mime.indexOf('application/vnd.google-apps') === 0) return '';

  var id = f.getId();
  var connue = (ctx && ctx.empreintesConnues && ctx.empreintesConnues[id]) || empreinteConnueParId_(id);
  if (connue) return String(connue);
  try { if (f.getSize() <= CONFIG.RESET_HASH_TAILLE_MAX) return empreinteBlob_(f.getBlob()); }
  catch (e) { return ''; }
  return '';
}

/**
 * Résout (find-or-create) le dossier cible d'un sous-chemin STRUCTUREL (`cheminCibleReset_`) sous un
 * domaine. Quand le DERNIER segment correspond à une ENTITÉ VALIDÉE de ce domaine (ex. « Desjardins »,
 * « Robovic ») dont le `Dossier ID` pointait encore l'ANCIEN emplacement, celui-ci est RE-POINTÉ vers
 * le nouveau dossier (ADR-0030 « Transition » — sinon le flux vivant router route vers un dossier
 * mort/vide dès le tick suivant, ADR-0028). Réutilise `repointerEntites_` (Reorg.gs, déjà testé pour
 * la fusion) ; `ctx.repointes` déduplique les écritures Sheet redondantes dans le run.
 */
function resoudreCibleReset_(domaineDossier, domaine, sousChemin, ctx) {
  // Mémoïsation par run (revue #229) : `sousDossier_` fait 1-2 appels Drive PAR SEGMENT, refaits pour
  // chaque fichier alors qu'il n'y a que quelques dizaines de chemins cibles distincts. Le re-pointage
  // ci-dessous est déjà idempotent par `ctx.repointes` ; le sauter sur un chemin déjà résolu est donc
  // sans effet de bord.
  var cleMemo = domaine + '/' + sousChemin;
  if (ctx.ciblesResolues && ctx.ciblesResolues[cleMemo]) return ctx.ciblesResolues[cleMemo];

  var segments = sousChemin.split('/');
  var dossier = domaineDossier;
  for (var i = 0; i < segments.length; i++) dossier = sousDossier_(dossier, segments[i]);
  if (ctx.ciblesResolues) ctx.ciblesResolues[cleMemo] = dossier;

  var dernier = segments[segments.length - 1];
  var cle = cleCanoniqueEntite_(domaine, dernier);
  if (cle && ctx.validees && ctx.validees[cle] && ctx.validees[cle].dossierId &&
      ctx.validees[cle].dossierId !== dossier.getId() && !ctx.repointes[ctx.validees[cle].dossierId]) {
    try {
      repointerEntites_(ctx.validees[cle].dossierId, dossier.getId());
      ctx.repointes[ctx.validees[cle].dossierId] = true;
    } catch (e) { journalErreur_('Reset', 'Re-pointage d\'entité différé (' + dernier + ') : ' + e); }
  }
  return dossier;
}

/**
 * Traite UN fichier de `_TRI 2026/<domaine>` : §1 RE-VÉRIFIÉE STRICTE (échec-fermé) + multi-parents
 * EXCLUS (revue sécurité C28-33 : le rassemblement et le placement sont deux campagnes SÉPARÉES,
 * bornées chacune par son propre budget quotidien — un fichier peut donc attendre des JOURS dans
 * `_TRI` avant d'être placé ; pendant cette fenêtre, un geste Drive normal de Marc (« Ajouter à un
 * dossier ») peut lui donner un second parent sous 04 · Immigration. Sans cette re-vérification, un
 * `removeFile` sur le mauvais parent détacherait le fichier de la zone protégée — même garde que
 * `rassemblerUnFichier_`/`reorganiserInterne04_`, jamais une exception de phase), PUIS dédup par
 * empreinte (campagne, seedée depuis `empreintesPlanConsolidation_` — réutilisation des empreintes
 * déjà connues de conso-2), PUIS routage PAR LE NOM (`cheminCibleReset_`, zéro LLM). Doublon EXACT →
 * `_Doublons` (déplacement seul, §2). Non routé (null) → reste dans `_TRI`, rapporté. Clé
 * `tri33p|<tag>|<versionTable>|id` posée dans TOUS les cas (convergence : un fichier non-routé n'est
 * jamais re-hashé à chaque run) — la VERSION DE TABLE en fait partie pour que l'affinage des règles
 * puisse re-tenter le reliquat, cf. `CONFIG.RESET_TABLE_VERSION`.
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call.
 */
function placerUnFichierReset_(f, domaine, cle, ctx) {
  var nom = f.getName();
  var cheminTri = CONFIG.RESET_TRI_NOM + '/' + domaine;
  if (aParentProtege_(f, ctx.proteges, true)) {
    journalInfo_('Reset', 'Fichier en zone protégée ignoré au placement (non déplacé) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33p-protege', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('Reset', 'Multi-parents, jamais déplacé au placement : ' + nom);
    indexAjouter_(cle, { statut: 'tri33p-multiparents', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    return false;
  }

  var statut = 'tri33-reste';
  var cheminFinal = cheminTri;
  var ancienParent = null;
  try { var pp = f.getParents(); if (pp.hasNext()) ancienParent = pp.next(); } catch (e) { ancienParent = null; }

  var empreinte = empreinteReutiliseeReset_(f, ctx);

  var doublonDe = (empreinte && ctx.empreintesVues[empreinte] && ctx.empreintesVues[empreinte] !== f.getId())
    ? ctx.empreintesVues[empreinte] : null;
  if (empreinte && !ctx.empreintesVues[empreinte]) ctx.empreintesVues[empreinte] = f.getId();

  var cibleDossier = null;
  if (doublonDe) {
    cibleDossier = dossierDoublons_();
    statut = 'tri33-doublon';
    cheminFinal = '_Doublons';
  } else {
    signalerQuasiDoublonReset_(nom, f.getSize(), !!empreinte, f.getId(), domaine, ctx);
    var sousChemin = cheminCibleReset_(domaine, nom);
    if (sousChemin) {
      cibleDossier = resoudreCibleReset_(dossierDomaineMemo_(domaine, ctx), domaine, sousChemin, ctx);
      statut = 'tri33-route';
      cheminFinal = domaine + '/' + sousChemin;
    } else {
      signalerNonRouteReset_(nom, f.getId(), domaine, ctx);
    }
  }

  var deplace = false;
  if (cibleDossier) {
    var cibleId = cibleDossier.getId();
    if (!(ancienParent && ancienParent.getId() === cibleId)) {
      cibleDossier.addFile(f);
      if (ancienParent) {
        try { ancienParent.removeFile(f); }
        catch (e) { journalErreur_('Reset', 'Retrait ancien parent (placement) impossible (' + nom + ') : ' + e); }
      }
      deplace = true;
    }
  }
  indexAjouter_(cle, { statut: statut, nom: nom, domaine: domaine, chemin: cheminFinal }, empreinte);
  if (ancienParent && cibleDossier && ancienParent.getId() !== cibleDossier.getId()) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide (placement) différée : ' + e); }
  }
  return deplace;
}

/** UNE passe bornée de placement (tous domaines confondus). @return {{examines, deplaces, complet}} */
function placerUnePageReset_(estBudgetDepasse, ctx, tentes) {
  var tag = CONFIG.RESET_TAG;
  var racine = dossierTriReset_();
  var domaines = domainesRassemblesReset_();
  var examines = 0, deplaces = 0, complet = true;
  for (var i = 0; i < domaines.length; i++) {
    if (estBudgetDepasse() || examines >= CONFIG.RESET_PLACEMENT_MAX_PAR_RUN) { complet = false; break; }
    var dom = domaines[i];
    var sousTri;
    try { sousTri = racine.getFoldersByName(dom); }
    catch (e) { complet = false; continue; }
    if (!sousTri.hasNext()) continue; // rien rassemblé pour ce domaine (ou déjà entièrement placé)
    var dossierDom = sousTri.next();
    var fi;
    try { fi = dossierDom.getFiles(); } catch (e) { complet = false; continue; }
    while (fi.hasNext()) {
      if (estBudgetDepasse() || examines >= CONFIG.RESET_PLACEMENT_MAX_PAR_RUN) { complet = false; break; }
      var f;
      try { f = fi.next(); } catch (e) { complet = false; break; }
      // La VERSION DE TABLE entre dans la clé : bumper `RESET_TABLE_VERSION` re-tente le placement
      // du RELIQUAT après un affinage des règles. Sans risque de défaire le travail fait : la
      // collecte n'itère QUE sur `_TRI 2026/<domaine>` — un fichier déjà placé n'y est plus, donc
      // il n'est jamais re-présenté, quelle que soit la version.
      var cle = 'tri33p|' + tag + '|' + CONFIG.RESET_TABLE_VERSION + '|' + f.getId();
      if (indexContient_(cle)) continue; // déjà tenté — gratuit, n'occupe pas la page
      examines++;
      try { if (placerUnFichierReset_(f, dom, cle, ctx)) deplaces++; }
      catch (e) {
        complet = false;
        var nomEch = ''; try { nomEch = f.getName(); } catch (e2) { /* nom best-effort */ }
        ecarterEchecMutationReset_(cle, nomEch, String(e), tentes); // sinon re-collecté à vie → placement jamais fini
      }
    }
  }
  return { examines: examines, deplaces: deplaces, complet: complet };
}

/**
 * ÉTAPE DE TICK : placement, gatée flag + budgets. « Terminé » posé UNIQUEMENT si le rassemblement
 * l'est AUSSI pour ce tag (patron `appliquerPlanConsolidation_` — l'exécution ne peut pas se figer
 * « fini » tant que la génération peut encore alimenter la file, sinon de nouveaux fichiers rassemblés
 * plus tard ne seraient plus jamais placés).
 */
function placerReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  // Drapeau VERSIONNÉ (cf. finPlacementReset_) : un bump de table RÉ-OUVRE la phase, sinon le
  // mécanisme de version serait neutralisé ici, avant même la construction des clés par fichier.
  if (props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_()) return;
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_PLACE_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_PLACEMENT_BUDGET_JOUR_MS) return;

  tentes = tentes || {}; // mémoire des échecs de mutation par exécution (leçon §7 ; cf. rassemblerReset_)
  var debut = Date.now();
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_PLACEMENT_BUDGET_JOUR_MS - consommeJour, 3 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var plan = empreintesPlanDeuxSens_(); // UNE lecture → les deux sens (revue #229)
    var ctx = {
      proteges: ensembleDomainesProteges_(),
      validees: entitesValideesParCle_(),
      empreintesVues: plan.parEmpreinte,   // empreinte → 1er porteur (dédup)
      empreintesConnues: plan.parId,       // fileId → empreinte (ne PAS re-télécharger les octets)
      repointes: {},
      ciblesResolues: {},                  // sous-chemin → dossier (mémoïsation, cf. resoudreCibleReset_)
    };
    var r = placerUnePageReset_(garde, ctx, tentes);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) traité(s) au placement (reset).');
    if (r.complet && r.examines === 0) {
      if (props.getProperty('DriveAI_RESET_RASSEMBLEMENT') === tag) {
        props.setProperty('DriveAI_RESET_PLACEMENT', finPlacementReset_());
        journalInfo_('Reset', 'Placement TERMINÉ (' + finPlacementReset_() + ') — rassemblement également fini.');
      } else {
        // État STABLE « oisif mais tag impossible » (le placement ne se fige qu'après le
        // rassemblement) : c'est exactement le cas où une boucle un-clic spinnerait à vide — d'où
        // la sortie sur ronde stérile côté appelant (le `return r` ci-dessous).
        journalInfo_('Reset', 'Placement à jour pour cette passe — rassemblement encore en cours, repris au tick suivant.');
      }
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_PLACE_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Passe LLM du RELIQUAT (ADR-0030 PR5, décision Marc 2026-07-31) ---------- */

/**
 * Analyse UN fichier du reliquat par le PIPELINE COMPLET (patron `reanalyserFichier_`, C26-08) :
 * OCR → analyse v2 → routage v2 → fail-safe ADR-0016 → renommage conventionnel. Les 3 verrous du
 * re-traitement (leçon §7) : clé de campagne dédiée (posée par `traiterDocument_` sous `cle`),
 * `ignorerDoublon: true` (le placement a écrit l'empreinte à l'Index — sans bypass, « doublon de
 * lui-même » → tout partirait en `_Doublons`), placement DIRECT (`deplacerEtRenommer_`, jamais de
 * transit par `00 · À trier`). Gardes de mutation IDENTIQUES au placement : zone protégée re-vérifiée
 * ici (fenêtre multi-jours dans `_TRI`), multi-parents jamais déplacé.
 * @return {boolean} vrai si le pipeline a été invoqué.
 */
function analyserFichierReliquat_(f, domaine, nom, cle, proteges) {
  var cheminTri = CONFIG.RESET_TRI_NOM + '/' + domaine;
  if (aParentProtege_(f, proteges, true)) { // STRICT : abstention si indéterminable (jamais détacher, §1)
    indexAjouter_(cle, { statut: 'tri33llm-protege', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    journalInfo_('Reset', 'Reliquat en zone protégée ignoré (non touché) : ' + nom);
    return false;
  }
  if (nbParentsBorne_(f) > 1) {
    indexAjouter_(cle, { statut: 'tri33llm-multiparents', nom: nom, domaine: domaine, chemin: cheminTri }, '');
    journalInfo_('Reset', 'Reliquat multi-parents, jamais déplacé : ' + nom);
    return false;
  }
  var fileId, parentId, taille, date;
  try {
    // TOUTES les lectures de métadonnées dans le try : un fichier devenu illisible entre la collecte
    // et ici est mis en quarantaine (compteur d'échecs), jamais re-collecté à vie ni bloquant.
    fileId = f.getId();
    var parents = f.getParents();
    parentId = parents.hasNext() ? parents.next().getId() : '';
    taille = f.getSize();
    date = f.getLastUpdated();
  } catch (e) {
    gererEchec_({ cle: cle, nom: nom || 'reliquat' }, 'document illisible (reliquat reset) : ' + e);
    return false;
  }
  var blobMemo = null;
  function blobUneFois_() {
    if (blobMemo === null) blobMemo = f.getBlob();
    return blobMemo;
  }
  traiterDocument_({
    cle: cle,
    nom: nom,
    taille: taille,
    expediteur: '',
    sujet: 'Reliquat reset (ADR-0030 PR5)',
    date: date,
    ignorerDoublon: true, // son empreinte est déjà à l'Index (écrite au placement) — pas « doublon de lui-même »
    blob: blobUneFois_,
    placer: function (dossierId, nouveauNom) {
      if (dossierId === parentId) return renommer_(fileId, nouveauNom) ? fileId : ''; // déjà au bon endroit
      return deplacerEtRenommer_(fileId, dossierId, parentId, nouveauNom) ? fileId : '';
    }
  });
  return true;
}

/**
 * UNE passe bornée sur le reliquat : les fichiers de `_TRI 2026/<domaine>` que la TABLE ne route
 * PAS (`cheminCibleReset_` null — prédicat PUR, gratuit ; un routable est laissé au PLACEMENT,
 * beaucoup moins cher). Convergence : un fichier traité SORT de `_TRI` (classé, `_Technique`,
 * `_Médias` ou `00 · À vérifier` par le fail-safe) → jamais re-collecté ; les gardes (protégé,
 * multi-parents) posent une clé VERSIONNÉE — un affinage de table les re-tente, jamais le déjà-sorti.
 * @return {{examines:number, complet:boolean}}
 */
function analyserPageReliquatReset_(garde, proteges, tentes) {
  var tag = CONFIG.RESET_TAG;
  var racine = dossierTriReset_();
  var domaines = domainesRassemblesReset_();
  var examines = 0, complet = true;
  for (var i = 0; i < domaines.length; i++) {
    if (garde() || examines >= CONFIG.RESET_LLM_MAX_PAR_RUN) { complet = false; break; }
    var dom = domaines[i];
    var sousTri;
    try { sousTri = racine.getFoldersByName(dom); }
    catch (e) { complet = false; continue; }
    if (!sousTri.hasNext()) continue;
    var fi;
    try { fi = sousTri.next().getFiles(); } catch (e) { complet = false; continue; }
    while (fi.hasNext()) {
      if (garde() || examines >= CONFIG.RESET_LLM_MAX_PAR_RUN) { complet = false; break; }
      var f;
      try { f = fi.next(); } catch (e) { complet = false; break; }
      var nom = '', fid = '';
      // Nom ET id dans le même try : un fichier devenu illisible ici ne doit jamais avorter la page.
      try { nom = f.getName(); fid = f.getId(); } catch (e) { complet = false; continue; }
      if (cheminCibleReset_(dom, nom)) continue; // routable par la table → au placement, jamais au LLM
      var cle = 'tri33llm|' + tag + '|' + CONFIG.RESET_TABLE_VERSION + '|' + fid;
      if (indexContient_(cle)) continue; // déjà tenté (garde) — gratuit, n'occupe pas la page
      // Déjà tenté dans CETTE exécution (pilote CI) : un échec transitoire ne doit pas consommer ses
      // 3 essais en quelques minutes (quarantaine définitive, sans chemin de retour pour `tri33llm|`).
      // Les essais suivants auront lieu aux passes SUIVANTES, espacées — leçon « compter par PASSE ».
      if (tentes && tentes[cle]) continue;
      if (tentes) tentes[cle] = true;
      examines++;
      try { analyserFichierReliquat_(f, dom, nom, cle, proteges); }
      catch (e) { complet = false; journalErreur_('Reset', 'Analyse du reliquat différée (' + nom + ') : ' + e); }
    }
  }
  return { examines: examines, complet: complet };
}

/**
 * ÉTAPE DE TICK : passe LLM du reliquat. Campagne de FOND ⇒ budget QUOTIDIEN en ms réelles
 * persistées (`DriveAI_RESET_LLM_JOUR`, patron des 3 autres phases — revue flotte C28-42 : « un
 * plafond par RUN ne borne pas la JOURNÉE », sans lui le drainage concentrait 50-130 min de
 * runtime sur UN jour → gel C28-29, chien de garde inclus). Budget RÉALLOUÉ dans l'enveloppe
 * 50 min/j du reset (placement 22→14, 04 8→4), sommé dans l'invariant d'orchestration ; le frein
 * campagnes §2.6 et la panne plateforme (R2) la suspendent. JAMAIS gatée par `resetEnCours_()`
 * (réciproque vitale) : elle tourne PENDANT le reset et après, jusqu'au drainage. Pas de chemin
 * UN-CLIC (voulu : jamais de boucle Sonnet non bornée en manuel — le drainage suit le tick).
 * Drapeau terminal versionné = la MÊME chaîne que le placement (`finPlacementReset_`), posé sur
 * passe vide UNIQUEMENT quand le placement est terminé (avant, le rassemblement peut encore
 * alimenter `_TRI`) → coût nul ensuite (1 lecture de Property par tick) ; un bump de table le
 * ré-ouvre avec le placement.
 */
function analyserReliquatReset_(estBudgetDepasse, manuel, tentes) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RESET_LLM') === finPlacementReset_()) return; // reliquat drainé
  if (estPannePlateforme_()) return; // panne de COMPTE API : aucun doc touché, re-sonde ailleurs (R2)
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_LLM_JOUR', aujourdhui);
  // `manuel` (un-clic éditeur / PILOTE CI ADR-0032) : ni gaté, ni compté — le budget quotidien
  // protège le quota des DÉCLENCHEURS, dont ces chemins ne font pas partie. Le coût $ est borné
  // ailleurs et ne change PAS : plafond d'items par passe + clé versionnée (chaque doc payé une
  // seule fois par version de table) + frein campagnes §2.6, tous conservés ci-dessous.
  if (!manuel && consommeJour >= CONFIG.RESET_LLM_BUDGET_JOUR_MS) return; // budget du jour épuisé — repris demain
  var debut = Date.now();
  var budgetRun = manuel ? Infinity : CONFIG.RESET_LLM_BUDGET_JOUR_MS - consommeJour;
  var garde = function () {
    return estBudgetDepasse() || budgetCampagnesAtteint_() || estPannePlateforme_() ||
      (Date.now() - debut) > budgetRun;
  };
  if (garde()) return; // avant `debut` compté : un tick sans créneau ne consomme rien
  try {
    var r = analyserPageReliquatReset_(garde, ensembleDomainesProteges_(), tentes);
    if (r.examines) journalInfo_('Reset', r.examines + ' fichier(s) du reliquat passés au pipeline (LLM).');
    if (r.complet && r.examines === 0 &&
        props.getProperty('DriveAI_RESET_PLACEMENT') === finPlacementReset_()) {
      props.setProperty('DriveAI_RESET_LLM', finPlacementReset_());
      journalInfo_('Reset', 'Reliquat LLM DRAINÉ (' + finPlacementReset_() + ') — plus rien de non-routable dans ' + CONFIG.RESET_TRI_NOM + '.');
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_LLM_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- 04 · Immigration : réorganisation INTERNE (CLAUDE.md §2.1b révisé, ADR-0030 §4) ---------- */

/** Racine de 04 · Immigration — TOUTE cible interne est construite depuis CE dossier (jamais un chemin arbitraire). */
function dossierRacine04Reset_() {
  return DriveApp.getFolderById(CONFIG.DOMAINES['04 · Immigration']);
}

/**
 * Résout (find-or-create) une cible INTERNE à 04. Construite STRUCTURELLEMENT depuis la racine 04
 * (`dossierRacine04Reset_`, jamais depuis un ID/chemin fourni par l'appelant) : par construction, il
 * est IMPOSSIBLE de renvoyer un dossier hors de 04 (CLAUDE.md §2.1b).
 */
function dossierInterne04Reset_(sousChemin) {
  var segments = sousChemin.split('/');
  var dossier = dossierRacine04Reset_();
  for (var i = 0; i < segments.length; i++) dossier = sousDossier_(dossier, segments[i]);
  return dossier;
}

function collecterInterne04Reset_(dossier, ids, max, estBudgetDepasse, tag, etat) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      if (estExcluDuReset_(f.getName())) continue;
      if (indexContient_('epingle|' + f.getId())) continue; // épinglé par Marc → jamais réorganisé même à l'intérieur de 04 (ADR-0026)
      if (indexContient_('tri33-04|' + tag + '|' + f.getId())) continue;
      ids.push(f.getId());
    } catch (e) { etat.complet = false; journalErreur_('Reset', 'Fichier ignoré à la collecte 04 interne (' + e + ')'); }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse() || ids.length >= max) { etat.complet = false; return; }
    try { collecterInterne04Reset_(fo.next(), ids, max, estBudgetDepasse, tag, etat); }
    catch (e) { etat.complet = false; journalErreur_('Reset', 'Sous-dossier ignoré à la collecte 04 interne (' + e + ')'); }
  }
}

/**
 * Réorganise UN fichier de 04 EN INTERNE (CLAUDE.md §2.1b, ADR-0030 §4). Cible résolue via
 * `dossierInterne04Reset_` (construite depuis la racine 04) PUIS re-vérifiée par `segmentsSousDomaine_`
 * (défense en profondeur, échec-fermé — ADR-0028) : un échec bloque le déplacement, ne le laisse
 * jamais passer. `cheminCibleReset_('04 · Immigration', nom)` null ⇒ jamais touché (reste À SA PLACE,
 * PAS de sortie — un doc ambigu, ex. « CIC » qui pourrait être la banque, n'est jamais déplacé
 * d'office). MULTI-PARENTS jamais déplacé (même prudence que ConsolidationExec).
 * @return {boolean} vrai si RÉELLEMENT déplacé ce call.
 */
function reorganiserInterne04_(fileId, tag, ctx) {
  var cle = 'tri33-04|' + tag + '|' + fileId;
  if (indexContient_(cle)) return false;
  var f;
  try { f = DriveApp.getFileById(fileId); }
  catch (e) {
    indexAjouter_(cle, { statut: 'tri33-04-absent', nom: fileId, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var nom = f.getName();

  if (nbParentsBorne_(f) > 1) {
    indexAjouter_(cle, { statut: 'tri33-04-multiparents', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var sousChemin = cheminCibleReset_('04 · Immigration', nom);
  if (!sousChemin) {
    indexAjouter_(cle, { statut: 'tri33-04-reste', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }
  var cible = dossierInterne04Reset_(sousChemin);
  // Défense en profondeur (CLAUDE.md §2.1b, échec-fermé) : garanti par construction, re-vérifié quand même.
  if (!segmentsSousDomaine_(cible, CONFIG.DOMAINES['04 · Immigration'])) {
    journalErreur_('Reset', 'Cible 04-interne hors de 04 (refusé, ne devrait jamais arriver) : ' + nom);
    indexAjouter_(cle, { statut: 'tri33-04-refus', nom: nom, domaine: '04 · Immigration', chemin: '' }, '');
    return false;
  }

  var cibleId = cible.getId();
  var ancienParent = null;
  try { var ps = f.getParents(); if (ps.hasNext()) ancienParent = ps.next(); } catch (e) { ancienParent = null; }
  var deplace = false;
  if (!(ancienParent && ancienParent.getId() === cibleId)) {
    cible.addFile(f);
    if (ancienParent) {
      try { ancienParent.removeFile(f); }
      catch (e) { journalErreur_('Reset', 'Retrait ancien parent 04 impossible (' + nom + ') : ' + e); }
    }
    deplace = true;
  }
  indexAjouter_(cle, { statut: 'tri33-04-route', nom: nom, domaine: '04 · Immigration', chemin: '04 · Immigration/' + sousChemin }, '');
  if (ancienParent && ancienParent.getId() !== cibleId) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('Reset', 'Détection coquille vide 04 différée : ' + e); }
  }
  return deplace;
}

/** UNE passe bornée de réorg interne 04. @return {{examines, deplaces, complet}} */
function reorganiserPageInterne04_(estBudgetDepasse, ctx) {
  var tag = CONFIG.RESET_TAG;
  var racine;
  try { racine = dossierRacine04Reset_(); }
  catch (e) {
    journalErreur_('Reset', 'Racine 04 illisible (04 interne) : ' + e);
    return { examines: 0, deplaces: 0, complet: false };
  }
  var ids = [];
  var etat = { complet: true };
  collecterInterne04Reset_(racine, ids, CONFIG.RESET_04_MAX_PAR_RUN, estBudgetDepasse, tag, etat);
  var deplaces = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    try { if (reorganiserInterne04_(ids[i], tag, ctx)) deplaces++; }
    catch (e) { etat.complet = false; journalErreur_('Reset', '04 interne différé (' + ids[i] + ') : ' + e); }
  }
  return { examines: ids.length, deplaces: deplaces, complet: etat.complet };
}

/** ÉTAPE DE TICK : réorganisation interne de 04, gatée flag + budgets. */
function appliquerReset04Interne_(estBudgetDepasse, manuel) {
  if (!CONFIG.RESET_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.RESET_TAG;
  if (props.getProperty('DriveAI_RESET_04') === tag) return;
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_RESET_04_JOUR', aujourdhui);
  if (!manuel && consommeJour >= CONFIG.RESET_04_BUDGET_JOUR_MS) return;

  var debut = Date.now();
  var budgetRun = manuel ? Infinity
    : Math.min(CONFIG.RESET_04_BUDGET_JOUR_MS - consommeJour, 2 * 60 * 1000);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  try {
    var ctx = { proteges: ensembleDomainesProteges_() };
    var r = reorganiserPageInterne04_(garde, ctx);
    if (r.deplaces) journalInfo_('Reset', r.deplaces + ' fichier(s) réorganisé(s) EN INTERNE sous 04 (reset).');
    if (r.complet && r.examines === 0) {
      props.setProperty('DriveAI_RESET_04', tag);
      journalInfo_('Reset', '04 interne TERMINÉ (tag « ' + tag + ' »).');
    }
    return r;
  } finally {
    if (!manuel) props.setProperty('DriveAI_RESET_04_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}

/* ---------- Fonctions UN-CLIC (éditeur Apps Script, hors quota ~90 min/j des déclencheurs) ---------- */

/**
 * Acquiert le verrou partagé du tick avant une fonction UN-CLIC (revue quota C28-33) : sans lui, un
 * `tickDriveAI` déclenché PENDANT les plusieurs minutes d'une boucle manuelle tournerait en PARALLÈLE
 * sur les mêmes dossiers Drive et les mêmes Script Properties de budget — course sur
 * `DriveAI_RESET_*_JOUR` (la dernière écriture du `finally` écrase l'autre, sous-comptant le budget
 * réellement consommé) et appels Drive redondants sur un même fichier. Même patron que
 * `reparerIncidentSheet`/`fusionnerDomaine07PersoVers08` (Maintenance.gs).
 *
 * CE QUE ÇA COÛTE, honnêtement (correction de revue — le commentaire précédent datait d'avant le
 * retrait du budget quotidien) : `TICK_MINUTES` vaut 5 et une boucle manuelle tient le verrou
 * jusqu'à ~4,5 min, donc pendant une SÉANCE de relances enchaînées c'est **quasiment chaque tick**
 * qui est sauté (`tryLock(5000)` échoue → retour immédiat) — pas « quelques ticks ». Le flux vivant
 * (PJ Gmail, dépôts, intentions, tri) est donc EN PAUSE pendant la séance ; rien n'est perdu, tout
 * est re-scanné ensuite. Pour que le chien de garde ne crie pas « moteur silencieux » à tort
 * (seuil 45 min) pendant une longue séance, les un-clic écrivent `DriveAI_LAST_MANUEL` —
 * `chienDeGarde` prend le PLUS RÉCENT des deux signaux de vie (cf. Main.gs).
 * @return {?Lock} le verrou tenu, ou null si indisponible (tick en cours — appelant doit sortir tôt).
 */
function acquerirVerrouReset_(nomFonction) {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30 * 1000)) {
    journalInfo_('Reset', nomFonction + '() : tick en cours — réessaie dans une minute (jamais en même temps qu\'un tick).');
    return null;
  }
  return verrou;
}

/**
 * Un-clic lancé DEPUIS L'ÉDITEUR, jamais par un déclencheur : le drapeau `manuel` (ni gaté, ni
 * compté) ne vaut que HORS du quota des déclencheurs. Un handler de trigger reçoit un event object
 * (`e.triggerUid`) — une exécution d'éditeur, non. Garde de construction : si quelqu'un installait
 * un jour un déclencheur sur une de ces fonctions, elle refuserait de tourner plutôt que de
 * consommer le quota des déclencheurs en se croyant « hors quota » (angle mort relevé en revue).
 */
function estAppelParDeclencheur_(e) {
  return !!(e && e.triggerUid);
}

/**
 * Vrai si une ronde de boucle un-clic n'a RIEN produit (ni examen, ni déplacement) — l'appelant
 * s'arrête alors immédiatement. Sans cette sortie, `lancerResetPlacement` spinnait jusqu'au mur des
 * 4,5 min dans l'état STABLE « placement oisif mais tag impossible » (le placement ne fige son tag
 * qu'une fois le rassemblement terminé) : chaque ronde stérile relisait tout `PlanConsolidation`
 * (~2 900 lignes) et écrivait une ligne de Journal identique — des centaines pour rien (revue quota :
 * le retrait du budget quotidien a AGGRAVÉ ce spin, qui était coupé par lui avant). PURE.
 */
function rondeSterileReset_(r) {
  return !r || (!r.examines && !r.deplaces);
}

/**
 * Garde-temps d'UNE phase à l'intérieur d'une ronde UN-CLIC : elle reçoit au plus `1/phasesRestantes`
 * du temps qui reste avant le mur de l'exécution (`CONFIG.BUDGET_MS` depuis `debut`). Sans ce partage,
 * la première phase appelée consomme TOUT le mur dès que son plafond d'items est haut, et les phases
 * suivantes ne tournent jamais (revue #229 : `lancerResetTout` dégénérait en rassemblement seul).
 * Adaptatif : une phase qui n'a rien à faire rend sa part aux suivantes. La borne GLOBALE est toujours
 * respectée (le `||` ci-dessous), donc ce partage ne peut pas retarder le mur, seulement le découper.
 * @param {number} debut  horodatage du début de L'EXÉCUTION manuelle (pas de la phase)
 * @param {number} phasesRestantes  cette phase incluse (3, 2, puis 1)
 * @return {function():boolean}
 */
function gardePartReset_(debut, phasesRestantes, murMs) {
  var mur = murMs || CONFIG.BUDGET_MS; // le pilote CI (ADR-0032) passe un mur PLUS COURT
  var t0 = Date.now();
  var part = partPhaseReset_(mur - (t0 - debut), phasesRestantes);
  return function () {
    var maintenant = Date.now();
    return (maintenant - debut) > mur || (maintenant - t0) > part;
  };
}

/**
 * Part de temps allouée à UNE phase. PURE (c'est l'arithmétique du partage, isolée pour être
 * testable sans horloge). Plus rien à distribuer ⇒ 0, donc la phase est coupée immédiatement.
 * @param {number} restantMs  temps restant avant le mur de l'exécution
 * @param {number} phasesRestantes  cette phase incluse
 */
function partPhaseReset_(restantMs, phasesRestantes) {
  return restantMs > 0 ? restantMs / Math.max(1, phasesRestantes) : 0;
}

/**
 * Signal de VIE d'une exécution manuelle (revue quota) : une séance de relances enchaînées tient le
 * verrou et fait sauter presque tous les ticks — au-delà de `WATCHDOG_SEUIL_MS` (45 min), le chien de
 * garde verrait un heartbeat figé et déclarerait « moteur silencieux » À TORT (l'épisode remonterait
 * jusqu'au résumé hebdo). `chienDeGarde` prend donc le PLUS RÉCENT de `DriveAI_LAST_TICK` et de cette
 * Property. Jamais propagé : un échec d'écriture ne doit pas casser un run manuel réussi.
 */
function marquerVieManuelleReset_() {
  try { PropertiesService.getScriptProperties().setProperty('DriveAI_LAST_MANUEL', String(Date.now())); }
  catch (e) { /* best-effort : sans ça, au pire une fausse alerte watchdog */ }
}

/* ---------- PILOTE CI (ADR-0032) : le lancement n'est plus un geste de Marc ---------- */

/**
 * Le pilotage est TERMINÉ quand les 3 phases I/O ont posé leur tag ET que le reliquat LLM est
 * drainé. `resetTermine_()` seul ne suffit PAS (le drapeau `DriveAI_RESET_LLM` n'y entre pas, à
 * dessein : les campagnes suspendues reprennent dès la convergence I/O) — s'arrêter dessus
 * laisserait le reliquat au ralenti du tick, exactement la plainte de Marc « rien ne se passe ».
 * @return {boolean}
 */
function pilotageTermineReset_() {
  if (!resetTermine_()) return false;
  return PropertiesService.getScriptProperties().getProperty('DriveAI_RESET_LLM') === finPlacementReset_();
}

/**
 * Alerte « déclencheurs muets » — au plus 1×/h (une alerte qui se répète toutes les 15 min devient
 * du bruit, et le canal mail a ses propres quotas). C'est la contrepartie du refus de passe : le
 * pilote ne masque plus le gel (ancienne écriture de `DriveAI_LAST_MANUEL`), il le SIGNALE.
 */
function alerterGelPilote_(props, lastTick) {
  var derniere = Number(props.getProperty('DriveAI_PILOTE_ALERTE_GEL')) || 0;
  if (Date.now() - derniere < 60 * 60 * 1000) return;
  props.setProperty('DriveAI_PILOTE_ALERTE_GEL', String(Date.now()));
  var minutes = Math.round((Date.now() - lastTick) / 60000);
  notifierEchec_('Pilote', 'Aucun tick depuis ' + minutes + ' min : le flux vivant (mails, dépôts) est ' +
    'probablement à l\'arrêt. Les passes de rangement sont REFUSÉES tant que ça dure — si ça persiste, ' +
    'ré-examiner l\'hypothèse « web app hors quota des déclencheurs » (ADR-0032) et ré-exécuter installerTrigger.');
}

/**
 * Compte les passes CONSÉCUTIVES sans progrès et alerte une fois passé le seuil. Sans ça, un état
 * bloqué mais « non terminé » (précédent vécu : une racine devenue inaccessible ⇒ `complet` jamais
 * vrai ⇒ drapeau jamais posé) ferait tourner ~192 passes/jour de walks récursifs complets pour zéro
 * travail, indéfiniment, avec un workflow tout vert. PURE côté décision, l'état vit dans la Property.
 * @return {boolean} vrai si la stagnation est avérée (la CI arrête d'insister)
 */
function suivreSteriliteReset_(props, aProgresse) {
  if (aProgresse) { props.deleteProperty('DriveAI_PILOTE_STERILES'); return false; }
  var n = (Number(props.getProperty('DriveAI_PILOTE_STERILES')) || 0) + 1;
  props.setProperty('DriveAI_PILOTE_STERILES', String(n));
  if (n !== CONFIG.PILOTE_STERILES_MAX) return n > CONFIG.PILOTE_STERILES_MAX; // alerte UNE seule fois
  journalErreur_('Reset', n + ' passes pilotées consécutives sans aucun progrès — rangement BLOQUÉ (ni fini, ni avançant).');
  notifierEchec_('Pilote', n + ' passes de rangement consécutives n\'ont rien produit alors que le reset n\'est pas ' +
    'terminé : quelque chose bloque (dossier inaccessible ?). Le pilote se met en veille — voir l\'onglet Journal.');
  return true;
}

/**
 * UNE passe POUSSÉE par le pilote CI (ADR-0032) — le même travail que le clic `lancerResetTout` de
 * Marc, plus la passe LLM du reliquat, déclenché par GitHub Actions au lieu de sa main.
 *
 * ⚠️ LE PARI, ÉCRIT NOIR SUR BLANC (revue flotte C28-43) : ce montage suppose que le runtime d'une
 * exécution de WEB APP ne compte pas dans le quota « Triggers total runtime » (~90 min/j) dont le
 * dépassement gèle TOUS les déclencheurs, chien de garde inclus (C28-29). C'est un INDICE, pas une
 * mesure : le précédent C28-33 prouve seulement que les compteurs INTERNES de DriveAI bridaient à
 * tort le chemin manuel, et CLAUDE.md §6bis (#235) tient ce quota pour PARTAGÉ. D'où les trois
 * filets ci-dessous, qui rendent le pari SÛR même s'il est faux :
 *   1. `PILOTE_BUDGET_JOUR_MS` — borne du RAYON D'EXPLOSION en ms réelles persistées ;
 *   2. refus + alerte si les ticks sont silencieux — le pilote DÉTECTE le gel au lieu de le masquer
 *      (il ne pose SURTOUT PAS `DriveAI_LAST_MANUEL` : ça rendrait le chien de garde muet pendant
 *      toute la campagne — il n'en a pas besoin, la fenêtre de tick est garantie par la pause CI) ;
 *   3. ms consommées journalisées — sans mesure, l'hypothèse resterait invérifiable.
 *
 * Le travail est fait ICI, SYNCHRONEMENT dans le `doPost` : passer par `actionTickPonctuel_` (qui
 * CRÉE un déclencheur) consommerait le quota protégé (verrouillé par test).
 *
 * Contexte d'exécution web app ≠ tick (patron `actionRechercheIA_`/`actionChatAssistant_`) :
 * `chargerPannePlateforme_()` + compteur d'usage PROPRE (`reinitialiserUsage_`/`flushUsage_`),
 * sans quoi le coût Anthropic de la passe ne serait JAMAIS comptabilisé et le frein §2.6 (110 $)
 * deviendrait aveugle sur le chemin dominant.
 * @return {{ok:boolean, termine:boolean, rondes:number, progres:boolean, message:string}}
 */
function pousserResetPilote_() {
  if (!CONFIG.PILOTE_ACTIF) return { ok: false, termine: false, rondes: 0, progres: false, message: 'pilote désactivé (CONFIG.PILOTE_ACTIF)' };
  if (!CONFIG.RESET_ACTIF) return { ok: false, termine: false, rondes: 0, progres: false, message: 'RESET_ACTIF est false' };
  if (pilotageTermineReset_()) return { ok: true, termine: true, rondes: 0, progres: false, message: 'reset terminé (I/O + reliquat LLM drainé)' };

  var props = PropertiesService.getScriptProperties();
  // FILET 2 — DÉTECTEUR DE GEL : si les déclencheurs sont muets depuis plus longtemps que le seuil
  // du chien de garde, on REFUSE la passe et on alerte (le mail ne dépend d'aucun déclencheur).
  // Deux raisons : ne pas alimenter un quota peut-être partagé au moment précis où il lâche, et
  // rendre VISIBLE le scénario que ce chantier redoute — le rangement qui avance pendant que le
  // flux vivant (Gmail, dépôts) est mort. `lastTick &&` : ne bloque pas une première installation.
  var lastTick = Number(props.getProperty('DriveAI_LAST_TICK')) || 0;
  if (lastTick && Date.now() - lastTick > CONFIG.WATCHDOG_SEUIL_MS) {
    alerterGelPilote_(props, lastTick);
    return { ok: true, termine: false, rondes: 0, progres: false, gel: true,
      message: 'ticks silencieux — passe REFUSÉE (le flux vivant prime sur le rangement)' };
  }
  // FILET 1 — budget QUOTIDIEN en ms réelles (patron des phases du reset). Il ne protège pas le
  // tick (autre compteur si le pari est bon) : il borne la CASSE si le pari est mauvais.
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourReset_(props, 'DriveAI_PILOTE_JOUR', aujourdhui);
  if (consommeJour >= CONFIG.PILOTE_BUDGET_JOUR_MS) {
    return { ok: true, termine: false, rondes: 0, progres: false,
      message: 'budget quotidien du pilote épuisé — repris demain' };
  }

  var debut = Date.now();
  var verrou = acquerirVerrouReset_('pousserResetPilote_');
  if (!verrou) return { ok: true, termine: false, rondes: 0, progres: false, message: 'tick en cours — passe sautée (jamais en parallèle)' };
  var rondes = 0, progres = false, echecs = 0;
  // Mur de CETTE passe : le plus petit du mur par passe et du reliquat quotidien.
  var murMs = Math.min(CONFIG.PILOTE_BUDGET_MS, CONFIG.PILOTE_BUDGET_JOUR_MS - consommeJour);
  // Documents du reliquat déjà TENTÉS dans CETTE exécution : sans cette mémoire, la boucle de
  // rondes re-présente le même fichier et `gererEchec_` brûle ses 3 essais en 2 min sur un blip
  // transitoire → quarantaine DÉFINITIVE et silencieuse (la dé-quarantaine auto ne couvre pas la
  // clé `tri33llm|`). C'est aussi ce qui rend vrai le plafond « RESET_LLM_MAX_PAR_RUN par passe ».
  var tentesLlm = {};
  // Même mémoire pour les échecs de MUTATION I/O (rassemblement/placement) : sans elle, un blip Drive
  // transitoire brûlerait ses 3 essais en secondes sur les rondes du pilote (leçon §7, revue Vague 1b).
  var tentesMut = {};
  chargerPannePlateforme_();
  reinitialiserUsage_();
  try {
    var murAtteint = function () { return Date.now() - debut > murMs; };
    // Ne JAMAIS démarrer un document LLM trop tard : un doc peut coûter OCR + 2 appels Sonnet avec
    // retry (~1-3 min) et le garde n'est évalué qu'AVANT de le prendre. Sans cette marge, la passe
    // dépasse le `--max-time` de la CI (réponse perdue, warning trompeur), voire le mur dur 6 min.
    var murDemarrageLlm = Math.max(0, murMs - CONFIG.PILOTE_MARGE_DOC_MS);
    var phase = function (fn, parts, murPhase) { // try/catch PAR phase (leçon « étape secondaire enveloppée »)
      if (Date.now() - debut > murPhase) return false;
      try { return !rondeSterileReset_(fn(gardePartReset_(debut, parts, murPhase))); }
      catch (e) { echecs++; journalErreur_('Reset', 'Phase pilotée différée : ' + e); return false; }
    };
    while (!murAtteint() && !pilotageTermineReset_() && rondes < 500) {
      var progresRonde = false;
      // Part de temps PAR PHASE (revue #229) : sans ça la première phase mange tout le mur et les
      // suivantes ne tournent jamais. 4 phases désormais — la passe LLM est la dernière servie.
      if (phase(function (g) { return rassemblerReset_(g, true, tentesMut); }, 4, murMs)) progresRonde = true;
      if (phase(function (g) { return placerReset_(g, true, tentesMut); }, 3, murMs)) progresRonde = true;
      if (phase(function (g) { return appliquerReset04Interne_(g, true); }, 2, murMs)) progresRonde = true;
      if (phase(function (g) { return analyserReliquatReset_(g, true, tentesLlm); }, 1, murDemarrageLlm)) progresRonde = true;
      rondes++;
      if (progresRonde) progres = true; else break; // aucune phase n'a rien à faire → inutile de re-scanner
    }
    journalInfo_('Reset', 'Pilote CI : ' + rondes + ' ronde(s), ' + (progres ? 'progrès' : 'rien à faire') +
      ', ' + Math.round((Date.now() - debut) / 1000) + ' s consommées (mesure du pari ADR-0032).');
  } catch (e) {
    journalErreur_('Reset', 'Passe pilotée interrompue : ' + e);
    // Message GÉNÉRIQUE : la réponse finit dans un log CI PUBLIC — le détail (noms de fichiers)
    // reste au Journal privé. `erreur` absent ⇒ la CI sait que c'est TRANSITOIRE, pas permanent.
    return { ok: false, termine: false, rondes: rondes, progres: progres, message: 'passe interrompue (détail au Journal)' };
  } finally {
    try { flushUsage_(); } catch (e2) { /* mesure de coût perdue pour cette passe — accepté */ }
    props.setProperty('DriveAI_PILOTE_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
    verrou.releaseLock();
  }
  var termine = pilotageTermineReset_();
  var stagnation = suivreSteriliteReset_(props, progres || termine);
  return {
    ok: true,
    termine: termine,
    rondes: rondes,
    progres: progres,
    echecs: echecs,
    stagnation: stagnation,
    message: progres ? 'passe poussée' : 'rien à faire sur cette passe'
  };
}

/**
 * UN-CLIC combiné : rassemblement PUIS placement PUIS 04 interne, en boucle, jusqu'au mur des 6 min
 * de CETTE exécution manuelle OU la fin du reset. Le moyen le plus rapide pour Marc de faire
 * progresser le reset sans attendre les ticks (chaque tick n'avance QUE d'une page/phase, budget-gaté
 * par le flux vivant). Relancer autant de fois que nécessaire (le Journal dit où ça en est) — chaque
 * appel est repris là où le précédent s'est arrêté (clés de convergence persistées). Les budgets
 * QUOTIDIENS ne s'appliquent PAS ici (cf. le bloc « manuel » plus haut) : ils protègent le quota des
 * DÉCLENCHEURS, dont une exécution d'éditeur ne fait pas partie.
 */
function lancerResetTout(e) {
  if (estAppelParDeclencheur_(e)) return; // jamais par un déclencheur (cf. estAppelParDeclencheur_)
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetTout() : RESET_ACTIF est false — rien à faire.'); return; }
  // `debut` AVANT le verrou (revue quota) : `tryLock` peut consommer 30 s — non comptées, elles
  // rognaient la marge sous le mur dur des 6 min.
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetTout');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && !resetTermine_() && rondes < 500) {
      var progres = false;
      // ⚠ Garde PAR PHASE, pas seulement le mur global (revue #229) : avec des plafonds d'items
      // hauts, la PREMIÈRE phase consomme les 4,5 min entières et les deux suivantes ne sont JAMAIS
      // atteintes — le clic « tout faire » de Marc dégénérait en rassemblement seul et ne produisait
      // plus AUCUNE structure finale visible. Chaque phase reçoit au plus sa part de ce qui reste,
      // donc le round-robin tient quel que soit le plafond d'items.
      if (!estBudgetDepasse() && !rondeSterileReset_(rassemblerReset_(gardePartReset_(debut, 3), true, tentesMut))) progres = true;
      if (!estBudgetDepasse() && !rondeSterileReset_(placerReset_(gardePartReset_(debut, 2), true, tentesMut))) progres = true;
      if (!estBudgetDepasse() && !rondeSterileReset_(appliquerReset04Interne_(gardePartReset_(debut, 1), true))) progres = true;
      rondes++;
      if (!progres) break; // AUCUNE des 3 phases n'a rien à faire → inutile de re-scanner en boucle
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetTout() : ' + rondes + ' ronde(s) — ' +
      (resetTermine_() ? 'RESET TERMINÉ.' : 'relancer lancerResetTout() pour continuer.'));
  } catch (e2) {
    notifierEchec_('Reset', 'Reset manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : rassemblement seul, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerResetRassemblement(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetRassemblement() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetRassemblement');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = rassemblerReset_(estBudgetDepasse, true, tentesMut);
      rondes++;
      if (rondeSterileReset_(r)) break; // ronde stérile (ou phase terminée/inactive) → on sort
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetRassemblement() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', 'Rassemblement manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : placement seul, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerResetPlacement(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerResetPlacement() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerResetPlacement');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var tentesMut = {}; // mémoire des échecs de mutation par exécution (leçon §7)
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = placerReset_(estBudgetDepasse, true, tentesMut);
      rondes++;
      // ⚠ NE PAS remplacer par un test de tag : le placement ne fige son tag qu'APRÈS la fin du
      // rassemblement — l'état « oisif mais tag impossible » est stable et spinnait jusqu'au mur.
      if (rondeSterileReset_(r)) break;
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerResetPlacement() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', 'Placement manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}

/** UN-CLIC ciblé : réorganisation interne de 04 seule, en boucle jusqu'au mur des 6 min de cette exécution. */
function lancerReset04Interne(e) {
  if (estAppelParDeclencheur_(e)) return;
  if (!CONFIG.RESET_ACTIF) { journalInfo_('Reset', 'lancerReset04Interne() : RESET_ACTIF est false — rien à faire.'); return; }
  var debut = Date.now();
  var verrou = acquerirVerrouReset_('lancerReset04Interne');
  if (!verrou) return;
  try {
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var rondes = 0;
    while (!estBudgetDepasse() && rondes < 500) {
      var r = appliquerReset04Interne_(estBudgetDepasse, true);
      rondes++;
      if (rondeSterileReset_(r)) break;
    }
    marquerVieManuelleReset_();
    journalInfo_('Reset', 'lancerReset04Interne() : ' + rondes + ' passe(s).');
  } catch (e2) {
    notifierEchec_('Reset', '04 interne manuel interrompu : ' + e2);
  } finally {
    verrou.releaseLock();
  }
}
