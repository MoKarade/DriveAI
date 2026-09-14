/**
 * corbeille.ts — L'UNIQUE porte de mise à la corbeille de TOUTE l'app (ADR-0014, révision
 * ÉTROITE du §2 validée par Marc le 2026-07-06). Périmètre : un DOSSIER devenu VIDE après une
 * réorg validée (ligne `vide-candidat`), au CLIC de Marc — récupérable 30 jours dans la
 * corbeille Drive. Jamais un fichier, jamais un dossier non vide, jamais la zone protégée,
 * jamais une racine système, jamais la suppression DÉFINITIVE (interdite partout, y compris ici).
 *
 * Ce fichier est le SEUL de `src/` autorisé à porter `trashed: true` — verrouillé par le
 * tripwire de `test/aucune-suppression.test.ts` (exception chirurgicale + cohérence
 * CLAUDE.md §2 ↔ ce fichier, dans les deux sens). Le verdict est PUR et testé : l'action
 * réseau ne part que sur verdict vide, avec des données RE-VÉRIFIÉES en direct au clic
 * (une ligne `vide-candidat` est un candidat, jamais une preuve — le moteur a pu re-remplir
 * le dossier entre-temps).
 */

import { Ascendance, RACINES_PROTEGEES_DEFAUT, IDS_STRUCTURELS_DEFAUT } from './garde-fous';
import { plagesContigues } from './etat';
import { MIME_DOSSIER } from './explorateur';
import { api, lireFichier, remonterAscendance, viderCachesDrive, DRIVE } from './google';

/**
 * Verdict PUR (testé) : ce dossier peut-il partir à la corbeille ? Liste des violations
 * (vide = autorisé). Toutes les données viennent d'une re-lecture LIVE faite par l'appelant.
 */
export function verdictCorbeille(args: {
  id: string;
  nom: string;
  mimeType: string;
  nbEnfants: number; // 0 ou 1 (compte BORNÉ pageSize=1) — tous statuts confondus, corbeillés inclus
  ascendance: Ascendance;
  racinesProtegees?: string[];
  idsStructurels?: string[];
}): string[] {
  const violations: string[] = [];
  if (args.mimeType !== MIME_DOSSIER) violations.push('pas-un-dossier');
  if (args.nbEnfants > 0) violations.push('non-vide');
  const proteges = args.racinesProtegees ?? RACINES_PROTEGEES_DEFAUT;
  // Identité D'ABORD (la racine protégée elle-même n'est pas dans sa propre ascendance), puis
  // ascendance. Le refus est le MÊME dans les deux cas (échec fermé) — mais le MOTIF diffère, et
  // c'est tout l'objet de cette séparation (revue C28-93, 🔴) : « je sais que c'est protégé » est un
  // VERDICT, « je n'ai pas pu lire la chaîne » est une PANNE. Les deux arrivaient au lecteur sous
  // la même chaîne `zone-protegee`, si bien qu'un 429 sur un GET d'ancêtre retirait définitivement
  // une ligne de la liste (le moteur dédoublonne à vie sur `videcandidat|<id>` : jamais re-proposé).
  // C'est la leçon §9 « un verdict pris sur la donnée RICHE ne se re-dérive jamais depuis sa forme
  // APPAUVRIE » — d'où un motif explicite porté par celui qui SAIT.
  if (proteges.includes(args.id) || args.ascendance.ids.some((id) => proteges.includes(id))) {
    violations.push('zone-protegee');
  } else if (!args.ascendance.complete) {
    violations.push('ascendance-illisible'); // refus identique, motif distinct : jamais un verdict
  }
  const structurels = args.idsStructurels ?? IDS_STRUCTURELS_DEFAUT;
  if (structurels.includes(args.id)) {
    violations.push('dossier-structurel'); // ID fixe du router (Logement/Véhicule) — jamais corbeillé
  }
  const nom = args.nom.trim();
  if (nom.charAt(0) === '_' || /^\d{2} · /.test(nom)) {
    violations.push('racine-systeme'); // _Doublons/_Médias/…, 00 · files, NN · domaines
  }
  return violations;
}

/**
 * Verdict d'une tentative de corbeille qui N'A PAS abouti : que fait-on de la ligne ? PURE (testée).
 *
 * Pourquoi cette fonction existe (C28-93) : le lot s'arrêtait à la PREMIÈRE exception, et la liste
 * de Marc commençait par un dossier nommé `02 · Finances` — refusé par son nom. Le bouton « tout
 * corbeiller (124) » ne corbeillait donc RIEN, sans qu'on puisse le deviner. Un refus n'est pas une
 * panne : c'est un VERDICT sur UNE ligne, et il doit retirer cette ligne de la liste en disant
 * pourquoi, pas arrêter les 123 suivantes.
 *
 * Le statut rendu n'est jamais `vide-candidat` : la ligne quitte la liste dans tous les cas où on
 * sait conclure. `null` = on ne sait pas (réseau, quota, session) ⇒ la ligne RESTE candidate et
 * sera re-tentée : une incertitude ne se transforme pas en verdict.
 */
export function statutRefusCorbeille(message: string): string | null {
  const brut = String(message);
  if (brut.includes('Google API 404')) return 'vide-disparu';   // déjà supprimé/corbeillé ailleurs
  if (brut.includes('non-vide')) return 'vide-repris';          // le classement l'a re-rempli
  if (brut.includes('ascendance-illisible')) return null;        // PANNE de lecture : aucun verdict
  if (brut.includes('zone-protegee') || brut.includes('racine-systeme') ||
      brut.includes('dossier-structurel') || brut.includes('pas-un-dossier')) {
    return 'vide-protégé';                                      // ne devait jamais être proposé
  }
  return null;                                                  // transitoire : on re-tentera
}

/**
 * Nombre de pannes CONSÉCUTIVES au-delà duquel le lot s'arrête. Sans ce coupe-circuit, un 429
 * généralisé sur Drive faisait partir 124 lignes × ~4 appels × 4 tentatives ≈ 2 000 requêtes en
 * rafale — sur un quota PARTAGÉ avec le moteur (revue sécurité C28-93). Au-delà de quelques échecs
 * d'affilée, ce n'est plus une ligne qui est en cause mais la plateforme : on rend la main.
 */
export const CORBEILLE_MAX_PANNES = 5;

/**
 * Lignes traitées entre deux écritures Sheet (C28-119).
 *
 * POURQUOI — incident du 2026-09-14, rapporté par Marc au premier vrai clic sur « Tout corbeiller
 * (112) » : « Lot interrompu : Google refuse les appels. 56 dossier(s) n'ont pas été tentés ». Le
 * coupe-circuit avait bien fait son travail ; ce qui l'a déclenché, c'est nous. Le lot écrivait
 * **UNE cellule par dossier**, or l'API Sheets plafonne à **60 écritures/minute PAR UTILISATEUR ET PAR PROJET**.
 * À ~2 dossiers/seconde, on dépassait le plafond autour de la 56ᵉ ligne : exactement là où ça s'est
 * arrêté. Le compte tombe juste : coupure après 5 pannes d'affilée à `i = 56` ⇒ le premier refus est
 * tombé sur la **52ᵉ** écriture, et les réessais de `api()` ont brûlé le reste du seau.
 * ⚠️ Une version antérieure de ce commentaire disait « quota PARTAGÉ avec le moteur ». C'est très
 * probablement FAUX (revue C28-119) : le moteur écrit via `SpreadsheetApp` d'Apps Script — service
 * interne, projet GCP caché — et non par l'API REST Sheets du client OAuth de l'app. Deux seaux
 * indépendants [Probable]. Le seau de l'app suffit à lui seul à expliquer l'incident, et une cause
 * mémorisée que les faits ne soutiennent pas refonde un raisonnement plus tard (§9). Les réessais de `api()` (1,5 s → 3 s → 6 s) ne sauvent pas d'un quota PAR
 * MINUTE qu'on continue de saturer — ils l'entretiennent.
 *
 * Le remède n'est pas d'attendre, c'est d'écrire MOINS : les lignes `vide-candidat` sont posées en
 * bloc par une même passe du moteur, donc contiguës dans l'onglet — `plagesContigues` les regroupe
 * et un PUT couvre toute une plage, même avec des statuts DIFFÉRENTS. 112 écritures deviennent une
 * poignée.
 *
 * Pourquoi 20 et pas « tout à la fin » : entre l'action Drive et l'écriture du statut, le dossier
 * EST déjà à la corbeille alors que la Sheet l'ignore encore. Vider le tampon borne cette fenêtre —
 * au pire 20 lignes à re-constater, jamais 112 (c'est le défaut vécu en C28-93 : « 124 dossiers
 * réellement corbeillés et 124 statuts perdus »). L'ordre des écritures d'état reste celui du
 * projet : l'action d'abord, la trace ensuite.
 */
export const CORBEILLE_LOT_ECRITURE = 20;

/**
 * Taille du PREMIER lot d'écriture — une sentinelle (C28-119).
 *
 * Grouper les écritures repousse mécaniquement le moment où l'on découvre que le canal Sheets ne
 * répond plus : avec un tampon de 20, on aurait corbeillé 20 dossiers SANS pouvoir inscrire un seul
 * statut avant de s'en apercevoir. La première écriture part donc tôt : si Sheets refuse, le
 * coupe-circuit tombe après 5 dossiers, comme avant ce correctif. Le gain de quota est intact —
 * 112 lignes font 7 écritures au lieu de 112.
 */
export const CORBEILLE_PREMIERE_ECRITURE = CORBEILLE_MAX_PANNES;

/**
 * Écritures Sheet autorisées par minute glissante (C28-119, revue flotte).
 *
 * ⚠️ POURQUOI CE RÉGULATEUR EXISTE, ALORS QUE LA MISE EN LOTS SEMBLE SUFFIRE. Elle ne suffit que si
 * les lignes `vide-candidat` sont CONTIGUËS — et c'est une hypothèse que ce code ne contrôle pas.
 * Mesuré en revue sur la vraie fonction : 112 lignes contiguës font 7 PUT, par blocs de 3 elles en
 * font 42, **une ligne sur deux en fait 112 — exactement comme avant le correctif**. Or QUATRE
 * producteurs écrivent dans l'onglet Réorg (`ConsolidationExec.gs` ×2, `Reorg.gs`, `WebApp.gs`), la
 * consolidation découvre les dossiers vides sur des dizaines de ticks budgétés, et
 * `inscrireDossierVideCandidat_` ré-arme une ligne `vide-repris` SUR PLACE, à son ancien rang —
 * un producteur délibéré de lignes isolées.
 *
 * Le régulateur borne LA CAUSE (le nombre d'écritures par minute) au lieu de parier sur la
 * disposition : quelle que soit la forme de la liste, on ne sature plus. La mise en lots reste
 * utile — elle rend l'attente rare — mais elle n'est plus ce sur quoi la correction repose.
 * 50 et non 60 : le reste de l'app écrit aussi (validations, demandes d'analyse).
 */
export const CORBEILLE_ECRITURES_PAR_MIN = 50;

/** Ce qu'un lot de corbeille a VRAIMENT fait — chaque état distinct, jamais additionnés. */
export interface BilanLot {
  corbeilles: number;  // dossier mis à la corbeille Drive (récupérable 30 j)
  classes: number;     // refus CONNU : la ligne quitte la liste avec sa raison
  aReessayer: number;  // refus INCONNU (réseau, quota, session) : la ligne reste candidate
  sheetKo: number;     // action Drive faite, mais la Sheet n'a pas pris le statut
  // ⚠️ Un lot ÉCOURTÉ rendait exactement le même bilan qu'un lot complet (revue C28-93) : sur une
  // session morte à la 40ᵉ ligne, `{corbeilles:40, aReessayer:1}` — et rien, nulle part, ne disait
  // que 83 lignes n'avaient jamais été tentées. « Une passe abandonnée doit se DIRE dans l'état ».
  nonTentees: number;                        // lignes jamais tentées, parce que le lot a été coupé
  interrompu: '' | 'session' | 'pannes';     // '' = le lot est allé au bout
  // ⚠️ LE POURQUOI, pas seulement le QUE (C28-121). « Google refuse les appels (quota ou panne) »
  // ne distingue pas un quota d'un refus de droits, d'une ascendance illisible ou d'une coupure
  // réseau — et le message de l'exception, seul endroit où la différence est écrite, était JETÉ.
  // Résultat vécu : deux diagnostics successifs faits à l'aveugle, dont un FAUX (j'ai conclu au
  // quota Sheets ; Marc a ensuite rapporté « après 4 dossiers il s'arrête sans rien supprimer »,
  // ce qui l'exclut — sous l'hypothèse quota-Sheets, les dossiers PARTENT et seuls les statuts
  // échouent). §9 : « tout verdict indéterminé persiste son POURQUOI ».
  derniereCause: string;                     // message de la DERNIÈRE panne non interprétable
}

/**
 * Applique la corbeille à UN LOT de lignes. Extraite de la vue pour être TESTABLE : c'est ici que
 * vivait le défaut de C28-93 — la boucle était dans un `try` unique, donc la PREMIÈRE exception
 * arrêtait tout, et le premier de la liste était justement un dossier refusé par son nom. 124
 * propositions, zéro action. La revue a reproduit la régression sous CI verte : rien ne la gardait.
 *
 * Invariants que les tests figent :
 *  - un refus n'arrête JAMAIS le lot (il classe SA ligne) ;
 *  - `corbeilles + classes + aReessayer + nonTentees === lignes.length` — `sheetKo` compte À PART,
 *    sinon une écriture Sheet refusée ferait compter deux fois une ligne déjà corbeillée ;
 *  - `stop()` (session morte) coupe NET, et `CORBEILLE_MAX_PANNES` pannes d'affilée aussi : dans les
 *    deux cas le bilan DIT qu'il a été écourté, et combien de lignes n'ont jamais été tentées.
 * @param lignes  {id Drive, numéro de ligne Sheet}
 * @param deps    I/O injectées (corbeille, écriture Sheet, UI) — aucune n'est appelée en test réel
 */
export async function corbeillerLot(
  lignes: { id: string; ligneSheet: number }[],
  deps: {
    corbeiller: (id: string) => Promise<void>;
    // ⚠️ ÉCRITURE PAR PLAGE, jamais par cellule (C28-119) : une cellule par dossier saturait le
    // quota Sheets de 60 écritures/minute par utilisateur, partagé avec le moteur.
    ecrireLot: (debut: number, valeurs: string[]) => Promise<void>;
    surLigne?: (ligneSheet: number, statut: string) => void;
    avancement?: (fait: number, total: number) => void;
    stop?: () => boolean;
    // Horloge et attente INJECTÉES : le régulateur de cadence ne se teste pas en attendant vraiment
    // une minute. Défauts réels en production.
    maintenant?: () => number;
    attendre?: (ms: number) => Promise<void>;
  },
): Promise<BilanLot> {
  const bilan: BilanLot = {
    corbeilles: 0, classes: 0, aReessayer: 0, sheetKo: 0, nonTentees: 0, interrompu: '',
    derniereCause: '',
  };
  let pannesDaffilee = 0;
  // Statuts en attente d'écriture : l'action Drive est DÉJÀ faite pour chacun.
  let tampon: { ligneSheet: number; statut: string }[] = [];
  let premiereEcritureFaite = false;
  const maintenant = deps.maintenant ?? (() => Date.now());
  const attendre = deps.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const horodatages: number[] = []; // instants des PUT émis, fenêtre glissante d'une minute

  /** Attend s'il le faut pour ne jamais dépasser CORBEILLE_ECRITURES_PAR_MIN sur 60 s glissantes. */
  async function cadencer(): Promise<void> {
    const purger = (t: number) => {
      while (horodatages.length && t - horodatages[0] >= 60_000) horodatages.shift();
    };
    purger(maintenant());
    if (horodatages.length >= CORBEILLE_ECRITURES_PAR_MIN) {
      // On attend que la plus ANCIENNE écriture sorte de la fenêtre, plus une marge : c'est le
      // minimum qui libère une place, jamais une pause forfaitaire.
      await attendre(60_000 - (maintenant() - horodatages[0]) + 100);
      purger(maintenant());
    }
    horodatages.push(maintenant());
  }

  /** Écrit le tampon en PLAGES contiguës (un PUT par plage), puis le vide. */
  async function viderTampon(): Promise<void> {
    if (tampon.length === 0) return;
    const parLigne = new Map(tampon.map((x) => [x.ligneSheet, x.statut]));
    const plages = plagesContigues(tampon.map((x) => x.ligneSheet));
    tampon = []; // vidé d'ABORD : une exception ne doit jamais faire ré-écrire deux fois la plage
    for (const { debut, fin } of plages) {
      const valeurs: string[] = [];
      for (let n = debut; n <= fin; n++) valeurs.push(parLigne.get(n) as string);
      try {
        await cadencer();
        await deps.ecrireLot(debut, valeurs);
        // L'écran ne suit QUE ce que la Sheet a pris : sinon Marc voit « corbeillé » sur une ligne
        // que le prochain rechargement lui rendra `vide-candidat`, sans qu'il comprenne pourquoi.
        for (let n = debut; n <= fin; n++) {
          try { deps.surLigne?.(n, parLigne.get(n) as string); } catch { /* affichage seulement */ }
        }
        pannesDaffilee = 0; // une plage écrite prouve que le canal Sheets répond
      } catch (eSheet) {
        bilan.derniereCause = String(eSheet); // même exigence côté Sheets (C28-121)
        // Les dossiers SONT traités ; seule la Sheet les ignore. Compté à part (revue C28-93).
        // ⚠️ Le coupe-circuit compte les LIGNES, pas les requêtes : ce qu'il protège, c'est le
        // nombre de dossiers corbeillés dont on n'a PAS pu inscrire l'état. Compter « 1 par plage
        // refusée » laisserait continuer à l'aveugle — 100 dossiers pour 5 requêtes.
        const n = fin - debut + 1;
        bilan.sheetKo += n;
        pannesDaffilee += n;
      }
    }
  }

  for (let i = 0; i < lignes.length; i++) {
    if (deps.stop?.()) bilan.interrompu = 'session';
    else if (pannesDaffilee >= CORBEILLE_MAX_PANNES) bilan.interrompu = 'pannes';
    if (bilan.interrompu) { bilan.nonTentees = lignes.length - i; break; }
    const l = lignes[i];
    let statut = 'corbeillé';
    try {
      await deps.corbeiller(l.id);
      bilan.corbeilles++;
      // ⚠️ Le canal Drive vient de RÉPONDRE : la rafale est cassée (le coupe-circuit vise la
      // RAFALE, jamais le cumul). Depuis que les statuts partent par plages, attendre l'écriture
      // pour remettre à zéro faisait tomber le lot sur des pannes ALTERNÉES — une ligne sur deux en
      // échec réseau atteignait 5 avant la première écriture, alors que Google répondait très bien.
      // Le canal Sheets, lui, a son propre signal : un tampon refusé ajoute ses LIGNES d'un coup,
      // ce qui dépasse le seuil immédiatement.
      pannesDaffilee = 0;
    } catch (e) {
      const verdict = statutRefusCorbeille(String(e));
      if (!verdict) {
        bilan.aReessayer++;
        pannesDaffilee++;             // c'est la PLATEFORME qui flanche, pas la ligne
        bilan.derniereCause = String(e); // …et on GARDE de quoi le dire (C28-121)
        try { deps.avancement?.(i + 1, lignes.length); } catch { /* affichage seulement */ }
        continue;
      }
      statut = verdict;
      bilan.classes++;                // un VERDICT prouve que le canal Drive répond
    }
    tampon.push({ ligneSheet: l.ligneSheet, statut });
    // Première écriture SENTINELLE (petite) puis lots pleins : on prouve que Sheets répond avant
    // d'engager 20 dossiers sur sa parole.
    const seuil = premiereEcritureFaite ? CORBEILLE_LOT_ECRITURE : CORBEILLE_PREMIERE_ECRITURE;
    if (tampon.length >= seuil) { premiereEcritureFaite = true; await viderTampon(); }
    try { deps.avancement?.(i + 1, lignes.length); } catch { /* affichage seulement */ }
  }
  // ⚠️ VIDÉ MÊME SUR INTERRUPTION : les dossiers déjà corbeillés avant la coupure doivent laisser
  // leur trace, sinon le lot suivant les re-présente et Marc re-clique sur du travail déjà fait.
  // (Une version antérieure ajoutait « et la re-tentative tombe sur un 404 » : FAUX, vérifié en
  // revue — l'API sert les fichiers corbeillés, le re-clic réussit en silence. Le travail refait
  // suffit comme raison ; une justification fausse dans un commentaire durable se recopie.)
  await viderTampon();
  return bilan;
}

/**
 * Compte STRICT des enfants directs : la requête ne filtre PAS `trashed` — un dossier dont il
 * ne reste que des éléments corbeillés n'est PAS vide (les corbeiller avec serait une décision
 * que personne n'a validée).
 */
async function compterEnfantsStrict(folderId: string): Promise<number> {
  const sain = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${sain}' in parents`,
    fields: 'files(id)',
    pageSize: '1',
  });
  const r = await api<{ files?: { id: string }[] }>(`${DRIVE}?${params.toString()}`);
  return (r.files ?? []).length;
}

/**
 * Met à la corbeille un dossier VIDE (ADR-0014) après re-vérification complète au clic.
 * @throws si le verdict n'est pas vide (l'appelant affiche les violations).
 */
export async function corbeillerDossierVide(folderId: string, racinesProtegees?: string[]): Promise<void> {
  if (!folderId || !folderId.trim()) throw new Error('Corbeille refusée (ADR-0014) : id manquant');
  const [meta, nbEnfants, ascendance] = await Promise.all([
    lireFichier(folderId),
    compterEnfantsStrict(folderId),
    remonterAscendance(folderId),
  ]);
  const violations = verdictCorbeille({
    id: folderId,
    nom: meta.name,
    mimeType: meta.mimeType ?? '',
    nbEnfants,
    ascendance,
    racinesProtegees,
  });
  if (violations.length > 0) {
    throw new Error(`Corbeille refusée (ADR-0014) : ${violations.join(', ')}`);
  }
  // Seul le LISTAGE du dossier parent devient périmé : on ne jette QUE les caches Drive. La purge
  // totale jetait aussi le mémo d'ascendance, donc chaque ligne d'un lot de 124 re-parcourait toute
  // sa chaîne depuis zéro alors que ces dossiers partagent une poignée de racines (revue C28-93).
  viderCachesDrive();
  await api(`${DRIVE}/${folderId}?fields=id`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }), // corbeille Drive — récupérable 30 j, jamais définitif
  });
}
