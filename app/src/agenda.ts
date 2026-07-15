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

/** Vue JOUR (C28-23 PR2) : une seule colonne, même forme que grilleSemaine. */
export function grilleJour(reference: Date): JourGrille[] {
  return [{ date: new Date(reference), horsMois: false }];
}

/**
 * Vue mobile « 3 jours glissants » (décision Marc, C28-23) : le jour de référence + les 2
 * suivants — comme l'app Google Agenda sur téléphone.
 */
export function grilleTroisJours(reference: Date): JourGrille[] {
  const jours: JourGrille[] = [];
  const d = new Date(reference);
  for (let i = 0; i < 3; i++) {
    jours.push({ date: new Date(d), horsMois: false });
    d.setDate(d.getDate() + 1);
  }
  return jours;
}

/* ---------- Calendar (lecture) ---------- */

export interface Evenement {
  id: string;
  titre: string;
  debut: string;      // ISO (dateTime) ou AAAA-MM-JJ (journée entière)
  fin: string;        // ISO (dateTime) ou '' — la grille horaire en dérive la hauteur (C28-23)
  journee: boolean;
  lieu: string;       // location Google Agenda ('' si absent) — affiché dans le bloc, façon GCal
  lien: string;       // htmlLink Google Agenda
  parDriveAI: boolean;
}

/** Interprète `items` de calendar.events.list (singleEvents). PUR. */
export function interpreterEvenements(items: unknown[], titresDriveAI: Set<string>): Evenement[] {
  const evts: Evenement[] = [];
  for (const brut of items as {
    id?: string; summary?: string; htmlLink?: string; status?: string; location?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }[]) {
    if (!brut?.id || brut.status === 'cancelled') continue;
    const debut = brut.start?.dateTime ?? brut.start?.date ?? '';
    if (!debut) continue;
    const titre = brut.summary ?? '(sans titre)';
    evts.push({
      id: brut.id,
      titre,
      debut,
      fin: brut.end?.dateTime ?? brut.end?.date ?? '',
      journee: !brut.start?.dateTime,
      lieu: brut.location ?? '',
      lien: brut.htmlLink ?? 'https://calendar.google.com/',
      parDriveAI: titresDriveAI.has(titre),
    });
  }
  return evts.sort((a, b) => a.debut.localeCompare(b.debut));
}

/**
 * Événements d'un jour calendaire local donné. Une journée entière MULTI-JOURS (fin = date
 * EXCLUSIVE, sémantique Google) couvre chaque jour de sa plage — le bandeau s'étire sur la
 * grille comme dans Google Agenda (C28-23).
 */
export function evenementsDuJour(evts: Evenement[], jour: Date): Evenement[] {
  const cle = cleJour(jour);
  return evts.filter((e) => {
    if (!e.journee) return cleJour(new Date(e.debut)) === cle;
    return e.fin ? e.debut <= cle && cle < e.fin : e.debut === cle;
  });
}

/** Heure locale « HH:MM » d'un événement (ou '' pour une journée entière). */
export function heureEvenement(e: Evenement): string {
  if (e.journee) return '';
  const d = new Date(e.debut);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- grille horaire absolue (C28-23 PR2, façon Google Agenda) ---------- */

/**
 * Position verticale d'un bloc dans une colonne de 24 h, en POURCENTAGE (plan architecte :
 * top = minutes/1440 × 100). Journée entière → null (rangée dédiée en haut de la grille).
 * Sans fin exploitable → 60 min ; fin un AUTRE jour → coupé à minuit dans SA colonne ;
 * fin ≤ début (donnée aberrante) → 30 min minimum, jamais un bloc invisible/négatif.
 */
export function positionEvenement(e: Evenement): { top: number; hauteur: number } | null {
  if (e.journee) return null;
  const debut = new Date(e.debut);
  const minDebut = debut.getHours() * 60 + debut.getMinutes();
  let minFin = minDebut + 60;
  if (e.fin) {
    const fin = new Date(e.fin);
    minFin = cleJour(fin) === cleJour(debut) ? fin.getHours() * 60 + fin.getMinutes() : 24 * 60;
  }
  if (minFin <= minDebut) minFin = Math.min(minDebut + 30, 24 * 60);
  return { top: (minDebut / (24 * 60)) * 100, hauteur: ((minFin - minDebut) / (24 * 60)) * 100 };
}

/** « De 06:45 à 08:00 » (fr) / « 06:45 – 08:00 » (en) — sous-titre des blocs, façon GCal. */
export function libelleHoraire(e: Evenement, fr: boolean): string {
  const debut = heureEvenement(e);
  if (!debut) return '';
  if (!e.fin) return debut;
  const f = new Date(e.fin);
  const fin = `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
  return fr ? `De ${debut} à ${fin}` : `${debut} – ${fin}`;
}

/** Position de la ligne « maintenant » (trait rouge GCal) en % de la colonne du jour. */
export function positionMaintenant(maintenant: Date): number {
  return ((maintenant.getHours() * 60 + maintenant.getMinutes()) / (24 * 60)) * 100;
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
