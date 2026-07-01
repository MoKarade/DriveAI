# Décisions d'architecture (ADR) — DriveAI

Ce dossier trace les **décisions structurantes** de DriveAI : le *quoi* et surtout le *pourquoi*.
Format léger inspiré des *Architecture Decision Records* (Michael Nygard).

Chaque ADR : **Statut · Contexte · Décision · Conséquences · Alternatives écartées.**
Statuts possibles : `Proposé` · `Accepté` · `Implémenté` · `Remplacé par ADR-XXXX`.

> ⚠️ Un ADR **Accepté** peut ne pas encore être **Implémenté** : il décrit la **cible**.
> Le comportement réellement codé vit dans `docs/TAXONOMY.md`, `docs/NAMING.md` et `src/`.
> Quand l'implémentation rattrape un ADR, on bascule son statut en `Implémenté` et on met à jour
> ces docs — pour ne jamais laisser la doc diverger du code.

## Index

| ADR | Titre | Statut |
|-----|-------|--------|
| [0001](0001-cadrage-produit.md) | Cadrage produit (vision, priorités, contraintes) | Accepté |
| [0002](0002-refonte-taxonomie-entites-nommage.md) | Refonte taxonomie, entités & nommage | Accepté — à implémenter |

Issu du **brainstorm produit du 2026-07-01** (Marc + Claude). D'autres ADR suivront pour les axes
« Contrôle & correction » et « Fiabilité ».
