'use strict';
/**
 * C28-07 (plan P3) — Réconciliation Index ↔ Drive (campagne de fond, LECTURE SEULE côté Drive).
 *  - `decisionSyncIndex_` / `cheminsSyncCompatibles_` (purs) : corbeillé/déplacé/rien, jamais un
 *    faux « déplacé » sur un constat partiel (chemin illisible) ni sur un chemin d'Index vide.
 *  - `synchroniserIndex_` : ne compare que la ligne la plus RÉCENTE de chaque clé (prédicat de
 *    convergence — jamais de re-détection à vie depuis les vieilles lignes), curseur borné et
 *    reprenable, budget QUOTIDIEN en vérifications Drive (cas dérivés des CONSTANTES), passe
 *    complète → curseur remis à 2. AUCUNE mutation Drive (le mock lève sur tout le reste).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- fonctions PURES ---------- */

const pur = load(['Config.gs', 'Entites.gs', 'Maintenance.gs']);

test('cheminsSyncCompatibles_ : suffixe sur frontière de segment, normalisé, vide = compatible', () => {
  assert.strictEqual(pur.cheminsSyncCompatibles_('02 · Finances/Desjardins', 'DriveAI/02 · Finances/Desjardins'), true);
  assert.strictEqual(pur.cheminsSyncCompatibles_('02 · finances/desjardins', 'DriveAI/02 · Finances/Desjardins'), true); // casse
  assert.strictEqual(pur.cheminsSyncCompatibles_('_Doublons', 'DriveAI/_Doublons'), true);
  assert.strictEqual(pur.cheminsSyncCompatibles_('', 'DriveAI/03 · Logement'), true);   // ligne sans chemin (manuel)
  assert.strictEqual(pur.cheminsSyncCompatibles_('02 · Finances/Desjardins', 'DriveAI/03 · Logement & véhicule'), false);
  // Jamais un match au MILIEU d'un segment (« s/Desjardins » ne matche pas « Desjardins Assurances »).
  assert.strictEqual(pur.cheminsSyncCompatibles_('Desjardins', 'DriveAI/02/Desjardins Assurances'), false);
});

test('decisionSyncIndex_ : introuvable ou corbeillé → ligne « corbeillé » (constat, jamais une action)', () => {
  const plat = (o) => JSON.parse(JSON.stringify(o));
  assert.deepStrictEqual(
    plat(pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X' }, { existe: false, corbeille: false, nom: '', chemin: '' })),
    { statut: 'corbeillé', domaine: '', chemin: '02/X', nom: 'a.pdf' });
  assert.deepStrictEqual(
    plat(pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X' }, { existe: true, corbeille: true, nom: 'a.pdf', chemin: 'DriveAI/02/X' })),
    { statut: 'corbeillé', domaine: '', chemin: '02/X', nom: 'a.pdf' });
});

test('decisionSyncIndex_ : rien à constater quand nom ET chemin concordent — ou constat PARTIEL', () => {
  assert.strictEqual(
    pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02 · Finances' }, { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/02 · Finances' }),
    null);
  // Chemin constaté inconnu (branche illisible) → jamais un faux « déplacé » sur lecture partielle.
  assert.strictEqual(
    pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02 · Finances' }, { existe: true, corbeille: false, nom: 'a.pdf', chemin: '' }),
    null);
});

test('decisionSyncIndex_ : renommé ou déplacé → ligne « déplacé » avec l\'état CONSTATÉ', () => {
  const plat = (o) => JSON.parse(JSON.stringify(o));
  assert.deepStrictEqual(
    plat(pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X' }, { existe: true, corbeille: false, nom: 'b.pdf', chemin: 'DriveAI/02/X' })),
    { statut: 'déplacé', domaine: '', chemin: 'DriveAI/02/X', nom: 'b.pdf' });
  assert.deepStrictEqual(
    plat(pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X' }, { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/03/Y' })),
    { statut: 'déplacé', domaine: '', chemin: 'DriveAI/03/Y', nom: 'a.pdf' });
});

/* ---------- synchroniserIndex_ (mécanique de campagne) ---------- */

function fauxProps(initial) {
  const donnees = Object.assign({}, initial);
  return {
    donnees,
    getProperty: (k) => (k in donnees ? donnees[k] : null),
    setProperty: (k, v) => { donnees[k] = String(v); },
    deleteProperty: (k) => { delete donnees[k]; },
  };
}

/**
 * Contexte : Index simulé (tableau de lignes A..F), Drive simulé par `constats` (fileId → constat).
 * `constaterEtatDrive_` est REMPLACÉ (sa lecture Drive a ses propres garanties) — on compte ses
 * appels : c'est l'unité de coût réelle des plafonds.
 */
function ctxSync(lignesIndex, constats, propsInitiales) {
  const c = load(['Config.gs', 'Entites.gs', 'Maintenance.gs']);
  const props = fauxProps(propsInitiales || {});
  const appels = { verifies: [], ajouts: [], journal: [] };
  c.PropertiesService = { getScriptProperties: () => props };
  c.feuille_ = () => ({
    getLastRow: () => lignesIndex.length + 1, // + en-tête
    getRange: (ligne, col, n, largeur) => ({
      getValues: () => lignesIndex.slice(ligne - 2, ligne - 2 + n).map((l) => l.slice(col - 1, col - 1 + largeur)),
    }),
  });
  c.constaterEtatDrive_ = (fileId) => {
    appels.verifies.push(fileId);
    return constats[fileId] || { existe: false, corbeille: false, nom: '', chemin: '' };
  };
  c.indexAjouter_ = (cle, r) => appels.ajouts.push({ cle, statut: r.statut, nom: r.nom, chemin: r.chemin });
  c.journalInfo_ = (src, msg) => appels.journal.push(msg);
  c.DriveApp = new Proxy({}, { get() { throw new Error('mutation/lecture Drive directe interdite ici'); } });
  return { c, props, appels };
}

const L = (cle, nom, chemin, statut) => [cle, '2026-07-01', nom, '', chemin, statut];

test('synchroniserIndex_ : seule la ligne la plus RÉCENTE d\'une clé est comparée (convergence)', () => {
  const lignes = [
    L('drive|F1', 'vieux.pdf', '02/X', 'classé'),          // ligne PÉRIMÉE (une plus récente existe)
    L('tri|T|1|lu', 'Fil', '', 'trié'),                    // pas un fichier
    L('drive|F1', 'nouveau.pdf', 'DriveAI/02/X', 'déplacé'), // la plus récente de F1 — concorde avec Drive
    L('drive|F2', 'b.pdf', '02/Y', 'quarantaine'),         // statut hors périmètre (relance intacte)
  ];
  const { c, appels } = ctxSync(lignes, {
    F1: { existe: true, corbeille: false, nom: 'nouveau.pdf', chemin: 'DriveAI/02/X' },
  });
  c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(appels.verifies, ['F1']); // une SEULE vérification, sur la ligne récente
  assert.deepStrictEqual(appels.ajouts, []);       // rien à constater → rien appendé (convergé)
});

test('synchroniserIndex_ : corbeillé constaté UNE fois, puis re-vérifié sans jamais re-appender (convergent)', () => {
  const lignes = [
    L('drive|F9', 'perdu.pdf', '02/X', 'classé'),
  ];
  const { c, appels, props } = ctxSync(lignes, {}); // F9 absent de Drive
  c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(appels.ajouts, [{ cle: 'drive|F9', statut: 'corbeillé', nom: 'perdu.pdf', chemin: '02/X' }]);
  // Passe suivante : la ligne « corbeillé » (désormais la plus récente) est re-visitée — c'est ce
  // qui permet de voir une RESTAURATION — mais toujours disparu ⇒ rien de re-appendé, jamais.
  const suite = ctxSync(lignes.concat([L('drive|F9', 'perdu.pdf', '02/X', 'corbeillé')]), {},
    { DriveAI_SYNC_LIGNE: props.donnees.DriveAI_SYNC_LIGNE });
  suite.c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(suite.appels.ajouts, []);
});

test('synchroniserIndex_ : curseur borné/reprenable — budget coupé en cours de tranche → reprise exacte', () => {
  const lignes = [
    L('drive|A1', 'a.pdf', '02/X', 'classé'),
    L('drive|A2', 'b.pdf', '02/X', 'classé'),
    L('drive|A3', 'c.pdf', '02/X', 'classé'),
  ];
  const constats = {
    A1: { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/02/X' },
    A2: { existe: true, corbeille: false, nom: 'b.pdf', chemin: 'DriveAI/02/X' },
    A3: { existe: true, corbeille: false, nom: 'c.pdf', chemin: 'DriveAI/02/X' },
  };
  const { c, appels, props } = ctxSync(lignes, constats);
  let verifs = 0;
  c.synchroniserIndex_(() => verifs++ >= 2); // budget coupé après 2 contrôles de boucle
  assert.ok(appels.verifies.length < 3);
  const reprise = Number(props.donnees.DriveAI_SYNC_LIGNE);
  assert.ok(reprise >= 2 && reprise <= 4, 'curseur de reprise plausible : ' + reprise);
  // Reprise : le reste de l'Index est couvert sans re-vérifier le déjà-fait.
  const { c: c2, appels: a2 } = ctxSync(lignes, constats, { DriveAI_SYNC_LIGNE: String(reprise) });
  c2.synchroniserIndex_(() => false);
  assert.deepStrictEqual([...new Set(appels.verifies.concat(a2.verifies))].sort(), ['A1', 'A2', 'A3']);
});

test('synchroniserIndex_ : passe complète → curseur remis à 2 (perpétuel) + journal', () => {
  const lignes = [L('drive|F1', 'a.pdf', '02/X', 'classé')];
  const { c, props, appels } = ctxSync(lignes, {
    F1: { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/02/X' },
  });
  c.synchroniserIndex_(() => false);
  assert.strictEqual(props.donnees.DriveAI_SYNC_LIGNE, '2');
  assert.ok(appels.journal.some((m) => m.includes('passe complète')));
});

test('synchroniserIndex_ : budget QUOTIDIEN en MS RÉELLES — cas dérivés de la CONSTANTE (jamais de sa valeur du jour)', () => {
  const budget = pur.CONFIG.SYNC_BUDGET_JOUR_MS;
  const lignes = [L('drive|F1', 'a.pdf', '02/X', 'classé')];
  // Compte du jour déjà AU plafond → aucune vérification, rien de cassé. (Harness : dates UTC.)
  const jour = new Date().toISOString().slice(0, 10);
  const { c, appels } = ctxSync(lignes, {}, { DriveAI_SYNC_JOUR: jour + '|' + budget });
  c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(appels.verifies, []);
  // Sous le plafond → la vérification passe, et les ms consommées s'ACCUMULENT sur le compte du jour.
  const consomme = budget - 1000;
  const { c: c2, appels: a2, props: p2 } = ctxSync(lignes, {
    F1: { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/02/X' },
  }, { DriveAI_SYNC_JOUR: jour + '|' + consomme });
  c2.synchroniserIndex_(() => false);
  assert.deepStrictEqual(a2.verifies, ['F1']);
  const [jourEcrit, msEcrites] = String(p2.donnees.DriveAI_SYNC_JOUR).split('|');
  assert.strictEqual(jourEcrit, jour);
  assert.ok(Number(msEcrites) >= consomme, 'le compte du jour ne recule jamais : ' + msEcrites);
});

test('synchroniserIndex_ : une ligne FRAÎCHE (< SYNC_AGE_MIN_H) n\'est pas vérifiée — le budget se garde pour le stock', () => {
  const lignes = [
    [ 'drive|F1', new Date().toISOString(), 'a.pdf', '', '02/X', 'classé' ], // écrite à l'instant
  ];
  const { c, appels } = ctxSync(lignes, {});
  c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(appels.verifies, []);
});

test('decisionSyncIndex_ + synchroniserIndex_ : un fichier RESTAURÉ de la corbeille redevient « déplacé »', () => {
  const plat = (o) => JSON.parse(JSON.stringify(o));
  // Pur : ligne corbeillée + fichier présent → déplacé ; toujours disparu → rien (pas de re-append à vie).
  assert.deepStrictEqual(
    plat(pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X', statut: 'corbeillé' },
      { existe: true, corbeille: false, nom: 'a.pdf', chemin: 'DriveAI/02/X' })),
    { statut: 'déplacé', domaine: '', chemin: 'DriveAI/02/X', nom: 'a.pdf' });
  assert.strictEqual(
    pur.decisionSyncIndex_({ nom: 'a.pdf', chemin: '02/X', statut: 'corbeillé' },
      { existe: false, corbeille: false, nom: '', chemin: '' }),
    null);
  // Mécanique : la ligne corbeillée EST re-visitée (statut dans le périmètre).
  const lignes = [L('drive|F9', 'perdu.pdf', '02/X', 'corbeillé')];
  const { c, appels } = ctxSync(lignes, {
    F9: { existe: true, corbeille: false, nom: 'perdu.pdf', chemin: 'DriveAI/02/X' },
  });
  c.synchroniserIndex_(() => false);
  assert.deepStrictEqual(appels.ajouts, [{ cle: 'drive|F9', statut: 'déplacé', nom: 'perdu.pdf', chemin: 'DriveAI/02/X' }]);
});
