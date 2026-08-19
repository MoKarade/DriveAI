/**
 * mcp-oauth.test.ts — fournisseur OAuth 2.1 sans état du connecteur MCP (api/_mcpOauth.ts,
 * ADR-0042). Port du patron FinanceAI : ces tests re-prouvent CHEZ NOUS les findings du panel
 * (allowlist d'origine exacte + refus d'userinfo, code à usage unique, rotation du refresh,
 * PKCE obligatoire, clé d'accès en comparaison constante, limiteur d'échecs) — jamais
 * « couvert par provenance ».
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { makeOAuthProvider, makeAttemptLimiter, OAuthError, lireEnvMcp } from '../../api/_mcpOauth';

const CONFIG = {
  signingKey: 'clef-de-signature-de-test-32-caracteres-mini',
  accessKey: 'cle-acces-de-marc-16',
  issuer: 'https://drive.hubperso.com',
};

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'verificateur-pkce-de-test';
const CHALLENGE = createHash('sha256').update(VERIFIER, 'utf8').digest('base64url');

function fluxComplet(now?: () => number) {
  const auth = makeOAuthProvider(now ? { ...CONFIG, now } : CONFIG);
  const client = auth.registerClient([REDIRECT]);
  const code = auth.authorize({
    clientId: client.client_id, redirectUri: REDIRECT,
    codeChallenge: CHALLENGE, accessKey: CONFIG.accessKey,
  });
  return { auth, client, code };
}

describe('flux nominal (register → authorize → exchange → verify → refresh)', () => {
  it('délivre des jetons utilisables et ROTATIONNE le refresh token', () => {
    const { auth, client, code } = fluxComplet();
    const jetons = auth.exchangeCode({
      code, clientId: client.client_id, clientSecret: client.client_secret,
      redirectUri: REDIRECT, codeVerifier: VERIFIER,
    });
    expect(() => auth.verifyAccessToken(`Bearer ${jetons.access_token}`)).not.toThrow();
    expect(() => auth.verifyAccessToken(`bearer ${jetons.access_token}`)).not.toThrow(); // RFC 7235 : casse libre

    const suivants = auth.refreshGrant({ refreshToken: jetons.refresh_token, clientId: client.client_id });
    expect(suivants.access_token).not.toBe(jetons.access_token);
    // Rotation OAuth 2.1 : l'ANCIEN refresh est mort après usage.
    expect(() => auth.refreshGrant({ refreshToken: jetons.refresh_token, clientId: client.client_id }))
      .toThrowError(/déjà utilisé/);
  });

  it('le code est à USAGE UNIQUE (anti-rejeu)', () => {
    const { auth, client, code } = fluxComplet();
    const echange = () => auth.exchangeCode({
      code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER,
    });
    echange();
    expect(echange).toThrowError(/déjà utilisé/);
  });
});

describe('allowlist de redirection (finding CRITIQUE du panel : origine EXACTE, jamais un préfixe)', () => {
  const auth = makeOAuthProvider(CONFIG);
  it.each([
    ['https://claude.ai/cb', true],
    ['https://claude.com/x', true],
    ['http://127.0.0.1:33418/cb', true],   // loopback : entrée « custom connector localhost »
    ['http://localhost:5000/cb', true],
    ['https://claude.ai.evil.com/cb', false],   // préfixe de chaîne — le piège classique
    ['https://evil.com/claude.ai', false],
    ['http://127.0.0.1@evil.com/cb', false],    // userinfo embarqué : host réel = evil.com
    ['https://claude.ai@evil.com/cb', false],
    ['pasuneurl', false],
  ])('%s → admise: %s', (uri, admise) => {
    if (admise) expect(() => auth.registerClient([uri as string])).not.toThrow();
    else expect(() => auth.registerClient([uri as string])).toThrowError(OAuthError);
  });

  it('authorize RE-vérifie lui-même (ceinture + bretelles — ne dépend pas de la discipline de l\'appelant)', () => {
    expect(() => auth.authorize({
      clientId: 'c', redirectUri: 'https://evil.com/cb', codeChallenge: CHALLENGE, accessKey: CONFIG.accessKey,
    })).toThrowError(/hors allowlist/);
  });
});

describe('clé d\'accès et PKCE', () => {
  it('clé d\'accès fausse → access_denied 403 (la VRAIE porte mono-utilisateur)', () => {
    const auth = makeOAuthProvider(CONFIG);
    try {
      auth.authorize({ clientId: 'c', redirectUri: REDIRECT, codeChallenge: CHALLENGE, accessKey: 'fausse-cle-000000' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      expect((e as OAuthError).code).toBe('access_denied');
      expect((e as OAuthError).status).toBe(403);
    }
  });

  it('PKCE : vérificateur faux → invalid_grant ; S256 exigé à la validation', () => {
    const { auth, client, code } = fluxComplet();
    expect(() => auth.exchangeCode({
      code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: 'autre-verificateur',
    })).toThrowError(/PKCE/);
    expect(() => auth.validateAuthorizeRequest({
      response_type: 'code', client_id: 'c', redirect_uri: REDIRECT,
      code_challenge: CHALLENGE, code_challenge_method: 'plain',
    })).toThrowError(/S256/);
  });

  it('redirect_uri de l\'échange ≠ celle du code → refus (liaison cryptographique)', () => {
    const { auth, client, code } = fluxComplet();
    expect(() => auth.exchangeCode({
      code, clientId: client.client_id, redirectUri: 'https://claude.com/autre', codeVerifier: VERIFIER,
    })).toThrowError(/redirect_uri/);
  });

  it('client_secret : dérivé vérifié s\'il est fourni ; omis = client public (PKCE couvre)', () => {
    const { auth, client, code } = fluxComplet();
    expect(() => auth.exchangeCode({
      code, clientId: client.client_id, clientSecret: 'faux-secret',
      redirectUri: REDIRECT, codeVerifier: VERIFIER,
    })).toThrowError(/invalid_client|client_secret/);
  });
});

describe('jetons signés (HMAC, expiration, type)', () => {
  it('expiration : un code émis avant la limite passe, après il est mort (horloge injectée)', () => {
    let t = 1_000_000;
    const { auth, client, code } = fluxComplet(() => t);
    t += 10 * 60 * 1000 + 1; // codeTtl (10 min) dépassé
    expect(() => auth.exchangeCode({
      code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER,
    })).toThrowError(/expiré/i);
  });

  it('signature altérée, préfixe étranger (fa1.), mauvais TYPE de jeton → tous refusés', () => {
    const { auth, client, code } = fluxComplet();
    const jetons = auth.exchangeCode({
      code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER,
    });
    const [p, corps] = jetons.access_token.split('.');
    expect(p).toBe('da1');
    expect(() => auth.verifyAccessToken(`Bearer da1.${corps}.AAAA`)).toThrowError(/Signature/);
    expect(() => auth.verifyAccessToken(`Bearer fa1.${corps}.AAAA`)).toThrowError(/Format/);
    // Un REFRESH token présenté comme access token est refusé (le type fait partie du contrat).
    expect(() => auth.verifyAccessToken(`Bearer ${jetons.refresh_token}`)).toThrowError(/type/);
    expect(() => auth.verifyAccessToken(undefined)).toThrowError(/Bearer/);
  });

  it('clés trop courtes → refus à la CONSTRUCTION (échec fermé, jamais un serveur affaibli)', () => {
    expect(() => makeOAuthProvider({ ...CONFIG, signingKey: 'courte' })).toThrowError(/32/);
    expect(() => makeOAuthProvider({ ...CONFIG, accessKey: 'courte' })).toThrowError(/16/);
  });
});

describe('limiteur d\'échecs (la seule porte devinable)', () => {
  it('bloque au 8ᵉ échec, se vide au succès, se débloque à la sortie de fenêtre', () => {
    let t = 0;
    const lim = makeAttemptLimiter({ now: () => t });
    for (let i = 0; i < 7; i++) lim.recordFailure();
    expect(lim.isBlocked()).toBe(false);
    lim.recordFailure();
    expect(lim.isBlocked()).toBe(true);
    expect(lim.retryAfterSeconds()).toBeGreaterThan(0);
    t += 15 * 60_000 + 1; // fenêtre écoulée
    expect(lim.isBlocked()).toBe(false);
    lim.recordFailure();
    lim.reset(); // un succès prouve que ce n'est pas une attaque
    expect(lim.isBlocked()).toBe(false);
  });
});

describe('lireEnvMcp : FERMÉ sur config incomplète', () => {
  it('null si une variable manque ou une clé est trop courte', () => {
    const sauvegarde = { ...process.env };
    try {
      process.env.MCP_SIGNING_KEY = CONFIG.signingKey;
      process.env.MCP_ACCESS_KEY = CONFIG.accessKey;
      process.env.WEBAPP_URL = 'https://script.google.com/macros/s/X/exec';
      process.env.MCP_ENGINE_SECRET = 'secret-moteur';
      process.env.WEBAPP_SECRET = 'secret-webapp';
      expect(lireEnvMcp()).not.toBeNull();
      process.env.MCP_SIGNING_KEY = 'courte';
      expect(lireEnvMcp()).toBeNull();
      process.env.MCP_SIGNING_KEY = CONFIG.signingKey;
      delete process.env.MCP_ENGINE_SECRET;
      expect(lireEnvMcp()).toBeNull();
    } finally {
      process.env = sauvegarde;
    }
  });
});
