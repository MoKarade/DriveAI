'use strict';
/**
 * Chantier #16 (ADR-0012) — tri Gmail natif : la décision PURE porte toutes les règles de Marc ;
 * l'orchestration est vérifiée sur : idempotence par ÉTAT (fil|ts|lu — un mail lu APRÈS son tri
 * est re-trié donc archivé), attente des intentions, écritures bornées (libellés existants seuls,
 * jamais de création), archivage réversible, rattrapage du stock par ancre FIXE + offset sur
 * ensemble figé, panne d'écriture SYSTÉMIQUE (stoppe le run, aucun échec imputé aux fils).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const plain = (o) => JSON.parse(JSON.stringify(o));
const ctxPur = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);

/* ---------- decisionTri_ (pure — les règles de Marc) ---------- */

test('decisionTri_ : SUSPECT prime sur tout — libellé ⚠️ seul, jamais archivé', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Finance', important: true, suspect: true,
    zoneProtegee: false, promoDeterministe: true, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['⚠️ Suspect'], archiver: false, statut: 'suspect' });
});

test('decisionTri_ : catégorie introuvable → À vérifier, jamais archivé (jamais « le plus probable »)', () => {
  const d = ctxPur.decisionTri_({ categorie: null, important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['À vérifier'], archiver: false, statut: 'tri-a-verifier' });
});

test('decisionTri_ : mail LU → libellé + archivé (règle générale de Marc)', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Finance/Impôt', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: true });
  assert.deepStrictEqual(plain(d), { libelles: ['Finance/Impôt'], archiver: true, statut: 'trié' });
});

test('decisionTri_ : mail NON LU (non promo) → libellé, reste en boîte', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Achats', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: false, entierementLu: false });
  assert.strictEqual(d.archiver, false);
});

test('decisionTri_ : promo DÉTERMINISTE non lue → archivée quand même (règle Cowork confirmée)', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Abonnements', important: false, suspect: false,
    zoneProtegee: false, promoDeterministe: true, entierementLu: false });
  assert.strictEqual(d.archiver, true);
});

test('decisionTri_ : ZONE PROTÉGÉE — jamais archivée par le chemin promo, mais archivée si LUE (choix Marc)', () => {
  const nonLue = ctxPur.decisionTri_({ categorie: 'Immigration', important: false, suspect: false,
    zoneProtegee: true, promoDeterministe: true, entierementLu: false });
  assert.strictEqual(nonLue.archiver, false); // promo-path interdit en zone protégée
  const lue = ctxPur.decisionTri_({ categorie: 'Immigration', important: false, suspect: false,
    zoneProtegee: true, promoDeterministe: false, entierementLu: true });
  assert.strictEqual(lue.archiver, true);     // « archivés seulement si ouverts par moi »
});

test('decisionTri_ : IMPORTANT → ⏰ ajouté et JAMAIS archivé, même lu, même promo', () => {
  const d = ctxPur.decisionTri_({ categorie: 'Administration', important: true, suspect: false,
    zoneProtegee: false, promoDeterministe: true, entierementLu: true });
  assert.deepStrictEqual(plain(d.libelles), ['Administration', '⏰ À traiter']);
  assert.strictEqual(d.archiver, false);
});

/* ---------- heuristiques & primitives pures ---------- */

test('heuristiquePhishing_ : PJ EXÉCUTABLE seule suffit ; PJ DOUTEUSE seulement combinée (revue ronde 2)', () => {
  assert.strictEqual(ctxPur.heuristiquePhishing_('Bonjour', ['malware.exe']), true);       // exécutable seul
  assert.strictEqual(ctxPur.heuristiquePhishing_('Bonjour', ['photos.zip']), false);       // .zip anodin (photographe)
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : compte suspendu', ['doc.zip']), true); // douteuse + urgence
  assert.strictEqual(ctxPur.heuristiquePhishing_('Vérifiez votre compte', ['page.html']), true);  // douteuse + credentiels
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : vérifiez votre compte', []), true);    // urgence ET credentiels
  assert.strictEqual(ctxPur.heuristiquePhishing_('URGENT : réunion demain', []), false);   // urgence seule
  assert.strictEqual(ctxPur.heuristiquePhishing_('Changement de mot de passe effectué', []), false); // credentiels seuls
  assert.strictEqual(ctxPur.heuristiquePhishing_('Relevé mensuel', ['releve.pdf']), false);
});

test('adresseExpediteur_ : adresse nue, minuscule — JAMAIS le nom affiché (usurpable)', () => {
  assert.strictEqual(ctxPur.adresseExpediteur_('PayPal Sécurité <ARNAQUE@evil.ru>'), 'arnaque@evil.ru');
  assert.strictEqual(ctxPur.adresseExpediteur_('info@endorphine.ca'), 'info@endorphine.ca');
});

test('parserMiniCategorie_ : catégorie acceptée SEULEMENT si dans la liste (exacte)', () => {
  const valides = ['Finance', 'Finance/Impôt'];
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Finance/Impôt","suspect":false}', valides)),
    { categorie: 'Finance/Impôt', suspect: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Impôts","suspect":false}', valides)),
    { categorie: null, suspect: false }); // inventée → doute
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('illisible', valides)),
    { categorie: null, suspect: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Finance","suspect":true}', valides)),
    { categorie: 'Finance', suspect: true });
});

test('parserMiniCategorie_ : variante accents/casse → rend le nom EXACT du libellé de Marc', () => {
  const valides = ['Finance/Impôt', 'Administration/Amende'];
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"finance/impot","suspect":false}', valides)).categorie,
    'Finance/Impôt');
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"ADMINISTRATION/AMENDE","suspect":false}', valides)).categorie,
    'Administration/Amende');
  assert.strictEqual(plain(ctxPur.parserMiniCategorie_('{"categorie":"Impôts et taxes","suspect":false}', valides)).categorie,
    null); // vraie invention → doute, comme avant
});

/* ---------- orchestration (mocks) ---------- */

function ctxTri(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  const calls = { index: { ...(opts.index || {}) }, ajouts: [], labels: [], archives: [], journaux: [], getMessages: 0,
    // rattrapage ET nettoyage profond (C28-22) OFF par défaut : les tests des scans AVANT/cyclique/
    // demande ne doivent pas les déclencher (comme DriveAI_TRI_RATTRAPAGE, on pose leur « terminé »).
    props: { DriveAI_TRI_RATTRAPAGE: 'terminé', DriveAI_TRI_BOITE: 'terminé', ...(opts.props || {}) } };
  c.journalErreur_ = (s, m) => calls.journaux.push(m);
  c.journalInfo_ = () => {};
  c.budgetCampagnesAtteint_ = opts.budgetCampagnesAtteint_ || (() => false); // frein §2.6 (Cout.gs non chargé)
  c.indexContient_ = (cle) => !!calls.index[cle];
  c.indexAjouter_ = (cle, r) => { calls.index[cle] = true; calls.ajouts.push({ cle, statut: r.statut }); };
  c.toucheZoneProtegee_ = opts.zoneProtegee || (() => false);
  c.piecesJointes_ = opts.piecesJointes_ || (() => []);
  c.estPannePlateforme_ = () => false;
  c.estPromoGmail_ = opts.estPromoGmail_ || (() => true); // par défaut : la catégorie Gmail confirme le header
  c.miniCategorie_ = opts.miniCategorie_ || (() => ({ categorie: 'Finance', suspect: false }));
  c.incrementerEchec_ = (cle) => { calls.echecs = calls.echecs || {}; calls.echecs[cle] = (calls.echecs[cle] || 0) + 1; return calls.echecs[cle]; };
  c.tronquer_ = (t) => t;
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => calls.props[k] ?? null,
    setProperty: (k, v) => { calls.props[k] = v; },
  }) };
  c.feuille_ = () => ({ getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} });
  const labelObjs = {};
  for (const n of ['Finance', 'Abonnements', 'À vérifier', '⚠️ Suspect', '⏰ À traiter']) {
    labelObjs[n] = { getName: () => n, addToThread: opts.addToThread || ((t) => calls.labels.push({ label: n, fil: t.__id })) };
  }
  c.GmailApp = {
    getUserLabels: () => Object.values(labelObjs),
    search: (q, debut) => (debut === 0 ? opts.fils || [] : []),
  };
  return { c, calls };
}

function filMock(calls, { id, ts, dernierMsgId, expediteur, sujet, nonLu, unsubscribe, horsBoite }) {
  return {
    __id: id,
    getId: () => id,
    isInInbox: () => !horsBoite,
    getLastMessageDate: () => new Date(ts),
    isUnread: () => !!nonLu,
    getLabels: () => [],
    getMessages: () => {
      calls.getMessages++;
      return [{
        getId: () => dernierMsgId,
        getFrom: () => expediteur,
        getSubject: () => sujet,
        getHeader: (h) => (h === 'List-Unsubscribe' && unsubscribe ? '<mailto:u@x>' : ''),
        getPlainBody: () => 'corps anodin',
      }];
    },
    moveToArchive: () => calls.archives.push(id),
  };
}

test('tri : fil déjà trié dans CET état (fil|ts|lu) → sauté SANS charger les messages', () => {
  const { c, calls } = (() => {
    const r = ctxTri({ index: { 'tri|F1|1000|lu': true }, fils: [] });
    r.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(r.calls, { id: 'F1', ts: 1000, dernierMsgId: 'M1', expediteur: 'a@b.c', sujet: 'x' })] : []);
    return r;
  })();
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 0); // aucun chargement
  assert.deepStrictEqual(calls.labels, []);
});

test('tri : mail LU APRÈS son tri initial → RE-trié (clé |nonlu ≠ |lu) et cette fois ARCHIVÉ', () => {
  const { c, calls } = ctxTri({ index: { 'tri|G1|500|nonlu': true, 'intention|MG1': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'G1', ts: 500, dernierMsgId: 'MG1', expediteur: 'a@b.c', sujet: 'x' })] : []); // isUnread=false : Marc l'a ouvert
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.archives), ['G1']); // le cœur du rôle Cowork : lu ⇒ boîte propre
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|G1|500|lu', statut: 'trié' }]);
});

test('tri : le dernier message PAS ENCORE analysé par les intentions → on ATTEND (clé non consommée)', () => {
  const { c, calls } = ctxTri({});
  // Fil RÉCENT (dans la fenêtre intentions) : la clé `intention|` peut encore arriver — on attend.
  // (Revue C28-24 : un fil HORS fenêtre ne l'attend plus — cas couvert par son propre test.)
  const ts = Date.now() - 60 * 1000;
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F2', ts, dernierMsgId: 'M2', expediteur: 'a@b.c', sujet: 'x' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels, []);                 // rien écrit
  assert.strictEqual(calls.index[`tri|F2|${ts}|lu`], undefined); // re-tenté au prochain tick
});

test('tri : fil HORS fenêtre intentions (clé impossible à jamais) → trié SANS attendre — jamais un « attend » permanent (revue C28-24)', () => {
  const { c, calls } = ctxTri({});
  // Âge dérivé de la CONSTANTE (jamais « 30 » en dur) : un jour AU-DELÀ de la fenêtre intentions.
  const jours = Number(/newer_than:(\d+)d/.exec(c.CONFIG.GMAIL_REQUETE_ACTIONS)[1]);
  const ts = Date.now() - (jours + 1) * 24 * 3600 * 1000;
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'FV', ts, dernierMsgId: 'MV', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels.map((l) => l.label), ['Finance'], 'libellé posé sans clé intention|');
  assert.deepStrictEqual(calls.archives, ['FV'], 'fil LU ancien → archivé (l\'objectif C28-24 sur le stock)');
  assert.ok(calls.ajouts.some((a) => a.cle === `tri|FV|${ts}|lu` && a.statut === 'trié'));
});

test('estHorsFenetreIntentions_ : bornes dérivées de la CONSTANTE ; requête sans fenêtre → statu quo (attendre)', () => {
  const jours = Number(/newer_than:(\d+)d/.exec(ctxPur.CONFIG.GMAIL_REQUETE_ACTIONS)[1]);
  const maintenant = 1_800_000_000_000;
  const unJour = 24 * 3600 * 1000;
  assert.strictEqual(ctxPur.estHorsFenetreIntentions_(maintenant - (jours - 1) * unJour, maintenant), false, 'dans la fenêtre');
  assert.strictEqual(ctxPur.estHorsFenetreIntentions_(maintenant - (jours + 1) * unJour, maintenant), true, 'au-delà');
  const sansFenetre = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  sansFenetre.CONFIG.GMAIL_REQUETE_ACTIONS = 'label:tout'; // fenêtre illisible
  assert.strictEqual(sansFenetre.estHorsFenetreIntentions_(0, maintenant), false, 'illisible → on attend (prudent)');
});

test('tri : fil lu + catégorie sûre → libellé posé + archivé + indexé « trié »', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M3': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F3', ts: 3000, dernierMsgId: 'M3', expediteur: 'banque@desjardins.com', sujet: 'Relevé' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels), [{ label: 'Finance', fil: 'F3' }]);
  assert.deepStrictEqual(plain(calls.archives), ['F3']);
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|F3|3000|lu', statut: 'trié' }]);
});

test('tri : mail IMPORTANT (flag Index posé par les intentions) → ⏰ ajouté, jamais archivé', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M4': true, 'important|M4': true } });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F4', ts: 4000, dernierMsgId: 'M4', expediteur: 'x@y.z', sujet: 'Réponds-moi' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Finance', '⏰ À traiter']);
  assert.deepStrictEqual(calls.archives, []);
});

test('tri : promo déterministe (header + catégorie Gmail) NON LUE → archivée ; en zone protégée → JAMAIS', () => {
  const cas1 = ctxTri({ index: { 'intention|M5': true } });
  cas1.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(cas1.calls, { id: 'F5', ts: 5000, dernierMsgId: 'M5', expediteur: 'promo@shop.com', sujet: 'Soldes', nonLu: true, unsubscribe: true })] : []);
  cas1.c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(cas1.calls.archives), ['F5']);

  const cas2 = ctxTri({ index: { 'intention|M6': true }, zoneProtegee: () => true });
  cas2.c.GmailApp.search = (q, d) => (d === 0 ? [filMock(cas2.calls, { id: 'F6', ts: 6000, dernierMsgId: 'M6', expediteur: 'ircc@canada.ca', sujet: 'Votre dossier', nonLu: true, unsubscribe: true })] : []);
  cas2.c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(cas2.calls.archives, []);
});

test('tri : header List-Unsubscribe SEUL (forgeable) sans catégorie Gmail → PAS une promo, reste en boîte', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M5b': true }, estPromoGmail_: () => false });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F5b', ts: 5500, dernierMsgId: 'M5b', expediteur: 'phish@evil.ru', sujet: 'Notre lettre', nonLu: true, unsubscribe: true })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, []); // un phishing « déguisé en newsletter » n'est jamais masqué
});

test('tri : catégorie LLM inconnue → À vérifier, pas d\'archivage, pas d\'apprentissage', () => {
  const { c, calls } = ctxTri({ index: { 'intention|M7': true }, miniCategorie_: () => ({ categorie: null, suspect: false }) });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F7', ts: 7000, dernierMsgId: 'M7', expediteur: 'inconnu@x.y', sujet: 'Divers' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['À vérifier']);
  assert.deepStrictEqual(calls.archives, []);
  assert.deepStrictEqual(plain(calls.ajouts), [{ cle: 'tri|F7|7000|lu', statut: 'tri-a-verifier' }]);
});

test('tri : table apprise → catégorie SANS appel LLM', () => {
  let llm = 0;
  const { c, calls } = ctxTri({ index: { 'intention|M8': true }, miniCategorie_: () => { llm++; return { categorie: 'Finance', suspect: false }; } });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F8', ts: 8000, dernierMsgId: 'M8', expediteur: 'Shop <PROMO@shop.com>', sujet: 'Infos' })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 0);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Abonnements']);
});

test('tri : PJ exécutable → ⚠️ Suspect par l\'heuristique SEULE, sans dépenser un appel LLM', () => {
  let llm = 0;
  const { c, calls } = ctxTri({ index: { 'intention|M9': true },
    miniCategorie_: () => { llm++; return { categorie: 'Finance', suspect: false }; },
    piecesJointes_: () => [{ getName: () => 'facture.exe' }] });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F9x', ts: 9000, dernierMsgId: 'M9', expediteur: 'x@y.z', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 0);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
  assert.deepStrictEqual(calls.archives, []);
});

test('tri : plafond TRI_MAX_FILS_PAR_RUN respecté (écritures bornées par run)', () => {
  const { c, calls } = ctxTri({});
  c.CONFIG.TRI_MAX_FILS_PAR_RUN = 2;
  const fils = [];
  for (let i = 0; i < 5; i++) {
    calls.index['intention|MM' + i] = true;
    fils.push(filMock(calls, { id: 'FF' + i, ts: 100 + i, dernierMsgId: 'MM' + i, expediteur: 'a@b.c', sujet: 's' }));
  }
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.ajouts.length, 2);
});

test('tri : plafond TRI_MAX_ATTENTES — une page de fils « en attente » ne re-facture pas sans borne', () => {
  const { c, calls } = ctxTri({});
  c.CONFIG.TRI_MAX_ATTENTES = 2;
  const fils = [];
  for (let i = 0; i < 5; i++) { // fils RÉCENTS sans intention indexée → tous « attend » (revue C28-24)
    fils.push(filMock(calls, { id: 'AT' + i, ts: Date.now() - 1000 - i, dernierMsgId: 'MA' + i, expediteur: 'a@b.c', sujet: 's' }));
  }
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 2); // le 3ᵉ fil n'est même pas chargé
});

/* ---------- scan ARRIÈRE (rattrapage du stock — ancre FIXE + offset sur ensemble figé) ---------- */

test('rattrapage : ancre/borne posées UNE fois, lot complet → OFFSET avance, page vide → « terminé »', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MA1': true, 'intention|MA2': true }, props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  const anciens = [
    filMock(calls, { id: 'A1', ts: 1111, dernierMsgId: 'MA1', expediteur: 'a@b.c', sujet: 's1' }),
    filMock(calls, { id: 'A2', ts: 2222, dernierMsgId: 'MA2', expediteur: 'a@b.c', sujet: 's2' }),
  ];
  let requeteArriere = null;
  let appels = 0;
  // appel 0 = scan AVANT (vide : rien de neuf) ; appel 1 = scan ARRIÈRE (le stock) ; ensuite vide.
  c.GmailApp.search = (q) => {
    const n = appels++;
    if (n === 1) { requeteArriere = q; return anciens; }
    return [];
  };
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.ajouts.length, 2);
  assert.match(calls.props.DriveAI_TRI_ANCRE, /^\d{4}\/\d{2}\/\d{2}$/);   // ancre FIXE posée une fois
  assert.match(calls.props.DriveAI_TRI_BORNE, /^\d{4}\/\d{2}\/\d{2}$/);   // borne basse (ancre − 31 j)
  assert.strictEqual(requeteArriere, 'after:' + calls.props.DriveAI_TRI_BORNE + ' before:' + calls.props.DriveAI_TRI_ANCRE); // ensemble FIGÉ (deux dates fixes)
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, '2');                 // lot complet → l'offset avance
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, 'terminé');       // page vide → figé, coût nul ensuite
});

test('rattrapage : un fil du lot ATTEND les intentions → OFFSET inchangé (le lot est rejoué, idempotent)', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MB1': true }, props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  // Fils RÉCENTS (dans la fenêtre intentions — revue C28-24 : un fil hors fenêtre n'attend plus).
  const tsB1 = Date.now() - 1000;
  const anciens = [
    filMock(calls, { id: 'B1', ts: tsB1, dernierMsgId: 'MB1', expediteur: 'a@b.c', sujet: 's' }),
    filMock(calls, { id: 'B2', ts: Date.now() - 2000, dernierMsgId: 'MB2', expediteur: 'a@b.c', sujet: 's' }), // pas d'intention|MB2
  ];
  let appels = 0;
  c.GmailApp.search = () => (appels++ === 1 ? anciens : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, undefined);      // pas d'avance
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, undefined);  // pas de faux « terminé »
  assert.strictEqual(calls.index[`tri|B1|${tsB1}|lu`], true);         // l'acquis du lot est gardé (rejeu gratuit)
});

test('rattrapage : fil déjà HORS boîte → sauté sans chargement ni coût, l\'offset avance quand même', () => {
  const { c, calls } = ctxTri({ props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
  c.CONFIG.TRI_CYCLIQUE_PAGES_PAR_RUN = 0; // épinglé : le cyclique (C28-19) a ses propres tests
  const anciens = [
    filMock(calls, { id: 'H1', ts: 100, dernierMsgId: 'MH1', expediteur: 'a@b.c', sujet: 's', horsBoite: true }),
    filMock(calls, { id: 'H2', ts: 200, dernierMsgId: 'MH2', expediteur: 'a@b.c', sujet: 's', horsBoite: true }),
  ];
  let appels = 0;
  c.GmailApp.search = () => (appels++ === 1 ? anciens : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 0);                  // « boîte propre » : l'archivé d'avant ne coûte rien
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, '2');
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, 'terminé');
});

/* ---------- durcissements revue flotte ---------- */

test('fil portant DÉJÀ ⏰ (message antérieur important) → JAMAIS archivé, même lu', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MC1': true } });
  const fil = filMock(calls, { id: 'C1', ts: 100, dernierMsgId: 'MC1', expediteur: 'a@b.c', sujet: 'Re: suivi' });
  fil.getLabels = () => [{ getName: () => '⏰ À traiter' }];
  c.GmailApp.search = (q, d) => (d === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, []); // la décision antérieure survit aux nouveaux messages
});

test('SUSPECT recalibré — G1 : un signal suspect du LLM sur le PROPRE mail de Marc est IGNORÉ (on ne se phishe pas)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MSelf': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: true }), // le LLM flague à tort « demande urgente »
  });
  // Fil dont l'unique message vient de Marc (son propre envoi) → ref = Marc, adresse = propriétaire.
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'SELF', ts: 100, dernierMsgId: 'MSelf', expediteur: 'Marc <marc.richard4@gmail.com>', sujet: 'demande urgente de documents' })] : []);
  c.trierFilsGmail_(() => false);
  assert.ok(!calls.labels.some((l) => l.label === '⚠️ Suspect'), 'jamais ⚠️ Suspect sur son propre mail');
});

test('SUSPECT recalibré — G2 : expéditeur DÉJÀ APPRIS non requalifié suspect par le LLM seul (chemin normal)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MLearn': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: true }), // faux positif LLM (mail transactionnel légitime)
  });
  c.feuille_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [['app@desjardinsinsurance.com', 'Finance']] }), appendRow: () => {} });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'LRN', ts: 100, dernierMsgId: 'MLearn', expediteur: 'Desjardins <app@desjardinsinsurance.com>', sujet: 'Code to log on' })] : []);
  c.trierFilsGmail_(() => false);
  assert.ok(!calls.labels.some((l) => l.label === '⚠️ Suspect'), 'expéditeur de confiance : le LLM seul ne le flague plus');
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['Finance']);
});

test('SUSPECT recalibré — PJ .exe sur un expéditeur APPRIS reste ⚠️ (l\'heuristique déterministe prime sur G2)', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MExe': true },
    miniCategorie_: () => ({ categorie: 'Finance', suspect: false }),
    piecesJointes_: () => [{ getName: () => 'facture.exe' }],
  });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['connu@banque.com', 'Finance']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'EXE', ts: 100, dernierMsgId: 'MExe', expediteur: 'connu@banque.com', sujet: 'Facture' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
});

test('promo NON LUE d\'une adresse APPRISE → le signal suspect LLM est QUAND MÊME redemandé (anti-empoisonnement)', () => {
  let llm = 0;
  const { c, calls } = ctxTri({
    index: { 'intention|MD1': true },
    miniCategorie_: () => { llm++; return { categorie: 'Abonnements', suspect: true }; }, // le LLM flaire l'arnaque
  });
  c.feuille_ = (nom) => (nom === 'TriAppris'
    ? { getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} }
    : { getLastRow: () => 1, getRange: () => ({ getValues: () => [] }), appendRow: () => {} }); // Confiance VIDE (appris ≠ confiance, C28-19)
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'D1', ts: 100, dernierMsgId: 'MD1', expediteur: 'promo@shop.com', sujet: 'Offre', nonLu: true, unsubscribe: true })] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(llm, 1);                                    // re-vérifié malgré la table
  assert.deepStrictEqual(plain(calls.labels.map((l) => l.label)), ['⚠️ Suspect']);
  assert.deepStrictEqual(calls.archives, []);                    // pas masqué de la boîte
});

test('fil malade → compté puis ABANDONNÉ après 3 essais (une seule annonce, plus jamais re-journalisé)', () => {
  const { c, calls } = ctxTri({});
  const malade = { getId: () => 'MAL', isInInbox: () => true, getLastMessageDate: () => { throw new Error('boom'); } };
  c.GmailApp.search = (q, d) => (d === 0 ? [malade] : []);
  c.trierFilsGmail_(() => false); // essai 1
  c.trierFilsGmail_(() => false); // essai 2
  c.trierFilsGmail_(() => false); // essai 3 → abandon
  assert.strictEqual(calls.index['tri-abandon|MAL|'], true); // marqueur SANS ts (le ts n'a jamais pu être lu)
  assert.strictEqual(calls.journaux.filter((j) => j.includes('ABANDONNÉ')).length, 1);
  const avant = calls.journaux.length;
  c.trierFilsGmail_(() => false); // désormais sauté en 'deja' AVANT de relire la date
  assert.strictEqual(calls.journaux.length, avant);
});

test('PANNE D\'ÉCRITURE Gmail (scope/API) → SYSTÉMIQUE : le run s\'arrête, AUCUN échec imputé aux fils', () => {
  const { c, calls } = ctxTri({
    index: { 'intention|MP1': true, 'intention|MP2': true },
    addToThread: () => { throw new Error('insufficient scope'); },
  });
  const fils = [
    filMock(calls, { id: 'P1', ts: 100, dernierMsgId: 'MP1', expediteur: 'a@b.c', sujet: 's' }),
    filMock(calls, { id: 'P2', ts: 200, dernierMsgId: 'MP2', expediteur: 'a@b.c', sujet: 's' }),
  ];
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.ajouts, []);                       // rien de « fini » — tout sera rejoué
  assert.strictEqual(calls.echecs, undefined);                    // AUCUN échec compté par fil (≠ quarantaine)
  assert.strictEqual(calls.getMessages, 1);                       // le 2ᵉ fil n'est même pas chargé (run stoppé)
  assert.strictEqual(calls.journaux.filter((j) => j.includes('PANNE D\'ÉCRITURE')).length, 1);
  c.reinitialiserPanneEcriture_();                                // le tick suivant redonne sa chance
  calls.journaux.length = 0;
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.journaux.filter((j) => j.includes('PANNE D\'ÉCRITURE')).length, 1); // re-signalée, pas silencieuse
});

/* ---------- durcissements lentilles 2-3 ---------- */

test('mini-appel TRANSITOIREMENT en échec (null) → clé NON consommée, fil re-tenté (jamais « À vérifier » pour une panne)', () => {
  const { c, calls } = ctxTri({ index: { 'intention|ME1': true }, miniCategorie_: () => null });
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'E1', ts: 100, dernierMsgId: 'ME1', expediteur: 'x@y.z', sujet: 's' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels, []);
  assert.deepStrictEqual(calls.ajouts, []); // rien d'indexé → re-tenté au prochain tick
});

test('fil où MARC a répondu en dernier → catégorisé sur le message de l\'AUTRE, jamais appris sur sa propre adresse', () => {
  const appris = [];
  const { c, calls } = ctxTri({ index: { 'intention|MF2': true } });
  c.apprendreTri_ = (adresse, lib) => appris.push({ adresse, lib });
  let vuExpediteur = null;
  c.miniCategorie_ = (exp) => { vuExpediteur = exp; return { categorie: 'Finance', suspect: false }; };
  const fil = {
    __id: 'F9', getId: () => 'F9', isInInbox: () => true,
    getLastMessageDate: () => new Date(900), isUnread: () => false,
    getLabels: () => [],
    getMessages: () => [
      { getId: () => 'MF1', getFrom: () => 'Banque <conseiller@banque.com>', getSubject: () => 'Votre dossier',
        getHeader: () => '', getPlainBody: () => 'x' },
      { getId: () => 'MF2', getFrom: () => 'Marc <marc.richard4@gmail.com>', getSubject: () => 'Re: Votre dossier',
        getHeader: () => '', getPlainBody: () => 'x' },
    ],
    moveToArchive: () => calls.archives.push('F9'),
  };
  c.GmailApp.search = (q, d) => (d === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(vuExpediteur, 'Banque <conseiller@banque.com>'); // référence = l'AUTRE partie
  assert.deepStrictEqual(plain(appris), [{ adresse: 'conseiller@banque.com', lib: 'Finance' }]);
});

/* ---------- Tri À LA DEMANDE (C28-16, recentré C28-24 : in:inbox is:read, sans fenêtre) ---------- */

const REQUETE_DEMANDE = 'in:inbox is:read'; // tripwire : la requête FIGÉE du recentrage C28-24

/** Contexte demande : ctxTri + deleteProperty (les Properties de demande se purgent). */
function ctxTriDemande(opts) {
  const base = ctxTri(opts);
  base.c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => base.calls.props[k] ?? null,
    setProperty: (k, v) => { base.calls.props[k] = String(v); },
    deleteProperty: (k) => { delete base.calls.props[k]; },
  }) };
  base.c.estPanneGmail_ = () => false; // quota vivant (le scan à la demande est testé, pas la panne)
  base.c.dateGmail_ = () => opts.jour || '2026/07/15'; // « jour » piloté par le test (plafond quotidien)
  return base;
}

test('scanDemandeTri_ : demande « archiver: false » → fil traité, libellé posé, JAMAIS archivé, demande soldée', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true },
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: false, plafond: 10 }) },
    fils: [],
  });
  const fil = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture' });
  // La recherche de la DEMANDE sert le fil à l'offset 0 ; la page suivante est vide (boîte parcourue).
  c.GmailApp.search = (q, debut) => (q === REQUETE_DEMANDE && debut === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels.map((l) => l.label), ['Finance']); // libellé posé normalement
  assert.deepStrictEqual(calls.archives, []); // mail LU qui serait archivé en temps normal → PAS archivé
  assert.ok(calls.ajouts.some((a) => a.cle.indexOf('tri|F1|') === 0 && a.statut === 'trié')); // Index inchangé dans sa forme
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props), 'demande soldée (boîte parcourue)');
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in calls.props));
});

test('scanDemandeTri_ : plafond de fils respecté — le surplus est laissé au tri NORMAL (qui archive, lui)', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true, 'intention|M2': true },
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: false, plafond: 1 }) },
  });
  const fil1 = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 1' });
  const fil2 = filMock(calls, { id: 'F2', ts: 1700000100000, dernierMsgId: 'M2', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 2' });
  c.GmailApp.search = (q, debut) => {
    if (q === REQUETE_DEMANDE) return debut === 0 ? [fil1, fil2] : []; // la demande
    return debut === 0 ? [fil1, fil2] : []; // le scan avant (TRI_REQUETE)
  };
  c.trierFilsGmail_(() => false);
  // Demande (plafond 1) : F1 trié SANS archivage. Scan avant ensuite : F2 trié NORMALEMENT (archivé).
  assert.deepStrictEqual(calls.archives, ['F2'], 'seul le fil traité par le scan NORMAL est archivé');
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props), 'demande soldée (plafond atteint)');
});

test('scanDemandeTri_ : demande illisible (Property corrompue) → purgée en une fois, jamais une boucle d\'erreurs', () => {
  const { c, calls } = ctxTriDemande({ props: { DriveAI_TRI_DEMANDE: '{pas du json' }, fils: [] });
  c.GmailApp.search = () => [];
  c.trierFilsGmail_(() => false);
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props));
});

test('scanDemandeTri_ : FILE MOUVANTE — l\'offset n\'avance que des fils RESTÉS en boîte (les archivés sortent du résultat)', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|MA': true, 'intention|MS': true },
    // Le fil « evil » est flairé suspect par le mini-appel → ⚠, jamais archivé, RESTE en boîte.
    miniCategorie_: (exp) => (String(exp).indexOf('evil') !== -1
      ? { categorie: 'Finance', suspect: true } : { categorie: 'Finance', suspect: false }),
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: true, plafond: 10 }) },
    fils: [],
  });
  const filArchivable = filMock(calls, { id: 'FA', ts: 1700000000000, dernierMsgId: 'MA', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture' });
  const filSuspect = filMock(calls, { id: 'FS', ts: 1700000100000, dernierMsgId: 'MS', expediteur: 'X <a@evil.ru>', sujet: 'Frais' });
  const offsets = [];
  c.GmailApp.search = (q, debut) => {
    if (q !== REQUETE_DEMANDE) return [];
    offsets.push(debut);
    return debut === 0 ? [filArchivable, filSuspect] : [];
  };
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, ['FA'], 'le fil sain LU est archivé, le suspect reste en boîte');
  // FA archivé a QUITTÉ le résultat de `in:inbox is:read` : avancer de 2 sauterait un fil encore
  // jamais vu. La page suivante démarre à 1 — seul FS (resté en boîte) compte dans l'offset.
  assert.deepStrictEqual(offsets, [0, 1], 'offset avancé des seuls fils restants (1), pas de la page (2)');
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props), 'boîte parcourue → demande soldée');
});

/* ---------- C28-24 : plafond QUOTIDIEN de lectures du tri à la demande (patron C28-21) ---------- */

test('scanDemandeTri_ : plafond quotidien ATTEINT → retour immédiat SANS recherche, demande INTACTE (reprise demain)', () => {
  const MAX = ctxPur.CONFIG.TRI_DEMANDE_MAX_FILS_JOUR; // dérivé de la CONSTANTE, jamais de sa valeur
  const { c, calls } = ctxTriDemande({
    jour: '2026/07/15',
    props: {
      DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: true, plafond: 1000 }),
      DriveAI_TRI_DEMANDE_JOUR: '2026/07/15',
      DriveAI_TRI_DEMANDE_FILS_JOUR: String(MAX),
    },
    fils: [],
  });
  let recherchesDemande = 0;
  c.GmailApp.search = (q) => { if (q === REQUETE_DEMANDE) recherchesDemande++; return []; };
  c.trierFilsGmail_(() => false);
  assert.strictEqual(recherchesDemande, 0, 'plafond du jour atteint = zéro appel Gmail pour la demande');
  assert.ok('DriveAI_TRI_DEMANDE' in calls.props, 'demande CONSERVÉE — elle reprend demain (jamais perdue)');
});

test('scanDemandeTri_ : page RÉTRÉCIE au reliquat du jour, fils lus comptés en finally ; lendemain → compteur reparti', () => {
  const MAX = ctxPur.CONFIG.TRI_DEMANDE_MAX_FILS_JOUR;
  const PAGE = ctxPur.CONFIG.PAGE_FILS_ACTIONS;
  const tailles = [];
  // Reliquat du jour = 2 (< PAGE) → la recherche demande 2 fils ; ils sont servis, lus (comptés),
  // puis le reliquat tombe à 0 → arrêt SANS nouvelle recherche, demande intacte.
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true, 'intention|M2': true },
    jour: '2026/07/15',
    props: {
      DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: false, plafond: 100 }),
      DriveAI_TRI_DEMANDE_JOUR: '2026/07/15',
      DriveAI_TRI_DEMANDE_FILS_JOUR: String(MAX - 2),
    },
    fils: [],
  });
  const fil1 = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 1' });
  const fil2 = filMock(calls, { id: 'F2', ts: 1700000100000, dernierMsgId: 'M2', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 2' });
  c.GmailApp.search = (q, debut, n) => {
    if (q !== REQUETE_DEMANDE) return [];
    tailles.push(n);
    return debut === 0 ? [fil1, fil2] : [];
  };
  c.trierFilsGmail_(() => false);
  assert.ok(tailles[0] === 2 && tailles[0] < PAGE, 'page bornée au reliquat du jour (complétable)');
  assert.strictEqual(tailles.length, 1, 'reliquat épuisé → aucune recherche de plus ce tick');
  assert.strictEqual(calls.props.DriveAI_TRI_DEMANDE_FILS_JOUR, String(MAX), 'cumul du jour (coût CONSOMMÉ)');
  assert.ok('DriveAI_TRI_DEMANDE' in calls.props, 'demande non soldée — le reste attend demain');
  assert.strictEqual(calls.props.DriveAI_TRI_DEMANDE_OFFSET, '2', 'page complète (archiver:false → 2 restants) : offset avancé');
});

/* ---------- revue flotte C28-24 : correctifs du tri à la demande ---------- */

test('scanDemandeTri_ : fil en ERREUR → page NON complète, offset FIGÉ (jamais sauté pour toute la demande)', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true },
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ archiver: true, plafond: 10 }) },
    fils: [],
  });
  const filOk = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture' });
  const filMalade = { getId: () => 'FM', isInInbox: () => true, getLastMessageDate: () => { throw new Error('boom'); } };
  c.GmailApp.search = (q, debut) => (q === REQUETE_DEMANDE && debut === 0 ? [filOk, filMalade] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.archives, ['F1'], 'le fil sain de la page est traité normalement');
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in calls.props) || calls.props.DriveAI_TRI_DEMANDE_OFFSET === '0',
    'offset figé — le fil malade sera rejoué (déjà-vus gratuits), abandonné après QUARANTAINE_MAX');
  assert.ok('DriveAI_TRI_DEMANDE' in calls.props, 'demande NON soldée sur une page en échec');
});

test('scanDemandeTri_ : demande HÉRITÉE d\'une ancienne app (champ fenetre) → soldée SANS recherche (offset d\'une autre requête)', () => {
  const { c, calls } = ctxTriDemande({
    props: {
      DriveAI_TRI_DEMANDE: JSON.stringify({ fenetre: 7, archiver: true, plafond: 100 }),
      DriveAI_TRI_DEMANDE_OFFSET: '40', // calé sur newer_than:7d — invalide pour in:inbox is:read
    },
    fils: [],
  });
  let recherches = 0;
  c.GmailApp.search = (q) => { if (q === REQUETE_DEMANDE) recherches++; return []; };
  c.trierFilsGmail_(() => false);
  assert.strictEqual(recherches, 0, 'aucune lecture Gmail sur une demande d\'ancien format');
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props), 'demande soldée (Marc re-clique depuis l\'app à jour)');
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in calls.props), 'offset de l\'ancienne requête purgé');
});

test('trierFil_ (catch) : quota Gmail mort EN COURS de page → panne de PLATEFORME, AUCUN échec imputé au fil, une seule annonce', () => {
  const { c, calls } = ctxTri({ fils: [] });
  const filQuota = { getId: () => 'FQ', isInInbox: () => true,
    getLastMessageDate: () => { throw new Error('Service invoked too many times for one day: gmail.'); } };
  c.GmailApp.search = (q, d) => (d === 0 ? [filQuota] : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.echecs, undefined, 'aucun échec compté par fil (leçon « classer par ORIGINE »)');
  assert.ok(!calls.journaux.some((j) => j.includes('Fil non trié')), 'pas de ligne d\'échec par fil');
  assert.ok(calls.journaux.some((j) => j.includes('QUOTA GMAIL')), 'la suspension est signalée UNE fois');
  assert.strictEqual(calls.props.DriveAI_GMAIL_QUOTA !== undefined, true, 'suspension persistée');
});

/* ---------- C28-22 (ADR-0022) : nettoyage PROFOND de la boîte (> 30 j) ---------- */

// Contexte à INBOX MUTABLE : GmailApp.search sert une tranche de l'inbox ; trierFil_ RETIRE de
// l'inbox tout fil 'archive' (file mouvante réelle). C'est ce qui permet de tracer la convergence.
function ctxBoite(opts) {
  const c = load(['Config.gs', 'Gmail.gs', 'TriGmail.gs']);
  let inbox = (opts.inbox || []).slice(); // [{ id, action }]
  const props = Object.assign({}, opts.props);
  const recherches = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.GmailApp = { search: (req, offset, n) => {
    recherches.push({ req, offset, n });
    return inbox.slice(offset, offset + n).map((x) => ({ getId: () => x.id }));
  } };
  c.trierFil_ = (fil) => {
    const id = fil.getId();
    const item = inbox.find((x) => x.id === id);
    const r = item ? item.action : 'deja';
    if (r === 'archive') inbox = inbox.filter((x) => x.id !== id); // quitte la boîte
    return r;
  };
  c.signalerPanneGmail_ = () => false;
  c.signalerRetablissementGmail_ = () => {};
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  c.dateGmail_ = () => opts.jour || '2026/07/15';
  return { c, props, recherches, inbox: () => inbox };
}

const etatBoite = () => ({ traites: 0, attentes: 0 });

test('nettoyerBoiteHistorique_ : requête FIGÉE in:inbox before:<ancre −29 j>, ancre posée UNE fois', () => {
  const { c, props, recherches } = ctxBoite({ inbox: [{ id: 'x', action: 'deja' }] });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches[0].req, 'in:inbox before:2026/07/15');
  assert.strictEqual(props.DriveAI_TRI_BOITE_ANCRE, '2026/07/15');
});

test('nettoyerBoiteHistorique_ : FILE MOUVANTE — l\'offset n\'avance que des fils RESTÉS en boîte (archivés retirés)', () => {
  // Page [A(archive), R(deja)] : A quitte la boîte, R reste → offset avance de 1, pas de 2.
  const { c, props, recherches } = ctxBoite({ inbox: [{ id: 'A', action: 'archive' }, { id: 'R', action: 'deja' }] });
  const etat = etatBoite();
  c.nettoyerBoiteHistorique_(etat, () => false, [], {});
  assert.deepStrictEqual(recherches.map((r) => r.offset), [0, 1], 'offset avancé des seuls restants (1)');
  assert.strictEqual(etat.traites, 1, 'A archivé compté');
  assert.strictEqual(props.DriveAI_TRI_BOITE_FILS_JOUR, '2', 'les 2 fils LUS comptés (coût quota réel)');
});

test('nettoyerBoiteHistorique_ : convergence — vieux lus archivés en une passe, puis DEUX passes propres → « terminé »', () => {
  const inbox = [
    { id: 'A', action: 'archive' }, { id: 'B', action: 'deja' },
    { id: 'C', action: 'archive' }, { id: 'D', action: 'deja' }, // B,D non-archivables : restent
  ];
  const ctx = ctxBoite({ inbox });
  // Passe 1 (avec activité : A,C archivés) → offset remis à 0, passes propres réinitialisées.
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.deepStrictEqual(ctx.inbox().map((x) => x.id), ['B', 'D'], 'A et C ont quitté la boîte');
  assert.ok(!('DriveAI_TRI_BOITE_PASSES_PROPRES' in ctx.props), 'activité → compteur de passes propres réinitialisé');
  assert.notStrictEqual(ctx.props.DriveAI_TRI_BOITE, 'terminé');
  // Passe 2 (rien à faire : B,D « deja ») → 1re passe propre.
  ctx.props.DriveAI_TRI_BOITE_JOUR = '2026/07/14'; // reliquat quotidien ré-ouvert (nouveau jour)
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(ctx.props.DriveAI_TRI_BOITE_PASSES_PROPRES, '1');
  // Passe 3 (toujours rien) → 2e passe propre consécutive → campagne TERMINÉE.
  ctx.props.DriveAI_TRI_BOITE_JOUR = '2026/07/13';
  ctx.c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(ctx.props.DriveAI_TRI_BOITE, 'terminé', 'les non-archivables restants ne bloquent jamais la fin');
});

test('nettoyerBoiteHistorique_ : plafond quotidien atteint → retour immédiat SANS recherche, campagne intacte', () => {
  const MAX = ctxPur.CONFIG.TRI_BOITE_MAX_FILS_JOUR; // dérivé de la CONSTANTE
  const { c, props, recherches } = ctxBoite({
    props: { DriveAI_TRI_BOITE_JOUR: '2026/07/15', DriveAI_TRI_BOITE_FILS_JOUR: String(MAX) },
    inbox: [{ id: 'x', action: 'archive' }],
  });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches.length, 0, 'plafond du jour atteint = zéro appel Gmail');
  assert.notStrictEqual(props.DriveAI_TRI_BOITE, 'terminé', 'campagne non soldée — reprise demain');
});

test('nettoyerBoiteHistorique_ : campagne « terminé » → aucune recherche (coût nul ensuite)', () => {
  const { c, recherches } = ctxBoite({ props: { DriveAI_TRI_BOITE: 'terminé' }, inbox: [{ id: 'x', action: 'archive' }] });
  c.nettoyerBoiteHistorique_(etatBoite(), () => false, [], {});
  assert.strictEqual(recherches.length, 0);
});

test('trierFilsGmail_ : le nettoyage profond est GATÉ sur le frein campagnes §2.6 (jamais quand le budget est atteint)', () => {
  const { c, calls } = ctxTri({ props: {}, budgetCampagnesAtteint_: () => true }); // frein actif, deep clean ré-activé (pas de 'terminé')
  delete calls.props.DriveAI_TRI_BOITE;
  let deepCleanAppele = false;
  c.nettoyerBoiteHistorique_ = () => { deepCleanAppele = true; };
  c.GmailApp.search = () => [];
  c.trierFilsGmail_(() => false);
  assert.strictEqual(deepCleanAppele, false, 'frein campagnes atteint → pas de nettoyage profond');
});
