import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// App DriveAI (Phase 4) — SPA statique, AUCUN backend : l'app parle directement aux API Google
// avec le jeton OAuth de l'utilisateur connecté (rien de public, aucun secret embarqué).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
