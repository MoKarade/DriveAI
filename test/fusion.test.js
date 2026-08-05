'use strict';
/**
 * FUSION des dossiers d'entité en double (#47, ADR-0036) — PR1 dry-run. Verrouille la LOGIQUE PURE :
 * clustering (union-find sur clé canonique / jetons / acronyme), choix de cible, lignes du plan, et le
 * VERROU de surface « ZÉRO mutation dans Fusion.gs » (l'exécution est PR2, gardée). Les faux positifs
 * du RADAR (ex. IUT Lyon ≈ IUT Littoral) sont ASSUMÉS et documentés — c'est Marc qui tranche.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');
const plat = (o) => JSON.parse(JSON.stringify(o));

// Fusion.gs réutilise la canonicalisation d'Entites.gs (cleCanoniqueEntite_, tokensEntite_, jaccardTokens_).
const ctx = load(['Config.gs', 'Entites.gs', 'Fusion.gs']);

function dossiers(spec) { return spec.map(([nom, nfiles]) => ({ nom, id: 'ID_' + nom, nfiles: nfiles || 0 })); }
function noms(cluster) { return cluster.map((d) => d.nom).sort(); }

/* ---------- clusteriserDossiers_ ---------- */

test('clusteriserDossiers_ : les 5 graphies d\'IRCC forment UN cluster (chaînage + acronyme)', () => {
  const ds = dossiers([
    ['IRCC (fédéral)', 13], ['IRCC — Immigration, Réfugiés Et Citoyenneté Canada', 0],
    ['Immigration, Réfugiés Et Citoyenneté Canada', 0], ['IRCC', 0],
    ['Immigration, Refugees and Citizenship Canada (IRCC)', 0], ['Permis de travail & EIMT', 16],
  ]);
  const cl = ctx.clusteriserDossiers_('04 · Immigration', ds);
  const ircc = cl.find((c) => c.some((d) => d.nom === 'IRCC'));
  assert.ok(ircc, 'un cluster contient IRCC');
  assert.strictEqual(ircc.length, 5, 'les 5 graphies IRCC groupées');
  // « Permis de travail & EIMT » (seul) n\'est pas un cluster (taille 1 → non renvoyé).
  assert.ok(!cl.some((c) => c.some((d) => d.nom === 'Permis de travail & EIMT')), 'un dossier isolé n\'est pas un cluster');
});

test('clusteriserDossiers_ : deux MIFI (acronyme commun) groupés ; deux entités distinctes séparées', () => {
  const ds = dossiers([
    ['MIFI (Québec)', 7], ["Ministère De l'Immigration, De La Francisation Et De l'Intégration (MIFI)", 0],
    ['CIC Nord Ouest', 3], ['Robovic', 22],
  ]);
  const cl = ctx.clusteriserDossiers_('04 · Immigration', ds);
  assert.strictEqual(cl.length, 1, 'seul MIFI forme un cluster ; CIC et Robovic isolés');
  // noms() trie : « MIFI (Québec) » avant « Ministère… » (I majuscule < i minuscule).
  assert.deepStrictEqual(plat(noms(cl[0])), ['MIFI (Québec)', "Ministère De l'Immigration, De La Francisation Et De l'Intégration (MIFI)"]);
});

test('clusteriserDossiers_ : FAUX POSITIF assumé — « IUT De Lyon » groupé avec « IUT Du Littoral » (jeton IUT)', () => {
  // Documente que le RADAR sur-groupe (deux écoles différentes) : c\'est VOULU que ce soit détecté,
  // et c\'est Marc qui l\'écarte à la validation. Le test échouerait si le comportement changeait en
  // silence (ex. on croirait à tort que le clustering est « sûr » pour une fusion automatique).
  const ds = dossiers([['IUT Du Littoral', 15], ['IUT De Lyon', 1]]);
  const cl = ctx.clusteriserDossiers_('06 · Études & diplômes', ds);
  assert.strictEqual(cl.length, 1, 'le radar LES GROUPE (faux positif) — Marc doit trancher, jamais une fusion auto');
});

test('clusteriserDossiers_ : synonymes par inclusion de jetons (Schémas / Schémas & diagrammes)', () => {
  const ds = dossiers([['Schémas', 1], ['Schémas & diagrammes', 1], ['Schémas électroniques', 1], ['Présentations', 3]]);
  const cl = ctx.clusteriserDossiers_('08 · Perso & projets', ds);
  assert.strictEqual(cl.length, 1);
  assert.strictEqual(cl[0].length, 3, 'les 3 Schémas groupés, Présentations isolé');
});

/* ---------- dossiersLies_ / acronymesFusion_ / anneesDistinctes_ ---------- */

test('dossiersLies_ : acronyme commun lie ; aucun signal commun ne lie pas', () => {
  assert.strictEqual(ctx.dossiersLies_('04 · Immigration', 'MIFI (Québec)', 'Ministère (MIFI)'), true);
  assert.strictEqual(ctx.dossiersLies_('02 · Finances', 'Desjardins', 'Boursorama Banque'), false);
});

test('dossiersLies_ : VETO millésime — deux MODÈLES-ANNÉE ne se lient JAMAIS (Honda Civic 2014 ≠ 2017)', () => {
  // Danger relevé par structure-keeper : le recouvrement de jetons (jaccard 3/4) LES lierait, et pire,
  // la clé canonique aussi (`canoniserVehicule_` retire l'année). Le veto `anneesDistinctes_` en TÊTE
  // de `dossiersLies_` les sépare — deux véhicules RÉELS (TAXONOMY §véhicules, règle `estFusionnableEntite_`).
  assert.strictEqual(ctx.dossiersLies_('03 · Logement & véhicule', 'Honda Civic 2014', 'Honda Civic 2017'), false);
  const cl = ctx.clusteriserDossiers_('03 · Logement & véhicule', dossiers([['Honda Civic 2014', 5], ['Honda Civic 2017', 2]]));
  assert.strictEqual(cl.length, 0, 'deux véhicules réels : jamais un cluster de fusion');
});

test('anneesDistinctes_ : année d\'un seul côté (ou différente) = distinct ; même année = non distinctif', () => {
  assert.strictEqual(ctx.anneesDistinctes_('Relevés 2024', 'Relevés 2025'), true);   // millésimes différents
  assert.strictEqual(ctx.anneesDistinctes_('Honda Civic 2014', 'Honda Civic'), true); // année d'un seul côté
  assert.strictEqual(ctx.anneesDistinctes_('Impôts 2023', 'Déclaration 2023'), false); // même année : non distinctif
  assert.strictEqual(ctx.anneesDistinctes_('IRCC', 'IRCC (fédéral)'), false);          // aucune année
});

test('acronymesFusion_ : extrait les jetons EN MAJUSCULES (≥2), en minuscules', () => {
  assert.deepStrictEqual(plat(ctx.acronymesFusion_('IRCC (fédéral)')), ['ircc']);
  assert.deepStrictEqual(plat(ctx.acronymesFusion_('Permis de travail & EIMT')), ['eimt']);
  assert.deepStrictEqual(plat(ctx.acronymesFusion_('Robovic')), []); // pas d\'acronyme
});

/* ---------- cibleFusion_ ---------- */

test('cibleFusion_ : la cible = le dossier qui a le PLUS de fichiers (on ne déplace pas le gros)', () => {
  const cible = ctx.cibleFusion_(dossiers([['IRCC', 0], ['IRCC (fédéral)', 13], ['Immigration…', 0]]));
  assert.strictEqual(cible.nom, 'IRCC (fédéral)');
});

test('cibleFusion_ : à égalité de fichiers, le nom le plus DESCRIPTIF (long), puis alpha — déterministe', () => {
  const cible = ctx.cibleFusion_(dossiers([['CV', 0], ['CV & lettres', 0]]));
  assert.strictEqual(cible.nom, 'CV & lettres');
});

test('cibleFusion_ : une ANCRE STRUCTURELLE est GARDÉE comme cible, même avec MOINS de fichiers', () => {
  // Danger structure-keeper #1 : un bucket du reset (« IRCC (fédéral) ») vidé au profit d'un legacy plus
  // gros serait recréé PAR NOM au tick suivant (non convergent). L'ancre prime sur le nb de fichiers.
  const estAncre = (nom) => nom === 'IRCC (fédéral)';
  const cible = ctx.cibleFusion_(dossiers([['IRCC (fédéral)', 0], ['IRCC', 13]]), estAncre);
  assert.strictEqual(cible.nom, 'IRCC (fédéral)', 'le bucket structurel est la cible, jamais vidé');
  // Sans prédicat (tests purs / rétrocompat) : ordre historique (le plus de fichiers gagne).
  assert.strictEqual(ctx.cibleFusion_(dossiers([['IRCC (fédéral)', 0], ['IRCC', 13]])).nom, 'IRCC');
});

test('lignesPlanFusion_ : une SOURCE structurelle (cluster multi-ancres) est écartée par défaut « Ignorer (structurel) »', () => {
  // Cas rare : deux ancres dans un même cluster ⇒ une seule peut être CIBLE ; l'autre (source) ne doit
  // JAMAIS être vidée par défaut. Marc doit consciemment l'override pour la fusionner.
  const cluster = dossiers([['IRCC (fédéral)', 10], ['MIFI (Québec)', 3]]);
  const estAncre = (nom) => nom === 'IRCC (fédéral)' || nom === 'MIFI (Québec)';
  const cible = ctx.cibleFusion_(cluster, estAncre); // IRCC (fédéral) : 2 ancres → départage au nb de fichiers
  const lignes = ctx.lignesPlanFusion_('04 · Immigration', '04 · Immigration#1', cluster, cible, estAncre);
  const source = lignes.find((l) => l[3] === 'source');
  assert.strictEqual(source[4], 'MIFI (Québec)');
  assert.strictEqual(source[7], 'Ignorer (structurel)', 'une ancre-source est écartée par défaut (opt-out)');
  // La cible structurelle garde l'Action opt-in normale.
  assert.strictEqual(lignes.find((l) => l[3] === 'CIBLE')[7], 'À VALIDER');
});

/* ---------- lignesPlanFusion_ ---------- */

test('lignesPlanFusion_ : CIBLE en tête, sources ensuite, Action « À VALIDER » par défaut (opt-in)', () => {
  const cluster = dossiers([['IRCC', 0], ['IRCC (fédéral)', 13]]);
  const cible = ctx.cibleFusion_(cluster);
  const lignes = ctx.lignesPlanFusion_('04 · Immigration', '04 · Immigration#1', cluster, cible);
  assert.strictEqual(lignes.length, 2);
  assert.strictEqual(lignes[0][3], 'CIBLE');            // Rôle
  assert.strictEqual(lignes[0][4], 'IRCC (fédéral)');   // Dossier (la cible en tête)
  assert.strictEqual(lignes[1][3], 'source');
  assert.strictEqual(lignes[0][7], 'À VALIDER');        // Action : opt-in (Marc met Fusionner/Ignorer)
  assert.strictEqual(lignes[0][8], '');                 // Statut vide
  assert.strictEqual(lignes[0].length, 9);              // cf. COLONNES_PLAN_FUSION
});

/* ---------- VERROU de surface : ZÉRO mutation dans Fusion.gs (PR1) ---------- */

test('VERROU zéro-mutation : Fusion.gs (PR1 dry-run) ne contient AUCUNE mutation Drive', () => {
  const contenu = fs.readFileSync(path.join(__dirname, '..', 'src', 'Fusion.gs'), 'utf-8');
  const INTERDITS = ['moveTo(', 'setTrashed(', '.setName(', 'createFolder(', '.createFile(',
    'removeFile(', 'addFile(', 'createShortcut(', 'UrlFetchApp.fetch('];
  const viol = INTERDITS.filter((m) => contenu.includes(m));
  assert.deepStrictEqual(viol, [], 'PR1 est un dry-run pur — l\'exécution (moveTo) est PR2, gardée : ' + viol.join(', '));
});
