<!-- Extrait de l'ancien CLAUDE.md (§ 11. Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri)), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri)

## 11. Protocole de précision (toute modif de Router.gs / Llm.gs / logique de tri)

> Règle d'or (demande Marc 2026-07-07). Obligatoire pour tout changement du **classement**.

1. **Cadrage ADR d'abord** — problème/objectif, impact quotas Google & coût LLM (estimé), risques
   (garde-fous, intégrité), méthode de test. Aucune ligne de code avant l'ADR.
2. **Audit (PoC) sur du réel** — exécuter la logique de décision sur ~20 documents réels
   (`test/audit-logique.test.js`), rendre le tableau [nom | domaine | entité | verdict] AVANT de
   modifier le pipeline. Prouver le comportement sur du réel, jamais 2-3 cas choisis.
3. **Double-passe** (quand `ANALYSE_V2` est ON) — Passage 1 extrait les faits (date/émetteur/type/
   titulaire ; incertain ⇒ null) ; Passage 2 vérifie (adversarial) et applique la taxonomie ADR-0002.
4. **Fail-safe HYBRIDE ultra-strict** (ADR-0016, §2.1) — « ne jamais deviner » ne veut PAS dire « tout
   en revue » : un doc part en `00 · À vérifier` **uniquement** si `domaine` **ET** `emetteur` **ET**
   `type_doc` sont **tous** NULL (`estClassificationVide_`). Confiance basse SEULE ⇒ classé au mieux
   (jamais dumpé dans `01 · Administratif` par défaut : « granularité = enrichissement, jamais frein »).
5. **Non-régression** — ≥ 3 faux-positifs historiques en test bloquant (CV sans émetteur, note perso,
   export) qui NE doivent PAS partir en revue. CI verte exigée sur ces cas.
6. **Fonctions PURES + revue flotte** — logique isolée des I/O (testable `node --test`), surface
   verrouillée, revue adversariale avant merge. Toute opération de MASSE ⇒ `dryRun_` (validation Sheet).
