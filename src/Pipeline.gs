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

    var blob = src.blob();
    var ext = extension_(src.nom);

    // FAST PATH doublon (P1-20) : l'empreinte MD5 (rapide, ne lit que les octets) suffit à savoir si ce
    // CONTENU est déjà classé. Si oui → « _Doublons » SANS OCR ni LLM : sur un ancien Drive plein de
    // copies déjà présentes dans le nouveau Drive, on économise l'essentiel du coût/temps (l'exemplaire
    // canonique est déjà classé ailleurs). Même garde de taille que l'OCR (pas de hash des très gros).
    var empreinte = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : empreinteBlob_(blob);
    if (empreinte && estDoublon_(empreinte)) {
      var dec = doublonRapide_(src.nom, src.date, ext);
      var idDup = src.placer(dec.dossierId, dec.nom);
      if (!idDup) { gererEchec_(src, 'placement doublon échoué'); return; }
      indexAjouter_(src.cle, dec, empreinte);
      journalInfo_('Pipeline', 'doublon (sans lecture) → _Doublons : ' + dec.nom);
      return;
    }

    // Contenu INÉDIT → lecture complète (OCR) puis classement (LLM).
    var extrait = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob);

    var classif = classifier_({
      nomFichier: src.nom,
      expediteur: src.expediteur || '',
      sujet: src.sujet || '',
      extrait: extrait
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
