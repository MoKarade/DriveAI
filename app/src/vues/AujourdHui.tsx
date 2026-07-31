/**
 * AujourdHui.tsx — accueil v6 (C28-41, décisions Marc 2026-07-31). Quatre briques, rien d'autre :
 *  1. ALERTES — seulement s'il y en a (mails suspects, documents « à vérifier » ADR-0016) ;
 *  2. MA JOURNÉE — les RDV et tâches du jour (Calendar/Tasks, lecture seule) ;
 *  3. DERNIERS CLASSEMENTS — la preuve que le moteur range, avec lien Drive ;
 *  4. COÛT LLM — une tuile sobre, horodatée par le dernier passage moteur (honnêteté : on voit
 *     l'ÂGE de la donnée, plus jamais un chiffre figé qui « semble cassé »).
 * Les actions rapides, opérations en cours et entités à valider sont SUPPRIMÉES (photos Marc).
 */

import { useEffect, useState } from 'react';
import type { Section } from '../App';
import { listerEvenements, listerTaches } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement } from '../composants/UI';
import { ListeSuspects, useSuspectsVisibles } from '../composants/Suspects';
import {
  LigneIndex,
  interpreterSante,
  lignesSuspects,
  lignesAVerifier,
  traitesLeJour,
  coutDepuisSante,
  dernierPassageDepuisSante,
  ageMoteurMinutes,
  lienDrivePourLigne,
} from '../etat';
import {
  Evenement,
  Tache,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  heureEvenement,
  titresDriveAI,
} from '../agenda';
import { formaterDateCourte } from '../explorateur';
import { useAgendas, agendasAffiches } from '../agendasStore';
import { Langue, t } from '../i18n';

const BUDGET_LLM = 10; // cible < 10 $/mois (CLAUDE.md §2.6)
const CLASSEMENTS_RECENTS = 8;
const SUSPECTS_MAX = 5;
const A_VERIFIER_MAX = 5;

export function AujourdHui({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees } = useEtatGlobal();
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [agendaCharge, setAgendaCharge] = useState(false);
  const suspects = useSuspectsVisibles(donnees ? lignesSuspects(donnees.index) : []);
  // « Ma journée » couvre TOUS les agendas cochés (C28-41 PR2 — Family inclus).
  const etatAgendas = useAgendas();
  const affiches = agendasAffiches(etatAgendas);
  const cleAgendas = affiches.map((a) => a.id).sort().join('|');

  // « Ma journée » : Calendar/Tasks du jour (l'Agenda complet a son propre cycle) — un échec est
  // SILENCIEUX ici (la brique s'affiche vide, l'accueil reste utile).
  useEffect(() => {
    if (!donnees) return;
    const auj = new Date();
    const debut = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate());
    const fin = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate() + 1);
    (async () => {
      try {
        const marques = titresDriveAI(donnees.index);
        const [listes, tks] = await Promise.all([
          Promise.all(affiches.map(async (a) => interpreterEvenements(
            await listerEvenements(debut.toISOString(), fin.toISOString(), a.id),
            marques,
            { id: a.id, couleur: a.couleur },
          ))),
          listerTaches(),
        ]);
        setEvenements(listes.flat().sort((x, y) => x.debut.localeCompare(y.debut)));
        setTaches(interpreterTaches(tks, marques));
      } catch {
        /* silencieux : la brique agenda reste vide, le reste de l'accueil vit */
      } finally {
        setAgendaCharge(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleAgendas = photo stable des agendas cochés
  }, [donnees === null, cleAgendas]);

  if (!donnees) return <IndicateurChargement langue={langue} />;

  const maintenant = new Date();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const sante = interpreterSante(donnees.santeBrut);

  // Documents seuls (les lignes mail — intention/tache/event/important/tri — ne sont pas des docs).
  const docs = donnees.index.filter((l) => !/^(intention|tache|event|important|tri(-abandon)?)\|/.test(l.cle));
  const classes = docs.filter((l) => l.statut === 'classé');
  const classements = classes.slice(-CLASSEMENTS_RECENTS).reverse();
  const aujourdhui = traitesLeJour(docs, maintenant);
  const aVerifier = lignesAVerifier(docs);
  const cout = coutDepuisSante(sante.lignes);
  const passage = dernierPassageDepuisSante(sante.lignes);
  const age = ageMoteurMinutes(sante.lignes, maintenant);

  const evtsJour = evenementsDuJour(evenements, maintenant);
  const tachesJour = tachesDuJour(taches, maintenant);
  const alertes = suspects.length > 0 || aVerifier.length > 0;

  return (
    <div className="accueil">
      {/* ---------- 1. Alertes — UNIQUEMENT quand il y en a ---------- */}
      {alertes && (
        <section className="carte zone-attention">
          <h2>{t('zoneAttention', langue)}</h2>

          {suspects.length > 0 && (
            <div className="attention-bloc">
              <h3>⚠ {t('suspectsTitre', langue)} ({suspects.length})</h3>
              <ListeSuspects langue={langue} suspects={suspects} max={SUSPECTS_MAX} />
              <p className="explication">{t('suspectsNote', langue)}</p>
            </div>
          )}

          {aVerifier.length > 0 && (
            <div className="attention-bloc">
              <h3>{t('docsAVerifier', langue)} ({aVerifier.length})</h3>
              {aVerifier.slice(0, A_VERIFIER_MAX).map((l) => (
                <div key={l.cle} className="ligne-attention">
                  <a href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                    {l.fichier}
                  </a>
                  <span className="date">{formaterDateCourte(l.traiteLe, locale)}</span>
                </div>
              ))}
              <p className="explication">{t('docsAVerifierNote', langue)}</p>
            </div>
          )}
        </section>
      )}

      <div className="accueil-grille">
        {/* ---------- 2. Ma journée ---------- */}
        <section className="carte">
          <h2>
            {t('agendaDuJour', langue)}
            <span className="h2-note">
              {maintenant.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          </h2>
          {agendaCharge && evtsJour.length === 0 && tachesJour.length === 0 && (
            <p className="jour-vide">{t('rienAujourdhui', langue)}</p>
          )}
          {!agendaCharge && <p className="jour-vide">{t('chargement', langue)}</p>}
          {evtsJour.map((e) => (
            <a key={e.id} className="jour-ligne" href={e.lien} target="_blank" rel="noreferrer">
              <span className="jour-heure">{e.journee ? t('journee', langue) : heureEvenement(e)}</span>
              {e.couleur && <span className="jour-puce" style={{ background: e.couleur }} aria-hidden="true" />}
              <span className="jour-titre">{e.titre}</span>
              {e.lieu && <span className="jour-lieu">{e.lieu}</span>}
            </a>
          ))}
          {tachesJour.map((tk) => (
            <div key={tk.id} className="jour-ligne">
              <span className="jour-heure douce">☐ {t('tache', langue).toLowerCase()}</span>
              <span className="jour-titre">{tk.titre}</span>
            </div>
          ))}
          <p style={{ margin: '0.7rem 0 0' }}>
            <button className="discret" onClick={() => onAller('agenda')}>{t('voirAgenda', langue)} →</button>
          </p>
        </section>

        <div className="accueil-droite">
          {/* ---------- 4. Coût LLM (tuile sobre, horodatée) ---------- */}
          <section className="carte">
            <h2>
              {t('coutLlm', langue)}
              {passage && (
                <span className="h2-note" title={`${t('dernierPassage', langue)} ${passage}`}>
                  {t('donneesMoteur', langue)}{age !== null ? (langue === 'fr' ? ` · il y a ${age} min` : ` · ${age} min ago`) : ''}
                </span>
              )}
            </h2>
            <div className="cout-tuile">
              <span className="v">{cout ? cout.dollars.toFixed(2) : '—'} <small>$ / {BUDGET_LLM} $</small></span>
              {cout && <span className="variante">{cout.appels.toLocaleString(locale)} appels</span>}
            </div>
            {cout && (
              <div className="jauge" role="img" aria-label={`${cout.dollars.toFixed(2)} $ / ${BUDGET_LLM} $`}>
                <i className={cout.dollars >= BUDGET_LLM ? 'pleine' : ''}
                  style={{ width: `${Math.min(100, (cout.dollars / BUDGET_LLM) * 100)}%` }} />
              </div>
            )}
          </section>

          {/* ---------- 3. Derniers classements ---------- */}
          <section className="carte">
            <h2>
              {t('derniersClassements', langue)}
              {aujourdhui > 0 && <span className="h2-note ok">+{aujourdhui} {t('aujourdhuiCourt', langue)}</span>}
            </h2>
            {classements.length === 0 && <p className="explication">{t('aucunClassement', langue)}</p>}
            <table>
              <tbody>
                {classements.map((l: LigneIndex) => (
                  <tr key={l.cle} className="ligne-clic" title="Drive">
                    <td>
                      <a href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                        {l.fichier}
                      </a>
                      <div className="variante">{l.domaine}</div>
                    </td>
                    <td className="date">{formaterDateCourte(l.traiteLe, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
