/**
 * api/hub-summary.ts — résumé pour le hub perso (hubperso.com), contrat hub-contract v1 (HUB-01).
 *
 * Le hub appelle GET /hub/summary (réécrit vers /api/hub-summary, cf. vercel.json) avec le
 * header `x-hub-token` ; toute requête sans jeton valide reçoit 401 — échec fermé (§2), la
 * comparaison est en temps constant. Réponse toujours en `Cache-Control: no-store` (via
 * repondreJson) : un summary est un instantané, jamais mis en cache.
 *
 * ZÉRO dépendance, par CONSTRUCTION (cf. api/_lib.ts) : la forme du contrat
 * @mokarade/hub-contract v1 est INLINÉE ici — et VERROUILLÉE par le vrai schéma du paquet
 * dans app/test/hub-summary.test.ts (devDependency de app/ uniquement, jamais de api/).
 *
 * HONNÊTETÉ (no-fake-data) : les données réelles de DriveAI (Sheet d'état) sont lues par le
 * NAVIGATEUR avec le jeton OAuth de Marc (ADR-0007) — le serverless Vercel n'y a pas accès.
 * Tant qu'aucun canal serveur n'existe (action Apps Script dédiée + redéploiement manuel),
 * ce endpoint publie un summary « building » : statut honnête, zéro chiffre inventé.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Requete, Reponse, origine, repondreJson } from './_lib';

/** Version du contrat hub — évolue uniquement en suivant hub-contract (breaking = nouveau tag). */
const CONTRACT_VERSION = 1;
/** Repli si l'origine publique est indisponible (hors proxy Vercel). */
const URL_APP_DEFAUT = 'https://driveai-ivory.vercel.app';

/** Comparaison en temps constant via digests de longueur fixe (timingSafeEqual exige des
 * buffers de même taille — la longueur du secret ne doit pas fuiter). */
function jetonValide(fourni: string | string[] | undefined, attendu: string): boolean {
  if (typeof fourni !== 'string' || fourni.length === 0) return false;
  const a = createHash('sha256').update(fourni).digest();
  const b = createHash('sha256').update(attendu).digest();
  return timingSafeEqual(a, b);
}

export default function handler(req: Requete, res: Reponse): void {
  if (req.method !== 'GET') {
    repondreJson(res, 405, { erreur: 'GET uniquement' });
    return;
  }

  const attendu = process.env.HUB_TOKEN ?? '';
  if (!attendu) {
    repondreJson(res, 500, {
      erreur: 'Configuration serveur incomplète : HUB_TOKEN (variable d\'environnement Vercel).',
    });
    return;
  }

  if (!jetonValide(req.headers['x-hub-token'], attendu)) {
    repondreJson(res, 401, { erreur: 'Jeton hub absent ou invalide' });
    return;
  }

  // L'URL publiée suit l'origine réelle de la requête : elle restera juste quand le
  // domaine passera de driveai-ivory.vercel.app à drive.hubperso.com, sans re-déploiement.
  let url = URL_APP_DEFAUT;
  try {
    url = new URL(origine(req)).origin;
  } catch {
    /* origine indisponible (hors proxy Vercel) → repli statique */
  }

  // Équivalent exact de buildingSummary(...) du contrat : summary minimal honnête.
  repondreJson(res, 200, {
    contractVersion: CONTRACT_VERSION,
    app: { id: 'driveai', name: 'DriveAI', url, color: '#2563eb' },
    generatedAt: new Date().toISOString(),
    status: 'building',
    metrics: [],
    alerts: [{
      label: 'Intégration hub en construction — données pas encore exposées côté serveur',
      severity: 'info',
    }],
    actions: [],
  });
}
