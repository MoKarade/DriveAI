# Recensement Drive complet — 2026-07-16 (chantier C28-26, refonte de l'arborescence)

> **Retour Marc (16/07, verbatim résumé)** : « c'est trop le bordel, j'arrive vraiment pas à me
> retrouver » — trop de dossiers PARTOUT, dossiers vides, fichiers non classés, fichiers « Inconnu »
> incompréhensibles, dossiers d'entités qui n'existent pas (banques, employeurs, écoles, véhicules,
> logements), doublons. Demande : **refaire l'arborescence EN ENTIER, et pas de doublons**.
>
> **Méthode** : recensement en LECTURE SEULE du 16/07 (13 agents parallèles, BFS complet par
> domaine via l'API Drive, dédupliqué par fileId). Seul `06 · Études` est un census partiel
> (plafond de listages atteint : 26 sous-dossiers de niveau 2 non ouverts — totaux = minima).

## Synthèse chiffrée

| Domaine | Dossiers | Vides | Fichiers | À plat (racine) | Hors convention | « Inconnu » | Prof. |
|---|---|---|---|---|---|---|---|
| 01 · Administratif & identité | 26 | 6 | 43 | 17 | 0 | 0 | 1 |
| 02 · Finances | 87 | 34 (39 %) | 237 | 0 | 93 | 7 | 3 |
| 03 · Logement & véhicule | 62 | 38 (61 %) | 202 | 10 | 5 | 49 | 3 |
| 04 · Immigration ⚠ zone protégée | 14 | 0 | 97 | 41 | 46 | 5 | 3 |
| 05 · Carrière | 92 | 13 | 303 | 5 | 138 | 1 | 3 |
| 06 · Études & diplômes (partiel) | 153+ | 8+ | 605+ | 3 | 265 | 4 | 2+ |
| 07 · Santé | 9 | 0 | 20 | 11 | 0 | 1 | 1 |
| 08 · Perso & projets | 39 | 3 | 1 050 | **989 (94 %)** | 28 | **672 (64 %)** | 2 |
| 09 · Voyages | 17 | 0 | 68 | 26 | 0 | 1 | 1 |
| _Technique | 0 | 0 | 255 | 255 | 0 | **169 (66 %)** | 0 |
| _Doublons | 0 | 0 | 1 015 | 1 015 | 25 | 65 | 0 |
| 00 · À trier / 00 · À vérifier | 0 | 0 | 0 | 0 | — | — | — |
| **TOTAL (hors _Doublons)** | **~499** | **~102** | **~2 880** | **~1 357** | **~575** | **~909** | |

Les deux files `00` sont **vides** : le moteur draine — le problème n'est pas l'intake, c'est la
**structure produite** par le classement.

## Vérités de Marc (listes d'entités RÉELLES — la référence de toute refonte)

- **Véhicules (3, pas plus)** : Ford Fiesta 2011 · VW Jetta · Toyota bZ.
- **Employeurs (2, pas plus)** : Automatech Robotik · Robovic. *Tout le reste dans 05 = candidatures/
  prospection, PAS des employeurs.*
- **Parcours scolaire (6 étapes)** : lycée Thérèse d'Avila (Lille) → prépa Gustave Eiffel
  (Armentières) → DUT ULCO Saint-Omer (IUT du Littoral, GIM) → échange au Canada (Cégep de
  Sherbrooke) → IMERIR Perpignan (école d'ingé) → échange en Finlande (HAMK, Hämeenlinna).
- **Logements** : « beaucoup moins de logements que de dossiers » (liste exacte à valider avec Marc ;
  adresses vues : 1548 av. de la Roselière Québec, 783 av. Moreau Québec, Logement Perpignan,
  logement étudiant Finlande — avec doublons de graphie, cf. 03).

## Détail par domaine

### 01 · Administratif & identité — 26 dossiers pour 43 fichiers
- 20/26 dossiers de niveau 1 contiennent **0 ou 1 fichier** (un dossier par émetteur : EDF, ENGIE,
  Société Générale, Virgin Plus, Filia-MAIF, Autobus Tesco, CPAT, INO…).
- 6 vides dont 3 anciens dossiers de structure (`Identité`, `Santé & assurances`,
  `Sécurité & sauvegardes`) ; quasi-doublon `Correspondance` (vide) vs `Correspondances` (1 f).
- 17 fichiers à plat à la racine ; 5 fichiers suffixés `_2` (copies) ; paires redondantes
  `État civil` / `Fiche d'état civil` ; 1 raccourci Drive compté comme fichier.
- Des dossiers de BANQUE ici (Société Générale) alors que 02 · Finances existe.

### 02 · Finances — 87 dossiers, 34 vides, « un dossier par banque » ×2 générations
- Niveau 1 = mélange de TROIS logiques : (a) taxonomie de base quasi vide (`Banque`, `Impôts`,
  `Revenus & paie`, `Factures & abonnements`, `Chèques`, `Assurance vie`, `Portefeuille boursier`…
  tous 0 fichier) ; (b) ~40 dossiers PLATS par émetteur (Lyonnaise De Banque, Boursorama, BCQUE,
  Tether USDT, Cleverbridge, Buy-Keys.com, Hifi & Foto Koch… presque tous 1 fichier) ; (c) 13
  dossiers-années (2003…2026) dont 6 vides.
- Squelettes `Correspondance`/`Contrats & produits`/`Relevés` créés sous CHAQUE banque
  (Banque Transatlantique, Société Générale, Banque CIC, Wealthsimple, Desjardins, SCI MRic) :
  **17 de ces sous-dossiers sont vides** — les fichiers ne les atteignent jamais.
- Variantes d'une même entité : CIC / CIC Lambersart Canteleu / Banque CIC ; Desjardins /
  Desjardins Assurance / Desjardins Securities / Caisse Desjardins De Sainte-Foy / Desjardins
  Centre-de-la-Mauricie.
- Doublons massifs : `2026` contient des titres répétés ×2-4 (Contrat_Inconnu ×3, contrats CIC ×6),
  `Anthropic` 22 factures dont suffixes `_2` ; 3 raccourcis Drive sous Société Générale.
- 93 fichiers hors convention (surtout `AAAA-MM_Relevé…` sans jour).

### 03 · Logement & véhicule — 62 dossiers, 38 VIDES (61 %)
- Squelettes thématiques (`Assurance`, `Factures`, `Bail & contrat`, `Immatriculation`,
  `Entretien & réparations`…) créés sous chaque véhicule/adresse **et jamais remplis** : les
  fichiers restent À PLAT dans `Véhicule` (92 f) et `Logement` (85 f).
- Doublons de structure : `1548 avenue de la Roselière, Québec` vs `1548 av de la roselière`
  (vide) ; `783 av. Moreau, Québec` vs `783 avenue Moreau` (vide) **plus un 3ᵉ** `783 avenue
  Moreau` au niveau 1 du domaine.
- Entités parasites au niveau 1 (hors de Logement/Véhicule) : Desjardins Assurances, Toyota,
  Cégep, DOBERNARD David, ENGIE, FILIA-MAIF, MAIF, Azur Expertise Auto, Retta Isännöinti,
  Hämeenlinnan Seudun Opiskelija-asuntosäätiö… (1 fichier chacun).
- 49 « Inconnu » ; fichiers en double (Formulaire Immeubles MA8 ×2, Facture Hydro-Québec ×2).

### 04 · Immigration (⚠ zone protégée — jamais détaché, garde multi-parents)
- **4 variantes de dossier pour IRCC** (`IRCC`, `IRCC — Immigration…`, `Immigration, Réfugiés Et
  Citoyenneté Canada`, `Immigration, Refugees and Citizenship Canada (IRCC)`) + MIFI + CIC Nord Ouest.
- 41 fichiers à plat à la racine ; doublons de titres avec IDs distincts (3× `2019-09-17_Passeport_
  Préfecture du Nord.pdf`, 2× permis de travail ×2 dates) ; 18 raccourcis Drive sous
  `Résidence permanente` ; 46 hors convention.

### 05 · Carrière — 92 dossiers pour 2 vrais employeurs
- `Robovic` (58 f) et `Automatech` (52 f) = les seuls vrais. **~65 dossiers d'ENTREPRISES à 1-4
  fichiers qui sont des candidatures/prospection** (Schneider, Siemens, Eaton, Safran, VELUX,
  Exotec, Airbus, Alstom, ABB, 3M, Sanofi…), PLUS des dossiers génériques qui se recoupent
  (`CV` 36 f, `Candidatures` 16 f, `Recherche d'emploi`, `Recherche de stage`, `Recherche de
  stages`, `Stages`, `Prospection`, `Profils & candidatures`, `Présentation personnelle`…).
- Squelettes récents en doublon de l'existant : `Emploi actuel — Robovic` (vide + 1 sous-dossier)
  vs `Robovic` ; `Expériences précédentes` (2 sous-dossiers) vs `Automatech`.
- 138 hors convention (paies `AAAA-MM_` sans jour : Robovic 54, Automatech 40 ; CV `AAAA_`).

### 06 · Études & diplômes — 153+ dossiers (census partiel), le pire ratio structure/contenu
- Dossiers génériques ÉNORMES à plat : `Devoirs` (123 f), `Cours` (90 f), `Travaux pratiques`
  (56 f), `Exercices` (47 f), `Colles` (15 f), `Examens` (13 f), `Évaluations`, `Corrigés`,
  `Corrections`, `Résultats`, `Devoirs surveillés`, `TP`, `TPE`… — sans rattachement à une école.
- Variantes d'une même école : `IUT Du Littoral` / `IUT Du Littoral Côte d'Opale` / `IUT Du
  Littoral - Côte d'Opale` / `IUT GIM` / `IUT GIM 1` / `IUT GIM Du Littoral` / `ULCO` ;
  `lycée Thérèse d'Avila` / `Thérèse d'Avila Lille` ; `Lycée Gustave Eiffel` / `Lycée Gustave
  Eiffel Armentières` (+ `Collège Gustave Eiffel Armentières`… rangé dans 07 · Santé).
- **Dossiers par PROF** (`Mr Tetard` / `Mrtetard` / `Mr Têtard` / `Pierre Tetard`, `Le Meur`,
  `Mme Salwa`, `Tony Chauvey`) et par CAMARADE (`Grégoire Defoy`, `Roméo Verdier`, `Gaëtan
  Lebaillif`, `Hugo Mantion` — vides) ; entités hors sujet (`Engie`, `Bureau Veritas`, `ENSEM`,
  `INP ENSEIRB-MATMECA`, `Automatech` 9 f).
- 265 hors convention. Census partiel : 26 sous-dossiers de niveau 2 non listés (squelettes
  `Mémoire & travaux`/`Relevés de notes`/`Diplôme & attestation` sous 5 écoles + `Archives
  scolaires` 7 sous-dossiers + `Diplômes & attestations` 4).

### 07 · Santé — 9 dossiers à 1 fichier + 11 fichiers à plat
- Un dossier par émetteur, chacun 1 fichier ; 11 fichiers à plat à côté — logique incohérente.
- `Collège Gustave Eiffel Armentières` rangé ICI (émetteur d'un document ≠ domaine du document —
  le retour de Marc « pourquoi j'ai mon collège ici »).
- Doublon binaire : 2 PDF `2025-04-09_Facture_Prelib…` (IDs et tailles ≠, 38022/37671 octets).

### 08 · Perso & projets — LE dépotoir : 989/1050 fichiers à plat, 672 « Inconnu »
- 94 % des fichiers jamais rangés dans un sous-dossier (masses de `Vidéo_Inconnu.mp4`,
  `Message_Inconnu.html`, captures d'écran) ; 36/39 dossiers de niveau 1 à 1-3 fichiers, noms
  quasi-synonymes (`Schémas`/`Schémas & diagrammes`/`Schémas électroniques`, `Mémoire`/`Mémoires
  & rédactions`, `Exercices`/`Exercices techniques`, `Rapports`, `Rédaction`, `Écrits créatifs`…).
- Camarades encore (`Gaëtan Lebaillif`, `Roméo Verdier`, `Nathanaël Capell`) ; beaucoup de contenu
  scolaire qui recoupe 06.

### 09 · Voyages — fragmentation d'entités
- Le même transporteur finlandais en 4 dossiers : `VR` (12 f) / `VR-Group` / `VR-Yhtymä Oyj`
  (8 f) / `VR (Chemins De Fer Finlandais)` ; `Eckerö Line` / `Eckerö Line Ab Oy` ; doublons de
  billets entre `VR` et `VR-Yhtymä Oyj` ; 2× deux confirmations Air Canada identiques ; 26
  fichiers à plat.

### _Technique — 255 fichiers à plat, 169 « Inconnu » (66 %)
- Censé contenir code/CAO (par extension). En réalité : exports HTML de MAILS
  (`Message_Inconnu.html`, `Correspondance_Inconnu.html`, `Relevé_Inconnu.html`), `.reg`,
  `.class`… La détection par extension a sur-capturé des documents non techniques. Aucune
  arborescence. Titres quasi identiques (doublons de nommage probables).

### _Doublons — 1 015 fichiers, dont du sensible en 6 exemplaires
- **6 copies de `2019-09-17_Passeport_Préfecture du Nord.pdf`** (document d'identité) ; ~90 copies
  quasi identiques de `Terms-of-Service-fr-fr.html` ; 8 photos brutes `PXL_*.jpg`.
- Structure 100 % plate ; jamais nettoyé (par construction : aucune suppression).

## Patterns transverses (les 7 mécanismes du bordel)

1. **Un dossier d'entité né au PREMIER fichier** d'un émetteur → dizaines de dossiers 0-1 fichier
   par domaine ; l'émetteur d'un document est promu « entité de classement » même quand il ne
   devrait pas l'être (candidature ≠ employeur, collège = émetteur d'un certificat ≠ dossier santé).
2. **Squelettes de sous-dossiers fixes créés d'avance** (Correspondance/Contrats/Relevés,
   Assurance/Bail/Factures, Mémoire & travaux/Relevés de notes/Diplôme) **jamais remplis** —
   les fichiers restent à plat un niveau au-dessus. ~100 dossiers vides au total.
3. **Entités non canonisées** : IRCC ×4, VR ×4, IUT Littoral ×5+, Desjardins ×5, Tetard ×4,
   Gustave Eiffel ×3, adresses ×2-3 graphies → fragmentation + doublons de structure.
4. **Fichiers à plat aux racines de domaine** (~1 357) : le rangement ne les reprend pas.
5. **« Inconnu » en masse** (~909 hors _Doublons) : concentrés dans 08 (672) et _Technique (169) —
   exports de mails/captures sans émetteur détectable ; ils POLLUENT la lecture des dossiers.
6. **Doublons réels non écartés** : titres identiques ×2-6 dans 02/03/04/07/09 (IDs distincts) ;
   et _Doublons contient du SENSIBLE (passeport ×6).
7. **Raccourcis Drive** (01, 02, 04 : 20+) comptés/manipulés comme des fichiers.

## Contraintes non négociables pour toute refonte (rappel)

- **Aucune suppression par le moteur** (§2.2) — un dossier VIDE ne peut partir qu'à la corbeille
  Drive via l'APP, au clic de validation de Marc (ADR-0014, `app/src/corbeille.ts`).
- **04 · Immigration jamais détaché** (garde multi-parents `aParentProtege_`, §2.1b).
- **Doublons → `_Doublons`** (déplacement seul).
- Campagne de masse : bornée, reprenable, convergente, `dryRun_` d'abord (§8.6), budget LLM §2.6.
- « Granularité = enrichissement, jamais frein » (§7) — mais ici la granularité auto a DÉPASSÉ
  l'enrichissement : elle fabrique du bruit. La refonte doit inverser le défaut (à plat par défaut,
  dossier d'entité seulement si VALIDÉ).
