# Leçons apprises — DriveAI

> Journal append-only des leçons tirées en codant. Ajoute via `/lesson "<texte>"`.
> Les règles **durables** (qui changent la façon de coder) remontent dans `CLAUDE.md` §7.
>
> Format d'une entrée :
>
> ```
> ## AAAA-MM-JJ — <titre court>
> **Contexte.** …
> **Leçon.** …
> **Règle durable ?** oui/non — (si oui, ajoutée à CLAUDE.md)
> ```

---

## 2026-08-06 — Un « signal de certitude runtime » n'existe que s'il est DANS le code committé ET déployé : ne jamais renvoyer l'utilisateur vers une fonction de diagnostic citée de mémoire
**Contexte.** Suite du diagnostic « le drain de 05 avance-t-il ? ». Depuis plusieurs sessions je
renvoyais Marc (et moi-même) vers une fonction un-clic `diagnosticRangement2` censée dumper l'état
des campagnes (Properties conso/reset + comptage). Un `grep` a montré qu'elle **n'a JAMAIS été
commitée** — elle avait été « donnée en chat » lors de l'incident deadlock, jamais posée dans `src/`.
Résultat : chaque « check maintenant » retombait sur l'index de recherche Drive (qui RETARDE) →
verdict toujours incertain, et une note HANDOVER « la consolidation DRAINE (prouvé) » qui s'appuyait
sur cet outil fantôme. Le re-check du jour (noms réels de `05·Carrière`) a montré ~150 fichiers
**gelés depuis le 27/07** (dont des `Lettre de motivation` → `CV & lettres` et `Paie_Robovic` →
`Employeurs/Robovic` qui DEVRAIENT bouger) : le drain n'avançait pas, contredisant le « prouvé ».
Correctif à la racine : j'ai VRAIMENT écrit l'outil (`src/Diagnostic.gs` → `etatCampagnesRangement()`,
lecture seule, revue flotte 🟢/🟢, verrouillé en surface + tests), et corrigé le HANDOVER honnêtement.
**Leçon.** "Un « diagnostic un-clic » n'est un signal de CERTITUDE que s'il est (a) réellement dans
le code COMMITTÉ — le vérifier par `grep` AVANT de dire à l'utilisateur « exécute X » (leçon voisine :
« consigne manuelle = fichier .gs D'ABORD » suppose que la fonction EXISTE) — ET (b) DÉPLOYÉ (piège 3 :
un `clasp push`/merge vert ne charge pas le trigger ; nommer le geste de reload). Un outil cité de
mémoire mais jamais posé transforme chaque « check » en incertitude et peut fonder une fausse preuve
dans un document vivant. Deux réflexes : (1) tout point d'observation qu'on promet DOIT être committé
dans le même geste (comme « promesse de verrou = verrou codé dans le même commit ») ; (2) quand un
re-check contredit une affirmation antérieure « prouvé/ça marche », CORRIGER le document vivant
IMMÉDIATEMENT — jamais laisser une conclusion périmée en tête (ici « draine (prouvé) » → « drainage
NON confirmé, voici le vrai diagnostic »)."
**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-05 — Diagnostiquer « le backlog ne draine pas » : un instantané de la SOURCE ne distingue pas « bloqué » de « lent ». Vérifier la DESTINATION, la CADENCE et les alimenteurs concurrents AVANT de crier au bug
**Contexte.** Incident « rangement bloqué » (suite d'ADR-0035). Deux diagnostics, un bon et un raté.
(1) **Bon** : prod figée malgré les fix mergés → j'ai correctement identifié le **piège 3** (`clasp push`
vert à 14:17 mais le time-trigger tournait encore l'ANCIEN code chargé → `resetEnCours_` true → conso
suspendue). Signal : code poussé + heartbeat `État` écrit aujourd'hui + **zéro fichier bougé en 3 h**.
Remède (frontière d'exécution) : Marc exécute `installerTrigger` → recharge → deadlock levé.
(2) **Raté** : APRÈS le rechargement, j'ai conclu trop vite « 87 % des fichiers de 05 devraient bouger
mais ne bougent pas ⇒ BUG », à partir d'un **instantané de la SOURCE** (compteur racine 05 = 141, en
HAUSSE ; liste `list_recent_files` « vide » hors miroir). C'était FAUX : le rangement MARCHAIT — la
preuve était dans la **DESTINATION** (`05·Carrière/CV & lettres` contenait déjà **~60 CV correctement
rangés**). Ce que j'avais manqué : (a) le drainage est **PACÉ** (budget conso 12 min/j — `DriveAI_CONSO_JOUR`
consommé à fond, c'est « lent », pas « bloqué ») ; (b) un **alimenteur concurrent** gonflait la source
(l'ANCIEN code, avant le clic, faisait tourner le reset — `DriveAI_RESET_RASS_JOUR = …|1200218` = 20 min
— qui déversait dans les racines : 05 était monté 116→141) ; (c) `modifiedTime` ne reflète pas
fiablement un `moveTo` et l'index de `search_files` est en retard (déjà connu §7) — le COMPTAGE de la
destination est le seul signal fiable. Le verdict CERTAIN est venu du **diagnostic un-clic**
(`resetEnCours_`, tags, budgets, curseur exec) + du comptage de la destination, jamais d'un échantillon.
**Leçon.** "Pour diagnostiquer un backlog qui semble ne pas se vider : un COMPTAGE DE LA SOURCE à un
instant T ne distingue JAMAIS « bloqué » de « lent (pacé) ». Avant de conclure au bug : (1) regarder la
DESTINATION — les items arrivent-ils là où ils doivent (bucket cible) ? un dossier cible qui se remplit
prouve que le pipeline fonctionne ; (2) lire la CADENCE dans l'état (budget/jour consommé ? curseur qui
avance ?) — un budget quotidien épuisé dit « repris demain », pas « cassé » ; (3) chercher un ALIMENTEUR
CONCURRENT qui gonfle la source (une autre campagne, l'ancien code pas encore rechargé) et masque le
drainage net ; (4) ne pas fonder la fraîcheur sur `modifiedTime`/`search_files` (index en retard,
`moveTo` ne bumpe pas le contenu) — COMPTER la destination. Et la certitude runtime vient du diagnostic
un-clic lecture seule (Properties + comptage via le code DÉPLOYÉ), jamais d'un instantané Drive. Corollaire
humilité : après avoir eu raison sur un diagnostic dur (piège 3), ne pas enchaîner un second verdict à la
va-vite sur un signal partiel — chaque conclusion se re-prouve sur son propre axe."
**Règle durable ?** oui — ajoutée à `CLAUDE.md` §7 (famille « vérifier la prod par un signal indépendant »).

## 2026-08-05 — Un NOUVEAU module qui propose de muter/cibler des dossiers doit hériter du garde « segment structurel » que ses voisins portent déjà, sinon il propose des mouvements NON convergents
**Contexte.** Chantier #47 PR1 : `Fusion.gs`, un dry-run qui détecte les dossiers d'entité en double
(IRCC×5…) et propose une CIBLE de fusion. Revue structure-keeper : le radar listait les enfants directs
de chaque domaine — or depuis ADR-0030 ce sont majoritairement les **buckets de `STRUCTURE_CIBLE_RESET`**
(`Banques`, `Employeurs`, `CV & lettres`, `IRCC (fédéral)`…), des CATÉGORIES que le reset find-or-crée
**PAR NOM**. Le radar les traitait comme des entités : `cibleFusion_` (« le plus de fichiers ») pouvait
choisir un legacy plus gros comme CIBLE et proposer de VIDER le bucket — que le reset recrée au tick
suivant (ping-pong). C'est exactement le piège que `estSegmentStructurel_` (Reorg) et les exclusions de
la Consolidation protègent, et que TAXONOMY documente (« les muter les ferait re-créer au document
suivant ») — **Fusion.gs était le seul module de manipulation de dossiers sans ce garde**. Second écart :
le lien flou (jaccard/clé canonique) fondait `Honda Civic 2014` et `2017` (deux véhicules RÉELS), car
`canoniserVehicule_` RETIRE l'année — alors que `estFusionnableEntite_` (règle OFFICIELLE) les sépare.
**Leçon.** "Quand tu ajoutes un module qui **propose de déplacer/cibler/vider des dossiers**, inventorie
d'abord les gardes que ses VOISINS (reset, consolidation, réorg) portent déjà et **hérite-les**, sinon tu
réintroduis un bug qu'ils avaient résolu. Deux gardes récurrentes : (a) un **segment structurel** (bucket
`STRUCTURE_CIBLE_RESET`, année/schéma `estSegmentStructurel_`, type d'identité) que le moteur find-or-crée
PAR NOM n'est JAMAIS une SOURCE (jamais vidé) — au mieux une CIBLE gardée d'office ; sinon la mutation est
défaite au tick suivant (non convergence). (b) La règle de fusion d'entités du moteur (`estFusionnableEntite_` :
« une ANNÉE excédentaire distingue deux entités réelles ») doit être respectée par tout NOUVEAU rapprochement
— et attention, deux canonicaliseurs du même projet peuvent DIVERGER (`canoniserEntite_`/`canoniserVehicule_`
retire l'année pour unifier DOCUMENT→entité ; `estFusionnableEntite_` la garde pour distinguer deux dossiers
d'entité) : choisir CELUI qui correspond à la décision qu'on prend (ici : identité de DOSSIER ⇒ la règle qui
DISTINGUE), et placer le veto AVANT le canonicaliseur qui écrase le signal. Réflexe de revue d'un module de
manipulation de dossiers : « quel garde mes voisins ont-ils que je n'ai pas ? »."
**Règle durable ?** oui — ajoutée à `CLAUDE.md` §7 (famille « campagne de rangement ⇒ mêmes fonctions
pures que le flux + garde zone protégée »).

## 2026-08-05 — Un invariant « JAMAIS X » posé au DRY-RUN (défaut opt-out) n'est pas un garde : il doit être RÉ-APPLIQUÉ à la MUTATION (fail-closed), sinon l'override le contourne en silence
**Contexte.** Chantier #47 PR2 (`FusionExec.gs`, exécution du plan de fusion curé par Marc). Le dry-run PR1
posait déjà `Ignorer (structurel)` par DÉFAUT sur une source-ancre (bucket du reset) — mais c'est un
opt-OUT : Marc peut la repasser à `Fusionner`. La revue structure-keeper a relevé l'écart : `TAXONOMY.md`
affirme « un bucket structurel n'est JAMAIS une SOURCE » (le reset le recrée PAR NOM → non convergent +
corbeille possible d'un dossier canonique), mais l'EXÉCUTION ne re-testait QUE l'appartenance au domaine —
aucun contrôle `estAncreStructurelleFusion_` à la mutation. Un override de Marc aurait donc vidé un bucket
que le reset recrée (ping-pong), et le dossier vidé serait parti en `vide-candidat` (ni l'app ni le moteur
ne le refusaient). Second écart voisin : `repointerEntites_` re-pointait une entité vers la cible SANS
vérifier qu'elle n'est pas un fourre-tout structurel (taxonomie : « un regroupement n'est jamais une cible
de routage »). Corrigé : garde `estAncreStructurelleFusion_` À LA MUTATION (refus source structurelle sauf
dédup de même nom ; pas de re-pointage vers une cible structurelle), partagée avec le dry-run (une seule
fonction). Autres correctifs de la revue : convergence sur move en échec (catch PAR FICHIER, le fichier
reste, la source draine — pas de re-scan à vie), stall ≥cap → source `bloquée`, budget dans l'invariant
d'enveloppe C28-42 (prouvé par mutation), tests de l'orchestrateur (`FINI`/`resteAFaire`/plafond).
**Leçon.** "Un invariant de sûreté (« segment structurel JAMAIS une SOURCE », « zone protégée jamais
détachée ») affiché dans un plan/dry-run comme un DÉFAUT que l'utilisateur peut overrider N'EST PAS un
garde — c'est une suggestion. Le vrai garde se RÉ-APPLIQUE au point de MUTATION (fail-closed), avec le MÊME
prédicat que le dry-run (une seule fonction, jamais deux). Réflexe de revue d'un module d'EXÉCUTION : pour
chaque invariant « JAMAIS » que le plan promet, trouver la ligne qui le RÉ-VÉRIFIE juste avant le
`moveTo`/`repointerEntites_` — si elle n'existe pas, l'override le franchit en silence (« promesse de
verrou = verrou codé dans le même commit »). Corollaire : un effet de bord voisin de la mutation
(re-pointage d'un référentiel) hérite des MÊMES exclusions structurelles que la mutation elle-même."
**Règle durable ?** oui — corollaire ajouté à la règle #47 de `CLAUDE.md` §7.

## 2026-07-01 — Documenter une conception : vérifier les tensions entre les choix du propriétaire et les décisions déjà actées, et les surfacer AVANT de figer
**Contexte.** Brainstorm produit « niveau pro » : je posais des questions à Marc et j'écrivais un ADR par axe.
Deux fois, un choix qu'il venait de faire **contredisait une décision prise quelques minutes plus tôt dans la
même session** : (1) « l'app web applique les corrections directement » ↔ les garde-fous NON négociables §1/§2
(zone protégée jamais détachée, aucune suppression) que seul le moteur garantissait — appliquer côté app duplique
ces garde-fous en deux endroits (le piège « invariants voisins ») ; (2) « ré-indexation plein texte » ↔ ADR-0007
« métadonnées seulement », décidé 5 minutes avant — un index de contenu stocke le corps des documents, exactement
ce qu'on venait d'interdire. La tentation était de documenter le choix tel quel (« le propriétaire a demandé »).
**Leçon.** Documenter une décision n'est pas la transcrire : c'est vérifier qu'elle **tient avec le reste du
dossier**. Quand un choix entre en tension avec une décision déjà actée (surtout récente), ne pas l'écrire en
silence : **surfacer la tension, expliquer le risque concret, recommander la réconciliation, demander UNE
confirmation** (même procédure que « le propriétaire relâche un garde-fou »). Puis, selon sa réponse : soit il
adopte la voie réconciliée (ici : plein texte **délégué à l'index natif de Drive** → cherche dans le contenu
SANS rien stocker, respecte ADR-0007) ; soit il maintient son choix brut, et on le documente **avec la contrainte
non négociable attachée** (ici : app applique direct, MAIS garde-fous §1/§2 ré-implémentés + **couverts par le
filet de tests**, idéalement en partageant la logique pure du moteur — « préserver l'irréversible »). Un dossier
de conception « niveau pro » se reconnaît à ça : les décisions ne se marchent pas dessus, et chaque relâchement
nomme ce qui reste, lui, non négociable. Corollaire process : garder l'ADR comme **cible** explicite (statut
« à implémenter »), jamais confondu avec le code réel — et quand une décision peut se vérifier sur le code
(« l'état ne stocke que des métadonnées »), la **vérifier** plutôt que l'affirmer (Index = nom/date/chemin/
statut/hash → confirmé).
**Règle durable ?** oui — ajoutée à `CLAUDE.md` §7 (invariant vie privée « métadonnées seulement ») ; le principe
« surfacer les tensions avant de figer un ADR » rejoint la leçon existante sur le relâchement de garde-fou.

## 2026-07-01 — « 0 collecté » issu d'une EXCEPTION attrapée ≠ « terminé » ; un garde par-élément qui peut lever doit être défensif
**Contexte.** Le grand rangement de « Ancienne structure » ne bougeait aucun fichier alors que le recensement
en voyait 113. Le run était VERT (aucune erreur remontée à Marc). Cause en deux temps : (1) la collecte réelle
appelait `estAReclasser_`→`aParentProtege_`→`getParents()` qui LEVAIT une exception (traversée d'une racine /
Drive partagé `0AKPYZ…`), attrapée par le `try/catch` autour de `collecterAReclasser_` → la collecte de la
racine était abandonnée → **0 id collecté**. Le recensement, lui, marchait car il utilisait un prédicat LÉGER
SANS `getParents`. (2) Pire : `collectes === 0` (sans dépassement de budget) était interprété comme
« plus rien à ranger = TERMINÉ » → le rangement se figeait (`DriveAI_RANGEMENT` posé), et TOUS les ticks
suivants (auto ET manuels) sautaient le rangement → moteur « muet », Sheet figée. Diagnostic très retardé car
l'erreur était dans le Journal (illisible : Sheet énorme + tronquée + cache Drive) : il a fallu raisonner par
signaux Drive indépendants (parent de « Ancienne structure » = racine, PAS 04·Immigration) + relecture du code.
**Leçon.** (1) **Un état terminal (« terminé », « fait ») ne doit JAMAIS être déduit d'un compteur à 0 sans
distinguer « 0 parce que vraiment vide » de « 0 parce qu'une étape a échoué ».** Tracer les exceptions attrapées
(`erreurCollecte=true`) et forcer « pas terminé » (`reste=true`) tant qu'un échec a pu masquer du travail — sinon
un bug transitoire fige définitivement le pipeline. (2) **Un garde-fou appliqué PAR ÉLÉMENT et qui peut lever
(ici `getParents`) doit être défensif** : envelopper au niveau de l'élément (un item bizarre est SAUTÉ, pas
d'abandon du lot entier) ET à l'intérieur du garde (détection POSITIVE seulement : on ne « protège » que si on
TROUVE réellement la preuve ; une branche illisible renvoie false sans propager). Sinon un seul élément
pathologique neutralise tout le traitement. (3) **Symptôme « moteur muet + un état figé »** ⇒ suspecter un
prédicat de skip/fin auto-produit qui s'est verrouillé sur une valeur erronée ; le déverrouiller par un
bump de tag/version, PAS juste corriger le bug en amont (l'état figé persiste sinon). (4) Le prédicat de
recensement (léger, sans appels Drive fragiles) DIVERGE du prédicat de collecte (avec garde `getParents`) :
quand deux prédicats censés être équivalents donnent des comptes opposés (113 vs 0), l'écart EST le bug.
**Règle durable ?** oui.

## 2026-07-01 — Une étape amont COÛTEUSE peut « manger » chaque tick sans rien écrire (churn invisible) ; séparer le comptage léger du garde-fou coûteux
**Contexte.** Après déploiement de la barre (P1-15), Marc n'avait PAS d'onglet `Progression`. Diagnostic
par signal Drive indépendant (le canal Sheet étant illisible/tronqué) : sur ~25 min post-déploiement, RIEN
n'avait bougé dans le Drive (seul l'Apps Script modifié par le `clasp push`), et la Sheet d'état était figée.
Piège de lecture : « la Sheet ne bouge pas » ≠ « le moteur est mort ». Le recensement de la barre parcourait
« Ancienne structure » (grosse archive) en appelant `getParents()` par fichier (via `aParentProtege_`) → il
ne finissait JAMAIS dans le budget (4.5 min), retournait « partiel » en n'écrivant qu'une Script Property
(invisible côté Drive/Sheet), et re-partait de zéro au tick suivant. Résultat : le moteur tournait mais
consommait tout son budget dans un comptage stérile, sans jamais produire la barre ni laisser de budget à
l'intake — un **churn invisible**.
**Leçon.** (1) **Symptôme « le moteur écrit son état mais plus rien ne bouge » ⇒ suspecter une étape AMONT
qui consomme le budget sans écrire** (pas seulement un plantage). Diagnostiquer par un signal Drive
indépendant : `modifiedTime` sur tout le Drive — si SEUL le fichier de code a changé depuis le déploiement,
aucun tick n'a rien produit. (2) **Un COMPTAGE (dénominateur d'une barre, estimation) ne doit pas payer le
prix d'un GARDE-FOU de mutation.** `getParents()` par fichier est là pour ne jamais DÉTACHER un fichier de la
zone protégée — utile avant un déplacement RÉEL, inutile pour compter. Split : prédicat LÉGER
(`estAReclasserLeger_` : nom + mime, aucun appel Drive supplémentaire) pour le recensement ; prédicat COMPLET
(`estAReclasser_` avec `aParentProtege_`) pour la COLLECTE et le DÉPLACEMENT réels. L'écart d'estimation est
absorbé par la re-base + la finalisation sur le vrai signal de fin. (3) **Rendre l'onglet visible dès le 1ᵉʳ
tick** (écrire « recensement en cours… » avant même le comptage) : un utilisateur qui attend une barre ne doit
jamais voir « rien » pendant 30 min. (4) Toujours **tracer le coût réel d'un parcours récursif** (1 appel
Drive/fichier × milliers de fichiers = jamais dans le budget) avant de le mettre sur le chemin d'un tick.
**Règle durable ?** oui.

## 2026-07-01 — Barre de progression sur un traitement de masse : recensement dans un tick DÉDIÉ, base re-basable, « terminé » sur le vrai signal
**Contexte.** Marc : « je veux que ça classe tout, une petite barre de chargement pour voir ». Deux bugs
étaient en jeu. (1) Le grand rangement de l'ancien Drive tournait EN DERNIER dans le tick → systématiquement
affamé (budget déjà consommé par l'intake) → l'ancien Drive ne se vidait jamais. (2) Pour la barre, une
1ʳᵉ implémentation faisait le RECENSEMENT complet (parcours récursif du Drive pour compter le total) DANS
le même run qu'une page de rangement + l'intake : sur un gros Drive, ce recensement ne finissait jamais dans
le budget → base jamais posée → aucune barre → et chaque tick re-parcourait tout pour rien (quota gaspillé).
La revue quotas a aussi noté qu'une base FIGÉE (`base`) confrontée à un numérateur CUMULÉ (`traites`) ne
converge pas : la barre pouvait afficher « ✅ terminé » alors qu'il restait des fichiers (ajoutés après le
recensement), ou rester bloquée à 98 % (fichiers comptés puis normalisés par un autre chemin).
**Leçon.** (1) **Drainer avant d'alimenter, sans affamer l'étape qui alimente.** Une étape qui ALIMENTE une
file (rangement → `00·À trier`) doit tourner TÔT (sinon jamais de budget) MAIS gated sur une file BASSE
(`< SEUIL`) — pas simplement « en dernier ». Tôt+gated = ni famine ni engorgement. (2) **Un recensement de
masse (dénominateur d'une barre) se fait dans un tick DÉDIÉ**, pas en concurrence du traitement qu'il mesure :
tant que la base n'est pas posée, ce tick NE traite pas et consacre son budget au comptage. Filet anti-blocage
obligatoire : après N recensements incomplets (Drive énorme / plafond dur), accepter le compte PARTIEL comme
base approximative — ne JAMAIS laisser le recensement bloquer le traitement. (3) **Barre honnête** : numérateur
monotone (`traites` = déplacements réellement faits) ; base **re-basable** (si on sort plus que recensé, la base
suit → jamais > 100 %) ; « 100 % / terminé » posé sur le **vrai signal de fin** que le pipeline produit déjà
(une passe ne collecte plus rien), pas sur `traites >= base` qui ne converge pas ; pourcentage plafonné à 99 %
tant que ce n'est pas fini. (4) **Tracer le scénario sur plusieurs ticks** (recensement → pages → drainage →
fin) avant de valider — c'est ce qui révèle la non-convergence, pas une relecture. **Convergence** garantie par
le prédicat de skip stable (renommage `AAAA-MM-JJ_` ⇒ jamais re-collecté) + `00·À trier`/`_Doublons`/revue hors
des racines collectées.
**Règle durable ?** oui.

## 2026-06-23 — Mise en place de la boucle de leçons
**Contexte.** Scaffolding Phase 0 de DriveAI.
**Leçon.** Les leçons utiles sont celles qui changent une décision future : convention,
piège de quota, format de prompt. Le bruit (« j'ai créé un fichier ») n'a pas sa place ici.
**Règle durable ?** non — méta, sert juste de gabarit.

## 2026-06-23 — `gmail.readonly` interdit toute écriture, labels compris
**Contexte.** Phase 1 : la première version posait un label `DriveAI/traité` pour l'idempotence,
avec le scope `gmail.readonly`. La revue d'agents (sécurité + code-reviewer) a vu que
`thread.addLabel()`/`GmailApp.createLabel()` **lèvent une exception** sous `gmail.readonly` —
l'idempotence aurait planté à l'exécution et le pipeline aurait retraité en boucle (coût LLM + doublons).
**Leçon.** Tant que le garde-fou « Gmail lecture seule » tient, l'idempotence se porte **uniquement
par l'Index** (clé `messageId|i|nom|taille`), jamais par un label Gmail. Et la clé d'idempotence doit
inclure l'index de PJ, sinon deux PJ jumelles (même nom + taille) dans un mail s'écrasent (perte).
**Règle durable ?** oui.

## 2026-06-23 — Ordre des écritures d'état = idempotence
**Contexte.** Phase 1, écriture Index/Revue + dépôt Drive.
**Leçon.** L'inscription « c'est fini » (Index) se pose **en dernier**, après l'effet de bord
(dépôt Drive) et après la ligne Revue. Une coupure laisse alors la PJ non-indexée → re-traitée,
jamais un cas sensible perdu silencieusement. Sur un moteur Apps Script (coupure 6 min possible),
prévoir aussi : `LockService` (anti-chevauchement), garde-temps, et lecture d'état mise en cache
1×/run (pas une lecture Sheet par item).
**Règle durable ?** oui.

## 2026-06-23 — Workflow git : squash-merge + branche `claude/**` réutilisée
**Contexte.** Plusieurs PR successives depuis la même branche `claude/**`, sur un repo où les PR
sont **squash-mergées** et protégées par un ruleset. J'ai trébuché deux fois.
**Leçon.** Trois pièges et leurs parades :
1. Après un squash-merge, la branche distante `claude/**` n'est pas toujours supprimée et son tip
   **diverge** de `main`. **Ne pas force-push** (le ruleset le bloque) : refusionner l'ancien tip
   distant (`git merge origin/claude/...`) pour que le push redevienne un fast-forward.
2. Garder le diff de PR **propre** : avant chaque nouvelle unité de travail, repartir
   d'`origin/main` (`git reset --hard origin/main` ou `git merge origin/main`), sinon la PR
   ré-affiche tout le contenu déjà mergé.
3. Un ruleset « Require status checks » appliqué au **push** d'une branche crée un blocage
   œuf-poule (le check ne peut tourner qu'après le push). Ce check doit gater le **merge vers
   main**, pas le push des branches de travail.
**Règle durable ?** oui.

## 2026-06-23 — Calibrer un garde-fou sur données réelles, pas « par défaut »
**Contexte.** Premier run réel de la Phase 1 : ~25 docs, presque tous renvoyés en revue avec
`[REVUE] sensible`. Le prompt disait « `sensible=true` PAR DÉFAUT, false seulement si aucune
donnée d'identité ». Comme chaque document perso porte un nom, le LLM a tout marqué sensible →
**rien ne s'auto-classait** (la fonction était neutralisée), alors que les domaines étaient bien
devinés.
**Leçon.** Un garde-fou conservateur doit rester **étroit et précis** (ici : immigration/statut
+ fiscalité), pas « tout est protégé sauf preuve du contraire ». Toujours **calibrer sur un
échantillon réel** : un faux positif systématique a un coût (tout en revue = pas d'auto-rangement),
pas seulement le faux négatif. Garder le défaut prudent uniquement pour les réponses *malformées*
(parsing), pas comme posture de classement.
**Règle durable ?** oui.

## 2026-06-23 — Frontière : DriveAI tourne dans le compte Google de Marc
**Contexte.** Marc voulait que « je fasse tout », déploiement (`clasp push`) et exécution du moteur compris.
**Leçon.** DriveAI s'exécute dans le compte Google de Marc (Apps Script). La session Claude cloud
n'a **pas** accès à son projet Apps Script : impossible de `clasp push` (auth Google locale à Marc)
ni d'exécuter une fonction Apps Script à distance. Le connecteur MCP Google Drive est
**lecture/copie/création seulement** (pas de déplacement, suppression, ni édition de Sheet). Donc :
annoncer cette frontière **tôt**, ne jamais promettre de faire le déploiement/exécution à la place de
l'utilisateur, et **minimiser sa part via du code** (fonctions « un clic » type `rejouerLaRevue`).
C'est une protection (le moteur agit en tant que Marc), pas un manque d'outil contournable.
**Règle durable ?** oui.

## 2026-06-23 — `git push | tail` masque le code de sortie
**Contexte.** Un `git push … 2>&1 | tail -2 && echo OK` a affiché « PUSH OK » alors que le push était
**rejeté** : l'exit code d'un pipeline est celui du dernier maillon (`tail`), pas de `git push`.
**Leçon.** Ne jamais enchaîner une action git critique avec `| tail` puis `&&` : vérifier le code de
sortie sur la commande elle-même (`git push …; echo "exit=$?"`), ou `set -o pipefail`.
**Règle durable ?** oui.

## 2026-06-25 — Service avancé Drive non fiable via clasp → API REST
**Contexte.** Premier run réel : l'OCR échouait sur CHAQUE document avec
`ReferenceError: Drive is not defined` / `TypeError: Drive.Files.insert is not a function`.
Le `enabledAdvancedServices` (Drive v2) déclaré dans `appsscript.json` n'était pas actif dans le
projet de Marc après `clasp push` (le service avancé requiert souvent une activation manuelle dans
l'éditeur, et la déclaration manifeste seule ne suffit pas).
**Leçon.** Sur Apps Script, ne pas dépendre du symbole `Drive.*` (service avancé) pour du code qui
doit « juste marcher » après un `clasp push`. Appeler l'API Drive **en REST via `UrlFetchApp`**
(token `ScriptApp.getOAuthToken()`, scope `drive` déjà accordé — `DriveApp` fonctionne donc l'API
est active) : robuste, sans activation manuelle. Toujours faire dégrader l'OCR proprement (texte
vide → classement sur métadonnées) plutôt que planter.
**Règle durable ?** oui.

## 2026-06-25 — Changer le cycle de vie d'un fichier casse les invariants des outils voisins
**Contexte.** Phase 2 : le dépôt manuel **déplace** l'original (au lieu de le copier comme Gmail).
La revue de sécurité a vu que `rejouerLaRevue` mettait à la corbeille TOUS les `[REVUE]` en supposant
« ce sont nos copies, l'original est dans Gmail » — invariant vrai en Phase 1, **faux** dès qu'un
dépôt déplacé devient l'unique exemplaire. Sans correctif, l'outil de maintenance aurait supprimé des
originaux utilisateur (garde-fou « aucune suppression » violé).
**Leçon.** Quand on introduit un nouveau cycle de vie de fichier (move vs copy, suppression, fusion),
**auditer tout le code qui reposait sur l'ancien invariant** — surtout les outils de nettoyage/
maintenance. Ici : distinguer la source via l'Index (`drive|…` vs Gmail) et ne jamais corbeiller un
exemplaire unique (le renvoyer dans `00·À trier` pour rejeu). Un « déplacement » n'est pas une
suppression, mais il rend l'original irremplaçable côté scan.
**Règle durable ?** oui.

## 2026-06-25 — Borner TOUT traitement par lot Drive par le garde-temps, pas seulement la boucle docs
**Contexte.** Phase 2 : `creerDossiersEntitesValidees_` (création des dossiers d'entités validées)
tournait en tête de tick, **hors** du garde-temps, et faisait ~7-8 appels Drive par entité. Si Marc
valide 30-50 entités d'un coup, ce sont des centaines d'appels synchrones AVANT le moindre document
— risque de couper les 6 min et de tout rejouer à chaque tick.
**Leçon.** Sur Apps Script, **chaque** phase qui fait des appels Drive/Sheet en boucle (pas seulement
la boucle principale de documents) doit être bornée par le garde-temps partagé ET un plafond par run ;
le reste est repris au tick suivant. Idem : ne jamais hasher (`computeDigest`) un blob sans la même
borne de taille que l'OCR (mémoire). Vérifier le coût d'un re-traitement sur échec (re-OCR + re-LLM).
**Règle durable ?** oui.

## 2026-06-25 — Une entité non validée ne doit pas bloquer le classement (re-piège « tout en revue »)
**Contexte.** Premier run réel de la Phase 2 : **tous** les dépôts sont partis en revue avec
`[REVUE] entité à valider`. Le PLAN disait « entité inconnue → 00·À vérifier (création via revue) » ;
or au départ AUCUNE entité n'est validée, donc chaque doc portant une entité devinée (Robovic,
IMERIR…) partait en revue → l'auto-rangement était **neutralisé**. Exactement le même piège que le
flag `sensible` trop large.
**Leçon.** L'entité est un **enrichissement opt-in**, jamais un frein. Entité inconnue/en attente →
**classer au niveau domaine** (comportement Phase 1) **et** proposer l'entité (`en_attente`) pour
plus tard ; la création de dossier d'entité, elle, attend la validation (anti-prolifération préservé).
Règle générale : un nouveau niveau de granularité doit **dégrader vers le niveau précédent** quand
l'info manque, jamais envoyer en revue. Toujours re-tester sur du réel : « est-ce que ça range encore
au premier run, avant toute validation ? »
**Règle durable ?** oui.

## 2026-06-25 — Automatiser une op de maintenance ⇒ retirer toute action irréversible du chemin auto
**Contexte.** Pour aller « full auto », j'ai voulu déclencher `rejouerLaRevue` automatiquement sur
changement de version. La flotte (sécurité + quotas) a bloqué : cette fonction met des copies à la
**corbeille** et **vide tout l'Index**, en s'appuyant sur l'Index qu'elle détruit elle-même. En
manuel (un clic supervisé) ça passe ; en **auto sous garde-temps**, une coupure laisse un état
incohérent et un collapse de noms peut corbeiller un **exemplaire unique** (perte de fichier).
**Leçon.** Quand on fait passer une opération de maintenance du **manuel** à l'**automatique** :
(1) **aucune action irréversible** dans le chemin auto (déplacement réversible OK, jamais de
corbeille/suppression — garder ça sur le chemin manuel explicite) ; (2) **borner** (garde-temps
partagé + plafond/run) et rendre **reprenable** (ne marquer « fait » qu'une fois TOUT consommé,
jamais avant) ; (3) raisonner par **identifiant stable** (`fileId`), pas par nom (le nom collisionne) ;
(4) ne pas invalider l'idempotence de ce qui n'est pas concerné (ne vider que les lignes ciblées de
l'Index, pas tout — sinon re-OCR/re-LLM inutile = coût). Faire **re-auditer** le diff par la flotte.
**Règle durable ?** oui.

## 2026-06-26 — Auto-déploiement : 2 pièges qui l'ont rendu muet
**Contexte.** L'auto-déploiement (`deploy.yml` sur `push: main`) ne déployait JAMAIS après les
auto-merges : pendant des heures, le moteur de Marc tournait sur du vieux code alors que `main` avait
4 PR d'avance. Deux causes cumulées :
1. **Un merge fait par le bot `GITHUB_TOKEN` (l'auto-merge) ne déclenche pas les workflows `on: push`**
   (sécurité anti-récursion de GitHub Actions). Donc `deploy.yml` ne se lançait que sur le
   `workflow_dispatch` manuel, jamais sur les merges automatiques.
2. **`clasp push` (v3) échoue « Premature close » en Node 22** ; il fonctionne en Node 20. En passant
   les actions en v5 j'avais aussi bougé `node-version` 20→22 → tous les déploiements suivants auraient
   échoué même s'ils s'étaient déclenchés.
**Leçon.** (a) Pour déclencher un workflow APRÈS un merge automatique, ne pas compter sur `on: push` :
le workflow d'auto-merge doit **dispatcher explicitement** le déploiement (`gh workflow run deploy.yml`,
permission `actions: write`), ou utiliser un PAT. (b) Épingler la version de Node testée pour les outils
CLI sensibles (clasp v3 → Node 20) ; un bump « cosmétique » de version d'action peut entraîner un bump
de runtime qui casse l'outil. (c) **Vérifier qu'un déploiement “automatique” a RÉELLEMENT tourné et
réussi** (lire les runs de l'Action), pas seulement qu'il est « censé » se déclencher.
**Règle durable ?** oui.

## 2026-06-27 — Reclassement de masse auto : convergence par prédicat de skip + garde zone protégée multi-parents
**Contexte.** Marc voulait que **tout** son Drive existant soit reclassé/renommé/rangé, sans clic.
Mécanique retenue (P2.6) : un rangement initial gated par `CONFIG.RANGEMENT_TAG` renvoie au fil des
ticks le contenu « en vrac » (nom non `AAAA-MM-JJ_`) des domaines vers `00·À trier`, et le pipeline
le reprend. Deux pièges relevés par la flotte avant merge :
1. **Détachement de la zone protégée** (BLOQUANT sécurité) : déplacer un fichier en retirant *tous*
   ses parents sauf la cible détache un fichier **multi-parents** de `04 · Immigration`. Le garde-fou
   « ne pas parcourir le dossier protégé » ne suffit pas : le fichier est atteint via son AUTRE parent.
2. **Boucle de coût** : si un fichier reclassé pouvait être re-collecté indéfiniment, on re-paie OCR+LLM
   à chaque tick.
**Leçon.** Pour un reclassement de masse **automatique** : (a) la convergence doit reposer sur un
**prédicat de skip stable** que le pipeline produit lui-même — ici le renommage `AAAA-MM-JJ_` garantit
qu'un fichier traité n'est **jamais** re-collecté (vérifier que le renommeur produit TOUJOURS ce format) ;
ne figer le « fait » que lorsqu'une passe complète ne collecte **plus rien**. (b) Le garde de zone
protégée doit **remonter toute la chaîne d'ancêtres** (multi-parents, profondeur bornée), pas tester
l'appartenance directe — et s'appliquer **deux fois** : au filtre de collecte ET juste avant la mutation
(défense en profondeur). (c) Toute op de maintenance auto reste **déplacement seul** (jamais corbeille),
**bornée** (garde-temps + plafond/run) et **reprenable** ; ne pas enchaîner un sous-run (`tickDriveAI`)
sans vérifier qu'il reste du budget (sinon dépassement de la limite dure 6 min). Re-auditer par la flotte.
**Règle durable ?** oui.

## 2026-06-30 — Pagination par offset sur une fenêtre Gmail MOUVANTE = stagnation silencieuse
**Contexte.** Phase 3 (scan de tous les mails récents pour détecter tâches/rdv) reprenait le
même schéma que le scan PJ existant : `debutPage = 0` réinitialisé à chaque tick, puis pagination
par offset croissant. En volume réaliste (quelques centaines de mails sur 30 jours), un audit
(apps-script-quota) a tracé un scénario concret et trouvé un BLOQUANT : `newer_than:30d` est une
fenêtre de recherche MOUVANTE — un nouveau mail s'insère toujours en TÊTE (tri du plus récent au
plus ancien) et décale tous les offsets suivants. Résultat : une fois les ~200 messages les plus
récents indexés (1er tick), CHAQUE tick suivant repart de l'offset 0, retombe sur ces mêmes ~200
messages déjà indexés (vérification rapide mais qui consomme quand même le plafond/run), et
n'atteint JAMAIS le reste de l'historique au-delà — un **plateau stable**, pas une reprise
normale au tick suivant. Le scan PJ existant (`traiterGmail_`) a la même structure mais y échappe
en pratique car son volume (mails AVEC pièce jointe) reste sous le plafond/run — c'est l'élargissement
de volume qui a rendu le piège réel.
**Leçon.** Sur une recherche dont le jeu de résultats change entre deux appels (nouveaux éléments
insérés en tête), un **offset numérique persisté ou réinitialisé ne garantit PAS la progression** :
il faut soit (a) un curseur ancré sur une valeur ABSOLUE et stable (ici une date, via `before:`,
persistée en Script Property, qui n'avance QUE vers le passé), combiné à (b) un scan séparé et
borné depuis le début (offset 0) pour capter les nouveaux éléments, qui s'arrête tôt dès qu'il
détecte un « mur » de contenu déjà traité (pas la peine d'aller plus loin, c'est le job du scan
ancré). Un offset numérique seul ne fonctionne QUE sur un jeu de résultats stable entre les appels.
Toujours **tracer un scénario concret à plusieurs ticks** (pas juste « ça semble boucler ») avant
de valider une pagination — c'est ce traçage qui a révélé le plateau, pas une relecture superficielle.
**Règle durable ?** oui.

## 2026-06-30 — Vérifier la prod par un signal NON caché ; doublons signalés en masse = file de revue saturée
**Contexte.** Après déploiement du grand rangement de l'ancien Drive (P2.7), impossible de lire l'état
réel : l'outil de lecture de la Google Sheet servait obstinément un **cache figé** (≥7 lectures identiques,
antérieures au déploiement), alors que `modifiedTime` avançait (moteur vivant). La vérif via la Sheet était
donc aveugle. En recherchant directement dans **Drive** (fichiers récemment modifiés, contenu des dossiers
`00·À trier` / `00·À vérifier` par `parentId`), un signal NON caché a montré : (a) le rangement marche (vieux
fichiers déplacés, un doc renommé+classé) ; (b) la file de revue se **remplissait de dizaines de
`[REVUE] doublon`** — l'ancien Drive contient beaucoup de copies (relevés de paie hebდo, docs scolaires).
Le garde-fou « doublon signalé, jamais supprimé » envoyait CHAQUE doublon en revue → au volume du rangement,
ça neutralise le bénéfice (énorme pile manuelle), même piège que « garde-fou trop large ».
**Leçon.** (1) Quand un canal de lecture d'état est en cache/indisponible, **vérifier la prod par un autre
signal indépendant** (ici la recherche Drive : `modifiedTime`, contenu de dossiers par `parentId`) plutôt que
conclure « je ne peux pas voir » — ne jamais affirmer un résultat positif sans preuve, mais chercher la preuve
ailleurs. (2) Un garde-fou « signaler en revue » qui était fin sur un flux normal devient **saturant** sur un
traitement de masse. Router les doublons NON sensibles vers un dossier `_Doublons` dédié (déplacement seul,
jamais supprimé — garde-fou §2 intact) garde la file de revue utilisable ; le cas SENSIBLE doit rester
prioritaire (un doublon sensible va toujours en revue, jamais dans `_Doublons`). Re-tester sur du réel :
« est-ce que la file de revue reste exploitable au volume du grand rangement ? »
**Règle durable ?** oui.

## 2026-07-01 — Une op de maintenance auto qui tourne AVANT/SANS protéger l'intake gèle tout le pipeline
**Contexte.** En prod, la file `00·À trier` s'est retrouvée GELÉE : ~20 fichiers déplacés par le grand
rangement y stagnaient des heures, aucun classé, et plus rien n'était traité (ni PJ Gmail, ni intentions),
alors que le moteur « tournait » (Sheet réécrite chaque tick). Diagnostic (sans pouvoir lire le Journal — cache
de lecture figé — donc par lecture du CODE + signaux Drive directs) : dans `tickDriveAI`, `appliquerRangementInitial_`
(a) tournait AVANT le traitement de la file qu'il alimente, et (b) n'était PAS enveloppé de try/catch. Le `try`
de `tickDriveAI` n'a qu'un `finally` (pas de `catch`) → une exception dans la collecte du rangement (walk de
l'ancien Drive) tuait tout le tick AVANT Gmail/dépôts/intentions, à chaque tick, indéfiniment.
**Leçon.** (1) Toute opération SECONDAIRE (maintenance auto : rejeu de version, grand rangement, ajustement de
déclencheur) doit être **enveloppée d'un try/catch** dans le tick — « un échec ne doit JAMAIS bloquer l'intake ».
Si le code l'écrit déjà en commentaire pour CERTAINES étapes, vérifier que TOUTES le respectent (l'ajout d'une
nouvelle étape non protégée juste avant l'intake est le piège). (2) Une étape qui ALIMENTE une file (rangement →
`00·À trier`) doit passer APRÈS l'étape qui la DRAINE, et seulement s'il reste du budget — sinon elle s'affame
elle-même et affame le traitement (drainer avant d'alimenter). (3) Symptôme « le moteur écrit son état mais ne
traite plus rien » ⇒ suspecter un plantage NON capturé ou une famine de budget dans une étape AMONT du traitement.
Quand le canal d'état (Journal) est illisible, diagnostiquer par le CODE (quelle étape n'est pas protégée ?) et
par des signaux Drive directs (contenu des dossiers, `modifiedTime`), pas en attendant le Journal.
**Règle durable ?** oui.

## 2026-07-01 — Un garde-fou à fort taux de faux positifs = corriger la CAPACITÉ sous-jacente, pas (que) le garde-fou
**Contexte.** Le garde-fou « OCR vide sur un dépôt → revue » (P2.7, posé pour ne jamais classer à l'aveugle
un passeport scanné illisible) envoyait en réalité EN MASSE les fichiers Office de Marc (`.docx`, `.ppt` :
CV, TP, présentations) en revue avec le libellé trompeur « sensibilité indéterminable (OCR vide) ». Cause :
l'extracteur (`Ocr.gs`) ne traitait QUE `text/*`, PDF et images — un `.docx` tombait sur `return ''`, donc
« OCR vide », donc revue. Marc : « ya des CV que tu as pas classés, tu devrais savoir faire » — à raison.
Le garde-fou était correct ; c'est la CAPACITÉ (lecture du texte) qui avait un trou sur un type de fichier
très courant, ce qui faisait déborder le garde-fou et neutralisait le classement de tout un pan du Drive.
**Leçon.** (1) Quand un garde-fou « en cas de doute → revue » se met à router en revue une grande part d'un
flux normal, ne pas élargir/relâcher le garde-fou : **regarder la CAPACITÉ qu'il protège** et vérifier
qu'elle couvre les cas courants. Ici : Google Drive convertit nativement `.docx`→Docs, `.ppt`→Slides,
`.xlsx`→Sheets (conversion, PAS OCR — le texte existe déjà) via le même upload REST que l'OCR, avec le
type Google cible en métadonnée et SANS `ocrLanguage`. (2) Un libellé de revue doit décrire la VRAIE cause
(« format non lu » ≠ « sensibilité indéterminable ») — un libellé trompeur a fait croire à Marc que ses CV
étaient traités comme confidentiels. (3) Après avoir corrigé la capacité, **re-trier l'existant** : bumper
`CONFIG.VERSION` renvoie automatiquement les dépôts partis en revue dans le circuit (déplacement seul, borné,
reprenable) — les fichiers mal étiquetés se re-classent, les sensibles re-partent en revue (zone protégée
préservée). Toujours vérifier sur du réel (recherche Drive : où sont VRAIMENT allés les fichiers ?).
**Règle durable ?** oui.

## 2026-07-01 — Le propriétaire peut relâcher un garde-fou « non négociable » : informer, confirmer, mettre à jour la constitution, préserver l'irréversible
**Contexte.** Le garde-fou §1 (immigration/fiscal/`sensible=true` → TOUJOURS en revue, jamais rangé auto)
était marqué NON NÉGOCIABLE dans `CLAUDE.md`. Après que le lecteur Office a vidé la revue de tous les faux
positifs, il n'y restait que les vrais documents sensibles (attestations immigration, 5 copies d'un passeport).
Marc (propriétaire du Drive ET du projet) a explicitement demandé à les auto-classer aussi. Tension : une règle
« non négociable » de SA propre constitution vs sa demande directe sur SES données.
**Leçon.** Un garde-fou « non négociable » protège surtout contre des décisions non voulues/non informées — il
n'est pas au-dessus du propriétaire qui le change en connaissance de cause. Procédure quand le propriétaire
demande de relâcher un tel garde-fou : (1) **ne pas exécuter en silence** — expliquer clairement CE QUI change
et le RISQUE concret (ici : un doc d'immigration mal classé pendant un process peut coûter cher), recommander
l'option prudente, et demander UNE confirmation explicite (pas re-litiger dix fois). (2) Une fois confirmé,
**exécuter pleinement** et **mettre à jour la constitution** (`CLAUDE.md` §-en-question) pour refléter la
nouvelle politique — sinon la flotte re-bloquera au nom de l'ancienne règle et le code divergera de la doc.
(3) **Préserver ce qui reste vraiment irréversible/dangereux** même dans le relâchement : ici on classe le
sensible MAIS on garde « aucune suppression », « doublon → `_Doublons` (jamais effacé) » et « ne jamais
détacher un fichier déjà sous 04·Immigration ». (4) **Re-auditer contre la NOUVELLE règle** (dire explicitement
à la flotte que la politique a changé sur décision du propriétaire), pas contre l'ancienne. (5) Distiller quels
docs distinguent vraiment un « garde-fou de sécurité » (protège l'utilisateur d'une erreur) d'un « garde-fou de
préférence » (un défaut que le propriétaire peut changer) — seul le second se relâche sur simple demande.
**Règle durable ?** oui.

## 2026-07-02 — Few-shot : n'injecter que les champs STABLES pour la clé de sélection
**Contexte.** Chantier #5 (boucle d'apprentissage, ADR-0003) : à chaque classement, on sélectionne les
corrections passées **du même émetteur** et on les injecte en exemples few-shot dans le prompt LLM. Le
premier jet formatait chaque exemple avec `domaine`, `catégorie`, `entité` ET `type`.
**Leçon.** Exemples few-shot : n'injecter que les champs STABLES pour la clé de sélection. La sélection se
fait par ÉMETTEUR. Le domaine et l'entité sont stables par émetteur (EDF → toujours `03 · Logement`/EDF),
mais le TYPE de document ne l'est PAS (un même émetteur envoie une facture, puis un contrat, puis une
attestation). Injecter un `type` passé enseigne au modèle une fausse régularité et **biaise `type_doc`** du
document courant (que le modèle devrait déduire du CONTENU, pas de l'émetteur). Règle générale : quand on
construit un bloc few-shot sélectionné par une clé K, n'inclure que les champs corrélés à K ; exclure tout
champ qui varie d'un item à l'autre à K constant. Détecté par le `llm-cost-optimizer` (bonus : moins de
tokens). Corollaire coût : le few-shot borné (top-N, seuil de pertinence) reste négligeable (~+0,05 $/mois)
et est déjà capté par la mesure `usage.input_tokens` — le vrai poste de coût reste l'OCR et l'escalade Sonnet.
**Règle durable ?** oui.

## 2026-07-02 — Redémarrage de conteneur : le travail est sauf sur le DISTANT, récupérer par fast-forward
**Contexte.** En pleine session, le conteneur a redémarré et re-cloné le dépôt : le checkout local s'est
retrouvé sur un VIEUX commit (`P1-14`), sans le dossier `test/`, sans tout le travail des chantiers #1→#5.
Panique possible : « tout est perdu ». En réalité, tout était **poussé sur le distant** (branche à jour,
`main` à jour via les merges #42/#43/#44).
**Leçon.** (1) Un checkout local incohérent après reprise ≠ travail perdu. **Vérifier le distant d'abord** :
`git fetch origin --prune` puis `git branch -r -v` — la branche `origin/claude/**` porte le vrai tip. (2)
**Récupérer par fast-forward**, pas par reset : `git merge --ff-only origin/<branche>` restaure l'état sans
rien détruire (le `git reset --hard` est refusé par le garde de sécurité, à raison — il détruirait un
éventuel travail non commité). (3) **Prouver qu'on n'a rien perdu** : `git diff origin/main HEAD` doit être
vide une fois resynchronisé (ou ne montrer que le travail non encore mergé). (4) **Piège récurrent
squash-merge + branche réutilisée** : après plusieurs PR squashées, `git merge origin/main` reconflit
toujours sur les mêmes fichiers (VERSION, docs de politique, moteur) car l'historique diverge (vrais commits
vs squash) alors que le CONTENU est identique. Si la branche n'a AUCUN travail unique non mergé, résoudre en
prenant `--theirs` (origin/main = la vérité accumulée) sur TOUS les fichiers en conflit → le contenu de la
branche redevient == `main`. Toujours re-vérifier par les tests (les marqueurs de conflit cassent la syntaxe
`.gs` → chute brutale du nombre de tests = signal de marqueurs résiduels).
**Règle durable ?** oui (opérationnel — l'essentiel du volet « coder » est déjà dans la puce Git de `CLAUDE.md`).

## 2026-07-02 — Re-traiter un doc DÉJÀ CLASSÉ : 3 verrous posés par le pipeline lui-même
**Contexte.** Chantier #8 (migration de l'existant vers la nouvelle taxonomie, ADR-0002). Première idée
naïve : réutiliser le grand rangement (renvoyer les docs classés dans `00·À trier`). Analyse avant code :
trois mécanismes du pipeline — conçus pour protéger le flux normal — auraient chacun neutralisé ou
saboté la migration en silence.
**Leçon.** Re-traiter un document DÉJÀ CLASSÉ (migration, rejeu) exige de lever 3 verrous que le pipeline
pose lui-même : (1) sa clé d'idempotence existante (`drive|`/`messageId|`/`shared|`) bloque tout
re-traitement — utiliser une clé DÉDIÉE par campagne (`migre|<tag>|fileId`), ADDITIVE (jamais supprimer
les lignes d'Index des autres sources), qui sert AUSSI de prédicat de convergence de la collecte ;
(2) son empreinte MD5 est déjà dans l'Index → le fast-path doublon en ferait un « doublon de lui-même »
(tout le Drive migré partirait en `_Doublons`) — bypass EXPLICITE (`src.ignorerDoublon`) limité à ce
chemin, l'empreinte restant ré-inscrite ; (3) un refus de mutation (zone protégée stricte) doit être
INSCRIT sous la clé de campagne (fichier non touché) sinon il est re-collecté à chaque passe et la
campagne ne converge jamais. Corollaire déjà vécu mais re-confirmé : quand le renommeur évolue
(granularités `AAAA_`/`AAAA-MM_`), TOUS les prédicats « déjà rangé » (rangement, recensement) doivent
suivre, sinon boucle infinie de collecte.
**Règle durable ?** oui.

## 2026-07-02 — Ajouter un scope OAuth = arrêt TOTAL du moteur (chien de garde inclus) jusqu'à ré-autorisation
**Contexte.** Le chantier #6 a ajouté le scope `forms` à `appsscript.json` ; le déploiement auto l'a poussé
le matin. Constat en fin de journée par signaux Drive : moteur muet TOUTE la journée (fichiers déposés dans
`00·À trier` à 01:04 encore intouchés à 18 h), AUCUNE alerte reçue, et reprise seulement après l'exécution
manuelle de `tickDriveAI` par Marc (heartbeat repris, formulaire créé à 18:45). Cause : quand un déploiement
étend `oauthScopes`, Google invalide l'autorisation du script → TOUS les déclencheurs échouent, Y COMPRIS le
chien de garde (ADR-0004) qui meurt avec la panne qu'il devait signaler. Piège de diagnostic secondaire :
la recherche Drive (`search_files`, index de recherche) ne voyait pas le formulaire fraîchement créé —
`list_recent_files` (recency) l'a montré immédiatement.
**Leçon.** (1) Tout merge qui étend `oauthScopes` doit prévenir Marc AVANT (le moteur s'arrêtera NET au
déploiement, sans alerte possible) et regrouper les nouveaux scopes en un seul merge — jamais trois pannes
pour trois scopes. (2) Après une ré-autorisation, VÉRIFIER la reprise par signaux Drive indépendants
(heartbeat Sheet, artefact attendu — ex. le formulaire —, file `00·À trier` qui se draine) : le chien de
garde ne peut PAS couvrir cette panne-là. (3) Pour vérifier une création Drive fraîche, utiliser
`list_recent_files` (recency), pas la recherche (l'index de recherche a du retard).
**Règle durable ?** oui.

## 2026-07-02 — Retirer du code mort : jamais par regex multi-fonctions, et poser un filet de SURFACE
**Contexte.** L'audit « no dead code » retirait ~8 fonctions mortes. Deux fois de suite, une regex
`/\*\*.*?\*/\nfunction X.*?\n\}/s` a AVALÉ des fonctions voisines : 512 lignes de Maintenance.gs
(dont `rangerToutLeDrive`, `dequarantaine`) puis `deciderRoutage_` entière dans Router.gs — le CŒUR
du routage. Le pire : `node --check` passait (syntaxe seule) et les 150 tests unitaires passaient
AUSSI (chaque test mocke ses dépendances → un appel inter-module vers une fonction disparue ne casse
aucun test). Seule la passe de vérification ADVERSARIALE multi-agents (ultracode) l'a attrapé — en
prod, chaque document serait parti en quarantaine après 3 ReferenceError.
**Leçon.** (1) Retirer une fonction = analyse de FRONTIÈRES (remonter la docstring contiguë, descendre
à la 1ʳᵉ `}` colonne 0), avec assertions de PRÉSENCE des voisines après coup — jamais une regex non
ancrée multi-lignes. (2) Des tests unitaires mockés ne protègent PAS le contrat inter-modules : poser
un test de SURFACE qui charge TOUT le moteur ensemble et vérifie que chaque fonction du contrat interne
est définie (`test/surface-moteur.test.js`) — il attrape toute disparition accidentelle pour toujours.
(3) Après un lot de retraits, une vérification indépendante (relecture du diff par un agent qui
inventorie les fonctions avant/après) vaut plus que la relecture de l'auteur.
**Règle durable ?** oui.

## 2026-07-02 — Campagne Gmail historique : un ensemble « figé » n'a pas un ORDRE figé ; la complétude vient d'une passe de vérification, pas du schéma de pagination
**Contexte.** Chantier #12 (classer tout l'historique de PJ Gmail). Le design v1 — curseur rétrograde
« jour le plus ancien traité + 1 » — semblait appliquer la leçon « pagination mouvante » ; la vérification
adversariale (3 agents) l'a démoli : Gmail trie les fils par leur DERNIER message, donc un vieux fil
ravivé téléportait le curseur des mois en arrière (PJ des fils intermédiaires perdues À JAMAIS), un jour
à plus d'une page de fils créait un plateau infini, et l'absence de sous-plafond épuisait le quota runtime
(~90 min/j) en 2 h. Le design v2 — ancre FIXE `before:<ancre>` posée une fois + offset persistant sur
l'ensemble « immuable » — a été contre-attaqué à son tour : l'APPARTENANCE à l'ensemble est stable, mais
l'ORDRE ne l'est pas (fil ravivé par un message SANS PJ = invisible du scan vivant car Gmail matche les
opérateurs PAR MESSAGE ; suppression en zone déjà scannée = un fil innocent glisse sous l'offset ; erreur
transitoire = fil sauté). Trois pertes silencieuses, UN antidote déjà connu du projet : « terminé »
seulement quand une passe COMPLÈTE ne collecte plus rien (offset remis à 0 si la passe a eu de l'activité ;
re-passe quasi gratuite car les PJ indexées ne coûtent que des métadonnées).
**Leçon.** (1) Sur Gmail, une requête figée fige l'appartenance, PAS l'ordre (tri par dernier message,
suppressions) : l'offset persistant est un moyen de PROGRESSION, jamais une preuve de COMPLÉTUDE — la
complétude vient de la règle « une passe qui ne collecte plus rien », appliquée à TOUTE campagne bornée
(c'est la même règle que migration/rangement ; elle guérit d'un coup fils déplacés, suppressions et
erreurs transitoires, pourvu qu'un fil en échec répété soit ABANDONNÉ avec trace après N essais pour ne
pas bloquer la terminaison — et comme l'ordre peut muter PENDANT la passe de vérification elle-même,
exiger DEUX passes propres consécutives, quasi gratuites). (2) Les plafonds par run se vérifient à la
granularité de l'UNITÉ DE COÛT réelle (la PJ, pas le message : un message à 20 PJ crève le mur des
6 min sans `finally`) et à CHAQUE niveau de boucle (une page de fils bavards sans PJ « réelles » fait
des centaines d'appels Gmail après le budget si la garde n'est qu'au niveau PJ). (2bis) **Un plafond
par RUN ne borne pas la JOURNÉE** : multiplié par 288 ticks, « 2 inédites ≈ 25 s » = 2 h/j, PLUS que le
quota runtime (~90 min/j) — tous les déclencheurs (chien de garde inclus) gelés chaque après-midi. Une
campagne de fond doit se BUDGÉTER PAR JOUR (ms réelles persistées dans une Property datée, plafond
explicite qui laisse le vivant respirer). (2ter) Un compteur d'échecs sur une unité REJOUABLE (page)
doit compter par PROGRÈS (complétion de page = une fois par passe), jamais par re-rencontre (rejeu
toutes les 5 min = 3 essais brûlés en 15 min sur une erreur transitoire) ; bonus : une erreur qui
guérit avant la complétion ne laisse aucune trace. (3) La complémentarité entre deux scans (« le
vivant couvre ce cas ») doit être vérifiée au niveau où le moteur de recherche MATCHE (par message,
pas par fil) — c'est là que se cachait le trou ; et `before:` étant exclusif face à un `newer_than:`
potentiellement glissant, garantir le chevauchement PAR CONSTRUCTION (ancre −29 j, pas −30). (4) Un
design de pagination ne se valide QUE par traçage de scénarios multi-ticks ET par contre-attaque
adversariale indépendante — TROIS rondes ont chacune trouvé des pertes que l'auteur avait ratées.
**Règle durable ?** oui.

## 2026-07-02 — Nouvel effet de bord dans un pipeline gardé : TOUTES les gardes en amont, sur TOUS les chemins
**Contexte.** Chantier #14 : pose d'un flag `important|<messageId>` dans `traiterMessagePourIntentions_`.
Le pipeline avait déjà deux gardes zone protégée (expéditeur/sujet AVANT le mini-check, corps AVANT
l'extraction). J'ai posé le flag entre les deux — et créé un chemin (« important sans action ») qui
retournait avant même de lire le corps. Résultat démontrable trouvé par la revue flotte (BLOQUANT) :
un mail immigration/fiscal aux expéditeur/sujet neutres mais au corps explicite (« votre demande de
résidence permanente IRCC… ») serait apparu dans la section « À traiter » du résumé hebdo avec lien —
la Phase 3 mettait en avant un mail protégé, en contradiction avec l'invariant écrit trois lignes plus
haut dans le code. Fix : lire le corps et re-vérifier la garde dessus AVANT la pose du flag, sur les
DEUX chemins (le chemin « rien vu » restant gratuit — corps jamais lu — verrouillé par test).
**Leçon.** Insérer un nouvel EFFET DE BORD (flag, ligne d'état, notification) dans un pipeline gardé
exige de vérifier que CHAQUE garde existante est en amont de l'effet sur CHAQUE chemin d'exécution —
y compris les chemins de sortie anticipée que le nouvel effet CRÉE lui-même (ici « important sans
action » court-circuitait la lecture du corps qui portait la garde). Réflexe : tracer tous les
`return` entre les gardes et le nouvel effet, et poser un test par garde × chemin. Un commentaire
« les gardes ci-dessus couvrent » n'est pas une preuve — c'est précisément là que la revue a trouvé
le bloquant.
**Règle durable ?** oui.

## 2026-07-03 — Gros check-up : une panne de COMPTE API n'est pas un échec de document, et un canal d'alerte jamais testé n'existe pas
**Contexte.** Check-up général demandé par Marc après la fin de la roadmap v2. Par signaux Drive
indépendants (Sheet exportée en xlsx et analysée hors-ligne — la lecture d'état MCP ne montre que le
1ᵉʳ onglet en CSV) : moteur vivant, MAIS crédit API Anthropic épuisé depuis le 01-07 20:56 (1330
échecs HTTP 400 « credit balance too low » sur 2 jours), ~89 documents quarantainés À TORT (chacun a
« brûlé ses 3 essais » contre un mur de plateforme — dont ~64 photos Facebook physiquement coincées
dans 00·À trier, sautées SUR PLACE par l'idempotence à chaque tick), et 597 tentatives d'alerte mail
TOUTES mortes en silence : `Session.getEffectiveUser()` exige un scope (userinfo) que le manifeste
n'a jamais eu — le canal d'alerte (quarantaines, chien de garde, résumé hebdo) n'a JAMAIS fonctionné,
et personne ne s'en était aperçu parce qu'aucun envoi n'avait été vérifié de bout en bout.
**Leçon.** (1) **Classer les échecs par ORIGINE avant de les compter** : une erreur de PLATEFORME
(crédit épuisé, clé invalide — détectable au code/corps HTTP) n'est jamais imputée au document, sinon
une panne de compte transforme toute la file en quarantaine (3 essais brûlés par doc) et le rétablissement
ne répare rien (l'idempotence saute les quarantainés SUR PLACE). Pattern : détecter → suspendre les
appels du run (échec rapide sans réseau) → ne rien compter → re-sonder au run suivant. (2) **Un canal
d'alerte n'existe que s'il a été vérifié de bout en bout au moins une fois** (un mail réellement reçu) —
ici l'erreur (`getEffectiveUser` sans scope) vivait dans le `try/catch` même qui devait la signaler.
Corollaire : ne jamais dépendre d'un scope pour trouver le DESTINATAIRE des alertes (adresse en Script
Property `DriveAI_EMAIL`, jamais de nouveau scope = jamais de gel). (3) Un gros check-up se fait par
signaux INDÉPENDANTS et croisés : fichiers récents Drive (recency), contenu réel des dossiers par
parentId, et la Sheet d'état exportée entière (xlsx → analyse locale) — le Journal seul aurait montré
la panne, mais pas les 64 fichiers coincés sur place ni le fait que les alertes n'étaient jamais parties.
(4) Après un conteneur restauré, TOUJOURS `git fetch` avant de diagnostiquer : des refs distantes
rassies font « disparaître » des fichiers et inventer des régressions (fausse alerte Phase 4 ⬜ vécue
dans ce même check-up).
**Règle durable ?** oui.

## 2026-07-06 — Une panne d'une dépendance (LLM) se propage aux QUOTAS des autres (Gmail) si les scans tournent à vide
**Contexte.** Reprise après la panne de crédit (R1). Le crédit rechargé, le moteur restait bloqué :
`Service invoked too many times for one day: gmail` sur tous les scans. Cause : pendant 4 jours de
panne LLM, RIEN ne s'indexait — or les scans Gmail s'arrêtent sur « page entièrement indexée » ou
avancent par curseurs qui ne progressent que si les items sont marqués. Résultat : chaque tick
re-parcourait TOUTE la fenêtre (getMessages/getAttachments en masse) pour zéro progrès → des dizaines
de milliers de lectures Gmail/jour → quota quotidien épuisé → moteur re-bloqué 24 h APRÈS la recharge
(le quota ne se réinitialise qu'à minuit heure du Pacifique).
**Leçon.** (1) Quand une dépendance en aval (LLM) est en panne, il ne suffit pas de protéger les
DONNÉES (R1 : aucun échec compté) — il faut suspendre les PRODUCTEURS en amont (scans, collectes) :
un scan qui ne peut rien marquer est une boucle stérile qui consomme les quotas d'un AUTRE service et
transforme une panne d'un jour en panne de deux. Pattern : panne PERSISTÉE (Script Property datée) →
les runs suivants suspendent leurs sources sans un seul appel → re-sonde bornée (≤ 1 run normal par
heure) → rétablissement auto au 1ᵉʳ appel réussi (Property effacée + journal). (2) Tout mécanisme
d'arrêt de scan fondé sur « déjà vu/déjà indexé » doit être audité pour le cas « rien ne s'indexe » :
c'est là que le coût par tick explose silencieusement. (3) Un log répétitif par tick (« fichier natif
laissé en place ») doit être dédupliqué à la SOURCE (une fois par objet, Property bornée) — 576
lignes/jour de bruit avaient enterré les vrais signaux pendant le diagnostic.
**Règle durable ?** oui.

## 2026-07-06 — C16 : une clé d'idempotence doit encoder TOUT l'état qui commande la décision
**Contexte.** Tri Gmail natif (#16, ADR-0012), 2ᵉ ronde adversariale avant merge. La clé
d'idempotence initiale du tri était `tri|<fil>|<tsDernierMessage>` : correcte pour « ne pas re-trier
deux fois », mais elle rendait le cœur du rôle Cowork IMPOSSIBLE — un mail trié non-lu puis LU par
Marc ne changeait ni de fil ni de ts, donc n'était JAMAIS re-trié, donc jamais archivé. Trouvé par
revue adversariale (pas par les tests unitaires : chacun validait sa règle isolée).
**Leçon.** (1) Une clé d'idempotence n'est pas « un identifiant » : c'est un INSTANTANÉ de l'état.
Elle doit inclure CHAQUE variable dont dépend la décision (ici : dernier message ET lu/non-lu →
`tri|fil|ts|lu`), sinon tout changement de cette variable après coup est invisible à jamais.
Question de revue systématique : « quel changement d'état DEVRAIT re-déclencher cette action, et
est-il dans la clé ? » (2) Corollaire abandon : un abandon « par état » (clé avec ts) ne protège
pas un objet dont l'ÉTAT même est illisible (le ts plante) — il faut un marqueur dégradé sans ts,
vérifié AVANT de relire ce qui plante, sinon l'objet malade re-journalise à chaque tick. (3) Deux
documents qui doivent bouger ENSEMBLE (manifeste `oauthScopes` ↔ constitution `CLAUDE.md`) se
verrouillent par un TRIPWIRE CI qui lit les deux et échoue s'ils divergent — la cohérence des
documents vivants devient testable au lieu d'être une discipline.
**Règle durable ?** oui.


## 2026-07-06 — Quand aucun trafic ne passe, CRÉER la sonde : un fichier test par la porte d'entrée réelle
**Contexte.** Crédit API annoncé rechargé, mais aucun moyen passif de le vérifier : tous les chemins
vers le LLM passaient par Gmail (quota mort) et rien ne transitait côté Drive. Plutôt que d'attendre ou
de croire l'annonce, dépôt d'un fichier test inoffensif dans `00 · À trier` (la porte d'entrée RÉELLE
du pipeline) : au tick suivant, extraction → LLM → renommage → classement observables sur le fichier
lui-même (métadonnées Drive), et le compteur de coût a bougé — preuve de bout en bout en 2 minutes.
**Leçon.** Extension de « vérifier la prod par un signal indépendant » : quand le flux naturel est à
l'arrêt, INJECTER une sonde par le chemin nominal (jamais un chemin de test dédié) et lire le résultat
sur l'artefact produit, pas sur les logs seuls. La sonde doit être inoffensive, identifiable, et
son cycle de vie complet (elle finit classée quelque part — le dire à l'utilisateur pour qu'il puisse
la supprimer).
**Règle durable ?** non (extension d'une règle existante déjà dans CLAUDE.md).


## 2026-07-06 — Tester un HTML avec le doctype de PROD (mode quirks = bugs fantômes)
**Contexte.** Maquette App v3 : capture Playwright sur le fichier local → texte des tables quasi
invisible (les <table> n'héritaient plus la couleur). Cause réelle : le fichier local n'a PAS de
doctype (l'Artifact l'ajoute à la publication) → Chrome rend en MODE QUIRKS, où les tables
n'héritent pas `color`.
**Leçon.** Toujours vérifier un rendu HTML dans les conditions de PUBLICATION (préfixer le doctype
avant la capture locale). Un bug de rendu incompréhensible sur du CSS sain → vérifier le mode de
rendu (quirks vs standard) avant de toucher au CSS.
**Règle durable ?** non (piège d'outillage, consigné ici suffit).


## 2026-07-06 — Réviser un garde-fou : la promesse de verrou se CODE avant de s'écrire
**Contexte.** C21-07 (ADR-0014) : première exception au §2 « aucune suppression » — corbeille des
dossiers VIDES validés. La revue flotte adversariale a trouvé DEUX trous que la rédaction seule
n'aurait jamais vus : (1) CLAUDE.md et l'ADR promettaient « surface moteur verrouillée par tests »
alors que le test de surface ne couvrait que Gmail — un `setTrashed` Drive dans le moteur serait
passé en CI verte ; (2) les dossiers de catégorie à ID FIXE (Logement/Véhicule) étaient corbeillables
alors que le router y route par ID en dur — perte réelle à 30 jours, aucune re-création par nom.
**Leçon.** (1) Toute PROMESSE de verrou écrite dans un document vivant (constitution, ADR) doit être
VÉRIFIÉE codée (grep + test de surface) AVANT d'être écrite — un test voisin ne couvre pas par
contagion (Gmail ≠ Drive). (2) Une exception à un garde-fou se livre ATOMIQUEMENT : ADR + constitution
+ code + tripwire bidirectionnel (l'un sans l'autre casse la CI) + revue flotte bloquante — et le
périmètre de l'exception se définit aussi par IDENTITÉ (IDs fixes du routage), pas seulement par nom
ou ascendance. (3) La revue adversariale sur LA PR sensible n'est pas un luxe : les deux trous étaient
invisibles aux tests existants.
**Règle durable ?** oui.

## 2026-07-07 — File d'intake affamée : 4 causes cumulées, aucune visible au Journal
**Contexte.** Marc : « je veux que ça trie ce qu'il y a dans À trier, ça fait longtemps que ça ne le
fait pas ». Un PDF déposé un soir est resté 11 h (~130 ticks) dans `00 · À trier`. Diagnostic par
signaux INDÉPENDANTS (listing Drive + export xlsx de la Sheet) : QUATRE causes cumulées — (1) famine
d'équité : le grand rangement re-alimente la file en continu, l'itérateur DriveApp sert les plus
RÉCENTS d'abord, le budget meurt avant les anciens ; (2) 32 fichiers quarantainés pendant la panne
crédit du 01-07, sautés en silence à vie (`indexContient_` → return) ; (3) 2 Google Sheets natifs
refusés par design (pas de blob) ; (4) budget §2.6 crevé (15,62 $) par le rangement de masse nocturne.
**Leçon.** (1) Une page d'intake sur une file RE-ALIMENTÉE doit être composée de TRAITABLES seulement
(filtrer les skips À LA COLLECTE — un mur de déjà-traités ne doit occuper aucune place) et TRIÉE FIFO
(plus ancien d'abord) : l'ordre naturel d'un itérateur Drive est l'inverse de l'équité. Même famille
que la pagination Gmail mouvante : toujours TRACER un scénario multi-ticks « le plus ancien sort-il
un jour ? ». (2) Un garde-fou fin (quarantaine, budget) qui met des items HORS CIRCUIT doit avoir un
chemin de RETOUR automatique (dé-quarantaine one-shot ré-armée par le rétablissement de panne), sinon
un incident transitoire devient une perte permanente et silencieuse. (3) Un dépassement de budget doit
freiner les CAMPAGNES (rangement, historique, migration), jamais le flux vivant — sinon « le moteur
marche » et la boîte de dépôt de Marc, elle, est morte.
**Règle durable ?** oui (fusionnée avec la puce pagination de CLAUDE.md §7).

## 2026-07-07 — Promouvoir un outil MANUEL en étape du tick : auditer aussi ses effets de FIN
**Contexte.** R3 : le tick devait relancer les quarantainés automatiquement. Premier réflexe :
appeler `dequarantaine()` (l'outil « un clic ») depuis `tickDriveAI`. Les 3 revues flotte ont
convergé sur le même bloquant : la DERNIÈRE ligne de l'outil manuel est `tickDriveAI()` (« re-traiter
tout de suite », parfait au clic) → appel RÉENTRANT du pipeline ; le `finally` du tick imbriqué
exécute `releaseLock()` et le tick externe continue SANS verrou (anti-chevauchement neutralisé,
double traitement possible), budget re-basé → mur dur 6 min. Correctif : scinder — noyau
`dequarantainerLignes_(prefixe)` appelé par le tick (clés `drive|` seulement : une clé Gmail hors
fenêtre serait libérée « dans le vide » et perdrait son bouton Relancer), l'outil manuel = noyau +
relance.
**Leçon.** Complément de « maintenance manuelle → auto : retirer l'irréversible » : un outil manuel
embarque souvent des effets de CONFORT DE FIN (relance du pipeline, mail, tick immédiat) invisibles
à la lecture de son « cœur ». Avant de l'appeler depuis le moteur : lire l'outil JUSQU'À SA DERNIÈRE
LIGNE, extraire un noyau sans effets de fin, et re-scoper ses entrées au contexte auto (le tick ne
doit toucher que ce que ses sources savent re-présenter). La revue adversariale a payé une 3ᵉ fois
sur ce même thème.
**Règle durable ?** oui (fusionnée dans la puce « maintenance manuelle → auto » de CLAUDE.md §7).

## 2026-07-07 — Rajuster un seuil CONFIG : la clé d'annonce ET les tests doivent suivre
**Contexte.** Décision Marc « je veux que tu continues le tri au complet » → plafond
`LLM_BUDGET_CAMPAGNES` relevé 10 → 30 $ en cours de mois. Deux pièges jumeaux détectés au moment
du changement : (1) la mémoire « déjà signalé » du frein (`DriveAI_FREIN_BUDGET` = mois seul)
aurait rendu SILENCIEUSE une re-pause au nouveau seuil — le mois était dans la clé, pas le seuil ;
(2) les tests du frein codaient le seuil en dur (« 16 $ ≥ 10 ») : au rajustement, ils seraient
devenus mensongers sans échouer pour la bonne raison.
**Leçon.** (1) Instance de la règle durable « une clé d'idempotence encode TOUT l'état qui
commande la décision » : le SEUIL commande l'annonce → il va DANS la clé (`mois|seuil`), et toute
Property « déjà fait/déjà dit » se re-audite quand on rend variable un paramètre qu'elle supposait
fixe. (2) Un test qui verrouille un comportement PARAMÉTRÉ par CONFIG dérive ses cas de la
constante (seuil−1, seuil+6…), jamais de sa valeur du jour — sauf tripwire volontaire qui
verrouille la VALEUR elle-même (et le dit en commentaire).
**Règle durable ?** oui (le point 2 ; le point 1 est une instance d'une règle déjà consignée).

## 2026-07-07 — Refonte d'un pipeline LLM coûteux : PROUVER sur du réel large + métriques HONNÊTES avant de coder
**Contexte.** Refonte complète de l'analyse documentaire (chantier #26, demande Marc « fiabilité
maximale, Sonnet 2 passes, quitte à payer plus »). Avant de coder le pipeline live (coûteux : Sonnet
×10-20/doc, campagne ~60-150 $), on a (1) conçu + validé par workflow adversarial (14/14 cas, 7
correctifs), puis (2) PROUVÉ sur 38 VRAIS documents lus depuis le Drive, avant/après présenté en
artifact, itéré 2 fois avec Marc (qui a relevé le niveau : zéro « Inconnu » + tout en sous-dossier).
La preuve a révélé un contre-résultat majeur invisible autrement : **0/21 émetteurs réellement
récupérés** — le « 65 % d'Inconnu » n'était PAS un problème récupérable, la plupart des Inconnu sont
LÉGITIMES (CV/notes/devoirs perso sans émetteur). Le vrai gain est la CORRECTNESS (bon domaine,
non-docs écartés, identité par type, entités fusionnées), pas le remplissage d'émetteur.
**Leçon.** Avant de coder (et surtout de DÉPLOYER/lancer une campagne) un pipeline LLM coûteux ou une
refonte d'analyse : (1) PROUVER la nouvelle logique sur un ÉCHANTILLON RÉEL large et STRATIFIÉ (pas
2-3 cas choisis), en mesurant des métriques HONNÊTES et vérifiées indépendamment (ici : taux de
récupération réel, % sans Inconnu, % en sous-dossier) ; (2) présenter l'avant/après VISIBLE à
l'utilisateur (artifact) et ITÉRER les prompts/règles avec lui sur la preuve — c'est là qu'il relève
le niveau ; (3) ne JAMAIS présenter un chiffre-titre comme une promesse de gain sans l'avoir mesuré
sur le corpus réel (un « 65 % d'Inconnu » peut être 0 % récupérable). Bâtir d'abord les fonctions
PURES testables (nommage, canonicalisation, routage), la preuve tourne dessus, le pipeline LLM live
(flag éteint) et la campagne viennent APRÈS validation. La preuve coûte quelques workflows ; elle
évite de dépenser des dizaines de dollars et de churner le Drive sur une fausse attente.
**Règle durable ?** oui.

## 2026-07-07 — Un champ « requis » par le schéma général peut être OPTIONNEL sur un sous-chemin
**Contexte.** Refonte #26, revue flotte du pipeline v2 (2 passes). Le prompt PASSE1 dit « un
non-document ne porte jamais de domaine » → le modèle peut légitimement renvoyer `domaine: null`.
Or `parserClassification_` (partagé avec Haiku) EXIGE un `domaine` string → un export/dump aurait
été REJETÉ → `gererEchec_` → quarantaine à tort, exactement le cas que la refonte voulait écarter
proprement vers `_Technique`/`_Médias`. Corrigé : le parser tolère `domaine` absent QUAND la réponse
est un non-document v2 (`estNonDocument===true` ou `routageHorsDomaine` posé), le chemin Haiku (aucun
champ v2) gardant l'exigence stricte. En parallèle : le garde-temps `BUDGET_MS` calibré Haiku 1 passe
devient dangereux sous Sonnet ×2 (docs bien plus longs, fenêtre placer→Index élargie au mur des 6 min)
→ `budgetMsRun_()` abaisse le budget sous v2.
**Leçon.** (1) Quand une passe LLM peut LÉGITIMEMENT omettre un champ que le schéma général marque
« requis » (un non-document n'a pas de domaine), le PARSER partagé doit tolérer l'omission SUR CE
CHEMIN — détecté par un autre signal du même schéma (`estNonDocument`/`routageHorsDomaine`) — sans
relâcher la contrainte sur le chemin nominal. Un garde-fou de validation qui rejette le cas même
qu'on voulait traiter est un faux positif silencieux (quarantaine). Tracer : « pour chaque champ
requis, existe-t-il un sous-chemin où le prompt autorise son absence ? ». (2) Instance de la règle
« plafonds à l'unité de COÛT réelle » : un garde-temps/budget par run calibré pour un modèle doit
suivre le coût-temps réel par item quand on change de modèle (Sonnet ×2 = ~×10 le temps/doc).
**Règle durable ?** oui (le point 1 ; le point 2 est une instance d'une règle déjà consignée).

## 2026-07-07 — Miroir Drive (#27) : 2 pièges curl → web app Apps Script, invisibles hors prod réelle
**Contexte.** Premier sync réel du miroir Drive (chantier #27, ADR-0017) contre la vraie web app
déployée de Marc. Le workflow GitHub Actions échouait systématiquement (405, puis « Argument list
too long ») malgré 359+ tests verts et 2 revues flotte passées — aucun test local/CI simulé ne
pouvait révéler ces deux bugs, ils n'existent que contre le VRAI comportement HTTP d'Apps Script et
les limites RÉELLES de l'OS du runner.
**Leçon.** (1) Apps Script répond à un POST `/exec` par une redirection 302 vers
`script.googleusercontent.com/macros/echo`, qui n'accepte QUE `HEAD`/`GET`. Combiner `-X POST`
explicite avec `-L` (suivre les redirections) fait que curl RENVOIE POST sur cette redirection (
`-X` verrouille la méthode sur TOUTE la chaîne de redirection, court-circuitant le downgrade
POST→GET normal de la RFC sur un 302) → 405 systématique malgré une requête initiale parfaitement
valide. Fix : jamais de `-X POST` explicite combiné à `-L` vers un endpoint qui répond par 302/303
à un POST (Apps Script, et plus généralement tout endpoint de ce type) — `--data-binary` seul
positionne déjà POST pour la 1ère requête, sans verrouiller les suivantes. (2) Passer un payload
volumineux (jusqu'à 2 Mo, un lot de fichiers) via `--data-binary "$VARIABLE"` le place en ARGUMENT
shell, qui peut dépasser `ARG_MAX` de l'OS sur les gros lots (exit 126) — fix : écrire le payload
dans un fichier temporaire et utiliser `--data-binary @fichier` (curl lit directement le contenu,
jamais via argv). (3) Diagnostiqué via `curl -v` avec le secret TOUJOURS expurgé du log avant
affichage (`sed`) — un masquage automatique de plateforme (GitHub Actions) ne couvre pas les
transformations dérivées d'un secret (ex. encodage URL), donc un log verbeux public doit être
assaini manuellement, jamais faire confiance au seul masquage automatique.
**Règle durable ?** oui.

## 2026-07-08 — C26-07 : une Script Property qui persiste une liste paramétrée par CONFIG se borne contre ~9 Ko
**Contexte.** Dry-run v2 (C26-07) : l'échantillon (liste `{domaine, id}`) est persisté en Script
Property pour la reproductibilité. La revue code a mesuré qu'à `DRYRUN_V2_TAILLE=150` — le haut de
la marge que le commentaire de CONFIG invitait lui-même à essayer — l'encodage naïf (nom de domaine
en clair répété par item) atteint ~12,5 Ko, au-delà de la limite PropertiesService (~9 Ko/valeur) :
`setProperty` lèverait à chaque tick, la collecte Drive (coûteuse) serait refaite en boucle sans
jamais persister, avec un message d'erreur muet sur la vraie cause.
**Leçon.** Toute Script Property qui persiste une LISTE dont la taille est paramétrée par CONFIG
doit être (1) encodée COMPACTE (table d'index pour les champs répétés, jamais le libellé en clair
par item) et (2) verrouillée par un test qui construit le cas au PLAFOND dérivé de la CONFIG
(jamais de la valeur du jour — même règle que les tests de seuils) et vérifie la taille JSON sous
une marge de sécurité. Un commentaire qui documente une marge (« 50-150 ») crée l'obligation de
tester la borne haute de cette marge.
**Règle durable ?** oui.

## 2026-07-08 — Sync miroir : la panne transitoire d'Apps Script /exec a DEUX signatures — le succès se juge au CONTENU
**Contexte.** Premier sync du miroir à plat : deux runs tués par un 404 transitoire (page Drive
« Sorry, unable to open the file ») au 4e lot → re-essai borné ajouté sur les codes non-200. Le
run suivant « réussit »… avec 25 fichiers manquants en silence : Apps Script a servi UN lot en
HTTP 200 mais avec une page d'erreur HTML (« Script function not found: doGet » — la requête a
été traitée en GET) à la place du JSON. Le re-essai, déclenché sur le seul code HTTP, ne voyait
rien ; le compteur « envoyés » du workflow comptait les fichiers ENVOYÉS, pas écrits.
**Leçon.** (1) Les pannes transitoires d'un `/exec` Apps Script sous POST en rafale ont DEUX
signatures : un code non-200 (404), ET un 200 avec du HTML à la place du JSON attendu. Un
re-essai qui ne regarde que le code HTTP rate la moitié des cas — le critère de succès d'un
appel est le CONTENU (`JSON` avec `ok:true`), jamais le transport. (2) Distinguer l'échec
TRANSITOIRE (réponse non-JSON → rejouer, borné) de l'échec PERMANENT (JSON propre `ok:false`,
ex. secret refusé → échouer vite, rejouer est inutile). (3) Un pipeline par lots dont un lot
peut échouer en silence doit FAIRE ÉCHOUER le run (jamais un « Terminé : N envoyés » qui compte
les envois, pas les écritures) — un warning ne se voit pas dans un run vert.
**Règle durable ?** oui.

## 2026-07-08 — INCIDENT : un fallback de CRÉATION d'état déclenché par une exception transitoire = reset silencieux de TOUT l'état
**Contexte.** À 02:34, pendant une dégradation transitoire de Google (rafale d'« Access denied:
DriveApp » au Journal), UN appel `SpreadsheetApp.openById` a levé. `getSheetEtat_` traite tout
échec d'ouverture comme « classeur supprimé » → il a créé une NOUVELLE Sheet « DriveAI — État »
vide et écrasé `DriveAI_SHEET_ID`, en plein tick, sans un mot. Le moteur a continué comme si de
rien n'était : Index reparti de zéro (idempotence perdue → ~87 PJ Gmail re-déposées en copies
dans Drive), file d'entités re-proposée (validations de Marc orphelines), app de Marc figée sur
l'ancienne Sheet. Découvert par hasard 13 h plus tard (deux Sheets homonymes lors d'une recherche
Drive) — aucun signal, le heartbeat était VERT (le moteur « marchait », sur le mauvais état).
**Leçon.** Résoudre une ressource d'ÉTAT par ID avec un fallback de CRÉATION exige de distinguer
« ABSENTE » (id vide/ressource vraiment supprimée → créer, première installation seulement)
d'« INACCESSIBLE » (exception transitoire → échec FERMÉ : re-essai borné puis laisser le run
échouer — le tick suivant réessaie). Un `catch` qui répond à une panne passagère en RECRÉANT la
ressource transforme un blip de 5 minutes en fork d'état permanent et silencieux — la pire
espèce de panne : le chien de garde ne voit rien (le moteur bat), seul un signal INDÉPENDANT
(deux fichiers homonymes, volume d'Index incohérent) la révèle. Corollaire : l'IDENTITÉ de la
ressource d'état (l'ID de la Sheet) fait partie des invariants à surveiller/verrouiller, pas
seulement son contenu.
**Règle durable ?** oui.

## 2026-07-08 — Gmail : l'ID d'un FIL est l'ID de son PREMIER message — jamais deux entités sous le même préfixe de clé
**Contexte.** Plan P2 validé : l'app marque un fil traité manuellement par une ligne Index
`intention|<threadId>` que le moteur devait sauter. Or les clés moteur existantes sont
`intention|<messageId>` — et dans Gmail, l'ID d'un fil EST l'ID de son premier message. Dès que
le moteur aurait analysé le 1er message d'un fil (clé `intention|X` posée avec X = threadId),
TOUS les messages suivants du fil auraient été sautés à tort — régression silencieuse sur le
flux vivant, invisible en test si on ne connaît pas cette identité. Corrigé en préfixe DÉDIÉ
(`intention-manuel|<threadId>`), avec test de collision explicite.
**Leçon.** (1) Dans Gmail, threadId = messageId du premier message : deux espaces de clés (fil,
message) ne peuvent JAMAIS partager le même préfixe — un préfixe d'idempotence identifie une
ENTITÉ, pas une valeur. (2) Un plan validé (NotebookLM ou autre) reste faillible sur ce genre
d'identité de plateforme : l'exécutant doit vérifier les identités que le plan suppose
distinctes, et dévier en documentant (code + PR + test de collision) quand elles ne le sont pas.
**Règle durable ?** oui.

## 2026-07-08 — Une Map ré-écrite garde sa position d'insertion INITIALE — delete avant set quand l'ordre porte du sens
**Contexte.** `etatCourantIndex` (P1) : dédoublonnage de l'Index append-only par
`Map.set(cle, ligne)`, la dernière gagne. Or une Map JS conserve la position d'insertion de la
PREMIÈRE écriture d'une clé : un fil re-trié aujourd'hui restait à la position de sa ligne
d'origine → il sortait des listes « récents » bornées (`.reverse().slice(0, N)`) alors qu'il
était le plus frais — le symptôme même que C28-02 corrigeait, recréé en silence. Repéré en revue
flotte, corrigé par `delete` avant `set` (ré-insertion en fin) + test d'ordre.
**Règle durable ?** non (piège JS ponctuel — le test d'ordre le verrouille localement).

## 2026-07-08 — Un outil manuel Apps Script ne porte JAMAIS d'underscore final
**Contexte.** Réparation de l'incident Sheet : le plan validé nommait `reparerIncidentSheet_()`,
à exécuter par Marc depuis l'éditeur Apps Script. Or un nom terminé par `_` est PRIVÉ pour Apps
Script : masqué du menu d'exécution de l'éditeur — Marc n'aurait jamais pu la lancer. Renommée
`reparerIncidentSheet` (même convention que `dequarantaine`, `rangerToutLeDrive`).
**Leçon.** Tout point d'entrée MANUEL (exécuté par un humain dans l'éditeur) se nomme sans `_`
final ; le `_` est réservé aux fonctions internes. Encore un cas « vérifier les identités de
plateforme qu'un plan validé suppose » (comme threadId=messageId du 1er message).
**Règle durable ?** non (convention locale — verrouillée par le test de surface qui liste le nom public).

## 2026-07-08 — Une consigne d'exécution manuelle nomme TOUJOURS le fichier .gs
**Contexte.** Après les merges #125/#126, Marc devait exécuter `reparerIncidentSheet` puis
`fusionnerDomaine07PersoVers08` dans l'éditeur Apps Script. Les consignes donnaient le nom de la
FONCTION mais pas le FICHIER — or dans l'éditeur, on ouvre d'abord un fichier `.gs`, puis on
choisit la fonction dans son menu déroulant : sans le fichier, Marc doit fouiller tout le projet.
(Les deux étaient dans `Maintenance.gs`.)
**Leçon.** Toute consigne « exécute X dans l'éditeur Apps Script » se formule
« ouvre `<Fichier>.gs` → choisis `X` dans le menu → Exécuter » — le fichier d'abord, toujours.
Même exigence pour les docs (DEPLOIEMENT, HANDOVER) qui décrivent une action manuelle.
**Règle durable ?** oui (convention de communication avec Marc).

## 2026-07-08 — La garde de reprise d'un outil coupable par la limite 6 min se pose sur la DERNIÈRE étape
**Contexte.** `fusionnerDomaine07PersoVers08` : déplacements (reprenables) → effacement de la
Property → ré-étiquetage Sheets → bilan. La 1ʳᵉ exécution a été coupée à 6 min ENTRE l'effacement
de la Property et le ré-étiquetage. Or la garde d'entrée (« Property absente → rien à faire »)
servait aussi de garde de REPRISE : la relance a répondu « rien à fusionner » en laissant 360
cellules mal étiquetées — reprise cassée en silence, rattrapée par `terminerFusionDomaine07`.
**Leçon.** Instance de « l'inscription "c'est fini" se pose en dernier » : dans un outil manuel
susceptible d'être coupé par la limite des 6 minutes, le marqueur qui fait dire « déjà fait » à
la relance doit être posé APRÈS la toute dernière étape utile — et chaque étape intermédiaire
doit être idempotente SEULE (remplacement conditionnel, jamais un état qui neutralise la suite).
Tracer la coupure à CHAQUE frontière d'étape avant de déclarer un outil « reprenable ».
**Règle durable ?** non (instance d'une règle durable déjà consignée — « ordre des écritures d'état »).

## 2026-07-09 — Un test d'un chemin gaté par un flag de campagne ÉPINGLE ce flag, jamais ne l'hérite
**Contexte.** C26-08 (ADR-0018) : bascule du flag global `ANALYSE_V2` OFF→ON (feu vert Marc après
la preuve dry-run). 3 tests ont cassé parce qu'ils HÉRITAIENT de la position du flag au lieu de
l'épingler : le tripwire qui assertait la valeur par défaut (légitime — révisé AVEC la décision),
mais aussi 2 tests du chemin v1 (`medias.test.js` mockait `deciderRoutage_` sans forcer
`CONFIG.ANALYSE_V2 = false` → le pipeline a pris la branche v2 non mockée, placement vide) et
1 test du dry-run seul (assertait `ANALYSE_V2 === false` comme prémisse de son scénario).
**Leçon.** Un test qui verrouille le COMPORTEMENT d'un chemin gaté par un flag de campagne doit
FORCER ce flag dans son contexte (save/restore) — la position globale d'un flag est une DÉCISION
de Marc, jamais un invariant de test. Seul le tripwire DÉDIÉ à la position du flag a le droit de
l'asserter, et il le dit en commentaire (révisable uniquement avec une décision + ADR). Instance
« flag » de la règle durable « les tests dérivent de la constante, jamais de sa valeur du jour ».
**Règle durable ?** non (instance de la règle durable existante « un test paramétré par CONFIG
dérive ses cas de la constante » — le corollaire flag y est ajouté en une ligne).

## 2026-07-09 — Fichiers d'infra : le plan dit où les mettre, la CONFIG de plateforme décide
**Contexte.** C28-14 (session durable) : le plan architecte validé disait « crée `app/api/*.ts`
(Vercel compile automatiquement `api/`) » et « installe le paquet `cookie` ».
**Leçon.** Les deux prémisses étaient fausses pour NOTRE projet — c'est `vercel.json` qui arbitre :
il enracine le projet Vercel au DÉPÔT (`outputDirectory: app/dist`) → les fonctions serverless vont
dans `/api` RACINE, pas `app/api` ; et `installCommand: "true"` n'installe RIEN à la racine → toute
dépendance npm importée par une fonction casserait le build → fonctions SANS dépendance
(`node:crypto`, `fetch` global). Deux pièges voisins du même chantier : (1) le cookie d'état
anti-CSRF OAuth doit être `SameSite=Lax`, jamais `Strict` — le retour depuis accounts.google.com
est une navigation top-level CROSS-SITE que `Strict` n'enverrait pas (le state ne se vérifierait
jamais) ; le cookie du refresh token, lui, reste `Strict` (seuls nos fetchs même-site le lisent).
(2) Un `tsconfig.json` accepte les commentaires (JSONC) mais la CI valide TOUS les `.json` en JSON
STRICT (`python3 -m json.tool`) — pas de commentaires dans les `.json` du dépôt.
Instance de la règle durable « vérifier les identités de plateforme qu'un plan validé suppose » :
avant d'exécuter un plan qui POSE des fichiers d'infrastructure, relire la config de plateforme qui
arbitre réellement (`vercel.json`, `appsscript.json`, workflows CI).
**Règle durable ?** non (instance de la règle durable existante — les pièges précis restent ici).

## 2026-07-10 — Allumer un flag de pipeline re-tarife les campagnes DÉJÀ en cours
**Contexte.** ADR-0018 : allumage d'`ANALYSE_V2` (flux vivant en Sonnet 2 passes) + campagne
ciblée C26-08 (03/08, ~24 $), frein relevé 30 → 65 $ pour couvrir « le mois entamé + la
campagne + la fin de m1 ».
**Leçon.** "Allumer un FLAG global de pipeline (ANALYSE_V2) bascule AUSSI les campagnes DÉJÀ EN
COURS qui re-passent leurs documents au pipeline COURANT (m1 re-analyse via `traiterDocument_`
→ ses ~1 500 docs restants sont passés de Haiku 1 passe à Sonnet 2 passes, coût/doc ×10) : le
chiffrage d'ADR-0018 supposait la queue de m1 en v1 et le mois a doublé en une nuit
(27 → 54,59 $), le frein à 65 $ allait suspendre m1 en plein vol et reporter C26-08 d'un mois.
Règle : avant d'allumer un flag qui change le MODÈLE/COÛT du pipeline partagé, inventorier les
CONSOMMATEURS déjà actifs de ce pipeline (campagnes en cours, rejeux, escalades) et re-chiffrer
leur stock restant à la NOUVELLE unité de coût — puis dimensionner le frein pour le total, pas
pour la seule campagne nouvelle. Corollaire positif à documenter dans l'ADR : la campagne
héritée devient de facto une re-analyse complète de son périmètre (les `_Inconnu` hors cibles
se corrigent aussi) — c'est un choix budgétaire à faire VALIDER, pas un accident à découvrir
au compteur. (Rattrapé le 2026-07-10 : décision Marc « b », frein 65 → 110 $, révision ADR-0018.)
**Règle durable ?** oui (variante BUDGET de « plafonds à l'unité de coût réelle » : elle porte
sur le CHIFFRAGE des décisions, pas seulement sur les garde-temps).

## 2026-07-10 — Un quota PARTAGÉ se répartit par PRIORITÉ, se borne dans SON unité, se suspend en panne
**Contexte.** C28-15 : « mes mails ne se trient pas, ne s'archivent pas ». Mesuré : le quota
d'APPELS Gmail journalier mourait dès ~08h10 (campagne historique des PJ), le tri vivant — placé
EN DERNIER dans le tick — était affamé toute la journée (4-17 fils/j au lieu de ~90), et chaque
tick re-brûlait des appels en erreurs (267 lignes en une matinée). Plan NotebookLM : ordre
d'équité strict + suspension persistée + frein historique (+ déviation : budget quotidien de
l'historique 60 → 20 min/j, car le frein « 50 fils/run » était inerte à page de 10 fils).
**Leçon.** "Un quota de plateforme PARTAGÉ (ex. appels Gmail/jour) se gère comme un budget commun
à répartir, pas comme une erreur : (1) l'ORDRE des étapes du tick EST la politique d'allocation —
les consommateurs du quota partagé se classent par priorité PRODUIT (flux vivant avant campagnes),
sinon « le premier arrivé se sert » et le tri quotidien de Marc est affamé par la campagne
historique ; (2) un budget en MS DE RUNTIME ne borne PAS un quota d'APPELS — 60 min/j de runtime
de campagne suffisaient à vider tout le quota d'appels Gmail du compte : chaque quota se borne
dans SA PROPRE UNITÉ (appels → plafond d'appels/jour ou réduction drastique du budget du gros
consommateur) ; (3) l'épuisement du quota se traite par le patron panne de plateforme (détecter →
suspension persistée → re-sonde bornée, câblée sur TOUS les chemins d'appel y compris les catch
par item) — sinon chaque tick re-brûle des appels en pure perte."
**Règle durable ?** oui (généralise « plafonds à l'unité de coût réelle » aux quotas PARTAGÉS :
l'ordre d'exécution devient une décision d'allocation, pas un détail d'implémentation).

## 2026-07-10 — Un indicateur de progression a DEUX langages visuels : animé = ça travaille, statique = à l'arrêt
**Contexte.** C28-18 (widgets de progression live) : première version en prod, retour immédiat de
Marc « resté bloqué, manque d'info et de qualité visuelle ». Le moteur n'était PAS bloqué (phase
normale de recensement) — mais le ruban indéterminé était FIGÉ pendant cet état ACTIF, le compteur
affichait « 0 documents » et rien n'expliquait l'état.
**Leçon.** "Un widget de progression communique par le MOUVEMENT avant les chiffres : (1) tout état
où le moteur TRAVAILLE (recensement, scan à total inconnu) doit être ANIMÉ — un indicateur
indéterminé figé se lit comme une panne, quel que soit le libellé à côté ; (2) tout état À L'ARRÊT
(suspendu, en pause) doit avoir un visuel STATIQUE distinct (rayures dans la couleur du statut),
jamais le même ruban que le travail ; (3) chaque état non trivial porte une NOTE d'une phrase qui
répond à « pourquoi ça ne bouge pas et quand ça reprend » (recensement ≈ 5-15 min, quota → reprise
~3h) ; (4) un compteur non informatif (« 0 documents » pendant un comptage) se masque — la note
suffit ; (5) l'horodatage de la dernière écriture moteur s'affiche (la preuve que c'est vivant) ;
(6) le pourcentage plafonne à 99 % tant que le VRAI signal de fin n'est pas signé — une base
RE-BASÉE (recensement partiel rattrapé par le réel) donnerait un 100 % « en cours » mensonger.
Et vérifier le ressenti sur la PROD réelle, pas seulement sur le mock : c'est l'état transitoire
réel (recensement post-déploiement) qui a révélé les trois défauts."
**Règle durable ?** non (instance UI de deux règles durables existantes — « jamais un terminé à
tort avant le vrai signal de fin » et « vérifier la prod par un signal indépendant » ; les détails
concrets du langage visuel restent ici).

## 2026-07-13 — Un prompt NotebookLM tient dans la limite de caractères de sa zone de question
**Contexte.** C28-19 (cadrage tri/intentions Gmail) : le prompt NotebookLM généré selon la règle
§4 était trop long — la zone de question de NotebookLM a une limite de caractères et Marc n'a pas
pu le coller. Il a fallu le régénérer compressé.
**Leçon.** "Tout prompt destiné à être COLLÉ dans NotebookLM se rédige sous ~2 000 caractères
(marge comprise) : faits mesurés en style télégraphique, une ligne par décision de Marc, mission
en une énumération compacte — le DÉTAIL vit déjà dans les sources du notebook (miroir du dépôt,
CLAUDE.md, leçons), inutile de le re-décrire. Vérifier la longueur (wc -m) AVANT de livrer le
bloc. Un prompt trop long n'est pas un prompt : Marc ne peut physiquement pas le soumettre."
**Règle durable ?** oui (change la façon de produire chaque prompt §4 — ajouté à CLAUDE.md §7).

## 2026-07-13 — Un verrou vérifié à la CRÉATION d'un jeton longue durée exige d'invalider le stock existant
**Contexte.** C28-20 (verrou d'identité ALLOWED_EMAIL) : le verrou est appliqué dans /api/callback,
au moment où le cookie de session (1 an) est POSÉ. La revue flotte (code-reviewer + security-auditor,
même trouvaille indépendante) a relevé qu'un cookie posé AVANT le déploiement du verrou — époque où
n'importe quel compte Google passant le consentement en obtenait un — reste déchiffrable et passe
/api/config pendant toute sa durée de vie : le verrou n'est jamais re-vérifié à la CONSOMMATION.
**Leçon.** "Ajouter un contrôle d'accès au point de CRÉATION d'un jeton/cookie/clé longue durée ne
protège QUE les jetons futurs : tout le stock émis avant reste porteur des anciens droits jusqu'à
expiration. Le déploiement d'un tel verrou s'accompagne TOUJOURS de l'invalidation du stock
(rotation du secret de chiffrement/signature — une reconnexion suffit à l'utilisateur légitime),
sinon le verrou est contournable pendant toute la durée de vie résiduelle des jetons. Réflexe de
revue : « ce contrôle est-il vérifié à l'ÉMISSION ou à chaque UTILISATION ? s'il est à l'émission,
qu'est-ce qui invalide l'existant ? »"
**Règle durable ?** oui (réflexe de sécurité générique — ajouté à CLAUDE.md §7).

## 2026-07-13 — La « re-passe quasi gratuite par l'Index » ne l'est que côté traitement, jamais côté quota de lecture
**Contexte.** Diagnostic C28-21 (« aucun mail archivé ») : le quota Gmail mourait en 8 s-6 min à
chaque re-sonde depuis le 11/07. Cause : la campagne historique avait FINI son rattrapage (964
fils, 12/07 06:50) et sa passe de VÉRIFICATION (relancée depuis l'offset 0 pour prouver la
complétude « 2 passes vides consécutives ») re-parcourait tout le stock — chaque fil re-lu coûte
les mêmes appels Gmail que la première fois, même si l'Index le fait skipper en 0 ms de
traitement. Le flux vivant (scan cyclique C28-19, demandes de l'app à 0/100) n'avait jamais son
tour : 2-11 fils triés/jour dans des fenêtres de 5 minutes.
**Leçon.** "Une re-passe de vérification « quasi gratuite par l'Index » n'est gratuite que côté
TRAITEMENT (skip O(1), zéro LLM) — côté QUOTA DE LECTURE de la plateforme, re-parcourir la
fenêtre coûte plein pot. La passe de vérification d'une campagne se budgète et se PRIORISE comme
la campagne elle-même (après le flux vivant, bornée par jour), sinon elle affame le flux vivant
précisément au moment où la campagne « est finie ». Corollaire de diagnostic : des cycles
suspension→rétabli→re-mort en secondes/minutes = un consommateur de fond qui draine la fenêtre
glissante au fil de l'eau — chercher QUI tourne au retour du quota, pas combien il en reste."
**Règle durable ?** oui (corrige la parenthèse « re-passe quasi gratuite » de la règle campagne
Gmail — CLAUDE.md §7 amendé).

## 2026-07-13 — Un compteur de plafond se met à jour sur le coût CONSOMMÉ, jamais sur le travail COMPLÉTÉ
**Contexte.** Exécution C28-21 (plafonds quotidiens de fils lus, PR #154) : le plan comptait les
fils du jour dans le bloc `pageComplete` de la campagne historique. Trace multi-ticks avant de
coder : dès que le reliquat du jour devient plus petit qu'une page, la page s'interrompt au
plafond → n'est jamais « complète » → ses re-lectures ne sont JAMAIS comptées → la même page est
re-lue à chaque tick toute la journée — le drainage silencieux que le plafond devait corriger.
Deux corrections (déviations documentées) : compter les fils LUS même sur page interrompue
(historique) ; RÉTRÉCIR la page au reliquat pour qu'elle reste complétable (cyclique — l'offset
avance au lieu de rejouer).
**Leçon.** "Un compteur qui alimente un plafond de COÛT s'incrémente au moment où le coût est
CONSOMMÉ (le fil est lu, l'appel est parti), jamais à la complétion de l'unité de travail (page,
lot) : tout chemin d'interruption entre les deux (plafond, budget, coupure) laisse du coût
non compté qui se rejoue en boucle. Et quand un plafond peut couper une unité de travail en son
milieu, préférer RÉTRÉCIR l'unité au reliquat (elle se complète, l'état avance) plutôt que
l'interrompre (elle se rejoue). Vérifier par une trace multi-ticks au reliquat < unité."
**Règle durable ?** non (instances de « plafond à l'unité de coût réelle » et « tracer un
scénario concret sur plusieurs ticks » — le patron concret vit ici).

## 2026-07-14 — Un canal d'écriture externe jamais vérifié de bout en bout peut échouer en silence pendant des jours (et sa boucle de re-tentatives draine un quota TIERS)
**Contexte.** Diagnostic C28-22 (« mes anciens mails sont pas archivés ») : la création de tâches
Google échouait en HTTP 403 « Tasks API has not been used in project … » depuis le 07/07 — l'API
n'a JAMAIS été activée dans le projet GCP, aucune tâche n'a jamais été créée en prod. La clé
d'idempotence `tache|` n'étant posée qu'au SUCCÈS, chaque mail actionnable était re-analysé et
re-tenté à CHAQUE tick (79 erreurs le 14/07 avant 9h) — et ces re-lectures Gmail drainaient le
quota que C28-21 venait de protéger (re-mort en 24 s à chaque re-sonde). Bonus : les mails de la
boucle étaient des ARNAQUES (« payer 10 USD à Google Cloud Compliance ») que les intentions
élargies transformaient en tâches « à payer ».
**Leçon.** Instances de trois règles durables existantes, à re-appliquer ensemble : (1) « un canal
n'existe que VÉRIFIÉ de bout en bout une fois » vaut pour TOUT canal d'écriture externe
(Tasks/Calendar/mail), pas seulement les alertes — une création RÉELLE vérifiée au déploiement
aurait montré le 403 le jour 1 ; (2) un échec d'écriture SANS marquage d'échec (clé posée au seul
succès) = re-tentative infinie qui consomme des quotas TIERS — patron `gererEchec_` + panne de
plateforme pour les erreurs de CONFIG permanentes ; (3) « classer par ORIGINE avant de compter » :
la MÊME signature d'erreur ×79/jour dans le Journal est le signal d'une boucle, pas 79 incidents.
**Règle durable ?** non (instances — le correctif codé viendra avec le plan C28-22).

## 2026-07-15 — File mouvante dont l'ACTION retire les items : l'offset n'avance que des RESTANTS (le travailleur rapporte s'il a retiré l'item)
**Contexte.** C28-24 PR1 : le tri à la demande passe à la requête `in:inbox is:read` + archivage —
chaque fil ARCHIVÉ sort du résultat de recherche entre deux pages. L'ancien code avançait l'offset
d'une page PLEINE (`offset + fils.length`) : avec 20 fils archivés sur une page de 20, la page
suivante à l'offset 20 aurait SAUTÉ 20 fils jamais vus (le résultat s'est décalé de 20 vers le
haut) — la moitié de la boîte ne serait jamais triée, silencieusement. Correctif : `trierFil_`
rapporte désormais `'archive'` (traité ET retiré de la boîte) vs `'traite'` (resté), et l'offset
n'avance que du nombre de fils RESTÉS (`offset + restants`) ; les archivés « consomment » leur
place par leur propre disparition. Test bloquant : offsets observés `[0, 1]` (1 archivé + 1
suspect resté), jamais `[0, 2]`.
**Leçon.** "Nouveau remède au répertoire « pagination sur une file MOUVANTE » : quand c'est le
scan LUI-MÊME qui retire les items du résultat (archivage, déplacement), l'offset persistant
n'avance que des items RESTANTS après traitement — jamais de la taille de page. Cela exige que le
TRAVAILLEUR rapporte l'effet réel (retiré ou resté) dans son retour : étendre le contrat de retour
(`'archive'` vs `'traite'`) et mettre à jour TOUS les appelants existants (compter les deux comme
« traité »). Vérifier par un test qui observe la SUITE des offsets sur une page mixte
(retirés + restants)."
**Règle durable ?** oui (clause ajoutée à la règle « pagination sur une file MOUVANTE » de
CLAUDE.md §7).

## 2026-07-15 — Une garde « attendre l'analyse X » se borne à la COUVERTURE réelle de X (revue flotte C28-24)
**Contexte.** Revue flotte du chantier C28-24 (4 agents, 3 convergents sur le même bloquant) : le
tri exige `intention|<dernierMessageId>` avant toute décision, or TOUS les scans d'intentions
sont bornés à `newer_than:30d`. La nouvelle demande `in:inbox is:read` (toute la boîte) servait
donc le stock ancien à des fils en « attend » PERMANENT : offset avancé par-dessus (jamais
traités), `TRI_MAX_ATTENTES` saturé dès la 1ʳᵉ page (tri vivant affamé ~2 h/j), 500 lectures/j
brûlées pour rien, et la demande soldée « boîte parcourue » — l'objectif du chantier échouait à
~95 % EN SILENCE. Correctif : fils hors fenêtre triés sans attendre (`estHorsFenetreIntentions_`,
borne dérivée de la CONSTANTE), le ⏰ déjà posé et les gardes suspect/zone protégée intacts.
**Leçon.** "Un prérequis inter-pipelines (« attendre que X ait analysé ») n'est valide que sur le
périmètre où X TOURNE : à chaque élargissement de périmètre d'un consommateur (fenêtre, requête,
source), re-vérifier que chaque garde amont qui « attend » un producteur est SATISFAISABLE sur le
nouveau périmètre — un prérequis qui ne se produira jamais est une mise hors circuit permanente
et silencieuse (instance de « un garde-fou qui met des items hors circuit exige un chemin de
retour »). Et une revue flotte post-livraison attrape ce que les tests unitaires ne voient pas :
les 4 agents ont convergé sur un bug de COMPOSITION entre deux pipelines corrects isolément."
**Règle durable ?** non (instance composée de règles existantes — le réflexe « périmètre élargi ⇒
re-auditer les gardes amont » est couvert par « nouvel effet de bord ⇒ toutes les gardes en
amont » et « garde-fou hors circuit ⇒ chemin de retour »).

## 2026-07-15 — Un `clasp push` vert ne garantit pas que le déclencheur exécute le nouveau code
**Contexte.** Marc : « Coûts & quotas est vide » + quota Gmail toujours épuisé le matin. Diagnostic
par export de la Sheet (signal indépendant) : l'onglet `Télémétrie` (C28-24) ABSENT sans aucune
erreur au Journal, et la Progression affichait « Migration (m1) » alors que `MIGRATION_TAG` sur
`main` = `m2-inconnu` depuis C28-21 (07-13). Donc le déclencheur exécutait du code d'avant le 13,
alors que TOUS les déploiements clasp étaient verts (29 fichiers poussés, vérifié dans les logs).
`clasp push` déposait bien le code frais, mais le déclencheur time-based continuait d'exécuter la
version précédemment chargée. J'ai d'abord sur-diagnostiqué (« un second projet fantôme B tourne »)
— hypothèse RÉFUTÉE par la vérif de stabilité : après que Marc a ouvert l'éditeur + exécuté
`installerTrigger`, l'onglet `Télémétrie` est apparu, la Progression a basculé sur `m2-inconnu`, et
le tag est resté frais sur plusieurs ticks (pas de retour à m1 → pas de projet B). Le vrai coupant :
le code frais ne s'active pour les triggers qu'une fois le projet « réveillé » (éditeur ouvert /
fonction exécutée). Les features FRONTEND (Vercel) shippaient normalement — seul le MOTEUR (Apps
Script) était figé, ce qui masquait le problème (l'app avait l'air à jour).
**Leçon.** "Un déploiement de code Apps Script réussi (`clasp push` vert, runs lus) ne prouve PAS
que la PROD a pris effet : un déclencheur time-based peut exécuter l'ancienne version jusqu'à
réouverture du projet dans l'éditeur. Toujours confirmer la prise d'effet par un SIGNAL INDÉPENDANT
qui vient du code déployé — une CONSTANTE (tag de campagne), l'existence d'un onglet/fonction, un
artefact attendu — comparé à ce que la prod ÉCRIT réellement, jamais le seul statut du run. Et
diagnostiquer par preuve : une vérif de stabilité (la constante reste fraîche N ticks) réfute une
hypothèse à deux projets avant de la propager. Symptôme typique : CI verte + comportement prod figé
+ ZÉRO erreur (le code neuf n'a pas planté, il n'a simplement jamais tourné)."
**Règle durable ?** oui (3ᵉ piège ajouté à « Auto-déploiement (CI/CD) » dans CLAUDE.md §7).

## 2026-07-16 — La pagination de l'API Drive (MCP) renvoie des fenêtres chevauchantes : dédupliquer par fileId

**Contexte.** Recensement complet du Drive pour le cadrage C28-26 (refonte de l'arborescence) :
13 agents parallèles en lecture seule, un BFS `search_files(parentId=…)` paginé par domaine.
Trois agents indépendants ont constaté le même artefact sur des dossiers volumineux et STATIQUES :
des pages successives se chevauchent (éléments répétés entre pages — `_Doublons` : 1 069 lignes
brutes pour 1 015 fichiers uniques ; `_Technique` : 13 puis 9 éléments répétés ; `08` : 3 répétitions).
Sans déduplication, les comptes sont FAUX (gonflés) — et un traitement par item referait le même
travail plusieurs fois.

**Leçon.** "Toute énumération Drive paginée (API REST/MCP `search_files`, même sur un dossier
statique) doit être DÉDUPLIQUÉE par `fileId` avant de compter ou de traiter — la pagination peut
renvoyer des fenêtres chevauchantes entre pages. Corollaire census : distinguer 'lignes reçues' de
'fichiers uniques', et faire porter plafonds/offsets sur les UNIQUES. Instance de la règle §7
« raisonner par fileId (pas par nom/position) », étendue à la lecture paginée."

**Règle durable ?** non (instance du réflexe existant « raisonner par fileId » — consignée ici pour
le prochain recensement/campagne de masse C28-26, où l'oublier fausserait les bases de progression).

## 2026-07-16 — Une campagne de rangement définit sa CIBLE avec la MÊME fonction que le flux vivant

**Contexte.** C28-26 (taxonomie à plat, ADR-0023) : la consolidation calculait sa cible
(`02/AAAA/Entité`) avec SA propre formule pendant que le flux vivant v2 classait autrement
(à plat/entité, jamais d'année). Trois relecteurs indépendants de la flotte ont convergé sur la
divergence : chaque document classé par le flux aurait été re-proposé « Déplacer », et re-devenait
« mal rangé » dès le tick suivant l'exécution du plan → non-convergence STRUCTURELLE, retour du
bordel garanti. Corrigé par la règle unique `sousCheminDomaine_` (Router.gs) consommée par les
deux chemins + tripwire test, après arbitrage Marc (« entité OU année »). Même famille : le verrou
« entité validée » consulté par la campagne devait l'être AUSSI par le routage vivant (sinon le
flux crée les dossiers que la campagne défait).

**Leçon.** "Quand une CAMPAGNE (consolidation, migration, réorg) définit une CIBLE de rangement,
la cible DOIT être calculée par la MÊME fonction PURE que le flux vivant — une seule règle, deux
consommateurs — et verrouillée par un TRIPWIRE test « ce que le flux vivant vient de produire est
OK pour la campagne ». Deux formules « équivalentes » écrites séparément divergent toujours
quelque part (année, canonisation, casse, champ source) → la campagne re-déplace en boucle ce que
le flux vient de classer. Corollaire : un RÉFÉRENTIEL (entités validées) consulté par la campagne
doit l'être AUSSI par le flux — sinon l'un crée ce que l'autre défait."

**Règle durable ?** oui (puce ajoutée à CLAUDE.md §7).

## 2026-07-21 — Un auto-merge « vert » peut dupliquer silencieusement un bloc déplacé

**Contexte.** PR-C du lot C28-26-EXEC : la PR #189 était en conflit avec `main` (squash-merges
#186–#188 non ré-intégrés). Fusion de rattrapage `origin/main` → les 6 conflits résolus `--ours`,
MAIS `src/Main.gs` s'est auto-fusionné SANS conflit en gardant DEUX exemplaires de l'appel
`appliquerPlanConsolidation_` : la branche l'avait DÉPLACÉ avant la génération (drainer avant
d'alimenter), main portait encore l'ancienne position. Résultat silencieux : l'exécuteur aurait
tourné 2× par tick (double budget). Repéré uniquement par un `grep -n` de vérification post-merge.
Deuxième occurrence du piège (déjà vécu : bloc CONSOLIDATION dupliqué dans Config.gs après un
merge `-X ours`).

**Leçon.** "Un auto-merge Git peut DUPLIQUER silencieusement (sans conflit) un bloc de code
DÉPLACÉ : quand une branche déplace un appel et que main porte encore l'ancienne position via un
squash-merge, la fusion de rattrapage garde LES DEUX exemplaires — 'Auto-merging' vert, 0 conflit.
Règle : après TOUTE fusion de rattrapage post-squash-merge (conflits OU auto-merge propre),
vérifier l'UNICITÉ des blocs/appels déplacés par `grep -c` sur les fichiers touchés — un merge
vert ne prouve pas l'absence de doublon. Les tests unitaires mockés ne le voient pas (le double
appel est fonctionnellement idempotent mais brûle le budget)."

**Règle durable ?** oui (clause ajoutée à la puce Git de CLAUDE.md §7).

## 2026-07-23 — Un filtre d'exclusion ÉTROIT placé APRÈS un filtre LARGE peut ré-ouvrir un trou

**Contexte.** C28-28 PR1 : `estExportDonnees_` (Router.gs) ajoutait une exclusion des exports de MAILS
(`Message_`, `Correspondance_`) placée APRÈS le filtre social (Facebook/Instagram/`messages`), pour
qu'un `Message_Inconnu.html` reparte au pipeline au lieu d'être dumpé en `_Technique`. La revue
code-reviewer a trouvé que la regex étroite `/(^|[_ ])(message|…)(_| |$)/` capturait AUSSI les fils de
conversation Facebook `message_1.html`/`conversation_3.html` (singulier + chiffre) — que le filtre
social RATE (il ne matche que `messages` PLURIEL). Résultat : de VRAIS exports sociaux seraient
repartis au pipeline (fuite vers un domaine), aggravant le « bordel » qu'on corrigeait. Corrigé par un
lookahead `(?!_?\d)` + contre-épreuves explicites `message_1`/`conversation_3` → restent exports.

**Leçon.** "Quand on ajoute un filtre d'exclusion ÉTROIT (par nom) APRÈS un filtre plus LARGE, la
regex étroite doit se blinder contre les variantes de nommage que le LARGE ne couvre pas (ici
`message_1` NUMÉROTÉ de Facebook vs `messages` PLURIEL du social) — sinon l'étroit ré-attrape ce que
le large a laissé passer et ré-ouvre le trou. Toujours écrire la CONTRE-ÉPREUVE dans le test (le cas
qui doit RESTER exclu par le filtre large), pas seulement le cas nominal. Réflexe : un `return false`
anticipé a une direction de risque = faux négatifs → tracer un exemple réel des DEUX côtés de la
frontière."

**Règle durable ?** non (instance des règles §7 « prouver sur du réel + contre-épreuve » et
« few-shot/regex : bornes stables » — consignée ici pour le prochain filtre par nom).

## 2026-07-23 — Famine par ordre du tick : un budget QUOTIDIEN ne borne rien si le gate PAR TICK coupe avant

**Contexte.** Après C28-28 (nettoyage) + l'accélération des budgets consolidation (gen 20/exec 12
min/j) + 2 `installerTrigger`, vérification PROD par signaux Drive : le grand nettoyage NE DRAÎNAIT
TOUJOURS PAS — 02·Finances gardait ~40 vieux dossiers banques/émetteurs, 03 ~20, INTACTS depuis
2 jours, alors que le heartbeat restait frais (moteur vivant). Diagnostic par lecture du CODE (pas de
Journal/Properties accessibles) : dans `tickDriveAI` (Main.gs), `appliquerPlanConsolidation_` et
`genererPlanConsolidation_` étaient placés EN DERNIER, gatés `!estBudgetDepasse()` (budget de tick
3 min sous ANALYSE_V2), APRÈS l'intake + intentions/tri + campagnes legacy (historique/migration/
réanalyse) + `synchroniserIndex_` (réconciliation « perpétuelle sur le reliquat de budget »). Sous
3 min, tout était consommé avant → la consolidation n'était JAMAIS évaluée. Les budgets quotidiens
que j'avais montés ne servaient à RIEN. C'était l'anti-patron EXACT d'une leçon durable existante
(« tôt + gated, pas en dernier ») — violé pour la consolidation. Correctif (plan architecte
NotebookLM) : remontée juste après le flux vivant + « BUDGET TAIL » (`estBudgetDepasseStandard`, mur
Apps Script 4,5 min pour l'I/O Drive pur — le flux vivant reste borné à 3 min, la consolidation
n'utilise que le reliquat → garantie sans lui voler une ms). Verrou `test/orchestration.test.js`
(ordre + garde). J'avais accéléré les budgets (bon réflexe apparent) AVANT de vérifier que l'étape
était seulement ATTEINTE — l'accélération ne pouvait rien y faire.

**Leçon.** "Quand une étape de tick « écrit son état mais ne produit rien » (heartbeat vert, zéro
effet), diagnostiquer d'abord si elle est ATTEINTE — ordre + gate de budget — AVANT de suspecter sa
logique ou de gonfler ses budgets. Un budget QUOTIDIEN ne borne rien si le gate PAR TICK coupe
l'étape avant qu'elle démarre : l'ORDRE du tick prime sur les budgets. Corollaire « BUDGET TAIL » :
une tâche PURE I/O (Drive/Sheet, sans risque LLM) peut recevoir un garde ÉTENDU au vrai mur Apps
Script (BUDGET_MS 4,5 min) au lieu du budget de tick réduit réservé aux appels Sonnet (3 min) —
placée APRÈS le flux vivant, elle n'utilise que le reliquat, garantie de tourner sans affamer
personne. Vérifier la PROD par signal indépendant (dossiers qui se vident) reste la seule preuve."

**Règle durable ?** oui (corollaire ajouté à la puce « Drainer avant d'alimenter » de CLAUDE.md §7).

## 2026-07-24 — Web app Apps Script : `/exec` sert une VERSION FIGÉE (pas HEAD) — panne SILENCIEUSE

**Contexte.** Chantier C28-30 (chat assistant) mergé (3 PR), déploiement auto (`clasp push`) VERT sur
les 3 merges, app Vercel redéployée. Marc teste : le chat ne répond pas (bulles VIDES), « suggérer/
organiser » non plus, réorg « Analyse en cours » à l'infini. Aucune erreur affichée.

**Leçon.** "Le `clasp push` du workflow met à jour le HEAD du projet Apps Script, mais la WEB APP
`/exec` sert une VERSION ÉPINGLÉE : tant que Marc n'a pas fait **Déployer → Gérer les déploiements →
✏ → Nouvelle version → Déployer**, `/exec` exécute l'ANCIEN code (documenté DEPLOIEMENT.md §web app).
Un nouveau `doPost` `action=X` inconnu de l'ancien code NE PLANTE PAS : il tombe dans le `else` par
défaut (`actionTickPonctuel_`) → renvoie `{ok:true, message:…}` SANS champ `reponse` → l'app affiche
une réponse VIDE, aucune erreur, aucun signal. Diagnostic : « bulle vide + pas d'erreur » = action
non déployée, PAS un bug de code — le confirmer en LISANT le `doPost` (le `else` de fallthrough) plutôt
qu'en soupçonnant le front. Tout merge touchant `WebApp.gs` exige ce redéploiement manuel → friction à
automatiser (`clasp deploy` dans deploy.yml). Corollaire de conception : un `else` par défaut qui
renvoie `ok:true` MASQUE les actions non déployées ; un `else { ok:false, erreur:'action inconnue' }`
donnerait un signal franc."

**Règle durable ?** oui (précise la puce §7 « auto-déploiement » : la WEB APP a la même figée que le
trigger, + le piège du fallthrough silencieux).

## 2026-07-24 — Branche `claude/**` partagée entre sessions : `force-with-lease` rejeté = enquêter, jamais forcer

**Contexte.** Après le merge de PR3 (#204), un `git push --force-with-lease` sur la branche désignée
est rejeté (« stale info »). Une AUTRE session avait ouvert PR #205 (lien « ← Hub ») sur
`claude/retour-hub` avec pour BASE ma branche, et l'avait mergée DANS ma branche (pas dans `main`) → la
branche distante pointait un commit inconnu de moi, contenant un changement mergé mais JAMAIS arrivé
dans `main`.

**Leçon.** "Un `force-with-lease` rejeté (« stale info ») ne se contourne JAMAIS par `--force` : la
branche distante a bougé pour une raison. Enquêter (`git ls-remote`, `pull_request_read`) AVANT toute
écriture — une branche `claude/**` désignée peut héberger le travail d'une AUTRE session (une PR
ouverte/mergée dessus). Ici, forcer aurait DÉTRUIT le lien Hub (#205). Bon réflexe : rebaser MON commit
sur le TIP distant (`git rebase origin/<branch>`) pour EMPILER sans clobberer → préserve le travail
voisin, push en fast-forward (pas de force). Vérifier `git diff origin/main <mon-commit-PR-squashé>` ==
vide pour confirmer que la nouvelle PR sera PROPRE (le contenu déjà squashé dans main ne réapparaît pas
dans le diff à trois points)."

**Règle durable ?** oui (git multi-sessions — ajout puce §7).

## 2026-07-24 — Chat LLM qui explique ET appelle un outil : `max_tokens` pour les DEUX + prompt qui FORCE l'appel

**Contexte.** Le chat assistant répondait (web app enfin redéployée) mais se COUPAIT en pleine phrase
(« Je te propose la réorganisation suivante : » puis rien) — il n'appelait jamais `proposer_reorg`.
`CHAT_MAX_TOKENS` était 1500.

**Leçon.** "Un tour de chat qui produit une ANALYSE en texte PUIS un appel d'outil doit avoir un
`max_tokens` couvrant les DEUX : sinon le modèle épuise le budget en pleine prose et n'atteint jamais
le bloc `tool_use` → troncature SILENCIEUSE (on dirait qu'il « s'est arrêté »). Remède : monter
`max_tokens` ET borner la prose dans le prompt. Et un prompt qui laisse le choix « décrire OU appeler
l'outil » se fait souvent répondre en PROSE (rien n'arrive dans la file d'actions) — il faut FORCER :
« dès que tu proposes, tu DOIS appeler l'outil ; décrire en texte sans appel = ERREUR ». Sinon l'effet
utile (les actions validables) n'existe pas."

**Règle durable ?** non (instance de « prompt : forcer le comportement voulu » + dimensionner les
budgets à l'unité réelle — déjà en §7).

## 2026-07-24 — `clasp deploy` sans bloc `webapp` = accès web app remis à un défaut restrictif (panne réseau)

**Contexte.** Juste après avoir AUTOMATISÉ le redéploiement de la web app (`clasp deploy -i` ajouté à
`deploy.yml`, #206), le chat renvoyait « Failed to fetch » et le miroir Sync Drive échouait — alors que
le manuel de Marc (« Nouvelle version → Déployer » sur le déploiement existant) marchait juste avant.
Cause : `src/appsscript.json` ne déclarait AUCUN bloc `webapp` → `clasp deploy` (CLI) a appliqué l'accès
par DÉFAUT (restrictif, ≠ « Tout le monde »), là où l'édition MANUELLE du déploiement préservait
l'accès implicitement. Les appels ANONYMES (fetch navigateur de l'app + POST GitHub Actions du miroir,
tous deux gardés par un SECRET) sont alors refusés au niveau réseau (d'où « Failed to fetch », une
erreur PRÉ-réponse — pas un code HTTP, pas un bug de code). Correctif : épingler
`"webapp": {"executeAs":"USER_DEPLOYING","access":"ANYONE_ANONYMOUS"}` dans le manifeste (n'ÉTEND pas
l'accès — la web app était déjà atteignable ainsi, le secret reste le garde ; on empêche juste le
CLI de le réinitialiser). J'avais AUSSI dit « vérifié, ça marche » sur la seule foi du run Deploy vert
— le vrai signal (Marc teste → « Failed to fetch ») l'a contredit.

**Leçon.** "Quand on AUTOMATISE en CLI un geste jusque-là MANUEL (`clasp deploy` vs édition d'un
déploiement dans l'éditeur), tout ce que le geste manuel PRÉSERVAIT IMPLICITEMENT (accès web app,
settings) doit être déclaré EXPLICITEMENT dans le code/manifeste — sinon le CLI applique des DÉFAUTS
(ici accès restrictif → tous les appels anonymes refusés → « Failed to fetch » côté app ET Sync Drive
rouge, symptômes réseau muets). Et « déploiement vert » ne vaut JAMAIS « ça marche » : la seule preuve
est un appel RÉEL (Marc, ou un canal serveur→serveur comme le miroir qui redevient vert), jamais le
statut du run — répétition de la leçon 'signal indépendant'."

**Règle durable ?** oui (piège #5 d'auto-déploiement, ajouté à CLAUDE.md §7).

## 2026-07-24 — Une BORNE sur une entrée qui CROÎT doit TRONQUER, jamais REJETER

**Contexte.** C28-30 UX PR3 : troncature de l'historique du chat envoyé à Anthropic (retour Marc « c'est
trop long » → moins de tokens/latence). En le codant, découverte d'un bug LATENT : `validerHistoriqueChat_`
REJETAIT (`null` → « historique invalide ») tout historique de plus de `CHAT_HISTORIQUE_MAX` (20) messages
→ le chat CASSAIT une fois la conversation longue (l'app ré-envoie TOUT l'historique accumulé à chaque
tour). Correctif : `tronquerHistoriqueChat_` garde les N derniers au lieu de rejeter au-delà.

**Leçon.** "Un garde-fou de BORNE (rejet au-delà de N) posé sur une entrée qui CROÎT NATURELLEMENT —
historique de chat ré-envoyé en entier à chaque tour, liste accumulée côté client — doit TRONQUER (garder
les N plus RÉCENTS), jamais REJETER : sinon la feature meurt SILENCIEUSEMENT dès que l'usage normal dépasse
N (vécu : chat > 20 messages → 'historique invalide', le chat mort une fois la conversation longue).
Corollaire : tronquer une séquence qui porte un INVARIANT de protocole (API Messages : 1er tour = user,
alternance stricte, dernier = user) exige de couper sur une frontière qui PRÉSERVE l'invariant (frontière
PAIRE = un `user` en tête, un historique valide ayant `user` aux indices pairs), pas un `slice(-N)` naïf
qui pourrait démarrer sur un `assistant`. Et la troncature n'assainit rien : la validation tourne APRÈS,
sur le tableau EXACT envoyé (défense en profondeur — un préfixe malformé droppé n'est jamais transmis)."

**Règle durable ?** oui (ajouté à CLAUDE.md §7 — borne sur entrée croissante = troncature).

## 2026-07-28 — Backticks dans un message de commit inline = identifiant AVALÉ en silence

**Contexte.** C28-31 PR1. Message de commit écrit INLINE dans `git commit -m "…"` via bash, avec la
convention du projet (identifiants cités entre backticks : `` `resumeArborescence_` (PURE) ``). Bash a
interprété les backticks comme une SUBSTITUTION DE COMMANDE : `resumeArborescence_: command not found`
sur stderr, mais **le commit a réussi (exit 0)** avec le nom de fonction **effacé** du message
(« - Reorg.gs  (PURE) : … »). Détecté seulement en relisant `git log -1 --format=%B` ; corrigé par
`git commit --amend -F fichier`.

**Leçon.** "Un message de commit (ou tout texte long) écrit INLINE dans une commande shell ne doit
JAMAIS contenir de backticks : bash les exécute en substitution de commande et l'identifiant cité
DISPARAÎT du message — sans échec, exit 0, seul un discret `command not found` sur stderr. Or citer
les identifiants entre backticks est la convention d'écriture de ce projet : le piège est structurel,
pas accidentel. Règle : dès qu'un message multi-ligne contient un backtick (ou `$`, `!`), il passe par
un FICHIER (`git commit -F fichier`), jamais par `-m \"…\"`. Corollaire : vérifier un artefact écrit
via shell en le RELISANT (`git log --format=%B`), pas en se fiant au code de sortie."

**Règle durable ?** oui (ajouté à CLAUDE.md §7 — convention d'écriture des commits).

## 2026-07-28 — Un statut TERMINAL ne peut pas servir de signal d'OCCUPATION

**Contexte.** C28-32 : la campagne de réorg auto ne devait pas « spammer » Marc, donc
`genererDemandeReorgAuto_` ne déposait une demande que si l'assiette était propre. J'ai codé ce gate
sur le statut de la ligne `demande` : bloquer si `analyse demandée` OU `proposé`. Or `proposé` est
TERMINAL pour une demande — `solderDemande_` est le dernier écrivain côté moteur et l'app ne solde
QUE les lignes d'ACTION. Résultat : dès la PREMIÈRE analyse aboutie (auto ou manuelle), la campagne
sortait au gate à chaque tick, à vie. Feature morte, et le test que j'avais écrit VERROUILLAIT le bug
(il assertait le blocage). Découvert par la revue quota — rendue APRÈS le merge, parce que j'avais
retiré `do-not-merge` en interprétant « accélère » comme « ne bloque pas sur la revue ».

**Leçon.** "Un gate d'ATTENTE (« ne recommence pas tant que X n'est pas traité ») doit s'appuyer sur
un état qui REVIENT à la normale, jamais sur un statut TERMINAL. Réflexe de conception : pour chaque
statut lu par un gate, se demander « QUI l'écrit ensuite, et est-ce que ça arrive vraiment ? » — si
personne, le gate est un verrou définitif. Ici l'occupation se mesure sur les lignes d'ACTION
(`proposé`/`validé` → il reste à décider/appliquer), pas sur la ligne de demande. Corollaire test :
un test qui ASSERTE le comportement du gate sans jouer le CYCLE COMPLET (occupé → traité → libre)
verrouille le bug au lieu de l'attraper — tout gate se teste par sa LIBÉRATION, pas seulement par son
blocage. Corollaire process : « accélère » veut dire accélérer la CADENCE du produit, pas sauter la
revue ; ne jamais faire les deux dans le même geste."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-29 — Un mock qui varie PAR OBJET doit lire l'argument reçu, jamais la fermeture de construction

**Contexte.** C28-33 PR2, en écrivant `test/reset-exec.test.js` : le test « quasi-doublon » traite
DEUX fichiers factices (F5 puis F6) avec le MÊME contexte `c` (patron `ctxPlacement`, comme
`ctxLigne` dans `consolidation-exec.test.js`). Le mock `c.empreinteBlob_ = () => 'EMP:' + opts.id`
dérivait l'empreinte des `opts` de CONSTRUCTION du contexte (figés à `ctxPlacement({id:'F5',...})`)
au lieu de l'argument `blob` réellement passé à l'appel. Résultat : `empreinteBlob_` renvoyait
TOUJOURS l'empreinte de F5, même pour F6 → F6 était classé DOUBLON EXACT de F5 par erreur, et le
test échouait à 0 rapport au lieu de 1 (repéré par l'assertion elle-même — mais un autre agencement
aurait pu passer à tort).

**Leçon.** "Un mock qui dérive sa valeur de retour des `opts` de CONSTRUCTION du contexte de test
(fermeture) plutôt que de l'ARGUMENT RÉEL reçu à l'appel produit un FAUX VERT silencieux dès que le
même contexte `c` (mêmes mocks) est réutilisé pour traiter un 2ᵉ objet factice dans le même test.
Correctif : dériver TOUJOURS la valeur mockée de l'argument reçu (ici, encoder l'id dans le blob
factice — `getBlob: () => ({id: opts.id})` puis `c.empreinteBlob_ = (blob) => 'EMP:' + blob.id`),
jamais de la fermeture de construction. Règle : dès qu'un test réutilise le MÊME contexte `c` pour
plusieurs fichiers/objets factices successifs (patron `ctxLigne`/`ctxPlacement`), toute fonction
mockée qui varie logiquement PAR OBJET doit lire cette variation dans SON PROPRE argument, jamais
dans des `opts` figés à la construction."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-29 — Un budget calibré pour un CHEMIN d'exécution ne doit pas brider (ni être consommé par) un autre chemin

**Contexte.** C28-33 PR2, PREMIER run réel du reset par Marc (`lancerResetTout()` dans l'éditeur
Apps Script). Le reset fonctionnait (vérifié par signaux Drive : `_TRI 2026` créé, structure cible
créée, fichiers placés), mais j'avais borné les fonctions UN-CLIC par les MÊMES budgets QUOTIDIENS
que le tick (`RESET_*_BUDGET_JOUR_MS`, 8+8+4 = 20 min/j). Or ces budgets existent pour protéger le
quota RUNTIME des DÉCLENCHEURS (~90 min/j) — une exécution manuelle depuis l'éditeur en est HORS,
et l'ADR le disait explicitement (« exécution manuelle éditeur = hors quota des déclencheurs »).
L'intention était donc juste dans le DOCUMENT, fausse dans le CODE. Double peine : (1) après ~4-5
relances, Marc était bloqué jusqu'au lendemain sans qu'aucun quota réel ne soit en cause, à rebours
de son objectif explicite d'aller vite ; (2) pire, son run manuel CONSOMMAIT le budget du tick, donc
l'automatique ne faisait plus rien de la journée — le manuel affamait l'auto.

**Leçon.** "Un budget/plafond est calibré pour UN CHEMIN D'EXÉCUTION précis (ici le quota runtime des
déclencheurs time-based). L'appliquer à un AUTRE chemin qui n'y est pas soumis (exécution manuelle
depuis l'éditeur) produit une DOUBLE peine : le chemin libre est bridé sans raison, ET il consomme le
budget du chemin contraint, qu'il affame. Règle : dès qu'un ADR ou un commentaire écrit « hors quota
X », le VÉRIFIER dans le code — il faut un drapeau explicite (`manuel`) qui coupe À LA FOIS le gate ET
le comptage, testé dans les DEUX sens (chemin contraint gaté / chemin libre non gaté ET non
comptabilisé). Corollaire de vérification : ce défaut n'apparaît qu'au PREMIER USAGE RÉEL — une suite
verte ne le voit pas, seule l'observation de ce que l'utilisateur peut réellement FAIRE le révèle."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-29 — Accélérer une campagne sous plafond de sécurité : RÉALLOUER, jamais AUGMENTER

**Contexte.** Marc : « je veux que tu le fasses toi automatiquement » à propos du reset C28-33. Le
reset était DÉJÀ 100 % automatique (branché dans `tickDriveAI`) — sa demande réelle était donc la
VITESSE, pas l'automatisation. Ce qui le bridait : son budget quotidien de 20 min/j. Le réflexe
tentant (relever les budgets) était exactement le piège documenté en C28-29 : au-delà de ~90 min/j de
runtime, TOUS les déclencheurs Apps Script gèlent — chien de garde inclus, donc panne silencieuse et
non signalable. Solution retenue : suspendre pendant le reset les campagnes de fond qui peuvent
attendre (historique Gmail 20, réconciliation Index 12, en plus de conso-2 12+6 déjà gatée) et donner
EXACTEMENT leur budget au reset (20/22/8 = 50 min/j = 50 min/j libérés). Enveloppe inchangée, débit
×2,5, aucune décision de risque prise à la place de Marc.

**Leçon.** "Quand un plafond protège une ressource PARTAGÉE (quota runtime, quota d'appels), accélérer
une campagne ne se fait JAMAIS en relevant son budget : on RÉALLOUE celui d'une campagne qu'on
suspend, en vérifiant que la somme ne croît pas. Le patron complet : (1) gater les campagnes
sacrifiables sur le même prédicat que la campagne prioritaire (`!resetEnCours_()`), pour qu'elles
reprennent SEULES à la convergence — jamais un ré-armement manuel ; (2) choisir des campagnes dont le
retard est sans conséquence (rattrapage) ou dont le travail serait de toute façon défait par la
campagne prioritaire (ici la réconciliation Index constaterait des « déplacé » sur des mouvements
voulus que le reset inscrit lui-même) ; (3) VERROUILLER l'invariant par un test qui DÉRIVE des
constantes (`budget(prioritaire) <= Σ budgets(suspendues)`) et le vérifier par MUTATION — gonfler un
budget doit faire échouer le test, sinon il ne protège rien. Corollaire produit : quand l'utilisateur
demande « fais-le automatiquement » alors que c'est déjà automatique, la vraie demande est la vitesse —
le dire, puis lui laisser l'arbitrage vitesse/risque plutôt que de relever un plafond de sécurité
à sa place."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-29 — Test de MUTATION : restaurer par copie de sauvegarde, jamais par `git checkout <fichier>`

**Contexte.** Pour prouver qu'un nouveau test attrapait bien la régression qu'il prétendait couvrir
(leçon C28-32 : un test peut VERROUILLER le bug), j'ai temporairement remis le code buggé, lancé la
suite (le test échouait bien ✅), puis restauré. Pour `src/Reset.gs` j'avais fait un `cp` de
sauvegarde — correct. Pour `src/Config.gs` j'ai utilisé `git checkout src/Config.gs` : le fichier
portait des modifications NON COMMITTÉES (la réallocation des budgets, cœur du chantier) et elles ont
été SILENCIEUSEMENT écrasées par la version de HEAD. Le test d'invariant repassait au vert… en
mesurant les ANCIENNES valeurs. Détecté en relisant le fichier juste après (« pourquoi 8/8/4 ? »).

**Leçon.** "Un test de mutation modifie puis restaure un fichier de code : la restauration passe
TOUJOURS par une copie de sauvegarde prise juste avant (`cp fichier /tmp/…` puis `cp` retour), JAMAIS
par `git checkout <fichier>` / `git restore <fichier>` — ces commandes restaurent depuis l'index ou
HEAD et DÉTRUISENT sans avertir les modifications non committées du même fichier (exit 0, aucune
alerte). Corollaire : après toute manipulation destructive d'un fichier de travail, RELIRE la valeur
qu'on croit y avoir mise (`grep` sur la constante) — vérifier l'artefact, jamais le code de sortie
(même famille que la leçon des backticks dans `git commit -m`)."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-30 — Une clé d'idempotence qui mémorise un ÉCHEC DE RÈGLE doit porter la version de la règle

**Contexte.** C28-33, premier reliquat RÉEL après ~12 h de reset automatique : une dizaine de
fichiers restés dans `_TRI 2026/01` faute de règle de routage. Marc valide l'un des cas (« Anna
Malaval doit avoir un dossier »). J'ajoute la personne à `RESET_PERSONNES_AUTRES` et une règle pour
les « codes de récupération »… et en relisant le chemin de placement je constate que ça n'aurait
RIEN changé : `placerUnFichierReset_` pose sa clé `tri33p|<tag>|<fileId>` dans TOUS les cas, y
compris quand le fichier n'est PAS routé (statut `tri33-reste`) — c'est voulu (ne pas re-hasher un
non-routé à chaque run), mais ça fige aussi le VERDICT à vie. Le fichier d'Anna n'aurait jamais été
re-présenté, et j'aurais annoncé à Marc « c'est fait » pour un correctif inopérant. Correctif livré
dans le même PR : `CONFIG.RESET_TABLE_VERSION` entre dans la clé (`tri33p|<tag>|<version>|<fileId>`).

**Leçon.** "Une clé d'idempotence peut mémoriser deux choses très différentes : un SUCCÈS (« ce
fichier est rangé » — définitif, la clé doit le figer) ou un ÉCHEC DE RÈGLE (« je n'ai pas su le
router » — révisable, car il dépend d'une TABLE DE RÈGLES qui vit dans le code). Dans le second cas,
la VERSION de la table fait partie de l'état qui commande la décision (corollaire direct de « une clé
encode TOUT l'état qui commande la décision ») : sans elle, affiner la règle est SANS EFFET et on
annonce un correctif qui ne s'appliquera jamais. Mettre la version dans la clé rend l'affinage
effectif ; c'est sûr à condition que la COLLECTE ne puisse re-présenter QUE le reliquat (ici le
placement n'itère que sur `_TRI` — un fichier rangé n'y est plus, donc jamais re-déplacé), invariant
à verrouiller par un test dédié. Réflexe de revue : pour chaque clé posée, se demander « SUCCÈS
définitif ou ÉCHEC de règle révisable ? » — et pour le second, « qu'est-ce qui le fera re-tenter le
jour où la règle change ? ». Corollaire produit : ce défaut ne se voit qu'au premier RELIQUAT réel,
jamais en test — c'est en regardant ce que le moteur N'A PAS su faire qu'on le trouve."

**Règle durable ?** oui (ajouté à CLAUDE.md §7, en corollaire de la règle sur les clés d'idempotence).

## 2026-07-30 — Quand un RAPPORT EXHAUSTIF existe, ne jamais chiffrer depuis un échantillon

**Contexte.** C28-33, reset en production. J'ai annoncé à Marc « il reste une dizaine de fichiers non
routés » après avoir inspecté le contenu d'UN SEUL dossier (`_TRI 2026/01`) via la recherche Drive.
Or le moteur écrivait depuis le début un rapport EXHAUSTIF prévu exactement pour ça — l'onglet
`Reset` de la Sheet d'état. En le lisant le lendemain : **134** non routés (63 en `03`, 36 en `02`,
10 en `01`) + 25 quasi-doublons, soit 13× mon estimation. Pire que l'erreur de chiffre : le
DIAGNOSTIC changeait. Sur 10 fichiers je voyais des cas particuliers (« il manque deux règles ») ; sur
134, la structure des données saute aux yeux — `Contrat` ×18, `Correspondance` ×16, `Paie` ×10, tous
bloqués par des **dossiers manquants dans la structure**, pas par des règles. Les deux questions
posées à Marc n'auraient jamais existé si j'étais resté sur mon échantillon.

**Leçon.** "Dès qu'un artefact de sortie EXHAUSTIF existe (onglet de rapport, journal, index), tout
chiffre ou diagnostic donné à l'utilisateur se lit DEDANS — jamais par extrapolation d'un échantillon
pratique d'accès (le premier dossier, les 10 derniers fichiers, une recherche Drive). Un ordre de
grandeur faux se propage : il fixe la priorité (« une dizaine » = anecdote qu'on traite au cas par
cas ; 134 = chantier structurel), et surtout il MASQUE la distribution — c'est le COMPTAGE PAR
CATÉGORIE sur l'ensemble qui révèle la cause commune, invisible sur un échantillon. Réflexe : avant
d'annoncer un volume, se demander « le système écrit-il déjà ce chiffre quelque part ? » ; si oui, le
lire, et si l'artefact est trop gros pour être lu d'un bloc, l'agréger (compter par catégorie) plutôt
que d'en regarder le début. Corollaire de communication : une estimation donnée sans sa source est
reçue comme un fait — annoncer l'écart explicitement quand on le découvre, et dire d'où venait
l'erreur."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-31 — Deux bornes sur la même boucle : celle qui coupe en premier fixe le débit

**Contexte.** C28-33, Marc veut le reset fini dans la journée et demande d'aller plus vite. Le
réflexe interdit (leçon du 29/07) serait de relever un budget qui protège le quota runtime partagé
(~90 min/j) — le gel de TOUS les déclencheurs, chien de garde inclus, est le risque connu. J'avais
déjà réalloué tout le réallouable. En relisant les bornes, constat : chaque phase du reset porte
DEUX bornes indépendantes sur la même boucle — un **garde-temps** par run (3 min, vérifié à chaque
item) ET un **plafond d'ITEMS** par run (60, 80, 40). La revue quota #226 l'avait noté sans que j'en
tire la conséquence : « ~60 moveTo en bien moins de 3 min → c'est le plafond d'items qui mord, pas
le temps ». Autrement dit le moteur rendait la main avec du budget DÉJÀ ACCORDÉ non consommé, à
chaque tick, depuis le début. Relever le plafond d'items (60→400) n'augmente donc AUCUN budget : le
garde-temps reste la vraie borne, inchangé.

**Leçon.** "Quand une boucle porte DEUX bornes de nature différente (temps ET nombre d'items), la
seule qui compte est celle qui coupe EN PREMIER — et si c'est la mauvaise, on gaspille en silence la
ressource qu'on croyait allouer. Avant d'envisager d'augmenter quoi que ce soit pour accélérer, se
demander : « laquelle des bornes mord réellement, et est-ce celle qui PROTÈGE quelque chose ? » Un
plafond d'items qui coupe avant le garde-temps ne protège plus le quota (le temps s'en charge) : il
ne borne que la mémoire et la granularité de reprise, donc il se relève GRATUITEMENT. Condition de
sûreté à vérifier explicitement : le garde-temps doit être évalué À CHAQUE ITEM de la boucle (pas
seulement en tête), sinon relever le plafond d'items fait déborder le temps — le vérifier par un test
qui lit le corps des boucles concernées. Corollaire : cet écart ne se voit pas dans les tests (qui
mockent le temps) ni dans les logs — il se voit en comparant le PLAFOND au COÛT RÉEL par item mesuré
en prod."

**Règle durable ?** oui (ajouté à CLAUDE.md §7, en complément de « réallouer, jamais augmenter »).

## 2026-07-31 — Correction : un plafond d'items ne « gaspille » pas un budget compté en ms

**Contexte.** Le matin même, j'avais relevé les plafonds d'items par run du reset (60/80/40 → 400/300/150)
en écrivant — dans `Config.gs`, dans `HANDOVER.md` et jusque dans une règle durable de `CLAUDE.md` §7 —
que le moteur « rendait la main avec du budget déjà accordé non consommé, à chaque run ». La revue quota
de la PR #229 a réfuté ça en lisant le comptage : `budgetJourReset_` crédite `Date.now() - debut`, donc
des **ms réellement consommées**. Un run qui coupait à 45 s sur le plafond d'items ne perdait rien du
tout — les ~2 min restantes étaient dépensées au tick suivant. Le débit journalier est fixé par les
budgets/jour (20/22/8 min), point. Le gain réel du relèvement est l'amortissement du coût FIXE de setup
par run (`ensembleDomainesProteges_`, lecture du plan, `entitesValideesParCle_`) : **≈ +5 %, pas ×5**.

**Leçon.** "Avant de conclure qu'une borne 'gaspille' du budget, LIRE dans quelle unité le budget est
compté. Un budget quotidien exprimé en ms CONSOMMÉES est conservatif : toute borne qui coupe un run plus
tôt reporte le reliquat au run suivant, elle ne le détruit pas. Ce n'est que si le budget est compté en
RUNS (ou en ticks) qu'un plafond d'items se traduit directement en débit. Corollaire opératoire : le
levier de débit qui marche presque toujours n'est pas de relever une borne mais de réduire le TRAVAIL PAR
ITEM — ici, ne plus re-télécharger les octets d'un fichier dont l'empreinte est déjà à l'Index ou au plan
de consolidation (`empreinteBlob_` est le poste dominant du placement), et mémoïser les résolutions de
dossier refaites pour chaque fichier alors qu'il n'y a que quelques dizaines de cibles distinctes.
Corollaire de communication : un chiffre d'accélération ne s'annonce qu'après avoir été dérivé du modèle
de coût (coût/item × budget/jour) ; sinon on vend à l'utilisateur un facteur qu'on n'a pas."

**Règle durable ?** oui (remplace la version fausse de la règle « deux bornes sur une même boucle » dans CLAUDE.md §7).

## 2026-07-31 — Une borne HAUTE sur une source append-only fige l'UI en silence

**Contexte.** L'app lisait `Index!A2:H20000` — fenêtre dure, ancrée en TÊTE. L'Index est append-only
(garde-fou §2) et le reset C28-33 y écrit DEUX lignes par fichier (`tri33|` puis `tri33p|`). À 10 830
lignes et ~10 000 fichiers restants, le seuil allait être franchi *dans la journée* : à partir de là,
l'app n'aurait plus vu AUCUNE ligne nouvelle — zéro erreur, zéro log, Marc aurait cru le moteur arrêté,
le jour même où il regardait le résultat. C'est la PR d'accélération qui rendait la panne imminente.

**Leçon.** "Toute borne HAUTE posée sur une source qui CROÎT (`A2:H<N>`, `LIMIT n` sans offset, tableau
tronqué en tête) est une bombe à retardement silencieuse : au franchissement, elle ne lève rien, elle
FIGE. Deux réflexes : (1) sur une source append-only, lire une fenêtre OUVERTE ou ancrée en QUEUE, jamais
un plafond en tête ; (2) quand une modification AUGMENTE le taux de croissance d'une ressource, aller
relire les bornes que d'autres composants ont posées dessus — c'est le changement de débit qui transforme
un point de vigilance lointain en panne du jour. Ce type de défaut ne se voit ni en test ni en CI : il se
voit en se demandant 'qu'est-ce qui, ailleurs, suppose que cette table est petite ?'"

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

## 2026-07-31 — Supprimer une FEATURE à cheval app/moteur : inventaire par COUCHES, retrait ATOMIQUE des vitrines

**Contexte.** C28-41 : Marc supprime des pans entiers de l'app (« et le code en lien aussi »). Chaque
feature retirée traversait cinq couches : bouton UI → fonction app (google.ts) → action web app
(doPost) → consommateur du tick (scanDemandeTri_, balayerAnalyseCiblee_…) → VITRINES d'état
(lignes Progression/Télémétrie + jauge app). Retirer l'UI seule (PR1) a laissé deux semaines
« virtuelles » de vitrines mortes possibles : une jauge « tri à la demande » figée à 0/500 aurait
reproduit EXACTEMENT la plainte d'origine (« jamais à jour, semble pas marcher ») — un cadran qui
mesure une feature morte est indistinguable d'une panne.

**Leçon.** "Supprimer une feature se planifie par COUCHES, avec un grep par NOM à chaque étage
(bouton, fonction client, action serveur, consommateur du tick, constantes CONFIG, Properties,
lignes de télémétrie/progression, clés i18n, mocks, tests) — et les VITRINES d'état d'une feature
(jauge, ligne de progression, compteur) se retirent ATOMIQUEMENT avec son producteur, dans la même
PR : un cadran qui survit à sa feature affiche un zéro éternel que l'utilisateur lit comme une
panne. Corollaire : les helpers partagés se vérifient par LEURS AUTRES APPELANTS avant retrait, par
GREP — jamais de mémoire : chercherVariante_/incrementerVuEntite_ étaient bien vivants
(correction 1-clic, curation), mais j'ai d'abord cru vivants chercherLigneFusionnable_ et
compterSousDossiersRegroupables_ (« les prompts s'en servent ») — le grep de la revue flotte a
prouvé ZÉRO appelant (le décompte des prompts est INLINE dans inventaireDossiers_) : deux
fonctions mortes de plus, et trois documents vivants qui gravaient une justification fausse."

**Règle durable ?** non (instance des règles §7 « retrait de code : frontières + filet de surface »
et « vérifier la prod par un signal indépendant » — consignée ici pour le réflexe par couches).

## 2026-07-31 — Une réallocation se prouve dans l'UNITÉ du quota protégé ; un invariant qui SOMME des constantes est aveugle à une étape SANS constante

**Contexte.** C28-42 (ADR-0030 PR5) : passe LLM du reliquat non-routable. J'ai livré la passe avec
pour seule justification budgétaire « elle prend le créneau LLM du tick (3 min) que
migration/réanalyse/dry-run — suspendues pendant le reset — libèrent », et j'ai écrit dans l'ADR
que « l'invariant reset ≤ campagnes suspendues (test par mutation) est intact : aucun budget
quotidien ajouté ». La revue flotte (quotas 🔴, coût 🟠, code-reviewer 🟠 — trois lentilles, le
même trou) a démonté l'argument : ces campagnes n'ont que des sous-budgets PAR TICK (2 min) et
consommaient ~0 pendant le reset — le « créneau libéré » n'existe pas en ms/JOUR. Sans borne
quotidienne, le drainage (~70-134 docs × 20-60 s) concentrait 50-130 min de runtime sur UN jour,
pendant que `resetTermine_()` (qui n'inclut pas le drapeau LLM) pouvait rendre leurs 50 min/j à
histo+sync+conso → gel C28-29 de tous les déclencheurs, chien de garde inclus. Et le test
d'invariant restait VERT : il ne somme que les constantes `*_BUDGET_JOUR_MS` — une campagne sans
constante lui échappe entièrement.

**Leçon.** "Une RÉALLOCATION de budget se prouve dans l'UNITÉ du quota qu'elle prétend protéger :
un créneau PAR TICK n'est jamais une enveloppe PAR JOUR — si les campagnes 'remplacées' ne
portaient pas de constante quotidienne, leur consommation libérée est ~0 et la nouvelle étape est
une ADDITION NETTE, pas une réallocation. Toute nouvelle campagne de fond reçoit donc SA constante
`*_BUDGET_JOUR_MS` (ms réelles persistées), prélevée sur l'enveloppe existante (ici placement
22→14, 04 8→4). Corollaire invariant : un test qui SOMME des constantes est structurellement
AVEUGLE à une étape qui n'en a pas — il reste vert pendant que l'enveloppe croît. Ajouter une
étape à une famille budgétée = ajouter sa constante À LA SOMME du test, et re-prouver par
mutation (la gonfler doit faire échouer). Réflexe de conception : avant d'écrire 'réalloué' dans
un ADR, montrer le calcul dans l'unité du quota (min/j), pas l'argument nominal."

**Règle durable ?** oui (corollaire ajouté à la règle « réallouer, jamais augmenter » de CLAUDE.md §7).

## 2026-07-31 — Une chaîne concaténée où un « + » de fin de ligne manque est tronquée EN SILENCE (ASI) ; seul un test de CONTENU l'attrape

**Contexte.** Audit de fond (6 agents) demandé par Marc (« empêcher tous les bugs »). L'agent moteur
a trouvé dans `promptChatAssistant_` (WebApp.gs) deux lignes d'une longue concaténation
(`return 'a ' + 'b ' + …`) où le `+` de fin manquait sur deux lignes consécutives. En JavaScript,
`return A + B \n C + D` (B ne finit pas par `+`, C est une string) déclenche l'insertion automatique
de point-virgule : `return A + B;` puis `C + D;` — statement mort. **Aucune erreur de syntaxe.** Le
prompt du chat était donc amputé de sa moitié : règle anti-FUSION (le chat pouvait proposer une
fusion destructrice de dossier), « je ne fais que PROPOSER » (il pouvait prétendre avoir agi), date
du jour. `test/surface-moteur.test.js` restait vert : il vérifie la PRÉSENCE de la fonction, jamais
le CONTENU de ce qu'elle retourne.

**Leçon.** "Toute chaîne longue construite par concaténation `+` multi-lignes (prompt LLM, message,
requête) est une bombe à ASI : un seul `+` de fin de ligne oublié coupe le `return`/l'affectation à
cette ligne et transforme le reste en code mort, SANS erreur ni test rouge. Un test de SURFACE
(existence de la fonction) est structurellement aveugle. Réflexe : verrouiller ces chaînes par un
test de CONTENU qui asserte la présence des marqueurs situés APRÈS chaque point de coupure possible —
en particulier le TOUT DERNIER fragment (la dernière phrase, la date interpolée en fin) : s'il est
présent, la chaîne n'a pas été tronquée en chemin. Prouver le test par mutation (retirer un `+` doit
le faire échouer)."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

---

## 2026-08-01 — Copier un « mur page à jour » d'un scan Gmail à l'autre exige SON backstop — mais le TYPE de backstop dépend de la sémantique de l'état (mutable ⇒ cyclique perpétuel ; terminal ⇒ mur gaté par un drapeau de backlog)

**Contexte.** Revue flotte `apps-script-quota` de la Vague 2 (perf/anti-gel). Le correctif #2 avait
copié dans le scan PJ vivant (`traiterGmail_`) le « mur page à jour » du scan de tri
(`scanAvantTri_`) : dès qu'une page 0 ne porte aucune PJ inédite, on arrête de paginer les pages
1+ (économie de quota Gmail à chaque tick). Le raisonnement « PJ inédite ⇒ en page 0 » est vrai en
RÉGIME mais FAUX dès qu'un BACKLOG existe (reprise après panne crédit/quota, rafale, budget épuisé
en plein drainage) : les inédites dorment alors sur les pages 1+ que le tri Gmail (par DERNIER
message) ne remonte jamais → abandon À VIE. Or le tri avait EXACTEMENT ce piège, fermé par
`scanCycliqueTri_` : le mur avait été copié SANS son backstop. La tentation était de copier aussi le
cyclique. Mais la sémantique diffère : l'état de tri est MUTABLE (un mail lu des jours après son tri
change de clé → doit être re-trié → le cyclique doit tourner PERPÉTUELLEMENT). Une PJ indexée est
TERMINALE (jamais re-traitée) → un cyclique perpétuel re-lirait à vie des fils déjà indexés et
brûlerait le quota pour RIEN. Second piège trouvé par le `code-reviewer` : le filet ajoutait une
I/O `PropertiesService` NON gardée dans `traiterGmail_`, lui-même appelé NU dans l'intake (juste
avant `traiterDepots_`) — un blip Property aurait avorté tout le reste de l'intake du tick.

**Leçon.** "Reproduire un mur « page à jour » d'un scan paginé à un autre n'est correct que si on
reproduit AUSSI son filet de complétude — sinon on rouvre le trou que le filet fermait (un backlog
enfoui sous une page 0 à jour, jamais atteint). Mais le TYPE de filet se DÉRIVE de la sémantique de
l'état scanné, il ne se copie pas : état MUTABLE (peut redevenir « à traiter » : lu/non-lu, statut
révisable) ⇒ balayage CYCLIQUE perpétuel à offset persistant + plafond quotidien dans l'unité du
quota ; état TERMINAL (une fois traité, plus jamais re-vu : PJ indexée, fichier classé) ⇒ PAS de
cyclique (il brûlerait le quota à re-lire l'immuable), mais un simple drapeau qui DÉSACTIVE le mur
tant qu'un backlog est possible (armé aux coupes budget/panne/erreur AVANT la fin de fenêtre, levé
dès qu'une passe atteint la fin naturelle) — repagination complète seulement pendant le drainage,
mur (donc perf) le reste du temps, zéro écriture d'état en régime. Réflexe : avant de copier un
garde-fou de scan, se demander « l'état que JE scanne peut-il redevenir actif tout seul ? » — la
réponse choisit le filet. Et corollaire (déjà connu mais re-vécu) : tout NOUVEL accès d'état
(Property/Sheet) ajouté à une étape d'intake appelée NUE doit être ENVELOPPÉ d'un try/catch qui
dégrade sans throw — un blip ne doit jamais avorter l'intake (leçon « protéger l'intake »)."

**Règle durable ?** oui (ajouté à CLAUDE.md §7).

---

## 2026-08-01 — Une dédup « par run » qui MUTE une carte reconstruite à chaque appel est du code MORT ; et le test qui la « prouve » avec un objet partagé masque le trou

**Contexte.** Vague 3c, re-pointage d'entité dans le flux (`deciderRoutageV2_`). J'avais écrit : après
`repointerEntites_`, muter `ent.dossierId = cible.getId()` pour « ne jamais re-pointer 2× le même
run ». La revue `code-reviewer` a montré que c'est faux : `entitesValideesParCle_` RECONSTRUIT sa
carte à CHAQUE document depuis `_entitesCache` (jamais rechargé en cours de tick, ni mis à jour par
`repointerEntites_` qui écrit la Sheet). L'objet `ent` muté est donc JETÉ en fin d'appel ; le doc
suivant reconstruit `dossierId = ANCIEN_ID` → re-lit tout l'onglet Entités. La mutation était du code
mort entre deux docs. Pire : mon test « verrouillait » l'idempotence avec `entitesValideesParCle_ =
() => validees` — un objet PARTAGÉ, ce que la vraie fonction ne fait JAMAIS — donc il passait en
« prouvant » une dédup inexistante en prod (l'anti-pattern mock-fermeture §7, exactement).

**Leçon.** "Un mémo de déduplication « par run » ne peut PAS vivre dans une structure RECONSTRUITE à
chaque item (cache re-bâti par appel, DTO neuf) : la mutation est jetée avec l'objet. Il doit vivre
dans une structure à portée RUN que la reconstruction ne réinitialise pas — un set à portée
exécution (variable de module fraîche par run Apps Script, ou `ctx.repointes` passé explicitement
comme le fait le reset). Réflexe : « l'état où j'écris ma dédup SURVIT-il jusqu'au prochain item, ou
est-il reconstruit ? » Corollaire test (renforce §7) : un test qui mocke une fonction-source par un
OBJET PARTAGÉ (`() => memeObjet`) alors que la vraie reconstruit à chaque appel PROUVE une propriété
fausse — le mock doit RECONSTRUIRE par appel pour être représentatif. Prouver par mutation que le
test échoue sur l'ancienne approche."

**Règle durable ?** oui (corollaire ajouté à la règle mock-fermeture de CLAUDE.md §7).

---

## 2026-08-01 — Prouver qu'on peut SAUTER une étape de vérification : mesurer chaque invariant qu'elle protège sur SON PROPRE axe (un garde-fou qui ne change pas la sortie est invisible dans un diff avant/après)

**Contexte.** Suite #44, harness de comparaison 1↔2 passes (`DryRunV2Compare`, ADR-0034 §5) : prouver,
avant d'allumer la 2ᵉ passe conditionnelle, que sauter la passe 2 adversariale n'introduit pas
d'erreurs. Le premier réflexe est de comparer le RÉSULTAT (le PLACEMENT : domaine/sous-dossier/nom)
1 passe vs 2 passes et de compter les divergences. Mais la passe 2 protège AUSSI le flag `sensible`
(re-vérification immigration/fiscal, §2) — et depuis la décision Marc 2026-07-01, `sensible` **ne
route plus rien**. Donc un FAUX NÉGATIF `sensible` (passe 1 dit `false`, passe 2 corrige `true`) ne
change PAS le placement : il est **invisible** dans un diff avant/après du résultat. Un harness qui ne
regarderait que la divergence de placement conclurait « saut sûr » pour ce document, alors que sauter
la passe 2 vient de perdre le filet §2. D'où une colonne + un compteur DÉDIÉS
(`fauxNegatifSensibleV2_`), et un verdict qui met le faux négatif sensible AU-DESSUS du placement
identique (priorité au plus sévère).

**Leçon.** "Valider qu'une optimisation peut SAUTER une étape de vérification exige de mesurer CHAQUE
invariant que l'étape protège sur son PROPRE axe — pas seulement la divergence de la sortie
observable. Un garde-fou que l'étape produit mais qui n'influence PAS la sortie (ici `sensible`, qui
ne route plus depuis §2) est INVISIBLE dans un diff avant/après du résultat : il faut le compter
DIRECTEMENT (faux négatif `sensible` : passe 1 false → passe 2 true), jamais l'inférer de la
divergence de placement. Réflexe : lister ce que l'étape à sauter PRODUIT, et pour chaque sortie se
demander « change-t-elle le résultat observé ? si non, elle a besoin de sa propre métrique ». Et
ranger les verdicts par SÉVÉRITÉ : un raté invisible-mais-grave (filet §2 perdu) prime sur un
placement identique rassurant."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-05 — Une campagne ONE-TIME dont la CONVERGENCE est inatteignable sur un flux VIVANT devient un DEADLOCK permanent qui gèle les campagnes voisines gatées sur elle

**Contexte.** Incident « rangement bloqué » (Marc : « plusieurs jours sans avancer, tri 2026 vide,
structure encore en vrac »). Diagnostic sur le Drive RÉEL (recherche par `parentId`, `modifiedTime`) +
une fonction de diagnostic un-clic LECTURE SEULE (dump des Properties `DriveAI_RESET_*` / conso +
comptage du backlog par domaine via le code DÉPLOYÉ) + 2 investigations flotte du code. Résultat :
le reset (ADR-0030, `rassemblerReset_`) a pour SEULE condition de fin `examines===0` sur une passe qui
re-parcourt tout l'arbre — mais il n'a AUCUN drapeau « domaine épuisé » (contrairement à la
consolidation qui marque chaque domaine fini et le saute O(1)). Or l'intake tourne AVANT lui à chaque
tick : chaque fichier fraîchement classé (non keyé) est re-collectable → `examines ≥ 1` **perpétuel**
→ `DriveAI_RESET_RASSEMBLEMENT` jamais posé → `resetEnCours_()` true À VIE → la consolidation (gatée
`!resetEnCours_()`), **seul mécanisme qui scanne les racines de domaine et re-range le vrac**, est
suspendue à vie. Bilan : 305 fichiers legacy à plat non re-rangés, heartbeat pourtant vert. Ce n'était
NI une lenteur, NI une logique de classement cassée (le moteur SAIT où va chaque fichier —
`cheminCibleReset_` le prouve) : un **inter-blocage structurel**. Fix (décision Marc « applique
directement ») : retirer le reset (`RESET_ACTIF=false` → `resetEnCours_` false → conso reprend) + bump
`CONSOLIDATION_TAG` (le plan périmé avait recensé les 305 en « OK » sous une table antérieure → un
simple redémarrage ne les draine pas ; le bump purge + re-évalue tout sous la table courante).

**Leçon.** "Un flag de campagne ONE-TIME (migration, grand rangement) dont la CONDITION DE CONVERGENCE
est « une passe complète ne collecte plus rien » NE CONVERGE JAMAIS si une source CONTINUE (intake,
dépôts) réalimente le périmètre scanné avant chaque passe — et s'il gate une campagne PERPÉTUELLE
voisine (le rattrapage), il la gèle définitivement, heartbeat vert. Symptôme : un `enCours_()` true
depuis des JOURS + campagnes voisines à l'arrêt + backlog qui ne bouge pas ⇒ suspecter un DEADLOCK de
convergence, PAS une lenteur ni un budget — vérifier la CONDITION DE FIN et ce qui la nourrit, pas le
débit. Deux filets : (a) donner à toute campagne balayante un drapeau « unité (domaine) épuisée » qui
isole les nouveaux arrivants du critère de fin (comme la conso) ; (b) ne JAMAIS gater une campagne
PERPÉTUELLE sur l'état d'une campagne ONE-TIME structurellement non convergente. Et pour diagnostiquer
la prod qu'on ne peut pas exécuter : une fonction de diagnostic UN-CLIC lecture seule qui lit l'état
réel (Properties + comptage via le code DÉPLOYÉ, jamais un échantillon Drive) tranche un `INCERTAIN`
runtime en `CERTAIN` — c'est le signal indépendant. Corollaire déjà connu, re-confirmé : re-lancer une
campagne à clé de SUCCÈS ne re-traite pas ce qu'elle a figé « OK » — bumper la VERSION/tag pour
re-évaluer sous les règles courantes."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-11 — Réallocation de budget en PAIRE : l'agrégat ≤ plafond est AVEUGLE à un couple mal restauré

**Contexte.** PR #260 : le diagnostic un-clic `etatCampagnesRangement` (#259) avait prouvé sur la prod
que l'exécuteur de consolidation était le goulot (budget jour 6/6 épuisé, génération idle-throttlée).
Décision Marc « accélère, réalloc sûre » : `CONSOLIDATION_EXEC_BUDGET_JOUR_MS` 6→12 min/j, les +6 min
PRIS sur `FUSION_EXEC_BUDGET_JOUR_MS` (parké 6→0, campagne OFF) — pur transfert, enveloppe reset-OFF
INCHANGÉE (56 min/j ≤ 65, invariant `orchestration.test.js`, prouvé par mutation). Revue
apps-script-quota (🟢 avec réserve) : elle a identifié un footgun RÉEL que l'invariant existant ne
voit PAS. Si la fusion est un jour réactivée (`FUSION_EXEC_ACTIF=true`) en lui rendant son budget (0→6)
SANS redescendre l'exécuteur (12→6), l'enveloppe passe à 62 min/j — un near-gel — mais l'invariant
« agrégat ≤ 65 » reste VERT, puisque 62 ≤ 65. L'agrégat protège contre une HAUSSE globale, jamais
contre un TRANSFERT à moitié annulé : il est structurellement aveugle au couple. Corrigé par un test
dédié qui verrouille (a) la SOMME DU COUPLE `exec + fusion = 12 min` constante — casse si l'un dérive
sans que l'autre compense — et (b) l'interdit « campagne ACTIVE + budget quotidien 0 » (une campagne
réactivée sans qu'on lui rende son budget tourne à vide en silence : `consommeJour 0 >= 0`
court-circuite avant tout travail).

**Leçon.** "Quand une réallocation prend le budget d'une campagne A (mise OFF) pour le donner à une
campagne B, le test qui protège l'ENVELOPPE GLOBALE (agrégat ≤ plafond) ne suffit PAS — il ne voit
qu'une hausse totale, jamais un transfert à moitié restauré. Il faut EN PLUS un test qui verrouille la
PAIRE elle-même (A + B = constante) et qui interdit « campagne ACTIVE à budget 0 » (le signe d'un
transfert non rendu). Réflexe de revue pour toute réallocation à deux campagnes : « si on ne restaure
qu'une moitié du couple, quel test le voit ? » — si la seule réponse est « aucun, l'agrégat reste sous
le plafond », le couple n'est pas verrouillé, seulement l'enveloppe. Même famille que « promesse de
verrou = verrou codé dans le même commit » : le commentaire de restauration (remettre X, redescendre Y)
n'est une garantie que si un test échoue quand l'une des deux moitiés est oubliée."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-12 — Observabilité self-serve : la Sheet TRONQUE les gros onglets, un statut peut parler d'une AUTRE campagne, et l'exposition doit hériter le court-circuit du producteur

**Contexte.** Marc, après plusieurs « check » où je ne pouvais que lire l'index Drive (qui retarde) ou
demander à Marc de coller le journal de `etatCampagnesRangement` (#259) : « je veux rien avoir à faire
à la main, tu devrais pouvoir voir toi ». J'ai testé si `read_file_content` (Drive MCP) pouvait lire la
Sheet d'état DriveAI directement, en lecture seule, sans aucun geste de Marc. Trois découvertes :

1. **Ça marche, mais l'outil TRONQUE les gros onglets.** `PlanConsolidation` (1236+ lignes réelles) n'a
   rendu que les ~356 PREMIÈRES lignes, toutes datées du 5 août — jamais les plus récentes (celles qui
   auraient dit quelque chose d'actuel). Les petits onglets clé/valeur (`Santé`, `Télémétrie`,
   `Progression` — chacun écrit en UNE seule `setValues` par tick, patron déjà établi dans `Journal.gs`)
   sont, eux, passés intacts.
2. **Un statut peut mentir par CONFLATION de campagne, pas par erreur de calcul.** L'onglet `Santé`
   affichait « Rangement ancien Drive : terminé ✅ » — j'ai failli le lire comme « le rangement est
   fini, rien à faire ». En fait cette ligne lit `rangementTermine_()`, l'ANCIENNE campagne R3 (close
   depuis des semaines), totalement DISTINCTE de la consolidation `conso-3` en cours (qui draine encore
   `08 · Perso`, 996 fichiers à plat au moment du check). Sans remonter à la fonction/Property source,
   j'aurais annoncé un faux « c'est fini » à Marc.
3. **Fix durable choisi** : plutôt que de dépendre de la lecture fragile d'un gros onglet, j'ai étendu
   `majProgressions_`/`lignesProgression_` (Journal.gs) — DÉJÀ appelées à chaque tick, DÉJÀ une seule
   écriture Sheet — avec 2 lignes `consolidation-gen`/`consolidation-exec`, réutilisant les MÊMES
   lectures que `etatCampagnesRangement` (une seule règle, deux consommateurs). Revue flotte AVANT
   merge : apps-script-quota a trouvé qu'une version antérieure appelait `indexContient_` pour CHAQUE
   domaine à CHAQUE tick sans court-circuit — une fois la génération terminée, ce calcul devient le
   SEUL déclencheur restant de `chargerIndexCache_()` (scan >10 800 lignes) pour reconfirmer une valeur
   qui ne bouge plus JAMAIS. Fix : répliquer le MÊME court-circuit « déjà fini → ne relis plus rien »
   que `genererPlanConsolidation_` lui-même applique. code-reviewer a en plus trouvé que `traites` du
   curseur d'exécution omettait le `− 1` (n° de ligne physique, en-tête = 1) que `Diagnostic.gs`
   applique déjà — sans ce `− 1`, les deux surfaces (diagnostic manuel et Progression automatique)
   auraient affiché des chiffres DIFFÉRENTS pour la même réalité, et le numérateur aurait pu dépasser
   le dénominateur (« 7/6 », l'air d'un bug).

**Leçon.** "Pour rendre un moteur observable SANS dépendre d'un geste manuel : (1) ne JAMAIS lire
directement un gros onglet journal/plan via un outil de lecture générique — il tronque aux lignes les
plus ANCIENNES, jamais les plus récentes ; mirer l'état dans un petit onglet-résumé EXISTANT
(clé/valeur, une seule écriture par tick — patron `majSante_`/`majTelemetrie_`/`majProgressions_`), qui
lui passe toujours intact. (2) Avant de faire confiance à un libellé de statut (« terminé », « OK »),
remonter à la Property/fonction qu'il lit RÉELLEMENT — un statut peut être vrai pour une campagne
ancienne et complètement hors sujet pour celle qu'on croit vérifier ; deux campagnes qui se ressemblent
par le nom (« rangement ») peuvent être des mécanismes totalement distincts. (3) Exposer un diagnostic
existant dans un résumé déjà écrit à chaque tick DOIT hériter le MÊME court-circuit « déjà fini → ne
relis plus rien » que le producteur qu'il observe, sinon l'observabilité elle-même devient, une fois la
campagne terminée, le dernier poste qui continue de payer le coût qu'elle était censée nous éviter de
constater à la main. (4) Toute nouvelle surface qui ré-affiche un nombre déjà affiché ailleurs
(curseur, lignes consommées) doit répliquer EXACTEMENT la même conversion d'unité que la surface
existante — sinon les deux divergent d'une unité et l'une ressemble à un bug."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-12 — Séparer sélection (pure) et exécution (I/O) rend un garde-temps DÉCORATIF si le garde n'est vérifié que dans la boucle de sélection

**Contexte.** `HistoriqueVrac.gs` (journal quotidien du vrac par domaine, demande Marc : « pour
chaque dossier je veux un détail journalier de l'avancement jusqu'à la fin »). Première version,
dans l'esprit « fonction pure testée + wrapper I/O » déjà établi dans le projet :
`trancheHistoriqueVrac_` (PURE, testée) décidait de TOUTE la tranche de domaines à traiter en une
boucle qui ne fait qu'un `push()` — donc en microsecondes, quel que soit le nombre de domaines. Le
`garde()` qu'elle appelait n'avait jamais le temps de devenir vrai dans cette boucle. `majHistoriqueVrac_`
exécutait ENSUITE `res.tranche.map(compterVracRacineDomaine_)` — le VRAI travail (listing Drive,
jusqu'à 1000 fichiers/domaine) — SANS AUCUNE vérification de budget entre deux domaines. Résultat
concret : soit 0 domaine traité (si le budget de tick était déjà dépassé en entrant), soit TOUS les
domaines restants d'un coup, sans coupure possible — un domaine comme `08 · Perso` (~1000 fichiers)
risquait de faire déborder le mur dur 6 min d'Apps Script juste avant `verrou.releaseLock()`, gelant
le LockService jusqu'à expiration. Les tests passaient (12/12 verts) car le mock du garde était un
COMPTEUR incrémenté à chaque appel — un artefact du test, pas une horloge murale réelle dans une
boucle sans I/O : il ne révélait donc pas que le vrai goulot (le `.map()`) n'était jamais vérifié.
Trouvé en revue flotte apps-script-quota (🔴), AVANT tout déploiement — jamais en production. Corrigé
en fusionnant sélection et exécution dans UNE SEULE boucle qui vérifie `garde()` juste AVANT chaque
appel I/O, reproduisant le patron déjà correct ailleurs dans ce même projet
(`etatCampagnesRangement`, Diagnostic.gs : `for (...) { if (Date.now()-debut > ...) break;
compterVracRacineDomaine_(...); }`). Corollaire budget, trouvé dans la même revue : le sous-budget
PAR RUN (2 min) ne borne pas la JOURNÉE si la sweep doit reprendre sur plusieurs ticks — ajout d'un
budget QUOTIDIEN persisté (`budgetJourHistoriqueVrac_`, même patron que `budgetJourConsolidation_`),
compté dans l'invariant d'enveloppe reset-OFF et prouvé par mutation.

**Leçon.** "Le patron « fonction PURE testée + wrapper I/O impur » (déjà la norme dans ce projet)
cache un piège quand la fonction pure fait de la SÉLECTION sur un budget-temps : si la boucle qui
CHOISIT quoi traiter ne fait AUCUNE I/O elle-même, elle s'exécute quasi instantanément et le
garde-temps qu'elle vérifie ne peut JAMAIS couper en cours de route — toute la sélection passe d'un
coup. Le VRAI travail (l'I/O), exécuté ENSUITE dans une boucle séparée (souvent un `.map()` sur le
résultat de la sélection), se retrouve alors SANS AUCUNE protection de budget, même si le code
« a l'air » gardé (un `garde()` existe bien, juste au mauvais endroit). Réflexe de conception : un
garde-temps DOIT être vérifié DANS LA MÊME BOUCLE que l'opération qu'il protège, jamais dans une étape
de sélection préalable qui, elle, ne coûte rien — sinon le budget est décoratif. Réflexe de test :
un mock de `estBudgetDepasse()` qui est un simple COMPTEUR incrémenté par appel ne prouve PAS qu'un
garde-temps coupe une boucle d'I/O réelle — il faut en plus vérifier le nombre d'appels RÉELS à
l'opération protégée elle-même (pas seulement la taille du résultat final), sinon un test vert peut
masquer exactement ce bug. Corollaire budget (déjà connu, re-confirmé) : tout sous-budget PAR RUN
d'une nouvelle campagne de fond a besoin d'un budget QUOTIDIEN persisté à côté dès qu'elle peut
reprendre sur plusieurs ticks, jamais seulement le plafond par run compté comme s'il bornait la
journée."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 — Erreur de comptage avalée en 0 : indistinguable d'un vrai zéro, permanent dans un journal append-only

**Contexte.** Suite directe de la leçon du 12/08 ci-dessus : une fois `HistoriqueVrac` déployé et
lu en self-serve (sans geste de Marc), j'ai trouvé une anomalie DANS SES PROPRES DONNÉES le
lendemain : `06 · Études & diplômes` affichait `0` le 2026-08-12, alors que ce domaine contenait
**≥400 fichiers réels**, vus la veille par pagination Drive directe. Cause : `compterVracRacineDomaine_`
(Diagnostic.gs) enveloppait le listing Drive dans un `try/catch` et rendait `{n:0, tronque:false}`
sur TOUTE exception — exactement la même forme qu'un domaine réellement vide. `HistoriqueVrac` est
**APPEND-ONLY** (contrairement à `Progression`/`Santé`, réécrits chaque tick) : ce faux 0 n'aurait
jamais été corrigé, il serait resté dans la série temporelle pour toujours. Corrigé (revue flotte
apps-script-quota 🟢 + code-reviewer 🟢, 869 tests) : la fonction rend désormais
`{n, tronque, erreur:boolean}` ; le diagnostic un-clic affiche « ERREUR DE LECTURE » et exclut le
domaine de `totalVrac` (jamais additionner un `n:0` d'erreur, ça recréerait le même faux total) ;
`HistoriqueVrac` gagne une colonne `Erreur` et laisse `Vrac` VIDE (jamais `0`) sur ce cas — et la
sweep continue sur les autres domaines (une erreur locale n'arrête jamais un balayage). Trouvé au
passage (revue apps-script-quota) : ajouter une colonne à un onglet Sheet DÉJÀ CRÉÉ en prod ne fait
PAS apparaître son en-tête — `creerOnglet_` ne pose les en-têtes qu'à la création, jamais en
migration — réparé par le même patron que `Index!H1` (`if` cellule vide `then setValue`).

**Leçon.** "Une fonction de comptage/agrégation qui dégrade toute exception vers son compte de repos
(souvent `0`) rend une ERREUR indistinguable d'un ZÉRO RÉEL — le consommateur ne peut plus savoir
si « rien à signaler » veut dire « rien trouvé » ou « je n'ai rien pu lire ». C'est d'autant plus
dangereux quand la sortie nourrit un état qui ne se réécrit JAMAIS (journal append-only, historique) :
un 0 muet écrit une fois là devient une fausse vérité PERMANENTE, alors que le même bug dans un état
réécrit à chaque tick (Progression, Santé) se serait auto-corrigé au tick suivant. Réflexe de
conception : exposer un champ `erreur:boolean` DÉDIÉ plutôt que de réutiliser la valeur de succès
comme sentinelle d'échec ; propager ce flag jusqu'au consommateur final (afficher/marquer l'erreur
EXPLICITEMENT, jamais l'agréger comme une donnée valide) ; laisser la boucle appelante CONTINUER sur
les items suivants (une panne locale ne doit jamais stopper tout un balayage). Corollaire schéma :
étendre les colonnes d'un onglet Sheet déjà créé en prod exige le MÊME patron de réparation d'en-tête
que `Index!H1` (`creerOnglet_` ne migre rien, seulement la création). Réflexe de revue : pour toute
fonction qui compte/agrège et peut échouer (I/O, réseau, permission), se demander « mon 0 de succès
et mon 0 d'échec sont-ils LE MÊME 0 ? » — si oui, les séparer, surtout si la sortie alimente un état
qui ne se réécrit jamais."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 (bis) — Une réparation d'en-tête « comme Index!H1 » doit copier le POINT D'ATTACHE, pas juste la forme

**Contexte.** Correctif du jour même : j'avais ajouté la colonne `Erreur` à `HistoriqueVrac` et une
réparation d'en-tête `E1` « comme `Index!H1` », posée dans `initialiserSheet_` (Journal.gs). La revue
flotte (apps-script-quota ET code-reviewer, indépendamment) a soulevé le même point : rien ne prouvait
que cette réparation s'exécuterait sur la Sheet DÉJÀ créée en prod. J'ai classé ça comme un rapport
périmé (l'agent avait dû lire le fichier avant mon edit) sans le re-vérifier — erreur. En relisant les
données RÉELLES de `HistoriqueVrac` après le merge (self-serve), l'en-tête était toujours à 4
colonnes : la réparation n'avait JAMAIS tourné. Cause : `initialiserSheet_` n'est appelée que (a) à la
création initiale de la Sheet d'état, ou (b) via `feuille_(nom)` SEULEMENT si l'onglet nommé est
ABSENT. `HistoriqueVrac` existe déjà → aucun des deux chemins ne se déclenche → code mort. Le patron
`Index!H1` que j'ai copié fonctionne, lui, parce qu'il est posé au même endroit où `Index` est déjà
LU/ÉCRIT à chaque run (pas dans `initialiserSheet_`) — j'ai copié la FORME (« si cellule vide, poser
la valeur ») sans vérifier que je la posais au même TYPE d'endroit (un chemin garanti atteignable).
Corrigé en déplaçant la réparation dans `majHistoriqueVrac_`, le seul point du code qui écrit
réellement dans cet onglet à chaque tick actif.

**Leçon.** "Copier un patron de réparation d'en-tête (ou tout correctif « comme X ») sans vérifier
QUAND `X` s'exécute réellement ne copie que la FORME, pas la GARANTIE — le nouveau code peut être
syntaxiquement correct, testé, et pourtant ne JAMAIS s'exécuter en prod si son point d'attache
(souvent une fonction d'initialisation à usage unique) n'est pas sur un chemin réellement emprunté
pour la ressource déjà existante. Réflexe : avant de dire « réparé comme `Index!H1` », tracer
QUAND cette fonction tourne (grep ses call sites, comme pour tout garde-temps ou toute promesse de
verrou) et poser le nouveau correctif au même NIVEAU de garantie, pas au même NOM de fonction.
Corollaire revue : quand un agent de revue signale un point qui semble en décalage avec le diff déjà
appliqué, ne jamais le classer « périmé » sans re-vérification — soit relire le diff EXACT qu'il a vu
(timestamp), soit reproduire son raisonnement sur le code actuel ; ici l'agent avait raison, pas moi.
Corollaire observabilité : la seule preuve qui compte est la DONNÉE RÉELLE post-merge (ici : lire
`HistoriqueVrac` en prod et constater que E1 est toujours vide), jamais la présence du code dans le
diff — même famille que « déploiement vert ne prouve rien » (§7), mais appliqué à un état DONNÉES,
pas à un déploiement CODE."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 (ter) — Vercel sans framework : `maxDuration` se pose dans vercel.json, pas en `export const`

**Contexte.** Marc passe en Vercel Pro et demande de vérifier si les limites Hobby bridaient
quelque chose. Trouvé un incident réel : `GET /api/hub/summary` cumule ~27 timeouts sur 3 semaines
(cold start de la web app Apps Script parfois > 4,8 s, contre un `TIMEOUT_MS` plafonné à 8 s pour
rester sous le mur Hobby implicite ~10 s). Deux choses à corriger pour exploiter Pro : (1) épingler
`maxDuration` EXPLICITEMENT plutôt que de compter sur le nouveau défaut implicite de Pro (~15 s) —
mêmes principes que « tout geste manuel automatisé doit déclarer explicitement ce qu'il préservait
implicitement » (piège webapp Apps Script, §7) ; (2) le faire au bon ENDROIT. Ce dépôt n'utilise PAS
Next.js (`vercel.json` a `"framework": null`, build custom) — la convention `export const
maxDuration = N` dans le fichier de route est une convention **Next.js** (Route Segment Config, lue
par le compilateur Next), inerte silencieusement sur ce projet. Le bon mécanisme, indépendant du
framework, est `vercel.json` → `"functions": { "<chemin réel du fichier>": { "maxDuration": N } }`.

En creusant la piste « Pro débloque quoi d'autre », tentative de protection des previews par MOT DE
PASSE (demande explicite de Marc) : refusée par l'API Vercel (« Advanced Deployment Protection n'est
pas activée sur votre équipe ») — c'est un ADD-ON PAYANT séparé de Pro, non disponible via les outils
MCP (seul `siem` est achetable par ce canal). Mais la protection SSO Vercel (gratuite, déjà active
sur ce projet pour tout sauf le domaine custom) couvre déjà le besoin réel pour un projet solo.

**Leçon.** "Sur un projet Vercel SANS framework (`framework: null`), configurer `maxDuration` (ou
tout autre réglage par route habituellement exposé via une convention Next.js) passe par
`vercel.json` → `functions` (glob sur le CHEMIN RÉEL du fichier), jamais par un `export const` dans
le fichier de route — ce dernier est une convention de COMPILATEUR (Next.js la lit au build ;
`framework: null` signifie qu'aucun compilateur ne la lit, donc elle est silencieusement ignorée,
sans erreur). Avant de configurer un réglage 'à la Next.js' sur un projet 'Other', vérifier le
`framework` déclaré dans `vercel.json`. Corollaire produit : 'Vercel Pro' n'inclut pas tout ce qui
semble être une fonctionnalité Pro — la protection par mot de passe des previews (Password
Protection) est un ADD-ON PAYANT séparé ('Advanced Deployment Protection'), à activer/acheter
directement dans le dashboard Vercel, jamais supposé inclus sans vérification API. Et avant de
recommander un mot de passe pour 'protéger les previews', vérifier si la protection SSO (gratuite,
souvent déjà active) ne couvre pas déjà le besoin réel — un mot de passe n'apporte de valeur que
pour partager un lien preview avec quelqu'un HORS du compte Vercel du propriétaire."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 (quater) — Un plafond « dérivé » calculé en caractères ment si l'encodage ÉCHAPPE

**Contexte.** C28-44 PR1 (suivi générique des opérations, ADR-0038) : la Property `DriveAI_SUIVI_OPS`
persiste ~34 entrées avec messages d'erreur et raisons de skip tronqués, verrouillée par un test au
plafond DÉRIVÉ du registre (leçon §7 « borne contre ~9 Ko »). Le test a d'abord fait son travail une
première fois (troncatures 60/40 → 9 751 octets au pire cas, resserrées à 40/28)… puis la revue
apps-script-quota a montré que ce pire cas n'était PAS le pire : je mesurais des caractères 2 octets
(`é`), mais `JSON.stringify` ÉCHAPPE les guillemets, l'antislash et les caractères de contrôle
(dont le saut de ligne, fréquent dans les messages d'exception, et le guillemet dans les noms de
fichiers cités) en 2 à 6 caractères CHACUN — 34 messages « hostiles » de 40 caractères auraient
pesé 13-16 Ko une fois encodés, au-delà de la limite, avec un test au plafond pourtant VERT.
Corrigé : neutralisation `suiviTexte_` (guillemets/antislash/contrôles → espace) AVANT troncature,
appliquée AUSSI au goulot d'encodage (les textes hérités d'une vieille Property ne transitent pas
par le wrapper), filet DUR au flush (> 8,9 Ko ⇒ textes vidés, horodatages conservés — jamais un
`setProperty` qui lève en boucle), tests re-dérivés avec des caractères échappables et prouvés par
mutation.

**Leçon.** "Un test au plafond d'une valeur PERSISTÉE ENCODÉE (JSON dans une Script Property, ou
tout sérialiseur qui échappe) doit mesurer la taille APRÈS encodage avec des entrées qui exercent
l'ÉCHAPPEMENT (guillemets, antislashs, sauts de ligne — le contenu RÉALISTE d'un message
d'exception), jamais un simple « longueur × nombre » calculé sur les chaînes brutes : chaque
caractère échappable pèse 2 à 6 caractères une fois encodé et le pire cas réel peut valoir le
DOUBLE du pire cas naïf. Deux défenses complémentaires : (1) NEUTRALISER les caractères
échappables à l'entrée (taille encodée = nombre de caractères, le plafond redevient exact — et la
neutralisation se pose AUSSI au goulot d'encodage, pas seulement au point de capture, pour couvrir
les données héritées) ; (2) un filet DUR au point d'écriture qui dégrade (vider les champs texte,
garder l'essentiel) plutôt que de laisser l'écriture lever en boucle. Et tout filet « inatteignable
par construction » se teste quand même — en gonflant artificiellement la structure dans le test —
en documentant ce que le filet borne réellement (ici la part TEXTE ; la croissance STRUCTURELLE
est attrapée par le test au plafond dérivé, qui échoue bien avant)."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 (quinquies) — Étendre un contrat de colonnes lu par un consommateur déployé séparément : APPEND en queue, jamais une insertion qui décale

**Contexte.** C28-44 PR3 : l'onglet `Progression` passe de 7 à 10 colonnes pendant que l'app (un
AUTRE déploiement, Vercel) continue de lire `A2:G30` jusqu'à sa propre PR4. L'ADR esquissait
`…Statut | Détail | Dernière activité | Dernière erreur | Horodaté` — `Horodaté` déplacé de G en J.
Avec cet ordre, dès le premier tick post-merge moteur, la colonne G lue par l'app aurait contenu
une raison de skip à la place d'un horodatage : sémantique décalée SANS erreur, sur toutes les
lignes, pendant toute la fenêtre entre les deux déploiements. En gardant `Horodaté` EN G et en
AJOUTANT les 3 colonnes en H/I/J : l'app v6 lit exactement les 7 mêmes colonnes qu'avant, les
consommateurs indexés 0-6 (`lireLignesProgression_`, 12 tests) restent valides TELS QUELS — la
conversion des tests sans toucher UNE assertion a servi de preuve mécanique de compatibilité — et
la migration d'en-tête n'a même pas besoin d'effacer les lignes v2 (préfixe de colonnes identique).

**Leçon.** "Quand un contrat de colonnes (onglet Sheet, CSV, table) est lu par un consommateur
DÉPLOYÉ SÉPARÉMENT (app vs moteur, deux merges distincts), toute extension se fait par AJOUT EN
QUEUE — jamais une insertion ou un réordonnancement qui décale les positions existantes, même si
l'ordre 'logique' voudrait autre chose : pendant la fenêtre entre les deux déploiements, chaque
position décalée est lue avec l'ANCIENNE sémantique, sans erreur ni warning. Corollaire de preuve :
si la conversion des tests existants du consommateur ne touche AUCUNE assertion indexée, la
compatibilité est prouvée mécaniquement ; si une assertion doit bouger, c'est qu'un index a
changé — et qu'une prod mixte lira faux. Bonus : un préfixe de colonnes identique rend la
migration d'en-tête non destructive (réécrire la ligne 1 suffit, les données anciennes restent
lisibles)."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-13 (sexies) — Un horodatage lu par API se publie en TEXTE contrôlé ; un max sur dates textuelles se prend par timestamp parsé

**Contexte.** C28-45 (polish du suivi, retour Marc captures à l'appui) : la colonne « Dernière
activité » écrite comme cellule DATE ressortait « 8/13/2026 » — SANS l'heure — via l'API Sheets en
FORMATTED_VALUE (le rendu dépend du format de colonne et de la locale de la Sheet, pas du code) :
inutilisable pour « il y a X min ». Corrigé en publiant du TEXTE au format contrôlé `dd/MM HH:mm`
(via `Utilities.formatDate`), que l'app parse de façon fiable. Dans la même passe, la revue flotte
a attrapé DEUX vraies prises : (1) la plage app `A2:J` n'incluait pas la nouvelle colonne K
(`Type`) — la feature principale (compactage des routines) aurait été MORTE en silence, `l[10]`
toujours undefined ; (2) le « max » des activités du résumé prenait `sort().pop()` sur des chaînes
`dd/MM HH:mm` — ordre LEXICOGRAPHIQUE jour-major (« 31/07 » > « 13/08 ») : à chaque début de mois
le résumé aurait affiché « il y a 13 j » alors que tout venait de tourner — précisément la
confusion que le chantier corrigeait.

**Leçon.** "Trois règles sœurs pour tout horodatage qui traverse une API : (1) une cellule DATE
lue en FORMATTED_VALUE rend ce que le FORMAT DE COLONNE veut bien (souvent la date sans l'heure) —
tout horodatage destiné à être LU par un autre système se publie en TEXTE à format CONTRÔLÉ par le
producteur (`dd/MM HH:mm`), jamais en cellule Date ; (2) tout max/tri sur ces chaînes se fait par
TIMESTAMP PARSÉ, jamais lexicographiquement — un format jour-major inverse l'ordre au passage de
mois, et le bug ne se voit qu'à cheval sur deux mois (invisible en test naïf du jour même) ;
(3) quand on AJOUTE une colonne à un contrat, vérifier CHAQUE plage de lecture existante
(`A2:J` → `A2:K`) — un index au-delà de la plage rend `undefined` sans erreur et la feature qui en
dépend est morte en silence (même famille que « borne haute qui fige l'UI », version colonne)."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7, en compact).

## 2026-08-13 (septies) — `<details open>` sous React : contrôlé des deux côtés, sinon le poll referme le groupe sous la souris

**Contexte.** C28-46 : le groupe « tâches en veille » est un `<details>` dont l'état ouvert/fermé
doit être mémorisé (localStorage). Premier jet : `open={veilleOuverte}` depuis un `useState`
initialisé du localStorage mais JAMAIS mis à jour — or le composant re-rend toutes les 15 s (poll
de Progression) : à chaque re-render, React re-force l'attribut `open` à la valeur INITIALE du
state, refermant le groupe que l'utilisateur vient d'ouvrir à la main. Repéré avant revue.

**Leçon.** "Sous React, un `<details>` dont on pose la prop `open` devient DE FAIT contrôlé : tout
re-render re-force l'attribut à la valeur de la prop, écrasant les toggles manuels de
l'utilisateur — et dans une app qui POLL (re-render périodique garanti), le bug est systématique
(le groupe se referme sous la souris toutes les 15 s). Deux issues cohérentes : (a) contrôlé
COMPLET — `open={state}` + `onToggle` qui met à jour le state (et persiste) ; le sync state↔DOM à
la même valeur est un no-op, pas de boucle ; ou (b) ne PAS poser `open` du tout (non contrôlé) et
perdre la restauration initiale. Jamais l'entre-deux (prop posée, state jamais mis à jour)."

**Règle durable ?** non (piège React classique, consigné pour l'app — pas de règle CLAUDE.md).

## 2026-08-14 — Une estimation de fin doit connaître les PAUSES FUTURES, pas seulement les passées

**Contexte.** C28-47 : ajout d'une colonne « Fin estimée » par campagne. Le débit est lissé en
items/heure de temps RÉEL (pauses comprises, constante de temps 24 h) — un choix correct pour
amortir les salves quotidiennes. Mais le garde qui supprimait la date de fin projetée testait
`statut.indexOf('suspendu') !== 0`, ce qui ne matche NI « en pause (frein budget) » NI « en pause
(budget du jour épuisé) » — exactement les deux statuts qui déclenchent la ligne « reprise le … »
juste à côté. Résultat sur le cas RÉEL de prod (ré-analyse 322/1207 gelée par le frein mensuel) :
« reste 885 documents · ~4 j · vers le 18/08 · **reprise le 01/09** » — une date de fin AVANT la
date de reprise. Trouvé en revue flotte avant merge ; corrigé (`/^(suspendu|en pause)/`), testé sur
le cas prod exact, prouvé par mutation. Corollaire trouvé dans la même revue : au REDÉMARRAGE après
un gel long, le débit résiduel proche de zéro produit un horizon délirant pendant ~24 h → re-base
de la série au-delà de 36 h sans progrès (> TAU, pour ne pas re-baser une salve quotidienne).

**Leçon.** "Une estimation de fin construite sur un débit OBSERVÉ n'extrapole que le PASSÉ : elle
est structurellement incapable de connaître un blocage FUTUR (gel mensuel, budget qui se réarme,
dépendance amont pas encore satisfaite). Dès qu'une opération est en PAUSE, il faut donc afficher
le RESTE (fait objectif) et la DATE DE REPRISE (déductible de la règle de pause), mais JAMAIS un
horizon ni une date de fin — sinon deux chiffres contradictoires cohabitent et c'est le plus
optimiste que l'utilisateur retient. Deux corollaires : (1) le garde qui supprime la projection
doit couvrir TOUTES les familles de pause du vocabulaire de statuts (les tester une par une, sur
les statuts RÉELLEMENT produits par le code, pas ceux qu'on croit) ; (2) après une longue pause,
re-baser la série de mesure — un débit résiduel quasi nul survit au gel et produit un horizon
absurde au redémarrage."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-14 — Un « chemin de retour » qui est un DÉLAI n'est pas un chemin de retour

**Contexte.** C28-48. L'API Calendar n'était pas activée dans le projet GCP : le moteur détectait
proprement le 403, suspendait la création d'intentions 24 h et… attendait. La re-sonde passait par
le chemin de TRAVAIL (scan Gmail + appels LLM jusqu'à la première création) — si coûteuse qu'il
fallait bien l'espacer de 24 h. Conséquence pratique : Marc pouvait activer l'API à 08:00, DriveAI
ne le voyait pas avant le lendemain. Le garde-fou respectait pourtant la règle §7 (« un garde-fou
qui met des items HORS CIRCUIT exige un chemin de RETOUR auto ») : le retour EXISTAIT, mais c'était
un minuteur, pas une observation. Second défaut découvert en même temps : l'erreur conservée était
le corps 403 BRUT, un JSON INDENTÉ ; tronquée pour l'affichage (cellule d'erreur de `Progression`,
40 caractères) elle ne montrait que `config-api Calendar : {    error : {` — impossible de
distinguer « API pas activée » de « API activée dans un AUTRE projet GCP ». Or `error.message`
contient précisément le numéro de projet et l'URL d'activation.

**Leçon.** "Quand la condition de sortie d'une suspension est un ÉTAT EXTERNE OBSERVABLE (une API
activée, un crédit rechargé, un quota réarmé), le chemin de retour doit être une SONDE de cet
état — pas l'expiration d'un minuteur. Et cette sonde doit emprunter un chemin PAS CHER, distinct
du chemin de travail : re-sonder PAR le travail (ici un scan Gmail + des appels LLM) coûte si cher
qu'on est forcé de l'espacer, ce qui reconvertit la sonde en délai. Une sonde bon marché se
construit en cherchant la réponse la moins engageante qui distingue quand même les deux mondes
(ici : un GET sur un identifiant volontairement INEXISTANT — 403 « service disabled » vs 404 —,
qui ne lit aucune donnée de l'utilisateur, n'énumère rien, n'ajoute aucun scope). Trois exigences
qui vont avec : verdict TRI-ÉTAT à échec FERMÉ (un doute réseau/5xx ne lève JAMAIS la suspension) ;
horodatage de sonde posé AVANT l'appel (une sonde qui lève ne doit pas se rejouer à chaque tick) ;
et enveloppe try/catch si l'étape est appelée NUE en tête de tick. Corollaire diagnostic : un
message d'erreur de plateforme se conserve par son CHAMP EXPLOITABLE (`error.message`), jamais par
son enveloppe brute — le JSON indenté de Google, une fois tronqué pour l'affichage, ne montre que
sa ponctuation, et c'est exactement l'information qui manque pour trancher."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7, en corollaire de « chemin de RETOUR auto »).

## 2026-08-14 — Ne jamais RE-DÉRIVER un verdict déjà rendu à partir de sa forme affichable

**Contexte.** C28-48, trouvé en revue de code AVANT merge (ni la revue sécurité ni la revue quotas
ne l'ont vu). Chaîne réelle : `creerTache_`/`creerEvenement_` testent « API non activée » sur le
corps 403 **BRUT** (`estMessageApiDesactivee_`, 4 signatures), puis lèvent une exception dont le
message est le corps *rendu lisible* : `'config-api Tasks : ' + messageErreurGoogle_(corps)`, où
`messageErreurGoogle_` extrait `error.message`. En aval, `signalerPanneConfigApi_` re-testait la
MÊME fonction de détection sur cette chaîne. Or deux des quatre signatures
(`accessNotConfigured`, `SERVICE_DISABLED`) ne vivent pas dans `error.message` mais dans
`error.errors[].reason` / `error.status` : sur un 403 « Access Not Configured », la détection amont
disait `true` et la détection aval `false`. Conséquence : aucune suspension posée → le mail
re-analysé à CHAQUE tick (scan Gmail + LLM, exactement l'incident C28-22 qu'on avait corrigé) → et
la nouvelle sonde de reprise jamais armée, puisqu'elle ne s'arme qu'à partir de la Property.
Silencieux et CONDITIONNEL : le 403 observé en prod ce jour-là (« has not been used in project »)
porte sa signature dans `error.message`, donc rien n'aurait cassé tout de suite.

**Leçon.** "Quand une décision est prise en amont sur une donnée RICHE (corps HTTP complet, objet
d'erreur), l'aval ne doit jamais la RE-DÉRIVER à partir de la forme APPAUVRIE qu'on a fabriquée
pour l'affichage. Rendre un message lisible, c'est jeter de l'information — et si un détecteur
tourne des deux côtés du rétrécissement, il ne rend pas le même verdict. Faire porter le verdict
par un MARQUEUR EXPLICITE que l'amont pose lui-même (préfixe canonique `config-api <API> : `, code
d'erreur typé, champ dédié), et n'utiliser le détecteur riche qu'à UN seul endroit. Réflexe de
revue, généralisable à tout pipeline : « cette condition est-elle évaluée deux fois sur deux
représentations différentes du même fait ? » Corollaire : améliorer un message d'erreur pour
l'humain est un changement de CONTRAT quand du code lit ce message — inventorier ses lecteurs
avant, comme pour un changement de schéma."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-17 — Une clé de SUCCÈS sur un item qui QUITTE sa source est irréversible de fait

**Contexte.** C28-49 PR1 (missions de curation), trouvé par les TROIS agents de la flotte en
convergence. `apparierUnique_` acceptait un jeton en SOUS-CHAÎNE (« moreau » matchait
« Moreault », « 783 » matchait « 7834 », un jeton de 2 chiffres matchait le JJ/MM du préfixe de
date des noms classés). Un faux appariement UNIQUE ne déclenche pas la garde d'ambiguïté : le
fichier est DÉPLACÉ au mauvais endroit avec une clé de SUCCÈS. Or la collecte est SOURCE-scopée :
parti de la source, le fichier n'est plus jamais re-vu — même un bump de `MISSIONS_REGLES_VERSION`
(le mécanisme prévu pour ré-évaluer les verdicts) ne le rattrape pas. À l'inverse, un REFUS trop
prudent est toujours rattrapable (le fichier reste en place, keyé sous version). Corollaire vu
dans la même revue (dispatch-03) : des verdicts rendus pendant que la DONNÉE mûrit (fenêtres
d'occupation dérivées de fichiers que la mission sœur est EN TRAIN d'ajouter) se figent pareil —
la version ne protège pas quand c'est l'ÉTAT DRIVE qui bouge, pas la table de règles → gater
l'aval sur la convergence de l'amont.

**Leçon.** "Dans un pipeline idempotent, l'asymétrie des verdicts commande la sévérité du
prédicat : un verdict NÉGATIF (refus, non-apparié) est RÉVISABLE (l'item reste à sa place, la clé
versionnée se ré-évalue par bump), mais un verdict POSITIF qui DÉPLACE l'item hors du périmètre de
collecte est DÉFINITIF DE FAIT — aucun bump ne re-présentera l'item. Le prédicat qui déclenche
l'action irréversible doit donc être STRICT (mot entier, jamais de sous-chaîne ; retirer du texte
les composants structurels comme le préfixe de date qui créent des collisions), et dans le doute
REFUSER — le refus coûte un re-examen, le faux positif coûte un document égaré avec un statut de
succès. Et quand les règles d'un aval dépendent d'un état que l'amont CONSTRUIT encore, l'aval se
gate sur la convergence de l'amont : la version des règles ne protège pas contre une donnée
mouvante."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).

## 2026-08-17 — Mutualiser UNE dimension d'une règle ne couvre pas les autres dimensions de la même décision

**Contexte.** C28-49 PR2 (missions Carrière/Finances), trouvé par la passe FINALE code-reviewer
sur le diff assemblé — APRÈS que deux rondes de flotte avaient validé l'approche. Le routage 02
partageait l'EMPLOYEUR (`employeurDuNom_`) et les BUCKETS d'année (`resetBucketAnnee_`) entre le
flux vivant et les missions — « une seule règle, deux consommateurs », leçon C28-26 appliquée en
apparence. Mais la détection de TYPE de la MÊME décision restait écrite DEUX fois, et divergeait
sur 3 cas réels : RL-1/RL-31 (fiscal côté flux via un motif ancré, « relevé » bancaire côté
mission — la table de mots ne sait pas exprimer « releve 1 »), le RIB (exclu côté flux, pris pour
un relevé côté mission), et « salaire » (couvert par le flux, absent de la liste mission — un
« Bulletin de salaire » partait dans `Employeurs/<X>` avec une clé de SUCCÈS, le mauvais domicile,
définitif). Les deux fenêtres d'années (1900-2099 vs 1990-2100) divergeaient pareil.

**Leçon.** "Mutualiser une règle partagée sur UNE dimension ne couvre pas les AUTRES dimensions
de la même décision — la mutualisation VISIBLE d'une dimension (l'employeur, le bucket) crée une
fausse assurance sur celles qui restent locales (le type, l'année, les exclusions), et les revues
elles-mêmes s'y arrêtent (« une seule règle ✔ »). Réflexe au moment de partager une règle :
INVENTORIER chaque prédicat que la décision consomme (type, année, émetteur, exclusions,
fenêtres numériques) et trancher pour CHACUN : partagé, ou localité justifiée PAR ÉCRIT. Une
divergence sur un chemin à clé de SUCCÈS est définitive (asymétrie des verdicts) — c'est le cas
qui paie l'inventaire."

**Règle durable ?** oui (ajoutée à CLAUDE.md §7).
