/**
 * Diagnostic.gs — DIAGNOSTIC UN-CLIC, LECTURE SEULE (aucune mutation Drive/Sheet/Property).
 *
 * Raison d'être (leçon §7, incident deadlock 2026-08-05) : « la certitude runtime vient du
 * diagnostic un-clic (Properties + comptage via le code DÉPLOYÉ), jamais d'un échantillon Drive ».
 * Claude ne peut PAS exécuter le moteur ni lire les Script Properties ; l'app lit la Sheet côté
 * navigateur (ADR-0007). Sans ce point d'observation, tout « check » d'un backlog qui semble ne pas
 * se vider retombe sur l'index de recherche Drive — qui RETARDE — et se termine en incertain.
 * Cette fonction tranche l'INCERTAIN (« ça draine lentement » vs « c'est bloqué ») en CERTAIN.
 *
 * À exécuter depuis l'éditeur Apps Script : `Diagnostic.gs` → `etatCampagnesRangement` → Exécuter,
 * puis lire le journal d'exécution (le rapport est aussi renvoyé en chaîne).
 *
 * Ne touche à RIEN : ni budget (elle n'écrit aucune Property, donc n'affame aucun tick — leçon
 * « une exécution manuelle est HORS quota »), ni fichier, ni ligne de plan. Bornée en temps pour
 * les comptages Drive (un run manuel a ~6 min, on s'arrête bien avant).
 */

/** Formate des millisecondes en minutes lisibles (« 7.5 min »). PUR. */
function minutesLisibles_(ms) {
  return (Math.round((Number(ms) || 0) / 6000) / 10) + ' min';
}

/**
 * Rapport d'état des campagnes de rangement (reset, consolidation génération, consolidation
 * exécution) + comptage du « vrac » (fichiers posés À PLAT) à la racine de chaque domaine.
 * @return {string} le rapport (également écrit dans le journal d'exécution via Logger.log).
 */
function etatCampagnesRangement() {
  var props = PropertiesService.getScriptProperties();
  var aujourdhui = dateGmail_(new Date());
  var L = [];
  L.push('=== ÉTAT DES CAMPAGNES DE RANGEMENT — ' + new Date().toISOString() + ' ===');

  // ÉMISSION DÉFENSIVE (revue apps-script-quota 2026-08-06) : chaque section est isolée par un
  // try/catch et le rapport est TOUJOURS écrit dans le journal (`finally`), même partiel. L'outil
  // sert PRÉCISÉMENT quand la Sheet est en cache/indisponible — le signal le plus précieux ([1]
  // RESET, `resetEnCours_()=true ⇒ deadlock`) ne dépend QUE des Properties et doit survivre à un
  // blip de lecture Sheet dans une section AVAL (sinon un `throw` en [3] efface [1] et [2] déjà prêts).
  try {
    // ---- Liste des domaines (fixes + auto déjà nés), comme la génération de la consolidation ----
    var domaines = [];
    Object.keys(CONFIG.DOMAINES).forEach(function (nom) { domaines.push({ nom: nom, id: CONFIG.DOMAINES[nom] }); });
    (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
      var id = props.getProperty('DriveAI_DOM_' + nom);
      if (id) domaines.push({ nom: nom, id: id });
    });

    // ---- 1. RESET (ADR-0030) — ne dépend QUE des Properties (survit à une Sheet indisponible) ----
    L.push('');
    L.push('[1] RESET');
    try {
      L.push('  RESET_ACTIF       : ' + CONFIG.RESET_ACTIF);
      L.push('  resetTermine_()   : ' + resetTermine_());
      L.push('  resetEnCours_()   : ' + resetEnCours_() + '   (true ⇒ la consolidation est SUSPENDUE — deadlock potentiel)');
    } catch (e1) { L.push('  (section illisible : ' + e1 + ')'); }

    // ---- 2. CONSOLIDATION — GÉNÉRATION du plan (Consolidation.gs) ----
    var tag = CONFIG.CONSOLIDATION_TAG;
    L.push('');
    L.push('[2] CONSOLIDATION — génération du plan');
    try {
      var consoJour = budgetJourConsolidation_(props, aujourdhui);
      L.push('  CONSOLIDATION_ACTIF : ' + CONFIG.CONSOLIDATION_ACTIF);
      L.push('  tag courant         : ' + tag + '   (plan posé sous : ' + (props.getProperty('DriveAI_CONSO_PLAN_TAG') || '—') + ')');
      L.push('  génération finie ?  : ' + (props.getProperty('DriveAI_CONSOLIDATION') === tag));
      L.push('  budget jour         : ' + minutesLisibles_(consoJour) + ' / ' +
        minutesLisibles_(CONFIG.CONSOLIDATION_BUDGET_JOUR_MS) +
        (consoJour >= CONFIG.CONSOLIDATION_BUDGET_JOUR_MS ? '  (ÉPUISÉ aujourd\'hui — repris demain)' : ''));
      // Domaines marqués « épuisés » pour ce tag (sautés en O(1) par la génération).
      var epuises = [], restants = [];
      for (var i = 0; i < domaines.length; i++) {
        (indexContient_('conso|' + tag + '|dom|' + domaines[i].nom) ? epuises : restants).push(domaines[i].nom);
      }
      L.push('  domaines épuisés    : ' + epuises.length + ' / ' + domaines.length +
        (restants.length ? '   (RESTANTS à examiner : ' + restants.join(', ') + ')' : '   (TOUS examinés)'));
    } catch (e2) { L.push('  (section illisible : ' + e2 + ')'); }

    // ---- 3. CONSOLIDATION — EXÉCUTION du plan (ConsolidationExec.gs) ----
    L.push('');
    L.push('[3] CONSOLIDATION — exécution du plan (moveTo seul)');
    try {
      var curseur = Number(props.getProperty('DriveAI_CONSO_EXEC_LIGNE')) || 1;
      var execJour = budgetJourConsoExec_(props, aujourdhui);
      L.push('  CONSOLIDATION_EXEC_ACTIF : ' + CONFIG.CONSOLIDATION_EXEC_ACTIF);
      L.push('  exécution finie ?        : ' + (props.getProperty('DriveAI_CONSO_EXEC_FINI') === tag));
      L.push('  budget jour              : ' + minutesLisibles_(execJour) + ' / ' +
        minutesLisibles_(CONFIG.CONSOLIDATION_EXEC_BUDGET_JOUR_MS) +
        (execJour >= CONFIG.CONSOLIDATION_EXEC_BUDGET_JOUR_MS ? '  (ÉPUISÉ aujourd\'hui — repris demain)' : ''));
      // Décompte du plan par action + travail RESTANT (lignes après le curseur à Déplacer/Doublon).
      // `restantAAppliquer` est une BORNE HAUTE (une ligne Déplacer sautée au move — protégée /
      // multi-parents / hors-domaine — y est comptée) ; honnête pour un diagnostic.
      var stat = statPlanConsolidation_(curseur);
      L.push('  lignes du plan           : ' + stat.total + '   (Déplacer ' + stat.deplacer + ', Doublon ' +
        stat.doublon + ', OK ' + stat.ok + ', Ignoré ' + stat.ignore + ')');
      // UNITÉS ALIGNÉES (revue flotte 🟡A) : `curseur` est un n° de ligne PHYSIQUE (en-tête = 1) ;
      // lignes de DONNÉES consommées = curseur − 1, à comparer à `stat.total` (nombre de données).
      // Ainsi le numérateur ne dépasse JAMAIS le dénominateur (« 7 / 6 » aurait l'air d'un bug).
      L.push('  progression exécution    : ' + Math.max(0, curseur - 1) + ' / ' + stat.total +
        ' ligne(s) consommée(s)   ⇒ RESTE À APPLIQUER : ' + stat.restantAAppliquer + ' déplacement(s)/doublon(s) [borne haute]');
    } catch (e3) { L.push('  (section illisible : ' + e3 + ')'); }

    // ---- 4. VRAC à la racine de chaque domaine (fichiers posés À PLAT, comptage borné) ----
    L.push('');
    L.push('[4] VRAC à la racine des domaines (fichiers directs, hors sous-dossiers)');
    try {
      var debut = Date.now();
      var totalVrac = 0;
      for (var j = 0; j < domaines.length; j++) {
        if (Date.now() - debut > 4 * 60 * 1000) { L.push('  … (comptage interrompu : garde-temps 4 min atteinte)'); break; }
        var res = compterVracRacineDomaine_(domaines[j].id);
        totalVrac += res.n;
        L.push('  ' + domaines[j].nom + ' : ' + res.n + (res.tronque ? '+' : '') + ' fichier(s) à plat');
      }
      L.push('  TOTAL vrac (comptés)     : ' + totalVrac + '   (le rangement les draine vers sous-dossiers/entités ; un domaine peut légitimement en garder — ex. candidatures à plat sous 05)');
    } catch (e4) { L.push('  (comptage vrac illisible : ' + e4 + ')'); }
  } finally {
    Logger.log(L.join('\n')); // le rapport (même partiel) est TOUJOURS écrit dans le journal
  }
  return L.join('\n');
}

/**
 * Décompte des actions du PlanConsolidation (colonne « Action » seule — ÷7 le payload) + nombre de
 * lignes APRÈS le curseur qui restent à appliquer (Déplacer/Doublon). LECTURE SEULE, bornée.
 * @param {number} curseur  ligne du curseur d'exécution (1 = en-têtes).
 * @return {{total:number, deplacer:number, doublon:number, ok:number, ignore:number, restantAAppliquer:number}}
 */
function statPlanConsolidation_(curseur) {
  var r = { total: 0, deplacer: 0, doublon: 0, ok: 0, ignore: 0, restantAAppliquer: 0 };
  // LECTURE STRICTE (revue flotte 🟡B) : `getSheetByName` NE CRÉE RIEN — contrairement à `feuille_`,
  // qui initialiserait TOUS les onglets si celui-ci manquait (écriture Sheet). Le diagnostic reste
  // ainsi authentiquement lecture seule, même sur une Sheet partielle. Onglet absent ⇒ zéros.
  var f = getSheetEtat_().getSheetByName('PlanConsolidation');
  if (!f) return r;
  var dern = f.getLastRow();
  if (dern < 2) return r;
  r.total = dern - 1; // hors ligne d'en-têtes
  var colAction = 4; // COLONNES_PLAN_CONSOLIDATION = [Horodaté, Fichier, ID, Action, …]
  var actions = f.getRange(2, colAction, dern - 1, 1).getValues();
  for (var i = 0; i < actions.length; i++) {
    var a = String(actions[i][0] || '');
    if (a === 'Déplacer') r.deplacer++;
    else if (a === 'Doublon') r.doublon++;
    else if (a === 'OK') r.ok++;
    else r.ignore++;
    // Ligne physique = i + 2 (getValues part de la ligne 2). Restant = après le curseur.
    if ((i + 2) > curseur && (a === 'Déplacer' || a === 'Doublon')) r.restantAAppliquer++;
  }
  return r;
}

/**
 * Compte les fichiers posés DIRECTEMENT à la racine d'un domaine (pas les sous-dossiers). LECTURE
 * SEULE, bornée par un plafond de sûreté (au-delà, marqué tronqué « n+ » — le chiffre exact
 * n'apporte rien au diagnostic). Un domaine illisible rend 0 plutôt qu'un plantage.
 * @param {string} folderId
 * @return {{n:number, tronque:boolean}}
 */
function compterVracRacineDomaine_(folderId) {
  var PLAFOND = 1000;
  var n = 0;
  try {
    var fi = DriveApp.getFolderById(folderId).getFiles();
    while (fi.hasNext()) {
      fi.next();
      n++;
      if (n >= PLAFOND) return { n: n, tronque: true };
    }
  } catch (e) {
    return { n: 0, tronque: false };
  }
  return { n: n, tronque: false };
}
