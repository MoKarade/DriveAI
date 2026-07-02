/**
 * garde-fous.ts — MIROIR TS des garde-fous NON NÉGOCIABLES du moteur (CLAUDE.md §2, ADR-0008).
 *
 * L'app applique les corrections DIRECTEMENT sur Drive (choix de Marc : immédiateté) → les garde-fous
 * vivent donc en DEUX endroits (moteur Apps Script + ici). Cette duplication est le risque documenté
 * de l'ADR-0008 : elle n'est acceptable que si ce module reste (a) PUR (décisions sans effet de bord,
 * entièrement testé — vitest) et (b) aligné sur `src/Maintenance.gs` / `src/Entites.gs`. Toute
 * évolution des règles côté moteur DOIT être répercutée ici (et vice versa).
 *
 * Règles miroir :
 *  1. AUCUNE suppression — pas exprimée ici mais dans `google.ts` : la surface d'API n'expose
 *     AUCUNE méthode de suppression ni de mise à la corbeille (garde-fou par construction, vérifié par test).
 *  2. Zone protégée : un fichier dont la CHAÎNE D'ANCÊTRES touche `04 · Immigration` n'est JAMAIS
 *     détaché (multi-parents inclus) ; indéterminable = protégé (échec fermé, comme le mode strict
 *     du moteur). Déplacer VERS la zone protégée reste permis (enrichissement).
 *  3. Nommage : mêmes 3 granularités de date que le moteur (`AAAA_`, `AAAA-MM_`, `AAAA-MM-JJ_`).
 */

/** IDs des racines protégées (défaut : `04 · Immigration`, cf. docs/TAXONOMY.md). */
export const RACINES_PROTEGEES_DEFAUT = ['1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC'];

/**
 * Résultat d'une remontée d'ancêtres côté API : la liste des IDs rencontrés, et si la
 * remontée a pu être menée à terme (une branche illisible ⇒ incomplète).
 */
export interface Ascendance {
  ids: string[];
  complete: boolean;
}

/**
 * Décision PURE : le fichier peut-il être DÉTACHÉ de son emplacement actuel ?
 * Miroir de `aParentProtege_(f, proteges, strict=true)` (Maintenance.gs) : détection positive
 * → refus ; remontée INCOMPLÈTE → refus aussi (échec fermé — on ne détache jamais dans le doute).
 * @param ascendance ancêtres du fichier À SON EMPLACEMENT ACTUEL (tous parents confondus)
 * @param racinesProtegees IDs des racines de la zone protégée
 */
export function detachementAutorise(ascendance: Ascendance, racinesProtegees: string[]): boolean {
  if (!ascendance.complete) return false; // indéterminable = protégé (strict)
  return !ascendance.ids.some((id) => racinesProtegees.includes(id));
}

/**
 * Miroir de `normaliserCle_` (Entites.gs) : minuscules, sans accents, apostrophes → espace,
 * espaces compactés. Sert au matching d'entités et de domaines côté app.
 */
export function normaliserCle(s: unknown): string {
  if (s === null || s === undefined) return '';
  let t = String(s).toLowerCase();
  t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[’ʼ´']/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Miroir du prédicat « déjà rangé » du moteur (Maintenance.gs, 3 granularités du nommage par type).
 * Sert à VALIDER un renommage saisi dans l'app avant de l'appliquer.
 */
export function nomEstNormalise(nom: string): boolean {
  return /^\d{4}(-\d{2}){0,2}_/.test(nom);
}

/**
 * Valide une demande de reclassement AVANT tout appel Drive. Renvoie la liste des violations
 * (vide = autorisé). C'est LE point de passage obligé de l'app : `google.ts` refuse d'appliquer
 * un déplacement sans un verdict vide.
 */
export function verdictReclassement(args: {
  ascendanceActuelle: Ascendance;
  nouveauNom: string;
  racinesProtegees?: string[];
}): string[] {
  const violations: string[] = [];
  const proteges = args.racinesProtegees ?? RACINES_PROTEGEES_DEFAUT;
  if (!detachementAutorise(args.ascendanceActuelle, proteges)) {
    violations.push('zone-protegee'); // jamais détacher de 04 · Immigration (ou ascendance illisible)
  }
  if (!nomEstNormalise(args.nouveauNom)) {
    violations.push('nom-invalide'); // le nom final doit suivre la convention (3 granularités)
  }
  return violations;
}
