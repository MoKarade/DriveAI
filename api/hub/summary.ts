/**
 * api/hub/summary.ts — GET /api/hub/summary : résumé DriveAI pour le hub perso
 * (hubperso.com → widget DriveAI). Contrat @mokarade/hub-contract v1.
 *
 * Le hub appelle ce endpoint avec le header `x-hub-token`. Échec fermé (§2) :
 *   - HUB_TOKEN non défini côté serveur → 503 { error: "hub disabled" } (intégration désactivée) ;
 *   - jeton absent/faux → 401 { error: "unauthorized" } (comparaison en TEMPS CONSTANT) ;
 *   - méthode ≠ GET → 405.
 * Réponse toujours `Cache-Control: no-store` (via repondreJson) : un summary est un instantané.
 *
 * ZÉRO dépendance npm, par CONSTRUCTION (cf. api/_lib.ts : le projet Vercel est enraciné au dépôt,
 * `installCommand:"true"` → aucun node_modules à la racine). La forme du contrat v1 est donc
 * INLINÉE ici, et VERROUILLÉE par le VRAI schéma `@mokarade/hub-contract` (`validateSummary()` +
 * `buildingSummary()`) dans app/test/hub-summary.test.ts (devDependency de app/ uniquement).
 *
 * HONNÊTETÉ (no-fake-data) : les données réelles vivent dans la Google Sheet d'état, lue côté
 * NAVIGATEUR avec le jeton OAuth de Marc (ADR-0007) — le serverless Vercel n'y a AUCUN accès.
 * Tant que `getEngineState()` renvoie `null` (Phase 0), ce endpoint publie un summary « building » :
 * statut honnête, zéro chiffre inventé. Le branchement Phase 1 se fait dans _engineState.ts.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Requete, Reponse, repondreJson } from '../_lib';
import { getEngineState, EngineState } from './_engineState';

/** Version du contrat hub (= CONTRACT_VERSION du package). Bump = rupture → nouveau tag + re-pin. */
const CONTRACT_VERSION = 1;
/** Header du jeton hub (= HUB_TOKEN_HEADER du package — inliné, api/ zéro-dep). */
const HUB_TOKEN_HEADER = 'x-hub-token';
/** URL canonique de DriveAI (décision Marc 2026-07-15 : sous-domaine du hub perso). */
const URL_APP = 'https://drive.hubperso.com';
/** Couleur d'accent du widget (hex 6 digits) — accent de l'app (styles.css `--accent`, v5 Material Dark). */
const COULEUR = '#8ab4f8';
/** Moteur « muet » au-delà de 45 min sans tick (déclencheur à 30 min + marge) → status degraded. */
const SEUIL_MUET_MS = 45 * 60 * 1000;

/**
 * Comparaison de jetons en TEMPS CONSTANT, insensible aux longueurs différentes : on compare les
 * digests SHA-256 (toujours 32 octets → `timingSafeEqual` ne lève pas et la longueur du secret ne
 * fuit pas). Un `x-hub-token` absent / non-chaîne / vide échoue avant tout calcul.
 */
function jetonValide(fourni: string | string[] | undefined, attendu: string): boolean {
  if (typeof fourni !== 'string' || fourni.length === 0) return false;
  const a = createHash('sha256').update(fourni).digest();
  const b = createHash('sha256').update(attendu).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  if (req.method !== 'GET') {
    repondreJson(res, 405, { error: 'method not allowed' });
    return;
  }

  const attendu = process.env.HUB_TOKEN ?? '';
  if (!attendu) {
    // Intégration hub non configurée (variable d'environnement Vercel absente) — échec fermé,
    // jamais de summary : le hub affiche « désactivée » plutôt qu'un endpoint ouvert.
    repondreJson(res, 503, { error: 'hub disabled' });
    return;
  }

  if (!jetonValide(req.headers[HUB_TOKEN_HEADER], attendu)) {
    repondreJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const app = { id: 'driveai', name: 'DriveAI', url: URL_APP, color: COULEUR };

  // getEngineState() est le POINT DE BASCULE Phase 0 → Phase 1 (C28-27 : branché). `null` =
  // pas de données réelles (intégration pas configurée, ou moteur jamais passé) → « building »
  // honnête, identique à la Phase 0. Une PANNE du canal (throw) → 500, jamais une donnée
  // partielle ni inventée (échec fermé — plan architecte 2026-07-21).
  let etat: EngineState | null;
  try {
    etat = await getEngineState();
  } catch (err) {
    // Cause loggée pour le diagnostic (logs Vercel) — le hub, lui, ne reçoit qu'un 500 opaque
    // et l'erreur ne porte jamais de secret (messages construits dans _engineState.ts).
    console.error('[hub-summary] canal moteur en panne :', err instanceof Error ? err.message : String(err));
    repondreJson(res, 500, { status: 'error', error: 'Moteur indisponible' });
    return;
  }

  if (etat === null) {
    // Équivalent EXACT de buildingSummary(app, { alertLabel }) du contrat (verrouillé par le
    // test), enrichi de l'action « Ouvrir DriveAI ». Aucune métrique inventée.
    repondreJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      app,
      generatedAt: new Date().toISOString(),
      status: 'building',
      metrics: [],
      alerts: [{ label: 'Moteur en Phase 0 — classement pas encore actif', severity: 'info' }],
      actions: [{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }],
    });
    return;
  }

  // Données réelles : 3 compteurs en métriques, lastRunAt en dataAsOf. « degraded » si le
  // moteur est muet depuis plus de SEUIL_MUET_MS (déclencheur 30 min + marge). Les alertes ne
  // disent que ce qui est vrai : rien à signaler = aucune alerte.
  const muet = Date.now() - Date.parse(etat.lastRunAt) > SEUIL_MUET_MS;
  const alerts: { label: string; severity: 'info' | 'warn' }[] = [];
  if (muet) alerts.push({ label: 'Moteur silencieux depuis plus de 45 minutes', severity: 'warn' });
  if (etat.errorsLast7d > 0) {
    alerts.push({ label: etat.errorsLast7d + ' erreur(s) de traitement sur 7 jours', severity: 'warn' });
  }
  if (etat.reviewQueueCount > 0) {
    alerts.push({ label: etat.reviewQueueCount + ' document(s) en attente dans la file de revue', severity: 'info' });
  }

  // Bloc `usage` (coûts & quotas du hub) — additif v1.1, uniquement les champs réellement
  // publiés par le moteur (absents tant qu'il n'a pas été redéployé → bloc partiel ou omis).
  const quotas: { label: string; used: number; limit: number | null; unit?: string }[] = [];
  if (typeof etat.gmailThreadsToday === 'number') {
    quotas.push({ label: 'Fils Gmail (aujourd’hui)', used: etat.gmailThreadsToday, limit: null, unit: 'fils' });
  }
  if (etat.gmailQuotaSuspended) {
    // Quota Gmail Apps Script épuisé (pause automatique) : représenté « au plafond ».
    quotas.push({ label: 'Quota Gmail', used: 1, limit: 1 });
  }
  // COÛT PUBLIÉ = LE CUMUL, pas le mois. Le hub somme les coûts PAR PÉRIODE et refuse de
  // fusionner « cumulé » avec « ce mois-ci » — additionner les deux donnerait un montant qui
  // n'existe pas. Tant que DriveAI ne publiait que son mois courant, il était donc seul dans sa
  // colonne et le hub ne pouvait afficher aucun total unique (FinanceAI et BatchChef publient un
  // cumul). En publiant `total`, DriveAI rejoint la colonne des autres.
  //
  // Le mois n'est pas perdu, il change de place : il devient un QUOTA avec le seuil du frein des
  // campagnes pour plafond — ce qui est plus juste qu'un « coût du mois » nu, puisque le nombre
  // qui compte est sa DISTANCE au frein, pas sa valeur absolue.
  //
  // REPLI sur `mois` si le cumul est absent : la web app Apps Script peut être en retard d'un
  // déploiement (champ additif). Un repli déclaré `total` afficherait le mois courant sous
  // l'étiquette « cumulé » — un chiffre juste sous une étiquette fausse, donc un mensonge.
  const usage: {
    cost?: { amount: number; currency: 'USD'; period: 'total' | 'mois' };
    quotas?: typeof quotas;
  } = {};
  const cents = (v: number) => Math.round(v * 100) / 100;
  if (typeof etat.llmCostTotalUsd === 'number') {
    usage.cost = { amount: cents(etat.llmCostTotalUsd), currency: 'USD', period: 'total' };
    if (typeof etat.llmCostMonthUsd === 'number') {
      quotas.push({
        label: 'Coût LLM du mois (frein campagnes)',
        used: cents(etat.llmCostMonthUsd),
        // Plafond publié par le moteur (CONFIG.LLM_BUDGET_CAMPAGNES), jamais recopié ici : Marc
        // le rajuste en éditant Config.gs. `null` si le moteur ne l'a pas envoyé — une jauge sans
        // plafond, jamais un plafond inventé.
        limit: typeof etat.llmBudgetCampagnesUsd === 'number' ? etat.llmBudgetCampagnesUsd : null,
        unit: 'USD',
      });
    }
  } else if (typeof etat.llmCostMonthUsd === 'number') {
    usage.cost = { amount: cents(etat.llmCostMonthUsd), currency: 'USD', period: 'mois' };
  }
  if (quotas.length > 0) usage.quotas = quotas;

  repondreJson(res, 200, {
    contractVersion: CONTRACT_VERSION,
    app,
    generatedAt: new Date().toISOString(),
    dataAsOf: etat.lastRunAt,
    status: muet ? 'degraded' : 'ok',
    metrics: [
      { label: 'Classés (7 jours)', value: etat.filedLast7d, format: 'number' },
      { label: 'File de revue', value: etat.reviewQueueCount, format: 'number' },
      { label: 'Erreurs (7 jours)', value: etat.errorsLast7d, format: 'number' },
    ],
    alerts,
    actions: [{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }],
    ...(usage.cost || usage.quotas ? { usage } : {}),
  });
}
