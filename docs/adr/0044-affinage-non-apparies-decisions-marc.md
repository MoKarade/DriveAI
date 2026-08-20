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
- Ordre de décision : dossier source dissous (KIA) → commun reconnu par le **nom** → location →
  véhicule **nommé** → sinon **`Véhicule/À attribuer`**, en conservant la catégorie d'origine
  (« Assurance auto », « Entretien & réparations ») pour que la répartition manuelle reste faisable.
- **Rien n'est deviné, rien n'est bloqué.** Marc répartit quand il veut.

### 4.3 Autres correctifs issus de la revue (même geste)

| # | Correctif |
|---|---|
| 1 | Les communs se reconnaissent aussi par **jetons de NOM** (`communVehiculeDuNom_`), consultés par le **flux vivant** ET les missions — sans quoi un document « KIA » entré par le flux tombait **à plat à la racine de `03`** (le vrac que `HistoriqueVrac` compte comme dette). Décision 3 « KIA compris » n'était tenue que pour le dossier source. |
| 2 | Les **2 dossiers « KIA » créés par le moteur** (`Véhicule/KIA`, `Véhicule/VW Jetta/KIA`) deviennent des **sources** de la mission : sans ça, retirer KIA du canon les laissait orphelins à vie. |
| 3 | `estLocationVehicule_` + véhicule **du canon** = **AMBIGU** ⇒ refus (révisable) au lieu d'un déplacement définitif : au Québec « location » désigne couramment un **bail** automobile, et la LOA est le mode d'acquisition standard en France. |
| 4 | Les communs sont déclarés dans **`estSegmentStructurel_`** (Reorg.gs). ⚠️ La PR1 affirmait que leur présence dans `STRUCTURE_CIBLE_RESET` les protégeait via `estAncreStructurelleFusion_` : **c'est faux** — ce prédicat ne lit que le premier niveau du domaine, et la collecte de `Fusion.gs` n'est même pas récursive. L'exposition réelle est l'inventaire de la **Réorg**, lui bien récursif ; `Locations` et `À attribuer` n'étaient couverts par rien. |
| 5 | `MISSIONS_MOTS_VEHICULE` : pluriels ajoutés (`véhicules`, `voitures`, `automobiles` manquaient alors qu'`autos` était là) + test verrouillant l'invariant tacite « jetons alphabétiques seulement » (le préfixe de date n'est pas retiré par ce prédicat). |
| 6 | `docs/TAXONOMY.md` mis à jour dans le même commit. |

### 4.4 Consolidation : décision explicite de NE PAS bumper `CONSOLIDATION_TAG`

`RESET_TABLE_VERSION t4 → t5` est **inerte aujourd'hui** (`RESET_ACTIF: false`). Les vrais
consommateurs de `cheminCibleReset_` en production sont le **flux vivant** (sans clé de règle) et
la **consolidation**, dont la clé `conso|<tag>|<fileId>` ne porte **pas** la version de table.

Bumper `conso-3 → conso-4` re-marcherait tout le Drive — et, la consolidation n'ayant aucun
équivalent du routage par date, elle proposerait de **déplacer vers la racine du domaine** des
fichiers que la mission vient de ranger. **Décision : pas de bump.** Le jour où la campagne reset
sera relancée (`RESET_ACTIF`), ce couple devra être réexaminé — c'est noté ici plutôt que laissé
à la mémoire.

### 4.5 Ce que la PR livre réellement (chiffré, sans promesse)

- **11 fichiers** de `Véhicules/Recherche & achat` → `Véhicule/Recherche & achat` ;
- **3 fichiers** des 2 dossiers « KIA » parasites → même destination ;
- **~35 fichiers** (assurances, garages, SAAQ) → `Véhicule/À attribuer`, groupés par catégorie ;
- les documents « KIA » du **flux vivant** ne tombent plus à plat dans `03`.

Aucun document n'est attribué à un véhicule qui n'est pas nommé — c'est la décision de Marc.
