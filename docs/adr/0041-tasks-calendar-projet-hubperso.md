# ADR-0041 — Tasks & Calendar via le projet GCP hubperso (jeton OAuth dédié)

- **Statut** : accepté (décision Marc 2026-08-17, réitérée : « je veux utiliser le projet jobai
  hubperso uniquement, fais en sorte que ça marche »).
- **Révision 2026-08-17 (soir), AVANT toute liaison** : Marc corrige le nom — « je me suis trompé,
  je voulais dire le projet HUBPERSO seulement ». Le projet GCP visé est **hubperso** ; tout le
  nommage (fichier `JetonHubperso.gs`, fonctions, Properties `DriveAI_HUBPERSO_*`, `?hubperso=1`,
  `docs/HUBPERSO.md`, messages Santé) est aligné dans la foulée — renommage GRATUIT car aucune
  Property n'était encore posée. Le moteur ne connaît aucun nom de projet : seul le client OAuth
  fourni compte.
- **Contexte** : incident 14-17/08 — l'API Tasks n'est pas activée dans le projet GCP PAR DÉFAUT
  d'Apps Script (289462394116). Ce projet est CACHÉ : aucune console n'y donne accès, à personne.
  Marc a activé Tasks/Calendar dans SON projet (« job ai »/hubperso) et veut que DriveAI utilise
  CELUI-LÀ.

## 1. Décision

Les appels **Tasks + Calendar** cessent d'utiliser le jeton du script (`ScriptApp.getOAuthToken()`,
attribué au projet caché) et utilisent un **jeton OAuth du projet hubperso** : client OAuth « Web »
créé par Marc dans hubperso, refresh token obtenu par un consentement UNIQUE, stocké en Script
Properties, échangé en access token par REST (`oauth2.googleapis.com/token`). Les API activées
par Marc dans SA console sont alors celles qui servent — plus jamais d'activation sur le projet
caché pour ces deux API.

**Gmail et Drive restent sur le projet par défaut** — NON NÉGOCIABLE techniquement : `gmail.modify`
est un scope RESTREINT ; sur un projet standard il exige une vérification d'éditeur Google (CASA)
ou le mode Test dont les autorisations expirent tous les 7 jours (moteur mort chaque semaine).
L'exemption des scripts sur leur projet par défaut est ce qui permet à DriveAI d'exister.

## 2. Architecture

- `src/JetonHubperso.gs` : `jetonHubperso_()` rend un access token valide (cache Property avec expiration,
  marge 5 min) ou `null` — ÉCHEC FERMÉ. Refresh via POST `oauth2.googleapis.com/token`
  (`grant_type=refresh_token`, client id/secret depuis les Script Properties). Un `invalid_grant`
  (révocation) efface le refresh token et journalise la consigne de re-consentement.
- **Consentement une fois** : `lierCompteHubperso` (un-clic éditeur) GÉNÈRE le `state` (UUID — jamais
  choisi à la main), persiste l'URI de rappel réellement utilisée (`DriveAI_HUBPERSO_REDIRECT`, pour
  que l'échange du code renvoie la même à l'octet près) et affiche l'URL de consentement. `doGet`
  de la web app gagne le callback `?hubperso=1&code=…&state=…` — vérifie `state` contre la Property
  `DriveAI_HUBPERSO_STATE` en comparaison CONSTANTE, AVANT tout appel réseau (l'URL `/exec` est
  publique : sans state, un tiers pourrait LIER SON compte Google au moteur et recevoir les
  intentions de Marc), refuse un state de plus d'1 h (revue sécurité : une liaison abandonnée ne
  laisse pas un state valable à vie), échange le code, VÉRIFIE le champ `scope` de la réponse
  (consentement granulaire : une case décochée ⇒ liaison refusée EN ENTIER — un demi-consentement
  ferait mourir les créations en 403 de droits, hors de portée de la panne config), stocke le
  refresh token, page neutre (aucun paramètre reflété, refus muet). Scopes demandés : `tasks` +
  `calendar.events` (SENSIBLES, pas restreints — autorisés sur une app perso en production non
  vérifiée, jetons persistants).
- `Tasks.gs` / `Calendar.gs` / la sonde config-api : jeton via `jetonHubperso_()`. Sans jeton
  configuré → même mécanique de suspension que config-api, message Santé explicite (« jeton hubperso
  absent — suivre docs/HUBPERSO.md »). La sonde teste l'API **du projet hubperso** désormais.
- `oauthScopes` du manifeste : INCHANGÉS ce coup-ci (retirer `tasks`/`calendar.events` = changement
  de scopes = ré-autorisation = gel total, leçon C28-29 — à faire plus tard, regroupé et séquencé
  avec Marc). Un scope déclaré non utilisé est inerte.
- Prérequis MARC (une fois, tout dans SON projet) : client OAuth Web dans hubperso + URI de
  redirection `/exec` ; 2 Script Properties (`DriveAI_HUBPERSO_CLIENT_ID`,
  `DriveAI_HUBPERSO_CLIENT_SECRET`) ; exécuter `lierCompteHubperso` (JetonHubperso.gs) puis un clic sur
  l'URL de consentement affichée. Pas-à-pas : `docs/HUBPERSO.md`.
  ⚠️ L'écran de consentement du projet hubperso doit être « En production » (en mode Test, les
  autorisations expirent tous les 7 jours — le piège qu'on évite).

## 3. Garde-fous

- Secrets : Script Properties uniquement (règle §2.4), jamais dans le code ni le dépôt ; le
  `client_secret` ne transite que vers `oauth2.googleapis.com`.
- Surface : les verrous Tasks/Calendar existants (POST-création seulement + UN GET de sonde,
  `surface-tasks-calendar.test.js`) restent inchangés — seule la SOURCE du jeton change.
- Échec fermé partout : pas de jeton → suspension propre (jamais de retry en boucle), `state`
  invalide → refus muet, `invalid_grant` → purge + consigne (gardée par compare-avant-purge :
  un `invalid_grant` d'un VIEUX refresh en vol ne détruit jamais la re-liaison fraîche). Verdicts
  HONNÊTES (revue quotas) : credentials absents = « re-lier » (certain) ; refresh en échec 5xx =
  « momentanément indisponible » (transitoire, la sonde ne conclut rien) ; 401 d'une création =
  purge du cache d'access token (le refresh suivant tranche révocation vs blip).
- Fonctions PURES testées : construction d'URL de consentement, validation du callback, cache/
  expiration du jeton (I/O mockées).

## 4. Conséquences

- Marc administre les API Tasks/Calendar dans SA console (son souhait de centralisation) ; le
  projet caché ne porte plus que Gmail/Drive/Sheets, qui n'exigent aucune activation manuelle.
- Une révocation du consentement (sécurité Google, changement de mot de passe) suspend les
  intentions proprement jusqu'à un re-clic (message Santé + résumé hebdo).
- Le relais par le BACKEND hubperso (le hub crée les tâches lui-même) reste une évolution
  possible — même projet GCP, un secret de moins côté moteur — hors périmètre de cette PR.

## 5. Révisions

### 2026-08-19 — Correctifs révélés par le PREMIER usage réel

La liaison faite par Marc a exposé deux défauts que ni la CI ni la revue n'avaient pu voir (aucune
n'exécute la vraie chaîne Google) :

1. **Callback** (#289) — Google redirige vers l'URI de rappel EXACTE déclarée dans le client OAuth
   en n'y AJOUTANT que `code` et `state` : le marqueur `hubperso=1` n'y figure jamais. `doGet`
   route désormais sur la présence de `code` **et** `state` ; le garde reste le `state` (comparé en
   temps constant, à usage unique, périmable), jamais le marqueur.
2. **Sonde stérile** — un identifiant sondé UNIQUE pour les deux API, valide pour Calendar
   (base32hex) mais impossible pour Tasks (base64url, longueur ≡ 1 mod 4) ⇒ **HTTP 400** au lieu du
   404 attendu ⇒ verdict `indetermine` perpétuel ⇒ la reprise RAPIDE (≤ 13 min) était supprimée en
   silence, alors que le jeton hubperso fonctionnait. (Pas un blocage éternel : faute de
   rafraîchissement, la suspension expire d'elle-même au bout de 24 h — le coût réel est la reprise
   tardive et à l'aveugle, plus un message Santé périmé entre-temps.) Désormais : **un identifiant
   par API** (grammaire verrouillée par test), le verdict indéterminé **persiste le message de
   Google** (pas seulement le code), et une cause mémorisée que la sonde a **démentie** (jeton
   obtenu ⇒ « compte non lié » est faux) est remplacée — celles qu'elle n'a pas démenties, jamais.
