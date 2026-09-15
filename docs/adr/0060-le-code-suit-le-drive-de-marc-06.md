# ADR-0060 — Le code suit le Drive de Marc : Sherbrooke, la garde de création, Online course

* **Statut** : accepté
* **Date** : 2026-09-15
* **Demande de Marc** (choix cliquables du 15/09) : Sherbrooke → « `CEGEP - Sherbrooke (2020)` — celui
  qui porte tes fichiers » ; Online course → « créer le dossier et y ranger les 4 documents » (il y en a 5 au relevé) ; plan
  `06` → « oui, vas-y ».
* **Backlog** : C28-126 (la divergence table/Drive), C28-127 (la coquille vide).
* **Protocole** : §11 — cet ADR précède la première ligne de code ; fonctions pures testées ; revue
  flotte (`code-reviewer` + `structure-keeper`) avant merge.

---

## Le problème, relevé dans Drive avant d'être décrit

Relevé du 15/09 par `parentId` (jamais `search_files`, dont l'index retarde). La mission
`ecoles-archives06b` s'est déclarée **terminée** (5/5) ; la racine de `06` ne porte plus aucun dossier
d'école ; l'ancienne source `Cégep de Sherbrooke` est une coquille dont les 5 sous-dossiers sont vides.
Mais `Archives scolaires` diverge de `STRUCTURE_CIBLE_RESET['06']` :

| Drive (15/09) | Table (`Reset.gs`) | Contenu | Verdict |
|---|---|---|---|
| `Cégep de Sherbrooke (2019)` | déclaré | **VIDE**, créé par le moteur le 15/09 à 04:38 UTC | créé à vide — la promesse « jamais à vide » était fausse |
| `CEGEP - Sherbrooke (2020)` | **absent du code** (`grep CEGEP` = 0) | **les 9 documents Sherbrooke réels** | c'est le dossier que Marc utilise |
| `Online course — AI Essentials (Google)` | déclaré | **n'existe pas** ; ses 5 documents Google natifs sont à plat à la racine de `06` | aucune règle de nommage ne les y envoie |
| `Lycée — Thérèse Davila (2017-2018)` | source de la fusion ADR-0056 | vide | attendu : une source drainée, pas une divergence *(corrige C28-126 (c) sur ce point)* |

**Pourquoi le dossier a été créé à vide** [Certain, `Missions.gs:1777-1785` + `Reorg.gs:819-829`].
`repointerEcoles06_` tourne à la convergence et find-or-crée la cible sans ID si
`referentielViseUneSource_` est vrai — c'est-à-dire si une ligne de l'onglet `Entités` porte le
dossier SOURCE comme « Dossier ID ». Or `SEED_ENTITES` (`Entites.gs:628`) écrit `Cégep De Sherbrooke`
avec exactement ce dossier : la condition est **vraie par configuration**, pas par mouvement de
fichiers. Le test `missions.test.js:632` prouvait le gate en mockant le prédicat à `false` — « un test
qui MOCKE la fonction sous test ne voit pas son bug » (§9) : la valeur réelle du prédicat en prod est
`true` à vie.

## La décision

1. **Le libellé du code suit le dossier de Marc.** `'Cégep de Sherbrooke (2019)'` →
   `'CEGEP - Sherbrooke (2020)'` (au caractère près : `getFoldersByName` est sensible à la casse ; la
   chaîne survit inchangée à `champ_`, qui ne touche que `/ \ : * ? " < > |` et `_`) dans la table,
   la fenêtre de dates, `ecoleParNomReset_`, et la paire `ecoles06` reçoit l'ID réel
   (`1TReaSk46YXO9LXl9VD-5P8CeG38yC7dj`). **Aucun fichier ne bouge.** La fenêtre de dates reste
   `2019-01 → 2019-12` : elle sert à REFUSER les documents ambigus avec l'ULCO (Marc : « Sherbrooke c'est
   2019 en même temps que ULCO »), pas à placer — le « (2020) » du nom est le nom du dossier, la fenêtre
   borne des documents. La dissonance est documentée, pas corrigée en douce.
2. **La garde de création est remplacée par une propriété structurelle.** À la convergence, une cible
   sans ID n'est **jamais créée** : `repointerEcoles06_` ne fait que TROUVER (`sousDossierExistant_`,
   find-only, ignore les dossiers corbeillés). Si le dossier n'existe pas à ce moment-là, aucun fichier
   n'y est parti (le routeur crée au premier déplacement), donc le référentiel n'a rien à viser.
   `referentielViseUneSource_` disparaît (retrait par frontières de fonction + filet de surface).
3. **`Online course — AI Essentials (Google)` reçoit sa règle de nommage** dans `ecoleParNomReset_`
   (`ai essentials`), vérifiée sur les 5 noms réels. Le dossier sera find-or-créé PAR NOM au premier
   document routé — jamais à vide. ⚠️ Les 5 documents sont Google natifs sans préfixe de date : la
   consolidation les collecte (elle ne saute que leur empreinte, `Consolidation.gs:444`), mais `conso-4`
   est en cours (4/9 domaines) et son tag n'est **pas** bumpé (il repartirait de zéro) — ils partiront
   à `conso-5`, ou plus vite si Marc les glisse lui-même (30 secondes).
4. **La mission `ecoles-archives06` change de tag** (`b` → `c`). Ses sources sont vides : elle converge
   en une passe et `repointerEcoles06_` re-pointe enfin l'entité `Cégep De Sherbrooke` vers le dossier
   de Marc — sans quoi le référentiel continuerait de viser la coquille de la racine (C28-106 : c'est
   exactement le chemin par lequel une école peut renaître à la racine).
5. **`RESET_TABLE_VERSION` t6 → t7** : la table a changé (un libellé). Les refus keyés contre t6 sont
   ré-évalués ; aucun succès n'est défait (le dossier `(2019)` est vide).

## Ce que ça ne fait pas

- Ne corbeille rien : `Cégep de Sherbrooke (2019)` (vide, désormais hors table) et la coquille de la
  racine (C28-127) deviendront des candidats corbeille normaux, à corbeiller par Marc, **après** que la
  mission `c` a convergé (sinon la coquille est encore une source).
- Ne bumpe pas `CONSOLIDATION_TAG` ni `MISSIONS_REGLES_VERSION` (aucune autre mission ne lit `06`).
- Ne touche pas au flux : `cheminCibleReset_` est la règle unique (« une règle, deux consommateurs »).

## Impact quotas et coût

Zéro appel LLM. Une passe de mission sur 7 sources vides (quelques secondes de runtime). Le bump de
table ne ré-évalue que des refus (aucune re-collecte de succès).

## Risques

- Une graphie recopiée avec un caractère différent créerait un **dossier jumeau** au premier document
  (vécu en `03`). Verrou : le test des libellés compare à la chaîne relevée dans Drive par l'API, et
  chaque libellé survit à `champ_`.
- Le rejeu de la mission `c` sur des sources vides doit converger sans écrire de « FINI » avant le
  re-pointage — invariant déjà testé (« un re-pointage qui LÈVE empêche le drapeau FINI »).

## Méthode de test

- Audit sur du réel (§11.2) : les **9 noms réels** de `CEGEP - Sherbrooke (2020)` et les **5 noms réels**
  « AI Essentials — … » traversent `cheminCibleReset_` ; tableau nom → cible dans le test.
- Mutations à jouer, chacune doit faire tomber un test : remettre l'ancien libellé ; remettre le
  find-or-create dans `repointerEcoles06_` ; retirer la règle `ai essentials` ; changer un caractère du
  libellé Sherbrooke.
- Surface : `sousDossierExistant_` ajouté au contrat inter-modules, `referentielViseUneSource_` retiré.
