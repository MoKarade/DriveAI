/**
 * corbeille.ts — L'UNIQUE porte de mise à la corbeille de TOUTE l'app (ADR-0014, révision
 * ÉTROITE du §2 validée par Marc le 2026-07-06). Périmètre : un DOSSIER devenu VIDE après une
 * réorg validée (ligne `vide-candidat`), au CLIC de Marc — récupérable 30 jours dans la
 * corbeille Drive. Jamais un fichier, jamais un dossier non vide, jamais la zone protégée,
 * jamais une racine système, jamais la suppression DÉFINITIVE (interdite partout, y compris ici).
 *
 * Ce fichier est le SEUL de `src/` autorisé à porter `trashed: true` — verrouillé par le
 * tripwire de `test/aucune-suppression.test.ts` (exception chirurgicale + cohérence
 * CLAUDE.md §2 ↔ ce fichier, dans les deux sens). Le verdict est PUR et testé : l'action
 * réseau ne part que sur verdict vide, avec des données RE-VÉRIFIÉES en direct au clic
 * (une ligne `vide-candidat` est un candidat, jamais une preuve — le moteur a pu re-remplir
 * le dossier entre-temps).
 */

import { Ascendance, RACINES_PROTEGEES_DEFAUT, IDS_STRUCTURELS_DEFAUT } from './garde-fous';
import { MIME_DOSSIER } from './explorateur';
import { api, lireFichier, remonterAscendance, viderCachePlages, DRIVE } from './google';

/**
 * Verdict PUR (testé) : ce dossier peut-il partir à la corbeille ? Liste des violations
 * (vide = autorisé). Toutes les données viennent d'une re-lecture LIVE faite par l'appelant.
 */
export function verdictCorbeille(args: {
  id: string;
  nom: string;
  mimeType: string;
  nbEnfants: number; // 0 ou 1 (compte BORNÉ pageSize=1) — tous statuts confondus, corbeillés inclus
  ascendance: Ascendance;
  racinesProtegees?: string[];
  idsStructurels?: string[];
}): string[] {
  const violations: string[] = [];
  if (args.mimeType !== MIME_DOSSIER) violations.push('pas-un-dossier');
  if (args.nbEnfants > 0) violations.push('non-vide');
  const proteges = args.racinesProtegees ?? RACINES_PROTEGEES_DEFAUT;
  // Identité D'ABORD (la racine protégée elle-même n'est pas dans sa propre ascendance),
  // puis ascendance ; chaîne illisible = protégé (échec fermé).
  if (proteges.includes(args.id) || !args.ascendance.complete ||
      args.ascendance.ids.some((id) => proteges.includes(id))) {
    violations.push('zone-protegee');
  }
  const structurels = args.idsStructurels ?? IDS_STRUCTURELS_DEFAUT;
  if (structurels.includes(args.id)) {
    violations.push('dossier-structurel'); // ID fixe du router (Logement/Véhicule) — jamais corbeillé
  }
  const nom = args.nom.trim();
  if (nom.charAt(0) === '_' || /^\d{2} · /.test(nom)) {
    violations.push('racine-systeme'); // _Doublons/_Médias/…, 00 · files, NN · domaines
  }
  return violations;
}

/**
 * Verdict d'une tentative de corbeille qui N'A PAS abouti : que fait-on de la ligne ? PURE (testée).
 *
 * Pourquoi cette fonction existe (C28-93) : le lot s'arrêtait à la PREMIÈRE exception, et la liste
 * de Marc commençait par un dossier nommé `02 · Finances` — refusé par son nom. Le bouton « tout
 * corbeiller (124) » ne corbeillait donc RIEN, sans qu'on puisse le deviner. Un refus n'est pas une
 * panne : c'est un VERDICT sur UNE ligne, et il doit retirer cette ligne de la liste en disant
 * pourquoi, pas arrêter les 123 suivantes.
 *
 * Le statut rendu n'est jamais `vide-candidat` : la ligne quitte la liste dans tous les cas où on
 * sait conclure. `null` = on ne sait pas (réseau, quota, session) ⇒ la ligne RESTE candidate et
 * sera re-tentée : une incertitude ne se transforme pas en verdict.
 */
export function statutRefusCorbeille(message: string): string | null {
  const brut = String(message);
  if (brut.includes('Google API 404')) return 'vide-disparu';   // déjà supprimé/corbeillé ailleurs
  if (brut.includes('non-vide')) return 'vide-repris';          // le classement l'a re-rempli
  if (brut.includes('zone-protegee') || brut.includes('racine-systeme') ||
      brut.includes('dossier-structurel') || brut.includes('pas-un-dossier')) {
    return 'vide-protégé';                                      // ne devait jamais être proposé
  }
  return null;                                                  // transitoire : on re-tentera
}

/**
 * Compte STRICT des enfants directs : la requête ne filtre PAS `trashed` — un dossier dont il
 * ne reste que des éléments corbeillés n'est PAS vide (les corbeiller avec serait une décision
 * que personne n'a validée).
 */
async function compterEnfantsStrict(folderId: string): Promise<number> {
  const sain = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${sain}' in parents`,
    fields: 'files(id)',
    pageSize: '1',
  });
  const r = await api<{ files?: { id: string }[] }>(`${DRIVE}?${params.toString()}`);
  return (r.files ?? []).length;
}

/**
 * Met à la corbeille un dossier VIDE (ADR-0014) après re-vérification complète au clic.
 * @throws si le verdict n'est pas vide (l'appelant affiche les violations).
 */
export async function corbeillerDossierVide(folderId: string, racinesProtegees?: string[]): Promise<void> {
  if (!folderId || !folderId.trim()) throw new Error('Corbeille refusée (ADR-0014) : id manquant');
  const [meta, nbEnfants, ascendance] = await Promise.all([
    lireFichier(folderId),
    compterEnfantsStrict(folderId),
    remonterAscendance(folderId),
  ]);
  const violations = verdictCorbeille({
    id: folderId,
    nom: meta.name,
    mimeType: meta.mimeType ?? '',
    nbEnfants,
    ascendance,
    racinesProtegees,
  });
  if (violations.length > 0) {
    throw new Error(`Corbeille refusée (ADR-0014) : ${violations.join(', ')}`);
  }
  viderCachePlages();
  await api(`${DRIVE}/${folderId}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }), // corbeille Drive — récupérable 30 j, jamais définitif
  });
}
