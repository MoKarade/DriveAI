# ADR-0006 — Architecture & qualité (tests, testabilité, état lisible)

- **Statut** : Accepté — **en cours** · **FONDATION** (roadmap #1). Livré : **filet de tests + harness
  Node** (`test/`, job CI « Tests unitaires », 37 tests couvrant routage/nommage/dates/garde §1/prédicats/
  invariant vie privée). Reste : **Journal borné + onglet `Santé`** + extension progressive de la couverture.
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe « Architecture & qualité »

## Contexte

Objectif « niveau pro » : que DriveAI **tienne dans le temps sans se casser**. Contrainte : rester sur
**Apps Script gratuit** (pas de vrai environnement de test Google, un seul compte, 6 min/exécution).
Les incidents du 2026-07-01 ont aussi montré un **Journal illisible** (Sheet énorme, tronquée) qui a
gêné le débogage.

## Décision

1. **Filet de tests SOLIDE.** Tests unitaires sur **toute la logique de décision** — routage
   (`deciderRoutage_`), nommage (`nomNormalise_`, schémas par type), dates (`dateNormalisee_`),
   nettoyage (`champ_`), doublons, prédicats de collecte, **garde zone protégée** (`aParentProtege_`).
   Exécutés **en CI à chaque changement** (nouveau job Node dans GitHub Actions).

2. **Refactor vers la testabilité (sans changer le comportement).** Isoler la logique **pure** des
   appels Google (`DriveApp` / `SpreadsheetApp` / `GmailApp` / `UrlFetchApp`). La logique pure devient
   chargeable et testable en **local (Node)** via un petit *harness* qui mocke les globals Google.
   → On peut améliorer/refactorer le classement **sans risquer la prod**.

3. **État & logs domptés.** **Journal borné** (garde les N dernières lignes, archive/purge le reste →
   fini l'illisibilité) + **onglet `Santé`** lisible (dernier passage OK, docs traités du jour, quota
   restant, incidents). Devient la vue de référence pour surveiller/déboguer.

## Pourquoi FONDATION (haut de roadmap)
Le filet de tests + la testabilité **sécurisent tous les autres chantiers** (nouvelle taxo, nommage,
apprentissage…). Les faire **tôt** = améliorer vite et sans peur de casser. Le Journal borné/Santé
règle en plus le trou d'observabilité vécu aujourd'hui.

## Conséquences
- Ajout d'un **job `test`** au CI (Node, ex. `node:test`), + harness de mocks Google.
- Découpage clair **logique pure ↔ effets de bord** (beaucoup de fonctions le sont déjà à moitié).
- `Journal.gs` : rotation/purge + création de l'onglet `Santé`.

## Alternatives écartées
- **Sortir d'Apps Script** vers un serveur/cloud testable — écarté (ADR-0001, rester gratuit).
- **Pas de tests** — rejeté : Marc veut du « solide ».
- **Gros refactor d'un coup** vs **progressif** : retenu **progressif au fil des chantiers**, mais la
  base testable est posée en premier.
