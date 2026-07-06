/**
 * explorateur.test.ts — logique pure de l'explorateur Drive (C21-01).
 * Les clauses `q` sont de la construction de requête sur donnée UTILISATEUR : l'échappement
 * est testé au caractère près (backslash AVANT l'apostrophe — même piège que chercherParNom).
 */

import { describe, it, expect } from 'vitest';
import {
  MIME_DOSSIER,
  echapperQ,
  qEnfants,
  qRecherche,
  qSousDossiers,
  decouperEnLots,
  estDossier,
  estDossierATrier,
  trierElements,
  iconePourMime,
  pousserEtape,
  couperA,
  formaterTaille,
  formaterDateCourte,
  ElementDrive,
} from '../src/explorateur';

const el = (name: string, mimeType = 'application/pdf', extra: Partial<ElementDrive> = {}): ElementDrive =>
  ({ id: name, name, mimeType, ...extra });

describe('echapperQ — injection de clause fermée', () => {
  it('échappe le backslash AVANT l’apostrophe (l’ordre inverse ré-ouvre le quote)', () => {
    expect(echapperQ("l'été")).toBe("l\\'été");
    expect(echapperQ('a\\b')).toBe('a\\\\b');
    // Le cas piège : `\'` brut doit devenir `\\\'` (backslash neutralisé PUIS apostrophe échappée).
    expect(echapperQ("a\\'b")).toBe("a\\\\\\'b");
  });
});

describe('clauses q', () => {
  it('qEnfants : enfants directs, corbeille exclue', () => {
    expect(qEnfants('root')).toBe("'root' in parents and trashed = false");
  });
  it('qRecherche sans portée : nom OU plein texte', () => {
    expect(qRecherche(' facture ')).toBe(
      "(name contains 'facture' or fullText contains 'facture') and trashed = false",
    );
  });
  it('qRecherche avec portée : clause parents en OR, parenthésée', () => {
    expect(qRecherche('kia', ['a', 'b'])).toBe(
      "(name contains 'kia' or fullText contains 'kia') and trashed = false and ('a' in parents or 'b' in parents)",
    );
  });
  it('qSousDossiers : ne remonte que des dossiers non corbeillés', () => {
    expect(qSousDossiers(['x'])).toBe(
      `('x' in parents) and mimeType = '${MIME_DOSSIER}' and trashed = false`,
    );
  });
});

describe('decouperEnLots', () => {
  it('découpe sans perdre ni altérer', () => {
    const src = [1, 2, 3, 4, 5];
    expect(decouperEnLots(src, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(src).toHaveLength(5); // copie, jamais de mutation
    expect(decouperEnLots([], 3)).toEqual([]);
  });
});

describe('trierElements — façon Google Drive', () => {
  it('dossiers d’abord, puis alphabétique insensible et numérique', () => {
    const tries = trierElements([
      el('zzz.pdf'),
      el('Beta', MIME_DOSSIER),
      el('alpha.pdf'),
      el('Ancien', MIME_DOSSIER),
      el('doc 10.pdf'),
      el('doc 2.pdf'),
    ]);
    expect(tries.map((e) => e.name)).toEqual(['Ancien', 'Beta', 'alpha.pdf', 'doc 2.pdf', 'doc 10.pdf', 'zzz.pdf']);
  });
  it('copie défensive', () => {
    const src = [el('b'), el('a')];
    trierElements(src);
    expect(src.map((e) => e.name)).toEqual(['b', 'a']);
  });
});

describe('fil d’Ariane', () => {
  const ariane = [{ id: 'root', nom: 'Mon Drive' }, { id: 'x', nom: '03 · Auto' }];
  it('pousserEtape ajoute en bout (copie)', () => {
    expect(pousserEtape(ariane, { id: 'y', nom: 'KIA' })).toHaveLength(3);
    expect(ariane).toHaveLength(2);
  });
  it('couperA remonte à l’étape cliquée, id inconnu → inchangé', () => {
    expect(couperA(ariane, 'root')).toEqual([{ id: 'root', nom: 'Mon Drive' }]);
    expect(couperA(ariane, 'inconnu')).toBe(ariane);
  });
});

describe('affichage', () => {
  it('estDossier / icônes', () => {
    expect(estDossier({ mimeType: MIME_DOSSIER })).toBe(true);
    expect(iconePourMime(MIME_DOSSIER)).toBe('📁');
    expect(iconePourMime('application/pdf')).toBe('📕');
    expect(iconePourMime('image/jpeg')).toBe('🖼');
    expect(iconePourMime('application/vnd.google-apps.spreadsheet')).toBe('📊');
    expect(iconePourMime('application/octet-stream')).toBe('📎');
  });
  it('formaterTaille : absent (fichiers Google) → « — », sinon unités lisibles', () => {
    expect(formaterTaille(undefined)).toBe('—');
    expect(formaterTaille('abc')).toBe('—');
    expect(formaterTaille('512')).toBe('512 o');
    expect(formaterTaille('2048')).toBe('2 Ko');
    expect(formaterTaille(String(3 * 1024 * 1024))).toBe('3.0 Mo');
  });
  it('formaterDateCourte : ISO illisible → « — »', () => {
    expect(formaterDateCourte(undefined)).toBe('—');
    expect(formaterDateCourte('pas-une-date')).toBe('—');
    expect(formaterDateCourte('2026-07-06T12:00:00Z')).toContain('2026');
  });
});

describe('estDossierATrier (parades intake C21-02 — reconnu par NOM, accents/casse neutralisés)', () => {
  it.each([
    ['00 · À trier', true],
    ['À trier', true],
    ['a trier', true],
    ['03 · Logement & véhicule', false],
    ['_Doublons', false],
    ['Mon Drive', false],
    ['', false],
  ])('%s → %s', (nom, attendu) => {
    expect(estDossierATrier(nom)).toBe(attendu);
  });
});
