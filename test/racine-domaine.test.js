'use strict';
/**
 * ADR-0052 — « la racine d'un domaine n'est plus une cible de classement ».
 *
 * Le banc d'essai est le CORPUS RÉEL : les 683 fichiers qui étaient à plat à la racine des
 * domaines au recensement exhaustif du 2026-09-13 (`test/fixtures/vrac-racines-2026-09-13.json`,
 * noms seuls — métadonnées, jamais de contenu). On ne teste pas « la fonction rend bien ce que
 * j'ai écrit dedans » : on mesure, sur du réel, COMBIEN de documents atterrissent encore à la
 * racine, domaine par domaine. Un chiffre qui monte fait échouer la CI.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');
const CORPUS = require('./fixtures/vrac-racines-2026-09-13.json');

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs',
  'Router.gs', 'Llm.gs']);

/**
 * LE bon objectif de mesure pour un STOCK déjà posé sur le Drive, c'est la CONSOLIDATION : c'est
 * elle qui repasse sur les fichiers existants, et elle raisonne sur leur nom ACTUEL. Le flux
 * vivant, lui, RENOMME avant de router — il ne reverra jamais ces 683 fichiers sous ces noms-là.
 * (Mesurer le stock avec la lentille du flux donnerait un chiffre qui ne décrit rien de réel :
 * les 22 artefacts d'agent hors convention y arrivent sous un nom régénéré.)
 */
function sousDossierDeLaConso(domaine, nom) {
  return ctx.cheminCibleConsolidation_(domaine, nom, {}).nom;
}

/**
 * Le chemin du FLUX VIVANT (nouvelles arrivées) : `planRoutageV2_` lui-même, jamais une ré-écriture
 * de sa cascade de replis dans le test — elle divergerait le jour où la cascade change, et le test
 * validerait alors sa propre copie. `validees` vide = aucun dossier d'entité, ce qui est bien
 * l'état de ces 683 fichiers.
 */
function planDuFlux(domaine, nom) {
  const seg = ctx.analyserNomClasse_(nom);
  const m = nom.match(/(\.[A-Za-z0-9]{1,6})$/);
  const jour = nom.slice(0, 10);
  const plan = ctx.planRoutageV2_(
    { domaine: domaine, type_doc: seg.type, emetteur: seg.tiers },
    { nomFichier: nom },
    /^\d{4}-\d{2}-\d{2}$/.test(jour) ? jour : '',
    m ? m[1] : '',
    {});
  return plan;
}

function sousDossierDuFlux(domaine, nom) {
  const plan = planDuFlux(domaine, nom);
  return plan.type === 'classé' ? plan.sousDossier : '(' + plan.type + ')';
}

/** Vrai si `chemin` (relatif au domaine) désigne un nœud EXISTANT de la structure cible. */
function cibleExisteDansTable(domaine, chemin) {
  let noeud = ctx.STRUCTURE_CIBLE_RESET[domaine];
  if (!noeud) return false;
  for (const seg of chemin.split('/')) {
    if (!noeud || !Object.prototype.hasOwnProperty.call(noeud, seg)) return false;
    noeud = noeud[seg];
  }
  return true;
}

/* ---------- 1. Le compteur d'atterrissages à la RACINE, par domaine ---------- */

// Les deux lignes non nulles sont des DÉCISIONS EN ATTENTE de Marc, pas des tolérances :
//  · 06 = 475 → ADR-0052 D6 : le domaine est PLEIN (7 nœuds) et les 475 travaux scolaires n'ont
//    AUCUNE école identifiable, ni dans le nom (0/475 mesuré) ni dans le contenu (2 documents lus).
//    Leur accueil demande un nœud de plus, donc l'arbitrage A/B de l'ADR.
//  · 03 = 8 → ADR-0052 D7 : documents d'ÉQUIPEMENT du logement, 03 est PLEIN lui aussi.
// Quand Marc tranche, ces deux nombres tombent à 0 et ce tableau est la preuve de l'effet.
const RACINE_ATTENDUE = {
  '01 · Administratif & identité': 1, // « Fragment de document technique » — le type n'apprend rien
  '03 · Logement & véhicule': 8,      // D7
  '04 · Immigration': 0,
  '05 · Carrière': 0,
  '06 · Études & diplômes': 475,      // D6
  '07 · Santé': 0,
  '08 · Perso & projets': 1,          // `profil-vocal-marc.md` : ni date, ni type, ni émetteur
  '09 · Voyages': 0,
};

test('ADR-0052 — corpus réel : le compte de fichiers laissés à la RACINE, domaine par domaine', () => {
  const mesure = {};
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    mesure[domaine] = noms.filter((n) => sousDossierDeLaConso(domaine, n) === '').length;
  }
  assert.deepStrictEqual(mesure, RACINE_ATTENDUE);
});

test('ADR-0052 — avant/après : la table SEULE ne plaçait que 13 des 683 (mesure du constat)', () => {
  // Le chiffre du §1 de l'ADR, re-mesuré par le code plutôt que recopié : c'est lui qui dit
  // combien le repli par TYPE apporte réellement (13 → 199 hors décisions en attente).
  let avant = 0;
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    avant += noms.filter((n) => ctx.cheminCibleReset_(domaine, n)).length;
  }
  assert.strictEqual(avant, 13);
  const restants = Object.values(RACINE_ATTENDUE).reduce((a, b) => a + b, 0);
  assert.strictEqual(683 - restants, 198);
});

test('ADR-0052 — le corpus figé est bien celui du recensement (683 fichiers, 8 domaines)', () => {
  const total = Object.values(CORPUS).reduce((n, l) => n + l.length, 0);
  assert.strictEqual(total, 683);
  assert.deepStrictEqual(Object.keys(CORPUS).sort(), Object.keys(RACINE_ATTENDUE).sort());
});

/* ---------- 2. Le repli ne peut pas INVENTER un dossier ---------- */

test('bucketTypeDomaine_ : toute cible rendue EXISTE dans STRUCTURE_CIBLE_RESET', () => {
  const inconnues = [];
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    for (const nom of noms) {
      const c = ctx.bucketTypeDomaine_(domaine, nom);
      if (c && !cibleExisteDansTable(domaine, c)) inconnues.push(domaine + ' → ' + c + '  (' + nom + ')');
    }
  }
  assert.deepStrictEqual(inconnues, []);
});

test('bucketTypeDomaine_ : domaine inconnu ou nom sans segment TYPE ⇒ refus (jamais deviné)', () => {
  assert.strictEqual(ctx.bucketTypeDomaine_('42 · Inexistant', '2026-01-01_Facture_EDF.pdf'), '');
  assert.strictEqual(ctx.bucketTypeDomaine_('08 · Perso & projets', 'photo de vacances.jpg'), '');
  assert.strictEqual(ctx.bucketTypeDomaine_('08 · Perso & projets', ''), '');
});

test('bucketTypeDomaine_ : 06 REFUSE tant que la structure n\'est pas tranchée (D6)', () => {
  // Le refus est une DÉCISION, pas un oubli : entasser 475 travaux scolaires dans « Autres
  // établissements » (= « un AUTRE établissement ») n'est pas « le bon sous-dossier ».
  for (const nom of CORPUS['06 · Études & diplômes'].slice(0, 40)) {
    assert.strictEqual(ctx.bucketTypeDomaine_('06 · Études & diplômes', nom), '');
  }
});

/* ---------- 3. 04 · Immigration : réorganisation INTERNE, aucune sortie (§1.1b) ---------- */

test('ADR-0052 — 04 : toutes les cibles du repli sont des nœuds DE 04, jamais une sortie', () => {
  const cibles = new Set();
  for (const nom of CORPUS['04 · Immigration']) {
    const c = ctx.bucketTypeDomaine_('04 · Immigration', nom);
    if (c) cibles.add(c);
  }
  assert.ok(cibles.size > 0, 'le repli doit placer quelque chose dans 04');
  for (const c of cibles) {
    assert.ok(cibleExisteDansTable('04 · Immigration', c), c + ' hors de la structure de 04');
    assert.ok(c.indexOf('·') === -1, c + ' ressemble à un chemin de SORTIE vers un autre domaine');
  }
  // Les 7 passeports à plat dans 04 y RESTENT, dans le nœud interne « Pièces d'identité ».
  assert.strictEqual(ctx.bucketTypeDomaine_('04 · Immigration',
    '2019-09-17_Passeport_Préfecture du Nord.pdf'), 'Pièces d\'identité');
});

test('estDocumentIdentiteReset_ : UNE règle, deux consommateurs (branche 01 + repli 04)', () => {
  // Si le vocabulaire d'identité était recopié, cet ajout-ci vaudrait dans un seul des deux.
  assert.ok(ctx.estDocumentIdentiteReset_('passeport'));
  assert.ok(ctx.estDocumentIdentiteReset_('numero d assurance sociale'));
  assert.ok(!ctx.estDocumentIdentiteReset_('facture'));
  assert.strictEqual(ctx.cheminCibleReset_('01 · Administratif & identité',
    '2020-01-01_Passeport_Préfecture du Nord.pdf'), 'Pièces d\'identité/Marc');
  assert.strictEqual(ctx.bucketTypeDomaine_('04 · Immigration',
    '2020-01-01_Passeport_Préfecture du Nord.pdf'), 'Pièces d\'identité');
});

/* ---------- 4. Flux ↔ consolidation : le repli est branché des DEUX côtés ---------- */

test('ADR-0052 — flux et consolidation calculent la MÊME cible sur les 683 noms réels', () => {
  // NON tautologique : ce sont deux APPELANTS distincts de `sousCheminDomaine_`, et c'est
  // précisément l'oubli du paramètre `nom` chez l'un d'eux que ce test attrape (la consolidation
  // proposerait alors de RAMENER à la racine ce que le flux vient de ranger).
  const divergences = [];
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    for (const nom of noms) {
      const plan = planDuFlux(domaine, nom);
      if (plan.type !== 'classé') continue; // non-document : la conso n'a pas cette notion
      // On interroge la conso sur le nom que le flux VIENT DE PRODUIRE — c'est la vraie question
      // (« ce que le flux range, la conso le laisse-t-elle en place ? »), et la seule qui a un sens
      // pour les noms hors convention, que le flux réécrit.
      const conso = ctx.cheminCibleConsolidation_(domaine, plan.nom, {}).nom;
      if (plan.sousDossier !== conso) {
        divergences.push(domaine + ' | ' + plan.nom + ' : flux=' + plan.sousDossier + ' conso=' + conso);
      }
    }
  }
  assert.deepStrictEqual(divergences.slice(0, 5), []);
});

/* ---------- 5. Multi-segments : jamais un dossier dont le NOM contient une barre oblique ---------- */

test('planRoutageV2_ : un repli MULTI-SEGMENTS repasse par `segments` (pas de dossier « a/b »)', () => {
  // « Reçu_Flight Network » en 09 → « Réservations & billets/2025 » : deux niveaux à créer.
  // Sans la conversion, `deciderRoutageV2_` appellerait `sousDossier_(dom, 'Réservations & billets/2025')`
  // et créerait un dossier dont le nom porte la barre oblique — faux jumeau, invisible ensuite.
  const plan = ctx.planRoutageV2_(
    { domaine: '09 · Voyages', type_doc: 'Reçu', emetteur: 'Flight Network' },
    { nomFichier: '2025-01-21_Reçu_Flight Network.pdf' }, '2025-01-21', '.pdf', {});
  assert.strictEqual(plan.sousDossier, 'Réservations & billets/2025');
  // `Array.from` : le moteur est chargé dans un contexte `vm`, ses tableaux n'ont donc pas le
  // MÊME prototype que ceux du test — `deepStrictEqual` compare l'identité du prototype.
  assert.deepStrictEqual(Array.from(plan.segments), ['Réservations & billets', '2025']);
  // Et un repli à UN segment ne passe pas par `segments` (comportement historique inchangé).
  const simple = ctx.planRoutageV2_(
    { domaine: '08 · Perso & projets', type_doc: 'Note personnelle', emetteur: 'Marc' },
    { nomFichier: '2025-01-21_Note personnelle_Marc.pdf' }, '2025-01-21', '.pdf', {});
  assert.strictEqual(simple.sousDossier, 'Notes');
  assert.strictEqual(simple.segments, undefined);
});

/* ---------- 6. Le repli CLASSE, il ne dévie jamais vers la revue (§11.5) ---------- */

test('ADR-0052 — aucun des 683 ne part en revue : le repli enrichit, il ne freine pas', () => {
  const devies = [];
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    for (const nom of noms) {
      const s = sousDossierDuFlux(domaine, nom);
      if (s === '(à vérifier)') devies.push(domaine + ' | ' + nom + ' → ' + s);
    }
  }
  assert.deepStrictEqual(devies, []);
});

/* ---------- 7. La structure reste conforme après les deux nœuds ajoutés (D3) ---------- */

test('ADR-0052 D3 — les nœuds ajoutés existent et la contrainte ≤ 7 tient toujours', () => {
  assert.ok(ctx.STRUCTURE_CIBLE_RESET['09 · Voyages']['Préparation & guides']);
  assert.ok(ctx.STRUCTURE_CIBLE_RESET['04 · Immigration']['Pièces d\'identité']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(
    ctx.verifierStructureCibleReset_(ctx.STRUCTURE_CIBLE_RESET, 7))), []);
});
