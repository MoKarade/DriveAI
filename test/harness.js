'use strict';
/**
 * harness.js — Bac à sable Node pour tester la LOGIQUE PURE du moteur Apps Script (ADR-0006).
 *
 * Les fichiers `src/*.gs` sont du JavaScript (V8) mais tournent normalement dans Apps Script,
 * avec des globals Google (DriveApp, SpreadsheetApp, Utilities, Session…). Ici on les charge
 * dans un contexte `vm` isolé où ces globals sont MOCKÉS de façon déterministe. On peut alors
 * appeler les fonctions pures/décisionnelles et vérifier leur comportement — SANS modifier le
 * code source (le comportement testé est exactement celui déployé).
 *
 * Principe : au chargement, un `.gs` n'exécute que des déclarations (`function …`, `var CONFIG = …`).
 * Les appels aux globals Google sont TOUS à l'intérieur de fonctions → pas déclenchés au load.
 * On ne fournit donc que le strict nécessaire, et on stube le reste.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

/** Itérateur façon Apps Script (`hasNext()` / `next()`) sur un tableau. */
function iter(arr) {
  let i = 0;
  return {
    hasNext: () => i < (arr || []).length,
    next: () => arr[i++],
  };
}

/**
 * Faux dossier Drive. `parents` = tableau de faux dossiers ; `throwsParents` simule un
 * `getParents()` indisponible (racine / Drive partagé) — le cas qui a causé P1-17.
 */
function fakeFolder(id, parents, throwsParents) {
  return {
    getId: () => id,
    getParents: () => {
      if (throwsParents) throw new Error('getParents indisponible (racine/Drive partagé simulé)');
      return iter(parents || []);
    },
  };
}

/** Faux fichier Drive. */
function fakeFile(opts) {
  opts = opts || {};
  const name = opts.name != null ? opts.name : 'doc.pdf';
  const mime = opts.mime != null ? opts.mime : 'application/pdf';
  const parents = opts.parents || [];
  return {
    getName: () => name,
    getMimeType: () => mime,
    getId: () => opts.id || 'file-' + name,
    getParents: () => {
      if (opts.throwsParents) throw new Error('getParents indisponible (racine/Drive partagé simulé)');
      return iter(parents);
    },
  };
}

/**
 * Construit le bac à sable des globals Google (déterministes) + stubs.
 * @param {Object} overrides  remplacements/ajouts appliqués AVANT de charger les .gs.
 */
function makeSandbox(overrides) {
  const logs = [];
  const p2 = (n) => String(n).padStart(2, '0');
  const sandbox = {
    // Utilities.formatDate : on formate en UTC (les tests passent des dates UTC), déterministe.
    // Supporte les tokens utilisés par le moteur : yyyy, MM, dd.
    Utilities: {
      formatDate(date, tz, fmt) {
        return String(fmt)
          .replace(/yyyy/g, date.getUTCFullYear())
          .replace(/MM/g, p2(date.getUTCMonth() + 1))
          .replace(/dd/g, p2(date.getUTCDate()));
      },
    },
    Session: { getScriptTimeZone: () => 'UTC' },
    // On partage le Date de l'hôte pour que `new Date()` dans un .gs produise un objet
    // reconnu par `instanceof Date` côté test (sinon réalité vm ≠ réalité test → instanceof faux).
    Date,
    JSON,
    Math,
    // Stubs neutres — référencés seulement dans des chemins qu'on n'exerce pas en test pur.
    DriveApp: {}, SpreadsheetApp: {}, GmailApp: {}, MailApp: {}, UrlFetchApp: {},
    PropertiesService: {}, ScriptApp: {}, CacheService: {}, LockService: {},
    // Journal : stubs qui capturent (les gardes §1 loguent en cas d'erreur de lecture).
    journalErreur_: (src, msg) => logs.push(['ERREUR', src, msg]),
    journalInfo_: (src, msg) => logs.push(['INFO', src, msg]),
    console,
    __logs: logs,
  };
  if (overrides) Object.assign(sandbox, overrides);
  sandbox.globalThis = sandbox;
  return sandbox;
}

/**
 * Charge une liste de fichiers `.gs` (noms relatifs à `src/`) dans un contexte vm partagé.
 * @param {string[]} files
 * @param {Object} [overrides]  globals à injecter avant le chargement.
 * @return {Object} le contexte (les fonctions du moteur y sont des propriétés).
 */
function load(files, overrides) {
  const sandbox = makeSandbox(overrides);
  const context = vm.createContext(sandbox);
  for (const file of files) {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return context;
}

module.exports = { load, makeSandbox, iter, fakeFolder, fakeFile };
