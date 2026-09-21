/**
 * Lecture.tsx — L'AVANCEMENT DE LA LECTURE DES PAPIERS, en un onglet.
 *
 * ⚠️ POURQUOI CET ÉCRAN EXISTE. Marc, le 21/09/2026 : « ça ne m'explique toujours pas
 * l'avancement, je veux vraiment un onglet précis pour l'avancement, avec ce qui est en train
 * d'être lu, ce qui a déjà été lu ». L'information existait — éparpillée dans une ligne de
 * Santé au milieu de quinze autres, un onglet de série, et une liste de `fileId` opaques.
 *
 * ⚠️ QUATRE QUESTIONS, DANS CET ORDRE, parce que c'est l'ordre dans lequel on se les pose :
 *   1. où on en est (combien lus, combien restent) ;
 *   2. **ce qui se passe maintenant** — et surtout POURQUOI c'est arrêté quand ça l'est ;
 *   3. ce qui a déjà été lu, nommément, avec ce que chaque lecture a donné ;
 *   4. à quelle vitesse ça avance (le graphe, `AvancementLecture`).
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
  verdictLecture, ligneSanteLecture, DocumentLu,
} from '../etat';
import { AvancementLecture } from '../composants/AvancementLecture';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Langue, t } from '../i18n';

const ONGLET = 'PiecesFaites';
/** Plage OUVERTE en lignes : l'onglet est append-only et grandit d'une ligne par document. */
const PLAGE = 'A2:E';
const COMBIEN_RECENTS = 25;

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
  const bilan = lus ? bilanLecture(lus) : null;
  const recents = lus ? derniersLus(lus, COMBIEN_RECENTS) : [];

  return (
    <div className="colonnes">
      <section className="carte">
        <h2>{t('lectureTitre', langue)}</h2>
        <p className="discret">{t('lectureIntro', langue)}</p>

        {/* CE QUI SE PASSE — en premier, parce que c'est ce qui explique tout le reste. */}
        {!donnees ? (
          <IndicateurChargement langue={langue} />
        ) : ligne === null ? (
          <p className="discret">{t('lectureAucunEtat', langue)}</p>
        ) : (
          <p className="lecture-etat">{ligne}</p>
        )}
      </section>

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
