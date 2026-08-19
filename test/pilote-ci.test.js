'use strict';
/**
 * PILOTE CI (ADR-0032, C28-43) — « plus jamais lancer à la main, et plus vite que le manuel ».
 *
 * Ce que ces tests verrouillent, dans l'ordre du risque :
 *  1. le pilote ne doit JAMAIS passer par un chemin qui CRÉE un déclencheur (sinon il consomme le
 *     quota ~90 min/j qu'il est censé contourner → gel de TOUS les déclencheurs, C28-29) ;
 *  2. il tourne en mode `manuel` (ni gaté, ni compté) — sinon il est bridé par les budgets du tick
 *     et n'apporte AUCUNE vitesse, et pire, il affamerait l'automatique (double peine C28-33) ;
 *  3. il s'arrête sur la VRAIE convergence (reliquat LLM compris), pas sur `resetTermine_()` seul ;
 *  4. il ne tourne jamais en parallèle d'un tick (verrou), et il est arrêtable par un flag ;
 *  5. la pause CI reste > TICK_MINUTES : c'est ce qui garantit que le flux vivant n'est pas affamé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const FICHIERS = ['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs'];
const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const PHASES = ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_'];
/** Seulement les appels de PHASE (le contexte web app en pousse d'autres : usage, panne…). */
const phasesDe = (appels) => appels.filter((a) => PHASES.indexOf(a.phase) !== -1);

/** Contexte : les 4 phases mockées, verrou disponible, Properties en mémoire. */
function ctxPilote(opts) {
  opts = opts || {};
  const c = load(FICHIERS);
  // RESET_ACTIF FORCÉ dans le contexte (leçon §7 : un test d'un chemin gaté par un flag de campagne
  // FORCE ce flag ; la valeur GLOBALE — retirée à false 2026-08-05, ADR-0035 — est une décision de
  // Marc, jamais un invariant de test). Le test « refus si RESET_ACTIF=false » le remet à false lui-même.
  c.CONFIG.RESET_ACTIF = true;
  const appels = [];
  const props = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  let relaches = 0;
  c.LockService = { getScriptLock: () => ({
    tryLock: () => !opts.verrouOccupe,
    releaseLock: () => { relaches++; },
  }) };
  c.journalInfo_ = () => {};
  c.journalErreur_ = (s, m) => appels.push({ phase: 'erreur', message: m });
  c.notifierEchec_ = (s, m) => appels.push({ phase: 'alerte', message: m });
  c.dateGmail_ = () => '2026/07/31'; // vit dans Gmail.gs (non chargé)
  // Contexte d'exécution web app : compteur d'usage propre + panne plateforme (patron WebApp.gs).
  c.chargerPannePlateforme_ = () => { appels.push({ phase: 'chargerPanne' }); };
  c.reinitialiserUsage_ = () => { appels.push({ phase: 'initUsage' }); };
  c.flushUsage_ = () => { appels.push({ phase: 'flushUsage' }); };
  c.marquerVieManuelleReset_ = () => { appels.push({ phase: 'LAST_MANUEL' }); };
  // Chaque phase renvoie un résultat NON stérile une fois, puis stérile (convergence simulée).
  // `=== undefined`, jamais `||` : `{rondes: 0}` (cas « tout stérile ») doit valoir 0, pas le défaut.
  const restant = {
    rassemblerReset_: opts.rondes === undefined ? 1 : opts.rondes,
    placerReset_: 0, appliquerReset04Interne_: 0,
    analyserReliquatReset_: opts.rondesLlm === undefined ? 0 : opts.rondesLlm,
  };
  ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_'].forEach((nom) => {
    // Le mock lit ses ARGUMENTS (jamais une fermeture) — sinon deux appels d'une même passe
    // seraient indiscernables (leçon C28-33 sur les mocks partagés).
    c[nom] = (garde, manuel, tentes) => {
      appels.push({ phase: nom, manuel: manuel, garde: typeof garde, tentes: tentes });
      if (restant[nom] > 0) { restant[nom]--; return { examines: 1, deplaces: 1 }; }
      return { examines: 0, deplaces: 0 };
    };
  });
  c.resetTermine_ = () => !!opts.resetTermine;
  return { c, appels, props, relachesRef: () => relaches };
}

/* ---------- 1. Le pilote ne crée JAMAIS de déclencheur (le quota qu'il contourne) ---------- */

test('SÛRETÉ QUOTA : l\'action « pousser-reset » exécute le travail SYNCHRONEMENT — jamais via actionTickPonctuel_ (qui CRÉE un déclencheur)', () => {
  const webapp = SRC('WebApp.gs');
  const i = webapp.indexOf("action === 'pousser-reset'");
  assert.ok(i !== -1, 'branche pousser-reset introuvable dans le doPost');
  const branche = webapp.slice(i, i + 220);
  assert.ok(/pousserResetPilote_\(\)/.test(branche),
    'la branche doit appeler directement le noyau synchrone');
  assert.ok(!/actionTickPonctuel_|newTrigger/.test(branche),
    'JAMAIS de création de déclencheur : ScriptApp.newTrigger consommerait le quota ~90 min/j que ' +
    'tout ce montage protège — le pilote deviendrait la cause du gel qu\'il évite (C28-29)');
  // Et le noyau lui-même ne crée aucun déclencheur.
  const reset = SRC('Reset.gs');
  const j = reset.indexOf('function pousserResetPilote_(');
  const corps = reset.slice(j, reset.indexOf('\n}', j));
  assert.ok(!/newTrigger|ScriptApp\./.test(corps), 'le noyau du pilote ne touche à aucun déclencheur');
});

test('SÛRETÉ SECRET : « pousser-reset » et « assurer-trigger » exigent le secret CI DÉDIÉ (jamais celui exposé au navigateur)', () => {
  const webapp = SRC('WebApp.gs');
  ["action === 'pousser-reset'", "action === 'assurer-trigger'"].forEach((motif) => {
    const i = webapp.indexOf(motif);
    assert.ok(i !== -1, motif + ' introuvable');
    const branche = webapp.slice(i, i + 500);
    assert.ok(/verifierSecretSync_\(e\)/.test(branche),
      motif + ' doit être gardée par le secret CI (DriveAI_SYNC_SECRET), jamais par DriveAI_WEBAPP_SECRET ' +
      'qui est exposé côté navigateur par conception');
    assert.ok(/erreur: 'refusé'/.test(branche), 'échec fermé si le secret ne correspond pas');
    assert.ok(/antiRafalePilote_\(/.test(branche),
      'anti-rafale OBLIGATOIRE : l\'en-tête du fichier le promet pour toute action, et sans lui ' +
      '`assurer-trigger` rappelé plus vite que TICK_MINUTES empêcherait le tick de jamais se déclencher');
  });
});

/* ---------- 2. Mode `manuel` : c'est TOUT l'intérêt (hors quota déclencheurs) ---------- */

test('les 4 phases sont appelées en mode MANUEL (ni gatées, ni comptées) — sinon le pilote n\'apporte aucune vitesse', () => {
  const { c, appels } = ctxPilote({ rondes: 1 });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.ok, true);
  const phases = phasesDe(appels);
  assert.ok(phases.length >= 4, 'les 4 phases doivent être servies (round-robin), vu : ' + phases.length);
  phases.forEach((a) => {
    assert.strictEqual(a.manuel, true,
      a.phase + ' doit recevoir manuel=true : les budgets QUOTIDIENS protègent le quota des ' +
      'DÉCLENCHEURS, dont la web app ne fait pas partie. Sans ce drapeau, le pilote serait bridé ET ' +
      'consommerait le budget du tick (double peine C28-33)');
    assert.strictEqual(a.garde, 'function', a.phase + ' doit recevoir un garde-temps (part du mur)');
  });
  assert.ok(['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_']
    .every((n) => phases.some((a) => a.phase === n)), 'la passe LLM du reliquat fait partie du pilotage (ADR-0032 §2.3)');
});

test('analyserReliquatReset_ en mode manuel : ni gatée par le budget quotidien, ni comptée dedans (mais plafond d\'items CONSERVÉ)', () => {
  const reset = SRC('Reset.gs');
  const i = reset.indexOf('function analyserReliquatReset_(');
  const corps = reset.slice(i, reset.indexOf('\n}\n', i));
  assert.ok(/function analyserReliquatReset_\(estBudgetDepasse, manuel, tentes\)/.test(reset),
    'la passe LLM accepte le drapeau manuel ET la mémoire des documents tentés (ADR-0032 §2.3)');
  assert.ok(/if \(!manuel && consommeJour >= CONFIG\.RESET_LLM_BUDGET_JOUR_MS\)/.test(corps),
    'gate quotidien coupé en manuel');
  assert.ok(/if \(!manuel\) props\.setProperty\('DriveAI_RESET_LLM_JOUR'/.test(corps),
    'comptage quotidien coupé en manuel — sinon le pilote affamerait le tick automatique (leçon C28-33 : ' +
    'les deux moitiés du drapeau, gate ET comptage, se coupent ENSEMBLE)');
  // Le coût $ reste borné par le plafond d'items, lui JAMAIS conditionné par `manuel`.
  const page = reset.slice(reset.indexOf('function analyserPageReliquatReset_('));
  assert.ok(/CONFIG\.RESET_LLM_MAX_PAR_RUN/.test(page.slice(0, page.indexOf('\n}\n'))),
    'le plafond d\'items borne le coût de CHAQUE passe, y compris poussée');
  assert.ok(!/manuel/.test(page.slice(0, page.indexOf('\n}\n'))),
    'le plafond d\'items ne doit JAMAIS être levé par le mode manuel (c\'est lui qui borne les $)');
});

/* ---------- 3. Arrêt sur la VRAIE convergence ---------- */

test('pilotageTermineReset_ exige AUSSI le drainage du reliquat LLM — s\'arrêter sur resetTermine_ seul laisserait les « Inconnu » au ralenti', () => {
  const c0 = load(FICHIERS);
  const fin = c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION;

  // I/O terminé mais reliquat NON drainé → le pilote continue.
  const partiel = ctxPilote({ resetTermine: true });
  assert.strictEqual(partiel.c.pilotageTermineReset_(), false);
  const r1 = partiel.c.pousserResetPilote_();
  assert.strictEqual(r1.termine, false, 'ne jamais déclarer « terminé » tant que le reliquat n\'est pas drainé');

  // I/O terminé ET reliquat drainé → terminé, et AUCUNE phase n'est même appelée.
  const fini = ctxPilote({ resetTermine: true, props: { DriveAI_RESET_LLM: fin } });
  const r2 = fini.c.pousserResetPilote_();
  assert.strictEqual(r2.termine, true);
  assert.strictEqual(fini.appels.length, 0, 'convergence ⇒ court-circuit total (coût nul pour les runs suivants)');
});

/* ---------- 4. Verrou, interrupteur, robustesse ---------- */

test('anti-chevauchement : si le tick tient le verrou, la passe est SAUTÉE proprement (jamais deux mutations en parallèle)', () => {
  const { c, appels } = ctxPilote({ verrouOccupe: true });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.ok, true, 'ce n\'est pas une erreur : le tick fait déjà le travail');
  assert.strictEqual(r.rondes, 0);
  assert.strictEqual(appels.length, 0, 'aucune phase ne tourne sans le verrou');
});

test('le verrou est TOUJOURS relâché, même sur une exception HORS phase (sinon le tick suivant est bloqué 6 min)', () => {
  const ctx = ctxPilote({});
  // Une exception dans une PHASE est désormais isolée (test dédié plus bas) : on éprouve ici le
  // `finally` du noyau avec un échec qui n'est PAS enveloppé par phase().
  ctx.c.journalInfo_ = () => { throw new Error('Journal indisponible'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(ctx.relachesRef(), 1, 'releaseLock dans le finally');
  assert.ok(ctx.appels.some((a) => a.phase === 'erreur'), 'l\'échec est journalisé, jamais silencieux');
  assert.ok(ctx.appels.some((a) => a.phase === 'flushUsage'), 'le coût déjà engagé est tout de même persisté');
});

test('interrupteur : PILOTE_ACTIF=false ou RESET_ACTIF=false ⇒ refus IMMÉDIAT, zéro phase, zéro verrou', () => {
  const sansPilote = ctxPilote({});
  sansPilote.c.CONFIG.PILOTE_ACTIF = false;
  const r1 = sansPilote.c.pousserResetPilote_();
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(sansPilote.appels.length, 0);

  const sansReset = ctxPilote({});
  sansReset.c.CONFIG.RESET_ACTIF = false;
  const r2 = sansReset.c.pousserResetPilote_();
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(sansReset.appels.length, 0);
});

test('une ronde entièrement stérile ARRÊTE la boucle (jamais de spin qui re-scanne le Drive jusqu\'au mur)', () => {
  const { c, appels } = ctxPilote({ rondes: 0 }); // toutes les phases stériles d'emblée
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.rondes, 1, 'une seule ronde, puis sortie');
  assert.strictEqual(r.progres, false);
  assert.strictEqual(phasesDe(appels).length, 4, 'exactement un tour des 4 phases');
});

/* ---------- 6. Correctifs de la revue flotte C28-43 (chaque bloquant a son verrou) ---------- */

test('BLOQUANT sécurité : le coût LLM d\'une passe poussée est COMPTÉ (sinon le frein budget §2.6 est aveugle sur le chemin dominant)', () => {
  const { c, appels } = ctxPilote({ rondes: 1 });
  c.pousserResetPilote_();
  const noms = appels.map((a) => a.phase);
  assert.ok(noms.includes('initUsage'),
    'contexte web app ≠ tick : sans reinitialiserUsage_, l\'accumulateur reste null et AUCUNE dépense n\'est comptée');
  assert.ok(noms.includes('flushUsage'), 'le coût doit être persisté en fin de passe (finally)');
  assert.ok(noms.indexOf('initUsage') < noms.indexOf('rassemblerReset_'), 'initialisé AVANT tout travail');
  assert.ok(noms.includes('chargerPanne'),
    'sans chargerPannePlateforme_, la suspension persistée est ignorée → re-sondes en boucle pendant une panne de compte');
});

test('BLOQUANT sécurité : une passe poussée n\'écrit JAMAIS DriveAI_LAST_MANUEL (sinon le chien de garde est muet toute la campagne)', () => {
  const { c, appels, props } = ctxPilote({ rondes: 1 });
  c.pousserResetPilote_();
  assert.ok(!appels.some((a) => a.phase === 'LAST_MANUEL'),
    'le pilote tourne toutes les ~7 min pendant des jours : rafraîchir le signal de vie manuel rendrait ' +
    'l\'alerte ET l\'auto-réparation mortes pendant toute la campagne — exactement le scénario à voir');
  assert.strictEqual(props.DriveAI_LAST_MANUEL, undefined);
});

test('détecteur de GEL : ticks silencieux ⇒ passe REFUSÉE + alerte (le pilote signale le gel au lieu de le masquer)', () => {
  const c0 = load(FICHIERS);
  const vieux = String(Date.now() - (c0.CONFIG.WATCHDOG_SEUIL_MS + 60000));
  const { c, appels } = ctxPilote({ rondes: 1, props: { DriveAI_LAST_TICK: vieux } });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.gel, true);
  assert.strictEqual(r.rondes, 0);
  assert.ok(!appels.some((a) => a.phase === 'rassemblerReset_'), 'aucun travail : le flux vivant prime sur le rangement');
  assert.ok(appels.some((a) => a.phase === 'alerte'), 'une alerte part (canal mail, indépendant des déclencheurs)');

  // Tick frais → la passe tourne normalement ; première installation (pas de LAST_TICK) → jamais bloquée.
  const frais = ctxPilote({ rondes: 1, props: { DriveAI_LAST_TICK: String(Date.now()) } });
  assert.notStrictEqual(frais.c.pousserResetPilote_().gel, true);
  const neuf = ctxPilote({ rondes: 1 });
  assert.notStrictEqual(neuf.c.pousserResetPilote_().gel, true);
});

test('BORNE DU PARI : budget QUOTIDIEN en ms réelles — épuisé ⇒ aucune passe, et la consommation est persistée', () => {
  const c0 = load(FICHIERS);
  const epuise = ctxPilote({ rondes: 1, props: { DriveAI_PILOTE_JOUR: '2026/07/31|' + c0.CONFIG.PILOTE_BUDGET_JOUR_MS } });
  const r = epuise.c.pousserResetPilote_();
  assert.strictEqual(r.rondes, 0);
  assert.ok(!epuise.appels.some((a) => a.phase === 'rassemblerReset_'),
    'si le pari « web app hors quota » est faux, cette borne est tout ce qui empêche le gel');

  const actif = ctxPilote({ rondes: 1 });
  actif.c.pousserResetPilote_();
  assert.ok(String(actif.props.DriveAI_PILOTE_JOUR || '').indexOf('2026/07/31|') === 0,
    'ms réelles persistées — c\'est aussi la MESURE qui permettra de trancher le pari');
});

test('quarantaine : un document du reliquat n\'est tenté qu\'UNE fois par exécution (3 essais en 2 min = perte définitive)', () => {
  const { c, appels } = ctxPilote({ rondes: 3, rondesLlm: 3 });
  c.pousserResetPilote_();
  const llm = appels.filter((a) => a.phase === 'analyserReliquatReset_');
  assert.ok(llm.length >= 2, 'plusieurs rondes ont bien appelé la phase LLM');
  llm.forEach((a) => assert.ok(a.tentes && typeof a.tentes === 'object',
    'la mémoire des documents tentés doit être passée à CHAQUE appel : sans elle, la même exécution ' +
    'rejoue le même fichier et brûle ses 3 essais sur un blip transitoire → quarantaine sans retour'));
  assert.strictEqual(llm[0].tentes, llm[1].tentes, 'la MÊME mémoire est partagée par les rondes d\'une passe');
});

test('anti-stagnation : après PILOTE_STERILES_MAX passes sans progrès ⇒ alerte + veille (jamais 192 walks/jour pour rien)', () => {
  const c0 = load(FICHIERS);
  const MAX = c0.CONFIG.PILOTE_STERILES_MAX;
  const { c, appels, props } = ctxPilote({ rondes: 0, props: { DriveAI_PILOTE_STERILES: String(MAX - 1) } });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.stagnation, true, 'le workflow doit pouvoir arrêter d\'insister');
  assert.ok(appels.some((a) => a.phase === 'alerte'), 'Marc est prévenu que le rangement est bloqué');

  // Une passe qui PROGRESSE remet le compteur à zéro (le gate se teste par sa LIBÉRATION).
  const repart = ctxPilote({ rondes: 1, props: { DriveAI_PILOTE_STERILES: String(MAX - 1) } });
  assert.strictEqual(repart.c.pousserResetPilote_().stagnation, false);
  assert.strictEqual(repart.props.DriveAI_PILOTE_STERILES, undefined, 'compteur remis à zéro');
});

test('isolation : une phase qui lève ne tue pas les autres (leçon « étape secondaire enveloppée »)', () => {
  const ctx = ctxPilote({ rondes: 1 });
  ctx.c.rassemblerReset_ = () => { throw new Error('blip Sheet'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, true, 'la passe survit à l\'échec d\'UNE phase');
  assert.ok(ctx.appels.some((a) => a.phase === 'placerReset_'), 'les phases suivantes tournent quand même');
  assert.ok(r.echecs >= 1, 'l\'échec est compté et journalisé');
  assert.strictEqual(ctx.relachesRef(), 1, 'verrou relâché');
});

test('la réponse renvoyée à la CI (log PUBLIC) ne porte JAMAIS le détail d\'une exception', () => {
  const ctx = ctxPilote({ rondes: 1 });
  ctx.c.journalInfo_ = () => { throw new Error('Fichier « Passeport Marc 2019.pdf » illisible'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, false);
  assert.ok(!/Passeport/.test(JSON.stringify(r)),
    'le dépôt est PUBLIC : le détail (noms de fichiers) reste au Journal privé');
  assert.ok(!('erreur' in r), 'pas de champ `erreur` sur un échec TRANSITOIRE — sinon la CI le croit permanent et abandonne');
});

/* ---------- 5. Bornes CI : la fenêtre du tick est ce qui protège le flux vivant ---------- */

test('workflow : la PAUSE entre deux passes reste > TICK_MINUTES — c\'est la garantie que le flux vivant n\'est pas affamé', () => {
  const c = load(['Config.gs']);
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pousser-reset.yml'), 'utf8');
  const pause = Number((/PAUSE_S:\s*'(\d+)'/.exec(wf) || [])[1]);
  assert.ok(pause > 0, 'PAUSE_S introuvable dans le workflow');
  assert.ok(pause > c.CONFIG.TICK_MINUTES * 60,
    'la pause (' + pause + ' s) doit dépasser un intervalle de tick (' + c.CONFIG.TICK_MINUTES * 60 + ' s) : ' +
    'une passe tient le verrou ~3,5 min, donc sans cette fenêtre le tick serait sauté à CHAQUE fois et ' +
    'les mails/dépôts de Marc ne seraient plus traités pendant des heures');
  // Le mur d'une passe doit rester sous la pause ET sous le mur HTTP.
  assert.ok(c.CONFIG.PILOTE_BUDGET_MS < pause * 1000, 'une passe doit finir avant la fin de la pause suivante');
  assert.ok(c.CONFIG.PILOTE_BUDGET_MS < c.CONFIG.BUDGET_MS,
    'le mur du pilote reste sous celui d\'une exécution manuelle (marge pour que la réponse HTTP reparte)');
});

test('workflow : succès jugé au CONTENU (ok:true), pas au code HTTP ; et jamais `-X POST` avec `-L`', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pousser-reset.yml'), 'utf8');
  // Le tripwire porte sur le CODE EXÉCUTÉ, pas sur la doc : les commentaires CITENT `-X POST`
  // justement pour expliquer pourquoi il est interdit (une version naïve de ce test échouait sur
  // sa propre explication — un tripwire qui attrape sa documentation ne prouve rien).
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(/jq -e '\.ok == true'/.test(code),
    'un 200 peut porter une page HTML d\'erreur Apps Script — le seul critère fiable est le JSON');
  assert.ok(!/-X POST/.test(code),
    '`-X POST` verrouille la méthode sur la redirection /macros/echo (HEAD/GET seulement) → 405 systématique');
  assert.ok(/jq -rn --arg s "\$SECRET" '\$s\|@uri'/.test(wf), 'le secret est encodé URL (il peut contenir & ou =)');
  assert.ok(!/echo .*\$SECRET[^_]/.test(wf), 'le secret n\'est JAMAIS affiché dans un log CI public');
  assert.ok(/termine == true/.test(wf), 'le pilote doit s\'arrêter seul à la convergence');
});

test('deploy.yml : le déclencheur est réinstallé APRÈS le redéploiement de la web app, et confirmé par un SIGNAL INDÉPENDANT', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  const posDeploy = wf.indexOf('clasp deploy -i');
  const posTrigger = wf.indexOf('action=assurer-trigger');
  assert.ok(posDeploy !== -1 && posTrigger !== -1, 'étapes introuvables');
  assert.ok(posDeploy < posTrigger,
    'la web app doit être redéployée AVANT l\'appel, sinon /exec sert une version qui ignore l\'action');
  assert.ok(/\.version \| type == "string"/.test(wf),
    'confirmation par un champ que SEULE la nouvelle version renvoie — un `ok:true` nu ne prouve rien ' +
    '(l\'action inconnue tombe dans le `else` du doPost et « réussit » en silence, piège (4))');
  assert.ok(/continue-on-error: true/.test(wf), 'ne jamais faire échouer un déploiement réussi sur ce confort');
});

/* ---------- C28-58 : le pilote est du travail AUTOMATIQUE, pas « une demande de Marc » ---------- */

test('pousserResetPilote_ : son coût LLM porte sa propre clé, jamais l\'étiquette `app:` du doPost', () => {
  // `doPost` étiquette la requête `app:pousser-reset` (famille « demandes de Marc »). Or les
  // phases du pilote ne passent par AUCUN `etapeSuivie_` : sans marquage explicite, tout le coût
  // du rangement lancé par la CI atterrissait dans `app:*` — et docs/COUTS.md enseigne
  // littéralement l'inverse (« si les postes app:* dominent, c'est le chat qui coûte »).
  const c = load([...FICHIERS, 'Suivi.gs']);
  c.CONFIG.PILOTE_ACTIF = false; // sortie immédiate : on teste le MARQUAGE, pas le rangement
  c.poserOperationCourante_('app:pousser-reset'); // ce que doPost vient de poser
  c.pousserResetPilote_();
  assert.strictEqual(c.operationCourante_(), 'reset-pilote',
    'le pilote se nomme lui-même — sinon son coût est imputé aux demandes de Marc');
});
