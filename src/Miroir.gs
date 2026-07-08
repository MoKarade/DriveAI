/**
 * Miroir.gs — synchronise une copie COMPLÈTE du dépôt GitHub vers un dossier dédié du Drive de
 * Marc (ADR-0017, demande Marc : « accéder de partout » + NotebookLM, qui ingère depuis Drive) :
 * les fichiers texte en `.txt`, et depuis la révision 2026-07-08 les binaires UTILES à NotebookLM
 * (pdf/png/jpg/svg — vision multimodale) tels quels, reçus en base64 (flag `binaire:true`).
 *
 * Écrit par la web app (`WebApp.doPost`, `action=sync-miroir`), appelée par une étape GitHub Actions
 * à chaque push sur `main` (`.github/workflows/sync-drive.yml`). AUCUN nouveau scope OAuth (réutilise
 * `drive`, déjà déclaré) — donc aucun re-consentement, aucun gel du moteur.
 *
 * Secret DÉDIÉ (`DriveAI_SYNC_SECRET`, Script Property) — DISTINCT de `DriveAI_WEBAPP_SECRET` (celui
 * de l'app, exposé côté navigateur PAR CONCEPTION, cf. app/src/config.ts : « la sécurité vient du
 * login Google, pas du secret »). Celui-ci ne doit JAMAIS être visible d'un navigateur — seulement
 * connu de GitHub Actions (secret CI) et du script. Pire abus si CE secret fuit : écrire des fichiers
 * TEXTE dans UN dossier dédié (`_Miroir du dépôt`, hors domaines) — jamais lire/modifier/supprimer un
 * document classé, jamais toucher à l'Index/Journal/Entités.
 *
 * Garde-fous : AUCUNE suppression (§2) — un fichier retiré du dépôt laisse une copie obsolète dans le
 * miroir (limite assumée : à nettoyer à la main de temps en temps, comme `_Doublons`/`_Technique`).
 * Écriture bornée par LOT + garde-temps (la boucle complète, sur tout le dépôt, vit côté GitHub
 * Actions — en plusieurs requêtes — jamais une seule exécution qui parcourt tout).
 *
 * DISPOSITION À PLAT (révision PM/architecte 2026-07-08) : plus AUCUN sous-dossier — tous les
 * fichiers vivent à la racine de `_Miroir du dépôt`, le chemin d'origine aplati par `---`
 * (« src/Router.gs » → « src---Router.gs.txt ») pour que NotebookLM puisse tout sélectionner d'un
 * seul niveau. Les copies de l'ANCIENNE arborescence (sous-dossiers src/, docs/…) sont obsolètes :
 * purge MANUELLE par Marc (le code ne supprime jamais rien).
 */

/** Dossier racine du miroir (hors domaines, à côté de `_Doublons`/`_Technique`). */
function dossierMiroir_() {
  return dossierRacineParNom_('_Miroir du dépôt', 'DriveAI_MIROIR_ID');
}

// Binaires UTILES à NotebookLM (vision multimodale : images ; documents : PDF) — ALLOWLIST stricte
// (plan PM/architecte 2026-07-08) : seuls CES formats sont décodés depuis le base64 du payload.
// Mitigation de surface d'abus : un vol de DriveAI_SYNC_SECRET ne permet d'écrire QUE ces types
// (et du texte) dans le dossier miroir — jamais un exécutable/une archive.
var EXT_MIROIR_BINAIRES_AUTORISEES = ['.png', '.jpg', '.jpeg', '.svg', '.pdf'];

// Binaires INUTILES à l'IA (polices, archives, formats d'image exotiques) : exclus — ils
// gaspilleraient bande passante CI et quota Drive sans rien apporter à NotebookLM.
var EXT_MIROIR_BINAIRES_BLOQUEES = ['.gif', '.ico', '.webp', '.bmp', '.tif', '.tiff',
  '.heic', '.heif', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.zip', '.gz', '.tar'];

/** Vrai si ce chemin de dépôt doit être inclus dans le miroir (texte OU binaire utile ; jamais de
 *  remontée, jamais un binaire hors allowlist). PUR. */
function estFichierMiroirable_(chemin) {
  var c = String(chemin == null ? '' : chemin);
  if (!c || c.indexOf('..') !== -1) return false; // jamais de remontée de chemin hors du miroir
  var ext = (extension_(c) || '').toLowerCase();
  return EXT_MIROIR_BINAIRES_BLOQUEES.indexOf(ext) === -1;
}

/** Nettoie UN segment de chemin (dossier ou fichier) pour Drive : caractères interdits → '-'. PUR. */
function nettoyerSegmentChemin_(segment) {
  return String(segment == null ? '' : segment).replace(/[\/\\:*?"<>|]/g, '-').trim();
}

/**
 * Nom de fichier APLATI dans le miroir (révision PM/architecte 2026-07-08) : tout le chemin sur UN
 * niveau, `/` → `---`. TEXTE → suffixé `.txt` (ex. "src/Router.gs" → "src---Router.gs.txt" —
 * NotebookLM digère mal les extensions de code brutes) ; BINAIRE UTILE → extension d'ORIGINE
 * conservée (ex. "app/public/logo.png" → "app---public---logo.png" — l'extension porte le type
 * pour la vision multimodale). Pourquoi à plat : NotebookLM sélectionne ses sources sur UN seul
 * niveau. PUR.
 * @param {string} chemin
 * @param {boolean} [binaire]
 */
function nomFichierMiroir_(chemin, binaire) {
  var s = String(chemin == null ? '' : chemin);
  if (!s || /\/$/.test(s)) return ''; // chemin vide ou finissant par '/' → pas de nom de fichier
  var segs = s.split('/').filter(Boolean).map(nettoyerSegmentChemin_).filter(Boolean);
  if (!segs.length) return '';
  var nom = segs.join('---');
  if (binaire) return nom;
  return /\.txt$/i.test(nom) ? nom : nom + '.txt';
}

/** MIME type Drive d'un nom de fichier du miroir (binaires utiles ; texte par défaut). PUR. */
function mimeTypePourMiroir_(nom) {
  var ext = (extension_(nom) || '').toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  return 'text/plain';
}

/**
 * Écrit (crée ou MET À JOUR) un fichier À PLAT à la racine du miroir — plus aucun sous-dossier
 * (révision 2026-07-08 ; les copies de l'ancienne arborescence sont à purger À LA MAIN par Marc,
 * le code ne supprime jamais rien, §2). Jamais d'alerte/mail ici : écriture pure.
 *
 * TEXTE : service Drive STANDARD (`DriveApp.setContent`/`createFile`). BINAIRE UTILE (allowlist
 * `EXT_MIROIR_BINAIRES_AUTORISEES`, contenu reçu en BASE64) : décodé en blob avec le bon MIME —
 * la MISE À JOUR passe par un PATCH REST `uploadType=media` (`setContent` ne porte que du texte,
 * et recréer le fichier exigerait une suppression, interdite §2). Idempotent par nom.
 * @param {string} chemin    chemin relatif dans le dépôt (ex. "src/Router.gs")
 * @param {string} contenu   texte UTF-8, ou base64 si `binaire`
 * @param {boolean} [binaire] vrai si `contenu` est du base64 à décoder (flag posé par le workflow)
 * @return {boolean} vrai si écrit avec succès.
 */
function ecrireFichierMiroir_(chemin, contenu, binaire) {
  if (!estFichierMiroirable_(chemin)) return false;
  var ext = (extension_(String(chemin == null ? '' : chemin)) || '').toLowerCase();
  // Défense en profondeur : seuls les binaires de l'ALLOWLIST sont décodés — un payload
  // `binaire:true` sur une extension non prévue est refusé (surface d'abus du secret bornée).
  if (binaire && EXT_MIROIR_BINAIRES_AUTORISEES.indexOf(ext) === -1) return false;
  var nom = nomFichierMiroir_(chemin, !!binaire);
  if (!nom) return false;
  try {
    var dossier = dossierMiroir_();
    var it = dossier.getFilesByName(nom);
    if (binaire) {
      var blob = Utilities.newBlob(Utilities.base64Decode(contenu || ''), mimeTypePourMiroir_(nom), nom);
      if (it.hasNext()) return majFichierBinaireMiroir_(it.next().getId(), blob);
      dossier.createFile(blob);
      return true;
    }
    if (it.hasNext()) {
      it.next().setContent(contenu || '');
    } else {
      dossier.createFile(nom, contenu || '', MimeType.PLAIN_TEXT);
    }
    return true;
  } catch (e) {
    journalErreur_('Miroir', 'Écriture échouée pour « ' + chemin + ' » : ' + e);
    return false;
  }
}

/**
 * Met à jour le CONTENU d'un fichier binaire existant du miroir, EN PLACE (l'ID Drive survit) —
 * PATCH REST `uploadType=media`, même patron que DriveRest.gs/l'OCR (REST via UrlFetchApp, jamais
 * le service avancé, cf. LESSONS). Jamais de suppression/recréation (§2).
 * @param {string} fileId
 * @param {Blob} blob  contenu décodé, MIME déjà posé
 * @return {boolean}
 */
function majFichierBinaireMiroir_(fileId, blob) {
  var rep = fetchDriveAvecRetry_(
    'https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(fileId) + '?uploadType=media',
    {
      method: 'patch',
      contentType: blob.getContentType(),
      payload: blob.getBytes(),
      headers: { Authorization: 'Bearer ' + jetonDrive_() },
      muteHttpExceptions: true
    }
  );
  if (rep.getResponseCode() === 200) return true;
  journalErreur_('Miroir', 'PATCH binaire échoué (HTTP ' + rep.getResponseCode() + ') : ' +
    tronquer_(rep.getContentText(), 200));
  return false;
}

/** Vrai si le secret DÉDIÉ (distinct de celui de l'app) est valide pour cette requête. */
function verifierSecretSync_(e) {
  var attendu = PropertiesService.getScriptProperties().getProperty('DriveAI_SYNC_SECRET');
  var recu = e && e.parameter ? e.parameter.secret : '';
  return !!(attendu && recu && recu === attendu);
}

/**
 * Action web app `sync-miroir` : reçoit un LOT de fichiers {chemin, contenu} et les écrit dans le
 * miroir. Bornée par garde-temps (la boucle COMPLÈTE, sur tout le dépôt, vit côté GitHub Actions —
 * en plusieurs lots/requêtes — jamais ici).
 * @param {Object} e  événement doPost (postData.contents = JSON {fichiers:[{chemin,contenu}]})
 * @return {{ok:boolean, ecrits?:number, ignores?:number, erreur?:string}}
 */
function actionSyncMiroir_(e) {
  var corps;
  try { corps = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return { ok: false, erreur: 'corps JSON invalide' }; }
  var fichiers = Array.isArray(corps.fichiers) ? corps.fichiers : [];
  if (!fichiers.length) return { ok: false, erreur: 'aucun fichier' };

  var debut = Date.now();
  var ecrits = 0, ignores = 0;
  for (var i = 0; i < fichiers.length; i++) {
    if (Date.now() - debut > CONFIG.MIROIR_BUDGET_MS) break; // garde-temps — le reste au lot suivant
    var f = fichiers[i];
    if (!f || typeof f.chemin !== 'string' || typeof f.contenu !== 'string') { ignores++; continue; }
    if (ecrireFichierMiroir_(f.chemin, f.contenu, f.binaire === true)) ecrits++; else ignores++;
  }
  journalInfo_('Miroir', ecrits + ' fichier(s) synchronisé(s) vers Drive, ' + ignores + ' ignoré(s)/échoué(s).');
  return { ok: true, ecrits: ecrits, ignores: ignores };
}
