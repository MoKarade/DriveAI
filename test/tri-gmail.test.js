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
    props: { DriveAI_TRI_RATTRAPAGE: 'terminé', ...(opts.props || {}) } }; // rattrapage OFF par défaut (tests du scan AVANT)
  c.journalErreur_ = (s, m) => calls.journaux.push(m);
  c.journalInfo_ = () => {};
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
  c.GmailApp.search = (q, d) => (d === 0 ? [filMock(calls, { id: 'F2', ts: 2000, dernierMsgId: 'M2', expediteur: 'a@b.c', sujet: 'x' })] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels, []);                 // rien écrit
  assert.strictEqual(calls.index['tri|F2|2000|lu'], undefined); // re-tenté au prochain tick
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
  c.feuille_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} });
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
  for (let i = 0; i < 5; i++) { // AUCUNE intention indexée → tous « attend »
    fils.push(filMock(calls, { id: 'AT' + i, ts: 100 + i, dernierMsgId: 'MA' + i, expediteur: 'a@b.c', sujet: 's' }));
  }
  c.GmailApp.search = (q, d) => (d === 0 ? fils : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.getMessages, 2); // le 3ᵉ fil n'est même pas chargé
});

/* ---------- scan ARRIÈRE (rattrapage du stock — ancre FIXE + offset sur ensemble figé) ---------- */

test('rattrapage : ancre/borne posées UNE fois, lot complet → OFFSET avance, page vide → « terminé »', () => {
  const { c, calls } = ctxTri({ index: { 'intention|MA1': true, 'intention|MA2': true }, props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
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
  const anciens = [
    filMock(calls, { id: 'B1', ts: 1000, dernierMsgId: 'MB1', expediteur: 'a@b.c', sujet: 's' }),
    filMock(calls, { id: 'B2', ts: 2000, dernierMsgId: 'MB2', expediteur: 'a@b.c', sujet: 's' }), // pas d'intention|MB2
  ];
  let appels = 0;
  c.GmailApp.search = () => (appels++ === 1 ? anciens : []);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(calls.props.DriveAI_TRI_OFFSET, undefined);      // pas d'avance
  assert.strictEqual(calls.props.DriveAI_TRI_RATTRAPAGE, undefined);  // pas de faux « terminé »
  assert.strictEqual(calls.index['tri|B1|1000|lu'], true);            // l'acquis du lot est gardé (rejeu gratuit)
});

test('rattrapage : fil déjà HORS boîte → sauté sans chargement ni coût, l\'offset avance quand même', () => {
  const { c, calls } = ctxTri({ props: {} });
  delete calls.props.DriveAI_TRI_RATTRAPAGE;
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
  c.feuille_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [['connu@banque.com', 'Finance']] }), appendRow: () => {} });
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
  c.feuille_ = () => ({ getLastRow: () => 2, getRange: () => ({ getValues: () => [['promo@shop.com', 'Abonnements']] }), appendRow: () => {} });
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

/* ---------- Tri À LA DEMANDE (C28-16) ---------- */

/** Contexte demande : ctxTri + deleteProperty (les Properties de demande se purgent). */
function ctxTriDemande(opts) {
  const base = ctxTri(opts);
  base.c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => base.calls.props[k] ?? null,
    setProperty: (k, v) => { base.calls.props[k] = String(v); },
    deleteProperty: (k) => { delete base.calls.props[k]; },
  }) };
  base.c.estPanneGmail_ = () => false; // quota vivant (le scan à la demande est testé, pas la panne)
  return base;
}

test('scanDemandeTri_ : demande « archiver: false » → fil traité, libellé posé, JAMAIS archivé, demande soldée', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true },
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ fenetre: 7, archiver: false, plafond: 10 }) },
    fils: [],
  });
  const fil = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture' });
  // La recherche de la DEMANDE sert le fil à l'offset 0 ; la page suivante est vide (fenêtre épuisée).
  c.GmailApp.search = (q, debut) => (q.indexOf('newer_than:7d') === 0 && debut === 0 ? [fil] : []);
  c.trierFilsGmail_(() => false);
  assert.deepStrictEqual(calls.labels.map((l) => l.label), ['Finance']); // libellé posé normalement
  assert.deepStrictEqual(calls.archives, []); // mail LU qui serait archivé en temps normal → PAS archivé
  assert.ok(calls.ajouts.some((a) => a.cle.indexOf('tri|F1|') === 0 && a.statut === 'trié')); // Index inchangé dans sa forme
  assert.ok(!('DriveAI_TRI_DEMANDE' in calls.props), 'demande soldée (fenêtre épuisée)');
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in calls.props));
});

test('scanDemandeTri_ : plafond de fils respecté — le surplus est laissé au tri NORMAL (qui archive, lui)', () => {
  const { c, calls } = ctxTriDemande({
    index: { 'intention|M1': true, 'intention|M2': true },
    props: { DriveAI_TRI_DEMANDE: JSON.stringify({ fenetre: 30, archiver: false, plafond: 1 }) },
  });
  const fil1 = filMock(calls, { id: 'F1', ts: 1700000000000, dernierMsgId: 'M1', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 1' });
  const fil2 = filMock(calls, { id: 'F2', ts: 1700000100000, dernierMsgId: 'M2', expediteur: 'EDF <f@edf.fr>', sujet: 'Facture 2' });
  c.GmailApp.search = (q, debut) => {
    if (q.indexOf('newer_than:30d') === 0) return debut === 0 ? [fil1, fil2] : []; // la demande
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
