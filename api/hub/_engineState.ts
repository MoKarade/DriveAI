/**
 * api/hub/_engineState.ts — couche interne LUE par api/hub/summary.ts pour fabriquer le résumé
 * hub. Le préfixe `_` garantit que Vercel ne l'expose PAS comme endpoint (module partagé, jamais
 * une route). ZÉRO dépendance (api/ est dépendance-free par construction, cf. api/_lib.ts).
 *
 * PHASE 0 (aujourd'hui) : `getEngineState()` retourne `null` — le moteur Apps Script (Phase 1)
 * n'est pas encore construit. Le summary sera donc « building » : statut honnête, ZÉRO chiffre
 * inventé (règle no-fake-data). C'est la SEULE valeur possible tant que le moteur n'écrit rien.
 */

/**
 * État du moteur DriveAI exposé au hub. Interface figée pour la Phase 1+ : chaque champ correspond
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
 * Retourne l'état du moteur, ou `null` quand aucune donnée réelle n'est disponible.
 *
 * Phase 0 : TOUJOURS `null` (moteur pas encore construit → summary « building »).
 *
 * TODO Phase 1+ (NE PAS implémenter sans décision explicite — garde-fous §2.3 moindre privilège
 * & ADR-0007 vie privée) : brancher sur le Google Sheet d'état. Deux canaux serveur possibles,
 * à trancher en Phase 1 :
 *   1. une action Apps Script `doGet` JSON dédiée (comme la web app `WEBAPP_URL` déjà déployée),
 *      protégée par un secret partagé, renvoyant les 4 métadonnées ci-dessus ;
 *   2. la Sheets API côté serveur — nécessiterait un compte de service ou un refresh token
 *      serveur (aujourd'hui l'app lit la Sheet côté NAVIGATEUR avec le jeton OAuth de Marc,
 *      ADR-0007 : le serverless Vercel n'a AUCUN accès à la Sheet — c'est voulu).
 * Quand une métrique devient disponible, la brancher ici et faire passer le summary à `status:'ok'`
 * (cf. « ## Intégration Hub » dans CLAUDE.md — règle de maintenance).
 */
export function getEngineState(): EngineState | null {
  return null;
}
