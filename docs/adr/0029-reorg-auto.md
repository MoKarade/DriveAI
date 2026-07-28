# ADR-0029 — Campagne de réorganisation AUTOMATIQUE (limites cognitives)

- **Statut** : accepté (plan architecte NotebookLM, chantier C28-32, 2026-07-28)
- **Décideur** : Marc (2026-07-28, après avoir constaté que la règle des ~7 ne s'appliquait qu'à la
  demande : « je veux que ça reclasse les dossiers actuels »)
- **Complète** : ADR-0027 (limite cognitive) et ADR-0028 (routage topologique, son prérequis).

## Problème

ADR-0027 définit la limite (~7 sous-dossiers) et ADR-0028 pose les rails qui la rendent tenable (un
dossier d'entité regroupé n'est plus re-créé à plat). Mais le système **attend passivement** que Marc
clique « Analyser » : `appliquerReorgIA_` sort immédiatement s'il n'y a pas de ligne `demande` au
statut « analyse demandée » dans l'onglet `Réorg`. Le Drive ne converge donc jamais tout seul.

## Décisions

1. **Détection automatique.** Le moteur scanne lui-même l'arborescence (`genererDemandeReorgAuto_`),
   trouve un dossier dépassant la tolérance (≥ `REORG_MAX_SOUS_DOSSIERS_TOLERANCE` sous-dossiers
   **regroupables**) et **dépose la demande à la place de Marc**. Le reste du pipeline (analyse LLM,
   écriture des actions `proposé`, validation, application gardée) est **inchangé**.

2. **Régulation stricte — zéro spam.** Deux gates :
   - **budget** : au plus `REORG_AUTO_MAX_JOUR` (**3** — décision Marc 2026-07-28 « accélère », révise
     1) dépôts automatiques par jour (≈ 0,06 $/j). **Doit rester ≤ `REORG_MAX_JOUR`** (5, le plafond
     des analyses LLM, compteur DISTINCT) : au-delà, les demandes s'empileraient sans être analysées —
     et il faut garder de la marge pour les réorgs MANUELLES de Marc ;
   - **« assiette propre »** : aucune demande n'est déposée tant que Marc a quelque chose à traiter —
     une demande en attente d'**analyse**, ou des **ACTIONS** d'un plan encore `proposé`/`validé`.
     Le moteur ne propose un nouveau dossier que quand le précédent est soldé : campagne
     naturellement **séquentielle**.
     **⚠ Correctif 2026-07-28 (revue quota) :** l'occupation se mesure sur les **ACTIONS**, jamais sur
     le statut d'une ligne `demande`. `proposé` y est **TERMINAL** (`solderDemande_` est le dernier
     écrivain moteur, l'app ne solde que les actions) — s'en servir verrouillait la campagne **à vie**
     dès la première analyse, et interdisait le tour 2 du regroupement.

3. **Skip-list (convergence).** Un dossier désigné par la campagne est mis en sourdine
   `REORG_AUTO_SKIP_JOURS` (30) jours — inscrit dans `DriveAI_REORG_SKIP`, entrées expirées purgées à
   l'écriture — sur **TOUT solde terminal** : « aucune action proposée », mais aussi portée trop
   large, zone protégée, aucun dossier analysable, abandon après N tentatives *(correctif revue
   quota)*. Ne couvrir que le « 0 action » laissait le dossier éligible après un échec :
   `choisirDossierSature_` re-choisissait **le même** le lendemain, en ré-armant les essais LLM à
   chaque nouvelle demande — jusqu'à saturer le plafond quotidien et priver Marc de ses réorgs
   manuelles. Mise en sourdine, jamais définitive.

4. **Cibles = RACINES de domaine seulement** *(correctif revue quota)*. La campagne AUTO ne
   sélectionne qu'un dossier **sans « / » dans son chemin**. C'est là que la saturation arrive
   vraiment (12 employeurs sous `05 · Carrière`). Un dossier de **regroupement** qu'on vient de
   remplir de k ≥ tolérance entités est saturé **par construction** : il redeviendrait aussitôt la
   cible et on demanderait au LLM de sous-grouper ce qu'il vient de grouper (sur-imbrication, ou
   0 action au prix d'une analyse). Un dossier profond reste couvert par une réorg **manuelle**.

5. **Abandon déterministe ⇒ la journée est consommée** *(correctif revue quota)*. `interrompu`
   (tick chargé) ne consomme rien : on retente. Mais `trop-large` et `protege` sont **déterministes** —
   re-scanner referait le même BFS complet **à chaque tick** (288×/jour, des milliers d'appels Drive
   en pure perte). Ces abandons consomment donc le budget du jour, avec une trace au Journal.

6. **BUDGET TAIL** *(correctif revue quota)*. L'étape est **pure I/O** Drive/Sheet (un BFS de lecture
   + un `appendRow`, zéro LLM) : elle prend le garde étendu (`CONFIG.BUDGET_MS`, 4,5 min) comme la
   consolidation, et non le budget de tick 3 min réservé aux appels Sonnet. Elle n'utilise que le
   reliquat, sans jamais voler de temps au flux vivant.

7. **Mécanique en 2 tours, assumée.** Un dossier créé n'a pas encore de numéro dans l'inventaire :
   « créer le parent **et** y déplacer » est impossible dans un même plan. Tour 1 crée
   « Anciens employeurs » (Marc valide) ; le dossier compte alors **13** enfants au lieu de 12, donc
   l'auto-scan le re-sélectionne ; tour 2 y déplace les entités. Une consigne **anti-synonyme** au
   prompt impose de RÉUTILISER un regroupement existant plutôt que d'en créer un second.

## Garde-fous (§2)

- **Rien ne s'applique sans Marc** : l'auto-scan ne fait que déposer une *demande* ; les actions
  restent au statut `proposé` jusqu'à sa validation dans l'app. Aucune mutation Drive automatique.
- **Aucune suppression** : le regroupement est `creer` + `deplacer` (déplacement seul).
- **Zone protégée** : l'auto-scan réutilise les gardes de l'inventaire (`aParentEtrangerProtege_`,
  remontée d'ascendance, échec fermé) — `04 · Immigration` n'est jamais parcourue.
- **Verrous hérités de C28-31** : `fusionner` interdit sur un dossier d'entité (il le détruirait et
  re-pointerait `Entités.Dossier ID`) ; année et type de pièce d'identité jamais parents d'un
  regroupement ; segments structurels exclus du décompte.
- **Budget §2.6** : `REORG_AUTO_MAX_JOUR` appels LLM/jour au plus (3 ≈ 0,06 $/j), plafonné, borné par
  `REORG_MAX_JOUR` et jamais prioritaire sur le flux vivant (étape budget-gatée, après la consolidation).

## Conséquences

- Le Drive **converge** vers ≤ ~7 sous-dossiers sans que Marc ait à lancer quoi que ce soit. Avec 3
  dépôts/jour, un dossier peut être aéré **dans la journée** (tour 1 création, tour 2 déplacements)
  s'il valide au fil de l'eau ; sinon la campagne attend — le vrai facteur limitant est **sa
  validation**, pas la cadence du moteur (gate « assiette propre » : une seule demande en vol).
- Cadence ajustable par `REORG_AUTO_MAX_JOUR`, dans la limite de `REORG_MAX_JOUR`.
- Un dossier que le LLM juge non regroupable est laissé tranquille 30 jours, pas indéfiniment : si
  la situation change (nouvelles entités), il sera re-proposé.
