/**
 * config.ts — configuration de l'app (aucun secret : des IDENTIFIANTS, pas des clés).
 *
 * Deux sources, dans l'ordre : variables Vite (`VITE_*`, figées au build — voie Vercel) puis
 * `localStorage` (écran Configuration — voie « zéro build »). Le Client ID OAuth et l'ID de la
 * Sheet d'état sont des identifiants publics côté client (le Client ID est visible par nature
 * dans toute app OAuth navigateur) ; la sécurité vient du login Google, pas du secret.
 */

export interface ConfigApp {
  clientId: string;
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
    clientId: (env.VITE_GOOGLE_CLIENT_ID as string) || stockee.clientId || '',
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
  return Boolean(c.clientId && c.spreadsheetId);
}
