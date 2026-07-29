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
6. **Après-coup** : les squelettes VIDÉS sont recensés `vide-candidat` (corbeille par l'APP au clic,
   ADR-0014, récupérable 30 j — jamais le moteur). Les dossiers-système restent intouchés
   (`00 ·`, `_…`, dossiers « DriveAI… »/« Rapports agent… », Sheet/Form/Guide).

## Exécution & bornes

- Patron « campagne bornée reprenable » (collecte lecture seule → mutation par lots, garde-temps,
  plafond/run, budget QUOTIDIEN en ms, tag de convergence « passe qui ne collecte plus rien »).
- **Fonctions UN-CLIC** pour Marc (exécution manuelle éditeur = hors quota ~90 min/j des
  déclencheurs) ; sinon le tick avance seul (étalé). Garde multi-parents/zone protégée réutilisée
  (`aParentProtege_` strict avant CHAQUE mutation).
- Découpage : **PR1** = ADR + structure + routage PURS + tests (aucun I/O, aucun garde touché) ;
  **PR2** = campagnes I/O (rassemblement, dédup, placement, 04 interne + révision §2.1b + tripwires,
  vide-candidats, rapport) ; **PR3** (si utile) = passe LLM du reliquat + affinages de table.

## Garde-fous (§2)

Aucune suppression nulle part (déplacements seuls) ; multi-parents jamais détachés ; provenance
enregistrée pour tout fichier déplacé ; 04 : intra seulement, sortie = proposition ; l'intake vivant
et Gmail continuent de tourner (le reset est une étape SECONDAIRE enveloppée) ; budget LLM ≈ 0 pour
le placement (par nom), reliquat borné par le frein campagnes.
