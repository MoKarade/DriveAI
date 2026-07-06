# ADR-0014 — Corbeille des dossiers devenus VIDES : révision ÉTROITE du garde-fou §2

- **Statut** : Accepté (chantier #21, C21-07)
- **Décideurs** : Marc (cadrage explicite du 2026-07-06 : « Dossiers VIDES seulement, après ta
  validation → corbeille Drive, récupérable 30 j »), Claude
- **Révise** : CLAUDE.md §2.2 (« Aucune suppression automatique ») — première et unique
  exception depuis la création du projet. **Complète** : ADR-0013 (app v3), chantier #21
  (réorg IA : C21-04 proposition, C21-05 validation, C21-06 application).

## Contexte

La réorg IA (chantier #21) fusionne des dossiers **sur validation explicite de Marc** : le
contenu du dossier source rejoint la cible, le dossier source devient **vide**. Sans cette
décision, les coquilles vides s'accumuleraient à chaque réorg — Marc a explicitement demandé
que l'IA puisse « supprimer des dossiers ou en rajouter », et le cadrage a borné ce pouvoir :
**proposition → validation → corbeille Drive** (jamais une purge).

Jusqu'ici le §2 était absolu : *aucune suppression automatique, nulle part*. Le moteur ET
l'app avaient une surface de code sans AUCUN chemin de suppression, verrouillée par tests
(`test/surface-gmail-ecriture.test.js` côté moteur, `app/test/aucune-suppression.test.ts`
côté app).

## Décision

Une exception **ÉTROITE**, portée par l'APP seulement :

1. **Quoi** : uniquement un **DOSSIER devenu VIDE** (recensé `vide-candidat` dans l'onglet
   `Réorg` après une fusion appliquée — C21-06). **Jamais un fichier. Jamais un dossier non
   vide. Jamais la zone protégée (`04 · Immigration` — par ascendance ET par identité). Jamais
   une racine système (`_…`, `00 · …`, `NN · …`). Jamais un dossier structurel à ID FIXE**
   (`CONFIG.CATEGORIES` : Logement/Véhicule — le router y route par ID en dur, aucune
   re-création par nom ; miroir app : `IDS_STRUCTURELS_DEFAUT`).
2. **Qui** : **l'app**, au **clic de validation de Marc** (le clic EST la validation — rien
   n'est jamais corbeillé par un automatisme). Le **moteur garde sa surface `.gs` sans AUCUNE
   suppression**, inchangée et toujours verrouillée par test.
3. **Comment** : `app/src/corbeille.ts` — l'**unique** fichier de l'app autorisé à porter
   `trashed: true` (PATCH Drive = corbeille, **récupérable 30 jours** ; jamais `files.delete`,
   interdit partout y compris dans ce fichier). Au clic, il **re-vérifie en direct** :
   - la **vacuité STRICTE** (`files.list` sans filtre `trashed` : 0 enfant, corbeillés
     inclus — une ligne `vide-candidat` est un *candidat*, jamais une preuve : le router a pu
     re-remplir le dossier entre-temps) ;
   - le **type** (un dossier, rien d'autre) ;
   - l'**ascendance** (remontée multi-parents complète ; zone protégée ou chaîne illisible =
     refus, échec fermé) ;
   - le **nom** (racines système refusées par motif).
   Le verdict est une fonction **PURE testée** (`verdictCorbeille`) ; l'action réseau ne part
   que sur verdict vide.
4. **Verrous testables (tripwire)** : `app/test/aucune-suppression.test.ts` interdit
   `trashed: true` **partout sauf** `corbeille.ts`, interdit `DELETE` partout **y compris**
   `corbeille.ts`, et vérifie la cohérence des documents vivants dans **les deux sens** :
   `corbeille.ts` existe ⇔ CLAUDE.md §2 documente l'ADR-0014 (même patron que le tripwire
   `oauthScopes` ↔ CLAUDE.md du moteur).

## Conséquences

- Marc voit dans l'app (Documents → Réorg IA) la liste des dossiers devenus vides et les met
  à la corbeille un par un, en conscience — récupérables 30 jours dans la corbeille Drive.
- Le pire scénario en cas de bug de l'app reste **réversible** (corbeille, jamais purge) et
  **borné** (dossiers vides seulement — un dossier avec le moindre enfant, même corbeillé,
  est refusé).
- **Fenêtre TOCTOU assumée** : entre la re-vérification de vacuité et le PATCH (~1 s), le
  moteur pourrait théoriquement déposer un fichier — il partirait à la corbeille AVEC le
  dossier. Probabilité infime (après fusion, les entités sont déjà re-pointées ailleurs ;
  ticks espacés de ≥ 5 min), impact récupérable 30 j (restaurer le dossier restaure l'enfant).
- **Périmètre moteur rendu TESTABLE** : `test/surface-gmail-ecriture.test.js` scanne désormais
  aussi les suppressions **Drive** dans `src/*.gs` (setTrashed, emptyTrash, DELETE REST,
  trashed:true) — unique exception whitelistée nommément : le nettoyage du fichier TEMPORAIRE
  d'OCR (artefact créé par le moteur lui-même, borné à 1 occurrence).
- Toute PR qui élargirait cette exception (un fichier, un dossier non vide, un chemin moteur)
  casse les tests de surface ET doit réviser cet ADR + CLAUDE.md dans le même commit.

## Réversibilité de la décision

Retirer `app/src/corbeille.ts`, la section UI associée et re-serrer le motif `trashed: true`
dans `aucune-suppression.test.ts` restaure le §2 absolu ; le tripwire force alors la mise à
jour de CLAUDE.md dans le même commit.
