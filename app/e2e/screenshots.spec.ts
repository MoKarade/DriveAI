/**
 * screenshots.spec.ts — photographie les 5 écrans de l'app en MODE MOCK (VITE_E2E_MOCK=true,
 * injectée par playwright.config.ts), à DEUX tailles (projets « pc » et « tel »). Les images
 * atterrissent dans `e2e-screenshots/` (préfixées par le projet) et sont remontées en artifact
 * GitHub à chaque push (voir .github/workflows/ci.yml) : un coup d'œil suffit pour voir si l'UI
 * est visuellement cassée — sur téléphone aussi, désormais.
 */
import { test, expect } from '@playwright/test';

// Libellés FR de la nav (i18n.ts) — l'app démarre en français par défaut.
const SECTIONS: Array<{ fichier: string; libelle: string }> = [
  { fichier: '1-aujourdhui', libelle: 'Aujourd’hui' },
  { fichier: '2-agenda', libelle: 'Agenda' },
  { fichier: '3-documents', libelle: 'Documents' },
  { fichier: '4-assistant', libelle: 'Assistant' }, // C28-30 : chat + validation du plan
  { fichier: '5-reglages', libelle: 'Réglages' },   // v7 : l'ancienne page Moteur, hors navigation
];

test('captures des 5 écrans (mode mock, app "connectée")', async ({ page }, testInfo) => {
  const tel = testInfo.project.name === 'tel';
  // Plus rien à seeder (C28-20) : l'écran Configuration n'existe plus — en mode mock,
  // config.ts sert une config factice et google.ts une session bouchonnée, sans aucun fetch.
  await page.goto('/');

  // Le mode mock rend estConnecte() vrai : la nav des sections doit être là, PAS le bouton Connexion.
  // Sur téléphone c'est la barre basse ; sur PC, le rail. Réglages n'est dans aucune des deux sur
  // téléphone : on y va par l'engrenage de la barre haute.
  const nav = page.getByRole('navigation', { name: tel ? 'Sections (mobile)' : 'Sections', exact: true });
  await expect(nav).toBeVisible();

  for (const { fichier, libelle } of SECTIONS) {
    const bouton = libelle === 'Réglages' && tel
      ? page.getByRole('button', { name: libelle, exact: true })
      : nav.getByRole('button', { name: libelle, exact: true });
    // `dispatchEvent` plutôt que `click` : sur le projet tactile, la barre basse (position fixe)
    // fait attendre Playwright « scrolling into view » sans fin — vécu à la première capture v7.
    // `toBeVisible` d'abord : dispatchEvent saute les contrôles d'actionnabilité (revue PR 0).
    await expect(bouton).toBeVisible();
    await bouton.dispatchEvent('click');
    // Chaque vue charge ses données mockées au montage : on attend le squelette de la vue active
    // (les mocks sont synchrones côté données, un petit délai couvre le rendu React).
    await page.waitForTimeout(400);
    // Téléphone : la fenêtre seule — ce que Marc voit ; une capture pleine page y peindrait la barre
    // d'onglets (position fixe) au milieu de l'image. PC : la page entière.
    await page.screenshot({ path: `e2e-screenshots/${testInfo.project.name}-${fichier}.png`, fullPage: !tel });
  }
});

/**
 * Garde-fou n° 1 du retour de Marc (2026-09-10) : « je dois slide à droite pour tout voir ».
 * La page ne doit JAMAIS déborder horizontalement sur un téléphone, sur AUCUNE section. Cause
 * trouvée : un mot insécable (nom de fichier, n° de police d'assurance, URL) impose sa largeur
 * min-content à sa piste de grille, qui élargit la carte, puis la page — mesuré 441 px de
 * min-content pour un titre de tâche de 53 caractères sur un écran de 390 px. Deux correctifs dans
 * `styles.css` : `overflow-wrap: anywhere` sur `.contenu` et `minmax(0, 1fr)` sur `.colonnes`.
 * Les données de démonstration portent exprès une chaîne longue réaliste (police d'assurance), sinon
 * ce test ne mordrait sur rien. Prouvé par mutation : retirer l'un des deux correctifs le fait échouer.
 */
test('téléphone : aucune section ne déborde en largeur (petit écran, police agrandie)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tel', 'garde-fou propre au téléphone');
  for (const largeur of [390, 320]) {
    for (const policeRacine of ['16px', '24px']) { // 24 px = réglage « texte plus grand » du système
      await page.setViewportSize({ width: largeur, height: 844 });
      await page.goto('/');
      await page.evaluate((p) => { document.documentElement.style.fontSize = p; }, policeRacine);
      const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
      // Réglages n'est pas dans la barre d'onglets (engrenage de la barre haute) ; la vue GRILLE de
      // l'Agenda est un écran à part entière, et c'est le plus dense — les deux se testent aussi
      // (revue flotte : sans ça, le garde-fou ne voyait ni l'un ni l'autre).
      for (const libelle of ['Aujourd’hui', 'Agenda', 'Agenda/grille', 'Documents', 'Assistant', 'Réglages']) {
        const bouton = libelle === 'Réglages'
          ? page.getByRole('button', { name: libelle, exact: true })
          : nav.getByRole('button', { name: libelle.split('/')[0], exact: true });
        await expect(bouton).toBeVisible();
        await bouton.dispatchEvent('click');
        if (libelle === 'Agenda/grille') {
          const grille = page.getByRole('button', { name: 'Grille', exact: true });
          await expect(grille).toBeVisible();
          await grille.dispatchEvent('click');
        }
        await page.waitForTimeout(300);
        const mesure = await page.evaluate(() => {
          const de = document.documentElement;
          // Deux symptômes du même défaut : la PAGE qui s'élargit (on fait glisser l'écran) et le
          // TEXTE qui sort de sa carte (mot insécable non coupé). Les deux correctifs de `styles.css`
          // en traitent un chacun, donc les deux se mesurent.
          let horsCarte = 0;
          const rogne = (el: Element, carte: Element) => {
            // Un texte tronqué à l'ellipse (`overflow: hidden` sur un parent) garde une BOÎTE large
            // alors qu'il ne peint rien dehors : ce n'est pas un débordement, c'est le design.
            for (let p = el.parentElement; p && p !== carte; p = p.parentElement) {
              if (getComputedStyle(p).overflowX !== 'visible') return true;
            }
            return false;
          };
          for (const el of document.querySelectorAll('.carte *')) {
            const carte = el.closest('.carte');
            if (!carte || el.children.length > 0 || rogne(el, carte)) continue;
            const debord = el.getBoundingClientRect().right - carte.getBoundingClientRect().right;
            if (debord > horsCarte) horsCarte = debord;
          }
          return { page: de.scrollWidth - de.clientWidth, horsCarte };
        });
        expect(mesure.page, `${libelle} : la page déborde de ${mesure.page} px en ${largeur} px de large (police ${policeRacine})`).toBeLessThanOrEqual(0);
        expect(mesure.horsCarte, `${libelle} : du texte sort de sa carte de ${Math.round(mesure.horsCarte)} px`).toBeLessThanOrEqual(1);
      }
    }
  }
});

/**
 * Garde-fou n° 2 : sur téléphone, en vue GRILLE, la grille horaire tient À L'ÉCRAN. Avant correctif,
 * elle dépassait toujours sous la barre d'onglets fixe (40 px cachés en 390 × 844, 87 en 390 × 700,
 * 106 en 360 × 640, 119 en 320 × 600) : son défilement et celui de la page se disputaient le pouce.
 * Le PAYSAGE est testé aussi — c'est le geste attendu sur un agenda, et une première version du
 * correctif y réduisait la grille à 39 px, voire à rien (revue flotte). Les seuils sont dérivés de
 * `--gt-haut` lue dans le CSS, jamais d'un chiffre du jour, et la mesure est prise page en HAUT
 * (après défilement, « rien de caché » deviendrait vrai gratuitement).
 */
test('téléphone : la grille de l’Agenda tient à l’écran (portrait et paysage)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tel', 'garde-fou propre au téléphone');
  for (const [largeur, hauteur] of [[390, 844], [320, 600], [667, 375]] as const) {
    await page.setViewportSize({ width: largeur, height: hauteur });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Sections (mobile)', exact: true });
    const agenda = nav.getByRole('button', { name: 'Agenda', exact: true });
    await expect(agenda).toBeVisible();
    await agenda.dispatchEvent('click');
    const grille = page.getByRole('button', { name: 'Grille', exact: true });
    await expect(grille).toBeVisible();
    await grille.dispatchEvent('click');
    await page.waitForTimeout(400);

    const mesure = await page.evaluate(() => {
      window.scrollTo(0, 0); // la mesure ne vaut que page en haut
      const defilant = document.querySelector('.gt-defilant');
      const barre = document.querySelector('nav.barre-basse');
      const grilleTemps = document.querySelector('.grille-temps');
      if (!defilant || !barre || !grilleTemps) return null;
      const d = defilant.getBoundingClientRect();
      const b = barre.getBoundingClientRect();
      // Hauteur d'UNE heure dérivée de la constante CSS `--gt-haut` (jamais sa valeur recopiée).
      const haut = parseFloat(getComputedStyle(grilleTemps).getPropertyValue('--gt-haut'));
      return {
        cache: Math.max(0, d.bottom - b.top),        // grille passant DERRIÈRE la barre d'onglets
        visible: Math.min(d.bottom, b.top) - Math.max(d.top, 0),
        heure: haut / 24,
      };
    });
    expect(mesure, `grille introuvable en ${largeur}×${hauteur}`).not.toBeNull();
    expect(mesure!.heure).toBeGreaterThan(0); // la dérivation a bien lu --gt-haut
    expect(mesure!.cache, `${largeur}×${hauteur} : ${Math.round(mesure!.cache)} px de grille sous la barre`).toBe(0);
    expect(mesure!.visible, `${largeur}×${hauteur} : ${Math.round(mesure!.visible)} px visibles`).toBeGreaterThanOrEqual(3 * mesure!.heure);
  }
});
