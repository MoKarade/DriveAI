/**
 * corbeille.test.ts — le verdict PUR de l'ADR-0014 (unique exception au §2).
 * Chaque garde est testée : type, vacuité STRICTE, ascendance (échec fermé), noms réservés.
 * L'action réseau (corbeillerDossierVide) ne part que sur verdict vide — vérifié par lecture
 * du code dans aucune-suppression.test.ts (tripwire) ; ici on fige la décision.
 */

import { describe, it, expect } from 'vitest';
import { verdictCorbeille, statutRefusCorbeille, corbeillerLot, CORBEILLE_MAX_PANNES } from '../src/corbeille';
import { carteVidesVisible } from '../src/etat';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = fileURLToPath(new URL('.', import.meta.url));
import { IDS_STRUCTURELS_DEFAUT } from '../src/garde-fous';
import { MIME_DOSSIER } from '../src/explorateur';

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
      ecrire: async (ligneSheet, statut) => { ecrits.push({ ligneSheet, statut }); },
    });
    expect(bilan).toEqual({ corbeilles: 3, classes: 2, aReessayer: 0, sheetKo: 0, nonTentees: 0, interrompu: '' });
    expect(ecrits.map((e) => e.statut)).toEqual(['vide-protégé', 'corbeillé', 'vide-repris', 'corbeillé', 'corbeillé']);
    expect(ecrits).toHaveLength(5); // TOUTES les lignes quittent la liste, aucune n'est oubliée
  });

  it('un refus INCONNU laisse la ligne candidate — aucune écriture, donc rien de définitif', async () => {
    const ecrits: number[] = [];
    const bilan = await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Google est momentanément saturé'); },
      ecrire: async (ligneSheet) => { ecrits.push(ligneSheet); },
    });
    expect(bilan).toEqual({ corbeilles: 2, classes: 0, aReessayer: 1, sheetKo: 0, nonTentees: 0, interrompu: '' });
    expect(ecrits).toEqual([2, 4]); // la ligne 3 n'est PAS écrite : elle sera re-proposée
  });

  it('Sheet en échec : compté À PART, jamais comme « à re-tenter » (le dossier, lui, est fait)', async () => {
    const bilan = await corbeillerLot(lignes(2), {
      corbeiller: async () => {},
      ecrire: async () => { throw new Error('Google API 429'); },
    });
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
      ecrire: async (ligneSheet) => { ecrits.push(ligneSheet); },
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
      ecrire: async () => {},
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
      ecrire: async () => { throw new Error('Google API 429'); },
    });
    expect(vus).toBe(CORBEILLE_MAX_PANNES);
    expect(bilan.interrompu).toBe('pannes');
    expect(bilan.sheetKo).toBe(CORBEILLE_MAX_PANNES);
    expect(bilan.nonTentees).toBe(40 - CORBEILLE_MAX_PANNES);
  });

  it('une exception de la mise à jour d\'ÉCRAN n\'est ni un échec Sheet ni une panne', async () => {
    // `surLigne` vivait DANS le try d'écriture : un plantage de rendu se comptait `sheetKo` alors
    // que la Sheet avait pris le statut — et nourrissait le coupe-circuit (3ᵉ revue).
    const bilan = await corbeillerLot(lignes(10), {
      corbeiller: async () => {},
      ecrire: async () => {},
      surLigne: () => { throw new Error('rendu React cassé'); },
    });
    expect(bilan).toEqual({
      corbeilles: 10, classes: 0, aReessayer: 0, sheetKo: 0, nonTentees: 0, interrompu: '',
    });
  });

  it('le compteur de pannes se REMET À ZÉRO dès que le canal répond', async () => {
    // Sans remise à zéro, N pannes réparties sur tout un lot finiraient par le couper alors que
    // Google répond très bien — le coupe-circuit doit viser la RAFALE, pas le cumul.
    let n = 0;
    const bilan = await corbeillerLot(lignes(30), {
      // une panne toutes les deux lignes : jamais CORBEILLE_MAX_PANNES d'affilée.
      corbeiller: async () => { if (n++ % 2 === 0) throw new Error('TypeError: Failed to fetch'); },
      ecrire: async () => {},
    });
    expect(bilan.interrompu).toBe('');
    expect(bilan.nonTentees).toBe(0);
    expect(bilan.corbeilles).toBe(15);
    expect(bilan.aReessayer).toBe(15);
  });

  it('rend compte de l\'avancement à chaque ligne, refus compris', async () => {
    const vus: number[] = [];
    await corbeillerLot(lignes(3), {
      corbeiller: async (id) => { if (id === 'ID1') throw new Error('Corbeille refusée (ADR-0014) : non-vide'); },
      ecrire: async () => {},
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
