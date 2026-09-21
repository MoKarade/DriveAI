/**
 * Lecture.tsx — L'AVANCEMENT DE LA LECTURE DES PAPIERS, en un onglet.
 *
 * ⚠️ POURQUOI CET ÉCRAN EXISTE, ET POURQUOI IL A ÉTÉ REFAIT LE 21/09. Première demande :
 * « je veux vraiment un onglet précis pour l'avancement, avec ce qui est en train d'être lu ».
 * Livré (C49-13) — et insuffisant, Marc le jour même : « je vois pas de courbe pas d'estimé je
 * sais pas ça traite quoi en ce moment quel dossier quel fichier quelle direction quelles
 * infos il lui manque ».
 *
 * Il avait raison sur chaque point, et la cause n'était pas l'affichage : QUATRE de ces cinq
 * questions n'avaient aucune réponse dans le moteur. Il n'écrivait un document qu'APRÈS
 * l'avoir lu, jamais son dossier, jamais sa file, jamais ce qu'il était en train de faire.
 * C49-14 les publie ; cet écran ne fait que les mettre en forme.
 *
 * ⚠️ L'ORDRE DES SECTIONS EST L'ORDRE DES QUESTIONS, et il a changé : « en ce moment » passe
 * devant, parce que c'est la première chose qu'on veut savoir en ouvrant l'onglet.
 *   1. en ce moment — quel FICHIER, quel DOSSIER (ou le dernier lu, quand c'est au repos) ;
 *   2. la file — quel dossier maintenant, quel ordre, ce qui vient ENSUITE (la direction) ;
 *   3. la cadence et l'estimé ;
 *   4. ce qu'il n'a PAS pu lire, nommément (les infos qui lui manquent) ;
 *   5. le bilan et les derniers lus ;
 *   6. la courbe.
 *
 * ⚠️ CET ÉCRAN NE CALCULE RIEN. Tout vient de fonctions PURES d'`etat.ts`, testées par
 * mutation. Une seconde arithmétique dans le JSX serait « une règle et demie », et l'écart ne
 * se verrait jamais parce que les deux auraient l'air de marcher.
 */

import { useEffect, useState } from 'react';
import { lirePlage } from '../google';
import { useEtatGlobal } from '../etatGlobal';
import {
  interpreterSante, interpreterPiecesFaites, bilanLecture, derniersLus,
  verdictLecture, ligneSanteLecture, fileLecture, enCoursLecture, manquesLecture,
  cadenceLecture, DocumentLu, DossierLecture,
} from '../etat';
import { AvancementLecture } from '../composants/AvancementLecture';
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

/** Une barre par dossier. Le composant ne décide rien : `DossierLecture` vient du moteur. */
function BarreDossier({ d, rang, langue }: { d: DossierLecture; rang: number; langue: Langue }) {
  const fini = d.restants === 0;
  // Le premier dossier qui a encore du reste EST celui en cours — c'est l'ordre du moteur.
  const etat = fini ? 'fini' : (rang === 0 ? 'encours' : 'attente');
  const pct = d.total > 0 ? Math.round((d.lus / d.total) * 100) : 0;
  const libelle = fini
    ? t('lectureFileFini', langue)
    : etat === 'encours' ? t('lectureFileEnCours', langue) : t('lectureFileAttend', langue);
  return (
    <li className={`lecture-dossier lecture-dossier-${etat}`}>
      <span className="lecture-dossier-nom">{d.prefixe}</span>
      <span className="lecture-dossier-jauge" aria-hidden="true">
        <span className="lecture-dossier-part" style={{ width: `${pct}%` }} />
      </span>
      <span className="lecture-dossier-compte">{d.lus}/{d.total}</span>
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
  const restants = file ? file.reduce((s, d) => s + d.restants, 0) : null;
  const cadence = lus ? cadenceLecture(lus, restants) : null;
  const dernier = recents.length ? recents[0]! : null;

  return (
    <div className="colonnes">
      {/* 1. EN CE MOMENT — la question posée en premier, donc la réponse en premier. */}
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
            {/* ⚠️ Un vide NON EXPLIQUÉ se lirait « c'est arrêté ». La campagne est au repos
                l'essentiel du temps par construction : on le DIT, et on montre le dernier
                document lu, qui est vrai et répond à la même question. */}
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

        {/* L'état brut de la campagne reste affiché : c'est lui qui dit POURQUOI, quand ça
            s'arrête pour une raison qui n'est pas le repos normal. */}
        {ligne === null ? (
          <p className="discret">{t('lectureAucunEtat', langue)}</p>
        ) : (
          <p className="lecture-etat">{ligne}</p>
        )}
      </section>

      {/* 2. QUEL DOSSIER, DANS QUEL ORDRE — la direction. */}
      <section className="carte">
        <h2>{t('lectureFileTitre', langue)}</h2>
        {!donnees ? (
          <IndicateurChargement langue={langue} />
        ) : file === null ? (
          <p className="discret">{t('lectureFileAbsente', langue)}</p>
        ) : file.length === 0 ? (
          <p className="discret">{t('lectureFileIllisible', langue)}</p>
        ) : (
          <>
            <ul className="lecture-file">
              {file.map((d, k) => (
                <BarreDossier key={d.prefixe} d={d} rang={k} langue={langue} />
              ))}
            </ul>
            <p className="discret">{t('lectureFileLegende', langue)}</p>
          </>
        )}
        {/* ⚠️ La tranche et LE RESTE DU DRIVE ne se fondent pas en un seul pourcentage
            (arbitrage de Marc, 21/09) : une barre unique sur tout le Drive semblerait bloquée
            alors que la tranche avance, et l'inverse cacherait ce qui attend derrière. */}
        <p className="discret lecture-reste">
          <strong>{t('lectureResteTitre', langue)} —</strong> {t('lectureResteTexte', langue)}
        </p>
      </section>

      {/* 3. LA CADENCE ET L'ESTIMÉ. */}
      <section className="carte">
        <h2>{t('lectureCadenceTitre', langue)}</h2>
        {lus === null ? (
          <IndicateurChargement langue={langue} />
        ) : !cadence || cadence.parJourActif === 0 ? (
          <p className="discret">{t('lectureCadenceInconnue', langue)}</p>
        ) : (
          <>
            <p className="lecture-cadence">
              <strong>{cadence.parJourActif}</strong> {t('lectureCadenceParJour', langue)}{' '}
              {cadence.jour}
            </p>
            {/* ⚠️ Aucun horizon quand on ne peut pas le mesurer : un nombre inventé se lit
                comme une mesure, et c'est pire que le silence. */}
            {cadence.joursRestants !== null ? (
              <p className="lecture-cadence">
                {t('lectureCadenceReste', langue)} <strong>{cadence.joursRestants}</strong>{' '}
                {t('lectureCadenceJours', langue)}
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* 4. CE QU'IL N'A PAS PU LIRE — « quelles infos il lui manque ». */}
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

      {/* 5. LE BILAN ET LES DERNIERS LUS. */}
      <section className="carte">
        <h2>{t('lectureBilanTitre', langue)}</h2>
        {erreur ? <BanniereErreur langue={langue} erreur={erreur} /> : null}
        {lus === null ? (
          <IndicateurChargement langue={langue} />
        ) : !bilan || bilan.total === 0 ? (
          <p className="discret">{t('lectureRienLu', langue)}</p>
        ) : (
          <ul className="lecture-bilan">
            <li><strong>{bilan.total}</strong> {t('lectureBilanTotal', langue)}</li>
            <li className="verdict-ok"><strong>{bilan.ok}</strong> {t('lectureBilanOk', langue)}</li>
            <li className="verdict-vide"><strong>{bilan.vide}</strong> {t('lectureBilanVide', langue)}</li>
            <li className="verdict-echec"><strong>{bilan.echec}</strong> {t('lectureBilanEchec', langue)}</li>
            {/* ⚠️ Les verdicts non enregistrés ne se fondent pas dans une autre colonne : ce
                sont des lignes d'avant C49-13, pas des lectures ratées. */}
            {bilan.inconnu > 0 ? (
              <li className="discret"><strong>{bilan.inconnu}</strong> {t('lectureBilanInconnu', langue)}</li>
            ) : null}
          </ul>
        )}
      </section>

      <section className="carte">
        <h2>{t('lectureRecentsTitre', langue)}</h2>
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
                    {/* ⚠️ Un nom absent se DIT : c'est une ligne écrite avant que le moteur ne
                        l'inscrive, pas un document sans nom. */}
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

      <AvancementLecture langue={langue} />
    </div>
  );
}
