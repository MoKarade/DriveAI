# Runbook d'exploitation — DriveAI

> Comment **déployer, surveiller et dépanner** le moteur. Public : Marc + tout repreneur.
> (🔜 = prévu, pas encore implémenté — cf. `docs/ROADMAP.md`.)

## 1. Architecture en 30 s
- **Moteur** : Google Apps Script (`src/*.gs`) dans le compte Google de Marc, **déclencheur toutes les 5 min** (`tickDriveAI`) — fréquence réglable depuis l'app (Santé → Réglages : 5/10/15/30 min → `Réglages!B2` de la Sheet, appliqué au tick suivant, #22).
- **État** : Google Sheet « DriveAI — État » — onglets `Entités`, `Index` (idempotence + catalogue), `Journal`, `Revue`, `Échecs` (quarantaine), `Progression` (barre du grand rangement).
- **LLM** : API Anthropic (Haiku par défaut, Sonnet en escalade) via `UrlFetchApp`. Clé dans Script Property `DriveAI_ANTHROPIC_KEY`.
- **CI/CD** : push/merge sur `main` → GitHub Action `deploy.yml` fait `clasp push` (secrets `CLASPRC_JSON` + `SCRIPT_ID`, Node 20). L'auto-merge **dispatche** le déploiement (un merge par le bot ne déclenche pas `on: push`).

## 2. Déployer
- **Auto** : merge sur `main` → `clasp push` automatique. **Toujours vérifier le run « Deploy » (vert)** — ne pas supposer qu'il a tourné.
- **Secours manuel** : `clasp push` en local (Node 20). ⚠️ La session Claude ne peut PAS déployer (frontière : le code tourne dans le compte de Marc).

## 3. Surveiller
- **Résumé hebdomadaire** par mail (docs classés / revue / tâches / événements / coût du mois / 🔜 santé).
- Onglet **`Progression`** : barre du grand rangement.
- **Signal indépendant** si la Sheet est illisible (cache/volume) : recherche Drive directe — `modifiedTime` sur tout le Drive, contenu d'un dossier par `parentId`. Ne jamais affirmer un résultat sans preuve.

## 4. Incidents fréquents & remèdes

### 🔴 « Le moteur n'écrit plus / ne range plus rien » (Sheet figée)
1. **Vérifier l'activité Drive réelle** : des fichiers ont-ils été modifiés depuis le dernier déploiement ? Si **seul le code** a changé → le moteur ne produit rien.
2. **Cause probable A — déclencheur désactivé** par Google (trop d'échecs). **Auto-réparé** par le **chien de garde** (2ᵉ déclencheur `chienDeGarde`, toutes les 30 min, ADR-0004) : il détecte le silence (heartbeat `DriveAI_LAST_TICK` périmé > 45 min), **ré-installe seul** le déclencheur principal, et n'envoie un **mail d'alerte** (« exécuter `installerTrigger` ») que si l'auto-réparation ne suffit pas. Remède manuel (si alerté) inchangé : **script.google.com → projet DriveAI → exécuter `installerTrigger`**. Cas résiduel : si Google désactive *tous* les déclencheurs (watchdog inclus), le résumé hebdo sert de second filet, sinon un clic.
3. **Cause probable B — état figé « terminé » à tort** : une collecte qui a échoué (exception attrapée) prise pour « 0 = fini ». Déverrouiller en **bumpant `CONFIG.RANGEMENT_TAG`** (ex. r3→r4) → nouvelle passe complète.
4. Diagnostiquer par le **CODE + signaux Drive** quand le Journal est illisible (énorme/tronqué).

### 🟠 Un fichier échoue en boucle
- Après `QUARANTAINE_MAX` (3) essais, il est **quarantiné** (onglet `Échecs`, statut Index `quarantaine`) → plus re-tenté, une seule alerte. Pour le relancer après une panne transitoire : exécuter **`dequarantaine()`** (tout libérer, manuel) — ou **bumper `CONFIG.DEQUARANTAINE_TAG`** (R3 : le tick lance le noyau tout seul, one-shot, clés `drive|` seulement ; un rétablissement de panne le ré-arme automatiquement).

### 🟠 « La file `00 · À trier` ne se draine pas » (fichiers qui stagnent des heures)
Quatre causes possibles, CUMULABLES (incident R3 du 2026-07-07 : les quatre à la fois) :
1. **Famine d'équité** (corrigée par R3, `Intake.gs`) : la page est désormais composée de
   TRAITABLES seulement et triée FIFO (plus ancien d'abord). Si ça stagne encore, vérifier que le
   renommage produit bien `AAAA-MM-JJ_…` (prédicat de skip du rangement) et le Journal « Budget temps ».
2. **Quarantaine silencieuse** : le fichier est dans l'Index avec statut `quarantaine` (échecs d'une
   panne passée) → il est INVISIBLE pour l'intake. Remède : `dequarantaine()` ou bump `DEQUARANTAINE_TAG`.
3. **Fichier Google natif** : depuis R3, Docs/Sheets/Slides sont classés (export texte REST). Les types
   SANS export (Forms, dessins) restent en place par design — les ranger à la main.
4. **Frein budget** (`CONFIG.LLM_BUDGET_CAMPAGNES` — 30 $ depuis le 07-07, décision Marc « tri au
   complet » ; cible croisière < 10 $) : les CAMPAGNES (grand rangement, historique Gmail, migration)
   sont en pause — mais le flux vivant (dépôts, Gmail récent) continue. Journal : « Budget campagnes
   atteint ». Relever = éditer la constante (choix explicite de Marc, jamais 0/Infinity).
Diagnostic rapide : chercher la clé `drive|<fileId>` dans l'Index (statut ?), puis le Journal du dernier tick.

### 🔴 Crédit API Anthropic épuisé (Journal : « PANNE DE COMPTE API »)
Le moteur tourne mais SUSPEND ses sources (Gmail, dépôts, campagnes) pendant la panne — il
re-sonde le compte au plus une fois par heure (aucun quota Gmail brûlé, aucun document pénalisé).
Après recharge, la reprise est automatique en ≤ 1 h (ligne Journal « Compte API RÉTABLI »).
1. Recharger : console.anthropic.com → **Plans & Billing** (penser à l'auto-recharge).
2. Si des documents ont été quarantainés À TORT pendant une panne passée : un clic
   **`dequarantaine()`** (éditeur Apps Script) les re-tente tous.

### 🟡 Quota quotidien atteint
- Compte **gratuit** = ~90 min d'exécution/jour. Le moteur **reprend seul le lendemain**. Normal sur un traitement de masse (l'ancien Drive s'étale sur ~1-2 jours). Rien à faire.

### 🔧 Relancer un grand rangement de zéro
- Bumper **`CONFIG.RANGEMENT_TAG`** → re-parcours complet, **borné + reprenable**, déplacement seul.

### 🟦 Lancer le dry-run v2 (preuve avant/après) — `CONFIG.DRYRUN_V2_ACTIF` (C26-07, ADR-0015)
> Prérequis à la campagne C26-08 ET à l'allumage d'`ANALYSE_V2` ci-dessous. Interrupteur DÉDIÉ,
> distinct d'`ANALYSE_V2` — n'affecte JAMAIS le flux vivant (Haiku reste actif tant qu'`ANALYSE_V2`
> est éteint), mais exécute le VRAI pipeline Sonnet ×2 (coût réel, ~0,03-0,04 $/doc, ADR-0015).
1. **Confirmer avec Marc** la taille de l'échantillon (`CONFIG.DRYRUN_V2_TAILLE`, 100 par défaut,
   marge 50-150) et son coût estimé (~3-4 $, jusqu'à ~6 $ à 150) — un feu vert DISTINCT et plus
   petit que celui de la campagne C26-08.
2. Mettre `CONFIG.DRYRUN_V2_ACTIF: true`, déployer. Le moteur sélectionne un échantillon stratifié
   par domaine (y compris `04 · Immigration`, lecture seule) et l'analyse, quelques documents par
   tick (`DRYRUN_V2_MAX_PAR_RUN`).
3. **Vérifier l'onglet Sheet `DryRunV2`** : avant/après par document (domaine/sous-dossier/nom
   proposés, fail-safe déclenché ou non, coût mesuré) — AUCUN fichier n'est déplacé/renommé.
4. Une fois `DriveAI_DRYRUNV2` = tag courant (Property, campagne terminée) : repasser
   `CONFIG.DRYRUN_V2_ACTIF: false`, présenter la Sheet à Marc pour validation avant C26-08.
5. **Relancer un nouvel échantillon** : bumper `CONFIG.DRYRUN_V2_TAG` (ex. `d1` → `d2`) — coût
   PAYANT à nouveau, décision explicite seulement.

### 🟦 Allumer l'analyse v2 (Sonnet 2 passes) — `CONFIG.ANALYSE_V2` (ADR-0015)
> Le pipeline v2 (fiabilité maximale) est livré **éteint**. NE PAS mettre `ANALYSE_V2: true` sans cette checklist — Sonnet ×2/doc coûte ~×10-20 et double le temps par document.
1. **Campagnes closes** : rangement (`RANGEMENT_TAG` r3 terminé, `RANGEMENT_RACINES_SUP: []`), migration, historique Gmail tous finis. Sinon le flux vivant Sonnet + campagne peut épuiser le runtime ~90 min/j et **geler tout le moteur**.
2. **Feu vert coût de Marc** (Sonnet sur le flux vivant + campagne C26-08 ~70-100 $) + **plafond `LLM_BUDGET_CAMPAGNES`** revu le temps du rattrapage.
3. **Dry-run d'abord** (C26-08) : avant/après écrit dans la Sheet, **rien déplacé**, validation humaine.
4. **Surveiller** les 1ers jours : heartbeat Sheet (le moteur tourne-t-il ?), `Cout.gs` (coût mensuel), file `00 · À trier` qui se draine. Le garde-temps est déjà abaissé sous v2 (`budgetMsRun_()` → `ANALYSE_V2_BUDGET_MS`).
5. **Rollback immédiat** : repasser `ANALYSE_V2: false` → retour Haiku 1 passe instantané (chemin OFF prouvé identique).

## 5. Garde-fous NON négociables (CLAUDE.md §2)
- **Aucune suppression** auto (doublons → `_Doublons`). **Zone protégée `04 · Immigration` jamais détachée** (garde multi-parents, remonte toute la chaîne d'ancêtres). **Gmail lecture seule.** **Clé API jamais en dur** (Script Properties).

## 6. La flotte d'agents (revue de code)
`product-manager` répartit ; `security-auditor`, `apps-script-quota`, `code-reviewer`, `file-checker`,
`structure-keeper`, `naming-validator`, `llm-cost-optimizer` relisent selon le diff. Lancer `/review`.
