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
  var fileId = fileIdDeLigneIndex_(ligne);
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
    // ⚠️ NEUF colonnes (C49-16) : la 9ᵉ porte le fileId, et sans elle le canal reste aveugle aux
    // pièces jointes Gmail — 734 documents CLASSÉS qui ne sont jamais partis.
    var v = f.getRange(ligne, 1, n, 9).getValues();
    for (var i = 0; i < v.length; i++) {
      var fait = faitInventaireMemoire_({ cle: v[i][0], nom: v[i][2], domaine: v[i][3],
        statut: v[i][5], fileId: v[i][8] });
      // ⚠️ C49-26 — le fait voyage avec SA ligne : c'est ce qui permet de reprendre au premier
      // fait NON ENVOYÉ, et non après la dernière ligne LUE (voir la sortie de boucle).
      if (fait) tampon.push({ fait: fait, ligne: ligne + i });
    }
    ligne += n;
    // ⚠️ C49-26 — TANT QUE le tampon est plein, pas UNE fois par lecture. Une lecture de 200
    // lignes peut porter jusqu'à 200 faits ; n'en envoyer que 50 laissait le tampon grossir plus
    // vite qu'il ne se vidait — et tout ce surplus était jeté à la coupure. Le garde-temps est
    // re-vérifié entre deux envois : un run ne déborde jamais de plus d'un lot.
    while (tampon.length >= MEMOIRE_LOT_MAX && res.fin === 'termine') {
      if (gardeRun()) { res.fin = 'budget'; break; }
      var envoi = envoyerLotMemoire_(faitsDuTampon_(tampon.slice(0, MEMOIRE_LOT_MAX)), jeton, props);
      if (!envoi.ok) { res.fin = envoi.raison; break; }
      cumulerEnvoiMemoire_(res, envoi);
      tampon = tampon.slice(MEMOIRE_LOT_MAX);
    }
    if (res.fin !== 'termine') break;
  }
  if (res.fin === 'termine' && tampon.length > 0) {
    var dernier = envoyerLotMemoire_(faitsDuTampon_(tampon), jeton, props);
    if (dernier.ok) { cumulerEnvoiMemoire_(res, dernier); tampon = []; }
    else res.fin = dernier.raison;
  }
  // ⚠️ C49-26 — LE CURSEUR REPREND AU PREMIER FAIT NON ENVOYÉ. Il se posait après la dernière
  // ligne LUE : sur une sortie `budget` (ou un envoi refusé), jusqu'à ~50 faits déjà lus mais
  // jamais envoyés étaient sautés, et ne repartaient qu'au tour COMPLET suivant de l'Index —
  // une cause de lenteur que ni le budget ni le compte des documents distincts ne montrait.
  // Les renvoyer ne coûte rien de plus qu'un « déjà là » : la Mémoire dédoublonne.
  var reprise = curseurDeReprise_(ligne, tampon);
  props.setProperty('DriveAI_MEMOIRE_CURSEUR', String(reprise));
  res.ligne = reprise;
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
      CONFIG.MEMOIRE_BUDGET_JOUR_MS,
      memoireSuspendue_(props) ? (props.getProperty('DriveAI_MEMOIRE_SUSPENDU_RAISON') || '') : ''
    );
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/* ---------- C49-23 : la FILE D'IMPORT, en chiffres ---------- */

/**
 * PURE. Combien de documents le canal de la Mémoire a-t-il à pousser EN TOUT ?
 *
 * Lit le 3ᵉ champ de `DriveAI_PERIMETRE_PIECE` (`candidats/classees/lues`) et rend `classees`
 * — les documents CLASSÉS porteurs d'un fileId, c'est-à-dire exactement ce que ce canal sait
 * atteindre. Ni `candidats` (qui ne compte que ceux dont on espère du texte, donc la file de
 * LECTURE) ni `lues` (des lignes d'Index toutes natures).
 *
 * ⚠️ `null` quand le périmètre n'a jamais été mesuré, JAMAIS zéro : un dénominateur inventé
 * ferait afficher « 2731 / 0 », soit une jauge pleine sur un comptage qui n'a pas eu lieu.
 */
/** PURE. Les faits d'un tampon `{ fait, ligne }`. */
function faitsDuTampon_(tampon) {
  var out = [];
  for (var i = 0; i < tampon.length; i++) out.push(tampon[i].fait);
  return out;
}

/**
 * PURE. Où reprendre la prochaine passe : la ligne du plus ancien fait resté dans le tampon
 * (donc jamais envoyé), sinon la ligne qui suit la dernière lue.
 */
function curseurDeReprise_(ligneSuivante, tampon) {
  return tampon && tampon.length ? tampon[0].ligne : ligneSuivante;
}

function cibleImportMemoire_(brutPerimetre) {
  if (!brutPerimetre) return null;
  var p = String(brutPerimetre).split('|');
  // ⚠️ Les DOCUMENTS distincts d'abord (23/09/2026) : la Mémoire reçoit un fait par document,
  // pas par ligne d'Index. Mesurée contre les lignes, la cible sur-comptait chaque document
  // porté plusieurs fois, et l'écart se lisait comme une lenteur d'envoi. Absent (mesure
  // écrite avant cette version) ⇒ repli sur l'ancien compte, qui reste une borne HAUTE.
  var distinctes = Number(p[8]);
  if (p[8] && !isNaN(distinctes) && distinctes > 0) return distinctes;
  var comptes = String(p[2] || '').split('/');
  var n = Number(comptes[1]);
  return (isNaN(n) || n <= 0) ? null : n;
}

/**
 * PURE. La file d'IMPORT, ENCODÉE `<poussés>/<cible>` — le pendant exact de `Lecture — file`.
 *
 * ⚠️ Pourquoi une ligne encodée et pas la phrase de `phraseFinMemoire_`, qui porte déjà les
 * deux nombres : « le format lu est celui que le moteur ÉCRIT, jamais la phrase française »
 * (§9). Une phrase se reformule au premier lot qui la rend plus claire, et l'app cesserait
 * alors d'afficher la jauge sans qu'aucun test ne rougisse.
 *
 * ⚠️ Une cible non mesurée rend un MOTIF, pas un couple : l'app doit pouvoir distinguer
 * « rien poussé » de « je ne sais pas sur combien ».
 */
function ligneFileImport_(emis, brutPerimetre) {
  var cible = cibleImportMemoire_(brutPerimetre);
  if (cible === null) return 'cible non mesurée — bumper CONFIG.PERIMETRE_PIECE_TAG';
  var n = Number(emis);
  return (isNaN(n) || n < 0 ? 0 : n) + '/' + cible;
}

/** La ligne de Santé. Impure (Properties) ; la mise en forme est {@link ligneFileImport_}. */
function texteSanteFileImport_() {
  try {
    var props = PropertiesService.getScriptProperties();
    return ligneFileImport_(
      Number(props.getProperty('DriveAI_MEMOIRE_EMIS')) || 0,
      props.getProperty('DriveAI_PERIMETRE_PIECE') || ''
    );
  } catch (e) {
    return 'état illisible (' + e + ')';
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

function phraseFinMemoire_(brut, emis, consommeJour, budgetJour, raisonSuspension) {
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
  // ⚠️ LA RAISON DE LA SUSPENSION. `DriveAI_MEMOIRE_SUSPENDU_RAISON` est écrite depuis
  // toujours par `suspendreMemoire_` et n'était LUE par personne : un champ sans lecteur.
  // Le 21/09, le canal s'est suspendu après un refus et la ligne disait seulement « après un
  // refus de la Mémoire » — vrai pour un jeton refusé, un périmètre retiré, un champ hors
  // contrat et une coupure réseau, qui appellent quatre gestes différents.
  var pourquoi = String(raisonSuspension || '') ? ' · raison : ' + String(raisonSuspension) : '';
  return emis + ' faits acceptés au total · dernière passe : ' + (p[2] || '?') +
    ' (envoyés/acceptés/déjà là) à la ligne ' + (p[3] || '?') + ' — ' + motif +
    ' · ' + minutes + ' des ' + Math.round(budgetJour / 60000) + ' min/j consommées' + pourquoi + mode;
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
// ⚠️ CE NOM DÉSIGNE LA VERSION DU PROMPT, pas celle du modèle — et c'est lui qui autorise une
// RELECTURE côté Mémoire (son ADR 0008, `LIGNEE_EXTRACTEURS`). Deux lectures du même modèle
// sous deux prompts n'ont pas la même valeur : `v1` a lu sans la consigne « date de naissance »
// (20/09/2026) et sans la porte « lisible » (21/09), donc en fabriquant un document plausible
// devant un OCR de bruit. Bumper ici sans ajouter le nom en queue de la lignée là-bas ne
// remplace RIEN — et l'inverse non plus : les deux gestes vont ensemble, c'est la friction qui
// empêche une relecture involontaire (elle coûte un appel de modèle par document).
var EXTRACTEUR_PIECE_MEMOIRE = 'haiku-4.5-piece-v2';

/**
 * Les BORNES de ce qu'on envoie, par extracteur. PURE.
 *
 * ⚠️ Elles suivent le CONTRAT de la Mémoire, pas un goût : un résumé plus long que ce qu'elle
 * accepte fait refuser la pièce ENTIÈRE (`trop-long`) après que l'appel a été payé. La lecture
 * vision (ADR-0063, et l'ADR 0010 de MemoryAI qui relève les bornes à 1 500 / 80) a les siennes ;
 * tout autre extracteur garde celles d'avant, parce que la Mémoire déployée ne sait peut-être
 * pas encore mieux — et un lot refusé en silence est la panne du 16/09.
 */
function bornesPieceMemoire_(extracteur) {
  if (extracteur === EXTRACTEUR_PIECE_VISION_MEMOIRE) return { resume: 1500, libres: 80 };
  return { resume: 600, libres: MAX_CHAMPS_LIBRES_MEMOIRE };
}

/** Recopié de `EXTRACTEUR_PIECE_VISION` (PieceVision.gs), qu'un test tient égal : ce fichier se
 * charge sans l'autre dans la moitié des tests, et une référence croisée lèverait en silence. */
var EXTRACTEUR_PIECE_VISION_MEMOIRE = 'sonnet-5-vision-piece-v3';

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
  var fileId = fileIdDeLigneIndex_(ligne);
  if (!fileId) return null;
  var statut = String(ligne.statut || '').toLowerCase();
  if (statut.indexOf('class') !== 0) return null;

  var e = extrait || {};
  var seg = analyserNomClasse_(String(ligne.nom || ''));
  var domaine = String(ligne.domaine || '') || null;
  var tit = titulaireMemoire_(e.titulaire, e.titulaire_confiance);

  // ⚠️ L'extracteur vient de l'EXTRACTION quand elle le dit (la lecture vision le pose), du
  // défaut sinon — jamais d'un paramètre de l'appelant, qui pourrait l'annoncer sans l'avoir lu.
  var extracteur = e.extracteur === EXTRACTEUR_PIECE_VISION_MEMOIRE
    ? EXTRACTEUR_PIECE_VISION_MEMOIRE : EXTRACTEUR_PIECE_MEMOIRE;
  var bornes = bornesPieceMemoire_(extracteur);
  var piece = {
    sujet: 'marc',
    domaine: domaine,
    niveau_propose: niveauMemoire_(ligne.domaine),
    extracteur: extracteur,
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
  if (resume) piece.resume = resume.slice(0, bornes.resume);

  var structures = champsStructuresMemoire_(e.champs);
  if (structures) piece.champs_structures = structures;
  var libres = champsLibresMemoire_(e.libres, bornes.libres);
  if (libres) piece.champs_libres = libres;

  var conf = Number(e.confiance);
  if (isFinite(conf) && conf >= 0 && conf <= 1) piece.confiance = conf;

  return piece;
}

/** Un texte court, nettoyé, ou null. Les sentinelles d'un LLM comptent comme absentes. */
function texteCourtMemoire_(brut) {
  // ⚠️ `<` et `>` deviennent des guillemets simples : « Julie <julie@x.ca> » est une BALISE pour
  // le contrat de la Mémoire (`BALISE` de `validerPiece.ts`), qui refuse alors la pièce ENTIÈRE
  // — lecture payée, perdue, et marquée « faite ». Le prompt v3 demande les courriels tels
  // qu'écrits : la forme `Nom <adresse>` va arriver (revue #418).
  var s = String(brut == null ? '' : brut).replace(/</g, '‹').replace(/>/g, '›')
    .replace(/\s+/g, ' ').trim();
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

function champsLibresMemoire_(brut, max) {
  if (!brut || typeof brut !== 'object') return null;
  var plafond = Number(max) > 0 ? Number(max) : MAX_CHAMPS_LIBRES_MEMOIRE;
  var out = {};
  var n = 0;
  for (var cle in brut) {
    if (!Object.prototype.hasOwnProperty.call(brut, cle)) continue;
    if (n >= plafond) break;
    var c = texteCourtMemoire_(cle);
    var v = texteCourtMemoire_(brut[cle]);
    if (!c || !v) continue;
    out[c.slice(0, 60)] = v.slice(0, 500);
    n++;
  }
  return n ? out : null;
}

/* ========================================================================================
 * LE CÂBLAGE — extraire une pièce au moment du classement et l'envoyer (C49-2 bis)
 * ======================================================================================== */

/**
 * ⚠️ POURQUOI L'ENVOI EST IMMÉDIAT, ET PAS BATCHÉ COMME L'INVENTAIRE.
 *
 * L'inventaire (`passeMemoire_`) relit l'Index à froid, par lots de 50, parce que tout ce
 * qu'il pousse y est DÉJÀ écrit. Une pièce, non : son contenu vient du texte OCR, et
 * `CLAUDE.md` §9 interdit de le persister — « ne JAMAIS persister le corps d'un document
 * (texte OCR, contenu) dans l'Index ni le Journal ». Batcher exigerait donc de le garder
 * quelque part entre l'extraction et l'envoi, c'est-à-dire de franchir l'invariant que
 * l'ADR-0061 n'a PAS levé (il a levé la sortie vers la Mémoire, pas le stockage local).
 *
 * L'alternative écartée : persister un extrait borné dans une Property le temps d'un tick.
 * Écartée parce qu'elle échange un invariant DUR contre un confort de débit, et qu'elle
 * rouvre la question de la vie privée à chaque relecture du code.
 *
 * Le prix payé, dit plutôt que caché : un POST par document au lieu d'un POST par 50. Sur le
 * flux vivant c'est quelques documents par jour. Sur un rattrapage, c'est le sujet de C49-4,
 * qui passe par le runner GitHub et non par le tick.
 *
 * ⚠️ JAMAIS BLOQUANT POUR LE CLASSEMENT. Le document est DÉJÀ placé et indexé quand cette
 * fonction est appelée : quoi qu'il arrive ici, il reste rangé. C'est l'ordre qui le
 * garantit, pas le try/catch de l'appelant — mais les deux sont là.
 */

/** Compteur à portée RUN (remis à zéro à chaque exécution Apps Script, comme `_freinBudget`). */
var _piecesCeRun = 0;
function reinitialiserPiecesRun_() { _piecesCeRun = 0; }

/**
 * PURE. Le verdict des gardes, séparé de l'I/O pour être testable sans réseau ni Property.
 *
 * ⚠️ L'ORDRE EST LA DÉCISION. Les gardes du CANAL (éteint, jeton, suspension, budget, panne,
 * plafond) passent AVANT celles du DOCUMENT (non classé, sans texte) : quand les deux
 * s'appliquent, ce que le lecteur doit savoir est l'état du canal, pas qu'un PDF était vide.
 * L'inverse ferait écrire « sans-texte » pendant qu'un jeton est refusé depuis trois jours.
 *
 * @return {?string} le motif de refus, ou `null` si on peut extraire
 */
function verdictPiece_(etat) {
  if (!etat.push) return 'desactive';
  if (!etat.jeton) return 'jeton-absent';
  if (etat.suspendue) return 'suspendu';
  if (etat.freinBudget) return 'frein-budget';
  if (etat.pannePlateforme) return 'panne-llm';
  if (etat.faitesCeRun >= etat.maxParRun) return 'plafond-run';
  if (!etat.statutClasse) return 'non-classe';
  if (!etat.aDuTexte) return 'sans-texte';
  return null;
}

/**
 * PURE. La ligne persistée dans `DriveAI_PIECE_FIN`, jumelle de `ligneFinMemoire_` :
 * `<ISO>|<motif>|<envoyées/acceptées/déjà>|<nom du document>`.
 *
 * Le NOM du document y figure parce que c'est la seule chose qui rend la ligne actionnable —
 * « refusée » sans savoir laquelle n'envoie nulle part. Il est déjà publié au hub sous
 * l'ADR-0057, donc aucune frontière nouvelle.
 */
function ligneFinPiece_(maintenant, res) {
  return [
    maintenant.toISOString(),
    res.motif,
    (res.envoyees || 0) + '/' + (res.acceptees || 0) + '/' + (res.dejaPresentes || 0),
    String(res.document || '').slice(0, 120)
  ].join('|');
}

var PHRASES_FIN_PIECE_ = {
  'ok': 'pièce envoyée et acceptée',
  'desactive': 'désactivée (CONFIG.PIECE_PUSH) — rien n\'est extrait ni envoyé',
  'jeton-absent': '⚠️ allumée SANS jeton (`DriveAI_MEMORYAI_TOKEN`) — geste de Marc requis',
  'suspendu': '⚠️ SUSPENDUE après un refus de la Mémoire — re-sonde automatique',
  'frein-budget': 'en pause — frein budget campagnes atteint (l\'extraction s\'y soumet)',
  'panne-llm': '⚠️ panne de plateforme LLM — aucun appel tenté',
  'plafond-run': 'plafond par exécution atteint — reprend au tick suivant',
  'non-classe': 'le document n\'est pas classé (média, quarantaine) — rien à extraire',
  'sans-texte': 'aucun texte lisible (OCR vide) — rien à extraire',
  'extraction-vide': '⚠️ le modèle n\'a rien rendu d\'exploitable',
  'illisible': '⚠️ le modèle DIT n\'avoir pas pu lire — la photo est à refaire, pas le prompt',
  'piece-vide': '⚠️ extraction faite mais pièce non composable (pas de fileId ?)',
  'refusee': '⚠️ pièce REFUSÉE par la Mémoire — voir le dernier refus',
  'jeton-refuse': '⚠️ jeton REFUSÉ par la Mémoire — geste de Marc requis',
  'perimetre-retire': '⚠️ périmètre RETIRÉ par la Mémoire — geste de Marc requis',
  'reseau': '⚠️ réseau injoignable — suspension puis re-sonde',
  'panne': '⚠️ la Mémoire a répondu en erreur — suspension puis re-sonde'
};

/**
 * PURE. La ligne de Santé. Mêmes règles que `phraseFinMemoire_` : « aucune passe
 * enregistrée » est un état À PART — celui d'un code qui n'a jamais tourné (piège 3, §9).
 */
function phraseFinPiece_(brut, emises, dernierRefus) {
  if (!brut) return '⚠️ aucune extraction enregistrée — l\'étape n\'a jamais tourné depuis le déploiement';
  var p = String(brut).split('|');
  var motif = PHRASES_FIN_PIECE_[p[1]] || ('sortie « ' + (p[1] || '?') + ' »');
  return emises + ' pièces acceptées au total · dernier document : « ' + (p[3] || '?') +
    ' » ' + (p[2] || '?') + ' (envoyées/acceptées/déjà là) — ' + motif +
    (dernierRefus ? ' · dernier refus : ' + dernierRefus : '');
}

function texteSantePiece_() {
  if (!CONFIG.PIECE_PUSH) return 'désactivée (CONFIG)';
  try {
    var props = PropertiesService.getScriptProperties();
    return phraseFinPiece_(
      props.getProperty('DriveAI_PIECE_FIN') || '',
      Number(props.getProperty('DriveAI_PIECE_EMISES')) || 0,
      props.getProperty('DriveAI_PIECE_DERNIER_REFUS') || ''
    );
  } catch (e) {
    return '⚠️ état illisible (' + e + ')';
  }
}

/**
 * I/O. L'envoi d'un lot de pièces. Jumeau d'`envoyerLotMemoire_`, et il partage sa
 * suspension : une Mémoire en panne l'est pour les deux canaux, il n'y a qu'un serveur.
 *
 * ⚠️ Les compteurs sont au FÉMININ côté Mémoire (`acceptees`, `dejaPresentes`, `refusees`) —
 * ce n'est pas une coquille, c'est le contrat de `POST /api/pieces`. Les lire au masculin
 * rendrait 0 partout, dans un HTTP 200, sans qu'aucune erreur ne remonte : exactement la
 * panne du 16/09 vue par l'autre bout.
 *
 * ⚠️ `oubliees` est RENDU par la Mémoire et compté ICI comme un SUCCÈS silencieux : une pièce
 * que Marc a fait oublier ne doit jamais ressembler à un refus, sinon on la re-pousserait à
 * chaque passage du document.
 */
function envoyerLotPiecesMemoire_(lot, jeton, props) {
  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/pieces';
  var rep;
  try {
    rep = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + jeton },
      payload: JSON.stringify({ pieces: lot }),
      muteHttpExceptions: true
    });
  } catch (e) {
    suspendreMemoire_(props, 'réseau (pièces) : ' + e);
    return { ok: false, raison: 'reseau' };
  }
  var code = rep.getResponseCode();
  if (code === 200) {
    var corps = {};
    try { corps = JSON.parse(rep.getContentText()); } catch (e) { corps = {}; }
    return {
      ok: true,
      recus: Number(corps.recus) || 0,
      acceptees: Number(corps.acceptees) || 0,
      // ⚠️ SOUS-ENSEMBLE d'`acceptees` côté Mémoire (son ADR 0008) : une relecture qui REMPLACE
      // une lecture plus ancienne. Sans lui, « un papier neuf » et « un papier relu » se lisent
      // pareil — et une campagne de relecture ne peut pas prouver qu'elle change quelque chose.
      remplacees: Number(corps.remplacees) || 0,
      dejaPresentes: Number(corps.dejaPresentes) || 0,
      oubliees: Number(corps.oubliees) || 0,
      refusees: Array.isArray(corps.refusees) ? corps.refusees.length : 0,
      premierRefus: (Array.isArray(corps.refusees) && corps.refusees.length)
        ? String(corps.refusees[0].code || '?') + ' : ' + String(corps.refusees[0].raison || '')
        : null
    };
  }
  if (code === 401 || code === 403) {
    journalErreur_('Pièce', 'Jeton refusé (' + code + ') : la Mémoire n\'accepte plus nos pièces. Geste de Marc requis.');
    return { ok: false, raison: code === 401 ? 'jeton-refuse' : 'perimetre-retire' };
  }
  suspendreMemoire_(props, 'HTTP ' + code + ' (pièces)');
  return { ok: false, raison: 'panne' };
}

/**
 * I/O. Le point d'entrée du pipeline : extraire la pièce d'un document QUI VIENT D'ÊTRE
 * classé, et l'envoyer. Appelé sous try/catch depuis `traiterDocument_`.
 *
 * @param {{cle:string}} src
 * @param {{nom:string, domaine:string, statut:string, chemin:string}} decision
 * @param {?string} texteOcr  le texte lu du document — jamais persisté nulle part
 * @return {{motif:string, envoyees:number, acceptees:number, dejaPresentes:number}}
 */
function pousserPieceApresClassement_(src, decision, texteOcr, opts) {
  opts = opts || {};
  var props = PropertiesService.getScriptProperties();
  var res = { motif: 'desactive', envoyees: 0, acceptees: 0, dejaPresentes: 0,
              document: (decision && decision.nom) || '' };

  // ⚠️ DEUX INTERRUPTEURS, UN SEUL CANAL (C49-5). Le flux vivant est gouverné par
  // `PIECE_PUSH` ; le RATTRAPAGE du stock a le sien, parce que Marc a choisi le 17/09 de faire
  // partir 110 papiers choisis sans allumer les HUIT sites d'appel de `traiterDocument_`. Ce
  // qui ne change pas : les gardes (`verdictPiece_`), la mise en forme (`pieceMemoire_`) et
  // l'envoi restent les MÊMES pour les deux — sinon un papier rattrapé arriverait à la Mémoire
  // autrement qu'un papier classé aujourd'hui, et rien ne le dirait.
  // ⚠️ Le tag est RE-VÉRIFIÉ ICI, au point d'envoi, et pas seulement dans l'étape qui appelle :
  // une garde n'existe qu'aux endroits qui la consultent. `opts.manuel` est l'exception NOMMÉE
  // — le geste de Marc depuis l'éditeur, avant même qu'un tag soit posé — et il voyage
  // explicitement plutôt que d'être déduit.
  // ⚠️ TROISIÈME interrupteur, même raison (ADR-0063) : la lecture VISION de l'audit L1 part
  // sur 20 papiers choisis sans allumer ni le flux vivant ni le rattrapage Haiku.
  // ⚠️ C49-30 — et la CAMPAGNE vision (le rattrapage lu par Sonnet 5) passe par le même
  // interrupteur que le rattrapage, AJOUTÉ à `RATTRAPAGE_PIECE_VISION` : sans lui, un appel
  // `{vision, rattrapage}` serait refusé dès que l'audit est éteint.
  var actif = opts.vision
    ? (!!String(CONFIG.AUDIT_VISION_TAG || '') || !!opts.manuel ||
       (!!opts.rattrapage && !!CONFIG.RATTRAPAGE_PIECE_VISION && !!String(CONFIG.RATTRAPAGE_PIECE_TAG || '')))
    : opts.rattrapage
    ? (!!String(CONFIG.RATTRAPAGE_PIECE_TAG || '') || !!opts.manuel)
    : !!CONFIG.PIECE_PUSH;
  var jeton = actif ? props.getProperty('DriveAI_MEMORYAI_TOKEN') : '';
  var statut = String((decision && decision.statut) || '').toLowerCase();
  var motif = verdictPiece_({
    push: actif,
    jeton: !!jeton,
    suspendue: !!jeton && memoireSuspendue_(props),
    freinBudget: !!jeton && budgetCampagnesAtteint_(),
    pannePlateforme: estPannePlateforme_(),
    faitesCeRun: _piecesCeRun,
    // ⚠️ Le plafond par run protège le TICK d'une rafale d'appels ; une exécution que Marc
    // lance lui-même n'a pas ce problème et n'a pas à cliquer vingt fois pour l'éviter
    // (C28-33). Ce que `manuel` ne lève PAS : le jeton, la suspension, la panne de plateforme
    // et le frein en DOLLARS — tous re-évalués à chaque document, juste au-dessus.
    maxParRun: opts.manuel ? Infinity : CONFIG.PIECE_MAX_PAR_RUN,
    statutClasse: statut.indexOf('class') === 0,
    // ⚠️ La lecture vision n'a pas besoin de l'OCR : c'est tout son intérêt. Exiger du texte
    // ici rendrait « sans-texte » exactement les papiers qu'elle existe pour lire.
    aDuTexte: opts.vision ? !!opts.vision.fichier : !!String(texteOcr || '').trim()
  });
  if (motif) {
    res.motif = motif;
    // ⚠️ Un non-événement PROPRE AU DOCUMENT n'écrase pas le signal du CANAL. Une photo sans
    // texte remplacerait sinon « jeton refusé » par « sans-texte », et le geste à faire
    // disparaîtrait de l'écran au profit d'une information sans intérêt.
    if (motif !== 'non-classe' && motif !== 'sans-texte') noterFinPiece_(props, res);
    return res;
  }

  // Le compteur monte AVANT l'appel : un appel qui lève ne doit pas rendre son crédit, sinon
  // le plafond ne borne plus rien le jour où c'est justement l'appel qui part en vrille.
  _piecesCeRun++;

  // ⚠️ DEUX refus sous une seule forme sans cet objet de sortie : « le modèle n'a rien tiré »
  // et « le modèle dit qu'il n'a pas pu LIRE ». Le second est le défaut du passeport du
  // 21/09/2026, et il n'appelle pas le même geste — il faut refaire la photo, pas le prompt.
  var horsExtraction = {};
  var extraction = opts.vision
    ? extrairePieceVision_(opts.vision.fichier, horsExtraction)
    : extrairePiece_({ nomFichier: decision.nom, extrait: texteOcr }, horsExtraction);
  // ⚠️ Ce que l'audit publie (voie, jetons, durée) voyage par `res.vision` : le coût d'une
  // lecture se MESURE sur la réponse, jamais ne s'estime après coup.
  if (opts.vision) res.vision = horsExtraction;
  if (!extraction) {
    res.motif = horsExtraction.motif === 'illisible' ? 'illisible' : 'extraction-vide';
    return noterFinPiece_(props, res);
  }

  var piece = pieceMemoire_({
    cle: src.cle,
    nom: decision.nom,
    domaine: decision.domaine,
    statut: decision.statut,
    chemin: decision.chemin,
    // ⚠️ C49-16 — le flux vivant n'a JAMAIS vu l'Index : il tient sa décision en main, et c'est
    // le pipeline qui vient d'y poser le fileId rendu par le placement. Sans ce champ, une pièce
    // jointe Gmail arrivée aujourd'hui retomberait sur sa clé, qui n'en porte aucun.
    fileId: decision.fileId
  }, extraction);
  if (!piece) { res.motif = 'piece-vide'; return noterFinPiece_(props, res); }

  res.envoyees = 1;
  var envoi = envoyerLotPiecesMemoire_([piece], jeton, props);
  if (!envoi.ok) { res.motif = envoi.raison; res.envoyees = 0; return noterFinPiece_(props, res); }

  res.acceptees = envoi.acceptees;
  res.remplacees = envoi.remplacees || 0;
  res.dejaPresentes = envoi.dejaPresentes + envoi.oubliees;
  // La pièce ENVOYÉE, pour que l'audit compte ce qui est PARTI (après les bornes) et non ce que
  // le modèle a rendu. En mémoire seulement : jamais écrite, jamais journalisée (§9).
  if (opts.vision) res.piece = piece;
  res.motif = envoi.refusees ? 'refusee' : 'ok';
  if (envoi.premierRefus) {
    // ⚠️ Écrit dans une Property DÉDIÉE, jamais écrasée par un succès : un refus de contrat
    // est la seule chose qu'on cherche quand le canal a l'air de marcher (16/09, 4 000 faits
    // refusés dans des HTTP 200). Le motif de la ligne courante peut redevenir « ok » ; la
    // trace, elle, reste jusqu'au prochain refus.
    try { props.setProperty('DriveAI_PIECE_DERNIER_REFUS',
      new Date().toISOString().slice(0, 16) + ' ' + String(envoi.premierRefus).slice(0, 180)); }
    catch (e) { /* observabilité best-effort */ }
  }
  if (envoi.acceptees) {
    try {
      var emises = parseInt(props.getProperty('DriveAI_PIECE_EMISES') || '0', 10) || 0;
      props.setProperty('DriveAI_PIECE_EMISES', String(emises + envoi.acceptees));
    } catch (e) { /* observabilité best-effort */ }
  }
  return noterFinPiece_(props, res);
}

/** Le SIGNAL, un seul endroit qui l'écrit — donc aucune sortie ne peut l'oublier. */
function noterFinPiece_(props, res) {
  try { props.setProperty('DriveAI_PIECE_FIN', ligneFinPiece_(new Date(), res)); }
  catch (e) { /* observabilité best-effort : jamais bloquante */ }
  return res;
}

/* ══════════════════════════════════════════════════════════════════════════════════════════
   CE QUE LA MÉMOIRE EN A FAIT — les comptes de l'AUTRE CÔTÉ du canal (23/09/2026).

   Marc, devant l'onglet « Lecture » : « manque aussi des infos sur ce qui est validé
   SÉPARÉMENT par driveai et memory ai — je comprends pas la page ».

   Le moteur savait dire ce qu'il avait ENVOYÉ ; rien de ce que c'était DEVENU. « 590 acceptées »
   et « 343 faits validés » ne sont pas la même grandeur, et l'écran qui n'en montrait qu'une
   laissait croire que l'autre n'existait pas.

   ⚠️ AUCUN NOUVEAU SECRET. On présente le jeton DÉJÀ posé (`DriveAI_MEMORYAI_TOKEN`) : la
   route d'en face accepte un jeton de lecture OU d'écriture, et celui-ci donne déjà plus de
   droits. En créer un second coûterait un geste de Marc pour zéro sécurité gagnée.

   ⚠️ UN APPEL RÉSEAU PAR TICK SERAIT 288 PAR JOUR POUR UN CHIFFRE QUI BOUGE AUX HEURES. D'où
   l'espacement (`CONFIG.MEMOIRE_COMPTES_MIN_MS`) : au plus une lecture toutes les 30 min, et
   la valeur gardée porte SA date pour que l'écran puisse dire de quand elle date.

   ⚠️ UNE PANNE NE SE MET JAMAIS EN CACHE, et elle n'écrase pas la dernière valeur connue :
   c'est le motif qui est publié à côté. « Je ne sais pas » et « il n'y en a aucun » n'appellent
   pas le même geste — et des zéros ici se liraient « la mémoire est vide », le plus alarmant
   des faits, sur une simple coupure réseau.
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * PURE. Encode la réponse de `GET /api/etat` pour la Property.
 *
 * Forme : `<faits valides>/<a valider>/<migres>|<papiers total>/<papiers lus>|<gel>|<ISO min>`.
 * Un ENCODAGE et non une phrase : une phrase se reformule au premier lot qui la rend plus
 * claire, et la jauge d'en face disparaîtrait sans qu'un test rougisse.
 *
 * ⚠️ Un champ absent de la réponse rend `null` — l'appelant publiera le motif « illisible »
 * plutôt qu'une ligne de zéros. Le contrat d'en face peut changer ; un `Number(undefined) || 0`
 * transformerait ce changement en « la mémoire s'est vidée ».
 */
function encoderComptesMemoire_(corps, quandMs) {
  var c = corps || {};
  var f = c.faits || {}, p = c.papiers || {};
  var champs = [f.valides, f.aValider, f.migresEnPiece, p.total, p.lus];
  for (var i = 0; i < champs.length; i++) {
    if (typeof champs[i] !== 'number' || !isFinite(champs[i]) || champs[i] < 0) return null;
  }
  return [
    f.valides + '/' + f.aValider + '/' + f.migresEnPiece,
    p.total + '/' + p.lus,
    c.gele ? '1' : '0',
    new Date(quandMs || Date.now()).toISOString().slice(0, 16)
  ].join('|');
}

/**
 * PURE. La ligne de Santé, depuis la Property.
 *
 * ⚠️ Trois états DISTINCTS, et c'est tout l'intérêt : jamais lue (le canal n'a pas encore
 * tourné), lue et illisible (le contrat d'en face a bougé), lue et connue. Les confondre
 * ferait chercher une panne de réseau devant un déploiement en retard.
 */
function ligneComptesMemoire_(brut) {
  var s = String(brut == null ? '' : brut).trim();
  if (!s) return 'jamais lue — la Mémoire n\'a pas encore été interrogée';
  if (s.indexOf('!') === 0) return 'indisponible — ' + s.slice(1);
  return s;
}

/** L'espacement est-il écoulé ? PURE. */
function comptesMemoireARelire_(dernierMs, maintenantMs, espacementMs) {
  var d = Number(dernierMs) || 0;
  if (!d) return true;
  return (Number(maintenantMs) || 0) - d >= (Number(espacementMs) || 0);
}

/**
 * Lit `GET /api/etat` si l'espacement est écoulé. Impure, JAMAIS bloquante.
 *
 * ⚠️ L'horodatage de tentative est posé AVANT l'appel : sans lui, une Mémoire injoignable
 * serait re-sondée à CHAQUE tick, c'est-à-dire exactement quand il ne faut pas insister.
 * ⚠️ Le canal éteint (`MEMOIRE_PUSH` faux) ou sans jeton ne sonde pas : il n'y aurait rien à
 * lire, et une ligne « indisponible » s'y lirait comme une panne.
 */
function rafraichirComptesMemoire_(props, maintenantMs) {
  if (!CONFIG.MEMOIRE_PUSH) return;
  var jeton = props.getProperty('DriveAI_MEMORYAI_TOKEN');
  if (!jeton) return;
  if (!comptesMemoireARelire_(props.getProperty('DriveAI_MEMOIRE_COMPTES_LE'),
                              maintenantMs, CONFIG.MEMOIRE_COMPTES_MIN_MS)) return;
  props.setProperty('DriveAI_MEMOIRE_COMPTES_LE', String(maintenantMs));
  var url = (CONFIG.MEMOIRE_URL || '').replace(/\/+$/, '') + '/api/etat';
  var rep;
  try {
    rep = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + jeton },
      muteHttpExceptions: true
    });
  } catch (e) {
    props.setProperty('DriveAI_MEMOIRE_COMPTES', '!réseau');
    return;
  }
  var code = rep.getResponseCode();
  if (code !== 200) {
    // ⚠️ Le CODE est publié, jamais « erreur » : 401 est un geste de Marc (jeton), 503 une
    // panne qui passera toute seule. Les confondre envoie corriger le mauvais endroit.
    props.setProperty('DriveAI_MEMOIRE_COMPTES', '!HTTP ' + code);
    return;
  }
  var corps = null;
  try { corps = JSON.parse(rep.getContentText()); } catch (e) { corps = null; }
  var encode = encoderComptesMemoire_(corps, maintenantMs);
  props.setProperty('DriveAI_MEMOIRE_COMPTES', encode === null ? '!réponse illisible' : encode);
}

/** La ligne de Santé. Impure ; la mise en forme est {@link ligneComptesMemoire_}. */
function texteSanteComptesMemoire_() {
  try {
    var props = PropertiesService.getScriptProperties();
    rafraichirComptesMemoire_(props, Date.now());
    return ligneComptesMemoire_(props.getProperty('DriveAI_MEMOIRE_COMPTES'));
  } catch (e) {
    return 'état illisible (' + e + ')';
  }
}
