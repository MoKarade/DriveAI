/**
 * Mails.tsx — vue v3 (C19-06, ADR-0013) : le tri Gmail (#16) visible et corrigeable.
 * Tuiles · fils triés (clic → Gmail) · ⚠ suspects · table apprise expéditeur → libellé
 * (« Retirer » = vidage de cellules, jamais de suppression de ligne — le moteur redemandera au LLM).
 * Les newsletters jamais lues restent dans le résumé hebdo (calcul Gmail côté moteur).
 */

import { useRef, useState } from 'react';
import { ecrireCellule, marquerIntentionManuelle } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Creation } from '../composants/Creation';
import { PanneauActions } from '../composants/PanneauActions';
import { ListeSuspects } from '../composants/Suspects';
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

      {/* Panneau d'actions PARTAGÉ (C28-17) : remonté sous les tuiles — Marc le trouvait
          « trop inaccessible, trop bas » en fin de vue. Même composant que l'accueil. */}
      <PanneauActions langue={langue} />

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
        <ListeSuspects langue={langue} suspects={suspects} max={8} />
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

// (Le panneau « Analyser & trier » C28-16 vit désormais dans composants/PanneauActions.tsx —
// partagé entre l'accueil v4 et cette vue, enrichi du bouton « Vérifier maintenant ».)
