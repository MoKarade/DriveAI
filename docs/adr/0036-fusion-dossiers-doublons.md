# ADR-0036 — Fusion des dossiers d'entité en double/synonymes (dry-run validé, PR1)

- **Date** : 2026-08-05
- **Statut** : **accepté (PR1 dry-run seul)** — décision Marc « dry-run de fusion que je valide ».
- **Chantier** : #47.

## 1. Problème (mesuré sur le Drive réel, diagnostic un-clic exhaustif)

Après le drainage du backlog (ADR-0035), il reste une pollution structurelle : **83 dossiers en trop**
répartis sur **37 groupes** de doublons/synonymes, sur 6 domaines (353 sous-dossiers au total, 181 sans
fichier direct). Motif : à chaque graphie différente d'une même entité, le pipeline a créé un dossier
distinct — `IRCC` / `IRCC (fédéral)` / `Immigration, Réfugiés Et Citoyenneté Canada`… (5 pour IRCC),
`Robovic` / `Robovic Inc.`, `IUT Du Littoral` éclaté en ~10, etc. Dans la plupart des groupes UN dossier
porte les fichiers, les autres sont des variantes vides.

## 2. Contrainte NON négociable : pas de fusion à l'aveugle (faux positifs)

Le regroupement DÉTERMINISTE (canonique + recouvrement de jetons + acronyme commun) est un **radar**, pas
une décision : il a des **faux positifs** prouvés. ⇒ Toute fusion doit être **validée par Marc**, ligne par
ligne. On ne fusionne JAMAIS automatiquement sur la seule heuristique. Motifs de sur-regroupement à écarter
à la validation (revue structure-keeper) :

- **Jeton commun entre entités distinctes** : `IUT De Lyon` groupé à tort avec `IUT Du Littoral` via
  « IUT » (deux écoles) ; deux banques partageant un mot ; deux campus numérotés (`Université Paris 1` vs
  `Paris 8`) ; deux adresses même voie, numéro civique différent (`12 Rue Victor Hugo` vs `45 …`).
- **Millésime** : `Honda Civic 2014` vs `Honda Civic 2017` = **deux véhicules réels** (TAXONOMY §véhicules).
  Ce cas est **traité en amont** par le veto `anneesDistinctes_` (PR1, §5) : le radar ne les lie plus (ni
  par jetons, ni par clé canonique — `canoniserVehicule_` retirait pourtant l'année). Cité ici pour mémoire.

## 3. Décision — PR1 : DRY-RUN seul (ZÉRO mutation)

Une fonction UN-CLIC `genererPlanFusion` (lecture seule + écriture d'un RAPPORT) :
1. Pour chaque domaine, liste les sous-dossiers directs (nom, id, nb de fichiers directs, borné).
2. Les **clusterise** (union-find) via des liens : clé canonique identique (`cleCanoniqueEntite_`),
   recouvrement de jetons (`jaccardTokens_ ≥ 0,4`), inclusion, ou **acronyme commun** (IRCC/MIFI…).
   Fonctions PURES réutilisant la canonicalisation du moteur (`Entites.gs`), testées.
3. Choisit une **CIBLE** proposée par cluster — jamais imposée, Marc peut la changer. Ordre : (0) une
   **ANCRE STRUCTURELLE** (bucket de `STRUCTURE_CIBLE_RESET` du domaine, segment `estSegmentStructurel_`,
   type d'identité) est GARDÉE d'office : le reset la recrée PAR NOM, la vider serait non convergent
   (revue structure-keeper #1) ; (1) le plus de fichiers ; (2) le nom le plus descriptif ; (3) alpha.
4. Écrit le plan dans l'onglet **`PlanFusion`** : une ligne par dossier, avec `Rôle` (CIBLE/source),
   `Nb fichiers`, et une colonne **`Action`** que Marc édite **PAR LIGNE SOURCE** : `Fusionner` (fondre
   cette source dans la CIBLE) / `Ignorer` (faux positif) — pas « par groupe » : un cluster peut mélanger
   un vrai synonyme et un faux positif (transitivité union-find, cf. IUT). Défaut `À VALIDER` ; une source
   qui est elle-même une ancre structurelle est écartée d'office (`Ignorer (structurel)`, opt-out).

**ZÉRO déplacement, ZÉRO suppression, ZÉRO appel LLM.** Le plan est un artefact que Marc relit et cure.
`genererPlanFusion` est idempotent (ré-exécutable : purge et régénère le plan).

## 4. PR2 (suite, NON livrée ici) — exécution gardée

Une fois le plan curé par Marc : `appliquerPlanFusion_` (gaté OFF, exécuté seulement au feu vert)
appliquera **uniquement** les lignes SOURCE marquées `Fusionner` (match STRICT `=== 'Fusionner'`) : `moveTo`
des fichiers de la source vers la CIBLE (jamais de suppression, §2), **§1 zone protégée re-vérifiée à chaque
mutation**, **04 · Immigration en INTERNE uniquement** (jamais de sortie de 04, résolveur construit depuis
la racine 04 — §2.1b), garde multi-parents (`aParentProtege_`, remontée d'ancêtres, avant CHAQUE `moveTo`),
borné/reprenable, dossiers vidés → `vide-candidat` (corbeille réservée à l'APP au clic de Marc, ADR-0014).
Tripwires : `moveTo` seul, jamais de sortie de 04. Livré ATOMIQUEMENT avec sa revue flotte.

**Exigences taxonomie (revue structure-keeper), à honorer dans PR2 :**
- **Re-pointage `Entités.Dossier ID` (contrat C21-06, TAXONOMY L218)** : si un membre du cluster EST le
  `Dossier ID` d'une entité VALIDÉE (ADR-0028) et qu'on le vide, `repointerEntites_(source→cible)` doit
  être appelé — sinon le flux vivant (qui résout par ID, `dossierEntiteParId_`) recrée le dossier à plat
  → retour à deux dossiers (non-convergence). Idéalement : la CIBLE **EST** le `Dossier ID` référentiel
  quand un membre l'est.
- **CIBLE = nom CANONIQUE** (`canoniserEntite_`), pas « le plus long » : éviter de garder `Robovic Inc.`
  (suffixe juridique) au lieu de `Robovic`. En PR1 la préférence d'ancre structurelle couvre déjà 04
  (`IRCC (fédéral)`/`MIFI (Québec)` sont canoniques) ; PR2 généralise aux entités validées.
- **Coordination avec `reorganiserInterne04_`** (`Reset.gs`) : le reset consolide DÉJÀ les graphies
  internes de 04. Gater la fusion de 04 sur `!resetEnCours_()` (ou viser les mêmes cibles canoniques)
  pour ne pas se disputer les mêmes fichiers.
- **Portée : niveau 1 seulement.** `collecterSousDossiersFusion_` ne liste que les enfants DIRECTS du
  domaine. Un doublon NICHÉ (`Employeurs/Robovic` vs `Employeurs/Robovic Inc.`) n'est PAS détecté par
  PR1 — limitation assumée, à étendre (scan récursif borné) si le besoin apparaît après curation.

## 5. Garde-fous & test (PR1)

- **Read-only** : `genererPlanFusion` ne fait que lister des dossiers + compter des fichiers + écrire
  l'onglet `PlanFusion`. Aucune mutation Drive. Verrouillé par un test de surface (aucun `moveTo`/
  `setTrashed`/`setName` dans `Fusion.gs` tant que PR2 n'ajoute pas l'exec gardé).
- **Fonctions PURES testées** (`test/fusion.test.js`) : clustering (IRCC×5, MIFI×2 groupés ; IUT Lyon
  NON forcément séparable — documenté comme faux positif que MARC tranche), choix de cible, faux positif.
- **Veto millésime** (`anneesDistinctes_`, en TÊTE de `dossiersLies_`) : deux modèles-année distincts ne
  se lient jamais (véhicules réels) — aligné sur `estFusionnableEntite_`.
- **Ancre structurelle non vidable** : `cibleFusion_` garde un bucket du reset / segment structurel comme
  cible ; `lignesPlanFusion_` écarte d'office toute ancre-source (`Ignorer (structurel)`). Empêche le plan
  de proposer de vider un dossier que le reset recrée par nom.
- Revue flotte adversariale AVANT merge (§8) : code-reviewer ✅, apps-script-quota (3 correctifs intégrés),
  structure-keeper (findings PR2 ci-dessus + veto millésime & ancre structurelle intégrés en PR1).
