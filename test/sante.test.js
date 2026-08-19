'use strict';
/**
 * Onglet Santé (ADR-0006) + invariant vie privée (ADR-0007) — `majSante_` ne doit écrire
 * QUE des métadonnées : horodatage, COMPTEUR de l'Index (pas les clés), coût agrégé, statut.
 * Jamais un nom de fichier, une clé de cache ou un corps de document.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** PropertiesService mocké : aucune Property (coût du mois = 0). */
function mockProps() {
  return {
    getScriptProperties: () => ({
      getProperty: () => null,
      setProperty: () => {},
      deleteProperty: () => {},
    }),
  };
}

function chargerAvecSanteMock(indexCache) {
  // `GoogleApi.gs` : `majSante_` lit l'état de panne de config d'API (C28-48). `Llm.gs` et
  // `TriGmail.gs` : la ligne « Tri Gmail » (ADR-0043) interroge `estPannePlateforme_` et
  // `estPanneConfigApi_`. Sans eux, le contexte par défaut exerçait le chemin d'ERREUR au lieu du
  // chemin nominal — un test qui valide le catch en croyant valider le cas normal (revue flotte).
  const ctx = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'GoogleApi.gs', 'TriGmail.gs', 'Journal.gs'],
    { PropertiesService: mockProps() });
  const captured = [];
  // feuille_('Santé') mocké : capture l'unique setValues (6 lignes × 1 colonne).
  ctx.feuille_ = () => ({ getRange: () => ({ setValues: (rows) => rows.forEach((r) => captured.push(r[0])) }) });
  if (indexCache !== undefined) ctx._indexCache = indexCache;
  return { ctx, captured };
}

test('majSante_ écrit exactement 7 lignes de métadonnées (une seule écriture Sheet)', () => {
  const { ctx, captured } = chargerAvecSanteMock({ 'a|1': true, 'b|2': true });
  ctx.majSante_();
  assert.strictEqual(captured.length, 7);
  assert.ok(captured.every((l) => typeof l === 'string'));
});

test('majSante_ : la ligne « Tri Gmail » distingue NORMAL, DÉGRADÉ et À L\'ARRÊT (ADR-0043)', () => {
  const ligneTri = (cfg) => {
    const { ctx, captured } = chargerAvecSanteMock({});
    ctx.estPanneConfigApi_ = () => cfg.config;
    ctx.estPannePlateforme_ = () => cfg.llm;
    ctx.majSante_();
    return captured.find((l) => l.indexOf('Tri Gmail') === 0);
  };

  const ok = ligneTri({ config: false, llm: false });
  assert.ok(ok && ok.includes('✅'), 'hors panne : tri normal annoncé');

  // Panne config-api : le tri TOURNE, en mode dégradé — il faut le dire ET dire sa conséquence,
  // sinon « ça marche » masque « ça n'archive plus » et la dette reste invisible.
  const deg = ligneTri({ config: true, llm: false });
  assert.ok(deg.includes('DÉGRADÉ'), 'le mode est nommé');
  assert.ok(deg.includes('AUCUN archivage'), 'la CONSÉQUENCE est dite, pas seulement l\'état');
  assert.ok(deg.includes('ré-évalués'), 'et le rattrapage automatique aussi');

  // Panne de compte LLM : `Main.gs` saute l'étape `tri-gmail` ENTIÈRE. Annoncer « libellés posés »
  // serait un MENSONGE sur le seul canal que Marc lit (revue flotte C28-54, les deux agents).
  for (const cfg of [{ config: false, llm: true }, { config: true, llm: true }]) {
    const arret = ligneTri(cfg);
    assert.ok(arret.includes('ARRÊT'), 'panne LLM : le tri est à l\'ARRÊT, pas dégradé');
    assert.ok(!arret.includes('libellés posés'), 'et surtout : ne pas prétendre qu\'il travaille');
  }

  // État ILLISIBLE : on ne prétend RIEN — surtout pas « ✅ normal ». (Ce chemin était MORT :
  // `intentionsSuspendues_` avale ses exceptions, donc l'ancienne version affichait « normal ».)
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.estPannePlateforme_ = () => { throw new Error('Properties HS'); };
  ctx.majSante_();
  const flou = captured.find((l) => l.indexOf('Tri Gmail') === 0);
  assert.ok(flou.includes('indéterminé'), 'état illisible → aucune affirmation');
  assert.ok(!flou.includes('✅'), 'et surtout pas un vert rassurant');
});

test('majSante_ : sans panne de config, la ligne API annonce des API actives (C28-48)', () => {
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('API Tasks & Calendar') === 0);
  assert.ok(ligne, 'la ligne API est présente');
  assert.ok(ligne.includes('✅'), 'aucune panne → état vert');
});

test('texteSanteConfigApi_ (PURE) : en panne, dit POURQUOI (projet GCP) et QUAND ça se re-sondera', () => {
  const ctx = load(['Config.gs', 'Cout.gs', 'GoogleApi.gs', 'Journal.gs'], { PropertiesService: mockProps() });
  const t = ctx.texteSanteConfigApi_({
    actif: true,
    depuisMs: Date.UTC(2026, 7, 14, 11, 51),
    message: 'Calendar — Google Calendar API has not been used in project 987654321 before',
  }, 'UTC');
  assert.ok(t.includes('INDISPONIBLES'), 'titre neutre sur la cause (API non activée OU compte hubperso non lié — ADR-0041)');
  assert.ok(t.includes('14/08 11:51'), 'depuis quand');
  assert.ok(t.includes('project 987654321'), 'le projet GCP — ce qui distingue « pas activée » de « autre projet »');
  // Cadence DÉRIVÉE de la CONFIG (leçon §7) : codée « 15 min » en dur, l'assertion mentirait au
  // premier rajustement du réglage.
  const cadence = Math.round(ctx.CONFIG.PANNE_CONFIG_SONDE_MS / 60000) + ' min';
  assert.ok(t.includes(cadence), 'la reprise est automatique, Marc n\'a rien à relancer');

  // HONNÊTETÉ : hors panne, on n'affirme « opérationnelles » que si une SONDE l'a vérifié.
  const jamaisSonde = ctx.texteSanteConfigApi_({ actif: false }, 'UTC');
  assert.ok(jamaisSonde.includes('✅') && jamaisSonde.includes('aucune panne détectée'));
  assert.ok(!jamaisSonde.includes('opérationnelle'), 'jamais une affirmation sans preuve');
  const sonde = ctx.texteSanteConfigApi_({ actif: false, sondeOkMs: Date.UTC(2026, 7, 14, 12, 4) }, 'UTC');
  assert.ok(sonde.includes('sondées le 14/08 12:04'), 'le constat est daté par la sonde qui l\'a établi');
  assert.ok(ctx.texteSanteConfigApi_(null, 'UTC').includes('✅'), 'état illisible → pas de fausse alarme');
});

test('majSante_ écrit le COMPTE de l\'Index, jamais les clés (aucune fuite de nom/clé)', () => {
  // Une clé qui ressemble à un nom de fichier sensible : elle ne doit JAMAIS apparaître dans Santé.
  const { ctx, captured } = chargerAvecSanteMock({ 'passeport-secret.pdf|999': true, 'autre': true });
  ctx.majSante_();
  const flat = JSON.stringify(captured);
  assert.ok(!flat.includes('passeport-secret'), 'aucune clé/contenu du cache dans l\'onglet Santé');
  assert.ok(flat.includes('Documents au catalogue (Index) : 2'), 'écrit le compte (2), pas les clés');
});

test('majSante_ : cache non chargé (null) → "—", pas d\'erreur', () => {
  const { ctx, captured } = chargerAvecSanteMock(null);
  assert.doesNotThrow(() => ctx.majSante_());
  assert.ok(JSON.stringify(captured).includes('—'));
});

test('majSante_ : coût affiché à 0.00 $ quand aucune Property (jamais NaN/undefined)', () => {
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligneCout = captured.find((l) => l.indexOf('Coût LLM') === 0);
  assert.ok(ligneCout && ligneCout.includes('0.00 $'), 'coût numérique formaté, pas NaN');
});
