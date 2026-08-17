'use strict';
/**
 * COMPARAISON 1↔2 PASSES (ADR-0034 §5, Vague 3c) — harness `DryRunV2Compare`. PREUVE avant d'allumer
 * la 2ᵉ passe conditionnelle : pour chaque doc, la décision du gate (sauterait la passe 2 ?), la
 * divergence de PLACEMENT 1 passe vs 2 passes, les FAUX NÉGATIFS `sensible` (passe 1 `false` → passe 2
 * `true`), le coût MARGINAL de la passe 2 (le $ économisé par un saut), et un AGRÉGAT de synthèse.
 * Verrouille la LOGIQUE PURE + l'orchestration I/O (2 passes toujours, ZÉRO mutation, convergence,
 * panne plateforme jamais imputée au doc, passe 2 muette jamais comptée « saut sûr »).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, iter } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o));

function ctxPur() {
  return load(['Config.gs', 'DryRunV2.gs']);
}

/* ---------- champsDivergentsV2_ : ce que la passe 2 corrige (PURE) ---------- */

test('champsDivergentsV2_ : passes identiques → aucun champ divergent', () => {
  const ctx = ctxPur();
  const p = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sensible: false };
  assert.deepStrictEqual(plat(ctx.champsDivergentsV2_(p, Object.assign({}, p))), []);
});

test('champsDivergentsV2_ : passe 2 corrige domaine + émetteur → les DEUX listés (jamais le reste)', () => {
  const ctx = ctxPur();
  const p1 = { domaine: '01 · Administratif & identité', type_doc: 'Relevé', emetteur: null, sensible: false };
  const p2 = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sensible: false };
  assert.deepStrictEqual(plat(ctx.champsDivergentsV2_(p1, p2)).sort(), ['domaine', 'emetteur']);
});

test('champsDivergentsV2_ : routageHorsDomaine capté (_Technique → _Médias) — revue code-reviewer', () => {
  const ctx = ctxPur();
  const p1 = { estNonDocument: true, routageHorsDomaine: '_Technique' };
  const p2 = { estNonDocument: true, routageHorsDomaine: '_Médias' };
  assert.deepStrictEqual(plat(ctx.champsDivergentsV2_(p1, p2)), ['routageHorsDomaine']);
});

test('champsDivergentsV2_ : null ≡ chaîne vide (le parser retire déjà les vides) → pas une divergence', () => {
  const ctx = ctxPur();
  const p1 = { domaine: '02 · Finances', descripteur: '' };
  const p2 = { domaine: '02 · Finances' }; // descripteur absent
  assert.deepStrictEqual(plat(ctx.champsDivergentsV2_(p1, p2)), []);
});

/* ---------- fauxNegatifSensibleV2_ : le cas critique §2 (PURE) ---------- */

test('fauxNegatifSensibleV2_ : passe 1 false → passe 2 true = FAUX NÉGATIF (le saut retirerait le filet §2)', () => {
  const ctx = ctxPur();
  assert.strictEqual(ctx.fauxNegatifSensibleV2_({ sensible: false }, { sensible: true }), true);
});

test('fauxNegatifSensibleV2_ : tout autre couple → false (jamais un faux positif d\'alerte)', () => {
  const ctx = ctxPur();
  assert.strictEqual(ctx.fauxNegatifSensibleV2_({ sensible: false }, { sensible: false }), false);
  assert.strictEqual(ctx.fauxNegatifSensibleV2_({ sensible: true }, { sensible: true }), false);
  assert.strictEqual(ctx.fauxNegatifSensibleV2_({ sensible: true }, { sensible: false }), false); // 2→1 n'est PAS le cas dangereux
  assert.strictEqual(ctx.fauxNegatifSensibleV2_(null, { sensible: true }), false);
  assert.strictEqual(ctx.fauxNegatifSensibleV2_({ sensible: false }, null), false);
});

/* ---------- placementCanoniqueV2_ / placementLisibleV2_ (PURE) ---------- */

test('placementCanoniqueV2_ : deux plans au MÊME endroit/nom → même canonique ; un champ change → diffère', () => {
  const ctx = ctxPur();
  const a = { type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' };
  const b = { type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' };
  const c = { type: 'classé', domaine: '02 · Finances', sousDossier: '2025', nom: 'x.pdf' };
  assert.strictEqual(ctx.placementCanoniqueV2_(a), ctx.placementCanoniqueV2_(b));
  assert.notStrictEqual(ctx.placementCanoniqueV2_(a), ctx.placementCanoniqueV2_(c));
  assert.strictEqual(ctx.placementCanoniqueV2_(null), 'ÉCHEC');
  assert.strictEqual(ctx.placementCanoniqueV2_({ type: 'non-doc', routage: '_Technique' }), 'non-doc|_Technique');
  assert.strictEqual(ctx.placementCanoniqueV2_({ type: 'à vérifier' }), 'à vérifier');
});

test('placementLisibleV2_ : rendu domaine ▸ sous-dossier ▸ nom (sous-dossier omis si vide)', () => {
  const ctx = ctxPur();
  assert.strictEqual(
    ctx.placementLisibleV2_({ type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' }),
    '02 · Finances ▸ 2024 ▸ x.pdf');
  assert.strictEqual(
    ctx.placementLisibleV2_({ type: 'classé', domaine: '02 · Finances', sousDossier: '', nom: 'x.pdf' }),
    '02 · Finances ▸ x.pdf');
  assert.strictEqual(ctx.placementLisibleV2_(null), 'échec classification');
});

/* ---------- verdictSautV2_ : priorité au plus sévère, passe 2 muette d'abord (PURE) ---------- */

test('verdictSautV2_ : passe 2 MUETTE prime sur tout → « non concluant » (jamais un faux « saut sûr »)', () => {
  const ctx = ctxPur();
  // p2Echec=true : quels que soient gate/placement/fauxNeg, on ne peut RIEN conclure.
  assert.strictEqual(ctx.verdictSautV2_(true, true, false, true), 'passe 2 muette — non concluant');
  assert.strictEqual(ctx.verdictSautV2_(true, true, true, true), 'passe 2 muette — non concluant');
});

test('verdictSautV2_ : gate NON → « 2 passes (pas de saut) », quel que soit le reste', () => {
  const ctx = ctxPur();
  assert.strictEqual(ctx.verdictSautV2_(false, false, true, false), '2 passes (pas de saut)');
});

test('verdictSautV2_ : faux négatif sensible PRIME sur un placement identique (§2 invisible côté placement)', () => {
  const ctx = ctxPur();
  assert.strictEqual(ctx.verdictSautV2_(true, true, true, false), 'SAUT RISQUÉ — sensible raté (passe 2 : false→true)');
});

test('verdictSautV2_ : placement changé → RISQUÉ ; identique + sensible OK → saut sûr', () => {
  const ctx = ctxPur();
  assert.strictEqual(ctx.verdictSautV2_(true, false, false, false), 'SAUT RISQUÉ — placement changé');
  assert.strictEqual(ctx.verdictSautV2_(true, true, false, false), 'saut sûr');
});

/* ---------- comparerPassesV2_ + ligneComparaisonV2_ (composition PURE) ---------- */

test('comparerPassesV2_ : compose gate + placements + divergence + faux négatif + verdict', () => {
  const ctx = ctxPur();
  const p1 = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sensible: false, confiance: 0.95 };
  const p2 = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sensible: true, confiance: 0.95 };
  const plan1 = { type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' };
  const plan2 = { type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' }; // même place
  const cmp = ctx.comparerPassesV2_(p1, p2, true, plan1, plan2, p2);
  assert.strictEqual(cmp.gateSkip, true);
  assert.strictEqual(cmp.placementIdentique, true);
  assert.deepStrictEqual(plat(cmp.champsDivergents), ['sensible']);
  assert.strictEqual(cmp.fauxNegSensible, true);
  assert.strictEqual(cmp.sensible1, 'false');
  assert.strictEqual(cmp.sensible2, 'true');
  // placement identique MAIS sensible raté ⇒ verdict RISQUÉ (le saut aurait perdu la sensibilité).
  assert.strictEqual(cmp.verdict, 'SAUT RISQUÉ — sensible raté (passe 2 : false→true)');
  assert.strictEqual(cmp.confiance1, 0.95);
});

test('comparerPassesV2_ : passe 2 MUETTE (p2=null) → non concluant, jamais « saut sûr » ni faux réconfort', () => {
  const ctx = ctxPur();
  const p1 = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', sensible: false, confiance: 0.95 };
  const plan1 = { type: 'classé', domaine: '02 · Finances', sousDossier: '2024', nom: 'x.pdf' };
  // final = p1 (repli), p2 brut = null.
  const cmp = ctx.comparerPassesV2_(p1, p1, true, plan1, plan1, null);
  assert.strictEqual(cmp.placementIdentique, false, 'jamais « identique » quand on n\'a pas pu comparer');
  assert.strictEqual(cmp.placement2, 'passe 2 muette (non concluant)');
  assert.strictEqual(cmp.sensible2, '—');
  assert.strictEqual(cmp.fauxNegSensible, false);
  assert.strictEqual(cmp.verdict, 'passe 2 muette — non concluant');
});

test('ligneComparaisonV2_ : document comparé → 17 colonnes ; coûts passe 1 / passe 2 SÉPARÉS', () => {
  const ctx = ctxPur();
  const cmp = {
    gateSkip: true, placement1: '02 · Finances ▸ x.pdf', placement2: '02 · Finances ▸ x.pdf',
    placementIdentique: true, champsDivergents: ['sensible'], sensible1: 'false', sensible2: 'true',
    fauxNegSensible: true, verdict: 'SAUT RISQUÉ — sensible raté (passe 2 : false→true)', confiance1: 0.95,
  };
  const l = ctx.ligneComparaisonV2_({ id: 'F1', nom: 'vieux.pdf', domaineActuel: '02 · Finances', cheminActuel: '02 · Finances' }, cmp, 0.041, 0.021);
  assert.strictEqual(l.length, 17);
  assert.strictEqual(l[1], 'F1');
  assert.strictEqual(l[5], 'oui');                 // gate : sauterait la passe 2
  assert.strictEqual(l[8], 'oui');                 // placement identique
  assert.strictEqual(l[9], 'sensible');            // champs corrigés par passe 2
  assert.strictEqual(l[12], 'OUI');                // faux négatif sensible (majuscules = alerte)
  assert.strictEqual(l[13], cmp.verdict);
  assert.strictEqual(l[14], 0.95);                 // confiance 1p
  assert.strictEqual(l[15], 0.041);                // coût passe 1
  assert.strictEqual(l[16], 0.021);                // coût passe 2 (le $ marginal qu'un saut économise)
});

test('ligneComparaisonV2_ : cmp null (échec LLM) → ligne « échec » 17 colonnes, jamais un plantage', () => {
  const ctx = ctxPur();
  const l = ctx.ligneComparaisonV2_({ id: 'F2', nom: 'panne.pdf', domaineActuel: '02 · Finances', cheminActuel: '' }, null, 0, 0);
  assert.strictEqual(l.length, 17);
  assert.strictEqual(l[6], 'échec classification');
  assert.strictEqual(l[13], 'échec classification');
});

/* ---------- synthetiserComparaisonV2_ + messageSyntheseComparaisonV2_ : l'AGRÉGAT (PURE) ---------- */

function ligneSynth(gate, verdict, fn, c1, c2) {
  // Réplique l'ordre de `ligneComparaisonV2_` (17 colonnes) : Gate=5, FN=12, Verdict=13, C1=15, C2=16.
  return ['ts', 'id', 'nom', 'dom', 'chemin', gate, 'p1', 'p2', 'ident', 'champs', 's1', 's2', fn, verdict, 0.9, c1, c2];
}

test('synthetiserComparaisonV2_ : bons dénominateurs (risqué / SAUTÉS) + gain MESURÉ, échec/non-concluant exclus', () => {
  const ctx = ctxPur();
  const valeurs = [
    ['en-tête'],
    ligneSynth('oui', 'saut sûr', 'non', 0.03, 0.03),                                 // A : sauté sûr
    ligneSynth('oui', 'SAUT RISQUÉ — placement changé', 'non', 0.03, 0.03),           // B : sauté risqué
    ligneSynth('oui', 'SAUT RISQUÉ — sensible raté (passe 2 : false→true)', 'OUI', 0.03, 0.03), // C : sauté risqué + FN
    ligneSynth('non', '2 passes (pas de saut)', 'non', 0.03, 0.03),                   // D : classé, pas sauté
    ligneSynth('non', 'passe 2 muette — non concluant', 'non', 0.03, 0.03),           // E : non concluant
    ligneSynth('', 'échec classification', '', 0, 0),                                 // F : échec
  ];
  const s = ctx.synthetiserComparaisonV2_(valeurs);
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.classes, 4);              // A,B,C,D (E et F exclus)
  assert.strictEqual(s.skips, 3);                // A,B,C
  assert.strictEqual(s.risquesParmiSkips, 2);    // B,C — dénominateur = SAUTÉS, jamais total
  assert.strictEqual(s.fauxNegParmiSkips, 1);    // C
  assert.strictEqual(s.nonConcluant, 1);         // E
  assert.strictEqual(s.echecs, 1);               // F
  // Gain MESURÉ = Σ coût passe 2 des SAUTÉS (0.03×3=0.09) / Σ coût total (0.06×5=0.30) = 30 %.
  assert.strictEqual(s.gainPct, 30);
});

test('messageSyntheseComparaisonV2_ : phrase lisible avec les taux et le gain mesuré', () => {
  const ctx = ctxPur();
  const msg = ctx.messageSyntheseComparaisonV2_({
    classes: 4, skips: 3, risquesParmiSkips: 2, fauxNegParmiSkips: 1, nonConcluant: 1, echecs: 1, gainPct: 30,
  });
  assert.ok(msg.includes('4 classés'));
  assert.ok(msg.includes('3 sautés'));
  assert.ok(msg.includes('2 RISQUÉS'));
  assert.ok(msg.includes('1 faux négatif'));
  assert.ok(msg.includes('30 %'));
});

/* ---------- classifierComparaisonV2_ : TOUJOURS 2 passes + coûts inter-passes + gate (I/O mockée) ---------- */

function ctxLlm() {
  const ctx = load(['Config.gs', 'Router.gs', 'Llm.gs', 'DryRunV2.gs'],
    { tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n) });
  // usageRunSnapshot_/coutDollarsDelta_ vivent dans Cout.gs (non chargé ici) : mockés. Le delta rend
  // 0,04 (passe 1) puis 0,02 (passe 2) pour PROUVER que les deux coûts sont mesurés SÉPARÉMENT.
  ctx.usageRunSnapshot_ = () => ({});
  let dc = 0;
  ctx.coutDollarsDelta_ = () => { dc++; return dc === 1 ? 0.04 : 0.02; };
  return ctx;
}
const P1_SURE = { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', confiance: 0.95, sensible: false };
const P2_CORRIGE = { domaine: '04 · Immigration', type_doc: 'Avis', emetteur: 'IRCC', confiance: 0.95, sensible: true };

test('classifierComparaisonV2_ : 2 passes TOUJOURS ; expose p1/p2 brut/final/gateSkip + coûts séparés', () => {
  const ctx = ctxLlm();
  const appels = [];
  ctx.appelAnthropicV2_ = (m, meta, sys, prop) => { appels.push(prop); return appels.length === 1 ? P1_SURE : P2_CORRIGE; };
  const r = ctx.classifierComparaisonV2_({ nomFichier: 'x.pdf' });
  assert.strictEqual(appels.length, 2, 'deux passes TOUJOURS, même si la passe 1 est sûre (contraire du gate prod)');
  assert.strictEqual(appels[0], null, '1re passe sans proposition');
  assert.strictEqual(appels[1], P1_SURE, '2e passe reçoit la proposition de la passe 1');
  assert.strictEqual(r.p1, P1_SURE);
  assert.strictEqual(r.p2, P2_CORRIGE, 'la sortie BRUTE de la passe 2 est exposée (distingue « d\'accord » de « muette »)');
  assert.strictEqual(r.final, P2_CORRIGE);
  assert.strictEqual(r.gateSkip, true, 'le gate AURAIT sauté la passe 2 (passe 1 sûre) — c\'est ce qu\'on mesure');
  assert.strictEqual(r.coutP1, 0.04);
  assert.strictEqual(r.coutP2, 0.02, 'coût MARGINAL de la passe 2 mesuré à part (le $ qu\'un saut économise)');
});

test('classifierComparaisonV2_ : passe 1 muette → null (compté), une seule passe tentée', () => {
  const ctx = ctxLlm();
  let appels = 0;
  ctx.appelAnthropicV2_ = () => { appels++; return null; };
  assert.strictEqual(ctx.classifierComparaisonV2_({ nomFichier: 'x.pdf' }), null);
  assert.strictEqual(appels, 1);
});

test('classifierComparaisonV2_ : passe 2 muette → p2 null, final = passe 1 (anti-régression, jamais de perte)', () => {
  const ctx = ctxLlm();
  let appels = 0;
  ctx.appelAnthropicV2_ = () => { appels++; return appels === 1 ? P1_SURE : null; };
  const r = ctx.classifierComparaisonV2_({ nomFichier: 'x.pdf' });
  assert.strictEqual(r.p2, null, 'passe 2 muette → p2 brut null (le rapport marquera « non concluant »)');
  assert.strictEqual(r.final, P1_SURE);
  assert.strictEqual(r.gateSkip, true);
});

/* ---------- traiterUnComparaisonV2_ : rapport, clé dédiée, ZÉRO mutation, panne = jamais imputée ---------- */

function ctxTraiter(opts) {
  opts = opts || {};
  const calls = { rows: [], index: [], journaux: [] };
  const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs', 'Router.gs', 'Llm.gs', 'DryRunV2.gs'],
    { tronquer_: (s, n) => String(s == null ? '' : s).slice(0, n) });
  ctx.journalInfo_ = (s, m) => calls.journaux.push(m);
  ctx.journalErreur_ = (s, m) => calls.journaux.push('ERR:' + m);
  ctx.indexAjouter_ = (cle, res, emp) => calls.index.push({ cle, res, emp });
  ctx.feuille_ = (nom) => ({ appendRow: (ligne) => calls.rows.push({ nom, ligne }) });
  ctx.extraireTexte_ = () => 'texte extrait '.repeat(10);
  ctx.entitesValideesParCle_ = () => ({});
  if (opts.panne) ctx.estPannePlateforme_ = () => true; // sinon défaut Llm.gs = false
  ctx.classifierComparaisonV2_ = opts.resultat !== undefined ? () => opts.resultat
    : () => ({ p1: P1_SURE, p2: P2_CORRIGE, final: P2_CORRIGE, gateSkip: true, coutP1: 0.04, coutP2: 0.02 });
  // Plans déterministes (isole traiterUnComparaisonV2_ du détail de planRoutageV2_) : passe 1 range
  // en 02, passe 2 en 04 → placement DIFFÉRENT (le saut aurait mal placé). Lit l'ARGUMENT reçu.
  ctx.planPourClassifV2_ = (classif) => ({ type: 'classé', domaine: classif.domaine, sousDossier: '', nom: 'nom.pdf' });
  ['deciderRoutageV2_', 'sousDossier_', 'renommer_', 'deplacerEtRenommer_', 'garantirNomUnique_', 'creerRaccourci_'].forEach((fn) => {
    ctx[fn] = () => { throw new Error(fn + ' ne doit JAMAIS être appelée par la comparaison'); };
  });
  ctx.DriveApp = {
    getFileById: (id) => ({
      getName: () => opts.nom || 'doc.pdf',
      getSize: () => 1000,
      getLastUpdated: () => new Date('2026-07-01T00:00:00Z'),
      getBlob: () => (opts.blobKo ? (() => { throw new Error('blob illisible'); })() : {}),
      getParents: () => iter([{ getName: () => 'sous-dossier' }]),
      getMimeType: () => 'application/pdf',
    }),
  };
  return { ctx, calls };
}

test('traiterUnComparaisonV2_ : document comparé → 1 ligne DryRunV2Compare, clé « dryruncmp| », ZÉRO mutation', () => {
  const { ctx, calls } = ctxTraiter();
  const r = ctx.traiterUnComparaisonV2_('F1', '02 · Finances', 'c1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.rows.length, 1);
  assert.strictEqual(calls.rows[0].nom, 'DryRunV2Compare');
  assert.strictEqual(calls.rows[0].ligne[5], 'oui');             // gate sauterait la passe 2
  assert.strictEqual(calls.rows[0].ligne[8], 'non');             // placement DIFFÉRENT (02 vs 04)
  assert.strictEqual(calls.rows[0].ligne[12], 'OUI');            // faux négatif sensible (false→true)
  assert.strictEqual(calls.rows[0].ligne[15], 0.04);            // coût passe 1
  assert.strictEqual(calls.rows[0].ligne[16], 0.02);            // coût passe 2 (marginal)
  assert.strictEqual(calls.index.length, 1);
  assert.strictEqual(calls.index[0].cle, 'dryruncmp|c1|F1');     // clé DÉDIÉE, jamais celle du dry-run/prod
});

test('traiterUnComparaisonV2_ : PANNE plateforme → RIEN écrit, RIEN marqué (jamais imputée au doc, §7)', () => {
  const { ctx, calls } = ctxTraiter({ panne: true });
  const r = ctx.traiterUnComparaisonV2_('F1', '02 · Finances', 'c1');
  assert.strictEqual(r, false, 'signale à l\'appelant de s\'arrêter (break)');
  assert.strictEqual(calls.rows.length, 0, 'aucune ligne « échec » figée dans le rapport');
  assert.strictEqual(calls.index.length, 0, 'aucune clé posée → re-comparé après rétablissement');
});

test('traiterUnComparaisonV2_ : échec LLM (résultat null, hors panne) → ligne « échec », marqué (convergence)', () => {
  const { ctx, calls } = ctxTraiter({ resultat: null });
  const r = ctx.traiterUnComparaisonV2_('F2', '02 · Finances', 'c1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.rows[0].ligne[6], 'échec classification');
  assert.strictEqual(calls.index.length, 1);
});

test('traiterUnComparaisonV2_ : fichier illisible → jamais fatal, marqué ET une ligne (jamais un no-op silencieux)', () => {
  const { ctx, calls } = ctxTraiter();
  ctx.DriveApp = { getFileById: () => { throw new Error('introuvable'); } };
  const r = ctx.traiterUnComparaisonV2_('KO', '02 · Finances', 'c1');
  assert.strictEqual(r, true);
  assert.strictEqual(calls.index[0].cle, 'dryruncmp|c1|KO');
  assert.strictEqual(calls.rows.length, 1);
  assert.strictEqual(calls.rows[0].nom, 'DryRunV2Compare');
  assert.strictEqual(calls.rows[0].ligne[6], 'échec classification');
});

/* ---------- appliquerComparaisonV2_ : flag, bornage, convergence (clé DÉDIÉE), stop sur panne ---------- */

test('appliquerComparaisonV2_ : interrupteur éteint → no-op total (jamais un appel Drive)', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.CONFIG.DRYRUN_CMP_ACTIF = false;
  ctx.chargerOuGenererEchantillonDryRunV2_ = () => { throw new Error('ne doit jamais être appelé (flag OFF)'); };
  assert.doesNotThrow(() => ctx.appliquerComparaisonV2_(() => false));
});

test('appliquerComparaisonV2_ : borné par tick, reprenable, convergence via DriveAI_DRYRUNCMP (jamais DriveAI_DRYRUNV2)', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.CONFIG.DRYRUN_CMP_ACTIF = true;
  ctx.CONFIG.DRYRUN_CMP_MAX_PAR_RUN = 2;
  const store = {};
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
    }),
  };
  const echantillon = [
    { domaine: 'A', id: 'x1' }, { domaine: 'A', id: 'x2' }, { domaine: 'B', id: 'x3' },
  ];
  ctx.chargerOuGenererEchantillonDryRunV2_ = () => echantillon;
  const traites = [];
  const fait = new Set();
  ctx.indexContient_ = (cle) => fait.has(cle);
  ctx.estPannePlateforme_ = () => false;
  ctx.traiterUnComparaisonV2_ = (id, dom, tag) => { traites.push(id); fait.add('dryruncmp|' + tag + '|' + id); return true; };
  ctx.journalInfo_ = () => {};
  // Synthèse au convergence : lit la feuille → mockée pour ne pas dépendre de getSheetEtat_.
  ctx.feuille_ = () => ({ getDataRange: () => ({ getValues: () => [['en-tête']] }) });

  ctx.appliquerComparaisonV2_(() => false); // tick 1 : plafonné à 2
  assert.deepStrictEqual(traites, ['x1', 'x2']);
  assert.strictEqual(store.DriveAI_DRYRUNCMP, undefined); // pas encore fini

  ctx.appliquerComparaisonV2_(() => false); // tick 2 : reprend
  assert.deepStrictEqual(traites, ['x1', 'x2', 'x3']);
  assert.strictEqual(store.DriveAI_DRYRUNCMP, ctx.CONFIG.DRYRUN_CMP_TAG); // converge (clé dédiée)
  assert.strictEqual(store.DriveAI_DRYRUNV2, undefined, 'jamais la clé du dry-run (campagne distincte)');

  ctx.appliquerComparaisonV2_(() => false); // tick 3 : finie → no-op
  assert.deepStrictEqual(traites, ['x1', 'x2', 'x3']);
});

test('appliquerComparaisonV2_ : PANNE en cours de tick → break (les docs restants re-comparés plus tard)', () => {
  const ctx = load(['Config.gs', 'DryRunV2.gs']);
  ctx.CONFIG.DRYRUN_CMP_ACTIF = true;
  ctx.CONFIG.DRYRUN_CMP_MAX_PAR_RUN = 10;
  const store = {};
  ctx.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = String(v); },
  }) };
  ctx.chargerOuGenererEchantillonDryRunV2_ = () => [
    { domaine: 'A', id: 'x1' }, { domaine: 'A', id: 'x2' }, { domaine: 'A', id: 'x3' },
  ];
  ctx.indexContient_ = () => false;
  ctx.journalInfo_ = () => {};
  let panne = false;
  ctx.estPannePlateforme_ = () => panne;
  const traites = [];
  // x2 déclenche la panne (comme si son appel LLM avait posé la panne), traiterUn renvoie false.
  ctx.traiterUnComparaisonV2_ = (id) => {
    traites.push(id);
    if (id === 'x2') { panne = true; return false; }
    return true;
  };
  ctx.appliquerComparaisonV2_(() => false);
  assert.deepStrictEqual(traites, ['x1', 'x2'], 'break dès la panne — x3 n\'est pas tenté ce tick');
  assert.strictEqual(store.DriveAI_DRYRUNCMP, undefined, 'jamais « terminé » sur une panne (reprise)');
});

/* ---------- Onglet dédié déclaré dans initialiserSheet_ (coûts séparés) ---------- */

test('initialiserSheet_ : l\'onglet DryRunV2Compare déclare les colonnes clés (§2 + coûts séparés)', () => {
  const chemin = path.join(__dirname, '..', 'src', 'Journal.gs');
  const contenu = fs.readFileSync(chemin, 'utf-8');
  assert.ok(contenu.includes("creerOnglet_(ss, 'DryRunV2Compare'"), 'onglet DryRunV2Compare déclaré');
  assert.ok(contenu.includes('Faux négatif sensible'), 'colonne du cas critique §2 présente');
  assert.ok(contenu.includes('Verdict du saut'), 'colonne verdict présente');
  assert.ok(contenu.includes('Coût passe 1 $') && contenu.includes('Coût passe 2 $'), 'coûts par passe séparés (gain mesurable)');
});
