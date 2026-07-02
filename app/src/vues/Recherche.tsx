/**
 * Recherche.tsx — surface n°3 de l'ADR-0008 : recherche structurée.
 *
 * Deux modes complémentaires, tous deux SANS index propre (ADR-0007) :
 *  1. FILTRES STRUCTURÉS sur l'Index existant (nom/chemin, domaine, statut, année du document) —
 *     gratuit, zéro appel réseau après le chargement, zéro ré-indexation.
 *  2. PLEIN TEXTE délégué à l'index natif de Drive (`fullText contains`) : on cherche DANS le
 *     contenu des documents sans que DriveAI ne stocke aucun corps.
 * Chaque résultat ouvre le document dans Drive (lien direct quand la clé d'Index porte le fileId,
 * recherche Drive sur le nom exact sinon).
 */

import { useEffect, useMemo, useState } from 'react';
import { lirePlage, rechercheFullText, FichierDrive } from '../google';
import {
  LigneIndex,
  interpreterIndex,
  filtrerIndex,
  domainesDepuisIndex,
  statutsDepuisIndex,
  anneesDepuisIndex,
  lienDrivePourLigne,
} from '../etat';
import { Langue, t } from '../i18n';

const RESULTATS_MAX = 200; // affichage borné (l'Index peut avoir des milliers de lignes)

export function Recherche({ langue }: { langue: Langue }) {
  const [index, setIndex] = useState<LigneIndex[]>([]);
  const [erreur, setErreur] = useState('');
  const [chargee, setChargee] = useState(false);

  // Filtres structurés.
  const [texte, setTexte] = useState('');
  const [domaine, setDomaine] = useState('');
  const [statut, setStatut] = useState('');
  const [annee, setAnnee] = useState('');

  // Plein texte Drive.
  const [contenus, setContenus] = useState<FichierDrive[] | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Les clés `intention|…` (Phase 3) tracent des E-MAILS scannés (sujet en colonne
        // « fichier », domaine vide) — pas des documents : exclues de la recherche, sinon elles
        // domineraient la vue par défaut (une ligne par mail) et pollueraient le sélecteur de statuts.
        setIndex(interpreterIndex(await lirePlage('Index', 'A2:F20000')).filter((l) => !l.cle.startsWith('intention|')));
      } catch (e) {
        setErreur(String(e));
      } finally {
        setChargee(true);
      }
    })();
  }, []);

  const resultats = useMemo(
    () => filtrerIndex(index, { texte, domaine, statut, annee }).slice().reverse(), // plus récents d'abord (copie défensive)
    [index, texte, domaine, statut, annee],
  );
  const domaines = useMemo(() => domainesDepuisIndex(index), [index]);
  const statuts = useMemo(() => statutsDepuisIndex(index), [index]);
  const annees = useMemo(() => anneesDepuisIndex(index), [index]);

  async function chercherContenu() {
    if (!texte.trim()) return;
    setEnCours(true);
    setContenus(null);
    try {
      setContenus(await rechercheFullText(texte.trim()));
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="colonnes">
      <section className="carte large">
        <h2>{t('recherche', langue)}</h2>
        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
        <div className="ligne-formulaire filtres">
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={t('filtreTexte', langue)}
          />
          <select value={domaine} onChange={(e) => setDomaine(e.target.value)}>
            <option value="">{t('tousDomaines', langue)}</option>
            {domaines.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select value={annee} onChange={(e) => setAnnee(e.target.value)}>
            <option value="">{t('toutesAnnees', langue)}</option>
            {annees.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="">{t('tousStatuts', langue)}</option>
            {statuts.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <p className="explication">
          {chargee && `${resultats.length} ${t('resultats', langue)}`}
          {resultats.length > RESULTATS_MAX && ` (${RESULTATS_MAX} ${t('affiches', langue)})`}
        </p>
        <table>
          <tbody>
            {resultats.slice(0, RESULTATS_MAX).map((l) => (
              <tr key={l.cle}>
                <td>
                  <a href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer noopener">
                    {l.fichier}
                  </a>
                </td>
                <td>{l.domaine}</td>
                <td className="variante">{l.chemin}</td>
                <td className="date">{l.statut}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte large">
        <h2>{t('rechercheContenu', langue)}</h2>
        <p className="explication">{t('rechercheContenuExplication', langue)}</p>
        <div className="ligne-formulaire">
          <button onClick={chercherContenu} disabled={enCours || !texte.trim()}>
            {enCours ? t('chargement', langue) : `${t('chercherDansContenu', langue)}${texte.trim() ? ` : « ${texte.trim()} »` : ''}`}
          </button>
        </div>
        {contenus && contenus.length === 0 && <p>{t('aucunResultat', langue)}</p>}
        {contenus && contenus.length > 0 && (
          <table>
            <tbody>
              {contenus.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a href={f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer noopener">
                      {f.name}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
