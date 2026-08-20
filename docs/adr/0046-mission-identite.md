# ADR-0046 — Mission identité : ce que le Drive montre, et pourquoi la mission ne déplacera pas tout

- **Statut** : proposé (2026-08-20)
- **Contexte** : C28-49 PR3. Marc : « identité = permis + passeport + *tout ce que tu pourras
  trouver d'autre* », avec `04 · Immigration` en **propositions seulement, jamais déplacé** (§2.1b).
- **Complète** : ADR-0039 (missions de curation), ADR-0044 (affinage des non-appariés)

## 1. L'inventaire, lu dans le Drive avant toute règle (protocole §11)

Les documents d'identité ne sont pas « éparpillés » au sens vague : ils sont dans **quatre
structures distinctes**, dont deux que la mission ne doit surtout pas traiter comme les autres.

| Où | Ce qu'on y trouve | Statut |
|---|---|---|
| `01 · Administratif/Pièces d'identité/Marc` | 2× Carte nationale d'identité (Préfecture du Nord), reçu de renouvellement de permis SAAQ | ✅ la cible canonique |
| `01 · Administratif/Permis de conduire` | **UNIQUEMENT** `2023-11-06_Permis de conduire_Frederique Bolduc.pdf` | ⚠️ nœud parasite + document de TIERS |
| `_Doublons` | **3 passeports de Marc** + `2026-01-29_Permis de conduire.pdf` | 🔴 piège, cf. §3 |
| `Documents ID` (hors arborescence DriveAI, créé en 2023) | sous-dossiers `Passeport`, `Carte ID`, `Permis`, `Carte vitale`, **`NAS`**, + `Fiche d'état civil Marc RICHARD.docx` | ⚠️ structure héritée |

Trois faits que l'inventaire seul révèle, et qu'aucune règle n'aurait devinés :

1. **`01/Permis de conduire` est un nœud de niveau 1 parasite** — la taxonomie prévoit
   `Pièces d'identité/<Type>`, pas un type promu au niveau du domaine. Et il ne contient **que** le
   permis d'une TIERCE personne, tandis que celui de Marc dort dans `_Doublons`. L'inversion exacte
   de ce qu'on attendrait.
2. **Un document de TIERS est déjà présent.** `RESET_PERSONNES_AUTRES` existe précisément pour ça
   (`Pièces d'identité/Autres/<personne>`), mais « Frederique Bolduc » n'y figure pas : le document
   a été classé au TYPE sans que son titulaire soit reconnu. La mission ne doit **jamais** ranger
   un document de tiers sous Marc — c'est la règle « jamais deviné » appliquée à une personne.
3. **`NAS`** (numéro d'assurance sociale) n'est pas dans `TYPES_IDENTITE`. C'est l'un des documents
   les plus sensibles du Drive et la taxonomie ne le nomme pas.

## 2. Décision : la mission COLLECTE large, mais ne DÉPLACE que ce qu'elle sait attribuer

Périmètre de collecte : Drive-wide **hors `04 · Immigration`** (§2.1b — la zone protégée ne produit
que des PROPOSITIONS, jamais un déplacement) **et hors `_Doublons`** (§3).

Déplacement autorisé **seulement** si le TITULAIRE est déterminé :
- titulaire = Marc (nom présent, ou émetteur = autorité et aucun autre nom) → `Pièces d'identité/Marc` ;
- titulaire = une personne de `RESET_PERSONNES_AUTRES` → `Pièces d'identité/Autres/<personne>` ;
- **sinon : REFUS keyé** (révisable par bump), rapporté. Un document d'identité rangé sous la
  mauvaise personne est pire que non rangé.

La règle de cible est celle du flux (`dossierIdentite_`) — une seule règle, deux consommateurs,
comme partout ailleurs depuis ADR-0044 §7.

## 3. 🔴 `_Doublons` n'est PAS une source, et c'est la décision structurante

Trois passeports de Marc y sont. La tentation est de les rapatrier — il ne faut pas, tant que la
validation par empreinte (PR4) n'existe pas :

- `_Doublons` contient ce qu'une **détection de doublon** y a mis. Si cette détection s'est trompée,
  le fichier qui y dort est le **seul exemplaire** ;
- déplacer depuis `_Doublons` sans comparer les empreintes, c'est décider qu'un fichier est
  redondant **sans l'avoir vérifié** — exactement ce que §2 interdit pour les suppressions, et la
  même imprudence appliquée à un déplacement définitif ;
- l'ordre correct est donc **PR4 d'abord** (validation `_Doublons` par empreinte), **puis** un
  rapatriement des exemplaires uniques.

En attendant, la mission **rapporte** ces fichiers sans y toucher. C'est un choix délibéré : le
rapport est visible, l'inaction est réversible.

## 4. Le nœud parasite `01/Permis de conduire`

Il est vide de tout document de Marc et ne contient qu'un document de tiers. Deux gestes, dans cet
ordre : (a) le document de tiers part vers `Pièces d'identité/Autres/Frederique Bolduc` **si** Marc
confirme l'identité de cette personne — sinon il RESTE et est rapporté ; (b) le nœud vidé n'est
**pas** supprimé par le moteur (§2) : il apparaîtra en `vide-candidat` dans l'app, et Marc tranche.

⚠️ Le nœud ne doit pas être re-créé par le flux entre-temps : il faut vérifier qu'aucune règle de
`cheminCibleReset_` ne vise `Permis de conduire` au niveau 1 de `01`. À faire AVANT de le vider.

## 5. Ce qui reste à trancher par Marc

1. **`NAS`** — l'ajouter à `TYPES_IDENTITE` ? C'est le document le plus sensible du lot.
2. **`Documents ID`** (structure de 2023, hors arborescence) — la drainer vers `Pièces d'identité`,
   ou la laisser comme archive personnelle ?
3. **« Frederique Bolduc »** — une personne à déclarer dans `RESET_PERSONNES_AUTRES`, ou un
   document à ne pas toucher ?

## 6. Conséquences

- Aucune suppression, aucun déplacement hors de `04` (§2 intact).
- Le refus est la sortie par défaut : un document d'identité mal attribué est un incident, pas une
  imprécision de rangement.
- L'ordre PR4 → PR3-`_Doublons` est **contraignant** : rapatrier avant de valider les empreintes
  reviendrait à faire confiance à une détection de doublon jamais vérifiée.
