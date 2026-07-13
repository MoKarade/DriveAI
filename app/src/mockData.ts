/**
 * mockData.ts — fausses données LOCALES pour le mode E2E (`VITE_E2E_MOCK=true`, captures CI).
 *
 * JAMAIS actif en production : consommé uniquement par les gardes `MODE_MOCK` de google.ts
 * (variable Vite figée au build — absente du build Vercel, la branche est du code mort éliminable).
 * Aucun secret, aucune vraie donnée de Marc : un jeu réaliste et STABLE (dates fixes, jamais
 * `Date.now()` sur les données) pour que les captures d'écran soient comparables d'un run à l'autre.
 * Les formes miroir les onglets réels de la Sheet (voir src/Journal.gs `initialiserSheet_`) et
 * les structures attendues par etat.ts / agenda.ts / explorateur.ts.
 */

/* ---------- Onglets Sheet (lignes brutes, comme `values` de l'API Sheets) ---------- */

const INDEX: string[][] = [
  // Clé | Traité le | Fichier | Domaine | Chemin | Statut | Empreinte | Confiance
  ['messageId-001|0|facture.pdf|18220', '2026-07-06T14:02:11', '2026-07-01_Facture_Hydro-Québec.pdf', '02 · Finances', '02 · Finances/2026', 'classé', 'e3b0c442', '0.95'],
  ['drive|f-002', '2026-07-06T14:07:42', '2026-06-28_Relevé_Desjardins.pdf', '02 · Finances', '02 · Finances/Desjardins/Relevés/2026', 'classé', 'a1b2c3d4', '0.91'],
  ['messageId-003|0|bail.pdf|90210', '2026-07-05T09:15:00', '2026-06-15_Bail_Immeubles Tremblay.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Logement/3325 4e Avenue/Bail & contrat', 'classé', 'b4d455aa', '0.88'],
  ['drive|f-004', '2026-07-05T10:30:05', '2026-05-20_Passeport_Marc Richard.pdf', '01 · Administratif & identité', '01 · Administratif & identité/Passeport', 'classé', 'c0ffee00', '0.97'],
  ['messageId-005|0|photo.jpg|55000', '2026-07-04T18:22:37', '2026-07-04_Photo_Copie.jpg', '', '_Doublons', 'doublon', 'e3b0c442', ''],
  ['drive|f-006', '2026-07-04T19:01:12', 'export-facebook.html', '', '_Technique', 'technique', 'deadbeef', ''],
  ['tache|msg-007|4f2a', '2026-07-03T08:45:00', 'RDV garage — pneus été', '', '', 'tache', '', ''],
  ['tri|fil-100|1751500000|1', '2026-07-02T21:14:09', 'Votre facture Vidéotron de juillet', '', '', 'trié', '', ''],
  ['tri|fil-101|1751502000|0', '2026-07-02T21:16:44', 'URGENT : vérifiez vos identifiants', '', '', 'suspect', '', ''],
  ['tri|fil-101|1751590000|1', '2026-07-03T22:05:31', 'URGENT : vérifiez vos identifiants', '', '', 'trié', '', ''],
  // Suspect ENCORE en boîte (C28-19) : montre le « ✓ Pas suspect » 1-clic sur les captures CI.
  ['tri|fil103|1751610000|0', '2026-07-04T08:12:00', 'Code to log on to Desjardins Insurance', '', '', 'suspect', '', ''],
  ['important|msg-102', '2026-07-06T07:12:00', 'Renouvellement de votre assurance habitation', '', '', 'important', '', ''],
  ['drive|f-008', '2026-07-06T20:33:47', '2026-07-06_Devis_Centre Mécanique JF.pdf', '03 · Logement & véhicule', '03 · Logement & véhicule/Véhicule/Ford Fiesta/Entretien & réparations', 'classé', 'feedface', '0.84'],
];

const SANTE: string[][] = [
  ['✅ Moteur actif — dernier passage il y a 3 min'],
  ['📄 1 842 documents classés · 12 en attente'],
  ['💰 Coût LLM du mois : 4,87 $ (cible < 10 $)'],
  ['📬 Tri Gmail : 214 fils triés · 1 suspect'],
];

const JOURNAL: string[][] = [
  // Horodatage | Niveau | Source | Message
  ['2026-07-06T14:02:11', 'INFO', 'Pipeline', 'classé : 2026-07-01_Facture_Hydro-Québec.pdf → 02 · Finances/2026'],
  ['2026-07-06T14:07:42', 'INFO', 'Pipeline', 'classé : 2026-06-28_Relevé_Desjardins.pdf → 02 · Finances/Desjardins/Relevés/2026'],
  ['2026-07-06T14:10:03', 'INFO', 'TriGmail', '3 fil(s) trié(s), 1 archivé(s)'],
  ['2026-07-06T13:55:20', 'INFO', 'Résumé', 'Résumé hebdo envoyé.'],
];

const ENTETES_ENTITES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?', 'Vu N fois'];
const ENTITES: string[][] = [
  ENTETES_ENTITES,
  ['Desjardins', '02 · Finances', '', 'Compte financier', 'validée', 'dossier-desjardins', '2026-06-20', '', '14'],
  ['3325 4e Avenue', '03 · Logement & véhicule', 'Logement', 'Logement', 'validée', 'dossier-appart', '2026-06-21', '', '9'],
  ['Ford Fiesta', '03 · Logement & véhicule', 'Véhicule', 'Véhicule', 'validée', 'dossier-fiesta', '2026-06-22', '', '6'],
  ['Hydro-Québec', '02 · Finances', '', 'Compte financier', 'en_attente', '', '2026-07-05', '', '4'],
  ['Vidéotron', '02 · Finances', '', 'Compte financier', 'en_attente', '', '2026-07-06', 'Variante possible de : Videotron', '2'],
];

const ENTETES_CORRECTIONS = ['Fichier', 'Émetteur', 'Domaine', 'Catégorie', 'Entité', 'Type', 'Corrigé le'];
const CORRECTIONS: string[][] = [
  ENTETES_CORRECTIONS,
  ['2026-06-10_Facture_Inconnu.pdf', 'Hydro-Québec', '02 · Finances', '', 'Hydro-Québec', 'Facture', '2026-06-30'],
];

const TRI_APPRIS: string[][] = [
  // Adresse | Libellé | Appris le
  ['facturation@videotron.com', 'Factures', '2026-07-01'],
  ['info@infolettre-exemple.com', 'Infolettres', '2026-07-02'],
];

const REORG: string[][] = [
  // Clé | Type | ID | Chemin actuel | Chemin proposé | Statut | Détail | Horodaté
  ['reorg|r1|1', 'demande', '', 'tout', '', 'proposé', 'tout', '2026-07-05T12:00:00'],
  ['reorg|r1|2', 'action', 'dossier-x', '08 · Perso & projets/Vieux trucs', '08 · Perso & projets/Archives', 'proposé', 'fusion', '2026-07-05T12:01:00'],
];

const REGLAGES: string[][] = [
  ['TICK_MINUTES', '5'],
];

const PROGRESSION: string[][] = [
  // Clé | Opération | Traités | Base | Unité | Statut | Horodaté (miroir de COLONNES_PROGRESSION)
  // Un exemplaire de chaque ÉTAT visuel : barre déterminée / recensement animé / attente / rayures.
  ['tri-demande', 'Tri Gmail à la demande', '37', '100', 'fils', 'en cours', '2026-07-06T14:10:00'],
  ['migration', 'Migration taxonomie (m1)', '0', '', 'documents', 'recensement', '2026-07-06T14:10:00'],
  ['reanalyse', 'Re-analyse v2 (c26-08)', '0', '', 'documents', 'en attente (après m1)', '2026-07-06T14:10:00'],
  ['histo-gmail', 'Historique Gmail (PJ)', '4520', '', 'fils', 'suspendu (quota Gmail)', '2026-07-06T14:10:00'],
];

/** Une plage Sheet bouchonnée, par onglet (la PLAGE exacte importe peu : les vues filtrent). */
export function plageMock(onglet: string, plage: string): string[][] {
  // Les lectures d'EN-TÊTES seuls (A1:H1, A1:Z1) servent aux appends de l'app : renvoyer la 1ʳᵉ ligne.
  const enTeteSeul = /^A1:[A-Z]+1$/.test(plage);
  switch (onglet) {
    case 'Index': return enTeteSeul ? [['Clé', 'Traité le', 'Fichier', 'Domaine', 'Chemin', 'Statut', 'Empreinte', 'Confiance']] : INDEX;
    case 'Santé': return SANTE;
    case 'Journal': return JOURNAL;
    case 'Entités': return ENTITES;
    case 'Corrections': return enTeteSeul ? [ENTETES_CORRECTIONS] : CORRECTIONS;
    case 'TriAppris': return TRI_APPRIS;
    case 'Réorg': return REORG;
    case 'Réglages': return REGLAGES;
    case 'Progression': return PROGRESSION;
    default: return [];
  }
}

/* ---------- Drive (explorateur) ---------- */

// Formes minimales d'ElementDrive (explorateur.ts) : id, name, mimeType, parents, size?, modifiedTime.
export const ENFANTS_MOCK: Record<string, unknown[]> = {
  root: [
    { id: 'dossier-a-trier', name: '00 · À trier', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-06T10:00:00Z' },
    { id: 'dossier-finances', name: '02 · Finances', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-05T10:00:00Z' },
    { id: 'dossier-logement', name: '03 · Logement & véhicule', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], modifiedTime: '2026-07-04T10:00:00Z' },
  ],
  'dossier-finances': [
    { id: 'f-002', name: '2026-06-28_Relevé_Desjardins.pdf', mimeType: 'application/pdf', parents: ['dossier-finances'], size: '182200', modifiedTime: '2026-07-06T14:07:42Z' },
  ],
  'dossier-a-trier': [
    { id: 'f-100', name: 'scan-sans-nom.pdf', mimeType: 'application/pdf', parents: ['dossier-a-trier'], size: '90210', modifiedTime: '2026-07-06T09:00:00Z' },
  ],
  'dossier-logement': [],
};

/* ---------- Tasks / Calendar (vue Agenda) ---------- */

export const TACHES_MOCK: unknown[] = [
  { id: 't-1', title: 'Renouveler l’assurance habitation', status: 'needsAction', due: '2026-07-10T00:00:00.000Z' },
  { id: 't-2', title: 'RDV garage — pneus été', status: 'needsAction', due: '2026-07-15T00:00:00.000Z' },
  { id: 't-3', title: 'Payer la facture Hydro', status: 'completed', due: '2026-07-03T00:00:00.000Z' },
];

export const EVENEMENTS_MOCK: unknown[] = [
  {
    id: 'e-1', summary: 'Rendez-vous notaire',
    start: { dateTime: '2026-07-09T14:00:00-04:00' }, end: { dateTime: '2026-07-09T15:00:00-04:00' },
  },
  {
    id: 'e-2', summary: 'Garage — pose des pneus',
    start: { dateTime: '2026-07-15T09:00:00-04:00' }, end: { dateTime: '2026-07-15T10:00:00-04:00' },
  },
];
