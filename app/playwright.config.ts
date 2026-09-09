/**
 * playwright.config.ts — captures d'écran E2E de l'UI (CI, chantier « captures automatisées »).
 *
 * C'est ICI (et seulement ici) que `VITE_E2E_MOCK=true` est injectée : le serveur de dev Vite
 * lancé par Playwright sert l'app en MODE MOCK (auth bouchonnée, données locales de mockData.ts,
 * aucun appel aux vraies API Google — voir google.ts). Un build Vercel/production ne passe
 * JAMAIS par ce fichier : la variable y est absente, le mode mock y est du code mort.
 *
 * DEUX tailles (v7, ADR-0051) : « pc » 1280 × 900 et « tel » 390 × 844 (iPhone courant, tactile).
 * La v6 n'était photographiée qu'à 1280 px — l'heure sur trois lignes, le champ de recherche
 * réduit à « Rec » et l'agenda ouvert à minuit n'ont jamais été vus par la CI.
 */
import { defineConfig } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  timeout: 60_000,
  // Les captures sont un ARTEFACT à consulter, pas une comparaison de pixels : 1 seul navigateur.
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Environnements où un Chromium système est fourni SANS les navigateurs de la version
    // épinglée de Playwright (ex. sandbox de dev) : `PLAYWRIGHT_CHROMIUM_EXE=/chemin/chrome`.
    // En CI GitHub, la variable est absente — `npx playwright install` fournit le navigateur.
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXE } }
      : {}),
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'tel', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_E2E_MOCK: 'true' },
  },
});
