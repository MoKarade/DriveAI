/**
 * theme.ts — thème de l'app v3 (ADR-0013) : « Salle des machines », sombre d'abord.
 * La bascule claire est un choix persistant ; les tokens vivent dans styles.css
 * (`:root` = sombre, `[data-theme="light"]` = clair) — ici, seulement l'état.
 */

export type Theme = 'sombre' | 'clair';

const CLE = 'driveai.theme';

export function themeCourant(): Theme {
  return (localStorage.getItem(CLE) as Theme) || 'sombre';
}

export function appliquerTheme(t: Theme): void {
  localStorage.setItem(CLE, t);
  document.documentElement.dataset.theme = t === 'clair' ? 'light' : 'dark';
  // La barre système (PWA/mobile) suit le fond de l'app.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'clair' ? '#f4f5f6' : '#0c1118');
}

export function basculerTheme(): Theme {
  const suivant: Theme = themeCourant() === 'sombre' ? 'clair' : 'sombre';
  appliquerTheme(suivant);
  return suivant;
}
