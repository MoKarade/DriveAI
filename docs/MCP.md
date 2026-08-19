# MCP.md — Connecter Claude à DriveAI (connecteur MCP)

> **Ce que ça fait** (ADR-0042) : ajoute DriveAI comme **connecteur** dans n'importe quelle
> conversation claude.ai. Tu peux alors demander à Claude — depuis le web, l'app, le téléphone —
> d'interroger tes documents, de voir l'état du moteur, de proposer du rangement, ou d'ajouter une
> tâche/un événement. Servi par le **même Vercel que l'app** (`drive.hubperso.com`) — pas de
> serveur en plus.

## Ce que Claude peut faire (6 outils)

| Outil | Exemple |
|---|---|
| **etat_moteur** | « où en est le rangement de DriveAI ? », « des erreurs récentes ? », « le tri des mails tourne ? » |
| **rechercher_documents** | « retrouve mon bail », « mes factures Hydro » (par nom ou par contenu) |
| **lire_document** | « que dit ce document ? » (après une recherche) |
| **question_documents** | « combien j'ai payé Hydro le mois dernier ? » (Claude cherche, lit et répond) |
| **proposer_reorg** | « range ces fichiers dans Véhicule » → **proposition** que tu valides dans l'app |
| **creer_intention** | « ajoute “payer le loyer” à mes tâches pour vendredi » |

**Garde-fous** : jamais de suppression, jamais de déplacement direct (la réorg est **proposée**,
tu valides dans l'app), jamais de sortie de `04 · Immigration`. La création d'intentions exige la
liaison hubperso (`docs/HUBPERSO.md`).

## Mise en service (une fois, ~10 min)

### Étape 1 — Générer les 2 clés (variables d'environnement Vercel)

Génère **deux secrets ALÉATOIRES** — chacun avec `openssl rand -base64 32` (jamais une phrase
choisie de tête) :

| Variable Vercel | Rôle |
|---|---|
| `MCP_SIGNING_KEY` | signe les jetons OAuth (≥ 32 caractères) — la rotation de CETTE clé est le kill-switch d'incident |
| `MCP_ACCESS_KEY` | **ta** clé d'accès (≥ 16 caractères) : c'est ce que tu saisiras à la connexion du connecteur |

> ⚠️ **`MCP_ACCESS_KEY` DOIT être aléatoire haute-entropie** (une sortie d'`openssl rand`), pas
> une passphrase mémorisable. C'est la SEULE vraie barrière contre la devinette : le limiteur
> d'essais du serveur est un filet faible sur Vercel (l'hébergement lance plusieurs instances en
> parallèle, chacune avec son propre compteur). Une vraie clé aléatoire de 16+ caractères est
> indevinable ; une passphrase courte, non. Garde-la dans ton gestionnaire de mots de passe.

### Étape 2 — Poser le secret serveur-à-serveur (2 endroits, MÊME valeur)

Ce 3ᵉ secret garde les actions du moteur ; il ne doit JAMAIS être exposé à un navigateur. Génère
une valeur, et pose-la aux **deux** endroits :

- **Vercel** (variable d'environnement) : `MCP_ENGINE_SECRET`
- **Apps Script** (Script Property, éditeur → ⚙️ Paramètres → Propriétés du script) :
  `DriveAI_MCP_SECRET` — **exactement la même valeur**.

(Rappel : `WEBAPP_URL` et `WEBAPP_SECRET` existent déjà côté Vercel — l'outil `question_documents`
réutilise `WEBAPP_SECRET`.)

### Étape 3 — Redéployer

Un redéploiement Vercel prend les nouvelles variables. Tant que l'une des 5 manque, les endpoints
MCP répondent **503 « mcp disabled »** (échec fermé — jamais un serveur à moitié ouvert).

### Étape 4 — Ajouter le connecteur dans claude.ai

1. claude.ai → **Réglages → Connecteurs → Ajouter un connecteur personnalisé**.
2. URL : **`https://drive.hubperso.com/api/mcp`**.
3. Claude lance le flux d'autorisation : une page DriveAI s'ouvre et demande ta **clé d'accès**
   (`MCP_ACCESS_KEY` de l'étape 1). Saisis-la → « Autoriser ».
4. Le connecteur apparaît. Teste : « **quel est l'état du moteur DriveAI ?** »

## Sécurité (comment c'est gardé)

- **OAuth 2.1** (le seul mode qu'accepte claude.ai) : jetons signés HMAC (sans base de données),
  PKCE obligatoire, redirection restreinte à claude.ai. La **vraie porte** est ta clé d'accès,
  comparée en temps constant, avec un **limiteur d'échecs** (8 essais / 15 min) contre le brute
  force. Même conception que le connecteur FinanceAI (éprouvé en production).
- **Le connecteur peut lire le TEXTE de N'IMPORTE QUEL document**, y compris `04 · Immigration` et
  tes documents fiscaux/sensibles (via `lire_document` / `question_documents`). Ce texte **transite**
  Vercel → Claude — comme il transite déjà vers l'API Anthropic pour le classement (ADR-0007).
  **Rien n'est stocké ni journalisé** côté Vercel : le texte passe, c'est tout. À garder en tête —
  c'est un flux voulu, vers TON propre Claude, gardé par ta clé d'accès ; mais si tu ne veux pas
  qu'un document sensible parte dans une conversation, ne le demande pas au connecteur.
- **Restreins les variables `MCP_*` à l'environnement _Production_** dans le dashboard Vercel : sinon
  un jeton émis via une URL de _preview_ (déploiement de branche) reste valable en production
  (même clé de signature). C'est sans escalade — émettre un jeton exige quand même ta clé d'accès —
  mais scoper sur Production ferme proprement le sujet.
- **En cas de doute** (accès suspect dans les logs Vercel) : **régénère `MCP_SIGNING_KEY`** et
  redéploie — tous les jetons émis deviennent invalides instantanément, il suffit de re-connecter
  le connecteur.

## Dépannage

| Symptôme | Cause | Remède |
|---|---|---|
| « mcp disabled » (503) | une des 5 variables Vercel manque | Étapes 1-2, redéployer |
| Le test répond « accès moteur refusé… divergent » | `MCP_ENGINE_SECRET` (Vercel) ≠ `DriveAI_MCP_SECRET` (Apps Script) | Ré-aligner les deux valeurs |
| Le test répond « version /exec pas déployée » | le moteur n'a pas encore le code des actions MCP | Attendre le déploiement Apps Script (CI, ~2 min après merge) |
| creer_intention : « compte hubperso non lié » | liaison Tasks/Calendar pas faite | `docs/HUBPERSO.md` |
| « Trop de tentatives » à la connexion | 8 clés d'accès fausses en 15 min | Attendre la fenêtre, vérifier `MCP_ACCESS_KEY` |
