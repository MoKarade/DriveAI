'use strict';
/**
 * C28-53 (ADR-0042) — actions /exec du connecteur MCP (src/Mcp.gs).
 *
 * Verrouille : le secret DÉDIÉ (fermé : non posé = désactivé, comparaison constante), le routage
 * doPost (jamais le tick par défaut pour une action mcp-*), les validations d'entrée FERMÉES,
 * la réutilisation des fonctions existantes (bornes héritées), le signal `versionMcp` sur TOUTE
 * réponse, et l'erreur CLAIRE quand le compte hubperso n'est pas lié (mcp-intention).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** Normalise un objet créé DANS le vm (prototypes différents → deepStrictEqual échoue sinon). */
const plain = (x) => JSON.parse(JSON.stringify(x));

/** Contexte Mcp.gs + dépendances mockées. */
function ctxMcp(props, mocks) {
  const c = load(['Config.gs', 'JetonHubperso.gs', 'Mcp.gs']);
  const store = Object.assign({}, props);
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: (k) => { delete store[k]; },
  }) };
  // anti-rafale RÉEL (WebApp.gs non chargé ici) : reproduit le patron sur le store mocké.
  c.antiRafalePilote_ = (cle, intervalle) => {
    const dernier = Number(store[cle]) || 0;
    if (Date.now() - dernier < intervalle) return false;
    store[cle] = String(Date.now());
    return true;
  };
  Object.assign(c, mocks || {});
  return { c, store };
}

/* ---------- secret dédié ---------- */

test('verifierSecretMcp_ : FERMÉ — Property absente = MCP désactivé, secret faux = refus, bon = accès', () => {
  const off = ctxMcp({});
  assert.strictEqual(off.c.verifierSecretMcp_({ parameter: { secret: 'nimporte' } }), false,
    'secret jamais posé ⇒ MCP désactivé (personne ne passe, pas même avec un secret « plausible »)');

  const on = ctxMcp({ DriveAI_MCP_SECRET: 's3cret-mcp' });
  assert.strictEqual(on.c.verifierSecretMcp_({ parameter: { secret: 'FAUX' } }), false);
  assert.strictEqual(on.c.verifierSecretMcp_({ parameter: {} }), false);
  assert.strictEqual(on.c.verifierSecretMcp_(null), false);
  assert.strictEqual(on.c.verifierSecretMcp_({ parameter: { secret: 's3cret-mcp' } }), true);

  const panne = ctxMcp({ DriveAI_MCP_SECRET: 's3cret-mcp' });
  panne.c.PropertiesService = { getScriptProperties: () => { throw new Error('quota'); } };
  assert.strictEqual(panne.c.verifierSecretMcp_({ parameter: { secret: 's3cret-mcp' } }), false,
    'Properties illisibles ⇒ refus (jamais un accès sur un doute)');
});

/* ---------- routage doPost : jamais le tick pour une action mcp-* ---------- */

test('doPost : action mcp-* → secret MCP ; secret faux = « refusé » SANS toucher au tick ni aux outils', () => {
  const c = load(['Config.gs', 'WebApp.gs']);
  const appels = [];
  c.verifierSecretMcp_ = () => false;
  c.actionMcp_ = (a) => { appels.push(a); return { ok: true }; };
  c.actionTickPonctuel_ = () => { appels.push('TICK'); return { ok: true }; };
  c.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => { } }) };
  c.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) };
  const refus = c.doPost({ parameter: { action: 'mcp-etat', secret: 'faux' } });
  assert.strictEqual(refus.ok, false);
  assert.strictEqual(refus.erreur, 'refusé');
  assert.deepStrictEqual(appels, [], 'ni actionMcp_ ni le tick par défaut ne sont atteints');

  c.verifierSecretMcp_ = () => true;
  const ok = c.doPost({ parameter: { action: 'mcp-recherche', secret: 'bon' } });
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(appels, ['mcp-recherche'], 'le routeur MCP reçoit l\'action, le tick jamais');
});

/* ---------- routeur + versionMcp ---------- */

test('actionMcp_ : versionMcp sur TOUTE réponse (succès, refus de rafale, action inconnue, EXCEPTION)', () => {
  const { c } = ctxMcp({}, { actionMcpEtat_: () => ({ ok: true, sante: [] }) });
  const ok = c.actionMcp_('mcp-etat', {});
  assert.strictEqual(ok.versionMcp, c.MCP_VERSION, 'signal indépendant (piège 4) sur le succès');
  const inconnue = c.actionMcp_('mcp-zzz', {});
  assert.strictEqual(inconnue.ok, false);
  assert.strictEqual(inconnue.versionMcp, c.MCP_VERSION);
  // Rafale : 2ᵉ appel immédiat de la MÊME action → refus, TOUJOURS versionné.
  const rafale = c.actionMcp_('mcp-etat', {});
  assert.strictEqual(rafale.ok, false);
  assert.ok(rafale.erreur.includes('trop de requêtes'));
  assert.strictEqual(rafale.versionMcp, c.MCP_VERSION);
  // EXCEPTION dans une action (blip Sheet/Drive) : versionMcp DOIT survivre (revue 🟠1) — sans le
  // try interne, l'exception remonterait au catch de doPost et rendrait {ok:false} SANS versionMcp,
  // que la passerelle lirait comme « version pas déployée ».
  const { c: c2 } = ctxMcp({}, { actionMcpReorg_: () => { throw new Error('appendRow Sheet KO'); } });
  const exc = c2.actionMcp_('mcp-reorg', { postData: { contents: '{"actions":[]}' } });
  assert.strictEqual(exc.ok, false);
  assert.ok(exc.erreur.includes('appendRow Sheet KO'), 'le message d\'erreur transite');
  assert.strictEqual(exc.versionMcp, c2.MCP_VERSION, 'versionMcp survit à l\'exception');
});

test('actionMcp_ : action INCONNUE n\'écrit AUCUNE Property (F2 — anti-saturation du store)', () => {
  const { c, store } = ctxMcp({});
  c.actionMcp_('mcp-nimporte-quoi-tres-long-' + 'x'.repeat(200), {});
  const clesRafale = Object.keys(store).filter((k) => k.indexOf('DriveAI_MCP_') === 0);
  assert.deepStrictEqual(clesRafale, [], 'une action inconnue ne crée jamais de clé d\'anti-rafale');
  // Contraste : une action CONNUE consomme bien sa fenêtre (le garde vit).
  c.actionMcp_('mcp-etat', {});
  assert.ok('DriveAI_MCP_mcp-etat' in store, 'une action connue arme bien son anti-rafale');
});

test('actionMcp_ : corps JSON malformé → corps vide → refus d\'entrée propre (jamais un plantage)', () => {
  const { c } = ctxMcp({});
  const r = c.actionMcp_('mcp-recherche', { postData: { contents: '{ pas du json' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.versionMcp, c.MCP_VERSION);
});

/* ---------- fonctions PURES de mcp-etat ---------- */

test('missionsDepuisProgression_ : mappe les 13 colonnes du contrat, ignore les lignes vides', () => {
  const { c } = ctxMcp({});
  const lignes = [
    ['cle1', 'Rangement 05', 40, 120, 'fichiers', 'en cours', 'h', 'reliquat 3', 'il y a 5 min', '', 'campagne', '12 hier', '~2 j'],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['cle2', 'Tri boîte', '', '', 'fils', 'à jour', 'h', '', '', 'HTTP 500', 'flux', '', ''],
  ];
  const m = c.missionsDepuisProgression_(lignes);
  assert.strictEqual(m.length, 2, 'la ligne vide est ignorée');
  assert.deepStrictEqual(plain(m[0]), {
    operation: 'Rangement 05', traites: 40, base: 120, unite: 'fichiers', statut: 'en cours',
    detail: 'reliquat 3', derniereActivite: 'il y a 5 min', derniereErreur: '', type: 'campagne',
    dernierePasse: '12 hier', finEstimee: '~2 j',
  });
  assert.strictEqual(m[1].traites, null, 'compteur absent = null, jamais 0 (une absence n\'est pas un zéro)');
  assert.strictEqual(m[1].derniereErreur, 'HTTP 500');
});

test('erreursDepuisJournal_ : les N DERNIÈRES erreurs, plus récentes d\'abord, dates ISO', () => {
  const { c } = ctxMcp({});
  const d1 = new Date('2026-08-18T10:00:00Z'), d2 = new Date('2026-08-18T11:00:00Z');
  const lignes = [
    [d1, 'ERREUR', 'Tasks', 'HTTP 403'],
    [d1, 'INFO', 'Santé', 'ok'],
    [d2, 'ERREUR', 'Calendar', 'HTTP 500'],
  ];
  const e = c.erreursDepuisJournal_(lignes, 10);
  assert.strictEqual(e.length, 2);
  assert.strictEqual(e[0].source, 'Calendar', 'la plus récente d\'abord');
  assert.strictEqual(e[0].date, d2.toISOString());
  assert.strictEqual(e[1].message, 'HTTP 403');
  assert.strictEqual(c.erreursDepuisJournal_(lignes, 1).length, 1, 'borne N respectée');
  assert.deepStrictEqual(plain(c.erreursDepuisJournal_([], 5)), []);
});

test('mailDepuisTelemetrie_ : mappe clé/valeur/unité/note, ignore les lignes vides', () => {
  const { c } = ctxMcp({});
  const t = c.mailDepuisTelemetrie_([
    ['quota_gmail_etat', 'actif', '', ''],
    ['tri_boite_fils_jour', 34, 'fils', 'Plafond 60/j'],
    ['', '', '', ''],
  ]);
  assert.strictEqual(t.length, 2);
  assert.deepStrictEqual(plain(t[1]), { cle: 'tri_boite_fils_jour', valeur: '34', unite: 'fils', note: 'Plafond 60/j' });
});

/* ---------- validations FERMÉES des entrées ---------- */

test('actionMcpRecherche_ : requête bornée, mode contenu → fullText, défaut → title', () => {
  const appels = [];
  const { c } = ctxMcp({}, { rechercheDriveChat_: (champ, q) => { appels.push([champ, q]); return '1 fichier'; } });
  assert.strictEqual(c.actionMcpRecherche_({}).ok, false);
  assert.strictEqual(c.actionMcpRecherche_({ requete: '   ' }).ok, false);
  assert.strictEqual(c.actionMcpRecherche_({ requete: 'x'.repeat(201) }).ok, false, 'au-delà de 200 : refus');
  assert.deepStrictEqual(appels, [], 'aucune recherche sur une entrée invalide');
  assert.strictEqual(c.actionMcpRecherche_({ requete: 'bail' }).ok, true);
  assert.deepStrictEqual(plain(appels[0]), ['title', 'bail'], 'défaut : par NOM');
  c.actionMcpRecherche_({ requete: 'hydro', mode: 'contenu' });
  assert.deepStrictEqual(plain(appels[1]), ['fullText', 'hydro']);
});

test('actionMcpLire_ : fileId whitelist stricte — jamais un id forgé vers la lecture', () => {
  const appels = [];
  const { c } = ctxMcp({}, { lireFichierChat_: (id) => { appels.push(id); return 'Contenu…'; } });
  for (const mauvais of [undefined, '', 'court', 'id avec espaces qui dépasse', "1zF'injection", 'x'.repeat(81)]) {
    assert.strictEqual(c.actionMcpLire_({ fileId: mauvais }).ok, false, 'refusé : ' + mauvais);
  }
  assert.deepStrictEqual(appels, []);
  const ok = c.actionMcpLire_({ fileId: '1zFTPL9iADzjJ83F4keX2zaZ9myXBPB-k' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.contenu, 'Contenu…');
});

test('actionMcpReorg_ : actions[] requis ; le reste passe par la whitelist PURE existante', () => {
  const appels = [];
  const { c } = ctxMcp({}, { proposerReorgChat_: (input) => { appels.push(input); return 'J\'ai proposé 1 opération(s)…'; } });
  assert.strictEqual(c.actionMcpReorg_({}).ok, false);
  assert.strictEqual(c.actionMcpReorg_({ actions: [] }).ok, false);
  assert.deepStrictEqual(appels, []);
  const ok = c.actionMcpReorg_({ actions: [{ type: 'renommer', source: 'id1', nom: 'Nouveau' }] });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(appels.length, 1, 'délégué à proposerReorgChat_ (validation + écriture « proposé »)');
});

test('actionMcpIntention_ : validations fermées, échéance AAAA-MM-JJ seulement, bornes de longueur', () => {
  const appels = [];
  const { c } = ctxMcp({}, { creerTache_: (t, e, n) => { appels.push([t, e, n]); return 'task-1'; } });
  assert.strictEqual(c.actionMcpIntention_({}).ok, false);
  assert.strictEqual(c.actionMcpIntention_({ type: 'tache' }).ok, false, 'titre requis');
  assert.strictEqual(c.actionMcpIntention_({ type: 'autre', titre: 'x' }).ok, false, 'type whitelist');
  const ok = c.actionMcpIntention_({ type: 'tache', titre: '  Payer Hydro  ', echeance: '2026-09-01', notes: 'n' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.id, 'task-1');
  assert.deepStrictEqual(plain(appels[0]), ['Payer Hydro', '2026-09-01', 'n']);
  c.actionMcpIntention_({ type: 'tache', titre: 'X', echeance: '01/09/2026' });
  assert.strictEqual(appels[1][1], '', 'échéance mal formée → IGNORÉE (jamais passée brute à l\'API)');
});

test('actionMcpIntention_ : branche ÉVÉNEMENT — dateHeure transmise, durée par défaut, échec géré', () => {
  const appels = [];
  const { c } = ctxMcp({}, { creerEvenement_: (t, dh, d, n) => { appels.push([t, dh, d, n]); return dh ? 'evt-1' : ''; } });
  const ok = c.actionMcpIntention_({ type: 'evenement', titre: 'RDV', dateHeure: '2026-09-01T14:00:00' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.cree, 'evenement');
  assert.deepStrictEqual(plain(appels[0]), ['RDV', '2026-09-01T14:00:00', 60, ''], 'durée défaut 60');
  // dateHeure absente → creerEvenement_ rend '' (format refusé côté moteur) → erreur claire, pas un plantage.
  const ko = c.actionMcpIntention_({ type: 'evenement', titre: 'RDV sans date' });
  assert.strictEqual(ko.ok, false);
  assert.ok(ko.erreur.includes('AAAA-MM-JJTHH'));
});

test('actionMcpEtat_ : expose la panne PLATEFORME LLM à la MÊME fenêtre que la décision (revue 🟠3)', () => {
  // Panne FRAÎCHE (< LLM_PANNE_RESONDE_MS) → suspendu ; panne PÉRIMÉE → non suspendu. C'est LE
  // scénario « le moteur tourne mais rien ne se classe » que le checkup mail doit montrer.
  const frais = ctxMcp({ DriveAI_LLM_PANNE: String(Date.now() - 1000) }, {
    feuille_: () => { throw new Error('onglets non pertinents ici'); },
    etatPanneConfigApi_: () => ({ actif: false }),
  });
  assert.strictEqual(frais.c.actionMcpEtat_().llmSuspendu, true);

  const perime = ctxMcp({ DriveAI_LLM_PANNE: String(Date.now() - 100 * 3600 * 1000) }, {
    feuille_: () => { throw new Error('onglets non pertinents ici'); },
    etatPanneConfigApi_: () => ({ actif: false }),
  });
  assert.strictEqual(perime.c.actionMcpEtat_().llmSuspendu, false, 'panne périmée = plus suspendu (pas de mensonge)');
});

test('actionMcpIntention_ : compte hubperso non lié → erreur CLAIRE, jamais un plantage ni une suspension', () => {
  const { c, store } = ctxMcp({}, {
    creerTache_: () => { throw new Error('config-api Tasks : compte hubperso non lié — exécuter lierCompteHubperso (docs/HUBPERSO.md)'); },
  });
  const r = c.actionMcpIntention_({ type: 'tache', titre: 'Payer Hydro' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.erreur.includes('compte hubperso non lié'), 'le message actionnable transite tel quel');
  assert.ok(!('DriveAI_PANNE_CONFIG_API' in store), 'un échec MCP ne pose JAMAIS la suspension du moteur');
});

test('actionMcpEtat_ : une section illisible dégrade SA section, jamais toute la réponse', () => {
  const { c } = ctxMcp({}, {
    feuille_: (nom) => {
      if (nom === 'Santé') throw new Error('Sheet indisponible');
      return {
        getLastRow: () => 3, getLastColumn: () => 13,
        getRange: () => ({ getValues: () => [
          ['c', 'Tri boîte', 1, 2, 'fils', 'en cours', 'h', '', '', '', 'flux', '', ''],
          ['c2', '', '', '', '', '', '', '', '', '', '', '', ''],
        ] }),
      };
    },
    etatPanneConfigApi_: () => ({ actif: true, message: 'hubperso — compte non lié', sonde: 'indetermine (Tasks) — HTTP 400' }),
  });
  const r = c.actionMcpEtat_();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sante, null, 'section Santé dégradée…');
  assert.ok(r.santeErreur.includes('Sheet indisponible'), '…et l\'erreur est EXPLICITE (jamais un faux vide)');
  assert.strictEqual(r.missions.length, 1, 'les autres sections vivent');
  assert.strictEqual(r.intentionsSuspendues, true);
  assert.ok(r.intentionsDetail.includes('hubperso'));
  // Le VERDICT de la sonde voyage aussi : « indetermine » à répétition = reprise qui tourne à vide
  // (vécu 19/08), invisible tant qu'on ne lisait que la cause mémorisée.
  assert.ok(r.intentionsSonde.includes('HTTP 400'), 'le verdict de la dernière sonde est exposé');
});
