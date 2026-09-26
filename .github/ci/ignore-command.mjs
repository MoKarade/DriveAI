// ignore-command.mjs — « Ignored Build Step » de Vercel : pas de préversion inutile (chaque build compte dans le quota).
// Installation : vercel.json  { "ignoreCommand": "node modeles/vercel/ignore-command.mjs" }
// Convention de Vercel : code 0 = IGNORER le build, code 1 = CONSTRUIRE.
//
// On ignore SEULEMENT si on est certain :
//   - préversion (VERCEL_ENV=preview) d'une branche dependabot/ ou d'un auteur dependabot[bot] ;
//   - OU préversion dont TOUS les fichiers modifiés sont des `*.md`, `docs/**` ou `.github/**`.
// Échec fermé : dans tous les autres cas on construit — production, environnement inconnu, erreur de git, base introuvable,
// commit initial, liste de fichiers vide. Un changement de code (même mêlé à de la doc) construit toujours.
// Sans dépendance : Node et git seulement.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const IGNORER = 0;
export const CONSTRUIRE = 1;

/** Un fichier ne demande-t-il aucun build ? `*.md` (n'importe où), `docs/**`, `.github/**`. Chemins git : séparateur `/`. */
export function estDocumentation(chemin) {
  const c = String(chemin).replace(/\\/g, "/").replace(/^\.\//, "");
  if (c === "" || c.split("/").includes("..")) return false;
  const ext = extension(c);
  return ext === ".md" || (c.startsWith("docs/") && EXTENSIONS_DOC.has(ext)) || c.startsWith(".github/");
}

/** Extensions de documentation sous docs/ : texte, images, PDF SEULEMENT (même règle que modeles/ci/voie-rapide.mjs) ; un script, html, css, json ou yml sous docs/ construit. */
export const EXTENSIONS_DOC = new Set([".md", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".pdf"]);
function extension(c) { const nom = c.slice(c.lastIndexOf("/") + 1).toLowerCase(); const i = nom.lastIndexOf("."); return i > 0 ? nom.slice(i) : ""; }

export function estDependabot(env) {
  return String(env.VERCEL_GIT_COMMIT_REF || "").startsWith("dependabot/") || env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN === "dependabot[bot]";
}

/** Décision pure. `fichiers` : liste des fichiers modifiés, ou null si elle n'a pas pu être établie. */
export function decider({ env, fichiers }) {
  if (env.VERCEL_ENV !== "preview") return { code: CONSTRUIRE, raison: "pas une préversion (production ou inconnu) : on construit" };
  if (estDependabot(env)) return { code: IGNORER, raison: "préversion dependabot : ignorée" };
  if (!Array.isArray(fichiers)) return { code: CONSTRUIRE, raison: "liste des fichiers indisponible : on construit" };
  if (fichiers.length === 0) return { code: CONSTRUIRE, raison: "aucun fichier modifié détecté : on construit" };
  const code = fichiers.filter((f) => !estDocumentation(f));
  if (code.length === 0) return { code: IGNORER, raison: `${fichiers.length} fichier(s), tous de la documentation : ignorée` };
  return { code: CONSTRUIRE, raison: `${code.length} fichier(s) hors documentation : on construit` };
}

const REF_SURE = /^[0-9A-Za-z._\/-]{1,200}$/;

/** Fichiers modifiés entre la base et HEAD ; null au moindre doute. `git` est injectable pour les tests. */
export function fichiersModifies(env, git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 })) {
  const base = env.VERCEL_GIT_PREVIOUS_SHA || env.IGNORE_BASE || "";
  if (!REF_SURE.test(base)) return null;                                           // pas de base (commit initial, première construction) : doute
  try {
    git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);                 // base introuvable (clone superficiel) : doute
    const sortie = git(["diff", "--name-only", "-z", "--no-renames", base, "HEAD"]);   // -z : noms exacts (pas de guillemets quotepath) ; --no-renames : l'ancien ET le nouveau chemin comptent
    return sortie.split("\0").filter(Boolean);
  } catch { return null; }
}

export function main(env = process.env, git) {
  let decision;
  try { decision = decider({ env, fichiers: fichiersModifies(env, git) }); }
  catch { decision = { code: CONSTRUIRE, raison: "erreur inattendue : on construit" }; }
  console.log(`ignoreCommand : ${decision.code === IGNORER ? "IGNORER" : "CONSTRUIRE"} — ${decision.raison}`);
  return decision.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
