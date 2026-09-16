/**
 * Memoire.gs — DriveAI dit à la Mémoire ce qui EXISTE et où (ADR-0059, phase 0).
 *
 * ── CE QUI SORT DU COMPTE GOOGLE DE MARC, NOMMÉ ─────────────────────────────────────────
 *
 * Un fait par document classé, et rien d'autre : `document.existe`, dont la VALEUR est un
 * `fileId` Drive. Aucun corps, aucun extrait OCR, aucun montant, aucun nom de tiers hors de
 * l'émetteur déjà écrit dans le NOM du fichier. C'est la frontière que l'ADR-0059 §3 point 2
 * nomme, et le garde-fou qu'elle obtient en échange est ici : la liste des champs poussés est
 * FERMÉE (`champsFaitMemoire_`), et `test/memoire.test.js` échoue si un champ s'y ajoute.
 *
 * ⚠️ ZÉRO APPEL LLM. Tout ce qui est poussé se lit dans l'Index et dans le NOM du fichier
 * (`AAAA-MM-JJ_Type_Émetteur.ext`, convention stricte) : cette étape ne coûte pas un sou et
 * ne dépend d'aucun quota d'analyse. C'est ce qui permet de la passer sur les 19 000
 * documents déjà classés sans re-payer leur lecture.
 *
 * ⚠️ ÉTEINTE PAR DÉFAUT (`CONFIG.MEMOIRE_PUSH`). Rien ne part tant que Marc ne l'allume pas,
 * et l'absence de jeton la garde éteinte même allumée — un flag qui s'allume tout seul n'est
 * pas un flag.
 *
 * ⚠️ LE NIVEAU EST DÉRIVÉ PAR LE CODE, jamais proposé. La Mémoire prend le MAX(code, LLM) ;
 * ici il n'y a pas de LLM, donc c'est cette table qui décide seule qui pourra lire le fait.
 * Elle est GRATUITE à serrer : la valeur d'un `document.existe` est un pointeur, pas un
 * contenu — classer un document en N3 ne retire aucune information, ça change seulement qui
 * peut la lire. Dans le doute, on serre.
 *
 * ⚠️ JAMAIS BLOQUANTE POUR L'INTAKE. Appelée sous try/catch, budget TAIL (I/O pur, zéro LLM),
 * et une panne de la Mémoire suspend l'envoi sans toucher au reste du tick (§9 : « toute étape
 * SECONDAIRE est enveloppée — un échec ne doit JAMAIS bloquer l'intake »).
 *
 * ⚠️ PAS D'`etapeSuivie_` : le registre de suivi est SATURÉ (8 377/8 500 octets, ~199 par
 * entrée — cf. Main.gs, C28-44). Une 43ᵉ clé ferait échouer son tripwire de plafond. Même
 * traitement que `majValidationDoublons_` : un try/catch nu, et la visibilité passe par le
 * compteur `DriveAI_MEMOIRE_EMIS` (le signal INDÉPENDANT qu'exige l'ADR-0059 §6 — « un
 * déploiement vert ne prouve pas que le code a pris effet »).
 */

/* ---------- Fonctions PURES (testées par test/memoire.test.js) ---------- */

/**
 * Le NIVEAU de confidentialité d'un document, dérivé de son DOMAINE par le code.
 *
 * Les niveaux sont ceux de la Mémoire (ADR-0001 MemoryAI) : 0 clair · 1 vie courante ·
 * 2 domicile, santé, relations, finances-existence · 3 identité, immigration, fiscal.
 *
 * ⚠️ TOUT DOMAINE CONNU A SA LIGNE, et un test l'exige : un domaine ajouté dans
 * `CONFIG.DOMAINES` ou `CONFIG.DOMAINES_AUTO` sans entrée ici fait ROUGIR la suite, au lieu
 * de tomber en silence sur le défaut. « Un défaut de configuration n'est pas une décision. »
 */
var NIVEAU_PAR_DOMAINE_MEMOIRE = {
  // Passeports, actes, permis, cartes : le domaine de l'identité.
  '01 · Administratif & identité': 3,
  // Existence d'un compte, d'un feuillet, d'une déclaration — jamais un montant (le contrat
  // de la Mémoire refuse `valeur_type: montant` par un 422, et on ne lui en envoie aucun).
  '02 · Finances': 2,
  // Le domicile est ici (bail, taxes, assurance habitation) : N2 par l'ADR-0059 Q3.
  '03 · Logement & véhicule': 2,
  '04 · Immigration': 3,
  '05 · Carrière': 1,
  '06 · Études & diplômes': 1,
  '07 · Santé': 2,
  '08 · Perso & projets': 1,
  '09 · Voyages': 1
};

/** Le niveau d'un domaine INCONNU. Prudent sans mentir : ce n'est pas de l'identité. */
var NIVEAU_MEMOIRE_INCONNU = 2;

/**
 * @param {string} domaine
 * @return {number} 1, 2 ou 3
 */
function niveauMemoire_(domaine) {
  var n = NIVEAU_PAR_DOMAINE_MEMOIRE[String(domaine || '').trim()];
  return typeof n === 'number' ? n : NIVEAU_MEMOIRE_INCONNU;
}

/**
 * La LISTE FERMÉE des champs qu'un fait poussé peut porter. C'est elle que le test de vie
 * privée lit : un champ ajouté ici est un champ qu'on a DÉCIDÉ de faire sortir du compte
 * Google, jamais un champ qui a suivi une refacto.
 */
var CHAMPS_FAIT_MEMOIRE = ['sujet', 'predicat', 'valeur', 'valeur_type', 'niveau_propose', 'attributs', 'valide_de', 'provenance'];

/**
 * Les champs que `POST /api/faits` ACCEPTE (`faitSchema` de `lib/validerFait.ts`, `.strict()`).
 *
 * ⚠️ RECOPIÉS, et c'est assumé : ce moteur ne peut pas importer la Mémoire. Un champ que la
 * liste ci-dessus porte et que celle-ci ignore est refusé `champ_inconnu` — **le lot entier**,
 * sans qu'aucune erreur ne remonte, parce qu'un refus arrive dans un HTTP 200. C'est ce qui
 * s'est passé le 2026-09-16 : nous poussions `niveau`, la Mémoire n'accepte que
 * `niveau_propose` (elle prend le MAX de ce qu'on propose et de ce qu'elle dérive), et
 * 4 000 faits ont été refusés en silence sur un canal que les deux côtés testaient — chacun
 * le sien. Le test qui tient les deux ensemble est dans `test/memoire.test.js`.
 */
var CHAMPS_ACCEPTES_MEMOIRE = ['sujet', 'predicat', 'valeur', 'valeur_type', 'valide_de',
  'valide_a', 'niveau_propose', 'confiance', 'fiabilite_source', 'attributs', 'provenance'];
var CHAMPS_ATTRIBUTS_MEMOIRE = ['type', 'emetteur', 'annee'];
var CHAMPS_PROVENANCE_MEMOIRE = ['source_type', 'source_ref', 'extracteur', 'date_source'];

/** L'extracteur, versionné : la Mémoire le persiste, et il dit d'où vient chaque fait. */
var EXTRACTEUR_MEMOIRE = 'moteur-inventaire-v1';

/**
 * Un document classé devient un fait `document.existe`, ou rien.
 *
 * ⚠️ RIEN quand le fichier n'a pas d'identifiant : un fait dont la valeur serait vide ne
 * pointe vers aucun document, et la Mémoire le refuserait — autant ne pas l'envoyer.
 *
 * ⚠️ L'ÉMETTEUR N'EST PAS POUSSÉ POUR UN DOCUMENT N3. L'ADR-0001 de la Mémoire énumère ce
 * qu'un fait de niveau 3 porte : « existence, type, date, échéance, pointeur ». L'émetteur n'y
 * est pas. La Mémoire l'accepterait (sa contrainte ne porte que sur la VALEUR), et c'est
 * justement pour ça qu'on s'abstient ici : « une garde accepte » n'est pas « c'est voulu ».
 *
 * @param {{cle:string, nom:string, domaine:string, statut:string}} ligne  une ligne d'Index
 * @return {?Object} le fait au format `POST /api/faits`, ou null
 */
function faitInventaireMemoire_(ligne) {
  if (!ligne) return null;
  var fileId = fileIdDeCleIndex_(String(ligne.cle || ''));
  if (!fileId) return null;
  // Un document ÉCARTÉ (doublon, quarantaine) ou en attente n'est pas un document rangé :
  // dire qu'il « existe et est là » serait faux tant qu'il n'a pas de place.
  var statut = String(ligne.statut || '').toLowerCase();
  if (statut.indexOf('class') !== 0) return null;

  var seg = analyserNomClasse_(String(ligne.nom || ''));
  var niveau = niveauMemoire_(ligne.domaine);
  var attributs = {};
  if (seg.type) attributs.type = String(seg.type).slice(0, 80);
  if (seg.annee) attributs.annee = String(seg.annee);
  if (seg.tiers && niveau < 3) attributs.emetteur = String(seg.tiers).slice(0, 80);

  var fait = {
    sujet: 'marc',
    predicat: 'document.existe',
    valeur: fileId,
    valeur_type: 'ref_document',
    niveau_propose: niveau,
    provenance: {
      source_type: 'document',
      source_ref: fileId,
      extracteur: EXTRACTEUR_MEMOIRE
    }
  };
  if (attributs.type || attributs.annee || attributs.emetteur) fait.attributs = attributs;
  // La date du nom, quand elle est complète : elle situe le document dans le temps sans rien
  // dire de son contenu. Une année seule ne fait pas une date — on ne la complète pas.
  var dateNom = dateDuNomClasse_(String(ligne.nom || ''));
  if (dateNom) fait.valide_de = dateNom;
  return fait;
}

/**
 * La date COMPLÈTE écrite en tête d'un nom classé (`AAAA-MM-JJ_…`), ou null.
 * `analyserNomClasse_` ne rend que l'année — elle sert au ROUTAGE, qui n'a pas besoin du
 * jour. PUR, et volontairement STRICT : une date partielle n'est pas une date.
 * @param {string} nom
 * @return {?string} `AAAA-MM-JJ`
 */
function dateDuNomClasse_(nom) {
  var m = /^(\d{4}-\d{2}-\d{2})_/.exec(String(nom == null ? '' : nom).trim());
  return m ? m[1] : null;
}

/**
 * Découpe en lots. La Mémoire refuse un lot de plus de 50 faits (422 `lot_trop_grand`) —
 * la borne est DÉRIVÉE de cette limite, pas choisie.
 * @param {Array} faits
 * @param {number} max
 * @return {Array<Array>}
 */
function lotsMemoire_(faits, max) {
  var taille = max || MEMOIRE_LOT_MAX;
  var out = [];
  for (var i = 0; i < faits.length; i += taille) out.push(faits.slice(i, i + taille));
  return out;
}

var MEMOIRE_LOT_MAX = 50;

/* ---------- I/O (non testé en unitaire : réseau + Sheet) ---------- */

/**
 * Pousse l'inventaire vers la Mémoire, borné par le garde-temps.
 *
 * Reprenable : un curseur persiste la dernière LIGNE d'Index traitée. L'idempotence, elle,
 * ne repose pas sur ce curseur mais sur l'EMPREINTE que la Mémoire calcule
 * (`sujet|predicat|source_ref|extracteur|valeur`) — un fait renvoyé deux fois est compté
 * `dejaPresents`, jamais dupliqué. Le curseur ne sert donc qu'à ne pas RELIRE, pas à ne pas
 * RÉÉCRIRE : le perdre coûte du temps, jamais une donnée.
 *
 * @param {function():boolean} garde
 * @return {{envoyes:number, acceptes:number, dejaPresents:number, refuses:number, fin:string}}
 */
function pousserInventaireMemoire_(garde, opts) {
  var o = opts || {};
  var props = PropertiesService.getScriptProperties();
  // ⚠️ `manuel` voyage jusqu'au SIGNAL, pas seulement jusqu'au budget (C28-137). Une passe
  // lancée à la main qui s'inscrirait comme les autres ferait croire que le TICK tourne —
  // c'est exactement ce qui a coûté la journée du 16/09 : `diagnosticMemoire` avait poussé
  // 2 348 faits depuis l'éditeur, le compteur montait, et l'automatique n'envoyait rien.
  return noterFinMemoire_(props, passeMemoire_(props, garde, o), !!o.manuel);
}

/**
 * ⚠️ LE CHEMIN MANUEL, ET IL N'EXISTAIT PAS (C28-137, demande de Marc du 16/09).
 *
 * `opts.manuel` était lu en TROIS endroits de `passeMemoire_` — gate, budget par run,
 * comptage — et **aucun appelant ne le passait** : le seul appel est celui du tick. Un champ
 * lu par le moteur sans producteur, la classe de défaut que ce dépôt a déjà payée sous
 * `UN-CHAMP-TYPE-SANS-PRODUCTEUR-EST-UNE-INTENTION-JAMAIS-LIVREE`. Le coût réel, mesuré le
 * jour même : le budget du jour épuisé par trois refus de jeton, plus aucun moyen de tester
 * la réparation avant minuit — et rien pour le faire, puisque `diagnosticMemoire` était une
 * fonction créée à la main dans l'éditeur, jamais dans le dépôt.
 *
 * À lancer depuis `Memoire.gs` → `pousserMemoireMaintenant` → Exécuter.
 *
 * Hors budget QUOTIDIEN (c'est le sujet), mais PAS hors garde-temps : `budgetRun` vaut
 * `Infinity` sous `manuel`, donc le seul frein est la garde passée ici — sans elle, la boucle
 * irait au mur des 6 minutes d'Apps Script et lèverait au lieu de rendre son compte.
 */
function pousserMemoireMaintenant() {
  var debut = Date.now();
  var res = pousserInventaireMemoire_(
    function () { return (Date.now() - debut) > CONFIG.BUDGET_MS; },
    { manuel: true }
  );
  var ligne = 'Mémoire (manuel) : ' + res.envoyes + ' envoyés / ' + res.acceptes
    + ' acceptés / ' + res.dejaPresents + ' déjà là — ' + res.fin
    + (res.premierRefus ? ' — ' + res.premierRefus : '');
  Logger.log(ligne);
  return ligne;
}

/**
 * Le SIGNAL, et il n'y a qu'UN endroit qui l'écrit — donc aucune sortie ne peut l'oublier.
 *
 * ⚠️ C28-135, et c'est la leçon « 0/0 et 0/6 ne disent pas la même chose » payée une fois de
 * plus : jusqu'ici l'étape ne parlait QUE pour se plaindre (`journalErreur_` sur un refus
 * total). Une passe qui sortait sur son garde-temps écrivait zéro ligne, zéro erreur, et
 * laissait `aValider` figé — indiscernable de « il n'y avait rien à envoyer ». Le 16/09, le
 * canal a été réparé puis a poussé 2 348 faits À LA MAIN, et le tick n'en a plus poussé un
 * seul pendant une heure sans qu'AUCUNE surface ne puisse dire pourquoi.
 *
 * `DriveAI_MEMOIRE_FIN` = `<ISO>|<fin>|<envoyés>/<acceptés>/<déjà>|<ligne>/<dernière>`. Lu par
 * `majSante_`, donc visible dans `etat_moteur` — un signal qu'on peut lire sans exécuter quoi
 * que ce soit, ce que le piège 3 (§9) exige.
 */
function noterFinMemoire_(props, res, manuel) {
  try {
    props.setProperty('DriveAI_MEMOIRE_FIN', ligneFinMemoire_(new Date(), res, manuel));
  } catch (e) { /* observabilité best-effort : jamais bloquante */ }
  return res;
}

/**
 * PURE : la ligne persistée. Testable sans Property, sans horloge, sans réseau.
 *
 * ⚠️ Le MODE est un 5ᵉ champ, AJOUTÉ EN QUEUE (C28-137) — jamais une insertion qui décalerait
 * les quatre autres. La ligne déjà écrite en production n'en a que quatre, et elle doit rester
 * lisible : `phraseFinMemoire_` traite son absence comme un tick, ce qu'elle est.
 */
function ligneFinMemoire_(maintenant, res, manuel) {
  return [
    maintenant.toISOString(),
    res.fin,
    res.envoyes + '/' + res.acceptes + '/' + res.dejaPresents,
    (res.ligne || 0) + '/' + (res.dernLigne || 0),
    manuel ? 'manuel' : 'tick'
  ].join('|');
}

/** Consommation du budget QUOTIDIEN (ms réelles persistées `AAAA/MM/JJ|ms`). PUR sur props. */
function budgetJourMemoire_(props, aujourdhui) {
  var brut = String(props.getProperty('DriveAI_MEMOIRE_JOUR_MS') || '');
  var sep = brut.indexOf('|');
  if (sep === -1) return 0;
  return brut.slice(0, sep) === aujourdhui ? (Number(brut.slice(sep + 1)) || 0) : 0;
}

/** Le travail. Tous les retours passent par `noterFinMemoire_` — ne pas l'appeler ailleurs. */
function passeMemoire_(props, garde, opts) {
  var rien = { envoyes: 0, acceptes: 0, dejaPresents: 0, refuses: 0, fin: 'desactive' };
  if (!CONFIG.MEMOIRE_PUSH) return rien;
  var jeton = props.getProperty('DriveAI_MEMORYAI_TOKEN');
  // Pas de jeton ⇒ éteint, et on le DIT : « allumé sans jeton » et « éteint » ne sont pas la
  // même situation, et la première demande un geste de Marc.
  if (!jeton) { rien.fin = 'jeton-absent'; return rien; }
  if (memoireSuspendue_(props)) { rien.fin = 'suspendu'; return rien; }

  // ⚠️ Le budget QUOTIDIEN protège le quota runtime des DÉCLENCHEURS (~90 min/j). Une
  // exécution MANUELLE depuis l'éditeur en est HORS : l'y soumettre serait la DOUBLE peine
  // de C28-33 (Marc bloqué jusqu'au lendemain sans qu'aucun quota réel soit en cause, ET son
  // run consommant le budget du tick). Le drapeau coupe le gate ET le comptage.
  var aujourdhui = dateGmail_(new Date());
  var consommeJour = opts.manuel ? 0 : budgetJourMemoire_(props, aujourdhui);
  if (consommeJour >= CONFIG.MEMOIRE_BUDGET_JOUR_MS) {
    rien.fin = 'budget-jour';
    return rien;
  }

  var f = feuille_('Index');
  var dern = f.getLastRow();
  if (dern < 2) return { envoyes: 0, acceptes: 0, dejaPresents: 0, refuses: 0, fin: 'index-vide' };

  var curseur = parseInt(props.getProperty('DriveAI_MEMOIRE_CURSEUR') || '2', 10);
  if (!(curseur >= 2)) curseur = 2;
  // Une passe qui a tout vu recommence : l'Index grandit, et un curseur qui reste au bout
  // ne verrait plus jamais les documents rangés depuis (il n'y a pas de notification).
  if (curseur > dern) curseur = 2;

  var res = { envoyes: 0, acceptes: 0, dejaPresents: 0, refuses: 0, premierRefus: null,
    fin: 'termine', ligne: curseur, dernLigne: dern };
  var tampon = [];
  var ligne = curseur;
  var debutRun = Date.now();
  var budgetRun = opts.manuel ? Infinity
    : Math.min(CONFIG.MEMOIRE_BUDGET_MS, CONFIG.MEMOIRE_BUDGET_JOUR_MS - consommeJour);
  var gardeRun = function () {
    return (garde && garde()) || (Date.now() - debutRun) > budgetRun;
  };
  while (ligne <= dern) {
    if (gardeRun()) { res.fin = 'budget'; break; }
    var n = Math.min(MEMOIRE_LIGNES_PAR_LECTURE, dern - ligne + 1);
    var v = f.getRange(ligne, 1, n, 6).getValues();
    for (var i = 0; i < v.length; i++) {
      var fait = faitInventaireMemoire_({ cle: v[i][0], nom: v[i][2], domaine: v[i][3], statut: v[i][5] });
      if (fait) tampon.push(fait);
    }
    ligne += n;
    if (tampon.length >= MEMOIRE_LOT_MAX) {
      var envoi = envoyerLotMemoire_(tampon.slice(0, MEMOIRE_LOT_MAX), jeton, props);
      if (!envoi.ok) { res.fin = envoi.raison; break; }
      cumulerEnvoiMemoire_(res, envoi);
      tampon = tampon.slice(MEMOIRE_LOT_MAX);
    }
  }
  if (res.fin === 'termine' && tampon.length > 0) {
    var dernier = envoyerLotMemoire_(tampon, jeton, props);
    if (dernier.ok) cumulerEnvoiMemoire_(res, dernier);
    else res.fin = dernier.raison;
  }
  props.setProperty('DriveAI_MEMOIRE_CURSEUR', String(ligne));
  res.ligne = ligne;
  // Le budget consommé se pose ICI, jamais avant : une passe qui n'a rien pu faire ne doit pas
  // manger la journée. Patron `majHistoriqueVrac_`/`majValidationDoublons_`.
  if (!opts.manuel) {
    props.setProperty('DriveAI_MEMOIRE_JOUR_MS',
      aujourdhui + '|' + (consommeJour + (Date.now() - debutRun)));
  }
  // Le compteur cumulé : le signal INDÉPENDANT qui dit que le code déployé tourne vraiment
  // (ADR-0059 §6). Un run vert ne le prouve pas ; ce nombre qui monte, si.
  var emis = parseInt(props.getProperty('DriveAI_MEMOIRE_EMIS') || '0', 10) || 0;
  props.setProperty('DriveAI_MEMOIRE_EMIS', String(emis + res.acceptes));
  // Une passe qui envoie et n'obtient AUCUNE acceptation est une panne de contrat, pas un
  // jour sans document : elle se dit UNE fois, avec le motif que la Mémoire a donné. Sans
  // ça, un HTTP 200 qui refuse tout ressemble exactement à un canal qui marche.
  if (res.envoyes > 0 && res.acceptes === 0 && res.dejaPresents === 0) {
    journalErreur_('Mémoire', 'Aucun fait accepté sur ' + res.envoyes + ' envoyés — '
      + (res.premierRefus || 'motif non rendu par la Mémoire'));
  }
  return res;
}

var MEMOIRE_LIGNES_PAR_LECTURE = 200;

function cumulerEnvoiMemoire_(res, envoi) {
  res.envoyes += envoi.recus;
  res.acceptes += envoi.acceptes;
  res.dejaPresents += envoi.dejaPresents;
  res.refuses += envoi.refuses;
  if (!res.premierRefus && envoi.premierRefus) res.premierRefus = envoi.premierRefus;
}

/**
 * Un lot vers `POST /api/faits`.
 *
 * ⚠️ LES QUATRE RÉPONSES DE LA MÉMOIRE NE SE CONFONDENT PAS, et c'est ce qui rend le
 * diagnostic possible sans ouvrir les journaux : `503` = elle est éteinte ou en panne (on
 * suspend et on re-sonde), `401` = le jeton est faux (suspendre ne sert à rien, c'est un
 * geste de Marc), `403` = son périmètre nous a été retiré, `422` = le lot est trop grand.
 * Traiter un 401 comme une panne ferait re-sonder à vie une porte qui ne s'ouvrira pas.
 */
function envoyerLotMemoire_(lot, jeton, props) {
  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/faits';
  var rep;
  try {
    rep = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + jeton },
      payload: JSON.stringify({ faits: lot }),
      muteHttpExceptions: true
    });
  } catch (e) {
    suspendreMemoire_(props, 'réseau : ' + e);
    return { ok: false, raison: 'reseau' };
  }
  var code = rep.getResponseCode();
  if (code === 200) {
    var corps = {};
    try { corps = JSON.parse(rep.getContentText()); } catch (e) { corps = {}; }
    // Un 200 dont personne n'a vérifié la conséquence vaut un commentaire (§9 n° 7 Hubperso) :
    // on lit les compteurs, et les refus sont RAPPORTÉS, jamais avalés.
    return {
      ok: true,
      recus: Number(corps.recus) || 0,
      acceptes: Number(corps.acceptes) || 0,
      dejaPresents: Number(corps.dejaPresents) || 0,
      refuses: Array.isArray(corps.refuses) ? corps.refuses.length : 0,
      // ⚠️ Un refus se NOMME, il ne se compte pas. « 4 000 refusés » ne dit pas s'il faut
      // corriger un champ, un prédicat ou une valeur — et la Mémoire, elle, envoie le code.
      premierRefus: (Array.isArray(corps.refuses) && corps.refuses.length)
        ? String(corps.refuses[0].code || '?') + ' : ' + String(corps.refuses[0].raison || '')
        : null
    };
  }
  if (code === 401 || code === 403) {
    journalErreur_('Mémoire', 'Jeton refusé (' + code + ') : la Mémoire n\'accepte plus nos écritures. Geste de Marc requis.');
    return { ok: false, raison: code === 401 ? 'jeton-refuse' : 'perimetre-retire' };
  }
  suspendreMemoire_(props, 'HTTP ' + code);
  return { ok: false, raison: 'panne' };
}

/**
 * Suspension + re-sonde, patron déjà éprouvé pour les pannes de plateforme (§9) : une panne
 * passagère ne doit pas faire re-tenter à chaque tick, et une quarantaine sans chemin de
 * RETOUR transforme un incident d'une heure en perte permanente.
 */
function suspendreMemoire_(props, raison) {
  props.setProperty('DriveAI_MEMOIRE_SUSPENDU', String(Date.now()));
  props.setProperty('DriveAI_MEMOIRE_SUSPENDU_RAISON', String(raison).slice(0, 200));
}

function memoireSuspendue_(props) {
  var t = parseInt(props.getProperty('DriveAI_MEMOIRE_SUSPENDU') || '0', 10) || 0;
  if (!t) return false;
  if (Date.now() - t >= CONFIG.MEMOIRE_RESONDE_MS) {
    props.deleteProperty('DriveAI_MEMOIRE_SUSPENDU');
    return false;
  }
  return true;
}

/**
 * La ligne de Santé — c'est ELLE qui rend `DriveAI_MEMOIRE_FIN` lisible sans rien exécuter.
 * Impure (Properties) ; la mise en mots est dans `phraseFinMemoire_`, PURE et testée.
 */
function texteSanteMemoire_() {
  if (!CONFIG.MEMOIRE_PUSH) return 'désactivée (CONFIG)';
  try {
    var props = PropertiesService.getScriptProperties();
    return phraseFinMemoire_(
      props.getProperty('DriveAI_MEMOIRE_FIN') || '',
      Number(props.getProperty('DriveAI_MEMOIRE_EMIS')) || 0,
      budgetJourMemoire_(props, dateGmail_(new Date())),
      CONFIG.MEMOIRE_BUDGET_JOUR_MS
    );
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * PURE. Une passe qui n'a RIEN envoyé ne se lit pas comme une journée sans document : le motif
 * est nommé, en français, et il désigne le geste. « aucune passe enregistrée » est un état à
 * part — c'est celui d'un code qui n'a jamais tourné, la question même du piège 3 (§9).
 */
var PHRASES_FIN_MEMOIRE_ = {
  'termine': 'tout l\'Index a été parcouru',
  'budget': 'coupée par le garde-temps du tick (reprend au tick suivant)',
  'budget-jour': 'budget du jour épuisé — reprise demain',
  'suspendu': '⚠️ SUSPENDUE après un refus de la Mémoire — re-sonde automatique',
  'jeton-absent': '⚠️ allumée SANS jeton (`DriveAI_MEMORYAI_TOKEN`) — geste de Marc requis',
  'desactive': 'désactivée (CONFIG)',
  'index-vide': 'Index vide',
  'jeton-refuse': '⚠️ jeton REFUSÉ par la Mémoire — geste de Marc requis'
};

function phraseFinMemoire_(brut, emis, consommeJour, budgetJour) {
  if (!brut) return '⚠️ aucune passe enregistrée — l\'étape n\'a jamais tourné depuis le déploiement';
  var p = String(brut).split('|');
  var fin = p[1] || '?';
  var motif = PHRASES_FIN_MEMOIRE_[fin] || ('sortie « ' + fin + ' »');
  var minutes = Math.round((consommeJour / 60000) * 10) / 10;
  // ⚠️ Une passe MANUELLE se dit, et c'est tout l'intérêt du 5ᵉ champ : sans ça, la ligne de
  // Santé après un lancement depuis l'éditeur est indiscernable d'un tick qui travaille — et
  // on conclut « le canal marche » sur la preuve d'une main. Absent ⇒ tick (lignes d'avant).
  var mode = (p[4] === 'manuel')
    ? ' ⚠️ passe MANUELLE (lancée depuis l\'éditeur) — ne prouve PAS que le tick tourne'
    : '';
  return emis + ' faits acceptés au total · dernière passe : ' + (p[2] || '?') +
    ' (envoyés/acceptés/déjà là) à la ligne ' + (p[3] || '?') + ' — ' + motif +
    ' · ' + minutes + ' des ' + Math.round(budgetJour / 60000) + ' min/j consommées' + mode;
}

/* ========================================================================================
 * LES PIÈCES — ce qu'un PAPIER contient (ADR-0061, chantier #49 lot D1)
 * ======================================================================================== */

/**
 * ⚠️ CE QUI SORT DU COMPTE GOOGLE CHANGE ICI, ET L'ADR-0061 LE NOMME.
 *
 * Jusqu'à ce lot, un document ne faisait sortir qu'un `fileId` et ce que son NOM portait
 * déjà. Une pièce fait sortir son CONTENU EXTRAIT : émetteur, dates, montants, numéros de
 * référence, **numéros d'identité compris**, pour Marc ET pour ses proches. C'est la
 * frontière que l'ADR-0061 §2 franchit, sur décision de Marc du 16/09, et les invariants 1
 * et 3 de l'ADR-0059 §4 sont RÉVISÉS par elle — pas contournés en silence.
 *
 * Le garde-fou obtenu en échange est le même que pour les faits, et il tient au même
 * endroit : la liste ci-dessous est FERMÉE, et `test/memoire.test.js` échoue si un champ s'y
 * ajoute. Un champ qui sort est un champ qu'on a DÉCIDÉ de faire sortir.
 */
var CHAMPS_PIECE_MEMOIRE = ['sujet', 'type', 'emetteur', 'titulaire', 'titulaire_confiance',
  'annee', 'domaine', 'langue', 'date_document', 'date_echeance', 'resume',
  'champs_structures', 'champs_libres', 'exemplaires', 'niveau_propose', 'confiance', 'extracteur'];

/**
 * Les champs que `POST /api/pieces` ACCEPTE (`pieceSchema` de `lib/pieces/validerPiece.ts`,
 * `.strict()`), dérivés là-bas de `CHAMPS_ACCEPTES_PIECE`.
 *
 * ⚠️ RECOPIÉS, comme `CHAMPS_ACCEPTES_MEMOIRE`, et pour la même raison qu'eux : un moteur
 * Apps Script ne peut rien importer de la Mémoire. Un champ que nous poussons et qu'elle
 * ignore fait refuser **le lot entier** en `champ_inconnu`, dans un HTTP 200, sans qu'aucune
 * erreur ne remonte — 4 000 faits sont tombés comme ça le 16/09 sur un canal que les deux
 * côtés testaient, chacun le sien. Le test qui tient les deux ensemble est dans
 * `test/memoire.test.js`, et il ne prouve pas que la copie est FRAÎCHE (rien ici ne peut le
 * savoir) : il oblige à rouvrir le contrat au prochain champ ajouté.
 */
var CHAMPS_ACCEPTES_PIECE_MEMOIRE = ['sujet', 'type', 'emetteur', 'titulaire',
  'titulaire_confiance', 'annee', 'domaine', 'langue', 'date_document', 'date_echeance',
  'resume', 'champs_structures', 'champs_libres', 'exemplaires', 'niveau_propose',
  'confiance', 'extracteur'];

/** Les familles de champs structurés que la Mémoire accepte (`FAMILLES_STRUCTUREES`). */
var FAMILLES_STRUCTUREES_MEMOIRE = ['montants', 'numeros', 'personnes', 'lieux'];

/** L'extracteur des pièces, versionné à part : il DIT quel prompt a produit le contenu. */
var EXTRACTEUR_PIECE_MEMOIRE = 'haiku-4.5-piece-v1';

/**
 * Le TITULAIRE d'un papier — à qui il appartient — et sa confiance.
 *
 * ⚠️ « INCONNU » EST LA BONNE RÉPONSE, ET ELLE VAUT `null`. Jamais « Marc » par défaut : un
 * document au nom de deux personnes, un formulaire vierge, un papier où aucun nom
 * n'apparaît. Un défaut de configuration n'est pas une décision, et ici le défaut le plus
 * prudent est celui qui n'attribue rien à personne (ADR-0061 §9, arbitrage de Marc).
 *
 * ⚠️ IL NE DÉCIDE DE RIEN ICI. Ni niveau, ni routage, ni domaine : ce serait une garde bâtie
 * sur une lecture de modèle, ce que cet ADR ne fait nulle part. Il est POUSSÉ, et c'est la
 * Mémoire qui en fera un réglage.
 *
 * ⚠️ SANS CONFIANCE, PAS DE TITULAIRE. La Mémoire refuse la paire incomplète
 * (`titulaire-sans-confiance`) : une lecture de modèle qu'on ne peut pas pondérer serait crue
 * sur parole, et rien ne distinguerait plus tard « c'est sûrement sa sœur » de « c'est sa
 * sœur ». Plutôt que d'envoyer un lot qui sera refusé, on n'envoie pas le champ.
 *
 * @param {*} brut  ce que l'extraction a rendu
 * @param {*} confiance  ce qu'elle dit de sa propre certitude
 * @return {{titulaire:?string, confiance:?number}}
 */
function titulaireMemoire_(brut, confiance) {
  var nom = String(brut == null ? '' : brut).trim();
  var sentinelle = /^(inconnu|unknown|n\/?a|-|—|null|nil)$/i;
  if (!nom || sentinelle.test(nom)) return { titulaire: null, confiance: null };
  // ⚠️ ABSENTE N'EST PAS ZÉRO, et `Number(null)` vaut 0 — donc sans ce test, « le modèle
  // n'a rien dit » deviendrait « le modèle est certain de ne pas savoir », et le titulaire
  // partirait quand même, crédité d'une confiance qu'il n'a jamais donnée. C'est la règle
  // du parc « une donnée illisible se COMPTE, elle ne se rabat pas sur zéro », appliquée à
  // une mesure de certitude. Trouvé par le test, pas par la relecture.
  if (confiance === null || confiance === undefined || confiance === '') {
    return { titulaire: null, confiance: null };
  }
  var c = Number(confiance);
  if (!isFinite(c) || c < 0 || c > 1) return { titulaire: null, confiance: null };
  return { titulaire: nom.slice(0, 80), confiance: c };
}

/**
 * Une pièce au format `POST /api/pieces`, ou null.
 *
 * PURE : ni Drive, ni réseau, ni horloge. Elle prend ce que l'Index sait déjà (domaine, nom
 * classé) et ce que l'extraction a lu (résumé, champs, titulaire), et n'invente rien.
 *
 * ⚠️ RIEN SANS `fileId` : une pièce sans exemplaire ne se retrouve jamais — ni par DriveAI,
 * ni par la Mémoire. La Mémoire la refuserait (`sans-exemplaire`) ; autant ne pas l'envoyer.
 *
 * ⚠️ LE NIVEAU RESTE DÉRIVÉ PAR LE CODE (`niveauMemoire_`), comme pour un fait. On le
 * PROPOSE, la Mémoire prend le MAX du sien et du nôtre — donc une erreur de notre côté peut
 * rendre une pièce plus protégée, jamais moins.
 *
 * @param {{cle:string, nom:string, domaine:string, statut:string, chemin:string}} ligne
 * @param {{resume:?string, type:?string, emetteur:?string, langue:?string,
 *          date_document:?string, date_echeance:?string, champs:?Object, libres:?Object,
 *          titulaire:?string, titulaire_confiance:?number, confiance:?number}} extrait
 * @return {?Object}
 */
function pieceMemoire_(ligne, extrait) {
  if (!ligne) return null;
  var fileId = fileIdDeCleIndex_(String(ligne.cle || ''));
  if (!fileId) return null;
  var statut = String(ligne.statut || '').toLowerCase();
  if (statut.indexOf('class') !== 0) return null;

  var e = extrait || {};
  var seg = analyserNomClasse_(String(ligne.nom || ''));
  var domaine = String(ligne.domaine || '') || null;
  var tit = titulaireMemoire_(e.titulaire, e.titulaire_confiance);

  var piece = {
    sujet: 'marc',
    domaine: domaine,
    niveau_propose: niveauMemoire_(ligne.domaine),
    extracteur: EXTRACTEUR_PIECE_MEMOIRE,
    exemplaires: [{ file_id: fileId, chemin: String(ligne.chemin || '') || null }]
  };

  // Le type et l'émetteur viennent de l'extraction quand elle les a lus, du NOM sinon : le
  // nom classé les porte déjà, et une extraction muette ne doit pas faire perdre ce qu'on
  // savait avant elle.
  var type = texteCourtMemoire_(e.type) || (seg.type ? String(seg.type) : null);
  if (type) piece.type = type.slice(0, 80);
  var emetteur = texteCourtMemoire_(e.emetteur) || (seg.tiers ? String(seg.tiers) : null);
  if (emetteur) piece.emetteur = emetteur.slice(0, 80);

  if (tit.titulaire) {
    piece.titulaire = tit.titulaire;
    piece.titulaire_confiance = tit.confiance;
  }

  var annee = Number(e.annee || seg.annee);
  if (isFinite(annee) && annee >= 1900 && annee <= 2100) piece.annee = annee;

  var langue = texteCourtMemoire_(e.langue);
  if (langue) piece.langue = langue.slice(0, 5);

  var dateDoc = dateIsoMemoire_(e.date_document) || dateDuNomClasse_(String(ligne.nom || ''));
  if (dateDoc) piece.date_document = dateDoc;
  var dateEch = dateIsoMemoire_(e.date_echeance);
  // Une échéance antérieure à la date du document est refusée par la Mémoire
  // (`date-invalide`) : on n'envoie pas un lot qu'on sait refusé.
  if (dateEch && (!dateDoc || dateEch >= dateDoc)) piece.date_echeance = dateEch;

  var resume = texteCourtMemoire_(e.resume);
  if (resume) piece.resume = resume.slice(0, 600);

  var structures = champsStructuresMemoire_(e.champs);
  if (structures) piece.champs_structures = structures;
  var libres = champsLibresMemoire_(e.libres);
  if (libres) piece.champs_libres = libres;

  var conf = Number(e.confiance);
  if (isFinite(conf) && conf >= 0 && conf <= 1) piece.confiance = conf;

  return piece;
}

/** Un texte court, nettoyé, ou null. Les sentinelles d'un LLM comptent comme absentes. */
function texteCourtMemoire_(brut) {
  var s = String(brut == null ? '' : brut).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return /^(inconnu|unknown|n\/?a|-|—|null|nil)$/i.test(s) ? null : s;
}

/** Une date `AAAA-MM-JJ`, ou null. STRICT : une date partielle n'est pas une date. */
function dateIsoMemoire_(brut) {
  var m = /^(\d{4}-\d{2}-\d{2})$/.exec(String(brut == null ? '' : brut).trim());
  return m ? m[1] : null;
}

/**
 * Les champs STRUCTURÉS, bornés aux familles que la Mémoire connaît.
 *
 * ⚠️ Une famille inconnue est ÉCARTÉE, pas envoyée : le schéma de la Mémoire est `.strict()`
 * sur cet objet aussi, et un `champ_inconnu` refuserait le lot entier.
 */
function champsStructuresMemoire_(brut) {
  if (!brut || typeof brut !== 'object') return null;
  var out = {};
  var garde = false;
  for (var i = 0; i < FAMILLES_STRUCTUREES_MEMOIRE.length; i++) {
    var famille = FAMILLES_STRUCTUREES_MEMOIRE[i];
    var liste = brut[famille];
    if (!liste || !liste.length) continue;
    var entrees = [];
    for (var j = 0; j < liste.length; j++) {
      var libelle = texteCourtMemoire_(liste[j] && liste[j].libelle);
      var valeur = texteCourtMemoire_(liste[j] && liste[j].valeur);
      if (libelle && valeur) entrees.push({ libelle: libelle.slice(0, 80), valeur: valeur.slice(0, 500) });
    }
    if (entrees.length) { out[famille] = entrees; garde = true; }
  }
  return garde ? out : null;
}

/**
 * Les champs LIBRES. Bornés au plafond de la Mémoire (40 clés) : au-delà elle refuse le lot,
 * et une pièce n'est pas le texte intégral du document.
 */
var MAX_CHAMPS_LIBRES_MEMOIRE = 40;

function champsLibresMemoire_(brut) {
  if (!brut || typeof brut !== 'object') return null;
  var out = {};
  var n = 0;
  for (var cle in brut) {
    if (!Object.prototype.hasOwnProperty.call(brut, cle)) continue;
    if (n >= MAX_CHAMPS_LIBRES_MEMOIRE) break;
    var c = texteCourtMemoire_(cle);
    var v = texteCourtMemoire_(brut[cle]);
    if (!c || !v) continue;
    out[c.slice(0, 60)] = v.slice(0, 500);
    n++;
  }
  return n ? out : null;
}
