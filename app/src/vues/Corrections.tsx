/**
 * Corrections.tsx — surface n°1 de l'ADR-0008 (cœur du contrôle) :
 *  1. VALIDATION 1-CLIC des entités proposées (reste du chantier #4) : Statut → « validée »
 *     dans l'onglet Entités ; le moteur matérialise le dossier au tick suivant.
 *  2. RECLASSEMENT IMMÉDIAT d'un document : déplacement/renommage via l'API Drive, SOUS les
 *     garde-fous miroir (zone protégée jamais détachée, nom conventionnel, jamais de suppression),
 *     puis journalisation dans l'onglet Corrections → le moteur APPREND (few-shot, ADR-0003).
 */

import { useEffect, useState } from 'react';
import { lirePlage, ecrireCellule, ajouterLigne, chercherParNom, reclasserFichier, FichierDrive } from '../google';
import { LigneEntite, interpreterEntites, entitesEnAttente } from '../etat';
import { Langue, t } from '../i18n';

export function Corrections({ langue }: { langue: Langue }) {
  return (
    <div className="colonnes">
      <ValidationEntites langue={langue} />
      <ReclasserDocument langue={langue} />
    </div>
  );
}

/* ---------- 1. Validation 1-clic ---------- */

function ValidationEntites({ langue }: { langue: Langue }) {
  const [enAttente, setEnAttente] = useState<LigneEntite[]>([]);
  const [colonneStatut, setColonneStatut] = useState('');
  const [validees, setValidees] = useState<Set<number>>(new Set());
  const [erreur, setErreur] = useState('');
  const [chargee, setChargee] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const brut = await lirePlage('Entités', 'A1:H10000');
        const { lignes, colonneStatut: col } = interpreterEntites(brut);
        setEnAttente(entitesEnAttente(lignes));
        setColonneStatut(col);
      } catch (e) {
        setErreur(String(e));
      } finally {
        setChargee(true);
      }
    })();
  }, []);

  async function valider(e: LigneEntite) {
    try {
      // Écrit « validée » dans la cellule Statut de la ligne — même geste que Marc à la main ;
      // le moteur (creerDossiersEntitesValidees_) matérialise le dossier au tick suivant.
      await ecrireCellule('Entités', `${colonneStatut}${e.ligneSheet}`, 'validée');
      setValidees((v) => new Set(v).add(e.ligneSheet));
    } catch (err) {
      setErreur(String(err));
    }
  }

  return (
    <section className="carte large">
      <h2>{t('entitesAValider', langue)}</h2>
      <p className="explication">{t('validerExplication', langue)}</p>
      {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
      {chargee && enAttente.length === 0 && <p>{t('aucuneEntite', langue)}</p>}
      <table>
        <tbody>
          {enAttente.map((e) => (
            <tr key={e.ligneSheet}>
              <td><strong>{e.entite}</strong></td>
              <td>{e.domaine}</td>
              <td>{e.type}</td>
              <td className="variante">{e.variante && `${t('variantePossible', langue)} : ${e.variante}`}</td>
              <td>
                {validees.has(e.ligneSheet) ? (
                  <span className="ok">{t('valide', langue)}</span>
                ) : (
                  <button onClick={() => valider(e)}>{t('valider', langue)}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ---------- 2. Reclassement immédiat (sous garde-fous) ---------- */

function ReclasserDocument({ langue }: { langue: Langue }) {
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<FichierDrive[]>([]);
  const [choisi, setChoisi] = useState<FichierDrive | null>(null);
  const [nouveauNom, setNouveauNom] = useState('');
  const [dossierCible, setDossierCible] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function chercher() {
    setMessage(null);
    setChoisi(null);
    try {
      setResultats(await chercherParNom(recherche));
    } catch (e) {
      setMessage({ ok: false, texte: String(e) });
    }
  }

  async function appliquer() {
    if (!choisi) return;
    setEnCours(true);
    setMessage(null);
    try {
      await reclasserFichier({ fileId: choisi.id, nouveauParent: dossierCible, nouveauNom });
      // Journalise la correction → boucle d'apprentissage few-shot du moteur (ADR-0003).
      // Colonnes Corrections : Fichier | Émetteur | Domaine | Catégorie | Entité | Type | Corrigé le
      await ajouterLigne('Corrections', [nouveauNom, '', '', '', '', '', new Date().toISOString()]);
      setMessage({ ok: true, texte: t('correctionAppliquee', langue) });
      setChoisi(null);
      setResultats([]);
    } catch (e) {
      const s = String(e);
      let texte = s;
      if (s.includes('zone-protegee')) texte = t('violationZoneProtegee', langue);
      else if (s.includes('nom-invalide')) texte = t('violationNom', langue);
      setMessage({ ok: false, texte });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="carte large">
      <h2>{t('reclasserTitre', langue)}</h2>
      <p className="explication">{t('reclasserExplication', langue)}</p>
      <div className="ligne-formulaire">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder={t('rechercherFichier', langue)}
          onKeyDown={(e) => e.key === 'Enter' && chercher()}
        />
        <button onClick={chercher}>{t('rechercher', langue)}</button>
      </div>
      {resultats.length > 0 && (
        <ul className="resultats">
          {resultats.map((f) => (
            <li key={f.id}>
              <label>
                <input
                  type="radio"
                  name="fichier"
                  checked={choisi?.id === f.id}
                  onChange={() => {
                    setChoisi(f);
                    setNouveauNom(f.name);
                  }}
                />
                {f.name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {choisi && (
        <div className="formulaire-reclassement">
          <input
            value={nouveauNom}
            onChange={(e) => setNouveauNom(e.target.value)}
            placeholder={t('nouveauNom', langue)}
          />
          <input
            value={dossierCible}
            onChange={(e) => setDossierCible(e.target.value)}
            placeholder={t('dossierCible', langue)}
          />
          <button onClick={appliquer} disabled={enCours || !nouveauNom || !dossierCible}>
            {t('appliquer', langue)}
          </button>
        </div>
      )}
      {message && <p className={message.ok ? 'ok' : 'erreur'}>{message.texte}</p>}
    </section>
  );
}
