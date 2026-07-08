'use strict';
/**
 * Incident 2026-07-08 — Sheet d'état recréée à VIDE par le fail-open de getSheetEtat_.
 *  - TRIPWIRE (plan architecte, étape 3) : `getSheetEtat_` est ÉCHEC FERMÉ — un `openById` qui
 *    échoue alors que DriveAI_SHEET_ID EXISTE lève, et `SpreadsheetApp.create` n'est JAMAIS
 *    atteint (le mock de create fait échouer le test s'il est appelé). La création ne sert
 *    qu'à la première installation (ID absent).
 *  - `estCleFichierIncident_` (pur) : seules les clés de DÉPÔT (drive|, shared|, PJ Gmail brute
 *    `<messageId hex>|…`) déclenchent l'écartement d'une copie — jamais les clés d'état pur.
 *  - `reparerIncidentSheet_` : gardes d'idempotence DURES (jamais deux passages), inédits
 *    re-portés, copies de rejeu écartées dans _Doublons (déplacement seul, protégés laissés en
 *    place), Journal/DryRunV2 fusionnés, bascule DriveAI_SHEET_ID + caches invalidés.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- getSheetEtat_ : fail-closed (tripwire) ---------- */

test('getSheetEtat_ : fail-closed (ne recrée jamais la Sheet si l\'ID existe mais l\'ouverture échoue)', () => {
  const ctx = load(['Config.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'DriveAI_SHEET_ID' ? 'ID_EXISTANT' : null),
        setProperty: () => { throw new Error('aucune Property ne doit être écrite sur ce chemin'); },
      }),
    },
    SpreadsheetApp: {
      openById: () => { throw new Error('Service Spreadsheets failed (panne transitoire simulée)'); },
      create: () => { throw new Error('TRIPWIRE : SpreadsheetApp.create appelé alors qu\'un ID existe — fail-open interdit'); },
    },
  });
  assert.throws(() => ctx.getSheetEtat_(), /Abandon pour protéger l'idempotence/);
});

test('getSheetEtat_ : la création ne sert qu\'à la PREMIÈRE installation (ID strictement absent)', () => {
  const ecrits = {};
  const fausseSheet = { getId: () => 'NOUVEL_ID' };
  const ctx = load(['Config.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null, // aucune Property : première installation
        setProperty: (k, v) => { ecrits[k] = v; },
      }),
    },
    SpreadsheetApp: {
      openById: () => { throw new Error('ne doit pas être appelé sans ID'); },
      create: () => fausseSheet,
    },
  });
  ctx.initialiserSheet_ = () => {}; // l'aménagement des onglets a ses propres tests
  assert.strictEqual(ctx.getSheetEtat_(), fausseSheet);
  assert.strictEqual(ecrits.DriveAI_SHEET_ID, 'NOUVEL_ID');
});

/* ---------- estCleFichierIncident_ (pur) ---------- */

const pur = load(['Config.gs', 'Entites.gs', 'Maintenance.gs']);

test('estCleFichierIncident_ : dépôts oui (drive/shared/PJ brute), états purs non', () => {
  assert.strictEqual(pur.estCleFichierIncident_('drive|ABC'), true);
  assert.strictEqual(pur.estCleFichierIncident_('shared|ABC'), true);
  assert.strictEqual(pur.estCleFichierIncident_('19f37d41704a50da|0|Invoice.pdf|32216'), true); // PJ : messageId hex BRUT
  assert.strictEqual(pur.estCleFichierIncident_('tri|F1|100|lu'), false);
  assert.strictEqual(pur.estCleFichierIncident_('important|MC'), false);
  assert.strictEqual(pur.estCleFichierIncident_('intention|M1'), false);
  assert.strictEqual(pur.estCleFichierIncident_('intention-manuel|F1'), false);
  assert.strictEqual(pur.estCleFichierIncident_('dryrunv2|d1|ABC'), false);
  assert.strictEqual(pur.estCleFichierIncident_('migre|m1|ABC'), false); // pas re-déposé par l'incident
});

/* ---------- reparerIncidentSheet_ (mécanique, tout mocké) ---------- */

const ID_ANCIENNE = '10VSEgfSulXn2V5apYktNOzWTm3y_V4iaBxsm_hRc7UY';
const ID_NOUVELLE = '1SY8PiuQ3G3U0xlp63Wihax-efl3NEZIyX2af__hBSY8';
const APRES = new Date('2026-07-08T06:39:00Z'); // copie re-déposée (après l'incident)
const AVANT = new Date('2026-06-01T12:00:00Z'); // original (bien avant)

/** Onglet mocké : tableau 2D (ligne 1 = en-têtes), appendRow/getRange/setValues minimaux. */
function fauxOnglet(lignes) {
  const donnees = lignes.map((l) => l.slice());
  return {
    donnees,
    getLastRow: () => donnees.length,
    getLastColumn: () => (donnees[0] || []).length,
    appendRow: (l) => donnees.push(l.slice()),
    getRange: (ligne, col, n, largeur) => ({
      getValues: () => donnees.slice(ligne - 1, ligne - 1 + n).map((l) => {
        const v = l.slice(col - 1, col - 1 + largeur);
        while (v.length < largeur) v.push('');
        return v;
      }),
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) donnees[ligne - 1 + i] = vals[i].slice();
      },
    }),
  };
}

function fauxClasseur(onglets) {
  return {
    onglets,
    getSheetByName: (nom) => onglets[nom] || null,
    insertSheet: (nom) => { onglets[nom] = fauxOnglet([[]]); return onglets[nom]; },
  };
}

function fauxFichierDrive(id, nom, creeLe, options) {
  options = options || {};
  return {
    getId: () => id,
    getName: () => nom,
    getDateCreated: () => creeLe,
    getParents: () => {
      const parents = [{ getId: () => options.parentId || 'DOSSIER_X' }];
      let i = 0;
      return { hasNext: () => i < parents.length, next: () => parents[i++] };
    },
    moveTo: options.moveTo || (() => {}),
  };
}

function ctxReparation(options) {
  options = options || {};
  const props = Object.assign({ DriveAI_SHEET_ID: ID_NOUVELLE }, options.props);
  const deplaces = [];
  const ENTETES_IDX = ['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance'];
  const ancienne = fauxClasseur({
    Index: fauxOnglet([ENTETES_IDX].concat(options.indexAncien || [])),
    Journal: fauxOnglet([['Horodatage', 'Niveau', 'Source', 'Message']].concat(options.journalAncien || [])),
  });
  const nouvelle = fauxClasseur({
    Index: fauxOnglet([ENTETES_IDX].concat(options.indexNouveau || [])),
    Journal: fauxOnglet([['Horodatage', 'Niveau', 'Source', 'Message']].concat(options.journalNouveau || [])),
    DryRunV2: fauxOnglet([['Horodaté', 'ID fichier', 'Nom actuel']].concat(options.dryrunNouveau || [])),
  });
  const c = load(['Config.gs', 'Entites.gs', 'Maintenance.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    SpreadsheetApp: {
      openById: (id) => (id === ID_ANCIENNE ? ancienne : nouvelle),
      create: () => { throw new Error('jamais de création ici'); },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      searchFiles: (q) => {
        const fichiers = (options.fichiersDrive || []).filter((f) => q.includes("title = '" + f.getName().replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"));
        let i = 0;
        return { hasNext: () => i < fichiers.length, next: () => fichiers[i++] };
      },
    },
    Logger: { log: () => {} },
  });
  c.ensembleDomainesProteges_ = () => ({ PROTEGE: true });
  c.aParentProtege_ = (f) => !!(options.protegesIds || []).includes(f.getId());
  c.dossierDoublons_ = () => ({ getId: () => 'DOUBLONS' });
  c.reinitialiserIndexCache_ = () => { c.__cacheReinitialise = true; };
  return { c, props, ancienne, nouvelle, deplaces };
}

const LGN = (cle, nom, statut) => [cle, '2026-07-08', nom, '', '', statut, '', ''];

test('reparerIncidentSheet_ : gardes DURES — déjà réparé ou SHEET_ID inattendu → refus sans rien toucher', () => {
  const deja = ctxReparation({ props: { DriveAI_INCIDENT_0708_REPARE: '2026-07-08T20:00:00Z' } });
  assert.throws(() => deja.c.reparerIncidentSheet(), /DÉJÀ exécutée/);
  const ailleurs = ctxReparation({ props: { DriveAI_SHEET_ID: ID_ANCIENNE } });
  assert.throws(() => ailleurs.c.reparerIncidentSheet(), /état inattendu/);
});

test('reparerIncidentSheet_ : inédits re-portés, copie de rejeu écartée, protégé laissé, original intact, bascule faite', () => {
  const deplaces = [];
  const copieRejeu = fauxFichierDrive('COPIE', '2026-07-06_Attestation_MIFI.pdf', APRES, {
    moveTo: (d) => deplaces.push({ id: 'COPIE', vers: d.getId() }),
  });
  const original = fauxFichierDrive('ORIGINAL', '2026-07-06_Attestation_MIFI.pdf', AVANT, {
    moveTo: () => { throw new Error('l\'ORIGINAL ne doit JAMAIS bouger'); },
  });
  const copieProtegee = fauxFichierDrive('PROT', '2019-09-17_Passeport_Préfecture du Nord.pdf', APRES, {
    moveTo: () => { throw new Error('un fichier PROTÉGÉ ne bouge jamais (§1)'); },
  });
  const { c, props, ancienne } = ctxReparation({
    indexAncien: [
      LGN('19aaa1111111|0|Attestation.pdf|100', '2026-07-06_Attestation_MIFI.pdf', 'classé'),
      LGN('19bbb2222222|0|Passeport.pdf|200', '2019-09-17_Passeport_Préfecture du Nord.pdf', 'classé'),
      LGN('tri|F1|100|lu', 'Vieux fil', 'trié'),
    ],
    indexNouveau: [
      // Rejeux (clés connues de l'ancien) : un écartable, un protégé, un état pur (tri).
      LGN('19aaa1111111|0|Attestation.pdf|100', '2026-07-06_Attestation_MIFI.pdf', 'classé'),
      LGN('19bbb2222222|0|Passeport.pdf|200', '2019-09-17_Passeport_Préfecture du Nord.pdf', 'classé'),
      LGN('tri|F1|100|lu', 'Vieux fil', 'trié'),
      // Inédits du matin : un dépôt et une ligne dry-run — re-portés tels quels.
      LGN('19ccc3333333|0|Neuf.pdf|300', '2026-07-08_Facture_Nouvelle.pdf', 'classé'),
      LGN('dryrunv2|d1|F42', '2023_CV_Inconnu.pdf', 'dry-run'),
    ],
    journalNouveau: [['2026-07-08 02:34', 'ERREUR', 'Rangement', 'Déplacement impossible']],
    dryrunNouveau: [['2026-07-08 09:43', 'F42', '2023_CV_Inconnu.pdf']],
    fichiersDrive: [copieRejeu, original, copieProtegee],
    protegesIds: ['PROT'],
  });
  const resume = c.reparerIncidentSheet();

  // Copie de rejeu écartée dans _Doublons (déplacement seul) ; original et protégé intacts.
  assert.deepStrictEqual(deplaces, [{ id: 'COPIE', vers: 'DOUBLONS' }]);
  // Inédits re-portés dans l'ancien Index (2 lignes), jamais les rejeux.
  const clesAncien = ancienne.onglets.Index.donnees.slice(1).map((l) => l[0]);
  assert.ok(clesAncien.includes('19ccc3333333|0|Neuf.pdf|300'));
  assert.ok(clesAncien.includes('dryrunv2|d1|F42'));
  assert.strictEqual(clesAncien.filter((k) => k === 'tri|F1|100|lu').length, 1); // pas dupliqué
  // Journal et DryRunV2 fusionnés (DryRunV2 créé dans l'ancienne, en-tête compris).
  assert.ok(ancienne.onglets.Journal.donnees.some((l) => String(l[3] || '').includes('Déplacement impossible')));
  assert.ok(ancienne.onglets.DryRunV2 && ancienne.onglets.DryRunV2.donnees.some((l) => l[1] === 'F42'));
  // Bascule + marqueur d'idempotence + caches.
  assert.strictEqual(props.DriveAI_SHEET_ID, ID_ANCIENNE);
  assert.ok(props.DriveAI_INCIDENT_0708_REPARE);
  assert.ok(c.__cacheReinitialise);
  assert.ok(String(resume).includes('1 copie(s) écartée(s)'));
});
