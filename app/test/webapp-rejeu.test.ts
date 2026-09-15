/**
 * webapp-rejeu.test.ts — un 404 d'infrastructure d'Apps Script se REJOUE, le reste NON (C28-133).
 *
 * Symptôme d'origine (Marc, 15/09) : « erreur 404 quand je fais une demande à l'assistant »,
 * affiché « Web app 404 ». Le canal marchait par ailleurs — le compteur `app:chat-assistant` du
 * moteur est passé de 4 à 8 appels réussis pendant la même fenêtre — donc la panne était
 * TRANSITOIRE, et la règle de `CLAUDE.md` §9 (« rejouer, borné, tout ce qui n'est pas un JSON
 * ok:true ») n'avait jamais été appliquée aux appels de l'app.
 *
 * Ce que ces tests figent, c'est la FRONTIÈRE : ce qui se rejoue, ce qui échoue vite, et le NOMBRE
 * d'appels réseau réellement faits — un compteur de rejeux ne prouve rien sans lui.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postWebApp, WEBAPP_ESSAIS, WEBAPP_ATTENTES_MS } from '../src/google';
import { chargerConfigServeur } from '../src/config';

const CONFIG = { spreadsheetId: 's', webappUrl: 'https://script.google.com/macros/s/X/exec', webappSecret: 'sec' };

/** Réponse factice : `corps` string ⇒ illisible (page HTML), objet ⇒ JSON. */
const reponse = (status: number, corps: unknown): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (typeof corps === 'string') throw new SyntaxError('Unexpected token < in JSON');
    return corps;
  },
} as unknown as Response);

let attentes: number[];
const attendre = async (ms: number) => { attentes.push(ms); };

beforeEach(async () => {
  attentes = [];
  vi.stubGlobal('fetch', vi.fn(async () => reponse(200, CONFIG)));
  await chargerConfigServeur();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('postWebApp — le rejeu borné du 404 Apps Script', () => {
  it('404 puis 200 : la demande ABOUTIT, et il a fallu DEUX appels réseau', async () => {
    // Le cas de Marc. Avant ce correctif, la première réponse levait « Web app 404 » et le message
    // était perdu — alors que le second essai aurait réussi.
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse(404, 'Sorry, unable to open the file at this time.'))
      .mockResolvedValueOnce(reponse(200, { ok: true, reponse: 'voici' }));
    vi.stubGlobal('fetch', faux);
    const data = await postWebApp<{ ok: boolean; reponse?: string }>('chat-assistant', {}, attendre);
    expect(data.reponse).toBe('voici');
    expect(faux).toHaveBeenCalledTimes(2);           // ← mutation : retirer le `continue` ⇒ 1 seul
    expect(attentes).toEqual([WEBAPP_ATTENTES_MS[0]]); // on a bien ATTENDU entre les deux
  });

  it('404 partout : échec APRÈS le nombre d’essais prévu, et le message dit qu’on a insisté', async () => {
    const faux = vi.fn(async () => reponse(404, 'Sorry, unable to open the file at this time.'));
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, attendre)).rejects.toThrow(/Web app 404/);
    await expect(postWebApp('chat-assistant', {}, attendre)).rejects.toThrow(new RegExp(`${WEBAPP_ESSAIS} essais`));
    expect(faux).toHaveBeenCalledTimes(WEBAPP_ESSAIS * 2); // deux appels de test, N essais chacun
    // …et les attentes suivent la table, jamais une valeur en dur.
    expect(attentes.slice(0, WEBAPP_ESSAIS - 1)).toEqual(WEBAPP_ATTENTES_MS.slice(0, WEBAPP_ESSAIS - 1));
  });

  it('un 200 ILLISIBLE (page HTML) ne se rejoue PAS — piège de VERSION, permanent', async () => {
    // Rejouer ici ne ferait que servir trois fois la même page d'erreur, en masquant un problème de
    // déploiement derrière une lenteur. Le message d'origine est conservé mot pour mot.
    const faux = vi.fn(async () => reponse(200, '<!DOCTYPE html><title>Script function not found: doGet</title>'));
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, attendre)).rejects.toThrow(/redéployée en nouvelle version/);
    expect(faux).toHaveBeenCalledTimes(1);   // ← mutation : rejouer l'illisible ⇒ 3
    expect(attentes).toEqual([]);
  });

  it('un JSON propre `ok:false` ne se rejoue PAS — secret, config ou budget sont permanents', async () => {
    const faux = vi.fn(async () => reponse(200, { ok: false, erreur: 'Budget du jour atteint' }));
    vi.stubGlobal('fetch', faux);
    const data = await postWebApp<{ ok: boolean; erreur?: string }>('chat-assistant', {}, attendre);
    expect(data.ok).toBe(false);             // rendu À L'APPELANT, qui distingue budget et panne
    expect(data.erreur).toBe('Budget du jour atteint');
    expect(faux).toHaveBeenCalledTimes(1);   // ← mutation : rejouer sur ok:false ⇒ 3
  });

  it('un `fetch` qui LÈVE ne se rejoue PAS : « je ne sais pas si ça a tourné » n’autorise rien', async () => {
    // Décision explicite, et c'est la seule du lot qui ne vient pas de la leçon : un réseau coupé ne
    // prouve PAS que le moteur n'a rien fait. `chat-assistant` coûte un appel LLM et peut écrire des
    // propositions — un rejeu à l'aveugle les dupliquerait.
    const faux = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, attendre)).rejects.toThrow(/Failed to fetch/);
    expect(faux).toHaveBeenCalledTimes(1);   // ← mutation : envelopper le fetch d'un try/continue ⇒ 3
  });

  it('les trois appelants passent par le rejeu — une garde n’existe qu’aux endroits qui la consultent', async () => {
    const src = (await import('node:fs')).readFileSync(
      new URL('../src/google.ts', import.meta.url), 'utf8');
    // Il ne doit rester QU'UN seul `fetch` vers la web app : celui de `postWebApp`. Un quatrième
    // appelant qui refait son propre `fetch` contournerait le rejeu en silence — c'est exactement
    // ainsi que la leçon §9 est restée non appliquée pendant des mois.
    const directs = src.match(/await fetch\(`\$\{webappUrl\}/g) ?? [];
    expect(directs.length, 'un seul fetch web app, celui du rejeu').toBe(1);
    // …et il vit bien DANS `postWebApp`, pas ailleurs.
    const helper = src.slice(src.indexOf('export async function postWebApp'), src.indexOf('export async function rechercheIA'));
    expect(helper).toContain('await fetch(`${webappUrl}');
    // Les trois appelants passent par lui.
    for (const appel of ["postWebApp<{ ok: boolean; erreur?: string; plan?: PlanRechercheIA }>(",
      "'chat-assistant', { historique }", "postWebApp<{ ok: boolean; erreur?: string; message?: string }>(action, corps)"]) {
      expect(src).toContain(appel);
    }
  });
});
