/**
 * Router.gs — Décide OÙ va un fichier et sous quel nom (sans le placer).
 *
 * `deciderRoutage_` est le point de décision partagé par les deux sources
 * (PJ Gmail et dépôt manuel `00·À trier`). Le placement (copie pour Gmail,
 * déplacement pour un dépôt) est fait par l'appelant (cf. Pipeline.gs).
 *
 * Priorité des garde-fous (avant tout routage) :
 *   1. zone protégée (immigration) / sensible=true        → 00·À vérifier
 *   2. confiance hors [seuil, 1] / domaine inconnu         → 00·À vérifier
 *   3. doublon de contenu déjà présent                     → 00·À vérifier (signalé, jamais effacé)
 * Sinon on CLASSE : entité connue → dossier d'entité granulaire ; entité inconnue/en attente →
 * dossier du domaine (+ proposition d'entité pour plus tard) ; entité null → dossier du domaine.
 * Une entité non validée n'envoie JAMAIS le document en revue (sinon, au départ, tout part en
 * revue → l'auto-rangement est neutralisé, cf. LESSONS « garde-fou étroit »).
 */

/**
 * @param {Object} classif        sortie du LLM
 * @param {Date} dateReference    date de réception (Gmail) ou de dépôt (intake), fallback de date
 * @param {string} ext            extension d'origine (".pdf"…)
 * @param {string} [motifForce]   motif de revue imposé par l'appelant (ex. doublon), ou ''
 * @return {{statut:string, domaine:string, chemin:string, nom:string,
 *           dossierId?:string, raison?:string, autresEntites?:string[]}}
 */
function deciderRoutage_(classif, dateReference, ext, motifForce) {
  var date = dateNormalisee_(classif.date_doc, dateReference); // AAAA-MM-JJ

  // 1-2-3) Motifs de revue prioritaires (la sécurité prime sur le doublon).
  var raison = motifDeRevue_(classif) || (motifForce || '');
  if (raison) return revue_(raison, classif, date, ext);

  // 4) Granularité entité (Phase 2). L'entité est un ENRICHISSEMENT, jamais un frein :
  //    - entité connue (validée)        → dossier d'entité granulaire ;
  //    - entité inconnue / en attente    → on CLASSE au niveau domaine (comportement Phase 1)
  //                                        et on PROPOSE l'entité (ligne « en_attente ») pour
  //                                        plus tard — surtout pas le document en revue ;
  //    - entité null (transverse)        → dossier générique du domaine.
  // Anti-prolifération préservé : proposer une entité n'est pas créer un dossier.
  var ent = resoudreEntite_(classif);
  var dossierId, chemin;
  if (ent.etat === 'connue') {
    var cible = dossierEntiteCible_(ent, classif, date);
    dossierId = cible.id;
    chemin = cible.chemin;
  } else {
    if (ent.etat === 'inconnue' || ent.etat === 'en_attente') entiteEnAttenteAjouter_(classif);
    dossierId = dossierCible_(classif, date);
    chemin = cheminLisible_(classif);
  }

  var nom = nomNormalise_(date, classif.type_doc, classif.emetteur, ext);
  return {
    statut: 'classé', domaine: classif.domaine, chemin: chemin, nom: nom,
    dossierId: dossierId, autresEntites: autresEntitesConnues_(classif, dossierId)
  };
}

/** Construit une décision « revue ». */
function revue_(raison, classif, date, ext) {
  return {
    statut: 'revue', domaine: classif.domaine || '', chemin: '00 · À vérifier',
    nom: nomRevue_(raison, classif, date, ext), raison: raison
  };
}

/**
 * @param {Object} classif
 * @return {string} motif de revue, ou '' si classable automatiquement.
 *
 * La confiance basse n'envoie PLUS en revue : elle déclenche une analyse approfondie
 * (cf. Llm.classifier_), après quoi le document est CLASSÉ à sa meilleure estimation.
 * Ne restent en revue que : la zone protégée (sensible / immigration / fiscal — garde-fou
 * §1, non négociable) et un domaine introuvable (dernier recours, vraiment inclassable).
 */
function motifDeRevue_(classif) {
  if (classif.sensible === true) return 'sensible';
  if (CONFIG.DOMAINES_PROTEGES.indexOf(classif.domaine) !== -1) return 'zone protégée';
  if (!CONFIG.DOMAINES[classif.domaine]) return 'domaine inconnu';
  return '';
}

/**
 * Dossier de destination pour un doc TRANSVERSE (sans entité) — logique Phase 1.
 * @param {Object} classif
 * @param {string} date  AAAA-MM-JJ (pour le sous-dossier année)
 * @return {string} ID de dossier Drive
 */
function dossierCible_(classif, date) {
  var racineId = CONFIG.DOMAINES[classif.domaine];
  var courant = DriveApp.getFolderById(racineId);

  var cats = CONFIG.CATEGORIES[classif.domaine];
  if (cats && classif.categorie && cats[classif.categorie]) {
    courant = DriveApp.getFolderById(cats[classif.categorie]);
  }
  if (CONFIG.DOMAINES_PAR_ANNEE.indexOf(classif.domaine) !== -1) {
    courant = sousDossier_(courant, date.substring(0, 4));
  }
  return courant.getId();
}

/**
 * Dossier cible À L'INTÉRIEUR d'une entité connue : sous-dossier fixe selon le
 * type de doc, puis sous-dossier année si fort volume. Le sous-dossier n'est
 * créé que s'il APPARTIENT au schéma fixe du type d'entité (jamais de dossier
 * hors schéma). Le chemin lisible est dérivé de la LIGNE d'entité (ent), pas du
 * classif du document.
 * @param {{dossierId:string, type:string, entite:string, domaine:string, categorie:string}} ent
 * @param {Object} classif
 * @param {string} date
 * @return {{id:string, chemin:string}}
 */
function dossierEntiteCible_(ent, classif, date) {
  var courant = DriveApp.getFolderById(ent.dossierId);
  var sousNom = sousDossierPourType_(classif.type_doc, ent.type);
  if (sousNom) {
    courant = sousDossier_(courant, sousNom);
    if (CONFIG.SOUS_DOSSIERS_PAR_ANNEE.indexOf(sousNom) !== -1) {
      courant = sousDossier_(courant, date.substring(0, 4));
    }
  }
  var chemin = champ_(ent.domaine) || 'Domaine ?';
  if (ent.categorie) chemin += '/' + champ_(ent.categorie);
  chemin += '/' + (champ_(ent.entite) || 'Entité');
  if (sousNom) chemin += '/' + sousNom;
  return { id: courant.getId(), chemin: chemin };
}

/**
 * Sous-dossier d'entité correspondant à un type de document, ou null.
 * Garde-fou : on ne renvoie un sous-dossier que s'il fait partie du schéma fixe
 * du type d'entité — sinon racine d'entité (évite des dossiers hors schéma).
 * @param {string} typeDoc
 * @param {string} typeEntite
 * @return {?string}
 */
function sousDossierPourType_(typeDoc, typeEntite) {
  var sousNom = CONFIG.SOUS_DOSSIER_PAR_TYPE[normaliserCle_(typeDoc)] || null;
  if (!sousNom) return null;
  var schema = CONFIG.SCHEMAS_ENTITE[typeEntite];
  return (schema && schema.indexOf(sousNom) !== -1) ? sousNom : null;
}

/**
 * Autres entités connues citées par le doc (pour les raccourcis multi-entités).
 * Exclut le dossier primaire. Renvoie une liste d'IDs de dossiers d'entité.
 * @param {Object} classif
 * @param {string} dossierPrimaire
 * @return {string[]}
 */
function autresEntitesConnues_(classif, dossierPrimaire) {
  if (!classif.entites || !classif.entites.length) return [];
  var ids = [];
  for (var i = 0; i < classif.entites.length; i++) {
    var nom = classif.entites[i];
    if (!nom) continue;
    var ent = resoudreEntite_({ domaine: classif.domaine, entite: nom });
    if (ent.etat === 'connue' && ent.dossierId && ent.dossierId !== dossierPrimaire &&
        ids.indexOf(ent.dossierId) === -1) {
      ids.push(ent.dossierId);
    }
  }
  return ids;
}

/**
 * Crée le fichier dans le dossier cible à partir d'un blob (cas Gmail : copie).
 * @param {Blob} blob
 * @param {string} dossierId
 * @param {string} nom
 * @return {string} ID du fichier créé.
 */
function deposer_(blob, dossierId, nom) {
  return DriveApp.getFolderById(dossierId).createFile(blob.setName(nom)).getId();
}

/**
 * Renvoie (ou crée) un sous-dossier par nom.
 * @param {Folder} parent
 * @param {string} nom
 * @return {Folder}
 */
function sousDossier_(parent, nom) {
  var it = parent.getFoldersByName(nom);
  return it.hasNext() ? it.next() : parent.createFolder(nom);
}

/* ---------- Nommage (docs/NAMING.md) ---------- */

/** `AAAA-MM-JJ_Type_Émetteur.ext` */
function nomNormalise_(date, type, emetteur, ext) {
  var t = champ_(type) || 'Document';
  var e = champ_(emetteur) || 'Inconnu';
  return date + '_' + t + '_' + e + ext;
}

/** `[REVUE] <raison> — <domaine/catégorie suggéré> — <nom suggéré>.ext` */
function nomRevue_(raison, classif, date, ext) {
  var suggestion = nomNormalise_(date, classif.type_doc, classif.emetteur, ext);
  return '[REVUE] ' + raison + ' — ' + cheminLisible_(classif) + ' — ' + suggestion;
}

/** Chemin lisible « Domaine/Catégorie » (chaque segment nettoyé, le « / » préservé). */
function cheminLisible_(classif) {
  var p = champ_(classif.domaine) || 'Domaine ?';
  if (classif.categorie) p += '/' + champ_(classif.categorie);
  return p;
}

/** Nettoie un champ : caractères interdits Drive → '-', pas d'underscore interne. */
function champ_(valeur) {
  if (valeur == null) return '';
  return String(valeur)
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/_/g, '-')
    .trim();
}

/** Extension d'origine (casse préservée), point inclus (ex ".pdf"), ou '' si absente. */
function extension_(nom) {
  var m = /(\.[A-Za-z0-9]{1,8})$/.exec(nom || '');
  return m ? m[1] : '';
}

/* ---------- Dates ---------- */

/** date_doc valide → AAAA-MM-JJ ; sinon date de réception/dépôt. */
function dateNormalisee_(dateDoc, dateReference) {
  if (dateDoc && /^\d{4}-\d{2}-\d{2}$/.test(dateDoc)) return dateDoc;
  return Utilities.formatDate(dateReference, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
