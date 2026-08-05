# ADR-0035 — Retrait du reset (deadlock `resetEnCours_` perpétuel) + re-génération consolidation

- **Date** : 2026-08-05
- **Statut** : **accepté** — décision Marc (« ça marche pas, tri 2026 vide, structure encore en vrac » →
  diagnostic → « applique directement »).
- **Chantier** : incident « rangement bloqué ».

## 1. Problème (constaté en prod, signaux indépendants Drive + diagnostic un-clic)

Depuis ~1 semaine, le rangement de fond n'avance plus : `_TRI 2026` a des bacs de domaine **vides**,
les racines de domaine gardent **305 fichiers à plat** que la règle rangerait en sous-dossier
(05·Carrière 116, 08 102, 06 42, 09 32, 07 8, 03 3, 01 2), et des dossiers d'entité en double.

**Cause racine — un DEADLOCK structurel :**

1. **Le reset (ADR-0030) ne converge JAMAIS sur un Drive vivant.** Le rassemblement n'a **aucun drapeau
   « domaine épuisé »** (contrairement à la consolidation, `Consolidation.gs` : `épuisé` + skip O(1)) :
   sa seule condition de fin est `examines===0 && complet` sur une passe qui re-parcourt tout l'arbre
   (`rassemblerReset_`, `Reset.gs`). Or l'intake tourne **avant** le rassemblement à chaque tick
   (`Main.gs`) → chaque fichier fraîchement classé (dans un domaine 01-09, non keyé `tri33|tri33`) est
   collectable au même tick → `examines ≥ 1` **perpétuel** → `DriveAI_RESET_RASSEMBLEMENT` jamais posé.
   Runtime confirmé : `RASSEMBLEMENT` et `PLACEMENT` **absents**, `04='tri33'` → `resetTermine_()`=false,
   `resetEnCours_()`=**true**.
2. **`resetEnCours_()`=true suspend la consolidation** (gate `!resetEnCours_()`, `Main.gs`) — le **seul**
   mécanisme qui scanne les **racines de domaine** et re-range le vrac. Elle est gelée (`DriveAI_CONSO_EXEC_LIGNE=956`).
   → Les 305 fichiers legacy (keyés `tri33|tri33`, donc skippés par le rassemblement ; à plat aux racines,
   donc invisibles au placement qui ne lit que `_TRI`) ne sont re-rangés par **personne**. Deadlock.
3. **Entités « Robovic » cassées** (statut lu comme date / `Dossier ID` vide) : `estValidee_` → false →
   exclusion de `entitesValideesParCle_` → le re-pointage automatique ne tire pas → dossiers d'entité
   recréés en double. (Le ROUTAGE des fichiers reste correct : `cheminCibleReset_` a une règle Robovic
   codée en dur, indépendante du référentiel — traité en suivi.)

## 2. Décision

**Casser le deadlock + re-lancer le rangement de fond, application directe (moveTo seul, réversible,
zéro suppression) — décision Marc.**

1. **`RESET_ACTIF: false`** (Config.gs). Le reset a matériellement fini sa migration one-time (`_TRI`
   vide, 04 convergé) et sa non-convergence est **structurelle** — il ne se clôturera jamais seul.
   `resetEnCours_()` devient false immédiatement → la consolidation (+ historique Gmail / migration /
   réanalyse / réconciliation, suspendues depuis 1 semaine) **reprennent**.
2. **`CONSOLIDATION_TAG: 'conso-2' → 'conso-3'`** (Config.gs). Le plan `conso-2` a été généré
   avant/pendant le deadlock : il a pu recenser les 305 comme **« OK »** (sous une table antérieure à
   `t4`) ou dans des domaines déjà **« épuisés »** ⇒ jamais re-déplacés. Le bump **purge** le plan
   périmé + **remet les 3 curseurs** (`genererPlanConsolidation_` rotation — **test comportemental**
   `test/consolidation.test.js`, dans les deux sens : bump ⇒ purge, tag inchangé ⇒ plan préservé) et
   **re-évalue TOUT sous `t4`** ⇒ les 305 flat-mais-routables deviennent des lignes **« Déplacer »**
   (cible `cheminCibleReset_`), exécutées automatiquement (`CONSOLIDATION_EXEC_ACTIF` déjà true).
3. **Cron pilote `pousser-reset.yml` DÉSACTIVÉ** (revue apps-script-quota) : `pousserResetPilote_`
   refuse quand `RESET_ACTIF=false`, donc les POST `/15 min` ne feraient que ~190 `::warning:: transitoire`
   trompeurs/jour + des POST à vide. `workflow_dispatch` conservé pour un lancement manuel si le reset
   est un jour ré-activé.

**Anti-boucle (garanti par construction)** : les 3 consommateurs (flux, consolidation, reset) calculent
la cible par la **même fonction pure `cheminCibleReset_`** → un fichier déjà à sa cible est jugé « OK »
(no-op) → **pas de ping-pong** avec le flux vivant. §1 zone protégée re-vérifiée stricte à chaque
`moveTo` (`ConsolidationExec.gs`) ; multi-parents exclus ; `moveTo` seul (aucune suppression, §2).

## 3. Ce qui N'est PAS fait ici (suivis)

- **Convergence du rassemblement** : le vrai bug (pas de drapeau « domaine épuisé ») n'est pas corrigé —
  le reset est **retiré**, pas réparé. ⚠️ **Tripwire de valeur** (`test/reset-exec.test.js`) :
  `RESET_ACTIF` doit rester `false`. **NE PAS rallumer** sans d'abord doter le rassemblement d'un
  drapeau « domaine épuisé » (comme la conso), sinon le deadlock revient.
- **Entités Robovic / doublons de dossiers** : réparation du référentiel + fusion des dossiers en double
  (déplacement seul, re-point) — suivi dédié (nécessite de lire l'onglet Entités par en-tête, hors CI).

## 4. Garde-fous & test

- **§2 intact** : aucune suppression ; consolidation = `moveTo` seul, cible recalculée par la règle
  partagée, §1 re-vérifiée par mutation. Surface `.gs` sans suppression inchangée.
- **Tests** : suite verte (802). Les tests des phases reset **forcent** `RESET_ACTIF=true` dans leur
  contexte (leçon §7 : la position d'un flag de campagne est une décision de Marc, jamais un invariant
  de test) ; les fixtures consolidation forcent `CONSOLIDATION_TAG='conso-2'`. Tripwire de valeur ajouté.
- **Revue flotte adversariale AVANT merge** (§8).

## 5. Vérification post-déploiement (signal INDÉPENDANT, leçon §7)

`RESET_ACTIF` / `CONSOLIDATION_TAG` sont des constantes lues à chaque tick → prise d'effet au tick
suivant le déploiement (aucun scope changé ⇒ pas de ré-autorisation). Vérifier par un **signal
indépendant**, pas le statut du déploiement : (a) l'onglet `PlanConsolidation` se **re-remplit** sous
`conso-3` (lignes « Déplacer » pour les 305) ; (b) les fichiers à plat des racines de domaine se
**rangent** en sous-dossiers sur quelques ticks (recency Drive) ; (c) `DriveAI_CONSO_PLAN_TAG` passe à
`conso-3`. Débit consolidation ~12 min/j I/O ⇒ drainage en quelques jours (Marc a accepté « sur quelques ticks »).
