/**
 * Sante.tsx — vue v3 (C19-08, ADR-0013) : l'état du moteur en un écran.
 * Moteur (lignes Santé) · quotas (signal dérivé du Journal) · coût LLM · quarantaine + relance
 * (l'app APPEND une demande, le moteur agit au tick) · dernières erreurs du Journal.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ajouterLigne } from '../google';
import {
  Sante as ModeleSante,
  LigneJournal,
  LigneIndex,
  interpreterSante,
  interpreterJournal,
  interpreterIndex,
  lignesQuarantaine,
  coutDepuisSante,
  dernierPassageDepuisSante,
  quotaGmailEpuise,
  erreursRecentes,
} from '../etat';
import { Langue, t } from '../i18n';

const JOURNAL_RECENT = 20;
const BUDGET_LLM = 10;

export function SanteVue({ langue }: { langue: Langue }) {
  const [sante, setSante] = useState<ModeleSante | null>(null);
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, j, i] = await Promise.all([
          lirePlage('Santé', 'A2:A10'),
          lirePlage('Journal', 'A2:D5000'),
          lirePlage('Index', 'A2:H20000'),
        ]);
        setSante(interpreterSante(s));
        setJournal(interpreterJournal(j));
        setIndex(interpreterIndex(i));
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, []);

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!sante) return <p>{t('chargement', langue)}</p>;

  const maintenant = new Date();
  const passage = dernierPassageDepuisSante(sante.lignes);
  const cout = coutDepuisSante(sante.lignes);
  const quotaMort = quotaGmailEpuise(journal, maintenant);
  const erreurs7j = erreursRecentes(journal, 7, maintenant);
  const quarantaine = lignesQuarantaine(index);
  const recents = journal.slice(-JOURNAL_RECENT).reverse();

  return (
    <div className="colonnes">
      <section className="carte">
        <h2>{t('moteur', langue)}</h2>
        <ul className="sante">
          {passage && (
            <li><span className="point-ok" aria-hidden="true" /> {t('dernierPassage', langue)} {passage}</li>
          )}
          {sante.lignes
            .filter((l) => !l.startsWith('Dernier passage'))
            .map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </section>

      <section className="carte">
        <h2>{t('quotas', langue)}</h2>
        <p className="statut-quota">
          <span className={`pastille ${quotaMort ? 'crit' : 'ok'}`}>
            {quotaMort ? t('quotaEpuise', langue) : 'OK'}
          </span>{' '}
          {t('quotaGmail', langue)}
        </p>
        {quotaMort && <p className="explication">{t('quotaNote', langue)}</p>}
        {cout && (
          <>
            <p className="statut-quota" style={{ marginTop: '0.8rem' }}>
              <span className="pastille douce">{cout.dollars.toFixed(2)} $ / {BUDGET_LLM} $</span>{' '}
              {t('coutLlm', langue)} · {cout.appels.toLocaleString('fr-CA')} {t('appels', langue)}
            </p>
            <div className="jauge"><i style={{ width: `${Math.min(100, (cout.dollars / BUDGET_LLM) * 100)}%` }} /></div>
          </>
        )}
        <p className="statut-quota" style={{ marginTop: '0.8rem' }}>
          <span className={`pastille ${erreurs7j ? 'douce' : 'ok'}`}>{erreurs7j}</span> {t('erreurs7j', langue)}
        </p>
      </section>

      <QuarantaineSection langue={langue} lignes={quarantaine} />

      <section className="carte large">
        <h2>{t('activiteRecente', langue)}</h2>
        <table>
          <tbody>
            {recents.map((l, i) => (
              <tr key={i} className={l.niveau === 'ERREUR' ? 'ligne-erreur' : ''}>
                <td className="date">{l.date}</td>
                <td>{l.source}</td>
                <td>{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Quarantaine : liste + « Relancer » — l'app APPEND une demande (onglet Relances), le MOTEUR agit au tick. */
function QuarantaineSection({ langue, lignes }: { langue: Langue; lignes: LigneIndex[] }) {
  const [relances, setRelances] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState('');

  async function relancer(l: LigneIndex) {
    try {
      await ajouterLigne('Relances', [l.cle, new Date().toISOString()]);
      setRelances((s) => new Set(s).add(l.cle));
    } catch (e) {
      setErreur(String(e));
    }
  }

  return (
    <section className="carte large">
      <h2>{t('quarantaine', langue)}</h2>
      {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
      {lignes.length === 0 && <p className="explication">{t('aucuneQuarantaine', langue)}</p>}
      <table>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <td>{l.fichier}</td>
              <td className="date">{l.traiteLe}</td>
              <td className="nombre">
                {relances.has(l.cle) ? (
                  <span className="ok">{t('relance', langue)}</span>
                ) : (
                  <button className="discret" onClick={() => relancer(l)}>{t('relancer', langue)}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
