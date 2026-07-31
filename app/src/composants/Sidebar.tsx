/**
 * Sidebar.tsx — barre latérale : « + Créer », mini-calendrier, les 5 sections, et « Mes
 * agendas » RÉEL (C28-41 PR2, décision Marc « tous mes agendas ») : la vraie liste calendarList
 * (Family…) avec cases à cocher et couleurs, comme Google Agenda — plus un trompe-l'œil.
 * L'état vit dans agendasStore (partagé avec l'Agenda, l'accueil et la création) ; un jeton
 * d'avant le scope `calendar.readonly` déclenche l'invite de reconnexion UNIQUE, ici même.
 * Mobile : tiroir ouvert par le ☰ de la topbar. Desktop : repliable en rail d'icônes.
 */

import { Langue, t } from '../i18n';
import type { Section } from '../App';
import { SECTIONS, ICONES } from '../App';
import { MiniCalendrier } from './MiniCalendrier';
import { useAgendas, basculerAgenda, basculerTaches, reconnecterPourAgendas } from '../agendasStore';

export function Sidebar({ langue, section, ouverte, repliee, dateAgenda, onDate, onAller, onFermer, onCreer }: {
  langue: Langue;
  section: Section;
  ouverte: boolean;
  repliee: boolean;
  dateAgenda: Date;
  onDate: (d: Date) => void;
  onAller: (s: Section) => void;
  onFermer: () => void;
  onCreer: () => void;
}) {
  const agendas = useAgendas();
  return (
    <>
      {ouverte && <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={onFermer} />}
      <aside className={'sidebar' + (ouverte ? ' ouverte' : '') + (repliee ? ' repliee' : '')}>
        <button className="fab-creer" title={t('creerBouton', langue)} onClick={onCreer}>
          <em aria-hidden="true">＋</em>
          <span>{t('creerBouton', langue)}</span>
        </button>

        {/* Mini-calendrier : un clic navigue le grand Agenda — l'état vit dans App. */}
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
          {agendas.liste.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={agendas.visibles.has(a.id)}
                onChange={() => basculerAgenda(a.id)}
              />
              <span className="puce" style={{ background: a.couleur }} aria-hidden="true" />
              {a.nom || t('agendaPrincipal', langue)}
            </label>
          ))}
          <label>
            <input type="checkbox" checked={agendas.taches} onChange={() => basculerTaches()} />
            <span className="puce" style={{ background: 'var(--attention)' }} aria-hidden="true" />
            {t('agendaTaches', langue)}
          </label>
          {agendas.statut === 'scope' && (
            <div className="agendas-scope">
              <p className="explication">{t('agendasReconnexion', langue)}</p>
              <button className="discret" onClick={() => reconnecterPourAgendas()}>
                {t('seReconnecter', langue)}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
