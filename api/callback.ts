/**
 * api/callback.ts — retour du consentement Google (session durable, C28-14).
 * Vérifie le `state` anti-CSRF, échange le code contre les jetons, CHIFFRE le refresh token
 * dans le cookie HttpOnly `driveai_rt` (1 an, SameSite=Strict), puis redirige vers l'app.
 * L'access token n'est JAMAIS passé dans l'URL (historique navigateur) : l'app le récupère
 * proprement via /api/refresh au chargement.
 */

import {
  Requete,
  Reponse,
  COOKIE_ETAT,
  lireEnv,
  origine,
  parametres,
  lireCookies,
  effacerCookie,
  poserCookieRefresh,
  chiffrer,
  echangerCode,
  rediriger,
} from './_lib';

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const env = lireEnv();
  if (!env) { rediriger(res, '/?auth=config'); return; }

  const params = parametres(req);
  const code = params.get('code');
  const etat = params.get('state');
  const etatAttendu = lireCookies(req)[COOKIE_ETAT];
  effacerCookie(res, req, COOKIE_ETAT); // usage unique, succès ou échec

  // state absent/différent = requête forgée (CSRF) ou consentement périmé → retour à l'écran
  // de connexion, échec FERMÉ (jamais d'échange de code sans preuve d'origine).
  if (!code || !etat || !etatAttendu || etat !== etatAttendu) {
    rediriger(res, '/?auth=echec');
    return;
  }

  const jetons = await echangerCode(env, code, `${origine(req)}/api/callback`);
  if (!jetons.refresh_token) {
    // Pas de refresh token (erreur d'échange, ou consentement partiel) : sans lui la session
    // durable n'existe pas — on repart au login plutôt que de poser une demi-session.
    rediriger(res, '/?auth=echec');
    return;
  }

  poserCookieRefresh(res, req, chiffrer(jetons.refresh_token, env.cookieSecret));
  rediriger(res, '/');
}
