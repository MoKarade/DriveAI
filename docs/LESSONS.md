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
