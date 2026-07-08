# Captures d'écran de l'app (sources NotebookLM)

Les 6 sections de l'app (mode mock E2E, données de démonstration — jamais les données réelles
de Marc), régénérées par `app/e2e/screenshots.spec.ts`. Elles sont COMMITTÉES ici pour que le
miroir Drive (`_Miroir du dépôt`, fichiers `docs---captures---*.png`) les porte jusqu'à
NotebookLM — les artefacts CI, eux, ne sont jamais miroirés.

`captures-app.pdf` assemble les 6 pages en UN document : c'est LUI la source à ajouter dans
NotebookLM — le sélecteur Drive de NotebookLM filtre sur Docs/Slides/Sheets/PDF et ne montre
pas les .png (les images ne passent qu'en upload direct).

À RAFRAÎCHIR quand l'interface change visiblement : relancer l'E2E localement
(`npx playwright test` dans `app/`), re-copier `app/e2e-screenshots/*.png` ici, et régénérer
le PDF (PIL : `Image.save(..., save_all=True, append_images=...)`).
