/**
 * Quotas.tsx — vue « Coûts & quotas » (C28-24, demande Marc : « j'ai trop souvent plus de quota
 * gmail […] je veux voir un indicateur de où j'en suis du quota, du prix »). Lecture SEULE de
 * l'onglet Sheet `Télémétrie` écrit par le moteur à chaque tick (majTelemetrie_, Journal.gs) :
 *  1. QUOTA GMAIL : état (actif/suspendu + heure de reprise) et les 3 jauges quotidiennes des
 *     scans plafonnés (tri à la demande 500/j, balayage cyclique 150/j, campagne historique
 *     150/j). Note HONNÊTE : le quota Gmail d'Apps Script est FIXE — payer plus ne l'augmente pas.
 *  2. COÛT LLM : dollars du mois vs frein campagnes, nombre d'appels, rappel de la cible §2.6.
 */

import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement } from '../composants/UI';
import { interpreterTelemetrie, JaugeJour } from '../etat';
import { CleTexte, Langue, t } from '../i18n';

const BUDGET_CROISIERE = 10; // cible < 10 $/mois en croisière (CLAUDE.md §2.6)

export function Quotas({ langue }: { langue: Langue }) {
  const { donnees } = useEtatGlobal();
  if (!donnees) return <IndicateurChargement langue={langue} />;
  const tele = interpreterTelemetrie(donnees.telemetrieBrut);

  if (!tele.presente) {
    return (
      <div className="colonnes">
        <section className="carte large">
          <h2>{t('quotas', langue)}</h2>
          <p className="explication">{t('telemetrieVide', langue)}</p>
        </section>
      </div>
    );
  }

  const jauges: Array<{ cle: CleTexte; j: JaugeJour }> = [
    { cle: 'jaugeTriDemande', j: tele.demandeJour },
    { cle: 'jaugeCyclique', j: tele.cycliqueJour },
    { cle: 'jaugeHisto', j: tele.histoJour },
  ];

  const pctCout = tele.coutDollars !== null && tele.freinDollars
    ? Math.min(100, (tele.coutDollars / tele.freinDollars) * 100) : null;

  return (
    <div className="colonnes">
      <section className="carte large">
        <h2>
          {t('quotaGmailTitre', langue)}
          <span className={`pastille ${tele.quotaSuspendu ? 'crit' : 'ok'}`} style={{ marginLeft: '0.6rem' }}>
            {tele.quotaSuspendu ? t('quotaEtatSuspendu', langue) : t('quotaEtatActif', langue)}
          </span>
        </h2>
        {tele.quotaSuspendu && tele.quotaDetail && <p className="erreur">{tele.quotaDetail}</p>}

        {jauges.map(({ cle, j }) => (
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

      <section className="carte large">
        <h2>{t('coutLlmTitre', langue)}</h2>
        <div className="tuiles">
          <div className="tuile">
            <div className="v">{tele.coutDollars !== null ? tele.coutDollars.toFixed(2) : '—'} <small>$</small></div>
            <div className="l">{t('coutCeMois', langue)}</div>
            {pctCout !== null && (
              <div className="jauge" role="img" aria-label={`${tele.coutDollars?.toFixed(2)} $ / ${tele.freinDollars} $`}>
                <i style={{ width: `${pctCout}%` }} />
              </div>
            )}
            {tele.freinDollars !== null && (
              <div className="d">{t('freinCampagnes', langue)} : {tele.freinDollars} $</div>
            )}
          </div>
          <div className="tuile">
            <div className="v">{tele.appelsMois !== null ? tele.appelsMois.toLocaleString('fr-CA') : '—'}</div>
            <div className="l">{t('appelsCeMois', langue)}</div>
          </div>
          <div className="tuile">
            <div className="v">{BUDGET_CROISIERE} <small>$</small></div>
            <div className="l">{t('cibleCroisiere', langue)}</div>
          </div>
        </div>
        <p className="explication">{t('coutLlmNote', langue)}</p>
      </section>
    </div>
  );
}
