/**
 * google.ts — Auth Google (GIS) + accès Sheets/Drive avec le jeton de l'utilisateur connecté.
 *
 * GARDE-FOU PAR CONSTRUCTION (§2, vérifié par test) : ce module n'expose AUCUNE méthode de
 * suppression (pas de files.delete, pas de trash, pas de deleteRow). Les seules mutations
 * possibles : PATCH nom/parents d'un fichier (déplacement/renommage), écriture de cellules
 * (statut d'entité) et append de lignes (Corrections). Tout déplacement passe par
 * `reclasserFichier`, qui exige un verdict garde-fous VIDE avant d'appeler l'API.
 *
 * Aucun backend : l'app (SPA statique) parle directement aux API Google — le jeton vit en
 * mémoire (jamais persisté), rien n'est stocké côté serveur (ADR-0007 intact).
 */

import {
  Ascendance,
  verdictReclassement,
} from './garde-fous';
import { lireConfig } from './config';

/* ---------- Auth (Google Identity Services) ---------- */

// Périmètre minimal : état (Sheet) en lecture/écriture + Drive (lecture, recherche, PATCH).
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

let jetonAcces: string | null = null; // en mémoire seulement — jamais localStorage

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (rep: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

/** Charge le script GIS une seule fois. */
function chargerGis(): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    if (window.google?.accounts) return resoudre();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resoudre();
    s.onerror = () => rejeter(new Error('Chargement de Google Identity Services impossible'));
    document.head.appendChild(s);
  });
}

/** Ouvre le consentement Google et garde le jeton en mémoire. */
export async function seConnecter(): Promise<void> {
  await chargerGis();
  const { clientId } = lireConfig();
  if (!clientId) throw new Error('Client ID OAuth manquant (écran Configuration)');
  return new Promise((resoudre, rejeter) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (rep) => {
        if (rep.access_token) {
          jetonAcces = rep.access_token;
          resoudre();
        } else {
          rejeter(new Error(rep.error || 'Connexion refusée'));
        }
      },
    });
    client.requestAccessToken();
  });
}

export function estConnecte(): boolean {
  return jetonAcces !== null;
}

export function seDeconnecter(): void {
  jetonAcces = null; // le jeton n'est nulle part ailleurs
}

/* ---------- Appels HTTP (401 → jeton expiré) ---------- */

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  if (!jetonAcces) throw new Error('Non connecté');
  const rep = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${jetonAcces}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (rep.status === 401) {
    jetonAcces = null;
    throw new Error('Session expirée — reconnecte-toi');
  }
  if (!rep.ok) {
    const corps = await rep.text();
    throw new Error(`Google API ${rep.status} : ${corps.slice(0, 200)}`);
  }
  return rep.json() as Promise<T>;
}

/* ---------- Sheets (état DriveAI) ---------- */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Lit une plage (valeurs brutes, lignes de tableaux). */
export async function lirePlage(onglet: string, plage: string): Promise<string[][]> {
  const { spreadsheetId } = lireConfig();
  const r = await api<{ values?: string[][] }>(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!${plage}`)}`,
  );
  return r.values ?? [];
}

/** Écrit UNE cellule (ex. Statut d'une entité → « validée »). */
export async function ecrireCellule(onglet: string, cellule: string, valeur: string): Promise<void> {
  const { spreadsheetId } = lireConfig();
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!${cellule}`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [[valeur]] }) },
  );
}

/** Ajoute une ligne en fin d'onglet (ex. Corrections → few-shot du moteur). */
export async function ajouterLigne(onglet: string, ligne: (string | number)[]): Promise<void> {
  const { spreadsheetId } = lireConfig();
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!A1`)}:append?valueInputOption=RAW`,
    { method: 'POST', body: JSON.stringify({ values: [ligne] }) },
  );
}

/* ---------- Drive (lecture + reclassement SOUS garde-fous) ---------- */

const DRIVE = 'https://www.googleapis.com/drive/v3/files';

export interface FichierDrive {
  id: string;
  name: string;
  parents?: string[];
  webViewLink?: string;
}

export async function lireFichier(fileId: string): Promise<FichierDrive> {
  return api<FichierDrive>(`${DRIVE}/${fileId}?fields=${encodeURIComponent('id,name,parents,webViewLink')}`);
}

/** Recherche Drive par nom (contains). Sert à retrouver le fichier d'une ligne d'Index. */
export async function chercherParNom(nom: string): Promise<FichierDrive[]> {
  // Échappe le backslash AVANT l'apostrophe : sans ça, un nom contenant `\` réactiverait le `'`
  // fermant de la requête (injection de clause — lecture seule, mais autant fermer proprement).
  const sain = nom.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name contains '${sain}' and trashed = false`;
  const r = await api<{ files?: FichierDrive[] }>(
    `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,parents,webViewLink)')}&pageSize=20`,
  );
  return r.files ?? [];
}

/**
 * Remonte TOUTE la chaîne d'ancêtres d'un fichier (multi-parents, borné) — miroir du walk du
 * moteur. Une branche illisible ⇒ `complete: false` (le verdict refusera : échec fermé).
 */
export async function remonterAscendance(fileId: string, profondeurMax = 50): Promise<Ascendance> {
  const vus = new Set<string>();
  let complete = true;
  let front: string[] = [];
  try {
    const f = await lireFichier(fileId);
    front = f.parents ?? [];
  } catch {
    return { ids: [], complete: false };
  }
  let profondeur = 0;
  while (front.length > 0 && profondeur < profondeurMax) {
    const suivant: string[] = [];
    for (const id of front) {
      if (vus.has(id)) continue;
      vus.add(id);
      try {
        const d = await api<{ parents?: string[] }>(`${DRIVE}/${id}?fields=parents`);
        for (const p of d.parents ?? []) suivant.push(p);
      } catch {
        complete = false; // branche illisible → le verdict refusera le détachement
      }
    }
    front = suivant;
    profondeur++;
  }
  if (front.length > 0) complete = false; // profondeur max atteinte sans épuiser
  return { ids: Array.from(vus), complete };
}

/**
 * SEULE mutation Drive de l'app : déplacer + renommer un fichier — après verdict garde-fous VIDE.
 * Jamais de suppression ; le PATCH préserve l'ID (l'idempotence du moteur reste valable).
 * @throws si le verdict n'est pas vide (l'appelant affiche les violations).
 */
export async function reclasserFichier(args: {
  fileId: string;
  nouveauParent: string;
  nouveauNom: string;
  racinesProtegees?: string[];
}): Promise<void> {
  const ascendance = await remonterAscendance(args.fileId);
  const violations = verdictReclassement({
    ascendanceActuelle: ascendance,
    nouveauNom: args.nouveauNom,
    racinesProtegees: args.racinesProtegees,
  });
  if (violations.length > 0) {
    throw new Error(`Reclassement refusé (garde-fous) : ${violations.join(', ')}`);
  }
  const f = await lireFichier(args.fileId);
  const anciens = (f.parents ?? []).join(',');
  const params = new URLSearchParams({ addParents: args.nouveauParent, fields: 'id' });
  if (anciens) params.set('removeParents', anciens);
  await api(`${DRIVE}/${args.fileId}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: args.nouveauNom }),
  });
}
