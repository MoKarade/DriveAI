/**
 * config.ts — configuration de l'app, servie par le SERVEUR (C28-20, ADR-0021).
 *
 * « Zéro configuration client » : plus de localStorage, plus d'écran de saisie, plus de
 * variables VITE_*. L'ID de la Sheet, l'URL et le secret de la web app vivent dans les
 * variables d'environnement Vercel (SPREADSHEET_ID / WEBAPP_URL / WEBAPP_SECRET) et sont
 * délivrés par /api/config à une session VALIDE — le cookie HttpOnly n'est posé par
 * /api/callback qu'après le verrou d'identité ALLOWED_EMAIL. Marc se connecte, c'est tout.
 */

export interface ConfigApp {
  spreadsheetId: string;
  webappUrl: string;    // URL /exec de la web app Apps Script (« Vérifier maintenant »)
  webappSecret: string; // secret partagé (Script Property DriveAI_WEBAPP_SECRET)
}

// Mode E2E mock (même variable que google.ts) : aucun fetch /api/* en CI, config factice.
const MODE_MOCK = import.meta.env.VITE_E2E_MOCK === 'true';
const CONFIG_MOCK: ConfigApp = { spreadsheetId: 'mock-spreadsheet-id', webappUrl: '', webappSecret: '' };

// Portée MODULE, jamais persistée : la config meurt avec l'onglet et revient au chargement
// suivant par /api/config — il n'y a rien à stocker côté client (ni jeton, ni identifiant).
let configMemoire: ConfigApp | null = null;

/**
 * Config courante — disponible UNIQUEMENT après `chargerConfigServeur()` (séquencée par
 * App.tsx avant d'afficher les vues). Lever plutôt que retourner du vide : un appel avant
 * chargement est un bug d'ordre d'initialisation, pas un état normal.
 */
export function lireConfig(): ConfigApp {
  if (MODE_MOCK) return CONFIG_MOCK;
  if (!configMemoire) throw new Error('Configuration non chargée — connexion requise');
  return configMemoire;
}

/**
 * Charge la config depuis /api/config (session prouvée par le cookie HttpOnly, envoyé
 * automatiquement en même-site). `false` = pas de session valide ou serveur incomplet —
 * l'app reste sur l'écran de connexion au lieu d'afficher des vues qui échoueraient.
 */
export async function chargerConfigServeur(): Promise<boolean> {
  if (MODE_MOCK) return true;
  if (configMemoire) return true;
  try {
    const rep = await fetch('/api/config');
    if (!rep.ok) return false;
    const corps = (await rep.json()) as Partial<ConfigApp>;
    if (!corps.spreadsheetId) return false;
    configMemoire = {
      spreadsheetId: corps.spreadsheetId,
      webappUrl: corps.webappUrl ?? '',
      webappSecret: corps.webappSecret ?? '',
    };
    return true;
  } catch {
    return false; // réseau coupé : même traitement que « pas de session »
  }
}
