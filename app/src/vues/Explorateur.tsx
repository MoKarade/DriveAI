/**
 * Explorateur.tsx — explorateur façon Google Drive (chantier #21).
 * C21-01 : navigation par dossiers (fil d'Ariane), recherche nom + plein texte, portée limitable
 * au dossier courant (collecte bornée — l'UI dit si elle est tronquée).
 * C21-02 : création rapide de dossiers + déplacement MANUEL de fichiers — drag-and-drop (souris)
 * et mode « Déplacer → Déposer ici » (tactile/clavier). Nom conservé, verdict garde-fous
 * `deplacementSeul` (zone protégée inconditionnelle). Les DOSSIERS ne se déplacent pas ici
 * (réorg de masse = moteur, C21-04+). Aucune suppression nulle part.
 */

import { useEffect, useState } from 'react';
import {
  listerEnfants,
  collecterSousDossiers,
  rechercherDrive,
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
  iconePourMime,
  pousserEtape,
  couperA,
  formaterTaille,
  formaterDateCourte,
} from '../explorateur';
import { Langue, t } from '../i18n';

export function Explorateur({ langue }: { langue: Langue }) {
  const [ariane, setAriane] = useState<Etape[]>([{ id: 'root', nom: t('monDrive', langue) }]);
  const [elements, setElements] = useState<ElementDrive[]>([]);
  const [suivant, setSuivant] = useState<string | undefined>();
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const [rafraichir, setRafraichir] = useState(0); // re-liste le dossier courant après une écriture

  // Recherche (remplace le listage tant qu'elle est active).
  const [texte, setTexte] = useState('');
  const [dansDossier, setDansDossier] = useState(false);
  const [resultats, setResultats] = useState<ElementDrive[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [porteeTronquee, setPorteeTronquee] = useState(false);

  // C21-02 : création de dossier + déplacement. C21-05 : demande d'analyse IA.
  const [creation, setCreation] = useState<'' | 'ouvert' | 'encours'>('');
  const [nomDossier, setNomDossier] = useState('');
  const [analyse, setAnalyse] = useState<'' | 'encours' | 'ok'>('');
  const [aDeplacer, setADeplacer] = useState<ElementDrive | null>(null); // mode « Déplacer → Déposer ici »
  const [survolDepot, setSurvolDepot] = useState(''); // id du dossier survolé pendant un drag
  const [statutDepot, setStatutDepot] = useState(''); // '' | 'ok' | message d'erreur

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

  const [enChargementPlus, setEnChargementPlus] = useState(false);

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

  async function chercher() {
    if (!texte.trim()) return;
    setEnCours(true);
    setErreur('');
    setPorteeTronquee(false);
    try {
      let portee: string[] | undefined;
      if (dansDossier && dossier.id !== 'root') {
        const c = await collecterSousDossiers(dossier.id);
        portee = c.ids;
        setPorteeTronquee(c.tronque);
      }
      setResultats(await rechercherDrive(texte.trim(), portee));
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  function effacerRecherche() {
    setTexte('');
    setResultats(null);
    setPorteeTronquee(false);
  }

  function ouvrir(e: ElementDrive) {
    if (estDossier(e)) {
      // Approximation assumée : un dossier trouvé par recherche GLOBALE est poussé au bout de
      // l'Ariane courant, même s'il vit ailleurs dans le Drive — la navigation (par id) reste
      // juste, seul le chemin affiché est approximatif. Chemin réel (walk des parents) : C21-04+.
      setResultats(null);
      setAriane((a) => pousserEtape(a, { id: e.id, nom: e.name }));
    } else {
      window.open(e.webViewLink ?? `https://drive.google.com/file/d/${e.id}/view`, '_blank', 'noopener');
    }
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
      const deplace = await deplacerFichierManuel({
        fileId: fichier.id,
        nouveauParent: cibleId,
        nomCible: cibleNom,
      });
      setADeplacer(null);
      if (!deplace) return; // déjà en place — rien à annoncer, rien à rafraîchir
      setStatutDepot(`ok:${fichier.name} → ${cibleNom}`);
      setResultats(null);
      setRafraichir((n) => n + 1);
    } catch (e) {
      setStatutDepot(String(e));
    }
  }

  // Type MIME PROPRIÉTAIRE : un drag venu d'ailleurs (autre onglet, autre app) est
  // structurellement invisible — seul un drag démarré ICI porte ce type.
  const TYPE_DRAG = 'application/x-driveai-fichier';

  function surDragStart(ev: React.DragEvent, e: ElementDrive) {
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

  const affiches = resultats ?? elements;

  return (
    <div className="colonnes">
      <section className="carte large explorateur">
        <div className="ligne-formulaire expl-recherche">
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && chercher()}
            placeholder={t('rechercherDansDrive', langue)}
          />
          <label className="filtre-confiance" title={t('dansCeDossierTitre', langue)}>
            <input
              type="checkbox"
              checked={dansDossier}
              onChange={(e) => setDansDossier(e.target.checked)}
              disabled={dossier.id === 'root'}
            />
            {t('dansCeDossier', langue)}
          </label>
          <button onClick={chercher} disabled={enCours || !texte.trim()}>
            {enCours ? t('chargement', langue) : t('rechercher', langue)}
          </button>
          {resultats && (
            <button className="discret" onClick={effacerRecherche}>✕ {t('effacer', langue)}</button>
          )}
        </div>

        <nav className="ariane" aria-label={t('cheminAriane', langue)}>
          {ariane.map((e, i) => (
            <span key={e.id}>
              {i > 0 && <span className="ariane-sep" aria-hidden="true">›</span>}
              {i === ariane.length - 1 && !resultats ? (
                <b
                  className={survolDepot === e.id ? 'depot-survol' : ''}
                  onDragOver={(ev) => { ev.preventDefault(); setSurvolDepot(e.id); }}
                  onDragLeave={() => setSurvolDepot('')}
                  onDrop={(ev) => surDrop(ev, e)}
                >{e.nom}</b>
              ) : (
                <button
                  className={`discret ${survolDepot === e.id ? 'depot-survol' : ''}`}
                  onClick={() => { setResultats(null); setAriane((a) => couperA(a, e.id)); }}
                  onDragOver={(ev) => { ev.preventDefault(); setSurvolDepot(e.id); }}
                  onDragLeave={() => setSurvolDepot('')}
                  onDrop={(ev) => surDrop(ev, e)}
                >
                  {e.nom}
                </button>
              )}
            </span>
          ))}
          {resultats && <span className="ariane-sep" aria-hidden="true">›</span>}
          {resultats && <b>{resultats.length} {t('resultats', langue)}</b>}
          {!resultats && !estDossierATrier(dossier.nom) && (
            <span className="ariane-actions">
              {analyse === 'ok' ? (
                <span className="ok">✨ {t('demandeEnvoyee', langue)}</span>
              ) : (
                <button className="discret" onClick={analyserStructure} disabled={analyse === 'encours'}>
                  ✨ {analyse === 'encours' ? t('chargement', langue) : t('analyserStructure', langue)}
                </button>
              )}
              {creation === '' ? (
                <button className="discret" onClick={() => setCreation('ouvert')}>+ {t('nouveauDossier', langue)}</button>
              ) : (
                <span className="ligne-formulaire creation-dossier">
                  <input
                    autoFocus
                    value={nomDossier}
                    onChange={(e) => setNomDossier(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') creer();
                      if (e.key === 'Escape') { setCreation(''); setNomDossier(''); }
                    }}
                    placeholder={t('nomDossierPlaceholder', langue)}
                  />
                  <button onClick={creer} disabled={!nomDossier.trim() || creation === 'encours'}>
                    {creation === 'encours' ? t('chargement', langue) : t('creerBouton', langue)}
                  </button>
                  <button className="discret" onClick={() => { setCreation(''); setNomDossier(''); }}>✕</button>
                </span>
              )}
            </span>
          )}
        </nav>

        {aDeplacer && (
          <p className="bandeau-deplacement">
            ✥ {t('deplacementDe', langue)} <b>{aDeplacer.name}</b> — {t('deplacementConsigne', langue)}{' '}
            <button onClick={() => deposer(aDeplacer, dossier.id, dossier.nom)}>
              {t('deposerIci', langue)} ({dossier.nom})
            </button>{' '}
            <button className="discret" onClick={() => setADeplacer(null)}>{t('annulerBouton', langue)}</button>
          </p>
        )}
        {statutDepot.startsWith('ok:') && <p className="ok">✓ {t('deplaceOk', langue)} : {statutDepot.slice(3)}</p>}
        {statutDepot && !statutDepot.startsWith('ok:') && <p className="erreur">{statutDepot}</p>}

        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
        {resultats && porteeTronquee && <p className="explication">⚠ {t('porteeTronquee', langue)}</p>}
        {!charge && !erreur && <p>{t('chargement', langue)}</p>}
        {charge && affiches.length === 0 && (
          <p className="explication">{resultats ? t('aucunResultat', langue) : t('dossierVide', langue)}</p>
        )}

        <table className="expl-table">
          <tbody>
            {affiches.map((e) => (
              <tr
                key={e.id}
                className={`ligne-clic ${survolDepot === e.id ? 'depot-survol' : ''}`}
                onClick={() => ouvrir(e)}
                tabIndex={0}
                // ev.target === ev.currentTarget : Entrée sur le bouton ✥ ne doit PAS aussi ouvrir la ligne.
                onKeyDown={(ev) => ev.key === 'Enter' && ev.target === ev.currentTarget && ouvrir(e)}
                title={estDossier(e) ? t('ouvrirDossier', langue) : t('ouvrirDansDrive', langue)}
                draggable={!estDossier(e)}
                onDragStart={(ev) => !estDossier(e) && surDragStart(ev, e)}
                onDragEnd={() => setSurvolDepot('')}
                onDragOver={estDossier(e) ? (ev) => { ev.preventDefault(); setSurvolDepot(e.id); } : undefined}
                onDragLeave={estDossier(e) ? () => setSurvolDepot('') : undefined}
                onDrop={estDossier(e) ? (ev) => surDrop(ev, e) : undefined}
              >
                <td className="expl-ic" aria-hidden="true">{iconePourMime(e.mimeType)}</td>
                <td>{e.name}</td>
                <td className="date">{formaterDateCourte(e.modifiedTime, langue === 'fr' ? 'fr-CA' : 'en-CA')}</td>
                <td className="date nombre">{formaterTaille(e.size)}</td>
                <td className="nombre expl-actions">
                  {!estDossier(e) && (
                    <button
                      className="discret"
                      title={t('deplacerTitre', langue)}
                      onClick={(ev) => { ev.stopPropagation(); setADeplacer(e); setStatutDepot(''); }}
                    >✥</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!resultats && suivant && (
          <div className="actions">
            <button className="discret" onClick={chargerPlus} disabled={enChargementPlus}>
              {enChargementPlus ? t('chargement', langue) : t('chargerPlus', langue)}
            </button>
          </div>
        )}
        <p className="explication">{t('explorateurNote', langue)}</p>
      </section>
    </div>
  );
}
