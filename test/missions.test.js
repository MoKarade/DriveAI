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

const pur = load(['Config.gs', 'Missions.gs']);

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

test('routeur dispatch03 : véhicule prioritaire, puis adresse, puis date (Correspondance seulement)', () => {
  const IDS = pur.CONFIG.MISSIONS_IDS;
  const spec = pur.tableMissions_().filter((m) => m.tag === 'dispatch03')[0];
  const ctx = {
    vehicules: [{ nom: 'VW Jetta', id: 'vj', jetons: ['jetta', 'volkswagen'] }],
    logements: [{ nom: '783 av. Moreau', id: 'lm', jetons: ['783', 'moreau'] }],
    fenetres: [{ id: 'lm', min: Date.UTC(2023, 0, 1), max: Date.UTC(2023, 11, 31) }],
    themePar: (function () {
      const m = {};
      m[IDS.contrats03] = 'Contrats'; m[IDS.correspondance03] = 'Correspondance';
      m[IDS.assuranceHab03] = 'Assurance habitation'; m[IDS.energieServices03] = 'Énergie & services';
      return m;
    })(),
  };
  // Un contrat qui nomme le véhicule part côté Véhicule/<X>/Contrats.
  const v = spec.router('2024-01-01_Contrat_Jetta.pdf', { sourceId: IDS.contrats03, sousChemin: '' }, ctx);
  assert.strictEqual(v.cibleNom, 'VW Jetta');
  assert.strictEqual(v.sousDossier, 'Contrats');
  // Une facture d'énergie qui nomme l'adresse part vers Logement/<adresse>/Énergie & services.
  const l = spec.router('2023-02-01_Facture_Hydro 783 Moreau.pdf', { sourceId: IDS.energieServices03, sousChemin: '' }, ctx);
  assert.strictEqual(l.cibleId, 'lm');
  assert.strictEqual(l.sousDossier, 'Énergie & services');
  // Correspondance SANS indice : la date tranche (demande Marc) — pas les autres thèmes.
  const parDate = spec.router('2023-05-01_Lettre_Ville.pdf', { sourceId: IDS.correspondance03, sousChemin: '' }, ctx);
  assert.strictEqual(parDate.cibleId, 'lm');
  const pasParDate = spec.router('2023-05-01_Facture_Hydro.pdf', { sourceId: IDS.energieServices03, sousChemin: '' }, ctx);
  assert.strictEqual(pasParDate, null, 'la date ne route QUE la correspondance');
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
  const c = load(['Config.gs', 'Missions.gs']);
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

  // BUMP de version : la clé ancienne ne masque plus le fichier — ré-évalué sous les nouvelles règles.
  h.c.CONFIG.MISSIONS_REGLES_VERSION = 'c49-2';
  assert.ok(!h.c.indexContient_('mission|logement|c49-2|fx'), 'nouvelle version = nouvelle chance');
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
  h.arbre[IDS.logementCible] = { files: [], folders: {} };

  h.c.executerMission_('logement', () => false); // le refus est inscrit
  h.c.executerMission_('logement', () => false); // passe vide → convergence
  assert.strictEqual(h.store['DriveAI_MISSION_FINI_logement'], h.c.CONFIG.MISSIONS_REGLES_VERSION);
  assert.strictEqual(h.peints.length, 0, 'rien de peint : le fichier non apparié est TOUJOURS dedans');
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
