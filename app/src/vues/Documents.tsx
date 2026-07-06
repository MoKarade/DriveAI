/**
 * Documents.tsx — section Documents v3 (chantier #21) : trois visages complémentaires.
 * « Drive » = l'explorateur façon Google Drive (C21-01/02) ; « Recherche DriveAI » = filtres
 * structurés sur l'Index + recherche IA (C21-03) ; « Réorg IA » = le plan de réorganisation
 * proposé par le moteur, validé ici (C21-05).
 */

import { useState } from 'react';
import { Explorateur } from './Explorateur';
import { Recherche } from './Recherche';
import { ReorgVue } from './Reorg';
import { Langue, t } from '../i18n';

export function Documents({ langue }: { langue: Langue }) {
  const [onglet, setOnglet] = useState<'drive' | 'index' | 'reorg'>('drive');

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
        <button className={onglet === 'reorg' ? 'actif' : ''} aria-current={onglet === 'reorg'}
          onClick={() => setOnglet('reorg')}>
          ✨ {t('ongletReorg', langue)}
        </button>
      </nav>
      {onglet === 'drive' && <Explorateur langue={langue} />}
      {onglet === 'index' && <Recherche langue={langue} />}
      {onglet === 'reorg' && <ReorgVue langue={langue} />}
    </div>
  );
}
