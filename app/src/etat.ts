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

export function interpreterIndex(brut: string[][]): LigneIndex[] {
  return brut
    .filter((l) => l[0])
    .map((l) => ({
      cle: l[0] ?? '',
      traiteLe: l[1] ?? '',
      fichier: l[2] ?? '',
      domaine: l[3] ?? '',
      chemin: l[4] ?? '',
      statut: l[5] ?? '',
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
export function cleEtatIndex(cle: string): string {
  const seg = cle.split('|');
  if (seg[0] === 'tri' && seg[1]) return 'fil|' + seg[1];
  if ((seg[0] === 'drive' || seg[0] === 'shared') && seg[1]) return 'fichier|' + seg[1];
  if (seg[0] === 'migre' && seg[2]) return 'fichier|' + seg[2];
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

/** Compte par domaine (pour le dashboard). */
export function compterParDomaine(lignes: LigneIndex[]): Map<string, number> {
  const compte = new Map<string, number>();
  for (const l of lignes) {
    const d = l.domaine || '—';
    compte.set(d, (compte.get(d) ?? 0) + 1);
  }
  return compte;
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

/* ---------- Entités (référentiel — la file de validation 1-clic) ---------- */

export interface LigneEntite {
  ligneSheet: number; // 1-based (en-tête = 1) — pour cibler la cellule Statut à l'écriture
  entite: string;
  domaine: string;
  categorie: string;
  type: string;
  statut: string;
  variante: string;
  dossierId: string; // dossier matérialisé (entité validée) — sert de destination de reclassement
  vuNFois: number;   // fréquence d'observation (#10) — sert au tri de la file de validation
}

/**
 * Interprète l'onglet Entités À PARTIR DE SES EN-TÊTES réels (1ʳᵉ ligne) — miroir de
 * `colonnesEntites_` : l'ordre des colonnes de la Sheet fait foi, jamais un index codé en dur.
 * Renvoie aussi la lettre de colonne du Statut (pour l'écriture 1-clic).
 */
export function interpreterEntites(brut: string[][]): { lignes: LigneEntite[]; colonneStatut: string } {
  if (brut.length === 0) return { lignes: [], colonneStatut: '' };
  const entetes = brut[0];
  const idx = (nom: string) => entetes.indexOf(nom);
  const iStatut = idx('Statut');
  const lignes: LigneEntite[] = [];
  for (let i = 1; i < brut.length; i++) {
    const l = brut[i];
    if (!l[idx('Entité')]) continue;
    lignes.push({
      ligneSheet: i + 1,
      entite: l[idx('Entité')] ?? '',
      domaine: l[idx('Domaine')] ?? '',
      categorie: l[idx('Catégorie')] ?? '',
      type: l[idx('Type')] ?? '',
      statut: normaliserCle(l[iStatut] ?? ''),
      variante: l[idx('Variante possible ?')] ?? '',
      dossierId: l[idx('Dossier ID')] ?? '',
      vuNFois: Number(l[idx('Vu N fois')] ?? '') || 1,
    });
  }
  return { lignes, colonneStatut: lettreColonne(iStatut) };
}

/** Index de colonne (0-based) → lettre A1 (0 → A, 25 → Z, 26 → AA). */
export function lettreColonne(index: number): string {
  if (index < 0) return '';
  let n = index;
  let lettres = '';
  do {
    lettres = String.fromCharCode(65 + (n % 26)) + lettres;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return lettres;
}

export function entitesEnAttente(lignes: LigneEntite[]): LigneEntite[] {
  // Les plus VUES d'abord (#10) : Marc valide en priorité les entités les plus fréquentes.
  return lignes
    .filter((l) => l.statut === 'en attente' || l.statut === 'en_attente')
    .slice()
    .sort((a, b) => b.vuNFois - a.vuNFois);
}

/** Entités validées AVEC dossier matérialisé — destinations proposées au reclassement. */
export function entitesValidees(lignes: LigneEntite[]): LigneEntite[] {
  return lignes.filter((l) => (l.statut === 'validee' || l.statut.startsWith('validee (auto')) && l.dossierId);
}

/* ---------- Aides de saisie (pures, testées) ---------- */

/**
 * Extrait l'ÉMETTEUR du nom conventionnel `AAAA…_Type_Émetteur.ext` (3ᵉ segment, sans extension).
 * '' si le nom ne suit pas la convention — le champ reste alors à saisir. Sert à pré-remplir la
 * journalisation Corrections (le few-shot du moteur sélectionne PAR émetteur : sans lui, la
 * correction serait une ligne morte).
 */
export function emetteurDepuisNom(nom: string): string {
  const sansExt = nom.replace(/\.[^.]+$/, '');
  const segments = sansExt.split('_');
  if (segments.length < 3 || !/^\d{4}(-\d{2}){0,2}$/.test(segments[0])) return '';
  return segments.slice(2).join('_');
}

/**
 * Accepte un ID de dossier Drive OU une URL Drive collée telle quelle (« Obtenir le lien »)
 * et renvoie l'ID. '' si rien d'exploitable.
 */
export function extraireIdDossier(texte: string): string {
  const t = texte.trim();
  const url = t.match(/\/folders\/([-\w]+)/);
  if (url) return url[1];
  if (/^[-\w]{20,}$/.test(t)) return t; // un ID Drive brut
  return '';
}

/** Domaines distincts observés dans l'Index (pour la datalist du formulaire — zéro config dupliquée). */
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

/* ---------- App v2 (C15, ADR-0011) : fusion, quarantaine, activité ---------- */

/**
 * Extrait la CIBLE de fusion d'une suggestion de variante « → Desjardins (90 %) ? »
 * (colonne « Variante possible ? » écrite par le moteur). '' si pas de suggestion exploitable.
 */
export function cibleFusion(variante: string): string {
  const m = (variante ?? '').match(/^→ (.+) \(\d+ %\) \?$/);
  return m ? m[1].trim() : '';
}

/** Lignes d'Index en QUARANTAINE (échecs répétés) — pour la liste « à relancer » du dashboard. */
export function lignesQuarantaine(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'quarantaine');
}

/* ---------- Phase 3 visible (C13, ADR-0010 §2) : actions & RDV, mails importants ---------- */

/**
 * Actions & RDV créés par la Phase 3 (statuts `tache`/`evenement` — clés `tache|…`/`event|…`,
 * `fichier` = titre de l'intention). Les plus récents d'abord.
 */
export function lignesActions(lignes: LigneIndex[]): LigneIndex[] {
  return lignes.filter((l) => l.statut === 'tache' || l.statut === 'evenement').slice().reverse();
}

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

export interface JourActivite {
  jour: string; // AAAA-MM-JJ
  n: number;
}

/**
 * Activité par JOUR sur les `jours` derniers jours (documents traités, toutes catégories).
 * `maintenant` est injecté (déterminisme des tests). Jours sans activité inclus (barres à 0).
 */
export function activiteParJour(lignes: LigneIndex[], jours: number, maintenant: Date): JourActivite[] {
  // Clés en date LOCALE (pas UTC) : `traiteLe` vient de la Sheet en heure locale — un traitement du
  // soir (UTC-4) doit tomber sur la barre du bon jour calendaire.
  const cleLocale = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const compte = new Map<string, number>();
  for (let i = jours - 1; i >= 0; i--) {
    compte.set(cleLocale(new Date(maintenant.getTime() - i * 24 * 60 * 60 * 1000)), 0);
  }
  for (const l of lignes) {
    const t = Date.parse(l.traiteLe);
    if (Number.isNaN(t)) continue;
    const cle = cleLocale(new Date(t));
    if (compte.has(cle)) compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return Array.from(compte, ([jour, n]) => ({ jour, n }));
}

/* ---------- App v3 (C19-04, ADR-0013) : tri Gmail visible + tuiles « Aujourd'hui » ---------- */

/** Fils Gmail TRIÉS par le moteur (#16) — statuts `trié`/`tri-a-verifier`/`suspect`, récents d'abord. */
export function lignesTri(lignes: LigneIndex[]): LigneIndex[] {
  return lignes
    .filter((l) => l.statut === 'trié' || l.statut === 'tri-a-verifier' || l.statut === 'suspect')
    .slice()
    .reverse();
}

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

export interface StatsTri {
  tries: number;      // total trié + à vérifier (fils passés par le tri)
  aVerifier: number;
  suspects: number;
}

/** Compte le tri des `jours` derniers jours (fenêtre glissante, `maintenant` injecté — testable). */
export function statsTri(lignes: LigneIndex[], jours: number, maintenant: Date): StatsTri {
  const seuil = maintenant.getTime() - jours * 24 * 60 * 60 * 1000;
  const s: StatsTri = { tries: 0, aVerifier: 0, suspects: 0 };
  for (const l of lignes) {
    const t = Date.parse(l.traiteLe);
    if (Number.isNaN(t) || t < seuil) continue;
    if (l.statut === 'trié') s.tries++;
    else if (l.statut === 'tri-a-verifier') { s.tries++; s.aVerifier++; }
    else if (l.statut === 'suspect') s.suspects++;
  }
  return s;
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

/* ---------- TriAppris (#16) : table expéditeur → libellé, corrigeable depuis l'app ---------- */

export interface LigneTriAppris {
  ligneSheet: number; // 1-based (en-tête = 1) — cible du « Retirer » (vidage de cellules)
  adresse: string;
  libelle: string;
  apprisLe: string;
}

/**
 * Interprète l'onglet TriAppris (Adresse, Libellé, Appris le). Les lignes à adresse VIDE sont
 * ignorées — c'est justement l'état « retiré » (l'app vide les cellules, ne supprime jamais
 * de ligne : garde-fou §2 ; le moteur saute les adresses vides).
 */
export function interpreterTriAppris(brut: string[][]): LigneTriAppris[] {
  const lignes: LigneTriAppris[] = [];
  for (let i = 0; i < brut.length; i++) {
    const l = brut[i];
    if (!l[0]) continue;
    lignes.push({ ligneSheet: i + 2, adresse: l[0] ?? '', libelle: l[1] ?? '', apprisLe: l[2] ?? '' });
  }
  return lignes;
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

/** Miroir d'une ligne de l'onglet Progression (COLONNES_PROGRESSION, Journal.gs). */
export interface LigneProgression {
  cle: string;         // clé stable ('migration', 'tri-demande', …) — sélectionne le widget/libellé
  operation: string;   // libellé FR écrit par le moteur (repli d'affichage)
  traites: number;
  base: number | null; // null = total inconnu (historique Gmail, intentions) → barre indéterminée
  unite: string;       // 'documents' | 'fils' | 'mails' | 'fichiers'
  statut: string;      // 'en cours' | 'recensement' | 'en attente…' | 'suspendu…' | 'en pause…' | 'terminé'
  horodate: string;
}

/** Interprète l'onglet Progression (Clé|Opération|Traités|Base|Unité|Statut|Horodaté). PURE. */
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
    }));
}

export type FamilleStatut = 'encours' | 'suspendu' | 'pause' | 'attente' | 'termine' | 'recensement';

/** Famille visuelle d'un statut moteur (préfixe FR stable) — pilote la pastille du widget. PURE. */
export function familleStatut(statut: string): FamilleStatut {
  if (statut.startsWith('suspendu')) return 'suspendu';
  if (statut.startsWith('en pause')) return 'pause';
  if (statut.startsWith('en attente')) return 'attente';
  if (statut.startsWith('terminé')) return 'termine';
  if (statut.startsWith('recensement')) return 'recensement';
  return 'encours';
}
