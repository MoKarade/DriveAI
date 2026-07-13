/**
 * callback.test.ts — le VERROU D'IDENTITÉ à son point d'application réel (C28-20, ADR-0021).
 * `emailDepuisIdToken` (pur) est testé dans bff.test.ts ; ICI on verrouille le HANDLER
 * /api/callback lui-même : email étranger, ALLOWED_EMAIL absente ou id_token manquant ⇒
 * AUCUN cookie de session posé + redirection `/?erreur=acces_refuse` ; email attendu ⇒ cookie
 * posé + retour à l'app. (Leçon durable : « promesse de verrou = verrou codé » — un test de la
 * fonction pure ne couvre pas le handler par contagion : une régression du bloc de comparaison
 * passerait une CI qui ne teste que la brique.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// `echangerCode` est BOUCHONNÉ (aucun réseau) ; tout le reste de _lib reste RÉEL
// (cookies, state anti-CSRF, chiffrement) — on teste le vrai chemin du handler.
vi.mock('../../api/_lib', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../api/_lib')>();
  return { ...reel, echangerCode: vi.fn() };
});

import handlerCallback from '../../api/callback';
import { echangerCode, COOKIE_RT, ReponseToken } from '../../api/_lib';

function fauxIdToken(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

function fauxReq(): IncomingMessage {
  return {
    url: '/api/callback?code=code-google&state=etat-1',
    method: 'GET',
    headers: {
      cookie: 'driveai_oauth_etat=etat-1',
      'x-forwarded-proto': 'https',
      host: 'driveai.test',
    },
  } as unknown as IncomingMessage;
}

interface ResCapture extends ServerResponse {
  entetes: Record<string, unknown>;
}

function fauxRes(): ResCapture {
  const entetes: Record<string, unknown> = {};
  return {
    statusCode: 0,
    entetes,
    setHeader(nom: string, valeur: unknown) { entetes[nom] = valeur; },
    getHeader(nom: string) { return entetes[nom]; },
    end() { /* redirection : pas de corps */ },
  } as unknown as ResCapture;
}

/** Les Set-Cookie de session RÉELLEMENT posés (un Max-Age=0 est un effacement, pas une pose). */
function cookiesSessionPoses(res: ResCapture): string[] {
  const brut = res.entetes['Set-Cookie'];
  const liste = Array.isArray(brut) ? brut.map(String) : brut ? [String(brut)] : [];
  return liste.filter((c) => c.startsWith(`${COOKIE_RT}=`) && !c.includes('Max-Age=0'));
}

async function appeler(jetons: ReponseToken): Promise<ResCapture> {
  vi.mocked(echangerCode).mockResolvedValue(jetons);
  const res = fauxRes();
  await handlerCallback(fauxReq(), res);
  return res;
}

const CLES_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'COOKIE_SECRET', 'ALLOWED_EMAIL'] as const;
const sauvegarde: Array<[string, string | undefined]> = [];

beforeEach(() => {
  for (const k of CLES_ENV) sauvegarde.push([k, process.env[k]]);
  process.env.GOOGLE_CLIENT_ID = 'id-test';
  process.env.GOOGLE_CLIENT_SECRET = 'secret-test';
  process.env.COOKIE_SECRET = 'cookie-secret-test';
  process.env.ALLOWED_EMAIL = 'Marc.Exemple@Gmail.com'; // casse volontaire : comparaison insensible
});

afterEach(() => {
  while (sauvegarde.length) {
    const [k, v] = sauvegarde.pop()!;
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  vi.mocked(echangerCode).mockReset();
});

describe('/api/callback — verrou ALLOWED_EMAIL au point d\'application (C28-20)', () => {
  it('compte autorisé (casse différente) → cookie de session posé + retour à l\'app', async () => {
    const res = await appeler({
      refresh_token: 'rt-google',
      id_token: fauxIdToken({ email: 'marc.exemple@gmail.com', email_verified: true }),
    });
    expect(res.entetes.Location).toBe('/');
    expect(cookiesSessionPoses(res)).toHaveLength(1);
  });

  it('compte ÉTRANGER → AUCUN cookie de session + /?erreur=acces_refuse', async () => {
    const res = await appeler({
      refresh_token: 'rt-google',
      id_token: fauxIdToken({ email: 'intrus@exemple.com', email_verified: true }),
    });
    expect(res.entetes.Location).toBe('/?erreur=acces_refuse');
    expect(cookiesSessionPoses(res)).toHaveLength(0);
  });

  it('ALLOWED_EMAIL non configurée → échec FERMÉ (refus, jamais passage ouvert)', async () => {
    delete process.env.ALLOWED_EMAIL;
    const res = await appeler({
      refresh_token: 'rt-google',
      id_token: fauxIdToken({ email: 'marc.exemple@gmail.com', email_verified: true }),
    });
    expect(res.entetes.Location).toBe('/?erreur=acces_refuse');
    expect(cookiesSessionPoses(res)).toHaveLength(0);
  });

  it('id_token absent ou email non vérifié → refus, aucun cookie', async () => {
    const sans = await appeler({ refresh_token: 'rt-google' });
    expect(sans.entetes.Location).toBe('/?erreur=acces_refuse');
    expect(cookiesSessionPoses(sans)).toHaveLength(0);

    const nonVerifie = await appeler({
      refresh_token: 'rt-google',
      id_token: fauxIdToken({ email: 'marc.exemple@gmail.com', email_verified: false }),
    });
    expect(nonVerifie.entetes.Location).toBe('/?erreur=acces_refuse');
    expect(cookiesSessionPoses(nonVerifie)).toHaveLength(0);
  });

  it('non-régression C28-14 : pas de refresh_token → /?auth=echec, jamais de demi-session', async () => {
    const res = await appeler({
      id_token: fauxIdToken({ email: 'marc.exemple@gmail.com', email_verified: true }),
    });
    expect(res.entetes.Location).toBe('/?auth=echec');
    expect(cookiesSessionPoses(res)).toHaveLength(0);
  });
});
