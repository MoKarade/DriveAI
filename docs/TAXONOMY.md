# Taxonomie cible — DriveAI

> Source de vérité de l'arborescence Drive. `structure-keeper` veille à ce que le code de
> routage reste cohérent avec ce document. Les IDs alimenteront `Config.gs` (Phase 1).

## ⚠️ STRUCTURE CIBLE 2026 (ADR-0030, chantier C28-33) — lis ceci en premier

**Depuis le 2026-07-29, la source de vérité de l'ARBORESCENCE est la table
`STRUCTURE_CIBLE_RESET` (`src/Reset.gs`)**, validée dossier par dossier par Marc, avec la contrainte
NON négociable **≤ 7 sous-dossiers par niveau, récursif** (ADR-0027). La campagne de reset tourne en
production et range dedans. **Tout ce qui suit cette section décrit la taxonomie À PLAT d'ADR-0023 —
qu'ADR-0030 RÉVISE explicitement.** Elle ne décrit donc plus que l'héritage en cours de drainage :
en particulier, la règle « un document se classe à la racine de son domaine, dossier-catégorie
INTERDIT » **ne vaut plus** — la prod range désormais dans `Relevés/`, `Reçus & factures/`,
`Attestations & certificats/`, `Contrats/`… **ADR-0052 (2026-09-13) achève ce basculement** : la
racine d'un domaine n'est plus une cible de classement du tout, et la section « Granularité »
plus bas décrit la cascade de replis à jour, pas l'héritage.

| Domaine | Sous-dossiers cibles (niveau 1) | Places restantes |
|---------|--------------------------------|------------------|
| `01 · Administratif & identité` | Pièces d'identité · État civil & notarial · Attestations & certificats · Correspondance · Contrats & fournisseurs · Sécurité & codes | 1 |
| `02 · Finances` | Banques · Relevés · Reçus & factures · Impôts & déclarations · Assurances & prévoyance · Placements & crypto · **Revenus & paie** | **0 — PLEIN** |
| `03 · Logement & véhicule` | **Logement** (5 adresses aux noms RÉELS Drive) · **Véhicule** (Toyota bZ · Ford Fiesta · VW Jetta, chacun avec {Contraventions · Assurance auto · Entretien & réparations · Recherche & achat}) **+ 3 dossiers COMMUNS au même niveau que les véhicules — `Recherche & achat` (magasinage sans véhicule identifié, dont l'ex-« KIA »), `Locations` (voiture louée, jamais un véhicule de Marc) et `À attribuer` (aucun véhicule identifiable — ADR-0044)** · Énergie & services · Assurance habitation · Contrats (les formulaires génériques/vierges y sont depuis ADR-0052 D7) · Correspondance · **Travaux & équipements** 🆕 *(ce qu'il y a DANS le logement : étiquettes produit, matériaux, revêtements, inventaires, dégradations — ADR-0052 D7, qui RÉVISE ADR-0044 §6)* | 0 — PLEIN |
| `04 · Immigration` | IRCC (fédéral) · MIFI (Québec) · Permis de travail & EIMT · Résidence permanente · Formulaires & correspondance · **Pièces d'identité** 🆕 *(ADR-0052)* | 1 |
| `05 · Carrière` | **Employeurs** (Robovic · Automatech · **Autres employeurs** — commun des employeurs occasionnels, ADR-0044 D11) · Alternance & stages · CV & lettres (+ Candidatures · Suivi · Archive 2021-2025) · **Recherche d'emploi** (recrutement reçu : offres, invitations d'entretien, descriptions de rôle, listes d'entreprises cibles — **RECRÉÉ par ADR-0044 D10, qui révoque la fusion du 2026-08-17 vers « CV & lettres »**) · Entreprise — MRic (SCI) · Formation & bilans · Réseaux & présentations | 0 — PLEIN |
| `06 · Études & diplômes` | **Archives scolaires** *(le dossier de MARC : ses 7 dossiers de parcours, dont `CEGEP - Sherbrooke (2020)` — ADR-0055, libellé ADR-0060)* · Autres établissements · Diplômes & relevés officiels | 4 |
| `07 · Santé` | Médecins & consultations · Hôpitaux & centres · Assurances santé · Factures & reçus · Examens & résultats · Médecine scolaire & travail | 1 |
| `08 · Perso & projets` | Projets · Écrits & rédactions · Schémas & technique · Photos & loisirs · Notes · Données & exports | 1 |
| `09 · Voyages` | Réservations & billets · Par voyage · Assurances voyage · **Préparation & guides** 🆕 *(ADR-0052)* | 3 |

> **`06 · Études & diplômes` — où vont les écoles** (ADR-0055, révisé ADR-0056 et ADR-0060 ; demande de
> Marc 2026-09-14 : « j'ai la bonne structure pour les écoles déjà, continue à rajouter là-dedans au
> lieu de mettre à la racine du projet »). Les écoles ne sont PLUS à la racine du domaine : ce sont les
> enfants d'`Archives scolaires`, aux noms de Marc relevés dans Drive — `Collège & Lycée — divers
> (2014-2018)` (fusion ADR-0056 de ses deux dossiers collège/lycée), `Lycée — Gustave Eiffel —
> Physique-Chimie (TP)`, `Prépa PTSI (2017-2018)`, `ULCO — DUT GIM (2018-2020)`, `CEGEP - Sherbrooke
> (2020)` (ADR-0060 : le dossier que Marc utilise, visé par ID, déclaré `{}` donc À PLAT ; le « (2020) »
> est le nom du dossier, la fenêtre de documents reste 2019), `IMERIR — Ingénieur MSIR (2020-2023)`,
> `Online course — AI Essentials (Google)` (règle `ai essentials`, créé au premier document, à plat).
> **7 enfants ≤ 7 : plus d'exemption pour ce niveau** ; seule `IMERIR — …` (16 enfants : les 12
> thématiques de Marc + les 4 standard) reste dans `RESET_EXEMPTIONS_PLAFOND`, déclarée et testée à la
> valeur près. Ces thématiques sont DÉCLARÉES exprès : aucune règle ne route vers elles, mais les
> déclarer les retire de la liste « dossiers vides » de l'app et les rend immuables pour la réorg.
> ⚠️ Drive porte AUSSI deux dossiers vides hors table (`Cégep de Sherbrooke (2019)`, créé à vide par le
> moteur ; `Lycée — Thérèse Davila (2017-2018)`, source drainée par la fusion) : rien ne les recrée,
> et rien ne les propose à la corbeille — Marc les retire à la main, APRÈS avoir vérifié que l'entité
> `Cégep De Sherbrooke` de l'onglet `Entités` porte l'ID de `CEGEP - Sherbrooke (2020)` (ADR-0060).
> ⚠️ Le ≤ 7 porte sur la TABLE, jamais sur le Drive : si Marc ajoute un dossier dans les siens, le
> dépassement réel reste invisible de la CI.
> ⚠️ **D10** (`estDansStructureMarc_`) : un fichier déjà sous `Archives scolaires/<école>` ne se
> déplace plus que vers un descendant STRICT de sa position. Ni D8 ni D9 ne mordaient entre deux
> frères de même profondeur, et une école nommée est un signal FORT : sans D10, la campagne vidait
> `…/IMERIR — …/MFE` dans `…/Cours & travaux`.
> `Autres établissements` et `Diplômes & relevés officiels` restent à la RACINE de `06` : ce sont
> des nœuds de taxonomie, pas des établissements.
>
> **Comment une école est attribuée** (ADR-0052 D6, décisions Marc 2026-09-13). Du FAIT vers la DÉDUCTION, jamais l'inverse : (1) le NOM de l'école ; (2) un marqueur
> de FILIÈRE ou de NIVEAU écrit dans le nom (« GIM », « 1ʳᵉ année » — les seuls dont la revue a
> MESURÉ une contribution non nulle) ; (3) la FENÊTRE de
> scolarité (`RESET_FENETRES_ECOLE`, bornée au MOIS à la convention sept → août), qui refuse dès
> qu'il y a deux fenêtres ou aucune. Le parcours validé par Marc : Avila 2014-2017,
> Prépa 2017-2018, ULCO 2018-2020, **Cégep de Sherbrooke 2019 — EN MÊME TEMPS que l'ULCO** (le dossier, lui, s'appelle `CEGEP - Sherbrooke (2020)` : la fenêtre borne des documents, pas le nom),
> IMERIR 2020-2023. ⚠️ Marc a dit « Avila c'est genre 2014 2017 », et son propre dossier
> s'appelle `Lycée — Thérèse Davila (2017-2018)` : les deux ne peuvent pas être vrais en même
> temps. La FENÊTRE (sa phrase) fait foi et n'a pas bougé — question ouverte depuis C28-90,
> ~26 fichiers en jeu, tous dans `06`, récupérables.
> ⚠️ La fenêtre de Sherbrooke ne sert pas à placer : elle sert à **empêcher** de placer. Un document
> de 2019 tombe dans deux fenêtres et reste non attribué, au lieu de partir chez l'ULCO avec une clé
> de succès — c'est-à-dire sans retour possible. Sa borne (l'année civile) est la seule qui ne suive
> PAS la convention sept → août, et c'est délibéré : Marc a dit « 2019 », le dossier réel contient
> des fichiers de 2018 à 2025.
> ⚠️ Elle ne suffit pas seule : un **veto collégial** (`vetoCollegialReset_` — « cégep », « collégial »,
> « Omnivox », « MIO », « SRAM », « centre de services scolaire ») refuse toute déduction par date
> quand le nom revendique un établissement québécois que la table n'a pas su résoudre. Sans lui,
> 5 documents du corpus partaient chez l'ULCO ou l'IMERIR — le mode de panne que la fenêtre devait
> éviter, décalé de trois mois.
> ⚠️ Enfin, une école DÉDUITE d'une fenêtre est un signal **faible** : elle sort un fichier de la
> racine, elle ne le retire jamais d'un dossier d'école existant.
> Même idiome que les fenêtres d'occupation des logements (`fenetresOccupation_`, ADR-0040) : une
> table que Marc a validée, pas une inférence du moteur.

**`02 · Finances` est PLEIN (7/7)** : toute règle future y exige un **regroupement**, jamais un
nouveau nœud. *(Note : le flux vivant y crée aussi `02 · Finances/AAAA` — `DOMAINES_PAR_ANNEE`,
`Config.gs` — nœud absent de la table ; exemption connue, voir BACKLOG C28-36.)*

**Enfants DYNAMIQUES hors table (C28-49 PR2, ADR-0039 §7)** — trois familles exemptées du
validateur ≤ 7 (`verifierStructureCibleReset_`) : `Pièces d'identité/Autres/<personne>` (bornée
par `RESET_PERSONNES_AUTRES`, testée ≤ 7), `Revenus & paie/<Employeur>` (bornée par
`CONFIG.MISSIONS_EMPLOYEURS`, testée ≤ 7) et `Impôts & déclarations/<AAAA>` (années réelles,
> 7 ASSUMÉ). **Les buckets d'ANNÉE eux-mêmes sont la quatrième famille** et n'étaient pas déclarés
ici : `Relevés/AAAA`, `Reçus & factures/AAAA` et `Réservations & billets/AAAA` sont figés dans la
table à 7, 4 et 4 entrées, mais `resetBucketAnnee_` crée le dossier de toute année POSTÉRIEURE au
dernier bucket (sans quoi un relevé de 2027 partirait dans `Archives`, ce qui serait faux). En 2027,
`Relevés` aura donc 8 enfants réels là où le validateur en comptera 7. Dépassement ASSUMÉ et
documenté (ADR-0033 §6 : une fenêtre glissante avec purge reste l'évolution possible) — mais il doit
être ÉCRIT, sinon la prochaine revue le découvre en prod. ⚠️ Les dossiers-employeurs
sont formellement des « dossiers par émetteur » (interdits par la règle de granularité plus bas) :
**exception voulue et bornée** — table canonique validée par Marc (« un sous-dossier par
employeur »), jamais un dossier au premier émetteur venu.

**~~Fusion « Recherche d'emploi » → « CV & lettres »~~ — RÉVOQUÉE (ADR-0044 D10, décision Marc
2026-08-20).** Marc a demandé de RECRÉER le dossier, averti que les deux ne peuvent pas coexister.
Partage désormais en vigueur : `Recherche d'emploi` = le recrutement **reçu** (offres, invitations
d'entretien, descriptions de rôle, listes d'entreprises cibles, comparatifs de grilles salariales) ;
`CV & lettres` = ce que **Marc a produit ou envoyé** (CV, lettres de motivation, candidatures), avec
ses enfants {Candidatures, Suivi, Archive 2021-2025}.
⚠️ Le geste est **SYMÉTRIQUE ou il ne vaut rien** : nœud re-déclaré dans la table, mission qui cesse
de dissoudre le dossier (plus une source, ni jetable), et FLUX qui route le recrutement vers lui —
le même prédicat pur (`estTypeRecrutement_`) servant les deux consommateurs. Les 3 faces sont
assertées par un seul test ; en retirer une fait échouer la CI (prouvé par mutation).

### Règles d'arbitrage entre domaines (à appliquer en cas de doute)

- **`Contrats` / `Correspondance` existent dans `01` ET dans `03`.** `03` = ce qui concerne le
  logement ou le véhicule mais dont l'entité n'est pas identifiable dans le nom ; `01` = tout le
  reste. Le routage tranche par le **domaine d'ORIGINE** du fichier, jamais par le contenu.
  ⚠️ Asymétrie connue : dans `03`, un `Contrat_<inconnu>` tombe dans le filet `Contrats` ; dans
  `01`, le même nom rend `null` et reste au rapport (aucun filet contrat en 01, seule la liste de
  fournisseurs route).
- **Bulletins de paie : `02 · Finances/Revenus & paie/<Employeur>`** (décisions Marc 2026-07-30
  « logique revenu » puis 2026-08-17 « un sous-dossier par employeur ») — canon UNIQUE
  `employeurDuNom_` (`MISSIONS_EMPLOYEURS`), émetteur hors table → racine `Revenus & paie`.
  *(L'ancien « split assumé » — des bulletins restés sous `05/Employeurs/<employeur>` — n'est
  PLUS vrai : `mission-carriere` (C28-49 PR2) les remonte vers le domicile unique en 02.)*
- **Donations & successions** : versant **fiscal** → `02/Impôts & déclarations` ; versant
  **notarial** (actes) → `01/État civil & notarial`.

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
| → `Logement` *(CIBLE CANONIQUE depuis ADR-0040 — 5 adresses aux noms Drive réels ; plus jamais « en drainage »)* | `13ISBh6ZrwK9YHgmIM20tWTgWh4x9wI79` |
| → `Véhicule` *(CIBLE CANONIQUE depuis ADR-0040 — **3** véhicules × 4 catégories + **3 communs** ; « KIA » retiré du canon par ADR-0044 ; plus jamais « en drainage »)* | `1Hqmg1eV4q28saCreUyrfUIfKLwV972Wc` |
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
> **Pièces d'identité (structure 2026 — ADR-0030, corrigé C28-72)** : rangées **PAR TITULAIRE** sous le
> conteneur `01 · Administratif & identité/Pièces d'identité` → `Marc/` ou `Autres/<personne>`
> (`RESET_PERSONNES_AUTRES`). Le TYPE vit dans le **nom du fichier**
> (`AAAA-MM-JJ_Type_Titulaire.ext`), **jamais** dans un dossier.
> ⚠️ Cette ligne a prescrit « rangées PAR TYPE (`01 · …/Passeport`, `…/Permis de conduire`) » jusqu'au
> 2026-08-20 : c'est la phrase qui légitimait le **nœud parasite**. Un dossier de type au niveau 1 du
> domaine est hors `STRUCTURE_CIBLE_RESET`, donc **invisible de `verifierStructureCibleReset_`** et du
> plafond ≤ 7 — `01 · Administratif/Permis de conduire` a ainsi été créé le 12/08 sans qu'aucun
> validateur ne bronche.
> Quand le titulaire n'est **pas attribuable** (refus voulu de `cheminCibleReset_`, qui rend `null`
> plutôt que de ranger le document d'un proche chez Marc), le fichier est posé **à plat à la racine de
> `Pièces d'identité`** — `repliIdentite_` (Router.gs), règle PARTAGÉE par le flux vivant ET la
> consolidation. Même idiome que `Revenus & paie` ou `Impôts & déclarations` : « je sais quel
> conteneur, pas quelle subdivision ». Pas de dossier « Tiers ».
> Carte de résident permanent → `04 · Immigration/Résidence permanente` ; carte d'assurance maladie →
> `07 · Santé/Assurances santé` — leur repli est leur propre nœud de table.
> ⚠️ **Depuis ADR-0052, `04` a AUSSI un nœud `Pièces d'identité`, et les deux ne se recouvrent pas.**
> `Résidence permanente` reçoit la carte de RP, parce que c'est un document de STATUT et que c'est
> LUI qui fait entrer le document dans `04`. `Pièces d'identité` reçoit les passeports/CNI/permis
> **qui étaient déjà dans `04`** — des copies versées au dossier d'immigration, rangées par la
> réorganisation INTERNE (§1.1b), jamais routées là par le flux. L'ORDRE des deux règles dans
> `cheminCibleReset_` est le garde-fou : la règle de statut passe avant celle d'identité (une carte
> de RP est les deux à la fois, et un test le verrouille).

**Hors domaines** (préfixe `_`, à la racine, triés en tête ; ni domaine ni racine de rangement) :

| Dossier | Rôle |
|---------|------|
| `_Archive 2025` | ancien Drive figé — DriveAI n'y touche jamais (sauf via `RANGEMENT_RACINES_SUP` si configuré) |
| `_Doublons` | doublons NON sensibles écartés (déplacement seul, jamais supprimé) — auto-créé, ID en Script Property `DriveAI_DOUBLONS_ID` |
| `_Technique` 🆕 | fichiers **code/CAO** (par extension `CONFIG.EXT_TECHNIQUES`) et **exports de données bruts** (Facebook/Instagram…, gros HTML/JSON sans émetteur) écartés du classement documentaire (ni OCR ni LLM) — auto-créé, ID en `DriveAI_TECHNIQUE_ID`. **Exception (ADR-0025)** : un export de **correspondance** (`Message_`, `Correspondance_`, `Courriel_`, `Courrier_`, `Conversation_` en `.html`) est classé **par CONTENU au domaine** concerné (pas de dossier « Correspondance » dédié) ; un vrai export social (`messages` pluriel, `message_1.html` numéroté Facebook…) reste ici. `Relevé_` reste hors périmètre (ambigu financier). |
| `_Médias` 🆕 | **médias personnels** (vidéo/audio/gif direct ; photo si nom non-documentaire ET OCR vide — l'OCR reste le juge, ADR-0009 §2) écartés sans LLM, nom d'origine conservé — auto-créé, ID en `DriveAI_MEDIAS_ID` |

> ⚠️ Ces IDs sont des données de configuration, pas des secrets, mais ils ne doivent vivre que
> dans `Config.gs` (Phase 1) et ici. Ne pas les disperser dans le code.

## Granularité : la cascade de replis (ADR-0023 → ADR-0052)

> **ADR-0023 (2026-07-16) révisait** « un dossier par entité + schémas de sous-dossiers » (~499
> dossiers dont ~102 vides pour ~2 880 fichiers — recensement
> `docs/diagnostics/2026-07-16-recensement-drive.md`) en posant « à plat par défaut ».
> **ADR-0052 (2026-09-13) révise le DÉFAUT**, pas le principe : « à plat » avait produit
> 683 fichiers libres aux racines de domaine, dont 475 dans `06`. Le nom porte l'information,
> mais un dossier plein de 475 fichiers ne se parcourt pas.

**Principe** : un document se classe dans le nœud le plus précis que l'on sache justifier, et
**jamais à la racine du domaine** tant qu'un nœud existant peut l'accueillir. La **RÈGLE UNIQUE** de
sous-chemin (`sousCheminDomaine_`, Router.gs — partagée par le flux vivant ET la cible de
consolidation) accorde un sous-dossier dans TROIS cas EXCLUSIFS, dans cet ordre
(arbitrage Marc 2026-07-16 « entité OU année », étendu par ADR-0052) :

⚠️ Un troisième cas « **Type d'identité** → dossier de TYPE » figurait ici en tête jusqu'au
2026-08-20. Il a été **retiré du code et de cette règle** (C28-72) : il rendait un nœud de niveau 1
hors `STRUCTURE_CIBLE_RESET`, donc invisible du validateur ≤ 7. L'identité a désormais sa propre
règle partagée, `repliIdentite_`, qui dégrade vers un nœud EXISTANT de la table (cf. la section
« Pièces d'identité » plus haut) — et le paramètre `typeIdentite` a été **supprimé** de
`sousCheminDomaine_`, pas neutralisé : un paramètre qui « ne sert plus » se remet à servir au
premier appelant distrait.

1. **Entité MAJEURE VALIDÉE** au référentiel `Entités` (logement, véhicule, employeur, école —
   **JAMAIS une banque** : `02 · Finances` n'a plus d'entités validées, décision Marc 2026-07-17,
   ADR-0024) — dossier **CRÉÉ au niveau 1** du domaine, **nom canonique du référentiel**, **sans
   année** : une entité = UN dossier (`05 · Carrière/Robovic`, jamais `2026/Robovic`).
   **Son emplacement RÉEL peut être plus profond** (ADR-0028) : Marc — ou un regroupement de la Réorg
   (ADR-0027, « Anciens employeurs ») — peut le déplacer n'importe où **sous son domaine**. Le
   `Dossier ID` du référentiel est alors la **vérité topologique**, le nom n'étant qu'un **repli** :
   le flux vivant ET la consolidation résolvent par ID, à toute profondeur, via le même résolveur
   (`dossierEntiteParId_` — refus si le dossier est corbeillé ou sorti de son domaine). Le routage
   v2 ne consulte QUE les validées (`entitesValideesParCle_`) : une entité que Marc n'a pas validée
   ne crée JAMAIS de dossier (le prompt gate le champ `sousDossier`, le référentiel verrouille).
   Les entités de Marc sont posées par un SEED one-shot (`seedEntitesMarc_`, ADR-0024 : 4 logements,
   3 véhicules, 2 employeurs, 6 écoles) ; l'auto-validation « vue ≥ 3 fois » est COUPÉE
   (`ENTITES_AUTO_VALIDATION: false`) — seuls le seed, le formulaire de correction et l'app valident.
2. **Année** (`AAAA`) pour les domaines à volume (`CONFIG.DOMAINES_PAR_ANNEE` = `02 · Finances`),
   quand aucune entité validée ne s'applique : le tout-venant Finances va dans `02/2026`.

3. **Type de document** (ADR-0052, 2026-09-13 — **RÉVISE le « sinon : racine du domaine »**) :
   `bucketTypeDomaine_` (Reset.gs, PURE) rend un nœud **qui existe déjà** dans
   `STRUCTURE_CIBLE_RESET[domaine]` quand on ne sait ni À QUI ni À QUOI le document se rattache,
   mais qu'on sait encore CE QUE C'EST (« Attestation » → `01/Attestations & certificats`,
   « Reçu » en 09 → `09/Réservations & billets/AAAA`). Elle ne peut pas inventer de dossier
   (verrouillé par test) ni changer de domaine — donc pas davantage faire sortir un fichier de `04`.

Sinon seulement : **racine du domaine** — et c'est désormais un CONSTAT MESURÉ, pas un défaut :
`test/racine-domaine.test.js` rejoue les 683 fichiers qui y étaient réellement au recensement du
2026-09-13 et fige le compte PAR DOMAINE (0 partout, sauf 2 décisions en attente de Marc : `06` et
`03` PLEIN à 7 nœuds ; `06` n'en a plus que 3 depuis ADR-0055 — ADR-0052 D6/D7). Un chiffre qui monte fait échouer la CI.

**Interdits** (les mécanismes du bordel, recensement 2026-07-16) : dossier par émetteur ponctuel,
dossier-catégorie **CRÉÉ À LA VOLÉE** (« Cours », « Devoirs », « Reçus »), « Divers », squelettes de
sous-dossiers d'entité (`SCHEMAS_ENTITE` — plus jamais créés), `SOUS_DOSSIERS_PAR_ANNEE` (mort avec
le chemin v1). ⚠️ La nuance ajoutée par ADR-0052 : ce qui était interdit, c'est de **fabriquer** un
dossier de catégorie au fil des documents — pas de ranger dans un nœud que Marc a validé dans la
structure cible. Le bordel de 2026-07-16 venait de la création, jamais du rangement.

### Limite cognitive : ~7 sous-dossiers par dossier (ADR-0027)

Un dossier ne devrait pas contenir plus de **~7 sous-dossiers** (`REORG_MAX_SOUS_DOSSIERS_IDEAL`) ;
l'alerte ne se déclenche qu'à **9** (`…_TOLERANCE`, « 7 ± 2 »). Le décompte ne porte que sur les
sous-dossiers **REGROUPABLES** : sont exemptés les **années** « AAAA », les **noms de schéma**, les
**types de pièce d'identité** (`Passeport`, `Permis de conduire`, … — tous couverts par
`estSegmentStructurel_`), les racines système `_…` et la zone protégée `04`.

**Le dossier de REGROUPEMENT est un niveau structurel AUTORISÉ** (la seule exception aux « interdits »
ci-dessus), sous conditions strictes :
- il est **parent d'ENTITÉS uniquement** (« Anciens employeurs », « Anciens véhicules ») — **jamais**
  un parent de documents, jamais un dossier-catégorie déguisé ;
- il n'est **JAMAIS une cible de routage** : le flux vivant résout par `Entités.Dossier ID`
  (ADR-0028), il ne crée ni ne cherche un regroupement ;
- il n'est créé **qu'après validation de Marc**, sur proposition de la Réorg ou du chat ;
- on y entre **uniquement par `deplacer`**. `fusionner` est INTERDIT sur un dossier d'entité (il le
  détruit et re-pointerait `Entités.Dossier ID` vers le fourre-tout) — verrou codé dans
  `parserPropositionReorg_` ;
- il **compte lui-même** comme regroupable : un regroupement saturé sera à son tour signalé (règle
  récursive, pas d'échappatoire).

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
   **ADR-0028** : un fichier **déjà dans le dossier de son entité est `OK` à TOUTE PROFONDEUR**
   (égalité de `Dossier ID`, évaluée avant la comparaison textuelle des sous-chemins et après les
   gardes §1) ; et le move **ouvre ce dossier par ID** au lieu de le re-créer à plat — même résolveur
   que le flux vivant, donc décision et exécution ne peuvent pas diverger.
Les dossiers VIDÉS relèvent de la corbeille APP validée (ADR-0014), jamais du moteur.

## Règles structurelles

- **Nouvelle entité** (plus de file de revue, décision Marc 2026-07-01) : le document est **classé au
  niveau du domaine** (règle unique ci-dessus : année, bucket par TYPE, ou racine) et l'entité est **proposée**
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
- **Document transverse** (sans entité validée) → année (02), sinon **bucket par TYPE**
  (`bucketTypeDomaine_`, ADR-0052), sinon seulement la racine du domaine (règle unique).
- **Doublon** (non sensible) : **déplacé** dans `_Doublons` (jamais effacé, jamais en revue — au volume
  du grand rangement, signaler chaque doublon en revue la saturerait). S'applique **aussi** aux doublons
  sensibles (1 exemplaire classé, les autres dans `_Doublons`) — cf. Zone protégée ci-dessous.
- **Réorg IA (#21, Reorg.gs)** : sont **immuables** pour la réorg — les domaines `NN · …` (deplacer/
  renommer/fusionner interdits ; le renommage de domaine appartient au self-healing `NOMS_DOMAINES_TAG`),
  les files `00 ·` (À trier, À vérifier) et les racines `_…`, les **dossiers de catégorie à ID FIXE**
  (`CONFIG.CATEGORIES` : `Logement`/`Véhicule` — depuis **ADR-0040 (C28-51)** ce sont les CIBLES
  CANONIQUES de 03, plus JAMAIS un héritage à drainer/corbeiller ; les 4 catégories PAR VÉHICULE
  {Contraventions · Assurance auto · Entretien & réparations · Recherche & achat} sont
  structurelles au même titre — find-or-créées PAR NOM par le flux et les missions, protégées par
  `estSegmentStructurel_` ; **TOUS les buckets de NIVEAU 1 de `STRUCTURE_CIBLE_RESET`** (ADR-0044
  §6.3 — ils étaient protégés côté Fusion mais PAS côté Réorg, dont l'inventaire est récursif :
  un bucket VIDE est le candidat idéal d'un regroupement LLM, et le flux le recrée par nom) ;
  **le commun des employeurs `Autres employeurs` (ADR-0044 D11, imbriqué
  sous `Employeurs`, donc invisible d'`estAncreStructurelleFusion_`) et les 3 dossiers COMMUNS
  `MISSIONS_VEHICULE_COMMUNS` {Recherche &
  achat · Locations · À attribuer} le sont aussi depuis ADR-0044** — et c'est leur SEULE
  protection : `estAncreStructurelleFusion_` ne consulte que le PREMIER niveau de
  `STRUCTURE_CIBLE_RESET`, or ces nœuds sont imbriqués sous « Véhicule ». Le `SCHEMAS_ENTITE.Véhicule` d'époque v1 est un VOCABULAIRE HÉRITÉ
  distinct, mort sous ANALYSE_V2 — les catégories officielles sont `MISSIONS_CATEGORIES_VEHICULE`),
  les sous-dossiers d'année `AAAA`, les **noms** des sous-dossiers de schéma hérités (plus jamais
  créés depuis ADR-0023 — mais tant qu'ils portent des fichiers, les fusionner/renommer hors app
  casserait le plan de consolidation) et les dossiers de **TYPE DE PIÈCE D'IDENTITÉ** (`Passeport`,
  `Permis de conduire`, … — find-or-créés PAR NOM par le flux ET la consolidation : les muter les
  ferait re-créer au document suivant). Une **année** et un **type d'identité** ne peuvent pas non
  plus être la CIBLE d'un déplacement (`estCibleInterdite_` — sinon `02 · Finances/2026/Robovic`,
  interdit par ADR-0023). `creer` sert aux dossiers STRUCTURELS,
  jamais à inventer une entité (le référentiel `Entités` route par `Dossier ID`). **Fusionner un dossier
  d'entité impose de re-pointer `Entités.Dossier ID`** (contrat C21-06). Zone protégée exclue de
  l'inventaire par remontée d'ancêtres (multi-parents, échec fermé) dès la collecte.
  **Dossier vidé par fusion** : inscrit `vide-candidat` ; sa mise à la **corbeille Drive** (récupérable
  30 j) n'arrive QUE par l'app, au clic de Marc, après re-vérification live (vacuité stricte corbeillés
  inclus, ascendance, racines système ET dossiers à ID fixe refusés) — jamais par le moteur (ADR-0014).
- **Fusion de dossiers en double (chantier #47, ADR-0036 dry-run + ADR-0037 exécution)** — validé par Marc,
  jamais automatique. Exécution `FusionExec.gs` : `moveTo` seul, gaté OFF, §1/04-interne/multi-parents :
  - les **buckets de `STRUCTURE_CIBLE_RESET`**, les segments `estSegmentStructurel_` (année/schéma) et les
    **types d'identité** ne sont JAMAIS une SOURCE de fusion (le reset les recrée PAR NOM → non convergent) :
    ils sont GARDÉS comme cible (`cibleFusion_`), une ancre-source est écartée d'office au plan (dry-run) ET
    **refusée à la mutation** (`estAncreStructurelleFusion_`, PR2) — **SAUF** dé-duplication d'un doublon de
    **MÊME NOM** (le reset find-or-create rend le canonique, aucune recréation) ;
  - la **CIBLE** d'une fusion d'entité est le **nom CANONIQUE**, et fondre un dossier d'entité validée impose
    de **re-pointer `Entités.Dossier ID`** (contrat C21-06) — sinon le flux le recrée. On **ne re-pointe JAMAIS
    une entité vers une cible STRUCTURELLE** (un regroupement/bucket n'est jamais une cible de routage) ;
  - deux entités ne différant que par une **ANNÉE** (véhicule : `Honda Civic 2014` ≠ `2017`) ou un **NOMBRE**
    (campus numéroté, numéro civique) ne se fusionnent pas — cohérent avec `estFusionnableEntite_` (le veto
    `anneesDistinctes_` couvre déjà l'année) ; les autres jetons-communs (IUT, banques) sont des faux
    positifs du radar que Marc tranche LIGNE PAR LIGNE.

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

## ADR-0044 §7 — ce que la décision 7 change dans l'arborescence

- `01 · Administratif & identité/**Contrats & fournisseurs**` accueille **Cleverbridge** :
  **7 nœuds — PLEIN** (EDF · ENGIE · Virgin Plus · Transport scolaire · Filia-MAIF · INO ·
  Cleverbridge). Toute cible du flux doit figurer dans `STRUCTURE_CIBLE_RESET`, sinon
  `verifierStructureCibleReset_` compte un ≤ 7 qui n'est pas celui de la prod.
- `02 · Finances/**Relevés**` n'accueille plus seulement des relevés bancaires : les **budgets et
  tableaux de bord** y vont aussi (décision de Marc), rangés par année comme le reste.
- `02 · Finances/**Reçus & factures**` accueille les **captures d'achats en ligne** (suivi de
  livraison, fiche produit) — une preuve d'achat reste une pièce de dépense.
- `07 · Santé/**Assurances santé**` accueille la **Caisse des Français de l'Étranger**.
- `05 · Carrière/**Entreprise — MRic (SCI)**` accueille les **statuts constitutifs**, quelle que
  soit la graphie de l'entité (MRic, PRIGRIS, « SCI famille Richard » — décision de Marc : une
  seule et même société).
- Les **12 dossiers-années de 02** sont vidés par `mission-annees02`, mais **PAS peints en rouge**
  (`sourcesJetables: []`) : les peindre invitait à les supprimer, et leur disparition empêcherait
  la mission de converger — bloquant à vie la mission `paies` qui en dépend. ⚠️ Il n'existe **aucun
  signal automatique** que ces 12 dossiers sont vides : `detecterDossierVide_` écarte les noms
  `AAAA` par `estSegmentStructurel_`. Marc les verra vides dans Drive, c'est tout.
- ⚠️ L'exemption `02 · Finances/AAAA` créée par le **flux vivant** (`DOMAINES_PAR_ANNEE`,
  BACKLOG C28-36) **survit** à cette décision : vider les dossiers-années ne l'a pas fermée.
