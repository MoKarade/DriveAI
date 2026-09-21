/**
 * lecture.test.ts — L'ONGLET LECTURE : ce qu'il peut dire, et ce qu'il ne doit pas inventer.
 *
 * Écrit le 21/09/2026, après deux messages de Marc : « ça ne m'explique toujours pas
 * l'avancement », puis « je veux vraiment un onglet précis pour l'avancement, avec ce qui est
 * en train d'être lu, ce qui a déjà été lu ».
 *
 * Six propriétés, et aucune ne se déduit du code :
 *
 *  1. une ligne sans identifiant est IGNORÉE — l'afficher compterait un traitement qui n'a pas eu lieu ;
 *  2. un verdict ABSENT n'est pas un verdict d'ÉCHEC : ce sont des lignes écrites avant que le
 *     moteur ne l'inscrive, et les confondre ferait croire que d'anciennes lectures ont raté ;
 *  3. un verdict INCONNU se cite au lieu de tomber dans une catégorie existante ;
 *  4. le bilan ne compte QUE le tag courant — un bump remet les compteurs du moteur à zéro ;
 *  5. l'ordre des « derniers lus » vient de la POSITION, jamais d'un tri sur une date à la
 *     minute que tout un lot partage ;
 *  6. la barre du bas porte autant de cases qu'il y a d'onglets — une valeur figée à 4 a
 *     survécu au passage à 5 sans que rien ne rougisse.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  interpreterPiecesFaites, verdictLecture, bilanLecture, derniersLus, ligneSanteLecture,
  fileLecture, enCoursLecture, manquesLecture, cadenceLecture,
  importFile, certitudeClassement,
} from '../src/etat';
import { SECTIONS_NAV } from '../src/App';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

describe('interpreterPiecesFaites', () => {
  it('ignore une ligne sans identifiant, et garde les champs absents VIDES', () => {
    const lus = interpreterPiecesFaites([
      ['id-1', 'c49-5-b', '2026-09-21 14:02', 'Passeport.pdf', 'ok'],
      ['', 'c49-5-b', '2026-09-21 14:02', 'fantome.pdf', 'ok'],
      ['id-2', 'c49-5-b', '2026-09-21 14:03'], // ligne d'AVANT l'ajout de Nom/Motif
    ]);
    expect(lus.map((d) => d.fileId)).toEqual(['id-1', 'id-2']);
    expect(lus[1]!.nom).toBe('');
    expect(lus[1]!.motif).toBe('');
  });
});

describe('verdictLecture', () => {
  it('sépare « lu », « rien à en tirer » et « en échec »', () => {
    expect(verdictLecture('ok').classe).toBe('ok');
    expect(verdictLecture('illisible').classe).toBe('vide');
    expect(verdictLecture('sans-texte').classe).toBe('vide');
    expect(verdictLecture('ocr-echec').classe).toBe('echec');
    expect(verdictLecture('refusee').classe).toBe('echec');
  });

  it('un verdict ABSENT n\'est pas un échec — c\'est une ligne d\'avant', () => {
    const v = verdictLecture('');
    expect(v.classe).toBe('inconnu');
    expect(v.libelle).toMatch(/antérieure/);
  });

  it('un verdict INCONNU se CITE', () => {
    expect(verdictLecture('motif-de-demain').libelle).toContain('motif-de-demain');
    expect(verdictLecture('motif-de-demain').classe).toBe('inconnu');
  });
});

describe('bilanLecture', () => {
  it('ne compte que le tag COURANT', () => {
    const b = bilanLecture(interpreterPiecesFaites([
      ['a', 'c49-5-a', '2026-09-20 10:00', 'vieux.pdf', 'ok'],
      ['b', 'c49-5-b', '2026-09-21 14:00', 'x.pdf', 'ok'],
      ['c', 'c49-5-b', '2026-09-21 14:01', 'y.pdf', 'illisible'],
      ['d', 'c49-5-b', '2026-09-21 14:02', 'z.pdf', 'ocr-echec'],
    ]));
    expect(b).toEqual({ total: 3, ok: 1, vide: 1, echec: 1, inconnu: 0 });
  });

  it('rend des zéros sur une liste vide, sans NaN', () => {
    expect(bilanLecture([])).toEqual({ total: 0, ok: 0, vide: 0, echec: 0, inconnu: 0 });
  });
});

describe('derniersLus', () => {
  it('ordonne par POSITION dans l\'onglet, pas par date', () => {
    // ⚠️ Les trois partagent la MÊME minute : c'est le cas réel d'un lot traité en une passe.
    // Un tri sur la date rendrait un ordre arbitraire, différent à chaque affichage.
    const lus = interpreterPiecesFaites([
      ['a', 't', '2026-09-21 14:00', 'un.pdf', 'ok'],
      ['b', 't', '2026-09-21 14:00', 'deux.pdf', 'ok'],
      ['c', 't', '2026-09-21 14:00', 'trois.pdf', 'ok'],
    ]);
    expect(derniersLus(lus, 2).map((d) => d.nom)).toEqual(['trois.pdf', 'deux.pdf']);
    expect(derniersLus(lus, 0)).toEqual([]);
    expect(derniersLus(lus, 99)).toHaveLength(3);
  });
});

describe('ligneSanteLecture', () => {
  it('extrait la ligne de la campagne, et rend null quand elle manque', () => {
    const sante = [
      'Dernier passage OK : 2026-09-21 10:12',
      'Rattrapage des pièces (C49-5) : 1085 restants · dernière passe : 1/0/0/0 — passe terminée',
      'Mémoire (pièces) : désactivée (CONFIG)',
    ];
    expect(ligneSanteLecture(sante)).toMatch(/^1085 restants/);
    // ⚠️ `null`, jamais une phrase de repli : « la campagne n'a rien écrit » et « voici son
    // état » sont deux choses, et seule la première peut être une panne du canal.
    expect(ligneSanteLecture(['Dernier passage OK : …'])).toBeNull();
    expect(ligneSanteLecture([])).toBeNull();
  });
});

describe('la barre du bas suit le nombre d\'onglets', () => {
  it('autant de colonnes que de sections — la valeur ne se fige pas', () => {
    // ⚠️ MESURÉ : `repeat(4, 1fr)` a survécu au passage à cinq onglets sans qu'aucun test ne
    // rougisse. Une case de plus dans une grille figée à quatre déborde, et ça ne se voit que
    // sur un téléphone. La garde DÉRIVE du code plutôt que d'épingler un nombre.
    const css = lire('../src/styles.css');
    const m = css.match(/nav\.barre-basse \{\s*display: grid; grid-template-columns: repeat\((\d+), 1fr\)/);
    expect(m, 'la grille de la barre basse est introuvable').not.toBeNull();
    expect(Number(m![1])).toBe(SECTIONS_NAV.length);
  });

  it('chaque onglet mène à une vue — un onglet qui ne mène nulle part est pire qu\'un onglet en moins', () => {
    const app = lire('../src/App.tsx');
    for (const s of SECTIONS_NAV) {
      if (s === 'aujourdhui') continue; // rendu par défaut, sans garde de section
      expect(app, `l'onglet « ${s} » n'a aucune vue`).toContain(`section === '${s}' &&`);
    }
  });
});


/* ══════════════════════════════════════════════════════════════════════════════════════════
   C49-14 — « je vois pas de courbe pas d'estimé je sais pas ça traite quoi en ce moment quel
   dossier quel fichier quelle direction quelles infos il lui manque » (Marc, 21/09).

   Cinq questions. Les gardes ci-dessous tiennent les réponses ET leurs refus d'inventer.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('la file par dossier — « quel dossier, quelle direction »', () => {
  const sante = (l: string[]) => l;

  it('lit l\'ENCODAGE du moteur, pas sa phrase française', () => {
    const f = fileLecture(sante(['Lecture — file : 04:0/23·01:40/87·02:976/976']));
    expect(f).not.toBeNull();
    expect(f).toEqual([
      { prefixe: '04', restants: 0, total: 23, lus: 23 },
      { prefixe: '01', restants: 40, total: 87, lus: 47 },
      { prefixe: '02', restants: 976, total: 976, lus: 0 },
    ]);
  });

  it('distingue « pas publiée » de « publiée et illisible »', () => {
    // ⚠️ Les deux ne se réparent pas au même endroit : l'une est un moteur qui n'a pas tourné,
    // l'autre un format qui a changé. Les fondre enverrait chercher au mauvais endroit.
    expect(fileLecture(sante(['autre chose']))).toBeNull();
    expect(fileLecture(sante(['Lecture — file : n’importe quoi']))).toEqual([]);
  });
});

describe('le document en cours — « ça traite quoi en ce moment »', () => {
  it('rend le document quand il y en a un', () => {
    expect(enCoursLecture(['Lecture — en cours : Passeport.pdf (04 · Immigration)']))
      .toBe('Passeport.pdf (04 · Immigration)');
  });

  it('le REPOS n\'est pas un document — il rend null, pour que l\'écran montre le dernier lu', () => {
    // ⚠️ Le moteur écrit sa propre phrase de repos : la reconnaître ici évite que l'écran
    // affiche « en train de lire : rien en ce moment… », qui se lirait comme un nom de fichier.
    expect(enCoursLecture(['Lecture — en cours : rien en ce moment (la campagne lit par rafales, à chaque tick)']))
      .toBeNull();
    expect(enCoursLecture(['Lecture — en cours : état illisible'])).toBeNull();
    expect(enCoursLecture(['autre chose'])).toBeNull();
  });
});

describe('ce qui manque — « quelles infos il lui manque »', () => {
  const l = (id: string, nom: string, motif: string, dom: string, tag = 'c49-5-b') =>
    [id, tag, '2026-09-21 10:00', nom, motif, dom];

  it('ne retient que les documents dont il MANQUE quelque chose, nommés', () => {
    const lus = interpreterPiecesFaites([
      l('1', 'ok.pdf', 'ok', '04 · Immigration'),
      l('2', 'photo.jpg', 'illisible', '01 · Administratif & identité'),
      l('3', 'scan.pdf', 'sans-texte', '02 · Finances'),
    ]);
    const m = manquesLecture(lus, 10);
    expect(m.map((x) => x.nom)).toEqual(['scan.pdf', 'photo.jpg']);
    expect(m[0]!.domaine).toBe('02 · Finances');
    expect(m[1]!.raison).toMatch(/photo à refaire/);
  });

  it('un verdict NON ENREGISTRÉ n\'est pas un manque', () => {
    // ⚠️ Ce sont des lignes d'avant C49-13. Les afficher « à refaire » enverrait Marc rouvrir
    // des documents dont on ne sait simplement rien.
    const lus = interpreterPiecesFaites([l('1', 'vieux.pdf', '', '04 · Immigration')]);
    expect(manquesLecture(lus, 10)).toEqual([]);
  });

  it('ne mélange pas les tags — un bump remet la campagne à zéro', () => {
    const lus = interpreterPiecesFaites([
      l('1', 'vieux.pdf', 'illisible', '04 · Immigration', 'c49-5-a'),
      l('2', 'neuf.pdf', 'ok', '04 · Immigration', 'c49-5-b'),
    ]);
    expect(manquesLecture(lus, 10)).toEqual([]);
  });
});

describe('la cadence — « pas d\'estimé »', () => {
  const l = (id: string, jour: string) => [id, 'c49-5-b', jour + ' 10:00', 'x.pdf', 'ok', '04 · X'];

  it('se mesure sur les JOURS ACTIFS, jamais sur les jours écoulés', () => {
    // ⚠️ Le piège déjà payé (MemoryAI, 18/09) : « total ÷ jours écoulés » donne 1/jour sur une
    // campagne qui en fait 3 en une journée puis s'arrête trois jours. Les deux chiffres sont
    // vrais, un seul répond à « combien de jours OÙ ÇA TOURNE ».
    const lus = interpreterPiecesFaites([
      l('1', '2026-09-18'),
      l('2', '2026-09-21'), l('3', '2026-09-21'), l('4', '2026-09-21'),
    ]);
    const c = cadenceLecture(lus, 9);
    expect(c.parJourActif).toBe(3);
    expect(c.jour).toBe('2026-09-21');
    expect(c.joursActifs).toBe(2);
    expect(c.joursRestants).toBe(3); // 9 / 3, et non 9 / (4 documents / 4 jours)
  });

  it('aucun document lu ⇒ AUCUN horizon, jamais un grand nombre', () => {
    expect(cadenceLecture([], 100).joursRestants).toBeNull();
    // Un reste inconnu non plus : on ne divise pas par ce qu'on ignore.
    const lus = interpreterPiecesFaites([l('1', '2026-09-21')]);
    expect(cadenceLecture(lus, null).joursRestants).toBeNull();
  });
});

describe('le DOSSIER voyage avec le document', () => {
  it('la sixième colonne est lue, et son absence reste VIDE', () => {
    const lus = interpreterPiecesFaites([
      ['1', 'c49-5-b', '2026-09-21 10:00', 'a.pdf', 'ok', '04 · Immigration'],
      ['2', 'c49-5-b', '2026-09-21 10:00', 'b.pdf', 'ok'], // ligne d'avant C49-14
    ]);
    expect(lus[0]!.domaine).toBe('04 · Immigration');
    // ⚠️ Vide, jamais « inconnu » : une ligne ancienne n'est pas un document sans dossier.
    expect(lus[1]!.domaine).toBe('');
  });

  it('l\'onglet lit bien SIX colonnes — une plage trop courte viderait le dossier en silence', () => {
    // ⚠️ Garde de FORME, et elle est nécessaire : `A2:E` ne lève aucune erreur, il rend
    // simplement un dossier vide partout. C'est exactement le genre de défaut que ce lot
    // existe pour supprimer, recommis un cran plus bas.
    const src = lire('../src/vues/Lecture.tsx');
    expect(src).toMatch(/const PLAGE = 'A2:F'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════
   C49-23 — LES DEUX FILES EN TÊTE, ET LE POURCENTAGE DE CERTITUDE

   Marc, le 21/09 : « juste une file d'attente que je vois progresser, aussi le pourcentage
   de certitude, fil d'attente pour import et fil d'attente pour lecture ».

   Trois propriétés, aucune déductible du code :
    7. `importFile` lit l'ENCODÉ, et rend `null` sur tout ce qui n'en est pas un — la phrase
       française de « Mémoire (inventaire) » porte les mêmes nombres et ne doit PAS être lue ;
    8. une cible absente n'est pas une cible à zéro : pas de jauge, jamais une jauge pleine ;
    9. la certitude se calcule sur les lignes MESURÉES, et les lignes sans mesure se comptent
       à part — les verser d'un côté ou de l'autre ferait dériver le pourcentage tout seul.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

describe('C49-23 — la file d’import', () => {
  it('lit la ligne ENCODÉE et rend les deux nombres', () => {
    const sante = ['Import — file : 2731/4240', 'Lecture — file : 04 ✅ (48)'];
    expect(importFile(sante)).toEqual({ pousses: 2731, cible: 4240 });
  });

  it('rend null quand le moteur ne publie pas encore cette ligne', () => {
    expect(importFile(['Lecture — file : 04 ✅ (48)'])).toBeNull();
  });

  // ⚠️ LE cas qui compte : la ligne EXISTE et dit qu'elle ne sait pas. Rendre `{pousses, 0}`
  // afficherait une jauge pleine sur un comptage qui n'a jamais eu lieu.
  it('rend null quand la cible n’a jamais été mesurée', () => {
    expect(importFile(['Import — file : cible non mesurée — bumper CONFIG.PERIMETRE_PIECE_TAG'])).toBeNull();
    expect(importFile(['Import — file : 2731/0'])).toBeNull();
  });

  // ⚠️ La règle du dépôt : « le format lu est celui que le moteur ÉCRIT, jamais la phrase
  // française ». Ce cas la VERROUILLE : il rougit si quelqu'un élargit le motif pour
  // « aussi accepter » une prose qui contient un couple.
  //
  // ⚠️⚠️ Le TÉMOIN a dû être refait. Mon premier jet donnait une ligne préfixée
  // « Mémoire (inventaire) : … » — mais `ligneSanteNommee` ne la trouve même pas, donc le
  // cas rendait `null` AVANT d'atteindre le motif : il testait le préfixe, pas le format, et
  // élargir le motif le laissait VERT (mesuré). Le témoin qui discrimine porte le BON préfixe
  // et une valeur en PROSE : un motif non ancré y trouverait « 12/4240 » et publierait 12
  // documents poussés au lieu de 2731 — un chiffre faux, pas une absence.
  it('ne lit PAS une valeur en prose, même quand elle contient un couple', () => {
    const prose = ['Import — file : 2731 faits acceptés, à la ligne 12/4240'];
    expect(importFile(prose)).toBeNull();
  });

  // Le préfixe est une SECONDE protection, et elle se teste à part de la première.
  it('ne confond pas la ligne de l’inventaire avec la sienne', () => {
    const autre = ['Mémoire (inventaire) : 2731 faits acceptés au total · à la ligne 0/0'];
    expect(importFile(autre)).toBeNull();
  });
});

describe('C49-23 — la certitude du classement', () => {
  const ligne = (confiance: string) => ({
    cle: 'drive|x', nom: 'n', domaine: '01', statut: 'classé', chemin: '/', date: '', annee: '',
    confiance,
  } as unknown as Parameters<typeof certitudeClassement>[0][number]);

  it('compte les mesurées, et met les lignes SANS mesure à part', () => {
    const c = certitudeClassement([ligne('0.9'), ligne('0.8'), ligne('0.2'), ligne(''), ligne('')]);
    expect(c.mesurees).toBe(3);
    expect(c.sures).toBe(2);
    expect(c.auMieux).toBe(1);
    expect(c.sansMesure).toBe(2);
    // 2 sûres sur 3 MESURÉES — et pas 2 sur 5, ce que donnerait un dénominateur « total ».
    expect(c.pourcent).toBe(67);
  });

  it('rend null plutôt que 0 % quand rien n’est mesuré', () => {
    const c = certitudeClassement([ligne(''), ligne('pas-un-nombre')]);
    expect(c.mesurees).toBe(0);
    expect(c.sansMesure).toBe(2);
    expect(c.pourcent).toBeNull();
  });

  it('accepte la virgule décimale, comme le reste du dépôt', () => {
    expect(certitudeClassement([ligne('0,3')]).auMieux).toBe(1);
  });

  it('une liste vide ne lève pas et ne prétend rien', () => {
    expect(certitudeClassement([]).pourcent).toBeNull();
  });
});
