/**
 * Router.gs — Décide où va un fichier et l'y dépose, renommé.
 *
 * Garde-fous appliqués AVANT tout :
 *   - zone protégée (immigration) ou sensible=true  → 00·À vérifier
 *   - confiance hors [seuil, 1]                      → 00·À vérifier
 *   - domaine inconnu                                → 00·À vérifier
 * Aucune suppression : on CRÉE le fichier dans le dossier cible à partir du blob.
 */

/**
 * @param {Blob} blob          pièce jointe (copie déjà faite par l'appelant)
 * @param {Object} classif     sortie du LLM
 * @param {Date} dateReception date de réception du mail (fallback de date)
 * @return {{statut:string, domaine:string, chemin:string, nom:string}}
 */
function router_(blob, classif, dateReception) {
  var ext = extension_(blob.getName());
  var date = dateNormalisee_(classif.date_doc, dateReception); // AAAA-MM-JJ

  // 1) Cas de revue (la zone protégée et la sensibilité priment sur tout).
  var raisonRevue = motifDeRevue_(classif);
  if (raisonRevue) {
    var nomRevue = nomRevue_(raisonRevue, classif, date, ext);
    deposer_(blob, CONFIG.DOSSIERS.A_VERIFIER, nomRevue);
    return { statut: 'revue', domaine: classif.domaine || '', chemin: '00 · À vérifier', nom: nomRevue };
  }

  // 2) Classement automatique (domaine + catégorie connue + année si fort volume).
  var dossierId = dossierCible_(classif, date);
  var nom = nomNormalise_(date, classif.type_doc, classif.emetteur, ext);
  deposer_(blob, dossierId, nom);
  return { statut: 'classé', domaine: classif.domaine, chemin: cheminLisible_(classif), nom: nom };
}

/**
 * @param {Object} classif
 * @return {string} motif de revue, ou '' si classable automatiquement.
 */
function motifDeRevue_(classif) {
  if (classif.sensible === true) return 'sensible';
  if (CONFIG.DOMAINES_PROTEGES.indexOf(classif.domaine) !== -1) return 'zone protégée';
  if (typeof classif.confiance !== 'number' ||
      classif.confiance < CONFIG.SEUIL_CONFIANCE || classif.confiance > 1) {
    return 'confiance ' + (classif.confiance != null ? classif.confiance : '?');
  }
  if (!CONFIG.DOMAINES[classif.domaine]) return 'domaine inconnu';
  return '';
}

/**
 * Dossier de destination pour un classement automatique.
 * @param {Object} classif
 * @param {string} date  date normalisée AAAA-MM-JJ (pour le sous-dossier année)
 * @return {string} ID de dossier Drive
 */
function dossierCible_(classif, date) {
  var racineId = CONFIG.DOMAINES[classif.domaine];
  var courant = DriveApp.getFolderById(racineId);

  // Sous-dossier de catégorie connu (Phase 1 : Logement/Véhicule sous 03).
  var cats = CONFIG.CATEGORIES[classif.domaine];
  if (cats && classif.categorie && cats[classif.categorie]) {
    courant = DriveApp.getFolderById(cats[classif.categorie]);
  }

  // Sous-dossier par année pour les domaines à fort volume (aligné sur le nom).
  if (CONFIG.DOMAINES_PAR_ANNEE.indexOf(classif.domaine) !== -1) {
    courant = sousDossier_(courant, date.substring(0, 4));
  }
  return courant.getId();
}

/**
 * Crée le fichier dans le dossier cible (jamais de suppression/déplacement destructif).
 * @param {Blob} blob
 * @param {string} dossierId
 * @param {string} nom
 */
function deposer_(blob, dossierId, nom) {
  DriveApp.getFolderById(dossierId).createFile(blob.setName(nom));
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

/** date_doc valide → AAAA-MM-JJ ; sinon date de réception du mail. */
function dateNormalisee_(dateDoc, dateReception) {
  if (dateDoc && /^\d{4}-\d{2}-\d{2}$/.test(dateDoc)) return dateDoc;
  return Utilities.formatDate(dateReception, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
