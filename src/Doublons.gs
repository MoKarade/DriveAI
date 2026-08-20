/**
 * Doublons.gs — VALIDATION de `_Doublons` par empreinte (C28-49 PR4, ADR-0047).
 *
 * `estDoublon_` (Journal.gs) répond à « ce contenu a-t-il DÉJÀ ÉTÉ VU ? », jamais à « un
 * exemplaire est-il ENCORE classé ? » : `_empreintesCache` est un ENSEMBLE d'empreintes, sans
 * aucune notion de lieu. Les deux questions coïncident tant qu'un fichier n'est présenté qu'une
 * fois ; elles divergent dès qu'un fichier déjà indexé est RE-PRÉSENTÉ au pipeline (reset,
 * migration, rattrapage) sans `ignorerDoublon` — il devient doublon de LUI-MÊME et part dans
 * `_Doublons` pendant que le dernier exemplaire classé quitte l'arborescence, sans que rien ne le
 * remarque. Constaté sur du réel le 2026-08-20 : les 3 passeports de Marc y sont, de TAILLES
 * DIFFÉRENTES (donc pas copies l'un de l'autre), et le contenu d'un bulletin scolaire y est en
 * double sans exister nulle part ailleurs.
 *
 * Cette campagne re-pose la question qui n'a jamais été posée. Elle est **STRICTEMENT LECTURE
 * SEULE** : aucun `moveTo`, aucun renommage, aucun appel LLM. Elle produit un onglet
 * `RapportDoublons` et une ligne Santé. Le rapatriement des orphelins est une décision de Marc,
 * chiffrée sur le compte EXACT (ADR-0047 §4) — pas une conséquence automatique de ce constat.
 *
 * PORTÉE : c'est un CONSTAT ONE-SHOT sur le passif, pas une surveillance. `_Doublons` reste une file
 * VIVANTE (le flux y dépose encore) ; un fichier arrivé APRÈS la fin de l'inventaire n'est pas dans
 * le rapport et ne sera pas validé. Ce n'est pas un défaut de convergence — le critère de fin est
 * « le balayage du Drive n'a plus de page », qui se termine TOUJOURS quoi qu'il arrive à la source
 * (contrairement au deadlock ADR-0035, où la fin dépendait d'une source réalimentée). Pour
 * re-valider un passif à jour : bumper `CONFIG.DOUBLONS_TABLE_VERSION`.
 *
 * L'empreinte vient du `md5Checksum` de l'API Drive, JAMAIS de l'Index : l'Index n'attache une
 * empreinte à un fileId que pour les clés dont le dernier segment EST un fileId
 * (`PREFIXES_CLE_FICHIER_`) — une pièce jointe Gmail (`messageId|i|nom|taille`) y échappe, et son
 * exemplaire classé serait invisible, produisant un « orphelin » à tort (ADR-0047 §5).
 */

/** Colonnes de l'onglet `RapportDoublons` — constante PARTAGÉE avec `initialiserSheet_`. */
var COLONNES_RAPPORT_DOUBLONS = ['Fichier', 'ID', 'Empreinte', 'Verdict', 'Preuve', 'Horodaté'];

var VERDICT_DOUBLON_CONFIRME = 'confirmé';
var VERDICT_DOUBLON_ORPHELIN = 'orphelin';
var VERDICT_DOUBLON_INDETERMINE = 'indéterminé';

/** Phases de la campagne, dans l'ordre. `fini` est terminal (jusqu'à un bump de version). */
var PHASE_DOUBLONS_INVENTAIRE = 'inventaire';
var PHASE_DOUBLONS_BALAYAGE = 'balayage';
var PHASE_DOUBLONS_FINI = 'fini';

/**
 * PURE — un fichier rencontré pendant le balayage est-il un EXEMPLAIRE SURVIVANT du contenu,
 * c'est-à-dire une copie ENCORE ACCESSIBLE hors de `_Doublons` ?
 *
 * Le test porte sur les PARENTS, pas sur l'identité : un fichier multi-parents dont l'un des
 * parents est `_Doublons` et l'autre un domaine est bel et bien resté classé — le compter comme
 * survivant est la lecture juste. À l'inverse, un fichier dont `_Doublons` est le SEUL parent ne
 * peut pas se confirmer lui-même.
 *
 * Sans `md5Checksum` (fichier Google natif), aucune comparaison de contenu n'est possible : on ne
 * confirme RIEN plutôt que de deviner.
 *
 * @param {{md5Checksum:string, parents:string[]}} fichier  entrée `files.list` de l'API Drive
 * @param {string} doublonsId  ID du dossier `_Doublons`
 * @return {boolean}
 */
function estExemplaireSurvivant_(fichier, doublonsId) {
  if (!fichier || !fichier.md5Checksum) return false;
  var parents = fichier.parents || [];
  for (var i = 0; i < parents.length; i++) {
    if (parents[i] && parents[i] !== doublonsId) return true;
  }
  return false;
}

/**
 * PURE — verdict de CLÔTURE d'une ligne restée sans verdict après un balayage COMPLET du Drive.
 *
 * `indéterminé` n'est PAS un `orphelin` prudent : c'est un aveu. Sans empreinte, la question n'a
 * pas été posée — l'annoncer « orphelin » gonflerait le compte qui va servir à chiffrer un
 * rapatriement (leçon §9 : ne jamais additionner une erreur de lecture avec une vraie donnée).
 *
 * @param {string} empreinte
 * @return {{verdict:string, preuve:string}}
 */
function verdictClotureDoublon_(empreinte) {
  if (!empreinte) {
    return {
      verdict: VERDICT_DOUBLON_INDETERMINE,
      preuve: 'aucune empreinte (fichier Google natif : l\'API ne rend pas de md5Checksum)'
    };
  }
  return {
    verdict: VERDICT_DOUBLON_ORPHELIN,
    preuve: 'balayage COMPLET du Drive : aucun exemplaire de ce contenu hors _Doublons'
  };
}

/**
 * PURE — URL de pagination `files.list`. Le `q` et les champs sont encodés ici (un `q` non encodé
 * casse dès qu'un nom contient une apostrophe ou un espace).
 * @param {string} q
 * @param {string} champs  ex. 'nextPageToken,files(id,name,md5Checksum,parents)'
 * @param {string} pageToken  '' pour la première page
 * @param {number} taillePage
 * @return {string}
 */
function urlListeDrive_(q, champs, pageToken, taillePage) {
  return 'https://www.googleapis.com/drive/v3/files' +
    '?q=' + encodeURIComponent(q) +
    '&fields=' + encodeURIComponent(champs) +
    '&pageSize=' + encodeURIComponent(String(taillePage)) +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
}

/**
 * PURE — bilan des verdicts d'un rapport (colonne Verdict brute).
 * @param {Array<string>} verdicts
 * @return {{total:number, confirmes:number, orphelins:number, indetermines:number, restants:number}}
 */
function bilanDoublons_(verdicts) {
  var b = { total: 0, confirmes: 0, orphelins: 0, indetermines: 0, restants: 0 };
  (verdicts || []).forEach(function (v) {
    var s = String(v == null ? '' : v);
    if (!s) { b.total++; b.restants++; return; }
    b.total++;
    if (s === VERDICT_DOUBLON_CONFIRME) b.confirmes++;
    else if (s === VERDICT_DOUBLON_ORPHELIN) b.orphelins++;
    else if (s === VERDICT_DOUBLON_INDETERMINE) b.indetermines++;
  });
  return b;
}

/**
 * PURE — ligne Santé de la campagne. Marc lit CET écran ; il doit y voir l'état réel, jamais un
 * « OK » qui masque une campagne à l'arrêt (leçon §9 : « en PAUSE, dire le RESTE et la REPRISE,
 * jamais une date de fin »).
 * @param {string} phase
 * @param {{total:number, confirmes:number, orphelins:number, indetermines:number, restants:number}} bilan
 * @return {string}
 */
function ligneSanteDoublons_(phase, bilan) {
  if (!CONFIG.DOUBLONS_ACTIF) return 'désactivée (CONFIG)';
  if (phase === PHASE_DOUBLONS_FINI) {
    return 'terminée ✅ — ' + bilan.total + ' écartés : ' + bilan.confirmes + ' confirmés, ' +
      bilan.orphelins + ' ORPHELINS (seul exemplaire), ' + bilan.indetermines + ' indéterminés';
  }
  if (phase === PHASE_DOUBLONS_BALAYAGE) {
    return 'balayage du Drive en cours — ' + bilan.total + ' écartés inventoriés, ' +
      bilan.confirmes + ' déjà confirmés';
  }
  return 'inventaire de _Doublons en cours — ' + bilan.total + ' fichiers recensés';
}

/** Consommation du budget QUOTIDIEN (ms réelles persistées `AAAA/MM/JJ|ms`). PUR sur props. */
function budgetJourDoublons_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_DOUBLONS_JOUR_MS') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * UNE page de `files.list`. LÈVE sur erreur HTTP : une page perdue en silence ferait conclure
 * « aucun exemplaire ailleurs » sur un Drive à moitié lu — le pire faux positif de cette campagne
 * (leçon §9 : une fonction d'agrégation ne dégrade JAMAIS une exception vers son compte de repos).
 * @param {string} url
 * @return {{files:Array, nextPageToken:string}}
 */
function pageListeDrive_(url) {
  var rep = fetchDriveAvecRetry_(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + jetonDrive_() },
    muteHttpExceptions: true
  });
  var code = rep.getResponseCode();
  if (code !== 200) {
    throw new Error('files.list HTTP ' + code + ' : ' + tronquer_(rep.getContentText(), 300));
  }
  var o = JSON.parse(rep.getContentText());
  return { files: o.files || [], nextPageToken: o.nextPageToken || '' };
}

/**
 * ID de `_Doublons`, résolu SANS jamais le créer.
 *
 * `dossierDoublons_()` (Router.gs) est un find-or-CREATE : l'appeler ici ferait apparaître un
 * dossier vide dès que la Script Property manque — une mutation Drive, pour rien, dans une campagne
 * qui promet « lecture seule de bout en bout ». Et s'il n'existe pas, il n'y a rien à valider.
 * Deux voies de résolution, comme le résolveur canonique moins la création : la Property d'abord
 * (le cas normal — elle est posée depuis le premier doublon écarté), puis la recherche PAR NOM à la
 * racine DriveAI (filet si la Property a été perdue).
 * @return {string} '' si le dossier n'existe pas
 */
function idDoublonsSansCreer_() {
  var id = PropertiesService.getScriptProperties().getProperty('DriveAI_DOUBLONS_ID');
  if (id) {
    try { return DriveApp.getFolderById(id).getId(); } catch (e) { /* supprimé : on cherche par nom */ }
  }
  var aTrier = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER);
  var parents = aTrier.getParents();
  var racine = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = racine.getFoldersByName('_Doublons');
  return it.hasNext() ? it.next().getId() : '';
}

/** Onglet `RapportDoublons`, en-tête réparé LÀ OÙ il est réellement écrit (leçon §9). */
function feuilleRapportDoublons_() {
  var f = feuille_('RapportDoublons');
  if (String(f.getRange(1, 1).getValue()) !== COLONNES_RAPPORT_DOUBLONS[0]) {
    f.getRange(1, 1, 1, COLONNES_RAPPORT_DOUBLONS.length).setValues([COLONNES_RAPPORT_DOUBLONS]);
  }
  return f;
}

/**
 * ÉTAPE DE TICK — I/O pur (Drive REST + Sheet), jamais de LLM ⇒ budget TAIL. Trois phases, chacune
 * reprenable par un jeton de pagination persisté ; l'état VOLUMINEUX (une ligne par fichier écarté)
 * vit dans l'ONGLET, jamais dans une Property (1 076 empreintes ≈ 43 Ko contre ~9 Ko de plafond —
 * leçon §9).
 *
 * ORDRE DES ÉCRITURES : les verdicts d'une page sont écrits AVANT que son jeton ne soit persisté.
 * Une coupure re-lit la page (idempotent : re-marquer une ligne déjà marquée est un no-op) au lieu
 * de la sauter — une page sautée produirait de FAUX orphelins, invisibles.
 *
 * Le garde-temps est évalué AVANT CHAQUE page, DANS la boucle qui fait l'appel réseau — jamais une
 * sélection « pure » suivie d'une exécution non gardée (leçon §9).
 *
 * @param {function():boolean} estBudgetDepasse
 */
function majValidationDoublons_(estBudgetDepasse) {
  if (!CONFIG.DOUBLONS_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var version = CONFIG.DOUBLONS_TABLE_VERSION;

  // Bump de version ⇒ tout est re-évalué : le rapport repart de zéro (sinon les lignes de
  // l'ancienne version se mélangeraient aux neuves et le bilan mentirait).
  if (props.getProperty('DriveAI_DOUBLONS_VERSION') !== version) {
    var fRaz = feuilleRapportDoublons_();
    if (fRaz.getLastRow() > 1) fRaz.deleteRows(2, fRaz.getLastRow() - 1);
    props.setProperty('DriveAI_DOUBLONS_PHASE', PHASE_DOUBLONS_INVENTAIRE);
    props.setProperty('DriveAI_DOUBLONS_PAGE', '');
    props.setProperty('DriveAI_DOUBLONS_VERSION', version);
  }

  var phase = props.getProperty('DriveAI_DOUBLONS_PHASE') || PHASE_DOUBLONS_INVENTAIRE;
  if (phase === PHASE_DOUBLONS_FINI) return; // court-circuit terminal : 2 lectures Property/tick

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourDoublons_(props, aujourdhui);
  if (consommeJour >= CONFIG.DOUBLONS_BUDGET_JOUR_MS) return; // repris demain

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.DOUBLONS_BUDGET_MS, CONFIG.DOUBLONS_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  try {
    var doublonsId = idDoublonsSansCreer_();
    if (!doublonsId) return; // pas de `_Doublons` : rien à valider (et surtout : rien à créer)
    if (phase === PHASE_DOUBLONS_INVENTAIRE) inventorierDoublons_(props, doublonsId, garde);
    // Le balayage démarre dans le MÊME run si l'inventaire vient de finir et qu'il reste du budget.
    if (props.getProperty('DriveAI_DOUBLONS_PHASE') === PHASE_DOUBLONS_BALAYAGE && !garde()) {
      balayerExemplairesDoublons_(props, doublonsId, garde);
    }
  } finally {
    try { props.setProperty('DriveAI_DOUBLONS_JOUR_MS', aujourdhui + '|' + (consommeJour + (Date.now() - debut))); }
    catch (e) { /* budget best-effort : jamais une exception qui masque celle du corps */ }
  }
}

/**
 * PHASE 1 — recense `_Doublons` dans l'onglet. Idempotent PAR ID : une page re-lue après une
 * coupure ne duplique aucune ligne (le jeton est persisté APRÈS l'écriture, donc une page PEUT
 * être re-lue — c'est voulu, cf. l'ordre des écritures).
 */
function inventorierDoublons_(props, doublonsId, garde) {
  var f = feuilleRapportDoublons_();
  var connus = {};
  if (f.getLastRow() > 1) {
    f.getRange(2, 2, f.getLastRow() - 1, 1).getValues().forEach(function (l) {
      if (l[0]) connus[String(l[0])] = true;
    });
  }
  var q = "'" + doublonsId + "' in parents and trashed = false";
  var champs = 'nextPageToken,files(id,name,md5Checksum)';
  var jeton = props.getProperty('DriveAI_DOUBLONS_PAGE') || '';

  while (true) {
    if (garde()) return; // AVANT l'appel réseau, dans la boucle qu'il protège
    var page = pageListeDrive_(urlListeDrive_(q, champs, jeton, CONFIG.DOUBLONS_TAILLE_PAGE));
    var lignes = [];
    var horodate = new Date();
    page.files.forEach(function (fi) {
      if (connus[fi.id]) return;
      connus[fi.id] = true;
      lignes.push([fi.name || '', fi.id, fi.md5Checksum || '', '', '', horodate]);
    });
    if (lignes.length) {
      f.getRange(f.getLastRow() + 1, 1, lignes.length, COLONNES_RAPPORT_DOUBLONS.length).setValues(lignes);
    }
    jeton = page.nextPageToken;
    props.setProperty('DriveAI_DOUBLONS_PAGE', jeton); // APRÈS l'écriture des lignes
    if (!jeton) {
      props.setProperty('DriveAI_DOUBLONS_PHASE', PHASE_DOUBLONS_BALAYAGE);
      journalInfo_('Doublons', 'Inventaire terminé : ' + (f.getLastRow() - 1) + ' fichiers écartés recensés.');
      return;
    }
  }
}

/**
 * PHASE 2 — balaie le Drive et confirme les empreintes qui ont encore un exemplaire ailleurs.
 * PHASE 3 (clôture) — le balayage épuisé, tout ce qui reste sans verdict est tranché.
 */
function balayerExemplairesDoublons_(props, doublonsId, garde) {
  var f = feuilleRapportDoublons_();
  var dern = f.getLastRow();
  if (dern < 2) { // rien à valider : `_Doublons` est vide
    props.setProperty('DriveAI_DOUBLONS_PHASE', PHASE_DOUBLONS_FINI);
    return;
  }
  var n = dern - 1;
  var empreintes = f.getRange(2, 3, n, 1).getValues();
  var verdicts = f.getRange(2, 4, n, 1).getValues();
  var preuves = f.getRange(2, 5, n, 1).getValues();

  // Index empreinte → lignes ENCORE sans verdict. Reconstruit à chaque run (la structure ne
  // survit pas au run, mais elle n'a rien à mémoriser d'un run à l'autre : l'état vit dans l'onglet).
  var parEmpreinte = {};
  for (var i = 0; i < n; i++) {
    var e = String(empreintes[i][0] || '');
    if (!e || verdicts[i][0]) continue;
    (parEmpreinte[e] || (parEmpreinte[e] = [])).push(i);
  }

  var q = "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
  var champs = 'nextPageToken,files(id,md5Checksum,parents)';
  var jeton = props.getProperty('DriveAI_DOUBLONS_PAGE') || '';

  while (true) {
    if (garde()) return; // les verdicts de la dernière page traitée sont déjà écrits
    var page = pageListeDrive_(urlListeDrive_(q, champs, jeton, CONFIG.DOUBLONS_TAILLE_PAGE));
    var modifie = false;
    page.files.forEach(function (fi) {
      if (!estExemplaireSurvivant_(fi, doublonsId)) return;
      var lignes = parEmpreinte[fi.md5Checksum];
      if (!lignes) return;
      lignes.forEach(function (idx) {
        verdicts[idx][0] = VERDICT_DOUBLON_CONFIRME;
        preuves[idx][0] = 'exemplaire encore classé : ' + fi.id;
      });
      delete parEmpreinte[fi.md5Checksum];
      modifie = true;
    });
    // Écriture SEULEMENT si la page a tranché quelque chose : sans ce filtre, un balayage de
    // ~17 pages réécrirait 2 colonnes entières 17 fois pour rien (I/O Sheet, poste le plus cher ici).
    if (modifie) ecrireVerdictsDoublons_(f, n, verdicts, preuves); // AVANT le jeton : jamais une page sautée
    jeton = page.nextPageToken;
    props.setProperty('DriveAI_DOUBLONS_PAGE', jeton);
    if (!jeton) {
      for (var j = 0; j < n; j++) {
        if (verdicts[j][0]) continue;
        var v = verdictClotureDoublon_(String(empreintes[j][0] || ''));
        verdicts[j][0] = v.verdict;
        preuves[j][0] = v.preuve;
      }
      ecrireVerdictsDoublons_(f, n, verdicts, preuves);
      var b = bilanDoublons_(verdicts.map(function (l) { return l[0]; }));
      // Bilan FIGÉ dans une Property AVANT le drapeau : la ligne Santé s'en sert ensuite, au lieu de
      // relire ~1 076 cellules à CHAQUE tick (288×/j) pour un rapport qui ne bougera plus. Sans ce
      // court-circuit, la campagne TERMINÉE serait le seul poste qui continue de payer — c'est
      // exactement le piège de l'exposition par-tick d'un diagnostic (leçon §9).
      props.setProperty('DriveAI_DOUBLONS_BILAN', JSON.stringify(b));
      props.setProperty('DriveAI_DOUBLONS_PHASE', PHASE_DOUBLONS_FINI);
      journalInfo_('Doublons', 'Validation TERMINÉE (version ' + CONFIG.DOUBLONS_TABLE_VERSION + ') : ' +
        b.total + ' écartés — ' + b.confirmes + ' confirmés, ' + b.orphelins +
        ' ORPHELINS (seul exemplaire de leur contenu), ' + b.indetermines + ' indéterminés. ' +
        'Aucun fichier déplacé (ADR-0047 §4).');
      return;
    }
  }
}

/** Écrit les colonnes Verdict + Preuve en UNE fois (I/O borné par run, pas par ligne). */
function ecrireVerdictsDoublons_(f, n, verdicts, preuves) {
  f.getRange(2, 4, n, 1).setValues(verdicts);
  f.getRange(2, 5, n, 1).setValues(preuves);
}

/**
 * Ligne Santé de la campagne — LECTURE SEULE, et JAMAIS bloquante : un rapport illisible ne doit
 * pas empêcher le heartbeat de s'écrire (c'est le seul canal que Marc lit quand tout le reste est
 * muet). Dégrade en texte explicite plutôt qu'en compte de repos trompeur.
 * @return {string}
 */
function texteSanteDoublons_() {
  if (!CONFIG.DOUBLONS_ACTIF) return 'désactivée (CONFIG)';
  try {
    var props = PropertiesService.getScriptProperties();
    var phase = props.getProperty('DriveAI_DOUBLONS_PHASE') || PHASE_DOUBLONS_INVENTAIRE;
    // Campagne terminée : le bilan est figé, on ne relit plus l'onglet (cf. la clôture ci-dessus).
    if (phase === PHASE_DOUBLONS_FINI) {
      var fige = props.getProperty('DriveAI_DOUBLONS_BILAN');
      if (fige) return ligneSanteDoublons_(phase, JSON.parse(fige));
    }
    var f = feuille_('RapportDoublons');
    var dern = f.getLastRow();
    var verdicts = dern > 1 ? f.getRange(2, 4, dern - 1, 1).getValues().map(function (l) { return l[0]; }) : [];
    return ligneSanteDoublons_(phase, bilanDoublons_(verdicts));
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}
