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
  // sources & maintenance
  'traiterGmail_', 'traiterGmailHistorique_', 'traiterPageHistorique_', 'pageFilsHisto_',
  'requeteHisto_', 'dateGmail_',
  'traiterDepots_', 'collecterPartages_', 'appliquerMigrationTaxonomie_',
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
  'rattraperMediasMalClasses', 'doPost', 'tickPonctuel', 'fileIdDepuisCleMaintenance_',
  // web app : recherche IA (C21-03)
  'actionTickPonctuel_', 'actionRechercheIA_', 'promptRechercheIA_', 'validerQuestionIA_',
  'parserPlanIA_', 'appelAnthropicTexte_', 'domainesAutorises_',
  // réorg IA (#21, C21-04 : proposition)
  'appliquerReorgIA_', 'inventaireDossiers_', 'resumeArborescence_', 'promptReorg_',
  'parserPropositionReorg_', 'lignePourAction_', 'solderDemande_', 'aParentEtrangerProtege_',
  'chaineMonteVersProtege_',
];

test('surface du moteur : toutes les fonctions du contrat interne sont définies', () => {
  const absentes = CONTRAT.filter((nom) => typeof ctx[nom] !== 'function');
  assert.deepStrictEqual(absentes, [], `fonctions ATTENDUES mais absentes : ${absentes.join(', ')}`);
});

test('surface du moteur : les fonctions RETIRÉES par l\'audit ne reviennent pas par accident', () => {
  const retirees = ['rejouerLaRevue', 'sourceParNomRevue_', 'nettoyerDoublonsRevue',
    'deplacerVersDoublons_', 'viderOnglet_', 'estAReclasser_', 'doublon_',
    'curseurSuivantHisto_', 'miniVerifActionRdv_'];
  const revenues = retirees.filter((nom) => typeof ctx[nom] === 'function');
  assert.deepStrictEqual(revenues, [], `retirées mais présentes : ${revenues.join(', ')}`);
});
