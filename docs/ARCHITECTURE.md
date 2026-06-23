# Architecture technique — DriveAI

> `apps-script-quota` et `security-auditor` s'appuient sur ce document.

## Vue d'ensemble

```
┌─────────────┐   trigger 15 min   ┌──────────────────────┐
│  Gmail (PJ) │ ─────────────────▶ │  Apps Script (moteur) │
│ 00·À trier  │                    │  Gmail / Drive / Ocr  │
└─────────────┘                    │  Llm / Router / Journal│
                                   └───────────┬───────────┘
                                               │ UrlFetchApp
                                               ▼
                                   ┌──────────────────────┐
                                   │  API Anthropic (Haiku) │
                                   └──────────────────────┘
                                               │
                  état / index / journal       ▼
┌──────────────┐               ┌──────────────────────────┐
│ App web      │ ◀───────────▶ │  Google Sheet (DB légère) │
│ React/Vercel │   (Phase 4)   │  Entités · Index · Journal·│
│ (Phase 4)    │               │  Revue                    │
└──────────────┘               └──────────────────────────┘
```

## Composants

### Moteur — Google Apps Script (Phases 1–3)
- **Pourquoi** : triggers temporels natifs ; accès Gmail/Drive/Tasks/Calendar *en tant que
  Marc* (pas d'OAuth serveur à gérer) ; gratuit ; pas d'infra à héberger.
- **Modules Phase 1** : `Config.gs`, `Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Router.gs`,
  `Journal.gs`, `Main.gs`. Voir `BACKLOG.md`.
- **Scopes** (`appsscript.json` → `oauthScopes`), moindre privilège :
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/drive`
  - `https://www.googleapis.com/auth/script.external_request` (UrlFetchApp)
  - `https://www.googleapis.com/auth/spreadsheets`
  - *(Phase 3)* `.../auth/tasks`, `.../auth/calendar`
- **Clé API** : Script Properties `DriveAI_ANTHROPIC_KEY`, lue via `PropertiesService`.
  Jamais en dur, jamais commitée.

### État — Google Sheet
Base de données légère, lisible/éditable à la main, partagée entre Apps Script et l'app web.
- `Entités` — référentiel (Phase 2).
- `Index` — catalogue des docs classés + tags (sert la recherche Phase 4 + l'idempotence).
- `Journal` — log d'exécution + erreurs.
- `Revue` — file d'attente avec suggestions (option « riche » vs nom de fichier ; cf. `PLAN.md` §7).

### LLM — API Anthropic
- **Haiku** par défaut (le moins cher). **Sonnet** en fallback ponctuel sur cas ambigu.
- Appel via `UrlFetchApp` (POST JSON). Prompt système de classification → **JSON strict**
  (schéma dans `PLAN.md` §4). Parsing robuste (try/catch, retry léger).
- Pré-filtre déterministe (expéditeur/type) en réserve si la facture grimpe.

### Interface — App web React/Vite/TS sur Vercel (Phase 4)
- Dashboard de revue + moteur de recherche, dans une seule UI, bilingue FR/EN.
- Lit/écrit l'état via l'API Google Sheets ou un endpoint Apps Script (`doGet`/`doPost`).
- **Inutile aux Phases 1–3** : la revue passe par le dossier `00 · À vérifier`.

## Quotas & robustesse (Apps Script)
- Limiter le scan Gmail à `newer_than:30d`, traiter **par lots**.
- Prévoir les coupures de quota (UrlFetch, conversions Drive, temps d'exécution 6 min).
- **Idempotence** : label Gmail `DriveAI/traité` + vérification dans `Index` avant traitement.
- Aucune suppression automatique. Aucune écriture hors des dossiers cibles.

## Sécurité
- Moindre privilège (scopes ci-dessus). Gmail **lecture seule**.
- Notifications système via `MailApp` sur le propre compte (pas un scope d'envoi tiers).
- Zone protégée (immigration + fiscal) jamais rangée auto — appliquée dans `Router.gs`.
