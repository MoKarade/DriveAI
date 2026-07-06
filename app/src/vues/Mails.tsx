/**
 * Mails.tsx — vue v3 (C19-06, ADR-0013) : le tri Gmail (#16) visible et corrigeable.
 * Tuiles · fils triés (clic → Gmail) · ⚠ suspects · table apprise expéditeur → libellé
 * (« Retirer » = vidage de cellules, jamais de suppression de ligne — le moteur redemandera au LLM).
 * Les newsletters jamais lues restent dans le résumé hebdo (calcul Gmail côté moteur).
 */

import { useEffect, useState } from 'react';
import { lirePlage, ecrireCellule } from '../google';
import {
  LigneIndex,
  LigneTriAppris,
  interpreterIndex,
  interpreterTriAppris,
  lignesTri,
  lignesSuspects,
  statsTri,
  lienGmailPourLigne,
} from '../etat';
import { Langue, t } from '../i18n';

const TRIS_RECENTS = 20;

export function Mails({ langue }: { langue: Langue }) {
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [appris, setAppris] = useState<LigneTriAppris[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [idx, ta] = await Promise.all([
          lirePlage('Index', 'A2:H20000'),
          // Onglet créé par le moteur au premier apprentissage — absent = table vide, pas une erreur.
          lirePlage('TriAppris', 'A2:C1000').catch(() => [] as string[][]),
        ]);
        setIndex(interpreterIndex(idx));
        setAppris(interpreterTriAppris(ta));
        setCharge(true);
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, []);

  async function retirer(l: LigneTriAppris) {
    try {
      // Vidage des cellules (A/B) — la ligne reste, le moteur ignore les adresses vides.
      await ecrireCellule('TriAppris', `A${l.ligneSheet}`, '');
      await ecrireCellule('TriAppris', `B${l.ligneSheet}`, '');
      setAppris((xs) => xs.filter((x) => x.ligneSheet !== l.ligneSheet));
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (erreur) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!charge) return <p>{t('chargement', langue)}</p>;

  const tri7j = statsTri(index, 7, new Date());
  const suspects = lignesSuspects(index).slice(0, 8);
  const tris = lignesTri(index).slice(0, TRIS_RECENTS);

  return (
    <div className="colonnes">
      <div className="tuiles large">
        <div className="tuile"><div className="v">{tri7j.tries}</div><div className="l">{t('filsTries7j', langue)}</div></div>
        <div className="tuile"><div className="v">{tri7j.aVerifier}</div><div className="l">{t('aVerifierTuile', langue)}</div></div>
        <div className="tuile"><div className={`v ${suspects.length ? 'erreur' : ''}`}>{suspects.length}</div><div className="l">{t('suspectsEnBoite', langue)}</div></div>
        <div className="tuile"><div className="v">{appris.length}</div><div className="l">{t('exprAppris', langue)}</div></div>
      </div>

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
                  <div className="variante">{l.traiteLe}</div>
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
        <p className="explication">{t('triNote', langue)}</p>
      </section>

      <section className="carte">
        <h2>⚠ {t('suspectsTitre', langue)}</h2>
        {suspects.length === 0 && <p className="explication">{t('aucunSuspect', langue)}</p>}
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

      <section className="carte large">
        <h2>{t('tableApprise', langue)}</h2>
        {appris.length === 0 && <p className="explication">{t('aucunAppris', langue)}</p>}
        <table>
          <tbody>
            {appris.map((l) => (
              <tr key={l.ligneSheet}>
                <td>{l.adresse}</td>
                <td><span className="pastille cat">{l.libelle}</span></td>
                <td className="date">{l.apprisLe}</td>
                <td className="nombre">
                  <button className="discret" onClick={() => retirer(l)}>{t('retirer', langue)}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="explication">{t('tableAppriseNote', langue)}</p>
      </section>
    </div>
  );
}
