/**
 * Pipeline.gs — Traitement unifié d'un document, quelle que soit sa source.
 *
 * Les deux sources (PJ Gmail, dépôt manuel `00·À trier`) construisent un même
 * descripteur `src` et délèguent ici. Seul le PLACEMENT diffère (copie pour
 * Gmail, déplacement pour un dépôt) : il est fourni par `src.placer`.
 * (Plus de file de revue depuis 2026-07-01 : `src.placerRevue` n'est plus utilisé.)
 *
 * Ordre d'écriture d'état (leçon durable) : placement → ligne Index (en dernier) :
 * une coupure rejoue le cas au lieu de le perdre.
 *
 * Descripteur `src` :
 *   { cle, nom, taille, expediteur, sujet, date:Date,
 *     blob() -> Blob,
 *     placer(dossierId, nom) -> fileId }
 */

/**
 * Traite un document : idempotence → DOUBLON (fast, sans lecture) → OCR → LLM → routage → placement → Index.
 * @param {Object} src
 */
function traiterDocument_(src) {
  try {
    if (indexContient_(src.cle)) return; // déjà traité → idempotence

    // P1 (revue intake) : blob PARESSEUX — au-delà de la borne OCR, il n'est jamais matérialisé
    // (une vidéo de 300 Mo ferait lever getBlob → quarantaine, alors que le média-path n'a besoin
    // ni du blob ni de l'empreinte — les deux seuls consommateurs sont gatés par la même borne).
    var blob = src.taille > CONFIG.OCR_TAILLE_MAX ? null : src.blob();
    var ext = extension_(src.nom);

    // FAST PATH doublon (P1-20) : l'empreinte MD5 (rapide, ne lit que les octets) suffit à savoir si ce
    // CONTENU est déjà classé. Si oui → « _Doublons » SANS OCR ni LLM : sur un ancien Drive plein de
    // copies déjà présentes dans le nouveau Drive, on économise l'essentiel du coût/temps (l'exemplaire
    // canonique est déjà classé ailleurs). Même garde de taille que l'OCR (pas de hash des très gros).
    // `src.ignorerDoublon` (migration #8) : un fichier DÉJÀ CLASSÉ qu'on re-classe a son empreinte dans
    // l'Index — sans ce bypass il serait « doublon de lui-même » et tout le Drive migré partirait en
    // `_Doublons`. L'empreinte reste calculée et ré-inscrite (la détection future n'est pas affaiblie).
    var empreinte = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : empreinteBlob_(blob);
    if (empreinte && !src.ignorerDoublon && estDoublon_(empreinte)) {
      var dec = doublonRapide_(src.nom, src.date, ext);
      var idDup = src.placer(dec.dossierId, dec.nom);
      if (!idDup) { gererEchec_(src, 'placement doublon échoué'); return; }
      indexAjouter_(src.cle, dec, empreinte);
      journalInfo_('Pipeline', 'doublon (sans lecture) → _Doublons : ' + dec.nom);
      return;
    }

    // FICHIER TECHNIQUE (code/CAO, ADR-0002 §3) : écarté du classement documentaire (ni OCR ni LLM —
    // ce n'est pas un document à ranger par domaine) → `_Technique`, pour ne pas polluer les domaines.
    // Détection par EXTENSION seulement (jamais PDF/Office/images). Placé APRÈS le fast-path doublon
    // (un doublon technique va quand même dans `_Doublons`), AVANT tout OCR/LLM (économie de coût).
    if (estTechnique_(src.nom)) {
      var decT = routageTechnique_(src.nom, src.date, ext);
      var idT = src.placer(decT.dossierId, decT.nom);
      if (!idT) { gererEchec_(src, 'placement technique échoué'); return; }
      indexAjouter_(src.cle, decT, empreinte);
      journalInfo_('Pipeline', 'technique (sans lecture) → _Technique : ' + decT.nom);
      return;
    }

    // MÉDIA BRUT direct (vidéo/audio/gif — ADR-0009 §2) : jamais un document → `_Médias` SANS OCR
    // ni LLM (l'OCR Drive ne lit pas une vidéo, le LLM n'a rien à classer). Nom d'origine conservé.
    // Placé après le fast-path doublon (un doublon de vidéo va quand même dans `_Doublons`).
    if (estMediaDirect_(src.nom)) {
      var decM = routageMedia_(src.nom);
      var idM = src.placer(decM.dossierId, decM.nom);
      if (!idM) { gererEchec_(src, 'placement média échoué'); return; }
      indexAjouter_(src.cle, decM, empreinte);
      journalInfo_('Pipeline', 'média (sans lecture) → _Médias : ' + decM.nom);
      return;
    }

    // Contenu INÉDIT → lecture complète (OCR) puis classement (LLM).
    var extrait = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob);

    // FAST-PATH photo sans texte (ADR-0009 §2) : nom NON documentaire (export Facebook, IMG_…)
    // ET extrait OCR vide → média personnel → `_Médias` sans LLM. L'OCR reste le JUGE (§1) : un scan
    // de passeport nommé « IMG_2734.jpg » contient du texte → extrait non vide → analyse complète.
    // R1 (revue sécurité) : le fast-path exige que l'OCR ait été TENTÉ (taille <= max) — sans ça,
    // une photo > 20 Mo (scan à plat .tif) serait écartée sans que « le juge » ait siégé.
    // P2 (revue intake) : `extrait === null` = l'OCR a ÉCHOUÉ (panne transitoire) — le juge n'a pas
    // rendu de verdict → jamais de fast-path (le doc continue vers le LLM, comme avant #11).
    if (src.taille <= CONFIG.OCR_TAILLE_MAX && extrait !== null &&
        estPhoto_(src.nom) && estNomNonDocumentaire_(src.nom) &&
        extrait.length < CONFIG.MEDIAS_OCR_MAX_CARS) {
      var decP = routageMedia_(src.nom);
      var idP = src.placer(decP.dossierId, decP.nom);
      if (!idP) { gererEchec_(src, 'placement média échoué'); return; }
      indexAjouter_(src.cle, decP, empreinte);
      journalInfo_('Pipeline', 'photo sans texte → _Médias : ' + decP.nom);
      return;
    }

    var classif = classifier_({
      nomFichier: src.nom,
      expediteur: src.expediteur || '',
      sujet: src.sujet || '',
      extrait: extrait || '' // null (échec OCR) → le LLM classe sur les métadonnées, comme avant
    });
    if (!classif) {
      // Échec LLM : compté ; re-tenté au prochain tick, ou quarantaine après N échecs.
      gererEchec_(src, 'classification impossible');
      return;
    }

    // Filet « deviner depuis le nom d'origine » (ADR-0002 §5) : si le LLM n'a pas rendu de type,
    // on le complète depuis le nom du fichier (ex. …_TP4_… → « TP ») avant le routage/nommage.
    enrichirClassifDepuisNom_(classif, src.nom);

    var decision = deciderRoutage_(classif, src.date, ext, '');

    // Plus de file de revue (décision Marc 2026-07-01) : tout est CLASSÉ ('classé'), placé dans son
    // dossier cible avec son nom final propre. Un seul chemin de placement.
    var fileId = src.placer(decision.dossierId, decision.nom);

    if (!fileId) {
      // Placement Drive échoué → on n'indexe pas : compté ; re-tenté, ou quarantaine après N échecs.
      gererEchec_(src, 'placement Drive échoué');
      return;
    }
    if (decision.autresEntites && decision.autresEntites.length) {
      creerRaccourcisEntites_(fileId, decision.nom, decision.autresEntites);
    }

    indexAjouter_(src.cle, decision, empreinte);
    journalInfo_('Pipeline', decision.statut + ' → ' + decision.chemin + ' : ' + decision.nom);
  } catch (e) {
    // Erreur inattendue (OCR, blob, Sheet...) : comptée comme un échec → re-tentée, ou
    // quarantaine après N échecs (évite un re-OCR/re-LLM en boucle sur un cas définitivement cassé).
    try { gererEchec_(src, String(e)); }
    catch (e2) { notifierEchec_('Pipeline', 'Échec sur « ' + src.nom + ' » : ' + e + ' / ' + e2); }
  }
}

/**
 * Gère un échec de traitement d'un document : compte les tentatives (onglet « Échecs ») et,
 * au-delà de `CONFIG.QUARANTAINE_MAX`, met le document en QUARANTAINE — inscrit « quarantaine »
 * à l'Index (donc plus jamais re-traité, plus de re-OCR/re-LLM coûteux) avec UNE seule alerte mail.
 * En-deçà du seuil, on journalise seulement (pas de mail → anti-spam) et le doc sera re-tenté.
 * @param {Object} src
 * @param {string} message  cause de l'échec (pour le Journal / l'alerte)
 */
function gererEchec_(src, message) {
  var n = incrementerEchec_(src.cle);
  if (n >= CONFIG.QUARANTAINE_MAX) {
    indexAjouter_(src.cle, { statut: 'quarantaine', domaine: '', chemin: '', nom: src.nom });
    notifierEchec_('Quarantaine', 'Document mis en quarantaine après ' + n + ' échecs : ' +
      src.nom + ' — ' + message);
  } else {
    journalErreur_('Pipeline', 'Échec ' + n + '/' + CONFIG.QUARANTAINE_MAX + ' pour « ' +
      src.nom + ' » : ' + message);
  }
}

/**
 * Empreinte MD5 du contenu (hex). Sert à repérer les doublons. '' si indisponible.
 * @param {Blob} blob
 * @return {string}
 */
function empreinteBlob_(blob) {
  try {
    var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes());
    var hex = '';
    for (var i = 0; i < octets.length; i++) {
      hex += ('0' + (octets[i] & 0xFF).toString(16)).slice(-2);
    }
    return hex;
  } catch (e) {
    return ''; // hash impossible (mémoire) → pas de détection de doublon, sans planter
  }
}

/**
 * Pose un raccourci du fichier dans chaque autre dossier d'entité (jamais de copie).
 * Dégrade proprement si l'API échoue (le fichier primaire reste rangé).
 * @param {string} fileId
 * @param {string} nom
 * @param {string[]} dossierIds
 */
function creerRaccourcisEntites_(fileId, nom, dossierIds) {
  var n = 0;
  for (var i = 0; i < dossierIds.length; i++) {
    if (creerRaccourci_(fileId, dossierIds[i], nom)) n++;
  }
  if (n) journalInfo_('Pipeline', n + ' raccourci(s) multi-entités créé(s) pour : ' + nom);
}
