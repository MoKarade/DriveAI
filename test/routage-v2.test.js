'use strict';
/**
 * ROUTAGE V2 (refonte #26, C26-06) — cœur PUR `planRoutageV2_` : décide TYPE de placement (non-document
 * vs classé), domaine, sous-dossier et nom, à partir du schéma étendu de l'analyse 2 passes. Aucune I/O
 * Drive (l'enveloppe `deciderRoutageV2_` fait le find-or-create). Vérifie les exigences de Marc :
 * non-document écarté (jamais un domaine, jamais 04), identité PAR TYPE, tout en sous-dossier, jamais
 * « Inconnu ». Fonctions PURES.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const ctx = load(['Config.gs', 'Entites.gs', 'Router.gs']);
const plat = (o) => JSON.parse(JSON.stringify(o)); // normalise les prototypes (frontière vm)

// meta minimale attendue par decisionNonDocument_ (nom, taille, extrait OCR, émetteur).
const meta = (nom, opts) => Object.assign({ nomFichier: nom, taille: 100000, extraitOcr: 'texte lisible du document '.repeat(4), emetteur: '' }, opts || {});

/* ---------- Non-documents : écartés hors domaines, JAMAIS un domaine ---------- */

test('planRoutageV2_ : export de données HTML → _Technique (jamais un domaine)', () => {
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, routageHorsDomaine: '_Technique', domaine: '08 · Perso & projets' },
    meta('votre information facebook.html', { taille: 500000, emetteur: '' }), '2026-07-01', '.html');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Technique');
  assert.strictEqual(p.domaine, undefined); // aucun domaine pour un non-document
});

test('planRoutageV2_ : capture sans texte → _Médias', () => {
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, domaine: '08 · Perso & projets' },
    meta('Screenshot_20260701.png', { extraitOcr: '' }), '2026-07-01', '.png');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Médias');
});

test('planRoutageV2_ : GARDE dominante — une pièce d\'identité en image n\'est JAMAIS écartée', () => {
  // Le LLM se trompe (estNonDocument=true) mais c'est une identité → distinguerVraiScan_ prime → classé.
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, estDocumentIdentite: true, sousDossierType: 'Passeport',
      titulaire: 'Marc Richard', domaine: '01 · Administratif & identité' },
    meta('IMG_2734.jpg', { extraitOcr: '' }), '2019-09-17', '.jpg');
  assert.strictEqual(p.type, 'classé');
});

test('planRoutageV2_ : un vrai scan (facture + émetteur), même OCR pauvre, reste CLASSÉ', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '02 · Finances', type_doc: 'Facture', emetteur: 'Hydro-Québec' },
    meta('recu.jpg', { extraitOcr: '' }), '2026-03-01', '.jpg');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, '02 · Finances');
});

/* ---------- Pièces d'identité : par TYPE, titulaire dans le nom, domaine dérivé du type ---------- */

test('planRoutageV2_ : passeport → 01 · Administratif, sous-dossier « Passeport », titulaire dans le nom', () => {
  // Même si le LLM propose 04, le passeport se range en 01 (dossier partagé Marc + proches).
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Passeport', titulaire: 'Sophie Tremblay',
      domaine: '04 · Immigration', date_doc: '2020-01-01' },
    meta('passeport.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, '01 · Administratif & identité');
  assert.strictEqual(p.sousDossier, 'Passeport');
  assert.strictEqual(p.nom, '2020-01-01_Passeport_Sophie Tremblay.pdf');
});

test('planRoutageV2_ : carte de résident permanent → domaine 04 (lié au statut)', () => {
  const p = ctx.planRoutageV2_(
    { estDocumentIdentite: true, sousDossierType: 'Carte de résident permanent', titulaire: 'Marc Richard', date_doc: '2024-05-02' },
    meta('carte.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.domaine, '04 · Immigration');
  assert.strictEqual(p.sousDossier, 'Carte de résident permanent');
});

/* ---------- Documents normaux : sous-dossier = entité unifiée, sinon catégorie ; jamais à la racine ---------- */

test('planRoutageV2_ : émetteur/entité → sous-dossier canonique, nom par émetteur', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '02 · Finances', type_doc: 'Relevé', emetteur: 'Desjardins', entite: 'Desjardins Inc.', date_doc: '2026-03-15' },
    meta('releve.pdf', { emetteur: 'Desjardins' }), '2026-07-07', '.pdf');
  assert.strictEqual(p.sousDossier, 'Desjardins');            // suffixe juridique retiré, unifié
  assert.strictEqual(p.nom, '2026-03_Relevé_Desjardins.pdf'); // relevé = granularité mois
});

test('planRoutageV2_ : ni émetteur ni titulaire → descripteur dans le nom (JAMAIS « Inconnu »), catégorie en sous-dossier', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '06 · Études & diplômes', type_doc: 'Devoir', descripteur: 'Devoir algorithmique Python', sousDossier: 'Devoirs', date_doc: '2026-06-30' },
    meta('TP4.docx'), '2026-07-07', '.docx');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.sousDossier, 'Devoirs');      // rien à la racine du domaine
  assert.ok(!/inconnu/i.test(p.nom), 'le nom ne doit jamais contenir « Inconnu » : ' + p.nom);
  assert.ok(/Devoir algorithmique Python/.test(p.nom), 'le descripteur doit être dans le nom : ' + p.nom);
});

test('planRoutageV2_ : rien d\'exploitable → sous-dossier de repli non vide (jamais la racine)', () => {
  const p = ctx.planRoutageV2_(
    { domaine: '08 · Perso & projets', type_doc: 'Note' },
    meta('note.pdf'), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.ok(p.sousDossier && p.sousDossier.length, 'le sous-dossier ne doit jamais être vide : ' + JSON.stringify(p));
});

/* ---------- Domaine hors-liste → domaine par défaut (jamais de limbo) ---------- */

test('planRoutageV2_ : domaine LLM hors-liste → domaine par défaut', () => {
  const p = ctx.planRoutageV2_(
    { domaine: 'Bidon inexistant', type_doc: 'Facture', emetteur: 'EDF', date_doc: '2026-01-10' },
    meta('facture.pdf', { emetteur: 'EDF' }), '2026-07-07', '.pdf');
  assert.strictEqual(p.type, 'classé');
  assert.strictEqual(p.domaine, ctx.CONFIG.DOMAINE_DEFAUT);
});

test('planRoutageV2_ : un non-document est écarté hors domaines (aucun domaine porté)', () => {
  // Domaine NON protégé + média sans texte → la garde dominante ne s'applique pas → écarté en _Médias.
  const p = ctx.planRoutageV2_(
    { estNonDocument: true, routageHorsDomaine: '_Médias', domaine: '08 · Perso & projets' },
    meta('WhatsApp Image 2026.jpeg', { extraitOcr: '' }), '2026-07-01', '.jpeg');
  assert.strictEqual(p.type, 'non-doc');
  assert.strictEqual(p.routage, '_Médias');
  assert.strictEqual(plat(p).domaine, undefined); // un non-document ne porte jamais de domaine
});
