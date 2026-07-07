/**
 * Miroir.gs — synchronise une copie TEXTE (.txt) du dépôt GitHub vers un dossier dédié du Drive de
 * Marc (ADR-0017, demande Marc : « accéder de partout » + NotebookLM, qui ingère depuis Drive).
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
 */

/** Dossier racine du miroir (hors domaines, à côté de `_Doublons`/`_Technique`). */
function dossierMiroir_() {
  return dossierRacineParNom_('_Miroir du dépôt', 'DriveAI_MIROIR_ID');
}

// Extensions clairement BINAIRES qu'on n'essaie pas de convertir en texte (illisibles pour
// NotebookLM de toute façon — un octet-à-octet .png en ".txt" ne serait pas un texte exploitable).
var EXT_MIROIR_BINAIRES = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tif', '.tiff',
  '.heic', '.heif', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.zip', '.gz', '.tar', '.pdf'];

/** Vrai si ce chemin de dépôt doit être inclus dans le miroir (texte, pas binaire, pas de remontée). PUR. */
function estFichierMiroirable_(chemin) {
  var c = String(chemin == null ? '' : chemin);
  if (!c || c.indexOf('..') !== -1) return false; // jamais de remontée de chemin hors du miroir
  var ext = (extension_(c) || '').toLowerCase();
  return EXT_MIROIR_BINAIRES.indexOf(ext) === -1;
}

/** Nettoie UN segment de chemin (dossier ou fichier) pour Drive : caractères interdits → '-'. PUR. */
function nettoyerSegmentChemin_(segment) {
  return String(segment == null ? '' : segment).replace(/[\/\\:*?"<>|]/g, '-').trim();
}

/** Segments de DOSSIER (sans le nom de fichier final), nettoyés, jamais vides. PUR. */
function dossiersMiroir_(chemin) {
  var segs = String(chemin == null ? '' : chemin).split('/').filter(Boolean).map(nettoyerSegmentChemin_);
  return segs.slice(0, -1).filter(Boolean);
}

/** Nom de fichier final dans le miroir : toujours `.txt` (lisible par NotebookLM), quelle que soit
 *  l'extension d'origine (ex. "Router.gs" → "Router.gs.txt"). PUR. */
function nomFichierMiroir_(chemin) {
  var s = String(chemin == null ? '' : chemin);
  if (!s || /\/$/.test(s)) return ''; // chemin vide ou finissant par '/' → pas de nom de fichier
  var segs = s.split('/').filter(Boolean).map(nettoyerSegmentChemin_);
  if (!segs.length) return '';
  var base = segs[segs.length - 1];
  if (!base) return '';
  return /\.txt$/i.test(base) ? base : base + '.txt';
}

/**
 * Trouve/crée la chaîne de sous-dossiers sous le miroir correspondant aux segments de dossier.
 * @param {string[]} segments
 * @return {Folder}
 */
function dossierMiroirPourChemin_(segments) {
  var courant = dossierMiroir_();
  for (var i = 0; i < segments.length; i++) {
    courant = sousDossier_(courant, segments[i]);
  }
  return courant;
}

/**
 * Écrit (crée ou MET À JOUR) un fichier texte dans le miroir. Jamais de suppression. Utilise le
 * service Drive STANDARD (`DriveApp`, comme partout ailleurs dans le moteur pour créer/lire — pas
 * l'Advanced Drive Service, cf. LESSONS). Idempotent par nom dans son dossier.
 * @param {string} chemin   chemin relatif dans le dépôt (ex. "src/Router.gs")
 * @param {string} contenu  contenu texte (déjà en UTF-8)
 * @return {boolean} vrai si écrit avec succès.
 */
function ecrireFichierMiroir_(chemin, contenu) {
  if (!estFichierMiroirable_(chemin)) return false;
  var nom = nomFichierMiroir_(chemin);
  if (!nom) return false;
  try {
    var dossier = dossierMiroirPourChemin_(dossiersMiroir_(chemin));
    var it = dossier.getFilesByName(nom);
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
    if (ecrireFichierMiroir_(f.chemin, f.contenu)) ecrits++; else ignores++;
  }
  journalInfo_('Miroir', ecrits + ' fichier(s) synchronisé(s) vers Drive, ' + ignores + ' ignoré(s)/échoué(s).');
  return { ok: true, ecrits: ecrits, ignores: ignores };
}
