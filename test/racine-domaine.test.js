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

const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Migration.gs', 'Reset.gs',
  'Missions.gs', 'Router.gs', 'Llm.gs']);

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
  '03 · Logement & véhicule': 2,      // D7 appliquée : restent 2 fichiers qui ne sont PAS de
                                      // l'équipement (une capture d'annonce, une liste d'achats
                                      // pour le VÉHICULE) — la revue flotte avait corrigé l'étiquette
  '04 · Immigration': 0,
  '05 · Carrière': 0,
  '06 · Études & diplômes': 332,      // D6 appliquée : 143 placés — 34 par un FAIT écrit dans le
                                      // nom (école, diplôme, marqueur GIM/1ʳᵉ) et 109 par les
                                      // fenêtres de scolarité. Sur les 332 restants, ~237 portent
                                      // la date 2026 — la date de RÉCEPTION faute de date lisible
                                      // dans le document — donc hors de toute fenêtre. C'est ce
                                      // reliquat-là que la re-lecture LLM doit dater (C28-92).
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
  // c'est le constat du §1 de l'ADR. Trois apports l'ont fait monter SANS toucher au repli :
  // les corrections de motifs de la revue flotte (« saint-hyacinthe » que `normaliserCle_` écrit
  // avec son trait d'union, 4 établissements manquants, l'identité dans `04`), les fenêtres de
  // scolarité (D6) et le nœud d'équipement de `03` (D7).
  let parLaTable = 0;
  for (const [domaine, noms] of Object.entries(CORPUS)) {
    parLaTable += noms.filter((n) => ctx.cheminCibleReset_(domaine, n)).length;
  }
  assert.strictEqual(parLaTable, 169);
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
  // ⚠️ UNE SEULE EXCEPTION, et elle est vérifiée À L'ÉCOLE PRÈS (ADR-0055) : les 6 dossiers
  // d'école que le MOTEUR s'était créés à la RACINE de `06` déménagent sous `Archives scolaires`,
  // le dossier de Marc. Un fichier qui quitte `06/IMERIR` pour `06/Archives scolaires/IMERIR —
  // Ingénieur MSIR (2020-2023)` ne « sort » pas de son dossier : il SUIT la structure que Marc a
  // désignée. Un fichier du cégep qui partirait chez l'ULCO, lui, ferait toujours échouer le test.
  const DEMENAGEMENT_06 = {
    "lycée Thérèse d'Avila": 'Collège & Lycée — divers (2014-2018)',
    'Prépa Gustave Eiffel (PTSI)': 'Prépa PTSI (2017-2018)',
    'DUT ULCO Saint-Omer': 'ULCO — DUT GIM (2018-2020)',
    'IUT Du Littoral': 'ULCO — DUT GIM (2018-2020)',
    'IMERIR': 'IMERIR — Ingénieur MSIR (2020-2023)',
    'Cégep de Sherbrooke': 'Cégep de Sherbrooke (2019)',
  };
  const suitLaStructure = (domaine, sousChemin, cible) => {
    if (domaine !== '06 · Études & diplômes') return false;
    const segs = String(sousChemin).split('/');
    const neuf = DEMENAGEMENT_06[segs[0]];
    if (!neuf) return false;
    // Le SOUS-DOSSIER doit être préservé, pas seulement l'école (revue code) : sinon un fichier
    // de `IMERIR/Examens & khôlles` qui partirait vers `…/IMERIR — …/Cours & travaux` passerait
    // pour un déménagement, alors que c'est exactement le ré-arbitrage que D8 interdit.
    const attendu = [domaine, ctx.RACINE_ARCHIVES_ECOLE_RESET, neuf].concat(segs.slice(1)).join('/');
    return String(cible) === attendu;
  };
  const sortis = [];
  let demenages = 0;
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
        if (d.action === 'OK') continue;
        if (suitLaStructure(domaine, sousChemin, d.cible)) { demenages++; continue; }
        sortis.push(sousChemin + ' → ' + d.cible + '   (' + nom + ')');
      }
    }
  }
  assert.deepStrictEqual(sortis, []);
  // …et le déménagement a bien LIEU : sans cette borne, neutraliser la relocalisation laisserait le
  // test vert en ne déplaçant plus rien (« un test qui n'asserte que le blocage verrouille le bug »).
  assert.ok(demenages >= 5, 'le corpus déjà rangé doit suivre la nouvelle structure : ' + demenages);
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

/* ---------- D9 : « on ne remonte jamais un fichier vers un de ses ancêtres » ----------
 * Verrou écrit APRÈS coup (revue sécurité C28-90, 🔴 3) : la garde qui rend le bump de campagne
 * sûr n'était couverte par AUCUN test — neutralisée en `if (false && estSousCheminDe_(…))`, la
 * suite restait entièrement verte. Mutation à rejouer pour prouver ces tests : neutraliser le `if`
 * de D9 dans `decisionConsolidation_`, ou faire rendre `true` à `estSousCheminDe_` sans comparer. */
test('estSousCheminDe_ : segment par segment — un préfixe de CHAÎNE n\'est pas un ancêtre', () => {
  // Le cas nominal : la cible est un ancêtre strict de la position.
  assert.strictEqual(ctx.estSousCheminDe_('Assurance habitation/Desjardins', 'Assurance habitation'), true);
  assert.strictEqual(ctx.estSousCheminDe_('Logement/3325 4e avenue/Correspondance', 'Logement'), true);
  assert.strictEqual(ctx.estSousCheminDe_('Logement/3325 4e avenue/Correspondance', 'Logement/3325 4e avenue'), true);
  // LE piège : « Contrats » est un préfixe de chaîne de « Contrats divers », qui est un AUTRE
  // dossier. Une comparaison par `indexOf` gèlerait le fichier au mauvais endroit, pour toujours.
  assert.strictEqual(ctx.estSousCheminDe_('Contrats divers/2024', 'Contrats'), false);
  assert.strictEqual(ctx.estSousCheminDe_('Contrats', 'Contrats divers'), false);
  // Même profondeur, ou cible plus profonde : D9 n'a rien à dire (c'est un déplacement LATÉRAL ou
  // un APPROFONDISSEMENT — le rattrapage garde tout son pouvoir).
  assert.strictEqual(ctx.estSousCheminDe_('Contrats', 'Correspondance'), false);
  assert.strictEqual(ctx.estSousCheminDe_('Assurance habitation', 'Assurance habitation/MAIF'), false);
  // Chemins identiques : traité en amont par « déjà au bon endroit », jamais ici.
  assert.strictEqual(ctx.estSousCheminDe_('Logement', 'Logement'), false);
  // Cible VIDE (racine du domaine) : D8 s'en charge, D9 s'abstient — sinon TOUT fichier rangé
  // serait « déjà plus fin » et la campagne n'aurait plus aucun effet.
  assert.strictEqual(ctx.estSousCheminDe_('Logement/3325 4e avenue', ''), false);
  assert.strictEqual(ctx.estSousCheminDe_('', ''), false);
  assert.strictEqual(ctx.estSousCheminDe_(null, null), false);
});

test('ADR-0052 D6 — le drapeau « école déduite » ne fuit PAS sur les diplômes, et l\'ordre admin/cours tient', () => {
  const d = '06 · Études & diplômes';
  // 🟠 4 de la revue sécurité : le drapeau se re-calculait depuis le NOM, alors que la branche
  // `Diplômes & relevés officiels` rend AVANT tout calcul d'école. Un relevé de notes de 2021
  // (dans la fenêtre IMERIR) était donc marqué faible et restait sur place, pendant que le MÊME
  // relevé de 2026 partait : la DATE décidait d'une garde qui n'a rien à voir avec elle.
  // Le drapeau ne doit pas DÉPENDRE DE LA DATE sur cette branche : elle rend avant tout calcul
  // d'école. Depuis l'arbitrage du 13/09 elle est faible pour une AUTRE raison (décidée par le seul
  // TYPE, elle ne doit pas vider les dossiers d'école) — ce qui se teste, c'est l'UNIFORMITÉ.
  for (const nom of ['2021-05-05_Relevé de notes_Untel.pdf', '2026-05-05_Relevé de notes_Untel.pdf',
    '2019-05-05_Relevé de notes_Untel.pdf', '2021-05-05_Relevé de notes_IMERIR.pdf']) {
    const c = ctx.cheminCibleConsolidation_(d, nom, {});
    assert.strictEqual(c.nom, 'Diplômes & relevés officiels', nom);
    assert.strictEqual(c.faible, true, nom + ' : filet par TYPE, et jamais une école déduite');
  }
  // …et un diplôme déjà rangé dans un dossier d'école y RESTE (la mission les y remet).
  assert.strictEqual(ctx.decisionConsolidation_({
    domaine: d, sousCheminActuel: 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Administratif', sousCheminCible: 'Diplômes & relevés officiels',
    dossierIdCible: '', cibleFaible: true, parentId: null, protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null,
  }).action, 'OK');
  // Le drapeau reste posé là où une école est bel et bien DÉDUITE d'une fenêtre…
  assert.strictEqual(ctx.cheminCibleConsolidation_(d, '2016-03-01_Devoir_Maths.pdf', {}).faible, true);
  // …et jamais quand le NOM nomme l'école (un FAIT, pas une déduction).
  assert.strictEqual(ctx.cheminCibleConsolidation_(d, '2021-05-05_Cours_IMERIR.pdf', {}).faible, undefined);

  // 🟠 5 : « fiche » et « cours » sont des SOUS-CHAÎNES du vocabulaire des cours, remonté devant
  // `Résultats` dans ce même lot — il passait aussi devant `Administratif`.
  assert.strictEqual(ctx.cheminCibleReset_(d, "2021-09-01_Fiche d'inscription_IMERIR.pdf"), 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Administratif');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05-05_Attestation de suivi de cours_IMERIR.pdf'), 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Administratif');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05-05_Convention de stage_IMERIR.pdf'), 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Administratif');
  // …sans rien voler aux vrais cours (le glissement `Notes de cours` → Cours & travaux, lui, est voulu).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05-05_Notes de cours_IMERIR.pdf'), 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Cours & travaux');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05-05_Travail pratique_IMERIR.pdf'), 'Archives scolaires/IMERIR — Ingénieur MSIR (2020-2023)/Cours & travaux');
});

test('ADR-0052 D9 — la décision : jamais remonté vers un ancêtre, et la raison le DIT', () => {
  const base = { domaine: '03 · Logement & véhicule', protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null, parentId: null, dossierIdCible: '', cibleFaible: false };
  // Signal FORT (le thème est dans le nom, pas l'assureur) et position PLUS FINE : D8 ne peut rien
  // (la cible n'est pas faible), seul D9 arrête le mouvement.
  const d = ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Assurance habitation/Desjardins', sousCheminCible: 'Assurance habitation',
  }));
  assert.strictEqual(d.action, 'OK');
  assert.strictEqual(d.cible, '03 · Logement & véhicule/Assurance habitation/Desjardins',
    'la cible affichée est la position CONSERVÉE, jamais l\'ancêtre');
  assert.ok(d.raison.indexOf('plus finement') !== -1, 'Marc lit la raison dans le plan : elle doit dire la règle qui a décidé');
  // …et l'APPROFONDISSEMENT inverse reste un « Déplacer » : la garde ne gèle rien.
  assert.strictEqual(ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Assurance habitation', sousCheminCible: 'Assurance habitation/MAIF',
  })).action, 'Déplacer');
});

test('C28-90 — une cible VIDE ne remonte JAMAIS un fichier rangé à la racine du domaine', () => {
  // Trouvé en vérifiant la revue, pas par elle : la collecte de consolidation est RÉCURSIVE sur
  // tout le domaine, et « aucune règle ne sait placer ce document » rendait un « Déplacer » vers la
  // RACINE — c'est-à-dire vers le vrac que cette campagne existe pour vider. Un constat d'IGNORANCE
  // ne dit rien du rangement actuel : il ne peut pas le défaire.
  const d = '06 · Études & diplômes';
  const nom = '2024-01-01_Attestation_Coursera.pdf';
  const cible = ctx.cheminCibleConsolidation_(d, nom, {});
  assert.strictEqual(cible.nom, '', 'pré-condition : aucune règle, pas même le type, ne sait le placer');
  const base = { domaine: d, sousCheminCible: cible.nom, dossierIdCible: cible.id,
    cibleFaible: cible.faible === true, parentId: null, protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null };
  const range = ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Archives scolaires/Online course — AI Essentials',
  }));
  assert.strictEqual(range.action, 'OK');
  assert.strictEqual(range.cible, d + '/Archives scolaires/Online course — AI Essentials');
  assert.ok(range.raison.indexOf('racine') !== -1, 'la raison dit le constat, pour que Marc puisse trancher');
  // …et le fichier qui est DÉJÀ à la racine reste le seul cas « Déplacer » impossible : rien à faire.
  assert.strictEqual(ctx.decisionConsolidation_(Object.assign({}, base, { sousCheminActuel: '' })).action, 'OK');
});

test('ADR-0052 D8 — le drapeau `faible` est posé par CHAQUE filet par type, jamais par une règle d\'entité', () => {
  // Régression mesurée par la revue sécurité (🔴 1) : `faible` n'était posé QUE par le repli
  // `bucketTypeDomaine_`. Les filets par type de la TABLE (`cheminCibleReset_`) rendaient une cible
  // NON flaguée — 16 des 36 fichiers ciblés de `03` (44 %) traversaient donc D8 sans être vus, et
  // « Lettre » sortait d'un dossier thématique là où « Échange de messages » était protégé.
  const d03 = '03 · Logement & véhicule';
  const filets = [
    ['2024-03-15_Lettre_Ville de Québec.pdf', 'Correspondance'],
    ['2024-03-15_Mise en demeure_Me Tremblay.pdf', 'Correspondance'],
    ['2024-03-15_Devis_Plomberie Dubé.pdf', 'Contrats'],
    ['2024-03-15_Contrat de vente_Suprême Auto.pdf', 'Contrats'],
    ['2024-03-15_Fiche technique_Inconnu.pdf', 'Travaux & équipements'],
    ['2024-03-15_Constat d\'infraction_Inconnu.pdf', 'Véhicule/À attribuer'],
  ];
  for (const [nom, attendu] of filets) {
    const cible = ctx.cheminCibleConsolidation_(d03, nom, {});
    assert.strictEqual(cible.nom, attendu, nom);
    assert.strictEqual(cible.faible, true, nom + ' : filet par TYPE ⇒ signal faible');
  }
  // …et les mêmes documents, une fois l'ENTITÉ reconnue, redeviennent des signaux FORTS.
  const forts = [
    ['2024-03-15_Lettre_Ville de Québec.pdf'.replace('Ville de Québec', 'Roselière'), 'Logement/1548 avenue de la Roselière, Québec'],
    ['2024-03-15_Contrat_3325 4e avenue.pdf', 'Logement/3325 4e avenue'],
  ];
  for (const [nom, attendu] of forts) {
    const cible = ctx.cheminCibleConsolidation_(d03, nom, {});
    assert.strictEqual(cible.nom, attendu, nom);
    assert.strictEqual(cible.faible, undefined, nom + ' : une règle par ENTITÉ n\'est jamais faible');
  }
  // 01 : les filets par TYPE de la table portent le drapeau, les règles par ÉMETTEUR non.
  // (Les 3 derniers ont été ajoutés APRÈS la revue : le même dossier cible portait un drapeau
  // OPPOSÉ selon la règle qui avait répondu, et un passeport rangé sous `Autres/<proche>` partait
  // dans le dossier d'identité de Marc parce que le nom ne dit pas à qui il est.)
  const d01 = '01 · Administratif & identité';
  const faible01 = [
    ['2024-03-15_Courrier_Inconnu.pdf', 'Correspondance'],
    ['2024-03-15_Attestation de résidence_Ville de Québec.pdf', 'Attestations & certificats'],
    ['2020-01-01_Acte de naissance_Mairie de Lille.pdf', 'État civil & notarial'],
    ['2019-03-02_Passeport_Préfecture du Nord.pdf', 'Pièces d\'identité/Marc'],
  ];
  for (const [nom, attendu] of faible01) {
    const c = ctx.cheminCibleConsolidation_(d01, nom);
    assert.strictEqual(c.nom, attendu, nom);
    assert.strictEqual(c.faible, true, nom + ' : décidé par le seul TYPE');
  }
  assert.strictEqual(ctx.cheminCibleConsolidation_(d01, '2024-03-15_Contrat_EDF.pdf').faible, undefined);
  // L'ÉMETTEUR notarial reste FORT sur le MÊME dossier — c'est la règle qui est qualifiée, pas la
  // destination (sinon le drapeau dépend du chemin d'arrivée, ce que la revue a mesuré).
  const notaire = ctx.cheminCibleConsolidation_(d01, '2020-01-01_Document_Office notarial Dupont.pdf');
  assert.strictEqual(notaire.nom, 'État civil & notarial');
  assert.strictEqual(notaire.faible, undefined);
  // …et un titulaire NOMMÉ reste fort lui aussi.
  assert.strictEqual(ctx.cheminCibleConsolidation_(d01, '2019-03-02_Passeport_Marc Richard.pdf').faible, undefined);
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
    ['03 · Logement & véhicule', "2025-01-01_Assurance_Filia-MAIF.pdf", 'Assurance habitation/MAIF'],
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
  assert.ok(String(ctx.cheminCibleReset_(d, '2016-01-01_Cours_IUT de Saint-Omer.pdf')).indexOf('Archives scolaires/ULCO — DUT GIM') === 0);
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

/* ---------- 10. D6/D7 — les décisions de Marc du 2026-09-13 ---------- */

test('ADR-0052 D6 — les fenêtres de scolarité placent, et REFUSENT dès le moindre doute', () => {
  // Fenêtres validées par Marc : Eiffel 2017-2018, ULCO 2018-2020, IMERIR 2020-2023 — bornées à
  // l'année SCOLAIRE (sept → août), ce qui les rend disjointes malgré des années nues qui se
  // chevauchent.
  assert.strictEqual(ctx.ecoleParDateReset_('2017-11-03_Notes de cours_Maths.pdf'), 'Prépa PTSI (2017-2018)');
  assert.strictEqual(ctx.ecoleParDateReset_('2018-03-12_Devoir_Physique.pdf'), 'Prépa PTSI (2017-2018)');
  assert.strictEqual(ctx.ecoleParDateReset_('2018-10-01_TP_Élec.pdf'), 'ULCO — DUT GIM (2018-2020)');
  assert.strictEqual(ctx.ecoleParDateReset_('2016-03-01_Devoir_SVT.pdf'), 'Collège & Lycée — divers (2014-2018)');
  assert.strictEqual(ctx.ecoleParDateReset_('2021-02-02_Rapport de TP_Robotique.pdf'), 'IMERIR — Ingénieur MSIR (2020-2023)');
  // ANNÉE SEULE : elle ne place que si l'année CIVILE ENTIÈRE tient dans une fenêtre.
  assert.strictEqual(ctx.ecoleParDateReset_('2022_Notes de cours_Maths.pdf'), 'IMERIR — Ingénieur MSIR (2020-2023)');
  assert.strictEqual(ctx.ecoleParDateReset_('2016_Notes de cours_Maths.pdf'), 'Collège & Lycée — divers (2014-2018)');
  assert.strictEqual(ctx.ecoleParDateReset_('2018_Notes de cours_Maths.pdf'), null, '2018 est à cheval');
  assert.strictEqual(ctx.ecoleParDateReset_('2020_Notes de cours_Maths.pdf'), null, '2020 est à cheval');
  // HORS fenêtre — dont les 239 fichiers datés 2026 (date de réception), qu'il ne faut surtout pas
  // rattacher à une école au hasard.
  assert.strictEqual(ctx.ecoleParDateReset_('2026-07-01_Notes de cours_Maths.pdf'), null);
  assert.strictEqual(ctx.ecoleParDateReset_('2013-05-05_Devoir_SVT.pdf'), null, 'avant la 1re fenêtre');
  assert.strictEqual(ctx.ecoleParDateReset_('Notes de cours sans date.pdf'), null);
  assert.strictEqual(ctx.ecoleParDateReset_('2019-13-01_Devoir_X.pdf'), null, 'mois illisible : refus, pas de repli sur l\'année');
});

test('ADR-0052 D6 — le NOM de l\'école prime toujours sur sa DATE', () => {
  // Un fait écrit dans le nom ne se laisse pas contredire par une déduction : un document IMERIR
  // daté dans la fenêtre de l'ULCO reste chez IMERIR.
  const d = '06 · Études & diplômes';
  // La DATE dit IMERIR (fenêtre 2020-09 → 2023-08)…
  assert.strictEqual(ctx.ecoleParDateReset_('2021-05-05_Cours_ULCO Saint-Omer.pdf'), 'IMERIR — Ingénieur MSIR (2020-2023)');
  // …mais le NOM dit ULCO, et c'est lui qui gagne.
  assert.ok(String(ctx.cheminCibleReset_(d, '2021-05-05_Cours_ULCO Saint-Omer.pdf')).indexOf('Archives scolaires/ULCO — DUT GIM') === 0);
  // Et le NOM gagne aussi contre un MARQUEUR de filière : « GIM1 » désigne l'ULCO, « IMERIR » est
  // écrit noir sur blanc. Sans cette assertion, rendre le bloc des marqueurs inconditionnel ne
  // ferait échouer AUCUN test (vérifié par mutation) — la hiérarchie ne serait verrouillée qu'à
  // moitié.
  assert.ok(String(ctx.cheminCibleReset_(d, "2026-07-01_Travail pratique_TP GIM1 réalisé à l'IMERIR.docx"))
    .indexOf('Archives scolaires/IMERIR — Ingénieur MSIR') === 0);
});

test('ADR-0052 D7 — « Modèles & formulaires » a cédé sa place, flux et mission suivent ensemble', () => {
  const d = '03 · Logement & véhicule';
  assert.ok(!ctx.STRUCTURE_CIBLE_RESET[d]['Modèles & formulaires'], 'le nœud n\'existe plus');
  assert.ok(ctx.STRUCTURE_CIBLE_RESET[d]['Travaux & équipements'], 'sa place est prise');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2018-10-15_Formulaire de demande de location_CORPIQ.pdf'), 'Contrats');
  // Les 6 fichiers d'ÉQUIPEMENT réellement à plat au recensement trouvent leur dossier.
  const equipements = [
    '2026-07-06_Document appareil électroménager_Amana.jpg',
    '2026-07-31_Étiquette technique produit_Armstrong_2.jpg',
    '2026-07-06_Liste de matériaux_Matériaux sol salle de bain vinyle céramique APP5 APP6.jpg',
    '2026-07-06_Plan de revêtements de sol_Plan revêtements sol appartements APP5 APP6.jpg',
    '2026-07-01_Rapport de dégradation_Fermec.jpg',
    "2026-07-01_Inventaire d'équipements_Inventaire équipements logement loué cuisine et électroménager.jpg",
  ];
  for (const nom of equipements) {
    assert.strictEqual(ctx.cheminCibleReset_(d, nom), 'Travaux & équipements', nom);
  }
  // La contrainte ≤ 7 tient : 03 a échangé un nœud contre un autre, il n'en a pas gagné.
  assert.strictEqual(Object.keys(ctx.STRUCTURE_CIBLE_RESET[d]).length, 7);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(
    ctx.verifierStructureCibleReset_(ctx.STRUCTURE_CIBLE_RESET, 7))), []);
});

test('ADR-0052 D6 — Sherbrooke CHEVAUCHE l\'ULCO : toute l\'année 2019 est refusée, pas attribuée', () => {
  // Marc : « Cégep de Sherbrooke c'est 2019 en même temps que ULCO ». La fenêtre de Sherbrooke
  // n'est pas là pour placer, elle est là pour EMPÊCHER de placer. Sans elle, 28 documents de 2019
  // partaient chez l'ULCO avec une clé de SUCCÈS — donc sans retour possible, et en silence.
  assert.strictEqual(ctx.ecoleParDateReset_('2019-03-01_TP_Élec.pdf'), null);
  assert.strictEqual(ctx.ecoleParDateReset_('2019-11-01_Notes de cours_Maths.pdf'), null);
  assert.strictEqual(ctx.ecoleParDateReset_('2019_Devoir_Maths.pdf'), null);
  // Les mois voisins, eux, restent attribuables : le chevauchement est borné à 2019.
  assert.strictEqual(ctx.ecoleParDateReset_('2018-11-01_TP_Élec.pdf'), 'ULCO — DUT GIM (2018-2020)');
  assert.strictEqual(ctx.ecoleParDateReset_('2020-03-01_TP_Élec.pdf'), 'ULCO — DUT GIM (2018-2020)');
  // …et un document de 2019 qui NOMME son école va quand même chez elle (le nom est un fait).
  // ⚠️ Égalité STRICTE, et un type que la règle « Diplômes » ne capte pas : la version précédente
  // écrivait `String(...).length > 0`, or `String(null)` vaut « null » — l'assertion ne pouvait
  // PAS échouer, et la valeur réelle n'était même pas l'école (revue flotte).
  const d = '06 · Études & diplômes';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2019-03-01_Travail pratique_Cégep de Sherbrooke.pdf'),
    'Archives scolaires/Cégep de Sherbrooke (2019)/Cours & travaux');
});

test('ADR-0052 D6 — un marqueur de NIVEAU ou de FILIÈRE dans le nom est un FAIT, pas une déduction', () => {
  const d = '06 · Études & diplômes';
  const cas = [
    // Ces 4 noms portent une date HORS de toute fenêtre (2026 = date de réception) : seul le
    // marqueur peut les placer, ce qui prouve qu'il est bien consulté AVANT la date.
    ['2026-07-01_Travail pratique_TP électricité théorème superposition GIM1.docx', 'Archives scolaires/ULCO — DUT GIM (2018-2020)'],
    ['2026-07-01_Devoir_Devoir 1ère année.pdf', 'Archives scolaires/Collège & Lycée — divers (2014-2018)/Cours & travaux'],
    // « svt », « 2nde », « colle » ont été RETIRÉS : contribution NULLE mesurée sur le corpus et
    // risque non nul. Un document qui ne porte qu'une MATIÈRE n'est plus attribué par elle.
    ['2026-07-01_Compte rendu de sortie scolaire_SVT sortie Mare à Goriaux 2nde.pdf', null],
    ['2026-07-01_Notes de cours_Cours de maths.pdf', null], // aucun marqueur, aucune fenêtre
  ];
  // LE cas qui prouve l'ORDRE : ici la DATE et le MARQUEUR se contredisent pour de vrai.
  // Sans lui, déplacer la déduction par date AVANT le bloc de marqueurs laissait les 24 tests
  // verts (mutation jouée par la revue flotte) — le verrou était décoratif.
  assert.strictEqual(ctx.ecoleParDateReset_('2019-05-05_Travail pratique_TP GIM2.docx'), null,
    'pré-condition : 2019 est ambigu, la date ne tranche pas');
  assert.strictEqual(ctx.ecoleParNomReset_('2019-05-05_Travail pratique_TP GIM2.docx'), 'ULCO — DUT GIM (2018-2020)');
  assert.strictEqual(ctx.ecoleParDateReset_('2021-05-05_Travail pratique_TP GIM2.docx'), 'IMERIR — Ingénieur MSIR (2020-2023)',
    'la date dit IMERIR…');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05-05_Travail pratique_TP GIM2.docx'),
    'Archives scolaires/ULCO — DUT GIM (2018-2020)/Cours & travaux', '…mais le marqueur GIM, qui est un FAIT écrit, gagne');
  for (const [nom, attendu] of cas) {
    const cible = ctx.cheminCibleReset_(d, nom);
    if (attendu === null) assert.strictEqual(cible, null, nom);
    else assert.ok(String(cible).indexOf(attendu) === 0, nom + ' → ' + cible);
  }
});

test('ADR-0055 — les libellés d\'école sont EXACTEMENT les dossiers de Marc (relevé Drive du 14/09)', () => {
  // `sousDossier_` résout par `getFoldersByName`, SENSIBLE À LA CASSE et au caractère près : un
  // libellé qui diffère d'une majuscule, d'un accent ou d'un tiret CADRATIN crée un SECOND dossier
  // à côté du vrai, et plus rien ne les réunit. C'est exactement ce qui est arrivé en `03`
  // (« 3987 route des Rivières » vs « 3987 rte des Rivières »).
  // Les 7 enfants d'`Archives scolaires` : les 6 qui restent des 7 que MARC a créés le 29/05/2026
  // (C28-90 fusionne ses deux nœuds collège/lycée en un seul `… (2014-2018)`, à sa demande)
  // + `Cégep de Sherbrooke (2019)`, qu'il a demandé d'ajouter et que le moteur find-or-crée PAR
  // NOM — donc au caractère près, lui aussi.
  const reels = ['Collège & Lycée — divers (2014-2018)',
    'Lycée — Gustave Eiffel — Physique-Chimie (TP)', 'Prépa PTSI (2017-2018)',
    'ULCO — DUT GIM (2018-2020)', 'Cégep de Sherbrooke (2019)',
    'IMERIR — Ingénieur MSIR (2020-2023)', 'Online course — AI Essentials (Google)'];
  const d6 = ctx.STRUCTURE_CIBLE_RESET['06 · Études & diplômes'];
  // La RACINE de `06` ne porte plus AUCUNE école — c'est la demande de Marc, mot pour mot :
  // « continue à rajouter là-dedans au lieu de mettre à la racine du projet ».
  assert.deepStrictEqual(Object.keys(d6).slice().sort(),
    ['Archives scolaires', 'Autres établissements', 'Diplômes & relevés officiels'].sort());
  assert.deepStrictEqual(Object.keys(d6[ctx.RACINE_ARCHIVES_ECOLE_RESET]).slice().sort(),
    reels.slice().sort(), 'un libellé de table absent du Drive créerait un dossier jumeau');
  // Et toute cible rendue par la branche 06 commence par l'un des trois nœuds de la racine…
  const racines = Object.keys(d6);
  for (const nom of CORPUS['06 · Études & diplômes']) {
    const c = ctx.cheminCibleReset_('06 · Études & diplômes', nom);
    if (!c) continue;
    const segs = c.split('/');
    assert.ok(racines.indexOf(segs[0]) !== -1, nom + ' → ' + c);
    // …⚠️ ET, sous `Archives scolaires`, le 2ᵉ segment est un dossier RÉEL de Marc. Sans cette
    // ligne le tripwire était TAUTOLOGIQUE (revue flotte, deux agents indépendamment) : depuis que
    // l'école est passée au 2ᵉ segment, la seule assertion sur le 1ᵉʳ ne peut PLUS échouer, et le
    // libellé littéral d'`ecoleParNomReset_` n'était plus pinné par rien — une mutation de la
    // branche Avila survivait aux 1289 tests, et aurait créé un dossier jumeau au premier document.
    if (segs[0] === ctx.RACINE_ARCHIVES_ECOLE_RESET) {
      assert.ok(reels.indexOf(segs[1]) !== -1, 'école hors du Drive de Marc : ' + nom + ' → ' + c);
    }
  }
  // Le corpus ne contient aucun document « Thérèse d'Avila » : la branche par NOM se pinne donc
  // directement, sinon elle reste le seul libellé sans verrou (revue sécurité, mutation survivante).
  for (const [nom, attendue] of [
    ["2016-03-01_Bulletin scolaire_Lycée Thérèse d'Avila.pdf", 'Collège & Lycée — divers (2014-2018)'],
    ['2018-01-05_Kholle_Gustave Eiffel.pdf', 'Prépa PTSI (2017-2018)'],
    ['2019-05-05_Travail pratique_ULCO Saint-Omer.pdf', 'ULCO — DUT GIM (2018-2020)'],
    ['2021-02-02_Notes de cours_IMERIR.pdf', 'IMERIR — Ingénieur MSIR (2020-2023)'],
    ['2019-03-01_Attestation_Cégep de Sherbrooke.pdf', 'Cégep de Sherbrooke (2019)'],
  ]) {
    assert.strictEqual(ctx.ecoleParNomReset_(nom), attendue, nom);
    assert.ok(reels.indexOf(attendue) !== -1, 'libellé hors du Drive de Marc : ' + attendue);
  }
});

test('ADR-0055 D10 — la campagne ne réorganise jamais l\'intérieur de la structure de Marc', () => {
  // Les trois agents de la revue flotte l'ont trouvé indépendamment, deux en EXÉCUTANT
  // `decisionConsolidation_` : une école NOMMÉE est un signal FORT, donc ni D8 (cible faible) ni
  // D9 (remontée vers un ancêtre) ne mordent entre deux FRÈRES de même profondeur. La
  // consolidation vidait donc `Archives scolaires/IMERIR — …/MFE` dans `…/Cours & travaux`, et
  // `Archives scolaires/Collège & Lycée — divers (2014-2018)` vers `Autres établissements`, à la
  // RACINE du domaine — l'inverse mot pour mot de la demande qui a motivé ADR-0055.
  const d = '06 · Études & diplômes';
  const A = ctx.RACINE_ARCHIVES_ECOLE_RESET + '/';
  const decide = (actuel, nom) => {
    const c = ctx.cheminCibleConsolidation_(d, nom, {});
    return ctx.decisionConsolidation_({
      domaine: d, sousCheminActuel: actuel, sousCheminCible: c.nom, dossierIdCible: c.id,
      cibleFaible: c.faible === true, parentId: null, protege: false, protegeIllisible: false,
      raccourci: false, doublonDe: null,
    });
  };
  // (a) Mouvement LATÉRAL entre sous-dossiers d'une même école : refusé.
  for (const [actuel, nom] of [
    [A + 'IMERIR — Ingénieur MSIR (2020-2023)/MFE — Mémoire de fin d\'études', '2022-05-05_Mémoire_IMERIR.pdf'],
    [A + 'IMERIR — Ingénieur MSIR (2020-2023)/Robotique', '2021-02-02_Travail pratique_IMERIR.pdf'],
    [A + 'ULCO — DUT GIM (2018-2020)/GIM 1 (2018-2019)', '2019-05-05_Notes de cours_TP GIM1.pdf'],
  ]) {
    const dec = decide(actuel, nom);
    assert.strictEqual(dec.action, 'OK', nom + ' → ' + dec.cible);
    assert.strictEqual(dec.cible, d + '/' + actuel);
  }
  // (b) SORTIE de la structure vers la racine du domaine : refusée aussi.
  const sortie = decide(A + 'Collège & Lycée — divers (2014-2018)',
    '2018-03-10_Certificat de scolarité_Collège Gustave Eiffel.pdf');
  assert.strictEqual(sortie.action, 'OK');
  assert.strictEqual(sortie.cible, d + '/' + A + 'Collège & Lycée — divers (2014-2018)');
  // (c) …et un fichier d'un dossier de Marc que le nom rattache à une AUTRE école ne bouge pas non
  // plus : c'est SA décision de rangement, pas celle du moteur.
  const croise = decide(A + 'Lycée — Gustave Eiffel — Physique-Chimie (TP)',
    '2017-11-03_Travail pratique_Gustave Eiffel physique.pdf');
  assert.strictEqual(croise.action, 'OK');
  // (d) CE QUI RESTE PERMIS — l'approfondissement dans SON PROPRE dossier (granularité =
  // enrichissement) et le déménagement ADR-0055 depuis un dossier du MOTEUR.
  assert.strictEqual(decide(A + 'IMERIR — Ingénieur MSIR (2020-2023)',
    '2021-02-02_Notes de cours_IMERIR.pdf').action, 'Déplacer');
  assert.strictEqual(decide('IMERIR', '2021-02-02_Notes de cours_IMERIR.pdf').action, 'Déplacer');
  // (e) La garde est BORNÉE à la structure de Marc : ailleurs dans `06`, rien ne change.
  assert.strictEqual(ctx.estDansStructureMarc_(d, 'IMERIR/Cours & travaux'), false);
  assert.strictEqual(ctx.estDansStructureMarc_(d, ctx.RACINE_ARCHIVES_ECOLE_RESET), false,
    'un fichier posé DANS `Archives scolaires` n\'est rangé dans aucun de ses dossiers');
  assert.strictEqual(ctx.estDansStructureMarc_('03 · Logement & véhicule', A + 'x'), false);
});

test('ADR-0055 — chaque nœud d\'école survit INCHANGÉ à `champ_` (sinon dossier jumeau silencieux)', () => {
  // `segmentsChemin_` assainit CHAQUE segment avant de résoudre le dossier : `_` et les caractères
  // interdits deviennent `-`. Les noms de Marc portent des tirets cadratins, des `&`, des
  // parenthèses et des accents — aucun n'est touché, mais c'est un VERROU, pas une observation.
  // Un `_` glissé dans un libellé créerait `Prépa-PTSI` à côté de `Prépa_PTSI`, sans une erreur.
  const d6 = ctx.STRUCTURE_CIBLE_RESET['06 · Études & diplômes'];
  const noeuds = Object.keys(d6).concat(Object.keys(d6[ctx.RACINE_ARCHIVES_ECOLE_RESET]));
  for (const n of noeuds) {
    assert.strictEqual(ctx.champ_(n), n, 'nom altéré par champ_ : ' + n + ' → ' + ctx.champ_(n));
    // `join` plutôt que `deepStrictEqual` : le tableau vient du bac à sable `vm`, donc d'un
    // AUTRE realm — une comparaison stricte échouerait sur le prototype, pas sur le contenu.
    assert.strictEqual(ctx.segmentsChemin_(n).join('|'), n, 'segment altéré : ' + n);
  }
  // MUTATION : la garde mord bien (un `_` suffit à faire diverger le nom résolu).
  assert.notStrictEqual(ctx.champ_('Prépa_PTSI (2017-2018)'), 'Prépa_PTSI (2017-2018)');
});

test('ADR-0055 — toute école est préfixée `Archives scolaires/`, jamais les deux nœuds de taxonomie', () => {
  const d = '06 · Études & diplômes';
  const prefixe = ctx.RACINE_ARCHIVES_ECOLE_RESET + '/';
  // Une école NOMMÉE, une école DÉDUITE d'une fenêtre, et la branche `Concours` de la prépa :
  // les trois chemins qui produisent une école passent par le même préfixe, posé en UN point.
  for (const nom of ['2021-05-05_Notes de cours_IMERIR.pdf', '2016-03-01_Devoir_Maths.pdf',
    '2018-01-01_Concours_Concours Avenir.pdf', '2019-03-01_Travail pratique_Cégep de Sherbrooke.pdf']) {
    const c = ctx.cheminCibleReset_(d, nom);
    assert.ok(c && c.indexOf(prefixe) === 0, nom + ' → ' + c);
  }
  // …et JAMAIS les deux nœuds de taxonomie du domaine : un diplôme se range par TYPE, un
  // établissement non listé reste à plat. Les préfixer les sortirait de la racine de `06`.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2019-06_Diplôme_Baccalauréat.pdf'), 'Diplômes & relevés officiels');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-09_Convention_Häme University Of Applied Sciences.pdf'),
    'Autres établissements');
});

test('C28-90 — le veto collégial empêche une fenêtre de trancher pour un cégep', () => {
  // Marc a dit « Sherbrooke c'est 2019 » ; le dossier RÉEL contient des fichiers de 2018-08 à
  // 2025-01. Sans veto, 5 documents du corpus partaient chez l'ULCO ou IMERIR avec une clé de
  // SUCCÈS — le mode de panne que la fenêtre de Sherbrooke devait éviter, décalé de trois mois.
  const d = '06 · Études & diplômes';
  for (const nom of ['2020-03-23_Message institutionnel_Direction du Cégep.jpg',
    '2020-11-20_Avis de suspension d\'épreuve_Direction du Cégep.jpg',
    '2020-10-20_Message MIO_Jérémie Côté.jpg',
    '2023-08-25_Horaire scolaire_Centre de services scolaire Marie-Victorin.pdf']) {
    assert.ok(ctx.vetoCollegialReset_(nom), 'veto attendu : ' + nom);
    assert.strictEqual(ctx.cheminCibleReset_(d, nom), null, nom);
  }
  // …mais le veto ne bloque QUE la déduction : un document qui NOMME Sherbrooke y va toujours.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2020-04-03_Correspondance_Cégep de Sherbrooke.jpg'),
    'Archives scolaires/Cégep de Sherbrooke (2019)');
  // …et il ne touche à rien hors de 06.
  assert.strictEqual(ctx.vetoCollegialReset_('2020-01-01_Facture_Hydro-Québec.pdf'), false);
});

test("C28-90 — une école DÉDUITE d'une fenêtre ne sort jamais un fichier de son dossier", () => {
  // Le corpus réel ne peut pas exercer ce cas (tous les fichiers déjà rangés sous une école
  // NOMMENT leur école), mais le scénario est plausible dès qu'un document de cégep sans son nom
  // est classé à la main : la fenêtre dirait « lycée » et le sortirait de « Cégep de Sherbrooke ».
  const d = '06 · Études & diplômes';
  const nom = '2016-03-01_Devoir_Maths.pdf'; // 2016 → fenêtre du lycée, et AUCUN nom d'école
  assert.strictEqual(ctx.ecoleParNomReset_(nom), null, 'pré-condition : rien dans le nom');
  const cible = ctx.cheminCibleConsolidation_(d, nom, {});
  assert.strictEqual(cible.faible, true, 'une école déduite est un signal FAIBLE');
  const dec = ctx.decisionConsolidation_({
    domaine: d, sousCheminActuel: 'Archives scolaires/Cégep de Sherbrooke (2019)', sousCheminCible: cible.nom,
    dossierIdCible: cible.id, cibleFaible: cible.faible === true,
    parentId: null, protege: false, protegeIllisible: false, raccourci: false, doublonDe: null,
  });
  assert.strictEqual(dec.action, 'OK', "le fichier reste où Marc l'a mis");
  // …mais le même document À LA RACINE est bien placé : la fenêtre garde tout son pouvoir là où il
  // n'y a rien à contredire.
  assert.strictEqual(ctx.decisionConsolidation_({
    domaine: d, sousCheminActuel: '', sousCheminCible: cible.nom, dossierIdCible: '',
    cibleFaible: true, parentId: null, protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null,
  }).action, 'Déplacer');
});


test('ADR-0056 D11 — la racine d\'un domaine EN COURS DE RE-DATATION ne se vide pas sous la campagne', () => {
  // 🔴 revue code ADR-0056. `REANALYSE_RACINE_SEULE` borne la campagne aux fichiers à plat ; mais la
  // consolidation passe AVANT elle dans le tick, avec 24 min/j contre 8, en pure I/O — des dizaines
  // de fichiers/minute contre 16 à 24 par JOUR. Et D8 ne protège explicitement PAS les fichiers à
  // plat (c'est le but d'ADR-0052). Sans D11, elle emporte les 328 fichiers classés sur leur date
  // FAUSSE (la date de réception — ce que la campagne existe pour corriger), la passe suivante
  // collecte 0, et la campagne écrit « terminée ✅ » sans avoir rien re-daté.
  const d = '06 · Études & diplômes';
  const base = {
    domaine: d, sousCheminCible: 'Autres établissements', dossierIdCible: 'ID_AUTRES',
    cibleFaible: false, parentId: null, protege: false, protegeIllisible: false,
    raccourci: false, doublonDe: null,
  };
  // (a) À PLAT + re-datation en cours ⇒ on ne bouge pas, et la RAISON le dit.
  const garde = ctx.decisionConsolidation_(
    Object.assign({}, base, { sousCheminActuel: '', reDatationEnCours: true }));
  assert.strictEqual(garde.action, 'OK');
  assert.strictEqual(garde.cible, d);
  assert.match(garde.raison, /D11/);
  // (b) MÊME cas, re-datation finie ⇒ ADR-0052 reprend la main. La garde RETARDE, elle n'annule pas.
  const apres = ctx.decisionConsolidation_(
    Object.assign({}, base, { sousCheminActuel: '', reDatationEnCours: false }));
  assert.strictEqual(apres.action, 'Déplacer');
  assert.strictEqual(apres.cible, d + '/Autres établissements');
  // (c) D11 ne protège QUE la racine : un fichier déjà dans un sous-dossier n'est pas concerné par
  //     elle (il a ses propres gardes, D8/D9/D10) — sinon elle gèlerait TOUT le domaine pendant
  //     14 à 21 jours, y compris des mouvements qui n'ont rien à voir avec la date.
  //     ⚠️ Le cas doit ATTEINDRE D11 pour prouver quelque chose : une source qui est un SOUS-CHEMIN
  //     de la cible est interceptée plus haut (« déjà dans le bon sous-arbre »), et la mutation
  //     « D11 sans la borne de racine » y survivrait — c'est ce qui est arrivé au premier jet.
  const sousDossier = ctx.decisionConsolidation_(Object.assign({}, base, {
    sousCheminActuel: 'Diplômes & relevés officiels', sousCheminCible: 'Autres établissements',
    reDatationEnCours: true,
  }));
  assert.ok(!/D11/.test(sousDossier.raison), 'D11 ne doit pas mordre hors de la racine : ' + sousDossier.raison);
});

test('ADR-0056 D11 — le prédicat est BORNÉ aux cibles de la campagne, et échoue OUVERT', () => {
  // Le domaine doit être dans `REANALYSE_CIBLES` : sinon D11 gèlerait la racine de TOUS les
  // domaines dès qu'une campagne tourne quelque part. Et la lecture qui LÈVE rend `false` (échec
  // ouvert VOULU) : le pire cas est alors ce qui se passait avant ce lot — des fichiers classés sur
  // une date fausse, récupérables — jamais un blocage définitif du rangement sur un blip Properties.
  const cible = (CONFIG) => CONFIG.REANALYSE_CIBLES[0];
  const props = { DriveAI_REANALYSE: null };
  const c = load(['Config.gs', 'Migration.gs'], {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
  });
  assert.strictEqual(c.reDatationEnCours_(cible(c.CONFIG)), true, 'campagne non convergée');
  assert.strictEqual(c.reDatationEnCours_('02 · Finances'), false, 'hors REANALYSE_CIBLES');
  // Campagne convergée ⇒ la garde se lève TOUTE SEULE (chemin de retour, jamais un délai).
  const c2 = load(['Config.gs', 'Migration.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => c.CONFIG.REANALYSE_TAG }),
    },
  });
  assert.strictEqual(c2.reDatationEnCours_(cible(c2.CONFIG)), false, 'convergée ⇒ D11 se lève');
  // Lecture qui LÈVE ⇒ false (échec ouvert assumé, testé pour qu'il reste une décision).
  const c3 = load(['Config.gs', 'Migration.gs'], {
    PropertiesService: { getScriptProperties: () => { throw new Error('blip'); } },
  });
  assert.strictEqual(c3.reDatationEnCours_(cible(c3.CONFIG)), false);
});
