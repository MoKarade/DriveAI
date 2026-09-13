# ADR-0052 — Plus aucun fichier à plat à la racine d'un domaine (2026-09-13)

- **Statut** : accepté (2026-09-13) pour les décisions D1→D5 · **D6 et D7 en attente d'arbitrage de Marc**
- **Demande de Marc** : « J'ai encore trop de fichiers non classés dans des sous dossiers, en bref je
  veux mes 01 02 03 etc et pour chaque des sous dossiers mais **pas de fichiers libres** » ·
  « Jveux que ça aille dans les bons sous dossiers **ou que ça me propose des sous sous dossiers à
  créer** » · « Campagne de rattrapage complète, ~8-10 $ une fois » · « Oui, range aussi 04 en interne »
- **Révise** : ADR-0023 (« sous-dossier vide = classement à PLAT à la racine du domaine »)
- **Complète** : ADR-0033 (unification flux ↔ reset), ADR-0044 (affinage), ADR-0030 (§4, zone 04)

## 1. Le constat — 683 fichiers, mesurés un par un

Recensement EXHAUSTIF des enfants DIRECTS de chaque racine de domaine (API Drive, 2026-09-13 —
jamais un échantillon, leçon §9 « quand un rapport exhaustif existe, ne jamais chiffrer depuis un
échantillon ») :

| Domaine | À plat | Placés par la table de routage ACTUELLE |
|---|---:|---:|
| 01 · Administratif & identité | 13 | 0 |
| 02 · Finances | 0 | — |
| 03 · Logement & véhicule | 38 | 13 |
| 04 · Immigration | 18 | 0 |
| 05 · Carrière | 2 | 0 |
| **06 · Études & diplômes** | **475** | **0** |
| 07 · Santé | 10 | 0 |
| 08 · Perso & projets | 115 | 0 |
| 09 · Voyages | 12 | 0 |
| **Total** | **683** | **13 (1,9 %)** |

Le corpus est figé dans `test/fixtures/vrac-racines-2026-09-13.json` (noms seuls — métadonnées,
jamais de contenu, invariant §9 vie privée) et sert de banc d'essai à toute règle de cette ADR.

## 2. Le diagnostic — deux causes, pas 683 cas

**(a) La dégradation finale du routeur EST la racine du domaine.** `sousCheminDomaine_` (Router.gs,
règle partagée flux ↔ consolidation) se termine par `return { nom: '', id: '' }`, et `''` signifie
« à plat sous le domaine ». C'était une décision explicite d'ADR-0023, prise en réaction inverse :
la profondeur forcée avait produit ~500 dossiers dont ~100 vides. La leçon « granularité =
enrichissement, jamais frein » disait *ne pas envoyer en revue* quand l'info manque — elle a été
implémentée en *laisser à plat*, ce qui règle le frein mais fabrique le vrac. C'est le niveau de
dégradation qui est faux, pas le principe.

**(b) En 06, toute la table est gatée sur l'identification de l'ÉCOLE — et l'école n'est nulle part.**
`cheminCibleReset_` branche 06 : `if (!ecole) return null;`. Mesure sur les 475 noms réels :
**0 sur 475** contiennent un jeton d'établissement. Les 475 sont des travaux scolaires
(93 « exercice », 82 « TP/travaux pratiques », 71 « devoir », 68 « cours », 64 « note »,
26 « rapport », 14 « examen », 11 « correction »…) dont le nom ne porte que la matière.

⚠️ **Et le contenu ne la porte pas non plus.** Deux documents lus avant de chiffrer quoi que ce soit
(`TP Physique raideur ressort oscillations`, `Notes de cours biologie végétale`) : en-tête = prénoms
d'élèves + date, corps = la matière. **Aucun établissement.** Une campagne LLM sur les 475
(475 × 0,0261 $ ≈ **12,4 $**) ne les placerait donc PAS — elle rendrait le même `null` en ayant payé.
C'est exactement la leçon §9 « prouver sur du réel AVANT de coder ET de déployer » : le
chiffre-titre « 8-10 $ pour tout rattraper » n'était pas une promesse de gain.

Le seul signal qui rattacherait ces 475 à une école est **l'année** croisée au parcours de Marc
(lycée → prépa → DUT → cégep → IMERIR). DriveAI ne connaît pas ce parcours, et le déduire serait
« deviner » — interdit par §1.

## 3. Les décisions

### D1 — La racine d'un domaine n'est plus une cible de classement
Invariant nouveau : le routeur ne rend JAMAIS `''` comme sous-chemin tant qu'un nœud existant du
domaine peut accueillir le document. Mesuré, pas déclaré : un test rejoue les 683 noms réels et
compte, PAR DOMAINE, combien atterrissent encore à la racine.

### D2 — Un repli PAR TYPE, vers un nœud qui EXISTE déjà
Nouvelle fonction PURE `bucketTypeDomaine_(domaine, nom)` (Reset.gs, à côté de la table qu'elle
consulte). Elle s'intercale **entre** le repli par entité validée et la dégradation à plat :

```
cheminCibleReset_  →  identité (repliIdentite_)  →  entité VALIDÉE  →  année  →  bucketTypeDomaine_  →  ''
```

Contrat : elle ne rend qu'un chemin **présent dans `STRUCTURE_CIBLE_RESET[domaine]`** (verrouillé
par test — elle ne peut pas inventer de dossier), ou `''`. Elle est branchée **dans
`sousCheminDomaine_`**, donc par construction UNE règle pour ses DEUX consommateurs, le flux vivant
(`planRoutageV2_`) et la consolidation (`cheminCibleConsolidation_`) — leçon §9 « une seule règle,
deux consommateurs ».

⚠️ **Elle n'est délibérément PAS mise dans `cheminCibleReset_`**, bien que ce soit le point le plus
naturel. `cheminCibleReset_` sert aussi de **garde par CAPACITÉ** aux missions (`Missions.gs` :
« le FLUX fait autorité DANS 02 : ce qu'il sait placer y reste »). Lui apprendre à tout placer
rendrait cette garde toujours vraie et **tuerait les sorties inter-domaines** des missions, en
silence. La capacité qu'on élargit ici est celle du CLASSEMENT, pas celle de la REVENDICATION.

### D3 — Deux nœuds ajoutés, là où le domaine a de la place
- `09 · Voyages / Préparation & guides` (09 passe de 3 à 4 nœuds, ≤ 7 ✔) — guides d'accueil,
  programmes de séjour, conditions générales, fiches pratiques : 6 fichiers sans dossier d'accueil.
- `04 · Immigration / Pièces d'identité` (04 passe de 5 à 6 nœuds, ≤ 7 ✔) — 7 passeports et 3
  attestations aujourd'hui à plat dans 04. **Réorganisation INTERNE**, aucune sortie de 04
  (CLAUDE.md §1.1b) : le nœud est construit STRUCTURELLEMENT depuis la racine 04.

### D4 — Aucune suppression, aucun déplacement hors domaine
Le repli ne fait que choisir un sous-dossier **du domaine où le document est déjà**. Il ne peut pas
changer de domaine, donc pas davantage faire sortir un fichier de 04 (§1.1b, §2).

### D5 — La campagne LLM de rattrapage est REPORTÉE, et re-cadrée
Marc l'a approuvée à ~8-10 $ pour « le stock ». La mesure du §2 montre qu'elle ne résout pas le cas
majoritaire (06) et coûterait ~17 $ pour l'ensemble. Décision prudente : **ne pas la lancer**, et
présenter à Marc ce que le rangement par le NOM a réellement placé avant de dépenser un dollar.
Le frein `CONFIG.LLM_BUDGET_CAMPAGNES` reste à 40 $ et ne gate jamais le flux vivant (§1.6).

### D6 — *(en attente de Marc)* 06 · Études : la structure, pas le LLM
06 est PLEIN (7 nœuds : 5 écoles + « Autres établissements » + « Diplômes & relevés officiels »).
Accueillir les 475 travaux scolaires demande un nœud de plus, donc un arbitrage de Marc :

- **Option A — regrouper les écoles.** `06/Établissements/{les 6 existants}` +
  `06/Cours & travaux/{Notes de cours, Exercices & devoirs, TP & comptes rendus, Examens & corrigés,
  Projets & mémoires, Fiches & schémas}` + `06/Diplômes & relevés officiels`. 3 nœuds au niveau 1,
  6 à chaque niveau 2 (≤ 7 ✔). Place les 475. Coût : déplace aussi les ~139 fichiers déjà classés
  sous les 5 écoles (déplacement seul, réversible, aucune suppression).
- **Option B — ne rien restructurer.** Les 475 vont sous `06/Autres établissements/<famille>`.
  Zéro fichier déjà classé touché, mais « Autres établissements » veut dire « un autre
  établissement », pas « établissement inconnu » : ce n'est pas « le bon sous-dossier ».

Tant que Marc n'a pas tranché, les 475 restent à plat et le test le CONSTATE (compteur à 475, avec
son commentaire) plutôt que de le masquer par une exception.

### D7 — *(en attente de Marc)* 03 · Logement : 8 fichiers d'équipements sans nœud
8 fichiers (étiquette produit Armstrong, document électroménager Amana, liste de matériaux, plan de
revêtements de sol, inventaire d'équipements, rapport de dégradation…) décrivent l'ÉQUIPEMENT du
logement. 03 est PLEIN (7 nœuds). Un nœud `Travaux & équipements` demanderait d'en libérer un —
arbitrage de Marc.

## 4. Ce que ça donne, mesuré sur les 683

| Domaine | À plat | Placés après D1-D3 | Restants |
|---|---:|---:|---:|
| 01 | 13 | 12 | 1 — « Fragment de document technique » : le type n'apprend rien |
| 03 | 38 | 30 | 8 *(D7)* |
| 04 | 18 | 18 | 0 |
| 05 | 2 | 2 | 0 |
| 06 | 475 | 0 | 475 *(D6)* |
| 07 | 10 | 10 | 0 |
| 08 | 115 | 114 | 1 — `profil-vocal-marc.md` : ni date, ni type, ni émetteur |
| 09 | 12 | 12 | 0 |
| **Total** | **683** | **198** | **485** |

**Hors 06 : 198 sur 208, soit 95 %.** Les 485 restants sont à 98 % le seul arbitrage D6.
Chiffres MESURÉS par `test/racine-domaine.test.js` sur le corpus figé, jamais recopiés à la main :
le test échoue si l'un d'eux bouge.

## 5. Impact quotas & coût

- **Coût LLM : zéro.** Le repli est PUR, par le NOM — aucun appel supplémentaire, ni au flux ni à
  la consolidation. C'est le point le plus important de cette ADR face à la demande initiale
  (« ~8-10 $ une fois ») : 94 % du rattrapable l'est **gratuitement**.
- **Quota Drive** : inchangé au flux vivant (le `find-or-create` du sous-dossier remplace un
  `find-or-create` de racine). Sur le STOCK, ce sont les campagnes existantes (consolidation,
  réconciliation) qui reverront ces fichiers à leur rythme, dans leurs budgets/jour actuels —
  **aucune constante `*_BUDGET_JOUR_MS` ajoutée**, donc aucune addition nette à l'enveloppe
  (leçon §9 « réallouer, jamais augmenter »).
- **Risque de non-convergence** : nul par construction — le flux et la consolidation calculent la
  cible par la MÊME fonction ; ce qui est verrouillé par test n'est pas cette égalité (elle serait
  tautologique, leçon C28-62) mais (a) que toute cible rendue EXISTE dans la table, et (b) le
  compte d'atterrissages à la racine sur le corpus réel.

## 6. Méthode de test

1. `test/racine-domaine.test.js` rejoue les **683 noms réels** et fige le compte de racine PAR
   DOMAINE (0 partout sauf 06=475 et 03=8, chacun commenté avec sa décision en attente).
2. Tout chemin rendu par `bucketTypeDomaine_` doit EXISTER dans `STRUCTURE_CIBLE_RESET` — un
   dossier inventé fait échouer la CI.
3. `verifierStructureCibleReset_` (≤ 7 récursif) reste vert après D3.
4. Preuve par MUTATION : remettre la dégradation à `''` doit faire ÉCHOUER le test de comptage.
5. Non-régression §11.5 : les faux-positifs historiques (CV sans émetteur, note perso, export) ne
   partent toujours pas en revue — le repli classe, il ne dévie jamais vers `00 · À vérifier`.
