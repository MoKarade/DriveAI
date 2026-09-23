/**
 * etat.ts — lecture TYPÉE de l'état DriveAI (la Google Sheet) : Santé, Index, Journal, Entités.
 *
 * PUR côté parsing (testé) : les fonctions `interpreter*` transforment des lignes brutes
 * (string[][]) en modèles — aucun appel réseau ici, `charger*` (effectful) vit dans les vues.
 * ADR-0007 : on ne lit que des MÉTADONNÉES (l'état n'a jamais contenu de corps de document).
 */

import { normaliserCle } from './garde-fous';

/* ---------- Santé (onglet lisible, lignes libres) ---------- */

export interface Sante {
  lignes: string[];
}

export function interpreterSante(brut: string[][]): Sante {
  return { lignes: brut.map((l) => l[0] ?? '').filter(Boolean) };
}

/* ---------- Index (catalogue) ---------- */

export interface LigneIndex {
  cle: string;
  traiteLe: string;
  fichier: string;
  domaine: string;
  chemin: string;
  statut: string;
  confiance: string; // colonne H (#17) — '' pour les lignes sans classification LLM
}

/**
 * Statut PRODUIT lisible : les statuts TECHNIQUES du reset (`tri33-route`, `tri33-04-route`,
 * `tri33-doublon`, `tri33-reste`…) sont ramenés à leur sens fonctionnel. Nécessaire depuis que
 * `cleEtatIndex` regroupe les états d'un fichier sur le fichier : sans ça, un doc RANGÉ par le reset
 * (statut `tri33-route`) ne comptait plus comme « classé » → il disparaissait de « derniers
 * classements » (accueil) et polluait le sélecteur de statuts (revue Vague 1 app 2026-07-31). Les
 * gardes rares (protégé, multi-parents, écart, absent) gardent leur libellé technique. PURE.
 */
export function statutLisible(statut: string): string {
  switch (statut) {
    case 'tri33-route': case 'tri33-04-route': return 'classé';
    case 'tri33-doublon': return 'doublon';
    case 'tri33-reste': case 'tri33-04-reste': return 'à trier';
    default: return statut;
  }
}

export function interpreterIndex(brut: string[][]): LigneIndex[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      traiteLe: l[1] ?? '',
      fichier: l[2] ?? '',
      domaine: l[3] ?? '',
      chemin: l[4] ?? '',
      statut: statutLisible(l[5] ?? ''),
      confiance: l[7] ?? '',
    }));
}

/**
 * Identité d'ÉTAT d'une ligne d'Index (P1/C28-02) : l'Index est APPEND-ONLY côté moteur — un même
 * fil Gmail (clé `tri|<fil>|<ts>|<lu>`, une ligne PAR état) ou un même fichier re-traité
 * (`drive|<id>` puis `migre|<tag>|<id>`, ou ligne de réconciliation future) produit PLUSIEURS
 * lignes. Pour afficher l'ÉTAT COURANT, on regroupe par l'entité réelle : le FIL pour le tri,
 * le FICHIER pour drive/shared/migre. Les autres clés (messageId|…, tache|, important|,
 * dryrunv2|… — de simples marqueurs) restent leur propre identité : jamais fusionnées, et le
 * rapport dry-run n'écrase JAMAIS l'état réel d'un fichier. PURE.
 */
// Familles de clés dont le fileId est TOUJOURS le DERNIER segment (reset C28-33 + campagnes) : un
// même fichier y produit plusieurs lignes d'état successives (`drive|id`, puis `tri33|tag|id`,
// `tri33p|tag|version|id`, `tri33llm|…`, `tri33-04|…`, `reanalyse|tag|id`, `nonroute|version|id`).
// Sans les regrouper sur le fichier, un doc apparaissait 2-4 fois pendant le reset → « +N
// aujourd'hui » gonflé ×2-3 et recherche polluée (revue de fond 2026-07-31).
const PREFIXES_FICHIER_DERNIER_SEG = ['tri33', 'tri33p', 'tri33llm', 'tri33-04', 'reanalyse', 'nonroute'];

export function cleEtatIndex(cle: string): string {
  const seg = cle.split('|');
  if (seg[0] === 'tri' && seg[1]) return 'fil|' + seg[1];
  if ((seg[0] === 'drive' || seg[0] === 'shared') && seg[1]) return 'fichier|' + seg[1];
  if (seg[0] === 'migre' && seg[2]) return 'fichier|' + seg[2];
  if (PREFIXES_FICHIER_DERNIER_SEG.indexOf(seg[0]) !== -1 && seg.length >= 2) {
    return 'fichier|' + seg[seg.length - 1]; // le fileId clôt toujours ces clés → même fichier regroupé
  }
  return cle;
}

/**
 * ÉTAT COURANT de l'Index : pour chaque entité (fil, fichier), seule la ligne la plus RÉCENTE
 * (la plus basse dans la Sheet — l'Index est append-only chronologique) est conservée. C'est ce
 * qui rend la section « ⚠ Suspects » honnête : un fil marqué suspect PUIS trié n'apparaît plus
 * comme suspect (C28-02/13, plan P1). PURE.
 */
export function etatCourantIndex(lignes: LigneIndex[]): LigneIndex[] {
  const parCle = new Map<string, LigneIndex>();
  for (const l of lignes) {
    const k = cleEtatIndex(l.cle);
    // delete AVANT set : une Map conserve la position d'insertion INITIALE d'une clé ré-écrite,
    // or les vues supposent ordre de liste = chronologie (`.reverse().slice(0, N)` « récents ») —
    // une entité re-traitée doit donc être RÉ-INSÉRÉE en fin, pas mise à jour en place.
    parCle.delete(k);
    parCle.set(k, l);
  }
  return [...parCle.values()];
}

/* ---------- Journal (dernières activités) ---------- */

export interface LigneJournal {
  date: string;
  niveau: string;
  source: string;
  message: string;
}

export function interpreterJournal(brut: string[][]): LigneJournal[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({ date: l[0] ?? '', niveau: l[1] ?? '', source: l[2] ?? '', message: l[3] ?? '' }));
}

/** Domaines distincts observés dans l'Index (pour les sélecteurs — zéro config dupliquée). */
export function domainesDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.domaine).filter(Boolean))).sort();
}

/* ---------- Recherche structurée (C9-07, ADR-0008 §3) — filtres PURS sur l'Index ---------- */

export interface CriteresRecherche {
  texte?: string;   // sous-chaîne (normalisée) du nom de fichier OU du chemin
  domaine?: string; // égalité stricte
  statut?: string;  // égalité stricte (classé, doublon, quarantaine…)
  annee?: string;   // année du DOCUMENT (préfixe AAAA du nom conventionnel), pas du traitement
}

/**
 * Filtre l'Index selon des critères combinés (ET). PUR — zéro appel réseau, zéro ré-indexation :
 * l'Index existant EST la base de recherche (métadonnées seules, ADR-0007).
 */
export function filtrerIndex(lignes: LigneIndex[], criteres: CriteresRecherche): LigneIndex[] {
  const texte = normaliserCle(criteres.texte ?? '');
  return lignes.filter((l) => {
    if (criteres.domaine && l.domaine !== criteres.domaine) return false;
    if (criteres.statut && l.statut !== criteres.statut) return false;
    if (criteres.annee && !l.fichier.startsWith(criteres.annee)) return false;
    if (texte && !normaliserCle(l.fichier).includes(texte) && !normaliserCle(l.chemin).includes(texte)) return false;
    return true;
  });
}

/** Statuts distincts observés (pour le sélecteur). */
export function statutsDepuisIndex(lignes: LigneIndex[]): string[] {
  return Array.from(new Set(lignes.map((l) => l.statut).filter(Boolean))).sort();
}

/** Années de DOCUMENT observées (préfixe AAAA des noms conventionnels), plus récentes d'abord. */
export function anneesDepuisIndex(lignes: LigneIndex[]): string[] {
  const annees = new Set<string>();
  for (const l of lignes) {
    const m = l.fichier.match(/^(\d{4})(-\d{2}){0,2}_/);
    if (m) annees.add(m[1]);
  }
  return Array.from(annees).sort().reverse();
}

/**
 * Extrait le fileId Drive d'une clé d'Index quand elle en porte un : `drive|<id>`,
 * `migre|<tag>|<id>` (le déplacement/renommage préserve l'ID). `shared|<id>` porte l'ID de
 * l'ORIGINAL partagé (pas de la copie classée) et les clés Gmail n'en portent pas → ''.
 */
export function fileIdDepuisCle(cle: string): string {
  const drive = cle.match(/^drive\|(.+)$/);
  if (drive) return drive[1];
  const migre = cle.match(/^migre\|[^|]+\|(.+)$/);
  if (migre) return migre[1];
  return '';
}

/**
 * Lien Drive pour une ligne d'Index : le FICHIER lui-même quand la clé porte son ID, sinon une
 * recherche Drive sur le nom exact (dégradation propre — le nom conventionnel est très discriminant).
 */
export function lienDrivePourLigne(l: LigneIndex): string {
  const id = fileIdDepuisCle(l.cle);
  if (id) return `https://drive.google.com/file/d/${id}/view`;
  return `https://drive.google.com/drive/search?q=${encodeURIComponent(`"${l.fichier}"`)}`;
}

/* ---------- Phase 3 visible (C13, ADR-0010 §2) : mails importants ---------- */

/** Mails marqués IMPORTANTS par le mini-check (#14) — clés `important|<messageId>`, `fichier` = sujet. */
export function lignesImportants(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'important').slice().reverse();
}

/** Statut posé PAR L'APP (v7, bouton « Fait ») sur la clé `important|<id>` : le mail sort de « À faire ». */
export const STATUT_IMPORTANT_FAIT = 'important-fait';

/**
 * Mails ⏰ encore À FAIRE (accueil v7) : importants, PAS marqués « fait » (une ligne `important-fait`
 * ajoutée par l'app remplace l'état courant de la clé), et vus depuis moins de `jours` jours — sans
 * fenêtre, `important|` n'étant jamais mis à jour par le moteur, la liste ne se viderait jamais
 * (revue flotte PR 1 : « déchets permanents »). Récents d'abord. PURE.
 */
export function importantsAFaire(lignes: LigneIndex[], maintenant: Date, jours = 7): LigneIndex[] {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  return lignesImportants(lignes).filter((l) => {
    const t = Date.parse(l.traiteLe);
    return !Number.isNaN(t) && t >= seuil;
  });
}

/**
 * Lien Gmail d'une ligne dont la clé porte un messageId (`important|<id>`, `tache|<id>|<hash>`,
 * `event|<id>|<hash>`, `intention|<id>`) — '' sinon. `#all` couvre aussi les mails archivés.
 */
export function lienGmailPourLigne(l: LigneIndex): string {
  const m = l.cle.match(/^(?:important|intention|tache|event|tri)\|([^|]+)/);
  return m ? `https://mail.google.com/mail/#all/${m[1]}` : '';
}

/* ---------- App v3 (C19-04, ADR-0013) : signaux du tri Gmail ---------- */

/** Fils suspects (⚠ phishing possible) — laissés en boîte par le moteur, récents d'abord. */
export function lignesSuspects(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'suspect').slice().reverse();
}

/**
 * Documents routés en « 00 · À vérifier » (fail-safe hybride ADR-0016 — analyse sans AUCUN fait
 * exploitable), récents d'abord. Zone Attention de l'accueil v4 (C28-17) : c'est le « à faire »
 * de Marc, pas une erreur du moteur.
 */
export function lignesAVerifier(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'à vérifier').slice().reverse();
}

/** Documents (hors lignes mail) traités un JOUR calendaire local donné. */
export function traitesLeJour(lignes: LigneIndex[], jour: Date): number {
  const cle = `${jour.getFullYear()}-${String(jour.getMonth() + 1).padStart(2, '0')}-${String(jour.getDate()).padStart(2, '0')}`;
  let n = 0;
  for (const l of lignes) {
    const t = Date.parse(l.traiteLe);
    if (Number.isNaN(t)) continue;
    const d = new Date(t);
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (c === cle) n++;
  }
  return n;
}

/**
 * Coût LLM du mois depuis l'onglet Santé (ligne « Coût LLM 2026-07 : 7.34 $  (2296 appels) … »).
 * null si la ligne manque — la tuile se dégrade proprement (jamais un faux 0 $).
 */
export function coutDepuisSante(lignesSante: string[]): { dollars: number; appels: number } | null {
  for (const l of lignesSante) {
    const m = l.match(/Coût LLM [^:]*: ([\d.,]+) \$\s*\((\d+) appels?\)/);
    if (m) return { dollars: Number(m[1].replace(',', '.')), appels: Number(m[2]) };
  }
  return null;
}

/**
 * Les trois chiffres de Réglages (v7) — calculés depuis l'Index en ÉTAT COURANT (dédoublonné), pas
 * depuis l'onglet Santé : ses lignes sont du texte libre (« Documents au catalogue (Index) : N »
 * compte AUSSI les clés tri/important) et changent avec le moteur — revue flotte PR 1. PURE.
 *  - documentsClasses : documents (hors lignes mail) au statut « classé » ;
 *  - mailsTries : fils `tri|…` triés (catégorisés ou « À vérifier »).
 */
export function compteursIndex(lignes: LigneIndex[]): { documentsClasses: number; mailsTries: number } {
  let documentsClasses = 0;
  let mailsTries = 0;
  for (const l of lignes) {
    if (/^tri\|/.test(l.cle)) {
      if (l.statut === 'trié' || l.statut === 'tri-a-verifier') mailsTries++;
    } else if (!/^(intention|tache|event|important|tri-abandon)\|/.test(l.cle) && l.statut === 'classé') {
      documentsClasses++;
    }
  }
  return { documentsClasses, mailsTries };
}

/** « Dernier passage OK : … » depuis l'onglet Santé — '' si absent. */
export function dernierPassageDepuisSante(lignesSante: string[]): string {
  for (const l of lignesSante) {
    const m = l.match(/Dernier passage OK\s*:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return '';
}

/* ---------- Fraîcheur du moteur (C28-41 : pastille topbar + page Moteur) ---------- */

export type EtatMoteur = 'ok' | 'retard' | 'mort' | 'inconnu';

/**
 * Minutes écoulées depuis « Dernier passage OK : AAAA-MM-JJ HH:mm » (heure LOCALE du moteur —
 * même fuseau que le navigateur de Marc). null si la ligne manque ou est illisible : la pastille
 * dit alors « inconnu », jamais un faux vert.
 */
export function ageMoteurMinutes(lignesSante: string[], maintenant: Date): number | null {
  const texte = dernierPassageDepuisSante(lignesSante);
  const m = texte.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const diff = (maintenant.getTime() - d.getTime()) / 60000;
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.round(diff));
}

/**
 * État de la pastille moteur, DÉRIVÉ de la fréquence de tick RÉGLÉE (jamais des valeurs du jour —
 * leçon §7 « cas dérivés de la constante ») : en retard au-delà de ~4 ticks manqués (min 20 min —
 * un run manuel de Marc tient le verrou ~5 min), silencieux au-delà de ~18 ticks (min 90 min).
 */
export function fraicheurMoteur(lignesSante: string[], maintenant: Date, tickMinutes = 5): EtatMoteur {
  const age = ageMoteurMinutes(lignesSante, maintenant);
  if (age === null) return 'inconnu';
  const tick = Number.isFinite(tickMinutes) && tickMinutes > 0 ? tickMinutes : 5;
  const seuilRetard = Math.max(20, tick * 4);
  const seuilMort = Math.max(90, tick * 18);
  if (age <= seuilRetard) return 'ok';
  if (age <= seuilMort) return 'retard';
  return 'mort';
}

/* ---------- Confiance (#17, C19-07) ---------- */

export const SEUIL_CONFIANCE_BASSE = 0.5;

/** Vrai si la ligne porte une confiance NUMÉRIQUE sous le seuil (« classé au mieux »). */
export function estConfianceBasse(l: LigneIndex): boolean {
  if (l.confiance === '') return false;
  const n = Number(String(l.confiance).replace(',', '.'));
  return !Number.isNaN(n) && n < SEUIL_CONFIANCE_BASSE;
}

/** Ce que le classement du Drive sait de lui-même. */
export interface Certitude {
  /** Les lignes qui portent une confiance NUMÉRIQUE — les seules sur lesquelles on peut dire quoi que ce soit. */
  mesurees: number;
  /** Parmi elles, celles au-dessus du seuil. */
  sures: number;
  /** Parmi elles, celles en dessous — « classé au mieux », pas « mal classé ». */
  auMieux: number;
  /** Les lignes SANS confiance : anciennes, ou classées sans passer par le modèle. */
  sansMesure: number;
  /** `sures / mesurees` en pourcentage entier, ou `null` quand rien n'est mesuré. */
  pourcent: number | null;
}

/**
 * PURE. Le « pourcentage de certitude » demandé par Marc le 21/09.
 *
 * ⚠️ Il porte sur le CLASSEMENT (« ce document est-il au bon endroit ? »), la seule certitude
 * que le moteur publie — colonne H de l'Index, écrite par le modèle au moment du rangement.
 * Il ne dit RIEN de la LECTURE d'un papier : aucune confiance n'y est attachée, et en
 * fabriquer une serait exactement le chiffre inventé que le dépôt s'interdit.
 *
 * ⚠️ Le dénominateur est le nombre de lignes MESURÉES, pas le total. Une ligne sans confiance
 * n'est ni sûre ni douteuse — la compter comme douteuse ferait chuter le pourcentage au fil
 * des vieilles lignes, la compter comme sûre le ferait monter ; les deux mentiraient. Elles
 * sont donc comptées À PART, et le nombre s'affiche.
 *
 * ⚠️ Le seuil est {@link SEUIL_CONFIANCE_BASSE}, consommé via {@link estConfianceBasse} :
 * un second seuil écrit ici divergerait au premier réglage, en silence.
 */
export function certitudeClassement(lignes: LigneIndex[]): Certitude {
  let mesurees = 0;
  let auMieux = 0;
  let sansMesure = 0;
  for (const l of lignes ?? []) {
    const brut = String(l?.confiance ?? '').trim();
    const n = Number(brut.replace(',', '.'));
    if (brut === '' || Number.isNaN(n)) { sansMesure += 1; continue; }
    mesurees += 1;
    if (estConfianceBasse(l)) auMieux += 1;
  }
  const sures = mesurees - auMieux;
  return {
    mesurees,
    sures,
    auMieux,
    sansMesure,
    pourcent: mesurees === 0 ? null : Math.round((sures / mesurees) * 100),
  };
}

/* ---------- Santé v3 (C19-08) : signaux dérivés du Journal ---------- */

/** Vrai si le Journal du JOUR (local) contient une erreur de quota Gmail quotidien. */
export function quotaGmailEpuise(journal: LigneJournal[], maintenant: Date): boolean {
  const jour = `${maintenant.getFullYear()}-${String(maintenant.getMonth() + 1).padStart(2, '0')}-${String(maintenant.getDate()).padStart(2, '0')}`;
  return journal.some((l) => {
    if (!l.message.includes('too many times') || !l.message.toLowerCase().includes('gmail')) return false;
    const t = Date.parse(l.date);
    if (Number.isNaN(t)) return false;
    const d = new Date(t);
    const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return c === jour;
  });
}

/** ERREURS du Journal des `jours` derniers jours, dans l'ordre du Journal. PURE. */
export function erreursDesDerniersJours(journal: LigneJournal[], jours: number, maintenant: Date): LigneJournal[] {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  return journal.filter((l) => {
    if (l.niveau !== 'ERREUR') return false;
    const t = Date.parse(l.date);
    return !Number.isNaN(t) && t >= seuil;
  });
}

/** Nombre d'ERREURS du Journal sur les `jours` derniers jours. */
export function erreursRecentes(journal: LigneJournal[], jours: number, maintenant: Date): number {
  return erreursDesDerniersJours(journal, jours, maintenant).length;
}

/* ---------- Réorg IA (#21, C21-05) : plan proposé par le moteur, validé ici ---------- */

export interface LigneReorg {
  ligneSheet: number; // 1-based (en-tête = 1) — cible des écritures de Statut
  cle: string;
  type: string;       // 'demande' | 'deplacer' | 'fusionner' | 'creer' | 'renommer'
  id: string;
  cheminActuel: string;
  cheminPropose: string;
  statut: string;     // demande : 'analyse demandée'|'proposé'|'échec' ; action : machine à états Reorg.gs
  detail: string;     // demande : portée puis synthèse ; action : raison du LLM
  horodate: string;
}

/** Interprète l'onglet Réorg (Clé|Type|ID|Chemin actuel|Chemin proposé|Statut|Détail|Horodaté). */
export function interpreterReorg(brut: string[][]): LigneReorg[] {
  const lignes: LigneReorg[] = [];
  for (let i = 0; i < brut.length; i++) {
    const l = brut[i];
    if (!l[0]) continue;
    lignes.push({
      ligneSheet: i + 2,
      cle: l[0] ?? '',
      type: l[1] ?? '',
      id: l[2] ?? '',
      cheminActuel: l[3] ?? '',
      cheminPropose: l[4] ?? '',
      statut: l[5] ?? '',
      detail: l[6] ?? '',
      horodate: l[7] ?? '',
    });
  }
  return lignes;
}

/** La demande d'analyse la plus récente (le moteur ne traite que celle-là). */
export function derniereDemandeReorg(lignes: LigneReorg[]): LigneReorg | null {
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (lignes[i].type === 'demande') return lignes[i];
  }
  return null;
}

/** Les actions du plan d'une demande (préfixe de clé `reorg|<cléDemande>|`). */
export function actionsDuPlan(lignes: LigneReorg[], cleDemande: string): LigneReorg[] {
  const prefixe = `reorg|${cleDemande}|`;
  return lignes.filter((l) => l.cle.startsWith(prefixe));
}

/**
 * Les opérations PROPOSÉES par l'assistant chat (C28-30 PR2) — clé `chatreorg|<ts>|<n>`, statut
 * `proposé`. Contrairement aux plans réorg (`actionsDuPlan`), elles ne dépendent d'AUCUNE ligne
 * `demande` : le chat les écrit directement dans l'onglet Réorg pour que Marc les valide par action.
 * Les plus récentes d'abord (tri décroissant sur la clé = ordre d'insertion inverse).
 */
export function actionsProposeesChat(lignes: LigneReorg[]): LigneReorg[] {
  return lignes
    .filter((l) => l.cle.startsWith('chatreorg|') && l.statut === 'proposé')
    .sort((a, b) => b.cle.localeCompare(a.cle));
}

/**
 * Les actions que Marc a VALIDÉES et que le moteur a ensuite REFUSÉES (`refusé (zone protégée)`,
 * `refusé (structure)`) ou RATÉES (`échec`) — plan courant + chat. La v7 n'affiche plus l'historique
 * des actions décidées (fini = poubelle), mais un refus n'est PAS une action finie : une carte validée
 * qui disparaît à l'instant puis échoue en silence laisserait croire qu'elle est appliquée (revue
 * flotte PR 4). Elles restent visibles jusqu'à ce que Marc les écarte (« OK ») ou qu'une nouvelle
 * analyse remplace le plan. Ordre du plan, chat en tête (plus récent d'abord).
 */
export function actionsRefuseesReorg(lignes: LigneReorg[], cleDemande: string | null): LigneReorg[] {
  const refus = (l: LigneReorg) => /^(refusé|échec)/.test(l.statut);
  const prefixe = cleDemande ? `reorg|${cleDemande}|` : null;
  const chat = lignes.filter((l) => l.cle.startsWith('chatreorg|') && refus(l)).sort((a, b) => b.cle.localeCompare(a.cle));
  const plan = prefixe ? lignes.filter((l) => l.cle.startsWith(prefixe) && refus(l)) : [];
  return [...chat, ...plan];
}

/**
 * Regroupe des numéros de lignes Sheet en PLAGES CONTIGUËS (écriture par lot de la colonne
 * Statut : une plage = un PUT — jamais un batchUpdate, jamais une ligne non sélectionnée
 * écrasée). Entrée dédupliquée et triée ici (copie).
 */
export function plagesContigues(lignesSheet: number[]): { debut: number; fin: number }[] {
  const tri = Array.from(new Set(lignesSheet)).sort((a, b) => a - b);
  const plages: { debut: number; fin: number }[] = [];
  for (const n of tri) {
    const derniere = plages[plages.length - 1];
    if (derniere && n === derniere.fin + 1) derniere.fin = n;
    else plages.push({ debut: n, fin: n });
  }
  return plages;
}

/** Les dossiers devenus VIDES par fusion, en attente de la décision corbeille de Marc (ADR-0014). */
export function lignesVideCandidat(lignes: LigneReorg[]): LigneReorg[] {
  return lignes.filter((l) => l.type === 'dossier-vide' && l.statut === 'vide-candidat');
}

/**
 * La carte « dossiers vides » est-elle rendue ? (C28-110, 🔴 revue sécurité ADR-0056)
 *
 * Gatée sur les seuls candidats restants, elle se DÉMONTAIT au succès complet : `corbeillerLot`
 * passe chaque ligne traitée à `corbeillé`, donc à la dernière la liste devient vide, la carte
 * disparaît — et le bilan écrit juste après n'a plus rien qui le rende. Le compte rendu n'était
 * alors visible QUE s'il restait des échecs, c'est-à-dire jamais sur le cas nominal : le défaut
 * d'origine de C28-93, déplacé d'un cran. La carte reste tant qu'il y a quelque chose à DIRE ;
 * seule la LISTE dépend des candidats restants.
 */
export function carteVidesVisible(
  nbCandidats: number,
  retour: { erreur?: string | null; bilan?: string | null; avancement?: unknown },
): boolean {
  return nbCandidats > 0 || !!retour.erreur || !!retour.bilan || !!retour.avancement;
}

/* ---------- Progression LIVE des opérations (C28-18) ---------- */

/** Miroir d'une ligne de l'onglet Progression (COLONNES_PROGRESSION, Journal.gs — 10 colonnes C28-44). */
export interface LigneProgression {
  cle: string;         // clé stable ('migration', 'tri-gmail', …) — sélectionne le widget/libellé
  operation: string;   // libellé FR écrit par le moteur (repli d'affichage)
  traites: number;
  base: number | null; // null = total inconnu (historique Gmail) OU opération sans compteur → pas de barre
  unite: string;       // 'documents' | 'fils' | 'fichiers' | 'entités' | …
  statut: string;      // familles ci-dessous + 'erreur' | 'désactivée' | 'jamais vue' (C28-44)
  horodate: string;
  detail: string;          // raison du dernier SKIP ('reset en cours', 'budget de tick épuisé'…) ou ''
  derniereActivite: string; // dernier passage RÉEL, format contrôlé 'dd/MM HH:mm' — '' si jamais vue
  derniereErreur: string;   // 'dd/MM HH:mm — message' ou '' — reste visible même après un succès
  type: string;            // type du registre (flux/campagne/maintenance/demande/observabilite) — '' si ancien moteur
  dernierePasse: string;   // « +23 documents · il y a 6 min » (dernière passe PRODUCTIVE) ou ''
  finEstimee: string;      // « reste 885 documents · ~4 j · vers le 18/08 · reprise le 01/09 » ou ''
}

/**
 * Interprète l'onglet Progression (Clé|Opération|Traités|Base|Unité|Statut|Horodaté|Détail|
 * Dernière activité|Dernière erreur). PURE. TOLÉRANTE aux lignes 7 colonnes (transition
 * moteur pas encore redéployé → colonnes H-J absentes, champs vides).
 */
export function interpreterProgression(brut: string[][]): LigneProgression[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      operation: l[1] ?? '',
      traites: Number(l[2]) || 0,
      base: l[3] === '' || l[3] == null ? null : Number(l[3]) || 0,
      unite: l[4] ?? '',
      statut: l[5] ?? '',
      horodate: l[6] ?? '',
      detail: l[7] ?? '',
      derniereActivite: l[8] ?? '',
      derniereErreur: l[9] ?? '',
      type: l[10] ?? '',
      dernierePasse: l[11] ?? '',
      finEstimee: l[12] ?? '',
    }));
}

export type FamilleStatut = 'encours' | 'suspendu' | 'pause' | 'attente' | 'termine' | 'recensement'
  | 'erreur' | 'inactif' | 'ajour';

/**
 * Famille visuelle d'un statut moteur (préfixe FR stable) — pilote la pastille du widget. PURE.
 * C28-44 : + 'erreur' (dernier passage en échec — pastille critique) et 'inactif' (« jamais vue »
 * après un déploiement, « désactivée » par CONFIG — neutre, ce n'est PAS un problème).
 * C28-45 : + 'ajour' (« à jour (déjà fait) », « à jour (plan drainé — attend la génération) ») —
 * neutre-POSITIF : le travail est fait, l'opération attend légitimement (jamais une alerte).
 */
export function familleStatut(statut: string): FamilleStatut {
  if (statut === 'erreur') return 'erreur';
  if (statut === 'jamais vue' || statut === 'désactivée') return 'inactif';
  if (statut.startsWith('à jour')) return 'ajour';
  if (statut.startsWith('suspendu')) return 'suspendu';
  if (statut.startsWith('en pause')) return 'pause';
  if (statut.startsWith('en attente')) return 'attente';
  if (statut.startsWith('terminé')) return 'termine';
  if (statut.startsWith('recensement')) return 'recensement';
  return 'encours';
}

/**
 * C28-46 (demande Marc : « seulement l'utile d'affiché, avec barres de progression à progrès
 * RÉELS ; tout l'inactif regroupé, cliquable, cachable ») : une opération est UTILE — affichée en
 * avant — si c'est un PROBLÈME (erreur, suspension), une COMPLÉTION récente (terminé — purgée
 * ensuite par le moteur), un recensement transitoire, ou un travail à PROGRÈS RÉEL (compteur).
 * Tout le reste est en VEILLE : accompli (« à jour »), désactivée, jamais vue, et les routines qui
 * tournent sans compteur — regroupées, repliées, explication au clic. PURE.
 */
export function estUtileProgression(op: LigneProgression): boolean {
  const f = familleStatut(op.statut);
  if (f === 'erreur' || f === 'suspendu') return true; // un problème est TOUJOURS visible
  // C28-50 (demande Marc : « je ne vois pas toutes les missions ») : une mission convergée AVEC
  // reliquat (« à jour (N non apparié(s)) ») n'est PAS un travail accompli — N fichiers attendent
  // un affinage de règles. Elle reste EN AVANT ; seul l'« à jour » sans reste part en veille.
  if (f === 'ajour') return op.statut.includes('non apparié');
  if (f === 'inactif') return false;  // désactivée / jamais vue → veille
  if (f === 'termine' || f === 'recensement') return true;
  return op.base !== null || op.traites > 0; // progrès réel à montrer — sinon routine qui tourne
}

/**
 * Complément PRÉCIS d'un statut moteur : le contenu de sa parenthèse terminale — « à jour (50 non
 * apparié(s)) » → « 50 non apparié(s) ». La famille (pastille) perd ce détail ; l'afficher rend la
 * ligne exacte sans re-dériver quoi que ce soit (source unique : le texte écrit par le moteur).
 * Parenthèses IMBRIQUÉES gérées par « première ouvrante → fin » (jamais une regex non-gourmande,
 * qui couperait « apparié(s » — C28-50). PURE. Sans parenthèse terminale → ''.
 */
export function complementStatut(statut: string): string {
  const i = statut.indexOf('(');
  return i >= 0 && statut.endsWith(')') ? statut.slice(i + 1, -1) : '';
}

/**
 * Horodatage moteur `dd/MM HH:mm` (format CONTRÔLÉ — PR6 : le moteur écrit du TEXTE, jamais une
 * cellule Date dont le rendu dépend de la locale de la Sheet) → Date. PURE. Année : celle de
 * `maintenant`, ou la précédente si le résultat serait dans le futur (passage d'année) ; après
 * bascule, un écart > ~360 j est un cas dégénéré (fuseau navigateur ≫ fuseau script — revue
 * C28-45) → null. Non-match → null (repli : texte brut).
 */
export function dateActivite(texte: string, maintenant: Date): Date | null {
  const m = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(texte);
  if (!m) return null;
  const d = new Date(maintenant.getFullYear(), Number(m[2]) - 1, Number(m[1]), Number(m[3]), Number(m[4]));
  if (d.getTime() > maintenant.getTime() + 60 * 60 * 1000) {
    d.setFullYear(d.getFullYear() - 1);
    if (maintenant.getTime() - d.getTime() > 360 * 24 * 3600000) return null;
  }
  return d;
}

/** « il y a X » depuis un horodatage moteur `dd/MM HH:mm`. PURE. null si illisible (repli brut). */
export function ilYA(texte: string, maintenant: Date, langue: 'fr' | 'en'): string | null {
  const d = dateActivite(texte, maintenant);
  if (!d) return null;
  const min = Math.max(0, Math.round((maintenant.getTime() - d.getTime()) / 60000));
  if (min < 60) return langue === 'fr' ? `il y a ${min} min` : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return langue === 'fr' ? `il y a ${h} h` : `${h} h ago`;
  const j = Math.round(h / 24);
  return langue === 'fr' ? `il y a ${j} j` : `${j} d ago`;
}

/* ---------- Télémétrie coûts & quotas (C28-24) ---------- */

/** Jauge quotidienne d'un scan Gmail plafonné : fils lus aujourd'hui / plafond (Détail moteur). */
export interface JaugeJour {
  lus: number;
  plafond: number | null; // null = Détail illisible (jauge affichée sans borne)
}

/**
 * Miroir de l'onglet Télémétrie (COLONNES_TELEMETRIE, Journal.gs) — clés STABLES écrites par
 * `lignesTelemetrie_` côté moteur : quota_gmail_etat, gmail_histo_fils_jour,
 * tri_cyclique_fils_jour, tri_boite_fils_jour, llm_cout_mois, llm_appels_mois.
 * (`tri_demande_fils_jour` a disparu avec le tri à la demande — ADR-0031.)
 */
export interface Telemetrie {
  presente: boolean;        // l'onglet a des lignes (faux = moteur pas encore passé depuis le déploiement)
  quotaSuspendu: boolean;
  quotaDetail: string;      // « Reprise vers HH:mm » ('' quand actif)
  cycliqueJour: JaugeJour;  // balayage cyclique du tri
  histoJour: JaugeJour;     // campagne historique (PJ)
  boiteJour: JaugeJour;     // nettoyage profond de la boîte (mails lus > 30 j, C28-22)
  coutDollars: number | null;
  freinDollars: number | null; // « Frein campagnes à N $ » (Détail)
  appelsMois: number | null;
}

/** Extrait le nombre d'un Détail moteur (« Plafond 500/j », « Frein campagnes à 110 $ »). */
function nombreDuDetail(detail: string): number | null {
  const m = /([\d]+(?:[.,]\d+)?)/.exec(detail ?? '');
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Interprète l'onglet Télémétrie (Clé|Valeur|Unité|Détail). PURE (testée). */
export function interpreterTelemetrie(brut: string[][]): Telemetrie {
  const parCle: Record<string, string[]> = {};
  for (const l of brut) { if (l[0]) parCle[l[0]] = l; }

  const jauge = (cle: string): JaugeJour => ({
    lus: Number(parCle[cle]?.[1]) || 0,
    plafond: nombreDuDetail(parCle[cle]?.[3] ?? ''),
  });
  const quota = parCle['quota_gmail_etat'];
  const cout = parCle['llm_cout_mois'];
  const appels = parCle['llm_appels_mois'];

  return {
    presente: Object.keys(parCle).length > 0,
    quotaSuspendu: (quota?.[1] ?? '') === 'suspendu',
    quotaDetail: quota?.[3] ?? '',
    cycliqueJour: jauge('tri_cyclique_fils_jour'),
    histoJour: jauge('gmail_histo_fils_jour'),
    boiteJour: jauge('tri_boite_fils_jour'),
    coutDollars: cout ? Number(String(cout[1]).replace(',', '.')) || 0 : null,
    freinDollars: cout ? nombreDuDetail(cout[3] ?? '') : null,
    appelsMois: appels ? Number(appels[1]) || 0 : null,
  };
}

/* ---------- HistoriqueImport : l'avancement de la LECTURE des papiers ---------- */

/**
 * Un point de la série (une ligne de l'onglet `HistoriqueImport`, une par jour).
 *
 * ⚠️ `restants` vaut `null` quand le moteur ne le savait pas — la cellule est VIDE, jamais 0.
 * Le confondre avec zéro ferait afficher « terminé » sur un jour où l'on ne savait rien.
 */
export interface PointImport {
  jour: string;
  restants: number | null;
  extraits: number;
  acceptes: number;
  illisibles: number;
  sansTexte: number;
  echecs: number;
  tag: string;
}

function nombreImport(v: string | undefined): number {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** PURE. Les colonnes sont lues par INDEX : elles sont APPEND-ONLY côté moteur (jamais insérées). */
export function interpreterHistoriqueImport(brut: string[][]): PointImport[] {
  return brut
    .filter((l) => (l[0] ?? '').trim())
    .map((l) => {
      const r = String(l[1] ?? '').trim();
      return {
        jour: (l[0] ?? '').trim(),
        restants: r === '' ? null : nombreImport(r),
        extraits: nombreImport(l[2]),
        acceptes: nombreImport(l[3]),
        illisibles: nombreImport(l[4]),
        sansTexte: nombreImport(l[5]),
        echecs: nombreImport(l[6]),
        tag: (l[7] ?? '').trim(),
      };
    });
}

export interface RythmeImport {
  /** Documents traités par jour ACTIF — jamais par jour écoulé. */
  parJourActif: number | null;
  joursActifs: number;
  joursObserves: number;
  traites: number;
  /** Jours restants au rythme observé, ou `null` quand rien ne permet de le dire. */
  joursRestants: number | null;
  restants: number | null;
}

/**
 * PURE. Le rythme, mesuré sur la série — jamais déduit d'un instantané.
 *
 * ⚠️ ON NE MESURE QUE DANS LE TAG COURANT. Bumper la campagne remet les cumuls à zéro : une
 * série qui traverse un bump verrait le total REDESCENDRE et en conclurait un rythme négatif.
 *
 * ⚠️ JOURS ACTIFS, pas jours écoulés. Les deux sont vrais et ne répondent pas à la même
 * question : « depuis combien de temps » n'est pas « à quelle vitesse quand ça tourne ». Un
 * import à l'arrêt depuis trois semaines et un import qui avance ont le même nombre de jours
 * écoulés, et c'est justement ce qu'il faut distinguer.
 *
 * ⚠️ UN RYTHME NUL NE DONNE AUCUNE ESTIMATION — pas `Infinity`, pas un très grand nombre. « On
 * ne peut pas le dire » est une réponse ; un horizon absurde n'en est pas une.
 */
export function rythmeImport(points: PointImport[]): RythmeImport {
  const dernier = points[points.length - 1];
  const vide: RythmeImport = {
    parJourActif: null, joursActifs: 0, joursObserves: 0, traites: 0,
    joursRestants: null, restants: dernier ? dernier.restants : null,
  };
  if (!dernier) return vide;

  const memeTag = points.filter((p) => p.tag === dernier.tag);
  const premier = memeTag[0]!;
  const traites = dernier.extraits - premier.extraits;
  // Un jour est ACTIF quand le cumul a bougé entre lui et le précédent.
  let joursActifs = 0;
  for (let i = 1; i < memeTag.length; i++) {
    if (memeTag[i]!.extraits > memeTag[i - 1]!.extraits) joursActifs++;
  }

  const parJourActif = joursActifs > 0 && traites > 0 ? traites / joursActifs : null;
  const restants = dernier.restants;
  const joursRestants = parJourActif !== null && restants !== null && restants > 0
    ? Math.ceil(restants / parJourActif)
    : null;

  return {
    parJourActif, joursActifs, joursObserves: memeTag.length, traites, joursRestants, restants,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
   CE QUI A DÉJÀ ÉTÉ LU, ET CE QU'IL EN EST SORTI.

   Demande de Marc, 21/09/2026 : « je veux vraiment un onglet précis pour l'avancement, avec
   ce qui est en train d'être lu, ce qui a déjà été lu ». L'onglet `PiecesFaites` portait un
   `fileId`, un tag et une date — trois colonnes dont aucune ne dit ce qu'est le document. Le
   moteur y écrit désormais le NOM et le MOTIF, en queue (C49-13).
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** Une ligne de `PiecesFaites` : un document que la campagne a traité, et son verdict. */
export interface DocumentLu {
  fileId: string;
  tag: string;
  /** `AAAA-MM-JJ HH:MM`, tel que le moteur l'écrit. */
  le: string;
  /** Vide pour les lignes écrites avant C49-13 : l'onglet est append-only, il ne se corrige pas. */
  nom: string;
  motif: string;
  /** Le dossier d'où vient le papier. Vide avant C49-14, pour la même raison. */
  domaine: string;
}

/**
 * PURE. Lit `PiecesFaites!A2:F`.
 *
 * ⚠️ Une ligne sans `fileId` est IGNORÉE, jamais rendue avec un identifiant vide : elle ne
 * désigne aucun document, et l'afficher ferait compter un traitement qui n'a pas eu lieu.
 * ⚠️ `nom` et `motif` absents restent VIDES — l'onglet porte des lignes d'avant leur ajout, et
 * inventer « inconnu » les rendrait indistinguables d'une lecture qui n'a rien donné.
 */
export function interpreterPiecesFaites(brut: string[][]): DocumentLu[] {
  const out: DocumentLu[] = [];
  for (const l of brut ?? []) {
    const fileId = String(l?.[0] ?? '').trim();
    if (!fileId) continue;
    out.push({
      fileId,
      tag: String(l?.[1] ?? '').trim(),
      le: String(l?.[2] ?? '').trim(),
      nom: String(l?.[3] ?? '').trim(),
      motif: String(l?.[4] ?? '').trim(),
      domaine: String(l?.[5] ?? '').trim(),
    });
  }
  return out;
}

/** Ce qu'une lecture a donné, en clair. La CLASSE sert à colorer, le libellé à comprendre. */
export interface VerdictLecture {
  classe: 'ok' | 'vide' | 'echec' | 'inconnu';
  libelle: string;
}

/**
 * PURE. Traduit le motif du moteur.
 *
 * ⚠️ Un motif INCONNU se CITE et prend la classe `inconnu` : le ranger dans « lu » ou dans
 * « échec » serait une affirmation inventée, et c'est précisément celle que Marc vérifie.
 * ⚠️ Un motif VIDE est une ligne d'AVANT C49-13, pas un verdict — les confondre ferait croire
 * que d'anciennes lectures ont échoué.
 */
export function verdictLecture(motif: string): VerdictLecture {
  const m = String(motif ?? '').trim();
  if (!m) return { classe: 'inconnu', libelle: 'verdict non enregistré (lecture antérieure)' };
  switch (m) {
    case 'ok': return { classe: 'ok', libelle: 'lu et accepté' };
    case 'refusee': return { classe: 'echec', libelle: 'lu, mais la Mémoire a refusé' };
    case 'sans-texte': return { classe: 'vide', libelle: 'aucun texte à lire (image sans OCR)' };
    case 'illisible': return { classe: 'vide', libelle: 'le modèle n’a pas pu lire — photo à refaire' };
    case 'extraction-vide': return { classe: 'vide', libelle: 'rien d’exploitable dans ce document' };
    case 'ocr-echec': return { classe: 'echec', libelle: 'la lecture du fichier a échoué' };
    case 'lecture-impossible': return { classe: 'echec', libelle: 'fichier illisible (droits ? disparu ?)' };
    case 'piece-vide': return { classe: 'echec', libelle: 'extraction faite, pièce non composable' };
    case 'non-classe': return { classe: 'echec', libelle: 'document non classé — rien à extraire' };
    default: return { classe: 'inconnu', libelle: `verdict « ${m} »` };
  }
}

/** Ce que la campagne a produit, tous verdicts confondus. */
export interface BilanLecture {
  total: number;
  ok: number;
  vide: number;
  echec: number;
  inconnu: number;
}

/**
 * PURE. Le bilan du tag COURANT — celui de la dernière ligne.
 *
 * ⚠️ Un bump de campagne remet les compteurs du moteur à zéro : mélanger les tags ferait
 * afficher un total que plus aucun compteur ne confirme.
 */
export function bilanLecture(lus: DocumentLu[]): BilanLecture {
  const tag = lus.length ? lus[lus.length - 1]!.tag : '';
  const b: BilanLecture = { total: 0, ok: 0, vide: 0, echec: 0, inconnu: 0 };
  for (const d of lus) {
    if (d.tag !== tag) continue;
    b.total++;
    b[verdictLecture(d.motif).classe]++;
  }
  return b;
}

/**
 * PURE. Les N derniers documents lus, du plus récent au plus ancien.
 *
 * ⚠️ L'ordre vient de la POSITION dans l'onglet, jamais d'un tri sur la date : le moteur écrit
 * `AAAA-MM-JJ HH:MM` à la MINUTE, donc tout un lot partage le même horodatage et un tri
 * rendrait un ordre arbitraire à chaque affichage.
 */
export function derniersLus(lus: DocumentLu[], n: number): DocumentLu[] {
  if (n <= 0) return [];
  return lus.slice(Math.max(0, lus.length - n)).reverse();
}

/**
 * PURE. La ligne de Santé qui parle de la campagne de lecture.
 *
 * ⚠️ Rend `null` quand elle manque, jamais une phrase de repli : « la campagne n'a pas encore
 * écrit son état » et « voici son état » sont deux choses, et seule la première est une panne
 * possible du canal de lecture.
 */
export function ligneSanteLecture(sante: string[]): string | null {
  // ⚠️ Déléguée à `ligneSanteNommee` depuis C49-14 : trois lignes de Santé se lisent
  // désormais de la même façon, et trois copies du même découpage auraient divergé au
  // premier libellé qui porte un « : » de plus.
  return ligneSanteNommee(sante, 'Rattrapage des pièces');
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
   CE QUE LA CAMPAGNE FAIT EN CE MOMENT — C49-14.

   Marc, le 21/09/2026 : « je vois pas de courbe pas d'estimé je sais pas ça traite quoi en ce
   moment quel dossier quel fichier quelle direction quelles infos il lui manque ».

   Cinq questions. Quatre n'avaient AUCUNE réponse dans le moteur — pas « mal affichée » :
   absente. Le moteur les publie depuis C49-14, et ce bloc les met en forme SANS rien calculer
   de neuf : la file et l'en-cours sont décidés côté moteur, ici on ne fait que lire.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Un dossier de la tranche : combien y sont lus, combien restent.
 *
 * ⚠️ `lus` et `total` sont NULLABLES depuis le 23/09, et ce n'est pas un confort de typage.
 * La phrase que le moteur écrit ne porte le total que pour les dossiers FINIS et pour celui
 * EN COURS ; pour ceux qui attendent, elle ne donne que le reste (« ensuite 06 (1169) »).
 * Poser `total = restants` serait faux dès qu'un dossier en attente a déjà des lus — et
 * l'erreur ne se verrait nulle part, puisque la jauge afficherait 0 %.
 */
export interface DossierLecture {
  prefixe: string;
  lus: number | null;
  total: number | null;
  restants: number;
}

/**
 * PURE. La file par dossier, depuis la ligne de Santé « Lecture — file ».
 *
 * ⚠️⚠️ CE PARSEUR N'A JAMAIS RIEN LU, ET PERSONNE NE POUVAIT LE VOIR (mesuré le 23/09/2026).
 * Il est né en C49-14 avec la ligne qu'il lit, et son commentaire affirmait lire l'ENCODAGE
 * (`04:0/23·01:40/87`) « jamais la phrase française ». Or `Journal.gs` écrit
 * `texteSanteFilePiece_()`, c'est-à-dire précisément la PHRASE — donc le motif ne matchait
 * rien, la file rendait un tableau vide, et l'écran affichait « publiée mais illisible » en
 * bas pendant qu'il affichait « pas encore publiée » en haut. Deux phrases contraires pour le
 * même état, et aucun test ne pouvait rougir : chaque moitié était testée chez elle, le
 * chaînon chez personne.
 *
 * On lit donc LES DEUX FORMES, et c'est délibéré :
 *   - l'encodage `<pref>:<restants>/<total>`, au cas où le moteur le publie un jour ;
 *   - la phrase que la production écrit AUJOURD'HUI, dans ses trois morceaux —
 *     `04 ✅ (48)` (fini), `EN COURS 02 : 40/1052 lus, 1012 à lire`, `ensuite 06 (1169)`.
 *
 * ⚠️ `null` (ligne absente) et `[]` (ligne présente et illisible) restent DISTINCTS : « le
 * moteur n'a pas écrit » et « j'ai lu et je n'ai rien compris » ne se réparent pas au même
 * endroit.
 */
export function fileLecture(sante: string[]): DossierLecture[] | null {
  const ligne = ligneSanteNommee(sante, 'Lecture — file');
  if (ligne === null) return null;
  const out: DossierLecture[] = [];
  const vus = new Set<string>();
  const pousser = (prefixe: string, lus: number | null, total: number | null, restants: number) => {
    if (vus.has(prefixe)) return;
    vus.add(prefixe);
    out.push({ prefixe, lus, total, restants });
  };
  for (const part of ligne.split('·')) {
    const brut = part.trim();
    if (!brut) continue;

    // a) l'encodage, s'il vient un jour : `04:12/48`.
    const enc = /^(\S+?):(\d+)\/(\d+)$/.exec(brut);
    if (enc) { const r = Number(enc[2]), t = Number(enc[3]); pousser(enc[1]!, t - r, t, r); continue; }

    // b) un dossier TERMINÉ : `04 ✅ (48)`. Le total est là, le reste est nul par définition.
    const fini = /^(\S+)\s*✅\s*\((\d+)\)/.exec(brut);
    if (fini) { const t = Number(fini[2]); pousser(fini[1]!, t, t, 0); continue; }

    // c) celui EN COURS : `EN COURS 02 : 40/1052 lus, 1012 à lire`.
    const encours = /^EN COURS\s+(\S+)\s*:\s*(\d+)\/(\d+)\s+lus,\s*(\d+)/.exec(brut);
    if (encours) { pousser(encours[1]!, Number(encours[2]), Number(encours[3]), Number(encours[4])); continue; }

    // d) ceux qui ATTENDENT : `ensuite 06 (1169), 02 (976)`. ⚠️ Le total n'y est PAS — on ne
    //    l'invente pas, on publie le reste et on laisse `lus`/`total` inconnus.
    const suite = /^ensuite\s+(.+)$/.exec(brut);
    if (suite) {
      for (const m of suite[1]!.matchAll(/(\S+?)\s*\((\d+)\)/g)) pousser(m[1]!, null, null, Number(m[2]));
      continue;
    }
  }
  return out;
}

/** La file d'IMPORT : combien de documents du Drive sont connus de la Mémoire. */
export interface FileImport {
  /** Les documents déjà poussés (faits `document.existe` acceptés). */
  pousses: number;
  /** Le total que ce canal sait atteindre — les documents CLASSÉS porteurs d'un fileId. */
  cible: number;
}

/**
 * PURE. Lit la ligne `Import — file`, ENCODÉE `<poussés>/<cible>` (C49-23).
 *
 * ⚠️ Le format lu est celui que le moteur ÉCRIT, jamais la phrase française de
 * « Mémoire (inventaire) » qui porte pourtant les mêmes nombres : une phrase se reformule au
 * premier lot qui la rend plus claire, et la jauge disparaîtrait sans qu'un test rougisse.
 *
 * ⚠️ Trois retours DISTINCTS, et c'est le sujet : `null` = le moteur n'écrit pas cette ligne
 * (déploiement en retard) ; `null` aussi quand la ligne dit « cible non mesurée » — le
 * périmètre n'a jamais été compté, donc il n'y a pas de dénominateur, et en inventer un
 * afficherait une jauge pleine sur un comptage qui n'a pas eu lieu.
 */
export function importFile(sante: string[]): FileImport | null {
  const ligne = ligneSanteNommee(sante, 'Import — file');
  if (ligne === null) return null;
  const m = /^\s*(\d+)\/(\d+)\s*$/.exec(ligne);
  if (!m) return null;
  const cible = Number(m[2]);
  if (cible <= 0) return null;
  return { pousses: Number(m[1]), cible };
}

/**
 * PURE. Le document en cours de lecture, ou `null`.
 *
 * ⚠️ Le moteur a DÉJÀ tranché la péremption (une passe tuée par le mur des six minutes laisse
 * sa Property derrière elle) : quand rien n'est en cours, il écrit sa propre phrase de repos.
 * On ne re-décide donc rien ici — on reconnaît juste ce repos pour que l'écran puisse montrer
 * le dernier document lu à la place, qui est vrai.
 */
export function enCoursLecture(sante: string[]): string | null {
  const ligne = ligneSanteNommee(sante, 'Lecture — en cours');
  if (ligne === null) return null;
  if (!ligne || ligne.indexOf('rien en ce moment') === 0) return null;
  if (ligne === 'état illisible') return null;
  return ligne;
}

/** PURE. Une ligne de Santé par son préfixe, sans son libellé. */
export function ligneSanteNommee(sante: string[], prefixe: string): string | null {
  for (const l of sante ?? []) {
    const s = String(l ?? '');
    if (s.indexOf(prefixe) === 0) {
      const i = s.indexOf(':');
      return i === -1 ? '' : s.slice(i + 1).trim();
    }
  }
  return null;
}

/** Ce que la campagne n'a PAS pu lire, nommément. */
export interface ManqueLecture {
  nom: string;
  domaine: string;
  fileId: string;
  raison: string;
}

/**
 * PURE. Les documents dont il manque quelque chose — « quelles infos il lui manque ».
 *
 * ⚠️ Seules les classes `vide` et `echec` entrent : un verdict INCONNU est une ligne d'avant
 * C49-13, pas un manque. Les mélanger ferait apparaître comme « à refaire » des documents dont
 * on ne sait simplement rien.
 * ⚠️ Le tag COURANT seulement, comme le bilan : un bump remet la campagne à zéro.
 */
export function manquesLecture(lus: DocumentLu[], n: number): ManqueLecture[] {
  const tag = lus.length ? lus[lus.length - 1]!.tag : '';
  const out: ManqueLecture[] = [];
  for (let i = lus.length - 1; i >= 0 && out.length < n; i--) {
    const d = lus[i]!;
    if (d.tag !== tag) continue;
    const v = verdictLecture(d.motif);
    if (v.classe !== 'vide' && v.classe !== 'echec') continue;
    out.push({ nom: d.nom, domaine: d.domaine, fileId: d.fileId, raison: v.libelle });
  }
  return out;
}

/** Le rythme OBSERVÉ de la campagne, et ce qu'il reste à ce rythme. */
export interface CadenceLecture {
  /** Documents lus sur la journée la plus récente où la campagne a travaillé. */
  parJourActif: number;
  /** Le jour en question, `AAAA-MM-JJ`. */
  jour: string;
  /** Nombre de jours où elle a travaillé, tous tags confondus pour le tag courant. */
  joursActifs: number;
  /** `null` quand on ne peut rien dire — jamais un horizon inventé. */
  joursRestants: number | null;
}

/**
 * PURE. La cadence, mesurée sur les JOURS ACTIFS et pas sur les jours écoulés.
 *
 * ⚠️ Les deux répondent à des questions différentes, et prendre la mauvaise fabrique une
 * estimation confiante et fausse — le dépôt l'a déjà payé (MemoryAI, 18/09) : « total ÷ jours
 * écoulés » donne un rythme de 4/jour sur une campagne qui en fait 83 en une journée puis
 * s'arrête. Ici la campagne tourne par rafales et s'interrompt sur son budget quotidien : ce
 * qu'on veut dire est « il reste N jours OÙ ELLE TOURNE », pas « N jours de calendrier ».
 *
 * ⚠️ Zéro document lu ⇒ `joursRestants: null`. Un `Infinity` ou un grand nombre se lirait
 * comme une mesure.
 */
export function cadenceLecture(lus: DocumentLu[], restants: number | null): CadenceLecture {
  const tag = lus.length ? lus[lus.length - 1]!.tag : '';
  const parJour = new Map<string, number>();
  for (const d of lus) {
    if (d.tag !== tag) continue;
    const jour = d.le.slice(0, 10);
    if (!jour) continue;
    parJour.set(jour, (parJour.get(jour) ?? 0) + 1);
  }
  const jours = Array.from(parJour.keys()).sort();
  const dernier = jours.length ? jours[jours.length - 1]! : '';
  const parJourActif = dernier ? (parJour.get(dernier) ?? 0) : 0;
  const joursRestants = (parJourActif > 0 && restants !== null && restants >= 0)
    ? Math.ceil(restants / parJourActif)
    : null;
  return { parJourActif, jour: dernier, joursActifs: jours.length, joursRestants };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
   CE QUE LA MÉMOIRE EN A FAIT, ET L'ENTONNOIR QUI RELIE LES DEUX APPS — 23/09/2026.

   Marc : « manque aussi des infos sur la vitesse, sur ce qu'il reste, sur ce qui est validé
   SÉPARÉMENT par driveai et memory ai — je comprends pas la page ». Puis, en texte libre :
   « lu vs importé vs traité, faits vs papiers ».

   Ce n'est pas un graphe de plus : c'est un ENTONNOIR. Chaque marche perd des documents, et
   c'est la perte qui explique pourquoi « 20 947 au catalogue » et « 343 faits validés »
   coexistent sans que rien ne soit cassé.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/** Ce que la Mémoire répond, ou pourquoi elle n'a pas répondu. */
export type ComptesMemoire =
  | { etat: 'connus'; valides: number; aValider: number; migres: number; papiers: number; papiersLus: number; gele: boolean; le: string }
  | { etat: 'indisponible'; motif: string }
  | { etat: 'jamais-lue' };

/**
 * PURE. Lit la ligne `Mémoire — comptes`, ENCODÉE par le moteur :
 * `<valides>/<aValider>/<migres>|<papiers>/<lus>|<gel>|<ISO>`.
 *
 * ⚠️ TROIS ÉTATS, et c'est tout l'intérêt. « Le moteur n'a jamais interrogé la Mémoire »,
 * « il l'a interrogée et elle n'a pas répondu » et « voici ses comptes » appellent trois
 * gestes différents — attendre un déploiement, aller voir le jeton, ou rien. Les fondre dans
 * un `null` rendrait la page muette au moment où elle sert.
 *
 * ⚠️ Rend `null` quand la LIGNE n'existe pas : le moteur ne la publie pas encore. C'est
 * distinct de `jamais-lue`, qui veut dire « la ligne est là et dit qu'aucune lecture n'a eu
 * lieu ».
 */
export function memoireComptes(sante: string[]): ComptesMemoire | null {
  const ligne = ligneSanteNommee(sante, 'Mémoire — comptes');
  if (ligne === null) return null;
  const s = ligne.trim();
  if (!s) return { etat: 'jamais-lue' };
  if (/^jamais lue/i.test(s)) return { etat: 'jamais-lue' };
  const indispo = /^indisponible\s*[—-]\s*(.+)$/.exec(s);
  if (indispo) return { etat: 'indisponible', motif: indispo[1]!.trim() };
  const m = /^(\d+)\/(\d+)\/(\d+)\|(\d+)\/(\d+)\|([01])\|(\S+)$/.exec(s);
  // ⚠️ Une ligne présente mais non conforme est « indisponible », jamais des zéros : le
  // contrat d'en face a pu bouger, et publier 0 se lirait « la mémoire est vide ».
  if (!m) return { etat: 'indisponible', motif: 'format inattendu' };
  return {
    etat: 'connus',
    valides: Number(m[1]), aValider: Number(m[2]), migres: Number(m[3]),
    papiers: Number(m[4]), papiersLus: Number(m[5]),
    gele: m[6] === '1', le: m[7]!,
  };
}

/**
 * Les marches, DANS L'ORDRE du parcours d'un document. Une union fermée : ajouter une marche
 * sans lui donner un libellé ne compile pas — c'est le compilateur qui tient la règle, pas la
 * vigilance (le défaut « un compteur ajouté LAISSE son libellé derrière », payé le 21/09).
 */
export const MARCHES_ENTONNOIR = ['classes', 'envoyes', 'connus', 'ouverts', 'lus', 'valides'] as const;
export type CleMarche = (typeof MARCHES_ENTONNOIR)[number];

/** Une marche de l'entonnoir. `valeur === null` = non mesurée, jamais « zéro ». */
export interface MarcheEntonnoir {
  cle: CleMarche;
  /** Qui a compté. Deux apps, deux registres — les confondre est le défaut qu'on répare. */
  source: 'driveai' | 'memoryai';
  valeur: number | null;
}

/**
 * PURE. L'entonnoir, de la marche la plus large à la plus étroite.
 *
 * ⚠️ CHAQUE MARCHE PORTE SA SOURCE, et c'est la demande de Marc. « Envoyés » est ce que
 * DriveAI a compté chez lui ; « papiers connus » est ce que la Mémoire a réellement gardé.
 * Les deux mesurent la même chose par deux chemins, donc leur ÉCART est une information —
 * pas un chiffre à choisir.
 *
 * ⚠️ On n'invente aucune marche : une valeur non mesurée reste `null` et s'affiche « — ».
 * L'ordre est celui du parcours d'un document, jamais celui des valeurs : une marche vide au
 * milieu doit rester visible, c'est elle qui désigne le maillon en panne.
 */
export function entonnoir(
  imp: FileImport | null,
  bilan: BilanLecture | null,
  mem: ComptesMemoire | null,
): MarcheEntonnoir[] {
  const co = mem && mem.etat === 'connus' ? mem : null;
  return [
    { cle: 'classes', source: 'driveai', valeur: imp ? imp.cible : null },
    { cle: 'envoyes', source: 'driveai', valeur: imp ? imp.pousses : null },
    { cle: 'connus', source: 'memoryai', valeur: co ? co.papiers : null },
    { cle: 'ouverts', source: 'driveai', valeur: bilan ? bilan.total : null },
    { cle: 'lus', source: 'memoryai', valeur: co ? co.papiersLus : null },
    { cle: 'valides', source: 'memoryai', valeur: co ? co.valides : null },
  ];
}

/**
 * PURE. Le reste de la tranche, ou `null` quand la file n'est pas lisible.
 *
 * ⚠️ `0` et `null` ne se confondent pas : « la tranche est finie » et « je ne sais pas ce
 * qu'il reste » n'appellent pas la même phrase — et c'est `0` qui produisait « il reste
 * environ 0 jours » sur un Drive où il reste plus de trois mille papiers.
 */
export function restantsTranche(file: DossierLecture[] | null): number | null {
  if (file === null || file.length === 0) return null;
  return file.reduce((s, d) => s + d.restants, 0);
}

/** Un jour où la campagne a lu quelque chose. Les jours VIDES ne sont pas inventés. */
export interface JourLecture {
  jour: string;
  nombre: number;
}

/**
 * PURE. Combien de papiers lus par jour, du plus ancien au plus récent, tag COURANT.
 *
 * ⚠️ Seuls les jours NON VIDES sortent. Remplir les trous avec des zéros ferait perdre la
 * distinction entre « rien lu ce jour-là » et « la campagne n'existait pas encore », et le
 * rythme se diviserait par des jours où il n'y avait rien à faire — c'est exactement ce qui
 * fait annoncer « 4 par jour » à une campagne qui en lit 131 quand elle tourne.
 *
 * ⚠️ Le jour vient de la chaîne écrite par le moteur (`AAAA-MM-JJ HH:MM`, heure du Québec),
 * jamais d'un `Date` reconstruit : Vercel tourne en UTC, et regrouper dessus mettrait tout ce
 * qui est lu après 20 h au lendemain.
 */
export function serieParJour(lus: DocumentLu[]): JourLecture[] {
  const tag = lus.length ? lus[lus.length - 1]!.tag : '';
  const parJour = new Map<string, number>();
  for (const d of lus) {
    if (d.tag !== tag) continue;
    const jour = d.le.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) continue;
    parJour.set(jour, (parJour.get(jour) ?? 0) + 1);
  }
  return Array.from(parJour.entries())
    .map(([jour, nombre]) => ({ jour, nombre }))
    .sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : 0));
}

/**
 * Les lignes de Santé que CET ÉCRAN lit, avec leur préfixe exact.
 *
 * ⚠️ La liste est ici et nulle part ailleurs : c'est elle qui permet de dire « le moteur ne
 * publie pas encore X » au lieu de « pas encore mesuré », qui se lit comme une panne de la
 * campagne alors que c'est un déploiement en retard. Deux diagnostics opposés, un seul
 * symptôme — et c'est exactement ce que Marc a lu le 23/09 sur les deux files.
 */
export const LIGNES_SANTE_LUES = [
  'Import — file',
  'Lecture — file',
  'Lecture — en cours',
  'Mémoire — comptes',
] as const;

/**
 * PURE. Celles que le moteur ne publie PAS, dans l'ordre.
 *
 * ⚠️ Une Santé VIDE rend la liste vide, pas la liste complète : tant que rien n'est chargé,
 * on ne sait pas ce qui manque, et l'annoncer serait un diagnostic sur une absence de mesure.
 */
export function lignesSanteManquantes(sante: string[]): string[] {
  if (!sante || sante.length === 0) return [];
  return LIGNES_SANTE_LUES.filter((p) => ligneSanteNommee(sante, p) === null);
}
