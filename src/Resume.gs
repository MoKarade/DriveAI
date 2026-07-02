/**
 * Resume.gs — Résumé hebdomadaire automatique envoyé à Marc, Phase 1+.
 *
 * Donne de la visibilité sur un moteur devenu très autonome (classement, tâches/agenda,
 * rangement) SANS que Marc ait à aller fouiller la Sheet ou les dossiers : un mail récap
 * une fois par semaine (déclencheur `resumeHebdo`, auto-installé — cf. Main.assurerTriggerResume_).
 *
 * Lecture SEULE de l'état (Index/Journal) + coût mesuré (Cout.gs). Envoi à soi-même via le
 * scope `script.send_mail` déjà accordé — aucun nouveau scope. Échec = dégradation propre.
 */

/** Point d'entrée du déclencheur hebdomadaire. */
function resumeHebdo() {
  try {
    var jours = CONFIG.RESUME_JOURS;
    var stats = statsSemaine_(jours);
    var erreurs = erreursSemaine_(jours);
    var cout = syntheseCoutMois_();
    var dernierTick = Number(PropertiesService.getScriptProperties().getProperty('DriveAI_LAST_TICK')) || 0;
    var etat = etatSysteme_(dernierTick, Date.now(), CONFIG.WATCHDOG_SEUIL_MS);
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      '[DriveAI] Résumé de la semaine',
      construireResume_(stats, erreurs, cout, jours, etat, urlFormulaireCorrection_())
    );
    journalInfo_('Résumé', 'Résumé hebdo envoyé.');
  } catch (e) {
    notifierEchec_('Résumé', 'Envoi du résumé hebdo impossible : ' + e);
  }
}

/**
 * Indices de début/nombre de lignes pour ne lire QUE les `RESUME_MAX_LIGNES` dernières lignes
 * de données d'un onglet (le Journal grossit vite — la lecture hebdo reste ainsi insensible à la
 * croissance de l'historique ; la borne dépasse largement une semaine d'un usage personnel).
 * @param {Sheet} f
 * @return {?{debut:number, nb:number}} null si l'onglet n'a pas de données.
 */
function fenetreLecture_(f) {
  var dern = f.getLastRow();
  if (dern < 2) return null;
  var debut = Math.max(2, dern - CONFIG.RESUME_MAX_LIGNES + 1);
  return { debut: debut, nb: dern - debut + 1 };
}

/**
 * Compte les lignes d'Index des `jours` derniers jours, par statut.
 * @param {number} jours
 * @return {{classe:number, revue:number, tache:number, evenement:number,
 *           mailsSansAction:number, autres:number, total:number}}
 */
function statsSemaine_(jours) {
  var s = { classe: 0, revue: 0, tache: 0, evenement: 0, mailsSansAction: 0, doublon: 0, quarantaine: 0, autres: 0, total: 0 };
  var f = feuille_('Index');
  var fen = fenetreLecture_(f);
  if (!fen) return s;
  var seuil = Date.now() - jours * 24 * 60 * 60 * 1000;
  var v = f.getRange(fen.debut, 2, fen.nb, 5).getValues(); // B..F : Traité le, Fichier, Domaine, Chemin, Statut
  for (var i = 0; i < v.length; i++) {
    var d = v[i][0];
    if (!(d instanceof Date) || d.getTime() < seuil) continue;
    s.total++;
    var statut = String(v[i][4]);
    if (statut === 'classé') s.classe++;
    else if (statut === 'revue') s.revue++;
    else if (statut === 'tache') s.tache++;
    else if (statut === 'evenement') s.evenement++;
    else if (statut === 'doublon') s.doublon++;
    else if (statut === 'quarantaine') s.quarantaine++;
    else if (statut.indexOf('intention-') === 0) s.mailsSansAction++;
    else s.autres++;
  }
  return s;
}

/**
 * Compte les lignes ERREUR du Journal sur les `jours` derniers jours.
 * @param {number} jours
 * @return {number}
 */
function erreursSemaine_(jours) {
  var f = feuille_('Journal');
  var fen = fenetreLecture_(f);
  if (!fen) return 0;
  var seuil = Date.now() - jours * 24 * 60 * 60 * 1000;
  var v = f.getRange(fen.debut, 1, fen.nb, 2).getValues(); // A=Horodatage, B=Niveau
  var n = 0;
  for (var i = 0; i < v.length; i++) {
    if (v[i][0] instanceof Date && v[i][0].getTime() >= seuil && v[i][1] === 'ERREUR') n++;
  }
  return n;
}

/**
 * État du système pour le résumé hebdo (ADR-0004 point 4), dérivé du heartbeat. Logique PURE (testée).
 * @param {number} dernierTickMs  heartbeat (0 = jamais écrit)
 * @param {number} maintenant     ms
 * @param {number} seuil          ms de silence au-delà duquel le moteur est « silencieux »
 * @return {string}
 */
function etatSysteme_(dernierTickMs, maintenant, seuil) {
  if (!dernierTickMs) return '❔ démarrage (heartbeat pas encore écrit)';
  var minutes = Math.max(0, Math.round((maintenant - dernierTickMs) / 60000));
  if ((maintenant - dernierTickMs) <= seuil) return '🟢 actif (dernier passage il y a ' + minutes + ' min)';
  return '🔴 silencieux depuis ' + minutes + ' min — le chien de garde répare / t\'a alerté';
}

/** Corps du mail récap. */
function construireResume_(s, erreurs, cout, jours, etat, urlForm) {
  var lignes = [
    'Voici ce que DriveAI a fait cette semaine (' + jours + ' derniers jours).',
    '',
    '🩺 État du système : ' + (etat || '—'),
    '',
    '📂 Documents classés automatiquement : ' + s.classe,
    '🔎 Partis en revue (00 · À vérifier) : ' + s.revue,
    '✅ Tâches créées (Google Tasks) : ' + s.tache,
    '📅 Événements créés (Google Calendar) : ' + s.evenement,
    '✉️ Mails analysés sans action : ' + s.mailsSansAction,
    '🔁 Doublons écartés (dossier _Doublons) : ' + s.doublon,
    '🚫 Mis en quarantaine (échecs répétés) : ' + s.quarantaine,
    '⚠️ Erreurs journalisées : ' + erreurs,
    '',
    '💰 Coût LLM ce mois-ci : ~' + cout.dollars.toFixed(2) + ' $ (' +
      cout.appels + ' appels — cible < 10 $/mois)',
    '',
    'Détail complet dans la Google Sheet « DriveAI — État » (onglets Index / Journal / Revue).'
  ];
  // Lien vers le formulaire de correction (ADR-0003) : Marc apprend à DriveAI où ranger un émetteur.
  if (urlForm) {
    lignes.push('', '✏️ Corriger un classement (DriveAI apprend) : ' + urlForm);
  }
  return lignes.join('\n');
}
