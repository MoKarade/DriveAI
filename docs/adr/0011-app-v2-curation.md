# ADR-0011 — App web v2 : curation efficace & confort

- **Statut** : Accepté — **à implémenter** (roadmap v2, chantier #15)
- **Décideurs** : Marc, Claude · **Source** : brainstorm v2 du 2026-07-02

## Contexte

L'app v1 (ADR-0008) est en prod (`driveai-ivory.vercel.app`, intégration Vercel↔GitHub active :
déploiement auto à chaque merge). La curation reste clic-par-clic : la suggestion de variante n'est
qu'un texte, pas d'action en masse, dashboard minimal, pas d'usage mobile confortable.

## Décisions (chantier #15, découpable)

1. **Fusion 1-clic des variantes** : la suggestion « → Desjardins (90 %) ? » devient un bouton
   **Fusionner** — la ligne dupliquée passe `variante de : X` (aucune suppression), les corrections
   futures pointent la forme canonique. Miroir du geste côté moteur documenté dans `TAXONOMY.md`.
2. **Rejet en masse** : cases à cocher + « Refuser la sélection » (Statut → `refusée`, réversible).
   Toute écriture reste cellule-par-cellule ciblée par en-têtes réels (jamais de batch destructif —
   le test de surface « aucune suppression » continue de gater).
3. **Dashboard enrichi** : coût par jour (Journal/Coût), volume classé par domaine dans le temps,
   liste de quarantaine (lecture) avec marquage « à relancer » (le moteur consomme le marquage au
   tick — l'app n'exécute jamais de fonction moteur).
4. **PWA** : manifest + installable sur téléphone, mise en page au pouce (la SPA reste 100 % statique).

## Garde-fous inchangés (ADR-0008)
Aucune suppression (test de surface), zone protégée intouchable, métadonnées seules (ADR-0007),
gestes journalisés (few-shot). Les actions en masse n'écrivent que des STATUTS de propositions —
jamais un document.

## Conséquences
- `app/` : vues Corrections enrichies (fusion, sélection multiple), Dashboard v2, manifest PWA.
- `Maintenance.gs` : consommation du marquage « à relancer » (dequarantaine pilotée par la Sheet).
