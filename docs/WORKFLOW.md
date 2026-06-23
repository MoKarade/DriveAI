# Workflow de développement automatisé — DriveAI

> Comment le code est produit, validé, mergé, et comment le projet apprend de lui-même.

## 1. Cycle de développement

```
Claude Code (branche claude/**)
   │  développe une tâche (préfixe ID du backlog)
   ▼
/review  ──▶  product-manager  ──▶  agents spécialistes (en parallèle)
   │                                  code-reviewer, security-auditor,
   │                                  structure-keeper, naming-validator,
   │                                  file-checker, apps-script-quota, llm-cost-optimizer
   ▼
/ship  ──▶  commit (FR, "P1-03: …")  ──▶  push -u origin claude/**  ──▶  PR draft
   ▼
CI (.github/workflows/ci.yml)  ──▶  verte ?
   │                                   │
   │ non → reste en draft, on corrige  │ oui
   ▼                                   ▼
                          auto-merge.yml (squash + delete branch)
```

## 2. Push & merge automatiques

- **CI** (`ci.yml`, `on: pull_request`) valide : JSON parseables, syntaxe des scripts shell,
  **scan de secrets**, présence des fichiers requis, frontmatter des agents.
- **Auto-merge** (`auto-merge.yml`, `on: workflow_run` de la CI) : quand la CI réussit sur une
  PR dont la branche commence par `claude/`, la PR est marquée *ready* puis **mergée en squash**
  (et la branche supprimée).
- **Override** : ajouter le label `do-not-merge` à une PR empêche l'auto-merge.
- **Garde-fous d'activation** (à faire une fois côté GitHub) :
  - Le workflow `auto-merge` n'agit qu'une fois présent sur `main` (déclencheur `workflow_run`
    lu depuis la branche par défaut). **La toute première PR de scaffolding se merge donc à la
    main**, par toi ; l'automatisation est live ensuite.
  - Optionnel : activer une *branch protection* sur `main` exigeant le check CI, pour que même
    un push direct passe par la validation.

## 3. La flotte d'agents

Définis dans `.claude/agents/`. Le **`product-manager`** est le chef d'orchestre : il découpe la
demande, choisit les agents pertinents et ordonne le travail (il **planifie** — l'exécution des
sous-agents est lancée par le thread principal, les sous-agents ne s'appellent pas entre eux).

| Agent | Quand l'utiliser |
|-------|------------------|
| `product-manager` | Toute tâche multi-étapes : pour répartir et séquencer |
| `structure-keeper` | Changement touchant la taxonomie / l'arborescence / le routage |
| `naming-validator` | Changement touchant le renommage / le format de nom |
| `file-checker` | Changement touchant l'intake (Gmail PJ, `00·À trier`), idempotence, doublons |
| `code-reviewer` | Relecture d'un diff |
| `security-auditor` | Scopes OAuth, secrets, zone protégée, suppression auto |
| `apps-script-quota` | Triggers, quotas, lots, robustesse Drive/Gmail |
| `llm-cost-optimizer` | Prompts, JSON strict, choix de modèle, budget |

Lance la flotte d'un coup avec `/review`.

## 4. La boucle de leçons (CLAUDE.md auto-évolutif)

Le but : que `CLAUDE.md` s'enrichisse des leçons tirées en codant, **automatiquement**.

Mécanique (voir `.claude/hooks/` + `.claude/settings.json`) :
1. **SessionStart** → `session-start.sh` réinitialise l'état de session et **injecte les
   dernières leçons** de `docs/LESSONS.md` dans le contexte.
2. **PostToolUse** (`Write`/`Edit`/`MultiEdit`) → `mark-code-changed.sh` pose un marqueur
   « du code a changé cette session ».
3. **Stop** → `lesson-check.sh` : si du code a changé et qu'aucune leçon n'a été consignée, il
   **bloque une fois** la fin de session et invite à exécuter `/lesson "…"` (ou à écrire `RAS`).
   Le marqueur est ensuite levé → pas de boucle infinie.

`/lesson "<texte>"` :
- ajoute une entrée datée à `docs/LESSONS.md` ;
- si la leçon est une **règle durable** (change la façon de coder), l'ajoute aussi à la section
  « Leçons apprises » de `CLAUDE.md`.

Garde `CLAUDE.md` court : seules les règles durables y montent ; le journal complet reste dans
`docs/LESSONS.md`.

## 5. Conventions

- Commits **en français**, préfixés par l'ID de tâche : `P1-03: extraction des PJ Gmail`.
- Une PR = une tâche (ou un petit groupe cohérent). Discipline de scope : pas d'anticipation de
  phase.
- Branches `claude/<slug>`. `main` n'est touchée que par merge de PR.
