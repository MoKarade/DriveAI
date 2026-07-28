# ADR-0028 — Routage TOPOLOGIQUE : le `Dossier ID` prime sur le chemin textuel

- **Statut** : accepté (plan architecte NotebookLM, chantier C28-31, 2026-07-28)
- **Décideur** : Marc (via l'arbitrage architecte, après découverte de la faille en revue de C28-31)
- **Corrige** : **ADR-0027 §4**, dont l'affirmation « le référentiel `Entités` pointe vers le
  `Dossier ID` Drive, donc le flux le retrouve où qu'il soit » était **FAUSSE** pour le pipeline actif.
- **Complète** : ADR-0023 (taxonomie à plat) et ADR-0002 — la règle qui décide *quel* sous-dossier est
  inchangée ; seule la *résolution* passe du nom à l'identité.

## Problème

Le chantier C28-31 (limite des ~7 sous-dossiers, ADR-0027) repose sur la possibilité de **déplacer un
dossier d'entité** sous un dossier de regroupement (« Anciens employeurs »). La revue a montré que le
moteur ne le supportait pas — et que le trou existait **déjà** pour tout déplacement manuel de Marc.

Chaîne réelle, vérifiée dans le code (`ANALYSE_V2: true`) :

| Maillon | Constat |
|---|---|
| `Entites.gs entitesValideesParCle_` | rendait `{clé → libellé}` : le `dossierId` était **lu puis jeté** |
| `Router.gs deciderRoutageV2_` | `sousDossier_(dom, nom)` → `getFoldersByName` = **enfants directs seuls**, sinon `createFolder` |
| `Router.gs dossierEntiteCible_` | seul lecteur de l'ID… appelé uniquement par le routage **v1**, mort |
| `Consolidation.gs` | décision par comparaison **textuelle** de sous-chemins |
| `ConsolidationExec.gs dossierCiblePlan_` | find-or-create **par nom** depuis la racine du domaine |

Conséquence en cascade dès qu'un dossier d'entité n'était plus enfant direct de son domaine :
1. le flux vivant **re-créait** un dossier à plat (1 entité = **2** dossiers) ;
2. la consolidation (`CONSOLIDATION_EXEC_ACTIF: true`) **ressortait les fichiers** au tick suivant ;
3. `detecterDossierVide_` inscrivait le dossier vidé en `vide-candidat` → **proposition de corbeille
   sur le regroupement que Marc venait de valider**.

C'est le motif interdit par CLAUDE.md §7 (« l'un crée ce que l'autre défait »).

## Décisions

1. **L'IDENTITÉ prime sur le CHEMIN.** Le `Dossier ID` du référentiel `Entités` est la **vérité
   topologique** d'une entité validée ; son nom n'est plus qu'un **repli**. L'ID est stable aux
   déplacements et renommages Drive, et déjà re-pointé par `repointerEntites_` lors d'une fusion :
   son cycle de vie était déjà complet — il n'était simplement pas lu.

2. **La règle reste UNIQUE.** `sousCheminDomaine_` (Router.gs) rend désormais le couple `{nom, id}`,
   consommé par le flux vivant **et** par la consolidation. `id` n'est renseigné que pour une
   **entité validée** ; les segments de **type d'identité** et d'**année** restent résolus par nom
   (ils n'ont pas d'identité au référentiel). Le tripwire flux ↔ consolidation compare maintenant
   les **deux** champs — sinon on obtiendrait le bug symétrique (flux par ID, plan par nom).

3. **Un SEUL résolveur pour les deux exécutants.** `dossierEntiteParId_` (Router.gs) est appelée par
   `deciderRoutageV2_` **et** par `dossierCiblePlan_`. La divergence « la décision dit OK pendant que
   l'exécution recrée à plat » devient **impossible par construction**, au lieu d'être surveillée.

4. **Décision de consolidation : topologie d'abord.** `parentId === dossierIdCible` ⇒ `OK` **à toute
   profondeur**, évalué **avant** la comparaison textuelle et **après** les gardes §1 (zone protégée,
   contrôle illisible, raccourci, doublon) — dont l'ordre est inchangé.

5. **Échec OUVERT : quatre cas de repli par nom** (jamais un blocage, jamais un classement sur du flou) —
   pas d'ID au référentiel (dossier pas encore créé) ; ID mort/illisible ; dossier **CORBEILLÉ** ;
   dossier sorti de son **domaine**.

## Garde-fous (§2)

- **Dossier corbeillé refusé.** `DriveApp.getFolderById` rend aussi un dossier **en corbeille**. L'app
  peut corbeiller un dossier d'entité devenu vide (ADR-0014) **sans** toucher `Entités.Dossier ID` :
  sans la garde `isTrashed()`, le moteur aurait rangé des documents dans un dossier promis à la purge
  Drive à 30 jours — **perte silencieuse**. Refus ⇒ repli par nom.
- **Confinement au domaine.** `segmentsSousDomaine_` remonte la chaîne du premier parent (bornée par
  `CONFIG.ROUTAGE_PROFONDEUR_MAX`) : un ID périmé ou déplacé ne peut jamais faire classer un document
  **hors de son domaine**, ni silencieusement sous la zone protégée `04`. Le gain topologique vaut
  **à l'intérieur** du domaine, pas au-delà.
- **Chemin honnête dans l'Index.** Le chemin inscrit est celui **réellement obtenu**
  (`domaine/Anciens employeurs/Robovic`), pas le nominal : sinon `cheminsSyncCompatibles_`
  (comparaison par suffixe) juge l'Index incompatible avec le Drive, marque le fichier « déplacé »
  et **vide son domaine**.
- Aucune suppression introduite ; aucun scope ; aucun appel LLM ; idempotence inchangée.

## Conséquences

- Un dossier d'entité peut vivre **n'importe où sous son domaine** — regroupé (ADR-0027) ou déplacé à
  la main par Marc — sans casser le classement ni déclencher de re-déplacement en boucle.
- Le plan de consolidation **déjà écrit** (tag `conso-2`) redevient sûr : ses lignes `Déplacer`
  résolvent par ID au moment du move, donc elles n'extraient plus les fichiers d'un dossier regroupé.
- ADR-0027 devient réellement applicable : la partie « déplacer les dossiers dans le regroupement »
  peut être livrée (chantier C28-31, gelé en attendant cet ADR).

## Angles morts connus (à traiter séparément, tracés ici)

- `dossiersExistantsDomaine_` (Entites.gs) n'inventorie que les enfants **directs** du domaine : un
  dossier d'entité regroupé en sort, ce qui affaiblit le « reality check » anti-variantes. Sans danger
  tant que `Dossier ID` est renseigné (garde de `creerDossiersEntitesValidees_`).
- Appariement d'entité **préexistant** : le flux apparie par `classif.sousDossier`, la consolidation
  par le tiers du nom de fichier (`analyserNomClasse_`). Un émetteur différent de l'entité produit
  encore une divergence — indépendante de cet ADR.
- `parentId` ne lit que le **premier** parent : un fichier multi-parents dont l'entité est le 2ᵉ parent
  sera coté `Déplacer` (sans danger — l'exécution refuse les multi-parents, mais ça pollue le plan).
