/**
 * corbeille.test.ts — le verdict PUR de l'ADR-0014 (unique exception au §2).
 * Chaque garde est testée : type, vacuité STRICTE, ascendance (échec fermé), noms réservés.
 * L'action réseau (corbeillerDossierVide) ne part que sur verdict vide — vérifié par lecture
 * du code dans aucune-suppression.test.ts (tripwire) ; ici on fige la décision.
 */

import { describe, it, expect } from 'vitest';
import { verdictCorbeille, statutRefusCorbeille, corbeillerLot, CORBEILLE_MAX_PANNES,
  CORBEILLE_LOT_ECRITURE, CORBEILLE_PREMIERE_ECRITURE, CORBEILLE_ECRITURES_PAR_MIN } from '../src/corbeille';
import { carteVidesVisible } from '../src/etat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
import { IDS_STRUCTURELS_DEFAUT } from '../src/garde-fous';
import { MIME_DOSSIER } from '../src/explorateur';
import { messageQuota } from '../src/google';
import { t } from '../src/i18n';

const PROTEGE = 'ID_IMMIGRATION';
const BASE = {
  id: 'ID_ORDINAIRE',
  nom: 'Vieux dossier',
  mimeType: MIME_DOSSIER,
  nbEnfants: 0,
  ascendance: { ids: ['a', 'b'], complete: true },
  racinesProtegees: [PROTEGE],
};

describe('verdictCorbeille (ADR-0014 — dossier VIDE validé, rien d’autre)', () => {
  it('cas nominal : dossier vide, hors zone protégée, nom ordinaire → autorisé', () => {
    expect(verdictCorbeille(BASE)).toEqual([]);
  });

  it('pas un dossier → refus (jamais un fichier)', () => {
    expect(verdictCorbeille({ ...BASE, mimeType: 'application/pdf' })).toContain('pas-un-dossier');
    expect(verdictCorbeille({ ...BASE, mimeType: '' })).toContain('pas-un-dossier');
  });

  it('NON vide (même 1 seul enfant, corbeillé inclus) → refus', () => {
    expect(verdictCorbeille({ ...BASE, nbEnfants: 1 })).toContain('non-vide');
  });

  it('zone protégée dans l’ascendance → refus ; chaîne ILLISIBLE = refus AUSSI, mais sous un motif DISTINCT', () => {
    expect(verdictCorbeille({ ...BASE, ascendance: { ids: ['a', PROTEGE], complete: true } }))
      .toContain('zone-protegee');
    // Échec fermé : le refus est le MÊME. Mais le motif ne doit PAS être `zone-protegee` (revue
    // C28-93, 🔴) : en aval, `statutRefusCorbeille` lit ce texte pour décider si la ligne quitte la
    // liste DÉFINITIVEMENT. Un 429 sur un GET d'ancêtre retirait ainsi une proposition à vie — le
    // moteur dédoublonne sur `videcandidat|<id>` et ne la re-proposera jamais.
    const illisible = verdictCorbeille({ ...BASE, ascendance: { ids: [], complete: false } });
    expect(illisible).toContain('ascendance-illisible');
    expect(illisible).not.toContain('zone-protegee');
    expect(illisible.length).toBeGreaterThan(0); // le refus tient : c'est bien un refus
    expect(statutRefusCorbeille(`Corbeille refusée (ADR-0014) : ${illisible.join(', ')}`)).toBeNull();
    // …et une VRAIE zone protégée, elle, reste un verdict définitif.
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : zone-protegee')).toBe('vide-protégé');
    // ⚠️ Le COMPOSITE, seul cas où la ligne `ascendance-illisible` de `statutRefusCorbeille` change
    // vraiment quelque chose (revue sécurité C28-93 : la retirer laissait 16/16 tests verts, parce
    // qu'un motif SEUL retombe de toute façon sur le `return null` final). Ici le nom a été lu
    // sainement, la chaîne non : `vide-protégé` serait un verdict tiré d'une lecture qui a échoué.
    // Mutation : retirer cette ligne de `statutRefusCorbeille` ⇒ ces trois assertions tombent.
    for (const autre of ['racine-systeme', 'dossier-structurel', 'pas-un-dossier']) {
      expect(statutRefusCorbeille(`Corbeille refusée (ADR-0014) : ascendance-illisible, ${autre}`), autre)
        .toBeNull();
    }
  });

  it('la racine protégée ELLE-MÊME (par identité — pas dans sa propre ascendance) → refus', () => {
    expect(verdictCorbeille({ ...BASE, id: PROTEGE, nom: 'Immigration (renommée)' }))
      .toContain('zone-protegee');
  });

  it('dossier STRUCTUREL à ID fixe (Logement/Véhicule — routé par ID en dur) → refus', () => {
    expect(verdictCorbeille({ ...BASE, id: IDS_STRUCTURELS_DEFAUT[0], nom: 'Logement' }))
      .toContain('dossier-structurel');
  });

  it('racines système refusées par NOM : préfixe « _ » et « NN · » (00 · files, domaines)', () => {
    expect(verdictCorbeille({ ...BASE, nom: '_Doublons' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: '00 · À trier' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: '04 · Immigration' })).toContain('racine-systeme');
    expect(verdictCorbeille({ ...BASE, nom: 'Dossier 04 · quelconque' })).toEqual([]); // motif ancré en tête
  });

  it('violations CUMULÉES (un fichier non vide protégé les porte toutes) — insensible à l’ordre', () => {
    const v = verdictCorbeille({
      id: 'x',
      nom: '_Médias',
      mimeType: 'application/pdf',
      nbEnfants: 3,
      ascendance: { ids: [PROTEGE], complete: true },
      racinesProtegees: [PROTEGE],
    });
    expect([...v].sort()).toEqual(['non-vide', 'pas-un-dossier', 'racine-systeme', 'zone-protegee']);
  });
});

/* ---------- C28-93 : un refus classe SA ligne, il n'arrête pas le lot ---------- */

describe('statutRefusCorbeille', () => {
  it('classe chaque refus CONNU, pour que la ligne quitte la liste en disant pourquoi', () => {
    // Le décompte du 13/09 : 124 dossiers proposés, dont un `02 · Finances` EN TÊTE que le verdict
    // refuse par son nom. Le lot s'arrêtait dessus — donc zéro dossier corbeillé, pour 124 proposés.
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : racine-systeme')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : zone-protegee')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : dossier-structurel')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : pas-un-dossier')).toBe('vide-protégé');
    expect(statutRefusCorbeille('Corbeille refusée (ADR-0014) : non-vide')).toBe('vide-repris');
    expect(statutRefusCorbeille('Error: Google API 404 : {"error":{"message":"File not found"}}')).toBe('vide-disparu');
  });

  it('ne conclut RIEN sur une panne : la ligne reste candidate et sera re-tentée', () => {
    // Une incertitude ne se transforme pas en verdict — sans ça, un quota d'une minute retirerait
    // définitivement de la liste des dossiers qu'on n'a même pas regardés.
    expect(statutRefusCorbeille('Google est momentanément saturé (quota par minute)')).toBeNull();
    // ⚠️ Le message de saturation NOMME désormais l'API (C28-119) — et `statutRefusCorbeille` LIT ce
    // message. Améliorer un message pour l'humain est un changement de CONTRAT dès que du code le
    // lit (§9) : les deux variantes doivent rester des INCERTITUDES, donc la ligne reste candidate.
    // ⚠️ ALIMENTÉ PAR LA VRAIE SORTIE du producteur, jamais par une chaîne recopiée : la version
    // précédente figeait le texte à la main, si bien que revenir au message générique laissait 297
    // tests VERTS — producteur et consommateur n'étaient reliés par rien (mutation jouée en revue).
    expect(statutRefusCorbeille(messageQuota('https://sheets.googleapis.com/v4/spreadsheets/x/values/y'))).toBeNull();
    expect(statutRefusCorbeille(messageQuota('https://www.googleapis.com/drive/v3/files/x'))).toBeNull();
    // …et le message DIT bien laquelle des deux API refuse : c'est tout l'objet du correctif.
    expect(messageQuota('https://sheets.googleapis.com/v4/spreadsheets/x')).toContain('Sheets');
    expect(messageQuota('https://www.googleapis.com/drive/v3/files/x')).toContain('Drive');
    expect(statutRefusCorbeille('Session expirée — reconnecte-toi')).toBeNull();
    expect(statutRefusCorbeille('Google API 500 : backend error')).toBeNull();
    expect(statutRefusCorbeille('TypeError: Failed to fetch')).toBeNull();
    expect(statutRefusCorbeille('')).toBeNull();
  });

  it('les messages RÉELS de l\'app tombent chacun du bon côté', () => {
    // Version précédente : `expect(...).not.toBe('vide-candidat')` — tautologique (la fonction rend
    // 4 littéraux fixes ou null, l'assertion ne pouvait tomber que sur une faute de frappe).
    // Ce qui se teste vraiment, c'est la FRONTIÈRE, sur les messages que `google.ts` produit
    // réellement : un verdict d'un côté, une panne de l'autre.
    const definitifs = [
      'Error: Corbeille refusée (ADR-0014) : non-vide',
      'Error: Corbeille refusée (ADR-0014) : zone-protegee',
      'Error: Corbeille refusée (ADR-0014) : racine-systeme, non-vide',
      'Error: Google API 404 : {"error":{"code":404,"message":"File not found: abc."}}',
    ];
    const pannes = [
      'Error: Corbeille refusée (ADR-0014) : ascendance-illisible', // ← le 🔴 de la revue
      'Error: Google est momentanément saturé (quota par minute) — réessaie dans quelques secondes.',
      'Error: Session expirée — reconnecte-toi',
      'Error: Non connecté',
      'Error: Google API 500 : {"error":{"code":500}}',
      'Error: Google API 403 : {"error":{"code":403,"message":"Rate Limit Exceeded"}}',
      'TypeError: Failed to fetch',
    ];
    for (const m of definitifs) expect(statutRefusCorbeille(m), m).not.toBeNull();
    for (const m of pannes) expect(statutRefusCorbeille(m), m).toBeNull();
  });
});

/* ---------- C28-93 : le LOT lui-même — un refus n'arrête plus les suivants ---------- */

describe('corbeillerLot', () => {
  const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `ID${i}`, ligneSheet: i + 2 }));

  it('un refus EN PREMIÈRE POSITION ne bloque plus les 123 suivants (le défaut vécu)', async () => {
    // Le cas RÉEL : la liste de Marc commençait par un dossier nommé `02 · Finances`, que le verdict
    // refuse par son nom. La boucle était dans un `try` unique ⇒ 124 proposés, ZÉRO corbeillé.
    const ecrits: { ligneSheet: number; statut: string }[] = [];
    const bilan = await corbeillerLot(lignes(5), {
      corbeiller: async (id) => {
        if (id === 'ID0') throw new Error('Corbeille refusée (ADR-0014) : racine-systeme');
        if (id === 'ID2') throw new Error('Corbeille refusée (ADR-0014) : non-vide');
      },
      ecrireLot: async (debut, valeurs) =>
        valeurs.forEach((statut, k) => ecrits.push({ ligneSheet: debut + k, statut })),
    });
    expect(bilan).toEqual({ corbeilles: 3, classes: 2, aReessayer: 0, sheetKo: 0, nonTentees: 0, interrompu: '', derniereCause: '' });
    expect(ecrits.map((e) => e.statut)).toEqual(['vide-protégé', 'corbeillé', 'vide-repris', 'corbeillé', 'corbeillé']);
    expect(ecrits).toHaveLength(5); // TOUTES les lignes quittent la liste, aucune n'est oubliée
  });

  it('un refus INCONNU laisse la ligne candidate — aucune écriture, donc rien de définitif', async () => {
    const ecrits: number[] = [];
    const bilan = await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Google est momentanément saturé'); },
      ecrireLot: async (debut, valeurs) => valeurs.forEach((_v, k) => ecrits.push(debut + k)),
    });
    expect(bilan).toMatchObject({ corbeilles: 2, classes: 0, aReessayer: 1, sheetKo: 0, nonTentees: 0, interrompu: '' });
    // ⚠️ LA CAUSE EST GARDÉE (C28-121) : sans elle, « Google refuse les appels » a servi deux fois
    // de diagnostic, dont une à tort. Le message de l'exception est le SEUL endroit où la
    // différence entre un quota, un refus de droits et une ascendance illisible est écrite.
    expect(bilan.derniereCause).toContain('momentanément saturé');
    expect(ecrits).toEqual([2, 4]); // la ligne 3 n'est PAS écrite : elle sera re-proposée
  });

  it('Sheet en échec : compté À PART, jamais comme « à re-tenter » (le dossier, lui, est fait)', async () => {
    // ⚠️ L'ÉCRAN NE SUIT QUE CE QUE LA SHEET A PRIS (mutation survivante, revue C28-119). Déplacer
    // les `surLigne` AVANT le PUT ne cassait rien : Marc verrait « corbeillé » sur des lignes que le
    // prochain rechargement lui rendra `vide-candidat`, sans comprendre pourquoi. Le commentaire du
    // code portait l'invariant, aucun test ne l'observait. On espionne donc l'appel d'écran.
    const vusEcran: number[] = [];
    const bilan = await corbeillerLot(lignes(2), {
      corbeiller: async () => {},
      ecrireLot: async () => { throw new Error('Google API 429'); },
      surLigne: (ligneSheet) => vusEcran.push(ligneSheet),
    });
    expect(vusEcran).toEqual([]); // le PUT a échoué : l'écran ne doit RIEN afficher de corbeillé
    expect(bilan).toMatchObject({ corbeilles: 2, classes: 0, aReessayer: 0, sheetKo: 2, nonTentees: 0 });
    // Le total ne double-compte pas. ⚠️ La version précédente ré-additionnait des valeurs assertées
    // à la ligne d'au-dessus : tautologique (revue C28-93). Ce qui se vérifie, c'est que la somme
    // couvre le NOMBRE DE LIGNES DONNÉES — un chiffre que l'assertion précédente ne contient pas.
    expect(bilan.corbeilles + bilan.classes + bilan.aReessayer + bilan.nonTentees)
      .toBe(lignes(2).length);
  });

  it('session morte : le lot s\'arrête NET, et le bilan DIT qu\'il a été écourté', async () => {
    // ⚠️ La version précédente n'assertait que `vus === 3`, ce qu'un `stop()` évalué en FIN de corps
    // donnerait aussi (revue C28-93) — elle prouvait que `stop` est consulté, pas qu'il l'est AVANT
    // le travail. On observe donc le CHEMIN : la 4ᵉ ligne ne doit produire NI écriture NI avancement.
    let vus = 0;
    const ecrits: number[] = [];
    const avances: number[] = [];
    const bilan = await corbeillerLot(lignes(50), {
      corbeiller: async () => { vus++; },
      ecrireLot: async (debut, valeurs) => valeurs.forEach((_v, k) => ecrits.push(debut + k)),
      avancement: (fait) => avances.push(fait),
      stop: () => vus >= 3,
    });
    expect(vus).toBe(3);
    expect(ecrits).toHaveLength(3);
    expect(avances).toEqual([1, 2, 3]); // aucun 4ᵉ tour n'a commencé
    // Et surtout : un lot ÉCOURTÉ ne rend plus le même bilan qu'un lot complet. Avant ce correctif,
    // une session morte à la 40ᵉ ligne sur 124 rendait `{corbeilles:40}` et RIEN ne disait que
    // 84 lignes n'avaient jamais été tentées. Mutation : retirer `nonTentees`/`interrompu` ⇒ tombe.
    expect(bilan.interrompu).toBe('session');
    expect(bilan.nonTentees).toBe(47);
    expect(bilan.corbeilles + bilan.classes + bilan.aReessayer + bilan.nonTentees).toBe(50);
  });

  it('pannes en rafale : coupe-circuit après CORBEILLE_MAX_PANNES, au lieu de 2 000 requêtes', async () => {
    // Un 429 généralisé sur Drive faisait partir 124 lignes × ~4 appels × 4 tentatives en rafale —
    // sur un quota PARTAGÉ avec le moteur (revue sécurité C28-93). Au-delà de quelques échecs
    // d'affilée, ce n'est plus la ligne qui est en cause mais la plateforme : on rend la main.
    // Mutation : retirer le coupe-circuit ⇒ `vus` vaut 40 et ce test tombe.
    let vus = 0;
    const bilan = await corbeillerLot(lignes(40), {
      corbeiller: async () => { vus++; throw new Error('Google est momentanément saturé'); },
      ecrireLot: async () => {},
    });
    expect(vus).toBe(CORBEILLE_MAX_PANNES);
    expect(bilan.interrompu).toBe('pannes');
    expect(bilan.aReessayer).toBe(CORBEILLE_MAX_PANNES);
    expect(bilan.nonTentees).toBe(40 - CORBEILLE_MAX_PANNES);
  });

  it('le coupe-circuit surveille AUSSI le canal Sheets, pas seulement Drive', async () => {
    // 3ᵉ revue : `pannesDaffilee` n'était incrémenté que dans le catch de `corbeiller`. Un 429
    // généralisé côté SHEETS — quota lui aussi partagé avec le moteur — laissait le lot aller au
    // bout : 124 dossiers RÉELLEMENT corbeillés, 124 écritures de statut perdues, `interrompu: ''`.
    // Marc rechargeait, revoyait ses 124 lignes `vide-candidat`, et rien ne disait que les dossiers
    // étaient déjà à la corbeille. Mutation : ne plus compter `sheetKo` ⇒ ce test tombe.
    let vus = 0;
    const bilan = await corbeillerLot(lignes(40), {
      corbeiller: async () => { vus++; },
      ecrireLot: async () => { throw new Error('Google API 429'); },
    });
    // ⚠️ Depuis C28-119 les statuts partent par PLAGES, pas par cellule. La première écriture est
    // une SENTINELLE (`CORBEILLE_PREMIERE_ECRITURE`) justement pour que ce cas-ci ne change PAS de
    // gravité : on découvre que Sheets refuse après 5 dossiers, pas après 20. Le coupe-circuit
    // compte les LIGNES non inscrites, jamais les requêtes refusées — sinon il faudrait 5 plages,
    // soit 100 dossiers corbeillés à l'aveugle, pour qu'il morde.
    expect(vus).toBe(CORBEILLE_PREMIERE_ECRITURE);
    expect(bilan.interrompu).toBe('pannes');
    expect(bilan.sheetKo).toBe(CORBEILLE_PREMIERE_ECRITURE);
    expect(bilan.nonTentees).toBe(40 - CORBEILLE_PREMIERE_ECRITURE);
  });

  it('une exception de la mise à jour d\'ÉCRAN n\'est ni un échec Sheet ni une panne', async () => {
    // `surLigne` vivait DANS le try d'écriture : un plantage de rendu se comptait `sheetKo` alors
    // que la Sheet avait pris le statut — et nourrissait le coupe-circuit (3ᵉ revue).
    const bilan = await corbeillerLot(lignes(10), {
      corbeiller: async () => {},
      ecrireLot: async () => {},
      surLigne: () => { throw new Error('rendu React cassé'); },
    });
    expect(bilan).toEqual({
      corbeilles: 10, classes: 0, aReessayer: 0, sheetKo: 0, nonTentees: 0, interrompu: '',
      derniereCause: '',
    });
  });

  it('le compteur de pannes se REMET À ZÉRO dès que le canal répond', async () => {
    // Sans remise à zéro, N pannes réparties sur tout un lot finiraient par le couper alors que
    // Google répond très bien — le coupe-circuit doit viser la RAFALE, pas le cumul.
    let n = 0;
    const bilan = await corbeillerLot(lignes(30), {
      // une panne toutes les deux lignes : jamais CORBEILLE_MAX_PANNES d'affilée.
      corbeiller: async () => { if (n++ % 2 === 0) throw new Error('TypeError: Failed to fetch'); },
      ecrireLot: async () => {},
    });
    expect(bilan.interrompu).toBe('');
    expect(bilan.nonTentees).toBe(0);
    expect(bilan.corbeilles).toBe(15);
    expect(bilan.aReessayer).toBe(15);
  });

  it('C28-119 : 112 lignes contiguës ⇒ une poignée d\'écritures, pas 112 (quota Sheets 60/min)', async () => {
    // L'INCIDENT, mot pour mot de Marc au premier vrai clic : « Lot interrompu : Google refuse les
    // appels (quota ou panne). 56 dossier(s) n'ont pas été tentés. » Le coupe-circuit avait fait son
    // travail ; ce qui l'a déclenché, c'est nous. Une cellule écrite PAR DOSSIER contre un plafond
    // Sheets de 60 écritures/minute PAR UTILISATEUR — partagé avec le moteur, qui écrit dans la
    // même Sheet toutes les 5 min. Ce test mesure ce qui a causé la panne : le NOMBRE D'ÉCRITURES.
    const ecritures: { debut: number; n: number }[] = [];
    const bilan = await corbeillerLot(lignes(112), {
      corbeiller: async () => {},
      ecrireLot: async (debut, valeurs) => { ecritures.push({ debut, n: valeurs.length }); },
    });
    expect(bilan.corbeilles).toBe(112);
    expect(bilan.sheetKo).toBe(0);
    // Le chiffre exact suit les constantes, jamais une valeur recopiée : sentinelle, puis lots pleins.
    const attendu = 1 + Math.ceil((112 - CORBEILLE_PREMIERE_ECRITURE) / CORBEILLE_LOT_ECRITURE);
    expect(ecritures).toHaveLength(attendu);
    expect(attendu).toBeLessThan(60); // sous le plafond d'une minute, avec de la marge pour le moteur
    // Aucune ligne perdue, aucune écrite deux fois — c'est ce que la mise en lots pourrait casser.
    expect(ecritures.reduce((t, e) => t + e.n, 0)).toBe(112);
  });

  it('C28-119 : LISTE ÉPARSE — la mise en lots n\'aide plus, et le régulateur tient quand même', async () => {
    // ⚠️ LE TEST QUI DÉCIDE SI L'INCIDENT PEUT SE REPRODUIRE. La mise en lots ne gagne du quota que
    // si les lignes sont CONTIGUËS — et ce code ne contrôle pas la disposition : QUATRE producteurs
    // écrivent dans l'onglet Réorg, et `inscrireDossierVideCandidat_` ré-arme une ligne SUR PLACE, à
    // son ancien rang. Mesuré en revue : une ligne sur deux ⇒ 112 PUT, exactement comme AVANT le
    // correctif. Le fixture parfaitement contigu du test voisin ne pouvait pas le voir.
    // Ici chaque ligne est isolée : autant de PUT que de lignes. Ce qui doit tenir, c'est la CADENCE.
    const eparses = Array.from({ length: 112 }, (_v, i) => ({ id: 'ID' + i, ligneSheet: 2 + i * 2 }));
    let horloge = 0;
    const puts: number[] = [];
    const attentes: number[] = [];
    const bilan = await corbeillerLot(eparses, {
      corbeiller: async () => { horloge += 300; },       // ~2 dossiers/s, la cadence de l'incident
      ecrireLot: async () => { puts.push(horloge); },
      maintenant: () => horloge,
      attendre: async (ms) => { attentes.push(ms); horloge += ms; },
    });
    expect(bilan.corbeilles).toBe(112);
    expect(bilan.sheetKo).toBe(0);
    expect(puts).toHaveLength(112); // la mise en lots n'a RIEN groupé : c'est le pire cas assumé
    // …et pourtant AUCUNE fenêtre d'une minute ne dépasse le plafond. C'est ça, borner la cause.
    for (const t of puts) {
      const fenetre = puts.filter((x) => x > t - 60_000 && x <= t).length;
      expect(fenetre).toBeLessThanOrEqual(CORBEILLE_ECRITURES_PAR_MIN);
    }
    expect(attentes.length).toBeGreaterThan(0); // le régulateur a bien dû freiner
  });

  it('C28-119 : sur une liste courte, le régulateur n\'attend JAMAIS (aucun coût quand rien ne sature)', () => {
    // Un régulateur qui ralentit le cas normal se fait retirer à la première plainte. 40 lignes
    // contiguës = 2 PUT : très loin du plafond, donc zéro attente. Dérivé de la constante.
    expect(CORBEILLE_ECRITURES_PAR_MIN).toBeLessThan(60); // sous le plafond Sheets, marge pour le reste de l'app
    expect(CORBEILLE_ECRITURES_PAR_MIN).toBeGreaterThanOrEqual(30); // …sans brider l'usage normal
  });

  it('C28-121 : un lot interrompu DIT POURQUOI — la cause exacte remonte jusqu\'à l\'écran', () => {
    // ⚠️ CE TEST EXISTE À CAUSE D'UN DIAGNOSTIC FAUX. « Lot interrompu : Google refuse les appels
    // (quota ou panne) » a servi deux fois de point de départ : la première m'a fait conclure au
    // quota Sheets, la seconde — « après 4 dossiers il s'arrête sans rien supprimer » — a réfuté
    // cette conclusion (sous l'hypothèse quota-Sheets, les dossiers PARTENT et seuls les statuts
    // échouent). Entre les deux, le message de l'exception, seul endroit où la différence est
    // écrite, était JETÉ. §9 : « tout verdict indéterminé persiste son POURQUOI ».
    const causes = [
      'Error: Corbeille refusée (ADR-0014) : ascendance-illisible',
      'Error: Google API 403 : insufficientFilePermissions',
      'TypeError: Failed to fetch',
      'Error: Sheets (la feuille d\'état) est momentanément saturé (quota par minute)',
    ];
    // Chacune de ces quatre causes rend `null` (incertitude ⇒ la ligne reste candidate) — c'est
    // JUSTE, et c'est exactement pourquoi elles étaient indistinguables à l'écran.
    for (const c of causes) expect(statutRefusCorbeille(c)).toBeNull();
    // Le gabarit d'affichage porte bien un emplacement pour la cause, dans les DEUX langues.
    expect(t('corbeilleCause', 'fr')).toContain('{m}');
    expect(t('corbeilleCause', 'en')).toContain('{m}');
    // …et la vue la rend : sans cet appel, le champ existerait sans jamais atteindre Marc.
    const vue = readFileSync(join(ICI, '..', 'src', 'vues', 'Reorg.tsx'), 'utf8');
    expect(vue).toContain('bilan.derniereCause');
    expect(vue).toContain("t('corbeilleCause', langue)");
  });

  it('C28-121 : chaque famille de panne remonte SA cause, pas celle de la voisine', async () => {
    // La cause gardée doit être la DERNIÈRE vue, sur les deux canaux — Drive comme Sheets.
    const drive = await corbeillerLot(lignes(8), {
      corbeiller: async () => { throw new Error('Google API 403 : insufficientFilePermissions'); },
      ecrireLot: async () => {},
    });
    expect(drive.interrompu).toBe('pannes');
    expect(drive.corbeilles).toBe(0); // RIEN n'est parti à la corbeille — la signature de Marc
    expect(drive.derniereCause).toContain('insufficientFilePermissions');

    const sheets = await corbeillerLot(lignes(8), {
      corbeiller: async () => {},
      ecrireLot: async () => { throw new Error('Google API 429 : rateLimitExceeded'); },
    });
    expect(sheets.interrompu).toBe('pannes');
    expect(sheets.corbeilles).toBe(CORBEILLE_PREMIERE_ECRITURE); // eux SONT partis : signature opposée
    expect(sheets.derniereCause).toContain('rateLimitExceeded');
  });

  it('C28-119 : la sentinelle borne l\'exposition — au plus CORBEILLE_MAX_PANNES dossiers à l\'aveugle', () => {
    // ⚠️ Le test du coupe-circuit Sheets ci-dessus DÉRIVE ses attentes de `CORBEILLE_PREMIERE_ECRITURE` :
    // il reste donc vert si on aligne la sentinelle sur un lot plein (mutation jouée, survivante).
    // Ce qui n'est PAS tautologique, c'est la RELATION entre les constantes : mettre les statuts en
    // lots repousse le moment où l'on découvre que Sheets ne répond plus, et ce délai se paie en
    // dossiers corbeillés sans trace. Il ne doit jamais dépasser ce que le coupe-circuit tolérait
    // avant la mise en lots.
    expect(CORBEILLE_PREMIERE_ECRITURE).toBeLessThanOrEqual(CORBEILLE_MAX_PANNES);
    // …et c'est bien une SENTINELLE : plus petite qu'un lot plein, sinon elle ne sert à rien.
    expect(CORBEILLE_PREMIERE_ECRITURE).toBeLessThan(CORBEILLE_LOT_ECRITURE);
    // Le lot plein, lui, doit valoir le détour : sous ~10, on ne gagne plus assez de quota pour
    // justifier la fenêtre « corbeillé mais pas encore inscrit ».
    expect(CORBEILLE_LOT_ECRITURE).toBeGreaterThanOrEqual(10);
    // ⚠️ ET UNE BORNE HAUTE (mutation survivante, revue C28-119). Le docblock PROMET « au pire 20
    // lignes à re-constater, jamais 112 » — sans cette ligne, passer la constante à 200 laissait
    // 27 tests verts et la fenêtre aveugle avalait le lot entier. « Promesse de verrou = verrou
    // codé dans le même commit » (§9).
    expect(CORBEILLE_LOT_ECRITURE).toBeLessThanOrEqual(25);
  });

  it('C28-119 : des lignes NON contiguës se découpent en plages, chacune avec SES statuts', async () => {
    // `plagesContigues` est ce qui rend l'écriture par plage sûre : un PUT couvre une plage ENTIÈRE,
    // donc une ligne non sélectionnée qui s'y glisserait serait ÉCRASÉE. Les refus (qui ne s'écrivent
    // pas) creusent justement des trous. Ce test prouve qu'aucun trou n'est recouvert.
    const ecritures: { debut: number; valeurs: string[] }[] = [];
    // lignes(6) → lignesSheet 2,3,4,5,6,7. On fait échouer ID2 (ligne 4) sur une panne INCONNUE :
    // elle reste candidate, donc jamais écrite ⇒ deux plages, 2-3 et 5-7.
    await corbeillerLot(lignes(6), {
      corbeiller: async (id) => { if (id === 'ID2') throw new Error('Google est momentanément saturé'); },
      ecrireLot: async (debut, valeurs) => { ecritures.push({ debut, valeurs }); },
    });
    expect(ecritures).toEqual([
      { debut: 2, valeurs: ['corbeillé', 'corbeillé'] },
      { debut: 5, valeurs: ['corbeillé', 'corbeillé', 'corbeillé'] },
    ]);
  });

  it('C28-119 : le tampon est vidé MÊME quand le lot est écourté (aucun travail perdu)', async () => {
    // Sans ce vidage, les dossiers corbeillés avant la coupure repartaient sans trace : au clic
    // suivant ils étaient re-présentés, et Marc re-cliquait sur du travail déjà fait — pire, la
    // re-tentative tombait sur un 404 « déjà corbeillé » qu'il fallait interpréter.
    let vus = 0;
    const ecritures: string[][] = [];
    const bilan = await corbeillerLot(lignes(50), {
      corbeiller: async () => { vus++; },
      ecrireLot: async (_d, valeurs) => { ecritures.push(valeurs); },
      stop: () => vus >= 3, // coupure AVANT le seuil de la sentinelle : le tampon est non vide
    });
    expect(bilan.interrompu).toBe('session');
    expect(vus).toBe(3);
    expect(ecritures.flat()).toHaveLength(3); // les 3 dossiers faits ont bien leur statut inscrit
  });

  it('rend compte de l\'avancement à chaque ligne, refus compris', async () => {
    const vus: number[] = [];
    await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Corbeille refusée (ADR-0014) : non-vide'); },
      ecrireLot: async () => {},
      avancement: (fait) => vus.push(fait),
    });
    expect(vus).toEqual([1, 2, 3]);
  });
});

/* ---------- C28-93/C28-110 : le compte rendu doit être VU là où on clique ---------- */

describe('carteVidesVisible + placement du compte rendu (C28-93)', () => {
  it('succès COMPLET (plus un seul candidat) : la carte reste, pour porter le bilan', () => {
    // Le cas nominal, précisément celui qui ne s'affichait jamais : 112 dossiers corbeillés,
    // 0 candidat restant, un bilan à montrer. Gatée sur la liste, la carte se démontait ici.
    expect(carteVidesVisible(0, { bilan: '112 dossiers mis à la corbeille' })).toBe(true);
    expect(carteVidesVisible(0, { erreur: 'Corbeille refusée : non-vide' })).toBe(true);
    expect(carteVidesVisible(0, { avancement: { fait: 7, total: 112 } })).toBe(true);
    expect(carteVidesVisible(3, {})).toBe(true);
  });

  it('rien à dire et rien à lister → la carte n\'existe pas (pas de cadre vide)', () => {
    expect(carteVidesVisible(0, {})).toBe(false);
    expect(carteVidesVisible(0, { erreur: null, bilan: '', avancement: undefined })).toBe(false);
  });

  it('TRIPWIRE : la vue GATE la carte par ce prédicat, et rend le retour APRÈS la liste', () => {
    // 🔴 C28-93 — le vrai défaut n'était pas le code de la corbeille (il marchait), c'était l'ENDROIT
    // du rendu : le compte rendu s'affichait en TÊTE de carte, ~112 lignes au-dessus du bouton sur
    // lequel Marc venait de cliquer. Un test de logique pure ne peut pas voir ça : l'ORDRE du rendu
    // et le fait que la vue appelle bien le prédicat se verrouillent sur la SOURCE.
    const vue = readFileSync(join(ICI, '..', 'src', 'vues', 'Reorg.tsx'), 'utf8');
    // ⚠️ LA LIGNE ENTIÈRE, jamais une sous-chaîne (🟠 revue code ADR-0056). La première version
    // asserta `toContain('carteVidesVisible(')` + l'absence d'une forme qui n'a JAMAIS existé dans
    // ce fichier : la mutation `videsCandidats.length > 0 && carteVidesVisible(…) && (` — c'est-à-dire
    // exactement le bug C28-110 réintroduit, et la façon dont une prochaine session « nettoiera »
    // l'affichage — passait au vert. On verrouille donc la ligne du début à la fin.
    const ligne = vue.split('\n').find((l) => l.includes('carteVidesVisible('));
    expect(ligne, 'la vue doit gater la carte par le prédicat').toBeDefined();
    expect(ligne!.trim()).toMatch(
      /^\{carteVidesVisible\(videsCandidats\.length, \{[^}]*\}\) && \($/,
    );
    const liste = vue.indexOf('videsCandidats.map(');
    const retour = vue.indexOf('className="corbeille-retour"');
    expect(liste).toBeGreaterThan(0);
    expect(retour).toBeGreaterThan(liste); // le retour est SOUS la liste, jamais au-dessus
    // …et il reste visible où qu'on soit dans une liste de 112 lignes : collant, dégagé de la
    // barre d'onglets du téléphone (sinon il se rend SOUS elle — 🔴 revue ADR-0056).
    const css = readFileSync(join(ICI, '..', 'src', 'styles.css'), 'utf8');
    const bloc = css.slice(css.indexOf('.corbeille-retour'));
    expect(bloc.slice(0, 400)).toMatch(/position:\s*sticky/);
    // ⚠️ La règle doit être DANS la media query (🟡 revue code ADR-0056) : `--barre-basse-h` n'est
    // déclarée que sous 760 px. Hors media query, `calc(var(--barre-basse-h) + …)` est INVALIDE, la
    // déclaration est jetée en silence, et le bilan repasse sous la barre d'onglets — exactement le
    // bug qu'on ferme. On ancre donc l'assertion sur le BLOC, pas sur le fichier entier.
    const media = css.slice(css.indexOf('@media (max-width: 760px) {\n  .corbeille-retour'));
    expect(media.slice(0, 200)).toMatch(
      /\.corbeille-retour\s*\{[^}]*bottom:\s*calc\(var\(--barre-basse-h\)/,
    );
  });
});
