/**
 * api/_accesHub.ts — « cette adresse a-t-elle le droit d'entrer ici ? », posée au hub.
 *
 * ── CE QUE ÇA REMPLACE, ET POURQUOI ────────────────────────────────────────────────
 *
 * `ALLOWED_EMAIL` : UNE adresse, en dur dans une variable Vercel. Pour inviter quelqu'un il
 * fallait éditer un tableau de bord ; pour le retirer, se souvenir de l'avoir fait. C'est
 * précisément ce que l'ADR 0001 de Hubperso a entrepris de supprimer — la liste vit
 * désormais dans le hub (table `acces`), et se gère depuis sa page d'administration.
 *
 * DriveAI est la QUATRIÈME app à basculer, après JobAI, CarAI et BatchChef. Le module y est
 * volontairement le même à la virgule près, à une différence de forme : ici, ZÉRO dépendance
 * npm (vercel.json : installCommand "true"), donc `fetch` global et rien d'autre.
 *
 * ── CE QUE ÇA NE FAIT PAS ───────────────────────────────────────────────────────────
 *
 * Ça ne touche pas au moteur Apps Script. Lui s'authentifie auprès de Google par
 * `ScriptApp.getOAuthToken()`, au niveau du projet Apps Script : il ne détient aucun jeton,
 * n'a pas de navigateur, et tourne toutes les 5 minutes sans personne. Le hub n'a aucune
 * prise dessus, et prétendre le contraire serait faux.
 *
 * ── ÉCHEC FERMÉ ─────────────────────────────────────────────────────────────────────
 *
 * Hub injoignable, jeton absent, réponse inattendue : `false`. Le hub devient un point de
 * panne unique pour l'entrée dans DriveAI — assumé dans l'ADR. Le PROPRIÉTAIRE, lui, garde
 * un chemin sans réseau (`ALLOWED_EMAIL`, vérifié AVANT ce module) : une panne du hub ne
 * doit jamais enfermer Marc dehors de sa propre app.
 */

/** Le hub. Surchargeable pour un déploiement de test, jamais écrit en dur ailleurs. */
const URL_HUB = (process.env.HUB_URL ?? '').trim() || 'https://hubperso.com';

const ENTETE_JETON = 'x-hub-token';

/** Durée de vie d'une réponse POSITIVE mémorisée. */
export const CACHE_ACCES_MS = 60_000;

/**
 * Réponses positives mémorisées, et jusqu'à quand.
 *
 * ⚠️ PORTÉE RÉELLE, dite plutôt que supposée : la mémoire d'UNE instance de fonction
 * serverless. `/api/config` et `/api/refresh` sont deux lambdas distinctes qui ne la
 * partagent pas, et un démarrage à froid la vide. Elle évite les appels répétés d'une même
 * instance chaude, pas davantage — ce qui suffit, l'appel au hub étant bref.
 *
 * POSITIFS SEULEMENT : mémoriser un refus ferait attendre jusqu'à une minute à quelqu'un
 * qu'on vient d'ajouter dans l'administration du hub, précisément au moment où l'on regarde
 * si ça marche. Mémoriser un accord fait durer un accès retiré au plus une minute — c'est le
 * délai annoncé pour les révocations dans tout l'écosystème.
 */
const cache = new Map<string, number>();

/** Pour les tests, et pour rendre le cache observable plutôt que magique. */
export function viderCacheAcces(): void {
  cache.clear();
}

function normaliser(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** La seule partie qui touche le réseau — extraite pour être remplaçable en test. */
async function demanderAuHub(adresse: string, jeton: string): Promise<boolean> {
  const reponse = await fetch(`${URL_HUB.replace(/\/+$/, '')}/api/acces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [ENTETE_JETON]: jeton },
    body: JSON.stringify({ email: adresse }),
    signal: AbortSignal.timeout(8000),
  });
  if (!reponse.ok) return false;
  const corps = (await reponse.json()) as { acces?: unknown };
  return corps?.acces === true;
}

/**
 * Cette adresse a-t-elle accès à DriveAI, d'après le hub ?
 *
 * `env`, `maintenantMs` et `interroger` sont injectables pour les tests — ni variable
 * d'environnement réelle, ni requête réseau réelle, à fournir pour éprouver le cache et
 * l'échec fermé.
 */
export async function aAccesHub(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  maintenantMs: number = Date.now(),
  interroger: (adresse: string, jeton: string) => Promise<boolean> = demanderAuHub,
): Promise<boolean> {
  const adresse = normaliser(email);
  if (!adresse) return false;

  const expiration = cache.get(adresse);
  if (expiration !== undefined && expiration > maintenantMs) return true;

  const jeton = (env.HUB_TOKEN ?? '').trim();
  if (!jeton) return false;

  try {
    const accorde = await interroger(adresse, jeton);
    if (!accorde) {
      // Un accès retiré doit disparaître du cache tout de suite, sinon l'entrée mémorisée
      // survivrait à la révocation qu'on vient justement de constater.
      cache.delete(adresse);
      return false;
    }
    cache.set(adresse, maintenantMs + CACHE_ACCES_MS);
    return true;
  } catch (erreur) {
    console.error('[accesHub] requête au hub impossible :', erreur);
    return false;
  }
}

/**
 * Le verrou complet : propriétaire OU accès accordé par le hub.
 *
 * L'ordre compte. `ALLOWED_EMAIL` d'abord, SANS réseau : c'est la porte de service du
 * propriétaire, celle qui tient même quand le hub est tombé. Le hub ensuite, pour tout le
 * monde d'autre. Inverser reviendrait à faire dépendre l'accès de Marc à sa propre app de
 * la disponibilité d'une autre app.
 */
export async function aLeDroitDEntrer(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const adresse = normaliser(email);
  if (!adresse) return false;

  const proprietaire = normaliser(env.ALLOWED_EMAIL);
  if (proprietaire && adresse === proprietaire) return true;

  return await aAccesHub(adresse, env);
}
