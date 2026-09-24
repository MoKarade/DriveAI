// Règles d'architecture (porte qualité de l'Atelier, S6, 24/09/2026) — adaptées à DriveAI :
// une SPA Vite (app/src) + des fonctions Vercel (../api) + des tests (app/test).
// But : que la structure décrite dans docs/ARCHITECTURE.md reste VRAIE à mesure que le code grandit.
// Cliquet : le nombre de violations au jour de la mise en place est figé dans qualite/seuils.json
// (architecture.violations) ; il peut baisser, jamais monter.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "pas-de-cycle",
      comment: "Deux modules qui s'importent mutuellement : l'ordre de chargement devient fragile.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "pas-d-import-introuvable",
      comment: "Un import qui ne se résout vers rien casse au build ou, pire, à l'exécution.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "api-sans-paquet-npm",
      comment:
        "Les fonctions Vercel de api/ sont déployées SANS installation (vercel.json : installCommand \"true\") : " +
        "un paquet npm importé là casse la production. Seuls node:* et les fichiers relatifs sont permis.",
      severity: "error",
      from: { path: "(^|/)api/" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-no-pkg", "npm-unknown"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "navigateur-sans-code-serveur",
      comment: "L'app (servie au navigateur) n'embarque jamais le code des fonctions serveur (jetons, secrets OAuth).",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "(^|/)api/" },
    },
    {
      name: "logique-sans-ecran",
      comment: "Les modules de logique (src/*.ts) ne connaissent pas les écrans (.tsx) : c'est l'inverse.",
      severity: "error",
      from: { path: "^src/[^/]+\\.ts$" },
      to: { path: "\\.tsx$" },
    },
    {
      name: "tests-hors-du-code-servi",
      comment: "Le code servi n'importe jamais un test.",
      severity: "error",
      from: { path: "^src/|(^|/)api/" },
      to: { path: "^(test|e2e)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|coverage|dist|e2e-results)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "types"] },
  },
};
