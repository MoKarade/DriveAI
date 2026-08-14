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
  lireSession,
  rafraichirAccessToken,
  repondreJson,
} from './_lib';
import { aLeDroitDEntrer } from './_accesHub';

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

  const clair = dechiffrer(cookie, env.cookieSecret);
  const session = clair ? lireSession(clair) : null;
  if (!session) {
    // Cookie forgé, COOKIE_SECRET changé, ou session à l'ANCIEN format (sans adresse : on ne
    // saurait pas à qui elle appartient, donc on ne peut pas la revérifier). Purge et
    // reconnexion propre — le prix est un seul aller-retour, une seule fois.
    effacerCookie(res, req, COOKIE_RT);
    repondreJson(res, 401, { erreur: 'Session illisible — reconnexion nécessaire' });
    return;
  }

  // Revérification à chaque appel : cet endpoint délivre un jeton d'accès Google frais, avec
  // Drive et Sheets au bout. Un accès retiré doit s'arrêter là, pas à l'expiration du cookie.
  if (!(await aLeDroitDEntrer(session.email))) {
    effacerCookie(res, req, COOKIE_RT);
    repondreJson(res, 403, { erreur: 'Accès retiré pour ce compte' });
    return;
  }

  const jetons = await rafraichirAccessToken(env, session.rt);
  if (!jetons.access_token) {
    // `invalid_grant` = refresh token révoqué/expiré côté Google : la session est morte.
    effacerCookie(res, req, COOKIE_RT);
    repondreJson(res, 401, { erreur: jetons.error ?? 'Session révoquée — reconnexion nécessaire' });
    return;
  }

  repondreJson(res, 200, { token: jetons.access_token, expireDansS: jetons.expires_in ?? 3600 });
}
