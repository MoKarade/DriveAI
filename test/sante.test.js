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
  // `Doublons.gs` : la ligne « Doublons (validation par empreinte) » (ADR-0047) appelle
  // `texteSanteDoublons_`. Sans lui, `majSante_` lèverait — et surtout ce mock DOIT exposer
  // `getLastRow` (cf. ci-dessous), sinon on exercerait le chemin d'ERREUR de cette ligne en croyant
  // valider le chemin nominal : c'est exactement le piège corrigé plus haut pour la ligne Tri Gmail.
  // `Main.gs` : la ligne « Historique Gmail » (C28-99) appelle `texteSanteHistoGmail_`. Même
  // exigence que pour `Doublons.gs` — le charger POUR DE VRAI, sinon on exercerait son catch en
  // croyant valider le chemin nominal.
  // `Gmail.gs` : `texteSanteHistoGmail_` date son compteur du jour avec `dateGmail_` — la MÊME
  // fonction que la campagne, sinon la clé du jour ne correspondrait pas et le compteur lirait 0.
  // `Reset.gs` : la ligne interroge `resetEnCours_` — le reset est la TROISIÈME cause de suspension
  // de la campagne (gate `gResetEnCours`). Chargé POUR DE VRAI plutôt que mocké : un `typeof ===
  // 'function'` masquerait la dépendance, et c'est précisément ce genre de garde qui a fait qu'un
  // chemin d'ERREUR a longtemps été pris pour le chemin nominal dans ce fichier.
  const ctx = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'GoogleApi.gs', 'TriGmail.gs', 'Doublons.gs',
    'Gmail.gs', 'Reset.gs', 'Main.gs', 'Journal.gs'], { PropertiesService: mockProps() });
  const captured = [];
  // feuille_ mocké : capture l'unique setValues de « Santé » ; `getLastRow: 1` = rapport des
  // doublons encore vide (état réel avant la première passe de la campagne).
  ctx.feuille_ = () => ({
    getLastRow: () => 1,
    getRange: () => ({ setValues: (rows) => rows.forEach((r) => captured.push(r[0])) }),
  });
  if (indexCache !== undefined) ctx._indexCache = indexCache;
  return { ctx, captured };
}

test('majSante_ écrit exactement 9 lignes de métadonnées (une seule écriture Sheet)', () => {
  const { ctx, captured } = chargerAvecSanteMock({ 'a|1': true, 'b|2': true });
  ctx.majSante_();
  assert.strictEqual(captured.length, 9);
  assert.ok(captured.every((l) => typeof l === 'string'));
});

test('majSante_ : la ligne « Historique Gmail » dit l\'état ET les minutes consommées (C28-99)', () => {
  // Pourquoi cette ligne existe : la campagne historique réserve 20 min/j — le plus gros bloc de
  // l'enveloppe de runtime — et n'était visible NULLE PART (le registre de suivi C28-44 est saturé,
  // elle ne pouvait pas y prendre une 43ᵉ clé). Sans ce chiffre, réallouer ses minutes serait une
  // SUPPOSITION, et §1.6 l'interdit : « ne pas déclarer une campagne finie sans lire son compteur ».
  // Mutation : retirer la ligne de `majSante_` ⇒ ce test tombe.
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Historique Gmail') === 0);
  assert.ok(ligne, 'la ligne existe');
  assert.ok(!ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  // Campagne PAS terminée (aucune Property dans le mock) : elle doit le dire, avec son avancement
  // et les minutes du jour — jamais « terminée » par défaut (un échec fermé dans le bon sens).
  assert.ok(/en cours/.test(ligne), ligne);
  // ⚠️ Le COMPTE de fils n'est volontairement PAS répété ici : l'onglet Progression le porte déjà,
  // et de façon MONOTONE (l'offset brut repart à 0 aux passes de vérification — c'est une position
  // de scan, pas un cumul). Deux surfaces, deux conversions du même fait : le défaut que §9
  // interdit. Ce qui est neuf, ce sont les DEUX compteurs de quota du jour.
  assert.ok(!/fils parcourus/.test(ligne), 'pas de second compteur de fils divergent : ' + ligne);
  // ⚠️ DÉRIVÉ de CONFIG, pas recopié. La version précédente écrivait `/des 20 min/` en dur tout en
  // affirmant l'inverse dans son message : mutation jouée en revue, remplacer le calcul par '20'
  // laissait le test VERT — et le jour où les 20 min sont réallouées (l'objectif même du lot) il
  // serait tombé en accusant le code. Même patron que la cadence de sonde, plus bas dans ce fichier.
  assert.ok(/des 20 min\/j/.test(ligne) && /des 150 fils\/j/.test(ligne), ligne);
});

test('texteSanteHistoGmail_ : les deux plafonds DÉRIVENT de CONFIG, et les CLÉS de Property sont les bonnes', () => {
  // Deux trous mesurés en revue, sur la même ligne. (a) Les assertions comparaient à « 20 » et
  // « 150 » — les valeurs du jour : remplacer le calcul par une constante en dur laissait tout
  // VERT, et le jour où les 20 min sont réallouées le test serait tombé en accusant le code. On
  // FORCE donc des valeurs de CONFIG improbables. (b) Aucun test n'exerçait les CLÉS : les
  // renommer (`_JOUR` → `_DATE`) laissait 1282 tests verts — alors qu'une clé qui ne correspond
  // pas à celle qu'écrit la campagne afficherait 0 EN PERMANENCE, c'est-à-dire exactement le faux
  // « elle ne consomme rien » que toute cette ligne existe pour empêcher.
  const { ctx } = chargerAvecSanteMock({});
  ctx.CONFIG = Object.assign({}, ctx.CONFIG,
    { GMAIL_HISTO_BUDGET_JOUR_MS: 7 * 60 * 1000, GMAIL_HISTO_MAX_FILS_JOUR: 42 });
  // Les clés sont écrites ici EXACTEMENT comme `traiterGmailHistorique_` les écrit.
  const props = {
    DriveAI_GMAIL_HISTO_JOUR: ctx.dateGmail_(new Date()),
    DriveAI_GMAIL_HISTO_MS_JOUR: String(5 * 60 * 1000),
    DriveAI_GMAIL_HISTO_FILS_JOUR: '45',
  };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) };
  const t = ctx.texteSanteHistoGmail_();
  assert.ok(t.includes('5 des 7 min/j'), 'minutes lues à la bonne clé et budget dérivé : ' + t);
  assert.ok(t.includes('45 des 42 fils/j'), 'fils lus à la bonne clé et plafond dérivé : ' + t);

  // …et un compteur d'HIER ne doit pas être lu comme celui d'aujourd'hui (la clé de jour sert).
  props.DriveAI_GMAIL_HISTO_JOUR = '2020-01-01';
  const perime = ctx.texteSanteHistoGmail_();
  assert.ok(perime.includes('0 des 7 min/j') && perime.includes('0 des 42 fils/j'), perime);
});

test('texteSanteHistoGmail_ : terminée ⇒ elle DIT que ses minutes sont réallouables', () => {
  // C'est le signal qui débloquera la réallocation des 20 min (C28-99, reste ouvert) : il doit être
  // explicite, pas à déduire. Mutation : rendre « terminée » sans le compteur ⇒ ce test tombe.
  const { ctx } = chargerAvecSanteMock({});
  const props = { DriveAI_GMAIL_HISTO: 'terminé', DriveAI_GMAIL_HISTO_OFFSET: '4210' };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) };
  const t = ctx.texteSanteHistoGmail_();
  assert.ok(/termin/.test(t), t);
  assert.ok(t.includes(Math.round(ctx.CONFIG.GMAIL_HISTO_BUDGET_JOUR_MS / 60000) + ' min/j sont RÉALLOUABLES'), t);

  // ⚠️ ÉCHEC FERMÉ, et c'est la moitié qui compte. Une lecture d'état en panne ne doit JAMAIS
  // rendre « terminée » : ce texte est précisément ce sur quoi on s'appuiera pour réallouer
  // 20 min/j. Un catch optimiste ferait libérer le budget d'une campagne encore vivante — le
  // symétrique exact du 🔴 `ascendance-illisible` de C28-93 (une panne n'est pas un verdict).
  // Mutation : rendre « terminée ✅ » depuis le catch ⇒ cette assertion tombe.
  ctx.PropertiesService = { getScriptProperties: () => { throw new Error('Properties indisponible'); } };
  ctx.journalErreur_ = () => {};
  const panne = ctx.texteSanteHistoGmail_();
  assert.ok(!/termin/.test(panne), 'une panne de lecture ne conclut jamais « terminée » : ' + panne);
  assert.ok(/illisible/.test(panne), panne);
});

test('texteSanteHistoGmail_ : SUSPENDUE ≠ « ne consomme rien » — le piège que la ligne doit fermer', () => {
  // 🟠 de la revue : la campagne sort AVANT de consommer sa première milliseconde quand le quota
  // Gmail est épuisé ou que le frein des campagnes mord. Elle affichait alors « en cours · 0 min »,
  // et la lecture naturelle de ce 0 — celle que l'ADR annonce — est « elle ne s'en sert pas, prends
  // ses 20 minutes ». Le jour où Marc redescend `LLM_BUDGET_CAMPAGNES` à 10 (ce que §1.6 lui demande
  // de faire), ce faux signal deviendrait permanent. Mutation : remettre le statut binaire
  // terminé/en cours ⇒ ce test tombe.
  const { ctx } = chargerAvecSanteMock({});
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };

  ctx.estPanneGmail_ = () => true;
  ctx.budgetCampagnesAtteint_ = () => false;
  const quota = ctx.texteSanteHistoGmail_();
  assert.ok(/suspendu \(quota Gmail\)/.test(quota), quota);
  assert.ok(/ne PEUT pas consommer/.test(quota), 'le 0 min doit être EXPLICITEMENT désamorcé : ' + quota);

  ctx.estPanneGmail_ = () => false;
  ctx.budgetCampagnesAtteint_ = () => true;
  const frein = ctx.texteSanteHistoGmail_();
  assert.ok(/en pause \(frein budget\)/.test(frein), frein);
  assert.ok(/ne PEUT pas consommer/.test(frein), frein);

  // …et quand rien ne l'empêche, le 0 min veut DIRE quelque chose : pas d'avertissement.
  ctx.budgetCampagnesAtteint_ = () => false;
  const normal = ctx.texteSanteHistoGmail_();
  assert.ok(/en cours/.test(normal), normal);
  assert.ok(!/ne PEUT pas consommer/.test(normal), normal);
});

test('statutHistoGmail_ : la ligne de Santé CONSOMME la règle partagée, elle n\'en a pas de copie', () => {
  // Mutation jouée en revue : réintroduire une copie locale ternaire dans `texteSanteHistoGmail_`
  // laissait 1282 tests verts. Ce qui verrouille le PARTAGE, c'est une sentinelle — si la ligne
  // avait sa propre copie, elle ne la verrait pas.
  const { ctx } = chargerAvecSanteMock({});
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
  ctx.statutHistoGmail_ = () => 'SENTINELLE';
  assert.ok(ctx.texteSanteHistoGmail_().indexOf('SENTINELLE') === 0,
    'la ligne de Santé doit passer par `statutHistoGmail_` : ' + ctx.texteSanteHistoGmail_());
});

test('statutHistoGmail_ : UNE règle, deux consommateurs (Progression et Santé)', () => {
  // Le statut riche vivait en clair dans le pousseur de Progression ; la ligne de Santé en avait
  // écrit une version PAUVRE à côté. Deux formulations du même verdict divergent toujours (§9) :
  // la règle est extraite et partagée. Mutation : remettre une copie locale ⇒ ce test perd son sens
  // (à défaut de tomber, il documente l'invariant que la revue suivante doit vérifier).
  const { ctx } = chargerAvecSanteMock({});
  assert.strictEqual(ctx.statutHistoGmail_(true, true, true, true), 'terminé', 'terminé prime sur tout');
  assert.strictEqual(ctx.statutHistoGmail_(false, true, true, true), 'suspendu (quota Gmail)');
  assert.strictEqual(ctx.statutHistoGmail_(false, false, true, true), 'en pause (frein budget)');
  // 3ᵉ cause, oubliée de la première écriture : le reset suspend AUSSI la campagne (gate
  // `gResetEnCours`). Latente parce que `RESET_ACTIF` est false — mais c'est exactement le faux
  // « en cours · 0 min » que la ligne existe pour fermer.
  assert.strictEqual(ctx.statutHistoGmail_(false, false, false, true), 'suspendu (reset en cours)');
  assert.strictEqual(ctx.statutHistoGmail_(false, false, false, false), 'en cours');
});

test('majSante_ : la ligne « Doublons » exerce le chemin NOMINAL, pas le catch (ADR-0047)', () => {
  // Le commentaire du harnais nomme le piège ; sans assertion, rien ne le vérifie. Prouvé par
  // mutation : en retirant `getLastRow` du mock, la ligne devient « ⚠️ état illisible (TypeError…) »
  // et les autres tests restent TOUS verts — on validerait le catch en croyant valider le nominal.
  // C'est le même défaut que la ligne « Tri Gmail » avait avant son test dédié, juste en dessous.
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Doublons') === 0);
  assert.ok(ligne, 'la ligne existe');
  assert.ok(!ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  assert.ok(ligne.includes('inventaire'), 'campagne pas encore lancée → phase inventaire : ' + ligne);
});

test('majSante_ : la ligne « Tri Gmail » distingue NORMAL, création SUSPENDUE et À L\'ARRÊT (ADR-0043 → ADR-0049)', () => {
  const ligneTri = (cfg) => {
    const { ctx, captured } = chargerAvecSanteMock({});
    ctx.estPanneConfigApi_ = () => cfg.config;
    ctx.estPannePlateforme_ = () => cfg.llm;
    ctx.majSante_();
    return captured.find((l) => l.indexOf('Tri Gmail') === 0);
  };

  const ok = ligneTri({ config: false, llm: false });
  assert.ok(ok && ok.includes('✅'), 'hors panne : tri normal annoncé');

  // ADR-0049 : une panne config-api ne suspend plus que la CRÉATION Tâches/Agenda — l'analyse et
  // l'archivage continuent. La ligne doit dire « normal » ET rappeler la suspension de création,
  // sans JAMAIS annoncer un « mode DÉGRADÉ » qui n'a plus de chemin vivant (no-fake-data).
  const cfgApi = ligneTri({ config: true, llm: false });
  assert.ok(cfgApi.includes('✅'), 'le tri est normal sous une panne de config : ' + cfgApi);
  assert.ok(!cfgApi.includes('DÉGRADÉ') && !cfgApi.includes('AUCUN archivage'),
    'ne plus annoncer un mode qui ne peut plus se produire : ' + cfgApi);
  assert.ok(cfgApi.includes('création') && cfgApi.includes('suspendue'), 'la suspension de création est dite : ' + cfgApi);
  assert.ok(cfgApi.includes('important'), 'et le fait que l\'analyse continue aussi : ' + cfgApi);

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
  assert.ok(!t.includes('intentions mail suspendues') && t.includes('création'), 'ADR-0049 : seule la CRÉATION est suspendue, la ligne le dit : ' + t);
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

/* ---------- C28-58 : l'onglet `Coûts` (écriture + effacement du reliquat) ---------- */

test('majCouts_ : écrit total + postes, et EFFACE le reliquat du mois précédent', () => {
  // Le patron « setValues puis clearContent du reliquat » a déjà mordu deux fois (C28-45, C28-53) :
  // sans l'effacement, d'anciennes lignes survivent SOUS les nouvelles et l'onglet ment.
  const ctx = load(['Config.gs', 'Cout.gs', 'Journal.gs'], { PropertiesService: mockProps() });
  const ecrits = [];
  let efface = null;
  let dernRang = 12; // l'onglet contenait 11 lignes de données le mois dernier
  ctx.feuille_ = () => ({
    getRange: (rang, col, nb) => ({
      setValues: (rows) => { ecrits.push({ rang, nb, rows }); },
      clearContent: () => { efface = { rang, nb }; },
    }),
    getLastRow: () => dernRang,
  });
  ctx.syntheseCoutMois_ = () => ({ appels: 10, dollars: 3 });
  ctx.lireCoutMois_ = () => ({ ops: { 'tri-gmail': { d: 2, n: 8 } } });

  ctx.majCouts_();
  assert.strictEqual(ecrits.length, 1, 'UNE seule écriture Sheet par tick');
  assert.strictEqual(ecrits[0].rang, 2, 'écrit sous l\'en-tête');
  const rows = JSON.parse(JSON.stringify(ecrits[0].rows));
  assert.ok(String(rows[0][0]).indexOf('TOTAL LLM') === 0);
  assert.strictEqual(rows[1][0], 'tri-gmail');
  assert.ok(efface, 'le reliquat des mois plus fournis est effacé');
  assert.strictEqual(efface.rang, rows.length + 2, 'effacement à partir de la 1re ligne périmée');

  // Onglet plus court que ce qu'on écrit : rien à effacer, et surtout aucun clearContent négatif.
  ecrits.length = 0; efface = null; dernRang = 1;
  ctx.majCouts_();
  assert.strictEqual(efface, null, 'aucun effacement inutile');
});
