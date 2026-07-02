/**
 * Intentions.gs — Détection d'actions/rendez-vous dans TOUS les mails récents → Google
 * Tasks / Google Calendar, Phase 3 (remplace l'agent externe de Marc).
 *
 * Pipeline par MESSAGE (pas par PJ) : pré-filtre (Prefiltre.gs, gratuit → mini-check LLM
 * peu coûteux) → extraction complète (Llm.extraireIntentions_, Haiku) → création 100 %
 * automatique (Tasks.gs / Calendar.gs), idempotente via l'Index existant.
 *
 * Idempotence à deux niveaux :
 *   - clé `intention|<messageId>` : ce message a été ENTIÈREMENT traité (posée seulement
 *     quand TOUTES ses intentions ont été créées ou l'étaient déjà — sinon le message est
 *     ré-analysé au tick suivant, ce qui ne re-crée PAS les intentions déjà indexées) ;
 *   - clé `tache|<messageId>|<hash>` / `event|<messageId>|<hash>` : une intention précise.
 *     Pour un événement, en plus, un ID client déterministe est passé à l'API Calendar
 *     (rejeu après coupure → 409 « déjà créé », traité comme un succès, jamais de doublon).
 *     Google Tasks n'offre pas d'ID client : le risque résiduel (coupure pile entre la
 *     création et l'écriture Index) est le même compromis déjà accepté pour la copie Gmail
 *     (cf. HANDOVER « limites assumées », Index en dernier).
 *
 * Garde-fou §1 (zone protégée) en DÉFENSE EN PROFONDEUR : `toucheZoneProtegee_` est vérifié
 * AVANT tout appel LLM (expéditeur/sujet/corps) ET le prompt lui-même l'impose — jamais une
 * tâche/événement créé depuis un mail immigration/fiscal, indépendamment du LLM.
 */

/**
 * Parcourt TOUS les mails récents, bornés par run et par garde-temps.
 *
 * Deux scans complémentaires (un offset numérique seul NE SUFFIT PAS : la fenêtre `newer_than:30d`
 * est MOUVANTE — un nouveau mail s'insère en tête et décale tous les offsets suivants — donc
 * redémarrer à l'offset 0 à chaque tick fait re-balayer indéfiniment le même mail déjà indexé
 * sans jamais progresser dans l'historique au-delà du plafond/run) :
 *   1. `balayerNouveauxMails_` — TOUJOURS depuis le début (offset 0) : c'est là qu'apparaît le
 *      mail récemment arrivé. S'arrête tôt dès qu'une page ENTIÈRE est déjà indexée (mur de mail
 *      déjà vu) — typiquement 1-2 pages en régime permanent, donc peu coûteux.
 *   2. `balayerArriereHistorique_` — rattrapage du reste de l'historique (30 jours), ancré sur
 *      une DATE ABSOLUE persistée (`DriveAI_INTENTIONS_AVANT`), jamais un offset — avance
 *      strictement vers le passé à chaque tick, insensible à l'arrivée de nouveaux mails en tête.
 * @param {function():boolean} estBudgetDepasse
 */
function traiterIntentionsMail_(estBudgetDepasse) {
  var etat = { analyses: 0, creations: 0 };
  var plafondAtteint = function () {
    return estBudgetDepasse() || etat.analyses >= CONFIG.INTENTIONS_MAX_PAR_RUN ||
      etat.creations >= CONFIG.CREATIONS_MAX_PAR_RUN;
  };

  balayerNouveauxMails_(etat, plafondAtteint);
  if (!plafondAtteint()) balayerArriereHistorique_(etat, plafondAtteint);
}

/**
 * Scan « avant » : pages successives depuis l'offset 0, tant qu'il reste du budget. S'arrête dès
 * qu'une page entière ne contient QUE des messages déjà indexés (mur de mail déjà vu — au-delà,
 * c'est `balayerArriereHistorique_` qui progresse dans l'historique, pas ce scan).
 * @param {{analyses:number, creations:number}} etat  muté en place
 * @param {function():boolean} plafondAtteint
 */
function balayerNouveauxMails_(etat, plafondAtteint) {
  var debutPage = 0;
  while (!plafondAtteint()) {
    var fils;
    try {
      fils = pageFilsActions_(debutPage);
    } catch (e) {
      notifierEchec_('Intentions', 'Recherche des mails (actions/rdv) impossible : ' + e);
      return;
    }
    if (!fils.length) return; // fin de la fenêtre 30 jours

    var pageEntierementIndexee = true;
    for (var i = 0; i < fils.length; i++) {
      var messages = fils[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        if (plafondAtteint()) {
          journalInfo_('Intentions', 'Budget/plafond atteint (mail récent) — reprise au prochain tick.');
          return;
        }
        if (!indexContient_('intention|' + messages[m].getId())) pageEntierementIndexee = false;
        etat.analyses++;
        etat.creations += traiterMessagePourIntentions_(messages[m]);
      }
    }
    if (pageEntierementIndexee) return; // mur de mail déjà vu → laisse la main au scan arrière
    debutPage += CONFIG.PAGE_FILS_ACTIONS;
  }
}

/**
 * Scan « arrière » : rattrape l'historique jamais vu, ancré sur une date ABSOLUE persistée
 * (Script Property `DriveAI_INTENTIONS_AVANT`, format Gmail `before:` AAAA/MM/JJ). Avance
 * strictement vers le passé à chaque lot traité ; quand la requête ne renvoie plus rien,
 * l'historique des 30 jours est entièrement rattrapé (le scan avant suffit alors pour le reste).
 *
 * Limite assumée (granularité jour de `before:`) : si plus d'un lot de messages partage le jour
 * exact où le curseur s'arrête, de très rares messages de ce jour-là pourraient ne jamais être
 * couverts. Risque résiduel mineur et borné dans le temps (un seul jour, une seule fois par
 * rattrapage initial) — comparable aux autres limites assumées du projet (cf. HANDOVER).
 * @param {{analyses:number, creations:number}} etat
 * @param {function():boolean} plafondAtteint
 */
function balayerArriereHistorique_(etat, plafondAtteint) {
  var props = PropertiesService.getScriptProperties();

  while (!plafondAtteint()) {
    var avant = props.getProperty('DriveAI_INTENTIONS_AVANT');
    var requete = CONFIG.GMAIL_REQUETE_ACTIONS + (avant ? ' before:' + avant : '');

    var fils;
    try {
      fils = GmailApp.search(requete, 0, CONFIG.PAGE_FILS_ACTIONS);
    } catch (e) {
      notifierEchec_('Intentions', 'Recherche de l\'historique (actions/rdv) impossible : ' + e);
      return;
    }
    if (!fils.length) return; // historique des 30 jours entièrement rattrapé

    var plusAncienne = null;
    for (var i = 0; i < fils.length; i++) {
      var messages = fils[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        if (plafondAtteint()) {
          if (plusAncienne) avancerCurseurHistorique_(props, plusAncienne);
          journalInfo_('Intentions', 'Budget/plafond atteint (historique) — reprise au prochain tick.');
          return;
        }
        var date = messages[m].getDate();
        if (!plusAncienne || date < plusAncienne) plusAncienne = date;
        etat.analyses++;
        etat.creations += traiterMessagePourIntentions_(messages[m]);
      }
    }
    if (plusAncienne) avancerCurseurHistorique_(props, plusAncienne);
  }
}

/**
 * Avance le curseur d'historique vers le PASSÉ uniquement (jamais en arrière), au format
 * Gmail `before:` (AAAA/MM/JJ).
 * @param {Properties} props
 * @param {Date} datePlusAncienne
 */
function avancerCurseurHistorique_(props, datePlusAncienne) {
  var f = Utilities.formatDate(datePlusAncienne, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  props.setProperty('DriveAI_INTENTIONS_AVANT', f);
}

/**
 * Traite un message : pré-filtre → extraction → création idempotente.
 * @param {GmailMessage} message
 * @return {number} nombre de tâches/événements RÉELLEMENT créés (pour le plafond/run).
 */
function traiterMessagePourIntentions_(message) {
  var messageId = message.getId();
  var cleMessage = 'intention|' + messageId;
  if (indexContient_(cleMessage)) return 0; // déjà entièrement traité

  var expediteur = message.getFrom() || '';
  var sujet = message.getSubject() || '';

  // Étage 1 (gratuit) : mots-clés évidents (newsletter, notif...) → écarté, jamais ré-analysé.
  if (ecarteParMotsCles_(expediteur, sujet)) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0;
  }
  // Garde-fou §1, AVANT tout appel LLM : zone protégée sur expéditeur/sujet seuls.
  if (toucheZoneProtegee_(expediteur + ' ' + sujet)) {
    indexAjouter_(cleMessage, { statut: 'intention-zone-protegee', nom: sujet });
    return 0;
  }
  // Étage 3 (mini-check Haiku, peu coûteux) : deux signaux en un appel (#14).
  var check = miniCheckMail_(expediteur, sujet);
  // Mail IMPORTANT (question directe, échéance, officiel) → ligne Index dédiée, consommée par le
  // résumé hebdo (« À traiter »). AVANT le tri action/pas-action : un mail important sans action
  // créable (question ouverte) doit quand même remonter. Jamais pour un mail en zone protégée
  // (les gardes ci-dessus l'ont déjà écarté) ni pour un message déjà indexé `intention|` avant
  // ce chantier (l'idempotence saute le mini-check — le flag ne vaut que pour l'avenir).
  if (check.important) marquerMailImportant_(messageId, sujet);
  if (!check.action) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0;
  }

  var corps;
  try {
    corps = tronquer_(message.getPlainBody(), CONFIG.LLM_CORPS_MAX_CARS);
  } catch (e) {
    corps = '';
  }
  // Garde-fou §1, défense en profondeur : re-vérifie sur le corps complet avant extraction.
  if (toucheZoneProtegee_(corps)) {
    indexAjouter_(cleMessage, { statut: 'intention-zone-protegee', nom: sujet });
    return 0;
  }

  var intentions = extraireIntentions_({ expediteur: expediteur, sujet: sujet, corps: corps });
  if (intentions === null) {
    // Échec LLM total : on NE marque PAS le message fait → re-tenté au prochain tick.
    notifierEchec_('Intentions', 'Extraction impossible pour « ' + sujet + ' »');
    return 0;
  }
  if (!intentions.length) {
    indexAjouter_(cleMessage, { statut: 'intention-aucune', nom: sujet });
    return 0;
  }

  var creees = 0, toutReussi = true;
  for (var k = 0; k < intentions.length; k++) {
    var r = creerIntentionIdempotente_(messageId, intentions[k]);
    if (r === 'creee') creees++;
    else if (r === 'echec') toutReussi = false;
    // r === 'deja-faite' : ni création ni échec, déjà indexée par un run précédent.
  }
  // Le message n'est marqué « fait » que si TOUTES ses intentions sont créées (ou l'étaient
  // déjà) : un échec partiel laisse le message en reprise, sans recréer les sous-clés réussies.
  if (toutReussi) indexAjouter_(cleMessage, { statut: 'intention-traitee', nom: sujet });
  return creees;
}

/**
 * Crée UNE intention si elle n'est pas déjà indexée. Idempotente :
 *   - événement → ID client déterministe (rejeu après coupure → 409, traité comme succès) ;
 *   - tâche → pas d'ID client côté API Tasks (limite assumée, cf. en-tête de fichier).
 * @param {string} messageId
 * @param {{type:string, titre:string, date:?string, heure:?string, confiance:number}} intention
 * @return {string} 'creee' | 'deja-faite' | 'echec'
 */
function creerIntentionIdempotente_(messageId, intention) {
  var hashContenu = hashHex_(intention.titre + '|' + (intention.date || '') + '|' + (intention.heure || ''));
  var prefixe = intention.type === 'evenement' ? 'event|' : 'tache|';
  var cle = prefixe + messageId + '|' + hashContenu;
  if (indexContient_(cle)) return 'deja-faite';

  var id;
  if (intention.type === 'evenement') {
    // ID client Calendar : DOIT inclure messageId (pas seulement le contenu) pour rester
    // unique entre deux mails distincts qui partageraient le même titre/date/heure — sinon
    // le second événement, pourtant réel, recevrait un faux 409 « déjà créé » et serait perdu.
    id = creerEvenement_(
      intention.titre,
      intention.date + 'T' + intention.heure + ':00',
      CONFIG.EVENT_DUREE_MIN_DEFAUT,
      '',
      hashHex_(messageId + '|' + hashContenu)
    );
  } else {
    id = creerTache_(intention.titre, intention.date, '');
  }

  if (!id) return 'echec'; // déjà journalisé par creerTache_/creerEvenement_ ; retenté au prochain tick

  indexAjouter_(cle, { statut: intention.type, nom: intention.titre });
  return 'creee';
}

/**
 * Marque un mail « important » (#14, ADR-0010 §3) : ligne Index `important|<messageId>`
 * (statut `important`, nom = sujet — métadonnées seules, ADR-0007), idempotente. Le résumé
 * hebdo la lit pour la section « À traiter » (lien Gmail reconstruit depuis la clé). AUCUNE
 * écriture Gmail (lecture seule §3), aucune notification immédiate (anti-bruit, décision Marc).
 * @param {string} messageId
 * @param {string} sujet
 */
function marquerMailImportant_(messageId, sujet) {
  var cle = 'important|' + messageId;
  if (indexContient_(cle)) return; // déjà signalé (rejeu d'un message en reprise d'extraction)
  indexAjouter_(cle, { statut: 'important', nom: sujet });
}

/**
 * Empreinte hex courte d'une chaîne (clé d'idempotence / ID client Calendar — alphabet
 * hexadécimal minuscule, compatible avec les deux usages).
 * @param {string} texte
 * @return {string}
 */
function hashHex_(texte) {
  var octets = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texte, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < octets.length; i++) {
    hex += ('0' + (octets[i] & 0xFF).toString(16)).slice(-2);
  }
  return hex;
}
