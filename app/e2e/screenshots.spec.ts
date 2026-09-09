/**
 * screenshots.spec.ts — photographie les 5 écrans de l'app en MODE MOCK (VITE_E2E_MOCK=true,
 * injectée par playwright.config.ts), à DEUX tailles (projets « pc » et « tel »). Les images
 * atterrissent dans `e2e-screenshots/` (préfixées par le projet) et sont remontées en artifact
 * GitHub à chaque push (voir .github/workflows/ci.yml) : un coup d'œil suffit pour voir si l'UI
 * est visuellement cassée — sur téléphone aussi, désormais.
 */
import { test, expect } from '@playwright/test';

// Libellés FR de la nav (i18n.ts) — l'app démarre en français par défaut.
const SECTIONS: Array<{ fichier: string; libelle: string }> = [
  { fichier: '1-aujourdhui', libelle: 'Aujourd’hui' },
  { fichier: '2-agenda', libelle: 'Agenda' },
  { fichier: '3-documents', libelle: 'Documents' },
  { fichier: '4-assistant', libelle: 'Assistant' }, // C28-30 : chat + validation du plan
  { fichier: '5-reglages', libelle: 'Réglages' },   // v7 : l'ancienne page Moteur, hors navigation
];

test('captures des 5 écrans (mode mock, app "connectée")', async ({ page }, testInfo) => {
  const tel = testInfo.project.name === 'tel';
  // Plus rien à seeder (C28-20) : l'écran Configuration n'existe plus — en mode mock,
  // config.ts sert une config factice et google.ts une session bouchonnée, sans aucun fetch.
  await page.goto('/');

  // Le mode mock rend estConnecte() vrai : la nav des sections doit être là, PAS le bouton Connexion.
  // Sur téléphone c'est la barre basse ; sur PC, le rail. Réglages n'est dans aucune des deux sur
  // téléphone : on y va par l'engrenage de la barre haute.
  const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections' });
  await expect(nav).toBeVisible();

  for (const { fichier, libelle } of SECTIONS) {
    const bouton = libelle === 'Réglages' && tel
      ? page.getByRole('button', { name: libelle, exact: true })
      : nav.getByRole('button', { name: libelle, exact: true });
    // `dispatchEvent` plutôt que `click` : sur le projet tactile, la barre basse (position fixe)
    // fait attendre Playwright « scrolling into view » sans fin — vécu à la première capture v7.
    await bouton.dispatchEvent('click');
    // Chaque vue charge ses données mockées au montage : on attend le squelette de la vue active
    // (les mocks sont synchrones côté données, un petit délai couvre le rendu React).
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}-${fichier}.png`, fullPage: true });
  }
});
