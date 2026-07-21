'use strict';
/**
 * Recherche IA du doPost (C21-03) — les deux fonctions PURES qui encadrent le LLM :
 * `validerQuestionIA_` (donnée UTILISATEUR via HTTP) et `parserPlanIA_` (sortie LLM = donnée
 * non fiable : whitelist stricte, types forcés, domaine borné à la taxonomie, plan vide rejeté).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter, fakeFile } = require('./harness');

const ctx = load(['Config.gs', 'WebApp.gs']);
const DOMAINES = ['02 · Finances', '03 · Logement & véhicule', '04 · Immigration'];

// Les objets nés dans le contexte vm ont d'autres prototypes → normalisés avant deepStrictEqual.
const plat = (o) => JSON.parse(JSON.stringify(o));

test('validerQuestionIA_ : chaîne 3..300, espaces compactés, tout le reste → null', () => {
  assert.strictEqual(ctx.validerQuestionIA_('  les factures   Hydro  '), 'les factures Hydro');
  assert.strictEqual(ctx.validerQuestionIA_('ab'), null);              // trop court
  assert.strictEqual(ctx.validerQuestionIA_('x'.repeat(301)), null);   // trop long
  assert.strictEqual(ctx.validerQuestionIA_(42), null);                // pas une chaîne
  assert.strictEqual(ctx.validerQuestionIA_(null), null);
  assert.strictEqual(ctx.validerQuestionIA_(undefined), null);
  assert.strictEqual(ctx.validerQuestionIA_({ question: 'x' }), null); // objet
});

test('parserPlanIA_ : JSON strict accepté, champs whitelistés et bornés', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    texte: ' hydro ',
    domaine: '02 · Finances',
    annee: '2024',
    motsCles: ['facture', 'électricité'],
    explication: 'Factures Hydro-Québec de 2024.',
    champInconnu: 'jeté',
  }), DOMAINES);
  assert.deepStrictEqual(plat(plan), {
    texte: 'hydro',
    domaine: '02 · Finances',
    annee: '2024',
    motsCles: ['facture', 'électricité'],
    explication: 'Factures Hydro-Québec de 2024.',
  });
});

test('parserPlanIA_ : JSON enrobé de texte (bavardage LLM) → extrait le 1er objet', () => {
  const plan = ctx.parserPlanIA_('Voici le plan :\n{"motsCles": ["bail"]}\nVoilà.', DOMAINES);
  assert.deepStrictEqual(plat(plan.motsCles), ['bail']);
});

test('parserPlanIA_ : domaine HORS taxonomie jeté, année non-AAAA jetée, types non-chaîne jetés', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    domaine: '99 · Inventé',
    annee: 'l’an dernier',
    texte: 12,
    motsCles: ['ok', 7, '', ' aussi '],
  }), DOMAINES);
  assert.strictEqual(plan.domaine, undefined);
  assert.strictEqual(plan.annee, undefined);
  assert.strictEqual(plan.texte, undefined);
  assert.deepStrictEqual(plat(plan.motsCles), ['ok', 'aussi']); // non-chaînes et vides filtrés
});

test('parserPlanIA_ : motsCles plafonnés à 5, valeurs tronquées', () => {
  const plan = ctx.parserPlanIA_(JSON.stringify({
    motsCles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    texte: 'x'.repeat(500),
  }), DOMAINES);
  assert.strictEqual(plan.motsCles.length, 5);
  assert.strictEqual(plan.texte.length, 100);
});

test('parserPlanIA_ : bloc markdown ```json … ``` → extrait quand même l’objet', () => {
  const plan = ctx.parserPlanIA_('```json\n{"motsCles": ["bail"]}\n```', DOMAINES);
  assert.deepStrictEqual(plat(plan.motsCles), ['bail']);
});

test('parserPlanIA_ : DEUX objets JSON dans la sortie → repli null (regex gourmande, comportement figé)', () => {
  assert.strictEqual(ctx.parserPlanIA_('{"motsCles":["a"]} puis {"motsCles":["b"]}', DOMAINES), null);
});

test('parserPlanIA_ : illisible ou VIDE → null (jamais un plan fantôme)', () => {
  assert.strictEqual(ctx.parserPlanIA_(null, DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('', DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('pas de JSON ici', DOMAINES), null);
  assert.strictEqual(ctx.parserPlanIA_('[1,2]', DOMAINES), null); // pas un objet exploitable
  // Tous les champs invalides ⇒ plan vide ⇒ null (l'app ne doit rien exécuter).
  assert.strictEqual(ctx.parserPlanIA_(JSON.stringify({ domaine: 'inconnu', motsCles: [] }), DOMAINES), null);
});

/* ---------- Tri & intentions à la demande (C28-16) ---------- */

test('validerDemandeTri_ : archiver booléen, plafond entier borné par la CONSTANTE — fenetre IGNORÉE (C28-24), tout le reste → null', () => {
  const MAX = ctx.CONFIG.TRI_DEMANDE_PLAFOND_MAX;
  assert.deepStrictEqual(plat(ctx.validerDemandeTri_({ archiver: true, plafond: 100 })),
    { archiver: true, plafond: 100 });
  // Vieille app encore déployée : son champ `fenetre` est toléré et JETÉ (jamais persisté).
  assert.deepStrictEqual(plat(ctx.validerDemandeTri_({ fenetre: 7, archiver: false, plafond: MAX })),
    { archiver: false, plafond: MAX });
  assert.strictEqual(ctx.validerDemandeTri_({ archiver: 'oui', plafond: 10 }), null);  // archiver non booléen
  assert.strictEqual(ctx.validerDemandeTri_({ archiver: true, plafond: 0 }), null);    // plafond < 1
  assert.strictEqual(ctx.validerDemandeTri_({ archiver: true, plafond: MAX + 1 }), null); // > constante
  assert.strictEqual(ctx.validerDemandeTri_({ archiver: true, plafond: 2.5 }), null);  // non entier
  assert.strictEqual(ctx.validerDemandeTri_(null), null);
  assert.strictEqual(ctx.validerDemandeTri_('archiver=true'), null);
});

function ctxDemande(sondeOk) {
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = {};
  const journaux = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.journalInfo_ = (s, m) => journaux.push(m);
  c.forcerSondeQuotaGmail_ = () => sondeOk;
  c.actionTickPonctuel_ = () => ({ ok: true, message: 'passage lancé' });
  return { c, props, journaux };
}

test('actionDemandeTri_ : quota mort (sonde forcée en échec) → { ok:false, erreur:QUOTA_GMAIL }, AUCUNE demande posée', () => {
  const { c, props } = ctxDemande(false);
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ archiver: true, plafond: 50 }) } });
  assert.deepStrictEqual(plat(r), { ok: false, erreur: 'QUOTA_GMAIL' });
  assert.ok(!('DriveAI_TRI_DEMANDE' in props));
});

test('actionDemandeTri_ : demande valide → Property posée, progression d\'une ancienne demande PURGÉE, tick ponctuel lancé', () => {
  const { c, props } = ctxDemande(true);
  props['DriveAI_TRI_DEMANDE_OFFSET'] = '40'; // reliquat d'une demande précédente
  props['DriveAI_TRI_DEMANDE_FAITS'] = '12';
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ archiver: false, plafond: 20 }) } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(JSON.parse(props['DriveAI_TRI_DEMANDE']), { archiver: false, plafond: 20 });
  assert.ok(!('DriveAI_TRI_DEMANDE_OFFSET' in props), 'offset de l\'ancienne demande purgé');
  assert.ok(!('DriveAI_TRI_DEMANDE_FAITS' in props));
});

test('actionDemandeTri_ : paramètres invalides → refus AVANT la sonde quota (une demande cassée ne coûte rien)', () => {
  const { c, props } = ctxDemande(false); // la sonde échouerait — elle ne doit pas être atteinte
  const r = c.actionDemandeTri_({ postData: { contents: JSON.stringify({ archiver: true, plafond: 0 }) } });
  assert.strictEqual(r.ok, false);
  assert.notStrictEqual(r.erreur, 'QUOTA_GMAIL'); // c'est bien la VALIDATION qui a refusé
  assert.ok(!('DriveAI_TRI_DEMANDE' in props));
});

test('actionDemandeIntentions_ : demande posée + offset purgé ; quota mort → QUOTA_GMAIL sans demande', () => {
  const ok = ctxDemande(true);
  ok.props['DriveAI_INTENTIONS_DEMANDE_OFFSET'] = '60';
  const r1 = ok.c.actionDemandeIntentions_({});
  assert.strictEqual(r1.ok, true);
  assert.ok('DriveAI_INTENTIONS_DEMANDE' in ok.props);
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE_OFFSET' in ok.props));

  const ko = ctxDemande(false);
  const r2 = ko.c.actionDemandeIntentions_({});
  assert.deepStrictEqual(plat(r2), { ok: false, erreur: 'QUOTA_GMAIL' });
  assert.ok(!('DriveAI_INTENTIONS_DEMANDE' in ko.props));
});

/* ---------- « Pas suspect » 1-clic (C28-19, ADR-0020) ---------- */

test('validerThreadId_ : hexadécimal Gmail seul — jamais un séparateur de clé d\'Index', () => {
  assert.strictEqual(ctx.validerThreadId_('19f44ecc77d92299'), '19f44ecc77d92299');
  assert.strictEqual(ctx.validerThreadId_('  19f44ecc77d92299  '), '19f44ecc77d92299'); // espaces tolérés
  assert.strictEqual(ctx.validerThreadId_('tri|abc|1'), '');   // | interdit (préfixe de purge)
  assert.strictEqual(ctx.validerThreadId_('abc'), '');          // trop court
  assert.strictEqual(ctx.validerThreadId_('a'.repeat(40)), ''); // trop long
  assert.strictEqual(ctx.validerThreadId_(null), '');
  assert.strictEqual(ctx.validerThreadId_({}), '');
});

function ctxPasSuspectWeb(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = Object.assign({}, opts.props);
  const journaux = [];
  const confiance = [];
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }) };
  c.journalInfo_ = (s, m) => journaux.push(m);
  c.adresseExpediteur_ = (from) => String(from).toLowerCase();
  c.apprendreConfiance_ = (a) => confiance.push(a);
  c.signalerPanneGmail_ = () => false;
  c.actionTickPonctuel_ = () => ({ ok: true, message: 'passage lancé' });
  c.GmailApp = {
    getThreadById: opts.getThreadById || (() => ({
      getMessages: () => [
        { getFrom: () => 'no-reply@google.com' },
        { getFrom: () => (c.CONFIG.PROPRIETAIRE_EMAIL || 'marc@x') }, // Marc a répondu en dernier
      ],
    })),
  };
  return { c, props, confiance };
}

test('actionPasSuspect_ : apprend l\'expéditeur (jamais Marc), demande posée en clé PAR FIL (atomique), tick lancé', () => {
  const { c, props, confiance } = ctxPasSuspectWeb({ props: { DriveAI_PAS_SUSPECT: JSON.stringify(['autre']) } });
  const r = c.actionPasSuspect_({ postData: { contents: JSON.stringify({ threadId: '19f44ecc77d92299' }) } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(confiance, ['no-reply@google.com'],
    'référence = dernier message PAS de Marc (sa propre réponse ne doit jamais être apprise)');
  // Revue C28-24 : une Property PAR fil — jamais de lecture-modification-écriture d'une liste
  // partagée (deux doPost concurrents s'écrasaient : clic perdu en silence).
  assert.strictEqual(props['DriveAI_PAS_SUSPECT|19f44ecc77d92299'], '1');
  assert.deepStrictEqual(JSON.parse(props.DriveAI_PAS_SUSPECT), ['autre'],
    'la liste HÉRITÉE n\'est plus touchée par doPost (consommée/convertie par le tick)');
});

test('actionPasSuspect_ : threadId invalide → refus AVANT toute lecture Gmail ; AUCUN anti-rafale (C28-24)', () => {
  const { c, props, confiance } = ctxPasSuspectWeb({});
  const r = c.actionPasSuspect_({ postData: { contents: JSON.stringify({ threadId: 'tri|x|y' }) } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(confiance.length, 0);
  assert.ok(!('DriveAI_PAS_SUSPECT' in props));

  // C28-24 (décision Marc) : l'anti-rafale 5 s est RETIRÉ — retirer plusieurs suspects
  // d'affilée doit marcher instantanément, chaque clic pose SA clé (écriture atomique).
  const rapide = ctxPasSuspectWeb({});
  const r1 = rapide.c.actionPasSuspect_({ postData: { contents: JSON.stringify({ threadId: '19f44ecc77d92299' }) } });
  const r2 = rapide.c.actionPasSuspect_({ postData: { contents: JSON.stringify({ threadId: '19f44ecc77d92300' }) } });
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(rapide.props['DriveAI_PAS_SUSPECT|19f44ecc77d92299'], '1');
  assert.strictEqual(rapide.props['DriveAI_PAS_SUSPECT|19f44ecc77d92300'], '1',
    'les deux clics rapprochés sont TOUS LES DEUX servis (aucune liste partagée à écraser)');
});

test('actionPasSuspect_ : quota Gmail mort à la lecture du fil → QUOTA_GMAIL, rien d\'appris', () => {
  const { c, confiance } = ctxPasSuspectWeb({ getThreadById: () => { throw new Error('Service invoked too many times for one day: gmail.'); } });
  c.signalerPanneGmail_ = () => true;
  const r = c.actionPasSuspect_({ postData: { contents: JSON.stringify({ threadId: '19f44ecc77d92299' }) } });
  assert.deepStrictEqual({ ok: r.ok, erreur: r.erreur }, { ok: false, erreur: 'QUOTA_GMAIL' });
  assert.strictEqual(confiance.length, 0);
});

/* ---------- Résumé hub (C28-27) : compteurs PURS ---------- */

test('compterMetriquesHub_ : classés 7 j (statut colonne 5, date colonne 1), erreurs Journal 7 j', () => {
  const maintenant = Date.parse('2026-07-21T12:00:00Z');
  const recent = new Date('2026-07-20T12:00:00Z');   // objet Date, comme getValues()
  const vieux = new Date('2026-07-01T12:00:00Z');
  const index = [
    ['Clé', 'Date', 'Nom', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance'], // en-têtes
    ['m1|0|a.pdf|123', recent, 'a.pdf', '02', 'x', 'classé', '', 0.9],
    ['m2|0|b.pdf|456', vieux, 'b.pdf', '02', 'x', 'classé', '', 0.9],                // hors fenêtre
    ['m3|0|c.pdf|789', recent, 'c.pdf', '', '', 'doublon', '', ''],                  // pas « classé »
    ['drive|F1', recent, 'd.pdf', '02', 'x', 'classé', '', 0.8],
  ];
  const journal = [
    ['Date', 'Niveau', 'Source', 'Message'],
    [recent, 'ERREUR', 'Pipeline', 'boum'],
    [vieux, 'ERREUR', 'Pipeline', 'vieux boum'],   // hors fenêtre
    [recent, 'INFO', 'Tick', 'ras'],               // pas une erreur
  ];
  const r = ctx.compterMetriquesHub_(index, journal, maintenant);
  assert.deepStrictEqual({ classes7j: r.classes7j, erreurs7j: r.erreurs7j }, { classes7j: 2, erreurs7j: 1 });
});

test('compterMetriquesHub_ : un document re-classé par campagne compte UNE fois (dédup par fileId)', () => {
  const maintenant = Date.parse('2026-07-21T12:00:00Z');
  const recent = new Date('2026-07-20T12:00:00Z');
  const index = [
    ['en-têtes'],
    ['drive|F1', recent, 'a.pdf', '02', 'x', 'classé', '', ''],
    ['migre|m2|F1', recent, 'a.pdf', '02', 'y', 'classé', '', ''],   // même fichier, campagne
    ['shared|F2', recent, 'b.pdf', '02', 'x', 'classé', '', ''],
  ];
  const r = ctx.compterMetriquesHub_(index, [['en-têtes']], maintenant);
  assert.strictEqual(r.classes7j, 2, 'F1 (drive+migre) = 1 document ; F2 = 1');
});

test('compterMetriquesHub_ : dates illisibles ignorées, jamais NaN dans les comptes', () => {
  const maintenant = Date.parse('2026-07-21T12:00:00Z');
  const index = [
    ['en-têtes'],
    ['k1', 'pas-une-date', 'a.pdf', '', '', 'classé', '', ''],
    ['k2', '', 'b.pdf', '', '', 'classé', '', ''],
  ];
  const journal = [['en-têtes'], ['pas-une-date', 'ERREUR', 'X', 'y']];
  const r = ctx.compterMetriquesHub_(index, journal, maintenant);
  assert.deepStrictEqual({ classes7j: r.classes7j, erreurs7j: r.erreurs7j }, { classes7j: 0, erreurs7j: 0 });
});

test('cleDocumentIndex_ : drive/shared/migre normalisées vers le fileId, le reste inchangé', () => {
  assert.strictEqual(ctx.cleDocumentIndex_('drive|F1'), 'doc|F1');
  assert.strictEqual(ctx.cleDocumentIndex_('shared|F1'), 'doc|F1');
  assert.strictEqual(ctx.cleDocumentIndex_('migre|m2|F1'), 'doc|F1');
  assert.strictEqual(ctx.cleDocumentIndex_('19f4|0|a.pdf|123'), '19f4|0|a.pdf|123'); // PJ Gmail
  assert.strictEqual(ctx.cleDocumentIndex_('migre|seul'), 'migre|seul');             // malformée → inchangée
});

test('tsCellule_ : objet Date (getValues) et chaîne ISO acceptés, illisible → NaN', () => {
  const d = new Date('2026-07-20T12:00:00Z');
  assert.strictEqual(ctx.tsCellule_(d), d.getTime());
  assert.strictEqual(ctx.tsCellule_('2026-07-20T12:00:00Z'), d.getTime());
  assert.ok(isNaN(ctx.tsCellule_('n/importe quoi')));
  assert.ok(isNaN(ctx.tsCellule_(null)) || isNaN(ctx.tsCellule_('null')));
});

/* ---------- Résumé hub (C28-27) : lecture Property + pré-calcul au tick ---------- */

/** Contexte web app avec Property store et mocks Sheet/Drive injectables. */
function ctxHub(opts) {
  opts = opts || {};
  const c = load(['Config.gs', 'WebApp.gs']);
  const props = Object.assign({}, opts.props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
  }) };
  c.feuille_ = (nom) => ({ getDataRange: () => ({ getValues: () => (opts.feuilles || {})[nom] || [[]] }) });
  c.DriveApp = { getFolderById: () => ({ getFiles: () => iter(opts.fichiersRevue || []) }) };
  return { c, props };
}

test('actionHubSummary_ : Property absente → lastRunAt null (broker rendra « building »)', () => {
  const { c } = ctxHub({});
  assert.deepStrictEqual(plat(c.actionHubSummary_()), {
    ok: true,
    etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: null },
  });
});

test('actionHubSummary_ : lit la Property pré-calculée telle quelle (aucun calcul)', () => {
  const etat = { reviewQueueCount: 2, filedLast7d: 14, errorsLast7d: 1, lastRunAt: '2026-07-21T20:00:00.000Z' };
  const { c } = ctxHub({ props: { DriveAI_HUB_SUMMARY: JSON.stringify(etat) } });
  assert.deepStrictEqual(plat(c.actionHubSummary_()), { ok: true, etat });
});

test('majResumeHub_ : calcule les 4 métriques et les persiste dans DriveAI_HUB_SUMMARY', () => {
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000); // < 7 j quelle que soit l'horloge du test
  const tick = Date.now() - 5 * 60 * 1000;
  const feuilles = {
    Index: [
      ['Clé', 'Date', 'Nom', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance'],
      ['drive|F1', recent, 'a.pdf', '02', 'x', 'classé', '', 0.9],
      ['migre|m2|F1', recent, 'a.pdf', '02', 'y', 'classé', '', 0.9], // même fichier → 1
    ],
    Journal: [['Date', 'Niveau', 'Source', 'Message'], [recent, 'ERREUR', 'Pipeline', 'boum']],
  };
  const { c, props } = ctxHub({
    props: { DriveAI_LAST_TICK: String(tick) },
    feuilles,
    fichiersRevue: [fakeFile({}), fakeFile({}), fakeFile({})], // 3 en file de revue
  });
  c.majResumeHub_();
  const ecrit = JSON.parse(props.DriveAI_HUB_SUMMARY);
  assert.strictEqual(ecrit.reviewQueueCount, 3);
  assert.strictEqual(ecrit.filedLast7d, 1, 'drive|F1 + migre|m2|F1 = un seul document');
  assert.strictEqual(ecrit.errorsLast7d, 1);
  assert.strictEqual(ecrit.lastRunAt, new Date(tick).toISOString());
});

test('majResumeHub_ puis actionHubSummary_ : la lecture rend EXACTEMENT ce que le tick a écrit', () => {
  const feuilles = { Index: [['h']], Journal: [['h']] };
  const tick = Date.now() - 5 * 60 * 1000;
  const { c } = ctxHub({ props: { DriveAI_LAST_TICK: String(tick) }, feuilles, fichiersRevue: [] });
  c.majResumeHub_();
  assert.deepStrictEqual(plat(c.actionHubSummary_()), {
    ok: true,
    etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: new Date(tick).toISOString() },
  });
});
