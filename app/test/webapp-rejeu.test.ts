/**
 * webapp-rejeu.test.ts — le rejeu d'un POST `/exec`, et ce qui le rend SÛR (C28-133).
 *
 * Symptôme d'origine (Marc, 15/09) : « erreur 404 quand je fais une demande à l'assistant »,
 * affiché « Web app 404 ».
 *
 * ⚠️ CE QUI REND LE REJEU SÛR N'EST PAS LE CODE HTTP. Un POST `/exec` a deux segments :
 * `script.google.com` EXÉCUTE puis redirige vers `googleusercontent.com`, qui sert la sortie.
 * `fetch` suit la redirection, donc un 404 peut vouloir dire « rien n'a tourné » autant que
 * « tout a tourné et Anthropic a été payé ». La première version de ce lot pariait sur la
 * première lecture ; deux revues l'ont réfutée. La garantie vient du MOTEUR, qui mémorise la
 * réponse sous le `requestId` — d'où le test central : l'identifiant est IDENTIQUE sur tous les
 * essais. Sans ça, le mémo ne matche jamais et le rejeu redevient une double exécution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { postWebApp, WEBAPP_ESSAIS, WEBAPP_ATTENTES_MS } from '../src/google';
import { chargerConfigServeur } from '../src/config';

const CONFIG = { spreadsheetId: 's', webappUrl: 'https://script.google.com/macros/s/X/exec', webappSecret: 'sec' };
const REJOUABLE = { rejouable: true } as const;

/** `corps` string ⇒ illisible (page HTML servie en GET) ; objet ⇒ JSON. */
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

describe('postWebApp — le rejeu, et ce qui le rend sûr', () => {
  it('LE test central : le `requestId` est IDENTIQUE sur tous les essais', async () => {
    // C'est lui qui porte la garantie d'exécution unique. Un identifiant régénéré à chaque essai
    // ferait manquer le mémo du moteur et transformerait le rejeu en double facturation Sonnet.
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse(404, 'Sorry, unable to open the file at this time.'))
      .mockResolvedValueOnce(reponse(200, { ok: true, reponse: 'voici' }));
    vi.stubGlobal('fetch', faux);
    await postWebApp('chat-assistant', { historique: [] }, { ...REJOUABLE, attendre });
    const corps = faux.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(corps).toHaveLength(2);
    expect(corps[0].requestId).toBeTruthy();
    expect(corps[1].requestId).toBe(corps[0].requestId); // ← mutation : régénérer l'id ⇒ tombe
    expect(corps[0].requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/); // la grammaire qu'exige le moteur
    expect(corps[1].historique).toEqual([]);                      // …et le corps métier est intact
  });

  it('404 puis 200 : la demande ABOUTIT, en DEUX appels réseau', async () => {
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse(404, 'Sorry, unable to open the file at this time.'))
      .mockResolvedValueOnce(reponse(200, { ok: true, reponse: 'voici' }));
    vi.stubGlobal('fetch', faux);
    const data = await postWebApp<{ ok: boolean; reponse?: string }>('chat-assistant', {}, { ...REJOUABLE, attendre });
    expect(data.reponse).toBe('voici');
    expect(faux).toHaveBeenCalledTimes(2);
    expect(attentes).toEqual([WEBAPP_ATTENTES_MS[0]]);
  });

  it('le rejeu ATTEND VRAIMENT : le 2ᵉ appel ne part pas avant que l’attente soit résolue', async () => {
    // 🟠 revue : la version précédente de ce test empilait `ms` de façon synchrone, si bien que
    // remplacer `await attendre(...)` par `void attendre(...)` la laissait VERTE. On instrumente
    // donc le CHEMIN (l'ordre des événements), pas la valeur.
    const verrous: Array<() => void> = [];
    const bloquante = () => new Promise<void>((r) => { verrous.push(r); });
    const faux = vi.fn(async () => reponse(503, 'indisponible'));
    vi.stubGlobal('fetch', faux);
    const promesse = postWebApp('chat-assistant', {}, { ...REJOUABLE, attendre: bloquante })
      .catch(() => 'échec attendu');
    const respirer = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    await respirer();
    expect(faux).toHaveBeenCalledTimes(1); // ← mutation : `void attendre(...)` ⇒ 3 appels d'un coup
    // On libère les attentes UNE PAR UNE : chaque essai suivant doit rester derrière la sienne.
    for (let n = 2; n <= WEBAPP_ESSAIS; n++) {
      expect(verrous.length, `attente ${n - 1} posée`).toBe(n - 1);
      verrous[n - 2]();
      await respirer();
      expect(faux, `essai ${n} seulement après son attente`).toHaveBeenCalledTimes(n);
    }
    await promesse;
  });

  it('TOUTES les pannes de livraison se rejouent, pas seulement le 404', async () => {
    // 🟠 revue : le corpus ne contenait que le statut que l'auteur croyait sûr. Un 502/504 arrive
    // typiquement APRÈS le démarrage du script — c'est précisément le cas que le mémo couvre.
    for (const statut of [404, 429, 500, 502, 503, 504]) {
      const faux = vi.fn()
        .mockResolvedValueOnce(reponse(statut, 'panne'))
        .mockResolvedValueOnce(reponse(200, { ok: true }));
      vi.stubGlobal('fetch', faux);
      const data = await postWebApp<{ ok: boolean }>('chat-assistant', {}, { ...REJOUABLE, attendre });
      expect(data.ok, `statut ${statut}`).toBe(true);
      expect(faux, `statut ${statut}`).toHaveBeenCalledTimes(2);
    }
  });

  it('un 200 ILLISIBLE se rejoue aussi — servi en GET, donc `doPost` n’a pas tourné', async () => {
    // Écart ASSUMÉ avec le premier jet, qui le classait « permanent » : l'incident prod du
    // 2026-07-08 (`sync-drive.yml`) le range parmi les transitoires, et le rejeu l'a résolu.
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse(200, '<!DOCTYPE html><title>Script function not found: doGet</title>'))
      .mockResolvedValueOnce(reponse(200, { ok: true }));
    vi.stubGlobal('fetch', faux);
    const data = await postWebApp<{ ok: boolean }>('chat-assistant', {}, { ...REJOUABLE, attendre });
    expect(data.ok).toBe(true);
    expect(faux).toHaveBeenCalledTimes(2);
  });

  it('un réseau coupé se rejoue, et la DERNIÈRE erreur remonte telle quelle si tout échoue', async () => {
    const faux = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, { ...REJOUABLE, attendre })).rejects.toThrow(/Failed to fetch/);
    expect(faux).toHaveBeenCalledTimes(WEBAPP_ESSAIS);
  });

  it('un JSON propre `ok:false` ne se rejoue PAS — budget ou config sont permanents', async () => {
    const faux = vi.fn(async () => reponse(200, { ok: false, erreur: 'Budget du jour atteint' }));
    vi.stubGlobal('fetch', faux);
    const data = await postWebApp<{ ok: boolean; erreur?: string }>('chat-assistant', {}, { ...REJOUABLE, attendre });
    expect(data.ok).toBe(false);
    expect(data.erreur).toBe('Budget du jour atteint'); // rendu TEL QUEL : l'UI distingue budget et panne
    expect(faux).toHaveBeenCalledTimes(1);              // ← mutation : rejouer sur ok:false ⇒ 3
  });

  it('`rejouable: false` ⇒ UN seul essai, et le message d’origine mot pour mot', async () => {
    // Le défaut du dépôt (`api/mcp/_commun.ts`) est « ne pas rejouer » ; ici il n'y a même pas de
    // défaut — chaque appelant tranche, un oubli ne compile pas.
    const faux = vi.fn(async () => reponse(404, 'Sorry'));
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, { rejouable: false, attendre })).rejects.toThrow('Web app 404');
    expect(faux).toHaveBeenCalledTimes(1);
    expect(attentes).toEqual([]);
  });

  it('échec total : le message garde CHAQUE cause traversée, pas seulement la dernière', async () => {
    // §9 : « un verdict d'incertitude doit persister la CAUSE qu'il vient d'écraser ». Sans ça,
    // 404, 404 puis page HTML ne parlait plus que de redéploiement — et les deux 404 disparaissaient.
    const faux = vi.fn()
      .mockResolvedValueOnce(reponse(404, 'Sorry'))
      .mockResolvedValueOnce(reponse(503, 'Sorry'))
      .mockResolvedValueOnce(reponse(200, '<html>Script function not found: doGet</html>'));
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, { ...REJOUABLE, attendre }))
      .rejects.toThrow(/HTTP 404.*HTTP 503.*illisible/);
    expect(faux).toHaveBeenCalledTimes(WEBAPP_ESSAIS);
  });

  it('les essais sont DÉRIVÉS de la table d’attentes — aucun index à borner', async () => {
    // 🟡 revue : le clamp faisait mentir un test qui avait l'air dérivé des constantes.
    expect(WEBAPP_ESSAIS).toBe(WEBAPP_ATTENTES_MS.length + 1);
    const faux = vi.fn(async () => reponse(503, 'x'));
    vi.stubGlobal('fetch', faux);
    await expect(postWebApp('chat-assistant', {}, { ...REJOUABLE, attendre })).rejects.toThrow();
    expect(attentes).toEqual(WEBAPP_ATTENTES_MS); // toutes les attentes, aucune répétée
  });

  it('TRIPWIRE — un seul chemin réseau vers `/exec` dans toute l’app', async () => {
    // 🟠 revue : compter une FORME de template literal dans UN fichier ne prouve rien — un futur
    // appelant qui écrit `const u = webappUrl; fetch(u, …)` passait au travers. On scanne tout
    // `app/src` et on compte les fichiers qui NOMMENT `webappUrl` près d'un `fetch(`.
    const racine = new URL('../src/', import.meta.url);
    const fichiers: string[] = [];
    const parcourir = (dir: URL) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) parcourir(new URL(`${e.name}/`, dir));
        else if (/\.(ts|tsx)$/.test(e.name)) fichiers.push(readFileSync(new URL(e.name, dir), 'utf8'));
      }
    };
    parcourir(racine);
    // `webappUrl` SEUL ne suffit pas comme filtre : `config.ts` le nomme (c'est lui qui le reçoit
    // de `/api/config`) sans jamais appeler `/exec`. Ce qui identifie un émetteur, c'est de bâtir
    // l'URL gardée par le secret partagé.
    const emetteurs = fichiers.filter((f) => /webappUrl/.test(f) && /fetch\(/.test(f) && /secret=/.test(f));
    expect(emetteurs.length, 'un seul fichier émet vers /exec').toBe(1);
    const g = emetteurs[0];
    const helper = g.slice(g.indexOf('export async function postWebApp'), g.indexOf('export async function rechercheIA'));
    expect(helper).toContain('await fetch(url');
    // …et les trois appelants tranchent EXPLICITEMENT leur rejouabilité.
    expect(g).toMatch(/'recherche-ia', \{ question \}, \{ rejouable: true \}/);
    expect(g).toMatch(/'chat-assistant', \{ historique \}, \{ rejouable: true \}/);
    expect(g).toMatch(/demandeWebApp\('pas-suspect', \{ threadId \}, true\)/);
  });
});

describe('les contrats publics que le refactor devait préserver', () => {
  it('le chat : `ok:false` porte encore le compteur de budget sur l’erreur', async () => {
    const { envoyerMessageChat } = await import('../src/google');
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { ok: false, erreur: 'Budget', coutJour: 1.2, plafond: 1 })));
    await expect(envoyerMessageChat([])).rejects.toMatchObject({ message: 'Budget', coutJour: 1.2, plafond: 1 });
  });

  it('la recherche : un plan absent rend le message métier, pas un texte technique', async () => {
    const { rechercheIA } = await import('../src/google');
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { ok: true })));
    await expect(rechercheIA('facture hydro')).rejects.toThrow('recherche IA indisponible');
  });

  it('« pas suspect » : le message du moteur remonte, avec son repli', async () => {
    const { marquerPasSuspect } = await import('../src/google');
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { ok: true })));
    expect(await marquerPasSuspect('fil1')).toBe('demande programmée');
    vi.stubGlobal('fetch', vi.fn(async () => reponse(200, { ok: true, message: 'fil re-trié' })));
    expect(await marquerPasSuspect('fil1')).toBe('fil re-trié');
  });
});
