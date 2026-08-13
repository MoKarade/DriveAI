/**
 * HistoriqueVrac.gs — journal QUOTIDIEN du vrac (fichiers à plat) par domaine (demande Marc
 * 2026-08-12 : « pour chaque dossier je veux un détail journalier de l'avancement jusqu'à la
 * fin »). LECTURE SEULE (aucune mutation Drive), une seule sweep COMPLÈTE par jour (Property de
 * garde), curseur de domaine reprenable si le budget coupe en cours de route. L'onglet
 * `HistoriqueVrac` est APPEND-ONLY (jamais réécrit ni purgé, contrairement à Progression/Santé) —
 * c'est la série temporelle elle-même.
 *
 * Tourne MÊME si `resetEnCours_()` : aucune mutation, donc aucun conflit avec « une seule main
 * déplace à la fois » (ADR-0030) — contrairement à conso-2/histo/sync qui, eux, décident et
 * appliquent des déplacements.
 */

/**
 * Liste des domaines à suivre : fixes + auto DÉJÀ NÉS. MÊME périmètre que `genererPlanConsolidation_`
 * (Consolidation.gs) et `etatCampagnesRangement` (Diagnostic.gs) — jamais `domainesAutorises_()`,
 * plus large, qui listerait aussi des domaines auto pas encore créés.
 * @param {PropertiesService.Properties} props
 * @return {Array<{nom:string, id:string}>}
 */
function domainesHistoriqueVrac_(props) {
  var domaines = [];
  Object.keys(CONFIG.DOMAINES).forEach(function (nom) { domaines.push({ nom: nom, id: CONFIG.DOMAINES[nom] }); });
  (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
    var id = props.getProperty('DriveAI_DOM_' + nom);
    if (id) domaines.push({ nom: nom, id: id });
  });
  return domaines;
}

/**
 * PURE : formate UNE ligne de `HistoriqueVrac` pour un domaine déjà compté. Un domaine illisible
 * (`compte.erreur`) laisse `Vrac` VIDE plutôt qu'un faux 0 permanent dans ce journal APPEND-ONLY
 * (confirmé en prod 2026-08-12 : `06 · Études` avait affiché 0 avec ≥400 fichiers réels — un 0
 * écrit ici ne se corrige JAMAIS, contrairement à Progression/Santé qui se réécrivent chaque tick).
 * @param {string} date  `dateGmail_` du jour (format AAAA/MM/JJ, stable et trié)
 * @param {{nom:string, id:string}} domaine
 * @param {{n:number, tronque:boolean, erreur:boolean}} compte  résultat de `compterVracRacineDomaine_`
 * @return {Array} [Date, Domaine, Vrac, Tronqué, Erreur]
 */
function ligneHistoriqueVrac_(date, domaine, compte) {
  if (compte.erreur) return [date, domaine.nom, '', '', 'oui'];
  return [date, domaine.nom, compte.n, compte.tronque ? 'oui' : '', ''];
}

/** Consommation du budget QUOTIDIEN (ms réelles persistées `AAAA/MM/JJ|ms`). PUR sur props. */
function budgetJourHistoriqueVrac_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_VRAC_JOUR_MS') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * ÉTAPE DE TICK (I/O pur, jamais de LLM ⇒ budget TAIL, jamais le budget de tick 3 min) : une sweep
 * QUOTIDIENNE, curseur de domaine reprenable. Le garde-temps est vérifié AVANT CHAQUE domaine, DANS
 * la même boucle qui fait le comptage Drive (patron `etatCampagnesRangement`, Diagnostic.gs) —
 * jamais une sélection « pure » suivie d'une exécution non gardée, qui rendrait le sous-budget par
 * run décoratif (revue flotte apps-script-quota : un domaine à ~1000 fichiers, `08 · Perso`,
 * compté sans coupure juste avant la libération du LockService risquerait le mur dur 6 min).
 * Budget QUOTIDIEN en ms réelles persistées (comme les autres campagnes, leçon §7 : un plafond par
 * RUN ne borne pas la JOURNÉE si la sweep doit reprendre sur plusieurs ticks). Le jour n'est marqué
 * fini QUE quand tous les domaines ont été comptés (jamais sur une passe interrompue).
 * @param {function():boolean} estBudgetDepasse
 */
function majHistoriqueVrac_(estBudgetDepasse) {
  if (!CONFIG.HISTORIQUE_VRAC_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var aujourdhui = dateGmail_(new Date());
  if (props.getProperty('DriveAI_VRAC_HISTO_JOUR') === aujourdhui) return; // déjà fait aujourd'hui

  var consommeJour = budgetJourHistoriqueVrac_(props, aujourdhui);
  if (consommeJour >= CONFIG.HISTORIQUE_VRAC_BUDGET_JOUR_MS) return; // repris demain

  var domaines = domainesHistoriqueVrac_(props);
  var idx = Number(props.getProperty('DriveAI_VRAC_HISTO_IDX')) || 0;
  if (idx >= domaines.length) idx = 0; // sécurité (CONFIG aurait changé de taille)

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.HISTORIQUE_VRAC_BUDGET_MS, CONFIG.HISTORIQUE_VRAC_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  var lignes = [];
  while (idx < domaines.length) {
    if (garde()) break; // vérifié AVANT chaque comptage — jamais un lot non borné
    var compte = compterVracRacineDomaine_(domaines[idx].id);
    lignes.push(ligneHistoriqueVrac_(aujourdhui, domaines[idx], compte));
    idx++;
  }

  if (lignes.length) {
    var f = feuille_('HistoriqueVrac');
    f.getRange(f.getLastRow() + 1, 1, lignes.length, COLONNES_HISTORIQUE_VRAC.length).setValues(lignes);
  }

  props.setProperty('DriveAI_VRAC_HISTO_IDX', String(idx));
  props.setProperty('DriveAI_VRAC_JOUR_MS', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  if (idx >= domaines.length) {
    props.setProperty('DriveAI_VRAC_HISTO_JOUR', aujourdhui);
    props.setProperty('DriveAI_VRAC_HISTO_IDX', '0'); // prêt pour la sweep de demain
  }
}
