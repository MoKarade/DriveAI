# ADR-0024 — Exécution automatique du plan de consolidation + entités par SEED

- **Statut** : accepté (décision Marc 2026-07-17, verbatim : « je veux que ce soit toi qui le
  fasse » ; « je veux que tu change tout live » ; « il y a beaucoup trop de dossiers inutiles,
  ça m'empêche de faire mes recherches, c'est inutilisable » ; « que l'ajout de dossiers soit
  vraiment sécurisé et safe et simple et utile seulement » ; « pas de dossier par banque »)
- **Complète** : ADR-0023 (taxonomie à plat + plan dry-run). **Dérogation §4 assumée** : exécution
  directe sur instruction explicite de Marc (pas de boucle NotebookLM) — la revue flotte reste le
  garde-fou adversarial.

## Décision

1. **SEED des entités (PR-A, `seedEntitesMarc_`)** : les listes RÉELLES de Marc sont validées par
   le code (one-shot gaté `SEED_ENTITES_TAG`) — 4 logements (3325 4e Avenue, 783 Avenue Moreau,
   3987 Route Des Rivières, 1548 Avenue De La Roselière), 3 véhicules (Ford Fiesta, VW Jetta,
   Toyota bZ), 2 employeurs (Automatech, Robovic), 6 écoles (Lycée Thérèse d'Avila, Lycée Gustave
   Eiffel, IUT Du Littoral, Cégep De Sherbrooke, IMERIR, HAMK). Libellés = points fixes de
   `canoniserEntite_` (test). Les entités validées de `02 · Finances` sont DÉVALIDÉES (« pas de
   dossier par banque » — statut tracé, jamais de suppression). L'auto-validation « vue ≥ 3 fois »
   est COUPÉE (`ENTITES_AUTO_VALIDATION: false`) : un dossier ne naît plus que des listes
   explicites de Marc (seed, formulaire de correction, app).
2. **EXÉCUTEUR (PR-B, `ConsolidationExec.gs`)** : le moteur applique les lignes `Déplacer` et
   `Doublon` du `PlanConsolidation`, au fil de leur génération (progressif, « live ») :
   - **seule mutation : `moveTo`** (déplacement, réversible) — verrou de surface : aucun
     setTrashed/delete/setName/copie/UrlFetchApp dans le module ;
   - **§1 re-vérifiée STRICTEMENT à CHAQUE mutation** (`aParentProtege_` échec-fermé — le plan a pu
     vieillir) ; fichier **multi-parents jamais déplacé** (`moveTo` retire TOUS les parents —
     patron Reorg) ;
   - cible parsée/validée par `decouperCiblePlan_` (PURE) : domaine connu ou `_Doublons`, jamais un
     chemin arbitraire — les seuls dossiers créés sont ceux de la règle unique ;
   - curseur de ligne persisté (onglet append-only → stable), clé `consoexec|<tag>|<fileId>` posée
     APRÈS le move, no-op « déjà en place » (rejeu sûr) ; échec transitoire re-tenté puis abandonné
     à `QUARANTAINE_MAX` (curseur jamais gelé à vie) ;
   - budgets : 2 min/run + **10 min/j en ms réelles persistées** ; `CONSOLIDATION_EXEC_ACTIF:
     false` = suspension immédiate.
3. **Ce qui reste à Marc (constitution §2.2, non négociable)** : la mise à la corbeille des
   dossiers VIDÉS — uniquement par l'APP, à son clic (ADR-0014, récupérable 30 j). Et le réveil
   du projet Apps Script (`installerTrigger`) — hors de portée de la session.

## Garde-fous & risques

- **Aucune suppression** (§2.2) : `moveTo` seul ; doublons → `_Doublons`. Vérifié par test de
  surface sur le module.
- **Zone 04** : jamais mutée (strict, échec-fermé, par mutation) ; le plan la marque déjà
  « Ignoré » et l'exécuteur ne consomme que Déplacer/Doublon — double barrière.
- **Convergence** : cible du plan = règle unique partagée avec le flux vivant (tripwire ADR-0023) ;
  un fichier déplacé est « OK » à la re-génération ; clés additives.
- **Réversibilité** : chaque move est inversable à la main ; l'Index trace `consolidé*` par
  fileId ; suspension à un booléen.
- **Risque assumé** : le seed valide les entités SANS passage par l'app (c'est l'instruction) ;
  une variante de graphie non couverte (ex. « Volkswagen Jetta » vs « VW Jetta ») se classe à
  plat/année — fusionnable plus tard dans l'app, jamais un blocage.

## Méthode de test

Fonctions PURES (`decouperCiblePlan_`, `ligneAAppliquer_`, `budgetJourConsoExec_`, seed) +
comportement mocké (curseur, abandon 3 essais, no-op déjà-en-place) + verrou de surface
anti-mutation du module exec (moveTo seul) + revue flotte du lot complet avant merge final.
