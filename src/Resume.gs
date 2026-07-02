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
 * Compte les lignes d'Index des `jours` derniers jours, par statut — et COLLECTE (chantiers
 * #13-#14) les actions/RDV créés (`actions`, plafonnées à `RESUME_ACTIONS_MAX`) et les mails
 * importants (`aTraiter`, plafonnés à `RESUME_IMPORTANTS_MAX`, lien Gmail reconstruit depuis la
 * clé `important|<messageId>`). Les totaux (`actionsTotal`/`aTraiterTotal`) permettent au mail
 * d'afficher « … et N de plus » sans jamais grossir sans borne.
 * @param {number} jours
 * @return {{classe:number, tache:number, evenement:number, mailsSansAction:number,
 *           mailsAvecAction:number, doublon:number, technique:number, media:number,
 *           quarantaine:number, importants:number, autres:number, total:number,
 *           actions:{type:string, titre:string}[], actionsTotal:number,
 *           aTraiter:{sujet:string, messageId:string}[], aTraiterTotal:number}}
 */
function statsSemaine_(jours) {
  var s = {
    classe: 0, tache: 0, evenement: 0, mailsSansAction: 0, mailsAvecAction: 0, doublon: 0,
    technique: 0, media: 0, quarantaine: 0, importants: 0, autres: 0, total: 0,
    actions: [], actionsTotal: 0, aTraiter: [], aTraiterTotal: 0
  };
  var f = feuille_('Index');
  var fen = fenetreLecture_(f);
  if (!fen) return s;
  var seuil = Date.now() - jours * 24 * 60 * 60 * 1000;
  var v = f.getRange(fen.debut, 1, fen.nb, 6).getValues(); // A..F : Clé, Traité le, Fichier, Domaine, Chemin, Statut
  for (var i = 0; i < v.length; i++) {
    var d = v[i][1];
    if (!(d instanceof Date) || d.getTime() < seuil) continue;
    s.total++;
    var statut = String(v[i][5]);
    if (statut === 'classé') s.classe++;
    else if (statut === 'tache' || statut === 'evenement') {
      if (statut === 'tache') s.tache++; else s.evenement++;
      s.actionsTotal++;
      if (s.actions.length < CONFIG.RESUME_ACTIONS_MAX) {
        s.actions.push({ type: statut, titre: String(v[i][2]) });
      }
    }
    else if (statut === 'doublon') s.doublon++;
    else if (statut === 'technique') s.technique++;
    else if (statut === 'média') s.media++;
    else if (statut === 'quarantaine') s.quarantaine++;
    else if (statut === 'important') {
      s.importants++;
      s.aTraiterTotal++;
      if (s.aTraiter.length < CONFIG.RESUME_IMPORTANTS_MAX) {
        s.aTraiter.push({ sujet: String(v[i][2]), messageId: String(v[i][0]).split('|')[1] || '' });
      }
    }
    else if (statut === 'intention-traitee') s.mailsAvecAction++; // mail AVEC action créée (≠ sans action)
    else if (statut.indexOf('intention-') === 0) s.mailsSansAction++;
    else s.autres++; // zone protégée (migration), compat historiques
  }
  return s;
}

/**
 * Lien Gmail d'un message (le résumé est lu dans le compte de Marc — `#all` couvre aussi
 * les mails archivés). PUR.
 * @param {string} messageId
 * @return {string}
 */
function lienGmail_(messageId) {
  return 'https://mail.google.com/mail/#all/' + messageId;
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
    '✅ Tâches créées (Google Tasks) : ' + s.tache,
    '📅 Événements créés (Google Calendar) : ' + s.evenement,
    '✉️ Mails analysés — avec action : ' + s.mailsAvecAction + ' · sans action : ' + s.mailsSansAction,
    '🔁 Doublons écartés (_Doublons) : ' + s.doublon,
    '🗂️ Fichiers techniques (_Technique) : ' + s.technique,
    '📸 Médias personnels (_Médias) : ' + s.media,
    '🚫 Mis en quarantaine (échecs répétés) : ' + s.quarantaine,
    '📦 Autres (zone protégée, historiques) : ' + s.autres,
    '⚠️ Erreurs journalisées : ' + erreurs
  ];

  // Chantier #14 (ADR-0010 §3) — mails qui demandent l'attention de Marc, EN TÊTE des détails
  // (c'est la seule section actionnable). Plafonnée (anti-bruit) ; lien direct vers le mail.
  if (s.aTraiter && s.aTraiter.length) {
    lignes.push('', '📌 À traiter — mails importants (question directe, échéance, officiel) :');
    for (var i = 0; i < s.aTraiter.length; i++) {
      lignes.push('   • ' + s.aTraiter[i].sujet + (s.aTraiter[i].messageId ?
        ' — ' + lienGmail_(s.aTraiter[i].messageId) : ''));
    }
    if (s.aTraiterTotal > s.aTraiter.length) {
      lignes.push('   … et ' + (s.aTraiterTotal - s.aTraiter.length) + ' de plus (onglet Index, statut « important »).');
    }
  }

  // Chantier #13 (ADR-0010 §2) — la Phase 3 devient VISIBLE : ce qui a été créé, nommément.
  if (s.actions && s.actions.length) {
    lignes.push('', '🗓️ Actions & RDV détectés (créés dans Tasks/Calendar) :');
    for (var k = 0; k < s.actions.length; k++) {
      lignes.push('   ' + (s.actions[k].type === 'evenement' ? '📅' : '✅') + ' ' + s.actions[k].titre);
    }
    if (s.actionsTotal > s.actions.length) {
      lignes.push('   … et ' + (s.actionsTotal - s.actions.length) + ' de plus.');
    }
  }

  lignes.push(
    '',
    '💰 Coût LLM ce mois-ci : ~' + cout.dollars.toFixed(2) + ' $ (' +
      cout.appels + ' appels — cible < 10 $/mois)',
    '',
    'Détail complet dans la Google Sheet « DriveAI — État » (onglets Index / Journal / Entités / Santé).'
  );
  // Lien vers le formulaire de correction (ADR-0003) : Marc apprend à DriveAI où ranger un émetteur.
  if (urlForm) {
    lignes.push('', '✏️ Corriger un classement (DriveAI apprend) : ' + urlForm);
  }
  return lignes.join('\n');
}
