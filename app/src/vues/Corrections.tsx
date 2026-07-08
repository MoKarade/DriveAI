/**
 * Corrections.tsx — surface n°1 de l'ADR-0008 (cœur du contrôle) :
 *  1. VALIDATION 1-CLIC des entités proposées (reste du chantier #4) : Statut → « validée »
 *     dans l'onglet Entités ; le moteur matérialise le dossier au tick suivant.
 *  2. RECLASSEMENT IMMÉDIAT d'un document : déplacement/renommage via l'API Drive, SOUS les
 *     garde-fous miroir (zone protégée jamais détachée, nom conventionnel, jamais de suppression),
 *     puis journalisation COMPLÈTE (émetteur + domaine + entité) dans l'onglet Corrections —
 *     sans émetteur/domaine la ligne serait MORTE pour le few-shot du moteur (ADR-0003).
 */

import { useState } from 'react';
import { useEtatGlobal } from '../etatGlobal';
import {
  ecrireCellule,
  chercherParNom,
  reclasserFichier,
  journaliserCorrection,
  FichierDrive,
} from '../google';
import {
  LigneEntite,
  interpreterEntites,
  entitesEnAttente,
  entitesValidees,
  domainesDepuisIndex,
  emetteurDepuisNom,
  extraireIdDossier,
  cibleFusion,
} from '../etat';
import { Langue, t } from '../i18n';

export function Corrections({ langue }: { langue: Langue }) {
  // Données PARTAGÉES (P1/C28-02) : chargées/rafraîchies par le fournisseur global (5 min + ⟳).
  const { donnees } = useEtatGlobal();
  const chargee = donnees !== null;
  const { lignes: entites, colonneStatut } = interpreterEntites(donnees?.entitesBrut ?? []);
  const domaines = domainesDepuisIndex(donnees?.index ?? []);

  return (
    <div className="colonnes">
      <ValidationEntites
        langue={langue}
        enAttente={entitesEnAttente(entites)}
        colonneStatut={colonneStatut}
        chargee={chargee}
      />
      <ReclasserDocument langue={langue} domaines={domaines} destinations={entitesValidees(entites)} />
    </div>
  );
}

/* ---------- 1. Validation 1-clic ---------- */

function ValidationEntites({
  langue,
  enAttente,
  colonneStatut,
  chargee,
}: {
  langue: Langue;
  enAttente: LigneEntite[];
  colonneStatut: string;
  chargee: boolean;
}) {
  // traitees : ligneSheet → libellé du geste appliqué (validée / fusionnée / refusée).
  const [traitees, setTraitees] = useState<Map<number, string>>(new Map());
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  async function ecrireStatut(e: LigneEntite, statut: string, libelle: string) {
    if (!colonneStatut) throw new Error('Colonne Statut introuvable dans l\u2019onglet Entit\u00e9s');
    await ecrireCellule('Entités', `${colonneStatut}${e.ligneSheet}`, statut);
    setTraitees((m) => new Map(m).set(e.ligneSheet, libelle));
    setSelection((s) => { const s2 = new Set(s); s2.delete(e.ligneSheet); return s2; }); // compteur juste
  }

  async function valider(e: LigneEntite) {
    try {
      // Même geste que Marc à la main ; le moteur matérialise le dossier au tick suivant.
      await ecrireStatut(e, 'validée', t('valide', langue));
    } catch (err) {
      setErreur(String(err));
    }
  }

  async function fusionner(e: LigneEntite) {
    // Fusion 1-clic (ADR-0011) : la ligne devient « variante de : X » (statut INERTE — aucune
    // suppression, réversible) ; la cible reste la seule forme active.
    try {
      await ecrireStatut(e, `variante de : ${cibleFusion(e.variante)}`, `→ ${cibleFusion(e.variante)}`);
    } catch (err) {
      setErreur(String(err));
    }
  }

  async function refuserSelection() {
    setEnCours(true);
    try {
      // Rejet en masse : cellule par cellule (jamais de batch destructif — garde-fous ADR-0008).
      for (const e of enAttente.filter((l) => selection.has(l.ligneSheet) && !traitees.has(l.ligneSheet))) {
        await ecrireStatut(e, 'refusée', t('refusee', langue));
      }
      setSelection(new Set());
    } catch (err) {
      setErreur(String(err));
    } finally {
      setEnCours(false);
    }
  }

  const restantes = enAttente.filter((e) => !traitees.has(e.ligneSheet));

  return (
    <section className="carte large">
      <h2>{t('entitesAValider', langue)}</h2>
      <p className="explication">{t('validerExplication', langue)}</p>
      {erreur && <p className="erreur">{t('erreur', langue)} : {erreur}</p>}
      {chargee && restantes.length === 0 && <p>{t('aucuneEntite', langue)}</p>}
      {restantes.length > 0 && (
        <div className="ligne-formulaire">
          <button onClick={refuserSelection} disabled={enCours || selection.size === 0}>
            {t('refuserSelection', langue)} ({selection.size} {t('selection', langue)})
          </button>
        </div>
      )}
      <table>
        <tbody>
          {enAttente.map((e) => (
            <tr key={e.ligneSheet}>
              <td>
                {!traitees.has(e.ligneSheet) && (
                  <input
                    type="checkbox"
                    checked={selection.has(e.ligneSheet)}
                    onChange={(ev) => {
                      setSelection((s) => {
                        const s2 = new Set(s);
                        if (ev.target.checked) s2.add(e.ligneSheet);
                        else s2.delete(e.ligneSheet);
                        return s2;
                      });
                    }}
                  />
                )}
              </td>
              <td><strong>{e.entite}</strong>{e.vuNFois > 1 && <span className="variante"> ×{e.vuNFois}</span>}</td>
              <td>{e.domaine}</td>
              <td>{e.type}</td>
              <td className="variante">{e.variante && `${t('variantePossible', langue)} : ${e.variante}`}</td>
              <td className="actions">
                {traitees.has(e.ligneSheet) ? (
                  <span className="ok">{traitees.get(e.ligneSheet)}</span>
                ) : (
                  <>
                    <button onClick={() => valider(e)}>{t('valider', langue)}</button>
                    {cibleFusion(e.variante) && (
                      <button className="discret" onClick={() => fusionner(e)}>
                        {t('fusionner', langue)} → {cibleFusion(e.variante)}
                      </button>
                    )}
                  </>
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

function ReclasserDocument({
  langue,
  domaines,
  destinations,
}: {
  langue: Langue;
  domaines: string[];
  destinations: LigneEntite[];
}) {
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<FichierDrive[]>([]);
  const [choisi, setChoisi] = useState<FichierDrive | null>(null);
  const [nouveauNom, setNouveauNom] = useState('');
  const [emetteur, setEmetteur] = useState('');
  const [domaine, setDomaine] = useState('');
  const [entite, setEntite] = useState('');
  const [destination, setDestination] = useState(''); // ID ou URL Drive collée
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

  const idDestination = extraireIdDossier(destination);

  async function appliquer() {
    if (!choisi || !idDestination) return;
    setEnCours(true);
    setMessage(null);
    try {
      await reclasserFichier({ fileId: choisi.id, nouveauParent: idDestination, nouveauNom });
      // Journalisation COMPLÈTE → boucle d'apprentissage few-shot (ADR-0003). Émetteur + domaine
      // obligatoires (bouton gaté) : sans eux, le moteur ignorerait la ligne.
      await journaliserCorrection({ fichier: nouveauNom, emetteur, domaine, entite });
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
                    setEmetteur(emetteurDepuisNom(f.name));
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
            onChange={(e) => {
              setNouveauNom(e.target.value);
              if (!emetteur) setEmetteur(emetteurDepuisNom(e.target.value));
            }}
            placeholder={t('nouveauNom', langue)}
          />
          <input value={emetteur} onChange={(e) => setEmetteur(e.target.value)} placeholder={t('emetteur', langue)} />
          <input
            value={domaine}
            onChange={(e) => setDomaine(e.target.value)}
            placeholder={t('domaine', langue)}
            list="domaines-connus"
          />
          <datalist id="domaines-connus">
            {domaines.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <input value={entite} onChange={(e) => setEntite(e.target.value)} placeholder={t('entiteOptionnelle', langue)} />
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder={t('dossierCible', langue)}
            list="destinations-validees"
          />
          <datalist id="destinations-validees">
            {destinations.map((d) => (
              <option key={d.dossierId} value={d.dossierId}>
                {`${d.entite} (${d.domaine})`}
              </option>
            ))}
          </datalist>
          <button onClick={appliquer} disabled={enCours || !nouveauNom || !idDestination || !emetteur || !domaine}>
            {t('appliquer', langue)}
          </button>
        </div>
      )}
      {message && <p className={message.ok ? 'ok' : 'erreur'}>{message.texte}</p>}
    </section>
  );
}
