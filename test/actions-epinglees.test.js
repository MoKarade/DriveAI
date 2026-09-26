// test/actions-epinglees.test.js — toute action de tout workflow est épinglée par un SHA de commit de 40 hex (le tag en commentaire) : un tag se déplace, un SHA non.
// Priorité : deploy.yml (CLASPRC_JSON, SCRIPT_ID) et sync-drive.yml (DRIVEAI_SYNC_SECRET) exécutent une action tierce AVEC des secrets.
// Lancer : node --test test/actions-epinglees.test.js   (zéro dépendance)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const WF = join(__dirname, "..", ".github", "workflows");
const workflows = readdirSync(WF).filter((f) => f.endsWith(".yml")).sort();

/** Toutes les lignes `uses:` d'un workflow (hors commentaires) : [{ligne, valeur, commentaire}]. */
function usages(texte) {
  const out = [];
  for (const ligne of texte.replace(/\r\n/g, "\n").split("\n")) {
    if (ligne.trim().startsWith("#")) continue;
    const m = /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(ligne);
    if (m) out.push({ ligne: ligne.trim(), valeur: m[1], commentaire: m[2] });
  }
  return out;
}

test("il y a des workflows et des actions à vérifier (anti-vacuité)", () => {
  assert.ok(workflows.includes("deploy.yml") && workflows.includes("sync-drive.yml"));
  assert.ok(workflows.flatMap((f) => usages(readFileSync(join(WF, f), "utf8"))).length >= 10);
});

for (const f of workflows) {
  test(`${f} : chaque action est épinglée par un SHA de 40 hex, le tag en commentaire`, () => {
    for (const u of usages(readFileSync(join(WF, f), "utf8"))) {
      if (u.valeur.startsWith("./")) continue;                                   // action locale du dépôt
      assert.match(u.valeur, /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, `non épinglée par SHA : ${u.ligne}`);
      assert.match(u.commentaire, /#\s*v\d/, `le tag doit rester en commentaire : ${u.ligne}`);
    }
  });
}

test("MUTATION : une action rétablie sur un tag mobile (@v7) ou une branche est détectée", () => {
  const texte = "steps:\n  - uses: actions/checkout@v7\n  - uses: actions/setup-node@main\n  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n";
  const mauvaises = usages(texte).filter((u) => !/@[0-9a-f]{40}$/.test(u.valeur));
  assert.deepEqual(mauvaises.map((u) => u.valeur), ["actions/checkout@v7", "actions/setup-node@main"]);
});
