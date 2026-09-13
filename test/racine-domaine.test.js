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
const DEJA_RANGES = require('./fixtures/deja-ranges-2026-09-13.json');

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
  '06 · Études & diplômes': 464,      // D6 (475 au recensement ; 11 rattrapés par la table, cf. plus bas)
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

test('ADR-0052 — ce que la TABLE seule sait placer, mesuré sur le corpus', () => {
  // Au recensement du 13/09, avant ce chantier, la table n'en plaçait que 13 sur 683 (1,9 %) —
  // c'est le constat du §1 de l'ADR. Les corrections de motifs de la revue flotte (« saint-hyacinthe »
  // que `normaliserCle_` écrit avec son trait d'union, 4 établissements absents du vocabulaire,
  // l'identité dans `04`) l'ont fait monter SANS toucher au repli. Ce chiffre-ci est donc celui
  // que la table rattrape seule ; le reste est l'apport du repli par TYPE.
  let parLaTable = 0;
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    parLaTable += noms.filter((n) => ctx.cheminCibleReset_(domaine, n)).length;
  }
  assert.strictEqual(parLaTable, 31);
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
  assert.deepStrictEqual(divergences, [], 'divergences (5 premières) : ' + divergences.slice(0, 5).join(' | '));
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

/* ---------- 8. D8 : un signal FAIBLE ne déplace jamais ce qui est déjà rangé ---------- */

test('ADR-0052 D8 — aucun fichier DÉJÀ rangé n\'est sorti de son sous-dossier par le repli', () => {
  // ⚠️ C'EST LE TEST QUI COMPTE LE PLUS. Les 683 de la racine sont la population où tout
  // déplacement est un gain par construction (`sousCheminActuel === ''`). La population sur
  // laquelle le repli agira VRAIMENT, le jour où la consolidation repassera, ce sont les ~15 700
  // documents DÉJÀ classés — et là, un déplacement est une PERTE. Mesuré avant d'écrire la garde :
  // sur ces 16 fichiers réels, 2 partaient vers `Correspondance` (la table ne reconnaît ni
  // « Saga Installation » ni « Guy Laporte » ; la mission logements, elle, les avait bien rangés).
  const sortis = [];
  for (const [domaine, parDossier] of Object.entries(DEJA_RANGES)) {
    if (domaine.charAt(0) === '_') continue;
    for (const [sousChemin, noms] of Object.entries(parDossier)) {
      for (const nom of noms) {
        const cible = ctx.cheminCibleConsolidation_(domaine, nom, {});
        const d = ctx.decisionConsolidation_({
          domaine: domaine, sousCheminActuel: sousChemin, sousCheminCible: cible.nom,
          dossierIdCible: cible.id, cibleFaible: cible.faible === true,
          parentId: null, protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
        });
        if (d.action !== 'OK') sortis.push(sousChemin + ' → ' + d.cible + '   (' + nom + ')');
      }
    }
  }
  assert.deepStrictEqual(sortis, []);
});

test('ADR-0052 D8 — la garde ne s\'applique QU\'au signal faible, et jamais à la racine', () => {
  const base = { domaine: '03 · Logement & véhicule', protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null, parentId: null, dossierIdCible: '' };
  // Cible FORTE (table / entité) : le déplacement reste possible — sinon la garde gèlerait tout
  // reclassement, y compris celui que Marc attend.
  assert.strictEqual(ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Contrats', sousCheminCible: 'Logement/3325 4e avenue', cibleFaible: false,
  })).action, 'Déplacer');
  // Cible FAIBLE mais fichier à la RACINE : le repli fait exactement son travail.
  assert.strictEqual(ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: '', sousCheminCible: 'Correspondance', cibleFaible: true,
  })).action, 'Déplacer');
  // Cible FAIBLE et fichier déjà rangé : on ne touche à rien.
  assert.strictEqual(ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Logement/3325 4e avenue', sousCheminCible: 'Correspondance', cibleFaible: true,
  })).action, 'OK');
});

test('ADR-0052 D8 — le drapeau `faible` n\'est posé QUE par le repli par type', () => {
  const dom = '03 · Logement & véhicule';
  assert.strictEqual(ctx.sousCheminDomaine_({ domaine: dom, entite: { nom: 'X', dossierId: 'ID' } }).faible, undefined);
  assert.strictEqual(ctx.sousCheminDomaine_({ domaine: '02 · Finances', annee: '2026' }).faible, undefined);
  assert.strictEqual(ctx.sousCheminDomaine_({ domaine: dom, nom: '2024-01-01_Contrat_Inconnu.pdf' }).faible, true);
  // Rien à dire sur ce nom ⇒ pas de cible, donc pas de drapeau (et la racine reste la racine).
  const rien = ctx.sousCheminDomaine_({ domaine: dom, nom: 'sans convention.pdf' });
  assert.strictEqual(rien.nom, '');
  assert.strictEqual(rien.faible, undefined);
});

/* ---------- 9. Les pièges de motifs trouvés par la revue flotte ---------- */

test('bucketTypeDomaine_ : les 6 collisions de motifs relevées en revue restent fermées', () => {
  const cas = [
    // « formation » ⊂ « information » — le bug qu'une revue précédente avait déjà fermé 190 lignes
    // plus haut dans le MÊME fichier, et que la liste en sous-chaîne avait ré-ouvert.
    ['05 · Carrière', "2025-01-01_Note d'information_Pôle Emploi.pdf", ''],
    ['05 · Carrière', '2025-01-01_Bilan de formation_IMERIR.pdf', 'Formation & bilans'],
    // « acte » ⊂ « caractéristiques », « facteur » — et c'est EXACTEMENT la famille D7.
    ['03 · Logement & véhicule', '2025-01-01_Caractéristiques techniques_Amana.pdf', ''],
    ['03 · Logement & véhicule', '2025-01-01_Acte de cautionnement_Dobernard.pdf', 'Contrats'],
    // « demande » (correspondance) volait la famille FORMULAIRE dans 01.
    ['01 · Administratif & identité', '2025-01-01_Formulaire de demande de logement_CAF.pdf',
      'Attestations & certificats'],
    // Une assurance AUTO n'est pas une assurance habitation ; 03 a le nœud prévu pour ça.
    ['03 · Logement & véhicule', '2025-01-01_Assurance auto_Intact.pdf', 'Véhicule/À attribuer'],
    ['03 · Logement & véhicule', "2025-01-01_Assurance_Filia-MAIF.pdf", 'Assurance habitation'],
    // Les deux graphies d'une locution doivent donner la MÊME cible (trait d'union neutralisé).
    ['07 · Santé', '2025-01-01_Compte-rendu opératoire_CHU.pdf', 'Médecins & consultations'],
    ['07 · Santé', '2025-01-01_Compte rendu opératoire_CHU.pdf', 'Médecins & consultations'],
    ['07 · Santé', '2025-01-01_Rendez-vous_Dr Martin.pdf', 'Médecins & consultations'],
    ['07 · Santé', '2025-01-01_Rendez vous_Dr Martin.pdf', 'Médecins & consultations'],
    // « profil » tuait « capture de profil » ; les captures sont tranchées en UN endroit.
    ['08 · Perso & projets', '2025-01-01_Capture de profil_Instagram.jpg', 'Photos & loisirs'],
    ['08 · Perso & projets', '2025-01-01_Capture de conversation_Guy.jpg', 'Notes'],
    // « journal » nu envoyait un journal intime chez les exports.
    ['08 · Perso & projets', '2025-01-01_Journal intime_Marc.pdf', 'Écrits & rédactions'],
  ];
  const obtenu = cas.map(([d, n]) => [d, n, ctx.bucketTypeDomaine_(d, n)]);
  assert.deepStrictEqual(obtenu, cas);
});

test('cheminCibleReset_ : la table 04 place les pièces d\'identité, SANS voler la carte de RP', () => {
  // C'est la lentille de PRODUCTION pour 04 : `reorganiserInterne04_` (le seul mutateur autorisé
  // dans la zone protégée) résout sa cible par CETTE fonction, pas par le repli. Sans cette règle,
  // le nœud `04/Pièces d'identité` ajouté à la table n'aurait eu aucun producteur.
  const d = '04 · Immigration';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2019-09-17_Passeport_Préfecture du Nord.pdf'), 'Pièces d\'identité');
  // …mais une CARTE DE RÉSIDENT PERMANENT est d'abord un document de STATUT : l'ordre des deux
  // règles est le garde-fou, et il a failli être inversé.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-01-01_Carte de résident permanent_IRCC.pdf'), 'Résidence permanente');
});

test('cheminCibleReset_ : « Saint-Hyacinthe » et « Saint-Omer » matchent malgré le trait d\'union', () => {
  // `normaliserCle_` CONSERVE les traits d'union : le motif « saint hyacinthe » était dans la table
  // depuis toujours et n'appariait rien (trouvé en revue).
  const d = '06 · Études & diplômes';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2018-01_Relevé_Cégep de Saint-Hyacinthe.jpg'), 'Autres établissements');
  assert.ok(String(ctx.cheminCibleReset_(d, '2016-01-01_Cours_IUT de Saint-Omer.pdf')).indexOf('DUT ULCO') === 0);
});

test('ADR-0052 — convergence flux ↔ conso aussi sur les branches que le corpus ne traverse pas', () => {
  // Le corpus des 683 n'a AUCUN fichier de `02` et passe toujours `validees = {}` : les deux
  // branches qui PRÉCÈDENT le repli — entité validée, puis année — n'y sont jamais exercées
  // (trouvé en revue). Or c'est justement là que les deux consommateurs lisent des sources
  // différentes : le flux dérive l'année de la DATE du document, la consolidation du NOM.
  const dom02 = '02 · Finances';
  // Nom que la TABLE ne route pas (« Document » n'est dans aucune de ses listes) : c'est le seul
  // moyen d'atteindre la branche ANNÉE, celle-là même dont les deux consommateurs tirent la valeur
  // de sources différentes.
  const nom02 = '2024-03-01_Document_Inconnu.pdf';
  assert.strictEqual(ctx.cheminCibleReset_(dom02, nom02), null, 'pré-condition : la table refuse');
  const plan02 = planDuFlux(dom02, nom02);
  assert.strictEqual(plan02.sousDossier, '2024', 'le flux range 02 par année');
  assert.strictEqual(ctx.cheminCibleConsolidation_(dom02, nom02, {}).nom, '2024');

  // ENTITÉ VALIDÉE : elle doit gagner sur le repli par type, des deux côtés.
  const dom05 = '05 · Carrière';
  const nom05 = '2024-03-01_Attestation_Robovic.pdf';
  const cle = ctx.cleCanoniqueEntite_(dom05, 'Robovic');
  const validees = {}; validees[cle] = { nom: 'Robovic', dossierId: '' };
  const seg = ctx.analyserNomClasse_(nom05);
  const planEnt = ctx.planRoutageV2_(
    { domaine: dom05, type_doc: seg.type, emetteur: seg.tiers, sousDossier: 'Robovic' },
    { nomFichier: nom05 }, '2024-03-01', '.pdf', validees);
  assert.strictEqual(ctx.cheminCibleConsolidation_(dom05, nom05, validees).nom, planEnt.sousDossier);
  // …et sans référentiel, le repli prend le relais SANS diverger.
  assert.strictEqual(ctx.cheminCibleConsolidation_(dom05, nom05, {}).nom,
    sousDossierDuFlux(dom05, nom05));
});
