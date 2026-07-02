# Roadmap — DriveAI

> Priorisée lors du **brainstorm produit du 2026-07-01** (Marc + Claude). Le *pourquoi* de chaque
> décision est dans `docs/adr/`. Statuts : ⬜ à faire · 🟦 en cours · ✅ fait.

## Cap produit (ADR-0001)
Outil **personnel**, qualité **pro**. Priorités : **① précision · ② contrôle/correction · ③ fiabilité**
(la vitesse n'est plus prioritaire). On reste sur le **compte Google gratuit**.

## À venir — ordre validé

| # | Chantier | Axe | Effort | ADR | Statut |
|---|----------|-----|--------|-----|--------|
| 1 | **Fondation testable** — refactor logique pure ↔ effets de bord, filet de tests en CI (Node), **Journal borné + onglet `Santé`**, + test d'invariant vie privée « aucun corps de document dans l'état/les logs » ([0007](adr/0007-securite-vie-privee.md)) | Qualité (socle) | M | [0006](adr/0006-architecture-qualite.md) | ✅ socle posé (harness + 50 tests + job CI · Journal borné · onglet `Santé`) — couverture à étendre au fil des chantiers |
| 2 | **Chien de garde** (heartbeat, ré-armage auto du déclencheur, alerte si échec) — écrit dans l'onglet `Santé` du #1 | Fiabilité | S-M | [0004](adr/0004-fiabilite.md) | ✅ (2ᵉ déclencheur, auto-réparation + alerte dédupée, état système au résumé hebdo) |
| 3 | **Nommage par type de doc** + « deviner depuis le nom d'origine » + nouveaux dossiers `07 · Santé` et `_Technique` | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | ✅ nommage par type + deviner-du-nom + `07·Santé` (auto) + `_Technique` (code/CAO) + renumérotage Perso→08 |
| 4 | **Entités : validation 1 clic + garde anti-variantes** (« IUT ULCO » ≈ « IUT du Littoral ») | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | 🟦 garde anti-variantes ✅ (similarité + colonne « Variante possible ? ») · validation 1-clic à suivre |
| 5 | **Boucle d'apprentissage** — onglet `Corrections` injecté en exemples few-shot | Contrôle | M | [0003](adr/0003-controle-correction.md) | 🟦 onglet `Corrections` + sélection few-shot par émetteur (top-N borné) injectée au prompt ✅ · canal de saisie = #6 |
| 6 | **Correction via mail → mini-formulaire** (cas « Inconnu » + entités à valider) | Contrôle | M-L | [0003](adr/0003-controle-correction.md) | ⬜ |
| 7 | **Sources d'entrée : fichiers partagés** (copie auto dans l'arbo, garde-fous type/dédup/storage) | Sources | M | [0005](adr/0005-sources-entree.md) | ⬜ |
| 8 | **Migration de l'existant** vers la nouvelle taxonomie (réutilise le grand rangement) | Précision | M | [0002](adr/0002-refonte-taxonomie-entites-nommage.md) | ⬜ |
| 9 | **App web (Phase 4)** — recherche structurée (Index + plein texte natif Drive), tableau de bord santé, corrections (login Google) | Contrôle/Accès | L | [0008](adr/0008-app-web-recherche-controle.md) | ⬜ |

**Rationale :** la **fondation testable** en socle (tests + logique pure isolée = on améliore le reste
sans casser la prod, et le Journal borné/Santé règle le trou d'observabilité vécu le 2026-07-01) → chien
de garde (s'appuie sur l'onglet Santé) → gros gains de précision → contrôle/apprentissage (qui a besoin
que le reste existe) → sources d'entrée → migration → **app web en Phase 4** (dernière, s'appuie sur tout
le reste : Santé, Corrections, Index enrichi).

## Déjà fait (avant le brainstorm)
Phases 1–3 (moteur Gmail→classement, entités, tâches/agenda), grand rangement de l'ancien Drive,
dédup fast-path, documents sensibles auto-classés, un seul dossier d'arrivée + nom final direct, etc.
Détail : `BACKLOG.md` (P1-01 → P1-20).

## Hors périmètre (ADR-0001)
Produit/SaaS, multi-utilisateur, Google Workspace payant, sortie d'Apps Script — écartés (ré-évaluables
plus tard).
