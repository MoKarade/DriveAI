/**
 * Creation.tsx — carte « Créer » (tâche/RDV) extraite d'Agenda.tsx (C28-05/06, plan P2) pour
 * être réutilisable : en tête de l'Agenda (découvrabilité) ET en modale depuis un fil Gmail
 * (pré-remplie : titre = sujet, note = lien direct #all/<threadId>). Écritures Tasks/Calendar
 * seules — créer et rien d'autre (verrou : test miroir aucune-suppression).
 */

import { useState } from 'react';
import { creerTache, creerEvenement } from '../google';
import { Langue, t } from '../i18n';

export function Creation({ langue, onCree, titreInitial, note, typeInitial, dateInitiale, heureInitiale }: {
  langue: Langue;
  onCree: () => void;
  titreInitial?: string;
  note?: string; // ex. lien Gmail — placé dans les notes de la tâche (jamais lu depuis Gmail)
  typeInitial?: 'tache' | 'rdv';   // C28-23 PR3 : clic sur un créneau de la grille → RDV pré-rempli
  dateInitiale?: string;           // AAAA-MM-JJ
  heureInitiale?: string;          // HH:MM
}) {
  const [type, setType] = useState<'tache' | 'rdv'>(typeInitial ?? 'tache');
  const [titre, setTitre] = useState(titreInitial ?? '');
  const [date, setDate] = useState(dateInitiale ?? '');
  const [heure, setHeure] = useState(heureInitiale ?? '09:00');
  const [statut, setStatut] = useState('');

  async function creer() {
    setStatut('');
    try {
      if (type === 'tache') await creerTache(titre, date || undefined, note);
      else await creerEvenement(titre, `${date}T${heure}`, note);
      setStatut('ok');
      setTitre('');
      onCree();
    } catch (e) {
      setStatut(String(e));
    }
  }

  return (
    <section className="carte large">
      <h2>{t('creer', langue)}</h2>
      <div className="ligne-formulaire creation">
        <select value={type} onChange={(e) => setType(e.target.value as 'tache' | 'rdv')} aria-label={t('creer', langue)}>
          <option value="tache">{t('tache', langue)}</option>
          <option value="rdv">{t('rdv', langue)}</option>
        </select>
        <input value={titre} onChange={(e) => setTitre(e.target.value)} placeholder={t('titrePlaceholder', langue)} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        {type === 'rdv' && <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} aria-label="Heure" />}
        <button disabled={!titre || (type === 'rdv' && !date)} onClick={creer}>{t('creerBouton', langue)}</button>
      </div>
      {statut === 'ok' && <p className="ok">{t('creeOk', langue)}</p>}
      {statut && statut !== 'ok' && <p className="erreur">{statut}</p>}
      <p className="explication">{t('creerNote', langue)}</p>
    </section>
  );
}
