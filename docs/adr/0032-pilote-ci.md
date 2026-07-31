# ADR-0032 — Pilote CI : plus AUCUN lancement à la main, et un débit supérieur au manuel

- **Date** : 2026-07-31
- **Statut** : accepté (décision Marc : « je veux plus jamais avoir à lancer à la main, je veux que
  tu fasses toi le lancement `lancerResetTout`, et que ça marche encore plus vite que si je le
  faisais à la main »)
- **Chantier** : C28-43

## 1. Problème

Deux gestes manuels subsistaient, et l'un des deux était aussi le **plafond de vitesse** du reset :

1. **`installerTrigger`** — après chaque merge moteur, Marc devait ouvrir l'éditeur Apps Script et
   exécuter la fonction, sans quoi le déclencheur pouvait continuer d'exécuter la version
   précédemment chargée (piège de déploiement (3) des leçons : `clasp push` vert ≠ code pris en
   effet, vécu ~4 jours de prod figée avec CI verte).
2. **`lancerResetTout()`** — le SEUL moyen de faire avancer le grand rangement plus vite que les
   budgets quotidiens du tick (50 min/j), parce qu'une exécution **manuelle** porte le drapeau
   `manuel` : ni gatée, ni comptée (elle est hors du quota des DÉCLENCHEURS, ~90 min/j — acquis
   C28-33 fix). Autrement dit : la vitesse dépendait des clics de Marc.

## 2. Décision

**GitHub Actions devient le pilote.** Le canal existe déjà et est prouvé en production : le miroir
Drive (ADR-0017) POSTe vers la web app `/exec` avec un secret dédié CI (`DriveAI_SYNC_SECRET`,
jamais exposé à un navigateur) — 140 runs verts. On lui ajoute **deux actions**, et **rien d'autre
ne change dans le moteur** :

| Action `doPost` | Effet | Appelée par |
|---|---|---|
| `assurer-trigger` | ré-installe le déclencheur (= ce que Marc faisait dans l'éditeur) | `deploy.yml`, après `clasp push` + `clasp deploy` |
| `pousser-reset` | UNE passe de reset en mode **poussé** (les 3 phases I/O + la passe LLM du reliquat), bornée, verrou pris | `pousser-reset.yml` (cron + dispatch) |

### 2.1 Le pari sur le quota — énoncé, et BORNÉ (révisé par la revue flotte C28-43)

Le quota qui gèlerait tout (C28-29 : « Triggers total runtime ~90 min/j », chien de garde inclus)
est libellé pour les **déclencheurs**, et une exécution de **web app** n'en est pas un. Le projet a
par ailleurs constaté qu'une exécution d'éditeur n'était pas concernée (C28-33 fix).

**⚠️ Mais c'est un INDICE, pas une mesure — et la revue l'a démonté :**
- Le précédent C28-33 prouve seulement que les **compteurs INTERNES de DriveAI** bridaient à tort le
  chemin manuel (« bloqué sans qu'aucun quota réel ne soit en cause ») : c'est l'absence d'un quota
  *DriveAI*, pas la mesure d'un quota *Google*. L'observation portait sur ~20 min d'exécutions
  d'éditeur ; la version initiale de cet ADR l'extrapolait à **~11-13 h/jour** (facteur ~30).
- **CLAUDE.md §6bis (#235, mergé le même jour) tient ce quota pour PARTAGÉ** : « un budget DUR de
  90 min/jour de temps d'exécution, partagé avec le tick lui-même », à propos d'appels *web app*
  déclenchés par le hub. La constitution du projet contredit donc le pari.
- Le mode d'échec réel de Google (*Service using too much computer time for one day*) n'a pas de
  périmètre documenté publiquement. **Personne hors Google ne peut trancher par la doc.**

**Décision : on prend le pari, mais borné et instrumenté** — trois filets qui le rendent sûr *même
s'il est faux* :
1. **`PILOTE_BUDGET_JOUR_MS` (30 min/j au départ)** — ms réelles persistées (`DriveAI_PILOTE_JOUR`),
   gate + comptage, patron des phases du reset. Si le pari est mauvais, la casse est bornée à
   ~30 min/j au lieu de ~13 h/j. Valeur **volontairement prudente** : à relever par Marc une fois le
   heartbeat observé sain plusieurs jours — c'est son arbitrage vitesse/risque, pas le mien.
2. **Détecteur de gel** — si `DriveAI_LAST_TICK` dépasse le seuil du chien de garde, la passe est
   **refusée** et une alerte part (canal mail, indépendant des déclencheurs). Le pilote **détecte**
   le gel au lieu de le masquer. Corollaire : il n'écrit **jamais** `DriveAI_LAST_MANUEL` — le faire
   toutes les 7 min rendrait le chien de garde muet pendant toute la campagne (défaut de la version
   initiale, relevé par les deux revues). Il n'en a pas besoin : la pause CI garantit une fenêtre de
   tick, donc `LAST_TICK` reste frais tout seul — et s'il ne l'est plus, c'est une VRAIE panne.
3. **Mesure** — les ms consommées par passe sont journalisées : sans elles, l'hypothèse resterait
   invérifiable (« vérifier par un signal indépendant »).

⚠️ **Ce que le pilote ne doit JAMAIS faire** : passer par l'action par défaut (`actionTickPonctuel_`),
qui **crée un déclencheur** (`ScriptApp.newTrigger(...).after(1000)`) et consommerait, elle, le quota
protégé. Le travail est exécuté **synchronement dans le `doPost`** — verrouillé par test.

**Débit attendu** : ~30 min/j de rangement poussé **en plus** des ~50 min/j du tick — soit environ
**×1,6**, pas le ×13 annoncé initialement. C'est le prix de la prudence tant que le pari n'est pas
mesuré ; la constante est faite pour être relevée. Le pilote s'**arrête tout seul** à la convergence
(`termine:true`), et se met en **veille avec alerte** après `PILOTE_STERILES_MAX` passes sans progrès
(sinon un état bloqué mais « non terminé » ferait tourner ~192 walks complets par jour pour rien).

### 2.2 Le flux vivant n'est jamais affamé (contrepartie assumée, bornée)

Une passe tient le verrou partagé (`acquerirVerrouReset_`) jusqu'à ~3,5 min : pendant ce temps, un
tick qui tomberait renonce (`tryLock` échoue) — exactement le coût déjà documenté d'une séance
manuelle. La borne : **entre deux passes, le pilote attend `PILOTE_PAUSE_S` (6 min) > `TICK_MINUTES`
(5)**, ce qui garantit ≥ 1 fenêtre de tick complète entre deux passes. Le flux vivant garde donc au
minimum un tick sur deux ; rien n'est perdu (tout est re-scanné), et `DriveAI_LAST_MANUEL` empêche le
chien de garde de crier « moteur silencieux » à tort.

### 2.3 La passe LLM du reliquat devient poussable (révision de l'ADR-0030 PR5)

L'amendement C28-42 écrivait « pas d'un-clic — voulu : jamais de boucle Sonnet non bornée en
manuel ». **On lève cette limite pour le pilote SEULEMENT**, et la raison de sûreté tient toujours :
la boucle n'est pas « non bornée », elle reste plafonnée par `RESET_LLM_MAX_PAR_RUN` (6 documents
par passe). ⚠️ **Ce plafond n'était pas vrai dans la version initiale** (relevé par les deux revues) :
le compteur est local à `analyserPageReliquatReset_`, or la boucle de rondes rappelait la phase, donc
le vrai plafond était « 6 × nombre de rondes ». Corrigé par une **mémoire des documents tentés dans
l'exécution** — qui répare au passage un défaut plus grave : sans elle, un blip transitoire (5xx sur
la conversion Drive) consommait les **3 essais de `gererEchec_` en deux minutes** ⇒ quarantaine
**définitive et silencieuse** (la dé-quarantaine automatique ne couvre pas la clé `tri33llm|`, et le
document restait invisible dans `_TRI` sans empêcher le drapeau « drainé »). Les essais suivants ont
désormais lieu aux passes **suivantes**, espacées — leçon « compter par PASSE, jamais par
re-rencontre ».

Le coût TOTAL ne change pas d'un centime : la clé versionnée `tri33llm|…` fait payer chaque document
**une fois par version de table**. Pousser ne coûte pas plus cher, ça arrive plus tôt. Le frein
campagnes §2.6 (110 $) reste évalué au gate ET par item — **et il est désormais réellement alimenté**
par ce chemin : le contexte web app exige `reinitialiserUsage_()`/`flushUsage_()` (patron
`actionRechercheIA_`), sans quoi l'accumulateur d'usage reste `null` et **aucune dépense du pilote ne
serait comptée** (défaut de la version initiale : le frein était évalué sur un compteur que le chemin
dominant n'alimentait jamais). `chargerPannePlateforme_()` est appelé pour la même raison de
contexte — sinon la suspension persistée en cas de panne de compte API serait ignorée.

## 3. Garde-fous (inchangés — c'est le point)

Le pilote **n'introduit aucune nouvelle surface de mutation** : il appelle le code de reset déjà
revu et mergé (C28-33, C28-42). Donc : aucune suppression (§2, déplacement seul), zone protégée
`04 · Immigration` re-vérifiée à chaque mutation (`aParentProtege_` strict, multi-parents jamais
déplacé), idempotence par l'Index, métadonnées seulement. Ajouts spécifiques au pilote :

- **Interrupteur** `CONFIG.PILOTE_ACTIF` (Marc peut tout couper d'un flag), + `RESET_ACTIF` qui
  gate déjà le fond.
- **Secret** : `DriveAI_SYNC_SECRET`, celui du miroir — DÉDIÉ à la CI, jamais exposé au navigateur.
  Il gagne un pouvoir : déclencher un rangement. Pire abus s'il fuit : faire avancer plus vite un
  rangement que le moteur ferait de toute façon — **aucune suppression, aucune sortie de la zone
  protégée, aucun accès en lecture aux documents**. Choix assumé pour tenir « zéro geste de Marc »
  (un nouveau secret aurait exigé une configuration manuelle des deux côtés).
- **Anti-chevauchement** : verrou partagé pris par chaque passe ; deux runs CI concurrents sont
  impossibles (`concurrency` du workflow) et se dégraderaient de toute façon proprement (la 2ᵉ passe
  renonce sur `tryLock`).
- **Anti-emballement** : `PILOTE_PASSES_PAR_RUN` (2), arrêt immédiat sur `termine:true`, cron toutes
  les 15 min, dépôt PUBLIC (minutes Actions gratuites — vérifié).

## 4. Conséquences

- Marc ne lance plus jamais rien : ni `installerTrigger` après un merge, ni `lancerResetTout`.
  Les fonctions un-clic **restent** (filet manuel, aucune raison de les retirer).
- « Vérifier qu'un déploiement a pris effet » reste jugé par un **signal indépendant** (leçon (3)) :
  ici le pilote lui-même en produit un — la réponse JSON `{ok:true, …}` de `assurer-trigger` prouve
  que la version déployée connaît l'action ; une réponse sans le champ attendu signe une web app non
  redéployée (piège (4)), et le workflow le signale au lieu de réussir en silence.
- Risque résiduel accepté : si Google comptait un jour le runtime de web app dans le quota des
  déclencheurs, le symptôme serait le gel C28-29. Mitigation : le pilote est arrêtable par un flag,
  ses passes sont espacées, et le heartbeat/chien de garde reste le canal d'alerte.
