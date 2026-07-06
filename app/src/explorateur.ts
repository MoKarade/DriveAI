/**
 * explorateur.ts — logique PURE de l'explorateur Drive (C21-01, chantier #21).
 *
 * Tout ce qui se calcule sans réseau vit ici et est testé : construction des clauses `q`
 * de l'API Drive (échappement strict — backslash AVANT l'apostrophe, comme `chercherParNom`),
 * tri façon Google Drive (dossiers d'abord), fil d'Ariane, découpage des recherches scopées
 * en lots de parents (les `q` ont une taille bornée ; `in parents` ne voit que les enfants
 * DIRECTS, la portée « dans ce dossier » est donc une liste de sous-dossiers collectée à part).
 */

export const MIME_DOSSIER = 'application/vnd.google-apps.folder';

export interface ElementDrive {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
}

/** Une étape du fil d'Ariane (id de dossier + nom affiché). */
export interface Etape {
  id: string;
  nom: string;
}

/** Échappe une valeur pour une clause `q` Drive — backslash d'abord, sinon `\` réactive le `'`. */
export function echapperQ(texte: string): string {
  return texte.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Enfants directs d'un dossier, corbeille exclue. */
export function qEnfants(dossierId: string): string {
  return `'${echapperQ(dossierId)}' in parents and trashed = false`;
}

/**
 * Recherche comme la barre Google Drive : nom OU plein texte (index natif — ADR-0007, aucun
 * corps stocké par l'app). `parents` (optionnel) borne aux enfants directs de ces dossiers.
 */
export function qRecherche(texte: string, parents?: string[]): string {
  const sain = echapperQ(texte.trim());
  const base = `(name contains '${sain}' or fullText contains '${sain}') and trashed = false`;
  if (!parents || parents.length === 0) return base;
  const clause = parents.map((p) => `'${echapperQ(p)}' in parents`).join(' or ');
  return `${base} and (${clause})`;
}

/** Sous-dossiers d'un lot de parents (sert à la collecte bornée de la portée). */
export function qSousDossiers(parents: string[]): string {
  const clause = parents.map((p) => `'${echapperQ(p)}' in parents`).join(' or ');
  return `(${clause}) and mimeType = '${MIME_DOSSIER}' and trashed = false`;
}

/** Découpe en lots de `taille` (dernier lot plus court). Copie — n'altère jamais l'entrée. */
export function decouperEnLots<T>(items: T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < items.length; i += taille) lots.push(items.slice(i, i + taille));
  return lots;
}

export function estDossier(e: Pick<ElementDrive, 'mimeType'>): boolean {
  return e.mimeType === MIME_DOSSIER;
}

/** Tri façon Google Drive : dossiers d'abord, puis alphabétique insensible (copie défensive). */
export function trierElements(elements: ElementDrive[]): ElementDrive[] {
  return elements.slice().sort((a, b) => {
    const da = estDossier(a) ? 0 : 1;
    const db = estDossier(b) ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base', numeric: true });
  });
}

/** Glyphe par type — dossier, Docs/texte, tableur, présentation, PDF, image, autre. */
export function iconePourMime(mime: string): string {
  if (mime === MIME_DOSSIER) return '📁';
  if (mime === 'application/pdf') return '📕';
  if (mime.startsWith('image/')) return '🖼';
  if (mime.startsWith('video/')) return '🎞';
  if (mime === 'application/vnd.google-apps.spreadsheet' || mime.includes('spreadsheetml')) return '📊';
  if (mime === 'application/vnd.google-apps.presentation' || mime.includes('presentationml')) return '📽';
  if (mime === 'application/vnd.google-apps.document' || mime.startsWith('text/') || mime.includes('wordprocessingml')) return '📄';
  return '📎';
}

/** Entre dans un dossier : nouvelle étape en bout de fil (copie). */
export function pousserEtape(ariane: Etape[], etape: Etape): Etape[] {
  return [...ariane, etape];
}

/** Remonte à une étape du fil (clic sur l'Ariane) : coupe tout ce qui suit. Id inconnu → inchangé. */
export function couperA(ariane: Etape[], id: string): Etape[] {
  const i = ariane.findIndex((e) => e.id === id);
  return i === -1 ? ariane : ariane.slice(0, i + 1);
}

/** Taille lisible (l'API renvoie `size` en chaîne d'octets ; absent pour les fichiers Google). */
export function formaterTaille(size?: string): string {
  const n = Number(size);
  if (!size || !Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/**
 * Le dossier d'arrivée du moteur (`00 · À trier`) — reconnu par NOM normalisé (l'app ne connaît
 * pas son ID). Sert aux parades intake C21-02 : pas de création de dossier dedans (trou noir,
 * l'intake ne descend pas), refus d'y REdéposer un fichier déjà traité (il s'y enliserait).
 */
export function estDossierATrier(nom: string): boolean {
  const n = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n.includes('a trier');
}

/** Date courte (jour) depuis un ISO Drive ; illisible → « — ». */
export function formaterDateCourte(iso?: string, locale = 'fr-CA'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}
