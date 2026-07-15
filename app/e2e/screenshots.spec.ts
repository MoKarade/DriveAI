/**
 * screenshots.spec.ts — photographie les 6 sections de l'app en MODE MOCK (VITE_E2E_MOCK=true,
 * injectée par playwright.config.ts). Les images atterrissent dans `e2e-screenshots/` et sont
 * remontées en artifact GitHub à chaque push (voir .github/workflows/ci.yml) : un coup d'œil
 * suffit pour voir si l'UI est visuellement cassée.
 */
import { test, expect } from '@playwright/test';

// Libellés FR de la nav (i18n.ts) — l'app démarre en français par défaut.
const SECTIONS: Array<{ fichier: string; libelle: string }> = [
  { fichier: '1-aujourdhui', libelle: 'Aujourd’hui' },
  { fichier: '2-agenda', libelle: 'Agenda' },
  { fichier: '3-documents', libelle: 'Documents' },
  { fichier: '4-apprentissage', libelle: 'Apprentissage' },
  { fichier: '5-quotas', libelle: 'Coûts & quotas' },
  { fichier: '6-sante', libelle: 'Santé du moteur' },
];

test('captures des 6 sections (mode mock, app "connectée")', async ({ page }) => {
  // Plus rien à seeder (C28-20) : l'écran Configuration n'existe plus — en mode mock,
  // config.ts sert une config factice et google.ts une session bouchonnée, sans aucun fetch.
  await page.goto('/');

  // Le mode mock rend estConnecte() vrai : la nav des sections doit être là, PAS le bouton Connexion.
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav).toBeVisible();

  for (const { fichier, libelle } of SECTIONS) {
    await nav.getByRole('button', { name: libelle, exact: true }).click();
    // Chaque vue charge ses données mockées au montage : on attend le squelette de la vue active
    // (les mocks sont synchrones côté données, un petit délai couvre le rendu React).
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e-screenshots/${fichier}.png`, fullPage: true });
  }
});
