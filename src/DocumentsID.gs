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
 * MANUEL, une fois — et c'est un choix d'ingénierie, pas de la paresse : le registre de suivi
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
  return m !== 'application/vnd.google-apps.folder' && m !== 'application/vnd.google-apps.shortcut';
}

/**
 * PURE — bilan lisible d'un drainage.
 * @param {{traites:number, deja:number, proteges:number, ignores:number, echecs:number}} b
 * @return {string}
 */
function bilanDrainageDocumentsID_(b) {
  return b.traites + ' document(s) drainé(s), ' + b.deja + ' déjà fait(s), ' +
    b.proteges + ' protégé(s) laissé(s) en place, ' + b.ignores + ' ignoré(s) (dossier/raccourci), ' +
    b.echecs + ' échec(s).';
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
  if (!dossiers.length) {
    var rien = 'Drainage `Documents ID` : AUCUN dossier source déclaré (CONFIG.DOCUMENTS_ID) — rien à faire.';
    journalInfo_('DocumentsID', rien);
    return rien;
  }
  var tag = String(cfg.tag || 'd1');
  var proteges = ensembleDomainesProteges_();
  var debut = Date.now();
  var b = { traites: 0, deja: 0, proteges: 0, ignores: 0, echecs: 0 };

  for (var i = 0; i < dossiers.length; i++) {
    var parentId = dossiers[i];
    var dossier;
    try { dossier = DriveApp.getFolderById(parentId); }
    catch (eDoss) { journalErreur_('DocumentsID', 'Dossier illisible ' + parentId + ' : ' + eDoss); b.echecs++; continue; }

    var it = dossier.getFiles();
    while (it.hasNext()) {
      // Garde-temps DANS la boucle qui fait l'I/O, jamais dans une sélection préalable (leçon §9).
      if (Date.now() - debut > CONFIG.BUDGET_MS) {
        var partiel = 'Drainage `Documents ID` INTERROMPU par le garde-temps — ' +
          bilanDrainageDocumentsID_(b) + ' Relancer la fonction reprend là où elle s\'est arrêtée.';
        journalInfo_('DocumentsID', partiel);
        return partiel;
      }
      var f = it.next();
      if (!estDrainableDocumentsID_(f.getMimeType())) { b.ignores++; continue; }
      var fileId = f.getId();
      var cle = cleDrainageDocumentsID_(tag, fileId);
      if (indexContient_(cle)) { b.deja++; continue; }
      // Zone protégée RE-VÉRIFIÉE juste avant la mutation, en mode strict (échec fermé) : ce dossier
      // est hors arborescence, mais un fichier multi-parents peut avoir un pied sous `04`.
      if (aParentProtege_(f, proteges, true)) { b.proteges++; continue; }

      try {
        drainerUnFichierDocumentsID_(f, parentId, cle);
        b.traites++;
      } catch (e) {
        journalErreur_('DocumentsID', 'Échec sur « ' + f.getName() + ' » : ' + e);
        b.echecs++;
      }
    }
  }

  var fini = 'Drainage `Documents ID` TERMINÉ (tag ' + tag + ') : ' + bilanDrainageDocumentsID_(b) +
    ' Le dossier vidé n\'est PAS supprimé (§2) — il apparaîtra en `vide-candidat` dans l\'app.';
  journalInfo_('DocumentsID', fini);
  return fini;
}
