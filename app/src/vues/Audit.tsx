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
  LigneAudit, Verdict, VERDICTS, PLAGE_AUDIT,
  lireLignesAudit, compterAudit, prochaineAJuger, celluleVerdict,
  champsAMontrer, domaineMasqueAudit,
  CHAMPS_JUGEABLES, celluleChampsFaux, ecrireChampsFaux, compterChampsFaux,
} from '../audit';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Langue, t, CleTexte } from '../i18n';

const ONGLET = 'AuditPieces';

/** Le libellé d'un champ extrait, en langue de Marc. */
const LIBELLE_CHAMP: Record<string, CleTexte> = {
  type: 'auditChampType', emetteur: 'auditChampEmetteur', dateDoc: 'auditChampDate',
  titulaire: 'auditChampTitulaire', champs: 'auditChampChamps',
};

/**
 * Le libellé d'un champ JUGEABLE. Distinct de `LIBELLE_CHAMP` ci-dessus, qui nomme ce que la
 * carte AFFICHE : ici on nomme ce que Marc peut déclarer faux, et les deux listes ne se
 * recouvrent pas (« champs lus » se juge en quatre cases, une par sorte).
 */
const LIBELLE_JUGEABLE: Record<string, CleTexte> = {
  type: 'auditChampType', emetteur: 'auditChampEmetteur', date: 'auditChampDate',
  titulaire: 'auditChampTitulaire', montants: 'auditChampMontants', numeros: 'auditChampNumeros',
  personnes: 'auditChampPersonnes', lieux: 'auditChampLieux', resume: 'auditChampResume',
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
    lirePlage(ONGLET, PLAGE_AUDIT)
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
  const champsFaux = compterChampsFaux(lignes);
  const courante = lignes[position];
  const index = prochaineAJuger(lignes, position);

  /**
   * Écrit le verdict dans la Sheet, puis avance. L'état local est mis à jour AVANT l'attente
   * réseau : sur un téléphone, un bouton qui ne répond pas pendant 400 ms se fait cliquer deux
   * fois. En cas d'échec, on RESTAURE la ligne et on le dit — un verdict perdu en silence
   * fausserait le compte final, qui est justement ce que la porte mesure.
   */
  async function juger(l: LigneAudit, verdict: Verdict, champsFaux: string[] = []) {
    if (enCours) return;
    setEnCours(true);
    setErreur('');
    const avant = l.verdict;
    const avantFaux = l.champsFaux;
    const faux = ecrireChampsFaux(champsFaux);
    setLignes((ls) => (ls ?? []).map((x) => (
      x.ligneSheet === l.ligneSheet ? { ...x, verdict, champsFaux: faux } : x)));
    try {
      // ⚠️ LE DÉTAIL D'ABORD, LE VERDICT ENSUITE. C'est le verdict qui fait avancer le compteur
      // de la porte : si la seconde écriture échoue, il reste un détail sans verdict (la ligne
      // se re-présente, rien n'est perdu) plutôt qu'un verdict sans détail, qui compterait dans
      // le taux en ayant perdu ce qui l'explique. Même règle que l'Index du moteur : l'écriture
      // « c'est fini » se pose en DERNIER.
      if (faux || avantFaux) await ecrireCellule(ONGLET, celluleChampsFaux(l.ligneSheet), faux);
      await ecrireCellule(ONGLET, celluleVerdict(l.ligneSheet), verdict);
      setPosition((p) => p + 1);
    } catch (e) {
      setLignes((ls) => (ls ?? []).map((x) => (
        x.ligneSheet === l.ligneSheet ? { ...x, verdict: avant, champsFaux: avantFaux } : x)));
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

      {/* ⚠️ Le tableau qui justifie tout le lot : « 12 à moitié » n'oriente aucun correctif,
          « titulaire 8 · numéros 1 » en oriente un — et dit surtout si les erreurs touchent ce
          qui est sensible ou seulement des libellés. */}
      {champsFaux.length > 0 && (
        <p className="audit-faux-recap">
          {t('auditFauxRecap', langue)}{' '}
          {champsFaux.map(({ cle, n }) => (
            <span key={cle}>{LIBELLE_JUGEABLE[cle] ? t(LIBELLE_JUGEABLE[cle]!, langue) : cle} <b>{n}</b></span>
          ))}
        </p>
      )}

      <BanniereErreur langue={langue} erreur={erreur} />

      {index === -1 || !courante ? (
        <p className="audit-fini">{compte.total === 0 ? t('auditRien', langue) : t('auditTermine', langue)}</p>
      ) : (
        <CarteDocument
          langue={langue}
          ligne={lignes[index]!}
          enCours={enCours}
          onVerdict={(v, faux) => juger(lignes[index]!, v, faux)}
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
  onVerdict: (v: Verdict, champsFaux: string[]) => void;
  onPasser: () => void;
}) {
  const masque = domaineMasqueAudit(ligne.domaine);
  /**
   * Les cases ne s'ouvrent que sur « à moitié ». « Juste » et « faux » n'ont rien à préciser :
   * l'un ne se trompe nulle part, l'autre se trompe partout — demander quoi serait une question
   * dont la réponse est déjà écrite, et trois clics de plus sur chaque carte.
   *
   * ⚠️ L'état se remet à zéro quand la carte CHANGE (`ligne.ligneSheet` en clé de l'effet) :
   * sans ça, les cases cochées sur un document suivraient jusqu'au suivant et Marc enregistrerait
   * un détail qui parle du papier d'avant.
   */
  const [ouvert, setOuvert] = useState(false);
  const [coches, setCoches] = useState<string[]>([]);
  useEffect(() => { setOuvert(false); setCoches([]); }, [ligne.ligneSheet]);

  function basculer(cle: string) {
    setCoches((cs) => (cs.includes(cle) ? cs.filter((c) => c !== cle) : [...cs, cle]));
  }
  return (
    <article className="audit-carte">
      <p className="audit-domaine">{ligne.domaine}</p>
      <h3 className="audit-fichier">{ligne.fichier}</h3>
      {ligne.lien && (
        <a className="audit-lien" href={ligne.lien} target="_blank" rel="noreferrer noopener">
          {t('auditOuvrirDoc', langue)} ↗
        </a>
      )}

      {/* ⚠️ LE RÉSUMÉ D'ABORD, et ce n'est pas un choix de mise en page. Les champs disent ce
          que le modèle a TIRÉ du papier ; le résumé dit s'il l'a COMPRIS — on peut extraire
          « facture / Hydro / 2026-07-01 » d'un document lu de travers. Demande de Marc au
          premier usage : « je jugerai mieux une analyse de IA avec des vraies infos ». */}
      {ligne.resume && <p className="audit-resume">{ligne.resume}</p>}

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

      {ouvert ? (
        <div className="audit-quoi">
          <p className="audit-quoi-titre">{t('auditQuoiFaux', langue)}</p>
          <p className="audit-quoi-aide">{t('auditQuoiFauxAide', langue)}</p>
          <div className="audit-cases">
            {CHAMPS_JUGEABLES.map((cle) => (
              <label key={cle} className={`audit-case${coches.includes(cle) ? ' cochee' : ''}`}>
                <input
                  type="checkbox"
                  checked={coches.includes(cle)}
                  disabled={enCours}
                  onChange={() => basculer(cle)}
                />
                {LIBELLE_JUGEABLE[cle] ? t(LIBELLE_JUGEABLE[cle]!, langue) : cle}
              </label>
            ))}
          </div>
          <div className="audit-verdicts">
            {/* ⚠️ Enregistrer reste possible SANS aucune case : « à moitié, je ne sais pas dire
                lequel » est une réponse honnête, et forcer une case ferait cocher n'importe quoi
                pour passer à la suite — le tableau des champs faux en sortirait faussé. */}
            <button className="audit-verdict partiel" disabled={enCours} onClick={() => onVerdict('partiel', coches)}>
              {t('auditConfirmer', langue)}
            </button>
            <button className="discret" disabled={enCours} onClick={() => { setOuvert(false); setCoches([]); }}>
              {t('auditAnnuler', langue)}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="audit-verdicts">
            {VERDICTS.map((v) => (
              <button
                key={v}
                className={`audit-verdict ${v}`}
                disabled={enCours}
                onClick={() => (v === 'partiel' ? setOuvert(true) : onVerdict(v, []))}
              >
                {t(LIBELLE_VERDICT[v], langue)}
              </button>
            ))}
          </div>
          <button className="discret audit-passer" disabled={enCours} onClick={onPasser}>
            {t('auditPasser', langue)}
          </button>
        </>
      )}
    </article>
  );
}
