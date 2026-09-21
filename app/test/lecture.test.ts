/**
 * lecture.test.ts — L'ONGLET LECTURE : ce qu'il peut dire, et ce qu'il ne doit pas inventer.
 *
 * Écrit le 21/09/2026, après deux messages de Marc : « ça ne m'explique toujours pas
 * l'avancement », puis « je veux vraiment un onglet précis pour l'avancement, avec ce qui est
 * en train d'être lu, ce qui a déjà été lu ».
 *
 * Six propriétés, et aucune ne se déduit du code :
 *
 *  1. une ligne sans identifiant est IGNORÉE — l'afficher compterait un traitement qui n'a pas eu lieu ;
 *  2. un verdict ABSENT n'est pas un verdict d'ÉCHEC : ce sont des lignes écrites avant que le
 *     moteur ne l'inscrive, et les confondre ferait croire que d'anciennes lectures ont raté ;
 *  3. un verdict INCONNU se cite au lieu de tomber dans une catégorie existante ;
 *  4. le bilan ne compte QUE le tag courant — un bump remet les compteurs du moteur à zéro ;
 *  5. l'ordre des « derniers lus » vient de la POSITION, jamais d'un tri sur une date à la
 *     minute que tout un lot partage ;
 *  6. la barre du bas porte autant de cases qu'il y a d'onglets — une valeur figée à 4 a
 *     survécu au passage à 5 sans que rien ne rougisse.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  interpreterPiecesFaites, verdictLecture, bilanLecture, derniersLus, ligneSanteLecture,
} from '../src/etat';
import { SECTIONS_NAV } from '../src/App';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

describe('interpreterPiecesFaites', () => {
  it('ignore une ligne sans identifiant, et garde les champs absents VIDES', () => {
    const lus = interpreterPiecesFaites([
      ['id-1', 'c49-5-b', '2026-09-21 14:02', 'Passeport.pdf', 'ok'],
      ['', 'c49-5-b', '2026-09-21 14:02', 'fantome.pdf', 'ok'],
      ['id-2', 'c49-5-b', '2026-09-21 14:03'], // ligne d'AVANT l'ajout de Nom/Motif
    ]);
    expect(lus.map((d) => d.fileId)).toEqual(['id-1', 'id-2']);
    expect(lus[1]!.nom).toBe('');
    expect(lus[1]!.motif).toBe('');
  });
});

describe('verdictLecture', () => {
  it('sépare « lu », « rien à en tirer » et « en échec »', () => {
    expect(verdictLecture('ok').classe).toBe('ok');
    expect(verdictLecture('illisible').classe).toBe('vide');
    expect(verdictLecture('sans-texte').classe).toBe('vide');
    expect(verdictLecture('ocr-echec').classe).toBe('echec');
    expect(verdictLecture('refusee').classe).toBe('echec');
  });

  it('un verdict ABSENT n\'est pas un échec — c\'est une ligne d\'avant', () => {
    const v = verdictLecture('');
    expect(v.classe).toBe('inconnu');
    expect(v.libelle).toMatch(/antérieure/);
  });

  it('un verdict INCONNU se CITE', () => {
    expect(verdictLecture('motif-de-demain').libelle).toContain('motif-de-demain');
    expect(verdictLecture('motif-de-demain').classe).toBe('inconnu');
  });
});

describe('bilanLecture', () => {
  it('ne compte que le tag COURANT', () => {
    const b = bilanLecture(interpreterPiecesFaites([
      ['a', 'c49-5-a', '2026-09-20 10:00', 'vieux.pdf', 'ok'],
      ['b', 'c49-5-b', '2026-09-21 14:00', 'x.pdf', 'ok'],
      ['c', 'c49-5-b', '2026-09-21 14:01', 'y.pdf', 'illisible'],
      ['d', 'c49-5-b', '2026-09-21 14:02', 'z.pdf', 'ocr-echec'],
    ]));
    expect(b).toEqual({ total: 3, ok: 1, vide: 1, echec: 1, inconnu: 0 });
  });

  it('rend des zéros sur une liste vide, sans NaN', () => {
    expect(bilanLecture([])).toEqual({ total: 0, ok: 0, vide: 0, echec: 0, inconnu: 0 });
  });
});

describe('derniersLus', () => {
  it('ordonne par POSITION dans l\'onglet, pas par date', () => {
    // ⚠️ Les trois partagent la MÊME minute : c'est le cas réel d'un lot traité en une passe.
    // Un tri sur la date rendrait un ordre arbitraire, différent à chaque affichage.
    const lus = interpreterPiecesFaites([
      ['a', 't', '2026-09-21 14:00', 'un.pdf', 'ok'],
      ['b', 't', '2026-09-21 14:00', 'deux.pdf', 'ok'],
      ['c', 't', '2026-09-21 14:00', 'trois.pdf', 'ok'],
    ]);
    expect(derniersLus(lus, 2).map((d) => d.nom)).toEqual(['trois.pdf', 'deux.pdf']);
    expect(derniersLus(lus, 0)).toEqual([]);
    expect(derniersLus(lus, 99)).toHaveLength(3);
  });
});

describe('ligneSanteLecture', () => {
  it('extrait la ligne de la campagne, et rend null quand elle manque', () => {
    const sante = [
      'Dernier passage OK : 2026-09-21 10:12',
      'Rattrapage des pièces (C49-5) : 1085 restants · dernière passe : 1/0/0/0 — passe terminée',
      'Mémoire (pièces) : désactivée (CONFIG)',
    ];
    expect(ligneSanteLecture(sante)).toMatch(/^1085 restants/);
    // ⚠️ `null`, jamais une phrase de repli : « la campagne n'a rien écrit » et « voici son
    // état » sont deux choses, et seule la première peut être une panne du canal.
    expect(ligneSanteLecture(['Dernier passage OK : …'])).toBeNull();
    expect(ligneSanteLecture([])).toBeNull();
  });
});

describe('la barre du bas suit le nombre d\'onglets', () => {
  it('autant de colonnes que de sections — la valeur ne se fige pas', () => {
    // ⚠️ MESURÉ : `repeat(4, 1fr)` a survécu au passage à cinq onglets sans qu'aucun test ne
    // rougisse. Une case de plus dans une grille figée à quatre déborde, et ça ne se voit que
    // sur un téléphone. La garde DÉRIVE du code plutôt que d'épingler un nombre.
    const css = lire('../src/styles.css');
    const m = css.match(/nav\.barre-basse \{\s*display: grid; grid-template-columns: repeat\((\d+), 1fr\)/);
    expect(m, 'la grille de la barre basse est introuvable').not.toBeNull();
    expect(Number(m![1])).toBe(SECTIONS_NAV.length);
  });

  it('chaque onglet mène à une vue — un onglet qui ne mène nulle part est pire qu\'un onglet en moins', () => {
    const app = lire('../src/App.tsx');
    for (const s of SECTIONS_NAV) {
      if (s === 'aujourdhui') continue; // rendu par défaut, sans garde de section
      expect(app, `l'onglet « ${s} » n'a aucune vue`).toContain(`section === '${s}' &&`);
    }
  });
});
