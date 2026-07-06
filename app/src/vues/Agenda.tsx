/**
 * Agenda.tsx — vue v3 (C19-05, ADR-0013) : vrai calendrier (grille mois), tâches Google,
 * mails ⏰, création directe. Clic sur un jour → détail du jour ; clic sur une tâche → détail.
 * Écritures : créer (tâche/RDV) et cocher — jamais supprimer ni modifier l'existant.
 */

import { useEffect, useState } from 'react';
import { lirePlage, listerEvenements, listerTaches, creerTache, creerEvenement, cocherTache } from '../google';
import {
  Evenement,
  Tache,
  JourGrille,
  grilleMois,
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  titresDriveAI,
} from '../agenda';
import { interpreterIndex, lignesImportants, lienGmailPourLigne, LigneIndex } from '../etat';
import { Langue, t } from '../i18n';

const JOURS_SEMAINE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

type Detail = { type: 'jour'; jour: Date } | { type: 'tache'; tache: Tache };

export function Agenda({ langue }: { langue: Langue }) {
  const maintenant = new Date();
  const [mois, setMois] = useState(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [importants, setImportants] = useState<LigneIndex[]>([]);
  const [detail, setDetail] = useState<Detail>({ type: 'jour', jour: maintenant });
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');

  const semaines = grilleMois(mois.getFullYear(), mois.getMonth());

  useEffect(() => {
    (async () => {
      try {
        setCharge(false);
        const debut = semaines[0][0].date;
        const finJour = semaines[semaines.length - 1][6].date;
        const fin = new Date(finJour.getFullYear(), finJour.getMonth(), finJour.getDate() + 1);
        const [evts, tks, idx] = await Promise.all([
          listerEvenements(debut.toISOString(), fin.toISOString()),
          listerTaches(),
          lirePlage('Index', 'A2:H20000'),
        ]);
        const lignes = interpreterIndex(idx);
        const marques = titresDriveAI(lignes);
        setEvenements(interpreterEvenements(evts, marques));
        setTaches(interpreterTaches(tks, marques));
        setImportants(lignesImportants(lignes).slice(0, 8));
        setCharge(true);
      } catch (e) {
        setErreur(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mois]);

  async function basculerTache(tache: Tache) {
    try {
      await cocherTache(tache.id, !tache.faite);
      setTaches((ts) => ts.map((x) => (x.id === tache.id ? { ...x, faite: !tache.faite } : x)));
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!charge) return <p>{t('chargement', langue)}</p>;

  const aujourdhuiCle = cleJour(new Date());

  return (
    <div className="colonnes agenda">
      <section className="carte cal-carte">
        <h2>
          <span className="cal-titre">{MOIS[mois.getMonth()]} {mois.getFullYear()}</span>
          <span className="cal-nav">
            <button className="discret" aria-label="Mois précédent"
              onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() - 1, 1))}>‹</button>
            <button className="discret"
              onClick={() => {
                const auj = new Date();
                setMois(new Date(auj.getFullYear(), auj.getMonth(), 1));
                setDetail({ type: 'jour', jour: auj });
              }}>{t('aujourdhui', langue)}</button>
            <button className="discret" aria-label="Mois suivant"
              onClick={() => setMois(new Date(mois.getFullYear(), mois.getMonth() + 1, 1))}>›</button>
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
                  <div className="variante">{l.traiteLe}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="explication">{t('aTraiterNote', langue)}</p>
      </section>

      <Creation langue={langue} onCree={() => setMois(new Date(mois))} />
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

/** Création directe (choix Marc) : tâche ou RDV, dans SON Google — l'app crée, ne supprime jamais. */
function Creation({ langue, onCree }: { langue: Langue; onCree: () => void }) {
  const [type, setType] = useState<'tache' | 'rdv'>('tache');
  const [titre, setTitre] = useState('');
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('09:00');
  const [statut, setStatut] = useState('');

  async function creer() {
    setStatut('');
    try {
      if (type === 'tache') await creerTache(titre, date || undefined);
      else await creerEvenement(titre, `${date}T${heure}`);
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
