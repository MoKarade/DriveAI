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

export function ListeSuspects({ langue, suspects, max }: { langue: Langue; suspects: LigneIndex[]; max: number }) {
  const [caches, setCaches] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState('');

  const visibles = suspects.filter((l) => !caches.has(threadIdDe(l))).slice(0, max);

  async function pasSuspect(l: LigneIndex) {
    const id = threadIdDe(l);
    if (!id) return;
    setErreur('');
    setEnCours(id);
    try {
      await marquerPasSuspect(id);
      setCaches((s) => new Set(s).add(id)); // optimiste — l'état réel suit au prochain passage
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours('');
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
            disabled={enCours !== ''}
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
