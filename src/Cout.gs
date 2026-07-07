/**
 * Cout.gs — Mesure RÉELLE du coût LLM (point ouvert P1-09), Phase 1+.
 *
 * Chaque appel Anthropic renvoie `usage.input_tokens`/`output_tokens` ; on les accumule
 * (par run, puis on agrège dans une Script Property mensuelle) pour passer d'une ESTIMATION
 * à un coût mesuré, et détecter tôt une dérive avant qu'elle n'approche la cible < 10 $/mois.
 *
 * Aucun appel réseau ici : pure comptabilité locale. Concurrence : l'accumulation par run
 * vit dans une variable de module (le run est sérialisé par le LockService de tickDriveAI),
 * et le flush mensuel est une lecture+écriture unique en fin de run.
 */

// Accumulateur du run courant (remis à zéro au tick, vidé en fin de tick).
var _usageRun = null;

/** À appeler en tête de run. */
function reinitialiserUsage_() {
  _usageRun = { hin: 0, hout: 0, sin: 0, sout: 0, appels: 0 };
}

/**
 * Comptabilise l'usage d'un appel. Sépare Haiku et Sonnet (prix différents).
 * @param {string} modele
 * @param {{input_tokens:number, output_tokens:number}} usage  (champ `usage` de la réponse Anthropic)
 */
function enregistrerUsage_(modele, usage) {
  if (!_usageRun || !usage) return;
  var inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  if (String(modele).indexOf('sonnet') !== -1) { _usageRun.sin += inTok; _usageRun.sout += outTok; }
  else { _usageRun.hin += inTok; _usageRun.hout += outTok; }
  _usageRun.appels += 1;
}

/**
 * Vide l'accumulateur du run dans le total mensuel (Script Property `DriveAI_COUT_AAAA-MM`).
 * À appeler en fin de run (même si une erreur survient avant : enveloppé par l'appelant).
 */
function flushUsage_() {
  if (!_usageRun || !_usageRun.appels) return;
  var props = PropertiesService.getScriptProperties();
  var cle = cleCoutMois_();
  var t = lireCoutMois_(props, cle);
  t.hin += _usageRun.hin; t.hout += _usageRun.hout;
  t.sin += _usageRun.sin; t.sout += _usageRun.sout;
  t.appels += _usageRun.appels;
  props.setProperty(cle, JSON.stringify(t));
  _usageRun = null;
}

/**
 * FREIN BUDGET des campagnes (R3, §2.6) : vrai si le coût MENSUEL mesuré atteint
 * CONFIG.LLM_BUDGET_CAMPAGNES. Lu au plus une fois par run (cache), journalisé UNE fois par
 * mois quand il s'enclenche. Le flux vivant n'est jamais gaté par ce frein.
 */
var _freinBudget = null;
function reinitialiserFreinBudget_() { _freinBudget = null; }
function budgetCampagnesAtteint_() {
  if (_freinBudget !== null) return _freinBudget;
  try {
    var props = PropertiesService.getScriptProperties();
    var cle = cleCoutMois_();
    _freinBudget = coutDollars_(lireCoutMois_(props, cle)) >= CONFIG.LLM_BUDGET_CAMPAGNES;
    if (_freinBudget) {
      // Signalement best-effort dans son PROPRE try : une panne de journal/Property ne doit pas
      // relever un frein correctement MESURÉ (la mesure prime sur l'annonce). La mémoire « déjà
      // signalé » inclut le SEUIL : si Marc relève le plafond en cours de mois et que le frein se
      // re-déclenche au nouveau niveau, la re-pause est re-annoncée (jamais silencieuse).
      try {
        var marque = cle + '|' + CONFIG.LLM_BUDGET_CAMPAGNES;
        if (props.getProperty('DriveAI_FREIN_BUDGET') !== marque) {
          props.setProperty('DriveAI_FREIN_BUDGET', marque);
          journalInfo_('Cout', 'Budget campagnes atteint (' + CONFIG.LLM_BUDGET_CAMPAGNES +
            ' $/mois) — rangement/migration/historique EN PAUSE jusqu\'au mois prochain ; le flux vivant continue.');
        }
      } catch (e2) { /* annonce différée au prochain run */ }
    }
  } catch (e) {
    _freinBudget = false; // mesure illisible → on ne bloque pas (le budget reste une cible, pas un fusible dur)
  }
  return _freinBudget;
}

/** Clé de Script Property du mois courant. */
function cleCoutMois_() {
  return 'DriveAI_COUT_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

/** Lit (ou initialise) le total d'un mois. */
function lireCoutMois_(props, cle) {
  var brut = props.getProperty(cle);
  if (brut) {
    try { return JSON.parse(brut); } catch (e) { /* corrompu → on repart à zéro */ }
  }
  return { hin: 0, hout: 0, sin: 0, sout: 0, appels: 0 };
}

/**
 * Coût $ estimé d'un total de tokens, d'après les prix par MTok (CONFIG.LLM_PRIX).
 * @param {{hin:number,hout:number,sin:number,sout:number}} t
 * @return {number} dollars
 */
function coutDollars_(t) {
  var p = CONFIG.LLM_PRIX;
  return (t.hin * p.haiku_in + t.hout * p.haiku_out +
          t.sin * p.sonnet_in + t.sout * p.sonnet_out) / 1e6;
}

/**
 * Synthèse du coût du mois courant (pour le résumé hebdo).
 * @return {{appels:number, dollars:number, tokens:number}}
 */
function syntheseCoutMois_() {
  var t = lireCoutMois_(PropertiesService.getScriptProperties(), cleCoutMois_());
  return {
    appels: t.appels,
    dollars: coutDollars_(t),
    tokens: t.hin + t.hout + t.sin + t.sout
  };
}
