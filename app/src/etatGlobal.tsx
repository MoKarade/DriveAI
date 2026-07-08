/**
 * etatGlobal.tsx — état PARTAGÉ de l'app (P1/C28-02, plan architecte validé 2026-07-08).
 *
 * Avant : chaque vue faisait son propre `lirePlage` UNE fois au montage → données figées tant
 * qu'on ne changeait pas de section (app ouverte = photo de l'ouverture, à jamais), lectures
 * redondantes, états de chargement hétérogènes. Désormais UN cycle : le fournisseur charge les
 * onglets de la Sheet en un `Promise.all`, les vues consomment, et un rafraîchissement
 * périodique (5 min — le moteur n'écrit que par ticks de 5 min) + manuel (bouton ⟳) invalide le
 * cache et relit. L'Index est servi en ÉTAT COURANT (`etatCourantIndex` : dédoublonné par
 * fil/fichier — la section Suspects redevient honnête).
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { lirePlage, viderCachePlages } from './google';
import { LigneIndex, interpreterIndex, etatCourantIndex } from './etat';

export interface DonneesEtat {
  index: LigneIndex[];       // état COURANT (dédoublonné) — les vues n'ont plus à le faire
  santeBrut: string[][];
  journalBrut: string[][];
  entitesBrut: string[][];   // brut A1:… (interpreterEntites a besoin des en-têtes réels)
  triApprisBrut: string[][];
  reglagesBrut: string[][];
}

interface EtatGlobal {
  donnees: DonneesEtat | null; // null = premier chargement pas encore abouti
  erreur: string;
  synchroA: Date | null;       // horodatage de la dernière lecture réussie (badge d'en-tête)
  rafraichir: (forcer?: boolean) => Promise<void>;
}

const Ctx = createContext<EtatGlobal>({
  donnees: null, erreur: '', synchroA: null, rafraichir: async () => {},
});

export function useEtatGlobal(): EtatGlobal {
  return useContext(Ctx);
}

const INTERVALLE_MS = 5 * 60 * 1000; // aligné sur le tick moteur — plus court ne montrerait rien de neuf

export function FournisseurEtat({ children }: { children: ReactNode }) {
  const [donnees, setDonnees] = useState<DonneesEtat | null>(null);
  const [erreur, setErreur] = useState('');
  const [synchroA, setSynchroA] = useState<Date | null>(null);
  const enCours = useRef(false); // anti-chevauchement (l'intervalle peut tomber pendant une lecture lente)
  const forceEnAttente = useRef(false); // un ⟳ demandé PENDANT une lecture en vol ne doit pas être avalé

  const rafraichir = useCallback(async (forcer = false) => {
    if (enCours.current) {
      // La lecture en vol peut livrer une photo ANTÉRIEURE à ce qui motive ce forçage (ex. écriture
      // TriAppris juste faite) : on mémorise, le `finally` rejouera une lecture forcée.
      if (forcer) forceEnAttente.current = true;
      return;
    }
    enCours.current = true;
    try {
      if (forcer) viderCachePlages(); // relire VRAIMENT (le cache 60 s servirait la même photo)
      const [index, sante, journal, entites, triAppris, reglages] = await Promise.all([
        lirePlage('Index', 'A2:H20000'),
        lirePlage('Santé', 'A2:A10'),
        lirePlage('Journal', 'A2:D5000'),
        lirePlage('Entités', 'A1:Z10000'),
        // Onglets créés par le moteur au premier usage — absents = table vide, pas une erreur.
        lirePlage('TriAppris', 'A2:C1000').catch(() => [] as string[][]),
        lirePlage('Réglages', 'A2:B2').catch(() => [] as string[][]),
      ]);
      setDonnees({
        index: etatCourantIndex(interpreterIndex(index)),
        santeBrut: sante, journalBrut: journal, entitesBrut: entites,
        triApprisBrut: triAppris, reglagesBrut: reglages,
      });
      setErreur('');
      setSynchroA(new Date());
    } catch (e) {
      setErreur(String(e)); // les données PRÉCÉDENTES restent affichées (bandeau + Réessayer)
    } finally {
      enCours.current = false;
      if (forceEnAttente.current) {
        forceEnAttente.current = false;
        void rafraichir(true); // rejeu du forçage avalé (une seule relance, jamais de boucle)
      }
    }
  }, []);

  useEffect(() => {
    void rafraichir();
    const t = setInterval(() => void rafraichir(true), INTERVALLE_MS);
    return () => clearInterval(t);
  }, [rafraichir]);

  return <Ctx.Provider value={{ donnees, erreur, synchroA, rafraichir }}>{children}</Ctx.Provider>;
}
