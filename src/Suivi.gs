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
// ~33 étapes × textes aux maxima en caractères 2 octets doit rester < ~8,5 Ko, limite Apps Script
// ~9 Ko ; 60/40 donnaient 9 751 octets au pire cas — attrapé par le test avant tout déploiement).
// Le message complet reste dans l'onglet Journal ; ici c'est un extrait d'affichage.
var SUIVI_ERR_MAX = 40;
var SUIVI_SKIP_MAX = 28;

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
  try {
    fn();
    entree.ok = Date.now();
    entree.d = entree.ok - debut;
  } catch (err) {
    entree.et = Date.now();
    entree.e = suiviTexte_(err && err.message ? err.message : err, SUIVI_ERR_MAX);
    if (onErreur) onErreur(err);
    else throw err;
  }
}

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
    return 'suspendu (' + raison + ')';
  }
  return 'en cours';
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
