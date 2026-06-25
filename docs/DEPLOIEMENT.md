# Déploiement DriveAI — Phase 1, étape par étape

> Comment faire tourner le moteur (`src/`) dans ton compte Google. ~20 min la première fois.
> Tenu à jour à chaque évolution du moteur.

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

### 7. Installer le déclencheur 15 min
Dans l'éditeur, sélectionne la fonction **`installerTrigger`** dans la barre d'outils → **Exécuter**.
- Google affiche un écran de **consentement** listant les autorisations (Gmail lecture seule,
  Drive, requêtes externes, Sheets, envoi de mail, gestion des déclencheurs). **Autorise.**
- Vérifie : icône **Déclencheurs** (réveil) → un déclencheur `tickDriveAI` toutes les 15 min.

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

> Astuce : pour ne pas attendre 15 min, exécute **`tickDriveAI`** à la main dans l'éditeur.

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

## Dépannage

| Symptôme | Cause probable | Fix |
|----------|----------------|-----|
| `Clé API absente…` | `DriveAI_ANTHROPIC_KEY` non définie | Propriétés du script (§6) |
| `ERREUR OCR : HTTP 403` / `ERREUR Drive : HTTP 403` | API Drive du projet désactivée | panneau **Services** (＋) → ajoute **Drive API** une fois (§5) |
| `HTTP 401` dans `Journal` | clé Anthropic invalide/révoquée | mets la nouvelle clé |
| Rien ne se range | pas de PJ récente, ou tout part en revue | vérifie `Journal`/`Revue` ; baisse `SEUIL_CONFIANCE` après observation |
| OCR vide sur un PDF | PDF non textuel + OCR Drive limité | normal ; le LLM classe sur les métadonnées |
| Exécution coupée à ~6 min | volume élevé | normal : le reste est repris au tick suivant (garde-temps) |

---

## Après le déploiement

- **Mesurer le coût** (`P1-09`) : observe l'usage Anthropic sur quelques jours, extrapole au mois,
  confirme < 10 $/mois (estimé ~1–3 $/mois à volume perso).
- **Calibrer** `SEUIL_CONFIANCE` (0.80 au départ) dans `src/Config.gs` selon le taux de revue.
- Quand la Phase 1 est validée → **Phase 2** (`/phase 2`).
