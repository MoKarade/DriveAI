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
   - **budget** : au plus `REORG_AUTO_MAX_JOUR` (**1**) analyse automatique par jour (≈ 0,02 $/j) ;
   - **« assiette propre »** : aucune demande n'est déposée s'il en existe déjà une au statut
     « analyse demandée » **ou** « proposé ». Le moteur ne propose un nouveau dossier que quand Marc
     a traité le précédent. C'est aussi ce qui rend la campagne naturellement **séquentielle**.

3. **Skip-list (convergence).** Si le LLM répond « aucune action » sur un dossier saturé (il ne
   trouve aucun regroupement sensé), le dossier est inscrit dans `DriveAI_REORG_SKIP` avec une
   **expiration à 30 jours** et ignoré par l'auto-scan d'ici là. Sans ça, la campagne re-proposerait
   le même dossier tous les jours — le piège « compteur qui ne converge pas » de §7.

4. **Mécanique en 2 tours, assumée.** Un dossier créé n'a pas encore de numéro dans l'inventaire :
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
- **Budget §2.6** : 1 appel LLM/jour, plafonné et jamais prioritaire sur le flux vivant.

## Conséquences

- Le Drive **converge** vers ≤ ~7 sous-dossiers sans que Marc ait à lancer quoi que ce soit — au
  rythme d'**un dossier tous les deux jours** (2 tours), et seulement s'il valide.
- Cadence ajustable en montant `REORG_AUTO_MAX_JOUR` une fois la mécanique éprouvée.
- Un dossier que le LLM juge non regroupable est laissé tranquille 30 jours, pas indéfiniment : si
  la situation change (nouvelles entités), il sera re-proposé.
