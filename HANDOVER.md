# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **Dernière mise à jour : 2026-06-30** — **Phase 2 terminée + full auto confirmé en prod** ; **Phase 3
> en cours**. P2.1→P2.6 (entité, full auto, seuil 0.50, tick 10 min, escalade, grand rangement) +
> **P2.7** : rangement étendu à l'ancien Drive (« Ancienne structure ») + garde-fou OCR vide (un dépôt
> sans texte exploitable part en revue plutôt que d'être classé sur le seul nom de fichier). Les **2
> secrets GitHub sont posés** (déploiement auto confirmé par des runs réels) — **plus rien à faire côté
> secrets**. Phase 3 (remplacement de l'agent mail externe de Marc : tâches/agenda auto) en construction.

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
- **Full auto (P2.2)** : Action GitHub **Deploy** (`clasp push` auto sur merge `main`, via secrets
  `CLASPRC_JSON`/`SCRIPT_ID`) + **auto-rejeu** sur bump de `CONFIG.VERSION` (renvoie les dépôts en
  revue vers `00·À trier`, borné/réversible). Après le réglage unique des 2 secrets, Marc ne fait plus
  ni `clasp push` ni `rejouerLaRevue`. **Validé en réel le 2026-06-26** (auto-déploiement + auto-rejeu
  ont reclassé 5 dépôts sans intervention).
- **P2.3** : `SEUIL_CONFIANCE` abaissé **0.80 → 0.50** (sur demande de Marc) ; l'auto-rejeu reprend
  désormais aussi les `[REVUE] confiance …` (2e passe, déplacement seul). La zone protégée
  (`[REVUE] sensible`) n'est **jamais** reprise (garde-fou §1) : passeports/immigration/fiscal restent
  en revue par conception.
- **P2.5 (escalade)** : la confiance basse n'envoie plus en revue — elle déclenche une **analyse
  approfondie** (Sonnet ×3, consensus de domaine) puis le doc est **classé au meilleur endroit**.
  Seuls restent en revue : zone protégée + domaine introuvable. Coût borné (plafond d'escalades/run,
  fallback simple sur échec Haiku, docs sensibles non escaladés). Revue flotte 🟢 (sécurité + coût).
- **fix CI/CD** : l'auto-déploiement était muet (merge bot ne déclenche pas `on: push` ; clasp casse en
  Node 22). Réparé : auto-merge **dispatche** Deploy ; Node 20. **Vérifier les runs de l'Action Deploy.**
- **P2.6 (grand rangement auto)** : sur demande de Marc (« tout mon Drive reclassé/renommé/au bon
  endroit »), un rangement initial **zéro clic** gated par `CONFIG.RANGEMENT_TAG` renvoie au fil des ticks
  tout le contenu « en vrac » (nom non `AAAA-MM-JJ_`) des domaines NON protégés vers `00·À trier` ; le
  pipeline le reprend (OCR → analyse approfondie → renommage → classement, sous-dossiers créés au besoin).
  Borné (`RANGEMENT_MAX_PAR_RUN` + garde-temps), reprenable (tag figé seulement quand une passe ne collecte
  plus rien), **déplacement seul** (aucune corbeille), et **zone protégée écartée** même pour un fichier
  multi-parents (garde un parent dans `04 · Immigration` ⇒ jamais détaché). Re-audité flotte 🟢 (sécurité
  BLOQUANT levé + garde-temps). `_Archive 2025` non concernée. Lançable aussi à la main (`rangerToutLeDrive`).
- **P2.7 (ancien Drive + garde-fou OCR vide)** : Marc a désigné son vrai « ancien Drive » — le dossier
  racine **« Ancienne structure »** (pas `_Archive 2025`, qui n'existe pas chez lui). Branché sur le
  grand rangement via `CONFIG.RANGEMENT_RACINES_SUP` (tag `r2`). Un audit sécurité a détecté un trou
  réel : un vieux scan à nom neutre (`IMG_2734.jpg`) dont l'OCR échoue pouvait recevoir `sensible=false`
  sans aucun signal et être classé auto — violation potentielle du garde-fou §1 sur un passeport/doc
  fiscal. Corrigé : tout DÉPÔT (manuel ou rangement — jamais une PJ Gmail, qui garde expéditeur/sujet)
  dont l'extrait OCR fait moins de `CONFIG.OCR_MIN_CARS_EXPLOITABLE` (20) caractères part en revue
  (« sensibilité indéterminable (OCR vide) »), priorité la plus haute dans `motifDeRevue_`. Re-audité
  flotte 🟢 (security-auditor CONFORME, file-checker : pas de sur-blocage, seuil raisonnable).
- **Secrets déploiement déjà posés.** Les 2 secrets GitHub (`CLASPRC_JSON`, `SCRIPT_ID`) sont **déjà
  configurés** côté Marc — confirmé par des runs `Deploy` réels (`clasp push` réussi, code visible en
  prod). Le tableau « reste à faire » ci-dessous est mis à jour en conséquence : **rien côté secrets**.
- **Phase 3 démarrée** : remplacer l'agent externe de Marc (mails → PJ utiles → tri + tâches/agenda) par
  DriveAI nativement. Décisions actées avec Marc : scan de **tous** les mails récents (pas seulement avec
  PJ) avec **pré-filtre** (mots-clés + mini-check Haiku) pour le budget ; **filtre d'utilité** des PJ ;
  **échéance → Google Tasks**, **rdv daté → Google Calendar** ; **création 100 % auto** (zéro validation) ;
  liste Tasks par défaut + agenda principal. Plan détaillé (product-manager) : 5 PR ordonnées (scopes+REST
  → pré-filtre/volume → extraction LLM+routage → idempotence Tasks/Calendar → docs). **Seule action
  manuelle de Marc à venir : une ré-autorisation Google unique** (nouvel écran de consentement après
  l'ajout des scopes Tasks/Calendar).

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | 🟦 codée (revue flotte), à déployer |
| 3 | Tâches & agenda (Tasks/Calendar) | 🟦 en cours |
| 4 | Recherche + dashboard (app web Vercel) | ⬜ à faire |

Détail des tâches : `BACKLOG.md`.

## 3. Décisions actées (ne pas re-litiger)

- **Legacy révisé (2026-06-30)** : la décision initiale « Option A » supposait un dossier `_Archive 2025`
  qui n'existe pas chez Marc — son ancien Drive est en fait la racine **« Ancienne structure »**. Sur
  demande explicite de Marc (« classe tout mon ancien drive »), elle est désormais INCLUSE dans le grand
  rangement auto (`CONFIG.RANGEMENT_RACINES_SUP`), avec le garde-fou OCR-vide renforcé (cf. P2.7 ci-dessus).
- **Gmail lecture seule** → idempotence portée par l'`Index` (clé `messageId|i|nom|taille`), **pas** de label Gmail.
- **Merge** : auto-merge des PR `claude/**` dès que la CI est verte (pas de revue humaine bloquante).
- **Modèles LLM** : Haiku par défaut (`claude-haiku-4-5`), Sonnet en fallback (`claude-sonnet-4-6`).
- **Scopes** : `gmail.readonly`, `drive`, `script.external_request`, `spreadsheets`,
  `script.send_mail` (notif), `script.scriptapp` (trigger). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc

> Objectif **full auto**. Les secrets de déploiement sont posés — il ne reste qu'une ré-autorisation
> à venir (Phase 3) et deux rappels de fond.

1. **Phase 3 (à venir, une fois)** : l'ajout des scopes Google Tasks/Calendar va déclencher un **nouvel
   écran de consentement Google** au prochain déploiement. Une seule ré-autorisation (un clic) sera
   nécessaire — DriveAI ne peut pas le faire à sa place (frontière d'exécution). Sera annoncé clairement
   le moment venu, avec une fonction « un clic » dédiée si possible.
2. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
3. *(Open point `P1-09`)* mesurer le coût LLM réel pour confirmer < 10 $/mois.

> Steady-state désormais **100 % automatique** : nouveaux mails + dépôts traités par le trigger 10 min ;
> mes changements de code déployés par l'Action ; reclassement après recalibrage par l'auto-rejeu.
> Le `rejouerLaRevue` manuel reste dispo (c'est le seul endroit qui met des copies Gmail à la corbeille).

## 5. Blocages / risques connus

- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.
- **Cadence 10 min & quota (audit)** : les comptes Gmail grand public ont ~90 min/jour de temps de
  déclencheur. À 10 min (144 ticks/j), la plupart sont des no-op, mais ~20 runs « pleins » (jusqu'au
  garde-temps `BUDGET_MS` 4.5 min) suffiraient à l'épuiser. Volume perso de Marc → marge large. Si une
  journée chargée coupe les triggers, revenir à `TICK_MINUTES: 15` ou baisser `BUDGET_MS` (reprise au
  tick suivant déjà en place). Le déclencheur se ré-installe seul au déploiement (création avant purge).
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

- **2026-06-30 (P2.7 ancien Drive + démarrage Phase 3)** — Diagnostiqué un blocage de pipeline CI/CD
  (GitHub Actions muet 26-27/06, puis branche en conflit avec `main` bloquant la CI sur la PR) → résolu
  (fusion `-s ours`, conflits de docs/squash réconciliés), PR #19 (P2.5+P2.6) mergée et déployée en prod
  avec vérification run-par-run (pas seulement « ça devrait marcher »). **P2.7** : ancien Drive de Marc
  identifié (« Ancienne structure », pas `_Archive 2025`) et branché sur le grand rangement
  (`RANGEMENT_RACINES_SUP`, tag `r2`) ; audit sécurité a détecté un trou (OCR vide → `sensible=false`
  sans signal → classement auto d'un possible passeport/doc fiscal) → corrigé par un garde-fou dédié
  (dépôt + OCR non exploitable → revue forcée), re-audité 🟢 par security-auditor et file-checker (pas
  de sur-blocage). **Démarrage Phase 3** : Marc veut remplacer son agent mail externe ; décisions actées
  (scan tous mails + pré-filtre coût, filtre utilité PJ, Tasks vs Calendar, création 100 % auto) ; plan en
  5 PR produit par le product-manager.
- **2026-06-27 (P2.5 escalade + P2.6 grand rangement)** — **P2.5** : la confiance basse ne part plus en
  revue → `analyseApprofondie_` (Sonnet ×3, consensus de domaine puis confiance max), classé au meilleur
  endroit ; fallback Sonnet simple sur échec Haiku total (anti-boucle de coût), plafond d'escalades/run,
  docs sensibles jamais escaladés. **P2.6** : `rangerToutLeDrive`/`rangerUnePage_` + hook auto
  `appliquerRangementInitial_` (gated `CONFIG.RANGEMENT_TAG`) renvoient au fil des ticks tout le « vrac »
  des domaines vers `00·À trier`. Garde-fous re-audités par la flotte : **sécurité** — un fichier ayant un
  parent dans (ou sous) `04 · Immigration` est écarté à la collecte ET re-vérifié avant tout déplacement
  (`aParentProtege_`/`chaineMonteVersProtege_`), jamais détaché de la zone protégée (BLOQUANT initial levé) ;
  **garde-temps** — collecte récursive bornée + try/catch → `notifierEchec_`, amorce `tickDriveAI()` seulement
  s'il reste du budget (anti-dépassement des 6 min). Convergence garantie : le pipeline renomme toujours en
  `AAAA-MM-JJ_` → jamais re-collecté (idempotent).
- **2026-06-25 (P2.2 — full auto)** — **Auto-déploiement** : Action `Deploy` (`.github/workflows/deploy.yml`,
  `clasp push` sur merge `main`, secrets `CLASPRC_JSON`/`SCRIPT_ID`, inactive sans secrets). **Auto-rejeu** :
  `CONFIG.VERSION` + `appliquerRejeuSiNouvelleVersion_`/`rejeuAutoDesDepots_` renvoient les dépôts partis
  en revue vers `00·À trier` sur bump de version — chirurgical (dépôts `drive|…` seulement, par `fileId`),
  réversible (aucune corbeille), borné (`REJEU_PAGE` + garde-temps), reprenable. Re-audité par la flotte
  (sécurité + quotas) après un 1er design jugé dangereux (corbeille + vidage Index en auto) → corrigé.
- **2026-06-25 (P2.1)** — Calibration : entité non validée → classée au domaine (pas en revue).
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
