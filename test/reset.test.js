'use strict';
/**
 * RESET C28-33 (ADR-0030) — partie PURE (PR1) : la structure cible respecte « ≤ 7 par niveau,
 * récursif » (contrainte DÉRIVÉE de la table, jamais d'une valeur du jour), le routage par le NOM
 * envoie les fichiers RÉELS de l'inventaire 2026-07-29 vers des nœuds EXISTANTS de la table, un nom
 * non routable rend null (le fichier RESTE dans `_TRI 2026` — jamais deviné), et les artefacts du
 * moteur sont exclus. Les campagnes I/O (rassemblement/dédup/placement/04 interne) = PR2.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Entites.gs : normaliserCle_ ; Consolidation.gs : analyserNomClasse_ — dépendances RÉELLES du
// routage (pas de stub : c'est le contrat inter-module qu'on teste).
const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs']);
const MAX = 7;

/* ---------- Structure cible : ≤ 7 partout, dérivé de la table ---------- */

test('STRUCTURE_CIBLE_RESET : aucun niveau ne dépasse 7 sous-dossiers (récursif) — la demande de Marc', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(
    ctx.verifierStructureCibleReset_(ctx.STRUCTURE_CIBLE_RESET, MAX))), []);
  // Les 9 domaines validés sont tous là (dont 04, restructurée en INTERNE — ADR-0030 §4).
  assert.strictEqual(Object.keys(ctx.STRUCTURE_CIBLE_RESET).length, 9);
  assert.ok(ctx.STRUCTURE_CIBLE_RESET['04 · Immigration']);
});

test('verifierStructureCibleReset_ : détecte bien une violation (le validateur mord)', () => {
  const trop = {};
  for (let i = 0; i < MAX + 1; i++) trop['d' + i] = {};
  const v = JSON.parse(JSON.stringify(ctx.verifierStructureCibleReset_({ X: trop }, MAX)));
  assert.strictEqual(v.length, 1);
  assert.match(v[0], /^X : 8 sous-dossiers$/);
});

/* ---------- Toute cible routée EXISTE dans la table (jamais un chemin inventé) ---------- */

function cibleExiste(domaine, chemin) {
  // Chemin dynamique autorisé : Pièces d'identité/Autres/<personne> (le parent doit exister).
  const segs = chemin.split('/');
  let noeud = ctx.STRUCTURE_CIBLE_RESET[domaine];
  for (let i = 0; i < segs.length; i++) {
    if (noeud[segs[i]] === undefined) {
      return i === segs.length - 1 && segs.slice(0, i).join('/') === 'Pièces d\'identité/Autres';
    }
    noeud = noeud[segs[i]];
  }
  return true;
}

// Noms RÉELS relevés par l'inventaire (12 agents, 2026-07-29) : [domaine d'origine, nom, cible attendue].
const CAS = [
  // 01 — identité par personne (Marc par défaut : l'émetteur est souvent l'AUTORITÉ, pas le titulaire)
  ['01 · Administratif & identité', '2020-01-01_Passeport_Marc Richard.pdf', 'Pièces d\'identité/Marc'],
  ['01 · Administratif & identité', '2017-04-19_Carte nationale d\'identité_Préfecture du Nord_2.pdf', 'Pièces d\'identité/Marc'],
  ['01 · Administratif & identité', '2019-02-01_Passeport_Francine Richard.pdf', 'Pièces d\'identité/Autres/Francine Richard'],
  ['01 · Administratif & identité', '2022-09-01_Carte d\'identité_Léandre LABYT.jpg', 'Pièces d\'identité/Autres/Léandre LABYT'],
  ['01 · Administratif & identité', '2021-03-15_Acte de naissance_Mairie de Lille.pdf', 'État civil & notarial'],
  ['01 · Administratif & identité', '2021-01-06_Attestation titulaire de contrat_EDF.pdf', 'Attestations & certificats'],
  ['01 · Administratif & identité', '2024-02-01_Contrat_ENGIE.pdf', 'Contrats & fournisseurs/ENGIE'],
  ['01 · Administratif & identité', '2023-05-10_Lettre_Préfecture Du Nord.pdf', 'Correspondance'],
  // 02 — relevés par année (bucket dérivé du nœud : hors liste → Archives)
  ['02 · Finances', '2026-03_Relevé_Desjardins.pdf', 'Relevés/2026'],
  ['02 · Finances', '2015-01_Relevé_CIC.pdf', 'Relevés/Archives'],
  ['02 · Finances', '2026-01-10_Facture_Cleverbridge.pdf', 'Reçus & factures/2026'],
  ['02 · Finances', '2019-06_Reçu_Hifi & Foto Koch.pdf', 'Reçus & factures/Archives'],
  ['02 · Finances', '2025-05_Avis d\'imposition_Revenu Québec.pdf', 'Impôts & déclarations'],
  ['02 · Finances', '2024-01_Contrat_Desjardins Securities.pdf', 'Placements & crypto'],
  ['02 · Finances', '2022-08_Attestation_Boursorama Banque.pdf', 'Banques/Boursorama'],
  ['02 · Finances', '2010-04_Courrier_Lyonnaise De Banque.pdf', 'Banques/Banques France'],
  // 03 — logements par entité (dont le 3325 4e Avenue = LCP, amendement Marc)
  ['03 · Logement & véhicule', '2024-05_Bail_1548 avenue de la Roselière.pdf', 'Logements/1548 avenue de la Roselière'],
  ['03 · Logement & véhicule', '2025-07_Quittance_LCP Groupe Immobilier.pdf', 'Logements/3325 4e Avenue (LCP Groupe Immobilier)'],
  ['03 · Logement & véhicule', '2023-01_Facture_KIA Québec.pdf', 'Véhicules/KIA'],
  ['03 · Logement & véhicule', '2026-02_Facture_ENGIE.pdf', 'Énergie & services'],
  // 04 — routage INTERNE seulement ; un doc étranger (banque CIC) rend null = reste EN PLACE + rapport
  ['04 · Immigration', '2024-11_Permis de travail_IRCC.pdf', 'Permis de travail & EIMT'],
  ['04 · Immigration', '2025-02_Lettre_Immigration, Réfugiés Et Citoyenneté Canada.pdf', 'IRCC (fédéral)'],
  ['04 · Immigration', '2023-09_Demande_Ministère De l\'Immigration, De La Francisation Et De l\'Intégration (MIFI).pdf', 'MIFI (Québec)'],
  ['04 · Immigration', '2015-01_Relevé_CIC Nord Ouest.pdf', null],
  // 05 — Employeurs = Robovic + Automatech SEULS (décision Marc) ; le reste = recherche d'emploi
  ['05 · Carrière', '2026-06_Bulletin de paie_Robovic.pdf', 'Employeurs/Robovic'],
  ['05 · Carrière', '2024-03_Contrat de travail_AUTOMATECH ROBOTIK INC..pdf', 'Employeurs/Automatech'],
  ['05 · Carrière', '2026-01-05_Lettre_Schneider Electric.pdf', 'Recherche d\'emploi'],
  ['05 · Carrière', '2022-02_Candidature_Arkema Honfleur.pdf', 'Recherche d\'emploi/Candidatures'],
  ['05 · Carrière', 'CV — Marc Richard (modifiable)', 'CV & lettres'],
  ['05 · Carrière', 'Suivi recherche emploi - Québec', 'Recherche d\'emploi/Suivi'],
  // 06 — par ÉCOLE (liste de Marc), diplômes transverses, profs de prépa rattachés à la prépa
  ['06 · Études & diplômes', '2019-06_Diplôme_Baccalauréat.pdf', 'Diplômes & relevés officiels'],
  ['06 · Études & diplômes', '2021-01_Relevé de notes_ULCO.pdf', 'Diplômes & relevés officiels'],
  ['06 · Études & diplômes', '2020-11_Kholle_Mr Têtard.pdf', 'Prépa Gustave Eiffel (PTSI)/Examens & khôlles'],
  ['06 · Études & diplômes', '2022-03_TP_IUT Du Littoral Côte d\'Opale.pdf', 'DUT ULCO Saint-Omer/Cours & travaux'],
  ['06 · Études & diplômes', '2024-09_Attestation_Cégep de Sherbrooke.pdf', 'Cégep de Sherbrooke/Administratif'],
  ['06 · Études & diplômes', '2023-05_Projet_IMERIR.pdf', 'IMERIR/Cours & travaux'],
  ['06 · Études & diplômes', '2021-09_Convention_Häme University Of Applied Sciences.pdf', 'Autres établissements'],
  // 07 — validé tel quel par Marc
  ['07 · Santé', '2025-04-09_Facture_Prelib - Centre de prévention en santé sexuelle Inc..pdf', 'Factures & reçus'],
  ['07 · Santé', '2024-10_Compte rendu_Docteur Régine Braouezec.pdf', 'Médecins & consultations'],
  ['07 · Santé', '2020-02_Attestation_CNAM.pdf', 'Assurances santé'],
  // 08
  ['08 · Perso & projets', '2024-03_Note_Idées de projets.md', 'Notes'],
  ['08 · Perso & projets', '2023-08_Schéma_Alimentation 12V.pdf', 'Schémas & technique'],
  ['08 · Perso & projets', '2022-12_Mémoire_Rédaction finale.docx', 'Écrits & rédactions'],
  // 09 — réservations par année ; compagnies « de voyage ciblé » → Par voyage
  ['09 · Voyages', '2023-08-07_Confirmation de réservation_Air Canada.pdf', 'Réservations & billets/Archives'],
  ['09 · Voyages', '2025-06-03_Confirmation de réservation_Air Canada.pdf', 'Réservations & billets/2025'],
  ['09 · Voyages', '2025-01-20_Confirmation de réservation_PeruRail.pdf', 'Par voyage/Pérou'],
  ['09 · Voyages', '2024-08-01_Contrat d\'assurance_Manuvie.pdf', 'Assurances voyage'],
  ['09 · Voyages', '2026-07-01_Document de voyage_Document relatif à New York juillet 2026.jpg', 'Par voyage/New York'],
];

test('cheminCibleReset_ : les noms RÉELS de l\'inventaire routent vers la cible attendue', () => {
  for (const [dom, nom, attendu] of CAS) {
    const obtenu = ctx.cheminCibleReset_(dom, nom);
    assert.strictEqual(obtenu, attendu, dom + ' | ' + nom + ' → ' + obtenu + ' (attendu ' + attendu + ')');
  }
});

test('cheminCibleReset_ : toute cible NON nulle du jeu de cas existe dans la table (jamais un chemin inventé)', () => {
  for (const [dom, nom] of CAS) {
    const chemin = ctx.cheminCibleReset_(dom, nom);
    if (chemin !== null) assert.ok(cibleExiste(dom, chemin), dom + ' | ' + nom + ' → cible absente de la table : ' + chemin);
  }
});

test('cheminCibleReset_ : non routable → null (reste en _TRI, jamais deviné) ; domaine inconnu → null', () => {
  assert.strictEqual(ctx.cheminCibleReset_('08 · Perso & projets', 'IMG_20240101_123456.jpg'), null);
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', 'sans-nom-classe.bin'), null);
  assert.strictEqual(ctx.cheminCibleReset_('99 · Inconnu', '2026-01_Facture_EDF.pdf'), null);
});

test('identité 01 : personne INCONNUE → null (jamais devinée chez Marc) ; autorité/Marc → Marc (revue PR1)', () => {
  const d = '01 · Administratif & identité';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05_Passeport_Sophie Durand.pdf'), null,
    'proche non listé : reste en _TRI au rapport, jamais dans le dossier de Marc');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-06_Permis de conduire_SAAQ.pdf'), 'Pièces d\'identité/Marc');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2020-01-01_Passeport_Marc Richard.pdf'), 'Pièces d\'identité/Marc');
});

test('05 : motif « ute » EXACT seulement — un émetteur qui le contient par hasard reste non routé (revue PR1)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2024-01_Lettre_Communauté Métropolitaine.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2019-05_Lettre_UTE.pdf'), 'Recherche d\'emploi');
});

test('06 : la table des écoles se construit depuis SOUS_DOSSIERS_ECOLE_RESET (une seule source, revue PR1)', () => {
  const table = JSON.parse(JSON.stringify(ctx.STRUCTURE_CIBLE_RESET['06 · Études & diplômes']));
  const attendu = JSON.parse(JSON.stringify(ctx.SOUS_DOSSIERS_ECOLE_RESET));
  for (const ecole of ['Lycée Thérèse d\'Avila', 'DUT ULCO Saint-Omer', 'Cégep de Sherbrooke', 'IMERIR']) {
    assert.deepStrictEqual(Object.keys(table[ecole]), attendu, ecole);
  }
  assert.deepStrictEqual(Object.keys(table['Prépa Gustave Eiffel (PTSI)']), attendu.concat(['Concours']));
});

test('estExcluDuReset_ : artefacts du moteur jamais touchés ; documents normaux jamais exclus', () => {
  assert.strictEqual(ctx.estExcluDuReset_('DriveAI — État'), true);
  assert.strictEqual(ctx.estExcluDuReset_('DriveAI — Corriger un classement'), true);
  assert.strictEqual(ctx.estExcluDuReset_('Rapports agent — tri Gmail'), true);
  assert.strictEqual(ctx.estExcluDuReset_('00 · Guide de rangement (lis-moi)'), true);
  assert.strictEqual(ctx.estExcluDuReset_('2026-01_Facture_EDF.pdf'), false);
  assert.strictEqual(ctx.estExcluDuReset_(''), false);
});
