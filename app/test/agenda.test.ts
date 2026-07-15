/**
 * Logique pure de la vue Agenda (C19-05) : grille du mois, interpréteurs Calendar/Tasks,
 * marquage « créé par DriveAI » via l'Index.
 */

import { describe, it, expect } from 'vitest';
import {
  grilleMois,
  grilleSemaine,
  grilleJour,
  grilleTroisJours,
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  libelleHoraire,
  positionEvenement,
  positionMaintenant,
  titresDriveAI,
  Evenement,
} from '../src/agenda';
import { interpreterIndex } from '../src/etat';

/* ---------- grille horaire absolue (C28-23 PR2) ---------- */

function evt(sur: Partial<Evenement>): Evenement {
  return {
    id: 'x', titre: 'T', debut: '2026-07-15T06:45:00', fin: '2026-07-15T08:00:00',
    journee: false, lieu: '', lien: '', parDriveAI: false, ...sur,
  };
}

describe('grilleJour / grilleTroisJours (C28-23)', () => {
  it('grilleJour : une seule colonne, le jour de référence', () => {
    const g = grilleJour(new Date(2026, 6, 15));
    expect(g.length).toBe(1);
    expect(cleJour(g[0].date)).toBe('2026-07-15');
  });

  it('grilleTroisJours : la référence + 2 jours, franchit le mois', () => {
    const g = grilleTroisJours(new Date(2026, 6, 31));
    expect(g.map((j) => cleJour(j.date))).toEqual(['2026-07-31', '2026-08-01', '2026-08-02']);
  });
});

describe('positionEvenement — top/height en % de 24 h (formule du plan)', () => {
  it('06:45 → 08:00 : top = 405/1440, hauteur = 75/1440', () => {
    const p = positionEvenement(evt({}))!;
    expect(p.top).toBeCloseTo((405 / 1440) * 100, 5);
    expect(p.hauteur).toBeCloseTo((75 / 1440) * 100, 5);
  });

  it('journée entière → null (rangée dédiée, jamais un bloc dans la colonne)', () => {
    expect(positionEvenement(evt({ journee: true, debut: '2026-07-15', fin: '' }))).toBeNull();
  });

  it('sans fin → 60 min par défaut ; fin le LENDEMAIN → coupé à minuit dans sa colonne', () => {
    expect(positionEvenement(evt({ fin: '' }))!.hauteur).toBeCloseTo((60 / 1440) * 100, 5);
    const p = positionEvenement(evt({ debut: '2026-07-15T22:00:00', fin: '2026-07-16T02:00:00' }))!;
    expect(p.hauteur).toBeCloseTo((120 / 1440) * 100, 5); // 22:00 → 24:00
  });

  it('fin ≤ début (donnée aberrante) → 30 min minimum, jamais un bloc négatif', () => {
    const p = positionEvenement(evt({ fin: '2026-07-15T06:00:00' }))!;
    expect(p.hauteur).toBeCloseTo((30 / 1440) * 100, 5);
  });
});

describe('libelleHoraire / positionMaintenant', () => {
  it('« De 06:45 à 08:00 » (fr) / « 06:45 – 08:00 » (en) ; journée entière → vide', () => {
    expect(libelleHoraire(evt({}), true)).toBe('De 06:45 à 08:00');
    expect(libelleHoraire(evt({}), false)).toBe('06:45 – 08:00');
    expect(libelleHoraire(evt({ journee: true, debut: '2026-07-15' }), true)).toBe('');
  });

  it('la ligne « maintenant » suit l\'heure locale (midi = 50 %)', () => {
    expect(positionMaintenant(new Date(2026, 6, 15, 12, 0))).toBeCloseTo(50, 5);
  });
});

describe('grilleMois', () => {
  it('juillet 2026 : commence lundi 29 juin, finit dimanche 2 août, 5 semaines', () => {
    const g = grilleMois(2026, 6);
    expect(g.length).toBe(5);
    expect(cleJour(g[0][0].date)).toBe('2026-06-29');
    expect(g[0][0].horsMois).toBe(true);
    expect(cleJour(g[0][2].date)).toBe('2026-07-01');
    expect(g[0][2].horsMois).toBe(false);
    expect(cleJour(g[4][6].date)).toBe('2026-08-02');
    expect(g[4][6].horsMois).toBe(true);
  });

  it('février 2027 (commence lundi 1er) : 4 semaines pile, aucun jour hors mois', () => {
    const g = grilleMois(2027, 1);
    expect(g.length).toBe(4);
    expect(g.flat().every((j) => !j.horsMois)).toBe(true);
  });
});

describe('grilleSemaine (C28-04, plan P2)', () => {
  it('mercredi 8 juillet 2026 → lundi 6 au dimanche 12, tous dans le mois', () => {
    const s = grilleSemaine(new Date(2026, 6, 8));
    expect(s.length).toBe(7);
    expect(cleJour(s[0].date)).toBe('2026-07-06');
    expect(cleJour(s[6].date)).toBe('2026-07-12');
    expect(s.every((j) => !j.horsMois)).toBe(true);
  });

  it('un lundi → la semaine commence ce jour-là (pas la précédente)', () => {
    const s = grilleSemaine(new Date(2026, 6, 6));
    expect(cleJour(s[0].date)).toBe('2026-07-06');
  });

  it('un dimanche → la semaine commence le lundi PRÉCÉDENT', () => {
    const s = grilleSemaine(new Date(2026, 6, 12));
    expect(cleJour(s[0].date)).toBe('2026-07-06');
  });

  it('semaine à cheval sur deux mois : horsMois relatif au mois de la référence', () => {
    const s = grilleSemaine(new Date(2026, 6, 31)); // vendredi 31 juillet
    expect(cleJour(s[0].date)).toBe('2026-07-27');
    expect(cleJour(s[6].date)).toBe('2026-08-02');
    expect(s[4].horsMois).toBe(false); // 31 juillet
    expect(s[5].horsMois).toBe(true);  // 1er août
  });
});

describe('interpréteurs Calendar/Tasks', () => {
  const marques = new Set(['Rendez-vous dossier — IRCC', 'Payer la facture Hydro-Québec']);

  it('événements : tri chronologique, annulés exclus, journée entière détectée, badge DriveAI', () => {
    const evts = interpreterEvenements(
      [
        { id: 'b', summary: 'Dentiste', htmlLink: 'L1', start: { dateTime: '2026-07-09T14:00:00-04:00' } },
        { id: 'a', summary: 'Rendez-vous dossier — IRCC', htmlLink: 'L2', start: { dateTime: '2026-07-08T09:30:00-04:00' } },
        { id: 'c', summary: 'Férié', start: { date: '2026-07-01' } },
        { id: 'x', summary: 'Annulé', status: 'cancelled', start: { dateTime: '2026-07-08T10:00:00-04:00' } },
      ],
      marques,
    );
    expect(evts.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(evts[0].journee).toBe(true);
    expect(evts[1].parDriveAI).toBe(true);
    expect(evts[2].parDriveAI).toBe(false);
  });

  it('journée entière MULTI-JOURS : couvre chaque jour de la plage (fin exclusive, façon Google)', () => {
    const evts = interpreterEvenements(
      [{ id: 'v', summary: 'Vacances coloc', start: { date: '2026-07-13' }, end: { date: '2026-07-18' } }],
      new Set(),
    );
    expect(evenementsDuJour(evts, new Date(2026, 6, 13)).length).toBe(1);
    expect(evenementsDuJour(evts, new Date(2026, 6, 17)).length).toBe(1);
    expect(evenementsDuJour(evts, new Date(2026, 6, 18)).length).toBe(0); // fin EXCLUSIVE
    expect(evenementsDuJour(evts, new Date(2026, 6, 12)).length).toBe(0);
  });

  it('evenementsDuJour + heureEvenement : jour calendaire LOCAL, heure locale', () => {
    const evts = interpreterEvenements(
      [{ id: 'a', summary: 'Soir', start: { dateTime: '2026-07-08T23:30:00' } }],
      new Set(),
    );
    expect(evenementsDuJour(evts, new Date('2026-07-08T01:00:00')).length).toBe(1);
    expect(evenementsDuJour(evts, new Date('2026-07-09T01:00:00')).length).toBe(0);
    expect(heureEvenement(evts[0])).toBe('23:30');
  });

  it('tâches : ouvertes d’abord (échéance croissante), faites à la fin ; échéance = date seule', () => {
    const taches = interpreterTaches(
      [
        { id: '1', title: 'Sans échéance', status: 'needsAction' },
        { id: '2', title: 'Payer la facture Hydro-Québec', due: '2026-07-15T00:00:00.000Z', status: 'needsAction' },
        { id: '3', title: 'Déjà faite', due: '2026-07-01T00:00:00.000Z', status: 'completed' },
      ],
      marques,
    );
    expect(taches.map((t) => t.id)).toEqual(['2', '1', '3']);
    expect(taches[0].echeance).toBe('2026-07-15');
    expect(taches[0].parDriveAI).toBe(true);
    expect(taches[2].faite).toBe(true);
  });

  it('tachesDuJour : seulement les OUVERTES dues ce jour', () => {
    const taches = interpreterTaches(
      [
        { id: '1', title: 'A', due: '2026-07-15T00:00:00.000Z', status: 'needsAction' },
        { id: '2', title: 'B', due: '2026-07-15T00:00:00.000Z', status: 'completed' },
      ],
      new Set(),
    );
    expect(tachesDuJour(taches, new Date(2026, 6, 15)).map((t) => t.id)).toEqual(['1']);
  });
});

describe('titresDriveAI', () => {
  it('collecte les titres des lignes tache/evenement de l’Index', () => {
    const lignes = interpreterIndex([
      ['tache|M1|h', '2026-07-01', 'Payer la facture Hydro-Québec', '', '', 'tache'],
      ['event|M2|h', '2026-07-02', 'Rendez-vous dossier — IRCC', '', '', 'evenement'],
      ['drive|X', '2026-07-03', 'Un document', '02', '', 'classé'],
    ]);
    const s = titresDriveAI(lignes);
    expect(s.has('Payer la facture Hydro-Québec')).toBe(true);
    expect(s.has('Rendez-vous dossier — IRCC')).toBe(true);
    expect(s.has('Un document')).toBe(false);
  });
});
