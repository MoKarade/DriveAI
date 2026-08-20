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

/** Onglet en mémoire : `getRange(ligne, col, nb, larg)` + getValues/setValues, comme un vrai. */
function faireOnglet(lignes) {
  const data = lignes.map((l) => l.slice()); // ligne 1 = en-tête incluse
  return {
    data,
    getLastRow: () => data.length,
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
  const P = { getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); } };
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
  const { c, store, onglet } = ctxMaj([
    // Phase 1 : `_Doublons` (une page)
    { files: [
      { id: 'F1', name: 'passeport.pdf', md5Checksum: 'AAA' },
      { id: 'F2', name: 'bulletin.pdf', md5Checksum: 'BBB' },
      { id: 'F3', name: 'note.gdoc' }, // natif : pas de md5
    ] },
    // Phase 2 : balayage du Drive (une page)
    { files: [
      { id: 'F1', md5Checksum: 'AAA', parents: ['DBL'] },      // lui-même : ne se confirme pas
      { id: 'G1', md5Checksum: 'AAA', parents: ['DOM02'] },    // exemplaire encore classé → confirme F1
      { id: 'F2', md5Checksum: 'BBB', parents: ['DBL'] },      // seul porteur de BBB hors DBL : aucun
    ] },
  ]);
  c.majValidationDoublons_(() => false);
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
  let appels = 0;
  const { c, store, pagesLues } = ctxMaj([
    { files: [{ id: 'F1', name: 'a', md5Checksum: 'A' }], nextPageToken: 'P2' },
    { files: [{ id: 'F2', name: 'b', md5Checksum: 'B' }] },
  ]);
  c.majValidationDoublons_(() => (appels++ >= 1)); // laisse passer la 1re évaluation, coupe ensuite
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
    { files: [{ id: 'G1', md5Checksum: 'AAA', parents: ['DOM'] }] },
  ]);
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

/* ---------- TRIPWIRE : la campagne ne MUTE rien ---------- */

test('TRIPWIRE §2 : Doublons.gs ne contient AUCUNE mutation (moveTo, setTrashed, removeFile, setName, files.delete)', () => {
  const brut = fs.readFileSync(require.resolve('../src/Doublons.gs'), 'utf8');
  // On scanne le CODE, pas la prose : les commentaires de ce fichier NOMMENT justement les
  // mutations interdites pour expliquer pourquoi elles n'y sont pas (« `dossierDoublons_()` est un
  // find-or-CREATE, donc on ne l'appelle pas »). Sans ce nettoyage, le tripwire se déclencherait sur
  // sa propre justification — et on serait tenté de retirer l'explication plutôt que le danger.
  const src = brut
    .replace(/\/\*[\s\S]*?\*\//g, '')                       // blocs /** … */
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'); // lignes de commentaire
  // Cette campagne est un CONSTAT. Le jour où quelqu'un y ajoute un déplacement « pendant qu'on y
  // est », c'est ADR-0047 §4 qui saute (le rapatriement est une décision de Marc, chiffrée) — et
  // le fichier déplacé serait un exemplaire qu'on vient de déclarer irremplaçable.
  [/\.moveTo\s*\(/, /setTrashed\s*\(/, /removeFile\s*\(/, /\.setName\s*\(/, /trashed:\s*true/,
    /method:\s*'delete'/, /addParents|removeParents/,
    // find-or-CREATE : `dossierDoublons_()` (Router.gs) créerait un dossier vide dès que la Script
    // Property manque — une mutation Drive dans une campagne qui promet le contraire.
    /createFolder\s*\(/, /dossierDoublons_\s*\(/].forEach((re) => {
    assert.ok(!re.test(src), 'mutation interdite trouvée dans Doublons.gs : ' + re);
  });
});
