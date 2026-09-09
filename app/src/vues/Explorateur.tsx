/**
 * Explorateur.tsx — DOCUMENTS v7 (C28-82 PR2, ADR-0051) : UNE recherche, des dossiers en liste.
 * Le champ unique cherche dans Drive par nom OU contenu (`rechercherDrive`, index natif de Drive —
 * DriveAI ne stocke aucun corps) ; « IA » transforme une question en mots-clés (`rechercheIA`,
 * moteur) puis lance la MÊME recherche. Les deux sous-onglets de la v6 (« Drive » / « Recherche
 * DriveAI » avec ses filtres domaine / année / statut / confiance) disparaissent — Marc, 09/09 :
 * « quelques boutons simples, moins de déchets ». Reste : navigation par dossiers (fil d'Ariane),
 * création rapide de dossier (« + »), déplacement MANUEL d'un fichier (glisser-déposer à la souris,
 * « Déplacer → Déposer ici » au doigt), demande d'analyse IA du dossier courant (✨). Nom conservé,
 * verdict garde-fous `deplacementSeul` (zone protégée inconditionnelle). Aucune suppression nulle part.
 */

import { useEffect, useState } from 'react';
import {
  listerEnfants,
  rechercherDrive,
  rechercheIA,
  creerDossier,
  deplacerFichierManuel,
  ajouterLigne,
  PageDrive,
} from '../google';
import {
  ElementDrive,
  Etape,
  estDossier,
  estDossierATrier,
  trierElements,
  pousserEtape,
  couperA,
  formaterTaille,
  formaterDateCourte,
  requeteDepuisPlan,
} from '../explorateur';
import { Icone } from '../composants/Icone';
import { BanniereErreur } from '../composants/UI';
import { Langue, t } from '../i18n';

// Type MIME PROPRIÉTAIRE : un drag venu d'ailleurs (autre onglet, autre app) est structurellement
// invisible — seul un drag démarré ICI porte ce type.
const TYPE_DRAG = 'application/x-driveai-fichier';

export function Explorateur({ langue }: { langue: Langue }) {
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const [ariane, setAriane] = useState<Etape[]>([{ id: 'root', nom: t('monDrive', langue) }]);
  const [elements, setElements] = useState<ElementDrive[]>([]);
  const [suivant, setSuivant] = useState<string | undefined>();
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const [rafraichir, setRafraichir] = useState(0); // re-liste le dossier courant après une écriture
  const [enChargementPlus, setEnChargementPlus] = useState(false);

  // Recherche unique (remplace le listage tant qu'elle est active).
  const [texte, setTexte] = useState('');
  const [resultats, setResultats] = useState<ElementDrive[] | null>(null);
  const [tronque, setTronque] = useState(false);         // la page Drive (50) n'a pas tout rendu
  const [requeteLancee, setRequeteLancee] = useState(''); // ce qui a VRAIMENT été cherché (IA ⇒ mots-clés)
  const [enCours, setEnCours] = useState(false);
  const [iaEnCours, setIaEnCours] = useState(false);
  const [iaExplication, setIaExplication] = useState('');

  // Création de dossier, analyse IA du dossier, déplacement.
  const [creation, setCreation] = useState<'' | 'ouvert' | 'encours'>('');
  const [nomDossier, setNomDossier] = useState('');
  const [analyse, setAnalyse] = useState<'' | 'encours' | 'ok'>('');
  const [aDeplacer, setADeplacer] = useState<ElementDrive | null>(null); // mode « Déplacer → Déposer ici »
  const [survolDepot, setSurvolDepot] = useState(''); // id du dossier survolé pendant un drag
  const [statutDepot, setStatutDepot] = useState(''); // '' | 'ok:…' | message d'erreur

  const dossier = ariane[ariane.length - 1];

  useEffect(() => {
    // L'ancien listing (et SURTOUT son pageToken, lié à sa requête d'origine) est purgé tout de
    // suite ; `actif` neutralise une réponse arrivée après un changement de dossier plus rapide.
    let actif = true;
    setElements([]);
    setSuivant(undefined);
    setCharge(false);
    setErreur('');
    setAnalyse(''); // chaque dossier a son propre bouton « Analyser » (sinon perdu pour la session)
    (async () => {
      try {
        const page = await listerEnfants(dossier.id);
        if (!actif) return;
        setElements(trierElements(page.elements));
        setSuivant(page.suivant);
        setCharge(true);
      } catch (e) {
        if (actif) setErreur(String(e));
      }
    })();
    return () => { actif = false; };
  }, [dossier.id, rafraichir]);

  async function chargerPlus() {
    if (!suivant || enChargementPlus) return;
    setEnChargementPlus(true);
    try {
      const page: PageDrive = await listerEnfants(dossier.id, suivant);
      setElements((xs) => trierElements([...xs, ...page.elements]));
      setSuivant(page.suivant);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnChargementPlus(false);
    }
  }

  /** La recherche : nom OU contenu, tout le Drive (index natif de Google, aucun corps stocké). */
  async function chercher(requete = texte) {
    const propre = requete.trim();
    if (!propre || enCours) return; // deux Entrée rapides = une seule recherche
    setEnCours(true);
    setErreur('');
    try {
      const r = await rechercherDrive(propre);
      setResultats(r.elements);
      setTronque(r.tronque);
      setRequeteLancee(propre);
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  /** « IA » : la question devient des mots-clés (moteur, whitelistés), puis la MÊME recherche. */
  async function chercherIA() {
    const question = texte.trim();
    if (!question || iaEnCours) return;
    setIaEnCours(true);
    setIaExplication('');
    setErreur('');
    try {
      const plan = await rechercheIA(question);
      setIaExplication(plan.explication ?? '');
      await chercher(requeteDepuisPlan(plan, question));
    } catch (e) {
      setErreur(String(e));
    } finally {
      setIaEnCours(false);
    }
  }

  function effacerRecherche() {
    setTexte('');
    setResultats(null);
    setTronque(false);
    setRequeteLancee('');
    setIaExplication('');
  }

  function ouvrirDossier(e: ElementDrive) {
    // Approximation assumée : un dossier trouvé par recherche GLOBALE est poussé au bout de
    // l'Ariane courant, même s'il vit ailleurs dans le Drive — la navigation (par id) reste
    // juste, seul le chemin affiché est approximatif.
    setResultats(null);
    setIaExplication('');
    setAriane((a) => pousserEtape(a, { id: e.id, nom: e.name }));
  }

  /** Dépose une demande d'analyse IA (onglet Réorg) — portée = dossier courant, racine = tout. */
  async function analyserStructure() {
    if (analyse === 'encours') return;
    setAnalyse('encours');
    setErreur('');
    try {
      await ajouterLigne('Réorg', [
        `demande-${Date.now()}`, 'demande', '', '', '', 'analyse demandée',
        dossier.id === 'root' ? 'tout' : dossier.id, new Date().toISOString(),
      ]);
      setAnalyse('ok');
    } catch (e) {
      setAnalyse('');
      setErreur(String(e));
    }
  }

  async function creer() {
    if (!nomDossier.trim() || creation === 'encours') return;
    setCreation('encours');
    setErreur('');
    try {
      await creerDossier(nomDossier.trim(), dossier.id);
      setNomDossier('');
      setCreation('');
      setRafraichir((n) => n + 1);
    } catch (e) {
      setErreur(String(e));
      setCreation('ouvert');
    }
  }

  /** Déplace `fichier` vers `cible` (drag-and-drop OU mode « Déposer ici »). */
  async function deposer(fichier: ElementDrive, cibleId: string, cibleNom: string) {
    setStatutDepot('');
    setErreur('');
    try {
      const deplace = await deplacerFichierManuel({ fileId: fichier.id, nouveauParent: cibleId, nomCible: cibleNom });
      setADeplacer(null);
      if (!deplace) return; // déjà en place — rien à annoncer, rien à rafraîchir
      setStatutDepot(`ok:${fichier.name} → ${cibleNom}`);
      setResultats(null);
      setIaExplication('');
      setRafraichir((n) => n + 1);
    } catch (e) {
      setStatutDepot(String(e));
    }
  }

  function surDragStart(ev: React.DragEvent, e: ElementDrive) {
    // La ligne porte un LIEN : sans ça le navigateur y met `text/uri-list` et un dépôt manqué
    // (hors dossier) NAVIGUE vers le fichier Drive (revue flotte PR 2).
    ev.dataTransfer.clearData();
    ev.dataTransfer.setData(TYPE_DRAG, JSON.stringify({ id: e.id, name: e.name }));
    ev.dataTransfer.effectAllowed = 'move';
  }

  function surDrop(ev: React.DragEvent, cible: ElementDrive | Etape) {
    ev.preventDefault();
    setSurvolDepot('');
    try {
      const brut = ev.dataTransfer.getData(TYPE_DRAG);
      if (!brut) return;
      const { id, name } = JSON.parse(brut) as { id: string; name: string };
      if (typeof id !== 'string' || !id) return;
      const cibleId = cible.id;
      const cibleNom = 'nom' in cible ? cible.nom : cible.name;
      if (id === cibleId) return;
      void deposer({ id, name, mimeType: '' }, cibleId, cibleNom);
    } catch {
      /* payload étranger malformé : ignoré */
    }
  }

  /** Cible de dépôt (dossier ou étape de l'Ariane) : les mêmes trois gestionnaires partout. */
  function propsDepot(cible: ElementDrive | Etape) {
    return {
      onDragOver: (ev: React.DragEvent) => { ev.preventDefault(); setSurvolDepot(cible.id); },
      onDragLeave: () => setSurvolDepot(''),
      onDrop: (ev: React.DragEvent) => surDrop(ev, cible),
    };
  }

  const affiches = resultats ?? elements;

  return (
    <div className="documents">
      <h2 className="titre-liste">
        {t('documents', langue)}
        <span className="sp" />
        <button
          className="icone-bouton"
          aria-label={t('nouveauDossier', langue)}
          title={t('nouveauDossier', langue)}
          onClick={() => setCreation((c) => (c === '' ? 'ouvert' : ''))}
        >
          <Icone nom="plus" />
        </button>
      </h2>

      <form className="recherche" onSubmit={(e) => { e.preventDefault(); void chercher(); }}>
        <Icone nom="recherche" />
        <input
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          placeholder={t('rechercherPlaceholder', langue)}
          aria-label={t('rechercher', langue)}
          enterKeyHint="search"
        />
        {texte && (
          <button type="button" className="icone-bouton petit" aria-label={t('effacer', langue)} onClick={effacerRecherche}>
            <Icone nom="fermer" />
          </button>
        )}
        <button type="button" className="bouton-ligne" disabled={!texte.trim() || iaEnCours || enCours}
          title={t('demanderIA', langue)} onClick={() => void chercherIA()}>
          <Icone nom="etincelle" /> {iaEnCours ? '…' : 'IA'}
        </button>
      </form>

      {creation !== '' && (
        <div className="ligne-formulaire creation-dossier">
          <input
            autoFocus
            value={nomDossier}
            onChange={(e) => setNomDossier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void creer();
              if (e.key === 'Escape') { setCreation(''); setNomDossier(''); }
            }}
            placeholder={t('nomDossierPlaceholder', langue)}
            aria-label={t('nouveauDossier', langue)}
          />
          <button onClick={() => void creer()} disabled={!nomDossier.trim() || creation === 'encours'}>
            {creation === 'encours' ? t('chargement', langue) : t('creerBouton', langue)}
          </button>
          <button className="discret" onClick={() => { setCreation(''); setNomDossier(''); }} aria-label={t('annulerBouton', langue)}>✕</button>
        </div>
      )}

      {aDeplacer && (
        <p className="bandeau-deplacement">
          <Icone nom="deplacer" /> <b>{aDeplacer.name}</b>
          <span className="sp" />
          <button onClick={() => void deposer(aDeplacer, dossier.id, dossier.nom)}>
            {t('deposerIci', langue)} · {dossier.nom}
          </button>
          <button className="discret" onClick={() => setADeplacer(null)}>{t('annulerBouton', langue)}</button>
        </p>
      )}
      {statutDepot.startsWith('ok:') && <p className="ok">✓ {t('deplaceOk', langue)} : {statutDepot.slice(3)}</p>}
      {statutDepot && !statutDepot.startsWith('ok:') && <p className="erreur">{statutDepot}</p>}
      <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => setRafraichir((n) => n + 1)} />
      {iaExplication && <p className="variante ia-explication">✨ {iaExplication}</p>}

      {resultats ? (
        <div className="ariane">
          <b>{resultats.length} {t('resultats', langue)}{tronque && ` · ${t('resultatsTronques', langue)}`}</b>
          {requeteLancee && requeteLancee !== texte.trim() && <span className="variante">« {requeteLancee} »</span>}
          <span className="sp" />
          <button className="discret" onClick={effacerRecherche}>✕ {t('effacer', langue)}</button>
        </div>
      ) : (
        <nav className="ariane" aria-label={t('cheminAriane', langue)}>
          {ariane.map((e, i) => (
            <span key={e.id} className="ariane-etape">
              {i > 0 && <span className="ariane-sep" aria-hidden="true">›</span>}
              {i === ariane.length - 1 ? (
                <b className={survolDepot === e.id ? 'depot-survol' : ''} {...propsDepot(e)}>{e.nom}</b>
              ) : (
                <button className={`discret ${survolDepot === e.id ? 'depot-survol' : ''}`}
                  onClick={() => setAriane((a) => couperA(a, e.id))} {...propsDepot(e)}>
                  {e.nom}
                </button>
              )}
            </span>
          ))}
          <span className="sp" />
          {!estDossierATrier(dossier.nom) && (
            analyse === 'ok'
              ? <span className="ok" title={t('demandeEnvoyee', langue)}>✓</span>
              : (
                <button className="icone-bouton petit" aria-label={t('analyserStructure', langue)}
                  title={t('analyserStructure', langue)} disabled={analyse === 'encours'} onClick={() => void analyserStructure()}>
                  <Icone nom="etincelle" />
                </button>
              )
          )}
        </nav>
      )}

      <div className="carte lignes">
        {enCours && <p className="ligne vide">{t('chargement', langue)}</p>}
        {!charge && !resultats && !erreur && !enCours && <p className="ligne vide">{t('chargement', langue)}</p>}
        {(charge || resultats) && affiches.length === 0 && (
          <p className="ligne vide">{resultats ? t('aucunResultat', langue) : t('dossierVide', langue)}</p>
        )}
        {affiches.map((e) => estDossier(e) ? (
          <div
            key={e.id}
            className={`ligne clic ${survolDepot === e.id ? 'depot-survol' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => ouvrirDossier(e)}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ouvrirDossier(e); } }}
            {...propsDepot(e)}
          >
            <Icone nom="dossier" className="accent" />
            <span className="t"><b>{e.name}</b></span>
            <Icone nom="chevron" className="chev" />
          </div>
        ) : (
          <div key={e.id} className="ligne" draggable onDragStart={(ev) => surDragStart(ev, e)} onDragEnd={() => setSurvolDepot('')}>
            <Icone nom="fichier" />
            <a className="t lien-ligne" href={e.webViewLink ?? `https://drive.google.com/file/d/${e.id}/view`}
              target="_blank" rel="noreferrer noopener" title={t('ouvrirDansDrive', langue)} draggable={false}>
              <b className="mono">{e.name}</b>
              <small>{formaterDateCourte(e.modifiedTime, locale)} · {formaterTaille(e.size)}</small>
            </a>
            <button className="icone-bouton petit" aria-label={`${t('deplacer', langue)} : ${e.name}`} title={t('deplacerTitre', langue)}
              onClick={() => { setADeplacer(e); setStatutDepot(''); }}>
              <Icone nom="deplacer" />
            </button>
          </div>
        ))}
      </div>

      {!resultats && suivant && (
        <button className="discret charger-plus" onClick={() => void chargerPlus()} disabled={enChargementPlus}>
          {enChargementPlus ? t('chargement', langue) : t('chargerPlus', langue)}
        </button>
      )}
    </div>
  );
}
