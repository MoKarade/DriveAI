/**
 * OperationsLive.tsx — suivi LIVE des opérations du moteur (C28-18) : un widget par opération,
 * alimenté par le poll dédié 15 s (useProgressionLive → onglet Progression, écrit à chaque tick).
 *  - campagne bornée (migration, re-analyse, rangement, tri à la demande) → barre déterminée X / Y ;
 *  - total inconnu (historique Gmail, intentions 30 j) → barre indéterminée + compteur seul ;
 *  - statut TOUJOURS en toutes lettres à côté de la pastille (jamais la couleur seule) :
 *    suspendu (rouge) / en pause (ambre) / en cours (vert) / en attente / terminé (discret).
 * Panneau INVISIBLE quand le moteur n'a rien à montrer (aucune ligne).
 */

import { useProgressionLive } from '../etatGlobal';
import { LigneProgression, familleStatut, FamilleStatut } from '../etat';
import { CleTexte, Langue, t } from '../i18n';

/** Libellés i18n par clé d'opération (repli : le libellé FR écrit par le moteur). */
const LIBELLES: Record<string, CleTexte> = {
  'tri-demande': 'opTriDemande',
  'intentions-demande': 'opIntentionsDemande',
  migration: 'opMigration',
  reanalyse: 'opReanalyse',
  'histo-gmail': 'opHistoGmail',
  rangement: 'opRangement',
};

const STATUTS: Record<FamilleStatut, CleTexte> = {
  encours: 'stEnCours',
  recensement: 'stRecensement',
  attente: 'stEnAttente',
  suspendu: 'stSuspendu',
  pause: 'stPause',
  termine: 'stTermine',
};

const PASTILLES: Record<FamilleStatut, string> = {
  encours: 'ok',
  recensement: 'ok',
  attente: 'douce',
  suspendu: 'crit',
  pause: 'attn',
  termine: 'douce',
};

const UNITES: Record<string, CleTexte> = {
  documents: 'uniteDocuments',
  fils: 'uniteFils',
  fichiers: 'uniteFichiers',
};

export function OperationsLive({ langue }: { langue: Langue }) {
  const lignes = useProgressionLive();
  if (lignes.length === 0) return null;

  return (
    <section className="carte operations-live">
      <h2>
        {t('operationsLiveTitre', langue)}
        <span className="graphe-valeur">{t('operationsLiveNote', langue)}</span>
      </h2>
      {lignes.map((l) => <Operation key={l.cle} l={l} langue={langue} />)}
    </section>
  );
}

function Operation({ l, langue }: { l: LigneProgression; langue: Langue }) {
  const famille = familleStatut(l.statut);
  const libelle = LIBELLES[l.cle] ? t(LIBELLES[l.cle], langue) : l.operation;
  const unite = UNITES[l.unite] ? t(UNITES[l.unite], langue) : l.unite;
  const fini = famille === 'termine';
  const pct = l.base && l.base > 0 ? Math.min(100, Math.round((l.traites / l.base) * 100)) : null;

  return (
    <div className={`operation ${famille}`}>
      <div className="op-entete">
        <span className="op-nom">{libelle}</span>
        <span className={`pastille ${PASTILLES[famille]}`}>
          {famille === 'suspendu' || famille === 'pause' ? l.statut : t(STATUTS[famille], langue)}
        </span>
        <span className="op-compte">
          {l.traites.toLocaleString('fr-CA')}
          {l.base !== null && <> / {l.base.toLocaleString('fr-CA')}</>}
          {' '}{unite}
          {pct !== null && !fini && <b> · {pct} %</b>}
        </span>
      </div>
      {fini ? (
        <div className="op-barre pleine" role="img" aria-label={t('stTermine', langue)}><i style={{ width: '100%' }} /></div>
      ) : famille === 'attente' ? (
        <div className="op-barre" aria-hidden="true" /> /* rien n'a commencé : piste vide, pas de ruban trompeur */
      ) : l.base !== null ? (
        <div className="op-barre" role="img" aria-label={`${pct ?? 0} %`}>
          <i style={{ width: `${pct ?? 0}%` }} />
        </div>
      ) : (
        <div className={`op-barre indeterminee ${famille !== 'encours' ? 'figee' : ''}`} aria-hidden="true"><i /></div>
      )}
    </div>
  );
}
