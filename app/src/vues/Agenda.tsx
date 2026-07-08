/**
 * Agenda.tsx — vue v3 (C19-05, ADR-0013) : vrai calendrier (grille mois), tâches Google,
 * mails ⏰, création directe. Clic sur un jour → détail du jour ; clic sur une tâche → détail.
 * Écritures : créer (tâche/RDV) et cocher — jamais supprimer ni modifier l'existant.
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
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  titresDriveAI,
} from '../agenda';
import { lignesImportants, lienGmailPourLigne, LigneIndex } from '../etat';
import { formaterDateCourte } from '../explorateur';
import { Langue, t } from '../i18n';

const JOURS_SEMAINE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

type Detail = { type: 'jour'; jour: Date } | { type: 'tache'; tache: Tache };

export function Agenda({ langue }: { langue: Langue }) {
  const maintenant = new Date();
  const [mois, setMois] = useState(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const [vueCal, setVueCal] = useState<'mois' | 'semaine'>('mois'); // C28-04 : toggle Mois/Semaine
  const [semaineRef, setSemaineRef] = useState(maintenant);
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [importants, setImportants] = useState<LigneIndex[]>([]);
  const [detail, setDetail] = useState<Detail>({ type: 'jour', jour: maintenant });
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');

  // La plage Tasks/Calendar chargée reste TOUJOURS celle de la grille du MOIS : la semaine
  // affichée est un sous-ensemble (la navigation semaine garde `mois` aligné sur sa référence),
  // donc changer de vue ou de semaine dans le même mois ne re-fetch rien.
  const semainesMois = grilleMois(mois.getFullYear(), mois.getMonth());
  const semaines = vueCal === 'semaine' ? [grilleSemaine(semaineRef)] : semainesMois;

  /** Navigation ‹ › : ±1 mois (vue mois) ou ±7 jours (vue semaine, `mois` suit la référence). */
  function naviguer(sens: 1 | -1) {
    if (vueCal === 'mois') {
      setMois(new Date(mois.getFullYear(), mois.getMonth() + sens, 1));
    } else {
      const ref = new Date(semaineRef.getFullYear(), semaineRef.getMonth(), semaineRef.getDate() + 7 * sens);
      setSemaineRef(ref);
      if (ref.getMonth() !== mois.getMonth() || ref.getFullYear() !== mois.getFullYear()) {
        setMois(new Date(ref.getFullYear(), ref.getMonth(), 1));
      }
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
          <span className="cal-titre">{MOIS[mois.getMonth()]} {mois.getFullYear()}</span>
          <span className="cal-nav">
            <button className={vueCal === 'mois' ? '' : 'discret'} onClick={() => setVueCal('mois')}>
              {t('vueMois', langue)}
            </button>
            <button className={vueCal === 'semaine' ? '' : 'discret'}
              onClick={() => { setVueCal('semaine'); setSemaineRef(detail.type === 'jour' ? detail.jour : new Date()); }}>
              {t('vueSemaine', langue)}
            </button>
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
        <table className="cal">
          <thead>
            <tr>{JOURS_SEMAINE.map((j) => <th key={j}>{j}</th>)}</tr>
          </thead>
          <tbody>
            {semaines.map((semaine, i) => (
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
