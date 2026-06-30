# Architecture technique — DriveAI

> `apps-script-quota` et `security-auditor` s'appuient sur ce document.

## Vue d'ensemble

```
┌─────────────┐   trigger 10 min   ┌──────────────────────┐
│  Gmail (PJ) │ ─────────────────▶ │  Apps Script (moteur) │
│ 00·À trier  │                    │  Gmail / Drive / Ocr  │
└─────────────┘                    │  Llm / Router / Journal│
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
  `Journal.gs`, `Main.gs`, `Pipeline.gs`, `Intake.gs`, `Entites.gs`, `DriveRest.gs`,
  `Maintenance.gs`. Voir `BACKLOG.md`.
- **Modules Phase 3** (tâches & agenda, en cours) : `GoogleApi.gs` (jeton OAuth + retry partagés),
  `Tasks.gs`/`Calendar.gs` (clients REST, création uniquement), `Prefiltre.gs` (pré-filtre 3
  étages : mots-clés → zone protégée → mini-check Haiku), `Intentions.gs` (orchestration : scan de
  tous les mails récents, extraction d'intentions, création idempotente Tasks/Calendar).
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
- **Idempotence sans écriture Gmail** : `gmail.readonly` interdit la pose d'un label de
  traitement. L'idempotence est donc portée **uniquement par l'`Index`** (clé
  `messageId|i|nom|taille`). La fenêtre 30 jours est paginée pour ne pas affamer les anciens
  fils. *(Alternative possible si Marc le souhaite : ajouter `gmail.labels` pour reposer le
  label `DriveAI/traité` — léger assouplissement du « lecture seule ».)*
- **Clé API** : Script Properties `DriveAI_ANTHROPIC_KEY`, lue via `PropertiesService`.
  Jamais en dur, jamais commitée.

### État — Google Sheet
Base de données légère, lisible/éditable à la main, partagée entre Apps Script et l'app web.
- `Entités` — référentiel (Phase 2).
- `Index` — catalogue des docs classés + tags (sert la recherche Phase 4 + l'idempotence).
- `Journal` — log d'exécution + erreurs.
- `Revue` — file d'attente avec suggestions (option « riche » vs nom de fichier ; cf. `PLAN.md` §7).

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
