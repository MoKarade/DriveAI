# ADR-0026 — Onglet Assistant : chat Claude (Q&A sur fichiers + opérations de dossiers)

- **Statut** : accepté (chantier C28-30, décision Marc 2026-07-23, verbatim : « je veux un chatbot
  qui marche avec claude … retrouver des fichiers et les analyser pour que je pose des questions
  dessus … utiliser ce chatbot plutôt que la page apprentissage pour créer des nouveaux dossiers,
  en fusionner etc. … un onglet assistant … une partie où je peux chat et une autre où ça me pose
  des questions par rapport aux dossiers à créer … crée un dossier garage dans le dossier qui
  correspond … la liste des fichiers à déplacer et je peux décider lequel déplacer »).
- **Design validé par l'architecte NotebookLM (C28-30)** — exécution en 3 PR séquentielles. Cet ADR
  est le cadrage §8 du chantier (le seul changement `Llm.gs`/`WebApp.gs` de fond : un nouvel appel
  « messages » multi-tours + boucle Tool Use ; **aucune** modification de la logique de classement).
- **Remplace** la section réorg de l'app (ADR-0019/#21) par l'onglet Assistant : la réorg gardée
  (C21-06, `appliquerUneAction_`) devient le moteur d'exécution des opérations demandées par chat,
  jamais une nouvelle surface de mutation.

## Problème

L'auto-rangement classe bien, mais (a) Marc ne peut pas *interroger* ses documents (« donne mon
NAS » = chercher, lire, extraire) et (b) piloter la structure (créer/fusionner/déplacer/renommer,
« organiser un dossier ») passe par une page de réorg rigide. Il veut un assistant conversationnel
unique, avec aperçu + validation avant toute mutation, et un budget borné.

## Décision (chantier phasé)

1. **PR1 — Moteur, cœur du chat & outils de LECTURE (Q&A en escalade).** *(← ce commit)*
   - Nouvel appel `appelAnthropicMessages_` (un tour `/v1/messages`, gère panne/usage) + boucle
     `appelAnthropicChat_` (Tool Use bornée `CHAT_TOOL_ITERATIONS_MAX`) dans `Llm.gs` — **sans I/O
     Drive** (l'exécution des outils est un callback fourni par l'appelant).
   - Action web app `chat-assistant` (`WebApp.gs`) : 3 outils **LECTURE SEULE** — `recherche_nom`
     (`title`), `recherche_contenu` (`fullText`), `lire_fichier` (texte borné `CHAT_LIRE_MAX_CARS`,
     taille ≤ `OCR_TAILLE_MAX`). Escalade : nom → contenu → lecture. Aucune mutation possible.
   - **Budget §2.6** : plafond QUOTIDIEN `CHAT_COUT_JOUR_MAX` (**0,33 $**, échec fermé au-delà) +
     anti-rafale + Sonnet (raisonnement multi-outils). 0,33 × 30 ≈ 9,9 $/mois GARANTIT la cible
     < 10 $/mois même saturé chaque jour (revue llm-cost : 0,50 aurait plafonné à 15 $/mois). Coût
     mesuré par `usageRunSnapshot_` (le contexte doPost réinitialise l'usage lui-même : le tick n'a
     pas tourné). **Suivi (revue llm-cost, non bloquant)** : le plus gros levier restant est le
     *prompt caching* du préfixe système+outils+historique (renvoyé jusqu'à 5×/message) — ~−90 % sur
     l'entrée répétée ; à implémenter après vérif de la doc Anthropic (min-préfixe cacheable + TTL),
     inaccessible via le proxy au moment de PR1.
   - **ADR-0007** : rien du contenu n'est persisté — l'historique vit côté navigateur (éphémère),
     le texte lu ne fait que transiter vers Claude ; seules des métadonnées (coût $, timestamp)
     touchent les Script Properties.
2. **PR2 — Opérations de dossiers via la réorg GARDÉE + « épinglé Marc ».** *(← ce commit)*
   - Outil `proposer_reorg(actions, synthese)` (`WebApp.gs`) : le chat fournit des actions avec de
     VRAIS id Drive (obtenus par ses recherches), whitelistées PURE (`parserActionsChat_` : type
     connu, id requis non vides, nom sans « / », plafond `REORG_ACTIONS_MAX`), écrites en lignes
     `proposé` dans l'onglet `Réorg` (append). **Le chat ne MUTE JAMAIS le Drive** ; l'existence des
     id et les gardes de zone sont re-vérifiées à l'APPLICATION.
   - Nouvelle action `deplacer-fichier` dans `appliquerUneAction_` (`Reorg.gs`, chemin GARDÉ C21-06)
     via `appliquerDeplacerFichier_` : `getFileById(source).moveTo(cible)` — **moveTo seul**
     (réversible, jamais de suppression), garde §1 STRICTE échec-fermé des DEUX côtés (`aParentProtege_`
     sur le FICHIER source — jamais détacher un fichier de 04 · Immigration — ET zone/racine système
     sur la cible via `chaineMonteVersProtege_`). La **source doit être un FICHIER** : un dossier
     (racine de domaine/catégorie/04) passé par erreur est rejeté par le MIME (revue sécurité — sinon
     `moveTo` relogerait la racine, dérive structurelle). Application déclenchée par la **validation de
     Marc** (par fichier) dans l'app (PR3).
   - **Assouplissement `creer` (revue code 🟠, §8)** : créer un dossier DANS un domaine/catégorie
     `intouchable` (ex. « crée Garage dans Véhicule » — demande explicite de Marc) est désormais
     AUTORISÉ — créer un ENFANT ne MUTE pas le parent (ni détachement ni suppression), donc n'enfreint
     pas l'invariant d'immunité structurelle (`intouchables` protège un dossier contre SA PROPRE
     mutation, pas contre la réception d'un enfant). Restent interdits (préservés explicitement) :
     zone protégée 04, files `00 · À trier`/`À vérifier` (créer dans l'intake casserait le tri) et
     racines système `_…`. Change le guard PARTAGÉ (affecte aussi le plan réorg #21 — moins de refus
     spurieux, aucun garde-fou perdu).
   - **« Épinglé Marc » (convergence)** : un déplacement de fichier réussi inscrit la clé DÉDIÉE
     `epingle|<fileId>` dans l'Index. **Adaptation au code réel (le plan supposait
     `indexLire_('drive|…').statut`, qui n'existe pas)** : `indexAjouter_` APPEND (pas d'update) et
     `drive|<fileId>` est déjà le namespace des dépôts classés — un namespace dédié `epingle|`,
     checkable O(1) par `indexContient_`, évite la sur-filtration et la duplication de clé. Les
     prédicats de collecte des campagnes de re-rangement l'IGNORENT (immunité) : `collecterConsolidation_`,
     `estAMigrer_`, `estAReanalyser_` **et** `estAReclasserLeger_` (grand rangement, défense en
     profondeur) — les QUATRE, pour une convergence complète.
3. **PR3 — UI de l'onglet Assistant.** `app/src/vues/Assistant.tsx` (chat + partie « dossiers à
   créer » : suggestions auto ET questionnaire guidé), remplace la section réorg, embarque la vue
   réorg existante pour la validation ligne-à-ligne, compteur de budget visible.

## Garde-fous & risques

- **§2 aucune suppression / zone 04** : PR1 est **LECTURE SEULE** (verrou de surface + test) ; PR2
  n'ajoute **aucune** surface de mutation — il réutilise le chemin gardé de la réorg (`moveTo` +
  create + rename ; corbeille des vides = clic app, ADR-0014).
- **Injection de requête Drive** : `rechercheDriveChat_` échappe `\` et `'` et fige `and trashed =
  false` ; la recherche reste dans le Drive de Marc (compte du moteur).
- **Budget §2.6** : plafond quotidien à échec fermé ; usage interactif de Marc, pas un flux
  automatique — un run isolé est borné par `CHAT_MAX_TOKENS × CHAT_TOOL_ITERATIONS_MAX`.
- **Confidentialité (ADR-0007) — élargissement DÉLIBÉRÉ du *quand*, assumé.** Lire le CONTENU d'un
  doc (y compris sous 04 · Immigration / `sensible`) ne dépasse pas la frontière de transit déjà
  assumée par le pipeline (qui envoie déjà chaque doc à Anthropic pour le classement) : aucun
  nouveau tiers, réponse renvoyée à Marc seul via l'endpoint auth-gated, aucune persistance. Mais
  c'est un choix explicite : `lire_fichier` envoie du contenu à Anthropic **à la demande de Marc**,
  docs sensibles inclus, là où l'action `recherche-ia` n'envoie **volontairement aucun** contenu.
  Décision écrite ici, pas un effet de bord hérité.
- **« Lecture seule » ≠ zéro écriture Drive du tout (nuance OCR, sanctionnée).** `lire_fichier` sur
  un binaire (PDF/image/Word/PPT/Excel) passe par `extraireTexte_ → convertirEtExtraire_`, qui
  **crée puis supprime** un Google Doc temporaire `DriveAI_extract_temp` (exception OCR existante,
  §2 : ressource créée par NOUS, jamais un fichier de Marc ; l'`id` supprimé vient de la réponse
  d'insert, jamais de l'input du modèle). Aucun fichier de Marc n'est muté ; l'invariant §2 tient.
- **Convergence (PR2)** : un fichier épinglé par Marc ne doit jamais être re-déplacé par le flux
  vivant/consolidation — marque d'Index respectée des deux côtés, verrouillée par test + tripwire.

## Méthode de test

PR1 : fonctions PURES testables `node --test` (`validerHistoriqueChat_`, `coutChatJour_`) +
boucle Tool Use mockée (exécute l'outil, rend un `tool_result` par `tool_use`, renvoie le texte) +
plafond quotidien à échec fermé (aucun appel LLM au-delà) + outils de lecture bornés (`test/chat-assistant.test.js`).
Surface verrouillée (`test/surface-moteur.test.js` : `appelAnthropicChat_`/`appelAnthropicMessages_`
appelés en travers des modules). Revue flotte (sécurité + code + coût LLM) avant merge — verdicts et
correctifs :

- **security-auditor 🟢** : lecture seule réelle, injection Drive échappée (`\`+`'`, `trashed=false`
  figé), budget échec fermé. Deux extensions de surface écrites explicitement ci-dessus (temp OCR de
  `lire_fichier` ; exposition délibérée du contenu sensible à la demande).
- **llm-cost 🟠 → corrigé** : `CHAT_COUT_JOUR_MAX` 0,50 → 0,33 (garantit < 10 $/mois même saturé).
  Suivi : prompt caching (plus gros levier) après vérif doc Anthropic.
- **code-reviewer 🟠 ×2 → corrigés** : (1) **garde-temps** de la boucle (`CHAT_BUDGET_MS` 4 min) —
  le compte de tours ne bornait pas le TEMPS, un enchaînement d'OCR pouvait frôler le mur 6 min de
  doPost ; (2) le tour final **garde `tools`** et impose `tool_choice:{type:'none'}` (retirer `tools`
  alors que l'historique porte des `tool_use`/`tool_result` risquait un 400). 🟡 traités aussi :
  alternance stricte validée dans `validerHistoriqueChat_`, `refusal`/`max_tokens` journalisés,
  tests des chemins limites (multi tool_use, tour forcé, bloc non exploitable).

**PR2 — revue flotte** :
- **security-auditor 🟢** (7/7 §2) : aucune suppression, zone 04 jamais détachée (source ET cible,
  multi-parents inclus), chat ne contourne pas la validation de Marc, injection d'ID gérée (échec-fermé
  à l'application), convergence correcte, ADR-0007 respecté. Durcissement appliqué : rejet d'une source
  qui est un DOSSIER (MIME) + strip du séparateur `→` dans le parser.
- **code-reviewer 🟠 → corrigé** : `creer` refusait un parent `intouchable` (l'exemple du prompt « crée
  dans Véhicule » revenait `refusé`) → assouplissement ci-dessus. 🟡 notés : fenêtre de course réorg
  minuscule et PRÉ-EXISTANTE (commentaire honnêtifié) ; garde cible `_…` par nom (identique à l'existant).
- **structure-keeper 🟢 CONFORME** (4 axes) : onglet Réorg cohérent, séparation propre fichier↔dossier,
  structure protégée respectée, convergence conforme. Note appliquée : commentaire près de `Intake.gs`
  expliquant que l'intake filtre `drive|` (pas `epingle|`) VOLONTAIREMENT (un re-dépôt manuel doit se
  re-trier ; un skip y coincerait le fichier à vie).
