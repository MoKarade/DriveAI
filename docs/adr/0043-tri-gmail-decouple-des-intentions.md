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
   d'intentions est suspendu (`intentionsSuspendues_()`), le fil est trié au mieux, sans attendre.
   En pratique la cause est la **panne config-api** : sous une panne de plateforme LLM, `Main.gs`
   saute l'étape `tri-gmail` entière, donc le tri ne tourne pas du tout (le terme
   `estPannePlateforme_` du prédicat est de la défense en profondeur, pas un chemin vivant — et
   `Santé` distingue les deux, cf. §2.4).
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
4. **Le mode dégradé se DIT — en TROIS états, pas deux.** L'onglet Santé annonce « ✅ normal »,
   « ⚠️ mode DÉGRADÉ (analyse d'intentions suspendue) — libellés posés, AUCUN archivage », ou
   « ⛔ À L'ARRÊT (panne de compte LLM) — aucun tri ce tick ». Confondre les deux derniers ferait
   annoncer « libellés posés » pendant que le tri est entièrement sauté : une observabilité qui
   ment, sur le seul canal que Marc lit. Un état illisible dit « indéterminé », jamais « ✅ ».

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
- Coût : les fils triés en mode dégradé sont ré-évalués une fois au retour des intentions. Chiffré
  par la revue quotas sur l'incident réel (panne de 5 j, fenêtre `TRI_REQUETE` ≈ 300-450 fils) :
  **≈ 0,4 $ et 10-20 min de runtime par épisode** — une passe complète de la fenêtre. La glose
  « souvent gratuit grâce à la table apprise » était **fausse** : `apprendreTri_` n'apprend que sur
  fil LU, non-promo, non-suspect, et le chemin « promo non lue » re-demande toujours le mini-appel.
- **Dette invisible hors fenêtre.** Un fil trié en dégradé qui sort de `newer_than:30d` avant le
  retour des intentions n'est plus vu par aucun scan : il garde ses libellés, ne sera jamais archivé
  ni ⏰, et Santé sera repassée au vert. Le mode d'échec est SÛR (le fil reste en boîte, sous les
  yeux de Marc) mais il ne se rattrape pas tout seul.
- **Le scan AVANT n'a aucun plafond QUOTIDIEN** (contrairement au cyclique, au nettoyage profond et
  à l'historique). L'ADR ne l'introduit pas, mais elle allonge la période où il travaille : à
  border dans son unité (fils/jour), comme ses pairs — inscrit au backlog.
- À vérifier en prod par un signal indépendant : `DriveAI_TRI_CYCLIQUE_FILS_JOUR` doit continuer
  d'avancer pendant une suspension. ⚠️ **Ne PAS utiliser `tri_boite_fils_jour`** : le nettoyage
  profond se court-circuite définitivement sur `DriveAI_TRI_BOITE = 'terminé'` et il est gaté par le
  frein campagnes — il peut rester à 0 sans que rien n'aille mal (faux négatif).
- **Une campagne ne conclut jamais depuis du travail dégradé** : `scanArriereTri_` ne pose
  `DriveAI_TRI_RATTRAPAGE = 'terminé'` que hors suspension. Avant ADR-0043 l'attente gelait
  l'offset ; désormais il avance, la campagne pourrait donc se figer « terminé » sans avoir archivé
  un seul fil (le verdict figé de C28-33, appliqué à la campagne).
