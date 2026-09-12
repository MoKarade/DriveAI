/**
 * Reglages.tsx — RÉGLAGES v7 (C28-82 PR1, ADR-0051 — décision Marc : « Réglages : 3 chiffres +
 * « Avancé » replié »). Remplace la page technique « Moteur » (C28-41, huit blocs) :
 *  - une ligne d'état (pastille + « dernier passage il y a N min ») ;
 *  - TROIS chiffres : documents classés, mails triés, coût LLM du mois / cible ;
 *  - les réglages en lignes : fréquence des passages, langue, synchro, hub, déconnexion ;
 *  - « Avancé », REPLIÉ : campagnes EN COURS ou en difficulté seulement (tout ce qui est fini,
 *    à jour ou désactivé n'est plus affiché — « à la poubelle », Marc 2026-09-09), quotas Gmail
 *    du jour, erreurs des 7 derniers jours SEULEMENT s'il y en a.
 * Honnêteté conservée : donnée absente ⇒ « — », jamais un faux 0 ; état inconnu ⇒ gris.
 */

import { useState } from 'react';
import { ecrireCellule } from '../google';
import { HUB_URL } from '../config';
import { useEtatGlobal, useProgressionLive } from '../etatGlobal';
import { IndicateurChargement } from '../composants/UI';
import {
  EtatMoteur,
  LigneJournal,
  interpreterSante,
  interpreterJournal,
  interpreterTelemetrie,
  fraicheurMoteur,
  ageMoteurMinutes,
  dernierPassageDepuisSante,
  compteursIndex,
  coutDepuisSante,
  erreursDesDerniersJours,
  familleStatut,
  FamilleStatut,
  LigneProgression,
  JaugeJour,
  ilYA,
  complementStatut,
} from '../etat';
import { formaterMontant } from '../explorateur';
import { CleTexte, Langue, t } from '../i18n';

const BUDGET_CROISIERE = 10; // cible < 10 $/mois en croisière (CLAUDE.md §1.6)
const ERREURS_MAX = 8;
// Whitelist 5/10/15/30 — les mêmes valeurs que le moteur accepte (validerTickMinutes_).
const TICKS_MINUTES = [5, 10, 15, 30];

export function Reglages({ langue, onLangue, onDeconnexion }: {
  langue: Langue;
  onLangue: () => void;
  onDeconnexion: () => void;
}) {
  const { donnees, synchroA, rafraichir } = useEtatGlobal();
  const progression = useProgressionLive();
  const maintenant = new Date();
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';
  const heureSynchro = synchroA ? synchroA.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '…';

  // Les réglages qui ne dépendent PAS de la Sheet (langue, synchro, hub, déconnexion) restent
  // accessibles même quand la première lecture échoue (403 de scope, quota) — se déconnecter pour
  // re-consentir est justement le remède (revue flotte PR 0, 🟠).
  const carteReglages = (
    <section className="carte">
      <div className="reglage-lignes">
        {/* `key` : remonté quand la valeur réelle arrive (le composant existe déjà avant les données). */}
        <FrequenceLigne key={donnees?.reglagesBrut?.[0]?.[1] ?? ''} langue={langue} valeurInitiale={donnees?.reglagesBrut?.[0]?.[1] ?? ''} />
        <div className="reglage-ligne">
          <span>{t('langueLibelle', langue)}</span>
          <button className="discret" onClick={onLangue}>{langue === 'fr' ? 'English' : 'Français'}</button>
        </div>
        <div className="reglage-ligne">
          <span>{t('synchro', langue)}</span>
          <button className="discret" onClick={() => void rafraichir(true)} title={t('rafraichir', langue)}>⟳ {heureSynchro}</button>
        </div>
        <div className="reglage-ligne">
          <span>Hub</span>
          <a className="lien-bouton" href={HUB_URL}>{t('retourHub', langue)} ↗</a>
        </div>
        <div className="reglage-ligne">
          <span>{t('session', langue)}</span>
          <button className="discret danger" onClick={onDeconnexion}>{t('deconnexion', langue)}</button>
        </div>
      </div>
    </section>
  );

  if (!donnees) {
    return (
      <div className="colonnes">
        <IndicateurChargement langue={langue} />
        {carteReglages}
      </div>
    );
  }

  const sante = interpreterSante(donnees.santeBrut);
  const journal = interpreterJournal(donnees.journalBrut);
  const tele = interpreterTelemetrie(donnees.telemetrieBrut);
  const tick = Number(donnees.reglagesBrut?.[0]?.[1]) || 5;

  const etat: EtatMoteur = fraicheurMoteur(sante.lignes, maintenant, tick);
  const passage = dernierPassageDepuisSante(sante.lignes);
  const age = ageMoteurMinutes(sante.lignes, maintenant);
  const titresEtat: Record<EtatMoteur, CleTexte> = {
    ok: 'moteurVivant', retard: 'moteurRetard', mort: 'moteurSilencieux', inconnu: 'moteurInconnu',
  };

  // Trois chiffres — documents et mails depuis l'Index (état courant) ; pour le coût, la
  // télémétrie (horodatée) prime, la ligne Santé sert de repli.
  const compteurs = compteursIndex(donnees.index);
  const cout = tele.presente && tele.coutDollars !== null ? tele.coutDollars : (coutDepuisSante(sante.lignes)?.dollars ?? null);

  // Avancé : seulement ce qui bouge ou coince. Fini, à jour, désactivé ⇒ absent — sauf une
  // mission « à jour » qui laisse un reliquat (« N non apparié(s) », C28-50) : ce n'est pas fini.
  const actives = progression.filter((op) => {
    const f = familleStatut(op.statut);
    if (f === 'ajour') return complementStatut(op.statut) !== '';
    return f !== 'termine' && f !== 'inactif';
  });
  const erreurs = erreursDesDerniersJours(journal, 7, maintenant).slice(-ERREURS_MAX).reverse();
  const jauges: Array<{ cle: CleTexte; j: JaugeJour }> = [
    { cle: 'jaugeCyclique', j: tele.cycliqueJour },
    { cle: 'jaugeHisto', j: tele.histoJour },
    { cle: 'jaugeBoite', j: tele.boiteJour },
  ];

  return (
    <div className="colonnes">
      <p className={`moteur-etat ${etat}`} title={passage ? `${t('dernierPassage', langue)} ${passage}` : undefined}>
        <span className="pm-point" aria-hidden="true" />
        {t(titresEtat[etat], langue)}
        {age !== null && <span className="variante"> · {langue === 'fr' ? `il y a ${age} min` : `${age} min ago`}</span>}
      </p>

      <div className="tuiles-3">
        <div className="tuile"><b>{compteurs.documentsClasses.toLocaleString(locale)}</b><small>{t('documentsClasses', langue)}</small></div>
        <div className="tuile"><b>{compteurs.mailsTries.toLocaleString(locale)}</b><small>{t('filsTries', langue)}</small></div>
        <div className="tuile">
          <b>{cout !== null ? formaterMontant(cout, locale) : '—'}</b>
          <small>{t('coutMoisCourt', langue)} · {formaterMontant(BUDGET_CROISIERE, locale, 0)}</small>
        </div>
      </div>

      {carteReglages}

      <details className="avance">
        <summary>
          {t('avance', langue)}
          {actives.length > 0 && <span className="pastille douce" title={t('campagnesEnCours', langue)}>{actives.length}</span>}
          {tele.quotaSuspendu && <span className="pastille crit" title={t('quotaGmail', langue)}>{t('quotaEtatSuspendu', langue)}</span>}
          {erreurs.length > 0 && <span className="pastille attn" title={t('erreurs7j', langue)}>{erreurs.length}</span>}
        </summary>
        <div className="avance-corps">
          <div>
            <h3>{t('campagnesEnCours', langue)}</h3>
            {actives.length === 0 && <p className="variante">{t('rienEnCours', langue)}</p>}
            <div className="operations-live">
              {actives.map((op) => <Operation key={op.cle} langue={langue} op={op} />)}
            </div>
          </div>

          {tele.presente && (
            <div>
              <h3>
                {t('quotaGmail', langue)}
                {tele.quotaSuspendu && <> · <span className="erreur">{tele.quotaDetail || t('quotaEtatSuspendu', langue)}</span></>}
              </h3>
              {jauges.map(({ cle, j }) => (
                <div key={cle} className="ligne-jauge">
                  <span className="lj-nom">{t(cle, langue)}</span>
                  <span className="lj-compte">
                    {j.lus.toLocaleString(locale)}{j.plafond !== null && <> / {j.plafond.toLocaleString(locale)}</>}
                  </span>
                  {j.plafond !== null && (
                    <div className="jauge" role="img" aria-label={`${j.lus} / ${j.plafond}`}>
                      <i style={{ width: `${Math.min(100, (j.lus / j.plafond) * 100)}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {erreurs.length > 0 && (
            <div>
              <h3>{t('erreurs7j', langue)}</h3>
              <table>
                <tbody>
                  {erreurs.map((l: LigneJournal, i) => (
                    <tr key={i} className="ligne-erreur">
                      <td className="date">{l.date}</td>
                      <td>{l.source}</td>
                      <td>{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Fréquence des passages (#22, choix Marc : UN réglage global). L'app écrit `Réglages!A2:B2`
 * (contrat de position fixe) ; le moteur relit au tick suivant et ré-installe son déclencheur
 * (assurerIntervalleTick_). Jamais de saisie libre.
 */
function FrequenceLigne({ langue, valeurInitiale }: { langue: Langue; valeurInitiale: string }) {
  const initiale = TICKS_MINUTES.includes(Number(valeurInitiale)) ? String(Number(valeurInitiale)) : '5';
  const [tick, setTick] = useState(initiale);
  const [statut, setStatut] = useState('');

  async function changer(v: string) {
    setTick(v);
    setStatut('');
    try {
      // A2 réécrit aussi (auto-réparation si la clé a été effacée à la main).
      await ecrireCellule('Réglages', 'A2', 'TICK_MINUTES');
      await ecrireCellule('Réglages', 'B2', v);
      setStatut('ok');
    } catch (e) {
      setStatut(String(e));
    }
  }

  return (
    <div className="reglage-ligne">
      <span>
        {t('frequenceTick', langue)}
        {statut === 'ok' && <span className="ok"> {t('reglageOk', langue)}</span>}
        {statut && statut !== 'ok' && <span className="erreur"> {statut.slice(0, 80)}</span>}
      </span>
      <select value={tick} onChange={(e) => changer(e.target.value)} aria-label={t('frequenceTick', langue)}>
        {TICKS_MINUTES.map((m) => (
          <option key={m} value={String(m)}>{t('toutesLes', langue)} {m} min</option>
        ))}
      </select>
    </div>
  );
}

/**
 * Note d'explication d'un état non trivial (C28-44/45) : la RAISON EXACTE publiée par le moteur
 * (colonne Détail) prime sur les gloses génériques ; le budget du JOUR d'une campagne n'est
 * jamais glosé « frein budget LLM ».
 */
function noteStatut(op: LigneProgression, famille: FamilleStatut, langue: Langue): string {
  if (famille === 'recensement') return t('noteRecensement', langue);
  if (famille === 'attente') return t('noteAttente', langue);
  if (famille === 'ajour') {
    if (op.statut.includes('non apparié')) return complementStatut(op.statut) + ' — ' + t('noteNonApparies', langue);
    return t('noteDejaFait', langue);
  }
  if (famille === 'suspendu' || famille === 'pause') {
    if (op.statut.includes('budget du jour')) return t('noteBudgetJour', langue);
    if (op.detail) return t('noteSuspendueRaison', langue) + ' ' + op.detail;
    return famille === 'suspendu'
      ? (op.statut.includes('quota') ? t('noteQuota', langue) : t('notePanneApi', langue))
      : t('noteBudget', langue);
  }
  return '';
}

const LIBELLES_STATUT: Record<FamilleStatut, CleTexte> = {
  encours: 'stEnCours', recensement: 'stRecensement', attente: 'stEnAttente',
  suspendu: 'stSuspendu', pause: 'stPause', termine: 'stTermine',
  erreur: 'stErreur', inactif: 'stInactif', ajour: 'stAJour',
};

const CLASSE_PASTILLE: Record<FamilleStatut, string> = {
  termine: 'ok', suspendu: 'crit', erreur: 'crit', encours: 'douce',
  inactif: 'douce', recensement: 'attn', attente: 'attn', pause: 'attn',
  ajour: 'ok',
};

/** Une opération de l'onglet Progression : nom, statut, compte, barre, raison si elle coince. */
function Operation({ langue, op }: { langue: Langue; op: LigneProgression }) {
  const famille = familleStatut(op.statut);
  const pct = op.base ? Math.min(100, Math.round((op.traites / op.base) * 100)) : null;
  const arret = famille === 'suspendu' || famille === 'pause' || famille === 'attente';
  const note = noteStatut(op, famille, langue);
  const sansCompteur = op.base === null && op.traites === 0 && famille !== 'recensement';
  return (
    <div className={`operation ${famille}`}>
      <div className="op-entete">
        <span className="op-nom">{op.operation}</span>
        <span className={`pastille ${CLASSE_PASTILLE[famille]}`}>{t(LIBELLES_STATUT[famille], langue)}</span>
        <span className="op-compte">
          {op.base !== null
            ? <><b>{op.traites.toLocaleString('fr-CA')}</b> / {op.base.toLocaleString('fr-CA')} {op.unite}{pct !== null && <> · <b>{pct} %</b></>}</>
            : !sansCompteur && <><b>{op.traites.toLocaleString('fr-CA')}</b> {op.unite}</>}
        </span>
      </div>
      {op.base !== null && !arret && (
        <div className={`op-barre ${pct === 100 ? 'pleine' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      )}
      {op.base === null && !sansCompteur && famille === 'recensement' && <div className="op-barre indeterminee"><i /></div>}
      {arret && <div className="op-barre rayee" />}
      {op.finEstimee && <p className="op-note">{t('finEstimee', langue)} {op.finEstimee}</p>}
      {note && <p className="op-note">{note}</p>}
      {op.derniereActivite && (
        <p className="op-note">{t('derniereActivite', langue)} {ilYA(op.derniereActivite, new Date(), langue) ?? op.derniereActivite}</p>
      )}
      {op.derniereErreur && <p className="op-note op-erreur">{t('derniereErreur', langue)} {op.derniereErreur}</p>}
    </div>
  );
}
