/**
 * AujourdHui.tsx — accueil v4 « cockpit central » (C28-17, ADR-0019) : 90 % des usages en un
 * écran, structuré en 3 zones horizontales :
 *  1. ACTIONS rapides (PanneauActions partagé : vérifier / trier / analyser / ciblée) ;
 *  2. ATTENTION (hiérarchie visuelle forte) : ce qui demande l'action de MARC — mails suspects,
 *     documents « à vérifier » (fail-safe ADR-0016), entités à valider. Vide ⇒ « Tout est à
 *     jour ✅ » ;
 *  3. ACTIVITÉ (discrète) : tuiles, graphe 30 j, derniers tris/classements — la preuve que ça
 *     tourne, en retrait visuel derrière la zone 2.
 * Lecture seule (Santé + Index + Entités) ; les liens internes naviguent via onAller (App.tsx).
 */

import { useState } from 'react';
import type { Section } from '../App';
import { useEtatGlobal } from '../etatGlobal';
import { IndicateurChargement } from '../composants/UI';
import { PanneauActions } from '../composants/PanneauActions';
import { ListeSuspects, useSuspectsVisibles } from '../composants/Suspects';
import {
  LigneIndex,
  Sante,
  interpreterSante,
  interpreterEntites,
  entitesEnAttente,
  activiteParJour,
  lignesTri,
  lignesSuspects,
  lignesAVerifier,
  statsTri,
  traitesLeJour,
  coutDepuisSante,
  dernierPassageDepuisSante,
  lienGmailPourLigne,
  lienDrivePourLigne,
} from '../etat';
import { formaterDateCourte } from '../explorateur';
import { Langue, t } from '../i18n';

const BUDGET_LLM = 10; // cible < 10 $/mois (CLAUDE.md §2)
const TRI_RECENTS = 6;
const CLASSEMENTS_RECENTS = 6;
const SUSPECTS_MAX = 5;
const A_VERIFIER_MAX = 5;
const ENTITES_MAX = 5;

export function AujourdHui({ langue, onAller }: { langue: Langue; onAller: (s: Section) => void }) {
  // Données PARTAGÉES (P1/C28-02) : chargées/rafraîchies par le fournisseur global — plus de
  // lirePlage local, plus de photo figée au montage. L'Index arrive déjà en ÉTAT COURANT.
  const { donnees } = useEtatGlobal();
  const [survol, setSurvol] = useState<{ jour: string; n: number } | null>(null);
  // C28-24 : les suspects passent par le store des masqués — le compte de la tuile et de la
  // zone Attention tombe À L'INSTANT du clic « pas suspect » (hook AVANT le retour anticipé).
  const suspects = useSuspectsVisibles(donnees ? lignesSuspects(donnees.index) : []);

  if (!donnees) return <IndicateurChargement langue={langue} />;
  const sante: Sante = interpreterSante(donnees.santeBrut);
  const index: LigneIndex[] = donnees.index;
  const locale = langue === 'fr' ? 'fr-CA' : 'en-CA';

  const maintenant = new Date();
  // Documents seuls (les lignes mail — intention/tache/event/important/tri — ont leurs sections).
  const docs = index.filter((l) => !/^(intention|tache|event|important|tri(-abandon)?)\|/.test(l.cle));
  const classes = docs.filter((l) => l.statut === 'classé');
  const aujourdhui = traitesLeJour(docs, maintenant);
  const cout = coutDepuisSante(sante.lignes);
  const passage = dernierPassageDepuisSante(sante.lignes);
  const tri7j = statsTri(index, 7, maintenant);
  const aVerifier = lignesAVerifier(docs);
  const entites = entitesEnAttente(interpreterEntites(donnees.entitesBrut).lignes);
  const tris = lignesTri(index).slice(0, TRI_RECENTS);
  const classements = classes.slice(-CLASSEMENTS_RECENTS).reverse();
  const activite = activiteParJour(docs, 30, maintenant);
  const maxJour = Math.max(1, ...activite.map((a) => a.n));

  const rienARegler = suspects.length === 0 && aVerifier.length === 0 && entites.length === 0;

  return (
    <div className="accueil">
      {/* ---------- Zone 1 : actions rapides ---------- */}
      <PanneauActions langue={langue} />

      {/* ---------- Zone 2 : ce qui demande l'action de Marc ---------- */}
      <section className={`carte zone-attention ${rienARegler ? 'calme' : ''}`}>
        <h2>{t('zoneAttention', langue)}</h2>

        {rienARegler && <p className="tout-a-jour">✅ {t('toutEstAJour', langue)}</p>}

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
            <button className="discret pied" onClick={() => onAller('apprentissage')}>
              {t('reclasserTitre', langue)} →
            </button>
          </div>
        )}

        {entites.length > 0 && (
          <div className="attention-bloc">
            <h3>{t('entitesAValider', langue)} ({entites.length})</h3>
            {entites.slice(0, ENTITES_MAX).map((e) => (
              <div key={e.ligneSheet} className="ligne-attention">
                <b>{e.entite}</b>
                <span className="variante">{e.domaine}</span>
                <span className="date">{e.vuNFois}×</span>
              </div>
            ))}
            <button className="discret pied" onClick={() => onAller('apprentissage')}>
              {t('allerValider', langue)} →
            </button>
          </div>
        )}
      </section>

      {/* (C28-24 : OperationsLive vit désormais DANS PanneauActions — progression sur place.) */}

      {/* ---------- Zone 3 : activité (discrète) ---------- */}
      <div className="colonnes zone-activite">
        {passage && (
          <p className="statut-moteur large">
            <span className="point-ok" aria-hidden="true" /> {t('dernierPassage', langue)} {passage}
          </p>
        )}

        <div className="tuiles large">
          <div className="tuile">
            <div className="v">{classes.length.toLocaleString('fr-CA')}</div>
            <div className="l">{t('docsClasses', langue)}</div>
            {aujourdhui > 0 && <div className="d ok">+{aujourdhui} {t('aujourdhuiCourt', langue)}</div>}
          </div>
          <div className="tuile">
            <div className="v">
              {cout ? cout.dollars.toFixed(2) : '—'} <small>$ / {BUDGET_LLM}</small>
            </div>
            <div className="l">{t('coutLlm', langue)}</div>
            {cout && (
              <div className="jauge" role="img" aria-label={`${cout.dollars.toFixed(2)} $ / ${BUDGET_LLM} $`}>
                <i style={{ width: `${Math.min(100, (cout.dollars / BUDGET_LLM) * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="tuile">
            <div className="v">{tri7j.tries}</div>
            <div className="l">{t('filsTries7j', langue)}</div>
            {tri7j.aVerifier > 0 && <div className="d">{tri7j.aVerifier} {t('dontAVerifier', langue)}</div>}
          </div>
          <div className="tuile">
            <div className={`v ${suspects.length ? 'erreur' : ''}`}>{suspects.length}</div>
            <div className="l">{t('suspectsEnBoite', langue)}</div>
          </div>
        </div>

        <section className="carte large">
          <h2>
            {t('activite30j', langue)}
            <span className="graphe-valeur">{survol ? `${survol.jour} — ${survol.n} ${t('docsCourt', langue)}` : ''}</span>
          </h2>
          <div className="barres" role="img" aria-label={t('activite30j', langue)} onPointerLeave={() => setSurvol(null)}>
            {activite.map((a) => (
              <div
                key={a.jour}
                className={`barre ${survol?.jour === a.jour ? 'survol' : ''}`}
                style={{ height: `${Math.round((a.n / maxJour) * 100)}%` }}
                onPointerEnter={() => setSurvol(a)}
                onPointerDown={() => setSurvol(a)}
              />
            ))}
          </div>
        </section>

        <section className="carte">
          <h2>{t('filsTriesTitre', langue)}</h2>
          {tris.length === 0 && <p className="explication">{t('aucunTri', langue)}</p>}
          <table>
            <tbody>
              {tris.map((l) => (
                <tr key={l.cle} className="ligne-clic" title={t('ouvrirMail', langue)}>
                  <td>
                    <a href={lienGmailPourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                      {l.fichier || '(sans sujet)'}
                    </a>
                  </td>
                  <td className="nombre">
                    <span className={`pastille ${l.statut === 'suspect' ? 'crit' : l.statut === 'tri-a-verifier' ? 'douce' : 'ok'}`}>
                      {l.statut === 'trié' ? t('trie', langue) : l.statut === 'tri-a-verifier' ? t('aVerifier', langue) : '⚠'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="carte">
          <h2>{t('derniersClassements', langue)}</h2>
          <table>
            <tbody>
              {classements.map((l) => (
                <tr key={l.cle} className="ligne-clic" title="Drive">
                  <td>
                    <a href={lienDrivePourLigne(l)} target="_blank" rel="noreferrer" className="lien-ligne">
                      {l.fichier}
                    </a>
                    <div className="variante">{l.domaine}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
