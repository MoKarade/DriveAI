# ADR-0039 — Missions de curation (C28-49) : le rangement fin, dossier par dossier, piloté par Marc

**Date** : 2026-08-17 · **Statut** : accepté (demande explicite de Marc, brief du 17/08) · **Protocole §8** : ADR avant toute ligne de code.

## 1. Problème

Le gros du Drive est classé (consolidation terminée le 16/08 : 2620 lignes), mais la passe FINE
reste à faire et Marc l'a spécifiée dossier par dossier : dossiers en double à dissoudre
(`Véhicules`→`Véhicule`, `Logements`→`Logement`), dossiers transverses à dispatcher par
logement/véhicule (`Contrats`, `Correspondance`, `Assurance habitation`, `Énergie & services`),
dossiers d'entités de 06 à transférer vers ses `Archives scolaires`, Employeurs/paies/impôts/années
en 02-05, identité en 01, `_Technique`/`_Médias`/`_Doublons`. Il veut **une mission par tâche,
visible dans l'app avec l'avancement réel** (traités/base, dernière passe, fin estimée), et les
dossiers vidés **marqués en ROUGE** pour choisir lui-même ce qu'il supprime.

## 2. Décision

Un module `src/Missions.gs` : un **socle générique** (runner borné, idempotent, convergent) + une
**table déclarative de missions**. PR1 livre le socle + les 4 missions du domaine 03 et 06 :

| Clé | Mission | Sources (vidées) | Cible |
|---|---|---|---|
| `mission-vehicule` | Dissoudre `Véhicules` + `Toyota bZ` isolé | `1D8bY…`, `10d8I…` | `Véhicule` (`1Hqmg…`), sous-dossier par véhicule (Toyota bZ créé) |
| `mission-logement` | Dissoudre `Logements` | `1hszX…` | `Logement` (`13ISB…`), sous-dossier par adresse |
| `mission-dispatch-03` | Dispatcher les 4 transverses | `Contrats`, `Correspondance`, `Assurance habitation`, `Énergie & services` | le bon logement OU véhicule, sous-dossier du THÈME source |
| `mission-archives-06` | Transférer les dossiers d'entités vers Archives scolaires | 4 dossiers d'entités | table d'alias explicite (ci-dessous) |

**Alias 06 (explicites, jamais devinés)** : `DUT ULCO Saint-Omer`→`ULCO — DUT GIM (2018-2020)` ;
`Prépa Gustave Eiffel (PTSI)`→`Prépa PTSI (2017-2018)` ; `IMERIR`→`IMERIR — Ingénieur MSIR
(2020-2023)` ; `lycée Thérèse d'Avila`→`Lycée — Thérèse Davila (2017-2018)`. `Cégep de Sherbrooke`
n'a PAS d'archive → non touché, rapporté. Après transfert, l'entité du référentiel est
**re-pointée** vers le dossier d'archive (`repointerEntites_`) — sinon le flux vivant re-remplirait
le dossier vidé (leçon §7 : « un référentiel consulté par la campagne doit l'être AUSSI par le flux »).

### Règles de routage (PURES, testées)

- **Appariement par jetons** : nom de fichier normalisé (minuscules, sans accents) contre les
  jetons DISCRIMINANTS des dossiers cibles (nombres toujours ; mots ≥ 4 lettres hors mots-outils
  d'adresse). `VW Jetta` reçoit l'alias `volkswagen`. **Deux cibles qui matchent = ambigu = laissé
  + rapporté** — on ne devine jamais.
- **Fenêtres de dates** (demande Marc : « si tu sais pas quel logement regarde les dates ») :
  pour la `Correspondance` non appariée par jetons, les périodes d'occupation sont DÉRIVÉES des
  fichiers déjà classés dans chaque dossier de logement (min/max des dates de noms, ± 30 j).
  Routé seulement si la date tombe dans EXACTEMENT une fenêtre.
- **Non-apparié ≠ revue** (« granularité = enrichissement, jamais frein ») : le fichier RESTE en
  place, compté et rapporté dans la mission (`à jour (N non appariés)`).

### Socle — invariants hérités des voisins (conso/reset, leçon « quels gardes mes voisins ont-ils ? »)

1. **Déplacement seul** (`moveTo`), JAMAIS de suppression (§2). Multi-parents → jamais déplacé
   (`nbParentsBorne_`). Zone protégée re-vérifiée STRICTEMENT avant CHAQUE mutation
   (`aParentProtege_(f, proteges, true)`) en plus du filtre de collecte.
2. **Idempotence versionnée** : clé `mission|<tag>|<MISSIONS_REGLES_VERSION>|<fileId>` posée APRÈS
   le déplacement (ordre des écritures d'état). Les REFUS (non appariés) sont aussi inscrits sous
   la clé — sinon re-collecte à vie — mais la VERSION dans la clé rend l'affinage des règles
   effectif (leçon C28-33 : un verdict négatif se fige par version, jamais à vie).
3. **Convergence** : mission terminée quand une passe COMPLÈTE ne collecte plus rien de traitable
   (drapeau `DriveAI_MISSION_FINI_<tag>` = version). Re-lancer sous de nouvelles règles = bump de
   version.
4. **Budgets** : missions = PURE I/O (zéro LLM — tout se décide par le nom `AAAA-MM-JJ_Type_Émetteur`
   et la structure) ⇒ « BUDGET TAIL » (`estBudgetDepasseStandard`, mur 4,5 min), placées APRÈS le
   flux vivant et la consolidation. Budget QUOTIDIEN partagé `MISSIONS_BUDGET_JOUR_MS` (ms réelles
   persistées), l'ordre des missions dans le tick = la priorité. Garde-temps évalué À CHAQUE item,
   collecte comprise.
5. **Gates** : `!resetEnCours_()` (une seule main déplace) + enveloppées (un échec ne bloque
   JAMAIS l'intake).

### Marquage ROUGE (demande Marc n°1)

Quand une mission converge, chaque dossier SOURCE (et ses sous-dossiers directs) **strictement
vide** est peint en rouge (`folderColorRgb #f83a22`, PATCH Drive REST) — signal visuel « bon pour
suppression », **réversible, sans aucune suppression** : c'est Marc qui corbeille à la main (ou
via la corbeille de l'app, ADR-0014). Best-effort : un échec de peinture ne remet rien en cause.
Exécuté UNE fois, à la transition « terminé » (zéro coût en régime).

## 3. Budget quotas — réallocation, jamais augmentation

La consolidation est TERMINÉE (16/08). Réallocation en PAIRE :
`CONSOLIDATION_BUDGET_JOUR_MS` 12 → **2** min/j (la gen est finie ; 2 min suffisent à un
redémarrage lent si un nouveau plan naissait) et `MISSIONS_BUDGET_JOUR_MS` = **10** min/j.
Enveloppe reset-OFF INCHANGÉE (60 ≤ 65 min/j). Verrous : la somme du COUPLE (missions + conso-gen
= 12) + l'agrégat + « mission active jamais à budget 0 », prouvés par mutation (patron C28-42).
**Débit — DÉRIVÉ DU MODÈLE DE COÛT (revue quotas, qui a corrigé une première estimation ~10×
optimiste)** : un item déplacé ≈ 4-8 RPC Drive après mémoïsation (protection par DOSSIER à la
collecte, `sousDossier_`/`getFolderById` mémoïsés à portée run) + 1 append Index, soit ~1-2 s/item
⇒ **~300-600 items/jour** sur 10 min/j. Les missions PR1 (quelques centaines de fichiers)
convergent en **2-4 jours** ; s'il faut plus vite, l'arbitrage est une réallocation, jamais une
hausse d'enveloppe. Filet anti-brûlage : après `MISSIONS_ERREURS_MAX` runs consécutifs en erreur
de collecte (ID supprimé/mal épinglé), une seule tentative par jour — toute passe saine ré-arme.

## 4. Suivi (demande Marc n°2 — « comme on a fait »)

Chaque mission = une entrée `REGISTRE_OPERATIONS` (type `campagne`) ⇒ ligne Progression complète :
Traités/Base (compteurs compacts dans `DriveAI_MISSIONS_ETAT`, ~40 o/mission, borne 9 Ko sans
risque), statut (`en cours` / `en pause (budget du jour épuisé)` + « reprise demain » /
`à jour (N non appariés)` / `terminé`), Dernière passe et Fin estimée via les débits C28-47.
Base re-basable, numérateur monotone, « terminé » sur le vrai signal de fin (passe vide) — jamais
`traites >= base`. L'app affiche tout ça sans une ligne de code (contrat A2:M générique).

## 5. Risques & garde-fous

- **04 · Immigration** : exclu par construction (aucune source sous 04 ; garde `aParentProtege_`
  au filtre ET à la mutation). Les missions ultérieures qui SCANNENT (identité, PR3) listeront les
  candidats sous 04 en PROPOSITIONS, jamais un déplacement.
- **Ping-pong flux ↔ mission** : cibles épinglées par ID (jamais par nom), référentiel d'entités
  re-pointé dans la même passe, et les cibles des missions sont des dossiers que le flux vivant ne
  vide pas.
- **Frein budget LLM (dépassé ce mois : 10,43 $)** : sans objet — zéro appel LLM dans ces missions.

## 6. Méthode de test

Fonctions PURES isolées (jetons, appariement, fenêtres de dates, alias, prédicat de vide, budget) ;
runner éprouvé sur mocks (idempotence, refus versionnés, garde par item, convergence, rouge
uniquement sur vide, jamais de mutation d'un protégé/multi-parents) ; invariants d'enveloppe et de
couple mis à jour + prouvés par MUTATION ; revue flotte adversariale AVANT merge.
