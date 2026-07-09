/**
 * config.ts — configuration de l'app (aucun secret : des IDENTIFIANTS, pas des clés).
 *
 * Deux sources, dans l'ordre : variables Vite (`VITE_*`, figées au build — voie Vercel) puis
 * `localStorage` (écran Configuration — voie « zéro build »). Depuis C28-14 (session durable),
 * le Client ID OAuth n'existe PLUS côté client : l'auth passe par /api/* (fonctions serverless
 * Vercel) et le couple GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET vit dans les variables
 * d'environnement Vercel, jamais dans le navigateur.
 */

export interface ConfigApp {
  spreadsheetId: string;
  webappUrl: string;    // optionnel : URL /exec de la web app Apps Script (« Vérifier maintenant »)
  webappSecret: string; // optionnel : secret partagé (Script Property DriveAI_WEBAPP_SECRET)
}

const CLE_STOCKAGE = 'driveai.config';

export function lireConfig(): ConfigApp {
  const env = import.meta.env ?? {};
  let stockee: Partial<ConfigApp> = {};
  try {
    stockee = JSON.parse(localStorage.getItem(CLE_STOCKAGE) ?? '{}') as Partial<ConfigApp>;
  } catch {
    /* config illisible → repartir de zéro */
  }
  return {
    spreadsheetId: (env.VITE_SPREADSHEET_ID as string) || stockee.spreadsheetId || '',
    webappUrl: (env.VITE_WEBAPP_URL as string) || stockee.webappUrl || '',
    webappSecret: (env.VITE_WEBAPP_SECRET as string) || stockee.webappSecret || '',
  };
}

export function enregistrerConfig(config: ConfigApp): void {
  localStorage.setItem(CLE_STOCKAGE, JSON.stringify(config));
}

export function configComplete(): boolean {
  const c = lireConfig();
  return Boolean(c.spreadsheetId);
}
