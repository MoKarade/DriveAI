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

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Section } from '../App';
import { listerEvenements, listerTaches, cocherTache, ajouterLigne } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { ListeSuspects, useSuspectsVisibles } from '../composants/Suspects';
import { Icone } from '../composants/Icone';
import {
  LigneIndex,
  lignesSuspects,
  lignesAVerifier,
  importantsAFaire,
  STATUT_IMPORTANT_FAIT,
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
  tachesAFaire,
  heureEvenement,
  titresDriveAI,
} from '../agenda';
import { formaterDateCourte, formaterDateSeule } from '../explorateur';
import { useAgendas, agendasAffiches, reconnecterPourAgendas } from '../agendasStore';
import { Langue, t } from '../i18n';

const CLASSEMENTS_RECENTS = 5;
const SUSPECTS_MAX = 5;
const A_VERIFIER_MAX = 5;
const IMPORTANTS_MAX = 5;
const IMPORTANTS_JOURS = 7; // au-delà, un ⏰ sort tout seul de « À faire » (même fenêtre que le résumé)

/**
 * « Fait » sur un mail ⏰ : masqué à toute la SESSION, pas au composant. En `useState`, le masque
 * mourait au changement d'onglet (`key={section}` remonte la vue) et le mail réapparaissait, l'Index
 * n'étant relu que toutes les 5 minutes — le clic n'avait pas l'air de tenir (audit app 2026-09-10).
 * Même patron que `masquesSession` de `Suspects.tsx`, avec son mini-store abonné.
 */
const faitsSession = new Set<string>();
const abonnesFaits = new Set<() => void>();
let versionFaits = 0;

function marquerFait(cle: string, fait: boolean) {
  if (fait) faitsSession.add(cle); else faitsSession.delete(cle);
  versionFaits++;
  abonnesFaits.forEach((cb) => cb());
}

function useFaitsSession(): Set<string> {
  useSyncExternalStore(
    (cb) => { abonnesFaits.add(cb); return () => { abonnesFaits.delete(cb); }; },
    () => versionFaits,
  );
  return faitsSession;
}

export function AujourdHui({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  const { donnees, synchroA } = useEtatGlobal();
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [erreur, setErreur] = useState('');
  const [agendaHS, setAgendaHS] = useState(false); // lecture Tasks/Calendar en échec : ne pas dire « rien à faire »
  const importantsFaits = useFaitsSession(); // « Fait » optimiste, à l'échelle de la session
  const suspects = useSuspectsVisibles(donnees ? lignesSuspects(donnees.index) : []);
  // « Ma journée » couvre TOUS les agendas cochés (C28-41 PR2 — Family inclus).
  const etatAgendas = useAgendas();
  const affiches = agendasAffiches(etatAgendas);
  const cleAgendas = affiches.map((a) => a.id).sort().join('|');

  // RDV et tâches du jour. Un échec ne doit PAS passer pour « rien à faire » : sans agenda ni
  // tâches, l'accueil affichait une journée vide et une liste vide, c'est-à-dire un mensonge sur
  // l'écran que Marc regarde en premier (audit app 2026-09-10). Le reste de l'accueil (documents,
  // suspects, classements) vit toujours — seule la bannière apparaît en plus.
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
      } catch (e) {
        setAgendaHS(true);
        setErreur(String(e));
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
      // échec réel → la tâche revient (sans doublon si un rechargement l'a déjà remise), l'erreur s'affiche
      setTaches((ts) => (ts.some((x) => x.id === tache.id) ? ts : [...ts, tache]));
      setErreur(String(e));
    }
  }

  /**
   * « Fait » sur un mail ⏰ : l'app n'a pas de scope Gmail (elle ne peut ni lire ni archiver le
   * fil) — elle ajoute une ligne `important|<id>` au statut `important-fait` dans l'Index : l'état
   * courant de la clé change, le mail sort de « À faire » ; le moteur, qui ne juge que la présence
   * de la clé, ne re-marque jamais ce mail. Aucune suppression, une ligne ajoutée (append-only).
   */
  async function importantFait(l: LigneIndex) {
    setErreur('');
    marquerFait(l.cle, true); // OPTIMISTE
    try {
      const quand = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await ajouterLigne('Index', [l.cle, quand, l.fichier, '', '', STATUT_IMPORTANT_FAIT, '', '']);
    } catch (e) {
      marquerFait(l.cle, false);
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
  // Compter AVANT de tronquer : le badge annonçait 5 là où 30 documents attendaient, et rien dans
  // l'app ne montrait les 25 autres depuis que les filtres d'Index ont disparu (audit app 2026-09-10).
  const aVerifierTous = lignesAVerifier(docs);
  const aVerifier = aVerifierTous.slice(0, A_VERIFIER_MAX);
  const importantsTous = importantsAFaire(donnees.index, maintenant, IMPORTANTS_JOURS)
    .filter((l) => !importantsFaits.has(l.cle));
  const importants = importantsTous.slice(0, IMPORTANTS_MAX);
  const cleAujourdhui = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  const tachesJour = tachesAFaire(taches, maintenant); // du jour ET en retard, jamais les faites
  const evtsJour = evenementsDuJour(evenements, maintenant);
  // Jeton d'avant le scope `calendar.readonly` : sans ça « Ma journée » resterait vide sans un mot
  // — l'autorisation est une chose À FAIRE, avec son bouton (revue flotte PR 0).
  const agendasAAutoriser = etatAgendas.statut === 'scope';
  const nbAFaire = suspects.length + aVerifierTous.length + importantsTous.length + tachesJour.length
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
          {aVerifierTous.length > aVerifier.length && (
            <button className="ligne texte" onClick={() => onAller('documents')}>
              <Icone nom="fichier" className="erreur" />
              <span className="t"><b>{t('autresAVerifier', langue).replace('{n}', String(aVerifierTous.length - aVerifier.length))}</b></span>
              <Icone nom="chevron" className="chev" />
            </button>
          )}
          {importants.map((l: LigneIndex) => (
            <div key={l.cle} className="ligne">
              <Icone nom="horloge" className="accent" />
              <a className="t lien-ligne" href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer">
                <b>{l.fichier}</b>
                <small>{t('mailATraiter', langue)} · {formaterDateCourte(l.traiteLe, locale)}</small>
              </a>
              <button className="bouton-ligne" aria-label={`${t('fait', langue)} : ${l.fichier}`} onClick={() => void importantFait(l)}>
                ✓ {t('fait', langue)}
              </button>
            </div>
          ))}
          {importantsTous.length > importants.length && (
            <div className="ligne">
              <Icone nom="horloge" className="accent" />
              <span className="t"><b>{t('autresMails', langue).replace('{n}', String(importantsTous.length - importants.length))}</b></span>
            </div>
          )}
          {tachesJour.map((tk) => (
            <div key={tk.id} className="ligne">
              <Icone nom="aujourdhui" />
              <span className="t">
                <b>{tk.titre}</b>
                <small>
                  {t('tache', langue)}
                  {tk.echeance < cleAujourdhui && <> · <span className="erreur">{t('enRetard', langue)} · {formaterDateSeule(tk.echeance, locale)}</span></>}
                  {tk.parDriveAI ? ` · ${t('parDriveAI', langue)}` : ''}
                </small>
              </span>
              <button className="bouton-ligne principal" aria-label={`${t('fait', langue)} : ${tk.titre}`} onClick={() => void fait(tk)}>
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
          {/* « Rien à faire » seulement si on a VRAIMENT pu tout lire (sinon c'est une affirmation
              fausse : agenda et tâches manquent à l'appel). */}
          {nbAFaire === 0 && !agendaHS && <p className="ligne vide">{t('rienAFaire', langue)}</p>}
          {nbAFaire === 0 && agendaHS && <p className="ligne vide">{t('agendaIndispo', langue)}</p>}
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
                {e.journee ? <span className="heure">—</span> : <time className="heure" dateTime={e.debut}>{heureEvenement(e)}</time>}
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
