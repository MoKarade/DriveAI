'use strict';
/**
 * C28-18 — progression LIVE des opérations (onglet `Progression`, rendu centralisé) :
 *  - `lignesProgression_` (PURE) : statuts dérivés des pannes/frein AVANT « en cours » ; une ligne
 *    « terminé » garde l'horodatage de sa FIN et disparaît après PROGRESSION_PURGE_MS (dérivé de la
 *    CONSTANTE, jamais de sa valeur du jour) ; une campagne finie AVANT d'avoir eu une ligne
 *    n'apparaît jamais ; les demandes soldées restent visibles par leur instantané `solde`.
 *  - `majCompteurCampagne_` : numérateur monotone, base RE-BASABLE (jamais > 100 %), no-op sans base.
 *  - `compterRestantMigration_`/`compterRestantReanalyse_` : même périmètre que leurs collectes
 *    (zone protégée et cibles C26-08 exclues de m1), bornés par le garde (partiel → complet=false).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- lignesProgression_ (PURE — Journal.gs) ---------- */

function ctxJournal() {
  // Suivi.gs : REGISTRE_OPERATIONS + statutDepuisSuivi_, consommés par lignesProgression_ (C28-44 PR3).
  return load(['Config.gs', 'Suivi.gs', 'Journal.gs']);
}

/** Appel v3 : suivi et registre explicites (suivi vide par défaut — chaque test passe le sien). */
function lignesV3(c, etat, existantes, maintenantMs, suivi) {
  return c.lignesProgression_(etat, existantes, maintenantMs, c.CONFIG.PROGRESSION_PURGE_MS,
    suivi || {}, c.REGISTRE_OPERATIONS);
}

/** État de référence : tout inactif/terminé-sans-ligne — chaque test ne touche que son opération. */
function etatVierge(c) {
  return {
    quotaGmail: false, panneApi: false, freinBudget: false, resetEnCours: false,
    rangement: { termine: true, base: null, traites: 0, tag: c.CONFIG.RANGEMENT_TAG },
    migration: { termine: true, base: null, traites: 0, tag: c.CONFIG.MIGRATION_TAG },
    reanalyse: { termine: true, enAttente: false, base: null, traites: 0, tag: c.CONFIG.REANALYSE_TAG },
    histo: { termine: true, traites: 0 },
    consolidationGen: { termine: true, base: 0, traites: 0, budgetEpuise: false, tag: c.CONFIG.CONSOLIDATION_TAG },
    consolidationExec: { termine: true, base: 0, traites: 0, budgetEpuise: false, tag: c.CONFIG.CONSOLIDATION_TAG },
  };
}

test('lignesProgression_ : campagne en cours → barre ; recensement sans base ; « en attente » avant m1', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1209, traites: 812, tag: 'm1' };
  etat.reanalyse = { termine: false, enAttente: true, base: null, traites: 0, tag: 'c26-08' };
  etat.histo = { termine: false, traites: 4520 };
  const lignes = lignesV3(c, etat, {}, Date.now());

  const parCle = {};
  lignes.forEach((l) => { parCle[l[0]] = l; });
  assert.deepStrictEqual([parCle['migration'][2], parCle['migration'][3], parCle['migration'][4], parCle['migration'][5]], [812, 1209, 'documents', 'en cours']);
  assert.strictEqual(parCle['reanalyse'][5], 'en attente (après m1)');
  assert.deepStrictEqual([parCle['histo-gmail'][2], parCle['histo-gmail'][3], parCle['histo-gmail'][4], parCle['histo-gmail'][5]], [4520, '', 'fils', 'en cours'],
    'base inconnue (historique) → colonne Base vide, l\'app affiche un indéterminé');
  assert.ok(!('rangement' in parCle), 'campagne finie AVANT d\'avoir eu une ligne → jamais affichée');

  // Recensement : campagne active sans base posée.
  etat.migration = { termine: false, base: null, traites: 0, tag: 'm1' };
  const lignes2 = lignesV3(c, etat, {}, Date.now());
  assert.strictEqual(lignes2.find((l) => l[0] === 'migration')[5], 'recensement');
});

test('lignesProgression_ : statuts dérivés — frein budget (campagnes) et quota Gmail (opérations mail)', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.freinBudget = true;
  etat.quotaGmail = true;
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  etat.histo = { termine: false, traites: 50 };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now())
    .forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['migration'][5], 'en pause (frein budget)');
  assert.strictEqual(parCle['histo-gmail'][5], 'suspendu (quota Gmail)', 'le quota prime sur le frein pour Gmail');
});

test('lignesProgression_ : « terminé » — horodatage de FIN figé, purge dérivée de la CONSTANTE, numérateur figé', () => {
  const c = ctxJournal();
  const PURGE = c.CONFIG.PROGRESSION_PURGE_MS;
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.migration = { termine: true, base: 1209, traites: 1209, tag: 'm1' };

  // Transition en cours → terminé : la ligne reste, horodatée MAINTENANT.
  const existEnCours = { migration: { traites: 1100, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l1 = lignesV3(c, etat, existEnCours, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l1[5], 'terminé');
  assert.strictEqual(l1[6].getTime(), maintenant, 'fin fraîche → horodatée au tick de la transition');

  // Déjà terminé : l'horodatage de FIN ne bouge plus (sinon jamais purgé)…
  const finMs = maintenant - (PURGE - 60000); // purge − 1 min : encore visible
  const existFini = { migration: { traites: 1209, statut: 'terminé', horodateMs: finMs } };
  const l2 = lignesV3(c, etat, existFini, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l2[6].getTime(), finMs, 'horodatage de fin conservé');

  // …et au-delà de la purge, la ligne disparaît.
  const existVieux = { migration: { traites: 1209, statut: 'terminé', horodateMs: maintenant - (PURGE + 60000) } };
  const l3 = lignesV3(c, etat, existVieux, maintenant).find((l) => l[0] === 'migration');
  assert.strictEqual(l3, undefined, 'terminé plus vieux que la purge → ligne purgée');
});

// ADR-0031 : les « demandes de Marc » (tri/intentions) n'existent plus — la progression ne
// publie QUE les campagnes de fond, jamais une ligne fantôme d'une feature retirée.
test('lignesProgression_ (ADR-0031) : plus JAMAIS de lignes tri-demande / intentions-demande', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  const cles = lignesV3(c, etat, {}, Date.now()).map((l) => l[0]);
  assert.ok(cles.indexOf('tri-demande') === -1 && cles.indexOf('intentions-demande') === -1, 'clés retirées');
});

test('lignesProgression_ : compteur histo MONOTONE — l\'offset repart à 0 en passe de vérification, l\'affichage jamais', () => {
  const c = ctxJournal();
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.histo = { termine: false, traites: 0 }; // offset remis à 0 (passe de vérification)
  const existantes = { 'histo-gmail': { traites: 4520, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l = lignesV3(c, etat, existantes, maintenant)
    .find((x) => x[0] === 'histo-gmail');
  assert.strictEqual(l[2], 4520, 'le compteur affiché ne recule jamais (max avec la ligne existante)');
});

test('lignesProgression_ : consolidation en cours — Traités/Base/Unité reflètent domaines épuisés et lignes du plan', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.consolidationGen = { termine: false, base: 9, traites: 5, budgetEpuise: false, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 1086, budgetEpuise: false, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.deepStrictEqual(
    [parCle['consolidation-gen'][2], parCle['consolidation-gen'][3], parCle['consolidation-gen'][4], parCle['consolidation-gen'][5]],
    [5, 9, 'domaines', 'en cours']);
  assert.deepStrictEqual(
    [parCle['consolidation-exec'][2], parCle['consolidation-exec'][3], parCle['consolidation-exec'][4], parCle['consolidation-exec'][5]],
    [1086, 1236, 'lignes', 'en cours']);
  assert.ok(parCle['consolidation-gen'][1].indexOf('conso-3') !== -1, 'le tag de campagne apparaît dans le libellé');
});

test('lignesProgression_ : consolidation SUSPENDUE par resetEnCours_ — prime sur le budget épuisé', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.resetEnCours = true;
  etat.consolidationGen = { termine: false, base: 9, traites: 2, budgetEpuise: true, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 500, budgetEpuise: true, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['consolidation-gen'][5], 'suspendu (reset en cours)');
  assert.strictEqual(parCle['consolidation-exec'][5], 'suspendu (reset en cours)');
});

test('lignesProgression_ : consolidation en PAUSE (budget du jour épuisé) — jamais confondue avec le frein LLM $', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.freinBudget = true; // frein LLM $ actif — ne doit PAS influencer la consolidation (pure I/O)
  etat.consolidationGen = { termine: false, base: 9, traites: 5, budgetEpuise: true, tag: 'conso-3' };
  etat.consolidationExec = { termine: false, base: 1236, traites: 1086, budgetEpuise: false, tag: 'conso-3' };
  const parCle = {};
  lignesV3(c, etat, {}, Date.now()).forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['consolidation-gen'][5], 'en pause (budget du jour épuisé)');
  assert.strictEqual(parCle['consolidation-exec'][5], 'en cours', 'le frein LLM $ ne doit jamais suspendre la consolidation');
});

test('lignesProgression_ : consolidation TERMINÉE — prime sur reset en cours et budget épuisé', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.resetEnCours = true;
  etat.consolidationExec = { termine: true, base: 1236, traites: 1236, budgetEpuise: true, tag: 'conso-3' };
  const existant = { 'consolidation-exec': { traites: 1200, statut: 'en cours', horodateMs: Date.now() - 60000 } };
  const l = lignesV3(c, etat, existant, Date.now())
    .find((x) => x[0] === 'consolidation-exec');
  assert.strictEqual(l[5], 'terminé');
});

/* ---------- C28-44 PR3 : lignes GÉNÉRIQUES (toutes les opérations du registre) ---------- */

test('lignesProgression_ (C28-44) : UNE ligne par opération du registre, dans l\'ordre d\'exécution — plus jamais 6 lignes codées en dur', () => {
  const c = ctxJournal();
  const lignes = lignesV3(c, etatVierge(c), {}, Date.now());
  const cles = lignes.map((l) => l[0]);
  // Les campagnes « terminé sans ligne existante » sont absentes (règle historique conservée) ;
  // TOUTES les autres opérations du registre sont présentes, dans l'ordre du registre.
  const attendues = c.clesRegistreSuivi_().filter((cle) =>
    ['migration', 'reanalyse', 'histo-gmail', 'rangement', 'consolidation-gen', 'consolidation-exec'].indexOf(cle) === -1);
  assert.deepStrictEqual(cles, attendues, 'chaque opération non-campagne a sa ligne, ordre du registre');
  const ligne = lignes.find((l) => l[0] === 'tri-gmail');
  assert.deepStrictEqual([ligne[1], ligne[4], ligne[5]], ['Tri de la boîte Gmail', 'fils', 'jamais vue'],
    'libellé/unité du registre ; sans enregistrement → « jamais vue » (honnête, un tick au plus)');
});

test('lignesProgression_ (C28-44) : statut/Détail/Dernière activité/Dernière erreur dérivés du SUIVI réel', () => {
  const c = ctxJournal();
  const maintenant = Date.now();
  const suivi = {
    'tri-gmail': { t: maintenant - 1000, ok: maintenant - 900, d: 100, et: 0, e: '', st: 0, s: '' },
    'intake-depots': { t: 0, ok: 0, d: 0, et: 0, e: '', st: maintenant - 500, s: 'budget de tick épuisé' },
    'intentions': { t: maintenant - 2000, ok: maintenant - 7200000, d: 5, et: maintenant - 1000, e: 'quota Gmail mort', st: 0, s: '' },
    'reconciliation-index': { t: 0, ok: 0, d: 0, et: 0, e: '', st: maintenant - 300, s: 'reset en cours' },
  };
  const parCle = {};
  lignesV3(c, etatVierge(c), {}, maintenant, suivi).forEach((l) => { parCle[l[0]] = l; });
  // Succès récent → en cours ; Dernière activité = max(tentative, succès), en TEXTE au format
  // CONTRÔLÉ dd/MM HH:mm (PR6 : une cellule Date ressortait sans l'heure en FORMATTED_VALUE).
  assert.strictEqual(parCle['tri-gmail'][5], 'en cours');
  assert.ok(/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(parCle['tri-gmail'][8]), 'activité au format dd/MM HH:mm : ' + parCle['tri-gmail'][8]);
  assert.strictEqual(parCle['tri-gmail'][9], '');
  assert.strictEqual(parCle['tri-gmail'][10], 'flux', 'colonne Type (K) = type du registre');
  // Skip budget → en pause + raison en Détail.
  assert.strictEqual(parCle['intake-depots'][5], 'en pause (budget de tick épuisé)');
  assert.strictEqual(parCle['intake-depots'][7], 'budget de tick épuisé');
  // Erreur au DERNIER événement → statut erreur + colonne Dernière erreur horodatée avec message.
  assert.strictEqual(parCle['intentions'][5], 'erreur');
  assert.ok(parCle['intentions'][9].indexOf('quota Gmail mort') !== -1, 'le message d\'erreur est visible');
  assert.ok(/\d{2}\/\d{2} \d{2}:\d{2} — /.test(parCle['intentions'][9]), 'horodaté (dd/MM HH:mm)');
  // Skip reset → suspendu + raison.
  assert.strictEqual(parCle['reconciliation-index'][5], 'suspendu (reset en cours)');
  // Et les lignes de CAMPAGNE portent AUSSI les colonnes de suivi (mêmes 3 colonnes, même source).
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  const suiviM = { migration: { t: maintenant - 100, ok: 0, d: 0, et: maintenant - 50, e: 'boom', st: 0, s: '' } };
  const lm = lignesV3(c, etat, {}, maintenant, suiviM).find((l) => l[0] === 'migration');
  assert.strictEqual(lm[5], 'en cours', 'le statut CAMPAGNE (riche) reste prioritaire pour les campagnes');
  assert.ok(lm[9].indexOf('boom') !== -1, 'mais la Dernière erreur du suivi est visible quand même');
});

/* ---------- C28-47 : avancement (dernière passe + fin estimée) ---------- */

/** Appel avec débits explicites (colonnes L/M). */
function lignesAvancement(c, etat, maintenantMs, debits) {
  return c.lignesProgression_(etat, {}, maintenantMs, c.CONFIG.PROGRESSION_PURGE_MS, {},
    c.REGISTRE_OPERATIONS, debits || {});
}

test('colonnesAvancement (C28-47) : campagne qui AVANCE → dernière passe + horizon + date de fin', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1000, traites: 400, tag: 'm1' };
  const debits = { migration: { t0: maintenant - 48 * 3600000, ts: maintenant, n: 400, r: 25, dn: 23, dts: maintenant - 6 * 60000 } };
  const l = lignesAvancement(c, etat, maintenant, debits).find((x) => x[0] === 'migration');
  assert.strictEqual(l[11], '+23 documents · il y a 6 min', 'dernière passe PRODUCTIVE avec son unité');
  assert.ok(l[12].indexOf('reste 600 documents') === 0, 'reste chiffré : ' + l[12]);
  assert.ok(/~24 h/.test(l[12]), '600 restants à 25/h = 24 h : ' + l[12]);
  assert.ok(/vers le \d{2}\/\d{2}/.test(l[12]), 'date de fin projetée : ' + l[12]);
});

test('colonnesAvancement (C28-47) : EN PAUSE → JAMAIS de date de fin, mais le reste et la REPRISE (le cas prod de la ré-analyse)', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  // Cas RÉEL du 14/08 : ré-analyse 322/1207, gelée par le frein budget MENSUEL.
  etat.freinBudget = true;
  etat.reanalyse = { termine: false, enAttente: false, base: 1207, traites: 322, tag: 'c26-08' };
  const debits = { reanalyse: { t0: maintenant - 72 * 3600000, ts: maintenant, n: 322, r: 12, dn: 40, dts: maintenant - 3600000 } };
  const l = lignesAvancement(c, etat, maintenant, debits).find((x) => x[0] === 'reanalyse');
  assert.strictEqual(l[5], 'en pause (frein budget)');
  assert.ok(l[12].indexOf('reste 885 documents') === 0, 'le RESTE est dit : ' + l[12]);
  assert.ok(!/vers le/.test(l[12]) && !/~\d/.test(l[12]),
    'ni date ni horizon quand c\'est gelé — le débit ne connaît pas un gel FUTUR : ' + l[12]);
  assert.ok(/reprise le \d{2}\/\d{2} \(frein mensuel\)/.test(l[12]), 'la REPRISE mensuelle est annoncée : ' + l[12]);

  // Budget du JOUR (consolidation) : même règle, reprise demain.
  const etat2 = etatVierge(c);
  etat2.consolidationGen = { termine: false, base: 9, traites: 6, budgetEpuise: true, tag: 'conso-3' };
  const d2 = { 'consolidation-gen': { t0: maintenant - 72 * 3600000, ts: maintenant, n: 6, r: 0.5, dn: 2, dts: maintenant - 7200000 } };
  const l2 = lignesAvancement(c, etat2, maintenant, d2).find((x) => x[0] === 'consolidation-gen');
  assert.strictEqual(l2[5], 'en pause (budget du jour épuisé)');
  assert.ok(/reste 3 domaines/.test(l2[12]) && /reprise demain/.test(l2[12]), l2[12]);
  assert.ok(!/vers le/.test(l2[12]), 'pas de date de fin en pause : ' + l2[12]);
});

test('colonnesAvancement (C28-47) : aucune estimation inventée — sans débit, à l\'arrêt, ou campagne finie', () => {
  const c = ctxJournal();
  const maintenant = 1755000000000;
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1000, traites: 400, tag: 'm1' };
  // Aucun débit connu → les deux colonnes restent VIDES (jamais un « ~? j »).
  const vide = lignesAvancement(c, etat, maintenant, {}).find((x) => x[0] === 'migration');
  assert.deepStrictEqual([vide[11], vide[12]], ['', '']);
  // Débit nul (campagne à l'arrêt) → pas d'estimation, mais la dernière passe connue reste dite.
  const arret = { migration: { t0: maintenant - 72 * 3600000, ts: maintenant, n: 400, r: 0, dn: 5, dts: maintenant - 3 * 86400000 } };
  const l = lignesAvancement(c, etat, maintenant, arret).find((x) => x[0] === 'migration');
  assert.ok(/il y a 3 j/.test(l[11]), 'dernière passe ancienne, dite honnêtement : ' + l[11]);
  assert.strictEqual(l[12], '', 'aucune estimation quand le débit est nul');
});

test('assurerEnteteProgression_ (C28-44) : migration par la DERNIÈRE colonne — jamais A1, et SANS effacer les lignes', () => {
  const c = ctxJournal();
  const etats = { header: null, cleared: false, frozen: 0 };
  const cellules = { A1: 'Clé', J1: '', K1: '', M1: '' }; // en-tête ancien : A1 correct, dernière colonne vide
  const f = {
    getRange: (a, col, nb, larg) => {
      if (typeof a === 'string') return { getValue: () => cellules[a] };
      etats.coords = [a, col, nb, larg];
      return { setValues: (v) => { etats.header = v[0]; } };
    },
    clearContents: () => { etats.cleared = true; },
    setFrozenRows: () => { etats.frozen++; },
  };
  c.assurerEnteteProgression_(f);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(etats.header)), JSON.parse(JSON.stringify(c.COLONNES_PROGRESSION)),
    'en-tête réécrit en v3 (10 colonnes) alors que A1 était DÉJÀ « Clé » — le test A1 aurait été du code mort');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(etats.coords)), [1, 1, 1, c.COLONNES_PROGRESSION.length],
    'écrit sur la LIGNE 1, toutes les colonnes — dérivé de la constante, jamais sa valeur du jour');
  assert.strictEqual(etats.cleared, false,
    'v2→v3 ne vide JAMAIS les lignes (7 premières colonnes identiques — les « terminé » existants survivent)');

  // En-tête COURANT déjà en place (dernière colonne présente) → no-op total.
  const etats2 = { header: null, cleared: false };
  const f2 = {
    getRange: (a) => {
      if (typeof a === 'string') return { getValue: () => (a === 'M1' ? 'Fin estimée' : 'Clé') };
      return { setValues: () => { etats2.header = 'réécrit'; } };
    },
    clearContents: () => { etats2.cleared = true; },
    setFrozenRows: () => {},
  };
  c.assurerEnteteProgression_(f2);
  assert.deepStrictEqual([etats2.header, etats2.cleared], [null, false], 'en-tête courant en place → aucune écriture');

  // v1 (barre texte, A1 ≠ Clé) : table incompatible → clearContents (comportement historique conservé).
  const etats3 = { cleared: false, header: null };
  const f3 = {
    getRange: (a) => {
      if (typeof a === 'string') return { getValue: () => '' };
      return { setValues: (v) => { etats3.header = v[0]; } };
    },
    clearContents: () => { etats3.cleared = true; },
    setFrozenRows: () => {},
  };
  c.assurerEnteteProgression_(f3);
  assert.strictEqual(etats3.cleared, true, 'v1 → on repart de zéro (affichage, pas un état)');
});

/* ---------- majCompteurCampagne_ / finaliserCompteurCampagne_ (Maintenance.gs) ---------- */

function ctxCompteur(props) {
  const p = Object.assign({}, props);
  const c = load(['Config.gs', 'Maintenance.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in p ? p[k] : null),
        setProperty: (k, v) => { p[k] = String(v); },
        deleteProperty: (k) => { delete p[k]; },
      }),
    },
  });
  return { c, p };
}

test('majCompteurCampagne_ : cumul monotone, re-base (jamais > 100 %), no-op sans base recensée', () => {
  const sansBase = ctxCompteur({});
  sansBase.c.majCompteurCampagne_('DriveAI_MIGRATION', 12);
  assert.ok(!('DriveAI_MIGRATION_TRAITES' in sansBase.p), 'pas de base → pas de barre');

  const { c, p } = ctxCompteur({ DriveAI_MIGRATION_BASE: '100', DriveAI_MIGRATION_TRAITES: '95' });
  c.majCompteurCampagne_('DriveAI_MIGRATION', 3);
  assert.deepStrictEqual([p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE], ['98', '100']);
  c.majCompteurCampagne_('DriveAI_MIGRATION', 7); // 105 > 100 → la base suit (re-base)
  assert.deepStrictEqual([p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE], ['105', '105']);

  c.finaliserCompteurCampagne_('DriveAI_MIGRATION');
  assert.strictEqual(p.DriveAI_MIGRATION_TRAITES, p.DriveAI_MIGRATION_BASE, 'fin réelle → 100 %');
});

/* ---------- Recensements de campagne (Migration.gs) ---------- */

const { fakeFileEtendu, fauxDossierArbre } = (() => {
  /** Faux fichier minimal pour estAMigrer_/estAReanalyser_ (getId + getMimeType). */
  function fichier(id, mime) {
    return { getId: () => id, getMimeType: () => mime || 'application/pdf', getName: () => id };
  }
  /** Faux dossier : fichiers + sous-dossiers (itérateurs façon Apps Script). */
  function dossier(fichiers, sousDossiers) {
    return {
      getFiles: () => { let i = 0; return { hasNext: () => i < fichiers.length, next: () => fichiers[i++] }; },
      getFolders: () => { let i = 0; return { hasNext: () => i < (sousDossiers || []).length, next: () => sousDossiers[i++] }; },
    };
  }
  return { fakeFileEtendu: fichier, fauxDossierArbre: dossier };
})();

function ctxRecensement(arbres, dejaIndexees) {
  const index = {};
  (dejaIndexees || []).forEach((k) => { index[k] = true; });
  const c = load(['Config.gs', 'Migration.gs'], {
    DriveApp: { getFolderById: (id) => { if (!arbres[id]) throw new Error('introuvable : ' + id); return arbres[id]; } },
  });
  c.indexContient_ = (k) => index[k] === true;
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  return c;
}

test('compterRestantMigration_ : compte le restant HORS cibles C26-08/protégés, sauté si déjà migré ; partiel sous budget', () => {
  const c = ctxRecensement({}, []);
  const tag = c.CONFIG.MIGRATION_TAG;
  // Arbre : chaque domaine NON protégé/NON ciblé porte des fichiers du périmètre m2 (nom « Inconnu »,
  // C28-21) dont 1 déjà migré + 1 natif, ET un fichier bien nommé qui ne doit JAMAIS être compté.
  const arbres = {};
  const attendus = [];
  Object.keys(c.CONFIG.DOMAINES).forEach((dom, i) => {
    const id = c.CONFIG.DOMAINES[dom];
    arbres[id] = fauxDossierArbre([
      fakeFileEtendu('f-' + i + '-a-Inconnu'),
      fakeFileEtendu('f-' + i + '-deja-Inconnu'),
      fakeFileEtendu('f-' + i + '-natif-Inconnu', 'application/vnd.google-apps.document'),
      fakeFileEtendu('f-' + i + '-2024-01-01_Facture_EDF'), // bien nommé → hors périmètre m2
    ], [fauxDossierArbre([fakeFileEtendu('f-' + i + '-sous-Inconnu')])]);
    if (c.CONFIG.DOMAINES_PROTEGES.indexOf(dom) === -1 && (c.CONFIG.REANALYSE_CIBLES || []).indexOf(dom) === -1) {
      attendus.push('f-' + i + '-a-Inconnu', 'f-' + i + '-sous-Inconnu');
    }
  });
  const c2 = ctxRecensement(arbres, Object.keys(arbres).map((_, i) => 'migre|' + tag + '|f-' + i + '-deja-Inconnu'));
  const rec = c2.compterRestantMigration_(() => false);
  assert.strictEqual(rec.complet, true);
  assert.strictEqual(rec.n, attendus.length, 'protégés + cibles C26-08 exclus, déjà-migrés et natifs sautés');

  // Budget coupé immédiatement → partiel, jamais un faux « complet ».
  const recPartiel = c2.compterRestantMigration_(() => true);
  assert.strictEqual(recPartiel.complet, false);
});

test('compterRestantReanalyse_ : ne parcourt QUE les cibles, prédicat de la campagne c26-08', () => {
  const c = ctxRecensement({}, []);
  const arbres = {};
  const visites = [];
  Object.keys(c.CONFIG.DOMAINES).forEach((dom) => {
    const id = c.CONFIG.DOMAINES[dom];
    arbres[id] = {
      getFiles: () => { visites.push(dom); return { hasNext: () => false, next: () => null }; },
      getFolders: () => ({ hasNext: () => false, next: () => null }),
    };
  });
  arbres[c.CONFIG.DOMAINES[c.CONFIG.REANALYSE_CIBLES[0]]] = fauxDossierArbre([
    fakeFileEtendu('r-1'), fakeFileEtendu('r-deja'),
  ]);
  const c2 = ctxRecensement(arbres, ['reanalyse|' + c.CONFIG.REANALYSE_TAG + '|r-deja']);
  const rec = c2.compterRestantReanalyse_(() => false);
  assert.strictEqual(rec.complet, true);
  assert.strictEqual(rec.n, 1, 'seul le restant des cibles est compté');
});

/* ---------- C28-24 : télémétrie coûts & quotas (lignesTelemetrie_ / compteurFilsJour_, PURES — Journal.gs) ---------- */

test('lignesTelemetrie_ : clés STABLES (contrat app), plafonds dérivés des CONSTANTES, reprise seulement si suspendu', () => {
  const c = ctxJournal();
  const lignes = c.lignesTelemetrie_({
    quotaSuspendu: false, reprise: '',
    histoFilsJour: 42, cycliqueFilsJour: 7, demandeFilsJour: 120, boiteFilsJour: 45,
    coutDollars: 3.14, coutAppels: 250,
  });
  const parCle = {};
  lignes.forEach((l) => { parCle[l[0]] = l; });
  // Contrat avec interpreterTelemetrie (PR3) : ces clés ne doivent JAMAIS changer sans migration app.
  assert.deepStrictEqual(Object.keys(parCle).sort(), ['gmail_histo_fils_jour', 'llm_appels_mois',
    'llm_cout_mois', 'quota_gmail_etat', 'tri_boite_fils_jour', 'tri_cyclique_fils_jour']);
  assert.deepStrictEqual([parCle['quota_gmail_etat'][1], parCle['quota_gmail_etat'][3]], ['actif', '']);
  // Plafonds affichés = les CONSTANTES du jour (l'app n'a pas à les connaître en dur).
  assert.strictEqual(parCle['gmail_histo_fils_jour'][3], 'Plafond ' + c.CONFIG.GMAIL_HISTO_MAX_FILS_JOUR + '/j');
  assert.strictEqual(parCle['tri_cyclique_fils_jour'][3], 'Plafond ' + c.CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR + '/j');
  assert.deepStrictEqual([parCle['tri_boite_fils_jour'][1], parCle['tri_boite_fils_jour'][3]],
    [45, 'Plafond ' + c.CONFIG.TRI_BOITE_MAX_FILS_JOUR + '/j']);
  assert.strictEqual(parCle['llm_cout_mois'][3], 'Frein campagnes à ' + c.CONFIG.LLM_BUDGET_CAMPAGNES + ' $');
  assert.deepStrictEqual([parCle['llm_cout_mois'][1], parCle['llm_appels_mois'][1]], [3.14, 250]);

  const suspendu = c.lignesTelemetrie_({
    quotaSuspendu: true, reprise: 'Reprise vers 14:30',
    histoFilsJour: 0, cycliqueFilsJour: 0, demandeFilsJour: 0, boiteFilsJour: 0, coutDollars: 0, coutAppels: 0,
  }).find((l) => l[0] === 'quota_gmail_etat');
  assert.deepStrictEqual([suspendu[1], suspendu[3]], ['suspendu', 'Reprise vers 14:30']);
});

test('compteurFilsJour_ : la valeur ne vaut que si la date persistée est AUJOURD\'HUI — sinon 0 (compteur de la veille jamais affiché)', () => {
  const c = ctxJournal();
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(c.compteurFilsJour_(props({ X_JOUR: '2026/07/15', X_FILS_JOUR: '37' }), 'X', '2026/07/15'), 37);
  assert.strictEqual(c.compteurFilsJour_(props({ X_JOUR: '2026/07/14', X_FILS_JOUR: '37' }), 'X', '2026/07/15'), 0,
    'rollover : le compteur de la veille ne s\'affiche jamais comme celui du jour');
  assert.strictEqual(c.compteurFilsJour_(props({}), 'X', '2026/07/15'), 0);
});
