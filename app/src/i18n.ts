/**
 * i18n.ts — interface produit bilingue FR/EN (CLAUDE.md §3). FR par défaut.
 */

export type Langue = 'fr' | 'en';

const CLE = 'driveai.langue';

export function langueCourante(): Langue {
  return (localStorage.getItem(CLE) as Langue) || 'fr';
}

export function changerLangue(l: Langue): void {
  localStorage.setItem(CLE, l);
}

const TEXTES = {
  fr: {
    titre: 'DriveAI',
    sousTitre: 'Ton Drive, rangé tout seul',
    connexion: 'Se connecter avec Google',
    deconnexion: 'Se déconnecter',
    configuration: 'Configuration',
    clientId: 'Client ID OAuth (Google Cloud)',
    spreadsheetId: 'ID de la Google Sheet d’état',
    enregistrer: 'Enregistrer',
    tableauDeBord: 'Tableau de bord',
    corrections: 'Corrections',
    sante: 'Santé du moteur',
    activiteRecente: 'Activité récente',
    documentsParDomaine: 'Documents par domaine',
    entitesAValider: 'Entités à valider',
    aucuneEntite: 'Aucune entité en attente — tout est validé ✅',
    valider: 'Valider',
    valide: 'Validée ✅',
    variantePossible: 'Variante possible',
    validerExplication:
      'Valider crée le dossier de l’entité au prochain passage du moteur (≈ 5 min) et y range les prochains documents.',
    reclasserTitre: 'Reclasser un document',
    reclasserExplication:
      'Corrige immédiatement un document mal rangé : il est déplacé/renommé sur Drive (jamais supprimé) et le moteur apprend la correction.',
    rechercherFichier: 'Nom du fichier à corriger…',
    rechercher: 'Rechercher',
    nouveauNom: 'Nouveau nom (AAAA-MM-JJ_Type_Émetteur.ext)',
    emetteur: 'Émetteur (pour que le moteur apprenne)',
    domaine: 'Domaine (ex. 02 · Finances)',
    entiteOptionnelle: 'Entité (optionnel)',
    dossierCible: 'Dossier de destination (ID ou lien Drive collé)',
    appliquer: 'Appliquer la correction',
    correctionAppliquee: 'Correction appliquée ✅ — le moteur la retiendra (few-shot).',
    erreur: 'Erreur',
    chargement: 'Chargement…',
    gardeFous: 'Garde-fous actifs : aucune suppression · zone protégée 04 jamais détachée · corrections journalisées',
    violationZoneProtegee: 'Refusé : ce document touche la zone protégée (04 · Immigration) — il ne sera pas détaché.',
    violationNom: 'Refusé : le nom doit suivre la convention (AAAA_, AAAA-MM_ ou AAAA-MM-JJ_…).',
    recherche: 'Recherche',
    filtreTexte: 'Nom, chemin… (filtre instantané)',
    tousDomaines: 'Tous les domaines',
    toutesAnnees: 'Toutes les années',
    tousStatuts: 'Tous les statuts',
    resultats: 'résultat(s)',
    affiches: 'affichés',
    rechercheContenu: 'Recherche dans le contenu',
    rechercheContenuExplication:
      'Cherche DANS les documents via la recherche native de Drive — DriveAI ne stocke jamais leur contenu.',
    chercherDansContenu: 'Chercher dans le contenu',
    aucunResultat: 'Aucun résultat.',
    fusionner: 'Fusionner',
    refuserSelection: 'Refuser la sélection',
    selection: 'sél.',
    activite30j: 'Activité (30 jours)',
    quarantaine: 'Documents en quarantaine',
    aucuneQuarantaine: 'Aucun document en quarantaine ✅',
    relancer: 'Relancer',
    relance: 'Relance demandée ✅ (traitée au prochain passage)',
    refusee: 'Refusée',
  },
  en: {
    titre: 'DriveAI',
    sousTitre: 'Your Drive, tidied on its own',
    connexion: 'Sign in with Google',
    deconnexion: 'Sign out',
    configuration: 'Settings',
    clientId: 'OAuth Client ID (Google Cloud)',
    spreadsheetId: 'State Google Sheet ID',
    enregistrer: 'Save',
    tableauDeBord: 'Dashboard',
    corrections: 'Corrections',
    sante: 'Engine health',
    activiteRecente: 'Recent activity',
    documentsParDomaine: 'Documents by domain',
    entitesAValider: 'Entities awaiting validation',
    aucuneEntite: 'No pending entity — everything validated ✅',
    valider: 'Validate',
    valide: 'Validated ✅',
    variantePossible: 'Possible variant',
    validerExplication:
      'Validating creates the entity folder on the next engine pass (≈ 5 min) and files future documents there.',
    reclasserTitre: 'Reclassify a document',
    reclasserExplication:
      'Immediately fix a misfiled document: it is moved/renamed on Drive (never deleted) and the engine learns from the correction.',
    rechercherFichier: 'Name of the file to fix…',
    rechercher: 'Search',
    nouveauNom: 'New name (YYYY-MM-DD_Type_Sender.ext)',
    emetteur: 'Sender (so the engine learns)',
    domaine: 'Domain (e.g. 02 · Finances)',
    entiteOptionnelle: 'Entity (optional)',
    dossierCible: 'Destination folder (ID or pasted Drive link)',
    appliquer: 'Apply correction',
    correctionAppliquee: 'Correction applied ✅ — the engine will learn from it (few-shot).',
    erreur: 'Error',
    chargement: 'Loading…',
    gardeFous: 'Active guardrails: no deletion · protected zone 04 never detached · corrections journaled',
    violationZoneProtegee: 'Refused: this document touches the protected zone (04 · Immigration) — it will not be detached.',
    violationNom: 'Refused: the name must follow the convention (YYYY_, YYYY-MM_ or YYYY-MM-DD_…).',
    recherche: 'Search',
    filtreTexte: 'Name, path… (instant filter)',
    tousDomaines: 'All domains',
    toutesAnnees: 'All years',
    tousStatuts: 'All statuses',
    resultats: 'result(s)',
    affiches: 'shown',
    rechercheContenu: 'Search inside documents',
    rechercheContenuExplication:
      'Searches INSIDE documents via Drive native search — DriveAI never stores their content.',
    chercherDansContenu: 'Search inside content',
    aucunResultat: 'No results.',
    fusionner: 'Merge',
    refuserSelection: 'Reject selection',
    selection: 'sel.',
    activite30j: 'Activity (30 days)',
    quarantaine: 'Quarantined documents',
    aucuneQuarantaine: 'No quarantined document ✅',
    relancer: 'Retry',
    relance: 'Retry requested ✅ (processed on next engine pass)',
    refusee: 'Rejected',
  },
} as const;

export type CleTexte = keyof (typeof TEXTES)['fr'];

export function t(cle: CleTexte, langue: Langue): string {
  return TEXTES[langue][cle];
}
