/**
 * Agenda.tsx — vue v5 « clone Google Agenda » (C28-23 PR2, plan architecte) : grille HORAIRE
 * absolue Jour/Semaine/Mois (Semaine par défaut — décision Marc), rangée « toute la journée »,
 * gouttière d'heures, blocs positionnés/dimensionnés à la minute, couleurs PAR TYPE (RDV perso /
 * DriveAI / journée), ligne « maintenant », 3 jours glissants sur mobile. Tâches Google, mails ⏰
 * et création directe conservés. Écritures : créer et cocher — jamais supprimer ni modifier.
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

type Detail = { type: 'jour'; jour: Date } | { type: 'tache'; tache: Tache };
type VueCal = 'jour' | 'semaine' | 'mois';

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

export function Agenda({ langue }: { langue: Langue }) {
  const maintenant = new Date();
  const [mois, setMois] = useState(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const [vueCal, setVueCal] = useState<VueCal>('semaine'); // Semaine par défaut (C28-23)
  const [semaineRef, setSemaineRef] = useState(maintenant);
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [importants, setImportants] = useState<LigneIndex[]>([]);
  const [detail, setDetail] = useState<Detail>({ type: 'jour', jour: maintenant });
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const etroit = useEstEtroit();

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

  // L'Index vient de l'état PARTAGÉ (P1/C28-02) ; Tasks/Calendar restent chargés ICI (la plage
  // dépend du mois affiché) mais se re-chargent AUSSI à chaque synchro globale (dep synchroA) —
  // l'agenda ouvert ne reste plus figé sur sa photo d'ouverture.
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

  // Le retry RELANCE vraiment (synchro globale forcée → l'effet [synchroA] re-charge Tasks/Calendar) ;
  // et une fois chargé une première fois, l'agenda reste AFFICHÉ pendant les re-lectures (pas de
  // clignotement « Chargement… » toutes les 5 min) — même politique que le fournisseur global.
  if (erreur) return <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => { setErreur(''); void rafraichir(true); }} />;
  if (!donnees || !charge) return <IndicateurChargement langue={langue} />;

  const aujourdhuiCle = cleJour(new Date());

  return (
    <div className="colonnes agenda">
      {/* Carte « Créer » EN TÊTE (C28-05, plan P2 : découvrabilité — elle existait mais en bas de page). */}
      <Creation langue={langue} onCree={() => setMois(new Date(mois))} />

      <section className="carte cal-carte">
        <h2>
          <span className="cal-titre">{MOIS[(vueCal === 'mois' ? mois : semaineRef).getMonth()]} {(vueCal === 'mois' ? mois : semaineRef).getFullYear()}</span>
          <span className="cal-nav">
            {(['jour', 'semaine', 'mois'] as VueCal[]).map((v) => (
              <button key={v} className={vueCal === v ? '' : 'discret'}
                onClick={() => { setVueCal(v); if (v !== 'mois') setSemaineRef(detail.type === 'jour' ? detail.jour : new Date()); }}>
                {t(v === 'jour' ? 'vueJour' : v === 'semaine' ? 'vueSemaine' : 'vueMois', langue)}
              </button>
            ))}
            <button className="discret" aria-label={t('precedent', langue)} onClick={() => naviguer(-1)}>‹</button>
            <button className="discret"
              onClick={() => {
                const auj = new Date();
                setMois(new Date(auj.getFullYear(), auj.getMonth(), 1));
                setSemaineRef(auj);
                setDetail({ type: 'jour', jour: auj });
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
                      const sel = detail.type === 'jour' && cleJour(detail.jour) === cleJour(j.date);
                      return (
                        <td
                          key={cleJour(j.date)}
                          className={`${j.horsMois ? 'hors' : ''} ${estAuj ? 'auj' : ''} ${sel ? 'sel' : ''}`}
                          onClick={() => setDetail({ type: 'jour', jour: j.date })}
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
            onJour={(j) => setDetail({ type: 'jour', jour: j })}
          />
        )}
      </section>

      <section className="carte">
        {detail.type === 'jour' ? (
          <DetailJour langue={langue} jour={detail.jour} evenements={evenements} taches={taches} />
        ) : (
          <DetailTache langue={langue} tache={detail.tache} onBasculer={basculerTache} />
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
                <td onClick={() => setDetail({ type: 'tache', tache: tk })}>
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
    </div>
  );
}

/**
 * Grille HORAIRE façon Google Agenda (C28-23 PR2) : en-têtes de jours (pastille sur
 * aujourd'hui), rangée « toute la journée » (événements journée + tâches à échéance),
 * gouttière d'heures, colonnes où chaque bloc est positionné en ABSOLU (top/height en % —
 * positionEvenement). Couleurs PAR TYPE (décision Marc) : bleu = RDV perso, ambre = DriveAI
 * (événements du moteur + tâches), gris = journée entière. Ligne rouge « maintenant » dans la
 * colonne du jour. Un clic sur un bloc ouvre Google Agenda (le popover arrive en PR3).
 */
function GrilleTemps({ langue, jours, evenements, taches, aujourdhuiCle, onJour }: {
  langue: Langue;
  jours: JourGrille[];
  evenements: Evenement[];
  taches: Tache[];
  aujourdhuiCle: string;
  onJour: (j: Date) => void;
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
            <button key={cleJour(j.date)} className={'gt-entete' + (auj ? ' auj' : '')} onClick={() => onJour(j.date)}>
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
              {journee.map((e) => <span key={e.id} className="gt-bloc-tj">{e.titre}</span>)}
              {dues.map((d) => <span key={d.id} className="gt-bloc-tj ia">☐ {d.titre}</span>)}
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
            <div key={cleJour(j.date)} className="gt-col" onClick={() => onJour(j.date)}>
              {evts.map((e) => {
                const pos = positionEvenement(e);
                if (!pos) return null;
                return (
                  <a
                    key={e.id}
                    className={'gt-ev' + (e.parDriveAI ? ' ia' : '')}
                    style={{ top: `${pos.top}%`, height: `${pos.hauteur}%` }}
                    href={e.lien} target="_blank" rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <b>{e.titre}</b>
                    <span>{libelleHoraire(e, fr)}</span>
                    {e.lieu && <span>{e.lieu}</span>}
                  </a>
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

function DetailJour({ langue, jour, evenements, taches }:
  { langue: Langue; jour: Date; evenements: Evenement[]; taches: Tache[] }) {
  const evts = evenementsDuJour(evenements, jour);
  const dues = tachesDuJour(taches, jour);
  const titre = jour.toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA',
    { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <h2>{titre}</h2>
      {evts.length === 0 && dues.length === 0 && <p className="explication">{t('rienCeJour', langue)}</p>}
      {evts.map((e) => (
        <div key={e.id} className="det-ligne">
          <span className={`pastille ${e.parDriveAI ? 'douce' : 'cat'}`}>{heureEvenement(e) || t('journee', langue)}</span>
          <span>
            {e.titre}
            {e.parDriveAI && <div className="variante">{t('parDriveAI', langue)}</div>}
          </span>
          <a className="det-lien" href={e.lien} target="_blank" rel="noreferrer">Agenda ↗</a>
        </div>
      ))}
      {dues.map((d) => (
        <div key={d.id} className="det-ligne">
          <span className="pastille douce">{t('echeance', langue)}</span>
          <span>☐ {d.titre}</span>
        </div>
      ))}
    </>
  );
}

function DetailTache({ langue, tache, onBasculer }:
  { langue: Langue; tache: Tache; onBasculer: (t: Tache) => void }) {
  return (
    <>
      <h2>{t('tache', langue)}</h2>
      <div className="det-ligne">
        <span>
          <span className={tache.faite ? 'faite' : ''}>{tache.titre}</span>
          <div className="variante">
            {tache.echeance ? `${t('echeance', langue)} ${tache.echeance}` : t('sansEcheance', langue)}
            {tache.parDriveAI && ` · ${t('parDriveAI', langue)}`}
          </div>
        </span>
      </div>
      <div className="actions" style={{ marginTop: '0.6rem' }}>
        <button onClick={() => onBasculer(tache)}>
          {tache.faite ? t('decocher', langue) : `☑ ${t('marquerFaite', langue)}`}
        </button>
        <a className="lien-bouton" href="https://tasks.google.com/" target="_blank" rel="noreferrer">Tasks ↗</a>
      </div>
    </>
  );
}
