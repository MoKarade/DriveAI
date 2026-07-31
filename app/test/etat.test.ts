/**
 * Parsers de l'état (etat.ts) : interprétation des lignes Sheet PAR EN-TÊTES réels
 * (jamais d'index en dur — miroir de colonnesEntites_), file « en attente », colonne A1.
 */

import { describe, it, expect } from 'vitest';
import {
  interpreterIndex,
  domainesDepuisIndex,
  filtrerIndex,
  statutsDepuisIndex,
  anneesDepuisIndex,
  fileIdDepuisCle,
  lienDrivePourLigne,
  lignesImportants,
  lienGmailPourLigne,
  ageMoteurMinutes,
  fraicheurMoteur,
} from '../src/etat';

describe('interpreterIndex + domainesDepuisIndex', () => {
  it('lit les lignes non vides et liste les domaines observés', () => {
    const lignes = interpreterIndex([
      ['k1', '2026-01-01', 'a.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k2', '2026-01-02', 'b.pdf', '02 · Finances', 'chemin', 'classé'],
      ['k3', '2026-01-03', 'c.pdf', '03 · Logement & véhicule', 'chemin', 'classé'],
      ['', '', '', '', '', ''], // ligne vide ignorée
    ]);
    expect(lignes).toHaveLength(3);
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


describe('fraîcheur moteur (C28-41 : pastille topbar + page Moteur)', () => {
  const maintenant = new Date(2026, 6, 31, 12, 0); // 2026-07-31 12:00 locale

  it('ageMoteurMinutes : parse l’heure LOCALE du « Dernier passage OK », null si illisible', () => {
    expect(ageMoteurMinutes(['Dernier passage OK : 2026-07-31 11:48'], maintenant)).toBe(12);
    expect(ageMoteurMinutes(['Dernier passage OK : 2026-07-31 12:05'], maintenant)).toBe(0); // horloge en avance → jamais négatif
    expect(ageMoteurMinutes(['autre ligne'], maintenant)).toBeNull();
    expect(ageMoteurMinutes([], maintenant)).toBeNull();
  });

  it('fraicheurMoteur : seuils DÉRIVÉS du tick réglé (jamais des valeurs du jour)', () => {
    const tick = 5;
    const seuilRetard = Math.max(20, tick * 4);
    const seuilMort = Math.max(90, tick * 18);
    const sante = (min: number) => {
      const d = new Date(maintenant.getTime() - min * 60000);
      const p = (n: number) => String(n).padStart(2, '0');
      return [`Dernier passage OK : ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`];
    };
    expect(fraicheurMoteur(sante(seuilRetard - 1), maintenant, tick)).toBe('ok');
    expect(fraicheurMoteur(sante(seuilRetard + 1), maintenant, tick)).toBe('retard');
    expect(fraicheurMoteur(sante(seuilMort + 1), maintenant, tick)).toBe('mort');
    expect(fraicheurMoteur([], maintenant, tick)).toBe('inconnu'); // données absentes ⇒ jamais un faux vert
  });

  it('tick 30 min : les seuils s’étirent avec le réglage (pas de fausse alerte)', () => {
    const sante = ['Dernier passage OK : 2026-07-31 11:00']; // il y a 60 min
    expect(fraicheurMoteur(sante, maintenant, 5)).toBe('retard'); // 60 > 20
    expect(fraicheurMoteur(sante, maintenant, 30)).toBe('ok');    // 60 ≤ 120
  });
});

describe('mails importants (C14)', () => {
  const lignes = interpreterIndex([
    ['tache|MA|h1', '2026-07-01', 'Payer Hydro', '', '', 'tache'],
    ['event|MB|h2', '2026-07-02', 'RDV garage', '', '', 'evenement'],
    ['important|MC', '2026-07-02', 'Réponds-moi stp', '', '', 'important'],
    ['intention|MD', '2026-07-02', 'Newsletter', '', '', 'intention-ecartee'],
    ['drive|X', '2026-07-02', '2026-07-01_Facture_EDF.pdf', '02 · Finances', 'x', 'classé'],
  ]);

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

/* ---------- App v3 (C19-04) : signaux du tri + tuiles Aujourd'hui ---------- */

import {
  lignesSuspects,
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

  it('lignesSuspects : seulement les ⚠, récents d\'abord', () => {
    expect(lignesSuspects(lignes).map((l) => l.fichier)).toEqual(['« Compte suspendu »']);
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
    expect(courant[0].statut).toBe('classé'); // plus aucune trace « quarantaine » dans l'état courant
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
  actionsProposeesChat,
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

  it('actionsProposeesChat : lignes chatreorg| PROPOSÉES seules, sans demande, plus récentes d’abord', () => {
    const avecChat = interpreterReorg([
      ...brut,
      ['chatreorg|1799999999100|1', 'deplacer-fichier', 'F1→D1', 'nas.txt', 'Réseau', 'proposé', 'range', 'T3'],
      ['chatreorg|1799999999200|1', 'creer', '→P1', '', 'Véhicule/Garage', 'proposé', '', 'T4'],
      ['chatreorg|1799999999050|1', 'deplacer-fichier', 'F2→D2', 'vieux.pdf', 'Archives', 'validé', '', 'T2'], // décidé → exclu
    ]);
    const chat = actionsProposeesChat(avecChat);
    // ts réels (13 chiffres, largeur fixe) : ordre lexical décroissant == plus récent d'abord ; validé exclu.
    expect(chat.map((c) => c.cle)).toEqual(['chatreorg|1799999999200|1', 'chatreorg|1799999999100|1']);
    // N’attrape jamais les lignes du plan réorg classique (préfixe reorg|…).
    expect(chat.every((c) => c.cle.startsWith('chatreorg|'))).toBe(true);
    expect(actionsProposeesChat(interpreterReorg(brut))).toHaveLength(0);
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
