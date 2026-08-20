# ADR-0044 — Affinage des non-appariés : 8 décisions de Marc (2026-08-19)

- **Statut** : accepté (2026-08-19)
- **Contexte** : 141 fichiers « non appariés » bloqués sur 5 missions
- **Complète** : ADR-0039 (missions de curation), ADR-0040 (affinage c49-2)

## 1. Le diagnostic — 141 blocages, 4 causes

Marc : « y'en a beaucoup en attente d'affinage, pose-moi des questions ». Les dossiers SOURCES ont
été lus (jamais un échantillon) avant de poser la moindre question. Les 141 ne sont pas 141 cas
particuliers :

| Mission | Bloqués | Cause réelle observée |
|---|---|---|
| véhicules | 48 | **Le repli par DATE ne pouvait pas fonctionner.** Diagnostic initial (« `KIA` figure dans `MISSIONS_VEHICULES` sans dossier cible ⇒ `fenetresCompletes` faux à vie ») : **nécessaire mais FAUX comme cause suffisante** — voir §4, corrigé le 20/08 sur preuve Drive. |
| logements | 10 | Baux datés sans adresse dans le nom, annexes TAL génériques, et documents d'avant le Québec (Perpignan, Retta Isännöinti/Finlande). |
| contrats 03 | 20 | Formulaires vierges/génériques (4× le même CORPIQ du 2018-10-15, 2× Immeubles MA8, consentements Proprio Expert) + des documents de VOITURE égarés (3× location Enterprise, vente Suprême Auto, carte verte MAIF). |
| dossiers-années 02 | 24 | Les « dossiers-années » ne sont pas fiscaux, ce sont des **fourre-tout d'année** : Virgin Plus, courtage XTB, débit préautorisé Immeubles MA8, Caisse des Français de l'Étranger, tableau de bord budgétaire. La mission ne sait router que le fiscal → refuse tout le reste. |
| employeurs & CV 05 | 39 | **Non encore examiné** — à instruire avant toute règle (le protocole du projet interdit d'inventer des règles sans preuve). |

## 2. Les décisions

1. **Véhicules — thèmes SOUS chaque véhicule.** Confirme le fonctionnement existant
   (`MISSIONS_CATEGORIES_VEHICULE`) : `Ford Fiesta/Entretien & réparations`, etc.
2. **KIA n'est PAS un véhicule** — c'était une recherche d'achat. Retiré de `MISSIONS_VEHICULES`.
   ⚠️ C'est le correctif à plus fort levier : il rend `fenetresCompletes` atteignable et débloque
   l'attribution par DATE pour l'ensemble des documents génériques datés.
3. **Un « Recherche & achat » COMMUN sous « Véhicule »**, au même niveau que les véhicules, pour
   le magasinage qui n'a pas abouti (KIA compris). Le thème par-véhicule reste : véhicule NOMMÉ ⇒
   sous son dossier ; véhicule inconnu ⇒ le commun. Jamais deviné.
4. **Un « Locations » COMMUN sous « Véhicule »** : une voiture louée quelques jours n'est pas un
   véhicule de Marc et ne doit pas polluer Fiesta / Jetta / Toyota bZ.
5. **Époque France/étranger : classée par THÈME comme le reste** — pas de dossier « Anciens ».
   MAIF avec les assurances, ENGIE avec l'énergie, le bail de Perpignan avec les logements.
6. **Formulaires génériques/vierges → « Modèles & formulaires », UN PAR DOMAINE**
   (`03 · …/Modèles & formulaires`, `02 · …/Modèles & formulaires`) : le générique reste près de
   son sujet.
7. **Dossiers-années 02 : chaque non-fiscal part vers son VRAI domaine** (Virgin → télécom,
   XTB → placements, DPA Immeubles MA8 → le logement, CFE → santé). Les dossiers-années se vident
   pour de bon. ⚠️ Contrainte du projet : réutiliser **la même règle de routage que le flux vivant**
   (leçon §7 « une seule règle, deux consommateurs ») — jamais une seconde formule parallèle.
8. ~~Non tranché : les 39 de « employeurs & CV »~~ — **instruits le 20/08**, décisions 9 à 12.

### Les 39 de « employeurs & CV » — 5 familles, 4 décisions (20/08)

Les 3 sources de la mission (`Employeurs/Robovic`, `Employeurs/Automatech`, racine 05) ont été
lues. Les refus viennent de `sousDossierEmployeur_`, qui ne connaît que 4 types (Contrats,
Attestations & lettres, Formulaires, Évaluations), et de `employeurDuNom_` quand l'employeur n'a
pas de dossier.

9. **« Relevé_<employeur> » sans numéro = relevé de PAIE mensuel** → `02 · Revenus & paie/<employeur>`.
   Cause du blocage : `estTypePaieReset_` ne matche que `paie|paye|salaire` et
   `estFeuilletFiscalReset_` est ANCRÉ sur le nombre (`relevé 1|31`) — « Relevé » seul ne matchait
   rien. La cadence MENSUELLE des fichiers (2023-04, 05, 07, 08 ; 2025-01) confirme la décision de
   Marc : un RL-1 serait annuel. ⚠️ Élargir `estTypePaieReset_` à « relevé » nu serait DANGEREUX
   (un relevé bancaire n'est pas une paie) : la règle doit exiger un EMPLOYEUR connu, ce que le
   routeur carrière garantit déjà (`if (!employeur) return null` en amont).
10. **Recrutement → dossier « Recherche d'emploi » RECRÉÉ sous 05** (offres d'emploi, invitations
    d'entretien, descriptions de rôle, listes d'entreprises cibles, comparatifs de grilles).
    ⚠️ **Conséquence à livrer dans le MÊME geste** : la mission `carriere` dissout aujourd'hui
    `Recherche d'emploi` vers `CV & lettres` (`IDS.rechercheEmploi` en source, `sourcesJetables`).
    Garder les deux, c'est un PING-PONG garanti — la fusion doit être retirée. Marc a été averti du
    conflit et a confirmé son choix.
11. **Employeur sans dossier → « Autres employeurs » commun** (Algopaie, Silver Crest,
    Trajectoire-Emploi, Lilly France, Grant Thornton…), plutôt qu'un dossier par nom à un seul
    fichier. Les PAIES continuent de partir en 02 quel que soit l'employeur (décision 9 + le
    domicile unique des paies).
12. **Documentation MÉTIER → `_Technique`** (bon de livraison SEW-EURODRIVE, rapport de maintenance
    d'un robot convoyeur, plaque signalétique Rockwell, supports de cours, évaluation de
    performance 2016) : ce n'est pas de l'administratif de carrière.

**Restent hors périmètre, volontairement** : 3 fichiers `.p7s` « Contrat_Me Justine Basilio »
(1 448 octets — des signatures cryptographiques, pas des documents), à traiter avec la mission
`_Technique`/`_Doublons` ; et tout ce qui toucherait `04 · Immigration`, jamais déplacé
automatiquement (§2).

## 3. Conséquences

- Toute règle modifiée ici **exige un bump de `MISSIONS_REGLES_VERSION`** (`c49-2` → `c49-3`) :
  les refus sont keyés sous la version, sinon l'affinage reste sans effet (leçon C28-33, « un
  verdict NÉGATIF est révisable — la version de la table fait partie de l'état »).
- Le bump est sûr : la collecte ne re-présente que le reliquat des dossiers SOURCES ; le déjà-rangé
  n'y est plus, donc rien ne sera re-déplacé.
- Décision 7 fait SORTIR des documents de `02 · Finances` : c'est un mouvement inter-domaines,
  assumé et demandé. Les gardes §2 (zone protégée `04`, aucune suppression) restent entières.
- Découpage : **PR1** (livrée) = décisions 2/3/4 + bump ; **PR2** = décisions 9/10/11/12 (les 39 de
  05 — dont le RETRAIT de la fusion `Recherche d'emploi` → `CV & lettres`, indissociable de la
  décision 10) ; **PR3** = décision 6 (Modèles & formulaires) ; **PR4** = décision 7 (dossiers-années).
- Chaque PR qui touche une règle **bumpe à nouveau** `MISSIONS_REGLES_VERSION` : sans cela son
  affinage reste sans effet sur les refus déjà keyés.


## 4. Correction du diagnostic « véhicules » et décision de Marc du 2026-08-20

> Cette section **révise** la ligne « véhicules » du §1 et les décisions 2/3/4. Elle est écrite
> après la revue flotte de la PR1 (structure-keeper + code-reviewer, convergents) et une
> **vérification directe dans le Drive**, qui a démenti la cause annoncée.

### 4.1 Ce que le Drive dit vraiment (lu le 2026-08-20)

| Dossier | Contenu réel |
|---|---|
| `Véhicule/Ford Fiesta` | **VIDE** — racine et 4 sous-dossiers, zéro fichier |
| `Véhicule/VW Jetta` | 2 fichiers datés (2019-11-09, 2023-11-24) **+ un sous-dossier `KIA`** portant un comparatif d'occasion daté 2026-07-31 |
| `Véhicule/Toyota bZ` | 1 fichier daté (2026-07-16) |
| `Véhicule/KIA` | **existe** (créé par le moteur le 18/08), 2 fichiers datés 2026-07-01 |

Trois conséquences, toutes fatales au repli par date :

1. **La gate n'était pas bloquée par KIA, mais par la Fiesta.** `fenetresOccupation_` ne rend une
   fenêtre que pour un dossier contenant au moins un fichier daté. La Fiesta est vide : elle n'a
   **jamais** eu de fenêtre, et n'en aura pas tant qu'elle est vide. `fenetresCompletes` restait
   donc faux **après** le retrait de KIA — la PR1 initiale ne débloquait rien.
2. **Les fenêtres étaient polluées.** Contrairement à ce que le code supposait, `ciblesAvecJetons_`
   liste **tous** les enfants de « Véhicule » — donc aussi `Véhicule/KIA` et les dossiers communs.
   Un générique daté aurait pu être rangé dans le dossier même que cet ADR retire.
3. **Elles étaient inutilisables sur le fond.** La fenêtre de la Jetta court de 2019-11 à 2026-07
   (à cause du comparatif KIA mal rangé sous elle) : elle aurait avalé jusqu'aux documents de
   l'époque française. Une fenêtre dérivée d'un état que la mission **déplace elle-même** ne peut
   pas porter un verdict définitif (leçon « donnée MOUVANTE », C28-49).

Et surtout : sur les 48, **quasiment aucun ne nomme un véhicule du canon** — 16 assurances
Desjardins, 19 factures de garage, 11 annonces de magasinage. Ils dépendaient TOUS du repli par
date.

### 4.2 Décision de Marc (2026-08-20) — un commun « À attribuer »

Question posée : « comment attribuer les 37 documents qui ne nomment aucun de tes véhicules ? ».
Réponse : **un dossier commun « À attribuer »**, plutôt que de deviner ou de laisser bloqué.

- **Le repli par DATE est RETIRÉ de la mission véhicule** (`batirCtx` ne construit plus de fenêtre,
  la gate de complétude disparaît). `logementParDate_` **reste** au service de la mission LOGEMENT,
  dont les squelettes sont remplis et les périodes disjointes.
- Ordre de décision **complet** (7 étapes — les deux dernières manquaient à une première rédaction
  de cette section, alors que ce sont elles qui traitent le gros du volume) :
  1. dossier `Toyota bZ` isolé → en bloc ;
  2. **les 2 dossiers « KIA » parasites, par IDENTITÉ de source** (`sourceId`) — pas par le
     nommage : leurs fichiers sont à la RACINE de la source, donc `sousChemin` vaut `''` et la
     règle `sources: ['KIA']` ne les voit pas ;
  3. commun par dossier source dissous (`Véhicules/KIA/…`) ou par **jeton de nom** (`kia`,
     `sportage`) ;
  4. **location** : + un véhicule du canon ⇒ refus (ambigu) ; sinon `Locations` ;
  5. **véhicule nommé** → `Véhicule/<v>/<catégorie>` ;
  6. **sous-dossier source PORTANT le nom d'un commun** (`Véhicules/Recherche & achat`) → ce
     commun. **Après** l'étape 5, pour qu'un magasinage qui nomme la Jetta aille bien sous la
     Jetta (décision 1) ;
  7. sinon **`Véhicule/À attribuer`**, catégorie d'origine conservée — sauf si la règle partagée
     du flux sait le placer ailleurs que sous « Véhicule » (filet de sécurité, §4.3 #9).
- **Rien n'est deviné, rien n'est bloqué.** Marc répartit quand il veut.

### 4.3 Autres correctifs issus de la revue (même geste)

| # | Correctif |
|---|---|
| 1 | Les communs se reconnaissent aussi par **jetons de NOM** (`communVehiculeDuNom_`), consultés par le **flux vivant** ET les missions — sans quoi un document « KIA » entré par le flux tombait **à plat à la racine de `03`** (le vrac que `HistoriqueVrac` compte comme dette). Décision 3 « KIA compris » n'était tenue que pour le dossier source. |
| 2 | Les **2 dossiers « KIA » créés par le moteur** (`Véhicule/KIA`, `Véhicule/VW Jetta/KIA`) deviennent des **sources** de la mission : sans ça, retirer KIA du canon les laissait orphelins à vie. |
| 3 | `estLocationVehicule_` + véhicule **du canon** = **AMBIGU** ⇒ refus (révisable) au lieu d'un déplacement définitif : au Québec « location » désigne couramment un **bail** automobile, et la LOA est le mode d'acquisition standard en France. |
| 4 | Les communs sont déclarés dans **`estSegmentStructurel_`** (Reorg.gs). ⚠️ La PR1 affirmait que leur présence dans `STRUCTURE_CIBLE_RESET` les protégeait via `estAncreStructurelleFusion_` : **c'est faux** — ce prédicat ne lit que le premier niveau du domaine, et la collecte de `Fusion.gs` n'est même pas récursive. L'exposition réelle est l'inventaire de la **Réorg**, lui bien récursif ; `Locations` et `À attribuer` n'étaient couverts par rien. *(Nuance : `estAncreStructurelleFusion_` appelle `estSegmentStructurel_` en première ligne — le correctif couvre donc Fusion **aussi**, le jour où sa collecte deviendrait récursive.)* |
| 5 | `MISSIONS_MOTS_VEHICULE` : pluriels ajoutés (`véhicules`, `voitures`, `automobiles` manquaient alors qu'`autos` était là) + test verrouillant l'invariant tacite « jetons alphabétiques seulement » (le préfixe de date n'est pas retiré par ce prédicat). |
| 6 | `docs/TAXONOMY.md` mis à jour dans le même commit. |
| 7 | **Le jeton `sportage` récupéré.** Il appartenait à l'entrée KIA du canon ; le retirer avec elle renvoyait « Garage Sportage » **à plat dans `03`**. Une suppression d'entrée emporte ses jetons — vérifier ce qu'ils couvraient. |
| 8 | Les 2 dossiers KIA sont dissous **par identité de source**, pas par le nommage (cf. §4.2 étape 2). Dépendre du mot « kia » marchait pour les 3 fichiers actuels, pas pour le suivant. |
| 9 | **Filet de sécurité sur `À attribuer`** : c'est un DÉPLACEMENT, donc définitif. Or « Véhicules » n'est pas un dossier pur (Marc y a rangé 4 conversations de propriétaire/plombier). Avant d'avaler un document, le routeur demande à la règle partagée du flux si elle sait le placer ailleurs que sous « Véhicule » — si oui, **refus** (révisable). Les 2 filets FAIBLES du flux (`Contrats`/`Correspondance`) sont exclus : ils attrapent par SOUS-CHAÎNE. |
| 10 | **Le FLUX apprend `À attribuer`** (`Reset.gs`) pour les documents de véhicule typés sans véhicule identifiable (immatriculation, contravention, SAAQ). Ils rendaient `null`, donc partaient **à plat à la racine de `03`** — le vrac que `HistoriqueVrac` compte comme dette. Voir §4.4 : c'est ce correctif qui rend le placement CONVERGENT. |
| 11 | **`dispatch03`, le 3ᵉ consommateur, était resté en arrière** : il filait les « location + véhicule du canon » dans `Locations` sans l'arbitrage d'ambiguïté (déplacement définitif) et ignorait `communVehiculeDuNom_`. Instance exacte de la leçon « mutualiser UNE dimension d'une règle ne couvre pas les autres » : le prédicat était partagé, la DÉCISION non. |

### 4.4 Consolidation : décision explicite de NE PAS bumper `CONSOLIDATION_TAG`

`RESET_TABLE_VERSION t4 → t5` est **inerte aujourd'hui** (`RESET_ACTIF: false`). Les vrais
consommateurs de `cheminCibleReset_` en production sont le **flux vivant** (sans clé de règle) et
la **consolidation**, dont la clé `conso|<tag>|<fileId>` ne porte **pas** la version de table.

Le risque d'un bump `conso-3 → conso-4` était que la consolidation, ne sachant pas reproduire la
cible de la mission, propose de **déplacer vers la racine du domaine** ce que la mission vient de
ranger — et `CONSOLIDATION_EXEC_ACTIF` l'aurait **exécuté**, sans validation ligne à ligne.

**Le correctif #10 supprime ce risque à la racine** : le flux calcule désormais lui-même
`Véhicule/À attribuer`, donc la consolidation recalcule la MÊME cible et inscrit « OK » au lieu de
proposer un retour au vrac. Flux, mission et consolidation sont d'accord **par construction**,
ce qui vaut mieux qu'un négatif tenu par de la prose (« promesse de verrou = verrou codé »).

**Décision inchangée : pas de bump dans cette PR** — il n'apporte rien ici et coûterait une
re-marche complète du Drive. Mais il redevient *sûr*, ce qui n'était pas le cas avant #10. Le jour
où la campagne reset sera relancée (`RESET_ACTIF`), le couple `RESET_TABLE_VERSION` ↔
`CONSOLIDATION_TAG` devra être réexaminé.

### 4.5 Ce que la PR livre réellement (chiffré, sans promesse)

- **jusqu'à 11 fichiers** de `Véhicules/Recherche & achat` → `Véhicule/Recherche & achat`
  (majorant : ceux qui nomment un véhicule du canon partent sous CE véhicule, étape 5 avant 6) ;
- **3 fichiers** des 2 dossiers « KIA » → même destination ;
- **~35 fichiers** (assurances, garages, SAAQ) → `Véhicule/À attribuer`, groupés par catégorie ;
- les documents « KIA », « Sportage », immatriculation/contravention/SAAQ du **flux vivant** ne
  tombent plus à plat à la racine de `03`.

⚠️ **Sur les 2 dossiers « KIA »** : leurs horodatages de création sont à vitesse machine
(`Véhicule/VW Jetta/KIA` à 16:47:08 puis `Véhicule/Toyota bZ` 7 s plus tard), ce qui désigne le
moteur — mais **je n'ai pas identifié le chemin de code** qui produit `Véhicule/VW Jetta/KIA`.
Les dissoudre reste conforme à la décision 2 quelle qu'en soit l'origine (« KIA, c'était juste une
recherche d'achat ») ; si Marc les avait créés à la main, le geste est le même.

Aucun document n'est attribué à un véhicule qui n'est pas nommé — c'est la décision de Marc.


## 5. PR2 — les 39 de « employeurs & CV », instruits sur pièces (2026-08-20)

Les 3 sources ont été relues avant d'écrire la moindre règle (protocole §8). Répartition RÉELLE :

| Famille | Volume | Exemples réels | Destination (décision) |
|---|---|---|---|
| Relevés de paie mensuels | 7 | `2023-04_Relevé_Automatech.pdf` … `2025-01_` | `02 · Revenus & paie/<employeur>` (D9) |
| Recrutement | ~15 | `Offre d'emploi_Cégep Garneau`, `Invitation d'entretien_Automatech`, `Description de rôle`, `Liste d'entreprises cibles`, `Liste de prospection`, `Répertoire d'entreprises industrielles`, `Formulaire de reclassement_Pôle emploi` | `05 · Carrière/Recherche d'emploi` (D10) |
| Documentation métier | 6 | `Bon de livraison_SEW-EURODRIVE`, `Plaque signalétique_Rockwell`, `Rapport de maintenance_robot convoyeur`, `Rapport de service_Robovic`, `Support de cours` ×2 | `_Technique` (D12) |
| Employeur sans dossier | 3 | `Attestation employeur_Algopaie`, `Attestation_Silver Crest`, `Paie_Trajectoire-Emploi` | `05/Employeurs/Autres employeurs` — et la PAIE en `02 · Revenus & paie/Autres employeurs` (D11) |

### 5.1 Précisions de mise en œuvre

- **D9, le prédicat est ÉTROIT.** Élargir `estTypePaieReset_` à « relevé » nu serait dangereux (un
  relevé BANCAIRE n'est pas une paie). La règle exige les trois : type « relevé », **ni** feuillet
  fiscal (`estFeuilletFiscalReset_`, ancré sur le nombre — RL-1/RL-31 sont ANNUELS), **ni** RIB
  (`estRibReset_`), **et** un employeur CONNU. La cadence mensuelle observée (2023-04, 05, 07, 08 ;
  2025-01) confirme la lecture de Marc.
- **D11 borne le nombre de dossiers.** Un dossier par employeur ferait déborder la règle des ≤ 7
  enfants de « Revenus & paie » (3 canoniques + 5 occasionnels). D'où **un seul** `Autres employeurs`,
  des DEUX côtés (05 et 02) — c'est aussi ce que Marc demande (« plutôt qu'un dossier par nom à un
  seul fichier »). Les employeurs sans dossier reconnus par une table dédiée
  (`MISSIONS_EMPLOYEURS_AUTRES`), jamais devinés.
- **D10 exige un geste SYMÉTRIQUE.** La mission `carriere` DISSOLVAIT `Recherche d'emploi` vers
  `CV & lettres` ; la table du flux visait la cible de cette fusion. Recréer le dossier sans retirer
  les deux serait un PING-PONG garanti. Livré dans le même commit : source + `sourcesJetables` +
  branche du routeur retirées, nœud re-déclaré dans `STRUCTURE_CIBLE_RESET`, verrou d'ABSENCE
  inversé en verrou de PRÉSENCE, et le FLUX apprend les types de recrutement (une seule règle, deux
  consommateurs).

### 5.2 Deux exceptions ASSUMÉES, contre la lettre de la décision

1. **L'« Évaluation de performance » de 2016 n'ira PAS dans `_Technique`**, bien que Marc l'ait citée
   en D12. Router le type « évaluation de performance » vers `_Technique` entrerait en collision
   frontale avec `sousDossierEmployeur_`, qui range les **Évaluations** dans le dossier de
   l'employeur : une vraie évaluation RH partirait dans le fourre-tout technique. Le fichier visé
   (`…reclassement migration taxonomie 2016`) est un artefact isolé ; il reste REFUSÉ (révisable),
   ce qui coûte un re-examen au lieu d'un document perdu de vue.
2. **`Fiche comparative` exige un mot de SALAIRE.** Le type seul est trop générique pour porter un
   déplacement définitif ; la règle s'appuie sur le nom complet (`salarial`), conformément au cas
   réel (« Comparatif grilles salariales SPVQ et SQ police »).

Restent volontairement REFUSÉS, faute de règle prouvée : `Document professionnel_Automatech`
(type non informatif), `Attestation conformité algorithme calcul de paie` (aucun employeur),
`Lettre de recommandation_IMERIR` (une ÉCOLE, pas un employeur — relève de `06 · Études`),
`Note personnelle … Lyxor ETF`, et les 3 `.p7s` (signatures cryptographiques, hors périmètre §2).
Un refus est keyé sous la version : il se ré-évaluera au prochain affinage.

### 5.3 Bump

`MISSIONS_REGLES_VERSION` **`c49-3` → `c49-4`** : sans lui, les 39 resteraient marqués « déjà
tenté » sous c49-3 et l'affinage serait sans effet (leçon C28-33).


### 5.4 Convergence flux ↔ mission ↔ consolidation (issu de la revue flotte)

`ConsolidationExec` **recalcule** la cible d'un fichier au moment du déplacement, via
`cheminCibleReset_`. Si le flux ne sait pas reproduire ce que la mission a décidé, **il défait le
rangement, sans bruit**. C'est le défaut corrigé en §4.3 #10 pour `À attribuer` ; la revue en a
trouvé quatre instances de plus dans PR2, toutes mesurées :

| Décision | Cible mission | Ce que le flux rendait AVANT | État |
|---|---|---|---|
| D9 | `Revenus & paie/<employeur>` | `Relevés/AAAA` (relevés **bancaires**) | corrigé |
| D11 (02) | `Revenus & paie/Autres employeurs` | `Revenus & paie` (racine) | corrigé |
| D11 (05) | `Employeurs/Autres employeurs/<type>` | `null` ⇒ racine de `05` (vrac) | corrigé |
| *(pré-existant)* | `Employeurs/<X>/<type>` | `Employeurs/<X>` (un cran au-dessus) | corrigé |

Ces quatre-là sont désormais tenues par **un tripwire** (`test/missions.test.js`) : pour chaque cas
de `routerCarriere_`, `cheminCibleReset_(domaine, nom)` doit rendre **le même sous-chemin**. C'est
ce test qui rend la symétrie structurelle au lieu de dépendre de la vigilance d'un relecteur — et
il aurait attrapé les quatre tout seul. Prouvé par mutation dans les deux sens.

**Exception assumée — D12 est ASYMÉTRIQUE, et c'est structurel.** `_Technique` est **hors
domaines** : le flux ne peut pas y router (`cheminCibleReset_` rend un chemin *dans* un domaine),
et la consolidation ne parcourt que les domaines — elle ne verra donc jamais ces fichiers. Aucune
divergence possible. Le revers : un futur « Bon de livraison » entrant par Gmail dans `05` rendra
`null` et restera à plat, sans que la mission (convergée) le reprenne. D12 est un **one-shot** sur
le stock, pas une règle de flux — écrit ici pour que la dette ne réapparaisse pas sans explication.

### 5.5 Deux prédicats trop larges, rattrapés en revue

1. **`estReleveDePaie_` avalait les relevés QUALIFIÉS.** « Relevé d'**emploi** » (le ROE, remis par
   tout employeur québécois en fin de contrat — donc très plausible dans `Employeurs/Automatech`)
   partait en `02 · Revenus & paie`, alors que `Reset.gs` porte la décision **inverse** en toutes
   lettres : « c'est un document de CARRIÈRE (05) ». *Le code contredisait son propre commentaire.*
   Idem « relevé de notes » (études) et « relevé de compte » (banque). Deny-list explicite ajoutée.
2. **Les jetons `crest` et `trajectoire` sont des mots courants.** « Bilan — Trajectoire
   professionnelle » (un document d'accompagnement carrière, dont le dossier `Formation & bilans`
   existe précisément) partait chez « Autres employeurs ». Même collision que « moreau ⊂ Moreault »
   (C28-49). Jetons passés en **multi-mots** (`silver crest`, `trajectoire emploi`), avec un
   contre-exemple par employeur en test : le charset ne prouve pas la discrimination.

Les deux produisaient un **déplacement définitif à clé de SUCCÈS**. Rappel de la règle qui les
condamne : le prédicat qui déclenche l'action irréversible est STRICT, et **dans le doute il
REFUSE** — un refus coûte un re-examen, un faux positif coûte un document perdu de vue.

### 5.6 Reste ouvert (dit, pas caché)

- **Le contenu de `Recherche d'emploi` est déjà parti.** Sous `c49-3` le dossier était une source
  JETABLE : la mission l'a vidé vers `CV & lettres`, et le bump ne rouvre que les refus des sources
  COURANTES — `CV & lettres` n'en est pas une. **Le rapatriement est donc MANUEL.** Le dossier
  lui-même a été vérifié dans le Drive le 2026-08-20 : il existe, est bien sous `05 · Carrière`, et
  n'est pas corbeillé.
- **Sa COULEUR n'a pas pu être vérifiée** (l'outil de lecture Drive ne rend pas `folderColorRgb`).
  S'il a été peint en ROUGE quand il était vide, il crie « supprimable » alors qu'il redevient la
  cible officielle du recrutement — à dépeindre à la main, ou à traiter dans un geste ultérieur.
