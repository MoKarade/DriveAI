/**
 * Router.gs — Décide OÙ va un fichier et sous quel nom (sans le placer).
 *
 * `deciderRoutage_` est le point de décision partagé par les deux sources
 * (PJ Gmail et dépôt manuel `00·À trier`). Le placement (copie pour Gmail,
 * déplacement pour un dépôt) est fait par l'appelant (cf. Pipeline.gs).
 *
 * [DÉCISION MARC 2026-07-01] PLUS DE FILE DE REVUE : un seul dossier d'arrivée (`00·À trier`).
 * TOUT document est CLASSÉ au mieux, avec son nom FINAL propre (`AAAA-MM-JJ_Type_Émetteur.ext`),
 * jamais un nom encodé `[REVUE] …`. Un domaine introuvable (LLM hors-liste) n'est plus mis en
 * limbo : il est rangé dans `CONFIG.DOMAINE_DEFAUT` (bucket générique). Seul aiguillage restant :
 *   - doublon de contenu déjà présent → `_Doublons` (déplacement seul, jamais supprimé, §2) ;
 *   - sinon on CLASSE : entité connue → dossier d'entité granulaire ; entité inconnue/en attente →
 *     dossier du domaine (+ proposition d'entité pour plus tard) ; entité null → dossier du domaine.
 * Une entité non validée n'est JAMAIS un frein (elle enrichit, cf. LESSONS « granularité »).
 */

/**
 * @param {Object} classif        sortie du LLM
 * @param {Date} dateReference    date de réception (Gmail) ou de dépôt (intake), fallback de date
 * @param {string} ext            extension d'origine (".pdf"…)
 * @param {string} [motifForce]   motif imposé par l'appelant (ex. doublon → `_Doublons`), ou ''
 * @return {{statut:string, domaine:string, chemin:string, nom:string,
 *           dossierId?:string, raison?:string, autresEntites?:string[]}}
 */
function deciderRoutage_(classif, dateReference, ext, motifForce) {
  var date = dateNormalisee_(classif.date_doc, dateReference); // AAAA-MM-JJ

  // 1) Domaine introuvable (LLM hors-liste/malformé) : plus de revue (décision Marc 2026-07-01) —
  // on CLASSE au mieux dans le domaine par défaut, avec le nom final propre. Zéro fichier en limbo.
  if (!CONFIG.DOMAINES[classif.domaine]) classif.domaine = CONFIG.DOMAINE_DEFAUT;

  // 2) Doublon (y compris sensible) : on l'ÉCARTE dans « _Doublons » plutôt que de garder N copies —
  // au volume du grand rangement, signaler chaque doublon sature. Déplacement seul, JAMAIS supprimé
  // (garde-fou §2) ; l'original déjà classé reste en place. Marc peut vider « _Doublons » quand il veut.
  if (motifForce) return doublon_(classif, date, ext);

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

  var nom = nomParType_(date, classif.type_doc, classif.emetteur, ext);
  return {
    statut: 'classé', domaine: classif.domaine, chemin: chemin, nom: nom,
    dossierId: dossierId, autresEntites: autresEntitesConnues_(classif, dossierId)
  };
}

/**
 * Construit une décision « doublon » : le fichier va dans « _Doublons », renommé au format normalisé
 * (DÉPLACEMENT pour un dépôt manuel ; COPIE pour une PJ Gmail — l'original Gmail reste intact, lecture
 * seule). Jamais de suppression (§2). S'applique aussi aux doublons SENSIBLES (5 copies d'un passeport
 * → 1 classée, les autres ici) : l'original classé reste en place, rien n'est effacé.
 */
function doublon_(classif, date, ext) {
  return {
    statut: 'doublon', domaine: classif.domaine || '', chemin: '_Doublons',
    nom: nomParType_(date, classif.type_doc, classif.emetteur, ext),
    dossierId: dossierDoublons_().getId()
  };
}

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

/**
 * Renvoie (ou crée) le dossier « _Doublons » où sont écartés les doublons (déplacement seul,
 * jamais de suppression). Placé à côté de `00·À trier` (même parent = racine DriveAI). L'ID est
 * mémorisé en Script Property pour éviter de le re-chercher à chaque doublon.
 * @return {Folder}
 */
function dossierDoublons_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DriveAI_DOUBLONS_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* supprimé → on recrée ci-dessous */ }
  }
  var aTrier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);
  var parents = aTrier.getParents();
  var racine = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = racine.getFoldersByName('_Doublons');
  var dossier = it.hasNext() ? it.next() : racine.createFolder('_Doublons');
  props.setProperty('DriveAI_DOUBLONS_ID', dossier.getId());
  return dossier;
}

/* ---------- Nommage (docs/NAMING.md) ---------- */

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
