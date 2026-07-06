/**
 * Logique pure de la vue Agenda (C19-05) : grille du mois, interpréteurs Calendar/Tasks,
 * marquage « créé par DriveAI » via l'Index.
 */

import { describe, it, expect } from 'vitest';
import {
  grilleMois,
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  titresDriveAI,
} from '../src/agenda';
import { interpreterIndex } from '../src/etat';

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
