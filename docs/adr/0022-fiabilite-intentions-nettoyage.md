# ADR-0022 — Fiabilité des intentions & nettoyage profond de la boîte

- **Statut** : Accepté (C28-22, 2026-07-15)
- **Décideurs** : Marc, Claude (architecte NotebookLM)
- **Contexte** : trois problèmes vus en prod (retour Marc « anciens mails pas archivés »,
  diagnostic par export de la Sheet) qui partagent une cause racine : des garde-fous
  incomplets de bout-en-bout. L'idempotence a protégé les données, au prix d'un
  engorgement silencieux du quota Gmail.

## Problèmes

1. **Boucle 403 Tasks/Calendar → famine de quota.** L'API Google Tasks n'était pas activée
   dans le projet GCP (403 « has not been used » depuis le 07/07). `creerTache_` attrapait
   l'erreur et renvoyait `''` ; `creerIntentionIdempotente_` voyait un `'echec'`, ne posait
   pas la clé `intention|<messageId>`, et le message était **re-analysé + re-tenté à CHAQUE
   tick à l'infini** — brûlant le quota Gmail (79 erreurs le 14/07 avant 9h), qui re-mourait
   en quelques secondes après chaque rétablissement.
2. **Arnaques transformées en tâches.** Le tick exécute `traiterIntentionsMail_` AVANT
   `trierFilsGmail_` : les gardes anti-phishing (`heuristiquePhishing_`, promo déterministe)
   ne sont consultées qu'au TRI. Des arnaques « payer 10 USD à Google Cloud Compliance »
   contournaient donc la garde pour devenir des tâches « à payer ».
3. **Trou de périmètre > 30 j.** `scanAvantTri_`/`scanCycliqueTri_` (TRI_REQUETE = `newer_than:30d
   in:inbox`) et `scanArriereTri_` (ancré sur `after:<ancre−31j>`) ne couvrent que ~1 mois.
   Tout mail LU de plus de 30 jours restait dans la boîte à vie.

## Décisions

1. **Panne de configuration d'API (permanente).** Une erreur 403 « API not enabled » /
   « accessNotConfigured » / « SERVICE_DISABLED » sur Tasks/Calendar est une panne de
   PLATEFORME de CONFIG (pas imputable au mail) : `creerTache_`/`creerEvenement_` la
   **lèvent** (au lieu de renvoyer `''`) ; `creerIntentionIdempotente_` la reconnaît
   (`signalerPanneConfigApi_`), pose `DriveAI_PANNE_CONFIG_API` (suspension 24 h persistée)
   et journalise UNE fois. `traiterIntentionsMail_` se suspend tant que la panne est fraîche
   — plus aucun scan Gmail en pure perte (patron panne de compte LLM/quota Gmail, R2/C28-15).
2. **Tolérance aux échecs TRANSITOIRES (3-strikes).** Une création en échec NON-config (500,
   429 après retry, 400…) est comptée (`api-intention|<messageId>`, compteur d'échecs partagé) et,
   après `QUARANTAINE_MAX` (3) essais, l'intention est **abandonnée** : `creerIntentionIdempotente_`
   renvoie `'deja-faite'` pour que le message soit enfin marqué traité et libère le pipeline
   (fini la re-analyse infinie qui drainait le quota — leçon « échec sans marquage =
   re-tentative infinie »). L'abandon est tracé **une seule fois** (au franchissement du seuil,
   `essais === QUARANTAINE_MAX`, comme la campagne historique). **Le compteur est clé sur le
   `messageId` SEUL**, jamais sur le contenu (titre/date/heure du LLM) : le titre peut fluctuer
   d'un run à l'autre (Sonnet 2 passes) et une clé par contenu ne s'accumulerait jamais →
   non-convergence (le compteur reviendrait à 1 à chaque tick, le mail re-tenté à vie).
3. **Pré-filtre suspect (défense en profondeur).** `heuristiquePhishing_` (déterministe,
   gratuite) et le chemin dangereux « promo déterministe non lue » sont évalués DANS
   `traiterMessagePourIntentions_`, avant le mini-check LLM. Un mail suspect/dangereux est
   marqué `intention-ecartee` et ne produit JAMAIS de tâche/RDV — ni ne coûte d'appel LLM.
   **Limite assumée** : `heuristiquePhishing_` est une heuristique de MOTS-CLÉS/motifs, pas une
   garantie — une arnaque formulée d'une façon nouvelle (hors motifs connus) peut passer ce filtre.
   C'est de la défense en profondeur, pas un rempart unique : le signal `suspect` du tri
   (`decisionSuspect_`, confiance apprise) et la garde zone protégée restent les filets en aval.
   Élargir la couverture = enrichir les motifs de `heuristiquePhishing_` (re-tester sur du réel),
   jamais durcir le mini-check au point d'écarter du courrier légitime.
4. **Nettoyage profond de la boîte (`nettoyerBoiteHistorique_`).** Campagne de fond, requête
   FIGÉE `in:inbox before:<ancre−29 j>` (ancre absolue posée une fois ; **−29 j** volontaire : un
   jour de chevauchement idempotent avec la fenêtre du tri vivant `newer_than:30d`, pour ne
   laisser AUCUN mail dans l'angle mort entre les deux scans), offset persistant,
   DEUX passes propres consécutives pour converger, plafond quotidien en FILS
   (`TRI_BOITE_MAX_FILS_JOUR` 150) + budget/run — passe par `trierFil_` (libellés existants +
   archivage réversible seulement). Priorité STRICTE au flux vivant (tourne en DERNIER du tri).

## Garde-fous (§2)

- **§2.3 moindre privilège Gmail** : aucune nouvelle mutation — le deep clean ne fait
  qu'appeler `trierFil_` (libellé existant + archivage réversible), aucune création/retrait
  de libellé, aucune suppression/corbeille. Surface d'écriture Gmail inchangée (verrou CI).
- **Quotas** : bornes quotidiennes en fils (deep clean) + suspension config persistée
  garantissent la survie du flux vivant ; les campagnes ne vampirisent jamais le quota.
- **Aucune suppression automatique** : préservé (§2.2).
- **Métadonnées seulement** (ADR-0007) : les nouveaux états sont des compteurs/timestamps.

## Méthode de test

Fonctions PURES testables (détection texte panne config, décision pré-filtre) ; tests moteur
sur : suspension config → intentions suspendues ; 3-strikes → `'deja-faite'` libère le message ;
tripwire « mail suspect/promo non lue → 0 intention SANS appel LLM » ; deep clean borné/reprenable
(offset, plafond quotidien, deux passes propres). Surface interne verrouillée.
