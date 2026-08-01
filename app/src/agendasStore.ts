/**
 * agendasStore.ts — état PARTAGÉ des agendas Google (C28-41 PR2, décision Marc « tous mes
 * agendas »). Un seul chargement de calendarList par session (déclenché au premier abonné),
 * partagé entre la sidebar (cases à cocher), l'Agenda, l'accueil et la création de RDV —
 * même patron de mini-store que Suspects.tsx (useSyncExternalStore).
 *
 * JETON SANS LE SCOPE (émis avant l'ajout de `calendar.readonly`) : calendarList répond 403 →
 * statut `scope`, repli sur le SEUL agenda principal (comportement historique intact), et la
 * sidebar propose UNE reconnexion. Jamais un échec silencieux (leçon §7 : un verrou posé à
 * l'émission n'atteint pas le stock de jetons déjà émis).
 */

import { useSyncExternalStore } from 'react';
import { listerAgendas, seConnecter, seDeconnecter } from './google';
import { AgendaGoogle, COULEUR_AGENDA_DEFAUT, interpreterAgendas } from './agenda';

export type StatutAgendas = 'chargement' | 'ok' | 'scope' | 'erreur';

export interface EtatAgendas {
  statut: StatutAgendas;
  liste: AgendaGoogle[];          // toujours ≥ 1 (repli : principal seul)
  visibles: ReadonlySet<string>;  // ids cochés dans « Mes agendas »
  taches: boolean;                // case Tâches (filtre local de l'Agenda)
}

/** Repli quand la liste est indisponible : l'agenda principal seul, comme avant C28-41. */
const AGENDA_PRINCIPAL_REPLI: AgendaGoogle = {
  id: 'primary', nom: '', couleur: COULEUR_AGENDA_DEFAUT, principal: true, visibleParDefaut: true,
};

const CLE_VISIBLES = 'driveai.agendas.visibles';

let etat: EtatAgendas = {
  statut: 'chargement',
  liste: [AGENDA_PRINCIPAL_REPLI],
  visibles: new Set(['primary']),
  taches: true,
};
let version = 0;
let chargementLance = false;
const abonnes = new Set<() => void>();

function publier(suivant: Partial<EtatAgendas>): void {
  etat = { ...etat, ...suivant };
  version++;
  abonnes.forEach((cb) => cb());
}

/** Visibles initiaux : le choix PERSISTÉ de Marc (intersecté avec la liste réelle), sinon les
 * cases cochées côté Google Agenda (`selected`). Un agenda apparu depuis suit son `selected`. */
function visiblesInitiaux(liste: AgendaGoogle[]): Set<string> {
  let stockes: string[] | null = null;
  try {
    const brut = localStorage.getItem(CLE_VISIBLES);
    if (brut) {
      const arr = JSON.parse(brut);
      if (Array.isArray(arr)) stockes = arr.filter((x): x is string => typeof x === 'string');
    }
  } catch { /* stockage indisponible → défauts Google */ }
  if (stockes === null) return new Set(liste.filter((a) => a.visibleParDefaut).map((a) => a.id));
  const ids = new Set(liste.map((a) => a.id));
  return new Set(stockes.filter((id) => ids.has(id)));
}

function persisterVisibles(v: ReadonlySet<string>): void {
  try { localStorage.setItem(CLE_VISIBLES, JSON.stringify(Array.from(v))); } catch { /* mémoire seule */ }
}

async function charger(): Promise<void> {
  try {
    const liste = interpreterAgendas(await listerAgendas());
    if (liste.length === 0) {
      publier({ statut: 'ok', liste: [AGENDA_PRINCIPAL_REPLI], visibles: new Set(['primary']) });
      return;
    }
    publier({ statut: 'ok', liste, visibles: visiblesInitiaux(liste) });
  } catch (e) {
    // 403 = jeton d'avant le scope → reconnexion à proposer ; le reste = panne transitoire.
    publier({ statut: String(e).includes('SCOPE_AGENDAS') ? 'scope' : 'erreur' });
  }
}

function abonner(cb: () => void): () => void {
  abonnes.add(cb);
  if (!chargementLance) {
    chargementLance = true; // un seul calendarList par session, quel que soit le nombre de vues
    void charger();
  }
  return () => abonnes.delete(cb);
}

/** Hook partagé : tout composant abonné se re-rend quand la liste ou les cases changent. */
export function useAgendas(): EtatAgendas {
  useSyncExternalStore(abonner, () => version);
  return etat;
}

/** Les agendas actuellement AFFICHÉS (cochés) — l'Agenda et l'accueil itèrent dessus. */
export function agendasAffiches(e: EtatAgendas): AgendaGoogle[] {
  return e.liste.filter((a) => e.visibles.has(a.id));
}

export function basculerAgenda(id: string): void {
  const v = new Set(etat.visibles);
  if (v.has(id)) v.delete(id);
  else v.add(id);
  persisterVisibles(v);
  publier({ visibles: v });
}

export function basculerTaches(): void {
  publier({ taches: !etat.taches });
}

/** Reconnexion UNIQUE pour accorder `calendar.readonly` (la page navigue vers /api/login). */
export function reconnecterPourAgendas(): void {
  seDeconnecter();
  void seConnecter();
}

/**
 * Réessaie le chargement de la liste après une panne TRANSITOIRE (statut 'erreur') : sans ça, un
 * simple hoquet réseau au démarrage faisait disparaître Family jusqu'au reload complet (le
 * chargement n'a lieu qu'une fois, `chargementLance`) — « jamais un échec silencieux » (en-tête du
 * fichier). Repasse en 'chargement' puis relance `charger()`.
 */
export function rechargerAgendas(): void {
  publier({ statut: 'chargement' });
  void charger();
}
