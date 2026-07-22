/**
 * api/hub/_engineState.ts — couche interne LUE par api/hub/summary.ts pour fabriquer le résumé
 * hub. Le préfixe `_` garantit que Vercel ne l'expose PAS comme endpoint (module partagé, jamais
 * une route). ZÉRO dépendance (api/ est dépendance-free par construction, cf. api/_lib.ts).
 *
 * PHASE 1 (C28-27, plan architecte 2026-07-21) : Vercel est le BROKER entre le hub et le moteur.
 * `getEngineState()` interroge la web app Apps Script (`action=hub-summary`, gardée par le
 * secret partagé existant WEBAPP_SECRET — AUCUN nouveau secret) et rend les 4 métadonnées.
 * ADR-0007 respectée : 4 compteurs + 1 horodatage transitent, jamais un nom de fichier ni un
 * contenu — et le serverless n'accède toujours PAS à la Sheet (c'est le moteur qui la lit).
 *
 * Sémantique des retours (no-fake-data, échec fermé) :
 *  - `null`  → intégration moteur PAS BRANCHÉE (env absentes) ou moteur jamais passé
 *              (lastRunAt null) ⇒ le summary reste « building » (honnête, comme en Phase 0) ;
 *  - `throw` → canal branché mais EN PANNE (réseau, HTTP, JSON illisible, ok:false, champ
 *              invalide) ⇒ summary.ts répond 500 — jamais une donnée partielle ou inventée.
 */

/**
 * État du moteur DriveAI exposé au hub. Interface figée : chaque champ correspond
 * à une métrique/alerte du summary. Métadonnées seulement (ADR-0007) — jamais de contenu de doc.
 */
export interface EngineState {
  /** Taille de la file de revue (`00 · À vérifier`) — 0 en régime normal (auto-classement). */
  reviewQueueCount: number;
  /** Documents classés sur les 7 derniers jours. */
  filedLast7d: number;
  /** Erreurs de traitement sur les 7 derniers jours (quarantaines, échecs). */
  errorsLast7d: number;
  /** Dernier passage du moteur (ISO 8601) — sert d'alerte « moteur muet » côté hub. */
  lastRunAt: string;
}

/**
 * Au-delà, la web app est en panne du point de vue du hub (qui coupe lui-même à 5 s). Calé à
 * 4,8 s (marge sous les 5 s du hub) : depuis le pré-calcul au tick, la réponse elle-même est
 * instantanée — le temps résiduel est le RÉVEIL variable de la web app Apps Script (cold start),
 * qui dépassait ponctuellement 4 s → 500 par intermittence (constaté en prod). 4,8 s l'absorbe.
 */
const TIMEOUT_MS = 4800;

/** Entier de compteur valide (fini, ≥ 0) — tout le reste est une réponse corrompue. */
function compteurValide(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/**
 * Interroge le moteur via la web app. POST vers `/exec` : Apps Script répond par une
 * redirection 302 vers script.googleusercontent.com — le `fetch` Node la suit en basculant
 * POST→GET (downgrade RFC normal ; c'est `curl -X POST -L` qui casse, cf. leçon CLAUDE.md §7).
 * Leçon « /exec : le succès se juge au CONTENU, jamais au code HTTP » : les pannes transitoires
 * ont deux signatures (non-200, OU 200 avec une page HTML à la place du JSON) — tout ce qui
 * n'est pas un JSON `ok:true` aux champs valides est traité en PANNE (throw).
 */
export async function getEngineState(): Promise<EngineState | null> {
  const url = (process.env.WEBAPP_URL ?? '').trim();
  const secret = (process.env.WEBAPP_SECRET ?? '').trim();
  if (!url || !secret) return null; // intégration moteur pas branchée → « building » honnête

  const rep = await fetch(url + '?action=hub-summary&secret=' + encodeURIComponent(secret), {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!rep.ok) throw new Error('web app HTTP ' + rep.status);

  let brut: unknown;
  try {
    brut = await rep.json();
  } catch {
    throw new Error('web app : réponse non-JSON (page transitoire Apps Script)');
  }

  const d = brut as { ok?: unknown; erreur?: unknown; etat?: Record<string, unknown> };
  if (d.ok !== true) throw new Error('web app : ' + String(d.erreur ?? 'réponse sans ok:true'));

  const etat = d.etat ?? {};
  const reviewQueueCount = compteurValide(etat.reviewQueueCount);
  const filedLast7d = compteurValide(etat.filedLast7d);
  const errorsLast7d = compteurValide(etat.errorsLast7d);
  if (reviewQueueCount === null || filedLast7d === null || errorsLast7d === null) {
    throw new Error('web app : compteurs manquants ou invalides');
  }

  // Moteur jamais passé (première installation) : aucune donnée réelle → « building » honnête.
  if (etat.lastRunAt === null || etat.lastRunAt === undefined) return null;
  const lastRunAt = String(etat.lastRunAt);
  if (Number.isNaN(Date.parse(lastRunAt))) throw new Error('web app : lastRunAt illisible');

  return { reviewQueueCount, filedLast7d, errorsLast7d, lastRunAt };
}
