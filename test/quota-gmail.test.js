'use strict';
/**
 * C28-15 — panne de QUOTA Gmail journalier (Gmail.gs) + ordre d'équité strict du tick :
 *  - `signalerPanneGmail_` reconnaît l'erreur RÉELLE de Google (« Service invoked too many times
 *    for one day: gmail. »), pose la suspension persistée UNE fois, et retourne true — l'appelant
 *    sort sans compter d'échec (panne de plateforme, jamais imputée à un fil).
 *  - `chargerPanneGmail_` : suspension fraîche (< GMAIL_QUOTA_RESONDE_MS) → tout le run est
 *    suspendu ; suspension périmée → re-sonde permise. Cas dérivés de la CONSTANTE (seuil−δ /
 *    seuil+δ), jamais de sa valeur du jour.
 *  - `signalerRetablissementGmail_` : un appel réussi APRÈS re-sonde efface la Property et le
 *    journalise (1 lecture de Property max par run) ; un run suspendu ne l'efface JAMAIS.
 *  - Les points d'entrée (tri, intentions, scans PJ, historique) sortent immédiatement sous
 *    suspension — plus un seul appel Gmail gaspillé (vécu : 267 lignes d'erreur le matin du 10/07).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ERREUR_QUOTA = 'Exception: Service invoked too many times for one day: gmail.';

function ctxQuota(options) {
  options = options || {};
  const props = Object.assign({}, options.props);
  const journal = [];
  const c = load(['Config.gs', 'Gmail.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
  });
  c.journalErreur_ = (s, m) => journal.push({ niveau: 'ERREUR', m });
  c.journalInfo_ = (s, m) => journal.push({ niveau: 'INFO', m });
  return { c, props, journal };
}

test('signalerPanneGmail_ : erreur de quota RÉELLE → suspension posée UNE fois, true ; autre erreur → false, rien', () => {
  const { c, props, journal } = ctxQuota();
  c.chargerPanneGmail_();
  assert.strictEqual(c.signalerPanneGmail_(new Error('Access denied: DriveApp')), false);
  assert.ok(!('DriveAI_GMAIL_QUOTA' in props), 'une erreur non-quota ne suspend jamais');

  assert.strictEqual(c.signalerPanneGmail_(new Error(ERREUR_QUOTA)), true);
  assert.strictEqual(c.estPanneGmail_(), true);
  assert.ok('DriveAI_GMAIL_QUOTA' in props, 'suspension persistée posée');
  assert.strictEqual(journal.filter((l) => l.m.indexOf('QUOTA GMAIL ÉPUISÉ') !== -1).length, 1);

  // Deuxième signal du même run : silencieux (jamais 267 lignes de journal — vécu 10/07).
  assert.strictEqual(c.signalerPanneGmail_(ERREUR_QUOTA), true); // accepte aussi une chaîne
  assert.strictEqual(journal.filter((l) => l.niveau === 'ERREUR').length, 1);
});

test('chargerPanneGmail_ : suspension fraîche → run suspendu ; périmée → re-sonde permise ; absente → normal', () => {
  const seuil = null; // les cas se dérivent de la CONSTANTE lue dans le contexte chargé
  const frais = ctxQuota({ props: {} });
  const RESONDE = frais.c.CONFIG.GMAIL_QUOTA_RESONDE_MS;

  frais.props['DriveAI_GMAIL_QUOTA'] = String(Date.now() - (RESONDE - 60 * 1000)); // seuil − 1 min
  frais.c.chargerPanneGmail_();
  assert.strictEqual(frais.c.estPanneGmail_(), true, 'suspension fraîche → suspendu');

  const perime = ctxQuota({ props: { DriveAI_GMAIL_QUOTA: String(Date.now() - (RESONDE + 60 * 1000)) } });
  perime.c.chargerPanneGmail_();
  assert.strictEqual(perime.c.estPanneGmail_(), false, 'suspension périmée → re-sonde permise');

  const vierge = ctxQuota();
  vierge.c.chargerPanneGmail_();
  assert.strictEqual(vierge.c.estPanneGmail_(), false);
});

test('signalerRetablissementGmail_ : re-sonde concluante → Property effacée + journal ; run suspendu → JAMAIS', () => {
  // Re-sonde : la Property existe encore (périmée), le run n'est PAS suspendu, un appel réussit.
  const ok = ctxQuota({ props: { DriveAI_GMAIL_QUOTA: '1' } });
  ok.c.chargerPanneGmail_(); // périmée → pas suspendu
  ok.c.signalerRetablissementGmail_();
  assert.ok(!('DriveAI_GMAIL_QUOTA' in ok.props), 'suspension levée après un succès');
  assert.strictEqual(ok.journal.filter((l) => l.m.indexOf('RÉTABLI') !== -1).length, 1);
  ok.c.signalerRetablissementGmail_(); // mémoïsé : pas de 2ᵉ lecture/journal
  assert.strictEqual(ok.journal.length, 1);

  // Run SUSPENDU : le rétablissement ne doit jamais lever la suspension (aucun appel n'a réussi).
  const susp = ctxQuota();
  susp.c.chargerPanneGmail_();
  susp.c.signalerPanneGmail_(ERREUR_QUOTA);
  susp.c.signalerRetablissementGmail_();
  assert.ok('DriveAI_GMAIL_QUOTA' in susp.props, 'un run suspendu ne se rétablit pas lui-même');
});

test('points d\'entrée sous suspension : tri, scans PJ et historique sortent SANS le moindre appel Gmail', () => {
  const appels = { gmail: 0 };
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs', 'TriGmail.gs'], {
    GmailApp: { search: () => { appels.gmail++; throw new Error('ne doit pas être appelé'); } },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_GMAIL_QUOTA' ? String(Date.now()) : null),
        setProperty: () => {},
        deleteProperty: () => {},
      }),
    },
  });
  c.journalErreur_ = () => {};
  c.journalInfo_ = () => {};
  c.libellesUtilisateur_ = () => { appels.gmail++; return {}; }; // lecture Gmail aussi
  c.chargerPanneGmail_(); // suspension fraîche chargée comme au début d'un tick

  c.traiterGmail_(() => false);
  c.traiterGmailHistorique_(() => false);
  c.trierFilsGmail_(() => false);
  assert.strictEqual(appels.gmail, 0, 'zéro appel Gmail pendant la suspension');
});

/** Contexte moteur Gmail avec un ScriptProperties mock (traiterGmail_ lit/écrit le drapeau RETARD). */
function ctxGmailProps(props) {
  props = props || {};
  const ecritures = [];
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  c.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); ecritures.push(['set', k]); },
      deleteProperty: (k) => { delete props[k]; ecritures.push(['del', k]); },
    }),
  };
  c.signalerRetablissementGmail_ = () => {};
  c.estPanneGmail_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.journalInfo_ = () => {};
  return { c, props, ecritures };
}

test('traiterGmail_ : MUR « page à jour » — une page 100 % indexée ARRÊTE la pagination, ZÉRO écriture de Property en régime (perf Vague 2)', () => {
  const { c, props, ecritures } = ctxGmailProps();
  let appelsPage = 0;
  const fil = { getMessages: () => [{ getId: () => 'M1', getFrom: () => '', getSubject: () => '', getDate: () => new Date() }] };
  c.piecesJointes_ = () => [{ getName: () => 'a.pdf', getSize: () => 100 }];
  c.cleAttachement_ = () => 'M1|0|a.pdf|100';
  c.indexContient_ = () => true;           // TOUT est déjà indexé → 0 PJ inédite
  c.pageFils_ = () => { appelsPage++; return appelsPage === 1 ? [fil, fil] : []; };

  c.traiterGmail_(() => false);
  // Sans le mur, la boucle paginerait jusqu'à la page VIDE (appelsPage === 2). Avec le mur, elle
  // s'arrête dès la page 0 (aucune PJ inédite) → une seule lecture de page.
  assert.strictEqual(appelsPage, 1, 'le mur arrête la pagination dès qu\'une page ne porte aucune PJ inédite');
  // Régime = aucun backlog : le drapeau RETARD ne doit JAMAIS être touché (sinon écriture Property
  // 288×/jour pour rien — la leçon « ne bouge qu'aux BORDS d'un backlog »).
  assert.strictEqual(ecritures.length, 0, 'aucune écriture de Property en régime');
  assert.ok(!('DriveAI_GMAIL_PJ_RETARD' in props));
});

test('traiterGmail_ : RETARD armé → le MUR est DÉSACTIVÉ, une PJ inédite enfouie en page 1 est DRAINÉE puis le drapeau levé (filet anti-backlog, revue Vague 2)', () => {
  // Backlog typique d'une reprise post-panne : page 0 = 100 % indexée (0 inédite), la PJ inédite
  // dort en page 1. Le mur naïf s'arrêterait à la page 0 et l'abandonnerait À VIE.
  const { c, props, ecritures } = ctxGmailProps({ DriveAI_GMAIL_PJ_RETARD: '1' });
  const P = c.CONFIG.PAGE_FILS;
  const filA = { id: 'A' };
  const filB = { id: 'B' };
  c.pageFils_ = (debut) => (debut === 0 ? [filA] : debut === P ? [filB] : []);
  const deposees = [];
  // filA (page 0) : 0 inédite ; filB (page 1) : 1 inédite déposée.
  c.traiterFil_ = (fil) => { if (fil.id === 'B') { deposees.push('B'); return 1; } return 0; };

  c.traiterGmail_(() => false);
  assert.deepStrictEqual(deposees, ['B'], 'la PJ inédite de la page 1 est bien drainée malgré le mur');
  // Fenêtre épuisée (page 2 vide) → le retard est LEVÉ : le mur reprendra au prochain tick.
  assert.ok(!('DriveAI_GMAIL_PJ_RETARD' in props), 'backlog drainé → drapeau levé');
  assert.ok(ecritures.some((e) => e[0] === 'del' && e[1] === 'DriveAI_GMAIL_PJ_RETARD'));
});

test('traiterGmail_ : un blip Property NE FAIT PAS avorter l\'intake — dégrade gracieusement (mur off, backlog drainé)', () => {
  // `traiterGmail_` est appelé NU avant `traiterDepots_` : une exception Property non capturée
  // sauterait tout le reste de l'intake (revue code-reviewer). L'I/O Property est enveloppée →
  // aucun throw ne remonte, et le défaut prudent `retard=true` désactive le mur (COMPLÉTUDE).
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => { throw new Error('blip Property'); }, setProperty: () => {}, deleteProperty: () => {} }) };
  c.signalerRetablissementGmail_ = () => {};
  c.estPanneGmail_ = () => false;
  c.estPannePlateforme_ = () => false;
  c.journalInfo_ = () => {};
  const P = c.CONFIG.PAGE_FILS;
  const filA = { id: 'A' }, filB = { id: 'B' };
  c.pageFils_ = (debut) => (debut === 0 ? [filA] : debut === P ? [filB] : []);
  const deposees = [];
  c.traiterFil_ = (fil) => { if (fil.id === 'B') { deposees.push('B'); return 1; } return 0; };

  // Ne doit PAS lever (sinon l'intake avorte) ET doit dépasser le mur (retard=true par défaut).
  assert.doesNotThrow(() => c.traiterGmail_(() => false));
  assert.deepStrictEqual(deposees, ['B'], 'mur désactivé malgré le blip → la PJ de la page 1 est drainée');
});

test('traiterGmail_ : une COUPE budget en plein drainage ARME le retard (le prochain tick repaginera sans le mur)', () => {
  const { c, props } = ctxGmailProps();
  const fil = { id: 'X' };
  c.pageFils_ = () => [fil, fil];
  let vus = 0;
  // Budget épuisé après le 1er fil : la fenêtre n'est PAS épuisée → retard doit s'armer.
  const estBudgetDepasse = () => vus >= 1;
  c.traiterFil_ = () => { vus++; return 1; };

  c.traiterGmail_(estBudgetDepasse);
  assert.strictEqual(props['DriveAI_GMAIL_PJ_RETARD'], '1', 'coupe avant la fin de fenêtre → retard armé');
});

test('traiterFil_ : retourne le nombre de PJ INÉDITES (0 si tout est déjà indexé, >0 sinon)', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  const fil = { getMessages: () => [{ getId: () => 'M1', getFrom: () => '', getSubject: () => '', getDate: () => new Date() }] };
  c.piecesJointes_ = () => [{ getName: () => 'a.pdf', getSize: () => 100 }, { getName: () => 'b.pdf', getSize: () => 200 }];
  c.cleAttachement_ = (m, p) => 'M1|' + p;
  let deposees = 0;
  c.traiterPjGmail_ = () => { deposees++; };

  c.indexContient_ = () => true;  // les 2 PJ déjà indexées
  assert.strictEqual(c.traiterFil_(fil, () => false), 0, 'aucune inédite → 0 (et rien déposé)');
  assert.strictEqual(deposees, 0);

  c.indexContient_ = (cle) => cle === 'M1|0'; // seule la 1re est indexée
  assert.strictEqual(c.traiterFil_(fil, () => false), 1, 'une seule inédite');
  assert.strictEqual(deposees, 1, 'seule l\'inédite est déposée');
});

test('traiterPageHistorique_ : le frein GMAIL_HISTO_MAX_FILS_PAR_RUN borne les fils PARCOURUS d\'un run', () => {
  const { c } = ctxQuota();
  // Contexte dédié : page de fils factices plus grande que le frein (cas dérivé de la CONSTANTE).
  const ctx = load(['Config.gs', 'Gmail.gs', 'Main.gs']);
  const FREIN = ctx.CONFIG.GMAIL_HISTO_MAX_FILS_PAR_RUN;
  let filsLus = 0;
  const faireFil = (i) => ({
    getId: () => { filsLus++; return 'F' + i; },
    getMessages: () => [],
  });
  const page = [];
  for (let i = 0; i < FREIN + 5; i++) page.push(faireFil(i));
  const props = { DriveAI_GMAIL_HISTO_ANCRE: '2026/06/10', DriveAI_GMAIL_HISTO_OFFSET: '0' };
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; },
    }),
  };
  ctx.pageFilsHisto_ = () => page;
  ctx.estPannePlateforme_ = () => false;
  ctx.chargerPanneGmail_();
  ctx.journalInfo_ = () => {};
  ctx.journalErreur_ = () => {};
  ctx.indexContient_ = () => true; // tout déjà indexé : la « passe de vérification » type
  ctx.piecesJointes_ = () => [];
  ctx.traiterPjGmail_ = () => {};
  ctx.incrementerEchec_ = () => 0;

  ctx.traiterPageHistorique_(ctx.PropertiesService.getScriptProperties(), () => false);
  assert.ok(filsLus <= FREIN, 'fils lus (' + filsLus + ') ≤ frein (' + FREIN + ')');
  // Page interrompue par le frein → l'offset n'avance PAS (la page rejouera, idempotente).
  assert.strictEqual(props['DriveAI_GMAIL_HISTO_OFFSET'], '0');
});