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
  // Identité : repli quand la table REFUSE d'attribuer (C28-72) — appelé par deciderRoutageV2_.
  'repliIdentite_',
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
  'memoriserEchecJetonHubperso_', 'echecJetonHubperso_', 'texteEchecJetonHubperso_', // C28-77 : série d'échecs du refresh
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
  'depeindreDossier_', 'depeindreCiblesRemplies_', 'assurerDepeintureCibles_',
  // C28-49 PR2 : Carrière + Finances.
  'employeurDuNom_', 'typeDuNomMission_', 'anneeDuNomMission_', 'typeContient_',
  'routerFinance02_', 'sousDossierEmployeur_', 'routerCarriere_', 'moisManquantsPaies_',
  // ADR-0044 §5 : prédicats PURS partagés par la mission carrière ET la table du flux.
  'estTypeRecrutement_', 'estDocumentationMetier_', 'estReleveDePaie_', 'employeurAutreDuNom_',
  'estModeleOuFormulaire_',
  'domaineHors02DuNom_', 'resetMotEntier_',
  'estTypeFiscalReset_',
  'exclusionsSortie02_',
  'appliquerCorrectionsManuelles_', 'estDocumentLogement_',
  // Appelé PAR `Missions.gs` (batirCtx de la mission carrière) et DÉFINI dans `Router.gs` :
  // appel inter-module, donc au contrat. Sa disparition serait invisible en CI sans ça.
  'dossierTechnique_',
  'ecrireRapportPaies_',
  // C28-49 PR2 (revue finale) : prédicats PARTAGÉS flux ↔ missions, définis dans Reset.gs et
  // appelés depuis Missions.gs — une seule règle, deux consommateurs (leçon C28-26).
  'anneePlausible_', 'estTypePaieReset_', 'estFeuilletFiscalReset_', 'estRibReset_',
  // C28-51 (ADR-0040) : canons bailleurs/véhicules partagés (Reset.gs ↔ Missions.gs) + cibles.
  'vehiculeDuNom_', 'logementDuBailleur_', 'cibleBailleur_', 'categorieVehiculeMission_',
  'bucketEmetteur_', 'epingleMission_', 'estSourceDisparue_',
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
  // Les PIÈCES vers la Mémoire (ADR-0061, C49-2 bis). `pousserPieceApresClassement_` est
  // appelée depuis `Pipeline.gs`, `texteSantePiece_` depuis `Journal.gs`,
  // `reinitialiserPiecesRun_` depuis `Main.gs` : trois traversées de module qu'aucun test
  // unitaire mocké ne verrait disparaître.
  'pousserPieceApresClassement_', 'texteSantePiece_', 'reinitialiserPiecesRun_',
  'extrairePiece_', 'envoyerLotPiecesMemoire_',
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
  'traiterIntentionsMail_', 'extraireEtCreer_', 'armerOuLeverRetardIntentions_', 'marquerCoupeIntentions_', 'lireRetardIntentions_', 'reinitialiserEscalades_', 'reinitialiserUsage_', 'flushUsage_',
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
  // Validation de `_Doublons` par empreinte (C28-49 PR4, ADR-0047) — Doublons.gs, appelée depuis
  // Main.gs (finally du tick, hors `etapeSuivie_` : registre C28-44 saturé) ; `texteSanteDoublons_`
  // est appelée par `majSante_` (Journal.gs) et `COLONNES_RAPPORT_DOUBLONS` par `initialiserSheet_`.
  'majValidationDoublons_',
  // La Mémoire (ADR-0059 phase 0) : appelée par le tick, définie dans Memoire.gs. Sans cette
  // ligne, la disparition de la fonction laisserait la suite verte et le tick lèverait à
  // chaque exécution — l'incident qui a fait naître ce fichier.
  'pousserInventaireMemoire_', 'faitInventaireMemoire_', 'niveauMemoire_',
  'passeMemoire_', 'noterFinMemoire_', 'ligneFinMemoire_', 'budgetJourMemoire_',
  'texteSanteMemoire_', 'phraseFinMemoire_',
  // C28-137 — le chemin MANUEL. Ce n'est PAS un contrat inter-module : personne ne l'appelle
  // depuis le code, c'est Marc qui la lance depuis l'éditeur. Elle est déclarée ici pour la
  // raison INVERSE des autres — rien d'autre ne la retient, et sa disparition dans un refactor
  // ne casserait aucun test ailleurs. Un chemin que seul un humain emprunte a besoin d'un
  // gardien, sinon il s'efface sans bruit et le budget quotidien redevient un mur sans porte.
  'pousserMemoireMaintenant',
  // C49-3, l'audit des pièces (ADR-0061). Trois fonctions que SEUL Marc lance depuis
  // l'éditeur, pour la même raison que `pousserMemoireMaintenant` juste au-dessus : rien dans
  // le code ne les appelle, donc rien ne les retient. Et celle-ci est une PORTE — si elle
  // s'efface dans un refactor, le seul moyen de mesurer avant d'ouvrir le canal des pièces
  // disparaît avec elle, silencieusement.
  'auditPiecesMaintenant', 'verdictAuditPieces', 'viderAuditPieces',
  // Leurs fonctions pures, et `composerEchantillonAudit_` / `extraireLotAudit_` qui sont bien
  // des contrats INTER-MODULES (Journal.gs crée l'onglet à partir de ces constantes).
  'repartirAudit_', 'estDomaineMasqueAudit_', 'masquerAudit_', 'masquerChampsAudit_',
  'champsEnClairAudit_', 'cellulesAuditPiece_', 'compterVerdictsAudit_', 'phraseVerdictAudit_',
  'composerEchantillonAudit_', 'extraireLotAudit_', 'auditerUnDocumentAudit_',
  // La passe AUTOMATIQUE (C49-3, 17/09). `etapeAuditPiece_` et `resteAuditPiece_` sont appelées
  // par Main.gs (l'étape et sa gate), `texteSanteAuditPiece_` par Journal.gs : trois contrats
  // INTER-MODULES qu'aucun test unitaire mocké ne verrait disparaître. `budgetJourAudit_` et
  // `phraseFinAuditPiece_` sont PURES et testées à part ; `noterFinAuditPiece_` est le point
  // d'écriture UNIQUE de l'état de fin — le retirer rendrait les sorties muettes en silence,
  // exactement l'incident du 16/09 sur l'envoi à la Mémoire.
  'etapeAuditPiece_', 'resteAuditPiece_', 'budgetJourAudit_',
  // `auditDoitTourner_` est appelée par `Main.gs` et `compterAFaireAudit_` par la passe : deux
  // fonctions inter-modules, donc deux noms que seul ce test retient si on les déplace.
  'auditDoitTourner_', 'compterAFaireAudit_',
  // Le correctif du 17/09 : l'aplatissement des champs (c'est LUI qui rendait « [object
  // Object] »), la réparation d'en-tête et la re-extraction one-shot. Les trois vivent sur le
  // chemin de la passe, donc rien d'autre ne les retient si un refactor les emporte.
  'valeurChampAudit_', 'reparerEnTeteAudit_', 'reextraireAudit_',
  'noterFinAuditPiece_', 'phraseFinAuditPiece_', 'texteSanteAuditPiece_',
  // Le PÉRIMÈTRE (C49-4 étape A). Trois contrats INTER-MODULES : `perimetreDoitTourner_` et
  // `etapePerimetrePiece_` sont appelées par `Main.gs`, `texteSantePerimetrePiece_` par
  // `Journal.gs`. Et `diagnosticPerimetrePiece` est le chemin que MARC emprunte depuis
  // l'éditeur : rien d'autre ne la retient, or un diagnostic promis mais absent fait retomber
  // chaque vérification sur un échantillon Drive (§9, « un diagnostic un-clic n'est un signal
  // de certitude que s'il est COMMITTÉ et déployé »).
  'perimetreDoitTourner_', 'etapePerimetrePiece_', 'texteSantePerimetrePiece_',
  // `decisifsPerimetre_` : le compte des domaines que Marc pousse EN PREMIER. Appelée par
  // l'encodage ET par le diagnostic — deux sites, donc un contrat que seul ce test retient.
  'decisifsPerimetre_',
  'diagnosticPerimetrePiece', 'lireLignesIndexPerimetre_',
  // Le RATTRAPAGE (C49-5 étape B). `rattrapageDoitTourner_`, `restantsRattrapage_` et
  // `etapeRattrapagePiece_` sont appelées par `Main.gs` ; `texteSanteRattrapagePiece_` par
  // `Journal.gs` ; et le module consomme `estCandidatPiece_` + `PREFIXES_DOMAINE_DECISIF_PIECE`
  // de `PerimetrePiece.gs`, `fileIdDeCleIndex_` de `Journal.gs`, `budgetJourAudit_` et
  // `resteAuditPiece_` d'`AuditPiece.gs`, `pousserPieceApresClassement_` de `Memoire.gs`.
  // Rien d'autre que ce test ne retient ces contrats.
  'rattrapageDoitTourner_', 'restantsRattrapage_', 'etapeRattrapagePiece_',
  'texteSanteRattrapagePiece_', 'prefixesRattrapage_',
  // Les DEUX chemins que Marc emprunte depuis l'éditeur. C28-137 : un chemin que seul un humain
  // emprunte n'a personne d'autre pour le retenir, et le jour où le budget du tick est épuisé,
  // c'est le seul moyen de vérifier une réparation avant minuit. `diagnosticRattrapagePiece`
  // est en plus ce qui permet de lire le COÛT d'une tranche AVANT de la dépenser.
  'rattraperPiecesMaintenant', 'diagnosticRattrapagePiece',
  'inventorierDoublons_', 'balayerExemplairesDoublons_',
  'ecrireVerdictsDoublons_', 'feuilleRapportDoublons_', 'texteSanteDoublons_', 'pageListeDrive_',
  'texteSanteHistoGmail_', // Main.gs, appelée par Journal.gs (ligne de Santé C28-99)
  'statutHistoGmail_', // Journal.gs, appelée par Main.gs — UNE règle de statut, deux surfaces
  // Re-datation de `06` (C28-92, ADR-0056) — trois contrats INTER-MODULES que la 1ʳᵉ rédaction
  // avait oubliés alors que leurs jumeaux ci-dessus y étaient (🟠 revues code et sécurité) :
  // ADR-0058 — le domaine d'une paie / d'un RL-1 est dérivé du TYPE. Contrat INTER-MODULE :
  // défini dans Reset.gs, appelé depuis Router.gs, comme ses voisins `estTypePaieReset_` /
  // `estFeuilletFiscalReset_` déjà déclarés plus haut (🟡 revue structure : ils manquaient).
  'estRevenuEmployeurReset_', 'estRl31Reset_', 'estDisqualifieCommeRevenuReset_', 'estFeuilletT4Reset_',
  'texteSanteReanalyse_', // Main.gs, appelée par Journal.gs (ligne de Santé)
  'statutReanalyse_', // Main.gs — les SIX causes d'arrêt, une seule règle
  'budgetJourReanalyse_', // Migration.gs, appelée par Main.gs (minutes du jour de la ligne de Santé)
  'reDatationEnCours_', // Migration.gs, appelée par Consolidation.gs (garde D11)
  'dateReferenceReanalyse_', // Migration.gs — date de référence : le nom d'abord, Drive en repli
  'estExemplaireSurvivant_', 'verdictClotureDoublon_', 'urlListeDrive_', 'bilanDoublons_',
  'idDoublonsSansCreer_', 'estJetonPaginationRefuse_',
  // Drainage de `Documents ID` (C28-73, ADR-0048) — DocumentsID.gs, un-clic manuel (aucun budget de
  // tick) ; `traiterDocument_` + `deplacerEtRenommer_`/`renommer_` sont les appels inter-modules.
  'drainerDocumentsID', 'drainerUnFichierDocumentsID_', 'dossiersDrainageDocumentsID_',
  'estDrainableDocumentsID_', 'bilanDrainageDocumentsID_', 'cleDrainageDocumentsID_',
  'collecterDrainageDocumentsID_', 'finDrainageDocumentsID_',
  'estPossedeParMarcDocumentsID_',
  'ligneSanteDoublons_', 'budgetJourDoublons_',
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
  'proposerSourceFusion_', 'videsCandidatsRecreables_', 'filtrerVidesCandidatsRecreables_',
  'partiesId_', 'dernierSegment_', 'ensembleIntouchables_', 'repointerEntites_', 'solderAction_',
  'estSegmentStructurel_', 'estNoeudRecreable_', 'estNoeudRecreablePrudent_', 'noeudsTableReset_',
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
  'entitesValideesParCle_', 'entitesValideesOuNull_', 'empreintesPlanConsolidation_',
  'sousCheminDomaine_', 'budgetJourConsolidation_', // règle unique flux↔plan + budget quotidien (revue flotte)
  // ADR-0052 : `bucketTypeDomaine_` vit dans Reset.gs et est appelée depuis Router.gs — contrat
  // INTER-MODULE, donc invisible des tests unitaires mockés si elle disparaissait.
  'bucketTypeDomaine_', 'estDocumentIdentiteReset_',
  // `segmentsChemin_` vit dans Router.gs et est appelée depuis ConsolidationExec.gs.
  'segmentsChemin_', 'estSousCheminDe_', 'ecoleParDateReset_',
  'estCibleInterdite_', // C28-31 : année/type d'identité ne sont JAMAIS parents d'un regroupement
  'segmentsSousDomaine_', 'dossierEntiteParId_', // ADR-0028 : confinement + chemin réel, et le RÉSOLVEUR UNIQUE par ID — Router.gs, appelés AUSSI par ConsolidationExec.gs
  'seedEntitesMarc_', // seed one-shot des entités de Marc (décision 2026-07-17), appelé depuis Main
  // exécution du plan de consolidation (ADR-0024) — moveTo seul, §1 par mutation, cible recalculée
  'appliquerPlanConsolidation_', 'appliquerLigneConsolidation_', 'positionActuelleFichier_',
  'ligneAAppliquer_', 'budgetJourConsoExec_', 'dossierCiblePlan_', 'nbParentsBorne_',
  // RESET complet (C28-33, ADR-0030 PR2) — rassemblement/placement/04 interne, appelés depuis Main ;
  // resetEnCours_ suspend conso-2/réorg-auto (ADR-0030 « Transition ») ; réutilisent detecterDossierVide_
  // (ConsolidationExec.gs) et repointerEntites_ (Reorg.gs) EN TRAVERS des modules.
  'rassemblerReset_', 'placerReset_', 'appliquerReset04Interne_', 'resetEnCours_', 'resetTermine_',
  // ADR-0032 (pilote CI) : appelées EN TRAVERS des modules (WebApp.gs → Reset.gs / Main.gs).
  'pousserResetPilote_', 'pilotageTermineReset_', 'actionAssurerTrigger_', 'installerTrigger',
  'analyserReliquatReset_', 'analyserPageReliquatReset_', 'analyserFichierReliquat_', // ADR-0030 PR5 : passe LLM du reliquat (appelée par Main.gs)
  'detecterDossierVide_', 'repointerEntites_',
  // ADR-0055 : `repointerEcoles06_` (Missions.gs) appelle `sousDossier_` (Router.gs) pour
  // find-or-créer la cible qui n'existe pas encore — 2ᵉ contrat inter-module de cette fonction.
  'sousDossier_',
  // ADR-0060 : `repointerEcoles06_` (Missions.gs) ne fait plus que TROUVER une cible sans ID.
  'sousDossierExistant_', 'carteRepointageEcoles06_',
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
    'jetonGoogle_', // ADR-0041 : Tasks/Calendar passent par jetonHubperso_ — le jeton du script ne doit pas revenir ici
    'referentielViseUneSource_', 'dossiersVisesParEntites_']; // ADR-0060 : la garde « une entité vise la source » était vraie à vie ; find-only à la place
  const revenues = retirees.filter((nom) => typeof ctx[nom] === 'function');
  assert.deepStrictEqual(revenues, [], `retirées mais présentes : ${revenues.join(', ')}`);
});

/**
 * TRIPWIRE D'INVENTAIRE (leçon §9, incident C28-53) — `feuille_(nom)` rend `null` si l'onglet est
 * absent de `initialiserSheet_` : `getSheetByName(nom) || (initialiserSheet_(ss), getSheetByName(nom))`
 * ne crée QUE les onglets de la liste `creerOnglet_`. L'appelant plante alors sur `getRange of null`
 * — vécu avec `RapportPaies`, oublié de la liste : la mission paies crashait à chaque tick pendant
 * des jours, l'erreur avalée par le try/catch d'étape et prise pour du bruit.
 *
 * La leçon disait « vérifier par INVENTAIRE (grep) » ; un grep qu'on se rappelle de lancer n'est pas
 * un verrou. Celui-ci échoue tout seul, dans les deux sens (un onglet créé que personne ne lit est
 * du code mort tout aussi révélateur).
 */
test('INVENTAIRE : tout onglet lu par feuille_() est créé par initialiserSheet_, et réciproquement', () => {
  const lus = new Set();
  const crees = new Set();
  for (const f of TOUS_LES_GS) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    for (const m of src.matchAll(/feuille_\(\s*'([^']+)'/g)) lus.add(m[1]);
    for (const m of src.matchAll(/creerOnglet_\(\s*ss\s*,\s*'([^']+)'/g)) crees.add(m[1]);
  }
  const manquants = [...lus].filter((n) => !crees.has(n));
  assert.deepStrictEqual(manquants, [],
    'onglet(s) lu(s) par feuille_() mais JAMAIS créé(s) par initialiserSheet_ → feuille_() rend null ' +
    'et l\'appelant plante sur getRange of null (incident RapportPaies, C28-53) : ' + manquants.join(', '));
  const orphelins = [...crees].filter((n) => !lus.has(n));
  assert.deepStrictEqual(orphelins, [],
    'onglet(s) créé(s) que personne ne lit — code mort ou lecteur supprimé : ' + orphelins.join(', '));
});
