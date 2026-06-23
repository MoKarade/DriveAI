---
description: Régénère HANDOVER.md à partir de l'état courant du projet
allowed-tools: Bash(git log:*), Bash(git status), Bash(git diff:*)
---

Mets à jour **`HANDOVER.md`** pour qu'il reflète l'état courant du projet.

Contexte utile :
!`git log --oneline -8`

Procédure :
1. Relis `HANDOVER.md`, `BACKLOG.md` (statuts) et les derniers commits.
2. Réécris `HANDOVER.md` en gardant sa structure :
   - **Dernière mise à jour** : date du jour + une ligne de contexte.
   - **TL;DR**, **Avancement par phase** (aligné sur `BACKLOG.md`), **Décisions actées**,
     **Ce qui reste à faire côté Marc**, **Blocages/risques connus**, **Comment reprendre**,
     **Historique des sessions** (ajoute une entrée datée pour cette session).
3. Mets aussi à jour `BACKLOG.md` si des statuts ont changé.
4. Reste concis et factuel : `HANDOVER.md` doit permettre de reprendre le projet sans contexte.

N'invente rien : si une info manque, écris-la comme « à confirmer ».
