/**
 * GARDE-FOU §2 PAR CONSTRUCTION — l'app ne doit exposer AUCUN chemin de suppression.
 * Ce test verrouille la SURFACE de code : si quelqu'un ajoute un DELETE HTTP, un `trashed: true`
 * ou un appel à l'endpoint de suppression Drive dans `src/`, il casse ici — et la revue doit
 * trancher en conscience (jamais par accident).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));

function fichiersSources(dossier: string): string[] {
  const resultat: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) resultat.push(...fichiersSources(chemin));
    else if (/\.(ts|tsx)$/.test(nom)) resultat.push(chemin);
  }
  return resultat;
}

const MOTIFS_INTERDITS: [string, RegExp][] = [
  ['méthode HTTP DELETE', /method:\s*['"`]DELETE['"`]/i],
  ['mise à la corbeille (trashed: true)', /trashed['"`]?\s*:\s*true/],
  ['suppression de lignes Sheet (deleteDimension/deleteRange)', /delete(Dimension|Range)/],
  ['batchUpdate Sheets (peut supprimer des lignes)', /spreadsheets[^'"`]*:batchUpdate/],
];

describe('surface de code sans suppression (§2)', () => {
  const sources = fichiersSources(join(ICI, '..', 'src'));

  it('couvre bien les sources de l’app', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [libelle, motif] of MOTIFS_INTERDITS) {
    it(`aucun ${libelle}`, () => {
      for (const f of sources) {
        const contenu = readFileSync(f, 'utf8');
        expect(motif.test(contenu), `${libelle} trouvé dans ${f}`).toBe(false);
      }
    });
  }
});
