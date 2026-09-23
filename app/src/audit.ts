/**
 * audit.ts — C49-3, la PORTE de l'ADR-0061, côté app. PUR : aucun réseau, aucune horloge.
 *
 * ⚠️ POURQUOI CET ÉCRAN EXISTE. L'audit produit un onglet `AuditPieces` dans la Sheet, et la
 * colonne « Verdict » n'a de valeur que remplie par Marc — c'est tout le sens du mot PORTE :
 * personne d'autre ne peut dire si l'extraction a vu juste. Or il ne voit pas la Sheet, et il
 * ne veut rien lancer dans l'éditeur Apps Script (décision du 17/09). Sans surface ici, la
 * porte reste fermée par un détail d'outillage, pas par une décision.
 *
 * ⚠️ CE QUE CE MODULE NE FAIT PAS : juger. Un pré-juge automatique a été proposé et ÉCARTÉ par
 * Marc le 17/09 — un second modèle partagerait l'OCR du premier, donc il attraperait les
 * erreurs de RAISONNEMENT et jamais celles de LECTURE, qui sont précisément celles qui coûtent
 * cher sur `01` et `04`. Le verdict reste humain.
 *
 * ⚠️ Les valeurs de `01 · Administratif & identité` et `04 · Immigration` arrivent DÉJÀ
 * masquées (le moteur le fait à l'écriture, `masquerChampsAudit_`). Rien ici ne démasque quoi
 * que ce soit, et rien ne doit le faire : le lien du document est là pour ça, et il ouvre le
 * papier dans le compte de Marc plutôt que d'en recopier le contenu dans un tableau.
 */

/** Les colonnes de l'onglet, dans l'ordre où le moteur les écrit (`COLONNES_AUDIT_PIECE`). */
export const COL_AUDIT = {
  rang: 0, domaine: 1, fichier: 2, lien: 3, statut: 4,
  type: 5, emetteur: 6, dateDoc: 7, titulaire: 8, confiance: 9, champs: 10, resume: 11,
  verdict: 12, note: 13, champsFaux: 14,
} as const;

/**
 * Les champs que Marc peut déclarer FAUX sur un « à moitié ».
 *
 * ⚠️ Cette liste est la JUMELLE de `CHAMPS_JUGEABLES_AUDIT` (`src/AuditPiece.gs`), et un test
 * lit le `.gs` pour exiger qu'elles soient identiques. Rien d'autre ne les tient ensemble : le
 * moteur et l'app se déploient séparément, donc une case ajoutée d'un seul côté écrirait une
 * valeur que l'autre ne sait pas lire — sans erreur, comme toujours.
 *
 * ⚠️ `numeros` est la raison d'être de cette liste : « à moitié » ne disait pas si l'erreur
 * portait sur un libellé ou sur un numéro d'identité.
 */
export const CHAMPS_JUGEABLES: string[] = [
  'type', 'emetteur', 'date', 'titulaire',
  'montants', 'numeros', 'personnes', 'lieux',
  'resume',
];

/** La plage à lire — DÉRIVÉE du nombre de colonnes, jamais écrite en dur à côté. */
export const PLAGE_AUDIT = `A2:${String.fromCharCode(65 + COL_AUDIT.champsFaux)}`;

/** La colonne « Verdict (à toi) » en notation Sheet — DÉRIVÉE de l'index, jamais écrite en dur. */
export const LETTRE_COLONNE_VERDICT = String.fromCharCode(65 + COL_AUDIT.verdict); // 'M'
/** Idem pour « Champs faux (à toi) ». */
export const LETTRE_COLONNE_CHAMPS_FAUX = String.fromCharCode(65 + COL_AUDIT.champsFaux); // 'O'

export type Verdict = 'juste' | 'partiel' | 'faux';
export const VERDICTS: Verdict[] = ['juste', 'partiel', 'faux'];

export type LigneAudit = {
  /** Le numéro de LIGNE dans la Sheet (1-indexé, en-tête comprise) — la clé d'écriture. */
  ligneSheet: number;
  rang: string;
  domaine: string;
  fichier: string;
  lien: string;
  statut: string;
  type: string;
  emetteur: string;
  dateDoc: string;
  titulaire: string;
  confiance: string;
  champs: string;
  resume: string;
  verdict: string;
  note: string;
  /** Les champs déclarés faux, tels qu'écrits dans la Sheet (`numeros, date`). */
  champsFaux: string;
};

function cell(l: string[], i: number): string {
  return String(l[i] ?? '').trim();
}

/**
 * Transforme les valeurs brutes d'`A2:M` en lignes exploitables.
 *
 * ⚠️ L'API Sheets ne renvoie PAS les cellules vides de fin de ligne : une ligne « à faire »
 * arrive avec 5 colonnes, pas 13. Lire `l[11]` sans garde donne `undefined`, et `undefined`
 * dans une comparaison de verdict se lit comme « non jugé » par accident plutôt que par
 * décision — ici c'est explicite.
 */
export function lireLignesAudit(valeurs: string[][]): LigneAudit[] {
  return (valeurs ?? []).map((l, i) => ({
    ligneSheet: i + 2, // A2 est la première ligne de données
    rang: cell(l, COL_AUDIT.rang),
    domaine: cell(l, COL_AUDIT.domaine),
    fichier: cell(l, COL_AUDIT.fichier),
    lien: cell(l, COL_AUDIT.lien),
    statut: cell(l, COL_AUDIT.statut),
    type: cell(l, COL_AUDIT.type),
    emetteur: cell(l, COL_AUDIT.emetteur),
    dateDoc: cell(l, COL_AUDIT.dateDoc),
    titulaire: cell(l, COL_AUDIT.titulaire),
    confiance: cell(l, COL_AUDIT.confiance),
    champs: cell(l, COL_AUDIT.champs),
    resume: cell(l, COL_AUDIT.resume),
    verdict: cell(l, COL_AUDIT.verdict).toLowerCase(),
    note: cell(l, COL_AUDIT.note),
    champsFaux: cell(l, COL_AUDIT.champsFaux),
  })).filter((r) => r.fichier || r.statut); // une ligne vide n'est pas un document
}

export type CompteAudit = {
  total: number;
  /** Extraites : les SEULES jugeables — une ligne sans texte n'est pas un document mal lu. */
  extraits: number;
  aFaire: number;
  sansTexte: number;
  echecs: number;
  juste: number;
  partiel: number;
  faux: number;
  /** Extraites pas encore jugées — c'est ce qui reste à faire à Marc. */
  aJuger: number;
  /** Le taux de justesse, `null` tant que RIEN n'est jugé (jamais 0 % par défaut). */
  tauxJuste: number | null;
};

/**
 * Compte, et sépare ce qui ne se compare pas. « Non jugé » est une catégorie à PART : un audit à
 * moitié rempli ne doit pas ressembler à un audit dont la moitié est fausse.
 */
export function compterAudit(lignes: LigneAudit[]): CompteAudit {
  const c: CompteAudit = {
    total: lignes.length, extraits: 0, aFaire: 0, sansTexte: 0, echecs: 0,
    juste: 0, partiel: 0, faux: 0, aJuger: 0, tauxJuste: null,
  };
  for (const l of lignes) {
    if (l.statut === 'à faire') c.aFaire++;
    else if (l.statut === 'sans texte') c.sansTexte++;
    else if (l.statut === 'extrait') c.extraits++;
    else c.echecs++;
    if (l.statut !== 'extrait') continue;
    if (l.verdict === 'juste') c.juste++;
    else if (l.verdict === 'partiel') c.partiel++;
    else if (l.verdict === 'faux') c.faux++;
    else c.aJuger++;
  }
  const juges = c.juste + c.partiel + c.faux;
  if (juges > 0) c.tauxJuste = Math.round((c.juste / juges) * 100);
  return c;
}

/**
 * La prochaine ligne à juger, à partir d'une position. Rend `-1` quand il n'y a plus rien.
 *
 * ⚠️ Elle repart du DÉBUT après la fin (`depuis` dépassé) : sans ça, juger la dernière carte
 * laisserait des cartes sautées derrière soi, invisibles, et l'écran annoncerait « terminé »
 * avec des lignes non jugées — exactement le « 0 restant » qui ment.
 */
export function prochaineAJuger(lignes: LigneAudit[], depuis = 0): number {
  const jugeable = (l: LigneAudit) => l.statut === 'extrait' && !VERDICTS.includes(l.verdict as Verdict);
  for (let i = Math.max(0, depuis); i < lignes.length; i++) if (jugeable(lignes[i]!)) return i;
  for (let i = 0; i < Math.max(0, depuis) && i < lignes.length; i++) if (jugeable(lignes[i]!)) return i;
  return -1;
}

/** La cellule à écrire pour un verdict — la lettre DÉRIVÉE + le numéro de ligne. */
export function celluleVerdict(ligneSheet: number): string {
  return LETTRE_COLONNE_VERDICT + String(ligneSheet);
}

/** Idem pour les champs déclarés faux. */
export function celluleChampsFaux(ligneSheet: number): string {
  return LETTRE_COLONNE_CHAMPS_FAUX + String(ligneSheet);
}

/**
 * Sépare une cellule « champs faux » en liste. Tolérante sur la FORME (virgules, espaces, casse)
 * et stricte sur le FOND : ce que la liste des champs jugeables ne connaît pas est ÉCARTÉ.
 * Sans ça, une valeur tapée à la main dans la Sheet compterait comme un champ et fausserait le
 * seul tableau que cette porte produit.
 */
export function lireChampsFaux(cellule: string): string[] {
  return String(cellule || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => CHAMPS_JUGEABLES.includes(x));
}

/** L'écriture, dans l'ordre STABLE de la liste — pour que deux lignes se comparent à l'œil. */
export function ecrireChampsFaux(champs: string[]): string {
  return CHAMPS_JUGEABLES.filter((c) => champs.includes(c)).join(', ');
}

/**
 * Combien de fois chaque champ a été déclaré faux, sur les lignes JUGÉES.
 *
 * ⚠️ C'est ce tableau qui justifie tout le lot : « 12 documents à moitié » n'oriente aucun
 * correctif, « titulaire faux 8 fois, numéros 1 fois » en oriente un — et dit surtout si les
 * erreurs touchent ce qui est sensible ou seulement des libellés.
 */
export function compterChampsFaux(lignes: LigneAudit[]): { cle: string; n: number }[] {
  const par = new Map<string, number>();
  for (const l of lignes) {
    if (l.statut !== 'extrait') continue;
    for (const c of lireChampsFaux(l.champsFaux)) par.set(c, (par.get(c) ?? 0) + 1);
  }
  return CHAMPS_JUGEABLES.map((cle) => ({ cle, n: par.get(cle) ?? 0 })).filter((x) => x.n > 0);
}

/**
 * Les champs à MONTRER pour une ligne, dans l'ordre. Les vides sont OMIS plutôt qu'affichés à
 * « — » : sur un écran de téléphone, quatre tirets poussent hors de vue ce qu'il y a à juger.
 * ⚠️ `titulaire` et `champs` peuvent arriver masqués (`(9 chiffres)`) : on les affiche TELS
 * QUELS, c'est la forme qui se juge alors, et l'écran le dit.
 */
export function champsAMontrer(l: LigneAudit): { cle: string; valeur: string }[] {
  return [
    { cle: 'type', valeur: l.type },
    { cle: 'emetteur', valeur: l.emetteur },
    { cle: 'dateDoc', valeur: l.dateDoc },
    { cle: 'titulaire', valeur: l.titulaire },
    { cle: 'champs', valeur: l.champs },
  ].filter((x) => x.valeur && x.valeur !== '(absent)');
}

/** Le domaine est-il de ceux dont les valeurs nominatives sont masquées (`01`, `04`) ? */
export function domaineMasqueAudit(domaine: string): boolean {
  const n = String(domaine || '').trim().slice(0, 2);
  return n === '01' || n === '04';
}

/**
 * L'audit existe-t-il, vu depuis la ligne de Santé ? PURE.
 *
 * ⚠️ On lit la SANTÉ, jamais l'onglet : elle est déjà chargée par l'état global, donc savoir s'il
 * y a quelque chose à vérifier ne coûte AUCUNE requête. Ouvrir l'onglet pour l'apprendre ferait
 * payer une lecture Sheet à chaque affichage des réglages, pour une porte qu'on ne franchit
 * qu'une fois.
 *
 * ⚠️ Trois réponses, pas deux — « pas de ligne du tout » (le moteur n'a pas encore le code) et
 * « ligne présente mais jamais tourné » ne sont pas la même chose, et aucune des deux ne se dit
 * « il y a 0 document à vérifier ».
 */
export type EtatAuditSante =
  | { present: false }
  | { present: true; jamaisTourne: true }
  | { present: true; jamaisTourne: false; restants: number | null; motif: string };

const PREFIXE_SANTE_AUDIT = 'Audit des pièces';

export function auditDepuisSante(lignes: string[]): EtatAuditSante {
  const ligne = (lignes ?? []).find((l) => String(l).startsWith(PREFIXE_SANTE_AUDIT));
  if (!ligne) return { present: false };
  const apres = ligne.slice(ligne.indexOf(':') + 1).trim();
  if (/pas encore tourné/.test(apres)) return { present: true, jamaisTourne: true };
  const m = apres.match(/^(\d+)\s+restants/);
  return {
    present: true,
    jamaisTourne: false,
    restants: m ? Number(m[1]) : null,
    motif: apres,
  };
}
