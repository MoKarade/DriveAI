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
const ctx = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
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
  // Dérivé de MAX (leçon §7 : jamais une valeur du jour en dur dans un test paramétré par la constante).
  assert.match(v[0], new RegExp('^X : ' + (MAX + 1) + ' sous-dossiers$'));
});

/* ---------- Toute cible routée EXISTE dans la table (jamais un chemin inventé) ---------- */

function cibleExiste(domaine, chemin) {
  // Chemin dynamique autorisé : Pièces d'identité/Autres/<personne> (le parent doit exister).
  const segs = chemin.split('/');
  let noeud = ctx.STRUCTURE_CIBLE_RESET[domaine];
  for (let i = 0; i < segs.length; i++) {
    if (noeud[segs[i]] === undefined) {
      if (i === segs.length - 1 && segs.slice(0, i).join('/') === 'Pièces d\'identité/Autres') return true;
      // Années DYNAMIQUES d'« Impôts & déclarations » (C28-49 PR2, décision Marc « séparé par
      // années ») : mêmes segments AAAA que mission-impots — assumé > 7 enfants (années réelles).
      if (i === segs.length - 1 && segs.slice(0, i).join('/') === 'Impôts & déclarations' &&
        /^(19|20)\d{2}$/.test(segs[i])) return true;
      // Employeurs DYNAMIQUES de « Revenus & paie » (C28-49 PR2, décision Marc « séparé par
      // employeur ») : bornés par CONFIG.MISSIONS_EMPLOYEURS — même canon que mission-paies
      // (`employeurDuNom_`, une seule règle deux consommateurs).
      // Sous-dossiers PAR TYPE d'un dossier d'employeur (05) : créés À LA DEMANDE par
      // `sousDossierEmployeur_`, jamais des squelettes vides — donc exemptés du validateur, comme
      // les années et les employeurs. Bornés par la table explicite de la fonction.
      if (i === segs.length - 1 && /^Employeurs\//.test(segs.slice(0, i).join('/')) &&
        ['Contrats', 'Attestations & lettres', 'Formulaires', 'Évaluations'].indexOf(segs[i]) !== -1) return true;
      // + le COMMUN des employeurs occasionnels (ADR-0044 D11) : c'est LUI qui tient le ≤ 7 —
      // sans lui il faudrait un dossier par employeur (3 canoniques + 5 occasionnels = 8).
      return i === segs.length - 1 && segs.slice(0, i).join('/') === 'Revenus & paie' &&
        (ctx.CONFIG.MISSIONS_EMPLOYEURS.some((emp) => emp.nom === segs[i]) ||
          segs[i] === ctx.CONFIG.MISSIONS_EMPLOYEURS_COMMUN);
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
  ['02 · Finances', '2025-05_Avis d\'imposition_Revenu Québec.pdf', 'Impôts & déclarations/2025'],
  ['02 · Finances', '2024-01_Contrat_Desjardins Securities.pdf', 'Placements & crypto'],
  ['02 · Finances', '2022-08_Attestation_Boursorama Banque.pdf', 'Banques/Boursorama'],
  ['02 · Finances', '2010-04_Courrier_Lyonnaise De Banque.pdf', 'Banques/Banques France'],
  // ADR-0044 §7 — les 8 routes NÉES du reliquat des dossiers-années. Versées ICI pour passer sous
  // `cibleExiste` : c'est ce verrou qui a montré que « Contrats & fournisseurs/Cleverbridge »
  // visait un nœud ABSENT de la table (donc `verifierStructureCibleReset_` aveugle au ≤ 7 réel).
  ['02 · Finances', '2026-07-29_Tableau de suivi budgétaire_Marc et Anna.xlsx', 'Relevés/2026'],
  ['02 · Finances', '2026-07-06_Suivi de livraison_DoorDash.jpg', 'Reçus & factures/2026'],
  ['02 · Finances', '2025-06-01_Avenant aux conditions générales_XTB S.A..pdf', 'Placements & crypto'],
  ['02 · Finances', '2026-07-01_Confirmation de virement_Crédit Mutuel.jpg', 'Banques'],
  ['02 · Finances', '2025-12-31_Formulaire T1135 — Bilan de vérification du revenu étranger_ARC.pdf', 'Impôts & déclarations/2025'],
  ['01 · Administratif & identité', '2022-12-14_Conditions générales de vente_Cleverbridge GmbH.pdf', 'Contrats & fournisseurs/Cleverbridge'],
  ['05 · Carrière', '2026-03-09_Statuts de société civile_PRIGRIS.pdf', 'Entreprise — MRic (SCI)'],
  ['07 · Santé', '2025-11-15_Attestation de versement_Caisse des Français de l\'Étranger.pdf', 'Assurances santé'],
  // Non-régressions de la MÊME passe : les nouvelles règles ne volent personne.
  ['02 · Finances', '2024-09-01_Reçu_Débit préautorisé Hydro-Québec.pdf', 'Reçus & factures/2024'],
  ['02 · Finances', '2024-06-01_Mandat de courtage_Groupe Assurance Vézina.pdf', 'Assurances & prévoyance'],
  ['02 · Finances', '2024-06_Assurance_Desjardins.pdf', 'Assurances & prévoyance'],
  ['02 · Finances', '2024-03_Relevé d\'impôt_Revenu Québec.pdf', 'Impôts & déclarations/2024'],
  ['02 · Finances', '2025-06-01_Relevé de compte_NXTBank.pdf', 'Relevés/2025'],
  // 03 — logements par entité (dont le 3325 4e Avenue = LCP, amendement Marc)
  // 03 c49-2 (ADR-0040 §3c) : cibles SINGULIER aux noms RÉELS des dossiers Drive ; bailleurs et
  // véhicules par les tables canoniques PARTAGÉES avec les missions.
  ['03 · Logement & véhicule', '2024-05_Bail_1548 avenue de la Roselière.pdf', 'Logement/1548 avenue de la Roselière, Québec'],
  ['03 · Logement & véhicule', '2025-07_Quittance_LCP Groupe Immobilier.pdf', 'Logement/3325 4e avenue'],
  ['03 · Logement & véhicule', '2026-02-04_Convention de résiliation de bail_9478-5045 Québec inc.pdf', 'Logement/3987 rte des Rivières'],
  ['03 · Logement & véhicule', '2023-01_Facture_Jetta Québec.pdf', 'Véhicule/VW Jetta'],
  // ADR-0044 : KIA n'est PLUS un véhicule de Marc (« c'était juste une recherche d'achat ») — il
  // va au dossier COMMUN « Recherche & achat », décision 3 « KIA compris ». Reconnu par le NOM
  // (jetons de MISSIONS_VEHICULE_COMMUNS), donc AUSSI par le flux vivant : la version antérieure
  // de ce cas attendait `null`, ce qui envoyait le document à PLAT à la racine de `03`, dans le
  // vrac même que `HistoriqueVrac` compte comme dette (revue C28-62).
  ['03 · Logement & véhicule', '2023-01_Facture_KIA Québec.pdf', 'Véhicule/Recherche & achat'],
  // `sportage` : jeton hérité de l'ex-entrée KIA du canon. Le perdre en retirant KIA renvoyait
  // « Garage Sportage » à plat dans `03` — trouvé par la revue C28-62, invisible autrement.
  ['03 · Logement & véhicule', '2025-03-01_Facture_Garage Sportage.pdf', 'Véhicule/Recherche & achat'],
  // Le dossier commun « Locations » doit exister dans la table : c'est ce CAS qui déclenche le
  // tripwire `cibleExiste` (route ↔ table) sur lui.
  ['03 · Logement & véhicule', '2026-04-10_Contrat de location de véhicule_Enterprise.pdf', 'Véhicule/Locations'],
  // Cible à 3 SEGMENTS versée dans CAS (revue structure C28-51) : `cibleExiste` verrouille alors
  // route ↔ table — renommer une catégorie dans les constantes sans toucher la route casserait ICI.
  ['03 · Logement & véhicule', '2025-03-01_Facture_Garage Jetta.pdf', 'Véhicule/VW Jetta/Entretien & réparations'],
  ['03 · Logement & véhicule', '2026-02_Facture_ENGIE.pdf', 'Énergie & services'],
  // 04 — routage INTERNE seulement ; un doc étranger (banque CIC) rend null = reste EN PLACE + rapport
  ['04 · Immigration', '2024-11_Permis de travail_IRCC.pdf', 'Permis de travail & EIMT'],
  ['04 · Immigration', '2025-02_Lettre_Immigration, Réfugiés Et Citoyenneté Canada.pdf', 'IRCC (fédéral)'],
  ['04 · Immigration', '2023-09_Demande_Ministère De l\'Immigration, De La Francisation Et De l\'Intégration (MIFI).pdf', 'MIFI (Québec)'],
  ['04 · Immigration', '2015-01_Relevé_CIC Nord Ouest.pdf', null],
  // 05 — Employeurs = Robovic + Automatech SEULS (décision Marc) ; le reste = CV & lettres
  // (fusion « Recherche d'emploi » → « CV & lettres », décision Marc 2026-08-17, ADR-0039 §7).
  ['05 · Carrière', '2026-06_Bulletin de paie_Robovic.pdf', 'Employeurs/Robovic'],
  // Le SOUS-DOSSIER par type vient désormais de `sousDossierEmployeur_`, comme dans la mission :
  // le flux rendait « Employeurs/Automatech » tout court, donc la consolidation remontait le
  // fichier d'un cran hors de « Contrats » (divergence pré-existante, revue C28-62 PR2).
  ['05 · Carrière', '2024-03_Contrat de travail_AUTOMATECH ROBOTIK INC..pdf', 'Employeurs/Automatech/Contrats'],
  ['05 · Carrière', '2026-01-05_Lettre_Schneider Electric.pdf', 'CV & lettres'],
  ['05 · Carrière', '2022-02_Candidature_Arkema Honfleur.pdf', 'CV & lettres/Candidatures'],
  ['05 · Carrière', 'CV — Marc Richard (modifiable)', 'CV & lettres'],
  ['05 · Carrière', 'Suivi recherche emploi - Québec', 'CV & lettres/Suivi'],
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
  // ---- Non-régression revue PR1 (lentille « pièges par sous-chaîne ») : chaque cas ci-dessous a
  // ---- été mal routé par une version antérieure de la table — il VERROUILLE le correctif.
  // 'bourse' ⊂ « remboursement » : un remboursement d'IMPÔT partait en Placements & crypto.
  ['02 · Finances', '2025-03_Avis de remboursement_Revenu Québec.pdf', 'Impôts & déclarations/2025'],
  // 'rib' ⊂ « contribution » : un reçu REER partait en Coordonnées & chèques (type EXACT désormais).
  ['02 · Finances', '2024-02_Reçu de contribution REER_Desjardins.pdf', 'Reçus & factures/2024'],
  // Feuillet T4/Relevé 1 québécois : fiscal, pas un « relevé » bancaire.
  ['02 · Finances', '2025-02_Feuillet T4_Robovic.pdf', 'Impôts & déclarations/2025'],
  // « Desjardins Assurance » : l'ASSUREUR prime sur le rattrapage bancaire par émetteur.
  ['02 · Finances', '2023-11_Contrat_Desjardins Assurance.pdf', 'Assurances & prévoyance'],
  // « Crédit Industriel et Commercial » = CIC (deux graphies, même banque).
  ['02 · Finances', '2013-04_Courrier_Crédit Industriel Et Commercial.pdf', 'Banques/CIC'],
  // GMF « La Sauvegarde » = un ASSUREUR : ne part JAMAIS en Sécurité & codes → null (reste en _TRI).
  ['01 · Administratif & identité', '2023-06_Conditions générales_GMF La Sauvegarde.pdf', null],
  ['01 · Administratif & identité', '2022-01_Codes de sauvegarde_Google.pdf', 'Sécurité & codes'],
  // Pièce délivrée par un consulat/une ambassade = autorité émettrice → Marc.
  ['01 · Administratif & identité', '2018-07_Passeport_Consulat Général De France À Québec.pdf', 'Pièces d\'identité/Marc'],
  // Anciens logements/véhicules du stock réel (Trieste, Jetta).
  ['03 · Logement & véhicule', '2016-09_Bail_Résidence Trieste.pdf', 'Logement/Anciens logements'],
  ['03 · Logement & véhicule', '2015-03_Facture_Volkswagen Jetta.pdf', 'Véhicule/VW Jetta'],
  // CAQ (Certificat d'acceptation du Québec) = MIFI, pas IRCC.
  ['04 · Immigration', '2022-05_CAQ_Gouvernement Du Québec.pdf', 'MIFI (Québec)'],
  // 'formation' ⊂ « information » : une lettre d'information ne part pas en Formation & bilans.
  ['05 · Carrière', '2023-02_Lettre d\'information_Desjardins.pdf', null],
  ['05 · Carrière', '2021-06_Attestation de formation_AFPA.pdf', 'Formation & bilans'],
  ['05 · Carrière', 'Archive candidatures 2021-2025', 'CV & lettres/Archive 2021-2025'],
  // Le COLLÈGE Gustave Eiffel et le Hubhouse (ULCO-CEL) ne sont ni la prépa ni le DUT.
  ['06 · Études & diplômes', '2013-09_Certificat de scolarité_Collège Gustave Eiffel.pdf', 'Autres établissements'],
  ['06 · Études & diplômes', '2021-03_Attestation_ULCO CEL Hubhouse.pdf', 'Autres établissements'],
  // ' colles' (programme de colles → prépa/examens) sans jamais matcher un autre mot.
  ['06 · Études & diplômes', '2020-01_Programme de colles_Semaine 12.pdf', 'Prépa Gustave Eiffel (PTSI)/Examens & khôlles'],
  // 'chine' ⊂ « machine » : un billet « La Machine » ne part pas en Chine… mais le VRAI cas
  // « _Chine.pdf » (underscore, pas d'espace) route bien (égalité sur l'émetteur).
  ['09 · Voyages', '2024-05-14_Billet_La Machine De l\'Île.pdf', 'Réservations & billets/2024'],
  ['09 · Voyages', '2023-10-12_Visa_Chine.pdf', 'Par voyage/Chine'],
  // ---- t3 (décisions Marc 2026-07-30 sur le reliquat réel) : versés DANS `CAS` — et pas seulement
  // ---- dans leurs tests dédiés — pour bénéficier AUSSI du verrou « la cible existe dans la table »
  // ---- (revue #228 : sans ça, renommer un nœud de la table sans toucher la règle laissait la suite
  // ---- verte pendant que la prod créait un dossier HORS table, cassant le ≤ 7 en silence).
  ['02 · Finances', '2026-06_Paie_Robovic Inc..pdf', 'Revenus & paie/Robovic'],
  ['02 · Finances', '2025-12_Déclaration_Donation-partage.pdf', 'Impôts & déclarations/2025'],
  ['03 · Logement & véhicule', '2026-03-09_Contrat_Inconnu.pdf', 'Contrats'],
  ['03 · Logement & véhicule', '2023-02_Correspondance_Syndic.pdf', 'Correspondance'],
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

test('RESET_PERSONNES_AUTRES : bornée par la contrainte ≤ 7 (le validateur EXEMPTE ces enfants dynamiques — la promesse doit être CODÉE)', () => {
  // `verifierStructureCibleReset_` exempte explicitement `Pièces d'identité/Autres/<personne>` en
  // disant qu'ils sont « bornés par la liste RESET_PERSONNES_AUTRES ». Rien ne bornait cette liste :
  // à 8 personnes, l'invariant constitutionnel « ≤ 7 par niveau » sautait SANS faire échouer la CI
  // (leçon §7 « promesse de verrou = verrou codé dans le même commit », relevé en revue #227).
  assert.ok(Object.keys(ctx.RESET_PERSONNES_AUTRES).length <= MAX,
    'ajouter une 8ᵉ personne casserait le ≤ 7 de `Pièces d\'identité/Autres` : créer un regroupement d\'abord');
});

test('MISSIONS_EMPLOYEURS : bornée par la contrainte ≤ 7 (jumeau du verrou RESET_PERSONNES_AUTRES — revue structure-keeper PR2)', () => {
  // « Revenus & paie/<employeur> » est la 2ᵉ famille d'enfants dynamiques exemptée du validateur :
  // même promesse, même verrou codé — un 8ᵉ employeur casserait le ≤ 7 sans faire échouer la CI.
  assert.ok(ctx.CONFIG.MISSIONS_EMPLOYEURS.length + 1 <= MAX,
    'canoniques + le commun « Autres employeurs » : un 7ᵉ canonique casserait le ≤ 7');
  // ADR-0044 D11 : les employeurs OCCASIONNELS ne comptent PAS dans cette borne, justement parce
  // qu'ils partagent UN dossier. Le verrou : ils ne doivent jamais être promus canoniques en
  // douce (sinon la borne saute sans que rien n'échoue).
  const canon = ctx.CONFIG.MISSIONS_EMPLOYEURS.map((e) => e.nom);
  ctx.CONFIG.MISSIONS_EMPLOYEURS_AUTRES.forEach((e) => assert.ok(canon.indexOf(e.nom) === -1,
    'un employeur occasionnel ne doit pas figurer AUSSI dans le canon : ' + e.nom));
  // Jetons alphabétiques, MULTI-MOTS AUTORISÉS : la contrainte porte sur le NUMÉRIQUE
  // (`apparierUnique_` reçoit du texte brut, un jeton chiffré matcherait un composant de date),
  // pas sur les espaces — et c'est justement le multi-mots qui rend `silver crest` /
  // `trajectoire emploi` DISCRIMINANTS (revue code C28-62 PR2).
  ctx.CONFIG.MISSIONS_EMPLOYEURS_AUTRES.forEach((e) => e.jetons.forEach((j) =>
    assert.match(j, /^[a-z]+( [a-z]+)*$/, 'jeton non alphabétique : ' + j)));
  // …et un CONTRE-EXEMPLE par employeur : le charset ne prouve pas la discrimination. Ces noms
  // sont ceux qui partaient à tort chez « Autres employeurs » avec des jetons d'un seul mot.
  [['2021-01_Bilan_Trajectoire professionnelle.pdf', 'Trajectoire-Emploi'],
    ['2020-01_Facture_Crest Toothpaste.pdf', 'Silver Crest'],
  ].forEach(([nom, emp]) => assert.strictEqual(ctx.employeurAutreDuNom_(nom), null,
    'mot courant ⇒ jamais ' + emp + ' : ' + nom));
  // Contre-épreuve positive : les vrais noms matchent toujours.
  assert.strictEqual(ctx.employeurAutreDuNom_('2026-07-01_Attestation_Silver Crest.jpg'), 'Silver Crest');
  assert.strictEqual(ctx.employeurAutreDuNom_('2026-01_Paie_Trajectoire-Emploi.PDF'), 'Trajectoire-Emploi');
});

test('identité 01 : Anna Malaval a son dossier (validation Marc 2026-07-30) — le nom RÉEL du reliquat, suffixe `_2` inclus', () => {
  const d = '01 · Administratif & identité';
  // Nom EXACT resté en `_TRI 2026/01` (le suffixe `_2` de dédup fait partie du tiers analysé).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2022-09-07_Passeport_Anna Malaval_2.pdf'),
    'Pièces d\'identité/Autres/Anna Malaval');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2019-03_Carte d\'identité_Anna Malaval.pdf'),
    'Pièces d\'identité/Autres/Anna Malaval');
  // La garde reste ENTIÈRE pour les autres : ajouter une personne n'ouvre pas la porte aux inconnus.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2021-05_Passeport_Sophie Durand.pdf'), null);
});

test('01 : codes de RÉCUPÉRATION → Sécurité & codes (le pluriel n\'est pas couvert par le singulier)', () => {
  const d = '01 · Administratif & identité';
  // Nom RÉEL resté en `_TRI 2026/01` faute de règle (constaté 2026-07-30).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-06-29_Codes de récupération_Codes de récupération authentification double facteur.txt'),
    'Sécurité & codes');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-01_Code de récupération_Google.txt'), 'Sécurité & codes');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Mot de passe_Coffre.txt'), 'Sécurité & codes');
  // Non-régression : « La Sauvegarde » reste un ASSUREUR, jamais un code de sécurité.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-06_Conditions générales_GMF La Sauvegarde.pdf'), null);
});

test('05 : motif « ute » EXACT seulement — un émetteur qui le contient par hasard reste non routé (revue PR1)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2024-01_Lettre_Communauté Métropolitaine.pdf'), null);
  assert.strictEqual(ctx.cheminCibleReset_('05 · Carrière', '2019-05_Lettre_UTE.pdf'), 'CV & lettres');
});

test('05 : « Recherche d\'emploi » RECRÉÉ (ADR-0044 D10) — le geste est SYMÉTRIQUE ou il ne vaut rien', () => {
  // RÉVOQUE la fusion du 2026-08-17 : Marc a demandé de recréer le dossier, averti du conflit.
  // Le verrou d'ABSENCE devient un verrou de PRÉSENCE — mais la présence dans la table ne suffit
  // PAS : si la mission continuait de dissoudre le dossier, ou si le flux continuait de router le
  // recrutement vers « CV & lettres », on aurait un ping-pong. Les 3 faces sont donc assertées.
  const n05 = ctx.STRUCTURE_CIBLE_RESET['05 · Carrière'];
  assert.ok(n05['Recherche d\'emploi'], 'le nœud est de retour dans la table cible');
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(n05['CV & lettres']))),
    ['Candidatures', 'Suivi', 'Archive 2021-2025'], 'CV & lettres garde ses enfants');
  // Face 2 — la mission ne le dissout plus : ni source, ni source JETABLE.
  const carriere = ctx.tableMissions_().filter((m) => m.tag === 'carriere')[0];
  const IDS = ctx.CONFIG.MISSIONS_IDS;
  assert.ok(carriere.sources.indexOf(IDS.rechercheEmploi) === -1,
    'le dossier n\'est plus une SOURCE (sinon la mission le vide pendant que le flux le remplit)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(carriere.sourcesJetables)), [],
    'plus aucune source peinte en rouge');
  // Face 3 — le FLUX y route le recrutement (et plus vers la cible de l'ex-fusion).
  const D = '05 · Carrière';
  assert.strictEqual(ctx.cheminCibleReset_(D, '2026-07-06_Offre d\'emploi_Cégep Garneau.jpg'), 'Recherche d\'emploi');
  assert.strictEqual(ctx.cheminCibleReset_(D, '2022-12-19_Invitation d\'entretien_Automatech Robotik.ics'), 'Recherche d\'emploi');
  // …et une vraie candidature de Marc reste bien en « CV & lettres » (ce n'est pas du recrutement).
  assert.strictEqual(ctx.cheminCibleReset_(D, '2026-01-01_CV_Marc Richard.pdf'), 'CV & lettres');
  // ≤ 7 : 05 passe à 7 nœuds pile.
  assert.ok(Object.keys(JSON.parse(JSON.stringify(n05))).length <= MAX, 'règle des ≤ ' + MAX);
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

/* ---------- t3 : décisions Marc du 2026-07-30 sur le RELIQUAT RÉEL (134 non routés) ---------- */

test('02 : bulletins de paie → Revenus & paie — type EXACT, JAMAIS la sous-chaîne « paie » ⊂ « paiement »', () => {
  const d = '02 · Finances';
  // Noms RÉELS du reliquat (onglet Reset, 2026-07-30) — PAR EMPLOYEUR depuis C28-49 PR2 (décision
  // Marc « séparé par employeur ») : même canon que mission-paies (`employeurDuNom_`).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-06_Paie_Robovic Inc..pdf'), 'Revenus & paie/Robovic');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-01_Paie_Automatech Robotik Inc..pdf'), 'Revenus & paie/Automatech');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-01_Paie_CIUSSS de la Capitale-Nationale.pdf'), 'Revenus & paie/CIUSSS');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-03_Bulletin de paie_Robovic.pdf'), 'Revenus & paie/Robovic');
  // Le motif ANCRÉ sur le mot couvre plus large que des égalités exactes (revue #228).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-07_Sommaire de paie_Robovic.pdf'), 'Revenus & paie/Robovic');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-02_Attestation de salaire_CIUSSS.pdf'), 'Revenus & paie/CIUSSS');
  // Employeur HORS table → racine « Revenus & paie » (jamais deviné, jamais un dossier inventé).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2018-04_Paie_Boulangerie Dupont.pdf'), 'Revenus & paie');
  // ⚠ LE piège : « paie » est une sous-chaîne de « paiement ». Un paiement n'est PAS un salaire.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-07-01_Confirmation de paiement_Crédit Mutuel.pdf'), null,
    'un « paiement » ne doit JAMAIS être pris pour un bulletin de paie');
  // ⚠⚠ LE piège au carré (attrapé en revue #228) : « relevé de paiement » COMMENCE par « relevé de
  // paie » — une 1ʳᵉ version le routait en Revenus & paie alors que c'est un relevé. Dénomination
  // courante (Hydro-Québec, Retraite Québec, assureurs) et la règle passe AVANT « Relevés ».
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-11_Relevé de paiement_Hydro-Québec.pdf'), 'Relevés/2024',
    'un « relevé de paiement » est un RELEVÉ, jamais un bulletin de paie');
  // Non-régression : les feuillets FISCAUX restent fiscaux, pas de la paie.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Feuillet T4_Robovic.pdf'), 'Impôts & déclarations/2025');
});

test('02 : feuillets québécois RL-1 / RL-31 → Impôts, PAS Relevés (correction d\'un commentaire faux, revue #228)', () => {
  const d = '02 · Finances';
  // `t = 'releve 1'` matchait la règle « Relevés » (placée AVANT la règle fiscale) : le RL-1, feuillet
  // de revenus d'emploi québécois, atterrissait avec les relevés BANCAIRES. Vu les 10 bulletins de
  // paie Robovic/Automatech du reliquat, le cas est probable.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Relevé 1_Robovic.pdf'), 'Impôts & déclarations/2025');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-02_Relevé 31_LCP Groupe Immobilier.pdf'), 'Impôts & déclarations/2025');
  // Motif ANCRÉ sur le nombre : un relevé bancaire ordinaire n'est jamais capturé.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03_Relevé_Desjardins.pdf'), 'Relevés/2026');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03_Relevé 10_Desjardins.pdf'), 'Relevés/2026');
});

test('02 : donations/successions → Impôts & déclarations (le nœud dédié a cédé sa place, versant notarial couvert par 01)', () => {
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2025-12_Déclaration_Donation-partage.pdf'), 'Impôts & déclarations/2025');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2024-03_Attestation_Succession Richard.pdf'), 'Impôts & déclarations/2024');
  // Année du NOM implausible (bornes dérivées d'`anneePlausible_`, LA règle partagée flux ↔
  // missions : 1990-2100) → RACINE, jamais un dossier-année inventé — mission-impots reprendra si
  // une règle future l'éclaire. Les DEUX bornes testées (revue structure-keeper PR2 : deux
  // fenêtres écrites séparément avaient déjà divergé).
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '2103-01_Avis d\'imposition_Revenu Québec.pdf'), 'Impôts & déclarations');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '1989-01_Avis d\'imposition_Trésor Public.pdf'), 'Impôts & déclarations');
  assert.strictEqual(ctx.cheminCibleReset_('02 · Finances', '1990-01_Avis d\'imposition_Trésor Public.pdf'), 'Impôts & déclarations/1990');
  // La table ne doit PLUS porter le nœud retiré (sinon dossier fantôme jamais alimenté).
  assert.ok(!ctx.STRUCTURE_CIBLE_RESET['02 · Finances']['Donations & successions'],
    'nœud retiré de la table cible');
  assert.ok(ctx.STRUCTURE_CIBLE_RESET['02 · Finances']['Revenus & paie'], 'et remplacé par Revenus & paie');
});

test('03 : filets Contrats / Correspondance — capturent le reliquat SANS voler ce qui est mieux routé', () => {
  const d = '03 · Logement & véhicule';
  assert.strictEqual(ctx.cheminCibleReset_(d, '2026-03-09_Contrat_Inconnu.pdf'), 'Contrats');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-05_Consentement_Propriétaire.pdf'), 'Contrats');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-02_Correspondance_Syndic.pdf'), 'Correspondance');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2022-11_Avis de séjour_Camping.pdf'), 'Correspondance');
  // PRIORITÉ : les règles par ENTITÉ/BAILLEUR passent AVANT les filets — un contrat LCP part
  // chez son logement (table bailleur, ADR-0040 §2), jamais dans le fourre-tout.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2025-07_Contrat_LCP Groupe Immobilier.pdf'),
    'Logement/3325 4e avenue');
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-01_Contrat_1548 avenue de la Roselière.pdf'),
    'Logement/1548 avenue de la Roselière, Québec');
  // ADR-0044 décision 3 : KIA retiré du canon → dossier COMMUN « Recherche & achat », jamais un
  // véhicule créé, et jamais le filet « Contrats » (qui le noierait parmi les baux).
  assert.strictEqual(ctx.cheminCibleReset_(d, '2023-05_Contrat_KIA Québec.pdf'), 'Véhicule/Recherche & achat');
  // AMBIGUÏTÉ location ↔ véhicule du canon : « location » + « VW Jetta », c'est peut-être un BAIL
  // sur SON véhicule. Refus RÉVISABLE plutôt qu'un déplacement définitif (revue C28-62) — à
  // comparer au cas Enterprise ci-dessus, qui ne nomme aucun véhicule de Marc et part en Locations.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-01-01_Contrat de location de véhicule_VW Jetta.pdf'), null);
  // Un bail SANS adresse ni bailleur reconnus : le filet « Contrats » (le pluriel « Logements »
  // n'existe plus — c49-2), jamais un logement deviné.
  assert.strictEqual(ctx.cheminCibleReset_(d, '2024-05_Bail_Résidence X.pdf'), 'Contrats');
});

/* ---------- 03 c49-2 (ADR-0040 §3a/§3c) : catégories PAR VÉHICULE — le transversal t4 est
 * RÉVOQUÉ par la décision Marc 2026-08-17. Un document de véhicule SANS véhicule identifiable
 * n'a PLUS de fourre-tout : le flux (table pure) rend null (à plat au domaine + rapport) — la
 * MISSION ne devine plus non plus : le repli par date est RETIRÉ (ADR-0044 §4). Noms RÉELS. --- */

test('c49-2 · 03 : un document de véhicule NOMMÉ va dans SON véhicule, catégorie par le type', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  // Entretien : l'émetteur-atelier route la CATÉGORIE, le véhicule vient du nom.
  assert.strictEqual(c.cheminCibleReset_(D, '2025-03-01_Facture_Garage Jetta.pdf'),
    'Véhicule/VW Jetta/Entretien & réparations');
  // Vente/achat : type transactionnel → Recherche & achat du véhicule nommé.
  assert.strictEqual(c.cheminCibleReset_(D, '2023-06-20_Contrat de vente véhicule d\'occasion_Jetta.pdf'),
    'Véhicule/VW Jetta/Recherche & achat');
  // ADR-0044 — LOCATION : dossier commun, jamais un véhicule de Marc (les 3 contrats Enterprise).
  assert.strictEqual(c.cheminCibleReset_(D, '2026-04-10_Contrat de location de véhicule_Enterprise.pdf'),
    'Véhicule/Locations');
  // PIÈGES verrouillés — le 1er jet du prédicat les cassait tous les deux :
  //  « Avis » est un loueur, mais surtout un mot français des plus courants ;
  //  « demande de location » est du LOGEMENT, jamais une voiture.
  assert.notStrictEqual(c.cheminCibleReset_(D, '2022-11_Avis de séjour_Camping.pdf'), 'Véhicule/Locations');
  assert.notStrictEqual(c.cheminCibleReset_(D, '2018-10-15_Formulaire de demande de location_CORPIQ.pdf'),
    'Véhicule/Locations');
  // Assurance nommant le véhicule.
  assert.strictEqual(c.cheminCibleReset_(D, '2023-11-13_Soumission d\'assurance automobile_Jetta Desjardins.pdf'),
    'Véhicule/VW Jetta/Assurance auto');
  // Sans type de catégorie : à plat dans le véhicule.
  assert.strictEqual(c.cheminCibleReset_(D, '2015-03_Facture_Volkswagen Jetta.pdf'), 'Véhicule/VW Jetta');
});

test('c49-2 · 03 : SANS véhicule identifiable → null (jamais de fourre-tout, jamais deviné) — noms réels t4', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  [
    // Entretien/assurance génériques (ex-« Véhicules/<catégorie> » transversal, révoqué).
    '2023-10-02_Facture_Garage Charlesbourg Certi-Pro.jpg',
    '2023-11-13_Soumission d\'assurance automobile_Desjardins Assurances.pdf',
    '2026-06-29_Carte d\'assurance_Desjardins Assurances.jpg',
    // ⚠️ le piège MARQUE ≠ MODÈLE : un concessionnaire Volkswagen/Toyota n'est PAS la Jetta/le bZ
    // (la capture Corolla partirait sinon dans le bZ à clé de SUCCÈS — leçon C28-49).
    '2026-07-01_Capture d\'écran_Drummondville Volkswagen.jpg',
    '2026-07-01_Facture_Toyota.jpg',
  ].forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), null, nom));
  // Contraventions/immatriculation anonymes : documents de VÉHICULE typés, sans véhicule
  // identifiable ⇒ dossier COMMUN « À attribuer » (ADR-0044 §4.2). Ils rendaient `null` jusqu'à la
  // revue C28-62, au motif que « la mission tranche par fenêtre » — mécanisme retiré, et qui ne
  // voyait de toute façon PAS ces documents (ils arrivent par le flux). `null` les envoyait à plat
  // à la racine de `03`. Le flux, la mission et la consolidation calculent maintenant la MÊME
  // cible : c'est ce qui rend le placement CONVERGENT.
  [
    '2023-06-27_Constat d\'infraction_Ville de Québec.jpg',
    '2026-07-06_Constat d\'infraction_Municipalité de Thetford Mines.jpg',
    '2026-07-20_Certificat d\'immatriculation_Société de l\'assurance automobile du Québec.jpg',
  ].forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), 'Véhicule/À attribuer', nom));
  // L'assurance HABITATION, elle, garde son nœud (règle plus haute).
  assert.strictEqual(c.cheminCibleReset_(D, '2025-01-01_Assurance habitation_Desjardins.pdf'), 'Assurance habitation');
  // Une réclamation TÉLÉCOM ne devient jamais un sinistre auto (contre-exemple réel conservé).
  assert.strictEqual(c.cheminCibleReset_(D, '2023-11-01_Réclamation_Virgin.png'), null);
});

test('t4 · 03 : le ferroviaire reste en _TRI — le reset ne peut PAS changer de domaine', () => {
  // Marc veut ces fichiers en « 08 · Perso & projets/Voyages ». `cheminCibleReset_` rend un chemin
  // RELATIF au domaine d'ORIGINE : un fichier venu de 03 ne peut aller que sous 03. On préfère donc
  // null (reste en _TRI, RAPPORTÉ) à un mauvais rangement — « Recherche-Devis » contient « devis »
  // et serait sinon capturé par le filet « Contrats ».
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  ['2026-07-01_Billet_SNCF.jpg', '2026-07-01_Billet de train_SNCF.jpg',
    '2026-07-01_Confirmation de réservation_SNCF.jpg', '2026-07-01_Recherche-Devis_SNCF.jpg',
    '2026-07-07_Résultats de recherche tarifaire_SNCF.jpg']
    .forEach((nom) => assert.strictEqual(c.cheminCibleReset_(D, nom), null, nom));
});

test('c49-2 · 03 : les règles par ENTITÉ/BAILLEUR gardent la priorité sur les types génériques', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Consolidation.gs', 'Reset.gs', 'Missions.gs']);
  const D = '03 · Logement & véhicule';
  // Un document de véhicule va chez SON véhicule (catégorie par l'atelier), jamais dans un filet.
  assert.strictEqual(c.cheminCibleReset_(D, '2025-03-01_Facture_Garage Jetta.pdf'),
    'Véhicule/VW Jetta/Entretien & réparations');
  // Un document LCP part chez SON logement (table bailleur) même si son type est « Annonce ».
  assert.strictEqual(c.cheminCibleReset_(D, '2026-01-01_Annonce_LCP Groupe Immobilier.pdf'),
    'Logement/3325 4e avenue');
  // Le nœud du split n'existe plus : verrous d'ABSENCE des pluriels (patron « Recherche d'emploi »).
  const n03 = ctx.STRUCTURE_CIBLE_RESET['03 · Logement & véhicule'];
  assert.ok(!n03['Logements'] && !n03['Véhicules'],
    'les pluriels sont RETIRÉS de la table (les missions les vident — ping-pong sinon)');
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']['VW Jetta']))),
    JSON.parse(JSON.stringify(ctx.CONFIG.MISSIONS_CATEGORIES_VEHICULE)),
    'tripwire : les catégories de la table = celles de la CONFIG (deux artefacts, un verrou)');
  // ADR-0044 — même patron que les pluriels : un bucket de cette table est RECRÉÉ PAR NOM, donc
  // garder « KIA » ici pendant que la mission le dissout produirait un ping-pong.
  assert.ok(!n03['Véhicule']['KIA'], 'KIA retiré de la table (sinon recréé par nom à chaque classement)');
  const vehicules = JSON.parse(JSON.stringify(ctx.CONFIG.MISSIONS_VEHICULES)).map((v) => v.nom);
  vehicules.forEach((v) => assert.ok(n03['Véhicule'][v], 'chaque véhicule du canon a son nœud : ' + v));
  // TRIPWIRE : les communs de la TABLE == ceux de la CONFIG. Sans lui, renommer un commun dans la
  // CONFIG créerait DEUX dossiers en prod, en silence (revue C28-62).
  const communs = JSON.parse(JSON.stringify(ctx.CONFIG.MISSIONS_VEHICULE_COMMUNS)).map((c) => c.nom);
  assert.deepStrictEqual(
    Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']))).filter((n) => !vehicules.includes(n)),
    communs, 'tripwire : les communs de la table = ceux de la CONFIG');
  // ⚠️ LE VRAI VERROU N'EST PAS LA TABLE. `estAncreStructurelleFusion_` ne regarde que le PREMIER
  // NIVEAU de STRUCTURE_CIBLE_RESET[domaine] : un nœud imbriqué sous « Véhicule » n'y est jamais
  // protégé (et la collecte de Fusion.gs n'est même pas récursive). Ce qui protège réellement les
  // communs, c'est `estSegmentStructurel_` — l'inventaire de la RÉORG, lui, est récursif (BFS) et
  // proposerait de fusionner un dossier que 2 producteurs recréent PAR NOM. Une version antérieure
  // de ce test assertait la présence dans la table en la COMMENTANT « c'est ce qui en fait des
  // ancres » : un proxy qui n'impliquait pas la propriété (leçon « promesse de verrou = verrou
  // codé dans le même commit »).
  // (le verrou lui-même est asserté dans `reorg.test.js`, où `estSegmentStructurel_` est chargé)

  assert.ok(Object.keys(JSON.parse(JSON.stringify(n03['Véhicule']))).length <= MAX,
    'règle des ≤ ' + MAX + ' nœuds (dérivée de la constante, jamais du littéral du jour)');
});
