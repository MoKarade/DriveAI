/**
 * Maintenance.gs — Utilitaires à exécuter À LA MAIN (pas dans le pipeline auto).
 *
 * Outils ponctuels (ex. `dequarantaine`, `rangerToutLeDrive`) + la mécanique du GRAND RANGEMENT
 * (collecte/progression) que le tick pilote via `appliquerRangementInitial_` (Main.gs).
 */

/**
 * Sort de quarantaine TOUS les documents (statut Index « quarantaine ») : retire leur ligne
 * d'Index ET leur ligne « Échecs », puis relance le pipeline pour les re-traiter. Utile après une
 * panne transitoire (Gmail/Drive momentanément indisponible) ayant quarantiné à tort un doc sain.
 *
 * À lancer À LA MAIN (un clic). Aucune suppression de fichier : un dépôt quarantiné est resté dans
 * `00·À trier` (re-collecté au prochain tick) ; une PJ Gmail est re-cherchée dans la fenêtre 30 j.
 * On supprime les lignes en ordre DÉCROISSANT (pas de décalage). Tourne hors tick → pas de cache à
 * invalider (le cache d'Index/Échecs est reconstruit au prochain `tickDriveAI`).
 */
function dequarantaine() {
  var f = feuille_('Index');
  var dern = f.getLastRow();
  var cles = {}, lignes = [];
  if (dern >= 2) {
    var v = f.getRange(2, 1, dern - 1, 6).getValues(); // A=Clé … F=Statut
    for (var i = 0; i < v.length; i++) {
      if (v[i][5] === 'quarantaine') { cles[v[i][0]] = true; lignes.push(i + 2); }
    }
  }
  if (!lignes.length) { journalInfo_('Maintenance', 'Aucun document en quarantaine.'); return; }

  lignes.sort(function (a, b) { return b - a; });
  for (var k = 0; k < lignes.length; k++) f.deleteRow(lignes[k]);

  // Retire aussi les compteurs « Échecs » correspondants (sinon le doc repartirait avec un
  // compteur déjà élevé et re-quarantinerait au 1er nouvel échec).
  var fe = feuille_('Échecs');
  var derE = fe.getLastRow();
  if (derE >= 2) {
    var ve = fe.getRange(2, 1, derE - 1, 1).getValues(); // A=Clé
    var lignesE = [];
    for (var j = 0; j < ve.length; j++) { if (cles[ve[j][0]]) lignesE.push(j + 2); }
    lignesE.sort(function (a, b) { return b - a; });
    for (var m = 0; m < lignesE.length; m++) fe.deleteRow(lignesE[m]);
  }

  journalInfo_('Maintenance', lignes.length + ' document(s) sortis de quarantaine — re-traités au prochain run.');
  tickDriveAI();
}

/* ============================================================================
 * GRAND RANGEMENT — réorganiser tout le contenu existant des domaines.
 * ==========================================================================*/

/**
 * Passe tout le contenu DÉJÀ présent dans les 7 domaines à travers le pipeline.
 *
 * Pour chaque fichier « en vrac » (nom NON encore au format `AAAA-MM-JJ_…`), on le
 * DÉPLACE vers `00·À trier` (réversible) ; l'intake le reprend ensuite (OCR → analyse
 * approfondie → renommage → classement au bon endroit + sous-dossiers créés au besoin).
 *
 * Garde-fous (réutilise tout le pipeline, donc tous ses garde-fous) :
 *   - DÉPLACEMENT seul, JAMAIS de suppression (le fichier reste dans le Drive) ;
 *   - `04 · Immigration` (zone protégée) n'est JAMAIS parcourue ; et — garde-fou §1 —
 *     tout fichier ayant ne serait-ce qu'UN parent dans (ou sous) un domaine protégé est
 *     ÉCARTÉ : on ne le déplace pas, pour ne jamais le détacher de la zone protégée (cas
 *     d'un fichier multi-parents). Plus de file de revue (décision Marc 2026-07-01) : tout doc
 *     re-traité est CLASSÉ au mieux par le pipeline (sensible inclus) ; les médias sans texte
 *     partent dans `_Médias` (ADR-0009 §2, cf. Pipeline.traiterDocument_) ;
 *   - fichiers déjà normalisés (`AAAA-MM-JJ_…`) et fichiers Google natifs : SAUTÉS
 *     (idempotent → relancer ne re-coûte rien, pas de churn) ;
 *   - borné par le garde-temps partagé (coupure 6 min) ET par run (`RANGEMENT_MAX_PAR_RUN`) :
 *     si la collecte est interrompue ou le plafond atteint, le Journal le dit → relancer
 *     `rangerToutLeDrive()`. Couvre les 7 domaines + les racines `RANGEMENT_RACINES_SUP`
 *     (ancien Drive « Ancienne structure »).
 *
 * Déclenché AUTOMATIQUEMENT (zéro clic) au déploiement via `CONFIG.RANGEMENT_TAG`
 * (cf. Main.appliquerRangementInitial_), et reste lançable À LA MAIN pour un re-run ponctuel.
 * Coût : OCR + LLM sur chaque fichier en vrac (one-shot, réparti sur plusieurs ticks).
 */
function rangerToutLeDrive() {
  try {
    var debut = Date.now();
    var estBudgetDepasse = function () { return Date.now() - debut > CONFIG.BUDGET_MS; };
    var r = rangerUnePage_(estBudgetDepasse, ensembleDomainesProteges_());
    journalInfo_('Rangement', r.deplaces + ' fichier(s) en vrac renvoyé(s) dans 00·À trier pour reclassement' +
      (r.reste ? ' (interrompu/plafond — relance rangerToutLeDrive()).' : '.'));

    // Avance la barre (best-effort) si une campagne auto a déjà posé la base ; sinon sans effet.
    if (r.deplaces) { try { majProgression_(r.deplaces); } catch (e) {} }
    if (!r.reste && r.collectes === 0) { try { finaliserProgression_(); } catch (e) {} }

    // Amorce le re-traitement SEULEMENT s'il reste du budget : tickDriveAI() repart sur son
    // propre budget de 4.5 min ; l'enchaîner après un rangement déjà long dépasserait la limite
    // dure de 6 min d'Apps Script. Sinon, les fichiers sont déjà dans 00·À trier → le trigger reprend.
    if (r.deplaces && !estBudgetDepasse()) tickDriveAI();
  } catch (e) {
    notifierEchec_('Rangement', 'Grand rangement interrompu : ' + e);
  }
}

/**
 * UNE passe bornée du grand rangement : collecte (lecture seule) jusqu'à `RANGEMENT_MAX_PAR_RUN`
 * fichiers en vrac dans les domaines NON protégés, puis les DÉPLACE vers `00·À trier`. Tout est
 * borné par le garde-temps + le plafond/run, et reprenable (déplacement seul, idempotent au format).
 * Partagé entre le lancement manuel (`rangerToutLeDrive`) et l'auto (`appliquerRangementInitial_`).
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {{deplaces:number, collectes:number, reste:boolean}}
 */
function rangerUnePage_(estBudgetDepasse, proteges) {
  var ids = [];
  // Une collecte qui ÉCHOUE (exception attrapée) ne doit JAMAIS ressembler à « 0 fichier = terminé » :
  // sinon le rangement se fige « terminé » sans avoir rien rangé (incident r2, cf. P1-17). On trace donc
  // l'erreur et on force `reste = true` (on réessaiera au prochain tick).
  var erreurCollecte = false;

  // 1) Racines supplémentaires (ancien Drive « Ancienne structure ») EN PREMIER : c'est le gros du
  // travail restant. On les attaque avant les 7 domaines (déjà rangés, quasi tous normalisés) pour
  // que la collecte atteigne bien les dossiers profonds au lieu de s'épuiser à re-parcourir le neuf.
  var racinesSup = CONFIG.RANGEMENT_RACINES_SUP || [];
  for (var r = 0; r < racinesSup.length && ids.length < CONFIG.RANGEMENT_MAX_PAR_RUN; r++) {
    if (estBudgetDepasse()) break;
    try {
      collecterAReclasser_(
        DriveApp.getFolderById(racinesSup[r]), ids, CONFIG.RANGEMENT_MAX_PAR_RUN, estBudgetDepasse, proteges);
    } catch (e) {
      erreurCollecte = true;
      journalErreur_('Rangement', 'Racine supplémentaire inaccessible (' + racinesSup[r] + ') : ' + e);
    }
  }

  // 2) Les domaines FIXES (contenu « en vrac » résiduel). On itère `Object.keys(CONFIG.DOMAINES)` et NON
  // `domainesAutorises_()` : les domaines AUTO-créés (07 · Santé) n'ont pas d'ID fixe (→ `getFolderById(undefined)`
  // lèverait, `erreurCollecte=true` à chaque passe → faux « non-terminé », le rangement ne convergerait
  // jamais, cf. leçon P1-17) et n'ont de toute façon pas de vrac à re-collecter (ils sont peuplés par le
  // pipeline). Mêmes garde-fous (zone protégée multi-parents, format normalisé sauté, garde-temps).
  var domaines = Object.keys(CONFIG.DOMAINES);
  for (var d = 0; d < domaines.length && ids.length < CONFIG.RANGEMENT_MAX_PAR_RUN; d++) {
    if (estBudgetDepasse()) break;
    var dom = domaines[d];
    if (CONFIG.DOMAINES_PROTEGES.indexOf(dom) !== -1) continue; // zone protégée : intouchée
    try {
      collecterAReclasser_(
        DriveApp.getFolderById(CONFIG.DOMAINES[dom]), ids, CONFIG.RANGEMENT_MAX_PAR_RUN, estBudgetDepasse, proteges);
    } catch (e) {
      erreurCollecte = true;
      journalErreur_('Rangement', 'Domaine inaccessible (' + dom + ') : ' + e);
    }
  }

  var collecteInterrompue = estBudgetDepasse();

  var n = 0;
  for (var i = 0; i < ids.length; i++) {
    if (estBudgetDepasse()) { collecteInterrompue = true; break; }
    if (deplacerVersATrier_(ids[i], proteges)) n++;
  }

  // NB : la barre de progression est orchestrée par l'appelant `appliquerRangementInitial_` (recensement
  // dans un tick dédié + `majProgression_` après cette page), PAS ici — pour ne pas re-parcourir tout le
  // Drive à chaque page (le recensement est one-shot). Le lancement MANUEL (`rangerToutLeDrive`) met la
  // barre à jour lui-même, best-effort.
  return {
    deplaces: n,
    collectes: ids.length,
    // `erreurCollecte` ⇒ reste=true : une collecte incomplète (exception) n'est jamais un « terminé ».
    reste: collecteInterrompue || erreurCollecte || ids.length >= CONFIG.RANGEMENT_MAX_PAR_RUN
  };
}

/**
 * Met à jour la « barre de chargement » du rangement de l'ancien Drive (onglet `Progression`) après une
 * page. La base (total « en vrac » recensé une fois) est posée par l'appelant `appliquerRangementInitial_` ;
 * ici on ne fait que CUMULER les fichiers sortis (`TRAITES`) et re-baser au besoin. Best-effort.
 *
 * Re-base : si on sort PLUS que le total recensé (fichiers ajoutés / redevenus en vrac après le
 * recensement), la base suit `traites` — la barre ne dépasse jamais 100 % ni n'affiche « terminé » à
 * tort. Le vrai « terminé » (100 %) est posé par `finaliserProgression_` sur le signal de fin réel.
 * @param {number} deplacesCeRun
 */
function majProgression_(deplacesCeRun) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RANGEMENT_BASE') === null) return; // pas encore recensé → pas de barre
  var base = Number(props.getProperty('DriveAI_RANGEMENT_BASE')) || 0;
  var traites = (Number(props.getProperty('DriveAI_RANGEMENT_TRAITES')) || 0) + deplacesCeRun;
  if (traites > base) base = traites;               // re-base : le total suit (jamais > 100 %)
  props.setProperty('DriveAI_RANGEMENT_BASE', String(base));
  props.setProperty('DriveAI_RANGEMENT_TRAITES', String(traites));
  ecrireProgression_(traites, base, false);
}

/**
 * Fige la barre à 100 % (« terminé ») sur le VRAI signal de fin du rangement (une passe ne collecte plus
 * rien) — plutôt que sur `traites >= base`, qui ne converge pas exactement (base figée vs traites cumulé).
 * Best-effort.
 */
function finaliserProgression_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DriveAI_RANGEMENT_BASE') === null) return;
  var base = Number(props.getProperty('DriveAI_RANGEMENT_BASE')) || 0;
  var traites = Number(props.getProperty('DriveAI_RANGEMENT_TRAITES')) || 0;
  if (traites > base) base = traites;
  props.setProperty('DriveAI_RANGEMENT_BASE', String(base));
  props.setProperty('DriveAI_RANGEMENT_TRAITES', String(base));
  ecrireProgression_(base, base, true);
}

/**
 * Recense (compte, sans rien déplacer) les fichiers « en vrac » restant dans les racines
 * supplémentaires. Borné par le garde-temps et un plafond dur (anti-emballement mémoire/temps).
 * @return {{n:number, complet:boolean}}
 */
function compterVracRacines_(estBudgetDepasse) {
  var racinesSup = CONFIG.RANGEMENT_RACINES_SUP || [];
  var etat = { n: 0, complet: true };
  for (var r = 0; r < racinesSup.length; r++) {
    if (estBudgetDepasse()) { etat.complet = false; break; }
    try {
      compterVracDossier_(DriveApp.getFolderById(racinesSup[r]), etat, estBudgetDepasse);
    } catch (e) {
      etat.complet = false; // racine illisible → recensement non fiable, on réessaiera
    }
  }
  return etat;
}

/**
 * Compte récursif des fichiers « à reclasser » d'un dossier (lecture seule, borné). Utilise le
 * prédicat LÉGER `estAReclasserLeger_` (name + mime, SANS getParents par fichier) — sinon, sur un
 * gros Drive, le recensement ne finirait jamais dans le budget d'un run.
 */
function compterVracDossier_(dossier, etat, estBudgetDepasse) {
  if (etat.n > 20000) { etat.complet = false; return; } // plafond dur de sécurité
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (estBudgetDepasse()) { etat.complet = false; return; }
    if (estAReclasserLeger_(fi.next())) etat.n++;
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (estBudgetDepasse()) { etat.complet = false; return; }
    compterVracDossier_(fo.next(), etat, estBudgetDepasse);
    if (!etat.complet) return;
  }
}

/**
 * Prédicat LÉGER pour le RECENSEMENT de la barre : nom + mime seulement, SANS le contrôle de parent
 * protégé (`getParents` par fichier = coûteux → recensement qui ne finit jamais sur un gros Drive).
 * Sur « Ancienne structure » aucun fichier n'a pour ancêtre le dossier-domaine `04·Immigration`
 * (dossier distinct), donc ce prédicat est LE prédicat de collecte (la garde §1 vit à la MUTATION, `aParentProtege_` strict) ; l'écart éventuel n'affecte qu'une
 * ESTIMATION (dénominateur), corrigée par la re-base et la finalisation sur le vrai signal de fin.
 * La COLLECTE et le DÉPLACEMENT réels gardent, eux, le prédicat complet (garde zone protégée §1).
 * @param {File} f
 * @return {boolean}
 */
function estAReclasserLeger_(f) {
  if (/^\d{4}(-\d{2}){0,2}_/.test(f.getName())) return false; // déjà rangé/renommé (AAAA_, AAAA-MM_ ou AAAA-MM-JJ_ — le nommage PAR TYPE produit les 3 granularités, cf. Router.nomParType_)
  // P3 (#11) : un fichier DÉJÀ TRAITÉ (clé drive| à l'Index — ex. un média sorti de _Médias à la main,
  // nom d'origine sans préfixe date) n'est JAMAIS re-collecté : l'intake le sauterait (idempotence) et
  // il resterait coincé dans 00·À trier à vie. Lookup O(1) sur le cache Index (chargé 1×/run).
  if (indexContient_('drive|' + f.getId())) return false;
  var mime = f.getMimeType() || '';
  if (mime.indexOf('application/vnd.google-apps') === 0) return false; // natif ou raccourci
  return true;
}

/**
 * Écrit une barre « recensement en cours » (onglet visible dès le 1er tick, avant même le comptage).
 * @param {number} essaisFaits  nb de passes de recensement déjà tentées
 */
function ecrireRecensement_(essaisFaits) {
  var f = feuille_('Progression');
  f.getRange('A2').setValue('[░░░░░░░░░░░░░░░░░░░░] démarrage…');
  f.getRange('A3').setValue('Recensement de « Ancienne structure » en cours (passe ' + (essaisFaits + 1) + ')…');
  f.getRange('A4').setValue('Mis à jour : ' + new Date());
}

/**
 * Écrit la barre de chargement (texte) dans l'onglet `Progression`, cellules A2..A4.
 * Tant que le rangement continue (`estFini` faux), le pourcentage est plafonné à 99 % : seul le vrai
 * signal de fin (`finaliserProgression_`) affiche 100 % et « ✅ terminé » — jamais un « terminé » à tort.
 * @param {number} traites
 * @param {number} base
 * @param {boolean} estFini
 */
function ecrireProgression_(traites, base, estFini) {
  var pct = estFini ? 100 : (base > 0 ? Math.min(99, Math.round((traites / base) * 100)) : 0);
  var pleins = Math.round(pct / 5);                 // barre de 20 caractères (1 = 5 %)
  var barre = '[' + repeter_('█', pleins) + repeter_('░', 20 - pleins) + '] ' + pct + ' %';
  var restant = estFini ? 0 : Math.max(0, base - traites);
  var f = feuille_('Progression');
  f.getRange('A2').setValue(barre);
  f.getRange('A3').setValue(traites + ' classés / ' + base + '  ·  ' + restant + ' restant(s) dans « Ancienne structure »' +
    (estFini ? '  ✅ terminé' : ''));
  f.getRange('A4').setValue('Mis à jour : ' + new Date());
}

/** Répète un caractère n fois (n négatif → chaîne vide). */
function repeter_(c, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += c;
  return s;
}

/** Nombre de fichiers dans `00·À trier`, compté jusqu'à `plafond` (au-delà on renvoie `plafond`). */
function nbFichiersATrier_(plafond) {
  var it = DriveApp.getFolderById(CONFIG.DOSSIERS.A_TRIER).getFiles();
  var n = 0;
  while (it.hasNext() && n < plafond) { it.next(); n++; }
  return n;
}

/**
 * Parcourt récursivement un dossier et collecte les IDs des fichiers à reclasser.
 * Lecture seule (aucun déplacement ici → pas d'invalidation d'itérateur). Borné par le garde-temps.
 *
 * PERF (P1-19) : la collecte utilise le prédicat LÉGER (`estAReclasserLeger_`, nom + mime, SANS
 * `getParents` par fichier) — le contrôle de zone protégée §1 par `getParents` coûtait un walk d'ancêtres
 * PAR FICHIER, si lent sur un gros Drive qu'un tick entier ne collectait qu'une poignée de fichiers en
 * affamant l'intake. Le garde §1 est intégralement assuré À LA MUTATION : `deplacerVersATrier_` fait la
 * re-vérif STRICTE `aParentProtege_` juste avant de déplacer (abstention si sous 04) — donc un fichier
 * protégé collecté ici n'est JAMAIS déplacé. (Le security-auditor a validé « collecte ouverte, mutation
 * fermée » comme le bon endroit pour le garde-fou.)
 * @param {Folder} dossier
 * @param {string[]} ids  accumulateur
 * @param {number} max
 * @param {function():boolean} estBudgetDepasse
 * @param {Object} proteges  ensemble {idDossierProtégé: true} (utilisé à la mutation, pas ici)
 */
function collecterAReclasser_(dossier, ids, max, estBudgetDepasse, proteges) {
  var fi = dossier.getFiles();
  while (fi.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    var f = fi.next();
    // Un fichier « bizarre » (métadonnée illisible) ne doit JAMAIS avorter toute la collecte :
    // on le saute, les autres continuent d'être collectés (cf. incident r2 : un seul échec figeait tout).
    try {
      if (estAReclasserLeger_(f)) ids.push(f.getId());
    } catch (e) {
      journalErreur_('Rangement', 'Fichier ignoré à la collecte (' + e + ')');
    }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    collecterAReclasser_(fo.next(), ids, max, estBudgetDepasse, proteges);
  }
}

/**
 * Déplace un fichier (par ID) vers `00·À trier` : ajoute le dossier cible puis retire les
 * parents actuels. JAMAIS de suppression — le fichier reste dans le Drive, à un seul endroit.
 *
 * Sécurité (défense en profondeur, garde-fou §1) : on REVÉRIFIE qu'aucun parent n'est en zone
 * protégée juste avant de muter ; si c'est le cas on s'abstient (ne rien ajouter/retirer) pour
 * ne jamais détacher un fichier de `04 · Immigration`.
 * @param {string} fileId
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {boolean} vrai si déplacé.
 */
function deplacerVersATrier_(fileId, proteges) {
  try {
    var f = DriveApp.getFileById(fileId);
    if (aParentProtege_(f, proteges, true)) { // STRICT : abstention si indéterminable (jamais détacher, §1)
      journalInfo_('Rangement', 'Fichier en zone protégée ignoré (non déplacé) : ' + fileId);
      return false;
    }
    var cibleId = CONFIG.DOSSIERS.A_TRIER;
    var cible = DriveApp.getFolderById(cibleId);
    cible.addFile(f); // ajoute la cible AVANT de retirer (jamais orphelin)
    var parents = f.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (p.getId() !== cibleId) p.removeFile(f); // retire l'ancien parent (pas une suppression)
    }
    return true;
  } catch (e) {
    journalErreur_('Rangement', 'Déplacement impossible (' + fileId + ') : ' + e);
    return false;
  }
}

/**
 * Ensemble des IDs de dossiers racines des domaines protégés (garde-fou §1).
 * @return {Object} { idDossier: true }
 */
function ensembleDomainesProteges_() {
  var set = {};
  CONFIG.DOMAINES_PROTEGES.forEach(function (dom) {
    var id = CONFIG.DOMAINES[dom];
    if (id) set[id] = true;
  });
  return set;
}

/**
 * Vrai si le fichier a au moins un parent qui EST, ou DESCEND de, un domaine protégé.
 * Remonte toute la chaîne d'ancêtres (multi-parents inclus), bornée en profondeur.
 * @param {File} f
 * @param {Object} proteges  ensemble {idDossierProtégé: true}
 * @return {boolean}
 */
function aParentProtege_(f, proteges, strict) {
  try {
    var parents = f.getParents();
    while (parents.hasNext()) {
      if (chaineMonteVersProtege_(parents.next(), proteges, 0, strict)) return true;
    }
  } catch (e) {
    // `getParents()` indisponible (ex. traversée de racine/Drive partagé). Deux régimes :
    //  - STRICT (re-vérif juste AVANT de muter, `deplacerVersATrier_`) → échoue-FERMÉ : on renvoie true
    //    (traité comme protégé → abstention), pour ne JAMAIS détacher un fichier de 04·Immigration (§1).
    //  - non strict (COLLECTE) → false : le fichier est collecté pour que la passe PROGRESSE (il sera de
    //    toute façon re-vérifié en mode strict avant tout déplacement). Détection POSITIVE seulement.
    journalErreur_('Rangement', 'Contrôle « parent protégé » impossible (' + e + ')' +
      (strict ? ' — abstention (prudence §1).' : ' — traité comme non protégé à la collecte.'));
    return strict ? true : false;
  }
  return false;
}

/**
 * Remonte récursivement les parents d'un dossier jusqu'à trouver une racine protégée
 * (ou épuisement). Bornée à 50 niveaux (sécurité anti-cycle/profondeur). Détection POSITIVE seulement :
 * une branche illisible (`getParents` en erreur) renvoie `strict` (true en re-vérif de mutation = prudence ;
 * false en collecte = laisse progresser), sans propager l'exception — un fichier n'est protégé que si on
 * TROUVE réellement une racine 04 (ou, en strict, si une branche est illisible).
 * @param {Folder} dossier
 * @param {Object} proteges
 * @param {number} profondeur
 * @param {boolean} [strict]  échoue-fermé sur erreur de lecture (pour la re-vérif avant mutation)
 * @return {boolean}
 */
function chaineMonteVersProtege_(dossier, proteges, profondeur, strict) {
  if (!dossier || profondeur > 50) return false;
  if (proteges[dossier.getId()]) return true;
  try {
    var ps = dossier.getParents();
    while (ps.hasNext()) {
      if (chaineMonteVersProtege_(ps.next(), proteges, profondeur + 1, strict)) return true;
    }
  } catch (e) {
    return strict ? true : false; // strict → branche illisible = prudence (protégé) ; sinon pas de preuve
  }
  return false;
}
