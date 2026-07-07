/**
 * Intake.gs — Dépôt manuel : scan du dossier `00 · À trier` (Phase 2).
 *
 * Seconde source d'intake, à parité avec Gmail : chaque fichier déposé est
 * OCRisé, analysé et routé par le même pipeline (Pipeline.gs / Router.gs).
 *
 * Différence clé : un dépôt est explicitement là POUR être trié → on le DÉPLACE
 * (jamais de copie, jamais de suppression) vers sa destination finale. Le déplacement préserve l'ID Drive, donc la clé d'idempotence
 * `drive|fileId` reste valable et le fichier n'est pas re-traité.
 *
 * ÉQUITÉ (R3, correctif « file affamée » 2026-07-07) : le grand rangement re-alimente ce même
 * dossier en continu et l'itérateur Drive sert les plus RÉCENTS d'abord — sans tri, un dépôt
 * manuel coulait indéfiniment derrière les arrivages (vécu : un PDF déposé un soir, toujours
 * pas traité 11 h et ~130 ticks plus tard). La page est donc (a) COMPOSÉE de fichiers
 * TRAITABLES seulement (les déjà-indexés ne la remplissent plus — quarantaine ET natifs sans
 * export inclus, ces derniers étant inscrits à l'Index avec le statut `natif` : un mur de skips
 * n'affame plus le reste) et (b) TRIÉE du plus ANCIEN au plus récent APRÈS collecte complète
 * (tronquer avant le tri garderait les plus récents — l'inverse de l'équité).
 */

/**
 * Traite un lot de fichiers de `00 · À trier`.
 * @param {function():boolean} estBudgetDepasse  garde-temps partagé du run
 */
function traiterDepots_(estBudgetDepasse) {
  var dossier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);

  // Collecte LECTURE SEULE (le déplacement pendant l'itération invaliderait l'itérateur),
  // bornée par INTAKE_SCAN_MAX (parcours) + le garde-temps (leçon : garde-temps sur TOUT lot Drive).
  var it = dossier.getFiles();
  var candidats = [];
  var parcourus = 0;
  while (it.hasNext() && parcourus < CONFIG.INTAKE_SCAN_MAX && !estBudgetDepasse()) {
    parcourus++;
    var f = it.next();
    var id = f.getId();
    if (indexContient_('drive|' + id)) continue; // déjà traité/quarantainé/natif : jamais dans la page
    var date = 0;
    try { date = f.getLastUpdated().getTime(); } catch (e) { /* date illisible → tête de file */ }
    candidats.push({ id: id, date: date });
  }

  // Tri AVANT troncature : la page = les INTAKE_PAGE plus ANCIENS parmi tous les collectés
  // (tronquer à la collecte prendrait les premiers servis par l'itérateur = les plus récents).
  ordonnerDepots_(candidats);
  if (candidats.length > CONFIG.INTAKE_PAGE) candidats.length = CONFIG.INTAKE_PAGE;

  for (var i = 0; i < candidats.length; i++) {
    if (estBudgetDepasse()) {
      journalInfo_('Intake', 'Budget temps atteint — reprise au prochain tick.');
      return;
    }
    // Try PAR ITEM : un fichier empoisonné (métadonnée illisible…) trié en tête de FIFO ne doit
    // JAMAIS geler la boucle ni le reste du tick (il serait re-servi premier à chaque tick).
    try { traiterFichierDepose_(candidats[i].id); }
    catch (e) { journalErreur_('Intake', 'Dépôt en échec (' + candidats[i].id + ') : ' + e); }
  }
}

/** Tri EN PLACE du plus ancien au plus récent (FIFO d'équité). PURE (testée). */
function ordonnerDepots_(candidats) {
  candidats.sort(function (a, b) { return a.date - b.date; });
  return candidats;
}

/**
 * Construit le descripteur d'un fichier déposé et le passe au pipeline.
 * Le `getFileById` et la lecture des métadonnées sont protégés : si Marc a
 * supprimé/déplacé le fichier entre la collecte des IDs et son traitement,
 * on journalise et on continue le lot (jamais d'arrêt brutal).
 * @param {string} fileId
 */
function traiterFichierDepose_(fileId) {
  var f, mime, nom;
  try {
    f = DriveApp.getFileById(fileId);
    mime = f.getMimeType();
    nom = f.getName();
  } catch (e) {
    journalErreur_('Intake', 'Fichier déposé illisible (' + fileId + ') : ' + e);
    return;
  }
  // Métadonnées SECONDAIRES lues sous garde individuelle : un getSize/getLastUpdated qui lève
  // (déjà toléré à la collecte) ne doit pas faire échouer le fichier — surtout que le tri FIFO
  // place justement « date illisible » en TÊTE de page (il gèlerait la file à chaque tick).
  var taille = 0, date;
  try { taille = f.getSize(); } catch (e) { /* natif/indisponible → 0 */ }
  try { date = f.getLastUpdated(); } catch (e) { date = new Date(); /* repli : date de traitement */ }

  var aTrier = CONFIG.DOSSIERS.A_TRIER;

  // Fichiers Google NATIFS (Docs/Sheets/Slides) : pas d'octets (getSize() = 0), mais leur TEXTE
  // s'exporte directement (R3 — la capacité qui manquait ; avant, ils stagnaient « laissés en
  // place » à vie). Le texte exporté sert d'extrait ET d'empreinte (hash stable du contenu).
  if (mime && mime.indexOf('application/vnd.google-apps') === 0) {
    if (!exportNatifMime_(mime)) {
      // Type SANS export texte (Forms, dessin…) : hors de portée PAR CONCEPTION → inscrit à
      // l'Index (statut `natif`, fichier laissé en place) pour sortir de la page d'intake et du
      // seuil de file du rangement, + signalé une fois à Marc. (Un futur lecteur devra purger
      // ces lignes, comme `dequarantaine` purge les `quarantaine`.)
      signalerNatifUneFois_(fileId, nom);
      indexAjouter_('drive|' + fileId, { statut: 'natif', domaine: '', chemin: '', nom: nom });
      return;
    }
    var texte = exporterTexteNatif_(fileId, mime);
    if (texte === null) {
      // Export ÉCHOUÉ (HTTP/réseau) sur un type exportable : échec STANDARD — compté, re-tenté,
      // quarantaine après QUARANTAINE_MAX (sinon : 1 fetch + 1 ligne d'erreur par tick, à vie).
      gererEchec_({ cle: 'drive|' + fileId, nom: nom }, 'export du texte natif échoué');
      return;
    }
    traiterDocument_({
      cle: 'drive|' + fileId,
      nom: nom,
      taille: texte.length,
      expediteur: '',
      sujet: 'Dépôt manuel (fichier Google)',
      date: date,
      // Texte quasi vide (deck d'images, tableur vierge…) : deux exports vides partagent le même
      // MD5 → sans ce bypass, le 2ᵉ partirait en `_Doublons` en silence (mal rangé à vie).
      ignorerDoublon: texte.length < CONFIG.OCR_MIN_CARS_EXPLOITABLE,
      blob: function () { return Utilities.newBlob(texte, 'text/plain', nom + '.txt'); },
      placer: function (dossierId, nouveauNom) {
        return deplacerEtRenommer_(fileId, dossierId, aTrier, nouveauNom) ? fileId : '';
      }
    });
    return;
  }

  traiterDocument_({
    cle: 'drive|' + fileId, // l'ID Drive est unique et stable, y compris après déplacement/renommage
    nom: nom,
    taille: taille,
    expediteur: '',
    sujet: 'Dépôt manuel',
    date: date,
    blob: function () { return f.getBlob(); },
    placer: function (dossierId, nouveauNom) {
      return deplacerEtRenommer_(fileId, dossierId, aTrier, nouveauNom) ? fileId : '';
    }
  });
}

/**
 * Journalise UN fichier Google natif laissé en place UNE seule fois (Property mémoire, bornée) —
 * avant R2, chaque tick re-journalisait chaque natif : 2 fichiers = ~576 lignes/jour de bruit
 * (le Journal borné tournait pour rien et le diagnostic était pollué).
 * @param {string} fileId
 * @param {string} nom
 */
function signalerNatifUneFois_(fileId, nom) {
  try {
    var props = PropertiesService.getScriptProperties();
    var ids;
    try { ids = JSON.parse(props.getProperty('DriveAI_NATIFS_SIGNALES') || '[]'); } catch (e) { ids = []; }
    if (!Array.isArray(ids)) ids = [];
    if (ids.indexOf(fileId) !== -1) return; // déjà signalé
    ids.push(fileId);
    if (ids.length > 50) ids = ids.slice(-50); // borne (au pire, un vieux natif se re-signale)
    props.setProperty('DriveAI_NATIFS_SIGNALES', JSON.stringify(ids));
  } catch (e) { /* Property indisponible → on journalise quand même (au pire du bruit) */ }
  journalInfo_('Intake', 'Fichier Google natif laissé dans 00·À trier (signalé une fois) : ' + nom);
}
