'use strict';
/**
 * FILET DE SURFACE (audit 2026-07-02) — né d'un vrai incident : un retrait de code mort par regex
 * avait AVALÉ `deciderRoutage_` entière ; la syntaxe passait, les tests unitaires (qui mockent leurs
 * dépendances) passaient, et chaque document serait parti en quarantaine à l'exécution.
 * Ce test charge TOUT le moteur ensemble et vérifie que chaque fonction du CONTRAT INTERNE
 * (appelée en travers des modules) est définie. Toute disparition accidentelle casse ici.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./harness');

const TOUS_LES_GS = fs.readdirSync(path.join(__dirname, '..', 'src'))
  .filter((f) => f.endsWith('.gs'));

const ctx = load(TOUS_LES_GS);

// Le contrat interne : les fonctions appelées EN TRAVERS des modules (pipeline, tick, maintenance).
const CONTRAT = [
  // pipeline & routage
  'traiterDocument_', 'deciderRoutage_', 'doublonRapide_', 'routageTechnique_', 'routageMedia_',
  'estTechnique_', 'estMediaDirect_', 'estPhoto_', 'estNomNonDocumentaire_',
  'extension_', 'extraireTexte_', 'classifier_', 'gererEchec_', 'empreinteBlob_',
  'enrichirClassifDepuisNom_', 'creerRaccourcisEntites_', 'deposer_',
  // état
  'indexContient_', 'indexAjouter_', 'estDoublon_', 'feuille_', 'journalInfo_', 'journalErreur_',
  'initialiserSheet_', 'majSante_', 'notifierEchec_', 'incrementerEchec_',
  // entités
  'entitesCache_', 'reinitialiserEntitesCache_', 'resoudreEntite_', 'entiteEnAttenteAjouter_',
  'creerDossiersEntitesValidees_', 'promouvoirEntiteValidee_', 'appliquerCurationEntites_',
  'estEntiteGenerique_', 'estFusionnableEntite_', 'incrementerVuEntite_',
  // canonicalisation & fusion d'entités (refonte 2026-07-07)
  'canoniserEntite_', 'cleCanoniqueEntite_', 'estProprietaireMarc_', 'estJetonGenerique_',
  'retirerSuffixeJuridique_', 'canoniserVehicule_', 'canoniserAdresse_', 'corrigerOcrConnu_',
  // sources & maintenance
  'traiterGmail_', 'traiterGmailHistorique_', 'traiterPageHistorique_', 'pageFilsHisto_',
  'requeteHisto_', 'dateGmail_',
  'traiterDepots_', 'ordonnerDepots_', 'collecterPartages_', 'appliquerMigrationTaxonomie_',
  'exporterTexteNatif_', 'exportNatifMime_', // natifs Google lisibles (R3)
  'budgetCampagnesAtteint_', 'reinitialiserFreinBudget_', // frein budget campagnes (R3, §2.6)
  'appliquerRangementInitial_', 'appliquerRejeuSiNouvelleVersion_', 'rangementTermine_',
  'appliquerRelancesQuarantaine_',
  'estAReclasserLeger_', 'collecterAReclasser_', 'deplacerVersATrier_',
  'aParentProtege_', 'ensembleDomainesProteges_', 'nbFichiersATrier_',
  // Drive REST
  'deplacerEtRenommer_', 'renommer_', 'creerRaccourci_', 'fetchDriveAvecRetry_', 'jetonDrive_',
  // corrections & formulaire
  'lireEtAppliquerCorrections_', 'enregistrerCorrection_', 'reinitialiserCorrectionsCache_',
  'blocFewShot_', 'assurerFormulaireCorrection_',
  // intentions (Phase 3) & mails importants (#14)
  'traiterIntentionsMail_', 'reinitialiserEscalades_', 'reinitialiserUsage_', 'flushUsage_',
  'reinitialiserPannePlateforme_', 'estPannePlateforme_', 'detecterPannePlateforme_',
  'signalerPannePlateforme_', 'chargerPannePlateforme_', 'signalerRetablissement_',
  'estCodeSystemique_', 'poserPannePlateforme_', // panne durable 429/529/5xx (C28-12)
  'emailAlerte_', 'signalerNatifUneFois_',
  // tri Gmail (#16)
  'trierFilsGmail_', 'trierFil_', 'decisionTri_', 'heuristiquePhishing_', 'adresseExpediteur_',
  'normaliserLibelle_', 'parserMiniCategorie_', 'miniCategorie_', 'triApprisCache_', 'apprendreTri_',
  'reinitialiserTriApprisCache_', 'libellesUtilisateur_', 'reinitialiserLibellesCache_',
  'estPromoGmail_', 'reinitialiserPromoSetCache_', 'signalerPanneEcriture_', 'reinitialiserPanneEcriture_',
  'scanAvantTri_', 'scanArriereTri_',
  'newslettersJamaisLues_', 'apprentissagesSemaine_',
  'miniCheckMail_', 'parserMiniCheck_', 'marquerMailImportant_', 'lienGmail_',
  // cibles publiques des déclencheurs / outils
  'tickDriveAI', 'installerTrigger', 'chienDeGarde', 'resumeHebdo', 'rangerToutLeDrive', 'dequarantaine',
  'dequarantainerLignes_', // noyau appelé par le tick (R3) — JAMAIS dequarantaine() (réentrance)
  'rattraperMediasMalClasses', 'doPost', 'tickPonctuel', 'fileIdDepuisCleMaintenance_',
  // web app : recherche IA (C21-03)
  'actionTickPonctuel_', 'actionRechercheIA_', 'promptRechercheIA_', 'validerQuestionIA_',
  'parserPlanIA_', 'appelAnthropicTexte_', 'domainesAutorises_',
  // réorg IA (#21, C21-04 : proposition ; C21-06 : application)
  'appliquerReorgIA_', 'inventaireDossiers_', 'resumeArborescence_', 'promptReorg_',
  'parserPropositionReorg_', 'lignePourAction_', 'solderDemande_', 'aParentEtrangerProtege_',
  'chaineMonteVersProtege_',
  'etapeReorg_', 'appliquerReorgValidee_', 'appliquerUneAction_', 'actionsValidees_',
  'partiesId_', 'dernierSegment_', 'ensembleIntouchables_', 'repointerEntites_', 'solderAction_',
  'estSegmentStructurel_',
  // documents d'identité & titulaire (refonte 2026-07-07)
  'normaliserTypeIdentite_', 'estDocumentIdentitePersonnel_', 'dossierIdentite_', 'titulairePourNom_',
  'nommerDocument_', 'garantirNomUnique_', 'casseNomPersonne_', 'sousDossierPourNom_',
  // décision non-document (refonte 2026-07-07)
  'decisionNonDocument_', 'distinguerVraiScan_', 'estExportDonnees_', 'estMediaSansTexte_', 'extensionEstTechnique_',
  // analyse 2 passes & routage v2 (refonte #26, C26-05/06 — flag CONFIG.ANALYSE_V2)
  'classifierDeuxPasses_', 'appelAnthropicV2_', 'normaliserChampsV2_',
  'deciderRoutageV2_', 'planRoutageV2_', 'nomsDansDossier_', 'budgetMsRun_',
  // fail-safe hybride ultra-strict (ADR-0016 — révision §2.1)
  'estClassificationVide_', 'estRenseigne_', 'routageAVerifier_', 'dossierAVerifier_',
  // miroir Drive du dépôt (ADR-0017 — accès de partout + NotebookLM ; À PLAT depuis 2026-07-08)
  'dossierMiroir_', 'estFichierMiroirable_', 'nettoyerSegmentChemin_', 'nomFichierMiroir_',
  'ecrireFichierMiroir_', 'verifierSecretSync_',
  'actionSyncMiroir_',
  // entités auto-validées (#18)
  'autoValiderEntitesFrequentes_', 'estAutoValidable_', 'entitesAutoValidees_', 'estValidee_',
  // dry-run v2 (#26, C26-07, ADR-0015) : preuve avant/après, zéro mutation
  'appliquerDryRunV2_', 'traiterUnDryRunV2_', 'chargerOuGenererEchantillonDryRunV2_',
  'collecterCandidatsDryRunV2_', 'collecterCandidatsDomaine_', 'domainesAEchantillonner_',
  'stratifierEchantillonDryRunV2_', 'ligneDryRunV2_', 'cheminActuelDryRunV2_',
  'encoderEchantillonDryRunV2_', 'decoderEchantillonDryRunV2_',
  'usageRunSnapshot_', 'coutDollarsDelta_',
];

test('surface du moteur : toutes les fonctions du contrat interne sont définies', () => {
  const absentes = CONTRAT.filter((nom) => typeof ctx[nom] !== 'function');
  assert.deepStrictEqual(absentes, [], `fonctions ATTENDUES mais absentes : ${absentes.join(', ')}`);
});

test('surface du moteur : les fonctions RETIRÉES par l\'audit ne reviennent pas par accident', () => {
  const retirees = ['rejouerLaRevue', 'sourceParNomRevue_', 'nettoyerDoublonsRevue',
    'deplacerVersDoublons_', 'viderOnglet_', 'estAReclasser_', 'doublon_',
    'curseurSuivantHisto_', 'miniVerifActionRdv_',
    'dossiersMiroir_', 'dossierMiroirPourChemin_']; // miroir à plat 2026-07-08 : plus de sous-dossiers
  const revenues = retirees.filter((nom) => typeof ctx[nom] === 'function');
  assert.deepStrictEqual(revenues, [], `retirées mais présentes : ${revenues.join(', ')}`);
});
