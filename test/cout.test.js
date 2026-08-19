'use strict';
/**
 * Coût LLM — `coutDollars_` (Cout.gs) : conversion pure tokens → dollars via CONFIG.LLM_PRIX
 * (prix par MILLION de tokens). Sert le suivi budget (< 10 $/mois) et l'onglet Santé.
 * + FREIN BUDGET des campagnes (R3, §2.6) : `budgetCampagnesAtteint_` met rangement/migration/
 * historique en pause quand le coût mensuel MESURÉ atteint CONFIG.LLM_BUDGET_CAMPAGNES —
 * le flux vivant (Gmail, dépôts, intentions, tri) n'est JAMAIS gaté par ce frein (vécu :
 * 15,62 $ le 7 juillet, budget §2.6 crevé par le rangement de masse nocturne).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Cout.gs']);
const M = 1e6;
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

test('coût nul', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0 }), 0);
});

test('prix unitaires par MTok (Haiku 1/5, Sonnet 3/15)', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: M, hout: 0, sin: 0, sout: 0 }), 1);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: M, sin: 0, sout: 0 }), 5);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: M, sout: 0 }), 3);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: M }), 15);
});

test('somme pondérée cohérente', () => {
  // 2 MTok in Haiku (2$) + 1 MTok out Haiku (5$) + 1 MTok in Sonnet (3$) = 10 $.
  assert.strictEqual(ctx.coutDollars_({ hin: 2 * M, hout: M, sin: M, sout: 0 }), 10);
});

test('proportionnel sous le million (pas d\'arrondi masquant)', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: 500000, hout: 0, sin: 0, sout: 0 }), 0.5);
});

test('coutDollarsDelta_ : différence de 2 relevés (dry-run C26-07, coût PAR document)', () => {
  const avant = { hin: 0, hout: 0, sin: 0, sout: 0 };
  const apres = { hin: 0, hout: 0, sin: M, sout: 0 }; // 1 MTok Sonnet in = 3 $
  assert.strictEqual(ctx.coutDollarsDelta_(avant, apres), 3);
  assert.strictEqual(ctx.coutDollarsDelta_(apres, apres), 0); // pas de progrès entre 2 relevés → 0
});

test('usageRunSnapshot_ : copie (jamais la référence), zéro si aucun run en cours', () => {
  const c = load(['Config.gs', 'Cout.gs']);
  assert.deepStrictEqual(plat(c.usageRunSnapshot_()),
    { hin: 0, hout: 0, hcw: 0, hcr: 0, sin: 0, sout: 0, scw: 0, scr: 0, appels: 0 });
  c.reinitialiserUsage_();
  c.enregistrerUsage_('claude-sonnet-4-6', { input_tokens: 100, output_tokens: 20 });
  const s1 = c.usageRunSnapshot_();
  assert.strictEqual(s1.sin, 100);
  c.enregistrerUsage_('claude-sonnet-4-6', { input_tokens: 900, output_tokens: 80 });
  assert.strictEqual(s1.sin, 100, 'le relevé pris AVANT le 2e appel ne doit pas bouger (copie)');
  assert.strictEqual(c.usageRunSnapshot_().sin, 1000);
});

// ---------------------------------------------------------------------------
// Prompt caching (Vague 3) : tokens de cache comptés au bon prix (×1,25 écriture, ×0,10 lecture)
// ---------------------------------------------------------------------------

test('coutDollars_ : prix cache par MTok (Sonnet cw 3,75 / cr 0,30 ; Haiku cw 1,25 / cr 0,10)', () => {
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0, scw: M }), 3.75);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0, scr: M }), 0.3);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0, hcw: M }), 1.25);
  assert.strictEqual(ctx.coutDollars_({ hin: 0, hout: 0, sin: 0, sout: 0, hcr: M }), 0.1);
  // Une lecture de cache est ~30× moins chère qu'un input Sonnet plein tarif (0,30 vs 3) — le gain visé.
  assert.ok(ctx.coutDollars_({ scr: M }) < ctx.coutDollars_({ sin: M }) / 9);
});

test('enregistrerUsage_ : ventile cache_creation / cache_read (Sonnet) — le budget ne les oublie pas', () => {
  const c = load(['Config.gs', 'Cout.gs']);
  c.reinitialiserUsage_();
  c.enregistrerUsage_('claude-sonnet-4-6', {
    input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 1500, cache_read_input_tokens: 0,
  });
  c.enregistrerUsage_('claude-sonnet-4-6', {
    input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500,
  });
  const s = c.usageRunSnapshot_();
  assert.strictEqual(s.scw, 1500, 'écriture de cache accumulée');
  assert.strictEqual(s.scr, 1500, 'lecture de cache accumulée');
  assert.strictEqual(s.sin, 400, 'input régulier (hors cache) séparé');
  // Coût = 400 in + 100 out + 1500 cw + 1500 cr (Sonnet), en $.
  const attendu = (400 * 3 + 100 * 15 + 1500 * 3.75 + 1500 * 0.3) / M;
  assert.ok(Math.abs(c.coutDollarsDelta_({ hin: 0, hout: 0, sin: 0, sout: 0, scw: 0, scr: 0 }, s) - attendu) < 1e-12);
});

test('lireCoutMois_ : un JSON d\'AVANT la Vague 3 (sans champs cache) ne corrompt pas le flush (NaN)', () => {
  const store = { };
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
  });
  // Ancien format : pas de hcw/hcr/scw/scr.
  store[c.cleCoutMois_()] = JSON.stringify({ hin: 100, hout: 20, sin: 300, sout: 40, appels: 2 });
  c.reinitialiserUsage_();
  c.enregistrerUsage_('claude-sonnet-4-6', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1000 });
  c.flushUsage_();
  const t = JSON.parse(store[c.cleCoutMois_()]);
  assert.strictEqual(t.sin, 310);
  assert.strictEqual(t.scr, 1000, 'la lecture cache s\'ajoute proprement (pas de NaN sur un ancien total)');
  assert.ok(Number.isFinite(c.coutDollars_(t)), 'coût fini (aucun NaN propagé)');
});

// ---------------------------------------------------------------------------
// budgetCampagnesAtteint_ (frein des campagnes, R3)
// ---------------------------------------------------------------------------

/**
 * Contexte avec Script Properties EN MÉMOIRE. `deltaDollars` positionne le coût du mois PAR
 * RAPPORT au seuil CONFIG.LLM_BUDGET_CAMPAGNES (les tests restent vrais si Marc rajuste le
 * plafond — vécu : 10 → 30 le 07-07, les tests codés « 16 $ ≥ 10 » auraient menti).
 */
function ctxFrein(deltaDollars) {
  const store = {};
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
      }),
    },
  });
  const poserCout = (delta) => {
    // haiku_in = 1 $/MTok → dollars × 1e6 tokens.
    const hin = Math.max(0, (c.CONFIG.LLM_BUDGET_CAMPAGNES + delta)) * 1e6;
    store[c.cleCoutMois_()] = JSON.stringify({ hin, hout: 0, sin: 0, sout: 0, appels: 1 });
  };
  if (deltaDollars != null) poserCout(deltaDollars);
  return { c, store, poserCout };
}

test('frein : sous le budget → false, aucun journal', () => {
  const { c } = ctxFrein(-1); // seuil − 1 $
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  assert.strictEqual(c.__logs.length, 0);
});

test('frein : budget atteint → true + journalisé UNE seule fois par mois', () => {
  const { c, store } = ctxFrein(+6); // seuil + 6 $
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  const infos = c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout');
  assert.strictEqual(infos.length, 1, 'enclenchement journalisé');
  assert.strictEqual(store.DriveAI_FREIN_BUDGET,
    c.cleCoutMois_() + '|' + c.CONFIG.LLM_BUDGET_CAMPAGNES,
    'mémoire « déjà signalé ce mois, à ce seuil »');

  // Run suivant (cache remis à zéro) : toujours freiné, mais PAS de nouvelle ligne de journal.
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  assert.strictEqual(c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout').length, 1);
});

test('frein : plafond RELEVÉ en cours de mois → campagnes reprennent ; re-déclenché plus haut → re-annoncé', () => {
  // Le scénario réel du 07-07 : frein posé à 10 $, Marc dit « continue le tri au complet ».
  const { c, store, poserCout } = ctxFrein(+2); // au-dessus du seuil courant
  assert.strictEqual(c.budgetCampagnesAtteint_(), true);
  const seuilInitial = c.CONFIG.LLM_BUDGET_CAMPAGNES;

  c.CONFIG.LLM_BUDGET_CAMPAGNES = seuilInitial + 20; // Marc relève le plafond
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), false, 'les campagnes reprennent au tick suivant');

  poserCout(+1); // le coût finit par atteindre le NOUVEAU plafond (relatif au seuil courant)
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 're-freiné au nouveau niveau');
  assert.strictEqual(c.__logs.filter(([niv, src]) => niv === 'INFO' && src === 'Cout').length, 2,
    'la re-pause au seuil relevé est RE-annoncée (jamais silencieuse)');
});

test('frein : lu au plus 1×/run (cache) — pas une lecture Properties par campagne', () => {
  const { c, poserCout } = ctxFrein(-1);
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
  // Le coût explose ENTRE deux appels du même run : la valeur cachée reste servie.
  poserCout(+99);
  assert.strictEqual(c.budgetCampagnesAtteint_(), false, 'même run → valeur du cache');
  c.reinitialiserFreinBudget_();
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 'run suivant → relu');
});

test('frein : Properties illisibles → false (une panne d\'état ne bloque jamais les campagnes)', () => {
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: { getScriptProperties: () => { throw new Error('indisponible (simulé)'); } },
  });
  assert.strictEqual(c.budgetCampagnesAtteint_(), false);
});

test('frein : une panne de JOURNALISATION ne relève pas un frein correctement mesuré', () => {
  const { c } = ctxFrein(16e6); // 16 $ ≥ 10
  c.journalInfo_ = () => { throw new Error('journal indisponible (simulé)'); };
  assert.strictEqual(c.budgetCampagnesAtteint_(), true, 'la mesure prime sur l\'annonce');
});

// ---------------------------------------------------------------------------
// syntheseCoutTotal_ — le cumul depuis toujours (publié au hub comme `cost.period = "total"`)
// ---------------------------------------------------------------------------

/**
 * Contexte avec un magasin de Script Properties EN MÉMOIRE et `getProperties()` (l'appel en
 * bloc), plus un compteur d'appels : le cumul tourne à CHAQUE rafraîchissement du résumé du hub,
 * donc il ne doit jamais dégénérer en N lectures unitaires (le quota Properties est une
 * ressource rare).
 */
function ctxCumul(store) {
  let appelsGetProperties = 0;
  const c = load(['Config.gs', 'Cout.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
        getProperties: () => { appelsGetProperties += 1; return Object.assign({}, store); },
      }),
    },
  });
  return { c, store, appels: () => appelsGetProperties };
}

/** 1 MTok Haiku in = 1 $ (haiku_in = 1 $/MTok) — le mois « vaut » exactement `dollars`. */
const moisDe = (dollars) =>
  JSON.stringify({ hin: dollars * 1e6, hout: 0, sin: 0, sout: 0, appels: 1 });

test('cumul : somme TOUS les mois, pas seulement le courant', () => {
  const { c } = ctxCumul({
    'DriveAI_COUT_2026-06': moisDe(3),
    'DriveAI_COUT_2026-07': moisDe(4),
    'DriveAI_COUT_2026-08': moisDe(5),
  });
  const s = c.syntheseCoutTotal_();
  assert.strictEqual(s.dollars, 12, '3 + 4 + 5 — un cumul qui ne rendrait que 5 serait le mois courant');
  assert.strictEqual(s.mois, 3);
  assert.strictEqual(s.ignores, 0);
});

test('cumul : aucun mois comptabilisé → 0 $ sur 0 mois (jamais NaN)', () => {
  const { c } = ctxCumul({});
  assert.deepStrictEqual(plat(c.syntheseCoutTotal_()), { dollars: 0, mois: 0, ignores: 0 });
});

test('cumul : ignore les Properties qui ne sont PAS de la comptabilité de coût', () => {
  // Le magasin est partagé par tout le moteur (frein budget, curseurs, verrous…). Sans le
  // filtre de préfixe, `JSON.parse` d'un curseur produirait soit une exception comptée en
  // `ignores`, soit — pire — un objet dont les champs manquants passeraient à 0 et gonfleraient
  // `mois` d'un mois qui n'a jamais existé.
  const { c } = ctxCumul({
    'DriveAI_COUT_2026-08': moisDe(7),
    DriveAI_FREIN_BUDGET: 'DriveAI_COUT_2026-08|10',
    DriveAI_CURSEUR: '{"hin":999000000}',
    autre_chose: 'peu importe',
  });
  const s = c.syntheseCoutTotal_();
  assert.strictEqual(s.dollars, 7, 'seules les clés DriveAI_COUT_* comptent');
  assert.strictEqual(s.mois, 1);
  assert.strictEqual(s.ignores, 0, 'ce qui est hors préfixe est écarté AVANT le parse, pas compté comme illisible');
});

test('cumul : un mois corrompu est COMPTÉ comme ignoré, jamais traité en zéro silencieux', () => {
  const { c } = ctxCumul({
    'DriveAI_COUT_2026-07': moisDe(4),
    'DriveAI_COUT_2026-08': '{ceci n\'est pas du JSON',
  });
  const s = c.syntheseCoutTotal_();
  assert.strictEqual(s.dollars, 4);
  assert.strictEqual(s.mois, 1);
  assert.strictEqual(s.ignores, 1, 'un cumul discrètement amputé serait pire qu\'une erreur visible');
});

test('cumul : un mois d\'AVANT la Vague 3 (sans champs cache) ne propage pas de NaN', () => {
  // `undefined + nombre` = NaN, et un seul NaN empoisonnerait TOUT le cumul — pas seulement
  // le mois concerné. C'est la même garde que `coutDollars_`, vérifiée au niveau du cumul.
  const { c } = ctxCumul({
    'DriveAI_COUT_2026-05': JSON.stringify({ hin: 2e6, hout: 0, sin: 0, sout: 0, appels: 1 }),
    'DriveAI_COUT_2026-08': moisDe(1),
  });
  const s = c.syntheseCoutTotal_();
  assert.ok(Number.isFinite(s.dollars), 'cumul fini');
  assert.strictEqual(s.dollars, 3);
});

test('cumul : UN SEUL getProperties(), pas une lecture par mois', () => {
  const store = {};
  for (let i = 1; i <= 12; i += 1) store['DriveAI_COUT_2026-' + String(i).padStart(2, '0')] = moisDe(1);
  const { c, appels } = ctxCumul(store);
  assert.strictEqual(c.syntheseCoutTotal_().dollars, 12);
  assert.strictEqual(appels(), 1, '12 mois → 1 seul appel (quota Properties)');
});

test('cumul ⊇ mois : la clé du mois courant est bien dans le périmètre du cumul', () => {
  // Le verrou anti-dérive : si `cleCoutMois_` cessait de dériver de PREFIXE_COUT, le mois
  // courant sortirait silencieusement du cumul — le total baisserait sans que rien n'échoue.
  const { c, store } = ctxCumul({});
  store[c.cleCoutMois_()] = moisDe(6);
  assert.strictEqual(c.syntheseCoutTotal_().dollars, 6);
  assert.strictEqual(c.syntheseCoutMois_().dollars, 6);
});
