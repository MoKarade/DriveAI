/**
 * HistoriqueImport.gs — la SÉRIE TEMPORELLE de la lecture des papiers (demande Marc, 21/09/2026 :
 * « vérifie la rapidité d'avancement — je veux un graphe », puis « c'est exactement ce qu'il me
 * faut DANS L'APP »).
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE. Le moteur savait dire où il EN EST (`…_RESTANTS`, `…_CUMUL`),
 * jamais à quelle VITESSE il y est arrivé — et une vitesse ne se déduit pas d'un instantané. Le
 * 21/09, la seule façon de répondre « quand est-ce fini ? » a été de projeter à partir d'UN point,
 * ce qui donnait deux réponses selon le rythme retenu (40 jours ou 21). Une série de points tranche
 * ce qu'aucune projection ne peut trancher.
 *
 * ⚠️ APPEND-ONLY, comme `HistoriqueVrac` : l'onglet EST la série. Il ne se réécrit pas, donc une
 * valeur fausse écrite ici ne se corrige jamais — d'où la règle du §« je ne sais pas » ci-dessous.
 *
 * ⚠️ AUCUNE lecture Drive, AUCUN appel LLM : tout est déjà en Properties. Cette étape ne prélève
 * donc RIEN sur l'enveloppe de 63 min/jour — et c'est la seule raison pour laquelle elle n'a pas sa
 * constante `*_BUDGET_JOUR_MS` (l'invariant d'orchestration est aveugle à une étape qui n'en a pas,
 * donc l'absence se justifie ici plutôt qu'elle ne se constate).
 */

var COLONNES_HISTORIQUE_IMPORT = ['Date', 'Restants', 'Extraits', 'Acceptés', 'Illisibles',
  'Sans texte', 'Échecs', 'Tag'];

/**
 * PURE. Faut-il écrire le point du jour ? Une seule ligne par jour : la série se lit en jours,
 * et 288 lignes quotidiennes rendraient l'onglet illisible sans rien apprendre de plus.
 *
 * @param {string} dernier    le jour de la dernière écriture (`AAAA/MM/JJ`), ou vide
 * @param {string} aujourdhui le jour courant (`dateGmail_`)
 * @return {boolean}
 */
function doitEcrireHistoriqueImport_(dernier, aujourdhui) {
  var j = String(aujourdhui || '').trim();
  if (!j) return false;
  return String(dernier || '').trim() !== j;
}

/**
 * PURE. La ligne du jour.
 *
 * ⚠️ « JE NE SAIS PAS » NE S'ÉCRIT PAS ZÉRO. `restants` vaut `null` tant que la campagne n'a
 * jamais publié son compte : écrire 0 dirait « c'est fini » dans un journal qui ne se corrige
 * jamais, et une courbe qui touche l'axe ne se distingue pas d'une courbe qui n'a pas de point.
 * La cellule reste VIDE — un trou se voit, un faux zéro non.
 *
 * ⚠️ LE TAG EST DANS LA LIGNE, et ce n'est pas décoratif : bumper le tag de campagne remet les
 * cumuls à zéro (la liste des faits est écrite SOUS le tag). Sans cette colonne, la série
 * montrerait une chute verticale inexplicable là où il n'y a eu qu'un changement de périmètre.
 *
 * @param {string} date        `AAAA/MM/JJ`
 * @param {{faits:number, acceptees:number, illisibles:number, sansTexte:number, echecs:number}} cumul
 * @param {?number} restants   le compte publié, ou null s'il n'est pas connu
 * @param {string} tag         la campagne en cours
 * @return {Array}
 */
function ligneHistoriqueImport_(date, cumul, restants, tag) {
  var c = cumul || {};
  var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };
  var r = Number(restants);
  return [
    date,
    (restants === null || restants === undefined || !isFinite(r)) ? '' : r,
    n(c.faits), n(c.acceptees), n(c.illisibles), n(c.sansTexte), n(c.echecs),
    String(tag || '')
  ];
}

/**
 * ÉTAPE DE TICK. Lit ce que la campagne a déjà persisté et pose le point du jour.
 *
 * ⚠️ Elle ne lève JAMAIS : une observabilité qui fait échouer l'étape qu'elle observe est pire
 * que l'absence d'observabilité. Toute panne se journalise et la passe rend la main.
 */
function majHistoriqueImport_() {
  var props = PropertiesService.getScriptProperties();
  var aujourdhui;
  try { aujourdhui = dateGmail_(new Date()); } catch (e) { return; }

  if (!doitEcrireHistoriqueImport_(props.getProperty('DriveAI_IMPORT_HISTO_JOUR'), aujourdhui)) return;

  var tag = String(CONFIG.RATTRAPAGE_PIECE_TAG || '');
  var cumul, restants;
  try {
    cumul = lireCumulRattrapage_(props, tag);
    restants = restantsRattrapage_(props);
  } catch (e) {
    journalErreur_('HistoriqueImport', 'Compteurs illisibles (' + e + ') : aucun point posé '
      + 'aujourd\'hui plutôt qu\'un point faux dans un journal qui ne se corrige pas.');
    return;
  }

  try {
    var f = feuille_('HistoriqueImport');
    f.getRange(f.getLastRow() + 1, 1, 1, COLONNES_HISTORIQUE_IMPORT.length)
      .setValues([ligneHistoriqueImport_(aujourdhui, cumul, restants, tag)]);
    // ⚠️ La garde se pose APRÈS l'écriture : posée avant, une panne de Sheet ferait sauter le
    // point du jour pour toujours — l'onglet étant append-only, il n'y a pas de rattrapage.
    props.setProperty('DriveAI_IMPORT_HISTO_JOUR', aujourdhui);
  } catch (e) {
    journalErreur_('HistoriqueImport', 'Point du jour non écrit : ' + e);
  }
}
