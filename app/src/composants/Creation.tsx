/**
 * Creation.tsx — carte « Créer » (tâche/RDV) réutilisable : FAB de la sidebar ET clic sur un
 * créneau de l'Agenda (pré-remplie). Écritures Tasks/Calendar seules — créer et rien d'autre
 * (verrou : test miroir aucune-suppression). C28-41 PR2 (décision Marc « choix à la création ») :
 * un RDV part dans l'agenda CHOISI (principal par défaut, Family en un clic) — le sélecteur
 * n'apparaît que s'il y a plus d'un agenda connu.
 */

import { useState } from 'react';
import { creerTache, creerEvenement } from '../google';
import { useAgendas } from '../agendasStore';
import { Langue, t } from '../i18n';

export function Creation({ langue, onCree, titreInitial, note, typeInitial, dateInitiale, heureInitiale }: {
  langue: Langue;
  onCree: () => void;
  titreInitial?: string;
  note?: string; // ex. lien Gmail — placé dans les notes de la tâche (jamais lu depuis Gmail)
  typeInitial?: 'tache' | 'rdv';   // clic sur un créneau de la grille → RDV pré-rempli
  dateInitiale?: string;           // AAAA-MM-JJ
  heureInitiale?: string;          // HH:MM
}) {
  const agendas = useAgendas();
  const principal = agendas.liste.find((a) => a.principal)?.id ?? 'primary';
  const [type, setType] = useState<'tache' | 'rdv'>(typeInitial ?? 'tache');
  const [titre, setTitre] = useState(titreInitial ?? '');
  const [date, setDate] = useState(dateInitiale ?? '');
  const [heure, setHeure] = useState(heureInitiale ?? '09:00');
  const [agendaId, setAgendaId] = useState(principal);
  const [statut, setStatut] = useState('');

  async function creer() {
    setStatut('');
    try {
      if (type === 'tache') await creerTache(titre, date || undefined, note);
      else await creerEvenement(titre, `${date}T${heure}`, note, agendaId);
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
        {type === 'rdv' && agendas.liste.length > 1 && (
          <select value={agendaId} onChange={(e) => setAgendaId(e.target.value)} aria-label={t('agendaChamp', langue)}>
            {agendas.liste.map((a) => (
              <option key={a.id} value={a.id}>{a.nom || t('agendaPrincipal', langue)}</option>
            ))}
          </select>
        )}
        <button disabled={!titre || (type === 'rdv' && !date)} onClick={creer}>{t('creerBouton', langue)}</button>
      </div>
      {statut === 'ok' && <p className="ok">{t('creeOk', langue)}</p>}
      {statut && statut !== 'ok' && <p className="erreur">{statut}</p>}
      <p className="explication">{t('creerNote', langue)}</p>
    </section>
  );
}
