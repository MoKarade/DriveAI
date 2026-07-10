/**
 * OperationsLive.tsx — suivi LIVE des opérations du moteur (C28-18) : un widget par opération,
 * alimenté par le poll dédié 15 s (useProgressionLive → onglet Progression, écrit à chaque tick).
 *  - campagne bornée (migration, re-analyse, rangement, tri à la demande) → barre déterminée X / Y ;
 *  - total inconnu (historique Gmail, intentions 30 j) → ruban ANIMÉ tant que ça travaille,
 *    piste RAYÉE statique quand c'est suspendu/en pause (jamais un ruban figé qui « a l'air planté ») ;
 *  - statut TOUJOURS en toutes lettres à côté de la pastille (jamais la couleur seule), avec une
 *    NOTE d'explication pour les états non triviaux (recensement, attente, suspension, pause) ;
 *  - heure de la dernière écriture moteur affichée en tête (colonne Horodaté).
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

/** Heure locale courte d'un horodatage de la Sheet ('' si illisible). */
function heureCourte(horodate: string, langue: Langue): string {
  const ts = Date.parse(horodate);
  if (Number.isNaN(ts)) return '';
  return new Date(ts).toLocaleTimeString(langue === 'fr' ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' });
}

export function OperationsLive({ langue }: { langue: Langue }) {
  const lignes = useProgressionLive();
  if (lignes.length === 0) return null;

  // Dernière écriture du moteur (les lignes actives partagent l'horodatage du tick).
  const maj = lignes.map((l) => heureCourte(l.horodate, langue)).filter(Boolean).sort().pop() ?? '';

  return (
    <section className="carte operations-live">
      <h2>
        {t('operationsLiveTitre', langue)}
        {maj && <span className="graphe-valeur">⟳ {t('opMaj', langue)} {maj}</span>}
      </h2>
      {lignes.map((l) => <Operation key={l.cle} l={l} langue={langue} />)}
    </section>
  );
}

/** Note d'explication d'un état non trivial — c'est elle qui répond au « pourquoi ça ne bouge pas ». */
function noteStatut(l: LigneProgression, famille: FamilleStatut): CleTexte | null {
  if (famille === 'recensement') return 'noteRecensement';
  if (famille === 'attente') return 'noteAttente';
  if (famille === 'pause') return 'noteBudget';
  if (famille === 'suspendu') return l.statut.includes('quota') ? 'noteQuota' : 'notePanneApi';
  return null;
}

function Operation({ l, langue }: { l: LigneProgression; langue: Langue }) {
  const famille = familleStatut(l.statut);
  const libelle = LIBELLES[l.cle] ? t(LIBELLES[l.cle], langue) : l.operation;
  const unite = UNITES[l.unite] ? t(UNITES[l.unite], langue) : l.unite;
  const fini = famille === 'termine';
  // Plafond 99 % tant que la vraie fin n'est pas signée (leçon barre de masse) : une base
  // RE-BASÉE (recensement partiel rattrapé par le réel) donnerait sinon un 100 % « en cours ».
  const pct = l.base && l.base > 0
    ? Math.min(fini ? 100 : 99, Math.round((l.traites / l.base) * 100)) : null;
  const note = noteStatut(l, famille);
  // « 0 documents » pendant un recensement ou une attente n'informe pas : la note suffit.
  const compteUtile = !(l.traites === 0 && (famille === 'recensement' || famille === 'attente'));

  return (
    <div className={`operation ${famille}`}>
      <div className="op-entete">
        <span className="op-nom" title={l.operation}>{libelle}</span>
        <span className={`pastille ${PASTILLES[famille]}`}>
          {famille === 'suspendu' || famille === 'pause' ? l.statut : t(STATUTS[famille], langue)}
        </span>
        {compteUtile && (
          <span className="op-compte">
            {l.traites.toLocaleString('fr-CA')}
            {l.base !== null && <> / {l.base.toLocaleString('fr-CA')}</>}
            {' '}{unite}
            {pct !== null && !fini && <b> · {pct} %</b>}
          </span>
        )}
      </div>
      {fini ? (
        <div className="op-barre pleine" role="img" aria-label={t('stTermine', langue)}><i style={{ width: '100%' }} /></div>
      ) : famille === 'attente' ? (
        <div className="op-barre" aria-hidden="true" /> /* rien n'a commencé : piste vide */
      ) : l.base !== null ? (
        <div className="op-barre" role="img" aria-label={`${pct ?? 0} %`}>
          <i style={{ width: `${pct ?? 0}%` }} />
        </div>
      ) : famille === 'suspendu' || famille === 'pause' ? (
        <div className="op-barre rayee" aria-hidden="true" /> /* à l'arrêt : rayures statiques, jamais un ruban figé */
      ) : (
        <div className="op-barre indeterminee" aria-hidden="true"><i /></div> /* ça travaille, total inconnu */
      )}
      {note && <p className="op-note">{t(note, langue)}</p>}
    </div>
  );
}
