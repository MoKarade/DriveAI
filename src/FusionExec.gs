/**
 * FusionExec.gs — EXÉCUTION du plan de fusion des dossiers en double (#47 PR2, ADR-0037).
 *
 * Marc a CURÉ l'onglet `PlanFusion` (dry-run PR1, Fusion.gs) : chaque ligne SOURCE marquée
 * `Fusionner` fond les FICHIERS DIRECTS de ce dossier dans la CIBLE de son groupe. GATÉ OFF
 * (`FUSION_EXEC_ACTIF`) : ne tourne qu'au feu vert explicite de Marc. Campagne ONE-SHOT (tag
 * `FUSION_EXEC_TAG` ; bumper pour re-évaluer sous les règles courantes).
 *
 * LA SEULE MUTATION Drive de ce module est `moveTo` (déplacement, jamais de suppression) —
 * verrou de surface : aucune corbeille, aucun renommage, aucune création de dossier/fichier, aucun
 * raccourci, aucun appel REST (le déplacement seul).
 * Garde-fous (hérités de ConsolidationExec + §2.1b) :
 *  - §1 : hors 04, un fichier sous zone protégée (multi-parents vers 04) n'est JAMAIS détaché
 *    (`aParentProtege_` échec-fermé). 04 · Immigration en INTERNE PERMIS (§2.1b) : la CIBLE et la
 *    SOURCE d'un groupe 04 sont re-vérifiées STRUCTURELLEMENT sous 04 (`segmentsSousDomaine_`,
 *    échec-fermé) — source ET cible sous le même domaine ⇒ déplacement interne par construction ;
 *  - CIBLE re-validée à CHAQUE run (corbeillée/hors domaine/illisible ⇒ groupe ignoré, tracé) ;
 *  - MULTI-PARENTS jamais déplacé ; SOUS-DOSSIERS jamais déplacés (seuls les fichiers directs) ;
 *  - dossier source VIDÉ → `vide-candidat` (corbeille réservée à l'app, ADR-0014 — jamais 04, protégé) ;
 *  - entités re-pointées (`repointerEntites_(sourceId→cibleId)`, contrat C21-06) au drainage ;
 *  - idempotence par ID (onglet RÉGÉNÉRÉ par le dry-run → pas de curseur de ligne) :
 *    `fusionexec|<tag>|<fileId>` (fichier) + `fusrow|<tag>|<sourceId>` (source drainée) ;
 *  - bornes : budget/run + quotidien (ms réelles) + plafonds sources/run et fichiers/source ;
 *    COLLECTE des IDs puis DÉPLACEMENT (jamais muter pendant l'itération). Étape SECONDAIRE
 *    (BUDGET TAIL, pure I/O) enveloppée, APRÈS la consolidation, gatée `!resetEnCours_()`.
 */

/* ---------- Fonctions PURES (testées) ---------- */

/** Vrai si une ligne SOURCE s'applique : Action STRICTEMENT « Fusionner ». PUR.
 *  (« Ignorer », « Ignorer (structurel) », « À VALIDER », '' ⇒ jamais.) */
function ligneFusionAAppliquer_(action) {
  return action === 'Fusionner';
}

/** Consommation du budget QUOTIDIEN d'exécution (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourFusionExec_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_FUSION_EXEC_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * Depuis les lignes du `PlanFusion` (valeurs, en-têtes INCLUSES en [0]), calcule les fusions à exécuter.
 * Pour chaque GROUPE, la CIBLE (ligne Rôle=CIBLE) ; pour chaque SOURCE dont l'Action est STRICTEMENT
 * `Fusionner`, un couple {sourceId, sourceNom, cibleId, domaine, groupe}. Ignore : lignes sans ID de
 * dossier, groupe sans CIBLE, source == cible. PUR (aucune I/O) — cœur testable de la décision.
 * Colonnes (COLONNES_PLAN_FUSION) : 1=Domaine 2=Groupe 3=Rôle 4=Dossier 6=ID dossier 7=Action.
 * @param {Array[]} lignes
 * @return {{sourceId:string, sourceNom:string, cibleId:string, domaine:string, groupe:string}[]}
 */
function fusionsAExecuter_(lignes) {
  var cibleParGroupe = {};
  for (var i = 1; i < lignes.length; i++) {
    if (String(lignes[i][3]) !== 'CIBLE') continue;
    // Un plan bien formé n'a qu'UNE CIBLE par groupe (`cibleFusion_`). Sur un plan édité à la main avec
    // deux CIBLE, la DERNIÈRE gagne — sans conséquence : la cible reste re-validée par `cibleFusionValide_`.
    var g = String(lignes[i][2] || ''), id = String(lignes[i][6] || '');
    if (g && id) cibleParGroupe[g] = { id: id, domaine: String(lignes[i][1] || '') };
  }
  var out = [];
  for (var j = 1; j < lignes.length; j++) {
    if (String(lignes[j][3]) !== 'source') continue;
    if (!ligneFusionAAppliquer_(String(lignes[j][7] || ''))) continue;
    var grp = String(lignes[j][2] || ''), srcId = String(lignes[j][6] || '');
    var cible = cibleParGroupe[grp];
    if (!cible || !srcId || srcId === cible.id) continue;
    out.push({
      sourceId: srcId, sourceNom: String(lignes[j][4] || ''), cibleId: cible.id,
      domaine: cible.domaine || String(lignes[j][1] || ''), groupe: grp,
    });
  }
  return out;
}

/* ---------- I/O ---------- */

/** ID du domaine (fixe, ou AUTO lu en Property SANS le créer). null si inconnu. LECTURE SEULE. */
function idDomaineFusion_(domaine) {
  if (CONFIG.DOMAINES[domaine]) return CONFIG.DOMAINES[domaine];
  if ((CONFIG.DOMAINES_AUTO || []).indexOf(domaine) !== -1) {
    return PropertiesService.getScriptProperties().getProperty('DriveAI_DOM_' + domaine) || null;
  }
  return null;
}

/**
 * Résout et VALIDE la CIBLE : le dossier `cibleId` doit exister, non corbeillé, et être STRUCTURELLEMENT
 * sous le domaine du groupe (`segmentsSousDomaine_`, échec-fermé). Pour `04 · Immigration`, c'est la
 * garde §2.1b (interne uniquement, jamais de sortie). @return {?Folder} null = groupe refusé.
 */
function cibleFusionValide_(cibleId, domaine) {
  var domId = idDomaineFusion_(domaine);
  if (!domId) return null;
  var cible;
  try { cible = DriveApp.getFolderById(cibleId); } catch (e) { return null; }
  try { if (cible.isTrashed()) return null; } catch (e) { return null; }
  return segmentsSousDomaine_(cible, domId) ? cible : null;
}

/**
 * Déplace UN fichier vers la cible. Retourne 'fait' (déplacé/no-op déjà en place) ou 'saute' (laissé en
 * place : déjà fondu / sous-dossier / §1 / multi-parents / illisible). La clé `fusionexec|` n'est posée
 * QU'APRÈS le move (ordre des écritures d'état). Un `moveTo` en échec (throw) est capturé par l'appelant
 * `fondreSourceFichiers_` : le fichier reste en place, la source draine quand même (jamais un fichier
 * qui bloque toute la source à vie).
 * @param {File} f @param {Folder} cible @param {boolean} domaine04 @param {{proteges:Object,tag:string}} ctx
 * @return {string}
 */
function deplacerFichierFusion_(f, cible, domaine04, ctx) {
  var fileId, nom, mime;
  try { fileId = f.getId(); nom = f.getName(); mime = f.getMimeType(); } catch (e) { return 'saute'; }
  var cle = 'fusionexec|' + ctx.tag + '|' + fileId;
  if (indexContient_(cle)) return 'saute'; // déjà fondu (rejeu)
  // Un SOUS-DOSSIER n'est jamais déplacé : on ne fond que les FICHIERS directs (pas d'arbre).
  if (mime === 'application/vnd.google-apps.folder') return 'saute';
  // §1 : hors 04, un fichier sous zone protégée n'est JAMAIS détaché (échec-fermé). En 04, l'interne
  // est PERMIS (cible déjà validée sous 04) → on NE bloque PAS sur l'appartenance à 04.
  if (!domaine04 && aParentProtege_(f, ctx.proteges, true)) {
    journalInfo_('FusionExec', 'Abstention §1 (zone protégée/illisible) : ' + nom);
    return 'saute';
  }
  // MULTI-PARENTS : moveTo retirerait TOUS les parents (détachement interdit) — laissé en place.
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('FusionExec', 'Multi-parents, jamais déplacé : ' + nom);
    return 'saute';
  }
  var cibleId = cible.getId(), deja = false;
  try {
    var ps = f.getParents();
    while (ps.hasNext()) { if (ps.next().getId() === cibleId) { deja = true; break; } }
  } catch (e) { /* illisible → on tente le move (idempotent vers le même parent) */ }
  if (!deja) f.moveTo(cible); // LA seule mutation du module — déplacement, jamais suppression
  indexAjouter_(cle, { statut: 'fusionné', nom: nom, domaine: '', chemin: '' }, '');
  return 'fait';
}

/**
 * Fond les FICHIERS DIRECTS de `src` dans `cible` (déjà validées sous le domaine). COLLECTE les IDs
 * (borné) PUIS déplace — jamais muter pendant l'itération (patron `collecterInterne04Reset_`).
 * @return {{draine:boolean, faits:number}} `draine` = tous les fichiers directs parcourus dans le
 * budget (⇒ la source peut être considérée comme traitée : re-pointage + coquille vide). Un
 * `saute` (fichier laissé en place) ne bloque PAS le drainage (il reste simplement dans la source,
 * qui ne sera donc pas vide).
 */
function fondreSourceFichiers_(src, cible, domaine04, ctx, garde) {
  var ids = [], it, coupe = false, capAtteint = false;
  try { it = src.getFiles(); } catch (e) { return { draine: false, faits: 0, bloquee: false }; }
  while (it.hasNext()) {
    if (garde()) { coupe = true; break; } // garde-temps À LA COLLECTE aussi (mur 6 min)
    if (ids.length >= CONFIG.FUSION_EXEC_MAX_FICHIERS_PAR_SOURCE) { capAtteint = true; break; } // plafond/source/run
    try { ids.push(it.next().getId()); } catch (e) { coupe = true; break; }
  }
  var faits = 0;
  for (var i = 0; i < ids.length; i++) {
    if (garde()) { coupe = true; break; }
    var f;
    try { f = DriveApp.getFileById(ids[i]); } catch (e) { continue; } // fichier disparu → ignoré
    // Un moveTo en échec (permission/transitoire) est capturé ICI : le fichier RESTE en place et la
    // source draine quand même — jamais un fichier qui bloque toute la source à vie (pas de compteur
    // d'essais : un déplacement raté n'est pas réessayé, il est laissé + journalisé).
    try { if (deplacerFichierFusion_(f, cible, domaine04, ctx) === 'fait') faits++; }
    catch (e) { journalErreur_('FusionExec', 'Déplacement échoué (laissé en place) : ' + e); }
  }
  // « drainé » = tous les fichiers directs VUS dans le budget (ni budget coupé, ni cap atteint).
  // « bloquée » = cap atteint, rien coupé, 0 déplacé ⇒ ≥ cap fichiers indéplaçables en tête : la source
  // ne drainera JAMAIS → l'appelant l'inscrit pour ne pas la re-scanner à vie (sinon FINI jamais posé).
  return { draine: !coupe && !capAtteint, faits: faits, bloquee: capAtteint && !coupe && faits === 0 };
}

/**
 * Applique UNE source (fichiers → cible) puis, si drainée, re-pointe les entités (C21-06) et détecte la
 * coquille vide. La SOURCE est re-vérifiée STRUCTURELLEMENT sous son domaine (échec-fermé) : source ET
 * cible sous le même domaine ⇒ le déplacement est INTERNE (garantie 04 §2.1b). @return {{draine,faits}}
 */
function appliquerUneSourceFusion_(s, cible, ctx, garde) {
  var rowCle = 'fusrow|' + ctx.tag + '|' + s.sourceId;
  // GARDE STRUCTURELLE À LA MUTATION (défense en profondeur, revue structure-keeper #47) : un bucket du
  // reset / segment structurel n'est JAMAIS une SOURCE (le reset le recrée PAR NOM → non convergent, et
  // corbeiller un dossier canonique est interdit). La curation PR1 le met déjà « Ignorer (structurel) »
  // PAR DÉFAUT, mais c'est un opt-OUT overridable : on REFUSE ici l'override, SAUF dé-duplication d'un
  // doublon de MÊME NOM (le reset find-or-create rend le canonique → pas de recréation). C'est la garde
  // que les voisins (conso/reset) appliquent à la MUTATION, héritée (leçon §7 « hériter les gardes »).
  if (estAncreStructurelleFusion_(s.domaine, s.sourceNom) && s.sourceNom !== cible.getName()) {
    journalErreur_('FusionExec', 'Source structurelle refusée (jamais vidée) : ' + s.sourceNom);
    indexAjouter_(rowCle, { statut: 'fusion-source-structurelle', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
    return { draine: true, faits: 0 };
  }
  var src;
  try { src = DriveApp.getFolderById(s.sourceId); }
  catch (e) {
    indexAjouter_(rowCle, { statut: 'fusion-source-absente', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
    return { draine: true, faits: 0 };
  }
  var domId = idDomaineFusion_(s.domaine);
  if (!domId || !segmentsSousDomaine_(src, domId)) {
    journalErreur_('FusionExec', 'Source hors de son domaine (' + s.sourceNom + ') — ignorée.');
    indexAjouter_(rowCle, { statut: 'fusion-source-hors-domaine', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
    return { draine: true, faits: 0 };
  }
  var r = fondreSourceFichiers_(src, cible, s.domaine === '04 · Immigration', ctx, garde);
  if (r.draine) {
    // Contrat C21-06 : les entités pointant le dossier vidé sont re-pointées vers la cible — MAIS
    // JAMAIS vers une ancre STRUCTURELLE (re-pointer une entité vers un bucket/fourre-tout violerait la
    // taxonomie « un regroupement n'est jamais une cible de routage »). Un bucket structurel ne porte
    // pas d'entité au référentiel : le repointage est simplement inutile là, et dangereux ailleurs.
    if (!estAncreStructurelleFusion_(s.domaine, cible.getName())) {
      try { repointerEntites_(s.sourceId, cible.getId()); }
      catch (e) { journalErreur_('FusionExec', 'Re-pointage entités différé : ' + e); }
    }
    // Coquille vide → CONSTAT `vide-candidat` (corbeille réservée à l'app, ADR-0014). `detecterDossierVide_`
    // exclut déjà zone protégée/structurel : un dossier 04 vidé n'est JAMAIS un candidat (reste en place).
    try { detecterDossierVide_(src, ctx); }
    catch (e) { journalErreur_('FusionExec', 'Détection coquille vide différée : ' + e); }
    indexAjouter_(rowCle, { statut: 'fusion-source-drainée', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
  } else if (r.bloquee) {
    journalErreur_('FusionExec', 'Source « ' + s.sourceNom + ' » BLOQUÉE (≥ ' + CONFIG.FUSION_EXEC_MAX_FICHIERS_PAR_SOURCE +
      ' fichiers indéplaçables) — non fusionnée, à traiter manuellement.');
    indexAjouter_(rowCle, { statut: 'fusion-source-bloquée', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
  }
  return { draine: r.draine || r.bloquee, faits: r.faits }; // « bloquée » compte comme terminée (ne pas re-scanner)
}

/**
 * ÉTAPE DE TICK : applique le plan de fusion curé. Gatée `FUSION_EXEC_ACTIF` + budgets (run +
 * quotidien en ms réelles) ; APRÈS la consolidation, `!resetEnCours_()`. Court-circuit TERMINAL
 * `DriveAI_FUSION_EXEC_FINI === tag` quand plus aucune source `Fusionner` n'est à faire (bump du tag
 * pour re-évaluer). SECONDAIRE → enveloppée par l'appelant (jamais bloquer l'intake).
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerPlanFusion_(estBudgetDepasse) {
  if (!CONFIG.FUSION_EXEC_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.FUSION_EXEC_TAG;
  if (props.getProperty('DriveAI_FUSION_EXEC_FINI') === tag) return; // terminal : 1 lecture de Property/tick
  if (estBudgetDepasse()) return;

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourFusionExec_(props, aujourdhui);
  if (consommeJour >= CONFIG.FUSION_EXEC_BUDGET_JOUR_MS) return; // repris demain

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.FUSION_EXEC_BUDGET_MS, CONFIG.FUSION_EXEC_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  try {
    var f = feuille_('PlanFusion');
    var dern = f.getLastRow();
    if (dern < 2) { props.setProperty('DriveAI_FUSION_EXEC_FINI', tag); return; } // plan vide
    var lignes = f.getRange(1, 1, dern, COLONNES_PLAN_FUSION.length).getValues();
    var aFaire = fusionsAExecuter_(lignes);
    if (!aFaire.length) { props.setProperty('DriveAI_FUSION_EXEC_FINI', tag); return; }

    var ctx = { proteges: ensembleDomainesProteges_(), tag: tag };
    var faitsTotal = 0, sources = 0, resteAFaire = false;
    for (var i = 0; i < aFaire.length; i++) {
      if (garde() || sources >= CONFIG.FUSION_EXEC_MAX_SOURCES_PAR_RUN) { resteAFaire = true; break; }
      var s = aFaire[i];
      var rowCle = 'fusrow|' + tag + '|' + s.sourceId;
      if (indexContient_(rowCle)) continue; // source déjà drainée (rejeu)
      var cible = cibleFusionValide_(s.cibleId, s.domaine);
      if (!cible) {
        journalErreur_('FusionExec', 'Cible invalide (corbeillée/hors domaine) pour ' + s.sourceNom + ' [groupe ' + s.groupe + '] — ignorée.');
        indexAjouter_(rowCle, { statut: 'fusion-cible-invalide', nom: s.sourceNom, domaine: s.domaine, chemin: '' }, '');
        continue;
      }
      sources++;
      var res;
      try { res = appliquerUneSourceFusion_(s, cible, ctx, garde); }
      catch (e) { journalErreur_('FusionExec', 'Source ' + s.sourceNom + ' différée : ' + e); resteAFaire = true; continue; }
      faitsTotal += res.faits;
      if (!res.draine) resteAFaire = true; // budget coupé au milieu — reprise au run suivant
    }

    if (!resteAFaire && !garde()) {
      props.setProperty('DriveAI_FUSION_EXEC_FINI', tag);
      journalInfo_('FusionExec', 'Exécution du plan de fusion TERMINÉE (tag « ' + tag + ' »).');
    }
    if (faitsTotal) journalInfo_('FusionExec', faitsTotal + ' fichier(s) fondus vers leur cible (déplacement seul, réversible).');
  } finally {
    props.setProperty('DriveAI_FUSION_EXEC_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}
