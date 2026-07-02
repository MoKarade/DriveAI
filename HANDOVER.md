# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **Dernière mise à jour : 2026-07-01 (soir)** — **BRAINSTORM PRODUIT COMPLET → dossier de conception (8 ADR).**
> Session de conception « niveau pro » avec Marc : **8 ADR** (`docs/adr/0001`→`0008`), **roadmap priorisée à
> 9 chantiers** (`docs/ROADMAP.md`), runbook (`docs/RUNBOOK.md`) et guide (`docs/GUIDE.md`). Socle #1 =
> **fondation testable** (logique pure isolée des appels Google + filet de tests CI + Journal borné/onglet
> `Santé`, ADR-0006). Décisions clés : sources = **fichiers partagés** (0005) ; vie privée = **métadonnées
> seulement dans l'état** — *vérifié sur le code*, aucun corps de doc stocké (0007) ; app web Phase 4 =
> recherche/dashboard/corrections, login Google, plein texte via l'index natif Drive (0008). **Prochain pas
> concret : implémenter le chantier #1** (fondation testable). ⚠️ Rien de tout ça n'est encore CODÉ — les ADR
> décrivent la CIBLE. **Le grand rangement de l'ancien Drive tourne toujours en fond** (vivant, vérifié par
> signaux Drive : fichiers renommés/déplacés en continu). Antérieur ce jour : **PLUS DE FILE DE REVUE : un
> seul dossier d'arrivée + nom final
> direct** (P1-16, décision Marc « je veux juste un dossier ; le nom attribué doit être direct le dernier » :
> `00 · À vérifier` supprimé du pipeline, TOUT classé au mieux avec nom propre, domaine introuvable →
> `DOMAINE_DEFAUT` ; barre fiabilisée via recensement léger + « recensement en cours » visible dès le 1ᵉʳ tick ;
> `VERSION` P3.0). Marc peut supprimer à la main le dossier vide `00 · À vérifier`. Antérieur : P1-14 (sensibles
> auto-classés), P1-15 (rangement TÔT gated file-basse + barre `[███░░░] N %`, `RANGEMENT_TAG` r1→r2), Phase 2 +
> full auto en prod, Phase 3 codée. Les **2 secrets GitHub sont posés** — rien côté secrets. **Reste côté Marc
> pour Phase 3 : une ré-autorisation Google unique** (scopes Tasks/Calendar) au prochain déploiement.
>
> 🔴 **P1-17 (fix majeur, diagnostic prod)** : « le moteur ne range plus rien / est muet » n'était PAS le
> déclencheur (il tournait, mais à vide). VRAIE cause : la collecte du rangement (`aParentProtege_`→`getParents()`)
> LEVAIT une exception sur « Ancienne structure » (racine `0AKPYZ…`, Drive partagé) → 0 fichier collecté → le
> code prenait `collectes===0` pour « TERMINÉ » et FIGEAIT le rangement (`DriveAI_RANGEMENT` posé) → tous les
> ticks suivants sautaient le rangement. Fix : walk parent-protégé défensif (détection positive, jamais
> d'exception propagée), collecte par-fichier enveloppée, une collecte en erreur ⇒ `reste=true` (jamais un
> faux « terminé »), `RANGEMENT_TAG` r2→r3 (relance). **Après déploiement P1-17 : faire tourner 1 tick** (auto
> ~10 min, ou `tickDriveAI` à la main pour l'immédiat) puis vérifier par signaux Drive que « Ancienne structure »
> se vide et que les domaines se remplissent de `AAAA-MM-JJ_`. NB : le déclencheur EST sain (il firait à vide
> car le rangement était figé « terminé ») — pas besoin de re-`installerTrigger`.

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
- **fix-pipeline (file `00·À trier` gelée)** : `appliquerRangementInitial_` tournait AVANT l'intake et
  SANS try/catch → un plantage de sa collecte gelait tout le tick (Gmail + dépôts + intentions sautés) →
  ~20 fichiers stagnaient des heures dans `00·À trier`. Corrigé : maintenance auto (rejeu, rangement)
  **enveloppée de try/catch**, et on **DRAINE (Gmail+dépôts) AVANT d'ALIMENTER** (rangement passe après,
  si budget). Vérifié en prod par recherche Drive : la file s'est vidée après déploiement.
- **P1-13 (lecture des fichiers Office)** : diagnostic prod (recherche Drive) — les `.docx`/`.ppt` de Marc
  (CV, TP, présentations) partaient TOUS en revue « sensibilité indéterminable (OCR vide) » car `Ocr.gs` ne
  lisait que text/PDF/images ; un `.docx` → texte vide → garde-fou OCR-vide → revue. Corrigé : `extraireTexte_`
  convertit désormais Word/PowerPoint/Excel en Google natif (Docs/Slides/Sheets, conversion sans OCR) → vrai
  texte → classés correctement. `VERSION` bumpée **P2.5 → P2.8** ⇒ re-tri auto de la revue existante (Office
  classés, vieux `[REVUE] doublon` → `_Doublons`, sensibles re-détectés → revue). Re-audité flotte 🟢.
- **Décision en attente (Marc, 2026-07-01) :** auto-classer AUSSI les docs **sensibles** (immigration/fiscal)
  ? Marc l'a demandé, mais l'essentiel de sa frustration (CV/TP) venait du bug Office, pas du garde-fou §1.
  Recommandation faite : garder le filet §1 sur immigration/fiscal uniquement. **En attente de sa confirmation**
  avant de toucher au garde-fou NON NÉGOCIABLE §1.
- **Phase 3 codée** (remplace l'agent mail externe de Marc). Scan de **tous** les mails récents
  (pas seulement avec PJ, `GMAIL_REQUETE_ACTIONS`) → pré-filtre 3 étages (mots-clés gratuit → zone
  protégée gratuit, défense en profondeur indépendante du LLM → mini-check Haiku ~10 tokens) →
  extraction d'intentions LLM (`PROMPT_INTENTIONS`) → routage **échéance → Google Tasks**, **rdv
  daté → Google Calendar**, création **100 % auto** (zéro validation), liste Tasks par défaut +
  agenda principal. Nouveaux fichiers : `GoogleApi.gs`, `Tasks.gs`, `Calendar.gs`, `Prefiltre.gs`,
  `Intentions.gs`. Idempotence à 2 niveaux (message + intention) ; ID client Calendar déterministe
  par `(messageId, contenu)` (rejeu après coupure → 409 = succès, jamais de doublon) ; risque
  résiduel documenté sur les tâches (Tasks API sans ID client, même compromis que la copie Gmail).
  **Re-audité par la flotte (4 spécialistes, 2 passes)** : sécurité 🟢, coût LLM 🟢 (~1-4 $/mois
  estimé), idempotence 🟢, quotas — 1er passage **BLOQUANT** (pagination par offset numérique
  stagnait au-delà de ~200 messages sur une fenêtre Gmail mouvante : un nouveau mail en tête décale
  tous les offsets, donc redémarrer à 0 chaque tick ne progressait jamais dans l'historique), corrigé
  par un scan à deux voies (avant : offset 0, capte le mail neuf ; arrière : date absolue persistée,
  insensible aux décalages d'offset), 2e passage 🟢 CONFORME. **Seule action manuelle de Marc à
  venir : une ré-autorisation Google unique** (nouvel écran de consentement après l'ajout des scopes
  Tasks/Calendar) — cf. `docs/DEPLOIEMENT.md` § Phase 3.

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | 🟦 codée (revue flotte), à déployer |
| 3 | Tâches & agenda (Tasks/Calendar, remplace l'agent mail externe de Marc) | 🟦 codée (revue flotte 🟢), à déployer |
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
  `script.send_mail` (notif), `script.scriptapp` (trigger), + Phase 3 : `tasks`, `calendar.events`
  (création uniquement, jamais lecture/modification/suppression). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc

> Objectif **full auto**. Les secrets de déploiement sont posés — il ne reste qu'une ré-autorisation
> à venir (Phase 3) et deux rappels de fond.

1. **Phase 3 (à venir, une fois)** : l'ajout des scopes Google Tasks/Calendar va déclencher un **nouvel
   écran de consentement Google** au prochain déploiement. Une seule ré-autorisation (un clic) sera
   nécessaire — DriveAI ne peut pas le faire à sa place (frontière d'exécution). Sera annoncé clairement
   le moment venu, avec une fonction « un clic » dédiée si possible.
2. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
3. *(`P1-09` — fait)* le coût LLM réel est désormais **mesuré** (`Cout.gs`, tokens `usage` agrégés
   par mois) et **affiché chaque semaine** dans le résumé hebdo automatique (`Resume.gs`). Plus besoin
   d'estimer : à observer sur le 1er mois réel pour confirmer < 10 $/mois.

### Améliorations en cours (demandées par Marc le 2026-06-30, après la mise en prod de Phase 3)
Marc a demandé 4 chantiers d'amélioration ; ordre de livraison :
1. **Visibilité + coût réel** (`P1-09`/`P1-10`) — ✅ codé, revue flotte 🟢 (quotas + code-reviewer) :
   `Cout.gs` (mesure des tokens) + `Resume.gs` (résumé hebdo auto par mail, déclencheur auto-installé
   `assurerTriggerResume_`, aucun nouveau scope).
2. **Quarantaine après N échecs** — ✅ codé (`Journal.gs` onglet `Échecs` + compteur cross-tick,
   `Pipeline.gs` `gererEchec_`, `CONFIG.QUARANTAINE_MAX=3`). Un doc en échec persistant est compté ;
   après 3 essais → Index `quarantaine` (plus jamais re-OCRisé) + 1 alerte. Échecs intermédiaires :
   `journalErreur_` sans mail (anti-spam, au lieu d'un mail par tick). Compté aussi dans le résumé hebdo.
   Récupération après panne transitoire : `dequarantaine()` (Maintenance.gs, un clic) re-traite les
   docs quarantinés à tort. Revue flotte 🟢 (file-checker idempotence + apps-script-quota I/O, CONFORME).
3. **Filtre d'utilité des PJ** — ⬜ à faire (écarter signatures/logos/pubs avant OCR/LLM).
4. **Classement plus fin** — ⬜ à faire (enrichir catégories/sous-dossiers + entités ; prudent, dégrader
   jamais bloquer).

### Correctifs prod du 2026-07-01 (session marathon, après mise en prod Phase 3)
- **Pipeline gelé (hotfix, #24)** : `appliquerRangementInitial_` tournait avant l'intake et sans try/catch
  → une erreur de collecte gelait tout le tick (file `00·À trier` figée des heures). Corrigé : drainer avant
  d'alimenter + maintenance auto enveloppée. Diagnostiqué par le CODE + signaux Drive (cache Sheet figé).
- **Lecture Office (P1-13, #25)** : les `.docx/.ppt` partaient tous en revue « OCR vide » (extracteur limité
  aux PDF/images) → conversion Google native ajoutée → CV/TP/présentations classés. Bump VERSION = re-tri auto.
- **Sensibles auto-classés (P1-14)** : *décision Marc* — `sensible`/zone protégée ne routent plus en revue
  (classés dans leur domaine ; doublon sensible → `_Doublons`, 1 exemplaire gardé). `CLAUDE.md` §1 réécrit.
  Garde-fous conservés : aucune suppression, non-détachement de 04. Seul `domaine inconnu` reste en revue.
- **Vérif prod** : le cache de lecture de la Sheet est resté figé toute la session → tout vérifié par
  **recherche Drive directe** (contenu des dossiers par `parentId`, `modifiedTime`). Résultat confirmé :
  CV → 05·Carrière, doublons → `_Doublons`, revue vidée du faux sensible.

### Hotfix « pipeline gelé » (2026-07-01, découvert en regardant le ménage en prod)
La file `00·À trier` stagnait : ~20 vieux fichiers déplacés par le grand rangement y sont restés des heures
sans être classés, et plus rien n'était traité (le moteur écrivait pourtant son état chaque tick). Cause :
dans `tickDriveAI`, `appliquerRangementInitial_` tournait AVANT l'intake **et** n'était pas enveloppé de
try/catch — le `try` de `tickDriveAI` n'a qu'un `finally`, donc une exception dans la collecte (walk de
l'ancien Drive) **tuait tout le tick avant Gmail/dépôts/intentions**, à chaque tick. Correctif : (1) rejeu +
rangement + `creerDossiersEntitesValidees_` enveloppés de try/catch (une erreur ne peut plus geler l'intake) ;
(2) rangement déplacé APRÈS l'intake, `if (!estBudgetDepasse())` → **drainer avant d'alimenter** ; (3) scan
Gmail durci par fil. Revue flotte 🟢 (apps-script-quota + code-reviewer). Diagnostic fait **par lecture du code
+ recherche Drive directe** (le cache de lecture de la Sheet étant figé toute la session). Leçon consignée.

### Doublons → `_Doublons` (P1-12, décidé par Marc le 2026-06-30 en regardant la prod)
La vérif prod (via recherche Drive directe, le cache de lecture Sheet étant figé) a montré que le grand
rangement **marche** (vieux fichiers déplacés vers `00·À trier`, docs renommés+classés) MAIS que la file
de revue se **saturait de `[REVUE] doublon`** (ancien Drive plein de copies : relevés Robovic, docs scolaires
2018). Sur choix de Marc (option « dossier _Doublons + log »), les doublons NON sensibles vont maintenant
dans `_Doublons` (déplacement seul, jamais supprimé) au lieu de la revue ; un doublon **sensible** reste en
revue (§1 prioritaire dans `Router.deciderRoutage_`). `nettoyerDoublonsRevue()` (un clic) balaie les doublons
déjà accumulés en revue. ✅ codé, revue flotte (sécurité + file-checker + structure-keeper).

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

- **2026-07-02 — Chantier #6 (partie 2, C6-04) : entité corrigée → « validée » (ADR-0003).** **Modif du
  MOTEUR.** Une correction du formulaire qui nomme une entité + son domaine la **promeut « validée »** dans
  le référentiel (`promouvoirEntiteValidee_`, `Entites.gs`) : find-or-create idempotent (no-op SANS I/O Sheet
  si déjà validée ; `en_attente`→`validée` sinon ; inconnue → ajoutée validée). Câblé dans
  `lireEtAppliquerCorrections_` après `enregistrerCorrection_`. Le dossier d'entité est matérialisé au tick
  suivant (`creerDossiersEntitesValidees_`, déjà en place) et le routage l'utilise. **Validation EXPLICITE de
  Marc via le formulaire = pas d'auto-prolifération** (garde-fou respecté). Prédicat pur `correctionValideUneEntite_`
  testé. +1 test → **108**. Revue flotte (structure + code) en cours. **Reste C6-05** : déplacer/renommer le
  FICHIER déjà classé (champ « Fichier concerné ») — différé (nommage texte libre fragile ; le few-shot corrige
  déjà le futur). ⚠️ Toujours en attente : ré-autorisation du scope `forms` par Marc au prochain déploiement.

- **2026-07-02 — Chantier #6 (partie 1) : correction via formulaire Google (ADR-0003 §1-2).** **Modif du
  MOTEUR + NOUVEAU SCOPE.** Marc a choisi le canal **Google Forms** (vs édition directe de la Sheet). Nouveau
  module `Formulaire.gs` : formulaire de correction find-or-create (`assurerFormulaireCorrection_`, ID en
  Script Property), lu 1×/tick AVANT l'intake (`lireEtAppliquerCorrections_`) — les nouvelles réponses
  (idempotence par horodatage) sont enregistrées via `enregistrerCorrection_` et nourrissent le few-shot du
  #5. Parsing PUR testé (`reponseVersCorrection_`, `domainesPourFormulaire_`). Borné (`CORRECTIONS_MAX_PAR_RUN`
  =20 + garde-temps), enveloppé try/catch (ne gèle jamais l'intake). Lien du formulaire ajouté au résumé
  hebdo. +5 tests → **107**. **⚠️ Action Marc : nouveau scope `https://www.googleapis.com/auth/forms` dans
  `appsscript.json` → ré-autorisation Google unique au prochain déploiement** (frontière d'exécution : la
  session Claude ne peut ni créer le formulaire ni déployer). **Reste C6-04** : appliquer la correction au
  FICHIER déjà classé (déplacer/renommer) + promouvoir l'entité corrigée en « validée ». Revue flotte
  (sécurité/scope + correction + quota) en cours.
- **2026-07-02 — Chantier #5 (partie 1) : boucle d'apprentissage (ADR-0003 §3).** **Modif du MOTEUR.**
  Nouvel onglet `Corrections` + module `Corrections.gs` : à chaque classement, les corrections passées du
  **même émetteur** sont injectées en **exemples few-shot** en tête du prompt LLM (`appelAnthropic_`), bornées
  (`FEWSHOT_MAX`=3, `FEWSHOT_SEUIL`=0.6) — prévisible sur le récurrent (mêmes fournisseurs/écoles), souple
  ailleurs. Sélection PURE et testée : `scoreCorrection_` (pertinence par émetteur), `correctionsPertinentes_`
  (top-N triés), `blocFewShot_` (formatage). Cache 1×/run (reset dans `tickDriveAI`), try/catch → dégrade à 0
  exemple si l'onglet est illisible (n'empêche jamais de classer). Primitive `enregistrerCorrection_` (append
  idempotent) prête pour le **canal de saisie = chantier #6** (mail → mini-formulaire). +6 tests → **101**.
  Revue flotte (coût/correction/quota) en cours. ⚠️ **Récup git** : le conteneur avait redémarré sur un vieux
  commit (P1-14) sans `test/` ; l'état complet (C1→C4, 95 tests) était **sauf sur le distant** — resynchronisé
  par fast-forward vers `origin/claude/…` (92eed34). Rien perdu.
- **2026-07-01 (nuit) — Chantier #4 (partie 1) : garde anti-variantes d'entités (ADR-0002 §4).** **Modif
  du MOTEUR.** Moteur de similarité **pur** dans `Entites.gs` (`tokensEntite_`, `jaccardTokens_`,
  `distanceLevenshtein_`, `similariteEntite_` = max de Jaccard/inclusion/Levenshtein, `chercherVariante_`).
  À la proposition d'une entité (`entiteEnAttenteAjouter_`), on signale la plus proche existante **du même
  domaine** dans une nouvelle colonne `Variante possible ?` (seuil `CONFIG.SEUIL_VARIANTE`=0.6) — pour
  fusion **1-clic** par Marc, **jamais de fusion auto** (anti-prolifération renforcé, pas affaibli). +8
  tests → **94**. Piège de test rencontré : `deepStrictEqual` échoue sur un tableau renvoyé par le bac à
  sable vm (prototype d'un autre realm) → spread `[...x]` dans le test. Revue flotte en cours. **Reste
  C4-03** : validation 1-clic (mail → formulaire, rejoint ADR-0003 / chantiers #5-6).
- **2026-07-01 (nuit) — Chantier #3 (partie 3, C3-03) : dossiers `07 · Santé` + `_Technique` (ADR-0002 §3).**
  **Modif du MOTEUR** + **change la taxonomie Drive**. `07 · Santé` = domaine **auto-créé** (`Config.DOMAINES_AUTO`,
  `Router.dossierDomaineAuto_` find-or-create à côté des domaines) proposé au LLM (`domainesAutorises_`).
  `_Technique` = fichiers **code/CAO** (par extension `CONFIG.EXT_TECHNIQUES`) routés vers `_Technique`
  **sans OCR ni LLM** (`Pipeline` après le fast-path doublon ; économie de coût). **Renumérotage Perso 07→08**
  (`CONFIG.DOMAINES` clé `08 · Perso & projets`, même ID) avec `Main.assurerNomsDomaines_` (gated
  `NOMS_DOMAINES_TAG` = `s1`, renomme le dossier physique pour coller à la config — renommage seul,
  réversible, zéro clic). `Router.dossierRacineParNom_` généralisé (`_Doublons`/`_Technique`). **+6 tests →
  86.** `docs/TAXONOMY.md` mis à jour. Revue flotte en cours (structure-keeper, code-reviewer, security,
  llm-cost). **Chantier #3 : terminé.** Prochain : #4 (entités systématiques + validation 1-clic + garde
  anti-variantes, ADR-0002 §4).
- **2026-07-01 (nuit) — Chantier #3 (partie 1) : nommage par type de document (ADR-0002 §6).** **Modif du
  MOTEUR** (le nom des documents classés change). `src/Router.gs` : `nomParType_` + `schemaNommage_` (règles
  ordonnées de mots-clés → granularité de date jour/mois/année + libellé fixe `Relevé`/`Paie`/`CV`) +
  `tronquerDate_`. `deciderRoutage_` et `doublon_` appellent `nomParType_` ; `nomNormalise_` (format
  historique jour) conservé comme défaut → dégradation gracieuse (type inconnu = format historique, jamais
  un blocage). Ex. : relevé → `2024-03_Relevé_Desjardins`, diplôme → `2021_Diplôme_IUT-ULCO`, facture →
  `2024-03-05_Facture_Hydro-Québec`. `docs/NAMING.md` réécrit (table par type). **+9 tests → 69 au total.**
  Pas de bump `VERSION` (nouveaux docs seulement ; renommage de l'existant = migration, chantier #8).
  **C3-02 deviner-du-nom** (même session) : `Router.devinerTypeDepuisNom_` (pur ; séparateurs `_ - .` →
  espaces, mots-clés/regex ancrés → type canonique, ex. `…_TP4_…` → « TP ») + `enrichirClassifDepuisNom_`
  (complète `classif.type_doc` s'il est vide, sans écraser), appelé dans `Pipeline.traiterDocument_` avant
  le routage. **+5 tests → 80 au total.** Revue 🟢 (file-checker CONFORME : idempotence/déterminisme intacts).
  **Reste chantier #3** : nouveaux dossiers `07·Santé`/`_Technique`. Prochain aussi possible : #4 (entités
  1-clic + anti-variantes, ADR-0002).
- **2026-07-01 (nuit) — Chantier #2 : chien de garde (watchdog, ADR-0004).** **Modif du MOTEUR** (déployée).
  `src/Main.gs` : heartbeat `DriveAI_LAST_TICK` (finally du tick), 2ᵉ déclencheur `chienDeGarde` (30 min,
  `assurerTriggerChienDeGarde_` create-if-absent, posé aussi par `installerTrigger`), décision **pure**
  `actionChienDeGarde_` (machine à 3 états détecter→réparer→alerter, dédupée par épisode = valeur du heartbeat
  figé), auto-réparation (`installerTrigger` + re-vérif `presenceTriggerTick_` anti-fausse-alerte) puis alerte
  mail rassurante (`alerterChienDeGarde_`, dédupée, à soi-même). `src/Resume.gs` : `etatSysteme_` + ligne
  « État du système » au résumé hebdo. `src/Config.gs` : `WATCHDOG_MINUTES=30`, `WATCHDOG_SEUIL_MS=45min`.
  **+10 tests** → **60 au total**. **Revue flotte 🟢** (security CONFORME, quota CONFORME — correctif A1
  appliqué : ne pas fausse-alerter si un log échoue après une réparation réussie ; code-reviewer 🟢). RUNBOOK
  à jour (l'incident « déclencheur désactivé » est désormais auto-réparé). Latence de détection assumée :
  jusqu'à ~75-105 min (seuil 45 min + cycles watchdog 30 min) — « rassurer, pas réagir à la seconde ».
  Prochain : chantier #3 (nommage par type + `07·Santé`/`_Technique`, ADR-0002).
- **2026-07-01 (soir ter) — Chantier #1 (fondation testable) — partie 2/2 : Journal borné + onglet `Santé`.**
  **Modif du MOTEUR** (déployée). `src/Journal.gs` : `lignesJournalASupprimer_` (pure, hystérésis `max+marge`
  → purge en lot, ramène à `max`), `bornerJournal_` (`deleteRows` de LOG — jamais un document, §2 intact),
  `majSante_` (onglet `Santé` : heartbeat, catalogue Index, coût du mois, statut rangement — **métadonnées
  seulement**, une seule `setValues`). `src/Main.gs` : les deux dans le `finally` de `tickDriveAI`, chacun
  enveloppé, `releaseLock` durci (try/finally imbriqué → verrou toujours relâché). `src/Config.gs` :
  `JOURNAL_MAX_LIGNES=20000` (> `RESUME_MAX_LIGNES=15000`), `JOURNAL_MARGE=5000`. **+13 tests** (rotation
  Journal, coût pur, invariant Santé) → **50 tests** au total. **Revue flotte 🟢** (security CONFORME,
  quota CONFORME — 2 points appliqués : commentaire précisé + `releaseLock` durci ; code-reviewer 🟢 — sa
  suggestion de test invariant Santé appliquée). Chantier #1 : **socle posé**. Prochain : chantier #2 (chien
  de garde, ADR-0004). Le grand rangement continue en fond.
- **2026-07-01 (soir bis) — Chantier #1 (fondation testable) — partie 1/2.** Premier code post-brainstorm.
  Posé un **harness Node** (`test/harness.js`) qui charge les `.gs` Apps Script dans un bac à sable `vm`
  avec des **mocks Google déterministes** (Utilities.formatDate/Session/Date partagé, faux Drive dont un
  `getParents()` qui peut lever comme le cas P1-17) — **sans modifier le code source** (le comportement testé
  = celui déployé). **37 tests** (`node --test`, zéro dépendance) couvrant la logique de décision : nommage,
  dates, entités/sous-dossiers hors schéma, prédicats de collecte, le **garde-fou §1** (zone protégée jamais
  détachée : multi-parents, chaîne d'ancêtres, échoue-fermé/ouvert, borne anti-cycle), et l'**invariant vie
  privée ADR-0007** (`indexAjouter_` n'écrit que des métadonnées). **Job CI** « Tests unitaires (logique pure) »
  ajouté à `ci.yml` (Node 20). Piège rencontré (test, pas code) : un faux itérateur `getParents` *infini*
  faisait boucler la garde (borne de profondeur ≠ borne de largeur) → corrigé en modélisant un vrai cycle
  Drive (itérateurs finis) ; et `instanceof Date` échouait entre réalités vm/test → `Date` de l'hôte partagé
  dans le sandbox. **Reste chantier #1 (partie 2/2)** : Journal borné + onglet `Santé`. Le grand rangement de
  l'ancien Drive continue en fond.
- **2026-07-01 (soir) — Brainstorm produit « niveau pro » + dossier de conception.** Après la session
  marathon de correctifs (P1-13→P1-20) et le lancement du grand rangement, Marc a demandé un brainstorm
  détaillé pour élever DriveAI au niveau pro avec bonne documentation. Produit un **dossier de conception
  complet** par ADR (Architecture Decision Records) : **0001** cadrage (perso, qualité pro, précision >
  contrôle > fiabilité, rester gratuit) ; **0002** taxonomie/entités/nommage ; **0003** contrôle &
  correction (mail hebdo → formulaire 1-clic, `Corrections` few-shot) ; **0004** fiabilité (chien de garde) ;
  **0005** sources = fichiers partagés ; **0006** ⭐ FONDATION (testabilité + filet de tests CI + Journal
  borné/`Santé`) ; **0007** sécurité/vie privée (LLM = tout tel quel ; **état = métadonnées seulement**,
  *vérifié sur le code* : Index = nom/date/chemin/statut/hash, aucun corps de doc → règle durable ajoutée
  `CLAUDE.md` §7) ; **0008** app web Phase 4 (recherche/dashboard/corrections, login Google, plein texte via
  index natif Drive pour respecter 0007). **Roadmap** (`docs/ROADMAP.md`) réordonnée à 9 chantiers, socle #1
  = fondation testable. Runbook + guide écrits. **4 PR docs mergées** (#33-#36) via auto-merge. Fil rouge :
  deux fois un choix de Marc contredisait une décision récente (app applique direct ↔ garde-fous §1/§2 ;
  plein texte ↔ 0007 métadonnées) → **surfacé avant de figer**, réconcilié (recherche) ou documenté avec la
  contrainte attachée (corrections : garde-fous ré-implémentés + testés). **Aucun code moteur touché** — que
  de la doc. Le grand rangement a continué en autonomie tout du long. **Prochain pas : coder le chantier #1.**
- **2026-06-30 (P2.7 ancien Drive + Phase 3 complète)** — Diagnostiqué un blocage de pipeline CI/CD
  (GitHub Actions muet 26-27/06, puis branche en conflit avec `main` bloquant la CI sur la PR) → résolu
  (fusion `-s ours`, conflits de docs/squash réconciliés), PR #19 (P2.5+P2.6) mergée et déployée en prod
  avec vérification run-par-run (pas seulement « ça devrait marcher »). **P2.7** : ancien Drive de Marc
  identifié (« Ancienne structure », pas `_Archive 2025`) et branché sur le grand rangement
  (`RANGEMENT_RACINES_SUP`, tag `r2`) ; audit sécurité a détecté un trou (OCR vide → `sensible=false`
  sans signal → classement auto d'un possible passeport/doc fiscal) → corrigé par un garde-fou dédié
  (dépôt + OCR non exploitable → revue forcée), re-audité 🟢 par security-auditor et file-checker (pas
  de sur-blocage). **Phase 3 codée** (remplace l'agent mail externe de Marc) : scopes Tasks/Calendar
  + clients REST (`Tasks.gs`/`Calendar.gs`/`GoogleApi.gs`) ; pré-filtre 3 étages (`Prefiltre.gs`) ;
  extraction d'intentions LLM + routage Tasks/Calendar (`Llm.gs`) ; orchestration + idempotence à 2
  niveaux + ID client Calendar (`Intentions.gs`). Re-audité par 4 spécialistes en 2 passes : sécurité,
  coût (~1-4 $/mois), idempotence 🟢 du premier coup ; apps-script-quota a trouvé un **vrai BLOQUANT**
  (pagination par offset numérique sur une fenêtre Gmail mouvante → stagnation permanente au-delà de
  ~200 messages, vérifié manuellement par traçage du scénario plutôt que pris pour argent comptant) →
  corrigé par un scan à deux voies (offset pour le mail neuf + curseur de date absolue persisté pour le
  rattrapage d'historique), re-vérifié 🟢. Repéré et corrigé seul, AVANT tout audit, un bug d'ID Calendar
  non scopé par message (collision possible entre deux mails à intention identique) — leçon : toujours
  relire son propre code avant de l'envoyer en revue. Repéré aussi qu'une suggestion d'audit (« ajoute
  arc/cra aux mots-clés protégés ») aurait introduit un faux-positif massif (« arc » dans « Marc ») avec
  l'implémentation substring existante → corrigé le matcher (mot entier pour les motifs courts) avant
  d'appliquer la suggestion. **2 agents de la flotte ont halluciné un sujet sans rapport** (exemples
  d'outils MCP non pertinents) lors d'un premier essai — relancés avec un prompt plus strict, succès.
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
