'use strict';
/**
 * Onglet Santé (ADR-0006) + invariant vie privée (ADR-0007) — `majSante_` ne doit écrire
 * QUE des métadonnées : horodatage, COMPTEUR de l'Index (pas les clés), coût agrégé, statut.
 * Jamais un nom de fichier, une clé de cache ou un corps de document.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/** PropertiesService mocké : `props` posées, tout le reste null (coût du mois = 0). */
function mockProps(props) {
  const table = props || {};
  return {
    getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null),
      setProperty: (k, v) => { table[k] = String(v); },
      deleteProperty: (k) => { delete table[k]; },
    }),
  };
}

function chargerAvecSanteMock(indexCache, props) {
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
  // `Migration.gs` : `texteSanteReanalyse_` lit `budgetJourReanalyse_` — contrat INTER-MODULE.
  // Chargé POUR DE VRAI et non mocké : une mutation du nom doit tomber ici (elle a SURVÉCU à la
  // première écriture de ce test, qui ne sortait jamais de la branche « en attente »).
  // `Memoire.gs` : la ligne « Mémoire (inventaire) » (C28-135) appelle `texteSanteMemoire_`, qui
  // lit `budgetJourMemoire_` — même exigence inter-module que `Migration.gs` ci-dessus. Chargé
  // POUR DE VRAI : mocké, une mutation du nom survivrait, et c'est ce fichier qui est censé la
  // faire tomber.
  // `AuditPiece.gs` : la ligne « Audit des pièces » (C49-3) appelle `texteSanteAuditPiece_`, qui
  // lit `budgetJourAudit_`. Même exigence inter-module que les deux ci-dessus — et la même raison
  // de le charger POUR DE VRAI : cette ligne est le SEUL endroit d'où l'on voit que la porte de
  // l'ADR-0061 avance, et un catch pris pour le chemin nominal la rendrait muette sans rougir.
  // `PerimetrePiece.gs` : la ligne « Périmètre des pièces » (C49-4) appelle
  // `texteSantePerimetrePiece_`. Chargé POUR DE VRAI, pour la même raison que les trois
  // ci-dessus : mocké, une mutation du nom survivrait, et cette ligne est le seul endroit d'où
  // l'on voit le nombre qui DIMENSIONNE la campagne de lecture du Drive.
  // `RattrapagePiece.gs` : la ligne « Rattrapage des pièces » (C49-5) appelle
  // `texteSanteRattrapagePiece_`. Chargé POUR DE VRAI : c'est la seule surface d'où l'on voit
  // qu'une campagne qui DÉPENSE avance — et, quand elle n'avance pas, laquelle des six causes
  // (non armée, jeton, suspension, frein, audit en cours, budget du jour) la retient.
  const ctx = load(['Config.gs', 'Cout.gs', 'Llm.gs', 'GoogleApi.gs', 'TriGmail.gs', 'Doublons.gs',
    'Gmail.gs', 'Migration.gs', 'Memoire.gs', 'AuditPiece.gs', 'PerimetrePiece.gs', 'RattrapagePiece.gs', 'ResolutionFileId.gs', 'AvancementMemoire.gs', 'Reset.gs', 'Main.gs', 'Journal.gs'],
    { PropertiesService: mockProps(props) });
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

test('majSante_ écrit exactement 21 lignes de métadonnées (une seule écriture Sheet)', () => {
  // 10 depuis ADR-0056 : la re-datation de `06` rallume de la dépense LLM et son budget du jour
  // n'était lisible NULLE PART. Le compte est figé pour que l'ajout d'une ligne soit une DÉCISION —
  // l'écriture est unique par tick, et chaque ligne coûte de la place à l'écran de Marc.
  // 11 depuis C28-135 : l'envoi à la Mémoire n'écrivait RIEN quand il sortait sur son garde-temps
  // (16/09 : une heure de silence pour un canal qui venait d'accepter 2 348 faits). Même
  // justification que les trois lignes voisines — le registre de suivi C28-44 est saturé, la
  // campagne ne peut pas s'y déclarer, donc elle se dit ICI.
  // 12 depuis C49-2 bis : les PIÈCES sont un SECOND canal vers la Mémoire, et il tombe en panne
  // pour d'autres raisons que l'inventaire (celui-ci ne coûte aucun appel LLM, l'extraction en
  // coûte un par document). Les fondre en une ligne ferait lire le silence de l'un comme celui
  // de l'autre — ce que le compte figé est précisément là pour rendre délibéré.
  // 13 depuis C49-3 : l'audit des pièces est la PORTE de l'ADR-0061 (rien n'allume `PIECE_PUSH`
  // avant elle) et il tourne désormais tout seul dans le tick, sans que Marc lance quoi que ce
  // soit. Une campagne qui avance sans geste humain a d'autant plus besoin d'être lisible : sans
  // cette ligne, « elle progresse », « elle est finie » et « elle n'a jamais démarré » se lisent
  // tous les trois comme un onglet qui ne bouge pas.
  // 14 depuis C49-4 : le PÉRIMÈTRE répond à une autre question que l'audit — celui-ci dit si
  // l'extraction est bonne, celle-là sur COMBIEN de documents elle aurait à tourner. C'est ce
  // nombre qui dimensionne la campagne (durée, coût, budget à prélever) et il n'était mesuré
  // nulle part : « 20 346 » est le compte de l'Index, pas celui des papiers.
  // 15 depuis C49-5 : le RATTRAPAGE est la première campagne qui fait SORTIR du contenu de
  // documents vers un service extérieur, et elle tourne toute seule dans le tick. Elle ne
  // partage la ligne d'aucune voisine : le périmètre COMPTE (rien ne part), l'audit VÉRIFIE
  // (rien ne part non plus), celle-ci ENVOIE. Les fondre ferait lire « la mesure est faite »
  // comme « les papiers sont partis », ce qui n'est pas la même chose du tout pour Marc.
  // 17 depuis C49-14 : DEUX lignes, pas une, et la distinction est le sujet même du lot.
  // « Lecture — file » est STABLE (elle se relit à froid et dit quel dossier, dans quel
  // ordre, ce qui vient ensuite) ; « Lecture — en cours » est VOLATILE et PÉRIME au bout de
  // huit minutes. Les fondre ferait afficher un document « en cours » des heures après la
  // fin de la passe, c'est-à-dire fabriquer le faux état figé que ce lot existe pour tuer.
  // Marc, le 21/09 : « je sais pas ça traite quoi en ce moment, quel dossier, quel fichier,
  // quelle direction » — quatre questions dont aucune n'avait de réponse dans le moteur.
  // 18 depuis C49-16 : la RÉSOLUTION des identifiants ne partage la ligne d'aucune voisine. Le
  // périmètre COMPTE, le rattrapage ENVOIE, l'audit VÉRIFIE — celle-ci dit si un papier classé
  // est seulement DÉSIGNABLE. Sans elle, « ✅ tranche terminée » reste parfaitement vrai pendant
  // que 734 pièces jointes Gmail, classées depuis des mois, n'ont jamais pu partir : le
  // périmètre les écarte de son total (il l'annonce comme un PLANCHER) et le rattrapage ne sait
  // pas les nommer. Un écart que rien d'autre n'affiche.
  // 19 depuis C49-23 : « Import — file » est la SEULE forme que l'app a le droit de lire pour
  // dessiner la file d'import. Les deux nombres existaient déjà — dans la phrase de « Mémoire
  // (inventaire) » et dans celle du « Périmètre » — donc dans une prose qui se reformule au
  // premier lot qui la rend plus claire. Le dépôt a déjà tranché pour la lecture (« le format
  // lu est celui que le moteur ÉCRIT ») ; cette ligne applique la même règle à l'import.
  // Elle ne coûte aucune lecture de plus : les deux Properties sont déjà ouvertes à côté.
  // 20 depuis le 23/09/2026 : « Mémoire — comptes » dit ce que l'AUTRE app a fait de ce qu'on
  // lui a envoyé. Les dix-neuf lignes ci-dessus racontent toutes ce que le moteur ENVOIE ;
  // aucune ne dit ce que c'est DEVENU — d'où un écran où « 590 acceptées » et « 343 faits
  // validés » ne pouvaient pas coexister, et où la seconde grandeur semblait ne pas exister.
  // Marc, ce jour-là : « manque des infos sur ce qui est validé SÉPARÉMENT par driveai et
  // memory ai ». Elle ne partage la ligne d'aucune voisine parce qu'elle vient d'une AUTRE
  // source : la fondre avec « Import — file » ferait lire un compte de la Mémoire comme un
  // compte de DriveAI, et l'écart entre les deux — la seule chose qui s'explique — disparaît.
  // Elle ne coûte pas un appel réseau par tick : la lecture est espacée de 30 min
  // (`CONFIG.MEMOIRE_COMPTES_MIN_MS`) et la valeur publiée porte sa date.
  // 21 depuis C49-27 : « Mémoire — avancement » est le sens INVERSE de la ligne précédente —
  // ce que DriveAI POUSSE à la Mémoire pour son onglet Avancement (ADR 0009 de MemoryAI). Les
  // fondre ferait lire une écriture refusée par le contrat d'en face comme une lecture en panne,
  // alors que les deux se corrigent dans deux dépôts différents.
  const { ctx, captured } = chargerAvecSanteMock({ 'a|1': true, 'b|2': true });
  ctx.majSante_();
  assert.strictEqual(captured.length, 21);
  assert.ok(captured.some((l) => /^Mémoire — avancement : /.test(l)), captured.join(' | '));
  // ⚠️ Le COMPTE seul ne dirait pas QUELLE ligne a été ajoutée : une ligne retirée et une autre
  // posée laisseraient 19. La présence se vérifie donc à part, sur la forme ENCODÉE.
  assert.ok(captured.some((l) => /^Import — file : /.test(l)), captured.join(' | '));
  assert.ok(captured.some((l) => /^Mémoire — comptes : /.test(l)), captured.join(' | '));
  assert.ok(captured.every((l) => typeof l === 'string'));
});

test('majSante_ : la ligne « Re-datation de 06 » distingue « jamais démarrée » de « rien à faire »', () => {
  // Deux revues l'ont relevé indépendamment : rallumer ~8,6 $ de LLM sans aucun point
  // d'observation, c'est le mode de panne du §1.6 — c'est ainsi que C26-08 est restée en pause
  // deux semaines sans que personne ne le voie. Un « 0 min/j » tout seul ne dirait pas si la
  // campagne n'a rien à faire ou si elle n'est jamais ATTEINTE : les deux gardes amont (grand
  // rangement, migration) doivent se DIRE. Mutation : retirer la ligne de `majSante_` ⇒ tombe.
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Re-datation de 06') === 0);
  assert.ok(ligne, 'la ligne existe');
  assert.ok(!ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  // Le mock n'a aucune Property : la migration n'est donc PAS finie — la ligne doit le dire,
  // et surtout pas prétendre que la campagne tourne.
  assert.ok(/en attente/.test(ligne), ligne);
  assert.ok(!/en cours/.test(ligne), 'jamais « en cours » quand une garde amont bloque : ' + ligne);
});

test('C49-20 — la ligne « Re-datation de 06 » ARRÊTÉE garde son avancement à l\'écran', () => {
  // ⚠️ Les six autres suspensions sont TRANSITOIRES : leur cause est le sujet, et l'avancement
  // reviendra. Celle-ci est définitive et laisse 108 documents sur 466 derrière elle — « arrêtée »
  // tout court effacerait le seul chiffre qui dit ce qu'on a laissé en plan, et la question « où
  // ça en était ? » n'aurait plus de réponse NULLE PART (la Progression purge ses lignes finies
  // après 48 h).
  const { ctx, captured } = chargerAvecSanteMock({}, {});
  const p = ctx.PropertiesService.getScriptProperties();
  p.setProperty('DriveAI_RANGEMENT', ctx.CONFIG.RANGEMENT_TAG);
  p.setProperty('DriveAI_MIGRATION', ctx.CONFIG.MIGRATION_TAG);
  p.setProperty('DriveAI_REANALYSE_BASE', '466');
  p.setProperty('DriveAI_REANALYSE_TRAITES', '108');
  ctx.CONFIG.REANALYSE_ACTIF = false; // (le harnais rallume les campagnes arrêtées — cf. harness.js)
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Re-datation de 06') === 0);
  assert.ok(ligne && !ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  assert.match(ligne, /arrêtée \(CONFIG/, ligne);
  assert.match(ligne, /108 \/ 466 documents au moment de l'arrêt/, ligne);
});

test('majSante_ : la ligne « Re-datation de 06 » EXERCE sa branche « en cours » (avancement + minutes)', () => {
  // ⚠️ Ce test existe parce que le précédent ne prouvait RIEN de la branche nominale : sans
  // Properties, `texteSanteReanalyse_` sortait toujours sur « en attente ». Mutation jouée en revue
  // — renommer `budgetJourReanalyse_` (contrat INTER-MODULE, Migration.gs → Main.gs) — laissait
  // 1297 tests VERTS. Ici on pose les deux gardes amont à « fini » pour tomber dans la branche qui
  // lit les compteurs, et on asserte ce qu'elle produit.
  const { ctx, captured } = chargerAvecSanteMock({}, {});
  const p = ctx.PropertiesService.getScriptProperties();
  p.setProperty('DriveAI_RANGEMENT', ctx.CONFIG.RANGEMENT_TAG);
  p.setProperty('DriveAI_MIGRATION', ctx.CONFIG.MIGRATION_TAG);
  p.setProperty('DriveAI_REANALYSE_BASE', '328');
  p.setProperty('DriveAI_REANALYSE_TRAITES', '41');
  // Compteur du jour : la MÊME clé de jour que la campagne (`dateGmail_`), sinon on lirait 0 et le
  // test passerait en mesurant un zéro sans rapport.
  p.setProperty('DriveAI_REANALYSE_JOUR', ctx.dateGmail_(new Date()) + '|' + (3 * 60 * 1000));
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Re-datation de 06') === 0);
  assert.ok(ligne && !ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  assert.ok(/en cours/.test(ligne), ligne);
  assert.ok(/41 \/ 328 documents/.test(ligne), ligne);
  // DÉRIVÉ de CONFIG (jamais « 8 » recopié) : le jour où les minutes sont réallouées, ce test suit.
  const minJ = ctx.CONFIG.REANALYSE_BUDGET_JOUR_MS / 60000;
  assert.ok(new RegExp('3 des ' + minJ + ' min\\/j').test(ligne), ligne);
});

test('texteSanteReanalyse_ (C49-20) : une SUSPENSION survit à une lecture de Property qui LÈVE', () => {
  // ⚠️ Régression introduite par ce lot même, trouvée en revue de code. Le cas « arrêtée » a besoin
  // de l'avancement, donc il descend lire trois Properties — et le retour anticipé des SIX autres
  // suspensions était passé APRÈS elles. Conséquence : si une seule de ces lectures lève, le
  // `catch` rend « état illisible (…) » À LA PLACE de la cause, donc un frein budget ou une panne
  // de plateforme perd son diagnostic pour une raison qui n'a rien à voir avec lui. C'est le même
  // défaut que la §9 nomme ailleurs (« une panne n'est pas un verdict »), en sens inverse : ici
  // une panne de lecture EFFACE un verdict juste.
  // Mutation : redescendre le `if (suspension && CONFIG.REANALYSE_ACTIF) return suspension;`
  // sous les trois lectures ⇒ ce test tombe.
  const { ctx } = chargerAvecSanteMock({}, {});
  ctx.CONFIG = Object.assign({}, ctx.CONFIG, { REANALYSE_ACTIF: true });
  ctx.budgetCampagnesAtteint_ = () => true;          // une cause VRAIE, transitoire
  ctx.rangementTermine_ = () => true;
  ctx.resetEnCours_ = () => false;
  ctx.estPannePlateforme_ = () => false;
  ctx.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => {
        if (k === 'DriveAI_REANALYSE_BASE') throw new Error('Properties indisponible');
        if (k === 'DriveAI_MIGRATION') return ctx.CONFIG.MIGRATION_TAG;
        return null;
      },
    }),
  };
  const t = ctx.texteSanteReanalyse_();
  assert.match(t, /frein budget/, 'la cause doit survivre à la panne de lecture : ' + t);
  assert.ok(!/illisible/.test(t), 'un blip de lecture ne doit pas effacer un verdict juste : ' + t);
});

test('statutReanalyse_ : les SEPT causes d\'arrêt se disent, une par une (PURE)', () => {
  // 🟠 des trois revues : la première version n'en connaissait que deux, et affichait
  // « en cours — 0 / 328 · 0 des 8 min/j » pendant que le frein à 40 $, le reset ou une panne de
  // plateforme tenaient la campagne à l'arrêt. Chaque cause est assertée SÉPARÉMENT — un
  // `indexOf(x) === 0` sur une seule famille en raterait la moitié (§9, estimation en pause).
  const { ctx } = chargerAvecSanteMock({}, {});
  const F = ctx.statutReanalyse_;
  //           arrêtée, terminée, rangement, migration, frein, reset, panne
  assert.match(F(true, false, false, false, false, false, false), /arrêtée \(CONFIG/);
  assert.match(F(false, true, false, false, false, false, false), /terminée/);
  assert.match(F(false, false, true, false, false, false, false), /grand rangement/);
  assert.match(F(false, false, false, true, false, false, false), /migration/);
  assert.match(F(false, false, false, false, false, false, true), /panne de plateforme/);
  assert.match(F(false, false, false, false, true, false, false), /frein budget/);
  assert.match(F(false, false, false, false, false, true, false), /reset/);
  // Rien ne l'arrête ⇒ chaîne VIDE : c'est ce qui laisse l'appelant calculer l'avancement.
  assert.strictEqual(F(false, false, false, false, false, false, false), '');
  // Le montant du frein est DÉRIVÉ de CONFIG, jamais recopié.
  assert.ok(F(false, false, false, false, true, false, false)
    .includes(String(ctx.CONFIG.LLM_BUDGET_CAMPAGNES) + ' $'));
  // ⚠️ L'arrêt PRIME sur tout le reste, y compris sur une panne ou un frein : il survit à leur
  // rétablissement. Annoncé après eux, il ferait lire « reprise demain » sur une campagne qui ne
  // reprendra jamais seule (C49-20).
  assert.match(F(true, false, false, false, true, true, true), /arrêtée \(CONFIG/);
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
  // …et cette fois le calcul est VRAIMENT dérivé : la version précédente écrivait `/des 20 min/` en
  // dur tout en affirmant l'inverse — elle est tombée le jour où les 20 min ont été réallouées
  // (ADR-0056, 20 → 12), exactement comme son propre commentaire l'avait prédit. Un test qui
  // ANNONCE dériver de CONFIG et recopie la valeur du jour accuse le code au premier rajustement.
  const minJ = ctx.CONFIG.GMAIL_HISTO_BUDGET_JOUR_MS / 60000;
  const filsJ = ctx.CONFIG.GMAIL_HISTO_MAX_FILS_JOUR;
  assert.ok(new RegExp('des ' + minJ + ' min\\/j').test(ligne), ligne);
  assert.ok(new RegExp('des ' + filsJ + ' fils\\/j').test(ligne), ligne);
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
  // ⚠️ LE BUDGET EST FORCÉ ICI (revue code C49-20), et ce n'est pas un détail : en production il
  // vaut 0 depuis l'arrêt de la campagne, donc la branche exercée ci-dessous est devenue
  // INATTEIGNABLE. Sans ce forçage, le test ne passait plus que parce que le HARNAIS rallume les
  // budgets des campagnes arrêtées — il aurait donc certifié une phrase que Marc ne peut plus
  // lire, en laissant la seule phrase qu'il lit vraiment (« À SEC », testée juste en dessous)
  // sans aucune couverture. Un test doit dire de QUEL monde il parle.
  const { ctx } = chargerAvecSanteMock({});
  ctx.CONFIG = Object.assign({}, ctx.CONFIG, { GMAIL_HISTO_BUDGET_JOUR_MS: 9 * 60 * 1000 });
  const props = { DriveAI_GMAIL_HISTO: 'terminé', DriveAI_GMAIL_HISTO_OFFSET: '4210' };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) };
  const t = ctx.texteSanteHistoGmail_();
  assert.ok(/termin/.test(t), t);
  assert.ok(t.includes('9 min/j sont RÉALLOUABLES'), t);

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

test('texteSanteHistoGmail_ (C49-20) : donneur À SEC — la branche que la PRODUCTION atteint, et que rien ne testait', () => {
  // Mesuré en revue : `if (!budget)` supprimé ⇒ 1 548 tests verts. C'est pourtant la SEULE des
  // deux phrases que Marc peut lire aujourd'hui (budget à 0 depuis C49-20), et celle qui décide
  // s'il ira chercher ses minutes ici ou ailleurs. Un donneur qui s'annonce « réallouable » alors
  // qu'il a tout prêté ferait prêter DEUX FOIS les mêmes minutes — l'enveloppe se creuserait sans
  // que personne ne voie le double emploi. Mutation : `if (false)` ⇒ ce test tombe.
  const { ctx } = chargerAvecSanteMock({});
  ctx.CONFIG = Object.assign({}, ctx.CONFIG,
    { GMAIL_HISTO_BUDGET_JOUR_MS: 0, GMAIL_HISTO_PRETEES_MIN: 20 });
  const props = { DriveAI_GMAIL_HISTO: 'terminé', DriveAI_GMAIL_HISTO_OFFSET: '4210' };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) };
  const t = ctx.texteSanteHistoGmail_();
  assert.ok(/À SEC/.test(t), 'le donneur doit DIRE qu\'il n\'a plus rien : ' + t);
  assert.ok(t.includes('20 min/j sont DÉJÀ prêtées'), 'le solde prêté vient de CONFIG : ' + t);
  assert.ok(!/RÉALLOUABLES/.test(t), 'à zéro, rien n\'est réallouable : ' + t);
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
  assert.strictEqual(ctx.statutHistoGmail_(false, true, true, true, true), 'terminé', 'terminé prime sur tout');
  assert.strictEqual(ctx.statutHistoGmail_(false, false, true, true, true), 'suspendu (quota Gmail)');
  assert.strictEqual(ctx.statutHistoGmail_(false, false, false, true, true), 'en pause (frein budget)');
  // 3ᵉ cause, oubliée de la première écriture : le reset suspend AUSSI la campagne (gate
  // `gResetEnCours`). Latente parce que `RESET_ACTIF` est false — mais c'est exactement le faux
  // « en cours · 0 min » que la ligne existe pour fermer.
  assert.strictEqual(ctx.statutHistoGmail_(false, false, false, false, true), 'suspendu (reset en cours)');
  assert.strictEqual(ctx.statutHistoGmail_(false, false, false, false, false), 'en cours');

  // 4ᵉ cause (C49-20) : ARRÊTÉE par CONFIG. La chaîne doit être EXACTEMENT `désactivée` —
  // `familleStatut` (app/src/etat.ts) l'apparie par ÉGALITÉ, et tout autre mot retombe dans
  // « en cours », c'est-à-dire le mensonge que ce garde existe pour fermer.
  assert.strictEqual(ctx.statutHistoGmail_(true, false, false, false, false), 'désactivée');
  // …et elle NE prime PAS sur « terminé » : une campagne qui a FINI puis qu'on éteint est
  // terminée, pas désactivée — c'est l'état de la production aujourd'hui.
  assert.strictEqual(ctx.statutHistoGmail_(true, true, false, false, false), 'terminé');
  // …mais elle prime sur les trois causes TRANSITOIRES : un arrêt délibéré n'est pas une panne.
  assert.strictEqual(ctx.statutHistoGmail_(true, false, true, true, true), 'désactivée');
});

test('texteSanteHistoGmail_ (C49-20) : la ligne de Santé TRANSMET l\'interrupteur, elle ne le devine pas', () => {
  // Le trou trouvé en revue : `statutHistoGmail_` avait reçu sa garde d\'arrêt et la ligne de
  // Santé ne la lui passait pas. Inoffensif tant que la Property vaut « terminé », FAUX dans le
  // seul cas où le flag existe (un bump de campagne). On OBSERVE l\'argument plutôt que le texte :
  // c\'est le câblage qui est en cause, pas la formulation. Mutation : passer `false` en dur ⇒ rouge.
  const { ctx } = chargerAvecSanteMock({});
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
  const vus = [];
  ctx.statutHistoGmail_ = function () { vus.push([].slice.call(arguments)); return 'en cours'; };

  ctx.CONFIG = Object.assign({}, ctx.CONFIG, { GMAIL_HISTO_ACTIF: false });
  ctx.texteSanteHistoGmail_();
  assert.strictEqual(vus[0][0], true, 'campagne éteinte ⇒ `arretee` vrai : ' + JSON.stringify(vus[0]));

  ctx.CONFIG = Object.assign({}, ctx.CONFIG, { GMAIL_HISTO_ACTIF: true });
  ctx.texteSanteHistoGmail_();
  assert.strictEqual(vus[1][0], false, 'campagne allumée ⇒ `arretee` faux : ' + JSON.stringify(vus[1]));
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

test('majSante_ : la ligne « Mémoire (pièces) » est DISTINCTE de celle de l\'inventaire', () => {
  // ⚠️ Deux canaux, deux pannes possibles, donc deux lignes. L'inventaire ne coûte aucun appel
  // LLM (il relit l'Index) ; l'extraction en coûte un par document et se met en pause sur le
  // frein budget. Une ligne unique ferait conclure « la Mémoire marche » sur la preuve de
  // l'autre moitié — exactement le défaut que C28-135 a payé sur une seule étape.
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const inv = captured.find((l) => l.indexOf('Mémoire (inventaire)') === 0);
  const pieces = captured.find((l) => l.indexOf('Mémoire (pièces)') === 0);
  assert.ok(inv, 'la ligne de l\'inventaire existe');
  assert.ok(pieces, 'la ligne des pièces existe');
  assert.notStrictEqual(inv, pieces, 'et elles ne disent pas la même chose');
});

test('majSante_ : la ligne « Audit des pièces » exerce le chemin NOMINAL, et distingue les trois silences', () => {
  // La PORTE de l'ADR-0061 avance maintenant toute seule dans le tick : c'est la seule surface
  // d'où Marc voit qu'elle avance. Trois situations donnent le même onglet immobile — jamais
  // lancée, en cours de budget, terminée — et elles appellent trois gestes différents (lancer,
  // attendre, juger). Mutation : retirer la ligne de `majSante_` ⇒ ce cas tombe.
  const { ctx, captured } = chargerAvecSanteMock({});
  ctx.majSante_();
  const ligne = captured.find((l) => l.indexOf('Audit des pièces') === 0);
  assert.ok(ligne, 'la ligne existe');
  assert.ok(!ligne.includes('illisible'), 'chemin nominal, pas le catch : ' + ligne);
  // Aucune passe enregistrée dans ce contexte ⇒ l'état « jamais tourné », qui est à part.
  assert.match(ligne, /n'a pas encore tourné/, ligne);
});
