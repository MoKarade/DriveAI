/**
 * google.ts — Auth Google (GIS) + accès Sheets/Drive avec le jeton de l'utilisateur connecté.
 *
 * GARDE-FOU PAR CONSTRUCTION (§2, vérifié par test) : ce module n'expose AUCUNE méthode de
 * suppression (ni définitive, ni corbeille, ni deleteRow — l'unique exception ADR-0014 vit
 * dans corbeille.ts, jamais ici). Les seules mutations
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
  RACINES_PROTEGEES_DEFAUT,
} from './garde-fous';
import {
  ElementDrive,
  MIME_DOSSIER,
  qEnfants,
  qRecherche,
  qSousDossiers,
  decouperEnLots,
  estDossierATrier,
} from './explorateur';
import { lireConfig } from './config';
import { plageMock, ENFANTS_MOCK, TACHES_MOCK, EVENEMENTS_MOCK } from './mockData';

/* ---------- Mode E2E MOCK (captures d'écran CI) ---------- */

// `VITE_E2E_MOCK` n'est posée QUE par playwright.config.ts (serveur de dev CI) — jamais dans un
// build Vercel ni en local normal. Variable Vite figée au BUILD : en production la condition est
// une constante `false` (branches mortes, aucune fuite possible). Sous ce mode : auth bouchonnée,
// lectures Sheets/Drive/Tasks/Calendar servies par mockData.ts, et TOUT appel réseau résiduel
// échoue BRUYAMMENT (api() lève) — un chemin non bouchonné se voit sur la capture au lieu de
// taper les vraies API Google.
const MODE_MOCK = import.meta.env.VITE_E2E_MOCK === 'true';

/* ---------- Auth (Google Identity Services) ---------- */

// Périmètre : état (Sheet) RW + Drive (lecture, recherche, PATCH) + — révision Marc 2026-07-06
// (ADR-0013, vue Agenda) — Tasks/Calendar : l'app CRÉE et COCHE, ne supprime NI n'annule jamais
// (verrou : test miroir aucune-suppression). Consentement navigateur seul (rien côté Apps Script).
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events';

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
  if (MODE_MOCK) { jetonAcces = 'jeton-mock-e2e'; return; } // jamais de GIS ni de popup en CI
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
  if (MODE_MOCK) return true; // l'app saute l'écran de connexion (les vues lisent mockData)
  return jetonAcces !== null;
}

export function seDeconnecter(): void {
  jetonAcces = null; // le jeton n'est nulle part ailleurs
}

// Rappel global « session expirée » : l'UI s'y abonne pour rebasculer sur l'écran de connexion
// (les jetons GIS expirent en ~1 h — sans ça, l'app resterait figée sur des vues qui échouent).
let surSessionExpiree: (() => void) | null = null;
export function abonnerSessionExpiree(cb: () => void): void {
  surSessionExpiree = cb;
}

/* ---------- Appels HTTP (401 → jeton expiré) ---------- */

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  // Filet du mode mock : AUCUN appel réseau ne doit atteindre les vraies API Google en CI.
  // Un chemin oublié échoue bruyamment (visible sur la capture) au lieu de fuiter.
  if (MODE_MOCK) throw new Error(`mode E2E mock : appel réseau interdit (${url.slice(0, 80)})`);
  if (!jetonAcces) throw new Error('Non connecté');
  // 429 (quota par minute PARTAGÉ avec le moteur — il écrit dans la même Sheet, en tant que Marc) :
  // réessai avec repli progressif au lieu d'une erreur brute. Un 429 = requête NON exécutée → le
  // réessai est sûr, y compris pour les écritures.
  for (let essai = 0; ; essai++) {
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
      surSessionExpiree?.(); // l'UI rebascule sur l'écran de connexion
      throw new Error('Session expirée — reconnecte-toi');
    }
    if (rep.status === 429 && essai < 3) {
      const attente = Number(rep.headers.get('Retry-After')) * 1000 || 1500 * 2 ** essai;
      await new Promise((r) => setTimeout(r, attente + Math.random() * 400));
      continue;
    }
    if (rep.status === 429) {
      throw new Error('Google est momentanément saturé (quota par minute) — réessaie dans quelques secondes.');
    }
    if (!rep.ok) {
      const corps = await rep.text();
      throw new Error(`Google API ${rep.status} : ${corps.slice(0, 200)}`);
    }
    return rep.json() as Promise<T>;
  }
}

/* ---------- Sheets (état DriveAI) ---------- */

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

// Cache de LECTURE (60 s) : changer d'onglet ne recharge pas tout — les vues repartagent la même
// photo de l'état (le moteur n'écrit que par ticks de 5 min ; les écritures de l'APP l'invalident).
const cachePlages = new Map<string, { t: number; donnees: string[][] }>();
const CACHE_MS = 60 * 1000;

export function viderCachePlages(): void {
  cachePlages.clear();
  cacheDossiers.clear(); // les listages Drive suivent le même cycle de vie (C21-01)
  cachePortee.clear();
}

/** Lit une plage (valeurs brutes, lignes de tableaux). */
export async function lirePlage(onglet: string, plage: string): Promise<string[][]> {
  const cle = `${onglet}!${plage}`;
  const memo = cachePlages.get(cle);
  if (memo && Date.now() - memo.t < CACHE_MS) return memo.donnees;
  const donnees = await lirePlageDirecte(onglet, plage);
  cachePlages.set(cle, { t: Date.now(), donnees });
  return donnees;
}

async function lirePlageDirecte(onglet: string, plage: string): Promise<string[][]> {
  if (MODE_MOCK) return plageMock(onglet, plage);
  const { spreadsheetId } = lireConfig();
  const r = await api<{ values?: string[][] }>(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!${plage}`)}`,
  );
  return r.values ?? [];
}

/** Écrit UNE cellule (ex. Statut d'une entité → « validée »). */
export async function ecrireCellule(onglet: string, cellule: string, valeur: string): Promise<void> {
  viderCachePlages(); // l'état vient de changer — les vues doivent relire
  const { spreadsheetId } = lireConfig();
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!${cellule}`)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [[valeur]] }) },
  );
}

/**
 * Écrit une PLAGE CONTIGUË d'une même colonne (ex. Statuts F3:F7) — UN PUT par plage, jamais de
 * batchUpdate (motif interdit §2) ; l'appelant découpe via `plagesContigues` pour ne JAMAIS
 * toucher une ligne non sélectionnée.
 */
export async function ecrireColonnePlage(
  onglet: string,
  colonne: string,
  debut: number,
  valeurs: string[],
): Promise<void> {
  if (valeurs.length === 0) return;
  viderCachePlages();
  const { spreadsheetId } = lireConfig();
  const plage = `${onglet}!${colonne}${debut}:${colonne}${debut + valeurs.length - 1}`;
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(plage)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: valeurs.map((v) => [v]) }) },
  );
}

/** Ajoute une ligne en fin d'onglet (ex. Corrections → few-shot du moteur). */
export async function ajouterLigne(onglet: string, ligne: (string | number)[]): Promise<void> {
  viderCachePlages();
  const { spreadsheetId } = lireConfig();
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(`${onglet}!A1`)}:append?valueInputOption=RAW`,
    { method: 'POST', body: JSON.stringify({ values: [ligne] }) },
  );
}

/* ---------- Drive (lecture + reclassement SOUS garde-fous) ---------- */

export const DRIVE = 'https://www.googleapis.com/drive/v3/files';

export interface FichierDrive {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  webViewLink?: string;
}

export async function lireFichier(fileId: string): Promise<FichierDrive> {
  return api<FichierDrive>(`${DRIVE}/${fileId}?fields=${encodeURIComponent('id,name,mimeType,parents,webViewLink')}`);
}

// L'alias `'root'` n'apparaît JAMAIS dans `parents` (l'API y met l'ID réel) : résolu une fois
// pour que les comparaisons/PATCH de déplacement soient justes (sinon add+remove du même dossier).
let idRacineReel: string | null = null;
async function resoudreRacine(): Promise<string> {
  if (idRacineReel) return idRacineReel;
  const r = await api<{ id: string }>(`${DRIVE}/root?fields=id`);
  idRacineReel = r.id;
  return r.id;
}

/** Recherche Drive par nom (contains). Sert à retrouver le fichier d'une ligne d'Index. */
export async function chercherParNom(nom: string): Promise<FichierDrive[]> {
  // Échappe le backslash AVANT l'apostrophe : sans ça, un nom contenant `\` réactiverait le `'`
  // fermant de la requête (injection de clause — lecture seule, mais autant fermer proprement).
  // Exclut les DOSSIERS : on reclasse des documents, jamais un dossier entier par mégarde.
  const sain = nom.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name contains '${sain}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const r = await api<{ files?: FichierDrive[] }>(
    `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,parents,webViewLink)')}&pageSize=20`,
  );
  return r.files ?? [];
}

/**
 * Recherche PLEIN TEXTE déléguée à l'index natif de Drive (`fullText contains`) — on cherche DANS
 * le contenu des documents sans que DriveAI ne stocke aucun corps (ADR-0007 : pas d'index plein
 * texte propre à l'app). Lecture seule, dossiers exclus.
 */
export async function rechercheFullText(texte: string): Promise<FichierDrive[]> {
  const sain = texte.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `fullText contains '${sain}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const r = await api<{ files?: FichierDrive[] }>(
    `${DRIVE}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,webViewLink)')}&pageSize=25`,
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
  // La cible est RETIRÉE de removeParents : déjà dans le bon dossier (ex. re-clic après un échec
  // de journalisation) ⇒ renommage seul — jamais un add+remove ambigu du même parent.
  const anciens = (f.parents ?? []).filter((p) => p !== args.nouveauParent).join(',');
  const dejaEnPlace = (f.parents ?? []).includes(args.nouveauParent);
  const params = new URLSearchParams({ fields: 'id' });
  if (!dejaEnPlace) params.set('addParents', args.nouveauParent);
  if (anciens) params.set('removeParents', anciens);
  await api(`${DRIVE}/${args.fileId}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: args.nouveauNom }),
  });
}

/**
 * Journalise une correction dans l'onglet `Corrections` EN SUIVANT SES EN-TÊTES RÉELS (miroir de
 * `colonnesCorrections_` du moteur — jamais un ordre supposé). L'ÉMETTEUR et le DOMAINE sont
 * indispensables : le few-shot du moteur sélectionne par émetteur et saute les lignes sans
 * domaine/entité — sans eux, la ligne serait morte.
 */
export async function journaliserCorrection(c: {
  fichier: string;
  emetteur: string;
  domaine: string;
  entite?: string;
}): Promise<void> {
  const ORDRE_DEFAUT = ['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le'];
  let entetes: string[] = [];
  try {
    entetes = (await lirePlage('Corrections', 'A1:Z1'))[0] ?? [];
  } catch {
    /* onglet illisible → ordre par défaut (celui que le moteur crée) */
  }
  if (entetes.length === 0) entetes = ORDRE_DEFAUT;
  const valeurs: Record<string, string> = {
    Fichier: c.fichier,
    'Émetteur': c.emetteur,
    Domaine: c.domaine,
    'Entité': c.entite ?? '',
    'Corrigé le': new Date().toISOString(),
  };
  const ligne = entetes.map((e) => valeurs[e] ?? '');
  await ajouterLigne('Corrections', ligne);
}

/* ---------- Agenda (C19-05, ADR-0013) : Calendar + Tasks — création & coche SEULES ---------- */

const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TASKS = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

/** Événements de l'agenda PRIMAIRE entre deux instants (occurrences dépliées, ordre chronologique). */
export async function listerEvenements(timeMinISO: string, timeMaxISO: string): Promise<unknown[]> {
  if (MODE_MOCK) return EVENEMENTS_MOCK;
  const url = `${CALENDAR}?singleEvents=true&orderBy=startTime&maxResults=250` +
    `&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
  const rep = await api<{ items?: unknown[] }>(url);
  return rep.items ?? [];
}

/** Tâches de la liste par défaut (ouvertes + faites — le tri vit dans agenda.ts). */
export async function listerTaches(): Promise<unknown[]> {
  if (MODE_MOCK) return TACHES_MOCK;
  const rep = await api<{ items?: unknown[] }>(`${TASKS}?maxResults=100&showCompleted=true&showHidden=true`);
  return rep.items ?? [];
}

/** Crée une tâche (liste par défaut). `echeance` : AAAA-MM-JJ (optionnel). */
export async function creerTache(titre: string, echeance?: string): Promise<void> {
  await api(TASKS, {
    method: 'POST',
    body: JSON.stringify({ title: titre, ...(echeance ? { due: `${echeance}T00:00:00.000Z` } : {}) }),
  });
}

/** Crée un RDV d'une heure sur l'agenda primaire. `debutISO` : date-heure locale ISO. */
export async function creerEvenement(titre: string, debutISO: string): Promise<void> {
  const debut = new Date(debutISO);
  const fin = new Date(debut.getTime() + 60 * 60 * 1000);
  await api(CALENDAR, {
    method: 'POST',
    body: JSON.stringify({
      summary: titre,
      start: { dateTime: debut.toISOString() },
      end: { dateTime: fin.toISOString() },
    }),
  });
}

/**
 * Coche/décoche une tâche — PATCH du champ `status` UNIQUEMENT (jamais de DELETE : garde-fou §2 ;
 * décocher est le chemin d'annulation réversible).
 */
export async function cocherTache(id: string, faite: boolean): Promise<void> {
  await api(`${TASKS}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: faite ? 'completed' : 'needsAction' }),
  });
}

/* ---------- Explorateur Drive (C21-01) : navigation + recherche scopée — LECTURE SEULE ---------- */

const CHAMPS_ELEMENT = 'id,name,mimeType,modifiedTime,size,webViewLink';

export interface PageDrive {
  elements: ElementDrive[];
  suivant?: string; // nextPageToken — présent s'il reste des éléments
}

// Cache 60 s des listages de dossiers (même logique que cachePlages : navigation fluide,
// invalidé par toute écriture de l'app via viderCachePlages).
const cacheDossiers = new Map<string, { t: number; page: PageDrive }>();

/** Enfants directs d'un dossier (`'root'` = racine Mon Drive), triés dossiers d'abord côté API. */
export async function listerEnfants(dossierId: string, pageToken?: string): Promise<PageDrive> {
  if (MODE_MOCK) return { elements: (ENFANTS_MOCK[dossierId] ?? []) as ElementDrive[] };
  const cle = `${dossierId}|${pageToken ?? ''}`;
  const memo = cacheDossiers.get(cle);
  if (memo && Date.now() - memo.t < CACHE_MS) return memo.page;
  const params = new URLSearchParams({
    q: qEnfants(dossierId),
    orderBy: 'folder,name',
    pageSize: '100',
    fields: `nextPageToken,files(${CHAMPS_ELEMENT})`,
  });
  if (pageToken) params.set('pageToken', pageToken);
  const r = await api<{ files?: ElementDrive[]; nextPageToken?: string }>(`${DRIVE}?${params.toString()}`);
  const page = { elements: r.files ?? [], suivant: r.nextPageToken };
  cacheDossiers.set(cle, { t: Date.now(), page });
  return page;
}

/**
 * Collecte BORNÉE des sous-dossiers d'une racine (BFS, multi-parents dédoublonnés) — la portée
 * « dans ce dossier » de la recherche : `in parents` ne voit que les enfants DIRECTS, il faut
 * donc énumérer les descendants. Plafond dur (quota + taille de `q`) ; `tronque` le signale
 * honnêtement à l'UI au lieu de laisser croire à une couverture complète.
 */
const cachePortee = new Map<string, { t: number; portee: { ids: string[]; tronque: boolean } }>();

export async function collecterSousDossiers(
  racineId: string,
  plafond = 80,
): Promise<{ ids: string[]; tronque: boolean }> {
  // Mémoïsée 60 s : chaque Enter dans le même dossier ne re-paye pas la collecte (jusqu'à
  // ~plafond appels au pire sur une arborescence très profonde).
  const memo = cachePortee.get(racineId);
  if (memo && Date.now() - memo.t < CACHE_MS) return memo.portee;
  const ids = [racineId];
  let front = [racineId];
  let tronque = false;
  while (front.length > 0 && !tronque) {
    const decouverts: string[] = [];
    for (const lot of decouperEnLots(front, 10)) {
      const params = new URLSearchParams({
        q: qSousDossiers(lot),
        fields: 'files(id)',
        pageSize: '100',
      });
      const r = await api<{ files?: { id: string }[] }>(`${DRIVE}?${params.toString()}`);
      const fichiers = r.files ?? [];
      // Page PLEINE sans lire nextPageToken = couverture non garantie → dit honnêtement.
      if (fichiers.length >= 100) tronque = true;
      for (const f of fichiers) decouverts.push(f.id);
    }
    const ajoutes: string[] = [];
    for (const id of decouverts) {
      if (ids.length >= plafond) {
        tronque = true;
        break;
      }
      if (!ids.includes(id)) {
        ids.push(id);
        ajoutes.push(id);
      }
    }
    front = ajoutes;
  }
  const portee = { ids, tronque };
  cachePortee.set(racineId, { t: Date.now(), portee });
  return portee;
}

/**
 * Recherche façon barre Google Drive (nom OU plein texte natif). `portee` (liste de dossiers,
 * cf. `collecterSousDossiers`) découpe en lots — fusion dédoublonnée par id.
 */
export async function rechercherDrive(texte: string, portee?: string[]): Promise<ElementDrive[]> {
  const lots: (string[] | undefined)[] =
    portee && portee.length > 0 ? decouperEnLots(portee, 10) : [undefined];
  const vus = new Map<string, ElementDrive>();
  for (const lot of lots) {
    const params = new URLSearchParams({
      q: qRecherche(texte, lot),
      fields: `files(${CHAMPS_ELEMENT})`,
      pageSize: '50',
    });
    const r = await api<{ files?: ElementDrive[] }>(`${DRIVE}?${params.toString()}`);
    for (const f of r.files ?? []) vus.set(f.id, f);
  }
  return Array.from(vus.values());
}

/* ---------- Explorateur (C21-02) : création de dossier + déplacement MANUEL ---------- */

/**
 * Crée un dossier (création seule — l'inverse, la suppression, n'existe pas dans cette app ;
 * la corbeille des dossiers VIDES validée arrive en C21-07 sous ADR-0014). Nom libre : les
 * dossiers (entités, sous-dossiers) ne suivent pas la convention datée des fichiers.
 */
export async function creerDossier(nom: string, parentId: string): Promise<ElementDrive> {
  const propre = nom.trim();
  if (!propre) throw new Error('Nom de dossier vide');
  viderCachePlages();
  return api<ElementDrive>(`${DRIVE}?fields=${encodeURIComponent(CHAMPS_ELEMENT)}`, {
    method: 'POST',
    body: JSON.stringify({
      name: propre,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
}

/** L'Index (colonne Clé) contient-il cette clé ? Lecture d'une colonne, cache 60 s. */
export async function indexContientCle(cle: string): Promise<boolean> {
  const colonne = await lirePlage('Index', 'A2:A30000');
  return colonne.some((l) => (l[0] ?? '') === cle);
}

/**
 * Déplacement MANUEL d'un FICHIER (drag-and-drop de Marc, C21-02) : nom CONSERVÉ — le verdict
 * garde-fous tourne en mode `deplacementSeul` (la règle de nom ne s'applique pas ; la zone
 * protégée reste inconditionnelle : jamais détaché de 04 · Immigration, échec fermé si
 * l'ascendance est illisible). Les DOSSIERS ne se déplacent JAMAIS ici (réorg de masse =
 * moteur) — refus par mimeType, défense en profondeur contre un payload de drag forgé.
 *
 * Parades intake (revue file-checker) : REdéposer dans `00 · À trier` un fichier déjà traité
 * est refusé (il s'y enliserait en silence — l'idempotence du moteur l'ignore) ; un placement
 * manuel ailleurs est ENTÉRINÉ par une ligne Index `drive|fileId` statut `manuel` (le grand
 * rangement ne re-collectera pas le fichier — même skip que pour un média sorti de `_Médias`).
 *
 * @param nomCible nom du dossier cible (détection « À trier » — l'app n'a pas son ID)
 * @returns true si un déplacement a eu lieu, false si le fichier était déjà en place.
 * @throws si le verdict n'est pas vide (l'appelant affiche les violations).
 */
export async function deplacerFichierManuel(args: {
  fileId: string;
  nouveauParent: string;
  nomCible?: string;
  racinesProtegees?: string[];
}): Promise<boolean> {
  const f = await lireFichier(args.fileId);
  const proteges = args.racinesProtegees ?? RACINES_PROTEGEES_DEFAUT;
  if (f.mimeType === MIME_DOSSIER || proteges.includes(args.fileId)) {
    throw new Error('Déplacement refusé : seuls les FICHIERS se déplacent ici (dossiers : réorg à venir)');
  }
  const ascendance = await remonterAscendance(args.fileId);
  const violations = verdictReclassement({
    ascendanceActuelle: ascendance,
    deplacementSeul: true,
    racinesProtegees: args.racinesProtegees,
  });
  if (violations.length > 0) {
    throw new Error(`Déplacement refusé (garde-fous) : ${violations.join(', ')}`);
  }
  const cleIndex = `drive|${args.fileId}`;
  const dejaIndexe = await indexContientCle(cleIndex).catch(() => false);
  const cibleATrier = estDossierATrier(args.nomCible ?? '');
  if (cibleATrier && dejaIndexe) {
    throw new Error('Déjà traité par DriveAI — redéposer dans « À trier » n’aurait aucun effet. Passe par Apprentissage → Reclasser.');
  }
  // `'root'` est un alias : jamais présent dans f.parents — résolu avant toute comparaison.
  const cible = args.nouveauParent === 'root' ? await resoudreRacine() : args.nouveauParent;
  // Même logique anti-ambiguïté que reclasserFichier : cible retirée de removeParents.
  const anciens = (f.parents ?? []).filter((p) => p !== cible).join(',');
  const dejaEnPlace = (f.parents ?? []).includes(cible);
  if (dejaEnPlace && !anciens) return false; // déjà exactement là — no-op
  viderCachePlages();
  const params = new URLSearchParams({ fields: 'id' });
  if (!dejaEnPlace) params.set('addParents', cible);
  if (anciens) params.set('removeParents', anciens);
  await api(`${DRIVE}/${args.fileId}?${params.toString()}`, { method: 'PATCH', body: '{}' });
  // Entérine le geste dans l'Index (sauf vers À trier : là, le fichier DOIT être traité).
  if (!cibleATrier && !dejaIndexe) {
    try {
      await ajouterLigneIndexManuelle_(cleIndex, f.name);
    } catch { /* best-effort — le rangement pourra re-collecter, jamais pire qu'avant */ }
  }
  // Trace best-effort au Journal (le moteur y écrit pareil) — l'échec n'annule pas le geste.
  try {
    await ajouterLigne('Journal', [
      new Date().toISOString(),
      'INFO',
      'App',
      `Déplacement manuel : « ${f.name} » (${args.fileId})`,
    ]);
  } catch { /* trace seulement */ }
  return true;
}

/** Ligne Index d'un placement manuel — EN SUIVANT LES EN-TÊTES RÉELS (miroir de Journal.gs). */
async function ajouterLigneIndexManuelle_(cle: string, nom: string): Promise<void> {
  const ORDRE_DEFAUT = ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance'];
  let entetes: string[] = [];
  try {
    entetes = (await lirePlage('Index', 'A1:H1'))[0] ?? [];
  } catch { /* onglet illisible → ordre par défaut (celui que le moteur crée) */ }
  if (entetes.length === 0) entetes = ORDRE_DEFAUT;
  const valeurs: Record<string, string> = {
    'Clé': cle,
    'Traité le': new Date().toISOString(),
    Fichier: nom,
    Statut: 'manuel',
  };
  await ajouterLigne('Index', entetes.map((e) => valeurs[e] ?? ''));
}

/* ---------- « Vérifier maintenant » (#20) : pont vers la web app Apps Script ---------- */

/**
 * Demande un passage IMMÉDIAT du moteur (doPost Apps Script, secret partagé). Appel en `no-cors` :
 * la réponse est opaque (on ne lit rien) — le moteur journalise et l'anti-rafale (60 s) vit côté
 * script. Lève seulement si la config manque ou si le réseau échoue.
 */
export async function verifierMaintenant(): Promise<void> {
  const { webappUrl, webappSecret } = lireConfig();
  if (!webappUrl || !webappSecret) throw new Error('Configurer l’URL de la web app et son secret (⚙)');
  await fetch(`${webappUrl}?secret=${encodeURIComponent(webappSecret)}`, { method: 'POST', mode: 'no-cors' });
}

/* ---------- Recherche IA (C21-03) : question libre → plan de recherche ---------- */

/** Plan renvoyé par le moteur — déjà WHITELISTÉ côté Apps Script (parserPlanIA_). */
export interface PlanRechercheIA {
  texte?: string;
  domaine?: string;
  annee?: string;
  motsCles?: string[];
  explication?: string;
}

/**
 * Traduit une question libre en plan de recherche via le doPost du moteur (la clé Anthropic
 * reste dans les Script Properties — l'app ne parle JAMAIS à l'API Anthropic). Contrairement à
 * `verifierMaintenant`, la réponse est LUE : POST en Content-Type text/plain = requête
 * « simple » (pas de préflight), à laquelle Apps Script répond avec un CORS lisible.
 * La question voyage dans le CORPS (jamais l'URL — les URL finissent dans des logs).
 */
export async function rechercheIA(question: string): Promise<PlanRechercheIA> {
  const { webappUrl, webappSecret } = lireConfig();
  if (!webappUrl || !webappSecret) throw new Error('Configurer l’URL de la web app et son secret (⚙)');
  const rep = await fetch(`${webappUrl}?secret=${encodeURIComponent(webappSecret)}&action=recherche-ia`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ question }),
  });
  if (!rep.ok) throw new Error(`Web app ${rep.status}`);
  let data: { ok: boolean; erreur?: string; plan?: PlanRechercheIA };
  try {
    data = await rep.json();
  } catch {
    // Une web app mal déployée renvoie une page HTML en 200 (piège de VERSION — DEPLOIEMENT.md).
    throw new Error('Réponse illisible — la web app a-t-elle été redéployée en nouvelle version ?');
  }
  if (!data.ok || !data.plan) throw new Error(data.erreur || 'recherche IA indisponible');
  return data.plan;
}
