/**
 * UI.tsx — petits composants MUTUALISÉS (P1/C28-03) : états de chargement et d'erreur homogènes,
 * à la place des `<p>chargement</p>` nus et des `String(e)` techniques éparpillés dans les vues.
 */

import { Langue, t } from '../i18n';

export function IndicateurChargement({ langue }: { langue: Langue }) {
  return <p className="chargement">{t('chargement', langue)}</p>;
}

/**
 * Bandeau d'erreur avec « Réessayer » optionnel. Le message technique reste visible (utile au
 * diagnostic) mais borné — jamais un pavé de stack.
 */
export function BanniereErreur({ langue, erreur, onReessayer }: {
  langue: Langue;
  erreur: string;
  onReessayer?: () => void;
}) {
  if (!erreur) return null;
  return (
    <p className="erreur" role="alert">
      {t('erreur', langue)} : {erreur.slice(0, 200)}
      {onReessayer && (
        <>
          {' '}
          <button className="discret" onClick={onReessayer}>⟳ {t('reessayer', langue)}</button>
        </>
      )}
    </p>
  );
}
