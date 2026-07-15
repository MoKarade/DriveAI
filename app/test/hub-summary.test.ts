/**
 * hub-summary.test.ts — GET /api/hub/summary (api/hub/summary.ts) : jeton `x-hub-token` exigé
 * (401 { error:"unauthorized" }, échec fermé), HUB_TOKEN absent → 503 { error:"hub disabled" },
 * non-GET → 405, et payload « building » VALIDÉ par le VRAI schéma @mokarade/hub-contract
 * (devDependency de app/ uniquement — api/ reste ZÉRO dépendance, la forme du contrat y est
 * inlinée ; ce test est le verrou anti-dérive). Compare aussi à `buildingSummary()` du package
 * pour garantir l'équivalence exacte de la forme Phase 0.
 */

import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTRACT_VERSION, HUB_TOKEN_HEADER, buildingSummary, validateSummary } from '@mokarade/hub-contract';
import handlerHub from '../../api/hub/summary';

const JETON = 'jeton-hub-de-test-0123456789';
const URL_APP = 'https://drive.hubperso.com';

function fauxReq(headers: Record<string, string>, methode = 'GET'): IncomingMessage {
  return { headers, url: '/api/hub/summary', method: methode } as unknown as IncomingMessage;
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

describe('/api/hub/summary — auth (échec fermé)', () => {
  it('HUB_TOKEN non configuré → 503 { error:"hub disabled" }, jamais de summary', () => {
    avecHubToken(undefined, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.corps())).toEqual({ error: 'hub disabled' });
      expect(res.corps()).not.toContain('contractVersion');
    });
  });

  it('sans jeton → 401 { error:"unauthorized" } ; jeton invalide → 401 ; rien ne fuit', () => {
    avecHubToken(JETON, () => {
      const sans = fauxRes();
      handlerHub(fauxReq({}), sans);
      expect(sans.statusCode).toBe(401);
      expect(JSON.parse(sans.corps())).toEqual({ error: 'unauthorized' });
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
      expect(res.corps()).not.toContain('contractVersion');
    });
  });
});

describe('/api/hub/summary — payload « building » honnête (Phase 0)', () => {
  it('200 : summary conforme au VRAI contrat, no-store, zéro chiffre inventé', () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(200);
      expect(res.entetes['Cache-Control']).toBe('no-store');

      const summary = validateSummary(JSON.parse(res.corps())); // lève si non conforme au schéma Zod
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.status).toBe('building');
      expect(summary.metrics).toEqual([]); // no-fake-data : aucune métrique en Phase 0
      expect(summary.app).toEqual({ id: 'driveai', name: 'DriveAI', url: URL_APP, color: '#8ab4f8' });
      expect(summary.alerts).toEqual([
        { label: 'Moteur en Phase 0 — classement pas encore actif', severity: 'info' },
      ]);
      expect(summary.actions).toEqual([
        { label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP },
      ]);
    });
  });

  it('équivaut EXACTEMENT à buildingSummary(app, { alertLabel }) + action « Ouvrir DriveAI »', () => {
    avecHubToken(JETON, () => {
      const res = fauxRes();
      handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));

      const app = { id: 'driveai', name: 'DriveAI', url: URL_APP, color: '#8ab4f8' };
      const attendu = buildingSummary(app, { alertLabel: 'Moteur en Phase 0 — classement pas encore actif' });
      // generatedAt diffère (horodatage) : on compare le reste champ par champ.
      expect(summary.app).toEqual(attendu.app);
      expect(summary.status).toBe(attendu.status);
      expect(summary.metrics).toEqual(attendu.metrics);
      expect(summary.alerts).toEqual(attendu.alerts);
      expect(summary.contractVersion).toBe(attendu.contractVersion);
      // La seule addition vs buildingSummary (actions:[]) est l'action « Ouvrir DriveAI ».
      expect(summary.actions).toEqual([{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }]);
    });
  });
});
