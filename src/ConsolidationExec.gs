/**
 * ConsolidationExec.gs — EXÉCUTION du plan de consolidation (C28-26, ADR-0024).
 *
 * Décision Marc 2026-07-17 (« je veux que ce soit toi qui le fasse, change tout live ») : le moteur
 * APPLIQUE lui-même les lignes du `PlanConsolidation` — `Déplacer` (fichier → sa place selon la
 * règle unique à plat) et `Doublon` (→ `_Doublons`). Aucune validation manuelle ligne à ligne ;
 * Marc peut SUSPENDRE à tout instant (`CONSOLIDATION_EXEC_ACTIF: false`).
 *
 * LA SEULE MUTATION de ce module est `moveTo` (déplacement — réversible, jamais une suppression) ;
 * verrouillé par test de surface : aucune mise à la corbeille, aucun renommage, aucune copie,
 * aucun appel REST — le déplacement seul. Garde-fous :
 *  - §1 zone protégée RE-VÉRIFIÉE STRICTEMENT au moment de CHAQUE mutation (`aParentProtege_`
 *    échec-fermé — le plan a pu vieillir depuis sa génération) ; abstention journalisée ;
 *  - MULTI-PARENTS : un fichier à plusieurs parents n'est JAMAIS déplacé (`moveTo` retirerait TOUS
 *    ses parents — détachement interdit, patron Reorg) ; laissé en place, tracé ;
 *  - cible parsée et VALIDÉE (`decouperCiblePlan_`, PURE) : domaine connu OU `_Doublons`, ≤ 2
 *    segments, jamais un chemin arbitraire — les seuls dossiers créés (find-or-create) sont ceux
 *    de la règle unique (année/entité validée/type d'identité) : « ajout de dossiers utile
 *    seulement » ;
 *  - avancement par CURSEUR de ligne (`DriveAI_CONSO_EXEC_LIGNE`) : l'onglet est APPEND-ONLY
 *    (écrit par le générateur) → le curseur est stable, pas de file mouvante ; rejeu sûr par la
 *    clé `consoexec|<tag>|<fileId>` + le no-op « déjà dans la cible » ;
 *  - bornes : budget/run + budget QUOTIDIEN en ms réelles persistées (patron consolidation) +
 *    plafond de lignes/run ; étape SECONDAIRE enveloppée en fin de tick (jamais bloquer l'intake).
 */

/* ---------- Fonctions PURES (testées) ---------- */

/**
 * Décompose et VALIDE la colonne Cible d'une ligne du plan. PUR.
 * @param {string} cible  ex. '02 · Finances/2026', '05 · Carrière', '_Doublons',
 *                        '03 · Logement & véhicule/3325 4e Avenue'
 * @param {string[]} domainesConnus  noms de domaines autorisés (fixes + auto)
 * @return {?{doublons:boolean, domaine:?string, segments:string[]}} null si cible invalide
 */
function decouperCiblePlan_(cible, domainesConnus) {
  var s = String(cible == null ? '' : cible).trim();
  if (!s) return null;
  if (s === '_Doublons') return { doublons: true, domaine: null, segments: [] };
  var parts = s.split('/');
  var domaine = parts[0];
  if ((domainesConnus || []).indexOf(domaine) === -1) return null; // jamais un chemin arbitraire
  var segments = parts.slice(1);
  if (segments.length > 2) return null; // la règle unique produit au plus [annee] ou [entité] (1 seg)
  for (var i = 0; i < segments.length; i++) {
    var seg = String(segments[i]).trim();
    if (!seg || seg === '..' || seg.charAt(0) === '_' || seg.indexOf('·') !== -1) return null;
    segments[i] = seg;
  }
  return { doublons: false, domaine: domaine, segments: segments };
}

/** Vrai si une ligne du plan est à APPLIQUER (Déplacer/Doublon) — OK/Ignoré ne se touchent jamais. PUR. */
function ligneAAppliquer_(action) {
  return action === 'Déplacer' || action === 'Doublon';
}

/** Consommation du budget QUOTIDIEN d'exécution (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourConsoExec_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_CONSO_EXEC_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/* ---------- I/O ---------- */

/** Nombre de parents d'un fichier (borné à 2 — on ne cherche que « plus d'un »). Erreur → 2 (prudence). */
function nbParentsBorne_(f) {
  try {
    var it = f.getParents();
    var n = 0;
    while (it.hasNext() && n < 2) { it.next(); n++; }
    return n;
  } catch (e) {
    return 2; // illisible → traité comme multi-parents (abstention)
  }
}

/**
 * Résout (find-or-create) le DOSSIER cible d'une ligne validée. Les seuls dossiers créés sont les
 * segments de la règle unique (année / entité validée / type d'identité) sous un domaine CONNU.
 * @param {{doublons:boolean, domaine:?string, segments:string[]}} c
 * @return {Folder}
 */
function dossierCiblePlan_(c) {
  if (c.doublons) return dossierDoublons_();
  var dossier = DriveApp.getFolderById(idDomaine_(c.domaine));
  for (var i = 0; i < c.segments.length; i++) dossier = sousDossier_(dossier, c.segments[i]);
  return dossier;
}

/**
 * Applique UNE ligne du plan. Retourne toujours (jamais de throw non capturé par l'appelant) :
 * 'fait' | 'saute' (avec Journal de la raison quand elle est notable). La clé `consoexec|` n'est
 * posée QU'APRÈS le déplacement (ordre des écritures d'état).
 * @param {{fileId:string, nom:string, action:string, cible:string}} ligne
 * @param {{proteges:Object, domainesConnus:string[], tag:string}} ctx
 * @return {string}
 */
function appliquerLigneConsolidation_(ligne, ctx) {
  var cle = 'consoexec|' + ctx.tag + '|' + ligne.fileId;
  if (indexContient_(cle)) return 'saute'; // déjà appliquée (rejeu après reset de curseur)

  var c = decouperCiblePlan_(ligne.cible, ctx.domainesConnus);
  if (!c) {
    journalErreur_('ConsolidationExec', 'Cible invalide, ligne sautée (' + ligne.nom + ' → « ' + ligne.cible + ' »)');
    indexAjouter_(cle, { statut: 'consolidé-refus', nom: ligne.nom, domaine: '', chemin: String(ligne.cible || '') }, '');
    return 'saute';
  }

  var f;
  try { f = DriveApp.getFileById(ligne.fileId); }
  catch (e) {
    // Fichier disparu/inaccessible depuis la génération du plan : tracé, jamais bloquant.
    indexAjouter_(cle, { statut: 'consolidé-absent', nom: ligne.nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }

  // §1 RE-VÉRIFIÉE au moment de la mutation, STRICTE (échec-fermé) — le plan a pu vieillir.
  if (aParentProtege_(f, ctx.proteges, true)) {
    journalInfo_('ConsolidationExec', 'Abstention §1 (zone protégée/illisible) : ' + ligne.nom);
    indexAjouter_(cle, { statut: 'consolidé-protégé', nom: ligne.nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }
  // MULTI-PARENTS : moveTo retirerait TOUS les parents (détachement interdit) — laissé en place.
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('ConsolidationExec', 'Multi-parents, jamais déplacé : ' + ligne.nom);
    indexAjouter_(cle, { statut: 'consolidé-multiparents', nom: ligne.nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }

  var cibleDossier = dossierCiblePlan_(c);
  // Déjà dans la cible (rejeu, ou classé entre-temps par le flux vivant) → no-op propre.
  var dejaEnPlace = false;
  try {
    var parents = f.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === cibleDossier.getId()) { dejaEnPlace = true; break; } }
  } catch (e) { /* illisible → on tente le déplacement (moveTo est idempotent vers le même parent) */ }

  if (!dejaEnPlace) f.moveTo(cibleDossier); // LA seule mutation du module — déplacement, jamais suppression
  indexAjouter_(cle, {
    statut: c.doublons ? 'consolidé-doublon' : 'consolidé',
    nom: ligne.nom, domaine: c.domaine || '', chemin: String(ligne.cible || ''),
  }, '');
  return 'fait';
}

/**
 * ÉTAPE DE TICK : consomme les lignes du PlanConsolidation depuis le curseur persisté (l'onglet
 * est append-only → curseur stable), applique Déplacer/Doublon, avance le curseur des lignes
 * ENTIÈREMENT traitées. Gatée flag + budgets (run + quotidien en ms réelles). Une ligne en échec
 * TRANSITOIRE (throw de moveTo) NE fait PAS avancer le curseur : re-tentée au run suivant, bornée
 * par le gestionnaire d'échecs (3 essais puis avance forcée, tracée).
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerPlanConsolidation_(estBudgetDepasse) {
  if (!CONFIG.CONSOLIDATION_EXEC_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  if (estBudgetDepasse()) return;

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourConsoExec_(props, aujourdhui);
  if (consommeJour >= CONFIG.CONSOLIDATION_EXEC_BUDGET_JOUR_MS) return; // repris demain

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.CONSOLIDATION_EXEC_BUDGET_MS, CONFIG.CONSOLIDATION_EXEC_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  try {
    var f = feuille_('PlanConsolidation');
    var dern = f.getLastRow();
    var curseur = Number(props.getProperty('DriveAI_CONSO_EXEC_LIGNE')) || 1; // 1 = ligne d'en-têtes
    if (dern <= curseur) return; // rien de neuf au plan

    var nb = Math.min(dern - curseur, CONFIG.CONSOLIDATION_EXEC_MAX_PAR_RUN);
    var lignes = f.getRange(curseur + 1, 1, nb, COLONNES_PLAN_CONSOLIDATION.length).getValues();

    var ctx = {
      proteges: ensembleDomainesProteges_(),
      domainesConnus: Object.keys(CONFIG.DOMAINES).concat(CONFIG.DOMAINES_AUTO || []),
      tag: CONFIG.CONSOLIDATION_TAG,
    };

    var faits = 0, derniereTraitee = curseur;
    for (var i = 0; i < lignes.length; i++) {
      if (garde()) break;
      var ligne = {
        nom: String(lignes[i][1] || ''), fileId: String(lignes[i][2] || ''),
        action: String(lignes[i][3] || ''), cible: String(lignes[i][4] || ''),
      };
      if (!ligne.fileId || !ligneAAppliquer_(ligne.action)) { derniereTraitee = curseur + i + 1; continue; }
      try {
        if (appliquerLigneConsolidation_(ligne, ctx) === 'fait') faits++;
        derniereTraitee = curseur + i + 1;
      } catch (e) {
        // Échec TRANSITOIRE (moveTo/Drive) : compté ; après QUARANTAINE_MAX essais la ligne est
        // abandonnée (tracée + clé posée) pour ne jamais geler le curseur à vie sur un fichier malade.
        var essais = 0;
        try { essais = incrementerEchec_('consoexec|essai|' + ligne.fileId); } catch (e2) { }
        if (essais >= CONFIG.QUARANTAINE_MAX) {
          journalErreur_('ConsolidationExec', 'Ligne ABANDONNÉE après ' + essais + ' échecs (' + ligne.nom + ') : ' + e);
          try { indexAjouter_('consoexec|' + ctx.tag + '|' + ligne.fileId, { statut: 'consolidé-échec', nom: ligne.nom, domaine: '', chemin: '' }, ''); } catch (e3) { }
          derniereTraitee = curseur + i + 1;
        } else {
          journalErreur_('ConsolidationExec', 'Échec ' + essais + '/' + CONFIG.QUARANTAINE_MAX + ' (' + ligne.nom + ') — re-tenté : ' + e);
          break; // curseur figé sur cette ligne : re-tentée au prochain run
        }
      }
    }

    if (derniereTraitee > curseur) props.setProperty('DriveAI_CONSO_EXEC_LIGNE', String(derniereTraitee));
    if (faits) journalInfo_('ConsolidationExec', faits + ' fichier(s) consolidés (déplacement seul, réversible).');
  } finally {
    props.setProperty('DriveAI_CONSO_EXEC_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}
