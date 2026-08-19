/**
 * api/mcp/token.ts — POST /api/mcp/token : échange code→jetons et rafraîchissement (ADR-0042).
 * Corps `application/x-www-form-urlencoded` (RFC 6749). Toute la logique vit dans le fournisseur
 * PUR (api/_mcpOauth.ts) : ici, uniquement le mapping formulaire → appels.
 */

import { Requete, Reponse, repondreJson } from '../_lib';
import { contexteMcp, repondre503Ferme, lireCorps, repondreErreurOAuth } from './_commun';

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const ctx = contexteMcp(req);
  if (!ctx) { repondre503Ferme(res); return; }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    res.end();
    return;
  }
  let form: Record<string, string>;
  try {
    form = Object.fromEntries(new URLSearchParams(await lireCorps(req)));
  } catch {
    repondreJson(res, 400, { error: 'invalid_request' });
    return;
  }
  try {
    if (form.grant_type === 'authorization_code') {
      repondreJson(res, 200, ctx.auth.exchangeCode({
        code: form.code ?? '', clientId: form.client_id ?? '',
        clientSecret: form.client_secret, redirectUri: form.redirect_uri ?? '',
        codeVerifier: form.code_verifier ?? '',
      }));
    } else if (form.grant_type === 'refresh_token') {
      repondreJson(res, 200, ctx.auth.refreshGrant({
        refreshToken: form.refresh_token ?? '', clientId: form.client_id ?? '',
        clientSecret: form.client_secret,
      }));
    } else {
      repondreJson(res, 400, { error: 'unsupported_grant_type', error_description: 'authorization_code ou refresh_token.' });
    }
  } catch (err) {
    repondreErreurOAuth(res, err);
  }
}
