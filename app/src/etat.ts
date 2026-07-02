/**
 * etat.ts — lecture TYPÉE de l'état DriveAI (la Google Sheet) : Santé, Index, Journal, Entités.
 *
 * PUR côté parsing (testé) : les fonctions `interpreter*` transforment des lignes brutes
 * (string[][]) en modèles — aucun appel réseau ici, `charger*` (effectful) vit dans les vues.
 * ADR-0007 : on ne lit que des MÉTADONNÉES (l'état n'a jamais contenu de corps de document).
 */

import { normaliserCle } from './garde-fous';

/* ---------- Santé (onglet lisible, lignes libres) ---------- */

export interface Sante {
  lignes: string[];
}

export function interpreterSante(brut: string[][]): Sante {
  return { lignes: brut.map((l) => l[0] ?? '').filter(Boolean) };
}

/* ---------- Index (catalogue) ---------- */

export interface LigneIndex {
  cle: string;
  traiteLe: string;
  fichier: string;
  domaine: string;
  chemin: string;
  statut: string;
}

export function interpreterIndex(brut: string[][]): LigneIndex[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      traiteLe: l[1] ?? '',
      fichier: l[2] ?? '',
      domaine: l[3] ?? '',
      chemin: l[4] ?? '',
      statut: l[5] ?? '',
    }));
}

/** Compte par domaine (pour le dashboard). */
export function compterParDomaine(lignes: LigneIndex[]): Map<string, number> {
  const compte = new Map<string, number>();
  for (const l of lignes) {
    const d = l.domaine || '—';
    compte.set(d, (compte.get(d) ?? 0) + 1);
  }
  return compte;
}

/* ---------- Journal (dernières activités) ---------- */

export interface LigneJournal {
  date: string;
  niveau: string;
  source: string;
  message: string;
}

export function interpreterJournal(brut: string[][]): LigneJournal[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({ date: l[0] ?? '', niveau: l[1] ?? '', source: l[2] ?? '', message: l[3] ?? '' }));
}

/* ---------- Entités (référentiel — la file de validation 1-clic) ---------- */

export interface LigneEntite {
  ligneSheet: number; // 1-based (en-tête = 1) — pour cibler la cellule Statut à l'écriture
  entite: string;
  domaine: string;
  categorie: string;
  type: string;
  statut: string;
  variante: string;
  dossierId: string; // dossier matérialisé (entité validée) — sert de destination de reclassement
  vuNFois: number;   // fréquence d'observation (#10) — sert au tri de la file de validation
}

export const COLONNES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?'];

/**
 * Interprète l'onglet Entités À PARTIR DE SES EN-TÊTES réels (1ʳᵉ ligne) — miroir de
 * `colonnesEntites_` : l'ordre des colonnes de la Sheet fait foi, jamais un index codé en dur.
 * Renvoie aussi la lettre de colonne du Statut (pour l'écriture 1-clic).
 */
export function interpreterEntites(brut: string[][]): { lignes: LigneEntite[]; colonneStatut: string } {
  if (brut.length === 0) return { lignes: [], colonneStatut: '' };
  const entetes = brut[0];
  const idx = (nom: string) => entetes.indexOf(nom);
  const iStatut = idx('Statut');
  const lignes: LigneEntite[] = [];
  for (let i = 1; i < brut.length; i++) {
    const l = brut[i];
    if (!l[idx('Entité')]) continue;
    lignes.push({
      ligneSheet: i + 1,
      entite: l[idx('Entité')] ?? '',
      domaine: l[idx('Domaine')] ?? '',
      categorie: l[idx('Catégorie')] ?? '',
      type: l[idx('Type')] ?? '',
      statut: normaliserCle(l[iStatut] ?? ''),
      variante: l[idx('Variante possible ?')] ?? '',
      dossierId: l[idx('Dossier ID')] ?? '',
      vuNFois: Number(l[idx('Vu N fois')] ?? '') || 1,
    });
  }
  return { lignes, colonneStatut: lettreColonne(iStatut) };
}

/** Index de colonne (0-based) → lettre A1 (0 → A, 25 → Z, 26 → AA). */
export function lettreColonne(index: number): string {
  if (index < 0) return '';
  let n = index;
  let lettres = '';
  do {
    lettres = String.fromCharCode(65 + (n % 26)) + lettres;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return lettres;
}

export function entitesEnAttente(lignes: LigneEntite[]): LigneEntite[] {
  // Les plus VUES d'abord (#10) : Marc valide en priorité les entités les plus fréquentes.
  return lignes
    .filter((l) => l.statut === 'en attente' || l.statut === 'en_attente')
    .slice()
    .sort((a, b) => b.vuNFois - a.vuNFois);
}

/** Entités validées AVEC dossier matérialisé — destinations proposées au reclassement. */
export function entitesValidees(lignes: LigneEntite[]): LigneEntite[] {
  return lignes.filter((l) => l.statut === 'validee' && l.dossierId);
}

/* ---------- Aides de saisie (pures, testées) ---------- */

/**
 * Extrait l'ÉMETTEUR du nom conventionnel `AAAA…_Type_Émetteur.ext` (3ᵉ segment, sans extension).
 * '' si le nom ne suit pas la convention — le champ reste alors à saisir. Sert à pré-remplir la
 * journalisation Corrections (le few-shot du moteur sélectionne PAR émetteur : sans lui, la
 * correction serait une ligne morte).
 */
export function emetteurDepuisNom(nom: string): string {
  const sansExt = nom.replace(/\.[^.]+$/, '');
  const segments = sansExt.split('_');
  if (segments.length < 3 || !/^\d{4}(-\d{2}){0,2}$/.test(segments[0])) return '';
  return segments.slice(2).join('_');
}

/**
 * Accepte un ID de dossier Drive OU une URL Drive collée telle quelle (« Obtenir le lien »)
 * et renvoie l'ID. '' si rien d'exploitable.
 */
export function extraireIdDossier(texte: string): string {
  const t = texte.trim();
  const url = t.match(/\/folders\/([-\w]+)/);
  if (url) return url[1];
  if (/^[-\w]{20,}$/.test(t)) return t; // un ID Drive brut
  return '';
}

/** Domaines distincts observés dans l'Index (pour la datalist du formulaire — zéro config dupliquée). */
export function domainesDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.domaine).filter(Boolean))).sort();
}

/* ---------- Recherche structurée (C9-07, ADR-0008 §3) — filtres PURS sur l'Index ---------- */

export interface CriteresRecherche {
  texte?: string;   // sous-chaîne (normalisée) du nom de fichier OU du chemin
  domaine?: string; // égalité stricte
  statut?: string;  // égalité stricte (classé, doublon, quarantaine…)
  annee?: string;   // année du DOCUMENT (préfixe AAAA du nom conventionnel), pas du traitement
}

/**
 * Filtre l'Index selon des critères combinés (ET). PUR — zéro appel réseau, zéro ré-indexation :
 * l'Index existant EST la base de recherche (métadonnées seules, ADR-0007).
 */
export function filtrerIndex(lignes: LigneIndex[], criteres: CriteresRecherche): LigneIndex[] {
  const texte = normaliserCle(criteres.texte ?? '');
  return lignes.filter((l) => {
    if (criteres.domaine && l.domaine !== criteres.domaine) return false;
    if (criteres.statut && l.statut !== criteres.statut) return false;
    if (criteres.annee && !l.fichier.startsWith(criteres.annee)) return false;
    if (texte && !normaliserCle(l.fichier).includes(texte) && !normaliserCle(l.chemin).includes(texte)) return false;
    return true;
  });
}

/** Statuts distincts observés (pour le sélecteur). */
export function statutsDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.statut).filter(Boolean))).sort();
}

/** Années de DOCUMENT observées (préfixe AAAA des noms conventionnels), plus récentes d'abord. */
export function anneesDepuisIndex(lignes: LigneIndex[]): string[] {
  const annees = new Set<string>();
  for (const l of lignes) {
    const m = l.fichier.match(/^(\d{4})(-\d{2}){0,2}_/);
    if (m) annees.add(m[1]);
  }
  return Array.from(annees).sort().reverse();
}

/**
 * Extrait le fileId Drive d'une clé d'Index quand elle en porte un : `drive|<id>`,
 * `migre|<tag>|<id>` (le déplacement/renommage préserve l'ID). `shared|<id>` porte l'ID de
 * l'ORIGINAL partagé (pas de la copie classée) et les clés Gmail n'en portent pas → ''.
 */
export function fileIdDepuisCle(cle: string): string {
  const drive = cle.match(/^drive\|(.+)$/);
  if (drive) return drive[1];
  const migre = cle.match(/^migre\|[^|]+\|(.+)$/);
  if (migre) return migre[1];
  return '';
}

/**
 * Lien Drive pour une ligne d'Index : le FICHIER lui-même quand la clé porte son ID, sinon une
 * recherche Drive sur le nom exact (dégradation propre — le nom conventionnel est très discriminant).
 */
export function lienDrivePourLigne(l: LigneIndex): string {
  const id = fileIdDepuisCle(l.cle);
  if (id) return `https://drive.google.com/file/d/${id}/view`;
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(`"${l.fichier}"`)}`;
}
