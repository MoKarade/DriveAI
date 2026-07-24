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
    Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' }))), null);    // trop de messages
  // Alternance stricte exigée par l'API Messages (1er=user, user/assistant/user…, dernier=user).
  assert.deepStrictEqual(plat(ctx.validerHistoriqueChat_(
    [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }])),
    [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
  assert.strictEqual(ctx.validerHistoriqueChat_(
    [{ role: 'assistant', content: 'a' }, { role: 'user', content: 'q' }]), null); // 1er tour ≠ user
  assert.strictEqual(ctx.validerHistoriqueChat_(
    [{ role: 'user', content: 'q1' }, { role: 'user', content: 'q2' }]), null);    // alternance rompue
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
