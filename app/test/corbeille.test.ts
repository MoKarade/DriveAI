/**
 * corbeille.test.ts — le verdict PUR de l'ADR-0014 (unique exception au §2).
 * Chaque garde est testée : type, vacuité STRICTE, ascendance (échec fermé), noms réservés.
 * L'action réseau (corbeillerDossierVide) ne part que sur verdict vide — vérifié par lecture
 * du code dans aucune-suppression.test.ts (tripwire) ; ici on fige la décision.
 */

import { describe, it, expect } from 'vitest';
import { verdictCorbeille, statutRefusCorbeille, corbeillerLot } from '../src/corbeille';
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

  it('zone protégée dans l’ascendance → refus ; chaîne ILLISIBLE = refus AUSSI, mais sous un motif DISTINCT', () => {
    expect(verdictCorbeille({ ...BASE, ascendance: { ids: ['a', PROTEGE], complete: true } }))
      .toContain('zone-protegee');
    // Échec fermé : le refus est le MÊME. Mais le motif ne doit PAS être `zone-protegee` (revue
    // C28-93, 🔴) : en aval, `statutRefusCorbeille` lit ce texte pour décider si la ligne quitte la
    // liste DÉFINITIVEMENT. Un 429 sur un GET d'ancêtre retirait ainsi une proposition à vie — le
    // moteur dédoublonne sur `videcandidat|<id>` et ne la re-proposera jamais.
    const illisible = verdictCorbeille({ ...BASE, ascendance: { ids: [], complete: false } });
    expect(illisible).toContain('ascendance-illisible');
    expect(illisible).not.toContain('zone-protegee');
    expect(illisible.length).toBeGreaterThan(0); // le refus tient : c'est bien un refus
    expect(statutRefusCorbeille(`Corbeille refusée (ADR-0014) : ${illisible.join(', ')}`)).toBeNull();
    // …et une VRAIE zone protégée, elle, reste un verdict définitif.
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : zone-protegee')).toBe('vide-protégé');
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

  it('les messages RÉELS de l\'app tombent chacun du bon côté', () => {
    // Version précédente : `expect(...).not.toBe('vide-candidat')` — tautologique (la fonction rend
    // 4 littéraux fixes ou null, l'assertion ne pouvait tomber que sur une faute de frappe).
    // Ce qui se teste vraiment, c'est la FRONTIÈRE, sur les messages que `google.ts` produit
    // réellement : un verdict d'un côté, une panne de l'autre.
    const definitifs = [
      'Error: Corbeille refusée (ADR-0014) : non-vide',
      'Error: Corbeille refusée (ADR-0014) : zone-protegee',
      'Error: Corbeille refusée (ADR-0014) : racine-systeme, non-vide',
      'Error: Google API 404 : {"error":{"code":404,"message":"File not found: abc."}}',
    ];
    const pannes = [
      'Error: Corbeille refusée (ADR-0014) : ascendance-illisible', // ← le 🔴 de la revue
      'Error: Google est momentanément saturé (quota par minute) — réessaie dans quelques secondes.',
      'Error: Session expirée — reconnecte-toi',
      'Error: Non connecté',
      'Error: Google API 500 : {"error":{"code":500}}',
      'Error: Google API 403 : {"error":{"code":403,"message":"Rate Limit Exceeded"}}',
      'TypeError: Failed to fetch',
    ];
    for (const m of definitifs) expect(statutRefusCorbeille(m), m).not.toBeNull();
    for (const m of pannes) expect(statutRefusCorbeille(m), m).toBeNull();
  });
});

/* ---------- C28-93 : le LOT lui-même — un refus n'arrête plus les suivants ---------- */

describe('corbeillerLot', () => {
  const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ID${i}`, ligneSheet: i + 2 }));

  it('un refus EN PREMIÈRE POSITION ne bloque plus les 123 suivants (le défaut vécu)', async () => {
    // Le cas RÉEL : la liste de Marc commençait par un dossier nommé `02 · Finances`, que le verdict
    // refuse par son nom. La boucle était dans un `try` unique ⇒ 124 proposés, ZÉRO corbeillé.
    const ecrits: { ligneSheet: number; statut: string }[] = [];
    const bilan = await corbeillerLot(lignes(5), {
      corbeiller: async (id) => {
        if (id === 'ID0') throw new Error('Corbeille refusée (ADR-0014) : racine-systeme');
        if (id === 'ID2') throw new Error('Corbeille refusée (ADR-0014) : non-vide');
      },
      ecrire: async (ligneSheet, statut) => { ecrits.push({ ligneSheet, statut }); },
    });
    expect(bilan).toEqual({ corbeilles: 3, classes: 2, aReessayer: 0, sheetKo: 0 });
    expect(ecrits.map((e) => e.statut)).toEqual(['vide-protégé', 'corbeillé', 'vide-repris', 'corbeillé', 'corbeillé']);
    expect(ecrits).toHaveLength(5); // TOUTES les lignes quittent la liste, aucune n'est oubliée
  });

  it('un refus INCONNU laisse la ligne candidate — aucune écriture, donc rien de définitif', async () => {
    const ecrits: number[] = [];
    const bilan = await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Google est momentanément saturé'); },
      ecrire: async (ligneSheet) => { ecrits.push(ligneSheet); },
    });
    expect(bilan).toEqual({ corbeilles: 2, classes: 0, aReessayer: 1, sheetKo: 0 });
    expect(ecrits).toEqual([2, 4]); // la ligne 3 n'est PAS écrite : elle sera re-proposée
  });

  it('Sheet en échec : compté À PART, jamais comme « à re-tenter » (le dossier, lui, est fait)', async () => {
    const bilan = await corbeillerLot(lignes(2), {
      corbeiller: async () => {},
      ecrire: async () => { throw new Error('Google API 429'); },
    });
    expect(bilan).toEqual({ corbeilles: 2, classes: 0, aReessayer: 0, sheetKo: 2 });
    // Le total ne double-compte pas : 2 lignes traitées, 2 corbeillées.
    expect(bilan.corbeilles + bilan.classes + bilan.aReessayer).toBe(2);
  });

  it('session morte : le lot s\'arrête NET au lieu d\'enchaîner les échecs', async () => {
    let vus = 0;
    const bilan = await corbeillerLot(lignes(50), {
      corbeiller: async () => { vus++; },
      ecrire: async () => {},
      stop: () => vus >= 3,
    });
    expect(vus).toBe(3);
    expect(bilan.corbeilles).toBe(3);
  });

  it('rend compte de l\'avancement à chaque ligne, refus compris', async () => {
    const vus: number[] = [];
    await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Corbeille refusée (ADR-0014) : non-vide'); },
      ecrire: async () => {},
      avancement: (fait) => vus.push(fait),
    });
    expect(vus).toEqual([1, 2, 3]);
  });
});
