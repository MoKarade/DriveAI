/**
 * api/config.ts — délivre la configuration de l'app à une session VALIDE (C28-20, ADR-0021).
 * « Zéro configuration client » : l'ID de la Sheet, l'URL et le secret de la web app vivent
 * dans les variables d'environnement Vercel — Marc ne saisit plus rien, il se connecte.
 *
 * Preuve de session = le cookie `driveai_rt` DÉCHIFFRABLE (posé par /api/callback APRÈS le
 * verrou ALLOWED_EMAIL — seul le compte de Marc peut l'obtenir). Sans elle : 401, jamais de
 * config — le secret de la web app ne sort pas vers un visiteur anonyme.
 */

import {
  Requete,
  Reponse,
  COOKIE_RT,
  lireEnv,
  lireCookies,
  dechiffrer,
  repondreJson,
} from './_lib';

export default function handler(req: Requete, res: Reponse): void {
  const env = lireEnv();
  if (!env) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (variables Vercel).' });
    return;
  }

  // Session D'ABORD : un visiteur anonyme reçoit 401 sans rien apprendre — pas même si les
  // variables serveur sont complètes (le 500 ci-dessous n'est visible qu'authentifié).
  const cookie = lireCookies(req)[COOKIE_RT];
  const session = cookie ? dechiffrer(cookie, env.cookieSecret) : null;
  if (!session) {
    repondreJson(res, 401, { erreur: 'Aucune session' });
    return;
  }

  const spreadsheetId = process.env.SPREADSHEET_ID ?? '';
  const webappUrl = process.env.WEBAPP_URL ?? '';
  const webappSecret = process.env.WEBAPP_SECRET ?? '';
  if (!spreadsheetId || !webappUrl || !webappSecret) {
    repondreJson(res, 500, {
      erreur: 'Configuration serveur incomplète : SPREADSHEET_ID / WEBAPP_URL / WEBAPP_SECRET (variables d\'environnement Vercel).',
    });
    return;
  }

  repondreJson(res, 200, { spreadsheetId, webappUrl, webappSecret });
}
