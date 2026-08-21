/**
 * DocumentsID.gs — DRAINAGE de la structure héritée `Documents ID` (C28-73, ADR-0048).
 *
 * `Documents ID` est un dossier créé à la main en 2023, HORS de l'arborescence DriveAI, qui double
 * partiellement `01 · Administratif & identité/Pièces d'identité` : 15 fichiers, dont les 2 NAS de
 * Marc et 4 passeports. Décision de Marc du 2026-08-20 : **tout drainer**.
 *
 * 🔴 POURQUOI CE N'EST PAS UN `moveTo`. Aucun de ces 15 noms n'est au format canonique
 * `AAAA-MM-JJ_Type_Émetteur.ext`, donc `analyserNomClasse_` n'en tire ni type ni date, et
 * `cheminCibleConsolidation_` les cible à la **RACINE du domaine** (mesuré, ADR-0048 §3). Un
 * déplacement vers `Pièces d'identité/Marc` serait donc DÉFAIT au tick suivant par la
 * consolidation — active, auto-exécutante, à collecte récursive — qui viderait les passeports de
 * Marc à plat à la racine de `01`, sans une ligne rouge nulle part.
 *
 * On passe donc par `traiterDocument_` (OCR → LLM → nommage canonique → placement) : le fichier
 * ressort RENOMMÉ, et alors les trois règles (flux, table, consolidation) tombent d'accord.
 * ~15 documents × 0,026 $ ≈ 0,39 $ one-shot. À cette échelle, le bon chemin coûte moins cher qu'une
 * mise au point du mauvais.
 *
 * MANUEL — et c'est un choix d'ingénierie, pas de la paresse : le registre de suivi
 * C28-44 est SATURÉ (8 377/8 500 octets, aucune 43ᵉ étape possible) et l'enveloppe runtime est à
 * 63/65 min/j. Une campagne de tick pour 15 fichiers one-shot consommerait les deux ressources les
 * plus rares du moteur pour un travail qui tient en une exécution. Marc lance
 * `DocumentsID.gs` → `drainerDocumentsID` → Exécuter.
 */

/** Clé d'idempotence du drainage — namespace DÉDIÉ (jamais `drive|`, déjà celui des dépôts classés). */
function cleDrainageDocumentsID_(tag, fileId) {
  return 'drainid|' + tag + '|' + fileId;
}

/**
 * PURE — dossiers SOURCES du drainage, par IDENTITÉ (jamais par nom).
 *
 * Le périmètre se définit par des IDs FIXES : un drainage qui chercherait « le dossier nommé
 * Documents ID » suivrait un renommage ou un homonyme, et cette campagne fait passer des documents
 * par un pipeline qui les RENOMME et les DÉPLACE — se tromper de périmètre n'y est pas rattrapable
 * d'un clic (leçon §9 : « le périmètre se définit aussi par IDENTITÉ, pas seulement par nom »).
 * @param {Object} cfg  `CONFIG.DOCUMENTS_ID`
 * @return {string[]}
 */
function dossiersDrainageDocumentsID_(cfg) {
  var c = cfg || {};
  var ids = [];
  if (c.racine) ids.push(String(c.racine));
  (c.sousDossiers || []).forEach(function (id) { if (id) ids.push(String(id)); });
  var vus = {}, out = [];
  ids.forEach(function (id) { if (!vus[id]) { vus[id] = 1; out.push(id); } });
  return out;
}

/**
 * PURE — ce type MIME est-il drainable ?
 * Les DOSSIERS et les RACCOURCIS sont écartés : un raccourci pointe un fichier qui vit ailleurs,
 * le « déplacer » ne déplacerait que le pointeur et laisserait l'original où il est — pire, le
 * pipeline le renommerait comme s'il l'avait classé.
 * @param {string} mime
 * @return {boolean}
 */
function estDrainableDocumentsID_(mime) {
  var m = String(mime == null ? '' : mime);
  // TOUT le namespace `application/vnd.google-apps` est écarté, pas seulement dossiers et raccourcis.
  // Un Google Doc/Sheet a `getSize() === 0` (aucun octet propre) : le pipeline matérialiserait un
  // blob d'export, hasherait l'export et OCR-iserait l'export. `Intake.gs` sait faire ça (statut
  // `natif`, `exportNatifMime_`, `ignorerDoublon` quand l'export est quasi vide — sinon deux natifs
  // presque vides partagent MD5("") et le second part en `_Doublons` en silence). Ce module ne sait
  // pas : il l'écarte et le DIT, plutôt que de deviner. Aucun des 15 fichiers réels n'est natif —
  // c'est un piège armé pour le jour où Marc glisse un Google Doc dans le dossier avant de cliquer.
  return m.indexOf('application/vnd.google-apps') !== 0;
}

/**
 * PURE — bilan lisible d'un drainage.
 * @param {{traites:number, deja:number, proteges:number, ignores:number, echecs:number}} b
 * @return {string}
 */
function bilanDrainageDocumentsID_(b) {
  var t = b.traites + ' document(s) drainé(s), ' + b.deja + ' déjà fait(s), ' +
    b.proteges + ' protégé(s) laissé(s) en place, ' +
    b.ignores + ' ignoré(s) (dossier, raccourci ou natif Google), ' + b.echecs + ' échec(s)';
  // `nonAboutis` = le pipeline a été appelé mais N'A PAS inscrit sa clé : classification impossible,
  // placement Drive refusé, OCR en erreur… Le fichier est RESTÉ dans `Documents ID`. Sans ce compteur
  // séparé, ces cas étaient comptés « drainés » et le bilan mentait (revue code).
  if (b.nonAboutis) {
    t += ', ' + b.nonAboutis + ' NON abouti(s) — restés en place, relancer la fonction les re-tente';
  }
  if (b.epingles) t += ', ' + b.epingles + ' épinglé(s) par Marc (jamais re-déplacé)';
  if (b.autresProprietaires) t += ', ' + b.autresProprietaires + ' appartenant à un TIERS (laissé intact)';
  return t + '.';
}

/**
 * UN fichier, par le pipeline complet. Extraite de la boucle EXPRÈS : les fermetures `placer` et
 * `blob` capturent `fileId`/`parentId`, et une fermeture créée dans une boucle qui réassigne ses
 * variables est le patron qui fige la valeur du PREMIER tour (leçon §9, vécu sur les mocks de test).
 * Ici chaque appel a sa propre portée : impossible qu'un fichier soit déplacé à la place d'un autre.
 * @param {File} f
 * @param {string} parentId  dossier SOURCE (retiré des parents par le déplacement)
 * @param {string} cle  clé d'idempotence, inscrite par le pipeline en toute fin
 */
function drainerUnFichierDocumentsID_(f, parentId, cle) {
  var fileId = f.getId();
  var blobMemo = null;
  traiterDocument_({
    cle: cle,
    nom: f.getName(),
    taille: f.getSize(),
    expediteur: '',
    sujet: 'Drainage Documents ID (ADR-0048)',
    date: f.getDateCreated(),
    // OBLIGATOIRE : deux de ces fichiers ont un contenu DÉJÀ à l'Index (leurs jumeaux dorment dans
    // `_Doublons`). Sans ce bypass ils seraient « doublon d'eux-mêmes » et repartiraient dans
    // `_Doublons` — le défaut exact qu'ADR-0047 vient de mesurer sur 1 076 fichiers.
    ignorerDoublon: true,
    blob: function () { if (blobMemo === null) blobMemo = f.getBlob(); return blobMemo; },
    placer: function (dossierId, nouveauNom) {
      if (dossierId === parentId) return renommer_(fileId, nouveauNom) ? fileId : '';
      return deplacerEtRenommer_(fileId, dossierId, parentId, nouveauNom) ? fileId : '';
    }
  });
}

/**
 * Le fichier appartient-il à Marc ? Ne propage JAMAIS d'exception : au moindre doute on répond
 * `false`, c'est-à-dire « on n'y touche pas » — un renommage-déplacement sur le fichier d'un tiers
 * le retirerait de SON dossier partagé.
 * @param {File} f
 * @return {boolean}
 */
function estPossedeParMarcDocumentsID_(f) {
  try {
    var moi = Session.getEffectiveUser().getEmail();
    var proprio = f.getOwner();
    return !!(moi && proprio && proprio.getEmail() === moi);
  } catch (e) {
    return false; // échec fermé : illisible ⇒ on laisse en place
  }
}

/**
 * Collecte les IDs DRAINABLES d'un dossier — LECTURE SEULE, AVANT toute mutation.
 *
 * Le déplacement pendant l'itération invaliderait l'itérateur : c'est écrit noir sur blanc dans les
 * deux modules dont ce fichier revendique le patron (`Intake.gs` « Collecte LECTURE SEULE », et
 * `Migration.gs` « IDs seuls — le déplacement pendant l'itération invaliderait l'itérateur »). Le
 * saut resterait rattrapable (les sautés ne sont pas indexés, une relance les reprend) — mais le
 * bilan afficherait « TERMINÉ », c'est-à-dire exactement le signal qui empêche de relancer. C'est la
 * COMBINAISON qui coûte cher, pas le saut.
 * @param {Folder} dossier
 * @param {number} place  nombre d'IDs encore acceptables (plafond par run)
 * @param {Object} b  bilan, incrémenté pour les écartés
 * @return {string[]}
 */
function collecterDrainageDocumentsID_(dossier, place, b) {
  var ids = [];
  var it = dossier.getFiles();
  while (it.hasNext() && ids.length < place) {
    var f = it.next();
    if (!estDrainableDocumentsID_(f.getMimeType())) { b.ignores++; continue; }
    ids.push(f.getId());
  }
  return ids;
}

/**
 * UN CLIC — draine `Documents ID` par le pipeline. LECTURE + renommage + déplacement ; jamais de
 * suppression (§2). Idempotent par `drainid|<tag>|<fileId>` : relancer ne re-traite rien.
 *
 * ⚠️ MANUELLE : elle ne consomme AUCUN budget de tick et n'est bridée par aucun (leçon C28-33 —
 * un budget calibré pour les déclencheurs ne doit ni brider ni être consommé par une exécution
 * depuis l'éditeur, sous peine de double peine). Son seul garde est le mur des 6 minutes.
 *
 * @return {string} bilan (affiché dans le Journal ET rendu à l'éditeur)
 */
function drainerDocumentsID() {
  var cfg = CONFIG.DOCUMENTS_ID || {};
  var dossiers = dossiersDrainageDocumentsID_(cfg);
  if (!dossiers.length) return finDrainageDocumentsID_(
    'Drainage `Documents ID` : AUCUN dossier source déclaré (CONFIG.DOCUMENTS_ID) — rien à faire.', false);

  // VERROU — cette fonction mute Drive et l'Index pendant plusieurs minutes, alors qu'un tick part
  // toutes les 5 min : le recouvrement est quasi garanti. Tous les points d'entrée manuels du dépôt
  // le prennent (`Reset.gs`, `Maintenance.gs`) ; celui-ci ne le faisait pas.
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(3 * 60 * 1000)) return finDrainageDocumentsID_(
    'Drainage `Documents ID` : le moteur travaille déjà (verrou occupé) — réessayer dans une minute.', false);

  var b = { traites: 0, deja: 0, proteges: 0, ignores: 0, echecs: 0, nonAboutis: 0,
    epingles: 0, autresProprietaires: 0 };
  var opPrecedente = operationCourante_();
  try {
    // État de panne PERSISTÉ : `chargerPannePlateforme_` n'est appelée qu'en tête de tick. Sans elle,
    // une exécution manuelle repart en appels réseau alors qu'une suspension est en cours.
    try { chargerPannePlateforme_(); } catch (ePanne) { /* pire cas : on découvrira la panne au 1er appel */ }
    if (estPannePlateforme_()) return finDrainageDocumentsID_(
      'Drainage `Documents ID` SUSPENDU — panne du compte LLM en cours. Rien n\'a été touché. ' +
      'Relancer une fois le compte rétabli.', true);
    if (budgetCampagnesAtteint_()) return finDrainageDocumentsID_(
      'Drainage `Documents ID` REPORTÉ — le frein budget des campagnes est atteint (CONFIG.LLM_BUDGET_CAMPAGNES). ' +
      'Rien n\'a été touché.', true);

    // COMPTABILITÉ DU COÛT : `_usageRun` est une variable de MODULE que seul `reinitialiserUsage_`
    // peuple. Hors tick, elle vaut `null` et `enregistrerUsage_` sort en silence — chaque appel
    // Sonnet de ce drainage échapperait à `DriveAI_COUT_*`, à la ventilation, au frein §1.6 et au
    // cumul publié au hub. Les « ~0,39 $ » n'apparaîtraient JAMAIS nulle part. Même patron que les
    // autres points d'entrée hors tick (`Reset.gs`, `WebApp.gs`).
    reinitialiserUsage_();
    poserOperationCourante_('drainage-documents-id');

    var tag = String(cfg.tag || 'd1');
    var proteges = ensembleDomainesProteges_();
    var debut = Date.now();
    // Budget du RUN : `budgetMsRun_()` et non `CONFIG.BUDGET_MS` — ce dernier (270 s) est calibré
    // Haiku, alors que le pipeline tourne en Sonnet 2 passes. Et on ne DÉMARRE plus un document dans
    // la dernière minute (`PILOTE_MARGE_DOC_MS`) : le garde n'est évalué qu'AVANT de prendre le
    // document, or OCR + 2 passes Sonnet + un retry peuvent coûter 1 à 3 min — de quoi franchir le
    // mur dur des 6 min et faire tuer l'exécution SANS aucun bilan écrit.
    var murDemarrage = Math.max(0, budgetMsRun_() - CONFIG.PILOTE_MARGE_DOC_MS);
    var plafond = Number(cfg.maxParRun) || 30;

    for (var i = 0; i < dossiers.length; i++) {
      var parentId = dossiers[i];
      var ids;
      try {
        ids = collecterDrainageDocumentsID_(DriveApp.getFolderById(parentId), plafond - b.traites - b.nonAboutis, b);
      } catch (eDoss) {
        journalErreur_('DocumentsID', 'Dossier illisible ' + parentId + ' : ' + eDoss);
        b.echecs++;
        continue; // un poison n'affame jamais les sources suivantes
      }
      for (var j = 0; j < ids.length; j++) {
        if (Date.now() - debut > murDemarrage) return finDrainageDocumentsID_(
          'Drainage `Documents ID` INTERROMPU par le garde-temps — ' + bilanDrainageDocumentsID_(b) +
          ' Relancer la fonction reprend où elle s\'est arrêtée.', true);
        // Une panne de compte survenue EN COURS de run arrête tout : sinon les documents restants
        // seraient « traités » sans que rien ne bouge, et le bilan annoncerait TERMINÉ.
        if (estPannePlateforme_()) return finDrainageDocumentsID_(
          'Drainage `Documents ID` SUSPENDU — panne du compte LLM survenue en cours de run. ' +
          bilanDrainageDocumentsID_(b) + ' Relancer une fois le compte rétabli.', true);

        var cle = cleDrainageDocumentsID_(tag, ids[j]);
        if (indexContient_(cle)) { b.deja++; continue; }
        // ÉPINGLÉ par Marc (ADR-0026) : un fichier rangé à la main via le chat porte `epingle|<id>`.
        // Tous les modules de re-rangement du dépôt testent cette clé — celui-ci ne le faisait pas,
        // il était le seul. Sans elle, un bump de `tag` re-déplacerait ce que Marc a rangé lui-même.
        if (indexContient_('epingle|' + ids[j])) { b.epingles++; continue; }
        var f;
        try { f = DriveApp.getFileById(ids[j]); }
        catch (eF) { journalErreur_('DocumentsID', 'Fichier illisible ' + ids[j] + ' : ' + eF); b.echecs++; continue; }
        // Fichier NON possédé par Marc : la politique du projet pour ce cas est la COPIE
        // (`Partages.gs`), jamais le renommage-déplacement de l'original — qui le retirerait du
        // dossier partagé de son propriétaire. Les 15 fichiers réels sont à Marc ; cette garde
        // existe pour le jour où un ID de la config pointera ailleurs.
        if (!estPossedeParMarcDocumentsID_(f)) { b.autresProprietaires++; continue; }
        // Zone protégée RE-VÉRIFIÉE en mode strict juste avant la mutation (échec fermé) : ce dossier
        // est hors arborescence, mais un fichier multi-parents peut avoir un pied sous `04`.
        if (aParentProtege_(f, proteges, true)) { b.proteges++; continue; }

        try {
          drainerUnFichierDocumentsID_(f, parentId, cle);
        } catch (e) {
          journalErreur_('DocumentsID', 'Échec sur « ' + f.getName() + ' » : ' + e);
          b.echecs++;
          continue;
        }
        // LE VERDICT VIENT DE L'INDEX, pas du fait d'avoir appelé le pipeline. `traiterDocument_`
        // avale ses propres erreurs (classification impossible, placement refusé, OCR en panne) et
        // ne rend rien : compter les APPELS faisait dire « 15 drainés, 0 échec » alors qu'aucun
        // fichier n'avait bougé. L'Index fait foi (§9), et `indexAjouter_` met le cache à jour donc
        // la relecture est gratuite.
        if (indexContient_(cle)) b.traites++; else b.nonAboutis++;
      }
    }

    return finDrainageDocumentsID_('Drainage `Documents ID` TERMINÉ (tag ' + tag + ') : ' +
      bilanDrainageDocumentsID_(b) +
      ' Un document resté « déjà fait » sans avoir bougé est en quarantaine : bumper ' +
      'CONFIG.DOCUMENTS_ID.tag pour le rejouer (la dé-quarantaine auto ne traite que les clés `drive|`).' +
      ' Le dossier vidé n\'est PAS supprimé (§2) — il apparaîtra en `vide-candidat` dans l\'app.', true);
  } finally {
    // Le coût est écrit MÊME sur exception : une panne ne doit pas faire disparaître les dollars
    // déjà dépensés (ils ont bel et bien été facturés).
    try { flushUsage_(); } catch (eFlush) { /* best-effort */ }
    poserOperationCourante_(opPrecedente);
    try { verrou.releaseLock(); } catch (eV) { /* best-effort */ }
  }
}

/**
 * Sortie UNIQUE du drainage : journalise, TRACE DANS L'ÉDITEUR, et rend le texte.
 * `Logger.log` est indispensable : l'éditeur Apps Script n'affiche PAS la valeur de retour d'une
 * fonction, il affiche le journal d'exécution. Sans lui, Marc clique, attend plusieurs minutes, et
 * ne voit rien — il devrait aller ouvrir la Sheet pour savoir ce qui s'est passé.
 * @param {string} texte
 * @param {boolean} estErreur  vrai pour les sorties anormales (panne, frein, interruption)
 * @return {string}
 */
function finDrainageDocumentsID_(texte, estErreur) {
  try { if (estErreur) journalErreur_('DocumentsID', texte); else journalInfo_('DocumentsID', texte); }
  catch (e) { /* le bilan reste rendu à l'éditeur même si la Sheet est illisible */ }
  try { Logger.log(texte); } catch (e2) { }
  return texte;
}
