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
| véhicules | 48 | **Gate de complétude jamais satisfaite** : `KIA` figure dans `MISSIONS_VEHICULES` sans dossier cible, donc `fenetresCompletes` est faux À VIE et **toute** attribution par date est refusée (`Missions.gs`, `if (!ctx.fenetresCompletes) return null`). Ce n'était pas un manque de règles. |
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
