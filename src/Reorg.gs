/**
 * Reorg.gs — réorg IA du Drive (chantier #21, C21-04) : phase PROPOSITION seulement.
 *
 * L'app dépose une demande dans l'onglet `Réorg` (ligne Type `demande`, Statut `analyse
 * demandée`, Détail = portée : 'tout' ou un ID de dossier). Au tick (étape SECONDAIRE,
 * enveloppée, budget-gatée, en dernier), le moteur :
 *  1. inventorie l'arborescence des DOSSIERS (métadonnées seules : chemins, comptes, quelques
 *     noms de fichiers en exemple — jamais un contenu, ADR-0007). Zone protégée exclue par
 *     REMONTÉE DE LA CHAÎNE D'ANCÊTRES dès la collecte (multi-parents inclus, échec fermé —
 *     CLAUDE.md §2.1b) ; racines système (`_…`, 00 · À trier, 00 · À vérifier) exclues aussi ;
 *  2. demande UN plan à Haiku (JSON strict) — les dossiers y sont référencés par NUMÉRO
 *     (#1..#N), jamais par ID : un index inventé rejette l'action, un ID halluciné serait
 *     dangereux ;
 *  3. écrit les lignes `proposé` (une par action) en UN append, puis passe la demande à `proposé`.
 *
 * AUCUNE mutation Drive ici (l'inventaire est lecture seule — les domaines AUTO absents sont
 * sautés, jamais créés). L'application (déplacements seuls, re-vérif zone protégée par mutation,
 * re-pointage de `Entités.Dossier ID` lors d'une fusion de dossier d'entité) arrive en C21-06
 * après validation de Marc dans l'app (C21-05). La corbeille des dossiers vides validée =
 * C21-07 (ADR-0014). Aucune ligne de l'onglet n'est jamais supprimée.
 *
 * Reprise/idempotence : si les lignes `reorg|<tag>|…` existent déjà (coupure entre l'append et
 * le statut), le tick suivant pose seulement le statut — jamais un second inventaire/LLM.
 * Convergence : les essais (3 max) ne comptent que les VRAIS échecs (LLM muet/illisible) —
 * interruption budget et panne de compte RENDENT l'essai ; portée trop large ou protégée =
 * `échec` immédiat (déterministe, retenter ne changerait rien).
 */

/** Statuts d'une ligne d'action (machine à états — cf. BACKLOG #21). */
var REORG_STATUTS = ['proposé', 'validé', 'écarté', 'appliqué', 'refusé (zone protégée)', 'vide-candidat', 'corbeillé'];

/**
 * Étape de tick : traite (au plus) UNE demande d'analyse. Coût quand il n'y a rien à faire :
 * une lecture de l'onglet `Réorg`.
 * @param {function(): boolean} estBudgetDepasse
 */
function appliquerReorgIA_(estBudgetDepasse) {
  var f = feuille_('Réorg');
  var lignes = f.getDataRange().getValues(); // en-têtes incluses — onglet petit (demandes + actions)
  var demande = null;
  for (var i = lignes.length - 1; i >= 1; i--) {
    if (String(lignes[i][1]) === 'demande' && String(lignes[i][5]) === 'analyse demandée') {
      demande = { rang: i + 1, cle: String(lignes[i][0]), portee: String(lignes[i][6] || 'tout') };
      break; // la plus récente seulement — une analyse à la fois
    }
  }
  if (!demande) return;
  if (estPannePlateforme_()) return; // panne de compte : on retente plus tard, sans compter un essai

  var tag = 'reorg|' + demande.cle;
  // Reprise après coupure : les actions de CE tag existent déjà → poser le statut et finir.
  for (var j = 1; j < lignes.length; j++) {
    if (String(lignes[j][0]).indexOf(tag + '|') === 0) {
      f.getRange(demande.rang, 6).setValue('proposé');
      journalInfo_('Reorg', 'Proposition déjà écrite (reprise) — demande soldée.');
      return;
    }
  }

  // Essais bornés (anti-boucle sur exception répétable : pré-incrémenté, RENDU sur issue bénigne).
  var props = PropertiesService.getScriptProperties();
  var prefixe = demande.cle + '|';
  var brutEssais = String(props.getProperty('DriveAI_REORG_ESSAIS') || '');
  var essais = brutEssais.indexOf(prefixe) === 0 ? Number(brutEssais.slice(prefixe.length)) || 0 : 0;
  if (essais >= CONFIG.REORG_ESSAIS_MAX) {
    solderDemande_(f, demande.rang, 'échec', 'analyse impossible après ' + essais + ' tentatives — voir Journal');
    journalErreur_('Reorg', 'Demande abandonnée après ' + essais + ' tentatives.');
    return;
  }
  props.setProperty('DriveAI_REORG_ESSAIS', prefixe + (essais + 1));
  var rendreEssai = function () { props.setProperty('DriveAI_REORG_ESSAIS', prefixe + essais); };

  var resultat = inventaireDossiers_(demande.portee, estBudgetDepasse);
  if (resultat.raison === 'interrompu') {
    rendreEssai(); // le tick était chargé — pas un échec d'analyse
    return;
  }
  if (resultat.raison === 'protege') {
    solderDemande_(f, demande.rang, 'échec', 'portée refusée : zone protégée (04 · Immigration)');
    return;
  }
  if (resultat.raison === 'trop-large') {
    // Déterministe : retenter referait le même abandon — échec immédiat, conseil actionnable.
    solderDemande_(f, demande.rang, 'échec', 'portée trop large (> ' + CONFIG.REORG_DOSSIERS_MAX + ' dossiers) — choisis un dossier');
    return;
  }
  var inventaire = resultat.dossiers;
  if (inventaire.length === 0) {
    solderDemande_(f, demande.rang, 'échec', 'aucun dossier analysable dans cette portée');
    return;
  }

  // Plafond QUOTIDIEN d'appels LLM de réorg (défense en profondeur : une app boguée qui
  // re-poserait des demandes en boucle est bornée à ~0,1 $/jour). La demande reste posée.
  var jour = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var brutJour = String(props.getProperty('DriveAI_REORG_JOUR') || '');
  var appelsJour = brutJour.indexOf(jour + '|') === 0 ? Number(brutJour.split('|')[1]) || 0 : 0;
  if (appelsJour >= CONFIG.REORG_MAX_JOUR) {
    rendreEssai();
    return;
  }
  props.setProperty('DriveAI_REORG_JOUR', jour + '|' + (appelsJour + 1));

  var texte = appelAnthropicTexte_(
    CONFIG.LLM_MODELE,
    promptReorg_(),
    resumeArborescence_(inventaire),
    CONFIG.LLM_MAX_TOKENS_REORG
  );
  if (texte === null && estPannePlateforme_()) {
    rendreEssai(); // panne de COMPTE détectée par cet appel — jamais imputée à la demande (leçon R1)
    return;
  }
  var proposition = parserPropositionReorg_(texte, inventaire);
  if (!proposition) {
    journalErreur_('Reorg', 'Plan LLM illisible ou vide (tentative ' + (essais + 1) + '/' + CONFIG.REORG_ESSAIS_MAX + ').');
    return;
  }

  // UN append pour toutes les actions (reprenable), PUIS le statut de la demande.
  var maintenant = new Date().toISOString();
  if (proposition.actions.length > 0) {
    var rows = proposition.actions.map(function (a, n) {
      return lignePourAction_(tag, n + 1, a, inventaire, maintenant);
    });
    f.getRange(f.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  }
  solderDemande_(f, demande.rang, 'proposé', proposition.synthese || '');
  try { props.deleteProperty('DriveAI_REORG_ESSAIS'); } catch (e) { /* résidu inoffensif */ }
  journalInfo_('Reorg', 'Proposition écrite : ' + proposition.actions.length + ' action(s) — à valider dans l’app.');
}

/** Pose statut (col 6) + détail (col 7) d'une ligne de demande. */
function solderDemande_(f, rang, statut, detail) {
  f.getRange(rang, 6).setValue(statut);
  f.getRange(rang, 7).setValue(detail);
}

/**
 * Inventaire BORNÉ des dossiers (BFS, dédoublonné par ID — les multi-parents existent sur ce
 * Drive) : {dossiers: [{id, chemin, nbFichiers, exemples[]}]} ou {raison: 'interrompu' (budget)
 * | 'trop-large' (cap) | 'protege' (portée en zone protégée)}.
 *
 * Zone protégée : EXCLUE PAR ASCENDANCE dès la collecte — pour chaque dossier, tout parent
 * AUTRE que celui par lequel le BFS est arrivé est remonté (`chaineMonteVersProtege_` strict) ;
 * une branche illisible = protégé (échec fermé : ces métadonnées PARTENT vers le LLM).
 * Lecture seule : les domaines AUTO absents (Script Property) sont sautés, jamais créés.
 * @param {string} portee  'tout' ou un ID de dossier
 * @param {function(): boolean} estBudgetDepasse
 * @return {{dossiers: Array}|{raison: string}}
 */
function inventaireDossiers_(portee, estBudgetDepasse) {
  var proteges = ensembleDomainesProteges_();
  var front = []; // {dossier: Folder, id, chemin (du parent, null pour racine), parentId}

  if (portee === 'tout') {
    Object.keys(CONFIG.DOMAINES).forEach(function (dom) {
      var id = CONFIG.DOMAINES[dom];
      if (proteges[id]) return;
      try { front.push({ dossier: DriveApp.getFolderById(id), id: id, chemin: null, parentId: null }); }
      catch (e) { /* domaine disparu : ignoré */ }
    });
    (CONFIG.DOMAINES_AUTO || []).forEach(function (dom) {
      var id = PropertiesService.getScriptProperties().getProperty('DriveAI_DOM_' + dom);
      if (!id || proteges[id]) return; // absent → sauté (JAMAIS créé ici : inventaire lecture seule)
      try { front.push({ dossier: DriveApp.getFolderById(id), id: id, chemin: null, parentId: null }); }
      catch (e) { /* dossier disparu : ignoré */ }
    });
  } else {
    if (proteges[portee]) return { raison: 'protege' };
    var racinePortee;
    try {
      racinePortee = DriveApp.getFolderById(portee);
      // La portée vient de la Sheet (donnée UTILISATEUR via l'app) : le moteur re-vérifie
      // lui-même l'ascendance — un descendant d'Immigration est refusé, échec fermé.
      var parentsPortee = racinePortee.getParents();
      while (parentsPortee.hasNext()) {
        if (chaineMonteVersProtege_(parentsPortee.next(), proteges, 0, true)) return { raison: 'protege' };
      }
    } catch (e) {
      return { raison: 'protege' }; // illisible = protégé (prudence — la donnée sort vers le LLM)
    }
    front.push({ dossier: racinePortee, id: portee, chemin: null, parentId: null });
  }

  var dossiers = [];
  var vus = {};
  while (front.length > 0) {
    if (estBudgetDepasse()) return { raison: 'interrompu' };
    if (dossiers.length >= CONFIG.REORG_DOSSIERS_MAX) return { raison: 'trop-large' };
    var courant = front.shift();
    if (vus[courant.id]) continue; // multi-parents : un dossier = UNE entrée d'inventaire
    vus[courant.id] = true;

    var dossier = courant.dossier;
    var nom;
    try {
      nom = dossier.getName();
    } catch (e) {
      continue; // disparu entre-temps (Drive vivant) — toléré
    }
    if (nom.charAt(0) === '_' || proteges[courant.id] ||
        courant.id === CONFIG.DOSSIERS.A_TRIER || courant.id === CONFIG.DOSSIERS.A_VERIFIER) {
      continue; // racines système, files d'arrivée/de revue, zone protégée
    }
    // Garde multi-parents (§2.1b, à la COLLECTE) : tout parent AUTRE que la branche d'arrivée
    // est remonté ; s'il touche la zone protégée (ou est illisible), le dossier est écarté.
    if (courant.parentId !== null && aParentEtrangerProtege_(dossier, courant.parentId, proteges)) {
      continue;
    }
    var chemin = courant.chemin === null ? nom : courant.chemin + '/' + nom;

    var nbFichiers = 0;
    var exemples = [];
    try {
      var it = dossier.getFiles();
      while (it.hasNext()) {
        var fichier = it.next();
        nbFichiers++;
        if (exemples.length < CONFIG.REORG_EXEMPLES_PAR_DOSSIER) exemples.push(fichier.getName());
        if (nbFichiers >= 999) break; // le compte exact au-delà n'apporte rien au plan
      }
      var sous = dossier.getFolders();
      while (sous.hasNext()) {
        var s = sous.next();
        front.push({ dossier: s, id: s.getId(), chemin: chemin, parentId: courant.id });
      }
    } catch (e) {
      continue; // contenu illisible : dossier écarté de l'inventaire (jamais un plan sur du flou)
    }
    dossiers.push({ id: courant.id, chemin: chemin, nbFichiers: nbFichiers, exemples: exemples });
  }
  return { dossiers: dossiers };
}

/**
 * Vrai si `dossier` a un parent AUTRE que `parentConnu` dont la chaîne touche la zone protégée,
 * OU si ses parents sont illisibles (échec fermé — ces métadonnées partent vers le LLM).
 */
function aParentEtrangerProtege_(dossier, parentConnu, proteges) {
  try {
    var parents = dossier.getParents();
    while (parents.hasNext()) {
      var p = parents.next();
      if (p.getId() === parentConnu) continue; // la branche saine par laquelle le BFS est arrivé
      if (proteges[p.getId()] || chaineMonteVersProtege_(p, proteges, 0, true)) return true;
    }
    return false;
  } catch (e) {
    return true; // illisible = protégé (prudence)
  }
}

/** Résumé texte de l'inventaire pour le prompt : « #n | chemin (x fichiers ; ex. a, b) ». PURE (testée). */
function resumeArborescence_(inventaire) {
  return inventaire.map(function (d, i) {
    var noms = (d.exemples || []).map(function (n) { return String(n).slice(0, 60); });
    var exemples = noms.length ? ' ; ex. ' + noms.join(', ') : '';
    return '#' + (i + 1) + ' | ' + d.chemin + ' (' + d.nbFichiers + ' fichiers' + exemples + ')';
  }).join('\n');
}

/** Prompt système du plan de réorg : JSON strict COMPACT, actions bornées, dossiers par NUMÉRO. */
function promptReorg_() {
  return 'Tu es l\'architecte de l\'arborescence Google Drive personnelle de Marc. On te donne ' +
    'la liste des dossiers (#n | chemin (x fichiers ; exemples)). Propose une RÉORGANISATION des ' +
    'DOSSIERS seulement (les fichiers sont classés par un autre système).\n' +
    'Réponds en JSON COMPACT sur UNE seule ligne, sans indentation, aucun texte hors du JSON :\n' +
    '{"actions": [{"type": "deplacer"|"fusionner"|"creer"|"renommer", "dossier": n, "vers": n, ' +
    '"parent": n, "nom": "…", "raison": "…"}], "synthese": "…"}\n' +
    '- "dossier", "vers", "parent" : des NOMBRES JSON (3 — jamais "3" ni "#3").\n' +
    '- "deplacer" : dossier #n déplacé SOUS le dossier #vers.\n' +
    '- "fusionner" : le CONTENU du dossier #n rejoint #vers (le dossier #n devient vide).\n' +
    '- "creer" : nouveau dossier "nom" DANS le dossier #parent. Un dossier créé n\'a PAS de ' +
    'numéro : ne déplace/fusionne JAMAIS vers un dossier que tu viens de créer.\n' +
    '- "renommer" : dossier #n renommé "nom" (jamais de « / » dans un nom).\n' +
    '- "raison" : une phrase COURTE (≤ 12 mots). "synthese" : 1 à 2 phrases.\n' +
    'RÈGLES STRUCTURELLES (non négociables) :\n' +
    '- Les racines de domaine « NN · … » sont INTOUCHABLES (ni deplacer, ni fusionner, ni renommer).\n' +
    '- Les sous-dossiers d\'année « AAAA » sont STRUCTURELS : jamais fusionnés entre eux, jamais renommés.\n' +
    '- Les sous-dossiers de schéma (Bail & contrat, Factures, Assurance, Relevés, Correspondance, ' +
    'Entretien & réparations, …) gardent leur NOM exact — le classement route par nom.\n' +
    '- Ne fusionne JAMAIS un dossier d\'entité (nom propre) dans la racine de son domaine.\n' +
    '- "creer" sert aux dossiers STRUCTURELS (sous-dossier de schéma, année) — jamais à inventer ' +
    'une nouvelle entité.\n' +
    'Au plus 40 actions, ordonnées de la plus importante à la moins importante ; peu d\'actions à ' +
    'fort impact (doublons de dossiers, noms incohérents). Si l\'arborescence est déjà saine : ' +
    '{"actions": [], "synthese": "Rien à changer."}. Ne référence les dossiers QUE par leur numéro.\n' +
    'Exemple — entrée :\n' +
    '#1 | 03 · Logement & véhicule (2 fichiers)\n' +
    '#2 | 03 · Logement & véhicule/Assurance habitation (5 fichiers)\n' +
    '#3 | 08 · Perso & projets/assurance maison (4 fichiers ; ex. attestation.pdf)\n' +
    'Sortie :\n' +
    '{"actions":[{"type":"fusionner","dossier":3,"vers":2,"raison":"Doublon d\'assurance habitation"}],' +
    '"synthese":"Regroupe les deux dossiers d\'assurance habitation."}';
}

/**
 * Parse et WHITELISTE le plan de réorg (sortie LLM = donnée non fiable). PURE (testée).
 * Rejets par ACTION (jamais tout le plan pour une action invalide) : index hors 1..N (les
 * chaînes « 3 »/« #3 » sont tolérées), auto-référence (même index OU même id — multi-parents),
 * RACINE mutée (deplacer/fusionner/renommer d'un chemin sans « / » : domaines intouchables),
 * cible/parent DESCENDANT du dossier muté (cycle), nom vide ou contenant « / ».
 * Plan sans action valide alors qu'il en proposait → null ; plan explicitement vide → honnête.
 * @param {?string} texte
 * @param {Array} inventaire  [{id, chemin, …}] — les indices du plan pointent dedans
 * @return {?{actions: Array, synthese: string}}
 */
function parserPropositionReorg_(texte, inventaire) {
  if (!texte) return null;
  var brut = null;
  try {
    brut = JSON.parse(texte);
  } catch (e) {
    var m = String(texte).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { brut = JSON.parse(m[0]); } catch (e2) { return null; }
  }
  if (!brut || typeof brut !== 'object' || !Array.isArray(brut.actions)) return null;

  var nb = inventaire.length;
  var index = function (v) {
    if (typeof v === 'string' && /^#?\d+$/.test(v)) v = Number(v.replace('#', ''));
    return (typeof v === 'number' && v >= 1 && v <= nb && v % 1 === 0) ? v : null;
  };
  var estRacine = function (n) { return inventaire[n - 1].chemin.indexOf('/') === -1; };
  var descendDe = function (n, deN) {
    return inventaire[n - 1].chemin.indexOf(inventaire[deN - 1].chemin + '/') === 0;
  };
  var actions = [];
  for (var i = 0; i < brut.actions.length && actions.length < CONFIG.REORG_ACTIONS_MAX; i++) {
    var a = brut.actions[i];
    if (!a || typeof a !== 'object') continue;
    var nom = typeof a.nom === 'string' ? a.nom.trim().slice(0, 80) : '';
    if (nom.indexOf('/') !== -1) continue; // « / » corromprait chemins et contrat de lecture
    var raison = typeof a.raison === 'string' ? a.raison.trim().slice(0, 150) : '';
    if (a.type === 'deplacer' || a.type === 'fusionner') {
      var dossier = index(a.dossier);
      var vers = index(a.vers);
      if (dossier === null || vers === null || dossier === vers) continue;
      if (inventaire[dossier - 1].id === inventaire[vers - 1].id) continue; // même dossier, 2 chemins
      if (estRacine(dossier)) continue; // un domaine racine ne se déplace/fusionne jamais
      if (descendDe(vers, dossier)) continue; // cycle : cible à l'intérieur du dossier muté
      actions.push({ type: a.type, dossier: dossier, vers: vers, raison: raison });
    } else if (a.type === 'creer') {
      var parent = index(a.parent);
      if (parent === null || !nom) continue;
      actions.push({ type: 'creer', parent: parent, nom: nom, raison: raison });
    } else if (a.type === 'renommer') {
      var cible = index(a.dossier);
      if (cible === null || !nom) continue;
      if (estRacine(cible)) continue; // les noms « NN · … » appartiennent au self-healing NOMS_DOMAINES_TAG
      actions.push({ type: 'renommer', dossier: cible, nom: nom, raison: raison });
    }
  }
  var synthese = typeof brut.synthese === 'string' ? brut.synthese.trim().slice(0, 300) : '';
  if (actions.length === 0 && brut.actions.length > 0) return null; // tout était invalide → plan illisible
  return { actions: actions, synthese: synthese };
}

/**
 * Ligne d'onglet pour une action (en-têtes : Clé | Type | ID | Chemin actuel | Chemin proposé |
 * Statut | Détail | Horodaté). PURE (testée) — les chemins affichés sont le contrat de lecture
 * de l'app (C21-05, relatifs à la PORTÉE de l'analyse) ; l'application (C21-06) raisonne par ID,
 * jamais par chemin. `fusionner` porte « idSource→idCible » en colonne ID (le séparateur « → »
 * n'apparaît jamais dans un fileId).
 */
function lignePourAction_(tag, n, a, inventaire, horodate) {
  var cle = tag + '|' + n;
  var de = a.dossier ? inventaire[a.dossier - 1] : null;
  if (a.type === 'deplacer') {
    var vers = inventaire[a.vers - 1];
    return [cle, 'deplacer', de.id, de.chemin, vers.chemin + '/' + de.chemin.split('/').pop(), 'proposé', a.raison, horodate];
  }
  if (a.type === 'fusionner') {
    var cibleF = inventaire[a.vers - 1];
    return [cle, 'fusionner', de.id + '→' + cibleF.id, de.chemin, cibleF.chemin, 'proposé', a.raison, horodate];
  }
  if (a.type === 'creer') {
    var parent = inventaire[a.parent - 1];
    return [cle, 'creer', '', '', parent.chemin + '/' + a.nom, 'proposé', a.raison, horodate];
  }
  // renommer
  var chemin = de.chemin.split('/');
  chemin[chemin.length - 1] = a.nom;
  return [cle, 'renommer', de.id, de.chemin, chemin.join('/'), 'proposé', a.raison, horodate];
}
