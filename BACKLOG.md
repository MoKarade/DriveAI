# BACKLOG — DriveAI

> Épopées = phases du `PLAN.md`. Chaque tâche a un ID utilisé en préfixe de commit.
> Statuts : ⬜ à faire · 🟦 en cours · ✅ fait · ⏸️ en pause.

---

## Chantier #28 — Retours produit de Marc du 2026-07-08 (13 points, triés contre le code réel)  🟦

> Triage factuel fait (workflow 13 agents + contre-vérification adversariale). **Nouvelle règle
> CLAUDE.md §4 : la CONCEPTION de chaque tâche passe par NotebookLM** (prompt généré par Claude,
> plan validé collé par Marc) — les statuts ci-dessous restent « en attente plan NotebookLM »
> jusqu'à validation. Ce qui s'est révélé DÉJÀ corrigé/couvert est noté tel quel.

| ID | Retour | Constat du triage | Statut |
|----|--------|-------------------|--------|
| C28-01 | Ne plus se connecter à chaque fois | Plan NotebookLM P1 exécuté : jeton GIS en **sessionStorage** (survit au RECHARGEMENT de l'onglet, meurt à sa fermeture — révision assumée de C9-01) ; localStorage reste INTERDIT pour le jeton (verrou source-scan `app/test/session.test.ts`) | ✅ livré (P1) |
| C28-02 | Vues qui ne se rafraîchissent jamais + section ⚠ Suspects périmée | Plan NotebookLM P1 exécuté : fournisseur d'état GLOBAL (`etatGlobal.tsx` — un `Promise.all` des onglets, rafraîchi toutes les 5 min + bouton ⟳ qui invalide le cache) ; l'Index est servi en **ÉTAT COURANT** (`etatCourantIndex` : dédoublonné par fil/fichier, les clés dry-run jamais fusionnées) — un fil suspect PUIS trié disparaît des ⚠ (C28-13). +2 blocs de tests | ✅ livré (P1) |
| C28-03 | UI de partout | Plan NotebookLM P1 exécuté : badge global « ⟳ Synchro HH:MM » dans la barre de sections, composants mutualisés `IndicateurChargement`/`BanniereErreur` (message borné + Réessayer), `formaterDateCourte` appliqué aux 5 dates brutes restantes (Mails ×2, Aujourd'hui, Santé, Agenda) | ✅ livré (P1) |
| C28-04 | Agenda : choisir mois/semaine… | Plan NotebookLM P2 exécuté : `grilleSemaine` (pur, testé) + toggle Mois/Semaine dans l'en-tête du calendrier (navigation ‹ › ±7 j en vue semaine, `mois` suit la référence — la plage Tasks/Calendar chargée couvre toujours la semaine affichée) | ✅ livré (P2) |
| C28-05 | Ajouter des tâches manuellement | Carte « Créer » remontée EN TÊTE de l'Agenda (découvrabilité) et extraite en composant réutilisable (`composants/Creation.tsx`, pré-remplissable) | ✅ livré (P2) |
| C28-06 | Tâches depuis les mails + bouton « analyser les mails » paramétrable | Plan NotebookLM P2 exécuté : « ➕ » par fil trié (modale Création pré-remplie : titre = sujet, note = lien Gmail) + marqueur Index `intention-manuel|<threadId>` que le moteur saute (préfixe DÉDIÉ — jamais `intention|<threadId>` : l'ID d'un fil EST celui de son 1er message, collision) ; analyse ciblée : formulaire (vue Mails) → `action=analyse-ciblee` (web app) → Property `DriveAI_CUSTOM_SCAN_QUERY` → `balayerAnalyseCiblee_` (campagne : frein budget §2.6 annoncé 1×, plafonds/run, un déjà-vu ne consomme jamais le plafond — anti-plateau, offset LIÉ à sa requête et avancé par fil complété, échecs de recherche transitoires jusqu'à `CIBLEE_ECHECS_MAX`, spam/corbeille exclus, requête jamais journalisée — revue flotte sécurité+quotas appliquée). ⚠ nécessite un redéploiement web app (Nouvelle version) | ✅ livré (P2) |
| C28-07 | Mettre à jour les documents selon le Drive | Plan NotebookLM P3 exécuté : `synchroniserIndex_` (Maintenance.gs) — campagne de fond PERPÉTUELLE en fin de tick (reliquat de budget, try/catch), Drive en LECTURE seule : re-visite le catalogue par tranches (curseur `DriveAI_SYNC_LIGNE`, 50 lignes/tick, budget QUOTIDIEN 2000 vérifs/j) et APPEND l'état constaté (`déplacé`/`corbeillé`). Convergence : seule la ligne la plus RÉCENTE d'une clé est comparée (jamais de re-détection à vie) ; jamais `quarantaine`/`à vérifier` (relance intacte) ; jamais un faux « déplacé » sur un constat partiel. L'app lit déjà l'état courant (`etatCourantIndex`, P1) | ✅ livré (P3) |
| C28-08 | Vitesse de déplacement depuis l'app | Plan NotebookLM P3 exécuté : ascendances de DOSSIERS mémoïsées pour la session (purgées par le ⟳ global — fenêtre de staleté ≤ 5 min), en-têtes Index mémoïsés, invalidation de cache PAR ONGLET (une écriture Sheet ne jette plus les listages Drive), écritures Sheet de trace en tâche de fond après le PATCH Drive critique (la réconciliation moteur rattrape une trace perdue) | ✅ livré (P3) |
| C28-09 | Bouton « analyser le Drive » paramétrable | **DÉJÀ LIVRÉ pour la structure** (#21) : « ✨ Analyser la structure » (Explorateur, portée = dossier courant) + « Analyser tout mon Drive » (vue Réorg). Pour les DOCUMENTS : c'est la campagne C26-08 (après dry-run) | ✅ structure — documents couverts par #26 |
| C28-10 | Apprentissage : dossiers illogiques (mon appartement ×N) | Cause prouvée : la canonicalisation C26-02 (`canoniserAdresse_`…) n'est PAS branchée sur le chemin vivant des propositions (elle ne sert que le routage v2, éteint) ; la détection de variantes n'est qu'un indice (la ligne est quand même ajoutée) ; les propositions ne consultent JAMAIS les dossiers Drive existants — exactement le diagnostic de Marc | ✅ plan NotebookLM P4 exécuté : canonicalisation branchée sur le chemin VIVANT (`resoudreEntite_`/`entiteEnAttenteAjouter_` canonisent à la source), « reality check » Drive (`dossiersExistantsDomaine_`, 1 listage/domaine/run — un dossier existant ⇒ proposition née VALIDÉE et liée), curation passe 1.5 rétroactive (tag `c2` rejoue sur la file actuelle). +7 tests |
| C28-11 | Fichiers INCONNU mal classés | **COUVERT par #26** : dry-run C26-07 mergé (feu vert Marc attendu, ~3-6 $) → campagne C26-08. Trou résiduel confirmé : le flux VIVANT produit encore des `_Inconnu` tant qu'`ANALYSE_V2` est éteint (allumage après la preuve) | ✅ couvert par #26 |
| C28-12 | Erreurs du 2/7 (crédit API + `Session.getEffectiveUser`) | **DÉJÀ CORRIGÉ** (R1/R2/R3, construits après le 2/7 ; `DriveAI_EMAIL` posée le 6/7). MAIS la contre-vérification a trouvé un trou réel : une panne plateforme DURABLE d'une autre signature (429 persistant, 529, 5xx prolongé) n'active pas `estPannePlateforme_` → re-spam Journal + fausses quarantaines jamais auto-libérées | ✅ trou 429/529/5xx corrigé (plan NotebookLM P5 exécuté) : série d'échecs systémiques consécutifs persistée (`DriveAI_LLM_ECHECS_SYST`, seuil `LLM_ECHECS_SYST_MAX: 3`) → même suspension/re-sonde/dé-quarantaine auto que la panne de crédit ; un hoquet isolé reste un échec normal. +8 tests |
| C28-13 | Section suspect rarement à jour | = C28-02 (mêmes 2 causes) | ✅ via C28-02 (état courant) |
| C28-14 | **Session durable** (« me connecter une fois avec Google ») | Plan NotebookLM exécuté (2026-07-09) : fini GIS — flux **Authorization Code** via 4 fonctions serverless Vercel à la racine (`api/login\|callback\|refresh\|logout`, ZÉRO dépendance : `vercel.json` n'installe rien à la racine) ; refresh token en cookie **HttpOnly chiffré** (AES-256-GCM, `COOKIE_SECRET`), SameSite=Strict, 1 an ; anti-CSRF `state` (cookie Lax) ; access token (~1 h) toujours en sessionStorage (verrou `session.test.ts` INTACT) avec restauration silencieuse au chargement + rejeu auto sur 401 ; `clientId` retiré du client (secrets en variables d'env Vercel — §2.4) ; périmètre OAuth inchangé, JAMAIS Gmail (§2.3, testé). +9 tests (bff.test.ts). ⚠ étapes manuelles Marc : URI de redirection + `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`COOKIE_SECRET` dans Vercel (docs/DEPLOIEMENT.md §Phase 4) | ✅ **VALIDÉ EN PROD par Marc (2026-07-09)** : URI de redirection + 3 variables posées, connexion unique constatée (onglet fermé/rouvert → connecté sans clic) |
| C28-15 | **Mails ni triés ni archivés** (quota Gmail épuisé dès ~08h10, tri affamé : 4-17 fils/j) | Plan NotebookLM exécuté (2026-07-10, décision Marc « équilibre strict » + « tout rattraper ») : (1) **ordre d'équité strict** du tick — intentions + tri Gmail AVANT toutes les campagnes (avant : en dernier, le premier arrivé mangeait le quota) ; (2) **suspension persistée du quota Gmail** (patron panne LLM R2) : `signalerPanneGmail_` détecte « too many times…gmail », pose `DriveAI_GMAIL_QUOTA`, tous les scans sautent silencieusement, re-sonde ≤ 2 h (`GMAIL_QUOTA_RESONDE_MS`) — fini les 267 lignes d'erreur/matinée ; (3) frein `GMAIL_HISTO_MAX_FILS_PAR_RUN: 50` + **déviation documentée** : `GMAIL_HISTO_BUDGET_JOUR_MS` 60 → 20 min/j (la page fait 10 fils — le frein seul est inerte ; c'est le budget quotidien qui protège le quota PARTAGÉ). Rattrapage : par conception (scans ancrés + Index). +5 tests | ✅ vérifié en prod (2026-07-10 : UNE ligne « QUOTA GMAIL ÉPUISÉ » à 11:10 puis silence — fini le re-spam) |
| C28-16 | **Panneau « Analyser & trier » dans l'app** (demande Marc : déclencher tri + analyse à la demande, avec paramètres) | Plan NotebookLM exécuté (2026-07-10) : vue Mails → panneau unifié (Intentions « Analyser 30 j » + Tri paramétré fenêtre 1/7/30 j / archiver oui-non / plafond de fils + analyse ciblée existante) → web app `demande-tri`/`demande-intentions` (validation PURE, anti-rafale, `forcerSondeQuotaGmail_` : clic pendant suspension = UNE re-sonde immédiate, sinon `QUOTA_GMAIL` affiché en clair) → Properties de demande consommées par le tick : `scanDemandeTri_` EN TÊTE du tri (offset/faits persistés multi-ticks, plafond = fils TRAITÉS, archiver-non forcé à la mutation seule — libellés/Index intacts), `balayerNouveauxMails_` forcé (ignore le mur déjà-vu, offset persisté, déjà-vus jamais comptés au plafond — anti-plateau). +9 tests. ⚠ redéploiement web app requis (Nouvelle version) | ✅ **validé en prod par Marc (2026-07-10 : « ok ça a lancé »** après redéploiement web app + correction du secret/URL) |
| C28-17 | **Refonte de l'accueil — app v4 « cockpit central »** (demande Marc 2026-07-10 : « bouton de tri trop inaccessible, dashboard trop compliqué ») | Plan NotebookLM exécuté (ADR-0019) : accueil TOUT-EN-UN en 3 zones — (1) `PanneauActions` PARTAGÉ (accueil + Mails) : « Vérifier maintenant » remonté du header (mise en avant `principal`) + intentions 30 j + tri paramétré + analyse ciblée ; (2) zone ATTENTION (contour ambré) : suspects ⚠ + documents « à vérifier » (nouveau sélecteur `lignesAVerifier`, fail-safe ADR-0016) + entités à valider (« Aller valider » → Apprentissage) — tout vide ⇒ « Tout est à jour ✅ » ; (3) zone ACTIVITÉ discrète (tuiles/graphe/derniers tris-classements, l'existant v3). Choix Marc : actions Trier/Analyser/Vérifier en 1 clic (pas la Recherche IA), priorité visuelle au « à faire », mobile/desktop à parts égales (grille 4→2→1). +1 test | 🟦 codé |
| C28-19 | **Tri/intentions Gmail : facture sans tâche, lus non archivés, faux suspects, « pas suspect » 1-clic** (retours Marc 2026-07-13) | Diagnostic posé (Index 13/07) : (1) intentions trop strictes — 0 tâche/7 j, 75 écartées dont « Votre facture est prête » ; décision Marc : actionnable ⇒ tâche Tasks + ⏰ ; (2) règle d'archivage CONSERVÉE (lu ⇒ archivé) mais débit famélique 2-11 fils/j — hypothèse : mur « déjà à jour » de `scanAvantTri_` enterre les fils lus tardivement ; (3) 13 suspects quasi tous faux (alertes Google, 2FA Desjardins) — aucune mémoire expéditeur sûr ; décision Marc : « pas suspect » = confiance apprise réversible ; (4) bouton 1-clic à créer (accueil + Mails). ⚠ §2.3 : retirer un libellé Gmail reste interdit. Protocole §8 (ADR-0020 + PoC réel) | Plan NotebookLM exécuté (ADR-0020) : (1) prompts mini-check/intentions élargis — « facture à payer / action requise » ⇒ `action=true` + `important=true` (⏰ en boîte) + TOUJOURS une tâche Tasks (un reçu déjà payé reste exclu), tripwire anti-retour de l'ancienne exclusion ; (2) `scanCycliqueTri_` — offset persistant sur `TRI_REQUETE`, repart à 0 en fin de fenêtre (tour ≈ 30-60 min), borné `TRI_CYCLIQUE_PAGES_PAR_RUN` ; DÉVIATION : le scan avant + mur CONSERVÉS (latence du neuf ~5 min, quota) ; (3) onglet `Confiance` + décision PURE `decisionSuspect_` (confiance > heuristique + LLM + ⚠ déjà posé ; appris ≠ confiance : .exe reste ⚠), auditée §8.5 sur les 5 faux positifs réels ; (4) `actionPasSuspect_` (doPost) + `appliquerPasSuspect_` (tick, sous verrou — DÉVIATION : jamais de suppression d'Index depuis doPost) + bouton « ✓ Pas suspect » (accueil + Mails, optimiste). +23 tests (audit 2, pas-suspect 12, tri/webapp 9). ⚠ REDÉPLOYER la web app (Nouvelle version). Suite #148 (retour Marc « trop long ») : masquage AU CLIC (optimiste vrai), masqués portés au module (survivent aux navigations) | 🟦 codé — redéploiement web app à faire |
| C28-20 | **Zéro configuration** (demande Marc 2026-07-13 : « je veux rien, juste mon compte Google ») | Plan NotebookLM exécuté (ADR-0021) : (1) verrou d'identité — `/api/login` demande en plus `openid email`, `/api/callback` décode l'`id_token` (`emailDepuisIdToken`, refus des non-vérifiés) et compare à `ALLOWED_EMAIL` : mismatch ⇒ AUCUN cookie, `/?erreur=acces_refuse` (bannière) ; (2) `api/config.ts` NOUVEAU — délivre `SPREADSHEET_ID`/`WEBAPP_URL`/`WEBAPP_SECRET` (env Vercel) aux SEULES sessions au cookie déchiffrable (401 sinon, 500 si env incomplète — jamais de config partielle) ; (3) `app/src/config.ts` refondu : config en MÉMOIRE de module via `chargerConfigServeur()` après connexion — écran Configuration, `enregistrerConfig`, localStorage et `VITE_*` SUPPRIMÉS ; App.tsx séquence connexion → config → vues ; mock E2E inchangé (config factice), `session.test.ts` INTACT. +11 tests (bff.test.ts 15 + callback.test.ts 5 — le HANDLER du verrou est testé, « promesse de verrou = verrou codé »). Scopes MOTEUR inchangés (aucune ré-autorisation Apps Script). Revue flotte : 401 avant 500 sur /api/config (pas de sonde anonyme) + **rotation `COOKIE_SECRET` OBLIGATOIRE au déploiement** (un cookie pré-verrou resterait valable 1 an). ⚠ Marc : poser `ALLOWED_EMAIL`/`SPREADSHEET_ID`/`WEBAPP_URL`/`WEBAPP_SECRET` + régénérer `COOKIE_SECRET` (docs/DEPLOIEMENT.md §Phase 4) | 🟦 codé — variables Vercel + rotation COOKIE_SECRET à faire par Marc |
| C28-21 | **Quota Gmail affamé par l'historique + stock « Inconnu » qui stagne** (retours Marc 2026-07-13 : « aucun mail archivé » — attente : lu ⇒ archivé en ~min — et « tellement de fichiers inconnus ») | Diagnostic posé (Sheet 13/07) : (1) quota Gmail épuisé EN BOUCLE depuis le 11/07 — chaque re-sonde « RÉTABLI » re-meurt en 8 s-6 min ; cause : la campagne historique a fini son rattrapage (964 fils, 12/07 06:50) et sa **passe de VÉRIFICATION relancée depuis l'offset 0** re-parcourt tout le stock à chaque retour de quota → le flux vivant (scanCycliqueTri_ C28-19, demandes app — 0/100 suspendu) n'a jamais son tour ; seuls 2-11 fils/j triés dans les fenêtres de 5 min ; (2) 2 944 fichiers « Inconnu » (v1) — 08=678, 02=590, 06=506, ~983 hors domaine sans enjeu ; v2 n'en produit plus (0 depuis le 09/07) ; m1 les ré-évalue tous mais ~50-90 docs/j et c26-08 (03+08) attend sa fin ; coût 70,54 $/110 $. À cadrer : rendre le quota au flux vivant (borne/suspension de la vérification historique, réserve quotidienne) + accélérer m1/c26-08 sous le frein | Plan architecte exécuté (2 PR successives) : **PR1 #153 (mergée)** — migration recentrée sur les noms « Inconnu » (`estAMigrer_` filtre le nom AVANT l'Index, tag `m1`→`m2-inconnu` : barre purgée + recensement sur le vrai sous-total ; les mal-classés bien nommés de 03/08 restent à c26-08, qui démarre à la fin de m2-inconnu) ; **PR2 #154** — plafonds QUOTIDIENS de fils lus dans LEUR unité : `GMAIL_HISTO_MAX_FILS_JOUR: 150` (compteur persisté, `maxCeRun` = min(par-run, reliquat), retour AVANT toute recherche à 0) + `TRI_CYCLIQUE_MAX_FILS_JOUR: 150` (même mécanique). DÉVIATIONS documentées : fils comptés MÊME sur page interrompue (sinon un reliquat < page tourne en re-lectures jamais comptées) ; page cyclique RÉTRÉCIE au reliquat (complétable — jamais rejouée en boucle) ; date du compteur historique écrite par le seul finally de `traiterGmailHistorique_`. +5 tests (528 verts). Attendu : tri/archivage vivant toute la journée dès demain ; m2-inconnu finit en jours, puis c26-08 | 🟦 codé — PR2 en CI |
| C28-18 | **Progression LIVE des opérations** (demande Marc 2026-07-10 : « un avancement en live pour chaque opération avec des widgets personnalisés ») | Plan NotebookLM exécuté : onglet `Progression` refondu en tableau 7 colonnes (Clé\|Opération\|Traités\|Base\|Unité\|Statut\|Horodaté), rendu CENTRALISÉ par `majProgressions_` dans le `finally` du tick (1 écriture/tick, statuts dérivés des pannes/frein : suspendu quota Gmail / suspendu panne API / en pause frein budget / en attente / recensement / terminé, purge des « terminé » après `PROGRESSION_PURGE_MS` 48 h) ; recensement DÉDIÉ des bases m1/C26-08 (`compterRestantMigration_`/`compterRestantReanalyse_`, filet du compte partiel) + compteurs partagés re-basables (`majCompteurCampagne_`) ; instantané `*_SOLDE` pour les demandes servies en un tick ; app : poll LIVE 15 s hors cache (`lireProgressionLive` + hook `useProgressionLive`) + widget `<OperationsLive/>` sur l'accueil (barre déterminée X/Y, indéterminée si total inconnu, pastille statut jamais couleur seule). Déviations documentées : barre texte v1 retirée (aurait corrompu le tableau), migration d'en-tête au premier tick, « en attente » sans barre. +9 tests moteur, +2 app. **Retour Marc (« resté bloqué, manque d'info ») → #143/#144** : ruban ANIMÉ quand ça travaille vs piste RAYÉE statique à l'arrêt, note d'explication par état, heure moteur en tête, compteurs non informatifs masqués, plafond 99 % hors vraie fin (re-base ≠ terminé) | ✅ livré + retours appliqués (2026-07-10, vérifié en prod : m1 en fin de course, Progression écrite à chaque tick) |
| C28-14 | Captures d'écran UI automatisées à chaque push (demande PM 2026-07-08) | Mode mock `VITE_E2E_MOCK` (auth bouchonnée, données locales `mockData.ts`, `api()` lève sur tout appel réseau résiduel — zéro fuite : bundle prod vérifié sans trace du mock) + Playwright (`app/e2e/screenshots.spec.ts`, 6 sections) + job CI `screenshots` avec artifact `e2e-screenshots` (14 j) | ✅ livré — testé en local (6 captures OK) |
| C28-15 | Miroir COMPLET pour NotebookLM : un seul dossier Drive = doc + code + médias, formats exacts (demande Marc 2026-07-08) | Plan architecte exécuté : binaires UTILES (pdf/png/jpg/svg — vision multimodale) inclus, transportés en base64 (`binaire:true`) et écrits avec le bon MIME ; mise à jour binaire EN PLACE par PATCH REST `uploadType=media` (jamais de suppression/recréation, §2) ; allowlist stricte côté moteur (surface d'abus du secret bornée) ; polices/archives/gif toujours exclus (inutiles à l'IA) | ✅ livré |

## Chantier #27 — MIROIR DRIVE du dépôt (ADR-0017, demande Marc « accès de partout + NotebookLM », 2026-07-07)  ✅

> Marc voulait remplacer GitHub par Drive comme dépôt — refusé (pas de sémantique git, CI/CD en
> dépend). Vrai besoin : accès de partout (déjà GitHub) + copie DANS Drive pour NotebookLM (lit
> depuis Drive). Réutilise la web app déjà déployée, zéro nouveau scope OAuth.

| ID | Tâche | Statut |
|----|-------|--------|
| C27-01 | `src/Miroir.gs` (fonctions pures + I/O), action `sync-miroir` sur `doPost` (secret DÉDIÉ `DriveAI_SYNC_SECRET`), `.github/workflows/sync-drive.yml` (lots via GitHub Actions), dispatché par `auto-merge.yml`. +12 tests | ✅ mergé #107 |
| C27-02 | Config une fois côté Marc (Property + 2 secrets GitHub, accès web app « Tout le monde ») | ✅ fait par Marc |
| C27-03 | **Débogage 1er sync réel** — 2 bugs curl invisibles hors prod trouvés + corrigés (405 : `-X POST`+`-L` verrouille la méthode sur la redirection Apps Script ; « Argument list too long » : payload en argument shell → fichier + `--data-binary @`). Cause du 3e blocage (secret « refusé ») identifiée : web app `/exec` figée sur une ancienne version — résolue par redéploiement manuel de Marc (Nouvelle version). Fixes mergés #108. Sync complet validé 2× en prod réelle (169/169 fichiers, 0 ignoré, 0 erreur) : une fois sur la branche, une fois sur `main` après merge + redéploiement. Voir leçon `docs/LESSONS.md`. | ✅ terminé — miroir Drive à jour, vivant à chaque merge sur `main` |

## Chantier #26 — REFONTE de l'analyse documentaire (demande Marc « fiabilité maximale », 2026-07-07)  🟦

> Diagnostic prod : 65,6 % d'émetteurs « Inconnu », mauvais domaines (vols → Administratif faute de
> Voyages), non-documents (exports Facebook) classés jusqu'en Immigration, et 285 entités en vrac
> (Marc lui-même ×4, génériques, « Ford Fiesta » en 3, une adresse en 6). Décisions Marc : Sonnet +
> 2 passes + texte complet ; re-analyser tout l'existant (~2400 docs, ~45-70 $ avec cache) ; entités
> strictes + fusion des variantes ; docs d'identité groupés PAR TYPE (Passeport/Permis…) mêlant Marc
> et les autres, **nom de la personne dans le fichier dès que ce n'est pas Marc** (pas de `_Tiers`).
> Conçu + validé par workflow (14/14 cas réels conformes, revue adversariale : 7 correctifs intégrés).
> Livraison en PR ordonnées, **tests + preuve avant toute campagne de masse** (exigence Marc).

| ID | Tâche | Statut |
|----|-------|--------|
| C26-02 | **Fonctions pures ENTITÉS + tests** (`Entites.gs`) : `canoniserEntite_` (générique→null, Marc→null, retrait suffixe juridique, correction OCR, canonicalisation véhicule/adresse, casse), `estProprietaireMarc_`, `retirerSuffixeJuridique_`, `canoniserVehicule_`, `canoniserAdresse_`, `corrigerOcrConnu_`, `cleCanoniqueEntite_` (clé de fusion) ; `estFusionnableEntite_` DURCI (marque seule + modèle propre ⇒ pas de fusion : Ford ≠ Ford Fiesta). 11 tests, calés sur les vrais cas | ✅ |
| C26-01 | **Taxonomie** : domaine `09 · Voyages` (DOMAINES_AUTO, find-or-create) + sous-dossiers de type identité ; docs/TAXONOMY.md. Test formulaire robuste | ✅ |
| C26-03 | **Fonctions pures TITULAIRE/IDENTITÉ + tests** (`Router.gs`) : `normaliserTypeIdentite_` (variantes → dossier canonique), `estDocumentIdentitePersonnel_`, `dossierIdentite_` (par type, jamais par personne), `titulairePourNom_` (Marc valide ici), `nommerDocument_` (aiguille titulaire↔émetteur), `nomSansTiers_`, `garantirNomUnique_` (anti-écrasement). 8 tests | ✅ |
| C26-PROOF | **PREUVE à grande échelle validée par Marc** : 38 vrais documents ré-analysés (workflow, 2 itérations), artifact avant/après présenté. Marc RELÈVE 2 exigences : (a) **zéro « Inconnu »** — descripteur précis à la place ; (b) **tout en sous-dossier** (rien à la racine d'un domaine), **entité unifiée** (« IUT = 1 dossier »), captures sans valeur → `_Médias`. v2 vérifiée : 0 Inconnu / 0 racine. Constat honnête : **0/21 émetteurs récupérés** (les « Inconnu » sont surtout légitimes) — le gain est la CORRECTNESS, pas le remplissage d'émetteur | ✅ |
| C26-03b | **Règles v2 dans le code** (`Router.gs`) : `nommerDocument_` avec **descripteur** (jamais « Inconnu ») ; `sousDossierPourNom_` (entité canonique unifiée d'abord, catégorie en repli, jamais vide). +3 tests | ✅ |
| C26-04 | **Fonctions pures NON-DOCUMENT + tests** (`Router.gs`) : `decisionNonDocument_` (ordre explicite : garde `distinguerVraiScan_` DOMINANTE > export déterministe > LLM > média ; identité/01/04 jamais média-isée ; export jamais sous 04), `estExportDonnees_`, `estMediaSansTexte_`, `distinguerVraiScan_`, `extensionEstTechnique_`. 7 tests | ✅ |
| C26-05 | **Pipeline 2 passes Sonnet** (`Llm.gs`, flag `CONFIG.ANALYSE_V2` = false) : `PROMPT_PASSE1`/`PROMPT_PASSE2` (preuve validée), `classifierDeuxPasses_` + `appelAnthropicV2_` (Sonnet ×2, anti-régression passe2→passe1, panne plateforme, coût compté Sonnet), parser étendu `normaliserChampsV2_` (réponse Haiku INTACTE), texte OCR moins tronqué (`ANALYSE_V2_OCR_MAX_CARS` 12000). +8 tests `llm-v2.test.js` | ✅ mergé #104 |
| C26-06 | **Câblage routage v2** (`Router.gs`/`Pipeline.gs`, même flag) : `planRoutageV2_` (cœur PUR) + `deciderRoutageV2_` (I/O) — non-document écarté (jamais un domaine/04), identité par type, sous-dossier obligatoire (entité unifiée), nom `nommerDocument_` (jamais « Inconnu »), anti-écrasement `garantirNomUnique_`/`nomsDansDossier_`. Gate `CONFIG.ANALYSE_V2 ? deciderRoutageV2_ : deciderRoutage_`. +13 tests `routage-v2.test.js` | ✅ mergé #104 |
| C26-05b | **Durcissement post-revue** (ADR-0015, flag OFF) : parser tolère `domaine:null` pour un non-document v2 (anti-quarantaine), prompt v2 clarifié, garde-temps `budgetMsRun_()` abaissé sous v2 (`ANALYSE_V2_BUDGET_MS`, anti-mur 6 min), sous-dossier assaini par `champ_`. Pré-requis d'allumage documentés. +5 tests | 🟦 codé, flag OFF |
| FAIL-SAFE | **Hybride ultra-strict** (ADR-0016, révise §2.1 — décision Marc « hybride ultra-strict ») : `estClassificationVide_` (PURE : domaine inconnu ET émetteur ET type tous absents → `00 · À vérifier`), `routageAVerifier_`/`dossierAVerifier_`, câblé `deciderRoutage_` (live) + `planRoutageV2_` (garde identité). Constitution §2.1 + §8 protocole de précision. Preuve `audit-logique.test.js` (0/20 réels), non-régression (CV/note/export). +14 tests, 370 verts | ✅ mergé #106 — live sur `deciderRoutage_` |
| C26-07 | **PREUVE** : `src/DryRunV2.gs` — échantillon RÉEL stratifié par domaine (persisté, reproductible), exécute le vrai pipeline v2 (`classifierDeuxPasses_` + `planRoutageV2_` PUR), écrit l'avant/après dans l'onglet Sheet `DryRunV2` — ZÉRO mutation Drive (tripwire statique testé empiriquement). Interrupteur DÉDIÉ `CONFIG.DRYRUN_V2_ACTIF` (jamais `ANALYSE_V2`). Revue flotte (6 agents) : budget-temps aligné sur le coût-temps Sonnet ×2, collecte découplée du sous-budget LLM, chemin multi-niveaux, encodage compact anti-dépassement Property, tripwire étendu. +36 tests (382 → 418). `docs/RUNBOOK.md` : checklist d'allumage | ✅ **TERMINÉ 2026-07-08 18:33 (100/100, 2,61 $)** — rapport avant/après livré à Marc (artifact, 2026-07-09) : 0 fail-safe, confiance médiane 0,93, 19 corrections de domaine applicables (+3 refusées zone protégée), 62 renommages, 24 non-documents écartés. **Penser à repasser `DRYRUN_V2_ACTIF: false`** |
| C26-08 | **Campagne de re-analyse v2 CIBLÉE** (ADR-0018, décision Marc 2026-07-09 « go 2ᵉ option ») : `ANALYSE_V2: true` (flux vivant en Sonnet 2 passes), `DRYRUN_V2_ACTIF: false`, campagne `reanalyse\|c26-08\|` sur `REANALYSE_CIBLES` = 03 (186 docs) + 08 (738 docs) ≈ 24 $ — même mécanique que m1 (clé additive, page 12 docs/tick, sous-budget 2 min, zone protégée revérifiée, ignorerDoublon, quarantaine), démarre APRÈS la fin de m1 (une campagne à la fois), 03/08 EXCLUS de m1 (jamais payés 2×). Plafond frein 30 → **65 $** (redescendre à 10 après — checklist ADR-0018). +6 tests | 🟦 codé — démarre seul à la fin de m1 |
| C26-09 | **App** : validation 1-clic des intrus coincés sous 04 + révision §6 budget | ⬜ |

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

### Chantier #16 — Tri Gmail natif (ADR-0012) — remplace la tâche Cowork de Marc  ✅ (mergé 2026-07-06 — vérification réelle après ré-autorisation)

> **Décision constitutionnelle actée le 2026-07-06** (réponses explicites de Marc) : levée du
> garde-fou « Gmail lecture seule » → scope **`gmail.modify`** (JAMAIS de suppression — même pas
> appelée par le code). ⚠️ **Séquencer le merge du scope avec Marc** (gel des déclencheurs jusqu'à
> sa ré-autorisation — leçon durable). Une fois livré et vérifié : Marc supprime sa tâche Cowork.

| ID | Tâche | Statut |
|----|-------|--------|
| C16-01 | **Scope & garde-fous** : `gmail.readonly` → `gmail.modify` — PR avec label **`do-not-merge`** dès création, levé seulement sur accord TEMPS RÉEL de Marc (auto-merge sinon = moteur gelé sans lui) ; test de surface source **check CI REQUIS** avec motifs complets (`ToTrash`, `ToSpam`, `deleteLabel`, `createLabel`, `removeLabel`/`removeFromThread`, `batchDelete`, service avancé + REST Gmail en bloc, `TRASH`/`SPAM` dans `addLabelIds`), scan récursif, manifeste sans services avancés, **tripwire scope↔CLAUDE.md** ; constitution + leçon §7 « pas de label » mises à jour ; `ARCHITECTURE.md` § scopes corrigée | ✅ (PR #66 — scope + constitution dans le MÊME commit, cohérence verrouillée par le tripwire CI) |
| C16-02 | **Mini-check à 3 signaux** (`action`, `important`, `categorie`) — un seul appel, coût marginal ; table `expéditeur → libellé` apprise dans la Sheet (few-shot) ; doute → `À vérifier`, jamais « le plus probable » | ✅ adapté : mini-appel `miniCategorie_` SÉPARÉ (par FIL, pas par message — moins d'appels que d'étendre le mini-check, granularités différentes) ; table `TriAppris` adresse→libellé consultée d'abord |
| C16-03 | **Pose des libellés au fil de l'eau** : le plus précis parmi les libellés EXISTANTS (16 catégories + ~45 sous-libellés) ; jamais de création silencieuse ; `⏰ À traiter` posé sur les mails `important` (#14) ; idempotence par l'Index | ✅ (`TriGmail.gs` : décision PURE testée, 30 fils/run max, idempotence par ÉTAT `tri\|<fil>\|<ts>\|lu/nonlu` — un mail lu APRÈS son tri est re-trié donc archivé — sans charger les messages, attend l'analyse Phase 3 du fil ; rattrapage du stock par ancre FIXE + offset sur ensemble figé ; panne d'écriture Gmail SYSTÉMIQUE) |
| C16-04 | **Archivage prudent** (règles Marc, confirmées 2026-07-06) : mails LUS après libellé ; promos/newsletters même non lues MAIS qualification DÉTERMINISTE seulement (`List-Unsubscribe`, `CATEGORY_PROMOTIONS` — le LLM ne déclenche jamais un archivage non-lu) ; phishing évalué AVANT tout archivage (ordre testé) ; JAMAIS `À vérifier`/`⚠️ Suspect` ; Spam intouché ; zone protégée : comme les autres (libellé + archivage si LU) mais jamais via le chemin promo-non-lu ; `⏰ À traiter` jamais archivé par le moteur (todo de Marc) ; stock initial : toute la fenêtre 30 j, borné par run ; réversible (retrait INBOX seul) | ✅ (décision pure : suspect > doute > ⏰ > promo-déterministe > lu) |
| C16-05 | **Phishing** : heuristiques déterministes + LLM → `⚠️ Suspect` (reste en boîte), EN TÊTE du résumé hebdo ; jamais de clic/ouverture | ✅ (heuristiques étroites PJ risquée / urgence+identifiants + signal LLM ; ⚠️ reste en boîte) |
| C16-06 | **Résumé hebdo** : sections « ⚠️ Suspects » (tête) et « Newsletters jamais ouvertes » (candidates désabonnement, liste seule). Écartés par Marc : documents manquants, registre des montants | ✅ (« ⚠️ Suspects » EN TÊTE avec liens, compteur fils triés, « 🗞️ Newsletters jamais ouvertes » déterministe) |

### Calibrage 2026-07-06 (réponses explicites de Marc — 2 salves de questions)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| CAL-01 | **Alertes : tout au résumé hebdo** (choix Marc, informé du risque) : plus AUCUN mail immédiat — `notifierEchec_` journalise seul, chien de garde = auto-réparation + journal (le hebdo montre l'état « silencieux »), alerte stockage = journal. `emailAlerte_`/`DriveAI_EMAIL` ne servent plus qu'au résumé hebdo. Réversible (commentaire dans le code) | ✅ |
| CAL-02 | **Campagne historique ×3** : Marc voulait « ~100 min/j » — impossible (quota dur ~90 min/j pour TOUT le moteur) → `GMAIL_HISTO_BUDGET_JOUR_MS` 20 → **60 min/j** (max raisonnable, vivant garde ~25-30 min/j, campagne finie en ~3-5 j) | ✅ |
| CAL-03 | Confiance basse : « voir dans l'APP seulement » → chantier #17 ; entités : « auto-valider à 3 occurrences » → chantier #18 | ✅ (routé) |

### Chantier #17 — Confiance visible dans l'app  ⬜

| ID | Tâche | Statut |
|----|-------|--------|
| C17-01 | Colonne `Confiance` à l'Index (nombre seul — métadonnée, ADR-0007) écrite par le pipeline au classement ; compat lignes historiques (vide = inconnu) ; en-têtes réels côté app | ⬜ |
| C17-02 | App/Recherche : filtre « confiance basse » (< SEUIL_CONFIANCE) pour repasser derrière les « classés au mieux » ; tri par confiance croissante | ⬜ |

### Chantier #19 — App v3 : refonte complète de l'interface (décision Marc 2026-07-06)  ✅ (livré le 2026-07-06 — 6 sections, PR #73→#78)

> Cadrage explicite de Marc (4 réponses) : refonte visuelle complète + navigation/structure +
> nouvelles fonctionnalités + expérience mobile/PWA ; usage **desktop et mobile à égalité** ;
> style : **3 directions proposées sur maquette** (A « Dossier » épuré papier, B « Salle des
> machines » sombre dense, C « Par avion » postal) — en attente de son choix ; contenu : vue
> Tri Gmail (suspects/appris/newsletters), Santé & coût du moteur, Recherche enrichie (filtres),
> Confiance visible (#17 absorbé). Nouvelle structure : 6 sections (Aujourd'hui · Agenda ·
> Documents · Mails · Apprentissage · Santé — Agenda ajouté en revue de maquette). Maquette : artifact « trois directions » (2026-07-06).

| ID | Tâche | Statut |
|----|-------|--------|
| C19-01 | Choix de la direction visuelle sur maquette (A/B/C ou panachage) | ✅ **B « Salle des machines »** (choix Marc 2026-07-06) — sombre d'abord, dense, chiffres mono, accent ambre |
| C19-02 | ADR + maquettes haute-fidélité des 5 sections dans la direction choisie | ✅ ADR-0013 + maquette haute-fidélité navigable (5 sections, desktop + mobile, artifact 2026-07-06) — source de vérité visuelle du chantier |
| C19-03 | Socle v3 : tokens/design system, navigation 6 sections, responsive + PWA mobile | ✅ (tokens B sombre+clair dans styles.css — les vues v2 adoptent le thème via les mêmes variables ; App.tsx 6 sections, v2 branchées sous Aujourd'hui/Documents/Apprentissage, Agenda/Mails/Santé « en construction » honnêtes ; barre basse mobile 4+Plus ; thème persisté + theme-color dynamique ; manifest PWA v3) |
| C19-04 | Vue « Aujourd'hui » (stats, activité, suspects, derniers tris) | ✅ (tuiles docs/coût/tri/suspects depuis Santé+Index — parse pur testé ; ⚠ suspects et fils triés cliquables → Gmail ; derniers classements → Drive ; statut moteur ; TableauDeBord v2 déplacé sous Santé en attendant C19-08, zéro perte) |
| C19-05 | Vue « Agenda » : calendrier réel + tâches + création directe | ✅ (grille mois cliquable → détail jour ; tâches Google cochables — PATCH status seul — + détail ; mails ⏰ → Gmail ; création directe tâche/RDV ; scopes app tasks+calendar.events, consentement navigateur au prochain login ; bans miroir : jamais DELETE, jamais status:cancelled, jamais /clear ; helpers purs testés) |
| C19-06 | Vue « Mails » : suspects, fils triés, table TriAppris corrigeable, newsletters | ✅ (tuiles tri 7j/à vérifier/suspects/appris ; fils triés + suspects cliquables → Gmail ; table apprise avec « Retirer » = vidage de cellules — jamais de suppression de ligne, le moteur ignore les adresses vides ; newsletters restent au résumé hebdo — le calcul vit côté moteur/Gmail) |
| C19-07 | Vue « Documents » : recherche filtrée + badge & filtre confiance (#17 ABSORBÉ — moteur : colonne H « Confiance » à l'Index, `decision.confiance` au classement, en-tête auto-réparé) | ✅ (badge 0,xx vert/orange, case « Confiance basse » < 0,5 ; verrou vie-privée mis à jour : 8 colonnes métadonnées, la confiance est un NOMBRE) |
| C19-08 | Vue « Santé » : heartbeat, quotas, coût LLM, quarantaine | ✅ (lignes Santé + signal quota Gmail dérivé du Journal — testé —, coût avec jauge, erreurs 7 j, quarantaine + Relancer conservés ; TableauDeBord v2 supprimé, remplacé par Aujourd'hui + Santé) |
| C19-09 | Vue « Apprentissage » : corrections + entités | ✅ (Corrections v2 adoptée telle quelle sous « Apprentissage » — déjà fusionnée : entités + corrections + reclassement ; tokens v3 hérités) |

### Chantier #20 — Retouches post-v3 (demandes Marc 2026-07-06, soir)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| C20-01 | **Incident « BACAR »** (photo de plat classée « Reçu de dépôt ») : garde post-LLM — une PHOTO au nom non-documentaire classée sous `MEDIAS_CONFIANCE_MIN` (0,7) → `_Médias`, JAMAIS « au mieux » ; exception zone protégée/sensible (jamais rétrogradée) ; le seuil OCR pré-LLM reste bas (le juge doit siéger, §1) | ✅ (testé : étiquettes→média, reçu 0,92→classé, sensible→jamais média) |
| C20-02 | `rattraperMediasMalClasses()` — one-shot MANUEL borné : re-juge les images « classées » depuis le 02-07 (OCR court → média ; sinon re-classif à nom NEUTRE, confiance < 0,7 et non-sensible → média) ; déplacement seul + cellule statut mise à jour | ✅ (à LANCER par Marc après le merge) |
| C20-03 | App : **retry 429** avec repli progressif (quota d'écriture Sheets PARTAGÉ avec le moteur) + message doux | ✅ |
| C20-04 | App : **cache de lecture 60 s** (changer d'onglet ne recharge plus tout — « beaucoup moins de chargements », 1ʳᵉ tranche) + invalidation sur écriture | ✅ |
| C20-05 | App : **tooltip du graphe** (survol/doigt → « jour — N documents » dans l'en-tête de carte, barre surlignée) | ✅ |
| C20-06 | **Bouton « Vérifier maintenant »** : web app Apps Script (`doPost` + secret Script Property `DriveAI_WEBAPP_SECRET`, anti-rafale 60 s, déclencheur ponctuel auto-nettoyé) + bouton app (no-cors) + champs Configuration | ✅ (déploiement web app = 2 clics de Marc, cf. DEPLOIEMENT.md) |

### Chantier #21 — Explorateur Drive dans l'app + réorganisation IA (CADRÉ — réponses Marc 2026-07-06)  ⬜

> Interface **façon Google Drive** dans l'app : recherche (+ IA), recherche limitée à un dossier,
> création rapide de dossiers, **drag-and-drop** pour ranger, affichage similaire.
> **Réorg IA (décisions Marc)** : ① l'IA analyse tout le Drive et PROPOSE un plan (avant/après)
> dans l'app → **Marc valide** → le moteur applique par **déplacements seuls** (réversibles, bornés,
> reprenables) ; ② **révision ÉTROITE du §2 actée** : après application validée, les dossiers
> devenus **VIDES** sont listés → validation de Marc → **corbeille Drive** (récupérable 30 j) —
> jamais de purge, jamais un dossier non vide, jamais la zone protégée. Exige un **ADR-0014** +
> constitution mise à jour DANS le même commit (tripwire pattern) + revue flotte avant merge.
>
> **Découpage (plan product-manager 2026-07-06, une PR par étape)** — état de la proposition dans
> un onglet `Réorg` (en-têtes réels, machine à états `analyse demandée → proposé → validé/écarté →
> appliqué/refusé → vide-candidat → corbeillé`, aucune ligne supprimée). La corbeille des dossiers
> vides est exécutée par l'**APP** au clic de validation (le moteur garde son verrou « aucune
> suppression » ABSOLU) ; la réorg de masse par le **MOTEUR** au tick ; le drag-and-drop par
> l'app via `reclasserFichier` (geste manuel).

| ID | Tâche | Statut |
|----|-------|--------|
| C21-01 | **Explorateur lecture seule** (app) : navigation par dossiers (fil d'Ariane, tri dossiers d'abord, pagination), recherche nom+plein texte, portée « dans ce dossier » (collecte bornée des sous-dossiers, troncature annoncée) — sous-onglets Documents = Drive \| Recherche DriveAI. Revue flotte : sécurité ✅ (aucune mutation, injection `q` fermée), code ✅ (pageToken purgé entre dossiers, troncature honnête sur page pleine, portée mémoïsée 60 s, clavier) | ✅ |
| C21-02 | **Création de dossiers + drag-and-drop** (app) : `creerDossier` (création seule) ; `deplacerFichierManuel` (fichiers SEULS, nom conservé, verdict `deplacementSeul` — zone protégée JAMAIS relâchée, échec fermé) ; drag souris (type MIME propriétaire) + mode « Déplacer → Déposer ici » (tactile/clavier). Parades intake (revue file-checker) : ligne Index `drive\|fileId` statut `manuel` (le rangement ne re-collecte pas un placement manuel), refus de REdéposer un fichier déjà traité dans `00·À trier`, pas de « Nouveau dossier » dans `00·À trier`. Alias `root` résolu (jamais add+remove du même dossier). Trace Journal best-effort. Revue flotte : sécurité ✅ + code ✅ + intake ✅ + nommage ✅ (correctifs intégrés, doc NAMING §Périmètre) | ✅ |
| C21-03 | **Recherche IA** (app + pont web app `doPost`) : question libre → Haiku (JSON strict, few-shot) → plan WHITELISTÉ (`parserPlanIA_` : domaine borné taxonomie, ≤ 5 mots-clés, plan vide → null) → l'app applique les filtres + plein texte. CORS levé : POST `text/plain` (requête simple) → réponse lisible. Bornes : anti-rafale 5 s (consommé après validation), plafond 50 appels SERVIS/jour (~0,002 $/question, ~3 $/mois au plafond), panne API → échec rapide sans consommer le plafond. La question voyage dans le CORPS (jamais l'URL), jamais journalisée. Revue flotte : llm-cost-optimizer ✅ (chiffré), security-auditor ✅, code-reviewer → correctifs intégrés (compteur sur appels servis, anti-rafale post-validation, contrat de surface, confiance basse réinitialisée, rep.json protégé). ⚠ Marc : redéployer la web app en NOUVELLE VERSION (DEPLOIEMENT.md) | ✅ |
| C21-04 | **Moteur — inventaire + proposition** (`Reorg.gs`, onglet `Réorg`) : demande de l'app → inventaire BFS borné (250, dédoublonné multi-parents, **zone protégée exclue par remontée d'ancêtres dès la collecte**, racines système/00· exclues, lecture seule) → UN appel Haiku (3000 tokens, JSON compact + few-shot, dossiers par NUMÉRO) → plan whitelisté (`parserPropositionReorg_` : racines de domaine INTOUCHABLES, cycles rejetés, `/` rejeté, ≤ 40 actions) → lignes `proposé` en un append reprenable. Essais : 3 max, budget/panne RENDUS (jamais imputés), portée trop large/protégée = échec immédiat ; plafond 5 analyses/jour. Règles structurelles inscrites à TAXONOMY.md. Revue flotte : apps-script-quota + structure-keeper + security-auditor (bloquants B1/B2/B3 corrigés) + llm-cost-optimizer (~0,02 $/analyse) | ✅ |
| C21-05 | **App — vue « Plan de réorg »** (Documents → onglet « ✨ Réorg IA ») : dernière demande + actions proposées (avant → après + raison), Valider/Écarter par ligne (cellule F) ou en masse (plages CONTIGUËS de la colonne Statut — jamais une ligne non ciblée), « Analyser tout mon Drive » + « ✨ Analyser la structure » depuis l'Explorateur (portée = dossier courant), historique des décisions. Onglet absent (400) = vide ; autre erreur AFFICHÉE (jamais un faux « aucune demande »). Revue flotte : sécurité ✅ (aucun batchUpdate, statuts littéraux, textes exacts), code → 3 impasses corrigées (bouton Analyser par dossier, erreurs non avalées, « Nouvelle analyse » toujours accessible) | ✅ |
| C21-06 | **Moteur — application du plan validé** (`etapeReorg_` : DRAINE les actions `validé` avant d'alimenter une analyse) : par ID, re-vérif zone protégée stricte avant CHAQUE mutation (source, cible, parent — identité ET ascendance, échec fermé), racines/files/domaines AUTO intouchables, segments STRUCTURELS (années, schémas) jamais mutés (parseur + application). Fusion : collecte lecture seule puis déplacement par ID (itérateur jamais invalidé), lots de 40 reprenables, conclusion sur passe BLANCHE seulement, éléments protégés LAISSÉS EN PLACE (identité + ascendance étrangère) ; effets (re-pointage `Entités.Dossier ID`, ligne `vide-candidat` dédupliquée) AVANT le statut `appliqué`. Exceptions : 2 tentatives (marqueur suffixé, rendu sur progression) puis `échec`. Revue flotte 4 agents : bloquant sécurité (détachement par identité) fermé, re-audit 🟢 CONFORME | ✅ |
| C21-07 | **ADR-0014 + CLAUDE.md §2 + corbeille des dossiers vides** — livré ATOMIQUEMENT : `corbeille.ts` (seul porteur de `trashed:true`, verdict PUR testé : type + vacuité STRICTE corbeillés inclus + ascendance échec fermé + identité protégée + IDs structurels Logement/Véhicule + noms réservés), section UI « Dossiers devenus vides » (clic = validation, erreurs i18n dans la bonne carte), tripwire CI bidirectionnel corbeille.ts ⇔ CLAUDE.md §2, verrou de surface DRIVE ajouté au MOTEUR (setTrashed/DELETE/trashed:true interdits dans src/*.gs — exception nommée : fichier temporaire OCR, 1 max), motifs app durcis (méthode entre guillemets, /batch, XMLHttpRequest). Revue flotte BLOQUANTE : sécurité (verrou moteur promis→codé), structure (IDs fixes protégés moteur+app+docs), code (tests durcis) — tous fermés | ✅ |

### Chantier #22 — Fréquence d'analyse configurable (choix Marc : UN réglage global)  ✅ (livré 2026-07-06)

> Réglage du tick (5/10/15/30 min) depuis l'app (Santé → carte « Réglages ») → onglet `Réglages`
> de la Sheet (`A2:B2 = TICK_MINUTES | n`, seedé par le moteur) → le moteur l'applique au tick
> suivant : `assurerIntervalleTick_` lit `intervalleTickVoulu_()` (Sheet, fallback CONFIG) et
> ré-installe le déclencheur. Whitelist stricte `validerTickMinutes_` (5/10/15/30, jamais < 5 min,
> valeur invalide → défaut). Zéro nouveau scope.

### Chantier #23 — Peaufinage UI (choix Marc)  ✅ (livré 2026-07-06)

> ① **Agenda façon Google Calendar** : grille pleine largeur, cases hautes (7,2 rem), en-têtes
> centrés, pastille « aujourd'hui » pleine sur le numéro (comme GCal), bouton « Aujourd'hui »,
> événements en barres colorées ; ② **plus aéré** : corps 15,5 px, cartes/espacements/tuiles
> agrandis ; ③ **transitions** : boutons (hover/press), lignes cliquables, onglets, feuille
> mobile qui monte, cartes — le tout sous `prefers-reduced-motion`.
> (Squelettes : écarté par Marc — le cache 60 s de #20 suffit.)

### Chantier #18 — Auto-validation des entités fréquentes (décision Marc : seuil 3)  ✅ (livré 2026-07-07)

| ID | Tâche | Statut |
|----|-------|--------|
| C18-01 | `autoValiderEntitesFrequentes_` au tick (AVANT la matérialisation — dossier créé au même run, bornée 5/run + budget) : `en_attente` + vue ≥ `ENTITES_AUTO_SEUIL` (3) + sans variante + non générique + JAMAIS un domaine protégé (normalisé des deux côtés) + jamais re-validée après réédition de Marc (garde `dossierId`). Statut « validée (auto ≥N) » (seuil affiché = réel, round-trip normalisation testé), accepté par `estValidee_`, miroir app (`entitesValidees`). Annulation : Statut → « refusée » (un retour à en_attente serait re-validé — documenté partout). Signalées au résumé hebdo (section best-effort). Revue : sécurité ✅ + code ✅ (2 corrections intégrées) | ✅ |

### Correctif R1 — Panne de compte API & canal d'alerte (check-up 2026-07-03)  🟦

| ID | Tâche | Statut |
|----|-------|--------|
| R1-01 | **Garde « panne de PLATEFORME »** (`Llm.gs`) : HTTP 400 « credit balance » / 401 ⇒ panne de COMPTE, jamais imputée aux documents — `gererEchec_` ne compte RIEN pendant la panne (incident réel : crédit épuisé le 01-07 20:56 → ~89 docs quarantainés à tort en 2 jours), le pipeline saute les docs (pas d'OCR/mutation), les appels LLM du run échouent VITE (sans réseau), journal UNE fois par run, re-sonde au run suivant | ✅ (tests) |
| R1-02 | **Canal d'alerte réparé SANS nouveau scope** : `Session.getEffectiveUser()` exige un scope (userinfo) ABSENT du manifeste → 597 alertes mortes en silence depuis le début (chien de garde, quarantaines, résumé hebdo). `emailAlerte_()` lit la Script Property **`DriveAI_EMAIL`** (repli Session, ne lève jamais) ; sans destinataire → trace explicite au Journal. Câblé partout : notifierEchec_, chien de garde, alerte stockage, résumé hebdo | ✅ (tests) |
| R1-03 | **Reste côté Marc** : (1) **recharger le crédit Anthropic** (console.anthropic.com → Billing — panne active depuis le 01-07 20:56) ; (2) poser la Script Property `DriveAI_EMAIL` = son adresse ; (3) après recharge, UN clic `dequarantaine()` (éditeur Apps Script) pour re-tenter les ~89 docs quarantainés à tort (les ~64 photos Facebook coincées dans 00·À trier passeront par le fast-path médias, quasi gratuit) | ✅ fait par Marc le 06-07 (crédit rechargé + `DriveAI_EMAIL` posée + dequarantaine, drainage vérifié — cf. HANDOVER ; seul le résumé HEBDO n'a pas encore été reçu de bout en bout, à confirmer au prochain lundi) |

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

### Correctif R3 — File `00 · À trier` affamée : équité d'intake, dé-quarantaine, natifs, frein budget (2026-07-07)  🟦

> Incident réel (demande de Marc : « je veux que ça trie ce qu'il y a dans À trier ») : un PDF déposé
> un soir est resté **11 h (~130 ticks)** sans traitement. Quatre causes CUMULÉES : (1) famine FIFO —
> le grand rangement re-alimente la file en continu et l'itérateur Drive sert les plus récents
> d'abord ; (2) 32 fichiers quarantainés pendant la panne crédit du 01-07, sautés en silence à vie ;
> (3) 2 Google Sheets natifs refusés faute de lecteur ; (4) budget §2.6 crevé (15,62 $ le 07-07 —
> rangement de masse nocturne + escalades Sonnet + erreurs JSON).

| ID | Tâche | Statut |
|----|-------|--------|
| R3-01 | **Équité d'intake** (`Intake.gs`) : collecte LECTURE SEULE bornée (`INTAKE_SCAN_MAX` = 400 parcourus, `INTAKE_PAGE` = 150 candidats), page COMPOSÉE de traitables seulement (les déjà-indexés — quarantaine incluse — filtrés à la collecte, un mur de skips n'affame plus le reste), tri FIFO `ordonnerDepots_` (plus ancien d'abord ; date illisible → tête de file) | ✅ (tests) |
| R3-02 | **Dé-quarantaine automatique one-shot** (`Main.gs`, gatée `DriveAI_DEQUARANTAINE` ≠ `CONFIG.DEQUARANTAINE_TAG`) : relance les quarantainés de la panne (32 faux positifs du 01-07) sans clic de Marc ; un RÉTABLISSEMENT de panne (`signalerRetablissement_`) ré-arme le one-shot tout seul (efface la Property) | ✅ (tests) |
| R3-03 | **Fichiers Google natifs lisibles** (`Ocr.gs` : `exporterTexteNatif_` + `exportNatifMime_` pur) : Docs/Sheets/Slides exportés en TEXTE via l'API REST (aucun fichier temporaire), puis classés par le pipeline normal (déplacement seul) ; type sans export (Forms, dessins…) ou échec HTTP → laissé en place + signalé une fois (comportement d'avant) | ✅ (tests) |
| R3-04 | **Frein budget des campagnes** (`Cout.gs` : `budgetCampagnesAtteint_`, `CONFIG.LLM_BUDGET_CAMPAGNES` = 10 $) : coût mensuel MESURÉ ≥ 10 $ → grand rangement, historique Gmail et migration taxonomie EN PAUSE jusqu'au mois suivant ; le FLUX VIVANT (Gmail, dépôts, partages, intentions, tri) n'est JAMAIS gaté. Cache 1×/run, journal 1×/mois. Relever le budget = éditer `LLM_BUDGET_CAMPAGNES` (choix explicite de Marc) | ✅ (tests) |
| R3-06 | **Plafond campagnes relevé 10 → 30 $** (décision Marc 2026-07-07 : « je veux que tu continues le tri au complet ») : le rattrapage (grand rangement, historique Gmail, migration) reprend et va au bout ce mois-ci ; la cible < 10 $/mois redevient la règle en croisière (constitution §2.6 révisée). La mémoire « déjà signalé » du frein inclut désormais le SEUIL : une re-pause au plafond relevé est re-annoncée au Journal (jamais silencieuse) | ✅ (tests) |
| R3-05 | **Correctifs revue flotte (4 agents — 3 bloquants réels convergents)** : (a) réentrance `tickDriveAI` via `dequarantaine()` (verrou relâché par le finally du tick imbriqué = anti-chevauchement neutralisé) → noyau `dequarantainerLignes_(prefixe)`, le tick n'appelle QUE le noyau et QUE les clés `drive|` (une clé Gmail hors fenêtre serait libérée « dans le vide » et perdrait son bouton Relancer) ; (b) `getSize`/`getLastUpdated` lus sous garde + try PAR ITEM (un fichier illisible trié en TÊTE de FIFO gelait tout le tick, à chaque tick) ; (c) empreinte de doublon sur le texte natif ENTIER (`NATIF_EXPORT_MAX_CARS`, borne mémoire) + jamais de fast-path doublon sous 20 cars (deux exports vides = même MD5 → faux doublon terminal). Plus : export échoué = échec COMPTÉ (quarantaine après 3, fin du spam journal), type sans export = indexé `natif` (sort de la page et du seuil), tri AVANT troncature de page (sinon on gardait les plus récents), `nbFichiersATrier_` ne compte plus les résidents indexés (40 quarantainés fermaient la porte du rangement à VIE), Échecs purgé avant Index (coupure sans compteur orphelin), frein fidèle si le journal lève | ✅ (306 tests) |

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
