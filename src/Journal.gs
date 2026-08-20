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
  // ADR-0034 §5 : comparaison 1↔2 passes — PREUVE avant d'allumer la 2ᵉ passe conditionnelle.
  // RAPPORT seul (idempotence dans Index via `dryruncmp|<tag>|fileId`). Pour chaque doc : le gate
  // (sauterait la passe 2 ?), le placement 1 passe vs 2 passes, et les FAUX NÉGATIFS `sensible`.
  creerOnglet_(ss, 'DryRunV2Compare', ['Horodaté', 'ID fichier', 'Nom actuel', 'Domaine actuel',
    'Chemin actuel', 'Gate : sauterait passe 2', 'Placement 1 passe', 'Placement 2 passes',
    'Placement identique', 'Champs corrigés par passe 2', 'Sensible 1p', 'Sensible 2p',
    'Faux négatif sensible', 'Verdict du saut', 'Confiance 1p', 'Coût passe 1 $', 'Coût passe 2 $']);
  // Chantier #47 (ADR-0036) : plan de FUSION des dossiers d'entité en double — dry-run pur, curé par
  // Marc (colonne Action : Fusionner/Ignorer) avant toute exécution (PR2). Aucune mutation ici.
  creerOnglet_(ss, 'PlanFusion', COLONNES_PLAN_FUSION);
  creerOnglet_(ss, 'Progression', COLONNES_PROGRESSION); // suivi LIVE des opérations (C28-18, cf. majProgressions_)
  creerOnglet_(ss, 'Télémétrie', COLONNES_TELEMETRIE); // coûts & quotas pour l'app (C28-24, cf. majTelemetrie_)
  creerOnglet_(ss, 'Coûts', COLONNES_COUTS);          // ventilation du coût LLM par usage (C28-58)
  // C28-49 PR2 : rapport des mois de PAIE manquants par employeur (mission `paies`, self-serve,
  // cf. ecrireRapportPaies_). Onglet OUBLIÉ ici à la livraison → `feuille_('RapportPaies')` rendait
  // null et la mission plantait à CHAQUE tick (`getRange of null`, révélé par le MCP le 19/08).
  creerOnglet_(ss, 'RapportPaies', COLONNES_RAPPORT_PAIES); // constante partagée (Missions.gs)
  creerOnglet_(ss, 'RapportDoublons', COLONNES_RAPPORT_DOUBLONS); // constante partagée (Doublons.gs)
  // C28-26 (ADR-0023) : plan de CONSOLIDATION de l'arborescence — dry-run pur, validé par Marc
  // avant toute exécution. La colonne Empreinte est la mémoire de dédup de la campagne
  // (jamais en Script Properties : ~2 900 empreintes dépasseraient la limite ~9 Ko).
  creerOnglet_(ss, 'PlanConsolidation', COLONNES_PLAN_CONSOLIDATION);
  // C28-33 (ADR-0030) : rapport du RESET — quasi-doublons probables (même nom, taille différente,
  // hors de portée du hash exact) et fichiers NON ROUTÉS restés dans `_TRI 2026` — jamais une
  // mutation, uniquement pour affiner STRUCTURE_CIBLE_RESET ou trancher au cas par cas (Marc).
  creerOnglet_(ss, 'Reset', ['Clé', 'Type', 'Nom', 'Domaine', 'Cible', 'Statut', 'Détail', 'Horodaté']);
  creerOnglet_(ss, 'Santé', ['Santé DriveAI']);                             // vue lisible (heartbeat + métriques, ADR-0006)
  // Journal QUOTIDIEN du vrac par domaine (HistoriqueVrac.gs, demande Marc 2026-08-12) : APPEND-ONLY
  // (jamais réécrit, contrairement à Progression/Santé) — construit une série temporelle jour après
  // jour, jusqu'à la fin du drainage.
  creerOnglet_(ss, 'HistoriqueVrac', COLONNES_HISTORIQUE_VRAC);
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
 * Ligne « API Tasks & Calendar » de l'onglet Santé. PURE (testée).
 *
 * C28-48 : sans elle, une API non activée dans le projet GCP n'était visible que par une erreur
 * TRONQUÉE dans Progression (« config-api Calendar : { error : { ») et une ligne de Journal
 * illisible à distance. Ici on affiche le message EXPLOITABLE (numéro de projet GCP + URL
 * d'activation), donc de quoi trancher « pas activée » vs « activée dans un AUTRE projet ».
 *
 * HONNÊTETÉ (revue quotas C28-48) : hors panne, on n'affirme PAS que la création est
 * « opérationnelle » — rien ne l'a vérifiée. On dit « aucune panne détectée », et on ne date le
 * constat que si une SONDE a réellement répondu (`sondeOkMs`).
 * @param {{actif:boolean, depuisMs:number, message:string, sondeOkMs:number}} etat  cf. `etatPanneConfigApi_`
 * @param {string} tz
 * @return {string}
 */
function texteSanteConfigApi_(etat, tz) {
  if (!etat || !etat.actif) {
    return etat && etat.sondeOkMs
      ? '✅ actives (sondées le ' + Utilities.formatDate(new Date(etat.sondeOkMs), tz, 'dd/MM HH:mm') + ')'
      : '✅ aucune panne détectée';
  }
  var depuis = etat.depuisMs
    ? ' (depuis le ' + Utilities.formatDate(new Date(etat.depuisMs), tz, 'dd/MM HH:mm') + ')'
    : '';
  // Verdict de la dernière sonde affiché EXPLICITEMENT : une sonde qui ne conclut jamais
  // (« indetermine » à répétition) doit se voir, sinon la reprise peut être morte en silence.
  // Titre neutre sur la CAUSE (ADR-0041) : la panne peut venir d'une API non activée dans le
  // projet hubperso OU d'un compte hubperso non lié/révoqué — c'est `etat.message` qui dit lequel.
  var sonde = etat.sonde ? '  ·  dernière sonde : ' + etat.sonde : '';
  return '⚠️ INDISPONIBLES (API hubperso non activée, ou compte non lié) — intentions mail suspendues' + depuis +
    ', re-sonde automatique (au plus 1×/' + Math.round(CONFIG.PANNE_CONFIG_SONDE_MS / 60000) +
    ' min)' + sonde + (etat.message ? '  ·  ' + etat.message : '');
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
    ['API Tasks & Calendar : ' + texteSanteConfigApi_(etatPanneConfigApi_(), tz)],
    // ADR-0043 : le mode DÉGRADÉ du tri doit se DIRE. Sans cette ligne, « le tri marche » masque
    // « il n'archive plus » et la dette (fils à ré-évaluer au retour) reste invisible.
    ['Tri Gmail : ' + texteSanteTriDegrade_()],
    // Validation de `_Doublons` (ADR-0047) : le registre de suivi C28-44 est SATURÉ (8 377 des
    // 8 500 octets du plafond dérivé, ~199 par entrée) — une 43ᵉ clé le ferait déborder. La
    // campagne se rend donc visible ICI, comme « Rangement ancien Drive », sans coûter un octet
    // de Property (ADR-0047 §6, backlog C28-71).
    ['Doublons (validation par empreinte) : ' + texteSanteDoublons_()],
    ['Mis à jour : ' + new Date()]
  ];
  f.getRange(2, 1, lignes.length, 1).setValues(lignes); // une seule écriture Sheet (I/O borné/tick)
}

/**
 * Ligne Santé du tri Gmail (ADR-0043). Lecture seule, aucune décision.
 *
 * TROIS états, pas deux (revue flotte C28-54, les DEUX agents) : une panne de compte LLM ne
 * DÉGRADE pas le tri, elle l'ARRÊTE — `Main.gs` saute l'étape `tri-gmail` entière sous
 * `estPannePlateforme_()`. Annoncer « libellés posés » dans ce cas serait un mensonge sur le seul
 * canal que Marc lit (no-fake-data, §7). On teste donc l'arrêt AVANT la dégradation.
 *
 * On interroge les prédicats de panne DIRECTEMENT plutôt que `intentionsSuspendues_()` : celui-ci
 * avale ses exceptions et rend `false`, ce qui afficherait « ✅ normal » sur un état ILLISIBLE —
 * exactement ce que ce try/catch veut éviter (revue code C28-54 : le catch était mort).
 * @return {string}
 */
function texteSanteTriDegrade_() {
  var arret, degrade;
  try {
    arret = !!estPannePlateforme_();
    degrade = !!estPanneConfigApi_();
  } catch (e) {
    return 'état indéterminé (lecture de l\'état impossible)';
  }
  if (arret) {
    return '⛔ À L\'ARRÊT (panne de compte LLM) — aucun tri ce tick ; reprise automatique ' +
      'dès que la re-sonde voit le compte rétabli';
  }
  return degrade
    ? '⚠️ mode DÉGRADÉ (analyse d\'intentions suspendue) — libellés posés, AUCUN archivage ; ' +
      'les fils seront ré-évalués automatiquement au retour des intentions'
    : '✅ normal (libellés + archivage)';
}

/* ---------- Progression LIVE des opérations (C28-18) ---------- */

// Contrat avec l'app (interpreterProgression côté React) : 7 colonnes, une ligne par opération.
// C28-44 (ADR-0038) : 7 → 10 colonnes. `Horodaté` RESTE en G (position historique) et les
// nouvelles colonnes s'AJOUTENT après — l'app v6 (qui lit `A2:G30` jusqu'à la PR4) continue ainsi
// de lire EXACTEMENT les 7 mêmes colonnes pendant la transition, et tous les consommateurs
// indexés 0-6 restent valides (déviation assumée de l'ordre esquissé dans l'ADR §2d, pour ça).
// PR6 (retour Marc) : + `Type` (K, APPEND en queue — leçon §7) : le type du registre (flux/
// campagne/maintenance/demande/observabilite) permet à l'app de COMPACTER les routines et de ne
// mettre en avant que les vraies campagnes.
// C28-47 (demande Marc) : + `Dernière passe` (L) et `Fin estimée` (M) — toujours en APPEND.
var COLONNES_PROGRESSION = ['Clé', 'Opération', 'Traités', 'Base', 'Unité', 'Statut', 'Horodaté',
  'Détail', 'Dernière activité', 'Dernière erreur', 'Type', 'Dernière passe', 'Fin estimée'];

/**
 * L'onglet Progression v1 était une barre TEXTE mono-opération (rangement, cellules A2:A4).
 * Migration d'en-tête (une fois) : c'était un AFFICHAGE, pas un état — l'état (Properties,
 * Index) est intact ; on repart d'un tableau vierge que `majProgressions_` re-remplit ce tick.
 * @param {Sheet} f
 */
function assurerEnteteProgression_(f) {
  // Migration v2 (7 col) → v3 (10) → v4 (11, + Type — PR6) : le test porte sur la DERNIÈRE
  // colonne attendue — jamais `A1 === 'Clé'`, VRAI avant ET après l'extension (la réparation
  // serait du code mort, leçon 2026-08-13 « point d'attache »). Chemin ATTEIGNABLE garanti :
  // appelée par `majProgressions_` à CHAQUE tick, pas par `initialiserSheet_` (qui ne retouche
  // jamais un onglet existant).
  if (String(f.getRange('M1').getValue()) === COLONNES_PROGRESSION[12]) return;
  // v1 (barre TEXTE mono-opération, A1 ≠ 'Clé') : table incompatible → on repart de zéro (c'était
  // un AFFICHAGE, pas un état). v2/v3 → v4 : préfixe de colonnes IDENTIQUE — les lignes
  // existantes restent lisibles telles quelles (`lireLignesProgression_` lit les indices 0-6,
  // inchangés) et sont réécrites au format courant par ce même tick ; seul l'en-tête est réécrit.
  if (String(f.getRange('A1').getValue()) !== 'Clé') f.clearContents();
  f.getRange(1, 1, 1, COLONNES_PROGRESSION.length).setValues([COLONNES_PROGRESSION]);
  f.setFrozenRows(1);
}

/**
 * Construit les lignes de l'onglet Progression. PURE (testée) : tout l'état arrive en paramètres.
 *
 * C28-44 (ADR-0038) : la fonction ITÈRE LE REGISTRE (Suivi.gs) — une ligne PAR opération du tick,
 * dans l'ordre d'exécution, plus jamais une liste codée en dur. Les campagnes à lecteurs dédiés
 * (migration, réanalyse, histo, rangement, conso gen/exec) gardent leurs Traités/Base/statuts
 * RICHES (recensement, en attente, terminé + purge) ; toutes les autres opérations dérivent leur
 * statut du SUIVI réel (`statutDepuisSuivi_` : erreur / suspendu+raison / en pause / en cours).
 * Les 3 colonnes nouvelles (Détail, Dernière activité, Dernière erreur) viennent du suivi pour
 * TOUTES les lignes, campagnes comprises.
 *
 * Règles conservées (leçons « barre de masse ») : le statut d'une campagne dérive des pannes/frein
 * AVANT « en cours » ; une opération « terminé » garde l'horodatage de sa FIN (sinon jamais
 * purgée) et disparaît après `purgeMs` ; une campagne finie AVANT d'avoir eu une ligne n'apparaît
 * jamais. (Les « demandes de Marc » tri/intentions ont disparu — ADR-0031.)
 *
 * @param {Object} etat  instantané des opérations (cf. majProgressions_)
 * @param {Object} existantes  clé → {traites:number, statut:string, horodateMs:number}
 * @param {number} maintenantMs
 * @param {number} purgeMs  CONFIG.PROGRESSION_PURGE_MS
 * @param {Object} suivi  vue fusionnée `suiviOpsFusionne_` — clé → {t, ok, d, et, e, st, s}
 * @param {Array<Object>} registre  REGISTRE_OPERATIONS (Suivi.gs)
 * @return {Array[]} lignes [Clé, Opération, Traités, Base, Unité, Statut, Horodaté, Détail, Dernière activité, Dernière erreur]
 */
function lignesProgression_(etat, existantes, maintenantMs, purgeMs, suivi, registre, debits) {
  var lignes = [];
  var tz = Session.getScriptTimeZone();
  var typePar = {}, libellePar = {};
  (registre || []).forEach(function (op) { typePar[op.cle] = op.type; libellePar[op.cle] = op.libelle; });

  /** « il y a X » (min/h/j) — même vocabulaire que l'app, calculé UNE fois ici. */
  function depuis(ms) {
    var min = Math.max(0, Math.round(ms / 60000));
    if (min < 60) return 'il y a ' + min + ' min';
    var h = Math.round(min / 60);
    return h < 48 ? 'il y a ' + h + ' h' : 'il y a ' + Math.round(h / 24) + ' j';
  }

  /** Durée lisible d'un horizon (« ~3 h », « ~2 j ») — au plus 2 chiffres significatifs. */
  function horizon(ms) {
    var h = ms / 3600000;
    if (h < 1) return '~' + Math.max(1, Math.round(ms / 60000)) + ' min';
    if (h < 48) return '~' + Math.round(h) + ' h';
    return '~' + Math.round(h / 24) + ' j';
  }

  /**
   * Les 2 colonnes d'AVANCEMENT (C28-47) : volume de la dernière passe productive, et estimation
   * de fin DÉTAILLÉE. L'estimation dit la vérité sur les PAUSES : une campagne bloquée par le
   * frein mensuel annonce sa reprise au 1er du mois prochain (jamais une date « dans 3 h » qui
   * ignorerait le blocage), une pause quotidienne annonce « reprise demain ».
   */
  function colonnesAvancement(cle, unite, traites, base, statut) {
    var d = (debits || {})[cle];
    var passe = d && d.dn > 0 && d.dts
      ? '+' + d.dn + (unite ? ' ' + unite : '') + ' · ' + depuis(maintenantMs - d.dts) : '';
    var est = estimationFin_(d, traites, base, maintenantMs);
    // EN PAUSE (« suspendu … » OU « en pause … ») : on annonce le RESTE mais JAMAIS un horizon ni
    // une date de fin — le débit amortit les pauses PASSÉES, il ne peut pas connaître un gel FUTUR
    // (revue C28-47 : sans ce garde, la ré-analyse bloquée par le frein MENSUEL affichait « vers le
    // 18/08 » à côté de « reprise le 01/09 » — une fin AVANT la reprise, exactement le mensonge que
    // cette colonne doit empêcher).
    // ⚠️ « À JOUR » compte AUSSI (retour Marc du 2026-08-20 : « bizarre je vois encore des
    // missions … Fin estimée : ~92 j · vers le 20/11 »). Une mission CONVERGÉE à reliquat a fini
    // son passage : ses non-appariés sont des REFUS versionnés qui attendent un affinage de
    // RÈGLES, pas du débit (c'est déjà ce que dit la doc de `pousserMission`). Extrapoler un débit
    // MORT annonçait une date que rien ne produira — même famille de mensonge que la pause, qui
    // avait motivé ce garde. Les 3 familles de statut sans débit attendu sont donc traitées
    // ensemble, et testées une par une.
    var sansDebit = !!statut && /^(suspendu|en pause|à jour)/.test(statut);
    var bouts = [];
    if (est) {
      bouts.push('reste ' + est.restant + (unite ? ' ' + unite : ''));
      if (!sansDebit) {
        bouts.push(horizon(est.msRestants));
        bouts.push('vers le ' + Utilities.formatDate(new Date(maintenantMs + est.msRestants), tz, 'dd/MM'));
      }
    }
    // Reprise : ce que la PAUSE implique réellement, en clair.
    if (statut && statut.indexOf('frein budget') !== -1) {
      var moisProchain = new Date(maintenantMs);
      moisProchain.setMonth(moisProchain.getMonth() + 1, 1);
      bouts.push('reprise le ' + Utilities.formatDate(moisProchain, tz, 'dd/MM') + ' (frein mensuel)');
    } else if (statut && statut.indexOf('budget du jour') !== -1) {
      bouts.push('reprise demain');
    } else if (statut && statut.indexOf('non apparié') !== -1) {
      // Dire ce qui débloque RÉELLEMENT, au lieu d'une date : ces fichiers attendent une décision
      // de Marc, pas du temps machine.
      bouts.push('attend un affinage des règles');
    }
    return [passe, bouts.join(' · ')];
  }

  /** Les 3 colonnes de SUIVI d'une opération (communes à toutes les lignes). */
  function colonnesSuivi(cle) {
    var rec = (suivi || {})[cle];
    if (!rec) return ['', '', ''];
    var dernierEvt = Math.max(rec.ok || 0, rec.et || 0, rec.st || 0);
    var detail = rec.st && rec.st >= dernierEvt ? (rec.s || '') : '';
    var activite = Math.max(rec.t || 0, rec.ok || 0);
    var erreur = rec.et
      ? Utilities.formatDate(new Date(rec.et), tz, 'dd/MM HH:mm') + (rec.e ? ' — ' + rec.e : '')
      : '';
    // Activité en TEXTE au format CONTRÔLÉ `dd/MM HH:mm` (retour Marc PR6 : une cellule Date
    // ressortait « 8/13/2026 » sans l'heure via l'API en FORMATTED_VALUE — inutilisable ; le
    // format contrôlé rend aussi le « il y a X min » de l'app fiable, jamais un parsing de locale).
    return [detail, activite ? Utilities.formatDate(new Date(activite), tz, 'dd/MM HH:mm') : '', erreur];
  }

  /** Statut d'une CAMPAGNE Drive+LLM (migration, re-analyse, rangement). */
  function statutCampagne(op) {
    if (op.termine) return 'terminé';
    if (op.enAttente) return 'en attente (après m1)';
    if (op.base === null) return 'recensement';
    if (etat.panneApi) return 'suspendu (panne API)';
    if (etat.freinBudget) return 'en pause (frein budget)';
    return 'en cours';
  }

  /**
   * Statut de la consolidation (génération/exécution, C28-26/0024) : gardes DÉDIÉES, distinctes de
   * `statutCampagne` — suspendue par `resetEnCours_()` (ADR-0030, une seule main déplace à la fois),
   * jamais par le frein LLM `$` (elle ne coûte rien, pure I/O `moveTo`/hash) ; son propre budget
   * QUOTIDIEN en ms (pas le frein `budgetCampagnesAtteint_`) la met « en pause » jusqu'à demain.
   */
  function statutConsolidation_(op) {
    if (op.termine) return 'terminé';
    if (etat.resetEnCours) return 'suspendu (reset en cours)';
    if (op.budgetEpuise) return 'en pause (budget du jour épuisé)';
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
    var cs = colonnesSuivi(cle);
    var av = colonnesAvancement(cle, unite, traites, base, statut);
    lignes.push([cle, operation, traites === null ? '' : traites, base === null ? '' : base,
      unite, statut, new Date(horodateMs), cs[0], cs[1], cs[2], typePar[cle] || '', av[0], av[1]]);
  }

  /**
   * Ligne d'une MISSION de curation (C28-49). Statut : terminé (passe vide) / à jour (N non
   * appariés) — les refus versionnés attendent un affinage de règles, pas du débit — / sinon le
   * SUIVI réel (en cours, en pause budget du jour + « reprise demain », skip reset…).
   */
  function pousserMission(cle, tag) {
    var m = (etat.missions || {})[tag] || { traites: 0, base: 0, nonApparies: 0, termine: false };
    var statut;
    if (m.termine) {
      statut = m.nonApparies > 0 ? 'à jour (' + m.nonApparies + ' non apparié(s))' : 'terminé';
    } else {
      statut = statutDepuisSuivi_((suivi || {})[cle]);
    }
    pousser(cle, libellePar[cle] || cle, m.traites, m.base > 0 ? m.base : null, 'fichiers', statut);
  }

  // Constructeurs DÉDIÉS des campagnes à lecteurs riches — clés du registre, libellés dynamiques
  // (tags de campagne) et statuts historiques conservés à l'identique.
  var campagnes = {
    'migration': function () {
      pousser('migration', 'Migration taxonomie (' + etat.migration.tag + ')',
        etat.migration.traites, etat.migration.base, 'documents', statutCampagne(etat.migration));
    },
    'reanalyse': function () {
      pousser('reanalyse', 'Re-analyse v2 (' + etat.reanalyse.tag + ')',
        etat.reanalyse.traites, etat.reanalyse.base, 'documents', statutCampagne(etat.reanalyse));
    },
    'histo-gmail': function () {
      var statutHisto = etat.histo.termine ? 'terminé'
        : etat.quotaGmail ? 'suspendu (quota Gmail)'
          : etat.freinBudget ? 'en pause (frein budget)' : 'en cours';
      // L'offset histo REPART À 0 aux passes de vérification (position de scan, pas un cumul) :
      // affichage MONOTONE via le max avec la ligne existante — le compteur ne recule jamais.
      var exHisto = existantes['histo-gmail'];
      var traitesHisto = exHisto && !etat.histo.termine
        ? Math.max(etat.histo.traites, exHisto.traites) : etat.histo.traites;
      pousser('histo-gmail', 'Historique Gmail (PJ)', traitesHisto, null, 'fils', statutHisto);
    },
    'rangement': function () {
      pousser('rangement', 'Rangement initial du Drive',
        etat.rangement.traites, etat.rangement.base, 'fichiers', statutCampagne(etat.rangement));
    },
    'consolidation-gen': function () {
      pousser('consolidation-gen', 'Consolidation — génération du plan (' + etat.consolidationGen.tag + ')',
        etat.consolidationGen.traites, etat.consolidationGen.base, 'domaines', statutConsolidation_(etat.consolidationGen));
    },
    'mission-vehicule': function () { pousserMission('mission-vehicule', 'vehicule'); },
    'mission-logement': function () { pousserMission('mission-logement', 'logement'); },
    'mission-dispatch-03': function () { pousserMission('mission-dispatch-03', 'dispatch03'); },
    'mission-archives-06': function () { pousserMission('mission-archives-06', 'archives06'); },
    'mission-paies': function () { pousserMission('mission-paies', 'paies'); },
    'mission-carriere': function () { pousserMission('mission-carriere', 'carriere'); },
    'mission-annees-02': function () { pousserMission('mission-annees-02', 'annees02'); },
    'mission-impots': function () { pousserMission('mission-impots', 'impots'); },
    'consolidation-exec': function () {
      var ce = etat.consolidationExec;
      var statut = statutConsolidation_(ce);
      // Plan courant ENTIÈREMENT drainé mais campagne pas finie (la génération n'a pas couvert
      // tous les domaines) : « en cours · 100 % » était trompeur (retour Marc 2026-08-13) — la
      // vérité est « à jour, en ATTENTE de l'amont ». L'app affiche la dépendance depuis ce statut.
      if (statut === 'en cours' && ce.base > 0 && ce.traites >= ce.base) {
        statut = 'à jour (plan drainé — attend la génération)';
      }
      pousser('consolidation-exec', 'Consolidation — exécution du plan (' + ce.tag + ')',
        ce.traites, ce.base, 'lignes', statut);
    }
  };

  // UNE ligne par opération du registre, DANS L'ORDRE D'EXÉCUTION du tick. Les campagnes riches
  // passent par leur constructeur dédié ; toutes les autres dérivent leur statut du suivi réel —
  // sans Traités/Base (le suivi enregistre l'exécution, pas un compte ; PR5 branchera les
  // compteurs du jour du flux vivant via les accumulateurs Télémétrie).
  (registre || []).forEach(function (op) {
    if (campagnes[op.cle]) { campagnes[op.cle](); return; }
    pousser(op.cle, op.libelle, null, null, op.unite,
      statutDepuisSuivi_((suivi || {})[op.cle]));
  });

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

  // Consolidation (C28-26/0024) — MÊME périmètre de domaines que `genererPlanConsolidation_`
  // (Consolidation.gs) et le diagnostic un-clic (Diagnostic.gs) : fixes + auto DÉJÀ NÉS (jamais
  // `domainesAutorises_()`, plus large, qui listerait aussi des auto pas encore créés). Ainsi
  // « domaines épuisés / total » affiché ici correspond EXACTEMENT à ce que la génération itère.
  var tagConso = CONFIG.CONSOLIDATION_TAG;
  var domainesConso = Object.keys(CONFIG.DOMAINES);
  (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
    if (props.getProperty('DriveAI_DOM_' + nom)) domainesConso.push(nom);
  });
  // Court-circuit (revue flotte apps-script-quota) : génération TERMINÉE ⇒ tous les domaines sont
  // épuisés PAR CONSTRUCTION (Consolidation.gs, posé au moment où le tag est marqué fini) — jamais
  // besoin de ré-interroger l'Index. Sans ce court-circuit, `majProgressions_` deviendrait en régime
  // stationnaire le SEUL déclencheur restant de `chargerIndexCache_` à CHAQUE tick, juste pour
  // recalculer une valeur qui ne change plus jamais (même piège anti-gel que celui déjà corrigé sur
  // ce chemin — cf. commentaire de `chargerIndexCache_`).
  var termineConso = props.getProperty('DriveAI_CONSOLIDATION') === tagConso;
  var domainesEpuises = termineConso ? domainesConso.length : domainesConso.reduce(function (n, nom) {
    return n + (indexContient_('conso|' + tagConso + '|dom|' + nom) ? 1 : 0);
  }, 0);
  var dernPlanConso = feuille_('PlanConsolidation').getLastRow();
  var aujourdhuiConso = dateGmail_(new Date());

  var etat = {
    quotaGmail: estPanneGmail_(),
    panneApi: estPannePlateforme_(),
    freinBudget: budgetCampagnesAtteint_(),
    resetEnCours: resetEnCours_(),
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
    },
    consolidationGen: {
      termine: termineConso,
      base: domainesConso.length,
      traites: domainesEpuises,
      budgetEpuise: budgetJourConsolidation_(props, aujourdhuiConso) >= CONFIG.CONSOLIDATION_BUDGET_JOUR_MS,
      tag: tagConso
    },
    // Missions de curation (C28-49) : compteurs compacts + drapeau de convergence par tag.
    missions: (function () {
      var brut = chargerEtatMissions_(props);
      var m = {};
      ['vehicule', 'logement', 'dispatch03', 'archives06', 'paies', 'carriere', 'annees02', 'impots'].forEach(function (tag) {
        var e = brut[tag] || { t: 0, b: 0, na: 0 };
        m[tag] = {
          traites: e.t || 0, base: e.b || 0, nonApparies: e.na || 0,
          termine: props.getProperty('DriveAI_MISSION_FINI_' + tag) === CONFIG.MISSIONS_REGLES_VERSION,
        };
      });
      return m;
    })(),
    consolidationExec: {
      termine: props.getProperty('DriveAI_CONSO_EXEC_FINI') === tagConso,
      base: dernPlanConso > 1 ? dernPlanConso - 1 : 0,
      // UNITÉS ALIGNÉES sur Diagnostic.gs (revue flotte code-reviewer) : `DriveAI_CONSO_EXEC_LIGNE`
      // est un n° de ligne PHYSIQUE (en-tête = 1) ; lignes de DONNÉES consommées = curseur − 1 —
      // sinon le numérateur dépasserait `base` d'une unité (« 7/6 » aurait l'air d'un bug), et les
      // deux surfaces de diagnostic (celle-ci et le un-clic) afficheraient des chiffres DIFFÉRENTS
      // pour la même réalité.
      traites: Math.max(0, (Number(props.getProperty('DriveAI_CONSO_EXEC_LIGNE')) || 1) - 1),
      budgetEpuise: budgetJourConsoExec_(props, aujourdhuiConso) >= CONFIG.CONSOLIDATION_EXEC_BUDGET_JOUR_MS,
      tag: tagConso
    }
  };

  // C28-47 : débits des campagnes à COMPTEUR (une entrée par clé — borné par construction), pour
  // « dernière passe » et l'estimation de fin. Mis à jour et persisté ICI, une fois par tick.
  // `histo-gmail` EXCLU volontairement (revue C28-47) : son « compteur » est une POSITION de scan
  // qui repart à 0 aux passes de vérification — un delta calculé dessus n'est pas un volume traité
  // (il n'a d'ailleurs pas de base, donc aucune estimation possible). Mieux vaut rien qu'un faux
  // « +N fils » (l'affichage du compteur, lui, reste monotone via le max avec la ligne existante).
  var debits = majDebits_(props, {
    'migration': etat.migration.traites,
    'reanalyse': etat.reanalyse.traites,
    'rangement': etat.rangement.traites,
    'consolidation-gen': etat.consolidationGen.traites,
    'consolidation-exec': etat.consolidationExec.traites,
    // Missions C28-49 : vrais volumes cumulés (jamais une position de scan) → débits/estimation OK.
    'mission-vehicule': etat.missions.vehicule.traites,
    'mission-logement': etat.missions.logement.traites,
    'mission-dispatch-03': etat.missions.dispatch03.traites,
    'mission-archives-06': etat.missions.archives06.traites,
    'mission-paies': etat.missions.paies.traites,
    'mission-carriere': etat.missions.carriere.traites,
    'mission-annees-02': etat.missions.annees02.traites,
    'mission-impots': etat.missions.impots.traites
  }, maintenant);

  // C28-44 : la vue de SUIVI fusionnée (persisté + run courant) alimente statuts/Détail/activité/
  // erreurs de TOUTES les lignes ; le registre donne la liste et l'ordre des opérations.
  var lignes = lignesProgression_(etat, lireLignesProgression_(f), maintenant, CONFIG.PROGRESSION_PURGE_MS,
    suiviOpsFusionne_(props), REGISTRE_OPERATIONS, debits);
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

// Plan de FUSION des dossiers d'entité en double (Chantier #47, ADR-0036, cf. Fusion.gs). Marc édite
// la colonne `Action` (Fusionner/Ignorer) ; `Rôle` = CIBLE (dossier gardé) ou source (fondu dedans).
var COLONNES_PLAN_FUSION = ['Horodaté', 'Domaine', 'Groupe', 'Rôle', 'Dossier', 'Nb fichiers', 'ID dossier', 'Action', 'Statut'];

// Journal QUOTIDIEN du vrac par domaine (demande Marc 2026-08-12, cf. HistoriqueVrac.gs). APPEND-ONLY
// (jamais réécrit ni purgé) — une ligne par domaine, une fois par jour, jusqu'à la fin du drainage.
// `Tronqué` = 'oui' si le comptage a atteint le plafond de sûreté (compterVracRacineDomaine_,
// Diagnostic.gs) — jamais un chiffre exact au-delà, jamais un plantage. `Erreur` = 'oui' si le
// domaine était illisible ce jour-là : `Vrac` reste alors VIDE (jamais un faux 0 permanent —
// confirmé en prod 2026-08-12, `06 · Études` avait affiché 0 avec ≥400 fichiers réels).
var COLONNES_HISTORIQUE_VRAC = ['Date', 'Domaine', 'Vrac', 'Tronqué', 'Erreur'];

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

var COLONNES_COUTS = ['Poste', 'Appels', 'Coût $', 'Part'];

/**
 * Lignes de l'onglet `Coûts` (C28-58, demande Marc « je veux le détail de coût pour tout »).
 * PURE (testée) — aucune I/O, aucune décision.
 *
 * HONNÊTETÉ (no-fake-data, §7) : la ventilation ne peut pas décrire ce qui a été dépensé AVANT
 * son déploiement. La ligne « non ventilé » l'expose au lieu de laisser croire que les postes
 * affichés couvrent tout le mois — c'est le même principe que « status:building » du hub.
 * @param {string} mois  AAAA-MM
 * @param {{appels:number, dollars:number}} total  cf. `syntheseCoutMois_`
 * @param {{lignes:Array, ventile:number, restant:number}} v  cf. `ventilationCoutMois_`
 * @return {Array<Array>}
 */
function lignesCouts_(mois, total, v) {
  var pct = function (d) { return total.dollars > 0 ? Math.round(d / total.dollars * 1000) / 10 + ' %' : '—'; };
  var lignes = [[
    'TOTAL LLM ' + mois, total.appels, Math.round(total.dollars * 100) / 100, '100 %'
  ]];
  for (var i = 0; i < v.lignes.length; i++) {
    var l = v.lignes[i];
    lignes.push([l.op, l.appels, Math.round(l.dollars * 10000) / 10000, l.part + ' %']);
  }
  // Seuil à 0,5 ¢ : sous cela, « non ventilé » n'est que du bruit d'arrondi et afficher une ligne
  // ferait douter d'un compte juste.
  if (v.restant > 0.005) {
    // Libellé NEUTRE (revue flotte C28-58) : ce reliquat vient normalement de ce qui a été dépensé
    // avant la mise en place du détail — mais pas seulement (un changement de `CONFIG.LLM_PRIX` en
    // cours de mois re-tarife le total sans re-tarifer les postes déjà figés). Affirmer une cause
    // unique serait faux précisément le jour où Marc regarde.
    lignes.push(['(non ventilé — antérieur au détail, ou non attribué)', '—',
      Math.round(v.restant * 100) / 100, pct(v.restant)]);
  }
  return lignes;
}

/**
 * Écrit l'onglet `Coûts` (C28-58) : où part l'argent, par usage. Une seule écriture par tick,
 * comme Télémétrie. Enveloppée par l'appelant — un échec ne bloque JAMAIS l'intake.
 */
function majCouts_() {
  var tz = Session.getScriptTimeZone();
  var mois = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var total = syntheseCoutMois_();
  var t = lireCoutMois_(PropertiesService.getScriptProperties(), cleCoutMois_());
  var lignes = lignesCouts_(mois, total, ventilationCoutMois_(t, total.dollars));
  var f = feuille_('Coûts');
  f.getRange(2, 1, lignes.length, COLONNES_COUTS.length).setValues(lignes);
  // Reliquat du mois précédent (moins de postes qu'avant) : effacé, sinon d'anciennes lignes
  // survivraient sous les nouvelles et l'onglet mentirait (même patron que Télémétrie).
  var dern = f.getLastRow();
  if (dern > lignes.length + 1) {
    f.getRange(lignes.length + 2, 1, dern - lignes.length - 1, COLONNES_COUTS.length).clearContent();
  }
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
  // PERF (Vague 2, anti-gel) : ce cache n'utilise QUE la colonne A (clé) et la colonne G (empreinte),
  // jamais B..F (date/nom/domaine/chemin/statut). Lire les 7 colonnes chargeait 3,5× trop de cellules
  // à CHAQUE tick sur un Index qui croît (>10 800 lignes) — l'un des postes du « socle » non budgété
  // qui pousse vers le mur ~90 min/j (revue de fond 2026-07-31). Deux lectures d'UNE colonne (A puis G)
  // transfèrent ÷3,5 de données ; le round-trip supplémentaire est négligeable devant le volume.
  var cles = f.getRange(2, 1, dern - 1, 1).getValues();        // colonne A (clé)
  var empreintes = f.getRange(2, 7, dern - 1, 1).getValues();  // colonne G (empreinte)
  for (var i = 0; i < cles.length; i++) {
    if (cles[i][0]) _indexCache[cles[i][0]] = true;
    if (!empreintes[i][0]) continue;
    _empreintesCache[empreintes[i][0]] = true;
    // DERNIÈRE ligne gagnante (revue sécurité #229) : l'Index est append-only, donc l'ordre des
    // lignes est chronologique. Garder la PREMIÈRE ferait gagner l'empreinte la plus ANCIENNE — un
    // fichier ré-analysé (`reanalyse|…`) après un `drive|…` aurait vu la périmée l'emporter. C'est
    // aussi la sémantique de `indexAjouter_`, qui écrase avec la valeur la plus récente.
    var fid = fileIdDeCleIndex_(cles[i][0]);
    if (fid) _empreintesParIdCache[fid] = String(empreintes[i][0]);
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
