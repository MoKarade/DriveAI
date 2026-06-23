# src/ — moteur Apps Script (Phase 1+)

> **Vide pour l'instant.** La Phase 0 ne livre que l'automatisation et les docs. Le code du
> moteur arrive en Phase 1 (voir `BACKLOG.md`).

Disposition prévue des modules Apps Script (Phase 1) :

| Fichier | Rôle |
|---------|------|
| `appsscript.json` | Manifest + `oauthScopes` minimaux |
| `Config.gs` | IDs de dossiers (`docs/TAXONOMY.md`), seuil 0.80, modèle LLM, clé via `PropertiesService` |
| `Gmail.gs` | Recherche des mails non traités, extraction des PJ, label `DriveAI/traité` |
| `Ocr.gs` | OCR via conversion Drive (Google Doc temporaire → texte → suppression) |
| `Llm.gs` | Appel Anthropic (`UrlFetchApp`), prompt de classification, parsing JSON robuste |
| `Router.gs` | Règles de routage (PLAN.md §4), renommage, déplacement, encodage de revue |
| `Journal.gs` | Log dans la Sheet + notif mail immédiate en cas d'échec |
| `Main.gs` | Orchestration + installation du trigger 15 min |

Déploiement envisagé via [`clasp`](https://github.com/google/clasp). Les identifiants clasp
(`.clasprc.json`, `.clasp.json`) sont **gitignorés** — ne jamais les committer.
