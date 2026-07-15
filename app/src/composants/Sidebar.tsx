/**
 * Sidebar.tsx — barre latérale façon Google Agenda (C28-23 PR1, plan architecte).
 * Contient : le bouton « + Créer » (FAB Material), l'emplacement du mini-calendrier (branché
 * en PR3), les 6 sections de l'app, et « Mes agendas » — un TROMPE-L'ŒIL UI (§2.3 : aucune
 * donnée ni scope nouveau) : deux cases locales Événements/Tâches qui filtreront localement
 * l'Agenda (câblage en PR2/PR3, l'état vit déjà chez le parent pour ça).
 * Mobile : tiroir ouvert par le ☰ de la topbar (`ouverte` + fond cliquable pour fermer).
 * Desktop (C28-24) : REPLIABLE en rail d'icônes par le même ☰ (`repliee`, persistée par App) —
 * mini-calendrier et « Mes agendas » masqués, sections en icônes seules (tooltip = libellé).
 */

import { Langue, t } from '../i18n';
import type { Section } from '../App';
import { SECTIONS, ICONES } from '../App';
import { MiniCalendrier } from './MiniCalendrier';

export interface AgendasVisibles {
  evenements: boolean;
  taches: boolean;
}

export function Sidebar({ langue, section, ouverte, repliee, agendas, dateAgenda, onDate, onAgendas, onAller, onFermer, onCreer }: {
  langue: Langue;
  section: Section;
  ouverte: boolean;
  repliee: boolean;
  agendas: AgendasVisibles;
  dateAgenda: Date;
  onDate: (d: Date) => void;
  onAgendas: (a: AgendasVisibles) => void;
  onAller: (s: Section) => void;
  onFermer: () => void;
  onCreer: () => void;
}) {
  return (
    <>
      {ouverte && <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={onFermer} />}
      <aside className={'sidebar' + (ouverte ? ' ouverte' : '') + (repliee ? ' repliee' : '')}>
        <button className="fab-creer" title={t('creerBouton', langue)} onClick={onCreer}>
          <em aria-hidden="true">＋</em>
          <span>{t('creerBouton', langue)}</span>
        </button>

        {/* Mini-calendrier (PR3) : un clic navigue le grand Agenda — l'état vit dans App. */}
        <MiniCalendrier langue={langue} date={dateAgenda} onChoisir={onDate} />

        <nav className="sections" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s} className={section === s ? 'actif' : ''} title={t(s, langue)} onClick={() => onAller(s)}>
              <em aria-hidden="true">{ICONES[s]}</em>
              <span>{t(s, langue)}</span>
            </button>
          ))}
        </nav>

        <div className="mes-agendas">
          <h3>{t('mesAgendas', langue)}</h3>
          <label>
            <input
              type="checkbox"
              checked={agendas.evenements}
              onChange={(e) => onAgendas({ ...agendas, evenements: e.target.checked })}
            />
            <span className="puce" style={{ background: '#7cacf8' }} aria-hidden="true" />
            {t('agendaEvenements', langue)}
          </label>
          <label>
            <input
              type="checkbox"
              checked={agendas.taches}
              onChange={(e) => onAgendas({ ...agendas, taches: e.target.checked })}
            />
            <span className="puce" style={{ background: '#fdd663' }} aria-hidden="true" />
            {t('agendaTaches', langue)}
          </label>
        </div>
      </aside>
    </>
  );
}
