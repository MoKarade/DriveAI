<!-- Extrait de l'ancien CLAUDE.md (§ 3. Workflow git), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Workflow git

## 3. Workflow git

### NotebookLM — ABANDONNÉ COMPLÈTEMENT (décisions Marc 2026-07-28 et 2026-07-29)

> L'ancienne règle « NotebookLM = analyse architecturale & décision ; Claude = exécution »
> (décision Marc 2026-07-07) est **RÉVOQUÉE**, et Marc a confirmé le 2026-07-29 l'**abandon
> COMPLET** de NotebookLM : plus aucun passage obligé, plus aucun rappel « ajouter comme source »
> (l'ancienne règle « Nouveau fichier ⇒ prévenir le PM » est retirée avec). **Claude conçoit ET
> exécute directement.** Ce qui REMPLACE le contrôle : le protocole §8 (ADR d'abord pour tout
> changement de classement) reste OBLIGATOIRE, fonctions pures testées, et **revue flotte
> adversariale AVANT merge** (code-reviewer + le spécialiste concerné — leçon C28-32 : la revue
> se fait AVANT, jamais après). Le miroir Drive (ADR-0017) tourne encore au merge (inoffensif) ;
> le déclasser (`sync-drive.yml`) est une option ouverte, sur demande de Marc.

- **Branches** : `claude/<slug>` pour le travail automatisé, `feature/<slug>` pour Marc.
  `main` est protégée par la CI.
- **Commits** : en français, préfixés par l'ID de tâche du backlog. Ex. `P1-03: extraction des PJ Gmail`.
- **Après toute reprise de session, LIRE `git rev-parse --short HEAD origin/main` avant tout.** Le
  conteneur distant est éphémère : le 2026-09-07, l'arbre était reparti d'un instantané vieux de
  17 jours (commit d'avant un rebase, plus d'`origin/main`, reflog à 4 entrées) et j'ai édité une
  heure dessus. Une base fantôme ne se voit qu'aux ancres de doc qui ne matchent plus.
- **`git fetch origin main` AVANT de commiter.** Plusieurs sessions travaillent sur ce dépôt en
  parallèle : le 19-20/08, trois correctifs ont été écrits deux fois (même job CI borné dans #298
  et dans une branche concurrente, même paragraphe de README dans deux PR). Le doublon ne se voit
  qu'au merge, quand il est déjà payé.
- **Push & merge auto** : Claude pousse sur une branche `claude/**`, ouvre une PR (draft),
  la CI valide, puis la PR se **merge automatiquement** (squash) quand la CI est verte.
  Voir `.github/workflows/`. Override : label `do-not-merge`.
  ⚠️ **Depuis le 2026-09-09 (#329), le BROUILLON EST le frein** — l'auto-merge refuse une PR
  `isDraft` (échec fermé : lecture impossible ⇒ refus). *Révise l'ancienne règle « un draft n'est
  PAS un frein » (vécu 19/08, #293 et #295), où un workflow repassait les PR en « ready ».*
  Conséquence pour chaque session : une PR ouverte en brouillon **ne partira jamais toute seule** —
  il faut la sortir du brouillon (`isDraft=false`) une fois la CI verte et la revue flotte passée.
  `do-not-merge` reste le second verrou, pour tenir une PR déjà sortie du brouillon.
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
