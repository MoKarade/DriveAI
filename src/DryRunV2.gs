/**
 * DryRunV2.gs — Chantier #26, C26-07 (ADR-0015) : PREUVE avant/après du pipeline v2 sur un
 * échantillon RÉEL, pour validation de Marc AVANT la campagne de masse C26-08 et avant l'allumage
 * de `CONFIG.ANALYSE_V2`.
 *
 * Principe : `CONFIG.DRYRUN_V2_ACTIF` est un interrupteur DÉDIÉ, totalement indépendant de
 * `CONFIG.ANALYSE_V2` — l'allumer n'affecte JAMAIS le flux vivant (le pipeline live reste sur
 * Haiku tant qu'`ANALYSE_V2` est éteint). Quand `DRYRUN_V2_ACTIF` est ON, ce module :
 *
 *  1. Sélectionne UNE FOIS un échantillon STRATIFIÉ (par domaine, plafonné) et le PERSISTE
 *     (Script Property `DriveAI_DRYRUNV2_ECHANTILLON_<tag>`) — jamais re-tiré au hasard à chaque
 *     tick, sinon l'avant/après présenté à Marc ne serait pas reproductible.
 *  2. Pour chaque document de l'échantillon (bornée par tick, reprenable) : OCR (même troncature
 *     que la v2, 12000 car., SANS activer `ANALYSE_V2`), `classifierDeuxPasses_` (Llm.gs, le vrai
 *     appel Sonnet ×2 payant — ce module PROUVE le pipeline MÉCANIQUE réel, pas une simulation),
 *     puis `planRoutageV2_` (Router.gs) pour l'« après » proposé.
 *  3. Écrit une ligne avant/après dans l'onglet Sheet dédié `DryRunV2` — métadonnées SEULES
 *     (jamais l'extrait OCR, invariant vie privée ADR-0007).
 *
 * GARANTIE ZÉRO-MUTATION (le cœur de ce module) : seul `planRoutageV2_` est appelé pour le routage
 * — jamais `deciderRoutageV2_` (qui CRÉE de vrais sous-dossiers via `sousDossier_`), jamais
 * `renommer_`/`deplacerEtRenommer_`/`creerRaccourci_`/`garantirNomUnique_`. Aucun fichier n'est
 * déplacé, renommé, ni aucun dossier créé. Verrouillé par `test/dryrun-v2.test.js` (tripwire statique).
 *
 * Idempotence/convergence : clé DÉDIÉE `dryrunv2|<tag>|fileId` dans l'Index partagé (même famille
 * additive que `migre|<tag>|fileId`, Migration.gs) — un document n'est jamais re-classé (re-facturé)
 * deux fois pour un même tag. Coût réel engagé quand ON (~0,03-0,04 $/doc, ADR-0015) : compté sous
 * le frein `CONFIG.LLM_BUDGET_CAMPAGNES` (comme toute campagne), jamais gratuit.
 */

/* ---------- Sélection de l'échantillon (une fois, persistée) ---------- */

/**
 * Répartit des candidats (par domaine) en un échantillon STRATIFIÉ, plafonné par domaine et au
 * total. Round-robin (1 candidat par domaine à tour de rôle) : un domaine à fort volume ne
 * monopolise jamais l'échantillon au détriment des petits domaines. Déterministe (ordre des clés
 * trié + ordre d'entrée des listes préservé). PURE.
 * @param {Object<string,string[]>} candidatsParDomaine  domaine → [fileId, ...]
 * @param {number} maxParDomaine
 * @param {number} tailleTotale
 * @return {{domaine:string, id:string}[]}
 */
function stratifierEchantillonDryRunV2_(candidatsParDomaine, maxParDomaine, tailleTotale) {
  var domaines = Object.keys(candidatsParDomaine || {}).sort();
  var index = {}, pris = {};
  domaines.forEach(function (d) { index[d] = 0; pris[d] = 0; });

  var resultat = [];
  var progresse = true;
  while (resultat.length < tailleTotale && progresse) {
    progresse = false;
    for (var i = 0; i < domaines.length && resultat.length < tailleTotale; i++) {
      var d = domaines[i];
      var liste = candidatsParDomaine[d] || [];
      if (pris[d] >= maxParDomaine || index[d] >= liste.length) continue;
      resultat.push({ domaine: d, id: liste[index[d]] });
      index[d]++; pris[d]++;
      progresse = true;
    }
  }
  return resultat;
}

/**
 * Liste des domaines à échantillonner : les 7 domaines FIXES (`CONFIG.DOMAINES`, y compris
 * `04 · Immigration` — le dry-run ne MUTE jamais, donc peut et DOIT échantillonner la zone
 * protégée pour prouver le routage identité dessus) + les domaines AUTO déjà créés
 * (`CONFIG.DOMAINES_AUTO`, ID lu en Property SEULEMENT — jamais créé ici, inventaire lecture
 * seule, même discipline que `Reorg.gs`).
 * @return {{domaine:string, dossierId:string}[]}
 */
function domainesAEchantillonner_() {
  var liste = [];
  Object.keys(CONFIG.DOMAINES).forEach(function (d) {
    liste.push({ domaine: d, dossierId: CONFIG.DOMAINES[d] });
  });
  (CONFIG.DOMAINES_AUTO || []).forEach(function (d) {
    var id = PropertiesService.getScriptProperties().getProperty('DriveAI_DOM_' + d);
    if (id) liste.push({ domaine: d, dossierId: id }); // absent → domaine pas encore né, sauté
  });
  return liste;
}

/**
 * Collecte récursive (lecture seule) des candidats d'UN domaine, jusqu'à `max`. Mirroring
 * `collecterAMigrer_` (Migration.gs) mais SANS filtre de convergence par tag (la sélection est
 * indépendante de la progression du traitement) — seuls les fichiers natifs Google (pas de blob
 * exploitable) sont écartés. Un dossier/fichier illisible est sauté, jamais fatal (cf. P1-17).
 * @param {Folder} dossier
 * @param {string[]} ids  accumulateur
 * @param {number} max
 * @param {function():boolean} estBudgetDepasse
 */
function collecterCandidatsDomaine_(dossier, ids, max, estBudgetDepasse) {
  var fi;
  try { fi = dossier.getFiles(); } catch (e) { return; }
  while (fi.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    try {
      var f = fi.next();
      var mime = f.getMimeType() || '';
      if (mime.indexOf('application/vnd.google-apps') !== 0) ids.push(f.getId());
    } catch (e) { /* fichier illisible : sauté, la collecte continue */ }
  }
  var fo;
  try { fo = dossier.getFolders(); } catch (e) { return; }
  while (fo.hasNext() && ids.length < max) {
    if (estBudgetDepasse()) return;
    try { collecterCandidatsDomaine_(fo.next(), ids, max, estBudgetDepasse); }
    catch (e) { /* sous-dossier illisible : sauté */ }
  }
}

/**
 * Collecte les candidats de TOUS les domaines à échantillonner, bornée. Coût borné à
 * `DRYRUN_V2_MAX_PAR_DOMAINE` × 3 par domaine (marge pour la stratification) — liste-only, aucun
 * OCR/LLM ici.
 * @param {function():boolean} estBudgetDepasse
 * @return {{candidats:Object<string,string[]>, complet:boolean}}
 */
function collecterCandidatsDryRunV2_(estBudgetDepasse) {
  var candidats = {};
  var complet = true;
  var domaines = domainesAEchantillonner_();
  var margeParDomaine = CONFIG.DRYRUN_V2_MAX_PAR_DOMAINE * 3;
  for (var i = 0; i < domaines.length; i++) {
    if (estBudgetDepasse()) { complet = false; break; }
    var ids = [];
    try {
      collecterCandidatsDomaine_(DriveApp.getFolderById(domaines[i].dossierId), ids, margeParDomaine, estBudgetDepasse);
    } catch (e) {
      journalErreur_('DryRunV2', 'Domaine inaccessible à la collecte (' + domaines[i].domaine + ') : ' + e);
    }
    candidats[domaines[i].domaine] = ids;
    // Re-vérifié APRÈS la collecte du domaine (pas seulement en tête de boucle) : le budget peut
    // basculer PENDANT `collecterCandidatsDomaine_` (elle s'arrête tôt, mais SANS remonter
    // l'information) — sans ce test, le dernier domaine collecté partiellement passerait pour
    // complet et casserait l'invariant « jamais persister un échantillon partiel » (revue code #26).
    if (estBudgetDepasse()) { complet = false; break; }
  }
  return { candidats: candidats, complet: complet };
}

/**
 * Encode l'échantillon en forme COMPACTE pour la persistance Property (limite ~9 Ko/valeur) : les
 * noms de domaine (répétés jusqu'à `DRYRUN_V2_TAILLE` fois, ~30 car. chacun) sont remplacés par un
 * index dans une table courte — un échantillon de 150 documents encodé NAÏVEMENT (domaine en clair
 * par item) dépasse la limite (mesuré, revue code #26) ; `setProperty` lèverait alors à chaque tick
 * sans jamais réussir à persister (la collecte, coûteuse en appels Drive, serait refaite en pure
 * perte). PURE.
 * @param {{domaine:string, id:string}[]} echantillon
 * @return {{domaines:string[], items:Array<[number,string]>}}
 */
function encoderEchantillonDryRunV2_(echantillon) {
  var domaines = [];
  var index = {};
  var items = echantillon.map(function (e) {
    if (!(e.domaine in index)) { index[e.domaine] = domaines.length; domaines.push(e.domaine); }
    return [index[e.domaine], e.id];
  });
  return { domaines: domaines, items: items };
}

/** Inverse de `encoderEchantillonDryRunV2_`. PURE. @param {Object} encode @return {{domaine:string, id:string}[]} */
function decoderEchantillonDryRunV2_(encode) {
  return (encode.items || []).map(function (it) { return { domaine: encode.domaines[it[0]], id: it[1] }; });
}

/**
 * Charge l'échantillon persisté (tag courant), ou le génère + le persiste au premier appel.
 * Ne persiste JAMAIS un échantillon partiel (collecte interrompue par le budget) — l'appelant
 * réessaiera au tick suivant (collecte liste-only, peu coûteuse à recommencer).
 * @param {function():boolean} estBudgetDepasse
 * @return {?{domaine:string, id:string}[]}  null si pas encore disponible (reprise au tick suivant)
 */
function chargerOuGenererEchantillonDryRunV2_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  var cle = 'DriveAI_DRYRUNV2_ECHANTILLON_' + CONFIG.DRYRUN_V2_TAG;
  var brut = props.getProperty(cle);
  if (brut) {
    try { return decoderEchantillonDryRunV2_(JSON.parse(brut)); } catch (e) { /* corrompu → régénère ci-dessous */ }
  }
  var r = collecterCandidatsDryRunV2_(estBudgetDepasse);
  if (!r.complet) return null; // interrompue : rien de persisté, reprise au prochain tick
  var echantillon = stratifierEchantillonDryRunV2_(r.candidats, CONFIG.DRYRUN_V2_MAX_PAR_DOMAINE, CONFIG.DRYRUN_V2_TAILLE);
  props.setProperty(cle, JSON.stringify(encoderEchantillonDryRunV2_(echantillon)));
  journalInfo_('DryRunV2', 'Échantillon généré (' + echantillon.length + ' documents, tag « ' + CONFIG.DRYRUN_V2_TAG + ' »).');
  return echantillon;
}

/* ---------- Formatage de la ligne avant/après (PUR) ---------- */

/**
 * Construit la ligne à écrire dans l'onglet `DryRunV2`, à partir du résultat de
 * `planRoutageV2_` (JAMAIS `deciderRoutageV2_` — voir garantie zéro-mutation en tête de fichier).
 * `classif`/`plan` null ⇒ échec de classification (compté, jamais un plantage). PURE.
 * @param {{id:string, nom:string, domaineActuel:string, cheminActuel:string}} avant
 * @param {?Object} classif  sortie de `classifierDeuxPasses_`, ou null si échec
 * @param {?{type:string, routage?:string, domaine?:string, sousDossier?:string, nom?:string}} plan  sortie de `planRoutageV2_`, ou null
 * @param {number} coutDoc  dollars mesurés pour ce document
 * @return {Array} ligne (12 colonnes, cf. `initialiserSheet_`)
 */
function ligneDryRunV2_(avant, classif, plan, coutDoc) {
  var typeV2 = 'échec classification';
  var domaineP = '', sousDossierP = '', nomP = '', failSafe = 'non';
  var confiance = classif && typeof classif.confiance === 'number' ? classif.confiance : '';

  if (plan) {
    if (plan.type === 'non-doc') {
      typeV2 = 'non-document (' + plan.routage + ')';
    } else if (plan.type === 'à vérifier') {
      typeV2 = 'à vérifier';
      failSafe = 'oui';
    } else {
      typeV2 = 'classé';
      domaineP = plan.domaine || '';
      sousDossierP = plan.sousDossier || '';
      nomP = plan.nom || '';
    }
  }

  return [
    new Date(), avant.id, avant.nom, avant.domaineActuel || '', avant.cheminActuel || '',
    typeV2, domaineP, sousDossierP, nomP, failSafe, confiance,
    Math.round(coutDoc * 10000) / 10000
  ];
}

/* ---------- Traitement d'un document (I/O, lecture + 1 écriture de rapport, ZÉRO mutation) ---------- */

/**
 * Chemin LISIBLE depuis le domaine jusqu'au fichier (premier parent à chaque niveau), pour que
 * Marc juge le VRAI avant/après sur les domaines à schéma d'entité (Logement/Véhicule/Compte
 * financier/Diplôme, `docs/TAXONOMY.md`) — un document y est 3-4 niveaux sous le domaine (ex.
 * « Véhicule/Véhicule — Honda Civic (…)/Entretien & réparations »), un seul niveau afficherait à
 * tort une structure plate (revue structure-keeper #26). Borné à 5 niveaux (même anti-boucle que
 * `chaineMonteVersProtege_`, Maintenance.gs) ; s'arrête AU dossier de domaine (exclu, jamais
 * répété — même règle que `nommerDocument_`, l'entité vit dans le CHEMIN pas dans le nom).
 * Lecture seule (`getParents`/`getName`), dégrade sur `domaineActuel` seul si illisible/absent —
 * ZÉRO mutation. @param {File} f @param {string} domaineActuel @return {string}
 */
function cheminActuelDryRunV2_(f, domaineActuel) {
  var segments = [];
  var courant = f;
  for (var i = 0; i < 5; i++) {
    var parents;
    try { parents = courant.getParents(); } catch (e) { break; }
    if (!parents.hasNext()) break;
    var parent = parents.next();
    var nom;
    try { nom = parent.getName(); } catch (e) { break; }
    if (nom === domaineActuel) break; // dossier de domaine atteint : jamais répété dans le chemin
    segments.unshift(nom);
    courant = parent;
  }
  return domaineActuel + (segments.length ? '/' + segments.join('/') : '');
}

/**
 * Analyse UN document de l'échantillon : OCR (troncature v2 explicite, SANS activer
 * `ANALYSE_V2`), `classifierDeuxPasses_`, `planRoutageV2_` (PUR). Écrit la ligne avant/après et
 * marque la clé de convergence. Ne touche JAMAIS Drive en écriture (lecture de blob/parents
 * seule) — voir garantie zéro-mutation en tête de fichier.
 * @param {string} fileId
 * @param {string} domaineActuel  domaine d'où le document a été échantillonné (connu de la collecte)
 * @param {string} tag
 * @return {boolean} vrai si une ligne a été écrite (succès ou échec compté — jamais un no-op silencieux)
 */
function traiterUnDryRunV2_(fileId, domaineActuel, tag) {
  var cle = 'dryrunv2|' + tag + '|' + fileId;
  var f, nom, cheminActuel;
  try {
    f = DriveApp.getFileById(fileId);
    nom = f.getName();
    cheminActuel = cheminActuelDryRunV2_(f, domaineActuel);
  } catch (e) {
    indexAjouter_(cle, { statut: 'dry-run illisible', nom: fileId, domaine: '', chemin: '' }, '');
    journalErreur_('DryRunV2', 'Fichier illisible ignoré (' + fileId + ') : ' + e);
    // Une ligne quand même (jamais un no-op silencieux, cf. @return ci-dessus) : un fichier
    // disparu/permission retirée entre la collecte et le traitement ne doit pas s'effacer du
    // rapport que Marc lit pour valider C26-08 — seul l'Index technique en garderait trace sinon.
    feuille_('DryRunV2').appendRow(ligneDryRunV2_({ id: fileId, nom: fileId, domaineActuel: domaineActuel, cheminActuel: domaineActuel }, null, null, 0));
    return true;
  }

  var blob;
  try { blob = f.getBlob(); }
  catch (e) {
    indexAjouter_(cle, { statut: 'dry-run illisible', nom: nom, domaine: '', chemin: '' }, '');
    journalErreur_('DryRunV2', 'Blob illisible ignoré (' + nom + ') : ' + e);
    feuille_('DryRunV2').appendRow(ligneDryRunV2_({ id: fileId, nom: nom, domaineActuel: domaineActuel, cheminActuel: cheminActuel }, null, null, 0));
    return true;
  }

  var extrait = f.getSize() > CONFIG.OCR_TAILLE_MAX ? '' : extraireTexte_(blob, CONFIG.ANALYSE_V2_OCR_MAX_CARS);
  var meta = { nomFichier: nom, expediteur: '', sujet: 'Dry-run C26-07 (preuve avant/après, aucune mutation)', extrait: extrait || '' };

  var avantCout = usageRunSnapshot_();
  var classif = classifierDeuxPasses_(meta);
  var coutDoc = coutDollarsDelta_(avantCout, usageRunSnapshot_());

  var plan = null;
  if (classif) {
    var dateStr = dateNormalisee_(classif.date_doc, f.getLastUpdated());
    plan = planRoutageV2_(classif, {
      nomFichier: nom, taille: f.getSize(), extraitOcr: extrait || '', emetteur: classif.emetteur
    }, dateStr, extension_(nom));
  }

  feuille_('DryRunV2').appendRow(ligneDryRunV2_(
    { id: fileId, nom: nom, domaineActuel: domaineActuel, cheminActuel: cheminActuel }, classif, plan, coutDoc
  ));
  indexAjouter_(cle, { statut: 'dry-run', nom: nom, domaine: '', chemin: '' }, '');
  return true;
}

/* ---------- Étape de tick (gatée, bornée, reprenable) ---------- */

/**
 * Étape de tick du dry-run C26-07. Appelée APRÈS l'intake (SECONDAIRE, le flux vivant garde la
 * priorité), gatée par `CONFIG.DRYRUN_V2_ACTIF` (interrupteur DÉDIÉ — n'affecte jamais
 * `CONFIG.ANALYSE_V2`) et le frein budget campagnes (`budgetCampagnesAtteint_`, appelé par
 * l'appelant comme pour Migration). Sous-budget PROPRE (`DRYRUN_V2_BUDGET_MS`) : sans lui, un
 * tick de dry-run consommerait tout le quota journalier de triggers au détriment de l'intake.
 * @param {function():boolean} estBudgetDepasse
 */
function appliquerDryRunV2_(estBudgetDepasse) {
  if (!CONFIG.DRYRUN_V2_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.DRYRUN_V2_TAG;
  if (props.getProperty('DriveAI_DRYRUNV2') === tag) return; // campagne déjà terminée
  if (estBudgetDepasse()) return;

  // Sélection de l'échantillon : liste-only (aucun OCR/LLM), donc bornée par le SEUL budget
  // GLOBAL du tick — PAS le sous-budget DRYRUN_V2_BUDGET_MS ci-dessous (dimensionné pour les
  // appels Sonnet coûteux du traitement). Un sous-budget de 2 min appliqué aussi à la collecte
  // risquerait de ne jamais réussir à compléter un walk sur les 9 domaines d'un vrai Drive
  // volumineux → l'échantillon ne se persisterait jamais (revue apps-script-quota #26).
  var echantillon = chargerOuGenererEchantillonDryRunV2_(estBudgetDepasse);
  if (!echantillon) return; // collecte de l'échantillon pas encore complète — reprise au tick suivant

  var debut = Date.now();
  var garde = function () {
    return estBudgetDepasse() || (Date.now() - debut) > CONFIG.DRYRUN_V2_BUDGET_MS;
  };

  var nonFait = function (item) { return !indexContient_('dryrunv2|' + tag + '|' + item.id); };
  var aTraiter = echantillon.filter(nonFait);

  var n = 0;
  for (var i = 0; i < aTraiter.length && n < CONFIG.DRYRUN_V2_MAX_PAR_RUN; i++) {
    if (garde()) break;
    try { if (traiterUnDryRunV2_(aTraiter[i].id, aTraiter[i].domaine, tag)) n++; }
    catch (e) { journalErreur_('DryRunV2', 'Item sauté (' + aTraiter[i].id + ') : ' + e); }
  }
  if (n) journalInfo_('DryRunV2', n + ' document(s) analysé(s) (dry-run, aucune mutation Drive).');

  // Re-vérifié APRÈS traitement (pas seulement en tête de tick) : converge dans le MÊME tick qui
  // finit le dernier document, jamais un tick de plus juste pour constater que c'est fini.
  if (echantillon.filter(nonFait).length === 0) {
    props.setProperty('DriveAI_DRYRUNV2', tag);
    journalInfo_('DryRunV2', 'Dry-run v2 terminé (tag « ' + tag + ' », ' + echantillon.length +
      ' documents) — voir l\'onglet DryRunV2 pour validation avant la campagne C26-08.');
  }
}
