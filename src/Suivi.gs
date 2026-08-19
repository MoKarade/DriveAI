/**
 * Suivi.gs — suivi GÉNÉRIQUE de toutes les opérations du tick (C28-44, ADR-0038).
 *
 * Demande Marc 2026-08-13 : le suivi (onglet `Progression`) était codé en dur pour 6 campagnes
 * alors que le tick exécute ~30 étapes — « je veux que ça marche pour tout type de tâche que
 * l'app fait et je veux que ce soit beaucoup plus fiable ».
 *
 * Trois pièces, toutes PURES ou en mémoire de module (zéro I/O par étape — patron `flushUsage_`) :
 *  1. `REGISTRE_OPERATIONS` — LA source de vérité des étapes (clé, libellé, unité, type).
 *     Ajouter une étape au tick = 1 entrée ici + 1 wrap `etapeSuivie_` dans Main.gs ; un tripwire
 *     de couverture bidirectionnel (PR2) verrouille l'égalité des deux ensembles.
 *  2. `etapeSuivie_` — wrapper d'exécution : gates évaluées DANS L'ORDRE EXACT des anciens `if`
 *     (même coût, mêmes prédicats), skip enregistré avec sa raison ; sinon tentative/succès/durée/
 *     erreur enregistrés. L'enregistreur voit l'erreur AVANT tout catch custom (il ENGLOBE le
 *     try/catch, ne s'y empile pas) ; sans `onErreur`, l'erreur est RE-LEVÉE telle quelle (étapes
 *     nues de l'intake : la sémantique d'échec du tick ne change pas).
 *  3. Codec Property `DriveAI_SUIVI_OPS` — persistance inter-ticks COMPACTE et BORNÉE (leçon §7
 *     « ~9 Ko ») : encodage positionnel par clé, fusion qui fait survivre les champs non touchés
 *     ce run (un succès d'hier reste visible pendant qu'une erreur d'aujourd'hui s'accumule),
 *     clés hors registre PURGÉES à la fusion (bornée par construction), messages tronqués.
 *
 * « Dernière tentative » ≠ « dernier succès » (deux horodatages) : une étape qui démarre à chaque
 * tick mais n'aboutit jamais est VISIBLE — c'est le trou d'observabilité n° 1 des incidents passés.
 */

// Troncatures des textes persistés — bornent la Property (test au plafond DÉRIVÉ du registre :
// les étapes × textes aux maxima en caractères 2 octets doivent rester < ~8,5 Ko, limite Apps
// Script ~9 Ko ; 60/40 donnaient 9 751 octets au pire cas — attrapé par le test avant tout
// déploiement ; 40/28 ont recassé le plafond à l'ajout des 8 missions C28-49, 42 étapes ⇒ 9 385
// octets — le test dérivé a de nouveau mordu AVANT le déploiement, resserré à 32/24). 24 couvre
// la plus longue raison de skip RÉELLE (« en attente (missions 03) »), vérifié par le tripwire
// des raisons. Le message complet reste dans l'onglet Journal ; ici c'est un extrait d'affichage.
var SUIVI_ERR_MAX = 32;
var SUIVI_SKIP_MAX = 24;

/**
 * Registre des opérations du tick — ORDRE = ordre d'exécution dans `tickDriveAI` (l'app l'affiche
 * tel quel). Les clés HISTORIQUES de Progression sont conservées à l'identique (`migration`,
 * `reanalyse`, `histo-gmail`, `rangement`, `consolidation-gen`, `consolidation-exec`) — continuité
 * app + historique. `type` : flux (vivant), campagne (fond), maintenance (setup/one-shots),
 * demande (à la demande de Marc), observabilite (finally du tick).
 */
var REGISTRE_OPERATIONS = [
  // — Maintenance (début de tick)
  { cle: 'rejeu-version', libelle: 'Rejeu après nouvelle version du classement', unite: 'documents', type: 'maintenance' },
  { cle: 'dequarantaine', libelle: 'Dé-quarantaine automatique', unite: 'documents', type: 'maintenance' },
  { cle: 'seed-entites', libelle: 'Seed des entités (listes de Marc)', unite: 'entités', type: 'maintenance' },
  { cle: 'entites-auto-validation', libelle: 'Auto-validation des entités fréquentes', unite: 'entités', type: 'maintenance' },
  { cle: 'entites-dossiers', libelle: 'Création des dossiers d\'entités validées', unite: 'entités', type: 'maintenance' },
  { cle: 'entites-curation', libelle: 'Curation de la file d\'entités', unite: 'entités', type: 'maintenance' },
  { cle: 'relances-quarantaine', libelle: 'Relances de quarantaine (app)', unite: 'documents', type: 'maintenance' },
  { cle: 'corrections', libelle: 'Lecture des corrections (formulaire)', unite: 'corrections', type: 'maintenance' },
  // — Collecte & flux vivant
  { cle: 'rangement', libelle: 'Rangement initial du Drive', unite: 'fichiers', type: 'campagne' },
  { cle: 'intake-gmail', libelle: 'Intake — pièces jointes Gmail', unite: 'PJ', type: 'flux' },
  { cle: 'intake-depots', libelle: 'Intake — dépôts (00 · À trier)', unite: 'fichiers', type: 'flux' },
  { cle: 'intake-partages', libelle: 'Intake — fichiers partagés', unite: 'fichiers', type: 'flux' },
  { cle: 'intentions', libelle: 'Intentions mail (tâches & agenda)', unite: 'fils', type: 'flux' },
  { cle: 'tri-gmail', libelle: 'Tri de la boîte Gmail', unite: 'fils', type: 'flux' },
  // — Campagnes de fond (ordre du tick : drainer avant d'alimenter)
  { cle: 'consolidation-exec', libelle: 'Consolidation — exécution du plan', unite: 'lignes', type: 'campagne' },
  { cle: 'consolidation-gen', libelle: 'Consolidation — génération du plan', unite: 'domaines', type: 'campagne' },
  // Missions de curation (C28-49, ADR-0039) — l'ordre suit celui du tick (= la priorité).
  { cle: 'mission-vehicule', libelle: 'Mission — véhicules (Véhicules → Véhicule)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-logement', libelle: 'Mission — logements (Logements → Logement)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-dispatch-03', libelle: 'Mission — contrats, correspondance, assurances & énergie (03)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-archives-06', libelle: 'Mission — archives scolaires (06)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-paies', libelle: 'Mission — paies par employeur (02)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-carriere', libelle: 'Mission — employeurs & CV (05)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-annees-02', libelle: 'Mission — dossiers-années de Finances (02)', unite: 'fichiers', type: 'campagne' },
  { cle: 'mission-impots', libelle: 'Mission — impôts par année (02)', unite: 'fichiers', type: 'campagne' },
  { cle: 'fusion-exec', libelle: 'Fusion des dossiers en double', unite: 'lignes', type: 'campagne' },
  { cle: 'reset-rassemblement', libelle: 'Reset — rassemblement vers _TRI', unite: 'fichiers', type: 'campagne' },
  { cle: 'reset-placement', libelle: 'Reset — placement depuis _TRI', unite: 'fichiers', type: 'campagne' },
  { cle: 'reset-04-interne', libelle: 'Reset — réorganisation interne de 04', unite: 'fichiers', type: 'campagne' },
  { cle: 'reset-llm', libelle: 'Reset — passe LLM du reliquat', unite: 'documents', type: 'campagne' },
  { cle: 'histo-gmail', libelle: 'Historique Gmail (PJ)', unite: 'fils', type: 'campagne' },
  { cle: 'migration', libelle: 'Migration taxonomie', unite: 'documents', type: 'campagne' },
  { cle: 'reanalyse', libelle: 'Re-analyse v2 ciblée', unite: 'documents', type: 'campagne' },
  { cle: 'dryrun-v2', libelle: 'Dry-run v2 (échantillon)', unite: 'documents', type: 'campagne' },
  { cle: 'dryrun-cmp', libelle: 'Comparaison 1↔2 passes', unite: 'documents', type: 'campagne' },
  // — À la demande + fond perpétuel
  { cle: 'reorg', libelle: 'Réorg IA (validations & plans demandés)', unite: 'actions', type: 'demande' },
  { cle: 'reconciliation-index', libelle: 'Réconciliation Index ↔ Drive', unite: 'lignes', type: 'campagne' },
  // — Observabilité (finally du tick). Le flush du suivi lui-même n'est PAS listé : il ne peut pas
  // s'auto-observer (son échec se persiste au tick suivant ; `Santé` reste le filet).
  { cle: 'sante', libelle: 'Santé (heartbeat)', unite: '', type: 'observabilite' },
  { cle: 'progression', libelle: 'Progression (cet onglet)', unite: '', type: 'observabilite' },
  { cle: 'telemetrie', libelle: 'Télémétrie coûts & quotas', unite: '', type: 'observabilite' },
  { cle: 'hub-resume', libelle: 'Résumé hub (widget)', unite: '', type: 'observabilite' },
  { cle: 'historique-vrac', libelle: 'Historique quotidien du vrac', unite: 'domaines', type: 'observabilite' },
  { cle: 'journal-borne', libelle: 'Rotation du Journal', unite: '', type: 'observabilite' }
];

// HORS registre, VOLONTAIREMENT (le tripwire de couverture PR2 ne voit que ce qui est wrappé OU
// registré — toute exclusion doit être listée ICI, revue C28-44 PR1) : les 4 setups de tête de
// tick (`assurerIntervalleTick_`, les 2 `assurerTrigger*_`, `assurerNomsDomaines_` — idempotents,
// quasi-instantanés, sans état à suivre), et dans le finally : le heartbeat `DriveAI_LAST_TICK`
// (c'est LUI le filet ultime — il ne peut pas dépendre du suivi), la trace horaire de durée,
// `flushUsage_` (comptabilité LLM, a sa propre télémétrie) et le flush du suivi lui-même (§ ci-dessus).
/** Clés du registre, dans l'ordre d'affichage. */
function clesRegistreSuivi_() {
  return REGISTRE_OPERATIONS.map(function (o) { return o.cle; });
}

/**
 * Neutralise les caractères que `JSON.stringify` ÉCHAPPE (`"`, `\`, contrôles dont \n — 2 à
 * 6 caractères chacun une fois encodés) AVANT la troncature. Sans ça, le plafond dérivé du test
 * ment : 34 messages « hostiles » de 40 caractères pèseraient 13-16 Ko une fois échappés, au-delà
 * de la limite Apps Script ~9 Ko (revue apps-script-quota PR1). Un espace remplace : lisible, et
 * taille encodée = nombre de caractères, exactement ce que le test au plafond mesure.
 */
function suiviTexte_(txt, max) {
  return String(txt).replace(/[\u0000-\u001F"\\]/g, ' ').slice(0, max);
}

/* ---------- Enregistreur (mémoire de module, flushé 1×/tick — patron flushUsage_) ---------- */

var _suiviRun = null;

/** Remet l'enregistreur à zéro — appelé en tête de tick (PR2). */
function suiviReset_() { _suiviRun = {}; }

function _suiviEntree_(cle) {
  if (!_suiviRun) _suiviRun = {};
  if (!_suiviRun[cle]) _suiviRun[cle] = {};
  return _suiviRun[cle];
}

/** Enregistre un SKIP (étape gatée) avec sa raison — jamais exécutée ce run. */
function suiviSkip_(cle, raison) {
  var e = _suiviEntree_(cle);
  e.st = Date.now();
  e.s = suiviTexte_(raison, SUIVI_SKIP_MAX);
}

/**
 * Exécute UNE étape du tick sous enregistrement.
 * @param {string} cle  clé du registre (tripwire de couverture en PR2)
 * @param {Array<function():?string>} gates  évaluées DANS L'ORDRE — la première raison non-null
 *   enregistre un skip et court-circuite (les gates suivantes ne sont PAS évaluées : même coût
 *   et même ordre que les `if` qu'elles remplacent, ex. un comptage Drive reste dernier)
 * @param {function} fn  le corps de l'étape
 * @param {function(Error)=} onErreur  catch custom de l'étape (`journalErreur_`,
 *   `signalerPanneGmail_`…) — appelé APRÈS enregistrement ; absent ⇒ l'erreur est RE-LEVÉE
 *   telle quelle (étapes nues de l'intake — la sémantique d'échec du tick ne change pas)
 *
 * ⚠️ Une GATE qui lève (ex. un comptage Drive) sort SANS trace (ni skip ni erreur) et remonte —
 * fidèle aux `if` actuels du tick, évalués hors de tout try. Assumé en PR1 (ce chantier
 * n'altère JAMAIS la sémantique du tick) ; documenté ici pour que le trou d'observabilité
 * résiduel soit un choix, pas un oubli (revues flotte PR1).
 */
function etapeSuivie_(cle, gates, fn, onErreur) {
  for (var i = 0; i < (gates || []).length; i++) {
    var raison = gates[i]();
    if (raison) { suiviSkip_(cle, raison); return; }
  }
  var entree = _suiviEntree_(cle);
  var debut = Date.now();
  entree.t = debut;
  // VENTILATION DU COÛT LLM (C28-58, demande Marc « je veux le détail de coût pour tout ») : le
  // nom de l'étape est posé le temps du corps, et `enregistrerUsage_` l'utilise pour attribuer
  // chaque appel Anthropic. Aucun call site LLM à modifier — et toute étape FUTURE est ventilée
  // d'office, sans qu'on ait à y penser. Sauvegarde/restauration : si un jour une étape en
  // enveloppait une autre, l'attribution reviendrait proprement à l'englobante.
  var operationPrecedente = operationCourante_();
  poserOperationCourante_(cle);
  try {
    fn();
    entree.ok = Date.now();
    entree.d = entree.ok - debut;
  } catch (err) {
    entree.et = Date.now();
    entree.e = suiviTexte_(err && err.message ? err.message : err, SUIVI_ERR_MAX);
    if (onErreur) onErreur(err);
    else throw err;
  } finally {
    poserOperationCourante_(operationPrecedente);
  }
}

/**
 * Opération en cours, pour la ventilation du coût LLM (C28-58). Vit dans une variable de module :
 * le run est sérialisé par le `LockService` de `tickDriveAI`, comme l'accumulateur de `Cout.gs`.
 * Hors étape de tick (web app, MCP), l'appelant la pose lui-même — sinon l'appel tombe dans
 * « (hors étape) », qui est une VRAIE catégorie, pas une perte.
 */
var _operationCourante = '';

/** @param {string} cle */
function poserOperationCourante_(cle) { _operationCourante = String(cle || ''); }

/** @return {string} */
function operationCourante_() { return _operationCourante; }

/**
 * PURE : statut d'affichage d'une opération SANS lecteur de campagne dédié, dérivé de son
 * enregistrement (le DERNIER événement gagne — erreur prioritaire à égalité). Vocabulaire aligné
 * sur les familles que l'app connaît (`familleStatut`) : « en cours », « en pause (…) »,
 * « suspendu (…) », plus « erreur », « désactivée » et « jamais vue » (PR4 les affiche).
 * @param {?Object} rec  entrée fusionnée {t, ok, d, et, e, st, s} — absente si jamais exécutée
 * @return {string}
 */
function statutDepuisSuivi_(rec) {
  if (!rec || (!rec.t && !rec.ok && !rec.et && !rec.st)) return 'jamais vue';
  var dernier = Math.max(rec.ok || 0, rec.et || 0, rec.st || 0);
  if (rec.et && rec.et >= dernier) return 'erreur';
  if (rec.st && rec.st >= dernier) {
    var raison = rec.s || '';
    // `indexOf !== -1`, pas un préfixe : « frein budget campagnes » commence par « frein » (revue
    // code-reviewer PR3 — en préfixe, il tombait dans la famille « suspendu », que l'app glose
    // « panne » ; un frein budget est une PAUSE normale, comme sur les campagnes riches).
    if (raison.indexOf('budget') !== -1) return 'en pause (' + raison + ')';
    if (raison === 'désactivée (CONFIG)') return 'désactivée';
    // Un one-shot ACCOMPLI n'est ni suspendu ni en panne (retour Marc 2026-08-13 : la
    // dé-quarantaine « déjà fait » s'affichait en rouge avec barre rayée) — famille neutre-positive.
    if (raison.indexOf('déjà fait') === 0) return 'à jour (déjà fait)';
    return 'suspendu (' + raison + ')';
  }
  return 'en cours';
}

/* ---------- DÉBIT & ESTIMATION DE FIN (C28-47, demande Marc : « combien en tout, combien
   dernière passe, et un estimé de fin détaillé ») — PURES, état borné (Property dédiée) ---------- */

// Constante de temps de la moyenne mobile du débit : 24 h. Le débit est mesuré en items par heure
// de temps RÉEL (pauses comprises) — c'est ce qui rend l'estimation honnête pour une campagne qui
// travaille par salves quotidiennes (budget/jour) : son débit moyen sur 24 h est le bon prédicteur,
// là où un lissage par TICK oublierait la salve entre deux journées.
var DEBIT_TAU_H = 24;
// Sous une minute entre deux mesures, le rapport delta/durée est du bruit — on ignore.
var DEBIT_DT_MIN_MS = 60 * 1000;
// Aucune estimation avant 2 h d'observation : sur une seule salve, le débit n'a aucun sens
// (mieux vaut « pas encore d'estimation » qu'un chiffre inventé).
var DEBIT_OBS_MIN_MS = 2 * 60 * 60 * 1000;
// Reprise après une LONGUE pause (gel mensuel, campagne rallumée) : au-delà de 36 h sans progrès,
// la série précédente ne prédit plus rien — on RE-BASE (nouvelle observation) au lieu de laisser un
// débit résiduel proche de zéro produire un horizon délirant pendant une journée (revue C28-47).
// 36 h > TAU pour ne PAS re-baser une campagne à salve quotidienne (~24 h entre deux salves).
var DEBIT_REBASE_MS = 36 * 60 * 60 * 1000;

/**
 * PURE : met à jour l'état de débit d'une opération à compteur.
 * @param {?Object} prev  {t0, ts, n, r, dn, dts} ou null (première observation)
 * @param {number} traites  compteur courant de la campagne
 * @param {number} maintenantMs
 * @return {Object} nouvel état — `r` = items/heure lissé, `dn`/`dts` = volume et date de la
 *   DERNIÈRE passe productive (jamais écrasés par les passes à vide : « dernière passe » doit
 *   rester lisible quand la campagne dort).
 */
function majDebit_(prev, traites, maintenantMs) {
  // `ts === 0` signifie « jamais observé » — cohérent avec le codec (`Number(...) || 0` marque
  // l'absence). Sans conséquence en prod : un horodatage réel vaut ~1,7e12, jamais 0.
  if (!prev || !(prev.ts > 0)) {
    return { t0: maintenantMs, ts: maintenantMs, n: traites, r: 0, dn: 0, dts: 0 };
  }
  var dtMs = maintenantMs - prev.ts;
  if (dtMs < DEBIT_DT_MIN_MS) return prev; // trop rapproché : on garde l'état tel quel
  var delta = traites - prev.n;
  // Compteur qui RECULE (re-base d'une campagne, remise à zéro d'un offset) : on repart proprement
  // plutôt que de compter un débit négatif.
  if (delta < 0) return { t0: maintenantMs, ts: maintenantMs, n: traites, r: 0, dn: 0, dts: 0 };
  // Reprise après une longue pause : la série d'avant ne prédit plus rien → nouvelle série.
  if (delta > 0 && maintenantMs - (prev.dts || prev.t0 || prev.ts) > DEBIT_REBASE_MS) {
    return { t0: maintenantMs, ts: maintenantMs, n: traites, r: 0, dn: delta, dts: maintenantMs };
  }
  var dtH = dtMs / 3600000;
  var alpha = 1 - Math.exp(-dtH / DEBIT_TAU_H); // lissage par CONSTANTE DE TEMPS, pas par tick
  var r = prev.r + alpha * ((delta / dtH) - prev.r);
  return {
    t0: prev.t0 || prev.ts,
    ts: maintenantMs,
    n: traites,
    r: r,
    dn: delta > 0 ? delta : (prev.dn || 0),
    dts: delta > 0 ? maintenantMs : (prev.dts || 0)
  };
}

/**
 * PURE : temps restant estimé, ou null si aucune estimation HONNÊTE n'est possible (pas assez
 * d'observation, débit nul — campagne à l'arrêt —, base inconnue, ou horizon absurde).
 * @return {?{restant:number, msRestants:number}}
 */
function estimationFin_(debit, traites, base, maintenantMs) {
  if (!debit || !base || !(base > 0) || !(traites < base)) return null;
  if (!(debit.r > 0)) return null;                                   // à l'arrêt : le statut explique
  if (maintenantMs - (debit.t0 || 0) < DEBIT_OBS_MIN_MS) return null; // trop tôt pour prédire
  var heures = (base - traites) / debit.r;
  if (!isFinite(heures) || heures > 24 * 365) return null;            // horizon absurde ⇒ rien
  return { restant: base - traites, msRestants: Math.round(heures * 3600000) };
}

/** Charge l'état de débit (Property dédiée, tolérante — jamais une panne d'affichage bloquante). */
function chargerDebits_(props) {
  try {
    var brut = props.getProperty('DriveAI_SUIVI_DEBIT');
    if (!brut) return {};
    var compact = JSON.parse(brut);
    var etat = {};
    Object.keys(compact).forEach(function (cle) {
      var a = compact[cle];
      if (!a || a.length < 4) return;
      etat[cle] = { t0: Number(a[0]) || 0, ts: Number(a[1]) || 0, n: Number(a[2]) || 0,
        r: Number(a[3]) || 0, dn: Number(a[4]) || 0, dts: Number(a[5]) || 0 };
    });
    return etat;
  } catch (err) {
    return {};
  }
}

/**
 * Met à jour et PERSISTE les débits des opérations à compteur. Bornée par construction : une
 * entrée par clé PRÉSENTE dans `compteurs` (les campagnes du registre), 6 nombres chacune.
 * @param {Object} props
 * @param {Object} compteurs  clé → traites (nombre) — seules les campagnes à compteur
 * @param {number} maintenantMs
 * @return {Object} l'état à jour (lu par le rendu du même tick — aucune relecture)
 */
function majDebits_(props, compteurs, maintenantMs) {
  var etat = chargerDebits_(props);
  var sortie = {};
  Object.keys(compteurs).forEach(function (cle) {
    var traites = Number(compteurs[cle]);
    if (!isFinite(traites)) return;
    sortie[cle] = majDebit_(etat[cle], traites, maintenantMs);
  });
  var compact = {};
  Object.keys(sortie).forEach(function (cle) {
    var d = sortie[cle];
    compact[cle] = [d.t0, d.ts, d.n, Math.round(d.r * 1000) / 1000, d.dn, d.dts];
  });
  try { props.setProperty('DriveAI_SUIVI_DEBIT', JSON.stringify(compact)); }
  catch (e) { /* observabilité best-effort : jamais bloquer le tick pour une estimation */ }
  return sortie;
}

/* ---------- Codec Property DriveAI_SUIVI_OPS (compact, borné ~9 Ko) ---------- */

/**
 * Charge l'état persisté. TOLÉRANT : Property absente ou JSON illisible → {} sans throw
 * (l'observabilité ne casse jamais rien — au pire on repart de zéro).
 * Format stocké : { cle: [tentative, ok, durée, erreurTs, erreurMsg, skipTs, skipRaison] }.
 */
function chargerSuiviOps_(props) {
  try {
    var brut = props.getProperty('DriveAI_SUIVI_OPS');
    if (!brut) return {};
    var compact = JSON.parse(brut);
    var etat = {};
    Object.keys(compact).forEach(function (cle) {
      var a = compact[cle];
      if (!a || !a.length) return;
      etat[cle] = {
        t: Number(a[0]) || 0, ok: Number(a[1]) || 0, d: Number(a[2]) || 0,
        et: Number(a[3]) || 0, e: String(a[4] || ''), st: Number(a[5]) || 0, s: String(a[6] || '')
      };
    });
    return etat;
  } catch (err) {
    return {};
  }
}

/**
 * PURE : fusionne l'état persisté et l'enregistrement du run courant, borné aux clés du registre.
 * Les champs touchés CE run priment ; les autres SURVIVENT depuis le persisté. Le message d'erreur
 * suit son horodatage (une erreur de ce run remplace l'ancien message ; un run sans erreur garde
 * l'ancien) — idem durée/succès et raison/skip. Clés hors registre : PURGÉES (borne par construction).
 */
function fusionnerSuiviOps_(persiste, run, cles) {
  var etat = {};
  cles.forEach(function (cle) {
    var p = persiste[cle] || {};
    var r = run[cle] || {};
    var f = {
      t: r.t || p.t || 0,
      ok: r.ok || p.ok || 0,
      d: (r.ok ? r.d : p.d) || 0,
      et: r.et || p.et || 0,
      e: r.et ? (r.e || '') : (p.e || ''),
      st: r.st || p.st || 0,
      s: r.st ? (r.s || '') : (p.s || '')
    };
    if (f.t || f.ok || f.et || f.st) etat[cle] = f; // n'inscrit que ce qui a déjà vécu
  });
  return etat;
}

/** PURE : encode l'état fusionné au format compact positionnel (neutralisation + troncatures
 * RE-appliquées ici — défense en profondeur : un texte long ou hostile venu d'une Property
 * héritée/corrompue passe AUSSI par ce goulot, pas seulement les textes du run courant). */
function encoderSuiviOps_(etat) {
  var compact = {};
  Object.keys(etat).forEach(function (cle) {
    var f = etat[cle];
    compact[cle] = [f.t || 0, f.ok || 0, f.d || 0, f.et || 0,
      suiviTexte_(f.e || '', SUIVI_ERR_MAX), f.st || 0, suiviTexte_(f.s || '', SUIVI_SKIP_MAX)];
  });
  return JSON.stringify(compact);
}

/** Vue FUSIONNÉE persisté + run courant — lue par `majProgressions_` (PR3) sans re-flusher. */
function suiviOpsFusionne_(props) {
  return fusionnerSuiviOps_(chargerSuiviOps_(props), _suiviRun || {}, clesRegistreSuivi_());
}

/**
 * I/O : persiste la fusion — appelé UNE fois par tick, dans le finally (PR2), APRÈS
 * `majProgressions_`. JAMAIS auto-observé (il ne peut pas s'enregistrer lui-même) : un échec ici
 * laisse simplement l'enregistrement de ce run en mémoire perdue, le persisté du tick précédent
 * reste intact et `Santé` reste le filet global.
 */
function flusherSuiviOps_(props) {
  var etat = suiviOpsFusionne_(props);
  var encode = encoderSuiviOps_(etat);
  // Filet DUR (revue apps-script-quota PR1) : au-delà de ~8,9 Ko, `setProperty` lèverait à CHAQUE
  // tick et la persistance serait morte en boucle. On dégrade en vidant les TEXTES (les
  // horodatages — l'essentiel du suivi — survivent) plutôt que de tout perdre. Inatteignable si
  // le test au plafond dérivé dit vrai ; ceinture, pas chemin nominal.
  if (encode.length > 8900) {
    Object.keys(etat).forEach(function (cle) { etat[cle].e = ''; etat[cle].s = ''; });
    encode = encoderSuiviOps_(etat);
  }
  props.setProperty('DriveAI_SUIVI_OPS', encode);
}
