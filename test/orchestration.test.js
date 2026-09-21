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
    C.MISSIONS_BUDGET_JOUR_MS +
    // ⚠️ 9ᵉ jambe (revue quotas ADR-0056) : `reanalyse` est gatée `gResetEnCours` (Main.gs), elle
    // appartient donc à CE bloc AUSSI. Il y a TROIS sommes, pas deux — et c'est la troisième qui
    // perdait sa marge : sans cette ligne, `libere` tombait de 58 à 50 min/j face à un `reset` de
    // 50, soit ZÉRO marge, avec le test toujours vert (50 ≤ 50). La prochaine réallocation neutre
    // vers la re-analyse aurait été refusée par un invariant censé l'autoriser — exactement le
    // défaut que C28-99 avait corrigé sur l'autre verrou.
    C.REANALYSE_BUDGET_JOUR_MS +
    // ⚠️ 10ᵉ jambe (C49-3) : l'audit des pièces est gaté `gResetEnCours` lui aussi (Main.gs), il
    // appartient donc à CE bloc. Sans cette ligne, `libere` perdrait les 12 min qu'il vient de
    // recevoir et le test refuserait un transfert NEUTRE — le défaut que la 9ᵉ jambe a corrigé.
    C.AUDIT_PIECE_BUDGET_JOUR_MS; // + fusion (#47) et missions (C28-49) — TOUTES gatées !resetEnCours_
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
    C.HISTORIQUE_VRAC_BUDGET_JOUR_MS + C.MISSIONS_BUDGET_JOUR_MS + // missions C28-49 (partagé entre elles)
    C.DOUBLONS_BUDGET_JOUR_MS + // validation de _Doublons (C28-49 PR4, ADR-0047) — lecture seule, zéro LLM
    C.REANALYSE_BUDGET_JOUR_MS + // re-analyse ciblée (ADR-0056) — elle n'avait AUCUN budget quotidien,
                                // donc l'agrégat ci-dessous ne la voyait pas : l'enveloppe pouvait
                                // croître avec ce test au vert. La 9ᵉ jambe ferme cet angle mort.
    C.MEMOIRE_BUDGET_JOUR_MS +  // 10ᵉ jambe (C28-135) — MÊME angle mort, re-payé : l'envoi à la
                                // Mémoire tournait depuis le 16/09 SANS aucune constante quotidienne,
                                // donc ce test restait vert pendant que l'enveloppe croissait. Ses
                                // 4 min/j sont PRÉLEVÉES sur l'historique Gmail (12 → 8).
    C.AUDIT_PIECE_BUDGET_JOUR_MS; // 11ᵉ jambe (C49-3) — l'audit de l'ADR-0061, branché dans le tick
                                // pour que Marc n'ait plus rien à lancer. Financé par un pur
                                // transfert depuis la réconciliation Index (SYNC 12 → 4).
  // RÉALLOCATION 2026-08-11 (diagnostic prod : l'exec est le goulot) : exec 6→12, fusion 6→0 (parkée,
  // campagne OFF) — la SOMME reste 56 min/j (20+12+12+12+0), enveloppe INCHANGÉE, pur transfert.
  // HISTORIQUE_VRAC (2026-08-12, demande Marc : suivi journalier par domaine) : +4 min → 60 min/j.
  // DOUBLONS (2026-08-20, ADR-0047 : valider `_Doublons` par empreinte) : +3 min → 63 min/j. Prélevé
  // sur la MARGE et non sur une campagne vivante — `GMAIL_HISTO_BUDGET_JOUR_MS` (20 min/j) est le
  // donneur évident, mais « probablement terminé » (HANDOVER) n'est pas une preuve (§1.6 : ne pas
  // déclarer une campagne finie sans lire son compteur). Réallocation à faire, backlog C28-70.
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
 * VERROU D'ÉGALITÉ (C28-99) — remplace les deux verrous de COUPLE (exec↔fusion 2026-08-11,
 * conso-gen↔missions C28-49), devenus faux dès qu'une réallocation traverse les deux paires.
 *
 * ⚠️ Il porte sur le MÊME ensemble que le test d'enveloppe ci-dessus — les HUIT campagnes — et pas
 * sur un sous-bloc. Une première écriture ne verrouillait que les cinq campagnes qui se prêtent
 * habituellement du budget ; la revue l'a cassée en deux coups : (a) `HISTORIQUE_VRAC` 4 → 6 SEUL,
 * soit +2 min nettes d'enveloppe, passait au vert (jambe hors bloc, et la marge 63→65 l'absorbait) ;
 * (b) pire, la réallocation SUIVANTE que l'ADR planifie — reprendre 6 min à l'historique Gmail pour
 * la génération — était REFUSÉE alors qu'elle est parfaitement légitime (jambe hors bloc, somme du
 * bloc modifiée). Un verrou qui laisse passer une hausse et bloque un transfert neutre verrouille
 * le contraire de ce qu'on veut.
 *
 * Ce qu'il protège : **aucune réallocation ne doit faire CROÎTRE l'enveloppe de runtime**. Au-delà
 * du mur (~90 min/j), TOUS les déclencheurs gèlent, chien de garde compris (§9 / C28-29).
 * L'agrégat « ≤ 65 » ne suffit pas : il tolère toute croissance tant que la marge tient, donc il est
 * aveugle aux petits transferts à moitié annulés (leçon C28-42). Une ÉGALITÉ, elle, tombe dès que la
 * somme bouge — dans les deux sens, et où que soit la jambe.
 */
test('ENVELOPPE des campagnes : la somme reste EXACTEMENT 63 min/j (réallouer, jamais augmenter)', () => {
  const C = require('./harness').load(['Config.gs']).CONFIG;
  const total = C.GMAIL_HISTO_BUDGET_JOUR_MS + C.CONSOLIDATION_BUDGET_JOUR_MS +
    C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS + C.SYNC_BUDGET_JOUR_MS + C.FUSION_EXEC_BUDGET_JOUR_MS +
    C.HISTORIQUE_VRAC_BUDGET_JOUR_MS + C.MISSIONS_BUDGET_JOUR_MS + C.DOUBLONS_BUDGET_JOUR_MS +
    C.REANALYSE_BUDGET_JOUR_MS + // 9ᵉ jambe (ADR-0056) — cf. le commentaire de l'agrégat ci-dessus
    C.MEMOIRE_BUDGET_JOUR_MS +  // 10ᵉ jambe (C28-135) — idem, et le transfert qui l'a financée est
                                // un pur déplacement : GMAIL_HISTO 12 → 8, MEMOIRE 0 → 4.
    C.AUDIT_PIECE_BUDGET_JOUR_MS; // 11ᵉ jambe (C49-3) — idem : SYNC 12 → 4, AUDIT_PIECE 0 → 8.
                                // La somme ne bouge pas d'une minute.
  assert.strictEqual(total / 60000, 63,
    'la somme des budgets quotidiens des 11 campagnes doit rester = 63 min/j. Pour accélérer une ' +
    'campagne, PRENDRE à une autre — jamais ajouter des minutes : au-delà du mur runtime ' +
    '~90 min/j, TOUS les déclencheurs gèlent, chien de garde inclus (C28-29). Relever ce total ' +
    'est une DÉCISION de Marc, pas un effet de bord : il faudrait d\'abord MESURER le runtime ' +
    'réellement consommé (personne ne le fait — le plafond 65 vient d\'une réserve ESTIMÉE).');
  // Ratio gen/exec. ⚠️ HONNÊTETÉ SUR CE SEUIL (revue C28-99) : le précédent documenté d'août 2026
  // est 12/6 — soit le ratio 2,0 EXACTEMENT, celui où la contre-pression a étranglé la génération
  // (« throttlée, 2,3/12 min seulement »). 16/8 se pose donc PILE sur le point observé, et ce garde
  // l'autorise DÉLIBÉRÉMENT : ce qui différait en août, c'est que le plan traînait 1236 lignes de
  // retard alors qu'il est drainé aujourd'hui. Ce n'est pas une preuve d'innocuité, c'est un pari —
  // et sa contrepartie est la vérification à 24 h inscrite au HANDOVER (si la génération n'affiche
  // pas `16/16 ÉPUISÉ`, rendre les 4 min à l'exécuteur). Ce que le garde empêche, c'est d'aller
  // AU-DELÀ du point déjà vécu sans y penser. Ne pas en déduire « sous 2:1 c'est sûr ».
  assert.ok(C.CONSOLIDATION_BUDGET_JOUR_MS <= 2 * C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS,
    'génération ' + (C.CONSOLIDATION_BUDGET_JOUR_MS / 60000) + ' min/j pour un exécuteur à ' +
    (C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS / 60000) + ' : au-delà du ratio 2:1, on dépasse le point ' +
    'où la contre-pression (CONSOLIDATION_BACKLOG_MAX) a DÉJÀ coupé la génération en prod ' +
    '(2026-08-11) — et les deux moitiés s\'arrêtent alors ensemble, sans symptôme visible.');
  // Une campagne ACTIVE avec un budget quotidien 0 tourne à VIDE en silence (`consommeJour 0 >= 0`
  // court-circuite avant tout travail) : jamais autorisé. C'est l'autre moitié du verrou — sans elle,
  // la somme de bloc se conserverait en rendant une campagne MUETTE.
  [['FUSION_EXEC', C.FUSION_EXEC_ACTIF, C.FUSION_EXEC_BUDGET_JOUR_MS],
    ['MISSIONS', C.MISSIONS_ACTIF, C.MISSIONS_BUDGET_JOUR_MS],
    ['DOUBLONS', C.DOUBLONS_ACTIF, C.DOUBLONS_BUDGET_JOUR_MS],
    ['CONSOLIDATION', C.CONSOLIDATION_ACTIF, C.CONSOLIDATION_BUDGET_JOUR_MS],
    ['CONSOLIDATION_EXEC', C.CONSOLIDATION_EXEC_ACTIF, C.CONSOLIDATION_EXEC_BUDGET_JOUR_MS],
    // ⚠️ La re-datation N'AVAIT PAS de drapeau `*_ACTIF` : une rédaction antérieure codait donc
    // `true` en dur ici, ce qui était juste — elle tournait tant que son tag n'était pas posé.
    // C49-20 lui en a donné un, parce que l'arrêter était impossible autrement : à budget nul elle
    // serait devenue exactement la campagne MUETTE que ce garde interdit.
    ['REANALYSE', C.REANALYSE_ACTIF, C.REANALYSE_BUDGET_JOUR_MS],
    // ⚠️ Ces deux-là MANQUAIENT (la liste en couvrait 5 sur 9, le commentaire ci-dessus le disait
    // sans le corriger). Elles y entrent avec C49-20, qui est le premier lot à les éteindre.
    ['HISTORIQUE_VRAC', C.HISTORIQUE_VRAC_ACTIF, C.HISTORIQUE_VRAC_BUDGET_JOUR_MS],
    ['GMAIL_HISTO', C.GMAIL_HISTO_ACTIF, C.GMAIL_HISTO_BUDGET_JOUR_MS],
  ].forEach(([nom, actif, budget]) => {
    assert.ok(!actif || budget > 0,
      nom + '_ACTIF=true avec un budget quotidien de 0 = campagne MUETTE (no-op silencieux) : ' +
      'rends-lui du budget avant de l\'activer, ou désactive-la explicitement');
  });
});

test('minutes PRÊTÉES : le chiffre affiché à Marc est DÉRIVÉ du transfert, jamais recopié', () => {
  // 🟡 revue code ADR-0056. `GMAIL_HISTO_PRETEES_MIN` existe pour qu'une prochaine session ne prête
  // pas deux fois les mêmes minutes — et pour que la ligne de Santé dise la vérité. Rien ne la
  // reliait au transfert : un prochain 12 → 10 l'aurait laissée à 8, et le message serait devenu
  // faux en silence. « Promesse de verrou = verrou codé dans le même commit » (§9).
  // 20 min = la dotation HISTORIQUE de l'historique Gmail, avant le prêt (ADR-0056 §C).
  const C = require('./harness').load(['Config.gs']).CONFIG;
  const DOTATION_HISTO_MIN = 20;
  assert.strictEqual(C.GMAIL_HISTO_PRETEES_MIN,
    DOTATION_HISTO_MIN - C.GMAIL_HISTO_BUDGET_JOUR_MS / 60000,
    'le prêt annoncé doit être la DIFFÉRENCE réelle entre la dotation et le budget courant');
  // ⚠️ LE GARDE « PRÊTÉ = REÇU » PAR DONNEUR A ÉTÉ RETIRÉ LE 21/09, et il faut dire pourquoi
  // plutôt que de laisser croire à un oubli. Il suivait une chaîne à UN maillon : l'historique
  // Gmail prête, la re-datation et la Mémoire reçoivent. C49-20 a arrêté la re-datation, donc ses
  // 8 min — qui venaient elles-mêmes de l'historique Gmail — sont reparties vers l'audit des
  // pièces. Les re-tracer jusqu'à leur donneur d'ORIGINE les compterait deux fois ; ne pas les
  // tracer casserait l'égalité. Une comptabilité par donneur d'origine ne survit pas à des minutes
  // qui changent de mains deux fois.
  //
  // Ce qui le remplace, et qui couvre strictement plus : l'égalité de l'ENVELOPPE (63 min, plus
  // haut) plus la table `AUDIT_PIECE_DONNEURS_MIN` (test suivant) — la première interdit qu'une
  // minute se crée, la seconde exige que chacune de celles du receveur ait un donneur NOMMÉ.
});

test('PAIRE réconciliation ↔ audit des pièces : la somme est figée, et le donneur ne tombe jamais à zéro', () => {
  // ⚠️ Écrit le 17/09 après une MUTATION VERTE : mettre `SYNC_BUDGET_JOUR_MS` à 0 laissait les
  // vingt cas de ce fichier au vert. L'invariant d'enveloppe ne voit qu'une CROISSANCE ; il est
  // aveugle à une campagne qu'on éteint. Or la réconciliation Index↔Drive est PERPÉTUELLE : à
  // zéro elle tournerait à vide, sans rien dire — l'interdit que la §9 pose pour toute
  // réallocation en paire, et qui n'était codé nulle part pour CE couple.
  const C = require('./harness').load(['Config.gs']).CONFIG;
  // (a) La SOMME du couple ne bouge pas : un transfert à moitié annulé (minutes rendues au
  // donneur sans redescendre le receveur, ou l'inverse) reste sous le plafond global, donc
  // l'invariant d'enveloppe ne l'attrape pas — seul ce garde-ci le voit.
  const DOTATION_COUPLE_MIN = 12; // la dotation HISTORIQUE de la réconciliation, avant tout prêt
  const DONNEURS = C.AUDIT_PIECE_DONNEURS_MIN;
  // ⚠️ La comparaison porte sur la PART reçue de CE donneur, jamais sur le budget total de
  // l'audit : celui-ci porte désormais les minutes de HUIT postes.
  assert.strictEqual(
    C.SYNC_BUDGET_JOUR_MS / 60000 + DONNEURS.SYNC, DOTATION_COUPLE_MIN,
    'ce que l\'audit reçoit de la réconciliation est EXACTEMENT ce qu\'elle perd — rien ne se crée en route');
  // …et les parts REMPLISSENT le budget : une minute sans donneur nommé serait une minute créée,
  // et l'invariant d'enveloppe la laisserait passer (il ne juge que le TOTAL, donc un transfert à
  // moitié fait lui échappe).
  const sommeDonneurs = Object.keys(DONNEURS).reduce((t, k) => t + DONNEURS[k], 0);
  assert.strictEqual(sommeDonneurs, C.AUDIT_PIECE_BUDGET_JOUR_MS / 60000,
    'chaque minute du budget de l\'audit a un donneur NOMMÉ (table AUDIT_PIECE_DONNEURS_MIN)');
  // ⚠️ Et un donneur NOMMÉ doit être un poste qui a VRAIMENT cédé ces minutes : son budget
  // courant plus ce qu'il a prêté ne peut pas être inférieur à ce qu'il déclare donner. Sans
  // cette ligne, la table se conserverait en inventant un donneur — le défaut qu'elle existe
  // pour empêcher, déplacé d'un cran.
  ['CONSOLIDATION', 'CONSOLIDATION_EXEC', 'REANALYSE', 'HISTORIQUE_VRAC', 'DOUBLONS', 'MISSIONS']
    .forEach((nom) => {
      assert.strictEqual(C[nom + '_BUDGET_JOUR_MS'], 0,
        nom + ' donne ' + DONNEURS[nom] + ' min à l\'audit : son propre budget doit être à ZÉRO, '
        + 'sinon les mêmes minutes sont comptées deux fois');
      assert.strictEqual(C[nom + '_ACTIF'], false,
        nom + ' a cédé TOUT son budget : la laisser ACTIVE en ferait une campagne muette');
    });
  // (b) Le donneur reste VIVANT. Une campagne active à budget quotidien nul est un transfert
  // non rendu déguisé en réglage : elle ne produit plus rien et rien ne le signale.
  assert.ok(C.SYNC_BUDGET_JOUR_MS > 0,
    'la réconciliation est PERPÉTUELLE : à zéro elle tourne à vide en silence (§9, réallocation en paire)');
});

test('INVENTAIRE des budgets quotidiens : aucune constante n\'échappe aux invariants', () => {
  // Cécité structurelle de la leçon C28-42, mesurée en revue C28-99 : ajouter une NOUVELLE
  // constante `*_BUDGET_JOUR_MS` laissait les deux invariants VERTS pendant que l'enveloppe
  // croissait — ils somment une liste ÉCRITE À LA MAIN, ils ne savent pas ce qu'ils ignorent.
  // Cet inventaire renverse la charge : toute constante neuve DOIT être classée ici, donc son
  // auteur doit se demander dans quelle enveloppe elle tombe. Même patron que l'inventaire
  // `feuille_` ↔ `creerOnglet_`.
  const C = require('./harness').load(['Config.gs']).CONFIG;
  const connues = [
    // les 10 campagnes de l'enveloppe reset-OFF (sommées à 63 min/j ci-dessus)
    'GMAIL_HISTO_BUDGET_JOUR_MS', 'CONSOLIDATION_BUDGET_JOUR_MS', 'CONSOLIDATION_EXEC_BUDGET_JOUR_MS',
    'SYNC_BUDGET_JOUR_MS', 'FUSION_EXEC_BUDGET_JOUR_MS', 'HISTORIQUE_VRAC_BUDGET_JOUR_MS',
    'MISSIONS_BUDGET_JOUR_MS', 'DOUBLONS_BUDGET_JOUR_MS', 'REANALYSE_BUDGET_JOUR_MS',
    'MEMOIRE_BUDGET_JOUR_MS', // C28-135 — et cet inventaire a fait EXACTEMENT son travail : il a
                              // rougi sur la constante neuve avant qu'elle n'échappe aux sommes.
    'AUDIT_PIECE_BUDGET_JOUR_MS', // C49-3 — il a re-rougi, et c'est la deuxième fois qu'il gagne.
    // les 4 phases du reset (invariant de réallocation reset-ON)
    'RESET_RASSEMBLEMENT_BUDGET_JOUR_MS', 'RESET_PLACEMENT_BUDGET_JOUR_MS',
    'RESET_04_BUDGET_JOUR_MS', 'RESET_LLM_BUDGET_JOUR_MS',
    // ⚠️ HORS des deux invariants, et c'est un TROU connu (backlog C28-101) : le pilote CI consomme
    // du runtime sur le même compte. Inoffensif UNIQUEMENT parce qu'il exige `RESET_ACTIF` (false) ;
    // reset rallumé, reset 50 + pilote 30 + doublons + vrac ≈ 85 min/j pour un mur à ~90.
    'PILOTE_BUDGET_JOUR_MS',
  ];
  const trouvees = Object.keys(C).filter((k) => /_BUDGET_JOUR_MS$/.test(k));
  const inconnues = trouvees.filter((k) => connues.indexOf(k) === -1);
  assert.deepStrictEqual(inconnues, [],
    'constante(s) de budget QUOTIDIEN hors inventaire : ' + inconnues.join(', ') + '. Classe-la : ' +
    'dans l\'enveloppe reset-OFF (et remonte la somme de 63), dans l\'invariant du reset, ou en ' +
    'exception documentée. Sans ça elle échappe aux deux tests et l\'enveloppe croît EN SILENCE.');
  const manquantes = connues.filter((k) => trouvees.indexOf(k) === -1);
  assert.deepStrictEqual(manquantes, [], 'constante(s) disparue(s) : ' + manquantes.join(', '));
});

test('orchestration MISSIONS : les 8 missions sont gatées par !resetEnCours_() ET le budget quotidien', () => {
  ['mission-vehicule', 'mission-logement', 'mission-dispatch-03', 'mission-ecoles-archives-06',
    'mission-paies', 'mission-carriere', 'mission-annees-02', 'mission-impots'].forEach((cle) => {
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
    !/gMissionsAmont03_/.test(gatesDe('mission-ecoles-archives-06')),
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

test('MARGE DE DÉMARRAGE : la re-datation reçoit un garde-temps de tick AMPUTÉ de la marge, jamais le nu', () => {
  // 🔴 revue quotas ADR-0056. Un sous-budget LOCAL ne peut pas protéger le TICK : la campagne
  // retranchait bien sa marge de SES 2 min, mais dès que l'amont a consommé 2 min c'est le
  // garde-temps du tick (`budgetMsRun_()` = 3 min) qui mord — et il n'en avait aucune. Un document
  // pris à 179 s de tick coûte encore 1 à 3 min : 179 + 180 + les écritures du `finally` franchissent
  // le mur DUR de 6 min, où l'exécution est TUÉE. Le `finally` ne tourne pas, les ms ne sont pas
  // imputées, et le MÊME document repart en tête au tick suivant — sans compteur pour l'arrêter.
  // Mutation prouvée : remettre `estBudgetDepasse` nu dans l'appel fait tomber ce test.
  assert.ok(/appliquerReanalyseCiblee_\(estBudgetDepasseDoc\)/.test(corps),
    'la re-datation doit recevoir le garde AMPUTÉ de la marge, jamais `estBudgetDepasse` nu');
  assert.ok(!/appliquerReanalyseCiblee_\(estBudgetDepasse\)/.test(corps),
    'le garde nu autoriserait un démarrage à 179 s de tick');
  // …et ce garde est bien le garde-temps du tick MOINS la marge, dérivé des constantes.
  const def = corps.slice(corps.indexOf('var estBudgetDepasseDoc'));
  assert.ok(/budgetMsRun_\(\) - CONFIG\.PILOTE_MARGE_DOC_MS/.test(def.slice(0, 260)),
    'la marge se RETRANCHE du budget de tick, elle ne se recopie pas en chiffre : ' + def.slice(0, 260));
  // Le garde amputé est RÉSERVÉ aux étapes qui lancent un document LLM complet : l'appliquer à
  // l'I/O pur amputerait des fenêtres qui n'en ont pas besoin (le recensement l'a déjà payé).
  assert.strictEqual((corps.match(/estBudgetDepasseDoc\)/g) || []).length, 1,
    'une seule étape le consomme aujourd\'hui — en ajouter une est une DÉCISION');
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
  //
  // ⚠️ La sonde ne cherche plus `JSON.stringify(etat)` mais le `setProperty` lui-même : la
  // sérialisation est passée dans une variable quand le garde de taille est arrivé (ADR-0057),
  // et la sonde littérale a alors échoué sur un code toujours CORRECT. Un test de structure
  // mérite d'être aussi peu couplé que possible à la façon d'écrire — sinon il crie à chaque
  // refactorisation et on prend l'habitude de le « réparer » sans lire ce qu'il affirme.
  const posMarqueur = src.indexOf("DriveAI_HUB_MAJ_MS', String(Date.now())");
  const posEcriture = src.indexOf("setProperty('DriveAI_HUB_SUMMARY'");
  assert.ok(posEcriture !== -1, 'l\'écriture du résumé doit rester repérable dans le source');
  assert.ok(posMarqueur > posEcriture,
    'le marqueur de fraîcheur doit être posé APRÈS l\'écriture du résumé');
});

test('ADR-0060 — chaque tag de mission appelé par Main.gs ou lu par Journal.gs EXISTE dans tableMissions_', () => {
  // 🔴 revue code : le bump `ecoles-archives06b` → `c` avait été fait dans `tableMissions_` mais pas
  // aux 4 sites d'appel — `executerMission_` rend en SILENCE sur un tag inconnu (`if (!spec) return`),
  // la mission `c` ne tournait jamais, et Progression continuait d'afficher l'ancienne « terminée ».
  // Le bump précédent (`06` → `06b`, 4d5694e) avait touché exactement ces lignes : c'est un patron.
  const missions = fs.readFileSync(path.join(__dirname, '..', 'src', 'Missions.gs'), 'utf8');
  const journal = fs.readFileSync(path.join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  const tags = new Set([...missions.matchAll(/^\s*tag: '([^']+)'/gm)].map((m) => m[1]));
  assert.ok(tags.size >= 8, 'tableMissions_ : ' + [...tags].join(', '));
  const appeles = [...src.matchAll(/executerMission_\('([^']+)'/g)].map((m) => m[1]);
  const pousses = [...journal.matchAll(/pousserMission\('[^']+', '([^']+)'\)/g)].map((m) => m[1]);
  const listeEtat = [...(journal.match(/\[('[^\]]+')\]\.forEach\(function \(tag\)/)[1].matchAll(/'([^']+)'/g))].map((m) => m[1]);
  const lus = [...journal.matchAll(/etat\.missions(?:\['([^']+)'\]|\.([a-zA-Z0-9]+))\.traites/g)].map((m) => m[1] || m[2]);
  for (const [ou, liste] of [['Main.gs executerMission_', appeles], ['Journal.gs pousserMission', pousses],
    ['Journal.gs liste des tags', listeEtat], ['Journal.gs etat.missions', lus]]) {
    assert.ok(liste.length >= 8, ou + ' : ' + liste.length + ' tags trouvés');
    const inconnus = liste.filter((tg) => !tags.has(tg));
    assert.deepStrictEqual(inconnus, [], ou + ' appelle un tag absent de tableMissions_ : ' + inconnus.join(', '));
  }
  // …et réciproquement : une mission de la table qui n'est appelée nulle part est une mission MORTE.
  const jamaisAppelees = [...tags].filter((tg) => appeles.indexOf(tg) === -1);
  assert.deepStrictEqual(jamaisAppelees, [], 'missions jamais appelées par le tick : ' + jamaisAppelees.join(', '));
});

/**
 * L'ORDRE prime sur les budgets (leçon §9, incident consolidation du 23/07 — re-payé le 16/09).
 *
 * Une étape placée en FIN de `finally` n'est pas « servie en dernier » : elle n'est **pas servie**,
 * parce que le budget TAIL est déjà consommé quand on l'atteint. L'envoi à la Mémoire était le
 * dernier de la file ; il n'a rien poussé pendant une heure alors que le tick tournait toutes les
 * 5 min et que le canal venait d'accepter 2 348 faits à la main. Ses deux anciennes voisines sont
 * MOINS pressées qu'elle : l'historique du vrac est une sweep une-fois-par-jour, la validation des
 * doublons est TERMINÉE (sa ligne de Santé le dit).
 *
 * Ce garde ancre le FAIT (« la Mémoire passe avant ces deux-là »), jamais la forme du bloc.
 */
test('ORDRE du finally : la Mémoire est servie AVANT le vrac et les doublons', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
  // On vise les APPELS (nom + argument), jamais le nom nu : les commentaires qui racontent cet
  // incident citent les trois fonctions, et un motif sur le nom seul les compterait.
  const pos = (appel) => {
    const m = src.match(new RegExp(appel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || [];
    assert.strictEqual(m.length, 1, 'appel attendu une seule fois : ' + appel);
    return src.indexOf(appel);
  };
  const memoire = pos('pousserInventaireMemoire_(estBudgetDepasseStandard)');
  const vrac = pos('majHistoriqueVrac_(estBudgetDepasseStandard)');
  const doublons = pos('majValidationDoublons_(estBudgetDepasseStandard)');
  assert.ok(memoire < vrac,
    'la Mémoire doit passer avant l\'historique du vrac (sweep quotidienne, aucune urgence)');
  assert.ok(memoire < doublons,
    'la Mémoire doit passer avant la validation des doublons (campagne TERMINÉE)');
});
