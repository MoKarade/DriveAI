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
  var props = PropertiesService.getScriptProperties();
  return noterFinMemoire_(props, passeMemoire_(props, garde, opts || {}));
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
function noterFinMemoire_(props, res) {
  try {
    props.setProperty('DriveAI_MEMOIRE_FIN', ligneFinMemoire_(new Date(), res));
  } catch (e) { /* observabilité best-effort : jamais bloquante */ }
  return res;
}

/** PURE : la ligne persistée. Testable sans Property, sans horloge, sans réseau. */
function ligneFinMemoire_(maintenant, res) {
  return [
    maintenant.toISOString(),
    res.fin,
    res.envoyes + '/' + res.acceptes + '/' + res.dejaPresents,
    (res.ligne || 0) + '/' + (res.dernLigne || 0)
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
  return emis + ' faits acceptés au total · dernière passe : ' + (p[2] || '?') +
    ' (envoyés/acceptés/déjà là) à la ligne ' + (p[3] || '?') + ' — ' + motif +
    ' · ' + minutes + ' des ' + Math.round(budgetJour / 60000) + ' min/j consommées';
}
