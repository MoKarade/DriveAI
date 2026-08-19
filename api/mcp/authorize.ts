/**
 * api/mcp/authorize.ts — GET/POST /api/mcp/authorize : la page d'autorisation du connecteur
 * (ADR-0042). GET : formulaire de CLÉ D'ACCÈS (paramètres OAuth validés puis rejoués en champs
 * cachés, échappés). POST : vérifie la clé (comparaison constante, LIMITEUR d'échecs global —
 * cf. api/_mcpOauth.ts) puis 302 vers claude.ai avec le code signé (+ state rejoué tel quel).
 *
 * ⚠️ Le limiteur (module-level, mémoire d'instance) est un FILET FAIBLE sur Vercel — voir
 * l'énoncé honnête dans api/_mcpOauth.ts : il ne voit PAS une attaque PARALLÈLE (scaling
 * horizontal). La VRAIE défense anti-brute-force est l'ENTROPIE de `MCP_ACCESS_KEY` (aléatoire,
 * imposée par docs/MCP.md). Ici le limiteur sert surtout à TRACER (console.error → runbook de
 * rotation de `MCP_SIGNING_KEY`) et à freiner un pilonnage sériel.
 */

import { Requete, Reponse, parametres, repondreJson } from '../_lib';
import { OAuthError, makeAttemptLimiter } from '../_mcpOauth';
import { contexteMcp, repondre503Ferme, lireCorps, repondreErreurOAuth } from './_commun';

const limiteur = makeAttemptLimiter();

function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function pageFormulaire(q: Record<string, string>, erreur?: string): string {
  const caches = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type']
    .map((k) => `<input type="hidden" name="${k}" value="${echapperHtml(q[k] ?? '')}">`).join('\n');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>DriveAI — autorisation MCP</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#1c1c1e;padding:2rem;border-radius:12px;max-width:22rem;width:90%}
h1{font-size:1.1rem;margin:0 0 .5rem}p{color:#aaa;font-size:.85rem}
input[type=password]{width:100%;box-sizing:border-box;padding:.6rem;margin:.8rem 0;border-radius:8px;border:1px solid #444;background:#111;color:#eee}
button{width:100%;padding:.6rem;border:none;border-radius:8px;background:#8ab4f8;color:#111;font-weight:600;cursor:pointer}
.err{color:#f28b82;font-size:.85rem}</style></head><body>
<form method="POST" action="/api/mcp/authorize">
<h1>DriveAI — connecteur Claude</h1>
<p>Saisis ta clé d'accès pour autoriser Claude à interroger DriveAI (documents, moteur, intentions).</p>
${erreur ? `<p class="err">${echapperHtml(erreur)}</p>` : ''}
${caches}
<input type="password" name="access_key" placeholder="Clé d'accès (MCP_ACCESS_KEY)" autofocus autocomplete="current-password">
<button type="submit">Autoriser</button></form></body></html>`;
}

function repondreHtml(res: Reponse, code: number, html: string, entetes?: Record<string, string>): void {
  res.statusCode = code;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(entetes ?? {})) res.setHeader(k, v);
  res.end(html);
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  const ctx = contexteMcp(req);
  if (!ctx) { repondre503Ferme(res); return; }

  if (req.method === 'GET') {
    const q = Object.fromEntries(parametres(req));
    try {
      ctx.auth.validateAuthorizeRequest(q);
    } catch (err) {
      repondreErreurOAuth(res, err);
      return;
    }
    repondreHtml(res, 200, pageFormulaire(q));
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
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
    ctx.auth.validateAuthorizeRequest(form);
  } catch (err) {
    repondreErreurOAuth(res, err);
    return;
  }

  // Plafond AVANT toute comparaison de clé : la clé d'accès est la seule porte devinable.
  if (limiteur.isBlocked()) {
    const attente = limiteur.retryAfterSeconds();
    console.error(`[DriveAI MCP] /api/mcp/authorize BLOQUÉ : quota d'échecs épuisé, réessai dans ${attente} s. ` +
      'Si ce n\'est pas toi → rotation de MCP_SIGNING_KEY (docs/MCP.md).');
    repondreHtml(res, 429, pageFormulaire(form, `Trop de tentatives. Réessaie dans ${Math.ceil(attente / 60)} minute(s).`),
      { 'Retry-After': String(attente) });
    return;
  }

  let code: string;
  try {
    code = ctx.auth.authorize({
      clientId: form.client_id, redirectUri: form.redirect_uri,
      codeChallenge: form.code_challenge, accessKey: form.access_key ?? '',
    });
  } catch (err) {
    if (err instanceof OAuthError && err.code === 'access_denied') {
      limiteur.recordFailure();
      // Tracé À CHAQUE échec : un pilonnage se voit à la répétition, pas seulement au blocage.
      console.error('[DriveAI MCP] /api/mcp/authorize : clé d\'accès REFUSÉE.');
      repondreHtml(res, 403, pageFormulaire(form, 'Clé d\'accès invalide — réessaie.'));
      return;
    }
    repondreErreurOAuth(res, err);
    return;
  }

  // Succès : l'historique d'échecs est effacé — l'usage légitime ne consomme aucun quota.
  limiteur.reset();
  const cible = new URL(form.redirect_uri);
  cible.searchParams.set('code', code);
  if (form.state) cible.searchParams.set('state', form.state);
  res.statusCode = 302;
  res.setHeader('Location', cible.toString());
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
