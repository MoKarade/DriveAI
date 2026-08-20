# DriveAI

> Un Google Drive qui se range tout seul. / *A Google Drive that files itself.*

DriveAI analyse les pièces jointes utiles des mails et les fichiers déposés à la main, les
**renomme** selon une convention stricte (`AAAA-MM-JJ_Type_Émetteur.ext`) et les **classe** dans
une arborescence granulaire — automatiquement, avec une file de revue étroite pour les documents
dont l'analyse ne porte aucun fait exploitable.

**Stack** : moteur **Google Apps Script** (tick périodique) + une **Google Sheet** d'état + une
**app web React/Vite/TS sur Vercel** (`drive.hubperso.com`) + un endpoint serverless qui publie un
résumé au hub perso. Analyse par LLM via l'API Anthropic.

**L'état courant du projet est dans [`HANDOVER.md`](HANDOVER.md)** — il n'est écrit qu'à un seul
endroit, volontairement. Ce README a affirmé « Phase 0, le moteur n'est pas encore construit »
jusqu'au 2026-08-20, alors que le moteur tournait depuis des semaines : un statut recopié dans
plusieurs fichiers rote dans celui qu'on relit le moins.

## Documents de référence

| Fichier | Contenu |
|---------|---------|
| [`HANDOVER.md`](HANDOVER.md) | **État courant du projet** (tenu à jour à chaque session) — à lire en premier pour reprendre |
| [`BACKLOG.md`](BACKLOG.md) | Ce qui est décidé mais pas fait, découpé en tâches avec IDs et statuts |
| [`CLAUDE.md`](CLAUDE.md) | Comment on travaille ici : principes non négociables, conventions, gate, leçons |
| [`PLAN.md`](PLAN.md) | Le plan détaillé : objectif, décisions verrouillées, architecture, phases |
| [`docs/adr/`](docs/adr/) | Les décisions architecturales, `NNNN-slug.md` |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Choix techniques (Apps Script + Sheet + Vercel) |
| [`docs/TAXONOMY.md`](docs/TAXONOMY.md) | L'arborescence cible, les IDs de dossiers, les schémas de sous-dossiers |
| [`docs/NAMING.md`](docs/NAMING.md) | La convention de nommage `AAAA-MM-JJ_Type_Émetteur.ext` |
| [`docs/COUTS.md`](docs/COUTS.md) | Tout ce qui coûte quelque chose, et la ventilation par usage |
| [`docs/DEPLOIEMENT.md`](docs/DEPLOIEMENT.md) · [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Déployer, et quoi faire quand ça casse |
| [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | Le workflow de dev automatisé (auto-merge, agents, boucle de leçons) |
| [`docs/LESSONS.md`](docs/LESSONS.md) | Le journal des leçons apprises pendant le code |

## Le workflow automatisé en bref

1. Claude Code développe sur une branche `claude/**`.
2. Il pousse et ouvre une **PR draft**.
3. La **CI** valide (JSON, scripts, secrets, structure, agents, tests moteur, tests + build app, E2E).
4. La PR **se merge toute seule** (squash) dès que la CI est verte.
   ⚠️ Un draft n'est **pas** un frein : un workflow repasse les PR en « ready ». Le seul mécanisme
   que la CI respecte est le label **`do-not-merge`**.
5. Une **flotte d'agents** relit le code ; une **boucle de leçons** alimente `docs/LESSONS.md`.

Détails dans [`docs/WORKFLOW.md`](docs/WORKFLOW.md).

## Garde-fous (rappel — le texte qui fait foi est [`CLAUDE.md`](CLAUDE.md) §1)

- 🗑️ **Aucune suppression automatique.** Les doublons sont *déplacés* dans `_Doublons`, jamais
  effacés. Unique exception, étroite : un **dossier devenu vide** après une réorg validée, mis à
  la corbeille par l'app au clic de Marc seulement (ADR-0014).
- 🔒 **`04 · Immigration` : réorganisation interne permise, sortie JAMAIS automatique.** Un
  candidat à la sortie est *proposé*, jamais déplacé d'office.
- 🔑 **Moindre privilège.** Scopes déclarés dans `appsscript.json`, verrouillés par tripwire CI.
  Gmail en `gmail.modify` depuis ADR-0012 (poser un libellé existant, archiver — rien d'autre) ;
  toute suppression Gmail reste interdite à jamais.
- 🔐 **Aucun secret en dur.** Les clés vivent dans les Script Properties et les variables Vercel.
- 💸 **Budget LLM < 10 $/mois en régime de croisière.** Les campagnes de rattrapage sont un coût
  one-shot, plafonné par le frein `CONFIG.LLM_BUDGET_CAMPAGNES` — c'est `Config.gs` qui fait foi,
  pas cette ligne.
