/**
 * AvancementLecture.tsx — la SÉRIE de l'avancement de la lecture des papiers (demande de Marc,
 * 21/09/2026 : « je veux un graphe », puis « c'est exactement ce qu'il me faut DANS l'app »).
 *
 * ⚠️ POURQUOI UNE SÉRIE ET PAS UN POURCENTAGE. Le moteur savait déjà dire où il EN EST ; il ne
 * savait pas à quelle VITESSE il y était arrivé. Or un import à l'arrêt depuis trois semaines et
 * un import qui avance affichent exactement la même barre de progression — c'est la pente qui
 * les distingue, et une pente demande plusieurs points.
 *
 * ⚠️ CE COMPOSANT NE CALCULE RIEN. Le rythme et la projection viennent de `rythmeImport`
 * (`etat.ts`, PURE et testée par mutation) : une seconde arithmétique ici serait « une règle et
 * demie », et c'est le genre d'écart qu'on ne voit jamais parce que les deux ont l'air de marcher.
 *
 * ⚠️ « JE NE SAIS PAS » S'AFFICHE COMME TEL. Un rythme nul ne donne aucune date, un reste inconnu
 * n'en donne pas non plus — un horizon inventé se lit comme une mesure, et c'est pire que le
 * silence.
 */

import { useEffect, useState } from 'react';
import { lirePlage } from '../google';
import { interpreterHistoriqueImport, rythmeImport, PointImport, RythmeImport } from '../etat';
import { IndicateurChargement, BanniereErreur } from '../composants/UI';
import { Langue, t } from '../i18n';

const ONGLET = 'HistoriqueImport';
/** Plage OUVERTE en lignes, BORNÉE en colonnes : l'onglet est append-only et grandit d'un par jour. */
const PLAGE = 'A2:H';

/** Le graphe, en SVG à la main : une courbe et un axe ne valent pas une bibliothèque. */
function Courbe({ points, langue }: { points: PointImport[]; langue: Langue }) {
  // On ne trace que le tag COURANT : un bump remet les cumuls à zéro, donc une courbe qui le
  // traverse plongerait verticalement sans que rien ne l'explique.
  const tag = points[points.length - 1]?.tag ?? '';
  const serie = points.filter((p) => p.tag === tag && p.restants !== null);
  if (serie.length < 2) {
    return (
      <p className="discret">
        {t('avancementPasAssezDePoints', langue)}
      </p>
    );
  }

  const L = 320, H = 110, MG = 6;
  const max = Math.max(...serie.map((p) => p.restants ?? 0), 1);
  const x = (i: number) => MG + (i * (L - 2 * MG)) / Math.max(serie.length - 1, 1);
  const y = (v: number) => MG + (1 - v / max) * (H - 2 * MG);
  const trace = serie.map((p, i) => `${x(i)},${y(p.restants ?? 0)}`).join(' ');
  const dernier = serie[serie.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${L} ${H + 16}`}
      className="avancement-courbe"
      role="img"
      aria-label={t('avancementCourbeAlt', langue)
        .replace('{n}', String(serie.length))
        .replace('{reste}', String(dernier.restants ?? 0))}
    >
      <line x1={MG} y1={H - MG} x2={L - MG} y2={H - MG} className="avancement-axe" />
      <polyline points={trace} className="avancement-trace" fill="none" />
      <circle cx={x(serie.length - 1)} cy={y(dernier.restants ?? 0)} r="3.5" className="avancement-fin" />
      <text x={MG} y={H + 12} className="avancement-etiq">{serie[0]!.jour.slice(5)}</text>
      <text x={L - MG} y={H + 12} textAnchor="end" className="avancement-etiq">{dernier.jour.slice(5)}</text>
    </svg>
  );
}

/** La phrase du rythme. PURE de fait : elle ne lit que ce que `rythmeImport` a mesuré. */
function phraseRythme(r: RythmeImport, langue: Langue): string {
  if (r.parJourActif === null) {
    // ⚠️ Deux silences DIFFÉRENTS : « pas encore assez de jours » et « ça n'avance pas ». Le
    // second est le seul qui appelle un geste, donc il ne doit pas se confondre avec le premier.
    return r.joursObserves < 2
      ? t('avancementTropTot', langue)
      : t('avancementArrete', langue);
  }
  const parJour = Math.round(r.parJourActif);
  const base = t('avancementRythme', langue)
    .replace('{n}', String(parJour))
    .replace('{jours}', String(r.joursActifs));
  if (r.joursRestants === null) return base;
  return `${base} · ${t('avancementReste', langue).replace('{j}', String(r.joursRestants))}`;
}

export function AvancementLecture({ langue }: { langue: Langue }) {
  const [points, setPoints] = useState<PointImport[] | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let vivant = true;
    lirePlage(ONGLET, PLAGE)
      .then((brut) => { if (vivant) setPoints(interpreterHistoriqueImport(brut)); })
      // ⚠️ L'onglet n'existe qu'à partir du premier tick qui suit son déploiement : une absence
      // n'est PAS une panne, et l'annoncer comme telle enverrait chercher au mauvais endroit.
      .catch((e) => { if (vivant) setErreur(String(e?.message ?? e)); });
    return () => { vivant = false; };
  }, []);

  if (erreur) return <BanniereErreur langue={langue} erreur={erreur} />;
  if (!points) return <IndicateurChargement langue={langue} />;
  if (points.length === 0) {
    return <p className="discret">{t('avancementAucunPoint', langue)}</p>;
  }

  const r = rythmeImport(points);
  const dernier = points[points.length - 1]!;

  return (
    <div className="avancement">
      <p className="avancement-chiffres">
        <strong>{dernier.restants === null ? '—' : dernier.restants}</strong>{' '}
        {t('avancementRestants', langue)}
      </p>
      <Courbe points={points} langue={langue} />
      <p className="discret">{phraseRythme(r, langue)}</p>
      {dernier.illisibles > 0 && (
        <p className="discret">
          {t('avancementIllisibles', langue).replace('{n}', String(dernier.illisibles))}
        </p>
      )}
    </div>
  );
}
