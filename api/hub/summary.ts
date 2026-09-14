/**
 * api/hub/summary.ts — GET /api/hub/summary : résumé DriveAI pour le hub perso
 * (hubperso.com → widget DriveAI). Contrat @mokarade/hub-contract v1.
 *
 * Le hub appelle ce endpoint avec le header `x-hub-token`. Échec fermé (§2) :
 *   - HUB_TOKEN non défini côté serveur → 503 { error: "hub disabled" } (intégration désactivée) ;
 *   - jeton absent/faux → 401 { error: "unauthorized" } (comparaison en TEMPS CONSTANT) ;
 *   - méthode ≠ GET → 405.
 * Réponse toujours `Cache-Control: no-store` (via repondreJson) : un summary est un instantané.
 *
 * ZÉRO dépendance npm, par CONSTRUCTION (cf. api/_lib.ts : le projet Vercel est enraciné au dépôt,
 * `installCommand:"true"` → aucun node_modules à la racine). La forme du contrat v1 est donc
 * INLINÉE ici, et VERROUILLÉE par le VRAI schéma `@mokarade/hub-contract` (`validateSummary()` +
 * `buildingSummary()`) dans app/test/hub-summary.test.ts (devDependency de app/ uniquement).
 *
 * HONNÊTETÉ (no-fake-data) : les données réelles vivent dans la Google Sheet d'état, lue côté
 * NAVIGATEUR avec le jeton OAuth de Marc (ADR-0007) — le serverless Vercel n'y a AUCUN accès.
 * Tant que `getEngineState()` renvoie `null` (Phase 0), ce endpoint publie un summary « building » :
 * statut honnête, zéro chiffre inventé. Le branchement Phase 1 se fait dans _engineState.ts.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { Requete, Reponse, repondreJson } from '../_lib';
import { getEngineState, EngineState, MissionHub, CACHE_TTL_MS } from './_engineState';

/** Version du contrat hub (= CONTRACT_VERSION du package). Bump = rupture → nouveau tag + re-pin. */
const CONTRACT_VERSION = 1;
/** Header du jeton hub (= HUB_TOKEN_HEADER du package — inliné, api/ zéro-dep). */
const HUB_TOKEN_HEADER = 'x-hub-token';
/** URL canonique de DriveAI (décision Marc 2026-07-15 : sous-domaine du hub perso). */
const URL_APP = 'https://drive.hubperso.com';
/** Couleur d'accent du widget (hex 6 digits) — accent de l'app (styles.css `--accent`, v5 Material Dark). */
const COULEUR = '#8ab4f8';
/**
 * Moteur « muet » au-delà de 45 min sans tick → `status: degraded`.
 *
 * ⚠️ CORRECTION DU 14/09/2026. Ce commentaire disait « déclencheur à 30 min + marge » : les deux
 * moitiés étaient fausses. Le DÉCLENCHEUR du tick est à 5 minutes (`CONFIG.TICK_MINUTES`) ; c'est
 * le CHIEN DE GARDE qui est à 30 (`CONFIG.WATCHDOG_MINUTES`). La valeur de 45 min est donc bien
 * calibrée — sur le chien de garde, plus une marge d'un demi-cycle — mais sa raison écrite
 * désignait le mauvais mécanisme. Un seuil dont la justification est fausse est un seuil que la
 * prochaine session « corrigera » vers 10 min en croyant coller au déclencheur, et DriveAI
 * passerait alors en `degraded` à chaque tick manqué.
 */
const SEUIL_MUET_MS = 45 * 60 * 1000;

/**
 * Âge maximal ATTENDU de la donnée, publié au hub (`expectedMaxAgeSec`, contrat v1.3).
 *
 * DÉRIVÉ, jamais écrit en dur : c'est exactement le seuil au-delà duquel DriveAI se déclare
 * elle-même `degraded`, plus la durée de vie du cache du broker — puisqu'un résumé servi depuis
 * ce cache porte un `dataAsOf` vieilli d'autant.
 *
 * ── POURQUOI LE DÉRIVER PLUTÔT QUE DE CHOISIR UN JOLI CHIFFRE ───────────────────────
 *
 * Le hub juge la fraîcheur avec ce nombre et lui seul (`lib/gel.ts`, ADR-0003 de Hubperso) : il
 * n'a aucune connaissance du rythme de DriveAI, et c'est voulu. Si ce nombre était indépendant de
 * `SEUIL_MUET_MS`, les deux surfaces se contrediraient — le hub afficherait « donnée figée »
 * pendant que le widget de la même app affiche `ok`, ou l'inverse. Deux diagnostics opposés sur
 * la même réalité, c'est la façon la plus sûre d'apprendre à n'en croire aucun. Dérivé, l'écart
 * est impossible par construction : un rajustement du seuil déplace les deux ensemble.
 */
const AGE_MAX_ATTENDU_SEC = Math.round((SEUIL_MUET_MS + CACHE_TTL_MS) / 1000);

/** Plafonds du contrat v1.3 pour une ligne de détail. Dépasser fait REJETER le résumé entier. */
const LABEL_MAX = 40;
const HINT_MAX = 80;
/** Le contrat ne borne PAS la valeur texte d'une ligne de détail — le producteur doit le faire. */
const VALEUR_TEXTE_MAX = 60;

/**
 * Comparaison de jetons en TEMPS CONSTANT, insensible aux longueurs différentes : on compare les
 * digests SHA-256 (toujours 32 octets → `timingSafeEqual` ne lève pas et la longueur du secret ne
 * fuit pas). Un `x-hub-token` absent / non-chaîne / vide échoue avant tout calcul.
 */
function jetonValide(fourni: string | string[] | undefined, attendu: string): boolean {
  if (typeof fourni !== 'string' || fourni.length === 0) return false;
  const a = createHash('sha256').update(fourni).digest();
  const b = createHash('sha256').update(attendu).digest();
  return timingSafeEqual(a, b);
}

/** Type d'une ligne de détail du contrat v1.3, inliné (api/ est zéro-dépendance). */
interface LigneDetail {
  label: string;
  value: number | string;
  format: 'currency' | 'percent' | 'number' | 'text';
  severity?: 'ok' | 'warn' | 'alert';
  hint?: string;
}
interface SectionDetail {
  title: string;
  items: LigneDetail[];
}

/** Tronque en signalant la coupe. Une valeur coupée en silence passe pour la valeur entière. */
function tronquer(texte: string, max: number): string {
  return texte.length <= max ? texte : texte.slice(0, max - 1) + '\u2026';
}

/**
 * « il y a 12 min », « il y a 3 h », « il y a 5 j » — RELATIF, et c'est le point.
 *
 * Une date absolue devrait être rendue dans le fuseau du Québec ; ce code tourne sur Vercel, en
 * UTC, et `Intl` prendrait le fuseau de la MACHINE. Le hub serait alors faux de 4 ou 5 h selon la
 * saison, sans aucun signe extérieur — c'est le garde-fou `FUSEAU` de Hubperso, vu du côté
 * producteur. Un écart, lui, est vrai partout : il n'a pas de fuseau.
 */
function ilYA(deltaMs: number): string {
  const min = Math.max(0, Math.round(deltaMs / 60_000));
  if (min < 60) return 'il y a ' + min + ' min';
  const h = Math.round(min / 60);
  return h < 48 ? 'il y a ' + h + ' h' : 'il y a ' + Math.round(h / 24) + ' j';
}

/**
 * Une campagne → une ligne de détail.
 *
 * `value` porte le VOLUME TRAITÉ en nombre quand il est connu, pour que le hub puisse un jour en
 * tracer la courbe. Au recensement il n'y a pas de volume : on publie un tiret TEXTE plutôt qu'un
 * 0 numérique — « rien de traité » et « pas encore compté » ne sont pas la même information, et le
 * 0 serait le seul des deux à ressembler à une panne.
 *
 * Le `hint` ne redit jamais le libellé : il porte la base, le statut et l'estimation telle que le
 * MOTEUR l'a formulée — y compris ses silences (pas d'horizon sur une campagne en pause, pas de
 * date de fin sur une mission convergée à reliquat). Reformuler ici rouvrirait tous les mensonges
 * que `lignesProgression_` a appris à ne pas dire.
 */
function ligneMission(m: MissionHub): LigneDetail {
  const bouts: string[] = [];
  if (m.base !== null) bouts.push('sur ' + m.base + (m.unite ? ' ' + m.unite : ''));
  if (m.statut) bouts.push(m.statut);
  if (m.finEstimee) bouts.push(m.finEstimee);
  const hint = tronquer(bouts.join(' · '), HINT_MAX);
  return {
    label: tronquer(m.nom, LABEL_MAX),
    value: m.traites === null ? '\u2014' : m.traites,
    format: m.traites === null ? 'text' : 'number',
    // `ok` sur une campagne convergée, et RIEN sur les autres. Une campagne lente n'est pas une
    // faute : lui coller `warn` inventerait un reproche, et le hub trie ses gravités.
    ...(m.fini ? { severity: 'ok' as const } : {}),
    ...(hint ? { hint } : {}),
  };
}

/**
 * Les sections de détail du résumé (contrat v1.3) — vide si le moteur n'en publie pas encore.
 *
 * ⚠️ AUCUN NOM DE FICHIER NE SORT D'ICI. Le nom du dernier document classé vit dans `details`
 * et nulle part ailleurs : le hub ne persiste que `metrics` (table `releves`, 90 jours), donc un
 * nom placé en métrique serait recopié dans la base du hub à chaque relevé. Dans `details` il
 * transite, s'affiche, et disparaît. C'est la contrainte que l'ADR-0057 a posée en échange du
 * droit de publier le nom, et `app/test/hub-summary.test.ts` la verrouille.
 */
function sectionsDetail(etat: EngineState, maintenantMs: number): SectionDetail[] {
  const sections: SectionDetail[] = [];

  const missions = etat.missions ?? [];
  if (missions.length > 0) {
    const items: LigneDetail[] = [];
    const vus = new Set<string>();
    for (const m of missions) {
      const ligne = ligneMission(m);
      // Le contrat REFUSE deux libellés identiques dans une même section, et deux libellés
      // distincts peuvent se confondre une fois tronqués à 40 caractères. Le vrai garde-fou est le
      // test qui passe le registre d'opérations RÉEL du moteur dans cette troncature ; cette
      // déduplication-ci est la ceinture : en production, une collision perd une ligne au lieu de
      // faire rejeter le résumé ENTIER — c'est-à-dire d'accuser DriveAI d'une panne inexistante.
      if (vus.has(ligne.label)) continue;
      vus.add(ligne.label);
      items.push(ligne);
    }
    if (items.length > 0) {
      const omises = etat.missionsOmises ?? 0;
      sections.push({
        title: omises > 0
          ? tronquer('Campagnes (' + omises + ' non affichée' + (omises > 1 ? 's' : '') + ')', LABEL_MAX)
          : 'Campagnes de rangement',
        items,
      });
    }
  }

  if (etat.lastFiledName && etat.lastFiledAt) {
    const classeLe = Date.parse(etat.lastFiledAt);
    sections.push({
      title: 'Dernier document classé',
      items: [
        {
          label: 'Fichier',
          value: tronquer(etat.lastFiledName, VALEUR_TEXTE_MAX),
          format: 'text',
          ...(etat.lastFiledDomain ? { hint: tronquer(etat.lastFiledDomain, HINT_MAX) } : {}),
        },
        {
          label: 'Classé',
          value: Number.isNaN(classeLe) ? '\u2014' : ilYA(maintenantMs - classeLe),
          format: 'text',
          // Le retard PROPRE à cette ligne, dit une fois : le scan de l'Index est throttlé à
          // 15 min côté moteur (il relit un onglet non borné). Un document classé à l'instant
          // peut donc ne pas être celui-ci — mais celui qui s'affiche porte sa vraie date.
          hint: 'relevé au plus toutes les 15 min',
        },
      ],
    });
  }

  return sections;
}

export default async function handler(req: Requete, res: Reponse): Promise<void> {
  if (req.method !== 'GET') {
    repondreJson(res, 405, { error: 'method not allowed' });
    return;
  }

  const attendu = process.env.HUB_TOKEN ?? '';
  if (!attendu) {
    // Intégration hub non configurée (variable d'environnement Vercel absente) — échec fermé,
    // jamais de summary : le hub affiche « désactivée » plutôt qu'un endpoint ouvert.
    repondreJson(res, 503, { error: 'hub disabled' });
    return;
  }

  if (!jetonValide(req.headers[HUB_TOKEN_HEADER], attendu)) {
    repondreJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const app = { id: 'driveai', name: 'DriveAI', url: URL_APP, color: COULEUR };

  // getEngineState() est le POINT DE BASCULE Phase 0 → Phase 1 (C28-27 : branché). `null` =
  // pas de données réelles (intégration pas configurée, ou moteur jamais passé) → « building »
  // honnête, identique à la Phase 0. Une PANNE du canal (throw) → 500, jamais une donnée
  // partielle ni inventée (échec fermé — plan architecte 2026-07-21).
  let etat: EngineState | null;
  try {
    etat = await getEngineState();
  } catch (err) {
    // Cause loggée pour le diagnostic (logs Vercel) — le hub, lui, ne reçoit qu'un 500 opaque
    // et l'erreur ne porte jamais de secret (messages construits dans _engineState.ts).
    console.error('[hub-summary] canal moteur en panne :', err instanceof Error ? err.message : String(err));
    repondreJson(res, 500, { status: 'error', error: 'Moteur indisponible' });
    return;
  }

  if (etat === null) {
    // Équivalent EXACT de buildingSummary(app, { alertLabel }) du contrat (verrouillé par le
    // test), enrichi de l'action « Ouvrir DriveAI ». Aucune métrique inventée.
    repondreJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      app,
      generatedAt: new Date().toISOString(),
      status: 'building',
      metrics: [],
      alerts: [{ label: 'Moteur en Phase 0 — classement pas encore actif', severity: 'info' }],
      actions: [{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }],
    });
    return;
  }

  // Données réelles : 3 compteurs en métriques, lastRunAt en dataAsOf. « degraded » si le
  // moteur est muet depuis plus de SEUIL_MUET_MS (le chien de garde + une marge — voir la
  // constante). Les alertes ne disent que ce qui est vrai : rien à signaler = aucune alerte.
  const maintenant = Date.now();
  const muet = maintenant - Date.parse(etat.lastRunAt) > SEUIL_MUET_MS;
  const alerts: { label: string; severity: 'info' | 'warn' }[] = [];
  if (muet) alerts.push({ label: 'Moteur silencieux depuis plus de 45 minutes', severity: 'warn' });
  if (etat.errorsLast7d > 0) {
    alerts.push({ label: etat.errorsLast7d + ' erreur(s) de traitement sur 7 jours', severity: 'warn' });
  }
  if (etat.reviewQueueCount > 0) {
    alerts.push({ label: etat.reviewQueueCount + ' document(s) en attente dans la file de revue', severity: 'info' });
  }

  // Bloc `usage` (coûts & quotas du hub) — additif v1.1, uniquement les champs réellement
  // publiés par le moteur (absents tant qu'il n'a pas été redéployé → bloc partiel ou omis).
  const quotas: { label: string; used: number; limit: number | null; unit?: string }[] = [];
  if (typeof etat.gmailThreadsToday === 'number') {
    quotas.push({ label: 'Fils Gmail (aujourd’hui)', used: etat.gmailThreadsToday, limit: null, unit: 'fils' });
  }
  if (etat.gmailQuotaSuspended) {
    // Quota Gmail Apps Script épuisé (pause automatique) : représenté « au plafond ».
    quotas.push({ label: 'Quota Gmail', used: 1, limit: 1 });
  }
  // COÛT PUBLIÉ = LE CUMUL, pas le mois. Le hub somme les coûts PAR PÉRIODE et refuse de
  // fusionner « cumulé » avec « ce mois-ci » — additionner les deux donnerait un montant qui
  // n'existe pas. Tant que DriveAI ne publiait que son mois courant, il était donc seul dans sa
  // colonne et le hub ne pouvait afficher aucun total unique (FinanceAI et BatchChef publient un
  // cumul). En publiant `total`, DriveAI rejoint la colonne des autres.
  //
  // Le mois n'est pas perdu, il change de place : il devient un QUOTA avec le seuil du frein des
  // campagnes pour plafond — ce qui est plus juste qu'un « coût du mois » nu, puisque le nombre
  // qui compte est sa DISTANCE au frein, pas sa valeur absolue.
  //
  // REPLI sur `mois` si le cumul est absent : la web app Apps Script peut être en retard d'un
  // déploiement (champ additif). Un repli déclaré `total` afficherait le mois courant sous
  // l'étiquette « cumulé » — un chiffre juste sous une étiquette fausse, donc un mensonge.
  const usage: {
    cost?: { amount: number; currency: 'USD'; period: 'total' | 'mois' };
    quotas?: typeof quotas;
  } = {};
  const cents = (v: number) => Math.round(v * 100) / 100;
  if (typeof etat.llmCostTotalUsd === 'number') {
    usage.cost = { amount: cents(etat.llmCostTotalUsd), currency: 'USD', period: 'total' };
    if (typeof etat.llmCostMonthUsd === 'number') {
      quotas.push({
        label: 'Coût LLM du mois (frein campagnes)',
        used: cents(etat.llmCostMonthUsd),
        // Plafond publié par le moteur (CONFIG.LLM_BUDGET_CAMPAGNES), jamais recopié ici : Marc
        // le rajuste en éditant Config.gs. `null` si le moteur ne l'a pas envoyé — une jauge sans
        // plafond, jamais un plafond inventé.
        limit: typeof etat.llmBudgetCampagnesUsd === 'number' ? etat.llmBudgetCampagnesUsd : null,
        unit: 'USD',
      });
    }
  } else if (typeof etat.llmCostMonthUsd === 'number') {
    usage.cost = { amount: cents(etat.llmCostMonthUsd), currency: 'USD', period: 'mois' };
  }
  if (quotas.length > 0) usage.quotas = quotas;

  const details = sectionsDetail(etat, maintenant);

  repondreJson(res, 200, {
    contractVersion: CONTRACT_VERSION,
    app,
    generatedAt: new Date().toISOString(),
    dataAsOf: etat.lastRunAt,
    // `expectedMaxAgeSec` n'est publié QU'AVEC `dataAsOf` — le contrat v1.3 rejette un âge
    // attendu orphelin, et il a raison : un seuil sans horodatage à comparer donnerait au
    // producteur la certitude d'être surveillé alors que rien ne le serait. Les deux champs sont
    // donc ici, sur la même branche ; la branche « building » n'en porte aucun des deux.
    expectedMaxAgeSec: AGE_MAX_ATTENDU_SEC,
    status: muet ? 'degraded' : 'ok',
    metrics: [
      // `primary` désigne LE chiffre de la carte (contrat v1.3). Pour un moteur de classement,
      // c'est le volume classé : la file de revue et les erreurs sont à 0 en régime normal, et
      // mettre en avant un zéro sain ne dit rien de ce que l'app fait.
      { label: 'Classés (7 jours)', value: etat.filedLast7d, format: 'number', primary: true },
      { label: 'File de revue', value: etat.reviewQueueCount, format: 'number' },
      { label: 'Erreurs (7 jours)', value: etat.errorsLast7d, format: 'number' },
    ],
    alerts,
    actions: [{ label: 'Ouvrir DriveAI', kind: 'link', href: URL_APP }],
    ...(usage.cost || usage.quotas ? { usage } : {}),
    ...(details.length > 0 ? { details } : {}),
  });
}
