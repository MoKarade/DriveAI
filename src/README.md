# src/ — moteur Apps Script (Phase 1+)

> **Phase 1 livrée.** Les 8 modules ci-dessous implémentent le cœur (Gmail → analyse → classement
> domaine/catégorie, ou file de revue). Voir `PLAN.md` §5 et `BACKLOG.md`.

## Déploiement

1. Crée un projet Apps Script (ou `clasp create`).
2. Copie `.clasp.json.example` → `.clasp.json` et renseigne le `scriptId` (fichier gitignoré).
3. `clasp push` (ou colle les fichiers dans l'éditeur).
4. Dans **Project Settings → Script Properties**, ajoute `DriveAI_ANTHROPIC_KEY` (ta clé Anthropic).
5. Exécute `installerTrigger()` une fois (autorise les scopes) → le scan tourne ensuite toutes les `CONFIG.TICK_MINUTES` (10 min ; modifiable à chaud, appliqué au déploiement suivant).
6. La Google Sheet d'état est créée automatiquement au premier run (ID stocké dans `DriveAI_SHEET_ID`).

## Modules

| Fichier | Rôle |
|---------|------|
| `appsscript.json` | Manifest + `oauthScopes` minimaux |
| `Config.gs` | IDs de dossiers (`docs/TAXONOMY.md`), seuil 0.80, modèle LLM, clé via `PropertiesService` |
| `Gmail.gs` | Recherche des mails non traités, extraction des PJ, label `DriveAI/traité` |
| `Ocr.gs` | OCR via conversion Drive (Google Doc temporaire → texte → suppression) |
| `Llm.gs` | Appel Anthropic (`UrlFetchApp`), prompt de classification, parsing JSON robuste |
| `Router.gs` | Règles de routage (PLAN.md §4), renommage, déplacement, encodage de revue |
| `Journal.gs` | Log dans la Sheet + notif mail immédiate en cas d'échec |
| `Main.gs` | Orchestration + installation/ajustement auto du déclencheur (`CONFIG.TICK_MINUTES`) |

Déploiement envisagé via [`clasp`](https://github.com/google/clasp). Les identifiants clasp
(`.clasprc.json`, `.clasp.json`) sont **gitignorés** — ne jamais les committer.
