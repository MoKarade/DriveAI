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
  if (estPanneGmail_()) return; // quota Gmail épuisé (C28-15) : suspendu jusqu'à la re-sonde
  // ADR-0049 (C28-76) : une panne de CONFIG d'API (Tasks/Calendar hors service, jeton hubperso
  // indisponible) ne suspend PLUS le scan — seulement la CRÉATION. L'ANALYSE (pré-filtre + mini-check
  // Haiku, qui pose `important|`) continue, parce que c'est elle que le TRI attend pour archiver :
  // l'ancienne suspension totale gelait l'archivage de toute la boîte pendant chaque panne d'agenda
  // (vécu 14-19/08 puis 02-07/09/2026, six jours). Le quota Gmail que la suspension protégeait est
  // préservé autrement : un message analysé-mais-différé (`analyse|`) compte comme « déjà vu » pour
  // le mur tant que la panne dure (voir `balayerNouveauxMails_`), et aucun appel LLM n'est fait sur
  // un différé tant que l'API ne répond pas (voir `traiterMessagePourIntentions_`).
  //
  // « RETARD INTENTIONS » — même filet que `DriveAI_GMAIL_PJ_RETARD` (Main.gs, leçon §9 « état
  // TERMINAL ⇒ un DRAPEAU qui désactive le mur tant qu'un backlog est possible ») : le mur « page à
  // jour » suppose « message inédit ⇒ en page 0 ». Faux dès qu'un backlog existe — messages DIFFÉRÉS
  // pendant une panne (ils sont derrière le mur quand l'API revient), ou scan COUPÉ avant la fin
  // (budget, plafond/run, panne, erreur de page : les pages suivantes ne remontent jamais en page 0).
  // Le drapeau s'ARME à ces bords, désactive le mur (repagination complète, bornée par le budget et
  // les plafonds/run) et se LÈVE à la fin naturelle de la fenêtre (`!fils.length`). Zéro écriture en
  // régime. Lecture ENVELOPPÉE, défaut prudent `retard = true` (complétude avant perf) : l'étape est
  // enveloppée dans le tick, mais un blip Property ne doit pas avorter l'analyse.
  //
  // DEUX NATURES de backlog, un seul drapeau (revue flotte — file-checker 🔴, quotas 🔴) :
  //  - `'c:<offset>'` (COUPE) : des pages NON ANALYSÉES sont derrière le mur — scan coupé par le
  //    budget, le plafond/run, une panne relevée ou une erreur de page. À drainer PANNE OU PAS :
  //    sinon, le jour du déploiement, six jours de mails jamais analysés resteraient derrière le mur
  //    jusqu'au geste de Marc sur l'OAuth, et l'incident persisterait sur l'essentiel de la boîte.
  //    REPRENABLE : l'offset atteint est persisté à chaque coupe. Avec 300-450 fils et le seul
  //    reliquat de budget (l'étape passe après l'intake), aucun tick n'est certain de lire la fenêtre
  //    entière — un drapeau booléen aurait repaginé de zéro À CHAQUE tick sans progrès (86-130 k
  //    appels Gmail/j contre ~20 k, quota épuisé en ~4 h, tri affamé : le correctif aurait recréé le
  //    symptôme). Le tick suivant relit la page 0 (le neuf), puis SAUTE une page avant l'offset
  //    (recouvrement : une insertion en tête ne fait que re-lire du déjà-vu ; un fil remonté en tête
  //    ou supprimé décale d'un cran, absorbé) et continue. Coût total ≈ 1× fenêtre + recouvrements.
  //  - `'d'` (DIFFÉRÉS) : seulement des `analyse|` en attente de l'API — invisibles du mur pendant la
  //    panne (comptés « vus », c'est le quota qu'ADR-0022 protégeait). Mur ouvert SEULEMENT hors
  //    panne, drainage depuis le début (ils sont dispersés dans la fenêtre).
  //  Une coupe pendant un drainage `'d'` devient `'c:<offset>'` ; une fin de fenêtre sous `'c'`
  //  redescend à `'d'` (les pages sautées peuvent cacher des différés) ; `'d'` se lève à la fin de
  //  fenêtre, API répondant, sans différé ni reprise dans le run. Absent = aucun retard.
  //  Lecture enveloppée ; défaut prudent sur Properties illisibles : `'c:0'` (tout drainer).
  var props = null;
  var retard = 'c';
  var retardOffset = 0;
  try {
    props = PropertiesService.getScriptProperties();
    var lu = lireRetardIntentions_(props.getProperty('DriveAI_INTENTIONS_RETARD'));
    retard = lu.retard;
    retardOffset = lu.offset;
  } catch (e) { props = null; retard = 'c'; retardOffset = 0; }
  var etat = { analyses: 0, creations: 0, differes: 0, reprises: 0, retard: retard, retardOffset: retardOffset,
    coupe: false, coupeA: -1, fenetreAJour: false, panne: false };
  var plafondAtteint = function () {
    // `estPannePlateforme_` : pendant une panne de compte API, scanner ne produirait rien (aucun
    // message ne peut être marqué traité) et re-parcourir la fenêtre brûle le quota Gmail (R2).
    // `estPanneGmail_` (C28-15) : le quota peut s'épuiser EN COURS de run — stop immédiat.
    return estBudgetDepasse() || estPannePlateforme_() || estPanneGmail_() ||
      etat.analyses >= CONFIG.INTENTIONS_MAX_PAR_RUN ||
      etat.creations >= CONFIG.CREATIONS_MAX_PAR_RUN;
  };

  try {
    balayerNouveauxMails_(etat, plafondAtteint);
    if (!plafondAtteint()) balayerArriereHistorique_(etat, plafondAtteint);
    // (Analyse CIBLÉE C28-06 : RETIRÉE par l'ADR-0031 — son bouton n'existe plus depuis C28-41 PR1.)
  } catch (e) {
    // Panne de config RELEVÉE depuis une création (patron ADR-0022), `getMessages()` qui lève, quota :
    // la fenêtre n'a pas été épuisée. Sans ce `catch`, le drapeau n'était jamais armé sur ce chemin
    // (revue quotas, 🟠) : le message qui a révélé la panne et ses suivants de page restaient
    // derrière le mur au tick suivant — orphelins jusqu'à sortie de fenêtre après une panne courte.
    etat.coupe = true;
    throw e;
  } finally {
    // BORDS du backlog (aucune écriture en régime), écrits MÊME si le scan a levé. Enveloppé : un
    // blip Property dégrade à « pas de changement ce tick », jamais une exception qui en masque une autre.
    try { etat.panne = !!estPanneConfigApi_(); } catch (e3) { etat.panne = true; }
    try { if (props) armerOuLeverRetardIntentions_(props, etat); }
    catch (e2) { /* l'état réel est relu au prochain tick */ }
  }
}

/**
 * Lit le drapeau de retard. PURE (testée). @return {{retard:(''|'d'|'c'), offset:number}}
 */
function lireRetardIntentions_(brut) {
  var t = String(brut == null ? '' : brut);
  if (!t) return { retard: '', offset: 0 };
  if (t === 'd') return { retard: 'd', offset: 0 };
  if (t.indexOf('c:') === 0) return { retard: 'c', offset: Math.max(0, Number(t.slice(2)) || 0) };
  return { retard: 'c', offset: 0 }; // valeur inconnue (ancien format) : le plus prudent, tout drainer
}

/**
 * Transition du drapeau de retard (ADR-0049), PURE sur `props` + `etat` (testée). Une écriture au
 * plus, et seulement si la valeur change. `etat.panne` = l'API est en panne À LA FIN du run.
 *  - fin de fenêtre : LEVÉ seulement si `'d'`/aucun, API répondant, sans différé ni reprise dans le
 *    run — sinon `'d'` (sous panne rien n'est prouvé : les différés sont invisibles ; sous `'c'` les
 *    pages sautées peuvent en cacher ; une reprise = un différé toujours en attente) ;
 *  - coupe : `'c:<max(offset connu, page atteinte)>'` — jamais en arrière, panne ou pas ;
 *  - différés ou reprises sans coupe (arrêt sur le mur sous panne) : `'d'` si rien n'était armé ;
 *  - arrêt sur le mur en régime : rien.
 * @param {Properties} props
 * @param {{retard:string, retardOffset:number, differes:number, reprises:number, coupe:boolean,
 *          coupeA:number, fenetreAJour:boolean, panne:boolean}} etat
 */
function armerOuLeverRetardIntentions_(props, etat) {
  var K = 'DriveAI_INTENTIONS_RETARD';
  if (etat.fenetreAJour) {
    if (etat.retard !== 'c' && !etat.panne && !etat.differes && !etat.reprises) {
      if (etat.retard) props.deleteProperty(K);
    } else if (etat.retard !== 'd') {
      props.setProperty(K, 'd');
    }
    return;
  }
  if (etat.coupe) {
    var off = Math.max(etat.retard === 'c' ? etat.retardOffset : 0, etat.coupeA);
    if (etat.retard !== 'c' || off !== etat.retardOffset) props.setProperty(K, 'c:' + off);
    return;
  }
  if ((etat.differes || etat.reprises) && !etat.retard) props.setProperty(K, 'd');
}

/** Enregistre une coupe du scan avant à la page `debutPage` (reprenable). */
function marquerCoupeIntentions_(etat, debutPage) {
  etat.coupe = true;
  etat.coupeA = Math.max(etat.coupeA, debutPage);
}

/**
 * Scan « avant » : pages successives depuis l'offset 0, tant qu'il reste du budget. S'arrête dès
 * qu'une page entière ne contient QUE des messages déjà indexés (mur de mail déjà vu — au-delà,
 * c'est `balayerArriereHistorique_` qui progresse dans l'historique, pas ce scan).
 * @param {{analyses:number, creations:number}} etat  muté en place
 * @param {function():boolean} plafondAtteint
 */
function balayerNouveauxMails_(etat, plafondAtteint) {
  // (La fenêtre FORCÉE « Analyser 30 j » C28-16 est RETIRÉE par l'ADR-0031 — son bouton n'existe
  // plus depuis C28-41 PR1. Le scan redevient purement automatique : pages depuis 0 jusqu'au mur.)
  var debutPage = 0;
  // Point de REPRISE d'un drainage (ADR-0049) : une page AVANT l'offset persisté — recouvrement qui
  // absorbe un fil remonté en tête ou supprimé entre deux ticks (décalage d'un cran vers le haut).
  var reprise = etat.retard === 'c' ? Math.max(0, etat.retardOffset - CONFIG.PAGE_FILS_ACTIONS) : 0;
  while (!plafondAtteint()) {
    var fils;
    try {
      fils = pageFilsActions_(debutPage);
    } catch (e) {
      marquerCoupeIntentions_(etat, debutPage); // fenêtre NON épuisée : le retard s'arme
      if (signalerPanneGmail_(e)) return; // quota épuisé (C28-15) : suspension, jamais une alerte
      notifierEchec_('Intentions', 'Recherche des mails (actions/rdv) impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_();
    if (!fils.length) { etat.fenetreAJour = true; return; } // fin de la fenêtre 30 jours : rien derrière

    var pageEntierementIndexee = true;
    for (var i = 0; i < fils.length; i++) {
      var threadId = fils[i].getId();
      // Un fil marqué MANUEL compte comme indexé pour le mur « déjà vu » (sinon il empêcherait
      // l'arrêt tôt du scan avant pendant toute sa présence dans la fenêtre 30 jours).
      var filManuel = indexContient_('intention-manuel|' + threadId);
      var messages = fils[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        if (plafondAtteint()) {
          marquerCoupeIntentions_(etat, debutPage); // reprenable : la page atteinte est persistée
          journalInfo_('Intentions', 'Budget/plafond atteint (mail récent) — reprise au prochain tick.');
          return;
        }
        var idMessage = messages[m].getId();
        // ADR-0049 : un message ANALYSÉ mais DIFFÉRÉ (création en attente de l'API) compte comme
        // « déjà vu » TANT QUE la panne dure — sinon chaque tick de panne repaginerait la fenêtre
        // entière (c'est le quota que l'ancienne suspension totale protégeait). Dès que l'API répond,
        // il redevient inédit : c'est le retard (mur ouvert) qui garantit qu'on revient le chercher.
        var inedit = !filManuel && !indexContient_('intention|' + idMessage) &&
          !(estPanneConfigApi_() && indexContient_('analyse|' + idMessage));
        if (inedit) pageEntierementIndexee = false;
        // Le plafond/run compte les messages qui COÛTENT (pré-filtre, mini-check, extraction) — un
        // déjà-vu n'est qu'une lecture d'Index en mémoire. Compter les déjà-vus figeait un scan sans
        // mur au même point à chaque tick (200 premiers messages, jamais au-delà).
        if (inedit) etat.analyses++;
        etat.creations += traiterMessagePourIntentions_(messages[m], threadId, etat);
      }
    }
    if (pageEntierementIndexee) {
      // MUR « page à jour » — DÉSACTIVÉ sous `'c'` (des pages non analysées attendent, panne ou pas)
      // et sous `'d'` quand l'API répond (les différés sont redevenus inédits). Sous `'d'` + panne le
      // mur tient : les différés sont « vus », voir ci-dessus — c'est le quota.
      var drainage = etat.retard === 'c' || (etat.retard === 'd' && !estPanneConfigApi_());
      if (!drainage) return; // → main au scan arrière
      // DRAINAGE : le neuf (pages 0..k) est lu ; une page entièrement vue AVANT le point de reprise
      // ⇒ on SAUTE au point de reprise au lieu de relire tout l'intervalle déjà drainé.
      if (debutPage + CONFIG.PAGE_FILS_ACTIONS < reprise) { debutPage = reprise; continue; }
    }
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
      if (signalerPanneGmail_(e)) return; // quota épuisé (C28-15) : suspension, jamais une alerte
      notifierEchec_('Intentions', 'Recherche de l\'historique (actions/rdv) impossible : ' + e);
      return;
    }
    signalerRetablissementGmail_();
    if (!fils.length) return; // historique des 30 jours entièrement rattrapé

    var plusAncienne = null;
    for (var i = 0; i < fils.length; i++) {
      var threadId = fils[i].getId();
      var messages = fils[i].getMessages();
      for (var m = 0; m < messages.length; m++) {
        if (plafondAtteint()) {
          if (plusAncienne) avancerCurseurHistorique_(props, plusAncienne);
          journalInfo_('Intentions', 'Budget/plafond atteint (historique) — reprise au prochain tick.');
          return;
        }
        var date = messages[m].getDate();
        if (!plusAncienne || date < plusAncienne) plusAncienne = date;
        // Ici `etat.analyses` compte TOUS les messages (déjà-vus compris), à la différence du scan
        // avant (ADR-0049) : ce scan n'a pas de mur, le plafond est sa seule borne de LECTURE au
        // rattrapage initial. Mort en régime (requête vide). Volontaire, ne pas harmoniser.
        etat.analyses++;
        // `etat` transmis (ADR-0049) : un différé posé par CE scan doit armer le retard comme
        // ceux du scan avant — le curseur `before:` avance et ne repassera jamais dessus.
        etat.creations += traiterMessagePourIntentions_(messages[m], threadId, etat);
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
 * @param {string} [threadId]  ID du fil (fourni par les balayeurs — évite un getThread() par message)
 * @return {number} nombre de tâches/événements RÉELLEMENT créés (pour le plafond/run).
 */
function traiterMessagePourIntentions_(message, threadId, etat) {
  var messageId = message.getId();
  var cleMessage = 'intention|' + messageId;
  if (indexContient_(cleMessage)) return 0; // déjà entièrement traité
  // C28-06 (plan P2) : Marc a créé sa tâche À LA MAIN depuis ce fil dans l'app → tout le fil est
  // sauté (pas de doublon Tasks/Calendar). Préfixe DÉDIÉ `intention-manuel|<threadId>` — jamais
  // `intention|<threadId>` : l'ID d'un fil Gmail EST l'ID de son premier message, la clé message
  // entrerait en collision et ferait sauter des fils entiers à tort dès le 1er message analysé.
  if (threadId && indexContient_('intention-manuel|' + threadId)) return 0;

  // ADR-0049 : `analyse|<messageId>` = « pré-filtre + mini-check FAITS (donc `important|` posé si
  // besoin), extraction + création EN ATTENTE de l'API ». Préfixe DÉDIÉ (jamais `intention|`, qui
  // signifie « entièrement traité ») ; hors de `PREFIXES_CLE_FICHIER_` (un messageId n'est pas un
  // fileId). Tant que l'API est en panne, un différé ne coûte RIEN : ni corps, ni LLM.
  var cleAnalyse = 'analyse|' + messageId;
  var analyseFaite = indexContient_(cleAnalyse);
  if (analyseFaite && estPanneConfigApi_()) return 0;

  var expediteur = message.getFrom() || '';
  var sujet = message.getSubject() || '';
  var corps = '';
  if (analyseFaite) {
    // L'API est revenue : on reprend à l'EXTRACTION. Le corps est relu et la garde zone protégée
    // re-vérifiée dessus (défense en profondeur, gratuite — un règlement de garde entre-temps
    // s'applique). Le mini-check n'est PAS rejoué : son verdict (`important|`) est déjà à l'Index.
    try { corps = tronquer_(message.getPlainBody(), CONFIG.LLM_CORPS_MAX_CARS); } catch (e) { corps = ''; }
    // Les TROIS surfaces (revue sécurité) : expéditeur/sujet aussi, pas seulement le corps — une
    // règle de zone protégée ajoutée pendant la panne s'applique au retour.
    if (toucheZoneProtegee_(expediteur + ' ' + sujet) || toucheZoneProtegee_(corps)) {
      indexAjouter_(cleMessage, { statut: 'intention-zone-protegee', nom: sujet });
      return 0;
    }
    return extraireEtCreer_(messageId, cleMessage, expediteur, sujet, corps, etat);
  }

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
  // Bouclier ANTI-ARNAQUES (C28-22, ADR-0022) — défense en profondeur, AVANT tout appel LLM :
  // les gardes du TRI (déterministes, gratuites) sont consultées ICI aussi, sinon une arnaque
  // (« payer 10 USD à Google Cloud ») devient une tâche « à payer » (le tick passe les intentions
  // AVANT le tri, vécu 14/07). Un mail suspect/dangereux est écarté sans jamais coûter d'appel LLM.
  var nomsPj = [];
  try {
    var pjs = piecesJointes_(message);
    for (var p = 0; p < pjs.length; p++) nomsPj.push(pjs[p].getName());
  } catch (e) { /* PJ illisibles → heuristique sur le sujet seul */ }
  if (heuristiquePhishing_(sujet, nomsPj)) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0;
  }
  // Chemin DANGEREUX = promo déterministe NON LUE (List-Unsubscribe sous contrôle de l'expéditeur
  // ET catégorie Promotions attribuée par Google) : bruit publicitaire jamais transformé en action.
  var promoNonLue = false;
  try { promoNonLue = !!message.getHeader('List-Unsubscribe') && estPromoGmail_(threadId) && message.isUnread(); }
  catch (e) { /* en-tête/état illisible → on continue (prudent : pas d'écartement à tort) */ }
  if (promoNonLue) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0;
  }
  // Étage 3 (mini-check Haiku, peu coûteux) : deux signaux en un appel (#14).
  var check = miniCheckMail_(expediteur, sujet);
  if (!check.action && !check.important) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0; // rien vu → le corps n'est même pas lu (chemin majoritaire, gratuit)
  }

  // Le mini-check a vu quelque chose (action OU important) → le CORPS est lu et la garde §1
  // re-vérifiée dessus AVANT toute suite — pose du flag « important » INCLUSE (revue sécurité,
  // bloquant : un mail protégé détectable par son corps SEUL — expéditeur/sujet neutres — ne
  // doit jamais être mis en avant par la Phase 3, pas même dans « À traiter »).
  var corps;
  try {
    corps = tronquer_(message.getPlainBody(), CONFIG.LLM_CORPS_MAX_CARS);
  } catch (e) {
    corps = '';
  }
  if (toucheZoneProtegee_(corps)) {
    indexAjouter_(cleMessage, { statut: 'intention-zone-protegee', nom: sujet });
    return 0;
  }

  // Mail IMPORTANT (réponse/geste personnel attendu) → ligne Index dédiée, consommée par le
  // résumé hebdo (« À traiter »). AVANT le tri action/pas-action : un mail important sans action
  // créable (question ouverte) doit quand même remonter. Les gardes zone protégée (expéditeur/
  // sujet ET corps) sont TOUTES en amont. Un message déjà indexé `intention|` avant ce chantier
  // saute le mini-check (le flag ne vaut que pour l'avenir).
  if (check.important) marquerMailImportant_(messageId, sujet, message);
  if (!check.action) {
    indexAjouter_(cleMessage, { statut: 'intention-ecartee', nom: sujet });
    return 0;
  }

  // ADR-0049 : création IMPOSSIBLE (API en panne) ⇒ on mémorise « analysé, création en attente »
  // et on s'arrête AVANT l'extraction — un appel LLM dont le résultat ne pourrait aboutir à rien.
  // Le tri, lui, a tout ce qu'il lui faut (`important|` est posé) : il archive normalement.
  if (estPanneConfigApi_()) {
    indexAjouter_(cleAnalyse, { statut: 'intention-en-attente-api', nom: sujet });
    if (etat) etat.differes++;
    return 0;
  }
  return extraireEtCreer_(messageId, cleMessage, expediteur, sujet, corps, etat);
}

/**
 * Extraction (LLM) + création idempotente des intentions d'un message dont l'analyse amont est
 * faite. Séparée de `traiterMessagePourIntentions_` (ADR-0049) pour être reprise TELLE QUELLE au
 * retour de l'API sur un message différé (`analyse|`).
 *
 * `etat.reprises` (revue flotte, file-checker 🔴 F2) : un message laissé SANS clé terminale (échec
 * LLM, création partielle) doit être RE-PRÉSENTÉ. En régime il est en page 0, le tick suivant le
 * revoit. Un différé, lui, est PROFOND dans la fenêtre : si le drainage se lève sur « fin de fenêtre
 * sans différé », le mur le cache au tick suivant et son `analyse|` reste orphelin À VIE — la tâche
 * jamais créée, et rien ne le montre (le tri, lui, est juste). Compter la reprise garde le drapeau.
 * BORNÉ : un échec LLM DÉTERMINISTE (refus, JSON invalide) tenu sous drapeau repaginerait la fenêtre
 * 30 jours — après `QUARANTAINE_MAX` essais le message est ABANDONNÉ (tracé), comme la création.
 * @return {number} nombre de tâches/événements RÉELLEMENT créés.
 */
function extraireEtCreer_(messageId, cleMessage, expediteur, sujet, corps, etat) {
  var intentions = extraireIntentions_({ expediteur: expediteur, sujet: sujet, corps: corps });
  if (intentions === null) {
    // Échec LLM total : on NE marque PAS le message fait → re-tenté au prochain tick, borné.
    // Panne de COMPTE API : ni notification par message (elle spammerait à chaque tick de panne —
    // la panne est déjà journalisée une fois par run) ni essai décompté (l'échec n'est pas le sien).
    if (!estPannePlateforme_()) {
      var essais = 0;
      try { essais = incrementerEchec_('llm-intention|' + messageId); } catch (e2) { }
      if (essais >= CONFIG.QUARANTAINE_MAX) {
        journalErreur_('Intentions', 'Extraction ABANDONNÉE après ' + essais + ' échecs LLM (« ' +
          tronquer_(sujet, 120) + ' ») — message débloqué.');
        indexAjouter_(cleMessage, { statut: 'intention-abandonnee', nom: sujet });
        return 0;
      }
      notifierEchec_('Intentions', 'Extraction impossible pour « ' + sujet + ' »');
    }
    if (etat) etat.reprises++;
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
  else if (etat) etat.reprises++; // toujours en attente : le drapeau ne doit pas se lever sur lui
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
  try {
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
  } catch (e) {
    // Panne de CONFIG d'API (C28-22, ADR-0022) : API non activée → suspension du run, rien imputé
    // au mail. On RELÈVE pour stopper le traitement d'intentions immédiatement (Main enveloppe le
    // scan ; aux ticks suivants, la CRÉATION reste suspendue mais l'analyse continue — ADR-0049).
    if (signalerPanneConfigApi_(e)) throw e;
    // Tout autre throw inattendu : traité comme un échec transitoire (3-strikes ci-dessous).
    id = '';
  }

  if (!id) {
    // Échec TRANSITOIRE (HTTP non-config : 500/429/400, déjà journalisé par creerTache_/creerEvenement_).
    // Sans borne, la clé intention| n'est jamais posée → le mail est re-analysé + re-tenté à CHAQUE
    // tick à l'infini, drainant le quota Gmail (le bug C28-22). Après QUARANTAINE_MAX essais, on
    // ABANDONNE l'intention (`deja-faite`) : le message est alors marqué traité et le pipeline libéré.
    //
    // Le compteur est clé sur le MESSAGE (messageId), PAS sur `cle` (qui inclut hashContenu =
    // titre/date/heure du LLM) : le titre peut FLUCTUER d'un run à l'autre (Sonnet 2 passes) → une
    // clé par contenu changerait à chaque tick, ne s'accumulerait jamais, n'atteindrait jamais le
    // seuil = NON-CONVERGENCE (le mail re-tenté à vie, quota drainé — la panne même qu'on borne ici).
    // Journal UNE seule fois (=== seuil), comme la campagne historique (Main.gs) : au-delà, silencieux.
    //
    // SÉMANTIQUE PAR MESSAGE (compromis assumé, revue flotte) : le compteur est PARTAGÉ entre toutes
    // les intentions du message (une incrémentation par appel). Un message à ≥ 3 intentions frappées
    // par une panne transitoire brève peut donc voir sa 3ᵉ intention abandonnée dès le 1er tick
    // (compteur 1→2→3 dans une seule boucle) — une intention légitime rare peut être perdue. On
    // l'accepte : aucune clé stable PAR intention n'existe (titre ET ordre fluctuent), et l'alternative
    // (par contenu) rouvre la non-convergence. Convergent, sans fuite, sans drain quota — priorité.
    var essais = 0;
    try { essais = incrementerEchec_('api-intention|' + messageId); } catch (e2) { }
    if (essais >= CONFIG.QUARANTAINE_MAX) {
      if (essais === CONFIG.QUARANTAINE_MAX) {
        journalErreur_('Intentions', 'Intention ABANDONNÉE après ' + essais + ' échecs de création (« ' +
          tronquer_(intention.titre, 120) + ' ») — message débloqué.');
      }
      return 'deja-faite'; // libère le message (marqué traité, plus jamais re-tenté)
    }
    return 'echec'; // retenté au prochain tick (borné par les 3 essais ci-dessus)
  }

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
function marquerMailImportant_(messageId, sujet, message) {
  var cle = 'important|' + messageId;
  if (indexContient_(cle)) return; // déjà signalé (rejeu d'un message en reprise d'extraction)
  indexAjouter_(cle, { statut: 'important', nom: sujet });
  // #16 (ADR-0012) : miroir VISIBLE dans Gmail — libellé ⏰ posé sur le fil (l'Index reste la
  // source de vérité ; best-effort : jamais un plantage du flux intentions pour un libellé).
  if (message) {
    try {
      var lab = libellesUtilisateur_()[CONFIG.TRI_LIBELLES.A_TRAITER];
      if (lab) lab.addToThread(message.getThread());
    } catch (e) { /* sans scope/libellé, le flag Index suffit */ }
  }
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
