'use strict';
/**
 * VERROU DE SURFACE Tasks/Calendar — C28-48 (révision ADR-0022), exigence de la revue sécurité.
 *
 * Jusqu'ici l'invariant « CRÉATION uniquement, jamais les tâches/événements EXISTANTS de Marc »
 * tenait STRUCTURELLEMENT : `src/` ne contenait que deux URL vers ces API, toutes deux en `post`.
 * C28-48 introduit une exception ÉTROITE (une sonde de configuration en GET) — donc le précédent
 * « un GET sur ces API est acceptable » existe désormais. Or les scopes déclarés (`tasks`,
 * `calendar.events`) autorisent AUSSI `DELETE`/`PATCH` sur les vraies tâches et les vrais
 * événements de Marc. Ce test est le verrou (même rôle que `surface-gmail-ecriture.test.js`,
 * check requis) : il vérifie que l'exception reste exactement celle qui a été autorisée.
 *
 * Leçon §7 appliquée : « une exception à un garde-fou se livre ATOMIQUEMENT (ADR + constitution +
 * code + tripwire) », et « promesse de verrou = verrou codé dans le même commit ».
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

/** Scan RÉCURSIF : un futur sous-dossier de `src/` ne doit pas échapper au verrou. */
function fichiersSource_(dossier) {
  const resultat = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) resultat.push(...fichiersSource_(chemin));
    else if (entree.name.endsWith('.gs') || entree.name.endsWith('.json')) resultat.push(chemin);
  }
  return resultat;
}

const FICHIERS = fichiersSource_(SRC).map((f) => ({ nom: path.basename(f), texte: fs.readFileSync(f, 'utf8') }));

/** Hôtes/chemins des API Tasks & Calendar, sous quelque forme que ce soit. */
const HOTE_TASKS_CALENDAR = /tasks\.googleapis\.com|calendar\/v3|googleapis\.com\/tasks/;

/** Lignes de `src/` qui parlent à Tasks/Calendar (URL en dur — le moteur n'en construit pas). */
function lignesApi_() {
  const lignes = [];
  for (const f of FICHIERS) {
    f.texte.split('\n').forEach((ligne, i) => {
      if (HOTE_TASKS_CALENDAR.test(ligne)) lignes.push({ fichier: f.nom, n: i + 1, ligne });
    });
  }
  return lignes;
}

test('aucune URL Tasks/Calendar inattendue : les seules sont les 2 créations + les 2 sondes', () => {
  const lignes = lignesApi_();
  assert.ok(lignes.length > 0, 'garde-fou vivant : le test doit trouver les appels, pas passer à vide');
  // Chaque ligne doit être l'un des quatre points d'appel connus. Une 5ᵉ URL = revue obligatoire.
  const attendus = [
    /tasks\.googleapis\.com\/tasks\/v1\/lists\/@default\/tasks'/,          // création (Tasks.gs)
    /calendar\/v3\/calendars\/primary\/events'/,                           // création (Calendar.gs)
    /tasks\/v1\/lists\/@default\/tasks\/' \+ SONDE_CONFIG_ID/,             // sonde (GoogleApi.gs)
    /calendar\/v3\/calendars\/primary\/events\/' \+ SONDE_CONFIG_ID/,      // sonde (GoogleApi.gs)
  ];
  for (const l of lignes) {
    if (l.ligne.trim().startsWith('*') || l.ligne.trim().startsWith('//')) continue; // commentaires
    assert.ok(attendus.some((re) => re.test(l.ligne)),
      `URL Tasks/Calendar non prévue — ${l.fichier}:${l.n} : ${l.ligne.trim()}`);
  }
});

test('aucune MUTATION des tâches/événements existants de Marc (delete / patch / put)', () => {
  // On scanne les fichiers qui parlent à ces API, pas seulement la ligne d'URL : le verbe HTTP
  // est posé dans l'objet d'options, quelques lignes plus bas.
  const concernes = FICHIERS.filter((f) => HOTE_TASKS_CALENDAR.test(f.texte));
  assert.ok(concernes.length >= 2, 'les fichiers Tasks/Calendar sont bien scannés');
  for (const f of concernes) {
    for (const verbe of ['delete', 'patch', 'put']) {
      const re = new RegExp('method\\s*:\\s*[\'"]' + verbe + '[\'"]', 'i');
      assert.ok(!re.test(f.texte),
        `${f.nom} : verbe HTTP « ${verbe} » interdit sur Tasks/Calendar (mutation d'un élément de Marc)`);
    }
  }
});

test('le SEUL GET autorisé est la sonde, sur un identifiant LITTÉRAL et inexistant', () => {
  const googleApi = FICHIERS.find((f) => f.nom === 'GoogleApi.gs');
  assert.ok(googleApi, 'GoogleApi.gs présent');

  // (a) l'identifiant est un littéral : aucune interpolation ne peut le faire pointer sur un
  //     élément RÉEL de Marc (c'est toute la raison pour laquelle le GET est acceptable).
  const decl = googleApi.texte.match(/var SONDE_CONFIG_ID\s*=\s*(.+);/);
  assert.ok(decl, 'SONDE_CONFIG_ID déclaré');
  assert.match(decl[1].trim(), /^'[a-z0-9]+'$/,
    'SONDE_CONFIG_ID doit rester un littéral simple — ni concaténation, ni template, ni variable');

  // (b) tout `method: 'get'` de src/ vers ces API vit dans le bloc de la sonde.
  const concernes = FICHIERS.filter((f) => HOTE_TASKS_CALENDAR.test(f.texte));
  for (const f of concernes) {
    const gets = (f.texte.match(/method\s*:\s*['"]get['"]/gi) || []).length;
    if (f.nom === 'GoogleApi.gs') {
      assert.strictEqual(gets, 1, 'GoogleApi.gs : exactement UN get (la sonde), pas davantage');
      assert.ok(/SONDES_CONFIG_API/.test(f.texte) && /SONDE_CONFIG_ID/.test(f.texte));
    } else {
      assert.strictEqual(gets, 0, `${f.nom} : aucune LECTURE des tâches/événements de Marc`);
    }
  }
});

test('les en-têtes de Tasks.gs / Calendar.gs documentent l\'exception (doc ⇄ code, bidirectionnel)', () => {
  // Contre-poison de la leçon « promesse de verrou » : si un jour la sonde disparaît, ces
  // en-têtes doivent redevenir « jamais de lecture » — et si elle existe, ils doivent le dire.
  for (const nom of ['Tasks.gs', 'Calendar.gs']) {
    const f = FICHIERS.find((x) => x.nom === nom);
    assert.ok(/SONDE_CONFIG_ID/.test(f.texte.slice(0, 1200)),
      `${nom} : l'en-tête doit nommer l'exception de sonde tant qu'elle existe`);
  }
});

/* ---------- ADR-0041 : jeton du projet jobai (JetonJobai.gs) ---------- */

test('Tasks/Calendar/sonde utilisent le jeton JOBAI — jamais le jeton du script (ADR-0041)', () => {
  // Le projet GCP par défaut du script est CACHÉ : un `ScriptApp.getOAuthToken()` présenté à
  // Tasks/Calendar re-créerait EXACTEMENT l'incident 14-17/08 (403 config sur un projet
  // qu'aucune console ne peut administrer). Ces trois fichiers n'ont AUCUN usage légitime du
  // jeton du script.
  for (const nom of ['Tasks.gs', 'Calendar.gs', 'GoogleApi.gs']) {
    const f = FICHIERS.find((x) => x.nom === nom);
    assert.ok(!/getOAuthToken/.test(f.texte),
      `${nom} : jeton du script interdit sur Tasks/Calendar — utiliser jetonJobai_()`);
    assert.ok(/jetonJobai_\(\)/.test(f.texte), `${nom} : doit obtenir son jeton via jetonJobai_()`);
  }
});

test('le client_secret jobai ne transite QUE vers oauth2.googleapis.com (JetonJobai.gs)', () => {
  // (a) Les TROIS secrets jobai (client_secret, refresh token, access token en cache — ce dernier
  //     directement utilisable sur Tasks/Calendar depuis n'importe quel UrlFetchApp) ne se lisent
  //     que dans JetonJobai.gs — un futur fichier qui les lirait pour les envoyer ailleurs doit
  //     faire rougir ce verrou (revue sécurité B). Tasks/Calendar passent par
  //     `purgerCacheJetonJobai_()`, jamais par la Property.
  for (const f of FICHIERS) {
    if (f.nom === 'JetonJobai.gs') continue;
    for (const cle of ['DriveAI_JOBAI_CLIENT_SECRET', 'DriveAI_JOBAI_REFRESH', 'DriveAI_JOBAI_ACCES']) {
      assert.ok(!f.texte.includes(cle), `${f.nom} : ${cle} ne se lit que dans JetonJobai.gs`);
    }
  }
  // (b) Dans JetonJobai.gs, TOUT appel réseau vise `JOBAI_URL_JETON`, et cette constante est le
  //     LITTÉRAL du endpoint de jeton Google — ni concaténation, ni variable (même exigence que
  //     SONDE_CONFIG_ID : aucune interpolation ne peut détourner le secret vers un autre hôte).
  const jj = FICHIERS.find((x) => x.nom === 'JetonJobai.gs');
  assert.ok(jj, 'JetonJobai.gs présent');
  const decl = jj.texte.match(/var JOBAI_URL_JETON\s*=\s*(.+);/);
  assert.ok(decl, 'JOBAI_URL_JETON déclarée');
  assert.strictEqual(decl[1].trim(), "'https://oauth2.googleapis.com/token'");
  const fetchs = jj.texte.match(/UrlFetchApp\.fetch\(\s*[^,\s]+/g) || [];
  assert.ok(fetchs.length >= 2, 'les deux appels (refresh + échange de code) sont bien scannés');
  for (const appel of fetchs) {
    assert.ok(appel.includes('JOBAI_URL_JETON'),
      `appel réseau hors du endpoint de jeton dans JetonJobai.gs : ${appel}`);
  }
});
