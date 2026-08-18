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
  // `GoogleApi.gs` : `majSante_` lit désormais l'état de panne de config d'API (C28-48).
  const ctx = load(['Config.gs', 'Cout.gs', 'GoogleApi.gs', 'Journal.gs'], { PropertiesService: mockProps() });
  const captured = [];
  // feuille_('Santé') mocké : capture l'unique setValues (6 lignes × 1 colonne).
  ctx.feuille_ = () => ({ getRange: () => ({ setValues: (rows) => rows.forEach((r) => captured.push(r[0])) }) });
  if (indexCache !== undefined) ctx._indexCache = indexCache;
  return { ctx, captured };
}

test('majSante_ écrit exactement 6 lignes de métadonnées (une seule écriture Sheet)', () => {
  const { ctx, captured } = chargerAvecSanteMock({ 'a|1': true, 'b|2': true });
  ctx.majSante_();
  assert.strictEqual(captured.length, 6);
  assert.ok(captured.every((l) => typeof l === 'string'));
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
