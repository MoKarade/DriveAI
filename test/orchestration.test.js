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
/**
 * C28-44 (ADR-0038) : les gardes du tick sont désormais des GATES NOMMÉES passées à `etapeSuivie_`
 * (`gResetEnCours`, `gBudgetTick`…). Les tripwires ci-dessous vérifient donc (1) UNE FOIS que
 * chaque nom porte EXACTEMENT son prédicat historique, puis (2) la présence du nom dans le tableau
 * de gates RÉEL de chaque étape (`gatesDe`) — équivalent strict de l'ancien scan des `if` inline,
 * en plus précis (plus de fenêtre de 300 caractères qui pouvait mordre sur l'étape voisine).
 */
const gatesDe = (cle) => {
  const m = corps.match(new RegExp("etapeSuivie_\\('" + cle + "',\\s*\\[([^\\]]*)\\]"));
  assert.ok(m, 'wrap etapeSuivie_ introuvable pour : ' + cle);
  return m[1];
};

test('C28-44 : chaque gate nommée porte EXACTEMENT son prédicat historique, définie UNE SEULE fois (sans quoi les tripwires de gates ne prouvent rien)', () => {
  assert.ok(corps.includes("var gBudgetTick = function () { return estBudgetDepasse() ? 'budget de tick épuisé' : null; };"));
  assert.ok(corps.includes("var gBudgetStandard = function () { return estBudgetDepasseStandard() ? 'budget standard épuisé' : null; };"));
  assert.ok(corps.includes("var gFreinCampagnes = function () { return budgetCampagnesAtteint_() ? 'frein budget campagnes' : null; };"));
  assert.ok(corps.includes("var gResetEnCours = function () { return resetEnCours_() ? 'reset en cours' : null; };"));
  assert.ok(corps.includes("var gResetActif = function () { return CONFIG.RESET_ACTIF ? null : 'désactivée (CONFIG)'; };"));
  // UNICITÉ (revue code-reviewer PR2) : une RÉASSIGNATION ultérieure (`gResetEnCours = autreChose`)
  // ferait mentir le nom partout — chaque gate est définie exactement une fois, jamais réassignée.
  for (const nom of ['gBudgetTick', 'gBudgetStandard', 'gFreinCampagnes', 'gResetEnCours', 'gResetActif']) {
    const assignations = [...corps.matchAll(new RegExp(nom + '\\s*=', 'g'))];
    assert.strictEqual(assignations.length, 1, nom + ' doit être assignée EXACTEMENT une fois (' + assignations.length + ')');
  }
});

test('orchestration RESET : conso-2 (génération + exécution) est gatée par !resetEnCours_()', () => {
  // (La réorg AUTO n'existe plus — ADR-0031 : le tick ne doit plus JAMAIS l'appeler.)
  assert.strictEqual(corps.indexOf('genererDemandeReorgAuto_'), -1,
    'ADR-0031 : plus aucun dépôt de demande de réorg par le tick');
  assert.ok(/gResetEnCours/.test(gatesDe('consolidation-exec')), 'appliquerPlanConsolidation_ doit être gatée par gResetEnCours');
  assert.ok(/gResetEnCours/.test(gatesDe('consolidation-gen')), 'genererPlanConsolidation_ doit être gatée par gResetEnCours');
});

/**
 * RÉALLOCATION (décision Marc 2026-07-29 « fais-le automatiquement » → accélérer l'AUTO) : le reset
 * reçoit le budget des campagnes qu'il suspend, SANS relever l'enveloppe totale. C'est l'invariant
 * anti-gel : au-delà de ~90 min/j de runtime, TOUS les déclencheurs gèlent (chien de garde compris,
 * cf. leçon §7 + redescente C28-29). Ce test verrouille les deux moitiés : les gates ET l'enveloppe.
 */
test('orchestration RESET : les 4 campagnes de fond réallouées sont TOUTES gatées par !resetEnCours_()', () => {
  // Les 2 déjà en place (conso-2) + les 2 ajoutées par la réallocation.
  assert.ok(/gResetEnCours/.test(gatesDe('consolidation-exec')), 'conso-2 exécution');
  assert.ok(/gResetEnCours/.test(gatesDe('consolidation-gen')), 'conso-2 génération');
  assert.ok(/gResetEnCours/.test(gatesDe('histo-gmail')), 'historique Gmail (budget réalloué)');
  assert.ok(/gResetEnCours/.test(gatesDe('reconciliation-index')), 'réconciliation Index (budget réalloué)');
});

test('budget RÉALLOUÉ, jamais AUGMENTÉ : le total du reset ne dépasse pas ce que les campagnes suspendues libèrent', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  // La passe LLM PR5 (C28-42) entre dans la somme : une campagne de fond SANS constante quotidienne
  // échapperait à cet invariant (revue flotte C28-42 — le test resterait vert pendant que l'enveloppe croît).
  const reset = C.RESET_RASSEMBLEMENT_BUDGET_JOUR_MS + C.RESET_PLACEMENT_BUDGET_JOUR_MS +
    C.RESET_04_BUDGET_JOUR_MS + C.RESET_LLM_BUDGET_JOUR_MS;
  const libere = C.CONSOLIDATION_BUDGET_JOUR_MS + C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS +
    C.GMAIL_HISTO_BUDGET_JOUR_MS + C.SYNC_BUDGET_JOUR_MS + C.FUSION_EXEC_BUDGET_JOUR_MS +
    C.MISSIONS_BUDGET_JOUR_MS; // + fusion (#47) et missions (C28-49) — TOUTES gatées !resetEnCours_
                               // (vérifié par les tests de gates ci-dessus/dessous) : un reset ON les
                               // suspend, leur budget est donc réellement LIBÉRÉ pour lui.
  assert.ok(reset <= libere,
    'le budget du reset (' + Math.round(reset / 60000) + ' min/j) doit rester ≤ celui des campagnes qu\'il ' +
    'suspend (' + Math.round(libere / 60000) + ' min/j) — sinon l\'enveloppe de runtime CROÎT et on ' +
    'risque le gel de TOUS les déclencheurs, chien de garde inclus (leçon §7 / C28-29)');
  // Et le reset doit réellement PROFITER de la réallocation (sinon le gate ne sert à rien).
  assert.ok(reset > C.CONSOLIDATION_BUDGET_JOUR_MS + C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS,
    'le reset doit consommer plus que le seul budget de conso-2, sinon la réallocation est inutile');
});

test('enveloppe reset-OFF : la somme des budgets QUOTIDIENS des campagnes concurrentes reste sous le mur runtime (leçon C28-42)', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  // Reset OFF (ADR-0035, état permanent depuis l'incident deadlock) : ces campagnes tournent
  // CONCURREMMENT (toutes gatées `!resetEnCours_()`). Toute NOUVELLE campagne de fond DOIT être AJOUTÉE
  // ICI (leçon §7 C28-42 : sans ça l'enveloppe croît EN SILENCE — test aveugle → risque de gel de TOUS
  // les déclencheurs, chien de garde inclus, C28-29). C'est la moitié que l'invariant de réallocation
  // ci-dessus ne voit pas (lui borne le reset ON, pas l'agrégat reset-OFF).
  const concurrentesResetOff = C.GMAIL_HISTO_BUDGET_JOUR_MS + C.CONSOLIDATION_BUDGET_JOUR_MS +
    C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS + C.SYNC_BUDGET_JOUR_MS + C.FUSION_EXEC_BUDGET_JOUR_MS +
    C.HISTORIQUE_VRAC_BUDGET_JOUR_MS + C.MISSIONS_BUDGET_JOUR_MS; // missions C28-49 (partagé entre elles)
  // RÉALLOCATION 2026-08-11 (diagnostic prod : l'exec est le goulot) : exec 6→12, fusion 6→0 (parkée,
  // campagne OFF) — la SOMME reste 56 min/j (20+12+12+12+0), enveloppe INCHANGÉE, pur transfert.
  // HISTORIQUE_VRAC (2026-08-12, demande Marc : suivi journalier par domaine) : +4 min → 60 min/j.
  // Budget QUOTIDIEN en ms réelles persistées (comme les autres campagnes, PAS le sous-budget par
  // run de 2 min — leçon C28-42 : un plafond par RUN ne borne pas la JOURNÉE si la sweep doit
  // reprendre sur plusieurs ticks, revue flotte apps-script-quota).
  // Mur runtime Apps Script ~90 min/j ; on réserve ~25 min au socle NON budgété (flux vivant +
  // `finally` ×288 ticks). Plafond dérivé = 65 min. Prouvé par MUTATION : gonfler une de ces
  // constantes (ex. CONSOLIDATION_EXEC 12→30) DOIT casser ce test (vérifié).
  const PLAFOND_MS = 65 * 60 * 1000;
  assert.ok(concurrentesResetOff <= PLAFOND_MS,
    'budgets campagnes reset-OFF = ' + Math.round(concurrentesResetOff / 60000) + ' min/j > 65 min : ' +
    'risque de dépassement du quota runtime ~90 min/j (gel de TOUS les déclencheurs, chien de garde inclus)');
});

/**
 * RÉALLOCATION 2026-08-11 (revue flotte apps-script-quota) : verrou du COUPLE exec↔fusion, PAS
 * seulement de l'agrégat ≤ 65 — celui-ci est structurellement AVEUGLE au cas 62 min/j (near-gel :
 * fusion réactivée à 6 SANS rendre les 6 min à l'exec) puisque 62 ≤ 65. C'est exactement le trou de
 * la leçon C28-42 (l'invariant d'enveloppe reste vert pendant qu'un couple mal restauré grimpe). On
 * verrouille donc la PAIRE (somme constante) + l'interdit « campagne active à budget 0 » (muette).
 */
test('réallocation exec↔fusion : le COUPLE somme 12 min ET une campagne active n\'a jamais un budget 0', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  // 6 min ont été TRANSFÉRÉS de FUSION_EXEC (OFF) vers CONSOLIDATION_EXEC : leur somme reste 12 min/j.
  // Réactiver la fusion (0→6) SANS redescendre l'exec (12→6) casse ce test — rappel FORCÉ, jamais
  // laissé à la seule discipline (leçon §7 : « promesse de verrou = verrou codé »).
  assert.strictEqual((C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS + C.FUSION_EXEC_BUDGET_JOUR_MS) / 60000, 12,
    'CONSOLIDATION_EXEC + FUSION_EXEC doit rester = 12 min/j (couple réalloué) : à la réactivation de ' +
    'la fusion, rendre à l\'exec les 6 min prêtés (sinon enveloppe 62 = near-gel, non vu par l\'agrégat ≤65)');
  // Une campagne ACTIVE avec un budget quotidien 0 tourne à VIDE en silence (`consommeJour 0 >= 0`
  // court-circuite `appliquer…_` avant tout travail) : jamais autorisé.
  assert.ok(!C.FUSION_EXEC_ACTIF || C.FUSION_EXEC_BUDGET_JOUR_MS > 0,
    'FUSION_EXEC_ACTIF=true avec FUSION_EXEC_BUDGET_JOUR_MS=0 = campagne MUETTE (no-op silencieux) : ' +
    'rends-lui son budget avant de l\'activer');
});

/**
 * RÉALLOCATION C28-49 (ADR-0039) : la génération de consolidation est TERMINÉE (16/08, 9/9) —
 * 10 de ses 12 min/j partent aux MISSIONS de curation. Même patron de verrou que exec↔fusion :
 * la PAIRE (somme constante), pas seulement l'agrégat ≤ 65 (aveugle à un transfert à moitié
 * annulé), + l'interdit « campagne active à budget 0 ». Prouvé par mutation.
 */
test('réallocation conso-gen↔missions : le COUPLE somme 12 min ET une mission active n\'a jamais un budget 0', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  assert.strictEqual((C.CONSOLIDATION_BUDGET_JOUR_MS + C.MISSIONS_BUDGET_JOUR_MS) / 60000, 12,
    'CONSOLIDATION (gen) + MISSIONS doit rester = 12 min/j (couple réalloué C28-49) : le jour où la ' +
    'consolidation doit VRAIMENT reprendre, rendre les 10 min prêtés (missions finies) — sinon ' +
    'l\'enveloppe croît en silence (leçon C28-42)');
  assert.ok(!C.MISSIONS_ACTIF || C.MISSIONS_BUDGET_JOUR_MS > 0,
    'MISSIONS_ACTIF=true avec MISSIONS_BUDGET_JOUR_MS=0 = missions MUETTES (no-op silencieux)');
});

test('orchestration MISSIONS : les 4 missions sont gatées par !resetEnCours_() ET le budget quotidien', () => {
  ['mission-vehicule', 'mission-logement', 'mission-dispatch-03', 'mission-archives-06'].forEach((cle) => {
    assert.ok(/gResetEnCours/.test(gatesDe(cle)), cle + ' : une seule main déplace (reset)');
    assert.ok(/gMissionsJour_/.test(gatesDe(cle)), cle + ' : la raison « budget du jour épuisé » doit ' +
      'venir de la GATE (suivi C28-44 → statut « en pause » + « reprise demain »)');
    assert.ok(/gBudgetStandard/.test(gatesDe(cle)), cle + ' : budget TAIL (pure I/O), jamais le budget de tick');
  });
  // dispatch03 attend la convergence de vehicule+logement (revue code C28-49) : ses fenêtres
  // d'occupation et la cible Toyota bZ sont CONSTRUITES par ces deux missions — router avant,
  // c'est figer des refus sur un état encore mouvant.
  assert.ok(/gMissionsAmont03_/.test(gatesDe('mission-dispatch-03')),
    'mission-dispatch-03 doit attendre vehicule+logement (gMissionsAmont03_)');
  assert.ok(!/gMissionsAmont03_/.test(gatesDe('mission-vehicule')) &&
    !/gMissionsAmont03_/.test(gatesDe('mission-archives-06')),
    'la gate d\'amont ne s\'applique qu\'à dispatch03');
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
  ['reset-rassemblement', 'reset-placement', 'reset-04-interne',
    'reset-llm'].forEach((cle) => { // + la passe LLM PR5 (ADR-0030)
    assert.ok(!/gResetEnCours|resetEnCours_/.test(gatesDe(cle)),
      cle + ' ne doit JAMAIS être gatée par resetEnCours_ (nommée OU inline) : resetTermine_ exige ' +
      'que la phase TOURNE pour poser son tag, donc le reset ne démarrerait plus jamais ET toutes ' +
      'les campagnes resteraient suspendues à vie (heartbeat vert, zéro erreur — panne invisible)');
    // Et JAMAIS un `if (!resetEnCours_())` inline RÉ-ENVELOPPANT le wrap (revue code-reviewer PR2 :
    // l'inspection du tableau de gates seule serait aveugle à cette forme — l'ancienne fenêtre de
    // 300 caractères la voyait, on la garde ici pour les invariants NÉGATIFS).
    const i = corps.indexOf("etapeSuivie_('" + cle + "'");
    assert.ok(!/resetEnCours_/.test(corps.slice(Math.max(0, i - 150), i)),
      cle + ' : un if inline resetEnCours_ ré-enveloppe le wrap — même gate auto-verrouillante, autre forme');
  });
});

/**
 * Passe LLM du RELIQUAT (ADR-0030 PR5, décision Marc 2026-07-31) : campagne de fond au budget
 * QUOTIDIEN propre (`RESET_LLM_BUDGET_JOUR_MS`, sommé dans l'invariant ci-dessus), bornée par run
 * au budget LLM du tick — jamais le budget tail I/O (elle appelle Sonnet), TOUJOURS le frein
 * campagnes §2.6, et AVANT TOUTES les autres campagnes LLM, historique Gmail comprise : à la
 * reprise post-reset (`resetTermine_` peut basculer AVANT le drainage — le drapeau LLM n'y entre
 * pas), le reliquat garde la priorité du créneau 3 min (revue flotte C28-42).
 */
test('orchestration RESET : la passe LLM du reliquat est gatée budget de tick + frein campagnes, AVANT histo/migration/réanalyse', () => {
  const i = corps.indexOf('analyserReliquatReset_(estBudgetDepasse)');
  assert.ok(i !== -1, 'appel introuvable');
  const garde = gatesDe('reset-llm');
  assert.ok(/gBudgetTick/.test(garde), 'budget LLM de tick (3 min), jamais le budget tail I/O');
  assert.ok(/gFreinCampagnes/.test(garde), 'frein campagnes §2.6 : la passe coûte du Sonnet');
  assert.ok(!/analyserReliquatReset_\(estBudgetDepasseStandard\)/.test(corps),
    'jamais le garde étendu 4,5 min : il est réservé à l\'I/O pur, pas aux appels LLM');
  assert.ok(i < posAppel('traiterGmailHistorique_(estBudgetDepasse)'),
    'AVANT l\'historique Gmail : à la reprise post-reset, l\'histo lui volerait le créneau LLM du tick');
  assert.ok(i < posAppel('appliquerMigrationTaxonomie_(estBudgetDepasse)'),
    'le reliquat garde la priorité du créneau LLM sur les campagnes qui reprennent après le reset');
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

  // Les budgets QUOTIDIENS (la protection réelle du quota runtime) : tripwire de VALEURS — toute
  // retouche est une décision consciente, re-sommée dans l'invariant de réallocation ci-dessus.
  // C28-42 : 20/22/8 → 20/14/4 + 12 pour la passe LLM du reliquat (enveloppe 50 min/j INCHANGÉE).
  // ⚠ Assertion RÉPARÉE (revue #229) : la version précédente concaténait deux fois le motif, la
  // regex ne matchait JAMAIS et `NaN || 20` la rendait toujours verte — elle passait même avec
  // 90 min. Ici on lit la VRAIE valeur, donc gonfler la constante fait échouer le test.
  assert.strictEqual(val('RESET_RASSEMBLEMENT_BUDGET_JOUR_MS'), 20, 'budget quotidien du rassemblement inchangé');
  assert.strictEqual(val('RESET_PLACEMENT_BUDGET_JOUR_MS'), 14, 'budget quotidien du placement (22→14, réalloué à la passe LLM — C28-42)');
  assert.strictEqual(val('RESET_04_BUDGET_JOUR_MS'), 4, 'budget quotidien de 04 (8→4, réalloué à la passe LLM — C28-42)');
  assert.strictEqual(val('RESET_LLM_BUDGET_JOUR_MS'), 12, 'budget quotidien de la passe LLM du reliquat (C28-42)');
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
  // Rattrapage (leur retard est sans conséquence) → suspendues.
  ['migration', 'reanalyse', 'dryrun-v2'].forEach((cle) => {
    assert.ok(/gResetEnCours/.test(gatesDe(cle)), cle + ' doit être suspendue pendant le reset');
  });
  // `etapeReorg_` APPLIQUE les actions que Marc a validées dans l'app : jamais suspendue, sinon
  // ses validations resteraient sans effet tant que le reset tourne (des JOURS).
  assert.ok(!/gResetEnCours|resetEnCours_/.test(gatesDe('reorg')),
    'etapeReorg_ ne doit JAMAIS être suspendue : c\'est du travail explicitement demandé par Marc');
  const iReorg = corps.indexOf("etapeSuivie_('reorg'");
  assert.ok(!/resetEnCours_/.test(corps.slice(Math.max(0, iReorg - 150), iReorg)),
    'reorg : pas non plus un if inline resetEnCours_ ré-enveloppant le wrap (invariant négatif, les deux formes)');
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
