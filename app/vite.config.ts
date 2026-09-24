import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// App DriveAI (Phase 4) — SPA statique, AUCUN backend : l'app parle directement aux API Google
// avec le jeton OAuth de l'utilisateur connecté (rien de public, aucun secret embarqué).
// `defineConfig` de vitest/config : type le bloc `test` sans cast.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Les tests unitaires vivent dans test/ ; e2e/ appartient à Playwright (npm run test:e2e) —
    // sans cette borne, vitest ramasse e2e/*.spec.ts (motif par défaut) et plante sur
    // @playwright/test.
    include: ['test/**/*.test.ts'],
    // FUSEAU ÉPINGLÉ. Le bug corrigé le 2026-09-12 — une échéance `AAAA-MM-JJ` affichée la VEILLE
    // parce que `new Date(chaîne)` est parsé en UTC — est INVISIBLE sous UTC, qui est justement le
    // fuseau des runners CI : le test aurait passé des deux côtés du correctif (revue flotte).
    // Toronto est le fuseau de Marc, et il est à l'ouest de Greenwich : c'est là que ça se voit.
    env: { TZ: 'America/Toronto' },
    // Couverture — portes qualité de l'Atelier (S6, 24/09/2026). Les tests couvrent aussi les
    // fonctions Vercel de ../api (OAuth du MCP, BFF, résumé du hub) : `allowExternal` les compte,
    // sinon la couverture ignorerait tout ce qui vit hors de app/. `npm test` n'est pas touché :
    // la couverture ne tourne que sous `--coverage` (npm run portes).
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: ['**/app/src/**/*.{ts,tsx}', '**/api/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, '**/src/mockData.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  },
});
