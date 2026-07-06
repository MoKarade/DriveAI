# Convention de nommage — DriveAI

> `naming-validator` valide tout code de renommage et tout exemple de sortie contre ce
> document.

## Format

```
<date>_<Libellé>_<Émetteur>.ext
```

- **`<date>`** — date du document (`date_doc`), **à la granularité du type** (cf. « Nommage par type »
  ci-dessous). Si absente → **date de réception du mail**.
- **`<Libellé>`** — type de document (`type_doc`), parfois normalisé en libellé fixe (`Relevé`, `Paie`, `CV`).
- **`Émetteur`** — émetteur (`emetteur`) : `Hydro-Quebec`, `Desjardins`, `IRCC`…
- **`.ext`** — extension d'origine préservée (`.pdf`, `.jpg`, `.docx`, `.xlsx`…).

## Périmètre

La convention s'applique aux **fichiers nommés par le pipeline** (classement moteur, reclassement
avec renommage dans l'app). Elle ne s'applique **ni aux dossiers** (domaines `NN · Nom`, entités,
sous-dossiers thématiques, années — cf. `TAXONOMY.md`), **ni à un déplacement manuel** dans
l'explorateur de l'app (C21-02) : le nom existant est conservé tel quel, même non conforme.
Le placement manuel est entériné par une ligne Index `drive|fileId` (statut `manuel`) — le grand
rangement ne re-collecte donc pas le fichier, mais son nom reste hors convention jusqu'à un
éventuel reclassement explicite.

## Nommage par type (ADR-0002 §6) — `Router.nomParType_`

La **granularité de date** et le **libellé** s'adaptent au type de document. Un type **inconnu** retombe
sur le format historique (granularité **jour**, libellé = type nettoyé) — jamais un blocage.

| Type (mots-clés `type_doc`) | Granularité | Libellé | Exemple |
|-----------------------------|-------------|---------|---------|
| Relevé bancaire / de compte | **mois** `AAAA-MM` | `Relevé` | `2024-03_Relevé_Desjardins` |
| Bulletin de paie / salaire | **mois** `AAAA-MM` | `Paie` | `2024-03_Paie_Robovic` |
| Diplôme, relevé **de notes** | **année** `AAAA` | (type) | `2021_Diplôme_IUT-ULCO` |
| Impôt / avis d'imposition / cotisation | **année** `AAAA` | (type) | `2023_Avis-imposition_Revenu-Québec` |
| CV / curriculum | **année** `AAAA` | `CV` | `2024_CV_Marc-Richard` |
| Cours / TP / examen / devoir (études) | **année** `AAAA` | (type) | `2019_TP_Électronique` |
| **Défaut** (facture, contrat, immigration, santé, attestation…) | **jour** `AAAA-MM-JJ` | (type) | `2024-03-05_Facture_Hydro-Québec` |

> Ordre de résolution : « relevé **de notes** » (annuel) est testé **avant** « relevé » (mensuel).
> 🔜 Ordre inversé `<Matière>_<Type>` pour les cours/TP : nécessite un champ « matière » du LLM (à venir).

**L'entité n'est PAS répétée dans le nom** : elle est portée par le *chemin* (le dossier
d'entité). Exemple : `03 · Logement & véhicule/Logement/Appartement Rue X (Montréal)/Factures/2026/`
contient `2026-03-15_Facture_Hydro-Quebec.pdf`.

## Règles de normalisation

- Séparateur de champs : underscore `_`. Pas d'underscore *à l'intérieur* d'un champ.
- Espaces internes d'un champ → conservés tels quels (`Rue Saint-Denis`) **sauf** si cela
  casse la lisibilité ; préférer des tirets pour les noms composés d'émetteur (`Hydro-Quebec`).
- Pas de caractères interdits Drive (`/ \ : * ? " < > |`) — les remplacer par `-`.
- Accents : **autorisés** (Drive les gère). Garder l'orthographe réelle de l'émetteur.
- Casse : respecter la casse naturelle (noms propres capitalisés).

## Exemples

| Champs LLM | Nom de fichier |
|------------|----------------|
| date `2026-03-15`, type `Facture`, émetteur `Hydro-Quebec` | `2026-03-15_Facture_Hydro-Quebec.pdf` (défaut : jour) |
| date `null` (mail reçu le 2026-02-01), type `Relevé`, émetteur `Desjardins` | `2026-02_Relevé_Desjardins.pdf` (relevé : **mensuel**) |
| date `null` (mail reçu le 2026-02-01), type `Attestation`, émetteur `Université de Montréal` | `2026-02-01_Attestation_Université de Montréal.pdf` (défaut : jour, date de réception) |

## Plus de file de revue (décision Marc 2026-07-01)

Il n'y a **plus de noms encodés `[REVUE] …`** : un seul dossier d'arrivée (`00 · À trier`), **tout**
document est classé au mieux avec son **nom final propre**. Un domaine introuvable est rangé dans
`CONFIG.DOMAINE_DEFAUT`, jamais en limbo (cf. CLAUDE.md §1, `Router.deciderRoutage_`). Une entité inconnue
n'envoie pas en revue non plus : le document est classé au domaine et l'entité est proposée (`en_attente`)
dans l'onglet `Entités`.
