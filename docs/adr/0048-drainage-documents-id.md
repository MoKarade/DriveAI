# ADR-0048 — Drainer `Documents ID`, et pourquoi ce ne peut pas être un déplacement

- **Statut** : accepté (2026-08-20)
- **Contexte** : décisions de Marc du 2026-08-20 (4 questions posées, 4 réponses).
- **Complète** : ADR-0046 (mission identité), ADR-0047 (validation `_Doublons`), C28-72 (repli d'identité)

## 1. Les décisions de Marc, telles qu'elles ont été prises

| Question | Réponse |
|---|---|
| `Documents ID` (structure de 2023, hors arborescence) | **Tout drainer vers `Pièces d'identité`** |
| `NAS` dans les types d'identité | Ajouté (pas d'objection soulevée) |
| Permis de conduire d'une TIERCE personne | **Ne pas toucher, juste le rapporter** |
| Orphelins de `_Doublons` | **Tout rapatrier, quel que soit le prix** (chantier distinct, attend le compte) |

## 2. L'inventaire, en entier

15 fichiers, tous à Marc, lus le 2026-08-20 :

| Sous-dossier | Fichiers |
|---|---|
| `Carte ID` | `Carte_id_France.jpg`, `Carte_id_france_arriere.jpg`, `CNI_Marc.pdf` |
| `NAS` | `NAS_JUILLET2025.pdf`, `NAS.pdf` |
| `Passeport` | `Passeport_Marc_RICHARD.pdf`, `passeport2.jpg`, `Passeport.jpg`, `Passeport_Marc.pdf` |
| `Carte vitale` | `Carte vitale` (PDF sans extension) |
| `Permis` | `Permis_France.jpg`, `Permis_France_arriere.jpg`, `Permis_Quebec.pdf`, `permis_provisoire_Quebec.pdf` |
| *(racine)* | `Fiche d'état civil Marc RICHARD.docx` |

**Deux d'entre eux ont exactement la taille de fichiers rangés dans `_Doublons`** :
`Passeport_Marc_RICHARD.pdf` (737 871 o) ↔ `2026-05-29_Passeport-Marc-RICHARD.pdf`, et
`Passeport_Marc.pdf` (335 945 o) ↔ `2023-01-23_Passeport Marc 2019.pdf`. Ce n'est pas une preuve
de contenu identique — c'est le `md5Checksum` de la campagne ADR-0047 qui tranchera — mais c'est
suffisant pour changer la conception, cf. §4.

*(Corrige une affirmation de la session : « aucun autre passeport de Marc ailleurs dans le Drive ».
Elle venait d'une recherche par titre PAGINÉE dont je n'avais lu que la première page.)*

## 3. 🔴 Un simple déplacement serait DÉFAIT au tick suivant

C'est le fait qui commande toute la conception, et il se mesure sans rien déployer :

```
cheminCibleReset_('01 · …', 'Passeport_Marc_RICHARD.pdf')        → null
cheminCibleConsolidation_('01 · …', 'Passeport_Marc_RICHARD.pdf') → ''   ← RACINE du domaine
```

Idem pour les 15. Aucun de ces noms n'est au format canonique `AAAA-MM-JJ_Type_Émetteur.ext`, donc
`analyserNomClasse_` n'en tire ni type ni date, et la règle unique retombe sur « racine du domaine ».

Conséquence si la mission se contentait de `moveTo` vers `Pièces d'identité/Marc` : la
consolidation — **active, auto-exécutante, à collecte récursive** — verrait
`sousCheminActuel = "Pièces d'identité/Marc"` contre `sousCheminCible = ""`, déciderait
« Déplacer », et **viderait les passeports de Marc à plat à la racine de `01`**. Le drainage annulé
par la campagne d'à côté, sans une ligne rouge nulle part.

C'est exactement le défaut que la revue de flotte venait d'attraper sur C28-72 — trouvé cette fois
AVANT d'écrire le code, en posant la question « que feraient mes voisins de ce fichier ? ».

## 4. Décision : drainer PAR LE PIPELINE, pas par un déplacement

Chaque fichier passe par `traiterDocument_` (OCR → LLM → nommage canonique → placement), patron
`Migration.gs`. Il en ressort **renommé** `AAAA-MM-JJ_Type_Émetteur.ext`, donc :

- la table sait le router (`Pièces d'identité/Marc`) ;
- la consolidation calcule **la même** cible — pas de « Déplacer » en boucle ;
- il devient lisible dans l'app et dans les recherches.

**`ignorerDoublon: true` est OBLIGATOIRE** (patron `Migration.gs`) : deux de ces fichiers ont un
contenu déjà présent à l'Index (§2). Sans le bypass, ils seraient « doublon d'eux-mêmes » et
partiraient dans `_Doublons` — précisément le défaut qu'ADR-0047 vient de mesurer sur 1 076 fichiers.
Le résultat correct est : l'exemplaire de `Documents ID` est classé, celui de `_Doublons` reste
écarté et la campagne le confirme.

**Coût** : 15 documents × ~0,026 $ ≈ **0,39 $**, one-shot, sous le frein campagnes (40 $). C'est la
raison pour laquelle on peut se permettre le pipeline plutôt qu'un déplacement : à cette échelle, le
« bon » chemin coûte moins qu'une heure de mise au point du mauvais.

**Ce qui n'est PAS drainé** : rien. Marc a répondu « tout drainer ». Le dossier `Documents ID` vidé
n'est PAS supprimé (§2 du projet) — il apparaîtra en `vide-candidat` dans l'app, et Marc tranche.

## 5. `NAS` — un type, donc DEUX endroits à toucher

Ajouter `NAS` aux `TYPES_IDENTITE` (Router.gs) ne suffit pas : c'est la **table** (`cheminCibleReset_`,
branche 01) qui décide de la cible réelle depuis ADR-0033. Un `2024-01-17_NAS_Service Canada.pdf`
dont le type n'est pas dans la liste de la table irait au repli au lieu de `Pièces d'identité/Marc`.

Les deux se livrent donc **dans le même commit**, avec un test qui les relie — c'est la règle « une
seule règle, deux consommateurs » appliquée à un ajout de vocabulaire, pas seulement à un
refactoring. `normaliserTypeIdentite_` doit aussi reconnaître les graphies : `NAS`,
`numéro d'assurance sociale`, `SIN`.

⚠️ Le NAS est le document le plus sensible du Drive. Il ne change RIEN aux garde-fous : il est
classé comme les autres pièces d'identité, jamais supprimé, jamais détaché, et son contenu ne
transite que vers l'API d'analyse comme tout document (ADR-0007). Le nommer, c'est justement cesser
de le traiter comme un papier administratif quelconque.

## 6. Le document de tiers

`2023-11-06_Permis de conduire_Frederique Bolduc.pdf` **n'est pas touché** (décision de Marc).
`Frederique Bolduc` n'est PAS ajoutée à `RESET_PERSONNES_AUTRES`. Le nœud `01/Permis de conduire`
reste donc non vide, ne sera plus alimenté (C28-72) — et ne sera **jamais résorbé automatiquement**,
puisque `estSegmentStructurel_` le refuse comme source à la Réorg et à la Fusion. Seul Marc peut le
vider.

## 7. Ce qui reste hors de ce chantier

- La **mission identité Drive-wide** (ADR-0046 §2) : collecter les pièces d'identité éparpillées
  ailleurs que dans `Documents ID`. Le socle des missions collecte par DOSSIER SOURCE, pas
  Drive-wide — c'est un mécanisme à part, à traiter séparément.
- Le **rapatriement des orphelins** de `_Doublons` : attend le compte exact de la campagne ADR-0047
  (au dernier relevé : 1 076 inventoriés, 1 054 déjà confirmés, donc **au plus 22 candidats**).
