# ADR-0049 — Une panne d'agenda ne gèle plus l'archivage de la boîte

- **Statut** : accepté (2026-09-07)
- **Contexte** : incident 02-07/09/2026 (six jours), décision Marc du 2026-09-07
- **Révise** : ADR-0043 §2.1 (le périmètre de « intentions suspendues ») et ADR-0022 (« suspendre TOUT le scan »)
- **Complète** : ADR-0041 (jeton hubperso), ADR-0043 (mode dégradé du tri)

## 1. Problème

Le 07/09, Marc : « ça trie toujours pas mes mails ». Le moteur, lui, disait :

```
Tri Gmail : ⚠️ mode DÉGRADÉ (analyse d'intentions suspendue) — libellés posés, AUCUN archivage
API Tasks & Calendar : ⚠️ INDISPONIBLES — intentions mail suspendues (depuis le 06/09 17:33)
  · dernière sonde : indetermine (hubperso) — refresh OAuth hubperso momentanément impossible
```

Et le Journal, **chaque jour depuis le 02/09** : `Intentions différées : config-api Calendar :
jeton hubperso momentanément indisponible (échec transitoire du refresh OAuth)`. Six jours de
« transitoire ».

La chaîne causale, lue dans le code :

1. `traiterIntentionsMail_` sort immédiatement sur `estPanneConfigApi_()` — décision ADR-0022 :
   « suspendre TOUT le scan (pas seulement les créations) : re-lire les mails pour échouer à créer
   brûlerait le quota Gmail ». Juste pour le quota, mais avec un effet de bord non vu :
2. l'ANALYSE (pré-filtre + mini-check Haiku) ne tourne plus non plus — donc la clé `important|`
   n'est plus jamais posée ;
3. le tri attend cette clé pour archiver (ADR-0010 §3 : « la boîte de Marc sert de todo, un fil ⏰
   n'est jamais archivé ») ; ADR-0043 l'a rendu tolérant (« mode dégradé : libellés oui, archivage
   non ») — mais le dégradé, sans borne, est devenu l'état permanent.

Résultat : **une panne d'autorisation OAuth sur la création de tâches/événements — deux fonctions
sans rapport avec le rangement d'une boîte mail — a suspendu l'archivage pendant six jours.** Et
le message « momentanément indisponible », vrai à chaque tick, mentait sur la durée.

Le découplage était identifié depuis C28-52 (« PR2 découplage tri↔intentions ») et jamais fait.

## 2. Décisions de Marc (2026-09-07)

| Question | Réponse |
|---|---|
| Que doit faire le tri quand Tâches/Agenda sont en panne ? | **Garder l'analyse, ne suspendre que la création** (recommandé) |
| Quels mails de DriveAI couper ? | **Tout** — récap et alertes (C28-75, hors de cet ADR) |

## 3. Décision

**Une panne de configuration d'API (Tasks/Calendar, jeton hubperso) ne suspend que la CRÉATION.
L'analyse continue, et le tri redevient exact.**

1. **`traiterIntentionsMail_` ne sort plus sur `estPanneConfigApi_()`.** Le pré-filtre et le
   mini-check tournent comme en régime ; `important|` est posé.
2. **Un mail actionnable pendant la panne est DIFFÉRÉ** : clé `analyse|<messageId>` (statut
   `intention-en-attente-api`), posée *avant* l'extraction — l'appel LLM d'extraction, dont le
   résultat ne pourrait aboutir à rien, n'est pas fait. Préfixe dédié : `intention|` continue de
   signifier « entièrement traité ». Hors de `PREFIXES_CLE_FICHIER_` (un messageId n'est pas un
   fileId).
3. **Un différé ne coûte rien tant que la panne dure** : revisité, il sort avant toute lecture du
   corps et tout LLM. Au retour de l'API, il reprend à l'extraction (`extraireEtCreer_`, partagée
   avec le chemin nominal) sans rejouer le mini-check ; la garde zone protégée est re-vérifiée sur
   le corps (défense en profondeur, gratuite).
4. **Le tri accepte `analyse|` comme verdict** : `intention|` OU `analyse|` présent ⇒ `important|`
   est fiable ⇒ décision normale, archivage compris. `intentionsSuspendues_()` ne couvre plus que la
   panne de compte LLM (la seule qui empêche l'analyse) — et sous celle-ci, `Main.gs` saute l'étape
   tri entière : le mode dégradé d'ADR-0043 n'a plus de chemin vivant. Il est conservé (testé) comme
   défense en profondeur, et **retiré de l'onglet Santé** (ne jamais annoncer un état impossible).
5. **Le quota Gmail est protégé autrement** que par la suspension totale :
   - pendant la panne, un différé compte comme « déjà vu » pour le mur « page à jour » du scan
     avant — la fenêtre n'est pas repaginée à chaque tick ;
   - dès que l'API répond, il redevient inédit — et c'est un **drapeau de retard**
     (`DriveAI_INTENTIONS_RETARD`, même filet que `DriveAI_GMAIL_PJ_RETARD`, leçon §9 « état
     TERMINAL ⇒ un DRAPEAU qui désactive le mur tant qu'un backlog est possible ») qui garantit
     qu'on revient le chercher : armé quand un run diffère ou est coupé avant la fin de fenêtre
     (budget, plafond/run, panne, erreur de page), il désactive le mur ; levé à la fin naturelle
     (`!fils.length`). Zéro écriture de Property en régime ; lecture enveloppée, défaut prudent
     `retard = true`.
   - le plafond `INTENTIONS_MAX_PAR_RUN` compte désormais les messages **inédits** — un déjà-vu
     n'est qu'une lecture d'Index en mémoire. Compter les déjà-vus figeait un scan sans mur au même
     point (200 premiers messages) à chaque tick.
6. **Le message de panne dit la durée et la raison** (C28-77, `JetonHubperso.gs`) : la série
   d'échecs du refresh est mémorisée (`DriveAI_HUBPERSO_ECHEC` = `<ts du 1er>|<raison du dernier>`,
   close au premier succès) ; au-delà de `CONFIG.HUBPERSO_ECHEC_DURABLE_MS` (24 h), Santé cesse de
   dire « momentanément » et donne le code OAuth (`invalid_client`, `HTTP 500`…) avec la consigne.
   Sonde et chemin de création parlent le même texte.

## 4. Quotas et coût

- **LLM** : identique au régime — le mini-check (Haiku, expéditeur + sujet) tournait déjà pour
  chaque mail inédit ; l'extraction est différée, pas dupliquée. Pendant la panne : **0 appel** sur
  un différé.
- **Gmail** : pendant la panne, coût du régime (mur actif). Au retour : **une repagination de la
  fenêtre** (≈ 300-450 fils, un `getMessages` chacun), bornée par le budget de tick et les plafonds
  par run, jusqu'à la fin de fenêtre — du même ordre que la ré-évaluation qu'ADR-0043 chiffrait
  pour le tri (~10-20 min de runtime par épisode). Une fois, pas à chaque tick.
- **Properties** : une clé (`DriveAI_INTENTIONS_RETARD`) écrite aux bords seulement ; une clé
  (`DriveAI_HUBPERSO_ECHEC`) ≤ 60 octets.

## 5. Risques et gardes

- **Un différé qui sort de la fenêtre `newer_than:30d` avant le retour de l'API** ne créera jamais
  sa tâche (même « dette invisible hors fenêtre » qu'ADR-0043 §4). Son `important|` est posé, donc
  le tri, lui, est juste. Accepté : une panne de 30 jours est un incident à part entière.
- **Le trou préexistant du mur** (un scan coupé par le plafond/run laissait les pages suivantes
  orphelines au tick suivant) est fermé par le même drapeau — testé.
- **`estPanneConfigApi_` peut basculer EN COURS de run** (création qui échoue) : le message qui a
  révélé la panne n'est pas indexé (exception relevée, patron ADR-0022) et sera ré-analysé une
  fois au tick suivant — un mini-check, accepté.
- **Le prédicat `intentionsSuspendues_` reste le MIROIR des pannes qui suspendent l'analyse**
  (tripwire d'inventaire de `test/tri-gmail.test.js`) : `estPanneConfigApi_` y est justifié par
  écrit, comme `estPanneGmail_`.

## 6. Alternatives écartées

- **Archiver après N heures de panne par les règles déterministes** (proposé à Marc, non retenu) :
  un mail important déjà lu quittait la boîte sans ⏰. Rustine rapide, règle de Marc compromise.
- **Ne rien changer** : chaque panne d'agenda regèle l'archivage. C'est l'incident.
- **Rattraper les différés par un scan dédié à curseur** (comme `scanCycliqueTri_`) : plus de code
  et un troisième curseur Gmail pour un cas déjà couvert par le patron du drapeau de retard.

## 7. Tests

`test/intentions-fiabilite.test.js` (différé, revisite pendant/après, zone protégée au retour, mur
pendant/après, régime sans écriture, drapeau armé sur différé et sur coupe, plafond sur inédits,
Properties illisibles), `test/tri-gmail.test.js` (`analyse|` = verdict, important ⇒ ⏰ sans API,
attente d'un tick, table de vérité du prédicat, défense en profondeur ADR-0043 conservée),
`test/sante.test.js` (la ligne Tri dit « normal + création suspendue », jamais un mode impossible),
`test/jeton-hubperso.test.js` (raison, série, seuil dérivé de la constante, message durable). Prouvés
par mutation : retirer `analyse|` du verdict du tri, remettre la sortie anticipée de
`traiterIntentionsMail_`, compter les déjà-vus dans le plafond, retirer le drapeau — chacun fait
échouer au moins un test.
