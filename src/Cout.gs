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

/** À appeler en tête de run. `cw`/`cr` = tokens d'ÉCRITURE / LECTURE de cache (prompt caching, Vague 3). */
function reinitialiserUsage_() {
  _usageRun = { hin: 0, hout: 0, hcw: 0, hcr: 0, sin: 0, sout: 0, scw: 0, scr: 0, appels: 0, ops: {} };
}

/**
 * Nombre MAX d'opérations distinctes retenues dans la ventilation mensuelle (C28-58). Le surplus
 * tombe dans `OP_AUTRES` : jamais perdu, jamais faussé. Borne DURE de la Script Property (~9 Ko,
 * leçon §7) : ~60 × ~45 caractères ≈ 2,7 Ko, très en deçà — et le test au plafond le vérifie.
 * Les clés viennent de `etapeSuivie_` (≈ 35 aujourd'hui) : la marge couvre les missions à venir.
 */
var COUT_OPS_MAX = 60;
var OP_AUTRES = '(autres)';
var OP_HORS_ETAPE = '(hors étape)';

/**
 * Comptabilise l'usage d'un appel. Sépare Haiku et Sonnet (prix différents), et INPUT régulier /
 * écriture cache / lecture cache (prompt caching, Vague 3 — sinon le budget §2.6 sous-estimerait :
 * la réponse Anthropic met la part cachée dans `cache_read_input_tokens`, HORS `input_tokens`).
 * @param {string} modele
 * @param {{input_tokens:number, output_tokens:number, cache_creation_input_tokens:number, cache_read_input_tokens:number}} usage
 */
function enregistrerUsage_(modele, usage) {
  if (!_usageRun || !usage) return;
  var inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  var cwTok = usage.cache_creation_input_tokens || 0, crTok = usage.cache_read_input_tokens || 0;
  var sonnet = String(modele).indexOf('sonnet') !== -1;
  if (sonnet) {
    _usageRun.sin += inTok; _usageRun.sout += outTok; _usageRun.scw += cwTok; _usageRun.scr += crTok;
  } else {
    _usageRun.hin += inTok; _usageRun.hout += outTok; _usageRun.hcw += cwTok; _usageRun.hcr += crTok;
  }
  _usageRun.appels += 1;

  // VENTILATION par opération (C28-58). On stocke des DOLLARS (déjà tarifés) et un compte
  // d'appels, pas 8 compteurs de tokens par opération : la Property mensuelle reste petite.
  // TOUT le bloc est enveloppé (revue flotte) : `enregistrerUsage_` est appelée sur le chemin
  // critique, juste après une réponse Anthropic DÉJÀ PAYÉE et sans try/catch chez l'appelant —
  // une exception ici perdrait la classification qu'on vient d'acheter. Le détail est un CONFORT,
  // les tokens ci-dessus sont la comptabilité : jamais l'un au prix de l'autre.
  try {
    if (!_usageRun.ops) _usageRun.ops = {};
    var op = _operationCouranteSure_();
    var ligne = _usageRun.ops[op] || (_usageRun.ops[op] = { d: 0, n: 0 });
    ligne.d += coutDollars_(sonnet
      ? { sin: inTok, sout: outTok, scw: cwTok, scr: crTok }
      : { hin: inTok, hout: outTok, hcw: cwTok, hcr: crTok });
    ligne.n += 1;
  } catch (e) { /* détail perdu pour cet appel — les tokens, eux, sont comptés */ }
}

/**
 * Opération courante, robuste : `Suivi.gs` peut ne pas être chargé (tests unitaires ciblés) et un
 * appel LLM peut venir de hors-tick (web app, MCP). Jamais d'exception ici — la comptabilité ne
 * doit pas pouvoir casser un appel LLM réussi.
 * @return {string}
 */
function _operationCouranteSure_() {
  try {
    var op = typeof operationCourante_ === 'function' ? operationCourante_() : '';
    return op || OP_HORS_ETAPE;
  } catch (e) { return OP_HORS_ETAPE; }
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
  t.hin += _usageRun.hin; t.hout += _usageRun.hout; t.hcw += _usageRun.hcw; t.hcr += _usageRun.hcr;
  t.sin += _usageRun.sin; t.sout += _usageRun.sout; t.scw += _usageRun.scw; t.scr += _usageRun.scr;
  t.appels += _usageRun.appels;
  t.ops = fusionnerOps_(t.ops, _usageRun.ops);
  // FILET (revue flotte C28-58) : cette Property porte AUSSI les totaux que lit le frein budget
  // §2.6. Si l'encodage venait à dépasser la limite (~9 Ko), un `setProperty` qui lève ferait
  // perdre les TOKENS eux-mêmes : le frein relirait une valeur figée et ne s'enclencherait plus
  // pendant que les campagnes dépensent. On dégrade donc comme sa fonction sœur `flusherSuiviOps_` :
  // on sacrifie le DÉTAIL, jamais la comptabilité qui protège le budget.
  try {
    props.setProperty(cle, JSON.stringify(t));
  } catch (e) {
    t.ops = {};
    props.setProperty(cle, JSON.stringify(t));
    try { journalErreur_('Cout', 'Ventilation des coûts abandonnée ce mois-ci (Property trop grosse) : ' + e); } catch (e2) { }
  }
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

/** Lit (ou initialise) le total d'un mois. Normalise les champs cache (absents des JSON d'AVANT
 * la Vague 3) à 0 — sinon `flushUsage_` ferait `undefined + n = NaN` et corromprait le compteur. */
function lireCoutMois_(props, cle) {
  var brut = props.getProperty(cle);
  if (brut) {
    try {
      var t = JSON.parse(brut);
      t.hin = t.hin || 0; t.hout = t.hout || 0; t.hcw = t.hcw || 0; t.hcr = t.hcr || 0;
      t.sin = t.sin || 0; t.sout = t.sout || 0; t.scw = t.scw || 0; t.scr = t.scr || 0;
      t.appels = t.appels || 0;
      // `ops` absent = mois entamé AVANT C28-58 : la ventilation démarre à zéro et ne prétend
      // rien sur le passé (elle sera INCOMPLÈTE ce mois-ci — dit explicitement dans l'onglet).
      t.ops = t.ops && typeof t.ops === 'object' ? t.ops : {};
      return t;
    } catch (e) { /* corrompu → on repart à zéro */ }
  }
  return { hin: 0, hout: 0, hcw: 0, hcr: 0, sin: 0, sout: 0, scw: 0, scr: 0, appels: 0, ops: {} };
}

/**
 * Fusionne la ventilation du run dans celle du mois. PURE (testée).
 *
 * BORNÉE (leçon §7 « une Property qui persiste une liste se borne ») : au-delà de `COUT_OPS_MAX`
 * opérations distinctes, les nouvelles sont agrégées dans `(autres)` — le TOTAL reste juste, seul
 * le détail des plus petites se perd. Les dollars sont arrondis à 6 décimales : sur un mois, l'écart
 * cumulé est inférieur au centième de cent, et l'encodage reste compact.
 * @param {?Object} mois
 * @param {?Object} run
 * @return {Object}
 */
function fusionnerOps_(mois, run) {
  var out = {};
  var k;
  for (k in (mois || {})) if (Object.prototype.hasOwnProperty.call(mois, k)) {
    out[k] = { d: Number(mois[k].d) || 0, n: Number(mois[k].n) || 0 };
  }
  for (k in (run || {})) if (Object.prototype.hasOwnProperty.call(run, k)) {
    var cible = k;
    // Nouvelle opération alors que le plafond est atteint ⇒ on la verse dans `(autres)` plutôt
    // que de laisser la Property croître sans borne (ou pire, de perdre le montant).
    if (!out[cible] && nbClefs_(out) >= COUT_OPS_MAX) cible = OP_AUTRES;
    var ligne = out[cible] || (out[cible] = { d: 0, n: 0 });
    ligne.d = Math.round((ligne.d + (Number(run[k].d) || 0)) * 1e6) / 1e6;
    ligne.n += Number(run[k].n) || 0;
  }
  return out;
}

/** @param {Object} o @return {number} */
function nbClefs_(o) {
  var n = 0;
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++;
  return n;
}

/**
 * Ventilation du mois, TRIÉE du plus cher au moins cher, avec la part en %. PURE (testée).
 * `restant` = ce que le total mesuré porte EN PLUS de la somme ventilée : sur un mois entamé avant
 * C28-58 il vaut presque tout, et c'est exactement ce qu'il faut DIRE plutôt que de laisser croire
 * que la ventilation couvre tout (no-fake-data).
 * @param {{ops:Object}} t  total mensuel (cf. `lireCoutMois_`)
 * @param {number} totalDollars  coût total mesuré du mois
 * @return {{lignes:Array<{op:string, dollars:number, appels:number, part:number}>,
 *           ventile:number, restant:number}}
 */
function ventilationCoutMois_(t, totalDollars) {
  var ops = (t && t.ops) || {};
  var lignes = [];
  var ventile = 0;
  for (var k in ops) if (Object.prototype.hasOwnProperty.call(ops, k)) {
    var d = Number(ops[k].d) || 0;
    ventile += d;
    lignes.push({ op: k, dollars: d, appels: Number(ops[k].n) || 0, part: 0 });
  }
  ventile = Math.round(ventile * 1e6) / 1e6;
  var base = Number(totalDollars) || 0;
  for (var i = 0; i < lignes.length; i++) {
    lignes[i].part = base > 0 ? Math.round(lignes[i].dollars / base * 1000) / 10 : 0;
  }
  lignes.sort(function (a, b) { return b.dollars - a.dollars || (a.op < b.op ? -1 : 1); });
  return { lignes: lignes, ventile: ventile, restant: Math.round((base - ventile) * 1e6) / 1e6 };
}

/**
 * Coût $ estimé d'un total de tokens, d'après les prix par MTok (CONFIG.LLM_PRIX).
 * @param {{hin:number,hout:number,sin:number,sout:number}} t
 * @return {number} dollars
 */
function coutDollars_(t) {
  var p = CONFIG.LLM_PRIX;
  // Tous les champs gardés `|| 0` : un total partiel (delta, dry-run, objet sans cache) ne doit
  // JAMAIS produire NaN — un budget NaN ne freinerait plus rien (§2.6).
  return ((t.hin || 0) * p.haiku_in + (t.hout || 0) * p.haiku_out +
          (t.hcw || 0) * p.haiku_cw + (t.hcr || 0) * p.haiku_cr +
          (t.sin || 0) * p.sonnet_in + (t.sout || 0) * p.sonnet_out +
          (t.scw || 0) * p.sonnet_cw + (t.scr || 0) * p.sonnet_cr) / 1e6;
}

/**
 * Coût $ d'un document isolé par différence de 2 relevés de `usageRunSnapshot_` (avant/après son
 * classement). PURE. Sert le dry-run C26-07 : un coût PAR LIGNE, sans compteur dédié qui dupliquerait
 * (et pourrait diverger de) la comptabilité mensuelle déjà tenue par `enregistrerUsage_`/`flushUsage_`.
 * @param {{hin:number,hout:number,sin:number,sout:number}} avant
 * @param {{hin:number,hout:number,sin:number,sout:number}} apres
 * @return {number} dollars
 */
function coutDollarsDelta_(avant, apres) {
  return coutDollars_({
    hin: apres.hin - avant.hin, hout: apres.hout - avant.hout,
    hcw: (apres.hcw || 0) - (avant.hcw || 0), hcr: (apres.hcr || 0) - (avant.hcr || 0),
    sin: apres.sin - avant.sin, sout: apres.sout - avant.sout,
    scw: (apres.scw || 0) - (avant.scw || 0), scr: (apres.scr || 0) - (avant.scr || 0)
  });
}

/**
 * Copie de l'accumulateur du run courant (jamais la référence — l'appelant ne doit pas pouvoir
 * muter `_usageRun`). Sert à mesurer un coût PAR DOCUMENT par différence de 2 relevés (dry-run
 * C26-07) sans dupliquer la comptabilité de `enregistrerUsage_`. Un objet ZÉRO (jamais `{}` — le
 * delta marche sans garde supplémentaire côté appelant) si aucun run en cours.
 * @return {{hin:number,hout:number,sin:number,sout:number,appels:number}}
 */
function usageRunSnapshot_() {
  return _usageRun
    ? { hin: _usageRun.hin, hout: _usageRun.hout, hcw: _usageRun.hcw, hcr: _usageRun.hcr,
        sin: _usageRun.sin, sout: _usageRun.sout, scw: _usageRun.scw, scr: _usageRun.scr, appels: _usageRun.appels }
    : { hin: 0, hout: 0, hcw: 0, hcr: 0, sin: 0, sout: 0, scw: 0, scr: 0, appels: 0 };
}

/**
 * Copie de la VENTILATION du run courant (jamais la référence). Symétrique de
 * `usageRunSnapshot_` : sert aux tests et à tout appelant qui veut le détail sans attendre le
 * flush mensuel. Objet VIDE si aucun run en cours.
 * @return {Object<string,{d:number,n:number}>}
 */
function usageRunOpsSnapshot_() {
  var out = {};
  if (!_usageRun || !_usageRun.ops) return out;
  for (var k in _usageRun.ops) if (Object.prototype.hasOwnProperty.call(_usageRun.ops, k)) {
    out[k] = { d: _usageRun.ops[k].d, n: _usageRun.ops[k].n };
  }
  return out;
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
    tokens: t.hin + t.hout + t.hcw + t.hcr + t.sin + t.sout + t.scw + t.scr
  };
}
