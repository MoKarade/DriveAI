/**
 * Sidebar.tsx — barre latérale façon Google Agenda (C28-23 PR1, plan architecte).
 * Contient : le bouton « + Créer » (FAB Material), l'emplacement du mini-calendrier (branché
 * en PR3), les 6 sections de l'app, et « Mes agendas » — un TROMPE-L'ŒIL UI (§2.3 : aucune
 * donnée ni scope nouveau) : deux cases locales Événements/Tâches qui filtreront localement
 * l'Agenda (câblage en PR2/PR3, l'état vit déjà chez le parent pour ça).
 * Mobile : tiroir ouvert par le ☰ de la topbar (`ouverte` + fond cliquable pour fermer).
 */

import { Langue, t } from '../i18n';
import type { Section } from '../App';
import { SECTIONS, ICONES } from '../App';

export interface AgendasVisibles {
  evenements: boolean;
  taches: boolean;
}

export function Sidebar({ langue, section, ouverte, agendas, onAgendas, onAller, onFermer, onCreer }: {
  langue: Langue;
  section: Section;
  ouverte: boolean;
  agendas: AgendasVisibles;
  onAgendas: (a: AgendasVisibles) => void;
  onAller: (s: Section) => void;
  onFermer: () => void;
  onCreer: () => void;
}) {
  return (
    <>
      {ouverte && <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={onFermer} />}
      <aside className={'sidebar' + (ouverte ? ' ouverte' : '')}>
        <button className="fab-creer" onClick={onCreer}>
          <em aria-hidden="true">＋</em>
          {t('creerBouton', langue)}
        </button>

        {/* PR3 : le mini-calendrier du mois s'insère ici (navigue le grand Agenda). */}

        <nav className="sections" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s} className={section === s ? 'actif' : ''} onClick={() => onAller(s)}>
              <em aria-hidden="true">{ICONES[s]}</em>
              {t(s, langue)}
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
