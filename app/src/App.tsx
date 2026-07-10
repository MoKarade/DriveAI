/**
 * App.tsx — coquille v3 (ADR-0013) : configuration → connexion Google → 6 sections.
 * Documents = explorateur Drive (C21-01) + Recherche sur l'Index ; Apprentissage embarque
 * Corrections (v2 thémée). Mobile : barre basse 5 entrées + feuille « Plus ».
 */

import { useEffect, useState } from 'react';
import { configComplete, lireConfig, enregistrerConfig } from './config';
import { seConnecter, estConnecte, seDeconnecter, abonnerSessionExpiree, tenterRestaurationSession } from './google';
import { FournisseurEtat, useEtatGlobal } from './etatGlobal';
import { BanniereErreur } from './composants/UI';
import { Langue, langueCourante, changerLangue, t } from './i18n';
import { basculerTheme, themeCourant } from './theme';
import { AujourdHui } from './vues/AujourdHui';
import { SanteVue } from './vues/Sante';
import { Corrections } from './vues/Corrections';
import { Documents } from './vues/Documents';
import { Agenda } from './vues/Agenda';
import { Mails } from './vues/Mails';

export type Section = 'aujourdhui' | 'agenda' | 'mails' | 'documents' | 'apprentissage' | 'sante';

const SECTIONS: Section[] = ['aujourdhui', 'agenda', 'mails', 'documents', 'apprentissage', 'sante'];
const ICONES: Record<Section, string> = {
  aujourdhui: '◐', agenda: '▦', mails: '✉', documents: '▤', apprentissage: '✎', sante: '♥',
};
/** Barre basse mobile : 4 sections directes + « Plus » (Apprentissage/Santé + réglages). */
const BARRE_BASSE: Section[] = ['aujourdhui', 'agenda', 'mails', 'documents'];

export function App() {
  const [langue, setLangue] = useState<Langue>(langueCourante());
  const [configOk, setConfigOk] = useState(configComplete());
  const [connecte, setConnecte] = useState(estConnecte());
  const [section, setSection] = useState<Section>('aujourdhui');
  const [plusOuvert, setPlusOuvert] = useState(false);
  const [, setTheme] = useState(themeCourant());
  const [erreur, setErreur] = useState('');

  // Session vraiment morte (le rafraîchissement silencieux a échoué) → écran de connexion,
  // au lieu de vues qui échouent en boucle. Un simple jeton d'une heure périmé ne passe plus ici.
  useEffect(() => {
    abonnerSessionExpiree(() => setConnecte(false));
  }, []);

  // Restauration SILENCIEUSE au chargement (C28-14) : le cookie HttpOnly de session (posé au
  // premier consentement) rend un jeton frais sans clic ni popup — « se connecter une fois ».
  useEffect(() => {
    if (!connecte) {
      void tenterRestaurationSession().then((ok) => { if (ok) setConnecte(true); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au montage uniquement
  }, []);

  function basculerLangue() {
    const l: Langue = langue === 'fr' ? 'en' : 'fr';
    changerLangue(l);
    setLangue(l);
  }

  async function connexion() {
    setErreur('');
    try {
      // En réel la page NAVIGUE vers /api/login (le await n'y revient pas) ; en mode mock E2E
      // seConnecter pose le jeton bouchonné et on bascule l'état localement.
      await seConnecter();
      setConnecte(estConnecte());
    } catch (e) {
      setErreur(String(e));
    }
  }

  function allerA(s: Section) {
    setSection(s);
    setPlusOuvert(false);
  }

  // « Vérifier maintenant » a quitté le header (v3) pour le PanneauActions de l'accueil et de
  // Mails (C28-17, ADR-0019) : mise en avant visuelle au lieu d'un bouton discret perdu en haut.
  const reglages = (
    <>
      <button className="discret" onClick={() => setTheme(basculerTheme())} title={t('theme', langue)}>◐</button>
      <button className="discret" onClick={basculerLangue}>{langue === 'fr' ? 'EN' : 'FR'}</button>
      <button className="discret" title={t('configuration', langue)} onClick={() => setConfigOk(false)}>⚙</button>
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
    </>
  );

  return (
    <div className="app">
      <header className="barre-haute">
        <div>
          <h1 className="logo">DriveAI</h1>
          <p className="sous-titre">{t('sousTitre', langue)}</p>
        </div>
        <div className="header-actions">{reglages}</div>
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
        <FournisseurEtat>
          <nav className="sections" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
                {t(s, langue)}
              </button>
            ))}
            <BadgeSynchro langue={langue} />
          </nav>

          <div className="vue-active" key={section}>
            {section === 'aujourdhui' && <AujourdHui langue={langue} onAller={allerA} />}
            {section === 'documents' && <Documents langue={langue} />}
            {section === 'apprentissage' && <Corrections langue={langue} />}
            {section === 'agenda' && <Agenda langue={langue} />}
            {section === 'mails' && <Mails langue={langue} />}
            {section === 'sante' && <SanteVue langue={langue} />}
          </div>

          <nav className="barre-basse" aria-label="Sections (mobile)">
            {BARRE_BASSE.map((s) => (
              <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
                <em aria-hidden="true">{ICONES[s]}</em>
                {t(s, langue)}
              </button>
            ))}
            <button
              className={section === 'apprentissage' || section === 'sante' ? 'actif' : ''}
              onClick={() => setPlusOuvert(true)}
            >
              <em aria-hidden="true">⋯</em>
              {t('plus', langue)}
            </button>
          </nav>

          {plusOuvert && (
            <>
              <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setPlusOuvert(false)} />
              <div className="feuille-plus" role="dialog" aria-label={t('plus', langue)}>
                <button className="discret" onClick={() => allerA('apprentissage')}>
                  {ICONES.apprentissage} {t('apprentissage', langue)}
                </button>
                <button className="discret" onClick={() => allerA('sante')}>
                  {ICONES.sante} {t('sante', langue)}
                </button>
                <div className="header-actions" style={{ marginLeft: 0 }}>{reglages}</div>
              </div>
            </>
          )}
        </FournisseurEtat>
      )}

      <footer>{t('gardeFous', langue)}</footer>
    </div>
  );
}

/**
 * Badge « Synchro HH:MM » + bouton ⟳ (P1/C28-03) : indicateur GLOBAL de fraîcheur des données,
 * et rafraîchissement manuel qui invalide le cache (le périodique tourne déjà toutes les 5 min).
 * Affiche aussi l'erreur de lecture globale avec « Réessayer » — les vues n'ont plus chacune la leur.
 */
function BadgeSynchro({ langue }: { langue: Langue }) {
  const { synchroA, erreur, rafraichir } = useEtatGlobal();
  return (
    <span className="badge-synchro">
      {erreur
        ? <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => void rafraichir(true)} />
        : (
          <button className="discret" onClick={() => void rafraichir(true)}
            title={t('synchro', langue)}>
            ⟳ {t('synchro', langue)} {synchroA ? synchroA.toLocaleTimeString(langue === 'fr' ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' }) : '…'}
          </button>
        )}
    </span>
  );
}

function Configuration({ langue, onFait }: { langue: Langue; onFait: () => void }) {
  // Plus de Client ID ici (C28-14) : l'OAuth vit côté serveur (variables d'environnement Vercel).
  const initiale = lireConfig();
  const [spreadsheetId, setSpreadsheetId] = useState(initiale.spreadsheetId);
  const [webappUrl, setWebappUrl] = useState(initiale.webappUrl);
  const [webappSecret, setWebappSecret] = useState(initiale.webappSecret);

  return (
    <section className="carte centre">
      <h2>{t('configuration', langue)}</h2>
      <div className="formulaire-config">
        <input
          value={spreadsheetId}
          onChange={(e) => setSpreadsheetId(e.target.value)}
          placeholder={t('spreadsheetId', langue)}
        />
        <input value={webappUrl} onChange={(e) => setWebappUrl(e.target.value)} placeholder={t('webappUrl', langue)} />
        <input value={webappSecret} onChange={(e) => setWebappSecret(e.target.value)} placeholder={t('webappSecret', langue)} />
        <button
          className="principal"
          disabled={!spreadsheetId}
          onClick={() => {
            enregistrerConfig({ spreadsheetId, webappUrl, webappSecret });
            onFait();
          }}
        >
          {t('enregistrer', langue)}
        </button>
      </div>
    </section>
  );
}
