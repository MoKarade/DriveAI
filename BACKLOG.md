# BACKLOG — DriveAI

> Épopées = phases du `PLAN.md`. Chaque tâche a un ID utilisé en préfixe de commit.
> Statuts : ⬜ à faire · 🟦 en cours · ✅ fait · ⏸️ en pause.

---

## Épopée Phase 0 — Scaffolding & automatisation  ✅

| ID | Tâche | Statut |
|----|-------|--------|
| P0-01 | Docs de référence (`PLAN`, `BACKLOG`, `CLAUDE`, `docs/*`) | ✅ |
| P0-02 | Flotte d'agents (`.claude/agents/`) | ✅ |
| P0-03 | Slash-commands (`/phase`, `/review`, `/lesson`, `/ship`) | ✅ |
| P0-04 | Hooks + boucle de leçons (`.claude/hooks/`, `settings.json`) | ✅ |
| P0-05 | CI + auto-merge (`.github/workflows/`, scripts de validation) | ✅ |
| P0-06 | Hygiène repo (`.gitignore`, `.editorconfig`, PR template) | ✅ |
| P0-07 | Documents vivants (`HANDOVER.md`, `docs/DEPLOIEMENT.md`) + tenue à jour (hook + `/handover` + check CI) | ✅ |

**DoD Phase 0 :** une PR `claude/**` se merge seule quand la CI est verte ; le `product-manager`
peut répartir une tâche ; `/lesson` met `CLAUDE.md`/`LESSONS.md` à jour ; `HANDOVER.md` reflète
l'état courant et la CI vérifie la présence des documents vivants.

---

## Épopée Phase 1 — Le cœur  🟦

> Routage **domaine + catégorie + type_doc**. Source = Gmail. Pas d'entité, pas d'app web.

| ID | Tâche | Statut |
|----|-------|--------|
| P1-01 | `appsscript.json` — manifest, `oauthScopes` minimaux (gmail.readonly, drive, script.external_request, spreadsheets, script.send_mail, script.scriptapp) | ✅ |
| P1-02 | `Config.gs` — IDs de dossiers (`docs/TAXONOMY.md`), seuil 0.80, modèle LLM, clé via `PropertiesService` | ✅ |
| P1-03 | `Gmail.gs` — recherche mails non traités, extraction des PJ, pose du label `DriveAI/traité` | ✅ |
| P1-04 | `Ocr.gs` — OCR via conversion Drive (Google Doc temporaire → texte → suppression) | ✅ |
| P1-05 | `Llm.gs` — appel Anthropic (`UrlFetchApp`), prompt de classification, parsing JSON robuste + retry Sonnet | ✅ |
| P1-06 | `Router.gs` — règles de routage (§4), renommage, sous-dossiers année, encodage de suggestion pour la revue | ✅ |
| P1-07 | `Journal.gs` — Index (idempotence) + log dans la Sheet + notif mail immédiate en cas d'échec | ✅ |
| P1-08 | `Main.gs` — orchestration + installation du trigger 15 min | ✅ |
| P1-09 | Mesure de coût LLM sur échantillon réel + extrapolation < 10 $/mois | ✅ (`Cout.gs` — tokens `usage` mesurés/agrégés par mois, affichés dans le résumé hebdo) |
| P1-10 | **Visibilité** : résumé hebdomadaire automatique par mail (docs classés / en revue / tâches / événements / erreurs / coût mesuré du mois) — déclencheur auto-installé, aucun nouveau scope | ✅ (`Resume.gs`, `Cout.gs`, `Main.gs`) |
| P1-11 | **Quarantaine** : un document en échec persistant (LLM/placement) n'est plus re-OCRisé/re-classé à chaque tick — compté (onglet `Échecs`), mis en quarantaine après `QUARANTAINE_MAX` essais (Index `quarantaine` → sauté) + une seule alerte. Échecs intermédiaires journalisés sans mail (anti-spam) | ✅ (`Journal.gs`, `Pipeline.gs`, `Config.gs`) |
| P1-12 | **Doublons → `_Doublons`** : au volume du grand rangement, signaler chaque doublon en revue sature la file. Les doublons NON sensibles sont désormais ÉCARTÉS dans un dossier `_Doublons` (déplacement seul, jamais supprimé § 2), comptés dans le résumé hebdo ; un doublon sensible reste en revue (§1). Balai manuel `nettoyerDoublonsRevue()` pour les doublons déjà en revue | ✅ (`Router.gs`, `Resume.gs`, `Maintenance.gs`) |
| P1-13 | **Lecture des fichiers Office** (.docx/.ppt/.xlsx) via conversion Google native (le trou qui envoyait tous les CV/TP en revue « OCR vide ») + re-tri auto (bump VERSION) | ✅ (`Ocr.gs`, `Config.gs`) |
| P1-14 | **Documents sensibles auto-classés** (décision Marc 2026-07-01) : `sensible`/zone protégée ne routent plus en revue → classés dans leur domaine ; doublon sensible → `_Doublons` (1 exemplaire gardé). Garde-fous conservés : aucune suppression, non-détachement de 04. Seul `domaine inconnu` reste en revue. Constitution (`CLAUDE.md` §1) mise à jour | ✅ (`Router.gs`, `Pipeline.gs`, `Config.gs`, `CLAUDE.md`) |
| P1-15 | **Rangement fiable de l'ancien Drive + barre de progression** (« je veux que ça classe tout, une petite barre de chargement pour voir ») : le grand rangement tournait EN DERNIER dans le tick → affamé (jamais de budget), l'ancien Drive ne se vidait pas. Déplacé TÔT (avant l'intake) mais gated sur file basse (`RANGEMENT_SEUIL_FILE`=40) → drainer avant d'alimenter sans famine. `RANGEMENT_TAG` bumpé `r1→r2` (inclut l'ancien Drive, relance une passe complète). Onglet `Progression` : barre texte `[███░░░] N %` (recensement une fois du total « en vrac », cumul des sortis), reset auto sur nouveau tag | ✅ (`Main.gs`, `Maintenance.gs`, `Config.gs`, `Journal.gs`) |
| P1-16 | **Un seul dossier d'arrivée + nom final direct + plus de revue** (« j'en ai deux, à trier et à ranger, je veux juste un dossier ; le nom attribué doit être direct le dernier ») : la file de revue (`00 · À vérifier`) est supprimée du pipeline. TOUT est classé au mieux avec le nom final propre (jamais `[REVUE] …`) ; un domaine introuvable → `DOMAINE_DEFAUT` (décision Marc : « classer au mieux quand même »). Fiabilise aussi la barre : recensement via un prédicat LÉGER (sans `getParents`/fichier → finit en 1 tick) + barre « recensement en cours » visible dès le 1ᵉʳ tick. `VERSION` P3.0 | ✅ (`Router.gs`, `Pipeline.gs`, `Config.gs`, `Main.gs`, `Maintenance.gs`, `Llm.gs`, `CLAUDE.md`) |
| P1-20 | **Fast-path doublon : écarter AVANT d'OCR-iser/analyser** (« mes fichiers sont déjà dans le nouveau Drive ») : le pipeline OCR-isait + analysait (LLM) CHAQUE fichier PUIS découvrait que c'était un doublon → gaspillage massif sur un ancien Drive plein de copies déjà classées. Désormais : empreinte MD5 (rapide) vérifiée EN PREMIER ; si le contenu est déjà connu → `_Doublons` **sans OCR ni LLM** (nom = date + nom d'origine). Les fichiers INÉDITS gardent la lecture complète. Gros gain de vitesse dans le cas de Marc. Set de doublons inchangé (même condition), §2 préservé (déplacement seul) | ✅ (`Pipeline.gs`, `Router.gs`) |
| P1-19 | **Fix goulot : la collecte affamait le classement** : la collecte du rangement faisait un `getParents()` (walk d'ancêtres §1) PAR FICHIER → si lente sur le gros Drive qu'un tick entier ne bougeait qu'une poignée de fichiers, sans laisser de budget à l'intake (les 8 déplacés restaient non classés). Fix : collecte via le prédicat LÉGER (nom+mime, sans `getParents`) ; garde §1 reporté INTÉGRALEMENT à la mutation (`deplacerVersATrier_`, re-vérif stricte avant chaque déplacement — validé par l'auditeur). `RANGEMENT_MAX_PAR_RUN` 200→60 (la boucle de déplacement, qui garde la re-vérif stricte, laisse ~3 min/tick à l'intake) | ✅ (`Maintenance.gs`, `Config.gs`) |
| P1-18 | **Accélération du rangement de masse** (« c'est trop lent, accélère beaucoup ») : `TICK_MINUTES` 10→5 (débit ×2), `INTAKE_PAGE` 50→150 (chaque tick utilise tout son budget-temps), `LLM_ESCALADE_MAX_PAR_RUN` 25→8 (l'escalade Sonnet ×3 est le gros coût-temps/tick ; on garde le résultat Haiku au-delà — « classer au mieux »). Plafond de fond non contournable : compte Gmail gratuit = ~90 min d'exécution/jour → ~1-2 j pour 2111 fichiers | ✅ (`Config.gs`) |
| P1-17 | **Fix : collecte avortée → faux « terminé » (l'ancien Drive ne se rangeait pas)** : le recensement voyait 113 fichiers mais la collecte réelle en ramenait 0 — `aParentProtege_`→`getParents()` levait une exception (traversée racine / Drive partagé `0AKPYZ…`), attrapée → 0 collecté → `collectes===0` figeait le rangement « terminé » (`DriveAI_RANGEMENT` figé) → tous les ticks suivants sautaient le rangement (moteur « muet »). Fix : (a) walk parent-protégé enveloppé (détection POSITIVE, false sur erreur, jamais d'exception propagée) ; (b) collecte par-fichier enveloppée (un fichier bizarre ne fige plus tout) ; (c) une collecte en erreur force `reste=true` → jamais « terminé » à tort ; (d) `RANGEMENT_TAG` r2→r3 (relance). Garde §1 préservé (détection positive de 04 intacte) | ✅ (`Maintenance.gs`, `Config.gs`) |
| fix-pipeline | **File `00·À trier` gelée** : `appliquerRangementInitial_` tournait avant l'intake et sans try/catch → un plantage gelait tout le pipeline. Corrigé : maintenance enveloppée, drainer (Gmail+dépôts) AVANT d'alimenter (rangement) | ✅ (`Main.gs`) |
| P1-13 | **Lecture des fichiers Office** : `.docx`/`.ppt`/`.xlsx` étaient envoyés en revue (« OCR vide ») car non lus. Extraction via conversion Google native (Docs/Slides/Sheets) → texte réel → classés correctement. Version bumpée (P2.8) → re-tri auto de la revue existante (Office classés, vieux doublons → `_Doublons`) | ✅ (`Ocr.gs`, `Config.gs`) |

**DoD Phase 1 :** voir `PLAN.md` §5.

---

## Épopée Phase 2 — Dépôt manuel + référentiel d'entités  🟦

> Source = Gmail **+** dépôt manuel `00·À trier` (déplacé, jamais copié). Routage à l'**entité**
> via le référentiel curé `Entités` ; entité inconnue → proposition « en_attente » + revue ;
> création des dossiers d'entité seulement après validation par Marc.

| ID | Tâche | Statut |
|----|-------|--------|
| P2-01 | Scan de `00 · À trier` (réutilise le pipeline, déplacement) | ✅ (`Intake.gs`, `Pipeline.gs`) |
| P2-02 | Onglet `Entités` — référentiel + lecture/écriture (cache 1×/run) | ✅ (`Entites.gs`) |
| P2-03 | Routage à l'entité ; entité inconnue → revue + proposition `en_attente` | ✅ (`Router.gs`) |
| P2-04 | Création auto des dossiers d'entité + sous-dossiers fixes (après validation) | ✅ (`Entites.gs`) |
| P2-05 | Multi-entités (raccourci Drive REST, jamais de copie) | ✅ (`DriveRest.gs`, `Pipeline.gs`) |
| P2-06 | Détection & signalement des doublons (empreinte MD5, jamais d'effacement) | ✅ (`Journal.gs`, `Pipeline.gs`) |
| P2.1 | Calibration : entité non validée → classée au domaine (pas en revue) | ✅ (`Router.gs`) |
| P2.2 | **Full auto** : auto-déploiement (`clasp push` sur merge) + auto-rejeu sur bump `CONFIG.VERSION` | ✅ (`deploy.yml`, `Main.gs`, `Config.gs`) |
| P2.3 | Seuil de confiance 0.80 → **0.50** + auto-rejeu des `[REVUE] confiance` (déplacement seul) | ✅ (`Config.gs`, `Main.gs`) |
| P2.4 | Déclencheur **15 → 10 min** (`CONFIG.TICK_MINUTES`) + ré-installation auto au déploiement (création avant suppression) | ✅ (`Config.gs`, `Main.gs`) |
| P2.5 | **Escalade** : confiance basse (non sensible) → analyse approfondie Sonnet ×3 (consensus) → classé au meilleur endroit, plus en revue. Plafonné/run | ✅ (`Llm.gs`, `Router.gs`, `Config.gs`) |
| P2.6 | **Grand rangement auto** : tout le contenu « en vrac » des domaines renvoyé au fil des ticks vers 00·À trier → reclassé/renommé par le pipeline. Zéro clic (gated `CONFIG.RANGEMENT_TAG`), borné/run, reprenable, déplacement seul, zone protégée écartée | ✅ (`Maintenance.gs`, `Main.gs`, `Config.gs`) |
| P2.7 | **Rangement étendu à l'ancien Drive** (« Ancienne structure », `RANGEMENT_RACINES_SUP`) + garde-fou OCR vide : un dépôt (manuel ou rangement) sans texte OCR exploitable part en revue (« sensibilité indéterminable ») au lieu d'être classé sur le seul nom de fichier — ferme un trou réel sur les vieux scans (passeport/fiscal à nom neutre) | ✅ (`Config.gs`, `Maintenance.gs`, `Pipeline.gs`, `Router.gs`) |
| fix-ci | Auto-déploiement : dispatch après auto-merge + Node 20 (clasp) | ✅ (`auto-merge.yml`, `deploy.yml`) |
| fix-gel | **Hotfix pipeline gelé** : la file `00·À trier` stagnait (grand rangement non protégé + placé AVANT le drainage → une erreur de collecte gelait tout le tick). Étapes secondaires (rejeu, rangement, entités) enveloppées de try/catch ; rangement déplacé APRÈS l'intake (drainer avant d'alimenter) ; scan Gmail durci par fil | ✅ (`Main.gs`) |

**Reste côté Marc :** **2 secrets GitHub une fois** (`CLASPRC_JSON`, `SCRIPT_ID` — cf.
`docs/DEPLOIEMENT.md`) pour activer l'auto-déploiement. Ensuite, plus aucune action manuelle :
nouveaux mails + dépôts traités par le trigger ; code déployé par l'Action ; reclassement par l'auto-rejeu.

**Limites assumées (suivi) :** raccourcis multi-entités et copie Gmail non idempotents au rejeu
(compromis « Index en dernier ») ; un document en échec LLM persistant est re-tenté à chaque tick
(pas encore de quarantaine après N échecs).

---

## Épopée Phase 3 — Tâches & agenda (remplace l'agent mail externe de Marc)  🟦

> Source = TOUS les mails récents (pas seulement ceux avec PJ). Pré-filtre 3 étages pour le budget
> (mots-clés → zone protégée → mini-check Haiku). Création 100 % auto (zéro validation) : action/
> échéance → Google Tasks, rdv daté → Google Calendar. Décisions actées avec Marc le 2026-06-30.

| ID | Tâche | Statut |
|----|-------|--------|
| P3-03 | Scopes `tasks`/`calendar.events` (manifest) + clients REST `Tasks.gs`/`Calendar.gs`/`GoogleApi.gs` (création uniquement, jamais lecture/suppression) | ✅ |
| P3-04 | Pré-filtre 3 étages (`Prefiltre.gs`) : mots-clés rejet (gratuit) → zone protégée (gratuit, défense en profondeur indépendante du LLM) → mini-check Haiku (expéditeur+sujet seuls, ~10 tokens sortie) | ✅ |
| P3-01 | Extraction d'intentions (LLM, `PROMPT_INTENTIONS`/`extraireIntentions_`) + routage Tasks vs Calendar (date+heure → événement, sinon tâche) | ✅ (`Llm.gs`) |
| P3-02 | Scan élargi à tous les mails récents (`GMAIL_REQUETE_ACTIONS`) ; orchestration + idempotence à 2 niveaux (`intention\|messageId`, `tache\|…`/`event\|…`) ; ID client Calendar déterministe (rejeu → 409 = succès, jamais de doublon) | ✅ (`Intentions.gs`, `Gmail.gs`) |
| P3-05 | Pagination robuste sur fenêtre mouvante : scan « avant » (nouveau mail) + scan « arrière » ancré sur date absolue persistée (rattrapage de l'historique, jamais d'offset numérique qui stagnerait) | ✅ (`Intentions.gs`) |

**Re-audité par la flotte (4 spécialistes, 2 passes)** : security-auditor 🟢 (zone protégée en
défense en profondeur, aucun autre chemin de création, scopes minimaux) ; llm-cost-optimizer 🟢
(~1-4 $/mois estimé pour ce flux, largement sous la cible) ; file-checker 🟢 (idempotence saine,
ID Calendar bien scopé par message) ; apps-script-quota — 1er passage BLOQUANT (l'offset de
pagination repartait de 0 à chaque tick → stagnation au-delà des ~200 premiers messages sur un
volume réaliste), corrigé (scan arrière à date absolue persistée), 2e passage 🟢 CONFORME.

**Reste côté Marc :** **une ré-autorisation Google unique** (nouvel écran de consentement Tasks/
Calendar — cf. `docs/DEPLOIEMENT.md` § Phase 3) après le prochain déploiement. Ensuite, zéro action
manuelle récurrente, comme le reste du moteur.

**Limites assumées (suivi)** : Google Tasks n'offre pas d'ID client idempotent (contrairement à
Calendar) — une coupure pile entre la création d'une tâche et l'écriture Index pourrait créer un
doublon au rejeu (même compromis déjà accepté pour la copie Gmail). Granularité jour du curseur
`before:` du scan arrière (risque résiduel mineur, borné à un seul jour, une seule fois).

---

## Conception produit (brainstorm 2026-07-01)  📐

> Le **dossier de conception** vit dans `docs/adr/` (8 ADR : cadrage, taxonomie, contrôle, fiabilité,
> sources, architecture/qualité, sécurité/vie privée, app web) et `docs/ROADMAP.md` (9 chantiers priorisés,
> socle #1 = **fondation testable**). Ces ADR décrivent la **cible** — l'implémentation viendra en chantiers
> dédiés. Le prochain pas concret est le **chantier #1 (fondation testable : logique pure isolée + filet de
> tests CI + Journal borné/onglet `Santé`)**, cf. ADR-0006. NB : P4-04 ci-dessous est révisé par **ADR-0008**
> — plein texte **délégué à l'index natif de Drive** (pas d'OCR ré-indexé côté app), pour respecter ADR-0007
> (métadonnées seulement).

### Chantier #1 — Fondation testable (ADR-0006)  ✅ socle posé

| ID | Tâche | Statut |
|----|-------|--------|
| C1-01 | Harness Node (`test/harness.js`) : charge les `.gs` en bac à sable `vm`, mocks Google déterministes, faux Drive (`getParents` qui peut lever) | ✅ |
| C1-02 | Filet de tests de la logique de décision : routage/nommage (`champ_`, `nomNormalise_`, `extension_`, `cheminLisible_`), dates (`dateNormalisee_`), entités (`normaliserCle_`, `sousDossierPourType_`), prédicats de collecte | ✅ (50 tests au total) |
| C1-03 | Tests du **garde-fou §1** (`aParentProtege_`/`chaineMonteVersProtege_`) : zone protégée jamais détachée — multi-parents, chaîne d'ancêtres, échoue-fermé (mutation) / ouvert (collecte), borne anti-cycle | ✅ |
| C1-04 | Test **invariant vie privée** (ADR-0007) : `indexAjouter_` **et** `majSante_` n'écrivent que des métadonnées, jamais le corps d'un document | ✅ |
| C1-05 | Job CI « Tests unitaires (logique pure) » (`node --test test/*.test.js`, Node 20, **zéro dépendance**) | ✅ |
| C1-06 | **Journal borné** (`lignesJournalASupprimer_` + `bornerJournal_`, rotation en lot à hystérésis) + onglet **`Santé`** (`majSante_` : heartbeat, catalogue, coût du mois, statut rangement) | ✅ |

> Reste ouvert (non bloquant, au fil des chantiers) : étendre la couverture de tests, poursuivre le refactor
> pur↔effets de bord. Revue flotte 🟢 (security-auditor CONFORME, apps-script-quota CONFORME, code-reviewer 🟢).

### Chantier #2 — Chien de garde (ADR-0004)  ✅

| ID | Tâche | Statut |
|----|-------|--------|
| C2-01 | **Heartbeat** `DriveAI_LAST_TICK` écrit dans le `finally` de `tickDriveAI` (1 Property, robuste) | ✅ |
| C2-02 | **2ᵉ déclencheur** `chienDeGarde` (`assurerTriggerChienDeGarde_`, create-if-absent ; posé par `installerTrigger` + en tête de tick) | ✅ |
| C2-03 | **Décision pure** `actionChienDeGarde_` — machine à 3 états (détecter → réparer → alerter), dédupée par épisode | ✅ (7 tests) |
| C2-04 | **Auto-réparation** (`installerTrigger`, avec re-vérif `presenceTriggerTick_` pour ne pas fausse-alerter si un log échoue) puis **alerte** mail rassurante dédupée ; watchdog trivialement robuste | ✅ |
| C2-05 | **État du système** au résumé hebdo (`etatSysteme_`, ADR-0004 point 4) | ✅ (3 tests) |

> 60 tests au total. **Revue flotte 🟢** (security CONFORME, quota CONFORME — correctif A1 « pas de fausse
> alerte si un log échoue après réparation » appliqué, code-reviewer 🟢 — commentaire `installerTrigger` rafraîchi).

### Chantier #3 — Nommage par type + deviner-du-nom + `07·Santé`/`_Technique` (ADR-0002)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C3-01 | **Nommage par type** (`Router.nomParType_`/`schemaNommage_`/`tronquerDate_`) : granularité de date (jour/mois/année) + libellé fixe (`Relevé`/`Paie`/`CV`) par type, dégradation gracieuse vers le format historique | ✅ (9 tests, NAMING.md à jour) |
| C3-02 | **Deviner le type depuis le nom d'origine** (`Router.devinerTypeDepuisNom_`/`enrichirClassifDepuisNom_`) quand le LLM ne rend pas de type — ex. `…_TP4_…` → « TP ». Appelé avant le routage, sans jamais écraser un type trouvé | ✅ (5 tests) |
| C3-03 | Nouveaux dossiers **`07 · Santé`** (domaine auto-créé `dossierDomaineAuto_`, proposé au LLM) + **`_Technique`** (code/CAO par extension `EXT_TECHNIQUES` → routés sans OCR/LLM). Renumérotage **Perso 07 → 08** (self-healing `assurerNomsDomaines_`, renommage seul, réversible) | ✅ (6 tests) |

### Chantier #4 — Entités : validation 1-clic + garde anti-variantes (ADR-0002 §4)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C4-01 | **Moteur de similarité PUR** (`Entites.gs`) : `tokensEntite_`/`jaccardTokens_`/`distanceLevenshtein_`/`similariteEntite_`/`chercherVariante_` — Jaccard + inclusion + Levenshtein | ✅ (8 tests) |
| C4-02 | **Garde anti-variantes** : à la proposition d'une entité (`entiteEnAttenteAjouter_`), signaler la plus proche existante du même domaine dans une colonne `Variante possible ?` (seuil `CONFIG.SEUIL_VARIANTE`). **Suggestion seule, jamais de fusion auto** | ✅ |
| C4-03 | **Validation 1-clic** (mail hebdo → mini-formulaire ; fusion d'une variante ou création) | ✅ couvert par l'app web (#9, onglet Corrections : Statut→« validée » en 1 clic) |

### Chantier #5 — Boucle d'apprentissage (ADR-0003 §3)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C5-01 | **Onglet `Corrections`** (`Corrections.gs`) : `Fichier\|Émetteur\|Domaine\|Catégorie\|Entité\|Type\|Corrigé le`, lu en cache 1×/run ; primitive `enregistrerCorrection_` (append idempotent via `cleCorrection_`) | ✅ |
| C5-02 | **Sélection few-shot PURE** : `scoreCorrection_` (pertinence par émetteur), `correctionsPertinentes_` (top-N ≥ seuil, tri stable), `blocFewShot_` (formatage) — bornée `FEWSHOT_MAX`/`FEWSHOT_SEUIL` | ✅ (6 tests) |
| C5-03 | **Injection au prompt** : `appelAnthropic_` préfixe les corrections du même émetteur (try/catch → dégrade à 0 exemple si onglet illisible) | ✅ |
| C5-04 | **Canal de saisie** (mail → mini-formulaire ; corrections d'entité → référentiel validé) | ✅ (chantier #6, ci-dessous) |

### Chantier #6 — Correction via formulaire Google (ADR-0003 §1-2)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C6-01 | **Formulaire de correction** (`Formulaire.gs`) : find-or-create (`assurerFormulaireCorrection_`, ID en Script Property), champs Émetteur (requis)/Domaine (liste)/Entité/Fichier. **Nouveau scope `forms`** dans `appsscript.json` | ✅ |
| C6-02 | **Lecture + enregistrement** : `lireEtAppliquerCorrections_` (1×/tick, AVANT l'intake) lit les nouvelles réponses (idempotence par horodatage `PROP_FORM_DERNIER`), les enregistre via `enregistrerCorrection_` (⇒ few-shot #5). Borné `CORRECTIONS_MAX_PAR_RUN` + garde-temps, enveloppé try/catch | ✅ |
| C6-03 | **Parsing PUR** `reponseVersCorrection_` + `domainesPourFormulaire_` + lien du formulaire au résumé hebdo | ✅ (5 tests) |
| C6-04 | **Promouvoir l'entité corrigée en « validée »** (`promouvoirEntiteValidee_` : find-or-create validée, idempotent no-op sans I/O si déjà validée) → dossier matérialisé au tick suivant + routage l'utilise. Validation EXPLICITE de Marc = pas d'auto-prolifération | ✅ (test `correctionValideUneEntite_`) |
| C6-05 | **Déplacer/renommer le FICHIER déjà classé** d'après la correction (champ « Fichier concerné ») | ✅ couvert par l'app web (#9, « Reclasser un document » : recherche → déplacement immédiat sous garde-fous + few-shot) |

> ⚠️ **Ré-autorisation Marc requise** : le scope `forms` (création/lecture du formulaire) s'ajoute au prochain déploiement — Marc doit ré-accorder l'accès Google une fois (frontière d'exécution : la session Claude ne peut pas le faire).

### Chantier #7 — Sources d'entrée : fichiers partagés (ADR-0005)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C7-01 | **Décisions PURES** (`Partages.gs`) : `estTypeDocumentPartage_` (allowlist images + PDF/Office), `partageRecent_` (fenêtre glissante, prudent si date absente), `stockagePresquePleinCalc_` (illimité/inconnu ne bloque jamais) | ✅ (7 tests) |
| C7-02 | **Accès Drive REST** : `listerPartagesRecents_` (`files.list sharedWithMe`, tri `sharedWithMeTime desc`, paginé, retry), `quotaStockage_` (`about.get`) — via UrlFetchApp, aucun nouveau scope | ✅ |
| C7-03 | **Collecteur** `collecterPartages_` : filtre type+récence (tri-état `classerRecencePartage_` : date absente ⇒ saut d'item, pas de STOP global), garde de taille (`PARTAGES_TAILLE_MAX`), saute déjà-indexés (`shared\|fileId`), COPIE via `traiterPartage_`→pipeline commun (dédup MD5, OCR, LLM, routage ; blob téléchargé 1× mémoïsé). Borné `PARTAGES_MAX_PAR_RUN` + garde-temps, storage-aware (vérif lazy + alerte unique) | ✅ |
| C7-04 | **Câblage tick** : source #3 après Gmail+dépôts, AVANT intentions Phase 3 ; budget-gatée + enveloppée try/catch (ne bloque jamais l'intake) | ✅ |

> Aucun nouveau scope OAuth (`drive` couvre les partages). Convergence : petite fenêtre de récence + skip des déjà-copiés + cap sur les copiés → chaque tick progresse (pas de plateau, contrairement à l'historique Gmail).

### Chantier #8 — Migration de l'existant vers la nouvelle taxonomie (ADR-0002)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C8-01 | **Campagne gatée** (`Migration.gs`) : `appliquerMigrationTaxonomie_` (tag `MIGRATION_TAG`, attend la fin du grand rangement), `migrerUnePage_` (page bornée `MIGRATION_MAX_PAR_RUN` + garde-temps, anti-« faux terminé » P1-17), fin figée seulement quand une passe complète collecte 0 | ✅ |
| C8-02 | **Re-traitement EN PLACE** : `migrerFichier_` — clé DÉDIÉE `migre\|tag\|fileId` (additive, l'idempotence Gmail/dépôts/partages intacte), `ignorerDoublon` (jamais « doublon de soi-même »), placement = `renommer_` (même dossier) ou `deplacerEtRenommer_` (move-only), blob mémoïsé, nom courant passé au LLM (signal deviner-du-nom) | ✅ |
| C8-03 | **Zone protégée** : `04` exclue des racines + revérif STRICTE avant mutation ; refus inscrit `zone protégée` sous la clé migre\| (fichier NON touché, campagne convergente) | ✅ |
| C8-04 | **Fix convergence rangement** : `estAReclasser_`/`estAReclasserLeger_` reconnaissent les 3 granularités du nommage par type (`AAAA_`, `AAAA-MM_`, `AAAA-MM-JJ_`) — sans quoi une future campagne de rangement re-collecterait les noms par type en boucle infinie | ✅ (testé) |

| C8-05 | **Correctifs revue flotte** : quarantaine sur doc illisible pré-pipeline (sinon la campagne ne se fige jamais) + try par item (un doc empoisonné n'affame plus la page) + **sous-budget `MIGRATION_BUDGET_MS`** (2 min/tick — protège le quota JOURNALIER ~90 min/j des triggers : l'intake reste vivant toute la journée pendant la campagne) + `creerRaccourci_` idempotent (`raccourciExiste_` — un re-classement ne duplique plus les raccourcis multi-entités) | ✅ |

> Bumper `MIGRATION_TAG` (m2, m3…) relance une campagne complète — utile après une validation d'entités en masse (les docs rangés au domaine redescendent aux entités). Coût estimé par la flotte : ~3-5 $ one-shot pour quelques centaines de docs (Haiku + escalades plafonnées), campagne étalée sur 1-2 jours. Dédup intra-campagne des vrais doublons : optionnelle, à décider sur du réel (post-m1, si `_Doublons` le justifie).

### Chantier #10 — Entités propres (ADR-0009 §1)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C10-01 | **Prédicats PURS** : `jetonsQualite_` (ponctuation neutralisée, connecteurs ignorés), `estEntiteGenerique_` (générique ssi TOUS les jetons ∈ `LEXIQUE_GENERIQUE_ENTITE` — calibré sur la file réelle du 2026-07-02), `estFusionnableEntite_` (INCLUSION de jetons seulement — « Honda Civic 2014 » ≠ « 2017 », jamais Levenshtein) | ✅ (tests calibrés sur les vraies lignes) |
| C10-02 | **Proposition filtrée + consolidée** (`entiteEnAttenteAjouter_`) : générique → jamais proposé ; fusionnable avec une ligne existante → incrément « Vu N fois » (nouvelle colonne, signal de fréquence) au lieu d'une n-ième ligne | ✅ |
| C10-03 | **Prompt LLM corrigé** : l'ancien schéma ENSEIGNAIT les génériques (« (logement, véhicule, banque, diplôme...) » recrachés mot pour mot en prod) → « NOM PROPRE identifiable… sinon null », exemples positifs/négatifs | ✅ |
| C10-04 | **Curation one-shot** (`appliquerCurationEntites_`, tag `c1`) : file existante — génériques → « refusée (générique) », doublons par inclusion → « variante de : X » (canonique = la plus courte, cumule les Vu). STATUTS seulement, réversible, borné, tag figé après passe complète. Câblée au tick (secondaire, enveloppée) | ✅ |

### Chantier #11 — Fast-path médias bruts (ADR-0009 §2)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C11-01 | **Prédicats PURS** (`Router.gs`) : `estMediaDirect_` (vidéo/audio/gif — jamais un document), `estPhoto_`, `estNomNonDocumentaire_` (ID numérique ≥ 8 chiffres — export Facebook —, compteurs IMG_/DSC/PXL, captures) — calibrés sur les vrais noms en file | ✅ |
| C11-02 | **Deux branches pipeline** : média direct → `_Médias` SANS OCR ni LLM (après le fast-path doublon : un doublon de vidéo va dans `_Doublons`) ; photo « nom non-doc ET extrait OCR < `MEDIAS_OCR_MAX_CARS` » → `_Médias` sans LLM — **l'OCR reste le juge** (§1) : un scan de passeport nommé `IMG_2734.jpg` contient du texte → analyse complète (testé) | ✅ |
| C11-04 | **Revue sécurité intégrée** : R1 — le fast-path photo exige un OCR TENTÉ (taille ≤ max ; une photo > 20 Mo garde son analyse) ; R3 — un mot-clé protégé dans le NOM (« passeport », « visa »…) rend le fichier documentaire quoi qu'il arrive | ✅ (testé) |
| C11-05 | **R2/P2 fait** : `extraireTexte_` renvoie désormais **null sur ÉCHEC** (panne/quota — le juge n'a pas siégé → jamais de fast-path, le doc va au LLM comme avant) vs `''` = vraiment sans texte | ✅ |
| C11-06 | **Revue intake intégrée** : P1 — blob PARESSEUX (une vidéo de 300 Mo ne lève plus getBlob → `_Médias` au lieu de quarantaine) ; P3 — un fichier déjà traité (clé `drive\|`) n'est jamais re-collecté par le rangement (un média ressorti de `_Médias` ne reste plus coincé dans `00·À trier`) | ✅ (testé) |
| C11-03 | **`_Médias`** (racine `_`, find-or-create, ID en Script Property `DriveAI_MEDIAS_ID`) : nom d'ORIGINE conservé (traçabilité — les noms d'export sont leurs identifiants) ; jamais re-scanné (hors domaines, comme `_Doublons`/`_Technique`) | ✅ |

### Chantier #12 — Historique Gmail complet (ADR-0010 §1)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
> ⚠️ Premier design (curseur rétrograde « jour le plus ancien + 1 ») **démoli par la vérif adversariale** :
> Gmail trie les fils par DERNIER message ⇒ un vieux fil ravivé téléportait le curseur (PJ perdues) ;
> un jour à > 10 fils ⇒ plateau infini ; pas de sous-plafond ⇒ quota runtime épuisé en ~2 h. Réécrit,
> puis une **2ᵉ contre-vérification** a durci la réécriture (C12-04). Design final :

| ID | Tâche | Statut |
|----|-------|--------|
| C12-01 | **Primitives PURES** (`Gmail.gs`) : `dateGmail_` (yyyy/MM/dd), `requeteHisto_` (`has:attachment before:<ancre>` — l'ancre est FIGÉE une fois pour toutes ⇒ l'APPARTENANCE à l'ensemble est stable, l'offset y est donc sûr — leçon « pagination mouvante » respectée : c'est le mouvant qui est interdit, pas l'offset ; l'ORDRE peut bouger, couvert par C12-04), `pageFilsHisto_(ancre, offset)` | ✅ (tests) |
| C12-02 | **Campagne** `traiterGmailHistorique_` (`Main.gs`) : ancre posée UNE fois à −30 j (`DriveAI_GMAIL_HISTO_ANCRE`, le vivant couvre le récent), offset persistant (`…_OFFSET`) qui n'avance que si la page est COMPLÈTE (budget/plafond au milieu ⇒ rejeu de page, idempotence Index = gratuit, converge), plafond `GMAIL_HISTO_MAX_PJ_INEDITES`/run (2 — protège le quota runtime ~90 min/j : le vivant garde la priorité), PJ déjà indexées GRATUITES (ne comptent pas) | ✅ (tests d'orchestration) |
| C12-03 | **Câblage** : après le flux vivant, avant migration/intentions ; enveloppé + budget-gaté ; surface au contrat (`pageFilsHisto_`, `requeteHisto_`, `dateGmail_`, `traiterGmailHistorique_`, `incrementerEchec_`) | ✅ |
| C12-04 | **Durcissements de la 2ᵉ contre-vérification** : (P3, la clé) une page vide ne fige « terminé » que si la passe n'a RIEN collecté — sinon offset remis à 0, **passe de VÉRIFICATION** (guérit : fil ravivé par un message SANS PJ — invisible du vivant car Gmail matche PAR message —, fil glissé sous l'offset par une suppression, fil sauté sur erreur transitoire ; re-passe quasi gratuite, convergence garantie car l'Index ne fait que croître) ; (P4) garde-temps + plafond vérifiés **PAR PJ** (un message à 20 PJ ne crève plus le mur des 6 min), aussi appliqué au scan VIVANT (`traiterFil_`) ; (P5) fil en erreur : compteur d'Échecs `histo\|fil\|<id>`, revisité par la passe suivante, ABANDONNÉ après 3 essais (la terminaison n'est jamais bloquée, la trace reste) ; (P6) doc du plafond corrigée (un doublon MD5 COMPTE) ; (P7) limite « mail ancien arrivé tardivement » documentée dans l'ADR | ✅ (tests) |
| C12-05 | **Durcissements de la 3ᵉ contre-vérification** (workflow 3 lentilles sur l'implémentation) : (a) **budget QUOTIDIEN** `GMAIL_HISTO_BUDGET_JOUR_MS` (20 min/j, ms réels persistés par jour) — le plafond par RUN ne borne pas la JOURNÉE : 288 ticks × 25 s = 2 h/j > quota runtime ~90 min/j, tous les déclencheurs (chien de garde inclus) auraient gelé chaque après-midi de campagne ; (b) échec de fil compté **à la COMPLÉTION de page seulement** — une page rejouée (plafond/budget) re-rencontrait le fil toutes les 5 min et brûlait les 3 essais en 15 min sur une erreur transitoire ; une erreur qui guérit avant complétion ne laisse AUCUNE trace ; (c) garde budget/plafond **à chaque niveau de boucle** (fil, message, PJ) — une page de fils bavards sans PJ « réelles » (inline) faisait ~1000 appels Gmail APRÈS le budget ; (d) ancre à **−29 j** (`before:` exclusif + `newer_than:30d` glissant = trou possible sur install fraîche) ; (e) terminaison à **DEUX passes propres consécutives** (une suppression PENDANT la passe de vérification peut masquer un fil) ; abandon annoncé UNE fois puis silencieux | ✅ (16 tests) |

### Chantiers #13-#14 — Phase 3 visible & mails importants (ADR-0010 §2-3)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C13-01 | **Résumé hebdo : « Actions & RDV détectés »** — chaque tâche/événement créé dans la semaine est NOMMÉ (✅/📅 + titre, depuis les lignes Index `tache\|`/`event\|`), plafonné `RESUME_ACTIONS_MAX` avec « … et N de plus » (totaux exacts, collecte bornée) | ✅ (tests) |
| C13-02 | **App : section dashboard « Actions & RDV »** — lecture seule (`lignesActions`), icône par type, lien « Ouvrir le mail » reconstruit depuis la clé (`lienGmailPourLigne`) ; les clés mail (`important\|` incluse) restent EXCLUES de la Recherche (sections dédiées) | ✅ (tests vitest) |
| C14-01 | **Mini-check à DEUX signaux en UN appel** (`miniCheckMail_` remplace `miniVerifActionRdv_`, surface mise à jour) : JSON `{action, important}` (24 tokens de sortie), parse PUR `parserMiniCheck_` avec dégradations ASYMÉTRIQUES — `action` OUVERTE sur échec (ne jamais rater une vraie action), `important` FERMÉ sur échec (anti-bruit, décision Marc) + compat « NON » hors JSON | ✅ (tests) |
| C14-02 | **Flag persisté** : `marquerMailImportant_` → ligne Index `important\|<messageId>` (statut `important`, nom = sujet — métadonnées seules ADR-0007), idempotente, posée AVANT le tri action/pas-action (une question ouverte sans action créable remonte quand même) ; jamais pour un mail en zone protégée (gardes amont) ; AUCUNE écriture Gmail (§3), aucune notification immédiate | ✅ (tests) |
| C14-03 | **Résumé hebdo : « À traiter »** — sujets + lien Gmail (`#all/<messageId>`, couvre l'archivé), plafonné `RESUME_IMPORTANTS_MAX`, section absente si vide ; même section au dashboard app (`lignesImportants`) ; statut `important` compté à part (ne pollue pas « Autres ») | ✅ (tests) |
| C14-04 | **Revue flotte intégrée** (1 bloquant + 2) : (S1, bloquant) le CORPS est lu et la garde §1 re-vérifiée dessus AVANT la pose du flag — y compris sur le chemin « important sans action » qui ne lisait jamais le corps (un mail protégé détectable par son corps seul n'apparaît JAMAIS dans « À traiter ») ; le chemin « rien vu » reste gratuit (corps pas lu, testé) ; (C1) critère `important` RESSERRÉ : réponse/geste PERSONNEL attendu, jamais relevé/confirmation/reçu/facture récurrente/offre (leçon « garde-fou étroit » — sinon les relevés mensuels satureraient la section et relégueraient les vraies questions) ; (R1) le dashboard exclut les lignes « mail » des agrégats documents (plus de double compte d'activité ni de bucket « — ») | ✅ (tests) |

### Correctif R1 — Panne de compte API & canal d'alerte (check-up 2026-07-03)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| R1-01 | **Garde « panne de PLATEFORME »** (`Llm.gs`) : HTTP 400 « credit balance » / 401 ⇒ panne de COMPTE, jamais imputée aux documents — `gererEchec_` ne compte RIEN pendant la panne (incident réel : crédit épuisé le 01-07 20:56 → ~89 docs quarantainés à tort en 2 jours), le pipeline saute les docs (pas d'OCR/mutation), les appels LLM du run échouent VITE (sans réseau), journal UNE fois par run, re-sonde au run suivant | ✅ (tests) |
| R1-02 | **Canal d'alerte réparé SANS nouveau scope** : `Session.getEffectiveUser()` exige un scope (userinfo) ABSENT du manifeste → 597 alertes mortes en silence depuis le début (chien de garde, quarantaines, résumé hebdo). `emailAlerte_()` lit la Script Property **`DriveAI_EMAIL`** (repli Session, ne lève jamais) ; sans destinataire → trace explicite au Journal. Câblé partout : notifierEchec_, chien de garde, alerte stockage, résumé hebdo | ✅ (tests) |
| R1-03 | **Reste côté Marc** : (1) **recharger le crédit Anthropic** (console.anthropic.com → Billing — panne active depuis le 01-07 20:56) ; (2) poser la Script Property `DriveAI_EMAIL` = son adresse ; (3) après recharge, UN clic `dequarantaine()` (éditeur Apps Script) pour re-tenter les ~89 docs quarantainés à tort (les ~64 photos Facebook coincées dans 00·À trier passeront par le fast-path médias, quasi gratuit) | ⬜ |

### Correctif R2 — Panne persistée : sources suspendues, quota Gmail préservé (2026-07-06)  🟦

> Suite directe de R1, découverte à la reprise : pendant les 4 jours de panne crédit, les scans
> Gmail re-parcouraient TOUTE la fenêtre à chaque tick sans jamais rien marquer (rien ne s'indexe
> pendant une panne) → des dizaines de milliers de lectures/jour → **quota Gmail quotidien épuisé**,
> moteur re-bloqué 24 h APRÈS la recharge de Marc. R1 protégeait les documents ; R2 protège les quotas.

| ID | Tâche | Statut |
|----|-------|--------|
| R2-01 | **Panne PERSISTÉE** (`DriveAI_LLM_PANNE`, posée par `signalerPannePlateforme_`) : en tête de run, `chargerPannePlateforme_` — panne fraîche (< `LLM_PANNE_RESONDE_MS` = 1 h) → le tick SUSPEND toutes ses sources (Gmail, dépôts, partages, campagnes, migration, intentions, rangement) ; fenêtre écoulée → run « re-sonde » normal dont le 1ᵉʳ appel LLM tranche (200 → `signalerRetablissement_` efface la Property + journal « RÉTABLI » ; échec → re-posée à neuf). Au plus UN scan complet par heure de panne | ✅ (tests) |
| R2-02 | **Early-exit des scans** si la panne est détectée EN COURS de run (re-sonde qui échoue) : `traiterGmail_` (boucle + par fil), `plafondAtteint` des intentions, `doitSarreter` de la campagne historique — plus un seul parcours de fenêtre stérile | ✅ (tests) |
| R2-03 | **Bruit maîtrisé** : un fichier Google natif laissé dans `00·À trier` n'est plus journalisé qu'UNE fois (`signalerNatifUneFois_`, Property bornée) — avant : 2 natifs = ~576 lignes/jour qui polluaient le diagnostic | ✅ (tests) |

### Chantier #15 — App v2 : curation efficace & confort (ADR-0011)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C15-01 | **Fusion 1-clic** : la suggestion « → X (90 %) ? » devient un bouton — la ligne passe « variante de : X » (statut inerte, réversible, rien de supprimé) ; `cibleFusion` pur testé | ✅ |
| C15-02 | **Rejet en masse** : cases à cocher + « Refuser la sélection » — écritures cellule par cellule (jamais de batch destructif) ; badge ×N (« Vu N fois ») affiché | ✅ |
| C15-03 | **Dashboard enrichi** : graphe d'activité 30 jours (barres CSS, `activiteParJour` pur testé) + **liste de quarantaine avec « Relancer »** | ✅ |
| C15-04 | **Relances pilotées par la Sheet** (frontière d'exécution) : l'app APPEND une demande (onglet `Relances`) ; le MOTEUR consomme au tick (`appliquerRelancesQuarantaine_` : retire la ligne Index « quarantaine » de la clé + son compteur Échecs — jamais une ligne d'un autre statut). Étape secondaire enveloppée + budget-gatée | ✅ (3 tests moteur) |
| C15-05 | **PWA** : manifest + icône SVG + service worker PASSE-PLAT (zéro cache — fraîcheur des données), installable sur téléphone | ✅ |

### Chantier #9 — App web Phase 4 (ADR-0008)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C9-01 | **Scaffold** `app/` : SPA React/Vite/TS **sans backend** (l'app parle aux API Google avec le jeton de l'utilisateur, rien de public, aucun secret embarqué). Login Google (GIS token flow, jeton en mémoire jamais persisté), config par env Vite OU écran (localStorage), UI bilingue FR/EN | ✅ |
| C9-02 | **Garde-fous MIROIR testés** (`garde-fous.ts`, contrainte non négociable ADR-0008) : `detachementAutorise` (chaîne d'ancêtres multi-parents, échec fermé), `verdictReclassement` (point de passage obligé avant toute mutation), `nomEstNormalise` (3 granularités), `normaliserCle`. + test « **surface de code sans suppression** » (aucun DELETE/trashed/deleteRange dans `src/` — verrouillé au niveau source) | ✅ (27 tests vitest) |
| C9-03 | **Tableau de bord** : onglet `Santé` + activité récente (Journal) + comptage par domaine (Index). Lecture seule | ✅ |
| C9-04 | **Corrections** : **validation 1-clic des entités** (Statut→« validée », lu PAR EN-TÊTES réels — reste du chantier #4 ✅) + **reclassement immédiat** d'un document (recherche Drive par nom → déplacement/renommage via API sous verdict garde-fous → **journalisé dans `Corrections`** ⇒ few-shot ADR-0003) | ✅ |
| C9-05 | **CI dédiée** (job `app` : npm ci, vitest, tsc+build) + doc de déploiement (`DEPLOIEMENT.md` §Phase 4 : client OAuth + Vercel, ~10 min côté Marc) | ✅ |
| C9-06 | **Correctifs revue flotte** — sécurité 🟢 (motifs anti-suppression renforcés `:clear`/`/trash`/méthode non littérale, backslash échappé, CSP) ; code 🟠→réglé : **journalisation Corrections COMPLÈTE** (émetteur pré-rempli du nom + domaine datalist Index + entité — sans quoi la ligne était MORTE pour le few-shot), écriture par en-têtes réels, **401 → rebascule connexion**, cible retirée de `removeParents` (déjà en place ⇒ renommage seul), recherche sans dossiers, plages larges (Z), **destination = lien Drive collable** + datalist des entités validées, bouton ⚙ Configuration | ✅ (42 tests) |
| C9-07 | **Recherche structurée** (`Recherche.tsx`) : filtres instantanés sur l'Index (texte normalisé nom+chemin, domaine, statut, année du document) + **plein texte délégué à `fullText contains` Drive** (aucun index de contenu propre — ADR-0007 intact) ; liens directs vers Drive (fileId extrait des clés `drive\|`/`migre\|`, recherche par nom exact sinon) | ✅ (+9 tests → 51) |

> ⚙️ **Côté Marc (une fois, ~10 min)** : créer le client OAuth (origines = URL Vercel) + importer le repo dans Vercel (Root Directory = `app`). Voir `docs/DEPLOIEMENT.md` §Phase 4.

---

## Épopée Phase 4 — Recherche + dashboard (Vercel)  ✅ (réalisée par le chantier #9 — détail dans sa section)

> Cf. **ADR-0008** (`docs/adr/0008-app-web-recherche-controle.md`) : login Google, corrections appliquées
> directement par l'app (garde-fous §1/§2 ré-implémentés + testés), recherche = filtres sur `Index` + plein
> texte natif Drive.

| ID | Tâche | Statut |
|----|-------|--------|
| P4-01 | Scaffolding app React/Vite/TS + déploiement Vercel | ✅ (C9-01 + vercel.json ; déployée par Marc : driveai-ivory.vercel.app) |
| P4-02 | Accès données via login Google (OAuth) — lecture état/Drive (ADR-0008) | ✅ (C9-01, GIS token flow) |
| P4-03 | Dashboard santé/activité + file de corrections (valider/corriger en un clic) | ✅ (C9-03/04) |
| P4-04 | Recherche structurée (filtres via `Index`) + plein texte délégué à Drive (`fullText contains`) | ✅ (C9-07) |
| P4-05 | Bilingue FR/EN | ✅ (C9-01, i18n) |
