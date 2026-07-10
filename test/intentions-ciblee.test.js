'use strict';
/**
 * C28-06 (plan P2) — Analyse ciblée des mails + création manuelle depuis un fil.
 *  - `validerRequeteCiblee_` (pur, WebApp.gs) : requête Gmail = donnée UTILISATEUR via HTTP
 *    (jamais de spam/corbeille : `in:spam|trash|anywhere` refusés).
 *  - `actionAnalyseCiblee_` : dépôt = Properties (offset/échecs/pause effacés AVANT la requête),
 *    anti-rafale, requête jamais journalisée en clair.
 *  - `balayerAnalyseCiblee_` (Intentions.gs) : campagne bornée — frein budget (annoncé 1×),
 *    plafonds/run, offset LIÉ à sa requête et avancé par FIL complété, un déjà-vu ne consomme
 *    jamais le plafond (anti-plateau), échec de recherche transitoire jusqu'à
 *    `CONFIG.CIBLEE_ECHECS_MAX` (cas dérivés de la constante, jamais de sa valeur du jour),
 *    spam/corbeille exclus d'office.
 *  - `traiterMessagePourIntentions_` : un fil marqué `intention-manuel|<threadId>` est sauté
 *    EN ENTIER (préfixe dédié — jamais `intention|<threadId>`, collision messageId/threadId).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- validerRequeteCiblee_ (pur) ---------- */

const ctxWeb = load(['Config.gs', 'WebApp.gs']);

test('validerRequeteCiblee_ : chaîne 3..200 une seule ligne, espaces compactés, le reste → null', () => {
  // 3/200 = contrat de la fonction (message d'erreur utilisateur), pas une valeur CONFIG.
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('  label:Factures   older_than:60d '), 'label:Factures older_than:60d');
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('ab'), null);              // trop court
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('x'.repeat(201)), null);   // trop long
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('x'.repeat(200)), 'x'.repeat(200)); // borne incluse
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('a\nb libre'), null);      // saut de ligne → refus
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('a\tb libre'), null);      // tab → refus
  assert.strictEqual(ctxWeb.validerRequeteCiblee_(42), null);
  assert.strictEqual(ctxWeb.validerRequeteCiblee_(null), null);
  assert.strictEqual(ctxWeb.validerRequeteCiblee_(['label:x']), null);
});

test('validerRequeteCiblee_ : spam/corbeille refusés (revue sécurité — les scans n\'y mettent jamais les pieds)', () => {
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('in:spam factures'), null);
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('factures in:trash'), null);
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('IN:ANYWHERE factures'), null); // insensible à la casse
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('(in:spam) x'), null);          // après une parenthèse
  // Mais un simple mot contenant « in: » ailleurs ne déclenche pas de faux refus.
  assert.strictEqual(ctxWeb.validerRequeteCiblee_('label:linspam factures'), 'label:linspam factures');
});

/* ---------- actionAnalyseCiblee_ (dépôt) ---------- */

function fauxProps(initial) {
  const donnees = Object.assign({}, initial);
  return {
    donnees,
    getProperty: (k) => (k in donnees ? donnees[k] : null),
    setProperty: (k, v) => { donnees[k] = String(v); },
    deleteProperty: (k) => { delete donnees[k]; },
  };
}

function ctxDepot(initial) {
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = fauxProps(initial);
  const journal = [];
  c.PropertiesService = { getScriptProperties: () => props };
  c.journalInfo_ = (src, msg) => journal.push(msg);
  return { c, props, journal };
}

function requeteHttp(requete) {
  return { parameter: { action: 'analyse-ciblee' }, postData: { contents: JSON.stringify({ requete }) } };
}

test('actionAnalyseCiblee_ : dépôt valide → QUERY posée, offset/échecs/pause de l\'ancienne campagne effacés', () => {
  const { c, props } = ctxDepot({
    DriveAI_CUSTOM_SCAN_OFFSET: '{"q":"vieux","offset":40}',
    DriveAI_CUSTOM_SCAN_ECHECS: '2',
    DriveAI_CUSTOM_SCAN_PAUSE: 'vieux',
  });
  const rep = c.actionAnalyseCiblee_(requeteHttp('label:Factures'));
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_QUERY, 'label:Factures');
  assert.ok(!('DriveAI_CUSTOM_SCAN_OFFSET' in props.donnees));
  assert.ok(!('DriveAI_CUSTOM_SCAN_ECHECS' in props.donnees));
  assert.ok(!('DriveAI_CUSTOM_SCAN_PAUSE' in props.donnees));
});

test('actionAnalyseCiblee_ : la requête n\'apparaît JAMAIS en clair dans le Journal (vie privée)', () => {
  const { c, journal } = ctxDepot({});
  c.actionAnalyseCiblee_(requeteHttp('label:Immigration avocat'));
  assert.ok(journal.length > 0);
  assert.ok(journal.every((m) => !m.includes('Immigration')));
});

test('actionAnalyseCiblee_ : requête invalide → refus SANS toucher aux Properties', () => {
  const { c, props } = ctxDepot({});
  const rep = c.actionAnalyseCiblee_(requeteHttp('ab'));
  assert.strictEqual(rep.ok, false);
  assert.ok(!('DriveAI_CUSTOM_SCAN_QUERY' in props.donnees));
});

test('actionAnalyseCiblee_ : anti-rafale — un 2e dépôt immédiat est refusé', () => {
  const { c } = ctxDepot({});
  assert.strictEqual(c.actionAnalyseCiblee_(requeteHttp('label:Factures')).ok, true);
  assert.strictEqual(c.actionAnalyseCiblee_(requeteHttp('label:Impôts')).ok, false);
});

/* ---------- offsetCampagneCiblee_ (pur) ---------- */

const ctxOffset = load(['Config.gs', 'Gmail.gs', 'Intentions.gs']);

test('offsetCampagneCiblee_ : lié à SA requête — hash étranger, JSON illisible ou vide → 0', () => {
  assert.strictEqual(ctxOffset.offsetCampagneCiblee_('{"q":"h1","offset":40}', 'h1'), 40);
  assert.strictEqual(ctxOffset.offsetCampagneCiblee_('{"q":"h1","offset":40}', 'h2'), 0); // autre campagne
  assert.strictEqual(ctxOffset.offsetCampagneCiblee_('pas du JSON', 'h1'), 0);
  assert.strictEqual(ctxOffset.offsetCampagneCiblee_(null, 'h1'), 0);
  assert.strictEqual(ctxOffset.offsetCampagneCiblee_('{"q":"h1","offset":"abc"}', 'h1'), 0);
});

/* ---------- balayerAnalyseCiblee_ (campagne) ---------- */

function fauxFil(threadId, messageIds) {
  return {
    getId: () => threadId,
    getMessages: () => messageIds.map((id) => ({
      getId: () => id,
      getFrom: () => 'exp@exemple.com',
      getSubject: () => 'Sujet ' + id,
      getPlainBody: () => 'corps',
    })),
  };
}

/**
 * Contexte campagne : GmailApp.search servi par `pages` (offset → fils), le traitement de
 * message est REMPLACÉ par un compteur (la logique interne a ses propres tests), le hash de
 * requête est identitaire (`h(<requête>)`), l'Index mocké par un Set de clés.
 */
function ctxCampagne(initial, pages, options) {
  options = options || {};
  const c = load(['Config.gs', 'Gmail.gs', 'Intentions.gs']);
  const props = fauxProps(initial);
  const appels = { recherches: [], traites: [], journal: [], erreurs: [] };
  const index = options.index || {};
  c.PropertiesService = { getScriptProperties: () => props };
  c.GmailApp = {
    search: (requete, offset, taille) => {
      appels.recherches.push({ requete, offset, taille });
      if (options.rechercheJette) throw new Error('Service invoked too many times');
      return pages[offset] || [];
    },
  };
  c.hashHex_ = (s) => 'h(' + s + ')';
  c.indexContient_ = (cle) => !!index[cle];
  c.budgetCampagnesAtteint_ = () => !!options.budgetAtteint;
  c.traiterMessagePourIntentions_ = (m, threadId) => { appels.traites.push({ id: m.getId(), threadId }); return 0; };
  c.journalInfo_ = (src, msg) => appels.journal.push(msg);
  c.journalErreur_ = (src, msg) => appels.erreurs.push(msg);
  return { c, props, appels };
}

test('balayerAnalyseCiblee_ : aucune requête déposée → aucun appel Gmail', () => {
  const { c, appels } = ctxCampagne({}, {});
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false);
  assert.strictEqual(appels.recherches.length, 0);
});

test('balayerAnalyseCiblee_ : spam/corbeille exclus d\'office de la recherche (défense en profondeur)', () => {
  const pages = { 0: [] };
  const { c, appels } = ctxCampagne({ DriveAI_CUSTOM_SCAN_QUERY: 'label:X' }, pages);
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false);
  assert.strictEqual(appels.recherches[0].requete, 'label:X -in:spam -in:trash');
});

test('balayerAnalyseCiblee_ : page traitée ENTIÈRE → offset lié à la requête, page vide → campagne soldée', () => {
  const pages = { 0: [fauxFil('F1', ['M1', 'M2']), fauxFil('F2', ['M3'])] }; // offset 2 → vide
  const { c, props, appels } = ctxCampagne({ DriveAI_CUSTOM_SCAN_QUERY: 'label:X' }, pages);
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false);
  // Les 3 messages passés au traitement, avec le threadId de LEUR fil (skip manuel possible).
  assert.deepStrictEqual(appels.traites.map((t) => t.id), ['M1', 'M2', 'M3']);
  assert.deepStrictEqual(appels.traites.map((t) => t.threadId), ['F1', 'F1', 'F2']);
  // Terminaison : tout est soldé (la campagne ne rejouera pas à vie).
  assert.ok(!('DriveAI_CUSTOM_SCAN_QUERY' in props.donnees));
  assert.ok(!('DriveAI_CUSTOM_SCAN_OFFSET' in props.donnees));
});

test('balayerAnalyseCiblee_ : les DÉJÀ-VUS ne consomment jamais le plafond d\'analyses (anti-plateau, revue quotas)', () => {
  const pages = { 0: [fauxFil('F1', ['M1', 'M2']), fauxFil('F2', ['M3'])], 2: [] };
  const etat = { analyses: 0, creations: 0 };
  const { c } = ctxCampagne({ DriveAI_CUSTOM_SCAN_QUERY: 'label:X' }, pages, {
    index: { 'intention|M1': true, 'intention-manuel|F2': true }, // M1 déjà indexé, F2 manuel
  });
  c.balayerAnalyseCiblee_(etat, () => false);
  assert.strictEqual(etat.analyses, 1); // seul M2 coûte — M1 (indexé) et M3 (fil manuel) gratuits
});

test('balayerAnalyseCiblee_ : plafond atteint en cours de page → offset avancé par FIL COMPLÉTÉ, requête conservée', () => {
  const pages = { 0: [fauxFil('F1', ['M1']), fauxFil('F2', ['M2', 'M3'])] };
  const { c, props, appels } = ctxCampagne({ DriveAI_CUSTOM_SCAN_QUERY: 'label:X' }, pages);
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => appels.traites.length >= 2); // stop pendant F2
  assert.strictEqual(appels.traites.length, 2);
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_QUERY, 'label:X');
  // F1 est complété → offset 1 (accroché au hash de la requête) ; F2 rejouera, déjà-vus gratuits.
  assert.deepStrictEqual(JSON.parse(props.donnees.DriveAI_CUSTOM_SCAN_OFFSET), { q: 'h(label:X)', offset: 1 });
});

test('balayerAnalyseCiblee_ : frein budget → PAUSE annoncée UNE seule fois (jamais 288 lignes/jour), rien effacé', () => {
  const pages = { 0: [fauxFil('F1', ['M1'])] };
  const { c, props, appels } = ctxCampagne({ DriveAI_CUSTOM_SCAN_QUERY: 'label:X' }, pages, { budgetAtteint: true });
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false);
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false); // tick suivant
  assert.strictEqual(appels.traites.length, 0);
  assert.strictEqual(appels.journal.filter((m) => m.includes('pause')).length, 1);
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_QUERY, 'label:X');
});

test('balayerAnalyseCiblee_ : échec de recherche TRANSITOIRE → réessayé, abandonné seulement à CIBLEE_ECHECS_MAX', () => {
  // Cas dérivés de la CONSTANTE (seuil−1 puis seuil) — jamais de sa valeur du jour.
  const max = ctxOffset.CONFIG.CIBLEE_ECHECS_MAX;
  const { c, props, appels } = ctxCampagne(
    { DriveAI_CUSTOM_SCAN_QUERY: 'label:X', DriveAI_CUSTOM_SCAN_ECHECS: String(max - 2) },
    {}, { rechercheJette: true }
  );
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false); // échec n° max−1 → conservé
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_QUERY, 'label:X');
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_ECHECS, String(max - 1));
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false); // échec n° max → abandon tracé
  assert.ok(!('DriveAI_CUSTOM_SCAN_QUERY' in props.donnees));
  assert.strictEqual(appels.erreurs.length, 2);
});

test('balayerAnalyseCiblee_ : une recherche SERVIE remet la série d\'échecs à zéro', () => {
  const pages = { 0: [] };
  const { c, props } = ctxCampagne(
    { DriveAI_CUSTOM_SCAN_QUERY: 'label:X', DriveAI_CUSTOM_SCAN_ECHECS: '2' }, pages
  );
  c.balayerAnalyseCiblee_({ analyses: 0, creations: 0 }, () => false);
  assert.ok(!('DriveAI_CUSTOM_SCAN_ECHECS' in props.donnees));
});

test('effacerCampagneCiblee_ : ne solde JAMAIS une requête plus récente que celle balayée (course dépôt/tick)', () => {
  const props = fauxProps({ DriveAI_CUSTOM_SCAN_QUERY: 'label:NOUVELLE' });
  ctxOffset.effacerCampagneCiblee_(props, 'label:ANCIENNE');
  assert.strictEqual(props.donnees.DriveAI_CUSTOM_SCAN_QUERY, 'label:NOUVELLE'); // le dépôt frais survit
});

/* ---------- skip d'un fil traité MANUELLEMENT ---------- */

function ctxManuel(indexInitial) {
  const c = load(['Config.gs', 'Gmail.gs', 'Intentions.gs']);
  const index = Object.assign({}, indexInitial);
  const ajouts = [];
  c.indexContient_ = (cle) => !!index[cle];
  c.indexAjouter_ = (cle, r) => { index[cle] = true; ajouts.push({ cle, statut: r.statut }); };
  c.ecarteParMotsCles_ = () => false;
  c.toucheZoneProtegee_ = () => false;
  c.miniCheckMail_ = () => ({ action: true, important: false });
  c.extraireIntentions_ = () => [];
  c.tronquer_ = (s) => s;
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.estPannePlateforme_ = () => false;
  c.libellesUtilisateur_ = () => ({});
  return { c, ajouts };
}

function fauxMessage(id) {
  return { getId: () => id, getFrom: () => 'x@y.z', getSubject: () => 'S', getPlainBody: () => 'corps' };
}

test('fil marqué intention-manuel| → TOUS ses messages sautés (aucune ligne, aucun LLM)', () => {
  const { c, ajouts } = ctxManuel({ 'intention-manuel|F1': true });
  assert.strictEqual(c.traiterMessagePourIntentions_(fauxMessage('M1'), 'F1'), 0);
  assert.strictEqual(c.traiterMessagePourIntentions_(fauxMessage('M2'), 'F1'), 0);
  assert.deepStrictEqual(ajouts, []);
});

test('collision évitée : la clé moteur intention|<id du 1er message> ne saute PAS le reste du fil', () => {
  // L'ID d'un fil Gmail EST l'ID de son 1er message : si le marqueur manuel était `intention|F1`,
  // le traitement du 1er message (clé intention|F1) ferait sauter M2 à tort. Préfixe dédié = pas ça.
  const { c, ajouts } = ctxManuel({ 'intention|F1': true }); // 1er message déjà traité par le moteur
  assert.strictEqual(c.traiterMessagePourIntentions_(fauxMessage('M2'), 'F1'), 0); // M2 pas encore vu
  assert.ok(ajouts.some((a) => a.cle === 'intention|M2')); // il est bien ANALYSÉ, pas sauté
});

test('sans marqueur manuel : traitement normal (non-régression)', () => {
  const { c, ajouts } = ctxManuel({});
  c.traiterMessagePourIntentions_(fauxMessage('M9'), 'F9');
  assert.ok(ajouts.some((a) => a.cle === 'intention|M9'));
});

/* ---------- Analyse des intentions À LA DEMANDE (C28-16) ---------- */

test('balayerNouveauxMails_ : demande posée → IGNORE le mur « déjà vu », avance l\'offset persisté, solde en fin de fenêtre', () => {
  const c = load(['Config.gs', 'Gmail.gs', 'Intentions.gs']);
  const props = { DriveAI_INTENTIONS_DEMANDE: String(1780000000000) };
  const journaux = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.journalInfo_ = (s, m) => journaux.push(m);
  c.journalErreur_ = () => {};
  c.indexContient_ = () => true;           // TOUT est déjà vu : le scan normal s'arrêterait page 1
  c.traiterMessagePourIntentions_ = () => 0;
  const filDejaVu = { getId: () => 'T1', getMessages: () => [{ getId: () => 'M1' }] };
  const PAGE = c.CONFIG.PAGE_FILS_ACTIONS;
  c.pageFilsActions_ = (debut) => (debut < PAGE * 2 ? [filDejaVu] : []); // 2 pages puis fenêtre épuisée
  const etat = { analyses: 0, creations: 0 };
  c.balayerNouveauxMails_(etat, () => false);
  // Mur ignoré (2 pages parcourues malgré le 100 % déjà-vu), déjà-vus SANS consommer le plafond,
  // demande soldée à la fenêtre épuisée.
  assert.strictEqual(etat.analyses, 0, 'un déjà-vu ne consomme jamais le plafond en mode demande (anti-plateau)');
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE' in props), 'demande soldée');
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE_OFFSET' in props));
  assert.ok(journaux.some((m) => m.indexOf('Analyse à la demande terminée') !== -1));

  // Sans demande : même contexte 100 % déjà-vu → arrêt page 1 (comportement historique intact).
  const etat2 = { analyses: 0, creations: 0 };
  let pages = 0;
  c.pageFilsActions_ = (debut) => { pages++; return debut < PAGE * 2 ? [filDejaVu] : []; };
  c.balayerNouveauxMails_(etat2, () => false);
  assert.strictEqual(pages, 1, 'sans demande, le mur du déjà-vu arrête toujours le scan à la 1ʳᵉ page');
});
