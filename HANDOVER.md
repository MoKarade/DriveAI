# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **Dernière mise à jour : 2026-06-23** — fin Phase 1 (moteur mergé), avant déploiement Google.

---

## 1. TL;DR (où on en est)

- **Phase 0** (scaffolding & automatisation) : ✅ mergée.
- **Phase 1** (le cœur : Gmail → analyse → classement) : ✅ codée, revue par la flotte, mergée sur `main`.
- **Automatisation live** : CI + auto-merge (PR `claude/**` verte → squash auto), `CLAUDE.md`
  auto-évolutif, 8 agents, boucle de leçons.
- **Bloqueur actuel** : rien côté code. **DriveAI ne tourne pas encore** : il reste le
  déploiement côté Google (voir §4 et `docs/DEPLOIEMENT.md`).
- **Prochaine étape produit** : déployer la Phase 1, la valider en réel, puis **Phase 2**.

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | ⬜ à faire |
| 3 | Tâches & agenda (Tasks/Calendar) | ⬜ à faire |
| 4 | Recherche + dashboard (app web Vercel) | ⬜ à faire |

Détail des tâches : `BACKLOG.md`.

## 3. Décisions actées (ne pas re-litiger)

- **Legacy = Option A** : l'ancien Drive va dans un dossier `_Archive 2025` à part ; DriveAI n'y touche jamais.
- **Gmail lecture seule** → idempotence portée par l'`Index` (clé `messageId|i|nom|taille`), **pas** de label Gmail.
- **Merge** : auto-merge des PR `claude/**` dès que la CI est verte (pas de revue humaine bloquante).
- **Modèles LLM** : Haiku par défaut (`claude-haiku-4-5`), Sonnet en fallback (`claude-sonnet-4-6`).
- **Scopes** : `gmail.readonly`, `drive`, `script.external_request`, `spreadsheets`,
  `script.send_mail` (notif), `script.scriptapp` (trigger). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc (avant que ça tourne)

> Étapes détaillées : **`docs/DEPLOIEMENT.md`**.

1. **Déployer** `src/` dans un projet Apps Script (clasp `clasp push`, ou copier-coller).
2. **Clé API** : Script Properties → `DriveAI_ANTHROPIC_KEY` = ta **nouvelle** clé Anthropic.
3. **Activer le service avancé Drive** (API v2) dans l'éditeur (pour l'OCR).
4. Exécuter **`installerTrigger()`** une fois (autorise les scopes) → scan toutes les 15 min.
5. **Tester** avec un mail + PJ (voir `docs/DEPLOIEMENT.md` §Tester).
6. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise).
7. *(Open point `P1-09`)* mesurer le coût LLM réel pour confirmer < 10 $/mois.

## 5. Blocages / risques connus

- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.

## 6. Comment reprendre

- `/phase 2` — démarrer la phase suivante avec discipline de scope.
- `/review` — passer un diff à la flotte d'agents.
- `/lesson "…"` — consigner une leçon.
- `/handover` — régénérer ce fichier à partir de l'état courant.
- `/ship` — commit + push + PR draft.

## 7. Historique des sessions

- **2026-06-23** — Session initiale : scaffolding & automatisation (PR #1, mergée) ; Phase 1
  complète, revue par la flotte et corrigée (PR #2, mergée) ; mise en place des documents
  vivants (HANDOVER, déploiement) et de leur tenue à jour.
