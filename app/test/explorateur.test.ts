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
  formaterDateSeule,
  texteSurFond,
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

describe('formaterDateSeule (échéance AAAA-MM-JJ, jamais la veille)', () => {
  // `new Date('2026-07-15')` est parsé en UTC : à l'ouest de Greenwich il rend le 14 (mesuré à
  // Toronto avant correctif). Le test tourne dans le fuseau du système ; il vérifie l'invariant qui
  // compte — le JOUR affiché est celui de la chaîne, quel que soit le fuseau.
  it('rend le jour de la chaîne, pas celui de son interprétation UTC', () => {
    expect(formaterDateSeule('2026-07-15', 'fr-CA')).toContain('15');
    expect(formaterDateSeule('2026-01-01', 'fr-CA')).toContain('1');
    expect(formaterDateSeule('2026-01-01', 'fr-CA')).toContain('2026');
    // La preuve par la mutation : l'ancienne implémentation passait par `new Date(chaîne)`.
    const ancienne = new Date('2026-07-15').getDate();
    const nouvelle = Number(/\d+/.exec(formaterDateSeule('2026-07-15', 'fr-CA'))![0]);
    expect(nouvelle).toBe(15);
    if (new Date().getTimezoneOffset() > 0) expect(ancienne).toBe(14); // fuseau à l'ouest : l'ancien code se trompait
  });
  it('vide ou malformé → tiret', () => {
    expect(formaterDateSeule(undefined)).toBe('—');
    expect(formaterDateSeule('')).toBe('—');
    expect(formaterDateSeule('15/07/2026')).toBe('—');
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

import { requeteDepuisPlan } from '../src/explorateur';

describe('requeteDepuisPlan (v7 : une seule recherche Drive derrière la question IA)', () => {
  it('mots-clés d’abord, sinon le texte du plan, sinon la question', () => {
    expect(requeteDepuisPlan({ motsCles: [' Hydro ', 'facture', ''], texte: 'x' }, 'q')).toBe('Hydro facture');
    expect(requeteDepuisPlan({ motsCles: [], texte: ' relevé ' }, 'q')).toBe('relevé');
    expect(requeteDepuisPlan({}, ' les factures Hydro ')).toBe('les factures Hydro');
  });
  it('l’année du plan entre dans la requête, une seule fois', () => {
    expect(requeteDepuisPlan({ motsCles: ['facture', 'Hydro'], annee: '2025' }, 'q')).toBe('facture Hydro 2025');
    expect(requeteDepuisPlan({ motsCles: ['facture', '2025'], annee: '2025' }, 'q')).toBe('facture 2025');
  });
});

describe('texteSurFond (lisibilité sur une couleur d’agenda Google)', () => {
  // Les quatre couleurs les plus claires de la palette Google : le blanc y donnait 1,7 à 2,6:1.
  it('rend un texte SOMBRE sur les fonds clairs', () => {
    for (const clair of ['#f6bf26', '#e4c441', '#c0ca33', '#33b679']) {
      expect(texteSurFond(clair)).toBe('#101317');
    }
  });
  it('rend du BLANC sur les fonds foncés, et par défaut si la couleur est absente ou illisible', () => {
    for (const fonce of ['#3f51b5', '#0b8043', '#d50000', '#8e24aa']) {
      expect(texteSurFond(fonce)).toBe('#fff');
    }
    expect(texteSurFond(undefined)).toBe('#fff');
    expect(texteSurFond('bleu')).toBe('#fff');
  });
  it('le couple fond/texte atteint AA (4,5:1) sur toute la palette', () => {
    const lum = (hex: string) => {
      const plein = hex.length === 4 ? '#' + [...hex.slice(1)].map((x) => x + x).join('') : hex; // #fff → #ffffff
      const c = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const [r, v, b] = [1, 3, 5].map((i) => c(parseInt(plein.slice(i, i + 2), 16) / 255));
      return 0.2126 * r + 0.7152 * v + 0.0722 * b;
    };
    const contraste = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const fond of ['#f6bf26', '#e4c441', '#c0ca33', '#33b679', '#e67c73', '#3f51b5', '#0b8043', '#d50000', '#8e24aa', '#039be5']) {
      expect(contraste(fond, texteSurFond(fond))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
