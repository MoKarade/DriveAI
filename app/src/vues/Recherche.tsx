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

import { useMemo, useState } from 'react';
import { rechercheFullText, rechercheIA, FichierDrive } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import {
  filtrerIndex,
  domainesDepuisIndex,
  statutsDepuisIndex,
  anneesDepuisIndex,
  lienDrivePourLigne,
  estConfianceBasse,
} from '../etat';
import { Langue, t } from '../i18n';

const RESULTATS_MAX = 200; // affichage borné (l'Index peut avoir des milliers de lignes)

export function Recherche({ langue }: { langue: Langue }) {
  const [erreur, setErreur] = useState(''); // erreurs des recherches plein texte / IA (actions locales)

  // Filtres structurés.
  const [texte, setTexte] = useState('');
  const [domaine, setDomaine] = useState('');
  const [statut, setStatut] = useState('');
  const [annee, setAnnee] = useState('');
  const [confianceBasse, setConfianceBasse] = useState(false); // #17 : « classés au mieux »

  // Plein texte Drive.
  const [contenus, setContenus] = useState<FichierDrive[] | null>(null);
  const [enCours, setEnCours] = useState(false);

  // Recherche IA (C21-03) : question libre → le moteur (Haiku) renvoie un plan whitelisté,
  // l'app l'applique aux filtres ci-dessus et lance le plein texte avec les mots-clés.
  const [question, setQuestion] = useState('');
  const [iaEnCours, setIaEnCours] = useState(false);
  const [iaExplication, setIaExplication] = useState('');

  // Données PARTAGÉES (P1/C28-02) : l'Index (état COURANT, rafraîchi 5 min) vient du fournisseur.
  // Les clés `intention|`/`tache|`/`event|`/`important|`/`tri|` tracent des E-MAILS/actions
  // (sujet en colonne « fichier », domaine vide) — pas des documents : exclues de la recherche,
  // sinon elles domineraient la vue par défaut et pollueraient le sélecteur de statuts.
  const { donnees } = useEtatGlobal();
  const chargee = donnees !== null;
  const index = useMemo(
    () => (donnees?.index ?? []).filter((l) => !/^(intention|tache|event|important|tri(-abandon)?)\|/.test(l.cle)),
    [donnees],
  );

  const resultats = useMemo(() => {
    const base = filtrerIndex(index, { texte, domaine, statut, annee });
    const filtres = confianceBasse ? base.filter(estConfianceBasse) : base;
    return filtres.slice().reverse(); // plus récents d'abord (copie défensive)
  }, [index, texte, domaine, statut, annee, confianceBasse]);
  const domaines = useMemo(() => domainesDepuisIndex(index), [index]);
  const statuts = useMemo(() => statutsDepuisIndex(index), [index]);
  const annees = useMemo(() => anneesDepuisIndex(index), [index]);

  async function chercherContenu(terme?: string) {
    const requete = (terme ?? texte).trim();
    if (!requete) return;
    setEnCours(true);
    setContenus(null);
    try {
      setContenus(await rechercheFullText(requete));
    } catch (e) {
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  async function chercherIA() {
    if (!question.trim() || iaEnCours) return;
    setIaEnCours(true);
    setIaExplication('');
    setErreur('');
    try {
      const plan = await rechercheIA(question.trim());
      // Le plan est déjà whitelisté par le moteur — il remplace TOUT l'état de filtre
      // (un filtre résiduel masquerait silencieusement des résultats).
      setTexte(plan.texte ?? '');
      setDomaine(plan.domaine && domaines.includes(plan.domaine) ? plan.domaine : '');
      setAnnee(plan.annee && annees.includes(plan.annee) ? plan.annee : '');
      setStatut('');
      setConfianceBasse(false);
      setIaExplication(plan.explication ?? '');
      const mots = (plan.motsCles ?? []).join(' ');
      if (mots) await chercherContenu(mots);
      else setContenus(null); // pas de mots-clés → pas de résultats plein texte périmés
    } catch (e) {
      setErreur(String(e));
    } finally {
      setIaEnCours(false);
    }
  }

  return (
    <div className="colonnes">
      <section className="carte large">
        <h2>{t('recherche', langue)}</h2>
        {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
        <div className="ligne-formulaire recherche-ia">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && chercherIA()}
            placeholder={t('questionIA', langue)}
          />
          <button onClick={chercherIA} disabled={iaEnCours || !question.trim()}>
            {iaEnCours ? t('chargement', langue) : `✨ ${t('rechercheIA', langue)}`}
          </button>
        </div>
        {iaExplication && <p className="explication ia-explication">✨ {iaExplication}</p>}
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
          <label className="filtre-confiance">
            <input type="checkbox" checked={confianceBasse} onChange={(e) => setConfianceBasse(e.target.checked)} />
            {t('confianceBasse', langue)}
          </label>
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
                <td className="nombre">
                  {l.confiance !== '' && (
                    <span className={`conf-badge ${estConfianceBasse(l) ? 'basse' : ''}`}
                      title={estConfianceBasse(l) ? t('confianceBasseTitre', langue) : ''}>
                      {Number(String(l.confiance).replace(',', '.')).toFixed(2)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="carte large">
        <h2>{t('rechercheContenu', langue)}</h2>
        <p className="explication">{t('rechercheContenuExplication', langue)}</p>
        <div className="ligne-formulaire">
          <button onClick={() => chercherContenu()} disabled={enCours || !texte.trim()}>
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
