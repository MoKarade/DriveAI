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

var COLONNES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?'];

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
  var maxl = Math.max(na.length, nb.length);
  var lev = maxl ? 1 - distanceLevenshtein_(na, nb) / maxl : 0;
  return Math.max(jac, inclus ? 0.9 : 0, lev);
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
  var cle = cleEntite_(classif.domaine, classif.entite);
  var cache = entitesCache_();
  if (cache.parCle[cle]) return; // déjà proposée ou connue

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

/* ---------- P2-04 : création des dossiers d'entités validées ---------- */

/** Dossier parent d'une entité : catégorie connue si dispo, sinon racine du domaine. */
function dossierParentEntite_(domaine, categorie) {
  var cats = CONFIG.CATEGORIES[domaine];
  if (cats && categorie && cats[categorie]) return DriveApp.getFolderById(cats[categorie]);
  if (CONFIG.DOMAINES[domaine]) return DriveApp.getFolderById(CONFIG.DOMAINES[domaine]);
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
