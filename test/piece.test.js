'use strict';
/**
 * test/piece.test.js — LIRE ce qu'un papier contient (ADR-0061, C49-2).
 *
 * Ce que ces cas défendent, et qui n'est pas ce qu'on croirait :
 *   1. le parseur est TOLÉRANT sur la forme — jeter une extraction juste après avoir payé
 *      l'appel est le pire des deux mondes ;
 *   2. il est STRICT sur le fond — rien n'est deviné, rien n'est complété ;
 *   3. une extraction qui ne porte RIEN rend `null`, jamais un objet vide : une pièce vide
 *      occupe la place de celle qu'on aurait pu extraire, et l'idempotence interdit de
 *      réessayer ;
 *   4. « absent » n'est pas « zéro » — le même piège que la confiance du titulaire.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function ctx() {
  return load(['Config.gs', 'Piece.gs']);
}

const COMPLET = JSON.stringify({
  resume: 'Bail de 12 mois, reconduction tacite.',
  type: 'bail',
  emetteur: 'Gestion Immo',
  langue: 'fr',
  date_document: '2026-01-15',
  date_echeance: '2027-01-14',
  titulaire: 'Marc Richard',
  titulaire_confiance: 0.95,
  champs: { montants: [{ libelle: 'loyer', valeur: '1 250 $' }] },
  libres: { 'téléphone du propriétaire': '418 555 0199' },
  confiance: 0.9
});

test('une extraction complète est lue telle quelle', () => {
  const c = ctx();
  const e = c.parserExtractionPiece_(COMPLET);
  assert.strictEqual(e.resume, 'Bail de 12 mois, reconduction tacite.');
  assert.strictEqual(e.date_echeance, '2027-01-14');
  assert.strictEqual(e.titulaire_confiance, 0.95);
  assert.strictEqual(e.libres['téléphone du propriétaire'], '418 555 0199');
});

test('TOLÉRANT sur la forme : clôtures Markdown, texte autour, listes, nombres en chaîne', () => {
  const c = ctx();
  // Trois variations qu'un modèle produit vraiment, et qui ne changent rien au FOND.
  assert.ok(c.parserExtractionPiece_('```json\n' + COMPLET + '\n```'));
  assert.ok(c.parserExtractionPiece_('Voici le résultat :\n' + COMPLET + '\nVoilà.'));
  const liste = c.parserExtractionPiece_(JSON.stringify({
    resume: ['Bail de 12 mois.', 'Reconduction tacite.'],
    confiance: '0.8'
  }));
  assert.strictEqual(liste.resume, 'Bail de 12 mois. Reconduction tacite.');
  assert.strictEqual(liste.confiance, 0.8);
});

test('STRICT sur le fond : un objet ne devient pas « [object Object] »', () => {
  const c = ctx();
  // Un « contenu » qui serait en fait la représentation d'un objet est un mensonge présenté
  // comme une donnée — pire qu'un champ absent.
  const e = c.parserExtractionPiece_(JSON.stringify({ resume: { a: 1 }, type: 'bail' }));
  assert.strictEqual(e.resume, null);
  assert.strictEqual(e.type, 'bail');
});

test('une extraction qui ne porte RIEN rend null', () => {
  const c = ctx();
  // Sans ce test, un appel muet produirait une pièce vide — qui occuperait la place de la
  // bonne, sans qu'on puisse réessayer (l'idempotence la compterait déjà présente).
  assert.strictEqual(c.parserExtractionPiece_(JSON.stringify({ confiance: 0.9 })), null);
  assert.strictEqual(c.parserExtractionPiece_('{}'), null);
  assert.strictEqual(c.parserExtractionPiece_(''), null);
  assert.strictEqual(c.parserExtractionPiece_('pas du JSON du tout'), null);
  assert.strictEqual(c.parserExtractionPiece_(null), null);
});

test('un seul champ suffit à faire une extraction', () => {
  const c = ctx();
  // L'anti-vacuité du test précédent : si « ne rien porter » était la seule réponse, la
  // règle serait satisfaite par « rendre null toujours ».
  assert.ok(c.parserExtractionPiece_(JSON.stringify({ type: 'facture' })));
  assert.ok(c.parserExtractionPiece_(JSON.stringify({ libres: { x: 'y' } })));
});

test('« absent » n\'est pas « zéro » — ni pour la confiance, ni pour le titulaire', () => {
  const c = ctx();
  // `Number(null)` vaut 0 : sans ce garde, une confiance jamais donnée deviendrait une
  // certitude nulle AFFIRMÉE. C'est le défaut que C49-1 a payé sur le titulaire.
  const e = c.parserExtractionPiece_(JSON.stringify({ type: 'bail', confiance: null, titulaire_confiance: '' }));
  assert.strictEqual(e.confiance, null);
  assert.strictEqual(e.titulaire_confiance, null);
  // Et zéro reste zéro quand il est DIT.
  const z = c.parserExtractionPiece_(JSON.stringify({ type: 'bail', confiance: 0 }));
  assert.strictEqual(z.confiance, 0);
});

test('le prompt d\'extraction est DÉDIÉ — il ne classe rien', () => {
  const c = ctx();
  // L'ADR-0061 §5.1 : deux questions, deux prompts. Mêlés, le classement se dégraderait au
  // profit de l'extraction sans que rien ne le signale.
  assert.ok(!/domaine|sousDossier|routageHorsDomaine/.test(c.PROMPT_PIECE),
    'le prompt de pièce ne doit pas parler de classement');
  assert.ok(/resume|titulaire_confiance/.test(c.PROMPT_PIECE));
  // Et la consigne qui porte l'arbitrage de Marc doit y être en toutes lettres.
  assert.ok(/« Inconnu » est une bonne réponse/.test(c.PROMPT_PIECE),
    'la consigne « ne devine pas le titulaire » est ce qui rend le champ utilisable');
});

test('le prompt demande la date de NAISSANCE, et la distingue des deux autres dates', () => {
  const c = ctx();
  // ⚠️ Né d'un défaut OBSERVÉ (19/09/2026) : la Mémoire portait le passeport de Marc et ne
  // pouvait pas dire son âge. Deux causes empilées — la lecture (niveau 3, côté MemoryAI) et
  // celle-ci : rien ne demandait la date de naissance, donc elle n'arrivait dans `libres` que
  // si le modèle y pensait. Une consigne implicite n'est pas une consigne.
  assert.ok(/date de naissance/.test(c.PROMPT_PIECE),
    'sans cette consigne, la date de naissance n\'est extraite qu\'au petit bonheur');
  // Et la distinction avec les deux dates qui existaient déjà doit être ÉCRITE : sans elle,
  // un modèle range une naissance dans `date_document`, qui est la date du PAPIER.
  assert.ok(/date du PAPIER/.test(c.PROMPT_PIECE),
    'la consigne doit dire ce que date_document et date_echeance sont, sinon elle déplace le défaut');
  // ⚠️ ANTI-VACUITÉ : ce fragment est le dernier AVANT la fin du prompt concaténé. Un `+`
  // manquant tronquerait tout ce qui suit EN SILENCE (leçon §9, surface verte) — donc on
  // vérifie aussi que la phrase finale a survécu.
  assert.ok(/Une date incomplète vaut null\.$/.test(c.PROMPT_PIECE.trim()),
    'le prompt est tronqué : la dernière phrase manque');
});

test('le prompt interdit de deviner, et de convertir les montants', () => {
  const c = ctx();
  assert.ok(/NE DEVINE RIEN/.test(c.PROMPT_PIECE));
  assert.ok(/TELS QU'ÉCRITS|TELS QU\\'ÉCRITS/.test(c.PROMPT_PIECE) || /TELS QU/.test(c.PROMPT_PIECE));
});

// ── Une extraction FABRIQUÉE (défaut du passeport, 21/09/2026) ──────────────────────────
//
// L'OCR d'une photo de passeport n'avait rendu que des fragments (« HARD FLEX T 014 »,
// « ITD OSS », des références de fabricant). Le modèle n'avait AUCUNE façon de dire non :
// la structure JSON demandée exigeait un résumé, un type, un émetteur. Il a donc fabriqué
// un passeport plausible — résumé en espagnol sur un document marqué `fr`, numéros tirés
// du bruit — et cette pièce a été écrite, servie à un modèle, et jamais reprise.

test('le modèle a le DROIT de dire qu\'il n\'a pas pu lire, et ce refus est respecté', () => {
  const c = ctx();
  // Le cas EXACT : `lisible: false` accompagné de champs bien remplis. Sans le refus, cette
  // extraction passe — elle « porte quelque chose », c'est justement le problème.
  const fabrique = JSON.stringify({
    lisible: false,
    resume: 'Passeport canadiense emitido por el Gobierno de Canadá.',
    type: 'passeport',
    emetteur: 'Gouvernement du Canada',
    champs: { numeros: [{ libelle: 'Numéro de série', valeur: 'C1966' }] },
    libres: { reference_vol: 'HARD FLEX T 014', zone_donnees: 'ITD OSS' }
  });
  assert.strictEqual(c.parserExtractionPiece_(fabrique), null,
    'une extraction que le modèle déclare illisible ne doit JAMAIS être écrite');
});

test('`lisible` ABSENT vaut vrai — un champ oublié ne fait pas jeter tout un lot', () => {
  const c = ctx();
  // Le côté sûr est ici l'acceptation : le défaut inverse jetterait toutes les réponses
  // d'un modèle qui omet le champ, c'est-à-dire tout ce qui a été extrait avant ce lot.
  const e = c.parserExtractionPiece_(COMPLET);
  assert.ok(e, 'une extraction sans le champ doit passer comme avant');
  assert.strictEqual(e.lisible, true, '`lisible` absent est normalisé à true, pas à undefined');
  const vrai = c.parserExtractionPiece_(JSON.stringify({ lisible: true, type: 'bail' }));
  assert.ok(vrai, 'un `lisible: true` explicite passe aussi');
});

test('`extractionExploitable_` est PURE, et sépare ses deux refus', () => {
  const c = ctx();
  assert.strictEqual(c.extractionExploitable_(null), false);
  assert.strictEqual(c.extractionExploitable_({}), false, 'ne porte rien');
  assert.strictEqual(c.extractionExploitable_({ type: 'bail' }), true);
  // Le refus « illisible » PRIME sur la richesse : c'est toute la différence avec l'ancien
  // test, qui ne savait refuser qu'une extraction VIDE.
  assert.strictEqual(c.extractionExploitable_({ type: 'bail', lisible: false }), false);
});

test('le prompt OUVRE la porte de sortie, et interdit de fabriquer', () => {
  const c = ctx();
  // Le champ doit être dans le CONTRAT JSON, pas seulement dans la prose : un modèle rend
  // la forme qu'on lui montre.
  assert.ok(/"lisible"/.test(c.PROMPT_PIECE),
    'sans le champ dans le gabarit JSON, le modèle n\'a aucune façon de dire non');
  assert.ok(/DOCUMENT ILLISIBLE/.test(c.PROMPT_PIECE));
  // Et l'interdiction doit être EXPLICITE : dire « tu peux répondre false » sans dire « ne
  // fabrique pas » laisse le modèle choisir la réponse la plus serviable, qui est l'invention.
  assert.ok(/Ne fabrique JAMAIS/.test(c.PROMPT_PIECE),
    'la porte de sortie ne sert à rien tant que l\'invention reste permise');
  assert.ok(/bruit d'OCR/.test(c.PROMPT_PIECE),
    'le cas qui a mordu doit être nommé, sinon la consigne reste abstraite');
});
