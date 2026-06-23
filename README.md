# DriveAI

> Un Google Drive qui se range tout seul. / *A Google Drive that files itself.*

DriveAI analyse les pièces jointes utiles de tes mails et les fichiers déposés à la main,
les **renomme** selon une convention stricte et les **classe** dans une arborescence
granulaire — automatiquement, avec une file de revue pour les cas incertains.

**Statut : Phase 0 — scaffolding & automatisation.** Le moteur n'est pas encore construit.

## Documents de référence

| Fichier | Contenu |
|---------|---------|
| [`HANDOVER.md`](HANDOVER.md) | **État courant du projet** (tenu à jour à chaque session) — à lire en premier pour reprendre |
| [`PLAN.md`](PLAN.md) | Le plan détaillé : objectif, décisions verrouillées, architecture, 4 phases, garde-fous |
| [`BACKLOG.md`](BACKLOG.md) | Les épopées (phases 1–4) découpées en tâches avec IDs et statuts |
| [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) | Déploiement du moteur côté Google, étape par étape |
| [`CLAUDE.md`](CLAUDE.md) | Mémoire de projet pour Claude Code (garde-fous, conventions, workflow) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Choix techniques (Apps Script + Sheet + Vercel) |
| [`docs/TAXONOMY.md`](docs/TAXONOMY.md) | L'arborescence cible, les IDs de dossiers, les schémas de sous-dossiers |
| [`docs/NAMING.md`](docs/NAMING.md) | La convention de nommage `AAAA-MM-JJ_Type_Émetteur.ext` |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | Le workflow de dev automatisé (auto-merge, agents, boucle de leçons) |
| [`docs/LESSONS.md`](docs/LESSONS.md) | Le journal des leçons apprises pendant le code |

## Le workflow automatisé en bref

1. Claude Code développe sur une branche `claude/**`.
2. Il pousse et ouvre une **PR draft**.
3. La **CI** valide (JSON, scripts, secrets, structure, agents).
4. La PR **se merge toute seule** (squash) dès que la CI est verte — sauf label `do-not-merge`.
5. Une **flotte d'agents** analyse le code ; une **boucle de leçons** met `CLAUDE.md` à jour.

Détails dans [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Garde-fous (rappel)

- 🔒 **Zone protégée** : immigration & fiscal jamais rangés auto.
- 🗑️ **Aucune suppression auto** : doublons signalés, jamais effacés.
- 🔑 **Moindre privilège** : Gmail lecture seule, aucun secret en dur.
- 💸 **Budget LLM < 10 $/mois**.

## Démarrer la Phase 1

Voir [`PLAN.md`](PLAN.md) §8 et [`BACKLOG.md`](BACKLOG.md) (épopée Phase 1).
