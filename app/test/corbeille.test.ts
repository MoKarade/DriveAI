/**
 * corbeille.test.ts — le verdict PUR de l'ADR-0014 (unique exception au §2).
 * Chaque garde est testée : type, vacuité STRICTE, ascendance (échec fermé), noms réservés.
 * L'action réseau (corbeillerDossierVide) ne part que sur verdict vide — vérifié par lecture
 * du code dans aucune-suppression.test.ts (tripwire) ; ici on fige la décision.
 */

import { describe, it, expect } from 'vitest';
import { verdictCorbeille, statutRefusCorbeille } from '../src/corbeille';
import { IDS_STRUCTURELS_DEFAUT } from '../src/garde-fous';
import { MIME_DOSSIER } from '../src/explorateur';

const PROTEGE = 'ID_IMMIGRATION';
const BASE = {
  id: 'ID_ORDINAIRE',
  nom: 'Vieux dossier',
  mimeType: MIME_DOSSIER,
  nbEnfants: 0,
  ascendance: { ids: ['a', 'b'], complete: true },
  racinesProtegees: [PROTEGE],
};

describe('verdictCorbeille (ADR-0014 — dossier VIDE validé, rien d’autre)', () => {
  it('cas nominal : dossier vide, hors zone protégée, nom ordinaire → autorisé', () => {
    expect(verdictCorbeille(BASE)).toEqual([]);
  });

  it('pas un dossier → refus (jamais un fichier)', () => {
    expect(verdictCorbeille({ ...BASE, mimeType: 'application/pdf' })).toContain('pas-un-dossier');
    expect(verdictCorbeille({ ...BASE, mimeType: '' })).toContain('pas-un-dossier');
  });

  it('NON vide (même 1 seul enfant, corbeillé inclus) → refus', () => {
    expect(verdictCorbeille({ ...BASE, nbEnfants: 1 })).toContain('non-vide');
  });

  it('zone protégée dans l’ascendance → refus ; chaîne ILLISIBLE = refus (échec fermé)', () => {
    expect(verdictCorbeille({ ...BASE, ascendance: { ids: ['a', PROTEGE], complete: true } }))
      .toContain('zone-protegee');
    expect(verdictCorbeille({ ...BASE, ascendance: { ids: [], complete: false } }))
      .toContain('zone-protegee');
  });

  it('la racine protégée ELLE-MÊME (par identité — pas dans sa propre ascendance) → refus', () => {
    expect(verdictCorbeille({ ...BASE, id: PROTEGE, nom: 'Immigration (renommée)' }))
      .toContain('zone-protegee');
  });

  it('dossier STRUCTUREL à ID fixe (Logement/Véhicule — routé par ID en dur) → refus', () => {
    expect(verdictCorbeille({ ...BASE, id: IDS_STRUCTURELS_DEFAUT[0], nom: 'Logement' }))
      .toContain('dossier-structurel');
  });

  it('racines système refusées par NOM : préfixe « _ » et « NN · » (00 · files, domaines)', () => {
    expect(verdictCorbeille({ ...BASE, nom: '_Doublons' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: '00 · À trier' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: '04 · Immigration' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: 'Dossier 04 · quelconque' })).toEqual([]); // motif ancré en tête
  });

  it('violations CUMULÉES (un fichier non vide protégé les porte toutes) — insensible à l’ordre', () => {
    const v = verdictCorbeille({
      id: 'x',
      nom: '_Médias',
      mimeType: 'application/pdf',
      nbEnfants: 3,
      ascendance: { ids: [PROTEGE], complete: true },
      racinesProtegees: [PROTEGE],
    });
    expect([...v].sort()).toEqual(['non-vide', 'pas-un-dossier', 'racine-systeme', 'zone-protegee']);
  });
});

/* ---------- C28-93 : un refus classe SA ligne, il n'arrête pas le lot ---------- */

describe('statutRefusCorbeille', () => {
  it('classe chaque refus CONNU, pour que la ligne quitte la liste en disant pourquoi', () => {
    // Le décompte du 13/09 : 124 dossiers proposés, dont un `02 · Finances` EN TÊTE que le verdict
    // refuse par son nom. Le lot s'arrêtait dessus — donc zéro dossier corbeillé, pour 124 proposés.
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : racine-systeme')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : zone-protegee')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : dossier-structurel')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : pas-un-dossier')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : non-vide')).toBe('vide-repris');
    expect(statutRefusCorbeille('Error: Google API 404 : {"error":{"message":"File not found"}}')).toBe('vide-disparu');
  });

  it('ne conclut RIEN sur une panne : la ligne reste candidate et sera re-tentée', () => {
    // Une incertitude ne se transforme pas en verdict — sans ça, un quota d'une minute retirerait
    // définitivement de la liste des dossiers qu'on n'a même pas regardés.
    expect(statutRefusCorbeille('Google est momentanément saturé (quota par minute)')).toBeNull();
    expect(statutRefusCorbeille('Session expirée — reconnecte-toi')).toBeNull();
    expect(statutRefusCorbeille('Google API 500 : backend error')).toBeNull();
    expect(statutRefusCorbeille('TypeError: Failed to fetch')).toBeNull();
    expect(statutRefusCorbeille('')).toBeNull();
  });

  it('aucun statut rendu ne laisse la ligne dans la liste (sinon elle reviendrait à chaque lot)', () => {
    for (const msg of ['racine-systeme', 'non-vide', 'Google API 404']) {
      expect(statutRefusCorbeille(msg)).not.toBe('vide-candidat');
    }
  });
});
