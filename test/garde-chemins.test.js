// test/garde-chemins.test.js — l'auto-merge ne fusionne JAMAIS une PR qui touche un chemin sensible (dépôt PUBLIC, sans protection de branche, et chaque merge déploie le moteur).
// Lancer : node --test test/garde-chemins.test.js   (zéro dépendance)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const RACINE = join(__dirname, "..");
const chargement = import("../.github/scripts/garde-chemins.mjs");
const workflow = readFileSync(join(RACINE, ".github/workflows/auto-merge.yml"), "utf8").replace(/\r\n/g, "\n");

test("REFUSE chaque chemin sensible (workflows, deploy, sync, scripts de la CI, clasp, instructions des agents, réglages)", async () => {
  const { examinerChemins } = await chargement;
  for (const chemin of [
    ".github/workflows/auto-merge.yml", ".github/workflows/deploy.yml", ".github/workflows/sync-drive.yml", ".github/workflows/pousser-reset.yml", ".github/workflows/ci.yml",
    ".github/scripts/garde-chemins.mjs", ".github/scripts/secret-scan.sh", ".github/dependabot.yml", ".github/pull_request_template.md",
    ".clasp.json", ".clasp.json.example", "src/.clasp.json", "appsscript.json", "src/appsscript.json",
    "CLAUDE.md", "docs/CLAUDE.md", "AGENTS.md", ".claude/settings.json", "scripts/hooks/pre-commit.sh", ".husky/pre-push", "CODEOWNERS", ".github/CODEOWNERS", ".gitattributes", "vercel.json",
  ]) {
    const r = examinerChemins([chemin]);
    assert.equal(r.ok, false, chemin);
    assert.ok(r.raison.includes(chemin.toLowerCase()), chemin);
  }
});

test("accepte une PR de code ordinaire (moteur, tests, docs, application)", async () => {
  const { examinerChemins } = await chargement;
  assert.equal(examinerChemins(["src/Router.gs", "test/router.test.js", "docs/adr/0001.md", "app/src/App.tsx", "README.md", "api/hub/summary.ts"]).ok, true);
});

test("un seul chemin sensible parmi beaucoup suffit à refuser ; casse et séparateurs Windows ne trompent pas", async () => {
  const { examinerChemins } = await chargement;
  assert.equal(examinerChemins(["src/a.gs", "src/b.gs", ".github/workflows/deploy.yml"]).ok, false);
  assert.equal(examinerChemins([".GitHub\\Workflows\\deploy.yml"]).ok, false);
  assert.equal(examinerChemins(["Claude.MD"]).ok, false);
});

test("un renommage ou une suppression compte l'ANCIEN chemin comme le nouveau", async () => {
  const { examinerChemins } = await chargement;
  assert.equal(examinerChemins([{ filename: "src/x.yml", previous_filename: ".github/workflows/deploy.yml", status: "renamed" }]).ok, false);
  assert.equal(examinerChemins([{ filename: ".claude/settings.json", status: "removed" }]).ok, false);
});

test("échec FERMÉ : liste absente, vide, tronquée (3000), chemin douteux, entrée non textuelle", async () => {
  const { examinerChemins } = await chargement;
  for (const [nom, liste] of [["absente", undefined], ["non tableau", "src/a.gs"], ["vide", []], ["remontée", ["../x"]], ["absolu", ["/etc/passwd"]], ["Windows absolu", ["C:\\x.ts"]],
    ["octet de contrôle", ["src/a\u0000.gs"]], ["non textuelle", [42]], ["objet sans chemin", [{}]]]) {
    assert.equal(examinerChemins(liste).ok, false, nom);
  }
  assert.equal(examinerChemins(Array.from({ length: 3000 }, (_, i) => `src/f${i}.gs`)).ok, false);
  assert.equal(examinerChemins(Array.from({ length: 2999 }, (_, i) => `src/f${i}.gs`)).ok, true);
});

test("la liste garde ses indispensables (anti-vacuité) : le jour où l'un disparaît, ce test rougit", async () => {
  const { CHEMINS_INTERDITS } = await chargement;
  for (const attendu of [".github/**", ".clasp*", "appsscript.json", "CLAUDE.md", "AGENTS.md", ".claude/**", "CODEOWNERS", "vercel.json"]) assert.ok(CHEMINS_INTERDITS.includes(attendu), attendu);
});

test("ligne de commande : code 0 = permis, 1 = refus, 2 = entrée illisible (refus) ; les pages --slurp sont aplaties", async () => {
  const { principal } = await chargement;
  const pages = (fichiers) => JSON.stringify([fichiers.slice(0, 1), fichiers.slice(1)]);
  assert.equal(principal(pages([{ filename: "src/a.gs" }, { filename: "test/a.test.js" }])).code, 0);
  assert.equal(principal(pages([{ filename: "src/a.gs" }, { filename: ".github/workflows/deploy.yml" }])).code, 1);
  assert.equal(principal("pas du json").code, 2);
  assert.equal(principal("").code, 2);
  assert.equal(principal("[]").code, 1);
});

test("le workflow appelle la garde AVANT de fusionner, la lit SUR MAIN, et échoue fermé", () => {
  const garde = workflow.indexOf("garde-chemins.mjs?ref=main");
  const liste = workflow.indexOf("pulls/$number/files");
  const execution = workflow.indexOf('node "$garde_js"');
  const fusion = workflow.indexOf("merger\n");
  assert.ok(garde > -1 && liste > garde && execution > liste, "garde lue sur main, puis liste des fichiers, puis exécution");
  assert.ok(workflow.indexOf("gh pr merge") > execution, "la fusion vient APRÈS la garde");
  assert.ok(workflow.lastIndexOf("merger", workflow.length) > execution);
  assert.ok(fusion > execution, "l'appel de merger vient après la garde");
  assert.match(workflow, /--paginate --slurp/);
  for (const refus of ["garde de chemins illisible sur main", "liste des fichiers illisible", "auto-merge REFUSÉ : $raison_garde"]) assert.ok(workflow.includes(refus), refus);
  assert.ok(!workflow.includes("garde-chemins.mjs\" node"), "jamais exécutée depuis un checkout de la PR");
  assert.doesNotMatch(workflow, /actions\/checkout/);       // le code de la PR n'est jamais récupéré par ce workflow
});

test("le script de garde est lui-même protégé (.github/**) et la garde ne se désactive pas en silence", async () => {
  const { examinerChemins } = await chargement;
  assert.equal(examinerChemins([".github/scripts/garde-chemins.mjs"]).ok, false);
  assert.equal(examinerChemins([".github/workflows/auto-merge.yml"]).ok, false);
});
