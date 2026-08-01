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

## 5. Suite

Dry-run de comparaison 1↔2 passes (à brancher dans `DryRunV2.gs` : compter les sauts + les
divergences passe1/passe2 sur le corpus), rendu à Marc en avant/après VISIBLE. Activation après son
feu vert.
