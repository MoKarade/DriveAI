/**
 * api/mcp/_commun.ts — câblage partagé des endpoints MCP (ADR-0042). Préfixe `_` : jamais exposé.
 *
 * Construit le fournisseur OAuth (api/_mcpOauth.ts) à partir de l'env + l'ORIGINE de la requête
 * (issuer) — l'origine vient des en-têtes x-forwarded-* du proxy Vercel (api/_lib.ts), donc les
 * previews Vercel fonctionnent aussi (chaque déploiement est son propre issuer cohérent).
 */

import { Requete, Reponse, origine, repondreJson } from '../_lib';
import { makeOAuthProvider, lireEnvMcp, OAuthError, OAuthProvider, EnvMcp } from '../_mcpOauth';

export interface ContexteMcp {
  env: EnvMcp;
  auth: OAuthProvider;
  issuer: string;
}

// Fournisseur CACHÉ par issuer au niveau MODULE (revue code C28-53 #1). CRUCIAL : le provider
// porte l'anti-rejeu `consumedJti` (code à usage unique + rotation du refresh) dans une Map de
// closure — le reconstruire à CHAQUE requête la vidait, rendant ces deux protections INOPÉRANTES.
// Une instance Vercel tiède réutilise donc désormais le même provider (le `consumedJti` survit,
// exactement ce que l'en-tête de _mcpOauth.ts décrit). Clé = issuer : les URL de preview et de
// prod ont chacune le leur (signature et découverte cohérentes par déploiement).
var _providersParIssuer = new Map();

/** null si la config est incomplète — l'appelant répond 503 fermé. */
export function contexteMcp(req: Requete): ContexteMcp | null {
  const env = lireEnvMcp();
  if (!env) return null;
  const issuer = origine(req);
  var auth = _providersParIssuer.get(issuer);
  if (!auth) {
    auth = makeOAuthProvider({ signingKey: env.signingKey, accessKey: env.accessKey, issuer });
    _providersParIssuer.set(issuer, auth);
  }
  return { env, auth, issuer };
}

export function repondre503Ferme(res: Reponse): void {
  repondreJson(res, 503, { error: 'mcp disabled', detail: 'MCP_SIGNING_KEY / MCP_ACCESS_KEY / WEBAPP_URL / MCP_ENGINE_SECRET / WEBAPP_SECRET requis (env Vercel).' });
}

/** Corps brut d'une requête (borné : 256 Ko — un tools/call n'a aucune raison d'être plus gros). */
export function lireCorps(req: Requete): Promise<string> {
  return new Promise((resolve, reject) => {
    let taille = 0;
    let fini = false;
    const finir = (fn: () => void) => { if (!fini) { fini = true; fn(); } };
    const morceaux: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      taille += c.length;
      if (taille > 256 * 1024) { req.destroy(); finir(() => reject(new Error('corps trop volumineux'))); return; }
      morceaux.push(c);
    });
    req.on('end', () => finir(() => resolve(Buffer.concat(morceaux).toString('utf8'))));
    req.on('error', (e) => finir(() => reject(e)));
    // Connexion coupée avant `end` (revue 🟡7, garde perdue au port FinanceAI) : la promesse ne
    // doit pas rester pendante (fuite de handler) — on la rejette au `close` prématuré.
    req.on('close', () => finir(() => reject(new Error('connexion fermée avant la fin du corps'))));
  });
}

/** Réponse d'erreur OAuth uniforme (RFC 6749 §5.2). */
export function repondreErreurOAuth(res: Reponse, err: unknown): void {
  if (err instanceof OAuthError) {
    repondreJson(res, err.status, { error: err.code, error_description: err.message });
    return;
  }
  repondreJson(res, 500, { error: 'server_error', error_description: String(err instanceof Error ? err.message : err) });
}

/**
 * Appelle UNE action du moteur Apps Script (/exec) et rend le JSON. Le succès se juge au CONTENU
 * (leçon §7) : un non-JSON (page « Sorry, unable to open », HTML transitoire) est une erreur
 * explicite, jamais un faux succès. `redirect: 'follow'` : /exec répond 302 vers
 * script.googleusercontent.com — fetch bascule POST→GET sur la redirection, exactement le
 * comportement attendu (leçon curl : ne jamais verrouiller la méthode sur la chaîne).
 * @param attendreVersionMcp  true pour les actions `mcp-*` : sans champ `versionMcp` dans la
 *   réponse, la version /exec déployée ne connaît PAS l'action (piège de déploiement 4) — erreur
 *   claire plutôt qu'un « refusé » trompeur.
 */
/**
 * Nombre TOTAL de tentatives pour une action REJOUABLE. 1 = l'ancien comportement.
 *
 * ── CE QUE ÇA SOIGNE, ET CE QUE ÇA NE SOIGNE PAS ────────────────────────────────────
 *
 * Ça soigne le COUP UNIQUE : la plateforme sert une page d'écho dégradée sur un appel et
 * le JSON sur le suivant. C'est exactement ce qui a été mesuré le 14/09/2026 depuis une
 * session Claude — première tentative 404, deuxième 200 avec du non-JSON — et la leçon §7
 * du CLAUDE.md prescrit depuis toujours de « rejouer (borné) tout ce qui n'est pas un JSON
 * ok:true ». Ce fichier ne le faisait pas : il DISAIT « réessaie » à l'humain sans
 * réessayer lui-même.
 *
 * Ça ne soigne PAS une indisponibilité de plusieurs minutes — celle du 05/08 a duré six
 * minutes, et trois tentatives sur deux secondes n'y changent rien. C'est dit ici pour que
 * personne n'augmente ce nombre en espérant couvrir la seconde : il faudrait attendre des
 * minutes, ce qu'un appel MCP ne peut pas faire.
 */
const TENTATIVES_REJOUABLES = 3;

/** Attentes entre deux tentatives, en ms. Une de moins que `TENTATIVES_REJOUABLES`. */
const ATTENTES_MS = [400, 1200];

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Appelle UNE action du moteur Apps Script (/exec) et rend le JSON. Le succès se juge au CONTENU
 * (leçon §7) : un non-JSON (page « Sorry, unable to open », HTML transitoire) est une erreur
 * explicite, jamais un faux succès. `redirect: 'follow'` : /exec répond 302 vers
 * script.googleusercontent.com — fetch bascule POST→GET sur la redirection, exactement le
 * comportement attendu (leçon curl : ne jamais verrouiller la méthode sur la chaîne).
 * @param attendreVersionMcp  true pour les actions `mcp-*` : sans champ `versionMcp` dans la
 *   réponse, la version /exec déployée ne connaît PAS l'action (piège de déploiement 4) — erreur
 *   claire plutôt qu'un « refusé » trompeur.
 * @param rejouable  L'action est-elle SANS EFFET DE BORD ? Défaut `false`, et ce défaut est
 *   le garde-fou : voir le bloc ci-dessous.
 */
export async function appelerMoteur(
  env: EnvMcp, action: string, secret: string, corps: unknown, attendreVersionMcp: boolean,
  rejouable = false,
): Promise<Record<string, unknown>> {
  const url = `${env.webappUrl}?action=${encodeURIComponent(action)}&secret=${encodeURIComponent(secret)}`;
  const tentatives = rejouable ? TENTATIVES_REJOUABLES : 1;
  let dernierStatut = 0;

  for (let essai = 0; essai < tentatives; essai += 1) {
    const rep = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // requête « simple », pas de préflight (comme l'app)
      body: JSON.stringify(corps ?? {}),
      redirect: 'follow',
    });
    dernierStatut = rep.status;
    const texte = await rep.text();

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(texte) as Record<string, unknown>;
    } catch {
      // ⚠️ SEUL le non-JSON est rejoué. Un JSON valide portant `ok:false` est une RÉPONSE —
      // « refusé », « introuvable » — et la rejouer ne changerait rien tout en martelant un
      // moteur qui a déjà répondu. C'est la même discipline que la sonde du Registre, où
      // trois requêtes en une seconde ont FABRIQUÉ le refus qu'on croyait mesurer.
      if (essai < tentatives - 1) {
        await dormir(ATTENTES_MS[essai] ?? 1200);
        continue;
      }
      throw new Error(
        `moteur illisible (HTTP ${dernierStatut}) après ${tentatives} tentative(s) — `
        + 'indisponibilité Apps Script de plusieurs minutes probable (elle ne se rejoue pas '
        + 'en deux secondes), ou /exec non déployé',
      );
    }

    if (attendreVersionMcp && json.versionMcp === undefined) {
      throw new Error(json.erreur === 'refusé'
        ? 'accès moteur refusé — DriveAI_MCP_SECRET (Script Property) et MCP_ENGINE_SECRET (Vercel) divergent, ou la version /exec déployée ne connaît pas encore les actions MCP'
        : 'la version /exec déployée ne connaît pas les actions MCP — redéployer le moteur (piège 4)');
    }
    return json;
  }

  // Inatteignable : la boucle rend ou jette à la dernière itération. Présent pour que le
  // type de retour reste honnête sans `as` ni assertion non nulle.
  throw new Error(`moteur illisible (HTTP ${dernierStatut})`);
}
