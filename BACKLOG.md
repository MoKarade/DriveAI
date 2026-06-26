# BACKLOG — DriveAI

> Épopées = phases du `PLAN.md`. Chaque tâche a un ID utilisé en préfixe de commit.
> Statuts : ⬜ à faire · 🟦 en cours · ✅ fait · ⏸️ en pause.

---

## Épopée Phase 0 — Scaffolding & automatisation  ✅

| ID | Tâche | Statut |
|----|-------|--------|
| P0-01 | Docs de référence (`PLAN`, `BACKLOG`, `CLAUDE`, `docs/*`) | ✅ |
| P0-02 | Flotte d'agents (`.claude/agents/`) | ✅ |
| P0-03 | Slash-commands (`/phase`, `/review`, `/lesson`, `/ship`) | ✅ |
| P0-04 | Hooks + boucle de leçons (`.claude/hooks/`, `settings.json`) | ✅ |
| P0-05 | CI + auto-merge (`.github/workflows/`, scripts de validation) | ✅ |
| P0-06 | Hygiène repo (`.gitignore`, `.editorconfig`, PR template) | ✅ |
| P0-07 | Documents vivants (`HANDOVER.md`, `docs/DEPLOIEMENT.md`) + tenue à jour (hook + `/handover` + check CI) | ✅ |

**DoD Phase 0 :** une PR `claude/**` se merge seule quand la CI est verte ; le `product-manager`
peut répartir une tâche ; `/lesson` met `CLAUDE.md`/`LESSONS.md` à jour ; `HANDOVER.md` reflète
l'état courant et la CI vérifie la présence des documents vivants.

---

## Épopée Phase 1 — Le cœur  🟦

> Routage **domaine + catégorie + type_doc**. Source = Gmail. Pas d'entité, pas d'app web.

| ID | Tâche | Statut |
|----|-------|--------|
| P1-01 | `appsscript.json` — manifest, `oauthScopes` minimaux (gmail.readonly, drive, script.external_request, spreadsheets, script.send_mail, script.scriptapp) | ✅ |
| P1-02 | `Config.gs` — IDs de dossiers (`docs/TAXONOMY.md`), seuil 0.80, modèle LLM, clé via `PropertiesService` | ✅ |
| P1-03 | `Gmail.gs` — recherche mails non traités, extraction des PJ, pose du label `DriveAI/traité` | ✅ |
| P1-04 | `Ocr.gs` — OCR via conversion Drive (Google Doc temporaire → texte → suppression) | ✅ |
| P1-05 | `Llm.gs` — appel Anthropic (`UrlFetchApp`), prompt de classification, parsing JSON robuste + retry Sonnet | ✅ |
| P1-06 | `Router.gs` — règles de routage (§4), renommage, sous-dossiers année, encodage de suggestion pour la revue | ✅ |
| P1-07 | `Journal.gs` — Index (idempotence) + log dans la Sheet + notif mail immédiate en cas d'échec | ✅ |
| P1-08 | `Main.gs` — orchestration + installation du trigger 15 min | ✅ |
| P1-09 | Mesure de coût LLM sur échantillon réel + extrapolation < 10 $/mois | ⬜ (à mesurer en prod) |

**DoD Phase 1 :** voir `PLAN.md` §5.

---

## Épopée Phase 2 — Dépôt manuel + référentiel d'entités  🟦

> Source = Gmail **+** dépôt manuel `00·À trier` (déplacé, jamais copié). Routage à l'**entité**
> via le référentiel curé `Entités` ; entité inconnue → proposition « en_attente » + revue ;
> création des dossiers d'entité seulement après validation par Marc.

| ID | Tâche | Statut |
|----|-------|--------|
| P2-01 | Scan de `00 · À trier` (réutilise le pipeline, déplacement) | ✅ (`Intake.gs`, `Pipeline.gs`) |
| P2-02 | Onglet `Entités` — référentiel + lecture/écriture (cache 1×/run) | ✅ (`Entites.gs`) |
| P2-03 | Routage à l'entité ; entité inconnue → revue + proposition `en_attente` | ✅ (`Router.gs`) |
| P2-04 | Création auto des dossiers d'entité + sous-dossiers fixes (après validation) | ✅ (`Entites.gs`) |
| P2-05 | Multi-entités (raccourci Drive REST, jamais de copie) | ✅ (`DriveRest.gs`, `Pipeline.gs`) |
| P2-06 | Détection & signalement des doublons (empreinte MD5, jamais d'effacement) | ✅ (`Journal.gs`, `Pipeline.gs`) |
| P2.1 | Calibration : entité non validée → classée au domaine (pas en revue) | ✅ (`Router.gs`) |
| P2.2 | **Full auto** : auto-déploiement (`clasp push` sur merge) + auto-rejeu sur bump `CONFIG.VERSION` | ✅ (`deploy.yml`, `Main.gs`, `Config.gs`) |
| P2.3 | Seuil de confiance 0.80 → **0.50** + auto-rejeu des `[REVUE] confiance` (déplacement seul) | ✅ (`Config.gs`, `Main.gs`) |

**Reste côté Marc :** **2 secrets GitHub une fois** (`CLASPRC_JSON`, `SCRIPT_ID` — cf.
`docs/DEPLOIEMENT.md`) pour activer l'auto-déploiement. Ensuite, plus aucune action manuelle :
nouveaux mails + dépôts traités par le trigger ; code déployé par l'Action ; reclassement par l'auto-rejeu.

**Limites assumées (suivi) :** raccourcis multi-entités et copie Gmail non idempotents au rejeu
(compromis « Index en dernier ») ; un document en échec LLM persistant est re-tenté à chaque tick
(pas encore de quarantaine après N échecs).

---

## Épopée Phase 3 — Tâches & agenda  ⬜

| ID | Tâche | Statut |
|----|-------|--------|
| P3-01 | Détection d'actions/dates dans les mails (LLM) | ⬜ |
| P3-02 | Routage Tasks vs Calendar (heuristique LLM) | ⬜ |
| P3-03 | Scopes Tasks/Calendar écriture (mise à jour du manifest) | ⬜ |

---

## Épopée Phase 4 — Recherche + dashboard (Vercel)  ⬜

| ID | Tâche | Statut |
|----|-------|--------|
| P4-01 | Scaffolding app React/Vite/TS + déploiement Vercel | ⬜ |
| P4-02 | Endpoint Apps Script `doGet`/`doPost` (ou API Sheets) | ⬜ |
| P4-03 | Dashboard de revue (valider/corriger en un clic) | ⬜ |
| P4-04 | Moteur de recherche (tags via `Index`, contenu via OCR indexé) | ⬜ |
| P4-05 | Bilingue FR/EN | ⬜ |
