import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { appliquerTheme, themeCourant } from './theme';
import './styles.css';

// PWA : enregistrement du service worker minimal (installabilité — passe-plat réseau, zéro cache).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* best-effort */ });
}

appliquerTheme(themeCourant());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
