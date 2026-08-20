'use strict';
/**
 * C28-49 (ADR-0039) — Missions de curation : fonctions PURES (jetons, appariement, fenêtres de
 * dates) + sémantique du runner (idempotence versionnée, refus inscrits, garde par item,
 * convergence sur passe vide, rouge seulement sur dossier vide, jamais de mutation d'un
 * protégé/multi-parents).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (x) => JSON.parse(JSON.stringify(x));

/* ---------- PURES ---------- */

// Reset.gs : STRUCTURE_CIBLE_RESET + resetBucketAnnee_ (une seule règle de buckets) ET
// `cheminCibleReset_`, que le filet de sécurité du routeur véhicule interroge (C28-62).
// Entites.gs/Consolidation.gs sont ses dépendances RÉELLES (normaliserCle_, analyserNomClasse_) :
// pas de stub — c'est le contrat inter-module qu'on teste, comme dans reset.test.js.
const pur = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);

test('jetonsCible_ : nombres discriminants gardés, mots-outils d\'adresse exclus, accents neutralisés', () => {
  assert.deepStrictEqual(plain(pur.jetonsCible_('783 av. Moreau, Québec')), ['783', 'moreau']);
  assert.deepStrictEqual(plain(pur.jetonsCible_('3987 rte des Rivières')), ['3987', 'rivieres']);
  assert.deepStrictEqual(plain(pur.jetonsCible_('VW Jetta')), ['jetta'], 'vw (2 lettres) exclu — l\'alias volkswagen vient d\'EXTRA');
  assert.deepStrictEqual(plain(pur.jetonsCible_('3325 4e avenue')), ['3325'], '« 4e » et « avenue » ne discriminent rien');
  assert.deepStrictEqual(plain(pur.jetonsCible_('Toyota bZ')), ['toyota'], 'bz (2 lettres) → alias bz4x via EXTRA');
});

test('apparierUnique_ : un seul match = trouvé ; deux cibles qui matchent = null (jamais deviné)', () => {
  const cibles = [
    { nom: 'Ford Fiesta', id: 'ff', jetons: ['ford', 'fiesta'] },
    { nom: 'VW Jetta', id: 'vj', jetons: ['jetta', 'volkswagen'] },
  ];
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Facture_Garage (Fiesta).pdf', cibles).id, 'ff');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Assurance_Volkswagen.pdf', cibles).id, 'vj');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Facture_Ford Jetta.pdf', cibles), null, 'ambigu');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Relevé_Hydro.pdf', cibles), null, 'aucun jeton');
});

test('apparierUnique_ : MOT ENTIER seulement — jamais une sous-chaîne enclavée (revues quotas + sécurité)', () => {
  // Un faux appariement UNIQUE déplace au MAUVAIS endroit avec une clé de SUCCÈS : parti de la
  // source, même un bump de version ne le ré-évaluerait jamais. Prouvé par mutation : rétablir la
  // clause sous-chaîne (`n.indexOf(j) !== -1 && j.length >= 4`) fait échouer ce test.
  const cibles = [
    { nom: 'Mont-Tremblant', id: 'mt', jetons: ['mont', 'tremblant'] },
    { nom: '783 av. Moreau', id: 'lm', jetons: ['783', 'moreau'] },
  ];
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Facture_Hydro Montreal.pdf', cibles), null,
    '« mont » enclavé dans « montreal » ne matche pas');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Recu_7834 stationnement.pdf', cibles), null,
    '« 783 » enclavé dans « 7834 » ne matche pas');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Lettre_Moreault.pdf', cibles), null,
    '« moreau » enclavé dans « moreault » ne matche pas');
  assert.strictEqual(pur.apparierUnique_('2024-05-01_Avis_Mont Tremblant.pdf', cibles).id, 'mt',
    'les mots ENTIERS matchent toujours (la normalisation fait de toute ponctuation un espace)');
});

test('dateDuNomMission_ + logementParDate_ : la date route vers EXACTEMENT une fenêtre, sinon null', () => {
  const fenetres = [
    { id: 'a', min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 31) },
    { id: 'b', min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 11, 31) },
  ];
  assert.strictEqual(pur.logementParDate_('2023-06-15_Lettre_Hydro.pdf', fenetres), 'a');
  assert.strictEqual(pur.logementParDate_('2024-03_Avis_Ville.pdf', fenetres), 'b', 'AAAA-MM sans jour accepté');
  assert.strictEqual(pur.logementParDate_('2025-01-01_X.pdf', fenetres), null, 'hors fenêtres');
  assert.strictEqual(pur.logementParDate_('sans-date.pdf', fenetres), null);
  // Chevauchement : deux fenêtres possibles → on ne devine PAS.
  const chevauche = [
    { id: 'a', min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 31) },
    { id: 'b', min: Date.UTC(2023, 5, 1), max: Date.UTC(2024, 5, 1) },
  ];
  assert.strictEqual(pur.logementParDate_('2023-08-01_X.pdf', chevauche), null, 'ambigu par dates');
});

test('routeur dispatch03 : véhicule prioritaire, puis adresse, puis BAILLEUR, puis date (Correspondance seulement)', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const spec = pur.tableMissions_().filter((m) => m.tag === 'dispatch03')[0];
  const ctx = {
    logements: [
      { nom: '783 av. Moreau, Québec', id: 'lm', jetons: ['783', 'moreau'] },
      { nom: '3987 rte des Rivières', id: 'l3987', jetons: ['3987', 'rivieres'] },
    ],
    fenetres: [{ id: 'lm', min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 31) }],
    themePar: (function () {
      const m = {};
      m[IDS.contrats03] = 'Contrats'; m[IDS.correspondance03] = 'Correspondance';
      m[IDS.assuranceHab03] = 'Assurance habitation'; m[IDS.energieServices03] = 'Énergie & services';
      return m;
    })(),
    // c49-2 : côté véhicule, le thème se traduit dans le vocabulaire des catégories de Marc.
    themeVehiculePar: (function () {
      const m = {};
      m[IDS.contrats03] = 'Recherche & achat'; m[IDS.assuranceHab03] = 'Assurance auto';
      return m;
    })(),
  };
  // Un contrat qui nomme le véhicule part côté Véhicule/<X>/<catégorie de Marc> — le canon vient
  // de la TABLE (c49-2 : une cible peut être créée), plus des dossiers existants.
  const v = spec.router('2024-01-01_Contrat_Jetta.pdf', { sourceId: IDS.contrats03, sousChemin: '' }, ctx);
  assert.strictEqual(v.cibleNom, 'VW Jetta');
  assert.strictEqual(v.cibleParentId, IDS.vehiculeCible);
  assert.strictEqual(v.sousDossier, 'Recherche & achat', 'thème traduit en catégorie véhicule');
  // Une assurance qui nomme un véhicule de la TABLE est routée par find-or-create (le dossier
  // cible peut ne pas exister encore — le canon est la table, pas les dossiers présents).
  const fiesta = spec.router('2023-03-01_Contrat d\'assurance_Ford Fiesta.pdf', { sourceId: IDS.assuranceHab03, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(fiesta), { cibleParentId: IDS.vehiculeCible, cibleNom: 'Ford Fiesta', sousDossier: 'Assurance auto' });
  // ADR-0044 : KIA n'est PLUS un véhicule (décision Marc — c'était une recherche d'achat) : plus
  // de « Véhicule/KIA » créé, mais le document part au COMMUN « Recherche & achat » (décision 3,
  // « KIA compris »). Cette assertion attendait `null` — elle VERROUILLAIT le défaut trouvé par la
  // revue : le document restait alors à plat, sans cible, dans `03` (revue C28-62).
  assert.deepStrictEqual(plain(spec.router('2023-03-01_Contrat d\'assurance_KIA.pdf',
    { sourceId: IDS.assuranceHab03, sousChemin: '' }, ctx)),
  { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' },
  'KIA hors canon ⇒ dossier COMMUN, jamais un refus qui le laisse à plat');
  // Une facture d'énergie qui nomme l'adresse part vers Logement/<adresse>/Énergie & services.
  const l = spec.router('2023-02-01_Facture_Hydro 783 Moreau.pdf', { sourceId: IDS.energieServices03, sousChemin: '' }, ctx);
  assert.strictEqual(l.cibleId, 'lm');
  assert.strictEqual(l.sousDossier, 'Énergie & services');
  // c49-2 : un bail nommé par BAILLEUR (jamais l'adresse — ADR-0040 §2) part vers son logement.
  const bail = spec.router('2025-09-01_Bail de logement_9478-5045 Québec inc.pdf', { sourceId: IDS.contrats03, sousChemin: '' }, ctx);
  assert.strictEqual(bail.cibleId, 'l3987', 'bailleur 9478-5045 → 3987 (preuve ADR-0040)');
  assert.strictEqual(bail.sousDossier, 'Contrats');
  // Correspondance SANS indice : la date tranche (demande Marc) — pas les autres thèmes.
  const parDate = spec.router('2023-05-01_Lettre_Ville.pdf', { sourceId: IDS.correspondance03, sousChemin: '' }, ctx);
  assert.strictEqual(parDate.cibleId, 'lm');
  const pasParDate = spec.router('2023-05-01_Facture_Hydro.pdf', { sourceId: IDS.energieServices03, sousChemin: '' }, ctx);
  assert.strictEqual(pasParDate, null, 'la date ne route QUE la correspondance');
  // ADR-0044 : une LOCATION va dans « Véhicule/Locations » — elle n'est plus refusée, mais elle
  // ne rejoint JAMAIS un véhicule de Marc (les 3 contrats Enterprise dormaient dans 03·Contrats).
  assert.deepStrictEqual(plain(spec.router('2026-04-10_Contrat de location de véhicule_Enterprise.pdf',
    { sourceId: IDS.contrats03, sousChemin: '' }, ctx)),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' });
  // …et le PIÈGE que ce prédicat doit éviter : « demande de location » est du LOGEMENT.
  const corpiq = spec.router('2018-10-15_Formulaire de demande de location_CORPIQ.pdf',
    { sourceId: IDS.contrats03, sousChemin: '' }, ctx);
  assert.ok(!corpiq || corpiq.cibleNom !== 'Locations', 'un bail n\'est pas une location de voiture');
});

test('routeur vehicule (c49-3, ADR-0044) : communs > véhicule nommé > « À attribuer » — JAMAIS par date', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const spec = pur.tableMissions_().filter((m) => m.tag === 'vehicule')[0];
  const ctx = {}; // plus AUCUNE fenêtre : le repli par date est retiré
  const rte = (nom, sousChemin, sourceId) =>
    plain(spec.router(nom, { sourceId: sourceId || IDS.vehiculesPluriel, sousChemin: sousChemin }, ctx));

  // 1. Le sous-dossier source « KIA » n'est plus un véhicule → dossier COMMUN, à plat.
  assert.deepStrictEqual(rte('2023-05-01_Facture_Garage.pdf', 'KIA'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });

  // 2. Le sous-dossier source « Recherche & achat » : du MAGASINAGE, sur des véhicules que Marc
  //    n'a jamais possédés. Cas RÉEL du Drive (11 fichiers). Router ça par date l'aurait rangé
  //    sous le véhicule possédé cette année-là — faux positif DÉFINITIF (revue C28-62).
  assert.deepStrictEqual(
    rte('2026-07-01_Annonce de vente_Annonce vente Honda Civic 2017 104 998 km Shawinigan 16 999 $.jpg', 'Recherche & achat'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });

  // 3. Les 2 dossiers KIA parasites sont dissous PAR IDENTITÉ, pas par le nommage : leurs
  //    fichiers sont à la RACINE de la source (`sousChemin` = ''), donc `sources: ['KIA']` ne les
  //    voit pas. Le nom ci-dessous ne porte MÊME PAS le mot « kia » — c'est ce qui prouve que la
  //    dissolution ne dépend pas de la chance du nommage (revue C28-62).
  assert.deepStrictEqual(rte('2026-07-31_Tableau comparatif_Comparatif prix véhicules d\'occasion.pdf', '', IDS.vehiculeKiaJetta),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });
  //    …et un document « KIA » entré autrement reste reconnu par le NOM, MÊME table.
  assert.deepStrictEqual(rte('2026-07-01_Reçu de service_KIA Ste-Foy.jpg', '', IDS.vehiculeKia),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });

  // 4. 🔴 LE CŒUR DE LA DÉCISION DE MARC (2026-08-20) : aucun véhicule identifiable ⇒ « À
  //    attribuer », JAMAIS une attribution par date. Cas réel : 16 assurances Desjardins + 19
  //    factures de garage ne nomment aucun véhicule du canon. La CATÉGORIE est conservée pour que
  //    la répartition manuelle reste faisable.
  assert.deepStrictEqual(rte('2023-06-27_Constat d\'infraction_Ville de Québec.jpg', 'Contraventions'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'À attribuer', sousDossier: 'Contraventions' });
  assert.deepStrictEqual(rte('2023-10-02_Facture de réparation automobile_Garage Charlesbourg Certi-Pro.jpg', 'Entretien & réparations'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'À attribuer', sousDossier: 'Entretien & réparations' });

  // 5. Véhicule NOMMÉ : son dossier, avec la catégorie du sous-dossier source.
  assert.deepStrictEqual(rte('2024-02-01_Facture_Garage VW Jetta.pdf', 'Entretien & réparations'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'VW Jetta', sousDossier: 'Entretien & réparations' });

  // 6. LOCATION + véhicule du canon = AMBIGU (bail/LOA sur SON véhicule ?) ⇒ refus RÉVISABLE,
  //    jamais un déplacement définitif. Preuve par contraste avec le cas 7.
  assert.strictEqual(spec.router('2024-01-01_Contrat de location de véhicule_VW Jetta.pdf',
    { sourceId: IDS.vehiculesPluriel, sousChemin: '' }, ctx), null,
  'location + véhicule nommé : ambigu ⇒ refus (le déplacement serait définitif)');

  // 7. LOCATION sans véhicule du canon → « Locations » (les 3 contrats Enterprise réels).
  assert.deepStrictEqual(rte('2019-03-01_Contrat de location de véhicule_Enterprise.pdf', ''),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' });
  // …au PLURIEL aussi (« véhicules » manquait à la liste des mots — revue C28-62).
  assert.deepStrictEqual(rte('2019-03-01_Contrat de location de véhicules_Enterprise.pdf', ''),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' });
});

test('ADR-0044 : le repli par DATE est RETIRÉ de la mission véhicule (fenêtres inutilisables sur le Drive réel)', () => {
  const spec = pur.tableMissions_().filter((m) => m.tag === 'vehicule')[0];
  // `batirCtx` ne construit plus AUCUNE fenêtre : « Ford Fiesta » est vide (⇒ gate insatisfiable)
  // et la fenêtre de la Jetta courait de 2019 à 2026. Un ctx vide ne doit RIEN changer au verdict.
  assert.deepStrictEqual(Object.keys(plain(spec.batirCtx())), [], 'plus de fenêtres ni de gate de complétude');
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const avec = plain(spec.router('2023-06-27_Constat_Ville.jpg',
    { sourceId: IDS.vehiculesPluriel, sousChemin: 'Contraventions' },
    { fenetres: [{ id: 'vjetta', min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 31) }], fenetresCompletes: true }));
  assert.strictEqual(avec.cibleNom, 'À attribuer',
    'même avec un ctx de fenêtres COMPLET et une date qui tombe dedans, plus aucune attribution par date');
});

test('cibleBailleur_ : dossier RENOMMÉ/absent ⇒ refus — la table ne crée JAMAIS un doublon', () => {
  // La promesse du canon (Config) : résolution PAR NOM parmi les cibles réelles — si le dossier
  // Drive a été renommé, on REFUSE (révisable) au lieu de find-or-créer un doublon.
  assert.strictEqual(pur.cibleBailleur_('2025-09-01_Bail_9478-5045 Québec inc.pdf',
    [{ nom: '3987 route des Rivières (RENOMMÉ)', id: 'x' }]), null);
  const ok = pur.cibleBailleur_('2025-09-01_Bail_9478-5045 Québec inc.pdf',
    [{ nom: '3987 rte des Rivières', id: 'l3987' }]);
  assert.strictEqual(ok.id, 'l3987');
});

test('routeur archives06 : alias explicite = transfert ; source hors table = jamais une source', () => {
  const spec = pur.tableMissions_().filter((m) => m.tag === 'archives06')[0];
  const paires = pur.CONFIG.MISSIONS_IDS.archives06;
  assert.ok(paires.length >= 4, 'les 4 alias du brief');
  const ctx = spec.batirCtx();
  const r = spec.router('2020-01-01_Relevé_ULCO.pdf', { sourceId: paires[0].src, sousChemin: 'Semestre 1' }, ctx);
  assert.strictEqual(r.cibleId, paires[0].cible);
  assert.strictEqual(r.sousDossier, 'Semestre 1', 'un niveau de sous-dossier préservé');
  // Les sources de la mission sont EXACTEMENT les alias (Cégep de Sherbrooke absent = non touché).
  assert.deepStrictEqual(plain(spec.sources), plain(paires.map((p) => p.src)));
});

test('budgetJourMissions_ : jour courant compté, autre jour = 0 (patron conso)', () => {
  const props = { getProperty: (k) => (k === 'DriveAI_MISSIONS_JOUR' ? '2026-08-17|120000' : null) };
  assert.strictEqual(pur.budgetJourMissions_(props, '2026-08-17'), 120000);
  assert.strictEqual(pur.budgetJourMissions_(props, '2026-08-18'), 0);
});

/* ---------- Runner (mocks I/O) ---------- */

/**
 * Contexte de runner : Drive mocké par une carte {folderId: {files:[], folders:{nom:sousId}}}.
 * Chaque fichier factice lit ses variations dans SON PROPRE objet (leçon C28-33 — jamais la
 * fermeture de construction).
 */
function ctxRunner(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const store = Object.assign({}, opts.props);
  const index = Object.assign({}, opts.index); // clés déjà présentes
  const ajouts = [];
  const moves = [];
  const peints = [];
  const infos = [];

  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  c.journalInfo_ = (s, m) => infos.push(m);
  c.journalErreur_ = (s, m) => infos.push('ERR ' + m);
  c.indexContient_ = (cle) => index[cle] === true;
  c.indexAjouter_ = (cle, meta) => { index[cle] = true; ajouts.push({ cle, statut: meta.statut }); };
  c.ensembleDomainesProteges_ = () => ({ 'dom04': true });
  c.aParentProtege_ = (f, proteges, strict) => !!f.__protege;
  c.nbParentsBorne_ = (f) => f.__parents || 1;
  c.dateGmail_ = () => '2026-08-17';
  c.repointerEntites_ = (src, cible) => { moves.push({ repointe: src + '→' + cible }); };
  c.peindreDossierRouge_ = (id) => peints.push(id);
  c.fetchDriveAvecRetry_ = () => ({ getResponseCode: () => 200, getContentText: () => '{}' });
  c.jetonDrive_ = () => 'jeton';

  const arbre = opts.arbre || {};
  const dossierFactice = (id) => {
    const noeud = arbre[id] || { files: [], folders: {} };
    return {
      getId: () => id,
      getName: () => noeud.nom || id,
      getFiles: () => iterFactice((noeud.files || []).filter((f) => !f.__deplace)),
      getFolders: () => iterFactice(Object.keys(noeud.folders || {}).map((n) => dossierFactice(noeud.folders[n]))),
    };
  };
  const iterFactice = (items) => {
    let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++] };
  };
  c.DriveApp = { getFolderById: (id) => dossierFactice(id) };
  c.sousDossier_ = (parent, nom) => dossierFactice(parent.getId() + '/' + nom);

  const fichier = (id, nom, extra) => Object.assign({
    getId: () => id,
    getName: () => nom,
    moveTo: function (dossier) { this.__deplace = true; moves.push({ id, vers: dossier.getId() }); },
  }, extra || {});

  return { c, store, index, ajouts, moves, peints, infos, fichier, arbre };
}

test('runner : déplace, pose la clé VERSIONNÉE après, converge sur la passe vide, peint le vide en rouge', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  const version = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  // `Toyota bZ` isolé : 2 fichiers → tout part vers Véhicule/Toyota bZ (en bloc).
  h.arbre[IDS.toyotaBzIsole] = { files: [h.fichier('f1', '2025-01-01_Facture_Garage.pdf'), h.fichier('f2', '2025-02-01_SAAQ.pdf')], folders: {} };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.moves.length, 2);
  assert.ok(h.moves.every((m) => m.vers === IDS.vehiculeCible + '/Toyota bZ'), 'cible = Véhicule/Toyota bZ');
  assert.ok(h.index['mission|vehicule|' + version + '|f1'], 'clé versionnée posée');
  assert.ok(!h.store['DriveAI_MISSION_FINI_vehicule'], 'passe PRODUCTIVE ≠ convergence');

  // Passe suivante : plus rien à traiter (fichiers déplacés) → convergence + peinture du vide.
  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_vehicule'], version, 'convergé sur passe vide');
  assert.ok(h.peints.indexOf(IDS.toyotaBzIsole) !== -1, 'source vidée peinte en rouge');
  assert.ok(h.peints.indexOf(IDS.vehiculesPluriel) !== -1);

  // Compteurs Progression : t=2, base EXACTE mesurée par la passe complète (t + na).
  const etatM = JSON.parse(h.store['DriveAI_MISSIONS_ETAT']);
  assert.strictEqual(etatM.vehicule.t, 2);
  assert.strictEqual(etatM.vehicule.na, 0);
  assert.strictEqual(etatM.vehicule.b, 2, 'base = t + na après une passe complète');
});

test('runner : NON APPARIÉ inscrit sous la version (re-collecté JAMAIS, ré-évaluable par bump)', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  const version = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  h.arbre[IDS.logementsPluriel] = { files: [h.fichier('fx', '2024-01-01_Relevé_Sans indice.pdf')], folders: {} };
  h.arbre[IDS.logementCible] = { files: [], folders: {} };

  h.c.executerMission_('logement', () => false);
  assert.strictEqual(h.moves.length, 0, 'rien déplacé (aucun jeton ne matche)');
  assert.strictEqual(h.ajouts.filter((a) => a.statut === 'mission-non-apparie').length, 1);
  assert.ok(h.index['mission|logement|' + version + '|fx']);

  // 2e passe : le refus est KEYÉ → passe VIDE → convergence avec na=1 (statut « à jour (1 non apparié) »).
  h.c.executerMission_('logement', () => false);
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_logement'], version);
  const etatM = JSON.parse(h.store['DriveAI_MISSIONS_ETAT']);
  assert.strictEqual(etatM.logement.na, 1);

  // BUMP de version : la clé ancienne ne masque plus le fichier — ré-évalué sous les nouvelles
  // règles. Valeur DÉRIVÉE de la constante (leçon §7 : « c49-2 » en dur a menti au premier bump réel).
  h.c.CONFIG.MISSIONS_REGLES_VERSION = version + '-bump';
  assert.ok(!h.c.indexContient_('mission|logement|' + version + '-bump|fx'), 'nouvelle version = nouvelle chance');
});

test('runner : un fichier PROTÉGÉ ou MULTI-PARENTS n\'est JAMAIS déplacé (refus inscrit)', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.arbre[IDS.toyotaBzIsole] = { files: [
    h.fichier('fp', '2025-01-01_X.pdf', { __protege: true }),
    h.fichier('fm', '2025-01-01_Facture_Garage.pdf', { __parents: 2 }),
  ], folders: {} };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.moves.length, 0, 'aucune mutation');
  // Le protégé est écarté À LA COLLECTE (non strict) — s'il passait, la re-vérif stricte le bloque.
  assert.strictEqual(h.ajouts.filter((a) => a.statut === 'mission-multi-parents').length, 1);
});

test('runner : budget du jour épuisé → aucune I/O ; garde-temps → passe INCOMPLÈTE (pas de convergence)', () => {
  const epuise = ctxRunner({ props: { DriveAI_MISSIONS_JOUR: '2026-08-17|' + (10 * 60 * 1000) } });
  const IDS = epuise.c.CONFIG.MISSIONS_IDS;
  epuise.arbre[IDS.toyotaBzIsole] = { files: [epuise.fichier('f1', '2025-01-01_A.pdf')], folders: {} };
  epuise.c.executerMission_('vehicule', () => false);
  assert.strictEqual(epuise.moves.length, 0, 'repris demain');
  assert.strictEqual(epuise.c.gMissionsJour_(), 'budget du jour épuisé', 'la gate donne la raison au suivi');

  // Garde qui coupe IMMÉDIATEMENT : rien n'est traité ET la mission ne « converge » pas à tort.
  const coupe = ctxRunner();
  coupe.arbre[IDS.toyotaBzIsole] = { files: [coupe.fichier('f1', '2025-01-01_A.pdf')], folders: {} };
  coupe.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  coupe.c.executerMission_('vehicule', () => true); // estBudgetDepasse = true dès l'entrée
  assert.strictEqual(coupe.moves.length, 0);
  assert.ok(!coupe.store['DriveAI_MISSION_FINI_vehicule'], 'passe coupée ≠ passe vide');
});

test('runner archives06 : transfert par alias + RE-POINTAGE des entités à la convergence', () => {
  const h = ctxRunner();
  const paires = h.c.CONFIG.MISSIONS_IDS.archives06;
  paires.forEach((p) => { h.arbre[p.src] = { files: [], folders: {} }; });
  h.arbre[paires[0].src].files = [h.fichier('fd', '2019-05-01_Relevé_ULCO.pdf')];

  h.c.executerMission_('archives06', () => false);
  assert.deepStrictEqual(plain(h.moves.filter((m) => m.vers)), [{ id: 'fd', vers: paires[0].cible }]);

  h.c.executerMission_('archives06', () => false); // passe vide → convergence
  const repointes = h.moves.filter((m) => m.repointe);
  assert.strictEqual(repointes.length, paires.length, 'chaque entité re-pointée vers son archive');
});

test('un re-pointage qui LÈVE empêche le drapeau FINI — re-tenté à la passe suivante (🟠 revue sécurité)', () => {
  // FINI posé AVANT `apresConvergence` + court-circuit terminal = échec JAMAIS re-tenté : le flux
  // vivant re-remplirait le dossier vidé/peint en rouge que Marc s'apprête à corbeiller. Prouvé
  // par mutation : remonter le setProperty au-dessus de l'appel fait échouer ce test.
  const h = ctxRunner();
  const paires = h.c.CONFIG.MISSIONS_IDS.archives06;
  paires.forEach((p) => { h.arbre[p.src] = { files: [], folders: {} }; });
  let rate = true;
  h.c.repointerEntites_ = () => { if (rate) throw new Error('Sheet indisponible'); h.moves.push({ repointe: 'ok' }); };

  assert.throws(() => h.c.executerMission_('archives06', () => false), /Sheet indisponible/,
    'l\'échec REMONTE (etapeSuivie_ le journalise) au lieu d\'être avalé');
  assert.ok(!h.store['DriveAI_MISSION_FINI_archives06'], 'pas de FINI sur un re-pointage raté');
  assert.ok(h.store['DriveAI_MISSIONS_JOUR'], 'le budget consommé est écrit malgré le throw (finally)');

  // La Sheet revient : la passe suivante (vide, quasi gratuite) re-tente et conclut.
  rate = false;
  h.c.executerMission_('archives06', () => false);
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_archives06'], h.c.CONFIG.MISSIONS_REGLES_VERSION);
  assert.strictEqual(h.moves.filter((m) => m.repointe).length, paires.length);
  // LIBÉRATION du compteur (revue finale PR2 — « un gate se teste par sa libération », leçon §7) :
  // l'échec a incrémenté errC ; le succès doit l'effacer, sinon un errC ≥ MAX survivrait au FINI
  // et re-bloquerait une journée entière au PREMIER échec après un futur bump de version.
  const etatApres = JSON.parse(h.store['DriveAI_MISSIONS_ETAT']).archives06;
  assert.strictEqual(etatApres.errC, undefined, 'errC effacé par la convergence réussie');
  assert.strictEqual(etatApres.errJour, undefined, 'errJour effacé avec lui');
});

test('ordre des écritures : un moveTo qui LÈVE ne pose PAS la clé (rejouer, jamais perdre)', () => {
  // Prouvé nécessaire par mutation : inverser move/clé laissait la suite verte — ce test attrape
  // désormais l'inversion (clé posée avant un move qui échoue = fichier « traité » jamais déplacé).
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  const casse = h.fichier('fk', '2025-01-01_Facture_Garage.pdf');
  casse.moveTo = () => { throw new Error('Drive 500'); };
  h.arbre[IDS.toyotaBzIsole] = { files: [casse], folders: {} };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  const version = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  assert.ok(!h.index['mission|vehicule|' + version + '|fk'],
    'échec TRANSITOIRE ⇒ aucune clé — le fichier sera re-tenté au prochain run');
  assert.ok(!h.store['DriveAI_MISSION_FINI_vehicule'], 'et la passe reste incomplète');
});

test('la RE-VÉRIF STRICTE avant mutation bloque un protégé que la collecte n\'a pas vu', () => {
  // Prouvé nécessaire par mutation : retirer la re-vérif stricte laissait la suite verte. Ici la
  // protection n'apparaît QU'EN mode strict (le cas réel : getParents illisible à la collecte,
  // échec-fermé à la mutation) — sans la re-vérif, le fichier serait déplacé.
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.c.aParentProtege_ = (f, proteges, strict) => !!(strict && f.__protegeStrict);
  h.arbre[IDS.toyotaBzIsole] = { files: [h.fichier('fs', '2025-01-01_X.pdf', { __protegeStrict: true })], folders: {} };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.moves.length, 0, 'JAMAIS déplacé (échec fermé §1)');
  assert.strictEqual(h.ajouts.filter((a) => a.statut === 'mission-protege').length, 1,
    'refus inscrit (sinon re-collecté à vie)');
});

test('🔴 revue code : un fichier POISON n\'affame NI les autres items NI les autres sources, et finit ABANDONNÉ', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  const MAX = h.c.CONFIG.QUARANTAINE_MAX;
  const essais = {};
  h.c.incrementerEchec_ = (cle) => { essais[cle] = (essais[cle] || 0) + 1; return essais[cle]; };
  // Le poison vit dans la PREMIÈRE source (Véhicules) — c'est le cas qui affamait : avec un seul
  // drapeau `coupe`, la boucle des sources s'arrêtait là et Toyota bZ (2e source) n'était JAMAIS
  // traité. Prouvé par mutation : re-fusionner les drapeaux fait échouer ce test.
  const poison = h.fichier('fp', '2025-01-01_Facture_Jetta.pdf');
  poison.moveTo = () => { throw new Error('Access denied'); };
  h.arbre[IDS.vehiculesPluriel] = { files: [poison, h.fichier('fs', '2025-02-01_Assurance_Jetta.pdf')], folders: {} };
  // Source SUIVANTE (Toyota bZ isolé) : un fichier parfaitement traitable — jamais affamé.
  h.arbre[IDS.toyotaBzIsole] = { files: [h.fichier('fbz', '2025-03-01_SAAQ.pdf')], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: { 'VW Jetta': 'vj' } };
  h.arbre['vj'] = { nom: 'VW Jetta', files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.deepStrictEqual(plain(h.moves.map((m) => m.id).sort()), ['fbz', 'fs'],
    'le poison ne bloque ni le fichier suivant de SA source, ni la source SUIVANTE');
  assert.ok(!h.store['DriveAI_MISSION_FINI_vehicule'], 'passe incomplète tant que le poison vit');
  // BASE HONNÊTE (revue code) : passe INCOMPLÈTE ⇒ pas de base — jamais un « 98 % · reste 1 »
  // fabriqué. Prouvé par mutation : rétablir `max(b, t+na+1)` fait échouer cette assertion.
  assert.ok(!JSON.parse(h.store['DriveAI_MISSIONS_ETAT']).vehicule.b,
    'aucune base tant qu\'aucune passe COMPLÈTE n\'a mesuré le périmètre');

  // Runs suivants : essais bornés, puis ABANDON tracé (refus keyé) → la convergence redevient possible.
  for (let i = 1; i < MAX; i++) h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.ajouts.filter((a) => a.statut === 'mission-echec').length, 1,
    'après ' + MAX + ' essais : abandon inscrit sous la clé versionnée (ré-évaluable par bump)');
  h.c.executerMission_('vehicule', () => false); // poison keyé → passe vide → convergence
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_vehicule'], h.c.CONFIG.MISSIONS_REGLES_VERSION);
});

test('peinture : un dossier NON vide n\'est JAMAIS peint (le rouge = « supprimable », pas « traité »)', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  // Source avec un sous-dossier resté NON vide (un non-apparié y demeure) : refusé (keyé) → la
  // mission converge quand même, mais NI la source NI ce sous-dossier ne doivent passer au rouge.
  h.arbre['sousplein'] = { nom: 'Reste', files: [h.fichier('fr', 'sans-date-ni-indice.bin')], folders: {} };
  h.arbre[IDS.logementsPluriel] = { files: [], folders: { 'Reste': 'sousplein' } };
  // c49-2 : le double LCP est aussi une source — son contenu part TOUT vers 3325 (drainage
  // inconditionnel), donc lui devient VIDE et peint — c'est le comportement VOULU ; la source
  // « Logements », elle, garde son non-apparié et ne doit JAMAIS passer au rouge.
  h.arbre[IDS.lcpLogementDouble] = { nom: 'LCP Groupe Immobilier', files: [h.fichier('flcp', 'sans-indice.bin')], folders: {} };
  h.arbre[IDS.logement3325] = { nom: '3325 4e avenue', files: [], folders: {} };
  h.arbre[IDS.logementCible] = { files: [], folders: { '3325 4e avenue': IDS.logement3325 } };

  h.c.executerMission_('logement', () => false); // le refus est inscrit ; le LCP est drainé
  h.c.executerMission_('logement', () => false); // passe vide → convergence
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_logement'], h.c.CONFIG.MISSIONS_REGLES_VERSION);
  assert.deepStrictEqual(plain(h.peints), [IDS.lcpLogementDouble],
    'seul le double VIDÉ est peint — jamais la source qui garde un non-apparié');
});

test('drainage LCP (c49-2) : le double part vers « 3325 4e avenue », segment préservé — et n\'est JAMAIS une cible', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.arbre['lcpbail'] = { nom: 'Bail & contrat', files: [h.fichier('fb', '2024-01-28_Avis de reconduction de bail_LCP Groupe Immobilier.pdf')], folders: {} };
  h.arbre[IDS.lcpLogementDouble] = { nom: 'LCP Groupe Immobilier', files: [h.fichier('fa', '2026-07-06_Échange de courriels_LCP Groupe Immobilier.jpg')], folders: { 'Bail & contrat': 'lcpbail' } };
  h.arbre[IDS.logementsPluriel] = { files: [h.fichier('fq', '2025-07_Quittance_LCP Groupe Immobilier.pdf')], folders: {} };
  // La cible « Logement » contient l'adresse GAGNANTE **ET** le double — si `ciblesLogement_` ne
  // filtrait pas, les jetons du double (« groupe », « immobilier ») capteraient la quittance et
  // le split se RE-créerait pendant qu'on le vide.
  h.arbre[IDS.logement3325] = { nom: '3325 4e avenue', files: [], folders: {} };
  h.arbre[IDS.logementCible] = { files: [], folders: { '3325 4e avenue': IDS.logement3325, 'LCP Groupe Immobilier': IDS.lcpLogementDouble } };

  h.c.executerMission_('logement', () => false);
  const vers = plain(h.moves.filter((m) => m.vers).map((m) => m.vers)).sort();
  // Contenu du double : à la MÊME place dans 3325 (racine → racine, Bail & contrat → Bail & contrat).
  assert.deepStrictEqual(vers, [IDS.logement3325, IDS.logement3325, IDS.logement3325 + '/Bail & contrat'].sort());
  // Et le fichier de la SOURCE « Logements » nommé par le bailleur va AUSSI au 3325 (table
  // bailleur, ADR-0040 §2) — jamais dans le dossier double (exclu des cibles par ciblesLogement_).
  assert.strictEqual(h.moves.filter((m) => String(m.vers).indexOf(IDS.lcpLogementDouble) !== -1).length, 0,
    'AUCUN mouvement vers le double — le split ne se re-crée pas');
});

test('cleMission_ contient la VERSION elle-même (verrou direct, pas via le mock d\'index)', () => {
  // La revue a pointé que l'assertion du bump interrogeait le mock (tautologique) : ici on
  // verrouille la PROPRIÉTÉ — la clé change quand la version change, à fileId constant.
  const avant = pur.cleMission_('logement', 'fx');
  assert.ok(avant.indexOf('|' + pur.CONFIG.MISSIONS_REGLES_VERSION + '|') !== -1);
  const sauvegarde = pur.CONFIG.MISSIONS_REGLES_VERSION;
  pur.CONFIG.MISSIONS_REGLES_VERSION = 'vX';
  try {
    assert.notStrictEqual(pur.cleMission_('logement', 'fx'), avant, 'bump ⇒ nouvelle clé ⇒ ré-évaluation');
  } finally { pur.CONFIG.MISSIONS_REGLES_VERSION = sauvegarde; }
});

test('collecte RÉCURSIVE : un fichier à profondeur 3 est vu, sousChemin = PREMIER segment', () => {
  // Revue code : à profondeur ≤ 2, `Véhicules/<X>/<thème>/f.pdf` était INVISIBLE et la mission se
  // déclarait « terminée » en l'ignorant.
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.arbre['profond'] = { nom: 'Entretien', files: [h.fichier('fp3', '2024-01-01_Facture.pdf')], folders: {} };
  h.arbre['sousjetta'] = { nom: 'VW Jetta', files: [], folders: { 'Entretien': 'profond' } };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: { 'VW Jetta': 'sousjetta' } };
  h.arbre[IDS.toyotaBzIsole] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: { 'VW Jetta': 'vj' } };
  h.arbre['vj'] = { nom: 'VW Jetta', files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.moves.length, 1, 'le fichier à profondeur 3 est collecté');
  assert.strictEqual(h.moves[0].vers, IDS.vehiculeCible + '/VW Jetta',
    'sousChemin = premier segment (« VW Jetta ») apparié au véhicule → contenu à plat');
});

test('convergence honnête : une source ILLISIBLE ne fait jamais conclure « passe complète »', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.c.DriveApp = { getFolderById: (id) => {
    if (id === IDS.toyotaBzIsole) throw new Error('Drive indisponible');
    return { getId: () => id, getName: () => id, getFiles: () => ({ hasNext: () => false }), getFolders: () => ({ hasNext: () => false }) };
  } };
  h.c.executerMission_('vehicule', () => false);
  assert.ok(!h.store['DriveAI_MISSION_FINI_vehicule'],
    'une erreur de collecte laisse la mission OUVERTE (jamais un faux « terminé »)');
});

test('filet anti-brûlage : une source en erreur PERMANENTE finit à 1 tentative/jour, une passe saine ré-arme', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  const MAX = h.c.CONFIG.MISSIONS_ERREURS_MAX;
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  let appels = 0;
  const casse = (id) => {
    if (id === IDS.toyotaBzIsole) { appels++; throw new Error('404 dossier supprimé'); }
    return { getId: () => id, getName: () => id, getFiles: () => ({ hasNext: () => false }), getFolders: () => ({ hasNext: () => false }) };
  };
  h.c.DriveApp = { getFolderById: casse };
  for (let i = 0; i < MAX; i++) h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(appels, MAX, 'jusqu\'au seuil, chaque run réessaie');
  h.c.executerMission_('vehicule', () => false); // au-delà du seuil, MÊME jour → sauté
  assert.strictEqual(appels, MAX, 'au-delà du seuil : plus qu\'une tentative par jour');
  assert.ok(!h.store['DriveAI_MISSION_FINI_vehicule'], 'et toujours pas un faux « terminé »');

  // Le lendemain : UNE tentative — et si la source est revenue, la passe saine ré-arme tout.
  h.c.dateGmail_ = () => '2026-08-18';
  h.c.DriveApp = { getFolderById: (id) => ({ getId: () => id, getName: () => id, getFiles: () => ({ hasNext: () => false }), getFolders: () => ({ hasNext: () => false }) }) };
  h.c.executerMission_('vehicule', () => false);
  const m = JSON.parse(h.store['DriveAI_MISSIONS_ETAT']).vehicule;
  assert.ok(!m.err, 'passe saine ⇒ compteur d\'erreurs remis à zéro');
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_vehicule'], h.c.CONFIG.MISSIONS_REGLES_VERSION,
    'et la convergence redevient possible');
});

test('mémoïsation à portée RUN : la même cible n\'est résolue qu\'UNE fois pour N items (revue quotas)', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  let resolutions = 0;
  const vraiSous = h.c.sousDossier_;
  h.c.sousDossier_ = (parent, nom) => { resolutions++; return vraiSous(parent, nom); };
  h.arbre[IDS.toyotaBzIsole] = { files: [
    h.fichier('f1', '2025-01-01_A.pdf'), h.fichier('f2', '2025-02-01_B.pdf'), h.fichier('f3', '2025-03-01_C.pdf'),
  ], folders: {} };
  h.arbre[IDS.vehiculesPluriel] = { files: [], folders: {} };
  h.arbre[IDS.vehiculeCible] = { files: [], folders: {} };

  h.c.executerMission_('vehicule', () => false);
  assert.strictEqual(h.moves.length, 3);
  assert.strictEqual(resolutions, 1, '3 items, même cible « Toyota bZ » ⇒ UNE résolution find-or-create');
});

/* ================= PR2 : Carrière + Finances ================= */

test('employeurDuNom_ : canonisation par MOT ENTIER, ambigu/hors table = null', () => {
  assert.strictEqual(pur.employeurDuNom_('2025-11_Paie_Robovic Inc..pdf'), 'Robovic');
  assert.strictEqual(pur.employeurDuNom_('2025-01-31_Bulletin de paie_AUTOMATECH ROBOTIK INC..pdf'), 'Automatech');
  assert.strictEqual(pur.employeurDuNom_('2026-01_Paie_CIUSSS de la Capitale-Nationale.pdf'), 'CIUSSS');
  assert.strictEqual(pur.employeurDuNom_('2026-01_Paie_Inconnu Corp.pdf'), null, 'hors table = jamais deviné');
  assert.strictEqual(pur.employeurDuNom_('2026-01_Attestation_Robovic et Automatech.pdf'), null, 'deux employeurs = ambigu');
});

test('typeDuNomMission_ + anneeDuNomMission_ : segment TYPE et année de tête, robustes aux variantes', () => {
  assert.strictEqual(pur.typeDuNomMission_('2025-06-16_Contrat de travail_Robovic Inc..pdf'), 'contrat de travail');
  assert.strictEqual(pur.typeDuNomMission_('2026_Feuillet T4 – État de la rémunération payée_Robovic Inc..pdf'),
    'feuillet t4 etat de la remuneration payee');
  assert.strictEqual(pur.typeDuNomMission_('sans-date.pdf'), '', 'hors convention = pas de type');
  assert.strictEqual(pur.anneeDuNomMission_('2026_Feuillet T4_X.pdf'), '2026');
  assert.strictEqual(pur.anneeDuNomMission_('2025-12-12_Acte_X.pdf'), '2025');
  assert.strictEqual(pur.anneeDuNomMission_('0123_Bidon.pdf'), null, 'année implausible rejetée');
  assert.strictEqual(pur.anneeDuNomMission_('rapport 2024.pdf'), null, 'année pas en tête = pas un préfixe');
});

test('routerFinance02_ : paie→employeur, fiscal→Impôts/<année> (AVANT relevé générique), table stricte', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const paie = pur.routerFinance02_('2025-11_Paie_Robovic Inc..pdf', '2025');
  assert.deepStrictEqual(plain(paie), { cibleParentId: IDS.revenusPaie, cibleNom: 'Robovic' });
  const t4 = pur.routerFinance02_('2026_Feuillet T4 – État de la rémunération payée_Robovic Inc..pdf', '2025');
  assert.deepStrictEqual(plain(t4), { cibleParentId: IDS.impotsDeclarations, cibleNom: '2026' },
    'année du NOM prioritaire sur celle du dossier source');
  const releveImpot = pur.routerFinance02_('2024-03_Relevé d\'impôt_Revenu Québec.pdf', '2024');
  assert.strictEqual(releveImpot.cibleParentId, IDS.impotsDeclarations, 'relevé D\'IMPÔT est fiscal, pas bancaire');
  const releveBanque = pur.routerFinance02_('2024-03_Relevé de compte_Banque CIC.pdf', '2024');
  assert.strictEqual(releveBanque.cibleId, IDS.releves02);
  assert.strictEqual(releveBanque.sousDossier, '2024', 'bucket d\'année — LA MÊME règle que le flux (resetBucketAnnee_)');
  const recu = pur.routerFinance02_('2023-05-01_Facture_Hydro.pdf', '2023');
  assert.strictEqual(recu.cibleId, IDS.recusFactures02);
  assert.strictEqual(recu.sousDossier, 'Archives', '2023 hors buckets Reçus (2024-2026) → Archives, comme le flux');
  assert.strictEqual(pur.routerFinance02_('2023-05-01_Diplôme_ULCO.pdf', '2023'), null, 'type hors table = laissé');
  assert.strictEqual(pur.routerFinance02_('photo de vacances.jpg', '2023'), null, 'hors convention = laissé');
  const paieInconnue = pur.routerFinance02_('2025-11_Paie_Employeur Mystère.pdf', '2025');
  assert.strictEqual(paieInconnue, null, 'paie d\'un employeur hors table = laissée, jamais devinée');
});

test('routerFinance02_ : prédicats PARTAGÉS avec le flux — RL-1/31 fiscal, RIB refusé, « salaire » = paie (revue finale PR2)', () => {
  // Trois divergences flux ↔ mission attrapées par la passe finale (déplacements à clé de SUCCÈS,
  // donc DÉFINITIFS) — verrouillées ici sur les prédicats partagés de Reset.gs.
  const IDS = pur.CONFIG.MISSIONS_IDS;
  // RL-1/RL-31 : feuillets FISCAUX québécois, jamais des relevés bancaires (motif ANCRÉ — le flux
  // a la même règle AVANT son « relevé » générique, test/reset.test.js).
  const rl1 = pur.routerFinance02_('2025-02_Relevé 1_Robovic.pdf', '2025');
  assert.deepStrictEqual(plain(rl1), { cibleParentId: IDS.impotsDeclarations, cibleNom: '2025' });
  const rl31 = pur.routerFinance02_('2025-02_Relevé 31_LCP Groupe Immobilier.pdf', '2025');
  assert.strictEqual(rl31.cibleParentId, IDS.impotsDeclarations);
  // « Relevé 10 » n'est PAS capturé par le motif ancré : relevé ordinaire → bucket.
  assert.strictEqual(pur.routerFinance02_('2025-02_Relevé 10_Desjardins.pdf', '2025').cibleId, IDS.releves02);
  // RIB : des COORDONNÉES bancaires, pas un relevé de compte — la mission REFUSE (laissé +
  // rapporté ; le flux, lui, les range en Banques/Coordonnées & chèques).
  assert.strictEqual(pur.routerFinance02_('2024-05_Relevé d\'identité bancaire_CIC.pdf', '2024'), null);
  // « salaire » : même mot que le flux (bulletin/attestation de salaire = paie).
  const salaire = pur.routerFinance02_('2024-02_Attestation de salaire_CIUSSS.pdf', '2024');
  assert.deepStrictEqual(plain(salaire), { cibleParentId: IDS.revenusPaie, cibleNom: 'CIUSSS' });
  // « paiement » reste exclu par construction (mot entier — piège #228).
  assert.strictEqual(pur.routerFinance02_('2026-07_Confirmation de paiement_Crédit Mutuel.pdf', '2026'), null);
});

test('routerCarriere_ : recrutement, paie→02, types en table, dump racine par émetteur', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const ctx = { employeurParSource: (function () {
    const m = {}; m[IDS.employeursRobovic] = 'Robovic'; m[IDS.employeursAutomatech] = 'Automatech'; return m;
  })(), techniqueId: 'TECH' };
  // Une paie dans Employeurs/Robovic part vers 02 (domicile unique), SANS lire l'émetteur du nom.
  const paie = pur.routerCarriere_('2025-11_Paie_Robovic Inc..pdf', { sourceId: IDS.employeursRobovic, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(paie), { cibleParentId: IDS.revenusPaie, cibleNom: 'Robovic' });
  // Un contrat dans Employeurs/Robovic → sous-dossier Contrats.
  const contrat = pur.routerCarriere_('2025-06-16_Contrat de travail_Robovic Inc..pdf', { sourceId: IDS.employeursRobovic, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(contrat), { cibleId: IDS.employeursRobovic, sousDossier: 'Contrats' });
  // Type inconnu DANS Employeurs/<X> : laissé (le déplacer « à plat » serait un no-op déguisé).
  assert.strictEqual(pur.routerCarriere_('2025-01-01_Badge_Robovic.pdf', { sourceId: IDS.employeursRobovic, sousChemin: '' }, ctx), null);
  // Racine 05 (ex-dump Automatech) : émetteur SÛR + type inconnu → au moins Employeurs/<X> à plat.
  const dump = pur.routerCarriere_('2025-01-01_Badge_Automatech Robotik.pdf', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(dump), { cibleId: IDS.employeursAutomatech, sousDossier: '' });
  // Racine 05 : un CV part vers CV & lettres même sans employeur.
  const cv = pur.routerCarriere_('2026-01-01_CV_Marc Richard.pdf', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx);
  assert.strictEqual(cv.cibleId, IDS.cvLettres);
  // Racine 05 : aucun indice → laissé.
  assert.strictEqual(pur.routerCarriere_('notes perso.txt', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx), null);
  // CIUSSS (paie) depuis la racine : paie → 02 ; autre type CIUSSS → null (pas de dossier sous 05, on ne crée pas).
  const paieCiusss = pur.routerCarriere_('2026-01_Paie_CIUSSS de la Capitale-Nationale.pdf', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(paieCiusss), { cibleParentId: IDS.revenusPaie, cibleNom: 'CIUSSS' });
  assert.strictEqual(pur.routerCarriere_('2026-01_Attestation_CIUSSS de la Capitale-Nationale.pdf', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx), null);
  // « Bulletin de salaire » = une PAIE (prédicat partagé, revue finale PR2) : domicile unique 02,
  // JAMAIS Employeurs/<X> à plat (l'ancienne liste ['paie','paye'] l'y aurait égaré à clé de succès).
  const salaire = pur.routerCarriere_('2025-03_Bulletin de salaire_Robovic.pdf', { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx);
  assert.deepStrictEqual(plain(salaire), { cibleParentId: IDS.revenusPaie, cibleNom: 'Robovic' });
});

test('moisManquantsPaies_ : trous ENTRE premier et dernier mois observés, jamais au-delà des bornes', () => {
  const r = pur.moisManquantsPaies_({
    Robovic: ['2025-06', '2025-07', '2025-09', '2025-12', '2026-01'],
    CIUSSS: ['2026-01'],
  });
  const robovic = r.filter((x) => x.employeur === 'Robovic')[0];
  assert.deepStrictEqual(plain(robovic.manquants), ['2025-08', '2025-10', '2025-11'],
    'trous internes seulement — rien avant 2025-06 ni après 2026-01');
  assert.strictEqual(robovic.presents, 5);
  const ciusss = r.filter((x) => x.employeur === 'CIUSSS')[0];
  assert.deepStrictEqual(plain(ciusss.manquants), [], 'un seul mois = aucune borne à combler');
  // Passage d'année : 2025-12 → 2026-01 est CONSÉCUTIF.
  const cheval = pur.moisManquantsPaies_({ X: ['2025-11', '2026-02'] });
  assert.deepStrictEqual(plain(cheval[0].manquants), ['2025-12', '2026-01']);
});

test('profondeurPar = 0 : les sous-dossiers de la source sont HORS périmètre, sans fausse alerte', () => {
  const h = ctxRunner();
  // `convergenceApres` : la conclusion de paies attend carriere + annees02 — on les pose FINI.
  h.store['DriveAI_MISSION_FINI_carriere'] = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  h.store['DriveAI_MISSION_FINI_annees02'] = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  // Racine de Revenus & paie : 1 paie à plat + un sous-dossier Robovic déjà rempli (la SORTIE de
  // la mission) — celui-ci ne doit JAMAIS être recollecté, et la mission doit pouvoir CONVERGER.
  h.arbre['sousrob'] = { nom: 'Robovic', files: [h.fichier('deja', '2025-06_Paie_Robovic Inc..pdf')], folders: {} };
  h.arbre[IDS.revenusPaie] = { files: [h.fichier('fp', '2025-11_Paie_Robovic Inc..pdf')], folders: { 'Robovic': 'sousrob' } };
  h.c.ecrireRapportPaies_ = () => { h.moves.push({ rapport: true }); };

  h.c.executerMission_('paies', () => false);
  assert.deepStrictEqual(plain(h.moves.filter((m) => m.id).map((m) => m.id)), ['fp'],
    'seul le fichier À PLAT est traité — la sortie de la mission n\'est jamais re-collectée');
  assert.strictEqual(h.moves[0].vers, IDS.revenusPaie + '/Robovic');

  h.c.executerMission_('paies', () => false); // passe vide → convergence + rapport
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_paies'], h.c.CONFIG.MISSIONS_REGLES_VERSION,
    'la profondeur 0 VOULUE ne bloque pas la convergence (pas de fausse alerte « trop profond »)');
  assert.strictEqual(h.moves.filter((m) => m.rapport).length, 1, 'RapportPaies écrit à la convergence');
});

test('ecrireRapportPaies_ qui LÈVE empêche le FINI de la mission paies (rapport garanti)', () => {
  const h = ctxRunner();
  h.store['DriveAI_MISSION_FINI_carriere'] = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  h.store['DriveAI_MISSION_FINI_annees02'] = h.c.CONFIG.MISSIONS_REGLES_VERSION;
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  h.arbre[IDS.revenusPaie] = { files: [], folders: {} };
  let rate = true;
  h.c.ecrireRapportPaies_ = () => { if (rate) throw new Error('Sheet indisponible'); };
  assert.throws(() => h.c.executerMission_('paies', () => false), /Sheet indisponible/);
  assert.ok(!h.store['DriveAI_MISSION_FINI_paies']);
  rate = false;
  h.c.executerMission_('paies', () => false);
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_paies'], h.c.CONFIG.MISSIONS_REGLES_VERSION);
});

/* ---------- Régression C28-53 : l'onglet RapportPaies doit être créé par feuille_ ----------
 * Bug révélé par le MCP le 19/08 : `RapportPaies` manquait de `initialiserSheet_`, donc
 * `feuille_('RapportPaies')` rendait null et `ecrireRapportPaies_` plantait à CHAQUE tick
 * (`getRange of null`). Les tests existants MOCKENT `ecrireRapportPaies_` → ne voyaient pas ce
 * chemin. Ici on exerce le VRAI chemin sur un classeur où l'onglet est ABSENT au départ.
 */
const fs = require('node:fs');
const path = require('node:path');
const TOUS_GS = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f.endsWith('.gs'));

test('ecrireRapportPaies_ : onglet RapportPaies ABSENT → créé par feuille_, aucun crash (régression MCP 19/08)', () => {
  function fauxOnglet() {
    const cells = {};
    const rangees = []; // lignes écrites par setValues (pour vérifier le CONTENU, pas juste l'absence de crash)
    let dernLigne = 1;
    const o = {
      rangees,
      getRange: (a, b, h, w) => {
        // getRange('A1') OU getRange(ligne, col, h, w)
        const cle = typeof a === 'string' ? a : a + ',' + b;
        return {
          getValue: () => cells[cle] || '',
          setValues: (v) => { v.forEach((ligne, i) => { rangees[(a || 1) + i] = ligne; }); dernLigne = Math.max(dernLigne, (a || 1) + (v.length - 1)); },
          setValue: (x) => { cells[cle] = x; },
          clearContent: () => {},
        };
      },
      setFrozenRows: () => {},
      getLastRow: () => dernLigne,
      appendRow: () => { dernLigne++; },
    };
    return o;
  }
  const onglets = {};
  const ss = {
    getSheetByName: (nom) => onglets[nom] || null,
    insertSheet: (nom) => { onglets[nom] = fauxOnglet(); return onglets[nom]; },
    getSheets: () => Object.keys(onglets).map((k) => onglets[k]),
    deleteSheet: () => {},
  };
  const c = load(TOUS_GS);
  c.getSheetEtat_ = () => ss;
  c.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  const infos = [];
  c.journalInfo_ = (s, m) => infos.push(m);
  c.journalErreur_ = () => {};
  // Un dossier employeur avec deux mois présents (2026-01, 2026-03).
  c.DriveApp = { getFolderById: () => ({
    getFolders: () => {
      let servi = false;
      return { hasNext: () => !servi, next: () => { servi = true; return {
        getName: () => 'Robovic Inc.',
        getFiles: () => {
          const noms = ['2026-01_Paie_Robovic.pdf', '2026-03_Paie_Robovic.pdf']; let i = 0;
          return { hasNext: () => i < noms.length, next: () => ({ getName: () => noms[i++] }) };
        },
      }; } };
    },
  }) };

  assert.strictEqual(onglets.RapportPaies, undefined, 'onglet absent au départ (le cas prod)');
  assert.doesNotThrow(() => c.ecrireRapportPaies_(),
    'feuille_ doit CRÉER RapportPaies via initialiserSheet_ — jamais un getRange sur null');
  assert.ok(onglets.RapportPaies, 'l\'onglet a bien été créé');
  assert.strictEqual(infos.filter((m) => m.indexOf('RapportPaies écrit') === 0).length, 1, 'le rapport est écrit');
  // Contenu : la ligne 2 porte l'employeur et sa couverture (2 mois présents, mois manquants comptés).
  const ligne2 = onglets.RapportPaies.rangees[2];
  assert.ok(ligne2 && ligne2[0] === 'Robovic Inc.', 'la ligne employeur est écrite (pas juste l\'en-tête)');
  assert.strictEqual(ligne2[1], 2, '2 mois présents (2026-01, 2026-03)');
});

/* ---------- ADR-0044 : dossiers communs sous « Véhicule » + détection de location ---------- */

test('communVehiculeDepuisSource_ (PURE) : le dossier SOURCE décide, jamais la date', () => {
  const f = pur.communVehiculeDepuisSource_;
  assert.strictEqual(f('KIA'), 'Recherche & achat');
  assert.strictEqual(f('kia/Entretien & réparations'), 'Recherche & achat', 'insensible à la casse et au sous-chemin');
  assert.strictEqual(f('Contraventions'), '', 'une CATÉGORIE n\'est pas un commun');
  assert.strictEqual(f(''), '');
  assert.strictEqual(f('Ford Fiesta'), '', 'un vrai véhicule reste un véhicule');
});

test('estLocationVehicule_ (PURE) : strict — « location » SEUL ne suffit jamais', () => {
  const f = pur.estLocationVehicule_;
  // Vrai : les 3 contrats réellement présents dans le Drive de Marc.
  assert.strictEqual(f('2026-07-02_Contrat de location de véhicule_Enterprise (Location d\'autos).pdf'), true);
  assert.strictEqual(f('2026-04-10_Contrat de location de véhicule_Location d\'autos Enterprise.pdf'), true);
  assert.strictEqual(f('2026-04-13_Contrat de location de véhicule_Enterprise.pdf'), true);

  // FAUX — les pièges. Le 1er jet du prédicat (liste de marques de loueurs) cassait les deux
  // premiers : « Avis » est un loueur mais surtout un mot français des plus courants, et
  // « demande de location » désigne un LOGEMENT.
  assert.strictEqual(f('2022-11_Avis de séjour_Camping.pdf'), false);
  assert.strictEqual(f('2018-10-15_Formulaire de demande de location_CORPIQ.pdf'), false);
  assert.strictEqual(f('2024-03-01_Avis de paiement_Ville de Québec.pdf'), false);
  assert.strictEqual(f('2023-05-01_Bail de logement_Tribunal administratif du logement.pdf'), false);
  assert.strictEqual(f('2025-01-01_Budget mensuel.pdf'), false, '« budget » est aussi un loueur — et un mot courant');
  assert.strictEqual(f(''), false);
});

test('ADR-0044 : KIA a bien quitté le canon des véhicules (sinon rien n\'est débloqué)', () => {
  // ⚠️ Ce test a longtemps porté la mention « c'est LE correctif à fort levier : `fenetresCompletes`
  // était faux à vie ». L'ADR-0044 §4.1 démontre que c'était FAUX (`Ford Fiesta` étant vide, la
  // gate restait insatisfiable même sans KIA) — et `fenetresCompletes` n'existe plus. Ce qui reste
  // vrai, et que ce test verrouille : KIA n'est plus un véhicule, donc plus aucun document ne peut
  // lui être attribué ni faire re-créer son dossier.
  const noms = (pur.CONFIG.MISSIONS_VEHICULES || []).map((v) => v.nom);
  assert.ok(noms.indexOf('KIA') === -1, 'KIA ne doit plus être un véhicule (décision Marc)');
  assert.ok(noms.length >= 3, 'les vrais véhicules restent');
  assert.strictEqual(pur.vehiculeDuNom_('2023-05-01_Facture_KIA Sportage.pdf'), null);
  assert.strictEqual(pur.vehiculeDuNom_('2023-05-01_Facture_VW Jetta.pdf'), 'VW Jetta');
});

test('MISSIONS_MOTS_VEHICULE : jetons ALPHABÉTIQUES seulement — invariant tacite verrouillé', () => {
  // `estLocationVehicule_` n'ôte PAS le préfixe de date (contrairement à `apparierUnique_`) :
  // normalisé, « 2024-05-12_ » devient « 2024 05 12 ». Ajouter un millésime ou un code modèle
  // NUMÉRIQUE à cette liste matcherait instantanément un composant de date sur TOUS les documents
  // classés. L'invariant tenait par chance ; il tient maintenant par test (revue C28-62).
  pur.MISSIONS_MOTS_VEHICULE.forEach((m) => assert.match(m, /^[a-z]+$/,
    'jeton non alphabétique = faux positif garanti sur les dates : ' + m));
  // Contre-épreuve : la date seule ne fait jamais une location.
  assert.strictEqual(pur.estLocationVehicule_('2024-05-12_Avis de cotisation_Revenu Québec.pdf'), false);
});

test('dispatch03 : le 3e consommateur applique EXACTEMENT les mêmes règles véhicule (ADR-0044)', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const d03 = pur.tableMissions_().filter((m) => m.tag === 'dispatch03')[0];
  const veh = pur.tableMissions_().filter((m) => m.tag === 'vehicule')[0];
  const ctx = { themePar: {}, themeVehiculePar: {}, logements: [], fenetres: [] };
  const infoC = { sourceId: IDS.contrats03, sousChemin: '' };

  // 1. COMMUN par le NOM : « mutualiser UNE dimension d'une règle ne couvre pas les autres ».
  //    L'employeur et les buckets étaient partagés, la reconnaissance des communs ne l'était pas :
  //    un « KIA » égaré dans `03 · Contrats` n'était routé par AUCUNE des 3 règles.
  assert.deepStrictEqual(plain(d03.router('2023-01_Facture_KIA Québec.pdf', infoC, ctx)),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });

  // 2. AMBIGUÏTÉ location + véhicule du canon ⇒ refus, comme les 2 autres consommateurs.
  //    Avant : `Locations` inconditionnel — un déplacement DÉFINITIF au mauvais endroit.
  const ambigu = '2024-01-01_Contrat de location de véhicule_VW Jetta.pdf';
  assert.strictEqual(d03.router(ambigu, infoC, ctx), null, 'dispatch03 refuse l\'ambigu');
  assert.strictEqual(veh.router(ambigu, { sourceId: IDS.vehiculesPluriel, sousChemin: '' }, {}), null,
    'mission véhicule : MÊME verdict');

  // 3. Sans véhicule du canon, la location part bien en « Locations » (les 3 Enterprise réels).
  const enterprise = '2019-03-01_Contrat de location de véhicule_Enterprise.pdf';
  assert.deepStrictEqual(plain(d03.router(enterprise, infoC, ctx)),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' });
  assert.deepStrictEqual(plain(veh.router(enterprise, { sourceId: IDS.vehiculesPluriel, sousChemin: '' }, {})),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' });
});

test('routeur vehicule : le filet « À attribuer » n\'avale JAMAIS un document non-véhicule égaré', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const spec = pur.tableMissions_().filter((m) => m.tag === 'vehicule')[0];
  const rte = (nom, sousChemin) =>
    spec.router(nom, { sourceId: IDS.vehiculesPluriel, sousChemin: sousChemin }, {});
  // « Véhicules » n'est pas un dossier pur : Marc y a rangé lui-même des conversations de
  // propriétaire/plombier (constaté dans le Drive). « À attribuer » étant un DÉPLACEMENT (donc
  // définitif), on interroge la règle PARTAGÉE du flux : si elle sait placer ailleurs, on REFUSE.
  assert.strictEqual(rte('2025-01-01_Assurance habitation_Desjardins.pdf', 'Assurance auto'), null,
    'le flux sait que c\'est de l\'habitation ⇒ refus révisable, jamais avalé');
  assert.strictEqual(rte('2024-03-01_Facture_Hydro-Québec.pdf', 'Entretien & réparations'), null,
    'Énergie & services : le flux sait ⇒ refus');
  // …mais un vrai document de véhicule sans véhicule identifiable est bien pris en charge : les
  // 2 filets FAIBLES du flux (Contrats/Correspondance) attrapent par SOUS-CHAÎNE et ne comptent
  // donc pas comme un savoir — sinon le filet ne capterait plus rien.
  assert.deepStrictEqual(plain(rte('2023-11-13_Soumission d\'assurance automobile_Desjardins Assurances.pdf', 'Assurance auto')),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'À attribuer', sousDossier: 'Assurance auto' });
  assert.deepStrictEqual(plain(rte('2023-10-02_Facture de réparation_Garage Charlesbourg Certi-Pro.jpg', 'Entretien & réparations')),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'À attribuer', sousDossier: 'Entretien & réparations' });
});

test('routeur vehicule : le véhicule NOMMÉ bat le sous-dossier source homonyme d\'un commun (ORDRE)', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const spec = pur.tableMissions_().filter((m) => m.tag === 'vehicule')[0];
  const rte = (nom, sousChemin) =>
    plain(spec.router(nom, { sourceId: IDS.vehiculesPluriel, sousChemin: sousChemin }, {}));
  // Décision 1 : les thèmes vivent SOUS chaque véhicule. Un magasinage qui NOMME un véhicule de
  // Marc va donc sous CE véhicule, pas au commun — c'est pour ça que la reconnaissance du
  // sous-dossier source homonyme (`avecNom`) est évaluée APRÈS `vehiculeDuNom_`.
  // ⚠️ Sans cet ordre, la mutation `communVehiculeDepuisSource_(sousChemin, true)` en tête du
  // routeur passait TOUS les tests (trou prouvé par la revue C28-62).
  assert.deepStrictEqual(rte('2023-06-20_Contrat de vente_VW Jetta.pdf', 'Recherche & achat'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'VW Jetta', sousDossier: 'Recherche & achat' });
  // …et sans véhicule nommé, le même dossier source mène bien au COMMUN.
  assert.deepStrictEqual(rte('2026-07-07_Annonce de vente_Mazda 3.png', 'Recherche & achat'),
    { cibleParentId: IDS.vehiculeCible, cibleNom: 'Recherche & achat', sousDossier: '' });
});

test('MISSIONS_VEHICULE_COMMUNS : identités et jetons — invariants verrouillés', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  // Jetons ALPHABÉTIQUES : `apparierUnique_` retire le préfixe de date, mais `communVehiculeDuNom_`
  // reçoit du texte BRUT côté flux — un jeton numérique matcherait un composant de date.
  JSON.parse(JSON.stringify(pur.CONFIG.MISSIONS_VEHICULE_COMMUNS)).forEach((c) =>
    (c.jetons || []).forEach((j) => assert.match(j, /^[a-z]+$/, 'jeton de commun non alphabétique : ' + j)));
  // Les 2 dossiers KIA parasites sont des SOURCES : une coquille qui les confondrait avec la CIBLE
  // ferait de « Véhicule » sa propre source (redistribution massive de tout son contenu).
  const ids = [IDS.vehiculeKia, IDS.vehiculeKiaJetta, IDS.vehiculeCible, IDS.vehiculesPluriel, IDS.toyotaBzIsole];
  assert.strictEqual(new Set(ids).size, ids.length, 'les IDs source/cible du véhicule sont tous distincts');
  ids.forEach((id) => assert.match(String(id), /^[A-Za-z0-9_-]{20,}$/, 'ID Drive plausible : ' + id));
});

test('routerCarriere_ (ADR-0044) : les 4 familles réelles des 39 de « employeurs & CV »', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const ctx = { employeurParSource: (function () {
    const m = {}; m[IDS.employeursRobovic] = 'Robovic'; m[IDS.employeursAutomatech] = 'Automatech'; return m;
  })(), techniqueId: 'TECH' };
  const rte = (nom, src) => plain(pur.routerCarriere_(nom, { sourceId: src || IDS.carriereRacine, sousChemin: '' }, ctx));

  // D9 — « Relevé_<employeur> » SANS numéro = paie MENSUELLE (cadence 2023-04/05/07/08, 2025-01).
  assert.deepStrictEqual(rte('2023-04_Relevé_Automatech.pdf', IDS.employeursAutomatech),
    { cibleParentId: IDS.revenusPaie, cibleNom: 'Automatech' });
  // …et le prédicat reste ÉTROIT : un RL-1 est ANNUEL (fiscal), un RIB n'est pas un relevé de compte.
  assert.strictEqual(pur.estReleveDePaie_('releve 1'), false, 'RL-1 = feuillet FISCAL, jamais une paie');
  assert.strictEqual(pur.estReleveDePaie_('releve d identite bancaire'), false, 'RIB = coordonnées');
  assert.strictEqual(pur.estReleveDePaie_('releve'), true);

  // D10 — RECRUTEMENT → « Recherche d'emploi », y compris quand l'émetteur est un employeur connu.
  ['2023-01-09_Offre d\'emploi_AutomaTech Robotik Inc..pdf',
    '2022-12-19_Invitation d\'entretien_Automatech Robotik.ics',
    '2023-02-08_Description de rôle_AutomaTech Robotik.docx',
    '2021-05-21_Liste d\'entreprises cibles_Hauts-de-France.xlsx',
    '2026-06-29_Répertoire d\'entreprises industrielles_Nord-Pas-de-Calais.xlsx',
    '2024-07-08_Liste de prospection_Claude Richard.docx',
    '2026-07-06_Formulaire de reclassement_Pôle emploi.png',
    '2026-07-06_Fiche comparative_Comparatif grilles salariales SPVQ et SQ police.jpg',
  ].forEach((n) => assert.deepStrictEqual(rte(n), { cibleId: IDS.rechercheEmploi }, n));

  // D12 — DOCUMENTATION MÉTIER → `_Technique` (résolu par batirCtx, le routeur reste PUR).
  ['2025-08-20_Bon de livraison_SEW-EURODRIVE Co. of Canada Ltd..jpg',
    '2018-11-17_Plaque signalétique_Rockwell Automation.jpg',
    '2026-06-15_Rapport de maintenance_robot convoyeur job 111796.jpg',
    '2020_Support de cours_Romain Debuyser.pdf',
  ].forEach((n) => assert.deepStrictEqual(rte(n), { cibleId: 'TECH' }, n));
  assert.deepStrictEqual(rte('2026-01-28_Rapport de service_Robovic.pdf', IDS.employeursRobovic), { cibleId: 'TECH' });
  // `_Technique` irrésolu ⇒ LÈVE, jamais un refus keyé ni une cible vide. Le throw est traduit en
  // 'transitoire' PAR ITEM par `traiterItemMission_` : borné, aucune clé posée, et les ~33 autres
  // documents de la passe continuent d'être traités. Un `null` aurait figé ces 6 fichiers jusqu'au
  // prochain bump de version pour une panne Drive TRANSITOIRE (revues C28-62 PR2, les 2 passes).
  assert.throws(() => pur.routerCarriere_('2025-08-20_Bon de livraison_SEW.jpg',
    { sourceId: IDS.carriereRacine, sousChemin: '' }, { employeurParSource: {}, techniqueId: '' }),
  /_Technique indisponible/);

  // D11 — employeur OCCASIONNEL → le commun, des DEUX côtés.
  assert.deepStrictEqual(rte('2025-02-12_Attestation employeur_Algopaie.pdf'),
    { cibleParentId: IDS.employeurs05, cibleNom: 'Autres employeurs', sousDossier: 'Attestations & lettres' });
  assert.deepStrictEqual(rte('2026-07-01_Attestation_Silver Crest.jpg'),
    { cibleParentId: IDS.employeurs05, cibleNom: 'Autres employeurs', sousDossier: 'Attestations & lettres' });
  assert.deepStrictEqual(rte('2026-01_Paie_Trajectoire-Emploi.PDF'),
    { cibleParentId: IDS.revenusPaie, cibleNom: 'Autres employeurs' }, 'la PAIE part en 02, quel que soit l\'employeur');

  // §5.2 — les 2 exceptions ASSUMÉES restent REFUSÉES (révisables), et c'est voulu.
  assert.strictEqual(rte('2016-04-16_Évaluation de performance_migration taxonomie 2016.odt'), null,
    'router « évaluation » vers _Technique enverrait une vraie évaluation RH au fourre-tout');
  assert.strictEqual(rte('2026-02-02_Attestation_conformité algorithme calcul de paie.pdf'), null,
    'aucun employeur ⇒ jamais deviné');
});

test('estTypeRecrutement_ : prédicat ÉTROIT — les pièges du Drive de Marc ne matchent PAS', () => {
  const t = (nom) => pur.estTypeRecrutement_(pur.typeDuNomMission_(nom), nom);
  // « entretien » SEUL est une catégorie VÉHICULE : sans « invitation », jamais du recrutement.
  assert.strictEqual(t('2023-10-02_Entretien & réparations_Garage Charlesbourg.pdf'), false);
  assert.strictEqual(pur.estTypeRecrutement_('entretien', 'x'), false);
  // « offre » SEUL ne suffit pas.
  assert.strictEqual(pur.estTypeRecrutement_('offre de service', 'x'), false);
  // « fiche comparative » sans mot de SALAIRE : trop générique pour un déplacement définitif.
  assert.strictEqual(t('2024-01-01_Fiche comparative_Comparatif forfaits Virgin.jpg'), false);
  assert.strictEqual(t('2026-07-06_Fiche comparative_Comparatif grilles salariales SPVQ.jpg'), true);
});

test('TRIPWIRE de convergence : pour chaque cas de routerCarriere_, le FLUX calcule la MÊME cible', () => {
  // C'est LE test qui rend le geste symétrique par CONSTRUCTION plutôt que par relecture.
  // Pourquoi il existe : `ConsolidationExec` recalcule la cible d'un fichier au moment du move,
  // via `cheminCibleReset_`. Si le flux ne sait pas reproduire ce que la mission a décidé, il
  // DÉFAIT le rangement — et sans bruit. La revue structure C28-62 PR2 a prouvé 3 divergences de
  // cette famille (relevé de paie → « Relevés/AAAA » bancaires ; « Autres employeurs » → racine de
  // 05 ; employeur occasionnel en 02 → racine). Un test par cas les aurait toutes attrapées.
  const IDS = pur.CONFIG.MISSIONS_EMPLOYEURS_COMMUN ? pur.CONFIG.MISSIONS_IDS : pur.CONFIG.MISSIONS_IDS;
  const ctx = { employeurParSource: (function () {
    const m = {}; m[IDS.employeursRobovic] = 'Robovic'; m[IDS.employeursAutomatech] = 'Automatech'; return m;
  })(), techniqueId: 'TECH' };
  // [nom, source, domaine où le fichier ATTERRIT, sous-chemin attendu des DEUX côtés]
  const CAS = [
    ['2023-04_Relevé_Automatech.pdf', IDS.employeursAutomatech, '02 · Finances', 'Revenus & paie/Automatech'],
    ['2025-11_Paie_Robovic Inc..pdf', IDS.employeursRobovic, '02 · Finances', 'Revenus & paie/Robovic'],
    ['2026-01_Paie_Trajectoire-Emploi.PDF', IDS.carriereRacine, '02 · Finances', 'Revenus & paie/Autres employeurs'],
    // D9 × D11 : un RELEVÉ d'un employeur OCCASIONNEL. Ce croisement n'était couvert par aucun
    // cas — trouvé par la discipline de mutation elle-même (retirer l'employeur occasionnel du
    // chemin « relevé » du flux ne faisait échouer AUCUN test).
    ['2026-01_Relevé_Trajectoire-Emploi.pdf', IDS.carriereRacine, '02 · Finances', 'Revenus & paie/Autres employeurs'],
    ['2026-07-01_Attestation_Silver Crest.jpg', IDS.carriereRacine, '05 · Carrière', 'Employeurs/Autres employeurs/Attestations & lettres'],
    ['2025-02-12_Attestation employeur_Algopaie.pdf', IDS.carriereRacine, '05 · Carrière', 'Employeurs/Autres employeurs/Attestations & lettres'],
    // Employeur CANONIQUE + sous-dossier par type : divergence PRÉ-EXISTANTE (le flux rendait
    // « Employeurs/Robovic » tout court ⇒ la conso remontait le fichier d'un cran).
    ['2025-06-16_Contrat de travail_Robovic Inc..pdf', IDS.employeursRobovic, '05 · Carrière', 'Employeurs/Robovic/Contrats'],
    ['2026-07-06_Offre d\'emploi_Cégep Garneau.jpg', IDS.carriereRacine, '05 · Carrière', 'Recherche d\'emploi'],
    ['2022-12-19_Invitation d\'entretien_Automatech Robotik.ics', IDS.employeursAutomatech, '05 · Carrière', 'Recherche d\'emploi'],
    ['2021-05-21_Liste d\'entreprises cibles_Hauts-de-France.xlsx', IDS.carriereRacine, '05 · Carrière', 'Recherche d\'emploi'],
    // …y compris avec un TRAIT D'UNION : les 2 consommateurs normalisent différemment en amont,
    // c'est `estTypeRecrutement_` qui normalise, donc le verdict est le même (revue C28-62 PR2).
    ['2021-05-21_Liste d\'entreprises-cibles_Hauts-de-France.xlsx', IDS.carriereRacine, '05 · Carrière', 'Recherche d\'emploi'],
  ];
  CAS.forEach(([nom, src, domaine, attendu]) => {
    const r = plain(pur.routerCarriere_(nom, { sourceId: src, sousChemin: '' }, ctx));
    assert.ok(r, 'la mission doit router : ' + nom);
    // Sous-chemin tel que la MISSION le produit, dans le vocabulaire des chemins du flux.
    const parNom = {};
    parNom[IDS.revenusPaie] = 'Revenus & paie';
    parNom[IDS.employeurs05] = 'Employeurs';
    parNom[IDS.rechercheEmploi] = 'Recherche d\'emploi';
    parNom[IDS.cvLettres] = 'CV & lettres';
    parNom[IDS.employeursRobovic] = 'Employeurs/Robovic';
    parNom[IDS.employeursAutomatech] = 'Employeurs/Automatech';
    const base = r.cibleParentId ? parNom[r.cibleParentId] + '/' + r.cibleNom : parNom[r.cibleId];
    const cheminMission = base + (r.sousDossier ? '/' + r.sousDossier : '');
    assert.strictEqual(cheminMission, attendu, 'MISSION — ' + nom);
    assert.strictEqual(pur.cheminCibleReset_(domaine, nom), attendu, 'FLUX (sinon la conso défait) — ' + nom);
  });

  // EXCEPTION documentée : `_Technique` est HORS domaines. La consolidation ne parcourt que les
  // domaines, donc elle ne verra jamais ces fichiers — aucune divergence possible, et c'est
  // pourquoi le flux n'a pas à savoir router vers `_Technique`.
  const metier = '2025-08-20_Bon de livraison_SEW-EURODRIVE Co. of Canada Ltd..jpg';
  assert.deepStrictEqual(plain(pur.routerCarriere_(metier, { sourceId: IDS.carriereRacine, sousChemin: '' }, ctx)),
    { cibleId: 'TECH' });
  assert.strictEqual(pur.cheminCibleReset_('05 · Carrière', metier), null,
    '_Technique est hors domaines : le flux n\'y route pas, et la conso n\'y passe jamais');
});

test('estReleveDePaie_ : un relevé QUALIFIÉ n\'est PAS une paie (revue code C28-62 PR2)', () => {
  // Le défaut : `typeContient_(['releve'])` matchait le mot entier n'importe où dans le segment.
  // « Relevé d'emploi » (le ROE, remis par TOUT employeur québécois en fin de contrat) partait en
  // `02/Revenus & paie` — alors que Reset.gs porte la décision INVERSE en toutes lettres :
  // « c'est un document de CARRIÈRE (05) ». Le code contredisait son propre commentaire.
  // Déplacement à clé de SUCCÈS ⇒ dans le doute, on REFUSE.
  ['releve d emploi', 'releve de notes', 'releve de compte', 'releve des gains',
    'releve 1', 'releve 31', 'releve d identite bancaire',
  ].forEach((t) => assert.strictEqual(pur.estReleveDePaie_(t), false, 'jamais une paie : ' + t));
  // …mais le cas RÉEL des 7 fichiers (type exactement « Relevé ») reste couvert.
  assert.strictEqual(pur.estReleveDePaie_('releve'), true);
  assert.strictEqual(pur.estReleveDePaie_('releves'), true);
  // Bout en bout : le ROE n'est plus routé, ni par la mission ni par le flux.
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const ctx = { employeurParSource: (function () { const m = {}; m[IDS.employeursAutomatech] = 'Automatech'; return m; })(), techniqueId: 'TECH' };
  const roe = '2023-05_Relevé d\'emploi_Automatech.pdf';
  const r = pur.routerCarriere_(roe, { sourceId: IDS.employeursAutomatech, sousChemin: '' }, ctx);
  assert.ok(!r || r.cibleParentId !== IDS.revenusPaie, 'le ROE ne part pas en 02 : ' + JSON.stringify(plain(r)));
  assert.notStrictEqual(pur.cheminCibleReset_('02 · Finances', roe), 'Revenus & paie/Automatech');
});

test('sousDossierEmployeur_ : normalise LUI-MÊME (2 consommateurs, 2 normalisations amont)', () => {
  // Le flux passe par `normaliserCle_`, qui GARDE les traits d'union ; la mission par
  // `normaliserMission_`, qui les ramène à un espace. Sans normalisation interne, le même
  // document recevait deux sous-dossiers différents ⇒ la consolidation « Déplacerait » ce que la
  // mission vient de ranger. C'est le prédicat VOISIN de celui qu'on venait de mutualiser.
  assert.strictEqual(pur.sousDossierEmployeur_('attestation employeur'), 'Attestations & lettres');
  assert.strictEqual(pur.sousDossierEmployeur_('attestation-employeur'), 'Attestations & lettres');
  assert.strictEqual(pur.sousDossierEmployeur_('contrat-de-travail'), 'Contrats');
  assert.strictEqual(pur.sousDossierEmployeur_('badge'), '');
});

test('ADR-0044 §6 : formulaires GÉNÉRIQUES → « Modèles & formulaires », APRÈS les règles par entité', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  const d03 = c.tableMissions_().filter((m) => m.tag === 'dispatch03')[0];
  const ctx = { themePar: {}, themeVehiculePar: {}, logements: [
    { nom: '3987 rte des Rivières', id: 'l3987', jetons: ['3987', 'rivieres'] },
  ], fenetres: [] };
  const infoC = { sourceId: c.CONFIG.MISSIONS_IDS.contrats03, sousChemin: '' };
  const attendu = { cibleParentId: c.CONFIG.DOMAINES[D], cibleNom: 'Modèles & formulaires', sousDossier: '' };

  // Les 8 fichiers RÉELS de `03 · Contrats` (4 CORPIQ, 2 MA8, 2 Proprio Expert).
  ['2018-10-15_Formulaire de demande de location_CORPIQ.pdf',
    '2018-10-15_Formulaire de demande de location_Immeubles MA8_2.pdf',
    '2026-06-29_Formulaire de consentement communication électronique_Proprio Expert.pdf',
  ].forEach((nom) => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(d03.router(nom, infoC, ctx))), attendu, 'MISSION — ' + nom);
    // TRIPWIRE de convergence : le flux calcule la MÊME cible (sinon la conso défait).
    assert.strictEqual(c.cheminCibleReset_(D, nom), 'Modèles & formulaires', 'FLUX — ' + nom);
  });

  // 🔴 LE SPÉCIFIQUE GAGNE : un formulaire ATTRIBUABLE part chez son entité, jamais dans les
  // modèles. C'est ce qui rend la règle sûre — sinon elle volerait des documents identifiables.
  const attribuable = '2024-05-01_Formulaire de demande de location_9478-5045 Québec inc.pdf';
  assert.strictEqual(c.cheminCibleReset_(D, attribuable), 'Logement/3987 rte des Rivières',
    'le bailleur connu gagne sur le filet « modèles »');
  const rA = d03.router(attribuable, infoC, ctx);
  assert.strictEqual(rA && rA.cibleId, 'l3987', 'idem côté mission');

  // Le prédicat est ancré sur le MOT et normalise lui-même (2 consommateurs, 2 normalisations).
  assert.strictEqual(c.estModeleOuFormulaire_('formulaire de consentement'), true);
  assert.strictEqual(c.estModeleOuFormulaire_('formulaire-de-consentement'), true);
  assert.strictEqual(c.estModeleOuFormulaire_('contrat de bail'), false);
});

test('ADR-0044 §7 : les dossiers-années de 02 sortent vers leur VRAI domaine, cible calculée par LE FLUX', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = JSON.parse(JSON.stringify(c.CONFIG.DOMAINES));
  const ids = {}; Object.keys(D).forEach((k) => { ids[k] = D[k]; });
  ids['07 · Santé'] = 'ID07';  // domaine AUTO : ID en Property, simulé PRÉSENT ici
  const inv = {}; Object.keys(ids).forEach((k) => { inv[ids[k]] = k; });

  // Les 22 fichiers RÉELS des 12 dossiers-années (lus dans le Drive, jamais un échantillon).
  const cas = [
    ['01 · Administratif & identité', '2025-09-04_Contrat d\'adhésion et financement appareil_Virgin Plus.pdf'],
    ['01 · Administratif & identité', '2023-11-01_Accusé de réclamation_Virgin.png'],
    ['01 · Administratif & identité', '2022-12-14_Conditions générales de vente_Cleverbridge GmbH.pdf'],
    ['05 · Carrière', '2026-03-09_Statuts de société civile_PRIGRIS.pdf'],
    ['05 · Carrière', '2026-03-09_Statuts de société civile_Statuts constitutifs SCI famille Richard.pdf'],
    ['05 · Carrière', '2026-06-29_Statuts de constitution_Statuts de constitution société civile familiale MRic.pdf'],
    ['07 · Santé', '2025-11-15_Attestation de versement_Caisse des Français de l\'Étranger.pdf'],
    ['02 · Finances', '2026-01-01_Budget prévisionnel_Budget prévisionnel annuel Marc Anna prorata'],
    ['02 · Finances', '2026-07-06_Suivi de livraison_DoorDash.jpg'],
    ['02 · Finances', '2025-06-01_Avenant aux conditions générales_XTB S.A..pdf'],
    ['02 · Finances', '2026-07-01_Confirmation de virement_Crédit Mutuel.jpg'],
    ['02 · Finances', '2025-12-31_Formulaire T1135 — Bilan de vérification du revenu étranger_Agence du revenu du Canada.pdf'],
  ];
  cas.forEach(([domaineAttendu, nom]) => {
    const r = c.routerFinance02_(nom, '2025', ids);
    assert.ok(r, 'doit être rangé : ' + nom);
    assert.strictEqual(inv[r.cibleId], domaineAttendu, 'domaine de ' + nom);
    // 🔴 LE tripwire : le FLUX, dans le domaine d'arrivée, calcule EXACTEMENT le même sous-chemin.
    // Sans lui, la consolidation recalcule une autre cible et DÉFAIT le rangement (leçon C28-26).
    assert.strictEqual(c.cheminCibleReset_(domaineAttendu, nom), r.sousDossier,
      'convergence flux ↔ mission : ' + nom);
  });

  // Ambigu ⇒ REFUS keyé (révisable), jamais un mouvement inter-domaines deviné.
  assert.strictEqual(c.routerFinance02_('2021-07-21_Note de frais_Roque Rodriguez.ods', '2021', ids), null);

  // 🔴 ÉCHEC FERMÉ : un domaine AUTO dont l'ID est ABSENT (domaine jamais né) ne doit produire
  // AUCUN déplacement — `CONFIG.DOMAINES` ne contient que les 7 domaines FIXES, lire la CONFIG
  // seule rendait `undefined` et aurait planté au `moveTo`.
  const sans07 = {}; Object.keys(D).forEach((k) => { sans07[k] = D[k]; });
  assert.strictEqual(
    c.routerFinance02_('2025-11-15_Attestation de versement_Caisse des Français de l\'Étranger.pdf', '2025', sans07),
    null, 'domaine AUTO sans ID ⇒ refus, jamais un cibleId vide');

  // Le domaine ne se devine pas non plus quand deux règles se contredisent.
  assert.strictEqual(c.domaineHors02DuNom_('2024-01-01_Contrat_Virgin Plus et MRic.pdf'), '');
  // …et le préfixe de date n'est jamais apparié (jetons alphabétiques uniquement).
  (JSON.parse(JSON.stringify(c.CONFIG.MISSIONS_ANNEES02_DOMAINES))).forEach((r) => {
    (r.jetons || []).forEach((j) => assert.match(j, /^[a-z]+$/, 'jeton alphabétique : ' + j));
  });
});

test('ADR-0044 §7 : un sous-chemin MULTI-SEGMENTS crée un dossier PAR segment (jamais un nom à barre oblique)', () => {
  const h = ctxRunner();
  const IDS = h.c.CONFIG.MISSIONS_IDS;
  // Mock qui ENREGISTRE chaque résolution : le mock d'origine concatène parent + '/' + nom, donc
  // un chemin non découpé produirait la MÊME chaîne finale qu'un découpage correct — l'identifiant
  // ne prouve rien, seul le NOMBRE d'appels distingue les deux (la mutation le montre).
  const segments = [];
  const vraiSous = h.c.sousDossier_;
  h.c.sousDossier_ = (parent, nom) => { segments.push(nom); return vraiSous(parent, nom); };

  const annee = (IDS.annees02 || [])[0];
  h.arbre[annee.id] = { files: [h.fichier('fv', '2025-09-04_Contrat d\'adhésion et financement appareil_Virgin Plus.pdf')], folders: {} };
  h.c.executerMission_('annees02', () => false);

  assert.strictEqual(h.moves.length, 1, 'le document sort de son dossier-année');
  assert.deepStrictEqual(segments, ['Contrats & fournisseurs', 'Virgin Plus'],
    'un appel PAR segment — « Contrats & fournisseurs/Virgin Plus » n\'est pas un nom de dossier');
  assert.strictEqual(h.moves[0].vers,
    h.c.CONFIG.DOMAINES['01 · Administratif & identité'] + '/Contrats & fournisseurs/Virgin Plus');
});

test('ADR-0044 §7 : « xtb » est apparié en MOT ENTIER (une banque nommée NXTBank n\'est pas du courtage)', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '02 · Finances';
  assert.strictEqual(c.cheminCibleReset_(D, '2025-06-01_Avenant aux conditions générales_XTB S.A..pdf'),
    'Placements & crypto', 'le vrai courtier est reconnu');
  // Contre-épreuve : en SOUS-CHAÎNE, « nxtbank » contient « xtb » — un relevé bancaire partirait
  // dans les placements, à clé de SUCCÈS, donc définitivement.
  assert.notStrictEqual(c.cheminCibleReset_(D, '2025-06-01_Relevé de compte_NXTBank.pdf'),
    'Placements & crypto', 'un mot CONTENANT xtb ne doit pas matcher');
  assert.strictEqual(c.resetMotEntier_('releve de compte nxtbank', 'xtb'), false);
  assert.strictEqual(c.resetMotEntier_('conditions generales de courtage xtb s a', 'xtb'), true);
});
