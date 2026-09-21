# ADR-0062 — Arrêter sept campagnes, et rendre leurs 41 min/j à la lecture des papiers

- **Statut** : ACCEPTÉ — décision de Marc, 2026-09-21.
- **Contexte de la décision** : un audit des appels (« ce qui est appelé, combien de temps est
  alloué, si ça vaut la peine ») demandé le même jour. Marc, en réponse : « tu peux enlever et
  documenter la fin de consolidation, re analyse historique du vrac historique gmail et doublons
  et missions (enleve tout ca, ca aurait du s'arrêter avant quand on savait que ca servait a rien,
  faut toujours optimiser au mieux, met en place) ».

## Ce qui a été mesuré le 21/09 (avant de décider)

L'enveloppe de runtime des déclencheurs Apps Script vaut ~90 min/jour, et les campagnes de fond
s'en partagent **63 min**, verrouillées à l'égalité par `test/orchestration.test.js`. Le relevé du
jour, par `etat_moteur` :

| Poste | min/j | ce que la production en disait |
|---|---|---|
| consolidation (génération) | 16 | absente de la Progression — les lignes « terminé » y sont purgées après 48 h |
| consolidation (exécution) | 8 | idem |
| re-datation de 06 (« re-analyse ») | 8 | **en cours** : 108/466, +2 documents en 14 h, fin estimée au 25/10 |
| historique du vrac | 4 | observabilité seule |
| historique Gmail | 2 | « terminée ✅ — ses 2 min/j sont RÉALLOUABLES » (dit par le moteur) |
| doublons | 1 | « terminée ✅ le 2026/08/22 » |
| missions | 2 | dernière production **il y a 32 jours** |
| **total rendu** | **41** | |

En face, la lecture des papiers — la seule campagne qui produise encore quelque chose que Marc
attend — tournait à **17 min/j** avec 969 documents dans sa tranche et ~2 645 jamais lus.

Côté dollars, la re-datation consommait **57,5 % du budget LLM du mois** (2,33 $ / 216 appels) pour
re-classer des documents **déjà classés**.

## Décision

1. Les sept campagnes sont **ARRÊTÉES** par leur interrupteur (`*_ACTIF: false`), et leur budget
   quotidien tombe à zéro.
2. Les **41 min/j** vont intégralement à `AUDIT_PIECE_BUDGET_JOUR_MS` : **17 → 58 min/j**.
   L'enveloppe reste à **63 min/j** — c'est une réallocation, jamais une hausse (§9 : « RÉALLOUER,
   jamais AUGMENTER » ; au-delà du mur runtime, TOUS les déclencheurs gèlent, chien de garde
   compris).

## Pourquoi arrêter plutôt que mettre le budget à zéro

Parce que le verrou d'orchestration l'interdit, et à raison : « une campagne ACTIVE avec un budget
quotidien 0 tourne à VIDE en silence — `consommeJour 0 >= 0` court-circuite avant tout travail ».
Une campagne muette n'est pas une campagne arrêtée : elle continue d'exister dans les surfaces, et
plus rien ne dit pourquoi elle ne produit rien.

**Deux campagnes n'avaient aucun interrupteur** et il a fallu le créer :

- `REANALYSE_ACTIF` — la re-datation ne s'arrêtait que sur la Property de fin de campagne. Le flag
  est posé **avant** ce `return` : arrêter une campagne EN COURS est précisément ce qu'on demande
  ici, et un interrupteur placé après n'aurait pu éteindre que ce qui est déjà éteint.
- `GMAIL_HISTO_ACTIF` — même défaut : seule `DriveAI_GMAIL_HISTO = terminé` l'arrêtait, donc un
  bump de campagne l'aurait relancée sans qu'on puisse dire non.

Les deux sont **CÂBLÉS en tête de leur étape** et chacun a son test : un flag lu par personne est
une intention jamais livrée (C28-137).

## Ce qui est assumé, et qui n'est pas un oubli

⚠️ **La re-datation est arrêtée EN COURS**, à 108/466. Ce n'est donc pas le ménage d'une campagne
finie : c'est un arrêt délibéré, pris sur la mesure ci-dessus. Les 358 documents restants ne seront
pas re-datés tant que le flag n'est pas remis à `true` **avec** du budget — le verrou refuse l'un
sans l'autre. Sa ligne de Santé garde son avancement à l'écran (« arrêtée (CONFIG, C49-20) —
108 / 466 documents au moment de l'arrêt ») : les autres suspensions sont transitoires et leur
cause est le sujet, celle-ci est définitive et laisse un travail à moitié fait — « arrêtée » tout
court effacerait le seul chiffre qui dit ce qu'on a laissé en plan.

⚠️ **L'historique du vrac est de l'OBSERVABILITÉ**, pas une campagne de production : l'arrêter fige
l'onglet `HistoriqueVrac`. Les points déjà écrits restent ; il ne s'en ajoutera plus.

⚠️ **La consolidation est déclarée terminée par ABSENCE** de ligne dans la Progression, ce qui est
cohérent avec « terminée depuis plus de 48 h » mais aussi avec « n'a jamais eu de ligne ». C'est
l'élément le moins mesuré des sept, et il vaut mieux le dire : la certitude se prendrait dans
l'onglet `PlanConsolidation`.

## Arrêter une campagne, c'est aussi le DIRE — partout (amendement du 21/09, revues de flotte)

Première rédaction de cet ADR : les sept interrupteurs, câblés dans le tick et dans la Santé.
Les deux revues adversariales ont mesuré ce que ça donnait **sur les autres surfaces**, avec la
configuration de production :

| ligne | ce qu'elle disait | pourquoi |
|---|---|---|
| Re-datation de `06` | « en cours · reste 358 documents · vers le 01/10 » | `statutCampagne` ne lisait aucun flag |
| Consolidation (gén. et exéc.) | « en pause (budget du jour épuisé) » + « reprise demain » | `budgetEpuise` vaut `0 >= 0`, donc VRAI à jamais |
| Historique du vrac | « en cours » | gate du flag DANS la fonction, invisible du wrapper |
| Historique Gmail | juste aujourd'hui, faux au premier bump | garde d'arrêt absente de `statutHistoGmail_` |

Les trois premières partaient jusqu'au **widget hubperso** (`missionsPourHub_` → `api/hub/summary`).
Et « reprise demain » est une affirmation sur l'avenir, fausse tous les jours : c'est exactement
l'état « muette » que la section précédente refuse, atteint par l'autre bout — la surface lisait le
BUDGET et jamais le flag. Dans le même `finally`, la Santé écrivait « arrêtée » pendant que la
Progression écrivait « en cours » : deux surfaces, deux vérités opposées.

**Ce qui est posé** : `op.arretee` traverse `statutCampagne` / `statutConsolidation_`, un paramètre
`arretee` en PREMIER dans `statutHistoGmail_`, une gate NOMMÉE pour l'historique du vrac (patron
`dryrun-v2`), et « désactivée » ajouté au garde qui interdit d'annoncer une date de fin.

⚠️ **Le MOT compte, et les deux revues proposaient le mauvais.** `familleStatut`
(`app/src/etat.ts`) apparie `statut === 'désactivée'` par **ÉGALITÉ** : « arrêtée (CONFIG) »
serait retombé dans la famille par défaut, `encours` — donc le correctif aurait réintroduit le
défaut qu'il corrige. Une garde de CHAÎNON le verrouille désormais, parce qu'aucun des deux dépôts
ne pouvait le dire seul.

⚠️ **Trois des sept interrupteurs n'étaient tenus par AUCUN test** (missions, consolidation gén. et
exéc.) : mesuré, on pouvait retirer leur garde interne ET leur gate de wrapper en laissant
1 548 tests verts. Le lot fait pourtant de l'interrupteur le SEUL mécanisme d'arrêt — le budget à
zéro n'est plus qu'un filet. Un recensement dérivé de la liste des sept les couvre maintenant.

## La comptabilité des minutes

Les deux parts nommées (`AUDIT_PIECE_PART_SYNC_MIN`, `AUDIT_PIECE_PART_GMAIL_MIN`) ne passent pas à
l'échelle de sept donneurs. Elles sont remplacées par une **table** `AUDIT_PIECE_DONNEURS_MIN`,
dont la somme doit valoir le budget du receveur — un test l'exige, et exige en plus que chaque
donneur nommé ait bien un budget à **zéro** et un flag à **false** : sans ça, la table se
conserverait en inventant un donneur, c'est-à-dire en déplaçant d'un cran le défaut qu'elle existe
pour empêcher.

Le garde « prêté = reçu » par donneur d'ORIGINE, lui, est **retiré** — et c'est dit dans le test
plutôt que laissé passer pour un oubli. Il suivait une chaîne à un maillon (l'historique Gmail
prête, la re-datation reçoit) ; les 8 min de la re-datation repartent maintenant vers la lecture,
donc les re-tracer jusqu'à leur donneur d'origine les compterait deux fois. Ce qui le remplace
couvre strictement plus : l'égalité de l'enveloppe (rien ne se crée) **plus** la table (chaque
minute du receveur a un donneur nommé).

## Alternative écartée

**Ne rien arrêter et prendre les minutes sur la marge** (63 → 90). Refusée : la marge de ~25 min
est une réserve ESTIMÉE pour le socle non budgété (intake Gmail, dépôts, partagés, tri, intentions,
observabilité), que personne n'a mesuré. La dépenser serait parier sur un chiffre que le moteur ne
produit pas — et le prix d'une erreur est le gel de tous les déclencheurs.

## Comment revenir en arrière

Remettre le `*_ACTIF` concerné à `true` **et** lui rendre des minutes en les retirant de
`AUDIT_PIECE_BUDGET_JOUR_MS` et de sa ligne dans `AUDIT_PIECE_DONNEURS_MIN`. Les trois vont
ensemble : le gate refuse d'en faire deux sur trois.
