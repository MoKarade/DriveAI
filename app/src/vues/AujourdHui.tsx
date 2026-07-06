/**
 * AujourdHui.tsx — vue d'accueil v3 (C19-04, ADR-0013) : l'essentiel en un écran.
 * Tuiles (docs, coût, tri, suspects) · activité 30 j · ⚠ suspects (clic → Gmail) ·
 * derniers fils triés (clic → Gmail) · derniers classements (clic → Drive).
 * Lecture seule (Santé + Index) — mêmes plages que la v2.
 */

import { useEffect, useState } from 'react';
import { lirePlage } from '../google';
import {
  LigneIndex,
  Sante,
  interpreterIndex,
  interpreterSante,
  activiteParJour,
  lignesTri,
  lignesSuspects,
  statsTri,
  traitesLeJour,
  coutDepuisSante,
  dernierPassageDepuisSante,
  lienGmailPourLigne,
  lienDrivePourLigne,
} from '../etat';
import { Langue, t } from '../i18n';

const BUDGET_LLM = 10; // cible < 10 $/mois (CLAUDE.md §2)
const TRI_RECENTS = 6;
const CLASSEMENTS_RECENTS = 6;
const SUSPECTS_MAX = 5;

export function AujourdHui({ langue }: { langue: Langue }) {
  const [sante, setSante] = useState<Sante | null>(null);
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [survol, setSurvol] = useState<{ jour: string; n: number } | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, i] = await Promise.all([
          lirePlage('Santé', 'A2:A10'),
          lirePlage('Index', 'A2:H20000'),
        ]);
        setSante(interpreterSante(s));
        setIndex(interpreterIndex(i));
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, []);

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!sante) return <p>{t('chargement', langue)}</p>;

  const maintenant = new Date();
  // Documents seuls (les lignes mail — intention/tache/event/important/tri — ont leurs sections).
  const docs = index.filter((l) => !/^(intention|tache|event|important|tri(-abandon)?)\|/.test(l.cle));
  const classes = docs.filter((l) => l.statut === 'classé');
  const aujourdhui = traitesLeJour(docs, maintenant);
  const cout = coutDepuisSante(sante.lignes);
  const passage = dernierPassageDepuisSante(sante.lignes);
  const tri7j = statsTri(index, 7, maintenant);
  const suspects = lignesSuspects(index).slice(0, SUSPECTS_MAX);
  const tris = lignesTri(index).slice(0, TRI_RECENTS);
  const classements = classes.slice(-CLASSEMENTS_RECENTS).reverse();
  const activite = activiteParJour(docs, 30, maintenant);
  const maxJour = Math.max(1, ...activite.map((a) => a.n));

  return (
    <div className="colonnes">
      {passage && (
        <p className="statut-moteur large">
          <span className="point-ok" aria-hidden="true" /> {t('dernierPassage', langue)} {passage}
        </p>
      )}

      <div className="tuiles large">
        <div className="tuile">
          <div className="v">{classes.length.toLocaleString('fr-CA')}</div>
          <div className="l">{t('docsClasses', langue)}</div>
          {aujourdhui > 0 && <div className="d ok">+{aujourdhui} {t('aujourdhuiCourt', langue)}</div>}
        </div>
        <div className="tuile">
          <div className="v">
            {cout ? cout.dollars.toFixed(2) : '—'} <small>$ / {BUDGET_LLM}</small>
          </div>
          <div className="l">{t('coutLlm', langue)}</div>
          {cout && (
            <div className="jauge" role="img" aria-label={`${cout.dollars.toFixed(2)} $ / ${BUDGET_LLM} $`}>
              <i style={{ width: `${Math.min(100, (cout.dollars / BUDGET_LLM) * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="tuile">
          <div className="v">{tri7j.tries}</div>
          <div className="l">{t('filsTries7j', langue)}</div>
          {tri7j.aVerifier > 0 && <div className="d">{tri7j.aVerifier} {t('dontAVerifier', langue)}</div>}
        </div>
        <div className="tuile">
          <div className={`v ${suspects.length ? 'erreur' : ''}`}>{suspects.length}</div>
          <div className="l">{t('suspectsEnBoite', langue)}</div>
        </div>
      </div>

      {suspects.length > 0 && (
        <section className="carte large">
          <h2>⚠ {t('suspectsTitre', langue)}</h2>
          {suspects.map((l) => (
            <a key={l.cle} className="alerte-suspect" href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
              <span className="ic" aria-hidden="true">!</span>
              <span>
                <b>{l.fichier}</b>
                <span className="date"> · {l.traiteLe}</span>
              </span>
            </a>
          ))}
          <p className="explication">{t('suspectsNote', langue)}</p>
        </section>
      )}

      <section className="carte large">
        <h2>
          {t('activite30j', langue)}
          <span className="graphe-valeur">{survol ? `${survol.jour} — ${survol.n} ${t('docsCourt', langue)}` : ''}</span>
        </h2>
        <div className="barres" role="img" aria-label={t('activite30j', langue)} onPointerLeave={() => setSurvol(null)}>
          {activite.map((a) => (
            <div
              key={a.jour}
              className={`barre ${survol?.jour === a.jour ? 'survol' : ''}`}
              style={{ height: `${Math.round((a.n / maxJour) * 100)}%` }}
              onPointerEnter={() => setSurvol(a)}
              onPointerDown={() => setSurvol(a)}
            />
          ))}
        </div>
      </section>

      <section className="carte">
        <h2>{t('filsTriesTitre', langue)}</h2>
        {tris.length === 0 && <p className="explication">{t('aucunTri', langue)}</p>}
        <table>
          <tbody>
            {tris.map((l) => (
              <tr key={l.cle} className="ligne-clic" title={t('ouvrirMail', langue)}>
                <td>
                  <a href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                    {l.fichier || '(sans sujet)'}
                  </a>
                </td>
                <td className="nombre">
                  <span className={`pastille ${l.statut === 'suspect' ? 'crit' : l.statut === 'tri-a-verifier' ? 'douce' : 'ok'}`}>
                    {l.statut === 'trié' ? t('trie', langue) : l.statut === 'tri-a-verifier' ? t('aVerifier', langue) : '⚠'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte">
        <h2>{t('derniersClassements', langue)}</h2>
        <table>
          <tbody>
            {classements.map((l) => (
              <tr key={l.cle} className="ligne-clic" title="Drive">
                <td>
                  <a href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                    {l.fichier}
                  </a>
                  <div className="variante">{l.domaine}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
