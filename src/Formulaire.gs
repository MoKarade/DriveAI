/**
 * Formulaire.gs — Canal de correction (ADR-0003 §1-2, chantier #6).
 *
 * Marc corrige un classement via un mini-formulaire Google (1 formulaire permanent, find-or-create).
 * À chaque tick, DriveAI lit les NOUVELLES réponses et les enregistre comme corrections
 * (`enregistrerCorrection_`) — qui alimentent la boucle few-shot du chantier #5. Les futurs documents
 * du même émetteur sont alors classés selon la correction de Marc.
 *
 * Frontière d'exécution : la session Claude ne peut ni créer le formulaire ni le déployer chez Marc —
 * `assurerFormulaireCorrection_` s'exécute côté Apps Script (compte de Marc) et exige la NOUVELLE
 * autorisation Google (scope `forms`) accordée une fois au prochain déploiement.
 *
 * Idempotence : on retient l'horodatage de la dernière réponse traitée (Script Property) — une réponse
 * déjà appliquée ne l'est jamais deux fois. Bornée par run (`CORRECTIONS_MAX_PAR_RUN`) + garde-temps.
 *
 * Une correction qui nomme une entité + son domaine la **promeut « validée »** dans le référentiel
 * (`promouvoirEntiteValidee_`, C6-04) → son dossier est matérialisé au tick suivant et le routage
 * l'utilise. NB (à suivre) : appliquer la correction au FICHIER déjà classé (le déplacer/renommer)
 * reste différé — le nommer via un champ texte libre est fragile ; le few-shot corrige déjà le futur.
 */

// Titres EXACTS des questions du formulaire (servent de clés au parsing des réponses — ne pas diverger).
var FORM_TITRE = 'DriveAI — Corriger un classement';
var FORM_Q_EMETTEUR = 'Émetteur (ex. EDF, Desjardins, IUT du Littoral)';
var FORM_Q_DOMAINE = 'Bon domaine';
var FORM_Q_ENTITE = 'Bonne entité (optionnel)';
var FORM_Q_FICHIER = 'Fichier concerné — nom ou lien (optionnel)';

var PROP_FORM_ID = 'DriveAI_FORM_CORR_ID';
var PROP_FORM_DERNIER = 'DriveAI_FORM_CORR_DERNIER'; // horodatage (ms) de la dernière réponse traitée

/* ---------- Logique PURE (testée) ---------- */

/** Libellés de domaines proposés dans le formulaire = source de vérité unique `domainesAutorises_()`
 *  (domaines fixes + auto-créés `CONFIG.DOMAINES_AUTO`) — pas de liste dupliquée qui dériverait. */
function domainesPourFormulaire_() {
  return domainesAutorises_();
}

/**
 * Convertit une réponse de formulaire (dict {titreQuestion: réponse}) en correction.
 * L'émetteur est OBLIGATOIRE (c'est la clé de sélection few-shot) — sans lui, la réponse est ignorée.
 * @param {Object} champs
 * @return {?{emetteur:string, domaine:string, entite:string, fichier:string}}
 */
function reponseVersCorrection_(champs) {
  if (!champs) return null;
  var emetteur = String(champs[FORM_Q_EMETTEUR] == null ? '' : champs[FORM_Q_EMETTEUR]).trim();
  if (!emetteur) return null;
  return {
    emetteur: emetteur,
    domaine: String(champs[FORM_Q_DOMAINE] == null ? '' : champs[FORM_Q_DOMAINE]).trim(),
    entite: String(champs[FORM_Q_ENTITE] == null ? '' : champs[FORM_Q_ENTITE]).trim(),
    fichier: String(champs[FORM_Q_FICHIER] == null ? '' : champs[FORM_Q_FICHIER]).trim()
  };
}

/* ---------- Effectful : création du formulaire + lecture des réponses (côté Apps Script) ---------- */

/** URL publique du formulaire de correction (vide si pas encore créé). Pour le résumé hebdo. */
function urlFormulaireCorrection_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_FORM_ID);
  if (!id) return '';
  try { return FormApp.openById(id).getPublishedUrl(); } catch (e) { return ''; }
}

/** Find-or-create le formulaire de correction ; renvoie l'objet Form (ID mémorisé en Script Property). */
function assurerFormulaireCorrection_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_FORM_ID);
  // Si un ID est connu, on ouvre SANS filet : une erreur (panne transitoire OU formulaire supprimé) se
  // propage → attrapée par le try/catch du tick, journalisée, retentée au tick suivant (auto-guérit le
  // transitoire). On NE recrée PAS sur exception : sinon une panne momentanée fabriquerait un formulaire
  // orphelin, l'URL de Marc pointerait vers un mort et ses réponses seraient perdues en silence.
  if (id) return FormApp.openById(id);
  var form = FormApp.create(FORM_TITRE);
  form.setDescription('Apprends à DriveAI où ranger les documents d\'un émetteur. Les prochains documents '
    + 'du même émetteur seront classés en conséquence. Un seul champ obligatoire : l\'émetteur.');
  form.addTextItem().setTitle(FORM_Q_EMETTEUR).setRequired(true);
  form.addListItem().setTitle(FORM_Q_DOMAINE).setChoiceValues(domainesPourFormulaire_());
  form.addTextItem().setTitle(FORM_Q_ENTITE);
  form.addTextItem().setTitle(FORM_Q_FICHIER);
  props.setProperty(PROP_FORM_ID, form.getId());
  journalInfo_('Corrections', 'Formulaire de correction créé : ' + form.getPublishedUrl());
  return form;
}

/**
 * Lit les NOUVELLES réponses du formulaire et les enregistre comme corrections (⇒ few-shot).
 * Idempotent (horodatage de la dernière réponse traitée), borné (`CORRECTIONS_MAX_PAR_RUN` + garde-temps).
 * SECONDAIRE : l'appelant l'enveloppe d'un try/catch — un échec ne doit jamais bloquer l'intake.
 * @param {function():boolean} [estBudgetDepasse]
 */
function lireEtAppliquerCorrections_(estBudgetDepasse) {
  var props = PropertiesService.getScriptProperties();
  var form = assurerFormulaireCorrection_();
  var dernier = Number(props.getProperty(PROP_FORM_DERNIER) || 0);
  // Lecture BORNÉE : ne récupère que les réponses postérieures au curseur (pas tout l'historique à
  // chaque tick) — aligné sur la discipline « lecture bornée » du projet. Le `ts <= dernier` plus bas
  // reste comme garde défensif d'égalité de borne. `new Date(0)` au 1er run = toutes les réponses.
  var reponses = form.getResponses(new Date(dernier)); // ordre chronologique croissant
  var traiteJusqua = dernier, applique = 0;

  for (var i = 0; i < reponses.length; i++) {
    if (applique >= CONFIG.CORRECTIONS_MAX_PAR_RUN || (estBudgetDepasse && estBudgetDepasse())) break;
    var r = reponses[i];
    var ts = r.getTimestamp().getTime();
    if (ts <= dernier) continue; // déjà traitée à un run précédent

    var champs = {};
    r.getItemResponses().forEach(function (ir) { champs[ir.getItem().getTitle()] = ir.getResponse(); });
    var corr = reponseVersCorrection_(champs);
    if (corr) {
      if (enregistrerCorrection_(corr)) applique++;   // ⇒ few-shot (chantier #5)
      promouvoirEntiteValidee_(corr);                 // ⇒ entité validée (C6-04, idempotent : no-op si déjà validée)
    }
    traiteJusqua = ts; // avance le curseur au fil des réponses RÉELLEMENT parcourues (chronologique)
  }

  if (traiteJusqua > dernier) props.setProperty(PROP_FORM_DERNIER, String(traiteJusqua));
  if (applique) journalInfo_('Corrections', applique + ' correction(s) enregistrée(s) depuis le formulaire.');
}
