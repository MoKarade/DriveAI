// test/structure-doc.test.js — la structure commune (étape 2) tient : CLAUDE.md court, texte complet dans docs/claude/, index à jour, ignoreCommand Vercel branché.
// Lancer : node --test test/structure-doc.test.js   (zéro dépendance ; dépôt PUBLIC : aucune donnée personnelle dans la doc)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const RACINE = join(__dirname, "..");
const lire = (f) => readFileSync(join(RACINE, f), "utf8").replace(/\r\n/g, "\n");

test("CLAUDE.md reste court : 60 lignes et 10 Ko au plus (il se charge à chaque session)", () => {
  const t = lire("CLAUDE.md");
  const lignes = t.endsWith("\n") ? t.slice(0, -1).split("\n").length : t.split("\n").length;
  assert.ok(lignes <= 60, `${lignes} lignes`);
  assert.ok(Buffer.byteLength(t, "utf8") <= 10 * 1024);
});

test("le texte complet de l'ancien CLAUDE.md vit dans docs/claude/ (numérotation §N inchangée) et CLAUDE.md y renvoie", () => {
  const fichiers = readdirSync(join(RACINE, "docs", "claude"));
  for (const attendu of ["01-principes.md", "02-conventions.md", "03-workflow-git.md", "04-commandes.md", "05-verifications.md", "06-deploiement.md", "07-hub.md", "08-documentation.md", "lecons.md", "10-style-compte-rendu.md", "11-protocole-de-precision.md"]) {
    assert.ok(fichiers.includes(attendu), attendu);
    assert.ok(lire("CLAUDE.md").includes(attendu.replace(/\.md$/, "")) || attendu === "lecons.md", `CLAUDE.md ne renvoie pas à ${attendu}`);
  }
  assert.ok(lire("docs/claude/lecons.md").length > 100000, "les leçons (§9) sont bien là, pas résumées");
  assert.ok(lire("CLAUDE.md").includes("docs/claude/lecons.md"));
});

test("les passages personnels retirés du dépôt public laissent une ligne neutre, jamais leur contenu ; aucun secret évident dans la doc", () => {
  const texte = ["CLAUDE.md", ...readdirSync(join(RACINE, "docs", "claude")).map((f) => `docs/claude/${f}`)].map(lire).join(" ");
  assert.equal(texte.split("passage retiré : donnée personnelle, voir la liste privée").length - 1, 4);
  for (const motif of [/ghp_[A-Za-z0-9]{20}/, /sk-ant-[A-Za-z0-9_-]{20}/, /AIza[0-9A-Za-z_-]{30}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /GOCSPX-[A-Za-z0-9_-]{20}/]) assert.doesNotMatch(texte, motif);
});

test("docs/INDEX.md est généré et à jour, les correspondances existent", () => {
  assert.ok(existsSync(join(RACINE, "docs", "INDEX.md")));
  const correspondance = lire("docs/correspondance.md");
  for (const m of correspondance.matchAll(/\| (docs\/claude\/[^ |]+) \|/g)) assert.ok(existsSync(join(RACINE, m[1])), m[1]);
});

test("vercel.json : ignoreCommand branché sur la copie sous .github/ci ; les réglages existants sont intacts", async () => {
  const config = JSON.parse(lire("vercel.json"));
  assert.equal(config.ignoreCommand, "node .github/ci/ignore-command.mjs");
  assert.equal(config.buildCommand, "cd app && npm ci && npm run build");
  assert.equal(config.outputDirectory, "app/dist");
  assert.deepEqual(config.git.deploymentEnabled, { "claude/*": false });
  const { decider, CONSTRUIRE, IGNORER } = await import("../.github/ci/ignore-command.mjs");
  assert.equal(decider({ env: { VERCEL_ENV: "preview" }, fichiers: ["README.md", "docs/a.md"] }).code, IGNORER);
  assert.equal(decider({ env: { VERCEL_ENV: "preview" }, fichiers: ["app/src/App.tsx"] }).code, CONSTRUIRE);
  assert.equal(decider({ env: { VERCEL_ENV: "production" }, fichiers: ["README.md"] }).code, CONSTRUIRE);
  assert.equal(decider({ env: {}, fichiers: null }).code, CONSTRUIRE);
});

test("la CI exécute la documentation légère ; l'auto-merge et le déploiement ne sont PAS touchés par ce lot", () => {
  const ci = lire(".github/workflows/ci.yml");
  assert.ok(ci.includes("node .github/ci/verifier-longueur.mjs CLAUDE.md"));
  assert.ok(ci.includes("node .github/ci/generer-index.mjs --verifier"));
  assert.doesNotMatch(ci, /\bpaths(-ignore)?\s*:/);
});
