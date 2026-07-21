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
 *  - cible RECALCULÉE AU MOMENT DU MOVE (revue flotte 2026-07-21) : la colonne Cible du plan est
 *    un INSTANTANÉ périmable (référentiel/nom du moment de la génération — un plan pré-seed
 *    ciblait encore des dossiers de banque) ; la vérité est la règle unique
 *    (`cheminCibleConsolidation_`) appliquée au domaine ACTUEL du fichier, à son nom ACTUEL et
 *    aux entités VALIDÉES d'aujourd'hui ; un ID de DOSSIER est refusé ; les seuls dossiers créés
 *    (find-or-create) sont ceux de la règle unique : « ajout de dossiers utile seulement » ;
 *  - avancement par CURSEUR de ligne (`DriveAI_CONSO_EXEC_LIGNE`) : l'onglet est APPEND-ONLY
 *    (écrit par le générateur) → le curseur est stable, pas de file mouvante ; rejeu sûr par la
 *    clé `consoexec|<tag>|<fileId>` + le no-op « déjà dans la cible » ;
 *  - bornes : budget/run + budget QUOTIDIEN en ms réelles persistées (patron consolidation) +
 *    plafond de lignes/run ; étape SECONDAIRE enveloppée en fin de tick (jamais bloquer l'intake).
 */

/* ---------- Fonctions PURES (testées) ---------- */

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
/**
 * DOMAINE ACTUEL d'un fichier : remonte la chaîne (premier parent) jusqu'à un dossier dont l'ID
 * est un domaine connu. null si hors domaines (fichier déplacé ailleurs depuis le plan). Le
 * multi-parents est exclu EN AMONT (nbParentsBorne_) — la chaîne du premier parent suffit.
 * @param {File} f
 * @param {Object} parId  {folderId: nomDomaine}
 * @return {?string}
 */
function domaineActuelFichier_(f, parId) {
  try {
    var courant = f;
    for (var i = 0; i < 10; i++) {
      var ps = courant.getParents();
      if (!ps.hasNext()) return null;
      var p = ps.next();
      if (parId[p.getId()]) return parId[p.getId()];
      courant = p;
    }
  } catch (e) { return null; }
  return null;
}

function appliquerLigneConsolidation_(ligne, ctx) {
  var cle = 'consoexec|' + ctx.tag + '|' + ligne.fileId;
  if (indexContient_(cle)) return 'saute'; // déjà appliquée (rejeu après reset de curseur)

  var f, nom, mime;
  try {
    f = DriveApp.getFileById(ligne.fileId);
    nom = f.getName();
    mime = f.getMimeType();
  } catch (e) {
    // Fichier disparu/inaccessible depuis la génération du plan : tracé, jamais bloquant.
    indexAjouter_(cle, { statut: 'consolidé-absent', nom: ligne.nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }
  // Un ID de DOSSIER (ligne forgée/corrompue — le générateur n'émet que des fichiers) n'est JAMAIS
  // déplacé : déplacer un dossier entier (pire cas : une racine) n'est pas le mandat de ce module.
  if (mime === 'application/vnd.google-apps.folder') {
    journalErreur_('ConsolidationExec', 'Ligne refusée : l\'ID est un DOSSIER (' + nom + ')');
    indexAjouter_(cle, { statut: 'consolidé-refus', nom: nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }

  // §1 RE-VÉRIFIÉE au moment de la mutation, STRICTE (échec-fermé) — le plan a pu vieillir.
  if (aParentProtege_(f, ctx.proteges, true)) {
    journalInfo_('ConsolidationExec', 'Abstention §1 (zone protégée/illisible) : ' + nom);
    indexAjouter_(cle, { statut: 'consolidé-protégé', nom: nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }
  // MULTI-PARENTS : moveTo retirerait TOUS les parents (détachement interdit) — laissé en place.
  if (nbParentsBorne_(f) > 1) {
    journalInfo_('ConsolidationExec', 'Multi-parents, jamais déplacé : ' + nom);
    indexAjouter_(cle, { statut: 'consolidé-multiparents', nom: nom, domaine: '', chemin: '' }, '');
    return 'saute';
  }

  // CIBLE RECALCULÉE AU MOMENT DU MOVE (revue flotte 2026-07-21 — bloquant) : la colonne Cible du
  // plan est un INSTANTANÉ (référentiel/nom du moment de la génération — un plan pré-seed ciblait
  // encore des dossiers de banque). La vérité est TOUJOURS la règle unique appliquée à l'état
  // COURANT : domaine actuel du fichier + nom actuel + entités VALIDÉES d'aujourd'hui. La colonne
  // Cible ne sert plus que de trace lisible. Un Doublon (décision par CONTENU) reste appliqué tel quel.
  var c;
  if (String(ligne.action) === 'Doublon') {
    c = { doublons: true, domaine: null, segments: [] };
  } else {
    var domaine = domaineActuelFichier_(f, ctx.parId);
    if (!domaine) {
      // Hors domaines (déjà déplacé ailleurs par Marc/le flux) : plus notre affaire.
      indexAjouter_(cle, { statut: 'consolidé-hors-domaine', nom: nom, domaine: '', chemin: '' }, '');
      return 'saute';
    }
    var sousCible = cheminCibleConsolidation_(domaine, nom, ctx.validees);
    // Segments assainis comme le flux vivant (champ_ : caractères interdits → '-') — la règle
    // unique doit produire le MÊME nom de dossier des deux côtés (anti-divergence).
    var segments = sousCible ? sousCible.split('/').map(function (s) { return champ_(s); }).filter(Boolean) : [];
    c = { doublons: false, domaine: domaine, segments: segments };
  }

  var cibleDossier = dossierCiblePlan_(c);
  // Déjà dans la cible (rejeu, ou classé entre-temps par le flux vivant) → no-op propre.
  var dejaEnPlace = false;
  try {
    var parents = f.getParents();
    while (parents.hasNext()) { if (parents.next().getId() === cibleDossier.getId()) { dejaEnPlace = true; break; } }
  } catch (e) { /* illisible → on tente le déplacement (moveTo est idempotent vers le même parent) */ }

  if (!dejaEnPlace) f.moveTo(cibleDossier); // LA seule mutation du module — déplacement, jamais suppression
  var cheminFinal = c.doublons ? '_Doublons' : c.domaine + (c.segments.length ? '/' + c.segments.join('/') : '');
  indexAjouter_(cle, {
    statut: c.doublons ? 'consolidé-doublon' : 'consolidé',
    nom: nom, domaine: c.domaine || '', chemin: cheminFinal,
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
  var tag = CONFIG.CONSOLIDATION_TAG;
  // Court-circuit TERMINAL (revue quotas) : campagne finie ET plan consommé → 1 lecture de
  // Property par tick, plus aucune I/O Sheet ni écriture de budget à vie.
  if (props.getProperty('DriveAI_CONSO_EXEC_FINI') === tag) return;
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
    if (dern <= curseur) {
      // Plan entièrement consommé : si la GÉNÉRATION est finie pour ce tag, l'exécution l'est aussi.
      if (props.getProperty('DriveAI_CONSOLIDATION') === tag) {
        props.setProperty('DriveAI_CONSO_EXEC_FINI', tag);
        journalInfo_('ConsolidationExec', 'Exécution du plan TERMINÉE (tag « ' + tag + ' »).');
      }
      return;
    }

    var ctx = {
      proteges: ensembleDomainesProteges_(),
      tag: tag,
      validees: entitesValideesParCle_(), // référentiel COURANT — la cible est recalculée au move
      parId: (function () {               // {folderId: nomDomaine} pour retrouver le domaine actuel
        var m = {};
        Object.keys(CONFIG.DOMAINES).forEach(function (nom) { m[CONFIG.DOMAINES[nom]] = nom; });
        (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
          var id = props.getProperty('DriveAI_DOM_' + nom);
          if (id) m[id] = nom;
        });
        return m;
      })(),
    };

    var nb = Math.min(dern - curseur, CONFIG.CONSOLIDATION_EXEC_MAX_PAR_RUN);
    var lignes = f.getRange(curseur + 1, 1, nb, COLONNES_PLAN_CONSOLIDATION.length).getValues();

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
        // Échec TRANSITOIRE (moveTo/Drive). Compté AU PLUS 1×/JOUR (revue quotas : des essais
        // comptés par rejeu brûleraient les 3 strikes en 15 min de ticks — leçon « comptés par
        // PASSE ») : l'abandon exige 3 JOURS distincts d'échec (vraie panne durable du fichier),
        // un blip de plateforme ne coûte rien. Clé PAR TAG (une campagne future repart à neuf).
        var essais = 0;
        if (props.getProperty('DriveAI_CONSO_EXEC_EJ') !== aujourdhui) {
          try {
            essais = incrementerEchec_('consoexec|essai|' + tag + '|' + ligne.fileId);
            props.setProperty('DriveAI_CONSO_EXEC_EJ', aujourdhui);
          } catch (e2) { }
        }
        if (essais >= CONFIG.QUARANTAINE_MAX) {
          journalErreur_('ConsolidationExec', 'Ligne ABANDONNÉE après ' + essais + ' jours d\'échec (' + ligne.nom + ') : ' + e);
          try { indexAjouter_('consoexec|' + tag + '|' + ligne.fileId, { statut: 'consolidé-échec', nom: ligne.nom, domaine: '', chemin: '' }, ''); } catch (e3) { }
          derniereTraitee = curseur + i + 1;
        } else {
          journalErreur_('ConsolidationExec', 'Échec (' + ligne.nom + ') — re-tenté : ' + e);
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
