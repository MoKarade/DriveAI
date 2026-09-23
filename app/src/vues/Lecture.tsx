/**
 * Lecture.tsx — L'AVANCEMENT, de bout en bout : du Drive jusqu'à la mémoire.
 *
 * ⚠️ POURQUOI CET ÉCRAN A ÉTÉ REFAIT UNE TROISIÈME FOIS, le 23/09/2026. Marc :
 * « manque trop d'info sur cette page, qui marchent pas. manque aussi des graphs clairs, des
 * infos sur la vitesse, sur ce qu'il reste, sur ce qui est validé SÉPARÉMENT par driveai et
 * memory ai — je comprends pas la page ». Puis, en texte libre, la phrase qui a tout
 * cadré : « lu vs importé vs traité, faits vs papiers ».
 *
 * Ce n'était pas une demande d'affichage. Quatre défauts mesurés derrière :
 *
 *   1. `fileLecture` n'avait JAMAIS rien lu. Né en C49-14 avec la ligne qu'il parse, il
 *      attendait l'encodage `04:0/48` quand le moteur écrit la phrase `04 ✅ (48)`. Chaque
 *      moitié était testée chez elle, le chaînon chez personne — et le même état produisait
 *      « pas encore publiée » en haut et « publiée mais illisible » en bas.
 *   2. « il reste environ 0 jours » : vrai de la TRANCHE (0 restants), lu comme une
 *      affirmation sur tout le Drive, où il reste plus de trois mille papiers.
 *   3. « 97 % · 31 + 15071 » : un pourcentage juste sur une population que rien ne nommait,
 *      et deux nombres collés à deux libellés séparés par un point médian.
 *   4. DEUX ventilations du même travail (324/21 à l'écran, 306/38 dans la phrase du moteur),
 *      et rien ne disait laquelle croire.
 *
 * ⚠️ L'ORDRE DES SECTIONS EST L'ORDRE DES QUESTIONS.
 *   0. ce qui EMPÊCHE, s'il y a lieu — sinon tout le reste se lit comme une panne ;
 *   1. l'ENTONNOIR : où passent les documents, et où ils se perdent, source par source ;
 *   2. la Mémoire, nommée à part — c'est la demande « séparément » ;
 *   3. la tranche en cours, par dossier ;
 *   4. les graphes : ce qui reste dans le temps, la vitesse, ce qu'on tire des papiers ;
 *   5. le détail (replié) : en cours, manques, derniers lus.
 *
 * ⚠️ CET ÉCRAN NE CALCULE RIEN. Tout vient de fonctions PURES d'`etat.ts`, testées par
 * mutation. Une seconde arithmétique dans le JSX serait « une règle et demie ».
 */

import { useEffect, useState } from 'react';
import { lirePlage } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import {
  interpreterSante, interpreterPiecesFaites, bilanLecture, derniersLus,
  verdictLecture, ligneSanteLecture, fileLecture, enCoursLecture, manquesLecture,
  cadenceLecture, importFile, certitudeClassement, memoireComptes, entonnoir,
  restantsTranche, serieParJour, lignesSanteManquantes, DocumentLu, DossierLecture,
} from '../etat';
import { AvancementLecture } from '../composants/AvancementLecture';
import { Entonnoir, BatonsParJour, Ventilation } from '../composants/GraphesLecture';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Langue, t } from '../i18n';

const ONGLET = 'PiecesFaites';
/**
 * Plage OUVERTE en lignes : l'onglet est append-only et grandit d'une ligne par document.
 * ⚠️ `A2:F` depuis C49-14 — la colonne `Domaine` est arrivée EN QUEUE. Laisser `A2:E` ne
 * lèverait aucune erreur : le dossier serait simplement vide partout, en silence.
 */
const PLAGE = 'A2:F';
const COMBIEN_RECENTS = 25;
const COMBIEN_MANQUES = 10;

/** Une barre par dossier de la tranche. Le composant ne décide rien : tout vient du moteur. */
function BarreDossier({ d, rang, langue }: { d: DossierLecture; rang: number; langue: Langue }) {
  const fini = d.restants === 0;
  // Le premier dossier qui a encore du reste EST celui en cours — c'est l'ordre du moteur.
  const etat = fini ? 'fini' : (rang === 0 ? 'encours' : 'attente');
  // ⚠️ Pas de jauge quand le total est INCONNU (les dossiers « en attente » : la phrase du
  // moteur ne donne que leur reste). Une jauge à 0 % affirmerait « rien n'y est lu », ce que
  // personne n'a mesuré.
  const pct = d.lus !== null && d.total !== null && d.total > 0
    ? Math.round((d.lus / d.total) * 100)
    : null;
  const libelle = fini
    ? t('lectureFileFini', langue)
    : etat === 'encours' ? t('lectureFileEnCours', langue) : t('lectureFileAttend', langue);
  return (
    <li className={`lecture-dossier lecture-dossier-${etat}`}>
      <span className="lecture-dossier-nom">{d.prefixe}</span>
      <span className="lecture-dossier-jauge" aria-hidden="true">
        {pct !== null ? <span className="lecture-dossier-part" style={{ width: `${pct}%` }} /> : null}
      </span>
      <span className="lecture-dossier-compte">
        {pct !== null ? `${d.lus}/${d.total}` : `${d.restants} ${t('fileReste', langue)}`}
      </span>
      <span className="lecture-dossier-etat">{libelle}</span>
    </li>
  );
}

export function Lecture({ langue }: { langue: Langue }) {
  const { donnees } = useEtatGlobal();
  const [lus, setLus] = useState<DocumentLu[] | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let vivant = true;
    lirePlage(ONGLET, PLAGE)
      .then((brut) => { if (vivant) setLus(interpreterPiecesFaites(brut)); })
      .catch((e) => {
        // ⚠️ Un échec de lecture DIT qu'il a eu lieu : rendre une liste vide ferait lire
        // « aucun document lu », c'est-à-dire un fait, sur une panne d'affichage.
        if (vivant) { setErreur(String(e)); setLus([]); }
      });
    return () => { vivant = false; };
  }, []);

  const sante = donnees ? interpreterSante(donnees.santeBrut).lignes : [];
  const ligne = ligneSanteLecture(sante);
  const file = donnees ? fileLecture(sante) : null;
  const enCours = donnees ? enCoursLecture(sante) : null;
  const bilan = lus ? bilanLecture(lus) : null;
  const recents = lus ? derniersLus(lus, COMBIEN_RECENTS) : [];
  const manques = lus ? manquesLecture(lus, COMBIEN_MANQUES) : [];
  const restants = restantsTranche(file);
  const cadence = lus ? cadenceLecture(lus, restants) : null;
  const dernier = recents.length ? recents[0]! : null;

  const imp = donnees ? importFile(sante) : null;
  const mem = donnees ? memoireComptes(sante) : null;
  const cert = donnees ? certitudeClassement(donnees.index) : null;
  const marches = entonnoir(imp, bilan, mem);
  const serie = lus ? serieParJour(lus) : [];
  const manquantes = donnees ? lignesSanteManquantes(sante) : [];

  return (
    <div className="colonnes">
      {/* ── 0. CE QUI EMPÊCHE ────────────────────────────────────────────────────────────────
          ⚠️ EN TÊTE, et pas dans un repli. Le 23/09, la page disait « le moteur n'a pas encore
          publié cette file » — une phrase littéralement vraie et parfaitement inutile : elle
          ne dit ni pourquoi, ni quoi faire, et elle se lit comme une panne de la campagne
          alors que la campagne va bien. C'est le déploiement qui est en retard. */}
      {manquantes.length > 0 ? (
        <section className="carte carte-alerte">
          <h2>{t('figeTitre', langue)}</h2>
          <p>{t('figeTexte', langue)}</p>
          <p className="discret">
            {t('figeLignes', langue)} <code>{manquantes.join(' · ')}</code>
          </p>
          <p><strong>{t('figeGeste', langue)}</strong></p>
        </section>
      ) : null}

      {/* ── 1. L'ENTONNOIR ─────────────────────────────────────────────────────────────────── */}
      <section className="carte">
        <h2>{t('entonnoirTitre', langue)}</h2>
        <p className="discret">{t('entonnoirIntro', langue)}</p>
        {!donnees ? <IndicateurChargement langue={langue} /> : <Entonnoir marches={marches} langue={langue} />}
      </section>

      {/* ── 2. LA MÉMOIRE, NOMMÉE À PART ───────────────────────────────────────────────────
          Marc : « ce qui est validé SÉPARÉMENT par driveai et memory ai ». Ces chiffres-là
          sont comptés par l'AUTRE app : les fondre avec ceux de DriveAI ferait disparaître
          l'écart, qui est justement ce qui s'explique. */}
      <section className="carte">
        <h2>{t('memoireTitre', langue)}</h2>
        {!donnees ? (
          <IndicateurChargement langue={langue} />
        ) : mem === null ? (
          <p className="discret">{t('memoireAbsente', langue)}</p>
        ) : mem.etat === 'jamais-lue' ? (
          <p className="discret">{t('memoireJamaisLue', langue)}</p>
        ) : mem.etat === 'indisponible' ? (
          // ⚠️ Le MOTIF est affiché, jamais « erreur » : un 401 est un geste de Marc (le
          // jeton), un 503 passera tout seul. Les confondre envoie corriger le mauvais endroit.
          <p className="lecture-etat">
            {t('memoireIndisponible', langue)} — <code>{mem.motif}</code>
          </p>
        ) : (
          <>
            {mem.gele ? <p className="lecture-etat">{t('memoireGelee', langue)}</p> : null}
            <ul className="lecture-bilan">
              <li className="verdict-ok"><strong>{mem.valides.toLocaleString('fr-CA')}</strong> {t('memoireValides', langue)}</li>
              <li><strong>{mem.papiers.toLocaleString('fr-CA')}</strong> {t('memoirePapiers', langue)}</li>
              <li><strong>{mem.papiersLus.toLocaleString('fr-CA')}</strong> {t('memoireLus', langue)}</li>
              {mem.aValider > 0 ? (
                <li><strong>{mem.aValider.toLocaleString('fr-CA')}</strong> {t('memoireAValider', langue)}</li>
              ) : null}
              {/* ⚠️ Publié, jamais tu : sans lui, des milliers de faits manquent à « validés »
                  sans qu'aucun champ ne dise où ils sont partis — et ça ressemble à une perte. */}
              {mem.migres > 0 ? (
                <li className="discret"><strong>{mem.migres.toLocaleString('fr-CA')}</strong> {t('memoireMigres', langue)}</li>
              ) : null}
            </ul>
            <p className="discret">{t('memoireLe', langue)} {mem.le.replace('T', ' ')}</p>
          </>
        )}
      </section>

      {/* ── 3. LA TRANCHE EN COURS ─────────────────────────────────────────────────────────
          ⚠️ La tranche et LE RESTE DU DRIVE ne se fondent pas en un seul pourcentage
          (arbitrage de Marc, 21/09) : une barre unique sur tout le Drive semblerait bloquée
          alors que la tranche avance, et l'inverse cacherait ce qui attend derrière. */}
      <section className="carte">
        <h2>{t('trancheTitre', langue)}</h2>
        {!donnees ? (
          <IndicateurChargement langue={langue} />
        ) : file === null ? (
          <p className="discret">{t('lectureFileAbsente', langue)}</p>
        ) : file.length === 0 ? (
          <p className="discret">{t('lectureFileIllisible', langue)}</p>
        ) : (
          <>
            <ul className="lecture-file">
              {file.map((d, k) => <BarreDossier key={d.prefixe} d={d} rang={k} langue={langue} />)}
            </ul>
            {/* ⚠️ « 0 restant » est une FIN, pas une vitesse. C'est ce qui produisait « il
                reste environ 0 jours » — vrai de la tranche, et lu comme une affirmation sur
                tout le Drive. */}
            {restants === 0 ? <p className="discret">{t('trancheFinie', langue)}</p> : null}
            <p className="discret">{t('lectureFileLegende', langue)}</p>
          </>
        )}
        <p className="discret lecture-reste">
          <strong>{t('lectureResteTitre', langue)} —</strong> {t('lectureResteTexte', langue)}
        </p>
      </section>

      {/* ── 4. LES GRAPHES ─────────────────────────────────────────────────────────────────── */}
      <section className="carte">
        <h2>{t('vitesseTitre', langue)}</h2>
        {lus === null ? (
          <IndicateurChargement langue={langue} />
        ) : (
          <>
            <BatonsParJour serie={serie} langue={langue} />
            <p className="discret">{t('vitesseLegende', langue)}</p>
            {/* L'estimé ne s'affiche QUE s'il porte sur un reste connu et non nul. */}
            {cadence && cadence.parJourActif > 0 ? (
              <p className="lecture-cadence">
                <strong>{cadence.parJourActif}</strong> {t('lectureCadenceParJour', langue)} {cadence.jour}
                {cadence.joursRestants !== null && restants !== null && restants > 0 ? (
                  <>
                    {' · '}{t('lectureCadenceReste', langue)}{' '}
                    <strong>{cadence.joursRestants}</strong> {t('lectureCadenceJours', langue)}
                  </>
                ) : null}
              </p>
            ) : (
              <p className="discret">{t('lectureCadenceInconnue', langue)}</p>
            )}
          </>
        )}
      </section>

      <section className="carte">
        <h2>{t('ventilTitre', langue)}</h2>
        {lus === null ? (
          <IndicateurChargement langue={langue} />
        ) : !bilan || bilan.total === 0 ? (
          <p className="discret">{t('lectureRienLu', langue)}</p>
        ) : (
          <Ventilation bilan={bilan} langue={langue} />
        )}
      </section>

      <section className="carte">
        <h2>{t('avancementTitre', langue)}</h2>
        <AvancementLecture langue={langue} />
      </section>

      {/* La certitude du CLASSEMENT — jamais de la lecture : aucune confiance n'est attachée
          à l'extraction d'un papier, et en fabriquer une serait un chiffre inventé. */}
      <section className="carte">
        <h2>{t('certitudeTitre', langue)}</h2>
        {!donnees ? (
          <IndicateurChargement langue={langue} />
        ) : cert === null || cert.pourcent === null ? (
          <p className="discret">{t('certitudeAucune', langue)}</p>
        ) : (
          <>
            <p className="certitude">
              <strong className="certitude-nombre">{cert.pourcent} %</strong>{' '}
              {/* ⚠️ LE DÉNOMINATEUR EST DIT. « 97 % » sur 5 800 mesurés parmi 20 947 documents
                  est vrai et trompeur tant que la population n'est pas nommée. */}
              {t('certitudeSur', langue).replace('{n}', cert.mesurees.toLocaleString('fr-CA'))}
            </p>
            {cert.sansMesure > 0 ? (
              <p className="discret">
                {t('certitudeHors', langue).replace('{n}', cert.sansMesure.toLocaleString('fr-CA'))}
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── 5. LE DÉTAIL ───────────────────────────────────────────────────────────────────
          ⚠️ Un `<details>` masque à l'œil mais EXPÉDIE son contenu : ce qui suit est déjà
          chargé par cet écran, donc le repli ne cache aucune lecture supplémentaire. */}
      <details className="repli-detail">
        <summary className="btn-detail">{t('detailBouton', langue)}</summary>

        <section className="carte">
          <h2>{t('lectureEnCoursTitre', langue)}</h2>
          <p className="discret">{t('lectureIntro', langue)}</p>
          {!donnees ? (
            <IndicateurChargement langue={langue} />
          ) : enCours ? (
            <p className="lecture-encours">
              <strong>{t('lectureEnCoursLit', langue)} :</strong> {enCours}
            </p>
          ) : (
            <>
              <p className="discret">{t('lectureEnCoursRepos', langue)}</p>
              {dernier ? (
                <p className="lecture-encours">
                  <strong>{t('lectureDernierLu', langue)} :</strong>{' '}
                  {dernier.nom || t('lectureNomAbsent', langue)}
                  {dernier.domaine ? ` (${dernier.domaine})` : ''} — {dernier.le}
                </p>
              ) : null}
            </>
          )}
          {ligne === null ? (
            <p className="discret">{t('lectureAucunEtat', langue)}</p>
          ) : (
            <p className="lecture-etat">{ligne}</p>
          )}
        </section>

        <section className="carte">
          <h2>{t('lectureManquesTitre', langue)}</h2>
          {lus === null ? (
            <IndicateurChargement langue={langue} />
          ) : manques.length === 0 ? (
            <p className="discret">{t('lectureManquesAucun', langue)}</p>
          ) : (
            <ul className="lecture-liste">
              {manques.map((m) => (
                <li key={m.fileId}>
                  <a
                    href={`https://drive.google.com/file/d/${m.fileId}/view`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {m.nom || t('lectureNomAbsent', langue)}
                  </a>
                  {m.domaine ? <span className="discret">{m.domaine}</span> : null}
                  <span className="lecture-verdict verdict-vide">{m.raison}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="carte">
          <h2>{t('lectureRecentsTitre', langue)}</h2>
          {erreur ? <BanniereErreur langue={langue} erreur={erreur} /> : null}
          {lus === null ? (
            <IndicateurChargement langue={langue} />
          ) : recents.length === 0 ? (
            <p className="discret">{t('lectureRienLu', langue)}</p>
          ) : (
            <ul className="lecture-liste">
              {recents.map((d) => {
                const v = verdictLecture(d.motif);
                return (
                  <li key={d.fileId + d.le}>
                    <a
                      href={`https://drive.google.com/file/d/${d.fileId}/view`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {/* ⚠️ Un nom absent se DIT : c'est une ligne écrite avant que le moteur
                          ne l'inscrive, pas un document sans nom. */}
                      {d.nom || t('lectureNomAbsent', langue)}
                    </a>
                    {d.domaine ? <span className="discret">{d.domaine}</span> : null}
                    <span className={`lecture-verdict verdict-${v.classe}`}>{v.libelle}</span>
                    <span className="discret">{d.le}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </details>
    </div>
  );
}
