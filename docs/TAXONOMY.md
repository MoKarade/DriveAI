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
| `07 · Santé` 🆕 | auto-créé à côté des domaines (`Router.dossierDomaineAuto_`), ID en Script Property `DriveAI_DOM_07 · Santé` |
| `08 · Perso & projets` *(ex-07, renuméroté ADR-0002)* | `19uwSc1A47d_q32Dd2YJ4Wi9StllvyLey` |
| `09 · Voyages` 🆕 *(refonte 2026-07-07)* | auto-créé (`Router.dossierDomaineAuto_`), ID en Script Property `DriveAI_DOM_09 · Voyages` |

> **Renumérotage 07→08** : « Perso & projets » passe de 07 à 08 (07 devient « Santé »). Le dossier physique
> (ID inchangé) est renommé automatiquement par `Main.assurerNomsDomaines_` (gated `CONFIG.NOMS_DOMAINES_TAG`,
> renommage seul, réversible). `07 · Santé` est créé au premier document de santé (find-or-create, zéro clic).
>
> **`09 · Voyages` (refonte)** : vols, trains, hôtels, réservations, locations de voyage — le domaine qui
> manquait (les billets partaient dans Administratif/Perso). Auto-créé au premier document de voyage.
>
> **Pièces d'identité (refonte)** : rangées PAR TYPE (`01 · Administratif & identité/Passeport`, `…/Permis
> de conduire`…) mêlant Marc ET les autres personnes ; le nom de la personne (titulaire) va dans le fichier
> (`AAAA-MM-JJ_Type_Titulaire.ext`). Pas de dossier « Tiers ». Carte de résident permanent → `04 · Immigration` ;
> carte d'assurance maladie → `07 · Santé`.

**Hors domaines** (préfixe `_`, à la racine, triés en tête ; ni domaine ni racine de rangement) :

| Dossier | Rôle |
|---------|------|
| `_Archive 2025` | ancien Drive figé — DriveAI n'y touche jamais (sauf via `RANGEMENT_RACINES_SUP` si configuré) |
| `_Doublons` | doublons NON sensibles écartés (déplacement seul, jamais supprimé) — auto-créé, ID en Script Property `DriveAI_DOUBLONS_ID` |
| `_Technique` 🆕 | fichiers **code/CAO** (par extension `CONFIG.EXT_TECHNIQUES`) écartés du classement documentaire (ni OCR ni LLM) — auto-créé, ID en `DriveAI_TECHNIQUE_ID` |
| `_Médias` 🆕 | **médias personnels** (vidéo/audio/gif direct ; photo si nom non-documentaire ET OCR vide — l'OCR reste le juge, ADR-0009 §2) écartés sans LLM, nom d'origine conservé — auto-créé, ID en `DriveAI_MEDIAS_ID` |

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
  Le fiscal est désormais **auto-classé** dans `02 · Finances` (plus de file de revue, décision Marc
  2026-07-01) ; le découpage Impôts/AAAA relève du domaine, **pas** d'un schéma d'entité.

## Règles structurelles

- **Nouvelle entité** (plus de file de revue, décision Marc 2026-07-01) : le document est **classé au
  niveau du domaine** et l'entité est **proposée** (`en_attente`) dans l'onglet `Entités` — jamais un
  blocage. Le dossier d'entité n'est matérialisé qu'**après validation** de Marc (anti-prolifération).
  **Garde anti-variantes** (ADR-0002 §4) : à la proposition, la colonne `Variante possible ?` signale la
  plus proche entité existante du même domaine (« Caisse Desjardins » ≈ « Desjardins ») — Marc fusionne
  en 1 clic au lieu de créer un quasi-doublon. Suggestion seulement, jamais de fusion automatique.
- **Entité validée par correction** (formulaire, ADR-0003, C6-04) : une correction qui nomme une entité +
  son domaine la promeut directement « validée » (validation EXPLICITE de Marc — pas d'auto-prolifération).
  Invariant : la matérialisation du dossier (`dossierParentEntite_`) doit supporter les **domaines AUTO**
  (`07 · Santé`) autant que les 7 fixes — une entité peut être validée sous un domaine auto-créé. Le
  formulaire ne capte pas la **catégorie** : une entité de `03 · Logement & véhicule` validée par formulaire
  est créée à la **racine du domaine** (pas sous `Logement/`/`Véhicule/`) et sans schéma de sous-dossiers —
  dégradation propre (dossier créé, docs classables), le sous-classement s'affine ensuite au besoin.
- **Statuts de ligne du référentiel `Entités`** (#10, ADR-0009) : `en_attente`, `validée`,
  `refusée (générique)`, `variante de : X` — **seuls les deux premiers sont actifs** (file de
  validation de l'app / routage). La colonne **« Vu N fois »** est un signal de priorisation
  (la file de l'app trie dessus), jamais un critère de routage. **Règle de fusion** (proposition
  ET curation) : INCLUSION de jetons seulement (« Desjardins » ⊆ « carte de crédit Desjardins »),
  jamais la distance d'édition, et une **année excédentaire bloque** la fusion (« Honda Civic »
  n'avale ni « Honda Civic 2014 » ni « 2017 » — deux véhicules réels). Jamais d'alias de routage :
  un document dont l'entité est une variante non fusionnée reste classé au domaine tant que Marc
  n'a pas fusionné explicitement.
- **Multi-entités** : un document concernant plusieurs entités → **raccourci Drive** dans
  chaque dossier concerné (jamais de copie physique).
- **Document transverse** (`entite = null`) → dossier générique du domaine.
- **Doublon** (non sensible) : **déplacé** dans `_Doublons` (jamais effacé, jamais en revue — au volume
  du grand rangement, signaler chaque doublon en revue la saturerait). S'applique **aussi** aux doublons
  sensibles (1 exemplaire classé, les autres dans `_Doublons`) — cf. Zone protégée ci-dessous.
- **Réorg IA (#21, Reorg.gs)** : sont **immuables** pour la réorg — les domaines `NN · …` (deplacer/
  renommer/fusionner interdits ; le renommage de domaine appartient au self-healing `NOMS_DOMAINES_TAG`),
  les files `00 ·` (À trier, À vérifier) et les racines `_…`, les **dossiers de catégorie à ID FIXE**
  (`CONFIG.CATEGORIES` : `Logement`/`Véhicule` — routés par ID en dur, aucune re-création par nom),
  les sous-dossiers d'année `AAAA` et les
  **noms** des sous-dossiers de schéma (l'aiguillage du router matche par nom — les fusionner/renommer
  rendrait le plan non convergent : le router les re-créerait). `creer` sert aux dossiers STRUCTURELS,
  jamais à inventer une entité (le référentiel `Entités` route par `Dossier ID`). **Fusionner un dossier
  d'entité impose de re-pointer `Entités.Dossier ID`** (contrat C21-06). Zone protégée exclue de
  l'inventaire par remontée d'ancêtres (multi-parents, échec fermé) dès la collecte.
  **Dossier vidé par fusion** : inscrit `vide-candidat` ; sa mise à la **corbeille Drive** (récupérable
  30 j) n'arrive QUE par l'app, au clic de Marc, après re-vérification live (vacuité stricte corbeillés
  inclus, ascendance, racines système ET dossiers à ID fixe refusés) — jamais par le moteur (ADR-0014).

## Documents sensibles 🔒 *(politique révisée 2026-07-01)*

Sur décision de Marc, les documents sensibles (**immigration, fiscal, passeport**) sont désormais
**auto-classés dans leur domaine** (`04 · Immigration`, `01 · Administratif`, `02 · Finances`…),
comme le reste — ils ne sont plus systématiquement dirigés vers `00 · À vérifier`. Ce qui reste
**non négociable** sur ces documents : aucune suppression ; un doublon (même sensible) va dans
`_Doublons` (jamais effacé) ; le grand rangement ne détache jamais un fichier déjà rangé sous
`04 · Immigration`. Seul un **domaine introuvable** part encore en revue.

## Legacy

Le vieux Drive est **figé en archive** à côté de la nouvelle racine. Aucun reclassement
automatique de l'ancien. (Sort précis du dossier `_Archive 2025` : voir `PLAN.md` §7.)
