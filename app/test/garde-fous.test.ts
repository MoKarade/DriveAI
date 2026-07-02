/**
 * Filet de tests du MIROIR TS des garde-fous (contrainte NON négociable de l'ADR-0008 :
 * l'app mute Drive elle-même ⇒ les garde-fous dupliqués doivent être couverts par des tests).
 * Miroir de : aParentProtege_ strict (Maintenance.gs), normaliserCle_ (Entites.gs), prédicat
 * « déjà rangé » 3 granularités (Maintenance.gs).
 */

import { describe, it, expect } from 'vitest';
import {
  detachementAutorise,
  verdictReclassement,
  normaliserCle,
  nomEstNormalise,
  RACINES_PROTEGEES_DEFAUT,
} from '../src/garde-fous';

const PROTEGE = 'ID_IMMIGRATION';

describe('detachementAutorise (miroir aParentProtege_ strict)', () => {
  it('ancêtre protégé (même profond, multi-parents) → refus', () => {
    expect(detachementAutorise({ ids: ['a', PROTEGE, 'b'], complete: true }, [PROTEGE])).toBe(false);
  });
  it('aucun ancêtre protégé → autorisé', () => {
    expect(detachementAutorise({ ids: ['a', 'b', 'c'], complete: true }, [PROTEGE])).toBe(true);
  });
  it('ascendance INCOMPLÈTE (branche illisible) → refus (échec fermé, comme le strict du moteur)', () => {
    expect(detachementAutorise({ ids: ['a'], complete: false }, [PROTEGE])).toBe(false);
    expect(detachementAutorise({ ids: [], complete: false }, [PROTEGE])).toBe(false);
  });
});

describe('verdictReclassement (point de passage obligé avant toute mutation Drive)', () => {
  it('cas sain → aucune violation', () => {
    expect(
      verdictReclassement({
        ascendanceActuelle: { ids: ['x'], complete: true },
        nouveauNom: '2024-03-05_Facture_Hydro-Québec.pdf',
        racinesProtegees: [PROTEGE],
      }),
    ).toEqual([]);
  });
  it('document en zone protégée → violation zone-protegee (jamais détaché)', () => {
    expect(
      verdictReclassement({
        ascendanceActuelle: { ids: [PROTEGE], complete: true },
        nouveauNom: '2024-03-05_Passeport_IRCC.pdf',
        racinesProtegees: [PROTEGE],
      }),
    ).toContain('zone-protegee');
  });
  it('nom hors convention → violation nom-invalide', () => {
    expect(
      verdictReclassement({
        ascendanceActuelle: { ids: [], complete: true },
        nouveauNom: 'scan sans date.pdf',
        racinesProtegees: [PROTEGE],
      }),
    ).toContain('nom-invalide');
  });
  it('racines par défaut = 04 · Immigration (TAXONOMY)', () => {
    expect(RACINES_PROTEGEES_DEFAUT).toContain('1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC');
  });
});

describe('nomEstNormalise (miroir 3 granularités du nommage par type)', () => {
  it.each([
    ['2024-03-05_Facture_Hydro-Québec.pdf', true],
    ['2024-03_Relevé_Desjardins.pdf', true],
    ['2021_Diplôme_IUT-ULCO.pdf', true],
    ['IMG_2734.jpg', false],
    ['scan.pdf', false],
  ])('%s → %s', (nom, attendu) => {
    expect(nomEstNormalise(nom)).toBe(attendu);
  });
});

describe('normaliserCle (miroir normaliserCle_)', () => {
  it('minuscules, accents, apostrophes, espaces', () => {
    expect(normaliserCle('Éléctricité De France')).toBe('electricite de france');
    expect(normaliserCle("Avis d'imposition")).toBe('avis d imposition');
    expect(normaliserCle('Avis d’imposition')).toBe('avis d imposition');
    expect(normaliserCle('  IRCC  ')).toBe('ircc');
    expect(normaliserCle(null)).toBe('');
  });
});
