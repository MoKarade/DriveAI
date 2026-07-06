/**
 * Explorateur.tsx — explorateur façon Google Drive (C21-01, chantier #21). LECTURE SEULE :
 * navigation par dossiers (fil d'Ariane), recherche nom + plein texte, portée limitable au
 * dossier courant (collecte bornée des sous-dossiers — l'UI dit si elle est tronquée).
 * Un dossier s'ouvre dans l'app ; un fichier s'ouvre dans Drive (nouvel onglet).
 * Création de dossiers et drag-and-drop : C21-02 (PR suivante).
 */

import { useEffect, useState } from 'react';
import { listerEnfants, collecterSousDossiers, rechercherDrive, PageDrive } from '../google';
import {
  ElementDrive,
  Etape,
  estDossier,
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

  // Recherche (remplace le listage tant qu'elle est active).
  const [texte, setTexte] = useState('');
  const [dansDossier, setDansDossier] = useState(false);
  const [resultats, setResultats] = useState<ElementDrive[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [porteeTronquee, setPorteeTronquee] = useState(false);

  const dossier = ariane[ariane.length - 1];

  useEffect(() => {
    // L'ancien listing (et SURTOUT son pageToken, lié à sa requête d'origine) est purgé tout de
    // suite ; `actif` neutralise une réponse arrivée après un changement de dossier plus rapide.
    let actif = true;
    setElements([]);
    setSuivant(undefined);
    setCharge(false);
    setErreur('');
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
  }, [dossier.id]);

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
      // juste, seul le chemin affiché est approximatif. Chemin réel (walk des parents) : C21-02+.
      setResultats(null);
      setAriane((a) => pousserEtape(a, { id: e.id, nom: e.name }));
    } else {
      window.open(e.webViewLink ?? `https://drive.google.com/file/d/${e.id}/view`, '_blank', 'noopener');
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
                <b>{e.nom}</b>
              ) : (
                <button className="discret" onClick={() => { setResultats(null); setAriane((a) => couperA(a, e.id)); }}>
                  {e.nom}
                </button>
              )}
            </span>
          ))}
          {resultats && <span className="ariane-sep" aria-hidden="true">›</span>}
          {resultats && <b>{resultats.length} {t('resultats', langue)}</b>}
        </nav>

        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
        {resultats && porteeTronquee && <p className="explication">⚠ {t('porteeTronquee', langue)}</p>}
        {!charge && !erreur && <p>{t('chargement', langue)}</p>}
        {charge && affiches.length === 0 && (
          <p className="explication">{resultats ? t('aucunResultat', langue) : t('dossierVide', langue)}</p>
        )}

        <table className="expl-table">
          <tbody>
            {affiches.map((e) => (
              <tr key={e.id} className="ligne-clic" onClick={() => ouvrir(e)}
                tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && ouvrir(e)}
                title={estDossier(e) ? t('ouvrirDossier', langue) : t('ouvrirDansDrive', langue)}>
                <td className="expl-ic" aria-hidden="true">{iconePourMime(e.mimeType)}</td>
                <td>{e.name}</td>
                <td className="date">{formaterDateCourte(e.modifiedTime, langue === 'fr' ? 'fr-CA' : 'en-CA')}</td>
                <td className="date nombre">{formaterTaille(e.size)}</td>
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
