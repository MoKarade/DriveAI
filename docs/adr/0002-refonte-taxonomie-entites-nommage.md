# ADR-0002 — Refonte : taxonomie, entités & nommage

- **Statut** : **Accepté — partiellement implémenté**. Livré (chantier #3) : **nommage par type** (§6),
  **deviner-du-nom** (§5), **dossiers `07 · Santé` + `_Technique`** et **renumérotage Perso 07→08** (§2-§3).
  Reste (roadmap) : **entités systématiques + validation 1-clic + garde anti-variantes** (§4, chantier #4) et
  **migration de l'existant** vers la nouvelle taxonomie (chantier #8).
- **Décideurs** : Marc, Claude
- **Source** : brainstorm produit 2026-07-01, axe « Précision du classement »

## Contexte

La taxonomie actuelle (7 domaines → catégorie → entité → sous-dossier) est jugée **à repenser**.
Marc retrouve ses documents de **4 façons** : navigation dans les dossiers, recherche par mot-clé/nom,
par date, et par émetteur. → Il faut soigner **à la fois** l'arborescence **et** le nommage.

Définition retenue d'un « classement précis » = **les quatre à la fois** : bon domaine + bon
sous-niveau (entité/année) + bon nom + bonne détection de doublon.

## Décision

### 1. Principe d'arborescence
- **Mixte : domaine → entité.** Domaines en 1er niveau, entités (banque, employeur, établissement…)
  juste en dessous.
- **Arborescence fine partout**, mais **découpage par année réservé aux gros volumes** (relevés,
  factures, paie, impôts) — pas ailleurs (l'année vit dans le nom du fichier).

### 2. Arborescence cible

```
01 · Administratif & identité
     ├─ Identité (passeport, CNI, permis de conduire, actes)
     ├─ Assurances (habitation, RC…)
     └─ Correspondance officielle
02 · Finances
     ├─ <Banque : Desjardins / CIC / XTB…>
     │     ├─ Relevés › <année>
     │     ├─ Contrats & produits
     │     └─ Correspondance
     ├─ Impôts › <année>
     └─ Paie & revenus › <année>
03 · Logement & véhicule
     ├─ Logement · <entité>   (Bail, Factures›année, Assurance, État des lieux)
     └─ Véhicule · <entité>   (Achat, Assurance, Entretien, SAAQ)
04 · Immigration   🔒 zone protégée
     ├─ Québec (CSQ, CAQ)  ├─ Canada fédéral (IRCC, permis)  ├─ EIMT / emploi  └─ Correspondance
05 · Carrière & emploi
     ├─ CV & candidatures
     └─ <Employeur>   (Contrat, Paie›année, Attestations, Correspondance)
06 · Études & diplômes
     └─ <Établissement>   (Diplômes & relevés de notes · Cours & TP›<matière> · Projets & mémoires)
07 · Santé                         🆕
     ├─ Assurance santé  ├─ Ordonnances & comptes-rendus  └─ <Praticien>
08 · Perso & projets
     └─ <Projet>
─────────────────────────────
_Technique   🆕  code (.class/.java…), CAO, médias bruts — hors domaines
_Doublons    ·   00 · À trier
```

### 3. Nouveaux dossiers de 1er niveau
- **`07 · Santé`** — assurance santé, ordonnances, comptes-rendus, par praticien.
- **`_Technique`** (hors domaines) — fichiers code, CAO, médias bruts, pour ne pas polluer les domaines.

### 4. Entités
- **Auto-proposées par l'IA, validées en 1 clic** par Marc (réutilise l'onglet `Entités` :
  `en_attente` → `validée`). Un sous-dossier d'entité n'est **matérialisé qu'après validation** ;
  avant, le document est rangé au niveau du domaine (dégradation gracieuse, jamais de blocage).
- **Garde anti-variantes** (à concevoir) : normaliser/fusionner « IUT ULCO » ≈ « IUT du Littoral Côte
  d'Opale » (matching flou + confirmation) pour éviter les dossiers en double.

### 5. Cas « Inconnu »
- Si l'IA ne trouve pas l'émetteur ou la date : **deviner au mieux depuis le NOM d'origine**
  (ex. `MODE2D_TP4_MARC_RICHARD` → type = TP), et **conserver le nom d'origine** comme filet de
  traçabilité (jamais perdre l'info).

### 6. Nommage par TYPE de document
La granularité de date et le 3ᵉ champ s'adaptent au type :

| Type | Schéma | Exemple |
|------|--------|---------|
| Relevé bancaire | `AAAA-MM_Relevé_<Banque>` | `2024-03_Relevé_Desjardins` |
| Facture | `AAAA-MM-JJ_Facture_<Fournisseur>` | `2024-03-05_Facture_Hydro-Québec` |
| Bulletin de paie | `AAAA-MM_Paie_<Employeur>` | `2024-03_Paie_Robovic` |
| Diplôme / relevé de notes | `AAAA_<Type>_<Établissement>` | `2021_Diplôme_IUT-ULCO` |
| Contrat | `AAAA-MM-JJ_Contrat_<Partie>` | `2024-01-10_Contrat_Le-Trieste` |
| Immigration | `AAAA-MM-JJ_<Type>_<Organisme>` | `2024-06-01_CSQ_MIFI` |
| Impôt / avis | `AAAA_<Type>_<Administration>` | `2023_Avis-imposition_Revenu-Québec` |
| Cours / TP (études) | `AAAA_<Matière>_<Type>` | `2019_Électronique_TP4` |
| Santé | `AAAA-MM-JJ_<Type>_<Praticien>` | `2024-02-14_Ordonnance_Dr-Martin` |
| CV | `AAAA_CV_Marc-Richard` | `2024_CV_Marc-Richard` |

## Conséquences

- **Migration** : re-classer l'existant selon la nouvelle taxonomie (déplacement seul, borné,
  reprenable — même mécanique que le grand rangement). Zone protégée `04` préservée.
- `docs/TAXONOMY.md` et `docs/NAMING.md` seront réécrits **au moment de l'implémentation** (pas
  avant, pour ne pas diverger du code réel).
- Nouveau composant nécessaire : **dé-duplication/normalisation d'entités** (variantes).

## À implémenter (→ roadmap)

- [ ] Nouveaux dossiers `07 · Santé` et `_Technique`.
- [ ] Niveau entité systématique + validation 1 clic + garde anti-variantes.
- [ ] Schémas de nommage par type de document.
- [ ] Fallback « deviner depuis le nom d'origine » + conservation du nom d'origine.
- [ ] Re-classement de l'existant vers la nouvelle taxonomie.
