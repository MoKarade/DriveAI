/**
 * Missions.gs — Missions de curation (C28-49, ADR-0039) : le rangement FIN, dossier par dossier,
 * spécifié par Marc (brief 2026-08-17). PR1 : socle générique + les 4 missions 03/06.
 *
 * Contrat du socle (invariants hérités de ConsolidationExec/Reset — « quels gardes mes voisins
 * ont-ils ? ») :
 *  - LA SEULE MUTATION est `moveTo` (déplacement, réversible) + une PEINTURE de couleur de dossier
 *    (métadonnée, réversible). JAMAIS de suppression (§2) — les dossiers vidés sont peints en
 *    ROUGE pour que Marc choisisse lui-même ce qu'il corbeille.
 *  - Zone protégée (04 · Immigration) exclue à la COLLECTE et RE-VÉRIFIÉE strictement avant
 *    CHAQUE mutation. Multi-parents : jamais déplacé.
 *  - Idempotence VERSIONNÉE : `mission|<tag>|<version>|<fileId>`, posée APRÈS le déplacement.
 *    Les REFUS (non appariés) sont aussi inscrits — sinon re-collecte à vie — et la version dans
 *    la clé rend l'affinage des règles effectif (leçon C28-33 : un verdict NÉGATIF se fige par
 *    version, jamais à vie).
 *  - Convergence : terminée quand une passe COMPLÈTE ne collecte plus rien de traitable.
 *  - Budget QUOTIDIEN partagé (ms réelles persistées, `DriveAI_MISSIONS_JOUR`) + garde-temps
 *    évalué À CHAQUE item, collecte comprise. Zéro LLM : tout se décide par le NOM
 *    (`AAAA-MM-JJ_Type_Émetteur`) et la structure.
 */

/* ================= Table des missions (PR1 : 03 + 06) ================= */

/**
 * Chaque mission : { tag, cle (registre/Progression), sources: [folderId], router(nom, info, ctx),
 * batirCtx() } — `router` est PUR (testé) : rend { cibleId, sousDossier: ?string } ou null
 * (non apparié → laissé en place + rapporté, jamais deviné).
 * @return {Array<Object>}
 */
function tableMissions_() {
  var IDS = CONFIG.MISSIONS_IDS;
  return [
    {
      tag: 'vehicule', cle: 'mission-vehicule',
      sources: [IDS.vehiculesPluriel, IDS.toyotaBzIsole],
      // c49-2 (ADR-0040 §3a) : le canon des véhicules vient de la TABLE (MISSIONS_VEHICULES —
      // une cible peut être CRÉÉE : KIA n'existait pas) ; les fenêtres de POSSESSION dérivées des
      // dossiers de véhicules déjà remplis servent de filet aux documents génériques datés.
      batirCtx: function () {
        var cibles = ciblesAvecJetons_(IDS.vehiculeCible, {});
        // Catégories INCLUSES (revue finale C28-51) : la mission range elle-même en catégories —
        // des fenêtres lues « à plat » seulement s'assécheraient au fil de son propre drainage.
        var fenetres = fenetresOccupation_(cibles, true);
        // GATE DE COMPLÉTUDE (🔴 revue finale C28-51) : router par fenêtre alors qu'un véhicule
        // de la TABLE n'a pas encore de fenêtre (KIA au run 1 — la mission construit elle-même
        // cet état) = verdict « une seule fenêtre » rendu sur un jeu INCOMPLET → déplacement au
        // mauvais véhicule à clé de SUCCÈS, définitif. Tant que CHAQUE véhicule de la table n'a
        // pas sa fenêtre : refus (révisable — bump c49-3 planifié post-drainage, ADR-0040 §5).
        var parNom = {};
        cibles.forEach(function (c) { parNom[c.nom] = c.id; });
        var fenetresPar = {};
        fenetres.forEach(function (f) { fenetresPar[f.id] = true; });
        var completes = (CONFIG.MISSIONS_VEHICULES || []).every(function (v) {
          return parNom[v.nom] && fenetresPar[parNom[v.nom]];
        });
        return { fenetres: fenetres, fenetresCompletes: completes };
      },
      router: function (nom, info, ctx) {
        // Le dossier `Toyota bZ` isolé part EN BLOC vers Véhicule/Toyota bZ (ordre explicite de Marc).
        if (info.sourceId === IDS.toyotaBzIsole) {
          return { cibleParentId: IDS.vehiculeCible, cibleNom: 'Toyota bZ', sousDossier: info.sousChemin };
        }
        // La CATÉGORIE du fichier = son sous-dossier SOURCE s'il est une catégorie déclarée
        // (décision Marc : les catégories vivent DANS chaque véhicule) — sinon à plat.
        var categorie = categorieVehiculeMission_(info.sousChemin);
        // (ADR-0044) Dossiers COMMUNS — évalués AVANT toute attribution à un véhicule, y compris
        // avant le repli par date : ce sont précisément les cas où aucun véhicule ne doit être
        // deviné. `sousDossier: ''` : ces dossiers sont plats, pas de catégorie sous eux.
        var commun = communVehiculeDepuisSource_(info.sousChemin);
        if (commun) return { cibleParentId: IDS.vehiculeCible, cibleNom: commun, sousDossier: '' };
        // Une voiture LOUÉE n'est pas un véhicule de Marc : elle ne doit polluer ni Fiesta, ni
        // Jetta, ni Toyota bZ — même si le contrat nomme un modèle. D'où ce test AVANT le nom.
        if (estLocationVehicule_(nom)) {
          return { cibleParentId: IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' };
        }
        // Le VÉHICULE : sous-dossier d'origine, sinon le nom du fichier,
        // sinon — pour un document daté, si le jeu de fenêtres est COMPLET — la fenêtre de
        // possession si UNE SEULE le contient (chevauchement/jeu incomplet = refus, jamais deviné).
        var vehicule = vehiculeDuNom_(info.sousChemin) || vehiculeDuNom_(nom);
        if (vehicule) {
          return { cibleParentId: IDS.vehiculeCible, cibleNom: vehicule, sousDossier: categorie };
        }
        if (!ctx.fenetresCompletes) return null;
        var parFenetre = logementParDate_(nom, ctx.fenetres); // générique : fenêtres + dates (id de cible)
        return parFenetre ? { cibleId: parFenetre, sousDossier: categorie } : null;
      },
    },
    {
      tag: 'logement', cle: 'mission-logement',
      // c49-2 (ADR-0040 §3b) : + le SPLIT LCP — `Logement/LCP Groupe Immobilier` (même logement
      // que « 3325 4e avenue », prouvé par contenu) se draine vers l'adresse, sous-dossiers
      // homonymes fusionnés (segment préservé → find-or-create par nom).
      sources: [IDS.logementsPluriel, IDS.lcpLogementDouble],
      batirCtx: function () { return { cibles: ciblesLogement_() }; },
      router: function (nom, info, ctx) {
        if (info.sourceId === IDS.lcpLogementDouble) {
          return { cibleId: IDS.logement3325, sousDossier: info.sousChemin };
        }
        // Adresse dans le chemin/nom, sinon la table BAILLEUR (ADR-0040 §2 — les documents de
        // logement sont nommés par bailleur, jamais par adresse ; entrées prouvées par contenu).
        var c = apparierUnique_(info.sousChemin || nom, ctx.cibles) || apparierUnique_(nom, ctx.cibles) ||
          cibleBailleur_(nom, ctx.cibles);
        return c ? { cibleId: c.id, sousDossier: '' } : null;
      },
    },
    {
      tag: 'dispatch03', cle: 'mission-dispatch-03',
      sources: [IDS.contrats03, IDS.correspondance03, IDS.assuranceHab03, IDS.energieServices03],
      batirCtx: function () {
        var logements = ciblesLogement_();
        return {
          logements: logements,
          fenetres: fenetresOccupation_(logements),
          themePar: (function () { // le sous-dossier de destination LOGEMENT = le thème du dossier source
            var m = {};
            m[IDS.contrats03] = 'Contrats';
            m[IDS.correspondance03] = 'Correspondance';
            m[IDS.assuranceHab03] = 'Assurance habitation';
            m[IDS.energieServices03] = 'Énergie & services';
            return m;
          })(),
          // c49-2 : côté VÉHICULE, le thème se traduit dans le vocabulaire des CATÉGORIES de
          // Marc (ADR-0040 §3a) — un contrat d'achat va en « Recherche & achat », une assurance
          // auto en « Assurance auto » ; correspondance/énergie n'ont pas d'équivalent → à plat.
          themeVehiculePar: (function () {
            var m = {};
            m[IDS.contrats03] = 'Recherche & achat';
            m[IDS.assuranceHab03] = 'Assurance auto';
            return m;
          })(),
        };
      },
      router: function (nom, info, ctx) {
        var theme = ctx.themePar[info.sourceId] || '';
        // 0. LOCATION de véhicule (ADR-0044) — AVANT le nom : une voiture louée n'est pas un
        //    véhicule de Marc, même si le contrat en nomme le modèle. Les 3 contrats Enterprise
        //    dormaient ici, dans « 03 · Contrats ». MÊME prédicat que la mission véhicule
        //    (« une seule règle, deux consommateurs » — leçon §7).
        if (estLocationVehicule_(nom)) {
          return { cibleParentId: CONFIG.MISSIONS_IDS.vehiculeCible, cibleNom: 'Locations', sousDossier: '' };
        }
        // 1. Véhicule nommé dans le fichier — par la TABLE canonique (« une seule règle » avec
        //    mission-vehicule ; une cible peut être CRÉÉE si le dossier n'existe pas encore).
        var v = vehiculeDuNom_(nom);
        if (v) {
          return { cibleParentId: CONFIG.MISSIONS_IDS.vehiculeCible, cibleNom: v,
            sousDossier: ctx.themeVehiculePar[info.sourceId] || '' };
        }
        // 2. Adresse nommée dans le fichier.
        var l = apparierUnique_(nom, ctx.logements);
        if (l) return { cibleId: l.id, sousDossier: theme };
        // 2 bis (c49-2). BAILLEUR nommé dans le fichier (ADR-0040 §2 : les bails sont nommés par
        //    bailleur, jamais par adresse — table prouvée par contenu).
        var b = cibleBailleur_(nom, ctx.logements);
        if (b) return { cibleId: b.id, sousDossier: theme };
        // 3. Correspondance sans indice : la DATE tranche si elle tombe dans EXACTEMENT une
        //    fenêtre d'occupation (demande Marc « regarde les dates pour déterminer »).
        if (info.sourceId === CONFIG.MISSIONS_IDS.correspondance03) {
          var parDate = logementParDate_(nom, ctx.fenetres);
          if (parDate) return { cibleId: parDate, sousDossier: theme };
        }
        return null;
      },
      // Revue finale C28-51 : les 4 sources (Contrats, Correspondance, Assurance habitation,
      // Énergie & services) sont des nœuds PÉRENNES de la table du flux (les filets de 03) —
      // vidées à la convergence, elles ne sont JAMAIS peintes en rouge : Marc les supprimerait
      // et le flux les recréerait par nom au prochain document (ping-pong, leçon paies/impots).
      sourcesJetables: [],
    },
    {
      tag: 'archives06', cle: 'mission-archives-06',
      sources: (IDS.archives06 || []).map(function (p) { return p.src; }),
      batirCtx: function () {
        var parSource = {};
        (IDS.archives06 || []).forEach(function (p) { parSource[p.src] = p.cible; });
        return { parSource: parSource };
      },
      router: function (nom, info, ctx) {
        // Table d'alias EXPLICITE (ADR-0039) : la source désigne l'archive, le contenu part en bloc
        // (un niveau de sous-dossier préservé). Pas d'alias = pas une source = jamais deviné.
        var cible = ctx.parSource[info.sourceId];
        return cible ? { cibleId: cible, sousDossier: info.sousChemin } : null;
      },
      // Après le transfert, le flux vivant doit VISER l'archive, pas le dossier vidé (sinon il
      // re-remplit ce que la mission vide — leçon §7 « référentiel consulté par les deux »).
      // PEUT LEVER, volontairement (revue sécurité C28-49) : un échec doit EMPÊCHER le drapeau
      // FINI pour être re-tenté à la passe suivante — `repointerEntites_` est idempotent (une
      // ligne déjà re-pointée ne matche plus la source), rejouer la boucle est sans danger.
      apresConvergence: function () {
        (IDS.archives06 || []).forEach(function (p) { repointerEntites_(p.src, p.cible); });
      },
    },
    /* ---- PR2 : Carrière + Finances (brief Marc §« paies / employeurs / impôts / années ») ---- */
    {
      // Paies éparses à la RACINE de « Revenus & paie » → un sous-dossier PAR EMPLOYEUR.
      // `profondeurPar` = 0 : les sous-dossiers d'employeur que la mission CRÉE ne sont jamais
      // son propre périmètre (sinon re-collecte de sa propre sortie à chaque passe).
      tag: 'paies', cle: 'mission-paies',
      sources: [IDS.revenusPaie],
      profondeurPar: (function () { var m = {}; m[IDS.revenusPaie] = 0; return m; })(),
      batirCtx: function () { return {}; },
      router: function (nom) {
        var emp = employeurDuNom_(nom);
        return emp ? { cibleParentId: IDS.revenusPaie, cibleNom: emp } : null;
      },
      // À la convergence : le rapport des MOIS MANQUANTS par employeur (demande explicite de
      // Marc « je n'ai absolument pas toutes les paies ») — onglet `RapportPaies`, self-serve.
      // Peut lever (comme le re-pointage archives06) : pas de FINI sans rapport écrit.
      // `convergenceApres` (revue quotas PR2) : `carriere` et `annees02` alimentent ENCORE
      // « Revenus & paie » pendant des jours — écrire le rapport avant leur fin le FIGERAIT sur
      // des « mois manquants » qu'elles vont combler (donnée MOUVANTE, corollaire C28-49). La
      // mission draine sans attendre ; seule sa CONVERGENCE (et donc le rapport) attend.
      convergenceApres: ['carriere', 'annees02'],
      apresConvergence: function () { ecrireRapportPaies_(); },
      sourcesJetables: [], // « Revenus & paie » est PÉRENNE : jamais peinte en rouge
    },
    {
      // Employeurs/<X> (vrac plat) + racine 05 (ex-dump Automatech) + fusion Recherche d'emploi.
      tag: 'carriere', cle: 'mission-carriere',
      sources: [IDS.employeursRobovic, IDS.employeursAutomatech, IDS.carriereRacine, IDS.rechercheEmploi],
      // Racine 05 : SEULS ses fichiers à plat sont le périmètre — ses sous-dossiers (Employeurs,
      // CV & lettres, Réseaux…) sont des structures, jamais recollectés.
      profondeurPar: (function () { var m = {}; m[IDS.carriereRacine] = 0; return m; })(),
      batirCtx: function () {
        var parSource = {};
        parSource[IDS.employeursRobovic] = 'Robovic';
        parSource[IDS.employeursAutomatech] = 'Automatech';
        return { employeurParSource: parSource };
      },
      router: function (nom, info, ctx) { return routerCarriere_(nom, info, ctx); },
      // Employeurs/<X> et la racine 05 sont PÉRENNES (revue quotas PR2 : peindre un sous-dossier
      // de structure momentanément vide dirait « supprimable » à tort) ; seule la source de la
      // FUSION est jetable.
      sourcesJetables: [IDS.rechercheEmploi],
    },
    {
      // Les 12 dossiers-années de 02 → les bons sous-dossiers thématiques (table type → cible).
      tag: 'annees02', cle: 'mission-annees-02',
      sources: (IDS.annees02 || []).map(function (p) { return p.id; }),
      batirCtx: function () {
        var anneePar = {};
        (IDS.annees02 || []).forEach(function (p) { anneePar[p.id] = p.annee; });
        return { anneePar: anneePar };
      },
      router: function (nom, info, ctx) { return routerFinance02_(nom, ctx.anneePar[info.sourceId] || ''); },
    },
    {
      // Racine d'« Impôts & déclarations » → sous-dossier par ANNÉE (année du nom du fichier).
      tag: 'impots', cle: 'mission-impots',
      sources: [IDS.impotsDeclarations],
      profondeurPar: (function () { var m = {}; m[IDS.impotsDeclarations] = 0; return m; })(),
      batirCtx: function () { return {}; },
      router: function (nom) {
        var annee = anneeDuNomMission_(nom);
        return annee ? { cibleParentId: IDS.impotsDeclarations, cibleNom: annee } : null;
      },
      sourcesJetables: [], // « Impôts & déclarations » est PÉRENNE : jamais peinte
    },
  ];
}

/* ================= Fonctions PURES (appariement, dates, jetons) ================= */

/** Mots d'adresse/génériques qui ne DISCRIMINENT pas une cible (jamais des jetons). */
var MOTS_OUTILS_MISSIONS = {
  avenue: true, ave: true, rue: true, route: true, rte: true, boulevard: true, boul: true,
  quebec: true, montreal: true, canada: true, appartement: true, app: true, apt: true,
};

/** Normalise pour l'appariement : minuscules, sans accents, séparateurs unifiés. PURE. */
function normaliserMission_(texte) {
  return String(texte || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // diacritiques en échappé (revue : lisible, robuste au copier-coller)
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Jetons DISCRIMINANTS d'un nom de cible : les NOMBRES toujours (un n° civique identifie une
 * adresse), les mots ≥ 4 lettres hors mots-outils. PURE (testée).
 * @param {string} nom
 * @return {string[]}
 */
function jetonsCible_(nom) {
  return normaliserMission_(nom).split(' ').filter(function (t) {
    if (!t) return false;
    // ≥ 3 chiffres (revue code) : à 2 chiffres, un n° d'appartement matcherait les composants
    // JJ/MM résiduels d'une date en plein nom (le préfixe est retiré, pas une date citée ailleurs).
    if (/^\d+$/.test(t)) return t.length >= 3;
    if (/^\d/.test(t)) return false;                   // ordinaux d'adresse (« 4e », « 3e ») : jamais discriminants
    return t.length >= 4 && !MOTS_OUTILS_MISSIONS[t];
  });
}

/**
 * Apparie un texte à UNE SEULE cible : au moins un jeton discriminant présent en MOT ENTIER, et
 * pas d'ambiguïté (deux cibles qui matchent ⇒ null — on ne devine jamais, ADR-0039). PURE (testée).
 *
 * MOT ENTIER seulement (revues quotas + sécurité C28-49) : un match par sous-chaîne non ancrée
 * (« mont » dans « montreal », « 783 » dans « 7834 ») produirait un faux appariement UNIQUE —
 * fichier déplacé au MAUVAIS endroit avec une clé de SUCCÈS : parti de la source, même un bump
 * de version ne le ré-évaluerait jamais. La normalisation transforme toute ponctuation en
 * espaces, donc les frontières de mots existent toujours.
 * @param {string} texte
 * @param {Array<{nom:string, id:string, jetons:string[]}>} cibles
 * @return {?{nom:string, id:string}}
 */
function apparierUnique_(texte, cibles) {
  // Le préfixe de date `AAAA-MM[-JJ]` est RETIRÉ avant l'appariement (revue code) : normalisé, il
  // devient « 2024 05 12 » — un jeton NUMÉRIQUE de cible pourrait matcher un composant de date.
  var n = ' ' + normaliserMission_(String(texte || '').replace(/^\d{4}-\d{2}(-\d{2})?/, '')) + ' ';
  var trouve = null;
  for (var i = 0; i < (cibles || []).length; i++) {
    var c = cibles[i];
    var touche = (c.jetons || []).some(function (j) { return n.indexOf(' ' + j + ' ') !== -1; });
    if (!touche) continue;
    if (trouve && trouve.id !== c.id) return null; // ambigu
    trouve = c;
  }
  return trouve;
}

/** Date (ms) du préfixe `AAAA-MM[-JJ]` d'un nom classé ; null sinon. PURE (testée). */
function dateDuNomMission_(nom) {
  var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(nom || ''));
  if (!m) return null;
  var ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 15));
  return isNaN(ts) ? null : ts;
}

/**
 * Choisit le logement dont la FENÊTRE d'occupation contient la date du nom — seulement si la date
 * tombe dans EXACTEMENT une fenêtre (chevauchement ⇒ null). PURE (testée).
 * @param {string} nom
 * @param {Array<{id:string, min:number, max:number}>} fenetres
 * @return {?string} id du logement
 */
function logementParDate_(nom, fenetres) {
  var ts = dateDuNomMission_(nom);
  if (ts === null) return null;
  var trouve = null;
  for (var i = 0; i < (fenetres || []).length; i++) {
    var f = fenetres[i];
    if (ts >= f.min && ts <= f.max) {
      if (trouve) return null; // deux fenêtres possibles → on ne devine pas
      trouve = f.id;
    }
  }
  return trouve;
}

/* ================= Fonctions PURES PR2 (employeurs, types, routage 02/05) ================= */

/**
 * Employeur CANONIQUE d'un nom de fichier (`CONFIG.MISSIONS_EMPLOYEURS`, mot entier, préfixe de
 * date retiré par `apparierUnique_`). Ambigu ou hors table ⇒ null (jamais deviné). PURE (testée).
 * @param {string} nom
 * @return {?string} nom canonique du sous-dossier (« Robovic », « Automatech », « CIUSSS »)
 */
function employeurDuNom_(nom) {
  var cibles = (CONFIG.MISSIONS_EMPLOYEURS || []).map(function (e) {
    return { nom: e.nom, id: e.nom, jetons: e.jetons };
  });
  var c = apparierUnique_(nom, cibles);
  return c ? c.nom : null;
}

/* ================= Fonctions PURES C28-51 / c49-2 (bailleurs, véhicules) ================= */

/**
 * Véhicule CANONIQUE d'un texte (`CONFIG.MISSIONS_VEHICULES`, mot entier). Ambigu ou hors table ⇒
 * null. Le canon sert de NOM de cible (find-or-create : KIA n'existait pas). PURE (testée).
 * @param {string} texte  nom de fichier OU sous-dossier d'origine
 * @return {?string}
 */
function vehiculeDuNom_(texte) {
  var cibles = (CONFIG.MISSIONS_VEHICULES || []).map(function (v) {
    return { nom: v.nom, id: v.nom, jetons: v.jetons };
  });
  var c = apparierUnique_(texte, cibles);
  return c ? c.nom : null;
}

/**
 * Dossier COMMUN sous « Véhicule » désigné par le sous-dossier SOURCE (ADR-0044). PURE (testée).
 * Ex. tout ce qui vient de « Véhicules/KIA/… » part dans « Véhicule/Recherche & achat », parce que
 * KIA n'est PAS un véhicule de Marc. Sans ce court-circuit, ces documents tomberaient dans le repli
 * par DATE et seraient rangés sous le véhicule possédé à l'époque — un faux positif DÉFINITIF
 * (déplacé + clé de succès), exactement le cas que la leçon « l'asymétrie des verdicts commande la
 * sévérité du prédicat » interdit.
 * @param {string} sousChemin  chemin source relatif (le 1er segment porte le dossier d'origine)
 * @return {string} nom du dossier commun, ou '' si aucun
 */
function communVehiculeDepuisSource_(sousChemin) {
  var segments = String(sousChemin || '').split('/');
  var premier = normaliserMission_(segments[0] || '');
  if (!premier) return '';
  var communs = CONFIG.MISSIONS_VEHICULE_COMMUNS || [];
  for (var i = 0; i < communs.length; i++) {
    var srcs = communs[i].sources || [];
    for (var j = 0; j < srcs.length; j++) {
      if (normaliserMission_(srcs[j]) === premier) return communs[i].nom;
    }
  }
  return '';
}

// Mots qui prouvent qu'il s'agit d'un VÉHICULE (et pas d'un logement).
var MISSIONS_MOTS_VEHICULE = ['vehicule', 'auto', 'autos', 'voiture', 'automobile'];

// ⚠️ PAS de liste de marques de loueurs. Le premier jet en contenait une — avec « Avis », qui est
// un LOUEUR mais surtout un mot français des plus courants : « Avis de séjour », « Avis de
// paiement », « Avis d'imposition » seraient tous devenus des locations de voiture (attrapé par
// `reset.test.js`). « Budget » et « Discount » ont le même défaut. Les 3 contrats Enterprise réels
// du Drive de Marc portent tous « location » ET un mot de véhicule : la règle stricte ci-dessous
// suffit, et une liste de marques n'ajouterait que du risque.

/**
 * Vrai si le document est une LOCATION de véhicule (ADR-0044) — destination : « Véhicule/Locations ».
 * PURE (testée).
 *
 * PRÉDICAT STRICT, et il DOIT l'être : « location » tout seul est un piège avéré dans ce Drive —
 * « Formulaire de demande de location_CORPIQ » est un document de LOGEMENT. On exige donc le mot
 * « location » ACCOMPAGNÉ d'un mot de véhicule, ou une marque de loueur reconnue. Dans le doute :
 * faux (le fichier reste en place et sera re-examiné), jamais un déplacement au hasard.
 * @param {string} nom
 * @return {boolean}
 */
function estLocationVehicule_(nom) {
  var n = normaliserMission_(nom);
  if (!n) return false;
  var mots = n.split(' ');
  var aMot = function (liste) {
    for (var i = 0; i < mots.length; i++) if (liste.indexOf(mots[i]) !== -1) return true;
    return false;
  };
  return aMot(['location', 'locations']) && aMot(MISSIONS_MOTS_VEHICULE);
}

/**
 * Cible de LOGEMENT désignée par le BAILLEUR du nom (ADR-0040 §2 : les documents de logement
 * sont nommés par bailleur, jamais par adresse — chaque entrée de `MISSIONS_BAILLEURS` est
 * PROUVÉE par contenu). Le canon est le NOM RÉEL du dossier : résolu PAR NOM parmi les cibles
 * fournies — dossier renommé/absent ⇒ null (refus, jamais un doublon créé). PURE (testée).
 * @param {string} nom
 * @param {Array<{nom:string,id:string}>} cibles  les enfants réels de « Logement »
 * @return {?{nom:string,id:string}}
 */
function cibleBailleur_(nom, cibles) {
  var canon = logementDuBailleur_(nom);
  if (!canon) return null;
  for (var i = 0; i < (cibles || []).length; i++) {
    if (cibles[i].nom === canon) return cibles[i];
  }
  return null;
}

/**
 * Nom CANONIQUE du logement désigné par le bailleur d'un texte — LA règle partagée missions ↔
 * flux (`cheminCibleReset_` 03, geste symétrique ADR-0040 §3c). Ambigu/hors table ⇒ null. PURE.
 * @param {string} texte
 * @return {?string}
 */
function logementDuBailleur_(texte) {
  var entrees = (CONFIG.MISSIONS_BAILLEURS || []).map(function (b) {
    return { nom: b.logement, id: b.logement, jetons: b.jetons };
  });
  var e = apparierUnique_(texte, entrees);
  return e ? e.nom : null;
}

/**
 * Catégorie de véhicule d'un sous-dossier SOURCE (« Contraventions », « Assurance auto »… —
 * `MISSIONS_CATEGORIES_VEHICULE`, comparaison NORMALISÉE). Hors liste ⇒ '' (à plat). PURE (testée).
 * @param {string} sousChemin
 * @return {string}
 */
function categorieVehiculeMission_(sousChemin) {
  var n = normaliserMission_(String(sousChemin || ''));
  if (!n) return '';
  var cats = CONFIG.MISSIONS_CATEGORIES_VEHICULE || [];
  for (var i = 0; i < cats.length; i++) {
    if (normaliserMission_(cats[i]) === n) return cats[i];
  }
  return '';
}

/**
 * Segment TYPE d'un nom classé `AAAA-MM[-JJ]_Type_Émetteur.ext`, normalisé. '' si le nom ne suit
 * pas la convention (pas de préfixe de date). PURE (testée). Le routage 02/05 décide sur CE
 * segment — jamais sur le nom complet, où l'ÉMETTEUR créerait des collisions (« Banque CIC »
 * matcherait « banque » alors que le document est un relevé d'impôt).
 * @param {string} nom
 * @return {string}
 */
function typeDuNomMission_(nom) {
  var m = /^\d{4}(?:-\d{2}){0,2}_([^_]+)/.exec(String(nom || ''));
  return m ? normaliserMission_(m[1]) : '';
}

/** Année en tête d'un nom (`AAAA-…` ou `AAAA_…`) — plausibilité par LA règle partagée
 * `anneePlausible_` (Reset.gs — une seule fenêtre flux ↔ missions). PURE (testée). */
function anneeDuNomMission_(nom) {
  var m = /^(\d{4})[-_]/.exec(String(nom || ''));
  return m && anneePlausible_(m[1]) ? m[1] : null;
}

/** Vrai si le segment type contient l'un des mots donnés (mot entier sur le segment). PURE. */
function typeContient_(typeNormalise, mots) {
  var t = ' ' + typeNormalise + ' ';
  return (mots || []).some(function (mot) { return t.indexOf(' ' + mot + ' ') !== -1; });
}

/** Mots-clés fiscaux du segment type (ordre AVANT « relevé » générique — « relevé d'impôt » est fiscal). */
var TYPES_FISCAUX_MISSIONS = ['t4', 'impot', 'impots', 'cotisation', 'declaration', 'feuillet', 'fiscal', 'fiscale'];

/**
 * Routage d'un fichier de dossier-ANNÉE de 02 (table type → cible, brief Marc). L'année de la
 * cible fiscale = l'année du NOM si présente, sinon celle du dossier source. Type hors table ⇒
 * null (laissé + rapporté). PURE (testée).
 * @param {string} nom
 * @param {string} anneeSource  nom du dossier-année d'origine (repli)
 * @return {?Object}
 */
function routerFinance02_(nom, anneeSource) {
  var IDS = CONFIG.MISSIONS_IDS;
  var type = typeDuNomMission_(nom);
  if (!type) return null; // nom hors convention : on ne décide pas sur du bruit
  // 1. Paies → « Revenus & paie »/<Employeur> — prédicat PARTAGÉ avec le flux (`estTypePaieReset_`,
  //    revue finale PR2 : la liste locale ['paie','paye'] ratait « salaire » que le flux couvre —
  //    un « Bulletin de salaire » aurait été déplacé au mauvais endroit à clé de SUCCÈS).
  if (estTypePaieReset_(type)) {
    var emp = employeurDuNom_(nom);
    return emp ? { cibleParentId: IDS.revenusPaie, cibleNom: emp } : null;
  }
  // 2. Fiscal → « Impôts & déclarations »/<année> (AVANT le « relevé » générique : un relevé
  //    d'impôt est fiscal, pas bancaire). RL-1/RL-31 par le prédicat PARTAGÉ (revue finale PR2 :
  //    la table de mots ne peut pas exprimer « releve 1 » ancré — le feuillet partait en Relevés).
  if (estFeuilletFiscalReset_(type) || typeContient_(type, TYPES_FISCAUX_MISSIONS)) {
    var annee = anneeDuNomMission_(nom) || anneeSource;
    return annee ? { cibleParentId: IDS.impotsDeclarations, cibleNom: annee } : null;
  }
  // 3. Relevés / reçus & factures : DANS LE BUCKET D'ANNÉE, par LA MÊME règle que le flux vivant
  //    (`resetBucketAnnee_` + STRUCTURE_CIBLE_RESET — revue code PR2 : deux règles écrites
  //    séparément divergent toujours, leçon C28-26 ; router à plat aurait créé un nouveau vrac à
  //    côté des buckets que le flux alimente).
  var anneeDoc = anneeDuNomMission_(nom) || anneeSource;
  var noeuds02 = STRUCTURE_CIBLE_RESET['02 · Finances'];
  // RIB (relevé d'IDENTITÉ bancaire) : des COORDONNÉES, pas un relevé de compte (prédicat partagé
  // — le flux le range en Banques/Coordonnées & chèques ; côté mission, hors table ⇒ refus keyé,
  // laissé + rapporté, jamais deviné).
  if (estRibReset_(type)) return null;
  if (typeContient_(type, ['releve', 'releves'])) {
    return { cibleId: IDS.releves02, sousDossier: resetBucketAnnee_(anneeDoc, noeuds02['Relevés']) };
  }
  if (typeContient_(type, ['recu', 'recus', 'facture', 'factures'])) {
    return { cibleId: IDS.recusFactures02, sousDossier: resetBucketAnnee_(anneeDoc, noeuds02['Reçus & factures']) };
  }
  if (typeContient_(type, ['assurance', 'assurances'])) return { cibleId: IDS.assurances02 };
  return null;
}

/** Sous-dossier d'« Employeurs/<X> » par TYPE (table explicite — type inconnu ⇒ ''). PURE. */
function sousDossierEmployeur_(typeNormalise) {
  if (typeContient_(typeNormalise, ['contrat', 'contrats'])) return 'Contrats';
  if (typeContient_(typeNormalise, ['attestation', 'attestations', 'lettre'])) return 'Attestations & lettres';
  if (typeContient_(typeNormalise, ['formulaire', 'formulaires', 'autorisation'])) return 'Formulaires';
  if (typeContient_(typeNormalise, ['evaluation', 'evaluations'])) return 'Évaluations';
  return '';
}

/**
 * Routage de la mission CARRIÈRE. PURE (testée). Par source :
 *  - `Recherche d'emploi` → fusion EN BLOC vers « CV & lettres » (segment préservé) ;
 *  - `Employeurs/<X>` : une PAIE part vers 02/« Revenus & paie »/<X> (le domicile UNIQUE des
 *    paies — décision Marc) ; un type de la table → sous-dossier ; type inconnu → refus (laissé
 *    à plat + rapporté, jamais deviné) ;
 *  - racine 05 (ex-dump Automatech) : l'ÉMETTEUR (mot entier) désigne l'employeur ; un CV/lettre
 *    de motivation part vers « CV & lettres » ; sans indice → refus.
 */
function routerCarriere_(nom, info, ctx) {
  var IDS = CONFIG.MISSIONS_IDS;
  if (info.sourceId === IDS.rechercheEmploi) {
    return { cibleId: IDS.cvLettres, sousDossier: info.sousChemin };
  }
  var type = typeDuNomMission_(nom);
  var employeur = (ctx.employeurParSource || {})[info.sourceId] || employeurDuNom_(nom);
  if (typeContient_(type, ['cv', 'curriculum', 'motivation'])) {
    return { cibleId: IDS.cvLettres };
  }
  if (!employeur) return null;
  // Prédicat PARTAGÉ avec le flux (« salaire » compris — revue finale PR2) : le domicile UNIQUE
  // des paies est 02, quelle que soit la graphie du type.
  if (estTypePaieReset_(type)) {
    return { cibleParentId: IDS.revenusPaie, cibleNom: employeur };
  }
  var dossierEmployeur = employeur === 'Robovic' ? IDS.employeursRobovic
    : employeur === 'Automatech' ? IDS.employeursAutomatech : null;
  if (!dossierEmployeur) return null; // employeur sans dossier sous 05 (ex. CIUSSS) : on ne crée pas
  var sous = sousDossierEmployeur_(type);
  // Depuis la RACINE 05, un type inconnu mais un employeur SÛR va au moins dans son dossier (à
  // plat) — c'est l'enrichissement demandé (le dump ex-Automatech re-rangé). DEPUIS Employeurs/<X>
  // même, un type inconnu reste où il est (refus) : le déplacer « à plat » serait un no-op déguisé.
  if (!sous && info.sourceId !== IDS.carriereRacine) return null;
  return { cibleId: dossierEmployeur, sousDossier: sous };
}

/* ================= Rapport des paies (onglet self-serve) ================= */

/**
 * Mois manquants par employeur, depuis les noms `AAAA-MM_Paie_…` observés. PURE (testée) :
 * pour chaque employeur, la couverture va du premier au dernier mois OBSERVÉ — un trou = un mois
 * sans aucune paie. (On ne devine pas les bornes d'emploi : avant la première paie connue et
 * après la dernière, rien n'est « manquant ».)
 * @param {Object} parEmployeur  { employeur: ['2025-06', '2025-08', …] }
 * @return {Array<{employeur:string, presents:number, manquants:string[]}>}
 */
function moisManquantsPaies_(parEmployeur) {
  return Object.keys(parEmployeur || {}).sort().map(function (emp) {
    var mois = {};
    (parEmployeur[emp] || []).forEach(function (m) {
      // PLAUSIBILITÉ (revue quotas PR2) : sans elle, UN nom aberrant (« 0215-… », mois « 27 » —
      // une date OCR ratée suffit) créait des dizaines de milliers de « mois manquants », un
      // `join` > 50 Ko, un `setValues` qui lève… re-tenté à chaque tick. Même plage d'années que
      // `anneeDuNomMission_` (une seule règle).
      var p = /^(\d{4})-(\d{2})$/.exec(m);
      if (!p) return;
      var moisNum = Number(p[2]);
      if (anneePlausible_(p[1]) && moisNum >= 1 && moisNum <= 12) mois[m] = true;
    });
    var tries = Object.keys(mois).sort();
    var manquants = [];
    if (tries.length > 1) {
      var courant = tries[0];
      while (courant < tries[tries.length - 1]) {
        var a = Number(courant.slice(0, 4)), m = Number(courant.slice(5, 7));
        m += 1; if (m > 12) { m = 1; a += 1; }
        courant = a + '-' + (m < 10 ? '0' + m : m);
        if (!mois[courant] && courant < tries[tries.length - 1]) manquants.push(courant);
      }
    }
    return { employeur: emp, presents: tries.length, manquants: manquants };
  });
}

// En-tête de l'onglet `RapportPaies` — constante PARTAGÉE (revue C28-53 🟡) : consommée par
// `initialiserSheet_` (Journal.gs, création) ET la réparation d'en-tête ci-dessous (point
// d'écriture). Deux littéraux qui doivent rester identiques se verrouillent par une constante,
// jamais par la discipline (leçon §7).
var COLONNES_RAPPORT_PAIES = ['Employeur', 'Mois présents', 'Mois manquants (nb)', 'Mois manquants'];

/**
 * Écrit l'onglet `RapportPaies` (une ligne par employeur : couverture + mois manquants) depuis
 * l'état RÉEL de « Revenus & paie »/<Employeur>. Appelée à la CONVERGENCE de la mission paies
 * (peut lever → pas de FINI sans rapport, comme le re-pointage archives06). Bornée : ≤ 300
 * fichiers lus par employeur, pur `getName()`.
 */
function ecrireRapportPaies_() {
  var parEmployeur = {};
  var it = DriveApp.getFolderById(CONFIG.MISSIONS_IDS.revenusPaie).getFolders();
  var sousDossiersLus = 0;
  while (it.hasNext()) {
    if (++sousDossiersLus > 20) break; // borne de symétrie (revue quotas) — 3 employeurs attendus
    var d = it.next();
    var mois = [];
    var fs = d.getFiles();
    var lus = 0;
    while (fs.hasNext() && lus < 300) {
      var m = /^(\d{4}-\d{2})/.exec(fs.next().getName());
      lus++;
      if (m) mois.push(m[1]);
    }
    parEmployeur[d.getName()] = mois;
  }
  var lignes = moisManquantsPaies_(parEmployeur);
  var f = feuille_('RapportPaies');
  // Réparation d'en-tête AU POINT D'ÉCRITURE (leçon « point d'attache », 2026-08-13) — jamais
  // dans initialiserSheet_ (code mort pour un onglet déjà créé).
  if (String(f.getRange('A1').getValue()) !== 'Employeur') {
    f.getRange(1, 1, 1, COLONNES_RAPPORT_PAIES.length).setValues([COLONNES_RAPPORT_PAIES]);
    f.setFrozenRows(1);
  }
  var valeurs = lignes.map(function (l) {
    // Cellule bornée (revue quotas) : la LISTE s'affiche tronquée, le COMPTE reste exact.
    var texte = l.manquants.join(', ');
    if (texte.length > 1000) texte = texte.slice(0, 1000) + '… (' + l.manquants.length + ' au total)';
    return [l.employeur, l.presents, l.manquants.length, texte];
  });
  if (valeurs.length) f.getRange(2, 1, valeurs.length, 4).setValues(valeurs);
  var dern = f.getLastRow();
  if (dern > valeurs.length + 1) {
    f.getRange(valeurs.length + 2, 1, dern - valeurs.length - 1, 4).clearContent();
  }
  journalInfo_('Missions', 'RapportPaies écrit : ' + lignes.map(function (l) {
    return l.employeur + ' ' + l.presents + ' mois, ' + l.manquants.length + ' manquant(s)';
  }).join(' · '));
}

/* ================= I/O bornées (contextes, collecte, peinture) ================= */

/**
 * Cibles de LOGEMENT : les enfants de « Logement » SANS le double LCP (ADR-0040 §3b). Sans ce
 * filtre, les jetons dérivés du nom du double (« groupe », « immobilier ») capteraient les
 * documents LCP AVANT la table bailleur — et re-rempliraient le dossier que la mission vide
 * (le split même qu'on corrige). Le double n'est ni une cible d'appariement, ni une fenêtre.
 */
function ciblesLogement_() {
  var double_ = CONFIG.MISSIONS_IDS.lcpLogementDouble;
  return ciblesAvecJetons_(CONFIG.MISSIONS_IDS.logementCible, {}).filter(function (c) {
    return c.id !== double_;
  });
}

/** Enfants-dossiers d'une cible, avec leurs jetons (+ extras par nom normalisé). */
function ciblesAvecJetons_(parentId, extras) {
  var cibles = [];
  var it = DriveApp.getFolderById(parentId).getFolders();
  while (it.hasNext()) {
    var d = it.next();
    var nom = d.getName();
    var jetons = jetonsCible_(nom).concat((extras || {})[normaliserMission_(nom)] || []);
    cibles.push({ nom: nom, id: d.getId(), jetons: jetons });
  }
  return cibles;
}

/**
 * Fenêtres d'occupation DÉRIVÉES des fichiers déjà classés dans chaque logement (min/max des dates
 * de noms, ± `MISSIONS_FENETRE_MARGE_MS`). Un logement sans fichier daté n'a pas de fenêtre (il
 * ne capte rien par date — prudence).
 *
 * SANS garde-temps, ASSUMÉ (revue sécurité C28-49) : la borne est STRUCTURELLE (≤ 100 noms lus
 * par logement × ~5 logements, pur `getName()` — quelques secondes au pire), et `batirCtx()` ne
 * tourne qu'une fois par run de mission NON convergée. Si un jour une mission a des cibles non
 * bornées, lui passer le garde — la promesse « garde à chaque item » de l'ADR vaut pour tout
 * parcours NON borné.
 * @param {Array<{nom:string,id:string}>} logements
 * @return {Array<{id:string,min:number,max:number}>}
 */
function fenetresOccupation_(logements, avecSousDossiers) {
  var fenetres = [];
  (logements || []).forEach(function (l) {
    try {
      var min = Infinity, max = -Infinity, lus = 0;
      var lire = function (dossier) {
        var it = dossier.getFiles();
        while (it.hasNext() && lus < 100) {
          var ts = dateDuNomMission_(it.next().getName());
          lus++;
          if (ts === null) continue;
          if (ts < min) min = ts;
          if (ts > max) max = ts;
        }
      };
      var racine = DriveApp.getFolderById(l.id);
      lire(racine);
      // UN niveau de sous-dossiers (revue finale C28-51, borne 100 fichiers PARTAGÉE) : la
      // mission vehicule range elle-même en CATÉGORIES — des fenêtres « à plat » seulement
      // s'assécheraient au fil de son propre drainage (fenêtres dérivées d'un état que l'amont
      // construit, leçon C28-49). Les logements y gagnent les mêmes dates (squelettes de Marc).
      if (avecSousDossiers) {
        var sous = racine.getFolders();
        while (sous.hasNext() && lus < 100) lire(sous.next());
      }
      if (min !== Infinity) {
        fenetres.push({ id: l.id, min: min - CONFIG.MISSIONS_FENETRE_MARGE_MS, max: max + CONFIG.MISSIONS_FENETRE_MARGE_MS });
      }
    } catch (e) { /* logement illisible → pas de fenêtre (aucun routage par date vers lui) */ }
  });
  return fenetres;
}

/**
 * Collecte les fichiers TRAITABLES d'une source (profondeur ≤ 2 : racine + un niveau de
 * sous-dossiers, `sousChemin` préservé). Filtres À LA COLLECTE (une page = du traitable
 * seulement) : clé d'idempotence absente, zone protégée exclue. Garde-temps À CHAQUE item.
 * @return {{items:Array, coupe:boolean}}  coupe = collecte interrompue (garde/plafond)
 */
function collecterMission_(sourceId, tag, garde, proteges, profondeurMax) {
  // PR2 : `profondeurMax` OPTIONNELLE par source (spec.profondeurPar). `0` = fichiers À PLAT
  // seulement — les sous-dossiers sont une STRUCTURE assumée hors périmètre (ex. la racine de
  // « Revenus & paie », dont les sous-dossiers d'employeur sont la SORTIE de la mission : les
  // recollecter serait boucler sur sa propre production), donc pas de drapeau « trop profond ».
  var borne = typeof profondeurMax === 'number' ? profondeurMax : CONFIG.MISSIONS_PROFONDEUR_MAX;
  var borneVoulue = typeof profondeurMax === 'number';
  var items = [], coupe = false, profond = false;
  var pousse = function (fichier, sousChemin) {
    if (items.length >= CONFIG.MISSIONS_MAX_PAR_RUN) { coupe = true; return false; }
    if (garde()) { coupe = true; return false; }
    var cle = cleMission_(tag, fichier.getId());
    if (indexContient_(cle)) return true; // déjà traité (succès OU refus versionné)
    items.push({ fichier: fichier, sousChemin: sousChemin, sourceId: sourceId });
    return true;
  };
  // RÉCURSIVE bornée (revue code : à profondeur ≤ 2, `Véhicules/<X>/<thème>/f.pdf` était INVISIBLE
  // et la mission se déclarait « terminée » en l'ignorant). `sousChemin` = PREMIER segment (le seul
  // niveau que les cibles préservent). Au-delà de la borne : signalé, et la passe reste INCOMPLÈTE
  // — jamais un « terminé » qui ignore des fichiers en silence.
  var descendre = function (dossier, premierSegment, profondeur) {
    if (profondeur > borne) {
      // Une borne VOULUE (profondeurPar) délimite le périmètre : rien d'anormal. La borne de
      // SÉCURITÉ par défaut, elle, signale (fichiers hors portée = mission maintenue ouverte).
      if (!borneVoulue) profond = true;
      return true;
    }
    var fs = dossier.getFiles();
    while (fs.hasNext()) { if (!pousse(fs.next(), premierSegment)) return false; }
    var ds = dossier.getFolders();
    while (ds.hasNext()) {
      if (garde()) { coupe = true; return false; }
      var sous = ds.next();
      if (!descendre(sous, premierSegment || sous.getName(), profondeur + 1)) return false;
    }
    return true;
  };
  try {
    var racine = DriveApp.getFolderById(sourceId);
    // Verdict de protection par DOSSIER, pas par fichier (revue quotas C28-49) : tous les fichiers
    // d'un même dossier partagent leur chaîne d'ancêtres — la vérifier PAR ITEM coûtait 3-5 RPC ×
    // items pour la même réponse. Un fichier MULTI-PARENTS dont l'AUTRE parent serait protégé
    // échappe à ce filtre de collecte : la re-vérif STRICTE par item avant mutation (§1) le bloque.
    if (aParentProtege_(racine, proteges, false)) return { items: items, coupe: coupe };
    descendre(racine, '', 0);
    if (profond) {
      journalErreur_('Missions', 'Source ' + sourceId + ' : arborescence plus profonde que ' +
        CONFIG.MISSIONS_PROFONDEUR_MAX + ' niveaux — fichiers hors portée, mission maintenue OUVERTE.');
      return { items: items, coupe: coupe, erreur: true };
    }
  } catch (e) {
    journalErreur_('Missions', 'Collecte impossible (source ' + sourceId + ') : ' + e);
    return { items: items, coupe: coupe, erreur: true }; // jamais « passe complète » sur une erreur
  }
  return { items: items, coupe: coupe };
}

/** Clé d'idempotence VERSIONNÉE (ADR-0039 — succès ET refus, re-évaluables par bump de version). */
function cleMission_(tag, fileId) {
  return 'mission|' + tag + '|' + CONFIG.MISSIONS_REGLES_VERSION + '|' + fileId;
}

/**
 * Peint un dossier en ROUGE (`folderColorRgb`) — signal « vidé, bon pour suppression » pour Marc.
 * Métadonnée RÉVERSIBLE, jamais une suppression. Best-effort (un échec ne remet rien en cause).
 */
function peindreDossierRouge_(folderId) {
  try {
    var rep = fetchDriveAvecRetry_(
      'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(folderId) + '?fields=id',
      {
        method: 'patch', contentType: 'application/json',
        payload: JSON.stringify({ folderColorRgb: CONFIG.MISSIONS_COULEUR_VIDE }),
        headers: { Authorization: 'Bearer ' + jetonDrive_() },
        muteHttpExceptions: true,
      }
    );
    if (rep.getResponseCode() !== 200) {
      journalInfo_('Missions', 'Peinture rouge refusée (HTTP ' + rep.getResponseCode() + ') pour ' + folderId);
    }
  } catch (e) { journalInfo_('Missions', 'Peinture rouge différée : ' + e); }
}

/** Vrai si le dossier est STRICTEMENT vide (aucun fichier, aucun sous-dossier non corbeillés). */
function estDossierVideMission_(dossier) {
  try { return !dossier.getFiles().hasNext() && !dossier.getFolders().hasNext(); }
  catch (e) { return false; } // illisible → on ne peint pas (prudence)
}

/**
 * À la CONVERGENCE : peint en rouge la source + ses sous-dossiers directs devenus vides.
 * BEST-EFFORT one-shot (assumé, revue quotas) : exécutée APRÈS le drapeau FINI — un PATCH raté
 * (403 quota Drive) laisse un dossier non peint, sans jamais remettre en cause la mission ; Marc
 * voit de toute façon les dossiers vides dans l'app (constat `vide-candidat`). Bornée par le
 * `garde` : une source à très nombreux sous-dossiers ne file jamais vers le mur des 6 min.
 */
function peindreSourcesVides_(sources, garde) {
  (sources || []).forEach(function (id) {
    if (garde && garde()) return;
    try {
      var racine = DriveApp.getFolderById(id);
      var ds = racine.getFolders();
      while (ds.hasNext()) {
        if (garde && garde()) return;
        var sous = ds.next();
        if (estDossierVideMission_(sous)) peindreDossierRouge_(sous.getId());
      }
      if (estDossierVideMission_(racine)) peindreDossierRouge_(id);
    } catch (e) { journalInfo_('Missions', 'Peinture de la source ' + id + ' différée : ' + e); }
  });
}

/* ================= Compteurs (Progression) & budget quotidien ================= */

/** Consommation du budget QUOTIDIEN partagé des missions (`AAAA-MM-JJ|ms`). PUR sur props. */
function budgetJourMissions_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_MISSIONS_JOUR') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/** Compteurs compacts par mission `{<tag>:{t,b,na}}` (~40 o/mission — loin des 9 Ko). */
function chargerEtatMissions_(props) {
  try { return JSON.parse(props.getProperty('DriveAI_MISSIONS_ETAT') || '{}') || {}; }
  catch (e) { return {}; }
}

/**
 * Gate de tick : `dispatch03` n'ouvre qu'après la convergence de `vehicule` ET `logement` (revue
 * code C28-49). Sans ça, ses verdicts NÉGATIFS se figent pendant que la DONNÉE mûrit : les
 * fenêtres d'occupation dérivent des fichiers que `mission-logement` est EN TRAIN d'ajouter, et
 * la cible « Toyota bZ » n'existe qu'après le premier move de `mission-vehicule` — une
 * correspondance refusée au jour 1 serait keyée alors que la fenêtre l'aurait routée au jour 3
 * (la version ne protège pas : c'est l'état Drive qui bouge, pas la table de règles).
 */
function gMissionsAmont03_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var v = CONFIG.MISSIONS_REGLES_VERSION;
    return props.getProperty('DriveAI_MISSION_FINI_vehicule') === v &&
      props.getProperty('DriveAI_MISSION_FINI_logement') === v
      ? null : 'en attente (missions 03)';
  } catch (e) { return 'en attente (missions 03)'; } // état illisible → prudence (un tick d'attente)
}

/** Gate de tick : budget quotidien des missions épuisé ? (raison de skip pour le suivi C28-44). */
function gMissionsJour_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return budgetJourMissions_(props, dateGmail_(new Date())) >= CONFIG.MISSIONS_BUDGET_JOUR_MS
      ? 'budget du jour épuisé' : null;
  } catch (e) { return null; } // état illisible : on laisse passer, le runner re-vérifie
}

/* ================= Runner ================= */

/**
 * Exécute UNE mission (une passe bornée par tick). Appelée par `etapeSuivie_` (Main.gs), donc
 * enveloppée — mais AUCUN throw attendu ici : chaque item dégrade en skip journalisé.
 * @param {string} tag
 * @param {function():boolean} estBudgetDepasse  garde standard (mur 4,5 min)
 */
function executerMission_(tag, estBudgetDepasse) {
  if (!CONFIG.MISSIONS_ACTIF) return;
  var spec = null;
  tableMissions_().forEach(function (m) { if (m.tag === tag) spec = m; });
  if (!spec) return;

  var props = PropertiesService.getScriptProperties();
  var version = CONFIG.MISSIONS_REGLES_VERSION;
  // Court-circuit TERMINAL : mission convergée = cette lecture + celle de la gate `gMissionsJour_`
  // (2 lectures Property par tick et par mission — chiffré en revue quotas, négligeable).
  if (props.getProperty('DriveAI_MISSION_FINI_' + tag) === version) return;

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = budgetJourMissions_(props, aujourdhui);
  if (consommeJour >= CONFIG.MISSIONS_BUDGET_JOUR_MS) return; // repris demain (gate + re-vérif)

  // FILET anti-brûlage (revue quotas C28-49) : une source en erreur PERMANENTE (dossier supprimé
  // par Marc, ID mal épinglé) rejouerait collecte + Journal À CHAQUE tick, jusqu'à 10 min/j à
  // vie, mission jamais « terminée ». Après MISSIONS_ERREURS_MAX runs consécutifs en erreur, on
  // ne réessaie plus qu'UNE fois par jour — et toute passe SAINE remet le compteur à zéro (un
  // blip transitoire ne fige jamais rien : « chemin de retour », §7).
  var etatM0 = chargerEtatMissions_(props);
  var m0 = etatM0[tag] || {};
  // Deux compteurs DISTINCTS : `err` (collecte) est remis à zéro par une passe saine ; `errC`
  // (après-convergence : rapport, re-pointage) ne l'est PAS — sinon chaque passe saine effacerait
  // le compteur juste avant que la convergence ne re-lève, et le filet ne s'armerait jamais.
  if (((m0.err || 0) >= CONFIG.MISSIONS_ERREURS_MAX || (m0.errC || 0) >= CONFIG.MISSIONS_ERREURS_MAX)
    && m0.errJour === aujourdhui) return;

  var debut = Date.now();
  var budgetRun = Math.min(CONFIG.MISSIONS_BUDGET_MS, CONFIG.MISSIONS_BUDGET_JOUR_MS - consommeJour);
  var garde = function () { return estBudgetDepasse() || (Date.now() - debut) > budgetRun; };

  try {
    var ctx = spec.batirCtx ? spec.batirCtx() : {};
    var proteges = ensembleDomainesProteges_();
    // DEUX drapeaux distincts (🔴 revue code) : `coupe` = garde/plafond ⇒ on ARRÊTE (le reste du
    // tick attend) ; `passeIncomplete` = un item transitoire / une source en erreur ⇒ on CONTINUE
    // les autres items et les autres sources (sinon un fichier POISON — « Access denied » permanent,
    // cas réel documenté — affame toutes les sources suivantes À VIE), mais la convergence est
    // bloquée pour ce run.
    var traites = 0, refus = 0, coupe = false, passeIncomplete = false, erreurCollecte = false;

    for (var s = 0; s < spec.sources.length && !coupe; s++) {
      var collecte = collecterMission_(spec.sources[s], tag, garde, proteges,
        (spec.profondeurPar || {})[spec.sources[s]]);
      coupe = coupe || collecte.coupe;
      if (collecte.erreur) { erreurCollecte = true; passeIncomplete = true; }
      for (var i = 0; i < collecte.items.length; i++) {
        if (garde()) { coupe = true; break; }
        var item = collecte.items[i];
        var resultat = traiterItemMission_(spec, item, ctx, proteges);
        if (resultat === 'fait') traites++;
        else if (resultat === 'refus') refus++;
        else passeIncomplete = true; // 'transitoire' : re-tenté au prochain run — on CONTINUE
      }
    }

    // Compteurs Progression : numérateur MONOTONE, base re-basable (jamais > 100 %) — le
    // « terminé » vient de la passe vide, jamais de `traites >= base` (leçon §7).
    var etatM = chargerEtatMissions_(props);
    var m = etatM[tag] || { t: 0, b: 0, na: 0 };
    // Les refus sont KEYÉS (plus jamais re-vus par la collecte) : leur compte est CUMULATIF, comme
    // les traités. Un bump de version rouvre leur ré-évaluation → le compte repart de zéro.
    if (m.v !== version) { m.na = 0; m.b = 0; m.v = version; }
    m.t += traites;
    m.na += refus;
    // BASE HONNÊTE (revue code : `t + reste-au-moins-1` affichait 98 % dès la première page d'une
    // source de milliers de fichiers, et « reste 1 » pendant des jours). La base n'existe qu'après
    // une passe COMPLÈTE — avant, PAS de barre plutôt qu'une barre fausse (précédent histo-gmail).
    if (!coupe && !passeIncomplete) m.b = m.t + m.na;
    // Compteur d'erreurs de collecte CONSÉCUTIVES (filet anti-brûlage ci-dessus) : une passe
    // saine le remet à zéro, au-delà du seuil on marque le jour de la dernière tentative.
    if (erreurCollecte) {
      m.err = (m.err || 0) + 1;
      if (m.err >= CONFIG.MISSIONS_ERREURS_MAX) m.errJour = aujourdhui;
    } else {
      delete m.err;
      // `errJour` n'est levé par une collecte saine QUE s'il vient de la collecte — un jour posé
      // par les échecs de CONVERGENCE (errC) tient jusqu'à ce que la convergence réussisse.
      if (!((m.errC || 0) >= CONFIG.MISSIONS_ERREURS_MAX)) delete m.errJour;
    }
    etatM[tag] = m;
    try { props.setProperty('DriveAI_MISSIONS_ETAT', JSON.stringify(etatM)); } catch (e) { }

    // CONVERGENCE : passe COMPLÈTE (ni coupée, ni trouée par un transitoire/une erreur) qui n'a
    // plus RIEN déplacé ni refusé de neuf.
    if (!coupe && !passeIncomplete && traites === 0 && refus === 0) {
      // `convergenceApres` (revue quotas PR2) : la conclusion de CETTE mission (dont son rapport)
      // dépend d'un état que des missions SŒURS construisent encore — on attend LEUR drapeau FINI
      // avant de conclure (le drainage, lui, n'a pas attendu). Passe vide en attendant : 2-3 RPC.
      var amontFini = (spec.convergenceApres || []).every(function (t) {
        return props.getProperty('DriveAI_MISSION_FINI_' + t) === version;
      });
      if (!amontFini) return;
      // `apresConvergence` (re-pointage du référentiel, rapport paies) AVANT le drapeau FINI
      // (revue sécurité C28-49) : FINI posé d'abord + court-circuit terminal = un échec ici ne
      // serait JAMAIS re-tenté (« un retour qui est un délai n'est pas un chemin de retour », §7).
      // Un échec ici COMPTE aussi dans le filet anti-brûlage (revue quotas PR2) : sans ça, un
      // rapport qui lève À CHAQUE tick (donnée aberrante) re-tenterait 288×/j hors de tout filet.
      if (spec.apresConvergence) {
        try { spec.apresConvergence(); }
        catch (eConv) {
          m.errC = (m.errC || 0) + 1;
          if (m.errC >= CONFIG.MISSIONS_ERREURS_MAX) m.errJour = aujourdhui;
          etatM[tag] = m;
          try { props.setProperty('DriveAI_MISSIONS_ETAT', JSON.stringify(etatM)); } catch (e2) { }
          throw eConv; // pas de FINI — re-tenté (borné par le filet ci-dessus)
        }
        // Convergence RÉUSSIE ⇒ le compteur d'échecs de convergence est LIBÉRÉ (revue finale PR2 :
        // un errC ≥ MAX survivrait au succès et re-bloquerait une journée entière au PREMIER échec
        // après un futur bump de version — « un gate se teste par sa libération », leçon §7).
        if (m.errC || m.errJour) {
          delete m.errC;
          delete m.errJour;
          etatM[tag] = m;
          try { props.setProperty('DriveAI_MISSIONS_ETAT', JSON.stringify(etatM)); } catch (e3) { }
        }
      }
      props.setProperty('DriveAI_MISSION_FINI_' + tag, version);
      // Peinture ROUGE : seulement les sources JETABLES (revue quotas PR2 — peindre un sous-dossier
      // momentanément vide d'une racine PÉRENNE comme 05 dirait « supprimable » à tort). Défaut =
      // toutes les sources (les missions PR1 dissolvent leurs sources par construction).
      var jetables = spec.sourcesJetables !== undefined ? spec.sourcesJetables : spec.sources;
      peindreSourcesVides_(jetables, garde);
      journalInfo_('Missions', 'Mission « ' + tag + ' » TERMINÉE (version ' + version + ') : ' +
        m.t + ' déplacé(s), ' + m.na + ' non apparié(s).' +
        (jetables.length ? ' Dossiers vidés peints en rouge.' : ''));
    }
  } finally {
    // Budget quotidien : ms RÉELLES consommées, écrites même sur exception (jamais de fuite).
    try { props.setProperty('DriveAI_MISSIONS_JOUR', aujourdhui + '|' + (consommeJour + (Date.now() - debut))); }
    catch (e) { }
  }
}

/**
 * Traite UN item : route, RE-VÉRIFIE les gardes (strict), déplace, inscrit la clé APRÈS.
 * @return {string} 'fait' | 'refus' (non apparié/multi-parents, inscrit) | 'transitoire' (re-tenté)
 */
function traiterItemMission_(spec, item, ctx, proteges) {
  var f = item.fichier;
  var nom = f.getName();
  var cle = cleMission_(spec.tag, f.getId());

  var cible = null;
  try { cible = spec.router(nom, { sousChemin: item.sousChemin, sourceId: item.sourceId }, ctx); }
  catch (e) { journalErreur_('Missions', 'Routage impossible (« ' + nom + ' ») : ' + e); return 'transitoire'; }

  // MULTI-PARENTS (moveTo retirerait TOUS les parents = détachement interdit) et NON-APPARIÉ :
  // deux REFUS définitifs sous cette version de règles — inscrits pour la convergence.
  var refus = '';
  if (!cible) refus = 'mission-non-apparie';
  else if (nbParentsBorne_(f) > 1) refus = 'mission-multi-parents';
  if (refus) {
    indexAjouter_(cle, { statut: refus, nom: nom, domaine: '', chemin: '' }, '');
    return 'refus';
  }

  // Zone protégée : RE-VÉRIFIÉE strictement au moment de la mutation (échec fermé).
  if (aParentProtege_(f, proteges, true)) {
    indexAjouter_(cle, { statut: 'mission-protege', nom: nom, domaine: '', chemin: '' }, '');
    return 'refus';
  }

  try {
    // Résolutions MÉMOÏSÉES à portée RUN (revue quotas C28-49 : `sousDossier_` = getFoldersByName
    // find-or-create PAR ITEM, or les combinaisons se répètent massivement — 5 logements × 4
    // thèmes, Toyota bZ…). Le cache vit dans `ctx` (construit par run, survit à tous les items du
    // run — pas le piège de la structure reconstruite par item, leçon Vague 3c).
    var memo = ctx.__memo || (ctx.__memo = {});
    var ouvrir = function (id) { return memo['id|' + id] || (memo['id|' + id] = DriveApp.getFolderById(id)); };
    var sous = function (parent, nomSous) {
      var k = 'sous|' + parent.getId() + '|' + nomSous;
      return memo[k] || (memo[k] = sousDossier_(parent, nomSous));
    };
    var dossier = cible.cibleId ? ouvrir(cible.cibleId) : sous(ouvrir(cible.cibleParentId), cible.cibleNom);
    if (cible.sousDossier) dossier = sous(dossier, cible.sousDossier);
    f.moveTo(dossier); // LA seule mutation — déplacement, jamais suppression
    // NB (revues quotas + code) : un crash ENTRE le move et la clé laisse un déplacement sans
    // trace Index. Pour les missions dont la cible est HORS de la source : jamais re-vu (compteur
    // t −1, bruit possible en réconciliation). Pour `carriere` (cible DANS la source) : re-collecté
    // UNE fois au run suivant, re-routé vers la même place (moveTo no-op), keyé — sans danger.
    indexAjouter_(cle, { statut: 'mission', nom: nom, domaine: '', chemin: dossier.getName() }, '');
    return 'fait';
  } catch (e) {
    // Échec de déplacement : pas de clé → re-tenté au prochain run, la passe reste incomplète.
    // ESSAIS BORNÉS (🔴 revue code, patron `gererEchec_`/QUARANTAINE_MAX) : un échec PERMANENT
    // (« Access denied » sur un partagé sans droit — cas réel documenté) serait sinon re-tenté à
    // chaque run À VIE, avec une ligne de Journal par run. Au-delà du plafond, REFUS inscrit sous
    // la clé versionnée (`mission-echec`) : plus jamais re-collecté, ré-évaluable par bump.
    var essais = 0;
    try { essais = incrementerEchec_(cle); } catch (e2) { /* compteur indisponible : on re-tentera */ }
    if (essais >= CONFIG.QUARANTAINE_MAX) {
      journalErreur_('Missions', 'ABANDON après ' + essais + ' essais (« ' + nom + ' ») : ' + e);
      indexAjouter_(cle, { statut: 'mission-echec', nom: nom, domaine: '', chemin: '' }, '');
      return 'refus';
    }
    journalErreur_('Missions', 'Déplacement différé (essai ' + essais + '/' + CONFIG.QUARANTAINE_MAX +
      ', « ' + nom + ' ») : ' + e);
    return 'transitoire';
  }
}
