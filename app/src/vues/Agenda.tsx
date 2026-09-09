/**
 * Agenda.tsx — v7 (ADR-0051, C28-82 PR3). Téléphone : vue LISTE par défaut (bande de 7 jours,
 * un bloc par jour qui a quelque chose) et bascule GRILLE (3 jours glissants). PC : grille
 * HORAIRE absolue Jour/Semaine/Mois (Semaine par défaut, C28-23) — rangée « toute la journée »,
 * gouttière d'heures, blocs à la minute, couleurs par agenda, ligne « maintenant » —, dans un
 * conteneur défilant OUVERT À 7 H (rien de caché : la nuit reste au-dessus). Un clic sur un
 * CRÉNEAU vide ouvre la création pré-remplie ; un clic sur un BLOC ouvre un popover façon GCal.
 * La date se pilote ici (‹ › Aujourd'hui), « Mes agendas » est une rangée de puces sous le titre,
 * le « + » de l'en-tête ouvre la création libre. Tâches ouvertes en lignes (case = « Fait »), les
 * faites disparaissent. Écritures : créer et cocher — jamais supprimer ni modifier.
 */

import { useEffect, useRef, useState } from 'react';
import { listerEvenements, listerTaches, cocherTache } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Creation } from '../composants/Creation';
import {
  Evenement,
  Tache,
  JourGrille,
  grilleMois,
  grilleSemaine,
  grilleJour,
  grilleTroisJours,
  cleJour,
  interpreterEvenements,
  interpreterTaches,
  evenementsDuJour,
  tachesDuJour,
  planningParJour,
  heureEvenement,
  libelleHoraire,
  positionEvenement,
  positionMaintenant,
  titresDriveAI,
} from '../agenda';
import { Langue, t } from '../i18n';
import { useAgendas, agendasAffiches, basculerAgenda, basculerTaches, reconnecterPourAgendas, rechargerAgendas } from '../agendasStore';
import { Icone } from '../composants/Icone';

const JOURS_SEMAINE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

type VueCal = 'jour' | 'semaine' | 'mois';
type Popover = { genre: 'evenement'; e: Evenement } | { genre: 'tache'; tache: Tache };

/** Écran étroit (mobile) : la vue Semaine passe en 3 jours glissants (décision Marc). */
function useEstEtroit(): boolean {
  const [etroit, setEtroit] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const suivre = (e: MediaQueryListEvent) => setEtroit(e.matches);
    mq.addEventListener('change', suivre);
    return () => mq.removeEventListener('change', suivre);
  }, []);
  return etroit;
}

export function Agenda({ langue }: { langue: Langue }) {
  const maintenant = new Date();
  const [mois, setMois] = useState(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
  const [vueCal, setVueCal] = useState<VueCal>('semaine'); // Semaine par défaut (C28-23)
  const [semaineRef, setSemaineRef] = useState(maintenant);
  const [evenements, setEvenements] = useState<Evenement[]>([]);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [creneau, setCreneau] = useState<{ date: string; heure: string } | null>(null);
  const [creationLibre, setCreationLibre] = useState(false); // « + » de l'en-tête (v7)
  const [modeTel, setModeTel] = useState<'liste' | 'grille'>('liste'); // téléphone (PR 3) : liste par défaut
  const defilantRef = useRef<HTMLDivElement>(null);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState('');
  const etroit = useEstEtroit();
  const enListe = etroit && modeTel === 'liste'; // téléphone en vue Liste : la bande est la SEMAINE

  // La grille s'ouvre à 7 h : sur téléphone, huit heures vides défilaient avant le premier RDV
  // (captures v7). Rien n'est caché — la nuit reste au-dessus, il suffit de remonter.
  // `charge` dans les dépendances : la grille n'existe qu'après la première lecture (avant, c'est le
  // chargement) — sans lui, l'effet tournait sur un conteneur absent et la grille restait à 0 h.
  useEffect(() => {
    const el = defilantRef.current;
    if (el) el.scrollTop = (7 / 24) * el.scrollHeight;
  }, [vueCal, modeTel, etroit, charge]);

  // « Mes agendas » RÉEL (C28-41 PR2) : les événements sont chargés PAR agenda coché (couleur
  // de l'agenda sur chaque bloc) ; la case Tâches filtre l'affichage de la grille — la liste
  // des tâches en bas de page reste complète.
  const etatAgendas = useAgendas();
  const affiches = agendasAffiches(etatAgendas);
  const cleAgendas = affiches.map((a) => a.id).sort().join('|'); // dépendance STABLE du fetch
  const evenementsAffiches = evenements;
  const tachesAffichees = etatAgendas.taches ? taches : [];

  // La plage Tasks/Calendar chargée reste TOUJOURS celle de la grille du MOIS : jour/semaine
  // sont des sous-ensembles (la navigation garde `mois` aligné sur sa référence), donc changer
  // de vue ou de jour dans le même mois ne re-fetch rien.
  const semainesMois = grilleMois(mois.getFullYear(), mois.getMonth());
  const joursGrille: JourGrille[] =
    vueCal === 'jour' ? grilleJour(semaineRef)
      : etroit ? grilleTroisJours(semaineRef)
        : grilleSemaine(semaineRef);

  /**
   * Navigation ‹ › : ±1 mois, ±7 j (±3 en grille mobile) ou ±1 jour — `mois` suit la référence.
   * En vue Liste, le pas est TOUJOURS la semaine : la bande affiche `grilleSemaine(semaineRef)`,
   * un pas de 3 jours depuis mercredi ne changeait rien à l'écran (revue flotte PR 3).
   */
  function naviguer(sens: 1 | -1) {
    if (vueCal === 'mois') {
      const m = new Date(mois.getFullYear(), mois.getMonth() + sens, 1);
      setMois(m);
      setSemaineRef(m); // la date focalisée SUIT la vue Mois (revue flotte, comportement GCal)
      return;
    }
    const pas = enListe ? 7 : vueCal === 'jour' ? 1 : etroit ? 3 : 7;
    const ref = new Date(semaineRef.getFullYear(), semaineRef.getMonth(), semaineRef.getDate() + pas * sens);
    setSemaineRef(ref);
    if (ref.getMonth() !== mois.getMonth() || ref.getFullYear() !== mois.getFullYear()) {
      setMois(new Date(ref.getFullYear(), ref.getMonth(), 1));
    }
  }

  /** Un jour cliqué (en-tête de colonne, case du mois) → vue JOUR sur ce jour, façon GCal. */
  function ouvrirJour(j: Date) {
    setSemaineRef(j);
    if (j.getMonth() !== mois.getMonth() || j.getFullYear() !== mois.getFullYear()) {
      setMois(new Date(j.getFullYear(), j.getMonth(), 1));
    }
    setVueCal('jour');
  }

  const { donnees, synchroA, rafraichir } = useEtatGlobal();

  useEffect(() => {
    if (!donnees) return;
    (async () => {
      try {
        const debut = semainesMois[0][0].date;
        const finJour = semainesMois[semainesMois.length - 1][6].date;
        const fin = new Date(finJour.getFullYear(), finJour.getMonth(), finJour.getDate() + 1);
        const lignes = donnees.index;
        const marques = titresDriveAI(lignes);
        // Un fetch PAR agenda coché (C28-41 PR2) : chaque événement est étiqueté de la couleur
        // de son agenda ; fusion triée chronologiquement (même contrat qu'avant, multi-sources).
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
        setCharge(true);
        setErreur('');
      } catch (e) {
        setErreur(String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleAgendas = photo stable des agendas cochés
  }, [mois, synchroA, cleAgendas]);

  /** Nom de l'agenda source d'un événement (popover) — '' si inconnu/principal sans nom. */
  function nomAgendaDe(agendaId?: string): string {
    if (!agendaId) return '';
    return etatAgendas.liste.find((a) => a.id === agendaId)?.nom ?? '';
  }

  async function basculerTache(tache: Tache) {
    try {
      await cocherTache(tache.id, !tache.faite);
      setTaches((ts) => ts.map((x) => (x.id === tache.id ? { ...x, faite: !tache.faite } : x)));
    } catch (e) {
      setErreur(String(e));
    }
  }

  if (erreur) return <BanniereErreur langue={langue} erreur={erreur} onReessayer={() => { setErreur(''); void rafraichir(true); }} />;
  if (!donnees || !charge) return <IndicateurChargement langue={langue} />;

  const aujourdhuiCle = cleJour(new Date());

  return (
    <div className="colonnes agenda">
      <section className={'carte cal-carte' + (enListe ? ' liste' : '')}>
        <h2>
          <span className="cal-titre">{MOIS[(vueCal === 'mois' ? mois : semaineRef).getMonth()]} {(vueCal === 'mois' ? mois : semaineRef).getFullYear()}</span>
          <span className="cal-nav">
            {etroit ? (
              <span className="segment" role="group">
                <button className={modeTel === 'liste' ? 'on' : ''} onClick={() => setModeTel('liste')}>{t('vueListe', langue)}</button>
                <button className={modeTel === 'grille' ? 'on' : ''} onClick={() => setModeTel('grille')}>{t('vueGrille', langue)}</button>
              </span>
            ) : (
              <span className="segment" role="group">
                {(['jour', 'semaine', 'mois'] as VueCal[]).map((v) => (
                  <button key={v} className={vueCal === v ? 'on' : ''} onClick={() => setVueCal(v)}>
                    {t(v === 'jour' ? 'vueJour' : v === 'semaine' ? 'vueSemaine' : 'vueMois', langue)}
                  </button>
                ))}
              </span>
            )}
            <button className="discret" aria-label={t('precedent', langue)} onClick={() => naviguer(-1)}>‹</button>
            <button className="discret"
              onClick={() => {
                const auj = new Date();
                setMois(new Date(auj.getFullYear(), auj.getMonth(), 1));
                setSemaineRef(auj);
              }}>{t('aujourdhui', langue)}</button>
            <button className="discret" aria-label={t('suivant', langue)} onClick={() => naviguer(1)}>›</button>
            <button className="icone-bouton" aria-label={t('creerBouton', langue)} title={t('creerBouton', langue)}
              onClick={() => setCreationLibre(true)}>
              <Icone nom="plus" />
            </button>
          </span>
        </h2>

        {/* « Mes agendas » (C28-41 PR2) en puces, ici et plus dans une barre latérale (v7) :
            cases à cocher stylées, couleur de l'agenda, plus la case Tâches. */}
        <div className="agendas-puces" role="group" aria-label={t('mesAgendas', langue)}>
          {etatAgendas.liste.map((a) => (
            <label key={a.id} className={etatAgendas.visibles.has(a.id) ? 'on' : ''}>
              <input type="checkbox" checked={etatAgendas.visibles.has(a.id)} onChange={() => basculerAgenda(a.id)} />
              <span className="puce" style={{ background: a.couleur }} aria-hidden="true" />
              {a.nom || t('agendaPrincipal', langue)}
            </label>
          ))}
          <label className={etatAgendas.taches ? 'on' : ''}>
            <input type="checkbox" checked={etatAgendas.taches} onChange={() => basculerTaches()} />
            <span className="puce" style={{ background: 'var(--attention)' }} aria-hidden="true" />
            {t('agendaTaches', langue)}
          </label>
          {etatAgendas.statut === 'scope' && (
            <span className="agendas-scope">
              <span className="explication">{t('agendasReconnexion', langue)}</span>
              <button className="discret" onClick={() => reconnecterPourAgendas()}>{t('seReconnecter', langue)}</button>
            </span>
          )}
          {etatAgendas.statut === 'erreur' && (
            <span className="agendas-scope">
              <span className="explication">{t('agendasErreur', langue)}</span>
              <button className="discret" onClick={() => rechargerAgendas()}>{t('reessayer', langue)}</button>
            </span>
          )}
        </div>

        {enListe ? (
          <ListeJours
            langue={langue}
            jours={grilleSemaine(semaineRef)}
            reference={semaineRef}
            evenements={evenementsAffiches}
            taches={tachesAffichees}
            aujourdhuiCle={aujourdhuiCle}
            onJour={(j) => setSemaineRef(j)}
            onEvenement={(e) => setPopover({ genre: 'evenement', e })}
            onTache={(tache) => setPopover({ genre: 'tache', tache })}
            onCocher={(tache) => void basculerTache(tache)}
          />
        ) : vueCal === 'mois' ? (
          <>
            <table className="cal">
              <thead>
                <tr>{JOURS_SEMAINE.map((j) => <th key={j}>{j}</th>)}</tr>
              </thead>
              <tbody>
                {semainesMois.map((semaine, i) => (
                  <tr key={i}>
                    {semaine.map((j: JourGrille) => {
                      const evts = evenementsDuJour(evenementsAffiches, j.date);
                      const dues = tachesDuJour(tachesAffichees, j.date);
                      const estAuj = cleJour(j.date) === aujourdhuiCle;
                      return (
                        <td
                          key={cleJour(j.date)}
                          className={`${j.horsMois ? 'hors' : ''} ${estAuj ? 'auj' : ''}`}
                          onClick={() => ouvrirJour(j.date)}
                        >
                          <span className="num">{j.date.getDate()}</span>
                          {evts.map((e) => (
                            <span key={e.id} className={`ev ${e.parDriveAI ? 'ia' : ''}`}
                              style={!e.parDriveAI && e.couleur ? { background: `${e.couleur}33`, color: 'var(--texte)' } : undefined}>
                              {heureEvenement(e) && `${heureEvenement(e)} `}{e.titre}
                            </span>
                          ))}
                          {dues.map((d) => (
                            <span key={d.id} className="ev tache">☐ {d.titre}</span>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="gt-defilant" ref={defilantRef}>
            <GrilleTemps
              langue={langue}
              jours={joursGrille}
              evenements={evenementsAffiches}
              taches={tachesAffichees}
              aujourdhuiCle={aujourdhuiCle}
              onEntete={ouvrirJour}
              onCreneau={(j, h) => setCreneau({ date: cleJour(j), heure: `${String(h).padStart(2, '0')}:00` })}
              onEvenement={(e) => setPopover({ genre: 'evenement', e })}
              onTache={(tache) => setPopover({ genre: 'tache', tache })}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="titre-liste">{t('tachesOuvertes', langue)}</h2>
        <div className="carte lignes">
          {taches.every((tk) => tk.faite) && <p className="ligne vide">{t('aucuneTache', langue)}</p>}
          {taches.filter((tk) => !tk.faite).map((tk) => (
            <div key={tk.id} className="ligne">
              <button className="icone-bouton petit" aria-label={`${t('cocher', langue)} : ${tk.titre}`} title={t('marquerFaite', langue)}
                onClick={() => void basculerTache(tk)}>
                <Icone nom="coche" />
              </button>
              <button className="t texte" onClick={() => setPopover({ genre: 'tache', tache: tk })}>
                <b>{tk.titre}</b>
                <small>{tk.echeance ? `${t('echeance', langue)} ${tk.echeance}` : t('sansEcheance', langue)}{tk.parDriveAI && ` · ${t('parDriveAI', langue)}`}</small>
              </button>
            </div>
          ))}
        </div>
      </section>


      {/* « + » de l'en-tête (v7) : création libre — tâche ou RDV, sans pré-remplissage. */}
      {creationLibre && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setCreationLibre(false)} />
          <div className="dialogue" role="dialog" aria-label={t('creer', langue)}>
            <Creation langue={langue} onCree={() => { setCreationLibre(false); void rafraichir(true); }} />
            <button className="discret" onClick={() => setCreationLibre(false)}>{t('fermer', langue)}</button>
          </div>
        </>
      )}

      {/* Clic sur un créneau vide (PR3) : création pré-remplie date+heure, en dialogue. */}
      {creneau && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setCreneau(null)} />
          <div className="dialogue" role="dialog" aria-label={t('creer', langue)}>
            <Creation
              langue={langue}
              typeInitial="rdv"
              dateInitiale={creneau.date}
              heureInitiale={creneau.heure}
              onCree={() => { setCreneau(null); void rafraichir(true); }}
            />
            <button className="discret" onClick={() => setCreneau(null)}>{t('fermer', langue)}</button>
          </div>
        </>
      )}

      {/* Popover d'un bloc (PR3) — remplace les panneaux Détail du bas de page. */}
      {popover && (
        <>
          <button className="feuille-fond" aria-label={t('fermer', langue)} onClick={() => setPopover(null)} />
          <div className="dialogue popover-ev" role="dialog" aria-label={popover.genre === 'evenement' ? popover.e.titre : popover.tache.titre}>
            {popover.genre === 'evenement' ? (
              <>
                <h3>{popover.e.titre}</h3>
                <p className="pe-ligne">
                  📅 {new Date(popover.e.journee ? popover.e.debut + 'T12:00:00' : popover.e.debut)
                    .toLocaleDateString(langue === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
                <p className="pe-ligne">🕐 {popover.e.journee ? t('journee', langue) : libelleHoraire(popover.e, langue === 'fr')}</p>
                {popover.e.lieu && <p className="pe-ligne">📍 {popover.e.lieu}</p>}
                {nomAgendaDe(popover.e.agendaId) && (
                  <p className="pe-ligne">
                    <span className="puce" style={{ background: popover.e.couleur, display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 6 }} aria-hidden="true" />
                    {nomAgendaDe(popover.e.agendaId)}
                  </p>
                )}
                {popover.e.parDriveAI && <p className="pe-ligne variante">{t('parDriveAI', langue)}</p>}
                <div className="actions">
                  <a className="lien-bouton" href={popover.e.lien} target="_blank" rel="noreferrer">Agenda ↗</a>
                </div>
              </>
            ) : (
              <>
                <h3>{popover.tache.titre}</h3>
                <p className="pe-ligne">
                  🕐 {popover.tache.echeance
                    ? `${t('echeance', langue)} ${popover.tache.echeance}`
                    : t('sansEcheance', langue)}
                </p>
                {popover.tache.parDriveAI && <p className="pe-ligne variante">{t('parDriveAI', langue)}</p>}
                <div className="actions">
                  <button onClick={() => { void basculerTache(popover.tache); setPopover(null); }}>
                    {popover.tache.faite ? t('decocher', langue) : `☑ ${t('marquerFaite', langue)}`}
                  </button>
                  <a className="lien-bouton" href="https://tasks.google.com/" target="_blank" rel="noreferrer">Tasks ↗</a>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Grille HORAIRE façon Google Agenda (C28-23 PR2/PR3) : en-têtes de jours (pastille sur
 * aujourd'hui — clic = vue Jour), rangée « toute la journée » (événements journée + tâches à
 * échéance — clic = popover), gouttière d'heures, colonnes où chaque bloc est positionné en
 * ABSOLU (top/height en % — positionEvenement). Couleurs PAR TYPE (décision Marc) : bleu =
 * RDV perso, ambre = DriveAI, gris = journée entière. Ligne rouge « maintenant ». Un clic sur
 * un CRÉNEAU vide remonte le jour + l'heure (créés depuis la position Y du clic, plan PR3).
 */
/**
 * Vue LISTE (téléphone, v7 PR 3) : une bande de 7 jours (point = quelque chose ce jour-là), puis un
 * bloc par jour qui a du contenu — aujourd'hui toujours, avec « rien ce jour » s'il est vide.
 * Un tap sur un jour de la bande y fait défiler la liste. Aucune grille horaire à parcourir.
 */
function ListeJours({ langue, jours, reference, evenements, taches, aujourdhuiCle, onJour, onEvenement, onTache, onCocher }: {
  langue: Langue;
  jours: JourGrille[];
  reference: Date;
  evenements: Evenement[];
  taches: Tache[];
  aujourdhuiCle: string;
  onJour: (j: Date) => void;
  onEvenement: (e: Evenement) => void;
  onTache: (t: Tache) => void;
  onCocher: (t: Tache) => void;
}) {
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const plan = planningParJour(jours, evenements, taches, aujourdhuiCle);
  const avecContenu = new Set(plan.filter((j) => j.evenements.length + j.taches.length > 0).map((j) => cleJour(j.date)));
  const refCle = cleJour(reference);
  return (
    <div className="liste-jours">
      <div className="bande-jours" role="group">
        {jours.map((j) => {
          const cle = cleJour(j.date);
          return (
            <button
              key={cle}
              className={(cle === aujourdhuiCle ? 'auj' : '') + (cle === refCle ? ' sel' : '')}
              onClick={() => { onJour(j.date); document.getElementById(`jour-${cle}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}
            >
              <span>{JOURS_SEMAINE[(j.date.getDay() + 6) % 7]}</span>
              <b>{j.date.getDate()}</b>
              {avecContenu.has(cle) && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {plan.map((j) => {
        const cle = cleJour(j.date);
        return (
          <div key={cle} id={`jour-${cle}`} className="jour-carte">
            <h3>
              {j.date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric' })}
              {cle === aujourdhuiCle && ` · ${t('aujourdhui', langue).toLowerCase()}`}
            </h3>
            <div className="carte lignes">
              {j.evenements.length + j.taches.length === 0 && <p className="ligne vide">{t('rienCeJour', langue)}</p>}
              {j.evenements.map((e) => (
                <button key={e.id} className="ligne texte" onClick={() => onEvenement(e)}>
                  <span className="heure">{e.journee ? '—' : heureEvenement(e)}</span>
                  <span className="barre" style={{ background: e.parDriveAI ? 'var(--attention)' : (e.couleur || 'var(--accent)') }} aria-hidden="true" />
                  <span className="t">
                    <b>{e.titre}</b>
                    {(e.lieu || e.journee) && <small>{e.journee ? t('journee', langue) : ''}{e.journee && e.lieu ? ' · ' : ''}{e.lieu ?? ''}</small>}
                  </span>
                </button>
              ))}
              {j.taches.map((tk) => (
                <div key={tk.id} className="ligne">
                  <button className="icone-bouton petit" aria-label={`${t('cocher', langue)} : ${tk.titre}`} title={t('marquerFaite', langue)} onClick={() => onCocher(tk)}>
                    <Icone nom="coche" />
                  </button>
                  <button className="t texte" onClick={() => onTache(tk)}>
                    <b>{tk.titre}</b>
                    <small>{t('tache', langue)}{tk.parDriveAI && ` · ${t('parDriveAI', langue)}`}</small>
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GrilleTemps({ langue, jours, evenements, taches, aujourdhuiCle, onEntete, onCreneau, onEvenement, onTache }: {
  langue: Langue;
  jours: JourGrille[];
  evenements: Evenement[];
  taches: Tache[];
  aujourdhuiCle: string;
  onEntete: (j: Date) => void;
  onCreneau: (j: Date, heure: number) => void;
  onEvenement: (e: Evenement) => void;
  onTache: (t: Tache) => void;
}) {
  const fr = langue === 'fr';
  const heures = Array.from({ length: 23 }, (_, i) => i + 1);
  const pctMaintenant = positionMaintenant(new Date());
  const gabarit = { gridTemplateColumns: `52px repeat(${jours.length}, 1fr)` };

  return (
    <div className="grille-temps">
      <div className="gt-rang" style={gabarit}>
        <div />
        {jours.map((j) => {
          const auj = cleJour(j.date) === aujourdhuiCle;
          return (
            <button key={cleJour(j.date)} className={'gt-entete' + (auj ? ' auj' : '')} onClick={() => onEntete(j.date)}>
              <span className="gt-nom">{JOURS_SEMAINE[(j.date.getDay() + 6) % 7]}</span>
              <span className="gt-num">{j.date.getDate()}</span>
            </button>
          );
        })}
      </div>

      <div className="gt-rang gt-tj" style={gabarit}>
        <div />
        {jours.map((j) => {
          const journee = evenementsDuJour(evenements, j.date).filter((e) => e.journee);
          const dues = tachesDuJour(taches, j.date);
          return (
            <div key={cleJour(j.date)} className="gt-tj-col">
              {journee.map((e) => (
                <button key={e.id} className="gt-bloc-tj" onClick={() => onEvenement(e)}
                  style={!e.parDriveAI && e.couleur ? { background: e.couleur, color: '#fff', borderColor: 'transparent' } : undefined}>
                  {e.titre}
                </button>
              ))}
              {dues.map((d) => (
                <button key={d.id} className="gt-bloc-tj ia" onClick={() => onTache(d)}>☐ {d.titre}</button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="gt-rang gt-corps" style={gabarit}>
        <div className="gt-gouttiere">
          {heures.map((h) => (
            <span key={h} style={{ top: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>
          ))}
        </div>
        {jours.map((j) => {
          const auj = cleJour(j.date) === aujourdhuiCle;
          const evts = evenementsDuJour(evenements, j.date).filter((e) => !e.journee);
          return (
            <div
              key={cleJour(j.date)}
              className="gt-col"
              onClick={(ev) => {
                // Heure du CLIC dérivée de la position Y dans la COLONNE (plan PR3) — clientY − bord
                // du conteneur, jamais offsetY (relatif à target : un enfant fausserait l'heure).
                const rect = ev.currentTarget.getBoundingClientRect();
                const h = Math.max(0, Math.min(23, Math.floor(((ev.clientY - rect.top) / rect.height) * 24)));
                onCreneau(j.date, h);
              }}
            >
              {evts.map((e) => {
                const pos = positionEvenement(e);
                if (!pos) return null;
                return (
                  <button
                    key={e.id}
                    className={'gt-ev' + (e.parDriveAI ? ' ia' : '')}
                    style={{
                      top: `${pos.top}%`,
                      height: `${pos.hauteur}%`,
                      ...(!e.parDriveAI && e.couleur ? { background: e.couleur, color: '#fff' } : {}),
                    }}
                    onClick={(ev) => { ev.stopPropagation(); onEvenement(e); }}
                  >
                    <b>{e.titre}</b>
                    <span>{libelleHoraire(e, fr)}</span>
                    {e.lieu && <span>{e.lieu}</span>}
                  </button>
                );
              })}
              {auj && <i className="gt-maintenant" style={{ top: `${pctMaintenant}%` }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
