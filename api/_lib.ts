/**
 * api/_lib.ts — boîte à outils PARTAGÉE des fonctions serverless Vercel (session durable, C28-14).
 *
 * ZÉRO dépendance externe, par CONSTRUCTION : le projet Vercel est enraciné au DÉPÔT
 * (vercel.json : installCommand "true" → aucun node_modules à la racine au build) — tout module
 * npm importé ici casserait le déploiement. Cookies et chiffrement sont donc faits avec les
 * seuls modules Node natifs (node:crypto), et `fetch` est le global Node 18+.
 *
 * SÉCURITÉ (plan architecte 2026-07-09, garde-fous §2) :
 *  - le refresh token ne transite JAMAIS vers le JavaScript client : il vit dans un cookie
 *    `HttpOnly` + `Secure` + `SameSite=Strict`, CHIFFRÉ (AES-256-GCM, clé dérivée de la
 *    variable d'environnement COOKIE_SECRET) — un vol de cookie via un tiers ne suffit pas ;
 *  - les secrets (GOOGLE_CLIENT_SECRET, COOKIE_SECRET) ne vivent QUE dans les variables
 *    d'environnement Vercel — jamais dans le code, jamais côté client (§2.4) ;
 *  - le périmètre OAuth reste STRICTEMENT celui de l'app (Sheets + Drive + Tasks + Calendar,
 *    JAMAIS Gmail — §2.3 moindre privilège) ; un fichier de préfixe `_` n'est pas exposé
 *    comme endpoint par Vercel.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type Requete = IncomingMessage;
export type Reponse = ServerResponse;

/** Périmètre OAuth de l'APP (identique à l'ancien GIS de app/src/google.ts — Sheets inclus :
 * sans lui l'app ne lit plus la Sheet d'état). Toute extension = décision Marc (§2.3). */
export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export const COOKIE_RT = 'driveai_rt'; // refresh token chiffré (longue durée)
export const COOKIE_ETAT = 'driveai_oauth_etat'; // anti-CSRF du flux OAuth (10 min)
const UN_AN_S = 365 * 24 * 60 * 60;

/* ---------- Requête / réponse ---------- */

/** Origine PUBLIQUE de la requête (derrière le proxy Vercel : x-forwarded-*). */
export function origine(req: Requete): string {
  const proto = premiere(req.headers['x-forwarded-proto']) ?? 'https';
  const hote = premiere(req.headers['x-forwarded-host']) ?? premiere(req.headers.host) ?? '';
  return `${proto}://${hote}`;
}

function premiere(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parametres(req: Requete): URLSearchParams {
  return new URL(req.url ?? '/', origine(req)).searchParams;
}

export function repondreJson(res: Reponse, code: number, corps: unknown): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

export function rediriger(res: Reponse, vers: string): void {
  res.statusCode = 302;
  res.setHeader('Location', vers);
  res.end();
}

/* ---------- Cookies (sans dépendance) ---------- */

export function lireCookies(req: Requete): Record<string, string> {
  const brut = premiere(req.headers.cookie) ?? '';
  const cookies: Record<string, string> = {};
  for (const morceau of brut.split(';')) {
    const egal = morceau.indexOf('=');
    if (egal === -1) continue;
    const nom = morceau.slice(0, egal).trim();
    if (nom) cookies[nom] = decodeURIComponent(morceau.slice(egal + 1).trim());
  }
  return cookies;
}

/**
 * Pose un cookie durci. `sameSite` : `Strict` pour le refresh token (seuls nos propres fetchs
 * même-site l'envoient) ; `Lax` OBLIGATOIRE pour le cookie d'état anti-CSRF — il doit être
 * envoyé sur la navigation de RETOUR depuis accounts.google.com (cross-site top-level GET),
 * que `Strict` bloquerait. `Secure` est omis en dev http://localhost (sinon cookie rejeté).
 */
export function poserCookie(
  res: Reponse,
  req: Requete,
  nom: string,
  valeur: string,
  maxAgeS: number,
  sameSite: 'Strict' | 'Lax',
): void {
  const attributs = [
    `${nom}=${encodeURIComponent(valeur)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeS}`,
  ];
  if (origine(req).startsWith('https://')) attributs.push('Secure');
  const existants = res.getHeader('Set-Cookie');
  const liste = Array.isArray(existants) ? existants.map(String) : existants ? [String(existants)] : [];
  liste.push(attributs.join('; '));
  res.setHeader('Set-Cookie', liste);
}

export function effacerCookie(res: Reponse, req: Requete, nom: string): void {
  poserCookie(res, req, nom, '', 0, 'Lax');
}

export function poserCookieRefresh(res: Reponse, req: Requete, refreshChiffre: string): void {
  poserCookie(res, req, COOKIE_RT, refreshChiffre, UN_AN_S, 'Strict');
}

/* ---------- Chiffrement du refresh token (AES-256-GCM, clé dérivée de COOKIE_SECRET) ---------- */

function cle(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Sortie : base64url(iv | tag | chiffré) — auto-contenue, authentifiée (GCM). */
export function chiffrer(texte: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle(secret), iv);
  const chiffre = Buffer.concat([c.update(texte, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), chiffre]).toString('base64url');
}

/** null si le cookie est corrompu/forgé (tag GCM invalide) — jamais d'exception. */
export function dechiffrer(b64: string, secret: string): string | null {
  try {
    const brut = Buffer.from(b64, 'base64url');
    const iv = brut.subarray(0, 12);
    const tag = brut.subarray(12, 28);
    const chiffre = brut.subarray(28);
    const d = createDecipheriv('aes-256-gcm', cle(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(chiffre), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function jetonAleatoire(): string {
  return randomBytes(16).toString('hex');
}

/* ---------- Environnement ---------- */

export interface EnvOAuth {
  clientId: string;
  clientSecret: string;
  cookieSecret: string;
}

/** null si la config Vercel est incomplète (les 3 variables sont requises). */
export function lireEnv(): EnvOAuth | null {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const cookieSecret = process.env.COOKIE_SECRET ?? '';
  if (!clientId || !clientSecret || !cookieSecret) return null;
  return { clientId, clientSecret, cookieSecret };
}

/* ---------- Échange de jetons Google ---------- */

const URL_TOKEN = 'https://oauth2.googleapis.com/token';

export interface ReponseToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

export async function echangerCode(env: EnvOAuth, code: string, redirectUri: string): Promise<ReponseToken> {
  return appelToken({
    grant_type: 'authorization_code',
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: redirectUri,
  });
}

export async function rafraichirAccessToken(env: EnvOAuth, refreshToken: string): Promise<ReponseToken> {
  return appelToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
}

async function appelToken(corps: Record<string, string>): Promise<ReponseToken> {
  const rep = await fetch(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corps).toString(),
  });
  // Le succès se juge au CONTENU : un non-200 porte un JSON { error } qu'on remonte tel quel.
  return (await rep.json().catch(() => ({ error: `HTTP ${rep.status}` }))) as ReponseToken;
}
