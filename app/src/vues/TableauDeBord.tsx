/**
 * TableauDeBord.tsx — surface n°2 de l'ADR-0008 : santé du moteur + activité récente.
 * Lecture seule (Santé + Journal + Index) — version riche de l'onglet Santé.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ajouterLigne } from '../google';
import {
  Sante,
  LigneJournal,
  LigneIndex,
  interpreterSante,
  interpreterJournal,
  interpreterIndex,
  compterParDomaine,
  lignesQuarantaine,
  lignesActions,
  lignesImportants,
  lienGmailPourLigne,
  activiteParJour,
} from '../etat';
import { Langue, t } from '../i18n';

const JOURNAL_RECENT = 15;
const INDEX_RECENT = 500; // fenêtre du comptage par domaine (dernières lignes — pas toute la Sheet)
const ACTIONS_RECENTES = 30; // « Actions & RDV » et « À traiter » : les N plus récentes (C13)

export function TableauDeBord({ langue }: { langue: Langue }) {
  const [sante, setSante] = useState<Sante | null>(null);
  const [journal, setJournal] = useState<LigneJournal[]>([]);
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, j, i] = await Promise.all([
          lirePlage('Santé', 'A2:A10'),
          lirePlage('Journal', 'A2:D5000'),
          lirePlage('Index', 'A2:F20000'),
        ]);
        setSante(interpreterSante(s));
        setJournal(interpreterJournal(j).slice(-JOURNAL_RECENT).reverse());
        setIndex(interpreterIndex(i)); // COMPLET : la quarantaine (état ancien par nature) et l'activité
        // ne doivent jamais être tronquées ; seul le comptage par domaine se borne à l'affichage.
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, []);

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!sante) return <p>{t('chargement', langue)}</p>;

  // Les lignes qui tracent des E-MAILS (Phase 3 : intention|/tache|/event|/important|) ne sont pas
  // des documents : les agrégats « documents » les excluent (même filtre que la Recherche) — sinon
  // chaque mail important compterait double dans l'activité et gonflerait le bucket « — » des
  // domaines. Elles ont leurs sections dédiées ci-dessous.
  const docs = index.filter((l) => !/^(intention|tache|event|important)\|/.test(l.cle));
  const parDomaine = Array.from(compterParDomaine(docs.slice(-INDEX_RECENT))).sort((a, b) => b[1] - a[1]);
  const activite = activiteParJour(docs, 30, new Date());
  const maxJour = Math.max(1, ...activite.map((a) => a.n));
  const quarantaine = lignesQuarantaine(index);
  const actions = lignesActions(index).slice(0, ACTIONS_RECENTES);
  const importants = lignesImportants(index).slice(0, ACTIONS_RECENTES);

  return (
    <div className="colonnes">
      <section className="carte">
        <h2>{t('sante', langue)}</h2>
        <ul className="sante">
          {sante.lignes.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="carte">
        <h2>{t('documentsParDomaine', langue)}</h2>
        <table>
          <tbody>
            {parDomaine.map(([domaine, n]) => (
              <tr key={domaine}>
                <td>{domaine}</td>
                <td className="nombre">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte large">
        <h2>{t('activite30j', langue)}</h2>
        <div className="barres" role="img" aria-label={t('activite30j', langue)}>
          {activite.map((a) => (
            <div
              key={a.jour}
              className="barre"
              style={{ height: `${Math.round((a.n / maxJour) * 100)}%` }}
              title={`${a.jour} : ${a.n}`}
            />
          ))}
        </div>
      </section>

      {/* C14 (ADR-0010 §3) : mails qui demandent l'attention de Marc — lien direct, lecture seule. */}
      <section className="carte large">
        <h2>📌 {t('aTraiter', langue)}</h2>
        {importants.length === 0 && <p>{t('aucunATraiter', langue)}</p>}
        <table>
          <tbody>
            {importants.map((l) => (
              <tr key={l.cle}>
                <td>{l.fichier}</td>
                <td className="date">{l.traiteLe}</td>
                <td>
                  <a href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
                    {t('ouvrirMail', langue)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* C13 (ADR-0010 §2) : la Phase 3 devient visible — ce que le moteur a créé, nommément. */}
      <section className="carte large">
        <h2>🗓️ {t('actionsRdv', langue)}</h2>
        {actions.length === 0 && <p>{t('aucuneAction', langue)}</p>}
        <table>
          <tbody>
            {actions.map((l) => (
              <tr key={l.cle}>
                <td>{l.statut === 'evenement' ? '📅' : '✅'}</td>
                <td>{l.fichier}</td>
                <td className="date">{l.traiteLe}</td>
                <td>
                  {lienGmailPourLigne(l) && (
                    <a href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
                      {t('ouvrirMail', langue)}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <QuarantaineSection langue={langue} lignes={quarantaine} />

      <section className="carte large">
        <h2>{t('activiteRecente', langue)}</h2>
        <table>
          <tbody>
            {journal.map((l, i) => (
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
      {lignes.length === 0 && <p>{t('aucuneQuarantaine', langue)}</p>}
      <table>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle}>
              <td>{l.fichier}</td>
              <td className="date">{l.traiteLe}</td>
              <td>
                {relances.has(l.cle) ? (
                  <span className="ok">{t('relance', langue)}</span>
                ) : (
                  <button onClick={() => relancer(l)}>{t('relancer', langue)}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}