# ADR-0052 — Plus aucun fichier à plat à la racine d'un domaine (2026-09-13)

- **Statut** : accepté (2026-09-13). D1→D5 et D8 livrés en #338 ; **D6 et D7 tranchés par Marc le
  même jour** et livrés à leur suite (§7).
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
`cheminCibleReset_` branche 06 : `if (!ecole) return null;`. Mesure initiale sur les 475 noms
réels : **0 sur 475** reconnu par la table.
⚠️ **Ce chiffre, annoncé comme exhaustif, était faux — corrigé par la revue flotte.** 11 noms
portaient bel et bien un établissement que la table ne voyait pas : « Cégep de **Saint-Hyacinthe** »
figurait dans le vocabulaire depuis toujours mais ne matchait jamais (`normaliserCle_` conserve les
traits d'union), et 4 établissements réels manquaient (Lycée Hugo, Armentières, Académie de Lille,
Centre universitaire Descartes). Corrigé ici : **11 sur 475**, gratuitement. Le diagnostic tient,
sa formulation était trop forte — « 0 reconnu par la table » n'est pas « 0 qui en porte un ».
Les 464 restants sont des travaux scolaires
(93 « exercice », 82 « TP/travaux pratiques », 71 « devoir », 68 « cours », 64 « note »,
26 « rapport », 14 « examen », 11 « correction »…) dont le nom ne porte que la matière.

⚠️ **Et le contenu ne la porte pas non plus.** Deux documents lus avant de chiffrer quoi que ce soit
(`TP Physique raideur ressort oscillations`, `Notes de cours biologie végétale`) : en-tête = prénoms
d'élèves + date, corps = la matière. **Aucun établissement.** Une campagne LLM sur les 464
(464 × 0,0261 $ ≈ **12,1 $**) ne les placerait donc PAS — elle rendrait le même `null` en ayant payé.
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
Accueillir les 464 travaux scolaires sans école identifiable demande un arbitrage de Marc :

- **Option A — regrouper les écoles.** `06/Établissements/{les 6 existants}` +
  `06/Cours & travaux/{Notes de cours, Exercices & devoirs, TP & comptes rendus, Examens & corrigés,
  Projets & mémoires, Fiches & schémas}` + `06/Diplômes & relevés officiels`. 3 nœuds au niveau 1,
  6 à chaque niveau 2 (≤ 7 ✔). Place les 464. Coût : déplace aussi les ~139 fichiers déjà classés
  sous les 5 écoles (déplacement seul, réversible, aucune suppression).
- **Option B — ne rien restructurer.** Les 464 vont sous `06/Autres établissements/<famille>`.
  Zéro fichier déjà classé touché, mais « Autres établissements » veut dire « un autre
  établissement », pas « établissement inconnu » : ce n'est pas « le bon sous-dossier ».

- **Option C — la fenêtre de scolarité, comme les fenêtres d'occupation des logements**
  *(proposée par la revue flotte ; c'est celle que je recommande)*. Le projet fait DÉJÀ exactement
  cela, à la demande explicite de Marc : `logementParDate_` / `fenetresOccupation_` (Missions.gs)
  attribuent une correspondance sans indice au logement dont la fenêtre d'occupation contient sa
  date — « regarde les dates pour déterminer », décision Marc, ADR-0040. Une table `ANNEES_ECOLE`
  **validée par Marc** (lycée → prépa → DUT ULCO → cégep → IMERIR) a le même statut que
  `MISSIONS_BAILLEURS` ou `RESET_PERSONNES_AUTRES` : une DÉCISION, pas une inférence du moteur.
  Le préfixe `AAAA` du nom — présent sur la quasi-totalité des 464 — désigne alors l'école **si et
  seulement si** il tombe dans EXACTEMENT une fenêtre ; sinon refus (révisable), comme pour les
  logements. Le type fait le reste, via les règles `<école>/Cours & travaux`, `/Examens & khôlles`,
  `/Résultats` qui existent déjà.
  Ce que ça coûte : les années charnières (2018 lycée/prépa, 2020-21 DUT/cégep) refusent — couverture
  partielle, et c'est le bon comportement (« le prédicat qui déclenche l'irréversible refuse dans le
  doute »). Ce que ça économise par rapport à A : **zéro fichier déjà classé déplacé**, aucun nœud
  ajouté, aucun libellé mensonger.
  ⚠️ Cette option invalide la phrase du §2 « le déduire serait deviner » : déduire SEUL serait
  deviner ; appliquer une table que Marc a validée ne l'est pas. La distinction est celle que le
  dépôt fait déjà partout ailleurs.

Tant que Marc n'a pas tranché, les 464 restent à plat et le test le CONSTATE (compteur à 464, avec
son commentaire) plutôt que de le masquer par une exception.

### D7 — *(en attente de Marc)* 03 · Logement : 8 fichiers d'équipements sans nœud
**6** des 8 fichiers restants décrivent l'ÉQUIPEMENT du logement (étiquette produit Armstrong,
document électroménager Amana, liste de matériaux, plan de revêtements de sol, inventaire
d'équipements, rapport de dégradation) : un nœud `Travaux & équipements` les accueillerait, mais
`03` est PLEIN (7 nœuds) et en ouvrir un exige d'en libérer un — arbitrage de Marc.
Les **2 autres** ne sont pas de cette famille et sont listés à part pour ne pas fausser son
arbitrage (correction de la revue flotte, qui a relu la liste réelle) : une capture d'annonce
(`Capture de profil entreprise_LOPI Groupe Immobilier`) et une liste d'achats pour le VÉHICULE, pas
le logement (`Liste achats préparation hivernale véhicule`).

### D8 — Un signal FAIBLE ne déplace jamais ce qui est déjà rangé *(ajouté après la revue flotte)*
`bucketTypeDomaine_` ne lit que le TYPE : il ignore tout ce qui a pu justifier un rangement existant
(une mission qui range par bailleur ou par fenêtre d'occupation, un geste de Marc, un dossier
d'entité pas encore au référentiel). Il a été introduit pour qu'un document ne RESTE pas à la racine,
pas pour arbitrer contre un classement. Sa cible est donc marquée `faible: true`, et
`decisionConsolidation_` refuse de DÉPLACER un fichier dont le sous-chemin actuel n'est pas vide.

Mesuré avant d'écrire la garde, sur les 15 fichiers réels de `03 · Logement/3325 4e avenue` :
**2 partaient vers `Correspondance`** (« Échange de messages_Saga Installation », « Échange de
messagerie_Guy Laporte ») — la table ne reconnaît ni l'un ni l'autre émetteur, la mission logements
si. `ConsolidationExec` applique **sans validation ligne à ligne** : l'erreur aurait été muette.
C'est aussi ce qui rend le bump de tag du §5 sûr le jour où Marc le décidera.
Corpus figé : `test/fixtures/deja-ranges-2026-09-13.json` (deux dossiers réels, pris entiers).

## 4. Ce que ça donne, mesuré sur les 683

| Domaine | À plat | Par la TABLE | Par le REPLI | Restants |
|---|---:|---:|---:|---:|
| 01 | 13 | 0 | 12 | 1 — « Fragment de document technique » : le type n'apprend rien |
| 03 | 38 | 13 | 17 | 8 *(D7)* |
| 04 | 18 | 7 | *(11)* | voir ci-dessous |
| 05 | 2 | 0 | 2 | 0 |
| 06 | 475 | 11 | 0 | 464 *(D6)* |
| 07 | 10 | 0 | 10 | 0 |
| 08 | 115 | 0 | 114 | 1 — `profil-vocal-marc.md` : ni date, ni type, ni émetteur |
| 09 | 12 | 0 | 12 | 0 |
| **Total** | **683** | **31** | **178** | **474** |

**Hors 06 : 198 sur 208, soit 95 %.** Chiffres MESURÉS par `test/racine-domaine.test.js` sur le
corpus figé, jamais recopiés à la main : le test échoue si l'un d'eux bouge.

⚠️ **La colonne `04` est entre parenthèses, et c'est important.** Le repli calcule bien une cible
pour ses 11 autres fichiers, mais **aucun consommateur ne l'appliquera** : la consolidation refuse
d'agir sur la zone protégée (action `Ignoré`, §1), et le seul mutateur autorisé dans `04`,
`reorganiserInterne04_`, résout sa cible par `cheminCibleReset_`. C'est pourquoi la règle
d'identité a été ajoutée **dans la table** et pas seulement dans le repli : sans elle, le nœud
`04/Pièces d'identité` n'aurait eu **aucun producteur**. Les 7 passeports partiront donc quand
`CONFIG.RESET_ACTIF` repassera à `true` — décision de Marc, hors périmètre de cette ADR.
*(Une première version de ce tableau annonçait « 04 : 18/18 ». C'était mesuré à travers une lentille
que la production n'emprunte jamais pour `04` — trouvé par deux agents de la revue flotte,
indépendamment.)*

Les 31 « par la table » ne sont pas un acquis de cette ADR mais des **bugs de motifs** que la revue
flotte a trouvés dans la table EXISTANTE, corrigés ici parce qu'ils étaient gratuits : « saint
hyacinthe » et « saint omer » ne matchaient pas (`normaliserCle_` conserve les traits d'union),
4 établissements réels manquaient au vocabulaire de `06`, et `04` ne connaissait pas l'identité.

## 5. Impact quotas & coût — et ce qui reste à faire pour que ça PRODUISE cet effet

- **Coût LLM : zéro.** Le repli est PUR, par le NOM — aucun appel supplémentaire, ni au flux ni à
  la consolidation. C'est le point le plus important face à la demande initiale (« ~8-10 $ une
  fois ») : 95 % du rattrapable hors `06` l'est **gratuitement**.
- **Effet IMMÉDIAT : les nouvelles arrivées.** Dès le déploiement, tout document entrant par Gmail
  ou par `00 · À trier` que le flux ne sait pas rattacher va dans un sous-dossier au lieu de la
  racine. La racine cesse de se remplir.
- 🔴 **Effet sur le STOCK : AUCUN en l'état, et c'est délibéré.** Les 683 fichiers portent déjà une
  clé de SUCCÈS `conso|conso-3|<fileId>` posée avec la décision « OK — racine du domaine », et la
  génération de plan sort au premier `if` (`DriveAI_CONSOLIDATION === tag`, campagne terminée 9/9 le
  16/08). La réconciliation, elle, ne mute rien par conception. Rien ne les reverra tant que
  `CONFIG.CONSOLIDATION_TAG` n'est pas bumpé — c'est la leçon §9 « re-lancer une campagne à clé de
  SUCCÈS ne re-traite pas ce qu'elle a figé OK ».
  *(Les trois agents de la revue flotte l'ont relevé indépendamment ; la première version de cette
  ADR, du commit et du HANDOVER écrivait « 198 des 683 placés » au passé accompli.)*
  **Le bump n'est pas fait ici** parce qu'il ne se résume pas à changer une constante : il faut
  aussi rendre à la consolidation le budget quotidien qui lui a été retiré (2 min/j depuis C28-49,
  ses 10 min étant parties aux missions), et ce transfert est verrouillé par un test de COUPLE qui
  force l'arbitrage. C'est une décision de Marc sur le quota runtime partagé, pas un détail
  d'implémentation. Suivi : **C28-90** au backlog.
- **Quota Drive** : inchangé au flux vivant (le `find-or-create` du sous-dossier remplace un
  `find-or-create` de racine). **Aucune constante `*_BUDGET_JOUR_MS` ajoutée** (leçon §9
  « réallouer, jamais augmenter »).
- **Risque de non-convergence** : D8 le ramène à zéro pour la classe que la revue a mesurée (un
  fichier déjà rangé n'est jamais remonté par le repli). Ce qui reste, et qui est **antérieur** à
  cette ADR : les missions `03` calculent leurs cibles avec des règles que `cheminCibleReset_` ne
  possède pas (`cibleBailleur_`, `logementParDate_`, `bucketEmetteur_`). Les faire remonter dans la
  règle partagée est le prérequis propre au bump de tag — C28-90 aussi.

## 6. Méthode de test

1. `test/racine-domaine.test.js` rejoue les **683 noms réels** et fige le compte de racine PAR
   DOMAINE (0 partout sauf 06=475 et 03=8, chacun commenté avec sa décision en attente).
2. Tout chemin rendu par `bucketTypeDomaine_` doit EXISTER dans `STRUCTURE_CIBLE_RESET` — un
   dossier inventé fait échouer la CI.
3. `verifierStructureCibleReset_` (≤ 7 récursif) reste vert après D3.
4. Preuve par MUTATION : remettre la dégradation à `''` doit faire ÉCHOUER le test de comptage.
5. Non-régression §11.5 : les faux-positifs historiques (CV sans émetteur, note perso, export) ne
   partent toujours pas en revue — le repli classe, il ne dévie jamais vers `00 · À vérifier`.

## 7. Les arbitrages de Marc (2026-09-13, après #338)

### D6 — RETENUE : l'option C, avec les périodes de Marc
Réponse de Marc, mot pour mot : « Imerir 2020 2023 ulco saint omer 2018 2020 Eiffel 2017 2018 »,
puis « Cegep de Sherbrooke c'est 2019 en même temps que ULCO et lycée Thérèse davilla c'est genre
2014 2017 ».

`RESET_FENETRES_ECOLE` (Reset.gs) + `ecoleParDateReset_` (PURE). Bornes en MOIS, à la convention de
l'année SCOLAIRE (septembre → août) : c'est ce qui rend les fenêtres disjointes alors que les années
nues de Marc se chevauchent aux charnières. Sans ce découpage, 83 fichiers tombaient dans deux
fenêtres et étaient refusés pour rien.

⚠️ **La fenêtre du Cégep de Sherbrooke ne sert pas à PLACER, elle sert à EMPÊCHER de placer.** Marc
y était « en même temps que l'ULCO » : tout document de 2019 tombe donc dans deux fenêtres et est
REFUSÉ. C'est 28 fichiers de moins placés — et zéro mal placé. Sans cette ligne, l'omission aurait
été SILENCIEUSE : le moteur aurait rangé les documents de Sherbrooke chez l'ULCO avec une clé de
SUCCÈS, donc sans retour possible. C'est la question qui a valu d'être posée.

Ordre de décision dans la branche `06`, du FAIT vers la DÉDUCTION — et jamais l'inverse :
1. le NOM de l'école (fait écrit) ;
2. un marqueur de NIVEAU ou de FILIÈRE (« 2nde », « GIM1 », « khôlle ») — fait écrit lui aussi,
   15 fichiers sur 349 ;
3. la FENÊTRE de scolarité (déduction), refus dès qu'il y a deux fenêtres ou aucune.

**Mesuré : 143 des 475 placés dans `06`** — **34 par un FAIT écrit dans le nom** (école, type de
diplôme, marqueur `GIM`/`1ʳᵉ`) et **109 par les fenêtres**. *(Une première version annonçait
« 147 dont 15 par marqueur » : les deux chiffres étaient faux, re-comptés par la revue flotte. Sept
marqueurs sur neuf avaient une contribution NULLE mesurée — dont `svt`, qui produisait en prime une
contradiction dans le corpus — et quatre étaient INATTEIGNABLES, déjà captés par les listes de nom.
Il n'en reste que deux.)*

⚠️ **La fenêtre seule ne suffisait pas.** Marc a dit « Sherbrooke 2019 », mais le dossier RÉEL
`Cégep de Sherbrooke` contient des fichiers de **2018-08 à 2025-01**. Cinq documents du corpus
(« Direction du Cégep » 2020-03 et 2020-11, « Message MIO » 2020-10, « Centre de services scolaire »
2023-08…) partaient donc chez l'ULCO ou chez IMERIR — le mode de panne exact que la fenêtre de
Sherbrooke devait éviter, décalé de trois mois. D'où `vetoCollegialReset_` : quand le nom revendique
un établissement québécois que la table n'a pas su résoudre, **aucune fenêtre n'a le droit de
trancher**. Garde par CAPACITÉ, pas par liste d'écoles.

⚠️ **Et une école DÉDUITE est un signal FAIBLE** (même statut que le repli par type, D8) : elle sort
un fichier de la RACINE, elle ne le retire jamais d'un dossier d'école existant. Sans ça, un
document de cégep classé à la main et dont le nom ne dit pas l'école aurait été déménagé au premier
passage de la consolidation.

### D6 bis — le reliquat : « lit et classe mieux »
Reste 328 fichiers, dont **239 portent la date `2026`** — la date de RÉCEPTION, faute de date
lisible au moment de l'import. Le nom est épuisé (mesuré : 15 marqueurs sur 349). Marc : « lit et
classe mieux ».

La lecture LLM a bien un travail utile ici, mais **ce n'est pas celui qu'on croyait** : elle ne
trouvera pas l'école (prouvé §2), elle trouvera la **DATE**. Le TP de physique lu au §2 porte
« 09/10/2017 » dans son en-tête, à côté des prénoms. Re-dater ces 239 documents suffit à les faire
tomber dans les fenêtres ci-dessus. C'est la campagne `reanalyse` existante, pas un mécanisme neuf.
328 × 0,0261 $ ≈ **8,6 $** — dans l'enveloppe que Marc avait approuvée (« ~8-10 $ une fois »).
Suivi : **C28-92**, à livrer après C28-90 (sans le rattrapage du stock, un document re-daté resterait
là où il est).

### D7 — RETENUE : fusionner, pas ajouter
Réponse de Marc : « Fusionner Contrats + Modèles ». `Modèles & formulaires` disparaît de `03` et sa
place va à **`Travaux & équipements`**. Les 6 formulaires réellement présents dans l'ancien nœud sont
tous locatifs (4 demandes de location CORPIQ, 2 consentements Proprio Expert) : `Contrats` est leur
place. `03` reste à 7 nœuds — il a échangé, pas gagné.

⚠️ **La mission `dispatch03` visait le même nœud** (`Missions.gs`) : elle suit dans le même commit,
sinon elle RE-CRÉAIT `Modèles & formulaires` PAR NOM à chaque passage pendant que le flux range dans
`Contrats` — le ping-pong exact de la leçon « une seule règle, deux consommateurs ».

**Mesuré : 6 des 8 restants de `03` placés.** Les 2 derniers ne sont pas de l'équipement (une capture
d'annonce, une liste d'achats pour le VÉHICULE) — c'est la revue flotte qui avait corrigé l'étiquette.

### Bilan après D6/D7 (mesuré, pas recopié)
| | À plat | Placés | Restants |
|---|---:|---:|---:|
| Hors `06` | 208 | 204 | **4** |
| `06` | 475 | 143 | 332 *(C28-92)* |
| **Total** | **683** | **347** | **336** |

Sur les 332 restants de `06`, **237 portent la date `2026`** (la date de réception).

## 8. C28-90 — la préparation du rattrapage

Marc, 2026-09-13 : « fais la préparation de C28-90 et lance le rattrapage ». La préparation a été
faite d'abord, le conflit de structure de `06` tranché par Marc ensuite (§9), **et le bump
`conso-3 → conso-4` seulement après**.

### Ce qui EST fait
1. **Budget réalloué** : `CONSOLIDATION_BUDGET_JOUR_MS` 2 → 10 min/j, repris aux missions (10 → 2),
   toutes terminées ou à jour. Le COUPLE reste à 12 min/j — réallocation, jamais une hausse
   d'enveloppe (leçon §9), et le test d'invariant le vérifie.
2. **Les règles que les missions étaient seules à connaître sont remontées dans la règle partagée** :
   le flux vise désormais `Assurance habitation/<Assureur>` et `Énergie & services/<Fournisseur>`
   via `bucketEmetteur_` — la MÊME fonction que `dispatch03`. Avant, le flux s'arrêtait au filet
   pendant que la mission remplissait le bucket : la consolidation aurait remonté d'un cran chaque
   fichier rangé le 12/09. Les 4 buckets sont désormais DÉCLARÉS dans `STRUCTURE_CIBLE_RESET`.
3. **D9 — on ne remonte jamais un fichier vers un de ses ancêtres.** Quand la cible calculée est un
   préfixe du chemin actuel, le fichier est déjà là où on veut l'envoyer, en plus précis : la règle
   générale en sait moins que celui qui l'a rangé. Mesuré sur le Drive réel : sans cette garde, les
   6 sous-dossiers thématiques de `Logement/3325 4e avenue` et les 4 buckets d'émetteur étaient
   remontés d'un cran. `ConsolidationExec` applique sans validation ligne à ligne — l'erreur aurait
   été muette et massive.

### Le conflit qui a fait attendre le bump — et sa résolution
Les 4 nœuds d'école visés par D6 (`DUT ULCO Saint-Omer`, `Prépa Gustave Eiffel (PTSI)`, `IMERIR`,
`lycée Thérèse d'Avila`) étaient **exactement les 4 sources de la mission `archives06`**, dont
l'objet était de les VIDER vers des archives aux autres noms (`ULCO — DUT GIM`, `Prépa PTSI`,
`IMERIR — Ingénieur MSIR`, `Lycée — Thérèse Davila`) — et qui les déclarait `sourcesJetables`,
c'est-à-dire **peints en rouge pour suppression une fois vides**.

Son commentaire affirmait : « une fois vides, ils n'ont plus d'objet et le flux ne les recrée pas (il
vise l'archive) ». C'est vrai du chemin par ENTITÉ (re-pointé par `apresConvergence`), **faux du
chemin par TABLE** : `cheminCibleReset_` résout ces nœuds PAR NOM. Avant D6 la contradiction portait
sur 11 fichiers ; D6 la portait à 143, et le bump l'aurait rendue effective d'un coup.

**Marc a tranché (§9) : la structure, ce sont ses 5 dossiers d'école.** La mission a donc été
INVERSÉE dans le même commit — l'archive rend son contenu à l'école. Tag et clé changent avec le
sens (`retour-ecoles06` / `mission-retour-ecoles-06`) : sans ça, les fichiers déjà déplacés dans
l'autre sens portaient une clé de SUCCÈS et n'auraient jamais été repris. Et `sourcesJetables`
devient `[]` : `Archives scolaires` contient trois autres dossiers que la mission ne touche pas, et
peindre en rouge un parent partiellement vidé est exactement le défaut « tracer ce qui se passe si
l'utilisateur OBÉIT au signal ».

### Le bump
`CONSOLIDATION_TAG` : `conso-3` → `conso-4`. Les 683 fichiers sont ré-évalués sous les règles
courantes ; 347 ont désormais une cible. Marc a choisi « lance direct » plutôt que de relire le plan :
`CONSOLIDATION_EXEC_ACTIF` reste à `true`, déplacement seul, aucune suppression (§2).

### Ce qui a failli passer, et que seule la vérification a arrêté
`STRUCTURE_CIBLE_RESET` écrivait `Lycée Thérèse d'Avila` ; le dossier RÉEL de Marc s'appelle
`lycée Thérèse d'Avila`, avec un **l minuscule**. `sousDossier_` résout par `getFoldersByName`, qui
est **sensible à la casse** : un second dossier serait né à côté du sien, et 143 fichiers y seraient
partis. C'est exactement « 3987 route des Rivières » à côté de « 3987 rte des Rivières », déjà vécu
en `03`. Un test fige désormais les libellés de la table sur les noms réels relevés dans Drive.

## 9. La structure de `06`, tranchée par Marc (2026-09-13)

Question posée avec les deux structures en conflit ; réponse : **« Mes 5 dossiers d'école »**.
`06/DUT ULCO Saint-Omer`, `06/Prépa Gustave Eiffel (PTSI)`, `06/IMERIR`,
`06/lycée Thérèse d'Avila`, `06/Cégep de Sherbrooke` — ce que sa structure validée disait déjà.
La mission qui les vidait est inversée (§8) ; les archives leur rendent leur contenu.

⚠️ **Un point reste à confirmer, et il est signalé plutôt que tranché tout seul.** Marc a donné
« lycée Thérèse davilla c'est genre 2014 2017 » (le « genre » est de lui). Or deux dossiers qu'il a
nommés lui-même disent autre chose : `Lycée — Thérèse Davila (2017-2018)` et
`Collège & Lycée — divers (2014-2017)`. Si la seconde lecture est la bonne, les ~26 fichiers de
2014-2016 que la fenêtre envoie chez Avila sont en réalité du collège. La fenêtre retenue est celle
que Marc a ÉNONCÉE — c'est sa décision, prise aujourd'hui en réponse à cette question précise — mais
le doute est écrit ici. Conséquence bornée si elle se révèle fausse : 26 fichiers dans le mauvais
dossier d'école, tous à l'intérieur de `06`, récupérables par un bump de règles.

## 10. La revue sécurité du lancement (2026-09-13) — ce qu'elle a bloqué

La revue adversariale passée AVANT le merge a rendu un verdict **🔴 bloquant** sur le lancement.
Trois défauts, tous reproduits sur le code réel, tous corrigés ici. Ils partagent une même forme :
**une garde affichée au plan et absente là où elle compte.**

### 🔴 1 — D8 ne couvrait que deux des chemins « décidés par le seul TYPE »

Le drapeau `faible` n'était posé qu'à deux endroits : le repli `bucketTypeDomaine_` (Router.gs) et
la fenêtre d'école. Or `cheminCibleReset_` porte **ses propres filets par type** —
`Travaux & équipements`, `Contrats`, `Correspondance`, `Véhicule/À attribuer` en `03`,
`Correspondance` en `01` — qui rendaient une cible NON marquée et gagnaient donc contre un rangement
existant. Mesuré par la revue : **16 des 36 fichiers ciblés de `03` (44 %) traversaient D8 sans être
vus**, et la frontière était arbitraire — « Échange de messages » protégé, « Lettre » déplacé.

Correctif : `faibleReset_(detail, chemin)` pose le marqueur **sur la ligne qui décide**, et
`cheminCibleConsolidation_` le RECUEILLE au lieu de le recalculer. Le drapeau ne se re-dérive plus
du chemin rendu (`'Contrats'` ne dit pas QUI a répondu) — c'est la leçon §9 « un verdict pris sur la
donnée RICHE ne se re-dérive jamais depuis sa forme APPAUVRIE », et c'est aussi ce qui corrige, dans
le même geste, la fuite du drapeau « école » sur la branche `Diplômes & relevés officiels` (elle rend
AVANT tout calcul d'école : la DATE décidait d'une garde qui n'a rien à voir avec elle).

**Portée VOLONTAIREMENT bornée à `01`, `03` et `06`.** Les filets par type de `02`, `07`, `08` et
`09` gardent tout leur pouvoir : `conso-3` a déjà passé le Drive entier sous ces règles-là (leur
résultat est convergé), et aucune mission n'y a construit depuis de structure plus fine qu'ils
défairaient. Marquer faible au-delà du risque mesuré ne protège rien et gèle des classements encore
perfectibles.

### 🔴 2 — D8 et D9 n'étaient jamais rejouées au moment du déplacement

`ConsolidationExec` recalculait la CIBLE à l'état courant (garde de 2026-07-21) mais jugeait la
POSITION sur l'instantané du plan : ni D8 ni D9 n'étaient consultées avant le `moveTo`. Les deux
gardes n'existaient donc qu'au dry-run — alors que les missions et le flux tournent dans le MÊME
tick, APRÈS l'exécuteur, et peuvent avoir rangé le fichier plus finement entre-temps.

Correctif : `positionActuelleFichier_` rend le domaine **avec le sous-chemin traversé**, et
`decisionConsolidation_` — la MÊME fonction que le plan, jamais une seconde formule — est rappelée
avant la mutation. Tout ce qui n'est pas `Déplacer` est inscrit `consolidé-sur-place`, sans aucune
écriture Drive. C'est le corollaire EXÉCUTION de §9 (#47 PR2) appliqué à la lettre.

### 🔴 3 — D9 n'avait aucun test

Neutralisée en `if (false && estSousCheminDe_(…))`, la suite restait **entièrement verte**
(1241/1241). Le jsdoc annonçait pourtant « PURE (testée) ». Correctif : tests de `estSousCheminDe_`
(dont le piège `Contrats` ⊄ `Contrats divers`), test de la branche D9 de `decisionConsolidation_`,
tests de D8/D9 **au niveau de la mutation**, et la mention « (testée) » retirée jusqu'à ce qu'elle
soit vraie. Les cinq correctifs de ce lot sont prouvés PAR MUTATION, un par un.

### 🟠 Les quatre autres, corrigés dans le même lot

- **Le rouge « bon pour suppression » n'avait aucun chemin de retour.** Les 4 dossiers d'école
  étaient les `sourcesJetables` de l'ancienne mission : vidés, puis peints en rouge — et rien dans
  le moteur ne retirait jamais cette couleur. L'inversion en fait la structure que Marc a choisie,
  et le rattrapage allait y verser 143 fichiers de plus. `depeindreCiblesRemplies_` rend leur
  couleur par défaut aux dossiers qui ne sont PLUS vides, one-shot par version de règles, au premier
  run de la mission (pas à sa convergence : le signal est trompeur dès maintenant). Sens de l'échec
  inversé par rapport à la peinture : un dossier illisible est dé-peint — peindre à tort invite à
  supprimer, dé-peindre à tort ne coûte qu'une couleur.
- **L'exécuteur pouvait appliquer les lignes de `conso-3` sous la clé `conso-4`.** Il tourne AVANT
  le générateur, et c'est le générateur qui purge le plan périmé : au premier tick du bump, l'onglet
  porte encore l'ancienne campagne. Les `Déplacer` étaient atténués par le recalcul, mais les
  `Doublon` auraient été appliqués sur une comparaison d'empreintes vieille d'un mois. Garde de tag
  en tête d'`appliquerPlanConsolidation_` : un tick d'attente contre une ligne périmée définitive.
- **`<école>/Administratif` partait vers `<école>/Cours & travaux`.** Le vocabulaire des cours,
  remonté devant `Résultats` dans ce lot, contient « fiche » et « cours » en sous-chaîne et passait
  aussi devant `Administratif` — « Fiche d'inscription », « Convention de stage », « Attestation de
  suivi de cours » sont des actes administratifs. L'ordre est corrigé ; mesuré sur les 480 noms de
  `06` du corpus : **zéro document existant ne bascule** (la classe est réelle, le stock ne la
  contient pas).
- **Le corpus de preuve ne contenait pas la population que D9 protège.** Les 2 sous-dossiers
  thématiques de `3325 4e avenue` qui ont du contenu y sont ajoutés : neutraliser D9 fait désormais
  tomber le test de corpus, ce qui n'était pas le cas avant.

### Ce que la revue a vérifié SAIN, par exécution

`04 · Immigration` (aucune sortie possible : `Ignoré` rendu avant tout usage de la cible,
`aParentProtege_` strict re-vérifié avant chaque `moveTo`), §2 (aucune suppression ajoutée ; la
purge du bump est un `clearContent` sur un onglet de RAPPORT), §3 (`appsscript.json` non touché),
§4 (aucun secret), le couple de budgets (12 min/j, prouvé par 3 mutations) et l'inversion de la
mission (aucun site d'appel oublié).

### Vérifié dans Drive, pas déduit

Le libellé `lycée Thérèse d'Avila` de la table et le dossier réel de Marc sont **identiques
octet pour octet** (NFC, apostrophe droite U+0027 — relevé le 13/09 via l'API). Le risque de dossier
jumeau par normalisation Unicode, soulevé en revue, est écarté pour ce libellé.

## 11. La contre-revue (2026-09-13, second tour) — ce que les correctifs avaient laissé ouvert

Les deux agents (sécurité + code) ont re-passé le lot de correctifs. Verdict : les trois 🔴 du
premier tour sont bien fermés — et **deux portes restaient ouvertes, dont une plus large que celles
qu'on venait de fermer**.

### 🔴 Une cible VIDE remontait les fichiers à la RACINE du domaine — l'inverse du mandat

Trouvé en vérifiant le premier tour, confirmé et **chiffré** par la contre-revue. La collecte de
consolidation est RÉCURSIVE sur tout le domaine ; quand aucune règle ne sait placer un document
(`sousCheminCible === ''`), la décision rendait « Déplacer » vers la racine. D9 s'en remettait
explicitement à D8 (« cible VIDE : D8 s'en charge »), et D8 exige `cibleFaible` — que
`sousCheminDomaine_` ne pose pas sur un retour vide. **Personne ne gardait le cas.**

Mesuré sur le corpus réel (475 noms de `06`, placés dans un dossier d'école — ce que
`retour-ecoles06` est précisément en train de faire) :

| position | avant | après |
|---|---:|---:|
| `IMERIR` | **332 remontés à la racine** | **0** |
| `IMERIR/Cours & travaux` | **332** | **0** |

C'est l'exact inverse d'ADR-0052 (« la racine d'un domaine n'est plus une cible de classement »).
Le défaut était PRÉ-EXISTANT, mais ce lot en faisait l'autorité au point de mutation — et, pire,
**un test ajouté au premier tour le figeait en contrat** (`moves === ['DOM']`). Un défaut latent
devenu comportement testé : c'est la leçon §9 « un test qui n'asserte que le blocage VERROUILLE le
bug », vue de l'autre côté. Le constat reste DIT dans la raison du plan (Marc doit pouvoir
trancher) ; c'est le déplacement qui disparaît.

### 🔴 Le « chemin de retour » du rouge ne s'exécutait jamais dans le scénario qui l'a motivé

Le one-shot `m0.dep` était posé au PREMIER run, avant le drainage, et consommé **même quand rien
n'avait été dé-peint**. Or les 4 dossiers d'école sont rouges *parce qu'*ils sont vides : au premier
run ils le sont encore, la passe ne fait rien, le drapeau brûle — puis la mission et le rattrapage
les remplissent, et le rouge « bon pour suppression » reste **à vie** sur des dossiers pleins. Un
chemin de retour qui existe sur le papier et nulle part ailleurs est pire que pas de chemin du tout.
(Effet de bord attrapé en même temps : l'écriture d'état anticipée cassait les compteurs de
progression de la mission — `t` et `b` passaient à `null`.)

Corrigé : la dé-peinture vit maintenant **à la convergence**, quand la mission a fini de verser, et
**avant** le drapeau FINI — après lui, le court-circuit terminal fait qu'aucun run n'atteint plus ce
code. `depeindreCiblesRemplies_` rend la COMPLÉTUDE de sa passe (garde-temps, source illisible,
PATCH refusé) et une passe incomplète **ne conclut pas** : pas de FINI, convergence re-tentée au
run suivant (une passe à vide, quelques RPC).

### 🟠 Le marquage « faible » n'était pas exhaustif dans son propre périmètre

Quatre filets par TYPE de `01` et `06` restaient non marqués — et la preuve la plus nette n'est pas
un chiffre : **le même dossier cible portait un drapeau opposé selon la règle qui avait répondu**.
Marqués depuis, chacun prouvé par sa propre mutation :

- `01 · Attestations & certificats` — fourre-tout par type.
- `01 · État civil & notarial` — la branche par TYPE seulement ; l'ÉMETTEUR notarial reste FORT. Le
  drapeau qualifie **la règle**, jamais la destination : deux `return` plutôt qu'un.
- `01 · Pièces d'identité/Marc` quand l'émetteur est une autorité ou absent — le titulaire est alors
  **déduit**, pas lu. Sans le drapeau, un passeport rangé sous `Pièces d'identité/Autres/<proche>`
  partait dans le dossier de Marc dès que le nom ne portait pas le prénom.
- `06 · Diplômes & relevés officiels` — arbitrage : ce nœud centralise très bien depuis la RACINE
  (où sont les 683), mais le laisser fort lui donnait le pouvoir de VIDER les dossiers d'école que
  Marc vient de désigner comme sa structure et que `retour-ecoles06` remplit dans le même tick. Une
  campagne ne défait pas ce qu'une autre construit.

### Correction d'un motif écrit au premier tour

Le §10 justifiait le bornage à `01`/`03`/`06` par « `conso-3` a déjà passé le Drive entier sous ces
règles-là » et « aucune mission n'y a construit de structure plus fine ». **Les deux moitiés sont
fausses** : la clé de convergence est `conso|<tag>|<fileId>`, donc un nouveau tag re-collecte tout ;
et `paies`, `impots` et `annees02` construisent dans `02`. La DÉCISION de bornage reste la même —
le repli par ANNÉE de `02` est un vrai signal, pas un aveu d'ignorance, et D9 protège déjà le cas
dominant (`Revenus & paie/<Employeur>` est un ancêtre de sa propre cible) — mais son motif est
réécrit ici plutôt que laissé faux.

### Vérifié plutôt que déduit

- Les 4 marquages neufs, la cible vide et la complétude de la dé-peinture : **prouvés par mutation,
  un par un**.
- `SEED_ENTITES` porte `Lycée Thérèse d'Avila` (majuscule) là où la table porte le nom réel du
  dossier, en minuscule. Mesuré : pour les trois formes de nom qui pourraient déclencher la règle
  par entité, **la table répond d'abord et rend la graphie minuscule** — le référentiel est
  inatteignable ici, aucun dossier jumeau possible. Le seed est par ailleurs one-shot et déjà
  appliqué : changer la constante n'aurait aucun effet en production.
- Recherche Drive exhaustive sur « Thérèse » : deux dossiers, le dossier d'école (minuscule) et
  l'archive. Aucun jumeau existant.
