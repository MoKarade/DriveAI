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

  it('les verdicts de l\'audit se collent au MÊME seuil que la barre d\'onglets (C49-3)', () => {
    // ⚠️ MESURÉ avant d'exister : posés en flux normal, les trois boutons tombaient SOUS la barre
    // d'onglets (« Juste » à y=788 pour une barre à y=783), donc le geste principal de l'écran
    // était inatteignable — et rien ne le signalait, un bouton recouvert s'affiche parfaitement.
    // Ils sont donc collants au-dessus d'elle. Deux seuils différents rouvriraient une fenêtre de
    // largeurs où ils se collent au mauvais endroit : c'est le défaut que ce fichier garde déjà.
    const css = lire('../src/styles.css');
    const seuilBarre = css.match(/@media \(max-width: (\d+)px\) \{[^@]*?nav\.barre-basse \{\s*display: grid;/);
    const seuilVerdicts = css.match(/@media \(max-width: (\d+)px\) \{[^@]*?\.audit-verdicts \{ bottom:/);
    expect(seuilVerdicts, 'le bloc collant des verdicts est introuvable — les boutons retomberaient sous la barre').not.toBeNull();
    expect(seuilVerdicts![1], 'le seuil des verdicts a divergé de celui de la barre').toBe(seuilBarre![1]);
    // …et ils se collent au-dessus d'ELLE, pas au bas du viewport : `bottom: 0` les remettrait
    // exactement là où la mesure les a trouvés.
    expect(css).toMatch(/\.audit-verdicts \{ bottom: calc\(var\(--barre-basse-h\)/);
  });
});
