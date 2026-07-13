/**
 * Suspects.tsx — liste des fils ⚠ avec « Pas suspect » 1-clic (C28-19, ADR-0020). Partagée
 * entre l'accueil (zone Attention) et la vue Mails. Masquage OPTIMISTE : le fil disparaît
 * localement dès le clic ; côté moteur, l'expéditeur devient DE CONFIANCE (onglet Confiance),
 * l'état du fil est purgé et il est re-trié « sain » dans la ~minute. Le libellé ⚠ Gmail
 * existant n'est jamais retiré (§2.3) — il est simplement ignoré désormais.
 */

import { useState } from 'react';
import { marquerPasSuspect } from '../google';
import { LigneIndex, lienGmailPourLigne } from '../etat';
import { formaterDateCourte } from '../explorateur';
import { BanniereErreur } from './UI';
import { Langue, t } from '../i18n';

function threadIdDe(l: LigneIndex): string {
  return l.cle.split('|')[1] ?? ''; // clé `tri|<threadId>|<ts>|<lu>`
}

// Masqués PARTAGÉS à toute la session (portée module) : la ligne disparaît AU CLIC et ne
// réapparaît pas en changeant de vue, le temps que le moteur re-trie (~1 min) et que le
// poll d'état rattrape (≤ 5 min). Un échec du serveur la fait revenir avec l'erreur.
const masquesSession = new Set<string>();

export function ListeSuspects({ langue, suspects, max }: { langue: Langue; suspects: LigneIndex[]; max: number }) {
  const [, forcer] = useState(0);
  const [erreur, setErreur] = useState('');

  const visibles = suspects.filter((l) => !masquesSession.has(threadIdDe(l))).slice(0, max);

  async function pasSuspect(l: LigneIndex) {
    const id = threadIdDe(l);
    if (!id || masquesSession.has(id)) return;
    setErreur('');
    masquesSession.add(id); // OPTIMISTE : disparition IMMÉDIATE — la réponse serveur suit
    forcer((n) => n + 1);
    try {
      await marquerPasSuspect(id);
    } catch (e) {
      masquesSession.delete(id); // échec réel → la ligne revient, l'erreur s'affiche
      forcer((n) => n + 1);
      setErreur(String(e));
    }
  }

  return (
    <>
      <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => setErreur('')} />
      {visibles.map((l) => (
        <div key={l.cle} className="alerte-suspect">
          <span className="ic" aria-hidden="true">!</span>
          <a href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer" className="corps">
            <b>{l.fichier}</b>
            <span className="date"> · {formaterDateCourte(l.traiteLe, langue === 'fr' ? 'fr-CA' : 'en-CA')}</span>
          </a>
          <button
            className="discret ps"
            title={t('pasSuspectTitre', langue)}
            onClick={() => void pasSuspect(l)}
          >
            ✓ {t('pasSuspect', langue)}
          </button>
        </div>
      ))}
    </>
  );
}
