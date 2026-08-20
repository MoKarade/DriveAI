'use strict';
/**
 * doublons.test.js — validation de `_Doublons` par empreinte (C28-49 PR4, ADR-0047).
 *
 * Verrouille la logique PURE (survivant, clôture, bilan, ligne Santé, URL, budget) ET les trois
 * propriétés d'orchestration qui font la CORRECTION de cette campagne :
 *  1. le garde-temps est évalué AVANT CHAQUE page réseau, dans la boucle qu'il protège ;
 *  2. les verdicts d'une page sont écrits AVANT que son jeton ne soit persisté — une page sautée
 *     produirait de FAUX orphelins, invisibles ;
 *  3. l'inventaire est idempotent PAR ID : une page re-lue après coupure ne duplique aucune ligne.
 * Et l'invariant NON NÉGOCIABLE : la campagne ne MUTE rien (aucun moveTo, aucun setTrashed).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { load } = require('./harness');

function plain(x) { return JSON.parse(JSON.stringify(x)); }

function ctx() { return load(['Config.gs', 'Doublons.gs']); }

/* ---------- estExemplaireSurvivant_ (PURE) ---------- */

test('estExemplaireSurvivant_ : sans md5Checksum on ne confirme RIEN (natif Google) — jamais de devinette', () => {
  const c = ctx();
  assert.strictEqual(c.estExemplaireSurvivant_({ parents: ['02'] }, 'DBL'), false);
  assert.strictEqual(c.estExemplaireSurvivant_({ md5Checksum: '', parents: ['02'] }, 'DBL'), false);
  assert.strictEqual(c.estExemplaireSurvivant_(null, 'DBL'), false);
});

test('estExemplaireSurvivant_ : un fichier dont `_Doublons` est le SEUL parent ne se confirme pas lui-même', () => {
  const c = ctx();
  assert.strictEqual(c.estExemplaireSurvivant_({ md5Checksum: 'aa', parents: ['DBL'] }, 'DBL'), false);
  assert.strictEqual(c.estExemplaireSurvivant_({ md5Checksum: 'aa', parents: [] }, 'DBL'), false);
});

test('estExemplaireSurvivant_ : multi-parents dont un domaine → SURVIVANT (le fichier est resté classé)', () => {
  const c = ctx();
  assert.strictEqual(c.estExemplaireSurvivant_({ md5Checksum: 'aa', parents: ['DBL', '02'] }, 'DBL'), true);
  assert.strictEqual(c.estExemplaireSurvivant_({ md5Checksum: 'aa', parents: ['06'] }, 'DBL'), true);
});

/* ---------- verdictClotureDoublon_ (PURE) ---------- */

test('verdictClotureDoublon_ : sans empreinte c\'est INDÉTERMINÉ, jamais « orphelin » — un aveu ne se compte pas comme une donnée', () => {
  const c = ctx();
  assert.strictEqual(c.verdictClotureDoublon_('').verdict, c.VERDICT_DOUBLON_INDETERMINE);
  assert.strictEqual(c.verdictClotureDoublon_('d41d8c').verdict, c.VERDICT_DOUBLON_ORPHELIN);
  assert.ok(/aucun exemplaire/.test(c.verdictClotureDoublon_('d41d8c').preuve));
});

/* ---------- urlListeDrive_ (PURE) ---------- */

test('urlListeDrive_ : le `q` est ENCODÉ (apostrophes et espaces) et le jeton omis à la première page', () => {
  const c = ctx();
  const u = c.urlListeDrive_("'ID' in parents and trashed = false", 'files(id)', '', 1000);
  const q = u.split('?')[1].split('&')[0];
  // `encodeURIComponent` laisse l'apostrophe telle quelle (elle est légale dans une query string,
  // et c'est l'idiome déjà utilisé par `raccourciExiste_`) mais encode espaces et `=` — sans quoi
  // le `=` de `trashed = false` couperait le paramètre en deux et le filtre sauterait EN SILENCE.
  assert.ok(!/ /.test(q), 'aucun espace brut dans le paramètre q');
  assert.ok(/%3D/.test(q), 'le `=` du filtre est encodé (sinon le q est tronqué au premier `=`)');
  assert.ok(u.indexOf('pageToken') === -1, 'première page : pas de pageToken');
  assert.ok(c.urlListeDrive_('q', 'f', 'JETON+/=', 1000).indexOf('pageToken=JETON%2B%2F%3D') > 0,
    'le jeton est encodé (il contient +, / et = en base64)');
});

/* ---------- bilanDoublons_ / ligneSanteDoublons_ (PURES) ---------- */

test('bilanDoublons_ : compte par verdict, et une ligne SANS verdict est « restante », jamais un orphelin', () => {
  const c = ctx();
  const b = plain(c.bilanDoublons_(['confirmé', 'orphelin', 'orphelin', 'indéterminé', '', null]));
  assert.deepStrictEqual(b, { total: 6, confirmes: 1, orphelins: 2, indetermines: 1, restants: 2 });
});

test('ligneSanteDoublons_ : dit la PHASE réelle — jamais un « OK » qui masque une campagne en cours', () => {
  const c = ctx();
  const b = plain(c.bilanDoublons_(['confirmé', 'orphelin', '']));
  assert.ok(/inventaire/.test(c.ligneSanteDoublons_(c.PHASE_DOUBLONS_INVENTAIRE, b)));
  assert.ok(/balayage/.test(c.ligneSanteDoublons_(c.PHASE_DOUBLONS_BALAYAGE, b)));
  const fini = c.ligneSanteDoublons_(c.PHASE_DOUBLONS_FINI, b);
  assert.ok(/terminée/.test(fini) && /ORPHELINS/.test(fini), 'le compte d\'orphelins est LE livrable : il doit être lisible');
});

/* ---------- budgetJourDoublons_ (PURE sur props) ---------- */

test('budgetJourDoublons_ : le budget de la veille ne compte jamais pour aujourd\'hui', () => {
  const c = ctx();
  const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });
  assert.strictEqual(c.budgetJourDoublons_(props({ DriveAI_DOUBLONS_JOUR_MS: '2026/08/20|1200' }), '2026/08/20'), 1200);
  assert.strictEqual(c.budgetJourDoublons_(props({ DriveAI_DOUBLONS_JOUR_MS: '2026/08/19|1200' }), '2026/08/20'), 0);
  assert.strictEqual(c.budgetJourDoublons_(props({}), '2026/08/20'), 0);
});

/* ---------- orchestration I/O ---------- */

/**
 * Onglet en mémoire : `getRange(ligne, col, nb, larg)` + getValues/setValues, comme un vrai.
 * La GRILLE est simulée (`maxRows`, 1 000 par défaut comme `insertSheet`) et `setValues` LÈVE au-delà,
 * exactement comme Apps Script (« those rows are out of bounds ») — sans quoi le correctif
 * d'agrandissement serait verrouillé par un test qui ne peut pas le voir échouer.
 */
function faireOnglet(lignes, maxRows) {
  const data = lignes.map((l) => l.slice()); // ligne 1 = en-tête incluse
  let grille = maxRows === undefined ? 1000 : maxRows;
  return {
    data,
    getLastRow: () => data.length,
    getMaxRows: () => grille,
    insertRowsAfter: (apres, nb) => { grille += nb; },
    deleteRows: (debut, nb) => { data.splice(debut - 1, nb); },
    getRange: (ligne, col, nb, larg) => ({
      getValue: () => (data[ligne - 1] || [])[col - 1],
      setValue: (v) => { (data[ligne - 1] = data[ligne - 1] || [])[col - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < nb; i++) {
          const r = [];
          for (let j = 0; j < (larg || 1); j++) r.push(((data[ligne - 1 + i] || [])[col - 1 + j]) || '');
          out.push(r);
        }
        return out;
      },
      setValues: (v) => {
        if (ligne - 1 + v.length > grille) {
          throw new Error('Those rows are out of bounds. (ligne ' + (ligne + v.length - 1) +
            ' > grille ' + grille + ')');
        }
        for (let i = 0; i < v.length; i++) {
          const r = (data[ligne - 1 + i] = data[ligne - 1 + i] || []);
          for (let j = 0; j < v[i].length; j++) r[col - 1 + j] = v[i][j];
        }
      },
    }),
  };
}

/**
 * @param {Array<{files:Array, nextPageToken?:string}>} pages  réponses successives de files.list
 * @param {Object} opts  {props, onglet, garde}
 */
function ctxMaj(pages, opts) {
  opts = opts || {};
  const store = Object.assign({ DriveAI_DOUBLONS_ID: 'DBL' }, opts.props);
  const P = {
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  };
  const onglet = opts.onglet || faireOnglet([['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté']]);
  const urls = [];
  // Trace ORDONNÉE des effets : sert à prouver « verdicts écrits AVANT le jeton persisté ».
  const trace = [];
  let i = 0;
  const c = load(['Config.gs', 'Doublons.gs'], {
    PropertiesService: { getScriptProperties: () => P },
    dateGmail_: () => '2026/08/20',
    journalInfo_: (src, msg) => trace.push('journal:' + msg.slice(0, 24)),
    journalErreur_: () => {},
    tronquer_: (s) => String(s),
    jetonDrive_: () => 'jeton',
    // Résolution SANS création : Property posée (cas normal en prod depuis le 1er doublon).
    DriveApp: { getFolderById: (id) => ({ getId: () => id }) },
    feuille_: () => onglet,
    fetchDriveAvecRetry_: (url) => {
      urls.push(url);
      trace.push('fetch');
      const p = pages[i++] || { files: [] };
      if (p.http && p.http !== 200) {
        return { getResponseCode: () => p.http, getContentText: () => p.corps || '' };
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ files: p.files || [], nextPageToken: p.nextPageToken || undefined }),
      };
    },
  });
  // Instrumentation APRÈS chargement : on observe l'ordre réel des écritures d'état.
  const setProperty = P.setProperty;
  P.setProperty = (k, v) => { if (k === 'DriveAI_DOUBLONS_PAGE') trace.push('jeton:' + v); setProperty(k, v); };
  const ecrireOrig = onglet.getRange;
  onglet.getRange = (ligne, col, nb, larg) => {
    const r = ecrireOrig(ligne, col, nb, larg);
    const setValues = r.setValues;
    r.setValues = (v) => { if (col === 4) trace.push('verdicts'); setValues(v); };
    return r;
  };
  return { c, store, onglet, urls, trace, pagesLues: () => i };
}

test('majValidationDoublons_ : inventaire puis balayage puis clôture — 1 confirmé, 1 orphelin, 1 indéterminé', () => {
  const balayage = () => ({ files: [
    { id: 'F1', md5Checksum: 'AAA', parents: ['DBL'] },      // lui-même : ne se confirme pas
    { id: 'G1', md5Checksum: 'AAA', parents: ['DOM02'] },    // exemplaire encore classé → confirme F1
    { id: 'F2', md5Checksum: 'BBB', parents: ['DBL'] },      // seul porteur de BBB hors DBL : aucun
  ] });
  const { c, store, onglet } = ctxMaj([
    // Phase 1 : `_Doublons` (une page)
    { files: [
      { id: 'F1', name: 'passeport.pdf', md5Checksum: 'AAA' },
      { id: 'F2', name: 'bulletin.pdf', md5Checksum: 'BBB' },
      { id: 'F3', name: 'note.gdoc' }, // natif : pas de md5
    ] },
    balayage(), // passe 1 — ne peut PAS conclure « orphelin » (preuve d'absence non atomique)
    balayage(), // passe 2 — c'est elle qui autorise la clôture
  ]);
  c.majValidationDoublons_(() => false); // passe 1
  c.majValidationDoublons_(() => false); // passe 2 + clôture
  assert.strictEqual(store.DriveAI_DOUBLONS_PHASE, c.PHASE_DOUBLONS_FINI);
  const lignes = onglet.data.slice(1);
  assert.strictEqual(lignes.length, 3);
  assert.strictEqual(lignes[0][3], c.VERDICT_DOUBLON_CONFIRME);
  assert.ok(/G1/.test(String(lignes[0][4])), 'la preuve NOMME l\'exemplaire trouvé');
  assert.strictEqual(lignes[1][3], c.VERDICT_DOUBLON_ORPHELIN);
  assert.strictEqual(lignes[2][3], c.VERDICT_DOUBLON_INDETERMINE);
});

test('majValidationDoublons_ : le garde-temps coupe AVANT le premier appel réseau (jamais une page non bornée)', () => {
  const { c, pagesLues, store } = ctxMaj([{ files: [{ id: 'F1', name: 'a', md5Checksum: 'A' }] }]);
  c.majValidationDoublons_(() => true);
  assert.strictEqual(pagesLues(), 0, 'aucune requête : le garde est évalué DANS la boucle, avant l\'appel');
  assert.strictEqual(store.DriveAI_DOUBLONS_PHASE, c.PHASE_DOUBLONS_INVENTAIRE, 'phase inchangée');
});

test('majValidationDoublons_ : le garde-temps coupe ENTRE deux pages — le jeton reprend là où il s\'est arrêté', () => {
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'A' }], nextPageToken: 'P2' },
    { files: [{ id: 'F2', name: 'b', md5Checksum: 'B' }] },
  ]);
  const { c, store, pagesLues } = h;
  c.majValidationDoublons_(() => h.pagesLues() >= 1); // coupe dès qu'une page a été lue
  assert.strictEqual(pagesLues(), 1, 'une seule page lue');
  assert.strictEqual(store.DriveAI_DOUBLONS_PAGE, 'P2', 'le jeton de reprise est persisté');
  assert.strictEqual(store.DriveAI_DOUBLONS_PHASE, c.PHASE_DOUBLONS_INVENTAIRE);
});

test('le garde-temps coupe AUSSI dans la boucle du BALAYAGE, pas seulement dans celle de l\'inventaire', () => {
  // Un garde présent dans UNE des deux boucles « a l'air » présent : la mutation qui le retire de
  // l'autre laisse la suite verte (leçon §9 — un garde doit vivre DANS la boucle qu'il protège, et
  // seul le NOMBRE d'appels RÉELS à l'opération protégée le prouve, jamais la taille du résultat).
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] }, // inventaire : 1 page, pas de suite
    { files: [], nextPageToken: 'B2' },                       // balayage p1
    { files: [], nextPageToken: 'B3' },                       // balayage p2 — NE DOIT PAS être lue
    { files: [] },
  ]);
  h.c.majValidationDoublons_(() => h.pagesLues() >= 2); // coupe dès que 2 pages réseau ont été lues
  assert.strictEqual(h.pagesLues(), 2, 'le balayage s\'arrête ENTRE deux pages');
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PHASE, h.c.PHASE_DOUBLONS_BALAYAGE,
    'une campagne coupée par le garde ne se déclare JAMAIS terminée');
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PAGE, 'B2', 'reprend exactement à la page suivante');
});

test('ORDRE DES ÉCRITURES : les verdicts d\'une page sont écrits AVANT que son jeton n\'avance', () => {
  const { c, trace } = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },            // inventaire (1 page)
    { files: [{ id: 'G1', md5Checksum: 'AAA', parents: ['D'] }], nextPageToken: 'P2' }, // balayage p1 : tranche
    { files: [] },                                                       // balayage p2 : clôture
  ]);
  c.majValidationDoublons_(() => false);
  const iVerdict = trace.indexOf('verdicts');
  const iJetonP2 = trace.indexOf('jeton:P2');
  assert.ok(iVerdict > -1 && iJetonP2 > -1, 'les deux effets ont bien eu lieu');
  assert.ok(iVerdict < iJetonP2,
    'un jeton persisté AVANT ses verdicts ferait sauter la page après une coupure → FAUX orphelins. Trace : ' + trace.join(' > '));
});

test('inventaire IDEMPOTENT par ID : une page re-lue après coupure ne duplique aucune ligne', () => {
  const onglet = faireOnglet([
    ['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté'],
    ['a', 'F1', 'AAA', '', '', ''],
  ]);
  const { c } = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }, { id: 'F2', name: 'b', md5Checksum: 'BBB' }] },
    { files: [] },
  ], { onglet, props: { DriveAI_DOUBLONS_VERSION: 'd1' } });
  c.majValidationDoublons_(() => false);
  const ids = onglet.data.slice(1).map((l) => l[1]);
  assert.deepStrictEqual(ids, ['F1', 'F2'], 'F1 n\'est PAS ré-ajouté : la re-lecture d\'une page est un no-op');
});

test('une page en erreur HTTP LÈVE — jamais un « aucun exemplaire ailleurs » sur un Drive à moitié lu', () => {
  const { c, store } = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { http: 500, corps: 'boom' },
  ]);
  assert.throws(() => c.majValidationDoublons_(() => false), /files\.list HTTP 500/);
  assert.notStrictEqual(store.DriveAI_DOUBLONS_PHASE, c.PHASE_DOUBLONS_FINI,
    'une campagne interrompue par une panne ne se déclare JAMAIS terminée');
  assert.ok(String(store.DriveAI_DOUBLONS_JOUR_MS || '').startsWith('2026/08/20|'),
    'le budget consommé est persisté même sur exception (finally) — jamais de fuite');
});

test('bump de version : le rapport est REMIS À ZÉRO et tout est re-validé (verdict révisable, jamais figé à vie)', () => {
  const onglet = faireOnglet([
    ['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté'],
    ['vieux', 'X1', 'ZZZ', 'orphelin', 'ancienne preuve', ''],
  ]);
  const { c, store } = ctxMaj([{ files: [] }, { files: [] }], {
    onglet, props: { DriveAI_DOUBLONS_VERSION: 'd0', DriveAI_DOUBLONS_PHASE: 'fini' },
  });
  c.majValidationDoublons_(() => false);
  assert.strictEqual(store.DriveAI_DOUBLONS_VERSION, c.CONFIG.DOUBLONS_TABLE_VERSION);
  assert.deepStrictEqual(onglet.data.slice(1), [], 'les lignes de l\'ancienne version sont purgées');
});

test('à la CLÔTURE le bilan est FIGÉ en Property, et la ligne Santé ne relit plus l\'onglet ensuite', () => {
  // Sans ce court-circuit, la campagne TERMINÉE resterait le seul poste à relire ~1 076 cellules
  // 288 fois par jour, à vie (leçon §9 : une exposition par-tick hérite du court-circuit de son
  // producteur, sinon elle devient le poste qui continue de payer une fois le travail fini).
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [{ id: 'G1', md5Checksum: 'AAA', parents: ['DOM'] }] }, // balayage 1/2
    { files: [{ id: 'G1', md5Checksum: 'AAA', parents: ['DOM'] }] }, // balayage 2/2 → clôture
  ]);
  h.c.majValidationDoublons_(() => false);
  h.c.majValidationDoublons_(() => false);
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PHASE, h.c.PHASE_DOUBLONS_FINI);
  const fige = JSON.parse(h.store.DriveAI_DOUBLONS_BILAN);
  assert.strictEqual(fige.total, 1);
  assert.strictEqual(fige.confirmes, 1);
  // La ligne Santé doit tenir SANS l'onglet : on le rend inutilisable pour le prouver.
  h.onglet.getLastRow = () => { throw new Error('l\'onglet ne doit plus être lu après la clôture'); };
  const ligne = h.c.texteSanteDoublons_();
  assert.ok(/terminée/.test(ligne), 'la ligne Santé vient du bilan figé : ' + ligne);
  assert.ok(!/illisible/.test(ligne), 'et surtout pas du chemin d\'erreur');
});

test('campagne désactivée (CONFIG) → no-op TOTAL, aucune requête', () => {
  const { c, pagesLues } = ctxMaj([{ files: [{ id: 'F1', name: 'a', md5Checksum: 'A' }] }]);
  c.CONFIG.DOUBLONS_ACTIF = false;
  try { c.majValidationDoublons_(() => false); } finally { c.CONFIG.DOUBLONS_ACTIF = true; }
  assert.strictEqual(pagesLues(), 0);
});

test('UNE seule passe de balayage ne suffit PAS à prononcer « orphelin » (preuve d\'absence non atomique)', () => {
  // `files.list` paginé n'est pas un instantané : un fichier déplacé entre la page k et k+1 peut
  // n'apparaître dans AUCUNE page. Conclure « aucun exemplaire ailleurs » sur une seule passe, c'est
  // fonder un verdict — que ADR-0046 utilisera pour DÉPLACER — sur une absence trouée.
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [] }, // balayage 1/2 : rien trouvé
    { files: [] }, // balayage 2/2 : toujours rien → là seulement, orphelin
  ]);
  h.c.majValidationDoublons_(() => false);
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PHASE, h.c.PHASE_DOUBLONS_BALAYAGE,
    'après UNE passe complète, la campagne reste en balayage');
  assert.strictEqual(h.onglet.data[1][3], '', 'aucun verdict prononcé après une seule passe');
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PASSES, '1');
  h.c.majValidationDoublons_(() => false);
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PHASE, h.c.PHASE_DOUBLONS_FINI);
  assert.strictEqual(h.onglet.data[1][3], h.c.VERDICT_DOUBLON_ORPHELIN);
});

test('une zone de TRANSIT ne prouve pas la survie : un jumeau qui n\'est que dans `00 · À trier` ne confirme rien', () => {
  const c0 = ctx();
  const aTrier = c0.CONFIG.DOSSIERS.A_TRIER;
  // Cas vécu : X attend dans `00 · À trier` ; l'intake du tick suivant verra son empreinte à l'Index
  // et l'enverra dans `_Doublons`. Le compter « confirmé » ferait dire à la campagne l'inverse de ce
  // qu'elle mesure, une heure avant que ce soit faux.
  assert.strictEqual(c0.estExemplaireSurvivant_({ md5Checksum: 'A', parents: [aTrier] }, 'DBL', [aTrier]), false);
  assert.strictEqual(c0.estExemplaireSurvivant_({ md5Checksum: 'A', parents: [aTrier, 'DOM'] }, 'DBL', [aTrier]), true,
    'mais un second parent qui est un domaine, lui, prouve bien la survie');
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [{ id: 'T1', md5Checksum: 'AAA', parents: [aTrier] }] },
    { files: [{ id: 'T1', md5Checksum: 'AAA', parents: [aTrier] }] },
  ]);
  h.c.majValidationDoublons_(() => false);
  h.c.majValidationDoublons_(() => false);
  assert.strictEqual(h.onglet.data[1][3], h.c.VERDICT_DOUBLON_ORPHELIN,
    'le jumeau en transit ne confirme rien : F1 reste le seul exemplaire connu');
});

test('la requête de balayage exclut les fichiers d\'un TIERS (`me` in owners)', () => {
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [] }, { files: [] },
  ]);
  h.c.majValidationDoublons_(() => false);
  h.c.majValidationDoublons_(() => false);
  const balayage = h.urls[1];
  assert.ok(/owners/.test(decodeURIComponent(balayage)),
    'sans `me in owners`, un exemplaire appartenant à un TIERS confirmerait le doublon — et le tiers ' +
    'peut révoquer le partage, laissant Marc sans aucune copie. URL : ' + decodeURIComponent(balayage));
});

test('un jeton de pagination REFUSÉ (400) remet la campagne à la page 1 — le seul mode de panne sans issue', () => {
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [], nextPageToken: 'B2' },
    { http: 400, corps: 'invalid page token' },
  ]);
  // Un seul run : inventaire, balayage p1 (jeton B2 persisté), puis p2 refusée.
  assert.throws(() => h.c.majValidationDoublons_(() => false), /HTTP 400/);
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PAGE, '',
    'jeton remis à zéro : sans ça, la campagne rejoue le MÊME appel refusé à vie');
  assert.ok(/HTTP 400/.test(h.store.DriveAI_DOUBLONS_ERREUR),
    'et la panne est exposée — la campagne n\'a pas d\'entrée dans le registre de suivi (saturé)');
  assert.ok(/dernière erreur/.test(h.c.texteSanteDoublons_()), 'la ligne Santé la dit');
});

test('un 429 (throttling) ne remet PAS le jeton à zéro — le jeton est bon, repartir coûterait une passe', () => {
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [], nextPageToken: 'B2' },
    { http: 429, corps: 'rate limited' },
  ]);
  assert.throws(() => h.c.majValidationDoublons_(() => false), /HTTP 429/);
  assert.strictEqual(h.store.DriveAI_DOUBLONS_PAGE, 'B2', 'reprise EXACTEMENT où on en était');
});

test('bump de version : le BILAN figé part avec le rapport (jamais les chiffres de la campagne précédente)', () => {
  const onglet = faireOnglet([['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté']]);
  const h = ctxMaj([{ files: [] }], {
    onglet,
    props: {
      DriveAI_DOUBLONS_VERSION: 'd0',
      DriveAI_DOUBLONS_PHASE: 'fini',
      DriveAI_DOUBLONS_BILAN: JSON.stringify({ total: 1076, confirmes: 900, orphelins: 150, indetermines: 26, restants: 0 }),
    },
  });
  h.c.majValidationDoublons_(() => false);
  // `_Doublons` est vide cette fois : la vraie réponse est 0. Sans purge du bilan, la ligne Santé
  // annoncerait « 150 ORPHELINS » au-dessus d'un onglet vide — une donnée fabriquée.
  const bilan = JSON.parse(h.store.DriveAI_DOUBLONS_BILAN);
  assert.strictEqual(bilan.total, 0);
  assert.strictEqual(bilan.orphelins, 0);
  assert.ok(!/150/.test(h.c.texteSanteDoublons_()), 'la ligne Santé : ' + h.c.texteSanteDoublons_());
});

/* ---------- TRIPWIRE : la campagne ne MUTE rien ---------- */

test('l\'inventaire AGRANDIT la grille avant d\'écrire : sans ça, la 1ʳᵉ page dépasse les 1 000 lignes par défaut', () => {
  // Cas réel : `_Doublons` contient 1 076 fichiers et l'inventaire écrit une page ENTIÈRE d'un coup
  // à partir de la ligne 2 — la grille d'un onglet neuf en fait 1 000. Symptôme sans le correctif :
  // la même exception à chaque tick, avalée par le try/catch de `Main.gs` et prise pour du bruit,
  // phase figée sur `inventaire`, ligne Santé qui annonce sereinement « inventaire en cours ».
  // Grille volontairement minuscule ici (en-tête + 1 ligne) : le franchissement est le même.
  const onglet = faireOnglet([['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté']], 2);
  const h = ctxMaj([
    { files: [
      { id: 'F1', name: 'a', md5Checksum: 'A1' },
      { id: 'F2', name: 'b', md5Checksum: 'A2' },
      { id: 'F3', name: 'c', md5Checksum: 'A3' },
    ] },
    { files: [] }, { files: [] },
  ], { onglet });
  h.c.majValidationDoublons_(() => false);
  h.c.majValidationDoublons_(() => false);
  assert.deepStrictEqual(onglet.data.slice(1).map((l) => l[1]), ['F1', 'F2', 'F3']);
  assert.strictEqual(onglet.getMaxRows(), 4, 'la grille a été étendue juste ce qu\'il fallait');
});

test('feuilleRapportDoublons_ répare un en-tête INCOMPLET (colonne ajoutée), pas seulement un A1 faux', () => {
  // Le patron cité (`majHistoriqueVrac_`) teste la cellule de la colonne AJOUTÉE. Tester A1 seul
  // laisse passer exactement le cas à réparer : un onglet resté à 5 colonnes a bien A1 = « Fichier ».
  const onglet = faireOnglet([['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve']]); // « Horodaté » manque
  const h = ctxMaj([{ files: [] }, { files: [] }], { onglet });
  h.c.majValidationDoublons_(() => false);
  assert.deepStrictEqual(onglet.data[0], ['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté']);
});

test('la ligne Santé de la campagne TERMINÉE est DATÉE — un total non daté vieillit en silence', () => {
  const h = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'AAA' }] },
    { files: [] }, { files: [] },
  ]);
  h.c.majValidationDoublons_(() => false);
  h.c.majValidationDoublons_(() => false);
  const ligne = h.c.texteSanteDoublons_();
  assert.ok(/terminée/.test(ligne) && /2026\/08\/20/.test(ligne),
    '`_Doublons` reste alimenté par le flux : sans date, « 1 076 écartés » cesse d\'être vrai sans le ' +
    'dire. Ligne : ' + ligne);
});

test('INVARIANT STRUCTUREL : tout chemin vers `fini` écrit son bilan JUSTE AVANT le drapeau', () => {
  // C'est cette garantie-là qui empêche la ligne Santé de servir les chiffres d'une campagne
  // précédente (revue quotas, BLOQUANT) — pas la purge au bump, qui n'est qu'une bretelle. Le risque
  // réel est un TROISIÈME chemin de clôture ajouté plus tard sans son bilan : aucun test de
  // comportement ne le verrait tant que ce chemin n'est pas exercé. On le verrouille donc sur la
  // FORME du code, comme le tripwire de mutation.
  const src = fs.readFileSync(require.resolve('../src/Doublons.gs'), 'utf8').split('\n');
  const drapeaux = [];
  src.forEach((l, n) => {
    if (/setProperty\(\s*'DriveAI_DOUBLONS_PHASE'\s*,\s*PHASE_DOUBLONS_FINI\s*\)/.test(l)) drapeaux.push(n);
  });
  assert.ok(drapeaux.length >= 2, 'les deux chemins de clôture connus sont bien là (trouvés : ' + drapeaux.length + ')');
  drapeaux.forEach((n) => {
    const avant = src.slice(Math.max(0, n - 6), n).join('\n');
    assert.ok(/setProperty\(\s*'DriveAI_DOUBLONS_BILAN'/.test(avant),
      'ligne ' + (n + 1) + ' pose `fini` sans avoir figé de bilan dans les 6 lignes précédentes : ' +
      'la ligne Santé y servirait le bilan de la campagne PRÉCÉDENTE.');
  });
});

test('TRIPWIRE §2 (LISTE BLANCHE) : Doublons.gs ne peut MUTER par aucune voie — ni DriveApp, ni REST, ni délégation', () => {
  const brut = fs.readFileSync(require.resolve('../src/Doublons.gs'), 'utf8');
  // On scanne le CODE, pas la prose : les commentaires de ce fichier NOMMENT justement les mutations
  // interdites pour expliquer pourquoi elles n'y sont pas (« `dossierDoublons_()` est un
  // find-or-CREATE, donc on ne l'appelle pas »). Sans ce nettoyage, le tripwire se déclencherait sur
  // sa propre justification — et on serait tenté de retirer l'explication plutôt que le danger.
  const src = brut
    .replace(/\/\*[\s\S]*?\*\//g, '')                       // blocs /** … */
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'); // lignes de commentaire

  // (1) LISTE BLANCHE sur le verbe REST. Une liste NOIRE de motifs DriveApp ne peut pas verrouiller
  // un module qui parle REST : un `method: 'patch'` avec addParents déplacerait un fichier sans que
  // `moveTo` apparaisse nulle part. On exige donc que la SEULE méthode HTTP du fichier soit `get`.
  const methodes = [...src.matchAll(/method\s*:\s*['"]([a-zA-Z]+)['"]/g)].map((m) => m[1].toLowerCase());
  assert.ok(methodes.length > 0, 'le fichier fait bien au moins un appel REST (sinon ce verrou ne verrouille rien)');
  assert.deepStrictEqual([...new Set(methodes)], ['get'],
    'seule la méthode `get` est permise dans cette campagne ; trouvé : ' + methodes.join(', '));

  // (2) Les DÉLÉGATIONS mutantes du projet — le vecteur naturel ici, et celui qu'une liste de motifs
  // DriveApp laisse passer : prouvé par mutation (une injection de `deplacerEtRenommer_` laissait la
  // première version de ce tripwire VERTE, seuls deux tests de comportement tombaient).
  // Cette campagne est un CONSTAT. Le jour où quelqu'un y ajoute un déplacement « pendant qu'on y
  // est », c'est ADR-0047 §4 qui saute — et le fichier déplacé serait un exemplaire qu'on vient de
  // déclarer irremplaçable.
  [/\.moveTo\s*\(/, /setTrashed\s*\(/, /removeFile\s*\(/, /\.setName\s*\(/, /trashed"?\s*:\s*true/i,
    /addParents|removeParents/,
    /deplacerEtRenommer_\s*\(/, /appliquerDeplacerFichier_\s*\(/, /renommerFichier_\s*\(/, /deposer_\s*\(/,
    /dossierDoublons_\s*\(/, /dossierRacineParNom_\s*\(/, /sousDossier_\s*\(/,
    /createFolder\s*\(/, /createFile\s*\(/, /makeCopy\s*\(/, /createShortcut\s*\(/,
    /setSharing\s*\(/, /addEditor\s*\(/, /addViewer\s*\(/, /setContent\s*\(/,
  ].forEach((re) => {
    assert.ok(!re.test(src), 'mutation interdite trouvée dans Doublons.gs : ' + re);
  });
});
