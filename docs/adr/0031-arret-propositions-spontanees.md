# ADR-0031 — Arrêt de toute proposition SPONTANÉE du moteur (entités, réorg auto) + retrait des demandes ponctuelles orphelines

- **Statut** : accepté (décisions Marc 2026-07-31, réponses cliquées C28-41 — « je veux plus que
  ça me propose des dossiers quand je demande pas, supprime tout le code en rapport » ;
  option choisie : « Plus RIEN tout seul »)
- **Date** : 2026-07-31
- **Révise** : ADR-0029 (réorg auto — ABROGÉE), ADR-0002 §4 et ADR-0008 (file de validation
  d'entités — la FILE disparaît, le référentiel VALIDÉ demeure), C28-06/C28-16/C28-24
  (actions à la demande de l'app — supprimées avec leur UI, C28-41 PR1)

## 1. Problème / objectif

Marc ne veut PLUS qUE le moteur lui propose quoi que ce soit de sa propre initiative :
la file « Entités à valider (98) » (photo à l'appui) et la campagne quotidienne de
réorganisation déposaient des décisions à prendre qu'il n'avait pas demandées. L'app v6
(C28-41 PR1) a déjà supprimé toute la surface UI. Ce chantier retire le code MOTEUR qui
produisait ces propositions, plus les actions de la web app devenues orphelines (leurs
boutons n'existent plus).

Ce qui reste possible : l'Assistant (chat) propose SUR DEMANDE de Marc (`proposer_reorg`,
validation par action — inchangé), et les demandes de réorg déposées par l'app via l'onglet
`Réorg` suivent le pipeline existant.

## 2. Décision

1. **Plus AUCUNE ligne d'entité « en_attente »** : `entiteEnAttenteAjouter_` (Entites.gs)
   devient une pure OBSERVATION — si un dossier du domaine porte DÉJÀ le nom canonique de
   l'entité (créé par Marc à la main, par une validation passée ou par la réorg), la ligne
   naît directement `validée` et pointe vers lui (« reality check » P4/C28-10, conservé :
   c'est de l'apprentissage de ce que Marc a FAIT, pas une question qu'on lui pose). Sinon :
   RIEN n'est écrit — le document est classé au domaine (« granularité = enrichissement,
   jamais frein », inchangé). Suggestions de variante et incrément « Vu N fois » à la
   proposition : retirés. Helpers : `chercherVariante_` et `incrementerVuEntite_` RESTENT
   (la correction 1-clic et la curation les appellent — vérifié par grep) ;
   `chercherLigneFusionnable_`, devenu orphelin, est RETIRÉ (relevé en revue flotte).
2. **Campagne de réorg AUTOMATIQUE abrogée** (ADR-0029) : `genererDemandeReorgAuto_`, son
   branchement dans le tick, la skip-list 30 j et les constantes `REORG_AUTO_*` sont
   RETIRÉS — ainsi que `compterSousDossiersRegroupables_`, qui n'avait AUCUN appelant
   (le décompte des regroupables servi aux prompts est fait INLINE dans
   `inventaireDossiers_` — relevé en revue flotte, grep à l'appui). `REORG_MAX_JOUR`
   (plafond des analyses, demandes app/chat) demeure.
3. **Actions web app orphelines retirées** (l'UI a disparu en C28-41 PR1) :
   `analyse-ciblee`, `demande-tri`, `demande-intentions` — dispatch, fonctions d'action,
   validateurs purs, et leur CONSOMMATION côté tick (`scanDemandeTri_`,
   `balayerAnalyseCiblee_`, fenêtre forcée des intentions). Les scans AUTOMATIQUES
   (balayage cyclique du tri, nettoyage profond, historique, intentions fenêtre 30 j)
   sont INCHANGÉS. Restent : `pas-suspect`, `recherche-ia`, `chat-assistant`,
   `hub-summary`, `sync-miroir`, tick ponctuel par défaut.
4. **Télémétrie/Progression** : `majTelemetrie_`/`majProgressions_` demeurent (la page
   Moteur les lit) ; seules les lignes des features retirées disparaissent
   (`tri_demande_fils_jour`, blocs « demandes de Marc » de la progression) — côté app,
   la jauge correspondante est retirée en même temps (même PR, atomique).

## 3. Impact quotas & coût

- **Coût LLM : baisse.** La réorg auto coûtait ≈ 0,06 $/j de Sonnet (3 dépôts/j) — retirée.
  Aucun appel LLM ajouté nulle part.
- **Quota Gmail : neutre à mieux.** Les scans à la demande n'existaient que sur clic (plus
  de bouton depuis PR1) ; leur retrait ne change rien au quota réel. Le plafond quotidien
  `TRI_DEMANDE_MAX_FILS_JOUR` disparaît avec son scan (les 3 autres buckets restent).
- **Runtime : baisse marginale** (un scan Drive de saturation/jour en moins, quelques
  lectures Properties par tick en moins).

## 4. Risques & garde-fous

- **Aucun changement de ROUTAGE** : les entités VALIDÉES continuent de router (ADR-0028,
  `Dossier ID`) ; une entité inconnue classait déjà AU DOMAINE (la proposition n'était
  qu'un à-côté). `ENTITES_AUTO_VALIDATION` était déjà `false` (ADR-0024). Le fail-safe
  ADR-0016 (`estClassificationVide_`) est INTOUCHÉ.
- **Régression assumée (dit à Marc)** : sans file de propositions, une NOUVELLE entité
  n'obtient un dossier granulaire que si Marc crée le dossier lui-même (reality check) ou
  le demande à l'Assistant. C'est exactement ce qu'il a choisi.
- **Curation des lignes héritées** : les ~98 lignes `en_attente` existantes restent des
  DONNÉES inertes de la Sheet (aucune suppression, §2) ; la curation continue de les
  assainir, plus rien ne les affiche ni ne les alimente.
- **Tripwire** : test « le pipeline n'écrit plus JAMAIS de ligne en_attente »
  (entité inconnue sans dossier existant ⇒ zéro écriture Sheet) + le reality check
  verrouillé (dossier existant ⇒ ligne `validée` avec son ID).
- **Retrait de fonctions** : frontières vérifiées fonction par fonction (jamais de regex
  multi-lignes — leçon §7), `surface-moteur.test.js` mis à jour, revue flotte adversariale
  AVANT merge.

## 5. Méthode de test

`node --test` complet (9 fichiers de tests mis à jour : webapp, tri-gmail, intentions,
reorg, qualite-entites, anti-variantes, orchestration, surface, intentions-ciblee retiré) +
tripwire ci-dessus + revue flotte (code-reviewer, security-auditor, apps-script-quota).
