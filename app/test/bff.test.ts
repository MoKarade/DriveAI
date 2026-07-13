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
  emailDepuisIdToken,
  COOKIE_RT,
  SCOPES,
  SCOPES_IDENTITE,
} from '../../api/_lib';
import handlerConfig from '../../api/config';

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

/* ---------- Verrou d'identité + config serveur (C28-20, ADR-0021) ---------- */

function fauxIdToken(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature-non-verifiee`;
}

describe('verrou d\'identité (emailDepuisIdToken)', () => {
  it('les scopes d\'identité sont openid email — de la LECTURE d\'identité, jamais un service (§2.3)', () => {
    expect(SCOPES_IDENTITE).toBe('openid email');
    expect(SCOPES_IDENTITE).not.toMatch(/gmail|drive|spreadsheets|tasks|calendar/i);
  });

  it('email vérifié → minuscule (comparaison insensible à la casse avec ALLOWED_EMAIL)', () => {
    expect(emailDepuisIdToken(fauxIdToken({ email: 'Marc.Exemple@Gmail.com', email_verified: true })))
      .toBe('marc.exemple@gmail.com');
    // `email_verified` ABSENT n'est pas un refus : seul `false` explicite l'est.
    expect(emailDepuisIdToken(fauxIdToken({ email: 'x@y.z' }))).toBe('x@y.z');
  });

  it('échec FERMÉ : non vérifié, email absent, JWT malformé ou payload illisible → null', () => {
    expect(emailDepuisIdToken(fauxIdToken({ email: 'x@y.z', email_verified: false }))).toBeNull();
    expect(emailDepuisIdToken(fauxIdToken({ sub: '12345' }))).toBeNull();
    expect(emailDepuisIdToken('')).toBeNull();
    expect(emailDepuisIdToken('a.b')).toBeNull();
    expect(emailDepuisIdToken('un.jwt.a.cinq.parties')).toBeNull();
    expect(emailDepuisIdToken(`x.${Buffer.from('pas du json').toString('base64url')}.y`)).toBeNull();
  });
});

function fauxResComplet(): ServerResponse & { corps: () => string } {
  const entetes: Record<string, unknown> = {};
  let corps = '';
  return {
    statusCode: 0,
    entetes,
    setHeader(nom: string, valeur: unknown) { entetes[nom] = valeur; },
    getHeader(nom: string) { return entetes[nom]; },
    end(texte?: string) { corps = texte ?? ''; },
    corps: () => corps,
  } as unknown as ServerResponse & { corps: () => string };
}

describe('/api/config — la config ne sort qu\'à une session VALIDE (zéro configuration client)', () => {
  const CLES_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COOKIE_SECRET',
    'SPREADSHEET_ID', 'WEBAPP_URL', 'WEBAPP_SECRET'] as const;
  const BASE: Record<string, string> = {
    GOOGLE_CLIENT_ID: 'id-test', GOOGLE_CLIENT_SECRET: 'secret-test', COOKIE_SECRET: 'cookie-secret-test',
    SPREADSHEET_ID: 'sheet-test', WEBAPP_URL: 'https://script.google.com/macros/s/x/exec', WEBAPP_SECRET: 'wa-secret',
  };

  function avecEnv(vars: Record<string, string>, fn: () => void): void {
    const avant = CLES_ENV.map((k) => [k, process.env[k]] as const);
    for (const k of CLES_ENV) delete process.env[k];
    Object.assign(process.env, vars);
    try { fn(); } finally {
      for (const [k, v] of avant) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }

  it('cookie de session déchiffrable → 200 avec la config des variables Vercel', () => {
    avecEnv(BASE, () => {
      const res = fauxResComplet();
      const cookie = `${COOKIE_RT}=${encodeURIComponent(chiffrer('refresh-token', BASE.COOKIE_SECRET))}`;
      handlerConfig(fauxReq({ cookie, 'x-forwarded-proto': 'https', host: 'x' }), res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.corps())).toEqual({
        spreadsheetId: 'sheet-test', webappUrl: BASE.WEBAPP_URL, webappSecret: 'wa-secret',
      });
    });
  });

  it('sans cookie, ou cookie forgé → 401 et AUCUNE config dans la réponse (le secret ne fuit pas)', () => {
    avecEnv(BASE, () => {
      const sans = fauxResComplet();
      handlerConfig(fauxReq({ 'x-forwarded-proto': 'https', host: 'x' }), sans);
      expect(sans.statusCode).toBe(401);
      expect(sans.corps()).not.toContain('wa-secret');

      const forge = fauxResComplet();
      handlerConfig(fauxReq({ cookie: `${COOKIE_RT}=forge-par-un-tiers`, host: 'x' }), forge);
      expect(forge.statusCode).toBe(401);
      expect(forge.corps()).not.toContain('wa-secret');
    });
  });

  it('variables serveur incomplètes → 500, jamais une config partielle', () => {
    const { SPREADSHEET_ID: _, ...sansSheet } = BASE;
    avecEnv(sansSheet, () => {
      const res = fauxResComplet();
      const cookie = `${COOKIE_RT}=${encodeURIComponent(chiffrer('rt', BASE.COOKIE_SECRET))}`;
      handlerConfig(fauxReq({ cookie, host: 'x' }), res);
      expect(res.statusCode).toBe(500);
      expect(res.corps()).not.toContain('wa-secret');
    });
  });
});
