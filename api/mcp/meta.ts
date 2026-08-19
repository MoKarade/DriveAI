/**
 * api/mcp/meta.ts — métadonnées de DÉCOUVERTE OAuth (ADR-0042), servies aux chemins standards
 * par les rewrites de vercel.json :
 *   /.well-known/oauth-authorization-server[...]  → /api/mcp/meta?type=as   (RFC 8414)
 *   /.well-known/oauth-protected-resource[...]    → /api/mcp/meta?type=pr   (RFC 9728)
 * C'est cette découverte (déclenchée par le WWW-Authenticate du 401 de /api/mcp) qui permet à
 * claude.ai de trouver authorize/token/register tout seul — aucune saisie manuelle.
 */

import { Requete, Reponse, parametres, repondreJson } from '../_lib';
import { contexteMcp, repondre503Ferme } from './_commun';

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const ctx = contexteMcp(req);
  if (!ctx) { repondre503Ferme(res); return; }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end();
    return;
  }
  const type = parametres(req).get('type');
  if (type === 'as') { repondreJson(res, 200, ctx.auth.authorizationServerMetadata()); return; }
  if (type === 'pr') { repondreJson(res, 200, ctx.auth.protectedResourceMetadata()); return; }
  repondreJson(res, 404, { error: 'not_found' });
}
