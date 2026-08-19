# ADR-0042 — MCP DriveAI : connecteur claude.ai (recherche, état, réorg, intentions)

- **Statut** : accepté (demande Marc 2026-08-19 : « je veux un mcp », périmètre choisi
  explicitement : recherche & lecture, état du moteur **avec avancement par mission**,
  **dernières erreurs**, **checkup de boîte mail**, propositions de réorg, ajout aux intentions).
- **Référence** : le MCP FinanceAI (même écosystème, en prod) — on copie son patron d'AUTH,
  pas son hébergement.

## 1. Décision

Un serveur **MCP** (Model Context Protocol) expose DriveAI comme **connecteur custom claude.ai**,
pour interroger les documents et le moteur depuis n'importe quelle conversation Claude.

- **Hébergement : le Vercel EXISTANT** (`api/mcp/*`, servi sur `drive.hubperso.com`) — pas de
  Cloud Run : contrairement à FinanceAI (moteur de projection embarqué + état Drive), le MCP
  DriveAI est une **passerelle fine** vers le moteur Apps Script ; il est SANS ÉTAT par nature,
  donc compatible serverless. Zéro nouvelle infra, déploiement déjà automatisé.
- **Protocole : JSON-RPC MCP « streamable HTTP » écrit à la main** (méthodes `initialize`,
  `tools/list`, `tools/call`, notifications ignorées, GET → 405) — PAS de dépendance
  `@modelcontextprotocol/sdk` : `api/` est **zéro dépendance npm par construction** (§6 bis) et le
  sous-ensemble nécessaire tient en quelques fonctions PURES testées (vitest, côté `app/test`).
  Mode STATELESS (pas d'ID de session) : chaque `tools/call` est indépendant — exactement ce que
  les outils font (un POST vers le moteur, une réponse).
- **Auth : OAuth 2.1 SANS ÉTAT, copié du patron FinanceAI** (`mcp/auth/oauthProvider.ts`, vérifié
  en prod chez Marc) : l'UI des connecteurs custom claude.ai n'offre QUE OAuth. Tokens/codes =
  JSON signé HMAC-SHA256 (`MCP_SIGNING_KEY`, env Vercel) — aucune base ; DCR sans stockage
  (client_secret = HMAC(client_id)) ; la VRAIE porte = **clé d'accès mono-utilisateur**
  (`MCP_ACCESS_KEY`) saisie une fois sur `/api/mcp/authorize` (comparaison constante) ; PKCE S256
  obligatoire ; `redirect_uri` sur ALLOWLIST (claude.ai/claude.com + loopback) et lié au code.
  Module PUR inliné (`api/_mcpOauth.ts`), horloge injectable, testé aux bornes.

## 2. Outils exposés (v1) et chemins moteur

| Outil MCP | Chemin moteur | Garde |
|---|---|---|
| `question_documents` | `/exec action=chat-assistant` (Tool Use existant : cherche, lit, répond) | budget chat $/jour existant |
| `rechercher_documents` | NOUVELLE action `mcp-recherche` → `rechercheDriveChat_` (nom puis contenu) | `CHAT_RECHERCHE_MAX` |
| `lire_document` | NOUVELLE action `mcp-lire` → `lireFichierChat_` (texte borné) | `CHAT_LIRE_MAX_CARS`, `OCR_TAILLE_MAX` |
| `etat_moteur` | NOUVELLE action `mcp-etat` : Santé (lignes existantes) + **missions** (lignes Progression : statut, traités/base, dernière passe, fin estimée) + **dernières erreurs** Journal (N bornées) + **checkup mail** (télémétrie tri/jour, suspensions quota/config, panne LLM) | lecture seule, métadonnées seulement (ADR-0007) |
| `proposer_reorg` | NOUVELLE action `mcp-reorg` → `parserActionsChat_` (whitelist PURE) + lignes `proposé` onglet Réorg | Marc VALIDE dans l'app — le MCP n'applique JAMAIS |
| `creer_intention` | NOUVELLE action `mcp-intention` → `creerTache_`/`creerEvenement_` | jeton hubperso (ADR-0041) ; sans liaison → erreur claire |

Les nouvelles actions RÉUTILISENT les fonctions internes existantes (bornes comprises) — aucune
nouvelle capacité moteur, seulement de nouveaux POINTS D'ENTRÉE gardés.

## 3. Garde-fous

- **Secret DÉDIÉ serveur-à-serveur** : les nouvelles actions `/exec mcp-*` exigent
  `DriveAI_MCP_SECRET` (Script Property + env Vercel `MCP_ENGINE_SECRET`) — TROISIÈME secret de la
  doctrine WebApp.gs : jamais exposé à un navigateur (contrairement à `DriveAI_WEBAPP_SECRET`),
  jamais dans la CI (contrairement à `DriveAI_SYNC_SECRET`). Absent d'un côté ⇒ 503 fermé.
  `question_documents` passe par l'action `chat-assistant` EXISTANTE (secret webapp, budget $).
  Le secret voyage en QUERY STRING vers `/exec` (comme `WEBAPP_SECRET`/`SYNC_SECRET` de tout le
  codebase — la doctrine « jamais dans l'URL » vise le CONTENU, qui reste dans le corps) : il
  n'atterrit que dans les logs Apps Script/Vercel de Marc, jamais reporté vers `googleusercontent`
  (le 302 vise une URL générée par Apps Script, `fetch` n'émet pas de Referer).
- **§2 intégralement hérité** : aucune suppression possible (aucun chemin), zone `04` intouchée
  (les actions réutilisent les chemins gardés), réorg = PROPOSITION seulement (validation app),
  intentions = CRÉATION seulement (verrou surface Tasks/Calendar inchangé).
- **Confidentialité (révision assumée d'ADR-0007)** : `lire_document`/`question_documents` font
  TRANSITER du texte de document moteur → Vercel → claude.ai. Même famille que le transit
  Anthropic déjà assumé ; RIEN n'est stocké ni loggé côté Vercel (`no-store`, pas de log de
  contenu), et la porte est la clé d'accès de Marc. L'état serveur reste métadonnées seulement.
- **Anti-abus** : anti-rafale par action côté moteur (patron `antiRafalePilote_`), bornes par
  outil (héritées), rate-limit léger côté Vercel (patron FinanceAI `rateLimit.ts`), refus fermés.
- **Échec fermé partout** : env absente → 503 ; OAuth invalide → 401 ; action inconnue de la
  version /exec déployée → le champ-signal manque ⇒ erreur claire (piège 4 documenté), jamais un
  faux succès.

## 4. Livraison

- **PR1 (moteur)** : actions `mcp-*` dans WebApp.gs + vérification `DriveAI_MCP_SECRET`
  (comparaison constante), fonctions PURES testées, revue flotte (sécurité obligatoire).
- **PR2 (Vercel)** : `api/mcp/*` (JSON-RPC + outils), `api/_mcpOauth.ts` (OAuth pur),
  `api/mcp/authorize.ts` (page de clé d'accès), tests vitest, rate-limit.
- **PR3 (docs)** : `docs/MCP.md` — pas-à-pas Marc : générer les 2 clés (`MCP_SIGNING_KEY`,
  `MCP_ACCESS_KEY`) + poser `DriveAI_MCP_SECRET`/`MCP_ENGINE_SECRET`, créer le connecteur custom
  claude.ai (URL `https://drive.hubperso.com/api/mcp`), premier test.

## 5. Hors périmètre v1

Écriture de classement (reclasser un document depuis le chat), suppression (jamais), accès
multi-utilisateurs, exposition du contenu de la Sheet au serverless au-delà des actions gardées.
