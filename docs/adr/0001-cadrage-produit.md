# ADR-0001 — Cadrage produit : vision, priorités, contraintes

- **Statut** : Accepté (2026-07-01)
- **Décideurs** : Marc (propriétaire), Claude
- **Source** : brainstorm produit du 2026-07-01

## Contexte

Après la mise en prod du moteur (Phases 1–3) et le grand rangement de l'ancien Drive, Marc veut
élever DriveAI au « niveau pro » et cadrer les prochaines évolutions, avec une vraie documentation.

## Décision

1. **Vision : outil PERSONNEL, qualité pro.** DriveAI reste l'outil de Marc — **pas** un produit
   destiné à d'autres. Mais robustesse, précision et documentation au niveau d'un vrai projet.

2. **Priorités, dans l'ordre :**
   1. **Précision du classement** (bon domaine + bon sous-niveau + bon nom + bon doublon) ;
   2. **Contrôle & correction** — pouvoir revoir/corriger facilement et que l'outil **apprenne** des
      retours de Marc ;
   3. **Fiabilité totale** — plus jamais de blocage nécessitant une intervention manuelle.

   👉 **La vitesse n'est PLUS une priorité** (jugée « assez bonne » après les optimisations
   P1-18 → P1-20). On privilégie la **qualité** au débit.

3. **Contrainte infra : rester sur le compte Google GRATUIT** (Apps Script, ~90 min d'exécution
   de déclencheurs/jour). On optimise **dans** cette limite.

4. **Documentation cible :** ADR (décisions) · runbook d'exploitation · guide utilisateur · roadmap
   priorisée.

## Conséquences

- Toute évolution se juge d'abord à l'aune de **précision / contrôle / fiabilité**, pas de la vitesse.
- **Pas** de multi-utilisateur, d'auth tierce ni d'infra cloud à maintenir : on garde l'archi
  **Apps Script + Google Sheet + API Anthropic**.
- Le plafond **~90 min/jour** est un **invariant de conception** : un traitement de masse s'étale
  sur plusieurs jours — accepté, à condition qu'il reprenne tout seul (cf. axe Fiabilité).

## Alternatives écartées

- **Produit / SaaS pour d'autres** — hors ambition ; complexifierait tout (auth, multi-tenant, RGPD…).
- **« Produit-ready » (archi évolutive vers produit)** — non retenu pour ne pas sur-architecturer un
  outil perso.
- **Google Workspace payant** (quota ×4) / **sortie d'Apps Script vers un serveur dédié** (zéro
  plafond) — écartés : Marc veut rester gratuit. À ré-évaluer seulement si la lenteur redevient bloquante.
