/**
 * TableauDeBord.tsx — surface n°2 de l'ADR-0008 : santé du moteur + activité récente.
 * Lecture seule (Santé + Journal + Index) — version riche de l'onglet Santé.
 */

import { useEffect, useState } from 'react';
import { lirePlage } from '../google';
import {
  Sante,
  LigneJournal,
  LigneIndex,
  interpreterSante,
  interpreterJournal,
  interpreterIndex,
  compterParDomaine,
} from '../etat';
import { Langue, t } from '../i18n';

const JOURNAL_RECENT = 15;
const INDEX_RECENT = 500; // fenêtre du comptage par domaine (dernières lignes — pas toute la Sheet)

export function TableauDeBord({ langue }: { langue: Langue }) {
  const [sante, setSante] = useState<Sante | null>(null);
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, j, i] = await Promise.all([
          lirePlage('Santé', 'A2:A10'),
          lirePlage('Journal', 'A2:D5000'),
          lirePlage('Index', 'A2:F20000'),
        ]);
        setSante(interpreterSante(s));
        setJournal(interpreterJournal(j).slice(-JOURNAL_RECENT).reverse());
        setIndex(interpreterIndex(i).slice(-INDEX_RECENT));
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, []);

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!sante) return <p>{t('chargement', langue)}</p>;

  const parDomaine = Array.from(compterParDomaine(index)).sort((a, b) => b[1] - a[1]);

  return (
    <div className="colonnes">
      <section className="carte">
        <h2>{t('sante', langue)}</h2>
        <ul className="sante">
          {sante.lignes.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="carte">
        <h2>{t('documentsParDomaine', langue)}</h2>
        <table>
          <tbody>
            {parDomaine.map(([domaine, n]) => (
              <tr key={domaine}>
                <td>{domaine}</td>
                <td className="nombre">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte large">
        <h2>{t('activiteRecente', langue)}</h2>
        <table>
          <tbody>
            {journal.map((l, i) => (
              <tr key={i} className={l.niveau === 'ERREUR' ? 'ligne-erreur' : ''}>
                <td className="date">{l.date}</td>
                <td>{l.source}</td>
                <td>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
