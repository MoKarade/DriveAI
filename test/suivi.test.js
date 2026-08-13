'use strict';
/**
 * suivi.test.js — fondations du suivi GÉNÉRIQUE des opérations du tick (C28-44, ADR-0038,
 * Suivi.gs). Verrouille : le registre (clés uniques, historiques préservées), le wrapper
 * `etapeSuivie_` (gates dans l'ordre + court-circuit, tentative ≠ succès, erreur vue AVANT le
 * catch custom, erreur RE-LEVÉE telle quelle sans catch), et le codec Property (tolérance,
 * fusion champ à champ, purge hors-registre, PLAFOND DÉRIVÉ du registre — leçon §7 ~9 Ko).
 */
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() { return load(['Suivi.gs']); }

/* ---------- REGISTRE_OPERATIONS ---------- */

test('registre : clés uniques et non vides, libellés FR non vides, types dans l\'ensemble autorisé', () => {
  const c = ctx();
  const ops = c.REGISTRE_OPERATIONS;
  assert.ok(ops.length >= 30, 'le registre couvre TOUTES les étapes du tick (~30), pas 6');
  const cles = new Set();
  const types = new Set(['flux', 'campagne', 'maintenance', 'demande', 'observabilite']);
  for (const o of ops) {
    assert.ok(o.cle && typeof o.cle === 'string');
    assert.ok(!cles.has(o.cle), 'clé en double : ' + o.cle);
    cles.add(o.cle);
    assert.ok(o.libelle && o.libelle.length > 3, 'libellé vide pour ' + o.cle);
    assert.ok(types.has(o.type), 'type inconnu pour ' + o.cle + ' : ' + o.type);
    assert.ok(typeof o.unite === 'string', 'unité absente pour ' + o.cle);
  }
});

test('registre : les 6 clés HISTORIQUES de Progression sont préservées à l\'identique (continuité app)', () => {
  const c = ctx();
  const cles = new Set(c.clesRegistreSuivi_());
  for (const historique of ['migration', 'reanalyse', 'histo-gmail', 'rangement', 'consolidation-gen', 'consolidation-exec']) {
    assert.ok(cles.has(historique), 'clé historique perdue : ' + historique);
  }
});

/* ---------- etapeSuivie_ (wrapper) ---------- */

test('etapeSuivie_ : premier gate non-null → skip enregistré avec sa raison, fn JAMAIS exécutée, gates suivantes JAMAIS évaluées', () => {
  const c = ctx();
  c.suiviReset_();
  const appels = [];
  c.etapeSuivie_('tri-gmail', [
    () => { appels.push('g1'); return null; },
    () => { appels.push('g2'); return 'budget de tick épuisé'; },
    () => { appels.push('g3'); return null; }, // ne doit JAMAIS être évaluée (coût : un comptage Drive reste dernier)
  ], () => { appels.push('fn'); });
  assert.deepStrictEqual(appels, ['g1', 'g2'], 'court-circuit au premier gate non-null');
  const vue = c.suiviOpsFusionne_({ getProperty: () => null });
  assert.strictEqual(vue['tri-gmail'].s, 'budget de tick épuisé');
  assert.ok(vue['tri-gmail'].st > 0);
  assert.strictEqual(vue['tri-gmail'].t, 0, 'aucune tentative — l\'étape n\'a pas tourné');
});

test('etapeSuivie_ : succès → tentative ET succès posés (deux horodatages distincts), durée ≥ 0', () => {
  const c = ctx();
  c.suiviReset_();
  let executions = 0;
  c.etapeSuivie_('intake-depots', [() => null], () => { executions++; });
  assert.strictEqual(executions, 1);
  const e = c.suiviOpsFusionne_({ getProperty: () => null })['intake-depots'];
  assert.ok(e.t > 0, 'tentative enregistrée');
  assert.ok(e.ok >= e.t, 'succès enregistré, jamais avant la tentative');
  assert.ok(e.d >= 0);
});

test('etapeSuivie_ : erreur AVec onErreur → enregistrée (message tronqué) PUIS catch custom appelé avec l\'erreur — jamais re-levée', () => {
  const c = ctx();
  c.suiviReset_();
  const boom = new Error('x'.repeat(200));
  let recue = null;
  c.etapeSuivie_('intentions', [], () => { throw boom; }, (err) => { recue = err; });
  assert.strictEqual(recue, boom, 'le catch custom reçoit l\'erreur ORIGINALE');
  const e = c.suiviOpsFusionne_({ getProperty: () => null })['intentions'];
  assert.ok(e.et > 0, 'erreur enregistrée AVANT le catch custom (l\'enregistreur englobe, ne s\'empile pas)');
  assert.strictEqual(e.e.length, c.SUIVI_ERR_MAX, 'message tronqué à SUIVI_ERR_MAX');
  assert.strictEqual(e.ok, 0, 'pas de faux succès');
});

test('etapeSuivie_ : erreur SANS onErreur → enregistrée ET RE-LEVÉE telle quelle (étapes nues de l\'intake : sémantique du tick inchangée)', () => {
  const c = ctx();
  c.suiviReset_();
  const boom = new Error('panne API');
  assert.throws(() => c.etapeSuivie_('intake-gmail', [], () => { throw boom; }),
    (err) => err === boom, 'la MÊME erreur remonte (identité d\'objet)');
  const e = c.suiviOpsFusionne_({ getProperty: () => null })['intake-gmail'];
  assert.strictEqual(e.e, 'panne API');
});

/* ---------- statutDepuisSuivi_ (PR3 — statut des opérations sans lecteur de campagne) ---------- */

test('statutDepuisSuivi_ : jamais vue / en cours / en pause / suspendu / désactivée / erreur — le DERNIER événement gagne, erreur prioritaire à égalité', () => {
  const c = ctx();
  assert.strictEqual(c.statutDepuisSuivi_(null), 'jamais vue');
  assert.strictEqual(c.statutDepuisSuivi_({}), 'jamais vue');
  assert.strictEqual(c.statutDepuisSuivi_({ t: 100, ok: 101 }), 'en cours');
  assert.strictEqual(c.statutDepuisSuivi_({ st: 200, s: 'budget de tick épuisé' }), 'en pause (budget de tick épuisé)');
  assert.strictEqual(c.statutDepuisSuivi_({ st: 200, s: 'frein budget campagnes' }), 'en pause (frein budget campagnes)',
    '« budget » en position NON-préfixe compte aussi (revue PR3 : un frein budget est une pause, jamais une « panne »)');
  assert.strictEqual(c.statutDepuisSuivi_({ st: 200, s: 'reset en cours' }), 'suspendu (reset en cours)');
  assert.strictEqual(c.statutDepuisSuivi_({ st: 200, s: 'désactivée (CONFIG)' }), 'désactivée');
  assert.strictEqual(c.statutDepuisSuivi_({ ok: 100, et: 200, e: 'boom' }), 'erreur', 'l\'erreur est plus récente');
  assert.strictEqual(c.statutDepuisSuivi_({ ok: 300, et: 200, e: 'boom' }), 'en cours', 'le succès est plus récent que l\'erreur');
  assert.strictEqual(c.statutDepuisSuivi_({ ok: 200, et: 200, e: 'boom' }), 'erreur', 'à ÉGALITÉ, l\'erreur prime (prudence)');
});

/* ---------- Codec Property (tolérance, fusion, purge, plafond) ---------- */

test('chargerSuiviOps_ : Property absente ou JSON illisible → {} sans throw (l\'observabilité ne casse jamais rien)', () => {
  const c = ctx();
  // (Object.keys plutôt que deepStrictEqual : les objets construits dans le contexte vm ont
  // d'autres prototypes que ceux de l'hôte — patron `plain()` du harness.)
  assert.strictEqual(Object.keys(c.chargerSuiviOps_({ getProperty: () => null })).length, 0);
  assert.strictEqual(Object.keys(c.chargerSuiviOps_({ getProperty: () => '{pas du json' })).length, 0);
});

test('fusionnerSuiviOps_ : les champs du run priment, les autres SURVIVENT ; le message d\'erreur suit SON horodatage', () => {
  const c = ctx();
  const persiste = { migration: { t: 100, ok: 100, d: 5, et: 50, e: 'vieille erreur', st: 0, s: '' } };
  // Run : nouvelle tentative + nouvelle erreur, pas de succès → le succès d'hier survit,
  // le message d'erreur est REMPLACÉ (il suit son horodatage et), la durée d'hier survit.
  const run = { migration: { t: 200, et: 210, e: 'nouvelle erreur' } };
  const f = c.fusionnerSuiviOps_(persiste, run, ['migration']);
  assert.strictEqual(f.migration.t, 200);
  assert.strictEqual(f.migration.ok, 100, 'le dernier succès (hier) survit');
  assert.strictEqual(f.migration.d, 5, 'la durée suit le succès');
  assert.strictEqual(f.migration.et, 210);
  assert.strictEqual(f.migration.e, 'nouvelle erreur');
  // Run inverse : succès sans erreur → l'ancienne erreur reste visible (elle n'est pas effacée
  // par un simple run vert — Marc doit pouvoir voir « dernière erreur : il y a 2 h »).
  const f2 = c.fusionnerSuiviOps_(persiste, { migration: { t: 300, ok: 301, d: 1 } }, ['migration']);
  assert.strictEqual(f2.migration.e, 'vieille erreur');
  assert.strictEqual(f2.migration.ok, 301);
  assert.strictEqual(f2.migration.d, 1, 'la durée suit le NOUVEAU succès');
});

test('fusionnerSuiviOps_ : clés hors registre PURGÉES, clés jamais vécues jamais inscrites (borne par construction)', () => {
  const c = ctx();
  const persiste = { 'vieille-etape-retiree': { t: 1, ok: 1, d: 0, et: 0, e: '', st: 0, s: '' } };
  const f = c.fusionnerSuiviOps_(persiste, {}, ['migration', 'reanalyse']);
  assert.deepStrictEqual(Object.keys(f), [], 'ni la clé retirée (purgée), ni les clés jamais vécues');
});

test('codec : round-trip encoder → charger identique (via props factice)', () => {
  const c = ctx();
  const etat = {
    migration: { t: 111, ok: 222, d: 33, et: 44, e: 'err', st: 55, s: 'raison' },
    'tri-gmail': { t: 9, ok: 0, d: 0, et: 0, e: '', st: 0, s: '' },
  };
  const encode = c.encoderSuiviOps_(etat);
  const relu = c.chargerSuiviOps_({ getProperty: () => encode });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(relu)), etat);
});

test('PLAFOND DÉRIVÉ du registre (leçon §7 ~9 Ko) : TOUTES les étapes aux maxima → encodage < 8000 caractères ET < 8500 octets UTF-8', () => {
  const c = ctx();
  // Pire cas structurel : chaque clé du registre avec tous les horodatages à 13 chiffres et les
  // textes au MAXIMUM (caractères accentués = 2 octets UTF-8, pour mesurer l'octet réel).
  const etat = {};
  for (const cle of c.clesRegistreSuivi_()) {
    etat[cle] = {
      t: 1755097200000, ok: 1755097200000, d: 999999, et: 1755097200000,
      e: 'é'.repeat(c.SUIVI_ERR_MAX), st: 1755097200000, s: 'é'.repeat(c.SUIVI_SKIP_MAX),
    };
  }
  const encode = c.encoderSuiviOps_(etat);
  // Dérivé de la CONSTANTE (taille du registre × maxima), jamais de la valeur du jour : si le
  // registre grossit ou si les troncatures augmentent, ce test recalcule le pire cas tout seul
  // et échoue AVANT que la Property ne dépasse ~9 Ko en prod (setProperty lèverait en boucle).
  assert.ok(encode.length < 8000, 'encodage ' + encode.length + ' caractères ≥ 8000');
  assert.ok(Buffer.byteLength(encode, 'utf8') < 8500, 'encodage ' + Buffer.byteLength(encode, 'utf8') + ' octets ≥ 8500');
});

test('suiviOpsFusionne_ + flusherSuiviOps_ : la vue fusionne persisté + run courant ; le flush écrit EXACTEMENT cette vue', () => {
  const c = ctx();
  c.suiviReset_();
  c.etapeSuivie_('migration', [], () => {});
  const persiste = c.encoderSuiviOps_({ reanalyse: { t: 7, ok: 8, d: 1, et: 0, e: '', st: 0, s: '' } });
  const ecrits = {};
  const props = { getProperty: () => persiste, setProperty: (k, v) => { ecrits[k] = v; } };
  const vue = c.suiviOpsFusionne_(props);
  assert.ok(vue.migration.ok > 0, 'le run courant est dans la vue');
  assert.strictEqual(vue.reanalyse.ok, 8, 'le persisté survit dans la vue');
  c.flusherSuiviOps_(props);
  const plain = (x) => JSON.parse(JSON.stringify(x)); // realm vm ≠ hôte (patron du harness)
  assert.deepStrictEqual(plain(c.chargerSuiviOps_({ getProperty: () => ecrits.DriveAI_SUIVI_OPS })),
    plain(vue), 'flush = la même vue fusionnée, ni plus ni moins');
});

test('suiviTexte_ (via le wrapper) : `"` `\\` et contrôles NEUTRALISÉS avant troncature — l\'échappement JSON ne gonfle jamais l\'encodage', () => {
  const c = ctx();
  c.suiviReset_();
  const hostile = '"a"\\b\nc\td' + 'x'.repeat(100);
  c.etapeSuivie_('migration', [], () => { const e = new Error(hostile); throw e; }, () => {});
  c.suiviSkip_('reanalyse', hostile);
  const vue = c.suiviOpsFusionne_({ getProperty: () => null });
  assert.ok(!/["\\\n\t]/.test(vue.migration.e), 'caractères échappables remplacés dans le message d\'erreur');
  assert.strictEqual(vue.migration.e.length, c.SUIVI_ERR_MAX);
  assert.ok(!/["\\\n\t]/.test(vue.reanalyse.s), 'idem pour la raison de skip');
  assert.strictEqual(vue.reanalyse.s.length, c.SUIVI_SKIP_MAX, 'troncature skip appliquée (SUIVI_SKIP_MAX)');
  // La preuve qui compte : une fois encodé, chaque caractère du texte pèse EXACTEMENT 1 caractère
  // JSON (aucune séquence d'échappement \" \\ \n dans la chaîne produite).
  const encode = c.encoderSuiviOps_(vue);
  assert.ok(!encode.includes('\\'), 'aucun échappement dans l\'encodage : le plafond dérivé dit vrai');
});

test('encoderSuiviOps_ : neutralise AUSSI les textes hérités d\'une Property (défense en profondeur — ils n\'ont pas transité par le wrapper)', () => {
  const c = ctx();
  const etat = { migration: { t: 1, ok: 0, d: 0, et: 2, e: '"hostile"\n' + 'x'.repeat(100), st: 3, s: '\\'.repeat(60) } };
  const encode = c.encoderSuiviOps_(etat);
  assert.ok(!encode.includes('\\'), 'texte hérité borné et neutralisé au goulot d\'encodage');
  const relu = c.chargerSuiviOps_({ getProperty: () => encode });
  assert.strictEqual(relu.migration.e.length, c.SUIVI_ERR_MAX);
  assert.strictEqual(relu.migration.s.length, c.SUIVI_SKIP_MAX);
});

test('flusherSuiviOps_ : filet DUR — un encodage > 8 900 caractères dégrade en vidant les TEXTES, jamais un setProperty qui lève en boucle', () => {
  const c = ctx();
  c.suiviReset_();
  // Le filet est INATTEIGNABLE avec le vrai registre (le test au plafond le prouve) : on le
  // déclenche en gonflant artificiellement le registre du contexte. 80 étapes factices : au-dessus
  // de 8 900 avec les textes, en dessous une fois vidés — le filet ne borne que la part TEXTE, la
  // seule variable en pratique ; une croissance STRUCTURELLE du registre est attrapée bien avant
  // par le test au plafond dérivé (il échoue dès que le pire cas nominal dépasse).
  const gros = [];
  for (let i = 0; i < 80; i++) gros.push({ cle: 'etape-' + i, libelle: 'Étape ' + i, unite: '', type: 'maintenance' });
  c.REGISTRE_OPERATIONS = gros;
  const persiste = {};
  for (let i = 0; i < 80; i++) {
    persiste['etape-' + i] = [1755097200000, 1755097200000, 9, 1755097200000, 'e'.repeat(40), 1755097200000, 's'.repeat(28)];
  }
  assert.ok(JSON.stringify(persiste).length > 8900, 'pré-condition : le filet a bien quelque chose à dégrader');
  const ecrits = {};
  c.flusherSuiviOps_({ getProperty: () => JSON.stringify(persiste), setProperty: (k, v) => { ecrits[k] = v; } });
  const stocke = ecrits.DriveAI_SUIVI_OPS;
  assert.ok(stocke.length <= 8900, 'sous la limite après dégradation (' + stocke.length + ')');
  const relu = c.chargerSuiviOps_({ getProperty: () => stocke });
  assert.strictEqual(relu['etape-0'].e, '', 'textes vidés');
  assert.strictEqual(relu['etape-0'].ok, 1755097200000, 'les horodatages — l\'essentiel — survivent');
});

test('suiviReset_ : efface l\'enregistrement du run précédent (deux ticks ne se mélangent jamais en mémoire)', () => {
  const c = ctx();
  c.suiviReset_();
  c.etapeSuivie_('migration', [], () => {});
  c.suiviReset_();
  const vue = c.suiviOpsFusionne_({ getProperty: () => null });
  assert.deepStrictEqual(Object.keys(vue), [], 'plus rien après reset (et rien de persisté)');
});
