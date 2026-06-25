# Taxonomie cible — DriveAI

> Source de vérité de l'arborescence Drive. `structure-keeper` veille à ce que le code de
> routage reste cohérent avec ce document. Les IDs alimenteront `Config.gs` (Phase 1).

## Racine

**« Nouvelle structure 2026 »** — `1k5m1xbW90SCX2_IwPy3Xwquh30us6l02`

## Domaines (format `NN · Nom`, conservés tels quels)

| Dossier | ID |
|---------|-----|
| `00 · À trier` (file d'entrée — dépôt manuel) | `1zFTPL9iADzjJ83F4keX2zaZ9myXBPB-k` |
| `00 · À vérifier (non classés)` (file de revue) | `1oay2F7j1BzYeQGuPbIXKNrA1XBCNibUP` |
| `01 · Administratif & identité` | `1Bozg3oLNUVXehm1cQl4gTKs6_XpwolWx` |
| `02 · Finances` | `1B9jNRpAKrAWdUs6Gn5_ojle3ZH7JbFDW` |
| `03 · Logement & véhicule` | `1oI1inPX3nWr_1I74A3jDM-ovr6talQlN` |
| → `Logement` | `13ISBh6ZrwK9YHgmIM20tWTgWh4x9wI79` |
| → `Véhicule` | `1Hqmg1eV4q28saCreUyrfUIfKLwV972Wc` |
| `04 · Immigration` *(zone protégée)* | `1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC` |
| `05 · Carrière` | `1BAg7k7RVrJ4ifoeh9U0XW5hKWXjRI1CC` |
| `06 · Études & diplômes` | `1PeeKG8XgZB6gJdZo03cO7F0s_iMgw6Ec` |
| `07 · Perso & projets` | `19uwSc1A47d_q32Dd2YJ4Wi9StllvyLey` |

> ⚠️ Ces IDs sont des données de configuration, pas des secrets, mais ils ne doivent vivre que
> dans `Config.gs` (Phase 1) et ici. Ne pas les disperser dans le code.

## Granularité : un dossier par entité

**Constat du scan :** l'intérieur est plat (un seul `Logement`, un seul `Véhicule`). Le
système doit le rendre **granulaire** : un dossier par entité, avec un jeu de sous-dossiers
fixes selon le type d'entité.

### Schémas de sous-dossiers fixes par type d'entité

```
Logement — <Nom> (Ville)/        Véhicule — <Modèle> (immat.)/
├─ Bail & contrat/               ├─ Achat & financement/
├─ Factures/  → AAAA/            ├─ Assurance/
├─ Assurance/                    ├─ Entretien & réparations/
├─ État des lieux & photos/      └─ Immatriculation (SAAQ)/
└─ Correspondance/

Compte financier — <Banque>/     Diplôme — <Intitulé>/
├─ Relevés/  → AAAA/             ├─ Diplôme & attestation/
├─ Contrats & produits/          ├─ Relevés de notes/
└─ Correspondance/               └─ Mémoire & travaux/
```

Domaines à fort volume : **sous-dossier par année** (`AAAA`) créé automatiquement. Deux
mécanismes distincts dans le code :
- **par sous-dossier d'entité** (`CONFIG.SOUS_DOSSIERS_PAR_ANNEE` = `Factures`, `Relevés`) —
  ex. `…/Logement — X/Factures/2026/` ;
- **par domaine transverse** (`CONFIG.DOMAINES_PAR_ANNEE` = `02 · Finances`) — ex. `Impôts/2025/`.
  Le fiscal étant `sensible`, il part en revue avant d'être rangé ; le découpage Impôts/AAAA
  relève donc du domaine `02 · Finances`, **pas** d'un schéma d'entité.

## Règles structurelles

- **Nouvelle entité** : passe par la file de revue (`00 · À vérifier`) avant création, pour
  éviter la prolifération de doublons. Création des dossiers seulement après validation.
- **Multi-entités** : un document concernant plusieurs entités → **raccourci Drive** dans
  chaque dossier concerné (jamais de copie physique).
- **Document transverse** (`entite = null`) → dossier générique du domaine.
- **Doublon** : signalé dans la revue, **jamais effacé** automatiquement.

## Zone protégée 🔒

`04 · Immigration` + **tout** document classé `sensible=true` (incl. fiscal dans
`02 · Finances/Impôts`). Ces documents ne sont **JAMAIS** rangés automatiquement → toujours
dirigés vers `00 · À vérifier`. En cas de doute, le LLM met `sensible=true` par défaut.

## Legacy

Le vieux Drive est **figé en archive** à côté de la nouvelle racine. Aucun reclassement
automatique de l'ancien. (Sort précis du dossier `_Archive 2025` : voir `PLAN.md` §7.)
