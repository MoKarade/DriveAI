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
5. **Le quota Gmail est protégé autrement** que par la suspension totale, et le drainage est
   **reprenable** (revue flotte — quotas 🔴, file-checker 🔴 F1/F2/F5, code-reviewer 🟠) :
   - pendant la panne, un différé compte comme « déjà vu » pour le mur « page à jour » du scan
     avant — la fenêtre n'est pas repaginée à chaque tick ;
   - un **drapeau de retard** (`DriveAI_INTENTIONS_RETARD`) porte DEUX natures de backlog :
     `'c:<offset>'` — des pages **non analysées** sont derrière le mur (scan coupé par le budget, le
     plafond/run, une panne relevée, une erreur de page) : à drainer **panne ou pas** (sinon, le jour
     du déploiement, six jours de mails jamais analysés attendraient derrière le mur le geste de Marc
     sur l'OAuth, et l'incident persisterait sur l'essentiel de la boîte) ; `'d'` — seulement des
     différés en attente de l'API : mur ouvert **hors panne seulement**, drainage depuis le début ;
   - **reprenable** : à chaque coupe, la page atteinte est persistée (`c:<offset>`, jamais en
     arrière). Le tick suivant relit la page 0 (le neuf), puis **saute** une page avant l'offset
     (recouvrement : une insertion en tête ne fait que re-lire du déjà-vu ; un fil remonté en tête ou
     supprimé décale d'un cran, absorbé) et continue. Un drapeau booléen aurait repaginé de zéro à
     chaque tick sans progrès — avec 300-450 fils et le seul reliquat de budget (l'étape passe après
     l'intake), 86-130 k appels Gmail/jour contre ~20 k, quota épuisé en ~4 h, tri affamé : le
     correctif aurait recréé le symptôme ;
   - **levée** seulement à la fin de fenêtre, API répondant, sous `'d'`, sans différé ni **reprise**
     dans le run ; une fin de fenêtre sous `'c'` redescend à `'d'` (les pages sautées peuvent cacher
     des différés) ; sous panne, rien n'est jamais levé (les différés y sont invisibles) ;
   - une **reprise** = un message laissé sans clé terminale au drainage (échec LLM, création
     partielle) : il est profond dans la fenêtre, lever le drapeau l'aurait caché à vie derrière le
     mur, tâche jamais créée et rien pour le montrer. **Borné** : un échec LLM déterministe est
     abandonné après `QUARANTAINE_MAX` essais (`intention-abandonnee`, tracé), comme la création ;
   - le bloc drapeau s'exécute en `finally` : une panne **relevée** depuis une création (patron
     ADR-0022) arme la coupe au lieu de la sauter ;
   - le plafond `INTENTIONS_MAX_PAR_RUN` compte les messages **inédits** du scan avant — un déjà-vu
     n'est qu'une lecture d'Index en mémoire. Compter les déjà-vus figeait un scan sans mur au même
     point (200 premiers messages) à chaque tick. Le scan arrière, lui, compte tout (borne de lecture
     utile au rattrapage initial, mort en régime).
6. **Le message de panne dit la durée et la raison** (C28-77, `JetonHubperso.gs`) : la série
   d'échecs du refresh est mémorisée (`DriveAI_HUBPERSO_ECHEC` = `<ts du 1er>|<raison du dernier>`,
   close au premier succès) ; au-delà de `CONFIG.HUBPERSO_ECHEC_DURABLE_MS` (24 h), Santé cesse de
   dire « momentanément » et donne le code OAuth (`invalid_client`, `HTTP 500`…) avec la consigne.
   Sonde et chemin de création parlent le même texte.

## 4. Quotas et coût

- **LLM** : identique au régime — le mini-check (Haiku, expéditeur + sujet) tournait déjà pour
  chaque mail inédit ; l'extraction est différée, pas dupliquée. Pendant la panne : **0 appel** sur
  un différé.
- **Gmail** : pendant la panne, coût du régime sous `'d'` (mur actif) ; sous `'c'`, le drainage des
  pages non analysées coûte page 0 + les pages entre le point de reprise et la coupe, par tick.
  Au retour : **≈ 1× la fenêtre** (300-450 fils, un `getMessages` chacun) + un recouvrement d'une
  page par tick, étalé sur autant de ticks que le budget l'impose — jamais repaginé de zéro. Puis
  une passe `'d'` (une fois) pour les différés que les sauts auraient cachés. Du même ordre que la
  ré-évaluation qu'ADR-0043 chiffrait pour le tri (~10-20 min de runtime par épisode).
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
  (tripwire d'inventaire de `test/tri-gmail.test.js`). Le tripwire ne lit que le CODE du corps (un
  nom cité en commentaire ne vaut pas justification — vérifié par mutation) ; `estPanneConfigApi_`,
  encore lu par `traiterIntentionsMail_` pour l'état de fin de run, y est justifié dans les lignes
  qui précèdent immédiatement la fonction, comme `estPanneGmail_`.
- **Re-sonde « par le scan » à 24 h** (`PANNE_CONFIG_RESONDE_MS`) : la suspension expirée rend les
  différés inédits, le premier re-tente une création, échoue, re-suspend — **une extraction LLM et
  quelques pages Gmail par 24 h de panne**, sans conséquence (le retard n'est pas réécrit, le tick
  avorté n'a rien perdu). Accepté, à connaître.

## 6. Alternatives écartées

- **Archiver après N heures de panne par les règles déterministes** (proposé à Marc, non retenu) :
  un mail important déjà lu quittait la boîte sans ⏰. Rustine rapide, règle de Marc compromise.
- **Ne rien changer** : chaque panne d'agenda regèle l'archivage. C'est l'incident.
- **Rattraper les différés par un scan dédié à curseur** (comme `scanCycliqueTri_`) : plus de code
  et un troisième curseur Gmail pour un cas déjà couvert par le patron du drapeau de retard.

## 7. Tests

`test/intentions-fiabilite.test.js` (différé, revisite pendant/après, zone protégée au retour sur les
trois surfaces, mur pendant/après, régime sans écriture, drapeau armé sur différé et sur coupe —
scans avant ET arrière —, drainage reprenable : offset persisté, saut au point de reprise, jamais
en arrière, chemin d'exception, `'c'` ouvert sous panne, levée interdite sous panne, reprise sur
échec LLM et sur création partielle, abandon borné, table de transition PURE, lecture du drapeau,
plafond sur inédits, Properties illisibles, texte durable qui survit à la troncature de Santé), `test/tri-gmail.test.js` (`analyse|` = verdict, important ⇒ ⏰ sans API,
attente d'un tick, table de vérité du prédicat, défense en profondeur ADR-0043 conservée),
`test/sante.test.js` (la ligne Tri dit « normal + création suspendue », jamais un mode impossible),
`test/jeton-hubperso.test.js` (raison, série, seuil dérivé de la constante, message durable). Prouvés
par mutation (vingt, restaurées par copie mémoire) : retirer `analyse|` du verdict du tri, remettre
la sortie anticipée, compter les déjà-vus, mur inconditionnel, différé sans marqueur, ne pas retirer
le déclencheur, ne pas mémoriser la série, ré-annoncer « dégradé », élargir le prédicat à la panne
config, mur fermé sous `'c'` + panne, ne pas compter les reprises (×2), échec LLM non borné, levée
sous panne, `'c'` levé sans passe `'d'`, offset qui recule, pas de saut, drapeau hors `finally`,
justification retirée du bloc de doc, série non close à la re-liaison — chacune fait échouer au
moins un test.
