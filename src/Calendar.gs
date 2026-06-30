/**
 * Calendar.gs — Création d'événements Google Calendar via l'API REST (UrlFetchApp), Phase 3.
 *
 * Comme Tasks.gs / DriveRest.gs : REST plutôt que service avancé (cf. LESSONS « API Google
 * via REST »). Le jeton OAuth du script couvre tous les scopes déclarés (dont `calendar.events`,
 * volontairement plus étroit que `calendar` complet — pas d'accès aux paramètres d'agenda).
 *
 * Fuseau horaire : on envoie une date-heure LOCALE (« AAAA-MM-JJTHH:MM:SS », sans offset) +
 * `timeZone` (America/Toronto, déjà le fuseau du manifest) — c'est l'API Calendar qui calcule
 * l'instant UTC correct, DST inclus. On ne calcule JAMAIS l'offset nous-mêmes (piège DST).
 *
 * Garde-fou : CRÉATION uniquement — jamais de lecture, modification ou suppression des
 * événements existants de Marc. Échec d'API = dégradation propre (Journal + null).
 */

var FUSEAU_EVENEMENTS = 'America/Toronto';

/** Format strict attendu par `dateHeureDebut` — fail-fast plutôt qu'un décalage silencieux
 * si l'appelant (extraction LLM) envoie un format inattendu (avec offset, date seule...). */
var FORMAT_DATE_HEURE_LOCALE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Crée un événement sur l'agenda principal (« primary »).
 * @param {string} titre
 * @param {string} dateHeureDebut  « AAAA-MM-JJTHH:MM:SS » local (sans offset), STRICT
 * @param {number} [dureeMinutes]  défaut 60 min
 * @param {string} [description]
 * @param {string} [id]  ID client (idempotence — cf. Llm/Router Phase 3) : un re-POST avec le
 *   même ID renvoie 409 (déjà créé), traité comme un succès plutôt qu'un doublon.
 * @return {string} l'ID de l'événement (créé ou déjà existant), ou '' en cas d'échec.
 */
function creerEvenement_(titre, dateHeureDebut, dureeMinutes, description, id) {
  if (!FORMAT_DATE_HEURE_LOCALE.test(dateHeureDebut || '')) {
    journalErreur_('Calendar', 'Format de date-heure inattendu pour « ' + titre + ' » : ' + dateHeureDebut);
    return '';
  }
  var debut = new Date(dateHeureDebut);
  if (isNaN(debut.getTime())) {
    journalErreur_('Calendar', 'Date-heure invalide pour « ' + titre + ' » : ' + dateHeureDebut);
    return '';
  }
  var fin = new Date(debut.getTime() + (dureeMinutes || 60) * 60 * 1000);

  var payload = {
    summary: titre,
    start: { dateTime: formatLocalSansOffset_(debut), timeZone: FUSEAU_EVENEMENTS },
    end: { dateTime: formatLocalSansOffset_(fin), timeZone: FUSEAU_EVENEMENTS }
  };
  if (description) payload.description = description;
  if (id) payload.id = id; // ID client (a-v0-9, 5-1024 car. — un hex MD5 minuscule convient)

  var rep = fetchGoogleAvecRetry_(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: { Authorization: 'Bearer ' + jetonGoogle_() },
      muteHttpExceptions: true
    }
  );

  var code = rep.getResponseCode();
  if (code === 200) return JSON.parse(rep.getContentText()).id;
  if (code === 409 && id) return id; // déjà créé (rejeu après coupure) → idempotent, pas un échec
  journalErreur_('Calendar', 'Création HTTP ' + code + ' (« ' + titre + ' ») : ' +
    tronquer_(rep.getContentText(), 300));
  return '';
}

/**
 * Formate une Date en « AAAA-MM-JJTHH:MM:SS » SANS offset (l'offset est porté par `timeZone`
 * dans la requête, jamais calculé ici — évite tout décalage DST).
 * @param {Date} d
 * @return {string}
 */
function formatLocalSansOffset_(d) {
  return Utilities.formatDate(d, FUSEAU_EVENEMENTS, "yyyy-MM-dd'T'HH:mm:ss");
}
