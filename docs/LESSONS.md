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
