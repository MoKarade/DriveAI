/**
 * Moteur.tsx — page TECHNIQUE unique (C28-41, décisions Marc 2026-07-31). Remplace les onglets
 * « Coûts & quotas » et « Santé du moteur ». Quatre briques choisies par Marc :
 *  1. ÉTAT — pastille + dernier passage + lignes Santé + dernières ERREURS du Journal ;
 *  2. COÛT LLM fiable — Télémétrie horodatée par le dernier passage (fini le « ça semble
 *     cassé » : quand le moteur n'a pas écrit depuis X min, on LE DIT au lieu d'afficher un
 *     chiffre qui a l'air figé) + quota Gmail du jour ;
 *  3. PROGRESSION — campagnes & opérations (onglet Progression, poll léger 15 s) ;
 *  4. RÉGLAGE — fréquence des passages (déplacé de l'ancienne page Santé).
 */

import { useState } from 'react';
import { ecrireCellule } from '../google';
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
  erreursRecentes,
  familleStatut,
  FamilleStatut,
  LigneProgression,
  JaugeJour,
} from '../etat';
import { CleTexte, Langue, t } from '../i18n';

const BUDGET_CROISIERE = 10; // cible < 10 $/mois en croisière (CLAUDE.md §2.6)
const ERREURS_MAX = 12;

export function Moteur({ langue }: { langue: Langue }) {
  const { donnees } = useEtatGlobal();
  const progression = useProgressionLive();
  if (!donnees) return <IndicateurChargement langue={langue} />;

  const maintenant = new Date();
  const sante = interpreterSante(donnees.santeBrut);
  const journal = interpreterJournal(donnees.journalBrut);
  const tele = interpreterTelemetrie(donnees.telemetrieBrut);
  const tick = Number(donnees.reglagesBrut?.[0]?.[1]) || 5;

  const etat: EtatMoteur = fraicheurMoteur(sante.lignes, maintenant, tick);
  const passage = dernierPassageDepuisSante(sante.lignes);
  const age = ageMoteurMinutes(sante.lignes, maintenant);
  const erreurs7j = erreursRecentes(journal, 7, maintenant);
  const erreurs = journal.filter((l) => l.niveau === 'ERREUR').slice(-ERREURS_MAX).reverse();

  const horodatage = passage
    ? `${t('donneesMoteur', langue)}${age !== null ? (langue === 'fr' ? ` · il y a ${age} min` : ` · ${age} min ago`) : ''}`
    : '';

  const titresEtat: Record<EtatMoteur, CleTexte> = {
    ok: 'moteurVivant', retard: 'moteurRetard', mort: 'moteurSilencieux', inconnu: 'moteurInconnu',
  };

  const jauges: Array<{ cle: CleTexte; j: JaugeJour }> = [
    { cle: 'jaugeCyclique', j: tele.cycliqueJour },
    { cle: 'jaugeHisto', j: tele.histoJour },
    { cle: 'jaugeBoite', j: tele.boiteJour },
  ];

  return (
    <div className="colonnes">
      {/* ---------- 1. État ---------- */}
      <section className="carte">
        <h2>{t('etatMoteur', langue)}{horodatage && <span className="h2-note">{horodatage}</span>}</h2>
        <p className={`moteur-etat ${etat}`}>
          <span className="pm-point" aria-hidden="true" />
          {t(titresEtat[etat], langue)}
          {passage && <span className="variante"> — {t('dernierPassage', langue)} {passage}</span>}
        </p>
        <ul className="sante">
          {sante.lignes
            .filter((l) => !l.startsWith('Dernier passage') && !l.startsWith('Mis à jour'))
            .map((l, i) => <li key={i}>{l}</li>)}
        </ul>
        <p className="statut-quota" style={{ marginTop: '0.7rem' }}>
          <span className={`pastille ${erreurs7j ? 'attn' : 'ok'}`}>{erreurs7j}</span>{' '}
          {langue === 'fr' ? 'erreurs au Journal · 7 j' : 'Journal errors · 7d'}
        </p>
      </section>

      {/* ---------- 2. Coût LLM fiable ---------- */}
      <section className="carte">
        <h2>{t('coutLlmTitre', langue)}{horodatage && <span className="h2-note">{horodatage}</span>}</h2>
        {!tele.presente && <p className="explication">{t('telemetrieVide', langue)}</p>}
        {tele.presente && (
          <>
            <div className="cout-tuile">
              <span className="v">{tele.coutDollars !== null ? tele.coutDollars.toFixed(2) : '—'} <small>$</small></span>
              <span className="variante">{t('coutCeMois', langue)}</span>
              {tele.appelsMois !== null && (
                <span className="variante">· {tele.appelsMois.toLocaleString(langue === 'fr' ? 'fr-CA' : 'en-CA')} {t('appelsCeMois', langue)}</span>
              )}
            </div>
            {tele.coutDollars !== null && tele.freinDollars !== null && tele.freinDollars > 0 && (
              <div className="jauge" role="img" aria-label={`${tele.coutDollars.toFixed(2)} $ / ${tele.freinDollars} $`}>
                <i style={{ width: `${Math.min(100, (tele.coutDollars / tele.freinDollars) * 100)}%` }} />
              </div>
            )}
            <p className="statut-quota" style={{ marginTop: '0.6rem' }}>
              {tele.freinDollars !== null && (
                <span className="pastille douce">{t('freinCampagnes', langue)} : {tele.freinDollars} $</span>
              )}
              <span className="pastille douce">{t('cibleCroisiere', langue)} : {BUDGET_CROISIERE} $</span>
            </p>
            <p className="explication">{t('coutLlmNote', langue)}</p>
          </>
        )}
      </section>

      {/* ---------- 3. Progression (campagnes & opérations) ---------- */}
      <section className="carte large operations-live">
        <h2>{t('progressionTitre', langue)}</h2>
        {progression.length === 0 && <p className="explication">{t('progressionVide', langue)}</p>}
        {progression.map((op) => <Operation key={op.cle} langue={langue} op={op} />)}
      </section>

      {/* ---------- Quota Gmail du jour ---------- */}
      <section className="carte large">
        <h2>
          {t('quotaGmailTitre', langue)}
          <span className={`pastille ${tele.quotaSuspendu ? 'crit' : 'ok'}`}>
            {tele.quotaSuspendu ? t('quotaEtatSuspendu', langue) : t('quotaEtatActif', langue)}
          </span>
        </h2>
        {tele.quotaSuspendu && tele.quotaDetail && <p className="erreur">{tele.quotaDetail}</p>}
        {!tele.presente && <p className="explication">{t('telemetrieVide', langue)}</p>}
        {tele.presente && jauges.map(({ cle, j }) => (
          <div key={cle} className="ligne-jauge">
            <span className="lj-nom">{t(cle, langue)}</span>
            <span className="lj-compte">
              {j.lus.toLocaleString('fr-CA')}{j.plafond !== null && <> / {j.plafond.toLocaleString('fr-CA')}</>} {t('filsLusJour', langue)}
            </span>
            {j.plafond !== null && (
              <div className="jauge" role="img" aria-label={`${j.lus} / ${j.plafond}`}>
                <i style={{ width: `${Math.min(100, (j.lus / j.plafond) * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
        <p className="explication">{t('quotaGmailNote', langue)}</p>
      </section>

      {/* ---------- 1 bis. Dernières erreurs ---------- */}
      <section className="carte large">
        <h2>{t('erreursJournal', langue)}</h2>
        {erreurs.length === 0 && <p className="explication">{t('aucuneErreur', langue)}</p>}
        {erreurs.length > 0 && (
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
        )}
      </section>

      {/* ---------- 4. Réglage de fréquence ---------- */}
      <ReglagesSection langue={langue} valeurInitiale={donnees.reglagesBrut?.[0]?.[1] ?? ''} />
    </div>
  );
}

/** Note d'explication d'un état non trivial (mêmes règles que l'ancien OperationsLive C28-18). */
function noteStatut(op: LigneProgression, famille: FamilleStatut, langue: Langue): string {
  if (famille === 'recensement') return t('noteRecensement', langue);
  if (famille === 'attente') return t('noteAttente', langue);
  if (famille === 'suspendu') return op.statut.includes('quota') ? t('noteQuota', langue) : t('notePanneApi', langue);
  if (famille === 'pause') return t('noteBudget', langue);
  return '';
}

const LIBELLES_STATUT: Record<FamilleStatut, CleTexte> = {
  encours: 'stEnCours', recensement: 'stRecensement', attente: 'stEnAttente',
  suspendu: 'stSuspendu', pause: 'stPause', termine: 'stTermine',
};

/** Une opération de l'onglet Progression : nom (écrit par le moteur), compte, barre, note. */
function Operation({ langue, op }: { langue: Langue; op: LigneProgression }) {
  const famille = familleStatut(op.statut);
  const pct = op.base ? Math.min(100, Math.round((op.traites / op.base) * 100)) : null;
  const arret = famille === 'suspendu' || famille === 'pause' || famille === 'attente';
  const note = noteStatut(op, famille, langue);
  return (
    <div className={`operation ${famille}`}>
      <div className="op-entete">
        <span className="op-nom">{op.operation}</span>
        <span className={`pastille ${famille === 'termine' ? 'ok' : famille === 'suspendu' ? 'crit' : famille === 'encours' ? 'douce' : 'attn'}`}>
          {t(LIBELLES_STATUT[famille], langue)}
        </span>
        <span className="op-compte">
          {op.base !== null
            ? <><b>{op.traites.toLocaleString('fr-CA')}</b> / {op.base.toLocaleString('fr-CA')} {op.unite}{pct !== null && <> · <b>{pct} %</b></>}</>
            : <><b>{op.traites.toLocaleString('fr-CA')}</b> {op.unite}</>}
        </span>
      </div>
      {op.base !== null && !arret && (
        <div className={`op-barre ${pct === 100 ? 'pleine' : ''}`}><i style={{ width: `${pct}%` }} /></div>
      )}
      {op.base === null && famille === 'encours' && <div className="op-barre indeterminee"><i /></div>}
      {op.base === null && famille === 'recensement' && <div className="op-barre indeterminee"><i /></div>}
      {arret && <div className="op-barre rayee" />}
      {note && <p className="op-note">{note}</p>}
    </div>
  );
}

/**
 * Réglages (#22, choix Marc : UN réglage global) : fréquence des passages du moteur.
 * L'app écrit `Réglages!A2:B2` (contrat de position fixe) ; le moteur relit au tick suivant
 * et ré-installe son déclencheur (assurerIntervalleTick_). Whitelist 5/10/15/30 — les mêmes
 * valeurs que le moteur accepte (validerTickMinutes_), jamais de saisie libre.
 */
const TICKS_MINUTES = [5, 10, 15, 30];

function ReglagesSection({ langue, valeurInitiale }: { langue: Langue; valeurInitiale: string }) {
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
    <section className="carte">
      <h2>{t('reglages', langue)}</h2>
      <p className="statut-quota">{t('frequenceTick', langue)}</p>
      <div className="ligne-formulaire">
        <select value={tick} onChange={(e) => changer(e.target.value)} aria-label={t('frequenceTick', langue)}>
          {TICKS_MINUTES.map((m) => (
            <option key={m} value={String(m)}>{t('toutesLes', langue)} {m} min</option>
          ))}
        </select>
        {statut === 'ok' && <span className="ok">{t('reglageOk', langue)}</span>}
      </div>
      {statut && statut !== 'ok' && <p className="erreur">{statut}</p>}
      <p className="explication">{t('reglageNote', langue)}</p>
    </section>
  );
}
