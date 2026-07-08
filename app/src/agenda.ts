/**
 * agenda.ts — logique PURE de la vue Agenda (C19-05, ADR-0013) : grille du mois,
 * interprétation des réponses Calendar/Tasks, marquage « créé par DriveAI » via l'Index.
 * Aucun appel réseau ici (testable) — les appels vivent dans google.ts / la vue.
 */

import { LigneIndex } from './etat';

/* ---------- grille du mois ---------- */

export interface JourGrille {
  date: Date;
  horsMois: boolean;
}

/** Clé locale AAAA-MM-JJ (jamais UTC — un RDV du soir doit tomber sur le bon jour). */
export function cleJour(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Semaines complètes (lundi → dimanche) couvrant le mois `annee-mois` (mois 0-based).
 * Les jours des mois voisins complètent la grille (`horsMois`).
 */
export function grilleMois(annee: number, mois: number): JourGrille[][] {
  const premier = new Date(annee, mois, 1);
  // getDay() : 0 = dimanche — on veut lundi en tête de semaine.
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(annee, mois, 1 - decalage);
  const semaines: JourGrille[][] = [];
  const d = new Date(debut);
  do {
    const semaine: JourGrille[] = [];
    for (let i = 0; i < 7; i++) {
      semaine.push({ date: new Date(d), horsMois: d.getMonth() !== mois });
      d.setDate(d.getDate() + 1);
    }
    semaines.push(semaine);
  } while (d.getMonth() === mois);
  return semaines;
}

/**
 * La semaine (lundi → dimanche) contenant `reference` (C28-04, plan P2) : même forme qu'une
 * ligne de `grilleMois` pour que la grille se rende à l'identique. `horsMois` est relatif au
 * mois de `reference` (une semaine à cheval sur deux mois garde le mois courant en clair).
 */
export function grilleSemaine(reference: Date): JourGrille[] {
  const decalage = (reference.getDay() + 6) % 7; // lundi en tête, comme grilleMois
  const lundi = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() - decalage);
  const semaine: JourGrille[] = [];
  const d = new Date(lundi);
  for (let i = 0; i < 7; i++) {
    semaine.push({ date: new Date(d), horsMois: d.getMonth() !== reference.getMonth() });
    d.setDate(d.getDate() + 1);
  }
  return semaine;
}

/* ---------- Calendar (lecture) ---------- */

export interface Evenement {
  id: string;
  titre: string;
  debut: string;      // ISO (dateTime) ou AAAA-MM-JJ (journée entière)
  journee: boolean;
  lien: string;       // htmlLink Google Agenda
  parDriveAI: boolean;
}

/** Interprète `items` de calendar.events.list (singleEvents). PUR. */
export function interpreterEvenements(items: unknown[], titresDriveAI: Set<string>): Evenement[] {
  const evts: Evenement[] = [];
  for (const brut of items as {
    id?: string; summary?: string; htmlLink?: string; status?: string;
    start?: { dateTime?: string; date?: string };
  }[]) {
    if (!brut?.id || brut.status === 'cancelled') continue;
    const debut = brut.start?.dateTime ?? brut.start?.date ?? '';
    if (!debut) continue;
    const titre = brut.summary ?? '(sans titre)';
    evts.push({
      id: brut.id,
      titre,
      debut,
      journee: !brut.start?.dateTime,
      lien: brut.htmlLink ?? 'https://calendar.google.com/',
      parDriveAI: titresDriveAI.has(titre),
    });
  }
  return evts.sort((a, b) => a.debut.localeCompare(b.debut));
}

/** Événements d'un jour calendaire local donné. */
export function evenementsDuJour(evts: Evenement[], jour: Date): Evenement[] {
  const cle = cleJour(jour);
  return evts.filter((e) => (e.journee ? e.debut === cle : cleJour(new Date(e.debut)) === cle));
}

/** Heure locale « HH:MM » d'un événement (ou '' pour une journée entière). */
export function heureEvenement(e: Evenement): string {
  if (e.journee) return '';
  const d = new Date(e.debut);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- Tasks (lecture) ---------- */

export interface Tache {
  id: string;
  titre: string;
  echeance: string;   // AAAA-MM-JJ ou ''
  faite: boolean;
  parDriveAI: boolean;
}

/** Interprète `items` de tasks.list. Ouvertes d'abord (échéance croissante), faites à la fin. PUR. */
export function interpreterTaches(items: unknown[], titresDriveAI: Set<string>): Tache[] {
  const taches: Tache[] = [];
  for (const brut of items as { id?: string; title?: string; due?: string; status?: string }[]) {
    if (!brut?.id || !brut.title) continue;
    taches.push({
      id: brut.id,
      titre: brut.title,
      echeance: brut.due ? brut.due.slice(0, 10) : '',
      faite: brut.status === 'completed',
      parDriveAI: titresDriveAI.has(brut.title),
    });
  }
  return taches.sort((a, b) => {
    if (a.faite !== b.faite) return a.faite ? 1 : -1;
    return (a.echeance || '9999').localeCompare(b.echeance || '9999');
  });
}

/** Tâches dont l'échéance tombe un jour calendaire donné (pour la grille). */
export function tachesDuJour(taches: Tache[], jour: Date): Tache[] {
  const cle = cleJour(jour);
  return taches.filter((t) => !t.faite && t.echeance === cle);
}

/* ---------- marquage « créé par DriveAI » ---------- */

/**
 * Titres des tâches/événements créés par le MOTEUR (Index : statuts `tache`/`evenement`,
 * `fichier` = titre de l'intention) — sert à badger ce qui vient de DriveAI dans l'agenda.
 */
export function titresDriveAI(lignes: LigneIndex[]): Set<string> {
  const s = new Set<string>();
  for (const l of lignes) {
    if ((l.statut === 'tache' || l.statut === 'evenement') && l.fichier) s.add(l.fichier);
  }
  return s;
}
