/**
 * AuditVision.gs — L'AUDIT de la lecture vision, sur vingt vrais papiers (ADR-0063, lot L1).
 *
 * Marc a choisi le 24/09 « Vision Sonnet partout » et « Tout relire », avec 100 $ au total. Une
 * campagne de ~4 300 papiers ne se lance pas sur une estimation : ce module en lit VINGT, les
 * envoie à la Mémoire (où l'ancienne lecture reste gardée, ADR 0008 de MemoryAI), et publie ce
 * que chacun a coûté et produit. C'est la porte avant la campagne, comme l'audit C49-3 l'a été
 * avant le rattrapage.
 *
 * ── QUELS PAPIERS ──────────────────────────────────────────────────────────────────────
 *
 * Ceux que la lecture Haiku a déjà traités, choisis PAR ISSUE et d'abord parmi ses échecs : ce
 * que la vision doit prouver, c'est qu'elle lit ce que l'OCR ne lisait pas (« illisible »,
 * « ocr-echec », « sans-texte »). Quatre papiers bien lus en v2 servent de TÉMOINS : si la
 * vision n'y apporte rien de plus, la campagne ne vaut pas son prix.
 *
 * ── CE QUE L'ONGLET PORTE, ET CE QU'IL NE PORTE PAS ────────────────────────────────────
 *
 * Des COMPTES et des oui/non — combien de numéros, une date de naissance oui ou non, les jetons,
 * le coût, la durée. JAMAIS une valeur : l'onglet vit dans le compte Google de Marc, mais une
 * feuille se partage d'un clic, et la règle du §9 (« métadonnées seulement dans l'état ») ne
 * connaît pas d'exception pour un audit. Les VALEURS sont dans la Mémoire, sous ses verrous.
 *
 * À lancer à la main : `AuditVision.gs` → `auditerVisionMaintenant` → Exécuter.
 */

var ONGLET_AUDIT_VISION = 'AuditVision';

var COLONNES_AUDIT_VISION = [
  'Rang', 'FileId', 'Fichier', 'Domaine', 'Avant (Haiku)', 'Statut', 'Voie', 'Issue',
  'Titulaire', 'Naissance', 'Échéance', 'Apparence', 'Numéros', 'Montants', 'Personnes',
  'Lieux', 'Libres', 'Résumé (car.)', 'Jetons entrée', 'Jetons sortie', 'Coût $', 'Durée s',
  'Mémoire', 'Le',
  // ⚠️ EN QUEUE : `cellulesAuditVision_` écrit de « Statut » à « Le », et ces deux-là doivent
  // survivre à cette écriture. `Chemin` accompagne la pièce (une relecture v3 REMPLACE la v2, qui
  // le portait) ; `Essais` borne ce qu'une ligne peut coûter (revue #418).
  'Chemin', 'Essais'
];

var COL_CHEMIN_AUDIT_VISION = COLONNES_AUDIT_VISION.indexOf('Chemin');
var COL_ESSAIS_AUDIT_VISION = COLONNES_AUDIT_VISION.indexOf('Essais');

/**
 * Au-delà, une ligne cesse d'être rejouée et se marque « essais épuisés ». Sans ce plafond, un
 * papier qui fait tomber l'appel (réseau, 5xx, délai dépassé — FACTURÉ quand même) serait repris
 * EN TÊTE à chaque tick : il re-paierait sans fin, et les dix-neuf autres n'avanceraient jamais.
 */
var AUDIT_VISION_ESSAIS_MAX = 3;

/**
 * Trois échecs IDENTIQUES d'affilée sur une cause qui peut toucher tout le lot (Drive qui refuse,
 * même code HTTP 4xx, aperçu absent) ne sont pas trois mesures : c'est le CANAL. Coupe-circuit
 * jumeau de celui du rattrapage (C49-26) — les marques de la série se retirent.
 */
var AUDIT_VISION_SERIE_MAX = 3;

/** La colonne « Statut » (0-indexée) : c'est elle qui dit « à faire ». Dérivée, jamais écrite. */
var COL_STATUT_AUDIT_VISION = COLONNES_AUDIT_VISION.indexOf('Statut');

/**
 * Combien de papiers par issue Haiku. D'abord ses ÉCHECS, parce que c'est là que la vision doit
 * faire ses preuves ; puis des témoins bien lus. La somme fait la taille de l'échantillon, et
 * ce qu'une issue ne peut pas fournir revient aux autres (la taille promise est la taille rendue).
 */
var QUOTAS_AUDIT_VISION = [
  ['illisible', 5], ['ocr-echec', 4], ['sans-texte', 3],
  ['lecture-impossible', 2], ['extraction-vide', 2], ['ok', 4]
];

/** L'ordre des domaines choisi par Marc le 24/09 pour la campagne — l'audit le suit. */
var ORDRE_DOMAINES_VISION = ['04', '01', '02', '05', '03', '08', '07', '09', '06'];

/* ---------- PUR ---------- */

/** PURE. Taille de l'échantillon, DÉRIVÉE des quotas : deux nombres pour une question divergent. */
function tailleAuditVision_() {
  var n = 0;
  for (var i = 0; i < QUOTAS_AUDIT_VISION.length; i++) n += QUOTAS_AUDIT_VISION[i][1];
  return n;
}

/**
 * PURE. La DERNIÈRE issue connue de chaque papier, depuis `PiecesFaites` (append-only : une
 * ligne plus récente dit ce qu'est devenu le papier).
 *
 * @param {Array<Array>} lignes  `[FileId, Tag, Le, Nom, Motif, Domaine]`, sans l'en-tête
 * @return {!Object} fileId → motif
 */
function derniersMotifsVision_(lignes) {
  var out = {};
  var src = lignes || [];
  for (var i = 0; i < src.length; i++) {
    var id = String(src[i] && src[i][0] != null ? src[i][0] : '').trim();
    var motif = String(src[i] && src[i][4] != null ? src[i][4] : '').trim();
    if (id && motif) out[id] = motif;
  }
  return out;
}

/** PURE. Une photo ? Ce sont les papiers où la vision a le plus à prouver. */
function estImageVision_(nom) {
  return /\.(jpe?g|png|gif|webp|tiff?|heic|bmp)$/i.test(String(nom || ''));
}

/**
 * PURE. Compose l'échantillon.
 *
 * ⚠️ UN PAPIER, PAS UNE LIGNE : l'Index porte souvent plusieurs lignes du même fichier ; on garde
 * la plus RÉCENTE classée (son domaine est celui où le papier vit aujourd'hui).
 * ⚠️ DÉTERMINISTE : même Index, même liste — sinon « les vingt papiers » ne désignerait rien
 * d'une reprise à l'autre. Tri : images d'abord, puis l'ordre des domaines, puis le nom.
 * ⚠️ « introuvable » est exclu : un fichier supprimé ne mesure rien de la lecture.
 *
 * @param {!Object} motifs      fileId → dernière issue Haiku
 * @param {Array<Array>} lignesIndex
 * @param {Function} fileIdDe   lit le fileId d'une ligne d'Index
 * @return {Array<Object>} `{cle, nom, domaine, chemin, statut, fileId, avant}`
 */
function composerEchantillonVision_(motifs, lignesIndex, fileIdDe) {
  var dernier = {};
  var src = lignesIndex || [];
  for (var i = 0; i < src.length; i++) {
    var statut = String(src[i][5] || '').toLowerCase();
    if (statut.indexOf('class') !== 0) continue;
    var id = fileIdDe(src[i]);
    if (!id || !Object.prototype.hasOwnProperty.call(motifs, id)) continue;
    dernier[id] = i;
  }

  var parMotif = {};
  for (var fid in dernier) {
    if (!Object.prototype.hasOwnProperty.call(dernier, fid)) continue;
    var motif = motifs[fid];
    if (motif === 'introuvable') continue;
    var l = src[dernier[fid]];
    (parMotif[motif] = parMotif[motif] || []).push({
      cle: String(l[0] || ''), nom: String(l[2] || ''), domaine: String(l[3] || ''),
      chemin: String(l[4] || ''), statut: String(l[5] || ''), fileId: fid, avant: motif
    });
  }

  var rangDomaine = function (d) {
    var r = ORDRE_DOMAINES_VISION.indexOf(String(d || '').slice(0, 2));
    return r === -1 ? ORDRE_DOMAINES_VISION.length : r;
  };
  for (var m in parMotif) {
    if (!Object.prototype.hasOwnProperty.call(parMotif, m)) continue;
    parMotif[m].sort(function (a, b) {
      var ia = estImageVision_(a.nom) ? 0 : 1, ib = estImageVision_(b.nom) ? 0 : 1;
      if (ia !== ib) return ia - ib;
      var da = rangDomaine(a.domaine), db = rangDomaine(b.domaine);
      if (da !== db) return da - db;
      return a.nom < b.nom ? -1 : a.nom > b.nom ? 1 : (a.fileId < b.fileId ? -1 : 1);
    });
  }

  var taille = tailleAuditVision_();
  var choisis = [];
  var pris = {};
  var k, q;
  // 1) Chaque issue donne son quota, dans l'ordre.
  for (k = 0; k < QUOTAS_AUDIT_VISION.length; k++) {
    var lot = parMotif[QUOTAS_AUDIT_VISION[k][0]] || [];
    for (q = 0; q < lot.length && q < QUOTAS_AUDIT_VISION[k][1]; q++) {
      choisis.push(lot[q]); pris[lot[q].fileId] = 1;
    }
  }
  // 2) Ce qu'une issue n'a pas pu fournir revient aux autres, un par un, dans le même ordre.
  var progres = true;
  while (choisis.length < taille && progres) {
    progres = false;
    for (k = 0; k < QUOTAS_AUDIT_VISION.length && choisis.length < taille; k++) {
      var reste = parMotif[QUOTAS_AUDIT_VISION[k][0]] || [];
      for (q = 0; q < reste.length; q++) {
        if (pris[reste[q].fileId]) continue;
        choisis.push(reste[q]); pris[reste[q].fileId] = 1; progres = true;
        break;
      }
    }
  }
  return choisis;
}

/**
 * Les sorties qui disent quelque chose du CANAL (jeton, suspension, frein, plateforme, réseau),
 * jamais du papier. La ligne reste « à faire ».
 */
var MOTIFS_CANAL_AUDIT_VISION = ['desactive', 'jeton-absent', 'suspendu', 'frein-budget',
  'panne-llm', 'jeton-refuse', 'perimetre-retire', 'reseau', 'panne'];

/**
 * Les motifs de la LECTURE qui sont des VERDICTS du papier — une mesure. Tout le reste est une
 * panne (la ligne reste à faire).
 *
 * ⚠️ LA LISTE ÉNUMÈRE LES VERDICTS, PAS LES PANNES — c'est le sens d'`issueRattrapage_`, et la
 * première version de ce fichier faisait l'inverse (revue #418, prouvé par sonde) : un motif
 * inconnu devenait une mesure, donc un 404 sur le modèle ou une panne Drive marquaient les vingt
 * papiers en une passe et refermaient l'audit sans un seul appel utile. Dans ce sens-ci, un motif
 * nouveau coûte un re-essai (borné par `Essais`) ; dans l'autre, il coûtait l'audit entier.
 * ⚠️ `http-401/403/404` n'y sont PAS : un refus d'accès ou un modèle inconnu frappent tous les
 * papiers. `http-400/413` y sont : un format refusé est propre au fichier — le coupe-circuit de
 * série attrape le cas où il ne l'est pas.
 */
var VERDICTS_LECTURE_VISION = ['ok', 'illisible', 'coupee', 'sans-texte', 'ocr-echec', 'vide', 'image-inconnue',
  'http-400', 'http-413', 'apercu-absent', 'lecture-impossible', 'essais-epuises'];

/** Les verdicts qu'une cause COMMUNE peut produire en série — soumis au coupe-circuit. */
var VERDICTS_SERIE_VISION = ['lecture-impossible', 'http-400', 'http-413', 'apercu-absent'];

/**
 * PURE. Que faire de cette ligne ? `fait`/`echec` la marquent (c'est une MESURE du papier) ;
 * `panne` et `plafond` la laissent « à faire » et arrêtent la boucle.
 */
function issueAuditVision_(envoi) {
  var e = envoi || {};
  if (e.motif === 'plafond-run') return 'plafond';
  // Une pièce existe : la Mémoire a RÉPONDU (acceptée, déjà là, ou refusée pour ce contenu).
  if (e.piece) return 'fait';
  if (MOTIFS_CANAL_AUDIT_VISION.indexOf(String(e.motif || '')) !== -1) return 'panne';
  var mv = String((e.vision && e.vision.motif) || '');
  return VERDICTS_LECTURE_VISION.indexOf(mv) !== -1 ? 'echec' : 'panne';
}

/**
 * PURE. La gate du tick : un tag posé et pas encore mené au bout.
 * ⚠️ Elle lit le TAG, pas un compteur (leçon du 17/09) : changer le tag relance, et un compteur
 * absent ne referme rien.
 */
function auditVisionDoitTourner_(tagCourant, tagFini) {
  var t = String(tagCourant || '');
  return !!t && String(tagFini || '') !== t;
}

/**
 * PURE. Les cellules d'une ligne faite, à partir de ce que `pousserPieceApresClassement_` a
 * rendu. Rien que des COMPTES et des oui/non — la valeur la plus sensible (la date de
 * naissance) s'écrit « oui », jamais en clair.
 *
 * @return {Array} les colonnes de « Statut » à « Le », dans l'ordre de `COLONNES_AUDIT_VISION`
 */
function cellulesAuditVision_(res, quand) {
  var r = res || {};
  var v = r.vision || {};
  var p = r.piece || {};
  var libres = p.champs_libres || {};
  var st = p.champs_structures || {};
  var n = function (liste) { return liste && liste.length ? liste.length : 0; };
  var u = v.usage || null;
  var titulaire = !p.titulaire ? 'inconnu' : (titulaireEstMarc_(p.titulaire) ? 'Marc' : 'un proche');
  var memoire = r.motif === 'ok'
    ? (r.remplacees ? 'remplace la lecture précédente' : r.acceptees ? 'acceptée (neuve)' : 'déjà là')
    : String(r.motif || '?');
  var fait = !!r.piece;
  return [
    fait ? 'fait' : 'échec',
    String(v.voie || ''),
    String(v.motif || r.motif || ''),
    fait ? titulaire : '',
    fait ? (libres['date de naissance'] ? 'oui' : 'non') : '',
    fait ? (p.date_echeance ? 'oui' : 'non') : '',
    fait ? (libres['apparence (photo)'] ? 'oui' : 'non') : '',
    fait ? n(st.numeros) : '', fait ? n(st.montants) : '', fait ? n(st.personnes) : '',
    fait ? n(st.lieux) : '', fait ? Object.keys(libres).length : '',
    fait ? String(p.resume || '').length : '',
    u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : '',
    u ? (u.output_tokens || 0) : '',
    u ? Math.round(coutVisionDollars_(u) * 10000) / 10000 : '',
    v.dureeMs ? Math.round(v.dureeMs / 100) / 10 : '',
    memoire,
    quand
  ];
}

/**
 * PURE. La phrase de Santé : où en est l'audit, et ce qu'il a coûté. Sans rien exécuter.
 * @param {string} brut  `<ISO>|<fin>|<faits>/<échecs>|<restants>|<dollars>`
 */
function phraseFinAuditVision_(brut, tagCourant) {
  if (!String(tagCourant || '')) return 'non armé (CONFIG.AUDIT_VISION_TAG vide)';
  if (!brut) return 'armé (« ' + tagCourant + ' »), jamais passé';
  var p = String(brut).split('|');
  var restants = p[3] === '' || p[3] === undefined ? NaN : Number(p[3]);
  var phrase = (isFinite(restants) ? restants + ' restants sur ' + tailleAuditVision_() : 'reste inconnu')
    + ' · ' + (p[2] || '?') + ' (faits/échecs) · coût mesuré ' + (p[4] || '?') + ' $'
    + ' — ' + (PHRASES_FIN_AUDIT_VISION_[p[1]] || ('sortie « ' + (p[1] || '?') + ' »'))
    + ' · ' + (p[0] || '?');
  if (isFinite(restants) && restants === 0) phrase += ' · ✅ audit terminé — à toi de juger avant la campagne';
  return phrase;
}

var PHRASES_FIN_AUDIT_VISION_ = {
  'termine': 'passe terminée',
  'budget': 'plafond de cette exécution atteint — reprend au tick suivant',
  'budget-jour': 'budget du jour des pièces épuisé — reprise demain',
  'frein-budget': 'en pause — frein budget campagnes atteint',
  'jeton-absent': '⚠️ aucun jeton pour la Mémoire — geste de Marc requis',
  'suspendu': '⚠️ la Mémoire a refusé une pièce — re-sonde automatique',
  'panne-plateforme': '⚠️ panne de plateforme LLM — aucun appel tenté',
  'onglet-absent': '⚠️ l\'onglet AuditVision n\'a pas pu être créé',
  'echantillon-vide': '⚠️ aucun papier à auditer (PiecesFaites ou Index vide)',
  'canal': '⚠️ panne du canal ou de l\'appel (jeton, frein, réseau, 5xx, modèle refusé) — rien n\'est marqué, reprise au tick suivant',
  'serie': '⚠️ trois échecs identiques d\'affilée — cause commune probable, rien n\'est marqué'
};

/* ---------- I/O ---------- */

function noterFinAuditVision_(props, res) {
  try {
    props.setProperty('DriveAI_AUDIT_VISION_FIN', [
      new Date().toISOString(), res.fin, res.faits + '/' + res.echecs,
      res.restants === null ? '' : res.restants,
      Math.round((res.dollars || 0) * 100) / 100
    ].join('|'));
    if (res.restants === 0) props.setProperty('DriveAI_AUDIT_VISION_FINI', String(CONFIG.AUDIT_VISION_TAG || ''));
  } catch (e) { journalErreur_('AuditVision', 'État de fin non écrit : ' + e); }
  return res;
}

function texteSanteAuditVision_() {
  try {
    return phraseFinAuditVision_(
      PropertiesService.getScriptProperties().getProperty('DriveAI_AUDIT_VISION_FIN') || '',
      CONFIG.AUDIT_VISION_TAG);
  } catch (e) { return '⚠️ état illisible (' + e + ')'; }
}

/** L'onglet, créé s'il manque, et recomposé quand le tag change. */
function ongletAuditVision_(props) {
  var ss = getSheetEtat_();
  var f = ss.getSheetByName(ONGLET_AUDIT_VISION);
  if (!f) {
    f = ss.insertSheet(ONGLET_AUDIT_VISION);
    f.getRange(1, 1, 1, COLONNES_AUDIT_VISION.length).setValues([COLONNES_AUDIT_VISION]);
    f.setFrozenRows(1);
  }
  var tag = String(CONFIG.AUDIT_VISION_TAG || '');
  if (props.getProperty('DriveAI_AUDIT_VISION_TAG') !== tag || f.getLastRow() < 2) {
    if (f.getLastRow() > 1) f.getRange(2, 1, f.getLastRow() - 1, f.getMaxColumns()).clearContent();
    var faits = feuille_('PiecesFaites');
    var nf = faits.getLastRow();
    var motifs = nf < 2 ? {} : derniersMotifsVision_(faits.getRange(2, 1, nf - 1, 6).getValues());
    var docs = composerEchantillonVision_(motifs, lireLignesIndexPerimetre_() || [], fileIdDeLigneIndex_);
    if (docs.length) {
      var lignes = [];
      for (var i = 0; i < docs.length; i++) {
        var ligne = [i + 1, docs[i].fileId, docs[i].nom, docs[i].domaine, docs[i].avant, 'à faire'];
        while (ligne.length < COLONNES_AUDIT_VISION.length) ligne.push('');
        ligne[COL_CHEMIN_AUDIT_VISION] = docs[i].chemin || '';
        ligne[COL_ESSAIS_AUDIT_VISION] = 0;
        lignes.push(ligne);
      }
      f.getRange(2, 1, lignes.length, COLONNES_AUDIT_VISION.length).setValues(lignes);
    }
    props.setProperty('DriveAI_AUDIT_VISION_TAG', tag);
    props.deleteProperty('DriveAI_AUDIT_VISION_FINI');
  }
  return f;
}

/**
 * L'étape. Lit les lignes « à faire », une à une, sous le garde-temps et le budget des pièces.
 *
 * ⚠️ UNE PANNE DE CANAL N'EST PAS UN VERDICT DU PAPIER : jeton refusé, suspension, frein — la
 * ligne reste « à faire » et la boucle s'arrête (même règle qu'`issueRattrapage_`). Un échec
 * PROPRE au papier (voie impossible, réponse coupée, illisible), lui, se marque fait : c'est
 * une MESURE, exactement ce que l'audit est venu chercher.
 */
function etapeAuditVision_(garde, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var res = { faits: 0, echecs: 0, restants: null, dollars: 0, fin: 'termine' };
  if (!props.getProperty('DriveAI_MEMORYAI_TOKEN')) { res.fin = 'jeton-absent'; return noterFinAuditVision_(props, res); }
  if (memoireSuspendue_(props)) { res.fin = 'suspendu'; return noterFinAuditVision_(props, res); }
  if (estPannePlateforme_()) { res.fin = 'panne-plateforme'; return noterFinAuditVision_(props, res); }
  if (budgetCampagnesAtteint_()) { res.fin = 'frein-budget'; return noterFinAuditVision_(props, res); }

  var aujourdhui = dateGmail_(new Date());
  var consommeJour = opts.manuel ? 0 : budgetJourAudit_(props, aujourdhui);
  if (consommeJour >= CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS) { res.fin = 'budget-jour'; return noterFinAuditVision_(props, res); }

  var f;
  try { f = ongletAuditVision_(props); } catch (e) {
    journalErreur_('AuditVision', 'Onglet indisponible : ' + e);
    res.fin = 'onglet-absent';
    return noterFinAuditVision_(props, res);
  }
  var n = f.getLastRow() - 1;
  // ⚠️ Un échantillon VIDE est un état TERMINAL sous ce tag : sans `restants: 0`, la gate
  // resterait ouverte et l'onglet se recomposerait à chaque tick — deux relectures de ~20 000
  // lignes toutes les 5 minutes, comptées dans aucun budget (revue #418).
  if (n <= 0) { res.fin = 'echantillon-vide'; res.restants = 0; return noterFinAuditVision_(props, res); }
  var valeurs = f.getRange(2, 1, n, COLONNES_AUDIT_VISION.length).getValues();
  // Le coût cumulé se RELIT de la colonne : une reprise le lendemain doit afficher le total de
  // l'audit, pas celui de la dernière passe.
  var colCout = COLONNES_AUDIT_VISION.indexOf('Coût $');
  for (var c = 0; c < valeurs.length; c++) res.dollars += Number(valeurs[c][colCout]) || 0;

  var debut = Date.now();
  var plafond = opts.manuel ? CONFIG.BUDGET_MS
    : Math.min(CONFIG.AUDIT_PIECE_BUDGET_MS, CONFIG.AUDIT_PIECE_BUDGET_JOUR_MS - consommeJour);
  var restants = 0;
  for (var i = 0; i < valeurs.length; i++) if (valeurs[i][COL_STATUT_AUDIT_VISION] === 'à faire') restants++;

  // Le coupe-circuit : les lignes d'une série d'échecs IDENTIQUES, pour pouvoir les rendre.
  var serie = { motif: '', lignes: [] };
  var noterJour = function () {
    // ⚠️ APRÈS CHAQUE papier, jamais seulement en fin de boucle : un run tué au mur des 6 min
    // ne passe pas par la fin, et ses minutes échapperaient au budget du jour (revue #418).
    if (opts.manuel) return;
    try { props.setProperty('DriveAI_AUDIT_PIECE_JOUR_MS', aujourdhui + '|' + (consommeJour + (Date.now() - debut))); }
    catch (e) { /* le budget est relu au tick suivant ; jamais bloquant */ }
  };

  for (i = 0; i < valeurs.length; i++) {
    if (valeurs[i][COL_STATUT_AUDIT_VISION] !== 'à faire') continue;
    if ((garde && garde()) || Date.now() - debut > plafond) { res.fin = 'budget'; break; }
    var doc = { fileId: String(valeurs[i][1]), nom: String(valeurs[i][2]), domaine: String(valeurs[i][3]),
                chemin: String(valeurs[i][COL_CHEMIN_AUDIT_VISION] || '') };
    var essais = Number(valeurs[i][COL_ESSAIS_AUDIT_VISION]) || 0;
    var envoi;
    if (essais >= AUDIT_VISION_ESSAIS_MAX) {
      envoi = { motif: 'essais-epuises', vision: { motif: 'essais-epuises' } };
    } else {
      // ⚠️ L'essai se compte AVANT l'appel : un run tué pendant l'appel ne passe pas par la
      // suite, et c'est justement le cas qui re-paie.
      f.getRange(i + 2, COL_ESSAIS_AUDIT_VISION + 1).setValue(essais + 1);
      try {
        var fichier = DriveApp.getFileById(doc.fileId);
        envoi = pousserPieceApresClassement_(
          { cle: '' },
          { nom: doc.nom, domaine: doc.domaine, statut: 'classé', chemin: doc.chemin, fileId: doc.fileId },
          '', { vision: { fichier: fichier }, manuel: !!opts.manuel });
      } catch (e) {
        journalErreur_('AuditVision', 'Lecture impossible : ' + e);
        envoi = { motif: 'lecture-impossible', vision: { motif: 'lecture-impossible' } };
      }
      // Une panne de CANAL posée AVANT tout appel (jeton, frein, suspension) n'a rien coûté :
      // elle rend son essai, sinon trois ticks de jeton refusé épuiseraient les vingt lignes.
      if (!envoi.vision) f.getRange(i + 2, COL_ESSAIS_AUDIT_VISION + 1).setValue(essais);
    }
    var issue = issueAuditVision_(envoi);
    if (issue === 'plafond') { res.fin = 'budget'; noterJour(); break; }
    if (issue === 'panne') { res.fin = 'canal'; noterJour(); break; }
    var cellules = cellulesAuditVision_(envoi, new Date().toISOString().slice(0, 16).replace('T', ' '));
    f.getRange(i + 2, COL_STATUT_AUDIT_VISION + 1, 1, cellules.length).setValues([cellules]);
    if (cellules[0] === 'fait') res.faits++; else res.echecs++;
    if (envoi.vision && envoi.vision.usage) res.dollars += coutVisionDollars_(envoi.vision.usage);
    restants--;
    noterJour();

    var mv = String((envoi.vision && envoi.vision.motif) || '');
    if (issue === 'echec' && VERDICTS_SERIE_VISION.indexOf(mv) !== -1) {
      if (serie.motif !== mv) serie = { motif: mv, lignes: [] };
      serie.lignes.push(i);
      if (serie.lignes.length >= AUDIT_VISION_SERIE_MAX) {
        // Les marques de la série se RETIRENT : si la cause est commune, aucune n'est une mesure.
        // Les essais restent comptés — c'est ce qui empêche la série de se rejouer sans fin.
        var vide = ['à faire'];
        while (vide.length < cellules.length) vide.push('');
        for (var k = 0; k < serie.lignes.length; k++) {
          f.getRange(serie.lignes[k] + 2, COL_STATUT_AUDIT_VISION + 1, 1, vide.length).setValues([vide]);
        }
        res.echecs -= serie.lignes.length;
        restants += serie.lignes.length;
        res.fin = 'serie';
        journalErreur_('AuditVision', AUDIT_VISION_SERIE_MAX + ' échecs « ' + mv + ' » d\'affilée : '
          + 'cause commune probable — rien n\'est marqué, reprise au tick suivant.');
        break;
      }
    } else {
      serie = { motif: '', lignes: [] };
    }
  }
  res.restants = restants;
  noterJour();
  return noterFinAuditVision_(props, res);
}

/**
 * ⚠️ LE CHEMIN MANUEL, pour la raison de C28-137 : un `opts` que personne ne passe est une
 * intention jamais livrée. Il ignore le budget QUOTIDIEN, jamais le jeton, la suspension, la
 * panne ni le frein en dollars.
 */
function auditerVisionMaintenant() {
  reinitialiserUsage_();
  try {
    var res = etapeAuditVision_(null, { manuel: true });
    Logger.log(texteSanteAuditVision_() + ' — ' + JSON.stringify(res));
  } finally {
    try { flushUsage_(); } catch (e) { /* la comptabilité ne doit pas masquer le résultat */ }
  }
}
