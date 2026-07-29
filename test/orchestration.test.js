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
