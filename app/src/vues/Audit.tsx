/**
 * Audit.tsx — C49-3, la PORTE de l'ADR-0061 : Marc juge ce que l'extraction a lu.
 *
 * ⚠️ L'écran existe parce que la porte ne peut PAS s'automatiser. Un pré-juge par un second
 * modèle a été proposé et écarté (décision de Marc, 17/09) : il partagerait l'OCR du premier,
 * donc il verrait les erreurs de raisonnement et jamais celles de LECTURE — les seules qui
 * comptent vraiment sur `01` et `04`. Ce que l'app automatise, c'est le GESTE, pas le jugement.
 *
 * ⚠️ UNE CARTE À LA FOIS, et c'est un choix de forme, pas d'esthétique : cent lignes de tableau
 * sur un téléphone se survolent, et un audit survolé rend un chiffre faux avec l'apparence d'une
 * mesure. Une carte pleine largeur, trois cibles larges, et le document à un doigt.
 *
 * ⚠️ L'app n'exécute RIEN du moteur (ADR-0007) : elle écrit une cellule de la Sheet, comme la
 * Réorg écrit ses statuts. Le compte, lui, est refait ICI à chaque écriture — relire la Sheet
 * après chaque clic coûterait un aller-retour par carte pour un chiffre qu'on connaît déjà.
 */

import { useEffect, useState } from 'react';
import { lirePlage, ecrireCellule, viderCachePlages } from '../google';
import {
  LigneAudit, Verdict, VERDICTS,
  lireLignesAudit, compterAudit, prochaineAJuger, celluleVerdict,
  champsAMontrer, domaineMasqueAudit,
} from '../audit';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Langue, t, CleTexte } from '../i18n';

const ONGLET = 'AuditPieces';

/** Le libellé d'un champ extrait, en langue de Marc. */
const LIBELLE_CHAMP: Record<string, CleTexte> = {
  type: 'auditChampType', emetteur: 'auditChampEmetteur', dateDoc: 'auditChampDate',
  titulaire: 'auditChampTitulaire', champs: 'auditChampChamps',
};

const LIBELLE_VERDICT: Record<Verdict, CleTexte> = {
  juste: 'auditJuste', partiel: 'auditPartiel', faux: 'auditFaux',
};

export function Audit({ langue, onFermer }: { langue: Langue; onFermer: () => void }) {
  const [lignes, setLignes] = useState<LigneAudit[] | null>(null);
  const [position, setPosition] = useState(0);
  const [erreur, setErreur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let vivant = true;
    viderCachePlages(ONGLET); // l'onglet bouge à chaque tick du moteur : jamais servir du cache ici
    lirePlage(ONGLET, 'A2:M')
      .then((v) => { if (!vivant) return; const ls = lireLignesAudit(v); setLignes(ls); setPosition(Math.max(0, prochaineAJuger(ls, 0))); })
      .catch((e) => { if (vivant) { setErreur(String(e)); setLignes([]); } });
    return () => { vivant = false; };
  }, []);

  if (erreur && !lignes?.length) {
    return <section className="vue-active"><BoutonRetour langue={langue} onFermer={onFermer} />
      <BanniereErreur langue={langue} erreur={erreur} /></section>;
  }
  if (lignes === null) return <section className="vue-active"><IndicateurChargement langue={langue} /></section>;

  const compte = compterAudit(lignes);
  const courante = lignes[position];
  const index = prochaineAJuger(lignes, position);

  /**
   * Écrit le verdict dans la Sheet, puis avance. L'état local est mis à jour AVANT l'attente
   * réseau : sur un téléphone, un bouton qui ne répond pas pendant 400 ms se fait cliquer deux
   * fois. En cas d'échec, on RESTAURE la ligne et on le dit — un verdict perdu en silence
   * fausserait le compte final, qui est justement ce que la porte mesure.
   */
  async function juger(l: LigneAudit, verdict: Verdict) {
    if (enCours) return;
    setEnCours(true);
    setErreur('');
    const avant = l.verdict;
    setLignes((ls) => (ls ?? []).map((x) => (x.ligneSheet === l.ligneSheet ? { ...x, verdict } : x)));
    try {
      await ecrireCellule(ONGLET, celluleVerdict(l.ligneSheet), verdict);
      setPosition((p) => p + 1);
    } catch (e) {
      setLignes((ls) => (ls ?? []).map((x) => (x.ligneSheet === l.ligneSheet ? { ...x, verdict: avant } : x)));
      setErreur(String(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section className="vue-active audit">
      <BoutonRetour langue={langue} onFermer={onFermer} />
      <h2>{t('auditTitre', langue)}</h2>
      <p className="audit-intro">{t('auditIntro', langue)}</p>

      <div className="audit-compte">
        <div className="audit-barre"><i style={{ width: `${compte.extraits ? Math.round(((compte.extraits - compte.aJuger) / compte.extraits) * 100) : 0}%` }} /></div>
        <p className="audit-chiffres">
          <b>{compte.aJuger}</b> {t('auditRestants', langue)}
          {compte.tauxJuste !== null && <> · <b>{compte.tauxJuste} %</b> {t('auditTaux', langue)}</>}
          {compte.aFaire > 0 && <> · {t('auditEnCours', langue)} <b>{compte.aFaire}</b></>}
          {compte.sansTexte > 0 && <> · {compte.sansTexte} {t('auditSansTexte', langue)}</>}
          {compte.echecs > 0 && <> · {compte.echecs} {t('auditEchecs', langue)}</>}
        </p>
      </div>

      <BanniereErreur langue={langue} erreur={erreur} />

      {index === -1 || !courante ? (
        <p className="audit-fini">{compte.total === 0 ? t('auditRien', langue) : t('auditTermine', langue)}</p>
      ) : (
        <CarteDocument
          langue={langue}
          ligne={lignes[index]!}
          enCours={enCours}
          onVerdict={(v) => juger(lignes[index]!, v)}
          onPasser={() => setPosition(index + 1)}
        />
      )}
    </section>
  );
}

function BoutonRetour({ langue, onFermer }: { langue: Langue; onFermer: () => void }) {
  return <button className="discret audit-retour" onClick={onFermer}>← {t('auditFerme', langue)}</button>;
}

function CarteDocument({ langue, ligne, enCours, onVerdict, onPasser }: {
  langue: Langue;
  ligne: LigneAudit;
  enCours: boolean;
  onVerdict: (v: Verdict) => void;
  onPasser: () => void;
}) {
  const masque = domaineMasqueAudit(ligne.domaine);
  return (
    <article className="audit-carte">
      <p className="audit-domaine">{ligne.domaine}</p>
      <h3 className="audit-fichier">{ligne.fichier}</h3>
      {ligne.lien && (
        <a className="audit-lien" href={ligne.lien} target="_blank" rel="noreferrer noopener">
          {t('auditOuvrirDoc', langue)} ↗
        </a>
      )}

      <dl className="audit-champs">
        {champsAMontrer(ligne).map(({ cle, valeur }) => (
          <div key={cle}>
            <dt>{LIBELLE_CHAMP[cle] ? t(LIBELLE_CHAMP[cle]!, langue) : cle}</dt>
            <dd>{valeur}</dd>
          </div>
        ))}
      </dl>

      {/* ⚠️ Dire la limite là où elle s'applique : sur 01 et 04, un numéro bien formé mais FAUX
          passe l'audit. C'est l'arbitrage de Marc du 17/09, et le taire rendrait le score
          meilleur qu'il n'est exactement là où l'erreur coûte le plus cher. */}
      {masque && <p className="audit-note-masque">{t('auditMasque', langue)}</p>}

      <div className="audit-verdicts">
        {VERDICTS.map((v) => (
          <button key={v} className={`audit-verdict ${v}`} disabled={enCours} onClick={() => onVerdict(v)}>
            {t(LIBELLE_VERDICT[v], langue)}
          </button>
        ))}
      </div>
      <button className="discret audit-passer" disabled={enCours} onClick={onPasser}>
        {t('auditPasser', langue)}
      </button>
    </article>
  );
}
