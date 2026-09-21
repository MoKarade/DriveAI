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

/**
 * Plafond d'homonymes examinés. On DEMANDE un de plus à Drive : une page PLEINE ne veut pas dire
 * « il y en a exactement N », elle veut dire « je n'ai pas tout vu ».
 *
 * ⚠️ C'EST UN CORRECTIF DE REVUE, et le commentaire qu'il remplace affirmait le contraire : il
 * disait qu'au-delà du plafond « le nom n'est plus discriminant, donc le choix refusera de toute
 * façon ». FAUX, et dans le sens dangereux — le refus vient d'avoir DEUX candidats, et la
 * troncature en RETIRE. Deux homonymes dans le même dossier (refus sûr) deviennent un seul
 * candidat si le second tombe au-delà de la page : acceptation. Une page pleine REFUSE.
 */
var RESOLUTION_FILEID_MAX_CANDIDATS = 25;

/** Plafond de chemins explorés pour un candidat multi-parents (anti-explosion combinatoire). */
var RESOLUTION_FILEID_MAX_CHEMINS = 8;

/** Le dossier où les doublons sont ÉCARTÉS (jamais supprimés, §1) — cf. `Doublons.gs`. */
var SEGMENT_DOUBLONS = '_Doublons';

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
  var res = { choisies: [], restants: 0, curseur: 0, debut: 0, fini: true };
  var l = lignes || [];
  var debut = depuis > 0 && depuis < l.length ? depuis : 0;
  res.curseur = debut;
  // ⚠️ `debut` est EXPOSÉ, et ce n'est pas cosmétique : `curseur` vaut « après la dernière ligne
  // CHOISIE », donc le curseur d'une page entièrement traitée. L'initialiser avec lui avant la
  // boucle faisait sauter 40 lignes jamais examinées dès que la passe coupait sur son PREMIER
  // item (budget basculé pendant la lecture de l'Index, throttle Drive sur la 1ʳᵉ recherche).
  // Mesuré en revue : 60 lignes résolues sur 100, 40 vides, et la Santé annonçait « termine ».
  res.debut = debut;

  for (var i = debut; i < l.length; i++) {
    var statut = String(l[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;
    // Déjà identifiable par sa CLÉ : rien à résoudre, et c'est le cas des 4 240 lignes que le
    // canal voyait déjà. On ne paie une recherche Drive que pour ce qui manque.
    if (fileIdDeCleIndex_(String(l[i][0] || ''))) continue;
    if (dejaTrancheFileId_(l[i][8], tag)) continue;
    // ⚠️ Sans NOM, la recherche Drive est `name = ''` : elle ne peut rien rendre, et elle coûte
    // un appel. On ne la paie pas — et la ligne n'est pas comptée dans les restants, sinon le
    // compteur ne tomberait jamais à zéro et la passe ne se terminerait jamais.
    if (!String(l[i][2] || '').trim()) continue;

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
 * ⚠️ UNE PAGE PLEINE REFUSE. La troncature RETIRE des candidats, donc elle transforme un refus
 * sûr (« deux homonymes ») en acceptation (« un seul »). C'est le sens dangereux, et le
 * commentaire d'origine affirmait l'inverse.
 *
 * ⚠️ UN CANDIDAT DONT LA CHAÎNE DE DOSSIERS N'A PAS PU ÊTRE LUE est une PANNE, pas un verdict :
 * il porte `illisible`, et on rend la main sans rien marquer. Sinon un blip Drive sur un dossier
 * ferait écrire « hors-chemin » — un refus figé jusqu'au prochain bump.
 *
 * @param {Array<{id:string, empreinte:string, chemins:Array<string>, illisible:boolean}>} candidats
 * @param {string} empreinteAttendue  '' si la ligne n'en porte pas
 * @param {string} cheminAttendu      le chemin d'Index ENTIER
 * @param {boolean} tropNombreux      la page de recherche était pleine
 * @return {{fileId: string, motif: string, panne: (boolean|undefined)}}
 */
/**
 * PURE. Le seul endroit qui rend un verdict POSITIF — et il re-vérifie l'identifiant.
 *
 * ⚠️ `String(undefined)` vaut `'undefined'` et `String(null)` vaut `'null'` : deux chaînes
 * TRUTHY, qui seraient comptées « retrouvées » et écrites dans la colonne. Le module refuse
 * dans le doute partout ailleurs ; un candidat malformé ne doit pas être l'exception.
 */
function accepterCandidat_(candidat, motif) {
  var id = String((candidat && candidat.id) || '');
  if (!estFileIdPlausible_(id)) return { fileId: '', motif: 'id-illisible' };
  return { fileId: id, motif: motif };
}

function choisirResolutionFileId_(candidats, empreinteAttendue, cheminAttendu, tropNombreux) {
  if (tropNombreux) return { fileId: '', motif: 'trop-d-homonymes' };
  var c = candidats || [];
  if (!c.length) return { fileId: '', motif: 'introuvable' };

  var chemin = String(cheminAttendu || '').trim();
  var emp = String(empreinteAttendue || '').trim();
  if (emp) {
    var parEmpreinte = [];
    for (var i = 0; i < c.length; i++) {
      if (String(c[i].empreinte || '').trim() === emp) parEmpreinte.push(c[i]);
    }
    if (!parEmpreinte.length) {
      // ⚠️ DEUX CAUSES, DEUX GESTES. Si AUCUN candidat ne porte d'empreinte, ce n'est pas « ce
      // n'est pas ce document » : c'est « ce type de fichier n'en a pas » (Google natif,
      // raccourci). Les confondre envoie chercher au mauvais endroit.
      var aucuneEmpreinte = true;
      for (var z = 0; z < c.length; z++) {
        if (String(c[z].empreinte || '').trim()) { aucuneEmpreinte = false; break; }
      }
      return { fileId: '', motif: aucuneEmpreinte ? 'candidats-sans-empreinte' : 'empreinte-differente' };
    }
    if (parEmpreinte.length === 1) {
      // ⚠️ Le contenu est PROUVÉ, le LIEU ne l'est pas. Si le seul exemplaire qui porte
      // l'empreinte est celui qu'on a ÉCARTÉ dans `_Doublons`, l'accepter ferait pointer la
      // Mémoire sur le rebut, avec le chemin de l'Index qui dit autre chose (revue sécurité).
      if (estExemplaireEcarte_(parEmpreinte[0], chemin)) {
        return { fileId: '', motif: 'exemplaire-ecarte' };
      }
      return accepterCandidat_(parEmpreinte[0], 'empreinte');
    }
    // Plusieurs copies au contenu IDENTIQUE : le chemin départage, sinon on refuse. Choisir au
    // hasard désignerait peut-être l'exemplaire écarté dans `_Doublons` plutôt que le rangé.
    c = parEmpreinte;
  }

  if (!chemin) return { fileId: '', motif: 'ambigu' };
  // Une chaîne de dossiers illisible rend le candidat INJUGEABLE : on ne peut ni l'apparier ni
  // l'écarter, donc on ne tranche rien du tout sur cette ligne.
  for (var k = 0; k < c.length; k++) {
    if (c[k] && c[k].illisible) return { fileId: '', motif: 'chemin-illisible', panne: true };
  }
  var parChemin = [];
  for (var j = 0; j < c.length; j++) {
    if (((c[j].chemins) || []).indexOf(chemin) >= 0) parChemin.push(c[j]);
  }
  if (parChemin.length === 1) {
    return accepterCandidat_(parChemin[0], emp ? 'empreinte-chemin' : 'chemin');
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
function phraseResolutionFileId_(etat, panne) {
  var e = etat || {};
  var p = panne || {};
  // ⚠️ La panne passe AVANT le reste : « 12 retrouvés » est vrai et trompeur quand la passe est
  // suspendue depuis six jours. Le « depuis quand » ET le « pourquoi » (corollaire ADR-0049).
  if (p.depuisMs) {
    return '⛔ suspendue depuis le ' + new Date(p.depuisMs).toISOString().slice(0, 16).replace('T', ' ')
      + ' — ' + (p.cause || 'cause non consignée') + ' · reprise automatique à la prochaine sonde';
  }
  // ⚠️ SANS son étiquette, comme `phrasePerimetrePiece_` et ses voisines : c'est `majSante_` qui
  // pose le libellé. Une phrase qui porte son propre titre s'affiche deux fois le jour où on la
  // range sous un autre, et le décalage ne lève rien.
  if (!e.ts) return 'jamais passée';
  var pourquoi = detailMotifsResolution_(e.motifs);
  if (e.fini && !e.restants) {
    // ⚠️ Le CUMUL de la campagne, jamais les compteurs de la dernière passe : celle qui
    // CONCLUT est précisément celle qui n'a plus rien trouvé, donc elle dirait « 0 retrouvés ».
    var c = e.cumul;
    if (!c) return '✅ terminée — compteurs de campagne absents (passe d\'avant ce correctif)';
    return '✅ terminée — ' + c.resolus + ' retrouvés, ' + c.refuses + ' sans preuve suffisante'
      + pourquoi;
  }
  // ⚠️ Le MOTIF de fin est toujours dit, même quand la passe a bien travaillé : « rien à faire »,
  // « budget » et « panne » laissent le même silence si on ne les nomme pas (leçon C28-135).
  // ⚠️ Les ÉCRITURES sont dites dès qu'elles DIVERGENT des décisions : les afficher toujours
  // ajouterait un chiffre là où il n'apprend rien, les taire cacherait le seul cas qui compte.
  var decisions = (e.resolus || 0) + (e.refuses || 0);
  var ecrit = (e.ecrites !== undefined && e.ecrites !== decisions)
    ? ' · ⚠️ ' + e.ecrites + ' cellule(s) écrite(s) sur ' + decisions : '';
  return (e.resolus || 0) + ' retrouvés · ' + (e.refuses || 0) + ' sans preuve' + pourquoi
    + ecrit + ' · ' + (e.restants || 0) + ' à examiner — ' + (e.fin || '?');
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
    var props = PropertiesService.getScriptProperties();
    return phraseResolutionFileId_(etatResolutionFileId_(props), panneResolutionFileId_(props));
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * PURE. Les segments non vides d'un chemin d'Index (`02 · Finances/2025` → `['02 · Finances','2025']`).
 *
 * ⚠️ REMPLACE `dernierSegmentChemin_`, qui ne rendait que le DERNIER — corrigé après une revue
 * de sécurité. Le nom d'un dossier ne prouve pas son identité : les chemins d'Index se terminent
 * par une ANNÉE (`2025`) ou un nom d'entité, et `2025` existe sous chacun des neuf domaines. Un
 * homonyme rangé sous `03 · Logement/2025` serait devenu l'unique candidat d'une ligne
 * `02 · Finances/2025`, avec un verdict POSITIF — donc définitif de fait, jamais re-jugé par un
 * bump. On compare désormais la CHAÎNE entière, sur autant de niveaux que l'Index en donne.
 */
function segmentsChemin_(chemin) {
  var out = [];
  var parts = String(chemin == null ? '' : chemin).split('/');
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i].trim();
    if (seg) out.push(seg);
  }
  return out;
}

/**
 * PURE. Ce candidat est-il l'exemplaire ÉCARTÉ d'un doublon, alors que l'Index le range ailleurs ?
 *
 * ⚠️ Cas trouvé en revue : quand l'exemplaire rangé a disparu (renommé, déplacé) et que seule la
 * copie de `_Doublons` porte encore l'empreinte, l'accepter ferait pointer la Mémoire sur le
 * REBUT — avec le `chemin` de l'Index, qui dit autre chose. Le contenu serait juste, le lieu faux.
 * On ne refuse que si TOUS ses chemins passent par `_Doublons` et que l'Index n'y range pas la
 * ligne : un candidat qui existe aussi ailleurs reste acceptable.
 */
function estExemplaireEcarte_(candidat, cheminAttendu) {
  if (segmentsChemin_(cheminAttendu).indexOf(SEGMENT_DOUBLONS) >= 0) return false;
  var chemins = (candidat && candidat.chemins) || [];
  if (!chemins.length) return false;
  for (var i = 0; i < chemins.length; i++) {
    if (segmentsChemin_(chemins[i]).indexOf(SEGMENT_DOUBLONS) < 0) return false;
  }
  return true;
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
  // ⚠️ LES RACCOURCIS SONT ÉCARTÉS, et c'est ce dépôt qui en fabrique : `creerRaccourcisEntites_`
  // en pose avec le MÊME nom que le document et SANS empreinte. Un raccourci rangé dans un
  // dossier d'entité pouvait donc devenir l'unique candidat d'une ligne sans empreinte — verdict
  // positif sur un objet qui n'est même pas le fichier (revue de code).
  return "name = '" + n + "' and trashed = false" +
    " and mimeType != 'application/vnd.google-apps.shortcut'";
}

/* ---------- I/O ---------- */

/**
 * Le nom ET les parents d'un dossier Drive, mémoïsés pour le run.
 *
 * ⚠️ Rend `null` quand la lecture ÉCHOUE, jamais un nom vide : un `403` ou un blip sur un seul
 * dossier ferait sinon écrire « hors-chemin » sur la ligne — un refus figé jusqu'au prochain
 * bump, pour une panne de trente secondes (revue quotas). L'échec n'est PAS mémoïsé.
 */
function fichesDossierMemo_(id, memo) {
  if (!id) return null;
  if (Object.prototype.hasOwnProperty.call(memo, id)) return memo[id];
  var fiche = null;
  try {
    var d = DriveApp.getFolderById(id);
    var parents = [];
    try {
      var it = d.getParents();
      while (it.hasNext()) parents.push(String(it.next().getId()));
    } catch (eP) { parents = []; } // racine / Drive partagé : pas d'ancêtre, ce n'est pas un échec
    fiche = { nom: String(d.getName() || ''), parents: parents };
    memo[id] = fiche;                                  // seuls les SUCCÈS sont mémoïsés
  } catch (e) { fiche = null; }
  return fiche;
}

/**
 * Les chemins de `profondeur` segments qui FINISSENT par ce dossier (`02 · Finances/2025`).
 *
 * ⚠️ C'EST LE CŒUR DU CORRECTIF DE REVUE. Comparer le seul nom du dossier parent ne prouve rien :
 * `2025` existe sous chacun des neuf domaines, et un homonyme rangé sous `03 · Logement/2025`
 * serait devenu l'unique candidat d'une ligne `02 · Finances/2025` — verdict POSITIF, donc
 * définitif de fait. On remonte autant de niveaux que l'Index en donne.
 *
 * ⚠️ MULTI-PARENTS : toutes les chaînes sont rendues, pas seulement la première. Ce dépôt traite
 * le multi-parents partout ailleurs (`aParentProtege_` remonte TOUTE la chaîne, §1) ; n'en
 * regarder qu'une exclurait du bon dossier un fichier qui y est réellement.
 *
 * ⚠️ Une chaîne trop courte n'est JAMAIS rendue tronquée : un chemin plus court comparé à un
 * attendu plus long ne matche pas, ce qui est le bon sens du doute. `null` = illisible.
 *
 * @return {Array<string>|null} les chemins, ou `null` si un ancêtre n'a pas pu être lu
 */
function cheminsDossier_(idDossier, profondeur, memo) {
  if (!idDossier || profondeur <= 0) return [];
  var fiche = fichesDossierMemo_(idDossier, memo);
  if (!fiche) return null;                             // PANNE, pas « pas de chemin »
  if (profondeur === 1) return [fiche.nom];
  var out = [];
  for (var i = 0; i < fiche.parents.length && out.length < RESOLUTION_FILEID_MAX_CHEMINS; i++) {
    var hauts = cheminsDossier_(fiche.parents[i], profondeur - 1, memo);
    if (hauts === null) return null;
    for (var j = 0; j < hauts.length && out.length < RESOLUTION_FILEID_MAX_CHEMINS; j++) {
      out.push(hauts[j] + '/' + fiche.nom);
    }
  }
  return out;
}

/**
 * Les candidats Drive pour un nom de fichier : empreinte + chaînes de dossiers.
 *
 * ⚠️ On DEMANDE un candidat de plus que le plafond. Une page pleine ne dit pas « il y en a N »,
 * elle dit « je n'ai pas tout vu » — et on rend alors la main SANS payer la remontée des
 * dossiers, puisque le verdict sera un refus.
 *
 * @param {string} nom
 * @param {number} profondeur  nombre de segments du chemin d'Index à comparer
 * @param {Object} memoDossiers  cache de run (partagé entre les lignes)
 * @return {{candidats: Array<Object>, tropNombreux: boolean}}
 */
function candidatsPourNom_(nom, profondeur, memoDossiers) {
  var url = urlListeDrive_(qNomDrive_(nom), 'files(id,name,md5Checksum,parents)', '',
    RESOLUTION_FILEID_MAX_CANDIDATS + 1);
  var page = pageListeDrive_(url);
  var res = { candidats: [], tropNombreux: page.files.length > RESOLUTION_FILEID_MAX_CANDIDATS };
  if (res.tropNombreux) return res;
  for (var i = 0; i < page.files.length; i++) {
    var f = page.files[i];
    var parents = f.parents || [];
    var chemins = [];
    var illisible = false;
    for (var p = 0; p < parents.length && chemins.length < RESOLUTION_FILEID_MAX_CHEMINS; p++) {
      var ch = cheminsDossier_(String(parents[p]), profondeur, memoDossiers);
      if (ch === null) { illisible = true; break; }
      for (var q = 0; q < ch.length && chemins.length < RESOLUTION_FILEID_MAX_CHEMINS; q++) {
        chemins.push(ch[q]);
      }
    }
    res.candidats.push({
      id: String(f.id || ''),
      empreinte: String(f.md5Checksum || ''),
      chemins: chemins,
      illisible: illisible
    });
  }
  return res;
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

/** PURE. Le cumul de campagne (`<resolus>/<refuses>`). Absent ⇒ `null`, jamais un zéro inventé. */
function decoderCumulResolution_(brut) {
  var b = String(brut == null ? '' : brut).trim();
  if (!b) return null;
  var p = b.split('/');
  return { resolus: Number(p[0]) || 0, refuses: Number(p[1]) || 0 };
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
 * Suspend la passe après une panne. L'horodatage du PREMIER échec est CONSERVÉ (le « depuis
 * quand »), la cause du DERNIER est remplacée (le « pourquoi ») — corollaire ADR-0049 : une
 * panne répétée six jours dont le `ts` se rafraîchit toutes les cinq minutes a l'air neuve.
 */
function suspendreResolutionFileId_(props, cause) {
  try {
    var deja = panneResolutionFileId_(props);
    var depuis = deja.depuisMs ? new Date(deja.depuisMs).toISOString() : new Date().toISOString();
    props.setProperty('DriveAI_RESOLUTION_FILEID_PANNE',
      depuis + '|' + tronquer_(String(cause || ''), 200));
  } catch (e) { /* l'état est une commodité : il ne fait jamais échouer la passe */ }
}

/** Réarme après une passe qui a avancé — une panne guérie ne doit pas rester affichée. */
function leverSuspensionResolutionFileId_(props) {
  try { props.deleteProperty('DriveAI_RESOLUTION_FILEID_PANNE'); } catch (e) { /* noop */ }
}

/**
 * L'état persisté de la passe
 * (`<ISO>|<fin>|<resolus>/<refuses>|<restants>|<curseur>|<motifs>`).
 */
function noterFinResolutionFileId_(props, res) {
  try {
    props.setProperty('DriveAI_RESOLUTION_FILEID_FIN', [
      new Date().toISOString(), res.fin,
      (res.resolus || 0) + '/' + (res.refuses || 0) + '/' + (res.ecrites || 0),
      String(res.restants || 0), String(res.curseur || 0),
      // ⚠️ 6ᵉ champ, EN QUEUE : un champ ajouté à un état déjà persisté ne s'insère jamais au
      // milieu — les lecteurs d'avant liraient le nouveau à la place d'un ancien, sans erreur
      // (leçon C28-44). Son absence vaut « passe d'avant C49-16 », pas « aucun refus ».
      encoderMotifsResolution_(res.motifs),
      // ⚠️ 7ᵉ champ, en queue : le CUMUL de la campagne. Sans lui, la phrase terminale annonce
      // « ✅ terminée — 0 retrouvés » (le dernier tour, celui qui ne trouve plus rien, est
      // justement celui qui conclut) — au moment précis où il faut lire le contraire. C'est la
      // SEULE ligne qui dise si les 734 documents sont redevenus désignables.
      (res.cumulResolus || 0) + '/' + (res.cumulRefuses || 0)
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
    // ⚠️ Les DÉCISIONS ne sont pas les ÉCRITURES. Une cellule qui refuse de s'écrire laisse la
    // ligne à re-chercher au run suivant, indéfiniment, pendant que « 40 retrouvés » s'affiche —
    // « un compteur d'envoyés (pas d'écrits) + un run vert = trou silencieux » (§9). Absent sur
    // une chaîne d'avant ce correctif : `undefined`, jamais 0, qui affirmerait une mesure.
    ecrites: compteurs.length > 2 ? (Number(compteurs[2]) || 0) : undefined,
    restants: Number(p[3]) || 0, curseur: Number(p[4]) || 0,
    motifs: decoderMotifsResolution_(p[5]),
    cumul: decoderCumulResolution_(p[6]),
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
function resolutionFileIdDoitTourner_(etat, tagPersiste, tagCourant, suspendueJusquaMs, maintenantMs) {
  if (String(tagPersiste || '') !== String(tagCourant || '')) return true; // bump : on refait tout
  // ⚠️ SUSPENSION APRÈS PANNE (revue quotas). Sans elle, un refus Drive persistant fait re-lire
  // l'Index ENTIER (26 550 × 9 cellules) à chaque tick, 288 fois par jour, pour re-échouer :
  // ~20 à 30 min de runtime quotidien, indéfiniment, et INVISIBLES au test d'enveloppe — qui ne
  // somme que des constantes `*_BUDGET_JOUR_MS` nommées. C'est le patron C28-48 : on re-sonde,
  // on ne boucle pas. Le bump ci-dessus passe AVANT : une suspension ne doit jamais empêcher
  // Marc de relancer la campagne à la main.
  if (suspendueJusquaMs && maintenantMs && maintenantMs < suspendueJusquaMs) return false;
  if (!etat || !etat.ts) return true;                                      // jamais passée
  return !etat.fini;                                                       // terminée ⇒ silence
}

/**
 * PURE sur props. Jusqu'à quand la passe est-elle suspendue après une panne ? (0 = pas suspendue)
 *
 * ⚠️ La CAUSE voyage avec la date : « 403 quota », « scope perdu », « réseau » et « écriture
 * refusée » appellent quatre gestes différents, et un seul mot `panne` les rend indiscernables
 * (corollaire ADR-0049). Elle est lue par la Santé, pas seulement par la gate.
 */
function panneResolutionFileId_(props) {
  var brut = '';
  try { brut = String(props.getProperty('DriveAI_RESOLUTION_FILEID_PANNE') || ''); } catch (e) { brut = ''; }
  if (!brut) return { depuisMs: 0, cause: '' };
  var p = brut.split('|');
  var t = Date.parse(p[0] || '');
  return { depuisMs: isNaN(t) ? 0 : t, cause: p.slice(1).join('|') };
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
  // Le cumul REPART de zéro sur un bump : il décrit la campagne en cours, pas l'historique.
  res.cumulResolus = bump ? 0 : ((etat.cumul && etat.cumul.resolus) || 0);
  res.cumulRefuses = bump ? 0 : ((etat.cumul && etat.cumul.refuses) || 0);
  if (bump) {
    // Le tag se pose AVANT tout `return` possible : posé après, une sortie précoce le laisserait
    // absent et la passe repartirait de zéro à chaque tick (leçon `UNE-SORTIE-PRÉCOCE`).
    try { props.setProperty('DriveAI_RESOLUTION_FILEID_TAG', tagCourant); } catch (e) { /* noop */ }
    etat = { ts: '', curseur: 0 };
  }

  // ⚠️ La lecture de l'Index est GARDÉE (revue quotas) : hors try, une Sheet indisponible faisait
  // remonter l'exception jusqu'au catch du tick — l'intake était sauf, mais `noterFinResolution…`
  // n'était jamais appelée, donc la Santé réaffichait la phrase de la passe PRÉCÉDENTE, datée
  // d'avant. « Index illisible », « jamais atteinte » et « tout va bien » devenaient
  // indiscernables : exactement le silence que ce module dit éviter (C28-135).
  var f, lignes;
  try {
    f = feuille_('Index');
    if (!f || f.getLastRow() < 2) { res.fin = 'index-vide'; return noterFinResolutionFileId_(props, res); }
    lignes = f.getRange(2, 1, f.getLastRow() - 1, 9).getValues();
  } catch (eLecture) {
    res.fin = 'index-illisible';
    suspendreResolutionFileId_(props, 'index : ' + eLecture);
    journalErreur_('ResolutionFileId', 'Index illisible : ' + eLecture);
    return noterFinResolutionFileId_(props, res);
  }

  var choix = selectionnerAResoudre_(lignes, tagCourant, bump ? 0 : (etat.curseur || 0),
    CONFIG.RESOLUTION_FILEID_MAX_PAR_RUN);
  res.restants = choix.restants;
  // Le curseur part d'où la SÉLECTION a commencé ; c'est la boucle qui l'avance, ligne par
  // ligne, à mesure qu'elle tranche vraiment (cf. `selectionnerAResoudre_`).
  res.curseur = choix.debut;
  if (!choix.choisies.length) {
    // ⚠️ « TERMINÉ » ne se prononce que sur un tour qui a commencé à ZÉRO. Un scan parti d'un
    // curseur n'a rien dit des lignes SITUÉES AVANT lui — et trois mécanismes y en laissent :
    // une coupure, un échec d'écriture cellule par cellule, et une suppression de lignes
    // d'Index qui décale la numérotation. Fermer la porte à vie sur ce scan-là, c'est annoncer
    // « ✅ terminée » sur une campagne incomplète, sans aucun moyen de le savoir. On rend donc
    // la main avec le curseur à zéro, pour un dernier tour complet.
    if (choix.fini && choix.debut > 0) { res.fin = 'tour'; res.curseur = 0; }
    else res.fin = choix.fini ? 'termine' : 'rien';
    return noterFinResolutionFileId_(props, res);
  }

  var memoDossiers = {};
  var ecritures = [];
  // ⚠️ SOUS-BUDGET PAR RUN (revue quotas). Toutes ses voisines en ont un ; sans lui, l'étape peut
  // consommer TOUT le reliquat du budget de tick — et affamer exactement les deux qu'elle est
  // placée là pour alimenter, dont le rattrapage, le seul poste qui dépense des dollars.
  var debutRun = Date.now();
  var gardeRun = function () {
    if (!opts.manuel && garde && garde()) return true;
    return (Date.now() - debutRun) > CONFIG.RESOLUTION_FILEID_BUDGET_MS;
  };
  for (var i = 0; i < choix.choisies.length; i++) {
    // ⚠️ Le garde-temps est évalué À CHAQUE ITEM, dans la boucle qui fait l'I/O — jamais dans une
    // sélection préalable, qui s'exécute en microsecondes et ne peut donc pas couper (leçon §9).
    if (gardeRun()) { res.fin = 'budget'; break; }
    var ligne = choix.choisies[i];
    var verdict;
    try {
      var segments = segmentsChemin_(ligne.chemin);
      var trouves = candidatsPourNom_(ligne.nom, segments.length, memoDossiers);
      verdict = choisirResolutionFileId_(
        trouves.candidats, ligne.empreinte, segments.join('/'), trouves.tropNombreux);
    } catch (e) {
      // Une PANNE n'est pas un VERDICT : on ne marque rien, la ligne sera re-tentée. Marquer ici
      // figerait un refus sur une coupure réseau (leçon §9, C28-129).
      res.fin = 'panne';
      suspendreResolutionFileId_(props, 'drive : ' + e);
      journalErreur_('ResolutionFileId', 'Recherche Drive impossible : ' + e);
      break;
    }
    // Une chaîne de dossiers illisible est une PANNE de la même famille : on ne marque RIEN, et
    // on rend la main plutôt que de figer « hors-chemin » sur un blip de trente secondes.
    if (verdict.panne) {
      res.fin = 'panne';
      suspendreResolutionFileId_(props, 'dossier illisible');
      break;
    }
    if (verdict.fileId) {
      res.resolus++; res.cumulResolus++;
      ecritures.push({ rang: ligne.rang, valeur: verdict.fileId });
    }
    else {
      res.refuses++; res.cumulRefuses++;
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
  res.ecrites = 0;
  for (var k = 0; k < ecritures.length; k++) {
    try {
      f.getRange(ecritures[k].rang + 2, 9).setValue(ecritures[k].valeur);
      res.ecrites++;
    }
    catch (e) { journalErreur_('ResolutionFileId', 'Écriture ligne ' + (ecritures[k].rang + 2) + ' : ' + e); }
  }
  // ⚠️ DÉCIDER N'EST PAS ÉCRIRE (revue quotas). Une ligne dont la cellule refuse de s'écrire est
  // re-sélectionnée au run suivant, donc re-payée en recherche Drive — indéfiniment, pendant que
  // les compteurs annoncent « 40 retrouvés ». Zéro écriture sur des décisions prises est une
  // panne d'ÉCRITURE : on la nomme et on suspend, au lieu de boucler.
  if (ecritures.length && !res.ecrites) {
    res.fin = 'panne-ecriture';
    suspendreResolutionFileId_(props, 'sheet : aucune cellule écrite sur ' + ecritures.length);
    return noterFinResolutionFileId_(props, res);
  }
  if (res.fin === 'vide') res.fin = choix.fini && res.curseur >= lignes.length ? 'termine' : 'page';
  if (res.fin !== 'panne') leverSuspensionResolutionFileId_(props); // une passe qui avance réarme
  return noterFinResolutionFileId_(props, res);
}

/**
 * Lancement MANUEL depuis l'éditeur (`ResolutionFileId.gs` → `resoudreIdentifiantsMaintenant`).
 *
 * ⚠️ Le budget du TICK ne s'applique pas (il protège le quota des déclencheurs, dont une
 * exécution à la main est hors) — mais le SOUS-BUDGET par run, lui, reste : c'est le seul filet
 * contre le mur des six minutes d'Apps Script, et il n'y en avait aucun ici avant la revue.
 * Une passe traite au plus `CONFIG.RESOLUTION_FILEID_MAX_PAR_RUN` lignes : il faut donc
 * relancer pour aller plus loin.
 */
function resoudreIdentifiantsMaintenant() {
  var res = etapeResolutionFileId_(function () { return false; }, { manuel: true });
  // ⚠️ La MÊME phrase que la Santé, et pas une seconde écrite à la main : deux formulations de
  // la même passe divergent au premier champ ajouté, et c'est celle qu'on lit le moins qui ment.
  var propsM = PropertiesService.getScriptProperties();
  var ligne = 'Résolution des identifiants (manuel) : '
    + phraseResolutionFileId_(etatResolutionFileId_(propsM), panneResolutionFileId_(propsM));
  Logger.log(ligne);
  journalInfo_('ResolutionFileId', ligne);
  return ligne;
}
