<!-- Extrait de l'ancien CLAUDE.md (CLAUDE.md, introduction (contexte, stack, destination)), texte inchangé. -->

# CLAUDE.md — DriveAI

> Mémoire de projet, chargée à chaque session. **Garde ce fichier court et à jour.**
> L'état courant vit dans `HANDOVER.md`, le reste à faire dans `BACKLOG.md`, le détail dans
> `docs/`. Les leçons s'accumulent dans `docs/LESSONS.md` et leurs règles durables remontent
> en §9.
>
> Structure imposée par la convention commune aux huit dépôts
> ([`claude-config/conventions/STRUCTURE-DEPOT.md`](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md)).
> **Les sections ont été renumérotées le 2026-08-20.** Le reste du dépôt — code, tests, ADR,
> backlog — porte plus de 500 renvois à l'ancienne numérotation, qui n'ont PAS été réécrits :
> une passe de `sed` sur autant de sites aurait cassé plus qu'elle n'aurait réparé, d'autant
> que `§1` y désigne souvent le garde-fou n° 1 et non la section 1. Correspondance :
> **ancien §2 (garde-fous) → §1** · **ancien §7 (leçons) → §9** · **ancien §8 (protocole) →
> §11**. Les autres n'ont pas bougé de sens.

**DriveAI** range Google Drive tout seul : les pièces jointes utiles des mails et les
fichiers déposés à la main sont analysés par un LLM, renommés selon une convention stricte, et
classés dans une arborescence granulaire — sans intervention, sauf une file de revue pour les
cas incertains. Le modèle a suivi le besoin (Haiku au départ, **Sonnet en 2 passes** depuis le
2026-07-09, ADR-0018) : la valeur qui fait foi est `CONFIG`, pas cette phrase.

Stack : **Google Apps Script** (moteur, Phases 1–3) + une **Google Sheet** (état) +
**app web React/Vite/TS sur Vercel** (Phase 4). LLM via l'API Anthropic.
