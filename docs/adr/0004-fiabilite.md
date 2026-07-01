# ADR-0004 — Fiabilité totale (zéro babysitting)

- **Statut** : Accepté — **à implémenter** (roadmap #1)
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe 3

## Contexte

Incidents vécus le 2026-07-01 : **déclencheur désactivé par Google** (Marc a dû relancer
`installerTrigger`), **faux « terminé »** figeant le rangement, **famine de budget**. Objectif : Marc
n'intervient **plus jamais** — ou au pire **un clic, prévenu à temps**.

**Contrainte dure :** Google **désactive** un déclencheur temporel après trop d'échecs, et le code **ne
peut pas** le réactiver sans une exécution. Donc fiabilité = *éviter les échecs* **+** *détecter l'arrêt*.

## Décision

1. **Chien de garde (watchdog).** Un **2ᵉ déclencheur léger, distinct et quasi-infaillible** vérifie un
   **heartbeat** (`DriveAI_LAST_TICK`, horodatage écrit à chaque tick réussi). Si le tick principal n'a
   rien produit depuis un seuil (ex. 30–60 min) :
   - il **tente de ré-installer** le déclencheur principal (auto-réparation) ;
   - si ça échoue, il **envoie un mail d'alerte** avec le geste à faire.

2. **Auto-réparation d'abord, alerte ensuite** — le watchdog agit en silence ; il ne dérange Marc que
   s'il ne peut pas réparer.

3. **Alertes minimales :** (a) « quota quotidien atteint, je reprends demain » (info légère) ;
   (b) « bloqué, clique ici » (échec d'auto-réparation). **Rien d'autre.**

4. **Santé dans le résumé hebdo** — une section « état du système » (dernier passage, docs traités du
   jour, quota, incidents). Pas de tableau de bord séparé.

5. **Robustesse (déjà en place, à maintenir) :** toute étape secondaire enveloppée try/catch ; un
   compteur « 0 » issu d'une **exception** ne vaut **jamais** « terminé » (cf. P1-17) ; drainer avant
   d'alimenter sans affamer (P1-19) ; garde-temps sur tout lot.

## Conséquences

- Nouveau déclencheur watchdog — **attention au quota de déclencheurs (~20)** : en installer **un seul**,
  idempotent (create-only-if-absent).
- Le watchdog doit être **trivialement robuste** (aucune exception possible → jamais désactivé lui-même) :
  il ne fait presque rien (lire un timestamp, comparer, éventuellement ré-installer + mailer).
- Heartbeat = 1 Script Property écrite par tick.
- Observabilité : **borner/roter le Journal** (illisible aujourd'hui car énorme) ; la section santé du
  hebdo devient la vue principale.

## Risque résiduel assumé

- Si Google désactive **tous** les déclencheurs du projet (rare), le watchdog meurt aussi. Mitigation :
  le watchdog ne fait presque rien (n'est pas une cause de désactivation), et le déclencheur du résumé
  hebdo (séparé) sert de second filet. Le pire cas reste **un clic** sur `installerTrigger` (runbook).
