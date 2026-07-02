import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// App DriveAI (Phase 4) — SPA statique, AUCUN backend : l'app parle directement aux API Google
// avec le jeton OAuth de l'utilisateur connecté (rien de public, aucun secret embarqué).
// `defineConfig` de vitest/config : type le bloc `test` sans cast.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
