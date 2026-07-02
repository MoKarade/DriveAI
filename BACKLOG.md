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
| C4-03 | **Validation 1-clic** (mail hebdo → mini-formulaire ; fusion d'une variante ou création) | ⬜ à suivre (rejoint ADR-0003, chantiers #5-6) |

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
| C6-05 | **Déplacer/renommer le FICHIER déjà classé** d'après la correction (champ « Fichier concerné ») | ⬜ à suivre (nommer un fichier en texte libre est fragile ; le few-shot corrige déjà le futur) |

> ⚠️ **Ré-autorisation Marc requise** : le scope `forms` (création/lecture du formulaire) s'ajoute au prochain déploiement — Marc doit ré-accorder l'accès Google une fois (frontière d'exécution : la session Claude ne peut pas le faire).

---

## Épopée Phase 4 — Recherche + dashboard (Vercel)  ⬜

> Cf. **ADR-0008** (`docs/adr/0008-app-web-recherche-controle.md`) : login Google, corrections appliquées
> directement par l'app (garde-fous §1/§2 ré-implémentés + testés), recherche = filtres sur `Index` + plein
> texte natif Drive.

| ID | Tâche | Statut |
|----|-------|--------|
| P4-01 | Scaffolding app React/Vite/TS + déploiement Vercel | ⬜ |
| P4-02 | Accès données via login Google (OAuth) — lecture état/Drive (ADR-0008) | ⬜ |
| P4-03 | Dashboard santé/activité + file de corrections (valider/corriger en un clic) | ⬜ |
| P4-04 | Recherche structurée (filtres via `Index`) + plein texte délégué à Drive (`fullText contains`) | ⬜ |
| P4-05 | Bilingue FR/EN | ⬜ |
