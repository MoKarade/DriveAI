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
