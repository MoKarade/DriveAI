# Roadmap — DriveAI

> Priorisée lors du **brainstorm produit du 2026-07-01** (Marc + Claude). Le *pourquoi* de chaque
> décision est dans `docs/adr/`. Statuts : ⬜ à faire · 🟦 en cours · ✅ fait.

## Cap produit (ADR-0001)
Outil **personnel**, qualité **pro**. Priorités : **① précision · ② contrôle/correction · ③ fiabilité**
(la vitesse n'est plus prioritaire). On reste sur le **compte Google gratuit**.

## À venir — ordre validé

| # | Chantier | Axe | Effort | ADR | Statut |
|---|----------|-----|--------|-----|--------|
| 1 | **Chien de garde + section santé** (heartbeat, ré-armage auto du déclencheur, alerte si échec) | Fiabilité | S-M | [0004](adr/0004-fiabilite.md) | ⬜ |
| 2 | **Nommage par type de doc** + « deviner depuis le nom d'origine » + nouveaux dossiers `07 · Santé` et `_Technique` | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | ⬜ |
| 3 | **Entités : validation 1 clic + garde anti-variantes** (« IUT ULCO » ≈ « IUT du Littoral ») | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | ⬜ |
| 4 | **Boucle d'apprentissage** — onglet `Corrections` injecté en exemples few-shot | Contrôle | M | [0003](adr/0003-controle-correction.md) | ⬜ |
| 5 | **Correction via mail → mini-formulaire** (cas « Inconnu » + entités à valider) | Contrôle | M-L | [0003](adr/0003-controle-correction.md) | ⬜ |
| 6 | **Migration de l'existant** vers la nouvelle taxonomie (réutilise le grand rangement) | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | ⬜ |

**Rationale :** fiabilité en socle (petite, évite le babysitting) → gros gains de précision → contrôle/
apprentissage (qui a besoin que le reste existe) → migration en dernier.

## Déjà fait (avant le brainstorm)
Phases 1–3 (moteur Gmail→classement, entités, tâches/agenda), grand rangement de l'ancien Drive,
dédup fast-path, documents sensibles auto-classés, un seul dossier d'arrivée + nom final direct, etc.
Détail : `BACKLOG.md` (P1-01 → P1-20).

## Hors périmètre (ADR-0001)
Produit/SaaS, multi-utilisateur, Google Workspace payant, sortie d'Apps Script — écartés (ré-évaluables
plus tard).
