/**
 * Entites.gs — Référentiel d'entités (Phase 2).
 *
 * L'onglet `Entités` est le référentiel CURÉ : une entité n'est routée vers son
 * dossier que si Marc l'a validée (Statut = « validée »). Une entité inconnue ne
 * crée JAMAIS de dossier automatiquement — elle est proposée en « en_attente » et
 * le document est CLASSÉ AU DOMAINE en attendant (anti-prolifération, jamais un blocage).
 *
 * Colonnes (auto-réparées au besoin) :
 *   Entité | Domaine | Catégorie | Type | Statut | Dossier ID | Ajoutée le | Variante possible ? | Vu N fois
 *
 * Lecture mise en cache 1×/run (leçon : jamais une lecture Sheet par item).
 */

var COLONNES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];

var _entitesCache = null; // { lignes: [...], parCle: { normKey: ligne } }
// P4 (C28-10) : inventaire PARESSEUX des sous-dossiers existants par domaine (« reality check »
// des propositions) — 1 listage Drive au plus par domaine et par run, jamais par document.
var _dossiersDomaineCache = {};

/** À appeler en tête de run pour repartir d'un cache neuf. */
function reinitialiserEntitesCache_() {
  _entitesCache = null;
  _dossiersDomaineCache = {};
}

/**
 * Normalise un libellé pour le matching : minuscules, sans accents, espaces compactés.
 * @param {*} s
 * @return {string}
 */
function normaliserCle_(s) {
  if (s == null) return '';
  var t = String(s).toLowerCase();
  // Décompose puis retire les diacritiques combinants U+0300–U+036F (Apps Script V8).
  if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Apostrophes (droite U+0027, typographique U+2019, modificatrices) → espace : uniformise le matching
  // de types (« avis d'imposition ») ET d'entités (« l'IUT »), quelle que soit la source (LLM/OCR/FR).
  t = t.replace(/[’ʼ´']/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Clé de matching d'une entité : domaine + nom (évite les collisions inter-domaines). */
function cleEntite_(domaine, entite) {
  return normaliserCle_(domaine) + '|' + normaliserCle_(entite);
}

/* ---------- Chantier #10 (ADR-0009 §1) : QUALITÉ des propositions d'entités — PURE, testée ----------
 * Une entité digne d'être proposée porte un NOM PROPRE (entreprise, institution, personne, adresse,
 * modèle). Le lexique ci-dessous liste des MOTS génériques (calibré sur la file réelle du 2026-07-02 :
 * « banque », « cours de physique », « Banque/Service en ligne »…). Une proposition dont TOUS les
 * jetons significatifs sont dans le lexique est générique ; UN seul jeton inconnu suffit à la garder
 * (« lycée Thérèse d'Avila » : thérèse/avila inconnus → gardée). Filtre ÉTROIT (leçon durable :
 * haute précision, jamais « générique par défaut ») — les chiffres (adresses, immatriculations)
 * comptent comme identifiants, donc non génériques. */

var LEXIQUE_GENERIQUE_ENTITE = [
  // finance
  'banque', 'banques', 'bancaire', 'compte', 'comptes', 'carte', 'credit', 'paiement', 'plateforme',
  'institution', 'financier', 'financiere', 'ligne', 'service', 'services',
  // études (matières et contenants)
  'cours', 'devoir', 'devoirs', 'examen', 'examens', 'epreuve', 'epreuves', 'synthese', 'kholle',
  'kholles', 'ds', 'tp', 'tpe', 'projet', 'projets', 'memoire', 'etude', 'etudes', 'classe',
  'preparatoire', 'prepa', 'ptsi', 'etablissement', 'ecole', 'scolaire', 'scolaires', 'lycee',
  'universite', 'universitaire', 'universitaires', 'secondaires', 'academique', 'concours',
  'preparation', 'ecrit', 'oral', 'premiere', 'terminale', 'seconde', 'certification', 'certificat',
  'anglais', 'francais', 'physique', 'mathematiques', 'maths', 'electronique', 'chimie',
  'litterature', 'litteraire', 'analyse', 'algorithmique', 'programmation', 'informatique',
  'mecanique', 'cinematique', 'analytique', 'python',
  // types de documents (jamais des entités)
  'diplome', 'attestation', 'releve', 'facture', 'contrat', 'document', 'fichier', 'scan',
  'courrier', 'correspondance',
  // logement / véhicule / divers
  'logement', 'appartement', 'maison', 'adresse', 'vehicule', 'voiture', 'transport', 'transports',
  'ferroviaire', 'assurance', 'sante', 'personnel', 'perso', 'administration', 'gouvernement',
  'technique', 'techniques', 'officiel'
];

// Connecteurs supplémentaires ignorés par le tokenizer QUALITÉ (en plus de STOPWORDS_ENTITE).
var CONNECTEURS_QUALITE = ['ou', 'sur', 'pour', 'par', 'avec', 'sans', 'ce', 'cette', 'fin'];

/**
 * Jetons pour le jugement de QUALITÉ : normalisés, PONCTUATION neutralisée (« — », parenthèses,
 * virgules… → espace), stopwords + connecteurs retirés. Distinct de `tokensEntite_` (matching de
 * variantes) pour ne pas changer le comportement de la garde anti-variantes existante. PUR.
 * @param {string} nom
 * @return {string[]}
 */
function jetonsQualite_(nom) {
  var t = normaliserCle_(nom).replace(/[^a-z0-9]+/g, ' ');
  return t.split(/\s+/).filter(function (j) {
    return j && STOPWORDS_ENTITE.indexOf(j) === -1 && CONNECTEURS_QUALITE.indexOf(j) === -1;
  });
}

/**
 * Vrai si la proposition est un GÉNÉRIQUE (tous ses jetons significatifs sont du lexique) —
 * elle ne mérite alors ni ligne dans le référentiel ni validation. PUR.
 * @param {string} nom
 * @return {boolean}
 */
function estEntiteGenerique_(nom) {
  var jetons = jetonsQualite_(nom);
  if (!jetons.length) return true; // rien de significatif → rien à proposer
  for (var i = 0; i < jetons.length; i++) {
    var j = jetons[i];
    var singulier = j.length > 3 && j.charAt(j.length - 1) === 's' ? j.slice(0, -1) : j;
    if (LEXIQUE_GENERIQUE_ENTITE.indexOf(j) === -1 &&
        LEXIQUE_GENERIQUE_ENTITE.indexOf(singulier) === -1) return false; // un identifiant suffit
  }
  return true;
}

/**
 * Vrai si deux libellés désignent la MÊME entité par INCLUSION de jetons (tous les jetons du plus
 * court sont dans le plus long) : « Desjardins » ⊆ « carte de crédit Desjardins », « 3325 4e avenue »
 * ⊆ « 3325 4e Avenue, App. 5, Québec ». VOLONTAIREMENT restreint à l'inclusion — jamais la distance
 * d'édition : « Honda Civic 2014 » vs « Honda Civic 2017 » sont deux entités distinctes (l'année
 * diffère ⇒ pas d'inclusion ⇒ pas de fusion). PUR.
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function estFusionnableEntite_(a, b) {
  var ta = jetonsQualite_(a), tb = jetonsQualite_(b);
  if (!ta.length || !tb.length) return false;
  var court = ta.length <= tb.length ? ta : tb;
  var long_ = ta.length <= tb.length ? tb : ta;
  if (!court.every(function (t) { return long_.indexOf(t) !== -1; })) return false;
  // Gardes anti-effondrement :
  // 1) une ANNÉE excédentaire distingue deux entités réelles (« Honda Civic » n'avale ni « Honda
  //    Civic 2014 » ni « 2017 » — deux véhicules) ;
  // 2) (refonte 2026-07-07, revue) quand le libellé COURT n'a qu'UN jeton significatif (une marque
  //    seule : « Ford »), un jeton excédentaire NON GÉNÉRIQUE (« fiesta » = un modèle) désigne une
  //    entité DIFFÉRENTE → refus. Les compléments génériques (« carte de crédit » Desjardins,
  //    « caisse » Desjardins) restent fusionnables ; les adresses (≥2 jetons courts) ne sont pas visées.
  for (var i = 0; i < long_.length; i++) {
    if (court.indexOf(long_[i]) !== -1) continue; // pas un excédent
    if (/^(19|20)\d{2}$/.test(long_[i])) return false; // année
    if (court.length === 1 && !estJetonGenerique_(long_[i])) return false; // marque seule + modèle propre
  }
  return true;
}

/* ============================================================================
 * CANONICALISATION & FUSION D'ENTITÉS (refonte 2026-07-07, chantier « analyse fiable »).
 * Objectif : une même entité réelle = UNE seule ligne/dossier. Fonctions PURES, testées.
 * ==========================================================================*/

/** Un jeton est GÉNÉRIQUE s'il (ou son singulier) est du lexique. PUR. */
function estJetonGenerique_(j) {
  if (!j) return true;
  var sing = j.length > 3 && j.charAt(j.length - 1) === 's' ? j.slice(0, -1) : j;
  return LEXIQUE_GENERIQUE_ENTITE.indexOf(j) !== -1 || LEXIQUE_GENERIQUE_ENTITE.indexOf(sing) !== -1;
}

// Variantes du PROPRIÉTAIRE (Marc) : jamais une entité/émetteur d'un document d'organisation.
var PROPRIO_JETONS = ['marc', 'alexis', 'claude', 'richard', 'a'];

/**
 * Vrai si `nom` désigne MARC (le propriétaire) — à exclure comme entité/émetteur d'un doc
 * d'organisation (il reste un TITULAIRE valide sur une pièce d'identité, voir titulairePourNom_). PUR.
 * Règle : « richard » présent ET tous les jetons ∈ {marc,alexis,claude,richard,a}.
 */
function estProprietaireMarc_(nom) {
  var toks = normaliserCle_(nom).replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!toks.length || toks.indexOf('richard') === -1) return false;
  return toks.every(function (t) { return PROPRIO_JETONS.indexOf(t) !== -1; });
}

// Suffixes juridiques retirés en fin de libellé (« Desjardins Inc. » → « Desjardins »).
var SUFFIXES_JURIDIQUES = ['inc', 'sas', 'sa', 'sarl', 'ltee', 'ltd', 'pbc', 'corp', 'gmbh', 'llc'];

/** Retire un suffixe juridique FINAL (jamais un « SA » interne comme « Sassone »). PUR. */
function retirerSuffixeJuridique_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  var toks = s.split(/\s+/);
  if (toks.length >= 2) {
    var dernier = normaliserCle_(toks[toks.length - 1]).replace(/[.,]/g, '');
    if (SUFFIXES_JURIDIQUES.indexOf(dernier) !== -1) {
      toks.pop();
      return toks.join(' ').replace(/[\s,]+$/, '').trim();
    }
  }
  return s;
}

// Marques automobiles (pour ne canoniser en véhicule QUE ce qui en est un — jamais « Groupe Sport »).
var MARQUES_VEHICULE = ['ford', 'honda', 'toyota', 'volkswagen', 'vw', 'mazda', 'kia', 'yamaha',
  'nissan', 'hyundai', 'chevrolet', 'bmw', 'audi', 'mercedes', 'peugeot', 'renault', 'citroen',
  'fiat', 'jeep', 'dodge', 'ram', 'gmc', 'subaru', 'lexus', 'acura', 'volvo', 'tesla'];
var FINITIONS_VEHICULE = ['se', 'sl', 'sle', 'lx', 'ex', 'gt', 'gts', 'sport', 'comfortline',
  'trendline', 'limited', 'touring', 'hybrid', 'base', 'sv', 'lt'];

/** Vrai si `nom` commence par une marque auto connue. PUR. */
function estMotifVehicule_(nom) {
  return MARQUES_VEHICULE.indexOf(normaliserCle_(String(nom).split(/\s+/)[0] || '')) !== -1;
}

/** « Ford Fiesta SE 2011 » → « Ford Fiesta » : retire année + finition (marque + modèle seuls). PUR. */
function canoniserVehicule_(nom) {
  var toks = String(nom == null ? '' : nom).trim().split(/\s+/).filter(Boolean);
  var out = toks.filter(function (t) {
    var n = normaliserCle_(t);
    return !/^(19|20)\d{2}$/.test(n) && FINITIONS_VEHICULE.indexOf(n) === -1;
  });
  return out.join(' ') || String(nom == null ? '' : nom).trim();
}

/**
 * Adresse → forme canonique « numéro voie, ville » : normalise ordinaux (4th/4e/4ème → 4e) et voie
 * (Av./Ave → Avenue), retire compléments (App./Bureau/étage) et code postal. Fusionne les variantes.
 * PUR. (Cas sans virgule : best-effort — la fusion par inclusion de jetons rattrape le reste.)
 */
function canoniserAdresse_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  if (!/^\d/.test(s)) return s; // pas une adresse (ne commence pas par un numéro civique)
  s = s.replace(/\b(\d+)(?:er|ere|eme|ème|e|th|st|nd|rd)\b/gi, '$1e'); // ordinaux
  s = s.replace(/\bav(?:e|e\.|enue)?\b\.?/gi, 'Avenue').replace(/\bboul(?:\.|evard)?\b/gi, 'Boulevard')
    .replace(/\brte\b\.?/gi, 'Route');
  s = s.replace(/\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/g, '').replace(/\b\d{5}\b/g, ''); // codes postaux CA/FR
  var parts = s.split(',').map(function (p) { return p.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  parts = parts.filter(function (p) {
    var k = normaliserCle_(p);
    return !/^(app|apt|appartement|bureau|unite|etage|no|#)\b/.test(k) && !/^#?\d+$/.test(p.trim());
  });
  return parts.join(', ').trim() || s.replace(/\s+/g, ' ').trim();
}

// Corruptions OCR récurrentes → forme canonique (jamais d'invention : absent = inchangé).
var CORRECTIONS_OCR_ENTITE = { 'matech robotik': 'Automatech', 'automatech robotik': 'Automatech' };

/** Corrige une corruption OCR connue (table). PUR. */
function corrigerOcrConnu_(nom) {
  return CORRECTIONS_OCR_ENTITE[normaliserCle_(nom)] || String(nom == null ? '' : nom).trim();
}

/** Casse Titre en préservant les acronymes/casse existante (« hydro quebec » → « Hydro Quebec », « IRCC » inchangé). PUR. */
function casseTitreEntite_(s) {
  return String(s == null ? '' : s).replace(/\S+/g, function (w) {
    return w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}

/**
 * Forme CANONIQUE d'affichage d'une entité, ou null si elle ne mérite pas de ligne/dossier. PUR.
 * Ordre : générique → null ; Marc → null ; retrait suffixe juridique ; correction OCR ; motif
 * (adresse/véhicule) ; casse de surface.
 */
function canoniserEntite_(nom) {
  if (nom == null || !String(nom).trim()) return null;
  if (estEntiteGenerique_(nom)) return null;
  if (estProprietaireMarc_(nom)) return null;
  var s = corrigerOcrConnu_(retirerSuffixeJuridique_(String(nom).trim()));
  if (/^\d/.test(s.trim())) s = canoniserAdresse_(s);
  else if (estMotifVehicule_(s)) s = canoniserVehicule_(s);
  s = casseTitreEntite_(s.replace(/\s+/g, ' ').trim());
  return s || null;
}

/**
 * Clé de FUSION/déduplication d'une entité (domaine + forme canonique). Deux libellés qui se
 * canonisent pareil partagent la clé → une seule ligne au référentiel. PUR.
 * @return {?string} null si l'entité n'est pas retenue (générique / propriétaire).
 */
function cleCanoniqueEntite_(domaine, nom) {
  var c = canoniserEntite_(nom);
  return c ? normaliserCle_(domaine) + '|' + normaliserCle_(c) : null;
}

/**
 * Cherche une ligne EXISTANTE du même domaine fusionnable par inclusion avec `nom`. PUR (sur cache).
 * @param {string} nom
 * @param {Object} cache
 * @param {string} domaine
 * @return {?Object} la ligne canonique, ou null.
 */
function chercherLigneFusionnable_(nom, cache, domaine) {
  var d = normaliserCle_(domaine);
  for (var i = 0; i < cache.lignes.length; i++) {
    var l = cache.lignes[i];
    if (normaliserCle_(l.domaine) !== d) continue;
    if (l.statut.indexOf('refus') === 0 || l.statut.indexOf('variante') === 0) continue; // déjà écartée
    if (estFusionnableEntite_(nom, l.entite)) return l;
  }
  return null;
}

/* ---------- Garde anti-variantes (ADR-0002 §4) — logique PURE, testée ----------
 * But : éviter la prolifération d'entités quasi-doublons (« Desjardins » vs « Caisse Desjardins »,
 * « Hydro Quebec » vs « Hydro-Québec », fautes de frappe). On ne FUSIONNE jamais tout seul : on
 * PROPOSE la variante la plus proche pour que Marc tranche en 1 clic. Combine 3 signaux : recouvrement
 * de jetons (Jaccard), inclusion (un nom ⊆ l'autre), et distance d'édition (typos/ponctuation). */

var STOPWORDS_ENTITE = ['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'a', 'au', 'aux', 'en',
  'the', 'of', 'and', 'un', 'une'];

/** Jetons SIGNIFICATIFS d'un libellé : normalisé, coupé sur séparateurs, mots-outils retirés. */
function tokensEntite_(nom) {
  return normaliserCle_(nom).split(/[\s\-_/.]+/).filter(function (t) {
    return t && STOPWORDS_ENTITE.indexOf(t) === -1;
  });
}

/** Similarité de Jaccard entre deux ensembles de jetons (0..1). */
function jaccardTokens_(a, b) {
  if (!a.length && !b.length) return 0;
  var setB = {}, inter = 0, union = {};
  for (var i = 0; i < b.length; i++) { setB[b[i]] = true; union[b[i]] = true; }
  for (var j = 0; j < a.length; j++) {
    union[a[j]] = true;
    if (setB[a[j]]) { inter++; setB[a[j]] = false; } // compte chaque jeton une fois
  }
  var u = Object.keys(union).length;
  return u ? inter / u : 0;
}

/** Distance d'édition de Levenshtein (itérative, O(n·m), bornée aux libellés courts). */
function distanceLevenshtein_(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      var cout = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cout);
    }
    for (j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * Score de similarité entre deux libellés d'entité (0..1). Max de : Jaccard des jetons,
 * inclusion (jetons du plus court tous dans le plus long → 0.9), et ratio de Levenshtein.
 */
function similariteEntite_(a, b) {
  var na = normaliserCle_(a), nb = normaliserCle_(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  var ta = tokensEntite_(a), tb = tokensEntite_(b);
  var jac = jaccardTokens_(ta, tb);
  var court = ta.length <= tb.length ? ta : tb;
  var lng = ta.length <= tb.length ? tb : ta;
  var inclus = court.length > 0 && court.every(function (t) { return lng.indexOf(t) !== -1; });
  // Levenshtein = détection de FAUTE DE FRAPPE : petite distance ABSOLUE (≤ 2) sur un libellé assez long
  // (≥ 5). On évite ainsi les faux positifs sur acronymes courts (« EDF » ≈ « GDF ») et sur des libellés
  // au préfixe commun mais distincts (« Ville de Paris » ≈ « Ville de Lyon », distance grande). Capte le
  // typo même multi-mots (« Caisse Desjardin » ≈ « Caisse Desjardins »).
  var maxl = Math.max(na.length, nb.length);
  var typo = (maxl >= 5 && distanceLevenshtein_(na, nb) <= 2) ? 0.9 : 0;
  return Math.max(jac, inclus ? 0.9 : 0, typo);
}

/**
 * Cherche la meilleure VARIANTE possible de `nom` parmi `existants` (mêmes domaine, libellés).
 * Ignore un libellé strictement identique (ce n'est pas une variante mais le même — géré ailleurs).
 * @param {string} nom
 * @param {string[]} existants
 * @param {number} seuil  score minimal (0..1) pour proposer une variante
 * @return {?{nom:string, score:number}} la meilleure au-dessus du seuil, ou null.
 */
function chercherVariante_(nom, existants, seuil) {
  var meilleure = null, cible = normaliserCle_(nom);
  for (var i = 0; i < (existants || []).length; i++) {
    if (normaliserCle_(existants[i]) === cible) continue; // identique = pas une variante
    var s = similariteEntite_(nom, existants[i]);
    if (s >= seuil && (!meilleure || s > meilleure.score)) meilleure = { nom: existants[i], score: s };
  }
  return meilleure;
}

/** Libellés d'entités déjà connues DU MÊME DOMAINE (pour comparer une nouvelle proposition). */
function entitesMemeDomaine_(cache, domaine) {
  var d = normaliserCle_(domaine), noms = [];
  for (var i = 0; i < cache.lignes.length; i++) {
    if (normaliserCle_(cache.lignes[i].domaine) === d) noms.push(cache.lignes[i].entite);
  }
  return noms;
}

/** Indices de colonnes (0-based) par nom d'en-tête ; ajoute les colonnes manquantes. */
function colonnesEntites_() {
  var f = feuille_('Entités');
  var entetes = f.getRange(1, 1, 1, Math.max(f.getLastColumn(), 1)).getValues()[0];
  var manquantes = [];
  COLONNES_ENTITES.forEach(function (nom) {
    if (entetes.indexOf(nom) === -1) manquantes.push(nom);
  });
  if (manquantes.length) {
    // Auto-réparation : on ajoute les colonnes absentes à la suite (sans toucher aux données).
    f.getRange(1, entetes.length + 1, 1, manquantes.length).setValues([manquantes]);
    entetes = entetes.concat(manquantes);
  }
  var idx = {};
  entetes.forEach(function (nom, i) { if (nom) idx[nom] = i; });
  return idx;
}

/** Charge le référentiel en mémoire (1×/run). */
function chargerEntitesCache_() {
  var f = feuille_('Entités');
  var idx = colonnesEntites_();
  _entitesCache = { lignes: [], parCle: {} };

  var dern = f.getLastRow();
  if (dern < 2) return;
  var valeurs = f.getRange(2, 1, dern - 1, f.getLastColumn()).getValues();

  for (var i = 0; i < valeurs.length; i++) {
    var v = valeurs[i];
    var entite = v[idx['Entité']];
    if (!entite) continue;
    var ligne = {
      ligneSheet: i + 2, // 1-based, +1 pour l'en-tête
      entite: entite,
      domaine: v[idx['Domaine']] || '',
      categorie: v[idx['Catégorie']] || '',
      type: v[idx['Type']] || '',
      statut: normaliserCle_(v[idx['Statut']]),
      dossierId: v[idx['Dossier ID']] || '',
      variante: v[idx['Variante possible ?']] || '',     // #18 : variante non résolue = validation manuelle
      vuNFois: Number(v[idx['Vu N fois']]) || 1          // #18 : signal de fréquence
    };
    _entitesCache.lignes.push(ligne);
    _entitesCache.parCle[cleEntite_(ligne.domaine, ligne.entite)] = ligne;
  }
}

function entitesCache_() {
  if (_entitesCache === null) chargerEntitesCache_();
  return _entitesCache;
}

/**
 * Carte des entités VALIDÉES du référentiel : cleCanoniqueEntite_ → libellé canonique. 1 lecture de
 * cache/run. Consommée par le ROUTAGE v2 (verrou « dossier d'entité seulement si validée »,
 * ADR-0023 révisé) et par la CONSOLIDATION (cible du plan) — la MÊME carte des deux côtés, sinon le
 * plan contredirait le flux vivant. Un référentiel illisible rend {} (échec fermé : à plat).
 * @return {Object} {cleCanonique: libellé canonique}
 */
function entitesValideesParCle_() {
  var validees = {};
  try {
    var cache = entitesCache_(); // accesseur (chargerEntitesCache_ remplit la globale, ne retourne rien)
    for (var i = 0; i < cache.lignes.length; i++) {
      var l = cache.lignes[i];
      if (!estValidee_(l.statut)) continue;
      var cle = cleCanoniqueEntite_(l.domaine, l.entite);
      if (cle) validees[cle] = canoniserEntite_(l.entite);
    }
  } catch (e) {
    journalErreur_('Entités', 'Référentiel illisible (aucun dossier d\'entité ce run — à plat) : ' + e);
  }
  return validees;
}

/** Une entité est « validée » dès que son statut le dit (tolère « validee » et « validee (auto ≥3) » — #18). */
function estValidee_(statut) {
  return statut === 'validee' || statut === 'validée' || statut === 'valide' ||
    String(statut).indexOf('validee (auto') === 0 || String(statut).indexOf('validée (auto') === 0;
}

/**
 * Résout l'entité devinée par le LLM contre le référentiel.
 * @param {Object} classif
 * @return {{etat:string, dossierId?:string, type?:string}}
 *   etat ∈ { 'transverse', 'connue', 'en_attente', 'inconnue' }
 */
function resoudreEntite_(classif) {
  if (!classif.entite) return { etat: 'transverse' };
  // P4 (C28-10) : la requête entrante est CANONISÉE avant le matching — les variantes d'une même
  // entité réelle (« 3325 4e ave, app 5 » vs « 3325 4e Avenue ») résolvent vers la même ligne.
  // Canonique null = générique ou le propriétaire lui-même : jamais une entité (doc au domaine).
  var nomCanonique = canoniserEntite_(classif.entite);
  if (!nomCanonique) return { etat: 'transverse' };
  var ligne = entitesCache_().parCle[cleEntite_(classif.domaine, nomCanonique)];
  if (!ligne) return { etat: 'inconnue' };
  if (estValidee_(ligne.statut) && ligne.dossierId) {
    // On renvoie domaine/catégorie/entité DE LA LIGNE validée (source de vérité du
    // chemin), pas du classif du document (qui peut diverger d'un doc à l'autre).
    return {
      etat: 'connue', dossierId: ligne.dossierId, type: ligne.type,
      entite: ligne.entite, domaine: ligne.domaine, categorie: ligne.categorie
    };
  }
  return { etat: 'en_attente' };
}

/** Devine le type d'entité (→ schéma de sous-dossiers) d'après domaine/catégorie. */
function typeEntiteDevine_(classif) {
  var cat = normaliserCle_(classif.categorie);
  if (cat === 'logement') return 'Logement';
  if (cat === 'vehicule') return 'Véhicule';
  if (classif.domaine === '06 · Études & diplômes') return 'Diplôme';
  if (classif.domaine === '02 · Finances') return 'Compte financier';
  return '';
}

/**
 * Propose une nouvelle entité (ligne « en_attente », pré-remplie). Idempotent dans le run.
 * Écrire cette ligne n'est PAS créer un dossier → anti-prolifération respecté.
 * @param {Object} classif
 */
function entiteEnAttenteAjouter_(classif) {
  if (!classif.entite) return;
  // P4 (C28-10) : la proposition naît sous sa forme CANONIQUE — « Ford Fiesta SE 2011 » et
  // « Ford Fiesta 2011 » se réduisent au même nom AVANT d'entrer dans la file (fini les N formes
  // du même appartement). Canonique null = générique ou propriétaire (subsume le filtre #10) :
  // jamais proposé, le document reste classé au domaine.
  var nomCanonique = canoniserEntite_(classif.entite);
  if (!nomCanonique) return;
  var cle = cleEntite_(classif.domaine, nomCanonique);
  var cache = entitesCache_();
  if (cache.parCle[cle]) return; // déjà proposée ou connue

  // Consolidation (#10) : si une ligne du même domaine désigne déjà la MÊME entité (inclusion de
  // jetons), pas de n-ième ligne — on incrémente son « Vu N fois » — signal de fréquence PARTIEL : seules les FORMES VARIANTES
  // comptent (un hit de clé exacte sort plus haut sans I/O, discipline de lecture oblige).
  // JAMAIS d'alias dans parCle (revue flotte) : aliaser vers une ligne VALIDÉE ferait router les
  // documents suivants du run dans son dossier sous un autre libellé = fusion automatique de facto,
  // interdite (TAXONOMY : « suggestion seulement »). Sans alias, chaque re-proposition re-scanne et
  // re-incrémente — comptage de fréquence plus juste, et le document reste classé au domaine tant
  // que Marc n'a pas fusionné/validé explicitement.
  var canonique = chercherLigneFusionnable_(nomCanonique, cache, classif.domaine);
  if (canonique) {
    incrementerVuEntite_(canonique);
    return;
  }

  var type = typeEntiteDevine_(classif);
  // Garde anti-variantes (ADR-0002 §4) : propose la plus proche entité EXISTANTE du même domaine —
  // pour que Marc fusionne en 1 clic au lieu de créer un quasi-doublon. Suggestion seulement, jamais auto.
  var variante = chercherVariante_(nomCanonique, entitesMemeDomaine_(cache, classif.domaine), CONFIG.SEUIL_VARIANTE);

  // P4 (C28-10) — « reality check » Drive : si un dossier du domaine porte DÉJÀ ce nom (créé à la
  // main par Marc, par une validation passée ou par la réorg #21), la proposition naît directement
  // VALIDÉE et pointe vers lui — jamais une n-ième forme « en attente » d'un dossier qui existe.
  // Lecture seule (inventaire paresseux 1×/domaine/run), aucun dossier créé ni déplacé ici.
  var idExistant = dossiersExistantsDomaine_(classif.domaine)[normaliserCle_(nomCanonique)] || '';
  var statut = idExistant ? 'validée' : 'en_attente';

  var f = feuille_('Entités');
  var idx = colonnesEntites_();
  var ligne = [];
  ligne[idx['Entité']] = nomCanonique;
  ligne[idx['Domaine']] = classif.domaine || '';
  ligne[idx['Catégorie']] = classif.categorie || '';
  ligne[idx['Type']] = type;
  ligne[idx['Statut']] = statut;
  ligne[idx['Dossier ID']] = idExistant;
  ligne[idx['Ajoutée le']] = new Date();
  ligne[idx['Variante possible ?']] = variante
    ? '→ ' + variante.nom + ' (' + Math.round(variante.score * 100) + ' %) ?'
    : '';
  ligne[idx['Vu N fois']] = 1;
  for (var i = 0; i < ligne.length; i++) if (ligne[i] === undefined) ligne[i] = '';
  f.appendRow(ligne);
  if (idExistant) journalInfo_('Entités', 'Entité existante dans Drive auto-validée : ' + nomCanonique);

  // Met le cache à jour (parCle + lignes) pour éviter une 2e proposition dans le même run.
  var nouvelle = {
    ligneSheet: f.getLastRow(), entite: nomCanonique, domaine: classif.domaine || '',
    categorie: classif.categorie || '', type: type, statut: statut, dossierId: idExistant
  };
  cache.parCle[cle] = nouvelle;
  cache.lignes.push(nouvelle);
}

/**
 * Sous-dossiers EXISTANTS d'un domaine (nom normalisé → ID), inventaire PARESSEUX borné (≤ 500),
 * mis en cache pour le run (P4/C28-10 : les propositions d'entités consultent la structure Drive
 * réelle avant de proposer). Lecture seule — un échec Drive dégrade en table vide (cachée elle
 * aussi : jamais de re-tentative par document dans le même run).
 * @param {string} domaine
 * @return {Object<string,string>}
 */
function dossiersExistantsDomaine_(domaine) {
  if (_dossiersDomaineCache[domaine]) return _dossiersDomaineCache[domaine];
  var table = {};
  try {
    var it = DriveApp.getFolderById(idDomaine_(domaine)).getFolders();
    var n = 0;
    while (it.hasNext() && n < 500) {
      var d = it.next();
      table[normaliserCle_(d.getName())] = d.getId();
      n++;
    }
  } catch (e) {
    journalErreur_('Entités', 'Inventaire des dossiers du domaine impossible (' + domaine + ') : ' + e);
  }
  _dossiersDomaineCache[domaine] = table;
  return table;
}

/* ---------- C28-26 : SEED des entités de Marc (décision 2026-07-17 : « c'est toi qui le fais ») ---------- */

// Les listes RÉELLES données par Marc (2026-07-16/17) — libellés en forme CANONIQUE (chacun est un
// point fixe de canoniserEntite_, verrouillé par test) : ce sont les SEULS dossiers d'entité voulus.
var SEED_ENTITES = [
  // 4 logements
  { domaine: '03 · Logement & véhicule', entite: '3325 4e Avenue' },
  { domaine: '03 · Logement & véhicule', entite: '783 Avenue Moreau' },
  { domaine: '03 · Logement & véhicule', entite: '3987 Route Des Rivières' },
  { domaine: '03 · Logement & véhicule', entite: '1548 Avenue De La Roselière' },
  // 3 véhicules (l'année n'entre jamais dans le libellé — canoniserVehicule_)
  { domaine: '03 · Logement & véhicule', entite: 'Ford Fiesta' },
  { domaine: '03 · Logement & véhicule', entite: 'VW Jetta' },
  { domaine: '03 · Logement & véhicule', entite: 'Toyota bZ' },
  // 2 employeurs (le reste de 05 = candidatures, jamais des dossiers)
  { domaine: '05 · Carrière', entite: 'Automatech' },
  { domaine: '05 · Carrière', entite: 'Robovic' },
  // 6 étapes du parcours scolaire
  { domaine: '06 · Études & diplômes', entite: 'Lycée Thérèse d\'Avila' },
  { domaine: '06 · Études & diplômes', entite: 'Lycée Gustave Eiffel' },
  { domaine: '06 · Études & diplômes', entite: 'IUT Du Littoral' },
  { domaine: '06 · Études & diplômes', entite: 'Cégep De Sherbrooke' },
  { domaine: '06 · Études & diplômes', entite: 'IMERIR' },
  { domaine: '06 · Études & diplômes', entite: 'HAMK' },
];

/**
 * Seed ONE-SHOT (gaté par `CONFIG.SEED_ENTITES_TAG`) des entités de Marc :
 *  1. promeut chaque entrée de SEED_ENTITES en « validée » (via `promouvoirEntiteValidee_` —
 *     idempotente, exactement la sémantique « validation explicite de Marc ») ;
 *  2. DÉVALIDE toute entité encore validée dans `02 · Finances` (« faut pas faire un dossier par
 *     banque » — les documents financiers vont dans l'ANNÉE du domaine) : statut → refus tracé,
 *     jamais de suppression de ligne ni de dossier (les dossiers existants se vident par la
 *     consolidation, puis corbeille APP ADR-0014).
 * Le tag n'est posé qu'après une passe COMPLÈTE sans exception (sinon re-tenté au tick suivant).
 */
function seedEntitesMarc_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_SEED_ENTITES') === CONFIG.SEED_ENTITES_TAG) return; // déjà fait

  for (var i = 0; i < SEED_ENTITES.length; i++) {
    promouvoirEntiteValidee_({ domaine: SEED_ENTITES[i].domaine, entite: SEED_ENTITES[i].entite });
  }

  // « Pas de dossier par banque » : dévalidation des entités 02 (statut seul — aucune ligne ni
  // dossier supprimés, §2). Une entité dévalidée ne route plus (entitesValideesParCle_ filtre) et
  // la consolidation cible ses fichiers vers l'année du domaine.
  var cache = entitesCache_();
  var idx = colonnesEntites_();
  var f = feuille_('Entités');
  for (var j = 0; j < cache.lignes.length; j++) {
    var l = cache.lignes[j];
    if (l.domaine !== '02 · Finances' || !estValidee_(l.statut)) continue;
    f.getRange(l.ligneSheet, idx['Statut'] + 1).setValue('refusée (pas de dossier par banque — décision Marc 2026-07-17)');
    l.statut = 'refusée (pas de dossier par banque — décision Marc 2026-07-17)';
    journalInfo_('Entités', 'Entité 02 dévalidée (pas de dossier par banque) : ' + l.entite);
  }

  props.setProperty('DriveAI_SEED_ENTITES', CONFIG.SEED_ENTITES_TAG);
  journalInfo_('Entités', 'Seed des entités de Marc appliqué (tag « ' + CONFIG.SEED_ENTITES_TAG + ' ») : ' +
    SEED_ENTITES.length + ' entités validées, banques 02 dévalidées.');
}

/* ---------- C6-04 : promotion d'une entité par correction (ADR-0003) ---------- */

/** Une correction VALIDE une entité si elle nomme À LA FOIS l'entité et son domaine (routage possible). */
function correctionValideUneEntite_(corr) {
  return !!(corr && String(corr.entite == null ? '' : corr.entite).trim()
                 && String(corr.domaine == null ? '' : corr.domaine).trim());
}

/**
 * Promeut l'entité d'une correction en « validée » dans le référentiel (find-or-create). C'est une
 * validation EXPLICITE de Marc (via le formulaire de correction) — PAS une auto-prolifération : au
 * prochain tick, `creerDossiersEntitesValidees_` matérialise le dossier et le routage l'utilise.
 * Idempotent : aucune lecture/écriture Sheet si l'entité est déjà validée (no-op via le cache).
 * @param {{domaine:string, entite:string}} corr  correction du formulaire (`categorie` n'arrive jamais
 *   par ce chemin → le Type est deviné du seul domaine ; cf. dégradation `03` documentée dans TAXONOMY).
 * @return {boolean} true si une entité a été créée ou promue.
 */
function promouvoirEntiteValidee_(corr) {
  if (!correctionValideUneEntite_(corr)) return false;
  var cache = entitesCache_();
  var cle = cleEntite_(corr.domaine, corr.entite);
  var ligne = cache.parCle[cle];
  if (ligne && estValidee_(ligne.statut)) return false; // déjà validée → aucune I/O Sheet

  var idx = colonnesEntites_();
  var f = feuille_('Entités');
  // Saisie EXPLICITE de Marc : jamais filtrée (le formulaire prime) — mais on AVERTIT si le libellé
  // est générique (un dossier « banque/ » va être matérialisé) ou si la ligne avait été refusée.
  if (estEntiteGenerique_(corr.entite)) {
    journalInfo_('Entités', 'Avertissement : entité validée au libellé GÉNÉRIQUE « ' + corr.entite +
      ' » (un dossier générique sera créé — renommer l\'entité dans la Sheet si besoin).');
  }
  if (ligne) {
    if (ligne.statut.indexOf('refus') === 0) {
      journalInfo_('Entités', 'Note : « ' + ligne.entite + ' » avait été refusée par la curation — re-validée sur demande explicite.');
    }
    // Entité déjà proposée (en_attente) → on la passe « validée » (déplacement seul de statut).
    f.getRange(ligne.ligneSheet, idx['Statut'] + 1).setValue('validée');
    ligne.statut = 'validee'; // maj cache (normalisé, cohérent avec chargerEntitesCache_)
    journalInfo_('Entités', 'Entité validée par correction : ' + ligne.entite);
    return true;
  }

  // Entité inconnue → ajoutée directement validée (Marc l'a explicitement désignée). On ne fusionne/refuse
  // JAMAIS tout seul (saisie explicite prime), mais on ne jette pas le signal anti-variantes (#4) : si un
  // quasi-doublon validé existe déjà (« Desjardins » vs « Caisse Desjardins »), on le SIGNALE pour fusion
  // 1-clic a posteriori, comme à la proposition (`entiteEnAttenteAjouter_`).
  var type = typeEntiteDevine_({ domaine: corr.domaine, categorie: corr.categorie || '' });
  var variante = chercherVariante_(corr.entite, entitesMemeDomaine_(cache, corr.domaine), CONFIG.SEUIL_VARIANTE);
  var nouvelle = [];
  nouvelle[idx['Entité']] = corr.entite;
  nouvelle[idx['Domaine']] = corr.domaine;
  nouvelle[idx['Catégorie']] = corr.categorie || '';
  nouvelle[idx['Type']] = type;
  nouvelle[idx['Statut']] = 'validée';
  nouvelle[idx['Dossier ID']] = '';
  nouvelle[idx['Ajoutée le']] = new Date();
  nouvelle[idx['Variante possible ?']] = variante
    ? '→ ' + variante.nom + ' (' + Math.round(variante.score * 100) + ' %) ?'
    : '';
  for (var i = 0; i < nouvelle.length; i++) if (nouvelle[i] === undefined) nouvelle[i] = '';
  f.appendRow(nouvelle);

  var enCache = {
    ligneSheet: f.getLastRow(), entite: corr.entite, domaine: corr.domaine,
    categorie: corr.categorie || '', type: type, statut: 'validee', dossierId: ''
  };
  cache.parCle[cle] = enCache;
  cache.lignes.push(enCache);
  journalInfo_('Entités', 'Entité créée et validée par correction : ' + corr.entite +
    (variante ? ' (variante possible de « ' + variante.nom + ' » — à fusionner si besoin)' : ''));
  return true;
}

/* ---------- P2-04 : création des dossiers d'entités validées ---------- */

/**
 * Dossier parent d'une entité : la RACINE du domaine, TOUJOURS (ADR-0023 : une entité validée = UN
 * dossier au niveau 1 du domaine, aligné sur le find-or-create du routeur v2 — l'ancien parent
 * « catégorie » créait un DOUBLE dossier par entité et nourrissait la prolifération, revue
 * structure-keeper C28-26). Le paramètre catégorie est conservé pour compat d'appel mais IGNORÉ.
 */
function dossierParentEntite_(domaine, categorie) {
  if (CONFIG.DOMAINES[domaine]) return DriveApp.getFolderById(CONFIG.DOMAINES[domaine]);
  // Domaine AUTO (ex. « 07 · Santé ») : le formulaire de correction le propose (domainesAutorises_) et
  // le LLM peut le renvoyer → il DOIT être matérialisable, sinon l'entité validée boucle en « Domaine
  // inconnu » à chaque tick (dossier jamais créé, entité jamais routable). find-or-create, zéro clic.
  if (domaineConnu_(domaine)) return dossierDomaineAuto_(domaine);
  return null;
}

/**
 * Crée les dossiers des entités VALIDÉES qui n'en ont pas encore.
 * Idempotent : un re-run ne duplique pas (réutilise un dossier de même nom). À
 * appeler en tête de tick, avant le routage, pour que les entités fraîchement
 * validées soient routables dans la foulée.
 *
 * Bornée par le garde-temps partagé ET un plafond par run (MAX_ENTITES_PAR_RUN) :
 * si Marc valide beaucoup d'entités d'un coup, le reste est matérialisé aux ticks
 * suivants — jamais de coupure des 6 min avant le traitement des documents.
 *
 * @param {function():boolean} [estBudgetDepasse]
 */
var MAX_ENTITES_PAR_RUN = 10;

function creerDossiersEntitesValidees_(estBudgetDepasse) {
  var cache = entitesCache_();
  var idx = colonnesEntites_();
  var f = feuille_('Entités');
  var creees = 0;

  for (var i = 0; i < cache.lignes.length; i++) {
    if (creees >= MAX_ENTITES_PAR_RUN || (estBudgetDepasse && estBudgetDepasse())) {
      journalInfo_('Entités', 'Reste des entités validées repris au prochain tick.');
      break;
    }
    var l = cache.lignes[i];
    if (!estValidee_(l.statut) || l.dossierId) continue;

    var parent = dossierParentEntite_(l.domaine, l.categorie);
    if (!parent) {
      journalErreur_('Entités', 'Domaine inconnu pour l\'entité « ' + l.entite + ' » — dossier non créé.');
      continue;
    }
    var dossier = sousDossier_(parent, String(l.entite));
    // ADR-0023 : PLUS JAMAIS de squelette de sous-dossiers (SCHEMAS_ENTITE) — le recensement
    // 2026-07-16 a mesuré ~100 dossiers vides nés de ces schémas jamais remplis. Le contenu de
    // l'entité vit À PLAT dans son dossier (le nom AAAA-MM-JJ_Type_Tiers porte l'information).
    f.getRange(l.ligneSheet, idx['Dossier ID'] + 1).setValue(dossier.getId());
    l.dossierId = dossier.getId(); // tient le cache à jour pour le routage du même run
    creees++;
    journalInfo_('Entités', 'Dossier d\'entité créé (racine du domaine, à plat) : ' + l.entite);
  }
  if (creees) journalInfo_('Entités', creees + ' dossier(s) d\'entité créé(s).');
}

/* ---------- Chantier #18 : auto-validation des entités fréquentes (seuil 3, décision Marc) ---------- */

/**
 * Éligibilité PURE (testée) : une ligne du référentiel peut-elle s'auto-valider ?
 * en_attente + vue ≥ seuil + PAS de variante possible (la fusion appartient à Marc) + PAS
 * générique (défense en profondeur — la curation #10 les refuse déjà) + JAMAIS un domaine
 * protégé (04 · Immigration : validation manuelle obligatoire).
 */
function estAutoValidable_(l, seuil, domainesProteges) {
  if (l.statut !== 'en_attente' && l.statut !== 'en attente') return false;
  if (l.dossierId) return false; // déjà matérialisée un jour : une réédition de Marc PRIME (donnée utilisateur)
  if ((Number(l.vuNFois) || 1) < seuil) return false;
  if (l.variante) return false;
  if (estEntiteGenerique_(l.entite)) return false;
  var proteges = (domainesProteges || []).map(normaliserCle_);
  if (proteges.indexOf(normaliserCle_(l.domaine)) !== -1) return false;
  return true;
}

/**
 * #18 (décision Marc 2026-07-06 : seuil 3) : les entités `en_attente` vues souvent s'auto-
 * valident — statut « validée (auto ≥N) », accepté par estValidee_, donc MATÉRIALISÉES par
 * creerDossiersEntitesValidees_ au même tick. Pour ANNULER : passer le Statut à « refusée »
 * (ou « variante de : X ») — un retour à « en_attente » serait re-validé au tick suivant ;
 * le dossier créé n'est jamais supprimé. Signalées au résumé hebdo. Bornée par run.
 * @param {function():boolean} [estBudgetDepasse]
 */
function autoValiderEntitesFrequentes_(estBudgetDepasse) {
  var cache = entitesCache_();
  var idx = colonnesEntites_();
  var f = feuille_('Entités');
  var faites = 0;
  for (var i = 0; i < cache.lignes.length; i++) {
    if (faites >= CONFIG.ENTITES_AUTO_MAX_PAR_RUN || (estBudgetDepasse && estBudgetDepasse())) break;
    var l = cache.lignes[i];
    if (!estAutoValidable_(l, CONFIG.ENTITES_AUTO_SEUIL, CONFIG.DOMAINES_PROTEGES)) continue;
    var libelle = 'validée (auto ≥' + CONFIG.ENTITES_AUTO_SEUIL + ')'; // seuil affiché = seuil réel
    f.getRange(l.ligneSheet, idx['Statut'] + 1).setValue(libelle);
    l.statut = normaliserCle_(libelle); // cache du run à jour (normalisé) → matérialisée CE tick
    faites++;
    journalInfo_('Entités', 'Entité auto-validée (vue ' + l.vuNFois + '×) : ' + l.entite +
      ' — pour annuler : Statut → « refusée ».');
  }
}

/** Entités au statut « validée (auto …) » — pour la visibilité du résumé hebdo (#18). */
function entitesAutoValidees_() {
  var lignes = entitesCache_().lignes.filter(function (l) {
    return String(l.statut).indexOf('validee (auto') === 0;
  });
  return {
    total: lignes.length,
    exemples: lignes.slice(0, 5).map(function (l) { return String(l.entite); })
  };
}

/* ---------- Chantier #10 : incrément de fréquence + curation one-shot ---------- */

/**
 * Incrémente « Vu N fois » d'une ligne du référentiel (signal de fréquence : Marc valide d'abord
 * les entités les plus vues). Lecture + écriture d'UNE cellule — événement rare (consolidation).
 * @param {{ligneSheet:number}} ligne
 */
function incrementerVuEntite_(ligne, colVu) {
  var f = feuille_('Entités');
  var col = colVu || (colonnesEntites_()['Vu N fois'] + 1); // l'appelant peut fournir la colonne (curation)
  var actuel = Number(f.getRange(ligne.ligneSheet, col).getValue()) || 1;
  f.getRange(ligne.ligneSheet, col).setValue(actuel + 1);
}

/**
 * Curation ONE-SHOT de la file d'entités (#10, ADR-0009), gatée par `CONFIG.CURATION_ENTITES_TAG` :
 * les `en_attente` génériques passent « refusée (générique) », les quasi-doublons par inclusion
 * sont regroupés « variante de : <canonique> » (la forme la plus COURTE, généralement la plus propre,
 * reste `en_attente` ; chaque variante regroupée incrémente son « Vu N fois » de +1). STATUTS SEULEMENT — aucun document déplacé,
 * 100 % réversible en rééditant le Statut. Bornée par le garde-temps, reprenable (les lignes déjà
 * requalifiées ne sont pas re-traitées) ; le tag n'est figé qu'après une passe COMPLÈTE.
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerCurationEntites_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_CURATION_ENTITES') === CONFIG.CURATION_ENTITES_TAG) return;
  if (estBudgetDepasse()) return;

  var f = feuille_('Entités');
  var idx = colonnesEntites_();
  var cache = entitesCache_();
  var colStatut = idx['Statut'] + 1;
  var refusees = 0, regroupees = 0, interrompue = false;

  // Passe 1 — génériques → « refusée (générique) ».
  var enAttente = [];
  for (var i = 0; i < cache.lignes.length; i++) {
    var l = cache.lignes[i];
    if (l.statut !== 'en_attente' && l.statut !== 'en attente') continue;
    if (estBudgetDepasse()) { interrompue = true; break; }
    if (estEntiteGenerique_(l.entite)) {
      f.getRange(l.ligneSheet, colStatut).setValue('refusée (générique)');
      l.statut = 'refusee (generique)';
      refusees++;
    } else {
      enAttente.push(l);
    }
  }

  // Passe 1.5 (P4/C28-10) — canonicalisation rétroactive : une ligne en_attente dont la forme
  // CANONIQUE rejoint une ligne VALIDÉE ou un canonique déjà vu dans la file passe « variante
  // de : X » (statuts seulement, réversible) ; un canonique NULL restant (ex. le propriétaire,
  // que la passe 1 « générique » ne voit pas) est refusé. Nettoie le stock accumulé AVANT ce
  // chantier — le chemin vivant, désormais canonisé à la source, n'en produira plus.
  if (!interrompue) {
    var parCanonique = {};
    for (var v = 0; v < cache.lignes.length; v++) {
      var lv = cache.lignes[v];
      if (!estValidee_(lv.statut)) continue;
      var kv = cleCanoniqueEntite_(lv.domaine, lv.entite);
      if (kv && !parCanonique[kv]) parCanonique[kv] = lv;
    }
    var restantes = [];
    for (var m = 0; m < enAttente.length; m++) {
      if (estBudgetDepasse()) { interrompue = true; break; }
      var le = enAttente[m];
      var ke = cleCanoniqueEntite_(le.domaine, le.entite);
      if (!ke) {
        f.getRange(le.ligneSheet, colStatut).setValue('refusée (générique)');
        le.statut = 'refusee (generique)';
        refusees++;
        continue;
      }
      var porteur = parCanonique[ke];
      if (porteur) {
        f.getRange(le.ligneSheet, colStatut).setValue('variante de : ' + porteur.entite);
        le.statut = 'variante de : ' + normaliserCle_(porteur.entite);
        incrementerVuEntite_(porteur, idx['Vu N fois'] + 1);
        regroupees++;
      } else {
        parCanonique[ke] = le;
        restantes.push(le);
      }
    }
    enAttente = restantes;
  }

  // Passe 2 — regroupement par inclusion : la plus COURTE d'un groupe reste en_attente (canonique),
  // les autres passent « variante de : X ». Tri par nb de jetons croissant → la canonique est vue
  // en premier et les suivantes se rattachent à elle.
  if (!interrompue) {
    enAttente.sort(function (a, b) { return jetonsQualite_(a.entite).length - jetonsQualite_(b.entite).length; });
    var gardees = [];
    for (var j = 0; j < enAttente.length; j++) {
      if (estBudgetDepasse()) { interrompue = true; break; }
      var cand = enAttente[j];
      var canonique = null;
      for (var k = 0; k < gardees.length; k++) {
        if (normaliserCle_(gardees[k].domaine) === normaliserCle_(cand.domaine) &&
            estFusionnableEntite_(cand.entite, gardees[k].entite)) { canonique = gardees[k]; break; }
      }
      if (canonique) {
        f.getRange(cand.ligneSheet, colStatut).setValue('variante de : ' + canonique.entite);
        cand.statut = 'variante de : ' + normaliserCle_(canonique.entite);
        incrementerVuEntite_(canonique, idx['Vu N fois'] + 1);
        regroupees++;
      } else {
        gardees.push(cand);
      }
    }
  }

  if (refusees || regroupees) {
    journalInfo_('Entités', 'Curation : ' + refusees + ' générique(s) refusé(s), ' + regroupees +
      ' variante(s) regroupée(s) (réversible — statuts seulement).');
  }
  if (!interrompue) {
    props.setProperty('DriveAI_CURATION_ENTITES', CONFIG.CURATION_ENTITES_TAG);
    journalInfo_('Entités', 'Curation de la file terminée (tag « ' + CONFIG.CURATION_ENTITES_TAG + ' »).');
  }
}
