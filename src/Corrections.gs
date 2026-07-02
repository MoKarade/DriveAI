/**
 * Corrections.gs — Boucle d'apprentissage (ADR-0003 §3, chantier #5).
 *
 * Onglet `Corrections` : chaque ligne est un classement que Marc a corrigé
 *   (Fichier | Émetteur | Domaine | Catégorie | Entité | Type | Corrigé le).
 * À CHAQUE nouveau classement, on injecte dans le prompt LLM les corrections les PLUS PROCHES
 * (même émetteur) comme exemples few-shot, BORNÉ (top-N, pour le coût). Effet : prévisible sur le
 * récurrent (mêmes fournisseurs/écoles), souple ailleurs.
 *
 * La logique de SÉLECTION et de FORMATAGE est PURE (testée) ; seule la lecture/écriture de l'onglet
 * touche la Sheet. Lecture mise en cache 1×/run (leçon : jamais une lecture Sheet par item).
 *
 * NB : le CANAL de correction (mail → mini-formulaire Google) est le chantier #6 ; ici on fournit le
 * référentiel, la sélection few-shot et la primitive d'enregistrement `enregistrerCorrection_`.
 */

var COLONNES_CORRECTIONS = ['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le'];

var _correctionsCache = null; // { lignes: [{fichier, emetteur, domaine, categorie, entite, type}], cles: {} }

/** À appeler en tête de run pour repartir d'un cache neuf. */
function reinitialiserCorrectionsCache_() {
  _correctionsCache = null;
}

/* ---------- Sélection few-shot — logique PURE, testée ---------- */

/**
 * Pertinence d'une correction pour le document courant (0..1). Signal = ÉMETTEUR : une correction
 * enregistrée pour « EDF » est très pertinente si le document courant vient manifestement d'EDF
 * (nom de fichier / expéditeur / sujet). On ne connaît PAS encore le type/domaine du doc (c'est ce
 * qu'on classe) → on s'appuie sur l'émetteur, seul signal disponible avant l'appel LLM.
 * @param {{nomFichier?:string, expediteur?:string, sujet?:string}} meta
 * @param {{emetteur?:string}} corr
 * @return {number}
 */
function scoreCorrection_(meta, corr) {
  var emetteur = normaliserCle_(corr && corr.emetteur);
  if (!emetteur) return 0;
  var foin = normaliserCle_([meta.nomFichier, meta.expediteur, meta.sujet].join(' '));
  if (!foin) return 0;
  if (foin.indexOf(emetteur) !== -1) return 1; // nom d'émetteur présent tel quel → certain
  // Sinon : proportion des jetons SIGNIFICATIFS de l'émetteur retrouvés dans le texte du document.
  var te = tokensEntite_(corr.emetteur);
  if (!te.length) return 0;
  var tf = tokensEntite_(foin);
  var communs = 0;
  for (var i = 0; i < te.length; i++) if (tf.indexOf(te[i]) !== -1) communs++;
  return communs / te.length;
}

/**
 * Les `maxN` corrections les plus pertinentes (score ≥ `seuil`), triées par pertinence décroissante.
 * @param {Object} meta
 * @param {Array} corrections
 * @param {number} maxN
 * @param {number} seuil
 * @return {Array}
 */
function correctionsPertinentes_(meta, corrections, maxN, seuil) {
  var notees = [];
  for (var i = 0; i < (corrections || []).length; i++) {
    var s = scoreCorrection_(meta, corrections[i]);
    if (s >= seuil) notees.push({ corr: corrections[i], score: s, i: i });
  }
  // Tri stable sur (score desc, ordre d'origine) — pas de Math.random, déterministe pour les tests.
  notees.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
  return notees.slice(0, maxN).map(function (x) { return x.corr; });
}

/**
 * Formate des corrections en bloc d'exemples few-shot à préfixer au prompt (chaîne vide si aucune).
 * @param {Array} corrections
 * @return {string}
 */
function blocFewShot_(corrections) {
  if (!corrections || !corrections.length) return '';
  // On n'injecte QUE les cibles stables par émetteur : domaine, catégorie, entité. PAS le `type` de
  // document : un même émetteur (EDF…) envoie une facture puis un contrat — injecter un type passé
  // biaiserait `type_doc` du document courant (le type se déduit du contenu, pas de l'émetteur).
  var lignes = [];
  corrections.forEach(function (c) {
    var parts = [];
    if (c.domaine) parts.push('domaine « ' + c.domaine + ' »');
    if (c.categorie) parts.push('catégorie « ' + c.categorie + ' »');
    // #10 : un générique hérité (saisie libre du formulaire) n'est jamais INJECTÉ en exemple —
  // sinon le few-shot enseignerait exactement ce que le prompt système interdit (et il gagnerait).
  // La donnée brute reste dans l'onglet (réversible) ; seul l'exemple prompt est filtré.
  if (c.entite && !estEntiteGenerique_(c.entite)) parts.push('entité « ' + c.entite + ' »');
    if (!parts.length) return; // aucune cible → aucun signal d'apprentissage : on saute (pas de slot gâché)
    lignes.push('- Émetteur « ' + c.emetteur + ' » → ' + parts.join(', ') + '.');
  });
  if (!lignes.length) return '';
  return 'Classements déjà corrigés par l\'utilisateur pour des émetteurs similaires ' +
    '(fais-en ta référence si le document correspond) :\n' + lignes.join('\n');
}

/** Bloc few-shot pour le document `meta`, prêt à préfixer au prompt (depuis le cache de corrections). */
function exemplesFewShot_(meta) {
  var pertinentes = correctionsPertinentes_(
    meta, correctionsCache_().lignes, CONFIG.FEWSHOT_MAX, CONFIG.FEWSHOT_SEUIL);
  return blocFewShot_(pertinentes);
}

/* ---------- Lecture / écriture de l'onglet (effectful) ---------- */

/** Indices de colonnes (0-based) par nom d'en-tête ; ajoute les colonnes manquantes. */
function colonnesCorrections_() {
  var f = feuille_('Corrections');
  var entetes = f.getRange(1, 1, 1, Math.max(f.getLastColumn(), 1)).getValues()[0];
  var manquantes = [];
  COLONNES_CORRECTIONS.forEach(function (nom) {
    if (entetes.indexOf(nom) === -1) manquantes.push(nom);
  });
  if (manquantes.length) {
    f.getRange(1, entetes.length + 1, 1, manquantes.length).setValues([manquantes]);
    entetes = entetes.concat(manquantes);
  }
  var idx = {};
  entetes.forEach(function (nom, i) { if (nom) idx[nom] = i; });
  return idx;
}

/** Charge les corrections en mémoire (1×/run). */
function chargerCorrectionsCache_() {
  var f = feuille_('Corrections');
  var idx = colonnesCorrections_();
  _correctionsCache = { lignes: [], cles: {} };

  var dern = f.getLastRow();
  if (dern < 2) return;
  var valeurs = f.getRange(2, 1, dern - 1, f.getLastColumn()).getValues();
  for (var i = 0; i < valeurs.length; i++) {
    var v = valeurs[i];
    var emetteur = v[idx['Émetteur']];
    if (!emetteur) continue;
    var ligne = {
      fichier: v[idx['Fichier']] || '',
      emetteur: emetteur,
      domaine: v[idx['Domaine']] || '',
      categorie: v[idx['Catégorie']] || '',
      entite: v[idx['Entité']] || '',
      type: v[idx['Type']] || ''
    };
    _correctionsCache.lignes.push(ligne);
    _correctionsCache.cles[cleCorrection_(ligne)] = true;
  }
}

function correctionsCache_() {
  if (_correctionsCache === null) chargerCorrectionsCache_();
  return _correctionsCache;
}

/** Clé d'idempotence d'une correction (émetteur + cible) — évite les doublons de lignes. */
function cleCorrection_(c) {
  return [c.emetteur, c.domaine, c.categorie, c.entite, c.type]
    .map(function (x) { return normaliserCle_(x); }).join('|');
}

/**
 * Enregistre une correction (append idempotent) → alimente le référentiel few-shot.
 * NB : le report d'une correction d'ENTITÉ vers le référentiel `Entités` validé (pour que le routage
 * futur en tienne compte) relève du chantier #6, avec le canal de saisie — PAS fait ici.
 * @param {{fichier?:string, emetteur:string, domaine?:string, categorie?:string, entite?:string, type?:string}} corr
 * @return {boolean} true si une nouvelle ligne a été écrite
 */
function enregistrerCorrection_(corr) {
  if (!corr || !corr.emetteur) return false;
  var c = {
    fichier: corr.fichier || '', emetteur: corr.emetteur, domaine: corr.domaine || '',
    categorie: corr.categorie || '', entite: corr.entite || '', type: corr.type || ''
  };
  var cache = correctionsCache_();
  var cle = cleCorrection_(c);
  if (cache.cles[cle]) return false; // déjà connue

  var f = feuille_('Corrections');
  var idx = colonnesCorrections_();
  var ligne = [];
  ligne[idx['Fichier']] = c.fichier;
  ligne[idx['Émetteur']] = c.emetteur;
  ligne[idx['Domaine']] = c.domaine;
  ligne[idx['Catégorie']] = c.categorie;
  ligne[idx['Entité']] = c.entite;
  ligne[idx['Type']] = c.type;
  ligne[idx['Corrigé le']] = new Date();
  for (var i = 0; i < ligne.length; i++) if (ligne[i] === undefined) ligne[i] = '';
  f.appendRow(ligne);

  cache.lignes.push(c);
  cache.cles[cle] = true;
  journalInfo_('Corrections', 'Correction enregistrée (émetteur « ' + c.emetteur + ' »).');
  return true;
}
