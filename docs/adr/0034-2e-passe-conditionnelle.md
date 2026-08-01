# ADR-0034 — 2ᵉ passe conditionnelle (économie ~½ du coût v2), sous flag, à valider sur du réel

- **Date** : 2026-08-01
- **Statut** : **proposé** — code livré sous flag **ÉTEINT** ; activation SUBORDONNÉE à une validation
  sur du réel par Marc (décision Marc « Optimiser », Vague 3c).
- **Chantier** : #44 — Vague 3c

## 1. Problème

Sous `ANALYSE_V2` (ADR-0018), chaque document coûte **2 appels Sonnet** : passe 1 (extraction) +
passe 2 (vérification **adversariale**). Pour la majorité « facile » (facture claire d'un émetteur
connu), la passe 2 confirme la passe 1 sans la changer — un coût sans gain. Sauter la passe 2 sur ces
cas ≈ **−50 % du coût v2** par document sauté.

## 2. Décision (subordonnée à validation)

Ajouter un gate PUR `passe1SuffisammentSure_(p1)` (Llm.gs) et un flag
`CONFIG.ANALYSE_V2_2E_PASSE_CONDITIONNELLE` (**false** par défaut). Quand le flag est ON et le gate
vrai, `classifierDeuxPasses_` **retourne la passe 1 sans appeler la passe 2**.

Le gate est **CONSERVATEUR** — il refuse de sauter dès qu'il y a un enjeu de correctness ou un
garde-fou §2 :

| Condition sur la passe 1 | Décision |
|---|---|
| `sensible === true` (immigration/fiscal) | **2 passes** — garde §2, jamais un risque sur la zone protégée |
| non-document / pièce d'identité | 2 passes (cas à arbitrage) |
| `confiance` absente ou `< ANALYSE_V2_SEUIL_1PASSE` (0,9) | 2 passes |
| fait clé manquant (pas de domaine, pas de type, OU aucun émetteur/titulaire/descripteur ; sentinelles « Inconnu » comptées absentes) | 2 passes |
| sinon (sûre + complète + non sensible) | 1 passe (passe 2 sautée) |

## 3. Pourquoi le flag reste ÉTEINT jusqu'à validation (§8)

Sauter la passe 2 **change le classement** (la passe 2 conteste et corrige parfois la passe 1). C'est
exactement le cas que §8 réserve : **prouver sur du réel AVANT d'activer**. La preuve = un dry-run
comparant, sur un échantillon RÉEL large et stratifié, le classement **1 passe** (gate) vs **2 passes**
(actuel) — et mesurer combien de docs le gate sauterait ET combien de ces sauts auraient été
**corrigés** par la passe 2 (= erreurs introduites). Tant que ce taux d'erreur n'est pas prouvé
négligeable et présenté à Marc, le flag reste OFF. L'activation est une décision de Marc (comme
l'allumage d'`ANALYSE_V2` lui-même, ADR-0018), jamais un commit silencieux.

## 4. Garde-fous & test

- **§2** : un doc sensible n'est JAMAIS traité en 1 passe (première clause du gate), même flag ON.
- Fonctions **PURES** testées (`test/passe-conditionnelle.test.js`) : gate conservateur (sensible /
  identité / non-doc / confiance basse / faits manquants ⇒ 2 passes ; sûr+complet ⇒ 1 passe) ET
  respect du flag (OFF ⇒ toujours 2 passes ; ON ⇒ saut seulement si gate vrai ; sensible ⇒ 2 passes).
- Le flag prod reste **OFF** ; le test force le flag DANS son contexte (save/restore), jamais un
  invariant (leçon §7 : la position d'un flag de campagne est une décision de Marc).

## 5. Suite — CONDITIONS D'ALLUMAGE (revue code-reviewer, à remplir avant de passer le flag à ON)

1. **Dry-run de comparaison 1↔2 passes — LIVRÉ** (`DryRunV2.gs`, interrupteur DÉDIÉ
   `CONFIG.DRYRUN_CMP_ACTIF`, OFF par défaut). Quand Marc l'allume, il exécute TOUJOURS les deux
   passes sur l'échantillon STRATIFIÉ réel du dry-run (même corpus, `DRYRUN_V2_TAG`) et écrit dans
   l'onglet `DryRunV2Compare`, pour CHAQUE document : la décision du gate (« sauterait la passe 2 ? »),
   le PLACEMENT 1 passe vs 2 passes (`domaine ▸ sous-dossier ▸ nom`), le champ « placement identique »,
   les champs corrigés par la passe 2, et le **verdict du saut** (`saut sûr` / `SAUT RISQUÉ — placement
   changé` / `SAUT RISQUÉ — sensible raté` / `2 passes (pas de saut)`). ZÉRO mutation Drive (même
   garantie que le dry-run : `planRoutageV2_` seul). Coût réel (Sonnet ×2/doc) sous le frein
   `LLM_BUDGET_CAMPAGNES`. Logique PURE testée (`test/comparaison-passes.test.js`).
   ➜ **Ce que Marc lit** : le taux de docs que le gate SAUTERAIT (`Gate = oui`) et, parmi eux, le taux
   de `SAUT RISQUÉ` (placement changé) — c'est le taux d'erreur introduit par le saut, à prouver
   négligeable AVANT d'allumer le flag.
2. **FAUX NÉGATIFS `sensible` — MESURÉS par le harness** (colonnes « Sensible 1p »/« Sensible 2p »/
   « Faux négatif sensible » + priorité au verdict `SAUT RISQUÉ — sensible raté`). Comme `sensible`
   n'affecte pas le routage (§2), ce faux négatif est INVISIBLE sur la seule divergence de placement :
   le harness le compte SÉPARÉMENT (`fauxNegatifSensibleV2_`, passe 1 `false` → passe 2 `true`). Ce
   taux doit être prouvé négligeable (ou nul) avant allumage — pas seulement la divergence globale.
3. **Renforcer le gate avec le filet DÉTERMINISTE `toucheZoneProtegee_`** (`Prefiltre.gs`) AVANT
   allumage : un document dont le NOM/EXTRAIT matche immigration/fiscal ne doit JAMAIS sauter la passe
   2, même si le LLM a mis `sensible:false`. Cela suppose de passer `meta`/extrait au gate (PUR
   aujourd'hui, ne voit que `p1`) — un léger changement de signature à livrer AVEC l'allumage, pas
   avant. Le §2 ne repose alors plus sur le seul `sensible` du LLM.

### Détails du harness (revue flotte, intégrés)

- **Coût MESURÉ, pas nominal** (revue llm-cost-optimizer 🟠) : un snapshot d'usage ENTRE la passe 1 et
  la passe 2 (`classifierComparaisonV2_`) donne deux colonnes « Coût passe 1 $ » / « Coût passe 2 $ ».
  Le « ~½ » du §1 n'est jamais affirmé : le harness **mesure** le gain réel = Σ(coût passe 2 des docs
  sautés) / Σ(coût des deux passes), écrit dans la **synthèse** de fin (`synthetiserComparaisonV2_`).
- **Agrégat de fin** (revue llm-cost-optimizer 🟡, leçon §7) : au convergence, une ligne de synthèse au
  Journal donne les taux avec les BONS dénominateurs — **taux de saut = sautés / classés**, **taux
  RISQUÉ = risqués / SAUTÉS** (jamais / total), # faux négatifs sensible parmi les sautés, gain mesuré.
  Marc lit la conclusion directement, sans recompter l'onglet à l'œil.
- **Entités VALIDÉES passées aux deux plans** (revue code-reviewer 🟠) : `planPourClassifV2_` reçoit
  `entitesValideesParCle_()` (comme `deciderRoutageV2_`), sinon une correction d'entité de la passe 2
  serait invisible (tout à année/racine) et le taux de `SAUT RISQUÉ` sous-estimerait le risque.
- **Panne de plateforme jamais imputée au document** (revue security/apps-script-quota, leçon §7) : si
  une panne de compte survient (même en cours de tick), les docs touchés ne sont ni écrits ni marqués —
  re-comparés au rétablissement, jamais figés « échec » dans le rapport.
- **Passe 2 muette ≠ « saut sûr »** (revue security/code-reviewer) : verdict `passe 2 muette — non
  concluant`, exclu des « saut sûr » et de l'agrégat des sautés.

### Activation — décision de Marc (comme l'allumage d'`ANALYSE_V2`, ADR-0018)

1. **Vérifier la marge du frein AVANT de lancer** : le flux vivant tourne aussi en Sonnet ×2 et
   consomme la même enveloppe `LLM_BUDGET_CAMPAGNES` (10 $/mois). Lancer tôt dans le mois, ou relever
   ponctuellement le frein le temps de la campagne (il se redescend après) — sinon l'onglet reste
   PARTIEL (échantillon coupé à mi-parcours), non représentatif pour trancher.
2. Lancer le harness (`DRYRUN_CMP_ACTIF = true` + tag), lire la synthèse et l'onglet `DryRunV2Compare`.
3. N'allumer le flag que si les taux de `SAUT RISQUÉ` (placement ET sensible, parmi les SAUTÉS) sont
   négligeables ET le gain mesuré justifie le risque résiduel.
4. **La métrique faux négatif `sensible` du harness est INFORMATIVE, pas suffisante** (revue
   llm-cost-optimizer) : les docs sensibles sont rares dans 100 docs, « 0 faux négatif » sur une
   poignée est une borne haute faible. C'est le filet DÉTERMINISTE `toucheZoneProtegee_` (§5-3) qui
   GARANTIT le §2 avant allumage — jamais le seul taux mesuré.
