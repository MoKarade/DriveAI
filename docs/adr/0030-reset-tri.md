# ADR-0030 — RESET complet : rassemblement `_TRI 2026`, dédup par contenu, nouvelle structure ≤ 7

- **Statut** : accepté (décision Marc 2026-07-29 — « déplacer littéralement tous mes fichiers dans un
  nouveau dossier TRI, doublons dans un dossier doublon, refaire une structure propre, max 7 partout »)
- **Décideur** : Marc, en connaissance de cause (coût et mécanique expliqués, y compris l'alternative
  « nettoyage des dossiers seuls » — il choisit le reset complet). Structure cible **amendée puis
  validée par Marc le 2026-07-29** (« le reste a l'air ok mais change ce que je te demande »).
- **Révise** : ADR-0023 (taxonomie à plat — remplacée par la structure cible ci-dessous) ;
  **CLAUDE.md §2.1(b)** (zone 04 : la réorganisation INTERNE devient permise — voir « Garde-fous »).
- Conçu directement par Claude (règle NotebookLM abrogée le 2026-07-28, PR #222).

## Constats d'inventaire (2026-07-29, 12 agents, lecture seule, 365 noms échantillonnés)

1. **97 % des noms sont conformes** `AAAA[-MM[-JJ]]_Type_Émetteur.ext` (355/365) → le re-classement
   se fait **par le NOM, quasi sans LLM**. Les ~3 % restants sont surtout des Google Docs vivants.
2. **Les fichiers vivent À PLAT aux racines des domaines** ; les ~290 sous-dossiers N1 recensés sont
   majoritairement des squelettes VIDES (01 : 28 N1, 02 : 65, 06 : > 99, 09 : 17) avec des doublons
   de graphie massifs (Desjardins ×5, IRCC ×4, VR ×3, Eckerö ×2, Correspondance(s) ×2…).
3. **Les vrais doublons sont souvent des QUASI-doublons** (même nom, tailles différentes — scans ou
   téléchargements distincts) : l'empreinte MD5 n'attrape que les copies EXACTES.
4. Les empreintes MD5 existent déjà en masse : `PlanConsolidation` col C = fileId / col G = empreinte
   (campagne conso-2 active depuis le 07-17) ; l'Index porte l'empreinte col G sans mapping direct.

## Décisions

1. **Rassemblement** : tous les FICHIERS des domaines 01→09 (04 EXCLU — traité en interne, cf. 4)
   sont déplacés récursivement vers **`_TRI 2026`** (préfixe `_` = invisible des scans ; JAMAIS
   `00 · À trier`, sinon l'intake vivant re-analyserait tout au LLM). **La provenance de chaque
   fichier est enregistrée** dans l'Index sous la clé de campagne `tri33|<fileId>` (chemin d'origine
   en métadonnée — rien n'est perdu, ADR-0007 respecté : jamais de contenu).
2. **Dédup en chemin** : empreinte identique (réutilisation PlanConsolidation/Index, hash sinon,
   borné `OCR_TAILLE_MAX`) → `_Doublons` (déplacement seul, §2). Même nom normalisé mais contenu
   différent → **rapport « doublons probables »**, tranché par Marc, jamais déplacé d'office.
3. **Placement PAR LE NOM** *(y compris pour l'identité : une pièce d'une personne INCONNUE n'est
   JAMAIS devinée chez Marc — elle reste en `_TRI` au rapport)* : `cheminCibleReset_(domaineOrigine, nom)` (PURE, table
   `STRUCTURE_CIBLE_RESET` + routage par type/émetteur normalisés) place chaque fichier conforme dans
   la nouvelle structure — zéro LLM. **Non routé ⇒ le fichier RESTE dans `_TRI 2026`** (visible,
   compté au rapport ; la table s'affine puis on repasse — convergence : `_TRI` se draine vers le
   seul reliquat LLM/décision-Marc). Reliquat : petite passe LLM bornée (patron migration,
   `ignorerDoublon`, frein §2.6).
4. **Zone 04 · Immigration — règle RÉVISÉE (ordre explicite de Marc : « change la règle pour pouvoir
   le toucher »)** : la réorganisation **INTERNE à 04** devient permise (fusion des IRCC ×4, nouvelle
   structure ≤ 7). Restent NON négociables : un fichier sous 04 n'est **JAMAIS sorti de 04
   automatiquement** (un candidat à la sortie — ex. les docs « CIC » qui sont peut-être la banque —
   est PROPOSÉ à Marc, jamais déplacé d'office), jamais supprimé, jamais mis dans `_TRI`. La cible de
   chaque déplacement intra-04 est VÉRIFIÉE descendante de 04 (échec fermé). Livraison ATOMIQUE :
   cette révision, le code, le tripwire bidirectionnel (intra-04 permis / sortie interdite) et la
   revue flotte partent dans la MÊME PR (leçon §7 « promesse de verrou = verrou codé »).
   **La révision de CLAUDE.md §2.1(b) ne prend effet qu'à la PR2** — tant que code + tripwire ne
   sont pas mergés, la règle actuelle (zone 04 intouchable) reste en vigueur telle quelle.
5. **Structure cible ≤ 7 par niveau, récursif** *(exemption EXPLICITE : le niveau RACINE — les 9
   domaines 01→09, préexistants et validés par Marc avec la structure — n'est pas compté ; la
   contrainte porte sur l'intérieur des domaines)* — TABLE UNIQUE `STRUCTURE_CIBLE_RESET` (Reset.gs),
   verrouillée par un test qui DÉRIVE la contrainte de la table (aucun niveau > 7). Émetteur dans le
   NOM, dossiers par TYPE, années seulement où le volume l'exige. Amendements Marc intégrés :
   - 01 : `Pièces d'identité/Marc` + `Pièces d'identité/Autres/<personne>` ;
   - 03 : logement « **3325 4e Avenue (LCP Groupe Immobilier)** » ajouté ; fichiers à PLAT dans
     chaque logement (les squelettes de schéma ne sont plus pré-créés) ;
   - 05 : Employeurs = **Robovic · Automatech SEULS** (le reste = recherche d'emploi) ;
   - 06 : structure PAR ÉCOLE — Lycée Thérèse d'Avila · Prépa Gustave Eiffel (PTSI) · DUT ULCO
     Saint-Omer · Cégep de Sherbrooke · IMERIR · Autres établissements — chacune avec ses
     sous-dossiers, + `Diplômes & relevés officiels` transverse ;
   - 07 : validé tel quel ; 04 : structure proposée (IRCC fédéral / MIFI / Permis & EIMT / RP /
     Formulaires & correspondance).
   - **Amendement 2026-07-30 (t3), décidé sur le RELIQUAT RÉEL** (onglet `Reset` : 134 non routés —
     le diagnostic n'était pas « règles manquantes » mais « dossiers manquants ») :
     **02** → **`Revenus & paie`** (10 bulletins de paie bloqués), en REMPLACEMENT de
     `Donations & successions` — 02 était plein à 7/7 et ce nœud n'avait JAMAIS été créé par le
     reset, donc aucun dossier rempli n'est touché ; les donations partent au versant fiscal
     (`Impôts & déclarations`), leur versant notarial étant déjà couvert par `01`.
     **03** → **`Contrats`** + **`Correspondance`** (34 fichiers bloqués ; 03 passe à 6 nœuds),
     filets placés EN DERNIER dans le routage pour ne rien voler aux règles par entité.
     *Conséquence à connaître : les bulletins déjà classés sous `05/Employeurs/*` y RESTENT (le
     reset est intra-domaine par construction) — la paie est donc split 02/05, assumé.*
6. **Après-coup** : les squelettes VIDÉS sont recensés `vide-candidat` (corbeille par l'APP au clic,
   ADR-0014, récupérable 30 j — jamais le moteur). Les dossiers-système restent intouchés
   (`00 ·`, `_…`, dossiers « DriveAI… »/« Rapports agent… », Sheet/Form/Guide).

## Transition — une seule règle de cible à la fois (arbitrage revue PR1, prend effet à la PR2)

Le reset introduit une DEUXIÈME règle de cible (`cheminCibleReset_` + table) à côté de celle du flux
vivant (routage topologique ADR-0028 : `Entités.Dossier ID`) et de la consolidation. Sans arbitrage,
le flux re-remplirait À PLAT les racines que la campagne vide (non-convergence structurelle — leçon
§7 C28-26 : « campagne ⇒ MÊME fonction de cible que le flux, sinon boucle »). Décisions :

1. **Pendant le reset, les campagnes concurrentes sont SUSPENDUES** : conso-2
   (`CONSOLIDATION_ACTIF`/`EXEC`) et la réorg auto C28-32 ne tournent pas tant que le reset n'est
   pas convergé (flag persisté, ré-armées automatiquement à la fin — jamais un état terminal, leçon
   C28-32). Une seule main déplace à la fois.
2. **Le flux vivant ne s'arrête JAMAIS** (garde-fou §2.6 : intake Gmail + dépôts continuent). Il
   classe via ADR-0028 ; au PLACEMENT de chaque entité par le reset, son `Entités.Dossier ID` est
   **RE-POINTÉ vers le nouveau dossier** — dès lors le résolveur `dossierEntiteParId_` sert la
   nouvelle structure : les deux règles CONVERGENT vers les mêmes cibles au lieu de se défaire.
3. **Après convergence** : la table du reset reste la référence de STRUCTURE ; le flux vivant place
   par entité (Dossier ID re-pointés) ; un balayage périodique par nom (`cheminCibleReset_`, PURE,
   quasi gratuit) rattrape ce qui atterrit à plat aux racines — même fonction de cible, deux
   consommateurs, verrouillés par un tripwire « la sortie du flux est OK pour le reset ».

## Affinage de la table après coup (PR3, #227)

Le routage vit dans une TABLE de règles (`STRUCTURE_CIBLE_RESET` + `cheminCibleReset_`) qu'on affine
au vu du reliquat réel. Or la clé d'idempotence du placement est posée **même sur un NON ROUTÉ** (pour
ne pas le re-hasher à chaque run) : elle mémorise donc un **échec de RÈGLE**, révisable — pas un
succès. D'où `CONFIG.RESET_TABLE_VERSION`, présente dans :

1. la **clé par fichier** (`tri33p|<tag>|<version>|<fileId>`) ;
2. le **drapeau de FIN DE PHASE** du placement (`DriveAI_RESET_PLACEMENT` = `<tag>|<version>`) — sans
   quoi, une fois la phase convergée, le garde de fin court-circuiterait tout avant même que les clés
   par fichier ne soient construites : le mécanisme serait mort en silence (trouvé en revue #227) ;
3. les **clés du rapport** `Reset` (`nonroute|<version>|…`, `quasidoublon|<version>|…`) — chaque
   version produit son instantané HONNÊTE du reliquat, sinon un cas résolu resterait affiché « à
   trancher » à vie.

**Dissymétrie VOULUE** : le rassemblement et 04 n'ont PAS la version (ni dans leurs clés par fichier,
ni dans leur drapeau) — seul le placement dépend de la table. L'y ajouter relancerait un
rassemblement complet, c'est-à-dire renverrait tout le Drive dans `_TRI`.

**Portée exacte, à ne pas sur-vendre** : un bump ne re-présente que ce qui est PHYSIQUEMENT dans
`_TRI 2026` (garantie « jamais re-déplacer le rangé », verrouillée par test). Conséquence : une règle
**corrigée** ne s'applique donc jamais rétroactivement aux fichiers déjà placés par l'ancienne règle
— seules les règles **additives** (qui rattrapent des `null`) ont un effet rétroactif complet.

**Effet de bord assumé** : `resetTermine_()` repasse à faux sur un bump ⇒ conso-2, réorg auto,
historique Gmail et réconciliation Index sont RE-SUSPENDUS le temps de la re-convergence
(« une seule main déplace à la fois »). C'est le prix, court, d'un affinage.

## Exécution & bornes

- Patron « campagne bornée reprenable » (collecte lecture seule → mutation par lots, garde-temps,
  plafond/run, budget QUOTIDIEN en ms, tag de convergence « passe qui ne collecte plus rien »).
- **Fonctions UN-CLIC** pour Marc (exécution manuelle éditeur = hors quota ~90 min/j des
  déclencheurs) ; sinon le tick avance seul (étalé). Garde multi-parents/zone protégée réutilisée
  (`aParentProtege_` strict avant CHAQUE mutation).
  **Corollaire tiré du 1ᵉʳ run réel (2026-07-29)** : « hors quota » doit être VRAI dans le code, pas
  seulement dans l'intention. Les budgets QUOTIDIENS (`RESET_*_BUDGET_JOUR_MS`) ne s'appliquent qu'au
  TICK ; l'un-clic porte un drapeau `manuel` et n'est ni gaté ni compté (seul le mur des 6 min de son
  exécution le borne). Sans ça : Marc bloqué jusqu'au lendemain après quelques relances, ET son run
  manuel consommait le budget du tick — le manuel affamait l'auto.
- Découpage : **PR1** = ADR + structure + routage PURS + tests (aucun I/O, aucun garde touché) ;
  **PR2** = campagnes I/O (rassemblement, dédup, placement, 04 interne + révision §2.1b + tripwires,
  suspension/ré-armement conso-2 + réorg auto, re-pointage `Dossier ID`, vide-candidats, rapport) —
  toute fonction appelée EN TRAVERS des modules s'ajoute au contrat `test/surface-moteur.test.js` ;
  **PR3** (si utile) = passe LLM du reliquat + affinages de table.

## Garde-fous (§2)

Aucune suppression nulle part (déplacements seuls) ; multi-parents jamais détachés ; provenance
enregistrée pour tout fichier déplacé ; 04 : intra seulement, sortie = proposition ; l'intake vivant
et Gmail continuent de tourner (le reset est une étape SECONDAIRE enveloppée) ; budget LLM ≈ 0 pour
le placement (par nom), reliquat borné par le frein campagnes.
