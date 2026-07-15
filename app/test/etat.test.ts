/**
 * Parsers de l'état (etat.ts) : interprétation des lignes Sheet PAR EN-TÊTES réels
 * (jamais d'index en dur — miroir de colonnesEntites_), file « en attente », colonne A1.
 */

import { describe, it, expect } from 'vitest';
import {
  cibleFusion,
  lignesQuarantaine,
  activiteParJour,
  interpreterEntites,
  entitesEnAttente,
  entitesValidees,
  lettreColonne,
  interpreterIndex,
  compterParDomaine,
  emetteurDepuisNom,
  extraireIdDossier,
  domainesDepuisIndex,
  filtrerIndex,
  statutsDepuisIndex,
  anneesDepuisIndex,
  fileIdDepuisCle,
  lienDrivePourLigne,
  lignesActions,
  lignesImportants,
  lienGmailPourLigne,
} from '../src/etat';

const ENTETES = ['Entité', 'Domaine', 'Catégorie', 'Type', 'Statut', 'Dossier ID', 'Ajoutée le', 'Variante possible ?'];

describe('interpreterEntites', () => {
  it('lit par en-têtes réels et repère la colonne Statut', () => {
    const { lignes, colonneStatut } = interpreterEntites([
      ENTETES,
      ['EDF', '03 · Logement & véhicule', '', 'Logement', 'en_attente', '', '2026-07-01', ''],
      ['Desjardins', '02 · Finances', '', 'Compte financier', 'validée', 'xyz', '2026-06-01', ''],
    ]);
    expect(colonneStatut).toBe('E');
    expect(lignes).toHaveLength(2);
    expect(lignes[0].ligneSheet).toBe(2); // 1-based, en-tête = ligne 1
    expect(lignes[0].statut).toBe('en_attente');
    expect(lignes[1].statut).toBe('validee'); // normalisé (accents)
  });

  it('ordre de colonnes DIFFÉRENT de la constante → suit les en-têtes (auto-réparation Sheet)', () => {
    const { lignes, colonneStatut } = interpreterEntites([
      ['Statut', 'Entité', 'Domaine'],
      ['en_attente', 'IUT ULCO', '05 · Carrière'],
    ]);
    expect(colonneStatut).toBe('A');
    expect(lignes[0].entite).toBe('IUT ULCO');
  });

  it('entitesEnAttente filtre les seules en_attente', () => {
    const { lignes } = interpreterEntites([
      ENTETES,
      ['A', 'd', '', '', 'en_attente', '', '', ''],
      ['B', 'd', '', '', 'validée', '', '', ''],
      ['C', 'd', '', '', 'refusée', '', '', ''],
    ]);
    expect(entitesEnAttente(lignes).map((l) => l.entite)).toEqual(['A']);
  });
});

describe('lettreColonne', () => {
  it.each([
    [0, 'A'],
    [4, 'E'],
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
  ])('%i → %s', (i, attendu) => {
    expect(lettreColonne(i)).toBe(attendu);
  });
});

describe('entitesValidees (destinations de reclassement)', () => {
  it('ne garde que les validées AVEC dossier matérialisé', () => {
    const { lignes } = interpreterEntites([
      ENTETES,
      ['A', 'd', '', '', 'validée', 'DOSSIER_A', '', ''],
      ['B', 'd', '', '', 'validée', '', '', ''], // validée mais pas encore matérialisée
      ['C', 'd', '', '', 'en_attente', '', '', ''],
    ]);
    expect(entitesValidees(lignes).map((l) => l.entite)).toEqual(['A']);
    expect(entitesValidees(lignes)[0].dossierId).toBe('DOSSIER_A');
  });
});

describe('emetteurDepuisNom (pré-remplissage few-shot)', () => {
  it.each([
    ['2024-03-05_Facture_Hydro-Québec.pdf', 'Hydro-Québec'],
    ['2024-03_Relevé_Desjardins.pdf', 'Desjardins'],
    ['2021_Diplôme_IUT-ULCO.pdf', 'IUT-ULCO'],
    ['2024-03-05_Attestation_Revenu_Québec.pdf', 'Revenu_Québec'], // segments multiples conservés
    ['IMG_2734.jpg', ''],           // hors convention → à saisir
    ['scan.pdf', ''],
  ])('%s → %s', (nom, attendu) => {
    expect(emetteurDepuisNom(nom)).toBe(attendu);
  });
});

describe('extraireIdDossier (ID brut OU lien Drive collé)', () => {
  it.each([
    ['1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC', '1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC'],
    ['https://drive.google.com/drive/folders/1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC?usp=sharing', '1VBK_4pkJmIeTsRyz-MWpMBYaOhKYNfRC'],
    ['  https://drive.google.com/drive/u/0/folders/1B9jNRpAKrAWdUs6Gn5_ojle3ZH7JbFDW  ', '1B9jNRpAKrAWdUs6Gn5_ojle3ZH7JbFDW'],
    ['pas un id', ''],
    ['', ''],
  ])('%s → %s', (texte, attendu) => {
    expect(extraireIdDossier(texte)).toBe(attendu);
  });
});

describe('interpreterIndex + compterParDomaine', () => {
  it('compte les documents par domaine', () => {
    const lignes = interpreterIndex([
      ['k1', '2026-01-01', 'a.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k2', '2026-01-02', 'b.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k3', '2026-01-03', 'c.pdf', '03 · Logement & véhicule', 'chemin', 'classé'],
      ['', '', '', '', '', ''], // ligne vide ignorée
    ]);
    expect(lignes).toHaveLength(3);
    const compte = compterParDomaine(lignes);
    expect(compte.get('02 · Finances')).toBe(2);
    expect(compte.get('03 · Logement & véhicule')).toBe(1);
    expect(domainesDepuisIndex(lignes)).toEqual(['02 · Finances', '03 · Logement & véhicule']);
  });
});

describe('recherche structurée (C9-07) — filtres purs sur l’Index', () => {
  const LIGNES = interpreterIndex([
    ['drive|F1', '2026-06-01', '2024-03-05_Facture_Hydro-Québec.pdf', '03 · Logement & véhicule', '03/Logement — X/Factures/2024', 'classé'],
    ['msg|1|a|9', '2026-06-02', '2024-03_Relevé_Desjardins.pdf', '02 · Finances', '02/Desjardins/Relevés/2024', 'classé'],
    ['migre|m1|F3', '2026-07-01', '2021_Diplôme_IUT-ULCO.pdf', '06 · Études & diplômes', '06/IUT', 'classé'],
    ['drive|F4', '2026-07-02', '2024-04-01_Facture_Hydro-Québec.pdf', '03 · Logement & véhicule', '03/…', 'doublon'],
  ]);

  it('filtre par texte (nom OU chemin, insensible casse/accents)', () => {
    expect(filtrerIndex(LIGNES, { texte: 'hydro-quebec' })).toHaveLength(2);
    expect(filtrerIndex(LIGNES, { texte: 'RELEVES' }).map((l) => l.fichier)).toEqual(['2024-03_Relevé_Desjardins.pdf']); // via le chemin
  });

  it('filtre par domaine + statut + année (ET combiné)', () => {
    expect(filtrerIndex(LIGNES, { domaine: '03 · Logement & véhicule', statut: 'classé' })).toHaveLength(1);
    expect(filtrerIndex(LIGNES, { annee: '2024' })).toHaveLength(3);
    expect(filtrerIndex(LIGNES, { annee: '2021' })).toHaveLength(1);
  });

  it('sans critère → tout', () => {
    expect(filtrerIndex(LIGNES, {})).toHaveLength(4);
  });

  it('sélecteurs : domaines/statuts/années observés', () => {
    expect(statutsDepuisIndex(LIGNES)).toEqual(['classé', 'doublon']);
    expect(anneesDepuisIndex(LIGNES)).toEqual(['2024', '2021']); // récentes d'abord
  });
});

describe('fileIdDepuisCle + lienDrivePourLigne', () => {
  it.each([
    ['drive|ABC123', 'ABC123'],
    ['migre|m1|XYZ', 'XYZ'],
    ['shared|ORIG', ''],       // l'ID est celui de l'ORIGINAL partagé, pas de la copie classée
    ['msgid|0|a.pdf|99', ''],  // clé Gmail : pas de fileId
  ])('%s → %s', (cle, attendu) => {
    expect(fileIdDepuisCle(cle)).toBe(attendu);
  });

  it('lien direct quand la clé porte l’ID, recherche Drive sinon', () => {
    const [directe, indirecte] = interpreterIndex([
      ['drive|F1', '', 'a.pdf', '', '', 'classé'],
      ['msg|1|b|9', '', '2024-03_Relevé_Desjardins.pdf', '', '', 'classé'],
    ]);
    expect(lienDrivePourLigne(directe)).toBe('https://drive.google.com/file/d/F1/view');
    expect(lienDrivePourLigne(indirecte)).toContain('drive/search?q=');
    expect(lienDrivePourLigne(indirecte)).toContain(encodeURIComponent('"2024-03_Relevé_Desjardins.pdf"'));
  });
});


describe('app v2 (C15) — fusion, quarantaine, activité', () => {
  it('cibleFusion : extrait la cible de « → Desjardins (90 %) ? »', () => {
    expect(cibleFusion('→ Desjardins (90 %) ?')).toBe('Desjardins');
    expect(cibleFusion('→ IUT du Littoral Côte d\'Opale (85 %) ?')).toBe('IUT du Littoral Côte d\'Opale');
    expect(cibleFusion('')).toBe('');
    expect(cibleFusion('libellé générique ?')).toBe('');
  });

  it('lignesQuarantaine : filtre le statut quarantaine', () => {
    const lignes = interpreterIndex([
      ['k1', '2026-07-01', 'a.pdf', '', '', 'quarantaine'],
      ['k2', '2026-07-01', 'b.pdf', '02 · Finances', 'x', 'classé'],
    ]);
    expect(lignesQuarantaine(lignes).map((l) => l.cle)).toEqual(['k1']);
  });

  it('activiteParJour : buckets des N derniers jours, zéros inclus, hors-fenêtre ignoré', () => {
    const maintenant = new Date('2026-07-02T12:00:00Z');
    const lignes = interpreterIndex([
      ['k1', '2026-07-02T08:00:00Z', 'a.pdf', '', '', 'classé'],
      ['k2', '2026-07-02T09:00:00Z', 'b.pdf', '', '', 'classé'],
      ['k3', '2026-07-01T09:00:00Z', 'c.pdf', '', '', 'doublon'],
      ['k4', '2026-05-01T09:00:00Z', 'vieux.pdf', '', '', 'classé'], // hors fenêtre
      ['k5', 'pas une date', 'x.pdf', '', '', 'classé'],             // ignorée
    ]);
    const a = activiteParJour(lignes, 3, maintenant);
    expect(a).toHaveLength(3);
    expect(a[2]).toEqual({ jour: '2026-07-02', n: 2 });
    expect(a[1]).toEqual({ jour: '2026-07-01', n: 1 });
    expect(a[0]).toEqual({ jour: '2026-06-30', n: 0 });
  });
});

describe('Phase 3 visible (C13) + mails importants (C14)', () => {
  const lignes = interpreterIndex([
    ['tache|MA|h1', '2026-07-01', 'Payer Hydro', '', '', 'tache'],
    ['event|MB|h2', '2026-07-02', 'RDV garage', '', '', 'evenement'],
    ['important|MC', '2026-07-02', 'Réponds-moi stp', '', '', 'important'],
    ['intention|MD', '2026-07-02', 'Newsletter', '', '', 'intention-ecartee'],
    ['drive|X', '2026-07-02', '2026-07-01_Facture_EDF.pdf', '02 · Finances', 'x', 'classé'],
  ]);

  it('lignesActions : tâches + événements, plus récents d’abord', () => {
    expect(lignesActions(lignes).map((l) => l.fichier)).toEqual(['RDV garage', 'Payer Hydro']);
  });

  it('lignesImportants : seulement le statut important', () => {
    expect(lignesImportants(lignes).map((l) => l.cle)).toEqual(['important|MC']);
  });

  it('lienGmailPourLigne : messageId extrait des clés mail — jamais pour un document', () => {
    expect(lienGmailPourLigne(lignes[0])).toBe('https://mail.google.com/mail/#all/MA');
    expect(lienGmailPourLigne(lignes[2])).toBe('https://mail.google.com/mail/#all/MC');
    expect(lienGmailPourLigne(lignes[3])).toBe('https://mail.google.com/mail/#all/MD');
    expect(lienGmailPourLigne(lignes[4])).toBe(''); // drive| : pas un mail
  });
});

/* ---------- App v3 (C19-04) : tri visible + tuiles Aujourd'hui ---------- */

import {
  lignesTri,
  lignesSuspects,
  statsTri,
  traitesLeJour,
  coutDepuisSante,
  dernierPassageDepuisSante,
} from '../src/etat';

describe('tri Gmail visible (C19-04)', () => {
  const brut = [
    ['tri|F1|100|lu', '2026-07-06 14:32', 'Relevé juin — Hydro-Québec', '', '', 'trié'],
    ['tri|F2|200|nonlu', '2026-07-06 14:31', 'Soldes — MEC', '', '', 'trié'],
    ['tri|F3|300|lu', '2026-07-05 09:00', 'Confirmation — Clinique', '', '', 'tri-a-verifier'],
    ['tri|F4|400|nonlu', '2026-06-20 08:00', 'Vieux fil', '', '', 'trié'],
    ['tri|F5|500|nonlu', '2026-07-06 12:00', '« Compte suspendu »', '', '', 'suspect'],
    ['drive|X', '2026-07-06 13:35', '2026-07-06_Attestation_DriveAI.txt', '08 · Perso & projets', '', 'classé'],
  ];
  const lignes = interpreterIndex(brut);
  const maintenant = new Date('2026-07-06T18:00:00');

  it('lignesTri : trié + à vérifier + suspect, récents d\'abord', () => {
    const t = lignesTri(lignes);
    expect(t.map((l) => l.cle)).toEqual(['tri|F5|500|nonlu', 'tri|F4|400|nonlu', 'tri|F3|300|lu', 'tri|F2|200|nonlu', 'tri|F1|100|lu']);
  });

  it('lignesSuspects : seulement les ⚠, récents d\'abord', () => {
    expect(lignesSuspects(lignes).map((l) => l.fichier)).toEqual(['« Compte suspendu »']);
  });

  it('statsTri : fenêtre glissante 7 j — le vieux fil est exclu, l\'à-vérifier compte dans triés', () => {
    expect(statsTri(lignes, 7, maintenant)).toEqual({ tries: 3, aVerifier: 1, suspects: 1 });
  });

  it('lienGmailPourLigne couvre les clés tri| (threadId, jamais le ts)', () => {
    expect(lienGmailPourLigne(lignes[0])).toBe('https://mail.google.com/mail/#all/F1');
  });

  it('traitesLeJour : jour calendaire LOCAL', () => {
    expect(traitesLeJour(lignes, new Date('2026-07-06T23:00:00'))).toBe(4);
    expect(traitesLeJour(lignes, new Date('2026-07-05T01:00:00'))).toBe(1);
  });
});

describe('tuiles Santé (C19-04)', () => {
  it('coutDepuisSante : parse « 7.34 $ (2296 appels) », virgule tolérée, null si absent', () => {
    expect(coutDepuisSante(['Santé DriveAI', 'Coût LLM 2026-07 : 7.34 $  (2296 appels)  ·  cible < 10 $/mois  ✅']))
      .toEqual({ dollars: 7.34, appels: 2296 });
    expect(coutDepuisSante(['Coût LLM 2026-07 : 7,34 $ (12 appels)'])).toEqual({ dollars: 7.34, appels: 12 });
    expect(coutDepuisSante(['rien ici'])).toBeNull();
  });

  it('dernierPassageDepuisSante : extrait la date, \'\' si absent', () => {
    expect(dernierPassageDepuisSante(['Dernier passage OK : 2026-07-06 13:01'])).toBe('2026-07-06 13:01');
    expect(dernierPassageDepuisSante(['autre'])).toBe('');
  });
});

/* ---------- App v4 (C28-18) : progression LIVE des opérations ---------- */

describe('progression live (C28-18)', () => {
  it('interpreterProgression : base vide → null (indéterminé), nombres parsés, lignes vides sautées', async () => {
    const { interpreterProgression } = await import('../src/etat');
    const lignes = interpreterProgression([
      ['migration', 'Migration taxonomie (m1)', '812', '1209', 'documents', 'en cours', '2026-07-10T19:00:00'],
      ['histo-gmail', 'Historique Gmail (PJ)', '4520', '', 'fils', 'suspendu (quota Gmail)', '2026-07-10T19:00:00'],
      ['', '', '', '', '', '', ''], // reliquat nettoyé par le moteur
    ]);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({ cle: 'migration', traites: 812, base: 1209, unite: 'documents' });
    expect(lignes[1].base).toBeNull();
    expect(lignes[1].statut).toBe('suspendu (quota Gmail)');
  });

  it('familleStatut : préfixes FR stables → famille visuelle (pastille jamais couleur seule)', async () => {
    const { familleStatut } = await import('../src/etat');
    expect(familleStatut('en cours')).toBe('encours');
    expect(familleStatut('recensement')).toBe('recensement');
    expect(familleStatut('en attente (après m1)')).toBe('attente');
    expect(familleStatut('suspendu (quota Gmail)')).toBe('suspendu');
    expect(familleStatut('suspendu (panne API)')).toBe('suspendu');
    expect(familleStatut('en pause (frein budget)')).toBe('pause');
    expect(familleStatut('terminé')).toBe('termine');
    expect(familleStatut('statut inconnu du futur')).toBe('encours'); // repli neutre
  });
});

/* ---------- App v4 (C28-17) : zone Attention de l'accueil ---------- */

describe('lignesAVerifier (C28-17)', () => {
  it('seulement le statut « à vérifier » (fail-safe ADR-0016), récents d\'abord', async () => {
    const { lignesAVerifier } = await import('../src/etat');
    const lignes = interpreterIndex([
      ['drive|A', '2026-07-09', 'scan_sans_faits.pdf', '', '00 · À vérifier', 'à vérifier'],
      ['drive|B', '2026-07-10', '2026-07-01_Facture_EDF.pdf', '02 · Finances', 'x', 'classé'],
      ['drive|C', '2026-07-10', 'photo_floue.jpg', '', '00 · À vérifier', 'à vérifier'],
      ['drive|D', '2026-07-10', 'd.pdf', '', '', 'quarantaine'], // quarantaine ≠ à vérifier (sa propre liste)
    ]);
    expect(lignesAVerifier(lignes).map((l) => l.fichier)).toEqual(['photo_floue.jpg', 'scan_sans_faits.pdf']);
  });
});

describe('TriAppris (C19-06)', () => {
  it('interpreterTriAppris : ligneSheet 1-based (+1 en-tête), lignes vidées ignorées', async () => {
    const { interpreterTriAppris } = await import('../src/etat');
    const lignes = interpreterTriAppris([
      ['conseiller@banque.com', '02 · Finances', '2026-07-06'],
      ['', '', ''], // « retirée » (cellules vidées) — le moteur l'ignore aussi
      ['rh@employeur.ca', '05 · Carrière', '2026-07-06'],
    ]);
    expect(lignes.map((l) => l.ligneSheet)).toEqual([2, 4]);
    expect(lignes[0].adresse).toBe('conseiller@banque.com');
    expect(lignes[1].libelle).toBe('05 · Carrière');
  });
});

describe('confiance (#17, C19-07)', () => {
  it('interpreterIndex lit la colonne H ; estConfianceBasse < 0,5 (virgule tolérée, vide = jamais)', async () => {
    const { estConfianceBasse } = await import('../src/etat');
    const lignes = interpreterIndex([
      ['drive|A', '2026-07-06', 'A.pdf', '02', '', 'classé', 'md5', '0.92'],
      ['drive|B', '2026-07-06', 'B.pdf', '02', '', 'classé', 'md5', '0,44'],
      ['drive|C', '2026-07-06', 'C.pdf', '02', '', 'classé', 'md5', ''],
      ['drive|D', '2026-07-06', 'D.pdf', '02', '', 'classé'],
    ]);
    expect(lignes[0].confiance).toBe('0.92');
    expect(estConfianceBasse(lignes[0])).toBe(false);
    expect(estConfianceBasse(lignes[1])).toBe(true);
    expect(estConfianceBasse(lignes[2])).toBe(false);
    expect(estConfianceBasse(lignes[3])).toBe(false);
  });
});

describe('signaux Santé (C19-08)', () => {
  it('quotaGmailEpuise : erreur quota Gmail DU JOUR seulement', async () => {
    const { quotaGmailEpuise, interpreterJournal } = await import('../src/etat');
    const j = interpreterJournal([
      ['2026-07-06 12:55', 'ERREUR', 'Gmail', 'Recherche impossible : Service invoked too many times for one day: gmail.'],
      ['2026-07-05 08:00', 'ERREUR', 'Gmail', 'Service invoked too many times for one day: gmail.'],
    ]);
    expect(quotaGmailEpuise(j, new Date('2026-07-06T18:00:00'))).toBe(true);
    expect(quotaGmailEpuise(j.slice(1), new Date('2026-07-06T18:00:00'))).toBe(false);
  });

  it('erreursRecentes : fenêtre glissante, niveau ERREUR seul', async () => {
    const { erreursRecentes, interpreterJournal } = await import('../src/etat');
    const j = interpreterJournal([
      ['2026-07-06 12:00', 'ERREUR', 'X', 'a'],
      ['2026-07-06 12:01', 'INFO', 'X', 'b'],
      ['2026-06-01 12:00', 'ERREUR', 'X', 'c'],
    ]);
    expect(erreursRecentes(j, 7, new Date('2026-07-06T18:00:00'))).toBe(1);
  });
});

/* ---------- État COURANT de l'Index (P1/C28-02) ---------- */

import { cleEtatIndex, etatCourantIndex } from '../src/etat';

describe('cleEtatIndex : identité d\'état par entité réelle', () => {
  it.each([
    ['tri|F1|100|lu', 'fil|F1'],           // le FIL, jamais le ts/lu (une ligne PAR état)
    ['tri|F1|200|nonlu', 'fil|F1'],
    ['drive|ABC', 'fichier|ABC'],
    ['shared|ABC', 'fichier|ABC'],
    ['migre|m1|ABC', 'fichier|ABC'],       // re-traitement du MÊME fichier → même identité
    ['18c9ab12f3e4d5a6|0|a.pdf|99', '18c9ab12f3e4d5a6|0|a.pdf|99'], // PJ Gmail (messageId brut) : clé = identité, jamais fusionnée
    ['important|MC', 'important|MC'],
    ['dryrunv2|d1|ABC', 'dryrunv2|d1|ABC'], // rapport dry-run : JAMAIS l'identité du fichier
  ])('%s → %s', (cle, attendu) => {
    expect(cleEtatIndex(cle)).toBe(attendu);
  });
});

describe('etatCourantIndex : la section Suspects redevient honnête (C28-13)', () => {
  it('un fil suspect à T1 puis trié à T2 disparaît de lignesSuspects', () => {
    const lignes = interpreterIndex([
      ['tri|F1|100|nonlu', '2026-07-06 12:00', '« Compte suspendu »', '', '', 'suspect'],
      ['tri|F2|150|lu', '2026-07-06 13:00', 'Autre fil louche', '', '', 'suspect'],
      ['tri|F1|200|lu', '2026-07-07 09:00', '« Compte suspendu »', '', '', 'trié'], // Marc a tranché
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(2);
    expect(lignesSuspects(courant).map((l) => l.cle)).toEqual(['tri|F2|150|lu']);
  });

  it('drive| puis migre| du même fichier fusionnent — la ligne la plus récente gagne', () => {
    const lignes = interpreterIndex([
      ['drive|F9', '2026-06-01', 'scan.pdf', '', '', 'quarantaine'],
      ['migre|m1|F9', '2026-07-01', '2024-03-05_Facture_EDF.pdf', '03 · Logement & véhicule', 'x', 'classé'],
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(1);
    expect(courant[0].statut).toBe('classé');
    expect(lignesQuarantaine(courant)).toEqual([]);
  });

  it('une entité re-traitée est RÉ-INSÉRÉE en fin de liste (ordre = chronologie, les vues « récents » en dépendent)', () => {
    const lignes = interpreterIndex([
      ['tri|F1|100|nonlu', '2026-07-01', 'Vieux fil', '', '', 'trié'],
      ['drive|F2', '2026-07-02', 'b.pdf', '02 · Finances', 'x', 'classé'],
      ['tri|F1|200|lu', '2026-07-08', 'Vieux fil (re-trié auj.)', '', '', 'trié'], // re-traité APRÈS F2
    ]);
    // Sans ré-insertion, une Map garderait F1 à sa position INITIALE (avant F2) → il sortirait
    // des listes « récents » bornées (.reverse().slice(0, N)) alors qu'il est le plus frais.
    expect(etatCourantIndex(lignes).map((l) => l.cle)).toEqual(['drive|F2', 'tri|F1|200|lu']);
  });

  it('réconciliation (P3) : une ligne « déplacé » puis « corbeillé » du MÊME fichier remplace l\'état affiché', () => {
    const lignes = interpreterIndex([
      ['drive|X', '2024-01-01', 'vieux.pdf', '02 · Finances', '02/X', 'classé'],
      ['drive|X', '2025-01-01', 'nouveau.pdf', '02 · Finances', 'DriveAI/02/Y', 'déplacé'], // appendée par synchroniserIndex_
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(1);
    expect(courant[0].fichier).toBe('nouveau.pdf');
    expect(courant[0].statut).toBe('déplacé');
  });

  it('une ligne dryrunv2| n\'écrase JAMAIS l\'état réel du fichier', () => {
    const lignes = interpreterIndex([
      ['drive|F5', '2026-07-01', 'a.pdf', '02 · Finances', 'x', 'classé'],
      ['dryrunv2|d1|F5', '2026-07-08', 'a.pdf', '', '', 'dry-run'],
    ]);
    const courant = etatCourantIndex(lignes);
    expect(courant).toHaveLength(2); // les deux survivent : identités distinctes
    expect(courant.find((l) => l.cle === 'drive|F5')?.statut).toBe('classé');
  });
});

/* ---------- Réorg IA (C21-05) ---------- */

import {
  interpreterReorg,
  derniereDemandeReorg,
  actionsDuPlan,
  plagesContigues,
} from '../src/etat';

describe('Réorg IA (C21-05)', () => {
  const brut = [
    ['demande-1', 'demande', '', '', '', 'proposé', 'Synthèse.', 'T1'],
    ['reorg|demande-1|1', 'deplacer', 'idC', '08/Vrac', '03/Vrac', 'proposé', 'raison', 'T1'],
    ['reorg|demande-1|2', 'renommer', 'idB', '03/KIA', '03/KIA Sportage', 'validé', '', 'T1'],
    ['', '', '', '', '', '', '', ''], // ligne vide ignorée
    ['demande-2', 'demande', '', '', '', 'analyse demandée', 'tout', 'T2'],
  ];

  it('interpreterReorg : lignes numérotées (Sheet), vides ignorées', () => {
    const lignes = interpreterReorg(brut);
    expect(lignes).toHaveLength(4);
    expect(lignes[0].ligneSheet).toBe(2);
    expect(lignes[3].ligneSheet).toBe(6); // la ligne vide ne décale pas la numérotation
  });

  it('derniereDemandeReorg : la plus récente (celle que le moteur traite)', () => {
    const lignes = interpreterReorg(brut);
    expect(derniereDemandeReorg(lignes)?.cle).toBe('demande-2');
    expect(derniereDemandeReorg([])).toBeNull();
  });

  it('actionsDuPlan : préfixe strict reorg|<cléDemande>|', () => {
    const lignes = interpreterReorg(brut);
    expect(actionsDuPlan(lignes, 'demande-1')).toHaveLength(2);
    expect(actionsDuPlan(lignes, 'demande-2')).toHaveLength(0);
    expect(actionsDuPlan(lignes, 'demande')).toHaveLength(0); // pas de demi-préfixe
  });

  it('plagesContigues : regroupe, dédoublonne, trie — jamais une ligne non ciblée', () => {
    expect(plagesContigues([5, 3, 4, 9, 3])).toEqual([{ debut: 3, fin: 5 }, { debut: 9, fin: 9 }]);
    expect(plagesContigues([])).toEqual([]);
    expect(plagesContigues([7])).toEqual([{ debut: 7, fin: 7 }]);
  });
});

/* ---------- Télémétrie coûts & quotas (C28-24) ---------- */

import { interpreterTelemetrie } from '../src/etat';

describe('interpreterTelemetrie', () => {
  const brut = [
    ['quota_gmail_etat', 'suspendu', '', 'Reprise vers 16:45'],
    ['gmail_histo_fils_jour', '150', 'fils', 'Plafond 150/j'],
    ['tri_cyclique_fils_jour', '84', 'fils', 'Plafond 150/j'],
    ['tri_demande_fils_jour', '120', 'fils', 'Plafond 500/j'],
    ['tri_boite_fils_jour', '45', 'fils', 'Plafond 150/j'],
    ['llm_cout_mois', '16.42', '$', 'Frein campagnes à 110 $'],
    ['llm_appels_mois', '5210', 'appels', ''],
  ];

  it('lit les clés STABLES du moteur : état quota, jauges du jour (plafond depuis le Détail), coût vs frein', () => {
    const t = interpreterTelemetrie(brut);
    expect(t.presente).toBe(true);
    expect(t.quotaSuspendu).toBe(true);
    expect(t.quotaDetail).toBe('Reprise vers 16:45');
    expect(t.demandeJour).toEqual({ lus: 120, plafond: 500 });
    expect(t.cycliqueJour).toEqual({ lus: 84, plafond: 150 });
    expect(t.histoJour).toEqual({ lus: 150, plafond: 150 });
    expect(t.boiteJour).toEqual({ lus: 45, plafond: 150 });
    expect(t.coutDollars).toBe(16.42);
    expect(t.freinDollars).toBe(110);
    expect(t.appelsMois).toBe(5210);
  });

  it('onglet vide (moteur pas encore passé) → presente: false, aucun nombre inventé', () => {
    const t = interpreterTelemetrie([]);
    expect(t.presente).toBe(false);
    expect(t.coutDollars).toBeNull();
    expect(t.appelsMois).toBeNull();
    expect(t.demandeJour).toEqual({ lus: 0, plafond: null });
  });

  it('quota actif + lignes partielles/illisibles → valeurs sûres (jamais NaN)', () => {
    const t = interpreterTelemetrie([
      ['quota_gmail_etat', 'actif', '', ''],
      ['tri_demande_fils_jour', 'zéro', 'fils', 'sans nombre'],
      ['llm_cout_mois', '3,50', '$', 'Frein campagnes à 110 $'],
    ]);
    expect(t.quotaSuspendu).toBe(false);
    expect(t.quotaDetail).toBe('');
    expect(t.demandeJour).toEqual({ lus: 0, plafond: null }); // illisible → 0 / sans borne
    expect(t.coutDollars).toBe(3.5); // virgule décimale FR tolérée
  });
});
