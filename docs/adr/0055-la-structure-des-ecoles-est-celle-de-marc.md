# ADR-0055 — La structure des écoles, c'est celle de Marc

**Statut** : accepté · **Date** : 2026-09-14 · **Demande de Marc**, deux phrases :
« j'ai la bonne structure pour les écoles déjà, **continue à rajouter là-dedans au lieu de mettre
à la racine du projet** » (capture d'écran de ses 7 dossiers à l'appui) puis « et **décale prépa et
cégep là-dedans** en reprenant la bonne structure ».

⚠️ **Cet ADR RÉVISE la décision du 2026-09-13** (ADR-0052 §9, « mes 5 dossiers d'école ») et
**inverse une seconde fois** la mission d'école. Ce n'est pas un détail de nommage : la campagne
qui tourne aujourd'hui **vide les dossiers que Marc vient de désigner comme les bons**. Aucun
garde-fou du §1 n'est touché — la seule mutation reste le déplacement.

## 1. Ce que le Drive contient VRAIMENT (relevé le 2026-09-14, pas déduit)

`06 · Études & diplômes` (`1PeeKG8X…`) a **9 enfants directs**. Six sont des dossiers d'école que
le MOTEUR a créés par nom au fil des campagnes ; trois sont des nœuds de taxonomie :

| enfant de `06` | créé le | par |
|---|---|---|
| `lycée Thérèse d'Avila` · `Cégep de Sherbrooke` · `IMERIR` | 07/2026 | moteur |
| `Prépa Gustave Eiffel (PTSI)` · `Autres établissements` · `Diplômes & relevés officiels` | 08/2026 | moteur |
| `DUT ULCO Saint-Omer` · `IUT Du Littoral` | 08/2026 | moteur |
| `Archives scolaires` | **29/05/2026** | **Marc** |

Les **7 dossiers de la capture de Marc ne sont PAS à la racine de `06`** : ce sont les enfants
d'`Archives scolaires`, tous créés par lui le 29/05/2026, tous nommés sur le même patron
`<Établissement> — <programme> (<années>)` :

`Collège & Lycée — divers (2014-2017)` · `Lycée — Thérèse Davila (2017-2018)` ·
`Lycée — Gustave Eiffel — Physique-Chimie (TP)` · `Prépa PTSI (2017-2018)` ·
`ULCO — DUT GIM (2018-2020)` · `IMERIR — Ingénieur MSIR (2020-2023)` ·
`Online course — AI Essentials (Google)`

Deux d'entre eux portent une sous-structure THÉMATIQUE de Marc (`IMERIR — …` : *MFE*, *Scrum*,
*Algorithmique*, *Réseaux*, *Robotique*, *Erasmus+*… — 12 dossiers ; `ULCO — …` :
*GIM 1 (2018-2019)*, *GIM 2 (2019-2020)*), et trois portent en plus les 4 sous-dossiers standard
(`Cours & travaux`, `Examens & khôlles`, `Résultats`, `Administratif`) — créés le **17/08** par
l'ancienne mission `archives06`, celle qui versait dans ce sens-là.

⚠️ **Une version antérieure de cet ADR écrivait ici « les deux cohabitent sans se gêner ». C'était
faux, et c'est le défaut le plus grave que la revue flotte a trouvé** (trois agents, indépendamment,
deux en EXÉCUTANT `decisionConsolidation_`) : une école NOMMÉE est un signal FORT, donc ni D8 (cible
faible) ni D9 (remontée vers un ancêtre) ne mordent entre deux FRÈRES de même profondeur — la
consolidation vidait `…/IMERIR — …/MFE` dans `…/IMERIR — …/Cours & travaux`, et
`…/Collège & Lycée — divers (2014-2017)` vers `Autres établissements`, à la RACINE du domaine. Voir
§3.7 (D10). Les 14 dossiers thématiques sont d'ailleurs **VIDES aujourd'hui** : l'ancienne mission
`archives06` avait déjà versé leur contenu vers la racine de `06`.

## 2. Le conflit, dit franchement

Le 13/09, Marc a répondu « mes 5 dossiers d'école » à une question qui opposait les deux
structures, et la mission a été **inversée** ce jour-là : `retour-ecoles06` vide les archives vers
les dossiers d'école de la racine. Elle a déjà déplacé **~45 fichiers** dans ce sens.

La demande du 14/09 dit l'inverse, et elle est plus précise que la précédente parce qu'elle vient
d'une capture d'écran : **la bonne structure, ce sont les 7 dossiers d'`Archives scolaires`**, et
ce qui est à la racine de `06` doit y « **décaler** ». La règle du projet est que la dernière
décision explicite de Marc fait foi ; le geste est de surcroît **entièrement réversible** (aucune
suppression, que des déplacements).

## 3. La décision

1. **La table du flux vise l'archive.** `STRUCTURE_CIBLE_RESET['06 · Études & diplômes']` ne porte
   plus de dossier d'école à la racine : elle porte `Archives scolaires` et, dessous, les **8**
   dossiers de Marc. Un document d'école est classé en
   `Archives scolaires/<dossier de Marc>/<sous-dossier standard>`.
2. **Les libellés du routage DEVIENNENT les noms réels de Marc.** Le libellé rendu par
   `ecoleParNomReset_` / `ecoleParDateReset_` est déjà, par contrat, le nom EXACT d'un nœud de la
   table : on renomme les 5 libellés plutôt que d'ajouter une table de correspondance. Deux noms
   pour la même chose, c'est le piège des « deux canonicaliseurs qui divergent » (§9).
3. **`Cégep de Sherbrooke (2019)`** est le 8ᵉ nœud d'`Archives scolaires` — il n'existait pas, le
   moteur le crée par nom, au patron de Marc. C'est le « décale cégep là-dedans ».
4. **La mission change de sens (et de tag).** `retour-ecoles06` → **`ecoles-archives06`**, clé
   `mission-ecoles-archives-06` : les 6 dossiers d'école de la racine de `06` deviennent les
   SOURCES, les dossiers d'archive les CIBLES. Tag et clé NEUFS, obligatoirement : les ~45 fichiers
   déjà déplacés portent une clé de SUCCÈS sous l'ancien tag et ne seraient jamais repris (§9,
   « re-lancer une campagne à clé de SUCCÈS ne re-traite pas ce qu'elle a figé »).
5. **`IUT Du Littoral` est traité comme l'ULCO.** Ses 5 fichiers sont des documents de DUT GIM
   (« Réflexion réorientation DUT GIM », « Diaporama PPP » 2018) et `ecoleParNomReset_` envoie déjà
   `littoral` / `iut` vers l'ULCO. C'est un doublon que le moteur s'est créé le 23/08 ; il part au
   même endroit. *(Marc n'a nommé que prépa et cégep — mais c'est un dossier d'école à la racine de
   `06`, donc exactement ce que la phrase 1 demande de faire disparaître. Signalé plutôt que fait
   en silence.)*
6. **D10 — la campagne ne réorganise jamais l'intérieur de la structure de Marc.** Un fichier déjà
   sous `Archives scolaires/<école>` ne se déplace plus que vers un descendant STRICT de sa
   position (l'approfondissement reste un gain) : jamais latéralement entre deux sous-dossiers,
   jamais hors du dossier. `estDansStructureMarc_` + `decisionConsolidation_`, posée APRÈS la règle
   « cible vide » pour que le constat d'ignorance continue d'être DIT à Marc.
7. **Les 14 sous-dossiers thématiques de Marc sont DÉCLARÉS dans la table.** Aucune règle ne route
   vers eux ; les déclarer sert à ne pas les DÉFAIRE — la garde de capacité (`noeudsTableReset_` →
   `estNoeudRecreable_`) les retire de la liste « dossiers vides » de l'app, et
   `estSegmentStructurel_` / `estAncreStructurelleFusion_` les refusent comme source de réorg ou de
   fusion. Sans ça, ces 14 dossiers VIDES seraient proposés à la corbeille — c'est-à-dire la
   plainte d'origine de Marc, « il me propose trop de dossiers à mettre en poubelle même des
   dossiers utiles », appliquée à sa propre structure.
8. **`Autres établissements` et `Diplômes & relevés officiels` NE bougent PAS.** Ce ne sont pas des
   écoles : ce sont les deux nœuds de taxonomie de `06`, et ils restent à sa racine. La racine de
   `06` passe donc de 9 à **3** enfants.

### La correspondance, une ligne par dossier

| source (racine de `06`, moteur) | cible (dossier de Marc, `Archives scolaires`) |
|---|---|
| `lycée Thérèse d'Avila` | `Lycée — Thérèse Davila (2017-2018)` |
| `Prépa Gustave Eiffel (PTSI)` | `Prépa PTSI (2017-2018)` |
| `DUT ULCO Saint-Omer` | `ULCO — DUT GIM (2018-2020)` |
| `IUT Du Littoral` | `ULCO — DUT GIM (2018-2020)` |
| `Cégep de Sherbrooke` | `Cégep de Sherbrooke (2019)` *(créé par le moteur)* |
| `IMERIR` | `IMERIR — Ingénieur MSIR (2020-2023)` |

## 4. Les gardes, et pourquoi chacune existe

- **Le plafond ≤ 7 est DÉPASSÉ à DEUX endroits, et les deux sont déclarés.** `Archives scolaires`
  aura **8** enfants (les 7 de Marc plus le cégep qu'il demande), et
  `IMERIR — Ingénieur MSIR (2020-2023)` en aura **16** (les 12 thématiques de Marc + les 4
  standard). Plutôt que de laisser le dépassement invisible (en
  omettant de la table les 3 dossiers qu'aucune règle ne vise — le piège « une cible ABSENTE de la
  table rend `verifierStructureCibleReset_` aveugle au ≤ 7 RÉEL », déjà vécu en `01`), les 8 sont
  déclarés et l'exemption est **nommée** dans `RESET_EXEMPTIONS_PLAFOND`, avec un test qui fige sa
  valeur exacte et un second qui montre que sans elle le validateur mord (8 > 7).
- **Les noms doivent survivre à `champ_`.** Le moteur assainit chaque segment de chemin avant de
  résoudre le dossier (`_` et `/\:*?"<>|` → `-`). Les noms de Marc portent des tirets cadratins,
  des `&`, des parenthèses et des accents : aucun n'est touché — mais c'est un **tripwire**, pas
  une observation. Un `_` glissé dans un nom créerait silencieusement un dossier jumeau.
- **La casse est verrouillée.** `getFoldersByName` est SENSIBLE À LA CASSE : un `Lycée` contre
  `lycée`, un `Davila` contre `d'Avila`, et le moteur crée un second dossier à côté de celui de
  Marc (leçon « 3987 route des Rivières » / « 3987 rte des Rivières »). Un test compare les noms de
  la table aux noms RELEVÉS dans le Drive, caractère par caractère.
- **Une règle, deux consommateurs.** La table des cibles de la mission et les nœuds d'école de la
  table du flux sont le MÊME ensemble, verrouillé par tripwire : sinon la mission verse là où le
  flux ne classe pas, et l'un défait l'autre (leçon C28-26).
- **Les 6 dossiers vidés ne sont PAS peints en rouge** (`sourcesJetables: []`). Une version
  antérieure les peignait « bon pour suppression » en s'appuyant sur « rien ne les recrée ».
  Trois vérifications de la revue l'ont fait retirer : (a) l'invariant est FAUX tant que
  `SEED_ENTITES` valide 6 écoles dans `06` (C28-106) ; (b) le rouge n'atteindrait pas les racines,
  `peindreSourcesVides_` exigeant la vacuité STRICTE alors que ces dossiers gardent leurs
  sous-dossiers ; (c) 4 des 6 sont des entités seedées, donc `estNoeudRecreable_` les refuse à la
  liste de l'app — Marc verrait du rouge qu'aucun bouton n'exécute. **Un signal destructeur ne se
  pose pas sur un invariant non démontré.** Les 6 coquilles restent, visibles ; leur retrait vient
  avec C28-106.
- **`estSourceDisparue_` corrigé — et c'était un 🔴 armé, hors périmètre `06`.** La fonction
  récusait sur « permission » AVANT de chercher les marqueurs de disparition, or le message RÉEL de
  Drive porte les DEUX moitiés (« No item with the given ID could be found, **or you do not have
  permission to access it.** ») : elle rendait donc `false` sur le seul message qu'elle existe pour
  reconnaître. Le test s'en protégeait en RETIRANT la moitié gênante de la chaîne. Conséquence déjà
  armée : les sources de `vehicule` et `logement` sont corbeillées depuis le 12/09 ; à leur purge
  (~12/10) ces missions n'auraient plus jamais convergé, et `dispatch03`, gatée sur elles, serait
  restée bloquée à vie, heartbeat vert. Ordre inversé, test posé sur les messages réels.
- **§1.2 — jamais de dépôt dans une corbeille.** `sousDossier_` filtre les enfants corbeillés
  (C28-93) ; `getFolderById` non. Ce lot place `06/IMERIR` (vidé) juste à côté de
  `06/Archives scolaires/IMERIR — …` (la cible) : si Marc corbeille le mauvais des deux, la mission
  y verserait jusqu'à la purge à 30 jours — une suppression automatique. `traiterItemMission_`
  refuse désormais (échec fermé, `'transitoire'`, aucune clé posée), pour les 8 missions.
- **Zone protégée** : `04 · Immigration` n'est ni source ni cible, et la re-vérification stricte
  avant chaque `moveTo` est inchangée.

## 5. Coût

**Zéro appel LLM** : tout se décide par le nom et la structure. **Aucune enveloppe nouvelle, aucun
plafond relevé** : les 8 missions se partagent `MISSIONS_BUDGET_JOUR_MS` = **2 min/jour**
(ADR-0054), inchangées. *(Une version antérieure de cet ADR écrivait « 9 min/j » — faux d'un facteur
4,5, relevé en revue.)*

Volume à déplacer : ~45 fichiers déjà partis dans l'autre sens + le contenu des 6 dossiers de la
racine (~143 au recensement C28-90) + les 5 d'`IUT Du Littoral`, soit **~190-250 fichiers**. À
~5-8 RPC Drive par fichier sur 2 min/j partagées, l'horizon est de **~5 à 10 jours** [Probable],
pas de quelques passes. Le chantier se paie en RETARD, jamais en dépassement d'enveloppe — le test
d'invariant « la somme des campagnes vaut exactement 63 min/j » reste vrai, aucune constante de
budget n'est touchée.

⚠️ **`MISSIONS_REGLES_VERSION` n'est PAS bumpé** (révision de la première version de ce lot).
`ecoles-archives06` porte un TAG neuf, donc ses clés sont fraîches par construction, et aucun autre
routeur de mission ne lit la branche `06` — `dispatch03` lit `03`, `annees02`/`impots` lisent `02`.
Bumper aurait invalidé les clés de **SUCCÈS** des 8 missions (`cleMission_` met la version dans la
clé des succès COMME des refus — la phrase « les bumps rouvrent les refus, pas les succès » était
fausse) : re-collecte complète de toutes les sources et rapport des paies re-gaté, sur 2 min/j
partagées, sans rien rouvrir d'utile. `RESET_TABLE_VERSION` reste bumpé : `RESET_ACTIF` vaut
`false`, donc c'est une dette acquittée, pas une campagne relancée.

## 6. Méthode de test

1. `verifierStructureCibleReset_` : `[]` avec l'exemption déclarée, **et** la violation `8` sans
   elle (mutation dans le test).
2. Les 8 noms de la table survivent à `champ_` **inchangés** (tripwire, prouvé par mutation avec un
   nom porteur de `_`).
3. Les noms de la table == les noms relevés dans le Drive le 14/09 (fixture littérale).
4. `cheminCibleReset_('06 · Études & diplômes', …)` préfixe `Archives scolaires/` pour **toute**
   école, et **jamais** pour `Autres établissements` ni `Diplômes & relevés officiels`.
5. Les cibles de la mission == les nœuds d'école de la table (une règle, deux consommateurs),
   prouvé par mutation : renommer un nœud fait tomber le test.
6. Le corpus réel de `06` (475 noms — 683 est le total tous domaines) re-passe : aucun document ne se retrouve à la racine du
   domaine, aucun ne quitte un sous-dossier où une mission l'a rangé (D8/D9 inchangées).

## 7. Ce que la revue flotte a changé (4 agents, avant merge)

Le lot est passé par `security-auditor`, `structure-keeper`, `code-reviewer` et
`apps-script-quota`. **Deux 🔴 et six 🟠 sont intégrés ci-dessus** ; ce qui suit résume ce qui a
changé, parce que les trois plus graves n'étaient pas visibles depuis le diff.

| ce qui a été trouvé | par | où c'est fermé |
|---|---|---|
| La consolidation démantèle la sous-structure de Marc (D8/D9 muets entre frères) | 3 agents | D10 (§3.6) + 14 dossiers déclarés (§3.7) |
| `estSourceDisparue_` ne reconnaît pas le message RÉEL de Drive ; son test tronquait la chaîne | sécurité | ordre inversé + test sur les messages réels (§4) |
| `sourcesJetables` fondé sur un invariant FAUX | code | `[]` + C28-106 au backlog (§4) |
| Le tripwire des libellés d'école était devenu TAUTOLOGIQUE — une mutation du libellé Avila survivait aux 1289 tests | structure + sécurité | 2ᵉ segment vérifié + 5 libellés pinnés directement |
| Les gardes anti-mutation (réorg, fusion) ne voyaient que le NIVEAU 1 | structure | `estNoeudStructureMarc_`, ciblée sur ce sous-arbre (Desjardins reste mutable) |
| `moveTo` de mission sans garde « corbeille » (§1.2) | sécurité + code | refus fermé dans `traiterItemMission_` |
| `repointerEcoles06_` : 6 lectures de l'onglet `Entités` + cégep créé à vide | quotas + code | `repointerEntitesLot_` (1 lecture) + `referentielViseUneSource_` |
| Bump de version inutile et coûteux ; ADR faux sur le budget (9 vs 2 min/j) et sur les succès | code + quotas | bump retiré, §5 réécrit |

**6 mutations de plus, 6 attrapées** : D10 neutralisée, ordre de `estSourceDisparue_` remis à
l'envers, garde corbeille retirée, garde structure retirée, libellé Avila divergent, cégep créé
à vide.

## 8. Ce qu'on assume

- **La fenêtre d'Avila reste ouverte.** Marc a dit « Avila c'est genre 2014 2017 » ; ses dossiers
  disent `Lycée — Thérèse Davila (2017-2018)` et `Collège & Lycée — divers (2014-2017)`. Les deux
  ne peuvent pas être vrais en même temps (2017-2018 est aussi la prépa). On **ne change pas la
  fenêtre** — elle vient de sa phrase, elle est déployée et testée — et les documents de 2014→2017
  vont donc dans `Lycée — Thérèse Davila (2017-2018)`. ~26 fichiers, tous dans `06`, récupérables.
  Question ouverte depuis C28-90, re-signalée ici plutôt que tranchée dans son dos.
- **Un défaut PRÉ-EXISTANT laissé ouvert, et dit** (C28-106 au backlog). Quand `cheminCibleReset_`
  rend `null` pour un document de `06`, le flux retombe sur le référentiel d'entités — et
  `SEED_ENTITES` y valide 6 écoles. Si la ligne `Entités` a un `Dossier ID` vide, le flux
  find-or-crée un dossier **à la racine de `06`**, au libellé du seed. Ce lot ne le corrige pas
  (§6 : un bug préexistant ne se corrige pas sans feu vert), pour deux raisons : deux des six
  libellés n'ont pas de cible évidente (`Lycée Gustave Eiffel`, `HAMK`), et le chemin n'est
  manifestement pas chaud — le seed a tourné en juillet et aucun jumeau à casse divergente
  (`Cégep De Sherbrooke` vs `Cégep de Sherbrooke`) n'existe au relevé du 14/09.
- **`CONSOLIDATION_TAG` n'est pas bumpé.** `conso-4` est en cours (102/162 lignes au 13/09) et un
  bump la relancerait de zéro sur plus de 18 700 documents. Les fichiers déjà rangés dans les
  dossiers d'école sont déménagés par la MISSION, pas par la consolidation — qui calcule d'ailleurs
  la même cible (une règle, deux consommateurs), donc les deux ne peuvent pas se battre.
- **Le ≤ 7 est vérifié sur la TABLE, jamais sur le Drive.** `ULCO — DUT GIM (2018-2020)` est
  déclaré à 6 enfants et `IMERIR — …` à 16 ; si Marc ajoute un dossier dans les siens, le
  dépassement RÉEL reste invisible de la CI. C'est le défaut que `docs/TAXONOMY.md` décrit déjà —
  dit ici plutôt que laissé croire que l'invariant porte sur la prod.
- **Le registre de suivi est PLEIN, pas « sous le plafond ».** Pire cas mesuré en revue :
  **8 384 / 8 500 octets** pour 42 étapes, soit 116 octets de marge et ~199 octets par étape —
  la 43ᵉ le ferait déborder. Le renommage de cette mission en a consommé 2. À traiter comme une
  saturation (§9), pas comme une marge.
- **Deux inversions en deux jours**, c'est ~45 fichiers déplacés puis re-déplacés. C'est le prix
  d'une décision prise sur une question au lieu d'une capture d'écran ; rien n'est perdu.
