# Architecture technique — DriveAI

> `apps-script-quota` et `security-auditor` s'appuient sur ce document.

## Vue d'ensemble

```
┌──────────────┐  trigger 10 min   ┌──────────────────────┐
│  Gmail (PJ)  │ ────────────────▶ │  Apps Script (moteur) │
│ 00·À trier   │                   │  Gmail / Drive / Ocr  │
│ Partagés (📎)│                   │  Llm / Router / Journal│
                                   └───────────┬───────────┘
                                               │ UrlFetchApp
                                               ▼
                                   ┌──────────────────────┐
                                   │  API Anthropic (Haiku) │
                                   └──────────────────────┘
                                               │
                  état / index / journal       ▼
┌──────────────┐               ┌──────────────────────────┐
│ App web      │ ◀───────────▶ │  Google Sheet (DB légère) │
│ React/Vercel │   (Phase 4)   │  Entités · Index · Journal·│
│ (Phase 4)    │               │  Revue                    │
└──────────────┘               └──────────────────────────┘
```

## Composants

### Moteur — Google Apps Script (Phases 1–3)
- **Pourquoi** : triggers temporels natifs ; accès Gmail/Drive/Tasks/Calendar *en tant que
  Marc* (pas d'OAuth serveur à gérer) ; gratuit ; pas d'infra à héberger.
- **Modules Phase 1–2** : `Config.gs`, `Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Router.gs`,
  `Journal.gs`, `Main.gs`, `Pipeline.gs`, `Intake.gs`, `Partages.gs` (source #3 : fichiers
  partagés, ADR-0005), `Entites.gs`, `DriveRest.gs`,
  `Maintenance.gs`, `Migration.gs` (chantier #8 : campagne de re-classement de l'existant vers
  la taxonomie courante, gatée `MIGRATION_TAG`). Voir `BACKLOG.md`.
- **Modules Phase 3** (tâches & agenda) : `GoogleApi.gs` (jeton OAuth + retry partagés),
  `Tasks.gs`/`Calendar.gs` (clients REST, création uniquement), `Prefiltre.gs` (pré-filtre 3
  étages : mots-clés → zone protégée → mini-check Haiku), `Intentions.gs` (orchestration : scan de
  tous les mails récents, extraction d'intentions, création idempotente Tasks/Calendar).
- **Modules observabilité** : `Cout.gs` (mesure réelle du coût LLM — tokens `usage` agrégés par mois
  dans une Script Property), `Resume.gs` (résumé hebdomadaire automatique par mail : docs classés / en
  revue / tâches / événements / erreurs / coût mesuré du mois ; déclencheur hebdo auto-installé, scope
  `script.send_mail` existant).
- **Scopes** (`appsscript.json` → `oauthScopes`), moindre privilège — chaque scope est justifié :
  - `gmail.readonly` — lecture des mails + PJ. **Aucune écriture Gmail** (pas de label).
  - `drive` — créer/déplacer dans Drive, OCR via conversion.
  - `script.external_request` — `UrlFetchApp` vers l'API Anthropic et les API Tasks/Calendar.
  - `spreadsheets` — état (Index/Journal/Revue/Entités).
  - `script.send_mail` — **notifications d'échec à soi-même** (`MailApp`, envoi *as-self*, pas un
    scope d'envoi tiers). Requis par la DoD Phase 1 (« notif mail immédiate »).
  - `script.scriptapp` — installation/ajustement du déclencheur (`ScriptApp.newTrigger`, `CONFIG.TICK_MINUTES`). Requis par la DoD.
  - *(Phase 3)* `.../auth/tasks` (créer des tâches — l'API Tasks n'offre pas de scope plus étroit) ;
    `.../auth/calendar.events` (créer des événements, **volontairement plus étroit** que
    `.../auth/calendar` complet — pas d'accès aux paramètres d'agenda). Création UNIQUEMENT,
    jamais de lecture/modification/suppression des tâches ou événements existants de Marc.
  - *(Chantier #6, ADR-0003)* `.../auth/forms` — création + lecture du **mini-formulaire de correction**
    (`FormApp.create` + `getResponses`). `forms.currentonly` est **inapplicable** ici (il ne couvre que
    `getActiveForm()` d'un script *lié* à un formulaire, ni `create` ni `openById` en script standalone).
    ⚠️ Portée : `forms` donne accès en lecture/écriture à **tous** les formulaires du compte — intrinsèque
    à `FormApp`. Piste plus étroite (future) : API Forms REST via `UrlFetchApp` avec `forms.body` +
    `forms.responses.readonly` (cf. leçon « API Google via REST »). Aucune suppression de formulaire.
- **Idempotence sans écriture Gmail** : `gmail.readonly` interdit la pose d'un label de
  traitement. L'idempotence est donc portée **uniquement par l'`Index`** (clé
  `messageId|i|nom|taille`). La fenêtre 30 jours est paginée pour ne pas affamer les anciens
  fils. *(Correction audit 2026-07-06 : `gmail.labels` ne permettrait PAS de poser un libellé sur
  un fil — ce scope ne gère que les DÉFINITIONS de libellés ; la pose exige `gmail.modify`. C'est
  ce scope que le chantier #16 (ADR-0012) introduira — l'idempotence restera portée par l'Index,
  jamais par un libellé.)*
- **Clé API** : Script Properties `DriveAI_ANTHROPIC_KEY`, lue via `PropertiesService`.
  Jamais en dur, jamais commitée.

### État — Google Sheet
Base de données légère, lisible/éditable à la main, partagée entre Apps Script et l'app web.
- `Entités` — référentiel (Phase 2).
- `Index` — catalogue des docs classés + tags (sert la recherche Phase 4 + l'idempotence).
  Statuts : `classé`, `revue`, `tache`/`evenement` + `intention-*` (Phase 3), `doublon`, `quarantaine`.
- `Journal` — log d'exécution + erreurs.
- `Revue` — file d'attente avec suggestions (option « riche » vs nom de fichier ; cf. `PLAN.md` §7).
- `Échecs` — compteur d'échecs par document (quarantaine après `QUARANTAINE_MAX` essais ; n'est touché
  qu'en cas d'échec, jamais sur le chemin nominal).
- `Progression` — barre de chargement (texte) du grand rangement de l'ancien Drive : `[███░░░] N %`,
  « X classés / Total · reste ». Recensement une fois du total « en vrac », cumul des fichiers sortis ;
  reset auto quand `RANGEMENT_TAG` change (cf. `Maintenance.majProgression_`).

### LLM — API Anthropic
- **Haiku** par défaut (le moins cher). **Sonnet** en fallback ponctuel sur cas ambigu.
- Appel via `UrlFetchApp` (POST JSON). Prompt système de classification → **JSON strict**
  (schéma dans `PLAN.md` §4). Parsing robuste (try/catch, retry léger).
- Pré-filtre déterministe (expéditeur/type) en réserve si la facture grimpe.

### Interface — App web React/Vite/TS sur Vercel (Phase 4)
- Dashboard de revue + moteur de recherche, dans une seule UI, bilingue FR/EN.
- Lit/écrit l'état via l'API Google Sheets ou un endpoint Apps Script (`doGet`/`doPost`).
- **Inutile aux Phases 1–3** : la revue passe par le dossier `00 · À vérifier`.

## Quotas & robustesse (Apps Script)
- Limiter le scan Gmail à `newer_than:30d`, traiter **par lots**.
- Prévoir les coupures de quota (UrlFetch, conversions Drive, temps d'exécution 6 min).
- **Idempotence** : `gmail.readonly` interdit tout label → portée uniquement par l'`Index`
  (clé `messageId|i|nom|taille` pour les PJ, `intention|messageId` / `tache|…` / `event|…` pour
  les tâches/événements Phase 3) ; vérification AVANT tout traitement.
- **Pagination sur fenêtre mouvante (Phase 3)** : un offset numérique seul dérive quand de
  nouveaux mails s'insèrent en tête à chaque tick (`newer_than:30d` n'est pas un jeu de résultats
  stable). `Intentions.gs` combine un scan « avant » (offset 0, s'arrête dès une page entièrement
  déjà indexée) et un scan « arrière » ancré sur une DATE ABSOLUE persistée (jamais un offset) qui
  avance strictement vers le passé — seule façon de garantir une couverture complète sans jamais
  stagner sur un gros volume.
- Aucune suppression automatique. Aucune écriture hors des dossiers cibles (Drive) / aucune
  modification des tâches/événements existants de Marc (Tasks/Calendar — création uniquement).

## Sécurité
- Moindre privilège (scopes ci-dessus). Gmail **lecture seule**.
- Notifications système via `MailApp` sur le propre compte (pas un scope d'envoi tiers).
- Zone protégée (immigration + fiscal) jamais rangée auto — appliquée dans `Router.gs`.
- **Zone protégée étendue à Phase 3** : avant toute création de tâche/événement, `Prefiltre.gs`
  (`toucheZoneProtegee_`) teste expéditeur/sujet/corps contre une liste de mots-clés immigration/
  fiscalité, INDÉPENDAMMENT du jugement du LLM (défense en profondeur — le prompt d'extraction
  l'impose aussi, mais ce n'est pas la seule ligne de défense). Un mail sensible ne génère jamais
  de tâche/événement ; il reste géré par le classement documentaire existant.
