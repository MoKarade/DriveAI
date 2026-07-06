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
