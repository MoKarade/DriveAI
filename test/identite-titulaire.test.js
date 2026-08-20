'use strict';
/**
 * DOCUMENTS D'IDENTITÉ & TITULAIRE (refonte 2026-07-07, demande Marc) — les pièces d'identité se
 * rangent PAR TYPE (dossier « Passeport »/« Permis de conduire »…) contenant Marc ET les autres, le
 * nom de la PERSONNE dans le fichier. Pas de dossier « Tiers ». Anti-écrasement pour ne jamais perdre
 * deux pièces distinctes qui porteraient le même nom. Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

/* ---------- normaliserTypeIdentite_ : un type = un dossier partagé ---------- */

test('normaliserTypeIdentite_ : variantes → forme canonique (dossier partagé par tous les titulaires)', () => {
  assert.strictEqual(ctx.normaliserTypeIdentite_('PASSEPORT'), 'Passeport');
  assert.strictEqual(ctx.normaliserTypeIdentite_('passport'), 'Passeport');
  assert.strictEqual(ctx.normaliserTypeIdentite_('permis'), 'Permis de conduire');
  assert.strictEqual(ctx.normaliserTypeIdentite_('Permis de conduire'), 'Permis de conduire');
  assert.strictEqual(ctx.normaliserTypeIdentite_('acte de naissance'), 'Acte de naissance');
  assert.strictEqual(ctx.normaliserTypeIdentite_('carte d\'assurance maladie'), 'Carte d’assurance maladie');
});

/* ---------- estDocumentIdentitePersonnel_ ---------- */

test('estDocumentIdentitePersonnel_ : vrai seulement pour une pièce d\'identité reconnue', () => {
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'Passeport' }), true);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'permis' }), true);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: false }), false);
  assert.strictEqual(ctx.estDocumentIdentitePersonnel_({ estDocumentIdentite: true, sousDossierType: 'Facture' }), false);
});

/* ---------- dossierIdentite_ : par type, jamais par personne ---------- */

test('dossierIdentite_ : domaine + sous-dossier de type (statut → 04, assurance maladie → 07)', () => {
  assert.deepStrictEqual(plat(ctx.dossierIdentite_({ sousDossierType: 'Passeport' })),
    { domaine: '01 · Administratif & identité', sousDossier: 'Passeport' });
  assert.deepStrictEqual(plat(ctx.dossierIdentite_({ sousDossierType: 'Carte de résident permanent' })),
    { domaine: '04 · Immigration', sousDossier: 'Carte de résident permanent' });
  assert.strictEqual(ctx.dossierIdentite_({ sousDossierType: 'ramq' }).domaine, '07 · Santé');
});

/* ---------- titulairePourNom_ : Marc y est VALIDE (contrairement à l'entité) ---------- */

test('titulairePourNom_ : nom de personne en Casse Titre, même depuis de l\'ALL-CAPS ; null si absent', () => {
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: 'MARC RICHARD' }), 'Marc Richard');
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: 'Baptiste Julien Patrick Richard' }), 'Baptiste Julien Patrick Richard');
  assert.strictEqual(ctx.titulairePourNom_({ titulaire: '' }), null);
  assert.strictEqual(ctx.titulairePourNom_({}), null);
});

/* ---------- nommerDocument_ : l'aiguillage titulaire vs émetteur ---------- */

test('nommerDocument_ : pièce d\'identité → titulaire dans le nom (Marc ET les autres, même dossier)', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Marc Richard', date_doc: '2019-09-17' }, '2026-07-07', '.pdf'),
    '2019-09-17_Passeport_Marc Richard.pdf');
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Sophie Tremblay', date_doc: '2020-01-01' }, '2026-07-07', '.pdf'),
    '2020-01-01_Passeport_Sophie Tremblay.pdf');
});

test('nommerDocument_ : document normal → émetteur ; date absente → date de réception', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture', emetteur: 'Hydro-Québec', date_doc: '2026-03-01' }, '2026-07-07', '.pdf'),
    '2026-03-01_Facture_Hydro-Québec.pdf');
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture', emetteur: 'Hydro-Québec' }, '2026-07-07', '.pdf'),
    '2026-07-07_Facture_Hydro-Québec.pdf');
});

test('nommerDocument_ : émetteur ET titulaire absents → « …_Type.ext » (jamais un blocage, jamais _Inconnu)', () => {
  assert.strictEqual(
    ctx.nommerDocument_({ type_doc: 'Facture' }, '2026-03-01', '.pdf'), '2026-03-01_Facture.pdf'); // règle v2 : jamais « _Inconnu »
  assert.strictEqual(
    ctx.nommerDocument_({ estDocumentIdentite: true, sousDossierType: 'Passeport' }, '2026-03-01', '.pdf'),
    '2026-03-01_Passeport.pdf'); // pièce d'identité sans titulaire lisible : pas de « _Inconnu »
});

/* ---------- garantirNomUnique_ : jamais d'écrasement ---------- */

test('garantirNomUnique_ : insère un suffixe si le nom existe déjà (deux pièces distinctes, pas des doublons)', () => {
  assert.strictEqual(ctx.garantirNomUnique_('2020_Passeport.pdf', ['2020_Passeport.pdf']), '2020_Passeport_2.pdf');
  assert.strictEqual(ctx.garantirNomUnique_('2020_Passeport.pdf', ['2020_Passeport.pdf', '2020_Passeport_2.pdf']), '2020_Passeport_3.pdf');
  assert.strictEqual(ctx.garantirNomUnique_('a.pdf', []), 'a.pdf');
});

/* ---------- nommerDocument_ v2 : descripteur (jamais « Inconnu ») + sousDossierPourNom_ ---------- */

test('nommerDocument_ : émetteur > descripteur > type seul — JAMAIS « Inconnu »', () => {
  // émetteur présent
  assert.strictEqual(ctx.nommerDocument_({ type_doc: 'Facture', emetteur: 'Hydro-Québec' }, '2026-03-01', '.pdf'),
    '2026-03-01_Facture_Hydro-Québec.pdf');
  // pas d'émetteur → descripteur
  assert.strictEqual(ctx.nommerDocument_({ type_doc: 'Notes de maintenance', descripteur: 'ligne robot Robovic' }, '2026-06-15', '.jpg'),
    '2026-06-15_Notes de maintenance_ligne robot Robovic.jpg');
  // ni émetteur ni descripteur → type seul, jamais « _Inconnu »
  const n = ctx.nommerDocument_({ type_doc: 'Rapport' }, '2026-06-16', '.pdf');
  assert.strictEqual(n, '2026-06-16_Rapport.pdf');
  assert.ok(!/inconnu/i.test(n));
});

test('sousDossierPourNom_ (ADR-0023 révisé) : identité → type ; CANDIDAT d\'entité = champ sousDossier gaté ; sinon vide', () => {
  // pièce d'identité → type (l'exception au « à plat », inchangée)
  assert.strictEqual(ctx.sousDossierPourNom_({ estDocumentIdentite: true, sousDossierType: 'Passeport' }), 'Passeport');
  // candidat d'entité = le champ `sousDossier` (gaté « majeure » par le prompt v2), canonisé
  assert.strictEqual(ctx.sousDossierPourNom_({ sousDossier: 'IUT du Littoral' }), 'IUT Du Littoral');
  assert.strictEqual(ctx.sousDossierPourNom_({ sousDossier: 'Desjardins Inc.' }), 'Desjardins');
  // le champ `entite` (RICHE, non gaté — rempli même pour un émetteur ponctuel) ne route JAMAIS :
  // router dessus ferait revenir le dossier-par-émetteur (revue structure-keeper C28-26)
  assert.strictEqual(ctx.sousDossierPourNom_({ entite: 'Hydro-Québec' }), '');
  // un ÉMETTEUR seul non plus (l'ancien repli fabriquait un dossier par marchand)
  assert.strictEqual(ctx.sousDossierPourNom_({ emetteur: 'IUT du Littoral' }), '');
  // une CATÉGORIE dans sousDossier est filtrée par le lexique générique (double filet sous le prompt)
  assert.strictEqual(ctx.sousDossierPourNom_({ sousDossier: 'Cours', type_doc: 'Notes de cours' }), '');
  // rien → vide, plus jamais un dossier de type ni « Divers »
  assert.strictEqual(ctx.sousDossierPourNom_({ type_doc: 'Devoir' }), '');
  assert.strictEqual(ctx.sousDossierPourNom_({}), '');
});

/* ---------- REPLI quand la table REFUSE d'attribuer (C28-72) ---------- */

test('repliIdentite_ : dans 01, on dégrade DANS `Pièces d\'identité` — jamais vers un frère de niveau 1', () => {
  const c = ctx;
  // `01 · Administratif/Permis de conduire` est né comme ça le 2026-08-12 : la table a rendu null
  // (permis d'un tiers non déclaré, refus VOULU) et le repli a créé un dossier de TYPE au niveau 1
  // du domaine, à côté de `Pièces d'identité`. Il ne contient qu'un document de tiers.
  // NB : tous ces types n'atteignent pas forcément le repli via `planRoutageV2_` — la table route
  // `Acte de naissance` vers `État civil & notarial` et `Certificat de citoyenneté` vers
  // `Attestations & certificats`. On teste ici la fonction PURE, pas son atteignabilité : c'est de
  // la défense en profondeur, et le dire évite de croire ce code porteur d'un garde-fou.
  ['Passeport', 'Permis de conduire', 'Carte d’identité', 'Acte de naissance'].forEach((t) => {
    const di = c.dossierIdentite_({ sousDossierType: t });
    assert.strictEqual(c.repliIdentite_(di), 'Pièces d\'identité',
      t + ' : le repli doit rester dans le conteneur canonique');
  });
});

test('repliIdentite_ : 04 et 07 atterrissent sur LEUR nœud de table, jamais sur un type de niveau 1', () => {
  const c = ctx;
  // Branches MORTES aujourd'hui (`nommerDocument_` produit un nom que la table sait router) — on les
  // verrouille pour qu'elles le restent SANS DANGER : l'ancien repli aurait créé
  // `07 · Santé/Carte d'assurance maladie` au niveau 1, hors table, sur la seule place libre de 07.
  const res = c.dossierIdentite_({ sousDossierType: 'Carte de résident permanent' });
  assert.strictEqual(res.domaine, '04 · Immigration');
  assert.strictEqual(c.repliIdentite_(res), 'Résidence permanente');
  const ram = c.dossierIdentite_({ sousDossierType: 'ramq' });
  assert.strictEqual(ram.domaine, '07 · Santé');
  assert.strictEqual(c.repliIdentite_(ram), 'Assurances santé');
});

test('INVARIANT : chaque repli d\'identité EXISTE dans STRUCTURE_CIBLE_RESET (jamais un libellé recopié à la main)', () => {
  // La résolution se fait par NOM : un libellé qui dérive de la table ferait naître un dossier
  // JUMEAU (vécu : « 3987 route des Rivières » à côté de « 3987 rte des Rivières »). Et un nœud hors
  // table est invisible de `verifierStructureCibleReset_`, donc du plafond ≤ 7.
  const t = require('./harness').load(['Config.gs', 'Reset.gs']);
  const carte = ctx.REPLI_IDENTITE_PAR_DOMAINE;
  const domaines = Object.keys(carte);
  assert.ok(domaines.length >= 3, 'les trois domaines d\'identité sont couverts');
  domaines.forEach((d) => {
    const noeuds = t.STRUCTURE_CIBLE_RESET[d];
    assert.ok(noeuds, 'domaine absent de la table : ' + d);
    assert.ok(Object.prototype.hasOwnProperty.call(noeuds, carte[d]),
      'le repli « ' + carte[d] + ' » de ' + d + ' n\'existe pas dans STRUCTURE_CIBLE_RESET');
  });
});

test('INVARIANT : un repli est MONO-SEGMENT — un `/` deviendrait un tiret dans le nom du dossier', () => {
  // La branche repli de `deciderRoutageV2_` ne découpe pas : elle passe par `champ_`, qui remplace
  // `/` par `-`. Un repli « Pièces d'identité/Autres » créerait un dossier littéralement nommé
  // `Pièces d'identité-Autres`, frère du vrai. Rien dans le code ne l'interdit — sauf ce test.
  Object.keys(ctx.REPLI_IDENTITE_PAR_DOMAINE).forEach((d) => {
    assert.ok(ctx.REPLI_IDENTITE_PAR_DOMAINE[d].indexOf('/') === -1,
      'repli multi-segments pour ' + d + ' : ' + ctx.REPLI_IDENTITE_PAR_DOMAINE[d]);
  });
});

test('INVARIANT : dossierIdentite_ ne peut produire AUCUN domaine hors de la carte de repli', () => {
  // Sans ça, un futur type d'identité routé vers un 4e domaine retomberait sur `|| di.sousDossier`,
  // c'est-à-dire le dossier de TYPE au niveau 1 — le défaut qu'on vient de retirer, réintroduit par
  // la porte de derrière.
  const vus = {};
  ctx.TYPES_IDENTITE.forEach((t) => { vus[ctx.dossierIdentite_({ sousDossierType: t }).domaine] = true; });
  Object.keys(vus).forEach((d) => {
    assert.ok(Object.prototype.hasOwnProperty.call(ctx.REPLI_IDENTITE_PAR_DOMAINE, d),
      'domaine « ' + d + ' » produit par dossierIdentite_ mais absent de REPLI_IDENTITE_PAR_DOMAINE');
  });
});

test('repliIdentite_ : absence d\'identité → chaîne vide (jamais une exception dans le chemin de repli)', () => {
  assert.strictEqual(ctx.repliIdentite_(null), '');
});

test('INVARIANT type↔table : la TABLE sait router CHAQUE type d\'identité — sinon l\'ajout du type seul est inerte', () => {
  // C'est le verrou qui manquait (prouvé par mutation : retirer « numero d assurance sociale » de
  // `cheminCibleReset_` ne cassait AUCUN test, alors que le NAS serait tombé au repli). Ajouter un
  // type à `TYPES_IDENTITE` sans l'ajouter à la table, c'est livrer une moitié de règle : le flux
  // reconnaîtrait le document, la table ne saurait pas où le mettre. « Une seule règle, deux
  // consommateurs » vaut aussi pour un ajout de VOCABULAIRE, pas seulement pour un refactoring.
  const t = require('./harness').load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs',
    'Missions.gs', 'Router.gs']);
  t.TYPES_IDENTITE.forEach((type) => {
    const di = t.dossierIdentite_({ sousDossierType: type });
    const nom = '2024-01-17_' + type + '_Service Canada.pdf';
    const cible = t.cheminCibleReset_(di.domaine, nom);
    assert.ok(cible, 'la table ne route PAS « ' + type +' » dans ' + di.domaine +
      ' : le document tomberait au repli au lieu de sa vraie place');
  });
});

test('NAS : graphies reconnues, et `naissance`/`Thomas` NE matchent PAS (borne de mot)', () => {
  const c = ctx;
  ['NAS', 'nas', 'NAS_JUILLET2025', 'numéro d\'assurance sociale', 'SIN'].forEach((g) => {
    assert.strictEqual(c.normaliserTypeIdentite_(g), 'Numéro d’assurance sociale', 'graphie : ' + g);
  });
  // `nas` en SOUS-CHAÎNE attraperait « naissance » et « Thomas » — d'où la borne de mot.
  assert.strictEqual(c.normaliserTypeIdentite_('Acte de naissance'), 'Acte de naissance');
  assert.strictEqual(c.normaliserTypeIdentite_('Thomas'), 'Thomas');
});
