# CLAUDE.md — DriveAI

> Mémoire de projet, chargée à chaque session. **Garde ce fichier court et à jour.**
> L'état courant vit dans `HANDOVER.md`, le reste à faire dans `BACKLOG.md`, le détail dans
> `docs/`. Les leçons s'accumulent dans `docs/LESSONS.md` et leurs règles durables remontent
> en §9.
>
> Structure imposée par la convention commune aux huit dépôts
> ([`claude-config/conventions/STRUCTURE-DEPOT.md`](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md)).
> **Les sections ont été renumérotées le 2026-08-20.** Le reste du dépôt — code, tests, ADR,
> backlog — porte plus de 500 renvois à l'ancienne numérotation, qui n'ont PAS été réécrits :
> une passe de `sed` sur autant de sites aurait cassé plus qu'elle n'aurait réparé, d'autant
> que `§1` y désigne souvent le garde-fou n° 1 et non la section 1. Correspondance :
> **ancien §2 (garde-fous) → §1** · **ancien §7 (leçons) → §9** · **ancien §8 (protocole) →
> §11**. Les autres n'ont pas bougé de sens.

**DriveAI** range Google Drive tout seul : les pièces jointes utiles des mails et les
fichiers déposés à la main sont analysés par un LLM, renommés selon une convention stricte, et
classés dans une arborescence granulaire — sans intervention, sauf une file de revue pour les
cas incertains. Le modèle a suivi le besoin (Haiku au départ, **Sonnet en 2 passes** depuis le
2026-07-09, ADR-0018) : la valeur qui fait foi est `CONFIG`, pas cette phrase.

Stack : **Google Apps Script** (moteur, Phases 1–3) + une **Google Sheet** (état) +
**app web React/Vite/TS sur Vercel** (Phase 4). LLM via l'API Anthropic.

## 1. Principes non négociables

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
   coût one-shot plafonné par le frein `CONFIG.LLM_BUDGET_CAMPAGNES`. Le plafond a suivi les
   campagnes : 10 → 30 (07/07) → 65 (09/07) → 110 (10/07, ADR-0018 révisée), redescendu à
   **10 le 2026-08-01**, puis remonté à **40 le 2026-08-20** pour finir C26-08 — 40 et non 30,
   parce que 885 documents restants × 0,0261 $ (coût mesuré) + 10,70 $ déjà dépensés = 33,80 $,
   et qu'un plafond à 30 aurait remis la campagne en pause à ~146 documents du but.
   À redescendre à 10 une fois C26-08 terminée, en LISANT son compteur (cf. ci-dessous).
   ⚠️ La note du 01/08 affirmait que « m1 et C26-08 sont finies ». **C'était faux pour C26-08** :
   elle était à 322 documents sur 1207 le 13/08, mise en pause par le frein — constaté par le MCP
   le 20/08, deux semaines plus tard. Une campagne déclarée terminée qui ne l'est pas ne se
   signale pas : elle cesse d'avancer, et le tableau affiche « en pause » comme un état normal.
   Ne pas déclarer une campagne finie sans lire son compteur.
   **La valeur qui fait foi est `Config.gs`, pas cette ligne** :
   Marc relève ponctuellement le plafond en éditant le fichier, et le résumé publié au hub lit
   `CONFIG.LLM_BUDGET_CAMPAGNES` plutôt que de recopier un chiffre.
   Le frein ne se désactive JAMAIS (filet anti-emballement) et ne gate JAMAIS le flux vivant.

7. **Le coût publié au hub est le CUMUL, pas le mois.** `majResumeHub_` publie
   `llmCostTotalUsd` (somme de toutes les Properties `DriveAI_COUT_*`, cf. `syntheseCoutTotal_`)
   et le broker le sert en `usage.cost.period = "total"`. Le mois courant devient un **quota**
   avec le seuil du frein pour plafond. Raison : le hub somme les coûts PAR période et refuse de
   fusionner « cumulé » et « ce mois-ci » — tant que DriveAI ne publiait que son mois, il était
   seul dans sa colonne et empêchait tout total unique. Si le cumul manque (web app en retard
   d'un déploiement), le broker retombe sur `period = "mois"` : le mois sous son vrai nom, jamais
   étiqueté « cumulé ».
   Où vont les autres chiffres : la VENTILATION par usage (C28-58) et le récapitulatif de tout
   ce qui coûte quelque chose vivent dans [`docs/COUTS.md`](./docs/COUTS.md). Ce point-ci ne
   traite que d'UNE question — sous quelle période le montant part au hub.

## 2. Conventions de code

- **Langue** : code et commentaires en français ; interface produit bilingue FR/EN.
- **Nommage des fichiers classés** : `AAAA-MM-JJ_Type_Émetteur.ext`. L'entité est dans le
  *chemin*, jamais répétée dans le nom. Date absente → date de réception du mail.
- **Discipline de scope** : on livre par phases. Ne pas anticiper une phase ultérieure.
  Voir `BACKLOG.md` pour le périmètre exact de chaque phase.

## 3. Workflow git

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

- **Branches** : `claude/<slug>` pour le travail automatisé, `feature/<slug>` pour Marc.
  `main` est protégée par la CI.
- **Commits** : en français, préfixés par l'ID de tâche du backlog. Ex. `P1-03: extraction des PJ Gmail`.
- **Après toute reprise de session, LIRE `git rev-parse --short HEAD origin/main` avant tout.** Le
  conteneur distant est éphémère : le 2026-09-07, l'arbre était reparti d'un instantané vieux de
  17 jours (commit d'avant un rebase, plus d'`origin/main`, reflog à 4 entrées) et j'ai édité une
  heure dessus. Une base fantôme ne se voit qu'aux ancres de doc qui ne matchent plus.
- **`git fetch origin main` AVANT de commiter.** Plusieurs sessions travaillent sur ce dépôt en
  parallèle : le 19-20/08, trois correctifs ont été écrits deux fois (même job CI borné dans #298
  et dans une branche concurrente, même paragraphe de README dans deux PR). Le doublon ne se voit
  qu'au merge, quand il est déjà payé.
- **Push & merge auto** : Claude pousse sur une branche `claude/**`, ouvre une PR (draft),
  la CI valide, puis la PR se **merge automatiquement** (squash) quand la CI est verte.
  Voir `.github/workflows/`. Override : label `do-not-merge`.
  ⚠️ **Depuis le 2026-09-09 (#329), le BROUILLON EST le frein** — l'auto-merge refuse une PR
  `isDraft` (échec fermé : lecture impossible ⇒ refus). *Révise l'ancienne règle « un draft n'est
  PAS un frein » (vécu 19/08, #293 et #295), où un workflow repassait les PR en « ready ».*
  Conséquence pour chaque session : une PR ouverte en brouillon **ne partira jamais toute seule** —
  il faut la sortir du brouillon (`isDraft=false`) une fois la CI verte et la revue flotte passée.
  `do-not-merge` reste le second verrou, pour tenir une PR déjà sortie du brouillon.
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

## 4. Commandes utiles

- `/phase <n>` — démarre une phase du backlog avec discipline de scope.
- `/review` — passe le diff courant à la flotte d'agents via le `product-manager`.
- `/lesson "<leçon>"` — consigne une leçon dans `docs/LESSONS.md` (+ règle durable ici).
- `/handover` — régénère `HANDOVER.md` à partir de l'état courant.
- `/ship` — commit (FR, préfixe ID), push `-u origin`, ouvre la PR draft.

## 5. Vérifications avant commit

```bash
node --test test/*.test.js            # moteur : logique pure, zéro dépendance
cd app && npm test && npm run build   # app web : vitest + tsc --noEmit + vite build
```

Plus, si un `.gs` a bougé — **un `.gs` à la syntaxe cassée fige le déploiement `clasp`**, et ça ne
se voit ni dans les tests du moteur (qui ne chargent pas tous les fichiers) ni dans le build de
l'app :

```bash
tmp=$(mktemp -d); for f in src/*.gs; do cp "$f" "$tmp/$(basename "$f" .gs).js"; done
for j in "$tmp"/*.js; do node --check "$j" || echo "❌ $(basename "$j" .js).gs"; done
```

La **CI** (`.github/workflows/ci.yml`) rejoue exactement ce gate, plus les tripwires de surface
(scan de secrets, `surface-gmail-ecriture`, `trashed: true` confiné à `app/src/corbeille.ts`) et
les captures E2E en mode mock. Chaque job est borné par `timeout-minutes` : sans lui, le défaut
GitHub est de **six heures** — vécu 2× le 19/08, `playwright install` figé > 20 min retenant le
merge sans rien afficher.

**SonarCloud** tourne en analyse AUTOMATIQUE (aucun workflow) : sa config est
`.sonarcloud.properties` à la racine. `app/src/i18n.ts` y est exclu de la seule détection de
duplication (arbitrage de Marc, 23/09) — ses tables FR/EN se répètent par construction et
faisaient rougir chaque PR qui ajoute du texte. ⚠️ Ne jamais y exclure du CODE : une
duplication réelle se factorise.

## 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Ce sont deux systèmes indépendants : la CI juge le
code, l'hébergeur construit et sert. Un merge peut passer le gate et ne jamais être déployé — la
branche reste verte, le site continue de servir l'ancien build, et rien n'est rouge nulle part.

Vécu le 31/07/2026 : quatre projets Vercel ont cessé de créer des déploiements pendant ~3 h.
DriveAI et JobAI ont rattrapé au push suivant ; Hubperso et BatchChef n'en ont pas eu — leur commit
d'en-têtes de sécurité est resté **cinq jours** en attente sans que personne ne le voie.

Donc, après un merge qui change ce qui est SERVI : vérifier qu'un déploiement de production a bien
été créé et qu'il est `READY`, puis **contrôler l'effet sur la réponse réelle** — un en-tête se lit
dans la réponse, il ne se déduit pas du fichier source.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire plutôt
que de laisser croire qu'on a vérifié.

**DriveAI a DEUX cibles, et la CI n'en garde qu'une.** Vercel déploie l'app + `api/` ; le moteur,
lui, part sur Apps Script via `deploy.yml` (`clasp push` + `clasp deploy -i $WEBAPP_DEPLOYMENT_ID` +
réinstallation des déclencheurs). Un merge qui touche `src/*.gs` n'est en ligne que quand CE
workflow-là est vert : le moteur continue sinon d'exécuter l'ancienne version, en silence, tick
après tick. Vérifier le run `deploy.yml`, pas seulement la CI ni Vercel.

### En-têtes de sécurité (`vercel.json`)

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

## 7. Intégration hub (widget DriveAI sur hubperso.com)

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
  `getEngineState()`, qui interroge la web app Apps Script (`action=hub-summary`, gardée par le
  secret partagé `WEBAPP_SECRET` — aucun nouveau secret) et rend des **métadonnées seulement**
  (compteurs, horodatage, avancement des campagnes, ADR-0007) — jamais un CONTENU de document.
  ⚠️ Cette puce écrivait « jamais un nom de fichier » jusqu'au 14/09/2026 : c'était une glose plus
  stricte que l'ADR-0007, dont le §2 liste `Fichier` parmi les métadonnées légitimes. Depuis
  l'**ADR-0057**, le nom du dernier document classé est publié — et sous une contrainte précise :
  il voyage dans le bloc `details` du contrat, **JAMAIS dans `metrics`**, parce que Hubperso
  persiste les métriques (table `releves`, 90 jours) et pas les détails. Un test le verrouille.
  Trois retours, trois
  sens **distincts** : `null` (intégration non branchée, ou moteur jamais passé) ⇒ summary
  `status:"building"` ; `throw` (canal branché mais EN PANNE — réseau, HTTP, JSON illisible) ⇒
  **500**, jamais une donnée partielle ; sinon les vrais chiffres. Le serverless Vercel n'accède
  toujours **pas** à la Sheet : c'est le moteur qui la lit, et l'app la lit côté navigateur avec le
  jeton OAuth de Marc (ADR-0007).
  *(Cette puce a affirmé « **Phase 0 (aujourd'hui)** : il renvoie `null` » jusqu'au 2026-08-20,
  alors que le broker servait des métriques réelles depuis la Phase 1 — C28-27, 21/07. Un état
  transitoire écrit au présent rote sans prévenir.)*
- **Règle de maintenance** : toute nouvelle métrique se branche dans `getEngineState()` **et** passe
  par le contrat. Ne **jamais** casser le schéma (toute évolution passe par `hub-contract` : bump de
  version + re-pin, jamais une divergence locale) ni publier de donnée fabriquée — `building` tant
  que rien de réel n'est disponible vaut mieux qu'un chiffre plausible.
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

## 8. Documentation (où vit quoi)

| Fichier | Contenu |
|---|---|
| `HANDOVER.md` | **L'état RÉEL** : chantier en cours, ce qui tourne, ce qui attend un geste de Marc. À lire en premier pour reprendre. |
| `BACKLOG.md` | Ce qui est décidé mais pas fait. Chaque tâche a un ID, utilisé en préfixe de commit. |
| `PLAN.md` | Le découpage en phases et le « pourquoi » de chacune. |
| `docs/adr/` | Les décisions architecturales, `NNNN-slug.md`. Obligatoire AVANT toute modif du classement (§11). |
| `docs/ARCHITECTURE.md` | Comment les morceaux tiennent ensemble : moteur, Sheet, app, broker. |
| `docs/TAXONOMY.md` | L'arborescence cible et ses règles. |
| `docs/NAMING.md` | La convention de nommage des fichiers classés. |
| `docs/COUTS.md` | Tout ce qui coûte quelque chose, et la ventilation par usage. |
| `docs/DEPLOIEMENT.md` · `docs/RUNBOOK.md` | Déployer, et quoi faire quand ça casse. |
| `docs/HUBPERSO.md` | La liaison OAuth au projet hubperso — les gestes manuels de Marc. |
| `docs/LESSONS.md` | Le journal brut des leçons ; les règles durables remontent en §9. |
| `docs/WORKFLOW.md` · `docs/MCP.md` · `docs/GUIDE.md` | La flotte d'agents, le serveur MCP, le guide d'usage. |

La structure est commune aux huit dépôts du hub — elle est fixée dans
[`conventions/STRUCTURE-DEPOT.md`](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md)
du dépôt `claude-config`, et nulle part ailleurs.

⚠️ **L'état courant ne s'écrit PAS dans ce fichier.** Il a porté « **Phase courante : 0 —
scaffolding & automatisation. Le moteur Apps Script (Phase 1) n'est pas encore écrit** » jusqu'au
2026-08-20, alors que le moteur tournait toutes les 5 minutes sur plus de 16 000 documents depuis
des semaines et qu'on venait d'y merger de la comptabilité de coûts. Personne ne l'a vu : un
fichier chargé à CHAQUE session est aussi un fichier que plus personne ne relit. L'état vit dans
`HANDOVER.md`, qui a un rituel de mise à jour (`/handover`, hook `Stop`) ; `CLAUDE.md` ne porte que
ce qui reste vrai d'une session à l'autre.

## 9. Leçons apprises (règles durables)

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
  **Ce qui SORT du compte Google de Marc se juge à part, et se tranche par un ADR** : le texte des
  documents vers claude.ai (ADR-0042 §3), le nom du dernier document classé vers hubperso.com
  (ADR-0057 §3), et **l'inventaire vers la Mémoire** (ADR-0059 §3 point 2 — un fait
  `document.existe` par document classé, sa VALEUR est un `fileId`, `Memoire.gs`). Chaque sortie
  nomme la frontière franchie ET le garde-fou obtenu en échange — jamais une permission nue.
  Pour la troisième : liste de champs FERMÉE et testée (`test/memoire.test.js`), niveau dérivé
  par le CODE depuis le domaine (04, 01 ⇒ N3), aucun émetteur sur un document N3, `MEMOIRE_PUSH`
  (livré éteint, **allumé par Marc le 2026-09-16** — un test verrouille sa valeur dans les deux
  sens), jeton en second verrou, et ZÉRO appel LLM — tout se lit dans l'Index et dans
  le nom du fichier.
- **Garde-fou étroit, calibré sur du réel.** Un flag de protection (ex. `sensible`) doit viser
  des catégories précises (immigration + fiscal), pas « true par défaut » — sinon tout part en
  revue et l'auto-rangement est neutralisé. Le défaut prudent ne sert que pour les réponses LLM
  *malformées*, jamais comme posture de classement. **Corollaire (ADR-0050, 2026-09-09) : des
  exclusions chacune juste peuvent, ENSEMBLE, couvrir 100 % du réel** (tri Gmail : non lus + ⏰ +
  « À vérifier » + suspects = toute la boîte, archivage mort, tests verts). Une règle d'exclusion se
  vérifie par la DISTRIBUTION de la population (combien tombent dans chaque exclusion, combien restent
  éligibles), jamais règle par règle ; et une exclusion portée par un libellé que le moteur ne peut pas
  retirer est un cliquet, pas un état.
- **Git (squash-merge + branche réutilisée).** Avant chaque nouvelle tâche, repartir
  d'`origin/main` (reset/merge). Si la branche distante `claude/**` diverge après merge,
  refusionner son tip plutôt que force-push (ruleset). Après ouverture d'une PR sur branche
  réutilisée post-squash, lire son `mergeable_state` : un diff de CONTENU vide vs `origin/main`
  ne prouve PAS la mergeabilité (le merge 3-voies part du MERGE-BASE) — `dirty` ⇒ rebaser sur
  `origin/main` (le commit déjà squashé se vide) + force-with-lease ; symptôme : aucun check ne
  démarre, zéro erreur. Un check requis doit gater le merge vers
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
  **Corollaire (2026-09-14) : « indépendant » qualifie la NATURE de la source, pas le nombre d'appels.**
  Un état lu par API peut être EN RETARD, et le retard est indiscernable d'une panne tant qu'on
  interroge la même source : `get_check_runs` ET `list_workflow_jobs` ont servi la même vue périmée
  pendant 12 min (job « figé » sur `playwright install` — il était fini en 61 s, la PR fusionnée depuis
  10 min). Re-demander à un endpoint VOISIN du même service ne double pas la preuve — la 2ᵉ source doit
  être d'une autre NATURE (l'état de l'OBJET : PR `merged`, contenu de `main`), pas de l'ÉTAPE. Et quand
  un symptôme RESSEMBLE à une panne déjà consignée (ici §5, `playwright install` figé, vécu 2× le 19/08),
  la ressemblance AUGMENTE l'exigence de preuve au lieu d'en dispenser : une leçon nomme un MÉCANISME,
  elle ne diagnostique aucun cas.
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
  **Corollaire (C28-48) : un retour qui est un DÉLAI n'est pas un chemin de retour.** Quand la
  sortie dépend d'un ÉTAT EXTERNE OBSERVABLE (API activée, crédit rechargé, quota réarmé), le
  retour doit être une SONDE de cet état, sur un chemin PAS CHER distinct du chemin de travail :
  re-sonder PAR le travail (scan Gmail + LLM) coûte si cher qu'on doit l'espacer, ce qui reconvertit
  la sonde en minuteur (vécu : API Calendar activable à 08:00, vue le lendemain). Une sonde bon
  marché cherche la réponse la moins engageante qui distingue quand même les deux mondes (GET sur
  un identifiant volontairement INEXISTANT : 403 « disabled » vs 404 — aucune donnée lue, aucune
  énumération, aucun scope ajouté). Avec : verdict TRI-ÉTAT à échec FERMÉ (5xx/réseau ne lèvent
  JAMAIS la suspension), horodatage de sonde posé AVANT l'appel, try/catch si l'étape est appelée
  NUE en tête de tick. Et le diagnostic se conserve par son CHAMP EXPLOITABLE (`error.message` :
  projet GCP + URL d'activation), jamais par l'enveloppe brute — un JSON indenté, tronqué pour
  l'affichage, ne montre que sa ponctuation.
  **Corollaire (14/09) : un verdict d'INCERTITUDE doit persister la CAUSE qu'il vient d'écraser.**
  Quand un prédicat rend « je ne sais pas conclure » pour plusieurs causes distinctes — quota, refus
  de droits, ascendance illisible, coupure réseau — c'est souvent la BONNE décision (une incertitude
  ne devient pas un verdict), mais le message d'origine, SEUL endroit où la différence est écrite,
  ne doit pas être consommé par le verdict : il se garde À CÔTÉ et s'affiche. Sinon chaque diagnostic
  repart de zéro et finit par se faire à l'aveugle (vécu : deux diagnostics successifs sur « Tout
  corbeiller », dont un FAUX, sur un message « quota ou panne » vrai pour les quatre causes). Et quand
  l'utilisateur décrit un symptôme, LUI DEMANDER LES CHIFFRES QUE L'ÉCRAN AFFICHE DÉJÀ avant de bâtir
  une hypothèse : ils tranchent souvent entre des causes aux signatures OPPOSÉES (« rien de supprimé »
  vs « 56 supprimés, statuts perdus »). Une hypothèse qui explique parfaitement les chiffres
  disponibles reste fausse si elle n'explique pas le symptôme DÉCRIT.
  **Corollaire (19/08, 1ᵉʳ usage réel) : une sonde « ressource inexistante » doit parler la
  GRAMMAIRE d'identifiant de CHAQUE API sondée — sinon 400 ≠ 404 et le verdict ne conclut JAMAIS.**
  Un identifiant *malformé* fait répondre « je ne comprends pas ta requête » (400) au lieu de « ça
  n'existe pas » (404) : le verdict tombe dans `indetermine`, l'échec fermé ne lève jamais rien, et
  la reprise RAPIDE est supprimée en silence — mesurer le coût EXACT (ici la suspension expire
  quand même d'elle-même après 24 h : ce qui est perdu, c'est la reprise ≤ 13 min et un message
  d'état périmé entre-temps, pas un blocage éternel — une leçon durable exagérée se recopie)
  (vécu : `driveaisondeconfigapi` partagé — valide en
  base32hex pour Calendar, impossible en base64url pour Tasks, longueur ≡ 1 mod 4). Mutualiser UNE
  valeur entre deux API, c'est supposer qu'elles partagent une grammaire : un identifiant PAR API,
  verrouillé par un test sur la GRAMMAIRE (charset + contrainte de longueur), jamais sur la valeur.
  Et tout verdict indéterminé persiste son POURQUOI (message de l'API, pas seulement le code) ;
  une cause mémorisée que la sonde vient de DÉMENTIR (jeton obtenu ⇒ « compte non lié » est faux)
  se remplace, celles qu'elle n'a PAS démenties (un 500 ne réfute pas « API non activée dans le
  projet 777 ») ne s'écrasent jamais — frontière codée ET testée des deux côtés. Le prédicat qui
  autorise l'écrasement reconnaît la cause par son CONTENU, jamais un préfixe d'entité partagé par
  d'autres causes (sinon il reste vrai à vie) ; et la « preuve » invoquée doit être la bonne — un
  jeton servi par un CACHE ne prouve pas que le consentement tient (le 401 est justement ce qui le
  dément). Enfin, toute conclusion tirée d'un ÉTAT PERSISTÉ se vérifie contre les chemins de SORTIE
  ANTICIPÉE : une passe abandonnée par un garde-temps qui rend le MÊME texte qu'une passe complète
  fait affirmer « l'autre API n'a pas refusé » alors qu'elle n'a jamais été appelée — l'abandon
  doit se DIRE dans l'état.
- **Un verdict pris en amont sur la donnée RICHE ne se RE-DÉRIVE jamais depuis sa forme
  APPAUVRIE.** Rendre un message d'erreur lisible JETTE de l'information : si le même détecteur
  tourne des deux côtés du rétrécissement, il ne rend pas le même verdict (vécu C28-48, trouvé en
  revue : `accessNotConfigured`/`SERVICE_DISABLED` vivent dans `error.errors[].reason`, pas dans
  `error.message` — la détection amont disait oui, l'aval non ⇒ suspension jamais posée, mail
  re-analysé à chaque tick, sonde de reprise jamais armée ; silencieux ET conditionnel, donc pire
  à diagnostiquer). Faire porter le verdict par un MARQUEUR EXPLICITE posé par l'amont (préfixe
  canonique, code typé, champ dédié) et n'appeler le détecteur riche qu'à UN seul endroit. Réflexe
  de revue : « cette condition est-elle évaluée deux fois sur deux représentations du même fait ? »
  Corollaire : améliorer un message d'erreur POUR L'HUMAIN est un changement de CONTRAT dès que du
  code lit ce message — inventorier ses lecteurs, comme pour un schéma.
- **Mutualiser UNE dimension d'une règle ne couvre pas les autres : inventorier CHAQUE prédicat
  de la décision.** Partager l'employeur et les buckets entre flux et missions (« une seule règle,
  deux consommateurs » ✔ en revue) laissait la détection de TYPE écrite deux fois — 3 divergences
  réelles à clé de SUCCÈS (RL-1/31, RIB, « salaire »), trouvées seulement par la passe finale
  (C28-49 PR2). Au moment de partager une règle : lister chaque prédicat consommé par la décision
  (type, année, émetteur, exclusions, fenêtres numériques) et trancher pour chacun — partagé, ou
  localité justifiée par écrit. La dimension visiblement mutualisée est celle qui endort la revue.
- **L'asymétrie des verdicts commande la sévérité du prédicat.** Dans un pipeline idempotent, un
  verdict NÉGATIF (refus keyé sous version) est RÉVISABLE — l'item reste en place, un bump le
  ré-évalue ; un verdict POSITIF qui DÉPLACE l'item HORS du périmètre de collecte est DÉFINITIF DE
  FAIT — aucun bump ne le re-présentera (vécu C28-49, les 3 agents en convergence : « moreau »
  matchait « Moreault » en sous-chaîne ⇒ fichier égaré avec une clé de SUCCÈS). Le prédicat qui
  déclenche l'action irréversible est STRICT (mot entier, composants structurels comme le préfixe
  de date RETIRÉS du texte apparié) et dans le doute REFUSE — un refus coûte un re-examen, un faux
  positif coûte un document perdu de vue. Corollaires de la même revue : quand les règles d'un
  AVAL dépendent d'un état que l'AMONT construit encore (fenêtres dérivées de fichiers en cours de
  déplacement), l'aval se GATE sur la convergence de l'amont — la version des règles ne protège
  pas contre une donnée MOUVANTE ; et un échec PAR ITEM ne partage jamais le drapeau d'arrêt de la
  BOUCLE (un poison affamerait les sources suivantes à vie — deux drapeaux : « arrêt » vs « passe
  incomplète », essais bornés + abandon tracé).
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
- **Une même erreur de plateforme porte des causes d'ÉCHELLES différentes : trancher par le NOMBRE
  de lignes qu'elles frappent, pas par le code.** Un `403` Drive vaut throttle (transitoire, tout le
  lot), scope perdu (durable, tout le lot, réparé par une reconnexion) ou droits sur CET élément
  (définitif, UNE ligne — `insufficientFilePermissions`). Traiter le troisième comme une panne a
  gelé « Tout corbeiller » au 5ᵉ dossier, 53 jamais tentés, avec un message qui invitait à
  re-essayer l'impossible (C28-129) ; le traiter comme un verdict alors que la cause est GLOBALE
  aurait vidé la liste à tort. Question de revue : « si cette cause est vraie, combien de lignes
  échouent ? » — une ⇒ verdict qui classe SA ligne ; toutes ⇒ panne qui rend la main. Et la
  désambiguïsation se fait sur le corps ENTIER, au champ MACHINE (`errors[].reason`), jamais sur la
  prose d'un message déjà tronqué pour l'écran : l'amont pose un marqueur canonique, l'aval ne lit
  que lui. Corollaire : un coupe-circuit qui compte les échecs « d'affilée » se remet à zéro sur
  TOUT signal que le canal répond — un refus définitif est une réponse.
- **Un chiffre ne prouve rien tant qu'on n'a pas dit ce qu'il COMPTE — et « est-ce que ça a déjà
  tourné ? » se fait DIRE par le moteur, jamais déduire d'un code d'erreur.** Vécu C28-133 : j'ai
  conclu « panne transitoire, rejouer est sûr » d'un compteur passé de 4 à 8 « appels réussis » —
  c'était le compteur d'appels ANTHROPIC, et un tour de chat en vaut 1 à 7 (boucle d'outils), donc
  « +4 » collait tout autant à « UN tour a tourné en entier, a été payé, et l'utilisateur n'a reçu
  qu'un 404 ». Réflexe : avant de faire porter une décision à une métrique, nommer son unité et son
  facteur de conversion vers ce qu'on veut savoir. Second volet, structurel : un POST `/exec` a DEUX
  segments (exécution, puis 302 vers l'écho qui sert la sortie) et `fetch` suit la redirection — le
  statut observé est celui du SECOND, donc un 404 ne dit PAS si le script a tourné, et `redirect:
  'manual'` ne sauve pas (réponse opaque). La garantie ne peut donc pas vivre côté client : elle vit
  dans un MÉMO DE REQUÊTE côté moteur (`requestId` généré une fois, réutilisé à l'identique sur tous
  les essais ; `doPost` re-sert la réponse mémorisée sans rappeler le modèle ni ré-écrire). Ce n'est
  qu'ALORS que « rejouer tout ce qui n'est pas un JSON `ok:true` » devient sûr. ⚠️ Les deux moitiés
  se livrent dans le MÊME merge : le mémo vit dans le moteur, un client qui rejoue sans lui
  ré-exécute. Et toute rejouabilité se déclare PAR APPELANT, sans défaut (un oubli ne compile pas) —
  le dépôt avait déjà tranché « `chat-assistant` PAS rejouable » ailleurs, et deux composants
  n'ont pas le droit de rendre des verdicts contraires sans se citer.
- **Un onglet d'éditeur Apps Script ouvert AVANT un `clasp push` peut l'annuler — et le
  déploiement reste vert.** Le 2026-09-16, le run 345 a poussé `src/Memoire.gs` (fichier listé
  dans son journal, étapes toutes vertes), et le projet a continué d'exécuter l'ANCIENNE
  version : le fichier collé par Marc depuis son éditeur portait encore `niveau`, sans une
  ligne du correctif. L'IDE garde en mémoire ce qu'il a chargé et le SAUVEGARDE avant
  d'exécuter — un onglet ouvert avant le push réécrit donc le projet avec sa copie périmée,
  en silence. L'indice qui l'a trahi : des fichiers de diagnostic créés à la main, absents du
  dépôt, avaient survécu au push. Ordre qui règle le cas : **fermer tous les onglets de
  l'éditeur, POUSSER, rouvrir une page neuve** — et vérifier la présence d'une constante que
  seule la nouvelle version porte avant de conclure quoi que ce soit.
  ⚠️ **Distinct du piège (3), et il faut les deux** : celui-là dit qu'un tick peut continuer
  l'ancien code ; celui-ci dit que le PROJET peut redevenir l'ancien code. Le premier se
  répare en ouvrant l'éditeur, le second est CAUSÉ par l'éditeur ouvert — le remède de l'un
  est le poison de l'autre, ce qui rend le diagnostic pénible tant qu'on ne les sépare pas.
  ⚠️ **Corollaire de MESURE, payé le même jour** : une exécution MANUELLE réussie prouve que
  le CODE est bon, jamais que le DÉCLENCHEUR l'exécute. `diagnosticMemoire` a poussé
  2 348 faits d'un coup depuis l'éditeur pendant que le tick, lui, n'en poussait aucun — et
  le compteur de la Mémoire restait figé sur ce que la main avait envoyé. Un signal
  indépendant se prend sur ce que la PRODUCTION AUTOMATIQUE écrit entre deux ticks, jamais
  sur le résultat d'un lancement à la main.
- **Un contrat entre deux dépôts n'appartient à aucun des deux — et chacun le teste chez lui,
  donc personne ne teste le chaînon.** Le 2026-09-16, l'envoi vers la Mémoire a été allumé,
  les deux jetons posés, le code déployé, le tick vert : **4 000 faits refusés, zéro accepté**,
  et rien nulle part. Nous poussions un champ `niveau`, son schéma `.strict()` n'accepte que
  `niveau_propose`. Les deux côtés étaient testés — une liste FERMÉE ici (vie privée), un
  schéma STRICT là-bas (injection) — et aucun des deux ne pouvait voir que les deux listes ne
  se recouvrent pas. Parade : recopier la liste des champs ACCEPTÉS dans le dépôt émetteur,
  avec sa source, et un test qui exige que tout champ produit y figure. Il ne prouve pas que la
  recopie est fraîche (rien ici ne peut le savoir) ; il oblige à rouvrir le contrat au prochain
  champ ajouté, ce qu'un `grep` ne fait jamais tout seul.
  ⚠️ **Et ce qui a rendu la panne MUETTE est à part** : un refus de contrat arrive dans un
  **HTTP 200**, et le compteur `refuses` était lu puis jeté — « 4 000 » sans le mot
  `champ_inconnu` ne dit pas s'il faut corriger un champ, un prédicat ou une valeur. Un refus
  se NOMME (la Mémoire envoyait le code ; nous ne le lisions pas), et une passe qui envoie sans
  rien faire accepter le DIT au Journal : c'est une panne de contrat, pas un jour sans document.
- **Un verdict se prend sur une LECTURE, jamais sur l'échec d'une MUTATION — et les mutations de
  test se jouent DANS LES DEUX SENS.** Apprendre « je n'ai pas le droit » en essayant puis en lisant
  la 403 fait naître la décision dans un `catch`, hors de la fonction de garde, donc sans qu'AUCUNE
  garde amont n'ait tourné (vécu C28-129 : le refus de corbeille, alors que `capabilities.canTrash`
  répondait à la même question sur la lecture qui précède). Réflexe : « cette information est-elle
  lisible AVANT d'agir ? » — si oui, la garde la consulte, et l'échec de la mutation ne reste qu'un
  filet. Le prédicat porte alors TROIS états (oui / non / l'API n'a rien dit), le troisième étant une
  PANNE et jamais une autorisation par défaut ; rendre le champ OBLIGATOIRE laisse le compilateur
  exiger que chaque appelant tranche. Côté preuve : jouer une mutation qui AFFAIBLIT la détection ne
  prouve que la moitié — jouer aussi celle qui l'ÉLARGIT, parce que c'est elle qui fabrique des
  verdicts POSITIFS, et qu'un verdict positif retirant l'item du périmètre est définitif de fait
  (vécu : 4 mutations vertes dans un sens, la 5ᵉ en sens inverse non attrapée — le corpus négatif ne
  contenait pas la vraie forme de la panne GLOBALE que la garde devait laisser passer).
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
  jamais persister (repéré en revue C26-07 : 150 items naïfs ≈ 12,5 Ko > limite). **Corollaire
  (C28-44) : un plafond calculé en caractères MENT si l'encodage ÉCHAPPE** — `JSON.stringify`
  transforme guillemets/antislash/contrôles (dont `\n`, réaliste dans un message d'exception) en
  2-6 caractères chacun : le pire cas réel peut valoir le DOUBLE du pire cas naïf (vécu : plafond
  vert, 13-16 Ko réels). Neutraliser les échappables à l'entrée ET au goulot d'encodage
  (`suiviTexte_`), tester le plafond avec des entrées ÉCHAPPABLES, et poser un filet dur au point
  d'écriture qui DÉGRADE (vider les textes, garder l'essentiel) au lieu de lever en boucle.
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
- **Tout onglet lu par `feuille_('X')` DOIT être créé par `initialiserSheet_` — et un test qui
  MOCKE la fonction sous test ne voit pas son bug.** `feuille_(nom) = getSheetByName(nom) ||
  (initialiserSheet_(ss), getSheetByName(nom))` : un onglet absent de la liste `creerOnglet_` rend
  `null` → l'appelant plante (`getRange of null`, vécu C28-53 : `RapportPaies` oublié, mission
  paies crashée chaque tick pendant des jours). Vérifier par INVENTAIRE (`grep feuille_('…')` vs
  `grep creerOnglet_(ss, '…')`, différence vide) ; livrer tout nouvel onglet AVEC sa ligne
  `creerOnglet_`. Et au moins un test doit EXERCER la fonction pour de vrai : un mock de confort de
  la fonction sous test (ici `ctxRunner` mockait `ecrireRapportPaies_`) masque à vie ses propres
  bugs. Corollaire : une erreur RÉCURRENTE identique attrapée par un `try/catch` d'étape
  (`journalErreur_('…différée…')`) est un bug de fond déguisé en bruit — un signal, pas du bruit
  (révélé par le MCP `etat_moteur`).
- **Projet GCP par défaut d'Apps Script = CACHÉ (inadministrable, propriétaire compris) — une URL
  d'activation `?project=<n°>` n'y sert jamais.** Deux issues seulement pour une API qui y manque :
  (a) déclarer le service avancé (`dependencies` — DÉCLARER ≠ APPELER, les appels restent REST) ;
  (b) ne pas utiliser le jeton du script pour cette API — jeton OAuth d'un projet standard de
  l'utilisateur (**ADR-0041** : Tasks/Calendar via le projet hubperso, `JetonHubperso.gs`,
  consentement unique, refresh token en Script Properties, échec fermé sur la mécanique config-api). La
  CATÉGORIE des scopes borne la voie (b) : un scope RESTREINT (`gmail.modify`) sur un projet
  standard exige une vérification Google (CASA) ou expire tous les 7 jours en mode Test — Gmail/
  Drive restent donc à JAMAIS sur le projet caché ; vérifier la catégorie d'un scope AVANT de
  proposer un changement de projet. Corollaire callback : toute action `doGet`/`doPost` qui LIE un
  compte externe se garde par un `state` généré (comparaison constante, usage unique, validé AVANT
  tout appel réseau) — l'URL `/exec` est publique.
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
- **Vercel sans framework (`framework: null`) : les réglages « à la Next.js » se posent dans
  `vercel.json`, jamais en `export const`.** `export const maxDuration = N` (et les autres Route
  Segment Config) sont des conventions lues par le COMPILATEUR Next.js — sur ce projet (`framework:
  null`, build custom), rien ne les lit : silencieusement ignorées, sans erreur. Le mécanisme
  plateforme, indépendant du framework, est `vercel.json` → `"functions": { "<chemin réel du
  fichier>": { "maxDuration": N } }`. Avant de configurer un réglage par route, vérifier le
  `framework` déclaré. Corollaire achat : « Vercel Pro » n'inclut pas tout ce qui ressemble à une
  fonctionnalité Pro — la protection par mot de passe des previews est un ADD-ON PAYANT séparé
  (« Advanced Deployment Protection »), à vérifier/acheter dans le dashboard, jamais supposé inclus.
  Et avant de recommander un mot de passe pour « protéger les previews », vérifier si la protection
  SSO Vercel (gratuite, souvent déjà active) ne couvre pas déjà le besoin.
- **Une estimation de fin n'extrapole que le PASSÉ : en PAUSE, dire le RESTE et la REPRISE, jamais
  une date de fin.** Un débit observé ne peut pas connaître un blocage FUTUR (gel mensuel, budget
  qui se réarme, dépendance amont) — afficher les deux fait cohabiter une fin AVANT la reprise, et
  l'utilisateur retient l'optimiste (vécu C28-47 : « ~4 j · vers le 18/08 · reprise le 01/09 »).
  Le garde qui supprime la projection doit couvrir TOUTES les familles de pause du vocabulaire de
  statuts RÉELLEMENT produit (`/^(suspendu|en pause)/`, testées une par une — un `indexOf(x) === 0`
  sur une seule famille en rate la moitié). Corollaire : après une longue pause, RE-BASER la série
  de mesure (un débit résiduel quasi nul survit au gel et rend un horizon absurde au redémarrage).
- **Étendre un contrat de colonnes lu par un consommateur DÉPLOYÉ SÉPARÉMENT : APPEND en queue,
  jamais une insertion qui décale.** Pendant la fenêtre entre les deux déploiements (moteur vs
  app), chaque position décalée est lue avec l'ANCIENNE sémantique — sans erreur ni warning (vécu
  C28-44 : `Horodaté` gardé en G, les 3 colonnes nouvelles en H/I/J ; l'ordre « logique » de l'ADR
  aurait mis une raison de skip là où l'app lisait un horodatage). Preuve mécanique : si la
  conversion des tests existants du consommateur ne touche AUCUNE assertion indexée, la
  compatibilité est prouvée ; si une assertion doit bouger, une prod mixte lira faux. Bonus : un
  préfixe de colonnes identique rend la migration d'en-tête non destructive (réécrire la ligne 1
  suffit). Corollaires C28-45 : tout horodatage destiné à être LU par API se publie en TEXTE à
  format contrôlé (`dd/MM HH:mm`) — une cellule Date en FORMATTED_VALUE rend ce que le format de
  colonne veut (souvent sans l'heure) ; un max/tri sur ces chaînes se prend par TIMESTAMP PARSÉ
  (l'ordre lexicographique jour-major s'inverse au passage de mois) ; et ajouter une colonne oblige
  à vérifier CHAQUE plage de lecture existante (`A2:J` → `A2:K` — un index hors plage rend
  `undefined` sans erreur, la feature dépendante meurt en silence).
- **Un tripwire de convergence peut être TAUTOLOGIQUE — le prouver en cassant la RÈGLE, pas le
  consommateur.** Quand le consommateur B CALCULE sa cible en appelant la règle partagée A,
  `assert(A(x) === B(x))` est vrai par construction, y compris quand A est fausse (vécu C28-62 PR4 :
  mon « 🔴 LE tripwire » est resté vert alors que la revue sabotait la cible). Ce qui se verrouille,
  c'est ce qui n'est PAS tautologique : (a) l'**ORDRE** qui fait que B appelle A avant ses propres
  règles — un corpus traversant CHAQUE branche locale, qui tombe si on remet les règles locales
  devant ; (b) les branches où B décide seul. La mutation à jouer est « je casse A » : si le tripwire
  reste vert, il est décoratif. ⚠️ La MÊME ligne de test est un verrou ou une tautologie selon le
  code qu'elle observe (elle avait du contenu en PR2, où le consommateur calculait sa cible) : elle
  se re-juge à chaque refonte, jamais copiée.
- **Une garde par LISTE d'exceptions se périme ; préférer une garde par CAPACITÉ.** Une garde qui
  ÉNUMÈRE les cas à protéger est fausse dès qu'un cas manque, et personne ne sait qu'il manque (vécu :
  `estTypePaieReset_ || estFeuilletFiscalReset_ || TYPES_FISCAUX_MISSIONS || estRibReset_` a laissé
  filer « Avis d'imposition_SCI MRic » hors de 02 — le cas MÊME qu'elle protégeait). Quand un
  composant SAIT déjà répondre à la question de façon exhaustive (ici la règle de routage du domaine,
  qui connaît toutes ses revendications par construction), la garde s'exprime en CAPACITÉ (« sait-il
  le placer ici ? ») : complète, et elle évolue avec lui. Réflexe : devant `A() || B() || C()` qui
  protège quelque chose, chercher qui d'autre répond déjà à la même question.
- **Un DÉFAUT de configuration n'est pas une décision — surtout s'il invite à un geste destructeur.**
  `sourcesJetables` vaut par défaut TOUTES les sources, donc les peint en rouge (« bon pour
  suppression ») une fois vidées. Chaîne complète non vue en revue de code : Marc supprime → au bump
  suivant la collecte lève sur les sources disparues → passe incomplète → la mission ne converge PLUS
  JAMAIS → la mission gatée dessus par `convergenceApres` est bloquée à vie, heartbeat vert. Trancher
  explicitement chaque nouvelle instance, et **tracer ce qui se passe si l'utilisateur OBÉIT au
  signal**.
- **Un mock qui COMPOSE son résultat par concaténation ne distingue pas deux chemins d'exécution.**
  `sousDossier_` mocké en `parent + '/' + nom` rend la MÊME chaîne qu'on découpe un chemin en
  segments ou non — la mutation ne casse rien (vécu C28-62 PR4). Quand la propriété tient au CHEMIN
  d'exécution et non à la valeur, instrumenter le chemin (enregistrer les arguments, compter les
  appels). Avant d'écrire l'assertion : « quelle observation change si le bug revient ? ».
- **Une règle qui route PAR DOSSIER SOURCE hérite des erreurs de rangement de la source, et les rend
  définitives.** « Le dossier d'origine fait foi » court-circuite aussi le bon sens (vécu C28-62 PR1 :
  4 fichiers sur l'appartement, mal rangés dans `Véhicules/Recherche & achat`, déplacés vers le
  dossier véhicule à clé de SUCCÈS). Une telle règle reste subordonnée aux indices tirés du DOCUMENT.
  Et ce qui le révèle n'est pas un test : c'est de LIRE le contenu réel des dossiers après
  déploiement — la liste des fichiers déplacés, jamais le compteur.
- **`CONFIG.DOMAINES` ne contient que les domaines FIXES.** Les domaines AUTO (`07 · Santé`,
  `09 · Voyages`) ont leur ID en Script Property (`DriveAI_DOM_<nom>`) et peuvent être ABSENTS. Un
  `CONFIG.DOMAINES[d]` rend alors `undefined` — cible vide, plantage au `moveTo`. Résolution dans le
  wrapper I/O (`batirCtx`), routeur pur, **échec fermé** (pas d'ID ⇒ refus keyé), et un domaine
  PROTÉGÉ jamais dans la carte des cibles : `aParentProtege_` ne garde que la SOURCE, jamais la cible.

- **Un ENSEMBLE d'empreintes répond à « déjà vu ? », jamais à « encore là ? ».** Un état de dédup
  qui sert à décider « donc j'écarte celui-ci » doit mémoriser **OÙ** est l'exemplaire gardé : sans
  le lieu, il ne distingue pas « il y a une copie ailleurs » de « il n'y en a plus nulle part », et
  il vide la collection EN SILENCE (vécu C28-49 PR4 : `_empreintesCache` est un Set, `estDoublon_`
  a envoyé dans `_Doublons` **1 076 fichiers** dont les 3 passeports de Marc — un fichier déjà
  indexé et re-présenté devient doublon de LUI-MÊME). Réflexe : pour tout index de dédup, demander
  « que répond-il si l'exemplaire conservé a été déplacé/écarté depuis ? ». Et la source d'empreinte
  doit couvrir TOUTE la population : l'Index n'attache une empreinte à un fileId que pour les clés
  dont le dernier segment EST un fileId (`PREFIXES_CLE_FICHIER_`), donc une PJ Gmail y est
  invisible — le `md5Checksum` de l'API Drive n'a pas ce trou et ne télécharge aucun octet. Enfin,
  une quarantaine (`_Doublons`) sans dé-quarantaine est le même défaut vu de l'autre bout : un
  garde-fou qui met des items hors circuit exige un chemin de RETOUR.
- **Un registre BORNÉ finit par se fermer, et il se ferme sans le dire.** Quand un tripwire de
  plafond passe encore mais que la MARGE est inférieure au coût d'UNE unité de plus, la ressource
  est PLEINE, pas « sous le plafond » (vécu : registre de suivi C28-44 à 8 377/8 500 octets, 42
  clés × ~199 — 123 octets restants, une 43ᵉ étape le faisait déborder). Le rapporter comme une
  saturation, marge chiffrée et coût unitaire à l'appui ; et DIRE dans le commentaire qu'un
  contournement en est un, sinon il se relit comme une préférence d'architecture et personne ne
  remonte à la cause (C28-58 avait déjà buté dessus sans le nommer).

- **Suspendre « tout le scan » pour protéger un quota couple des fonctions sans rapport — et un
  message vrai à chaque tick peut mentir sur la DURÉE.** (Incident 02-07/09/2026, ADR-0049.) La
  suspension totale des intentions sur panne de config d'API (ADR-0022, « re-lire pour échouer à
  créer brûlerait le quota ») coupait AUSSI l'analyse qui pose `important|` — donc l'archivage de
  la boîte, six jours, pour une panne d'autorisation sur la création d'agenda. Réflexe : devant un
  `if (panneX) return;` en tête d'étape, lister CE QUE l'étape produit et QUI le consomme en aval ;
  ne suspendre que la partie qui dépend réellement de X (ici la création), et protéger le quota par
  un mécanisme dédié (marqueur « déjà vu » pendant la panne + drapeau de retard au retour). Et
  toute observabilité de panne porte le **depuis quand** et le **pourquoi** (`<ts du 1er
  échec>|<raison du dernier>`, seuil dérivé de CONFIG au-delà duquel « momentanément » est
  interdit) : « échec transitoire » répété six jours n'est pas du bruit, c'est le signal — et
  personne ne l'a vu parce que chaque occurrence, prise seule, était exacte.
- **Une garde n'existe qu'aux endroits qui la CONSULTENT — trois questions avant de l'annoncer.**
  (a) *Qui la POSE ?* Un marqueur de qualification (faible/fort, raison, trace) se pose **par la
  ligne qui décide**, jamais re-dérivé du résultat rendu (`'Contrats'` ne dit pas si c'est l'entité
  ou le type qui a répondu) — et il faut inventorier les **frères** de cette ligne : instrumenter le
  repli générique ne couvre pas les filets écrits ailleurs qui rendent le même GENRE de verdict
  (vécu C28-90 : 44 % des cibles de `03` hors couverture, frontière arbitraire entre « Échange de
  messages » protégé et « Lettre » déplacé). (b) *Qui la CONSULTE ?* Une garde affichée au plan
  n'est pas une garde : elle se **ré-applique au point de MUTATION**, en appelant la MÊME fonction
  (corollaire de #47 PR2, re-vécu à l'identique). (c) *Que se passe-t-il si je la neutralise ?* Si
  la suite reste verte, elle n'est pas testée — quoi qu'en dise son jsdoc. Et le corpus de preuve
  doit contenir la population que la garde PROTÈGE : un corpus dont chaque ligne est sauvée par une
  AUTRE règle ne peut rien détecter.
- **Une étape en FIN de `finally` n'est pas « servie en dernier » : elle n'est PAS servie — et
  si elle ne DIT rien en sortant, la panne est invisible.** Deux défauts distincts, payés
  ensemble le 16/09 (C28-135). (a) L'envoi à la Mémoire était le dernier de la file du
  `finally`, donc il recevait le reliquat de budget TAIL d'un tick qui l'avait déjà dépensé :
  zéro fait poussé pendant une heure, pendant que le tick tournait toutes les 5 min et que le
  canal venait d'accepter 2 348 faits À LA MAIN. C'est mot pour mot l'incident de la
  consolidation du 23/07 — **l'ORDRE prime sur les budgets**, et les deux voisines qui la
  précédaient étaient moins pressées qu'elle (une sweep quotidienne, une campagne TERMINÉE).
  (b) La sortie sur garde-temps n'écrivait RIEN : pas de Journal (le seul `journalErreur_`
  visait un refus total), pas de compteur, pas de ligne de Santé — donc « rien à envoyer »,
  « jamais atteinte » et « suspendue » avaient le MÊME symptôme, le silence. Réflexe, pour
  toute étape de tick : **lister ses sorties, et vérifier que chacune écrit son motif** (ici
  `DriveAI_MEMOIRE_FIN` = `<ISO>|<fin>|<envoyés/acceptés/déjà>|<ligne>/<dernière>`, une seule
  fonction l'écrit pour qu'aucun `return` ne l'oublie, et `majSante_` la rend lisible sans rien
  exécuter). C'est la règle « 0/0 et 0/6 ne disent pas la même chose » appliquée à une étape
  entière. ⚠️ Corollaire : cette étape tournait aussi **sans aucune constante `*_BUDGET_JOUR_MS`**
  — donc l'invariant d'enveloppe restait vert pendant qu'elle s'ajoutait au quota runtime. C'est
  l'angle mort déjà nommé en C28-42, re-payé : ses 4 min/j sont désormais PRÉLEVÉES sur
  l'historique Gmail (12 → 8), et `test/orchestration.test.js` en fait sa 10ᵉ jambe.
- **Une surface qui ne distingue pas la MAIN du DÉCLENCHEUR fait conclure « ça marche » sur
  la preuve d'un geste humain.** Le 16/09, `diagnosticMemoire` a poussé 2 348 faits depuis
  l'éditeur ; le compteur montait, la ligne de Santé disait « passe terminée », et le tick
  n'envoyait rien depuis une heure. La leçon « une exécution MANUELLE prouve que le CODE est
  bon, jamais que le DÉCLENCHEUR l'exécute » était déjà écrite — ce qui manquait, c'est que
  **la surface le rappelle à celui qui la lit** : un 5ᵉ champ `manuel`/`tick` dans
  `DriveAI_MEMOIRE_FIN`, et la phrase qui le dit. Réflexe : pour toute observabilité qui
  résume « la dernière passe », demander **qui l'a lancée**, et si la réponse ne s'y lit pas,
  la surface ment par omission au pire moment — celui où l'on vient de réparer quelque chose
  et où l'on cherche une confirmation. ⚠️ Un champ ajouté à un état déjà PERSISTÉ se met **en
  queue**, et son absence doit se lire comme la valeur d'AVANT (ici : pas de 5ᵉ champ ⇒ tick).
- **Un `opts.X` lu par le moteur et passé par personne est une intention jamais livrée** —
  et le jour où on en a besoin, il est trop tard. `opts.manuel` était lu en TROIS endroits de
  `passeMemoire_` (gate, budget par run, comptage), testé, commenté… et le seul appelant était
  le tick, qui ne le passe jamais. Coût réel : le jeton de la Mémoire réparé à 17 h, le budget
  du jour épuisé, et rien pour forcer une passe avant minuit — alors que le code pour le faire
  était là depuis le matin. C'est `UN-CHAMP-TYPE-SANS-PRODUCTEUR` appliqué à une OPTION, et
  c'est plus discret : un champ absent d'un formulaire se voit, un paramètre optionnel que
  personne ne passe ressemble à du code qui marche. Réflexe : `grep` les APPELANTS d'une
  option, jamais ses lecteurs. Et un chemin que seul un humain emprunte a besoin d'être
  déclaré dans `test/surface-moteur.test.js` — rien d'autre ne le retient.
- **Un bouton RECOUVERT s'affiche parfaitement — une correction de mise en page se MESURE dans
  un navigateur.** Les trois verdicts de l'audit (C49-3) tombaient sous la barre d'onglets du
  téléphone : « Juste » à y=788 pour une barre qui commence à y=783, même après défilement. Le
  geste principal de l'écran était inatteignable, le CSS était correct, le build vert et la suite
  verte — rien ne pouvait le dire. Ce qui l'a trouvé : ouvrir la page dans Chromium au format
  d'un téléphone et COMPARER les rectangles (`boundingBox`), pas regarder la capture. ⚠️ Une
  capture `fullPage` ne tranche RIEN pour ça : un élément `position: fixed` y apparaît superposé
  au milieu du contenu déroulé, donc elle montre un chevauchement même quand il n'y en a pas — et
  l'inverse est vrai aussi. ⚠️ Et le remède se verrouille au MÊME seuil que ce qu'il évite : deux
  media queries différentes rouvrent une fenêtre de largeurs où les boutons se collent au mauvais
  endroit (`test/seuil-telephone.test.ts` le tient déjà pour la coquille).
- **Une fixture qui ne ressemble pas à la donnée RÉELLE valide une hypothèse, pas un format.**
  L'audit des pièces a écrit « [object Object] » dans sa colonne Champs au PREMIER usage réel :
  `champs` n'est pas une carte de scalaires, c'est `{"montants": [{"libelle","valeur"}], …}` —
  la forme que le prompt DEMANDE, trois lignes plus haut dans le même dépôt. Un `String()`
  dessus ne lève pas, ne casse aucun test, et rend la ligne injugeable. Mes fixtures portaient
  des scalaires, donc les onze cas étaient verts sur un format qui n'existe pas. Réflexe : pour
  tout champ produit par un modèle, **construire la fixture depuis le PROMPT** (ou depuis une
  réponse réelle), jamais depuis l'idée qu'on se fait du champ. ⚠️ Corollaire de réparation :
  une extraction déjà ÉCRITE ne se répare pas en corrigeant le code qui l'écrit — il faut un tag
  de version qui la refait (patron `MIGRATION_TAG`), sinon le correctif ne vaut que pour les
  lignes futures et l'utilisateur continue de lire les anciennes.
- **Le DONNEUR d'une réallocation de budget se fait choisir par les tests, pas par le raisonnement.**
  Pour financer l'audit (C49-3), les deux donneurs « évidents » ont été refusés : l'historique
  Gmail, pourtant TERMINÉ et déclaré réallouable par le moteur lui-même, rend 20 de ses tests
  rouges dès qu'on le met à zéro (un budget quotidien nul rend une campagne MUETTE, et ces tests
  encodent la conception inverse — ils ne se re-basent pas) ; la re-datation de `06` perd 25 % de
  son budget en marge de démarrage dès qu'on la coupe en deux, et son propre commentaire annonçait
  « ≤ 1 min sur 8 », donc il serait devenu faux en silence. Le poste retenu est celui que PERSONNE
  n'attend : une campagne perpétuelle en lecture seule. Réflexe : proposer le transfert, lancer le
  gate, et lire ce qui rougit AVANT d'écrire la justification — c'est le parc qui sait quel budget
  garantit quoi ailleurs.
- **Une GATE d'extinction qui ne lit pas le TAG rend INERTE le remède gaté par ce tag.** Le
  17/09, le correctif de l'audit des pièces a été livré, la CI verte, le moteur déployé — et
  **zéro ligne ré-extraite après deux ticks**. La ré-extraction vit DANS la passe, gatée par
  `AUDIT_PIECE_TAG` ; la gate du tick, elle, éteignait l'étape sur `restants === 0`. Donc :
  l'étape ne tourne plus ⇒ le tag n'est jamais lu ⇒ rien ne remet de lignes « à faire » ⇒ le
  compteur ne repasse jamais au-dessus de zéro ⇒ l'étape ne tournera **jamais**. Interblocage
  parfait, et la Santé annonçait « 0 restants — à toi de juger », c'est-à-dire l'état NORMAL.
  Réflexe : pour tout remède gaté par une version, demander **qui appelle le code qui lit la
  version**, et si cet appelant peut s'éteindre ; la décision devient alors une fonction PURE qui
  consulte les DEUX (`auditDoitTourner_(reste, tagPersiste, tagCourant)`), testable et mutable.
  ⚠️ **Et le second défaut était pire que le premier** : même la gate corrigée, la branche de
  sortie « budget du jour épuisé » relisait le compteur PERSISTÉ — c'est-à-dire la valeur
  d'AVANT la ré-extraction. Elle aurait réécrit « 0 restants » sur 100 lignes qu'on venait de
  vider, le tag étant déjà posé : la gate se refermait pour de bon sur des cartes VIDES, l'audit
  détruit au lieu d'être réparé. Un compteur qui sert de gate se relit **depuis la SOURCE** (ici
  la feuille) dès que quelque chose vient de la modifier, jamais depuis son propre cache.
  ⚠️ Corollaire de preuve : la mutation « la branche budget-jour relit l'ancien compteur » est
  restée VERTE au premier jet — le défaut le plus grave des trois était celui qu'aucun test ne
  voyait. Une mutation muette sur le chemin le plus coûteux se traite avant d'écrire le rapport.

- **Une `var(--x)` qui n'existe pas ne « retombe » pas sur la règle précédente : la propriété
  prend sa valeur INITIALE.** Le 17/09, une règle ajoutée pour AGRANDIR les cases d'un panneau
  disait `min-height: var(--cible)` — un jeton de **Hubperso**, absent de ce dépôt. Mesuré au
  navigateur : `min-height` calculé à `auto`, cases à **26 px au lieu de 44**. La règle censée
  agrandir avait rapetissé, en écrasant le `min-height: 44px` de la règle de base. Ni le build,
  ni les tests, ni l'œil sur un écran large ne pouvaient le dire.
  ⚠️ Deux enseignements distincts. (a) **Les jetons ne traversent pas les dépôts** : le parc
  partage des conventions, pas des feuilles de style — recopier une règle d'un dépôt voisin
  importe ses variables, qui n'existent pas ici. (b) La garde qui l'attrape est générale et
  tient en dix lignes (« toute `var()` sans repli est définie dans la feuille ») — et elle a
  trouvé un SECOND fantôme dans le même lot, `--texte-2`, que je n'avais pas vu. Un `var()` AVEC
  repli reste légitime : il ne peut pas tomber en `auto`.
  ⚠️ Corollaire de MESURE, du même lot : un harnais qui mesure une page **non défilée** rend un
  faux « bouton recouvert » — un `position: sticky` ne prend qu'AU SCROLL. Le geste réel se
  reproduit (défiler, puis viser), sinon on « corrige » une mise en page qui marchait.

- **Une sortie PRÉCOCE ne doit jamais écrire le compteur que sa propre GATE relit.** Le 17/09
  à 18:35, la branche « l'audit tourne encore » de `etapeRattrapagePiece_` faisait
  `restantsRattrapage_(props) || 0` : la Property n'existait pas, elle a donc écrit **0** — un
  chiffre qu'aucune mesure n'avait produit. En chaîne : la gate lit 0, `rattrapageDoitTourner_`
  rend `false`, l'étape ne tourne **plus jamais**, et la Santé annonce « ✅ tranche terminée »
  alors qu'il restait **85 papiers sur 110**. Un message rassurant et faux, sur une campagne
  qui venait d'être allumée.
  ⚠️ C'est l'interblocage du 17/09 au MATIN (`UNE-GATE-D-EXTINCTION-QUI-NE-LIT-PAS-LE-TAG…`)
  repris par l'autre bout, et c'est ce qui le rend traître : la gate était correcte — elle
  lisait bien le tag —, c'est le COMPTEUR qu'elle consulte qui avait été écrasé par une
  ignorance. Corriger la gate n'aurait rien réparé.
  ⚠️ `null` veut dire « je ne sais pas », et `|| 0` le convertit en « c'est fini ». La règle
  « `restants === null` ≠ zéro » était **écrite et testée** dans la gate elle-même, et violée
  trois lignes plus bas dans les branches de sortie. Réflexe : pour tout champ qu'une étape
  PERSISTE et qu'une gate RELIT, se demander **quels chemins l'écrivent sans l'avoir mesuré** —
  et faire que le motif de fin s'écrive toujours, le compteur seulement quand il est mesuré.
  ⚠️ Corollaire d'écriture : un compteur non mesuré se sérialise **VIDE**, jamais `'0'` ni
  `'null'` — `Number('')` vaut zéro, donc un lecteur naïf relit « terminée » de toute façon.

- **Un déclencheur que le tick RÉINSTALLE ne se coupe pas à la main.** « Ne plus créer » ne
  suffit pas : la coupure livre AUSSI la suppression de l'existant (`deleteTrigger` sous le même
  flag), sinon l'ancien continue de partir et l'utilisateur, qui l'a supprimé une fois, le voit
  revenir sans comprendre (C28-75). Réflexe pour tout `assurerX_` idempotent : « que se passe-t-il
  quand X est DÉSACTIVÉ après avoir été installé ? ».


**Un recensement de commandes d'installation s'énumère par ce qu'elles FONT, jamais par le nom
de l'une d'elles.** Le lot L2 du 18/09 a posé `--ignore-scripts` sur les trois `npm ci` /
`npm install -g` trouvés par un grep, et laissé ouvert `npx playwright install` — qui télécharge
depuis le registre ET exécute les scripts de cycle de vie, donc la surface qu'on venait de
fermer, rouverte deux étapes plus bas, sur une version non figée. Pire : c'est le
`--ignore-scripts` posé juste avant qui rendait cette étape NÉCESSAIRE. La forme couvre
`npm ci`, `npm install`, `npm install -g` **et** `npx` ; le correctif est `npx --no-install`
(binaire local, version du lockfile, échec franc s'il manque), et il exige que l'installation
vive dans le MÊME job — à vérifier avant de le poser. Histoire dans `docs/LESSONS.md`.

**Une structure de réponse qui n'offre AUCUNE façon de dire non fabrique une réponse.** Le
21/09/2026, le passeport de Marc a été « extrait » d'un OCR qui ne portait que du bruit —
« HARD FLEX T 014 », « ITD OSS », des références de fabricant — et le modèle a rendu un
passeport plausible : résumé en espagnol sur un document marqué `fr`, numéros tirés des
inscriptions, aucune date de naissance. Ni le prompt ni le modèle n'étaient en cause : le
gabarit JSON demandait un résumé, un type, un émetteur, et ne proposait `null` que champ par
champ — jamais pour le DOCUMENT ENTIER. Devant des fragments, la réponse la plus serviable
est l'invention, et c'est celle qu'on obtient. Avant de blâmer un prompt, demander **quelle
réponse la structure REND POSSIBLE** : si « je n'ai pas pu lire » n'en est pas une, on ne
l'obtiendra jamais. ⚠️ Et le refus doit valoir même quand l'extraction est RICHE : une pièce
inventée passe tous les tests de « porte quelque chose », et elle est pire qu'une pièce vide
— elle a l'air d'une lecture, donc personne ne la reprend. ⚠️ Le champ ABSENT vaut vrai : le
côté sûr est ici l'acceptation, sinon une réponse qui omet le champ ferait jeter tout un lot.

**Un coût MESURÉ sur une autre campagne n'est pas une mesure de celle-ci.** Le même jour,
j'ai chiffré la tranche à « 1 086 documents × 0,0261 $ ≈ 28,3 $ » et annoncé à Marc un
arbitrage sur le frein. Les 0,0261 $ viennent de l'ADR-0018 : c'est la RE-ANALYSE, en Sonnet
DEUX passes. L'extraction de pièce est Haiku UNE passe, avec son prompt en cache — ~0,004 $,
soit **6 fois moins**, et donc aucune tension avec le frein. Deux voies concordantes le
disaient (la télémétrie du mois, et les prix de `LLM_PRIX`) et je n'en avais suivi aucune.
Un chiffre porte son MODÈLE et son NOMBRE D'APPELS PAR DOCUMENT : recopié, il change de sens
sans changer d'apparence. ⚠️ Le plus cher n'était pas l'erreur mais la DÉCISION qu'elle
appelait — un arbitrage budgétaire demandé pour rien.

**Un recenseur ancré sur la FORME perd son propre témoin quand on change la forme.** Le
recenseur de motifs de `memoire.test.js` cherchait `res.motif = '<litteral>'` ; remplacer
cette affectation par un TERNAIRE a fait disparaître le motif du recensement — et le témoin
qui prouve que le scan voit quelque chose avec lui. C'est la seule raison pour laquelle on
l'a vu : sans ce témoin, le contrôle d'exhaustivité serait devenu vide en silence. Un scan
d'affectation se lit **jusqu'au `;`**, puis on extrait les littéraux de l'expression entière.

**Une garde qui TIRE est une garde qui a fait son travail — et le prix de l'ignorer est celui
qu'elle empêchait.** Le 21/09/2026, j'ai posé une tranche de 976 documents sur une campagne dont
l'idempotence tenait dans une Script Property, plafonnée à ~200. Le plafond était ÉCRIT, je le
connaissais, et je ne l'ai pas re-mesuré avant d'agir. La garde a refusé de démarrer et n'a rien
coûté ; le découvrir en production aurait coûté un appel de modèle par document à CHAQUE passe,
pour toujours — une Property qui déborde lève à l'écriture, donc la liste des faits ne s'écrit
plus et la campagne re-traite éternellement les mêmes documents sans avancer d'un cran.
⚠️ **Le correctif a reproduit la panne qu'il corrigeait**, et c'est le plus instructif : ma
première écriture dans l'onglet référençait une variable HORS PORTÉE, à l'intérieur du
`try/catch` qui protège la persistance. Donc zéro ligne écrite, zéro erreur visible, et chaque
document re-payé à chaque passe — exactement le mode de panne dont on sortait. Trouvé par un
test, jamais par la relecture. **Un `try/catch` qui protège une persistance avale aussi les
fautes de frappe** : ce qu'il enveloppe se prouve par un test qui vérifie ce qui est ÉCRIT,
jamais par la lecture du code.

**Une information qui EXISTE mais qu'on ne trouve pas coûte la confiance dans tout le reste.**
Le 21/09/2026, Marc a écrit deux fois qu'il ne voyait pas où en était la lecture de ses
papiers. Elle était écrite : une ligne de Santé, au milieu de quinze autres, dans Réglages —
l'écran qu'on ouvre le moins. Et son motif de fin était un identifiant de code (« suspendu »),
vrai pour quatre causes qui appellent quatre gestes différents. **Un état brut rangé au bon
endroit pour celui qui l'a écrit n'est pas une observabilité** : il l'est pour celui qui le
lit, ou il ne l'est pas. ⚠️ Corollaire mesuré deux fois le même jour : le SEUL endroit qui
affichait le refus de la Mémoire commençait par `if (!CONFIG.PIECE_PUSH) return 'désactivée'`,
un flag qui ne gouverne pas le canal responsable ; et `DriveAI_MEMOIRE_SUSPENDU_RAISON` était
écrite depuis l'origine et lue par PERSONNE. Devant « je ne comprends pas où ça en est »,
chercher d'abord ce qui est DÉJÀ persisté et que rien n'affiche — c'est la réponse une fois
sur deux, et elle coûte une ligne.

**Une valeur figée dans le CSS ne peut pas suivre une liste du code, et rien ne le dit.**
`nav.barre-basse` portait `repeat(4, 1fr)` ; le passage à cinq onglets l'a laissée telle
quelle, gate vert, build vert, et la cinquième case ne déborde que sur un téléphone. Une
feuille de style ne peut rien importer : la garde DOIT donc vivre dans un test qui LIT le CSS
et le compare à la liste (`SECTIONS_NAV.length`), jamais épingler un nombre — qui se
re-baserait mécaniquement au prochain onglet.

**Un tripwire de plafond qui refuse une 43ᵉ entrée n'est pas un obstacle à contourner.** Le même
jour, ajouter une étape au registre de suivi a été refusé : ~199 octets par clé contre 123 de
marge sur les ~8,5 Ko qu'une Property accepte. Relever le plafond aurait troqué un refus NET
contre un `setProperty` qui lève en boucle. La bonne question n'était pas « comment faire entrer
cette étape » mais « a-t-elle sa place ici » — le registre suit ce qui PROGRESSE, et poser un
point par jour ne progresse pas.

**Un état écrit APRÈS coup répond à « qu'est-ce qui a été lu », jamais à « qu'est-ce qui est
en train d'être lu ».** Le 21/09/2026, Marc a demandé trois fois de suite où en était la lecture
de ses papiers. Mesuré avant d'écrire une ligne : sur ses cinq questions, **quatre n'avaient
aucune réponse dans le moteur** — pas une réponse mal affichée, une réponse ABSENTE. La campagne
n'écrivait son état qu'une fois le document traité, donc « ça traite quoi en ce moment » était
structurellement sans réponse ; l'ordre `04 → 01 → 02` vivait dans une boucle et n'était publié
nulle part ; et la ligne du document lu ne portait pas son dossier. Réflexe : devant « je ne vois
pas », **lister les questions une par une et chercher la ligne qui ÉCRIT la réponse** — si aucune
n'existe, le lot n'est pas un lot d'affichage.
⚠️ Un « en cours » s'écrit **AVANT** l'appel (après, il décrit le passé), s'efface à **CHAQUE**
sortie de boucle (budget, garde-temps, erreur — pas seulement la fin normale), et **périme** :
sans péremption, un plantage laisse un nom affiché « en train d'être lu » pour toujours, et c'est
pire que rien parce qu'on le croit.
⚠️ **Une file qui ne s'écrit que dans le cas ACTIF ne dit rien du cas FINI.** Ma première
version ne publiait la file que s'il restait du travail — donc un dossier terminé disparaissait,
exactement au moment où « quelle direction ? » se pose. Prouvé par mutation : la garde rougit
quand le domaine à zéro restant s'évapore.
⚠️ Et la CADENCE se mesure sur les **jours ACTIFS** (déjà payé chez MemoryAI le 18/09) : « total
÷ jours écoulés » et « total ÷ jours où ça a tourné » sont tous deux vrais, un seul répond à
« combien de jours de campagne reste-t-il » — d'où un horizon annoncé en « jours OÙ LA CAMPAGNE
TOURNE », jamais en jours de calendrier.

**Un budget de lecture se dépense dans l'ORDRE du fichier, et le balisage vient en premier.**
Le 21/09/2026, `extraireTexte_` tronquait à 12 000 caractères un export HTML dont le `<style>`
fait à lui seul plus que ça : le modèle recevait une feuille de style coupée en plein milieu
d'une règle CSS, **zéro caractère du document**, et il répondait quand même — « nom, date de
naissance, informations email ou téléphone », en disant lui-même qu'il devinait. Mesuré sur le
vrai fichier du Drive par l'outil du moteur DÉPLOYÉ, pas sur une fixture. Périmètre : **151
papiers** au moins. **Nettoyer APRÈS la troncature n'aurait rien réparé — le contenu n'est déjà
plus là**, et c'est ce qui rend l'ordre non négociable. ⚠️ Et le remède n'est PAS de relever la
borne : 12 000 caractères de CSS coûtent exactement le même argent que 12 000 caractères de
texte. Devant un budget qui semble trop petit, demander d'abord **ce qu'il dépense**.
⚠️ **Un nettoyage qui ne rend RIEN rend le BRUT.** « Je n'ai pas su lire » n'est pas « ce
document est vide », et c'est le second qui se fige en verdict (`sans-texte`) pour toujours :
dégradé vaut mieux que menteur.
⚠️ **Retirer `<head>` en bloc est plus simple et jette le `<title>`** — souvent la ligne la plus
utile du fichier. On retire ce qui n'est JAMAIS du texte (style, script, commentaires), pas ce
qui n'est pas du corps.
⚠️ **Les balises de BLOC deviennent des sauts de ligne**, sinon deux cellules voisines se collent
en un mot qui n'existe dans aucun document.
⚠️ Et `text/plain` n'entre JAMAIS dans un retrait de balises : un bloc-notes qui écrit « 3 < 5 »
serait mutilé. Le MIME vient de Drive et n'est pas fiable, l'EXTENSION vient du fichier — il faut
les deux.

⚠️⚠️ **Et la mesure d'APRÈS a réfuté deux phrases de mon propre ticket** — ce qui est l'argument
le plus fort pour la faire. (a) J'y désignais le fichier par son NOM, recopié d'une recherche :
ce n'était pas le sien. Un nom se recopie, un `fileId` s'observe. (b) J'y écrivais « ce fichier
porte probablement la date de naissance que Marc cherchait » — c'est la liste des pages qu'il
suit. **Cette phrase venait de ce que le MODÈLE avait deviné**, et je la citais comme un indice
dans le ticket même qui dénonçait cette devinette. Le titre réel vivait dans le `<head>`, c'est-
à-dire exactement ce que la solution facile (retirer `<head>` en bloc) aurait jeté. Devant une
sortie de modèle, demander **ce qui est mesuré et ce qui est deviné** avant de la recopier dans
un document que la prochaine session lira comme un fait.

**Un compteur ajouté LAISSE son libellé derrière, et rien ne le dit.** Le même jour, la Santé
affichait « dernière passe : 3/0/1/1 (faits/échecs/sans texte) » : quatre chiffres, trois noms.
Le compteur était juste ; c'est la phrase qui n'avait pas suivi quand `illisibles` est entré,
cinq jours plus tôt. ⚠️ **Corriger le libellé a laissé les 1502 tests VERTS** — aucun ne
l'épinglait, et c'est exactement pourquoi il avait pu dériver. La garde qui referme la classe est
**COMPORTEMENTALE et DÉRIVÉE** : elle compte les chiffres que la passe sérialise et les noms que
la phrase affiche, et exige l'égalité. Épingler le texte se re-baserait mécaniquement au prochain
compteur ajouté — c'est-à-dire le jour où il faut que quelque chose rougisse.

**Une DÉDUCTION à la place d'une MESURE marche pour la majorité, et la minorité disparaît en
silence.** Le 21/09/2026, le fileId d'un document n'était nulle part stocké : il se DÉDUISAIT
de la clé d'Index, qui le porte en dernier segment — pour quatre préfixes sur cinq. La clé
d'une pièce jointe Gmail est `<messageId>|<rang>|<nom>|<taille>` et n'en contient aucun. Donc
**734 documents CLASSÉS** étaient invisibles au comptage du périmètre, au rattrapage des pièces
et au canal Mémoire, alors qu'ils sont rangés dans le Drive depuis des mois. Rien ne pouvait le
dire : la déduction ne LÈVE pas, elle rend `''`, et chaque lecteur a sauté la ligne comme s'il
n'y avait rien à lire. Réflexe : devant un identifiant qu'on DÉRIVE au lieu de le STOCKER,
demander **sur quelle part de la population la dérivation marche** — et si la réponse n'est pas
« toute », la faute est dans la dérivation, pas dans les exceptions.
⚠️ **Le correctif est une PAIRE, et une moitié seule ne répare rien** : le producteur écrit
désormais la valeur (9ᵉ colonne, EN QUEUE — les plages de lecture de l'app ont été RECENSÉES,
pas supposées), et une passe one-shot RETROUVE celle des lignes déjà écrites. Corriger ce qui
écrit ne répare jamais ce qui est déjà écrit — troisième fois ce mois-ci.
⚠️ **Et retrouver, c'est trancher : le prédicat REFUSE dans le doute.** Un fileId faussement
attribué enverrait un papier de Marc à la Mémoire **sous l'identité d'un autre** — verdict
POSITIF, donc définitif de fait. L'empreinte avant le chemin, et une empreinte attendue que
personne ne porte fait REFUSER au lieu de se rabattre sur le dossier : un fichier qui n'a pas
le bon contenu n'est pas celui-là, quel que soit son nom. Le refus est mémorisé (sinon la
campagne ne finit jamais) mais keyé sous le TAG, donc révisable par bump.

**Un gate vert ne voit pas un CHAÎNON, et les trois bloquants d'un même lot peuvent tous en
être un.** Le 21/09/2026, C49-16 partait avec 1 526 tests verts, neuf mutations rouges et une
CI verte. La revue adversariale a trouvé trois bloquants, et aucun ne portait sur une FONCTION :
(a) le `fileId` que le lot existe pour produire n'était pas TRANSMIS par `RattrapagePiece` à
`pousserPieceApresClassement_` — donc `pieceMemoire_` retombait sur la clé, rendait `null`, et le
document était marqué « fait » DÉFINITIVEMENT **après** l'appel Haiku payé : une boucle inerte
qui facture, sur `04` en premier ; (b) `res.curseur` était initialisé AVANT la boucle avec la
valeur de FIN de page, donc une coupure au PREMIER item sautait quarante lignes — 60 documents
sur 100, et la Santé annonçait « ✅ terminée » ; (c) le verdict irréversible se prenait sur le
NOM du dossier parent, or `2025` existe sous chacun des neuf domaines. Les trois vivaient entre
deux fonctions correctes et testées — « un trou entre deux moitiés testées n'appartient à
personne », re-payé trois fois dans le même lot. ⚠️ Ce qui les a trouvés n'est pas une relecture
mais des SONDES sur le vrai module (« clé Gmail sans fileId ⇒ `pieceMemoire_` rend `null` »,
« 60/100 résolues, 40 vides »). Toute garde neuve doit donc en contenir au moins une qui
TRAVERSE, depuis l'entrée la plus amont jusqu'à l'effet réel.
⚠️ **Et une troncature RETIRE des candidats, donc elle FABRIQUE des uniques.** Mon commentaire
affirmait l'inverse — « au-delà du plafond, le choix refusera de toute façon » — alors que le
refus vient justement d'avoir DEUX candidats. Une page pleine ne dit pas « il y en a N », elle
dit « je n'ai pas tout vu » : on en demande un de plus, et une page pleine REFUSE.
⚠️ **Une panne sans suspension coûte tous les jours** : `fin='panne'` ne fermait aucune gate, donc
un refus Drive persistant faisait re-lire l'Index ENTIER à chaque tick pour re-échouer — ~20 à
30 min de runtime quotidien, indéfiniment, et **invisibles au test d'enveloppe**, qui ne somme
que des constantes `*_BUDGET_JOUR_MS` nommées. Troisième occurrence de cet angle mort (C28-42,
C28-135). Et une étape de fond sans sous-budget par run peut affamer exactement celles qu'elle
est placée là pour alimenter.

**Un correctif se mesure AU SITE QUI ÉCHOUE, jamais au MODULE.** Le 21/09, j'ai annoncé à Marc
« le retry OCR manquant, gratuit, une ligne, aucun changement de comportement » après avoir
constaté que `Ocr.gs` n'employait `fetchDriveAvecRetry_` nulle part. Vrai du module, faux de la
panne : les deux erreurs du Journal (`Conversion HTTP 400`, `HTTP 500`) sont à l'upload
multipart, le SEUL des quatre appels qui ne peut pas rejouer — il CRÉE un fichier, et un 5xx
peut arriver après la création, donc un rejeu fabriquerait un temporaire orphelin qu'on ne
pourrait plus supprimer. Le correctif est bon, il ne touche simplement pas le défaut observé.
⚠️ La question qui manquait : **cet appel a-t-il un EFFET, ou seulement un RÉSULTAT ?** Un retry
est sûr sur un GET, jamais sur une création — « durcir le réseau » n'est pas une catégorie, c'est
une décision par appel. ⚠️ Et la garde vaut dans les DEUX SENS : trois cas exigent le rejeu, un
QUATRIÈME l'interdit — sans lui, un lot futur qui « harmonise » rouvre le trou en croyant ranger.
⚠️ Corollaire déjà payé et re-payé : deux tests chargeaient `Ocr.gs` sans `DriveRest.gs`, et le
`try/catch` qui protège l'export avalait la fonction manquante en rendant `null`. **Un try/catch
qui protège une lecture avale aussi un contrat inter-module rompu** — ce sont les tests qui l'ont
dit, pas la relecture.

**ARRÊTER une campagne n'est pas lui retirer son budget — et deux des sept n'avaient aucun
interrupteur.** Le 21/09, Marc a demandé d'enlever les campagnes finies ou improductives : sept
postes, **41 min/j sur les 63** de l'enveloppe, immobilisées sur des choses terminées (doublons le
22/08, historique Gmail que le moteur lui-même disait « RÉALLOUABLE »), convergées (consolidation)
ou sans production depuis 32 jours (missions). Le réflexe — mettre leur `*_BUDGET_JOUR_MS` à 0 —
est exactement ce que le verrou d'orchestration interdit : **une campagne ACTIVE à budget nul
tourne à VIDE en silence** (`consommeJour 0 >= 0` court-circuite avant tout travail). Une campagne
muette n'est pas une campagne arrêtée : elle reste dans les surfaces, et plus rien ne dit pourquoi
elle ne produit rien.
⚠️ **Deux n'avaient pas d'interrupteur du tout**, et c'est le vrai enseignement : la re-datation ne
s'arrêtait que sur sa Property de FIN, l'historique Gmail non plus. Autrement dit, on ne pouvait
arrêter QUE ce qui était déjà fini. Le flag se pose donc **avant** ce `return` — placé après, il
n'éteint que ce qui est éteint — et il se CÂBLE avec son test (un flag lu par personne est une
intention jamais livrée, C28-137).
⚠️ **82 tests rouges d'un coup**, et ils ont raison : ils exercent le CHEMIN de campagnes qu'on
vient d'éteindre. La règle du dépôt tranche (« la position globale d'un flag est une décision de
Marc, jamais un invariant de test ») : le HARNAIS les rallume, budget compris — l'interrupteur seul
en laissait encore 73, puisque le budget à zéro rouvre le même no-op un cran plus bas. La liste est
NOMMÉE (rallumer tous les `*_ACTIF` réveillerait ceux qui sont éteints pour une raison de SÛRETÉ) et
ne s'applique JAMAIS quand seul `Config.gs` est chargé : un test qui INSPECTE les constantes doit
voir la production, sinon il valide une enveloppe qui n'existe pas.
⚠️ **Une comptabilité par PAIRE ne passe pas à sept donneurs** : `AUDIT_PIECE_PART_SYNC_MIN` et
`_GMAIL_MIN` deviennent une TABLE, dont la somme doit valoir le budget du receveur, et dont chaque
donneur doit prouver qu'il a bien un budget à zéro — sinon la table se conserve en INVENTANT un
donneur, c'est-à-dire en déplaçant d'un cran le défaut qu'elle existe pour empêcher. Et le garde
« prêté = reçu » par donneur d'ORIGINE a été RETIRÉ, avec sa raison écrite : des minutes qui
changent de mains deux fois ne se tracent plus jusqu'à leur source sans être comptées double.
⚠️ Corollaire d'affichage : **un arrêt DÉLIBÉRÉ garde son avancement à l'écran.** Les autres
suspensions sont transitoires et leur cause est le sujet ; celle-ci est définitive et laisse
108 documents sur 466 en plan — « arrêtée » tout court effacerait le seul chiffre qui dit ce qu'on
a laissé, et la Progression purge ses lignes finies après 48 h.

- **ARRÊTER quelque chose dans le MOTEUR ne l'arrête pas dans les SURFACES** (21/09, C49-20, trouvé
  par les deux revues de flotte, jamais par la relecture). Les sept interrupteurs étaient câblés
  dans le tick et dans la Santé ; la Progression, l'app, le MCP et le **widget hubperso**
  continuaient d'annoncer « en cours · vers le 01/10 » et « en pause · **reprise demain** » pour des
  campagnes délibérément arrêtées. Dans le MÊME `finally`, la Santé écrivait « arrêtée » et la
  Progression « en cours » : deux surfaces, deux vérités opposées. La pire des trois est la
  consolidation — son `budgetEpuise` vaut `0 >= 0`, donc VRAI à jamais : la surface lisait le
  BUDGET et jamais le flag, soit l'état « muette » qu'on venait de refuser, atteint par l'autre
  bout. **Après avoir posé un interrupteur, recenser tout ce qui RACONTE la chose arrêtée**, et se
  demander pour chaque lecteur s'il lit le flag ou une de ses conséquences.
  ⚠️ **Et le MOT d'un statut lu par une autre couche s'apparie par ÉGALITÉ** : les deux revues
  recommandaient « arrêtée (CONFIG) », or `familleStatut` (`app/src/etat.ts`) teste
  `statut === 'désactivée'` — le correctif aurait réintroduit le défaut qu'il corrige, en famille
  `encours`, sans qu'aucun des deux dépôts ne puisse le dire seul. Garde de CHAÎNON obligatoire dès
  qu'un statut franchit une frontière de dépôt.
  ⚠️ **Un no-op INTERNE ne suffit pas à DIRE l'arrêt** : sans gate NOMMÉE dans `etapeSuivie_`, le
  wrapper enregistre un SUCCÈS et `statutDepuisSuivi_` rend « en cours » (piège `dryrun-v2` du
  13/08, re-payé). ⚠️ Et trois des sept interrupteurs n'étaient tenus par AUCUN test : on pouvait
  retirer garde interne ET gate en laissant 1 548 tests verts, alors que le lot faisait de
  l'interrupteur le SEUL mécanisme d'arrêt. « Un flag lu par personne est une intention jamais
  livrée » a sa version suivante : **un flag que rien ne teste**.

- **Un lanceur de test qui échoue AVANT d'exécuter quoi que ce soit rend toutes les mutations
  « rouges » — donc toutes vaines** (21/09, C49-20). J'ai joué 13 mutations avec `node --test test/`
  (forme RÉPERTOIRE) : chacune a rendu `# fail 1` et j'ai conclu « 13/13 discriminantes ». Sur
  l'arbre PROPRE, la même commande rend `# fail 1` aussi — `Error: Cannot find module
  '/home/user/DriveAI/test'`. Zéro test avait tourné. Le gate du dépôt écrit `node --test test/*.test.js`,
  et j'avais changé la forme sans y penser. **Toute campagne de mutations commence par une mesure de
  RÉFÉRENCE sur l'arbre propre, assertée verte, avec la commande EXACTE du gate** — et se relit sur
  le nombre de tests PASSÉS (1 554 → 1 553), jamais sur le seul compteur d'échecs. Rejouées
  correctement : 13/13 rouges, avec la référence et la restauration vertes de part et d'autre.

- **Deux lignes du MÊME lot ne peuvent pas trancher à l'inverse — et c'est la mesure d'APRÈS qui
  le dit** (21/09, C49-20). Le lot avait posé, pour la re-datation, « un arrêt délibéré garde son
  avancement à l'écran » ; sur les doublons, éteindre la campagne a EFFACÉ son bilan (« 1 076
  écartés : 1 054 confirmés, **19 ORPHELINS** ») au profit d'un « désactivée (CONFIG) » muet.
  Deux arbitrages opposés, écrits le même jour, sur deux lignes voisines du même écran. Cause :
  le prédicat `!DOUBLONS_ACTIF` vivait EN TÊTE de `ligneSanteDoublons_` — il était MORT tant que
  la campagne tournait, et c'est mon lot qui l'a rendu ATTEIGNABLE. **Après avoir allumé un
  interrupteur, relire les branches que personne ne pouvait atteindre avant** : elles n'ont
  jamais été jugées, donc jamais alignées sur rien. ⚠️ Et ce qui l'a trouvé n'est ni la relecture
  ni la revue de flotte (les deux l'ont manqué, sur un fichier qu'elles avaient lu) mais la
  MESURE d'après, en comparant deux instantanés à neuf minutes d'écart.
  ⚠️ Corollaire de coût : la ligne d'état d'une campagne ÉTEINTE ne doit pas relire son onglet à
  chaque tick — et le prix de cette économie est de DIRE « je n'ai pas relu », jamais de rendre
  un total à zéro. Un zéro qu'aucune mesure n'a produit est un chiffre inventé, même dans une
  ligne de Santé.

- **Deux nombres qui existent en PROSE n'existent pas pour l'app** (21/09, C49-23). Marc :
  « fil d'attente pour import et fil d'attente pour lecture ». La seconde existait en chiffres
  (`Lecture — file : 04 ✅ (48) · …`) ; la première existait **aussi**, mais dans deux phrases
  françaises — « 2731 faits acceptés au total » et « 3972 papiers candidats sur 4240 documents
  classés ». Tout était mesuré, rien n'était lisible : le dépôt interdit de parser une phrase
  (« le format lu est celui que le moteur ÉCRIT »), et il a raison — une phrase se reformule au
  premier lot qui la rend plus claire, et la jauge disparaîtrait sans qu'un test rougisse.
  Réflexe : devant « je ne vois pas X », ne pas demander si X est MESURÉ mais s'il est **publié
  dans une forme que le lecteur a le droit de lire**. La réponse a été non pour l'un des deux,
  et le lot s'est réduit à une ligne de Santé encodée.
  ⚠️ **Le coût de l'écrire en prose se paie DEUX fois** : les deux nombres vivaient dans deux
  lignes DIFFÉRENTES, écrites par deux modules, et personne ne les avait jamais rapprochés.
  ⚠️ Et une jauge n'est honnête qu'avec son PÉRIMÈTRE écrit dessous : l'import couvre tout le
  Drive (2731/4240), la lecture seulement la tranche en cours (188/1210). Deux pourcentages
  côte à côte sans cette ligne se comparent, et ils ne parlent pas du même ensemble.

- ⚠️⚠️ **Un témoin qui échoue AVANT d'atteindre ce qu'il teste passe pour une preuve** (21/09,
  C49-23, trouvé par une mutation MUETTE). Mon cas « `importFile` ne lit PAS la phrase
  française » donnait une ligne préfixée `Mémoire (inventaire) : …` — que `ligneSanteNommee`
  ne trouve même pas, puisqu'elle cherche `Import — file`. Le test rendait donc `null` au
  premier `if`, sans jamais atteindre le motif qu'il prétendait défendre : **élargir le motif
  de `/^\s*(\d+)\/(\d+)\s*$/` à `/(\d+)\/(\d+)/` laissait les 29 cas VERTS**. Le témoin qui
  discrimine porte le BON préfixe et une valeur en PROSE (`Import — file : 2731 faits acceptés,
  à la ligne 12/4240`) : un motif non ancré y lit « 12 » et publie douze documents poussés au
  lieu de 2 731 — un chiffre FAUX, pas une absence. Règle : pour tout test « ce lecteur refuse
  X », vérifier **à quelle ligne le refus a lieu** — si ce n'est pas celle qu'on défend, le
  test mesure autre chose. Et les deux protections (le préfixe, le format) se testent
  SÉPARÉMENT, sinon la plus précoce couvre l'autre à vie.

- ⚠️ **Un rect non nul ne prouve pas qu'un élément est VISIBLE** (21/09, C49-23). Mon harnais
  de mesure a annoncé « le dernier contenu passe sous la barre d'onglets » sur un écran
  parfaitement sain : les sections d'un `<details>` FERMÉ gardent dans Chromium un
  `display: block` et une géométrie complète (`#s5` mesuré à `top: 874` sur un viewport de
  844), parce que le masquage se fait par `content-visibility`, qui retire la PEINTURE et pas
  le calcul. Le signal qui tranche était juste à côté et je ne l'avais pas lu :
  `scrollHeight === clientHeight`, donc la page ne défile même pas. J'ai failli « corriger »
  une mise en page qui marche. Une mesure de mise en page filtre sur la visibilité réelle
  (`checkVisibility()`), et un verdict surprenant se re-mesure sur une seconde grandeur avant
  d'être cru. ⚠️ Corollaire du même harnais : recopier `padding: 1rem` en dur sur le conteneur
  au lieu de rendre la VRAIE structure (`.contenu`, qui porte
  `calc(var(--barre-basse-h) + 1.7rem + …)`) fabrique exactement le défaut qu'on cherche.

- ⚠️⚠️⚠️ **UNE ÉTAPE DE CI SAUTÉE NE RESSEMBLE À RIEN — et celle-là était le SEUL mécanisme
  qui fait recharger le code au moteur** (21/09, C49-23). `deploy.yml` a échoué sur
  `Cannot create more versions: Script has reached the limit of 200 versions`. J'ai lu le log,
  vu que le **push avait réussi** (40 fichiers listés) et que seul le `clasp deploy` de la web
  app avait buté, puis j'ai écrit dans DEUX documents vivants que « le TICK exécute bien le
  nouveau code, c'est le push qui le décide ». **Faux.** Re-mesuré sur les ticks de 20:38 et
  20:44 UTC (le second postérieur au push de 20:39:36) : la ligne de Santé que le lot venait
  d'ajouter était ABSENTE — 18 lignes, pas 19. Le moteur tournait sur l'ancien code.
  La cause, LUE dans l'API des jobs et non déduite : l'étape « Assurer le déclencheur » porte
  `conclusion: "skipped"`. Sa condition était `if: steps.guard.outputs.ready == 'true'`, sans
  `always()` — **GitHub Actions saute une étape dès qu'une étape amont a échoué, quelle que soit
  sa condition**, et `continue-on-error: true` sur l'étape elle-même n'y change rien (il dit ce
  qui se passe quand ELLE échoue, pas quand une AUTRE a échoué avant). Or supprimer/recréer le
  déclencheur est précisément ce qui force Apps Script à recharger (piège n° 3), et le workflow
  le dit depuis toujours dans son propre commentaire — que j'avais lu.
  ⚠️ **Le défaut n'est pas « les 200 versions »** : n'importe quel échec du redéploiement de la
  web app (quota, réseau, secret retiré) figeait le moteur sur l'ancien code, en silence, avec
  un `clasp push` vert dans le log. Corrigé par `if: always() && steps.push.outcome == 'success'`
  — ce qui décide du code exécuté par le TICK, c'est le PUSH — et gardé par
  `test/pilote-ci.test.js` (3 mutations rouges : sans `always()`, sans `id: push`, et `always()`
  seul, qui réinstallerait le déclencheur même sur un push raté).
  ⚠️⚠️ **ET LE CORRECTIF NE SUFFIT PAS — mesuré, troisième étage de la même panne.** Le merge
  du correctif s'est déroulé exactement comme prévu (push ✅, deploy ❌, **déclencheur ✅**, avec
  « Déclencheur réinstallé — version servie : 5min|t7 »), et le moteur exécute TOUJOURS l'ancien
  code : la ligne attendue reste absente aux ticks de 21:00 et 21:04 UTC, postérieurs de 6 et
  10 minutes à la réinstallation. La raison est que la réinstallation passe par `/exec`, qui est
  justement ce que le `clasp deploy` raté laisse figé : le déclencheur est recréé PAR l'ancienne
  version. **Deux mécanismes expliquent la suite et rien ne permet de les départager d'ici** —
  un déclencheur créé depuis un déploiement épinglé qui reste sur cette version, ou bien le fait
  que ce qui a TOUJOURS forcé le rechargement soit le `clasp deploy` (création d'une version) et
  jamais la réinstallation du déclencheur. Dans le second cas, le commentaire du workflow décrit
  depuis le premier jour un mécanisme qu'il n'a jamais isolé — il marchait parce qu'un
  `clasp deploy` vert le précédait toujours.
  **La règle à retenir n'exige pas de trancher** : « supprimer/recréer le déclencheur force le
  rechargement » n'est vrai QUE si le canal qui le fait sert déjà le nouveau code. Un remède
  administré par le composant en panne n'est pas un remède.
  ⚠️ **Le « signal indépendant » de la CI ne pouvait pas voir ça** : `versionPilote_()` rend
  deux CONSTANTES (`TICK_MINUTES`, `RESET_TABLE_VERSION`) inchangées depuis des semaines. Il
  prouve que `/exec` CONNAÎT l'action — le piège n° 4, ce pour quoi il a été écrit — et jamais
  qu'elle sert le code du jour. **Un signal se juge sur ce qu'il fait VARIER** : celui-là ne
  varie pas quand la chose qu'on surveille change.
  ⚠️ **La leçon de conduite est celle qui coûte** : un raisonnement JUSTE sur les étapes qu'on a
  lues (« le push a réussi, donc le code est à jour ») reste une DÉDUCTION, et une déduction ne
  s'écrit pas au présent dans un document vivant. Trois rédactions, trois réfutations par la
  mesure, dans la même soirée — et à chaque fois le signal était à UN appel de distance. C'est
  mot pour mot « la cause suivante attend derrière celle qu'on vient de corriger » (§9 de
  Hubperso) : **une réparation n'est finie qu'avec la mesure de son effet**, jamais avec le
  correctif, et un déploiement partiellement rouge est exactement le moment de la prendre.
  ⚠️ **Un plafond de plateforme se remplit sans jamais prévenir** : les cinq runs précédents du
  même jour étaient verts, et chaque merge crée une version. Une fois les 200 atteintes, TOUS
  les merges suivants échouent au même endroit. Le geste (purger l'historique des versions du
  projet) appartient à Marc seul — frontière d'exécution — et il est routé dans `HANDOVER.md`
  §4, pas répété en chat.

- ⚠️⚠️ **UN PARSEUR NÉ DANS LE MÊME COMMIT QUE LA LIGNE QU'IL LIT PEUT N'AVOIR JAMAIS RIEN
  LU** (23/09/2026). `fileLecture` (app) et la ligne `Lecture — file` (moteur) sont nées
  ensemble en C49-14 (#389). Le parseur attend l'encodage `04:0/48` ; `Journal.gs` écrit
  `texteSanteFilePiece_()`, c'est-à-dire la PHRASE `04 ✅ (48) · … — tranche terminée`. Le
  motif ne matchait donc **rien**, la file rendait `[]`, et l'écran affichait « le moteur n'a
  pas encore publié sa file » en haut **et** « la file est publiée mais illisible » en bas —
  deux phrases contraires pour le même état, pendant neuf jours. Marc : « manque trop d'info
  sur cette page, qui marchent pas ».
  ⚠️ **Le commentaire du parseur affirmait le contraire de la réalité** (« le format lu est
  celui que le moteur ÉCRIT, jamais la phrase française »), et son test portait le titre
  « lit l'ENCODAGE du moteur, pas sa phrase française ». Il ne mentait pas par négligence :
  il **certifiait un contrat que le moteur n'a jamais rempli**. Un test écrit en même temps
  que le code qu'il teste ne prouve que la cohérence de l'auteur avec lui-même — il faut au
  moins **un cas copié de la sortie RÉELLE du producteur**, tel quel, sans le retaper.
  ⚠️ Réflexe : quand les deux moitiés d'un chaînon naissent dans le MÊME commit, aucune revue
  ne les met en présence — c'est `UN-TROU-ENTRE-DEUX-MOITIES-TESTEES-N-APPARTIENT-A-PERSONNE`
  dans sa forme la plus discrète, parce que les deux moitiés sont écrites par la même main le
  même jour et ont donc l'air d'avoir été confrontées.
  ⚠️ Et ce que le défaut a produit à l'écran mérite d'être nommé à part : **« le moteur n'a
  pas encore publié » est une phrase littéralement VRAIE et parfaitement inutile.** Elle ne
  dit ni pourquoi, ni quoi faire, et elle se lit comme une panne de la campagne alors que la
  campagne va très bien. Le remède est un bandeau qui NOMME les lignes attendues et absentes
  (`lignesSanteManquantes`, dérivée de ce que l'écran LIT) et le geste qui les débloque.

- ⚠️ **UN POURCENTAGE JUSTE SUR UNE POPULATION QU'ON NE NOMME PAS EST TROMPEUR** (même jour).
  L'écran affichait « **97 %** des documents mesurés sont rangés avec certitude · 31 + 15071
  classés au mieux · sans mesure ». Chaque nombre était exact : 97 % porte sur les ~5 800
  documents dont le classement a été **mesuré**, parmi 20 947 au catalogue. Mais le
  dénominateur n'était nulle part, et les deux nombres restants étaient collés à deux
  libellés séparés par un point médian — donc illisibles. Un chiffre qu'on ne peut pas
  rapporter à une population n'informe pas : il rassure ou il inquiète, au hasard.
  ⚠️ Même famille, même écran : « il reste environ **0 jours** » était vrai de la TRANCHE
  (0 restants) et se lisait comme une affirmation sur tout le Drive, où il reste plus de trois
  mille papiers. **`0` et « je ne sais pas » ne se confondent jamais** — d'où `restantsTranche`,
  qui rend `null` sur une file illisible, et un estimé qui ne s'affiche que si le reste est
  connu ET non nul.

## 10. Style et compte-rendu

> 📣 Forme des comptes-rendus, des commits, des PR et des docs générées :
> [convention commune aux neuf dépôts](https://github.com/MoKarade/claude-config/blob/main/conventions/COMPTE-RENDU.md).
> Elle régit **la forme** ; ce fichier garde **le contenu métier**. Sur la forme, c'est la
> convention qui gagne ; sur le métier, c'est ce fichier.

@docs/COMPTE-RENDU.md

⚠️ **Pourquoi une COPIE et pas seulement un lien.** Un `CLAUDE.md` ne charge rien hors de son
propre arbre : le lien ci-dessus est lisible par un humain, il n'arrive jamais dans la session.
C'est exactement le mode de panne du 20/08/2026 — les règles de cadrage écrites dans un
`~/.claude/CLAUDE.md` local ne descendaient nulle part, et Marc constatait « je ne vois pas la
différence » alors que rien n'était jamais arrivé. `docs/COMPTE-RENDU.md` est donc une copie
**synchronisée**, importée ci-dessus, et la CI échoue si elle a dérivé de la source.

Pour changer la convention : la changer dans `claude-config`, propager les huit copies, mettre
à jour les huit empreintes. La friction est le garde-fou — une copie qu'on peut modifier sur
place redevient huit conventions différentes en trois mois.

## 11. Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri)

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
