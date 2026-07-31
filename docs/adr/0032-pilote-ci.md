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

### 2.1 Pourquoi c'est PLUS RAPIDE que le manuel (et pourquoi ce n'est pas un dépassement de quota)

Le quota qui gèlerait tout (C28-29 : « Triggers total runtime ~90 min/j », chien de garde inclus)
borne les **déclencheurs**. Une exécution de **web app** n'est pas un déclencheur — c'est la même
catégorie qu'une exécution d'éditeur, dont le projet a déjà constaté empiriquement qu'elle est hors
de ce compteur (C28-33 fix : Marc bloqué à tort par les budgets quotidiens « sans qu'aucun quota
réel ne soit en cause »). Le pilote **n'augmente donc aucun budget** et ne touche pas à l'enveloppe
50 min/j du tick : il ouvre le MÊME robinet que les clics de Marc, mais sans Marc.

⚠️ **Ce que le pilote ne doit JAMAIS faire** : passer par l'action par défaut (`actionTickPonctuel_`),
qui **crée un déclencheur** (`ScriptApp.newTrigger(...).after(1000)`) et consommerait, elle, le quota
protégé. Le travail est exécuté **synchronement dans le `doPost`** — verrouillé par test.

Débit obtenu, sans jamais affamer le flux vivant (voir 2.2) : ~3,5 min de reset par passe, 2 passes
par run, un run par quart d'heure ⇒ **~7 min de reset toutes les 15 min ≈ 11 h/jour**, contre
50 min/j aujourd'hui — et contre « autant de fois que Marc clique ». Le pilote s'**arrête tout seul**
à la convergence (`termine:true` ⇒ le workflow ne fait plus rien), donc le coût retombe à zéro.

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
par passe) — c'est le plafond d'ITEMS, pas le budget quotidien, qui borne le coût par passe. Le coût
TOTAL, lui, ne change pas d'un centime : la clé versionnée `tri33llm|…` fait payer chaque document
**une fois par version de table** (≤ 3 tentatives puis quarantaine). Pousser ne coûte pas plus cher,
ça arrive plus tôt. Le frein campagnes §2.6 (110 $) reste évalué au gate ET par item.

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
