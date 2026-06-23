---
description: Commit (FR, préfixe ID), push sur claude/**, ouvre la PR draft
argument-hint: "<ID-tâche> <message court>"
allowed-tools: Bash(git add:*), Bash(git status), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(git diff:*), Bash(git log:*)
---

Livre le travail courant.

État du dépôt :
!`git status --short && echo '---' && git branch --show-current`

Procédure :
1. Vérifie qu'on est sur une branche `claude/**` (sinon, crée-en une ; ne **jamais** commiter
   sur `main`).
2. Lance d'abord `/review` si ce n'est pas déjà fait sur ce diff. Ne livre pas si un garde-fou
   est en 🔴.
3. `git add` les fichiers pertinents.
4. Commit **en français**, préfixé par l'ID de tâche : `$ARGUMENTS`.
   Termine le message par les lignes de co-auteur attendues par le dépôt.
5. `git push -u origin <branche>` (retries avec backoff si erreur réseau).
6. Ouvre une **PR draft** vers `main` si elle n'existe pas encore (titre = le message de
   commit ; description = résumé + lien backlog + DoD couverte).

La CI validera, puis la PR se mergera seule quand elle sera verte (sauf label `do-not-merge`).
