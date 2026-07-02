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
| [0002](0002-refonte-taxonomie-entites-nommage.md) | Refonte taxonomie, entités & nommage | **Implémenté** (chantiers #3, #4, #8) |
| [0003](0003-controle-correction.md) | Contrôle & correction (et apprentissage) | **Implémenté** (chantiers #5, #6 + app #9) |
| [0004](0004-fiabilite.md) | Fiabilité totale (zéro babysitting) | **Implémenté** (chien de garde) |
| [0005](0005-sources-entree.md) | Sources d'entrée (fichiers partagés) | **Implémenté** (chantier #7) |
| [0006](0006-architecture-qualite.md) | Architecture & qualité (tests, testabilité, état lisible) | **Implémenté** (129 tests moteur + 51 app en CI) · **FONDATION** |
| [0007](0007-securite-vie-privee.md) | Sécurité & vie privée (LLM, rétention, scopes) | Accepté — majoritairement déjà en place |
| [0008](0008-app-web-recherche-controle.md) | App web (Phase 4) : recherche, contrôle & tableau de bord | **Implémenté** (chantier #9, en prod sur Vercel) |
| [0009](0009-qualite-entites-medias.md) | Qualité moteur : entités propres & médias bruts | Accepté — à implémenter (#10-#11) |
| [0010](0010-mails-historique-visibilite.md) | Mails : historique complet, visibilité Phase 3, importants | Accepté — à implémenter (#12-#14) |
| [0011](0011-app-v2-curation.md) | App web v2 : curation efficace & confort | Accepté — à implémenter (#15) |

ADR 0001-0008 : **brainstorm du 2026-07-01** · ADR 0009-0011 : **brainstorm v2 du 2026-07-02** (Marc + Claude). Voir aussi `docs/ROADMAP.md` (ordre
d'implémentation), `docs/RUNBOOK.md` (exploitation) et `docs/GUIDE.md` (usage).
