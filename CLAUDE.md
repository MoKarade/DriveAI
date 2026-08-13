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
   (b) **`04 · Immigration` : réorganisation INTERNE permise, sortie JAMAIS automatique** *(révision
   ADR-0030 §4, ordre explicite de Marc 2026-07-29 — livrée ATOMIQUEMENT avec `src/Reset.gs`
   `reorganiserInterne04_`/`dossierInterne04Reset_` et son tripwire de surface en C28-33 PR2)*. Un fichier déjà
   rangé sous 04 peut être **déplacé D'UN sous-dossier de 04 VERS UN AUTRE sous-dossier de 04** (fusion
   de graphies, nouvelle structure ≤ 7) — jamais hors de 04. Garde multi-parents `aParentProtege_`
   (remonte toute la chaîne d'ancêtres, appliquée à la collecte ET avant chaque mutation) + tout
   résolveur de cible pour 04 **construit STRUCTURELLEMENT depuis la racine 04** (jamais un chemin
   arbitraire) : impossible par construction de cibler hors 04. Un candidat à la SORTIE de 04 (ex. un
   doc « CIC » qui est peut-être la banque, pas l'immigration) est **PROPOSÉ** à Marc, **jamais déplacé
   d'office**. Multi-parents à l'intérieur de 04 : jamais déplacé (prudence, comme la consolidation).
   (c) un doublon, **même sensible**, va dans `_Doublons` (déplacement seul), jamais effacé.
   *(Élargir la revue = assouplir `estClassificationVide_` ⇒ ré-audit anti-saturation obligatoire. Élargir
   la sortie de 04 = nouvelle révision atomique, jamais un assouplissement silencieux.)*
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
6. **Budget LLM : < 10 $/mois en régime de croisière.** Depuis le 2026-07-09 (ADR-0018, feu vert
   Marc après la preuve C26-07), le flux vivant tourne en **Sonnet 2 passes** (`ANALYSE_V2`). Les
   campagnes de RATTRAPAGE (grand rangement, historique Gmail, migration, re-analyse C26-08) sont un
   coût one-shot plafonné par le frein `CONFIG.LLM_BUDGET_CAMPAGNES` — **110 $ (décision Marc
   2026-07-10, révision ADR-0018 : m1 basculée en v2 par l'allumage du flag, coût/doc ×10 ;
   révise 65 du 2026-07-09 et 30 du 2026-07-07)**, à redescendre vers 10 une fois m1 + C26-08
   finies (checklist dans l'ADR).
   Le frein ne se désactive JAMAIS (filet anti-emballement) et ne gate JAMAIS le flux vivant.

## 3. Conventions de code

- **Langue** : code et commentaires en français ; interface produit bilingue FR/EN.
- **Commits** : en français, préfixés par l'ID de tâche du backlog. Ex. `P1-03: extraction des PJ Gmail`.
- **Branches** : `claude/<slug>` pour le travail automatisé. `main` est protégée par la CI.
- **Nommage des fichiers classés** : `AAAA-MM-JJ_Type_Émetteur.ext`. L'entité est dans le
  *chemin*, jamais répétée dans le nom. Date absente → date de réception du mail.
- **Discipline de scope** : on livre par phases. Ne pas anticiper une phase ultérieure.
  Voir `BACKLOG.md` pour le périmètre exact de chaque phase.

## 4. Workflow automatisé

### NotebookLM — ABANDONNÉ COMPLÈTEMENT (décisions Marc 2026-07-28 et 2026-07-29)

> L'ancienne règle « NotebookLM = analyse architecturale & décision ; Claude = exécution »
> (décision Marc 2026-07-07) est **RÉVOQUÉE**, et Marc a confirmé le 2026-07-29 l'**abandon
> COMPLET** de NotebookLM : plus aucun passage obligé, plus aucun rappel « ajouter comme source »
> (l'ancienne règle « Nouveau fichier ⇒ prévenir le PM » est retirée avec). **Claude conçoit ET
> exécute directement.** Ce qui REMPLACE le contrôle : le protocole §8 (ADR d'abord pour tout
> changement de classement) reste OBLIGATOIRE, fonctions pures testées, et **revue flotte
> adversariale AVANT merge** (code-reviewer + le spécialiste concerné — leçon C28-32 : la revue
> se fait AVANT, jamais après). Le miroir Drive (ADR-0017) tourne encore au merge (inoffensif) ;
> le déclasser (`sync-drive.yml`) est une option ouverte, sur demande de Marc.

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

## 6 ter. En-têtes de sécurité (`vercel.json`)

Ajoutés le 2026-07-31 — DriveAI n'en avait **aucun**. Ils vivent dans `vercel.json` (SPA Vite
servi en statique, pas de config de framework où les mettre).

⚠️ **`vercel.json` REFUSE les clés de commentaire `//…`** (contrairement à `package.json`) :
son schéma rejette toute propriété additionnelle et le déploiement échoue avec
`should NOT have additional property`. D'où cette note ici plutôt que dans le fichier.

- **Enforcés** (aucun risque) : HSTS 1 an + `includeSubDomains`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **CSP en `Report-Only`**, volontairement. DriveAI est le cas le plus délicat de
  l'écosystème : par **ADR-0007**, l'app lit la Sheet d'état **depuis le NAVIGATEUR** avec le
  jeton OAuth de Marc (le serverless n'y a aucun accès). `connect-src` doit donc autoriser
  `sheets.googleapis.com` / `www.googleapis.com` / `accounts.google.com`. Une CSP trop serrée
  couperait l'app de ses propres données — **silencieusement**, sans que le build ni les tests
  ne le voient.
- ➜ **Pour passer en enforcé** : ouvrir l'app, parcourir l'explorateur, la corbeille et
  l'assistant, vérifier qu'aucune violation CSP n'apparaît en console, puis renommer la clé
  `Content-Security-Policy-Report-Only` en `Content-Security-Policy`. Tant que ce n'est pas
  fait, la CSP **observe** — elle ne protège pas.

## 6 bis. Intégration Hub (widget DriveAI sur hubperso.com)

DriveAI expose un résumé au **hub perso** (`hubperso.com`) via **un seul endpoint** :
`GET /api/hub/summary` (`api/hub/summary.ts`, serverless Vercel). URL canonique de l'app :
**`https://drive.hubperso.com`**.

- **Contrat** : `@mokarade/hub-contract` v1 (devDependency de `app/`). La forme du payload est
  **inlinée** dans `api/hub/summary.ts` (api/ reste **zéro dépendance npm par construction**) et
  **verrouillée** par le VRAI schéma du package (`validateSummary()` + `buildingSummary()`) dans
  `app/test/hub-summary.test.ts`. Toute évolution du contrat passe par le package (bump de version
  + re-pin), **jamais** par une divergence locale.
- **Auth (échec fermé)** : le hub envoie le header `x-hub-token`. Comparaison en **temps constant**
  (digests SHA-256 + `timingSafeEqual`). `HUB_TOKEN` (variable d'env Vercel, jamais en dur) absent
  → **503** `hub disabled` ; jeton absent/faux → **401** ; méthode ≠ GET → **405**. Réponse toujours
  `Cache-Control: no-store`.
- **HONNÊTETÉ (no-fake-data)** : le point de bascule est `api/hub/_engineState.ts` →
  `getEngineState()`. **Phase 0 (aujourd'hui)** : il renvoie `null` ⇒ summary `status:"building"`
  (zéro métrique inventée). Les données réelles vivent dans la Google Sheet, lue **côté navigateur**
  avec le jeton OAuth de Marc (ADR-0007) — le serverless Vercel n'y a **aucun** accès.
- **Règle de maintenance** : à chaque phase du moteur qui rend une métrique disponible, la brancher
  dans `getEngineState()` et faire passer le summary à `status:"ok"` (métadonnées **seulement**,
  ADR-0007). Ne **jamais** casser le schéma (toute évolution passe par `hub-contract`) ni publier de
  donnée fabriquée : `building` tant que rien de réel n'est disponible.
- **QUOTA — le broker met en cache (60 s), et c'est structurel.** Le hub poll ce endpoint
  **toutes les 15 s** tant qu'un onglet est ouvert, alors que le moteur ne recalcule le résumé
  qu'**une fois par tick** (`CONFIG.TICK_MINUTES = 5`, persisté dans `DriveAI_HUB_SUMMARY`).
  Sans cache, 19 polls sur 20 déclenchaient une exécution Apps Script pour renvoyer des octets
  identiques — sur un budget **DUR de 90 min/jour** de temps d'exécution, partagé avec le tick
  lui-même. `_engineState.ts` garde donc le dernier état lu pendant 60 s. Aucune fraîcheur perdue
  (la donnée bouge toutes les 5 min) et `dataAsOf` continue d'exposer la fraîcheur réelle.
  ⚠️ Les **pannes ne sont jamais mises en cache** — un `throw` doit rester observable et le
  prochain appel doit réessayer. ⚠️ Cache de **process** : vide au démarrage à froid, non partagé
  entre instances → taux de succès partiel, ce qui reste tout bénéfice (chaque succès = une
  exécution économisée). Toute nouvelle voie d'appel depuis le hub doit se poser la même question.

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
  code est masqué) — vérifier `git push; echo $?`. Après toute fusion de rattrapage post-squash,
  vérifier par `grep -c` l'UNICITÉ des blocs/appels DÉPLACÉS : l'auto-merge garde silencieusement
  les deux exemplaires (« Auto-merging » vert, 0 conflit — vécu ×2, appel exécuté 2×/tick).
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
- **Auto-déploiement (CI/CD) : 5 pièges.** (1) Un merge par le bot `GITHUB_TOKEN` (auto-merge) ne
  déclenche PAS les workflows `on: push` (anti-récursion) → l'auto-merge doit **dispatcher** le déploiement
  (`gh workflow run`, `actions: write`). (2) Épingler la version Node des outils CLI sensibles (clasp v3
  → Node 20 ; Node 22 = « Premature close »). (3) **Un `clasp push` VERT ne garantit PAS que le
  déclencheur time-based exécute le nouveau code** : Apps Script peut continuer la version
  précédemment chargée jusqu'à ce que le projet soit RÉOUVERT dans l'éditeur / une fonction y soit
  exécutée (vécu 07-15 : CI verte mais prod figée ~4 j — `MIGRATION_TAG` périmé, onglet Sheet jamais
  créé, plafonds jamais appliqués, ZÉRO erreur). Donc « vérifier qu'un déploiement a réussi » = lire
  les runs **ET** confirmer que le code a PRIS EFFET par un **signal INDÉPENDANT** : comparer une
  CONSTANTE du code déployé (tag de campagne, existence d'un onglet/fonction) à ce que la prod ÉCRIT
  réellement, pas le statut du run. Remède : Marc ouvre l'éditeur + exécute `installerTrigger`.
  Corollaire diagnostic : ne pas inventer un « second projet fantôme » sans preuve — une vérif de
  stabilité (la constante reste fraîche sur plusieurs ticks) réfute l'hypothèse à deux projets.
  (4) **La WEB APP `/exec` sert une VERSION ÉPINGLÉE, indépendante du HEAD** (distinct du piège 3 sur
  le tick) : `clasp push` met à jour le code mais `/exec` sert l'ANCIEN tant qu'on ne redéploie pas.
  Une nouvelle action `doPost` inconnue de l'ancienne version NE plante PAS — elle tombe dans le `else`
  par défaut et renvoie `{ok:true}` SANS le champ attendu → **panne SILENCIEUSE** (réponse vide, aucune
  erreur ; vécu C28-30 : chat muet). Diagnostic : « champ manquant / réponse vide, pas d'erreur » = action
  non déployée, PAS un bug de code (lire le `else` du `doPost`). Remède désormais AUTOMATISÉ :
  `deploy.yml` fait `clasp deploy -i $WEBAPP_DEPLOYMENT_ID` (Nouvelle version, /exec inchangé) si le
  secret est posé ; sinon redéploiement manuel (Gérer les déploiements → ✏ → Nouvelle version).
  (5) **`clasp deploy` sans bloc `webapp` dans `appsscript.json` REMET l'accès de la web app à un
  DÉFAUT restrictif** (≠ « Tout le monde ») → tous les appels ANONYMES (fetch navigateur de l'app +
  POST GitHub Actions du miroir, pourtant gardés par un SECRET) sont refusés au niveau réseau →
  **« Failed to fetch » + Sync Drive rouge** (vécu C28-30, dès qu'on a automatisé le `clasp deploy`).
  Le redéploiement MANUEL (édition du déploiement existant) préservait l'accès ; le CLI, non. Règle :
  **tout geste manuel qu'on AUTOMATISE en CLI doit déclarer EXPLICITEMENT ce qu'il préservait
  implicitement** — ici `"webapp": {"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}` épinglé
  dans le manifeste (n'ÉTEND pas l'accès — la web app était déjà ainsi, le secret reste le garde). Et
  corollaire du piège (3) : « déploiement vert » ≠ « ça marche » — le SEUL vrai signal reste un appel
  RÉEL (Marc teste, ou le Sync Drive redevient vert), jamais le statut du run.
- **Branche `claude/**` partagée entre sessions : `force-with-lease` rejeté = enquêter, jamais forcer.**
  Un « stale info » signifie que le distant a bougé — une AUTRE session a pu ouvrir/merger une PR SUR ta
  branche désignée (vécu C28-30 : lien Hub #205 mergé dans la branche, jamais dans `main`). Forcer aurait
  détruit son travail. Réflexe : `git ls-remote` + `pull_request_read` AVANT toute écriture, puis
  **rebaser mon commit sur le TIP distant** (`git rebase origin/<branch>`) pour empiler sans clobberer
  (push fast-forward). Vérifier `git diff origin/main <mon-commit-déjà-squashé>` == vide ⇒ la PR restera propre.
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
  **Corollaire (2026-07-30) : quand un RAPPORT EXHAUSTIF existe, ne jamais chiffrer depuis un échantillon.**
  Tout volume/diagnostic annoncé à Marc se lit DANS l'artefact prévu pour ça (onglet de rapport, Index,
  Journal), jamais par extrapolation du premier dossier venu (vécu : « une dizaine » de non-routés
  annoncés d'après UN dossier, contre **134** au rapport — 13×). L'erreur de grandeur fixe la priorité
  (anecdote vs chantier structurel) et surtout **masque la distribution** : c'est le COMPTAGE PAR
  CATÉGORIE sur l'ENSEMBLE qui révèle la cause commune (ici « dossiers manquants », pas « règles
  manquantes »), invisible sur un échantillon. Artefact trop gros ? l'AGRÉGER, jamais en lire le début.
  **Corollaire (2026-08-05, incident rangement) : un instantané de la SOURCE ne distingue pas « bloqué »
  de « lent (pacé) ».** Pour diagnostiquer un backlog qui semble ne pas se vider, AVANT de crier au bug :
  (1) regarder la **DESTINATION** — le dossier cible se remplit-il (ex. `05/CV & lettres` = 60 CV rangés
  ⇒ le pipeline MARCHE) ; (2) lire la **CADENCE** dans l'état (budget/jour consommé ⇒ « repris demain »,
  pas « cassé » ; curseur exec qui avance) ; (3) chercher un **ALIMENTEUR CONCURRENT** qui regonfle la
  source et masque le drainage net (ancien code pas rechargé, autre campagne — vécu : le reset déversait
  dans les racines pendant que je comptais « ça monte ») ; (4) ne PAS fonder la fraîcheur sur
  `modifiedTime`/`search_files` (index en retard, `moveTo` ne bumpe pas le contenu) — COMPTER la
  destination. La certitude runtime vient du **diagnostic un-clic** (Properties + comptage via le code
  DÉPLOYÉ), jamais d'un échantillon Drive. Et après un diagnostic dur RÉUSSI (piège 3), ne pas enchaîner
  un 2ᵉ verdict à la va-vite sur un signal partiel : chaque conclusion se re-prouve sur son propre axe.
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
  **Corollaire (incident 2026-07-23, consolidation) : un budget QUOTIDIEN ne borne RIEN si le gate PAR TICK
  coupe l'étape avant qu'elle démarre.** La consolidation (budgets/jour 12+20 min) était placée EN DERNIER,
  gatée par le budget de tick 3 min (`estBudgetDepasse` sous ANALYSE_V2), après la réconciliation
  « perpétuelle sur le reliquat » → jamais atteinte, zéro drainage pendant que le heartbeat restait vert. Deux
  correctifs conjoints : (1) **remonter** l'étape TÔT (après le flux vivant, avant les campagnes basses
  priorité) — l'ORDRE prime sur les budgets ; (2) **« BUDGET TAIL »** : une tâche PURE I/O (Drive/Sheet, sans
  risque LLM) peut recevoir un garde ÉTENDU au vrai mur Apps Script (`CONFIG.BUDGET_MS` 4,5 min) au lieu du
  budget de tick 3 min réservé aux appels Sonnet — placée APRÈS le flux vivant, elle n'utilise que le reliquat
  jusqu'au mur, garantie de tourner sans lui voler une ms. Vérifier une étape « qui écrit son état mais ne
  produit rien » = d'abord se demander si elle est seulement ATTEINTE (ordre/budget), pas si sa logique est juste.
- **Une clé d'idempotence encode TOUT l'état qui commande la décision.** C'est un instantané, pas
  un identifiant : chaque variable dont dépend l'action doit être DANS la clé (ex. tri Gmail :
  `tri|fil|ts|lu` — sans le flag lu/non-lu, un mail lu APRÈS son tri n'aurait jamais été archivé).
  Revue systématique : « quel changement d'état devrait re-déclencher l'action, est-il dans la
  clé ? » Et deux documents qui doivent bouger ensemble (manifeste ↔ constitution) se verrouillent
  par un tripwire CI, pas par la discipline. **Corollaire VERDICT NÉGATIF (C28-33) : quand la
  décision dépend d'une TABLE DE RÈGLES du code, la VERSION de cette table fait partie de l'état.**
  Une clé posée sur un « je n'ai pas su faire » (non routé, non reconnu, ignoré) le fige À VIE :
  affiner la règle devient sans effet, et on annonce à l'utilisateur un correctif qui ne s'applique
  jamais. Mettre la version dans la clé (`…|<tableVersion>|<id>`) rend l'affinage effectif ; c'est
  sûr tant que la COLLECTE ne re-présente que le reliquat (ici `_TRI` seul — le déjà-rangé n'y est
  plus, donc jamais re-déplacé). Réflexe : « cette clé mémorise-t-elle un SUCCÈS (définitif) ou un
  ÉCHEC de règle (révisable) ? » — le second exige la version.
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
  déjà-indexés n'occupe aucune place) + tri FIFO ancien→récent (intake Drive, R3) ; et quand le
  scan LUI-MÊME retire les items du résultat (archivage — C28-24), l'offset n'avance que des items
  RESTANTS : le travailleur rapporte l'effet réel dans son retour (`'archive'` vs `'traite'`),
  tous les appelants mis à jour, test sur la SUITE des offsets d'une page mixte. Toujours
  **tracer un scénario concret sur plusieurs ticks** avant de valider une pagination — c'est ce qui
  révèle un plateau silencieux. **Corollaire (Vague 2) : copier un « mur page à jour » d'un scan à
  un autre exige AUSSI son backstop, et le TYPE de backstop se DÉRIVE de la sémantique de l'état
  scanné, il ne se copie pas.** État MUTABLE (peut redevenir « à traiter » : lu/non-lu, statut
  révisable) ⇒ balayage CYCLIQUE perpétuel (offset persistant + plafond quotidien dans l'unité du
  quota, `scanCycliqueTri_`). État TERMINAL (traité = plus jamais re-vu : PJ indexée, fichier classé)
  ⇒ PAS de cyclique (il re-lirait l'immuable et brûlerait le quota) mais un simple DRAPEAU qui
  désactive le mur tant qu'un backlog est possible (armé aux coupes budget/panne/erreur AVANT la fin
  de fenêtre, levé dès qu'une passe atteint la fin naturelle `!fils.length` ; `DriveAI_GMAIL_PJ_RETARD`)
  — repagination complète pendant le drainage seulement, mur (perf) le reste du temps, zéro écriture
  d'état en régime. Avant de copier un garde-fou de scan : « l'état que JE scanne peut-il redevenir
  actif tout seul ? » — la réponse choisit le filet. Et tout NOUVEL accès d'état (Property/Sheet)
  ajouté à une étape d'intake appelée NUE s'ENVELOPPE d'un try/catch qui dégrade sans throw (un blip
  ne doit jamais avorter l'intake).
- **Un garde-fou qui met des items HORS CIRCUIT exige un chemin de RETOUR auto.** Une quarantaine
  sans dé-quarantaine automatique transforme un incident transitoire (panne de crédit) en perte
  permanente et silencieuse (32 fichiers sautés à vie, R3 : one-shot gaté par tag, ré-armé par le
  rétablissement de panne). Et un frein budget (§2.6) met en pause les CAMPAGNES, jamais le flux
  vivant — sinon « le moteur marche » pendant que la boîte de dépôt de Marc est morte.
- **Campagne Gmail : requête figée ⇒ appartenance stable, mais l'ORDRE bouge quand même** (tri par
  DERNIER message, suppressions) — l'offset persistant sert à PROGRESSER, jamais à prouver la
  COMPLÉTUDE. Celle-ci vient de « terminé quand DEUX passes complètes consécutives ne collectent
  plus rien » (offset remis à 0 si la passe a eu de l'activité ; la re-passe n'est « quasi gratuite
  par l'Index » que côté TRAITEMENT — côté quota de LECTURE elle coûte plein pot et se
  budgète/priorise comme la campagne elle-même, vécu 07-13 : la passe de vérification historique a
  affamé le tri plusieurs jours), avec abandon tracé d'un fil en échec après N essais — comptés par PASSE (à la complétion
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
  Corollaire FLAG (vécu : bascule `ANALYSE_V2`, 3 tests cassés) : un test d'un CHEMIN gaté par un
  flag de campagne FORCE ce flag dans son contexte (save/restore) — la position globale d'un flag
  est une décision de Marc, jamais un invariant de test.
- **Une Script Property qui persiste une LISTE paramétrée par CONFIG se borne contre ~9 Ko.**
  Encodage COMPACT (table d'index pour les champs répétés, jamais le libellé en clair par item) +
  test au PLAFOND dérivé de la CONFIG (borne haute de la marge documentée, pas la valeur du jour) —
  sinon `setProperty` lève au premier rajustement et la collecte amont est refaite en boucle sans
  jamais persister (repéré en revue C26-07 : 150 items naïfs ≈ 12,5 Ko > limite).
- **Retrait de code : frontières de fonctions + filet de SURFACE.** Jamais de regex multi-lignes pour
  retirer une fonction (elle avale les voisines — vécu ×2, dont `deciderRoutage_` entière) : analyse de
  frontières + assertions de présence des voisines. Les tests unitaires mockés ne voient PAS une fonction
  inter-module disparue → `test/surface-moteur.test.js` charge tout le moteur et vérifie le contrat
  interne ; y ajouter toute nouvelle fonction appelée en travers des modules. **Corollaire (audit
  2026-07-31) : un test de SURFACE ne voit que l'EXISTENCE, jamais le CONTENU.** Une chaîne longue
  concaténée par `+` multi-lignes (prompt LLM, message) dont un `+` de fin de ligne manque est tronquée
  EN SILENCE par l'ASI (`return A + B ⏎ C + D` ⇒ `return A + B;` puis statement mort) — zéro erreur,
  surface verte. La verrouiller par un test de CONTENU qui asserte les marqueurs situés APRÈS chaque
  point de coupure, dont le TOUT DERNIER fragment (dernière phrase, date interpolée) ; prouver par mutation.
- **Allumer un flag qui change le modèle/coût du pipeline re-tarife AUSSI les campagnes déjà en
  cours** (elles re-passent leurs documents au pipeline COURANT — vécu : m1 basculée en Sonnet ×2
  par `ANALYSE_V2`, mois doublé en une nuit). Avant d'allumer : inventorier les consommateurs
  ACTIFS du pipeline, re-chiffrer leur stock restant à la nouvelle unité de coût, dimensionner le
  frein pour le TOTAL — et faire valider l'effet de bord (campagne héritée = re-analyse de fait).
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
- **Appel `/exec` Apps Script : le succès se juge au CONTENU (JSON `ok:true`), jamais au code HTTP.**
  Les pannes transitoires sous POST en rafale ont DEUX signatures : un non-200 (404 « Sorry, unable to
  open ») ET un 200 avec une page HTML à la place du JSON (« Script function not found: doGet »).
  Rejouer (borné) tout ce qui n'est pas un JSON `ok:true` ; un JSON propre `ok:false` (secret/config)
  est PERMANENT — échouer vite. Et un pipeline par lots dont un lot peut se perdre doit FAIRE ÉCHOUER
  le run : un compteur d'« envoyés » (pas d'écrits) + un warning dans un run vert = trou silencieux
  (vécu : 25 fichiers manquants dans le miroir).
- **Fallback de CRÉATION d'une ressource d'ÉTAT : « absente » ≠ « inaccessible ».** Un `openById`
  d'état (Sheet, dossier) qui échoue TRANSITOIREMENT ne doit JAMAIS re-créer la ressource ni
  écraser son ID (vécu 07-08 : `getSheetEtat_` a forké tout l'état sur un blip Google — Index
  re-fait, ~87 PJ re-déposées en copies, app orpheline, heartbeat VERT pendant 13 h). Créer
  seulement si l'ID est ABSENT (première installation) ; sinon échec fermé, re-essai au tick
  suivant. L'IDENTITÉ de la ressource d'état est un invariant à verrouiller, pas juste son contenu.
- **Consigne manuelle Apps Script = fichier .gs D'ABORD.** Toute instruction « exécute X dans
  l'éditeur » nomme le FICHIER puis la fonction (« ouvre `Maintenance.gs` → `fusionnerDomaine…` →
  Exécuter ») — l'éditeur choisit les fonctions PAR fichier, sans lui Marc doit fouiller le projet.
  **Corollaire (2026-08-06) : un « diagnostic un-clic » n'est un signal de CERTITUDE que s'il est
  COMMITTÉ ET déployé.** Avant de dire « exécute X », `grep` que X EXISTE réellement dans `src/` (une
  fonction citée de mémoire mais jamais posée — vécu : `diagnosticRangement2` — fait retomber chaque
  « check » sur l'index Drive qui RETARDE, verdict toujours incertain, et peut fonder un faux « prouvé »
  dans un document vivant), puis rappeler qu'elle doit être DÉPLOYÉE (piège 3). Tout point d'observation
  promis se COMMIT dans le même geste (comme « promesse de verrou = verrou codé dans le même commit »).
  Et quand un re-check contredit un « prouvé/ça marche » antérieur, corriger le document vivant
  IMMÉDIATEMENT — jamais laisser une conclusion périmée en tête.
- **Un quota PARTAGÉ se répartit par PRIORITÉ, se borne dans SON unité, se suspend en panne.**
  L'ORDRE des étapes du tick est la politique d'allocation d'un quota partagé (appels Gmail/jour) :
  flux vivant AVANT campagnes, sinon le premier arrivé se sert (vécu : tri affamé à 8h10). Un
  budget en ms de runtime ne borne PAS un quota d'appels — chaque quota se borne dans sa propre
  unité. Quota épuisé = panne de plateforme : suspension persistée + re-sonde bornée, sur TOUS
  les chemins d'appel (catch par item inclus) — jamais des re-tentatives en boucle.
- **Gmail : threadId = messageId du PREMIER message.** Deux entités (fil, message) ne partagent
  JAMAIS le même préfixe de clé d'idempotence (`intention|<threadId>` serait entré en collision
  avec `intention|<messageId>` — fils entiers sautés à tort) : préfixe DÉDIÉ par entité + test de
  collision. Vérifier les identités de plateforme qu'un plan validé suppose distinctes.
- **Campagne de rangement ⇒ CIBLE calculée par LA MÊME fonction pure que le flux vivant +
  tripwire.** Deux formules « équivalentes » écrites séparément divergent toujours quelque part
  (année, canonisation, champ source) → la campagne re-déplace en boucle ce que le flux vient de
  classer (non-convergence structurelle, vécu C28-26 : cible `02/AAAA/Entité` vs flux à plat).
  Une seule règle, deux consommateurs, verrouillée par un test « la sortie du flux est OK pour la
  campagne ». Corollaire : un référentiel (entités validées) consulté par la campagne doit l'être
  AUSSI par le flux — sinon l'un crée ce que l'autre défait.
- **Nouveau module qui propose de muter/cibler des dossiers ⇒ hériter les gardes de ses VOISINS
  (reset/conso/réorg), sinon mouvements NON convergents.** (Vécu #47 : `Fusion.gs` listait les buckets
  de `STRUCTURE_CIBLE_RESET` comme des entités et pouvait proposer de VIDER un bucket que le reset recrée
  PAR NOM — ping-pong.) Deux gardes récurrentes : (a) un **segment structurel** (bucket du reset, année/
  schéma `estSegmentStructurel_`, type d'identité — find-or-créé PAR NOM) n'est JAMAIS une SOURCE (jamais
  vidé), au mieux une CIBLE gardée d'office ; (b) tout NOUVEAU rapprochement respecte la règle de fusion
  OFFICIELLE (`estFusionnableEntite_` : « une ANNÉE excédentaire distingue deux entités réelles »).
  ⚠️ Deux canonicaliseurs du projet DIVERGENT : `canoniserEntite_`/`canoniserVehicule_` RETIRE l'année
  (unification DOCUMENT→entité) ; `estFusionnableEntite_` la GARDE (distingue deux dossiers). Choisir
  celui qui correspond à la décision (identité de DOSSIER ⇒ celui qui DISTINGUE) et placer le veto AVANT
  le canonicaliseur qui écrase le signal. Réflexe de revue : « quel garde mes voisins ont-ils que je n'ai pas ? »
  **Corollaire EXÉCUTION (#47 PR2) : un invariant « JAMAIS X » affiché au DRY-RUN comme un DÉFAUT
  overridable n'est PAS un garde — il se RÉ-APPLIQUE à la MUTATION (fail-closed), avec le MÊME prédicat
  que le plan (une seule fonction).** La curation opt-out (`Ignorer (structurel)` par défaut) ne remplace
  pas le refus codé juste avant le `moveTo` : sinon l'override de Marc vide un bucket que le reset recrée
  (ping-pong) sans qu'aucune ligne ne l'arrête. Et un effet de bord voisin (`repointerEntites_`) hérite
  des MÊMES exclusions structurelles que la mutation (jamais re-pointer une entité vers un fourre-tout).
  Réflexe : pour chaque « JAMAIS » promis par un plan, trouver la ligne qui le re-vérifie avant l'écriture.
- **Un verrou posé à la CRÉATION d'un jeton longue durée n'arrête pas le stock déjà émis.** Un
  contrôle d'accès vérifié à l'ÉMISSION (pas à chaque utilisation) d'un cookie/jeton/clé se
  déploie AVEC l'invalidation de l'existant (rotation du secret qui les chiffre/signe — une
  reconnexion suffit au légitime), sinon les jetons pré-verrou portent les anciens droits
  jusqu'à expiration (vécu C28-20 : cookie 1 an vs verrou ALLOWED_EMAIL au callback). Réflexe
  de revue : « vérifié à l'émission ou à l'usage ? si à l'émission, qu'est-ce qui invalide
  l'existant ? »
- **Une BORNE sur une entrée qui CROÎT se TRONQUE, ne se REJETTE pas.** Un rejet au-delà de N sur une
  entrée qui grossit naturellement (historique de chat ré-envoyé en entier à chaque tour, liste
  accumulée côté client) casse la feature EN SILENCE dès que l'usage normal dépasse N (vécu C28-30 :
  chat > 20 messages → « historique invalide »). Garder les N plus RÉCENTS ; si la séquence porte un
  invariant de protocole (API Messages : 1er tour = user, alternance stricte), couper sur une frontière
  qui le PRÉSERVE (frontière PAIRE = un `user` en tête), jamais un `slice(-N)` naïf. La validation tourne
  APRÈS la troncature, sur le tableau EXACT envoyé (défense en profondeur).
- **Un statut TERMINAL ne peut pas servir de signal d'OCCUPATION.** Un gate d'attente (« ne
  recommence pas tant que X n'est pas traité ») doit lire un état qui REVIENT à la normale. Pour
  chaque statut lu par un gate : « qui l'écrit ensuite, et est-ce que ça arrive ? » — si personne,
  c'est un verrou définitif (vécu C28-32 : gate sur `proposé`, terminal ⇒ campagne morte dès la 1re
  analyse). Et un gate se teste par sa LIBÉRATION (cycle occupé → traité → libre), pas seulement par
  son blocage : un test qui n'asserte que le blocage VERROUILLE le bug.
- **Une campagne ONE-TIME dont la CONVERGENCE est inatteignable sur un flux VIVANT gèle les campagnes
  voisines gatées sur elle (deadlock, heartbeat vert).** Un critère de fin « une passe complète ne
  collecte plus rien » (`examines===0`) NE CONVERGE JAMAIS si une source CONTINUE (intake, dépôts)
  réalimente le périmètre scanné avant chaque passe (vécu ADR-0035 : le reset, gaté AVANT le
  rassemblement mais l'intake tournant AVANT lui, `resetEnCours_()` true à vie ⇒ consolidation
  suspendue à vie ⇒ 305 fichiers legacy à plat, jamais re-rangés). Symptôme : `enCours_()` true depuis
  des JOURS + campagnes voisines à l'arrêt + backlog figé ⇒ suspecter la CONDITION DE FIN, pas le
  débit ni le budget. Filets : (a) drapeau « unité (domaine) épuisée » qui isole les nouveaux
  arrivants du critère de fin (comme la conso) ; (b) ne JAMAIS gater une campagne PERPÉTUELLE (le
  rattrapage) sur l'état d'une campagne ONE-TIME. Diagnostic prod (Claude ne peut pas exécuter le
  moteur) : une fonction de DIAGNOSTIC UN-CLIC lecture seule (Properties + comptage via le code
  DÉPLOYÉ) tranche un INCERTAIN runtime en CERTAIN — signal indépendant, jamais un échantillon Drive.
  Corollaire : re-lancer une campagne à clé de SUCCÈS ne re-traite pas ce qu'elle a figé « OK » —
  bumper la VERSION/tag pour re-évaluer sous les règles courantes.
- **Message de commit avec des backticks ⇒ `git commit -F fichier`, jamais `-m "…"`.** Citer les
  identifiants entre backticks est la convention d'écriture du projet : en INLINE dans bash, ils
  déclenchent une SUBSTITUTION DE COMMANDE et l'identifiant DISPARAÎT du message — commit réussi
  (exit 0), seul un discret `command not found` sur stderr (vécu C28-31). Idem pour `$`/`!`.
  Corollaire : vérifier un artefact écrit via shell en le RELISANT (`git log --format=%B`), jamais
  au seul code de sortie.
- **Un mock réutilisé sur plusieurs objets factices doit lire l'ARGUMENT reçu, jamais la fermeture
  de construction du contexte.** Un test qui traite 2 fichiers factices avec le MÊME contexte `c`
  (patron `ctxLigne`/`ctxPlacement`) et mocke une fonction cross-module par `() => 'X' + opts.id`
  (au lieu de dériver de l'argument reçu, ex. `(blob) => 'X' + blob.id`) fige la valeur sur le
  PREMIER objet construit — le 2ᵉ hérite silencieusement de la même valeur (vécu C28-33 : deux
  fichiers différents jugés « même empreinte »). Toute fonction mockée qui varie PAR OBJET lit sa
  variation dans son propre argument, jamais dans des `opts` figés à la construction.
  **Corollaire (Vague 3c) : une dédup « par run » ne peut PAS vivre dans une structure RECONSTRUITE à
  chaque item.** Muter un objet d'une carte re-bâtie à chaque appel (`entitesValideesParCle_`
  reconstruit son DTO par document, jamais rechargé en cours de tick) = code MORT : la mutation est
  jetée avec l'objet, l'item suivant repart de l'ancienne valeur. La dédup doit vivre dans une
  structure à portée RUN que la reconstruction ne réinitialise pas (set module-level frais par
  exécution Apps Script, ou `ctx.repointes` passé explicitement comme le reset). Réflexe : « l'état
  où j'écris ma dédup SURVIT-il jusqu'au prochain item ? » Et un mock qui rend un OBJET PARTAGÉ
  (`() => memeObjet`) là où la vraie fonction RECONSTRUIT par appel prouve une propriété fausse — le
  mock reconstruit par appel, prouvé par mutation (l'ancienne approche doit faire échouer le test).
- **Un budget calibré pour UN CHEMIN d'exécution ne doit ni brider, ni être consommé par, un AUTRE
  chemin.** Les budgets quotidiens protègent le quota RUNTIME des DÉCLENCHEURS (~90 min/j) ; une
  exécution MANUELLE depuis l'éditeur en est HORS. Les appliquer quand même = DOUBLE peine (vécu
  C28-33, 1ᵉʳ run réel) : (a) Marc bloqué jusqu'au lendemain sans qu'aucun quota réel soit en cause,
  (b) pire, son run manuel CONSOMMAIT le budget du tick → l'automatique affamé toute la journée.
  Dès qu'un ADR/commentaire écrit « hors quota X », le VÉRIFIER dans le code : drapeau explicite
  (`manuel`) coupant À LA FOIS le gate ET le comptage, testé dans les DEUX sens. Ce défaut
  n'apparaît qu'au PREMIER USAGE RÉEL — une suite verte ne le voit pas ; seule l'observation de ce
  que l'utilisateur peut réellement FAIRE le révèle.
- **Accélérer une campagne sous plafond PARTAGÉ : RÉALLOUER, jamais AUGMENTER.** Relever un budget
  quand un plafond protège une ressource partagée (quota runtime ~90 min/j) = le piège du GEL de TOUS
  les déclencheurs, chien de garde inclus (C28-29). Patron : (1) gater les campagnes sacrifiables sur
  le MÊME prédicat que la prioritaire (`!resetEnCours_()`) — elles reprennent SEULES à la convergence,
  jamais un ré-armement manuel ; (2) choisir celles dont le retard est sans conséquence (rattrapage)
  ou dont le travail serait de toute façon défait par la prioritaire (la réconciliation Index
  constaterait des « déplacé » sur des mouvements VOULUS que le reset inscrit lui-même) ; (3)
  VERROUILLER l'invariant par un test DÉRIVÉ des constantes (`budget(prioritaire) ≤ Σ budgets(suspendues)`)
  et le prouver par MUTATION — gonfler un budget doit faire ÉCHOUER le test, sinon il ne protège rien.
  Corollaire produit : « fais-le automatiquement » alors que c'est DÉJÀ automatique = la vraie demande
  est la VITESSE — le dire, puis laisser à Marc l'arbitrage vitesse/risque plutôt que de relever un
  plafond de sécurité à sa place. **Corollaire (C28-42) : une réallocation se PROUVE dans l'UNITÉ du
  quota protégé (min/JOUR), jamais par un « créneau par tick libéré »** — si les campagnes remplacées
  n'avaient pas de constante quotidienne, rien n'est libéré et la nouvelle étape est une ADDITION
  nette. Toute nouvelle campagne de fond reçoit SA constante `*_BUDGET_JOUR_MS` prélevée sur
  l'enveloppe, ajoutée À LA SOMME du test d'invariant (qui est structurellement AVEUGLE à une étape
  sans constante — il reste vert pendant que l'enveloppe croît), re-prouvée par mutation.
- **Deux bornes sur une même boucle : lire l'UNITÉ dans laquelle le budget est COMPTÉ avant d'en
  déduire un débit.** Quand une boucle porte un garde-TEMPS et un plafond d'ITEMS, la question n'est
  pas seulement « laquelle mord ? » mais « le budget qui plafonne la JOURNÉE est-il compté en ms
  CONSOMMÉES ou en runs ? ». En ms consommées, un run qui coupe tôt sur le plafond d'items ne perd
  RIEN : le reliquat reste disponible au tick suivant — relever le plafond n'achète que
  l'amortissement du coût FIXE de setup par run (**quelques %**, jamais un facteur). *(Correction
  d'une version antérieure de cette règle qui annonçait « du budget gaspillé à chaque run » : faux,
  démontré en revue #229 le jour même.)* Le vrai levier de débit est de **réduire le travail PAR
  ITEM** (ne pas re-télécharger des octets déjà hashés, mémoïser les résolutions de dossier), pas de
  relever une borne. Sûreté qui reste vraie : le garde-temps doit être évalué À CHAQUE ITEM, **y
  compris dans les COLLECTES récursives**, sinon relever le plafond déborde le temps. Et un chiffre
  d'accélération s'annonce APRÈS l'avoir dérivé du modèle de coût, jamais depuis l'intuition
  « la borne sautait, donc ça va plus vite ».
- **Réallocation en PAIRE (A→B) : verrouiller la SOMME DU COUPLE par un test dédié, pas seulement
  l'agrégat ≤ plafond.** L'agrégat protège contre une hausse globale, jamais contre un transfert à
  moitié annulé (A réactivée, son budget rendu, mais B pas redescendu) — ce cas reste sous le
  plafond et le test global reste vert (vécu : 62 ≤ 65 invisible). Verrouiller (a) `A + B = constante`
  et (b) l'interdit « campagne ACTIVE à budget quotidien 0 » (signe d'un transfert non rendu — elle
  tournerait à vide en silence). Même famille que « promesse de verrou = verrou codé » : un
  commentaire de restauration ne garantit rien sans un test qui échoue si une moitié est oubliée.
- **Une borne HAUTE sur une source qui CROÎT fige l'UI EN SILENCE.** `A2:H20000`, `LIMIT n` sans
  offset, tableau tronqué en TÊTE : au franchissement, rien ne lève — ça FIGE (vécu C28-34 : l'app
  allait cesser de voir toute ligne neuve dans la journée, l'Index étant append-only et le reset y
  écrivant 2 lignes par fichier). (1) Sur une source append-only, fenêtre OUVERTE ou ancrée en
  QUEUE, jamais un plafond de tête. (2) Toute modif qui AUGMENTE le taux de croissance d'une
  ressource oblige à relire les bornes que les AUTRES composants ont posées dessus — c'est le
  changement de débit qui transforme un point de vigilance lointain en panne du jour. Invisible en
  CI : se demander « qu'est-ce qui, ailleurs, suppose que cette table est petite ? ».
- **Prouver qu'on peut SAUTER une étape de vérification ⇒ mesurer chaque invariant qu'elle protège
  sur SON PROPRE axe, pas seulement la divergence de la sortie.** Un garde-fou que l'étape produit
  mais qui n'influence PAS le résultat observable est INVISIBLE dans un diff avant/après (vécu :
  dry-run 1↔2 passes ADR-0034 — un faux négatif `sensible` passe 1 `false`→passe 2 `true` ne change
  pas le placement, puisque `sensible` ne route plus depuis §2 ; un harness qui ne comparerait que le
  placement conclurait « saut sûr » alors que le filet §2 est perdu). Réflexe : lister ce que l'étape
  à sauter PRODUIT, et pour chaque sortie « change-t-elle le résultat ? si non → métrique dédiée »
  (`fauxNegatifSensibleV2_`, colonne + compteur séparés). Ranger les verdicts par SÉVÉRITÉ : le raté
  invisible-mais-grave prime sur un résultat identique rassurant.
- **Test de MUTATION : restaurer par COPIE de sauvegarde, jamais `git checkout <fichier>`.** Prouver
  qu'un test attrape bien sa régression (leçon C28-32) exige de remettre le code buggé puis de
  restaurer. `git checkout`/`git restore <fichier>` restaure depuis l'index/HEAD et DÉTRUIT sans
  avertir les modifications NON COMMITTÉES du même fichier (exit 0, aucune alerte — vécu C28-33 : la
  réallocation des budgets effacée, le test d'invariant repassait au vert en mesurant les ANCIENNES
  valeurs). Toujours `cp` avant / `cp` retour, puis RELIRE la constante (`grep`) — vérifier
  l'artefact, jamais le code de sortie (même famille que les backticks dans `git commit -m`).
- **Observabilité self-serve (lecture Sheet sans geste de Marc).** `read_file_content` (Drive MCP)
  TRONQUE les gros onglets (les lignes les plus ANCIENNES, jamais les plus récentes) — ne jamais lire
  directement un gros onglet journal/plan ; mirer l'état dans un petit onglet-résumé EXISTANT
  (clé/valeur, une écriture/tick — patron `majSante_`/`majTelemetrie_`/`majProgressions_`), qui passe
  toujours intact, en réutilisant les MÊMES calculs qu'un éventuel diagnostic un-clic. Avant de
  confier un libellé « terminé »/« OK » à Marc, remonter à la Property/fonction qu'il lit RÉELLEMENT —
  deux campagnes au nom voisin (« rangement ») peuvent être des mécanismes distincts. Toute exposition
  d'un diagnostic dans un résumé par-tick hérite le MÊME court-circuit « déjà fini → ne relis plus
  rien » que son producteur (sinon elle devient, une fois la campagne finie, le seul poste qui continue
  de payer un rechargement coûteux) ; toute surface qui ré-affiche un nombre déjà affiché ailleurs
  réplique EXACTEMENT la même conversion d'unité (numérateur > dénominateur = divergence, pas un bug).
- **Un garde-temps doit vivre DANS la boucle qu'il protège, jamais dans une étape de sélection
  préalable.** Patron « fonction pure (sélection) + wrapper I/O (exécution) » : si la sélection ne
  fait AUCUNE I/O, elle s'exécute en microsecondes et son `garde()` ne peut JAMAIS couper — toute la
  tranche passe d'un coup, et le VRAI travail (exécuté ensuite, souvent un `.map()`) se retrouve SANS
  AUCUNE protection malgré un `garde()` qui « a l'air » présent (vécu : `HistoriqueVrac.gs`, trouvé en
  revue AVANT déploiement). Le check doit être DANS la même boucle que l'appel I/O qu'il protège
  (patron `etatCampagnesRangement`, Diagnostic.gs). Corollaire test : un mock de `estBudgetDepasse()`
  qui est un simple compteur d'appels ne prouve rien tant qu'on ne vérifie pas aussi le nombre
  d'appels RÉELS à l'opération protégée elle-même (pas seulement la taille du résultat final).
- **Une fonction de comptage/agrégation ne doit jamais dégrader une EXCEPTION vers son compte de
  repos (`0`)** — sinon une erreur devient indistinguable d'un vrai zéro, et si la sortie nourrit un
  état qui ne se réécrit JAMAIS (journal append-only, historique — contrairement à
  Progression/Santé, réécrits chaque tick), ce faux 0 devient une vérité PERMANENTE (vécu :
  `compterVracRacineDomaine_`, `06 · Études` affiché à 0 dans `HistoriqueVrac` avec ≥400 fichiers
  réels). Exposer un champ `erreur:boolean` DÉDIÉ, le propager jusqu'au consommateur final (affiché
  EXPLICITEMENT, jamais additionné comme une donnée valide), et laisser la boucle appelante
  CONTINUER sur les autres items. Corollaire : étendre les colonnes d'un onglet Sheet déjà créé en
  prod exige un patron de réparation d'en-tête posé sur un chemin RÉELLEMENT atteignable (voir
  corollaire ci-dessous — une réparation dans `initialiserSheet_` seule ne suffit PAS pour un onglet
  déjà existant).
- **Une réparation « comme `Index!H1` » doit copier le POINT D'ATTACHE (quand ça s'exécute), pas
  juste la forme (`if` cellule vide `then setValue`).** Posée dans `initialiserSheet_`, une telle
  réparation ne s'exécute QUE si cette fonction tourne — or elle n'est appelée qu'à la création
  initiale de la Sheet ou via `feuille_(nom)` quand l'onglet est ABSENT ; sur un onglet déjà créé en
  prod (le cas même où la réparation est nécessaire), c'est du code mort qui ne s'exécute jamais
  (vécu : colonne `Erreur` de `HistoriqueVrac`, toujours absente en prod après merge). Poser la
  réparation là où la ressource est RÉELLEMENT lue/écrite à chaque run (ici `majHistoriqueVrac_`,
  pas `initialiserSheet_`). Réflexe : avant d'annoncer « réparé comme X », `grep` les call sites de
  la fonction qui porte le correctif et vérifier qu'ils couvrent le cas déjà-existant, pas juste le
  cas de création. Corollaire revue : un finding d'agent qui semble en décalage avec un diff déjà
  appliqué se RE-VÉRIFIE (relire le diff exact vu par l'agent, ou reproduire son raisonnement sur le
  code actuel) — ne jamais le classer « périmé » sans preuve ; ici l'agent avait raison. La seule
  preuve qui compte reste la DONNÉE RÉELLE post-merge, jamais la présence du code dans le diff.

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
