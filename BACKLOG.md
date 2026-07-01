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
| P1-09 | Mesure de coût LLM sur échantillon réel + extrapolation < 10 $/mois | ✅ (`Cout.gs` — tokens `usage` mesurés/agrégés par mois, affichés dans le résumé hebdo) |
| P1-10 | **Visibilité** : résumé hebdomadaire automatique par mail (docs classés / en revue / tâches / événements / erreurs / coût mesuré du mois) — déclencheur auto-installé, aucun nouveau scope | ✅ (`Resume.gs`, `Cout.gs`, `Main.gs`) |
| P1-11 | **Quarantaine** : un document en échec persistant (LLM/placement) n'est plus re-OCRisé/re-classé à chaque tick — compté (onglet `Échecs`), mis en quarantaine après `QUARANTAINE_MAX` essais (Index `quarantaine` → sauté) + une seule alerte. Échecs intermédiaires journalisés sans mail (anti-spam) | ✅ (`Journal.gs`, `Pipeline.gs`, `Config.gs`) |
| P1-12 | **Doublons → `_Doublons`** : au volume du grand rangement, signaler chaque doublon en revue sature la file. Les doublons NON sensibles sont désormais ÉCARTÉS dans un dossier `_Doublons` (déplacement seul, jamais supprimé § 2), comptés dans le résumé hebdo ; un doublon sensible reste en revue (§1). Balai manuel `nettoyerDoublonsRevue()` pour les doublons déjà en revue | ✅ (`Router.gs`, `Resume.gs`, `Maintenance.gs`) |
| P1-13 | **Lecture des fichiers Office** (.docx/.ppt/.xlsx) via conversion Google native (le trou qui envoyait tous les CV/TP en revue « OCR vide ») + re-tri auto (bump VERSION) | ✅ (`Ocr.gs`, `Config.gs`) |
| P1-14 | **Documents sensibles auto-classés** (décision Marc 2026-07-01) : `sensible`/zone protégée ne routent plus en revue → classés dans leur domaine ; doublon sensible → `_Doublons` (1 exemplaire gardé). Garde-fous conservés : aucune suppression, non-détachement de 04. Seul `domaine inconnu` reste en revue. Constitution (`CLAUDE.md` §1) mise à jour | ✅ (`Router.gs`, `Pipeline.gs`, `Config.gs`, `CLAUDE.md`) |
| fix-pipeline | **File `00·À trier` gelée** : `appliquerRangementInitial_` tournait avant l'intake et sans try/catch → un plantage gelait tout le pipeline. Corrigé : maintenance enveloppée, drainer (Gmail+dépôts) AVANT d'alimenter (rangement) | ✅ (`Main.gs`) |
| P1-13 | **Lecture des fichiers Office** : `.docx`/`.ppt`/`.xlsx` étaient envoyés en revue (« OCR vide ») car non lus. Extraction via conversion Google native (Docs/Slides/Sheets) → texte réel → classés correctement. Version bumpée (P2.8) → re-tri auto de la revue existante (Office classés, vieux doublons → `_Doublons`) | ✅ (`Ocr.gs`, `Config.gs`) |

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
| P2.4 | Déclencheur **15 → 10 min** (`CONFIG.TICK_MINUTES`) + ré-installation auto au déploiement (création avant suppression) | ✅ (`Config.gs`, `Main.gs`) |
| P2.5 | **Escalade** : confiance basse (non sensible) → analyse approfondie Sonnet ×3 (consensus) → classé au meilleur endroit, plus en revue. Plafonné/run | ✅ (`Llm.gs`, `Router.gs`, `Config.gs`) |
| P2.6 | **Grand rangement auto** : tout le contenu « en vrac » des domaines renvoyé au fil des ticks vers 00·À trier → reclassé/renommé par le pipeline. Zéro clic (gated `CONFIG.RANGEMENT_TAG`), borné/run, reprenable, déplacement seul, zone protégée écartée | ✅ (`Maintenance.gs`, `Main.gs`, `Config.gs`) |
| P2.7 | **Rangement étendu à l'ancien Drive** (« Ancienne structure », `RANGEMENT_RACINES_SUP`) + garde-fou OCR vide : un dépôt (manuel ou rangement) sans texte OCR exploitable part en revue (« sensibilité indéterminable ») au lieu d'être classé sur le seul nom de fichier — ferme un trou réel sur les vieux scans (passeport/fiscal à nom neutre) | ✅ (`Config.gs`, `Maintenance.gs`, `Pipeline.gs`, `Router.gs`) |
| fix-ci | Auto-déploiement : dispatch après auto-merge + Node 20 (clasp) | ✅ (`auto-merge.yml`, `deploy.yml`) |
| fix-gel | **Hotfix pipeline gelé** : la file `00·À trier` stagnait (grand rangement non protégé + placé AVANT le drainage → une erreur de collecte gelait tout le tick). Étapes secondaires (rejeu, rangement, entités) enveloppées de try/catch ; rangement déplacé APRÈS l'intake (drainer avant d'alimenter) ; scan Gmail durci par fil | ✅ (`Main.gs`) |

**Reste côté Marc :** **2 secrets GitHub une fois** (`CLASPRC_JSON`, `SCRIPT_ID` — cf.
`docs/DEPLOIEMENT.md`) pour activer l'auto-déploiement. Ensuite, plus aucune action manuelle :
nouveaux mails + dépôts traités par le trigger ; code déployé par l'Action ; reclassement par l'auto-rejeu.

**Limites assumées (suivi) :** raccourcis multi-entités et copie Gmail non idempotents au rejeu
(compromis « Index en dernier ») ; un document en échec LLM persistant est re-tenté à chaque tick
(pas encore de quarantaine après N échecs).

---

## Épopée Phase 3 — Tâches & agenda (remplace l'agent mail externe de Marc)  🟦

> Source = TOUS les mails récents (pas seulement ceux avec PJ). Pré-filtre 3 étages pour le budget
> (mots-clés → zone protégée → mini-check Haiku). Création 100 % auto (zéro validation) : action/
> échéance → Google Tasks, rdv daté → Google Calendar. Décisions actées avec Marc le 2026-06-30.

| ID | Tâche | Statut |
|----|-------|--------|
| P3-03 | Scopes `tasks`/`calendar.events` (manifest) + clients REST `Tasks.gs`/`Calendar.gs`/`GoogleApi.gs` (création uniquement, jamais lecture/suppression) | ✅ |
| P3-04 | Pré-filtre 3 étages (`Prefiltre.gs`) : mots-clés rejet (gratuit) → zone protégée (gratuit, défense en profondeur indépendante du LLM) → mini-check Haiku (expéditeur+sujet seuls, ~10 tokens sortie) | ✅ |
| P3-01 | Extraction d'intentions (LLM, `PROMPT_INTENTIONS`/`extraireIntentions_`) + routage Tasks vs Calendar (date+heure → événement, sinon tâche) | ✅ (`Llm.gs`) |
| P3-02 | Scan élargi à tous les mails récents (`GMAIL_REQUETE_ACTIONS`) ; orchestration + idempotence à 2 niveaux (`intention\|messageId`, `tache\|…`/`event\|…`) ; ID client Calendar déterministe (rejeu → 409 = succès, jamais de doublon) | ✅ (`Intentions.gs`, `Gmail.gs`) |
| P3-05 | Pagination robuste sur fenêtre mouvante : scan « avant » (nouveau mail) + scan « arrière » ancré sur date absolue persistée (rattrapage de l'historique, jamais d'offset numérique qui stagnerait) | ✅ (`Intentions.gs`) |

**Re-audité par la flotte (4 spécialistes, 2 passes)** : security-auditor 🟢 (zone protégée en
défense en profondeur, aucun autre chemin de création, scopes minimaux) ; llm-cost-optimizer 🟢
(~1-4 $/mois estimé pour ce flux, largement sous la cible) ; file-checker 🟢 (idempotence saine,
ID Calendar bien scopé par message) ; apps-script-quota — 1er passage BLOQUANT (l'offset de
pagination repartait de 0 à chaque tick → stagnation au-delà des ~200 premiers messages sur un
volume réaliste), corrigé (scan arrière à date absolue persistée), 2e passage 🟢 CONFORME.

**Reste côté Marc :** **une ré-autorisation Google unique** (nouvel écran de consentement Tasks/
Calendar — cf. `docs/DEPLOIEMENT.md` § Phase 3) après le prochain déploiement. Ensuite, zéro action
manuelle récurrente, comme le reste du moteur.

**Limites assumées (suivi)** : Google Tasks n'offre pas d'ID client idempotent (contrairement à
Calendar) — une coupure pile entre la création d'une tâche et l'écriture Index pourrait créer un
doublon au rejeu (même compromis déjà accepté pour la copie Gmail). Granularité jour du curseur
`before:` du scan arrière (risque résiduel mineur, borné à un seul jour, une seule fois).

---

## Épopée Phase 4 — Recherche + dashboard (Vercel)  ⬜

| ID | Tâche | Statut |
|----|-------|--------|
| P4-01 | Scaffolding app React/Vite/TS + déploiement Vercel | ⬜ |
| P4-02 | Endpoint Apps Script `doGet`/`doPost` (ou API Sheets) | ⬜ |
| P4-03 | Dashboard de revue (valider/corriger en un clic) | ⬜ |
| P4-04 | Moteur de recherche (tags via `Index`, contenu via OCR indexé) | ⬜ |
| P4-05 | Bilingue FR/EN | ⬜ |
