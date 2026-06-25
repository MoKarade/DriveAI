# CLAUDE.md — DriveAI

> Mémoire de projet, chargée à chaque session. **Garde ce fichier court et à jour.**
> Le détail vit dans `PLAN.md`, `BACKLOG.md` et `docs/`. Les leçons s'accumulent dans
> `docs/LESSONS.md` et leurs règles durables remontent dans la section « Leçons » ci-dessous.

## 1. Le projet en une phrase

**DriveAI** range Google Drive tout seul : les pièces jointes utiles des mails et les
fichiers déposés à la main sont analysés par un LLM (Claude Haiku), renommés selon une
convention stricte, et classés dans une arborescence granulaire — sans intervention, sauf
une file de revue pour les cas incertains.

Stack : **Google Apps Script** (moteur, Phases 1–3) + une **Google Sheet** (état) +
**app web React/Vite/TS sur Vercel** (Phase 4). LLM via l'API Anthropic.

## 2. Garde-fous NON NÉGOCIABLES

Ces règles priment sur toute optimisation. Toute PR qui les viole doit échouer la revue.

1. **Zone protégée.** `04 · Immigration` et tout doc `sensible=true` (incl. fiscal dans
   `02 · Finances/Impôts`) ne sont **JAMAIS** rangés automatiquement → toujours `00 · À vérifier`.
   En cas de doute sur la sensibilité, le LLM met `sensible=true` par défaut.
2. **Aucune suppression automatique.** Les doublons sont *signalés*, jamais effacés.
3. **Moindre privilège.** Gmail en **lecture seule**. Scopes déclarés explicitement dans
   `appsscript.json`. Drive RW, Tasks/Calendar écriture uniquement (Phase 3).
4. **Aucun secret en dur.** La clé API vit dans les Script Properties
   (`DriveAI_ANTHROPIC_KEY`), jamais dans le code, jamais dans un commit.
5. **Idempotence.** Un fichier déjà traité ne l'est pas deux fois (label Gmail +
   vérification dans l'`Index`).
6. **Budget LLM < 10 $/mois.** Haiku par défaut, Sonnet en fallback ponctuel.

## 3. Conventions de code

- **Langue** : code et commentaires en français ; interface produit bilingue FR/EN.
- **Commits** : en français, préfixés par l'ID de tâche du backlog. Ex. `P1-03: extraction des PJ Gmail`.
- **Branches** : `claude/<slug>` pour le travail automatisé. `main` est protégée par la CI.
- **Nommage des fichiers classés** : `AAAA-MM-JJ_Type_Émetteur.ext`. L'entité est dans le
  *chemin*, jamais répétée dans le nom. Date absente → date de réception du mail.
- **Discipline de scope** : on livre par phases. Ne pas anticiper une phase ultérieure.
  Voir `BACKLOG.md` pour le périmètre exact de chaque phase.

## 4. Workflow automatisé

- **Push & merge auto** : Claude pousse sur une branche `claude/**`, ouvre une PR (draft),
  la CI valide, puis la PR se **merge automatiquement** (squash) quand la CI est verte.
  Voir `.github/workflows/`. Override : label `do-not-merge`.
- **Flotte d'agents** (`.claude/agents/`) : un `product-manager` planifie et répartit le
  travail vers les spécialistes. Lance `/review` pour passer un diff au crible.
- **Boucle de leçons** : après chaque session qui touche du code, un hook `Stop` invite à
  consigner les leçons réutilisables. Utilise `/lesson "…"`. Voir `docs/WORKFLOW.md`.
- **Documents vivants** (à tenir à jour à chaque session, comme FinanceAI) : `HANDOVER.md`
  (état courant, `/handover`), `BACKLOG.md` (statuts), `docs/` (dont `DEPLOIEMENT.md`). Le hook
  `Stop` le rappelle ; la CI vérifie leur présence. Ne jamais les laisser dériver de la réalité.

| Agent | Rôle |
|-------|------|
| `product-manager` | Découpe la tâche, choisit les bons agents, ordonne le travail |
| `structure-keeper` | Garde la taxonomie / l'arborescence cohérente (`docs/TAXONOMY.md`) |
| `naming-validator` | Valide la convention de nommage et le formatage (`docs/NAMING.md`) |
| `file-checker` | Vérifie la logique d'intake des nouveaux fichiers (idempotence, doublons) |
| `code-reviewer` | Relit les diffs : bugs, lisibilité, conventions |
| `security-auditor` | Moindre privilège, secrets, zone protégée, pas de suppression auto |
| `apps-script-quota` | Triggers, quotas, lots, robustesse Drive/Gmail |
| `llm-cost-optimizer` | Prompts, JSON strict, choix de modèle, cible budget |

## 5. Commandes utiles

- `/phase <n>` — démarre une phase du backlog avec discipline de scope.
- `/review` — passe le diff courant à la flotte d'agents via le `product-manager`.
- `/lesson "<leçon>"` — consigne une leçon dans `docs/LESSONS.md` (+ règle durable ici).
- `/handover` — régénère `HANDOVER.md` à partir de l'état courant.
- `/ship` — commit (FR, préfixe ID), push `-u origin`, ouvre la PR draft.

## 6. État du projet

- **Phase courante** : 0 — scaffolding & automatisation. Le moteur Apps Script (Phase 1)
  n'est **pas** encore écrit. Voir `BACKLOG.md`.
- **Prérequis côté Marc** avant Phase 1 : projet Apps Script créé, clé Anthropic dans les
  Script Properties (`DriveAI_ANTHROPIC_KEY`), Google Sheet d'état créée. Voir `PLAN.md` §8.

## 7. Leçons apprises (règles durables)

> Distillées depuis `docs/LESSONS.md`. N'ajouter ici que ce qui change la façon de coder.

- **Gmail lecture seule = pas de label.** `gmail.readonly` interdit `addLabel`/`createLabel`
  (exception à l'exécution). L'idempotence se porte **par l'Index** (clé `messageId|i|nom|taille`,
  index de PJ inclus), jamais par un label Gmail.
- **Ordre des écritures d'état.** L'inscription Index (« c'est fini ») se pose en dernier — après
  le dépôt Drive et après la ligne Revue — pour qu'une coupure rejoue au lieu de perdre un cas.
- **Robustesse moteur Apps Script.** `LockService` (anti-chevauchement), garde-temps (coupure
  6 min), et lecture d'état mise en cache 1×/run (jamais une lecture Sheet par item).
- **Garde-fou étroit, calibré sur du réel.** Un flag de protection (ex. `sensible`) doit viser
  des catégories précises (immigration + fiscal), pas « true par défaut » — sinon tout part en
  revue et l'auto-rangement est neutralisé. Le défaut prudent ne sert que pour les réponses LLM
  *malformées*, jamais comme posture de classement.
- **Git (squash-merge + branche réutilisée).** Avant chaque nouvelle tâche, repartir
  d'`origin/main` (reset/merge). Si la branche distante `claude/**` diverge après merge,
  refusionner son tip plutôt que force-push (ruleset). Un check requis doit gater le merge vers
  `main`, pas le push des branches de travail. Ne jamais juger un `git push` via `| tail` (l'exit
  code est masqué) — vérifier `git push; echo $?`.
- **Frontière d'exécution.** DriveAI tourne dans le compte Google de Marc (Apps Script). La
  session Claude ne peut **pas** y déployer (`clasp push`) ni exécuter de fonction ; le MCP Drive
  est lecture/copie/création seulement. Annoncer cette frontière tôt et minimiser la part manuelle
  de Marc via du code (fonctions « un clic »), jamais promettre de déployer/exécuter à sa place.
- **API Google via REST, pas service avancé.** Le service avancé Drive (`Drive.*`) déclaré dans
  `appsscript.json` n'est pas fiable après `clasp push` (`Drive is not defined`). Appeler l'API
  Drive en **REST via `UrlFetchApp`** (token `ScriptApp.getOAuthToken()`, scope `drive`) — robuste,
  sans activation manuelle. Faire dégrader l'OCR proprement (texte vide) plutôt que planter.
