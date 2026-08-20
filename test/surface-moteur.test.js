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
  // canonicalisation & fusion d'entités (refonte 2026-07-07 ; branchée sur le chemin VIVANT P4/C28-10)
  'canoniserEntite_', 'cleCanoniqueEntite_', 'estProprietaireMarc_', 'estJetonGenerique_',
  'retirerSuffixeJuridique_', 'canoniserVehicule_', 'canoniserAdresse_', 'corrigerOcrConnu_',
  'dossiersExistantsDomaine_', // « reality check » Drive des propositions (P4/C28-10)
  // sources & maintenance
  'traiterGmail_', 'traiterGmailHistorique_', 'traiterPageHistorique_', 'pageFilsHisto_',
  'requeteHisto_', 'dateGmail_',
  // panne de QUOTA Gmail journalier (C28-15 — suspension persistée, patron R2)
  'chargerPanneGmail_', 'estPanneGmail_', 'signalerPanneGmail_', 'signalerRetablissementGmail_',
  // panne de CONFIG d'API Google (C28-22 — Tasks/Calendar non activée, suspension persistée)
  'chargerPanneConfigApi_', 'estPanneConfigApi_', 'reinitialiserPanneConfigApi_',
  'estMessageApiDesactivee_', 'signalerPanneConfigApi_',
  // C28-48 : sonde légère + message exploitable + état lisible pour l'onglet Santé.
  'sonderApiConfig_', 'verdictSondeApi_', 'messageErreurGoogle_', 'etatPanneConfigApi_',
  'memoriserMessageConfigApi_', 'sonderEtLeverPanneConfig_', 'texteSanteConfigApi_',
  // C28-52 (ADR-0041) : jeton OAuth du projet hubperso — JetonHubperso.gs, appelé par Tasks.gs/
  // Calendar.gs/GoogleApi.gs (jeton) et WebApp.gs (callback doGet) : pur cross-module.
  'jetonHubperso_', 'jetonCacheValide_', 'analyserReponseJetonHubperso_', 'lierCompteHubperso',
  'urlConsentementHubperso_', 'traiterCallbackHubperso_', 'echangerCodeHubperso_',
  'validerCallbackHubperso_', 'comparaisonConstante_', 'doGet',
  // Revue flotte C28-52 : verdicts honnêtes (transitoire ≠ non lié), purge 401, scopes complets.
  'etatLiaisonHubperso_', 'messageJetonHubpersoIndisponible_', 'purgerCacheJetonHubperso_', 'scopesHubpersoComplets_',
  // C28-53 (ADR-0042) : actions /exec du connecteur MCP — Mcp.gs, appelées par WebApp.gs (doPost)
  // et consommant antiRafalePilote_ (WebApp.gs) / comparaisonConstante_ (JetonHubperso.gs) en travers.
  'verifierSecretMcp_', 'actionMcp_', 'actionMcpEtat_', 'actionMcpRecherche_', 'actionMcpLire_',
  'actionMcpReorg_', 'actionMcpIntention_', 'missionsDepuisProgression_', 'erreursDepuisJournal_',
  'mailDepuisTelemetrie_', 'lireOngletBorne_', 'fenetreQueueJournal_', 'antiRafalePilote_',
  // C28-49 (ADR-0039) : missions de curation — appelées en travers des modules (Main/Journal).
  'executerMission_', 'tableMissions_', 'gMissionsJour_', 'gMissionsAmont03_', 'chargerEtatMissions_',
  'budgetJourMissions_', 'cleMission_', 'apparierUnique_', 'jetonsCible_', 'logementParDate_',
  'dateDuNomMission_', 'fenetresOccupation_', 'ciblesAvecJetons_', 'collecterMission_',
  'traiterItemMission_', 'peindreDossierRouge_', 'peindreSourcesVides_', 'estDossierVideMission_',
  // C28-49 PR2 : Carrière + Finances.
  'employeurDuNom_', 'typeDuNomMission_', 'anneeDuNomMission_', 'typeContient_',
  'routerFinance02_', 'sousDossierEmployeur_', 'routerCarriere_', 'moisManquantsPaies_',
  // ADR-0044 §5 : prédicats PURS partagés par la mission carrière ET la table du flux.
  'estTypeRecrutement_', 'estDocumentationMetier_', 'estReleveDePaie_', 'employeurAutreDuNom_',
  // Appelé PAR `Missions.gs` (batirCtx de la mission carrière) et DÉFINI dans `Router.gs` :
  // appel inter-module, donc au contrat. Sa disparition serait invisible en CI sans ça.
  'dossierTechnique_',
  'ecrireRapportPaies_',
  // C28-49 PR2 (revue finale) : prédicats PARTAGÉS flux ↔ missions, définis dans Reset.gs et
  // appelés depuis Missions.gs — une seule règle, deux consommateurs (leçon C28-26).
  'anneePlausible_', 'estTypePaieReset_', 'estFeuilletFiscalReset_', 'estRibReset_',
  // C28-51 (ADR-0040) : canons bailleurs/véhicules partagés (Reset.gs ↔ Missions.gs) + cibles.
  'vehiculeDuNom_', 'logementDuBailleur_', 'cibleBailleur_', 'categorieVehiculeMission_',
  'ciblesLogement_', 'categoriesVehiculeReset_',
  // curation des mails (C28-19, ADR-0020) : confiance, scan cyclique, « pas suspect » 1-clic
  'decisionSuspect_', 'confianceCache_', 'reinitialiserConfianceCache_', 'apprendreConfiance_',
  'scanCycliqueTri_', 'appliquerPasSuspect_', 'purgerClesTriIndex_',
  'actionPasSuspect_', 'validerThreadId_',
  // revue flotte C28-24 : fils hors fenêtre intentions triés sans attendre (jamais d'« attend » permanent)
  'joursFenetreIntentions_', 'estHorsFenetreIntentions_',
  'traiterDepots_', 'ordonnerDepots_', 'collecterPartages_', 'appliquerMigrationTaxonomie_',
  // re-analyse v2 ciblée (C26-08, ADR-0018)
  'estAReanalyser_', 'appliquerReanalyseCiblee_', 'reanalyserUnePage_', 'collecterAReanalyser_',
  'reanalyserFichier_',
  // progression LIVE des opérations (C28-18) : rendu centralisé (tick finally) + recensements
  'majProgressions_', 'lignesProgression_', 'assurerEnteteProgression_',
  // télémétrie coûts & quotas (C28-24) : rendu centralisé (tick finally), lu par l'app (PR3)
  'majTelemetrie_', 'lignesTelemetrie_', 'compteurFilsJour_',
  // résumé hub (C28-27) : pré-calcul au tick finally (Main.gs) des 4 métriques du widget hubperso.com
  'majResumeHub_', 'compterMetriquesHub_', 'compterDossierRevue_', 'cleDocumentIndex_', 'tsCellule_',
  'compterRestantMigration_', 'compterRestantReanalyse_', 'compterCampagneDossier_',
  'majCompteurCampagne_', 'finaliserCompteurCampagne_',
  'exporterTexteNatif_', 'exportNatifMime_', // natifs Google lisibles (R3)
  'budgetCampagnesAtteint_', 'reinitialiserFreinBudget_', // frein budget campagnes (R3, §2.6)
  'appliquerRangementInitial_', 'appliquerRejeuSiNouvelleVersion_', 'rangementTermine_',
  'appliquerRelancesQuarantaine_',
  'estAReclasserLeger_', 'collecterAReclasser_', 'deplacerVersATrier_',
  'aParentProtege_', 'ensembleDomainesProteges_', 'nbFichiersATrier_',
  'normaliserCle_', // Entites.gs, appelé par Router/Corrections/Maintenance
  // réconciliation Index↔Drive (C28-07, plan P3)
  'synchroniserIndex_', 'constaterEtatDrive_', 'decisionSyncIndex_', 'cheminsSyncCompatibles_',
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
  'intentionsSuspendues_', 'texteSanteTriDegrade_',
  'poserOperationCourante_', 'operationCourante_', 'fusionnerOps_', 'ventilationCoutMois_',
  'lignesCouts_', 'majCouts_', 'usageRunOpsSnapshot_', 'lireResumeHubPersiste_',
  'communVehiculeDepuisSource_', 'communVehiculeDuNom_', 'estLocationVehicule_',
  'normaliserLibelle_', 'parserMiniCategorie_', 'miniCategorie_', 'triApprisCache_', 'apprendreTri_',
  'reinitialiserTriApprisCache_', 'libellesUtilisateur_', 'reinitialiserLibellesCache_',
  'estPromoGmail_', 'reinitialiserPromoSetCache_', 'signalerPanneEcriture_', 'reinitialiserPanneEcriture_',
  'scanAvantTri_', 'scanArriereTri_',
  'nettoyerBoiteHistorique_', 'finaliserPasseBoite_', // nettoyage profond > 30 j (C28-22, ADR-0022)
  'newslettersJamaisLues_', 'apprentissagesSemaine_',
  'miniCheckMail_', 'parserMiniCheck_', 'marquerMailImportant_', 'lienGmail_',
  // cibles publiques des déclencheurs / outils
  'tickDriveAI', 'installerTrigger', 'chienDeGarde', 'resumeHebdo', 'rangerToutLeDrive', 'dequarantaine',
  'dequarantainerLignes_', // noyau appelé par le tick (R3) — JAMAIS dequarantaine() (réentrance)
  'rattraperMediasMalClasses', 'doPost', 'tickPonctuel', 'fileIdDepuisCleMaintenance_',
  'etatCampagnesRangement', // diagnostic un-clic LECTURE SEULE (état campagnes rangement) — Diagnostic.gs
  // Journal QUOTIDIEN du vrac par domaine (demande Marc 2026-08-12) — HistoriqueVrac.gs, appelée
  // depuis Main.gs (finally du tick) ; réutilise compterVracRacineDomaine_ (Diagnostic.gs).
  'majHistoriqueVrac_', 'ligneHistoriqueVrac_', 'domainesHistoriqueVrac_', 'budgetJourHistoriqueVrac_',
  // Suivi GÉNÉRIQUE des opérations du tick (C28-44, ADR-0038) — Suivi.gs : wrapper appelé par
  // Main.gs (PR2), vue fusionnée lue par Journal.gs/majProgressions_ (PR3), flush au finally.
  'etapeSuivie_', 'suiviReset_', 'suiviSkip_', 'suiviOpsFusionne_', 'flusherSuiviOps_',
  'chargerSuiviOps_', 'fusionnerSuiviOps_', 'encoderSuiviOps_', 'clesRegistreSuivi_',
  'statutDepuisSuivi_', // PR3 : statut des opérations sans lecteur de campagne (Journal.gs l'appelle)
  // C28-47 : débit & estimation de fin des campagnes à compteur (Journal.gs les appelle)
  'majDebit_', 'estimationFin_', 'chargerDebits_', 'majDebits_',

  'reparerIncidentSheet', 'estCleFichierIncident_', // réparation incident Sheet d'état (2026-07-08)
  'fusionnerDomaine07PersoVers08', 'remplacerColonneOnglet_', // fusion domaine erroné (anomalies 2026-07-08)
  'terminerFusionDomaine07', // fin de fusion (ré-étiquetage seul, idempotent)
  // web app : recherche IA (C21-03)
  'actionTickPonctuel_', 'actionRechercheIA_', 'promptRechercheIA_', 'validerQuestionIA_',
  'parserPlanIA_', 'appelAnthropicTexte_', 'domainesAutorises_',
  // web app : chat assistant (C28-30, ADR-0026 — PR1 Q&A LECTURE SEULE)
  'appelAnthropicMessages_', 'appelAnthropicChat_', 'texteReponse_', // Llm.gs, appelés par WebApp.gs
  'actionChatAssistant_', 'validerHistoriqueChat_', 'tronquerHistoriqueChat_', 'coutChatJour_', 'promptChatAssistant_',
  'outilsChatAssistant_', 'executerOutilChatAssistant_', 'rechercheDriveChat_', 'lireFichierChat_',
  // opérations de dossiers via le chat (C28-30 PR2) : proposer_reorg → onglet Réorg, déplacement de
  // fichier via le chemin GARDÉ (Reorg.appliquerUneAction_), épinglé Marc respecté des deux côtés
  'proposerReorgChat_', 'parserActionsChat_', 'ligneActionChat_', 'champsActionChat_', 'neutraliserFormule_',
  'appliquerDeplacerFichier_', // Reorg.gs — appliqué au chemin gardé (C21-06)
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
  // miroir Drive du dépôt (ADR-0017 — accès de partout + NotebookLM ; À PLAT depuis 2026-07-08,
  // binaires utiles pdf/png/jpg/svg depuis la même date)
  'dossierMiroir_', 'estFichierMiroirable_', 'nettoyerSegmentChemin_', 'nomFichierMiroir_',
  'ecrireFichierMiroir_', 'verifierSecretSync_',
  'actionSyncMiroir_', 'mimeTypePourMiroir_', 'majFichierBinaireMiroir_',
  // entités auto-validées (#18)
  'autoValiderEntitesFrequentes_', 'estAutoValidable_', 'entitesAutoValidees_', 'estValidee_',
  // dry-run v2 (#26, C26-07, ADR-0015) : preuve avant/après, zéro mutation
  'appliquerDryRunV2_', 'traiterUnDryRunV2_', 'chargerOuGenererEchantillonDryRunV2_',
  'collecterCandidatsDryRunV2_', 'collecterCandidatsDomaine_', 'domainesAEchantillonner_',
  'stratifierEchantillonDryRunV2_', 'ligneDryRunV2_', 'cheminActuelDryRunV2_',
  'encoderEchantillonDryRunV2_', 'decoderEchantillonDryRunV2_',
  'usageRunSnapshot_', 'coutDollarsDelta_',
  // comparaison 1↔2 passes (ADR-0034 §5) : preuve avant d'allumer la 2ᵉ passe conditionnelle
  'appliquerComparaisonV2_', 'traiterUnComparaisonV2_', 'classifierComparaisonV2_',
  'comparerPassesV2_', 'ligneComparaisonV2_', 'planPourClassifV2_',
  'champsDivergentsV2_', 'fauxNegatifSensibleV2_', 'placementCanoniqueV2_',
  'placementLisibleV2_', 'verdictSautV2_', 'passe1SuffisammentSure_',
  'synthetiserComparaisonV2_', 'messageSyntheseComparaisonV2_', 'estPannePlateforme_',
  // consolidation de l'arborescence (C28-26, ADR-0023) : dry-run pur, appelé depuis Main
  'genererPlanConsolidation_', 'traiterUnConsolidation_', 'collecterConsolidation_',
  'analyserNomClasse_', 'cheminCibleConsolidation_', 'decisionConsolidation_',
  'entitesValideesParCle_', 'empreintesPlanConsolidation_',
  'sousCheminDomaine_', 'budgetJourConsolidation_', // règle unique flux↔plan + budget quotidien (revue flotte)
  'estCibleInterdite_', // C28-31 : année/type d'identité ne sont JAMAIS parents d'un regroupement
  'segmentsSousDomaine_', 'dossierEntiteParId_', // ADR-0028 : confinement + chemin réel, et le RÉSOLVEUR UNIQUE par ID — Router.gs, appelés AUSSI par ConsolidationExec.gs
  'seedEntitesMarc_', // seed one-shot des entités de Marc (décision 2026-07-17), appelé depuis Main
  // exécution du plan de consolidation (ADR-0024) — moveTo seul, §1 par mutation, cible recalculée
  'appliquerPlanConsolidation_', 'appliquerLigneConsolidation_', 'domaineActuelFichier_',
  'ligneAAppliquer_', 'budgetJourConsoExec_', 'dossierCiblePlan_', 'nbParentsBorne_',
  // RESET complet (C28-33, ADR-0030 PR2) — rassemblement/placement/04 interne, appelés depuis Main ;
  // resetEnCours_ suspend conso-2/réorg-auto (ADR-0030 « Transition ») ; réutilisent detecterDossierVide_
  // (ConsolidationExec.gs) et repointerEntites_ (Reorg.gs) EN TRAVERS des modules.
  'rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'resetEnCours_', 'resetTermine_',
  // ADR-0032 (pilote CI) : appelées EN TRAVERS des modules (WebApp.gs → Reset.gs / Main.gs).
  'pousserResetPilote_', 'pilotageTermineReset_', 'actionAssurerTrigger_', 'installerTrigger',
  'analyserReliquatReset_', 'analyserPageReliquatReset_', 'analyserFichierReliquat_', // ADR-0030 PR5 : passe LLM du reliquat (appelée par Main.gs)
  'detecterDossierVide_', 'repointerEntites_',
  // Débit du placement (revue #229) : `empreinteReutiliseeReset_` (Reset.gs) appelle
  // `empreinteConnueParId_` (Journal.gs) et consomme `empreintesPlanDeuxSens_` (Consolidation.gs) —
  // trois modules différents, donc INVISIBLES des tests unitaires mockés : d'où leur place ici.
  'empreinteReutiliseeReset_', 'empreinteConnueParId_', 'fileIdDeCleIndex_',
  'empreintesPlanDeuxSens_', 'dossierDomaineMemo_', 'gardePartReset_',
  // fusion des dossiers en double (#47, ADR-0036) : dry-run un-clic, ZÉRO mutation (PR1)
  'genererPlanFusion', 'clusteriserDossiers_', 'dossiersLies_', 'cibleFusion_', 'lignesPlanFusion_',
  'acronymesFusion_', 'anneesDistinctes_', 'collecterSousDossiersFusion_', 'domainesFusion_',
  'estAncreStructurelleFusion_',
  // exécution du plan de fusion (#47 PR2, ADR-0037 — FusionExec.gs) : moveTo seul, gardé, gaté OFF
  'appliquerPlanFusion_', 'fusionsAExecuter_', 'ligneFusionAAppliquer_', 'budgetJourFusionExec_',
  'cibleFusionValide_', 'idDomaineFusion_', 'deplacerFichierFusion_', 'fondreSourceFichiers_',
  'appliquerUneSourceFusion_',
];

test('surface du moteur : toutes les fonctions du contrat interne sont définies', () => {
  const absentes = CONTRAT.filter((nom) => typeof ctx[nom] !== 'function');
  assert.deepStrictEqual(absentes, [], `fonctions ATTENDUES mais absentes : ${absentes.join(', ')}`);
});

test('surface du moteur : les fonctions RETIRÉES par l\'audit ne reviennent pas par accident', () => {
  const retirees = ['decouperCiblePlan_', // remplacée par le RECALCUL de cible au move (revue C28-26)
    'rejouerLaRevue', 'sourceParNomRevue_', 'nettoyerDoublonsRevue',
    'deplacerVersDoublons_', 'viderOnglet_', 'estAReclasser_', 'doublon_',
    'curseurSuivantHisto_', 'miniVerifActionRdv_',
    'dossiersMiroir_', 'dossierMiroirPourChemin_', // miroir à plat 2026-07-08 : plus de sous-dossiers
    'ecrireRecensement_', 'ecrireProgression_', 'repeter_', // barre texte mono-op retirée (C28-18)
    'jetonGoogle_']; // ADR-0041 : Tasks/Calendar passent par jetonHubperso_ — le jeton du script ne doit pas revenir ici
  const revenues = retirees.filter((nom) => typeof ctx[nom] === 'function');
  assert.deepStrictEqual(revenues, [], `retirées mais présentes : ${revenues.join(', ')}`);
});
