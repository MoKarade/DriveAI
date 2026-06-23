---
description: Passe le diff courant à la flotte d'agents via le product-manager
allowed-tools: Bash(git diff:*), Bash(git status), Bash(git log:*)
---

Passe le diff courant au crible de la flotte d'agents DriveAI.

Diff à relire :
!`git diff HEAD`

Procédure :
1. Invoque `product-manager` pour déterminer **quels** agents sont pertinents pour ce diff
   (selon les fichiers touchés) et dans quel ordre.
2. Lance les agents retenus parmi : `code-reviewer`, `security-auditor`, `structure-keeper`,
   `naming-validator`, `file-checker`, `apps-script-quota`, `llm-cost-optimizer`.
   Lance en parallèle ceux qui sont indépendants.
3. Agrège leurs retours en une synthèse : 🔴 bloquant / 🟠 à corriger / 🟡 suggestion, chacun
   avec `fichier:ligne` et la correction.
4. Termine par un verdict global : **prêt à merger** ou **corrections requises**.

Priorise toujours les garde-fous de `CLAUDE.md` §2 : une seule violation = bloquant.
