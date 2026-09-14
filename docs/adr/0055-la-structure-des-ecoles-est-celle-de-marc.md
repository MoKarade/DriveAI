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

Trois d'entre eux portent une sous-structure THÉMATIQUE de Marc (`IMERIR — …` : *MFE*, *Scrum*,
*Algorithmique*, *Réseaux*, *Robotique*, *Erasmus+*… ; `ULCO — …` : *GIM 1 (2018-2019)*,
*GIM 2 (2019-2020)*), et trois portent en plus les 4 sous-dossiers standard
(`Cours & travaux`, `Examens & khôlles`, `Résultats`, `Administratif`) — créés le **17/08** par
l'ancienne mission `archives06`, celle qui versait dans ce sens-là. Les deux cohabitent sans se
gêner.

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
6. **`Autres établissements` et `Diplômes & relevés officiels` NE bougent PAS.** Ce ne sont pas des
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

- **Le plafond ≤ 7 est DÉPASSÉ, et il est déclaré.** `Archives scolaires` aura **8** enfants : les
  7 de Marc plus le cégep qu'il demande. Plutôt que de laisser le dépassement invisible (en
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
- **Les 6 dossiers vidés sont peints en rouge** (`sourcesJetables`) — ils ne sont plus dans la
  table, donc rien ne les recrée, donc le signal « bon pour suppression » est VRAI. Et si Marc
  obéit au signal, `estSourceDisparue_` traite la source absente comme vide : la mission converge
  quand même (le mode de panne relevé en C28-93 est déjà fermé, vérifié dans `collecterMission_`).
- **Zone protégée** : `04 · Immigration` n'est ni source ni cible, et la re-vérification stricte
  avant chaque `moveTo` est inchangée.

## 5. Coût

**Zéro appel LLM** : tout se décide par le nom et la structure. La mission déplace ~45 fichiers
dans l'autre sens plus le contenu des 6 dossiers de la racine, sur le budget de curation existant
(9 min/j depuis ADR-0054) — **aucune enveloppe nouvelle**, aucun plafond relevé. Les bumps de
version (`MISSIONS_REGLES_VERSION`, `RESET_TABLE_VERSION`) rouvrent les refus keyés, pas les
succès : le coût est en RPC Drive, pas en dollars.

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
6. Le corpus réel de `06` (683 noms) re-passe : aucun document ne se retrouve à la racine du
   domaine, aucun ne quitte un sous-dossier où une mission l'a rangé (D8/D9 inchangées).

## 7. Ce qu'on assume

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
- **Deux inversions en deux jours**, c'est ~45 fichiers déplacés puis re-déplacés. C'est le prix
  d'une décision prise sur une question au lieu d'une capture d'écran ; rien n'est perdu.
