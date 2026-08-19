/**
 * hub-summary.test.ts — GET /api/hub/summary (api/hub/summary.ts) : jeton `x-hub-token` exigé
 * (401 { error:"unauthorized" }, échec fermé), HUB_TOKEN absent → 503 { error:"hub disabled" },
 * non-GET → 405, et payloads VALIDÉS par le VRAI schéma @mokarade/hub-contract (devDependency
 * de app/ uniquement — api/ reste ZÉRO dépendance, la forme du contrat y est inlinée ; ce test
 * est le verrou anti-dérive).
 *
 * C28-27 (Phase 1) : le handler est ASYNC et interroge la web app Apps Script via
 * `getEngineState()` (broker Vercel). Trois régimes testés ici :
 *  - canal PAS BRANCHÉ (env absentes) ou moteur jamais passé → « building » (forme Phase 0
 *    exacte, comparée à buildingSummary() du package) ;
 *  - canal SAIN → status ok/degraded, 3 métriques réelles, dataAsOf = lastRunAt ;
 *  - canal EN PANNE (HTML transitoire, ok:false, compteur corrompu) → 500, JAMAIS de summary
 *    partiel (échec fermé, leçon « /exec : le succès se juge au CONTENU »).
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTRACT_VERSION, HUB_TOKEN_HEADER, buildingSummary, validateSummary } from '@mokarade/hub-contract';
import handlerHub from '../../api/hub/summary';
import { __resetEngineStateCache, getEngineState } from '../../api/hub/_engineState';

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

/** Pose/retire des variables d'environnement le temps d'un test (restore garanti, même en échec). */
async function avecEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const avant: Record<string, string | undefined> = {};
  for (const nom of Object.keys(vars)) {
    avant[nom] = process.env[nom];
    if (vars[nom] === undefined) delete process.env[nom];
    else process.env[nom] = vars[nom];
  }
  try {
    await fn();
  } finally {
    for (const nom of Object.keys(vars)) {
      if (avant[nom] === undefined) delete process.env[nom];
      else process.env[nom] = avant[nom];
    }
  }
}

/** Réponse `fetch` factice de la web app Apps Script. */
function fauxFetch(status: number, corps: unknown, json = true): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError('Unexpected token < in JSON');
      return corps;
    },
  })) as unknown as typeof fetch;
}

const ETAT_SAIN = {
  ok: true,
  etat: {
    reviewQueueCount: 2,
    filedLast7d: 14,
    errorsLast7d: 1,
    lastRunAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    // Champs usage additifs (bloc coûts & quotas) publiés par le moteur.
    llmCostTotalUsd: 118.4,
    llmCostMonthUsd: 2.37,
    llmBudgetCampagnesUsd: 10,
    gmailThreadsToday: 41,
    gmailQuotaSuspended: false,
  },
};

// Le cache broker (protection du quota Apps Script) vit au niveau MODULE : sans remise à zéro,
// l'état lu par un test fuiterait dans le suivant et masquerait les régimes testés ici.
beforeEach(() => {
  __resetEngineStateCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetEngineStateCache();
});

describe('/api/hub/summary — auth (échec fermé)', () => {
  it('HUB_TOKEN non configuré → 503 { error:"hub disabled" }, jamais de summary', async () => {
    await avecEnv({ HUB_TOKEN: undefined }, async () => {
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.corps())).toEqual({ error: 'hub disabled' });
      expect(res.corps()).not.toContain('contractVersion');
    });
  });

  it('sans jeton → 401 { error:"unauthorized" } ; jeton invalide → 401 ; rien ne fuit', async () => {
    await avecEnv({ HUB_TOKEN: JETON }, async () => {
      const sans = fauxRes();
      await handlerHub(fauxReq({}), sans);
      expect(sans.statusCode).toBe(401);
      expect(JSON.parse(sans.corps())).toEqual({ error: 'unauthorized' });
      expect(sans.corps()).not.toContain('contractVersion');

      const mauvais = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: 'forge-par-un-tiers' }), mauvais);
      expect(mauvais.statusCode).toBe(401);
      expect(mauvais.corps()).not.toContain('contractVersion');
    });
  });

  it('méthode non-GET → 405 même avec le bon jeton', async () => {
    await avecEnv({ HUB_TOKEN: JETON }, async () => {
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }, 'POST'), res);
      expect(res.statusCode).toBe(405);
      expect(res.corps()).not.toContain('contractVersion');
    });
  });
});

describe('/api/hub/summary — « building » honnête (canal moteur pas branché)', () => {
  it('200 : summary conforme au VRAI contrat, no-store, zéro chiffre inventé', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: undefined, WEBAPP_SECRET: undefined }, async () => {
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(200);
      expect(res.entetes['Cache-Control']).toBe('no-store');

      const summary = validateSummary(JSON.parse(res.corps())); // lève si non conforme au schéma Zod
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.status).toBe('building');
      expect(summary.metrics).toEqual([]); // no-fake-data : aucune métrique sans canal moteur
      expect(summary.app).toEqual({ id: 'driveai', name: 'DriveAI', url: URL_APP, color: '#8ab4f8' });
      expect(summary.alerts).toEqual([
        { label: 'Moteur en Phase 0 — classement pas encore actif', severity: 'info' },
      ]);
      expect(summary.actions).toEqual([
        { label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP },
      ]);
    });
  });

  it('équivaut EXACTEMENT à buildingSummary(app, { alertLabel }) + action « Ouvrir DriveAI »', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: undefined, WEBAPP_SECRET: undefined }, async () => {
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
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

  it('moteur jamais passé (lastRunAt null) → « building » aussi, jamais de zéros inventés', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, {
        ok: true,
        etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: null },
      }));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(200);
      expect(validateSummary(JSON.parse(res.corps())).status).toBe('building');
    });
  });
});

describe('/api/hub/summary — métriques réelles (C28-27, canal sain)', () => {
  it('200 status ok : 3 métriques, dataAsOf = lastRunAt, alertes honnêtes, contrat respecté', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, ETAT_SAIN));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      expect(res.statusCode).toBe(200);

      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.status).toBe('ok');
      expect(summary.dataAsOf).toBe(ETAT_SAIN.etat.lastRunAt);
      expect(summary.metrics).toEqual([
        { label: 'Classés (7 jours)', value: 14, format: 'number' },
        { label: 'File de revue', value: 2, format: 'number' },
        { label: 'Erreurs (7 jours)', value: 1, format: 'number' },
      ]);
      // 1 erreur 7 j (warn) + 2 en file de revue (info) — moteur frais : pas d'alerte « muet ».
      expect(summary.alerts).toEqual([
        { label: '1 erreur(s) de traitement sur 7 jours', severity: 'warn' },
        { label: '2 document(s) en attente dans la file de revue', severity: 'info' },
      ]);
      expect(summary.actions).toEqual([{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }]);
      // Bloc usage : le coût publié est le CUMUL (`period: 'total'`), pas le mois. C'est ce qui
      // permet au hub d'afficher UN total — il somme par période et refuse de fusionner « cumulé »
      // avec « ce mois-ci ». Le mois n'est pas perdu : il devient un quota, avec le seuil du frein
      // des campagnes pour plafond (2,37 $ sur 10 $).
      expect(summary.usage?.cost).toEqual({ amount: 118.4, currency: 'USD', period: 'total' });
      expect(summary.usage?.quotas).toEqual([
        { label: 'Fils Gmail (aujourd’hui)', used: 41, limit: null, unit: 'fils' },
        { label: 'Coût LLM du mois (frein campagnes)', used: 2.37, limit: 10, unit: 'USD' },
      ]);
    });
  });

  it('sans champs usage (moteur pas encore redéployé) → pas de bloc usage, jamais inventé', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal(
        'fetch',
        fauxFetch(200, {
          ok: true,
          etat: { reviewQueueCount: 0, filedLast7d: 3, errorsLast7d: 0, lastRunAt: new Date().toISOString() },
        }),
      );
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.usage).toBeUndefined();
    });
  });

  it('cumul absent (web app en retard d\'un déploiement) → REPLI sur period "mois", jamais "total"', async () => {
    // Le champ est additif : la web app Apps Script peut n'avoir pas encore été redéployée. Le
    // repli publie le mois SOUS SON VRAI NOM. Le déclarer « total » afficherait un chiffre juste
    // sous une étiquette fausse — le hub le rangerait avec les cumuls des autres apps et le
    // total unique serait sous-estimé de tous les mois passés de DriveAI, sans rien de rouge.
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, {
        ok: true,
        etat: {
          reviewQueueCount: 0, filedLast7d: 3, errorsLast7d: 0,
          lastRunAt: new Date().toISOString(),
          llmCostMonthUsd: 2.37,
        },
      }));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.usage?.cost).toEqual({ amount: 2.37, currency: 'USD', period: 'mois' });
      // Et le mois n'est PAS aussi publié en quota : il est déjà le coût, ce serait le compter deux fois.
      expect(summary.usage?.quotas).toBeUndefined();
    });
  });

  it('cumul présent mais plafond absent → quota SANS limite, jamais un plafond inventé', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, {
        ok: true,
        etat: {
          reviewQueueCount: 0, filedLast7d: 3, errorsLast7d: 0,
          lastRunAt: new Date().toISOString(),
          llmCostTotalUsd: 118.4, llmCostMonthUsd: 2.37,
        },
      }));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.usage?.quotas).toEqual([
        { label: 'Coût LLM du mois (frein campagnes)', used: 2.37, limit: null, unit: 'USD' },
      ]);
    });
  });

  it('le cumul est arrondi au cent, comme le mois (aucun flottant qui bave à l\'affichage)', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, {
        ok: true,
        etat: {
          reviewQueueCount: 0, filedLast7d: 3, errorsLast7d: 0,
          lastRunAt: new Date().toISOString(),
          llmCostTotalUsd: 118.40666666, llmCostMonthUsd: 2.3749,
        },
      }));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.usage?.cost?.amount).toBe(118.41);
      expect(summary.usage?.quotas?.[0]?.used).toBe(2.37);
    });
  });

  it('moteur muet (lastRunAt > 45 min) → status degraded + alerte, données quand même servies', async () => {
    await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
      const vieux = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 h
      vi.stubGlobal('fetch', fauxFetch(200, {
        ok: true,
        etat: { reviewQueueCount: 0, filedLast7d: 3, errorsLast7d: 0, lastRunAt: vieux },
      }));
      const res = fauxRes();
      await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);

      const summary = validateSummary(JSON.parse(res.corps()));
      expect(summary.status).toBe('degraded');
      expect(summary.dataAsOf).toBe(vieux);
      expect(summary.alerts).toEqual([
        { label: 'Moteur silencieux depuis plus de 45 minutes', severity: 'warn' },
      ]);
    });
  });
});

describe('/api/hub/summary — panne du canal moteur (échec fermé)', () => {
  const CAS: [string, () => typeof fetch][] = [
    ['HTTP 404 transitoire', () => fauxFetch(404, {}, false)],
    ['200 mais page HTML (JSON illisible)', () => fauxFetch(200, null, false)],
    ['JSON propre ok:false (secret/config)', () => fauxFetch(200, { ok: false, erreur: 'refusé' })],
    ['compteur corrompu (chaîne)', () => fauxFetch(200, { ok: true, etat: { reviewQueueCount: 'beaucoup', filedLast7d: 1, errorsLast7d: 0, lastRunAt: new Date().toISOString() } })],
    ['lastRunAt illisible', () => fauxFetch(200, { ok: true, etat: { reviewQueueCount: 0, filedLast7d: 0, errorsLast7d: 0, lastRunAt: 'hier' } })],
  ];
  for (const [nom, fabrique] of CAS) {
    it(`${nom} → 500 « Moteur indisponible », jamais un summary partiel`, async () => {
      await avecEnv({ HUB_TOKEN: JETON, WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' }, async () => {
        vi.stubGlobal('fetch', fabrique());
        const res = fauxRes();
        await handlerHub(fauxReq({ [HUB_TOKEN_HEADER]: JETON }), res);
        expect(res.statusCode).toBe(500);
        expect(JSON.parse(res.corps())).toEqual({ status: 'error', error: 'Moteur indisponible' });
        expect(res.corps()).not.toContain('contractVersion');
      });
    });
  }
});

/**
 * Cache broker — PROTECTION DE QUOTA (pas de la performance). Le hub poll toutes les 15 s ;
 * le moteur, lui, ne recalcule le résumé qu'au plus une fois par `HUB_RESUME_INTERVALLE_MS`
 * (15 min depuis C28-34 — PAS au rythme du tick, l'erreur qui avait fixé le TTL à 60 s).
 * Sans cache suffisant, chaque poll coûte une exécution Apps Script, sur un budget DUR de
 * 90 min/jour partagé avec le tick ET le pilote CI.
 */
describe('_engineState — cache broker (quota Apps Script)', () => {
  const ENV = { WEBAPP_URL: 'https://script.example/exec', WEBAPP_SECRET: 's' };

  it('deux lectures rapprochées ne déclenchent QU’UNE exécution Apps Script', async () => {
    await avecEnv(ENV, async () => {
      const appels = fauxFetch(200, ETAT_SAIN);
      vi.stubGlobal('fetch', appels);
      const t0 = 1_000_000;
      const a = await getEngineState(() => t0);
      const b = await getEngineState(() => t0 + 15_000); // poll suivant du hub
      expect(a).toEqual(b);
      expect(appels).toHaveBeenCalledTimes(1);
    });
  });

  it('un poll une minute plus tard ne réinterroge PAS le moteur (la donnée bouge aux 15 min)', async () => {
    // Verrou de la correction du 2026-08-05 : à 60 s de TTL, ce cas déclenchait une seconde
    // exécution Apps Script pour des octets identiques. C'est ce gaspillage — 15× la cadence
    // réelle de la donnée — qui vidait le quota quotidien.
    await avecEnv(ENV, async () => {
      const appels = fauxFetch(200, ETAT_SAIN);
      vi.stubGlobal('fetch', appels);
      const t0 = 1_000_000;
      await getEngineState(() => t0);
      await getEngineState(() => t0 + 61_000);
      expect(appels).toHaveBeenCalledTimes(1);
    });
  });

  it('au-delà du TTL, le moteur est réinterrogé (la donnée ne se fige pas)', async () => {
    await avecEnv(ENV, async () => {
      const appels = fauxFetch(200, ETAT_SAIN);
      vi.stubGlobal('fetch', appels);
      const t0 = 1_000_000;
      await getEngineState(() => t0);
      await getEngineState(() => t0 + 5 * 60_000 + 1_000);
      expect(appels).toHaveBeenCalledTimes(2);
    });
  });

  it('une PANNE n’est jamais mise en cache — le prochain appel réessaie', async () => {
    await avecEnv(ENV, async () => {
      vi.stubGlobal('fetch', fauxFetch(200, { ok: false, erreur: 'refusé' }));
      const t0 = 1_000_000;
      await expect(getEngineState(() => t0)).rejects.toThrow();

      // Le moteur se rétablit : la lecture suivante doit repartir, pas resservir l'échec.
      const sain = fauxFetch(200, ETAT_SAIN);
      vi.stubGlobal('fetch', sain);
      const etat = await getEngineState(() => t0 + 1_000);
      expect(etat?.filedLast7d).toBe(14);
      expect(sain).toHaveBeenCalledTimes(1);
    });
  });
});
