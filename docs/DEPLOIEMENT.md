# Déploiement DriveAI — Phase 1, étape par étape

> Comment faire tourner le moteur (`src/`) dans ton compte Google. ~20 min la première fois.
> Tenu à jour à chaque évolution du moteur.

---

## ⚡ Déploiement 100 % automatique (à configurer UNE fois, ~3 min)

> Objectif : **plus jamais de `clasp push` ni de fonction à lancer à la main.** Après ce réglage
> unique, chaque évolution mergée sur `main` est **déployée toute seule** chez toi (GitHub Action
> `clasp push`), et le moteur **rejoue automatiquement** les dépôts partis en revue quand la logique
> de classement change (`CONFIG.VERSION`). Le scan tourne déjà tout seul toutes les 10 min
> (`CONFIG.TICK_MINUTES` ; l'intervalle se ré-applique seul au déploiement, sans re-`installerTrigger`).

**Pourquoi une config manuelle unique ?** Déployer dans *ton* compte Google exige un identifiant que
toi seul peux générer — personne d'autre ne peut y accéder (c'est une protection). Tu le déposes une
fois dans GitHub (chiffré), et c'est fini.

1. **Génère l'identifiant clasp** (en local, une fois) :
   ```bash
   npm install -g @google/clasp
   clasp login          # autorise avec TON compte Google
   cat ~/.clasprc.json  # copie tout le contenu affiché
   ```
2. **Récupère l'ID du script** : ouvre `.clasp.json` (créé par `clasp create`/`clasp clone`) → champ
   `scriptId`. *(Ou dans l'éditeur Apps Script : Paramètres du projet → « ID ».)*
3. **Dépose-les comme secrets GitHub** : repo `DriveAI` → **Settings → Secrets and variables →
   Actions → New repository secret** :
   - `CLASPRC_JSON` = le contenu de `~/.clasprc.json` (étape 1) ;
   - `SCRIPT_ID` = le `scriptId` (étape 2).
4. **C'est tout.** À la prochaine PR mergée, l'Action **Deploy** pousse le code automatiquement.
   *(Tant que les secrets sont absents, l'Action ne fait rien et reste verte — aucun échec.)*

> ⚠️ Sécurité : `~/.clasprc.json` contient un jeton OAuth Google. Il vit **uniquement** dans les
> secrets GitHub (chiffrés), jamais dans le code. Pour révoquer : `clasp logout` + retire le secret.

Le reste de ce document (voies A/B manuelles) reste valable comme repli ou pour le tout premier
déploiement (création du projet Apps Script, clé Anthropic, trigger).

## Prérequis

- Ton compte Google (celui qui possède le Drive « Nouvelle structure 2026 »).
- Une **clé API Anthropic** (la *nouvelle* — l'ancienne, partagée en chat, est à révoquer).
- Pour la voie clasp : **Node.js** installé (`node -v`).

---

## Voie A — clasp (recommandée : synchronisée avec le repo)

### 1. Installer et connecter clasp
```bash
npm install -g @google/clasp
clasp login           # ouvre le navigateur → autorise avec TON compte Google
```

### 2. Activer l'API Apps Script (une fois)
Va sur **https://script.google.com/home/usersettings** et active **« Google Apps Script API »**.

### 3. Créer le projet Apps Script lié au repo
Depuis la racine du repo (qui contient `src/`) :
```bash
clasp create --type standalone --title "DriveAI" --rootDir src
```
- Cela crée le projet et un fichier `.clasp.json` (déjà gitignoré).
- ⚠️ Si clasp écrase `src/appsscript.json`, restaure le nôtre : `git checkout src/appsscript.json`.
  *(Alternative : copie `.clasp.json.example` → `.clasp.json`, mets le `scriptId` d'un projet créé à la main.)*

### 4. Pousser le code
```bash
clasp push        # téléverse src/*.gs + appsscript.json
```
Puis **ouvre l'éditeur** : copie-colle dans ton navigateur l'URL affichée par `clasp create`
(`https://script.google.com/d/<scriptId>/edit`). *(La commande `clasp open` n'existe plus en
clasp v3 ; selon ta version, `clasp open-script` peut aussi fonctionner.)*

### 5. (OCR) Rien à activer
L'OCR appelle l'API Drive **en REST via `UrlFetchApp`** (scope `drive` déjà accordé) — **aucun
service avancé à activer**. Si un jour le `Journal` montre des `ERREUR OCR : HTTP 403`, c'est que
l'API Drive du projet est désactivée : panneau **Services** (＋) → ajoute **Drive API** une fois.

### 6. Mettre la clé API (jamais dans le code)
Éditeur → **Paramètres du projet** (roue dentée) → **Propriétés du script** →
**Ajouter une propriété** :
- Nom : `DriveAI_ANTHROPIC_KEY`
- Valeur : *ta nouvelle clé Anthropic*

### 7. Installer le déclencheur (10 min)
Dans l'éditeur, sélectionne la fonction **`installerTrigger`** dans la barre d'outils → **Exécuter**.
- Google affiche un écran de **consentement** listant les autorisations (Gmail lecture seule,
  Drive, requêtes externes, Sheets, envoi de mail, gestion des déclencheurs). **Autorise.**
- Vérifie : icône **Déclencheurs** (réveil) → un déclencheur `tickDriveAI` toutes les 10 min.
- *(La fréquence vit dans `CONFIG.TICK_MINUTES` ; si tu la changes plus tard, le moteur réinstalle
  le déclencheur tout seul au déploiement suivant — pas besoin de relancer `installerTrigger`.)*

### 8. C'est en route
Au premier passage, DriveAI crée la Google Sheet **« DriveAI — État »** (son ID est stocké dans
la propriété `DriveAI_SHEET_ID`). Onglets : `Entités`, `Index`, `Journal`, `Revue`.

---

## Voie B — sans clasp (copier-coller)

1. **https://script.google.com** → **Nouveau projet** → renomme-le « DriveAI ».
2. Paramètres du projet → coche **« Afficher le fichier manifeste appsscript.json dans l'éditeur »**.
3. Pour chaque fichier de `src/` (`Config.gs`, `Gmail.gs`, `Ocr.gs`, `Llm.gs`, `Router.gs`,
   `Journal.gs`, `Main.gs`), crée un fichier de même nom et **colle le contenu**.
4. Ouvre `appsscript.json` dans l'éditeur et colle le contenu de `src/appsscript.json`.
5. Services (＋) → ajoute **Drive API** (v2).
6. Propriétés du script → `DriveAI_ANTHROPIC_KEY` = ta clé.
7. Exécute **`installerTrigger`** → autorise les scopes.

---

## Tester (recette de la DoD Phase 1)

> Astuce : pour ne pas attendre 10 min, exécute **`tickDriveAI`** à la main dans l'éditeur.

1. **Cas nominal** — envoie-toi un mail avec une **PJ PDF** (ex. une facture Hydro-Québec).
   Lance `tickDriveAI`. Attendu : un fichier `AAAA-MM-JJ_Facture_Hydro-Quebec.pdf` apparaît dans
   `02 · Finances/<année>` (ou le bon domaine), et une ligne « classé » dans l'onglet `Journal`.
2. **Cas ambigu** — une PJ peu lisible part dans **`00 · À vérifier`** avec un nom
   `[REVUE] confiance 0.xx — … — …` ; une ligne apparaît dans l'onglet `Revue`.
3. **Zone protégée** — un courrier d'immigration (ex. IRCC) va **toujours** dans
   `00 · À vérifier`, jamais rangé auto.
4. **Idempotence** — relance `tickDriveAI` : aucune PJ déjà traitée n'est re-déposée (vérifie
   l'onglet `Index`).
5. **Échec** — coupe la clé API (mauvaise valeur), relance : tu reçois un **mail d'alerte** et une
   ligne `ERREUR` dans `Journal`. Remets la bonne clé.

---

## Phase 2 — dépôt manuel & référentiel d'entités

> Déployée par le même `git pull && clasp push`. **Aucun nouveau scope** à autoriser.

### Dépôt manuel (`00 · À trier`)
Glisse n'importe quel fichier dans le dossier **`00 · À trier`**. Au tick suivant (ou via
`tickDriveAI`), il est analysé comme une PJ Gmail puis **déplacé** (jamais copié, jamais effacé)
vers son dossier de destination — ou vers `00 · À vérifier` s'il est ambigu/sensible.
*(Les fichiers Google natifs — Docs/Sheets déposés — sont laissés en place : déposer des PDF/images.)*

### Référentiel d'entités (onglet `Entités`)
Pour ranger au niveau **entité** (un dossier par logement, banque, diplôme…), DriveAI s'appuie sur
l'onglet **`Entités`** (colonnes auto-créées : `Entité | Domaine | Catégorie | Type | Statut |
Dossier ID | Ajoutée le`).

1. Quand DriveAI rencontre une **entité inconnue**, il ajoute une ligne **pré-remplie** avec
   `Statut = en_attente` et envoie le document en revue (aucun dossier créé).
2. Pour **valider** : passe le `Statut` de la ligne à **`validée`** (corrige le nom/type si besoin).
   Types reconnus pour les sous-dossiers fixes : `Logement`, `Véhicule`, `Compte financier`, `Diplôme`.
3. Au tick suivant, DriveAI **crée le dossier d'entité** + ses sous-dossiers fixes et y range les
   documents de cette entité. (Pour re-router des documents déjà partis en revue, relance
   `rejouerLaRevue`.)

### Doublons & multi-entités
- Un fichier dont le **contenu** est déjà présent (même empreinte) est **signalé** en revue
  (`[REVUE] doublon (déjà présent) …`), **jamais effacé**.
- Un document concernant **plusieurs entités connues** est rangé une fois (entité primaire) avec un
  **raccourci Drive** dans les autres (jamais de copie).

---

## Phase 3 — tâches & agenda (remplace l'agent mail externe de Marc)

> Déployée par le même `git pull && clasp push` automatique. **Nouveaux scopes** (Tasks +
> Calendar) → **une seule ré-autorisation manuelle** est nécessaire (voir ci-dessous), c'est la
> SEULE action que Marc doit faire pour cette phase.

### Ce que ça fait
DriveAI scanne désormais **tous les mails récents** (pas seulement ceux avec pièce jointe) pour
détecter des **actions à faire** (« payer avant le 15 », « renvoyer le formulaire ») et des
**rendez-vous datés** (« RDV le 3 juillet à 14h »), et crée automatiquement :
- une **tâche Google Tasks** (liste par défaut) pour une action/échéance ;
- un **événement Google Calendar** (agenda principal) pour un rendez-vous avec date ET heure.

Création **100 % automatique**, zéro validation. Pré-filtre à 3 étages (mots-clés gratuits → zone
protégée gratuite → mini-check Haiku peu coûteux) avant toute extraction complète, pour rester
largement sous le budget de 10 $/mois (~1-4 $/mois estimé pour ce flux). Les mails immigration/
fiscaux ne génèrent **jamais** de tâche/événement (garde-fou §1, indépendant du LLM) — ils restent
gérés par le classement documentaire existant.

### ⚠️ Action manuelle unique : ré-autoriser les nouveaux scopes

L'ajout des scopes `tasks` et `calendar.events` au manifeste (`appsscript.json`) signifie que le
**déclencheur existant** (`tickDriveAI`, toutes les 10 min) va se mettre à échouer avec une erreur
d'autorisation dès que le nouveau code est déployé — Apps Script exige un consentement explicite
pour toute nouvelle permission, et un déclencheur automatique ne peut pas le demander tout seul.

**Pour réautoriser (30 secondes, une seule fois)** :
1. Ouvre l'éditeur Apps Script du projet DriveAI.
2. Dans la barre d'outils, sélectionne n'importe quelle fonction (ex. `installerTrigger`) → **Exécuter**.
3. Google affiche l'écran de consentement avec les **2 nouvelles autorisations** (Tasks, Calendar) en
   plus des précédentes. **Autorise.**
4. C'est tout — le déclencheur existant reprend normalement au tick suivant, plus besoin de
   relancer quoi que ce soit après cette étape unique.

*(Tant que cette ré-autorisation n'est pas faite, le `Journal` affichera des erreurs sur le flux
« Intentions » uniquement — le classement documentaire des Phases 1-2, lui, continue de tourner
normalement : ce nouveau scope n'affecte pas les permissions déjà accordées.)*

### Tester
1. Envoie-toi un mail avec un objet du type « Rendez-vous chez le dentiste le 15 juillet à 14h ».
   Lance `tickDriveAI`. Attendu : un événement apparaît dans Google Calendar (agenda principal).
2. Envoie-toi un mail « Penser à renouveler le passeport avant fin août » — **attendu : RIEN n'est
   créé** (zone protégée, mot-clé « passeport ») — vérifie une ligne `intention-zone-protegee`
   dans l'onglet `Index`.
3. Envoie-toi un mail anodin sans action (« Voici les photos des vacances ») — attendu : aucune
   tâche/événement créé (`intention-aucune` dans `Index`).
4. Relance `tickDriveAI` : aucun doublon de tâche/événement (vérifie Tasks/Calendar directement).

---

## Dépannage

| Symptôme | Cause probable | Fix |
|----------|----------------|-----|
| `Clé API absente…` | `DriveAI_ANTHROPIC_KEY` non définie | Propriétés du script (§6) |
| `ERREUR OCR : HTTP 403` / `ERREUR Drive : HTTP 403` | API Drive du projet désactivée | panneau **Services** (＋) → ajoute **Drive API** une fois (§5) |
| `HTTP 401` dans `Journal` | clé Anthropic invalide/révoquée | mets la nouvelle clé |
| Rien ne se range | pas de PJ récente, ou tout part en revue | vérifie `Journal`/`Revue` ; baisse `SEUIL_CONFIANCE` après observation |
| OCR vide sur un PDF | PDF non textuel + OCR Drive limité | normal ; le LLM classe sur les métadonnées |
| Exécution coupée à ~6 min | volume élevé | normal : le reste est repris au tick suivant (garde-temps) |
| Doc « mis en quarantaine » (mail d'alerte) | échec LLM/placement 3 fois de suite (souvent une panne transitoire) | il n'est plus re-tenté pour ne pas tourner en boucle ; pour le relancer, exécute **`dequarantaine`** dans l'éditeur (retire les quarantaines + relance le pipeline) |

---

## Après le déploiement

- **Mesurer le coût** (`P1-09`) : observe l'usage Anthropic sur quelques jours, extrapole au mois,
  confirme < 10 $/mois (estimé ~1–3 $/mois à volume perso).
- **Calibrer** `SEUIL_CONFIANCE` (0.80 au départ) dans `src/Config.gs` selon le taux de revue.
- Quand la Phase 1 est validée → **Phase 2** (`/phase 2`).
