/**
 * App.tsx — coquille v7 (C28-82, ADR-0051 — décisions Marc 2026-09-09) : le téléphone d'abord.
 * QUATRE sections dans la navigation (Aujourd'hui · Agenda · Documents · Assistant) et une page
 * RÉGLAGES (l'ancienne page Moteur), atteinte par l'engrenage de la barre haute sur téléphone et
 * par le bas du rail sur PC. Téléphone : barre haute minimale (logo · pastille moteur · engrenage)
 * + onglets bas. PC : rail à gauche, colonne centrale — la même app, plus large. Plus de barre
 * latérale, de mini-calendrier, de menu avatar ni de lien Hub dans l'en-tête : les agendas se
 * filtrent dans l'Agenda, la langue, la synchro, le hub et la déconnexion vivent dans Réglages.
 * Depuis C28-20 (ADR-0021) : pas d'écran de configuration — la config vient de /api/config
 * après connexion, seul le compte ALLOWED_EMAIL ouvre une session.
 */

import { useEffect, useState } from 'react';
import { chargerConfigServeur } from './config';
import { seConnecter, estConnecte, seDeconnecter, abonnerSessionExpiree, tenterRestaurationSession } from './google';
import { FournisseurEtat, useEtatGlobal } from './etatGlobal';
import { BanniereErreur } from './composants/UI';
import { Icone, NomIcone } from './composants/Icone';
import { Langue, langueCourante, changerLangue, t } from './i18n';
import { EtatMoteur, fraicheurMoteur, dernierPassageDepuisSante, interpreterSante } from './etat';
import { AujourdHui } from './vues/AujourdHui';
import { Documents } from './vues/Documents';
import { Assistant } from './vues/Assistant';
import { Agenda } from './vues/Agenda';
import { Reglages } from './vues/Reglages';

export type Section = 'aujourdhui' | 'agenda' | 'documents' | 'assistant' | 'reglages';

/** Les quatre entrées de la navigation ; Réglages est à part (engrenage / bas du rail). */
export const SECTIONS_NAV: Section[] = ['aujourdhui', 'agenda', 'documents', 'assistant'];
export const ICONES: Record<Section, NomIcone> = {
  aujourdhui: 'aujourdhui', agenda: 'agenda', documents: 'documents', assistant: 'assistant', reglages: 'reglages',
};

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

  // Écran de connexion / chargement : le logo, une phrase, un bouton. Rien d'autre.
  return (
    <div className="app connexion">
      <div className="centre">
        <p className="logo grand"><b>Drive</b>AI</p>
        <p className="sous-titre">{t('sousTitre', langue)}</p>
        {!connecte && (
          <>
            <button className="principal" onClick={connexion}>{t('connexion', langue)}</button>
            {accesRefuse && <p className="erreur">{t('accesRefuse', langue)}</p>}
            {erreur && <p className="erreur">{erreur}</p>}
          </>
        )}
        {connecte && !pret && <p className="chargement">{t('chargement', langue)}</p>}
        <button className="discret lien-langue" onClick={basculerLangue}>
          {langue === 'fr' ? 'English' : 'Français'}
        </button>
      </div>
    </div>
  );
}

/**
 * Coquille connectée (dans le FournisseurEtat — la pastille moteur et la bannière d'erreur
 * globale lisent l'état partagé) : barre haute (téléphone), rail (PC), contenu, onglets bas.
 */
function Coquille({ langue, onLangue, onDeconnexion }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
}) {
  const { erreur, rafraichir } = useEtatGlobal();
  const [section, setSection] = useState<Section>('aujourdhui');

  function allerA(s: Section) {
    setSection(s);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="app">
      {/* Téléphone seulement (le rail porte le logo sur PC). */}
      <header className="barre-haute">
        <p className="logo"><b>Drive</b>AI</p>
        <div className="header-actions">
          <PastilleMoteur langue={langue} onOuvrir={() => allerA('reglages')} />
          <button
            className={'icone-bouton' + (section === 'reglages' ? ' actif' : '')}
            aria-label={t('reglages', langue)}
            title={t('reglages', langue)}
            onClick={() => allerA('reglages')}
          >
            <Icone nom="reglages" />
          </button>
        </div>
      </header>

      <div className="corps-app">
        {/* PC seulement. */}
        <nav className="rail" aria-label="Sections">
          <p className="logo"><b>Drive</b>AI</p>
          {SECTIONS_NAV.map((s) => (
            <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
              <Icone nom={ICONES[s]} />
              <span>{t(s, langue)}</span>
            </button>
          ))}
          <div className="rail-espace" />
          <button className={section === 'reglages' ? 'actif' : ''} onClick={() => allerA('reglages')}>
            <Icone nom="reglages" />
            <span>{t('reglages', langue)}</span>
          </button>
          <PastilleMoteur langue={langue} onOuvrir={() => allerA('reglages')} etendue />
        </nav>

        <main className="contenu">
          <div className="vue-active" key={section}>
            {erreur && (
              <div className="bandeau-global">
                <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => void rafraichir(true)} />
              </div>
            )}
            {section === 'aujourdhui' && <AujourdHui langue={langue} onAller={allerA} />}
            {section === 'documents' && <Documents langue={langue} />}
            {section === 'assistant' && <Assistant langue={langue} />}
            {section === 'agenda' && <Agenda langue={langue} />}
            {section === 'reglages' && <Reglages langue={langue} onLangue={onLangue} onDeconnexion={onDeconnexion} />}
          </div>
        </main>
      </div>

      {/* Téléphone seulement : les quatre sections, toujours au pouce. */}
      <nav className="barre-basse" aria-label="Sections (mobile)">
        {SECTIONS_NAV.map((s) => (
          <button key={s} className={section === s ? 'actif' : ''} onClick={() => allerA(s)}>
            <Icone nom={ICONES[s]} />
            <span>{t(s, langue)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * Pastille moteur (C28-41, décision Marc « pastille discrète ») : point vert/ambre/rouge dérivé
 * du « Dernier passage OK » de l'onglet Santé + de la fréquence de tick réglée. Discrète tant
 * que tout va bien ; un clic ouvre Réglages pour le détail. Jamais un faux vert : données
 * absentes ⇒ gris « inconnu ». `etendue` (rail PC) affiche l'état en toutes lettres.
 */
function PastilleMoteur({ langue, onOuvrir, etendue }: { langue: Langue; onOuvrir: () => void; etendue?: boolean }) {
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
      <span className="pm-libelle">{etendue ? titres[etat] : t('moteur', langue)}</span>
    </button>
  );
}
