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

/** Contexte : les 4 phases mockées, verrou disponible, Properties en mémoire. */
function ctxPilote(opts) {
  opts = opts || {};
  const c = load(FICHIERS);
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
  // Chaque phase renvoie un résultat NON stérile une fois, puis stérile (convergence simulée).
  // `=== undefined`, jamais `||` : `{rondes: 0}` (cas « tout stérile ») doit valoir 0, pas le défaut.
  const restant = {
    rassemblerReset_: opts.rondes === undefined ? 1 : opts.rondes,
    placerReset_: 0, appliquerReset04Interne_: 0,
    analyserReliquatReset_: opts.rondesLlm === undefined ? 0 : opts.rondesLlm,
  };
  ['rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'analyserReliquatReset_'].forEach((nom) => {
    c[nom] = (garde, manuel) => {
      appels.push({ phase: nom, manuel: manuel, garde: typeof garde });
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
    const branche = webapp.slice(i, i + 220);
    assert.ok(/verifierSecretSync_\(e\)/.test(branche),
      motif + ' doit être gardée par le secret CI (DriveAI_SYNC_SECRET), jamais par DriveAI_WEBAPP_SECRET ' +
      'qui est exposé côté navigateur par conception');
    assert.ok(/erreur: 'refusé'/.test(branche), 'échec fermé si le secret ne correspond pas');
  });
});

/* ---------- 2. Mode `manuel` : c'est TOUT l'intérêt (hors quota déclencheurs) ---------- */

test('les 4 phases sont appelées en mode MANUEL (ni gatées, ni comptées) — sinon le pilote n\'apporte aucune vitesse', () => {
  const { c, appels } = ctxPilote({ rondes: 1 });
  const r = c.pousserResetPilote_();
  assert.strictEqual(r.ok, true);
  const phases = appels.filter((a) => a.phase !== 'erreur');
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
  assert.ok(/function analyserReliquatReset_\(estBudgetDepasse, manuel\)/.test(reset),
    'la passe LLM accepte le drapeau manuel (ADR-0032 §2.3)');
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

test('le verrou est TOUJOURS relâché, même si une phase lève (sinon le tick suivant est bloqué 6 min)', () => {
  const ctx = ctxPilote({});
  ctx.c.rassemblerReset_ = () => { throw new Error('Drive indisponible'); };
  const r = ctx.c.pousserResetPilote_();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(ctx.relachesRef(), 1, 'releaseLock dans le finally');
  assert.ok(ctx.appels.some((a) => a.phase === 'erreur'), 'l\'échec est journalisé, jamais silencieux');
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
  assert.strictEqual(appels.filter((a) => a.phase !== 'erreur').length, 4, 'exactement un tour des 4 phases');
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
