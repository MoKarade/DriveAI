/**
 * api/hub/_engineState.ts — couche interne LUE par api/hub/summary.ts pour fabriquer le résumé
 * hub. Le préfixe `_` garantit que Vercel ne l'expose PAS comme endpoint (module partagé, jamais
 * une route). ZÉRO dépendance (api/ est dépendance-free par construction, cf. api/_lib.ts).
 *
 * PHASE 1 (C28-27, plan architecte 2026-07-21) : Vercel est le BROKER entre le hub et le moteur.
 * `getEngineState()` interroge la web app Apps Script (`action=hub-summary`, gardée par le
 * secret partagé existant WEBAPP_SECRET — AUCUN nouveau secret) et rend les métadonnées.
 * Le serverless n'accède toujours PAS à la Sheet : c'est le moteur qui la lit.
 *
 * ⚠️ CE COMMENTAIRE A DIT « JAMAIS UN NOM DE FICHIER » JUSQU'AU 14/09/2026, et c'était une glose
 * plus stricte que l'ADR-0007 elle-même — son §2 liste `Fichier` parmi les métadonnées légitimes
 * de l'Index, et le Journal stocke des noms de fichiers depuis toujours. Ce qui était vrai, et
 * qui n'était écrit nulle part, c'est qu'aucun nom ne SORTAIT du compte Google de Marc.
 * L'ADR-0057 tranche : un nom peut sortir, et il sort sous une contrainte précise — il voyage
 * dans le bloc `details` du contrat, JAMAIS dans `metrics`, parce que le hub ne persiste que les
 * métriques (table `releves`, 90 jours de rétention). Voir `api/hub/summary.ts`, qui applique la
 * contrainte, et `app/test/hub-summary.test.ts`, qui la verrouille.
 *
 * Sémantique des retours (no-fake-data, échec fermé) :
 *  - `null`  → intégration moteur PAS BRANCHÉE (env absentes) ou moteur jamais passé
 *              (lastRunAt null) ⇒ le summary reste « building » (honnête, comme en Phase 0) ;
 *  - `throw` → canal branché mais EN PANNE (réseau, HTTP, JSON illisible, ok:false, champ
 *              invalide) ⇒ summary.ts répond 500 — jamais une donnée partielle ou inventée.
 */

/**
 * État du moteur DriveAI exposé au hub. Interface figée : chaque champ correspond
 * à une métrique/alerte du summary. Métadonnées seulement (ADR-0007) — jamais de contenu de doc.
 */
export interface EngineState {
  /** Taille de la file de revue (`00 · À vérifier`) — 0 en régime normal (auto-classement). */
  reviewQueueCount: number;
  /** Documents classés sur les 7 derniers jours. */
  filedLast7d: number;
  /** Erreurs de traitement sur les 7 derniers jours (quarantaines, échecs). */
  errorsLast7d: number;
  /** Dernier passage du moteur (ISO 8601) — sert d'alerte « moteur muet » côté hub. */
  lastRunAt: string;
  /**
   * Coût LLM CUMULÉ depuis toujours, en USD (bloc usage) — optionnel (absent avant redéploiement
   * moteur). C'est LUI qui devient le `cost` publié : le hub refuse d'additionner des montants
   * qui ne couvrent pas la même période, et tant que DriveAI ne publiait que le mois courant, il
   * empêchait tout total unique honnête (cf. `syntheseCoutTotal_` dans src/Cout.gs).
   */
  llmCostTotalUsd?: number;
  /** Coût LLM MENSUEL mesuré en USD (bloc usage) — optionnel (absent avant redéploiement moteur). */
  llmCostMonthUsd?: number;
  /** Seuil du frein des campagnes, en USD (CONFIG.LLM_BUDGET_CAMPAGNES) — plafond du quota mensuel. */
  llmBudgetCampagnesUsd?: number;
  /** Fils Gmail traités aujourd'hui (bloc usage) — optionnel. */
  gmailThreadsToday?: number;
  /** Quota Gmail en pause (bloc usage) — optionnel. */
  gmailQuotaSuspended?: boolean;
  /**
   * Avancement des campagnes de fond (ADR-0057) — optionnel, borné à `MISSIONS_MAX`.
   * Publié tel que l'onglet Progression l'a rendu : le moteur est le seul à savoir ne PAS annoncer
   * d'horizon sur une campagne en pause.
   */
  missions?: MissionHub[];
  /** Campagnes NON publiées faute de place. Dire le nombre plutôt que tronquer en silence. */
  missionsOmises?: number;
  /** Nom du dernier document classé (ADR-0057) — optionnel. Voir l'en-tête. */
  lastFiledName?: string;
  /** Domaine de classement de ce document — optionnel. */
  lastFiledDomain?: string;
  /** Quand il a été classé (ISO 8601) — optionnel, et absent si le nom est absent. */
  lastFiledAt?: string;
}

/** Une campagne de fond du moteur, telle que l'onglet Progression la décrit. */
export interface MissionHub {
  /** Libellé du registre d'opérations du moteur (`REGISTRE_OPERATIONS`). */
  nom: string;
  /** Volume traité. `null` = la campagne en est encore au recensement (≠ 0 traité). */
  traites: number | null;
  /** Volume total. `null` = pas encore recensé. */
  base: number | null;
  /** Unité du volume (« fichiers », « lignes », « domaines »…). Peut être vide. */
  unite: string;
  /** Statut lisible calculé par le moteur (« en cours », « en pause (frein budget) »…). */
  statut: string;
  /** Estimation de fin, telle que le moteur l'a formulée. Vide quand il refuse d'en donner une. */
  finEstimee: string;
  /** La campagne a convergé. */
  fini: boolean;
}

/**
 * Campagnes acceptées au plus. MIROIR de `HUB_MISSIONS_MAX` (src/WebApp.gs) — deux constantes
 * parce que `api/` ne lit pas de `.gs` (zéro dépendance par construction), et c'est la MÊME
 * raison qui a imposé la liste blanche `REJOUABLES` de `api/mcp/index.ts`. Le moteur borne déjà ;
 * cette borne-ci protège d'un moteur compromis ou d'un moteur en avance d'un déploiement, et elle
 * garde la marge sous le plafond de 8 lignes du contrat.
 */
const MISSIONS_MAX = 6;

/** Plafonds de longueur, alignés sur ceux du moteur (`HUB_TEXTE_MAX`, `HUB_NOM_FICHIER_MAX`). */
const TEXTE_MAX = 90;
const NOM_FICHIER_MAX = 200;

/**
 * Budget d'attente de la web app. La réponse elle-même est instantanée (pré-calcul au tick) ; le
 * temps résiduel est le RÉVEIL à froid de la web app Apps Script (cold start), constaté en prod
 * à > 4,8 s → le broker abandonnait et renvoyait 500 (logs Vercel « aborted due to timeout »,
 * ~27 occurrences sur 3 semaines au 2026-08-13, canal `/api/hub/summary`).
 *
 * Passage à Vercel Pro (2026-08-13) : `maxDuration` (vercel.json) est désormais épinglé
 * explicitement à 20 s pour cette fonction (le plafond Hobby ~10 s, implicite, est ce qui bornait
 * les 8 s précédents) — mais ÇA NE DÉPLACE PAS LE VRAI GOULOT : le hub (hubperso.com, un AUTRE
 * dépôt, hors de portée de cette session) abandonne lui-même de son côté à 9 s. Au-delà de cette
 * limite, peu importe le budget côté DriveAI : le hub a déjà renoncé et sert son dernier résumé en
 * cache. Porté à 8,7 s (marge de ~300 ms sous les 9 s du hub — optimiste : elle ne couvre que la
 * sérialisation JSON de ce côté-ci, pas l'aller-retour réseau hub→Vercel qui s'ajoute au budget
 * perçu côté hub) — un gain modeste, PAS une résolution : la résolution complète exige de relever
 * aussi le budget du hub, dans son propre dépôt.
 */
const TIMEOUT_MS = 8700;

/**
 * Durée de vie du cache broker — PROTECTION DE QUOTA, pas de la performance.
 *
 * Le hub interroge ce endpoint toutes les 15 s tant qu'un onglet est ouvert, et CHAQUE appel
 * non servi par ce cache déclenche une exécution Apps Script complète. Le temps d'exécution
 * Apps Script d'un compte Google grand public est plafonné à 90 min/JOUR, tous scripts
 * confondus — un plafond DUR, partagé avec le tick (`CONFIG.TICK_MINUTES = 5`) ET avec le
 * pilote CI (`pousser-reset`, cron toutes les 15 min, jusqu'à 6 min par passe).
 *
 * ⚠️ CORRECTION DU 2026-08-05. Ce TTL valait 60 s, calé sur l'hypothèse « la donnée bouge
 * toutes les 5 min », c'est-à-dire au rythme du tick. C'EST FAUX DEPUIS C28-34 :
 * `majResumeHub_` ne recalcule plus le résumé qu'au plus une fois par
 * `CONFIG.HUB_RESUME_INTERVALLE_MS`, soit **15 minutes** (le calcul relit l'Index ENTIER, qui
 * n'est pas borné, et retardait le heartbeat). Le broker demandait donc 15× plus souvent que
 * la donnée ne change : un onglet du hub ouvert coûtait ~60 exécutions/heure pour une donnée
 * qui bouge 4 fois — 56 exécutions gaspillées par heure, prélevées sur le plafond dur.
 *
 * Circonstance de la découverte, énoncée SANS la surinterpréter (le premier jet de ce
 * commentaire l'a fait, et se trompait) : le 2026-08-05 à 17 h 28, trois appels ont échoué en
 * « operation aborted due to timeout » — puis trois autres ont répondu 200 à 17 h 34. Une
 * indisponibilité de quelques MINUTES, pas une panne durable, et surtout PAS un quota quotidien
 * épuisé : un plafond à plat ne se rétablit pas en six minutes. Le volume réel est d'ailleurs
 * minuscule (11 requêtes sur 24 h — le hub n'interroge que si un onglet est ouvert), ce qui rend
 * tout raisonnement statistique sur ces logs fragile.
 *
 * Ce que ce TTL corrige n'est donc PAS cet incident, mais une inefficacité indépendante qu'il a
 * révélée. Le bénéfice est de la MARGE de quota, pas une réparation.
 *
 * Ce qui reste solide : `actionHubSummary_` n'est qu'une lecture de Property de quelques
 * millisecondes. Quand elle dépasse les `TIMEOUT_MS` (8,7 s), ce n'est jamais l'action qui traîne
 * — c'est le moteur qui n'obtient pas d'exécution. Piste plausible et non prouvée pour une
 * indisponibilité de quelques minutes : `pousser-reset` s'exécute SYNCHRONEMENT dans la web app,
 * jusqu'à 6 min par passe, toutes les 15 min.
 *
 * 5 min : un tiers de la cadence réelle de la donnée (la règle « N/5 » écrite dans le modèle
 * d'app donnerait 3 min ; 5 min reste conservateur et divise déjà les exécutions par 5). AUCUNE
 * fraîcheur réelle n'est perdue — la donnée sous-jacente ne bouge pas plus vite. Le hub affiche
 * `dataAsOf` (= `lastRunAt`), donc la fraîcheur VRAIE reste visible : ce cache ne masque rien,
 * il cesse seulement de poser quinze fois la même question.
 *
 * ⚠️ Portée : mémoire du PROCESS, comme tout cache serverless — vide à chaque démarrage à froid,
 * non partagée entre instances. Le taux de succès est donc partiel. C'est acceptable ici : chaque
 * succès est une exécution Apps Script économisée, et un échec de cache retombe simplement sur le
 * comportement d'avant. Un cache partagé (Vercel KV) ferait mieux, au prix d'une dépendance —
 * refusé, `api/` est zéro-dépendance par construction.
 */
export const CACHE_TTL_MS = 5 * 60_000;

/** Dernier état LU avec succès (y compris `null` = moteur non branché, qui est une réponse valide). */
let cache: { at: number; etat: EngineState | null } | null = null;

/** Vide le cache — pour les tests (isolation entre cas). */
export function __resetEngineStateCache(): void {
  cache = null;
}

/** Entier de compteur valide (fini, ≥ 0) — tout le reste est une réponse corrompue. */
function compteurValide(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** Nombre ≥ 0 (non arrondi : les coûts ont des cents) ou null. Champs usage additifs, tolérants. */
function nombrePositif(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Texte borné, ou `''` pour tout le reste (nombre, objet, absent). Jamais un `String(objet)`. */
function texteBorne(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '\u2026';
}

/** Compteur de Progression : un nombre fini, ou `null` (= pas encore recensé, ≠ 0). */
function compteurOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Campagnes valides, bornées. Champ ADDITIF donc TOLÉRANT : une entrée mal formée est écartée,
 * jamais une panne — le moteur peut être en avance d'un déploiement, et perdre l'avancement des
 * campagnes ne justifie pas de priver le hub des compteurs (ni de lui faire afficher « injoignable »
 * sur une app qui répond parfaitement).
 *
 * Ce qui est en revanche STRICT : le `nom`. Une campagne sans libellé n'est pas affichable — elle
 * produirait une ligne de détail vide, que le hub rendrait comme une donnée qui n'a pas chargé.
 */
function missionsValides(v: unknown): MissionHub[] {
  if (!Array.isArray(v)) return [];
  const liste: MissionHub[] = [];
  for (const brut of v) {
    if (liste.length >= MISSIONS_MAX) break;
    if (brut === null || typeof brut !== 'object') continue;
    const m = brut as Record<string, unknown>;
    const nom = texteBorne(m.nom, TEXTE_MAX);
    if (!nom) continue;
    liste.push({
      nom,
      traites: compteurOuNull(m.traites),
      base: compteurOuNull(m.base),
      unite: texteBorne(m.unite, 20),
      statut: texteBorne(m.statut, TEXTE_MAX),
      finEstimee: texteBorne(m.finEstimee, TEXTE_MAX),
      fini: m.fini === true,
    });
  }
  return liste;
}

/**
 * Interroge le moteur via la web app. POST vers `/exec` : Apps Script répond par une
 * redirection 302 vers script.googleusercontent.com — le `fetch` Node la suit en basculant
 * POST→GET (downgrade RFC normal ; c'est `curl -X POST -L` qui casse, cf. leçon CLAUDE.md §7).
 * Leçon « /exec : le succès se juge au CONTENU, jamais au code HTTP » : les pannes transitoires
 * ont deux signatures (non-200, OU 200 avec une page HTML à la place du JSON) — tout ce qui
 * n'est pas un JSON `ok:true` aux champs valides est traité en PANNE (throw).
 */
export async function getEngineState(now: () => number = Date.now): Promise<EngineState | null> {
  const frais = cache !== null && now() - cache.at < CACHE_TTL_MS;
  if (frais && cache !== null) return cache.etat;

  // Les PANNES ne sont jamais mises en cache : un `throw` doit rester une panne observable et
  // le prochain appel doit réessayer (sinon une coupure de 3 s se figerait pour toute la durée
  // du TTL — d'autant plus vrai qu'il est passé à 5 min).
  const etat = await lireMoteur_();
  cache = { at: now(), etat };
  return etat;
}

async function lireMoteur_(): Promise<EngineState | null> {
  const url = (process.env.WEBAPP_URL ?? '').trim();
  const secret = (process.env.WEBAPP_SECRET ?? '').trim();
  if (!url || !secret) return null; // intégration moteur pas branchée → « building » honnête

  const rep = await fetch(url + '?action=hub-summary&secret=' + encodeURIComponent(secret), {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!rep.ok) throw new Error('web app HTTP ' + rep.status);

  let brut: unknown;
  try {
    brut = await rep.json();
  } catch {
    throw new Error('web app : réponse non-JSON (page transitoire Apps Script)');
  }

  const d = brut as { ok?: unknown; erreur?: unknown; etat?: Record<string, unknown> };
  if (d.ok !== true) throw new Error('web app : ' + String(d.erreur ?? 'réponse sans ok:true'));

  const etat = d.etat ?? {};
  const reviewQueueCount = compteurValide(etat.reviewQueueCount);
  const filedLast7d = compteurValide(etat.filedLast7d);
  const errorsLast7d = compteurValide(etat.errorsLast7d);
  if (reviewQueueCount === null || filedLast7d === null || errorsLast7d === null) {
    throw new Error('web app : compteurs manquants ou invalides');
  }

  // Moteur jamais passé (première installation) : aucune donnée réelle → « building » honnête.
  if (etat.lastRunAt === null || etat.lastRunAt === undefined) return null;
  const lastRunAt = String(etat.lastRunAt);
  if (Number.isNaN(Date.parse(lastRunAt))) throw new Error('web app : lastRunAt illisible');

  // Champs usage ADDITIFS (absents tant que le moteur n'a pas été redéployé) : tolérés, jamais
  // bloquants — une valeur invalide est simplement ignorée (le bloc usage restera partiel).
  const llmCostTotalUsd = nombrePositif(etat.llmCostTotalUsd);
  const llmCostMonthUsd = nombrePositif(etat.llmCostMonthUsd);
  const llmBudgetCampagnesUsd = nombrePositif(etat.llmBudgetCampagnesUsd);
  const gmailThreadsToday = nombrePositif(etat.gmailThreadsToday);
  const gmailQuotaSuspended = etat.gmailQuotaSuspended === true ? true : undefined;

  // Avancement des campagnes + dernier document classé (ADR-0057), additifs et tolérants.
  const missions = missionsValides(etat.missions);
  const missionsOmises = compteurOuNull(etat.missionsOmises);
  // Le NOM et sa DATE ne se publient qu'ENSEMBLE. Un nom sans date se lirait comme « à l'instant »
  // alors qu'il peut avoir douze jours — et c'est exactement ce que ce champ existe pour dire.
  // Une date sans nom ne désigne rien. Les deux étages du couple sont donc liés ici, à l'entrée,
  // et pas laissés à la charge du rendu.
  const lastFiledName = texteBorne(etat.lastFiledName, NOM_FICHIER_MAX);
  const lastFiledAtBrut = texteBorne(etat.lastFiledAt, 40);
  const couple = lastFiledName !== '' && lastFiledAtBrut !== '' &&
    !Number.isNaN(Date.parse(lastFiledAtBrut));
  const lastFiledDomain = couple ? texteBorne(etat.lastFiledDomain, TEXTE_MAX) : '';

  return {
    reviewQueueCount,
    filedLast7d,
    errorsLast7d,
    lastRunAt,
    ...(llmCostTotalUsd !== null ? { llmCostTotalUsd } : {}),
    ...(llmCostMonthUsd !== null ? { llmCostMonthUsd } : {}),
    ...(llmBudgetCampagnesUsd !== null ? { llmBudgetCampagnesUsd } : {}),
    ...(gmailThreadsToday !== null ? { gmailThreadsToday } : {}),
    ...(gmailQuotaSuspended ? { gmailQuotaSuspended } : {}),
    ...(missions.length > 0 ? { missions } : {}),
    ...(missionsOmises !== null && missionsOmises > 0 ? { missionsOmises } : {}),
    ...(couple
      ? {
        lastFiledName,
        lastFiledAt: new Date(lastFiledAtBrut).toISOString(),
        ...(lastFiledDomain !== '' ? { lastFiledDomain } : {}),
      }
      : {}),
  };
}
