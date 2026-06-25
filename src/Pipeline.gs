/**
 * Pipeline.gs — Traitement unifié d'un document, quelle que soit sa source.
 *
 * Les deux sources (PJ Gmail, dépôt manuel `00·À trier`) construisent un même
 * descripteur `src` et délèguent ici. Seul le PLACEMENT diffère (copie pour
 * Gmail, déplacement pour un dépôt) : il est fourni par `src.placer` /
 * `src.placerRevue`.
 *
 * Ordre d'écriture d'état (leçon durable) : placement → ligne Revue → ligne Index
 * (Index en dernier) : une coupure rejoue le cas au lieu de le perdre.
 *
 * Descripteur `src` :
 *   { cle, nom, taille, expediteur, sujet, date:Date,
 *     blob() -> Blob,
 *     placer(dossierId, nom) -> fileId,
 *     placerRevue(nom) -> fileId }
 */

/**
 * Traite un document : idempotence → OCR → LLM → doublon → routage → placement → Index.
 * @param {Object} src
 */
function traiterDocument_(src) {
  try {
    if (indexContient_(src.cle)) return; // déjà traité → idempotence

    var blob = src.blob();
    var extrait = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob);

    var classif = classifier_({
      nomFichier: src.nom,
      expediteur: src.expediteur || '',
      sujet: src.sujet || '',
      extrait: extrait
    });
    if (!classif) {
      // Rien à l'Index → la PJ sera re-tentée au prochain tick.
      notifierEchec_('Pipeline', 'Classification impossible pour « ' + src.nom + ' »');
      return;
    }

    // Même garde de taille que l'OCR : pas de hash en mémoire pour les très gros fichiers.
    var empreinte = src.taille > CONFIG.OCR_TAILLE_MAX ? '' : empreinteBlob_(blob);
    var motifForce = (empreinte && estDoublon_(empreinte)) ? 'doublon (déjà présent)' : '';

    var decision = deciderRoutage_(classif, src.date, extension_(src.nom), motifForce);

    var fileId = (decision.statut === 'revue')
      ? src.placerRevue(decision.nom)
      : src.placer(decision.dossierId, decision.nom);

    if (!fileId) {
      // Placement Drive échoué → on n'indexe pas : le fichier sera re-tenté.
      notifierEchec_('Pipeline', 'Placement Drive échoué pour « ' + src.nom + ' »');
      return;
    }
    if (decision.statut !== 'revue' && decision.autresEntites && decision.autresEntites.length) {
      creerRaccourcisEntites_(fileId, decision.nom, decision.autresEntites);
    }

    indexAjouter_(src.cle, decision, empreinte);
    journalInfo_('Pipeline', decision.statut + ' → ' + decision.chemin + ' : ' + decision.nom);
  } catch (e) {
    notifierEchec_('Pipeline', 'Échec sur « ' + src.nom + ' » : ' + e);
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
