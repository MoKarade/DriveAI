/**
 * PanneauActions.tsx — panneau d'actions rapides PARTAGÉ (C28-17, ADR-0019) : affiché EN TÊTE
 * de l'accueil (zone 1 du cockpit) et dans la vue Mails. L'app n'exécute JAMAIS de logique
 * moteur : chaque bouton POSTe une demande à la web app (Script Property) que le tick consomme
 * à son prochain passage (~1 min). Quatre déclencheurs :
 *  1. « Vérifier maintenant » (tick ponctuel) — remonté du header global v3 (trop discret) ;
 *  2. intentions (tâches/RDV) sur toute la fenêtre 30 j (C28-16) ;
 *  3. tri Gmail à la demande (C28-24 : TOUS les mails LUS de la boîte — archiver / plafond) ;
 *  4. analyse CIBLÉE des mails (requête Gmail libre, C28-06).
 * L'erreur `QUOTA_GMAIL` du moteur (quota journalier épuisé, C28-15) s'affiche en clair.
 * C28-24 : le widget OperationsLive vit ICI — la barre de progression apparaît SUR PLACE,
 * juste sous le bouton cliqué (plus besoin de descendre chercher la zone activité).
 */

import { useEffect, useRef, useState } from 'react';
import {
  analyseCiblee,
  demandeIntentions,
  demandeTriGmail,
  verifierMaintenant,
  viderCachePlages,
} from '../google';
import { BanniereErreur } from './UI';
import { OperationsLive } from './OperationsLive';
import { Langue, t } from '../i18n';

export function PanneauActions({ langue }: { langue: Langue }) {
  const [requete, setRequete] = useState('');
  const [archiver, setArchiver] = useState(true);
  const [plafond, setPlafond] = useState(100);
  const [statut, setStatut] = useState('');
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [verif, setVerif] = useState<'' | 'encours' | 'ok'>('');
  // Le panneau vit dans des vues DÉMONTABLES (accueil, Mails) — pas dans le header permanent
  // comme en v3 : le minuteur du badge « Passage lancé ✓ » se nettoie au démontage.
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (minuteur.current) clearTimeout(minuteur.current);
  }, []);

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

  async function verifier() {
    setErreur('');
    setVerif('encours');
    try {
      await verifierMaintenant();
      setVerif('ok');
      // Le moteur passe dans la ~minute : on invalide le cache et on laisse le badge 90 s.
      minuteur.current = setTimeout(() => { viderCachePlages(); setVerif(''); }, 90 * 1000);
    } catch (e) {
      setVerif('');
      setErreur(String(e));
    }
  }

  const plafondValide = Number.isInteger(plafond) && plafond >= 1 && plafond <= 1000;
  return (
    <section className="carte large panneau-actions">
      <h2>{t('actionsRapides', langue)}</h2>

      <div className="actions-grille">
        <div className="action-bloc">
          <span className="action-libelle">{t('moteur', langue)}</span>
          <button
            className="principal"
            disabled={verif === 'encours'}
            onClick={() => void verifier()}
            title={t('verifierTitre', langue)}
          >
            {verif === 'ok' ? t('verifOk', langue) : `⟳ ${t('verifier', langue)}`}
          </button>
        </div>

        <div className="action-bloc">
          <span className="action-libelle">{t('intentionsLigne', langue)}</span>
          <button disabled={enCours} onClick={() => void lancer(() => demandeIntentions())}>
            {t('analyser30j', langue)}
          </button>
        </div>

        <div className="action-bloc">
          <span className="action-libelle">{t('triLigne', langue)}</span>
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
            onClick={() => void lancer(() => demandeTriGmail(archiver, plafond))}
          >
            {t('trierMaintenant', langue)}
          </button>
        </div>

        <div className="action-bloc">
          <span className="action-libelle">{t('analyseCibleeTitre', langue)}</span>
          <input
            value={requete}
            onChange={(e) => setRequete(e.target.value)}
            placeholder={t('analyseCibleePlaceholder', langue)}
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
      </div>

      {statut && <p className="ok">✓ {statut}</p>}
      <BanniereErreur langue={langue} erreur={erreur} />
      <p className="explication">{t('analyserTrierNote', langue)}</p>

      {/* C28-24 : progression LIVE sur place — le widget s'affiche dès que le moteur écrit sa
          première ligne (poll 15 s), invisible quand rien ne tourne. */}
      <OperationsLive langue={langue} />
    </section>
  );
}
