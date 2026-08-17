'use strict';
/**
 * suivi-couverture.test.js — TRIPWIRE de couverture bidirectionnel du suivi générique
 * (C28-44 PR2, ADR-0038) : chaque étape wrappée `etapeSuivie_` dans Main.gs a son entrée au
 * REGISTRE_OPERATIONS (Suivi.gs), et RÉCIPROQUEMENT — une étape ajoutée au tick sans entrée au
 * registre (ou l'inverse) casse ICI, jamais en silence. Analyse du SOURCE de Main.gs (comme les
 * autres tripwires du projet : deux artefacts qui doivent bouger ensemble se verrouillent par un
 * test, pas par la discipline — leçon §7).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'Main.gs'), 'utf8');
const clesRegistre = load(['Suivi.gs']).clesRegistreSuivi_();

/** Clés passées à etapeSuivie_('…') dans Main.gs (la clé est toujours sur la même ligne). */
const clesWrappees = [...MAIN.matchAll(/etapeSuivie_\(\s*'([^']+)'/g)].map((m) => m[1]);

test('tripwire : chaque clé du registre est wrappée dans Main.gs, et chaque wrap a son entrée au registre — DANS LE MÊME ORDRE', () => {
  // Sans `.sort()` (revue code-reviewer PR2) : le registre PROMET « ORDRE = ordre d'exécution »
  // (l'app l'affiche tel quel) — l'égalité ordonnée verrouille aussi cette promesse.
  assert.deepStrictEqual(clesWrappees, [...clesRegistre],
    'registre ⇔ wraps Main.gs : mêmes clés, MÊME ordre (le registre promet l\'ordre d\'exécution)');
});

test('tripwire : aucune clé wrappée deux fois (une étape = un point d\'exécution)', () => {
  const vues = new Set();
  for (const cle of clesWrappees) {
    assert.ok(!vues.has(cle), 'clé wrappée deux fois : ' + cle);
    vues.add(cle);
  }
});

test('tripwire : la suspension R2 enregistre un skip pour CHAQUE étape du bloc (liste verrouillée)', () => {
  // Les 27 étapes du bloc `if (!estPannePlateforme_())` — si une étape entre ou sort du bloc,
  // cette liste DOIT bouger avec (sinon : soit un skip fantôme, soit une étape muette en panne).
  // + les 8 missions de curation (C28-49 PR1+PR2) : dans le bloc, juste après la consolidation.
  const attendu = ['intake-gmail', 'intake-depots', 'intake-partages', 'intentions', 'tri-gmail',
    'consolidation-exec', 'consolidation-gen',
    'mission-vehicule', 'mission-logement', 'mission-dispatch-03', 'mission-archives-06',
    'mission-paies', 'mission-carriere', 'mission-annees-02', 'mission-impots',
    'fusion-exec', 'reset-rassemblement',
    'reset-placement', 'reset-04-interne', 'reset-llm', 'histo-gmail', 'migration',
    'reanalyse', 'dryrun-v2', 'dryrun-cmp', 'reorg', 'reconciliation-index'];
  const bloc = MAIN.match(/\[([^\]]+)\]\.forEach\(function \(cle\) \{ suiviSkip_\(cle, 'panne API \(compte\)'\); \}\);/);
  assert.ok(bloc, 'le lot de skips R2 existe dans Main.gs');
  const clesBloc = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(clesBloc, attendu);
  // APPARTENANCE AU BLOC, pas seulement la liste (revue apps-script-quota PR2) : une étape
  // déplacée HORS du `if (!estPannePlateforme_())` sans toucher la liste produirait un faux skip
  // persistant (ou l'inverse : une étape entrée dans le bloc resterait muette en panne). Chaque
  // wrap d'une clé du lot doit se trouver ENTRE l'ouverture du bloc et son `else` — et chaque
  // wrap d'une clé HORS lot doit être en dehors de cette plage.
  const posBloc = MAIN.indexOf('if (!estPannePlateforme_()) {');
  const posElse = bloc.index; // le lot de skips vit dans le `else` : c'est la borne de fin du bloc
  assert.ok(posBloc > 0 && posElse > posBloc, 'bornes du bloc R2 introuvables');
  for (const cle of clesRegistre) {
    const pos = MAIN.indexOf("etapeSuivie_('" + cle + "'");
    const dansBloc = pos > posBloc && pos < posElse;
    if (attendu.includes(cle)) {
      assert.ok(dansBloc, 'clé du lot R2 wrappée HORS du bloc de suspension : ' + cle);
    } else {
      assert.ok(!dansBloc, 'clé wrappée DANS le bloc R2 mais absente du lot de skips : ' + cle);
    }
  }
});

test('tripwire : suiviReset_ en tête de tick, flush APRÈS la rotation du Journal (dernier du finally)', () => {
  assert.ok(MAIN.includes('suiviReset_();'), 'l\'enregistreur repart à zéro à chaque run');
  const posJournalBorne = MAIN.indexOf("etapeSuivie_('journal-borne'");
  const posFlush = MAIN.indexOf('flusherSuiviOps_(');
  assert.ok(posJournalBorne > 0 && posFlush > posJournalBorne,
    'flusherSuiviOps_ doit venir APRÈS le wrap journal-borne (revue apps-script-quota PR1 : sinon la rotation perd son run)');
});

test('tripwire : les raisons de skip écrites dans Main.gs sont NON VIDES et tiennent dans SUIVI_SKIP_MAX', () => {
  // + Missions.gs (revue code PR2) : `gMissionsJour_`/`gMissionsAmont03_` y produisent des raisons
  // — dont LA plus longue du vocabulaire (« en attente (missions 03) », 24 = SUIVI_SKIP_MAX pile).
  // Ne scanner que Main.gs était une promesse de verrou non codée exactement sur le cas limite.
  const SOURCES = MAIN + '\n' + fs.readFileSync(path.join(__dirname, '..', 'src', 'Missions.gs'), 'utf8');
  const c = load(['Suivi.gs']);
  // Toute chaîne rendue par une gate ou passée à suiviSkip_ : capturées par leurs formes
  // syntaxiques (`? 'raison' : null`, `: 'raison';`, `suiviSkip_(cle, 'raison')`, `return 'raison';`).
  const raisons = new Set();
  for (const m of SOURCES.matchAll(/\?\s*'([^']+)'\s*:\s*null/g)) raisons.add(m[1]);
  for (const m of SOURCES.matchAll(/\?\s*null\s*:\s*'([^']+)'/g)) raisons.add(m[1]);
  for (const m of SOURCES.matchAll(/suiviSkip_\(cle,\s*'([^']+)'\)/g)) raisons.add(m[1]);
  for (const m of SOURCES.matchAll(/catch \(e\) \{ return '([^']+)'; \}/g)) raisons.add(m[1]);
  assert.ok(raisons.size >= 8, 'les raisons standard sont bien détectées (' + raisons.size + ')');
  for (const r of raisons) {
    assert.ok(r.trim().length > 0, 'raison vide interdite (contrat : "" = gate passante)');
    assert.ok(r.length <= c.SUIVI_SKIP_MAX, 'raison > SUIVI_SKIP_MAX (' + c.SUIVI_SKIP_MAX + ') : « ' + r + ' » (' + r.length + ')');
  }
});
