/**
 * api/mcp/register.ts — POST /api/mcp/register : enregistrement dynamique de client (RFC 7591,
 * ADR-0042). SANS stockage : le client_secret est DÉRIVÉ (HMAC du client_id) — cf. _mcpOauth.ts.
 * Les redirect_uris sont validées contre l'allowlist (claude.ai/claude.com + loopback) ICI,
 * puis RE-liées cryptographiquement au code à l'autorisation.
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
  let corps: { redirect_uris?: unknown };
  try {
    corps = JSON.parse(await lireCorps(req)) as { redirect_uris?: unknown };
  } catch {
    repondreJson(res, 400, { error: 'invalid_client_metadata' });
    return;
  }
  const uris = Array.isArray(corps.redirect_uris) ? corps.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  try {
    repondreJson(res, 201, ctx.auth.registerClient(uris));
  } catch (err) {
    repondreErreurOAuth(res, err);
  }
}
