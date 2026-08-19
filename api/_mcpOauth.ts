/**
 * api/_mcpOauth.ts — mini serveur OAuth 2.1 MONO-UTILISATEUR pour l'auth claude.ai ↔ MCP DriveAI
 * (ADR-0042). PORT FIDÈLE de `mcp/auth/oauthProvider.ts` de FinanceAI (même écosystème, en prod,
 * findings du panel sécurité 2026-07-13 inclus) — adapté aux chemins Vercel (`/api/mcp/*`) et aux
 * env DriveAI. Pourquoi pas un simple Bearer statique : l'UI des connecteurs custom claude.ai
 * n'offre QUE OAuth.
 *
 * Conception SANS ÉTAT (serverless Vercel : rien en mémoire ne survit d'une invocation à l'autre) :
 *  - tokens/codes = payload JSON signé HMAC-SHA256 (env `MCP_SIGNING_KEY`) → n'importe quelle
 *    instance les vérifie, aucun stockage ;
 *  - DCR (RFC 7591) sans base : client_secret = HMAC(client_id) → dérivable partout ;
 *  - la VRAIE porte = la CLÉ D'ACCÈS de Marc (env `MCP_ACCESS_KEY`), saisie une fois sur la page
 *    d'autorisation (comparaison constante) ; PKCE S256 OBLIGATOIRE ; `redirect_uri` sur
 *    ALLOWLIST (claude.ai/claude.com + loopback) ET lié cryptographiquement au code.
 *  - anti-rejeu `consumedJti` : best-effort EN MÉMOIRE — sur Vercel une instance tiède le garde,
 *    une instance froide repart de zéro (même compromis assumé que FinanceAI sur Cloud Run
 *    scale-to-zero) ; le kill-switch d'incident reste la rotation de `MCP_SIGNING_KEY`.
 *
 * Module PUR (aucun réseau, horloge injectable) : le câblage HTTP vit dans api/mcp/*.ts.
 * ZÉRO dépendance npm (node:crypto seul) — invariant api/ (§6 bis).
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface OAuthConfig {
  /** Clé HMAC de signature des tokens (≥ 32 caractères). */
  signingKey: string;
  /** Clé d'accès de Marc (la « porte » mono-utilisateur, ≥ 16 caractères). */
  accessKey: string;
  /** Origine publique du serveur (issuer), ex. https://drive.hubperso.com */
  issuer: string;
  allowedOrigins?: string[];
  accessTokenTtlMs?: number;   // défaut 1 h
  refreshTokenTtlMs?: number;  // défaut 30 j
  codeTtlMs?: number;          // défaut 10 min
  now?: () => number;
}

/** Origines HTTPS exactes admises (comparaison sur `URL.origin`, jamais un préfixe de chaîne). */
const DEFAULT_ALLOWED_ORIGINS = ['https://claude.ai', 'https://claude.com'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const b64url = (buf: Buffer): string => buf.toString('base64url');
const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url');

interface TokenPayload {
  t: 'access' | 'refresh' | 'code';
  cid: string;           // client_id
  exp: number;           // epoch ms
  ru?: string;           // redirect_uri (codes seulement)
  cc?: string;           // code_challenge S256 (codes seulement)
  jti: string;           // unicité
}

export interface TokenSet {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;    // secondes
  refresh_token: string;
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function makeOAuthProvider(config: OAuthConfig) {
  if (config.signingKey.length < 32) throw new Error('MCP_SIGNING_KEY : 32 caractères minimum.');
  if (config.accessKey.length < 16) throw new Error('MCP_ACCESS_KEY : 16 caractères minimum.');
  const now = config.now ?? (() => Date.now());
  const accessTtl = config.accessTokenTtlMs ?? 60 * 60 * 1000;
  const refreshTtl = config.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const codeTtl = config.codeTtlMs ?? 10 * 60 * 1000;
  const allowedOrigins = config.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;

  // Anti-rejeu (codes + refresh rotationnés) — best-effort mémoire, cf. en-tête.
  const consumedJti = new Map<string, number>();
  const consume = (jti: string, exp: number): boolean => {
    const t = now();
    if (consumedJti.size > 4096) {
      for (const [k, e] of consumedJti) if (e <= t) consumedJti.delete(k);
    }
    if (consumedJti.has(jti)) return false;
    consumedJti.set(jti, exp);
    return true;
  };

  const hmac = (data: string): Buffer => createHmac('sha256', config.signingKey).update(data).digest();

  // Préfixe `da1.` (DriveAI v1) : un jeton FinanceAI (`fa1.`) ne passera jamais ici, même si les
  // deux serveurs partageaient un jour une clé par erreur — le préfixe fait partie du contrat.
  const sign = (payload: TokenPayload): string => {
    const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `da1.${body}.${b64url(hmac(body))}`;
  };

  const verify = (token: string, kind: TokenPayload['t']): TokenPayload => {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'da1') throw new OAuthError('invalid_token', 'Format de jeton invalide.', 401);
    const expected = hmac(parts[1]);
    const given = fromB64url(parts[2]);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new OAuthError('invalid_token', 'Signature de jeton invalide.', 401);
    }
    let payload: TokenPayload;
    try {
      payload = JSON.parse(fromB64url(parts[1]).toString('utf8')) as TokenPayload;
    } catch {
      throw new OAuthError('invalid_token', 'Charge de jeton illisible.', 401);
    }
    if (payload.t !== kind) throw new OAuthError('invalid_token', `Jeton de type ${payload.t} là où ${kind} est attendu.`, 401);
    if (now() >= payload.exp) throw new OAuthError('invalid_token', 'Jeton expiré.', 401);
    return payload;
  };

  /** client_secret DÉRIVÉ (stateless) : HMAC(client_id) — vérifiable par toute instance. */
  const deriveClientSecret = (clientId: string): string => b64url(hmac(`client:${clientId}`));

  const constantTimeEqual = (a: string, b: string): boolean => {
    const da = createHash('sha256').update(a, 'utf8').digest();
    const db = createHash('sha256').update(b, 'utf8').digest();
    return timingSafeEqual(da, db);
  };

  /** Origine EXACTE (jamais un préfixe) et REFUS de tout userinfo embarqué
   *  (`http://127.0.0.1@evil.com` a pour host `evil.com` — finding CRITIQUE du panel FinanceAI). */
  const isRedirectAllowed = (redirectUri: string): boolean => {
    let u: URL;
    try {
      u = new URL(redirectUri);
    } catch {
      return false;
    }
    if (u.username !== '' || u.password !== '') return false;
    if (LOOPBACK_HOSTS.has(u.hostname) && (u.protocol === 'http:' || u.protocol === 'https:')) return true;
    return allowedOrigins.includes(u.origin);
  };

  const issueTokens = (clientId: string): TokenSet => ({
    access_token: sign({ t: 'access', cid: clientId, exp: now() + accessTtl, jti: randomUUID() }),
    token_type: 'Bearer',
    expires_in: Math.floor(accessTtl / 1000),
    refresh_token: sign({ t: 'refresh', cid: clientId, exp: now() + refreshTtl, jti: randomUUID() }),
  });

  return {
    /** RFC 8414 — métadonnées du serveur d'autorisation. */
    authorizationServerMetadata: () => ({
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/api/mcp/authorize`,
      token_endpoint: `${config.issuer}/api/mcp/token`,
      registration_endpoint: `${config.issuer}/api/mcp/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      scopes_supported: ['driveai'],
    }),

    /** URL de découverte RFC 9728 (pour le WWW-Authenticate du 401). */
    resourceMetadataUrl: () => `${config.issuer}/.well-known/oauth-protected-resource`,

    /** RFC 9728 — métadonnées de la ressource protégée (découverte MCP). */
    protectedResourceMetadata: () => ({
      resource: `${config.issuer}/api/mcp`,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ['header'],
    }),

    /** DCR (RFC 7591) sans stockage : le secret est dérivé du client_id. */
    registerClient: (redirectUris: string[]) => {
      if (!redirectUris.length || !redirectUris.every(isRedirectAllowed)) {
        throw new OAuthError('invalid_redirect_uri',
          `redirect_uris hors allowlist (origines admises : ${allowedOrigins.join(', ')} ou loopback).`);
      }
      const clientId = randomUUID();
      return {
        client_id: clientId,
        client_secret: deriveClientSecret(clientId),
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
      };
    },

    /** Validation des paramètres d'une requête d'autorisation (AVANT d'afficher le formulaire). */
    validateAuthorizeRequest: (q: {
      response_type?: string; client_id?: string; redirect_uri?: string;
      code_challenge?: string; code_challenge_method?: string;
    }) => {
      if (q.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type=code requis (OAuth 2.1).');
      if (!q.client_id) throw new OAuthError('invalid_request', 'client_id manquant.');
      if (!q.redirect_uri || !isRedirectAllowed(q.redirect_uri)) {
        throw new OAuthError('invalid_request', 'redirect_uri manquant ou hors allowlist.');
      }
      if (!q.code_challenge || q.code_challenge_method !== 'S256') {
        throw new OAuthError('invalid_request', 'PKCE S256 obligatoire (code_challenge + code_challenge_method=S256).');
      }
    },

    /** Après saisie de la clé d'accès : émet le code (signé, lié au client/redirect/PKCE). */
    authorize: (params: { clientId: string; redirectUri: string; codeChallenge: string; accessKey: string }) => {
      // Ceinture + bretelles : re-vérifie l'allowlist SOI-MÊME (finding #4 panel FinanceAI).
      if (!isRedirectAllowed(params.redirectUri)) {
        throw new OAuthError('invalid_request', 'redirect_uri hors allowlist.');
      }
      if (!constantTimeEqual(params.accessKey, config.accessKey)) {
        throw new OAuthError('access_denied', 'Clé d’accès invalide.', 403);
      }
      return sign({
        t: 'code', cid: params.clientId, exp: now() + codeTtl,
        ru: params.redirectUri, cc: params.codeChallenge, jti: randomUUID(),
      });
    },

    /** grant_type=authorization_code — vérifie code + PKCE + client, émet access+refresh. */
    exchangeCode: (params: {
      code: string; clientId: string; clientSecret?: string;
      redirectUri: string; codeVerifier: string;
    }): TokenSet => {
      const payload = verify(params.code, 'code');
      // OAuth 2.1 : code à USAGE UNIQUE (anti-rejeu, best-effort — cf. en-tête).
      if (!consume(payload.jti, payload.exp)) throw new OAuthError('invalid_grant', 'Code déjà utilisé.');
      if (payload.cid !== params.clientId) throw new OAuthError('invalid_grant', 'Code émis pour un autre client.');
      if (payload.ru !== params.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri différent de celui du code.');
      if (params.clientSecret != null && !constantTimeEqual(params.clientSecret, deriveClientSecret(params.clientId))) {
        throw new OAuthError('invalid_client', 'client_secret invalide.', 401);
      }
      const challenge = b64url(createHash('sha256').update(params.codeVerifier, 'utf8').digest());
      if (challenge !== payload.cc) throw new OAuthError('invalid_grant', 'Vérification PKCE échouée.');
      return issueTokens(params.clientId);
    },

    /** grant_type=refresh_token — rotation OAuth 2.1 (nouveau refresh à chaque usage). */
    refreshGrant: (params: { refreshToken: string; clientId: string; clientSecret?: string }): TokenSet => {
      const payload = verify(params.refreshToken, 'refresh');
      if (payload.cid !== params.clientId) throw new OAuthError('invalid_grant', 'Refresh token émis pour un autre client.');
      if (params.clientSecret != null && !constantTimeEqual(params.clientSecret, deriveClientSecret(params.clientId))) {
        throw new OAuthError('invalid_client', 'client_secret invalide.', 401);
      }
      if (!consume(payload.jti, payload.exp)) throw new OAuthError('invalid_grant', 'Refresh token déjà utilisé (rotation).');
      return issueTokens(payload.cid);
    },

    /** Garde du endpoint /api/mcp : jette OAuthError(401) si le Bearer est absent/invalide/expiré. */
    verifyAccessToken: (authorizationHeader: string | undefined): void => {
      const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
      if (!match) throw new OAuthError('invalid_token', 'Jeton Bearer requis.', 401);
      verify(match[1].trim(), 'access');
    },
  };
}

export type OAuthProvider = ReturnType<typeof makeOAuthProvider>;

/* ---------- Limiteur de tentatives (port de mcp/auth/rateLimit.ts FinanceAI) ---------- */
// La SEULE porte devinable est la clé d'accès du formulaire d'autorisation. On compte les ÉCHECS
// (jamais les succès — Marc n'est jamais bloqué par son usage légitime), compteur GLOBAL (une clé
// par IP se contourne via X-Forwarded-For).
// ⚠️ HONNÊTETÉ (revue sécurité C28-53) : sur Vercel ce limiteur est un FILET FAIBLE, pas la
// défense. Vercel scale HORIZONTALEMENT (≈ 1 requête/instance), donc un compteur en mémoire
// d'instance ne voit PAS une attaque PARALLÈLE : 50 POST concurrents ouvrent 50 instances, chacune
// à 0 → protection effective ~nulle contre un brute-force distribué (c'est PIRE que Cloud Run, où
// la concurrence retombe sur une instance tiède). Ce qu'il apporte réellement : (a) freiner un
// pilonnage SÉRIEL depuis une même instance chaude, (b) TRACER chaque échec (console.error →
// runbook de rotation). LA VRAIE BARRIÈRE anti-brute-force est l'ENTROPIE de `MCP_ACCESS_KEY` :
// elle DOIT être aléatoire (`openssl rand`, ≥ 16 car. ≈ 95 bits), jamais une passphrase choisie —
// docs/MCP.md l'impose. Kill-switch d'incident = rotation de `MCP_SIGNING_KEY`.

export const AUTHORIZE_MAX_FAILURES = 8;
export const AUTHORIZE_WINDOW_MS = 15 * 60_000;

export interface AttemptLimiter {
  isBlocked: () => boolean;
  retryAfterSeconds: () => number;
  recordFailure: () => void;
  reset: () => void;
}

export function makeAttemptLimiter(opts: {
  maxFailures?: number; windowMs?: number; now?: () => number;
} = {}): AttemptLimiter {
  const maxFailures = opts.maxFailures ?? AUTHORIZE_MAX_FAILURES;
  const windowMs = opts.windowMs ?? AUTHORIZE_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());
  let failures: number[] = [];
  const purge = (): number[] => {
    const cutoff = now() - windowMs;
    failures = failures.filter((t) => t > cutoff);
    return failures;
  };
  return {
    isBlocked: () => purge().length >= maxFailures,
    retryAfterSeconds: () => {
      const live = purge();
      if (live.length < maxFailures) return 0;
      const remainingMs = live[0] + windowMs - now();
      return Math.max(1, Math.ceil(remainingMs / 1000));
    },
    recordFailure: () => { purge(); failures.push(now()); },
    reset: () => { failures = []; },
  };
}

/* ---------- Environnement MCP ---------- */

export interface EnvMcp {
  signingKey: string;
  accessKey: string;
  webappUrl: string;
  /** Secret DÉDIÉ des actions moteur `mcp-*` (Script Property `DriveAI_MCP_SECRET`). */
  engineSecret: string;
  /** Secret webapp existant — UNIQUEMENT pour l'action `chat-assistant` (question_documents). */
  webappSecret: string;
}

/** null si la config Vercel est incomplète → les endpoints répondent 503 « mcp disabled » (fermé). */
export function lireEnvMcp(): EnvMcp | null {
  const signingKey = process.env.MCP_SIGNING_KEY ?? '';
  const accessKey = process.env.MCP_ACCESS_KEY ?? '';
  const webappUrl = (process.env.WEBAPP_URL ?? '').trim();
  const engineSecret = process.env.MCP_ENGINE_SECRET ?? '';
  const webappSecret = process.env.WEBAPP_SECRET ?? '';
  if (signingKey.length < 32 || accessKey.length < 16 || !webappUrl || !engineSecret || !webappSecret) return null;
  return { signingKey, accessKey, webappUrl, engineSecret, webappSecret };
}
