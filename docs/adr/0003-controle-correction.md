# ADR-0003 — Contrôle & correction (et apprentissage)

- **Statut** : Accepté — **à implémenter** (roadmap #4 et #5)
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe 2

## Contexte

DriveAI classe en **best-guess** (plus de file de revue depuis P1-16). Marc veut pouvoir **corriger
facilement** et surtout que l'outil **apprenne** de ses corrections — sans app web (Phase 4 pas encore là).

## Décision

1. **Canal de correction = mail hebdo → mini-formulaire Google (1 clic/doc).**
   Le résumé hebdomadaire liste les cas à traiter avec un lien ; le formulaire laisse Marc choisir le
   bon domaine/entité ; Apps Script lit les réponses et **applique** (déplace/renomme le fichier, met
   à jour l'entité). Robuste sur la stack gratuite (Google Forms + lecture des réponses = natif).

2. **Contenu du mail « à corriger » : minimal et ciblé** — uniquement
   (a) les cas **« Inconnu »** (émetteur/date non trouvés) et
   (b) les **nouvelles entités** proposées, à valider.
   *(Écarté : confiance basse, échantillon aléatoire — trop de bruit.)*

3. **Apprentissage (s'affine au fil du temps).**
   - Nouvel onglet **`Corrections`** : `document → bon domaine / entité / type`.
   - À chaque **nouveau** classement, injection dans le prompt LLM des **corrections les plus proches**
     (même émetteur/type) comme **exemples few-shot**, **borné** (top-N pour le coût).
   - Les corrections d'**entité** alimentent le référentiel `Entités` validé.
   - Effet : prévisible sur le récurrent (mêmes fournisseurs/écoles), souple ailleurs.

4. **Pas de file de revue** (best-guess) · **pas d'undo** (déplacement seul = rien perdu).

## Conséquences

- Nouveaux composants : intégration **Google Forms** (création + lecture des réponses), onglet
  `Corrections`, logique d'injection few-shot dans `Llm.gs`, enrichissement de `Resume.gs` (liens formulaire).
- Coût LLM : quelques tokens de plus par classement (exemples) — borné, sous la cible < 10 $/mois.
- Idempotence : une correction appliquée est tracée (ne se ré-applique pas en boucle).

## Alternatives écartées

- Correction par **déplacement Drive détecté** (surveillance des mouvements) — moins fiable, plus complexe.
- Correction par **réponse mail en texte libre** — interprétation fragile.
- Apprentissage par **règles figées** seulement — Marc a préféré l'affinage contextuel.
