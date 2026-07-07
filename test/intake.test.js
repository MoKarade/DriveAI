'use strict';
/**
 * ÉQUITÉ D'INTAKE (R3, correctif « file À trier affamée » 2026-07-07) — né d'un vrai incident :
 * le grand rangement re-alimentait 00·À trier en continu, l'itérateur Drive servait les plus
 * RÉCENTS d'abord, et un PDF déposé par Marc est resté 11 h (~130 ticks) sans être traité.
 * Trois invariants verrouillés ici :
 *   1. la page est TRIÉE du plus ancien au plus récent (FIFO : premier arrivé, premier servi) ;
 *   2. la page est COMPOSÉE de TRAITABLES seulement (les déjà-indexés — quarantaine et statut
 *      `natif` inclus — n'occupent pas de place : un mur de skips n'affame plus le reste) ;
 *   3. les bornes INTAKE_SCAN_MAX (parcours) et INTAKE_PAGE (candidats) et le garde-temps
 *      s'appliquent (jamais de scan non borné sur un lot Drive — CLAUDE.md §7).
 * Plus la capacité natifs (Ocr.gs) : export texte direct des fichiers Google (Docs/Sheets/Slides) —
 * deux Google Sheets ont stagné 3 semaines faute de lecteur ; échec d'export = échec COMPTÉ,
 * type sans export = résident indexé `natif` (jamais un slot de page perdu à vie).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter } = require('./harness');

// ---------------------------------------------------------------------------
// ordonnerDepots_ (pure)
// ---------------------------------------------------------------------------

test('ordonnerDepots_ : trie EN PLACE du plus ancien au plus récent', () => {
  const ctx = load(['Config.gs', 'Intake.gs']);
  const candidats = [
    { id: 'c', date: 300 },
    { id: 'a', date: 100 },
    { id: 'b', date: 200 },
  ];
  const retour = ctx.ordonnerDepots_(candidats);
  assert.deepStrictEqual(candidats.map((c) => c.id), ['a', 'b', 'c']);
  assert.strictEqual(retour, candidats, 'retourne le MÊME tableau (tri en place)');
});

test('ordonnerDepots_ : date illisible (0) passe en tête de file', () => {
  const ctx = load(['Config.gs', 'Intake.gs']);
  const candidats = [{ id: 'recent', date: 999 }, { id: 'illisible', date: 0 }];
  ctx.ordonnerDepots_(candidats);
  assert.strictEqual(candidats[0].id, 'illisible');
});

// ---------------------------------------------------------------------------
// traiterDepots_ (collecte + page)
// ---------------------------------------------------------------------------

/** Faux fichier de 00·À trier : l'itérateur Drive le sert dans l'ordre du tableau. */
function fichier(id, ms, dateIllisible) {
  return {
    getId: () => id,
    getLastUpdated: () => {
      if (dateIllisible) throw new Error('date indisponible (simulé)');
      return new Date(ms);
    },
  };
}

/**
 * Monte un contexte où `traiterDepots_` tourne sur `fichiers` (ordre = ordre de l'itérateur
 * Drive, c.-à-d. plus récents d'abord en prod) et capture l'ordre des traitements.
 */
function scenario(fichiers, opts) {
  opts = opts || {};
  const ctx = load(['Config.gs', 'Intake.gs'], {
    DriveApp: { getFolderById: () => ({ getFiles: () => iter(fichiers) }) },
  });
  if (opts.scanMax) ctx.CONFIG.INTAKE_SCAN_MAX = opts.scanMax;
  if (opts.page) ctx.CONFIG.INTAKE_PAGE = opts.page;
  const indexes = opts.indexes || [];
  ctx.indexContient_ = (cle) => indexes.indexOf(cle) !== -1;
  const traites = [];
  ctx.traiterFichierDepose_ = (id) => traites.push(id);
  return { ctx, traites };
}

test('traiterDepots_ : FIFO — l\'itérateur sert les récents d\'abord, le traitement part des anciens', () => {
  // Ordre Drive (récent → ancien) : c (3 h), b (2 h), a (1 h). Traitement attendu : a, b, c.
  const { ctx, traites } = scenario([fichier('c', 3e6), fichier('b', 2e6), fichier('a', 1e6)]);
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, ['a', 'b', 'c']);
});

test('traiterDepots_ : les déjà-indexés (quarantaine incluse) n\'occupent AUCUNE place dans la page', () => {
  // Page de 2 ; un mur de 3 indexés devant. Avant R3 ils remplissaient la page → x/y jamais servis.
  const fichiers = [
    fichier('q1', 50), fichier('q2', 40), fichier('q3', 30),
    fichier('y', 20), fichier('x', 10),
  ];
  const { ctx, traites } = scenario(fichiers, {
    page: 2,
    indexes: ['drive|q1', 'drive|q2', 'drive|q3'],
  });
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, ['x', 'y'], 'les 2 places vont aux traitables, triés FIFO');
});

test('traiterDepots_ : INTAKE_SCAN_MAX borne le PARCOURS (mur de skips borné, jamais de scan infini)', () => {
  const fichiers = [
    fichier('i1', 1), fichier('i2', 2), fichier('i3', 3), // indexés, dans la fenêtre de scan
    fichier('hors-scan', 4), // traitable mais au-delà de la borne de parcours
  ];
  const { ctx, traites } = scenario(fichiers, {
    scanMax: 3,
    indexes: ['drive|i1', 'drive|i2', 'drive|i3'],
  });
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, [], 'rien traité : la borne de parcours prime (repris au tick suivant)');
});

test('traiterDepots_ : INTAKE_PAGE tronque APRÈS le tri — la page = les plus ANCIENS collectés', () => {
  // Tronquer à la collecte garderait d et c (les premiers servis = les plus récents) : l'inverse
  // de l'équité. La collecte va jusqu'à SCAN_MAX, le tri passe, PUIS la page se coupe.
  const { ctx, traites } = scenario(
    [fichier('d', 4), fichier('c', 3), fichier('b', 2), fichier('a', 1)],
    { page: 2 }
  );
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, ['a', 'b']);
});

test('traiterDepots_ : budget déjà épuisé → collecte et traitement s\'arrêtent net', () => {
  const { ctx, traites } = scenario([fichier('a', 1), fichier('b', 2)]);
  ctx.traiterDepots_(() => true);
  assert.deepStrictEqual(traites, []);
});

test('traiterDepots_ : un item qui JETTE ne gèle ni la boucle ni le tick (try par item)', () => {
  // Un fichier empoisonné trié en tête de FIFO serait re-servi PREMIER à chaque tick : sans try
  // par item, il gèlerait l'intake pour toujours (et tout le reste du tick avec).
  const { ctx, traites } = scenario([fichier('sain', 5), fichier('poison', 1)]);
  const originel = ctx.traiterFichierDepose_;
  ctx.traiterFichierDepose_ = (id) => {
    if (id === 'poison') throw new Error('métadonnée illisible (simulé)');
    originel(id);
  };
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, ['sain'], 'le poison (en tête) n\'empêche pas le suivant');
  assert.ok(ctx.__logs.some(([niv, src, msg]) => niv === 'ERREUR' && src === 'Intake' && msg.includes('poison')));
});

test('traiterDepots_ : garde-temps — stop entre deux items, reprise au tick suivant', () => {
  const { ctx, traites } = scenario([fichier('b', 2), fichier('a', 1)]);
  let epuise = false;
  ctx.traiterFichierDepose_ = (id) => { traites.push(id); epuise = true; }; // le 1ᵉʳ item vide le budget
  ctx.traiterDepots_(() => epuise);
  assert.deepStrictEqual(traites, ['a'], 'le plus ancien passe, le reste attend le prochain tick');
  assert.ok(ctx.__logs.some(([, src, msg]) => src === 'Intake' && /Budget temps/.test(msg)));
});

test('traiterDepots_ : date illisible → tête de file (jamais d\'arrêt brutal)', () => {
  const { ctx, traites } = scenario([fichier('ok', 5), fichier('sans-date', 0, true)]);
  ctx.traiterDepots_(() => false);
  assert.deepStrictEqual(traites, ['sans-date', 'ok']);
});

// ---------------------------------------------------------------------------
// Natifs Google : exportNatifMime_ (pure) + exporterTexteNatif_ (Ocr.gs)
// ---------------------------------------------------------------------------

test('exportNatifMime_ : Docs/Sheets/Slides exportables, le reste → null', () => {
  const ctx = load(['Config.gs', 'Ocr.gs']);
  assert.strictEqual(ctx.exportNatifMime_('application/vnd.google-apps.document'), 'text/plain');
  assert.strictEqual(ctx.exportNatifMime_('application/vnd.google-apps.spreadsheet'), 'text/csv');
  assert.strictEqual(ctx.exportNatifMime_('application/vnd.google-apps.presentation'), 'text/plain');
  assert.strictEqual(ctx.exportNatifMime_('application/vnd.google-apps.form'), null);
  assert.strictEqual(ctx.exportNatifMime_('application/vnd.google-apps.drawing'), null);
  assert.strictEqual(ctx.exportNatifMime_('application/pdf'), null, 'un non-natif ne passe JAMAIS par l\'export direct');
});

function ctxExport(reponse) {
  return load(['Config.gs', 'Ocr.gs'], {
    ScriptApp: { getOAuthToken: () => 'jeton-test' },
    UrlFetchApp: {
      fetch: (url) => {
        if (reponse.jette) throw new Error('réseau indisponible (simulé)');
        reponse.urls.push(url);
        return {
          getResponseCode: () => reponse.code,
          getContentText: () => reponse.texte,
        };
      },
    },
  });
}

test('exporterTexteNatif_ : export 200 → texte ENTIER (l\'empreinte de doublon en dépend), borne mémoire seule', () => {
  // Hasher un texte tronqué à 4000 cars ferait de deux gros exports au même en-tête des
  // « doublons » — le texte revient entier ; la troncature LLM arrive en aval (extraireTexte_).
  const reponse = { code: 200, texte: 'x'.repeat(9000), urls: [] };
  const ctx = ctxExport(reponse);
  const texte = ctx.exporterTexteNatif_('id-doc', 'application/vnd.google-apps.document');
  assert.strictEqual(texte.length, 9000, 'pas de troncature LLM ici');
  assert.ok(texte.length > ctx.CONFIG.LLM_OCR_MAX_CARS);
  assert.ok(reponse.urls[0].includes('/files/id-doc/export?mimeType=text%2Fplain'));
});

test('exporterTexteNatif_ : borné par NATIF_EXPORT_MAX_CARS (mémoire, jamais un export sans borne)', () => {
  const ctx = ctxExport({ code: 200, texte: 'x'.repeat(9000), urls: [] });
  ctx.CONFIG.NATIF_EXPORT_MAX_CARS = 5000;
  assert.strictEqual(
    ctx.exporterTexteNatif_('id-doc', 'application/vnd.google-apps.document').length, 5000);
});

test('exporterTexteNatif_ : type sans export → null SANS appel réseau', () => {
  const reponse = { code: 200, texte: 'jamais lu', urls: [] };
  const ctx = ctxExport(reponse);
  assert.strictEqual(ctx.exporterTexteNatif_('id-form', 'application/vnd.google-apps.form'), null);
  assert.strictEqual(reponse.urls.length, 0, 'aucun fetch pour un type non exportable');
});

test('exporterTexteNatif_ : HTTP ≠ 200 → null + erreur journalisée (dégradation propre)', () => {
  const ctx = ctxExport({ code: 403, texte: 'forbidden', urls: [] });
  assert.strictEqual(ctx.exporterTexteNatif_('id-doc', 'application/vnd.google-apps.document'), null);
  assert.ok(ctx.__logs.some(([niv, src]) => niv === 'ERREUR' && src === 'OCR'));
});

test('exporterTexteNatif_ : exception réseau → null (jamais de plantage du lot)', () => {
  const ctx = ctxExport({ jette: true });
  assert.strictEqual(ctx.exporterTexteNatif_('id-doc', 'application/vnd.google-apps.document'), null);
});

// ---------------------------------------------------------------------------
// traiterFichierDepose_ (construction du descripteur, branche natifs)
// ---------------------------------------------------------------------------

/**
 * Contexte pour traiterFichierDepose_ : Ocr.gs est chargé (vrai exportNatifMime_), les
 * COLLABORATEURS trans-modules sont espionnés (traiterDocument_, gererEchec_, indexAjouter_,
 * deplacerEtRenommer_) et exporterTexteNatif_/signalerNatifUneFois_ sont remplacés après load.
 */
function ctxDepose(fichierDrive, texteExporte) {
  const appels = { docs: [], echecs: [], index: [], signales: [] };
  const ctx = load(['Config.gs', 'Intake.gs', 'Ocr.gs'], {
    DriveApp: { getFileById: () => fichierDrive },
    Utilities: { newBlob: (t, m, n) => ({ texte: t, mime: m, nom: n }) },
  });
  ctx.traiterDocument_ = (src) => appels.docs.push(src);
  ctx.gererEchec_ = (src, motif) => appels.echecs.push({ src, motif });
  ctx.indexAjouter_ = (cle, res) => appels.index.push({ cle, res });
  ctx.deplacerEtRenommer_ = () => true;
  ctx.exporterTexteNatif_ = () => texteExporte;
  ctx.signalerNatifUneFois_ = (id, nom) => appels.signales.push(id);
  return { ctx, appels };
}

function fichierDrive(opts) {
  return {
    getMimeType: () => opts.mime,
    getName: () => opts.nom || 'doc',
    getSize: () => { if (opts.tailleJette) throw new Error('taille indisponible'); return opts.taille || 0; },
    getLastUpdated: () => { if (opts.dateJette) throw new Error('date indisponible'); return new Date(1e12); },
    getBlob: () => ({ octets: true }),
  };
}

test('traiterFichierDepose_ : binaire → descripteur complet (clé drive|, taille, déplacement)', () => {
  const { ctx, appels } = ctxDepose(fichierDrive({ mime: 'application/pdf', nom: 'releve.pdf', taille: 123 }));
  ctx.traiterFichierDepose_('id1');
  assert.strictEqual(appels.docs.length, 1);
  const src = appels.docs[0];
  assert.strictEqual(src.cle, 'drive|id1');
  assert.strictEqual(src.taille, 123);
  assert.strictEqual(src.sujet, 'Dépôt manuel');
  assert.strictEqual(src.placer('dest', 'nouveau.pdf'), 'id1', 'placer = déplacement, renvoie l\'ID stable');
});

test('traiterFichierDepose_ : getSize/getLastUpdated qui JETTENT ne bloquent pas le fichier', () => {
  // La collecte tolère déjà une date illisible (tête de file) — le traitement doit la tolérer
  // aussi, sinon le même fichier gèle la boucle à CHAQUE tick (bloquant revue R3).
  const { ctx, appels } = ctxDepose(fichierDrive({ mime: 'application/pdf', tailleJette: true, dateJette: true }));
  ctx.traiterFichierDepose_('id2');
  assert.strictEqual(appels.docs.length, 1, 'traité malgré les métadonnées illisibles');
  assert.strictEqual(appels.docs[0].taille, 0);
  assert.ok(appels.docs[0].date instanceof ctx.Date, 'date de repli posée');
});

test('traiterFichierDepose_ : natif exportable → pipeline normal (blob texte, pas de doublon sur texte court)', () => {
  const texte = 'Contenu réel du document Google, assez long pour une empreinte fiable.';
  const { ctx, appels } = ctxDepose(
    fichierDrive({ mime: 'application/vnd.google-apps.document', nom: 'Notes' }), texte);
  ctx.traiterFichierDepose_('id3');
  assert.strictEqual(appels.docs.length, 1);
  const src = appels.docs[0];
  assert.strictEqual(src.cle, 'drive|id3');
  assert.strictEqual(src.sujet, 'Dépôt manuel (fichier Google)');
  assert.strictEqual(src.taille, texte.length);
  assert.strictEqual(src.ignorerDoublon, false, 'texte substantiel → détection de doublon active');
  assert.strictEqual(src.blob().texte, texte, 'le blob porte le texte exporté');
  assert.strictEqual(appels.echecs.length, 0);
});

test('traiterFichierDepose_ : natif au texte QUASI VIDE → jamais le fast-path doublon (MD5 identiques)', () => {
  const { ctx, appels } = ctxDepose(
    fichierDrive({ mime: 'application/vnd.google-apps.presentation', nom: 'Deck images' }), '');
  ctx.traiterFichierDepose_('id4');
  assert.strictEqual(appels.docs.length, 1);
  assert.strictEqual(appels.docs[0].ignorerDoublon, true,
    'deux exports vides partagent le même hash — le 2ᵉ ne doit pas partir en _Doublons');
});

test('traiterFichierDepose_ : export ÉCHOUÉ (exportable) → échec STANDARD compté, rien d\'indexé', () => {
  const { ctx, appels } = ctxDepose(
    fichierDrive({ mime: 'application/vnd.google-apps.spreadsheet', nom: 'Budget' }), null);
  ctx.traiterFichierDepose_('id5');
  assert.strictEqual(appels.docs.length, 0);
  assert.strictEqual(appels.index.length, 0, 'pas d\'inscription Index : re-tenté, quarantaine après 3');
  assert.strictEqual(appels.echecs.length, 1);
  assert.strictEqual(appels.echecs[0].src.cle, 'drive|id5');
  assert.deepStrictEqual(appels.signales, [], 'un échec n\'est pas un « type sans export »');
});

test('traiterFichierDepose_ : type SANS export (Forms…) → signalé une fois + indexé `natif` (sort de la page)', () => {
  const { ctx, appels } = ctxDepose(
    fichierDrive({ mime: 'application/vnd.google-apps.form', nom: 'Sondage' }), 'jamais lu');
  ctx.traiterFichierDepose_('id6');
  assert.strictEqual(appels.docs.length, 0);
  assert.strictEqual(appels.echecs.length, 0);
  assert.deepStrictEqual(appels.signales, ['id6']);
  assert.strictEqual(appels.index.length, 1);
  assert.strictEqual(appels.index[0].cle, 'drive|id6');
  assert.strictEqual(appels.index[0].res.statut, 'natif', 'résident assumé : plus jamais dans la page');
});

// ---------------------------------------------------------------------------
// nbFichiersATrier_ (seuil « drainer avant d'alimenter » : le drainable seulement)
// ---------------------------------------------------------------------------

function ctxSeuil(fichiers, indexes) {
  const ctx = load(['Config.gs', 'Maintenance.gs'], {
    DriveApp: { getFolderById: () => ({ getFiles: () => iter(fichiers) }) },
  });
  ctx.indexContient_ = (cle) => (indexes || []).indexOf(cle) !== -1;
  return ctx;
}

test('nbFichiersATrier_ : les résidents indexés (quarantaine, natifs) ne comptent PAS dans le seuil', () => {
  // 40 quarantainés comptés fermaient la porte du grand rangement à vie (revue R3).
  const fichiers = [fichier('q1', 1), fichier('q2', 2), fichier('nouveau', 3)];
  const ctx = ctxSeuil(fichiers, ['drive|q1', 'drive|q2']);
  assert.strictEqual(ctx.nbFichiersATrier_(40), 1);
});

test('nbFichiersATrier_ : plafonds respectés (comptage ET parcours)', () => {
  const beaucoup = [];
  for (let i = 0; i < 10; i++) beaucoup.push(fichier('f' + i, i));
  const ctx = ctxSeuil(beaucoup);
  assert.strictEqual(ctx.nbFichiersATrier_(3), 3, 'comptage coupé au plafond demandé');
  const ctx2 = ctxSeuil(beaucoup, ['drive|f0', 'drive|f1', 'drive|f2']);
  ctx2.CONFIG.INTAKE_SCAN_MAX = 4;
  assert.strictEqual(ctx2.nbFichiersATrier_(40), 1, 'parcours borné par INTAKE_SCAN_MAX (mur de résidents)');
});
