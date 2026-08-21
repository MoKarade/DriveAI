'use strict';
/**
 * documents-id.test.js — drainage de la structure héritée `Documents ID` (C28-73, ADR-0048).
 *
 * Ce qui doit être verrouillé ici n'est PAS « ça déplace bien » : c'est que ça passe par le
 * PIPELINE (donc renommage), avec `ignorerDoublon`, en refusant la zone protégée, les dossiers et
 * les raccourcis — et que le garde-temps vive dans la boucle qui fait l'I/O.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { load } = require('./harness');

function ctx() { return load(['Config.gs', 'DocumentsID.gs']); }
/** Normalise une valeur construite DANS le realm vm (prototypes distincts) — patron du harness. */
function plat(x) { return JSON.parse(JSON.stringify(x)); }

/* ---------- fonctions PURES ---------- */

test('dossiersDrainageDocumentsID_ : racine + sous-dossiers, dédupliqués, dans l\'ordre', () => {
  const c = ctx();
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({ racine: 'R', sousDossiers: ['A', 'B', 'A'] })),
    ['R', 'A', 'B']);
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({ sousDossiers: ['A'] })), ['A']);
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_({})), [], 'config vide = campagne INERTE');
  assert.deepStrictEqual(plat(c.dossiersDrainageDocumentsID_(null)), []);
});

test('estDrainableDocumentsID_ : ni dossier, ni RACCOURCI', () => {
  const c = ctx();
  assert.strictEqual(c.estDrainableDocumentsID_('application/pdf'), true);
  assert.strictEqual(c.estDrainableDocumentsID_('image/jpeg'), true);
  assert.strictEqual(c.estDrainableDocumentsID_('application/vnd.google-apps.folder'), false);
  // Un raccourci pointe un fichier qui vit AILLEURS : le « déplacer » ne bougerait que le pointeur,
  // et le pipeline le renommerait comme s'il l'avait classé.
  assert.strictEqual(c.estDrainableDocumentsID_('application/vnd.google-apps.shortcut'), false);
});

test('cleDrainageDocumentsID_ : namespace DÉDIÉ (jamais `drive|`, déjà celui des dépôts classés)', () => {
  const c = ctx();
  assert.strictEqual(c.cleDrainageDocumentsID_('d1', 'F1'), 'drainid|d1|F1');
  assert.ok(c.cleDrainageDocumentsID_('d1', 'F1').indexOf('drive|') !== 0);
});

test('CONFIG.DOCUMENTS_ID : périmètre par IDENTITÉ, jamais par nom', () => {
  const c = ctx();
  const ids = c.dossiersDrainageDocumentsID_(c.CONFIG.DOCUMENTS_ID);
  assert.ok(ids.length >= 6, 'racine + 5 sous-dossiers déclarés');
  ids.forEach((id) => assert.ok(/^[A-Za-z0-9_-]{20,}$/.test(id), 'ID Drive attendu, reçu : ' + id));
});

/* ---------- orchestration ---------- */

function ctxDrain(opts) {
  opts = opts || {};
  const traites = [];
  const deplacements = [];
  const journal = [];
  const index = Object.assign({}, opts.index);
  let horloge = 0;
  let usage = { reinit: 0, flush: 0 };
  let listages = 0;
  const parDossier = opts.parDossier || {};
  const fichier = (id, mime, nom) => ({
    getId: () => id, getMimeType: () => mime, getName: () => nom || (id + '.pdf'),
    getSize: () => 1000, getDateCreated: () => new Date(0), getBlob: () => ({ id }),
    getOwner: () => ({ getEmail: () => (opts.tiers || []).indexOf(id) !== -1 ? 'autre@x' : 'marc@x' }),
  });
  const tous = () => Object.keys(parDossier).reduce((a, k) => a.concat(parDossier[k]), []);
  // `Config.gs` n'est PAS chargé : sa déclaration `var CONFIG = {…}` ÉCRASERAIT l'injection
  // (patron établi par historique-vrac.test.js pour `feuille_`).
  const c = load(['DocumentsID.gs'], {
    CONFIG: {
      DOCUMENTS_ID: opts.cfg !== undefined ? opts.cfg
        : { tag: 'd1', racine: 'R', sousDossiers: [], maxParRun: opts.maxParRun || 30 },
      PILOTE_MARGE_DOC_MS: opts.margeMs === undefined ? 0 : opts.margeMs,
    },
    budgetMsRun_: () => (opts.budgetMs === undefined ? 1e9 : opts.budgetMs),
    Date: { now: () => (horloge += (opts.pasMs || 0)) },
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => !opts.verrouOccupe, releaseLock: () => {} }) },
    DriveApp: {
      getFolderById: (id) => {
        listages++;
        if (opts.dossierIllisible === id) throw new Error('boum');
        const fs2 = (parDossier[id] || []).slice();
        let i2 = 0;
        return { getFiles: () => ({ hasNext: () => i2 < fs2.length, next: () => fs2[i2++] }) };
      },
      getFileById: (id) => {
        const f = tous().filter((x) => x.getId() === id)[0];
        if (!f) throw new Error('introuvable ' + id);
        return f;
      },
    },
    chargerPannePlateforme_: () => {},
    estPannePlateforme_: () => !!opts.panne,
    budgetCampagnesAtteint_: () => !!opts.freinBudget,
    reinitialiserUsage_: () => { usage.reinit++; },
    flushUsage_: () => { usage.flush++; },
    poserOperationCourante_: () => {},
    operationCourante_: () => '',
    indexContient_: (cle) => index[cle] === true,
    Session: { getEffectiveUser: () => ({ getEmail: () => 'marc@x' }) },
    ensembleDomainesProteges_: () => ({}),
    aParentProtege_: (f) => (opts.proteges || []).indexOf(f.getId()) !== -1,
    traiterDocument_: (src) => {
      traites.push({ cle: src.cle, nom: src.nom, ignorerDoublon: src.ignorerDoublon });
      if (opts.placerVers) src.placer(opts.placerVers, 'renomme.pdf');
      // Par défaut le pipeline ABOUTIT (il inscrit sa clé) ; `pipelineInerte` simule un échec avalé.
      if (!opts.pipelineInerte) index[src.cle] = true;
    },
    renommer_: (id, nom) => { deplacements.push({ type: 'renomme', id: id, nom: nom }); return true; },
    deplacerEtRenommer_: (id, dest, src2, nom) => {
      deplacements.push({ type: 'deplace', id: id, dest: dest, source: src2, nom: nom });
      return true;
    },
    journalInfo_: (s2, m) => journal.push(m),
    journalErreur_: (s2, m) => journal.push(m),
  });
  return { c, traites, deplacements, journal, fichier, parDossier, usage: () => usage,
    listagesDossier: () => listages };
}

test('drainerDocumentsID : passe par le PIPELINE avec ignorerDoublon — jamais un simple déplacement', () => {
  const h = ctxDrain({});
  h.parDossier.R = [h.fichier('F1', 'application/pdf', 'Passeport_Marc_RICHARD.pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 1);
  assert.strictEqual(h.traites[0].cle, 'drainid|d1|F1');
  // Sans ce flag, les 2 fichiers dont le jumeau dort dans `_Doublons` repartiraient dans `_Doublons`
  // (« doublon d'eux-mêmes ») — le défaut qu'ADR-0047 mesure sur 1 076 fichiers.
  assert.strictEqual(h.traites[0].ignorerDoublon, true);
  assert.ok(/1 document\(s\) drainé/.test(bilan), bilan);
});

test('le callback `placer` DÉPLACE hors du dossier source, et RENOMME sur place si la cible est le même dossier', () => {
  // C'est la seule ligne du module qui mute Drive, et elle n'était exercée par AUCUN test : le mock
  // de `traiterDocument_` ne faisait rien. On l'appelle donc pour de vrai (revue code).
  const h = ctxDrain({ placerVers: 'DEST' });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.deplacements.map((d) => [d.type, d.id, d.dest, d.source]),
    [['deplace', 'F1', 'DEST', 'R']], 'le dossier SOURCE doit être retiré des parents');

  const h2 = ctxDrain({ placerVers: 'R' }); // cible == dossier courant
  h2.parDossier.R = [h2.fichier('F1', 'application/pdf')];
  h2.c.drainerDocumentsID();
  assert.deepStrictEqual(h2.deplacements.map((d) => d.type), ['renomme'],
    'déjà au bon endroit : renommage seul, jamais un déplacement vers soi-même');
});

test('drainerDocumentsID : raccourcis, natifs Google, déjà-faits et zone PROTÉGÉE sont écartés, chacun compté', () => {
  const h = ctxDrain({ index: { 'drainid|d1|DEJA': true }, proteges: ['PROT'] });
  h.parDossier.R = [
    h.fichier('F1', 'application/pdf'),
    h.fichier('RACC', 'application/vnd.google-apps.shortcut'),
    // Un Google Doc a `getSize() === 0` : le pipeline hasherait et OCR-iserait son EXPORT. `Intake.gs`
    // sait gérer ce cas, ce module non — il l'écarte plutôt que de deviner.
    h.fichier('GDOC', 'application/vnd.google-apps.document'),
    h.fichier('DEJA', 'application/pdf'),
    h.fichier('PROT', 'application/pdf'),
  ];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1'], 'seul F1 est traité');
  assert.ok(/1 document\(s\) drainé/.test(bilan) && /1 déjà fait/.test(bilan) &&
    /1 protégé/.test(bilan) && /2 ignoré/.test(bilan), bilan);
});

test('LE BILAN NE MENT PAS : un pipeline qui n\'aboutit pas est compté « non abouti », jamais « drainé »', () => {
  // `traiterDocument_` avale ses propres erreurs (classification impossible, placement refusé, OCR
  // en panne) et ne rend rien. Compter les APPELS faisait dire « 15 drainés, 0 échec » alors
  // qu'aucun fichier n'avait bougé — et « TERMINÉ » est le signal qui empêche Marc de relancer.
  const h = ctxDrain({ pipelineInerte: true });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 2, 'le pipeline a bien été appelé deux fois');
  assert.ok(/0 document\(s\) drainé/.test(bilan), 'aucun drainage réel : ' + bilan);
  assert.ok(/2 NON abouti/.test(bilan), bilan);
  assert.ok(/relancer/i.test(bilan), 'et le bilan dit quoi faire');
});

test('PANNE LLM déjà en cours : on ne touche même pas au Drive — et jamais « TERMINÉ »', () => {
  // Deux contrôles existent (avant la boucle, et à chaque document). Celui d'avant-boucle serait
  // DÉCORATIF si on ne vérifiait que « pas de TERMINÉ » : l'autre suffirait. Ce qu'il apporte en
  // propre, c'est de ne lister AUCUN dossier — donc zéro I/O Drive quand le compte est à terre.
  const h = ctxDrain({ panne: true });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0, 'aucun appel au pipeline pendant une panne de compte');
  assert.strictEqual(h.listagesDossier(), 0, 'aucun listage Drive : le contrôle d\'avant-boucle porte');
  assert.ok(/SUSPENDU/.test(bilan) && !/TERMINÉ/.test(bilan), bilan);
});

test('FREIN BUDGET campagnes atteint → drainage reporté, rien touché', () => {
  const h = ctxDrain({ freinBudget: true });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0);
  assert.ok(/REPORTÉ/.test(bilan), bilan);
});

test('COMPTABILITÉ du coût : `reinitialiserUsage_` avant, `flushUsage_` dans le finally', () => {
  // Hors tick, `_usageRun` vaut null et `enregistrerUsage_` sort en silence : sans ces deux appels,
  // chaque dollar de ce drainage échappe au frein §1.6, à la ventilation et au cumul du hub.
  const h = ctxDrain({});
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  h.c.drainerDocumentsID();
  assert.strictEqual(h.usage().reinit, 1);
  assert.strictEqual(h.usage().flush, 1);
});

test('VERROU : si le moteur travaille déjà, le drainage ne démarre pas', () => {
  const h = ctxDrain({ verrouOccupe: true });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0);
  assert.ok(/verrou occupé/.test(bilan), bilan);
});

test('ÉPINGLÉ par Marc : jamais re-déplacé, et compté à part', () => {
  // Tous les modules de re-rangement testent `epingle|<id>` (ADR-0026) ; celui-ci était le SEUL à
  // ne pas le faire. Sans la garde, un bump de `tag` re-déplacerait ce que Marc a rangé lui-même.
  const h = ctxDrain({ index: { 'epingle|F2': true } });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1']);
  assert.ok(/1 épinglé/.test(bilan), bilan);
});

test('fichier d\'un TIERS : laissé intact (le renommer le retirerait de SON dossier partagé)', () => {
  const h = ctxDrain({ tiers: ['F2'] });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1']);
  assert.ok(/1 appartenant à un TIERS/.test(bilan), bilan);
});

test('drainerDocumentsID : config VIDE → campagne inerte, aucun appel au pipeline', () => {
  const h = ctxDrain({ cfg: {} });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0);
  assert.ok(/AUCUN dossier source/.test(bilan), bilan);
});

test('le garde-temps coupe AVANT de démarrer un document, et l\'interruption se DIT', () => {
  // Coupure DÉTERMINISTE : 100 ms par lecture d'horloge, mur de démarrage à 150 ms ⇒ exactement 1
  // document démarré. Une assertion « moins de 3 » passerait aussi pour 0 ou 2 et prouverait moins.
  const h = ctxDrain({ budgetMs: 150, pasMs: 100 });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf'),
    h.fichier('F3', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 1, 'exactement un document démarré');
  assert.ok(/INTERROMPU/.test(bilan), 'une interruption muette se lit comme une fin : ' + bilan);
  assert.ok(/reprend/.test(bilan), 'et elle dit comment reprendre');
});

test('MARGE DE DÉMARRAGE : on ne démarre pas un document dans la dernière minute', () => {
  // Le garde n'est évalué qu'AVANT de prendre le document ; OCR + 2 passes Sonnet + retry peuvent
  // coûter 1 à 3 min. Sans marge, on franchit le mur dur des 6 min et l'exécution est TUÉE — sans
  // aucun bilan écrit, ni TERMINÉ ni INTERROMPU.
  const h = ctxDrain({ budgetMs: 300, margeMs: 250, pasMs: 100 }); // mur de démarrage = 50 ms
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 0, 'la marge empêche même le premier démarrage');
  assert.ok(/INTERROMPU/.test(bilan), bilan);
});

test('PLAFOND par run : on ne draine pas 500 fichiers d\'un coup', () => {
  const h = ctxDrain({ cfg: { tag: 'd1', racine: 'R', sousDossiers: [], maxParRun: 2 } });
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf'),
    h.fichier('F3', 'application/pdf'), h.fichier('F4', 'application/pdf')];
  h.c.drainerDocumentsID();
  assert.strictEqual(h.traites.length, 2, 'toutes les campagnes voisines ont un plafond par run');
});

test('drainerDocumentsID : un dossier ILLISIBLE ne fait pas tomber les autres', () => {
  const h = ctxDrain({ cfg: { tag: 'd1', racine: 'R', sousDossiers: ['KO', 'B'], maxParRun: 30 },
    dossierIllisible: 'KO' });
  h.parDossier.R = [h.fichier('F1', 'application/pdf')];
  h.parDossier.B = [h.fichier('F2', 'application/pdf')];
  const bilan = h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.traites.map((t) => t.cle), ['drainid|d1|F1', 'drainid|d1|F2'],
    'un poison ne doit pas affamer les sources suivantes');
  assert.ok(/1 échec/.test(bilan), bilan);
});

test('COLLECTE AVANT MUTATION : les IDs sont lus en entier avant le premier déplacement', () => {
  // Le déplacement pendant l'itération invaliderait l'itérateur — c'est écrit noir sur blanc dans
  // `Intake.gs` et `Migration.gs`, les deux patrons revendiqués par l'ADR. Le saut resterait
  // rattrapable (les sautés ne sont pas indexés), mais le bilan afficherait TERMINÉ — le signal
  // exact qui empêche de relancer. C'est la combinaison qui coûte cher.
  const h = ctxDrain({ placerVers: 'DEST' });
  const listes = [];
  h.parDossier.R = [h.fichier('F1', 'application/pdf'), h.fichier('F2', 'application/pdf'),
    h.fichier('F3', 'application/pdf')];
  const src = fs.readFileSync(require.resolve('../src/DocumentsID.gs'), 'utf8');
  assert.ok(/collecterDrainageDocumentsID_\(/.test(src), 'la collecte est bien une étape séparée');
  h.c.drainerDocumentsID();
  assert.deepStrictEqual(h.deplacements.map((d) => d.id), ['F1', 'F2', 'F3'],
    'les 3 fichiers sont traités malgré les déplacements en cours de route');
  void listes;
});

/* ---------- TRIPWIRE §2 ---------- */

test('TRIPWIRE §2 : DocumentsID.gs ne SUPPRIME rien (déplacement et renommage seuls)', () => {
  const brut = fs.readFileSync(require.resolve('../src/DocumentsID.gs'), 'utf8');
  const src = brut.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  [/setTrashed\s*\(/, /trashed"?\s*:\s*true/i, /removeFile\s*\(/, /method:\s*['"]delete['"]/i,
    /emptyTrash/, /createFolder\s*\(/, /makeCopy\s*\(/, /setSharing\s*\(/].forEach((re) => {
    assert.ok(!re.test(src), 'opération interdite dans DocumentsID.gs : ' + re);
  });
});
