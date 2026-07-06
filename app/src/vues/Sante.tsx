/**
 * Sante.tsx — vue v3 (C19-08, ADR-0013) : l'état du moteur en un écran.
 * Moteur (lignes Santé) · quotas (signal dérivé du Journal) · coût LLM · quarantaine + relance
 * (l'app APPEND une demande, le moteur agit au tick) · dernières erreurs du Journal.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ajouterLigne, ecrireCellule } from '../google';
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
  const [tickInitial, setTickInitial] = useState('');
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, j, i, r] = await Promise.all([
          lirePlage('Santé', 'A2:A10'),
          lirePlage('Journal', 'A2:D5000'),
          lirePlage('Index', 'A2:H20000'),
          // Onglet créé par le moteur au premier tick après déploiement — absent = défaut, pas une erreur.
          lirePlage('Réglages', 'A2:B2').catch(() => [] as string[][]),
        ]);
        setSante(interpreterSante(s));
        setJournal(interpreterJournal(j));
        setIndex(interpreterIndex(i));
        setTickInitial(r?.[0]?.[1] ?? '');
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

      <ReglagesSection langue={langue} valeurInitiale={tickInitial} />

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

/**
 * Réglages (#22, choix Marc : UN réglage global) : fréquence des passages du moteur.
 * L'app écrit `Réglages!A2:B2` (contrat de position fixe) ; le moteur relit au tick suivant
 * et ré-installe son déclencheur (assurerIntervalleTick_). Whitelist 5/10/15/30 — les mêmes
 * valeurs que le moteur accepte (validerTickMinutes_), jamais de saisie libre.
 */
const TICKS_MINUTES = [5, 10, 15, 30];

function ReglagesSection({ langue, valeurInitiale }: { langue: Langue; valeurInitiale: string }) {
  const initiale = TICKS_MINUTES.includes(Number(valeurInitiale)) ? String(Number(valeurInitiale)) : '5';
  const [tick, setTick] = useState(initiale);
  const [statut, setStatut] = useState('');

  async function changer(v: string) {
    setTick(v);
    setStatut('');
    try {
      // A2 réécrit aussi (auto-réparation si la clé a été effacée à la main).
      await ecrireCellule('Réglages', 'A2', 'TICK_MINUTES');
      await ecrireCellule('Réglages', 'B2', v);
      setStatut('ok');
    } catch (e) {
      setStatut(String(e));
    }
  }

  return (
    <section className="carte">
      <h2>{t('reglages', langue)}</h2>
      <p className="statut-quota">{t('frequenceTick', langue)}</p>
      <div className="ligne-formulaire">
        <select value={tick} onChange={(e) => changer(e.target.value)} aria-label={t('frequenceTick', langue)}>
          {TICKS_MINUTES.map((m) => (
            <option key={m} value={String(m)}>{t('toutesLes', langue)} {m} min</option>
          ))}
        </select>
        {statut === 'ok' && <span className="ok">{t('reglageOk', langue)}</span>}
      </div>
      {statut && statut !== 'ok' && <p className="erreur">{statut}</p>}
      <p className="explication">{t('reglageNote', langue)}</p>
    </section>
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
