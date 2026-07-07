# ADR-0016 — Fail-safe : ré-introduction ULTRA-STRICTE de `00 · À vérifier` (révision §2.1)

- **Statut** : Accepté (décision Marc 2026-07-07 via AskUserQuestion : « Hybride ultra-strict »).
- **Décideurs** : Marc (« Protocole de précision », phase Fail-Safe), Claude.
- **Révise** : CLAUDE.md **§2.1** (« PLUS DE FILE DE REVUE », décision Marc 2026-07-01). Deuxième
  révision d'un garde-fou non négociable après ADR-0014 — livrée **atomiquement** (ADR + constitution
  + code + tests, même PR).
- **Cadre le protocole** : instance de la « Politique du Fail-Safe » du protocole de précision de Marc.

## Problème & Objectif

Le protocole de précision de Marc exige un fail-safe : « en cas d'ambiguïté de l'IA, interdiction de
deviner ». Sa phase 2 voulait envoyer vers `00 · À vérifier` dès qu'un fait critique est NULL — ce qui
**contredirait** §2.1 (plus de revue) ET une **leçon vécue** : « low-confidence → revue **sature** la
file et **neutralise l'auto-rangement** » (au premier run de masse, tout partait en revue).

**Décision de réconciliation (Marc, hybride ultra-strict)** : on ré-introduit `00 · À vérifier`, mais
**UNIQUEMENT** quand l'analyse n'a produit **AUCUN** fait exploitable — `domaine` **ET** `emetteur`
**ET** `type_doc` **tous** absents/inconnus. Sinon, comportement inchangé (classé au mieux ; domaine
inconnu → `DOMAINE_DEFAUT`). But : offrir un filet humain pour les cas VRAIMENT vides, sans rouvrir la
vanne qui neutralise l'auto-rangement.

## Impact quotas Google / coûts LLM

**Nul.** Aucun appel LLM ni scope supplémentaire : c'est une règle de ROUTAGE pure (déterministe) en
aval de la classification existante. Un doc « tout-NULL » est **déplacé** vers `00 · À vérifier` (comme
n'importe quelle cible), inscrit à l'Index (`à vérifier`) → jamais re-traité (idempotence, pas de
re-OCR/re-LLM). Fréquence attendue : **rare** — les prompts (Haiku ET v2) IMPOSENT un domaine de la
liste, et `enrichirClassifDepuisNom_` remplit souvent `type_doc` depuis le nom ; « tout-NULL » ne
survient que sur une réponse LLM quasi vide/malformée mais parsable.

## Analyse de risques (garde-fous, intégrité)

- **§2.1 (revue)** : révisé ici, ÉTROITEMENT. La règle reste « auto-classer au mieux » ; la revue est
  l'exception rare, pas la posture. Anti-saturation garanti par la conjonction **ET** (les trois faits
  doivent être absents) — un seul fait présent suffit à classer.
- **§2.2 (aucune suppression)** : intact — déplacement seul vers `00 · À vérifier`, jamais de corbeille.
- **§2.1 (zone 04)** : intact — un doc immigration a un domaine/type → jamais « tout-NULL » → jamais
  dévié en revue ; et la revue ne détache rien d'un parent 04 (intake frais).
- **Idempotence** : `à vérifier` inscrit en dernier (après le dépôt), comme tout statut. Validation par
  Marc dans l'app = déplacement MANUEL (Index `manuel`, C21-02), pas de re-traitement.
- **Robustesse dossier** : `dossierAVerifier_()` réutilise `CONFIG.DOSSIERS.A_VERIFIER` s'il vit encore,
  sinon find-or-create `00 · À vérifier` à la racine (Marc a pu supprimer l'ancien dossier vide).

## Méthode de test (protocole de précision de Marc)

1. **Phase Audit (PoC)** — `test/audit-logique.test.js` : exécute la logique de décision (fonction
   pure `estClassificationVide_`) sur un échantillon de **20 documents réels** (dérivés des 38 docs de
   la preuve #26), rend le tableau [nom | domaine | entité | verdict fail-safe] et **prouve que la
   règle ne se déclenche QUE sur du tout-NULL** (0 déclenchement sur les docs réels normaux).
2. **Phase Non-régression** — ≥ 3 « faux positifs » historiques (CV sans émetteur, note perso avec
   domaine, export) qui NE doivent PAS partir en revue → assertions bloquantes.
3. **Unitaire** — `estClassificationVide_` : tout-NULL → true ; un seul fait présent → false.
4. **Surface** — `estClassificationVide_`/`routageAVerifier_`/`dossierAVerifier_` ajoutées au contrat.

## Conséquences

- Un document réellement inclassable (analyse vide) obtient un filet humain au lieu d'atterrir au
  hasard dans `01 · Administratif` — sans rouvrir la file de revue pour les cas simplement incertains.
- La règle est **PURE et déterministe** → testable, traçable, réversible.
- CLAUDE.md §2.1 et le protocole de précision (CLAUDE.md §8) documentent la version RÉCONCILIÉE
  (hybride), pas le `00 · À vérifier` systématique qui se contredisait.

## Réversibilité

Retirer l'appel à `estClassificationVide_` dans `deciderRoutage_`/`planRoutageV2_` (et re-serrer §2.1)
restaure « plus de file de revue ». La fonction reste pure et sans effet tant qu'elle n'est pas câblée.
