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
