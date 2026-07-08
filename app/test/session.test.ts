/**
 * session.test.ts — VERROU de session (P1/C28-01, promis dans l'en-tête de google.ts) :
 * le jeton GIS vit en sessionStorage et ne touche JAMAIS localStorage (persistance disque
 * inter-sessions = surface XSS durable). Tripwire par SCAN DE SOURCE : commentaires et chaînes
 * sont retirés par un mini-scanner à états (jamais des regex ordonnées : une URL `https://…`
 * dans une chaîne ferait avaler la fin de ligne par le strip `//`, faux vert possible).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ici = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(ici, '../src/google.ts'), 'utf8');

/**
 * Ne garde que le CODE : scanner caractère par caractère qui saute commentaires (bloc + ligne)
 * et littéraux de chaîne (', ", `) en respectant les échappements — l'ORDRE n'a plus d'importance.
 */
function codeSeul(src: string): string {
  let dehors = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (c2 === '/*') {
      const fin = src.indexOf('*/', i + 2);
      i = fin === -1 ? src.length : fin + 2;
    } else if (c2 === '//') {
      const fin = src.indexOf('\n', i);
      i = fin === -1 ? src.length : fin; // garde le \n (structure de lignes intacte)
    } else if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < src.length && src[i] !== c) {
        i += src[i] === '\\' ? 2 : 1; // échappement : saute le caractère suivant
      }
      i += 1; // guillemet fermant
    } else {
      dehors += c;
      i += 1;
    }
  }
  return dehors;
}

describe('verrou session (google.ts) — jeton en sessionStorage, jamais localStorage', () => {
  const code = codeSeul(source);

  it('le CODE de google.ts ne référence jamais localStorage', () => {
    expect(code).not.toMatch(/\blocalStorage\b/);
  });

  it('le jeton passe bien par sessionStorage — le verrou surveille le bon mécanisme', () => {
    // Si le stockage du jeton déménage un jour, ce test doit être RÉVISÉ (ADR), pas contourné.
    expect(code).toMatch(/sessionStorage\.getItem\(\s*CLE_JETON/);
    expect(code).toMatch(/sessionStorage\.setItem\(\s*CLE_JETON/);
    expect(code).toMatch(/sessionStorage\.removeItem\(\s*CLE_JETON/);
  });

  it('garde anti-faux-vert : le scanner n\'avale pas le code autour des URLs et commentaires', () => {
    expect(code).toContain('function');
    expect(code).toContain('CLE_JETON');
    // Auto-test du scanner sur les pièges connus (URL en chaîne, apostrophe dans un commentaire).
    expect(codeSeul("s.src = 'https://x/y'; appel();")).toContain('appel()');
    expect(codeSeul("// l'URL https://x\nlocalStorage.setItem(a, b)")).toContain('localStorage');
    expect(codeSeul("/* d'abord */ suite('x')")).toContain('suite');
  });
});
