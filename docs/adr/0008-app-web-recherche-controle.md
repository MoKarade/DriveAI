# ADR-0008 — App web (Phase 4) : recherche, contrôle & tableau de bord

- **Statut** : Accepté — **à implémenter** (Phase 4, roadmap #9) · effort **L**
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe « Recherche & accès (Phase 4) »

## Contexte

DriveAI range déjà tout dans Drive avec des noms propres, et **Drive sait naviguer/chercher nativement**.
Une app web ne se justifie donc que par ce que Drive fait **mal** : **contrôler/corriger**, **voir la
santé/activité**, et **filtrer de façon structurée**. Stack déjà cadrée (CLAUDE.md §1) : **React/Vite/TS
sur Vercel**, gratuit.

## Décision

**Construire une app web à trois surfaces**, accès par **login Google (OAuth)** (tu te connectes, l'app
lit ton état / ton Drive en ton nom ; rien de public).

### 1. Corriger & valider *(cœur du contrôle — priorité n°2)*
Valider les entités proposées, rectifier un classement, traiter les cas « Inconnu ». **L'app applique
directement** le déplacement/renommage via l'API Drive (correction **immédiate**, pas au prochain tick).

> ⚠️ **Contrainte NON négociable attachée à ce choix.** Puisque l'app mute Drive elle-même, elle **ré-implémente**
> et **teste** les garde-fous §1/§2 : *aucune suppression* ; *zone protégée `04·Immigration` jamais détachée*
> (remonter toute la chaîne d'ancêtres, multi-parents) ; *doublon → `_Doublons` (déplacement seul)*. Ces
> règles restent au-dessus de la commodité. Risque documenté (« invariants voisins ») : le même garde-fou
> vit alors en **deux** endroits (moteur Apps Script + app TS) et peut diverger → il doit être **couvert par
> le filet de tests** (ADR-0006), idéalement en **partageant la logique pure** (miroir du moteur).

En plus du geste, l'app **journalise la correction** dans l'onglet `Corrections` → alimente la **boucle
d'apprentissage few-shot** (ADR-0003) pour que le moteur **retienne**.

### 2. Tableau de bord santé & activité
Lit l'onglet **`Santé`** (ADR-0006) + l'**Index** : ce que DriveAI a fait, coût du mois, quota restant,
incidents. Version riche de l'onglet Santé.

### 3. Recherche structurée *(sans casser la vie privée)*
- **Filtres structurés** sur l'**Index existant** (entité / type / domaine / date / statut) — gratuit,
  zéro ré-indexation.
- **Plein texte délégué à la recherche native de Drive** (`fullText contains` via l'API) → on cherche
  **dans le contenu** des documents **sans que DriveAI stocke aucun corps de doc**. Respecte **ADR-0007**
  (« métadonnées seulement »). Pas d'index plein texte propre à l'app.

## Conséquences
- **Scopes OAuth côté app** : lecture Sheet d'état + Drive (recherche/dashboard) et **écriture Drive**
  (appliquer les corrections). Login Google, aucune exposition publique.
- **Partage de logique** : la logique pure de garde-fous/routage isolée par **ADR-0006** est ré-exprimée
  et testée en TS (mirror). Sans ça, l'application directe des corrections est un risque.
- **ADR-0007 intact** : pas d'index de contenu → aucun corps de document persité côté app.
- **v1 minimal proposé** : tableau de bord santé + file de corrections (s'appuient directement sur l'état
  existant), puis la recherche structurée. Le **mail hebdo** (ADR-0003) pointe vers la vue corrections.

## Alternatives écartées
- **Le moteur applique les corrections (app = intention seulement)** — plus sûr (garde-fous en 1 endroit),
  mais correction non instantanée. Écarté : Marc veut l'immédiateté. *(Garde-fous préservés via duplication testée.)*
- **Application directe s'arrêtant au « sûr », sensible délégué au moteur** — compromis proposé, écarté par
  Marc au profit de l'application directe intégrale.
- **Index plein texte propre à l'app** — écarté : violerait ADR-0007 et duplique ce que Drive fait déjà.
- **Pas d'app (Drive natif suffit)** — écarté : Marc veut contrôle + dashboard + recherche structurée.
- **Accès par export publié (pas d'OAuth)** — écarté : login Google plus simple, rien à exposer.
