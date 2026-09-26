# Correspondance des anciens titres

L'ancien `CLAUDE.md` (1784 lignes, 163 Ko) a été découpé dans `docs/claude/` : le `CLAUDE.md` d'entrée fait maintenant moins de 60 lignes. La numérotation `§N` (utilisée par plus de 500 renvois du code, des tests et des ADR) est INCHANGÉE : « CLAUDE.md §N » se lit dans le fichier ci-dessous.
Seuls 4 passages personnels ont été sortis du dépôt public (remplacés par une ligne neutre, voir `docs/couts-ci.md` section Exceptions) ; le reste est déplacé sans changement.
`node .github/ci/generer-index.mjs --verifier` échoue si un chemin n'existe plus.

| ancien titre | nouveau chemin |
|---|---|
| CLAUDE.md, introduction (contexte, stack, correspondance des numéros) | docs/claude/00-introduction.md |
| CLAUDE.md § 1. Principes non négociables (garde-fous) | docs/claude/01-principes.md |
| CLAUDE.md § 2. Conventions de code | docs/claude/02-conventions.md |
| CLAUDE.md § 3. Workflow git (dont NotebookLM abandonné) | docs/claude/03-workflow-git.md |
| CLAUDE.md § 4. Commandes utiles | docs/claude/04-commandes.md |
| CLAUDE.md § 5. Vérifications avant commit | docs/claude/05-verifications.md |
| CLAUDE.md § 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI | docs/claude/06-deploiement.md |
| CLAUDE.md § 7. Intégration hub (widget DriveAI sur hubperso.com) | docs/claude/07-hub.md |
| CLAUDE.md § 8. Documentation (où vit quoi) | docs/claude/08-documentation.md |
| CLAUDE.md § 9. Leçons apprises (règles durables) | docs/claude/lecons.md |
| CLAUDE.md § 10. Style et compte-rendu | docs/claude/10-style-compte-rendu.md |
| CLAUDE.md § 11. Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri) | docs/claude/11-protocole-de-precision.md |
