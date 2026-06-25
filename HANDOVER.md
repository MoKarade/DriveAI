# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **Dernière mise à jour : 2026-06-25** — **Phase 2 codée** (dépôt manuel `00·À trier` + référentiel
> d'entités), revue par la flotte (correctifs appliqués). Phase 1 validée en réel ; correctif OCR REST
> mergé (PR #10). Reste à Marc : `git pull && clasp push` pour déployer la Phase 2.

---

## 1. TL;DR (où on en est)

- **Phase 0** (scaffolding & automatisation) : ✅ mergée.
- **Phase 1** (le cœur : Gmail → analyse → classement) : ✅ codée, revue par la flotte, mergée sur `main`.
- **Automatisation live** : CI + auto-merge (PR `claude/**` verte → squash auto), `CLAUDE.md`
  auto-évolutif, 8 agents, boucle de leçons.
- **DriveAI tourne** : déployé dans Apps Script chez Marc, validé end-to-end le 2026-06-23
  (~25 docs traités : Gmail → OCR → LLM → routage → Index/Revue ; idempotence/nommage confirmés).
- **Recalibrage appliqué** : le 1er run marquait presque tout `sensible` → tout en revue. Le
  prompt vise désormais la zone protégée stricte (immigration + fiscal) ; le reste s'auto-classe.
- **Phase 2 codée** : seconde source d'intake (`00·À trier`, fichiers **déplacés** jamais copiés),
  routage à l'**entité** via le référentiel `Entités` (colonnes + `Statut` auto-réparées), entité
  inconnue → ligne `en_attente` pré-remplie + revue, création des dossiers d'entité + sous-dossiers
  fixes après validation (Statut = « validée »), multi-entités en raccourcis Drive, doublons signalés
  (empreinte MD5). Modules ajoutés : `Entites.gs`, `Intake.gs`, `Pipeline.gs`, `DriveRest.gs`.
- **Prochaine étape produit** : Marc déploie (`git pull && clasp push`), teste le dépôt manuel et la
  validation d'entité, puis **Phase 3**. *(Rappel : ce conteneur n'a pas accès au projet Apps Script
  de Marc — déploiement et exécution se font dans son compte Google.)*

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | 🟦 codée (revue flotte), à déployer |
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

## 4. Ce qui reste à faire côté Marc

> Déploiement initial **fait** (clasp push + clé + trigger). Reste :

1. **Déployer la Phase 2** : `git pull && clasp push`. Aucun nouveau scope à autoriser
   (DriveRest réutilise `drive` + `script.external_request`).
2. **Tester le dépôt manuel** : glisser un fichier dans `00 · À trier`, lancer `tickDriveAI` →
   il doit être **déplacé** (pas copié) vers son dossier, ou vers `00·À vérifier` si revue.
3. **Tester la validation d'entité** : pour une ligne `en_attente` de l'onglet `Entités`, passer
   son `Statut` à `validée` (corriger le nom si besoin) → au tick suivant ses dossiers se créent
   et les docs de cette entité s'y rangent.
4. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
5. *(Open point `P1-09`)* mesurer le coût LLM réel pour confirmer < 10 $/mois.

## 5. Blocages / risques connus

- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.
- **Phase 2, limites assumées** (relevées par la flotte, non bloquantes) : (a) un document en échec
  LLM/placement persistant est re-OCRisé + re-classé à **chaque** tick (pas de quarantaine après N
  échecs → coût) ; (b) la **copie Gmail** et les **raccourcis multi-entités** ne sont pas idempotents
  au rejeu (un rejeu après coupure entre placement et Index peut dupliquer le fichier/raccourci — c'est
  le compromis « Index en dernier ») ; (c) la **file de revue = le dossier** `00·À vérifier` : un dépôt
  routé en revue est bien dans le dossier même si une coupure empêche la ligne `Revue`/`Index`.

## 6. Comment reprendre

- `/phase 2` — démarrer la phase suivante avec discipline de scope.
- `/review` — passer un diff à la flotte d'agents.
- `/lesson "…"` — consigner une leçon.
- `/handover` — régénérer ce fichier à partir de l'état courant.
- `/ship` — commit + push + PR draft.

## 7. Historique des sessions

- **2026-06-25 (Phase 2)** — Codé le **dépôt manuel** (`Intake.gs`, scan `00·À trier`, fichiers
  déplacés via Drive REST) et le **référentiel d'entités** (`Entites.gs` : cache 1×/run, résolution
  insensible casse/accents, lignes `en_attente` auto-remplies, création des dossiers d'entités
  validées + sous-dossiers fixes). Pipeline unifié Gmail+dépôt (`Pipeline.gs`), routage à l'entité
  (`Router.gs`), raccourcis multi-entités + doublons (empreinte MD5). Revue par la flotte (7 agents) :
  correctifs appliqués — `rejouerLaRevue` ne corbeille plus un original déposé (le renvoie en
  `00·À trier`), garde-temps + plafond sur la création de dossiers, empreinte bornée par la taille,
  clé d'idempotence `drive|fileId`, garde « sous-dossier hors schéma », retry Drive REST.
- **2026-06-25** — Correctif **OCR** : le 1er run réel échouait sur chaque doc
  (`Drive is not defined`, service avancé inactif après `clasp push`). Réécriture de `src/Ocr.gs`
  pour appeler l'**API Drive en REST via `UrlFetchApp`** (token OAuth, scope `drive` déjà accordé),
  dégradation propre si échec. Mergé (PR #10). Reste à Marc : `git pull && clasp push`.
- **2026-06-23 (suite)** — Phase 1 **déployée** par Marc (clasp) et **validée en réel** ;
  recalibrage du flag `sensible` (trop large → immigration + fiscal seulement) ; documents vivants
  (HANDOVER, DEPLOIEMENT) + tenue à jour automatique mis en place.
- **2026-06-23** — Session initiale : scaffolding & automatisation (PR #1, mergée) ; Phase 1
  complète, revue par la flotte et corrigée (PR #2, mergée) ; mise en place des documents
  vivants (HANDOVER, déploiement) et de leur tenue à jour.
