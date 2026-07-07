# CLAUDE.md — DriveAI

> Mémoire de projet, chargée à chaque session. **Garde ce fichier court et à jour.**
> Le détail vit dans `PLAN.md`, `BACKLOG.md` et `docs/`. Les leçons s'accumulent dans
> `docs/LESSONS.md` et leurs règles durables remontent dans la section « Leçons » ci-dessous.

## 1. Le projet en une phrase

**DriveAI** range Google Drive tout seul : les pièces jointes utiles des mails et les
fichiers déposés à la main sont analysés par un LLM (Claude Haiku), renommés selon une
convention stricte, et classés dans une arborescence granulaire — sans intervention, sauf
une file de revue pour les cas incertains.

Stack : **Google Apps Script** (moteur, Phases 1–3) + une **Google Sheet** (état) +
**app web React/Vite/TS sur Vercel** (Phase 4). LLM via l'API Anthropic.

## 2. Garde-fous NON NÉGOCIABLES

Ces règles priment sur toute optimisation. Toute PR qui les viole doit échouer la revue.

1. **Documents sensibles — classés, jamais supprimés ni détachés. Revue ULTRA-STRICTE seulement.**
   *(Décisions Marc 2026-07-01 : révise « sensible → toujours en revue » puis supprime la revue ;
   2026-07-07, ADR-0016 : ré-introduit un filet de revue ÉTROIT.)* Un **seul dossier d'arrivée**
   (`00 · À trier`). **TOUT** document est **auto-classé** dans son domaine avec son **nom final propre**
   (`AAAA-MM-JJ_Type_Émetteur.ext`), jamais un nom encodé `[REVUE] …`. **Fail-safe hybride (ADR-0016)** :
   un document ne va dans `00 · À vérifier` que si l'analyse ne porte **AUCUN fait exploitable** —
   `domaine` inconnu **ET** `emetteur` **ET** `type_doc` **ET** `entite` **ET** `descripteur` tous
   absents (`estClassificationVide_`, PURE ; les sentinelles LLM « Inconnu »/« N/A »/« - » comptent
   comme absentes). Un **seul** fait présent ⇒ classé au mieux (domaine introuvable mais un autre fait
   présent → `CONFIG.DOMAINE_DEFAUT`).
   La conjonction **ET** est l'anti-saturation NON négociable (sinon la revue neutralise l'auto-rangement
   — leçon vécue) : la revue est l'exception rare, jamais la posture. Le flag `sensible` du LLM reste
   produit mais ne route plus rien. Ce qui reste **NON négociable** : (a) **aucune suppression** (§2) ;
   (b) le grand rangement ne **détache jamais** un fichier déjà rangé sous `04 · Immigration` (garde
   multi-parents `aParentProtege_`, remonte toute la chaîne d'ancêtres, appliquée à la collecte ET avant
   chaque mutation) ; (c) un doublon, **même sensible**, va dans `_Doublons` (déplacement seul), jamais
   effacé. *(Élargir la revue = assouplir `estClassificationVide_` ⇒ ré-audit anti-saturation obligatoire.)*
2. **Aucune suppression automatique.** Les doublons sont *écartés dans `_Doublons` (déplacement seul)*,
   jamais effacés. **Unique exception, ÉTROITE (ADR-0014, décision Marc 2026-07-06)** : un **DOSSIER
   devenu VIDE** après une réorg validée (#21) peut être mis à la **corbeille Drive** (récupérable 30 j)
   — uniquement par l'**APP** (`app/src/corbeille.ts`, seul fichier autorisé à porter `trashed: true`,
   verrouillé par tripwire CI), uniquement au **clic de validation de Marc**, avec re-vérification au
   clic de la vacuité STRICTE (corbeillés inclus), du type et de l'ascendance (échec fermé). **Jamais un
   fichier, jamais un dossier non vide, jamais la zone protégée, jamais une racine système, jamais le
   moteur** (surface `.gs` sans suppression, inchangée et testée). `files.delete` reste interdit partout.
3. **Moindre privilège.** Scopes déclarés explicitement dans `appsscript.json`. Gmail en
   **`gmail.modify`** *(décision Marc 2026-07-06, ADR-0012, chantier #16 — révise l'ancienne règle
   « lecture seule »)* : les SEULES écritures permises sont poser un libellé **existant** sur un fil
   et archiver (retrait de la boîte, réversible). Restent interdits **à jamais** (verrou CI
   `surface-gmail-ecriture`, check requis) : toute suppression/corbeille Gmail, toucher au Spam,
   créer/détruire/**retirer** un libellé, service avancé et REST Gmail. Drive RW, Tasks/Calendar
   écriture uniquement (Phase 3). Tout merge qui étend un scope se séquence AVEC Marc (gel des
   déclencheurs jusqu'à ré-autorisation).
4. **Aucun secret en dur.** La clé API vit dans les Script Properties
   (`DriveAI_ANTHROPIC_KEY`), jamais dans le code, jamais dans un commit.
5. **Idempotence.** Un fichier déjà traité ne l'est pas deux fois (label Gmail +
   vérification dans l'`Index`).
6. **Budget LLM : < 10 $/mois en régime de croisière.** Haiku par défaut, Sonnet en fallback
   ponctuel. Les campagnes de RATTRAPAGE (grand rangement, historique Gmail, migration) sont un
   coût one-shot plafonné par le frein `CONFIG.LLM_BUDGET_CAMPAGNES` — **30 $ (décision Marc
   2026-07-07 : « je veux que tu continues le tri au complet », révise l'ancien plafond 10)**,
   à redescendre vers 10 une fois le rattrapage fini. Le frein ne se désactive JAMAIS
   (filet anti-emballement) et ne gate JAMAIS le flux vivant.

## 3. Conventions de code

- **Langue** : code et commentaires en français ; interface produit bilingue FR/EN.
- **Commits** : en français, préfixés par l'ID de tâche du backlog. Ex. `P1-03: extraction des PJ Gmail`.
- **Branches** : `claude/<slug>` pour le travail automatisé. `main` est protégée par la CI.
- **Nommage des fichiers classés** : `AAAA-MM-JJ_Type_Émetteur.ext`. L'entité est dans le
  *chemin*, jamais répétée dans le nom. Date absente → date de réception du mail.
- **Discipline de scope** : on livre par phases. Ne pas anticiper une phase ultérieure.
  Voir `BACKLOG.md` pour le périmètre exact de chaque phase.

## 4. Workflow automatisé

- **Push & merge auto** : Claude pousse sur une branche `claude/**`, ouvre une PR (draft),
  la CI valide, puis la PR se **merge automatiquement** (squash) quand la CI est verte.
  Voir `.github/workflows/`. Override : label `do-not-merge`.
- **Flotte d'agents** (`.claude/agents/`) : un `product-manager` planifie et répartit le
  travail vers les spécialistes. Lance `/review` pour passer un diff au crible.
- **Boucle de leçons** : après chaque session qui touche du code, un hook `Stop` invite à
  consigner les leçons réutilisables. Utilise `/lesson "…"`. Voir `docs/WORKFLOW.md`.
- **Documents vivants** (à tenir à jour à chaque session, comme FinanceAI) : `HANDOVER.md`
  (état courant, `/handover`), `BACKLOG.md` (statuts), `docs/` (dont `DEPLOIEMENT.md`). Le hook
  `Stop` le rappelle ; la CI vérifie leur présence. Ne jamais les laisser dériver de la réalité.

| Agent | Rôle |
|-------|------|
| `product-manager` | Découpe la tâche, choisit les bons agents, ordonne le travail |
| `structure-keeper` | Garde la taxonomie / l'arborescence cohérente (`docs/TAXONOMY.md`) |
| `naming-validator` | Valide la convention de nommage et le formatage (`docs/NAMING.md`) |
| `file-checker` | Vérifie la logique d'intake des nouveaux fichiers (idempotence, doublons) |
| `code-reviewer` | Relit les diffs : bugs, lisibilité, conventions |
| `security-auditor` | Moindre privilège, secrets, zone protégée, pas de suppression auto |
| `apps-script-quota` | Triggers, quotas, lots, robustesse Drive/Gmail |
| `llm-cost-optimizer` | Prompts, JSON strict, choix de modèle, cible budget |

## 5. Commandes utiles

- `/phase <n>` — démarre une phase du backlog avec discipline de scope.
- `/review` — passe le diff courant à la flotte d'agents via le `product-manager`.
- `/lesson "<leçon>"` — consigne une leçon dans `docs/LESSONS.md` (+ règle durable ici).
- `/handover` — régénère `HANDOVER.md` à partir de l'état courant.
- `/ship` — commit (FR, préfixe ID), push `-u origin`, ouvre la PR draft.

## 6. État du projet

- **Phase courante** : 0 — scaffolding & automatisation. Le moteur Apps Script (Phase 1)
  n'est **pas** encore écrit. Voir `BACKLOG.md`.
- **Prérequis côté Marc** avant Phase 1 : projet Apps Script créé, clé Anthropic dans les
  Script Properties (`DriveAI_ANTHROPIC_KEY`), Google Sheet d'état créée. Voir `PLAN.md` §8.

## 7. Leçons apprises (règles durables)

> Distillées depuis `docs/LESSONS.md`. N'ajouter ici que ce qui change la façon de coder.

- **L'idempotence vit dans l'Index, jamais dans un libellé Gmail.** *(Prémisse « lecture seule »
  levée au chantier #16 — ADR-0012, `gmail.modify` — mais la partie DURABLE reste :)* l'état
  « déjà traité » se porte **par l'Index** (clé `messageId|i|nom|taille` pour les PJ,
  `tri|fil|ts|lu` pour le tri), JAMAIS par un label — un libellé est une donnée UTILISATEUR que
  Marc peut retirer, pas un marqueur d'état.
- **Ordre des écritures d'état.** L'inscription Index (« c'est fini ») se pose en dernier — après
  le dépôt Drive et après la ligne Revue — pour qu'une coupure rejoue au lieu de perdre un cas.
- **Robustesse moteur Apps Script.** `LockService` (anti-chevauchement), garde-temps (coupure
  6 min), et lecture d'état mise en cache 1×/run (jamais une lecture Sheet par item).
- **Vie privée : métadonnées seulement dans l'état.** Ne JAMAIS persister le corps d'un document
  (texte OCR, contenu) dans l'Index ni le Journal — uniquement des métadonnées (nom, date, chemin,
  statut, **empreinte = hash**). Le texte des documents ne sort que vers l'API Anthropic pour le
  classement (transit assumé, ADR-0007) ; il ne se stocke nulle part. Tout nouveau champ d'état ou
  log doit respecter cet invariant (à verrouiller par un test, roadmap #1).
- **Garde-fou étroit, calibré sur du réel.** Un flag de protection (ex. `sensible`) doit viser
  des catégories précises (immigration + fiscal), pas « true par défaut » — sinon tout part en
  revue et l'auto-rangement est neutralisé. Le défaut prudent ne sert que pour les réponses LLM
  *malformées*, jamais comme posture de classement.
- **Git (squash-merge + branche réutilisée).** Avant chaque nouvelle tâche, repartir
  d'`origin/main` (reset/merge). Si la branche distante `claude/**` diverge après merge,
  refusionner son tip plutôt que force-push (ruleset). Un check requis doit gater le merge vers
  `main`, pas le push des branches de travail. Ne jamais juger un `git push` via `| tail` (l'exit
  code est masqué) — vérifier `git push; echo $?`.
- **Frontière d'exécution.** DriveAI tourne dans le compte Google de Marc (Apps Script). La
  session Claude ne peut **pas** y déployer (`clasp push`) ni exécuter de fonction ; le MCP Drive
  est lecture/copie/création seulement. Annoncer cette frontière tôt et minimiser la part manuelle
  de Marc via du code (fonctions « un clic »), jamais promettre de déployer/exécuter à sa place.
- **API Google via REST, pas service avancé.** Le service avancé Drive (`Drive.*`) déclaré dans
  `appsscript.json` n'est pas fiable après `clasp push` (`Drive is not defined`). Appeler l'API
  Drive en **REST via `UrlFetchApp`** (token `ScriptApp.getOAuthToken()`, scope `drive`) — robuste,
  sans activation manuelle. Faire dégrader l'OCR proprement (texte vide) plutôt que planter.
- **Nouveau cycle de vie d'un fichier ⇒ auditer les invariants voisins.** Introduire un move/delete/
  fusion casse les hypothèses du code voisin (surtout les outils de maintenance). Ex. : le dépôt manuel
  *déplace* l'original → `rejouerLaRevue` ne doit jamais corbeiller un exemplaire unique (distinguer la
  source via l'Index `drive|…` vs Gmail). Un déplacement n'est pas une suppression, mais rend l'original
  irremplaçable côté scan.
- **Garde-temps sur TOUT lot Drive.** Chaque phase qui boucle sur des appels Drive/Sheet (pas seulement
  la boucle de documents) doit être bornée par le garde-temps partagé + un plafond par run ; le reste
  est repris au tick suivant. Ne pas hasher un blob sans la même borne de taille que l'OCR (mémoire).
- **Granularité = enrichissement, jamais frein.** Un niveau de classement plus fin (entité, sous-dossier)
  doit **dégrader vers le niveau précédent** quand l'info manque (entité non validée → classé au domaine
  + entité proposée), **jamais** envoyer le document en revue. Sinon, au premier run, tout part en revue
  et l'auto-rangement est neutralisé (même piège que `sensible` trop large). Re-tester sur du réel :
  « est-ce que ça range encore avant toute validation ? »
- **Maintenance manuelle → auto : retirer l'irréversible ET les effets de FIN.** Passer une opération
  (ex. `rejouerLaRevue`, `dequarantaine`) du manuel à l'automatique exige : aucune action irréversible
  dans le chemin auto (déplacement OK, jamais de corbeille — garder ça sur le chemin manuel), borné +
  reprenable (marquer « fait » seulement une fois TOUT consommé), raisonner par `fileId` (pas par nom),
  ne pas casser l'idempotence du reste. Et lire l'outil JUSQU'À SA DERNIÈRE LIGNE : ses effets de
  confort de fin (ex. un `tickDriveAI()` de relance) deviennent des bombes dans le tick (réentrance →
  verrou relâché en plein run) — extraire un noyau sans effets de fin, re-scoper ses entrées au
  contexte auto (ne libérer que ce que les sources savent re-présenter). Re-auditer par la flotte.
- **Auto-déploiement (CI/CD) : 2 pièges.** (1) Un merge par le bot `GITHUB_TOKEN` (auto-merge) ne
  déclenche PAS les workflows `on: push` (anti-récursion) → l'auto-merge doit **dispatcher** le déploiement
  (`gh workflow run`, `actions: write`). (2) Épingler la version Node des outils CLI sensibles (clasp v3
  → Node 20 ; Node 22 = « Premature close »). Toujours **vérifier qu'un déploiement auto a vraiment tourné
  et réussi** (lire les runs), pas juste qu'il « devrait » se déclencher.
- **Reclassement de masse auto ⇒ convergence + garde zone protégée multi-parents.** Un rangement
  automatique de tout le Drive doit **converger** via un prédicat de skip stable que le pipeline produit
  lui-même (renommage `AAAA-MM-JJ_` ⇒ jamais re-collecté ; vérifier que le renommeur produit TOUJOURS ce
  format) et ne figer le « fait » que quand une passe ne collecte plus rien (sinon re-OCR/LLM en boucle).
  Le garde zone protégée doit **remonter toute la chaîne d'ancêtres** (un fichier multi-parents avec un
  parent sous `04 · Immigration` n'est JAMAIS détaché), appliqué au filtre de collecte ET avant la mutation.
  Déplacement seul, borné, reprenable ; ne pas enchaîner un sous-run sans budget restant (limite dure 6 min).
- **Vérifier la prod par un signal indépendant ; « signaler en revue » ne passe pas à l'échelle.** Si le
  canal de lecture d'état est en cache/indisponible, vérifier la prod **autrement** (recherche Drive directe :
  `modifiedTime`, contenu de dossiers par `parentId`) — jamais affirmer un résultat sans preuve, mais chercher
  la preuve ailleurs. Et un garde-fou « signaler en revue » (doublon, incertain) fin sur un flux normal **sature**
  la file de revue au volume d'un traitement de masse → router vers un dossier dédié (`_Doublons`, déplacement
  seul, jamais supprimé), en gardant le cas **sensible** prioritaire (un doublon sensible va toujours en revue).
- **Maintenance auto dans le tick : protéger l'intake, drainer avant d'alimenter.** Toute étape SECONDAIRE
  (rejeu de version, grand rangement, ajustement de déclencheur) doit être **enveloppée d'un try/catch** —
  « un échec ne doit JAMAIS bloquer l'intake ». Le `try` de `tickDriveAI` n'a qu'un `finally` : une exception
  non capturée dans une étape amont **gèle tout le pipeline** (Gmail + dépôts + intentions sautés à chaque
  tick). Vérifier que TOUTES les étapes secondaires sont protégées, pas seulement certaines. Symptôme « le
  moteur écrit son état mais ne traite plus rien » ⇒ plantage non capturé ou famine de budget en amont ;
  diagnostiquer par le CODE + signaux Drive quand le Journal est illisible.
- **Drainer avant d'alimenter, SANS affamer l'alimenteur : tôt + gated, pas « en dernier ».** Correction
  d'une leçon antérieure. Mettre l'étape qui ALIMENTE une file (rangement → `00·À trier`) *après* le drainage
  (`if (!estBudgetDepasse())`) la met EN DERNIER → elle ne reçoit jamais de budget → la file source ne se
  vide jamais (l'ancien Drive stagnait). Le bon patron : l'alimenteur tourne **TÔT** (avant l'intake, pour
  avoir du budget) mais **gated sur une file BASSE** (`nbFichiersATrier_ < SEUIL`) — on n'alimente que s'il
  reste de la place. Tôt+gated = ni famine ni engorgement (contre-pression). Pour une **barre de progression**
  sur un tel traitement de masse : recenser le total dans un tick DÉDIÉ (sinon le comptage ne finit jamais en
  concurrence du traitement), avec filet « après N recensements incomplets, accepter le compte partiel » ;
  numérateur monotone, base re-basable (jamais > 100 %), « terminé » sur le vrai signal de fin (passe qui ne
  collecte plus rien), pas sur `traites >= base`. Toujours tracer le scénario sur plusieurs ticks.
- **Une clé d'idempotence encode TOUT l'état qui commande la décision.** C'est un instantané, pas
  un identifiant : chaque variable dont dépend l'action doit être DANS la clé (ex. tri Gmail :
  `tri|fil|ts|lu` — sans le flag lu/non-lu, un mail lu APRÈS son tri n'aurait jamais été archivé).
  Revue systématique : « quel changement d'état devrait re-déclencher l'action, est-il dans la
  clé ? » Et deux documents qui doivent bouger ensemble (manifeste ↔ constitution) se verrouillent
  par un tripwire CI, pas par la discipline.
- **Promesse de verrou = verrou codé dans le même commit.** Écrire dans un document vivant « la
  surface X est verrouillée par tests » exige de VÉRIFIER (grep + test) que le test couvre bien X —
  un test voisin ne couvre pas par contagion (le verrou Gmail ne voyait pas les suppressions Drive).
  Une exception à un garde-fou se livre ATOMIQUEMENT (ADR + constitution + code + tripwire
  bidirectionnel + revue flotte), et son périmètre se définit aussi par IDENTITÉ (IDs fixes du
  routage), pas seulement par nom/ascendance.
- **Pagination/page sur une file MOUVANTE (Gmail, `00·À trier`) ⇒ prouver que le plus ANCIEN sort
  un jour.** Si du neuf s'insère en tête entre deux passes (itérateurs Gmail ET DriveApp servent les
  plus récents d'abord), un scan qui repart « du haut » à chaque tick capte le neuf mais peut
  **stagner indéfiniment** sur l'ancien (vécu 2× : mur historique Gmail ; PDF déposé resté 11 h dans
  À trier pendant que le rangement re-alimentait la file). Remèdes éprouvés : scan ancré sur une
  valeur ABSOLUE qui n'avance que dans un sens (`before:` persisté) + scan du neuf qui s'arrête tôt
  (Gmail) ; page composée de TRAITABLES seulement (skips filtrés À LA COLLECTE — un mur de
  déjà-indexés n'occupe aucune place) + tri FIFO ancien→récent (intake Drive, R3). Toujours
  **tracer un scénario concret sur plusieurs ticks** avant de valider une pagination — c'est ce qui
  révèle un plateau silencieux.
- **Un garde-fou qui met des items HORS CIRCUIT exige un chemin de RETOUR auto.** Une quarantaine
  sans dé-quarantaine automatique transforme un incident transitoire (panne de crédit) en perte
  permanente et silencieuse (32 fichiers sautés à vie, R3 : one-shot gaté par tag, ré-armé par le
  rétablissement de panne). Et un frein budget (§2.6) met en pause les CAMPAGNES, jamais le flux
  vivant — sinon « le moteur marche » pendant que la boîte de dépôt de Marc est morte.
- **Campagne Gmail : requête figée ⇒ appartenance stable, mais l'ORDRE bouge quand même** (tri par
  DERNIER message, suppressions) — l'offset persistant sert à PROGRESSER, jamais à prouver la
  COMPLÉTUDE. Celle-ci vient de « terminé quand DEUX passes complètes consécutives ne collectent
  plus rien » (offset remis à 0 si la passe a eu de l'activité ; re-passe quasi gratuite par
  l'Index), avec abandon tracé d'un fil en échec après N essais — comptés par PASSE (à la complétion
  de page), jamais par rejeu (sinon 3 essais brûlés en 15 min sur une erreur transitoire). Les
  plafonds/run se vérifient à l'unité de COÛT réelle (la PJ) et à CHAQUE niveau de boucle ; un
  plafond par RUN ne borne pas la JOURNÉE (×288 ticks > quota runtime ~90 min/j) → toute campagne de
  fond se budgète PAR JOUR (ms réelles persistées). Une complémentarité entre scans se vérifie au
  niveau où Gmail MATCHE : par MESSAGE, pas par fil (un fil ravivé par un message sans PJ échappe à
  `has:attachment newer_than:`) ; `before:` exclusif ⇒ chevauchement par construction (−29 j).
- **Refonte/pipeline LLM coûteux ⇒ PROUVER sur du réel large avant de coder ET de déployer.** Avant
  de bâtir (surtout de déployer/lancer une campagne) une refonte d'analyse ou un changement de
  modèle onéreux : d'abord les fonctions PURES testables (nommage, canonicalisation, routage), puis
  PROUVER la nouvelle logique sur un ÉCHANTILLON RÉEL large et STRATIFIÉ (pas 2-3 cas choisis), avec
  des métriques HONNÊTES vérifiées indépendamment, présentées en avant/après VISIBLE (artifact) et
  ITÉRÉES avec Marc — c'est là qu'il relève le niveau. Un chiffre-titre n'est jamais une promesse de
  gain tant qu'il n'est pas mesuré sur le corpus (vécu : « 65 % d'Inconnu » = 0/21 réellement
  récupérable — les Inconnu étaient légitimes ; le vrai gain était la CORRECTNESS, pas l'émetteur).
  Le pipeline LLM live (flag éteint) et la campagne viennent APRÈS validation.
- **Échecs LLM : classer par ORIGINE avant de compter.** Une erreur de PLATEFORME (HTTP 400
  « credit balance », 401 — panne de COMPTE) n'est jamais imputée au document : détecter →
  suspendre les appels du run (échec rapide) → ne rien compter → re-sonder au run suivant. Sinon
  une panne de crédit met toute la file en quarantaine (vécu : ~89 docs en 2 jours). Pendant la
  panne, SUSPENDRE aussi les SOURCES (persistance + re-sonde bornée ≤ 1×/h) : des scans qui ne
  peuvent rien marquer re-parcourent toute la fenêtre à chaque tick et brûlent le quota de lecture
  Gmail — le moteur reste bloqué 24 h APRÈS la recharge (vécu 07-06). Et un canal d'alerte n'existe
  que VÉRIFIÉ de bout en bout une fois — le destinataire vient de la Script Property `DriveAI_EMAIL`
  (jamais d'un scope, jamais de gel).
- **Nouvel effet de bord dans un pipeline gardé ⇒ toutes les gardes en amont, sur TOUS les chemins.**
  Insérer un flag/une écriture d'état entre deux gardes existantes peut créer un chemin de sortie
  anticipée qui court-circuite la garde aval (vécu : flag `important` posé avant la garde corps —
  un mail protégé serait remonté « À traiter »). Tracer chaque `return` entre les gardes et l'effet,
  poser un test par garde × chemin ; un commentaire « couvert par les gardes ci-dessus » n'est pas
  une preuve.
- **Few-shot : n'injecter que les champs STABLES pour la clé de sélection.** Un bloc d'exemples sélectionné
  par une clé K ne doit contenir que les champs corrélés à K ; exclure tout champ qui VARIE à K constant.
  Ex. corrections sélectionnées par émetteur (ADR-0003) → injecter `domaine`/`entité` (stables : EDF →
  Logement/EDF), **jamais** le `type` de doc (un même émetteur envoie facture puis contrat) — sinon on
  enseigne une fausse régularité et on biaise la prédiction. Garder le few-shot borné (top-N + seuil) : le
  surcoût est alors négligeable et déjà capté par la mesure `usage`.
- **Re-traiter un doc déjà classé (rejeu/migration) = lever 3 verrous du pipeline.** (1) Clé d'idempotence
  DÉDIÉE par campagne (`migre|<tag>|fileId`), additive (ne jamais retirer les lignes des autres sources),
  qui sert aussi de prédicat de convergence de la collecte ; (2) bypass EXPLICITE du fast-path doublon
  (`src.ignorerDoublon`) — sinon « doublon de lui-même » et tout part en `_Doublons` ; (3) tout refus de
  mutation (zone protégée) est INSCRIT sous la clé de campagne, sinon re-collecte à vie et jamais de
  « terminé ». Et quand le renommeur change de format, ALIGNER tous les prédicats « déjà rangé ».
- **Étendre `oauthScopes` = arrêt TOTAL du moteur (chien de garde inclus) jusqu'à ré-autorisation
  manuelle.** Un déploiement qui ajoute un scope invalide l'autorisation → TOUS les déclencheurs échouent
  en silence, y compris le watchdog (il meurt avec la panne qu'il devait signaler). Prévenir Marc AVANT le
  merge, regrouper les nouveaux scopes en un seul merge, puis VÉRIFIER la reprise par signaux Drive
  indépendants (heartbeat Sheet, artefact attendu, file `00·À trier` qui se draine). Pour voir une création
  Drive fraîche : `list_recent_files` (recency), pas la recherche (index en retard).
- **Un test qui verrouille un comportement PARAMÉTRÉ par CONFIG dérive ses cas de la constante
  (seuil−1/seuil+δ), jamais de sa valeur du jour.** Codé « 16 $ ≥ 10 », il ment au premier
  rajustement (vécu : plafond campagnes 10→30). Exception : le tripwire qui verrouille la VALEUR
  elle-même — et le dit en commentaire. Corollaire : toute Property « déjà fait/déjà dit » se
  re-audite quand un paramètre qu'elle supposait fixe devient variable (le seuil va dans la clé).
- **Retrait de code : frontières de fonctions + filet de SURFACE.** Jamais de regex multi-lignes pour
  retirer une fonction (elle avale les voisines — vécu ×2, dont `deciderRoutage_` entière) : analyse de
  frontières + assertions de présence des voisines. Les tests unitaires mockés ne voient PAS une fonction
  inter-module disparue → `test/surface-moteur.test.js` charge tout le moteur et vérifie le contrat
  interne ; y ajouter toute nouvelle fonction appelée en travers des modules.
- **Un champ « requis » par le schéma général peut être OPTIONNEL sur un sous-chemin.** Quand une passe
  LLM peut légitimement omettre un champ (un non-document v2 n'a pas de `domaine`), le PARSER PARTAGÉ qui
  l'exige rejette le cas même qu'on voulait traiter → quarantaine à tort (faux positif silencieux). Le
  parser doit tolérer l'omission SUR CE CHEMIN, détecté par un autre signal du même schéma
  (`estNonDocument`/`routageHorsDomaine`), sans relâcher la contrainte sur le chemin nominal. Corollaire
  (instance de « plafonds à l'unité de coût réelle ») : un garde-temps/budget par run calibré pour un
  modèle doit suivre le coût-temps réel par item si on change de modèle (Sonnet ×2 ≈ ×10 le temps/doc →
  `budgetMsRun_()` abaisse le budget sous `ANALYSE_V2`, anti-mur 6 min).
- **`curl` vers une web app Apps Script : jamais `-X POST` combiné à `-L`.** Un `/exec` répond à un
  POST par une redirection 302 vers `script.googleusercontent.com/macros/echo` qui n'accepte QUE
  `HEAD`/`GET` — `-X POST` verrouille la méthode sur TOUTE la chaîne de redirection (court-circuite le
  downgrade POST→GET normal de la RFC) → 405 systématique malgré une requête initiale valide.
  `--data-binary` seul suffit à poser POST sur la 1ʳᵉ requête sans verrouiller les suivantes. Corollaire :
  un payload de taille non bornée en CLI passe TOUJOURS par un fichier (`--data-binary @fichier`),
  jamais par une variable shell interpolée en argument (`ARG_MAX` de l'OS, « Argument list too long »
  sur les gros lots). Et un `curl -v` de diagnostic dans un log CI PUBLIC expurge TOUJOURS le secret
  avant affichage (`sed`) — le masquage automatique de la plateforme ne couvre pas ses transformations
  dérivées (ex. encodage URL). Ces bugs n'apparaissent qu'au premier test RÉEL contre la vraie web app
  déployée, jamais en test local/CI simulé.

## 8. Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri)

> Règle d'or (demande Marc 2026-07-07). Obligatoire pour tout changement du **classement**.

1. **Cadrage ADR d'abord** — problème/objectif, impact quotas Google & coût LLM (estimé), risques
   (garde-fous, intégrité), méthode de test. Aucune ligne de code avant l'ADR.
2. **Audit (PoC) sur du réel** — exécuter la logique de décision sur ~20 documents réels
   (`test/audit-logique.test.js`), rendre le tableau [nom | domaine | entité | verdict] AVANT de
   modifier le pipeline. Prouver le comportement sur du réel, jamais 2-3 cas choisis.
3. **Double-passe** (quand `ANALYSE_V2` est ON) — Passage 1 extrait les faits (date/émetteur/type/
   titulaire ; incertain ⇒ null) ; Passage 2 vérifie (adversarial) et applique la taxonomie ADR-0002.
4. **Fail-safe HYBRIDE ultra-strict** (ADR-0016, §2.1) — « ne jamais deviner » ne veut PAS dire « tout
   en revue » : un doc part en `00 · À vérifier` **uniquement** si `domaine` **ET** `emetteur` **ET**
   `type_doc` sont **tous** NULL (`estClassificationVide_`). Confiance basse SEULE ⇒ classé au mieux
   (jamais dumpé dans `01 · Administratif` par défaut : « granularité = enrichissement, jamais frein »).
5. **Non-régression** — ≥ 3 faux-positifs historiques en test bloquant (CV sans émetteur, note perso,
   export) qui NE doivent PAS partir en revue. CI verte exigée sur ces cas.
6. **Fonctions PURES + revue flotte** — logique isolée des I/O (testable `node --test`), surface
   verrouillée, revue adversariale avant merge. Toute opération de MASSE ⇒ `dryRun_` (validation Sheet).
