/**
 * AujourdHui.tsx — accueil v7 (C28-82 PR1, ADR-0051 ; Marc 2026-09-09 : « quelques boutons simples
 * à comprendre et qui fonctionnent, moins de déchets, tout ce qui est fini à la poubelle »).
 * Trois listes, aucune phrase :
 *  1. À FAIRE — ce qui demande sa main : mails suspects (« Pas suspect »), documents « à vérifier »
 *     (lien Drive), mails ⏰ à traiter (lien Gmail), tâches du jour (« Fait »). Une ligne = une
 *     chose, au plus un bouton. Vide ⇒ une seule ligne « Rien à faire ».
 *  2. MA JOURNÉE — les RDV du jour, lecture seule ; la section DISPARAÎT s'il n'y a rien.
 *  3. CLASSÉ RÉCEMMENT — la preuve que le moteur range (lien Drive).
 * Le coût LLM a quitté l'accueil (Réglages). Ce qui est FINI n'est jamais affiché : une tâche
 * cochée disparaît, un suspect marqué « pas suspect » disparaît (masquage optimiste, Suspects.tsx).
 */

import { useEffect, useState } from 'react';
import type { Section } from '../App';
import { listerEvenements, listerTaches, cocherTache } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { ListeSuspects, useSuspectsVisibles } from '../composants/Suspects';
import { Icone } from '../composants/Icone';
import {
  LigneIndex,
  lignesSuspects,
  lignesAVerifier,
  lignesImportants,
  traitesLeJour,
  lienDrivePourLigne,
  lienGmailPourLigne,
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
import { useAgendas, agendasAffiches, reconnecterPourAgendas } from '../agendasStore';
import { Langue, t } from '../i18n';

const CLASSEMENTS_RECENTS = 5;
const SUSPECTS_MAX = 5;
const A_VERIFIER_MAX = 5;
const IMPORTANTS_MAX = 5;

export function AujourdHui({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees, synchroA } = useEtatGlobal();
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [erreur, setErreur] = useState('');
  const suspects = useSuspectsVisibles(donnees ? lignesSuspects(donnees.index) : []);
  // « Ma journée » couvre TOUS les agendas cochés (C28-41 PR2 — Family inclus).
  const etatAgendas = useAgendas();
  const affiches = agendasAffiches(etatAgendas);
  const cleAgendas = affiches.map((a) => a.id).sort().join('|');

  // RDV et tâches du jour — un échec est SILENCIEUX ici (les listes restent vides, l'accueil vit).
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
        /* silencieux : la journée reste vide, le reste de l'accueil vit */
      }
    })();
    // `synchroA` : rechargé à CHAQUE lecture réussie (création de RDV comprise), fenêtre du jour
    // recalculée à chaque exécution — « aujourd'hui » suit le passage de minuit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleAgendas = photo stable des agendas cochés
  }, [synchroA, cleAgendas]);

  /** « Fait » : coche la tâche dans Google Tasks et la retire de la liste — fini = disparu. */
  async function fait(tache: Tache) {
    setErreur('');
    setTaches((ts) => ts.filter((x) => x.id !== tache.id)); // OPTIMISTE
    try {
      await cocherTache(tache.id, true);
    } catch (e) {
      setTaches((ts) => [...ts, tache]); // échec réel → la tâche revient, l'erreur s'affiche
      setErreur(String(e));
    }
  }

  if (!donnees) return <IndicateurChargement langue={langue} />;

  const maintenant = new Date();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';

  // Documents seuls (les lignes mail — intention/tache/event/important/tri — ne sont pas des docs).
  const docs = donnees.index.filter((l) => !/^(intention|tache|event|important|tri(-abandon)?)\|/.test(l.cle));
  const classements = docs.filter((l) => l.statut === 'classé').slice(-CLASSEMENTS_RECENTS).reverse();
  const aujourdhui = traitesLeJour(docs, maintenant);
  const aVerifier = lignesAVerifier(docs).slice(0, A_VERIFIER_MAX);
  const importants = lignesImportants(donnees.index).slice(0, IMPORTANTS_MAX);
  const tachesJour = tachesDuJour(taches, maintenant).filter((tk) => !tk.faite);
  const evtsJour = evenementsDuJour(evenements, maintenant);
  // Jeton d'avant le scope `calendar.readonly` : sans ça « Ma journée » resterait vide sans un mot
  // — l'autorisation est une chose À FAIRE, avec son bouton (revue flotte PR 0).
  const agendasAAutoriser = etatAgendas.statut === 'scope';
  const nbAFaire = Math.min(suspects.length, SUSPECTS_MAX) + aVerifier.length + importants.length + tachesJour.length
    + (agendasAAutoriser ? 1 : 0);

  return (
    <div className="accueil">
      {/* ---------- 1. À faire ---------- */}
      <section>
        <h2 className="titre-liste">
          {t('aFaire', langue)}
          {nbAFaire > 0 && <span className="badge">{nbAFaire}</span>}
          <span className="h2-note">{maintenant.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </h2>
        <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => setErreur('')} />
        <div className="carte lignes">
          {suspects.length > 0 && <ListeSuspects langue={langue} suspects={suspects} max={SUSPECTS_MAX} />}
          {aVerifier.map((l: LigneIndex) => (
            <a key={l.cle} className="ligne" href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer">
              <Icone nom="fichier" className="erreur" />
              <span className="t">
                <b className="mono">{l.fichier}</b>
                <small>{t('aVerifierCourt', langue)} · {formaterDateCourte(l.traiteLe, locale)}</small>
              </span>
              <Icone nom="externe" className="chev" />
            </a>
          ))}
          {importants.map((l: LigneIndex) => (
            <a key={l.cle} className="ligne" href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
              <Icone nom="horloge" className="accent" />
              <span className="t">
                <b>{l.fichier}</b>
                <small>{t('mailATraiter', langue)} · {formaterDateCourte(l.traiteLe, locale)}</small>
              </span>
              <Icone nom="externe" className="chev" />
            </a>
          ))}
          {tachesJour.map((tk) => (
            <div key={tk.id} className="ligne">
              <Icone nom="aujourdhui" />
              <span className="t">
                <b>{tk.titre}</b>
                <small>{t('tache', langue)}{tk.parDriveAI ? ` · ${t('parDriveAI', langue)}` : ''}</small>
              </span>
              <button className="bouton-ligne principal" onClick={() => void fait(tk)}>
                ✓ {t('fait', langue)}
              </button>
            </div>
          ))}
          {agendasAAutoriser && (
            <div className="ligne">
              <Icone nom="agenda" className="attention" />
              <span className="t"><b>{t('agendasAutoriser', langue)}</b></span>
              <button className="bouton-ligne principal" onClick={() => reconnecterPourAgendas()}>{t('seReconnecter', langue)}</button>
            </div>
          )}
          {nbAFaire === 0 && <p className="ligne vide">{t('rienAFaire', langue)}</p>}
        </div>
      </section>

      {/* ---------- 2. Ma journée — seulement s'il y a quelque chose ---------- */}
      {evtsJour.length > 0 && (
        <section>
          <h2 className="titre-liste">
            {t('agendaDuJour', langue)}
            <button className="lien" onClick={() => onAller('agenda')}>{t('agenda', langue)} ›</button>
          </h2>
          <div className="carte lignes">
            {evtsJour.map((e) => (
              <a key={e.id} className="ligne" href={e.lien} target="_blank" rel="noreferrer">
                <time>{e.journee ? '—' : heureEvenement(e)}</time>
                <span className="barre" style={e.couleur ? { background: e.couleur } : undefined} aria-hidden="true" />
                <span className="t">
                  <b>{e.titre}</b>
                  {e.lieu && <small>{e.lieu}</small>}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ---------- 3. Classé récemment ---------- */}
      <section>
        <h2 className="titre-liste">
          {t('derniersClassements', langue)}
          {aujourdhui > 0 && <span className="h2-note ok">+{aujourdhui} {t('aujourdhuiCourt', langue)}</span>}
          <button className="lien" onClick={() => onAller('documents')}>{t('documents', langue)} ›</button>
        </h2>
        <div className="carte lignes">
          {classements.length === 0 && <p className="ligne vide">{t('aucunClassement', langue)}</p>}
          {classements.map((l: LigneIndex) => (
            <a key={l.cle} className="ligne" href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer">
              <Icone nom="fichier" />
              <span className="t">
                <b className="mono">{l.fichier}</b>
                <small>{l.domaine}</small>
              </span>
              <Icone nom="externe" className="chev" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
