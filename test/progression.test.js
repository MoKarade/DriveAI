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
  return load(['Config.gs', 'Journal.gs']);
}

/** État de référence : tout inactif/terminé-sans-ligne — chaque test ne touche que son opération. */
function etatVierge(c) {
  return {
    quotaGmail: false, panneApi: false, freinBudget: false,
    rangement: { termine: true, base: null, traites: 0, tag: c.CONFIG.RANGEMENT_TAG },
    migration: { termine: true, base: null, traites: 0, tag: c.CONFIG.MIGRATION_TAG },
    reanalyse: { termine: true, enAttente: false, base: null, traites: 0, tag: c.CONFIG.REANALYSE_TAG },
    histo: { termine: true, traites: 0 },
    triDemande: { active: false, faits: 0, plafond: null, solde: null },
    intentionsDemande: { active: false, traites: 0, solde: null },
  };
}

test('lignesProgression_ : campagne en cours → barre ; recensement sans base ; « en attente » avant m1', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.migration = { termine: false, base: 1209, traites: 812, tag: 'm1' };
  etat.reanalyse = { termine: false, enAttente: true, base: null, traites: 0, tag: 'c26-08' };
  etat.histo = { termine: false, traites: 4520 };
  const lignes = c.lignesProgression_(etat, {}, Date.now(), c.CONFIG.PROGRESSION_PURGE_MS);

  const parCle = {};
  lignes.forEach((l) => { parCle[l[0]] = l; });
  assert.deepStrictEqual([parCle['migration'][2], parCle['migration'][3], parCle['migration'][4], parCle['migration'][5]], [812, 1209, 'documents', 'en cours']);
  assert.strictEqual(parCle['reanalyse'][5], 'en attente (après m1)');
  assert.deepStrictEqual([parCle['histo-gmail'][2], parCle['histo-gmail'][3], parCle['histo-gmail'][4], parCle['histo-gmail'][5]], [4520, '', 'fils', 'en cours'],
    'base inconnue (historique) → colonne Base vide, l\'app affiche un indéterminé');
  assert.ok(!('rangement' in parCle), 'campagne finie AVANT d\'avoir eu une ligne → jamais affichée');

  // Recensement : campagne active sans base posée.
  etat.migration = { termine: false, base: null, traites: 0, tag: 'm1' };
  const lignes2 = c.lignesProgression_(etat, {}, Date.now(), c.CONFIG.PROGRESSION_PURGE_MS);
  assert.strictEqual(lignes2.find((l) => l[0] === 'migration')[5], 'recensement');
});

test('lignesProgression_ : statuts dérivés — frein budget (campagnes) et quota Gmail (opérations mail)', () => {
  const c = ctxJournal();
  const etat = etatVierge(c);
  etat.freinBudget = true;
  etat.quotaGmail = true;
  etat.migration = { termine: false, base: 100, traites: 10, tag: 'm1' };
  etat.histo = { termine: false, traites: 50 };
  etat.triDemande = { active: true, faits: 3, plafond: 100, solde: null };
  const parCle = {};
  c.lignesProgression_(etat, {}, Date.now(), c.CONFIG.PROGRESSION_PURGE_MS)
    .forEach((l) => { parCle[l[0]] = l; });
  assert.strictEqual(parCle['migration'][5], 'en pause (frein budget)');
  assert.strictEqual(parCle['histo-gmail'][5], 'suspendu (quota Gmail)', 'le quota prime sur le frein pour Gmail');
  assert.strictEqual(parCle['tri-demande'][5], 'suspendu (quota Gmail)');
});

test('lignesProgression_ : « terminé » — horodatage de FIN figé, purge dérivée de la CONSTANTE, numérateur figé', () => {
  const c = ctxJournal();
  const PURGE = c.CONFIG.PROGRESSION_PURGE_MS;
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.migration = { termine: true, base: 1209, traites: 1209, tag: 'm1' };

  // Transition en cours → terminé : la ligne reste, horodatée MAINTENANT.
  const existEnCours = { migration: { traites: 1100, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l1 = c.lignesProgression_(etat, existEnCours, maintenant, PURGE).find((l) => l[0] === 'migration');
  assert.strictEqual(l1[5], 'terminé');
  assert.strictEqual(l1[6].getTime(), maintenant, 'fin fraîche → horodatée au tick de la transition');

  // Déjà terminé : l'horodatage de FIN ne bouge plus (sinon jamais purgé)…
  const finMs = maintenant - (PURGE - 60000); // purge − 1 min : encore visible
  const existFini = { migration: { traites: 1209, statut: 'terminé', horodateMs: finMs } };
  const l2 = c.lignesProgression_(etat, existFini, maintenant, PURGE).find((l) => l[0] === 'migration');
  assert.strictEqual(l2[6].getTime(), finMs, 'horodatage de fin conservé');

  // …et au-delà de la purge, la ligne disparaît.
  const existVieux = { migration: { traites: 1209, statut: 'terminé', horodateMs: maintenant - (PURGE + 60000) } };
  const l3 = c.lignesProgression_(etat, existVieux, maintenant, PURGE).find((l) => l[0] === 'migration');
  assert.strictEqual(l3, undefined, 'terminé plus vieux que la purge → ligne purgée');
});

test('lignesProgression_ : demandes — active d\'abord, soldée visible via l\'instantané, purge du solde', () => {
  const c = ctxJournal();
  const PURGE = c.CONFIG.PROGRESSION_PURGE_MS;
  const maintenant = Date.now();
  const etat = etatVierge(c);

  etat.triDemande = { active: true, faits: 37, plafond: 100, solde: { faits: 5, quand: maintenant - 1000 } };
  let l = c.lignesProgression_(etat, {}, maintenant, PURGE).find((x) => x[0] === 'tri-demande');
  assert.deepStrictEqual([l[2], l[3], l[4], l[5]], [37, 100, 'fils', 'en cours'], 'demande ACTIVE prime sur un vieux solde');

  // Demande servie en UN tick (Properties purgées avant le finally) : le solde la rend visible.
  etat.triDemande = { active: false, faits: 0, plafond: null, solde: { faits: 37, quand: maintenant - 1000 } };
  l = c.lignesProgression_(etat, {}, maintenant, PURGE).find((x) => x[0] === 'tri-demande');
  assert.deepStrictEqual([l[2], l[5]], [37, 'terminé']);

  // Solde plus vieux que la purge → plus de ligne.
  etat.triDemande.solde.quand = maintenant - (PURGE + 60000);
  l = c.lignesProgression_(etat, {}, maintenant, PURGE).find((x) => x[0] === 'tri-demande');
  assert.strictEqual(l, undefined);

  // Intentions à la demande : base inconnue (fenêtre), l'offset seul progresse (compté en FILS).
  etat.intentionsDemande = { active: true, traites: 240, solde: null };
  l = c.lignesProgression_(etat, {}, maintenant, PURGE).find((x) => x[0] === 'intentions-demande');
  assert.deepStrictEqual([l[2], l[3], l[4], l[5]], [240, '', 'fils', 'en cours']);
});

test('lignesProgression_ : compteur histo MONOTONE — l\'offset repart à 0 en passe de vérification, l\'affichage jamais', () => {
  const c = ctxJournal();
  const maintenant = Date.now();
  const etat = etatVierge(c);
  etat.histo = { termine: false, traites: 0 }; // offset remis à 0 (passe de vérification)
  const existantes = { 'histo-gmail': { traites: 4520, statut: 'en cours', horodateMs: maintenant - 60000 } };
  const l = c.lignesProgression_(etat, existantes, maintenant, c.CONFIG.PROGRESSION_PURGE_MS)
    .find((x) => x[0] === 'histo-gmail');
  assert.strictEqual(l[2], 4520, 'le compteur affiché ne recule jamais (max avec la ligne existante)');
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
  // Arbre : chaque domaine NON protégé et NON ciblé porte 2 fichiers, dont 1 déjà migré + 1 natif.
  const arbres = {};
  const attendus = [];
  Object.keys(c.CONFIG.DOMAINES).forEach((dom, i) => {
    const id = c.CONFIG.DOMAINES[dom];
    arbres[id] = fauxDossierArbre([
      fakeFileEtendu('f-' + i + '-a'),
      fakeFileEtendu('f-' + i + '-deja'),
      fakeFileEtendu('f-' + i + '-natif', 'application/vnd.google-apps.document'),
    ], [fauxDossierArbre([fakeFileEtendu('f-' + i + '-sous')])]);
    if (c.CONFIG.DOMAINES_PROTEGES.indexOf(dom) === -1 && (c.CONFIG.REANALYSE_CIBLES || []).indexOf(dom) === -1) {
      attendus.push('f-' + i + '-a', 'f-' + i + '-sous');
    }
  });
  const c2 = ctxRecensement(arbres, Object.keys(arbres).map((_, i) => 'migre|' + tag + '|f-' + i + '-deja'));
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
