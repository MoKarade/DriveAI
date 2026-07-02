/**
 * Entites.gs — Référentiel d'entités (Phase 2).
 *
 * L'onglet `Entités` est le référentiel CURÉ : une entité n'est routée vers son
 * dossier que si Marc l'a validée (Statut = « validée »). Une entité inconnue ne
 * crée JAMAIS de dossier automatiquement — elle est proposée en « en_attente » et
 * le document part en revue (anti-prolifération, garde-fou non négociable).
 *
 * Colonnes (auto-réparées au besoin) :
 *   Entité | Domaine | Catégorie | Type | Statut | Dossier ID | Ajoutée le
 *
 * Lecture mise en cache 1×/run (leçon : jamais une lecture Sheet par item).
 */

var COLONNES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];

var _entitesCache = null; // { lignes: [...], parCle: { normKey: ligne } }

/** À appeler en tête de run pour repartir d'un cache neuf. */
function reinitialiserEntitesCache_() {
  _entitesCache = null;
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
  if (ta.length === tb.length && normaliserCle_(a) === normaliserCle_(b)) return true; // identiques
  var court = ta.length <= tb.length ? ta : tb;
  var long_ = ta.length <= tb.length ? tb : ta;
  if (!court.every(function (t) { return long_.indexOf(t) !== -1; })) return false;
  // Garde anti-effondrement (revue flotte) : une ANNÉE excédentaire distingue deux entités réelles
  // (« Honda Civic » n'avale ni « Honda Civic 2014 » ni « 2017 » — deux véhicules). Les autres jetons
  // excédentaires (« app 5 québec » d'une adresse, « carte de crédit » d'une banque) restent fusionnables.
  for (var i = 0; i < long_.length; i++) {
    if (court.indexOf(long_[i]) === -1 && /^(19|20)\d{2}$/.test(long_[i])) return false;
  }
  return true;
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
      dossierId: v[idx['Dossier ID']] || ''
    };
    _entitesCache.lignes.push(ligne);
    _entitesCache.parCle[cleEntite_(ligne.domaine, ligne.entite)] = ligne;
  }
}

function entitesCache_() {
  if (_entitesCache === null) chargerEntitesCache_();
  return _entitesCache;
}

/** Une entité est « validée » dès que son statut le dit (tolère « validee »). */
function estValidee_(statut) {
  return statut === 'validee' || statut === 'validée' || statut === 'valide';
}

/**
 * Résout l'entité devinée par le LLM contre le référentiel.
 * @param {Object} classif
 * @return {{etat:string, dossierId?:string, type?:string}}
 *   etat ∈ { 'transverse', 'connue', 'en_attente', 'inconnue' }
 */
function resoudreEntite_(classif) {
  if (!classif.entite) return { etat: 'transverse' };
  var ligne = entitesCache_().parCle[cleEntite_(classif.domaine, classif.entite)];
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
  // Filtre qualité (#10, ADR-0009) : un GÉNÉRIQUE (« banque », « cours de physique ») n'est jamais
  // proposé — le document reste classé au domaine, la file de validation reste propre.
  if (estEntiteGenerique_(classif.entite)) return;
  var cle = cleEntite_(classif.domaine, classif.entite);
  var cache = entitesCache_();
  if (cache.parCle[cle]) return; // déjà proposée ou connue

  // Consolidation (#10) : si une ligne du même domaine désigne déjà la MÊME entité (inclusion de
  // jetons), pas de n-ième ligne — on incrémente son « Vu N fois » (signal de fréquence pour Marc).
  // JAMAIS d'alias dans parCle (revue flotte) : aliaser vers une ligne VALIDÉE ferait router les
  // documents suivants du run dans son dossier sous un autre libellé = fusion automatique de facto,
  // interdite (TAXONOMY : « suggestion seulement »). Sans alias, chaque re-proposition re-scanne et
  // re-incrémente — comptage de fréquence plus juste, et le document reste classé au domaine tant
  // que Marc n'a pas fusionné/validé explicitement.
  var canonique = chercherLigneFusionnable_(classif.entite, cache, classif.domaine);
  if (canonique) {
    incrementerVuEntite_(canonique);
    return;
  }

  var type = typeEntiteDevine_(classif);
  // Garde anti-variantes (ADR-0002 §4) : propose la plus proche entité EXISTANTE du même domaine —
  // pour que Marc fusionne en 1 clic au lieu de créer un quasi-doublon. Suggestion seulement, jamais auto.
  var variante = chercherVariante_(classif.entite, entitesMemeDomaine_(cache, classif.domaine), CONFIG.SEUIL_VARIANTE);

  var f = feuille_('Entités');
  var idx = colonnesEntites_();
  var ligne = [];
  ligne[idx['Entité']] = classif.entite;
  ligne[idx['Domaine']] = classif.domaine || '';
  ligne[idx['Catégorie']] = classif.categorie || '';
  ligne[idx['Type']] = type;
  ligne[idx['Statut']] = 'en_attente';
  ligne[idx['Dossier ID']] = '';
  ligne[idx['Ajoutée le']] = new Date();
  ligne[idx['Variante possible ?']] = variante
    ? '→ ' + variante.nom + ' (' + Math.round(variante.score * 100) + ' %) ?'
    : '';
  ligne[idx['Vu N fois']] = 1;
  for (var i = 0; i < ligne.length; i++) if (ligne[i] === undefined) ligne[i] = '';
  f.appendRow(ligne);

  // Met le cache à jour (parCle + lignes) pour éviter une 2e proposition dans le même run.
  var nouvelle = {
    ligneSheet: f.getLastRow(), entite: classif.entite, domaine: classif.domaine || '',
    categorie: classif.categorie || '', type: type, statut: 'en_attente', dossierId: ''
  };
  cache.parCle[cle] = nouvelle;
  cache.lignes.push(nouvelle);
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

/** Dossier parent d'une entité : catégorie connue si dispo, sinon racine du domaine (fixe OU auto-créé). */
function dossierParentEntite_(domaine, categorie) {
  var cats = CONFIG.CATEGORIES[domaine];
  if (cats && categorie && cats[categorie]) return DriveApp.getFolderById(cats[categorie]);
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
    // Sous-dossiers fixes selon le type (aucun si type non reconnu).
    var schema = CONFIG.SCHEMAS_ENTITE[l.type] || [];
    for (var s = 0; s < schema.length; s++) sousDossier_(dossier, schema[s]);

    f.getRange(l.ligneSheet, idx['Dossier ID'] + 1).setValue(dossier.getId());
    l.dossierId = dossier.getId(); // tient le cache à jour pour le routage du même run
    creees++;
    journalInfo_('Entités', 'Dossier d\'entité créé : ' + l.entite +
      (schema.length ? ' (+' + schema.length + ' sous-dossiers)' : ''));
  }
  if (creees) journalInfo_('Entités', creees + ' dossier(s) d\'entité créé(s).');
}

/* ---------- Chantier #10 : incrément de fréquence + curation one-shot ---------- */

/**
 * Incrémente « Vu N fois » d'une ligne du référentiel (signal de fréquence : Marc valide d'abord
 * les entités les plus vues). Lecture + écriture d'UNE cellule — événement rare (consolidation).
 * @param {{ligneSheet:number}} ligne
 */
function incrementerVuEntite_(ligne) {
  var f = feuille_('Entités');
  var col = colonnesEntites_()['Vu N fois'] + 1;
  var actuel = Number(f.getRange(ligne.ligneSheet, col).getValue()) || 1;
  f.getRange(ligne.ligneSheet, col).setValue(actuel + 1);
}

/**
 * Curation ONE-SHOT de la file d'entités (#10, ADR-0009), gatée par `CONFIG.CURATION_ENTITES_TAG` :
 * les `en_attente` génériques passent « refusée (générique) », les quasi-doublons par inclusion
 * sont regroupés « variante de : <canonique> » (la forme la plus COURTE, généralement la plus propre,
 * reste `en_attente` et cumule les « Vu N fois »). STATUTS SEULEMENT — aucun document déplacé,
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
        incrementerVuEntite_(canonique);
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
