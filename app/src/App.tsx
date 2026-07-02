/**
 * App.tsx — coquille de l'app : configuration → connexion Google → onglets
 * (dashboard, corrections, recherche).
 */

import { useEffect, useState } from 'react';
import { configComplete, lireConfig, enregistrerConfig } from './config';
import { seConnecter, estConnecte, seDeconnecter, abonnerSessionExpiree } from './google';
import { Langue, langueCourante, changerLangue, t } from './i18n';
import { TableauDeBord } from './vues/TableauDeBord';
import { Corrections } from './vues/Corrections';
import { Recherche } from './vues/Recherche';

type Onglet = 'dashboard' | 'corrections' | 'recherche';

export function App() {
  const [langue, setLangue] = useState<Langue>(langueCourante());
  const [configOk, setConfigOk] = useState(configComplete());
  const [connecte, setConnecte] = useState(estConnecte());
  const [onglet, setOnglet] = useState<Onglet>('dashboard');
  const [erreur, setErreur] = useState('');

  // Jeton GIS expiré (~1 h) → rebascule sur l'écran de connexion au lieu de vues qui échouent en boucle.
  useEffect(() => {
    abonnerSessionExpiree(() => setConnecte(false));
  }, []);

  function basculerLangue() {
    const l: Langue = langue === 'fr' ? 'en' : 'fr';
    changerLangue(l);
    setLangue(l);
  }

  async function connexion() {
    setErreur('');
    try {
      await seConnecter();
      setConnecte(true);
    } catch (e) {
      setErreur(String(e));
    }
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>{t('titre', langue)}</h1>
          <p className="sous-titre">{t('sousTitre', langue)}</p>
        </div>
        <div className="header-actions">
          <button className="discret" onClick={basculerLangue}>
            {langue === 'fr' ? 'EN' : 'FR'}
          </button>
          <button className="discret" title={t('configuration', langue)} onClick={() => setConfigOk(false)}>
            ⚙
          </button>
          {connecte && (
            <button
              className="discret"
              onClick={() => {
                seDeconnecter();
                setConnecte(false);
              }}
            >
              {t('deconnexion', langue)}
            </button>
          )}
        </div>
      </header>

      {!configOk && <Configuration langue={langue} onFait={() => setConfigOk(true)} />}

      {configOk && !connecte && (
        <div className="centre">
          <button className="principal" onClick={connexion}>
            {t('connexion', langue)}
          </button>
          {erreur && <p className="erreur">{erreur}</p>}
        </div>
      )}

      {configOk && connecte && (
        <>
          <nav>
            <button className={onglet === 'dashboard' ? 'actif' : ''} onClick={() => setOnglet('dashboard')}>
              {t('tableauDeBord', langue)}
            </button>
            <button className={onglet === 'corrections' ? 'actif' : ''} onClick={() => setOnglet('corrections')}>
              {t('corrections', langue)}
            </button>
            <button className={onglet === 'recherche' ? 'actif' : ''} onClick={() => setOnglet('recherche')}>
              {t('recherche', langue)}
            </button>
          </nav>
          {onglet === 'dashboard' && <TableauDeBord langue={langue} />}
          {onglet === 'corrections' && <Corrections langue={langue} />}
          {onglet === 'recherche' && <Recherche langue={langue} />}
        </>
      )}

      <footer>{t('gardeFous', langue)}</footer>
    </div>
  );
}

function Configuration({ langue, onFait }: { langue: Langue; onFait: () => void }) {
  const initiale = lireConfig();
  const [clientId, setClientId] = useState(initiale.clientId);
  const [spreadsheetId, setSpreadsheetId] = useState(initiale.spreadsheetId);

  return (
    <section className="carte centre">
      <h2>{t('configuration', langue)}</h2>
      <div className="formulaire-config">
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={t('clientId', langue)} />
        <input
          value={spreadsheetId}
          onChange={(e) => setSpreadsheetId(e.target.value)}
          placeholder={t('spreadsheetId', langue)}
        />
        <button
          className="principal"
          disabled={!clientId || !spreadsheetId}
          onClick={() => {
            enregistrerConfig({ clientId, spreadsheetId });
            onFait();
          }}
        >
          {t('enregistrer', langue)}
        </button>
      </div>
    </section>
  );
}
