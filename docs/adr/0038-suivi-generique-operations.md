# ADR-0038 — Suivi générique et fiable de TOUTES les opérations du tick (Progression v2)

- **Statut** : accepté (demande Marc 2026-08-13 : « je veux que ça marche pour tout type de tâche
  que l'app fait et je veux que ce soit beaucoup plus fiable »)
- **Chantier** : C28-44 (plan product-manager 2026-08-13, exécution par PRs séquencées)
- **Périmètre** : pure OBSERVABILITÉ — aucun changement de classement (§8 non concerné), aucune
  mutation Drive nouvelle, aucun scope OAuth touché.

## 1. Problème

L'onglet `Progression` (lu par l'app en poll 15 s) est construit par `lignesProgression_`
(Journal.gs) qui CODE EN DUR 6 opérations (migration, réanalyse, histo-gmail, rangement,
consolidation gen/exec) — alors que `tickDriveAI` exécute ~30 étapes. Tout le reste (intake PJ,
dépôts, partagés, intentions, tri Gmail, reset ×3, passe LLM reliquat, fusion, dry-runs, réorg,
réconciliation Index, maintenances entités/corrections/relances, étapes d'observabilité du finally)
est **invisible** pour Marc.

Fiabilité, quatre trous structurels :

1. **Aucun horodatage d'activité PAR opération** — impossible de distinguer « en cours » de
   « gelé » (les incidents passés — resetEnCours perpétuel, consolidation affamée — sont restés
   invisibles des jours pour cette raison exacte).
2. **Les erreurs par étape sont invisibles** de l'app : elles ne vont qu'à l'onglet `Journal`
   (illisible en poll). Une étape qui échoue à CHAQUE tick s'affiche « en cours » à vie.
3. **Les raisons de skip** (flag OFF, `resetEnCours_`, budget quotidien épuisé, panne API, quota
   Gmail, frein LLM, seuil de file) existent dans les `if` du tick mais ne sont capturées nulle
   part — le statut affiché est RE-DÉRIVÉ à la main par campagne, source historique de bugs
   (numérateur > dénominateur, unités désalignées, gates faux — leçons §7).
4. **L'app lit une plage FIGÉE `A2:G30`** — borne haute silencieuse (leçon §7) : au-delà de
   29 lignes, les opérations disparaissent sans erreur.

## 2. Décision

### a) Registre déclaratif unique (`src/Suivi.gs` : `REGISTRE_OPERATIONS`)

Une table = LA source de vérité des étapes du tick : `{ cle, libelle, unite, type }` avec
`type ∈ { flux, campagne, maintenance, demande, observabilite }`. Les clés EXISTANTES de
Progression sont conservées à l'identique (`migration`, `reanalyse`, `histo-gmail`, `rangement`,
`consolidation-gen`, `consolidation-exec`) — continuité pour l'app et l'historique. Ajouter une
étape au tick = 1 entrée au registre + 1 wrap (voir b) ; un **tripwire de couverture bidirectionnel**
(test, prouvé par mutation) impose : toute étape wrappée dans Main.gs a son entrée au registre, et
réciproquement.

### b) Enregistreur d'exécution (wrapper `etapeSuivie_`)

Chaque appel d'étape du tick passe par
`etapeSuivie_(cle, gates, fn, onErreur?)` :

- **gates** : tableau de closures évaluées DANS L'ORDRE EXACT des `if` actuels (mêmes prédicats,
  même coût — ex. `nbFichiersATrier_` reste dernier) ; chacune rend une *raison de skip* (string)
  ou null. Premier gate non-null ⇒ skip enregistré avec sa raison, étape jamais exécutée.
- **exécution** : tentative + succès + durée enregistrés (deux horodatages DISTINCTS — « dernière
  tentative » ≠ « dernier succès » ; risque PM n° 4).
- **erreur** : l'enregistreur la voit AVANT tout catch (risque PM n° 2 — il ENGLOBE le try/catch,
  ne s'y empile pas) : si `onErreur` est fourni (catchs custom : `signalerPanneGmail_`,
  `journalErreur_`), il est appelé après enregistrement ; sinon l'erreur est RE-LEVÉE telle quelle
  (étapes NUES de l'intake : la sémantique d'échec du tick ne change pas d'un iota).

État : mémoire de module pendant le run (patron `flushUsage_`), **une seule** écriture Property par
tick dans le finally (`flusherSuiviOps_`). Le flush lui-même n'est PAS auto-observé (risque PM
n° 3) : son échec se persiste au tick suivant, `Santé` reste le filet. `majProgressions_` lit la
vue FUSIONNÉE via `suiviOpsFusionne_` (persisté + run courant). Restent aussi HORS registre,
volontairement (listés dans Suivi.gs pour que le tripwire PR2 ait ses exclusions EXPLICITES) :
les 4 setups de tête de tick (idempotents, sans état à suivre), le heartbeat `DriveAI_LAST_TICK`
(le filet ultime ne peut pas dépendre du suivi), la trace horaire de durée et `flushUsage_`.

### c) Persistance bornée (Property `DriveAI_SUIVI_OPS`)

Encodage compact positionnel par clé — SEPT champs : `[tentativeMs, okMs, duréeMs, erreurMs,
"msg ≤ 40", skipMs, "raison ≤ 28"]`. Les textes sont NEUTRALISÉS avant troncature
(`suiviTexte_` : `"`/`\`/contrôles remplacés par un espace) — sans quoi l'échappement
`JSON.stringify` (2-6 caractères par caractère hostile) ferait mentir tout plafond calculé en
caractères (trouvé en revue apps-script-quota PR1 : 34 messages « hostiles » de 40 caractères
auraient pesé 13-16 Ko une fois échappés). Fusion par clé (les champs non touchés ce run
survivent — un succès d'hier reste visible pendant qu'une erreur d'aujourd'hui s'accumule) ; les
clés hors registre sont PURGÉES à la fusion (bornée par construction). Test au plafond DÉRIVÉ du
registre (leçon §7 « ~9 Ko ») : TOUTES les étapes aux maxima (caractères 2 octets) < 8 000
caractères ET < 8 500 octets UTF-8, prouvé par mutation (les troncatures initiales 60/40 donnaient
9 751 octets — attrapées par ce test avant tout déploiement). Filet DUR au flush : > 8 900
caractères ⇒ textes vidés, horodatages conservés (inatteignable en nominal ; ceinture contre un
`setProperty` qui lèverait en boucle). Lecture : `suiviOpsFusionne_` relit la Property à chaque
appel (2 `getProperty` par tick au plus — négligeable).

### d) Onglet `Progression` étendu (contrat app)

Colonnes : `Clé | Opération | Traités | Base | Unité | Statut | Détail | Dernière activité |
Dernière erreur | Horodaté` (7 → 10). `Détail` = raison de skip ou note ; `Dernière activité` =
max(tentative, succès) ; `Dernière erreur` = « message (il y a X) » ou vide. Statuts dérivés des
MÊMES prédicats que le tick (`resetEnCours_`, `estPannePlateforme_`, `estPanneGmail_`,
`budgetCampagnesAtteint_`, budgets quotidiens) — jamais une re-formule. ⚠️ Migration d'en-tête :
`assurerEnteteProgression_` teste `A1 === 'Clé'`, VRAI avant et après l'extension → code mort pour
cette migration (risque PM n° 1, leçon du 2026-08-13) ; le test portera sur la DERNIÈRE colonne
attendue (`J1 === 'Horodaté'`), sur le chemin d'écriture réellement emprunté à chaque tick.
`lireLignesProgression_` tolère les anciennes lignes 7 colonnes au premier tick post-déploiement
(risque PM n° 5).

### e) App

Plage OUVERTE (`A2:J`, jamais de borne de tête — leçon §7), rendu 100 % générique (libellé moteur
en repli, i18n par clé connue), fraîcheur « il y a X min » + erreur + raison de skip affichées,
TOLÉRANTE aux colonnes absentes (déploiements moteur/app non atomiques — transitoire PR3→PR4 sans
casse : l'app actuelle ignore proprement lignes et colonnes supplémentaires, d'où l'ordre
MOTEUR D'ABORD).

### f) Flux vivant : compteurs du jour

Les lignes de type `flux` affichent l'activité du JOUR en RÉUTILISANT les accumulateurs de
`majTelemetrie_` (même calcul, même conversion d'unité — leçon « toute surface qui ré-affiche un
nombre réplique EXACTEMENT la même conversion ») — jamais un comptage parallèle.

## 3. Coût & quotas

Zéro I/O nouvelle par étape (enregistreur en mémoire). Par tick : +1 `getProperty` + +1
`setProperty` (~6 Ko max) + l'écriture Sheet `Progression` qui existe déjà (mêmes `setValues`,
lignes 6 → ~30, colonnes 7 → 10 : négligeable). Aucun appel LLM, aucun appel Drive/Gmail ajouté.
Le wrapper n'ajoute ni gate ni réordonnancement : le comportement du tick est INCHANGÉ par
construction (vérifié par les tests existants qui continuent de passer sans modification de
sémantique).

## 4. Plan de livraison (chaque PR : revue flotte AVANT merge)

- **PR1** (celle-ci) : ADR + BACKLOG + fondations PURES non branchées (`src/Suivi.gs` : registre,
  enregistreur, wrapper, codec Property borné) + tests (plafond dérivé, prouvé par mutation).
  Revue : code-reviewer + apps-script-quota.
- **PR2** : branchement du tick (wrap des ~30 étapes, gates traduites à l'identique) + tripwire de
  couverture bidirectionnel. Revue : code-reviewer + apps-script-quota + file-checker (l'intake
  reste intact).
- **PR3** : rendu Sheet (`lignesProgression_` = itération du registre, colonnes étendues, migration
  d'en-tête sur chemin atteignable). Revue : code-reviewer + apps-script-quota.
- **PR4** : app (plage ouverte, rendu générique, fraîcheur/erreur/skip, tolérance colonnes
  absentes). Revue : code-reviewer.
- **PR5** : compteurs du jour du flux vivant (accumulateurs Télémétrie partagés) + documents
  vivants. Revue : code-reviewer + llm-cost-optimizer (zéro coût LLM ajouté).

## 5. Definition of Done

Registre = source unique ; tripwire de couverture vert et mutation-prouvé ; Property bornée testée
au plafond dérivé ; en-tête migré EN PROD (vérifié sur la donnée réelle post-merge, jamais le
diff — leçon 2026-08-13) ; l'app affiche les ~30 étapes avec fraîcheur/erreur/skip ; coût par tick
inchangé ; `HANDOVER.md`/`BACKLOG.md` à jour.
