/**
 * audit.test.ts — C49-3, la porte de l'ADR-0061 côté app.
 *
 * Ce que ces cas défendent :
 *   1. « non jugé » reste une catégorie à PART — un audit à moitié rempli ne doit pas ressembler
 *      à un audit dont la moitié est fausse ;
 *   2. un taux ne s'affiche pas tant que rien n'est jugé (jamais 0 % par défaut, §1 no-fake-data) ;
 *   3. seules les lignes EXTRAITES se jugent — un document sans texte n'est pas mal lu ;
 *   4. la carte suivante ne saute JAMAIS une ligne : sinon l'écran annonce « terminé » avec des
 *      documents non jugés derrière, et le verdict de la porte est faux ;
 *   5. la colonne d'écriture est DÉRIVÉE de la position du champ, jamais écrite en dur — un
 *      verdict posé dans la mauvaise colonne écraserait une valeur extraite.
 */
import { describe, it, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  lireLignesAudit, compterAudit, prochaineAJuger, celluleVerdict,
  champsAMontrer, domaineMasqueAudit, LETTRE_COLONNE_VERDICT, COL_AUDIT,
  auditDepuisSante, PLAGE_AUDIT,
  CHAMPS_JUGEABLES, celluleChampsFaux, lireChampsFaux, ecrireChampsFaux, compterChampsFaux,
} from '../src/audit';

/**
 * Une ligne de la Sheet. ⚠️ DÉRIVÉE de `COL_AUDIT` et non écrite à la main : la première
 * version était une liste positionnelle, et l'ajout de la colonne « Résumé » a décalé le
 * verdict d'un cran — six cas rouges pour une raison qui n'avait rien à voir avec ce qu'ils
 * défendaient. Une fixture qui recopie un ordre se périme exactement comme le code qui le
 * recopie (leçon du parc : dériver, ne jamais énumérer).
 */
const DEFAUTS: Record<string, string> = {
  rang: '1', domaine: '02 · Finances', fichier: 'doc.pdf',
  lien: 'https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAA/view',
  statut: 'extrait', type: 'facture', emetteur: 'Hydro', dateDoc: '2026-03-01',
  titulaire: 'Marc', confiance: '0.9', champs: 'montants : prime 1 240 $',
  resume: 'Facture d\'électricité pour juin.', verdict: '', note: '',
};

function ligne(o: Partial<Record<string, string>> = {}): string[] {
  const l: string[] = [];
  for (const [cle, index] of Object.entries(COL_AUDIT)) l[index as number] = o[cle] ?? DEFAUTS[cle] ?? '';
  return l;
}

describe('lecture des lignes', () => {
  it('une ligne TRONQUÉE par l\'API (cellules vides de fin non renvoyées) ne casse rien', () => {
    // L'API Sheets ne renvoie pas les cellules vides de fin : une ligne « à faire » arrive avec
    // 5 colonnes. Sans garde, `l[11]` vaut `undefined` et « non jugé » devient un accident.
    const [l] = lireLignesAudit([['3', '04 · Immigration', 'passeport.pdf', 'https://x', 'à faire']]);
    expect(l!.verdict).toBe('');
    expect(l!.resume).toBe('');
    expect(l!.type).toBe('');
    expect(l!.ligneSheet).toBe(2);
  });

  it('le numéro de ligne suit la position dans la Sheet, en-tête comprise', () => {
    const ls = lireLignesAudit([ligne(), ligne(), ligne()]);
    expect(ls.map((l) => l.ligneSheet)).toEqual([2, 3, 4]);
  });

  it('une ligne vide n\'est pas un document', () => {
    expect(lireLignesAudit([[], ['', '', ''], ligne()])).toHaveLength(1);
  });
});

describe('comptage', () => {
  it('« non jugé » est une catégorie à PART, jamais fondue dans « faux »', () => {
    const c = compterAudit(lireLignesAudit([
      ligne({ verdict: 'juste' }), ligne({ verdict: 'faux' }), ligne({ verdict: '' }),
    ]));
    expect(c).toMatchObject({ juste: 1, faux: 1, partiel: 0, aJuger: 1 });
  });

  it('seules les lignes EXTRAITES se jugent — sans texte et échec sont comptés à part', () => {
    const c = compterAudit(lireLignesAudit([
      ligne({ statut: 'extrait' }), ligne({ statut: 'sans texte' }),
      ligne({ statut: 'échec' }), ligne({ statut: 'à faire' }),
    ]));
    expect(c).toMatchObject({ extraits: 1, sansTexte: 1, echecs: 1, aFaire: 1, aJuger: 1 });
  });

  it('aucun taux tant que RIEN n\'est jugé — jamais 0 % par défaut', () => {
    expect(compterAudit(lireLignesAudit([ligne(), ligne()])).tauxJuste).toBeNull();
    expect(compterAudit(lireLignesAudit([ligne({ verdict: 'juste' })])).tauxJuste).toBe(100);
    expect(compterAudit(lireLignesAudit([
      ligne({ verdict: 'juste' }), ligne({ verdict: 'faux' }),
    ])).tauxJuste).toBe(50);
  });

  it('le taux se calcule sur les JUGÉES, pas sur le total — sinon il monte en jugeant', () => {
    // 1 juste sur 2 jugées + 8 non jugées : 50 %, jamais 10 %.
    const lignes = [ligne({ verdict: 'juste' }), ligne({ verdict: 'faux' }),
      ...Array.from({ length: 8 }, () => ligne())];
    expect(compterAudit(lireLignesAudit(lignes)).tauxJuste).toBe(50);
  });
});

describe('la carte suivante', () => {
  it('ne saute AUCUNE ligne : après la dernière, elle revient chercher les sautées', () => {
    const ls = lireLignesAudit([ligne(), ligne({ verdict: 'juste' }), ligne()]);
    expect(prochaineAJuger(ls, 0)).toBe(0);
    expect(prochaineAJuger(ls, 1)).toBe(2);   // saute celle qui est jugée
    expect(prochaineAJuger(ls, 3)).toBe(0);   // fin de liste ⇒ retour au début
  });

  it('rend -1 seulement quand il ne reste VRAIMENT rien', () => {
    const ls = lireLignesAudit([ligne({ verdict: 'juste' }), ligne({ verdict: 'partiel' })]);
    expect(prochaineAJuger(ls, 0)).toBe(-1);
    // Une ligne sans texte n'est pas « à juger » : elle ne doit pas retenir l'écran.
    expect(prochaineAJuger(lireLignesAudit([ligne({ statut: 'sans texte' })]), 0)).toBe(-1);
  });
});

describe('écriture', () => {
  it('la colonne du verdict est DÉRIVÉE de sa position — un décalage écraserait une extraction', () => {
    // ⚠️ Pas de lettre écrite en dur : le sujet est que la lettre SUIVE la position, sinon un
    // verdict s'écrit par-dessus une valeur extraite. La colonne a déjà bougé une fois (L → M,
    // quand « Résumé » est arrivée) et ce cas ne devait pas rougir pour ça.
    const attendue = String.fromCharCode(65 + COL_AUDIT.verdict);
    expect(LETTRE_COLONNE_VERDICT).toBe(attendue);
    expect(celluleVerdict(2)).toBe(attendue + '2');
    expect(celluleVerdict(101)).toBe(attendue + '101');
    // …et le verdict reste APRÈS tout ce que l'extraction écrit — le résumé est la dernière
    // cellule du moteur, les deux suivantes appartiennent à Marc.
    expect(COL_AUDIT.verdict).toBe(COL_AUDIT.resume + 1);
  });
});

describe('affichage', () => {
  it('les champs absents sont OMIS, pas affichés en tirets', () => {
    const [l] = lireLignesAudit([ligne({ emetteur: '', titulaire: '(absent)' })]);
    expect(champsAMontrer(l!).map((c) => c.cle)).toEqual(['type', 'dateDoc', 'champs']);
  });

  it('une valeur MASQUÉE reste affichée telle quelle — c\'est la forme qui se juge', () => {
    const [l] = lireLignesAudit([ligne({ domaine: '04 · Immigration', titulaire: '(7 lettres)' })]);
    expect(champsAMontrer(l!).find((c) => c.cle === 'titulaire')?.valeur).toBe('(7 lettres)');
  });

  it('les domaines masqués sont reconnus par leur PRÉFIXE, pas par leur libellé', () => {
    // Le libellé peut être renommé par le moteur (`assurerNomsDomaines_`), le numéro non.
    expect(domaineMasqueAudit('04 · Immigration')).toBe(true);
    expect(domaineMasqueAudit('01 · Administratif & identité')).toBe(true);
    expect(domaineMasqueAudit('04 · Immigration et citoyenneté')).toBe(true);
    expect(domaineMasqueAudit('02 · Finances')).toBe(false);
    expect(domaineMasqueAudit('')).toBe(false);
  });
});

describe('l\'audit vu depuis la ligne de Santé (zéro requête)', () => {
  it('pas de ligne du tout ⇒ le moteur n\'a pas encore ce code — ce n\'est pas « 0 à vérifier »', () => {
    expect(auditDepuisSante(['Dernier passage OK : 2026-09-17 09:46'])).toEqual({ present: false });
  });

  it('« jamais tourné » est un état à PART, jamais fondu dans « rien à faire »', () => {
    const e = auditDepuisSante(['Audit des pièces (C49-3) : aucune passe enregistrée — l\'audit n\'a pas encore tourné']);
    expect(e).toEqual({ present: true, jamaisTourne: true });
  });

  it('lit le nombre de documents restant à EXTRAIRE, et garde le motif tel quel', () => {
    const e = auditDepuisSante([
      'Documents au catalogue (Index) : 20342',
      'Audit des pièces (C49-3) : 66 restants · dernière passe : 27/5/2 (extraits/sans texte/échecs) — budget du jour épuisé — reprise demain · 8 des 8 min/j consommées',
    ]);
    expect(e).toMatchObject({ present: true, jamaisTourne: false, restants: 66 });
    expect((e as { motif: string }).motif).toContain('reprise demain');
  });

  it('un format inattendu ne rend pas un FAUX zéro — le compte est nul, pas inventé', () => {
    const e = auditDepuisSante(['Audit des pièces (C49-3) : ⚠️ état illisible (Error)']);
    expect(e).toMatchObject({ present: true, jamaisTourne: false, restants: null });
  });
});

/* ---------- Le grain fin du « à moitié » (C49-3, demande de Marc du 17/09) ---------- */

/**
 * Lit un tableau de littéraux dans le moteur, sur la source DÉCOMMENTÉE.
 *
 * ⚠️ Écrit après un rouge : le premier jet extrayait `'([^']+)'` sur la source BRUTE, et les
 * apostrophes de la prose française des commentaires (« l'app », « l'ANCIENNE ») comptaient
 * comme des littéraux — 16 colonnes au lieu de 15. C'est le piège `SCAN-QUI-MATCHE-LA-PROSE`
 * du parc, payé une fois de plus. L'anti-vacuité est explicite : un décommentage qui aurait
 * mangé le bloc rendrait une liste vide, et le test passerait en n'affirmant plus rien.
 */
function litteraux(gs: string, nom: string): string[] {
  const bloc = gs.match(new RegExp(`var ${nom} = \\[([\\s\\S]*?)\\];`));
  expect(bloc, `${nom} introuvable dans le moteur`).toBeTruthy();
  const sansCommentaires = bloc![1]!
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
  const trouves = [...sansCommentaires.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  expect(trouves.length, 'décommentage trop agressif — scan vacueux').toBeGreaterThan(0);
  return trouves;
}

test("la liste des champs jugeables est IDENTIQUE à celle du moteur", () => {
  // ⚠️ Le moteur et l'app se déploient SÉPARÉMENT. Une case ajoutée d'un seul côté écrirait une
  // valeur que l'autre ne sait pas lire — sans erreur, comme toujours. Rien d'autre que ce test
  // ne tient les deux listes ensemble : il lit le `.gs` pour de vrai.
  const gs = readFileSync(join(__dirname, '..', '..', 'src', 'AuditPiece.gs'), 'utf8');
  const duMoteur = litteraux(gs, 'CHAMPS_JUGEABLES_AUDIT');
  expect(CHAMPS_JUGEABLES).toEqual(duMoteur);
  // Et le champ pour lequel ce lot existe est bien là, des deux côtés.
  expect(duMoteur).toContain('numeros');
});

test("la colonne des champs faux est la DERNIÈRE — jamais une insertion qui décale", () => {
  // ⚠️ Le moteur écrit et l'app lit par INDEX. Une colonne insérée au milieu ferait lire chaque
  // valeur avec l'ancienne sémantique pendant la fenêtre entre les deux déploiements (C28-44) :
  // un verdict atterrirait dans « Résumé ». Ce test lit l'ordre RÉEL du moteur.
  const gs = readFileSync(join(__dirname, '..', '..', 'src', 'AuditPiece.gs'), 'utf8');
  const colonnes = litteraux(gs, 'COLONNES_AUDIT_PIECE');
  expect(colonnes.length).toBe(15);
  expect(colonnes[colonnes.length - 1]).toBe('Champs faux (à toi)');
  expect(COL_AUDIT.champsFaux).toBe(colonnes.length - 1);
  // La plage lue couvre bien la nouvelle colonne, sinon la valeur revient `undefined` sans erreur.
  expect(PLAGE_AUDIT).toBe('A2:O');
});

test("lireChampsFaux écarte ce qui n'est pas un champ connu", () => {
  expect(lireChampsFaux('numeros, titulaire')).toEqual(['numeros', 'titulaire']);
  expect(lireChampsFaux(' NUMEROS ,  date ')).toEqual(['numeros', 'date']);
  // Une valeur tapée à la main dans la Sheet ne doit pas compter comme un champ : elle
  // fausserait le seul tableau que cette porte produit.
  expect(lireChampsFaux('numeros, nimportequoi')).toEqual(['numeros']);
  expect(lireChampsFaux('')).toEqual([]);
});

test("ecrireChampsFaux rend un ordre STABLE, pour que deux lignes se comparent à l'œil", () => {
  expect(ecrireChampsFaux(['resume', 'type'])).toBe('type, resume');
  expect(ecrireChampsFaux(['type', 'resume'])).toBe('type, resume');
  expect(ecrireChampsFaux([])).toBe('');
});

test("compterChampsFaux ne compte QUE les lignes extraites", () => {
  const l = (statut: string, champsFaux: string, verdict = 'partiel') =>
    lireLignesAudit([[
      '1', '02 · Finances', 'f.pdf', '', statut,
      'facture', 'Hydro', '2026-07-01', 'Marc', '0.9', 'montants: 1', 'résumé',
      verdict, '', champsFaux,
    ]])[0]!;
  const lignes = [
    l('extrait', 'numeros, titulaire'),
    l('extrait', 'numeros'),
    // ⚠️ Une ligne « à faire » porterait un détail d'un passage PRÉCÉDENT : la compter
    // ferait remonter dans le tableau des erreurs qu'on vient justement de refaire.
    l('à faire', 'numeros, date'),
  ];
  expect(compterChampsFaux(lignes)).toEqual([
    { cle: 'titulaire', n: 1 },
    { cle: 'numeros', n: 2 },
  ]);
  expect(compterChampsFaux([])).toEqual([]);
});

test("celluleChampsFaux vise la bonne colonne", () => {
  expect(celluleChampsFaux(7)).toBe('O7');
  // Et jamais la même que le verdict — les écraser l'une l'autre perdrait le verdict.
  expect(celluleChampsFaux(7)).not.toBe(celluleVerdict(7));
});
