/**
 * Consolidation.gs — CAMPAGNE DE CONSOLIDATION de l'arborescence (C28-26, ADR-0023).
 *
 * GÉNÈRE un PLAN dans l'onglet Sheet `PlanConsolidation` (Fichier | ID | Action | Cible | Raison |
 * Empreinte) : pour chaque fichier des domaines, où il DEVRAIT être sous la taxonomie à plat
 * (domaine [+ /AAAA si domaine par année] [+ /Entité si entité VALIDÉE] ; pièce d'identité → dossier
 * de TYPE), s'il est un DOUBLON (même empreinte MD5 qu'un fichier déjà recensé PAR CETTE CAMPAGNE),
 * ou s'il est INTOUCHABLE (zone protégée §1).
 *
 * DRY-RUN PUR : ce module ne DÉPLACE rien, ne renomme rien, ne supprime rien — il ne fait que des
 * LECTURES Drive et des écritures de RAPPORT (Sheet + Index). L'exécution des déplacements est un
 * chantier ULTÉRIEUR, après validation du plan par Marc (§8.6 : toute opération de masse ⇒ dry-run).
 * Gaté par `CONFIG.CONSOLIDATION_ACTIF` (false par défaut) : inerte tant que Marc n'allume pas.
 *
 * Garde-fous :
 *  - §1 zone protégée : `aParentProtege_(f, proteges, true)` (remontée multi-parents, échec-FERMÉ)
 *    → Action « Ignoré », même si le fichier est mal rangé OU en doublon (constat inscrit, jamais
 *    de proposition de déplacement) ;
 *  - §2 aucune suppression : les seules actions proposées sont OK / Déplacer / Doublon (déplacement
 *    seul vers `_Doublons`) / Ignoré ;
 *  - doublons : la mémoire d'empreintes est PROPRE À LA CAMPAGNE (colonne Empreinte de l'onglet,
 *    rechargée 1×/run + carte empreinte→fileId du run) — JAMAIS l'Index (`estDoublon_`), sinon tout
 *    fichier déjà traité par le pipeline serait « doublon de lui-même » (leçon C28, bypass
 *    `ignorerDoublon`). Elle vit dans la SHEET, pas en Script Properties (~2 900 empreintes ≈ 93 Ko
 *    ≫ la limite ~9 Ko d'une Property — leçon « une Property qui persiste une liste se borne ») ;
 *  - convergence : clé d'idempotence DÉDIÉE `conso|<tag>|<fileId>` (patron Migration/DryRunV2),
 *    posée en DERNIER ; un domaine dont une passe ENTIÈRE ne collecte plus rien est marqué épuisé
 *    (`conso|<tag>|dom|<nom>`) et sauté en O(1) — anti re-walk du mur de déjà-faits ; campagne
 *    « terminée » quand TOUS les domaines sont épuisés ; l'empreinte ne va JAMAIS dans l'Index
 *    (elle alimenterait le fast-path doublon de l'intake — auto-doublon) ;
 *  - bornes : garde-temps partagé + sous-budget `CONSOLIDATION_BUDGET_MS` par run + budget
 *    QUOTIDIEN `CONSOLIDATION_BUDGET_JOUR_MS` en ms réelles persistées (un plafond par run ne
 *    borne pas la journée — ×288 ticks) + garde de COLLECTE à mi-budget (réserve du temps au
 *    traitement : progrès garanti à chaque run) + plafond `CONSOLIDATION_MAX_PAR_RUN` ; le hash
 *    suit la même borne de taille que l'OCR ;
 *  - la CIBLE délègue à la règle UNIQUE `sousCheminDomaine_` (Router.gs) partagée avec le flux
 *    vivant (arbitrage Marc 2026-07-16 « entité OU année ») — divergence = « Déplacer » en boucle.
 */

/* ---------- Fonctions PURES (testées par test/consolidation.test.js) ---------- */

/**
 * Décompose un nom de fichier CLASSÉ (`AAAA[-MM[-JJ]]_Type_Tiers.ext`) en ses segments.
 * Un nom hors convention rend des champs null (le fichier sera ciblé « à plat » au domaine). PUR.
 * @param {string} nom
 * @return {{annee:?string, type:?string, tiers:?string}}
 */
function analyserNomClasse_(nom) {
  var s = String(nom == null ? '' : nom).trim();
  var ext = /\.[^.\/]+$/.exec(s); // extension retirée D'ABORD (sinon un nom sans tiers l'avale dans le type)
  var base = ext ? s.slice(0, s.length - ext[0].length) : s;
  var m = /^(\d{4})(?:-\d{2})?(?:-\d{2})?_([^_]+)(?:_(.+))?$/.exec(base);
  if (!m) return { annee: null, type: null, tiers: null };
  return { annee: m[1], type: m[2] || null, tiers: m[3] || null };
}

/**
 * SOUS-CHEMIN CIBLE d'un fichier sous son domaine — délègue à la RÈGLE UNIQUE `sousCheminDomaine_`
 * (Router.gs), la même que le flux vivant (arbitrage Marc 2026-07-16 « entité OU année » ;
 * tripwire test : divergence = « Déplacer » en boucle sur ce que le flux vient de classer) :
 *  1. type d'IDENTITÉ → dossier de TYPE — UNIQUEMENT dans le domaine du type (un passeport égaré
 *     dans 02 est ciblé à plat : le re-DOMAINE est hors périmètre de la consolidation, zéro LLM) ;
 *  2. ENTITÉ VALIDÉE (le tiers du nom se canonise vers une entité validée de CE domaine) → dossier
 *     d'entité, sans année ;
 *  3. domaine par ANNÉE → « AAAA » ;  4. sinon '' = à plat.
 * PUR (les entités validées arrivent en paramètre : {cleCanonique → {nom, dossierId}}).
 * ADR-0028 : renvoie le COUPLE `{nom, id}` de la règle unique — `id` (le `Dossier ID` de l'entité)
 * permet de reconnaître un fichier DÉJÀ dans le bon dossier même s'il est imbriqué (regroupement
 * ADR-0027), là où la seule comparaison de sous-chemin TEXTUEL proposait « Déplacer » en boucle.
 * @param {string} domaine
 * @param {string} nom  nom ACTUEL du fichier
 * @param {Object} validees  carte cleCanoniqueEntite_ → {nom, dossierId} (entités VALIDÉES seules)
 * @return {{nom:string, id:string}} sous-chemin relatif ('' = racine du domaine) + ID de l'entité
 */
function cheminCibleConsolidation_(domaine, nom, validees) {
  // ADR-0033 : MÊME délégation que le flux vivant (`planRoutageV2_`) — la cible se calcule par la
  // MÊME fonction pure que le Reset (`cheminCibleReset_`) sur le nom courant → convergence
  // flux↔conso↔reset par CONSTRUCTION. `id=''` : le chemin thématique EST la structure (pas d'ID
  // d'entité ; l'exécuteur `dossierCiblePlan_` sait déjà résoudre un nom multi-segments). Repli sur
  // la règle historique (entité validée / année / type d'identité) quand le Reset rend null.
  // C28-90 (revue sécurité) — `detail` recueille le drapeau FAIBLE posé PAR la ligne de la table
  // qui a décidé (`faibleReset_`, Reset.gs) : filet par TYPE (un « Contrat » sans bailleur, une
  // « Lettre » sans émetteur connu) ou école DÉDUITE d'une fenêtre de scolarité. Ces cibles-là
  // sortent un fichier de la RACINE d'un domaine, jamais d'un sous-dossier où une mission — ou
  // Marc — l'a rangé (D8, `decisionConsolidation_`).
  // ⚠️ Ce drapeau ne se RE-DÉRIVE pas du chemin rendu : `'Contrats'` ne dit pas si c'est l'entité
  // ou le type qui a répondu. La 1ʳᵉ version le re-calculait depuis le nom et le posait aussi sur
  // la branche `Diplômes & relevés officiels`, qui rend AVANT tout calcul d'école (leçon §9 :
  // « un verdict pris sur la donnée RICHE ne se re-dérive jamais depuis sa forme APPAUVRIE »).
  var detail = {};
  var relReset = cheminCibleReset_(domaine, nom, detail);
  if (relReset) {
    return detail.faible ? { nom: relReset, id: '', faible: true } : { nom: relReset, id: '' };
  }

  var seg = analyserNomClasse_(nom);
  // IDENTITÉ — MÊME repli que le flux vivant (`repliIdentite_`, Router.gs), jamais une seconde
  // formule (C28-72, revue structure). Avant : cette branche rendait le TYPE via
  // `sousCheminDomaine_({typeIdentite})`, c'est-à-dire un dossier de niveau 1 hors table. Comme la
  // collecte de la consolidation est RÉCURSIVE, elle voyait le fichier que le flux venait de poser
  // dans `Pièces d'identité`, calculait `Permis de conduire`, décidait « Déplacer », et
  // l'exécuteur RE-CRÉAIT le nœud parasite par nom — le correctif du flux annulé par la campagne
  // voisine, silencieusement, avec une CI verte. C'est la leçon §9 « une seule règle, deux
  // consommateurs » prise en flagrant délit.
  // FORT, volontairement (arbitrage C28-90, revue de code 🟠 3) : le repli d'identité vise
  // `Pièces d'identité/<titulaire>` — le domicile THÉMATIQUE d'un passeport, pas un fourre-tout.
  // Comme `État civil & notarial` et `Diplômes & relevés officiels`, il garde le pouvoir de
  // rassembler depuis un sous-dossier (critère détaillé sur `marquerFaibleReset_`, Reset.gs).
  if (seg.type) {
    var t = normaliserTypeIdentite_(seg.type);
    if (TYPES_IDENTITE.indexOf(t) !== -1) {
      var di = dossierIdentite_({ sousDossierType: seg.type });
      // Garde conservée : une pièce d'identité ÉGARÉE dans un autre domaine (un passeport en 02)
      // n'est pas ciblée par cette règle — elle retombe sur l'année/l'entité, comme avant.
      if (di.domaine === domaine) return { nom: repliIdentite_(di), id: '' };
    }
  }
  var entite = null;
  if (seg.tiers) {
    var cle = cleCanoniqueEntite_(domaine, seg.tiers);
    if (cle && validees && validees[cle]) entite = validees[cle];
  }
  // ADR-0052 : `nom` ouvre le repli PAR TYPE (dernier échelon avant la racine du domaine) — le
  // MÊME que le flux vivant, puisque c'est la MÊME fonction. L'oublier ici ferait re-proposer
  // « Déplacer vers la racine » exactement ce que le flux vient de ranger dans un sous-dossier.
  return sousCheminDomaine_({ domaine: domaine, entite: entite, annee: seg.annee, nom: nom });
}

/**
 * DÉCISION du plan pour un fichier (PURE — tout l'état arrive en paramètres) :
 *  - protégé (§1)  → « Ignoré » (constat de doublon éventuel dans la Raison, jamais de déplacement) ;
 *  - raccourci     → « Ignoré » (un raccourci d'entité est un artefact voulu du pipeline, pas un doc) ;
 *  - doublon       → « Doublon », cible `_Doublons` (déplacement seul, jamais de suppression §2) ;
 *  - déjà en place → « OK » ;
 *  - sinon         → « Déplacer » vers `domaine[/sousCheminCible]`.
 * @param {{domaine:string, sousCheminActuel:string, sousCheminCible:string, protege:boolean,
 *          protegeIllisible:boolean, raccourci:boolean, doublonDe:?string,
 *          parentId:?string, dossierIdCible:?string, cibleFaible:?boolean}} d
 *   cibleFaible (ADR-0052 D8) : la cible ne vient QUE du type du document — repli
 *   `bucketTypeDomaine_`, filets par type de la table (`faibleReset_`, Reset.gs) et école déduite
 *   d'une fenêtre de scolarité. Elle suffit à sortir un fichier de la racine d'un domaine, jamais
 *   à le déplacer d'un sous-dossier.
 *   parentId/dossierIdCible (ADR-0028) : égalité d'ID = « déjà au bon endroit », À TOUTE PROFONDEUR,
 *   évaluée AVANT la comparaison textuelle des sous-chemins. Absents ⇒ comportement textuel d'avant.
 *   protege = zone protégée CONSTATÉE (détection positive) ; protegeIllisible = contrôle §1
 *   illisible (abstention prudente, raison HONNÊTE — le plan que Marc valide ne doit pas mentir).
 * @return {{action:string, cible:string, raison:string}}
 */
/**
 * Vrai si `actuel` est STRICTEMENT PLUS PROFOND que `cible` et commence par elle, segment par
 * segment — c'est-à-dire si la cible est un ANCÊTRE de la position actuelle. PURE.
 *
 * La comparaison est faite SEGMENT par SEGMENT, jamais par `indexOf` de chaîne : « Contrats » est
 * un préfixe de chaîne de « Contrats divers », qui est un dossier DIFFÉRENT. Le piège est le même
 * que celui des motifs en sous-chaîne du routage, et il coûterait ici un fichier qui ne bouge plus.
 * @param {string} actuel  sous-chemin actuel, relatif au domaine
 * @param {string} cible   sous-chemin calculé, relatif au domaine
 * @return {boolean}
 */
function estSousCheminDe_(actuel, cible) {
  var a = String(actuel || '').split('/').filter(Boolean);
  var c = String(cible || '').split('/').filter(Boolean);
  if (!c.length || a.length <= c.length) return false; // cible vide ⇒ D8 s'en charge ; pas plus profond ⇒ rien à dire
  for (var i = 0; i < c.length; i++) if (a[i] !== c[i]) return false;
  return true;
}

/**
 * Vrai si le fichier est DÉJÀ DANS la structure que Marc a construite lui-même (ADR-0055) :
 * au moins `Archives scolaires/<école>` dans `06`. PURE.
 *
 * Le seuil est « ≥ 2 segments » et pas « ≥ 1 » : un fichier posé directement dans
 * `Archives scolaires` n'est rangé dans AUCUN de ses dossiers, et la campagne a le droit de le
 * descendre dans l'école que son nom désigne.
 * @param {string} domaine @param {string} sousChemin @return {boolean}
 */
function estDansStructureMarc_(domaine, sousChemin) {
  if (String(domaine) !== '06 · Études & diplômes') return false;
  var racine = typeof RACINE_ARCHIVES_ECOLE_RESET !== 'undefined'
    ? RACINE_ARCHIVES_ECOLE_RESET : 'Archives scolaires';
  var segs = String(sousChemin || '').split('/').filter(Boolean);
  return segs.length >= 2 && segs[0] === racine;
}

function decisionConsolidation_(d) {
  if (d.protege) {
    return {
      action: 'Ignoré', cible: '',
      raison: 'Zone protégée (04) intouchable' + (d.doublonDe ? ' — doublon constaté de ' + d.doublonDe : ''),
    };
  }
  if (d.protegeIllisible) {
    return {
      action: 'Ignoré', cible: '',
      raison: 'Contrôle zone protégée ILLISIBLE — abstention (§1), à re-vérifier avant toute exécution',
    };
  }
  if (d.raccourci) return { action: 'Ignoré', cible: '', raison: 'Raccourci Drive (artefact d\'entité, jamais déplacé)' };
  if (d.doublonDe) return { action: 'Doublon', cible: '_Doublons', raison: 'Même empreinte que ' + d.doublonDe + ' (déplacement seul, §2)' };
  var cible = d.domaine + (d.sousCheminCible ? '/' + d.sousCheminCible : '');
  // ADR-0028 — TOPOLOGIE D'ABORD : si le fichier est DÉJÀ dans le dossier de son entité (égalité
  // d'ID), il est bien rangé, quelle que soit sa PROFONDEUR. Sans cette règle, un dossier d'entité
  // déplacé sous un regroupement (ADR-0027) verrait ses fichiers re-sortis à chaque passe — c'est
  // le comparateur TEXTUEL qui mentait, pas le classement.
  if (d.dossierIdCible && d.parentId && String(d.parentId) === String(d.dossierIdCible)) {
    return { action: 'OK', cible: cible, raison: 'Déjà dans le dossier de l’entité (ID, ADR-0028)' };
  }
  if (String(d.sousCheminActuel || '') === String(d.sousCheminCible || '')) {
    return { action: 'OK', cible: cible, raison: 'Déjà au bon endroit' };
  }
  // C28-90 / ADR-0052 D9 — ON NE REMONTE JAMAIS UN FICHIER VERS UN DE SES ANCÊTRES.
  // Quand la cible calculée est un PRÉFIXE du chemin actuel, le fichier est déjà là où on veut
  // l'envoyer, en PLUS PRÉCIS. Cela ne veut pas dire qu'il est mal rangé : cela veut dire que la
  // règle générale en sait MOINS que celui qui l'a rangé — une mission qui range par thème
  // (`Logement/3325 4e avenue/Correspondance`) ou par émetteur
  // (`Assurance habitation/Desjardins`), ou Marc lui-même.
  //
  // C'est la garde qui rend le BUMP DE CAMPAGNE sûr (C28-90). Sans elle, la passe fraîche
  // proposait de remonter d'un cran TOUT ce que les missions de C28-84/85 venaient de classer :
  // mesuré sur le Drive réel, les 6 sous-dossiers thématiques de `Logement/3325 4e avenue` et les
  // 4 buckets d'émetteur créés le 12/09. `ConsolidationExec` applique sans validation ligne à
  // ligne : l'erreur aurait été muette, massive, et exactement l'inverse du travail demandé.
  //
  // Ce que la garde N'EMPÊCHE PAS : un déplacement LATÉRAL (`Contrats` → `Logement/<adresse>`) ni
  // un approfondissement (`Assurance habitation` → `Assurance habitation/MAIF`). Le rattrapage
  // garde donc tout son pouvoir ; il perd seulement celui de défaire un rangement plus fin.
  if (estSousCheminDe_(d.sousCheminActuel, d.sousCheminCible)) {
    return {
      action: 'OK', cible: d.domaine + '/' + d.sousCheminActuel,
      raison: 'Déjà rangé plus finement (' + d.sousCheminActuel + ') — jamais remonté (C28-90)',
    };
  }
  // ADR-0052 D8 — UN SIGNAL FAIBLE NE DÉPLACE PAS CE QUI EST DÉJÀ RANGÉ. Le repli par TYPE ne lit
  // que le type du document : il ignore tout ce qui a pu justifier le rangement actuel (une mission
  // qui range par bailleur ou par fenêtre d'occupation, un geste de Marc, un dossier d'entité pas
  // encore au référentiel). Il a été introduit pour qu'un document ne RESTE pas à la racine, pas
  // pour arbitrer contre un classement existant — et l'exécuteur applique sans validation ligne à
  // ligne, donc l'erreur serait muette et définitive de fait.
  // Mesuré avant d'écrire cette garde : sur 8 fichiers réels de `03/Logement/3325 4e avenue`, 2
  // (« Échange de messages_Saga Installation », « Échange de messagerie_Guy Laporte ») partaient
  // vers `Correspondance` — la table ne reconnaît ni l'un ni l'autre émetteur, la mission si.
  if (d.cibleFaible && String(d.sousCheminActuel || '') !== '') {
    return {
      action: 'OK', cible: d.domaine + '/' + d.sousCheminActuel,
      raison: 'Déjà dans un sous-dossier — le repli par type ne déplace pas (ADR-0052 D8)',
    };
  }
  // ADR-0056 D11 — LA RACINE D'UN DOMAINE EN COURS DE RE-DATATION NE SE VIDE PAS SOUS LA CAMPAGNE.
  //
  // 🔴 revue code ADR-0056. La re-datation (C28-92) ne collecte QUE les fichiers à plat à la racine
  // de `06` — c'est la garde `REANALYSE_RACINE_SEULE`, posée pour qu'elle ne défasse pas le rangement
  // de Marc. Mais la consolidation passe AVANT elle dans le tick, avec 24 min/j contre 8, en pure
  // I/O : elle draine des dizaines de fichiers/minute là où la campagne en traite 16 à 24 par JOUR.
  // Et D8 ne protège explicitement PAS les fichiers à plat (c'est le but d'ADR-0052). Elle emporte
  // donc le stock, classé sur son NOM et sa date FAUSSE — la date de réception, précisément ce que
  // la campagne existe pour corriger. Les fichiers atterrissent dans la mauvaise année, la campagne
  // collecte 0 à la passe suivante et se déclare « terminée ✅ » sans avoir rien re-daté : les ~8,6 $
  // sont dépensés pour rien et le problème d'origine de Marc revient intact.
  // On RETARDE donc, on n'annule pas : ADR-0052 (« plus aucun fichier à plat ») reprend la main sur
  // ce domaine dès que la campagne converge. C'est un chemin de RETOUR (un état observable), jamais
  // un délai (§9) — et c'est borné aux domaines de `REANALYSE_CIBLES`, à la RACINE seule.
  if (d.reDatationEnCours && String(d.sousCheminActuel || '') === '') {
    return {
      action: 'OK', cible: d.domaine,
      raison: 'Re-datation en cours sur ce domaine — classer maintenant le figerait sur une date fausse (ADR-0056 D11)',
    };
  }
  // C28-90 (trouvé en vérifiant la revue) — UNE CIBLE VIDE NE REMONTE JAMAIS UN FICHIER À LA RACINE.
  // « Aucune règle, pas même le type, n'a su placer ce document » est un constat d'IGNORANCE : il ne
  // dit rien du rangement actuel, et il ne peut donc pas le défaire. Or la collecte est RÉCURSIVE
  // sur tout le domaine : sans cette ligne, un fichier bien rangé dont le nom n'apprend rien (ex.
  // « Attestation_Coursera » sous `06/Archives scolaires/Online course — AI Essentials ») recevait
  // un « Déplacer » vers la RACINE du domaine — c'est-à-dire vers le vrac que cette campagne existe
  // pour vider, et que `HistoriqueVrac` compte comme dette. Le constat reste DIT dans la raison,
  // pour que Marc puisse trancher ; c'est le déplacement qui disparaît.
  if (!String(d.sousCheminCible || '') && String(d.sousCheminActuel || '') !== '') {
    return {
      action: 'OK', cible: d.domaine + '/' + d.sousCheminActuel,
      raison: 'Aucune règle ne sait le placer — laissé où il est, jamais remonté à la racine (C28-90)',
    };
  }
  // ADR-0055 D10 — ON NE RÉORGANISE JAMAIS L'INTÉRIEUR DE LA STRUCTURE QUE MARC A CONSTRUITE.
  //
  // D8 ne protège que les cibles FAIBLES et D9 que les remontées vers un ANCÊTRE : entre deux
  // FRÈRES de même profondeur, les deux se taisent. Or une école NOMMÉE dans le nom est un signal
  // FORT — donc, sans cette règle, la consolidation vide `Archives scolaires/IMERIR — …/MFE` dans
  // `…/IMERIR — …/Cours & travaux`, et `Archives scolaires/Collège & Lycée — divers (2014-2018)`
  // vers `Autres établissements`, à la RACINE du domaine. Les trois agents de la revue flotte l'ont
  // trouvé indépendamment, deux d'entre eux en EXÉCUTANT `decisionConsolidation_` sur ces cas.
  // C'est l'inverse mot pour mot de la demande qui a motivé ADR-0055 : « continue à rajouter
  // là-dedans au lieu de mettre à la racine du projet ».
  //
  // Ce que la règle autorise encore : un APPROFONDISSEMENT dans le MÊME dossier (la cible est un
  // descendant strict de la position) — `Archives scolaires/<école>` → `…/<école>/Cours & travaux`
  // reste un gain. Ce qu'elle interdit : tout mouvement LATÉRAL ou SORTANT depuis un dossier de
  // Marc. Un fichier encore à la racine de `06` ou dans un dossier d'école du moteur n'est PAS
  // concerné : le déménagement d'ADR-0055 garde tout son pouvoir.
  if (estDansStructureMarc_(d.domaine, d.sousCheminActuel) &&
      !estSousCheminDe_(d.sousCheminCible, d.sousCheminActuel)) {
    return {
      action: 'OK', cible: d.domaine + '/' + d.sousCheminActuel,
      raison: 'Dans la structure de Marc (' + d.sousCheminActuel +
        ') — jamais réorganisée depuis l\'extérieur (ADR-0055 D10)',
    };
  }
  // La RAISON est lue par Marc dans le plan qu'il valide : elle doit dire la vérité de la règle qui
  // a décidé. ⚠️ Arrivé ici, `sousCheminCible` est TOUJOURS non vide : les deux sorties `OK`
  // ci-dessus (déjà au bon endroit / jamais remonté à la racine) couvrent l'intégralité des cibles
  // vides. Le ternaire qui s'y trouvait — et sa raison « racine du domaine, à trancher avec
  // Marc » — était devenu du code MORT (vérifié par balayage exhaustif des couples possibles,
  // 3ᵉ passe de revue) ; le garder aurait laissé croire à un chemin qui n'existe plus.
  return {
    action: 'Déplacer', cible: cible,
    raison: 'Entité/année validée, ou type de document (ADR-0052)',
  };
}

/* ---------- I/O (lecture Drive + rapport Sheet, ZÉRO mutation Drive) ---------- */

/**
 * Mémoire d'empreintes de LA CAMPAGNE : carte empreinte → fileId du PREMIER porteur, rechargée
 * depuis l'onglet `PlanConsolidation` (colonnes ID/Empreinte) une fois par run. Propre au plan —
 * jamais l'Index (auto-doublon). Un onglet illisible rend une carte vide (dédup intra-run seule).
 * @return {Object} {empreinte: fileId}
 */
function empreintesPlanConsolidation_() {
  return empreintesPlanDeuxSens_().parEmpreinte;
}

/**
 * UNE seule lecture du plan → les DEUX sens de l'index d'empreintes :
 *  - `parEmpreinte` : empreinte → 1ᵉʳ porteur (détection de doublon, contrat historique) ;
 *  - `parId`        : fileId → empreinte (RÉUTILISATION). `empreinteBlob_` télécharge les octets du
 *    fichier : c'est de LOIN le poste le plus cher du placement du reset. Tout fichier déjà hashé par
 *    conso-2 n'a donc plus à l'être (même fonction de hash des deux côtés — `Consolidation` et
 *    `Reset` appellent tous deux `empreinteBlob_`, les valeurs sont interchangeables par
 *    construction). Construire l'inverse dans la MÊME boucle est gratuit (revue #229).
 */
function empreintesPlanDeuxSens_() {
  var res = { parEmpreinte: {}, parId: {} };
  try {
    var f = feuille_('PlanConsolidation');
    var dern = f.getLastRow();
    if (dern < 2) return res;
    var lignes = f.getRange(2, 1, dern - 1, COLONNES_PLAN_CONSOLIDATION.length).getValues();
    for (var i = 0; i < lignes.length; i++) {
      var emp = String(lignes[i][6] || ''); // colonne Empreinte
      var id = String(lignes[i][2] || '');  // colonne ID
      if (!emp || !id) continue;
      if (!res.parEmpreinte[emp]) res.parEmpreinte[emp] = id; // 1er porteur seulement
      if (!res.parId[id]) res.parId[id] = emp;
    }
  } catch (e) {
    journalErreur_('Consolidation', 'Plan existant illisible (dédup intra-run seule ce run) : ' + e);
  }
  return res;
}

/** Consommation du budget QUOTIDIEN de la campagne (ms réelles persistées `AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourConsolidation_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_CONSO_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/**
 * Collecte récursive des fichiers d'un domaine PAS ENCORE au plan (clé `conso|<tag>|<id>` absente
 * de l'Index — prédicat de convergence, filtré À LA COLLECTE : un mur de déjà-faits n'occupe
 * aucune place de page). Lecture seule, bornée par `max` et le garde. `etat.complet` passe à false
 * dès que le walk s'arrête AVANT la fin de l'arbre (garde ou page pleine) — il permet de marquer
 * un domaine « épuisé » SEULEMENT sur une passe entière (revue apps-script-quota : sans ce
 * marquage, le re-walk du mur de déjà-faits brûlait tout le budget en fin de campagne). `vusRun`
 * dédoublonne par fileId dans le run (multi-parents/pagination — leçon « raisonner par fileId »).
 * @param {Folder} dossier
 * @param {string} domaine
 * @param {Array<{id:string, domaine:string}>} items  muté en place
 * @param {number} max
 * @param {function():boolean} garde
 * @param {string} tag
 * @param {{complet:boolean}} etat  muté en place
 * @param {Object} vusRun  {fileId: true} — partagé sur tout le run
 */
function collecterConsolidation_(dossier, domaine, items, max, garde, tag, etat, vusRun) {
  var fi = dossier.getFiles();
  while (fi.hasNext()) {
    if (garde() || items.length >= max) { etat.complet = false; return; }
    try {
      var f = fi.next();
      var id = f.getId();
      if (vusRun[id]) continue;
      vusRun[id] = true;
      // Épinglé par Marc (rangé via le chat) → JAMAIS re-déplacé (convergence, C28-30/ADR-0026).
      if (indexContient_('epingle|' + id)) continue;
      if (!indexContient_('conso|' + tag + '|' + id)) items.push({ id: id, domaine: domaine });
    } catch (e) { etat.complet = false; /* fichier illisible : re-vu à la passe suivante */ }
  }
  var fo = dossier.getFolders();
  while (fo.hasNext()) {
    if (garde() || items.length >= max) { etat.complet = false; return; }
    try { collecterConsolidation_(fo.next(), domaine, items, max, garde, tag, etat, vusRun); }
    catch (e) { etat.complet = false; /* sous-dossier illisible : jamais un plantage */ }
  }
}

/**
 * Traite UN fichier du plan : chemin actuel, empreinte (même borne de taille que l'OCR), garde §1
 * en mode STRICT (échec-fermé), décision PURE, ligne de rapport, puis clé de convergence en DERNIER
 * (ordre des écritures d'état : une coupure rejoue au lieu de perdre). ZÉRO mutation Drive.
 * @param {string} fileId
 * @param {string} domaine
 * @param {string} tag
 * @param {{proteges:Object, validees:Object, empreintesVues:Object}} ctx
 * @return {boolean} vrai si une ligne a été écrite
 */
function traiterUnConsolidation_(fileId, domaine, tag, ctx) {
  var cle = 'conso|' + tag + '|' + fileId;
  var f, nom, mime;
  try {
    f = DriveApp.getFileById(fileId);
    nom = f.getName();
    mime = f.getMimeType();
  } catch (e) {
    // Fichier disparu/illisible entre la collecte et le traitement : ligne quand même (jamais un
    // no-op silencieux — le plan que Marc lit doit porter la trace), convergence posée.
    ctx.feuille.appendRow([new Date(), fileId, fileId, 'Ignoré', '', 'Fichier illisible : ' + e, '']);
    indexAjouter_(cle, { statut: 'consolidation-plan', nom: fileId, domaine: domaine, chemin: '' }, '');
    return true;
  }

  var raccourci = mime === 'application/vnd.google-apps.shortcut';
  // Garde §1 en DEUX temps pour une raison HONNÊTE : détection POSITIVE (vraie zone protégée) vs
  // contrôle ILLISIBLE (le strict échec-fermé rattrape les deux, mais le plan que Marc valide ne
  // doit pas étiqueter « Zone protégée » un simple blip de lecture). Le 2ᵉ appel (non strict) ne
  // coûte que sur les fichiers où le strict a dit vrai (rares).
  var protegeStrict = aParentProtege_(f, ctx.proteges, true);
  var protegeConstate = protegeStrict && aParentProtege_(f, ctx.proteges, false);

  // Empreinte : DÉLÉGUÉE à `empreinteReutiliseeReset_` (Reset.gs) — le patron VALIDÉ du reset, LITTÉRALEMENT
  // la même fonction (revue flotte 2026-08-05, apps-script-quota + file-checker). Elle : (a) RÉUTILISE
  // l'empreinte déjà connue par fileId (`empreinteConnueParId_`, Index) AVANT de re-télécharger les octets
  // — le hash MD5 est le GOULOT du drainage, et un fichier déjà haché par le flux/reset n'a plus à l'être
  // (accélère le legacy SANS toucher au budget quotidien, marge de gel préservée) ; (b) EXCLUT les fichiers
  // Google NATIFS et raccourcis (mime `application/vnd.google-apps…` → '') — CRUCIAL : pour un natif,
  // l'empreinte de l'Index est le hash du TEXTE exporté, deux natifs quasi vides partagent `MD5("")` et le
  // second partirait à tort dans `_Doublons` (exec ON) ; (c) borne le hash de repli à `RESET_HASH_TAILLE_MAX`
  // (protège le mur 6 min). `ctx.empreintesConnues` absent côté conso ⇒ repli propre sur l'Index.
  var empreinte = empreinteReutiliseeReset_(f, ctx);
  // Doublon = même empreinte qu'un AUTRE fichier déjà recensé PAR LA CAMPAGNE (jamais l'Index —
  // auto-doublon ; jamais lui-même — rejeu après coupure entre la ligne et la clé).
  var doublonDe = (empreinte && ctx.empreintesVues[empreinte] && ctx.empreintesVues[empreinte] !== fileId)
    ? ctx.empreintesVues[empreinte] : null;
  if (empreinte && !ctx.empreintesVues[empreinte]) ctx.empreintesVues[empreinte] = fileId;

  var cheminComplet = cheminActuelDryRunV2_(f, domaine); // « domaine[/sous/chemin] » (réutilisé tel quel)
  var sousCheminActuel = cheminComplet === domaine ? '' : cheminComplet.slice(domaine.length + 1);

  var cibleConso = cheminCibleConsolidation_(domaine, nom, ctx.validees);
  // ADR-0028 : parent RÉEL du fichier — comparé à l'ID de l'entité cible (« déjà au bon endroit »
  // à toute profondeur). Illisible ⇒ '' : on retombe sur la comparaison textuelle, jamais un plantage.
  var parentId = '';
  try { var ps = f.getParents(); if (ps.hasNext()) parentId = ps.next().getId(); } catch (e3) { parentId = ''; }

  var d = decisionConsolidation_({
    domaine: domaine,
    sousCheminActuel: sousCheminActuel,
    sousCheminCible: cibleConso.nom,
    dossierIdCible: cibleConso.id,
    cibleFaible: cibleConso.faible === true, // ADR-0052 D8 : cible issue du seul TYPE du document
    // ADR-0056 D11. Appel DIRECT et non `ctx.x ? ctx.x() : false` : un contexte de test qui
    // oublierait la clé désarmerait la garde EN SILENCE. La lecture de Property est mémoïsée par
    // exécution dans `reDatationEnCours_` — une page de consolidation en traite des dizaines.
    reDatationEnCours: reDatationEnCours_(domaine),

    parentId: parentId,
    protege: protegeConstate,
    protegeIllisible: protegeStrict && !protegeConstate,
    raccourci: raccourci,
    doublonDe: doublonDe,
  });

  // L'empreinte va dans la COLONNE du plan (mémoire de campagne) mais JAMAIS dans l'Index : elle y
  // alimenterait `estDoublon_` (fast-path intake) et fabriquerait des « doublons de lui-même » si un
  // rangement futur re-présentait le fichier (revue code C28-26 — leçon bypass `ignorerDoublon`).
  ctx.feuille.appendRow([new Date(), nom, fileId, d.action, d.cible, d.raison, empreinte]);
  indexAjouter_(cle, { statut: 'consolidation-plan', nom: nom, domaine: domaine, chemin: d.cible }, '');
  return true;
}

/**
 * ÉTAPE DE TICK de la campagne (appelée en fin de tick, gatée par `CONFIG.CONSOLIDATION_ACTIF` +
 * budget — étape SECONDAIRE enveloppée par l'appelant). Une page par run : collecte (filtrée par la
 * clé de convergence) puis traitement, sous-budget PROPRE. « Terminé » (Property
 * `DriveAI_CONSOLIDATION` = tag) UNIQUEMENT quand une passe complète ne collecte plus rien (jamais
 * sur une passe interrompue/en erreur — patron anti-« faux terminé » du rangement).
 * @param {function():boolean} estBudgetDepasse
 */
function genererPlanConsolidation_(estBudgetDepasse) {
  if (!CONFIG.CONSOLIDATION_ACTIF) return;
  var props = PropertiesService.getScriptProperties();
  var tag = CONFIG.CONSOLIDATION_TAG;

  // ROTATION de campagne (revue flotte 2026-07-21) : un NOUVEAU tag purge le plan PÉRIMÉ (des
  // lignes calculées contre un ancien référentiel — ex. conso-1 généré AVANT le seed des entités
  // ciblait encore des dossiers de banque) et remet les curseurs à zéro. Purge d'un RAPPORT
  // (jamais de documents, §2 intact — même famille que la rotation du Journal).
  if (props.getProperty('DriveAI_CONSO_PLAN_TAG') !== tag) {
    var fPlan = feuille_('PlanConsolidation');
    var dernL = fPlan.getLastRow();
    if (dernL > 1) fPlan.getRange(2, 1, dernL - 1, COLONNES_PLAN_CONSOLIDATION.length).clearContent();
    props.deleteProperty('DriveAI_CONSOLIDATION');
    props.deleteProperty('DriveAI_CONSO_EXEC_LIGNE');
    props.deleteProperty('DriveAI_CONSO_EXEC_FINI');
    props.setProperty('DriveAI_CONSO_PLAN_TAG', tag);
    journalInfo_('Consolidation', 'Nouveau tag de campagne « ' + tag + ' » : plan purgé, curseurs remis à zéro.');
  }

  if (props.getProperty('DriveAI_CONSOLIDATION') === tag) return; // campagne finie (1 lecture)
  if (estBudgetDepasse()) return;

  // CONTRE-PRESSION (drainer avant d'alimenter, tôt + gated) : si l'EXÉCUTEUR a trop de lignes de
  // retard, on n'alimente pas le plan ce run — il rattrape d'abord (revue quotas 2026-07-21).
  if (CONFIG.CONSOLIDATION_EXEC_ACTIF) {
    var curseurExec = Number(props.getProperty('DriveAI_CONSO_EXEC_LIGNE')) || 1;
    if (feuille_('PlanConsolidation').getLastRow() - curseurExec >= CONFIG.CONSOLIDATION_BACKLOG_MAX) return;
  }

  // Budget QUOTIDIEN en ms RÉELLES persistées (leçon §7 : un plafond par RUN ne borne pas la
  // JOURNÉE — ×288 ticks > quota runtime ~90 min/j, la campagne affamerait l'intake).
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourConsolidation_(props, aujourdhui);
  if (consommeJour >= CONFIG.CONSOLIDATION_BUDGET_JOUR_MS) return; // repris demain

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.CONSOLIDATION_BUDGET_MS, CONFIG.CONSOLIDATION_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };
  // Garde de COLLECTE : moitié du budget au plus — réserve du temps au TRAITEMENT, sinon un walk
  // long laisse n=0 à chaque run (plateau silencieux, revue apps-script-quota) : progrès garanti.
  var gardeCollecte = function () { return garde() || (Date.now() - debut) > budgetRun / 2; };

  try {
    // Périmètre : domaines FIXES (04 INCLUS — en CONSTAT seul, la garde §1 force « Ignoré ») + domaines
    // AUTO déjà nés (ID en Script Property — jamais `dossierDomaineAuto_` ici : il CRÉERAIT le dossier,
    // or ce module ne mute rien). `_Doublons`/`_Technique`/`_Médias`/files 00 : pas des domaines, jamais parcourus.
    var domaines = [];
    Object.keys(CONFIG.DOMAINES).forEach(function (nom) { domaines.push({ nom: nom, id: CONFIG.DOMAINES[nom] }); });
    (CONFIG.DOMAINES_AUTO || []).forEach(function (nom) {
      var id = props.getProperty('DriveAI_DOM_' + nom);
      if (id) domaines.push({ nom: nom, id: id });
    });

    var items = [];
    var vusRun = {};
    for (var i = 0; i < domaines.length && items.length < CONFIG.CONSOLIDATION_MAX_PAR_RUN; i++) {
      if (gardeCollecte()) break;
      var cleDom = 'conso|' + tag + '|dom|' + domaines[i].nom;
      if (indexContient_(cleDom)) continue; // domaine ÉPUISÉ pour le tag : sauté en O(1) (anti re-walk)
      var etatDom = { complet: true };
      var avantDom = items.length;
      try {
        collecterConsolidation_(DriveApp.getFolderById(domaines[i].id), domaines[i].nom, items,
          CONFIG.CONSOLIDATION_MAX_PAR_RUN, gardeCollecte, tag, etatDom, vusRun);
      } catch (e) {
        etatDom.complet = false;
        journalErreur_('Consolidation', 'Domaine inaccessible (' + domaines[i].nom + ') : ' + e);
      }
      // Passe ENTIÈRE de CE domaine sans y collecter → plus rien à y faire pour ce tag : marqué
      // épuisé (les fichiers ajoutés PLUS TARD sont l'affaire du flux vivant, pas de la campagne).
      if (etatDom.complet && items.length === avantDom) {
        indexAjouter_(cleDom, { statut: 'consolidation-domaine-epuise', nom: domaines[i].nom, domaine: domaines[i].nom, chemin: '' }, '');
      }
    }

    if (!items.length) {
      // Fin de campagne = TOUS les domaines marqués épuisés (jamais sur interruption : un domaine
      // coupé par la garde n'est pas marqué — anti-faux-terminé).
      var tousEpuises = true;
      for (var k = 0; k < domaines.length; k++) {
        if (!indexContient_('conso|' + tag + '|dom|' + domaines[k].nom)) { tousEpuises = false; break; }
      }
      if (tousEpuises) {
        props.setProperty('DriveAI_CONSOLIDATION', tag);
        journalInfo_('Consolidation', 'Plan de consolidation TERMINÉ (tag « ' + tag + ' ») — onglet PlanConsolidation prêt pour validation.');
      }
      return;
    }

    var ctx = {
      proteges: ensembleDomainesProteges_(),
      validees: entitesValideesParCle_(),
      empreintesVues: empreintesPlanConsolidation_(),
      feuille: feuille_('PlanConsolidation'), // hissée : ~2 appendRow/fichier sans re-résolution d'onglet
    };
    var n = 0;
    for (var j = 0; j < items.length; j++) {
      if (garde()) break;
      // Try PAR ITEM : un fichier empoisonné ne doit jamais avorter le reste de la page.
      try { if (traiterUnConsolidation_(items[j].id, items[j].domaine, tag, ctx)) n++; }
      catch (e) { journalErreur_('Consolidation', 'Item sauté (' + items[j].id + ') : ' + e); }
    }
    if (n) journalInfo_('Consolidation', n + ' fichier(s) ajoutés au plan de consolidation (dry-run, aucune mutation).');
  } finally {
    // ms RÉELLES consommées ce run, persistées (date|ms) — même sur interruption/exception.
    props.setProperty('DriveAI_CONSO_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut)));
  }
}
