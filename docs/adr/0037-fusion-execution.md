# ADR-0037 — Exécution du plan de fusion des dossiers en double (#47 PR2, gardée)

- **Date** : 2026-08-05
- **Statut** : **accepté (gaté OFF)** — suite de l'ADR-0036 (dry-run PR1). Décision Marc « fais tout toi ».
- **Chantier** : #47 PR2.

## 1. Problème / objectif

PR1 (ADR-0036) a livré le **dry-run** : Marc cure l'onglet `PlanFusion` en marquant chaque ligne
**source** `Fusionner` (fondre dans la CIBLE de son groupe) ou `Ignorer`. PR2 **applique** ces
décisions : déplacer les **fichiers directs** de chaque dossier source `Fusionner` vers la CIBLE de
son groupe, puis retirer la coquille vide (via l'app, ADR-0014). Objectif : résorber les **83 dossiers
en trop** sans jamais violer §1/§2, et sans re-déclencher le ping-pong avec le reset/consolidation.

**Impact quotas / coût** : **ZÉRO appel LLM** (pure I/O Drive `moveTo`). Runtime : campagne de fond au
budget QUOTIDIEN propre (`FUSION_EXEC_BUDGET_JOUR_MS`, modeste — 6 min/j), **OFF par défaut**, ordonnée
**APRÈS** la consolidation (drain prioritaire du backlog) et gatée `!resetEnCours_()` (une seule main
déplace à la fois). C'est une **addition NETTE** de 6 min à l'agrégat des campagnes reset-OFF
(GMAIL_HISTO 20 + CONSO 12 + CONSO_EXEC 6 + SYNC 12 + FUSION 6 = **56 min/j**), qui reste sous le mur
runtime ~90 min/j — **verrouillé par un invariant d'enveloppe** (`test/orchestration.test.js`, plafond
65 min dérivé, prouvé par mutation, leçon C28-42). *(Le reset étant OFF, son budget vaut déjà 0 : rien
n'est « libéré » à cet instant — d'où l'invariant plutôt qu'un raisonnement de réallocation.)*

## 2. Garde-fous NON négociables (hérités des voisins + §2.1b)

`FusionExec.gs` — **la SEULE mutation Drive est `moveTo`** (déplacement, jamais de suppression),
verrouillée par un test de surface (aucun `setTrashed`/`setName`/`createFolder`/`createFile`/
`createShortcut`/`UrlFetchApp.fetch`).

- **§1 zone protégée** : hors 04, un fichier sous zone protégée (multi-parents vers 04) n'est **JAMAIS**
  détaché (`aParentProtege_` échec-fermé). **04 · Immigration en INTERNE PERMIS (§2.1b)** : un groupe de
  domaine `04 · Immigration` déplace ses fichiers vers une CIBLE **structurellement sous 04**
  (`segmentsSousDomaine_(cible, DOMAINES['04'])`, échec-fermé) — jamais de sortie de 04. La **source**
  aussi est re-vérifiée sous son domaine (fail-closed) : source ET cible sous le même domaine ⇒ le
  déplacement est interne par construction.
- **CIBLE re-vérifiée à CHAQUE run** : un ID corbeillé / hors domaine / illisible ⇒ groupe **ignoré**
  (tracé une fois). Le plan a pu vieillir depuis sa génération.
- **MULTI-PARENTS jamais déplacé** (`moveTo` retirerait TOUS les parents — détachement interdit).
- **Sous-dossiers jamais déplacés** : seuls les **FICHIERS directs** de la source bougent (pas d'arbre).
  Une source qui garde des sous-dossiers ne devient pas vide → pas de coquille (correct).
- **Ancre STRUCTURELLE jamais une SOURCE** (revue structure-keeper, défense en profondeur à la MUTATION,
  pas seulement au plan) : `estAncreStructurelleFusion_(domaine, nom)` (bucket `STRUCTURE_CIBLE_RESET` /
  segment `estSegmentStructurel_`) refuse de vider un dossier que le reset recrée PAR NOM — SAUF
  dé-duplication d'un doublon de **MÊME NOM** (le reset find-or-create rend le canonique → pas de
  recréation). Et on ne **re-pointe JAMAIS une entité vers une cible structurelle** (fourre-tout).
- **Convergence sur move en échec** : un `moveTo` qui throw est capturé PAR FICHIER (le fichier reste en
  place, journalisé, la source draine quand même) — pas de compteur d'essais (un déplacement raté n'est
  pas réessayé indéfiniment). Une source à ≥ cap fichiers indéplaçables est marquée **`bloquée`** pour
  ne pas la re-scanner à vie (sinon `FINI` jamais posé).
- **Coquille vide** → `vide-candidat` (corbeille réservée à l'**app**, au clic de Marc, ADR-0014 ;
  `detecterDossierVide_` exclut déjà zone protégée/structurel — un dossier 04 vidé n'est jamais un candidat).
- **Re-pointage `Entités.Dossier ID`** (contrat C21-06) : une fois la source drainée,
  `repointerEntites_(sourceId → cibleId)` — sinon le flux vivant (résolution par ID) recréerait le
  dossier mort.
- **Idempotence** : `fusionexec|<tag>|<fileId>` (fichier fondu) + `fusrow|<tag>|<sourceId>` (source
  drainée), **keyés par ID** (l'onglet `PlanFusion` est RÉGÉNÉRÉ par le dry-run → pas de curseur de
  ligne stable, on ne s'appuie que sur des IDs).
- **Bornes** : budget/run (`FUSION_EXEC_BUDGET_MS`) + quotidien en ms réelles + plafond sources/run +
  plafond fichiers/source. Collecte des IDs **puis** déplacement (jamais muter pendant l'itération —
  patron `collecterInterne04Reset_`). Étape SECONDAIRE **enveloppée** (jamais bloquer l'intake).

## 3. Décision — mécanique

`appliquerPlanFusion_(estBudgetDepasse)` (étape de tick, gatée `FUSION_EXEC_ACTIF` + budgets +
`!resetEnCours_()`, APRÈS la consolidation) :
1. Lit `PlanFusion`. `fusionsAExecuter_(lignes)` (PUR) calcule, par groupe, la CIBLE (ligne `CIBLE`)
   et, pour chaque source `Fusionner` (**match STRICT** `=== 'Fusionner'`), le couple
   `{sourceId, cibleId, domaine}`. Ignore : source == cible, cible sans ID.
2. Pour chaque source non déjà drainée (`fusrow|` absent) : valide la CIBLE (`cibleFusionValide_`) et la
   SOURCE sous leur domaine, puis fond les **fichiers directs** (`fondreSourceFichiers_` :
   collecte-puis-déplace, gardes §1/multi-parents/idempotence par fichier).
3. Source **drainée** (tous les fichiers directs parcourus dans le budget) ⇒ `repointerEntites_` +
   `detecterDossierVide_` + clé `fusrow|`. Sinon budget coupé → repris au run suivant.
4. Court-circuit TERMINAL `DriveAI_FUSION_EXEC_FINI === tag` quand plus aucune source `Fusionner`
   n'est à faire (plan vide ou tout drainé). **Re-évaluer** = bumper `FUSION_EXEC_TAG` (patron conso).

## 4. Coordination reset / consolidation

- **04 interne** : `reorganiserInterne04_` (reset) consolide déjà les graphies de 04. Le reset étant OFF
  (`RESET_ACTIF=false`), pas de conflit aujourd'hui. Le gate `!resetEnCours_()` garantit que si Marc
  ré-arme le reset, la fusion 04 se met en pause (une seule main).
- **Consolidation** : la fusion tourne APRÈS la consolidation dans le tick (drain prioritaire), sur son
  propre budget quotidien. La cible d'une entité re-pointée (C21-06) reste cohérente avec la résolution
  par ID du flux vivant et de la consolidation (même `Entités.Dossier ID`).

## 5. Test & revue

- **Fonctions PURES testées** (`test/fusion-exec.test.js`) : `ligneFusionAAppliquer_` (STRICT),
  `fusionsAExecuter_` (join groupe→cible, Ignorer/structurel exclus, source==cible exclu),
  `budgetJourFusionExec_`.
- **I/O gardé (mocks)** : 04 interne AUTORISÉ (cible sous 04) ; hors-04 sous zone protégée SKIP ;
  multi-parents SKIP ; sous-dossier jamais déplacé ; cible corbeillée/hors domaine ⇒ groupe ignoré ;
  `moveTo` vers la bonne cible ; `repointerEntites_` + `vide-candidat` au drainage ; idempotence (rejeu) ;
  **source structurelle refusée** (sauf dédup de même nom) ; **cible structurelle ⇒ pas de re-pointage** ;
  **move en échec laissé en place sans bloquer la source** ; **stall ≥cap ⇒ `bloquée`**.
- **Orchestrateur testé** (`appliquerPlanFusion_`) : plan vide ⇒ `FINI` ; tout drainé ⇒ sources traitées
  + `FINI` ; budget coupé ⇒ pas de `FINI` ; cible invalide ⇒ `fusrow` + poursuite ; tag `FINI` ⇒
  court-circuit ; source déjà drainée ⇒ sautée.
- **Invariant d'enveloppe** (`test/orchestration.test.js`) : `FUSION_EXEC_BUDGET_JOUR_MS` entre dans la
  somme reset-OFF ≤ plafond 65 min, prouvé par mutation (leçon C28-42).
- **Verrou de surface** : `moveTo` seule mutation dans `FusionExec.gs`.
- **Revue flotte adversariale AVANT merge** (§8) — verdicts intégrés : **security-auditor 🟢 conforme**
  (aucun fichier perdu/détaché de 04/supprimé) ; **apps-script-quota** (garde-temps, budgets, stall
  ≥cap) ; **structure-keeper** (garde source structurelle + re-pointage non-fourre-tout) ;
  **code-reviewer** (tests orchestrateur + convergence sur move en échec).
