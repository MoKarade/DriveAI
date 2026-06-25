# Convention de nommage — DriveAI

> `naming-validator` valide tout code de renommage et tout exemple de sortie contre ce
> document.

## Format

```
AAAA-MM-JJ_Type_Émetteur.ext
```

- **`AAAA-MM-JJ`** — date du document (`date_doc`). Si absente → **date de réception du mail**.
- **`Type`** — type de document (`type_doc`) : `Facture`, `Relevé`, `Contrat`, `Attestation`…
- **`Émetteur`** — émetteur (`emetteur`) : `Hydro-Quebec`, `Desjardins`, `IRCC`…
- **`.ext`** — extension d'origine préservée (`.pdf`, `.jpg`, `.docx`, `.xlsx`…).

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
| date `2026-03-15`, type `Facture`, émetteur `Hydro-Quebec` | `2026-03-15_Facture_Hydro-Quebec.pdf` |
| date `null` (mail reçu le 2026-02-01), type `Relevé`, émetteur `Desjardins` | `2026-02-01_Relevé_Desjardins.pdf` |
| type `Attestation`, émetteur `Université de Montréal` | `AAAA-MM-JJ_Attestation_Université de Montréal.pdf` |

## Cas de revue (nom encodant la suggestion — Phases 1–3)

Quand un fichier part en revue (`00 · À vérifier`), la suggestion de classement est **encodée
dans le nom** pour rester lisible sans app web. Format proposé (à figer en Phase 1) :

```
[REVUE] <raison> — <chemin suggéré> — <nom suggéré>.ext
```

Exemple : `[REVUE] confiance 0.62 — 02 · Finances/Relevés — 2026-04-01_Relevé_Banque?.pdf`.
`raison` ∈ {`sensible`, `zone protégée`, `confiance <seuil>`, `domaine inconnu`,
`doublon (déjà présent)`} — c'est l'inventaire réel produit par `Router.motifDeRevue_` et
`Pipeline` (Phase 2). Note : une **entité inconnue n'envoie PAS** le document en revue — il est
classé au domaine et l'entité est proposée (`en_attente`) dans l'onglet `Entités`.
