/**
 * Journal.gs — État dans la Google Sheet + notifications d'échec.
 *
 * Onglets : Entités | Corrections | Index | Journal | Échecs | Santé | Progression | Télémétrie | DryRunV2 (créés au premier run).
 * - Index   : catalogue des fichiers traités (sert l'idempotence + la recherche Phase 4).
 * - Journal : log d'exécution + erreurs.
 * Une erreur déclenche TOUJOURS une notif mail immédiate + une ligne de Journal.
 */

// Expéditeurs DE CONFIANCE (clic « pas suspect » 1-clic de l'app, C28-19/ADR-0020).
var COLONNES_CONFIANCE = ['Adresse', 'Ajouté le'];

/** Crée les onglets et leurs en-têtes si absents. */
function initialiserSheet_(ss) {
  creerOnglet_(ss, 'Entités', COLONNES_ENTITES); // cf. COLONNES_ENTITES (9 colonnes, dont Variante possible ? et Vu N fois)
  creerOnglet_(ss, 'Corrections', COLONNES_CORRECTIONS); // apprentissage : doc corrigé → exemples few-shot (ADR-0003)
  creerOnglet_(ss, 'Index', ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance']);
  // #17 : la Sheet existante n'a pas l'en-tête H — réparé ici (initialiserSheet_ ne tourne que
  // quand un onglet manque : coût nul en régime normal).
  var fIndex = ss.getSheetByName('Index');
  if (fIndex && String(fIndex.getRange('H1').getValue()) === '') fIndex.getRange('H1').setValue('Confiance');
  creerOnglet_(ss, 'Journal', ['Horodatage', 'Niveau', 'Source', 'Message']);
  creerOnglet_(ss, 'Échecs', ['Clé', 'Tentatives', 'Dernière tentative']); // compteur de quarantaine
  creerOnglet_(ss, 'Relances', ['Clé', 'Demandé le']); // demandes de relance de quarantaine (app web, ADR-0011)
  creerOnglet_(ss, 'TriAppris', ['Adresse', 'Libellé', 'Appris le']); // table adresse→libellé du tri Gmail (#16)
  creerOnglet_(ss, 'Confiance', COLONNES_CONFIANCE); // expéditeurs « pas suspect » (C28-19, ADR-0020)
  creerOnglet_(ss, 'Réglages', ['Clé', 'Valeur']); // réglages modifiables depuis l'app (#22)
  // Réorg IA (#21) : demandes de l'app + actions proposées/validées/appliquées — machine à états,
  // aucune ligne jamais supprimée (cf. Reorg.gs).
  creerOnglet_(ss, 'Réorg', ['Clé', 'Type', 'ID', 'Chemin actuel', 'Chemin proposé', 'Statut', 'Détail', 'Horodaté']);
  // Seed du réglage #22 (position FIXE : A2/B2 — contrat avec l'app) — seulement si absent.
  var fReg = ss.getSheetByName('Réglages');
  if (fReg && String(fReg.getRange('A2').getValue()) === '') {
    fReg.getRange('A2:B2').setValues([['TICK_MINUTES', CONFIG.TICK_MINUTES]]);
  }
  // C26-07 (ADR-0015) : avant/après du dry-run v2 sur échantillon réel — RAPPORT seul (jamais lu
  // pour l'idempotence, qui vit dans Index via la clé `dryrunv2|<tag>|fileId` comme Migration.gs).
  creerOnglet_(ss, 'DryRunV2', ['Horodaté', 'ID fichier', 'Nom actuel', 'Domaine actuel', 'Chemin actuel',
    'Type v2', 'Domaine proposé', 'Sous-dossier proposé', 'Nom proposé', 'Fail-safe déclenché',
    'Confiance', 'Coût $ mesuré']);
  creerOnglet_(ss, 'Progression', COLONNES_PROGRESSION); // suivi LIVE des opérations (C28-18, cf. majProgressions_)
  creerOnglet_(ss, 'Télémétrie', COLONNES_TELEMETRIE); // coûts & quotas pour l'app (C28-24, cf. majTelemetrie_)
  // C28-26 (ADR-0023) : plan de CONSOLIDATION de l'arborescence — dry-run pur, validé par Marc
  // avant toute exécution. La colonne Empreinte est la mémoire de dédup de la campagne
  // (jamais en Script Properties : ~2 900 empreintes dépasseraient la limite ~9 Ko).
  creerOnglet_(ss, 'PlanConsolidation', COLONNES_PLAN_CONSOLIDATION);
  // C28-33 (ADR-0030) : rapport du RESET — quasi-doublons probables (même nom, taille différente,
  // hors de portée du hash exact) et fichiers NON ROUTÉS restés dans `_TRI 2026` — jamais une
  // mutation, uniquement pour affiner STRUCTURE_CIBLE_RESET ou trancher au cas par cas (Marc).
  creerOnglet_(ss, 'Reset', ['Clé', 'Type', 'Nom', 'Domaine', 'Cible', 'Statut', 'Détail', 'Horodaté']);
  creerOnglet_(ss, 'Santé', ['Santé DriveAI']);                             // vue lisible (heartbeat + métriques, ADR-0006)
  var defaut = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (defaut && ss.getSheets().length > 1) ss.deleteSheet(defaut);
}

function creerOnglet_(ss, nom, entetes) {
  var f = ss.getSheetByName(nom);
  if (!f) {
    f = ss.insertSheet(nom);
    f.appendRow(entetes);
    f.setFrozenRows(1);
  }
}

function feuille_(nom) {
  var ss = getSheetEtat_();
  return ss.getSheetByName(nom) || (initialiserSheet_(ss), ss.getSheetByName(nom));
}

/* ---------- Journal ---------- */

function journalInfo_(source, message) {
  feuille_('Journal').appendRow([new Date(), 'INFO', source, message]);
}

function journalErreur_(source, message) {
  feuille_('Journal').appendRow([new Date(), 'ERREUR', source, message]);
}

/* ---------- Journal borné + onglet Santé (ADR-0006) ---------- */

/**
 * Nombre de lignes de données les plus VIEILLES à supprimer du Journal pour le borner.
 * Logique PURE (testée) : ne déclenche la rotation qu'au-delà de `max + marge` (purge en lot,
 * pas ligne-à-ligne à chaque tick), puis ramène à exactement `max`. En-tête (ligne 1) hors compte.
 * @param {number} dernLigne  résultat de getLastRow() (en-tête inclus)
 * @param {number} max        nb de lignes de données à conserver
 * @param {number} marge      hystérésis : on ne purge que si données > max + marge
 * @return {number} nb de lignes à supprimer à partir de la ligne 2 (0 = rien à faire)
 */
function lignesJournalASupprimer_(dernLigne, max, marge) {
  var donnees = Math.max(0, (dernLigne || 0) - 1); // hors en-tête
  if (donnees <= max + marge) return 0;            // sous le seuil de déclenchement
  return donnees - max;                            // ramène à `max`
}

/**
 * Borne le Journal : supprime en LOT les lignes de log les plus anciennes au-delà du plafond
 * (rotation d'historique — jamais de documents, §2 intact). Enveloppé par l'appelant (secondaire :
 * ne doit jamais bloquer l'intake). Cheap : la plupart des ticks ne font qu'un getLastRow().
 *
 * `reporterSiCharge` (revue #229) : le `deleteRows` de rotation coûte 10-30 s et tombe TOUT À LA FIN
 * du tick — exactement là où il peut franchir le mur des 6 min (le kill perdrait le `finally`, donc
 * `DriveAI_LAST_TICK`, et pourrait laisser un fichier à deux parents entre `addFile` et `removeFile`).
 * La rotation n'a AUCUNE urgence : la reporter d'un tick est sans conséquence.
 * @param {function():boolean} [reporterSiCharge]  vrai ⇒ on ne rotationne pas ce tick-ci
 */
function bornerJournal_(reporterSiCharge) {
  var f = feuille_('Journal');
  var aSupprimer = lignesJournalASupprimer_(f.getLastRow(), CONFIG.JOURNAL_MAX_LIGNES, CONFIG.JOURNAL_MARGE);
  if (aSupprimer <= 0) return; // cas dominant : rien à faire, le garde n'est même pas consulté
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { props = null; }
  if (reporterSiCharge && reporterSiCharge()) {
    // FILET anti-report indéfini (revue sécurité #229) : si une étape prenait l'habitude de courir
    // jusqu'au mur à chaque tick, le report ne journalise rien et le Journal cesserait de tourner EN
    // SILENCE (« un garde-fou qui met des items hors circuit exige un chemin de RETOUR », §7).
    var reports = props ? (Number(props.getProperty('DriveAI_JOURNAL_REPORTS')) || 0) + 1 : 0;
    if (props && reports < CONFIG.JOURNAL_REPORTS_MAX) {
      props.setProperty('DriveAI_JOURNAL_REPORTS', String(reports));
      return; // repris au tick suivant
    }
    journalInfo_('Santé', 'Rotation du Journal FORCÉE après ' + reports + ' report(s) — le tick court au mur à chaque passage.');
  }
  f.deleteRows(2, aSupprimer); // supprime les plus vieilles, juste après l'en-tête
  if (props) { try { props.deleteProperty('DriveAI_JOURNAL_REPORTS'); } catch (e) { /* best-effort */ } }
  journalInfo_('Santé', 'Journal borné : ' + aSupprimer + ' vieille(s) ligne(s) purgée(s) (max ' + CONFIG.JOURNAL_MAX_LIGNES + ').');
}

/**
 * Met à jour l'onglet `Santé` — vue lisible de référence (heartbeat + métriques). Métadonnées
 * seulement (ADR-0007) : horodatage, compteurs, coût, statut — jamais de contenu de document.
 * Écrit après `flushUsage_` (le coût du mois inclut alors le run courant). Enveloppé par l'appelant.
 */
function majSante_() {
  var f = feuille_('Santé');
  var tz = Session.getScriptTimeZone();
  var cout = syntheseCoutMois_();
  var mois = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var nbCatalogue = _indexCache ? Object.keys(_indexCache).length : '—';
  var rangement = (typeof rangementTermine_ === 'function' && rangementTermine_()) ? 'terminé ✅' : 'en cours';
  var lignes = [
    ['Dernier passage OK : ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')],
    ['Documents au catalogue (Index) : ' + nbCatalogue],
    ['Coût LLM ' + mois + ' : ' + cout.dollars.toFixed(2) + ' $  (' + cout.appels + ' appels)  ·  cible < 10 $/mois' + (cout.dollars >= 10 ? '  ⚠️ DÉPASSÉE' : '  ✅')],
    ['Rangement ancien Drive : ' + rangement],
    ['Mis à jour : ' + new Date()]
  ];
  f.getRange(2, 1, lignes.length, 1).setValues(lignes); // une seule écriture Sheet (I/O borné/tick)
}

/* ---------- Progression LIVE des opérations (C28-18) ---------- */

// Contrat avec l'app (interpreterProgression côté React) : 7 colonnes, une ligne par opération.
var COLONNES_PROGRESSION = ['Clé', 'Opération', 'Traités', 'Base', 'Unité', 'Statut', 'Horodaté'];

/**
 * L'onglet Progression v1 était une barre TEXTE mono-opération (rangement, cellules A2:A4).
 * Migration d'en-tête (une fois) : c'était un AFFICHAGE, pas un état — l'état (Properties,
 * Index) est intact ; on repart d'un tableau vierge que `majProgressions_` re-remplit ce tick.
 * @param {Sheet} f
 */
function assurerEnteteProgression_(f) {
  if (String(f.getRange('A1').getValue()) === 'Clé') return;
  f.clearContents();
  f.getRange(1, 1, 1, COLONNES_PROGRESSION.length).setValues([COLONNES_PROGRESSION]);
  f.setFrozenRows(1);
}

/**
 * Construit les lignes de l'onglet Progression. PURE (testée) : tout l'état arrive en paramètres.
 *
 * Règles (leçons « barre de masse ») : le statut dérive des pannes/frein AVANT « en cours » ;
 * une opération « terminé » garde l'horodatage de sa FIN (sinon jamais purgée) et disparaît après
 * `purgeMs` ; une campagne finie AVANT d'avoir eu une ligne n'apparaît jamais (ex. rangement,
 * clos depuis des semaines). (Les « demandes de Marc » tri/intentions ont disparu — ADR-0031.)
 *
 * @param {Object} etat  instantané des opérations (cf. majProgressions_)
 * @param {Object} existantes  clé → {traites:number, statut:string, horodateMs:number}
 * @param {number} maintenantMs
 * @param {number} purgeMs  CONFIG.PROGRESSION_PURGE_MS
 * @return {Array[]} lignes [Clé, Opération, Traités, Base, Unité, Statut, Horodaté]
 */
function lignesProgression_(etat, existantes, maintenantMs, purgeMs) {
  var lignes = [];

  /** Statut d'une CAMPAGNE Drive+LLM (migration, re-analyse, rangement). */
  function statutCampagne(op) {
    if (op.termine) return 'terminé';
    if (op.enAttente) return 'en attente (après m1)';
    if (op.base === null) return 'recensement';
    if (etat.panneApi) return 'suspendu (panne API)';
    if (etat.freinBudget) return 'en pause (frein budget)';
    return 'en cours';
  }

  /** Pousse une ligne en appliquant les règles « terminé » (horodatage figé, purge, jamais-né). */
  function pousser(cle, operation, traites, base, unite, statut) {
    var ex = existantes[cle];
    var horodateMs = maintenantMs;
    if (statut === 'terminé') {
      if (!ex) return; // finie avant d'avoir eu une ligne → rien à montrer
      if (ex.statut === 'terminé') {
        if (maintenantMs - ex.horodateMs > purgeMs) return; // purge des vieux « terminé »
        horodateMs = ex.horodateMs; // l'horodatage de FIN ne bouge plus
      }
      if (traites === null || traites < ex.traites) traites = ex.traites; // numérateur figé à la fin
    }
    lignes.push([cle, operation, traites === null ? '' : traites, base === null ? '' : base,
      unite, statut, new Date(horodateMs)]);
  }

  // (Les « demandes de Marc » tri/intentions n'existent plus — ADR-0031, boutons retirés en
  // C28-41 PR1. Ne restent que les campagnes de fond.)
  pousser('migration', 'Migration taxonomie (' + etat.migration.tag + ')',
    etat.migration.traites, etat.migration.base, 'documents', statutCampagne(etat.migration));
  pousser('reanalyse', 'Re-analyse v2 (' + etat.reanalyse.tag + ')',
    etat.reanalyse.traites, etat.reanalyse.base, 'documents', statutCampagne(etat.reanalyse));
  var statutHisto = etat.histo.termine ? 'terminé'
    : etat.quotaGmail ? 'suspendu (quota Gmail)'
      : etat.freinBudget ? 'en pause (frein budget)' : 'en cours';
  // L'offset histo REPART À 0 aux passes de vérification (position de scan, pas un cumul) :
  // affichage MONOTONE via le max avec la ligne existante — le compteur ne recule jamais.
  var exHisto = existantes['histo-gmail'];
  var traitesHisto = exHisto && !etat.histo.termine
    ? Math.max(etat.histo.traites, exHisto.traites) : etat.histo.traites;
  pousser('histo-gmail', 'Historique Gmail (PJ)', traitesHisto, null, 'fils', statutHisto);
  pousser('rangement', 'Rangement initial du Drive',
    etat.rangement.traites, etat.rangement.base, 'fichiers', statutCampagne(etat.rangement));

  return lignes;
}

/**
 * Écrit l'onglet Progression — appelée dans le `finally` du tick (juste après `majSante_`),
 * enveloppée par l'appelant : un échec ne bloque JAMAIS l'intake. Centralise la LECTURE de
 * l'état (Properties + pannes) et rend TOUT en une écriture `setValues` (+ un `clearContent`
 * du reliquat) — zéro écriture par item, l'app la lit en poll léger (C28-18).
 */
function majProgressions_() {
  var props = PropertiesService.getScriptProperties();
  var f = feuille_('Progression');
  assurerEnteteProgression_(f);
  var maintenant = Date.now();

  var etat = {
    quotaGmail: estPanneGmail_(),
    panneApi: estPannePlateforme_(),
    freinBudget: budgetCampagnesAtteint_(),
    rangement: {
      termine: props.getProperty('DriveAI_RANGEMENT') === CONFIG.RANGEMENT_TAG,
      base: proprieteNombre_(props, 'DriveAI_RANGEMENT_BASE'),
      traites: proprieteNombre_(props, 'DriveAI_RANGEMENT_TRAITES') || 0,
      tag: CONFIG.RANGEMENT_TAG
    },
    migration: {
      termine: props.getProperty('DriveAI_MIGRATION') === CONFIG.MIGRATION_TAG,
      base: proprieteNombre_(props, 'DriveAI_MIGRATION_BASE'),
      traites: proprieteNombre_(props, 'DriveAI_MIGRATION_TRAITES') || 0,
      tag: CONFIG.MIGRATION_TAG
    },
    reanalyse: {
      termine: props.getProperty('DriveAI_REANALYSE') === CONFIG.REANALYSE_TAG,
      enAttente: props.getProperty('DriveAI_MIGRATION') !== CONFIG.MIGRATION_TAG,
      base: proprieteNombre_(props, 'DriveAI_REANALYSE_BASE'),
      traites: proprieteNombre_(props, 'DriveAI_REANALYSE_TRAITES') || 0,
      tag: CONFIG.REANALYSE_TAG
    },
    histo: {
      termine: props.getProperty('DriveAI_GMAIL_HISTO') === 'terminé',
      traites: proprieteNombre_(props, 'DriveAI_GMAIL_HISTO_OFFSET') || 0
    }
  };

  var lignes = lignesProgression_(etat, lireLignesProgression_(f), maintenant, CONFIG.PROGRESSION_PURGE_MS);
  if (lignes.length) f.getRange(2, 1, lignes.length, COLONNES_PROGRESSION.length).setValues(lignes);
  var dern = f.getLastRow();
  if (dern > lignes.length + 1) {
    f.getRange(lignes.length + 2, 1, dern - lignes.length - 1, COLONNES_PROGRESSION.length).clearContent();
  }
}

/** Lit une Script Property numérique : null si ABSENTE (≠ 0 — « pas encore recensé »). */
function proprieteNombre_(props, cle) {
  var v = props.getProperty(cle);
  return v === null ? null : (Number(v) || 0);
}

/** Lit les lignes actuelles de Progression : clé → {traites, statut, horodateMs}. */
function lireLignesProgression_(f) {
  var existantes = {};
  var dern = f.getLastRow();
  if (dern < 2) return existantes;
  var v = f.getRange(2, 1, dern - 1, COLONNES_PROGRESSION.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (!v[i][0]) continue;
    var h = v[i][6];
    existantes[v[i][0]] = {
      traites: Number(v[i][2]) || 0,
      statut: String(v[i][5]),
      horodateMs: h instanceof Date ? h.getTime() : (Date.parse(String(h)) || 0)
    };
  }
  return existantes;
}

/* ---------- Télémétrie coûts & quotas (C28-24) ---------- */

// Contrat avec l'app (interpreterTelemetrie côté React, PR3 C28-24) : 4 colonnes, une ligne par
// métrique — les CLÉS sont stables (l'app s'y accroche), la Valeur est brute, le Détail est humain.
var COLONNES_TELEMETRIE = ['Clé', 'Valeur', 'Unité', 'Détail'];

// Plan de consolidation C28-26 (ADR-0023, cf. Consolidation.gs). L'Empreinte (MD5) est une
// MÉTADONNÉE (ADR-0007) : jamais de contenu de document dans l'état.
var COLONNES_PLAN_CONSOLIDATION = ['Horodaté', 'Fichier', 'ID', 'Action', 'Cible', 'Raison', 'Empreinte'];

/**
 * Construit les lignes de l'onglet Télémétrie. PURE (testée) : tout l'état arrive en paramètres,
 * seuls les plafonds sont lus dans CONFIG (constantes). Ne jamais renommer une clé sans migrer
 * `interpreterTelemetrie` côté app.
 * @param {{quotaSuspendu:boolean, reprise:string, histoFilsJour:number, cycliqueFilsJour:number,
 *          boiteFilsJour:number, coutDollars:number, coutAppels:number}} d
 * @return {Array[]} lignes [Clé, Valeur, Unité, Détail]
 */
function lignesTelemetrie_(d) {
  return [
    ['quota_gmail_etat', d.quotaSuspendu ? 'suspendu' : 'actif', '',
      d.quotaSuspendu ? d.reprise : ''],
    ['gmail_histo_fils_jour', d.histoFilsJour, 'fils', 'Plafond ' + CONFIG.GMAIL_HISTO_MAX_FILS_JOUR + '/j'],
    ['tri_cyclique_fils_jour', d.cycliqueFilsJour, 'fils', 'Plafond ' + CONFIG.TRI_CYCLIQUE_MAX_FILS_JOUR + '/j'],
    ['tri_boite_fils_jour', d.boiteFilsJour, 'fils', 'Plafond ' + CONFIG.TRI_BOITE_MAX_FILS_JOUR + '/j'],
    ['llm_cout_mois', d.coutDollars, '$', 'Frein campagnes à ' + CONFIG.LLM_BUDGET_CAMPAGNES + ' $'],
    ['llm_appels_mois', d.coutAppels, 'appels', '']
  ];
}

/**
 * Lit un compteur quotidien `<prefixe>_JOUR` / `<prefixe>_FILS_JOUR` (patron C28-21) : la valeur
 * ne vaut que si la date persistée est CELLE D'AUJOURD'HUI — sinon 0 (le compteur de la veille
 * n'a pas encore été purgé par son écrivain, il ne doit jamais s'afficher comme celui du jour).
 */
function compteurFilsJour_(props, prefixe, aujourdhui) {
  return props.getProperty(prefixe + '_JOUR') === aujourdhui
    ? Number(props.getProperty(prefixe + '_FILS_JOUR')) || 0
    : 0;
}

/**
 * Écrit l'onglet Télémétrie (C28-24) — l'état des quotas Gmail et du coût LLM que l'app affiche
 * dans « Coûts & quotas » (PR3). Appelée dans le `finally` du tick (après `majProgressions_`),
 * enveloppée par l'appelant : un échec ne bloque JAMAIS l'intake. Métadonnées seulement
 * (ADR-0007) : compteurs, plafonds, états — jamais de contenu. Tout est rendu en UNE écriture
 * `setValues` (+ un `clearContent` du reliquat) — l'app la lit en poll léger, comme Progression.
 */
function majTelemetrie_() {
  var props = PropertiesService.getScriptProperties();
  var aujourdhui = dateGmail_(new Date());
  var quotaDepuis = Number(props.getProperty('DriveAI_GMAIL_QUOTA')) || 0;
  var suspendu = !!quotaDepuis && Date.now() - quotaDepuis < CONFIG.GMAIL_QUOTA_RESONDE_MS;
  var reprise = '';
  if (suspendu) {
    reprise = 'Reprise vers ' + Utilities.formatDate(
      new Date(quotaDepuis + CONFIG.GMAIL_QUOTA_RESONDE_MS), Session.getScriptTimeZone(), 'HH:mm');
  }
  var cout = syntheseCoutMois_();
  var lignes = lignesTelemetrie_({
    quotaSuspendu: suspendu,
    reprise: reprise,
    histoFilsJour: compteurFilsJour_(props, 'DriveAI_GMAIL_HISTO', aujourdhui),
    cycliqueFilsJour: compteurFilsJour_(props, 'DriveAI_TRI_CYCLIQUE', aujourdhui),
    boiteFilsJour: compteurFilsJour_(props, 'DriveAI_TRI_BOITE', aujourdhui),
    coutDollars: cout.dollars,
    coutAppels: cout.appels
  });
  var f = feuille_('Télémétrie');
  f.getRange(2, 1, lignes.length, COLONNES_TELEMETRIE.length).setValues(lignes);
  var dern = f.getLastRow();
  if (dern > lignes.length + 1) {
    f.getRange(lignes.length + 2, 1, dern - lignes.length - 1, COLONNES_TELEMETRIE.length).clearContent();
  }
}

/**
 * Échec : ligne d'erreur + notif mail immédiate à soi-même.
 * @param {string} source
 * @param {string} message
 */
function notifierEchec_(source, message) {
  // Décision Marc 2026-07-06 (calibrage) : AUCUN mail d'alerte immédiat — tout se découvre au
  // résumé hebdo (compteur d'erreurs + quarantaines ; la liste vit dans l'app avec « Relancer »).
  // L'auto-réparation du chien de garde reste entièrement active ; seul le MAIL disparaît.
  // (Revenir en arrière = restaurer l'envoi via emailAlerte_ ici et dans alerterChienDeGarde_.)
  journalErreur_(source, message);
}

/**
 * Destinataire des alertes et mails du moteur — check-up 2026-07-03 : `Session.getEffectiveUser()`
 * exige un scope (userinfo.email) ABSENT du manifeste → l'appel LÈVE et toutes les alertes
 * échouaient en silence depuis le début (597 tentatives mortes constatées, résumé hebdo compris).
 * On n'ajoute PAS le scope (leçon durable : tout nouveau scope FIGE les déclencheurs jusqu'à
 * ré-autorisation manuelle de Marc) : l'adresse vit dans la Script Property `DriveAI_EMAIL`
 * (posée une fois, comme la clé API), avec repli best-effort sur Session au cas où le scope
 * existerait un jour. Ne lève JAMAIS.
 * @return {string} adresse mail, ou '' si indisponible (l'appelant journalise sans envoyer).
 */
function emailAlerte_() {
  var e = '';
  try { e = PropertiesService.getScriptProperties().getProperty('DriveAI_EMAIL') || ''; } catch (err) { }
  if (e) return e;
  try { return Session.getEffectiveUser().getEmail(); } catch (err) { return ''; }
}

/* ---------- Index (idempotence) ---------- */

/**
 * Clé stable d'une pièce jointe. Inclut l'index de PJ pour distinguer deux PJ
 * jumelles (même nom + même taille) dans un même message.
 * @param {GmailMessage} message
 * @param {number} indexPj
 * @param {GmailAttachment} pj
 * @return {string}
 */
function cleAttachement_(message, indexPj, pj) {
  return message.getId() + '|' + indexPj + '|' + pj.getName() + '|' + pj.getSize();
}

// Caches chargés une fois par run (évite une lecture Sheet par PJ) :
//  _indexCache          : clés d'idempotence déjà traitées
//  _empreintesCache     : empreintes de contenu déjà vues (détection de doublons)
//  _empreintesParIdCache: fileId → empreinte DÉJÀ CALCULÉE (évite de re-télécharger les octets)
//  _echecsCache         : clé → { tentatives, ligne } (compteur de quarantaine)
var _indexCache = null;
var _empreintesCache = null;
var _empreintesParIdCache = null;
var _echecsCache = null;

/** À appeler en tête de chaque run pour repartir de caches neufs. */
function reinitialiserIndexCache_() {
  _indexCache = null;
  _empreintesCache = null;
  _empreintesParIdCache = null;
  _echecsCache = null;
}

/**
 * Préfixes de clé d'Index qui identifient UN FICHIER (leur dernier segment est un fileId Drive).
 * Whitelist EXPLICITE — « périmètre défini par IDENTITÉ » (§7) : une clé Gmail
 * (`messageId|i|nom|taille`, `tri|fil|ts|lu`) ne doit JAMAIS être lue comme un fileId, sinon une
 * empreinte serait attribuée au MAUVAIS fichier et un original partirait dans `_Doublons`.
 *
 * `conso` en est VOLONTAIREMENT absent (revue sécurité #229) : une de ses formes est
 * `conso|<tag>|dom|<domaine>`, qui ne finit PAS par un fileId. Elle n'échappe aujourd'hui que grâce
 * aux espaces des noms de domaine — une propriété de `CONFIG.DOMAINES`, pas un invariant. Et conso
 * n'inscrit JAMAIS d'empreinte à l'Index : l'y whitelister n'apportait rien.
 * `shared|<fileId>` est exclu pour une autre raison : le fileId y est celui de l'ORIGINAL chez le
 * tiers, jamais du fichier présent chez Marc (le partage dépose une COPIE).
 */
var PREFIXES_CLE_FICHIER_ = { drive: 1, tri33p: 1, migre: 1, reanalyse: 1 };

/**
 * fileId porté par une clé d'Index documentaire, ou '' si la clé n'en porte pas. PURE.
 * Double garde : préfixe whitelisté ET dernier segment de la FORME d'un ID Drive.
 */
function fileIdDeCleIndex_(cle) {
  var parts = String(cle == null ? '' : cle).split('|');
  if (parts.length < 2) return '';
  if (PREFIXES_CLE_FICHIER_[parts[0]] !== 1) return '';
  var id = parts[parts.length - 1];
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : '';
}

/**
 * Empreinte DÉJÀ connue pour ce fichier, ou '' — permet de ne PAS re-télécharger ses octets
 * (`empreinteBlob_`, poste le plus cher du placement du reset). Rend notamment quasi gratuit un bump
 * de `CONFIG.RESET_TABLE_VERSION` : le reliquat re-tenté a déjà son empreinte à l'Index (revue #229).
 */
function empreinteConnueParId_(fileId) {
  if (_empreintesParIdCache === null) chargerIndexCache_();
  return _empreintesParIdCache[fileId] || '';
}

function chargerIndexCache_() {
  _indexCache = {};
  _empreintesCache = {};
  _empreintesParIdCache = {};
  var f = feuille_('Index');
  // Auto-réparation : assure la colonne « Empreinte » (G) sur un Index existant.
  if (f.getRange(1, 7).getValue() !== 'Empreinte') f.getRange(1, 7).setValue('Empreinte');

  var dern = f.getLastRow();
  if (dern < 2) return;
  var valeurs = f.getRange(2, 1, dern - 1, 7).getValues(); // colonnes A..G
  for (var i = 0; i < valeurs.length; i++) {
    if (valeurs[i][0]) _indexCache[valeurs[i][0]] = true;
    if (!valeurs[i][6]) continue;
    _empreintesCache[valeurs[i][6]] = true;
    // DERNIÈRE ligne gagnante (revue sécurité #229) : l'Index est append-only, donc l'ordre des
    // lignes est chronologique. Garder la PREMIÈRE ferait gagner l'empreinte la plus ANCIENNE — un
    // fichier ré-analysé (`reanalyse|…`) après un `drive|…` aurait vu la périmée l'emporter. C'est
    // aussi la sémantique de `indexAjouter_`, qui écrase avec la valeur la plus récente.
    var fid = fileIdDeCleIndex_(valeurs[i][0]);
    if (fid) _empreintesParIdCache[fid] = String(valeurs[i][6]);
  }
}

/**
 * @return {boolean} vrai si la clé est déjà dans l'Index.
 * NB. ÉPINGLÉ Marc (C28-30/ADR-0026) : un fichier rangé à la main via le chat porte la clé DÉDIÉE
 * `epingle|<fileId>` (posée par Reorg.appliquerDeplacerFichier_). Les prédicats de re-rangement auto
 * (consolidation, migration, réanalyse, grand rangement) testent cette PRÉSENCE via `indexContient_`
 * pour l'IMMUNISER (convergence). Clé dédiée car `drive|<fileId>` est déjà le namespace des dépôts
 * classés (le réutiliser sur-filtrerait) et aucun helper ne lit le statut par clé.
 */
function indexContient_(cle) {
  if (_indexCache === null) chargerIndexCache_();
  return _indexCache[cle] === true;
}

/** @return {boolean} vrai si cette empreinte de contenu a déjà été vue (doublon). */
function estDoublon_(empreinte) {
  if (_empreintesCache === null) chargerIndexCache_();
  return _empreintesCache[empreinte] === true;
}

/**
 * Enregistre un fichier traité. L'inscription Index (« c'est fini ») est écrite en DERNIER :
 * si une coupure survient avant, la PJ reste non-indexée donc re-traitée (jamais perdue).
 * (Le statut 'revue' n'est plus produit par le pipeline depuis 2026-07-01 — la branche Revue
 * ci-dessous ne sert que d'éventuelle compat de lignes historiques.)
 * @param {string} cle
 * @param {{statut:string, domaine:string, chemin:string, nom:string}} resultat
 * @param {string} [empreinte]  empreinte MD5 du contenu (détection de doublons)
 */
function indexAjouter_(cle, resultat, empreinte) {
  feuille_('Index').appendRow([
    cle, new Date(), resultat.nom, resultat.domaine || '', resultat.chemin || '',
    resultat.statut, empreinte || '',
    // #17 (App v3 « Documents ») : confiance du classement — vide pour tout ce qui n'est pas
    // une classification LLM (mails, doublons, quarantaine…).
    resultat.confiance != null && resultat.confiance !== '' ? resultat.confiance : ''
  ]);
  if (_indexCache !== null) _indexCache[cle] = true;
  if (_empreintesCache !== null && empreinte) _empreintesCache[empreinte] = true;
  if (_empreintesParIdCache !== null && empreinte) {
    var fid = fileIdDeCleIndex_(cle);
    if (fid) _empreintesParIdCache[fid] = empreinte;
  }
}

/**
 * PURGE les lignes d'ÉTAT DU TRI d'un fil (clés `tri|<threadId>|…`) pour forcer son re-tri —
 * « pas suspect » 1-clic (C28-19, ADR-0020). Ne touche QUE des lignes d'état du tri Gmail,
 * jamais une ligne documentaire ; appelée SOUS le verrou du tick (appliquerPasSuspect_), jamais
 * depuis doPost. Ordre décroissant (pas de décalage d'indices) ; cache du run invalidé.
 * @param {string} threadId
 * @return {number} lignes purgées
 */
function purgerClesTriIndex_(threadId) {
  var f = feuille_('Index');
  var dern = f.getLastRow();
  if (dern < 2) return 0;
  var prefixe = 'tri|' + threadId + '|';
  var v = f.getRange(2, 1, dern - 1, 1).getValues();
  var lignes = [];
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).indexOf(prefixe) === 0) lignes.push(i + 2);
  }
  for (var j = lignes.length - 1; j >= 0; j--) f.deleteRow(lignes[j]);
  if (_indexCache !== null) {
    for (var k in _indexCache) { if (k.indexOf(prefixe) === 0) delete _indexCache[k]; }
  }
  return lignes.length;
}

/* ---------- Quarantaine (compteur d'échecs) ---------- */

/** Charge l'onglet « Échecs » en cache (clé → {tentatives, ligne}) — 1× par run. */
function chargerEchecsCache_() {
  _echecsCache = {};
  var f = feuille_('Échecs');
  var dern = f.getLastRow();
  if (dern < 2) return;
  var v = f.getRange(2, 1, dern - 1, 2).getValues(); // A=Clé, B=Tentatives
  for (var i = 0; i < v.length; i++) {
    if (v[i][0]) _echecsCache[v[i][0]] = { tentatives: Number(v[i][1]) || 0, ligne: i + 2 };
  }
}

/**
 * Incrémente le compteur d'échecs d'une clé et renvoie le nouveau total. Crée la ligne si absente.
 * @param {string} cle
 * @return {number} nombre de tentatives échouées (incluant celle-ci).
 */
function incrementerEchec_(cle) {
  if (_echecsCache === null) chargerEchecsCache_();
  var f = feuille_('Échecs');
  var e = _echecsCache[cle];
  if (e) {
    e.tentatives += 1;
    f.getRange(e.ligne, 2, 1, 2).setValues([[e.tentatives, new Date()]]);
    return e.tentatives;
  }
  f.appendRow([cle, 1, new Date()]);
  _echecsCache[cle] = { tentatives: 1, ligne: f.getLastRow() };
  return 1;
}
// (Pas d'effacement sur succès : un doc qui réussit est inscrit à l'Index avec un statut
//  terminal → jamais re-traité, donc son compteur d'échecs devient mort. On évite ainsi de
//  charger l'onglet « Échecs » sur le chemin nominal — il n'est touché que lors d'un échec.)
