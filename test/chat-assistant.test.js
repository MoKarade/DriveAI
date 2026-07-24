'use strict';
/**
 * ASSISTANT CHAT (C28-30, ADR-0026) — PR1 (Q&A LECTURE SEULE). Vérifie : la validation de
 * l'historique reçu (donnée HTTP non fiable), la boucle Tool Use (exécute l'outil puis renvoie le
 * texte), le plafond QUOTIDIEN en $ (échec fermé, aucun appel LLM au-delà), et les outils de lecture
 * (recherche formatée + lecture bornée en taille). Aucune mutation en PR1.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load, iter, fakeFile } = require('./harness');

const MODULES = ['Config.gs', 'Cout.gs', 'Llm.gs', 'WebApp.gs'];
const ctx = load(MODULES);
const plat = (o) => JSON.parse(JSON.stringify(o));
const props = (kv) => ({ getProperty: (k) => (k in kv ? kv[k] : null) });

test('validerHistoriqueChat_ : whitelist stricte (rôle, string bornée, dernier tour = user)', () => {
  assert.deepStrictEqual(plat(ctx.validerHistoriqueChat_([{ role: 'user', content: '  salut  ' }])),
    [{ role: 'user', content: 'salut' }]);
  assert.strictEqual(ctx.validerHistoriqueChat_([]), null);                       // vide
  assert.strictEqual(ctx.validerHistoriqueChat_('x'), null);                      // pas un tableau
  assert.strictEqual(ctx.validerHistoriqueChat_([{ role: 'system', content: 'x' }]), null); // rôle interdit
  assert.strictEqual(ctx.validerHistoriqueChat_([{ role: 'user', content: 42 }]), null);     // content non-string
  assert.strictEqual(ctx.validerHistoriqueChat_([{ role: 'user', content: '   ' }]), null);  // vide après trim
  assert.strictEqual(ctx.validerHistoriqueChat_([{ role: 'user', content: 'x'.repeat(2001) }]), null); // trop long
  assert.strictEqual(ctx.validerHistoriqueChat_(
    [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]), null); // dernier = assistant
  assert.strictEqual(ctx.validerHistoriqueChat_(
    Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' }))), null);    // long ET malformé (tout user) → rejeté par l'alternance, même après troncature
  // Alternance stricte exigée par l'API Messages (1er=user, user/assistant/user…, dernier=user).
  assert.deepStrictEqual(plat(ctx.validerHistoriqueChat_(
    [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }])),
    [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
  assert.strictEqual(ctx.validerHistoriqueChat_(
    [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'q' }]), null); // 1er tour ≠ user
  assert.strictEqual(ctx.validerHistoriqueChat_(
    [{ role: 'user', content: 'q1' }, { role: 'user', content: 'q2' }]), null);    // alternance rompue
});

// Historique alternant : user aux indices PAIRS, assistant aux impairs (m0, m1, …).
const roleA = (n) => Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: 'm' + i }));

test('tronquerHistoriqueChat_ : garde ≤ N derniers messages, TOUJOURS un user en tête (PR3)', () => {
  const M = ctx.CONFIG.CHAT_HISTORIQUE_MAX; // cas dérivés de la CONFIG, jamais de la valeur du jour
  // Court (≤ M) : inchangé.
  assert.deepStrictEqual(plat(ctx.tronquerHistoriqueChat_(roleA(3), M)), plat(roleA(3)));
  assert.deepStrictEqual(plat(ctx.tronquerHistoriqueChat_(roleA(M), M)), plat(roleA(M)));
  // Long : un SUFFIXE contigu, ≤ M, débutant par user (jamais un assistant en tête même si la
  // frontière tombe sur un assistant → décalage d'un cran) ; le DERNIER message est toujours conservé.
  for (const L of [M + 1, M + 2, 3 * M]) {
    const src = roleA(L);
    const tr = ctx.tronquerHistoriqueChat_(src, M);
    assert.ok(tr.length <= M && tr.length >= M - 1, 'garde M ou M-1 (frontière paire/impaire)');
    assert.strictEqual(tr[0].role, 'user', 'user en tête');
    assert.strictEqual(tr[tr.length - 1].content, src[L - 1].content, 'dernier message (question courante) conservé');
    assert.deepStrictEqual(plat(tr), plat(src.slice(L - tr.length)), 'suffixe contigu (les plus récents)');
  }
});

test('validerHistoriqueChat_ : historique long et VALIDE → TRONQUÉ (accepté), plus jamais rejeté (PR3)', () => {
  const M = ctx.CONFIG.CHAT_HISTORIQUE_MAX;
  const longValide = roleA(2 * M + 1); // impair → commence ET finit par user (historique valide)
  const out = ctx.validerHistoriqueChat_(longValide);
  assert.notStrictEqual(out, null, 'un chat long ne casse plus l\'appel');
  assert.ok(out.length <= M, 'borné à CHAT_HISTORIQUE_MAX');
  assert.strictEqual(out[0].role, 'user');
  assert.strictEqual(out[out.length - 1].role, 'user');
  // C'est bien le SUFFIXE (les tours les plus RÉCENTS), assaini par la whitelist.
  assert.deepStrictEqual(plat(out), plat(longValide.slice(longValide.length - out.length)));
});

test('appelAnthropicChat_ : PLUSIEURS tool_use dans un tour → un tool_result par bloc (id exacts)', () => {
  const c = load(MODULES);
  let appel = 0;
  c.appelAnthropicMessages_ = (modele, sys, messages) => {
    appel++;
    if (appel === 1) {
      return { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't1', name: 'recherche_nom', input: { requete: 'a' } },
        { type: 'tool_use', id: 't2', name: 'recherche_contenu', input: { requete: 'b' } },
      ] };
    }
    // Au 2e appel, l'historique doit porter EXACTEMENT 2 tool_result (un par tool_use), aux bons ids.
    const trs = plat(messages[messages.length - 1].content);
    assert.strictEqual(trs.length, 2);
    assert.deepStrictEqual(trs.map((r) => r.tool_use_id), ['t1', 't2']);
    assert.ok(trs.every((r) => r.type === 'tool_result'));
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
  };
  const rep = c.appelAnthropicChat_('sys', [{ role: 'user', content: 'q' }],
    c.outilsChatAssistant_(), (nom) => 'res:' + nom);
  assert.strictEqual(rep, 'ok');
});

test('appelAnthropicChat_ : boucle épuisée → tour final forcé avec tool_choice:none (outils gardés)', () => {
  const c = load(MODULES);
  let dernierAppel = null;
  c.appelAnthropicMessages_ = (modele, sys, messages, outils, maxTokens, toolChoice) => {
    dernierAppel = { outils, toolChoice };
    // Toujours tool_use → la boucle s'épuise, puis le tour final DOIT poser tool_choice:{type:'none'}.
    if (!toolChoice) {
      return { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't', name: 'recherche_nom', input: { requete: 'x' } }] };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'réponse forcée' }] };
  };
  const rep = c.appelAnthropicChat_('sys', [{ role: 'user', content: 'q' }], c.outilsChatAssistant_(), () => 'r');
  assert.strictEqual(rep, 'réponse forcée');
  assert.deepStrictEqual(plat(dernierAppel.toolChoice), { type: 'none' });
  assert.ok(dernierAppel.outils && dernierAppel.outils.length, 'les outils restent présents au tour final');
});

test('appelAnthropicChat_ : tool_use annoncé sans bloc exploitable → rend le texte (jamais bloqué)', () => {
  const c = load(MODULES);
  c.appelAnthropicMessages_ = () => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'juste du texte' }] });
  assert.strictEqual(
    c.appelAnthropicChat_('sys', [{ role: 'user', content: 'q' }], [], () => 'r'),
    'juste du texte');
});

test('coutChatJour_ : dollars du jour seulement (rollover → 0)', () => {
  assert.strictEqual(ctx.coutChatJour_(props({ DriveAI_CHAT_COUT_JOUR: '2026-07-24|0.35' }), '2026-07-24'), 0.35);
  assert.strictEqual(ctx.coutChatJour_(props({ DriveAI_CHAT_COUT_JOUR: '2026-07-23|0.35' }), '2026-07-24'), 0);
  assert.strictEqual(ctx.coutChatJour_(props({}), '2026-07-24'), 0);
});

test('appelAnthropicChat_ : boucle Tool Use — exécute l\'outil, rend le tool_result, renvoie le texte final', () => {
  const c = load(MODULES);
  let appel = 0;
  c.appelAnthropicMessages_ = () => {
    appel++;
    if (appel === 1) {
      return { stop_reason: 'tool_use', content: [
        { type: 'text', text: 'je cherche' },
        { type: 'tool_use', id: 't1', name: 'recherche_nom', input: { requete: 'nas' } },
      ] };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ton NAS : 192.168.1.50 (config.txt)' }] };
  };
  const outilsAppeles = [];
  const executer = (nom, input) => { outilsAppeles.push([nom, input.requete]); return 'config.txt [id:F1]'; };
  const messages = [{ role: 'user', content: 'donne mon NAS' }];

  const rep = c.appelAnthropicChat_('sys', messages, c.outilsChatAssistant_(), executer);
  assert.strictEqual(rep, 'Ton NAS : 192.168.1.50 (config.txt)');
  assert.deepStrictEqual(plat(outilsAppeles), [['recherche_nom', 'nas']]);
  assert.strictEqual(appel, 2, 'un tour outil + un tour réponse');
  assert.strictEqual(messages.length, 3, 'historique = question + tour assistant + tool_result');
  assert.strictEqual(messages[1].role, 'assistant');
  assert.strictEqual(messages[2].role, 'user');
  assert.strictEqual(plat(messages[2].content)[0].type, 'tool_result');
});

test('appelAnthropicChat_ : appel en panne (null) → renvoie null, jamais un plantage', () => {
  const c = load(MODULES);
  c.appelAnthropicMessages_ = () => null;
  assert.strictEqual(c.appelAnthropicChat_('sys', [{ role: 'user', content: 'x' }], [], () => 'r'), null);
});

test('actionChatAssistant_ : budget quotidien épuisé → refus, AUCUN appel LLM', () => {
  const c = load(MODULES);
  const jour = new Date().toISOString().slice(0, 10); // Utilities.formatDate(UTC) == cette date
  const depasse = (c.CONFIG.CHAT_COUT_JOUR_MAX + 0.1).toFixed(2); // dérivé du plafond, jamais la valeur du jour
  const store = { DriveAI_CHAT_COUT_JOUR: jour + '|' + depasse }; // >= CHAT_COUT_JOUR_MAX
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
  }) };
  c.appelAnthropicChat_ = () => { throw new Error('LLM appelé alors que le budget est épuisé !'); };

  const r = c.actionChatAssistant_({ postData: { contents: JSON.stringify({ historique: [{ role: 'user', content: 'q' }] }) } });
  assert.strictEqual(r.ok, false);
  assert.ok(/[Bb]udget/.test(r.erreur), r.erreur);
  assert.strictEqual(r.plafond, c.CONFIG.CHAT_COUT_JOUR_MAX, 'plafond renvoyé pour le compteur');
  assert.ok(r.coutJour >= r.plafond, 'coutJour renvoyé pour le compteur'); // refus = au-dessus du plafond
});

test('actionChatAssistant_ : actionsProposees reflète l\'appel réel de proposer_reorg (refresh app)', () => {
  const c = load(MODULES);
  const store = {};
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
  }) };
  c.chargerPannePlateforme_ = () => {};
  c.estPannePlateforme_ = () => false;
  const rows = [];
  c.feuille_ = () => ({ appendRow: (r) => rows.push(r) }); // onglet Réorg pour proposerReorgChat_
  const envoi = (h) => c.actionChatAssistant_({ postData: { contents: JSON.stringify({ historique: h }) } });

  // (a) le chat APPELLE proposer_reorg → l'app doit rafraîchir.
  c.appelAnthropicChat_ = (_s, _m, _o, executer) => {
    executer('proposer_reorg', { actions: [{ type: 'deplacer-fichier', source: 'F1', cible: 'D1' }] });
    return 'j\'ai proposé';
  };
  const rA = envoi([{ role: 'user', content: 'range' }]);
  assert.strictEqual(rA.ok, true);
  assert.strictEqual(rA.actionsProposees, true);
  assert.strictEqual(rows.length, 1, 'une ligne proposé écrite');

  // (b) le chat NE propose PAS (aucun outil de reorg) → pas de faux rafraîchissement.
  store.DriveAI_CHAT_DERNIER = '0'; // reset anti-rafale
  c.appelAnthropicChat_ = () => 'juste une réponse';
  const rB = envoi([{ role: 'user', content: 'donne mon NAS' }]);
  assert.strictEqual(rB.ok, true);
  assert.strictEqual(rB.actionsProposees, false);
});

test('outils lecture : recherche formatée (id + dossier) et lecture bornée en taille', () => {
  const c = load(MODULES);
  c.DriveApp = {
    searchFiles: () => iter([fakeFile({ name: 'config NAS.txt', id: 'F1', parents: [{ getName: () => 'Réseau' }] })]),
    getFileById: () => ({ getName: () => 'config NAS.txt', getSize: () => 100, getBlob: () => ({}) }),
  };
  c.extraireTexte_ = () => 'IP du NAS : 192.168.1.50';

  const res = c.rechercheDriveChat_('title', 'nas');
  assert.ok(res.includes('config NAS.txt') && res.includes('[id:F1]') && res.includes('Réseau'), res);

  const lu = c.lireFichierChat_('F1');
  assert.ok(lu.includes('192.168.1.50') && lu.includes('config NAS.txt'), lu);

  // Fichier trop gros : jamais lu (mémoire), message clair.
  c.DriveApp = { getFileById: () => ({ getName: () => 'gros', getSize: () => 999 * 1024 * 1024, getBlob: () => ({}) }) };
  assert.ok(/trop volumineux/.test(c.lireFichierChat_('F2')));

  // Requête vide / outil inconnu : réponses sûres, jamais un throw.
  assert.ok(/vide/i.test(c.rechercheDriveChat_('title', '   ')));
  assert.ok(/inconnu/i.test(c.executerOutilChatAssistant_('supprime_tout', {})));
});
