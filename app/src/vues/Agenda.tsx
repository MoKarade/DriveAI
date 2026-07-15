/**
 * Agenda.tsx — vue v5 « clone Google Agenda » (C28-23 PR2+PR3, plan architecte) : grille
 * HORAIRE absolue Jour/Semaine/Mois (Semaine par défaut), rangée « toute la journée »,
 * gouttière d'heures, blocs à la minute, couleurs PAR TYPE, ligne « maintenant », 3 jours
 * glissants sur mobile. PR3 : la date de référence est PILOTÉE par le mini-calendrier de la
 * sidebar (prop `dateRef` remontée dans App) ; un clic sur un CRÉNEAU vide ouvre la création
 * pré-remplie ; un clic sur un BLOC ouvre un popover façon GCal (les panneaux Détail du bas de
 * page sont supprimés). Écritures : créer et cocher — jamais supprimer ni modifier.
 */

import { useEffect, useState } from 'react';
import { listerEvenements, listerTaches, cocherTache } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Creation } from '../composants/Creation';
import {
  Evenement,
  Tache,
  JourGrille,
  grilleMois,
  grilleSemaine,
  grilleJour,
  grilleTroisJours,
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  libelleHoraire,
  positionEvenement,
  positionMaintenant,
  titresDriveAI,
} from '../agenda';
import { lignesImportants, lienGmailPourLigne, LigneIndex } from '../etat';
import { formaterDateCourte } from '../explorateur';
import { Langue, t } from '../i18n';

const JOURS_SEMAINE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

type VueCal = 'jour' | 'semaine' | 'mois';
type Popover = { genre: 'evenement'; e: Evenement } | { genre: 'tache'; tache: Tache };

/** Écran étroit (mobile) : la vue Semaine passe en 3 jours glissants (décision Marc). */
function useEstEtroit(): boolean {
  const [etroit, setEtroit] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const suivre = (e: MediaQueryListEvent) => setEtroit(e.matches);
    mq.addEventListener('change', suivre);
    return () => mq.removeEventListener('change', suivre);
  }, []);
  return etroit;
}

export function Agenda({ langue, dateRef }: { langue: Langue; dateRef?: Date }) {
  const maintenant = new Date();
  const [mois, setMois] = useState(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const [vueCal, setVueCal] = useState<VueCal>('semaine'); // Semaine par défaut (C28-23)
  const [semaineRef, setSemaineRef] = useState(dateRef ?? maintenant);
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [importants, setImportants] = useState<LigneIndex[]>([]);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [creneau, setCreneau] = useState<{ date: string; heure: string } | null>(null);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const etroit = useEstEtroit();

  // Le MINI-CALENDRIER de la sidebar pilote la référence (PR3, « remonter dateRef ») : un clic
  // là-bas déplace la grille ici, quel que soit le mois — la vue courante est conservée.
  const cleRef = dateRef ? cleJour(dateRef) : '';
  useEffect(() => {
    if (!dateRef) return;
    setSemaineRef(dateRef);
    if (dateRef.getMonth() !== mois.getMonth() || dateRef.getFullYear() !== mois.getFullYear()) {
      setMois(new Date(dateRef.getFullYear(), dateRef.getMonth(), 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par le JOUR choisi
  }, [cleRef]);

  // La plage Tasks/Calendar chargée reste TOUJOURS celle de la grille du MOIS : jour/semaine
  // sont des sous-ensembles (la navigation garde `mois` aligné sur sa référence), donc changer
  // de vue ou de jour dans le même mois ne re-fetch rien.
  const semainesMois = grilleMois(mois.getFullYear(), mois.getMonth());
  const joursGrille: JourGrille[] =
    vueCal === 'jour' ? grilleJour(semaineRef)
      : etroit ? grilleTroisJours(semaineRef)
        : grilleSemaine(semaineRef);

  /** Navigation ‹ › : ±1 mois, ±7 j (±3 sur mobile) ou ±1 jour — `mois` suit la référence. */
  function naviguer(sens: 1 | -1) {
    if (vueCal === 'mois') {
      setMois(new Date(mois.getFullYear(), mois.getMonth() + sens, 1));
      return;
    }
    const pas = vueCal === 'jour' ? 1 : etroit ? 3 : 7;
    const ref = new Date(semaineRef.getFullYear(), semaineRef.getMonth(), semaineRef.getDate() + pas * sens);
    setSemaineRef(ref);
    if (ref.getMonth() !== mois.getMonth() || ref.getFullYear() !== mois.getFullYear()) {
      setMois(new Date(ref.getFullYear(), ref.getMonth(), 1));
    }
  }

  /** Un jour cliqué (en-tête de colonne, case du mois) → vue JOUR sur ce jour, façon GCal. */
  function ouvrirJour(j: Date) {
    setSemaineRef(j);
    if (j.getMonth() !== mois.getMonth() || j.getFullYear() !== mois.getFullYear()) {
      setMois(new Date(j.getFullYear(), j.getMonth(), 1));
    }
    setVueCal('jour');
  }

  const { donnees, synchroA, rafraichir } = useEtatGlobal();

  useEffect(() => {
    if (!donnees) return;
    (async () => {
      try {
        const debut = semainesMois[0][0].date;
        const finJour = semainesMois[semainesMois.length - 1][6].date;
        const fin = new Date(finJour.getFullYear(), finJour.getMonth(), finJour.getDate() + 1);
        const [evts, tks] = await Promise.all([
          listerEvenements(debut.toISOString(), fin.toISOString()),
          listerTaches(),
        ]);
        const lignes = donnees.index;
        const marques = titresDriveAI(lignes);
        setEvenements(interpreterEvenements(evts, marques));
        setTaches(interpreterTaches(tks, marques));
        setImportants(lignesImportants(lignes).slice(0, 8));
        setCharge(true);
        setErreur('');
      } catch (e) {
        setErreur(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mois, synchroA]);

  async function basculerTache(tache: Tache) {
    try {
      await cocherTache(tache.id, !tache.faite);
      setTaches((ts) => ts.map((x) => (x.id === tache.id ? { ...x, faite: !tache.faite } : x)));
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (erreur) return <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => { setErreur(''); void rafraichir(true); }} />;
  if (!donnees || !charge) return <IndicateurChargement langue={langue} />;

  const aujourdhuiCle = cleJour(new Date());

  return (
    <div className="colonnes agenda">
      <section className="carte cal-carte">
        <h2>
          <span className="cal-titre">{MOIS[(vueCal === 'mois' ? mois : semaineRef).getMonth()]} {(vueCal === 'mois' ? mois : semaineRef).getFullYear()}</span>
          <span className="cal-nav">
            {(['jour', 'semaine', 'mois'] as VueCal[]).map((v) => (
              <button key={v} className={vueCal === v ? '' : 'discret'} onClick={() => setVueCal(v)}>
                {t(v === 'jour' ? 'vueJour' : v === 'semaine' ? 'vueSemaine' : 'vueMois', langue)}
              </button>
            ))}
            <button className="discret" aria-label={t('precedent', langue)} onClick={() => naviguer(-1)}>‹</button>
            <button className="discret"
              onClick={() => {
                const auj = new Date();
                setMois(new Date(auj.getFullYear(), auj.getMonth(), 1));
                setSemaineRef(auj);
              }}>{t('aujourdhui', langue)}</button>
            <button className="discret" aria-label={t('suivant', langue)} onClick={() => naviguer(1)}>›</button>
          </span>
        </h2>

        {vueCal === 'mois' ? (
          <>
            <table className="cal">
              <thead>
                <tr>{JOURS_SEMAINE.map((j) => <th key={j}>{j}</th>)}</tr>
              </thead>
              <tbody>
                {semainesMois.map((semaine, i) => (
                  <tr key={i}>
                    {semaine.map((j: JourGrille) => {
                      const evts = evenementsDuJour(evenements, j.date);
                      const dues = tachesDuJour(taches, j.date);
                      const estAuj = cleJour(j.date) === aujourdhuiCle;
                      return (
                        <td
                          key={cleJour(j.date)}
                          className={`${j.horsMois ? 'hors' : ''} ${estAuj ? 'auj' : ''}`}
                          onClick={() => ouvrirJour(j.date)}
                        >
                          <span className="num">{j.date.getDate()}</span>
                          {evts.map((e) => (
                            <span key={e.id} className={`ev ${e.parDriveAI ? 'ia' : ''}`}>
                              {heureEvenement(e) && `${heureEvenement(e)} `}{e.titre}
                            </span>
                          ))}
                          {dues.map((d) => (
                            <span key={d.id} className="ev tache">☐ {d.titre}</span>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="explication legende">
              <span className="ev ia">{t('legDriveAI', langue)}</span> <span className="ev">{t('legAgenda', langue)}</span>{' '}
              <span className="ev tache">☐ {t('legEcheance', langue)}</span>
            </p>
          </>
        ) : (
          <GrilleTemps
            langue={langue}
            jours={joursGrille}
            evenements={evenements}
            taches={taches}
            aujourdhuiCle={aujourdhuiCle}
            onEntete={ouvrirJour}
            onCreneau={(j, h) => setCreneau({ date: cleJour(j), heure: `${String(h).padStart(2, '0')}:00` })}
            onEvenement={(e) => setPopover({ genre: 'evenement', e })}
            onTache={(tache) => setPopover({ genre: 'tache', tache })}
          />
        )}
      </section>

      <section className="carte">
        <h2>{t('tachesOuvertes', langue)}</h2>
        {taches.length === 0 && <p className="explication">{t('aucuneTache', langue)}</p>}
        <table>
          <tbody>
            {taches.map((tk) => (
              <tr key={tk.id} className="ligne-clic">
                <td style={{ width: '1.8rem' }}>
                  <button
                    className="discret coche"
                    aria-label={tk.faite ? t('decocher', langue) : t('cocher', langue)}
                    onClick={() => basculerTache(tk)}
                  >
                    {tk.faite ? '☑' : '☐'}
                  </button>
                </td>
                <td onClick={() => setPopover({ genre: 'tache', tache: tk })}>
                  <span className={tk.faite ? 'faite' : ''}>{tk.titre}</span>
                  <div className="variante">
                    {tk.echeance && `${t('echeance', langue)} ${tk.echeance}`}
                    {tk.parDriveAI && ` · ${t('parDriveAI', langue)}`}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte">
        <h2>⏰ {t('aTraiter', langue)}</h2>
        {importants.length === 0 && <p className="explication">{t('aucunATraiter', langue)}</p>}
        <table>
          <tbody>
            {importants.map((l) => (
              <tr key={l.cle} className="ligne-clic" title={t('ouvrirMail', langue)}>
                <td>
                  <a className="lien-ligne" href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
                    {l.fichier}
                  </a>
                  <div className="variante">{formaterDateCourte(l.traiteLe, langue === 'fr' ? 'fr-CA' : 'en-CA')}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="explication">{t('aTraiterNote', langue)}</p>
      </section>

      {/* Clic sur un créneau vide (PR3) : création pré-remplie date+heure, en dialogue. */}
      {creneau && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setCreneau(null)} />
          <div className="dialogue" role="dialog" aria-label={t('creer', langue)}>
            <Creation
              langue={langue}
              typeInitial="rdv"
              dateInitiale={creneau.date}
              heureInitiale={creneau.heure}
              onCree={() => { setCreneau(null); void rafraichir(true); }}
            />
            <button className="discret" onClick={() => setCreneau(null)}>{t('fermer', langue)}</button>
          </div>
        </>
      )}

      {/* Popover d'un bloc (PR3) — remplace les panneaux Détail du bas de page. */}
      {popover && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setPopover(null)} />
          <div className="dialogue popover-ev" role="dialog" aria-label={popover.genre === 'evenement' ? popover.e.titre : popover.tache.titre}>
            {popover.genre === 'evenement' ? (
              <>
                <h3>{popover.e.titre}</h3>
                <p className="pe-ligne">
                  📅 {new Date(popover.e.journee ? popover.e.debut + 'T12:00:00' : popover.e.debut)
                    .toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <p className="pe-ligne">🕐 {popover.e.journee ? t('journee', langue) : libelleHoraire(popover.e, langue === 'fr')}</p>
                {popover.e.lieu && <p className="pe-ligne">📍 {popover.e.lieu}</p>}
                {popover.e.parDriveAI && <p className="pe-ligne variante">{t('parDriveAI', langue)}</p>}
                <div className="actions">
                  <a className="lien-bouton" href={popover.e.lien} target="_blank" rel="noreferrer">Agenda ↗</a>
                </div>
              </>
            ) : (
              <>
                <h3>{popover.tache.titre}</h3>
                <p className="pe-ligne">
                  🕐 {popover.tache.echeance
                    ? `${t('echeance', langue)} ${popover.tache.echeance}`
                    : t('sansEcheance', langue)}
                </p>
                {popover.tache.parDriveAI && <p className="pe-ligne variante">{t('parDriveAI', langue)}</p>}
                <div className="actions">
                  <button onClick={() => { void basculerTache(popover.tache); setPopover(null); }}>
                    {popover.tache.faite ? t('decocher', langue) : `☑ ${t('marquerFaite', langue)}`}
                  </button>
                  <a className="lien-bouton" href="https://tasks.google.com/" target="_blank" rel="noreferrer">Tasks ↗</a>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Grille HORAIRE façon Google Agenda (C28-23 PR2/PR3) : en-têtes de jours (pastille sur
 * aujourd'hui — clic = vue Jour), rangée « toute la journée » (événements journée + tâches à
 * échéance — clic = popover), gouttière d'heures, colonnes où chaque bloc est positionné en
 * ABSOLU (top/height en % — positionEvenement). Couleurs PAR TYPE (décision Marc) : bleu =
 * RDV perso, ambre = DriveAI, gris = journée entière. Ligne rouge « maintenant ». Un clic sur
 * un CRÉNEAU vide remonte le jour + l'heure (créés depuis la position Y du clic, plan PR3).
 */
function GrilleTemps({ langue, jours, evenements, taches, aujourdhuiCle, onEntete, onCreneau, onEvenement, onTache }: {
  langue: Langue;
  jours: JourGrille[];
  evenements: Evenement[];
  taches: Tache[];
  aujourdhuiCle: string;
  onEntete: (j: Date) => void;
  onCreneau: (j: Date, heure: number) => void;
  onEvenement: (e: Evenement) => void;
  onTache: (t: Tache) => void;
}) {
  const fr = langue === 'fr';
  const heures = Array.from({ length: 23 }, (_, i) => i + 1);
  const pctMaintenant = positionMaintenant(new Date());
  const gabarit = { gridTemplateColumns: `52px repeat(${jours.length}, 1fr)` };

  return (
    <div className="grille-temps">
      <div className="gt-rang" style={gabarit}>
        <div />
        {jours.map((j) => {
          const auj = cleJour(j.date) === aujourdhuiCle;
          return (
            <button key={cleJour(j.date)} className={'gt-entete' + (auj ? ' auj' : '')} onClick={() => onEntete(j.date)}>
              <span className="gt-nom">{JOURS_SEMAINE[(j.date.getDay() + 6) % 7]}</span>
              <span className="gt-num">{j.date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="gt-rang gt-tj" style={gabarit}>
        <div />
        {jours.map((j) => {
          const journee = evenementsDuJour(evenements, j.date).filter((e) => e.journee);
          const dues = tachesDuJour(taches, j.date);
          return (
            <div key={cleJour(j.date)} className="gt-tj-col">
              {journee.map((e) => (
                <button key={e.id} className="gt-bloc-tj" onClick={() => onEvenement(e)}>{e.titre}</button>
              ))}
              {dues.map((d) => (
                <button key={d.id} className="gt-bloc-tj ia" onClick={() => onTache(d)}>☐ {d.titre}</button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="gt-rang gt-corps" style={gabarit}>
        <div className="gt-gouttiere">
          {heures.map((h) => (
            <span key={h} style={{ top: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>
          ))}
        </div>
        {jours.map((j) => {
          const auj = cleJour(j.date) === aujourdhuiCle;
          const evts = evenementsDuJour(evenements, j.date).filter((e) => !e.journee);
          return (
            <div
              key={cleJour(j.date)}
              className="gt-col"
              onClick={(ev) => {
                // Heure du CLIC dérivée de la position Y dans la colonne (plan PR3).
                const h = Math.max(0, Math.min(23, Math.floor((ev.nativeEvent.offsetY / ev.currentTarget.clientHeight) * 24)));
                onCreneau(j.date, h);
              }}
            >
              {evts.map((e) => {
                const pos = positionEvenement(e);
                if (!pos) return null;
                return (
                  <button
                    key={e.id}
                    className={'gt-ev' + (e.parDriveAI ? ' ia' : '')}
                    style={{ top: `${pos.top}%`, height: `${pos.hauteur}%` }}
                    onClick={(ev) => { ev.stopPropagation(); onEvenement(e); }}
                  >
                    <b>{e.titre}</b>
                    <span>{libelleHoraire(e, fr)}</span>
                    {e.lieu && <span>{e.lieu}</span>}
                  </button>
                );
              })}
              {auj && <i className="gt-maintenant" style={{ top: `${pctMaintenant}%` }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
