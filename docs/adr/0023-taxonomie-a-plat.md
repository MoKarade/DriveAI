# ADR-0023 — Taxonomie à PLAT par défaut (abandon de la profondeur forcée) + campagne de consolidation

- **Statut** : accepté (plan architecte NotebookLM, chantier C28-26, 2026-07-16)
- **Décideur** : Marc (retour produit 2026-07-16 : « c'est trop le bordel, j'arrive vraiment pas à
  me retrouver — refais vraiment en entier, et pas de doublons »)
- **Révise** : l'exigence « rien à la racine d'un domaine » (Marc 2026-07-07, REGLES_V2/C26-05) et
  le repli catégorie/type/« Divers » de `sousDossierPourNom_`.

## Problème

Le recensement complet du 2026-07-16 (`docs/diagnostics/2026-07-16-recensement-drive.md`) mesure
l'échec de la profondeur forcée : **~499 dossiers dont ~102 vides** pour ~2 880 fichiers, 61 % de
dossiers vides dans 03, 92 dossiers dans 05 pour 2 vrais employeurs, un dossier par émetteur au
premier fichier, des squelettes jamais remplis, des entités en 4-5 variantes de graphie.
L'IA a confondu « métadonnées riches » (le JSON d'analyse) avec « arborescence profonde »
(les dossiers physiques). Deux lignes de code et une ligne de prompt sont fautives :

1. `Router.gs` `sousDossierPourNom_` : le repli `catégorie || type_doc || 'Divers'` (+ le repli
   `emetteur` en amont) fabriquait TOUJOURS un dossier — y compris pour un marchand vu une fois.
2. `Router.gs` `deciderRoutageV2_` : `champ_(plan.sousDossier) || 'Divers'` re-créait « Divers »
   même quand le plan était vide.
3. `Llm.gs` `REGLES_V2`/`PROMPT_PASSE1`/`PROMPT_PASSE2` : « sousDossier DOIT être non vide […]
   Rien à la racine » forçait Sonnet à INVENTER des sous-dossiers pour satisfaire la contrainte.

## Décision

1. **Classement à PLAT par défaut.** Un document se range à la RACINE de son domaine
   (`02 · Finances/2026-03-01_Facture_EDF.pdf`). Le nom de fichier (`AAAA-MM-JJ_Type_Émetteur.ext`)
   porte déjà toute l'information — le dossier n'ajoutait que du bruit.
2. **Le sous-dossier devient l'EXCEPTION**, réservé à :
   - une **pièce d'identité** → dossier de TYPE (« Passeport »… — inchangé) ;
   - une **entité MAJEURE et durable** de la vie de Marc (employeur, école, véhicule, banque),
     canonisée par `canoniserEntite_`. Le prompt v2 laisse `entite`/`sousDossier` null sinon ;
   - les **années** pour les domaines à volume (`DOMAINES_PAR_ANNEE`, ex. 02) — inchangé (chemin v1
     / cible de consolidation).
3. **Plus JAMAIS** de dossier par émetteur ponctuel, par catégorie (« Cours », « Devoirs »,
   « Reçus ») ni « Divers » : `sousDossierPourNom_` retourne l'entité canonisée, le type
   d'identité, ou `''` (= racine du domaine) ; `deciderRoutageV2_` route `''` vers la racine.
4. **Campagne de consolidation** (`src/Consolidation.gs`, PR2) : génère un PLAN dans l'onglet
   Sheet `PlanConsolidation` (Fichier | ID | Action | Cible | Raison) — dry-run PUR, flag
   `CONSOLIDATION_ACTIF: false` par défaut, aucune mutation tant que Marc n'a pas validé.

## Impact & garde-fous (§2)

- **Aucune suppression** : la consolidation ne produit que des propositions `Déplacer`/`Doublon`
  (déplacement seul vers la cible ou `_Doublons`). Les dossiers VIDÉS relèvent de la corbeille APP
  validée existante (ADR-0014) — jamais du moteur.
- **Zone 04 sanctuarisée** : toute proposition sur un fichier dont UN ancêtre est sous
  `04 · Immigration` (`aParentProtege_`, remontée multi-parents) devient `Ignoré — Zone protégée`.
  Les doublons du passeport (×6 constatés dans `_Doublons`) suivent la même règle : constat inscrit,
  jamais de déplacement automatique depuis/vers la zone.
- **Coût LLM** : PR1 = zéro coût nouveau (mêmes 2 passes, texte de prompt modifié). PR2 = zéro
  appel LLM (le plan se calcule sur métadonnées + empreintes).
- **Convergence** : un document classé à plat au bon endroit est « OK » pour la consolidation ;
  le renommage `AAAA-MM-JJ_` reste le prédicat de skip du grand rangement (inchangé).
- **Vie privée (ADR-0007)** : le plan de consolidation n'écrit que des métadonnées (nom, ID,
  action, chemin) — jamais de contenu.

## Méthode de test

- `test/routage-v2.test.js` + `test/identite-titulaire.test.js` : à plat par défaut (émetteur seul
  → `''`, catégorie → `''`, rien → `''`), identité → type (inchangé), entité majeure → canonique.
- PR2 : `test/consolidation.test.js` (fonctions PURES) — mal rangé → `Déplacer`, hash déjà vu →
  `Doublon`, fichier sous 04 → `Ignoré` même mal rangé/en double.
- Toute exécution réelle de déplacements de masse reste soumise au protocole §8 (dry-run validé
  par Marc AVANT toute mutation).
