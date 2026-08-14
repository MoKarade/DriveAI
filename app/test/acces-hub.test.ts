/**
 * acces-hub.test.ts — le verrou d'accès de DriveAI, désormais adossé au hub (ADR 0001 de
 * Hubperso, étape 3).
 *
 * `interroger` (la seule partie qui touche le réseau) est injectée : ce fichier éprouve la
 * DÉCISION et le cache, pas la connectivité. Les cas qui comptent sont ceux du refus — un
 * accès accordé par erreur ne se voit pas, un refus injustifié se signale tout seul.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CACHE_ACCES_MS, aAccesHub, aLeDroitDEntrer, viderCacheAcces } from '../../api/_accesHub';

const PROPRIO = 'marc@exemple.test';
const INVITEE = 'quelquun@exemple.test';
const env = { HUB_TOKEN: 'jeton-factice-de-test', ALLOWED_EMAIL: PROPRIO } as NodeJS.ProcessEnv;

beforeEach(() => {
  viderCacheAcces();
});

describe('aAccesHub', () => {
  it('refuse une adresse vide sans interroger le hub', async () => {
    const interroger = vi.fn();
    expect(await aAccesHub('', env, 0, interroger)).toBe(false);
    expect(interroger).not.toHaveBeenCalled();
  });

  it('refuse sans HUB_TOKEN, sans interroger le hub', async () => {
    const interroger = vi.fn();
    expect(await aAccesHub(INVITEE, {} as NodeJS.ProcessEnv, 0, interroger)).toBe(false);
    expect(interroger).not.toHaveBeenCalled();
  });

  it('accorde quand le hub répond oui, et lui passe l\'adresse normalisée', async () => {
    const interroger = vi.fn(async () => true);
    expect(await aAccesHub('  QuelQu\'Un@Exemple.TEST ', env, 0, interroger)).toBe(true);
    expect(interroger).toHaveBeenCalledWith("quelqu'un@exemple.test", 'jeton-factice-de-test');
  });

  it('refuse quand le hub répond non', async () => {
    expect(await aAccesHub(INVITEE, env, 0, vi.fn(async () => false))).toBe(false);
  });

  it('répond `false` si la requête échoue, sans laisser fuiter l\'exception', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const interroger = vi.fn(async () => { throw new Error('panne réseau'); });
    expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
    expect(erreur).toHaveBeenCalledOnce();
    erreur.mockRestore();
  });

  describe('le cache d\'une minute', () => {
    it('mémorise un OUI et ne réinterroge pas le hub tant qu\'il est valide', async () => {
      const interroger = vi.fn(async () => true);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(true);
      interroger.mockResolvedValue(false);
      expect(await aAccesHub(INVITEE, env, CACHE_ACCES_MS - 1, interroger)).toBe(true);
      expect(interroger).toHaveBeenCalledOnce();
    });

    it('réinterroge le hub une fois le cache expiré', async () => {
      const interroger = vi.fn(async () => true);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(true);
      interroger.mockResolvedValue(false);
      expect(await aAccesHub(INVITEE, env, CACHE_ACCES_MS, interroger)).toBe(false);
      expect(interroger).toHaveBeenCalledTimes(2);
    });

    it('NE mémorise JAMAIS un refus', async () => {
      // Sinon quelqu'un qu'on vient d'ajouter dans l'administration du hub attendrait une
      // minute — précisément au moment où l'on regarde si ça marche.
      const interroger = vi.fn(async () => false);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
      expect(await aAccesHub(INVITEE, env, 0, interroger)).toBe(false);
      expect(interroger).toHaveBeenCalledTimes(2);
    });
  });
});

describe('aLeDroitDEntrer — le propriétaire d\'abord, le hub ensuite', () => {
  it('laisse entrer le propriétaire SANS toucher au réseau', async () => {
    // C'est la garantie qui compte : une panne du hub ne doit jamais enfermer Marc dehors de
    // sa propre app. On le vérifie en retirant HUB_TOKEN — s'il y avait le moindre appel, il
    // échouerait.
    const sansJeton = { ALLOWED_EMAIL: PROPRIO } as NodeJS.ProcessEnv;
    expect(await aLeDroitDEntrer(PROPRIO, sansJeton)).toBe(true);
    expect(await aLeDroitDEntrer('  MARC@Exemple.Test ', sansJeton)).toBe(true);
  });

  it('refuse une adresse vide', async () => {
    expect(await aLeDroitDEntrer('', env)).toBe(false);
    expect(await aLeDroitDEntrer(null, env)).toBe(false);
    expect(await aLeDroitDEntrer(undefined, env)).toBe(false);
  });

  it('ne laisse pas un ALLOWED_EMAIL absent ouvrir la porte à tout le monde', async () => {
    // ÉCHEC FERMÉ : sans la variable, `'' === ''` laisserait passer n'importe qui. Le hub est
    // alors le seul juge, et sans HUB_TOKEN il refuse.
    const sansRien = {} as NodeJS.ProcessEnv;
    expect(await aLeDroitDEntrer('', sansRien)).toBe(false);
    expect(await aLeDroitDEntrer(INVITEE, sansRien)).toBe(false);
  });

  it('délègue au hub pour toute adresse qui n\'est pas le propriétaire', async () => {
    // Sans HUB_TOKEN le hub n'est pas interrogeable → refus. C'est l'échec fermé côté invité.
    expect(await aLeDroitDEntrer(INVITEE, { ALLOWED_EMAIL: PROPRIO } as NodeJS.ProcessEnv)).toBe(false);
  });
});
