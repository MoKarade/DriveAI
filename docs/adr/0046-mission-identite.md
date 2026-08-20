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

⚠️ **Deux corrections successives du 2026-08-20. La seconde annule la première — c'est celle-ci
qui fait foi.**

*Première version (fausse) :* « il n'y a pas une règle mais DEUX, et elles divergent — le flux range
par TYPE, la table par PERSONNE ». Écrite après lecture du seul `dossierIdentite_`.

*Vérification par exécution de la règle sur les noms réels :* **le flux ne diverge pas — il délègue
déjà.** `deciderRoutageV2_` (Router.gs, étape 4) appelle `cheminCibleReset_(domaine, nom)` sur le nom
FINAL, avec un tripwire de convergence. La table rend bien :

| Nom du fichier | `cheminCibleReset_` |
|---|---|
| `2019-09-17_Passeport_Préfecture du Nord (Lille).pdf` | `Pièces d'identité/Marc` |
| `2026-05-29_Passeport_Marc Richard.pdf` | `Pièces d'identité/Marc` |
| `2022-09-07_Passeport_Anna Malaval.pdf` | `Pièces d'identité/Autres/Anna Malaval` |
| `2023-11-06_Permis de conduire_Frederique Bolduc.pdf` | **`null`** |

Le vrai défaut est donc **plus étroit, et il est dans le REPLI** (étape 5). Quand la table rend
`null` — un refus VOULU : titulaire ni Marc, ni une autorité, ni une personne déclarée, donc
« jamais deviné » — le flux ne peut pas laisser le document en limbo et retombait sur
`di.sousDossier`, c'est-à-dire **un dossier de TYPE au niveau 1 du domaine**. C'est ainsi qu'est né
`01 · Administratif/Permis de conduire` le **2026-08-12** (deux semaines après `Pièces d'identité`,
créé le 29/07), et il ne contient que le permis d'un tiers.

Correctif livré (**C28-72**) : `repliIdentite_` dégrade **DANS** `Pièces d'identité` au lieu
d'inventer un frère de niveau 1 — le nom du fichier porte déjà le type et le titulaire, et un
fichier posé à la racine du conteneur, à côté de `Marc/` et `Autres/…`, dit exactement ce qu'il
est : une pièce d'identité que personne n'a su attribuer. 04 et 07 n'ayant pas ce conteneur, leur
repli reste le type.

Conséquence pour la mission : elle peut bel et bien réutiliser la règle du flux — parce que celle-ci
EST la table. Il n'y a jamais eu deux règles à réconcilier.

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

⚠️ **Vérifié le 2026-08-20.** La question posée ici était la bonne (« le nœud sera-t-il re-créé ? »),
la fonction citée ne l'était pas : `cheminCibleReset_` ne vise jamais `Permis de conduire` au niveau
1 — elle rend `null` sur ce fichier. C'est le **repli** du flux qui créait le nœud (cf. §2). Avec
`repliIdentite_` (C28-72), il ne le fera plus.

Décision de Marc du 2026-08-20 sur le point (a) : **ne pas toucher au document de tiers**, le
rapporter seulement. `Frederique Bolduc` n'est donc PAS ajoutée aux personnes déclarées, le fichier
reste où il est, et le nœud `01/Permis de conduire` reste non vide — il ne sera simplement plus
alimenté.

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
