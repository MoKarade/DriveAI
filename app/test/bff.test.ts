/**
 * bff.test.ts — briques PURES du backend de session durable (C28-14, api/_lib.ts) :
 * chiffrement authentifié du refresh token, cookies durcis, et invariants de sécurité
 * (HttpOnly toujours ; Secure dérivé du protocole ; état anti-CSRF en Lax — Strict ne
 * survivrait PAS à la navigation de retour depuis accounts.google.com).
 */

import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  chiffrer,
  dechiffrer,
  lireCookies,
  poserCookie,
  poserCookieRefresh,
  effacerCookie,
  origine,
  COOKIE_RT,
  SCOPES,
} from '../../api/_lib';

function fauxReq(headers: Record<string, string>): IncomingMessage {
  return { headers, url: '/', method: 'GET' } as unknown as IncomingMessage;
}

function fauxRes(): ServerResponse & { entetes: Record<string, unknown> } {
  const entetes: Record<string, unknown> = {};
  return {
    entetes,
    setHeader(nom: string, valeur: unknown) { entetes[nom] = valeur; },
    getHeader(nom: string) { return entetes[nom]; },
  } as unknown as ServerResponse & { entetes: Record<string, unknown> };
}

describe('chiffrement du refresh token (AES-256-GCM)', () => {
  it('aller-retour fidèle, sortie opaque (jamais le clair dans le cookie)', () => {
    const secret = 'un-secret-de-test-suffisamment-long';
    const rt = '1//refresh-token-google-très-sensible';
    const boite = chiffrer(rt, secret);
    expect(boite).not.toContain('refresh');
    expect(dechiffrer(boite, secret)).toBe(rt);
  });

  it('cookie forgé, tronqué ou mauvais secret → null (échec fermé, jamais d\'exception)', () => {
    const secret = 'bon-secret';
    const boite = chiffrer('valeur', secret);
    expect(dechiffrer(boite, 'mauvais-secret')).toBeNull();
    expect(dechiffrer(boite.slice(0, boite.length - 4) + 'AAAA', secret)).toBeNull();
    expect(dechiffrer('pas-du-base64url-valide!!!', secret)).toBeNull();
    expect(dechiffrer('', secret)).toBeNull();
  });

  it('deux chiffrements du même clair diffèrent (IV aléatoire — pas d\'empreinte stable)', () => {
    expect(chiffrer('x', 's')).not.toBe(chiffrer('x', 's'));
  });
});

describe('cookies durcis', () => {
  it('lireCookies parse un en-tête réel (espaces, =, valeurs encodées)', () => {
    const req = fauxReq({ cookie: 'a=1; driveai_rt=abc%3D%3D; vide=; b = 2' });
    const cookies = lireCookies(req);
    expect(cookies.a).toBe('1');
    expect(cookies.driveai_rt).toBe('abc==');
    expect(cookies.b).toBe('2');
    expect(lireCookies(fauxReq({}))).toEqual({});
  });

  it('poserCookieRefresh : HttpOnly + SameSite=Strict + Secure (https) + 1 an', () => {
    const res = fauxRes();
    poserCookieRefresh(res, fauxReq({ 'x-forwarded-proto': 'https', host: 'driveai.vercel.app' }), 'boite');
    const [cookie] = res.entetes['Set-Cookie'] as string[];
    expect(cookie).toContain(`${COOKIE_RT}=boite`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(cookie).toContain('Path=/');
  });

  it('en dev http://localhost, Secure est OMIS (sinon le navigateur rejette le cookie)', () => {
    const res = fauxRes();
    poserCookieRefresh(res, fauxReq({ 'x-forwarded-proto': 'http', host: 'localhost:5173' }), 'boite');
    const [cookie] = res.entetes['Set-Cookie'] as string[];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
  });

  it('effacerCookie pose Max-Age=0 et poserCookie EMPILE sans écraser les Set-Cookie existants', () => {
    const res = fauxRes();
    const req = fauxReq({ 'x-forwarded-proto': 'https', host: 'x' });
    poserCookie(res, req, 'etat', 'abc', 600, 'Lax'); // anti-CSRF : Lax OBLIGATOIRE (retour cross-site)
    effacerCookie(res, req, 'etat');
    const cookies = res.entetes['Set-Cookie'] as string[];
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[1]).toContain('Max-Age=0');
  });
});

describe('invariants de sécurité', () => {
  it('origine dérive du proxy Vercel (x-forwarded-*), repli sur host', () => {
    expect(origine(fauxReq({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'driveai.vercel.app' })))
      .toBe('https://driveai.vercel.app');
    expect(origine(fauxReq({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }))).toBe('http://localhost:3000');
  });

  it('le périmètre OAuth serveur ne contient JAMAIS Gmail (§2.3 — moindre privilège)', () => {
    expect(SCOPES).not.toMatch(/gmail/i);
    // Et il couvre exactement ce que l'app consomme (Sheets inclus : sans lui, plus de Sheet d'état).
    for (const attendu of ['spreadsheets', 'auth/drive', 'auth/tasks', 'calendar.events']) {
      expect(SCOPES).toContain(attendu);
    }
  });
});
