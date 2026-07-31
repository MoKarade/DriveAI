/**
 * App.tsx — coquille v6 (C28-41, refonte complète — décisions Marc 2026-07-31) : topbar +
 * sidebar + contenu, thème sombre redessiné. CINQ sections : Aujourd'hui · Agenda · Documents ·
 * Assistant · Moteur (page technique unique — remplace « Coûts & quotas » et « Santé »).
 * Une PASTILLE moteur (vert/ambre/rouge) vit dans la topbar de tous les écrans ; clic = Moteur.
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
import { EtatMoteur, fraicheurMoteur, dernierPassageDepuisSante, interpreterSante } from './etat';
import { AujourdHui } from './vues/AujourdHui';
import { Documents } from './vues/Documents';
import { Assistant } from './vues/Assistant';
import { Agenda } from './vues/Agenda';
import { Moteur } from './vues/Moteur';

// Retour au hub perso (lien externe dans la topbar ; overridable au build via VITE_HUB_URL).
const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined)?.replace(/\/+$/, '') || 'https://hubperso.com';

// C28-41 : « apprentissage », « quotas » et « sante » SUPPRIMÉS (décisions Marc 2026-07-31).
// La page Moteur reprend le minimum technique utile ; la logique d'apprentissage du MOTEUR
// (few-shot Corrections, TriAppris) continue côté Apps Script, simplement sans surface UI.
export type Section = 'aujourdhui' | 'agenda' | 'documents' | 'assistant' | 'moteur';

export const SECTIONS: Section[] = ['aujourdhui', 'agenda', 'documents', 'assistant', 'moteur'];
export const ICONES: Record<Section, string> = {
  aujourdhui: '◐', agenda: '▦', documents: '▤', assistant: '💬', moteur: '⚙',
};
/** Barre basse mobile : les 4 sections du quotidien + « Plus » (Moteur). */
const BARRE_BASSE: Section[] = ['aujourdhui', 'agenda', 'documents', 'assistant'];

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
          <a className="lien-hub" href={HUB_URL} title="Retour au hub">← Hub</a>
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
 * Coquille connectée (dans le FournisseurEtat — pastille moteur et badge Synchro lisent l'état
 * global) : topbar ☰ + logo + pastille + Synchro + avatar, sidebar (tiroir sur mobile), contenu,
 * barre basse mobile + feuille « Plus » (Moteur).
 */
function Coquille({ langue, onLangue, onDeconnexion }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
}) {
  const { rafraichir } = useEtatGlobal(); // création au FAB → l'Agenda affiché se rafraîchit
  const [section, setSection] = useState<Section>('aujourdhui');
  const [sidebarOuverte, setSidebarOuverte] = useState(false);
  // Sidebar REPLIABLE en rail d'icônes (desktop), persistée — même ☰ que le tiroir mobile.
  const [sidebarRepliee, setSidebarRepliee] = useState(
    () => localStorage.getItem('driveai_sidebar_repliee') === '1',
  );
  const [plusOuvert, setPlusOuvert] = useState(false);
  const [creationOuverte, setCreationOuverte] = useState(false); // FAB « + Créer »
  // Date de référence de l'Agenda, REMONTÉE ici : le mini-calendrier de la sidebar et la grande
  // grille restent synchrones — un clic là-bas navigue ici.
  const [dateAgenda, setDateAgenda] = useState(new Date());
  // « Mes agendas » : l'état vit ici pour piloter le filtrage local de l'Agenda (PR2 C28-41 le
  // branche sur la vraie liste des agendas Google) — la sidebar ne fait que l'afficher.
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

  // ☰ à double emploi : tiroir sur mobile, repli/dépli sur desktop.
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
          <a className="lien-hub" href={HUB_URL} title="Retour au hub">← Hub</a>
          <PastilleMoteur langue={langue} onOuvrir={() => allerA('moteur')} />
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
            {section === 'assistant' && <Assistant langue={langue} />}
            {section === 'agenda' && <Agenda langue={langue} dateRef={dateAgenda} agendas={agendas} />}
            {section === 'moteur' && <Moteur langue={langue} />}
          </div>
          <footer>{t('gardeFous', langue)}</footer>
        </main>
      </div>

      {/* FAB « + Créer » : la création vit en dialogue. */}
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
          className={section === 'moteur' ? 'actif' : ''}
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
            <button className="discret" onClick={() => allerA('moteur')}>
              {ICONES.moteur} {t('moteur', langue)}
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
 * Pastille moteur (C28-41, décision Marc « pastille discrète ») : point vert/ambre/rouge dérivé
 * du « Dernier passage OK » de l'onglet Santé + de la fréquence de tick réglée. Discrète tant
 * que tout va bien ; un clic ouvre la page Moteur pour le détail. Jamais un faux vert : données
 * absentes ⇒ gris « inconnu ».
 */
function PastilleMoteur({ langue, onOuvrir }: { langue: Langue; onOuvrir: () => void }) {
  const { donnees } = useEtatGlobal();
  const lignes = donnees ? interpreterSante(donnees.santeBrut).lignes : [];
  const tick = Number(donnees?.reglagesBrut?.[0]?.[1]) || 5;
  const etat: EtatMoteur = donnees ? fraicheurMoteur(lignes, new Date(), tick) : 'inconnu';
  const titres: Record<EtatMoteur, string> = {
    ok: t('moteurVivant', langue),
    retard: t('moteurRetard', langue),
    mort: t('moteurSilencieux', langue),
    inconnu: t('moteurInconnu', langue),
  };
  const passage = dernierPassageDepuisSante(lignes);
  return (
    <button
      className={`pastille-moteur ${etat}`}
      title={`${titres[etat]}${passage ? ` — ${t('dernierPassage', langue)} ${passage}` : ''}`}
      onClick={onOuvrir}
    >
      <span className="pm-point" aria-hidden="true" />
      <span className="pm-libelle">{t('moteur', langue)}</span>
    </button>
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
            ⟳ {synchroA ? synchroA.toLocaleTimeString(langue === 'fr' ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' }) : '…'}
          </button>
        )}
    </span>
  );
}
