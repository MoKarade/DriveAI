/**
 * Parsers de l'état (etat.ts) : interprétation des lignes Sheet PAR EN-TÊTES réels
 * (jamais d'index en dur — miroir de colonnesEntites_), file « en attente », colonne A1.
 */

import { describe, it, expect } from 'vitest';
import {
  interpreterEntites,
  entitesEnAttente,
  lettreColonne,
  interpreterIndex,
  compterParDomaine,
} from '../src/etat';

const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?'];

describe('interpreterEntites', () => {
  it('lit par en-têtes réels et repère la colonne Statut', () => {
    const { lignes, colonneStatut } = interpreterEntites([
      ENTETES,
      ['EDF', '03 · Logement & véhicule', '', 'Logement', 'en_attente', '', '2026-07-01', ''],
      ['Desjardins', '02 · Finances', '', 'Compte financier', 'validée', 'xyz', '2026-06-01', ''],
    ]);
    expect(colonneStatut).toBe('E');
    expect(lignes).toHaveLength(2);
    expect(lignes[0].ligneSheet).toBe(2); // 1-based, en-tête = ligne 1
    expect(lignes[0].statut).toBe('en_attente');
    expect(lignes[1].statut).toBe('validee'); // normalisé (accents)
  });

  it('ordre de colonnes DIFFÉRENT de la constante → suit les en-têtes (auto-réparation Sheet)', () => {
    const { lignes, colonneStatut } = interpreterEntites([
      ['Statut', 'Entité', 'Domaine'],
      ['en_attente', 'IUT ULCO', '05 · Carrière'],
    ]);
    expect(colonneStatut).toBe('A');
    expect(lignes[0].entite).toBe('IUT ULCO');
  });

  it('entitesEnAttente filtre les seules en_attente', () => {
    const { lignes } = interpreterEntites([
      ENTETES,
      ['A', 'd', '', '', 'en_attente', '', '', ''],
      ['B', 'd', '', '', 'validée', '', '', ''],
      ['C', 'd', '', '', 'refusée', '', '', ''],
    ]);
    expect(entitesEnAttente(lignes).map((l) => l.entite)).toEqual(['A']);
  });
});

describe('lettreColonne', () => {
  it.each([
    [0, 'A'],
    [4, 'E'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
  ])('%i → %s', (i, attendu) => {
    expect(lettreColonne(i)).toBe(attendu);
  });
});

describe('interpreterIndex + compterParDomaine', () => {
  it('compte les documents par domaine', () => {
    const lignes = interpreterIndex([
      ['k1', '2026-01-01', 'a.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k2', '2026-01-02', 'b.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k3', '2026-01-03', 'c.pdf', '03 · Logement & véhicule', 'chemin', 'classé'],
      ['', '', '', '', '', ''], // ligne vide ignorée
    ]);
    expect(lignes).toHaveLength(3);
    const compte = compterParDomaine(lignes);
    expect(compte.get('02 · Finances')).toBe(2);
    expect(compte.get('03 · Logement & véhicule')).toBe(1);
  });
});
