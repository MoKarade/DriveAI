'use strict';
/**
 * Plan anomalies prod 2026-07-08 — convergence du rangement + fusion du domaine erroné.
 *  - `deplacerVersATrier_` : un échec de déplacement (« Access denied ») passe par `gererEchec_`
 *    (clé `drive|…`) → après QUARANTAINE_MAX la ligne d'Index stoppe la re-collecte (plus de
 *    boucle d'erreurs à chaque tick) ; un fichier en ZONE PROTÉGÉE est inscrit une fois
 *    (`statut: zone protégée`) et n'est plus jamais re-collecté (`estAReclasserLeger_`).
 *  - `fusionnerDomaine07PersoVers08` (SANS `_` final — outil manuel de l'éditeur) : déplacements
 *    d'abord (reprenables), Property effacée, colonnes Domaine d'Entités et d'Index ré-étiquetées.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

/* ---------- deplacerVersATrier_ : échec → gererEchec_, protégé → ligne Index ---------- */

function ctxDeplacement(options) {
  options = options || {};
  const appels = { echecs: [], ajouts: [], journal: [] };
  const c = load(['Config.gs', 'Entites.gs', 'Maintenance.gs'], {
    DriveApp: {
      getFileById: (id) => {
        if (options.getFileJette) throw new Error('Access denied: DriveApp.');
        return {
          getId: () => id,
          getName: () => options.nom ?? 'doc.pdf',
        };
      },
      getFolderById: () => { throw new Error('Access denied: DriveApp.'); }, // le déplacement échoue
    },
  });
  c.aParentProtege_ = () => !!options.protege;
  c.indexAjouter_ = (cle, r) => appels.ajouts.push({ cle, statut: r.statut, nom: r.nom });
  c.gererEchec_ = (src, message) => appels.echecs.push({ cle: src.cle, nom: src.nom, message });
  c.journalInfo_ = (src, msg) => appels.journal.push(msg);
  c.journalErreur_ = (src, msg) => appels.journal.push(msg);
  return { c, appels };
}

test('deplacerVersATrier_ : échec de déplacement (Access denied) → gererEchec_ avec une clé drive| (quarantaine après N)', () => {
  const { c, appels } = ctxDeplacement({ nom: 'partagé.pdf' });
  assert.strictEqual(c.deplacerVersATrier_('F_BLOQUE', {}), false);
  assert.strictEqual(appels.echecs.length, 1);
  assert.ok(appels.echecs[0].cle.startsWith('drive|'), 'clé drive| attendue : ' + appels.echecs[0].cle);
  assert.strictEqual(appels.echecs[0].cle, 'drive|F_BLOQUE');
  assert.strictEqual(appels.echecs[0].nom, 'partagé.pdf'); // le nom accompagne l'alerte de quarantaine
  assert.deepStrictEqual(appels.ajouts, []); // pas de ligne directe — c'est gererEchec_ qui décide
});

test('deplacerVersATrier_ : getFileById lui-même en échec → gererEchec_ quand même (nom = fileId)', () => {
  const { c, appels } = ctxDeplacement({ getFileJette: true });
  assert.strictEqual(c.deplacerVersATrier_('F_INVISIBLE', {}), false);
  assert.strictEqual(appels.echecs.length, 1);
  assert.strictEqual(appels.echecs[0].cle, 'drive|F_INVISIBLE');
  assert.strictEqual(appels.echecs[0].nom, 'F_INVISIBLE');
});

test('deplacerVersATrier_ : zone protégée → indexAjouter_ statut « zone protégée » (convergence), jamais gererEchec_', () => {
  const { c, appels } = ctxDeplacement({ protege: true, nom: 'passeport.pdf' });
  assert.strictEqual(c.deplacerVersATrier_('F_PROTEGE', { P: true }), false);
  assert.deepStrictEqual(appels.ajouts, [{ cle: 'drive|F_PROTEGE', statut: 'zone protégée', nom: 'passeport.pdf' }]);
  assert.deepStrictEqual(appels.echecs, []); // protégé ≠ échec : aucune quarantaine
});

test('estAReclasserLeger_ : la ligne drive| posée (protégé OU quarantaine) stoppe bien la re-collecte', () => {
  const c = load(['Config.gs', 'Entites.gs', 'Maintenance.gs']);
  c.indexContient_ = (cle) => cle === 'drive|F_PROTEGE';
  const fichier = { getName: () => 'sans prefixe.pdf', getId: () => 'F_PROTEGE', getMimeType: () => 'application/pdf' };
  assert.strictEqual(c.estAReclasserLeger_(fichier), false); // indexé → plus jamais collecté
  const autre = { getName: () => 'sans prefixe.pdf', getId: () => 'F_LIBRE', getMimeType: () => 'application/pdf' };
  assert.strictEqual(c.estAReclasserLeger_(autre), true);    // non-régression : les autres passent
});

/* ---------- fusionnerDomaine07PersoVers08 ---------- */

const NOM_ERRONE = '07 · Perso & projets';

function fauxOngletColonnes(entetes, lignes) {
  const donnees = [entetes.slice()].concat(lignes.map((l) => l.slice()));
  return {
    donnees,
    getLastRow: () => donnees.length,
    getLastColumn: () => donnees[0].length,
    getRange: (ligne, col, n, largeur) => ({
      getValues: () => donnees.slice(ligne - 1, ligne - 1 + n).map((l) => l.slice(col - 1, col - 1 + largeur)),
      setValues: (vals) => {
        for (let i = 0; i < vals.length; i++) {
          for (let j = 0; j < vals[i].length; j++) donnees[ligne - 1 + i][col - 1 + j] = vals[i][j];
        }
      },
    }),
  };
}

function ctxFusion(options) {
  options = options || {};
  const props = Object.assign({ ['DriveAI_DOM_' + NOM_ERRONE]: 'ID_SOURCE' }, options.props);
  const deplaces = [];
  const iter = (items) => { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; };
  const cible = { getId: () => 'ID_CIBLE_08' };
  const source = {
    getFiles: () => iter((options.fichiers || []).map((n) => ({ moveTo: (d) => deplaces.push({ type: 'fichier', nom: n, vers: d.getId() }) }))),
    getFolders: () => iter((options.dossiers || []).map((n) => ({ moveTo: (d) => deplaces.push({ type: 'dossier', nom: n, vers: d.getId() }) }))),
  };
  const onglets = {
    'Entités': fauxOngletColonnes(['Entité', 'Domaine', 'Statut'], options.entites || []),
    'Index': fauxOngletColonnes(['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut'], options.index || []),
  };
  const c = load(['Config.gs', 'Entites.gs', 'Maintenance.gs'], {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    DriveApp: { getFolderById: (id) => (id === 'ID_SOURCE' ? source : cible) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Logger: { log: () => {} },
  });
  c.feuille_ = (nom) => onglets[nom];
  c.journalInfo_ = () => {};
  return { c, props, deplaces, onglets };
}

test('fusionnerDomaine07PersoVers08 : Property absente → no-op (rien déplacé, rien touché) — re-lancement idempotent', () => {
  const ctx = ctxFusion({});
  delete ctx.props['DriveAI_DOM_' + NOM_ERRONE];
  assert.strictEqual(ctx.c.fusionnerDomaine07PersoVers08(), 'rien à faire');
  assert.deepStrictEqual(ctx.deplaces, []);
});

test('fusionnerDomaine07PersoVers08 : fichiers + sous-dossiers déplacés vers 08, Property effacée, colonnes Domaine ré-étiquetées', () => {
  const { c, props, deplaces, onglets } = ctxFusion({
    fichiers: ['a.pdf', 'b.pdf'],
    dossiers: ['Vrac'],
    entites: [
      ['EDF', NOM_ERRONE, 'en_attente'],
      ['XTB', '02 · Finances', 'validée'],
    ],
    index: [
      ['drive|F1', '2026-07-01', 'a.pdf', NOM_ERRONE, NOM_ERRONE, 'classé'],
      ['drive|F2', '2026-07-02', 'c.pdf', '02 · Finances', '02 · Finances', 'classé'],
    ],
  });
  const resume = c.fusionnerDomaine07PersoVers08();
  // Tous les contenus déplacés vers la CIBLE canonique (jamais de suppression).
  assert.strictEqual(deplaces.filter((d) => d.type === 'fichier').length, 2);
  assert.strictEqual(deplaces.filter((d) => d.type === 'dossier').length, 1);
  assert.ok(deplaces.every((d) => d.vers === 'ID_CIBLE_08'));
  // Property du domaine auto effacée (pas de résurrection : absent de DOMAINES_AUTO).
  assert.ok(!(('DriveAI_DOM_' + NOM_ERRONE) in props));
  // Ré-étiquetage : SEULES les cellules au libellé erroné changent.
  assert.strictEqual(onglets['Entités'].donnees[1][1], '08 · Perso & projets');
  assert.strictEqual(onglets['Entités'].donnees[2][1], '02 · Finances');
  assert.strictEqual(onglets['Index'].donnees[1][3], '08 · Perso & projets');
  assert.strictEqual(onglets['Index'].donnees[1][4], NOM_ERRONE); // le CHEMIN n'est pas réécrit (réconciliation P3)
  assert.strictEqual(onglets['Index'].donnees[2][3], '02 · Finances');
  assert.ok(String(resume).includes('2 fichier(s) et 1 sous-dossier(s)'));
});

test('terminerFusionDomaine07 : ré-étiquette Domaine (Entités+Index) et Chemin (Index), idempotent par nature', () => {
  const ctx = ctxFusion({
    entites: [['EDF', NOM_ERRONE, 'en_attente']],
    index: [
      ['drive|F1', '2026-07-01', 'a.pdf', NOM_ERRONE, NOM_ERRONE, 'classé'],
      ['drive|F2', '2026-07-02', 'b.pdf', '02 · Finances', NOM_ERRONE + '/Vrac', 'classé'], // chemin COMPOSÉ : jamais touché (égalité stricte)
    ],
  });
  delete ctx.props['DriveAI_DOM_' + NOM_ERRONE]; // état réel post-coupure : Property déjà effacée
  const resume = ctx.c.terminerFusionDomaine07();
  assert.strictEqual(ctx.onglets['Entités'].donnees[1][1], '08 · Perso & projets');
  assert.strictEqual(ctx.onglets['Index'].donnees[1][3], '08 · Perso & projets');
  assert.strictEqual(ctx.onglets['Index'].donnees[1][4], '08 · Perso & projets'); // chemin racine ré-étiqueté
  assert.strictEqual(ctx.onglets['Index'].donnees[2][4], NOM_ERRONE + '/Vrac');   // composé intact
  assert.ok(String(resume).includes('ré-étiquetés'));
  // Idempotence : un 2e passage ne change plus rien.
  assert.ok(String(ctx.c.terminerFusionDomaine07()).includes('0 ligne(s) Entités'));
});
