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
 *  - CAMPAGNE : rien n'est appliqué tant que le plan de l'onglet n'a pas été (re)posé sous le TAG
 *    COURANT (`DriveAI_CONSO_PLAN_TAG`, écrit par le GÉNÉRATEUR). Conséquence à connaître : si le
 *    générateur est éteint (`CONSOLIDATION_ACTIF: false`) ou sur une installation neuve, l'exécuteur
 *    est inerte — par construction, et sans bruit dans le Journal ;
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
 *
 * ADR-0028 : si la ligne porte `dossierIdCible` (dossier d'entité du référentiel), on OUVRE ce
 * dossier — à sa profondeur réelle — au lieu de le find-or-create à plat. MÊME garde que le flux
 * vivant (`segmentsSousDomaine_`) : l'ID doit s'ouvrir ET rester sous ce domaine, sinon repli par
 * NOM. Sans cette symétrie, la décision dirait « OK » pendant que l'exécution recréerait le
 * dossier à plat — l'un déferait l'autre (la divergence même que l'ADR corrige).
 * @param {{doublons:boolean, domaine:?string, segments:string[], dossierIdCible:?string}} c
 * @return {Folder}
 */
function dossierCiblePlan_(c) {
  if (c.doublons) return dossierDoublons_();
  var domaine = DriveApp.getFolderById(idDomaine_(c.domaine));
  var parId = dossierEntiteParId_(c.dossierIdCible, domaine); // MÊME résolveur que le flux vivant
  if (parId) return parId.dossier;
  var dossier = domaine;
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
 * POSITION ACTUELLE d'un fichier : remonte la chaîne (premier parent) jusqu'à un dossier dont l'ID
 * est un domaine connu, et rend le DOMAINE **avec le sous-chemin traversé**. null si hors domaines
 * (fichier déplacé ailleurs depuis le plan). Le multi-parents est exclu EN AMONT
 * (`nbParentsBorne_`) — la chaîne du premier parent suffit.
 *
 * ⚠️ Le sous-chemin n'est pas un confort d'affichage : c'est l'entrée que `decisionConsolidation_`
 * lit pour D8 (« un signal faible ne déplace pas ce qui est déjà rangé ») et D9 (« on ne remonte
 * jamais un fichier vers un de ses ancêtres »). Sans lui, l'exécuteur recalculait la CIBLE à
 * l'état courant mais jugeait la POSITION sur l'instantané du plan — les deux gardes ne
 * s'appliquaient donc qu'au dry-run (revue sécurité C28-90, 🔴 : « un invariant JAMAIS X affiché
 * au plan se RÉ-APPLIQUE à la mutation, avec le MÊME prédicat », leçon §9 #47 PR2).
 * @param {File} f
 * @param {Object} parId  {folderId: nomDomaine}
 * @return {?{domaine:string, sousChemin:string, parentId:string}} sousChemin relatif au domaine
 *   ('' = à la racine du domaine), parentId = parent DIRECT (pour la règle d'ID, ADR-0028)
 */
function positionActuelleFichier_(f, parId) {
  try {
    var segments = [];
    var parentId = '';
    var courant = f;
    for (var i = 0; i < 20; i++) { // 20 et non 10 : au-delà, la position est INCONNUE et la ligne
      var ps = courant.getParents();  // serait classée « hors domaine » à tort (revue sécurité C28-90)
      if (!ps.hasNext()) return null;
      var p = ps.next();
      if (!parentId) parentId = p.getId();
      if (parId[p.getId()]) return { domaine: parId[p.getId()], sousChemin: segments.join('/'), parentId: parentId };
      segments.unshift(p.getName()); // remontée ⇒ on empile à l'ENVERS
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
    var pos = positionActuelleFichier_(f, ctx.parId);
    if (!pos) {
      // Hors domaines (déjà déplacé ailleurs par Marc/le flux) : plus notre affaire.
      indexAjouter_(cle, { statut: 'consolidé-hors-domaine', nom: nom, domaine: '', chemin: '' }, '');
      return 'saute';
    }
    var domaine = pos.domaine;
    var sousCible = cheminCibleConsolidation_(domaine, nom, ctx.validees); // {nom, id, faible} (ADR-0028)
    // LA MÊME DÉCISION QU'AU PLAN, REJOUÉE SUR L'ÉTAT COURANT (revue sécurité C28-90, 🔴 2).
    // `decisionConsolidation_` est la fonction que le dry-run affiche à Marc : la rappeler ICI —
    // la MÊME, jamais une seconde formule — est ce qui fait des gardes D8/D9 des gardes et non un
    // affichage. Le fichier a pu être rangé plus finement PAR AILLEURS entre la génération du plan
    // et son exécution (les missions et le flux tournent dans le même tick, APRÈS l'exécuteur).
    // `protege` : DÉJÀ re-vérifié plus haut, échec-fermé (ligne `aParentProtege_`) — on ne le rejoue
    // pas ici. `raccourci` : le générateur met les raccourcis en `Ignoré`, donc AUCUNE ligne
    // applicable n'en porte ; l'exécuteur ne le re-teste pas (constat, pas une garde — revue
    // sécurité C28-90 : le commentaire précédent affirmait à tort qu'il l'était). `doublonDe` ne
    // passe pas par ici (décision par CONTENU, branche `Doublon` ci-dessus).
    var decision = decisionConsolidation_({
      domaine: domaine, sousCheminActuel: pos.sousChemin, sousCheminCible: sousCible.nom,
      protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
      parentId: pos.parentId, dossierIdCible: sousCible.id || '', cibleFaible: sousCible.faible === true,
    });
    if (decision.action !== 'Déplacer') {
      // « Déjà rangé plus finement », « déjà au bon endroit », repli par type sur un fichier déjà
      // en sous-dossier : on n'écrit RIEN dans Drive. La clé est posée quand même — la ligne a été
      // traitée, et sans elle le plan la re-proposerait à chaque passe.
      indexAjouter_(cle, {
        statut: 'consolidé-sur-place', nom: nom, domaine: domaine,
        chemin: domaine + (pos.sousChemin ? '/' + pos.sousChemin : ''),
      }, '');
      return 'saute';
    }
    // Segments assainis par LA règle partagée avec le flux vivant (`segmentsChemin_`, Router.gs) —
    // elle était écrite deux fois, et les deux exemplaires ne produisaient pas le même chemin
    // (le flux assainissait le chemin ENTIER, donc `/` → `-`). Une seule fonction, deux consommateurs.
    var segments = segmentsChemin_(sousCible.nom);
    // `dossierIdCible` est consommé par `dossierCiblePlan_` : résolution par ID, confinée au domaine.
    c = { doublons: false, domaine: domaine, segments: segments, dossierIdCible: sousCible.id || '' };
  }

  var cibleDossier = dossierCiblePlan_(c);
  // Déjà dans la cible (rejeu, ou classé entre-temps par le flux vivant) → no-op propre. On capte
  // au passage le parent UNIQUE (les multi-parents ont déjà été écartés) — celui qui va être quitté.
  var dejaEnPlace = false;
  var ancienParent = null;
  try {
    var parents = f.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (!ancienParent) ancienParent = p;
      if (p.getId() === cibleDossier.getId()) { dejaEnPlace = true; break; }
    }
  } catch (e) { /* illisible → on tente le déplacement (moveTo est idempotent vers le même parent) */ }

  if (!dejaEnPlace) f.moveTo(cibleDossier); // LA seule mutation du module — déplacement, jamais suppression
  var cheminFinal = c.doublons ? '_Doublons' : c.domaine + (c.segments.length ? '/' + c.segments.join('/') : '');
  indexAjouter_(cle, {
    statut: c.doublons ? 'consolidé-doublon' : 'consolidé',
    nom: nom, domaine: c.domaine || '', chemin: cheminFinal,
  }, '');
  // Le dossier QUITTÉ est-il devenu une coquille vide ? (ADR-0025, axe 1) — CONSTAT seul dans Réorg,
  // JAMAIS une suppression (la corbeille reste à l'app, au clic). ENVELOPPÉ : un échec ici ne remet
  // JAMAIS en cause le déplacement déjà acquis ni le marquage Index.
  if (!dejaEnPlace && ancienParent && ancienParent.getId() !== cibleDossier.getId()) {
    try { detecterDossierVide_(ancienParent, ctx); }
    catch (e) { journalErreur_('ConsolidationExec', 'Détection coquille vide différée : ' + e); }
  }
  return 'fait';
}

/**
 * DÉTECTION AUTO d'une coquille vide (ADR-0025, axe 1) : après un déplacement, le dossier QUITTÉ
 * est-il devenu STRICTEMENT vide (aucun fichier, aucun sous-dossier non corbeillés) et non
 * structurel ? Si oui, inscrit un CONSTAT `vide-candidat` dans l'onglet Réorg — JAMAIS une
 * suppression (la corbeille reste à l'APP, au clic de Marc, ADR-0014, avec re-vérif live corbeillés
 * inclus). Exclusions (jamais un candidat) : zone protégée, racines système/domaine/catégorie
 * (`ensembleIntouchables_`), noms `_…`, segments structurels (année AAAA, schéma d'entité).
 */
function detecterDossierVide_(parent, ctx) {
  var id = parent.getId();
  if (!ctx.intouchables) ctx.intouchables = ensembleIntouchables_();
  if (ctx.intouchables[id]) return;                          // domaine / catégorie à ID fixe / file système
  var nom = parent.getName();
  if (nom.charAt(0) === '_' || estSegmentStructurel_(nom)) return; // racine système / année AAAA / schéma
  // Vacuité STRICTE (non corbeillés) d'ABORD (cas DOMINANT : le parent reste NON vide → sortie tôt,
  // coût minimal — revue quotas) : le moindre fichier OU sous-dossier ⇒ pas un candidat.
  if (parent.getFiles().hasNext() || parent.getFolders().hasNext()) return;
  // RARE (parent devenu vide) : garde §1 par REMONTÉE de TOUTE la chaîne d'ancêtres (leçon « remonter
  // toute la chaîne d'ancêtres », durcissement revue sécurité) — self OU ascendance protégée / illisible
  // ⇒ jamais un candidat (échec-fermé). Placée APRÈS la vacuité : la remontée ne se paie que sur un vide.
  if (chaineMonteVersProtege_(parent, ctx.proteges || {}, 0, true)) return;
  inscrireDossierVideCandidat_(id, nom, ctx);
}

/**
 * Inscrit (DÉDUPLIQUÉ) une ligne `vide-candidat` dans l'onglet Réorg — MÊME format que la fusion
 * (Reorg.gs) : l'app la lit déjà (C21-07/ADR-0014). Le set des clés existantes est chargé UNE fois
 * par run (lazy, sur `ctx`) et tenu à jour, pour éviter une lecture de l'onglet par dossier vidé.
 * Colonnes : Clé | Type | ID | Chemin actuel | Chemin proposé | Statut | Détail | Horodaté.
 */
function inscrireDossierVideCandidat_(id, chemin, ctx) {
  var feuille = feuille_('Réorg');
  if (!ctx.videsConnus) {
    ctx.videsConnus = {};
    // Seule la colonne A (clés) est lue — ÷8 le payload vs getDataRange (8 colonnes), revue quotas.
    var dern = feuille.getLastRow();
    var cles = dern >= 1 ? feuille.getRange(1, 1, dern, 1).getValues() : [];
    for (var i = 0; i < cles.length; i++) {
      var k = String(cles[i][0]);
      if (k.indexOf('videcandidat|') === 0) ctx.videsConnus[k] = true;
    }
  }
  var cle = 'videcandidat|' + id;
  if (ctx.videsConnus[cle]) return; // déjà signalé (rejeu, ou fusion antérieure) — jamais un doublon
  feuille.appendRow([cle, 'dossier-vide', id, chemin, '', 'vide-candidat',
    'devenu vide par la consolidation', new Date().toISOString()]);
  ctx.videsConnus[cle] = true;
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
  // PLAN D'UNE AUTRE CAMPAGNE — on n'applique rien (revue sécurité C28-90, 🟠 6). L'exécuteur
  // tourne AVANT le générateur dans le tick (Main.gs), et c'est le GÉNÉRATEUR qui purge le plan
  // périmé au changement de tag : au premier tick d'un bump, l'onglet porte encore les lignes de
  // la campagne précédente. Pour les `Déplacer`, la cible est recalculée (atténué) ; pour les
  // `Doublon`, la décision par CONTENU serait appliquée telle quelle, sur une comparaison
  // d'empreintes vieille d'un mois. Un tick d'attente coûte 5 minutes ; une ligne périmée
  // appliquée sous la clé du nouveau tag ne se rejoue jamais.
  if (props.getProperty('DriveAI_CONSO_PLAN_TAG') !== tag) return;
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
