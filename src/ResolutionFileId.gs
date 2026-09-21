/**
 * ResolutionFileId.gs — C49-16, étape A : RENDRE VISIBLES LES 734 DOCUMENTS QUE LE CANAL NE
 * SAIT PAS DÉSIGNER.
 *
 * ⚠️ LE DÉFAUT, MESURÉ LE 17/09/2026. `fileIdDeCleIndex_` déduit le fileId de la CLÉ d'Index, et
 * n'accepte que quatre préfixes (`drive`, `tri33p`, `migre`, `reanalyse`). Or la clé d'une pièce
 * jointe Gmail est `<messageId>|<rang>|<nom>|<taille>` (`cleAttachement_`) : elle n'en porte
 * aucun — alors que le document EST rangé dans le Drive et porte un vrai fileId. Résultat :
 * **734 lignes CLASSÉES** invisibles au comptage du périmètre (C49-4), au rattrapage des pièces
 * (C49-5) et au canal Mémoire (`faitInventaireMemoire_`, `pieceMemoire_`) — c'est-à-dire
 * l'intake PRINCIPAL du moteur, hors de tout. Et 734 est un PLANCHER : c'est le compte des
 * lignes `classé` sans fileId, pas celui de ce que Gmail a fait entrer.
 *
 * ⚠️ DEUX MOITIÉS, ET IL FAUT LES DEUX. (a) L'AVENIR : `Pipeline.gs` pose désormais
 * `decision.fileId` (le placement vient de le rendre) et `indexAjouter_` l'écrit en 9ᵉ colonne.
 * (b) L'EXISTANT : ce module. Corriger le code qui écrit ne répare jamais ce qui est déjà écrit
 * — c'est la leçon du « [object Object] » de l'audit, payée le 17/09.
 *
 * ⚠️ POURQUOI UN PRÉDICAT STRICT, ET PAS « LE PREMIER QUI RESSEMBLE ». Associer un mauvais
 * fileId à une ligne d'Index enverrait un document à la Mémoire SOUS L'IDENTITÉ D'UN AUTRE — un
 * verdict POSITIF, donc définitif de fait (leçon §9, C28-49). Dans le doute on REFUSE : un refus
 * coûte un re-examen, un faux positif coûte un papier attribué à quelqu'un d'autre.
 *
 * ⚠️ UN REFUS EST MÉMORISÉ, MAIS RÉVISABLE. Sans mémoire, les lignes refusées se re-chercheraient
 * à chaque passe et la campagne ne finirait jamais. Le refus s'écrit donc DANS la colonne, sous
 * la forme `!<motif>|<tag>` — jamais un id plausible, donc la lecture l'ignore et retombe sur la
 * clé. Le TAG le rend révisable : le bumper re-tente tout (leçon « verdict négatif keyé sous
 * version, jamais figé à vie »).
 *
 * ⚠️ AUCUN BUDGET QUOTIDIEN, ET C'EST ARGUMENTÉ. C'est une passe ONE-SHOT gatée par tag, pas une
 * campagne : ~734 recherches Drive, soit quelques minutes de runtime UNE FOIS, étalées sur
 * plusieurs ticks par le garde-temps. Lui prélever une minute par jour à une campagne vivante
 * (l'enveloppe est verrouillée à 63 min/j, `orchestration.test.js`) coûterait tous les jours ce
 * qui ne se paie qu'une fois. Même arbitrage, écrit et tenu, que `PERIMETRE_PIECE_TAG`.
 * ⚠️ Elle ne dépense AUCUN dollar : zéro appel LLM. Elle n'est donc pas gatée sur le frein des
 * campagnes — l'y soumettre ferait attendre une réparation à cause d'un budget qu'elle ne
 * consomme pas.
 */

/** Marqueur de refus écrit dans la colonne : jamais un id plausible (leçon : `!` le garantit). */
var PREFIXE_REFUS_FILEID = '!';

/** Plafond de lignes traitées par run — le garde-temps borne le reste. */
var RESOLUTION_FILEID_MAX_PAR_RUN = 40;

/* ---------- PUR ---------- */

/**
 * PURE. Cette cellule de la 9ᵉ colonne a-t-elle DÉJÀ été tranchée sous ce tag ?
 *
 * Trois états, et ils ne se confondent pas : vide (jamais tentée), un id (résolue), un refus
 * `!<motif>|<tag>` (tentée et refusée). Un refus sous un ANCIEN tag compte comme « jamais
 * tentée » — c'est ce qui rend le verdict négatif révisable par un bump.
 *
 * @param {*} cellule  contenu de la colonne FileId
 * @param {string} tag  tag courant de la campagne
 * @return {boolean}
 */
function dejaTrancheFileId_(cellule, tag) {
  var v = String(cellule == null ? '' : cellule).trim();
  if (!v) return false;
  if (estFileIdPlausible_(v)) return true;
  if (v.charAt(0) !== PREFIXE_REFUS_FILEID) return false; // cellule abîmée : on re-tente
  var parts = v.split('|');
  return parts[parts.length - 1] === String(tag || '');
}

/**
 * PURE. Sérialise un refus. Le motif d'abord (lisible), le tag en QUEUE (comparé par
 * `dejaTrancheFileId_`, et un motif qui contiendrait une barre ne le casserait pas).
 */
function refusFileId_(motif, tag) {
  return PREFIXE_REFUS_FILEID + String(motif || 'refus') + '|' + String(tag || '');
}

/**
 * PURE. Les lignes d'Index qui ont besoin d'une résolution, à partir d'un curseur.
 *
 * ⚠️ Le CURSEUR, et pas une re-lecture depuis le début à chaque passe : l'Index porte 26 550
 * lignes et la sélection doit reprendre où elle s'est arrêtée, sinon les dernières lignes ne
 * sortent jamais (leçon « prouver que le plus ANCIEN sort un jour »). Il repart de zéro quand
 * la fin est atteinte, et c'est la passe qui décide alors qu'elle est terminée.
 *
 * ⚠️ Seules les lignes CLASSÉES entrent. Une ligne de tri Gmail, une intention, un plan de
 * consolidation ne désignent aucun document rangé : leur chercher un fileId serait chercher ce
 * qui n'existe pas, et chaque recherche coûte un appel Drive.
 *
 * @param {Array<Array>} lignes  lignes d'Index (Clé … FileId)
 * @param {string} tag           tag courant
 * @param {number} depuis        index de départ dans `lignes` (0 = début)
 * @param {number} max           plafond de la sélection rendue
 * @return {{choisies: Array<Object>, restants: number, curseur: number, fini: boolean}}
 */
function selectionnerAResoudre_(lignes, tag, depuis, max) {
  var res = { choisies: [], restants: 0, curseur: 0, fini: true };
  var l = lignes || [];
  var debut = depuis > 0 && depuis < l.length ? depuis : 0;
  res.curseur = debut;

  for (var i = debut; i < l.length; i++) {
    var statut = String(l[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;
    // Déjà identifiable par sa CLÉ : rien à résoudre, et c'est le cas des 4 240 lignes que le
    // canal voyait déjà. On ne paie une recherche Drive que pour ce qui manque.
    if (fileIdDeCleIndex_(String(l[i][0] || ''))) continue;
    if (dejaTrancheFileId_(l[i][8], tag)) continue;

    res.restants++;
    if (res.choisies.length < max) {
      res.choisies.push({
        rang: i,                                   // position dans `lignes` (0-based)
        cle: String(l[i][0] || ''),
        nom: String(l[i][2] || ''),
        chemin: String(l[i][4] || ''),
        empreinte: String(l[i][6] || '')
      });
      res.curseur = i + 1;
    } else {
      res.fini = false;                            // il reste du travail au-delà de cette page
    }
  }
  if (res.fini) res.curseur = 0;                   // fin atteinte : la prochaine passe repart du début
  return res;
}

/**
 * PURE. Lequel de ces fichiers EST la ligne d'Index ? — ou aucun.
 *
 * L'ordre des preuves n'est pas indifférent : l'EMPREINTE avant le CHEMIN. Une empreinte est un
 * hash du contenu, elle prouve l'identité du document ; un chemin ne prouve qu'un voisinage, et
 * deux fichiers homonymes peuvent partager un dossier. Quand l'empreinte est connue, elle
 * TRANCHE — et si aucun candidat ne la porte, on refuse au lieu de se rabattre sur le chemin :
 * un fichier qui ne porte pas l'empreinte attendue n'est pas celui-là, quel que soit son nom.
 *
 * @param {Array<{id:string, empreinte:string, chemin:string}>} candidats
 * @param {string} empreinteAttendue  '' si la ligne n'en porte pas
 * @param {string} cheminAttendu
 * @return {{fileId: string, motif: string}}
 */
function choisirResolutionFileId_(candidats, empreinteAttendue, cheminAttendu) {
  var c = candidats || [];
  if (!c.length) return { fileId: '', motif: 'introuvable' };

  var emp = String(empreinteAttendue || '').trim();
  if (emp) {
    var parEmpreinte = [];
    for (var i = 0; i < c.length; i++) {
      if (String(c[i].empreinte || '').trim() === emp) parEmpreinte.push(c[i]);
    }
    if (!parEmpreinte.length) return { fileId: '', motif: 'empreinte-differente' };
    if (parEmpreinte.length === 1) return { fileId: String(parEmpreinte[0].id), motif: 'empreinte' };
    // Plusieurs copies au contenu IDENTIQUE : le chemin départage, sinon on refuse. Choisir au
    // hasard désignerait peut-être l'exemplaire écarté dans `_Doublons` plutôt que le rangé.
    c = parEmpreinte;
  }

  var chemin = String(cheminAttendu || '').trim();
  if (!chemin) return { fileId: '', motif: 'ambigu' };
  var parChemin = [];
  for (var j = 0; j < c.length; j++) {
    if (String(c[j].chemin || '').trim() === chemin) parChemin.push(c[j]);
  }
  if (parChemin.length === 1) {
    return { fileId: String(parChemin[0].id), motif: emp ? 'empreinte-chemin' : 'chemin' };
  }
  return { fileId: '', motif: parChemin.length ? 'ambigu' : 'hors-chemin' };
}

/**
 * PURE. La phrase de Santé — une seule écriture, partagée par tous ses appelants.
 *
 * ⚠️ Les motifs de REFUS sont nommés un par un, jamais fondus en « N refusés ». « introuvable »
 * (le fichier n'est plus là), « ambigu » (deux homonymes) et « empreinte-differente » (ce n'est
 * pas ce document) appellent trois gestes différents, et les confondre les rend tous invisibles.
 */
function phraseResolutionFileId_(etat) {
  var e = etat || {};
  // ⚠️ SANS son étiquette, comme `phrasePerimetrePiece_` et ses voisines : c'est `majSante_` qui
  // pose le libellé. Une phrase qui porte son propre titre s'affiche deux fois le jour où on la
  // range sous un autre, et le décalage ne lève rien.
  if (!e.ts) return 'jamais passée';
  var pourquoi = detailMotifsResolution_(e.motifs);
  if (e.fini && !e.restants) {
    return '✅ terminée — ' + (e.resolus || 0) + ' retrouvés, '
      + (e.refuses || 0) + ' sans preuve suffisante' + pourquoi;
  }
  // ⚠️ Le MOTIF de fin est toujours dit, même quand la passe a bien travaillé : « rien à faire »,
  // « budget » et « panne » laissent le même silence si on ne les nomme pas (leçon C28-135).
  return (e.resolus || 0) + ' retrouvés · ' + (e.refuses || 0) + ' sans preuve' + pourquoi
    + ' · ' + (e.restants || 0) + ' à examiner — ' + (e.fin || '?');
}

/**
 * PURE. Le détail des refus de la DERNIÈRE passe, ou '' s'il n'y en a pas.
 *
 * ⚠️ « dernière passe » et pas « depuis le début », et la phrase le dit : le compteur est réécrit
 * à chaque run. Annoncer un cumul qu'on ne tient pas serait pire qu'un détail absent.
 */
function detailMotifsResolution_(motifs) {
  var m = motifs || {};
  var noms = [];
  for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k) && m[k]) noms.push(k);
  if (!noms.length) return '';
  noms.sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); });
  var bouts = [];
  for (var i = 0; i < noms.length; i++) bouts.push(m[noms[i]] + ' ' + noms[i]);
  return ' (dernière passe : ' + bouts.join(', ') + ')';
}

/**
 * La ligne de Santé, lue sans rien exécuter. Patron de `texteSantePerimetrePiece_`.
 *
 * ⚠️ L'état ILLISIBLE se DIT : rendre « jamais passée » sur une Property qu'on n'a pas su lire
 * ferait passer une panne pour un état normal, et c'est la seule ligne qui dise si les 734
 * pièces jointes Gmail sont redevenues désignables.
 */
function texteSanteResolutionFileId_() {
  try {
    return phraseResolutionFileId_(etatResolutionFileId_(PropertiesService.getScriptProperties()));
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * PURE. Le dernier segment d'un chemin d'Index (`02 · Finances/2025` → `2025`).
 *
 * ⚠️ C'est le nom du DOSSIER qui contient le document, donc ce qu'on peut comparer au parent
 * d'un candidat sans payer la remontée de toute la chaîne. Un chemin vide rend '' — et c'est
 * `choisirResolutionFileId_` qui en tire un refus, jamais une acceptation par défaut.
 */
function dernierSegmentChemin_(chemin) {
  var parts = String(chemin == null ? '' : chemin).split('/');
  for (var i = parts.length - 1; i >= 0; i--) {
    var seg = parts[i].trim();
    if (seg) return seg;
  }
  return '';
}

/**
 * PURE. Le `q` d'une recherche `files.list` par nom exact.
 *
 * ⚠️ L'APOSTROPHE. Le `q` de l'API Drive délimite ses chaînes par des apostrophes simples : un
 * nom français en contient sans arrêt (« L'Artemis », « Contrat d'assurance »), et une
 * apostrophe non échappée ne rend pas une erreur lisible — elle change la REQUÊTE. L'encodage
 * d'URL ne protège de rien ici : il porte sur le transport, pas sur la syntaxe du `q`.
 * L'antislash doit être échappé AVANT l'apostrophe, sinon on échappe l'échappement.
 */
function qNomDrive_(nom) {
  var n = String(nom == null ? '' : nom).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return "name = '" + n + "' and trashed = false";
}

/* ---------- I/O ---------- */

/** Le nom d'un dossier Drive, mémoïsé pour le run — 734 lignes se partagent peu de dossiers. */
function nomDossierMemo_(id, memo) {
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(memo, id)) return memo[id];
  var nom = '';
  try { nom = DriveApp.getFolderById(id).getName(); } catch (e) { nom = ''; }
  memo[id] = nom;
  return nom;
}

/**
 * Les candidats Drive pour un nom de fichier, avec leur empreinte et le nom de leur dossier.
 *
 * ⚠️ Une page suffit et c'est délibéré : au-delà du plafond, le nom n'est plus discriminant et
 * `choisirResolutionFileId_` refusera de toute façon. Paginer paierait des appels pour aboutir
 * au même refus.
 */
function candidatsPourNom_(nom, memoDossiers) {
  var url = urlListeDrive_(qNomDrive_(nom), 'files(id,name,md5Checksum,parents)', '', 25);
  var page = pageListeDrive_(url);
  var out = [];
  for (var i = 0; i < page.files.length; i++) {
    var f = page.files[i];
    var parents = f.parents || [];
    out.push({
      id: String(f.id || ''),
      empreinte: String(f.md5Checksum || ''),
      chemin: nomDossierMemo_(parents.length ? String(parents[0]) : '', memoDossiers)
    });
  }
  return out;
}

/**
 * PURE. Les motifs de refus, compactés (`introuvable:3,ambigu:1`).
 *
 * ⚠️ Les séparateurs de l'état (`|`) et du couple (`:`, `,`) sont RETIRÉS des noms plutôt
 * qu'échappés : les motifs sont un vocabulaire FERMÉ du code, pas du texte libre, donc un nom
 * qui en contiendrait serait un bug à corriger — pas une entrée à faire survivre.
 */
function encoderMotifsResolution_(motifs) {
  var m = motifs || {};
  var bouts = [];
  for (var k in m) {
    if (!Object.prototype.hasOwnProperty.call(m, k) || !m[k]) continue;
    bouts.push(String(k).replace(/[|:,]/g, '') + ':' + Number(m[k]));
  }
  return bouts.join(',');
}

/** PURE. L'inverse. Un champ absent rend `{}` — « passe d'avant C49-16 », jamais « zéro refus ». */
function decoderMotifsResolution_(brut) {
  var out = {};
  var bouts = String(brut == null ? '' : brut).split(',');
  for (var i = 0; i < bouts.length; i++) {
    if (!bouts[i]) continue;
    var kv = bouts[i].split(':');
    var n = Number(kv[1]);
    if (kv[0] && n > 0) out[kv[0]] = n;
  }
  return out;
}

/**
 * L'état persisté de la passe
 * (`<ISO>|<fin>|<resolus>/<refuses>|<restants>|<curseur>|<motifs>`).
 */
function noterFinResolutionFileId_(props, res) {
  try {
    props.setProperty('DriveAI_RESOLUTION_FILEID_FIN', [
      new Date().toISOString(), res.fin,
      (res.resolus || 0) + '/' + (res.refuses || 0),
      String(res.restants || 0), String(res.curseur || 0),
      // ⚠️ 6ᵉ champ, EN QUEUE : un champ ajouté à un état déjà persisté ne s'insère jamais au
      // milieu — les lecteurs d'avant liraient le nouveau à la place d'un ancien, sans erreur
      // (leçon C28-44). Son absence vaut « passe d'avant C49-16 », pas « aucun refus ».
      encoderMotifsResolution_(res.motifs)
    ].join('|'));
  } catch (e) { /* l'état est une commodité : il ne doit jamais faire échouer la passe */ }
  return res;
}

/**
 * PURE sur props. L'état lu, pour la Santé — sans rien exécuter.
 */
function etatResolutionFileId_(props) {
  var brut = '';
  try { brut = String(props.getProperty('DriveAI_RESOLUTION_FILEID_FIN') || ''); } catch (e) { brut = ''; }
  if (!brut) return { ts: '' };
  var p = brut.split('|');
  var compteurs = String(p[2] || '0/0').split('/');
  return {
    ts: p[0] || '', fin: p[1] || '?',
    resolus: Number(compteurs[0]) || 0, refuses: Number(compteurs[1]) || 0,
    restants: Number(p[3]) || 0, curseur: Number(p[4]) || 0,
    motifs: decoderMotifsResolution_(p[5]),
    fini: String(p[1] || '') === 'termine'
  };
}

/**
 * PURE. Cette passe doit-elle tourner ?
 *
 * ⚠️ Elle consulte le TAG **et** l'état, jamais l'un des deux seul. Une gate qui ne lit que le
 * compteur s'éteint pour toujours dès qu'il tombe à zéro et ne rouvre jamais sur un bump — c'est
 * l'interblocage payé deux fois le 17/09 (`UNE-GATE-D-EXTINCTION-QUI-NE-LIT-PAS-LE-TAG`).
 */
function resolutionFileIdDoitTourner_(etat, tagPersiste, tagCourant) {
  if (String(tagPersiste || '') !== String(tagCourant || '')) return true; // bump : on refait tout
  if (!etat || !etat.ts) return true;                                      // jamais passée
  return !etat.fini;                                                       // terminée ⇒ silence
}

/**
 * L'étape du tick. ONE-SHOT par tag, bornée par le garde-temps, reprenable par curseur.
 *
 * @param {Function} garde  rend vrai quand il faut rendre la main
 * @param {Object} [opts]   { manuel: true } pour une exécution depuis l'éditeur
 * @return {Object} le bilan de la passe
 */
function etapeResolutionFileId_(garde, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var res = { resolus: 0, refuses: 0, restants: 0, curseur: 0, fin: 'vide', motifs: {} };

  var tagCourant = CONFIG.RESOLUTION_FILEID_TAG;
  if (!tagCourant) { res.fin = 'desactivee'; return noterFinResolutionFileId_(props, res); }

  var etat = etatResolutionFileId_(props);
  var tagPersiste = null;
  try { tagPersiste = props.getProperty('DriveAI_RESOLUTION_FILEID_TAG'); } catch (e) { tagPersiste = null; }
  var bump = String(tagPersiste || '') !== String(tagCourant);
  if (bump) {
    // Le tag se pose AVANT tout `return` possible : posé après, une sortie précoce le laisserait
    // absent et la passe repartirait de zéro à chaque tick (leçon `UNE-SORTIE-PRÉCOCE`).
    try { props.setProperty('DriveAI_RESOLUTION_FILEID_TAG', tagCourant); } catch (e) { /* noop */ }
    etat = { ts: '', curseur: 0 };
  }

  var f = feuille_('Index');
  if (!f || f.getLastRow() < 2) { res.fin = 'index-vide'; return noterFinResolutionFileId_(props, res); }
  var lignes = f.getRange(2, 1, f.getLastRow() - 1, 9).getValues();

  var choix = selectionnerAResoudre_(lignes, tagCourant, bump ? 0 : (etat.curseur || 0),
    RESOLUTION_FILEID_MAX_PAR_RUN);
  res.restants = choix.restants;
  res.curseur = choix.curseur;
  if (!choix.choisies.length) {
    res.fin = choix.fini ? 'termine' : 'rien';
    return noterFinResolutionFileId_(props, res);
  }

  var memoDossiers = {};
  var ecritures = [];
  for (var i = 0; i < choix.choisies.length; i++) {
    // ⚠️ Le garde-temps est évalué À CHAQUE ITEM, dans la boucle qui fait l'I/O — jamais dans une
    // sélection préalable, qui s'exécute en microsecondes et ne peut donc pas couper (leçon §9).
    if (!opts.manuel && garde && garde()) { res.fin = 'budget'; break; }
    var ligne = choix.choisies[i];
    var verdict;
    try {
      verdict = choisirResolutionFileId_(
        candidatsPourNom_(ligne.nom, memoDossiers), ligne.empreinte, dernierSegmentChemin_(ligne.chemin));
    } catch (e) {
      // Une PANNE n'est pas un VERDICT : on ne marque rien, la ligne sera re-tentée. Marquer ici
      // figerait un refus sur une coupure réseau (leçon §9, C28-129).
      res.fin = 'panne';
      journalErreur_('ResolutionFileId', 'Recherche Drive impossible : ' + e);
      break;
    }
    if (verdict.fileId) { res.resolus++; ecritures.push({ rang: ligne.rang, valeur: verdict.fileId }); }
    else {
      res.refuses++;
      // ⚠️ Compté PAR MOTIF : « introuvable » (le fichier n'est plus là), « ambigu » (deux
      // homonymes) et « empreinte-differente » (ce n'est pas ce document) appellent trois gestes
      // différents. Un total les rend tous les trois invisibles.
      res.motifs[verdict.motif] = (res.motifs[verdict.motif] || 0) + 1;
      ecritures.push({ rang: ligne.rang, valeur: refusFileId_(verdict.motif, tagCourant) });
    }
    res.curseur = ligne.rang + 1;
  }

  // ⚠️ L'écriture se fait APRÈS la boucle et cellule par cellule : les rangs ne sont pas
  // contigus (seules les lignes sans fileId sont choisies), donc un `setValues` en bloc
  // écraserait les lignes intercalaires — celles qui portent déjà un identifiant.
  for (var k = 0; k < ecritures.length; k++) {
    try { f.getRange(ecritures[k].rang + 2, 9).setValue(ecritures[k].valeur); }
    catch (e) { journalErreur_('ResolutionFileId', 'Écriture ligne ' + (ecritures[k].rang + 2) + ' : ' + e); }
  }
  if (res.fin === 'vide') res.fin = choix.fini && res.curseur >= lignes.length ? 'termine' : 'page';
  return noterFinResolutionFileId_(props, res);
}

/**
 * Lancement MANUEL depuis l'éditeur (`ResolutionFileId.gs` → `resoudreIdentifiantsMaintenant`).
 * Hors quota des déclencheurs : le budget du tick ne s'applique pas.
 */
function resoudreIdentifiantsMaintenant() {
  var res = etapeResolutionFileId_(function () { return false; }, { manuel: true });
  // ⚠️ La MÊME phrase que la Santé, et pas une seconde écrite à la main : deux formulations de
  // la même passe divergent au premier champ ajouté, et c'est celle qu'on lit le moins qui ment.
  var ligne = 'Résolution des identifiants (manuel) : '
    + phraseResolutionFileId_(etatResolutionFileId_(PropertiesService.getScriptProperties()));
  Logger.log(ligne);
  journalInfo_('ResolutionFileId', ligne);
  return ligne;
}
