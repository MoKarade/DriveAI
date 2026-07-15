/**
 * hub-summary.test.ts — GET /hub/summary (api/hub-summary.ts, HUB-01) : jeton x-hub-token
 * exigé (401 sinon, échec fermé), Cache-Control: no-store, et payload VALIDÉ par le VRAI
 * schéma @mokarade/hub-contract (devDependency de app/ uniquement — api/ reste zéro
 * dépendance, la forme du contrat y est inlinée ; ce test est le verrou anti-dérive).
 */

import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTRACT_VERSION, HUB_TOKEN_HEADER, validateSummary } from '@mokarade/hub-contract';
import handlerHub from '../../api/hub-summary';

const JETON = 'jeton-hub-de-test-0123456789';

function fauxReq(headers: Record<string, string>, methode = 'GET'): IncomingMessage {
  return { headers, url: '/hub/summary', method: methode } as unknown as IncomingMessage;
}

function fauxRes(): ServerResponse & { corps: () => string; entetes: Record<string, unknown> } {
  const entetes: Record<string, unknown> = {};
  let corps = '';
  return {
    statusCode: 0,
    entetes,
    setHeader(nom: string, valeur: unknown) { entetes[nom] = valeur; },
    getHeader(nom: string) { return entetes[nom]; },
    end(texte?: string) { corps = texte ?? ''; },
    corps: () => corps,
  } as unknown as ServerResponse & { corps: () => string; entetes: Record<string, unknown> };
}

function avecHubToken(valeur: string | undefined, fn: () => void): void {
  const avant = process.env.HUB_TOKEN;
  if (valeur === undefined) delete process.env.HUB_TOKEN;
  else process.env.HUB_TOKEN = valeur;
  try { fn(); } finally {
    if (avant === undefined) delete process.env.HUB_TOKEN;
    else process.env.HUB_TOKEN = avant;
  }
}

describe('/hub/summary — auth (échec fermé)', () => {
  it('HUB_TOKEN non configuré → 500, jamais de summary', () => {
    avecHubToken(undefined, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(500);
      expect(res.corps()).not.toContain('contractVersion');
    });
  });

  it('sans jeton → 401 ; jeton invalide → 401 ; rien ne fuit', () => {
    avecHubToken(JETON, () => {
      const sans = fauxRes();
      handlerHub(fauxReq({}), sans);
      expect(sans.statusCode).toBe(401);
      expect(sans.corps()).not.toContain('contractVersion');

      const mauvais = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: 'forge-par-un-tiers' }), mauvais);
      expect(mauvais.statusCode).toBe(401);
      expect(mauvais.corps()).not.toContain('contractVersion');
    });
  });

  it('méthode non-GET → 405 même avec le bon jeton', () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }, 'POST'), res);
      expect(res.statusCode).toBe(405);
    });
  });
});

describe('/hub/summary — payload « building » honnête', () => {
  it('200 : summary conforme au VRAI contrat, no-store, zéro chiffre inventé', () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({
        [HUB_TOKEN_HEADER]: JETON,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'driveai-ivory.vercel.app',
      }), res);
      expect(res.statusCode).toBe(200);
      expect(res.entetes['Cache-Control']).toBe('no-store');

      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.status).toBe('building');
      expect(summary.metrics).toEqual([]);
      expect(summary.actions).toEqual([]);
      expect(summary.alerts).toHaveLength(1);
      expect(summary.alerts[0]?.severity).toBe('info');
      expect(summary.app).toMatchObject({
        id: 'driveai',
        name: 'DriveAI',
        url: 'https://driveai-ivory.vercel.app',
        color: '#2563eb',
      });
    });
  });

  it("l'URL publiée suit l'origine publique de la requête (migration de domaine sans redéploiement)", () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({
        [HUB_TOKEN_HEADER]: JETON,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'drive.hubperso.com',
      }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.app.url).toBe('https://drive.hubperso.com');
    });
  });

  it('origine indisponible → repli sur l\'URL par défaut (toujours une URL valide)', () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.app.url).toBe('https://driveai-ivory.vercel.app');
    });
  });
});
