<!-- Extrait de l'ancien CLAUDE.md (§ 7. Intégration hub (widget DriveAI sur hubperso.com)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Intégration hub (widget DriveAI sur hubperso.com)

## 7. Intégration hub (widget DriveAI sur hubperso.com)

DriveAI expose un résumé au **hub perso** (`hubperso.com`) via **un seul endpoint** :
`GET /api/hub/summary` (`api/hub/summary.ts`, serverless Vercel). URL canonique de l'app :
**`https://drive.hubperso.com`**.

- **Contrat** : `@mokarade/hub-contract` v1 (devDependency de `app/`). La forme du payload est
  **inlinée** dans `api/hub/summary.ts` (api/ reste **zéro dépendance npm par construction**) et
  **verrouillée** par le VRAI schéma du package (`validateSummary()` + `buildingSummary()`) dans
  `app/test/hub-summary.test.ts`. Toute évolution du contrat passe par le package (bump de version
  + re-pin), **jamais** par une divergence locale.
- **Auth (échec fermé)** : le hub envoie le header `x-hub-token`. Comparaison en **temps constant**
  (digests SHA-256 + `timingSafeEqual`). `HUB_TOKEN` (variable d'env Vercel, jamais en dur) absent
  → **503** `hub disabled` ; jeton absent/faux → **401** ; méthode ≠ GET → **405**. Réponse toujours
  `Cache-Control: no-store`.
- **HONNÊTETÉ (no-fake-data)** : le point de bascule est `api/hub/_engineState.ts` →
  `getEngineState()`, qui interroge la web app Apps Script (`action=hub-summary`, gardée par le
  secret partagé `WEBAPP_SECRET` — aucun nouveau secret) et rend des **métadonnées seulement**
  (compteurs, horodatage, avancement des campagnes, ADR-0007) — jamais un CONTENU de document.
  ⚠️ Cette puce écrivait « jamais un nom de fichier » jusqu'au 14/09/2026 : c'était une glose plus
  stricte que l'ADR-0007, dont le §2 liste `Fichier` parmi les métadonnées légitimes. Depuis
  l'**ADR-0057**, le nom du dernier document classé est publié — et sous une contrainte précise :
  il voyage dans le bloc `details` du contrat, **JAMAIS dans `metrics`**, parce que Hubperso
  persiste les métriques (table `releves`, 90 jours) et pas les détails. Un test le verrouille.
  Trois retours, trois
  sens **distincts** : `null` (intégration non branchée, ou moteur jamais passé) ⇒ summary
  `status:"building"` ; `throw` (canal branché mais EN PANNE — réseau, HTTP, JSON illisible) ⇒
  **500**, jamais une donnée partielle ; sinon les vrais chiffres. Le serverless Vercel n'accède
  toujours **pas** à la Sheet : c'est le moteur qui la lit, et l'app la lit côté navigateur avec le
  jeton OAuth de Marc (ADR-0007).
  *(Cette puce a affirmé « **Phase 0 (aujourd'hui)** : il renvoie `null` » jusqu'au 2026-08-20,
  alors que le broker servait des métriques réelles depuis la Phase 1 — C28-27, 21/07. Un état
  transitoire écrit au présent rote sans prévenir.)*
- **Règle de maintenance** : toute nouvelle métrique se branche dans `getEngineState()` **et** passe
  par le contrat. Ne **jamais** casser le schéma (toute évolution passe par `hub-contract` : bump de
  version + re-pin, jamais une divergence locale) ni publier de donnée fabriquée — `building` tant
  que rien de réel n'est disponible vaut mieux qu'un chiffre plausible.
- **QUOTA — le broker met en cache (60 s), et c'est structurel.** Le hub poll ce endpoint
  **toutes les 15 s** tant qu'un onglet est ouvert, alors que le moteur ne recalcule le résumé
  qu'**une fois par tick** (`CONFIG.TICK_MINUTES = 5`, persisté dans `DriveAI_HUB_SUMMARY`).
  Sans cache, 19 polls sur 20 déclenchaient une exécution Apps Script pour renvoyer des octets
  identiques — sur un budget **DUR de 90 min/jour** de temps d'exécution, partagé avec le tick
  lui-même. `_engineState.ts` garde donc le dernier état lu pendant 60 s. Aucune fraîcheur perdue
  (la donnée bouge toutes les 5 min) et `dataAsOf` continue d'exposer la fraîcheur réelle.
  ⚠️ Les **pannes ne sont jamais mises en cache** — un `throw` doit rester observable et le
  prochain appel doit réessayer. ⚠️ Cache de **process** : vide au démarrage à froid, non partagé
  entre instances → taux de succès partiel, ce qui reste tout bénéfice (chaque succès = une
  exécution économisée). Toute nouvelle voie d'appel depuis le hub doit se poser la même question.
