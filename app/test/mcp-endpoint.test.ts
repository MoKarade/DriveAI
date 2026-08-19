/**
 * mcp-endpoint.test.ts — le endpoint JSON-RPC MCP (api/mcp/index.ts, ADR-0042) + le mapping
 * outils → actions moteur. `fetch` est mocké : on VÉRIFIE l'URL, l'action, le secret utilisé
 * (webapp pour question_documents, DÉDIÉ pour les mcp-*), et que le contenu n'est JAMAIS loggé.
 * Auth : 401 sans Bearer (avec WWW-Authenticate), 200 avec un access token émis par le provider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { makeOAuthProvider } from '../../api/_mcpOauth';
import handlerMcp from '../../api/mcp/index';
import handlerToken from '../../api/mcp/token';
import handlerAuthorize from '../../api/mcp/authorize';
import handlerRegister from '../../api/mcp/register';
import handlerMeta from '../../api/mcp/meta';

const ENV = {
  MCP_SIGNING_KEY: 'clef-de-signature-de-test-32-caracteres-mini',
  MCP_ACCESS_KEY: 'cle-acces-de-marc-16',
  WEBAPP_URL: 'https://script.google.com/macros/s/X/exec',
  MCP_ENGINE_SECRET: 'secret-moteur-dedie',
  WEBAPP_SECRET: 'secret-webapp-existant',
};

/** access token valide (issuer = origine de la requête mockée). */
function bearer(): string {
  const auth = makeOAuthProvider({ signingKey: ENV.MCP_SIGNING_KEY, accessKey: ENV.MCP_ACCESS_KEY, issuer: 'https://drive.hubperso.com' });
  const client = auth.registerClient(['https://claude.ai/cb']);
  const verifier = 'v'.repeat(20);
  const code = auth.authorize({
    clientId: client.client_id, redirectUri: 'https://claude.ai/cb',
    codeChallenge: createHash('sha256').update(verifier, 'utf8').digest('base64url'), accessKey: ENV.MCP_ACCESS_KEY,
  });
  return auth.exchangeCode({ code, clientId: client.client_id, redirectUri: 'https://claude.ai/cb', codeVerifier: verifier }).access_token;
}

function reqPost(body: unknown, authHeader?: string): IncomingMessage {
  const chunks = [Buffer.from(JSON.stringify(body), 'utf8')];
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const req = {
    method: 'POST', url: '/api/mcp',
    headers: {
      'x-forwarded-proto': 'https', 'x-forwarded-host': 'drive.hubperso.com',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    on(ev: string, cb: (arg?: unknown) => void) { handlers[ev] = cb; return this; },
    destroy() { /* noop */ },
  } as unknown as IncomingMessage;
  // Rejoue le flux de données au prochain tick (le handler s'abonne d'abord).
  queueMicrotask(() => { for (const c of chunks) handlers.data?.(c); handlers.end?.(); });
  return req;
}

function res(): ServerResponse & { code: number; corps: string; entetes: Record<string, unknown> } {
  const o = {
    code: 200, corps: '', entetes: {} as Record<string, unknown>, statusCode: 200,
    setHeader(n: string, v: unknown) { this.entetes[n.toLowerCase()] = v; },
    end(c?: string) { this.corps = c ?? ''; this.code = this.statusCode; },
  };
  return o as unknown as ServerResponse & { code: number; corps: string; entetes: Record<string, unknown> };
}

async function appeler(body: unknown, authHeader?: string): Promise<{ code: number; json: any; entetes: Record<string, unknown> }> {
  const r = res();
  await handlerMcp(reqPost(body, authHeader), r);
  let json: any = null;
  try { json = JSON.parse(r.corps); } catch { /* corps vide (202/405) */ }
  return { code: r.code, json, entetes: r.entetes };
}

let logs: string[] = [];
beforeEach(() => {
  Object.assign(process.env, ENV);
  logs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete (process.env as Record<string, string>)[k];
  vi.restoreAllMocks();
});

describe('config incomplète → 503 fermé', () => {
  it('sans MCP_SIGNING_KEY, tout est 503 (jamais un endpoint à moitié ouvert)', async () => {
    delete (process.env as Record<string, string>).MCP_SIGNING_KEY;
    const r = await appeler({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${bearer()}`);
    expect(r.code).toBe(503);
    expect(r.json.error).toBe('mcp disabled');
  });
});

describe('auth Bearer', () => {
  it('sans Bearer → 401 + WWW-Authenticate portant l\'URL de découverte (déclenche le flux claude.ai)', async () => {
    const r = await appeler({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(r.code).toBe(401);
    expect(String(r.entetes['www-authenticate'])).toContain('oauth-protected-resource');
  });
  it('Bearer forgé → 401', async () => {
    const r = await appeler({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'Bearer da1.forge.forge');
    expect(r.code).toBe(401);
  });
});

describe('JSON-RPC : initialize / tools/list / notifications', () => {
  it('initialize renvoie la version de protocole et les capacités outils', async () => {
    const r = await appeler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, `Bearer ${bearer()}`);
    expect(r.code).toBe(200);
    expect(r.json.result.protocolVersion).toBe('2025-06-18'); // version connue → renvoyée telle quelle
    expect(r.json.result.capabilities.tools).toBeDefined();
    expect(r.json.result.serverInfo.name).toBe('driveai-mcp');
  });
  it('tools/list expose les 6 outils du périmètre choisi par Marc', async () => {
    const r = await appeler({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, `Bearer ${bearer()}`);
    const noms = r.json.result.tools.map((t: { name: string }) => t.name).sort();
    expect(noms).toEqual(['creer_intention', 'etat_moteur', 'lire_document', 'proposer_reorg', 'question_documents', 'rechercher_documents']);
  });
  it('notification (sans id) → 202 sans corps', async () => {
    const r = await appeler({ jsonrpc: '2.0', method: 'notifications/initialized' }, `Bearer ${bearer()}`);
    expect(r.code).toBe(202);
  });
  it('GET → 405 (mode sans session : ni SSE ni DELETE)', async () => {
    const r = res();
    const req = { method: 'GET', url: '/api/mcp', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'drive.hubperso.com' }, on() { return this; } } as unknown as IncomingMessage;
    await handlerMcp(req, r);
    expect(r.code).toBe(405);
  });
});

describe('tools/call → actions moteur (secret + URL + non-persistance du contenu)', () => {
  it('rechercher_documents → action mcp-recherche, secret DÉDIÉ, jamais le contenu loggé', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, resultat: '2 fichiers…', versionMcp: 1 }), { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rechercher_documents', arguments: { requete: 'bail' } } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(false);
    expect(r.json.result.content[0].text).toContain('2 fichiers');
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('action=mcp-recherche');
    expect(url).toContain(encodeURIComponent(ENV.MCP_ENGINE_SECRET));
    expect(url).not.toContain(encodeURIComponent(ENV.WEBAPP_SECRET)); // jamais la mauvaise porte
    expect(logs.join('\n')).not.toContain('bail'); // aucun log de contenu/args
  });

  it('question_documents → action chat-assistant, secret WEBAPP (budget existant)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, reponse: 'Ta facture Hydro dit 84,20 $.', coutJour: 0.12, plafond: 2 }), { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'question_documents', arguments: { question: 'combien Hydro ?' } } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(false);
    expect(r.json.result.content[0].text).toContain('84,20');
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('action=chat-assistant');
    expect(url).toContain(encodeURIComponent(ENV.WEBAPP_SECRET));
  });

  it('piège 4 : action mcp-* sans versionMcp (version /exec pas déployée) → isError LISIBLE, jamais un faux succès', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, erreur: 'refusé' }), { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'etat_moteur', arguments: {} } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(true);
    expect(r.json.result.content[0].text).toMatch(/déployée|MCP_ENGINE_SECRET|divergent/);
  });

  it('moteur illisible (HTML transitoire Apps Script) → isError, jamais un faux succès (succès jugé au CONTENU)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Sorry, unable to open</html>', { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'etat_moteur', arguments: {} } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(true);
    expect(r.json.result.content[0].text).toMatch(/illisible|transitoire/);
  });

  it('creer_intention succès → message lisible avec l\'id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, cree: 'tache', id: 'task-9', versionMcp: 1 }), { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'creer_intention', arguments: { type: 'tache', titre: 'Payer Hydro' } } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(false);
    expect(r.json.result.content[0].text).toContain('task-9');
  });

  it('question invalide (trop courte) → isError sans appeler le moteur', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const r = await appeler({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'question_documents', arguments: { question: 'a' } } }, `Bearer ${bearer()}`);
    expect(r.json.result.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('corps JSON `null` → 400 -32600, jamais un 500 brut (revue #3)', async () => {
    const r = await appeler(null, `Bearer ${bearer()}`);
    expect(r.code).toBe(400);
    expect(r.json.error.code).toBe(-32600);
  });
});

/* ---------- endpoints token / authorize / register / meta (revue #6) ---------- */

/** Formulaire/URL-encodé (authorize POST, token) : corps `application/x-www-form-urlencoded`. */
function reqForm(method: string, url: string, form?: Record<string, string>, query?: string): IncomingMessage {
  const body = form ? new URLSearchParams(form).toString() : '';
  const handlers: Record<string, (arg?: unknown) => void> = {};
  const req = {
    method, url: url + (query ? `?${query}` : ''),
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'drive.hubperso.com' },
    on(ev: string, cb: (arg?: unknown) => void) { handlers[ev] = cb; return this; },
    destroy() { /* noop */ },
  } as unknown as IncomingMessage;
  queueMicrotask(() => { if (body) handlers.data?.(Buffer.from(body, 'utf8')); handlers.end?.(); });
  return req;
}

/** Enregistre un client + émet un code lié à un PKCE — briques du flux endpoint. */
function amorce() {
  const auth = makeOAuthProvider({ signingKey: ENV.MCP_SIGNING_KEY, accessKey: ENV.MCP_ACCESS_KEY, issuer: 'https://drive.hubperso.com' });
  const client = auth.registerClient(['https://claude.ai/cb']);
  const verifier = 'v'.repeat(24);
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const code = auth.authorize({ clientId: client.client_id, redirectUri: 'https://claude.ai/cb', codeChallenge: challenge, accessKey: ENV.MCP_ACCESS_KEY });
  return { client, verifier, code };
}

describe('token endpoint', () => {
  it('échange code→jetons, PUIS le MÊME code est REJETÉ (usage unique réel via le provider caché — revue #1)', async () => {
    const { client, verifier, code } = amorce();
    const form = { grant_type: 'authorization_code', code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: 'https://claude.ai/cb', code_verifier: verifier };

    const r1 = res(); await handlerToken(reqForm('POST', '/api/mcp/token', form), r1);
    const j1 = JSON.parse(r1.corps);
    expect(r1.code).toBe(200);
    expect(j1.access_token).toBeTruthy();
    expect(j1.refresh_token).toBeTruthy();

    // 2ᵉ échange du MÊME code → invalid_grant. Prouve que `consumedJti` SURVIT entre deux appels
    // HTTP (le bug : provider reconstruit par requête ⇒ Map vide ⇒ rejeu accepté).
    const r2 = res(); await handlerToken(reqForm('POST', '/api/mcp/token', form), r2);
    expect(r2.code).toBe(400);
    expect(JSON.parse(r2.corps).error).toBe('invalid_grant');

    // Rotation du refresh : 1er usage OK, 2ᵉ usage du MÊME refresh → rejeté (survie du provider).
    const fr = { grant_type: 'refresh_token', refresh_token: j1.refresh_token, client_id: client.client_id };
    const r3 = res(); await handlerToken(reqForm('POST', '/api/mcp/token', fr), r3);
    expect(r3.code).toBe(200);
    const r4 = res(); await handlerToken(reqForm('POST', '/api/mcp/token', fr), r4);
    expect(r4.code).toBe(400);
    expect(JSON.parse(r4.corps).error).toBe('invalid_grant');
  });

  it('grant_type inconnu → 400 unsupported_grant_type ; GET → 405', async () => {
    const r = res(); await handlerToken(reqForm('POST', '/api/mcp/token', { grant_type: 'password' }), r);
    expect(r.code).toBe(400);
    expect(JSON.parse(r.corps).error).toBe('unsupported_grant_type');
    const g = res(); await handlerToken(reqForm('GET', '/api/mcp/token'), g);
    expect(g.code).toBe(405);
  });
});

describe('authorize endpoint', () => {
  it('GET valide → formulaire HTML avec les paramètres ÉCHAPPÉS (pas de breakout d\'attribut)', async () => {
    const { client } = amorce();
    const q = new URLSearchParams({
      response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/cb',
      code_challenge: 'abc', code_challenge_method: 'S256', state: '"><script>x</script>',
    }).toString();
    const r = res(); await handlerAuthorize(reqForm('GET', '/api/mcp/authorize', undefined, q), r);
    expect(r.code).toBe(200);
    expect(r.corps).toContain('access_key'); // le champ de saisie de la clé
    expect(r.corps).not.toContain('<script>x</script>'); // state échappé, jamais injecté
    expect(r.corps).toContain('&lt;script&gt;');
  });

  it('POST bonne clé → 302 vers claude.ai avec code + state ; mauvaise clé → 403', async () => {
    const { client } = amorce();
    const commun = { response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_challenge: 'abc', code_challenge_method: 'S256', state: 'xyz' };
    const ok = res(); await handlerAuthorize(reqForm('POST', '/api/mcp/authorize', { ...commun, access_key: ENV.MCP_ACCESS_KEY }), ok);
    expect(ok.code).toBe(302);
    const loc = new URL(String(ok.entetes.location));
    expect(loc.origin).toBe('https://claude.ai');
    expect(loc.searchParams.get('code')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBe('xyz');

    const ko = res(); await handlerAuthorize(reqForm('POST', '/api/mcp/authorize', { ...commun, access_key: 'mauvaise-cle-00000' }), ko);
    expect(ko.code).toBe(403);
  });

  it('POST redirect_uri hors allowlist → refus OAuth (jamais un open redirect)', async () => {
    const { client } = amorce();
    const r = res();
    await handlerAuthorize(reqForm('POST', '/api/mcp/authorize', {
      response_type: 'code', client_id: client.client_id, redirect_uri: 'https://evil.com/cb',
      code_challenge: 'abc', code_challenge_method: 'S256', access_key: ENV.MCP_ACCESS_KEY,
    }), r);
    expect(r.code).toBeGreaterThanOrEqual(400);
    expect(String(r.entetes.location ?? '')).not.toContain('evil.com');
  });
});

describe('register + meta endpoints', () => {
  it('register : redirect_uri allowlistée → 201 client_id + secret dérivé ; hors allowlist → erreur', async () => {
    const ok = res();
    await handlerRegister(reqPost({ redirect_uris: ['https://claude.ai/cb'] }), ok);
    expect(ok.code).toBe(201);
    const j = JSON.parse(ok.corps);
    expect(j.client_id).toBeTruthy();
    expect(j.client_secret).toBeTruthy();

    const ko = res();
    await handlerRegister(reqPost({ redirect_uris: ['https://evil.com/cb'] }), ko);
    expect(ko.code).toBeGreaterThanOrEqual(400);
  });

  it('meta : type=as (serveur d\'autorisation), type=pr (ressource protégée), inconnu → 404', async () => {
    const as = res(); await handlerMeta(reqForm('GET', '/api/mcp/meta', undefined, 'type=as'), as);
    expect(JSON.parse(as.corps).token_endpoint).toContain('/api/mcp/token');
    const pr = res(); await handlerMeta(reqForm('GET', '/api/mcp/meta', undefined, 'type=pr'), pr);
    expect(JSON.parse(pr.corps).resource).toContain('/api/mcp');
    const no = res(); await handlerMeta(reqForm('GET', '/api/mcp/meta', undefined, 'type=x'), no);
    expect(no.code).toBe(404);
  });
});
