/**
 * api/logout.ts — déconnexion : détruit le cookie de refresh token (C28-14).
 * Le jeton d'accès côté client est purgé par l'app (seDeconnecter) — après ça, plus
 * aucune trace de session ni côté navigateur ni côté cookie.
 */

import { Requete, Reponse, COOKIE_RT, effacerCookie, repondreJson } from './_lib';

export default function handler(req: Requete, res: Reponse): void {
  effacerCookie(res, req, COOKIE_RT);
  repondreJson(res, 200, { ok: true });
}
