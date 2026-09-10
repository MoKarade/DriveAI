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
  const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
  await expect(nav).toBeVisible();

  for (const { fichier, libelle } of SECTIONS) {
    const bouton = libelle === 'Réglages' && tel
      ? page.getByRole('button', { name: libelle, exact: true })
      : nav.getByRole('button', { name: libelle, exact: true });
    // `dispatchEvent` plutôt que `click` : sur le projet tactile, la barre basse (position fixe)
    // fait attendre Playwright « scrolling into view » sans fin — vécu à la première capture v7.
    // `toBeVisible` d'abord : dispatchEvent saute les contrôles d'actionnabilité (revue PR 0).
    await expect(bouton).toBeVisible();
    await bouton.dispatchEvent('click');
    // Chaque vue charge ses données mockées au montage : on attend le squelette de la vue active
    // (les mocks sont synchrones côté données, un petit délai couvre le rendu React).
    await page.waitForTimeout(400);
    // Téléphone : la fenêtre seule — ce que Marc voit ; une capture pleine page y peindrait la barre
    // d'onglets (position fixe) au milieu de l'image. PC : la page entière.
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}-${fichier}.png`, fullPage: !tel });
  }
});

/**
 * Garde-fou du retour de Marc (2026-09-10, « la page agenda me fait dézoomer sinon je vois pas
 * tout ») : sur téléphone, en vue GRILLE, la grille horaire doit tenir À L'ÉCRAN. Ce qui est
 * verrouillé ici est la propriété RÉELLEMENT corrigée — plus un seul pixel de la grille derrière la
 * barre d'onglets fixe (mesuré avant correctif : 40 px cachés en 390 × 844, 87 en 390 × 700, 106 en
 * 360 × 640, 119 en 320 × 600 ; le défilement de la grille et celui de la page se disputaient le
 * pouce). Prouvé par MUTATION : retirer le bloc téléphone de `styles.css` fait échouer ce test.
 * Le plancher de hauteur visible est dérivé de `--gt-haut` (1152 px / 24 h), jamais d'un chiffre du
 * jour ; il tient sur le petit écran de référence du projet (320 × 600 → 5,5 h).
 */
test('téléphone : la grille de l’Agenda tient à l’écran (rien sous la barre d’onglets)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tel', 'garde-fou propre au téléphone');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
  const agenda = nav.getByRole('button', { name: 'Agenda', exact: true });
  await expect(agenda).toBeVisible();
  await agenda.dispatchEvent('click');
  const grille = page.getByRole('button', { name: 'Grille', exact: true });
  await expect(grille).toBeVisible();
  await grille.dispatchEvent('click');
  await page.waitForTimeout(400);

  const mesure = await page.evaluate(() => {
    const defilant = document.querySelector('.gt-defilant');
    const barre = document.querySelector('nav.barre-basse');
    if (!defilant || !barre) return null;
    const d = defilant.getBoundingClientRect();
    const b = barre.getBoundingClientRect();
    return {
      cache: Math.max(0, d.bottom - b.top),          // grille passant DERRIÈRE la barre d'onglets
      visible: Math.min(d.bottom, b.top) - Math.max(d.top, 0),
      heure: 1152 / 24,                              // --gt-haut / 24 h
    };
  });
  expect(mesure).not.toBeNull();
  expect(mesure!.cache).toBe(0);
  expect(mesure!.visible).toBeGreaterThanOrEqual(5 * mesure!.heure);
});
