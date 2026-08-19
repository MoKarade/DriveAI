# ADR-0043 — Le tri Gmail ne meurt plus quand les intentions sont suspendues

- **Statut** : accepté (2026-08-19)
- **Contexte** : incident 14-19/08 (5 jours), révélé par ADR-0041
- **Révise** : le couplage introduit en Phase 3 (le tri attend l'analyse d'intentions)

## 1. Problème

`trierFil_` (src/TriGmail.gs) refuse de trier un fil tant que la clé `intention|<dernierMessage>`
n'est pas dans l'Index :

```js
if (!indexContient_('intention|' + dernierId) &&
    !estHorsFenetreIntentions_(Number(ts), Date.now())) return 'attend';
```

La raison est bonne : c'est l'analyse d'intentions qui pose le flag `important|`, dont dépendent le
libellé ⏰ et surtout la décision d'**archiver**. Trier avant elle risquerait d'archiver un mail
que Marc devait traiter.

Mais la garde suppose que la clé **finit par arriver**. Or `traiterIntentionsMail_` s'arrête net
(`return`) dès qu'une panne de plateforme suspend les créations — API Tasks/Calendar non activée
(C28-22/ADR-0041), panne de compte LLM. Pendant ces suspensions, la clé **n'arrive jamais** pour
les fils DANS la fenêtre : tous rendent `'attend'`, et la boîte de Marc n'est plus triée du tout.

**Vécu (14-19/08)** : l'API Tasks n'était pas activée dans le projet GCP caché d'Apps Script → les
intentions suspendues → **le tri Gmail mort par ricochet pendant 5 jours**, alors que rien ne
l'empêchait de fonctionner. Aucune alerte : Santé montrait la panne d'API, pas sa conséquence sur
le tri. L'échappatoire existante (`estHorsFenetreIntentions_`, C28-24) ne couvre que les fils
**hors** fenêtre — exactement ceux qui ne posent pas problème.

Une dépendance tierce (activation d'une API Google) ne doit pas pouvoir tuer une fonction qui n'en
a aucun besoin. C'est le même défaut de forme que la leçon « un garde-fou qui met des items HORS
CIRCUIT exige un chemin de RETOUR » : ici l'attente est légitime, mais elle n'a pas de sortie quand
l'amont est éteint.

## 2. Décision

Le tri **continue** pendant une suspension des intentions, en **mode dégradé** :

1. **Ne plus attendre l'impossible.** Si la clé `intention|` est absente ET que le scan
   d'intentions est suspendu (`intentionsSuspendues_()` : panne config-api OU panne de plateforme
   LLM), le fil est trié au mieux, sans attendre.
2. **Dégrader, jamais deviner : aucun archivage en mode dégradé.** `important` est *inconnu*, pas
   *faux* — le traiter comme faux archiverait des fils que Marc devait traiter. La décision pure
   `decisionTri_` reçoit `analyseIndisponible: true` et force `archiver: false`. Les libellés (la
   catégorie, ⚠️ Suspect, À vérifier) sont posés : c'est le travail visible et il est **réversible**.
   Le fil reste en boîte — au pire Marc voit un mail rangé mais non archivé.
3. **Un verdict dégradé est RÉVISABLE.** La clé d'idempotence porte le mode :
   `tri|<fil>|<ts>|<lu>|deg`. Au retour des intentions, la clé NOMINALE (sans suffixe) est absente
   ⇒ le fil est ré-évalué avec son `important|`, et archivé si la règle de Marc le dit. Sans ce
   suffixe, le tri dégradé figerait à vie « non archivé » (leçon C28-33 : une clé posée sur un
   verdict révisable doit encoder ce qui le rend révisable).
4. **Le mode dégradé se DIT.** L'onglet Santé annonce « tri en mode dégradé (analyse d'intentions
   suspendue) — libellés posés, aucun archivage ». Sinon « le tri marche » masque « il n'archive
   plus », et personne ne voit la dette.

Ce que la décision NE fait PAS : elle ne touche ni aux règles de tri de Marc (`decisionTri_`
inchangée hors du nouveau champ), ni au flux d'intentions, ni aux scopes, ni au sens de
`estHorsFenetreIntentions_` (qui reste la sortie des fils anciens).

## 3. Alternatives écartées

- **Attendre avec un délai maximal** (« si le fil a plus de N heures et pas de clé, trier »).
  Rejeté : le délai est un minuteur, pas une observation de l'état réel — même défaut que la sonde
  minutée d'ADR-0041 §5. Un fil récent pendant une panne de 5 jours attendrait quand même N heures
  pour rien, et un fil ancien serait trié alors que l'analyse allait arriver.
- **Trier ET archiver normalement pendant la panne.** Rejeté : `important` inconnu traité comme
  faux ⇒ des mails à traiter quittent la boîte sans que Marc l'ait décidé. La boîte de Marc SERT de
  todo (cf. `decisionTri_` : un fil ⏰ n'est jamais archivé par le moteur).
- **Découpler complètement** (le tri n'attend plus jamais l'analyse). Rejeté : en régime normal
  l'attente est ce qui garantit le ⏰ ; la supprimer dégraderait le cas nominal pour réparer le cas
  de panne.

## 4. Conséquences

- Une panne d'API Google (ou de crédit LLM) ne peut plus arrêter le tri de la boîte : au pire elle
  suspend l'**archivage**, visible dans Santé, et rattrapé automatiquement au retour.
- Coût : les fils triés en mode dégradé sont ré-évalués une fois au retour des intentions (2ᵉ
  catégorisation possible). Borné au stock de la panne, et souvent gratuit (la table apprise répond
  sans appel LLM).
- À vérifier en prod par un signal indépendant : provoquer/observer une suspension et constater que
  `tri_boite_fils_jour` continue d'avancer.
