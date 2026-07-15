/**
 * App.tsx — coquille v5 « Material Dark » (C28-23, plan architecte 2026-07-15) : topbar +
 * sidebar façon Google Agenda + contenu. Thème SOMBRE seul (décision Marc — theme.ts supprimé).
 * Réglages (langue, déconnexion) dans le MENU AVATAR ; badge Synchro dans la topbar.
 * Depuis C28-20 (ADR-0021) : pas d'écran de configuration — la config vient de /api/config
 * après connexion, seul le compte ALLOWED_EMAIL ouvre une session. Mobile : la sidebar est un
 * tiroir (☰) et la barre basse reste la navigation principale.
 */

import { useEffect, useState } from 'react';
import { chargerConfigServeur } from './config';
import { seConnecter, estConnecte, seDeconnecter, abonnerSessionExpiree, tenterRestaurationSession } from './google';
import { FournisseurEtat, useEtatGlobal } from './etatGlobal';
import { BanniereErreur } from './composants/UI';
import { Sidebar, AgendasVisibles } from './composants/Sidebar';
import { Creation } from './composants/Creation';
import { Langue, langueCourante, changerLangue, t } from './i18n';
import { AujourdHui } from './vues/AujourdHui';
import { SanteVue } from './vues/Sante';
import { Corrections } from './vues/Corrections';
import { Documents } from './vues/Documents';
import { Agenda } from './vues/Agenda';
import { Mails } from './vues/Mails';

export type Section = 'aujourdhui' | 'agenda' | 'mails' | 'documents' | 'apprentissage' | 'sante';

export const SECTIONS: Section[] = ['aujourdhui', 'agenda', 'mails', 'documents', 'apprentissage', 'sante'];
export const ICONES: Record<Section, string> = {
  aujourdhui: '◐', agenda: '▦', mails: '✉', documents: '▤', apprentissage: '✎', sante: '♥',
};
/** Barre basse mobile : 4 sections directes + « Plus » (Apprentissage/Santé). */
const BARRE_BASSE: Section[] = ['aujourdhui', 'agenda', 'mails', 'documents'];

/**
 * Verrou d'identité (C28-20) : /api/callback renvoie ici avec `?erreur=acces_refuse` quand le
 * compte Google connecté n'est pas celui autorisé (ALLOWED_EMAIL) — aucun cookie n'a été posé.
 * Lecture PURE (StrictMode double-invoque les initialiseurs) ; le nettoyage d'URL vit dans un
 * useEffect au montage.
 */
function accesRefuseDepuisUrl(): boolean {
  return new URLSearchParams(window.location.search).get('erreur') === 'acces_refuse';
}

export function App() {
  const [langue, setLangue] = useState<Langue>(langueCourante());
  const [connecte, setConnecte] = useState(estConnecte());
  const [pret, setPret] = useState(false); // config serveur chargée (gate des vues)
  const [accesRefuse] = useState(accesRefuseDepuisUrl);
  const [erreur, setErreur] = useState('');

  // Nettoie l'URL (?erreur=acces_refuse) après le premier rendu — pas de re-affichage au F5.
  useEffect(() => {
    if (accesRefuse) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- au montage uniquement
  }, []);

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

  // Config SERVEUR (C28-20, ADR-0021) : dès que la session existe, /api/config délivre l'ID de
  // la Sheet et la web app — plus aucune saisie. Un échec (cookie mort entre-temps, variables
  // Vercel incomplètes) ramène à l'écran de connexion avec l'explication, plutôt que des vues
  // qui échoueraient en boucle.
  useEffect(() => {
    if (!connecte) { setPret(false); return; }
    void chargerConfigServeur().then((ok) => {
      if (ok) { setPret(true); return; }
      setConnecte(false);
      setErreur(t('configIndisponible', langueCourante()));
    });
  }, [connecte]);

  function basculerLangue() {
    const l: Langue = langue === 'fr' ? 'en' : 'fr';
    changerLangue(l);
    setLangue(l);
  }

  function deconnexion() {
    seDeconnecter();
    setConnecte(false);
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

  if (connecte && pret) {
    return (
      <FournisseurEtat>
        <Coquille langue={langue} onLangue={basculerLangue} onDeconnexion={deconnexion} />
      </FournisseurEtat>
    );
  }

  // Écran de connexion / chargement : topbar minimale, même matériau.
  return (
    <div className="app">
      <header className="barre-haute">
        <h1 className="logo"><b>Drive</b>AI</h1>
        <p className="sous-titre">{t('sousTitre', langue)}</p>
        <div className="header-actions">
          <MenuAvatar langue={langue} connecte={false} onLangue={basculerLangue} onDeconnexion={deconnexion} />
        </div>
      </header>
      <div className="centre">
        {!connecte && (
          <>
            <button className="principal" onClick={connexion}>{t('connexion', langue)}</button>
            {accesRefuse && <p className="erreur">{t('accesRefuse', langue)}</p>}
            {erreur && <p className="erreur">{erreur}</p>}
          </>
        )}
        {connecte && !pret && <p>{t('chargement', langue)}</p>}
      </div>
      <footer>{t('gardeFous', langue)}</footer>
    </div>
  );
}

/**
 * Coquille connectée (dans le FournisseurEtat — le badge Synchro de la topbar lit l'état
 * global) : topbar ☰ + logo + Synchro + avatar, sidebar (tiroir sur mobile), contenu, barre
 * basse mobile + feuille « Plus » (Apprentissage/Santé — les réglages vivent au menu avatar).
 */
function Coquille({ langue, onLangue, onDeconnexion }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
}) {
  const { rafraichir } = useEtatGlobal(); // création au FAB → l'Agenda affiché se rafraîchit
  const [section, setSection] = useState<Section>('aujourdhui');
  const [sidebarOuverte, setSidebarOuverte] = useState(false);
  // C28-24 : sidebar REPLIABLE en rail d'icônes (desktop), persistée — même ☰ que le tiroir mobile.
  const [sidebarRepliee, setSidebarRepliee] = useState(
    () => localStorage.getItem('driveai_sidebar_repliee') === '1',
  );
  const [plusOuvert, setPlusOuvert] = useState(false);
  const [creationOuverte, setCreationOuverte] = useState(false); // FAB « + Créer » (PR3)
  // Date de référence de l'Agenda, REMONTÉE ici (PR3, plan architecte) : le mini-calendrier de
  // la sidebar et la grande grille restent synchrones — un clic là-bas navigue ici.
  const [dateAgenda, setDateAgenda] = useState(new Date());
  // « Mes agendas » (trompe-l'œil UI, §2.3) : l'état vit ici pour piloter le filtrage local de
  // l'Agenda — la sidebar ne fait que l'afficher.
  const [agendas, setAgendas] = useState<AgendasVisibles>({ evenements: true, taches: true });

  function allerA(s: Section) {
    setSection(s);
    setSidebarOuverte(false);
    setPlusOuvert(false);
  }

  function choisirDate(d: Date) {
    setDateAgenda(d);
    allerA('agenda'); // le mini-calendrier ouvre l'Agenda sur le jour choisi
  }

  // ☰ à double emploi, comme dans Google Agenda : tiroir sur mobile, repli/dépli sur desktop.
  function clicMenu() {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setSidebarOuverte(true);
      return;
    }
    setSidebarRepliee((r) => {
      localStorage.setItem('driveai_sidebar_repliee', r ? '0' : '1');
      return !r;
    });
  }

  return (
    <div className={'app' + (sidebarRepliee ? ' sidebar-repliee' : '')}>
      <header className="barre-haute">
        <button className="hamburger discret" aria-label={t('menu', langue)} onClick={clicMenu}>☰</button>
        <h1 className="logo"><b>Drive</b>AI</h1>
        <div className="header-actions">
          <BadgeSynchro langue={langue} />
          <MenuAvatar langue={langue} connecte onLangue={onLangue} onDeconnexion={onDeconnexion} />
        </div>
      </header>

      <div className="corps-app">
        <Sidebar
          langue={langue}
          section={section}
          ouverte={sidebarOuverte}
          repliee={sidebarRepliee && !sidebarOuverte}
          agendas={agendas}
          dateAgenda={dateAgenda}
          onDate={choisirDate}
          onAgendas={setAgendas}
          onAller={allerA}
          onFermer={() => setSidebarOuverte(false)}
          onCreer={() => {
            setSidebarOuverte(false); // mobile : le tiroir (z-index 35) couvrirait le dialogue (30)
            setCreationOuverte(true);
          }}
        />

        <main className="contenu">
          <div className="vue-active" key={section}>
            {section === 'aujourdhui' && <AujourdHui langue={langue} onAller={allerA} />}
            {section === 'documents' && <Documents langue={langue} />}
            {section === 'apprentissage' && <Corrections langue={langue} />}
            {section === 'agenda' && <Agenda langue={langue} dateRef={dateAgenda} agendas={agendas} />}
            {section === 'mails' && <Mails langue={langue} />}
            {section === 'sante' && <SanteVue langue={langue} />}
          </div>
          <footer>{t('gardeFous', langue)}</footer>
        </main>
      </div>

      {/* FAB « + Créer » (PR3) : la création vit en dialogue — plus de carte en tête d'Agenda. */}
      {creationOuverte && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setCreationOuverte(false)} />
          <div className="dialogue" role="dialog" aria-label={t('creer', langue)}>
            <Creation langue={langue} onCree={() => { setCreationOuverte(false); void rafraichir(true); }} />
            <button className="discret" onClick={() => setCreationOuverte(false)}>{t('fermer', langue)}</button>
          </div>
        </>
      )}

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
          </div>
        </>
      )}
    </div>
  );
}

/** Menu avatar (réglages v5) : langue + déconnexion — comme le menu de compte Google. */
function MenuAvatar({ langue, connecte, onLangue, onDeconnexion }: {
  langue: Langue;
  connecte: boolean;
  onLangue: () => void;
  onDeconnexion: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="menu-avatar">
      <button className="avatar" title={t('compte', langue)} onClick={() => setOuvert((o) => !o)}>M</button>
      {ouvert && (
        <div className="menu" role="menu">
          <button onClick={() => { onLangue(); setOuvert(false); }}>
            {langue === 'fr' ? 'English' : 'Français'}
          </button>
          {connecte && (
            <button onClick={() => { setOuvert(false); onDeconnexion(); }}>
              {t('deconnexion', langue)}
            </button>
          )}
        </div>
      )}
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
