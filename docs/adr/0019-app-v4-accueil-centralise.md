# ADR-0019 — App v4 : accueil tout-en-un & hiérarchie de l'attention (C28-17)

- **Statut** : Accepté (décision Marc 2026-07-10 : « le bouton pour faire le tri est trop
  inaccessible, trop bas ; je veux refaire un dashboard au complet, trop compliqué de s'y
  retrouver sinon » + réponses de cadrage : accueil tout-en-un / Trier·Analyser·Vérifier en
  1 clic / priorité à « ce qui demande MON action » / téléphone et ordinateur à parts égales).
- **Décideurs** : Marc (choix produit), NotebookLM (plan technique), Claude (exécution).
- **S'appuie sur** : ADR-0013 (app v3 « Salle des machines »), ADR-0016 (fail-safe « à
  vérifier »), C28-16 (panneau « Analyser & trier »), C28-06 (analyse ciblée).
- **Remplace philosophiquement** : l'ÉCLATEMENT de l'ADR-0013 — les 6 sections survivent, mais
  l'accueil cesse d'être une simple vitrine de stats pour devenir le cockpit qui couvre ~90 %
  des usages quotidiens.

## Problème & Objectif

L'app v3 a trop décentralisé : pour purger ce qui bloque le système, Marc navigue dans 3 sections
(entités en attente dans Apprentissage, suspects dans Mails, documents « à vérifier » nulle part
en évidence), et le panneau d'actions C28-16 — livré la veille — est enterré en BAS de la vue
Mails. Charge cognitive trop élevée pour un usage quotidien de 30 secondes.

**Objectif** : un accueil « cockpit central » en 3 zones horizontales —

1. **Actions rapides** (`composants/PanneauActions.tsx`, PARTAGÉ accueil + Mails) : « Vérifier
   maintenant » (remonté du header global, mise en avant `principal`), intentions 30 j, tri Gmail
   paramétré (fenêtre/archiver/plafond), analyse ciblée.
2. **Attention** (hiérarchie visuelle forte — contour ambré `--attention`) : mails suspects ⚠,
   documents « à vérifier » (fail-safe ADR-0016, sélecteur `lignesAVerifier`), entités à valider
   (mini-liste + « Aller valider » → Apprentissage via `onAller`). Les trois listes vides ⇒
   encart minimaliste « Tout est à jour ✅ » (contour vert).
3. **Activité** (discrète — léger retrait visuel) : statut moteur, tuiles (docs classés, coût
   LLM, tri 7 j, suspects), graphe 30 j, derniers tris/classements — l'existant v3, inchangé.

## Garde-fous & architecture (inchangés)

- L'app n'exécute AUCUNE logique moteur : les boutons POSTent des demandes JSON à `WebApp.gs`
  (Script Properties consommées par le tick, ~1 min). Aucune nouvelle écriture Drive/Gmail côté
  app ; `corbeille.ts` (ADR-0014) intouché ; aucun secret côté client.
- `etatGlobal.tsx` charge déjà TOUS les onglets (dont Entités) en un `Promise.all` — l'accueil
  n'ajoute aucune lecture.
- Le verrou `session.test.ts` (jeton en sessionStorage) et les tests garde-fous restent verts.
- Responsive « moitié-moitié » : grille d'actions 4 colonnes (desktop) → 2 → 1 (mobile) ; la
  barre basse mobile v3 est conservée telle quelle.

## Écarts au plan validé (documentés)

1. **Clés i18n** : le plan listait `zoneAttention`, `toutEstAJour`, `allerValider` ; ajout de
   `actionsRapides` (titre du panneau élargi — l'ancien « Analyser & trier les mails » ne couvre
   plus « Vérifier maintenant ») et `docsAVerifier` (sous-titre de liste). `analyserTrierTitre`,
   devenu orphelin, est retiré.
2. **Minuteur du badge « Passage lancé ✓ »** : nettoyé au démontage (`useEffect` cleanup) — le
   panneau vit désormais dans des vues démontables, pas dans le header permanent.
3. **Grille mobile** : « colonne » retenue (plutôt que 2×2) — le bloc tri (4 contrôles) est trop
   large pour une demi-colonne de téléphone.

## Méthode de test

- `app/test/etat.test.ts` : sélecteur `lignesAVerifier` (statut exact `'à vérifier'`, ordre
  récent d'abord, quarantaine exclue — elle a sa propre liste).
- `npm run build` (tsc strict + vite) et `npm test` (vitest) verts ; captures E2E
  (`screenshots.spec.ts`) inchangées dans leur mécanique — elles photographient le nouvel
  accueil au prochain run CI.
