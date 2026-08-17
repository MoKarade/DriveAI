# JOBAI.md — Lier DriveAI au projet GCP « jobai » (Tasks & Calendar)

> **Pourquoi** (ADR-0041) : le projet GCP par défaut d'Apps Script est **caché** — personne ne
> peut y activer une API, toi compris. Depuis le 2026-08-17, DriveAI crée les tâches et les
> événements avec un jeton OAuth de **TON projet « jobai »** (celui de hubperso, où tu as activé
> les API). Cette page est le pas-à-pas **une fois** ; ensuite tout est automatique, y compris la
> reprise des intentions mail (la sonde du moteur détecte la liaison en ≤ 13 min).

## Étape 1 — Activer les API dans le projet jobai (console GCP)

Dans [console.cloud.google.com](https://console.cloud.google.com), projet **jobai** :

1. « API et services » → « Bibliothèque » → activer **Google Tasks API** *(déjà fait d'après toi)*.
2. Même chose pour **Google Calendar API** (les intentions créent aussi des événements).

## Étape 2 — Créer le client OAuth « Web » (console GCP, projet jobai)

1. « API et services » → « Écran de consentement OAuth » : s'il n'est pas configuré, type
   **Externe**, remplis le minimum, puis **« Publier l'application » (statut : En production)**.
   ⚠️ En mode « Test », Google coupe l'autorisation **tous les 7 jours** — le moteur mourrait
   chaque semaine. « En production » non vérifié suffit : les scopes demandés (`tasks`,
   `calendar.events`) sont *sensibles*, pas *restreints* — Google affiche un avertissement au
   consentement, c'est normal, et les jetons sont persistants.
2. « Identifiants » → « Créer des identifiants » → **ID client OAuth** → type **Application Web**.
   Nom : `DriveAI` (par exemple). Laisse l'URI de redirection **vide pour l'instant** (l'étape 4
   te donnera la valeur exacte).
3. Note l'**ID client** et le **code secret du client**.

## Étape 3 — Poser les 2 Script Properties (éditeur Apps Script)

Dans le projet Apps Script DriveAI : ⚙️ « Paramètres du projet » → « Propriétés du script » :

| Propriété | Valeur |
|---|---|
| `DriveAI_JOBAI_CLIENT_ID` | l'ID client de l'étape 2 |
| `DriveAI_JOBAI_CLIENT_SECRET` | le code secret de l'étape 2 |

(Jamais dans le code, jamais dans un commit — règle §2.4.)

## Étape 4 — Exécuter `lierCompteJobai` et consentir

1. Éditeur Apps Script : ouvre **`JetonJobai.gs`** → fonction **`lierCompteJobai`** → **Exécuter**.
2. Le journal d'exécution affiche **deux choses** :
   - **(1) l'URI de redirection** : copie-la **exactement** dans le client OAuth de l'étape 2
     (console GCP → ton client → « URI de redirection autorisés » → Ajouter → Enregistrer).
     Elle doit **finir par `/exec`** — si ce n'est pas le cas, dis-le-moi avant de continuer ;
   - **(2) l'URL de consentement** : ouvre-la dans le navigateur, choisis ton compte, et
     **coche les DEUX autorisations** (Tasks **et** Agenda) si Google les présente en cases
     séparées — une seule cochée et la liaison sera refusée (exprès : à moitié liée, les
     intentions mourraient en silence).
3. La page de retour affiche « ✅ Compte jobai lié ». C'est fini. (L'URL de consentement expire
   au bout d'1 h — au-delà, relance simplement `lierCompteJobai`.)

> Si tu enregistres l'URI de redirection APRÈS avoir généré l'URL, attends ~1 min (propagation
> Google) avant d'ouvrir l'URL de consentement. En cas d'erreur `redirect_uri_mismatch`,
> re-vérifie que l'URI collée dans la console est identique à l'octet près, puis relance
> `lierCompteJobai` (chaque exécution régénère une URL valide).

## Ce qui se passe ensuite (automatique)

- La sonde config-api du moteur (≤ 1×/13 min pendant une suspension) voit la liaison, vérifie que
  les API Tasks/Calendar du projet jobai répondent, et **lève la suspension toute seule** — les
  intentions mail reprennent au tick suivant, et le tri Gmail (couplé aux intentions) avec elles.
- L'onglet **Santé** (ligne « API Tasks & Calendar ») dit l'état en clair : suspension et cause
  pendant la panne, « actives (sondées le …) » après reprise.
- **Révocation** (tu retires l'accès dans ton compte Google, changement de mot de passe…) : le
  moteur le détecte (`invalid_grant`), suspend proprement les intentions, l'écrit dans Santé et le
  Journal — il suffit de refaire l'étape 4.

## Dépannage

| Symptôme | Cause probable | Remède |
|---|---|---|
| Santé : « compte jobai non lié » | Étape 4 jamais faite, ou consentement révoqué | Étape 4 |
| Page « ❌ Liaison non aboutie » | `state` périmé (URL de + d'1 h), ou Properties manquantes | Relancer `lierCompteJobai`, utiliser la NOUVELLE URL |
| Journal : « autorisations incomplètes » | Une des deux cases décochée au consentement | Étape 4.2 : re-consentir en cochant Tasks ET Agenda |
| Page « Script function not found: doGet » au retour | Le déploiement de cette version n'est pas encore passé (`/exec` sert l'ancienne) | Attendre que la CI ait déployé (~2 min après le merge), re-cliquer l'URL de consentement |
| `redirect_uri_mismatch` au consentement | URI de la console ≠ URI affichée en (1) | Recopier l'URI exacte, Enregistrer, réessayer |
| Santé : « API … has not been used in project … » | API pas activée dans **jobai** | Étape 1 (le numéro de projet dans le message doit être celui de jobai) |
| Santé : « jeton jobai momentanément indisponible » | Blip transitoire du serveur de jetons Google | Rien à faire — reprise automatique à la sonde suivante |
| Ça marchait, puis « invalid_grant » chaque semaine | Écran de consentement resté « En test » | Étape 2.1 : publier « En production », refaire l'étape 4 |
