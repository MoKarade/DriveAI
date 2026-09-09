# Captures d'écran de l'app (v7)

Trois captures de référence (mode mock E2E, données de démonstration — jamais les données réelles
de Marc), prises par `app/e2e/screenshots.spec.ts` : `v7-tel-aujourdhui.png` et
`v7-tel-documents.png` (téléphone, 390 px), `v7-pc-aujourdhui.png` (PC, 1 280 px).

Les captures COMPLÈTES (5 écrans × 2 tailles) sont l'artefact `e2e-screenshots` de chaque run CI.
À rafraîchir ici quand l'interface change visiblement : `npx playwright test` dans `app/`, puis
copier les fichiers voulus depuis `app/e2e-screenshots/`.
