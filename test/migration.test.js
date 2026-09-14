'use strict';
/**
 * Chantier #8 (ADR-0002) — migration de l'existant vers la nouvelle taxonomie (Migration.gs) :
 *  - `estAMigrer_` : prédicat de collecte (convergence par clé `migre|<tag>|fileId`).
 *  - `collecterAMigrer_` : walk récursif borné, un fichier illisible n'avorte jamais la collecte.
 *  - `migrerFichier_` : zone protégée revérifiée STRICT avant mutation (inscrite → convergence),
 *    placement = renommage seul quand la destination est le dossier courant.
 *  - Pipeline `ignorerDoublon` : un doc migré n'est jamais « doublon de lui-même ».
 *  - Fix convergence rangement : `estAReclasserLeger_` reconnaît les 3 granularités de date.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter, fakeFile } = require('./harness');

/* ---------- estAMigrer_ + collecterAMigrer_ ---------- */

function ctxMigration(clesIndexees) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = (cle) => (clesIndexees || []).indexOf(cle) !== -1;
  // `dateGmail_` vit dans Gmail.gs : contrat INTER-MODULE consommé par le budget QUOTIDIEN de la
  // re-analyse (ADR-0056), comme le fait déjà `executerMission_`. Stubé plutôt que chargé : le jour
  // du test n'a aucune importance ici, seul compte le fait que la clé de jour existe.
  ctx.dateGmail_ = () => '2026-09-14';
  return ctx;
}

test('estAMigrer_ (C28-21) : SEUL un nom portant « Inconnu » est collecté ; bien nommé / natif / raccourci → false', () => {
  const ctx = ctxMigration([]);
  // Le vrai problème (héritage v1) : « Inconnu » dans le nom, quelle que soit la casse/position.
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'A', name: '2024-01-01_Inconnu.pdf', mime: 'application/pdf' }), 'm2-inconnu'), true);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'B', name: '2024-03_Facture_Inconnu.pdf', mime: 'image/jpeg' }), 'm2-inconnu'), true);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'B2', name: 'devoir-inconnu-v2.html', mime: 'text/html' }), 'm2-inconnu'), true);
  // Bien nommé (émetteur connu) → HORS périmètre : c'est ce qui rend la campagne finissable en jours.
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'E', name: '2024-01-01_Facture_EDF.pdf', mime: 'application/pdf' }), 'm2-inconnu'), false);
  // Natif / raccourci : toujours exclus (pas de blob exploitable).
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'C', name: 'Inconnu.gdoc', mime: 'application/vnd.google-apps.document' }), 'm2-inconnu'), false);
  assert.strictEqual(ctx.estAMigrer_(fakeFile({ id: 'D', name: 'Inconnu.lnk', mime: 'application/vnd.google-apps.shortcut' }), 'm2-inconnu'), false);
});

test('estAMigrer_ : déjà re-traité dans CETTE campagne (clé migre|) → false (convergence)', () => {
  const ctx = ctxMigration(['migre|m2-inconnu|DEJA']);
  const f = () => fakeFile({ id: 'DEJA', name: '2024_Relevé_Inconnu.pdf', mime: 'application/pdf' });
  assert.strictEqual(ctx.estAMigrer_(f(), 'm2-inconnu'), false);
  assert.strictEqual(ctx.estAMigrer_(f(), 'm3'), true); // autre campagne
});

function fauxDossier(fichiers, sousDossiers) {
  return {
    getFiles: () => iter(fichiers || []),
    getFolders: () => iter(sousDossiers || []),
  };
}

test('collecterAMigrer_ : walk récursif, plafond respecté, fichier illisible sauté', () => {
  const ctx = ctxMigration([]);
  const cassé = {
    getMimeType: () => { throw new Error('métadonnée illisible'); },
    getId: () => 'KO',
  };
  // Noms dans le périmètre m2 (« Inconnu ») : le walk et le plafond restent le sujet du test.
  const inconnu = (id) => fakeFile({ id, name: id + '_Inconnu.pdf' });
  const sous = fauxDossier([inconnu('S1'), inconnu('S2')]);
  const racine = fauxDossier([inconnu('R1'), cassé, inconnu('R2'), fakeFile({ id: 'HORS', name: '2024-01-01_Facture_EDF.pdf' })], [sous]);

  const ids = [];
  ctx.collecterAMigrer_(racine, ids, 10, () => false);
  assert.deepStrictEqual(ids, ['R1', 'R2', 'S1', 'S2']); // cassé sauté, récursion OK

  const ids2 = [];
  ctx.collecterAMigrer_(racine, ids2, 3, () => false);
  assert.strictEqual(ids2.length, 3); // plafond

  const ids3 = [];
  ctx.collecterAMigrer_(racine, ids3, 10, () => true); // budget épuisé → stop immédiat
  assert.strictEqual(ids3.length, 0);
});

test('collecterAReanalyser_ (ADR-0056) : RACINE SEULE — la descente récursive n\'a même pas lieu', () => {
  // 🔴 revue sécurité ADR-0056 : récursive, la campagne c28-92 ramassait TOUT le sous-arbre de
  // `06` — donc ce que C28-90/C28-105 venaient de ranger, et les dossiers que MARC a construits.
  // Le flux (`planRoutageV2_`) ne connaît ni D8, ni D9, ni D10 : un nom qui n\'apprend rien serait
  // reparti À PLAT à la racine du domaine. Le garde est un `return` : on l\'observe par le CHEMIN
  // (`getFolders` jamais appelé), pas seulement par la taille du résultat — un sous-dossier vide
  // rendrait la même liste (§9, « un mock qui compose son résultat ne distingue pas deux chemins »).
  const ctx = ctxMigration([]);
  const doc = (id) => fakeFile({ id, name: id + '.pdf' });
  let descentes = 0;
  const sous = fauxDossier([doc('S1'), doc('S2')]);
  const racine = {
    getFiles: () => iter([doc('R1'), doc('R2')]),
    getFolders: () => { descentes += 1; return iter([sous]); },
  };

  const ids = [];
  ctx.collecterAReanalyser_(racine, ids, 10, () => false);
  assert.deepStrictEqual(ids, ['R1', 'R2'], 'seuls les fichiers À PLAT à la racine de 06');
  assert.strictEqual(descentes, 0, 'aucune descente : le garde coupe AVANT getFolders()');

  // Contre-épreuve : le garde est bien CE drapeau, pas un itérateur cassé. La position globale du
  // drapeau est une décision de Marc, jamais un invariant de test (§9) → save/restore.
  const avant = ctx.CONFIG.REANALYSE_RACINE_SEULE;
  try {
    ctx.CONFIG.REANALYSE_RACINE_SEULE = false;
    const rec = [];
    ctx.collecterAReanalyser_(racine, rec, 10, () => false);
    assert.deepStrictEqual(rec, ['R1', 'R2', 'S1', 'S2']);
    assert.strictEqual(descentes, 1);
  } finally {
    ctx.CONFIG.REANALYSE_RACINE_SEULE = avant;
  }
});

/* ---------- migrerFichier_ : zone protégée + placement ---------- */

function ctxMigrerFichier(opts) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const calls = { index: [], traites: [], renomme: [], deplace: [], journaux: [] };
  ctx.journalInfo_ = (s, m) => calls.journaux.push(m);
  ctx.journalErreur_ = () => {};
  ctx.indexAjouter_ = (cle, res, emp) => calls.index.push({ cle, res, emp });
  ctx.traiterDocument_ = (src) => calls.traites.push(src);
  ctx.renommer_ = (id, nom) => { calls.renomme.push({ id, nom }); return true; };
  ctx.deplacerEtRenommer_ = (id, nouveau, ancien, nom) => { calls.deplace.push({ id, nouveau, ancien, nom }); return true; };
  ctx.aParentProtege_ = () => !!opts.protege;
  ctx.DriveApp = {
    getFileById: () => ({
      getName: () => 'doc 2024.pdf',
      getSize: () => 1234,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => ({}),
      getParents: () => iter([{ getId: () => 'PARENT' }]),
    }),
  };
  return { ctx, calls };
}

test('migrerFichier_ : zone protégée (strict) → non touché, inscrit « zone protégée » (convergence)', () => {
  const { ctx, calls } = ctxMigrerFichier({ protege: true });
  const r = ctx.migrerFichier_('F1', {});
  assert.strictEqual(r, false);
  assert.strictEqual(calls.traites.length, 0);                       // jamais passé au pipeline
  assert.strictEqual(calls.index.length, 1);                          // mais inscrit → plus jamais re-collecté
  assert.strictEqual(calls.index[0].cle, 'migre|' + ctx.CONFIG.MIGRATION_TAG + '|F1'); // dérivé de la CONSTANTE
  assert.strictEqual(calls.index[0].res.statut, 'zone protégée');
});

test('migrerFichier_ : descripteur pipeline (clé migre|, ignorerDoublon) + placement in-place', () => {
  const { ctx, calls } = ctxMigrerFichier({ protege: false });
  const r = ctx.migrerFichier_('F2', {});
  assert.strictEqual(r, true);
  assert.strictEqual(calls.traites.length, 1);
  const src = calls.traites[0];
  assert.strictEqual(src.cle, 'migre|' + ctx.CONFIG.MIGRATION_TAG + '|F2');
  assert.strictEqual(src.ignorerDoublon, true);
  assert.strictEqual(src.nom, 'doc 2024.pdf');

  // Destination = dossier COURANT → renommage seul (jamais addParents==removeParents).
  assert.strictEqual(src.placer('PARENT', 'nouveau.pdf'), 'F2');
  assert.deepStrictEqual(calls.renomme, [{ id: 'F2', nom: 'nouveau.pdf' }]);
  assert.strictEqual(calls.deplace.length, 0);

  // Destination différente → déplacement + renommage (move-only, ancien parent retiré).
  assert.strictEqual(src.placer('AILLEURS', 'n2.pdf'), 'F2');
  assert.deepStrictEqual(calls.deplace, [{ id: 'F2', nouveau: 'AILLEURS', ancien: 'PARENT', nom: 'n2.pdf' }]);
});

test('migrerFichier_ : document illisible → quarantaine (gererEchec_), jamais un blocage de campagne', () => {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const echecs = [];
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.gererEchec_ = (src, motif) => echecs.push({ cle: src.cle, motif });
  ctx.traiterDocument_ = () => { throw new Error('ne doit pas être atteint'); };
  ctx.aParentProtege_ = () => false;
  ctx.DriveApp = { getFileById: () => { throw new Error('introuvable'); } };
  assert.strictEqual(ctx.migrerFichier_('KO', {}), false);
  assert.strictEqual(echecs.length, 1);                 // → compteur d'échecs → quarantaine après N
  assert.strictEqual(echecs[0].cle, 'migre|' + ctx.CONFIG.MIGRATION_TAG + '|KO'); // sous la clé de campagne (convergence)
});

/* ---------- Pipeline : bypass du fast-path doublon ---------- */

function ctxPipeline(ignorer) {
  const ctx = load(['Config.gs', 'Pipeline.gs']);
  const calls = { placerDoublon: [], echecs: [] };
  ctx.journalInfo_ = () => {};
  ctx.estPannePlateforme_ = () => false; // garde panne de compte (Llm.gs non chargé ici)
  ctx.indexContient_ = () => false;
  ctx.empreinteBlob_ = () => 'EMPREINTE';
  ctx.estDoublon_ = () => true;                       // le contenu EST déjà connu de l'Index
  ctx.doublonRapide_ = (nom) => ({ dossierId: 'DUP', nom: 'dup_' + nom, statut: 'doublon', domaine: '', chemin: '' });
  ctx.indexAjouter_ = () => {};
  ctx.estTechnique_ = () => false;
  ctx.estMediaDirect_ = () => false;
  ctx.estPhoto_ = () => false;
  ctx.extension_ = () => '.pdf';
  ctx.extraireTexte_ = () => '';
  ctx.classifier_ = () => null;                       // stoppe le pipeline après le fast-path (test ciblé)
  ctx.gererEchec_ = (src, motif) => calls.echecs.push(motif);
  const src = {
    cle: 'migre|m1|X', nom: 'doc.pdf', taille: 10, date: new Date('2026-07-01T00:00:00Z'),
    ignorerDoublon: !!ignorer,
    blob: () => ({}),
    placer: (dossierId, nom) => { calls.placerDoublon.push({ dossierId, nom }); return 'X'; },
  };
  return { ctx, calls, src };
}

test('traiterDocument_ : SANS ignorerDoublon, contenu connu → fast-path _Doublons', () => {
  const { ctx, calls, src } = ctxPipeline(false);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 1);
  assert.strictEqual(calls.placerDoublon[0].dossierId, 'DUP');
});

test('traiterDocument_ : AVEC ignorerDoublon (migration), le fast-path est sauté (pas « doublon de soi »)', () => {
  const { ctx, calls, src } = ctxPipeline(true);
  ctx.traiterDocument_(src);
  assert.strictEqual(calls.placerDoublon.length, 0);   // pas parti en _Doublons
  assert.deepStrictEqual(calls.echecs, ['classification impossible']); // preuve : a continué jusqu'au LLM (mocké null)
});

/* ---------- C26-08 (ADR-0018) : re-analyse v2 ciblée ---------- */

test('TRIPWIRE cibles : REANALYSE_CIBLES existent dans DOMAINES et n\'intersectent JAMAIS la zone protégée', () => {
  const ctx = load(['Config.gs']);
  const cibles = ctx.CONFIG.REANALYSE_CIBLES;
  assert.ok(Array.isArray(cibles) && cibles.length > 0);
  cibles.forEach((dom) => {
    // Un libellé absent de DOMAINES ⇒ getFolderById(undefined) lève à CHAQUE tick → erreurCollecte
    // permanente → la campagne ne se figerait JAMAIS (reste=true à vie).
    assert.ok(dom in ctx.CONFIG.DOMAINES, 'cible hors DOMAINES fixes : ' + dom);
    assert.strictEqual(ctx.CONFIG.DOMAINES_PROTEGES.indexOf(dom), -1, 'cible protégée interdite : ' + dom);
  });
});

test('migrerUnePage_ : les domaines de REANALYSE_CIBLES sont EXCLUS de m1 (jamais payés deux fois v1+v2)', () => {
  const ctx = ctxMigration([]);
  const visites = [];
  // Cas dérivés de la CONFIG (jamais des libellés du jour) : on note l'ID de chaque dossier ouvert.
  ctx.DriveApp = { getFolderById: (id) => { visites.push(id); return fauxDossier([]); } };
  ctx.ensembleDomainesProteges_ = () => ({});
  ctx.migrerUnePage_(() => false, {});
  const cibles = ctx.CONFIG.REANALYSE_CIBLES.map((dom) => ctx.CONFIG.DOMAINES[dom]);
  const protges = ctx.CONFIG.DOMAINES_PROTEGES.map((dom) => ctx.CONFIG.DOMAINES[dom]);
  cibles.forEach((id) => assert.strictEqual(visites.indexOf(id), -1, 'cible C26-08 visitée par m1 : ' + id));
  protges.forEach((id) => assert.strictEqual(visites.indexOf(id), -1, 'zone protégée visitée par m1 : ' + id));
  // Non-régression : m1 visite toujours les AUTRES domaines fixes.
  const attendus = Object.keys(ctx.CONFIG.DOMAINES)
    .filter((d) => ctx.CONFIG.DOMAINES_PROTEGES.indexOf(d) === -1 && ctx.CONFIG.REANALYSE_CIBLES.indexOf(d) === -1)
    .map((d) => ctx.CONFIG.DOMAINES[d]);
  assert.deepStrictEqual(visites, attendus);
});

test('estAReanalyser_ : convergence par clé reanalyse|<tag>| ; natifs exclus ; indépendant des clés migre|', () => {
  // ⚠️ Ici le tag est un LITTÉRAL volontaire, pas la valeur de CONFIG : ce test porte sur la FORME
  // de la clé et sur l'indépendance entre campagnes, et il passe le tag en ARGUMENT. Le dériver de
  // CONFIG le rendrait tautologique (le même tag des deux côtés ne prouverait plus la séparation).
  const ctx = ctxMigration(['reanalyse|c26-08|DEJA', 'migre|m1|AUTRE']);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'LIBRE', mime: 'application/pdf' }), 'c26-08'), true);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'c26-08'), false);
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'DEJA', mime: 'application/pdf' }), 'c27'), true); // autre campagne
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'AUTRE', mime: 'application/pdf' }), 'c26-08'), true); // migre| ≠ reanalyse|
  assert.strictEqual(ctx.estAReanalyser_(fakeFile({ id: 'N', mime: 'application/vnd.google-apps.document' }), 'c26-08'), false);
});

function ctxReanalyseCampagne(props) {
  const ctx = load(['Config.gs', 'Migration.gs']);
  // `dateGmail_` vit dans Gmail.gs : contrat INTER-MODULE consommé par le budget QUOTIDIEN de la
  // re-analyse (ADR-0056), exactement comme `executerMission_` le fait déjà. Le jour n'a pas
  // d'importance ici — ce qui compte, c'est que la clé de jour existe.
  ctx.dateGmail_ = () => '2026-09-14';
  const journal = [];
  ctx.journalInfo_ = (s, m) => journal.push(m);
  ctx.journalErreur_ = () => {};
  ctx.rangementTermine_ = () => props.rangement !== false;
  ctx.ensembleDomainesProteges_ = () => ({});
  // Compteurs de barre (C28-18, Maintenance.gs) : hors sujet ici — l'orchestration seule est testée.
  ctx.majCompteurCampagne_ = () => {};
  ctx.finaliserCompteurCampagne_ = () => {};
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props.valeurs ? props.valeurs[k] : null),
      setProperty: (k, v) => { props.valeurs[k] = String(v); },
      deleteProperty: (k) => { delete props.valeurs[k]; },
    }),
  };
  return { ctx, journal };
}

test('appliquerReanalyseCiblee_ : ne démarre JAMAIS tant que la migration n\'est pas finie (une campagne de masse à la fois)', () => {
  const props = { valeurs: {} }; // DriveAI_MIGRATION absent → migration en cours
  const { ctx } = ctxReanalyseCampagne(props);
  ctx.reanalyserUnePage_ = () => { throw new Error('ne doit pas collecter pendant la migration'); };
  ctx.appliquerReanalyseCiblee_(() => false); // ne lève pas → la garde a court-circuité
  assert.ok(!('DriveAI_REANALYSE' in props.valeurs));
  // Une campagne PRÉCÉDENTE finie (autre tag) ne suffit pas : la garde exige le tag COURANT.
  props.valeurs.DriveAI_MIGRATION = 'm1';
  ctx.appliquerReanalyseCiblee_(() => false);
  assert.ok(!('DriveAI_REANALYSE' in props.valeurs));
});

test('appliquerReanalyseCiblee_ : migration finie + passe complète VIDE → Property figée (terminé) ; page pleine → jamais figée', () => {
  // Barre pré-recensée POUR LE TAG COURANT (C28-18) : sans elle, le premier tick est un tick
  // DÉDIÉ de recensement (et un BARRE_TAG absent/étranger purge la base — leçon « seuil dans la clé »).
  const props1 = { valeurs: { DriveAI_REANALYSE_BASE: '0' } };
  const ctx1 = ctxReanalyseCampagne(props1);
  props1.valeurs.DriveAI_MIGRATION = ctx1.ctx.CONFIG.MIGRATION_TAG; // dérivé de la CONSTANTE
  props1.valeurs.DriveAI_REANALYSE_BARRE_TAG = ctx1.ctx.CONFIG.REANALYSE_TAG;
  ctx1.ctx.reanalyserUnePage_ = () => ({ traites: 0, collectes: 0, reste: false });
  ctx1.ctx.appliquerReanalyseCiblee_(() => false);
  assert.strictEqual(ctx1.ctx.PropertiesService.getScriptProperties().getProperty('DriveAI_REANALYSE'),
    ctx1.ctx.CONFIG.REANALYSE_TAG);

  const props2 = { valeurs: { DriveAI_REANALYSE_BASE: '900' } };
  const ctx2 = ctxReanalyseCampagne(props2);
  props2.valeurs.DriveAI_MIGRATION = ctx2.ctx.CONFIG.MIGRATION_TAG;
  props2.valeurs.DriveAI_REANALYSE_BARRE_TAG = ctx2.ctx.CONFIG.REANALYSE_TAG;
  ctx2.ctx.reanalyserUnePage_ = () => ({ traites: 12, collectes: 12, reste: true });
  ctx2.ctx.appliquerReanalyseCiblee_(() => false);
  assert.ok(!('DriveAI_REANALYSE' in props2.valeurs), 'une page PLEINE ne doit jamais figer la campagne');
  // Et une fois figée, plus aucune collecte (idempotence du re-lancement).
  ctx1.ctx.reanalyserUnePage_ = () => { throw new Error('campagne finie : ne doit plus collecter'); };
  ctx1.ctx.appliquerReanalyseCiblee_(() => false);
});

test('ADR-0056 — la re-analyse a un budget QUOTIDIEN : il coupe, il se libère, et il se compte', () => {
  // Elle n'en avait AUCUN : seulement un plafond par tick. « Un plafond par RUN ne borne pas la
  // JOURNÉE » (§9, C28-42) — à 288 ticks × 2 min elle pouvait à elle seule franchir le mur runtime
  // d'Apps Script et geler TOUS les déclencheurs, chien de garde compris.
  const jour = '2026-09-14';
  const base = () => ({ valeurs: { DriveAI_REANALYSE_BASE: '900' } });

  // (a) BUDGET ÉPUISÉ AUJOURD'HUI ⇒ aucune collecte. Valeur dérivée de la CONSTANTE, jamais du jour.
  const p1 = base();
  const c1 = ctxReanalyseCampagne(p1);
  const plafond = c1.ctx.CONFIG.REANALYSE_BUDGET_JOUR_MS;
  p1.valeurs.DriveAI_MIGRATION = c1.ctx.CONFIG.MIGRATION_TAG;
  p1.valeurs.DriveAI_REANALYSE_BARRE_TAG = c1.ctx.CONFIG.REANALYSE_TAG;
  p1.valeurs.DriveAI_REANALYSE_JOUR = jour + '|' + plafond;
  c1.ctx.reanalyserUnePage_ = () => { throw new Error('budget du jour épuisé : ne doit pas collecter'); };
  c1.ctx.appliquerReanalyseCiblee_(() => false); // ne lève pas ⇒ la garde a coupé

  // (b) LIBÉRATION — un gate se teste par sa levée, pas seulement par son blocage (leçon §7).
  // Même plafond, mais consommé HIER : la journée repart à zéro.
  const p2 = base();
  const c2 = ctxReanalyseCampagne(p2);
  p2.valeurs.DriveAI_MIGRATION = c2.ctx.CONFIG.MIGRATION_TAG;
  p2.valeurs.DriveAI_REANALYSE_BARRE_TAG = c2.ctx.CONFIG.REANALYSE_TAG;
  p2.valeurs.DriveAI_REANALYSE_JOUR = '2026-09-13|' + plafond;
  let collecte = 0;
  c2.ctx.reanalyserUnePage_ = () => { collecte++; return { traites: 3, collectes: 3, reste: true }; };
  c2.ctx.appliquerReanalyseCiblee_(() => false);
  assert.strictEqual(collecte, 1, 'un budget consommé HIER ne borne pas aujourd\'hui');

  // (c) Les ms consommées sont ÉCRITES, sous le jour courant — sinon rien ne borne la journée.
  const suivi = String(p2.valeurs.DriveAI_REANALYSE_JOUR || '');
  assert.ok(suivi.indexOf(jour + '|') === 0, 'budget du jour ré-ancré sur aujourd\'hui : ' + suivi);
  // …et le compteur ACCUMULE : le consommé ANTÉRIEUR est reporté ET l'écoulé s'y ajoute.
  // ⚠️ Vérifier le seul PRÉFIXE de jour ne prouvait rien (🟠 revue code, mutation SURVIVANTE) :
  // écrire `aujourdhui + '|' + consommeJour` sans l'écoulé laissait le compteur à plat, donc la
  // gate quotidienne ne mordait JAMAIS et la campagne consommait 288 ticks × 2 min — précisément
  // le gel de tous les déclencheurs que ce budget existe pour empêcher.
  const p4 = base();
  const c4 = ctxReanalyseCampagne(p4);
  const anterieur = 3 * 60 * 1000;
  p4.valeurs.DriveAI_MIGRATION = c4.ctx.CONFIG.MIGRATION_TAG;
  p4.valeurs.DriveAI_REANALYSE_BARRE_TAG = c4.ctx.CONFIG.REANALYSE_TAG;
  p4.valeurs.DriveAI_REANALYSE_JOUR = jour + '|' + anterieur;
  c4.ctx.reanalyserUnePage_ = () => {
    const t0 = Date.now(); while (Date.now() - t0 < 3) { /* consomme du temps RÉEL */ }
    return { traites: 1, collectes: 1, reste: true };
  };
  c4.ctx.appliquerReanalyseCiblee_(() => false);
  const ms = Number(String(p4.valeurs.DriveAI_REANALYSE_JOUR).split('|')[1]);
  assert.ok(ms > anterieur, 'le consommé antérieur est REPORTÉ et l\'écoulé AJOUTÉ : ' + ms);

  // (d) …MÊME sur exception : un plantage ne doit jamais faire FUIR le budget (patron `finally`
  // des missions). Sans ça, une campagne qui échoue en boucle consomme du runtime sans jamais
  // l'inscrire, et le plafond quotidien ne mord jamais.
  const p3 = base();
  const c3 = ctxReanalyseCampagne(p3);
  p3.valeurs.DriveAI_MIGRATION = c3.ctx.CONFIG.MIGRATION_TAG;
  p3.valeurs.DriveAI_REANALYSE_BARRE_TAG = c3.ctx.CONFIG.REANALYSE_TAG;
  c3.ctx.reanalyserUnePage_ = () => { throw new Error('boum'); };
  assert.throws(() => c3.ctx.appliquerReanalyseCiblee_(() => false), /boum/);
  assert.ok(String(p3.valeurs.DriveAI_REANALYSE_JOUR || '').indexOf(jour + '|') === 0,
    'ms consommées écrites malgré l\'exception');
});

test('ADR-0056 — le RELIQUAT du jour borne le run, et jamais un document ne démarre dans la marge', () => {
  // Deux propriétés qu'aucun des quatre cas précédents n'exerçait (🟡 revue quotas) : le
  // `Math.min(par-tick, reliquat)` — le remplacer par le seul plafond par tick les laissait TOUS
  // verts — et la marge de démarrage, sans laquelle un document pris à la dernière seconde pousse
  // le tick au-delà du mur DUR de 6 min, où l'exécution est TUÉE (le `finally` ne tourne pas : la
  // fuite de budget se produit dans le run qui en a le plus consommé).
  const p = { valeurs: { DriveAI_REANALYSE_BASE: '900' } };
  const { ctx } = ctxReanalyseCampagne(p);
  const plafondJour = ctx.CONFIG.REANALYSE_BUDGET_JOUR_MS;
  const marge = ctx.CONFIG.PILOTE_MARGE_DOC_MS;
  const reliquat = marge + 30000; // reliquat VOLONTAIREMENT plus petit que le plafond par tick
  assert.ok(reliquat < ctx.CONFIG.REANALYSE_BUDGET_MS,
    'pré-condition : le reliquat doit mordre AVANT le plafond par tick, sinon le test ne prouve rien');
  p.valeurs.DriveAI_MIGRATION = ctx.CONFIG.MIGRATION_TAG;
  p.valeurs.DriveAI_REANALYSE_BARRE_TAG = ctx.CONFIG.REANALYSE_TAG;
  p.valeurs.DriveAI_REANALYSE_JOUR = '2026-09-14|' + (plafondJour - reliquat);

  // Horloge pilotée : `Date.now()` ET `new Date()` (le budget du jour lit les deux).
  const VraiDate = ctx.Date;
  let horloge = 1000000;
  function FauxDate() { return new VraiDate(horloge); }
  FauxDate.now = () => horloge;
  ctx.Date = FauxDate;

  let garde = null;
  ctx.reanalyserUnePage_ = (g) => { garde = g; return { traites: 0, collectes: 0, reste: true }; };
  ctx.appliquerReanalyseCiblee_(() => false);
  assert.ok(garde, 'la page a bien été lancée');

  // Le mur de DÉMARRAGE attendu : reliquat du jour − marge. Dérivé, jamais recopié.
  const murAttendu = reliquat - marge;
  assert.strictEqual(garde(), false, 'au démarrage, il reste du budget');
  horloge += murAttendu - 1000;      // juste SOUS le mur : on prend encore un document
  assert.strictEqual(garde(), false, 'sous le mur de démarrage, on prend encore un document');
  horloge += 2000;                   // juste AU-DESSUS : plus aucun document ne démarre
  assert.strictEqual(garde(), true,
    'aucun document ne démarre dans la dernière minute du reliquat (mutation : remplacer ' +
    '`murDemarrage` par `budgetRun`, ou `budgetRun` par le seul plafond par tick, fait tomber ceci)');
  ctx.Date = VraiDate;
});

test('appliquerReanalyseCiblee_ : tick DÉDIÉ de recensement (C28-18) — pose la base SANS collecter, filet du partiel', () => {
  // 1ᵉʳ tick : recensement complet → BASE/TRAITES posés, la page n'est PAS lancée.
  const props = { valeurs: {} };
  const { ctx } = ctxReanalyseCampagne(props);
  props.valeurs.DriveAI_MIGRATION = ctx.CONFIG.MIGRATION_TAG; // migration finie (dérivé de la CONSTANTE)
  ctx.reanalyserUnePage_ = () => { throw new Error('le tick de recensement ne collecte pas'); };
  ctx.compterRestantReanalyse_ = () => ({ n: 924, complet: true });
  ctx.appliquerReanalyseCiblee_(() => false);
  assert.deepStrictEqual(
    [props.valeurs.DriveAI_REANALYSE_BASE, props.valeurs.DriveAI_REANALYSE_TRAITES], ['924', '0']);

  // Recensement PARTIEL : réessais comptés, base non posée — puis filet (compte partiel accepté)
  // au bout d'ESSAIS_MAX passes (cas dérivés de la CONSTANTE, jamais de sa valeur du jour).
  const props2 = { valeurs: {} };
  const c2 = ctxReanalyseCampagne(props2);
  props2.valeurs.DriveAI_MIGRATION = c2.ctx.CONFIG.MIGRATION_TAG;
  c2.ctx.reanalyserUnePage_ = () => { throw new Error('ne collecte pas pendant le recensement'); };
  c2.ctx.compterRestantReanalyse_ = () => ({ n: 40, complet: false });
  const ESSAIS_MAX = c2.ctx.CONFIG.RANGEMENT_RECENS_ESSAIS_MAX;
  for (let i = 1; i < ESSAIS_MAX; i++) {
    c2.ctx.appliquerReanalyseCiblee_(() => false);
    assert.ok(!('DriveAI_REANALYSE_BASE' in props2.valeurs), 'partiel → base non posée (essai ' + i + ')');
    assert.strictEqual(props2.valeurs.DriveAI_REANALYSE_RECENS, String(i));
  }
  c2.ctx.appliquerReanalyseCiblee_(() => false); // essai n° ESSAIS_MAX → filet : partiel ACCEPTÉ
  assert.strictEqual(props2.valeurs.DriveAI_REANALYSE_BASE, '40',
    'après ' + ESSAIS_MAX + ' recensements incomplets, le compte partiel devient la base (jamais bloqué)');

  // Leçon §7 « le seuil va dans la clé » : la barre d'une campagne PRÉCÉDENTE (autre tag) est
  // purgée — la nouvelle campagne re-recense au lieu d'hériter d'une barre figée à 100 %.
  const props3 = { valeurs: { DriveAI_REANALYSE_BARRE_TAG: 'ancien-tag', DriveAI_REANALYSE_BASE: '900', DriveAI_REANALYSE_TRAITES: '900' } };
  const c3 = ctxReanalyseCampagne(props3);
  props3.valeurs.DriveAI_MIGRATION = c3.ctx.CONFIG.MIGRATION_TAG;
  c3.ctx.reanalyserUnePage_ = () => { throw new Error('ne collecte pas pendant le recensement'); };
  c3.ctx.compterRestantReanalyse_ = () => ({ n: 500, complet: true });
  c3.ctx.appliquerReanalyseCiblee_(() => false);
  assert.strictEqual(props3.valeurs.DriveAI_REANALYSE_BARRE_TAG, c3.ctx.CONFIG.REANALYSE_TAG);
  assert.strictEqual(props3.valeurs.DriveAI_REANALYSE_BASE, '500', 'barre héritée purgée → re-recensée pour CE tag');
});

test('reanalyserFichier_ : zone protégée inscrite sous la clé reanalyse| ; pipeline v2 reçu avec ignorerDoublon', () => {
  const ctx = load(['Config.gs', 'Migration.gs']);
  const calls = { index: [], traites: [] };
  ctx.journalInfo_ = () => {};
  ctx.indexAjouter_ = (cle, res) => calls.index.push({ cle, statut: res.statut });
  ctx.traiterDocument_ = (src) => calls.traites.push(src);
  ctx.renommer_ = () => true;
  ctx.deplacerEtRenommer_ = () => true;
  ctx.DriveApp = {
    getFileById: () => ({
      getName: () => '2024-01-01_Facture_EDF.pdf',
      getSize: () => 99,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => ({}),
      getParents: () => iter([{ getId: () => 'PARENT' }]),
    }),
  };

  ctx.aParentProtege_ = () => true; // multi-parents accroché à 04 → refus inscrit, jamais muté
  assert.strictEqual(ctx.reanalyserFichier_('F1', {}), false);
  assert.deepStrictEqual(calls.index, [{ cle: 'reanalyse|' + ctx.CONFIG.REANALYSE_TAG + '|F1', statut: 'zone protégée' }]);
  assert.strictEqual(calls.traites.length, 0);

  ctx.aParentProtege_ = () => false;
  assert.strictEqual(ctx.reanalyserFichier_('F2', {}), true);
  assert.strictEqual(calls.traites.length, 1);
  assert.strictEqual(calls.traites[0].cle, 'reanalyse|' + ctx.CONFIG.REANALYSE_TAG + '|F2');
  assert.strictEqual(calls.traites[0].ignorerDoublon, true);
});

/* ---------- Fix convergence rangement : 3 granularités de date ---------- */

test('estAReclasserLeger_ : les noms produits par le nommage PAR TYPE sont « déjà rangés » (convergence)', () => {
  const ctx = load(['Config.gs', 'Maintenance.gs']);
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = () => false; // Index vide (P3 testé dans predicates.test.js)
  const casRanges = [
    '2024-03-05_Facture_Hydro-Québec.pdf', // jour (historique)
    '2024-03_Relevé_Desjardins.pdf',       // mois (nouveau)
    '2021_Diplôme_IUT-ULCO.pdf',           // année (nouveau)
  ];
  casRanges.forEach((nom) => {
    assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: nom })), false,
      nom + ' ne doit JAMAIS être re-collecté (sinon boucle infinie de la campagne)');
  });
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'IMG_2734.jpg' })), true);  // vrac
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'CV Marc 2024.pdf' })), true); // vrac
  assert.strictEqual(ctx.estAReclasserLeger_(fakeFile({ name: 'x.gdoc', mime: 'application/vnd.google-apps.document' })), false);
});
