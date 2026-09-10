/**
 * seuil-telephone.test.ts — VERROU du seuil « téléphone », écrit à deux endroits : `styles.css`
 * (coquille : barre d'onglets basse, en-tête compact de l'Agenda) et `Agenda.tsx` (vue Liste/Grille
 * au lieu de Jour/Semaine/Mois, 3 jours au lieu de 7). Ils ont divergé une fois — 720 px côté JS,
 * 760 px côté CSS — et entre les deux valeurs les styles compacts habillaient un segment à trois
 * boutons. Le commentaire du code promettait « le MÊME seuil » : une promesse de verrou se livre
 * avec son verrou (CLAUDE.md §9), sinon un futur ajustement d'un seul des deux fichiers recrée le
 * défaut en silence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

describe('seuil téléphone : une seule valeur, deux fichiers', () => {
  it('Agenda.tsx et styles.css parlent du même point de bascule', () => {
    const seuilJs = lire('../src/vues/Agenda.tsx').match(/SEUIL_TELEPHONE = '\(max-width: (\d+)px\)'/);
    expect(seuilJs, 'SEUIL_TELEPHONE introuvable dans Agenda.tsx').not.toBeNull();

    const css = lire('../src/styles.css');
    // La coquille téléphone : le media query qui porte la barre d'onglets basse.
    const bloc = css.match(/@media \(max-width: (\d+)px\) \{[^@]*?nav\.barre-basse \{\s*display: grid;/);
    expect(bloc, 'bloc de la barre d’onglets introuvable dans styles.css').not.toBeNull();

    expect(bloc![1], 'le seuil CSS de la coquille téléphone a bougé sans Agenda.tsx').toBe(seuilJs![1]);
  });
});
