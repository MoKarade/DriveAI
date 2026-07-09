# ADR-0018 — Activation de l'analyse v2 + campagne de RE-ANALYSE CIBLÉE (C26-08)

- **Statut** : Accepté (décision Marc 2026-07-09 : « go 2 » après lecture du rapport dry-run C26-07).
- **Décideurs** : Marc (choix de l'option ciblée + rehausse du plafond), NotebookLM (plan technique),
  Claude (exécution).
- **S'appuie sur** : ADR-0015 (pipeline v2 + preuve dry-run), ADR-0002 (taxonomie), protocole §8.
- **Révise** : la valeur du frein `LLM_BUDGET_CAMPAGNES` (30 → **65 $**, temporaire) — §2.6 de la
  constitution (le principe du frein est INCHANGÉ : jamais désactivé, le flux vivant jamais gaté).

## Problème & Objectif

La preuve dry-run C26-07 (100 documents réels stratifiés, onglet `DryRunV2`) a validé le pipeline v2 :
0 fail-safe déclenché, confiance médiane 0,93, coût mesuré 0,0261 $/doc, corrections visiblement
justes (billets SNCF « Logement » → Voyages, titulaire sur les papiers d'identité, non-documents
écartés). Mais re-analyser TOUT le corpus (3 733 docs classés) coûterait ≈ 97 $ — hors de question.

**Décision de Marc (option 2)** : re-analyser en v2 les SEULS domaines où l'échantillon a montré un
fort taux de mal-classés — `03 · Logement & véhicule` (9 propositions de reclassement sur 12) et
`08 · Perso & projets` (4 sur 11) — soit **924 documents ≈ 24 $** au coût mesuré. Et **allumer
`ANALYSE_V2` sur le flux vivant** (le dry-run était la validation attendue) : ~10-20 docs/jour en
Sonnet 2 passes, < 0,5 $/jour.

## Décisions

1. **`CONFIG.ANALYSE_V2: true`** — le flux vivant passe au pipeline v2 (Sonnet 2 passes,
   `classifierDeuxPasses_` + `deciderRoutageV2_`). `budgetMsRun_()` abaisse déjà le garde-temps.
2. **`CONFIG.DRYRUN_V2_ACTIF: false`** — le dry-run est clos (100/100, rapport livré).
3. **Campagne `reanalyse|c26-08|<fileId>`** (Migration.gs) : même mécanique éprouvée que m1 —
   clé dédiée ADDITIVE qui porte idempotence ET convergence, page bornée par tick
   (`MIGRATION_MAX_PAR_RUN` docs, sous-budget `REANALYSE_BUDGET_MS`), « terminé » quand une passe
   complète ne collecte plus rien, `ignorerDoublon` (jamais « doublon de lui-même »), zone protégée
   revérifiée STRICT avant mutation et refus INSCRIT sous la clé de campagne, échec durable →
   quarantaine (`gererEchec_`), panne de PLATEFORME → rien d'inscrit, re-soumis plus tard.
4. **Une seule campagne de masse à la fois** : `appliquerReanalyseCiblee_` ne démarre qu'après la
   FIN de m1 (`DriveAI_MIGRATION === MIGRATION_TAG`) ; et dès ce merge, `migrerUnePage_` EXCLUT
   `REANALYSE_CIBLES` de sa collecte — un document de 03/08 n'est jamais payé deux fois (v1 puis v2).
5. **`LLM_BUDGET_CAMPAGNES: 65 $`** (temporaire) : absorbe le mois entamé (27,25 $ dont la tempête
   de fallbacks du 1–6 juillet) + la campagne (~24 $) + la fin de m1 + marge. **Marc redescend
   manuellement le plafond à 10 $** (édition de `Config.gs`, ligne `LLM_BUDGET_CAMPAGNES`) à la fin
   de C26-08 — le régime de croisière reste < 10 $/mois.

## Impact quotas Google / coûts LLM

- **LLM** : ~24 $ one-shot (924 docs × 0,0261 $ mesuré), étalés à ~12 docs/tick sous sous-budget
  2 min/tick ; + flux vivant en v2 (< 0,5 $/j estimé au volume courant). Le frein (65 $) borne le
  total mensuel des campagnes ; le compteur `usage` mesure le réel.
- **Quotas** : mêmes bornes que m1 (page de 12 docs lourds, sous-budget ms/tick, garde-temps global
  abaissé sous v2) — le quota journalier des triggers (~90 min/j) reste protégé, l'intake garde la
  priorité (campagne APRÈS l'intake dans le tick).

## Risques & garde-fous

- **Zone protégée** : 03/08 ne sont pas protégés, mais un fichier multi-parents accroché à
  `04 · Immigration` peut y apparaître → `aParentProtege_` STRICT revérifié avant mutation, refus
  inscrit (convergence sans mutation). Vérifié par test.
- **Boucle de re-collecte** : le prédicat de convergence est la clé `reanalyse|` seule (les noms
  sont déjà au format final — le prédicat « déjà rangé » du grand rangement ne s'applique pas ici).
  Tout chemin de sortie de `reanalyserFichier_` inscrit soit la clé (pipeline), soit une ligne
  `zone protégée`, soit passe par la quarantaine — aucun chemin muet.
- **Panne de compte API** : jamais imputée au document (design R2) — la campagne attend et reprend.
- **Aucune suppression** (§2) : déplacement/renommage seuls ; les non-documents v2 partent vers
  `_Médias`/`_Technique` (déplacement).

## Méthode de test

- `test/migration.test.js` : exclusion des cibles dans `migrerUnePage_` (dérivée de
  `CONFIG.REANALYSE_CIBLES`, jamais des libellés du jour) ; `estAReanalyser_` (natifs exclus,
  convergence par clé, indépendance des campagnes) ; garde d'orchestration « m1 d'abord » ;
  tripwire : les cibles existent dans `CONFIG.DOMAINES` et n'intersectent pas `DOMAINES_PROTEGES`.
- `test/surface-moteur.test.js` : les 5 fonctions de la campagne au contrat interne.
- `test/llm-v2.test.js` : le tripwire « ANALYSE_V2 éteint par défaut » est révisé (feu vert Marc
  2026-07-09, cet ADR) en « allumé, et le dit en commentaire ».

## Fin de campagne (checklist Marc)

1. Le Journal affiche « Re-analyse v2 ciblée terminée (tag « c26-08 ») ».
2. Marc redescend `LLM_BUDGET_CAMPAGNES` à `10` dans `src/Config.gs` (PR dédiée).
3. Le résumé hebdo confirme le retour au régime de croisière (< 10 $/mois).
