/**
 * MiniCalendrier.tsx — mini grille du mois dans la sidebar (C28-23 PR3, plan architecte),
 * comme dans Google Agenda : navigation ‹ ›, pastille sur aujourd'hui, sélection tonale.
 * Un clic sur un jour REMONTE la date au parent (App) qui pilote le grand Agenda — l'état
 * `dateAgenda` vit chez le parent, jamais ici (composant natif React, zéro dépendance).
 */

import { useEffect, useState } from 'react';
import { grilleMois, cleJour } from '../agenda';
import { Langue, t } from '../i18n';

const ENTETES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function MiniCalendrier({ langue, date, onChoisir }: {
  langue: Langue;
  date: Date;          // date sélectionnée (référence du grand Agenda)
  onChoisir: (d: Date) => void;
}) {
  const [affiche, setAffiche] = useState(new Date(date.getFullYear(), date.getMonth(), 1));
  const aujourdhui = cleJour(new Date());
  const selection = cleJour(date);

  // Quand App pousse un nouveau jour (clic ici-même sur un mois voisin), le mini revient sur le
  // mois du jour choisi. NB : la navigation ‹ › du GRAND Agenda est locale et ne remonte pas —
  // le mini garde alors son mois (revue flotte : ne pas promettre une synchro qui n'existe pas).
  useEffect(() => {
    setAffiche(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const titre = affiche.toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', year: 'numeric' });

  return (
    <div className="mini-cal">
      <div className="mc-tete">
        <span className="mc-titre">{titre}</span>
        <button aria-label={t('precedent', langue)}
          onClick={() => setAffiche(new Date(affiche.getFullYear(), affiche.getMonth() - 1, 1))}>‹</button>
        <button aria-label={t('suivant', langue)}
          onClick={() => setAffiche(new Date(affiche.getFullYear(), affiche.getMonth() + 1, 1))}>›</button>
      </div>
      <table>
        <thead>
          <tr>{ENTETES.map((e, i) => <th key={i}>{e}</th>)}</tr>
        </thead>
        <tbody>
          {grilleMois(affiche.getFullYear(), affiche.getMonth()).map((semaine, i) => (
            <tr key={i}>
              {semaine.map((j) => {
                const cle = cleJour(j.date);
                return (
                  <td key={cle}
                    className={`${j.horsMois ? 'hors' : ''} ${cle === aujourdhui ? 'auj' : ''} ${cle === selection ? 'sel' : ''}`}>
                    <button onClick={() => onChoisir(j.date)}>{j.date.getDate()}</button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
