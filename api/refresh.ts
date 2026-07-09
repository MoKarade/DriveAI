/**
 * api/refresh.ts — délivre un access token FRAIS depuis le refresh token du cookie (C28-14).
 * Appelé par l'app au chargement (restauration de session) et sur 401 (rejeu silencieux).
 * Un cookie absent/corrompu/révoqué → 401 + cookie purgé : l'app rebascule sur l'écran de
 * connexion — jamais de demi-état.
 */

import {
  Requete,
  Reponse,
  COOKIE_RT,
  lireEnv,
  lireCookies,
  effacerCookie,
  dechiffrer,
  rafraichirAccessToken,
  repondreJson,
} from './_lib';

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const env = lireEnv();
  if (!env) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (variables Vercel).' });
    return;
  }

  const cookie = lireCookies(req)[COOKIE_RT];
  if (!cookie) {
    repondreJson(res, 401, { erreur: 'Aucune session' });
    return;
  }

  const refreshToken = dechiffrer(cookie, env.cookieSecret);
  if (!refreshToken) {
    // Cookie forgé ou COOKIE_SECRET changé : purge et reconnexion propre.
    effacerCookie(res, req, COOKIE_RT);
    repondreJson(res, 401, { erreur: 'Session illisible — reconnexion nécessaire' });
    return;
  }

  const jetons = await rafraichirAccessToken(env, refreshToken);
  if (!jetons.access_token) {
    // `invalid_grant` = refresh token révoqué/expiré côté Google : la session est morte.
    effacerCookie(res, req, COOKIE_RT);
    repondreJson(res, 401, { erreur: jetons.error ?? 'Session révoquée — reconnexion nécessaire' });
    return;
  }

  repondreJson(res, 200, { token: jetons.access_token, expireDansS: jetons.expires_in ?? 3600 });
}
