'use strict';
/**
 * Chantiers #13-#14 (ADR-0010 §2-3) — Phase 3 visible + mails importants.
 *  - `parserMiniCheck_` (pur) : deux signaux, dégradations ASYMÉTRIQUES (action ouverte,
 *    important fermé — anti-bruit, décision Marc).
 *  - `marquerMailImportant_` : ligne Index `important|<id>` idempotente, via l'orchestration
 *    de `traiterMessagePourIntentions_` (le flag est posé AVANT le tri action/pas-action).
 *  - `statsSemaine_` : collecte des actions/RDV et des mails importants, plafonnée, avec totaux.
 *  - `construireResume_` : sections « À traiter » et « Actions & RDV », absentes si vides.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// Les objets créés DANS le bac à sable vm ont un autre Object.prototype que ceux du test :
// on normalise par JSON avant deepStrictEqual (comparaison de STRUCTURE, pas de realm).
const plain = (o) => JSON.parse(JSON.stringify(o));

/* ---------- parserMiniCheck_ (pur) ---------- */

const ctxPur = load(['Config.gs', 'Prefiltre.gs']);

test('parserMiniCheck_ : JSON explicite → pris tel quel', () => {
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('{"action": true, "important": true}')),
    { action: true, important: true });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('{"action": false, "important": false}')),
    { action: false, important: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('bla {"action": false, "important": true} bla')),
    { action: false, important: true }); // extraction du 1er objet
});

test('parserMiniCheck_ : dégradations ASYMÉTRIQUES (action ouverte, important fermé)', () => {
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_(null)), { action: true, important: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('')), { action: true, important: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('réponse libre illisible')), { action: true, important: false });
  // champ manquant / mal typé : action reste ouverte, important reste fermé
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('{"important": "oui"}')), { action: true, important: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('{"action": "non"}')), { action: true, important: false });
});

test('parserMiniCheck_ : compat ancien format binaire — un NON explicite hors JSON ferme l\'action', () => {
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('NON')), { action: false, important: false });
  assert.deepStrictEqual(plain(ctxPur.parserMiniCheck_('OUI')), { action: true, important: false });
});

/* ---------- orchestration : flag important posé (idempotent), avant le tri action ---------- */

function ctxIntentions(check) {
  const c = load(['Config.gs', 'Intentions.gs']);
  const calls = { index: {}, ajouts: [] };
  c.indexContient_ = (cle) => !!calls.index[cle];
  c.indexAjouter_ = (cle, r) => { calls.index[cle] = true; calls.ajouts.push({ cle, statut: r.statut, nom: r.nom }); };
  c.ecarteParMotsCles_ = () => false;
  c.toucheZoneProtegee_ = () => false;
  c.miniCheckMail_ = () => check;
  c.extraireIntentions_ = () => []; // pas d'intention → statut intention-aucune
  c.tronquer_ = (s) => s;
  c.journalInfo_ = () => {};
  c.notifierEchec_ = () => {};
  c.estPannePlateforme_ = () => false; // garde panne de compte (Llm.gs non chargé ici)
  c.libellesUtilisateur_ = () => ({}); // ⏰ via TriGmail.gs (non chargé ici) — miroir best-effort
  return { c, calls };
}

function message(id, sujet) {
  return {
    getId: () => id,
    getFrom: () => 'exp@exemple.com',
    getSubject: () => sujet,
    getPlainBody: () => 'corps',
  };
}

test('important + pas d\'action créable → ligne important| posée QUAND MÊME (question ouverte)', () => {
  const { c, calls } = ctxIntentions({ action: false, important: true });
  c.traiterMessagePourIntentions_(message('M1', 'Peux-tu me répondre ?'));
  assert.ok(calls.index['important|M1']);
  const imp = calls.ajouts.find((a) => a.cle === 'important|M1');
  assert.strictEqual(imp.statut, 'important');
  assert.strictEqual(imp.nom, 'Peux-tu me répondre ?');
  assert.ok(calls.index['intention|M1']); // et le message reste marqué écarté (pas d'action)
});

test('important + action → les deux chemins coexistent (important| ET intention|)', () => {
  const { c, calls } = ctxIntentions({ action: true, important: true });
  c.traiterMessagePourIntentions_(message('M2', 'Échéance demain'));
  assert.ok(calls.index['important|M2']);
  assert.ok(calls.index['intention|M2']); // extraireIntentions_ → [] → intention-aucune
});

test('marquerMailImportant_ : idempotent (rejeu d\'un message en reprise → une seule ligne)', () => {
  const { c, calls } = ctxIntentions({ action: true, important: true });
  c.marquerMailImportant_('M3', 'Sujet');
  c.marquerMailImportant_('M3', 'Sujet');
  assert.strictEqual(calls.ajouts.filter((a) => a.cle === 'important|M3').length, 1);
});

test('pas important → aucune ligne important| (anti-bruit)', () => {
  const { c, calls } = ctxIntentions({ action: false, important: false });
  c.traiterMessagePourIntentions_(message('M4', 'Newsletter'));
  assert.strictEqual(calls.ajouts.some((a) => a.cle.startsWith('important|')), false);
});

test('CORPS en zone protégée + important → JAMAIS de ligne important| (bloquant revue sécurité)', () => {
  // Expéditeur/sujet neutres (la garde amont ne voit rien), corps immigration/fiscal.
  const { c, calls } = ctxIntentions({ action: false, important: true });
  c.toucheZoneProtegee_ = (texte) => texte === 'corps'; // seul le CORPS déclenche
  c.traiterMessagePourIntentions_(message('M5', 'Suivi de votre dossier'));
  assert.strictEqual(calls.ajouts.some((a) => a.cle.startsWith('important|')), false);
  const m = calls.ajouts.find((a) => a.cle === 'intention|M5');
  assert.strictEqual(m.statut, 'intention-zone-protegee');
});

test('important SANS action → le corps est quand même LU (la garde §1 corps couvre ce chemin)', () => {
  let corpsLu = 0;
  const { c, calls } = ctxIntentions({ action: false, important: true });
  const msg = {
    getId: () => 'M6', getFrom: () => 'exp@exemple.com', getSubject: () => 'Question ?',
    getPlainBody: () => { corpsLu++; return 'corps'; },
  };
  c.traiterMessagePourIntentions_(msg);
  assert.strictEqual(corpsLu, 1);           // le chemin important-sans-action lit le corps
  assert.ok(calls.index['important|M6']);   // corps sain → flag posé
});

test('rien vu par le mini-check → le corps n\'est PAS lu (chemin majoritaire gratuit)', () => {
  let corpsLu = 0;
  const { c } = ctxIntentions({ action: false, important: false });
  const msg = {
    getId: () => 'M7', getFrom: () => 'exp@exemple.com', getSubject: () => 'Newsletter',
    getPlainBody: () => { corpsLu++; return 'corps'; },
  };
  c.traiterMessagePourIntentions_(msg);
  assert.strictEqual(corpsLu, 0);
});

/* ---------- statsSemaine_ : collecte plafonnée + construireResume_ ---------- */

function ctxResume(lignes) {
  const c = load(['Config.gs', 'Resume.gs']);
  c.feuille_ = () => ({
    getLastRow: () => lignes.length + 1,
    getRange: (debut, col, nb, ncols) => ({
      getValues: () => lignes.slice(debut - 2, debut - 2 + nb).map((l) => l.slice(col - 1, col - 1 + ncols)),
    }),
  });
  return c;
}

function ligne(cle, date, nom, statut) {
  return [cle, date, nom, '', '', statut];
}

test('statsSemaine_ : collecte actions + importants dans la fenêtre, avec messageId extrait de la clé', () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const vieux = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const c = ctxResume([
    ligne('tache|MA|h1', hier, 'Payer Hydro', 'tache'),
    ligne('event|MB|h2', hier, 'RDV garage', 'evenement'),
    ligne('important|MC', hier, 'Réponds-moi stp', 'important'),
    ligne('important|VIEUX', vieux, 'Hors fenêtre', 'important'), // hors fenêtre → ignoré
    ligne('drive|X', hier, '2026-07-01_Facture_EDF.pdf', 'classé'),
  ]);
  const s = c.statsSemaine_(7);
  assert.strictEqual(s.tache, 1);
  assert.strictEqual(s.evenement, 1);
  assert.deepStrictEqual(plain(s.actions), [{ type: 'tache', titre: 'Payer Hydro' }, { type: 'evenement', titre: 'RDV garage' }]);
  assert.strictEqual(s.actionsTotal, 2);
  assert.deepStrictEqual(plain(s.aTraiter), [{ sujet: 'Réponds-moi stp', messageId: 'MC' }]);
  assert.strictEqual(s.aTraiterTotal, 1);
  assert.strictEqual(s.importants, 1);
  assert.strictEqual(s.autres, 0); // « important » ne pollue pas le bucket Autres
});

test('statsSemaine_ : collecte PLAFONNÉE mais totaux exacts (« … et N de plus »)', () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lignes = [];
  for (let i = 0; i < 20; i++) lignes.push(ligne('important|M' + i, hier, 'Sujet ' + i, 'important'));
  const c = ctxResume(lignes);
  const s = c.statsSemaine_(7);
  assert.strictEqual(s.aTraiter.length, c.CONFIG.RESUME_IMPORTANTS_MAX);
  assert.strictEqual(s.aTraiterTotal, 20);
});

test('construireResume_ : sections « À traiter » (avec lien Gmail) et « Actions & RDV », débordement affiché', () => {
  const c = load(['Config.gs', 'Resume.gs']);
  const s = {
    classe: 1, tache: 1, evenement: 1, mailsSansAction: 0, mailsAvecAction: 1, doublon: 0,
    technique: 0, media: 0, quarantaine: 0, importants: 12, autres: 0, total: 3,
    actions: [{ type: 'tache', titre: 'Payer Hydro' }, { type: 'evenement', titre: 'RDV garage' }],
    actionsTotal: 3,
    aTraiter: [{ sujet: 'Réponds-moi stp', messageId: 'MC' }],
    aTraiterTotal: 12,
  };
  const corps = c.construireResume_(s, 0, { dollars: 1.5, appels: 10 }, 7, '🟢', '');
  assert.ok(corps.includes('📌 À traiter'));
  assert.ok(corps.includes('Réponds-moi stp — https://mail.google.com/mail/#all/MC'));
  assert.ok(corps.includes('… et 11 de plus'));
  assert.ok(corps.includes('🗓️ Actions & RDV détectés'));
  assert.ok(corps.includes('✅ Payer Hydro'));
  assert.ok(corps.includes('📅 RDV garage'));
  assert.ok(corps.includes('… et 1 de plus'));
});

test('construireResume_ : sections ABSENTES quand il n\'y a rien (pas de bruit)', () => {
  const c = load(['Config.gs', 'Resume.gs']);
  const s = {
    classe: 0, tache: 0, evenement: 0, mailsSansAction: 0, mailsAvecAction: 0, doublon: 0,
    technique: 0, media: 0, quarantaine: 0, importants: 0, autres: 0, total: 0,
    actions: [], actionsTotal: 0, aTraiter: [], aTraiterTotal: 0,
  };
  const corps = c.construireResume_(s, 0, { dollars: 0, appels: 0 }, 7, '🟢', '');
  assert.ok(!corps.includes('À traiter'));
  assert.ok(!corps.includes('Actions & RDV'));
});
