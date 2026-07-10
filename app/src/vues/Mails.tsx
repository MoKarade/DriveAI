/**
 * Mails.tsx — vue v3 (C19-06, ADR-0013) : le tri Gmail (#16) visible et corrigeable.
 * Tuiles · fils triés (clic → Gmail) · ⚠ suspects · table apprise expéditeur → libellé
 * (« Retirer » = vidage de cellules, jamais de suppression de ligne — le moteur redemandera au LLM).
 * Les newsletters jamais lues restent dans le résumé hebdo (calcul Gmail côté moteur).
 */

import { useRef, useState } from 'react';
import { ecrireCellule, marquerIntentionManuelle, analyseCiblee, demandeIntentions, demandeTriGmail } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Creation } from '../composants/Creation';
import {
  LigneIndex,
  LigneTriAppris,
  interpreterTriAppris,
  lignesTri,
  lignesSuspects,
  statsTri,
  lienGmailPourLigne,
} from '../etat';
import { formaterDateCourte } from '../explorateur';
import { Langue, t } from '../i18n';

const TRIS_RECENTS = 20;

export function Mails({ langue }: { langue: Langue }) {
  // Données PARTAGÉES (P1/C28-02) : l'Index arrive en ÉTAT COURANT — un fil suspect PUIS trié
  // n'apparaît plus ⚠ (fini la section Suspects périmée, C28-13). Rafraîchi toutes les 5 min.
  const { donnees, rafraichir } = useEtatGlobal();
  const [retires, setRetires] = useState<number[]>([]); // optimiste, le temps du prochain rafraîchissement
  const [erreurAction, setErreurAction] = useState('');
  // C28-06 (plan P2) : création manuelle de tâche/RDV DEPUIS un fil trié (modale pré-remplie).
  const [creationPour, setCreationPour] = useState<LigneIndex | null>(null);
  const filsMarques = useRef(new Set<string>()); // marqueur Index écrit UNE fois par fil

  /** Après la 1ʳᵉ création réussie : le moteur ne doit plus analyser ce fil (pas de doublon). */
  async function marquerFilTraite(l: LigneIndex) {
    const threadId = l.cle.split('|')[1] ?? '';
    if (!threadId || filsMarques.current.has(threadId)) return;
    filsMarques.current.add(threadId);
    try {
      await marquerIntentionManuelle(threadId, l.fichier);
    } catch (e) {
      filsMarques.current.delete(threadId); // re-tentable
      setErreurAction(String(e));
    }
  }

  async function retirer(l: LigneTriAppris) {
    try {
      // Vidage des cellules (A/B) — la ligne reste, le moteur ignore les adresses vides.
      await ecrireCellule('TriAppris', `A${l.ligneSheet}`, '');
      await ecrireCellule('TriAppris', `B${l.ligneSheet}`, '');
      setRetires((xs) => [...xs, l.ligneSheet]);
      void rafraichir(true);
    } catch (e) {
      setErreurAction(String(e));
    }
  }

  if (!donnees) return <IndicateurChargement langue={langue} />;
  const index: LigneIndex[] = donnees.index;
  const appris = interpreterTriAppris(donnees.triApprisBrut).filter((x) => !retires.includes(x.ligneSheet));

  const tri7j = statsTri(index, 7, new Date());
  const suspects = lignesSuspects(index).slice(0, 8);
  const tris = lignesTri(index).slice(0, TRIS_RECENTS);

  return (
    <div className="colonnes">
      <BanniereErreur langue={langue} erreur={erreurAction} onReessayer={() => setErreurAction('')} />
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
                  <div className="variante">{formaterDateCourte(l.traiteLe, langue === 'fr' ? 'fr-CA' : 'en-CA')}</div>
                </td>
                <td className="nombre">
                  <span className={`pastille ${l.statut === 'suspect' ? 'crit' : l.statut === 'tri-a-verifier' ? 'douce' : 'ok'}`}>
                    {l.statut === 'trié' ? t('trie', langue) : l.statut === 'tri-a-verifier' ? t('aVerifier', langue) : '⚠'}
                  </span>
                </td>
                <td className="nombre">
                  <button className="discret" title={t('creerTacheFilTitre', langue)}
                    onClick={() => setCreationPour(l)}>➕</button>
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
              <span className="date"> · {formaterDateCourte(l.traiteLe, langue === 'fr' ? 'fr-CA' : 'en-CA')}</span>
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

      <AnalyserTrier langue={langue} />

      {creationPour && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setCreationPour(null)} />
          <div className="feuille-plus" role="dialog" aria-label={t('creer', langue)}>
            <Creation
              langue={langue}
              titreInitial={creationPour.fichier}
              note={lienGmailPourLigne(creationPour)}
              onCree={() => void marquerFilTraite(creationPour)}
            />
            <button className="discret" onClick={() => setCreationPour(null)}>{t('fermer', langue)}</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Panneau « Analyser & trier » (C28-16) : trois déclencheurs À LA DEMANDE consommés par le
 * MOTEUR à son prochain passage (~1 min — l'app n'exécute jamais de fonction moteur) :
 *  1. intentions (tâches/RDV) sur toute la fenêtre 30 j ;
 *  2. tri Gmail paramétré au clic (fenêtre / archiver / plafond de fils) ;
 *  3. l'analyse CIBLÉE existante (requête Gmail libre, C28-06).
 * L'erreur `QUOTA_GMAIL` du moteur (quota journalier épuisé, C28-15) s'affiche en clair.
 */
function AnalyserTrier({ langue }: { langue: Langue }) {
  const [requete, setRequete] = useState('');
  const [fenetre, setFenetre] = useState(7);
  const [archiver, setArchiver] = useState(true);
  const [plafond, setPlafond] = useState(100);
  const [statut, setStatut] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function lancer(action: () => Promise<string>) {
    setErreur('');
    setStatut('');
    setEnCours(true);
    try {
      setStatut(await action());
    } catch (e) {
      setErreur(String(e).includes('QUOTA_GMAIL') ? t('quotaGmailEpuise', langue) : String(e));
    } finally {
      setEnCours(false);
    }
  }

  const plafondValide = Number.isInteger(plafond) && plafond >= 1 && plafond <= 1000;
  return (
    <section className="carte large">
      <h2>{t('analyserTrierTitre', langue)}</h2>

      <div className="ligne-formulaire">
        <span style={{ minWidth: '11rem' }}>{t('intentionsLigne', langue)}</span>
        <button disabled={enCours} onClick={() => void lancer(() => demandeIntentions())}>
          {t('analyser30j', langue)}
        </button>
      </div>

      <div className="ligne-formulaire">
        <span style={{ minWidth: '11rem' }}>{t('triLigne', langue)}</span>
        <label>
          {t('fenetreJours', langue)}{' '}
          <select value={fenetre} onChange={(e) => setFenetre(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={7}>7</option>
            <option value={30}>30</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={archiver} onChange={(e) => setArchiver(e.target.checked)} />{' '}
          {t('archiverParam', langue)}
        </label>
        <label>
          {t('plafondFils', langue)}{' '}
          <input
            type="number"
            min={1}
            max={1000}
            value={plafond}
            onChange={(e) => setPlafond(Number(e.target.value))}
            style={{ width: '5.5rem' }}
          />
        </label>
        <button
          disabled={enCours || !plafondValide}
          onClick={() => void lancer(() => demandeTriGmail(fenetre, archiver, plafond))}
        >
          {t('trierMaintenant', langue)}
        </button>
      </div>

      <div className="ligne-formulaire">
        <input
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t('analyseCibleePlaceholder', langue)}
          style={{ flex: 1 }}
        />
        <button
          disabled={requete.trim().length < 3 || enCours}
          onClick={() => void lancer(async () => {
            const message = await analyseCiblee(requete);
            setRequete('');
            return message;
          })}
        >
          {t('lancer', langue)}
        </button>
      </div>

      {statut && <p className="ok">✓ {statut}</p>}
      <BanniereErreur langue={langue} erreur={erreur} />
      <p className="explication">{t('analyserTrierNote', langue)}</p>
    </section>
  );
}
