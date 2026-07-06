/**
 * Documents.tsx — section Documents v3 (chantier #21) : deux visages complémentaires.
 * « Drive » = l'explorateur façon Google Drive (C21-01) ; « Recherche DriveAI » = les filtres
 * structurés sur l'Index (domaine/statut/année/confiance — sans index propre, ADR-0007).
 */

import { useState } from 'react';
import { Explorateur } from './Explorateur';
import { Recherche } from './Recherche';
import { Langue, t } from '../i18n';

export function Documents({ langue }: { langue: Langue }) {
  const [onglet, setOnglet] = useState<'drive' | 'index'>('drive');

  return (
    <div>
      <nav className="sous-onglets" aria-label={t('documents', langue)}>
        <button className={onglet === 'drive' ? 'actif' : ''} aria-current={onglet === 'drive'}
          onClick={() => setOnglet('drive')}>
          {t('ongletDrive', langue)}
        </button>
        <button className={onglet === 'index' ? 'actif' : ''} aria-current={onglet === 'index'}
          onClick={() => setOnglet('index')}>
          {t('ongletIndex', langue)}
        </button>
      </nav>
      {onglet === 'drive' ? <Explorateur langue={langue} /> : <Recherche langue={langue} />}
    </div>
  );
}
