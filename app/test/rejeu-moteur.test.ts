/**
 * rejeu-moteur.test.ts — le REJEU BORNÉ des actions moteur, et sa liste blanche.
 *
 * ── LE TROU QUE ÇA FERME ────────────────────────────────────────────────────────────
 *
 * La leçon §7 du CLAUDE.md prescrit depuis toujours de « rejouer (borné) tout ce qui n'est
 * pas un JSON ok:true » : un appel `/exec` répond au POST par une redirection, `fetch`
 * bascule en GET, et la plateforme peut servir une page d'écho dégradée — 200 avec du
 * non-JSON. `appelerMoteur` ne rejouait rien : il DISAIT « réessaie » à l'humain.
 *
 * Mesuré le 14/09/2026 depuis une session Claude : première tentative 404, deuxième 200
 * illisible. Deux appels, aucun rejeu, et un diagnostic « moteur cassé » qui était faux.
 *
 * ── CE QUE CES TESTS PROTÈGENT VRAIMENT ─────────────────────────────────────────────
 *
 * Pas le rejeu lui-même (facile), mais sa LIMITE : une action qui écrit ne doit JAMAIS
 * être rejouée. Quand la réponse est illisible, on ne sait pas si le travail a eu lieu —
 * rejouer `mcp-intention` créerait une seconde tâche dans l'agenda de Marc, en silence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { appelerMoteur } from '../../api/mcp/_commun';

const ENV = {
  webappUrl: 'https://script.google.com/macros/s/X/exec',
  webappSecret: 'secret-webapp',
  engineSecret: 'secret-moteur',
  accessKey: 'cle',
  signingKey: 'k'.repeat(40),
} as unknown as Parameters<typeof appelerMoteur>[0];

/** Une réponse `fetch` minimale. */
const rep = (statut: number, corps: string) => ({ status: statut, text: async () => corps });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Exécute une promesse qui contient des `setTimeout`, en avançant l'horloge factice. */
async function avecHorloge<T>(p: Promise<T>): Promise<T> {
  const attente = vi.runAllTimersAsync();
  const r = await p;
  await attente;
  return r;
}

describe('rejeu borné — une action SANS effet de bord', () => {
  it('rejoue un non-JSON puis rend le JSON de la tentative suivante', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(rep(200, '<html>Sorry, unable to open the file</html>'))
      .mockResolvedValueOnce(rep(200, JSON.stringify({ ok: true, versionMcp: 3, etat: 'x' })));
    vi.stubGlobal('fetch', f);

    const r = await avecHorloge(
      appelerMoteur(ENV, 'mcp-etat', 'secret-moteur', {}, true, true),
    );
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('rejoue aussi le 404 « Sorry, unable to open » — la paire vécue le 14/09', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(rep(404, 'Sorry, unable to open the file at this time.'))
      .mockResolvedValueOnce(rep(200, '<html>écho dégradé</html>'))
      .mockResolvedValueOnce(rep(200, JSON.stringify({ ok: true, versionMcp: 3 })));
    vi.stubGlobal('fetch', f);

    const r = await avecHorloge(appelerMoteur(ENV, 'mcp-etat', 's', {}, true, true));
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('abandonne APRÈS trois tentatives, et le message ne dit plus « réessaie »', async () => {
    // Le message comptait : il envoyait l'humain refaire ce que le code n'avait pas fait.
    const f = vi.fn().mockResolvedValue(rep(200, 'DriveAI'));
    vi.stubGlobal('fetch', f);

    await expect(
      avecHorloge(appelerMoteur(ENV, 'mcp-etat', 's', {}, true, true)),
    ).rejects.toThrow(/3 tentative/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('ne rejoue JAMAIS un JSON valide portant ok:false', async () => {
    // Discriminant : un refus est une RÉPONSE. La rejouer ne changerait rien et
    // martèlerait un moteur qui a déjà répondu — la faute exacte commise sur la sonde du
    // Registre, où trois requêtes en une seconde ont fabriqué le refus qu'on mesurait.
    const f = vi
      .fn()
      .mockResolvedValue(rep(200, JSON.stringify({ ok: false, erreur: 'introuvable', versionMcp: 3 })));
    vi.stubGlobal('fetch', f);

    const r = await avecHorloge(appelerMoteur(ENV, 'mcp-etat', 's', {}, true, true));
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('rejeu borné — une action QUI ÉCRIT ne se rejoue pas', () => {
  it('un seul appel, même sur un non-JSON', async () => {
    // LE test de ce fichier. Quand la réponse est illisible, on ne sait pas si le travail
    // a eu lieu : rejouer créerait une SECONDE tâche ou un SECOND événement dans l'agenda
    // de Marc, sans rien pour le signaler. Un doublon silencieux est pire que l'erreur.
    const f = vi.fn().mockResolvedValue(rep(200, '<html>écho dégradé</html>'));
    vi.stubGlobal('fetch', f);

    await expect(
      avecHorloge(appelerMoteur(ENV, 'mcp-intention', 's', { type: 'tache' }, true, false)),
    ).rejects.toThrow(/illisible/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('le DÉFAUT est « ne pas rejouer » — un oubli retire le rejeu, il ne l\'accorde pas', async () => {
    const f = vi.fn().mockResolvedValue(rep(200, 'pas du json'));
    vi.stubGlobal('fetch', f);

    // Sans le dernier argument.
    await expect(
      avecHorloge(appelerMoteur(ENV, 'mcp-intention', 's', {}, true)),
    ).rejects.toThrow(/illisible/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('la liste blanche ne peut pas DIVERGER du moteur', () => {
  it('REJOUABLES est exactement l\'ensemble des actions que MCP_ACTIONS déclare sans écriture', () => {
    // Deux sources de vérité sur la même question, dans deux langages, sans import
    // possible (`api/` est zéro-dépendance et ne lit pas de `.gs`). Ce test est le seul
    // lien : il analyse le fichier source du moteur plutôt que de compter sur la
    // vigilance. Sans lui, la première action ajoutée ferait diverger les deux en silence
    // — et si c'est une action d'écriture oubliée dans la liste blanche, elle deviendrait
    // rejouable, donc duplicable.
    const gs = readFileSync(resolve(__dirname, '../../src/Mcp.gs'), 'utf8');
    const bloc = /var\s+MCP_ACTIONS\s*=\s*\{([^}]*)\}/.exec(gs);
    expect(bloc, 'MCP_ACTIONS introuvable dans src/Mcp.gs').not.toBeNull();

    const sansEcriture = [...bloc![1]!.matchAll(/'([^']+)'\s*:\s*(true|false)/g)]
      .filter((m) => m[2] === 'false')
      .map((m) => m[1]!)
      .sort();

    const source = readFileSync(resolve(__dirname, '../../api/mcp/index.ts'), 'utf8');
    const liste = /const REJOUABLES = new Set\(\[([^\]]*)\]\)/.exec(source);
    expect(liste, 'REJOUABLES introuvable dans api/mcp/index.ts').not.toBeNull();
    const rejouables = [...liste![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();

    expect(sansEcriture.length).toBeGreaterThan(0);
    expect(rejouables).toEqual(sansEcriture);
  });

  it('aucune action déclarée écrivante n\'est rejouable', () => {
    const gs = readFileSync(resolve(__dirname, '../../src/Mcp.gs'), 'utf8');
    const bloc = /var\s+MCP_ACTIONS\s*=\s*\{([^}]*)\}/.exec(gs);
    const ecrivantes = [...bloc![1]!.matchAll(/'([^']+)'\s*:\s*(true|false)/g)]
      .filter((m) => m[2] === 'true')
      .map((m) => m[1]!);

    const source = readFileSync(resolve(__dirname, '../../api/mcp/index.ts'), 'utf8');
    const rejouables = /const REJOUABLES = new Set\(\[([^\]]*)\]\)/.exec(source)![1]!;

    expect(ecrivantes.length).toBeGreaterThan(0);
    for (const action of ecrivantes) {
      expect(rejouables, `${action} écrit et ne doit pas être rejouable`).not.toContain(action);
    }
  });
});
