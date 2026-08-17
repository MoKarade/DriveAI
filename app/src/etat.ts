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

/** Nombre d'ERREURS du Journal sur les `jours` derniers jours. */
export function erreursRecentes(journal: LigneJournal[], jours: number, maintenant: Date): number {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  return journal.filter((l) => {
    if (l.niveau !== 'ERREUR') return false;
    const t = Date.parse(l.date);
    return !Number.isNaN(t) && t >= seuil;
  }).length;
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
