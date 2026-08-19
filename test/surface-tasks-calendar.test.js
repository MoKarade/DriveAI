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
  // ANCRÉS EN FIN (revue sécurité, mutation prouvée) : sans l'ancre, `… + SONDE_CONFIG_ID_TASKS +
  // idTacheDeMarc` passait le test — le tripwire promettait « aucune interpolation ne peut viser un
  // élément RÉEL » sans le prouver. L'URL doit donc se TERMINER là où le motif s'arrête.
  const attendus = [
    /tasks\.googleapis\.com\/tasks\/v1\/lists\/@default\/tasks',?$/,          // création (Tasks.gs)
    /calendar\/v3\/calendars\/primary\/events',?$/,                           // création (Calendar.gs)
    /tasks\/v1\/lists\/@default\/tasks\/' \+ SONDE_CONFIG_ID_TASKS \},?$/,     // sonde (GoogleApi.gs)
    /calendar\/v3\/calendars\/primary\/events\/' \+ SONDE_CONFIG_ID_CALENDAR \},?$/, // sonde
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
  for (const nom of ['SONDE_CONFIG_ID_TASKS', 'SONDE_CONFIG_ID_CALENDAR']) {
    const decl = googleApi.texte.match(new RegExp('var ' + nom + '\\s*=\\s*(.+);'));
    assert.ok(decl, nom + ' déclaré');
    assert.match(decl[1].trim(), /^'[A-Za-z0-9_-]+'$/,
      nom + ' doit rester un littéral simple — ni concaténation, ni template, ni variable');
  }

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

test('chaque identifiant sondé est VALIDE pour la grammaire de SON API (sinon 400 ⇒ sonde stérile)', () => {
  // Leçon du 19/08 (1ᵉʳ usage réel) : un SEUL identifiant partagé par les deux sondes. Il était
  // valide pour Calendar (base32hex) mais IMPOSSIBLE pour Tasks (base64url, longueur ≡ 1 mod 4)
  // ⇒ HTTP 400 à chaque sonde ⇒ verdict « indeterminé » perpétuel ⇒ la reprise automatique de la
  // reprise RAPIDE (≤ 13 min) était supprimée en silence — il ne restait que l'expiration de la
  // fenêtre de 24 h, tardive et à l'aveugle, avec un message Santé périmé entre-temps. Ce test
  // verrouille la GRAMMAIRE (charset + longueur), jamais la valeur. ⚠️ Il verrouille une RÈGLE
  // INFÉRÉE d'une observation : la seule preuve qu'une sonde conclut vraiment reste le verdict
  // `dernière sonde` en PROD (onglet Santé / `intentionsSonde` du MCP), jamais la CI.
  const googleApi = FICHIERS.find((f) => f.nom === 'GoogleApi.gs');
  const val = (nom) => googleApi.texte.match(new RegExp("var " + nom + "\\s*=\\s*'([^']+)'"))[1];

  // Calendar : « base32hex » — lettres a-v et chiffres 0-9, 5 à 1024 caractères (doc Google).
  const cal = val('SONDE_CONFIG_ID_CALENDAR');
  assert.match(cal, /^[a-v0-9]{5,1024}$/,
    'ID Calendar hors grammaire base32hex (a-v, 0-9) ⇒ 400 au lieu du 404 attendu');
  // …et il reste NOTRE libellé (revue sécurité : sans ça, un ID d'aspect réel — donc possiblement
  // un VRAI événement de Marc — passait le test, la grammaire seule ne prouvant pas l'inexistence).
  assert.match(cal, /driveai/i, 'l\'ID Calendar doit rester notre libellé, jamais une valeur opaque');

  // Tasks : identifiant OPAQUE base64url. Une longueur ≡ 1 (mod 4) ne peut PAS être du base64.
  const tsk = val('SONDE_CONFIG_ID_TASKS');
  assert.match(tsk, /^[A-Za-z0-9_-]+$/, 'ID Tasks hors alphabet base64url');
  assert.notStrictEqual(tsk.length % 4, 1,
    'longueur ≡ 1 (mod 4) : base64 impossible ⇒ HTTP 400 ⇒ la sonde ne conclurait jamais');

  // …et il reste INEXISTANT par construction : décodé, ce n'est pas la forme d'un vrai ID Tasks
  // (« <liste>:<n>:<n> ») mais notre propre libellé — impossible de viser une tâche de Marc.
  const clair = Buffer.from(tsk.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.match(clair, /DriveAI/i, 'l\'ID Tasks doit rester notre libellé, jamais une valeur opaque');
  assert.ok(clair.indexOf(':') === -1, 'un ID Tasks RÉEL contient des « : » — le nôtre ne doit pas');

  // Les deux identifiants sont DISTINCTS : c'est tout l'objet du correctif.
  assert.notStrictEqual(cal, tsk, 'un identifiant partagé re-crée le bug (grammaires différentes)');
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

/* ---------- ADR-0041 : jeton du projet hubperso (JetonHubperso.gs) ---------- */

test('Tasks/Calendar/sonde utilisent le jeton HUBPERSO — jamais le jeton du script (ADR-0041)', () => {
  // Le projet GCP par défaut du script est CACHÉ : un `ScriptApp.getOAuthToken()` présenté à
  // Tasks/Calendar re-créerait EXACTEMENT l'incident 14-17/08 (403 config sur un projet
  // qu'aucune console ne peut administrer). Ces trois fichiers n'ont AUCUN usage légitime du
  // jeton du script.
  for (const nom of ['Tasks.gs', 'Calendar.gs', 'GoogleApi.gs']) {
    const f = FICHIERS.find((x) => x.nom === nom);
    assert.ok(!/getOAuthToken/.test(f.texte),
      `${nom} : jeton du script interdit sur Tasks/Calendar — utiliser jetonHubperso_()`);
    assert.ok(/jetonHubperso_\(\)/.test(f.texte), `${nom} : doit obtenir son jeton via jetonHubperso_()`);
  }
});

test('le client_secret hubperso ne transite QUE vers oauth2.googleapis.com (JetonHubperso.gs)', () => {
  // (a) Les TROIS secrets hubperso (client_secret, refresh token, access token en cache — ce dernier
  //     directement utilisable sur Tasks/Calendar depuis n'importe quel UrlFetchApp) ne se lisent
  //     que dans JetonHubperso.gs — un futur fichier qui les lirait pour les envoyer ailleurs doit
  //     faire rougir ce verrou (revue sécurité B). Tasks/Calendar passent par
  //     `purgerCacheJetonHubperso_()`, jamais par la Property.
  for (const f of FICHIERS) {
    if (f.nom === 'JetonHubperso.gs') continue;
    for (const cle of ['DriveAI_HUBPERSO_CLIENT_SECRET', 'DriveAI_HUBPERSO_REFRESH', 'DriveAI_HUBPERSO_ACCES']) {
      assert.ok(!f.texte.includes(cle), `${f.nom} : ${cle} ne se lit que dans JetonHubperso.gs`);
    }
  }
  // (b) Dans JetonHubperso.gs, TOUT appel réseau vise `HUBPERSO_URL_JETON`, et cette constante est le
  //     LITTÉRAL du endpoint de jeton Google — ni concaténation, ni variable (même exigence que
  //     SONDE_CONFIG_ID : aucune interpolation ne peut détourner le secret vers un autre hôte).
  const jj = FICHIERS.find((x) => x.nom === 'JetonHubperso.gs');
  assert.ok(jj, 'JetonHubperso.gs présent');
  const decl = jj.texte.match(/var HUBPERSO_URL_JETON\s*=\s*(.+);/);
  assert.ok(decl, 'HUBPERSO_URL_JETON déclarée');
  assert.strictEqual(decl[1].trim(), "'https://oauth2.googleapis.com/token'");
  const fetchs = jj.texte.match(/UrlFetchApp\.fetch\(\s*[^,\s]+/g) || [];
  assert.ok(fetchs.length >= 2, 'les deux appels (refresh + échange de code) sont bien scannés');
  for (const appel of fetchs) {
    assert.ok(appel.includes('HUBPERSO_URL_JETON'),
      `appel réseau hors du endpoint de jeton dans JetonHubperso.gs : ${appel}`);
  }
});
