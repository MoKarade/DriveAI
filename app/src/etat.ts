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
  return lignes.filter((l) => l.statut === 'en attente' || l.statut === 'en_attente');
}
