# HANDOVER — DriveAI

> **État courant du projet, tenu à jour à chaque session.** Lis-moi en premier pour reprendre
> le travail sans contexte. Le « pourquoi » détaillé est dans `PLAN.md` ; le découpage dans
> `BACKLOG.md` ; le déploiement dans `docs/DEPLOIEMENT.md`.
>
> **2026-07-23 — C28-28 « c'est toujours un bordel » (plan architecte NotebookLM, 3 axes, 3 PR).**
> Marc a coché 3 priorités (vider l'ancien à fond ; fichiers mal classés ; encore trop de dossiers),
> PAS « valider d'un coup d'œil » → plus d'automatisation, pas de gate manuel. Plan validé (ADR-0025,
> révise ADR-0014 pour le corbeillage en LOT). **PR1 (axes 2&3, classement + audit §8)** : prompt v2
> — candidature (05, entreprise VISÉE) jamais une entité → à plat (renfort du verrou référentiel qui
> route déjà à plat, PROUVÉ par l'audit) ; `estExportDonnees_` (Router) exclut les exports de MAILS
> (`Message_`/`Correspondance_`/`Courriel_`…) du dump `_Technique` → classés au domaine (placé APRÈS le
> filtre social : un vrai export Messenger « messages » reste `_Technique` ; `Relevé_` hors périmètre,
> ambigu). Audit §8 sur réel + contre-épreuves (export social conservé, facture .html non-export).
> 601 tests. **PR2 (axe 1 moteur) À VENIR** : détection auto des dossiers vidés → onglet Réorg
> `vide-candidat` (constat seul, jamais de suppression). **PR3 (axe 1 app) À VENIR** : bouton « Tout
> corbeiller » en lot (vérif live par dossier avant chaque mutation, moteur ne corbeille rien).
> **2026-07-23 — MOTEUR RÉVEILLÉ + accélération (C28-26-ACCEL).** Marc a exécuté `installerTrigger` :
> prise d'effet VÉRIFIÉE par signaux indépendants (lecture Drive) — heartbeat frais (Sheet d'état
> 13:32), `00·À trier` VIDE (intake sain), dossiers d'entités seed créés aux racines de domaine (dont
> « 783 avenue Moreau » RÉUTILISÉ sans doublon), `02·Finances` se remplit PAR ANNÉE (2022/2025/2026 —
> paies, T4, relevés, contrats courtiers), zéro dossier par banque, zéro doublon créé. **Constat** :
> rangement de fond correct mais LENT (goulot = la GÉNÉRATION du plan, pas l'exécution) et beaucoup de
> vieux dossiers de `03` pas encore drainés. **Décision Marc « accélérer »** → hausse des budgets
> QUOTIDIENS (`Config.gs` seul, aucune logique de classement) : génération 12→20 min/j (le vrai levier)
> + plafond 40→60/run ; exécution 6→12 min/j (juste assez pour ne jamais devenir le goulot) + plafond
> 60→100/run ; per-run exec inchangé (2 min, < garde-temps). **Enveloppe agrégée = 64 min/j** (histo 20
> + gen 20 + exec 12 + sync 12), marge ~26 min sous le quota runtime ~90 min/j — intake PRIORITAIRE.
> Revue flotte quota (garde ADR-0024) : 🟠 → à VÉRIFIER par signal indépendant (heartbeat qui ne se
> fige pas l'après-midi) et REDESCENDRE (exec 6 / gen 12) une fois le drainage fini. **⚠ Marc :
> ré-exécuter `installerTrigger` une fois cette PR mergée** pour que le nouveau budget prenne effet.
> **2026-07-09 — C26-08 LANCÉE (ADR-0018) : ANALYSE_V2 allumé + campagne ciblée 03/08 ; crédit
> rechargé (100 $) ; dry-run clos ; fusion 07→08 et incident Sheet SOLDÉS ; artefacts rangés
> sous 08 ; C28-14 session durable de l'app LIVRÉE ET VALIDÉE en prod.**
> • **⚠️ 2026-07-15 — INCIDENT DÉPLOIEMENT résolu : le moteur tournait du VIEUX code depuis ~4 j.**
>   Symptôme (Marc) : « Coûts & quotas vide » + quota Gmail toujours épuisé. Cause : `clasp push`
>   vert MAIS le déclencheur time-based exécutait la version chargée avant le 13/07 (onglet
>   `Télémétrie` jamais créé, `MIGRATION_TAG` figé sur `m1` au lieu de `m2-inconnu`, plafonds
>   C28-21 jamais appliqués — zéro erreur). Les features FRONTEND (Vercel) shippaient bien, seul le
>   MOTEUR était figé. RÉSOLU : Marc a ouvert l'éditeur (Extensions → Apps Script) + exécuté
>   `installerTrigger` → code frais activé, `Télémétrie` créé, Progression sur `m2-inconnu`, stable
>   sur plusieurs ticks (pas de « projet fantôme »). **Le déclencheur est repassé à 30 min** (réglage
>   Marc du matin) — abaisser dans les Réglages si besoin de rapidité. Quota Gmail du compte
>   réellement à sec pour le 15/07 (vidé par le vieux code) → recharge la nuit, plafonds désormais
>   actifs. Leçon durable ajoutée (CLAUDE.md §7, 3ᵉ piège auto-déploiement : vérifier la PRISE
>   D'EFFET par signal indépendant, pas le run vert).
> • **2026-07-21 — C28-26-EXEC (suite) : correctifs revue flotte (PR-C) — MERGÉE (#189).**
>   Le lot moteur COMPLET (taxonomie à plat + seed + exécuteur + correctifs) est sur `main` ;
>   **reste à Marc : `installerTrigger` (Extensions → Apps Script) pour réveiller le moteur** —
>   signal de prise d'effet INDÉPENDANT : l'onglet `PlanConsolidation` se remplit en `conso-2`,
>   les dossiers d'entités seed apparaissent aux racines de domaine, plus aucun dossier d'émetteur
>   créé. Puis validation corbeille des dossiers vidés dans l'app (ADR-0014). NB fusion de
>   rattrapage : `main` avait avancé (#186–#188) → merge `origin/main`, artefact d'auto-merge
>   corrigé (appel `appliquerPlanConsolidation_` DUPLIQUÉ dans Main.gs — leçon consignée). 4 agents. 🔴 principal
>   (code-reviewer) : le plan conso-1 a pu se générer AVANT le seed (4 jours de cibles pré-seed :
>   dossiers de banque, noms périmés) → (1) **cible RECALCULÉE au moment du move** (règle unique +
>   référentiel COURANT — la colonne Cible n'est qu'une trace ; `decouperCiblePlan_` retirée) ;
>   (2) **rotation de tag `conso-2`** (purge du plan périmé + curseurs à zéro, dans le générateur).
>   Quotas : échec compté **≤ 1×/JOUR** (abandon = 3 jours distincts, jamais 3 ticks) ; enveloppe
>   quotidienne exec 10→6 min (agrégat campagnes < quota runtime) ; **exec AVANT gen** + contre-
>   pression `CONSOLIDATION_BACKLOG_MAX` (drainer avant d'alimenter) ; court-circuit terminal.
>   Sécurité : refus des IDs de **dossier** (ligne forgée), motifs élargis, tripwire repo-wide
>   anti-FUITE (`setSharing`/`addEditor`/`addViewer`). Structure : réutilisation des dossiers à
>   casse divergente (« 783 avenue Moreau » minuscule existant), **alias VW↔Volkswagen**
>   (canoniserVehicule_), TAXONOMY retouché ×3, ADR-0024 « révise ADR-0023 D4 ». 595 tests.
> • **2026-07-21 — C28-26-EXEC : « c'est toi qui le fais » (ADR-0024, 2 PR).** Décision Marc
>   (verbatim : changer tout LIVE, pas de dossier par banque, ajout de dossiers sécurisé/utile
>   seulement — dérogation §4 assumée, revue flotte en garde-fou). **PR-A #185 (mergée)** : seed
>   one-shot des 15 entités RÉELLES validées par le code (4 logements : 3325 4e Avenue, 783 Avenue
>   Moreau, 3987 Route Des Rivières, 1548 Avenue De La Roselière ; Ford Fiesta, VW Jetta,
>   Toyota bZ ; Automatech, Robovic ; 6 écoles) + DÉVALIDATION des entités 02 (« pas de dossier
>   par banque », statut tracé) + auto-validation ≥3 vues COUPÉE (`ENTITES_AUTO_VALIDATION:
>   false`) + prompts sans banque. **PR-B** : NOUVEAU `src/ConsolidationExec.gs` — applique
>   Déplacer/Doublon du PlanConsolidation au fil de l'eau : `moveTo` SEULE mutation (verrou de
>   surface), §1 re-vérifiée STRICTE par mutation, multi-parents jamais déplacé, cible parsée/
>   validée (`decouperCiblePlan_` — jamais un chemin arbitraire), curseur append-only, abandon
>   tracé à 3 échecs (curseur jamais gelé), budgets 2 min/run + 10 min/j (ms réelles),
>   `CONSOLIDATION_EXEC_ACTIF: false` = suspension immédiate. Les dossiers VIDÉS restent pour la
>   corbeille APP (clic Marc, ADR-0014 — non négociable). 587 tests. **⚠ Marc : `installerTrigger`
>   pour activer, puis le Drive se transforme tout seul ; sources NotebookLM à ajouter :
>   `src/ConsolidationExec.gs`, `docs/adr/0024-execution-consolidation.md`.**
> • **2026-07-17 — C28-26 : campagne de consolidation ALLUMÉE (`CONSOLIDATION_ACTIF: true`).**
>   Correctifs revue flotte mergés (#183) → allumage (« continue », Marc). Le moteur GÉNÈRE le plan
>   dans l'onglet `PlanConsolidation` (~12 min/j max, dry-run PUR — rien ne bouge). ⚠ PRISE D'EFFET :
>   le déclencheur doit charger le nouveau code — Marc ouvre l'éditeur Apps Script + exécute
>   `installerTrigger` ; signal indépendant = l'onglet `PlanConsolidation` se remplit. Fin de
>   campagne = Journal « Plan de consolidation TERMINÉ (tag conso-1) ». ENSUITE : Marc valide le
>   plan (+ ses entités dans l'app + liste des logements) → chantier d'EXÉCUTION des déplacements
>   (séparé, avec re-vérif §1 par mutation, jamais codé sans nouveau plan §4).
> • **2026-07-16 — C28-26 (suite) : correctifs revue flotte (PR3).** 4 agents, verdicts convergents ;
>   tout corrigé avant tout allumage : (1) 🔴 `entitesValideesParCle_` mort-né (`chargerEntitesCache_`
>   ne retourne rien → `entitesCache_()`) ; (2) 🔴 verrou « entité majeure » re-branché sur le champ
>   GATÉ `sousDossier` + **verrou RÉFÉRENTIEL** : un dossier d'entité n'existe QUE si l'entité est
>   VALIDÉE (demande initiale de Marc) ; (3) 🔴 matérialisation d'entités → racine du domaine SANS
>   squelette ; (4) 🔴 arbitrage Marc « **entité OU année** » (02/Desjardins sans année, tout-venant
>   02/2026) → RÈGLE UNIQUE `sousCheminDomaine_` (Router.gs) partagée flux vivant ↔ consolidation +
>   TRIPWIRE test (divergence = « Déplacer » en boucle) ; (5) 🔴 budget QUOTIDIEN de campagne
>   (12 min/j, ms réelles persistées `DriveAI_CONSO_JOUR`) + garde de collecte à mi-budget
>   (anti-plateau) + domaines épuisés `conso|<tag>|dom|<nom>` (anti re-walk) ; (6) 🟠 empreinte
>   JAMAIS dans l'Index (auto-doublon intake), identité scopée à son domaine dans la cible, raison
>   §1 honnête, motifs anti-mutation élargis. `docs/TAXONOMY.md` RÉÉCRIT (à plat, règle unique,
>   interdits, campagne), ADR-0023 révisé. 575 tests moteur. **L'allumage de `CONSOLIDATION_ACTIF`
>   attend le merge de ces correctifs.** Notes : raccourcis multi-entités = abandon ACTÉ (hérités
>   « Ignoré ») ; suffixes anti-écrasement `_2` ciblés à plat (connu) ; toujours en attente de Marc :
>   liste exacte des LOGEMENTS (validation des entités 03).
> • **2026-07-16 — C28-26 : refonte de l'arborescence — plan architecte EXÉCUTÉ (ADR-0023, 2 PR).**
>   Retour Marc : « trop le bordel ». Recensement réel (13 agents) →
>   `docs/diagnostics/2026-07-16-recensement-drive.md` (~499 dossiers dont ~102 vides, ~2 880
>   fichiers dont ~1 357 à plat et ~909 Inconnu). **PR1 #181 (mergée)** : classement à PLAT par
>   défaut — `sousDossierPourNom_` sans replis émetteur/catégorie/« Divers » (entité MAJEURE
>   canonisée, type d'identité, ou '' = racine du domaine), `deciderRoutageV2_` route '' à la
>   racine (le 2ᵉ repli « Divers » aurait neutralisé le fix), prompts v2 alignés aux 3 endroits.
>   **PR2** : campagne de CONSOLIDATION dry-run — NOUVEAU `src/Consolidation.gs` (plan → onglet
>   `PlanConsolidation` ; cible = domaine [+/AAAA si 02] [+/entité VALIDÉE] sinon plat ; identité →
>   dossier de TYPE ; doublons par empreinte de CAMPAGNE (jamais l'Index — auto-doublon ; jamais
>   les Properties — ~93 Ko > 9 Ko) ; garde §1 STRICTE → « Ignoré » avec constat ; convergence
>   `conso|<tag>|fileId` ; « terminé » sur passe vide). Flag `CONSOLIDATION_ACTIF: false` —
>   **Marc l'allume** (Réglages/Config) pour générer le plan, le VALIDE, puis l'exécution des
>   déplacements sera un chantier séparé. 572 tests moteur. **⚠ Marc : ajouter `src/Consolidation.gs`
>   aux sources NotebookLM.** À fournir : liste exacte des LOGEMENTS (pour valider les entités 03).
> • **2026-07-15 — C28-22 correctifs revue flotte (moteur + app + ADR).** Trois correctifs sur le
>   chantier C28-22 (déjà mergé, PR #175/#176/#177) : (1) le compteur 3-strikes d'abandon
>   d'intention (`creerIntentionIdempotente_`) est re-clé sur `api-intention|<messageId>` (avant :
>   sur le contenu incluant le titre LLM) — le titre Sonnet 2-passes fluctue d'un run à l'autre →
>   une clé par contenu ne convergeait jamais (mail re-tenté à vie, quota Gmail drainé, la panne
>   même que C28-22 bornait) ; journal désormais 1× (`=== seuil`). Compromis assumé : sémantique
>   PAR MESSAGE (compteur partagé entre intentions d'un même mail — une intention légitime rare peut
>   être perdue sur un mail ≥ 3 intentions en fenêtre de panne). (2) Nouvelle jauge télémétrie
>   `tri_boite_fils_jour` (nettoyage profond de la boîte) — moteur `lignesTelemetrie_`/`majTelemetrie_`
>   + app `interpreterTelemetrie`/Quotas (4ᵉ jauge de « Coûts & quotas »). (3) ADR-0022 aligné sur le
>   code (`−29 j`) + limite de `heuristiquePhishing_` documentée. 560 tests moteur + 179 app.
>   **Revue flotte (3 agents) : 🟢 sécurité, 🟢 quotas (convergence garantie), code-reviewer « prêt à
>   merger ».** Note hors-scope à suivre : le chemin EXTRACTION (`extraireIntentions_` null persistant)
>   n'est pas borné par un 3-strikes (pré-existant, atténué par `estPannePlateforme_`) — candidat au
>   prochain tour. À trancher avec Marc (archi) : budget Gmail AGRÉGÉ vs plafonds par-scan séparés.
> • **2026-07-15 — HUB : `GET /api/hub/summary` (widget DriveAI sur le hub perso, MERGÉ PR #178).**
>   100 % additif (aucune touche au moteur, à `app/` hors URL, ni aux scopes). NOUVEAUX
>   fichiers : `api/hub/summary.ts` (jeton `x-hub-token` temps constant → 503 hub disabled / 401 /
>   405, `Cache-Control:no-store`, forme du contrat `@mokarade/hub-contract` v1 inlinée car api/ =
>   zéro-dep) + `api/hub/_engineState.ts` (`getEngineState()` → `null` en Phase 0). Ancien
>   `api/hub-summary.ts` (+ rewrite `vercel.json`) SUPPRIMÉ au profit de la route native
>   `/api/hub/summary`. Phase 0 = summary honnête `status:"building"` (zéro métrique inventée —
>   les vraies données vivent dans la Sheet, lue côté navigateur, ADR-0007). Verrou
>   `app/test/hub-summary.test.ts` (VRAI schéma `validateSummary`/`buildingSummary`). URL canonique
>   **`https://drive.hubperso.com`**. Marc a demandé « merge vite » → mergé (Vercel déploie en prod
>   sur push `main`). **⚠ Reste à ACTIVER côté Marc** (l'endpoint répond `503 hub disabled` tant que
>   non fait — échec fermé, sûr) : (1) poser `HUB_TOKEN` (Vercel, `openssl rand -hex 32`, même valeur
>   côté hub) ; (2) brancher le domaine `drive.hubperso.com` sur le projet Vercel. Phase 1 (brancher
>   `getEngineState()` sur le Sheet) = tâche BACKLOG `HUB-P1`, bloquée par le moteur. **⚠ Marc :
>   ajouter `api/hub/summary.ts` + `api/hub/_engineState.ts` aux sources NotebookLM.**
> • **2026-07-15 — C28-25 : Cockpit Unique (plan architecte, PR #173)** : onglet « Mails » SUPPRIMÉ,
>   fusionné dans « Aujourd'hui ». Le seul bloc utile restant (20 derniers fils triés + ➕ création
>   de tâche/RDV depuis un fil) rapatrié en carte REPLIABLE (fermée par défaut, compte visible) ;
>   `Mails.tsx` supprimé (tuiles/suspects déjà dans l'accueil, table apprise dans Apprentissage) ;
>   barre basse mobile promeut Apprentissage (4 boutons + Plus) ; E2E 7→6 sections. Pur front, 174
>   tests app. **⚠ Marc : retirer `Mails.tsx` des sources NotebookLM.**
> • **2026-07-15 — C28-24 : UX instantanée + archivage total des lus + télémétrie (plan
>   architecte NotebookLM, 3 PR #167/#168/#169)** : (1) tri à la demande recentré — requête
>   FIGÉE `in:inbox is:read` (TOUS les mails lus, plus de fenêtre), offset de file MOUVANTE
>   (n'avance que des fils restés en boîte — `trierFil_` rapporte `'archive'`), plafond
>   quotidien 500 fils lus/j (patron C28-21), suspects ⚠/importants ⏰ toujours protégés par
>   `decisionTri_` ; (2) « pas suspect » instantané — anti-rafale 5 s RETIRÉ côté moteur,
>   tuiles/zone Attention re-rendues AU CLIC (store `useSuspectsVisibles`) ; (3) progression
>   SUR PLACE — OperationsLive vit dans PanneauActions ; (4) sidebar repliable en rail
>   d'icônes (☰, persistée) + table apprise déplacée vers Apprentissage (repliable) ;
>   (5) NOUVEL onglet Sheet `Télémétrie` (majTelemetrie_ au finally du tick) + NOUVELLE vue
>   « Coûts & quotas » (jauges des 3 scans plafonnés, coût LLM vs frein, note honnête : quota
>   Gmail FIXE ~20 000 lectures/j). 534 tests moteur + 174 tests app. NOUVEAU fichier :
>   `app/src/vues/Quotas.tsx` (source NotebookLM à ajouter par Marc).
> • **2026-07-10 — C28-18 retours Marc appliqués (#143/#144)** : « resté bloqué, manque d'info,
>   qualité visuelle » → deux langages visuels (ruban ANIMÉ = ça travaille ; piste RAYÉE statique
>   = à l'arrêt), note d'explication sous chaque état non trivial, heure moteur en tête, compteurs
>   non informatifs masqués, plafond 99 % hors vraie fin. Contre-vérif prod : m1 n'était PAS
>   bloquée (phase de recensement puis reprise, 5 docs re-classés 16:47-16:52) ; son recensement
>   coupé au budget a posé une base partielle (0) — la re-base absorbe, « terminé » viendra sur
>   passe vide puis C26-08 s'enchaîne seule.
> • **2026-07-15 — C28-23 : app v5 « Material Dark » + Agenda clone Google Agenda (plan
>   architecte NotebookLM, 3 PR #161/#162/#163)** : demande Marc (capture GCal fournie) « que
>   l'agenda ressemble exactement à ça et que le style de l'app épouse entièrement ce style
>   google », cadré par 12 questions. Livré : thème SOMBRE seul (theme.ts supprimé), layout
>   topbar + sidebar façon Google (FAB + Créer, mini-calendrier qui pilote le grand Agenda —
>   dateAgenda remontée dans App, « Mes agendas » trompe-l'œil sans scope §2.3), menu avatar ;
>   Agenda : grille horaire ABSOLUE Jour/Semaine/Mois (Semaine défaut), rangée toute-la-journée
>   multi-jours, ligne « maintenant », couleurs par type, mobile 3 jours glissants, clic-créneau
>   → création pré-remplie, popover d'événement/tâche façon GCal. Pur front, aucun scope, 171
>   tests app, captures E2E inspectées à chaque PR. NOUVEAUX fichiers : composants/Sidebar.tsx,
>   composants/MiniCalendrier.tsx (sources NotebookLM à ajouter par Marc).
> • **2026-07-14 — C28-22 : cadrage (boucle Tasks 403, arnaques → tâches, anciens mails)** :
>   l'API Google Tasks n'est PAS activée dans le projet GCP (403 depuis le 07/07, re-tenté à
>   chaque tick → quota Gmail drainé) ; mails d'ARNAQUE « Google Cloud 10 USD » transformés en
>   tâches par les intentions élargies ; mails en boîte > 30 j couverts par AUCUN scan. Actions
>   Marc : spammer les arnaques PUIS activer l'API Tasks (console GCP). Prompt NotebookLM livré
>   (plan d'implémentation attendu : échecs Tasks/Calendar bornés + garde suspect→jamais de
>   tâche + campagne arrière > 30 j).
> • **2026-07-13 — C28-21 : quota Gmail rendu au flux vivant + migration recentrée (plan
>   architecte NotebookLM, 2 PR)** : retours Marc « aucun mail archivé » (attente : lu ⇒ archivé
>   en ~min) + « tellement de fichiers Inconnu ». Diagnostic : quota Gmail drainé EN CONTINU par
>   la passe de VÉRIFICATION historique (964 fils re-parcourus depuis l'offset 0 à chaque retour
>   de quota — re-mort en 8 s-6 min, 2-11 fils triés/j) ; 2 944 fichiers « Inconnu » (v1) avec m1
>   à ~50-90 docs/j et c26-08 en attente derrière. Livré : (1) PR #153 — `estAMigrer_` ne
>   collecte QUE les noms portant « Inconnu » (tag `m2-inconnu`, barre re-recensée, c26-08
>   enchaîne à sa fin) ; (2) PR #154 — plafonds QUOTIDIENS dans l'unité réelle :
>   `GMAIL_HISTO_MAX_FILS_JOUR` 150 + `TRI_CYCLIQUE_MAX_FILS_JOUR` 150 (compteurs persistés par
>   jour, retour immédiat sans recherche au plafond ; fils comptés même sur page interrompue ;
>   page cyclique rétrécie au reliquat). Attendu dès demain : le tri/archivage vit TOUTE la
>   journée (~96 % du quota au flux vivant), la demande « Tri 7 j/100 fils » de Marc se sert au
>   retour du quota (~03h) ; m2-inconnu finit en jours puis c26-08 draine 03/08.
> • **2026-07-13 — C28-20 : zéro configuration client + verrou d'identité (ADR-0021, plan
>   NotebookLM)** : demande Marc « je veux rien avoir à mettre, juste mon compte Google ».
>   Livré : `/api/login` demande en plus `openid email` ; `/api/callback` compare l'email VÉRIFIÉ
>   de l'`id_token` à la variable Vercel `ALLOWED_EMAIL` — mismatch ⇒ AUCUN cookie, bannière
>   « accès refusé » ; NOUVEAU `api/config.ts` délivre `SPREADSHEET_ID`/`WEBAPP_URL`/
>   `WEBAPP_SECRET` (env Vercel) aux seules sessions au cookie déchiffrable (401 sinon) ;
>   `app/src/config.ts` refondu en mémoire de module (`chargerConfigServeur()` après connexion) —
>   écran Configuration, localStorage et `VITE_*` SUPPRIMÉS ; App.tsx séquence connexion → config
>   → vues. Scopes du MOTEUR Apps Script inchangés (aucune ré-autorisation). `session.test.ts`
>   INTACT, +6 tests bff + 5 tests handler callback (revue flotte : « promesse de verrou =
>   verrou codé »). **⚠ Marc doit poser 4 variables Vercel : `ALLOWED_EMAIL`
>   (marc.richard4@gmail.com), `SPREADSHEET_ID`, `WEBAPP_URL`, `WEBAPP_SECRET` — ET RÉGÉNÉRER
>   `COOKIE_SECRET` au même moment (trou de migration relevé en revue : un cookie de session
>   posé AVANT le verrou resterait valable 1 an et passerait /api/config ; la rotation invalide
>   tout, une reconnexion suffit). docs/DEPLOIEMENT.md §Phase 4 ; sans les variables,
>   « configuration indisponible » après connexion.**
> • **2026-07-13 — C28-19 : curation des mails (ADR-0020, plan NotebookLM)** : retours Marc
>   « facture sans tâche / lus non archivés / trop de faux suspects / pas de bouton ». Livré :
>   prompts intentions ÉLARGIS (facture à payer / action requise ⇒ tâche Tasks + ⏰ en boîte) ;
>   `scanCycliqueTri_` (offset persistant qui fait le tour de la boîte 30 j en ~30-60 min — un
>   fil lu tardivement finit TOUJOURS re-trié donc archivé ; scan avant + mur conservés pour la
>   latence du neuf, déviation documentée) ; onglet `Confiance` + `decisionSuspect_` PURE
>   (le clic « ✓ Pas suspect » de l'app apprend l'expéditeur — outrepasse heuristique, LLM et ⚠
>   déjà posé ; le libellé Gmail physique reste, §2.3) ; `actionPasSuspect_` (doPost) + purge/
>   re-tri sous le verrou du tick. Audit §8.5 sur les 5 faux positifs réels. **⚠ Marc doit
>   REDÉPLOYER la web app (« Nouvelle version ») pour activer le bouton.** La règle d'archivage
>   est INCHANGÉE (archivé une fois lu — décision re-confirmée).
> • **2026-07-10 — C28-18 : progression LIVE des opérations (plan NotebookLM)** : l'onglet
>   `Progression` devient un tableau multi-opérations (7 colonnes) écrit UNE fois par tick dans le
>   `finally` (`majProgressions_` — les avancées partielles d'un run interrompu comptent aussi) ;
>   l'app le lit en poll dédié 15 s HORS cache (≈ 4 req/min, ~1 % du quota Sheets) et l'accueil
>   affiche un widget par opération : barres m1/C26-08 (bases posées par un recensement DÉDIÉ,
>   filet du compte partiel), tri/intentions à la demande (x/plafond, instantané « solde » si servi
>   en un tick), historique Gmail (indéterminé), statuts dérivés en toutes lettres (suspendu quota
>   Gmail / pause frein budget / en attente après m1 / terminé, purge 48 h). L'ancienne barre texte
>   du rangement est retirée (état Properties conservé). Attention au 1ᵉʳ tick post-déploiement :
>   m1 marque une pause de 1-3 ticks (recensement de sa base) avant de reprendre.
> • **2026-07-10 — C28-17 : accueil v4 « cockpit central » (ADR-0019, plan NotebookLM)** : Marc
>   trouvait le bouton de tri « trop inaccessible, trop bas » et le dashboard « trop compliqué ».
>   Accueil TOUT-EN-UN en 3 zones : (1) `composants/PanneauActions.tsx` PARTAGÉ (accueil + haut de
>   Mails) — « Vérifier maintenant » remonté du header + intentions 30 j + tri paramétré + analyse
>   ciblée ; (2) zone ATTENTION (contour ambré) — suspects, documents « à vérifier » (nouveau
>   sélecteur `lignesAVerifier`), entités à valider avec « Aller valider » → Apprentissage ; tout
>   vide ⇒ « Tout est à jour ✅ » ; (3) zone ACTIVITÉ discrète (l'existant v3). Décisions Marc :
>   Trier/Analyser/Vérifier en 1 clic (pas la Recherche IA), priorité au « à faire », mobile et
>   desktop à parts égales. Vérifié par captures (desktop + 390px). Purement front — rien à
>   redéployer côté moteur.
> • **2026-07-10 — C28-16 : panneau « Analyser & trier » (vue Mails)** : Marc déclenche à la
>   demande les intentions (30 j complets, mur déjà-vu ignoré) et le tri Gmail PARAMÉTRÉ
>   (fenêtre 1/7/30 j, archiver oui/non, plafond de fils) — demandes posées par la web app
>   (`demande-tri`/`demande-intentions`), consommées par le tick en TÊTE du flux vivant,
>   étalées sur plusieurs ticks (offsets persistés). Clic pendant une suspension de quota =
>   UNE re-sonde forcée ; toujours mort → « QUOTA_GMAIL » affiché en clair avec l'heure de
>   reprise. **✅ VALIDÉ en prod par Marc (« ok ça a lancé »)** après redéploiement de la web
>   app et correction du secret/URL (piège : « Nouveau déploiement » CHANGE l'URL `/exec`).
> • **2026-07-10 — C28-15 : mails ni triés ni archivés → ordre d'équité strict + suspension
>   quota Gmail (plan NotebookLM, décisions Marc « équilibre strict » + « tout rattraper »)** :
>   le quota d'appels Gmail mourait dès ~08h10 (campagne historique) et le tri était affamé
>   toute la journée (4-17 fils/j au lieu de ~90). Correctifs : intentions + tri REMONTÉS avant
>   toutes les campagnes dans le tick ; suspension persistée `DriveAI_GMAIL_QUOTA` (re-sonde 2 h,
>   patron R2) câblée dans TOUS les scans Gmail ; budget quotidien de l'historique 60 → 20 min/j
>   (déviation documentée : la page fait 10 fils, le frein 50 fils/run du plan est inerte seul) +
>   frein `GMAIL_HISTO_MAX_FILS_PAR_RUN`. Attendu : tri fiable dès demain matin ; l'historique
>   finit plus lentement (prix accepté). ✅ Vérifié en prod le 10/07 : UNE ligne « QUOTA GMAIL
>   ÉPUISÉ » à 11:10 puis silence (suspension propre, fini le re-spam) ; rattrapage cette nuit.
> • **2026-07-10 — frein campagnes 65 → 110 $ (décision Marc « b », révision ADR-0018)** : m1 a
>   basculé en v2 avec l'allumage du flag (coût/doc ×10 — 54,59 $ au compteur le 10/07 matin,
>   1 209 docs migrés, 0 « Inconnu » produit par la v2 depuis la reprise). À 65 $ tout se serait
>   suspendu jusqu'au 1ᵉʳ août ; Marc préfère finir cette semaine (~40-50 $ restants : fin m1
>   puis C26-08 sur 03/08). Stock `_Inconnu` restant : 1 210 docs, drainé par les 2 campagnes.
>   REDESCENDRE le plafond à 10 à la fin (le Journal dira « Re-analyse v2 ciblée terminée »).
> • **C28-14 — session durable (« me connecter une fois »)** : fini GIS — flux Authorization Code
>   via 4 fonctions serverless Vercel (`api/` racine, zéro dépendance), refresh token en cookie
>   HttpOnly CHIFFRÉ (COOKIE_SECRET), access token en sessionStorage (verrou session.test.ts
>   INTACT), restauration silencieuse au chargement + rejeu auto sur 401, clientId retiré du
>   client. **Configuré et VALIDÉ par Marc le 2026-07-09** (URI de redirection
>   `https://driveai-ivory.vercel.app/api/callback`, 3 variables Vercel posées, Redeploy fait,
>   test « onglet fermé/rouvert → connecté sans clic » concluant). Détail : DEPLOIEMENT.md §Phase 4.
> • **C26-08 CODÉE (décision Marc « go 2ᵉ option », plan NotebookLM, ADR-0018)** :
>   `ANALYSE_V2: true` (flux vivant en Sonnet 2 passes), `DRYRUN_V2_ACTIF: false` (clos),
>   `LLM_BUDGET_CAMPAGNES` 30 → **65 $** (temporaire — **redescendre à 10 à la fin de C26-08**,
>   checklist dans l'ADR). Campagne `reanalyse|c26-08|` sur `REANALYSE_CIBLES` = `03 · Logement`
>   (186 docs) + `08 · Perso` (738 docs) ≈ 24 $ : même mécanique que m1, démarre SEULE à la fin
>   de m1 (garde `DriveAI_MIGRATION`), 03/08 exclus de m1 dès ce merge (jamais payés 2×).
>   Fin de campagne = Journal « Re-analyse v2 ciblée terminée (tag « c26-08 ») ».
> • **C26-07 TERMINÉ (100/100 le 08-07 18:33, coût mesuré 2,61 $)** — rapport avant/après complet
>   livré à Marc (artifact « Dry-run v2 — preuve avant/après »). Chiffres : **0 fail-safe** (la revue
>   reste l'exception, 0/100), confiance médiane 0,93 (2 docs < 0,7), 22 changements de domaine
>   proposés dont 3 refusés par le garde zone protégée (§2.1b) → **19 applicables**, 62 renommages
>   (titulaire sur les papiers d'identité : `Passeport_Préfecture…` → `Passeport_Marc Richard`),
>   76 sous-dossiers d'entité, 24 non-documents écartés (`_Médias`/`_Technique`).
> • **Panne de crédit Anthropic du 08-07 ~21:40 → rechargée par Marc le 09-07 ~14h** (HTTP 400
>   « credit balance » à chaque re-sonde horaire pendant ~16 h ; le filet R2 a fonctionné : sources
>   suspendues, re-sonde 1×/h, AUCUNE quarantaine à tort, zéro coût brûlé). Reprise auto ≤ 1 h
>   après recharge — vérifier par signaux Drive (docs classés au Journal, file À trier qui bouge).
>   Nota : le Journal répétait « 12 document(s) re-classé(s) (m1) » chaque heure PENDANT la panne —
>   libellé trompeur (soumissions qui échouent vite, rien d'inscrit), comportement correct ;
>   les nouveaux messages Réanalyse disent « soumis » (correctif appliqué à C26-08, pas à m1).
> • **Fusion « 07 · Perso & projets » → 08 SOLDÉE** : `terminerFusionDomaine07` exécutée par Marc
>   (11 Entités + 349 Domaine + 340 Chemin ré-étiquetés) ; contre-vérifiée sur export xlsx —
>   0 occurrence restante dans Entités et les colonnes Domaine/Chemin (survivances = historiques
>   inoffensives : noms `[REVUE]` de juin, onglet Revue pré-ADR-0016, bilan Journal).
> • **Incident Sheet 100 % clos** : Sheet incident renommée puis CORBEILLÉE par Marc (réparation
>   re-portée avant), `DriveAI_extract_temp` (orphelin d'une coupure — `Ocr.gs` le supprime
>   normalement en `finally`) corbeillé aussi.
> • **Artefacts DriveAI rangés sous `08 · Perso & projets/DriveAI`** (demande Marc, plan NotebookLM
>   validé + contre-vérifié dans le code) : Sheet d'état, projet Apps Script, formulaire de
>   correction — tous natifs Google (invisibles des collecteurs, `Maintenance.gs:291`) et résolus
>   par ID (aucun code touché, zéro interruption vérifiée par heartbeat post-déplacement).
>   **`_Doublons` et `_Miroir du dépôt` restent à la racine de `Nouvelle structure 2026`** : les
>   collecteurs de masse parcourent récursivement chaque domaine — les nicher sous 08 ferait
>   aspirer leur contenu vers `00 · À trier`. Règle : jamais de fichier NON-natif sous `08/DriveAI`.
> • Rangement ancien Drive : 100 % (2 802/2 802, terminé ✅). Captures : `captures-app.pdf` arrivé
>   dans le miroir (sync #39) — source NotebookLM à ajouter par Marc.
>
> **2026-07-08 (fin de soirée) — ANOMALIES PROD corrigées (PR #126).** Deux constats chiffrés sur
> l'état réel : (1) ~9 fichiers « Access denied » re-tentés par le rangement à CHAQUE tick →
> `deplacerVersATrier_` passe les échecs par `gererEchec_` (quarantaine après 3, clé `drive|` qui
> stoppe la re-collecte — la Relance app = chemin de retour) et inscrit les fichiers protégés une
> fois (`zone protégée`) ; (2) domaine AUTO erroné « 07 · Perso & projets » (340 docs) doublonnant
> le canonique 08 → **`fusionnerDomaine07PersoVers08`** (Maintenance.gs, one-shot manuel,
> reprenable) : **Marc doit l'exécuter dans l'éditeur APRÈS le merge et AVANT C26-08.** Aussi :
> quota Gmail du jour épuisé par l'incident (tri en pause, reprise auto ~03:00) ; 93 % des docs
> classés sont à la RACINE de leur domaine (2 421/2 607 — attendu en v1, c'est C26-08 qui rangera
> en sous-dossiers) ; dry-run 33/100, surveillance horaire armée.
>
> **2026-07-08 (soir) — PLANS P1/P2/P3 EXÉCUTÉS + ⚠ INCIDENT PROD (Sheet d'état recréée à vide).**
> • **⚠ INCIDENT (ouvert, décision Marc attendue)** : à 02:34 EDT, un échec TRANSITOIRE de
>   `SpreadsheetApp.openById` (dégradation Google, `Access denied: DriveApp` en rafale au même
>   moment) a déclenché le fail-open de `getSheetEtat_` (src/Config.gs:524) : **nouvelle Sheet
>   « DriveAI — État » créée VIDE + `DriveAI_SHEET_ID` écrasé**. Depuis : le moteur tourne sur la
>   NOUVELLE Sheet (Index reparti de 0 — 254 lignes re-faites, ~87 PJ Gmail re-déposées en
>   copies/doublons dans Drive, file d'entités re-proposée, TriAppris re-appris, +~0,8 $ LLM) ;
>   l'ancienne Sheet (4 385 lignes, les validations de Marc) est ORPHELINE — et l'**app de Marc
>   pointe toujours l'ancienne** (ses gestes n'atteignent plus le moteur). Le dry-run v2 écrit
>   dans la NOUVELLE (démarré après la bascule — pas de fork pour lui). AUCUNE perte définitive
>   (append-only, rien de supprimé). Correctif + fusion d'état = prompt NotebookLM généré (règle
>   §4), plan architecte validé puis EXÉCUTÉ. IDs : ancienne
>   `10VSEgfSulXn2V5apYktNOzWTm3y_V4iaBxsm_hRc7UY`, nouvelle
>   `1SY8PiuQ3G3U0xlp63Wihax-efl3NEZIyX2af__hBSY8`. Livré : `getSheetEtat_` ÉCHEC FERMÉ (jamais
>   de re-création quand l'ID existe — tripwire `test/sheet-etat.test.js`) + `reparerIncidentSheet`
>   (Maintenance.gs, SANS `_` final sinon masquée de l'éditeur) : réparation UN CLIC — inédits
>   re-portés dans l'ancienne Sheet, copies de rejeu écartées dans `_Doublons` (protégés laissés
>   en place, original jamais touché grâce au filtre date de création), Journal+DryRunV2 fusionnés,
>   bascule `DriveAI_SHEET_ID`, marqueur d'idempotence DUR (jamais 2 passages).
>   **RESTE : Marc exécute `reparerIncidentSheet` dans l'éditeur Apps Script après le merge.**
> • **P1 (#122, mergé)** : jeton GIS en sessionStorage (verrou source-scan `session.test.ts`),
>   fournisseur d'état GLOBAL (`etatGlobal.tsx`, 5 min + ⟳), Index servi en ÉTAT COURANT
>   (`etatCourantIndex` — suspects honnêtes, C28-13), badge « Synchro HH:MM », dates formatées.
> • **P2 (#123, mergé)** : vue Agenda Mois/**Semaine** (`grilleSemaine`), carte « Créer » en tête
>   + composant réutilisable, « ➕ » par fil Gmail (modale pré-remplie + marqueur
>   `intention-manuel|<threadId>` que le moteur saute — préfixe DÉDIÉ, collision threadId=1er
>   messageId évitée), **analyse ciblée des mails** (formulaire → `action=analyse-ciblee` →
>   `balayerAnalyseCiblee_`, campagne frein-budget/plafonds, anti-plateau, offset lié à la
>   requête). **⚠ Marc doit redéployer la web app (Nouvelle version)** pour activer l'action.
> • **P3 (en PR)** : drag-and-drop accéléré (ascendances dossiers mémoïsées, invalidation de
>   cache par onglet, traces Sheet en tâche de fond) + **réconciliation Index↔Drive**
>   (`synchroniserIndex_`, campagne perpétuelle bornée/convergente, statuts `déplacé`/`corbeillé`).
> • Dry-run v2 : continue de remplir l'onglet `DryRunV2` (nouvelle Sheet) — validation Marc
>   attendue avant C26-08.
>
> **2026-07-08 (après-midi) — GROSSE RAFALE : dry-run LANCÉ, 3 plans NotebookLM exécutés,
> captures E2E, miroir COMPLET à plat.** Sur feu vert de Marc, PR #114-#120 toutes mergées :
> • **Dry-run v2 EN COURS** (`DRYRUN_V2_ACTIF: true`, #114) — l'onglet Sheet `DryRunV2` se
>   remplit (~100 docs, ~3-6 $) ; à valider par Marc, puis C26-08. Repasser le flag à false après.
> • **P5 (#115)** : panne API DURABLE (429/529/5xx en série, seuil `LLM_ECHECS_SYST_MAX`) → même
>   suspension/reprise auto que la panne de crédit. • **P4 (#118)** : canonicalisation des entités
>   sur le chemin VIVANT + « reality check » Drive (`dossiersExistantsDomaine_`) + curation
>   rétroactive (tag `c2`) — la file d'apprentissage se nettoie seule (« Richard Marc » déjà
>   refusé en prod). • **C28-14 (#116)** : captures d'écran des 6 sections à chaque push (mode
>   mock `VITE_E2E_MOCK`, artifact CI `e2e-screenshots`, zéro fuite prod prouvée). • **Miroir
>   révisé 2× (#117, #119)** : À PLAT (`src---Router.gs.txt` — NotebookLM sélectionne sur un
>   niveau) puis COMPLET (binaires utiles pdf/png/jpg/svg en base64 + PATCH REST en place ;
>   allowlist stricte). • **2 fixes d'incident sync (#119, #120)** : les pannes transitoires
>   d'Apps Script /exec ont DEUX signatures (404 ET 200+HTML « doGet ») → succès d'un lot = JSON
>   `ok:true`, rejoué 3×, échec réel = run rouge (leçon durable CLAUDE.md §7). RESTE : Marc doit
>   refaire « Nouvelle version » (web app figée pré-#119) pour le binaire svg ; plans NotebookLM
>   **P1** (session+fraîcheur+UI), **P2** (agenda/tâches-mails), **P3** (vitesse+réconciliation
>   Index↔Drive) validés, À EXÉCUTER. Chantier #28 = table de triage des 13 retours (BACKLOG).
>
> **2026-07-08 (matin) — GOUVERNANCE : analyse déléguée à NotebookLM (règle stricte, CLAUDE.md
> §4).** Marc a dicté (PR #111) : NotebookLM (qui lit le miroir Drive) = analyse architecturale &
> décision ; Claude = exécution. Pour toute nouvelle tâche de code : générer un prompt NotebookLM
> copiable, s'ARRÊTER, attendre le plan validé collé par Marc — voir CLAUDE.md §4 (⛔). S'ajoute :
> nouveau fichier créé ⇒ prévenir Marc d'ajouter la source NotebookLM (CLAUDE.md §3). Le triage
> factuel des 13 retours produit de Marc est au chantier #28 du BACKLOG.
>
> **2026-07-07 (nuit) — ADR-0017 : MIROIR DRIVE du dépôt (accès de partout + NotebookLM) — TERMINÉ.**
> Marc a d'abord demandé de remplacer GitHub par Drive comme dépôt — refusé et expliqué
> techniquement (Drive n'a pas de sémantique git, tout le CI/CD en dépend). Vrai besoin clarifié :
> accès de partout (déjà GitHub web/mobile) + une copie DANS Drive parce que **NotebookLM lit ses
> sources depuis Drive**. Livré : `src/Miroir.gs` écrit une copie `.txt` de TOUT le dépôt dans
> `_Miroir du dépôt` (Drive de Marc), via la web app déjà déployée (`doPost`, action
> `sync-miroir`) — **aucun nouveau scope OAuth**. Secret DÉDIÉ `DriveAI_SYNC_SECRET` (Property),
> JAMAIS le même que `DriveAI_WEBAPP_SECRET`. Workflow `.github/workflows/sync-drive.yml`
> dispatché par `auto-merge.yml` (comme `deploy.yml`). Mergé (PR #107), +12 tests (`miroir.test.js`).
> **Config Marc faite** (Property + 2 secrets GitHub + accès web app « Tout le monde »). Le PREMIER
> SYNC RÉEL a révélé 3 pièges invisibles hors prod, tous corrigés (PR #108, voir leçon
> `docs/LESSONS.md` 2026-07-07 « Miroir Drive : 2 pièges curl » + leçon durable `CLAUDE.md` §7) :
> 1. **405 systématique** — `curl -X POST -L` verrouillait POST sur la redirection 302 d'Apps
>    Script (`/exec` → `script.googleusercontent.com/macros/echo`, qui n'accepte que HEAD/GET).
>    Corrigé : retrait de `-X POST`.
> 2. **« Argument list too long »** sur les gros lots — payload passé en argument shell dépassait
>    `ARG_MAX`. Corrigé : payload écrit dans un fichier, `--data-binary @fichier`.
> 3. **Secret « refusé » persistant** malgré 2 vérifications de Marc — pas un problème de secret :
>    diagnostic temporaire (longueurs comparées, jamais le contenu) a révélé que la web app
>    `/exec` servait une version FIGÉE (piège déjà documenté `docs/DEPLOIEMENT.md`, confirmé
>    s'appliquer aussi à un déploiement `workflow_dispatch` sur une branche). Résolu par le
>    redéploiement manuel de Marc (Nouvelle version).
> **Validé en prod à 2 reprises** : sync complet (169 fichiers, 0 ignoré, 0 erreur) une fois sur la
> branche (code de diagnostic retiré avant merge), puis une seconde fois sur `main` après le merge
> #108 + le `clasp push` auto + le redéploiement manuel de Marc — confirmant que le pipeline
> complet (push → CI verte → auto-merge → dispatch `deploy.yml` → redéploiement manuel) fonctionne
> de bout en bout. Le miroir Drive (`_Miroir du dépôt`) est maintenant à jour et se resynchronisera
> à chaque merge sur `main`. Chantier #27 clos.
>
> **2026-07-07 (soir) — Chantier #26 : REFONTE de l'analyse documentaire (demande Marc « fiabilité
> maximale »).** Diagnostic prod accablant (65,6 % d'émetteurs « Inconnu », vols → Administratif,
> exports Facebook jusqu'en Immigration, 285 entités en vrac — Marc lui-même ×4, Ford Fiesta ×3).
> Conçu + validé par workflow (14/14 cas, revue adversariale 7 correctifs), PUIS **prouvé sur 38 vrais
> documents en 2 itérations** (artifact avant/après présenté à Marc, qui a validé). La v2 tient les 2
> exigences RELEVÉES de Marc : **0 « Inconnu »** (descripteur précis à la place) et **0 document à la
> racine d'un domaine** (tout en sous-dossier, entité unifiée d'abord — « l'IUT = 1 seul dossier » ;
> captures sans valeur → `_Médias`). LEÇON HONNÊTE de la preuve : **0/21 émetteurs réellement récupérés**
> — la plupart des « Inconnu » sont LÉGITIMES (CV/notes/devoirs perso sans émetteur) ; le vrai gain est
> la CORRECTNESS (bon domaine : 11 corrigés ; non-docs écartés ; identité par type ; entités fusionnées ;
> descripteurs parlants), pas le remplissage d'émetteur. **LIVRÉ + testé (fondations pures, interrupteur
> éteint, 337 tests, PR #92→102)** : `09 · Voyages` ; canonicalisation/fusion d'entités
> (`canoniserEntite_`, `estProprietaireMarc_`, `cleCanoniqueEntite_`, `estFusionnableEntite_` durci
> Ford≠Ford Fiesta) ; titulaire/identité + anti-écrasement ; descripteur (jamais Inconnu) +
> `sousDossierPourNom_` ; `decisionNonDocument_` (identité jamais média-isée, export jamais sous 04).
> **C26-05 + C26-06 CODÉS (2026-07-07 soir), DERRIÈRE LE FLAG `CONFIG.ANALYSE_V2` (= false)** — le
> flux vivant reste sur Haiku 1 passe tant que Marc n'a pas donné son FEU VERT. **C26-05** (`Llm.gs`) :
> prompts `PROMPT_PASSE1`/`PROMPT_PASSE2` (issus de la preuve validée), `classifierDeuxPasses_` +
> `appelAnthropicV2_` (Sonnet ×2, anti-régression passe2→passe1), parser étendu `normaliserChampsV2_`
> (réponse Haiku laissée INTACTE), texte OCR moins tronqué (`ANALYSE_V2_OCR_MAX_CARS` 12000). **C26-06**
> (`Router.gs`/`Pipeline.gs`) : `planRoutageV2_` (cœur PUR) + `deciderRoutageV2_` (I/O) — non-document
> écarté (jamais un domaine, jamais 04), identité par type, sous-dossier obligatoire (entité unifiée),
> nom via `nommerDocument_` (jamais « Inconnu »), anti-écrasement `garantirNomUnique_`. Gate au Pipeline
> `CONFIG.ANALYSE_V2 ? deciderRoutageV2_ : deciderRoutage_`. **Coût correctement compté Sonnet** (le frein
> §2.6 pausera la campagne). **MERGÉ PR #104** (revue flotte : sécurité 🟢, code/quotas OK). **DURCI
> ensuite (ADR-0015, PR suivante)** sur retours de revue, toujours flag ÉTEINT : (1) `parserClassification_`
> tolère `domaine:null` pour un NON-document v2 (sinon quarantaine à tort d'un export) ; (2) prompt v2
> clarifié (non-doc → `domaine` peut rester null) ; (3) garde-temps abaissé sous v2 `budgetMsRun_()`
> (`ANALYSE_V2_BUDGET_MS` 180 s, anti-mur 6 min + anti-2ᵉ-copie) ; (4) sous-dossier v2 assaini par
> `champ_`. **PRÉ-REQUIS d'allumage (ADR-0015)** : campagnes closes, plafond budget revu, surveillance
> runtime/coût, feu vert coût de Marc. +5 tests (parser non-doc, garde-temps), **359 verts. RESTE :
> C26-07** dry-run à grande échelle (obligatoire, protocole §2) ; **C26-08** campagne de re-analyse
> (budget/jour, déplacement seul, reprenable) ; **C26-09** app + §6 budget. ⚠️ **NE PAS allumer
> `ANALYSE_V2` ni lancer la campagne sans le feu vert coût de Marc** (~×10-20/doc ; campagne ~70-100 $).
>
> **✅ CONFLIT RÉSOLU → FAIL-SAFE HYBRIDE (2026-07-07, ADR-0016, décision Marc « hybride ultra-strict »).**
> Son « Protocole de précision » voulait rouvrir `00 · À vérifier` (contredisait §2.1). Réconcilié :
> un doc part en revue **UNIQUEMENT si l'analyse est TOUT-NULL** — `domaine` inconnu **ET** `emetteur`
> **ET** `type_doc` tous absents (`estClassificationVide_`, PURE). Un seul fait présent ⇒ classé au mieux.
> La conjonction **ET** = anti-saturation (leçon vécue). Livré ATOMIQUEMENT : ADR-0016 + CLAUDE.md §2.1
> révisé + §8 (protocole de précision) + code (`deciderRoutage_` live + `planRoutageV2_`, garde identité)
> + tests. **Preuve (protocole phase 1)** : `test/audit-logique.test.js` prouve **0/20 documents réels**
> déclenchés (anti-saturation), contre-épreuve OK. Faux-positifs historiques (CV/note/export) en
> non-régression. **370 tests verts.** PR **draft + `do-not-merge`** (révision de garde-fou → attend le
> feu vert explicite de Marc pour merger). Reste : consolidation docs (project-status.md/coding-standards.md)
> sur feu vert ; C26-07/08/09 (dry-run + campagne + app) inchangés.
>
> **2026-07-07 — Tri Gmail : recalibration du signal ⚠️ Suspect (demande Marc « trop de suspects »).**
> 14 fils marqués ⚠️, dont 13 FAUX POSITIFS (alertes Google/Anthropic, codes 2FA + réclamations
> Desjardins, le propre mail envoyé de Marc, sa famille). Cause : le prompt LLM assimilait
> « urgence/identifiants/paiement » à du phishing → tout mail transactionnel légitime flaggé. Refonte
> (workflow validé par 3 juges : 14 → ~1 faux positif, 8/8 phishing détectés) : prompt haute-barre
> (suspect exige un signal de TROMPERIE sur l'IDENTITÉ du domaine — sosie/typosquat, webmail posant en
> institution, arnaque manifeste — jamais le ton) + 2 gardes déterministes (G1 : le mail de Marc jamais
> suspect ; G2 : expéditeur déjà appris jamais requalifié par le LLM seul, sauf chemin dangereux promo).
> Signal DMARC ABANDONNÉ (la revue sécu a trouvé une injection de prompt possible). Le moteur ne retire
> jamais un libellé (garde-fou) → Marc décoche à la main les 14 existants (recherche `label:"⚠️ Suspect"`).
> 310 tests. **EN COURS (demande Marc, priorité)** : refonte MAJEURE de l'analyse documentaire (65 %
> d'émetteurs « Inconnu », mauvais domaines, entités en vrac — Marc lui-même ×4, génériques, doublons
> Ford Fiesta ×3). Décisions actées : Sonnet + 2 passes + texte complet ; re-analyser tout l'existant
> (~2400 docs, ~80-150 $) ; reconstruire entités (fusion variantes) + taxonomie (ajout domaine 09
> Voyages) ; documents d'identité groupés PAR TYPE (dossier « Passeport »/« Permis » contenant Marc ET
> les autres — PAS de dossier _Tiers). Workflow de conception en cours.
>
> Antérieur — **2026-07-07 — Correctif R3 : « la file 00·À trier ne se draine pas »
> (demande Marc).** Diagnostic par signaux indépendants (listing Drive + export xlsx de la Sheet) :
> un PDF déposé est resté 11 h (~130 ticks) — QUATRE causes cumulées : (1) famine d'équité (le
> rangement re-alimente la file, l'itérateur Drive sert les récents d'abord) ; (2) 32 quarantainés
> de la panne du 01-07 sautés en silence à vie ; (3) 2 Google Sheets natifs sans lecteur ; (4)
> **budget §2.6 CREVÉ (15,62 $ le 07-07)**. Livré (BACKLOG § Correctif R3, R3-01→05) : page
> d'intake = TRAITABLES seulement + FIFO ancien→récent (tri avant troncature) ; dé-quarantaine AUTO
> one-shot (`DEQUARANTAINE_TAG`, noyau `dequarantainerLignes_('drive|')` — jamais `dequarantaine()`
> depuis le tick : réentrance), ré-armée par un rétablissement de panne ; natifs Docs/Sheets/Slides
> classés (export texte REST, empreinte sur texte ENTIER, `ignorerDoublon` sous 20 cars ; échec
> d'export = échec compté ; type sans export = indexé `natif`) ; **frein budget campagnes**
> (`LLM_BUDGET_CAMPAGNES` : rangement/historique/migration en pause au-delà — le flux vivant dont
> la file de Marc CONTINUE ; **plafond relevé 10 → 30 $ le 07-07, décision Marc « je veux que tu
> continues le tri au complet » → le rattrapage reprend et finit ce mois-ci ; cible croisière
> < 10 $ maintenue, §2.6 révisé**). Revue flotte 4 agents :
> 3 bloquants réels corrigés (306 tests). À VÉRIFIER post-déploiement par signaux Drive : PDF
> `1-ePHLXUsVVhiT9fEX7thR5P5Bs1YmkDD` classé, 32 quarantainés relancés, 2 Sheets natifs classés.
> Info : racine sup `1W3b0…` (RANGEMENT_RACINES_SUP) inaccessible. Rappel Marc encore ouvert :
> lancer `rattraperMediasMalClasses()` si pas fait.
>
> Antérieur — **2026-07-06 (soir)** — **C16 LIVRÉ : tri Gmail natif (ADR-0012), scope
> `gmail.modify`.** PR #66 (2 rondes adversariales, 4 lentilles) : `TriGmail.gs` — libellés existants
> + archivage réversible au fil de l'eau, idempotence par ÉTAT (`tri|fil|ts|lu/nonlu` : un mail lu
> APRÈS son tri est re-trié donc archivé), rattrapage du stock 30 j par ancre FIXE + offset (ensemble
> figé), phishing → `⚠️ Suspect` (reste en boîte), promos non lues archivées sur signaux DÉTERMINISTES
> (List-Unsubscribe ET catégorie Gmail), table `TriAppris` (apprentissage restreint anti-empoisonnement),
> panne d'écriture SYSTÉMIQUE, verrou CI durci (corbeille/Spam/suppression/retrait de libellés interdits,
> service avancé + REST Gmail bannis, tripwire scope↔CLAUDE.md). Constitution §2.3 mise à jour (la
> lecture seule est levée, décision Marc). **Après le merge : ré-autorisation manuelle par Marc
> (tickDriveAI) obligatoire — tous les déclencheurs sont gelés d'ici là** ; puis vérifier la reprise
> par signaux Drive et les premiers libellés ; ensuite Marc supprime sa tâche Cowork. Suivi prod (vérifié par Journal exporté, 13h ET) :
> ✅ **Crédit API rétabli et VÉRIFIÉ de bout en bout le 6/7 13:35 ET** (sonde : fichier test déposé
> dans 00·À trier → classé au 1ᵉʳ tick « 2026-07-06_Attestation_DriveAI.txt → 08·Perso », coût 7,33→7,34 $).
> Découverte : **90 documents quarantainés à tort** pendant la panne du 2/7 (dont ~68 médias Messenger
> coincés dans 00·À trier → file ≥ 40 → rangement AFFAMÉ depuis le 2/7) — `dequarantaine()` est LE geste
> qui débloque : médias → _Médias (sans LLM), file < 40, le rangement (804 restants) reprend. Historique
> de l'épisode : la recharge n'avait pas pris effet avant ~13h le 6/7 — — 291 « PANNE DE COMPTE (400 credit balance) »
> depuis le 5/7 00:00, zéro « RÉTABLI » ; Marc doit vérifier console.anthropic.com → Billing (bon
> workspace ? paiement passé ? crédits API ≠ abonnement Claude). Conséquence : quota Gmail du jour
> re-épuisé à 07:25 par les runs stériles du matin (code pré-R2 encore déployé à ce moment-là) ;
> reset ~03h ET. Le tri #16 est correctement différé (« Tri Gmail différé », l'intake n'est pas bloqué)
> et ne montrera ses premiers libellés qu'après quota + crédit rétablis. `dequarantaine()` et Script
> Property `DriveAI_EMAIL` toujours à poser côté Marc (131 alertes perdues + résumé hebdo perdu le 6/7). Chantiers suivants
> actés : #18 (entités auto-validées à 3 occurrences) puis #17 (confiance visible dans l'app).
>
> **Suite 2026-07-06 (fin de journée)** : `dequarantaine()` + `DriveAI_EMAIL` posés par Marc → drainage
> VÉRIFIÉ en direct (68→47 fichiers en 10 min, reçus KIA photographiés OCR+classés) ; rangement reprend
> dès que la file < 40. Tri Gmail : démarre seul au reset de quota (~03h ET). **Chantier #19 lancé —
> App v3** (refonte complète, cadrage 4 réponses de Marc) : maquette « trois directions » livrée
> (artifact), attente du choix A/B/C. Voir BACKLOG #19.
>
> **2026-07-06 (nuit) — CHANTIER #19 LIVRÉ : App v3 « Salle des machines » complète** (PR #73→#78,
> une PR par étape, app utilisable à chaque merge) : socle tokens sombre/clair + 6 sections + mobile ;
> Aujourd'hui (tuiles, suspects/tris cliquables → Gmail) ; Agenda (grille mois réelle, tâches Google
> cochables, création directe — scopes APP tasks+calendar.events, consentement navigateur au prochain
> login) ; Mails (tri #16 visible, TriAppris corrigeable par vidage de cellules) ; Documents +
> **confiance #17** (colonne H Index côté moteur, badge + filtre côté app, verrou vie-privée à
> 8 colonnes) ; Santé (quota Gmail dérivé du Journal, quarantaine+relance). Verrou app durci :
> jamais DELETE, jamais status:cancelled, jamais /clear. Chantier #18 (entités auto à 3) = prochain.
>
> **2026-07-06 (fin de soirée) — #20 livré** : incident « BACAR » corrigé (garde de confiance photo
> + `rattraperMediasMalClasses()` à lancer par Marc), retry 429, cache lecture 60 s, tooltip graphe,
> bouton « Vérifier maintenant » (web app à déployer — DEPLOIEMENT.md). Nouvelles demandes Marc à
> cadrer : #21 explorateur Drive + réorg IA (⚠ suppression de dossiers ↔ §2), #22 fréquences
> configurables, #23 peaufinage UI (Agenda façon Google Calendar). Questions posées.
>
> **Cadrage acté (réponses Marc, fin de session 06-07)** : #21 réorg IA = proposition → validation →
> déplacements seuls + corbeille des dossiers VIDES validée (révision étroite §2, ADR-0014 à écrire) ;
> #22 = un réglage global du tick via l'app/Sheet ; #23 = Agenda façon GCal + plus aéré + transitions.
> Ordre conseillé : #23 → #22 → #21 → #18. Rappels Marc : lancer `rattraperMediasMalClasses` +
> déployer la web app (DEPLOIEMENT.md) ; tri Gmail démarre seul ~03h.
>
> **#23 livré** (PR #81 : Agenda façon GCal, interface aérée, transitions). **#22 livré** : carte
> « Réglages » dans Santé (select 5/10/15/30 min) → `Réglages!A2:B2` de la Sheet (onglet seedé par
> le moteur) → `assurerIntervalleTick_` applique au tick suivant via `intervalleTickVoulu_()` +
> whitelist `validerTickMinutes_` (jamais < 5 min, invalide → CONFIG). Restent : #21 (ADR-0014 +
> constitution même commit + revue flotte) puis #18.
>
> **Chantier #21 lancé** — plan product-manager en 7 PR consigné au BACKLOG (état dans un onglet
> `Réorg`, corbeille des dossiers vides côté APP au clic validé, réorg de masse côté moteur).
> **C21-01 livré** : explorateur Drive lecture seule (sous-onglets Documents = Drive | Recherche
> DriveAI, fil d'Ariane, recherche nom+plein texte, portée « dans ce dossier » bornée et honnête).
> Revue flotte passée (sécurité + code, correctifs intégrés). **C21-02 livré** : création rapide
> de dossiers + déplacement manuel de fichiers (drag souris + mode « Déplacer → Déposer ici »),
> verdict `deplacementSeul` (nom conservé, zone protégée inconditionnelle), parades intake
> (ligne Index statut `manuel`, refus de redépôt dans 00·À trier, pas de dossier dans 00·À trier).
> Revue flotte 4 agents, correctifs intégrés. **C21-03 livré** : recherche IA (Documents →
> Recherche DriveAI → « ✨ ») — question libre → doPost (`action=recherche-ia`, POST text/plain
> lisible = CORS levé) → Haiku → plan whitelisté → filtres + plein texte. Bornes : 5 s, 50 appels
> servis/jour (~3 $/mois max), panne API sans consommer le plafond. ⚠ Marc : REDÉPLOYER la web
> app en nouvelle version (DEPLOIEMENT.md) pour activer la recherche IA. **C21-04 livré** :
> `Reorg.gs` (phase PROPOSITION — inventaire BFS borné zone-protégée-exclue-par-ancêtres,
> UN appel Haiku, plan whitelisté racines-intouchables, onglet `Réorg`, essais rendus sur
> budget/panne, 5 analyses/jour max). Revue flotte 4 agents, 3 bloquants corrigés. Prochain :
> **C21-05 livré** : vue « ✨ Réorg IA » (Documents) — demande d'analyse (aussi depuis
> l'Explorateur, portée dossier), plan avant/après, Valider/Écarter ligne/masse (plages
> contiguës), historique. **C21-06 livré** : le moteur APPLIQUE les actions validées
> (deplacer/fusionner/creer/renommer de dossiers — jamais de suppression), re-vérif zone
> protégée par mutation (identité + ascendance), fusion collecte-puis-mutation reprenable,
> re-pointage Entités avant le « fini », vide-candidat inscrit. **C21-07 livré (CHANTIER #21
> COMPLET)** : ADR-0014 + CLAUDE.md §2 révisé + corbeille.ts + tripwire bidirectionnel + verrou
> de surface DRIVE ajouté au moteur, en UN commit — revue flotte bloquante passée (2 trous réels
> fermés : promesse de verrou moteur non codée ; dossiers à ID fixe corbeillables). L'app offre
> désormais : explorateur façon Drive (naviguer/chercher/IA/créer/glisser-déposer), réorg IA
> (analyser → valider → le moteur applique → corbeille des vides au clic). ⚠ Marc : redéployer
> la web app en nouvelle version (recherche IA) — DEPLOIEMENT.md. **#18 livré** : entités
> en_attente vues ≥ 3 fois auto-validées au tick (dossier créé au même run), jamais en zone
> protégée, jamais contre une réédition de Marc (garde dossierId) ; annulation = Statut →
> « refusée » ; signalées au résumé hebdo. LE PLAN ACTÉ (#23 → #22 → #21 → #18) EST COMPLET.
>
> Antérieur — **2026-07-01 (soir)** : **BRAINSTORM PRODUIT COMPLET → dossier de conception (8 ADR).**
> Session de conception « niveau pro » avec Marc : **8 ADR** (`docs/adr/0001`→`0008`), **roadmap priorisée à
> 9 chantiers** (`docs/ROADMAP.md`), runbook (`docs/RUNBOOK.md`) et guide (`docs/GUIDE.md`). Socle #1 =
> **fondation testable** (logique pure isolée des appels Google + filet de tests CI + Journal borné/onglet
> `Santé`, ADR-0006). Décisions clés : sources = **fichiers partagés** (0005) ; vie privée = **métadonnées
> seulement dans l'état** — *vérifié sur le code*, aucun corps de doc stocké (0007) ; app web Phase 4 =
> recherche/dashboard/corrections, login Google, plein texte via l'index natif Drive (0008). **Prochain pas
> concret : implémenter le chantier #1** (fondation testable). ⚠️ Rien de tout ça n'est encore CODÉ — les ADR
> décrivent la CIBLE. **Le grand rangement de l'ancien Drive tourne toujours en fond** (vivant, vérifié par
> signaux Drive : fichiers renommés/déplacés en continu). Antérieur ce jour : **PLUS DE FILE DE REVUE : un
> seul dossier d'arrivée + nom final
> direct** (P1-16, décision Marc « je veux juste un dossier ; le nom attribué doit être direct le dernier » :
> `00 · À vérifier` supprimé du pipeline, TOUT classé au mieux avec nom propre, domaine introuvable →
> `DOMAINE_DEFAUT` ; barre fiabilisée via recensement léger + « recensement en cours » visible dès le 1ᵉʳ tick ;
> `VERSION` P3.0). Marc peut supprimer à la main le dossier vide `00 · À vérifier`. Antérieur : P1-14 (sensibles
> auto-classés), P1-15 (rangement TÔT gated file-basse + barre `[███░░░] N %`, `RANGEMENT_TAG` r1→r2), Phase 2 +
> full auto en prod, Phase 3 codée. Les **2 secrets GitHub sont posés** — rien côté secrets. **Reste côté Marc
> pour Phase 3 : une ré-autorisation Google unique** (scopes Tasks/Calendar) au prochain déploiement.
>
> 🔴 **P1-17 (fix majeur, diagnostic prod)** : « le moteur ne range plus rien / est muet » n'était PAS le
> déclencheur (il tournait, mais à vide). VRAIE cause : la collecte du rangement (`aParentProtege_`→`getParents()`)
> LEVAIT une exception sur « Ancienne structure » (racine `0AKPYZ…`, Drive partagé) → 0 fichier collecté → le
> code prenait `collectes===0` pour « TERMINÉ » et FIGEAIT le rangement (`DriveAI_RANGEMENT` posé) → tous les
> ticks suivants sautaient le rangement. Fix : walk parent-protégé défensif (détection positive, jamais
> d'exception propagée), collecte par-fichier enveloppée, une collecte en erreur ⇒ `reste=true` (jamais un
> faux « terminé »), `RANGEMENT_TAG` r2→r3 (relance). **Après déploiement P1-17 : faire tourner 1 tick** (auto
> ~10 min, ou `tickDriveAI` à la main pour l'immédiat) puis vérifier par signaux Drive que « Ancienne structure »
> se vide et que les domaines se remplissent de `AAAA-MM-JJ_`. NB : le déclencheur EST sain (il firait à vide
> car le rangement était figé « terminé ») — pas besoin de re-`installerTrigger`.

---

## 1. TL;DR (où on en est)

- **Phase 0** (scaffolding & automatisation) : ✅ mergée.
- **Phase 1** (le cœur : Gmail → analyse → classement) : ✅ codée, revue par la flotte, mergée sur `main`.
- **Automatisation live** : CI + auto-merge (PR `claude/**` verte → squash auto), `CLAUDE.md`
  auto-évolutif, 8 agents, boucle de leçons.
- **DriveAI tourne** : déployé dans Apps Script chez Marc, validé end-to-end le 2026-06-23
  (~25 docs traités : Gmail → OCR → LLM → routage → Index/Revue ; idempotence/nommage confirmés).
- **Recalibrage appliqué** : le 1er run marquait presque tout `sensible` → tout en revue. Le
  prompt vise désormais la zone protégée stricte (immigration + fiscal) ; le reste s'auto-classe.
- **Phase 2 codée** : seconde source d'intake (`00·À trier`, fichiers **déplacés** jamais copiés),
  routage à l'**entité** via le référentiel `Entités` (colonnes + `Statut` auto-réparées), entité
  inconnue → ligne `en_attente` pré-remplie + revue, création des dossiers d'entité + sous-dossiers
  fixes après validation (Statut = « validée »), multi-entités en raccourcis Drive, doublons signalés
  (empreinte MD5). Modules ajoutés : `Entites.gs`, `Intake.gs`, `Pipeline.gs`, `DriveRest.gs`.
- **Full auto (P2.2)** : Action GitHub **Deploy** (`clasp push` auto sur merge `main`, via secrets
  `CLASPRC_JSON`/`SCRIPT_ID`) + **auto-rejeu** sur bump de `CONFIG.VERSION` (renvoie les dépôts en
  revue vers `00·À trier`, borné/réversible). Après le réglage unique des 2 secrets, Marc ne fait plus
  ni `clasp push` ni `rejouerLaRevue`. **Validé en réel le 2026-06-26** (auto-déploiement + auto-rejeu
  ont reclassé 5 dépôts sans intervention).
- **P2.3** : `SEUIL_CONFIANCE` abaissé **0.80 → 0.50** (sur demande de Marc) ; l'auto-rejeu reprend
  désormais aussi les `[REVUE] confiance …` (2e passe, déplacement seul). La zone protégée
  (`[REVUE] sensible`) n'est **jamais** reprise (garde-fou §1) : passeports/immigration/fiscal restent
  en revue par conception.
- **P2.5 (escalade)** : la confiance basse n'envoie plus en revue — elle déclenche une **analyse
  approfondie** (Sonnet ×3, consensus de domaine) puis le doc est **classé au meilleur endroit**.
  Seuls restent en revue : zone protégée + domaine introuvable. Coût borné (plafond d'escalades/run,
  fallback simple sur échec Haiku, docs sensibles non escaladés). Revue flotte 🟢 (sécurité + coût).
- **fix CI/CD** : l'auto-déploiement était muet (merge bot ne déclenche pas `on: push` ; clasp casse en
  Node 22). Réparé : auto-merge **dispatche** Deploy ; Node 20. **Vérifier les runs de l'Action Deploy.**
- **P2.6 (grand rangement auto)** : sur demande de Marc (« tout mon Drive reclassé/renommé/au bon
  endroit »), un rangement initial **zéro clic** gated par `CONFIG.RANGEMENT_TAG` renvoie au fil des ticks
  tout le contenu « en vrac » (nom non `AAAA-MM-JJ_`) des domaines NON protégés vers `00·À trier` ; le
  pipeline le reprend (OCR → analyse approfondie → renommage → classement, sous-dossiers créés au besoin).
  Borné (`RANGEMENT_MAX_PAR_RUN` + garde-temps), reprenable (tag figé seulement quand une passe ne collecte
  plus rien), **déplacement seul** (aucune corbeille), et **zone protégée écartée** même pour un fichier
  multi-parents (garde un parent dans `04 · Immigration` ⇒ jamais détaché). Re-audité flotte 🟢 (sécurité
  BLOQUANT levé + garde-temps). `_Archive 2025` non concernée. Lançable aussi à la main (`rangerToutLeDrive`).
- **P2.7 (ancien Drive + garde-fou OCR vide)** : Marc a désigné son vrai « ancien Drive » — le dossier
  racine **« Ancienne structure »** (pas `_Archive 2025`, qui n'existe pas chez lui). Branché sur le
  grand rangement via `CONFIG.RANGEMENT_RACINES_SUP` (tag `r2`). Un audit sécurité a détecté un trou
  réel : un vieux scan à nom neutre (`IMG_2734.jpg`) dont l'OCR échoue pouvait recevoir `sensible=false`
  sans aucun signal et être classé auto — violation potentielle du garde-fou §1 sur un passeport/doc
  fiscal. Corrigé : tout DÉPÔT (manuel ou rangement — jamais une PJ Gmail, qui garde expéditeur/sujet)
  dont l'extrait OCR fait moins de `CONFIG.OCR_MIN_CARS_EXPLOITABLE` (20) caractères part en revue
  (« sensibilité indéterminable (OCR vide) »), priorité la plus haute dans `motifDeRevue_`. Re-audité
  flotte 🟢 (security-auditor CONFORME, file-checker : pas de sur-blocage, seuil raisonnable).
- **Secrets déploiement déjà posés.** Les 2 secrets GitHub (`CLASPRC_JSON`, `SCRIPT_ID`) sont **déjà
  configurés** côté Marc — confirmé par des runs `Deploy` réels (`clasp push` réussi, code visible en
  prod). Le tableau « reste à faire » ci-dessous est mis à jour en conséquence : **rien côté secrets**.
- **fix-pipeline (file `00·À trier` gelée)** : `appliquerRangementInitial_` tournait AVANT l'intake et
  SANS try/catch → un plantage de sa collecte gelait tout le tick (Gmail + dépôts + intentions sautés) →
  ~20 fichiers stagnaient des heures dans `00·À trier`. Corrigé : maintenance auto (rejeu, rangement)
  **enveloppée de try/catch**, et on **DRAINE (Gmail+dépôts) AVANT d'ALIMENTER** (rangement passe après,
  si budget). Vérifié en prod par recherche Drive : la file s'est vidée après déploiement.
- **P1-13 (lecture des fichiers Office)** : diagnostic prod (recherche Drive) — les `.docx`/`.ppt` de Marc
  (CV, TP, présentations) partaient TOUS en revue « sensibilité indéterminable (OCR vide) » car `Ocr.gs` ne
  lisait que text/PDF/images ; un `.docx` → texte vide → garde-fou OCR-vide → revue. Corrigé : `extraireTexte_`
  convertit désormais Word/PowerPoint/Excel en Google natif (Docs/Slides/Sheets, conversion sans OCR) → vrai
  texte → classés correctement. `VERSION` bumpée **P2.5 → P2.8** ⇒ re-tri auto de la revue existante (Office
  classés, vieux `[REVUE] doublon` → `_Doublons`, sensibles re-détectés → revue). Re-audité flotte 🟢.
- **Décision en attente (Marc, 2026-07-01) :** auto-classer AUSSI les docs **sensibles** (immigration/fiscal)
  ? Marc l'a demandé, mais l'essentiel de sa frustration (CV/TP) venait du bug Office, pas du garde-fou §1.
  Recommandation faite : garder le filet §1 sur immigration/fiscal uniquement. **En attente de sa confirmation**
  avant de toucher au garde-fou NON NÉGOCIABLE §1.
- **Phase 3 codée** (remplace l'agent mail externe de Marc). Scan de **tous** les mails récents
  (pas seulement avec PJ, `GMAIL_REQUETE_ACTIONS`) → pré-filtre 3 étages (mots-clés gratuit → zone
  protégée gratuit, défense en profondeur indépendante du LLM → mini-check Haiku ~10 tokens) →
  extraction d'intentions LLM (`PROMPT_INTENTIONS`) → routage **échéance → Google Tasks**, **rdv
  daté → Google Calendar**, création **100 % auto** (zéro validation), liste Tasks par défaut +
  agenda principal. Nouveaux fichiers : `GoogleApi.gs`, `Tasks.gs`, `Calendar.gs`, `Prefiltre.gs`,
  `Intentions.gs`. Idempotence à 2 niveaux (message + intention) ; ID client Calendar déterministe
  par `(messageId, contenu)` (rejeu après coupure → 409 = succès, jamais de doublon) ; risque
  résiduel documenté sur les tâches (Tasks API sans ID client, même compromis que la copie Gmail).
  **Re-audité par la flotte (4 spécialistes, 2 passes)** : sécurité 🟢, coût LLM 🟢 (~1-4 $/mois
  estimé), idempotence 🟢, quotas — 1er passage **BLOQUANT** (pagination par offset numérique
  stagnait au-delà de ~200 messages sur une fenêtre Gmail mouvante : un nouveau mail en tête décale
  tous les offsets, donc redémarrer à 0 chaque tick ne progressait jamais dans l'historique), corrigé
  par un scan à deux voies (avant : offset 0, capte le mail neuf ; arrière : date absolue persistée,
  insensible aux décalages d'offset), 2e passage 🟢 CONFORME. **Seule action manuelle de Marc à
  venir : une ré-autorisation Google unique** (nouvel écran de consentement après l'ajout des scopes
  Tasks/Calendar) — cf. `docs/DEPLOIEMENT.md` § Phase 3.

## 2. Avancement par phase

| Phase | Périmètre | État |
|-------|-----------|------|
| 0 | Scaffolding & automatisation | ✅ mergée (PR #1) |
| 1 | Moteur Apps Script (Gmail, OCR, LLM, routage domaine/catégorie, revue) | ✅ mergée (PR #2) |
| 2 | Dépôt manuel `00 · À trier` + référentiel d'entités + dossiers granulaires | 🟦 codée (revue flotte), à déployer |
| 3 | Tâches & agenda (Tasks/Calendar, remplace l'agent mail externe de Marc) | 🟦 codée (revue flotte 🟢), à déployer |
| 4 | Recherche + dashboard (app web Vercel) | ⬜ à faire |

Détail des tâches : `BACKLOG.md`.

## 3. Décisions actées (ne pas re-litiger)

- **Legacy révisé (2026-06-30)** : la décision initiale « Option A » supposait un dossier `_Archive 2025`
  qui n'existe pas chez Marc — son ancien Drive est en fait la racine **« Ancienne structure »**. Sur
  demande explicite de Marc (« classe tout mon ancien drive »), elle est désormais INCLUSE dans le grand
  rangement auto (`CONFIG.RANGEMENT_RACINES_SUP`), avec le garde-fou OCR-vide renforcé (cf. P2.7 ci-dessus).
- **Gmail lecture seule** → idempotence portée par l'`Index` (clé `messageId|i|nom|taille`), **pas** de label Gmail.
- **Merge** : auto-merge des PR `claude/**` dès que la CI est verte (pas de revue humaine bloquante).
- **Modèles LLM** : Haiku par défaut (`claude-haiku-4-5`), Sonnet en fallback (`claude-sonnet-4-6`).
- **Scopes** : `gmail.readonly`, `drive`, `script.external_request`, `spreadsheets`,
  `script.send_mail` (notif), `script.scriptapp` (trigger), + Phase 3 : `tasks`, `calendar.events`
  (création uniquement, jamais lecture/modification/suppression). Cf. `docs/ARCHITECTURE.md`.

## 4. Ce qui reste à faire côté Marc

> Objectif **full auto**. Les secrets de déploiement sont posés — il ne reste qu'une ré-autorisation
> à venir (Phase 3) et deux rappels de fond.

1. **Phase 3 (à venir, une fois)** : l'ajout des scopes Google Tasks/Calendar va déclencher un **nouvel
   écran de consentement Google** au prochain déploiement. Une seule ré-autorisation (un clic) sera
   nécessaire — DriveAI ne peut pas le faire à sa place (frontière d'exécution). Sera annoncé clairement
   le moment venu, avec une fonction « un clic » dédiée si possible.
2. 🔑 **Révoquer l'ancienne clé Anthropic** partagée dans le chat (compromise), si pas déjà fait.
3. *(`P1-09` — fait)* le coût LLM réel est désormais **mesuré** (`Cout.gs`, tokens `usage` agrégés
   par mois) et **affiché chaque semaine** dans le résumé hebdo automatique (`Resume.gs`). Plus besoin
   d'estimer : à observer sur le 1er mois réel pour confirmer < 10 $/mois.

### Améliorations en cours (demandées par Marc le 2026-06-30, après la mise en prod de Phase 3)
Marc a demandé 4 chantiers d'amélioration ; ordre de livraison :
1. **Visibilité + coût réel** (`P1-09`/`P1-10`) — ✅ codé, revue flotte 🟢 (quotas + code-reviewer) :
   `Cout.gs` (mesure des tokens) + `Resume.gs` (résumé hebdo auto par mail, déclencheur auto-installé
   `assurerTriggerResume_`, aucun nouveau scope).
2. **Quarantaine après N échecs** — ✅ codé (`Journal.gs` onglet `Échecs` + compteur cross-tick,
   `Pipeline.gs` `gererEchec_`, `CONFIG.QUARANTAINE_MAX=3`). Un doc en échec persistant est compté ;
   après 3 essais → Index `quarantaine` (plus jamais re-OCRisé) + 1 alerte. Échecs intermédiaires :
   `journalErreur_` sans mail (anti-spam, au lieu d'un mail par tick). Compté aussi dans le résumé hebdo.
   Récupération après panne transitoire : `dequarantaine()` (Maintenance.gs, un clic) re-traite les
   docs quarantinés à tort. Revue flotte 🟢 (file-checker idempotence + apps-script-quota I/O, CONFORME).
3. **Filtre d'utilité des PJ** — ⬜ à faire (écarter signatures/logos/pubs avant OCR/LLM).
4. **Classement plus fin** — ⬜ à faire (enrichir catégories/sous-dossiers + entités ; prudent, dégrader
   jamais bloquer).

### Correctifs prod du 2026-07-01 (session marathon, après mise en prod Phase 3)
- **Pipeline gelé (hotfix, #24)** : `appliquerRangementInitial_` tournait avant l'intake et sans try/catch
  → une erreur de collecte gelait tout le tick (file `00·À trier` figée des heures). Corrigé : drainer avant
  d'alimenter + maintenance auto enveloppée. Diagnostiqué par le CODE + signaux Drive (cache Sheet figé).
- **Lecture Office (P1-13, #25)** : les `.docx/.ppt` partaient tous en revue « OCR vide » (extracteur limité
  aux PDF/images) → conversion Google native ajoutée → CV/TP/présentations classés. Bump VERSION = re-tri auto.
- **Sensibles auto-classés (P1-14)** : *décision Marc* — `sensible`/zone protégée ne routent plus en revue
  (classés dans leur domaine ; doublon sensible → `_Doublons`, 1 exemplaire gardé). `CLAUDE.md` §1 réécrit.
  Garde-fous conservés : aucune suppression, non-détachement de 04. Seul `domaine inconnu` reste en revue.
- **Vérif prod** : le cache de lecture de la Sheet est resté figé toute la session → tout vérifié par
  **recherche Drive directe** (contenu des dossiers par `parentId`, `modifiedTime`). Résultat confirmé :
  CV → 05·Carrière, doublons → `_Doublons`, revue vidée du faux sensible.

### Hotfix « pipeline gelé » (2026-07-01, découvert en regardant le ménage en prod)
La file `00·À trier` stagnait : ~20 vieux fichiers déplacés par le grand rangement y sont restés des heures
sans être classés, et plus rien n'était traité (le moteur écrivait pourtant son état chaque tick). Cause :
dans `tickDriveAI`, `appliquerRangementInitial_` tournait AVANT l'intake **et** n'était pas enveloppé de
try/catch — le `try` de `tickDriveAI` n'a qu'un `finally`, donc une exception dans la collecte (walk de
l'ancien Drive) **tuait tout le tick avant Gmail/dépôts/intentions**, à chaque tick. Correctif : (1) rejeu +
rangement + `creerDossiersEntitesValidees_` enveloppés de try/catch (une erreur ne peut plus geler l'intake) ;
(2) rangement déplacé APRÈS l'intake, `if (!estBudgetDepasse())` → **drainer avant d'alimenter** ; (3) scan
Gmail durci par fil. Revue flotte 🟢 (apps-script-quota + code-reviewer). Diagnostic fait **par lecture du code
+ recherche Drive directe** (le cache de lecture de la Sheet étant figé toute la session). Leçon consignée.

### Doublons → `_Doublons` (P1-12, décidé par Marc le 2026-06-30 en regardant la prod)
La vérif prod (via recherche Drive directe, le cache de lecture Sheet étant figé) a montré que le grand
rangement **marche** (vieux fichiers déplacés vers `00·À trier`, docs renommés+classés) MAIS que la file
de revue se **saturait de `[REVUE] doublon`** (ancien Drive plein de copies : relevés Robovic, docs scolaires
2018). Sur choix de Marc (option « dossier _Doublons + log »), les doublons NON sensibles vont maintenant
dans `_Doublons` (déplacement seul, jamais supprimé) au lieu de la revue ; un doublon **sensible** reste en
revue (§1 prioritaire dans `Router.deciderRoutage_`). `nettoyerDoublonsRevue()` (un clic) balaie les doublons
déjà accumulés en revue. ✅ codé, revue flotte (sécurité + file-checker + structure-keeper).

> Steady-state désormais **100 % automatique** : nouveaux mails + dépôts traités par le trigger 10 min ;
> mes changements de code déployés par l'Action ; reclassement après recalibrage par l'auto-rejeu.
> Le `rejouerLaRevue` manuel reste dispo (c'est le seul endroit qui met des copies Gmail à la corbeille).

## 5. Blocages / risques connus

- **Commits « Unverified »** sur GitHub : la clé de signature de l'environnement Claude est vide
  (0 octet) → signature impossible. Cosmétique, sans impact.
- **Ruleset `claude/**`** : la règle « Require status checks » bloquait le *push initial*
  (œuf-poule), retirée par Marc. Le check CI s'appelle **« Validation du scaffolding »** (pas `ci`).
- **Phase 1, limites assumées** : volume très élevé (> ~une page de fils / 15 min) traité sur
  plusieurs ticks ; une classification en échec persistant est re-notifiée et n'est déposée nulle
  part (re-tentée tant que le mail est dans la fenêtre 30 j). À revisiter si gênant.
- **Cadence 10 min & quota (audit)** : les comptes Gmail grand public ont ~90 min/jour de temps de
  déclencheur. À 10 min (144 ticks/j), la plupart sont des no-op, mais ~20 runs « pleins » (jusqu'au
  garde-temps `BUDGET_MS` 4.5 min) suffiraient à l'épuiser. Volume perso de Marc → marge large. Si une
  journée chargée coupe les triggers, revenir à `TICK_MINUTES: 15` ou baisser `BUDGET_MS` (reprise au
  tick suivant déjà en place). Le déclencheur se ré-installe seul au déploiement (création avant purge).
- **Phase 2, limites assumées** (relevées par la flotte, non bloquantes) : (a) un document en échec
  LLM/placement persistant est re-OCRisé + re-classé à **chaque** tick (pas de quarantaine après N
  échecs → coût) ; (b) la **copie Gmail** et les **raccourcis multi-entités** ne sont pas idempotents
  au rejeu (un rejeu après coupure entre placement et Index peut dupliquer le fichier/raccourci — c'est
  le compromis « Index en dernier ») ; (c) la **file de revue = le dossier** `00·À vérifier` : un dépôt
  routé en revue est bien dans le dossier même si une coupure empêche la ligne `Revue`/`Index`.

## 6. Comment reprendre

- `/phase 2` — démarrer la phase suivante avec discipline de scope.
- `/review` — passer un diff à la flotte d'agents.
- `/lesson "…"` — consigner une leçon.
- `/handover` — régénérer ce fichier à partir de l'état courant.
- `/ship` — commit + push + PR draft.

## 7. Historique des sessions

- **2026-07-06 — Chantier #16 CODÉ : tri Gmail natif (ADR-0012) — EN ATTENTE DU GO TEMPS-RÉEL DE MARC.**
  `TriGmail.gs` : décision PURE (suspect prime/jamais archivé ; doute → `À vérifier` ; lu → archivé ;
  promo DÉTERMINISTE (List-Unsubscribe) non-lue → archivée sauf zone protégée ; `⏰` jamais archivé),
  heuristiques phishing étroites + signal LLM, table `TriAppris` adresse→libellé (jamais le nom
  affiché), mini-appel catégorie par FIL validé contre les libellés EXISTANTS (jamais de création),
  30 fils/run, idempotence `tri|<fil>|<ts>` sans charger les messages, tri APRÈS les intentions
  (attend l'analyse du dernier message). `⏰` posé par `marquerMailImportant_`. Résumé hebdo :
  « ⚠️ Suspects » EN TÊTE, compteur triés, « 🗞️ newsletters jamais ouvertes ». VERROU CI :
  `test/surface-gmail-ecriture.test.js` (corbeille/Spam/suppression/création de libellés interdits
  dans src/ + manifeste jamais > gmail.modify). App : clés `tri|` exclues. **Moteur 223 tests.**
  ⚠️ SÉQUENCE DE MERGE : PR avec label `do-not-merge` (code + scope `gmail.modify` + constitution) —
  ne merger que sur GO temps-réel de Marc (gel des déclencheurs → il ré-autorise dans la foulée),
  puis vérifier le run Deploy réel + la reprise par signaux Drive + les premiers libellés posés.

- **2026-07-06 — Chantier #16 DÉCIDÉ (ADR-0012) : tri Gmail natif, remplace la tâche Cowork de Marc.**
  Marc a répondu explicitement (AskUserQuestion) : ÉCRITURE Gmail oui (libellés + archivage —
  levée du garde-fou §3, scope `gmail.modify`, jamais de suppression), tri AU FIL DE L'EAU,
  SOUS-LIBELLÉS existants (~60 libellés hérités du Cowork, vérifiés via MCP), extras hebdo =
  phishing en tête + newsletters jamais lues (écartés : docs manquants, registre montants).
  Défaut posé à valider : zone protégée = libellés oui, archivage non. ⚠️ À l'implémentation,
  séquencer le merge du scope avec Marc (gel des déclencheurs jusqu'à ré-autorisation). Une fois
  livré/vérifié, Marc supprime sa tâche Cowork. Rien codé — backlog C16-01→06 ⬜.

- **2026-07-06 (même session) — CALIBRAGE global (2 salves de questions à Marc) + audit ADR-0012 intégré.**
  Audit sécurité de l'ADR-0012 (7 corrections intégrées : motifs anti-corbeille/Spam complets en check CI
  REQUIS, label `do-not-merge` obligatoire sur toute PR touchant `appsscript.json` — l'auto-merge aurait
  gelé le moteur sans Marc —, archivage non-lu sur signaux DÉTERMINISTES seulement — un phishing rédigé en
  newsletter ne peut pas se masquer —, `gmail.modify` confirmé scope minimal, ARCHITECTURE.md corrigée).
  Réponses Marc intégrées à l'ADR : zone protégée triée comme le reste (archivage si LU seulement), stock
  initial = fenêtre 30 j, `⏰ À traiter` jamais archivé par le moteur, promos non-lues archivées. CODÉ dans
  la foulée (CAL-01/02) : **plus aucun mail d'alerte immédiat** (tout au résumé hebdo — choix Marc informé
  du risque ; l'auto-réparation du chien de garde reste) et **campagne historique 20 → 60 min/j** (Marc
  voulait 100 — impossible, quota dur ~90 min/j). Nouveaux chantiers actés : **#17** (confiance visible
  dans l'app) et **#18** (entités auto-validées à 3 occurrences). Moteur **203 tests**.

- **2026-07-06 — Reprise après recharge (+20 $ Marc) → Correctif R2.** Constat à la reprise : la panne
  crédit est FINIE (dernière ligne « PANNE DE COMPTE » à 08:21, garde R1 : 689 lignes en 4 j, zéro
  nouvelle quarantaine) MAIS **le quota de lecture Gmail du jour était épuisé** — pendant la panne, les
  scans re-parcouraient toute la fenêtre à chaque tick sans rien marquer (rien ne s'indexe) → moteur
  re-bloqué côté Gmail jusqu'au reset quotidien (~3 h du matin, minuit heure du Pacifique). R2 livré :
  panne PERSISTÉE (`DriveAI_LLM_PANNE`) → sources du tick suspendues pendant la panne, re-sonde bornée
  (≤ 1 run normal/h, `LLM_PANNE_RESONDE_MS`), rétablissement auto journalisé au 1ᵉʳ appel 200 ;
  early-exit des scans si la panne tombe en cours de run ; fichier Google natif signalé UNE fois
  (fin des ~576 lignes/jour de bruit). Moteur **203 tests**. **Reste côté Marc** : poser
  `DriveAI_EMAIL` (toujours absente — le résumé hebdo du lundi 6 n'a pas pu partir) et cliquer
  `dequarantaine()` (les 64 photos ne dépendent pas de Gmail : effet immédiat).

- **2026-07-03 — GROS CHECK-UP (demande Marc) → Correctif R1.** Vérification par signaux indépendants
  (fichiers récents Drive, contenu des dossiers par parentId, Sheet d'état exportée en xlsx et analysée
  hors-ligne). Constats : moteur VIVANT (heartbeat 22:16), Index 2381 docs, entités saines, app déployée —
  MAIS **crédit API Anthropic ÉPUISÉ depuis le 01-07 20:56** (1330 échecs HTTP 400 en 2 jours, coût
  juillet 7,33 $ au compteur), **~89 docs quarantainés À TORT** (3 « essais » brûlés contre un mur de
  plateforme ; ~64 photos Facebook physiquement coincées dans 00·À trier, sautées SUR PLACE par
  l'idempotence), et **597 alertes mail TOUTES mortes en silence** (`Session.getEffectiveUser()` exige un
  scope userinfo jamais présent : chien de garde, quarantaines et résumé hebdo n'ont JAMAIS envoyé un
  mail). La campagne historique C12 tourne mais s'écrase sur le mur du crédit ; le « Rangement : 62 % »
  est figé au 01-07 (à réévaluer après recharge). Correctif R1 livré : garde « panne de PLATEFORME »
  (jamais imputée aux documents, appels suspendus par run, re-sonde auto) + canal d'alerte via Script
  Property `DriveAI_EMAIL` (aucun nouveau scope = aucun gel). **RESTE CÔTÉ MARC (R1-03)** : recharger le
  crédit Anthropic, poser `DriveAI_EMAIL`, puis UN clic `dequarantaine()`. Moteur **197 tests**.

- **2026-07-02 — Chantiers #13-#14 : PHASE 3 VISIBLE & MAILS IMPORTANTS (ADR-0010 §2-3) — roadmap v2
  COMPLÈTE.** Dernier lot « mails » : (1) le résumé hebdo NOMME désormais chaque tâche/RDV créé
  (section « 🗓️ Actions & RDV détectés », plafonnée avec « … et N de plus ») et le dashboard app
  gagne la même section (lecture seule, lien vers le mail source) ; (2) le mini-check Haiku passe à
  DEUX signaux en UN appel (JSON `{action, important}`, 24 tokens — `miniVerifActionRdv_` remplacé
  par `miniCheckMail_` + parse pur `parserMiniCheck_`) avec dégradations ASYMÉTRIQUES voulues :
  `action` ouverte sur échec (ne jamais rater une action), `important` fermé (anti-bruit — décision
  Marc : jamais de notification immédiate, le résumé suffit). Un mail important (question directe,
  échéance, administration/officiel) → ligne Index `important|<messageId>` idempotente, posée AVANT
  le tri action/pas-action (une question ouverte sans action créable remonte quand même), jamais en
  zone protégée, AUCUNE écriture Gmail. Section « 📌 À traiter » au hebdo (sujet + lien Gmail
  `#all/`, plafond 10) et au dashboard. Les clés mail restent exclues de la Recherche app. **Revue
  flotte intégrée (1 BLOQUANT)** : le corps est désormais lu et la garde §1 re-vérifiée dessus
  AVANT la pose du flag — y compris sur le chemin « important sans action » qui ne lisait jamais
  le corps (un mail protégé détectable par son corps seul ne remonte JAMAIS dans « À traiter ») ;
  critère `important` resserré (réponse/geste PERSONNEL attendu — jamais relevé/reçu/facture
  récurrente, sinon saturation) ; dashboard : lignes « mail » exclues des agrégats documents.
  Moteur **189 tests**, app **57**, build ok. **Toute la roadmap v2 (#10-#15) est codée.**

- **2026-07-02 — Chantier #12 : HISTORIQUE GMAIL COMPLET (ADR-0010 §1) — design v2 après démolition
  adversariale.** Le design v1 (curseur rétrograde « jour le plus ancien traité + 1 », commit a8e9df4)
  a été **démoli par 3 agents adversariaux** : (a) Gmail trie les fils par DERNIER message ⇒ un vieux
  fil ravivé TÉLÉPORTAIT le curseur des mois en arrière (PJ des fils intermédiaires perdues à jamais) ;
  (b) un jour à > `GMAIL_HISTO_PAGE_FILS` fils ⇒ la même page revenait toujours (plateau infini, jamais
  « terminé ») ; (c) aucun sous-plafond ⇒ chaque tick consommait les 4,5 min ⇒ quota runtime (~90 min/j)
  épuisé en ~2 h, intake vivant MORT le reste de la journée. **Réécrit (v2)** : ancre FIXE posée une
  seule fois à −30 j (`DriveAI_GMAIL_HISTO_ANCRE`) ⇒ la requête `has:attachment before:<ancre>` porte
  sur un ensemble **immuable** ⇒ pagination par offset persistant SÛRE (la leçon « pagination mouvante »
  interdit le mouvant, pas l'offset) ; l'offset n'avance que sur page COMPLÈTE (coupure budget/plafond
  ⇒ rejeu de page, gratuit par idempotence Index, converge car les déjà-indexées ne comptent plus) ;
  plafond `GMAIL_HISTO_MAX_PJ_INEDITES: 2`/run (le vivant garde la priorité runtime) ; fil-poison sauté
  AVEC avance d'offset (journalisé) ; terminaison figée sur page vide. Fil ravivé pendant la campagne
  ⇒ couvert par le scan VIVANT (son nouveau message l'y fait entrer, toutes les PJ du fil traitées).
  `curseurSuivantHisto_` supprimé (surface mise à jour). ROADMAP/BACKLOG/ADR-0010 réécrits (ils
  décrivaient le v1). **Une 2ᵉ contre-vérification a ensuite durci la v2** (C12-04) : (P3) « terminé »
  ne se fige plus sur la première page vide — si la passe a eu la moindre activité, l'offset repart à
  0 pour une **passe de VÉRIFICATION** (guérit 3 pertes silencieuses : fil ravivé par un message SANS
  PJ — invisible du vivant, Gmail matche PAR message —, fil glissé sous l'offset par une suppression,
  fil sauté sur erreur transitoire ; re-passe quasi gratuite, convergence garantie) ; (P4) garde-temps
  et plafond **PAR PJ** — un message à 20 PJ ne crève plus le mur des 6 min sans `finally` — appliqué
  aussi au scan VIVANT (`traiterFil_`) ; (P5) fil en erreur : compteur d'Échecs `histo|fil|<id>`,
  abandonné après 3 essais (la terminaison n'est jamais bloquée). **Puis une 3ᵉ contre-vérification
  (workflow 3 lentilles sur l'IMPLÉMENTATION) a trouvé 2 importants** (C12-05) : (a) le plafond par
  RUN ne borne pas la JOURNÉE — 288 ticks × 25 s = 2 h/j > quota runtime ~90 min/j (tous les
  déclencheurs, chien de garde inclus, gelés l'après-midi) → **budget QUOTIDIEN** 20 min/j (ms
  réelles persistées, `GMAIL_HISTO_BUDGET_JOUR_MS`) ; (b) l'échec d'un fil se comptait par REJEU de
  page (toutes les 5 min) et non par PASSE → 3 essais brûlés en 15 min sur une erreur transitoire →
  compté **à la COMPLÉTION de page seulement** (une erreur qui guérit avant = aucune trace). Plus :
  gardes à CHAQUE niveau de boucle (une page de fils bavards sans PJ réelles faisait ~1000 appels
  Gmail après le budget), ancre **−29 j** (vrai chevauchement, `before:` exclusif), terminaison à
  **2 passes propres consécutives**, abandon annoncé une seule fois. **16 tests d'orchestration** —
  moteur **175 tests**.

- **2026-07-02 — Chantier #15 : APP V2 (ADR-0011) + audit global (#58).** Audit « no dead code » :
  sain d'origine (0 fonction/config/CSS/i18n morte) mais `rejouerLaRevue` retiré (devenu DESTRUCTEUR :
  il aurait vidé l'Index) + 7 morceaux morts + ~15 docstrings mensongères + résumé hebdo véridique. La
  vérification ADVERSARIALE (5 agents) a attrapé un retrait raté (`deciderRoutage_` avalée par regex —
  syntaxe ET tests unitaires aveugles) → réparée + **filet de surface** (`test/surface-moteur.test.js`,
  tout le moteur chargé ensemble, ~60 fonctions du contrat interne vérifiées) + leçon durable. Puis app
  v2 : **Fusionner 1-clic** (statut « variante de : X »), **rejet en masse** (cases + bouton, cellule par
  cellule), **graphe d'activité 30 j**, **quarantaine avec Relancer** — l'app APPEND une demande (onglet
  `Relances`), le moteur consomme au tick (`appliquerRelancesQuarantaine_` — frontière d'exécution
  respectée), **PWA** (manifest + SW passe-plat sans cache). **Vérification adversariale (3 agents) intégrée** : la relance
  n'est plus jamais un no-op silencieux (clé `migre|` figée ⇒ le fichier est RE-INJECTÉ dans 00·À trier
  avec garde §1 ; PJ Gmail/partage hors fenêtre ⇒ limite journalisée) ; le dashboard ne tronque plus la
  quarantaine ni l'activité (Index complet — seul le comptage par domaine se borne) ; compteur de sélection
  purgé à valider/fusionner ; buckets d'activité en date LOCALE. Moteur **158 tests**, app **54**, build ok.

- **2026-07-02 — Chantier #11 : FAST-PATH MÉDIAS BRUTS (ADR-0009 §2).** Vidéo/audio/gif → `_Médias`
  SANS OCR ni LLM ; photo → `_Médias` seulement si nom NON-documentaire (ID numérique ≥ 8 chiffres —
  export Facebook —, IMG_/DSC/PXL, captures) **ET extrait OCR < 20 cars** — **l'OCR reste le juge (§1)** :
  un scan de passeport nommé `IMG_2734.jpg` contient du texte → analyse complète (testé). Nom d'origine
  CONSERVÉ (traçabilité), `_Médias` à la racine (jamais re-scanné), doublons de médias toujours dédupés
  AVANT (empreinte calculée en amont). Accélère fortement le rangement Facebook en cours (~50 fichiers
  en file → plus d'OCR+LLM+escalade Sonnet pièce par pièce). **Revue flotte intégrée** — sécurité CONFORME (R1 : fast-path
  photo seulement si l'OCR a été TENTÉ — une photo > 20 Mo garde son analyse ; R3 : mot-clé protégé
  dans le nom = documentaire) ; intake « approuvé sous conditions » toutes traitées (P1 : blob paresseux —
  une vidéo de 300 Mo va dans `_Médias` au lieu de quarantaine ; P2 : `extraireTexte_` rend **null sur
  échec** ≠ '' sans texte — une panne OCR n'envoie plus un scan sensible en `_Médias` en silence ; P3 :
  clé `drive|` à l'Index ⇒ jamais re-collecté par le rangement). Estimation file-checker : le lot Facebook
  passe de ~10-15 min + ~74 appels LLM à ~1 tick et **0 appel LLM**. +11 tests → **154**.

- **2026-07-02 — Chantier #10 : ENTITÉS PROPRES (ADR-0009 §1, 1ᵉʳ de la roadmap v2).** Cause racine
  trouvée : le PROMPT enseignait littéralement les génériques (« (logement, véhicule, banque,
  diplôme...) » — les 4 mots recrachés tels quels dans la file). Corrigé (« NOM PROPRE identifiable…
  sinon null ») + double filet : `estEntiteGenerique_` (lexique calibré sur la file réelle — générique
  ssi TOUS les jetons du lexique, un identifiant suffit à garder) et consolidation par INCLUSION de
  jetons (`estFusionnableEntite_` — jamais Levenshtein : « Honda Civic 2014 » ≠ « 2017 ») avec compteur
  « Vu N fois ». **Curation one-shot gatée `c1`** de la file (~160) : génériques → « refusée
  (générique) », doublons → « variante de : X » (canonique = plus courte) — STATUTS seulement,
  réversible, borné, reprenable. **Revue flotte intégrée** (structure + code + LLM) : jamais d'ALIAS de
  routage (une variante fusionnable avec une VALIDÉE aurait routé dans son dossier = fusion de facto —
  les 2 reviewers l'ont vue), garde ANNÉE anti-effondrement transitif (« Honda Civic » n'avale pas
  2014/2017), pluriels du lexique, few-shot filtré des génériques hérités (sinon l'exemple gagnerait
  contre le prompt), exemples de contraste (« Banque Nationale »), avertissement sur validation explicite
  d'un générique, tri « Vu N fois » dans la file de l'app. +14 tests → **143** (+51 app).

- **2026-07-02 — C9-07 : recherche structurée (dernière surface ADR-0008) → chantier #9 COMPLET, roadmap
  brainstorm soldée.** Nouvel onglet **Recherche** dans l'app : **filtres instantanés** sur l'Index
  (texte normalisé nom+chemin, domaine, statut, année du DOCUMENT — préfixe du nom conventionnel),
  plafond d'affichage 200, plus récents d'abord ; **plein texte délégué à la recherche native Drive**
  (`fullText contains`, échappé, dossiers exclus — AUCUN index de contenu propre, ADR-0007 intact) ;
  chaque résultat ouvre le document dans Drive (lien direct quand la clé d'Index porte le fileId —
  `drive|`/`migre|` — sinon recherche Drive sur le nom exact, dégradation propre). Helpers PURS testés
  (`filtrerIndex`, `fileIdDepuisCle`, `lienDrivePourLigne`…) : +9 tests → **51 vitest** (+129 moteur).
  Lecture seule (la surface anti-suppression couvre le nouveau code par construction). **Les 9 chantiers
  du brainstorm 2026-07-01 sont tous livrés.** Reste optionnel : C6-05 (déplacer le fichier déjà classé
  depuis le formulaire mail — l'app web le fait déjà mieux, probablement à clore).

- **2026-07-02 — Chantier #9 (v1) : APP WEB Phase 4 (ADR-0008).** **Nouveau dossier `app/`** — SPA
  React/Vite/TS **sans backend** : l'app parle directement aux API Google (Sheets + Drive) avec le jeton
  OAuth de l'utilisateur connecté (GIS token flow, jeton en mémoire jamais persisté ; rien de public,
  aucun secret embarqué — le Client ID est un identifiant public par nature). Deux surfaces v1 :
  **Tableau de bord** (Santé + activité Journal + comptage Index par domaine) et **Corrections** —
  dont la **validation 1-clic des entités** (Statut→« validée » écrit dans la Sheet, lu par en-têtes
  réels ; ferme le reste du chantier #4) et le **reclassement immédiat** (déplacement/renommage Drive
  sous garde-fous, journalisé dans `Corrections` ⇒ few-shot). **Contrainte non négociable ADR-0008
  respectée** : garde-fous ré-implémentés en TS PUR (`garde-fous.ts`, miroir de `aParentProtege_`
  strict/`normaliserCle_`/prédicat 3 granularités) + **test de surface « aucune suppression »** (le
  code de `src/` ne peut contenir DELETE/trashed/deleteRange sans casser la CI). **42 tests vitest**, job
  CI dédié (`app` : npm ci → vitest → tsc+build). UI bilingue FR/EN. **Revue flotte passée** : sécurité 🟢
  (recos appliquées : motifs anti-suppression renforcés `:clear`/`/trash`/méthode non littérale, backslash
  échappé dans la recherche, CSP) ; code 🟠→réglé — dont les 2 requis : la **journalisation Corrections est
  désormais COMPLÈTE** (émetteur pré-rempli depuis le nom + domaine en datalist Index + entité — une ligne
  sans émetteur était MORTE pour le few-shot, `Corrections.gs` la saute) et le **401 rebascule sur l'écran
  de connexion** (jeton GIS ~1 h). UX : destination = **lien Drive collé tel quel** (extraction d'ID) +
  datalist des entités validées (leur Dossier ID est déjà dans la Sheet — zéro duplication de config).
  **Côté Marc (une fois, ~10 min)** : client OAuth Google Cloud + import Vercel (Root Directory=`app`) —
  `DEPLOIEMENT.md` §Phase 4. **Reste : C9-07 recherche structurée (v1.1), C6-05.**

- **2026-07-02 — Chantier #8 : MIGRATION de l'existant vers la nouvelle taxonomie (ADR-0002).** **Nouveau
  module `Migration.gs`.** Campagne gatée par `CONFIG.MIGRATION_TAG` (m1) : les documents classés AVANT la
  refonte (#3-#6 : nommage par type, entités, 07·Santé, few-shot) sont re-passés au **pipeline complet EN
  PLACE** (déplacement/renommage seul — jamais via `00·À trier`, où leur clé Index existante bloquerait le
  re-traitement). 3 mécanismes décisifs : **clé dédiée `migre|tag|fileId`** (additive, idempotence des autres
  sources intacte, convergence de la collecte) ; **`ignorerDoublon`** dans le pipeline (un doc classé a son
  empreinte dans l'Index — sans bypass, tout le Drive migré partirait en `_Doublons` comme « doublon de
  lui-même ») ; **zone protégée** exclue des racines + revérif STRICTE avant mutation (refus inscrit →
  convergence, fichier non touché). Attend la fin du grand rangement ; APRÈS l'intake dans le tick (flux
  vivant prioritaire) ; page de 12 docs/run (OCR+LLM lourds). **Bug latent corrigé au passage** : les
  prédicats du rangement (`estAReclasser_`/`estAReclasserLeger_`) ne reconnaissaient que `AAAA-MM-JJ_` —
  or le nommage PAR TYPE produit aussi `AAAA_`/`AAAA-MM_` → une future campagne de rangement aurait
  re-collecté ces noms en boucle infinie. Regex élargie aux 3 granularités (testé). `renommer_` (PATCH nom
  seul) ajouté à `DriveRest.gs` (destination = dossier courant). +8 tests → **128**. Relance : bumper
  `MIGRATION_TAG` (m2…) — utile après validation d'entités en masse. **Revue flotte passée** :
  security-auditor 🟢 CONFORME (aucun chemin de détachement de 04, `renommer_` sans champ parents par
  construction) ; quotas + file-checker → correctifs appliqués : quarantaine sur doc illisible pré-pipeline
  (sinon campagne jamais figée), try par item, **sous-budget `MIGRATION_BUDGET_MS` 2 min/tick** (protège le
  quota journalier ~90 min/j — l'intake reste vivant toute la journée), `creerRaccourci_` idempotent
  (`raccourciExiste_`). Coût estimé ~3-5 $ one-shot, campagne étalée 1-2 jours. +9 tests → **129**.
  **Reste roadmap : #9 (app web), C6-05, validation 1-clic entités.**
- **2026-07-02 — Chantier #7 : fichiers PARTAGÉS (source d'intake #3, ADR-0005).** **Nouveau module
  `Partages.gs`.** À parité avec les PJ Gmail : les fichiers récemment partagés avec Marc (`sharedWithMe`,
  REST `files.list` trié `sharedWithMeTime desc`) de type document (allowlist images + PDF/Office) sont
  **COPIÉS** dans son arbo (l'original reste chez la personne) et suivent le pipeline commun (dédup MD5 →
  OCR → LLM → routage). Idempotence par l'Index (`shared|fileId`, posée par le pipeline). Borné
  (`PARTAGES_MAX_PAR_RUN=15`/run + garde-temps), **storage-aware** (vérif lazy du quota `about.get` ;
  au-delà de 95 % on SUSPEND la copie — jamais de suppression — + 1 alerte mail, reprise auto). Câblé dans
  le tick comme source #3 (après Gmail+dépôts, avant intentions Phase 3), **budget-gatée + enveloppée
  try/catch** (ne bloque jamais l'intake). Décisions pures testées (`estTypeDocumentPartage_`,
  `classerRecencePartage_`, `stockagePresquePleinCalc_`), +6 tests → **120**. **Aucun nouveau scope OAuth**
  (`drive` couvre les partages) → rien de neuf côté Marc. **Revue flotte passée** : security-auditor 🟢
  CONFORME (parité stricte avec les PJ Gmail, aucun chemin destructif, vie privée OK) ; apps-script-quota
  et file-checker → correctifs appliqués : (a) blob téléchargé 1× (mémoïsé) au lieu de 2 downloads/fichier ;
  (b) récence TRI-ÉTAT (`classerRecencePartage_` : date absente ⇒ saut d'item, jamais un STOP global qui
  gèlerait la collecte) ; (c) **garde de taille** `PARTAGES_TAILLE_MAX` (50 Mo — les partages ne sont pas
  plafonnés comme les PJ Gmail ~25 Mo), skip journalisé ; (d) `placerRevue` mort supprimé + log de fin
  toujours émis. Convergence assurée : petite fenêtre de récence + skip des déjà-copiés + cap sur les copiés
  (pas le plateau de l'historique Gmail). **Reste roadmap : #8 (migration existant), #9 (app web), C6-05
  (déplacement fichier corrigé).**

- **2026-07-02 — Chantier #6 (partie 2, C6-04) : entité corrigée → « validée » (ADR-0003).** **Modif du
  MOTEUR.** Une correction du formulaire qui nomme une entité + son domaine la **promeut « validée »** dans
  le référentiel (`promouvoirEntiteValidee_`, `Entites.gs`) : find-or-create idempotent (no-op SANS I/O Sheet
  si déjà validée ; `en_attente`→`validée` sinon ; inconnue → ajoutée validée). Câblé dans
  `lireEtAppliquerCorrections_` après `enregistrerCorrection_`. Le dossier d'entité est matérialisé au tick
  suivant (`creerDossiersEntitesValidees_`, déjà en place) et le routage l'utilise. **Validation EXPLICITE de
  Marc via le formulaire = pas d'auto-prolifération** (garde-fou respecté). Prédicat pur `correctionValideUneEntite_`
  testé. +1 test → **108**. Revue flotte (structure + code) en cours. **Reste C6-05** : déplacer/renommer le
  FICHIER déjà classé (champ « Fichier concerné ») — différé (nommage texte libre fragile ; le few-shot corrige
  déjà le futur). ⚠️ Toujours en attente : ré-autorisation du scope `forms` par Marc au prochain déploiement.

- **2026-07-02 — Chantier #6 (partie 1) : correction via formulaire Google (ADR-0003 §1-2).** **Modif du
  MOTEUR + NOUVEAU SCOPE.** Marc a choisi le canal **Google Forms** (vs édition directe de la Sheet). Nouveau
  module `Formulaire.gs` : formulaire de correction find-or-create (`assurerFormulaireCorrection_`, ID en
  Script Property), lu 1×/tick AVANT l'intake (`lireEtAppliquerCorrections_`) — les nouvelles réponses
  (idempotence par horodatage) sont enregistrées via `enregistrerCorrection_` et nourrissent le few-shot du
  #5. Parsing PUR testé (`reponseVersCorrection_`, `domainesPourFormulaire_`). Borné (`CORRECTIONS_MAX_PAR_RUN`
  =20 + garde-temps), enveloppé try/catch (ne gèle jamais l'intake). Lien du formulaire ajouté au résumé
  hebdo. +5 tests → **107**. **⚠️ Action Marc : nouveau scope `https://www.googleapis.com/auth/forms` dans
  `appsscript.json` → ré-autorisation Google unique au prochain déploiement** (frontière d'exécution : la
  session Claude ne peut ni créer le formulaire ni déployer). **Reste C6-04** : appliquer la correction au
  FICHIER déjà classé (déplacer/renommer) + promouvoir l'entité corrigée en « validée ». Revue flotte
  (sécurité/scope + correction + quota) en cours.
- **2026-07-02 — Chantier #5 (partie 1) : boucle d'apprentissage (ADR-0003 §3).** **Modif du MOTEUR.**
  Nouvel onglet `Corrections` + module `Corrections.gs` : à chaque classement, les corrections passées du
  **même émetteur** sont injectées en **exemples few-shot** en tête du prompt LLM (`appelAnthropic_`), bornées
  (`FEWSHOT_MAX`=3, `FEWSHOT_SEUIL`=0.6) — prévisible sur le récurrent (mêmes fournisseurs/écoles), souple
  ailleurs. Sélection PURE et testée : `scoreCorrection_` (pertinence par émetteur), `correctionsPertinentes_`
  (top-N triés), `blocFewShot_` (formatage). Cache 1×/run (reset dans `tickDriveAI`), try/catch → dégrade à 0
  exemple si l'onglet est illisible (n'empêche jamais de classer). Primitive `enregistrerCorrection_` (append
  idempotent) prête pour le **canal de saisie = chantier #6** (mail → mini-formulaire). +6 tests → **101**.
  Revue flotte (coût/correction/quota) en cours. ⚠️ **Récup git** : le conteneur avait redémarré sur un vieux
  commit (P1-14) sans `test/` ; l'état complet (C1→C4, 95 tests) était **sauf sur le distant** — resynchronisé
  par fast-forward vers `origin/claude/…` (92eed34). Rien perdu.
- **2026-07-01 (nuit) — Chantier #4 (partie 1) : garde anti-variantes d'entités (ADR-0002 §4).** **Modif
  du MOTEUR.** Moteur de similarité **pur** dans `Entites.gs` (`tokensEntite_`, `jaccardTokens_`,
  `distanceLevenshtein_`, `similariteEntite_` = max de Jaccard/inclusion/Levenshtein, `chercherVariante_`).
  À la proposition d'une entité (`entiteEnAttenteAjouter_`), on signale la plus proche existante **du même
  domaine** dans une nouvelle colonne `Variante possible ?` (seuil `CONFIG.SEUIL_VARIANTE`=0.6) — pour
  fusion **1-clic** par Marc, **jamais de fusion auto** (anti-prolifération renforcé, pas affaibli). +8
  tests → **94**. Piège de test rencontré : `deepStrictEqual` échoue sur un tableau renvoyé par le bac à
  sable vm (prototype d'un autre realm) → spread `[...x]` dans le test. Revue flotte en cours. **Reste
  C4-03** : validation 1-clic (mail → formulaire, rejoint ADR-0003 / chantiers #5-6).
- **2026-07-01 (nuit) — Chantier #3 (partie 3, C3-03) : dossiers `07 · Santé` + `_Technique` (ADR-0002 §3).**
  **Modif du MOTEUR** + **change la taxonomie Drive**. `07 · Santé` = domaine **auto-créé** (`Config.DOMAINES_AUTO`,
  `Router.dossierDomaineAuto_` find-or-create à côté des domaines) proposé au LLM (`domainesAutorises_`).
  `_Technique` = fichiers **code/CAO** (par extension `CONFIG.EXT_TECHNIQUES`) routés vers `_Technique`
  **sans OCR ni LLM** (`Pipeline` après le fast-path doublon ; économie de coût). **Renumérotage Perso 07→08**
  (`CONFIG.DOMAINES` clé `08 · Perso & projets`, même ID) avec `Main.assurerNomsDomaines_` (gated
  `NOMS_DOMAINES_TAG` = `s1`, renomme le dossier physique pour coller à la config — renommage seul,
  réversible, zéro clic). `Router.dossierRacineParNom_` généralisé (`_Doublons`/`_Technique`). **+6 tests →
  86.** `docs/TAXONOMY.md` mis à jour. Revue flotte en cours (structure-keeper, code-reviewer, security,
  llm-cost). **Chantier #3 : terminé.** Prochain : #4 (entités systématiques + validation 1-clic + garde
  anti-variantes, ADR-0002 §4).
- **2026-07-01 (nuit) — Chantier #3 (partie 1) : nommage par type de document (ADR-0002 §6).** **Modif du
  MOTEUR** (le nom des documents classés change). `src/Router.gs` : `nomParType_` + `schemaNommage_` (règles
  ordonnées de mots-clés → granularité de date jour/mois/année + libellé fixe `Relevé`/`Paie`/`CV`) +
  `tronquerDate_`. `deciderRoutage_` et `doublon_` appellent `nomParType_` ; `nomNormalise_` (format
  historique jour) conservé comme défaut → dégradation gracieuse (type inconnu = format historique, jamais
  un blocage). Ex. : relevé → `2024-03_Relevé_Desjardins`, diplôme → `2021_Diplôme_IUT-ULCO`, facture →
  `2024-03-05_Facture_Hydro-Québec`. `docs/NAMING.md` réécrit (table par type). **+9 tests → 69 au total.**
  Pas de bump `VERSION` (nouveaux docs seulement ; renommage de l'existant = migration, chantier #8).
  **C3-02 deviner-du-nom** (même session) : `Router.devinerTypeDepuisNom_` (pur ; séparateurs `_ - .` →
  espaces, mots-clés/regex ancrés → type canonique, ex. `…_TP4_…` → « TP ») + `enrichirClassifDepuisNom_`
  (complète `classif.type_doc` s'il est vide, sans écraser), appelé dans `Pipeline.traiterDocument_` avant
  le routage. **+5 tests → 80 au total.** Revue 🟢 (file-checker CONFORME : idempotence/déterminisme intacts).
  **Reste chantier #3** : nouveaux dossiers `07·Santé`/`_Technique`. Prochain aussi possible : #4 (entités
  1-clic + anti-variantes, ADR-0002).
- **2026-07-01 (nuit) — Chantier #2 : chien de garde (watchdog, ADR-0004).** **Modif du MOTEUR** (déployée).
  `src/Main.gs` : heartbeat `DriveAI_LAST_TICK` (finally du tick), 2ᵉ déclencheur `chienDeGarde` (30 min,
  `assurerTriggerChienDeGarde_` create-if-absent, posé aussi par `installerTrigger`), décision **pure**
  `actionChienDeGarde_` (machine à 3 états détecter→réparer→alerter, dédupée par épisode = valeur du heartbeat
  figé), auto-réparation (`installerTrigger` + re-vérif `presenceTriggerTick_` anti-fausse-alerte) puis alerte
  mail rassurante (`alerterChienDeGarde_`, dédupée, à soi-même). `src/Resume.gs` : `etatSysteme_` + ligne
  « État du système » au résumé hebdo. `src/Config.gs` : `WATCHDOG_MINUTES=30`, `WATCHDOG_SEUIL_MS=45min`.
  **+10 tests** → **60 au total**. **Revue flotte 🟢** (security CONFORME, quota CONFORME — correctif A1
  appliqué : ne pas fausse-alerter si un log échoue après une réparation réussie ; code-reviewer 🟢). RUNBOOK
  à jour (l'incident « déclencheur désactivé » est désormais auto-réparé). Latence de détection assumée :
  jusqu'à ~75-105 min (seuil 45 min + cycles watchdog 30 min) — « rassurer, pas réagir à la seconde ».
  Prochain : chantier #3 (nommage par type + `07·Santé`/`_Technique`, ADR-0002).
- **2026-07-01 (soir ter) — Chantier #1 (fondation testable) — partie 2/2 : Journal borné + onglet `Santé`.**
  **Modif du MOTEUR** (déployée). `src/Journal.gs` : `lignesJournalASupprimer_` (pure, hystérésis `max+marge`
  → purge en lot, ramène à `max`), `bornerJournal_` (`deleteRows` de LOG — jamais un document, §2 intact),
  `majSante_` (onglet `Santé` : heartbeat, catalogue Index, coût du mois, statut rangement — **métadonnées
  seulement**, une seule `setValues`). `src/Main.gs` : les deux dans le `finally` de `tickDriveAI`, chacun
  enveloppé, `releaseLock` durci (try/finally imbriqué → verrou toujours relâché). `src/Config.gs` :
  `JOURNAL_MAX_LIGNES=20000` (> `RESUME_MAX_LIGNES=15000`), `JOURNAL_MARGE=5000`. **+13 tests** (rotation
  Journal, coût pur, invariant Santé) → **50 tests** au total. **Revue flotte 🟢** (security CONFORME,
  quota CONFORME — 2 points appliqués : commentaire précisé + `releaseLock` durci ; code-reviewer 🟢 — sa
  suggestion de test invariant Santé appliquée). Chantier #1 : **socle posé**. Prochain : chantier #2 (chien
  de garde, ADR-0004). Le grand rangement continue en fond.
- **2026-07-01 (soir bis) — Chantier #1 (fondation testable) — partie 1/2.** Premier code post-brainstorm.
  Posé un **harness Node** (`test/harness.js`) qui charge les `.gs` Apps Script dans un bac à sable `vm`
  avec des **mocks Google déterministes** (Utilities.formatDate/Session/Date partagé, faux Drive dont un
  `getParents()` qui peut lever comme le cas P1-17) — **sans modifier le code source** (le comportement testé
  = celui déployé). **37 tests** (`node --test`, zéro dépendance) couvrant la logique de décision : nommage,
  dates, entités/sous-dossiers hors schéma, prédicats de collecte, le **garde-fou §1** (zone protégée jamais
  détachée : multi-parents, chaîne d'ancêtres, échoue-fermé/ouvert, borne anti-cycle), et l'**invariant vie
  privée ADR-0007** (`indexAjouter_` n'écrit que des métadonnées). **Job CI** « Tests unitaires (logique pure) »
  ajouté à `ci.yml` (Node 20). Piège rencontré (test, pas code) : un faux itérateur `getParents` *infini*
  faisait boucler la garde (borne de profondeur ≠ borne de largeur) → corrigé en modélisant un vrai cycle
  Drive (itérateurs finis) ; et `instanceof Date` échouait entre réalités vm/test → `Date` de l'hôte partagé
  dans le sandbox. **Reste chantier #1 (partie 2/2)** : Journal borné + onglet `Santé`. Le grand rangement de
  l'ancien Drive continue en fond.
- **2026-07-01 (soir) — Brainstorm produit « niveau pro » + dossier de conception.** Après la session
  marathon de correctifs (P1-13→P1-20) et le lancement du grand rangement, Marc a demandé un brainstorm
  détaillé pour élever DriveAI au niveau pro avec bonne documentation. Produit un **dossier de conception
  complet** par ADR (Architecture Decision Records) : **0001** cadrage (perso, qualité pro, précision >
  contrôle > fiabilité, rester gratuit) ; **0002** taxonomie/entités/nommage ; **0003** contrôle &
  correction (mail hebdo → formulaire 1-clic, `Corrections` few-shot) ; **0004** fiabilité (chien de garde) ;
  **0005** sources = fichiers partagés ; **0006** ⭐ FONDATION (testabilité + filet de tests CI + Journal
  borné/`Santé`) ; **0007** sécurité/vie privée (LLM = tout tel quel ; **état = métadonnées seulement**,
  *vérifié sur le code* : Index = nom/date/chemin/statut/hash, aucun corps de doc → règle durable ajoutée
  `CLAUDE.md` §7) ; **0008** app web Phase 4 (recherche/dashboard/corrections, login Google, plein texte via
  index natif Drive pour respecter 0007). **Roadmap** (`docs/ROADMAP.md`) réordonnée à 9 chantiers, socle #1
  = fondation testable. Runbook + guide écrits. **4 PR docs mergées** (#33-#36) via auto-merge. Fil rouge :
  deux fois un choix de Marc contredisait une décision récente (app applique direct ↔ garde-fous §1/§2 ;
  plein texte ↔ 0007 métadonnées) → **surfacé avant de figer**, réconcilié (recherche) ou documenté avec la
  contrainte attachée (corrections : garde-fous ré-implémentés + testés). **Aucun code moteur touché** — que
  de la doc. Le grand rangement a continué en autonomie tout du long. **Prochain pas : coder le chantier #1.**
- **2026-06-30 (P2.7 ancien Drive + Phase 3 complète)** — Diagnostiqué un blocage de pipeline CI/CD
  (GitHub Actions muet 26-27/06, puis branche en conflit avec `main` bloquant la CI sur la PR) → résolu
  (fusion `-s ours`, conflits de docs/squash réconciliés), PR #19 (P2.5+P2.6) mergée et déployée en prod
  avec vérification run-par-run (pas seulement « ça devrait marcher »). **P2.7** : ancien Drive de Marc
  identifié (« Ancienne structure », pas `_Archive 2025`) et branché sur le grand rangement
  (`RANGEMENT_RACINES_SUP`, tag `r2`) ; audit sécurité a détecté un trou (OCR vide → `sensible=false`
  sans signal → classement auto d'un possible passeport/doc fiscal) → corrigé par un garde-fou dédié
  (dépôt + OCR non exploitable → revue forcée), re-audité 🟢 par security-auditor et file-checker (pas
  de sur-blocage). **Phase 3 codée** (remplace l'agent mail externe de Marc) : scopes Tasks/Calendar
  + clients REST (`Tasks.gs`/`Calendar.gs`/`GoogleApi.gs`) ; pré-filtre 3 étages (`Prefiltre.gs`) ;
  extraction d'intentions LLM + routage Tasks/Calendar (`Llm.gs`) ; orchestration + idempotence à 2
  niveaux + ID client Calendar (`Intentions.gs`). Re-audité par 4 spécialistes en 2 passes : sécurité,
  coût (~1-4 $/mois), idempotence 🟢 du premier coup ; apps-script-quota a trouvé un **vrai BLOQUANT**
  (pagination par offset numérique sur une fenêtre Gmail mouvante → stagnation permanente au-delà de
  ~200 messages, vérifié manuellement par traçage du scénario plutôt que pris pour argent comptant) →
  corrigé par un scan à deux voies (offset pour le mail neuf + curseur de date absolue persisté pour le
  rattrapage d'historique), re-vérifié 🟢. Repéré et corrigé seul, AVANT tout audit, un bug d'ID Calendar
  non scopé par message (collision possible entre deux mails à intention identique) — leçon : toujours
  relire son propre code avant de l'envoyer en revue. Repéré aussi qu'une suggestion d'audit (« ajoute
  arc/cra aux mots-clés protégés ») aurait introduit un faux-positif massif (« arc » dans « Marc ») avec
  l'implémentation substring existante → corrigé le matcher (mot entier pour les motifs courts) avant
  d'appliquer la suggestion. **2 agents de la flotte ont halluciné un sujet sans rapport** (exemples
  d'outils MCP non pertinents) lors d'un premier essai — relancés avec un prompt plus strict, succès.
- **2026-06-27 (P2.5 escalade + P2.6 grand rangement)** — **P2.5** : la confiance basse ne part plus en
  revue → `analyseApprofondie_` (Sonnet ×3, consensus de domaine puis confiance max), classé au meilleur
  endroit ; fallback Sonnet simple sur échec Haiku total (anti-boucle de coût), plafond d'escalades/run,
  docs sensibles jamais escaladés. **P2.6** : `rangerToutLeDrive`/`rangerUnePage_` + hook auto
  `appliquerRangementInitial_` (gated `CONFIG.RANGEMENT_TAG`) renvoient au fil des ticks tout le « vrac »
  des domaines vers `00·À trier`. Garde-fous re-audités par la flotte : **sécurité** — un fichier ayant un
  parent dans (ou sous) `04 · Immigration` est écarté à la collecte ET re-vérifié avant tout déplacement
  (`aParentProtege_`/`chaineMonteVersProtege_`), jamais détaché de la zone protégée (BLOQUANT initial levé) ;
  **garde-temps** — collecte récursive bornée + try/catch → `notifierEchec_`, amorce `tickDriveAI()` seulement
  s'il reste du budget (anti-dépassement des 6 min). Convergence garantie : le pipeline renomme toujours en
  `AAAA-MM-JJ_` → jamais re-collecté (idempotent).
- **2026-06-25 (P2.2 — full auto)** — **Auto-déploiement** : Action `Deploy` (`.github/workflows/deploy.yml`,
  `clasp push` sur merge `main`, secrets `CLASPRC_JSON`/`SCRIPT_ID`, inactive sans secrets). **Auto-rejeu** :
  `CONFIG.VERSION` + `appliquerRejeuSiNouvelleVersion_`/`rejeuAutoDesDepots_` renvoient les dépôts partis
  en revue vers `00·À trier` sur bump de version — chirurgical (dépôts `drive|…` seulement, par `fileId`),
  réversible (aucune corbeille), borné (`REJEU_PAGE` + garde-temps), reprenable. Re-audité par la flotte
  (sécurité + quotas) après un 1er design jugé dangereux (corbeille + vidage Index en auto) → corrigé.
- **2026-06-25 (P2.1)** — Calibration : entité non validée → classée au domaine (pas en revue).
- **2026-06-25 (Phase 2)** — Codé le **dépôt manuel** (`Intake.gs`, scan `00·À trier`, fichiers
  déplacés via Drive REST) et le **référentiel d'entités** (`Entites.gs` : cache 1×/run, résolution
  insensible casse/accents, lignes `en_attente` auto-remplies, création des dossiers d'entités
  validées + sous-dossiers fixes). Pipeline unifié Gmail+dépôt (`Pipeline.gs`), routage à l'entité
  (`Router.gs`), raccourcis multi-entités + doublons (empreinte MD5). Revue par la flotte (7 agents) :
  correctifs appliqués — `rejouerLaRevue` ne corbeille plus un original déposé (le renvoie en
  `00·À trier`), garde-temps + plafond sur la création de dossiers, empreinte bornée par la taille,
  clé d'idempotence `drive|fileId`, garde « sous-dossier hors schéma », retry Drive REST.
- **2026-06-25** — Correctif **OCR** : le 1er run réel échouait sur chaque doc
  (`Drive is not defined`, service avancé inactif après `clasp push`). Réécriture de `src/Ocr.gs`
  pour appeler l'**API Drive en REST via `UrlFetchApp`** (token OAuth, scope `drive` déjà accordé),
  dégradation propre si échec. Mergé (PR #10). Reste à Marc : `git pull && clasp push`.
- **2026-06-23 (suite)** — Phase 1 **déployée** par Marc (clasp) et **validée en réel** ;
  recalibrage du flag `sensible` (trop large → immigration + fiscal seulement) ; documents vivants
  (HANDOVER, DEPLOIEMENT) + tenue à jour automatique mis en place.
- **2026-06-23** — Session initiale : scaffolding & automatisation (PR #1, mergée) ; Phase 1
  complète, revue par la flotte et corrigée (PR #2, mergée) ; mise en place des documents
  vivants (HANDOVER, déploiement) et de leur tenue à jour.
