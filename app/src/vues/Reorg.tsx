/**
 * Reorg.tsx — vue « Réorg IA » (chantier #21, C21-05) : le plan avant/après proposé par le
 * moteur (onglet Réorg), validé/écarté ICI par Marc. L'app n'exécute RIEN : elle écrit des
 * statuts (cellules F) et dépose des demandes (append) — le moteur propose (C21-04) puis
 * applique les actions VALIDÉES par déplacements seuls (C21-06). Aucune ligne supprimée.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ecrireCellule, ecrireColonnePlage, ajouterLigne } from '../google';
import {
  LigneReorg,
  interpreterReorg,
  derniereDemandeReorg,
  actionsDuPlan,
  plagesContigues,
} from '../etat';
import { Langue, t } from '../i18n';

const TYPES: Record<string, string> = { deplacer: '→', fusionner: '⇒', creer: '+', renommer: '✎' };

function libelleType(type: string, langue: Langue): string {
  if (type === 'deplacer') return t('reorgDeplacer', langue);
  if (type === 'fusionner') return t('reorgFusionner', langue);
  if (type === 'creer') return t('reorgCreer', langue);
  if (type === 'renommer') return t('reorgRenommer', langue);
  return type;
}

export function ReorgVue({ langue }: { langue: Langue }) {
  const [lignes, setLignes] = useState<LigneReorg[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [version, setVersion] = useState(0); // recharge après écriture

  useEffect(() => {
    (async () => {
      try {
        setCharge(false);
        // Onglet créé par le moteur au premier tick après déploiement — ABSENT (400) = vide.
        // Toute autre erreur (réseau, 429) REMONTE : un faux « aucune demande » inviterait à
        // empiler des demandes dupliquées.
        const brut = await lirePlage('Réorg', 'A2:H5000').catch((e) => {
          if (String(e).includes('Google API 400')) return [] as string[][];
          throw e;
        });
        setLignes(interpreterReorg(brut));
        setCharge(true);
      } catch (e) {
        setErreur(String(e));
      }
    })();
  }, [version]);

  async function demanderAnalyse(portee: string) {
    setEnCours(true);
    setErreur('');
    try {
      await ajouterLigne('Réorg', [
        `demande-${Date.now()}`, 'demande', '', '', '', 'analyse demandée', portee, new Date().toISOString(),
      ]);
      setVersion((v) => v + 1);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  async function poserStatut(l: LigneReorg, statut: 'validé' | 'écarté') {
    setErreur('');
    try {
      await ecrireCellule('Réorg', `F${l.ligneSheet}`, statut);
      setLignes((xs) => xs.map((x) => (x.ligneSheet === l.ligneSheet ? { ...x, statut } : x)));
    } catch (e) {
      setErreur(String(e));
    }
  }

  async function poserStatutEnMasse(cibles: LigneReorg[], statut: 'validé' | 'écarté') {
    if (cibles.length === 0 || enCours) return;
    setEnCours(true);
    setErreur('');
    try {
      // Plages CONTIGUËS de la colonne Statut — jamais une ligne non ciblée touchée.
      for (const plage of plagesContigues(cibles.map((c) => c.ligneSheet))) {
        await ecrireColonnePlage('Réorg', 'F', plage.debut,
          Array.from({ length: plage.fin - plage.debut + 1 }, () => statut));
      }
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
      setVersion((v) => v + 1); // resynchronise avec la Sheet même sur échec partiel du lot
    }
  }

  if (erreur && !charge) return <p className="erreur">{t('erreur', langue)} : {erreur}</p>;
  if (!charge) return <p>{t('chargement', langue)}</p>;

  const demande = derniereDemandeReorg(lignes);
  const actions = demande ? actionsDuPlan(lignes, demande.cle) : [];
  const proposees = actions.filter((a) => a.statut === 'proposé');
  const decidees = actions.filter((a) => a.statut !== 'proposé');

  return (
    <div className="colonnes">
      <section className="carte large">
        <h2>{t('reorgTitre', langue)}</h2>
        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
        <p className="explication">{t('reorgIntro', langue)}</p>

        {!demande && (
          <button onClick={() => demanderAnalyse('tout')} disabled={enCours}>
            ✨ {t('demanderAnalyse', langue)}
          </button>
        )}
        {demande && demande.statut === 'analyse demandée' && (
          <p className="statut-quota"><span className="pastille douce">⏳</span> {t('analyseEnCours', langue)}</p>
        )}
        {demande && demande.statut === 'échec' && (
          <>
            <p className="statut-quota"><span className="pastille crit">✕</span> {demande.detail}</p>
            <button onClick={() => demanderAnalyse('tout')} disabled={enCours}>
              ✨ {t('demanderAnalyse', langue)}
            </button>
          </>
        )}
        {demande && demande.statut === 'proposé' && (
          <>
            {demande.detail && <p className="ia-explication">✨ {demande.detail}</p>}
            {actions.length === 0 && <p className="explication">{t('reorgRien', langue)}</p>}
            <div className="actions" style={{ margin: '0.6rem 0' }}>
              {proposees.length > 0 && (
                <>
                  <button onClick={() => poserStatutEnMasse(proposees, 'validé')} disabled={enCours}>
                    ✓ {t('toutValider', langue)} ({proposees.length})
                  </button>
                  <button className="discret" onClick={() => poserStatutEnMasse(proposees, 'écarté')} disabled={enCours}>
                    ✕ {t('toutEcarter', langue)}
                  </button>
                </>
              )}
              <button className="discret" onClick={() => demanderAnalyse('tout')} disabled={enCours}>
                ↺ {t('reAnalyser', langue)}
              </button>
            </div>
            <table>
              <tbody>
                {proposees.map((a) => (
                  <tr key={a.cle}>
                    <td className="expl-ic" aria-hidden="true">{TYPES[a.type] ?? '·'}</td>
                    <td>
                      <b>{libelleType(a.type, langue)}</b>
                      <div className="variante">
                        {a.cheminActuel && <>{a.cheminActuel} {'→'} </>}{a.cheminPropose}
                      </div>
                      {a.detail && <div className="variante">{a.detail}</div>}
                    </td>
                    <td className="nombre reorg-boutons">
                      <button className="discret" disabled={enCours} onClick={() => poserStatut(a, 'validé')}>✓ {t('valider', langue)}</button>
                      <button className="discret" disabled={enCours} onClick={() => poserStatut(a, 'écarté')}>✕ {t('ecarter', langue)}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="explication">{t('reorgNote', langue)}</p>
      </section>

      {decidees.length > 0 && (
        <section className="carte large">
          <h2>{t('reorgHistorique', langue)}</h2>
          <table>
            <tbody>
              {decidees.map((a) => (
                <tr key={a.cle}>
                  <td>
                    {a.cheminActuel && <>{a.cheminActuel} {'→'} </>}{a.cheminPropose}
                  </td>
                  <td className="nombre">
                    <span className={`pastille ${a.statut === 'validé' ? 'douce' : a.statut === 'appliqué' ? 'ok' : a.statut.startsWith('refusé') ? 'crit' : 'cat'}`}>
                      {a.statut}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
