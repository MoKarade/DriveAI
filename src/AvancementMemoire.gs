/**
 * AvancementMemoire.gs — DriveAI publie ses COMPTES à la Mémoire (ADR 0009 de MemoryAI, C49-27).
 *
 * Marc, le 23/09 : une interface « Avancement » DANS la Mémoire, comme celle de l'app DriveAI.
 * La Mémoire sait ce qu'elle a reçu et lu ; elle ne sait rien de ce que DriveAI a CLASSÉ, ENVOYÉ,
 * ni du dossier où il lit en ce moment. Et elle ne détient AUCUN jeton (son ADR 0001) : elle ne
 * peut pas venir le lire. C'est donc DriveAI qui pousse, à `POST /api/avancement`.
 *
 * ⚠️ DES NOMBRES, JAMAIS DU TEXTE. Le contrat d'en face est `.strict()` et n'accepte que des
 * comptes, des dates `AAAA-MM-JJ`, des codes de dossier à deux chiffres, un tag et un
 * horodatage. Aucun nom de fichier ne part d'ici — ni d'ailleurs aucun libellé de dossier : la
 * Mémoire pose les siens. Tout ce qui est envoyé est DÉJÀ en Properties ou dans `HistoriqueImport`.
 *
 * ⚠️ « PAS MESURÉ » PART EN `null`, JAMAIS EN ZÉRO. Un périmètre jamais recompté, un envoi jamais
 * fait : l'écran d'en face dit « non mesuré ». Un zéro y dirait « rien n'a été classé ».
 *
 * ⚠️ AU PLUS TOUTES LES 30 MIN (`CONFIG.MEMOIRE_COMPTES_MIN_MS`, la même cadence que la lecture
 * de `/api/etat`, et pour la même raison). Et comme elle, AUCUN `*_BUDGET_JOUR_MS` : un appel
 * réseau de ~1 s, 48 fois par jour au plus, sans lecture Drive ni appel de modèle — moins d'une
 * minute par jour. Lui prélever une minute ailleurs coûterait cette minute à une campagne qui la
 * DÉPENSE vraiment. La décision est écrite ici plutôt que constatée par un invariant aveugle.
 *
 * ⚠️ L'HORODATAGE DE TENTATIVE SE POSE AVANT L'APPEL : une Mémoire injoignable ne se re-sonde pas
 * à chaque tick. Et une panne n'écrase jamais la dernière réussite : le motif est publié à côté.
 */

/** Le seul format de date que le contrat accepte. PURE. Rend `null` si illisible. */
function jourAvancement_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    var m = v.getMonth() + 1, j = v.getDate();
    return v.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (j < 10 ? '0' + j : j);
  }
  var s = String(v == null ? '' : v).trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Un compte entier ≥ 0, ou `null`. PURE. ⚠️ Jamais `|| 0` : une valeur absente reste absente. */
function compteAvancement_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return (isFinite(n) && n >= 0 && Math.floor(n) === n) ? n : null;
}

/**
 * PURE. Les documents CLASSÉS, depuis la chaîne du périmètre (`encoderPerimetrePiece_`).
 * `null` si jamais mesuré — c'est la vérité, et l'écran d'en face la dit.
 */
function classesAvancement_(brutPerimetre) {
  if (!brutPerimetre) return null;
  var p = String(brutPerimetre).split('|');
  var c = String(p[2] || '').split('/'); // candidats/classees/lues
  var candidats = compteAvancement_(c[0]);
  var lignes = compteAvancement_(c[2]);
  if (candidats === null || lignes === null) return null;
  var distincts = compteAvancement_(p[8]);
  return {
    lignes: lignes,
    // ⚠️ `0` distincts n'est pas une mesure plausible sur un Index qui a des lignes : c'est le
    // champ d'une version qui ne le comptait pas. `null`, donc « pas encore recompté ».
    distincts: (distincts === null || distincts === 0) ? null : distincts,
    sansFileId: compteAvancement_(p[6]) || 0,
    candidats: candidats
  };
}

/**
 * PURE. La file de lecture par dossier, depuis `DriveAI_PIECE_FILE` (`04:0/48·05:528/531`).
 * Le dossier EN COURS est le premier qui a encore du reste — la même règle que la Santé.
 */
function fileAvancement_(brutFile) {
  var out = [];
  var parts = String(brutFile == null ? '' : brutFile).split('·');
  var enCoursPose = false;
  for (var i = 0; i < parts.length && out.length < 12; i++) {
    var m = /^(\d{2}):(\d+)\/(\d+)$/.exec(String(parts[i]).trim());
    if (!m) continue;
    var restants = Number(m[2]), tranche = Number(m[3]);
    var enCours = !enCoursPose && restants > 0;
    if (enCours) enCoursPose = true;
    out.push({ code: m[1], lus: Math.max(0, tranche - restants), restants: restants, enCours: enCours });
  }
  return out;
}

/**
 * PURE. Les jours de `HistoriqueImport` (Date, Restants, Extraits, Acceptés, Illisibles,
 * Sans texte, Échecs, Tag), au format du contrat. Les 60 plus récents ; une ligne illisible est
 * SAUTÉE plutôt que de faire refuser tout l'envoi par le schéma d'en face.
 */
function joursAvancement_(lignes) {
  var out = [];
  for (var i = 0; i < (lignes || []).length; i++) {
    var l = lignes[i];
    var jour = jourAvancement_(l[0]);
    var tag = String(l[7] == null ? '' : l[7]).trim();
    if (!jour || !/^[a-z0-9-]{1,32}$/.test(tag)) continue;
    var champs = [compteAvancement_(l[2]), compteAvancement_(l[3]), compteAvancement_(l[4]),
      compteAvancement_(l[5]), compteAvancement_(l[6])];
    if (champs.indexOf(null) !== -1) continue;
    out.push({
      jour: jour,
      restants: compteAvancement_(l[1]),
      extraits: champs[0], acceptes: champs[1], illisibles: champs[2], sansTexte: champs[3],
      echecs: champs[4], tag: tag
    });
  }
  return out.slice(-60);
}

/** PURE. Le corps envoyé. */
function corpsAvancement_(brutPerimetre, emis, brutFile, lignesHisto, maintenantMs) {
  var envoyes = compteAvancement_(emis);
  return {
    version: 1,
    mesureLe: new Date(maintenantMs).toISOString(),
    classes: classesAvancement_(brutPerimetre),
    envoi: envoyes === null ? null : { acceptes: envoyes },
    fileLecture: fileAvancement_(brutFile),
    joursLus: joursAvancement_(lignesHisto)
  };
}

/** PURE. La ligne de Santé, depuis `DriveAI_AVANCEMENT_ENVOI` (`<ISO min>|ok` ou `<ISO min>|!motif`). */
function ligneAvancementMemoire_(brut) {
  var s = String(brut == null ? '' : brut).trim();
  if (!s) return 'jamais envoyé — la Mémoire n\'a pas encore reçu les comptes de DriveAI';
  var i = s.indexOf('|');
  var quand = i === -1 ? '?' : s.slice(0, i).replace('T', ' ');
  var motif = i === -1 ? s : s.slice(i + 1);
  if (motif === 'ok') return 'comptes envoyés le ' + quand + ' UTC';
  return 'envoi en échec le ' + quand + ' UTC — ' + motif.replace(/^!/, '');
}

/**
 * Pousse les comptes si l'espacement est écoulé. Impure, JAMAIS bloquante.
 * Le canal éteint (`MEMOIRE_PUSH` faux) ou sans jeton ne pousse rien.
 */
function pousserAvancementMemoire_(props, maintenantMs) {
  if (!CONFIG.MEMOIRE_PUSH) return;
  var jeton = props.getProperty('DriveAI_MEMORYAI_TOKEN');
  if (!jeton) return;
  if (!comptesMemoireARelire_(props.getProperty('DriveAI_AVANCEMENT_ENVOYE_LE'),
                              maintenantMs, CONFIG.MEMOIRE_COMPTES_MIN_MS)) return;
  props.setProperty('DriveAI_AVANCEMENT_ENVOYE_LE', String(maintenantMs));
  var quand = new Date(maintenantMs).toISOString().slice(0, 16);

  var lignes = [];
  try {
    var f = feuille_('HistoriqueImport');
    var dern = f ? f.getLastRow() : 1;
    if (dern >= 2) {
      var debut = Math.max(2, dern - 59);
      lignes = f.getRange(debut, 1, dern - debut + 1, 8).getValues();
    }
  } catch (e) {
    lignes = []; // la série manque : l'envoi part quand même, l'écran dira « pas de série »
  }
  var corps = corpsAvancement_(props.getProperty('DriveAI_PERIMETRE_PIECE'),
    props.getProperty('DriveAI_MEMOIRE_EMIS'), props.getProperty('DriveAI_PIECE_FILE'), lignes, maintenantMs);

  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/avancement';
  var rep;
  try {
    rep = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + jeton },
      payload: JSON.stringify(corps),
      muteHttpExceptions: true
    });
  } catch (e) {
    props.setProperty('DriveAI_AVANCEMENT_ENVOI', quand + '|!réseau');
    return;
  }
  var code = rep.getResponseCode();
  if (code === 200) { props.setProperty('DriveAI_AVANCEMENT_ENVOI', quand + '|ok'); return; }
  // ⚠️ Le CODE, et pour un 422 les CHAMPS refusés : « le contrat a bougé » se corrige dans un
  // dépôt précis, et « erreur » n'envoie nulle part. Les valeurs ne reviennent jamais en écho.
  var detail = '';
  if (code === 422) {
    try {
      var r = JSON.parse(rep.getContentText());
      detail = r.error === 'version_inconnue' ? ' (la Mémoire ne lit pas encore ce format)'
        : ' (champs : ' + (r.champs || []).slice(0, 5).join(', ') + ')';
    } catch (e) { detail = ''; }
  }
  props.setProperty('DriveAI_AVANCEMENT_ENVOI', quand + '|!HTTP ' + code + detail);
}

/** La ligne de Santé. Impure ; la mise en forme est {@link ligneAvancementMemoire_}. */
function texteSanteAvancementMemoire_() {
  try {
    var props = PropertiesService.getScriptProperties();
    pousserAvancementMemoire_(props, Date.now());
    return ligneAvancementMemoire_(props.getProperty('DriveAI_AVANCEMENT_ENVOI'));
  } catch (e) {
    return 'état illisible (' + e + ')';
  }
}
