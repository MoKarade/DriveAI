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
  lireSession,
  repondreJson,
} from './_lib';
import { aLeDroitDEntrer } from './_accesHub';

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const env = lireEnv();
  if (!env) {
    repondreJson(res, 500, { erreur: 'Configuration serveur incomplète (variables Vercel).' });
    return;
  }

  // Session D'ABORD : un visiteur anonyme reçoit 401 sans rien apprendre — pas même si les
  // variables serveur sont complètes (le 500 ci-dessous n'est visible qu'authentifié).
  const cookie = lireCookies(req)[COOKIE_RT];
  const clair = cookie ? dechiffrer(cookie, env.cookieSecret) : null;
  const session = clair ? lireSession(clair) : null;
  if (!session) {
    repondreJson(res, 401, { erreur: 'Aucune session' });
    return;
  }

  // REVÉRIFICATION À CHAQUE APPEL, et pas seulement à la connexion. C'est cet endpoint qui
  // délivre WEBAPP_SECRET — la clé qui permet de déplacer des documents, de déclencher l'OCR
  // et de faire écrire au LLM aux frais de Marc. Un accès retiré depuis l'administration du
  // hub doit cesser de l'ouvrir en moins d'une minute, pas au bout de l'année du cookie.
  if (!(await aLeDroitDEntrer(session.email))) {
    repondreJson(res, 403, { erreur: 'Accès retiré pour ce compte' });
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
