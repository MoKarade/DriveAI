# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **Dernière mise à jour : 2026-06-25** — **Phase 2 + full auto**. Dépôt manuel + référentiel d'entités
> (mergé), calibration P2.1 (entité = enrichissement), et **P2.2 full auto** : auto-déploiement
> (`clasp push` sur merge) + auto-rejeu sur bump de version. Reste à Marc : **2 secrets GitHub une fois**
> (`docs/DEPLOIEMENT.md`), puis plus aucune action manuelle.

---

## 1. TL;DR (où on en est)

- **Phase 0** (scaffolding & automatisation) : ✅ mergée.
- **Phase 1** (le cœur : Gmail → analyse → classement) : ✅ codée, revue par la flotte, mergée sur `main`.
- **Automatisation live** : CI + auto-merge (PR `claude/**` verte → squash auto), `CLAUDE.md`
  auto-évolutif, 8 agents, boucle de leçons.
- **DriveAI tourne** : déployé dans Apps Script chez Marc, validé end-to-end le 2026-06-23
  (~25 docs traités : Gmail → OCR → LLM → routage → Index/Revue ; idempotence/nommage confirmés).
- **Recalibrage appliqué** : le 1er run marquait presque tout `sensible` → tout en revue. Le
  prompt vise désormais la zone protégée stricte (immigration + fiscal) ; le reste s'auto-classe.
- **Phase 2 codée** : seconde source d'intake (`00·À trier`, fichiers **déplacés** jamais copiés),
  routage à l'**entité** via le référentiel `Entités` (colonnes + `Statut` auto-réparées), entité
  inconnue → ligne `en_attente` pré-remplie + revue, création des dossiers d'entité + sous-dossiers
  fixes après validation (Statut = « validée »), multi-entités en raccourcis Drive, doublons signalés
  (empreinte MD5). Modules ajoutés : `Entites.gs`, `Intake.gs`, `Pipeline.gs`, `DriveRest.gs`.
- **Full auto (P2.2)** : Action GitHub **Deploy** (`clasp push` auto sur merge `main`, via secrets
  `CLASPRC_JSON`/`SCRIPT_ID`) + **auto-rejeu** sur bump de `CONFIG.VERSION` (renvoie les dépôts en
  revue vers `00·À trier`, borné/réversible). Après le réglage unique des 2 secrets, Marc ne fait plus
  ni `clasp push` ni `rejouerLaRevue`. **Validé en réel le 2026-06-26** (auto-déploiement + auto-rejeu
  ont reclassé 5 dépôts sans intervention).
- **P2.3** : `SEUIL_CONFIANCE` abaissé **0.80 → 0.50** (sur demande de Marc) ; l'auto-rejeu reprend
  désormais aussi les `[REVUE] confiance …` (2e passe, déplacement seul). La zone protégée
  (`[REVUE] sensible`) n'est **jamais** reprise (garde-fou §1) : passeports/immigration/fiscal restent
  en revue par conception.
- **P2.5 (escalade)** : la confiance basse n'envoie plus en revue — elle déclenche une **analyse
  approfondie** (Sonnet ×3, consensus de domaine) puis le doc est **classé au meilleur endroit**.
  Seuls restent en revue : zone protégée + domaine introuvable. Coût borné (plafond d'escalades/run,
  fallback simple sur échec Haiku, docs sensibles non escaladés). Revue flotte 🟢 (sécurité + coût).
- **fix CI/CD** : l'auto-déploiement était muet (merge bot ne déclenche pas `on: push` ; clasp casse en
  Node 22). Réparé : auto-merge **dispatche** Deploy ; Node 20. **Vérifier les runs de l'Action Deploy.**
- **Prochaine étape produit** : Marc configure l'auto-déploiement (2 secrets, cf. `docs/DEPLOIEMENT.md`),
  puis **Phase 3**. *(Rappel : déploiement/exécution vivent dans le compte Google de Marc ; l'Action
  GitHub y accède via l'identifiant clasp qu'il dépose une fois — ce conteneur n'y a jamais accès.)*

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | 🟦 codée (revue flotte), à déployer |
| 3 | Tâches & agenda (Tasks/Calendar) | ⬜ à faire |
| 4 | Recherche + dashboard (app web Vercel) | ⬜ à faire |

Détail des tâches : `BACKLOG.md`.

## 3. Décisions actées (ne pas re-litiger)

- **Legacy = Option A** : l'ancien Drive va dans un dossier `_Archive 2025` à part ; DriveAI n'y touche jamais.
- **Gmail lecture seule** → idempotence portée par l'`Index` (clé `messageId|i|nom|taille`), **pas** de label Gmail.
- **Merge** : auto-merge des PR `claude/**` dès que la CI est verte (pas de revue humaine bloquante).
- **Modèles LLM** : Haiku par défaut (`claude-haiku-4-5`), Sonnet en fallback (`claude-sonnet-4-6`).
- **Scopes** : `gmail.readonly`, `drive`, `script.external_request`, `spreadsheets`,
  `script.send_mail` (notif), `script.scriptapp` (trigger). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc

> Objectif **full auto** : après un réglage unique, plus aucun `clasp push` ni fonction à lancer.

1. **Configurer l'auto-déploiement (UNE fois, ~3 min)** — voir `docs/DEPLOIEMENT.md` § « Déploiement
   100 % automatique » : déposer 2 secrets GitHub (`CLASPRC_JSON` = contenu de `~/.clasprc.json` ;
   `SCRIPT_ID`). Ensuite chaque merge sur `main` se **déploie tout seul** (Action `Deploy` → `clasp push`).
2. **Déclencher le 1er déploiement auto** : une fois les secrets posés, le prochain merge déploie ;
   sinon clique « Run workflow » sur l'Action *Deploy*. Au tick suivant, l'**auto-rejeu** (`CONFIG.VERSION`)
   renvoie les dépôts `[REVUE] entité à valider` dans `00·À trier` et les reclasse — **zéro clic**.
3. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
4. *(Open point `P1-09`)* mesurer le coût LLM réel pour confirmer < 10 $/mois.

> Steady-state désormais **100 % automatique** : nouveaux mails + dépôts traités par le trigger 10 min ;
> mes changements de code déployés par l'Action ; reclassement après recalibrage par l'auto-rejeu.
> Le `rejouerLaRevue` manuel reste dispo (c'est le seul endroit qui met des copies Gmail à la corbeille).

## 5. Blocages / risques connus

- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.
- **Cadence 10 min & quota (audit)** : les comptes Gmail grand public ont ~90 min/jour de temps de
  déclencheur. À 10 min (144 ticks/j), la plupart sont des no-op, mais ~20 runs « pleins » (jusqu'au
  garde-temps `BUDGET_MS` 4.5 min) suffiraient à l'épuiser. Volume perso de Marc → marge large. Si une
  journée chargée coupe les triggers, revenir à `TICK_MINUTES: 15` ou baisser `BUDGET_MS` (reprise au
  tick suivant déjà en place). Le déclencheur se ré-installe seul au déploiement (création avant purge).
- **Phase 2, limites assumées** (relevées par la flotte, non bloquantes) : (a) un document en échec
  LLM/placement persistant est re-OCRisé + re-classé à **chaque** tick (pas de quarantaine après N
  échecs → coût) ; (b) la **copie Gmail** et les **raccourcis multi-entités** ne sont pas idempotents
  au rejeu (un rejeu après coupure entre placement et Index peut dupliquer le fichier/raccourci — c'est
  le compromis « Index en dernier ») ; (c) la **file de revue = le dossier** `00·À vérifier` : un dépôt
  routé en revue est bien dans le dossier même si une coupure empêche la ligne `Revue`/`Index`.

## 6. Comment reprendre

- `/phase 2` — démarrer la phase suivante avec discipline de scope.
- `/review` — passer un diff à la flotte d'agents.
- `/lesson "…"` — consigner une leçon.
- `/handover` — régénérer ce fichier à partir de l'état courant.
- `/ship` — commit + push + PR draft.

## 7. Historique des sessions

- **2026-06-25 (P2.2 — full auto)** — **Auto-déploiement** : Action `Deploy` (`.github/workflows/deploy.yml`,
  `clasp push` sur merge `main`, secrets `CLASPRC_JSON`/`SCRIPT_ID`, inactive sans secrets). **Auto-rejeu** :
  `CONFIG.VERSION` + `appliquerRejeuSiNouvelleVersion_`/`rejeuAutoDesDepots_` renvoient les dépôts partis
  en revue vers `00·À trier` sur bump de version — chirurgical (dépôts `drive|…` seulement, par `fileId`),
  réversible (aucune corbeille), borné (`REJEU_PAGE` + garde-temps), reprenable. Re-audité par la flotte
  (sécurité + quotas) après un 1er design jugé dangereux (corbeille + vidage Index en auto) → corrigé.
- **2026-06-25 (P2.1)** — Calibration : entité non validée → classée au domaine (pas en revue).
- **2026-06-25 (Phase 2)** — Codé le **dépôt manuel** (`Intake.gs`, scan `00·À trier`, fichiers
  déplacés via Drive REST) et le **référentiel d'entités** (`Entites.gs` : cache 1×/run, résolution
  insensible casse/accents, lignes `en_attente` auto-remplies, création des dossiers d'entités
  validées + sous-dossiers fixes). Pipeline unifié Gmail+dépôt (`Pipeline.gs`), routage à l'entité
  (`Router.gs`), raccourcis multi-entités + doublons (empreinte MD5). Revue par la flotte (7 agents) :
  correctifs appliqués — `rejouerLaRevue` ne corbeille plus un original déposé (le renvoie en
  `00·À trier`), garde-temps + plafond sur la création de dossiers, empreinte bornée par la taille,
  clé d'idempotence `drive|fileId`, garde « sous-dossier hors schéma », retry Drive REST.
- **2026-06-25** — Correctif **OCR** : le 1er run réel échouait sur chaque doc
  (`Drive is not defined`, service avancé inactif après `clasp push`). Réécriture de `src/Ocr.gs`
  pour appeler l'**API Drive en REST via `UrlFetchApp`** (token OAuth, scope `drive` déjà accordé),
  dégradation propre si échec. Mergé (PR #10). Reste à Marc : `git pull && clasp push`.
- **2026-06-23 (suite)** — Phase 1 **déployée** par Marc (clasp) et **validée en réel** ;
  recalibrage du flag `sensible` (trop large → immigration + fiscal seulement) ; documents vivants
  (HANDOVER, DEPLOIEMENT) + tenue à jour automatique mis en place.
- **2026-06-23** — Session initiale : scaffolding & automatisation (PR #1, mergée) ; Phase 1
  complète, revue par la flotte et corrigée (PR #2, mergée) ; mise en place des documents
  vivants (HANDOVER, déploiement) et de leur tenue à jour.
