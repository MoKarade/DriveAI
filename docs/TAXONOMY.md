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
| → `Logement` *(héritage v1, en drainage — ADR-0023/0024)* | `13ISBh6ZrwK9YHgmIM20tWTgWh4x9wI79` |
| → `Véhicule` *(héritage v1, en drainage — ADR-0023/0024)* | `1Hqmg1eV4q28saCreUyrfUIfKLwV972Wc` |
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
| `_Technique` 🆕 | fichiers **code/CAO** (par extension `CONFIG.EXT_TECHNIQUES`) et **exports de données bruts** (Facebook/Instagram…, gros HTML/JSON sans émetteur) écartés du classement documentaire (ni OCR ni LLM) — auto-créé, ID en `DriveAI_TECHNIQUE_ID`. **Exception (ADR-0025)** : un export de **correspondance** (`Message_`, `Correspondance_`, `Courriel_`, `Courrier_`, `Conversation_` en `.html`) est classé **par CONTENU au domaine** concerné (pas de dossier « Correspondance » dédié) ; un vrai export social (`messages` pluriel, `message_1.html` numéroté Facebook…) reste ici. `Relevé_` reste hors périmètre (ambigu financier). |
| `_Médias` 🆕 | **médias personnels** (vidéo/audio/gif direct ; photo si nom non-documentaire ET OCR vide — l'OCR reste le juge, ADR-0009 §2) écartés sans LLM, nom d'origine conservé — auto-créé, ID en `DriveAI_MEDIAS_ID` |

> ⚠️ Ces IDs sont des données de configuration, pas des secrets, mais ils ne doivent vivre que
> dans `Config.gs` (Phase 1) et ici. Ne pas les disperser dans le code.

## Granularité : classement à PLAT par défaut (ADR-0023 — RÉVISION 2026-07-16)

> **Révise l'ancienne règle « un dossier par entité + schémas de sous-dossiers »** (retour Marc
> 2026-07-16 : ~499 dossiers dont ~102 vides pour ~2 880 fichiers — recensement
> `docs/diagnostics/2026-07-16-recensement-drive.md`). Le nom `AAAA-MM-JJ_Type_Tiers.ext` porte
> déjà toute l'information : le dossier n'ajoutait que du bruit.

**Principe** : un document se classe **à la racine de son domaine**
(`02 · Finances/2026-03-01_Facture_EDF.pdf`). La **RÈGLE UNIQUE** de sous-chemin
(`sousCheminDomaine_`, Router.gs — partagée par le flux vivant ET la cible de consolidation,
verrouillée par un tripwire test) n'accorde un sous-dossier que dans TROIS cas EXCLUSIFS, dans
cet ordre (arbitrage Marc 2026-07-16 « entité OU année ») :

1. **Type d'identité** (`Passeport`, `Permis de conduire`…) — dans le domaine du type seulement
   (01/04/07, cf. `dossierIdentite_`) ; le titulaire vit dans le NOM, jamais un dossier par personne.
2. **Entité MAJEURE VALIDÉE** au référentiel `Entités` (logement, véhicule, employeur, école —
   **JAMAIS une banque** : `02 · Finances` n'a plus d'entités validées, décision Marc 2026-07-17,
   ADR-0024) — dossier au **niveau 1** du domaine, **nom canonique du référentiel**, **sans
   année** : une entité = UN dossier (`05 · Carrière/Robovic`, jamais `2026/Robovic`). Le routage
   v2 ne consulte QUE les validées (`entitesValideesParCle_`) : une entité que Marc n'a pas validée
   ne crée JAMAIS de dossier (le prompt gate le champ `sousDossier`, le référentiel verrouille).
   Les entités de Marc sont posées par un SEED one-shot (`seedEntitesMarc_`, ADR-0024 : 4 logements,
   3 véhicules, 2 employeurs, 6 écoles) ; l'auto-validation « vue ≥ 3 fois » est COUPÉE
   (`ENTITES_AUTO_VALIDATION: false`) — seuls le seed, le formulaire de correction et l'app valident.
3. **Année** (`AAAA`) pour les domaines à volume (`CONFIG.DOMAINES_PAR_ANNEE` = `02 · Finances`),
   quand aucune entité validée ne s'applique : le tout-venant Finances va dans `02/2026`.

Sinon : **racine du domaine**. **Interdits** (les mécanismes du bordel, recensement 2026-07-16) :
dossier par émetteur ponctuel, dossier-catégorie (« Cours », « Devoirs », « Reçus »), « Divers »,
squelettes de sous-dossiers d'entité (`SCHEMAS_ENTITE` — plus jamais créés),
`SOUS_DOSSIERS_PAR_ANNEE` (mort avec le chemin v1).

## Campagne de consolidation (C28-26 — génération `src/Consolidation.gs`, exécution `src/ConsolidationExec.gs`)

Le stock existant est ramené à cette taxonomie par une campagne en DEUX étages, tous deux ALLUMÉS
(décision Marc 2026-07-17 « change tout live », ADR-0024 — qui RÉVISE la validation ligne-à-ligne
d'ADR-0023 en validation globale + droit de suspension) :
1. **Génération** (`CONSOLIDATION_ACTIF`) : plan écrit dans l'onglet **`PlanConsolidation`**
   (Fichier | ID | Action | Cible | Raison | Empreinte), actions **OK / Déplacer / Doublon
   (→ `_Doublons`) / Ignoré** — intra-domaine seulement (jamais de re-domaine, zéro LLM), `04`
   parcouru en CONSTAT seul (garde §1 stricte), doublons par empreinte MD5 propre à la campagne,
   contre-pression (s'arrête si l'exécuteur a > `CONSOLIDATION_BACKLOG_MAX` lignes de retard).
2. **Exécution AUTOMATIQUE progressive** (`CONSOLIDATION_EXEC_ACTIF` — `false` = suspension
   immédiate) : applique Déplacer/Doublon — **`moveTo` seule mutation** (verrou de surface), **§1
   re-vérifiée STRICTEMENT à chaque mutation**, multi-parents/ID de dossier jamais déplacés,
   **cible RECALCULÉE au move** (règle unique + référentiel courant — la colonne Cible n'est
   qu'une trace), budgets 2 min/run + quotidien en ms réelles, échec compté ≤ 1×/jour (abandon
   tracé après `QUARANTAINE_MAX` jours distincts).
Les dossiers VIDÉS relèvent de la corbeille APP validée (ADR-0014), jamais du moteur.

## Règles structurelles

- **Nouvelle entité** (plus de file de revue, décision Marc 2026-07-01) : le document est **classé au
  niveau du domaine** (règle unique ci-dessus : année ou racine) et l'entité est **proposée**
  (`en_attente`) dans l'onglet `Entités` — jamais un blocage. Le dossier d'entité n'est matérialisé
  qu'**après validation** de Marc (anti-prolifération), **à la racine du domaine, SANS schéma de
  sous-dossiers** (ADR-0023 — l'ancien parent « catégorie » + squelette créait un double dossier et
  ~100 dossiers vides).
  **Garde anti-variantes** (ADR-0002 §4) : à la proposition, la colonne `Variante possible ?` signale la
  plus proche entité existante du même domaine (« Caisse Desjardins » ≈ « Desjardins ») — Marc fusionne
  en 1 clic au lieu de créer un quasi-doublon. Suggestion seulement, jamais de fusion automatique.
- **Entité validée par correction** (formulaire, ADR-0003, C6-04) : une correction qui nomme une entité +
  son domaine la promeut directement « validée » (validation EXPLICITE de Marc — pas d'auto-prolifération).
  Invariant : la matérialisation du dossier (`dossierParentEntite_`) doit supporter les **domaines AUTO**
  (`07 · Santé`) autant que les 7 fixes — une entité peut être validée sous un domaine auto-créé.
- **Statuts de ligne du référentiel `Entités`** (#10, ADR-0009) : `en_attente`, `validée`,
  `refusée (générique)`, `variante de : X` — **seuls les deux premiers sont actifs** (file de
  validation de l'app / routage). La colonne **« Vu N fois »** est un signal de priorisation
  (la file de l'app trie dessus), jamais un critère de routage. **Règle de fusion** (proposition
  ET curation) : INCLUSION de jetons seulement (« Desjardins » ⊆ « carte de crédit Desjardins »),
  jamais la distance d'édition, et une **année excédentaire bloque** la fusion (« Honda Civic »
  n'avale ni « Honda Civic 2014 » ni « 2017 » — deux véhicules réels). Jamais d'alias de routage :
  un document dont l'entité est une variante non fusionnée reste classé au domaine tant que Marc
  n'a pas fusionné explicitement.
- **Multi-entités** : mécanisme **abandonné avec le routage v2** (constat revue C28-26 :
  `deciderRoutageV2_` renvoie `autresEntites: []` — `creerRaccourcisEntites_` n'est plus appelé).
  Les raccourcis HÉRITÉS restent en place (« Ignoré » par la consolidation, jamais déplacés) ;
  re-brancher les raccourcis sur les entités validées serait un chantier explicite, pas un défaut.
- **Document transverse** (sans entité validée) → année (02) ou racine du domaine (règle unique).
- **Doublon** (non sensible) : **déplacé** dans `_Doublons` (jamais effacé, jamais en revue — au volume
  du grand rangement, signaler chaque doublon en revue la saturerait). S'applique **aussi** aux doublons
  sensibles (1 exemplaire classé, les autres dans `_Doublons`) — cf. Zone protégée ci-dessous.
- **Réorg IA (#21, Reorg.gs)** : sont **immuables** pour la réorg — les domaines `NN · …` (deplacer/
  renommer/fusionner interdits ; le renommage de domaine appartient au self-healing `NOMS_DOMAINES_TAG`),
  les files `00 ·` (À trier, À vérifier) et les racines `_…`, les **dossiers de catégorie à ID FIXE**
  (`CONFIG.CATEGORIES` : `Logement`/`Véhicule` — HÉRITAGE du chemin v1, plus une cible de routage
  depuis ADR-0023 ; la consolidation en drainera les fichiers, puis vidés → corbeille APP ADR-0014),
  les sous-dossiers d'année `AAAA` et les **noms** des sous-dossiers de schéma hérités (plus jamais
  créés depuis ADR-0023 — mais tant qu'ils portent des fichiers, les fusionner/renommer hors app
  casserait le plan de consolidation). `creer` sert aux dossiers STRUCTURELS,
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
