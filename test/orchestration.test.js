'use strict';
/**
 * ORCHESTRATION du tick (incident 2026-07-23) : la consolidation (ADR-0024) était placée EN DERNIER
 * dans `tickDriveAI` et gatée par le budget de tick 3 min (estBudgetDepasse) — la réconciliation
 * `synchroniserIndex_` (« perpétuelle sur le reliquat de budget ») + les campagnes legacy mangeaient
 * tout le budget avant elle → elle n'était JAMAIS évaluée, zéro drainage (02·Finances et 03 intacts
 * 2 jours) alors que le moteur tournait (heartbeat vert). Correctif (leçon §7 « drainer avant
 * d'alimenter SANS affamer l'alimenteur : TÔT + gated, PAS en dernier ») : REMONTÉE juste après le
 * flux vivant + « BUDGET TAIL » (garde étendu au mur Apps Script 4,5 min, la consolidation étant PURE
 * I/O Drive sans risque LLM).
 *
 * Ce test VERROUILLE les DEUX moitiés du correctif contre régression :
 *  (1) ORDRE : trierFilsGmail_ (flux vivant) AVANT la consolidation, elle-même AVANT les campagnes
 *      legacy (traiterGmailHistorique_) et la réconciliation (synchroniserIndex_) ;
 *  (2) BUDGET TAIL : la consolidation est gatée par estBudgetDepasseStandard (4,5 min), JAMAIS par
 *      estBudgetDepasse (3 min) — sinon elle se fait re-affamer.
 * Test de SOURCE (patron surface-*.test.js / session.test.ts) : un test behavioral de tickDriveAI
 * exigerait ~40 mocks fragiles ; l'ordre et le garde sont des invariants TEXTUELS stables, vérifiés
 * ici sur le vrai fichier moteur.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
const debutTick = src.indexOf('function tickDriveAI(');
assert.ok(debutTick !== -1, 'tickDriveAI introuvable dans src/Main.gs');
const corps = src.slice(debutTick); // corps du tick seulement (évite un homonyme ailleurs)

function posAppel(motif) {
  const i = corps.indexOf(motif);
  assert.ok(i !== -1, 'appel introuvable dans tickDriveAI : ' + motif);
  return i;
}

test('orchestration : le flux vivant passe AVANT la consolidation, qui passe AVANT legacy + réconciliation', () => {
  const tri = posAppel('trierFilsGmail_(estBudgetDepasse)');
  const exec = posAppel('appliquerPlanConsolidation_(estBudgetDepasseStandard)');
  const gen = posAppel('genererPlanConsolidation_(estBudgetDepasseStandard)');
  const histo = posAppel('traiterGmailHistorique_(estBudgetDepasse)');
  const sync = posAppel('synchroniserIndex_(estBudgetDepasse)');

  assert.ok(tri < exec, 'le tri Gmail (flux vivant) doit précéder l\'exécution de la consolidation');
  assert.ok(exec < gen, 'exécution AVANT génération (drainer avant d\'alimenter)');
  assert.ok(gen < histo, 'la consolidation doit précéder les campagnes legacy (historique Gmail)');
  assert.ok(gen < sync, 'la consolidation doit précéder la réconciliation Index (le « trou noir » de budget)');
});

test('orchestration : la consolidation est gatée par le BUDGET TAIL (4,5 min), jamais par le budget de tick 3 min', () => {
  assert.ok(
    /var estBudgetDepasseStandard = function \(\) \{ return Date\.now\(\) - debut > CONFIG\.BUDGET_MS; \}/.test(src),
    'estBudgetDepasseStandard doit être défini sur CONFIG.BUDGET_MS (mur Apps Script 4,5 min)');
  // Régression = re-famine : aucun appel de consolidation ne doit repasser sous le garde 3 min.
  // `\)` ancré → ne matche PAS estBudgetDepasseStandard) (préfixe commun).
  assert.ok(
    !/Consolidation_\(estBudgetDepasse\)/.test(corps),
    'la consolidation ne doit JAMAIS être gatée par estBudgetDepasse (budget de tick 3 min) — elle se ferait affamer');
});

/**
 * RESET complet (C28-33, ADR-0030 « Transition ») : une seule main déplace à la fois. Le reset et
 * conso-2/réorg-auto ne doivent JAMAIS tourner en même temps (non-convergence structurelle, leçon §7
 * C28-26) — vérifié ici en verrouillant le TEXTE du tick (patron ci-dessus), pas un comportement
 * mocké : le garde `!resetEnCours_()` doit apparaître sur CHAQUE point d'entrée concurrent.
 */
test('orchestration RESET : conso-2 (génération + exécution) ET la réorg auto sont gatées par !resetEnCours_()', () => {
  const ligneExec = corps.slice(corps.indexOf('appliquerPlanConsolidation_(estBudgetDepasseStandard)') - 200,
    corps.indexOf('appliquerPlanConsolidation_(estBudgetDepasseStandard)'));
  const ligneGen = corps.slice(corps.indexOf('genererPlanConsolidation_(estBudgetDepasseStandard)') - 200,
    corps.indexOf('genererPlanConsolidation_(estBudgetDepasseStandard)'));
  const ligneReorgAuto = corps.slice(corps.indexOf('genererDemandeReorgAuto_(estBudgetDepasseStandard)') - 200,
    corps.indexOf('genererDemandeReorgAuto_(estBudgetDepasseStandard)'));
  assert.ok(/!resetEnCours_\(\)/.test(ligneExec), 'appliquerPlanConsolidation_ doit être gatée par !resetEnCours_()');
  assert.ok(/!resetEnCours_\(\)/.test(ligneGen), 'genererPlanConsolidation_ doit être gatée par !resetEnCours_()');
  assert.ok(/!resetEnCours_\(\)/.test(ligneReorgAuto), 'genererDemandeReorgAuto_ doit être gatée par !resetEnCours_()');
});

/**
 * RÉALLOCATION (décision Marc 2026-07-29 « fais-le automatiquement » → accélérer l'AUTO) : le reset
 * reçoit le budget des campagnes qu'il suspend, SANS relever l'enveloppe totale. C'est l'invariant
 * anti-gel : au-delà de ~90 min/j de runtime, TOUS les déclencheurs gèlent (chien de garde compris,
 * cf. leçon §7 + redescente C28-29). Ce test verrouille les deux moitiés : les gates ET l'enveloppe.
 */
test('orchestration RESET : les 4 campagnes de fond réallouées sont TOUTES gatées par !resetEnCours_()', () => {
  const avant = (motif) => {
    const i = corps.indexOf(motif);
    assert.ok(i !== -1, 'appel introuvable : ' + motif);
    return corps.slice(Math.max(0, i - 300), i);
  };
  // Les 2 déjà en place (conso-2) + les 2 ajoutées par la réallocation.
  assert.ok(/!resetEnCours_\(\)/.test(avant('appliquerPlanConsolidation_(estBudgetDepasseStandard)')), 'conso-2 exécution');
  assert.ok(/!resetEnCours_\(\)/.test(avant('genererPlanConsolidation_(estBudgetDepasseStandard)')), 'conso-2 génération');
  assert.ok(/!resetEnCours_\(\)/.test(avant('traiterGmailHistorique_(estBudgetDepasse)')), 'historique Gmail (budget réalloué)');
  assert.ok(/!resetEnCours_\(\)/.test(avant('synchroniserIndex_(estBudgetDepasse)')), 'réconciliation Index (budget réalloué)');
});

test('budget RÉALLOUÉ, jamais AUGMENTÉ : le total du reset ne dépasse pas ce que les campagnes suspendues libèrent', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  const reset = C.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS + C.RESET_PLACEMENT_BUDGET_JOUR_MS + C.RESET_04_BUDGET_JOUR_MS;
  const libere = C.CONSOLIDATION_BUDGET_JOUR_MS + C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS +
    C.GMAIL_HISTO_BUDGET_JOUR_MS + C.SYNC_BUDGET_JOUR_MS;
  assert.ok(reset <= libere,
    'le budget du reset (' + Math.round(reset / 60000) + ' min/j) doit rester ≤ celui des campagnes qu\'il ' +
    'suspend (' + Math.round(libere / 60000) + ' min/j) — sinon l\'enveloppe de runtime CROÎT et on ' +
    'risque le gel de TOUS les déclencheurs, chien de garde inclus (leçon §7 / C28-29)');
  // Et le reset doit réellement PROFITER de la réallocation (sinon le gate ne sert à rien).
  assert.ok(reset > C.CONSOLIDATION_BUDGET_JOUR_MS + C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS,
    'le reset doit consommer plus que le seul budget de conso-2, sinon la réallocation est inutile');
});

/**
 * RÉCIPROQUE VITALE (revue quota #226) : les phases du reset ne doivent JAMAIS être gatées par
 * `!resetEnCours_()`. Le gate serait AUTO-VERROUILLANT — `resetEnCours_ = RESET_ACTIF && !resetTermine_()`
 * et `resetTermine_()` exige que les 3 phases posent leur tag, ce qui n'arrive que si elles TOURNENT.
 * Une seule ligne ajoutée par copie-collé (il y a maintenant 5 `!resetEnCours_()` dans le tick, dont
 * deux juste autour du bloc reset) et : le reset ne démarre plus JAMAIS, `resetEnCours_` reste vrai à
 * vie, donc conso-2 + réorg auto + historique Gmail + réconciliation Index restent suspendus
 * indéfiniment. Tout l'étage campagnes meurt avec un heartbeat VERT et zéro erreur au Journal.
 * Exactement le motif §7 « un statut TERMINAL ne peut pas servir de signal d'OCCUPATION » / « un gate
 * se teste par sa LIBÉRATION » — déjà vécu en C28-32, et ce PR en multiplie la surface d'exposition.
 */
test('orchestration RESET : les 3 phases ne sont JAMAIS gatées par !resetEnCours_() (gate auto-verrouillant = mort silencieuse de TOUTES les campagnes)', () => {
  const avant = (motif) => {
    const i = corps.indexOf(motif);
    assert.ok(i !== -1, 'appel introuvable : ' + motif);
    return corps.slice(Math.max(0, i - 300), i);
  };
  ['rassemblerReset_(estBudgetDepasseStandard)', 'placerReset_(estBudgetDepasseStandard)',
    'appliquerReset04Interne_(estBudgetDepasseStandard)'].forEach((motif) => {
    assert.ok(!/!resetEnCours_\(\)/.test(avant(motif)),
      motif + ' ne doit JAMAIS être gatée par !resetEnCours_() : resetTermine_ exige que la phase ' +
      'TOURNE pour poser son tag, donc le reset ne démarrerait plus jamais ET toutes les campagnes ' +
      'resteraient suspendues à vie (heartbeat vert, zéro erreur — panne invisible)');
  });
});

test('orchestration RESET : rassemblement → placement → 04 interne, dans cet ordre, en BUDGET TAIL (jamais le budget de tick 3 min)', () => {
  const rass = posAppel('rassemblerReset_(estBudgetDepasseStandard)');
  const place = posAppel('placerReset_(estBudgetDepasseStandard)');
  const interne04 = posAppel('appliquerReset04Interne_(estBudgetDepasseStandard)');
  assert.ok(rass < place, 'le rassemblement doit précéder le placement (drainer ce qu\'il vient d\'alimenter)');
  assert.ok(place < interne04, 'le placement doit précéder la réorg interne de 04 (ordre du branchement)');
  assert.ok(!/rassemblerReset_\(estBudgetDepasse\)/.test(corps), 'rassemblerReset_ ne doit JAMAIS être gatée par le budget de tick 3 min');
  assert.ok(!/placerReset_\(estBudgetDepasse\)/.test(corps), 'placerReset_ ne doit JAMAIS être gatée par le budget de tick 3 min');
  assert.ok(!/appliquerReset04Interne_\(estBudgetDepasse\)/.test(corps), 'appliquerReset04Interne_ ne doit JAMAIS être gatée par le budget de tick 3 min');
});

/**
 * ACCÉLÉRATION du 2026-07-31 (demande Marc « tout fini aujourd'hui »). Aucun levier n'augmente un
 * budget protégeant le quota partagé (leçon §7 « RÉALLOUER, jamais AUGMENTER ») :
 *  1. plafonds d'ITEMS par run relevés — le garde-temps par run reste la VRAIE borne, inchangé ;
 *  2. campagnes de RATTRAPAGE suspendues pendant le reset (comme conso-2/histo/sync) ;
 *  3. `majResumeHub_` throttlé (il relisait l'Index entier ×288/j) ;
 *  4. (revue #229) le vrai levier de DÉBIT : ne plus re-télécharger les octets d'un fichier déjà
 *     hashé, et mémoïser les dossiers cibles — moins de travail par fichier, pas plus de budget.
 */
test('accélération : le garde-temps par run reste la VRAIE borne — relever un plafond d\'ITEMS n\'augmente aucun budget', () => {
  const fs = require('fs');
  const path = require('path');
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'Config.gs'), 'utf8');
  const reset = fs.readFileSync(path.join(__dirname, '..', 'src', 'Reset.gs'), 'utf8');
  const val = (nom) => Number((new RegExp(nom + ':\\s*([0-9]+)').exec(cfg) || [])[1]);

  // Les budgets QUOTIDIENS (la protection réelle du quota runtime) sont INCHANGÉS : 20/22/8 min.
  // ⚠ Assertion RÉPARÉE (revue #229) : la version précédente concaténait deux fois le motif, la
  // regex ne matchait JAMAIS et `NaN || 20` la rendait toujours verte — elle passait même avec
  // 90 min. Ici on lit la VRAIE valeur, donc gonfler la constante fait échouer le test.
  assert.strictEqual(val('RESET_RASSEMBLEMENT_BUDGET_JOUR_MS'), 20, 'budget quotidien du rassemblement inchangé');
  assert.strictEqual(val('RESET_PLACEMENT_BUDGET_JOUR_MS'), 22, 'budget quotidien du placement inchangé');
  assert.strictEqual(val('RESET_04_BUDGET_JOUR_MS'), 8, 'budget quotidien de 04 inchangé');
  // Chaque phase borne son run par un garde-temps ET le vérifie À CHAQUE item : un plafond d'items
  // plus haut ne peut donc pas faire dépasser le temps alloué. Les COLLECTES récursives comptent
  // autant que les boucles de mutation (revue #229) : ce sont elles que le plafond relevé fait
  // travailler plus longtemps.
  ['rassemblerUnePageReset_', 'placerUnePageReset_', 'reorganiserPageInterne04_',
    'collecterRassemblementReset_', 'collecterInterne04Reset_'].forEach((fn) => {
    const i = reset.indexOf('function ' + fn + '(');
    assert.ok(i !== -1, fn + ' introuvable');
    const corps = reset.slice(i, reset.indexOf('\n}', i));
    assert.ok(/estBudgetDepasse\(\)/.test(corps),
      fn + ' doit vérifier le garde-temps DANS sa boucle — sinon relever le plafond d\'items déborderait le budget');
  });
  // Et les plafonds sont bien > à leur valeur d'origine (sinon ce test ne prouverait rien).
  assert.ok(val('RESET_RASSEMBLEMENT_MAX_PAR_RUN') > 60);
  assert.ok(val('RESET_PLACEMENT_MAX_PAR_RUN') > 80);
});

test('accélération : les campagnes de RATTRAPAGE sont suspendues pendant le reset, mais PAS le travail demandé par Marc', () => {
  const avant = (motif) => {
    const i = corps.indexOf(motif);
    assert.ok(i !== -1, 'appel introuvable : ' + motif);
    return corps.slice(Math.max(0, i - 260), i);
  };
  // Rattrapage (leur retard est sans conséquence) → suspendues.
  ['appliquerMigrationTaxonomie_(estBudgetDepasse)', 'appliquerReanalyseCiblee_(estBudgetDepasse)',
    'appliquerDryRunV2_(estBudgetDepasse)'].forEach((m) => {
    assert.ok(/!resetEnCours_\(\)/.test(avant(m)), m + ' doit être suspendue pendant le reset');
  });
  // `etapeReorg_` APPLIQUE les actions que Marc a validées dans l'app : jamais suspendue, sinon
  // ses validations resteraient sans effet tant que le reset tourne (des JOURS).
  assert.ok(!/!resetEnCours_\(\)/.test(avant('etapeReorg_(estBudgetDepasse)')),
    'etapeReorg_ ne doit JAMAIS être suspendue : c\'est du travail explicitement demandé par Marc');
});

test('accélération : majResumeHub_ est throttlé (il relisait l\'Index ENTIER à chaque tick)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebApp.gs'), 'utf8');
  const i = src.indexOf('function majResumeHub_(');
  const corps = src.slice(i, src.indexOf('\n}', i));
  assert.ok(/HUB_RESUME_INTERVALLE_MS/.test(corps), 'le throttle doit être appliqué');
  // Le marqueur ne se pose qu'APRÈS le calcul : une panne rejoue au tick suivant (jamais un
  // « déjà fait » sur un calcul qui a échoué).
  const posMarqueur = src.indexOf("DriveAI_HUB_MAJ_MS', String(Date.now())");
  const posEcriture = src.indexOf("DriveAI_HUB_SUMMARY', JSON.stringify(etat)");
  assert.ok(posEcriture !== -1 && posMarqueur > posEcriture,
    'le marqueur de fraîcheur doit être posé APRÈS l\'écriture du résumé');
});
