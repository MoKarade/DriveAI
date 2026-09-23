'use strict';
/**
 * test/comptes-memoire.test.js — CE QUE LA MÉMOIRE EN A FAIT (23/09/2026).
 *
 * Marc, devant l'onglet « Lecture » : « manque aussi des infos sur ce qui est validé
 * SÉPARÉMENT par driveai et memory ai ». Le moteur savait dire ce qu'il avait ENVOYÉ, rien de
 * ce que c'était DEVENU.
 *
 * Ce que ces cas défendent, et ce qui doit rougir si on les défait :
 *   1. une réponse incomplète rend `null`, JAMAIS des zéros — « la mémoire est vide » est le
 *      plus alarmant des faits, et ce serait publié sur un simple changement de contrat ;
 *   2. les trois états de la ligne (jamais lue / indisponible / connue) restent distincts :
 *      un déploiement en retard et une coupure réseau n'appellent pas le même geste ;
 *   3. l'horodatage de tentative est posé AVANT l'appel — sinon une Mémoire injoignable est
 *      re-sondée à CHAQUE tick, c'est-à-dire exactement quand il ne faut pas insister ;
 *   4. le CODE HTTP est publié, pas « erreur » : 401 est un geste de Marc, 503 passera seul ;
 *   5. l'espacement tient : un chiffre qui bouge aux heures ne se relit pas 288 fois par jour.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const REPONSE = {
  app: 'memoryai',
  faits: { valides: 343, aValider: 0, canaris: 0, migresEnPiece: 2646, dernierValideLe: null },
  papiers: { total: 2748, lus: 590, importesSeulement: 2158 },
  informations: 3091,
  gele: false,
};

const QUAND = Date.parse('2026-09-23T20:00:00.000Z');

/** Un contexte avec des Properties en mémoire et un `UrlFetchApp` scriptable. */
function ctx(reponse, initiales) {
  const store = new Map(Object.entries(initiales || {}));
  const appels = [];
  // ⚠️ UN SEUL objet de Properties : il sert au moteur (via `getScriptProperties`) ET aux cas
  // qui appellent `rafraichirComptesMemoire_` directement. Deux copies du même littéral
  // divergeraient au premier ajout d'une méthode, et le test lirait un autre registre que
  // celui dans lequel le moteur a écrit.
  const props = {
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { store.set(k, String(v)); },
  };
  const c = load(['Config.gs', 'Consolidation.gs', 'Gmail.gs', 'Journal.gs', 'Memoire.gs'], {
    PropertiesService: { getScriptProperties: () => props },
    UrlFetchApp: {
      fetch: (url, opts) => {
        appels.push({ url, opts });
        if (reponse instanceof Error) throw reponse;
        return {
          getResponseCode: () => reponse.code,
          getContentText: () => reponse.texte,
        };
      },
    },
  });
  return { c, store, appels, props };
}

const OK = { code: 200, texte: JSON.stringify(REPONSE) };

test('encodage : les cinq nombres, dans une forme que l’app parse', () => {
  const { c } = ctx(OK);
  assert.strictEqual(
    c.encoderComptesMemoire_(REPONSE, QUAND),
    '343/0/2646|2748/590|0|2026-09-23T20:00',
  );
});

test('UNE RÉPONSE INCOMPLÈTE REND `null`, jamais une ligne de zéros', () => {
  const { c } = ctx(OK);
  // Le contrat d'en face peut changer ; `Number(undefined) || 0` transformerait ce changement
  // en « la mémoire s'est vidée » — un fait, et le plus alarmant possible.
  assert.strictEqual(c.encoderComptesMemoire_({ faits: {}, papiers: {} }, QUAND), null);
  assert.strictEqual(c.encoderComptesMemoire_(null, QUAND), null);
  const sansLus = { faits: REPONSE.faits, papiers: { total: 2748 } };
  assert.strictEqual(c.encoderComptesMemoire_(sansLus, QUAND), null);
  // Un nombre non fini ou négatif n'est pas un compte.
  const fou = { faits: { ...REPONSE.faits, valides: -1 }, papiers: REPONSE.papiers };
  assert.strictEqual(c.encoderComptesMemoire_(fou, QUAND), null);
});

test('le gel est encodé, pas perdu', () => {
  const { c } = ctx(OK);
  const gele = { faits: REPONSE.faits, papiers: REPONSE.papiers, gele: true };
  assert.ok(c.encoderComptesMemoire_(gele, QUAND).indexOf('|1|') !== -1);
});

test('TROIS ÉTATS DISTINCTS : jamais lue, indisponible, connue', () => {
  const { c } = ctx(OK);
  assert.match(c.ligneComptesMemoire_(''), /jamais lue/);
  assert.match(c.ligneComptesMemoire_(null), /jamais lue/);
  assert.match(c.ligneComptesMemoire_('!HTTP 401'), /indisponible — HTTP 401/);
  assert.strictEqual(c.ligneComptesMemoire_('343/0/2646|2748/590|0|2026-09-23T20:00'),
    '343/0/2646|2748/590|0|2026-09-23T20:00');
});

test('espacement : jamais lue → on lit ; dans la fenêtre → non ; au-delà → oui', () => {
  const { c } = ctx(OK);
  assert.strictEqual(c.comptesMemoireARelire_(null, QUAND, 1800000), true);
  assert.strictEqual(c.comptesMemoireARelire_(QUAND - 60000, QUAND, 1800000), false);
  assert.strictEqual(c.comptesMemoireARelire_(QUAND - 1800000, QUAND, 1800000), true);
});

test('succès : la Property porte l’encodage, et UN SEUL appel réseau', () => {
  const { c, store, appels, props } = ctx(OK, { DriveAI_MEMORYAI_TOKEN: 'jeton' });
  c.rafraichirComptesMemoire_(
    props,
    QUAND,
  );
  assert.strictEqual(appels.length, 1);
  assert.match(appels[0].url, /\/api\/etat$/);
  assert.strictEqual(appels[0].opts.headers.Authorization, 'Bearer jeton');
  assert.strictEqual(store.get('DriveAI_MEMOIRE_COMPTES'), '343/0/2646|2748/590|0|2026-09-23T20:00');
});

test('L’HORODATAGE EST POSÉ AVANT L’APPEL — une Mémoire injoignable n’est pas re-sondée à chaque tick', () => {
  const { c, store, appels, props } = ctx(new Error('réseau coupé'), { DriveAI_MEMORYAI_TOKEN: 'jeton' });
  c.rafraichirComptesMemoire_(props, QUAND);
  assert.strictEqual(store.get('DriveAI_MEMOIRE_COMPTES'), '!réseau');
  assert.strictEqual(store.get('DriveAI_MEMOIRE_COMPTES_LE'), String(QUAND));
  // Le contrôle qui compte : la tentative suivante, dans la fenêtre, ne part PAS.
  c.rafraichirComptesMemoire_(props, QUAND + 60000);
  assert.strictEqual(appels.length, 1, 'un échec ne doit pas rouvrir la porte au tick suivant');
});

test('le CODE HTTP est publié — 401 est un geste de Marc, 503 passera tout seul', () => {
  for (const code of [401, 503]) {
    const { c, store, props } = ctx({ code, texte: '' }, { DriveAI_MEMORYAI_TOKEN: 'jeton' });
    c.rafraichirComptesMemoire_(
      props,
      QUAND,
    );
    assert.strictEqual(store.get('DriveAI_MEMOIRE_COMPTES'), '!HTTP ' + code);
  }
});

test('un 200 ILLISIBLE n’écrit pas de zéros : il se nomme', () => {
  const { c, store, props } = ctx({ code: 200, texte: 'pas du json' }, { DriveAI_MEMORYAI_TOKEN: 'jeton' });
  c.rafraichirComptesMemoire_(
    props,
    QUAND,
  );
  assert.strictEqual(store.get('DriveAI_MEMOIRE_COMPTES'), '!réponse illisible');
});

test('SANS JETON : aucun appel, et aucune ligne « indisponible » qui se lirait comme une panne', () => {
  const { c, store, appels, props } = ctx(OK, {});
  c.rafraichirComptesMemoire_(
    props,
    QUAND,
  );
  assert.strictEqual(appels.length, 0);
  assert.strictEqual(store.has('DriveAI_MEMOIRE_COMPTES'), false);
});

test('la ligne de Santé est bien composée par Journal.gs', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'Journal.gs'), 'utf8');
  // ⚠️ Le préfixe est le CONTRAT avec l'app : elle lit la ligne par son nom. Le changer d'un
  // côté seulement rend la jauge muette sans qu'aucune erreur ne paraisse.
  assert.ok(src.indexOf("['Mémoire — comptes : ' + texteSanteComptesMemoire_()]") !== -1,
    'la ligne « Mémoire — comptes » doit être écrite par la Santé');
});
