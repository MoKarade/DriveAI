'use strict';
/**
 * RESET C28-33 — PR5 (ADR-0030, amendement 2026-07-31) : passe LLM du RELIQUAT non-routable.
 * Verrouille les décisions de l'amendement : prédicat de collecte (la table d'abord, le LLM en
 * dernier recours), les 3 verrous du re-traitement (clé versionnée, ignorerDoublon, placement
 * direct), les gardes de mutation (§1 re-vérifiée, multi-parents), le frein campagnes par item,
 * le budget QUOTIDIEN en ms réelles (anti-gel C28-29, revue flotte C28-42), et le drapeau
 * terminal ALIGNÉ sur le placement (jamais posé tant qu'il peut encore alimenter).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const FICHIERS = ['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs'];

function fakeFichierLlm(opts) {
  opts = opts || {};
  return {
    getId: () => opts.id || 'F1',
    getName: () => opts.nom || 'scan_Inconnu.pdf',
    getSize: () => (opts.taille !== undefined ? opts.taille : 100),
    getBlob: () => ({ id: opts.id || 'F1' }),
    getLastUpdated: () => new Date('2026-07-01T12:00:00'),
    getParents: () => {
      const arr = opts.parents || [{ getId: () => 'RACINE-TRI-DOM' }];
      let i = 0;
      return { hasNext: () => i < arr.length, next: () => arr[i++] };
    },
  };
}

/** Contexte : `_TRI 2026` mocké avec un fichier par domaine fourni ; pipeline capturé. */
function ctxLlm(opts) {
  opts = opts || {};
  const c = load(FICHIERS);
  c.CONFIG.RESET_ACTIF = true; // FORCÉ (défaut retiré à false 2026-08-05, ADR-0035)
  const index = Object.assign({}, opts.index);
  const ajouts = [];
  const pipeline = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, dec, emp) => { index[cle] = true; ajouts.push({ cle: cle, statut: dec.statut }); };
  c.journalInfo_ = () => {};
  c.journalErreur_ = () => {};
  c.aParentProtege_ = () => !!opts.protege;
  c.nbParentsBorne_ = () => (opts.multiParents ? 2 : 1);
  c.gererEchec_ = (src, msg) => ajouts.push({ cle: src.cle, statut: 'echec', msg: msg });
  c.traiterDocument_ = (src) => { pipeline.push(src); index[src.cle] = true; };
  c.ensembleDomainesProteges_ = () => ({});
  c.estPannePlateforme_ = () => !!opts.panneApi;
  c.budgetCampagnesAtteint_ = () => !!opts.frein;
  c.dateGmail_ = () => '2026/07/31'; // vit dans Gmail.gs (non chargé) — jour fixe pour le budget quotidien
  // `_TRI 2026` : seuls les domaines listés existent, chacun avec ses fichiers.
  const parDomaine = opts.parDomaine || {};
  c.dossierTriReset_ = () => ({
    getFoldersByName: (dom) => {
      const fichiers = parDomaine[dom];
      let servi = false;
      return {
        hasNext: () => !servi && fichiers !== undefined,
        next: () => {
          servi = true;
          let i = 0;
          return { getFiles: () => ({ hasNext: () => i < fichiers.length, next: () => fichiers[i++] }) };
        },
      };
    },
  });
  const props = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  return { c, index, ajouts, pipeline, props };
}

/* ---------- Prédicat de collecte : la TABLE d'abord, le LLM en dernier recours ---------- */

test('analyserPageReliquatReset_ : un fichier ROUTABLE par la table n\'est JAMAIS envoyé au LLM (le placement est moins cher)', () => {
  const routable = fakeFichierLlm({ id: 'FR', nom: '2026-03_Relevé_Desjardins.pdf' });
  const inconnu = fakeFichierLlm({ id: 'FI', nom: '2023-05-10_Document_Inconnu.pdf' });
  const { c, pipeline } = ctxLlm({ parDomaine: { '02 · Finances': [routable, inconnu] } });
  assert.ok(c.cheminCibleReset_('02 · Finances', routable.getName()), 'pré-condition : la table route bien le relevé');
  assert.strictEqual(c.cheminCibleReset_('02 · Finances', inconnu.getName()), null, 'pré-condition : la table ne route pas l\'Inconnu');
  const r = c.analyserPageReliquatReset_(() => false, {});
  assert.strictEqual(pipeline.length, 1, 'seul le non-routable passe au pipeline');
  assert.strictEqual(pipeline[0].nom, '2023-05-10_Document_Inconnu.pdf');
  assert.strictEqual(r.examines, 1);
});

test('analyserPageReliquatReset_ : clé VERSIONNÉE tri33llm|tag|version|id — déjà tentée ⇒ gratuite, n\'occupe pas la page', () => {
  const c0 = load(FICHIERS);
  const cle = 'tri33llm|' + c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION + '|FI';
  const inconnu = fakeFichierLlm({ id: 'FI' });
  const { c, pipeline } = ctxLlm({
    parDomaine: { '02 · Finances': [inconnu] },
    index: (() => { const o = {}; o[cle] = true; return o; })(),
  });
  const r = c.analyserPageReliquatReset_(() => false, {});
  assert.strictEqual(pipeline.length, 0);
  assert.strictEqual(r.examines, 0, 'déjà tenté → hors page');
  assert.strictEqual(r.complet, true);
});

test('analyserPageReliquatReset_ : plafond RESET_LLM_MAX_PAR_RUN dérivé de la CONSTANTE — le surplus attend le tick suivant', () => {
  const c0 = load(FICHIERS);
  const MAX = c0.CONFIG.RESET_LLM_MAX_PAR_RUN;
  const fichiers = [];
  for (let i = 0; i < MAX + 2; i++) fichiers.push(fakeFichierLlm({ id: 'F' + i }));
  const { c, pipeline } = ctxLlm({ parDomaine: { '02 · Finances': fichiers } });
  const r = c.analyserPageReliquatReset_(() => false, {});
  assert.strictEqual(pipeline.length, MAX);
  assert.strictEqual(r.complet, false, 'page coupée au plafond → jamais « terminé » sur ce run');
});

/* ---------- Les 3 verrous du re-traitement (leçon §7) ---------- */

test('analyserFichierReliquat_ : ignorerDoublon:true + placement DIRECT (jamais de transit par À trier)', () => {
  const { c, pipeline } = ctxLlm({});
  const deplacements = [];
  c.deplacerEtRenommer_ = (id, cible, ancien, nom) => { deplacements.push([id, cible, ancien, nom]); return true; };
  const f = fakeFichierLlm({ id: 'FI', parents: [{ getId: () => 'TRI-02' }] });
  c.analyserFichierReliquat_(f, '02 · Finances', f.getName(), 'cleX', {});
  assert.strictEqual(pipeline.length, 1);
  const src = pipeline[0];
  assert.strictEqual(src.ignorerDoublon, true,
    'OBLIGATOIRE : le placement a écrit l\'empreinte à l\'Index — sans bypass, « doublon de lui-même » → _Doublons');
  assert.strictEqual(src.cle, 'cleX');
  // Le `placer` fourni déplace DIRECTEMENT depuis `_TRI` vers la cible du pipeline.
  src.placer('DOSSIER-CIBLE', '2023-05-10_Facture_Hydro.pdf');
  assert.deepStrictEqual(deplacements, [['FI', 'DOSSIER-CIBLE', 'TRI-02', '2023-05-10_Facture_Hydro.pdf']]);
});

test('analyserFichierReliquat_ : zone protégée re-vérifiée ICI (§1) et multi-parents → skip AVEC clé, ZÉRO pipeline', () => {
  const protege = ctxLlm({ protege: true });
  assert.strictEqual(protege.c.analyserFichierReliquat_(fakeFichierLlm({}), '02 · Finances', 'scan.pdf', 'cleP', {}), false);
  assert.strictEqual(protege.pipeline.length, 0);
  assert.strictEqual(protege.ajouts[0].statut, 'tri33llm-protege');

  const multi = ctxLlm({ multiParents: true });
  assert.strictEqual(multi.c.analyserFichierReliquat_(fakeFichierLlm({}), '02 · Finances', 'scan.pdf', 'cleM', {}), false);
  assert.strictEqual(multi.pipeline.length, 0);
  assert.strictEqual(multi.ajouts[0].statut, 'tri33llm-multiparents');
});

/* ---------- Étape de tick : gates + drapeau terminal ---------- */

test('analyserReliquatReset_ : frein campagnes §2.6 et panne plateforme (R2) suspendent la passe — AUCUN doc touché', () => {
  const inconnu = fakeFichierLlm({ id: 'FI' });
  const frein = ctxLlm({ parDomaine: { '02 · Finances': [inconnu] }, frein: true });
  frein.c.analyserReliquatReset_(() => false);
  assert.strictEqual(frein.pipeline.length, 0, 'frein budget → rien');

  const panne = ctxLlm({ parDomaine: { '02 · Finances': [inconnu] }, panneApi: true });
  panne.c.analyserReliquatReset_(() => false);
  assert.strictEqual(panne.pipeline.length, 0, 'panne de compte API → rien (classer les échecs par ORIGINE)');
});

test('analyserReliquatReset_ : drapeau terminal posé sur passe VIDE seulement si le PLACEMENT est terminé (il peut encore alimenter)', () => {
  const c0 = load(FICHIERS);
  const finPlacement = c0.CONFIG.RESET_TAG + '|' + c0.CONFIG.RESET_TABLE_VERSION;

  // Passe vide mais placement PAS fini → pas de drapeau (le rassemblement/placement alimentent encore).
  const tot = ctxLlm({ parDomaine: {} });
  tot.c.analyserReliquatReset_(() => false);
  assert.strictEqual(tot.props.DriveAI_RESET_LLM, undefined, 'jamais figé « fini » tant que la file peut se remplir');

  // Passe vide ET placement fini → drapeau versionné posé ; le tick suivant ne coûte qu'1 Property.
  const fini = ctxLlm({ parDomaine: {}, props: { DriveAI_RESET_PLACEMENT: finPlacement } });
  fini.c.analyserReliquatReset_(() => false);
  assert.strictEqual(fini.props.DriveAI_RESET_LLM, finPlacement, 'drapeau ALIGNÉ sur la chaîne versionnée du placement');
  fini.c.dossierTriReset_ = () => { throw new Error('ne doit plus être appelé'); };
  fini.c.analyserReliquatReset_(() => false); // re-run : court-circuit total
});

test('analyserReliquatReset_ : budget QUOTIDIEN en ms réelles — épuisé ⇒ AUCUN doc du jour, et la consommation est PERSISTÉE', () => {
  const c0 = load(FICHIERS);
  const MAX_JOUR = c0.CONFIG.RESET_LLM_BUDGET_JOUR_MS;
  const inconnu = fakeFichierLlm({ id: 'FI' });

  // Budget du jour épuisé (dérivé de la CONSTANTE, jamais de sa valeur du jour) → passe suspendue,
  // reprise demain — c'est LA borne anti-gel C28-29 (un plafond par run ne borne pas la journée).
  const epuise = ctxLlm({
    parDomaine: { '02 · Finances': [inconnu] },
    props: { DriveAI_RESET_LLM_JOUR: '2026/07/31|' + MAX_JOUR },
  });
  epuise.c.analyserReliquatReset_(() => false);
  assert.strictEqual(epuise.pipeline.length, 0, 'budget quotidien épuisé → rien, repris demain');

  // Passe qui tourne → ms réelles AJOUTÉES à la Property du jour (patron des 3 autres phases).
  const actif = ctxLlm({ parDomaine: { '02 · Finances': [inconnu] } });
  actif.c.analyserReliquatReset_(() => false);
  assert.strictEqual(actif.pipeline.length, 1);
  const brut = String(actif.props.DriveAI_RESET_LLM_JOUR || '');
  assert.ok(brut.indexOf('2026/07/31|') === 0, 'consommation persistée sous le jour courant : ' + brut);

  // Un budget d'HIER ne bloque pas aujourd'hui (la fenêtre est quotidienne, pas cumulative).
  const hier = ctxLlm({
    parDomaine: { '02 · Finances': [fakeFichierLlm({ id: 'FI' })] },
    props: { DriveAI_RESET_LLM_JOUR: '2026/07/30|' + MAX_JOUR },
  });
  hier.c.analyserReliquatReset_(() => false);
  assert.strictEqual(hier.pipeline.length, 1, 'le compteur d\'hier est remis à zéro aujourd\'hui');
});

test('analyserReliquatReset_ : un bump de RESET_TABLE_VERSION RÉ-OUVRE la passe (drapeau d\'une vieille version ≠ courant)', () => {
  const c0 = load(FICHIERS);
  const vieille = c0.CONFIG.RESET_TAG + '|version-precedente';
  const inconnu = fakeFichierLlm({ id: 'FI' });
  const { c, pipeline } = ctxLlm({
    parDomaine: { '02 · Finances': [inconnu] },
    props: { DriveAI_RESET_LLM: vieille },
  });
  c.analyserReliquatReset_(() => false);
  assert.strictEqual(pipeline.length, 1, 'le drapeau périmé ne bloque pas la nouvelle version de table');
});
