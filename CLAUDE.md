# CLAUDE.md — DriveAI

<!-- Court exprès (modeles/claude-md : 60 lignes, 10 Ko). Le texte complet de l'ancien fichier (1784 lignes, 163 Ko) est dans docs/claude/ ; « CLAUDE.md §N » dans le code, les tests et les ADR
     = docs/claude/NN-*.md (numérotation inchangée : §1 = garde-fous, §9 = leçons, §11 = protocole). Dépôt PUBLIC : rien de personnel ni de secret ici. -->

## Contexte
- **DriveAI** range Google Drive tout seul : pièces jointes utiles des mails et fichiers déposés sont analysés par un LLM, renommés selon une convention stricte, classés dans une arborescence granulaire ; une file de revue pour les cas incertains.
- Stack : Google Apps Script (moteur, `src/*.gs`, déployé par clasp) + une Google Sheet (état) + app web React/Vite/TS sur Vercel (`app/`). LLM via l'API Anthropic ; le modèle qui fait foi est `CONFIG`.
- Dépôt PUBLIC, branche par défaut `main` ; chaque merge déploie le moteur chez Marc (`deploy.yml`). Marc valide, il ne code pas.
- État : `HANDOVER.md` (à lire en premier) ; plan : `PLAN.md` et `BACKLOG.md` ; décisions : `docs/`.

## Commandes standard
- `npm test` (racine) : filet de tests du moteur (`node --test`, zéro dépendance). Dans `app/` : `npm run dev`, `npm run build`, `npm run typecheck`, `npm run test`, `npm run portes`.
- `bash .github/scripts/secret-scan.sh .` : scan de secrets ; `bash .github/scripts/check-structure.sh .` : fichiers de référence présents.
- Commandes des agents : `/phase`, `/review`, `/lesson`, `/handover`, `/ship` (`docs/claude/04-commandes.md`).

## Règles propres à DriveAI (garde-fous : `docs/claude/01-principes.md`, §1)
- **Documents sensibles : classés, jamais supprimés ni détachés** ; revue ultra-stricte seulement. **Aucune suppression automatique** (doublons écartés dans `_Doublons`, déplacement seul).
- **Moindre privilège** : scopes déclarés dans `appsscript.json`, Gmail en lecture seule tant que la constitution ne dit pas le contraire. **Aucun secret en dur** (Script Properties).
- **Idempotence** : un fichier déjà traité ne l'est pas deux fois. Budget LLM < 10 $/mois ; le coût publié au hub est le CUMUL.
- **No fake data** ; une modification du routage ou du tri suit le protocole de précision (`docs/claude/11-protocole-de-precision.md`).
- Après un merge : vérifier le **déploiement**, pas seulement la CI (`docs/claude/06-deploiement.md`). Les leçons durables : `docs/claude/lecons.md` (§9).

## Git et CI
- Branches `claude/<slug>` ; PR en brouillon pour itérer ; commits en français, préfixés ; jamais `--force` sur `main`, jamais `--no-verify`. **`gh pr create --base main` TOUJOURS explicite.**
- L'auto-merge ne fusionne jamais une PR qui touche `.github/**`, le moteur (`src/**`, `*.gs`), clasp, les instructions des agents ou `vercel.json` (`.github/scripts/garde-chemins.mjs`).
- Un check requis n'a JAMAIS de `paths:`. Ne jamais ajouter un déclencheur `pull_request` à `auto-merge.yml`.

## Pour aller plus loin (à lire seulement si nécessaire)
- Index généré : `docs/INDEX.md` ; anciens titres -> chemins : `docs/correspondance.md`.
- Sections de l'ancien fichier : `docs/claude/` (`01-principes`, `02-conventions`, `03-workflow-git`, `04-commandes`, `05-verifications`, `06-deploiement`, `07-hub`, `08-documentation`,
  `10-style-compte-rendu`, `11-protocole-de-precision`). Leçons apprises : `docs/claude/lecons.md`.
- Coûts : minutes Actions (gratuites, dépôt public) `docs/couts-ci.md` ; coûts LLM `docs/COUTS.md`. Rattachement : `docs/rattachement.md`.
