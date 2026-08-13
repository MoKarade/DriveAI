'use strict';
/**
 * historique-vrac.test.js — journal QUOTIDIEN du vrac par domaine (demande Marc 2026-08-12,
 * HistoriqueVrac.gs). Verrouille la logique PURE (formatage de ligne, budget quotidien, liste des
 * domaines suivis) ET l'orchestration I/O (`majHistoriqueVrac_`) : le garde-temps DOIT être
 * vérifié AVANT CHAQUE domaine, dans la MÊME boucle que le comptage Drive — jamais une sélection
 * « pure » suivie d'une exécution non bornée (bug réel trouvé en revue flotte apps-script-quota :
 * un domaine à ~1000 fichiers compté sans coupure risquerait le mur dur 6 min).
 */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** Normalise une valeur construite DANS le contexte vm (autre realm → prototypes distincts,
 * `deepStrictEqual` échoue sur l'identité de prototype même à structure identique — patron du
 * harness, cf. test/diagnostic.test.js) en valeur HOST plate, comparable normalement. */
function plain(x) { return JSON.parse(JSON.stringify(x)); }

function ctx() {
  return load(['Config.gs', 'HistoriqueVrac.gs']);
}

/* ---------- ligneHistoriqueVrac_ (PURE) ---------- */

test('ligneHistoriqueVrac_ : formate une ligne, colonne Tronqué vide sauf si plafonné', () => {
  const c = ctx();
  assert.deepStrictEqual(
    plain(c.ligneHistoriqueVrac_('2026/08/12', { nom: '05 · Carrière', id: 'x' }, { n: 26, tronque: false, erreur: false })),
    ['2026/08/12', '05 · Carrière', 26, '', '']);
  assert.deepStrictEqual(
    plain(c.ligneHistoriqueVrac_('2026/08/12', { nom: '08 · Perso & projets', id: 'y' }, { n: 1000, tronque: true, erreur: false })),
    ['2026/08/12', '08 · Perso & projets', 1000, 'oui', '']);
});

test('ligneHistoriqueVrac_ : domaine illisible → Vrac VIDE + Erreur "oui", JAMAIS un faux 0 permanent', () => {
  const c = ctx();
  // Confirmé en prod 2026-08-12 : 06·Études avait affiché 0 dans ce journal APPEND-ONLY alors
  // qu'il contenait ≥400 fichiers réels — un 0 écrit ici ne se corrige jamais (contrairement à
  // Progression/Santé, réécrits chaque tick).
  assert.deepStrictEqual(
    plain(c.ligneHistoriqueVrac_('2026/08/12', { nom: '06 · Études & diplômes', id: 'z' }, { n: 0, tronque: false, erreur: true })),
    ['2026/08/12', '06 · Études & diplômes', '', '', 'oui']);
});

/* ---------- budgetJourHistoriqueVrac_ (PURE sur props) ---------- */

test('budgetJourHistoriqueVrac_ : ne vaut que si la date persistée est CELLE D\'AUJOURD\'HUI', () => {
  const c = ctx();
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(c.budgetJourHistoriqueVrac_(props({ DriveAI_VRAC_JOUR_MS: '2026/08/12|45000' }), '2026/08/12'), 45000);
  assert.strictEqual(c.budgetJourHistoriqueVrac_(props({ DriveAI_VRAC_JOUR_MS: '2026/08/11|45000' }), '2026/08/12'), 0,
    'rollover : le budget de la veille ne s\'affiche jamais comme celui du jour');
  assert.strictEqual(c.budgetJourHistoriqueVrac_(props({}), '2026/08/12'), 0);
});

/* ---------- domainesHistoriqueVrac_ : MÊME périmètre que la génération de la consolidation ---------- */

test('domainesHistoriqueVrac_ : domaines fixes + auto DÉJÀ NÉS seulement (jamais un auto pas encore créé)', () => {
  const c = ctx();
  const noms = Object.keys(c.CONFIG.DOMAINES);
  const auto = c.CONFIG.DOMAINES_AUTO || [];
  assert.ok(auto.length >= 1, 'ce test suppose au moins un domaine auto configuré');
  // Seul le PREMIER domaine auto est « né » (Property posée) ; le reste ne doit PAS apparaître.
  const props = { getProperty: (k) => (k === 'DriveAI_DOM_' + auto[0] ? 'un-id' : null) };
  const domaines = c.domainesHistoriqueVrac_(props);
  assert.strictEqual(domaines.length, noms.length + 1);
  assert.ok(domaines.some((d) => d.nom === auto[0]));
  if (auto[1]) assert.ok(!domaines.some((d) => d.nom === auto[1]), 'domaine auto pas encore né → absent');
});

/* ---------- majHistoriqueVrac_ : orchestration I/O (garde quotidienne + interleaving + reprise) ---------- */

function ctxMaj(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.props);
  const P = { getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } };
  const ecritures = [];
  let appelsComptage = 0;
  // Onglet DÉJÀ créé en prod (PR #263, 4 colonnes) : E1 VIDE par défaut, sauf `opts.enteteE1` fourni
  // (simule une Sheet déjà réparée) — patron réel, jamais réécrit par `initialiserSheet_` (dead code
  // pour un onglet existant, cf. Journal.gs).
  let e1 = 'enteteE1' in opts ? opts.enteteE1 : '';
  const e1Ecritures = [];
  const c = load(['Config.gs', 'HistoriqueVrac.gs'], {
    PropertiesService: { getScriptProperties: () => P },
    dateGmail_: () => '2026/08/12',
    compterVracRacineDomaine_: (id) => {
      appelsComptage++;
      return (opts.comptes && opts.comptes[id]) || { n: 0, tronque: false, erreur: false };
    },
    // Injecté directement (jamais via Journal.gs : sa déclaration `function feuille_` écraserait
    // ce mock — patron déjà établi par fusion-exec.test.js/ctxPlan).
    COLONNES_HISTORIQUE_VRAC: ['Date', 'Domaine', 'Vrac', 'Tronqué', 'Erreur'],
    feuille_: () => ({
      getLastRow: () => opts.dernLigne || 1,
      getRange: (a, col, nb, larg) => {
        if (typeof a === 'string') { // notation A1 (ex. 'E1') : cellule unique
          return { getValue: () => e1, setValue: (v) => { e1 = v; e1Ecritures.push(v); } };
        }
        return { setValues: (v) => ecritures.push({ ligne: a, valeurs: v }) };
      },
    }),
  });
  return { c, store, ecritures, appelsComptage: () => appelsComptage, e1: () => e1, e1Ecritures };
}

test('majHistoriqueVrac_ : jour déjà fait → no-op TOTAL (aucune I/O Drive/Sheet)', () => {
  const { c, ecritures, appelsComptage } = ctxMaj({ props: { DriveAI_VRAC_HISTO_JOUR: '2026/08/12' } });
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(appelsComptage(), 0);
  assert.strictEqual(ecritures.length, 0);
});

test('majHistoriqueVrac_ : sweep complète en un run → écrit toutes les lignes, marque le jour ET remet le curseur à 0', () => {
  const { c, store, ecritures } = ctxMaj({ dernLigne: 5 });
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(ecritures.length, 1, 'une seule écriture Sheet groupée');
  assert.strictEqual(ecritures[0].ligne, 6, 'ajoutée APRÈS la dernière ligne (append-only)');
  assert.strictEqual(ecritures[0].valeurs.length, Object.keys(c.CONFIG.DOMAINES).length);
  assert.strictEqual(store.DriveAI_VRAC_HISTO_JOUR, '2026/08/12');
  assert.strictEqual(store.DriveAI_VRAC_HISTO_IDX, '0', 'curseur remis à 0, prêt pour demain');
  assert.ok(store.DriveAI_VRAC_JOUR_MS.startsWith('2026/08/12|'), 'budget quotidien consommé persisté');
});

test('majHistoriqueVrac_ : répare l\'en-tête E1 « Erreur » sur l\'onglet DÉJÀ créé en prod (initialiserSheet_ ne le touche jamais)', () => {
  const { c, e1, e1Ecritures } = ctxMaj({ dernLigne: 5 }); // E1 vide par défaut (état réel constaté en prod)
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(e1(), 'Erreur');
  assert.deepStrictEqual(e1Ecritures, ['Erreur'], 'une seule écriture — pas de réparation répétée si déjà posée');
});

test('majHistoriqueVrac_ : E1 déjà réparé → aucune écriture d\'en-tête superflue', () => {
  const { e1, e1Ecritures, c } = ctxMaj({ dernLigne: 5, enteteE1: 'Erreur' });
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(e1(), 'Erreur');
  assert.deepStrictEqual(e1Ecritures, [], 'E1 déjà posé : jamais réécrit');
});

test('majHistoriqueVrac_ : un domaine en erreur n\'interrompt PAS la sweep — le curseur avance, le jour se termine, ligne Erreur écrite pour lui seul', () => {
  const c0 = ctx();
  const noms = Object.keys(c0.CONFIG.DOMAINES);
  const idErreur = c0.CONFIG.DOMAINES[noms[0]];
  const { c, store, ecritures, appelsComptage } = ctxMaj({
    dernLigne: 1,
    comptes: { [idErreur]: { n: 0, tronque: false, erreur: true } }, // les autres domaines gardent le défaut { n:0, erreur:false }
  });
  c.majHistoriqueVrac_(() => false);
  const total = noms.length;
  assert.strictEqual(appelsComptage(), total, 'TOUS les domaines comptés, y compris ceux après celui en erreur');
  assert.strictEqual(store.DriveAI_VRAC_HISTO_JOUR, '2026/08/12', 'un domaine en erreur ne bloque jamais la fin de la sweep');
  const ligneErreur = plain(ecritures[0].valeurs[0]); // 1er domaine = celui mocké en erreur
  assert.deepStrictEqual(ligneErreur, ['2026/08/12', noms[0], '', '', 'oui'], 'Vrac VIDE + Erreur "oui", jamais un faux 0');
});

test('majHistoriqueVrac_ : le garde-temps est vérifié AVANT CHAQUE domaine — jamais une sélection non bornée suivie d\'un lot non gardé', () => {
  const { c, store, ecritures, appelsComptage } = ctxMaj({ dernLigne: 1 });
  let appelsGarde = 0;
  c.majHistoriqueVrac_(() => { appelsGarde++; return appelsGarde > 2; }); // laisse passer 2 domaines sur N
  // Le nombre d'APPELS RÉELS à compterVracRacineDomaine_ doit être EXACTEMENT 2 — pas « tous les
  // domaines sélectionnés puis coupés au rendu » (c'était le bug : une sélection pure sans I/O
  // laissait passer TOUS les domaines, puis le comptage s'exécutait ensuite sans aucune coupure).
  assert.strictEqual(appelsComptage(), 2, 'le comptage Drive lui-même doit être interrompu, pas seulement la sélection');
  assert.ok(ecritures.length === 1 && ecritures[0].valeurs.length === 2);
  assert.strictEqual(store.DriveAI_VRAC_HISTO_JOUR, undefined, 'jour NON marqué — passe interrompue, jamais un faux terminé');
  assert.strictEqual(store.DriveAI_VRAC_HISTO_IDX, '2', 'curseur persisté pour reprendre au bon domaine au prochain run');
});

test('majHistoriqueVrac_ : reprise le lendemain d\'une passe interrompue hier → termine à partir du curseur, sans re-compter les domaines déjà faits', () => {
  const { c, store, ecritures, appelsComptage } = ctxMaj({
    dernLigne: 3,
    props: { DriveAI_VRAC_HISTO_JOUR: '2026/08/11', DriveAI_VRAC_HISTO_IDX: '2' }, // hier, interrompu au 3e domaine
  });
  const total = Object.keys(c.CONFIG.DOMAINES).length;
  c.majHistoriqueVrac_(() => false); // aujourd'hui (dateGmail_ mocké à 2026/08/12) : jour différent → reprend
  assert.strictEqual(appelsComptage(), total - 2, 'seuls les domaines RESTANTS sont comptés');
  assert.strictEqual(ecritures[0].valeurs.length, total - 2);
  assert.strictEqual(store.DriveAI_VRAC_HISTO_JOUR, '2026/08/12');
});

test('majHistoriqueVrac_ : budget QUOTIDIEN déjà épuisé aujourd\'hui → no-op TOTAL, repris demain', () => {
  const { c, ecritures, appelsComptage } = ctxMaj({
    props: { DriveAI_VRAC_JOUR_MS: '2026/08/12|' + (4 * 60 * 1000) }, // déjà au plafond du jour
  });
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(appelsComptage(), 0, 'aucun comptage tenté — le budget du JOUR est épuisé, pas seulement celui du run');
  assert.strictEqual(ecritures.length, 0);
});

test('majHistoriqueVrac_ : CONFIG.HISTORIQUE_VRAC_ACTIF=false → suspension immédiate (comme les autres campagnes)', () => {
  const { c, ecritures } = ctxMaj({});
  c.CONFIG.HISTORIQUE_VRAC_ACTIF = false;
  c.majHistoriqueVrac_(() => false);
  assert.strictEqual(ecritures.length, 0);
});
