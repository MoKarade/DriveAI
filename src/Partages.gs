/**
 * Partages.gs — Source d'intake #3 : fichiers PARTAGÉS avec Marc (ADR-0005, chantier #7).
 *
 * À parité avec les PJ Gmail : source EXTERNE en lecture → DriveAI en fait une COPIE dans son
 * arborescence (l'original reste chez la personne qui partage). Chaque fichier passe par le pipeline
 * commun (Pipeline.gs : dédup → technique → OCR → LLM → routage → placement → Index), exactement
 * comme une PJ Gmail. Seul le collecteur est nouveau.
 *
 * Idempotence : clé `shared|fileId` dans l'Index, posée par le pipeline en fin de traitement (comme
 * `drive|` et `messageId|…`). Le collecteur pré-saute les fichiers déjà indexés (pas de re-download).
 *
 * Convergence (leçon « pagination sur recherche mouvante ») : contrairement à l'historique Gmail
 * (des années), les partages sont peu nombreux ET bornés par une petite fenêtre de récence. Le tri
 * `sharedWithMeTime desc` permet un STOP dès le premier partage hors fenêtre, et le plafond compte les
 * fichiers RÉELLEMENT copiés (les sauts « déjà fait »/« mauvais type » sont gratuits, métadonnées seules)
 * → chaque tick progresse sur le reliquat, sans plateau. Si le volume devenait grand, appliquer le
 * curseur ancré (`before:`/date persistée) comme pour Gmail.
 *
 * Aucun nouveau scope OAuth : `drive` couvre déjà la lecture des fichiers partagés (REST via UrlFetchApp,
 * comme le reste — robuste après `clasp push`, cf. LESSONS « API Google via REST »).
 */

/* ---------- Décisions PURES (testées) ---------- */

/**
 * Type « document » copiable ? ALLOWLIST stricte (ADR-0005) : images (scans) + PDF/Office. Tout le reste
 * — vidéo, audio, Google natif collaboratif, archives, raccourcis, dossiers — est ignoré (anti-bruit,
 * anti-storage). PUR.
 * @param {string} mime  MIME type Drive
 * @return {boolean}
 */
function estTypeDocumentPartage_(mime) {
  if (!mime) return false;
  if (mime.indexOf('image/') === 0) return true;            // scans : jpeg/png/tiff/heic…
  return CONFIG.PARTAGES_MIME_DOC.indexOf(mime) !== -1;      // PDF/Office (le reste est implicitement exclu)
}

/**
 * Classe l'âge d'un partage vs la fenêtre de récence. PUR. Tri-état volontaire : le collecteur DOIT
 * distinguer une date VALIDE mais ancienne (⇒ STOP total, car la liste est triée du + récent au + vieux)
 * d'une date ABSENTE/illisible (⇒ sauter CET item seulement, jamais halter toute la collecte — sinon un
 * unique partage sans `sharedWithMeTime` gèlerait l'intake des partages à chaque tick).
 * @param {string} sharedIso     `sharedWithMeTime` (ISO 8601) renvoyé par l'API Drive
 * @param {number} maintenantMs  Date.now()
 * @param {number} fenetreJours  largeur de la fenêtre
 * @return {'recent'|'vieux'|'inconnu'}
 */
function classerRecencePartage_(sharedIso, maintenantMs, fenetreJours) {
  if (!sharedIso) return 'inconnu';
  var t = Date.parse(sharedIso);
  if (isNaN(t)) return 'inconnu';
  return (maintenantMs - t) <= fenetreJours * 24 * 60 * 60 * 1000 ? 'recent' : 'vieux';
}

/**
 * Stockage presque plein ? PUR. `quota` = `storageQuota` REST { limit, usage } (chaînes d'octets).
 * Un compte SANS limite (limit absent/0 → Workspace illimité) n'est jamais « plein ». Une valeur
 * illisible ne bloque pas la copie (on préfère copier que suspendre à tort — rien n'est supprimé).
 * @param {?Object} quota
 * @param {number} seuil  fraction (0..1) au-delà de laquelle on suspend la copie
 * @return {boolean}
 */
function stockagePresquePleinCalc_(quota, seuil) {
  if (!quota) return false;
  var limit = Number(quota.limit);
  var usage = Number(quota.usage);
  if (!limit || isNaN(limit) || isNaN(usage)) return false; // illimité / inconnu → ne bloque pas
  return usage / limit >= seuil;
}

/* ---------- Accès Drive REST (effectful) ---------- */

/** Quota de stockage (REST about.get). @return {?{limit,usage}} ou null si indisponible. */
function quotaStockage_() {
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
    method: 'get', headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true
  });
  if (rep.getResponseCode() !== 200) return null;
  try { return JSON.parse(rep.getContentText()).storageQuota || null; } catch (e) { return null; }
}

/**
 * Une page de fichiers partagés récents (REST files.list), triés du plus récemment partagé au plus
 * ancien pour permettre l'arrêt anticipé sur la fenêtre de récence.
 * @param {?string} pageToken
 * @return {{fichiers:Array, pageToken:?string}}
 */
function listerPartagesRecents_(pageToken) {
  var params = 'q=' + encodeURIComponent('sharedWithMe = true and trashed = false') +
    '&orderBy=' + encodeURIComponent('sharedWithMeTime desc') +
    '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,size,sharedWithMeTime)') +
    '&pageSize=' + CONFIG.PARTAGES_PAGE +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
  var rep = fetchDriveAvecRetry_('https://www.googleapis.com/drive/v3/files?' + params, {
    method: 'get', headers: { Authorization: 'Bearer ' + jetonDrive_() }, muteHttpExceptions: true
  });
  if (rep.getResponseCode() !== 200) {
    journalErreur_('Partages', 'Liste des partages HTTP ' + rep.getResponseCode() + ' : ' +
      tronquer_(rep.getContentText(), 200));
    return { fichiers: [], pageToken: null };
  }
  try {
    var data = JSON.parse(rep.getContentText());
    return { fichiers: data.files || [], pageToken: data.nextPageToken || null };
  } catch (e) {
    journalErreur_('Partages', 'Réponse liste illisible : ' + e);
    return { fichiers: [], pageToken: null };
  }
}

/**
 * Construit le descripteur d'un fichier partagé et le passe au pipeline (COPIE, comme une PJ Gmail).
 * L'original reste chez la personne — on ne le touche jamais (ni déplacement ni suppression). Le contenu
 * est téléchargé UNE fois (mémoïsé) et réutilisé par `blob()` (hash + OCR) puis `placer()` (dépôt) — le
 * pipeline appelle chacun une fois ; sans mémoïsation ce serait 2 downloads complets du même fichier.
 * @param {{id:string, name:string, size:string, mimeType:string, sharedWithMeTime:string}} meta
 */
function traiterPartage_(meta) {
  var fileId = meta.id;
  var blobMemo = null;
  function blobUneFois_() {
    if (blobMemo === null) blobMemo = DriveApp.getFileById(fileId).getBlob();
    return blobMemo;
  }
  traiterDocument_({
    cle: 'shared|' + fileId,                                    // idempotence (posée par le pipeline)
    nom: meta.name,
    taille: Number(meta.size) || 0,
    expediteur: '',
    sujet: 'Fichier partagé',
    date: meta.sharedWithMeTime ? new Date(meta.sharedWithMeTime) : new Date(),
    blob: blobUneFois_,
    placer: function (dossierId, nom) { return deposer_(blobUneFois_(), dossierId, nom); }
    // (plus de `placerRevue` : la file de revue n'existe plus depuis 2026-07-01, le pipeline ne l'appelle jamais)
  });
}

/** Alerte UNE fois par épisode que le stockage est presque plein (anti-spam via Script Property). */
function alerterStockagePlein_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_STORAGE_ALERTE') === '1') return; // déjà alerté cet épisode
  props.setProperty('DriveAI_STORAGE_ALERTE', '1');
  var pct = Math.round(CONFIG.STORAGE_SEUIL * 100);
  journalErreur_('Partages', 'Stockage Drive ≥ ' + pct + ' % — copie des partages SUSPENDUE. ' +
    'Aucune suppression effectuée ; reprise automatique quand de la place se libère.');
  try {
    var dest = emailAlerte_();
    if (dest) MailApp.sendEmail(dest, '[DriveAI] Stockage Drive presque plein',
      'DriveAI a suspendu la copie des fichiers partagés : le stockage Drive est à ≥ ' + pct + ' %.\n' +
      'Libère un peu d\'espace — la copie des partages reprendra toute seule au tick suivant.\n' +
      '(Aucun fichier n\'a été supprimé.)');
  } catch (e) { /* alerte best-effort : ne doit jamais faire échouer le tick */ }
}

/* ---------- Collecteur (source d'intake #3) ---------- */

/**
 * Copie les fichiers partagés récents de type document dans l'arbo de Marc, puis les laisse suivre le
 * pipeline commun. Borné par run (`PARTAGES_MAX_PAR_RUN`) + garde-temps, idempotent (Index `shared|`),
 * storage-aware (vérif LAZY : uniquement si un fichier est réellement à copier — pas de coût quand rien
 * de neuf). Enveloppé par l'appelant : un échec réseau ne doit jamais bloquer le reste de l'intake.
 * @param {function():boolean} estBudgetDepasse  garde-temps partagé du run
 */
function collecterPartages_(estBudgetDepasse) {
  if (!CONFIG.PARTAGES_ACTIF) return;

  var maintenant = Date.now();
  var traites = 0, pageToken = null, storageOk = null, fini = false; // storageOk null = pas encore vérifié (lazy)
  do {
    var lot = listerPartagesRecents_(pageToken);
    for (var i = 0; i < lot.fichiers.length && !fini; i++) {
      if (estBudgetDepasse() || traites >= CONFIG.PARTAGES_MAX_PAR_RUN) { fini = true; break; }
      var meta = lot.fichiers[i];
      // Tri `sharedWithMeTime desc` : une date VALIDE + ancienne ⇒ tout le reste est plus vieux ⇒ STOP total.
      // Une date ABSENTE/illisible ⇒ on saute CET item seulement (jamais halter toute la collecte).
      var rec = classerRecencePartage_(meta.sharedWithMeTime, maintenant, CONFIG.PARTAGES_FENETRE_JOURS);
      if (rec === 'vieux') { fini = true; break; }
      if (rec === 'inconnu') continue;
      if (!estTypeDocumentPartage_(meta.mimeType)) continue;     // média / Google natif / archive → ignoré
      // Garde de taille (les partages ne sont pas plafonnés comme les PJ Gmail) : au-delà, on ne copie pas.
      if (Number(meta.size) > CONFIG.PARTAGES_TAILLE_MAX) {
        journalInfo_('Partages', 'Partage trop volumineux, non copié : ' + meta.name +
          ' (' + Math.round(Number(meta.size) / (1024 * 1024)) + ' Mo)');
        continue;
      }
      if (indexContient_('shared|' + meta.id)) continue;          // déjà copié → pas de re-download

      // Premier candidat RÉELLEMENT à copier → on vérifie le stockage (1×/run, pas quand la file est vide).
      if (storageOk === null) {
        storageOk = !stockagePresquePleinCalc_(quotaStockage_(), CONFIG.STORAGE_SEUIL);
        if (storageOk) PropertiesService.getScriptProperties().deleteProperty('DriveAI_STORAGE_ALERTE'); // épisode clos
        else { alerterStockagePlein_(); fini = true; break; }
      }
      traiterPartage_(meta);
      traites++;
    }
    pageToken = fini ? null : lot.pageToken;
  } while (pageToken && !estBudgetDepasse());

  if (traites) journalInfo_('Partages', traites + ' fichier(s) partagé(s) copié(s) dans l\'arbo.');
}
