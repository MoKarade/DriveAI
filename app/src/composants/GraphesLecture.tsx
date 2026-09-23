/**
 * GraphesLecture.tsx — les trois graphes de l'onglet Avancement (23/09/2026).
 *
 * Marc, devant la page précédente : « manque aussi des graphs clairs, des infos sur la
 * vitesse, sur ce qu'il reste, sur ce qui est validé SÉPARÉMENT par driveai et memory ai —
 * je comprends pas la page ». Puis, en texte libre : « lu vs importé vs traité, faits vs
 * papiers ». Cette dernière phrase est la plus utile des trois réponses : ce n'est pas un
 * graphe de plus qu'il demande, c'est un ENTONNOIR.
 *
 * ⚠️ AUCUN DE CES COMPOSANTS NE CALCULE QUOI QUE CE SOIT. `entonnoir`, `serieParJour` et
 * `bilanLecture` sont PURS et testés par mutation dans `etat.ts` ; une seconde arithmétique
 * dans du JSX serait « une règle et demie », et l'écart ne se verrait jamais parce que les
 * deux auraient l'air de marcher.
 *
 * ⚠️ UNE VALEUR NON MESURÉE S'AFFICHE « — », JAMAIS « 0 ». Une marche vide au milieu de
 * l'entonnoir est précisément ce qui désigne le maillon en panne ; la dessiner à zéro
 * ferait lire « plus rien ne passe ici », un fait, sur une simple absence de mesure.
 */

import { MarcheEntonnoir, JourLecture, BilanLecture } from '../etat';
import { Langue, t } from '../i18n';

/** Le plus grand nombre mesuré d'une série, ou `null` si aucun ne l'est. */
function maxMesure(valeurs: (number | null)[]): number | null {
  let m: number | null = null;
  for (const v of valeurs) {
    if (v === null || !Number.isFinite(v)) continue;
    if (m === null || v > m) m = v;
  }
  return m;
}

/**
 * L'ENTONNOIR — une barre par marche, largeur proportionnelle à la plus large.
 *
 * ⚠️ Chaque marche porte la SOURCE qui l'a comptée, et ce n'est pas décoratif : « envoyés »
 * est ce que DriveAI a compté chez lui, « papiers connus » ce que la Mémoire a réellement
 * gardé. Les deux mesurent la même chose par deux chemins, donc leur ÉCART est une
 * information — et c'est exactement la séparation que Marc demandait.
 */
export function Entonnoir({ marches, langue }: { marches: MarcheEntonnoir[]; langue: Langue }) {
  const max = maxMesure(marches.map((m) => m.valeur));
  return (
    <ol className="entonnoir">
      {marches.map((m, i) => {
        const pct = m.valeur !== null && max !== null && max > 0 ? Math.round((m.valeur / max) * 100) : 0;
        // La PERTE par rapport à la marche mesurée précédente. Elle n'a de sens que si les
        // deux sont mesurées : inventer une perte sur une absence serait pire que se taire.
        const avant = marches.slice(0, i).reverse().find((p) => p.valeur !== null);
        const perte = m.valeur !== null && avant && avant.valeur !== null && avant.valeur > m.valeur
          ? avant.valeur - m.valeur
          : null;
        return (
          <li key={m.cle} className={`entonnoir-marche entonnoir-${m.source}`}>
            <span className="entonnoir-nom">{t(`entonnoir_${m.cle}`, langue)}</span>
            <span className="entonnoir-barre" aria-hidden="true">
              <span className="entonnoir-part" style={{ width: `${pct}%` }} />
            </span>
            <span className="entonnoir-valeur">{m.valeur === null ? '—' : m.valeur.toLocaleString('fr-CA')}</span>
            <span className="entonnoir-source">{t(`source_${m.source}`, langue)}</span>
            {perte !== null ? (
              <span className="entonnoir-perte">
                −{perte.toLocaleString('fr-CA')}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * LA VITESSE, un bâton par jour où quelque chose a été lu.
 *
 * ⚠️ Les jours VIDES ne sont pas dessinés parce qu'ils ne sont pas mesurés (`serieParJour`
 * ne les invente pas) : un trou dans la série se lit « ce jour-là n'a rien produit », ce qui
 * est vrai, alors qu'un zéro dessiné affirmerait que la campagne a tourné pour rien.
 */
export function BatonsParJour({ serie, langue }: { serie: JourLecture[]; langue: Langue }) {
  if (serie.length === 0) return <p className="discret">{t('vitesseAucune', langue)}</p>;
  const max = Math.max(...serie.map((j) => j.nombre), 1);
  const L = 320, H = 90, MG = 6;
  const large = Math.max((L - 2 * MG) / serie.length - 2, 2);
  return (
    <svg
      viewBox={`0 0 ${L} ${H + 16}`}
      className="avancement-courbe"
      role="img"
      aria-label={t('vitesseAlt', langue)
        .replace('{n}', String(serie.length))
        .replace('{max}', String(max))}
    >
      <line x1={MG} y1={H - MG} x2={L - MG} y2={H - MG} className="avancement-axe" />
      {serie.map((j, i) => {
        const h = ((H - 2 * MG) * j.nombre) / max;
        return (
          <rect
            key={j.jour}
            x={MG + (i * (L - 2 * MG)) / serie.length}
            y={H - MG - h}
            width={large}
            height={h}
            className="vitesse-baton"
          />
        );
      })}
      <text x={MG} y={H + 12} className="avancement-etiq">{serie[0]!.jour.slice(5)}</text>
      <text x={L - MG} y={H + 12} textAnchor="end" className="avancement-etiq">
        {serie[serie.length - 1]!.jour.slice(5)}
      </text>
    </svg>
  );
}

/**
 * CE QU'ON TIRE DES PAPIERS — la ventilation des verdicts, en une barre empilée.
 *
 * ⚠️ Les quatre classes viennent de `verdictLecture`, la SEULE table de classification du
 * dépôt. C'est ce qui répare la divergence du 23/09 : l'écran annonçait 324 « rien à en
 * tirer » et 21 en échec là où la phrase du moteur disait 306 et 38 — deux ventilations du
 * même travail, et rien ne disait laquelle croire.
 */
export function Ventilation({ bilan, langue }: { bilan: BilanLecture; langue: Langue }) {
  if (bilan.total === 0) return null;
  const parts: { cle: 'ok' | 'vide' | 'echec' | 'inconnu'; n: number }[] = [
    { cle: 'ok', n: bilan.ok },
    { cle: 'vide', n: bilan.vide },
    { cle: 'echec', n: bilan.echec },
    { cle: 'inconnu', n: bilan.inconnu },
  ];
  return (
    <div className="ventilation">
      <div className="ventilation-barre" aria-hidden="true">
        {parts.filter((p) => p.n > 0).map((p) => (
          <span
            key={p.cle}
            className={`ventilation-part verdict-${p.cle}`}
            style={{ width: `${(p.n / bilan.total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="ventilation-legende">
        {parts.filter((p) => p.n > 0).map((p) => (
          <li key={p.cle} className={`verdict-${p.cle}`}>
            <strong>{p.n.toLocaleString('fr-CA')}</strong> {t(`ventil_${p.cle}`, langue)}
          </li>
        ))}
      </ul>
    </div>
  );
}
