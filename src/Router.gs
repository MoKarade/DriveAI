/**
 * Décision « doublon » RAPIDE (fast path P1-20) — SANS classification (ni OCR ni LLM) : on sait déjà,
 * par l'empreinte, que ce contenu est déjà classé ailleurs. On l'écarte dans « _Doublons » en gardant
 * son NOM D'ORIGINE (nettoyé, préfixé de la date) : un exemplaire redondant, le nom parfait importe peu.
 * Déplacement/copie seul, jamais de suppression (§2).
 * @param {string} nomOriginal
 * @param {Date} dateRef
 * @param {string} ext
 */
function doublonRapide_(nomOriginal, dateRef, ext) {
  var date = Utilities.formatDate(dateRef, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var base = String(nomOriginal || '').replace(/\.[^.\/]+$/, ''); // retire l'extension d'origine
  return {
    statut: 'doublon', domaine: '', chemin: '_Doublons',
    nom: date + '_' + (champ_(base) || 'Copie') + ext,
    dossierId: dossierDoublons_().getId()
  };
}

/**
 * Dossier de destination pour un doc TRANSVERSE (sans entité) — logique Phase 1.
 * @param {Object} classif
 * @param {string} date  AAAA-MM-JJ (pour le sous-dossier année)
 * @return {string} ID de dossier Drive
 */
function dossierCible_(classif, date) {
  var courant = DriveApp.getFolderById(idDomaine_(classif.domaine));

  var cats = CONFIG.CATEGORIES[classif.domaine];
  if (cats && classif.categorie && cats[classif.categorie]) {
    courant = DriveApp.getFolderById(cats[classif.categorie]);
  }
  if (CONFIG.DOMAINES_PAR_ANNEE.indexOf(classif.domaine) !== -1) {
    courant = sousDossier_(courant, date.substring(0, 4));
  }
  return courant.getId();
}

/** Vrai si `domaine` est un domaine reconnu : un des 7 fixes (ID en dur) OU un domaine auto-créé. */
function domaineConnu_(domaine) {
  return !!(CONFIG.DOMAINES[domaine]) || (CONFIG.DOMAINES_AUTO || []).indexOf(domaine) !== -1;
}

/** ID du dossier d'un domaine : ID fixe (CONFIG.DOMAINES) ou dossier auto-créé (find-or-create). */
function idDomaine_(domaine) {
  return CONFIG.DOMAINES[domaine] || dossierDomaineAuto_(domaine).getId();
}

/**
 * Renvoie (ou crée) le dossier d'un domaine AUTO-créé (ex. « 07 · Santé »), placé À CÔTÉ des domaines
 * existants (même parent que le domaine par défaut). ID mémorisé en Script Property. Zéro clic, jamais
 * de suppression. Idempotent (réutilise le dossier s'il existe déjà par nom).
 * @param {string} nom
 * @return {Folder}
 */
function dossierDomaineAuto_(nom) {
  var props = PropertiesService.getScriptProperties();
  var cle = 'DriveAI_DOM_' + nom;
  var id = props.getProperty(cle);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* supprimé → on recrée */ }
  }
  var ref = DriveApp.getFolderById(CONFIG.DOMAINES[CONFIG.DOMAINE_DEFAUT]); // domaine de référence (01)
  var parents = ref.getParents();
  var racine = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = racine.getFoldersByName(nom);
  var dossier = it.hasNext() ? it.next() : racine.createFolder(nom);
  props.setProperty(cle, dossier.getId());
  return dossier;
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

/**
 * Renvoie (ou crée) le dossier « _Doublons » où sont écartés les doublons (déplacement seul,
 * jamais de suppression). Placé à côté de `00·À trier` (même parent = racine DriveAI). L'ID est
 * mémorisé en Script Property pour éviter de le re-chercher à chaque doublon.
 * @return {Folder}
 */
function dossierDoublons_() {
  return dossierRacineParNom_('_Doublons', 'DriveAI_DOUBLONS_ID');
}

/** Renvoie (ou crée) le dossier `_Technique` (code/CAO écartés du classement), à côté de `_Doublons`. */
function dossierTechnique_() {
  return dossierRacineParNom_('_Technique', 'DriveAI_TECHNIQUE_ID');
}

/**
 * Renvoie (ou crée) un dossier de service placé à la RACINE DriveAI (même parent que `00 · À trier`),
 * hors domaines — ex. `_Doublons`, `_Technique`. ID mémorisé en Script Property. Déplacement seul,
 * jamais de suppression. Idempotent (réutilise le dossier existant par nom).
 * @param {string} nom
 * @param {string} cleProp
 * @return {Folder}
 */
function dossierRacineParNom_(nom, cleProp) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(cleProp);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* supprimé → on recrée ci-dessous */ }
  }
  var aTrier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);
  var parents = aTrier.getParents();
  var racine = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = racine.getFoldersByName(nom);
  var dossier = it.hasNext() ? it.next() : racine.createFolder(nom);
  props.setProperty(cleProp, dossier.getId());
  return dossier;
}

/** Vrai si le fichier est TECHNIQUE (code/CAO) d'après son extension — écarté du classement documentaire. */
function estTechnique_(nom) {
  var ext = (extension_(nom) || '').toLowerCase();
  return !!ext && CONFIG.EXT_TECHNIQUES.indexOf(ext) !== -1;
}

/**
 * Décision de routage d'un fichier TECHNIQUE (ADR-0002 §3) : `_Technique`, nom = date + nom d'origine
 * nettoyé (pas d'OCR/LLM, ce n'est pas un document à classer). Déplacement/copie seul, jamais supprimé.
 * @param {string} nomOrigine
 * @param {Date} dateRef
 * @param {string} ext
 */
function routageTechnique_(nomOrigine, dateRef, ext) {
  var date = Utilities.formatDate(dateRef, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var base = String(nomOrigine || '').replace(/\.[^.\/]+$/, '');
  return {
    statut: 'technique', domaine: '', chemin: '_Technique',
    nom: date + '_' + (champ_(base) || 'Fichier') + ext,
    dossierId: dossierTechnique_().getId()
  };
}

/* ---------- Chantier #11 (ADR-0009 §2) : médias bruts → `_Médias` ---------- */

/** Renvoie (ou crée) le dossier `_Médias` (hors domaines). ID mémorisé en Script Property. */
function dossierMedias_() {
  return dossierRacineParNom_('_Médias', 'DriveAI_MEDIAS_ID');
}

/** Vrai si l'extension est un média DIRECT (vidéo/audio/gif — jamais un document). PUR. */
function estMediaDirect_(nom) {
  var ext = extension_(nom).toLowerCase();
  return !!ext && CONFIG.EXT_MEDIAS_DIRECT.indexOf(ext) !== -1;
}

/** Vrai si l'extension est une photo (candidate au fast-path SI nom non-documentaire ET OCR vide). PUR. */
function estPhoto_(nom) {
  var ext = extension_(nom).toLowerCase();
  return !!ext && CONFIG.EXT_PHOTOS.indexOf(ext) !== -1;
}

/**
 * Vrai si le NOM est manifestement non-documentaire : identifiant numérique d'export (Facebook :
 * « 251319877474117.jpg »), compteur d'appareil (« IMG_2734 », « DSC_0042 », « PXL_2023… »),
 * capture (« Screenshot… », « WhatsApp Image… »). Un nom PORTEUR DE SENS (« CV Marc.jpg »,
 * « 2024-03-05_Facture_X.jpg ») renvoie false → le document garde son analyse complète. PUR.
 * @param {string} nom
 * @return {boolean}
 */
function estNomNonDocumentaire_(nom) {
  var base = String(nom || '').replace(/\.[^.\/]+$/, '').trim();
  if (!base) return false;
  // R3 (défense en profondeur, §1) : un mot-clé de la zone protégée dans le NOM rend le fichier
  // documentaire quoi qu'il arrive (« Photo 2024 passeport.jpg » garde son analyse complète).
  var minuscule = base.toLowerCase();
  var proteges = CONFIG.MOTS_CLES_PROTEGES_INTENTIONS || [];
  for (var i = 0; i < proteges.length; i++) {
    if (proteges[i].length > 4 && minuscule.indexOf(proteges[i]) !== -1) return false;
    if (proteges[i].length <= 4 && new RegExp('\\b' + proteges[i] + '\\b').test(minuscule)) return false;
  }
  if (/^[\d\s_\-()]+$/.test(base) && (base.match(/\d/g) || []).length >= 8) return true; // ID numérique long
  if (/^(img|dsc|dscn|dscf|pxl|mvimg|photo|video|vid|image)[ _\-]?\d/i.test(base)) return true; // compteur d'appareil
  if (/^(screenshot|capture d.écran|capture|whatsapp (image|video)|signal-)/i.test(base)) return true; // captures
  return false;
}

/**
 * Décision de routage d'un MÉDIA BRUT : `_Médias`, nom d'ORIGINE conservé (traçabilité — les noms
 * d'export sont leurs identifiants). Jamais re-collecté : `_Médias` est hors domaines (racine `_`),
 * comme `_Doublons`/`_Technique`.
 * @param {string} nomOrigine
 * @return {{statut:string, domaine:string, chemin:string, nom:string, dossierId:string}}
 */
function routageMedia_(nomOrigine) {
  return {
    statut: 'média', domaine: '', chemin: '_Médias',
    nom: String(nomOrigine || 'média'),
    dossierId: dossierMedias_().getId()
  };
}

/* ============================================================================
 * DÉCISION NON-DOCUMENT (refonte 2026-07-07). Un export Facebook, un fichier système, une photo sans
 * texte ne sont PAS des documents → `_Technique`/`_Médias`, JAMAIS un domaine (surtout pas la zone
 * protégée 04). Garde DOMINANTE : une pièce d'identité / un doc 01|04 / un vrai scan documentaire
 * n'est JAMAIS écarté — même en image, même OCR pauvre. Fonctions PURES.
 * ==========================================================================*/

/** Reprise nominale du filtre TECHNIQUE par extension (code/CAO). PUR. */
function extensionEstTechnique_(nom) {
  return estTechnique_(nom);
}

/**
 * Vrai si le fichier est un EXPORT DE DONNÉES de compte (Facebook/Instagram…) : .html/.htm/.json ET
 * (nom évocateur OU gros HTML sans émetteur). Distingue une facture .html légitime (émetteur, petite). PUR.
 * @param {{nomFichier:string, taille?:number, emetteur?:string}} meta
 */
function estExportDonnees_(meta) {
  meta = meta || {};
  var nom = String(meta.nomFichier || '');
  var ext = (extension_(nom) || '').toLowerCase();
  if (['.html', '.htm', '.json'].indexOf(ext) === -1) return false;
  var k = normaliserCle_(nom.replace(/\.[^.]+$/, ''));
  if (/facebook|instagram|messenger|whatsapp|linkedin|snapchat|export|votre information|your information|friends|posts|messages|donnee/.test(k)) return true;
  // Gros HTML de navigation SANS émetteur identifié → export (une facture .html porte un émetteur).
  return ext !== '.json' && (meta.taille || 0) > CONFIG.EXPORT_TAILLE_MIN &&
    !(meta.emetteur && String(meta.emetteur).trim());
}

/** Vrai si média SANS TEXTE (vidéo/audio/gif toujours ; photo si nom non-documentaire ET OCR pauvre). PUR. */
function estMediaSansTexte_(meta, extraitOcr) {
  meta = meta || {};
  var nom = String(meta.nomFichier || '');
  if (estMediaDirect_(nom)) return true;
  return estPhoto_(nom) && estNomNonDocumentaire_(nom) &&
    String(extraitOcr || '').length < CONFIG.MEDIAS_OCR_MAX_CARS;
}

/**
 * Garde DOMINANTE anti-faux-négatif : `true` = VRAI document, à NE PAS écarter. Vrai si pièce
 * d'identité, OU domaine 01|04 (identité / zone protégée), OU (domaine valide + type documentaire +
 * émetteur OU titulaire). Empêche qu'un passeport/facture PHOTOGRAPHIÉ (même OCR pauvre) parte en média. PUR.
 */
function distinguerVraiScan_(classif) {
  if (!classif) return false;
  if (classif.estDocumentIdentite === true) return true;
  var num = String(classif.domaine || '').slice(0, 2);
  if (num === '01' || num === '04') return true; // identité / immigration (protégée) — jamais un « média »
  var aType = !!(classif.type_doc && String(classif.type_doc).trim());
  var aTiers = !!((classif.emetteur && String(classif.emetteur).trim()) ||
    (classif.titulaire && String(classif.titulaire).trim()));
  return domaineConnu_(classif.domaine) && aType && aTiers;
}

/**
 * Décision NON-DOCUMENT — ordre EXPLICITE (spec revue) :
 *  (0) vrai document (distinguerVraiScan_) → NON écarté, SAUF export de données déterministe (un
 *      export ne porte jamais de domaine, encore moins la zone 04) ;
 *  (1) sinon écarté si le LLM le dit, ou extension technique, ou export, ou média sans texte ;
 *  (2) routage `_Technique` (code/export/système) ou `_Médias` (photo/vidéo sans texte).
 * Ne route JAMAIS vers un domaine, JAMAIS vers 04. PUR.
 * @param {Object} classif
 * @param {{nomFichier:string, taille?:number, extraitOcr?:string, emetteur?:string}} meta
 * @return {{estNonDoc:boolean, routage:('_Technique'|'_Médias'|null)}}
 */
function decisionNonDocument_(classif, meta) {
  meta = meta || {};
  var estExport = estExportDonnees_(meta);
  if (distinguerVraiScan_(classif) && !estExport) return { estNonDoc: false, routage: null };
  var technique = estExport || extensionEstTechnique_(meta.nomFichier);
  var media = estMediaSansTexte_(meta, meta.extraitOcr);
  if ((classif && classif.estNonDocument === true) || technique || media) {
    var routage = technique ? '_Technique' : (media ? '_Médias'
      : (classif && (classif.routageHorsDomaine === '_Technique' || classif.routageHorsDomaine === '_Médias')
        ? classif.routageHorsDomaine : '_Médias'));
    return { estNonDoc: true, routage: routage };
  }
  return { estNonDoc: false, routage: null };
}

/* ============================================================================
 * FAIL-SAFE HYBRIDE ULTRA-STRICT (ADR-0016, décision Marc 2026-07-07). Révise §2.1 ÉTROITEMENT : on
 * ré-introduit `00 · À vérifier`, mais UNIQUEMENT quand l'analyse n'a produit AUCUN fait exploitable
 * (`domaine` inconnu ET `emetteur` absent ET `type_doc` absent). Sinon, classé au mieux comme avant.
 * La conjonction ET garantit l'anti-saturation (un seul fait présent suffit à classer). PURES + I/O.
 * ==========================================================================*/

// Valeurs SENTINELLES que le LLM émet pour « je ne sais pas » (Haiku n'offre PAS `null` pour type_doc
// → il écrit « Inconnu ») : à traiter comme ABSENTES, sinon le fail-safe RATE le cas vide dans le
// chemin live et le doc atterrit au hasard dans `01 · Administratif` (revue code #26).
var SENTINELLES_VIDES = ['inconnu', 'inconnue', 'unknown', 'null', 'undefined', 'na', 'none',
  'aucun', 'aucune', 'so', 'vide', 'nc', 'indetermine'];

/** Vrai si un champ de classification est réellement RENSEIGNÉ : non vide ET pas une sentinelle. PUR. */
function estRenseigne_(v) {
  if (v == null) return false;
  var s = String(v).trim();
  if (!s || !champ_(v)) return false;
  var k = s.toLowerCase().replace(/[^a-z0-9]/g, ''); // 'N/A'→'na', '-'→'', 'Inconnu'→'inconnu'
  return k !== '' && SENTINELLES_VIDES.indexOf(k) === -1;
}

/**
 * Vrai si l'analyse ne porte AUCUN fait exploitable (fail-safe ADR-0016) : domaine inconnu/hors-liste
 * ET émetteur ET type_doc ET entité ET descripteur tous absents (sentinelles incluses). Le MOINDRE
 * fait présent ⇒ false (on classe au mieux — « granularité = enrichissement, jamais frein » : entité
 * et descripteur comptent, révision code #26). Ne dépend d'AUCUNE I/O. PUR.
 * @param {Object} classif
 * @return {boolean}
 */
function estClassificationVide_(classif) {
  if (!classif) return true; // aucune classif du tout → à vérifier
  return !domaineConnu_(classif.domaine) &&
    !estRenseigne_(classif.emetteur) &&
    !estRenseigne_(classif.type_doc) &&
    !estRenseigne_(classif.entite) &&          // un fait exploitable (entité) suffit à classer
    !estRenseigne_(classif.descripteur);       // v2 : descripteur toujours produit → jamais vide en v2
}

/**
 * Dossier `00 · À vérifier` (fail-safe) : réutilise l'ID configuré s'il vit encore, sinon find-or-create
 * à la racine DriveAI (Marc a pu supprimer l'ancien dossier vide). Déplacement seul, jamais supprimé.
 * @return {Folder}
 */
function dossierAVerifier_() {
  try { return DriveApp.getFolderById(CONFIG.DOSSIERS.A_VERIFIER); }
  catch (e) { return dossierRacineParNom_('00 · À vérifier', 'DriveAI_A_VERIFIER_ID'); }
}

/**
 * Décision fail-safe : document déplacé vers `00 · À vérifier` (validation humaine via l'app). Nom au
 * mieux (jamais « Inconnu ») : `nommerDocument_` retombe sur « …_Type.ext » quand tout est absent.
 * @param {Object} classif
 * @param {string} date  AAAA-MM-JJ
 * @param {string} ext
 * @return {{statut:string, domaine:string, chemin:string, nom:string, dossierId:string, autresEntites:string[]}}
 */
function routageAVerifier_(classif, date, ext) {
  return {
    statut: 'à vérifier', domaine: '', chemin: '00 · À vérifier',
    nom: nommerDocument_(classif, date, ext),
    dossierId: dossierAVerifier_().getId(), autresEntites: []
  };
}

/* ---------- Nommage (docs/NAMING.md) ---------- */

/**
 * @param {Object} classif        sortie du LLM
 * @param {Date} dateReference    date de réception (Gmail) ou de dépôt (intake), fallback de date
 * @param {string} ext            extension d'origine (".pdf"…)
 * @return {{statut:string, domaine:string, chemin:string, nom:string,
 *           dossierId?:string, raison?:string, autresEntites?:string[]}}
 */
function deciderRoutage_(classif, dateReference, ext) {
  var date = dateNormalisee_(classif.date_doc, dateReference); // AAAA-MM-JJ

  // FAIL-SAFE (ADR-0016) : aucun fait exploitable → filet humain `00 · À vérifier` au lieu d'un
  // rangement au hasard. Ultra-strict → rare (anti-saturation). Garde identité symétrique avec le
  // chemin v2 (aujourd'hui toujours vraie en Haiku : `estDocumentIdentite` est un champ v2 — mais la
  // symétrie protège si Haiku venait à produire ce signal).
  if (!estDocumentIdentitePersonnel_(classif) && estClassificationVide_(classif)) {
    return routageAVerifier_(classif, date, ext);
  }

  // (Le cas DOUBLON vit en AMONT, au fast-path du Pipeline (P1-20) — plus jamais ici.)
  // 1) Domaine introuvable (LLM hors-liste/malformé) : on CLASSE au mieux dans le domaine par défaut
  // (le cas tout-vide est déjà parti en revue ci-dessus). Zéro fichier en limbo.
  // `domaineConnu_` accepte les 7 domaines fixes ET les domaines auto-créés (07 · Santé, ADR-0002).
  if (!domaineConnu_(classif.domaine)) classif.domaine = CONFIG.DOMAINE_DEFAUT;

  // 2) Granularité entité (Phase 2). L'entité est un ENRICHISSEMENT, jamais un frein :
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

  var nom = nomParType_(date, classif.type_doc, classif.emetteur, ext);
  return {
    statut: 'classé', domaine: classif.domaine, chemin: chemin, nom: nom,
    dossierId: dossierId, autresEntites: autresEntitesConnues_(classif, dossierId)
  };
}

/* ============================================================================
 * ROUTAGE V2 (refonte #26, C26-06) — consomme le schéma étendu de l'analyse 2 passes. ACTIF seulement
 * si `CONFIG.ANALYSE_V2` (gate au Pipeline). Différences avec `deciderRoutage_` :
 *  (1) NON-DOCUMENT écarté vers `_Technique`/`_Médias` (jamais un domaine, jamais 04) ;
 *  (2) pièce d'IDENTITÉ rangée PAR TYPE (dossier partagé Marc + proches), nom = titulaire ;
 *  (3) classement à PLAT par défaut (ADR-0023) — sous-dossier UNIQUEMENT pour une entité majeure canonique ou un type d'identité ;
 *  (4) nom via `nommerDocument_` (jamais « Inconnu » — descripteur en repli).
 * `planRoutageV2_` est le cœur PUR (aucune I/O) ; `deciderRoutageV2_` en est l'enveloppe Drive.
 * ==========================================================================*/

/**
 * Cœur PUR de la décision v2 : détermine le TYPE de placement (non-document vs classé), le domaine,
 * le sous-dossier et le nom final — sans aucune I/O Drive (testable). PUR.
 * @param {Object} classif  sortie de l'analyse 2 passes (schéma v2)
 * @param {{nomFichier:string, taille?:number, extraitOcr?:string, emetteur?:string}} meta
 * @param {string} date  AAAA-MM-JJ (déjà normalisée)
 * @param {string} ext
 * @param {Object} [validees]  carte des entités VALIDÉES (cleCanoniqueEntite_ → libellé canonique,
 *   cf. entitesValideesParCle_). ABSENTE/vide ⇒ AUCUN dossier d'entité (verrou : « un dossier
 *   d'entité SEULEMENT si validée par Marc » — le prompt seul ne suffit pas, ADR-0023 révisé).
 * @return {{type:('non-doc'|'classé'), routage?:('_Technique'|'_Médias'), domaine?:string, sousDossier?:string, nom?:string}}
 */
function planRoutageV2_(classif, meta, date, ext, validees) {
  // (1) Non-document → hors domaines (la garde DOMINANTE de decisionNonDocument_ protège identité/01/04).
  var nd = decisionNonDocument_(classif, meta);
  if (nd.estNonDoc) return { type: 'non-doc', routage: nd.routage };

  var c = classif || {};
  // (2) FAIL-SAFE (ADR-0016) : analyse TOUT-NULL → `00 · À vérifier` (une pièce d'identité a un
  // type/titulaire → jamais vide → jamais déviée). Ultra-strict, donc rare.
  if (!estDocumentIdentitePersonnel_(c) && estClassificationVide_(c)) return { type: 'à vérifier' };

  // (3) Domaine introuvable (LLM hors-liste/malformé) → domaine par défaut (jamais de limbo).
  if (!domaineConnu_(c.domaine)) c.domaine = CONFIG.DOMAINE_DEFAUT;

  var domaine, sousDossier;
  if (estDocumentIdentitePersonnel_(c)) {
    var di = dossierIdentite_(c);          // identité → domaine + sous-dossier de TYPE (04 possible : légitime)
    domaine = di.domaine; sousDossier = di.sousDossier;
  } else {
    domaine = c.domaine;
    // Candidat d'entité (champ gaté du prompt), retenu SEULEMENT s'il est VALIDÉ au référentiel —
    // le libellé du référentiel prime (une seule graphie de dossier par entité). Sinon : année
    // (DOMAINES_PAR_ANNEE) ou racine, via la règle UNIQUE partagée avec la consolidation.
    var candidat = sousDossierPourNom_(c);
    var cleEnt = candidat ? cleCanoniqueEntite_(domaine, candidat) : null;
    var entiteValidee = (cleEnt && validees && validees[cleEnt]) ? validees[cleEnt] : null;
    sousDossier = sousCheminDomaine_({
      domaine: domaine, typeIdentite: null, entite: entiteValidee,
      annee: /^\d{4}/.test(date || '') ? date.substring(0, 4) : null,
    });
  }
  return { type: 'classé', domaine: domaine, sousDossier: sousDossier, nom: nommerDocument_(c, date, ext) };
}

/**
 * Décision de routage V2 (enveloppe I/O de `planRoutageV2_`) : find-or-create du sous-dossier sous le
 * domaine, anti-écrasement du nom (garantirNomUnique_). Ne route JAMAIS un non-document vers un domaine.
 * @param {Object} classif
 * @param {{nomFichier:string, taille?:number, extraitOcr?:string, emetteur?:string}} meta
 * @param {Date} dateReference
 * @param {string} ext
 * @return {{statut:string, domaine:string, chemin:string, nom:string, dossierId:string, autresEntites:string[]}}
 */
function deciderRoutageV2_(classif, meta, dateReference, ext) {
  var date = dateNormalisee_(classif && classif.date_doc, dateReference);
  // Carte des entités VALIDÉES (1 lecture de cache/run — le cache Entités est déjà chargé par le
  // tick) : le verrou « dossier d'entité seulement si validée » vit dans planRoutageV2_ (PUR).
  var validees;
  try { validees = entitesValideesParCle_(); } catch (e) { validees = {}; } // échec fermé : à plat
  var plan = planRoutageV2_(classif, meta, date, ext, validees);

  if (plan.type === 'non-doc') {
    return plan.routage === '_Technique'
      ? routageTechnique_(meta.nomFichier, dateReference, ext)
      : routageMedia_(meta.nomFichier);
  }
  if (plan.type === 'à vérifier') return routageAVerifier_(classif, date, ext); // fail-safe (ADR-0016)

  var dom = DriveApp.getFolderById(idDomaine_(plan.domaine));
  // ADR-0023 : sous-dossier VIDE = classement à PLAT à la racine du domaine (plus de repli
  // « Divers »). Sinon, assainit le nom (caractères interdits Drive → '-', comme pour les noms
  // de fichiers) : `plan.sousDossier` vient d'une entité LLM libre, jamais d'un ID fixe.
  var sousNom = champ_(plan.sousDossier) || '';
  var cible = sousNom ? sousDossier_(dom, sousNom) : dom;
  var nom = garantirNomUnique_(plan.nom, nomsDansDossier_(cible.getId()));
  return {
    statut: 'classé', domaine: plan.domaine,
    chemin: sousNom ? plan.domaine + '/' + sousNom : plan.domaine,
    nom: nom, dossierId: cible.getId(), autresEntites: []
  };
}

/**
 * Noms des fichiers déjà présents dans un dossier (borné) — pour l'anti-écrasement `garantirNomUnique_`.
 * Borne à 500 pour ne pas faire exploser le quota sur un dossier atypiquement gros. Dégrade en [] si l'API échoue.
 * @param {string} dossierId
 * @return {string[]}
 */
function nomsDansDossier_(dossierId) {
  var noms = [];
  try {
    var it = DriveApp.getFolderById(dossierId).getFiles();
    var n = 0;
    while (it.hasNext() && n < 500) { noms.push(it.next().getName()); n++; }
  } catch (e) { /* dossier illisible → pas d'anti-écrasement, sans planter */ }
  return noms;
}

/** `AAAA-MM-JJ_Type_Émetteur.ext` — format historique (granularité JOUR). */
function nomNormalise_(date, type, emetteur, ext) {
  var t = champ_(type) || 'Document';
  var e = champ_(emetteur) || 'Inconnu';
  return date + '_' + t + '_' + e + ext;
}

/**
 * Nommage PAR TYPE de document (ADR-0002 §6) : la granularité de date et le libellé s'adaptent au
 * type. Ex. un relevé bancaire est mensuel (`AAAA-MM_Relevé_<Banque>`), un diplôme annuel
 * (`AAAA_Diplôme_<Établissement>`), une facture au jour (défaut). Logique PURE (testée). Dégrade
 * gracieusement : un type inconnu retombe sur le format historique `nomNormalise_` (jamais un blocage).
 * @param {string} date  AAAA-MM-JJ (issu de dateNormalisee_)
 * @param {string} type  type_doc du LLM
 * @param {string} emetteur
 * @param {string} ext
 * @return {string}
 */
function nomParType_(date, type, emetteur, ext) {
  var sc = schemaNommage_(type);
  if (sc.gran === 'jour' && !sc.label) return nomNormalise_(date, type, emetteur, ext); // défaut historique
  var d = tronquerDate_(date, sc.gran);
  var label = champ_(sc.label || type) || 'Document';
  var e = champ_(emetteur) || 'Inconnu';
  return d + '_' + label + '_' + e + ext;
}

/* ============================================================================
 * DOCUMENTS D'IDENTITÉ & TITULAIRE (refonte 2026-07-07, demande Marc). Les pièces d'identité se
 * rangent PAR TYPE (dossier « Passeport », « Permis de conduire »…) contenant TOUS les titulaires
 * (Marc ET les autres) ; le nom de la PERSONNE va dans le fichier. Aucun dossier « Tiers ». PURES.
 * ==========================================================================*/

// Types d'identité CANONIQUES : un même type (variantes du LLM incluses) tombe dans le MÊME dossier,
// que le titulaire soit Marc ou un proche.
var TYPES_IDENTITE = ['Passeport', 'Carte d’identité', 'Permis de conduire', 'Acte de naissance',
  'Acte de mariage', 'Certificat de citoyenneté', 'Carte d’assurance maladie', 'Carte de résident permanent'];

/** Ramène un type d'identité à sa forme canonique (dossier partagé). Type inconnu → nettoyé, jamais rejeté. PUR. */
function normaliserTypeIdentite_(sousDossierType) {
  var k = normaliserCle_(sousDossierType); // minuscule, sans accents, apostrophes → espace
  if (!k) return '';
  if (k.indexOf('passeport') !== -1 || k.indexOf('passport') !== -1) return 'Passeport';
  if (k.indexOf('permis de conduire') !== -1 || k.indexOf('permis conduire') !== -1 ||
      k.indexOf('driver') !== -1 || k === 'permis') return 'Permis de conduire';
  if (k.indexOf('acte de naissance') !== -1 || k.indexOf('naissance') !== -1 || k.indexOf('birth') !== -1) return 'Acte de naissance';
  if (k.indexOf('acte de mariage') !== -1 || k.indexOf('mariage') !== -1 || k.indexOf('marriage') !== -1) return 'Acte de mariage';
  if (k.indexOf('citoyennete') !== -1 || k.indexOf('citizenship') !== -1) return 'Certificat de citoyenneté';
  if (k.indexOf('assurance maladie') !== -1 || k.indexOf('ramq') !== -1 || k.indexOf('carte soleil') !== -1) return 'Carte d’assurance maladie';
  if (k.indexOf('resident permanent') !== -1 || k.indexOf('residence permanente') !== -1 || k.indexOf('permanent resident') !== -1) return 'Carte de résident permanent';
  if (k.indexOf('carte d identite') !== -1 || k.indexOf('carte identite') !== -1 || k === 'cni' || k.indexOf('identity card') !== -1) return 'Carte d’identité';
  return casseTitreEntite_(String(sousDossierType == null ? '' : sousDossierType).replace(/\s+/g, ' ').trim());
}

/** Vrai ssi c'est une pièce d'identité PERSONNELLE reconnue (→ rangement par type + titulaire). PUR. */
function estDocumentIdentitePersonnel_(classif) {
  if (!classif || classif.estDocumentIdentite !== true) return false;
  return TYPES_IDENTITE.indexOf(normaliserTypeIdentite_(classif.sousDossierType)) !== -1;
}

/** Domaine + sous-dossier de type d'une pièce d'identité (jamais par personne, jamais « Tiers »). PUR. */
function dossierIdentite_(classif) {
  var t = normaliserTypeIdentite_(classif && classif.sousDossierType);
  var domaine = '01 · Administratif & identité';
  if (t === 'Carte de résident permanent') domaine = '04 · Immigration';       // lié au statut (protégé)
  else if (t === 'Carte d’assurance maladie') domaine = '07 · Santé';
  return { domaine: domaine, sousDossier: t };
}

/** Casse Titre d'un NOM DE PERSONNE (contrairement aux entités, on normalise MÊME l'ALL-CAPS). PUR. */
function casseNomPersonne_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g,
    function (m, sep, c) { return sep + c.toUpperCase(); });
}

/** Titulaire (personne concernée) nettoyé pour le NOM du fichier. Marc y est un titulaire VALIDE. null si absent. PUR. */
function titulairePourNom_(classif) {
  var t = classif && classif.titulaire;
  if (t == null || !String(t).trim()) return null;
  return casseNomPersonne_(String(t).replace(/\s+/g, ' ').trim()) || null;
}

/** Nom d'un document SANS émetteur ni titulaire (« AAAA-MM-JJ_Type.ext ») — jamais « _Inconnu ». PUR. */
function nomSansTiers_(date, type, ext) {
  var sc = schemaNommage_(type);
  return tronquerDate_(date, sc.gran) + '_' + (champ_(sc.label || type) || 'Document') + ext;
}

/**
 * NOM FINAL d'un document (aiguillage). JAMAIS « Inconnu » (exigence Marc 2026-07-07) : le 3ᵉ segment
 * est TOUJOURS renseigné et précis, par priorité TITULAIRE (pièce d'identité) > ÉMETTEUR (organisation)
 * > DESCRIPTEUR (2-6 mots : ce que c'est + le sujet + qui l'a produit). Aucun des trois → « …_Type.ext »
 * (jamais « _Inconnu »). PUR.
 * @param {Object} classif  {date_doc, type_doc, emetteur, descripteur, estDocumentIdentite, sousDossierType, titulaire}
 * @param {string} dateReception  AAAA-MM-JJ (repli si date_doc absente)
 * @param {string} ext
 */
function nommerDocument_(classif, dateReception, ext) {
  classif = classif || {};
  var date = (classif.date_doc && /^\d{4}-\d{2}-\d{2}$/.test(classif.date_doc)) ? classif.date_doc : (dateReception || '');
  if (estDocumentIdentitePersonnel_(classif)) {
    var type = normaliserTypeIdentite_(classif.sousDossierType);
    var titu = titulairePourNom_(classif);
    return titu ? nomParType_(date, type, titu, ext) : nomSansTiers_(date, type, ext);
  }
  // Émetteur d'abord, sinon descripteur (jamais « Inconnu ») ; aucun des deux → type seul.
  var tiers = champ_(classif.emetteur) ? classif.emetteur : (champ_(classif.descripteur) ? classif.descripteur : '');
  return tiers ? nomParType_(date, classif.type_doc, tiers, ext) : nomSansTiers_(date, classif.type_doc, ext);
}

/**
 * SOUS-DOSSIER d'un document (ADR-0023 : classement à PLAT par défaut — révise l'exigence 2026-07-07
 * « rien à la racine » ; retour Marc 2026-07-16 : la profondeur forcée a produit ~500 dossiers dont
 * ~100 vides, recensement docs/diagnostics/2026-07-16-recensement-drive.md). Priorité : pièce
 * d'identité → TYPE (« Passeport ») ; sinon ENTITÉ canonique UNIFIÉE si l'analyse en fournit une
 * (entité MAJEURE seulement — employeur, école, véhicule, banque — le prompt v2 laisse `entite`
 * null sinon) ; sinon CHAÎNE VIDE = à PLAT à la racine du domaine. Plus JAMAIS de dossier par
 * émetteur ponctuel (l'ancien repli `emetteur` a créé un dossier par marchand), par catégorie
 * (« Cours », « Devoirs ») ni « Divers ». PUR.
 * @param {Object} classif  {estDocumentIdentite, sousDossierType, entite, emetteur, sousDossier, type_doc}
 * @return {string} nom du sous-dossier (sans le domaine), '' = racine du domaine
 */
function sousDossierPourNom_(classif) {
  classif = classif || {};
  if (estDocumentIdentitePersonnel_(classif)) return normaliserTypeIdentite_(classif.sousDossierType);
  // Champ `sousDossier` (PAS `entite`) : c'est LUI que le prompt v2 gate « entité majeure ou null » —
  // `entite` reste un champ RICHE (référentiel, few-shot) légitimement rempli pour un émetteur
  // ponctuel ; router dessus ferait revenir le dossier-par-émetteur (revue structure-keeper C28-26).
  var ent = classif.sousDossier ? canoniserEntite_(classif.sousDossier) : null;
  return ent || '';
}

/**
 * RÈGLE UNIQUE de sous-chemin sous un domaine (ADR-0023, arbitrage Marc 2026-07-16 « entité OU
 * année ») — PARTAGÉE par le flux vivant (planRoutageV2_) et la cible de consolidation
 * (cheminCibleConsolidation_), verrouillée par un tripwire test : toute divergence entre les deux
 * ferait re-proposer « Déplacer » en boucle ce que le flux vivant vient de classer.
 *  1. type d'IDENTITÉ → dossier de TYPE (« Passeport ») ;
 *  2. ENTITÉ (majeure, VALIDÉE) → dossier d'entité, SANS année (une entité = UN dossier) ;
 *  3. domaine par ANNÉE (DOMAINES_PAR_ANNEE) + année lisible → dossier « AAAA » ;
 *  4. sinon '' = racine du domaine (à plat). PUR.
 * @param {{domaine:string, typeIdentite:?string, entite:?string, annee:?string}} d
 * @return {string}
 */
function sousCheminDomaine_(d) {
  d = d || {};
  if (d.typeIdentite) return d.typeIdentite;
  if (d.entite) return d.entite;
  if (d.annee && (CONFIG.DOMAINES_PAR_ANNEE || []).indexOf(d.domaine) !== -1) return d.annee;
  return '';
}

/**
 * ANTI-ÉCRASEMENT (revue) : deux pièces distinctes de personnes différentes, même type, date absente
 * → même nom, hash différent ⇒ ce ne sont PAS des doublons. Suffixe incrémental avant l'extension.
 * Garantit qu'aucun dépôt n'écrase un fichier existant (violerait « aucune suppression »). PUR.
 * @param {string} nom
 * @param {string[]} nomsExistants  noms déjà présents dans le dossier cible
 */
function garantirNomUnique_(nom, nomsExistants) {
  var existants = nomsExistants || [];
  if (existants.indexOf(nom) === -1) return nom;
  var s = String(nom), dot = s.lastIndexOf('.');
  var base = dot > 0 ? s.slice(0, dot) : s, ext = dot > 0 ? s.slice(dot) : '';
  var i = 2, candidat;
  do { candidat = base + '_' + i + ext; i++; } while (existants.indexOf(candidat) !== -1);
  return candidat;
}

/**
 * Schéma de nommage pour un type_doc : granularité de date + libellé fixe éventuel. Règles ORDONNÉES
 * (le 1er motif trouvé gagne) — « relevé de notes » (annuel) doit passer AVANT « relevé » (mensuel).
 * @param {string} typeDoc
 * @return {{gran:('jour'|'mois'|'annee'), label?:string}}
 */
function schemaNommage_(typeDoc) {
  var t = normaliserCle_(typeDoc); // minuscules, sans accents, apostrophes → espace
  // Règles ORDONNÉES (1er match gagne). `motifs` = sous-chaînes ; `re` = motif ANCRÉ (mot entier)
  // pour les jetons courts ambigus — « paie » ne doit pas matcher « paiement », « tp » pas « … ».
  var regles = [
    { motifs: ['releve de note', 'bulletin de note'], gran: 'annee' },                          // études (avant « releve »)
    { motifs: ['bulletin de paie', 'fiche de paie', 'bulletin de salaire'], re: /(^| )(paie|salaire)( |$)/, gran: 'mois', label: 'Paie' },
    { motifs: ['releve bancaire', 'releve de compte', 'releve'], gran: 'mois', label: 'Relevé' },
    { motifs: ['diplome', 'attestation de reussite'], gran: 'annee' },
    { motifs: ['avis d imposition', 'avis de cotisation', 'impot', 'declaration de revenus', 'feuillet'], gran: 'annee' },
    { motifs: ['curriculum'], re: /(^| )cv( |$)/, gran: 'annee', label: 'CV' },
    { motifs: ['travaux pratiques', 'devoir', 'examen', 'cours'], re: /(^| )tp\d*( |$|\d)/, gran: 'annee' } // études : TP, TP4…
    // Tout le reste (facture, contrat, immigration, santé, attestation…) → JOUR, libellé = type nettoyé.
  ];
  for (var i = 0; i < regles.length; i++) {
    var r = regles[i], hit = r.re ? r.re.test(t) : false;
    for (var j = 0; !hit && j < r.motifs.length; j++) if (t.indexOf(r.motifs[j]) !== -1) hit = true;
    if (hit) return { gran: r.gran, label: r.label };
  }
  return { gran: 'jour' };
}

/** Tronque une date AAAA-MM-JJ à la granularité voulue (annee → AAAA, mois → AAAA-MM, jour → complet). */
function tronquerDate_(date, gran) {
  var s = String(date || '');
  if (gran === 'annee') return s.substring(0, 4);
  if (gran === 'mois') return s.substring(0, 7);
  return s;
}

/**
 * Devine le TYPE d'un document depuis son NOM d'origine (ADR-0002 §5) — filet quand le LLM ne rend
 * pas de type. Ex. `MODE2D_TP4_MARC_RICHARD.pdf` → « TP ». Séparateurs (`_ - .`) traités comme des
 * espaces avant matching (les noms de fichiers collent souvent les mots). Logique PURE (testée).
 * @param {string} nom
 * @return {string} type canonique deviné, ou '' si rien de sûr.
 */
function devinerTypeDepuisNom_(nom) {
  var base = String(nom || '').replace(/\.[^.\/]+$/, '');    // retire l'extension
  var t = normaliserCle_(base.replace(/[_\-.]+/g, ' '));     // séparateurs → espace, puis minuscule/sans accents
  var regles = [
    { re: /(^| )tp ?\d*( |$)/, type: 'TP' },                 // TP, TP4, TP 4…
    { motifs: ['releve de note', 'bulletin de note'], type: 'Relevé de notes' },
    { motifs: ['facture'], type: 'Facture' },
    { re: /(^| )(paie|salaire)( |$)/, motifs: ['bulletin de paie', 'fiche de paie'], type: 'Bulletin de paie' },
    { motifs: ['releve'], type: 'Relevé' },
    { re: /(^| )cv( |$)/, motifs: ['curriculum'], type: 'CV' },
    { motifs: ['contrat', 'bail'], type: 'Contrat' },
    { motifs: ['diplome'], type: 'Diplôme' },
    { motifs: ['ordonnance'], type: 'Ordonnance' },
    { motifs: ['avis imposition', 'avis d imposition', 'impot', 'avis de cotisation'], type: 'Avis d\'imposition' },
    { motifs: ['attestation'], type: 'Attestation' }
  ];
  for (var i = 0; i < regles.length; i++) {
    var r = regles[i], hit = r.re ? r.re.test(t) : false;
    for (var j = 0; !hit && r.motifs && j < r.motifs.length; j++) if (t.indexOf(r.motifs[j]) !== -1) hit = true;
    if (hit) return r.type;
  }
  return '';
}

/**
 * Enrichit la classification depuis le nom d'origine QUAND le LLM n'a pas fourni de type (Inconnu/vide) :
 * on complète `type_doc` par un type deviné du nom (ADR-0002 §5). N'écrase JAMAIS un type déjà trouvé.
 * @param {Object} classif
 * @param {string} nom
 * @return {Object} le classif (muté)
 */
function enrichirClassifDepuisNom_(classif, nom) {
  if (!classif) return classif;
  var t = normaliserCle_(classif.type_doc);
  if (!t || t === 'inconnu') {
    var devine = devinerTypeDepuisNom_(nom);
    if (devine) classif.type_doc = devine;
  }
  return classif;
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
