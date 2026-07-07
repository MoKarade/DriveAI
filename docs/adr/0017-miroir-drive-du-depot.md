# ADR-0017 — Miroir texte du dépôt vers Drive (accès de partout + NotebookLM)

- **Statut** : Accepté (demande Marc 2026-07-07 : « je veux avoir tout dans mon drive pour pas
  l'avoir sur le PC pour que je puisse y accéder de partout » + « utiliser NotebookLM qui va
  prendre les fichiers de mon drive »).
- **Décideurs** : Marc, Claude.
- **Ne révise AUCUN garde-fou** — nouvelle capacité additive, aucune modification du pipeline de
  classement, du routage, ou d'un garde-fou §2 existant.

## Contexte

Marc voulait initialement remplacer GitHub par Drive comme dépôt de travail — refusé (Drive n'a pas
de sémantique git : branches, PR, revue, CI/CD en dépendent entièrement ; voir échange en session).
Le vrai besoin, clarifié : (1) accéder au projet depuis n'importe quel appareil sans clone local —
déjà couvert par GitHub (web + mobile) ; (2) une copie dans **Drive spécifiquement**, parce que
**NotebookLM ingère ses sources depuis Drive**, pas depuis GitHub.

## Décision

Un **miroir en lecture** : GitHub reste l'unique dépôt de travail (git, CI, tests, déploiement). À
chaque merge sur `main`, une étape GitHub Actions (`sync-drive.yml`) envoie tous les fichiers texte
du dépôt à la web app Apps Script DÉJÀ déployée (`WebApp.doPost`, nouvelle action `sync-miroir`),
qui les écrit dans un dossier dédié du Drive de Marc (`_Miroir du dépôt`, hors domaines classés) —
chaque fichier renommé en `.txt` (lisible par NotebookLM quelle que soit l'extension d'origine).

**Réutilise l'existant, n'ajoute rien de lourd** :
- Web app déjà déployée (chantier #20, C21-03) → **zéro nouveau scope OAuth** → zéro re-consentement,
  zéro gel du moteur (leçon durable `oauthScopes`).
- `DriveApp` standard (comme tout le reste du moteur) → pas d'Advanced Drive Service à activer.

**Secret DÉDIÉ, jamais partagé** : `DriveAI_SYNC_SECRET` (Script Property) ≠ `DriveAI_WEBAPP_SECRET`
(celui de l'app, exposé côté navigateur PAR CONCEPTION — cf. `app/src/config.ts`, « la sécurité vient
du login Google »). Réutiliser le secret app pour cette action aurait rendu la clé d'écriture Drive
aussi faible que le secret déjà visible en clair dans le bundle JS servi au navigateur — inacceptable
pour un secret connu de GitHub Actions. Pire abus si `DriveAI_SYNC_SECRET` fuit : écrire des fichiers
texte dans UN dossier dédié — jamais lire/modifier/supprimer un document classé, jamais toucher à
l'Index/Journal/Entités/Corrections.

## Analyse de risques (garde-fous, intégrité)

- **§2.2 (aucune suppression)** : `ecrireFichierMiroir_` ne fait que créer/mettre à jour — **jamais**
  de suppression. Un fichier retiré du dépôt laisse une copie obsolète dans le miroir (limite
  ASSUMÉE, cohérente avec `_Doublons`/`_Technique` : nettoyage manuel occasionnel, jamais automatique).
- **§2.3 (moindre privilège)** : aucun scope ajouté. Le secret dédié limite le blast radius d'une
  fuite au dossier miroir seul (jamais les domaines classés, jamais l'état).
- **Vie privée (ADR-0007)** : le miroir expose le CODE et les DOCS du projet (déjà dans un repo
  GitHub que Marc contrôle) — jamais un document personnel classé, jamais le contenu de l'Index/
  Journal (qui ne portent déjà que des métadonnées).
- **Limite assumée (revue code)** : le filtre ne bloque que les formats manifestement BINAIRES — un
  fichier suivi par git et non explicitement exclu (ex. un `.env` qui aurait été committé par erreur)
  serait mirroré tel quel. Ce n'est pas une fuite NOUVELLE (s'il est dans git, il est déjà dans le
  repo GitHub que Marc contrôle) — mais un secret ne devrait de toute façon jamais être committé
  (règle §2.4 existante). Noté ici comme rappel, pas un garde-fou nouveau.
- **Contenu binaire** : filtré (images, polices, archives, PDF) — illisible converti en `.txt` de
  toute façon ; évite aussi de gonfler le miroir sans bénéfice pour NotebookLM.
- **Robustesse** : garde-temps par lot (`CONFIG.MIROIR_BUDGET_MS`), la boucle complète sur TOUT le
  dépôt vit côté GitHub Actions (plusieurs requêtes) — jamais une seule exécution qui parcourt tout
  le dépôt (cohérent avec le garde-temps du reste du moteur).

## Méthode de test

Fonctions PURES testées (`test/miroir.test.js`) : filtrage binaire/texte, nettoyage de chemin,
nommage `.txt`, segments de dossier, validation du secret dédié (Property absente/mauvaise valeur →
toujours refusé), parsing défensif du corps JSON. Ajoutées au contrat de surface
(`test/surface-moteur.test.js`).

## Conséquences

- Marc peut pointer NotebookLM sur `_Miroir du dépôt` et poser des questions sur le projet.
- Configuration UNIQUE côté Marc (~5 min, documentée `docs/DEPLOIEMENT.md`) : 1 Script Property +
  2 secrets GitHub. Tant qu'absents, le workflow réussit silencieusement sans rien faire (même
  patron que `deploy.yml` pour `CLASPRC_JSON`/`SCRIPT_ID`).
- GitHub reste la seule source de vérité pour le code — le miroir ne doit jamais être édité à la
  main dans Drive (il serait écrasé au prochain sync, sans avertissement — limite assumée, comme
  n'importe quel miroir en lecture).

## Réversibilité

Retirer le dispatch dans `auto-merge.yml` (et/ou supprimer `sync-drive.yml`) arrête toute nouvelle
synchronisation ; le dossier `_Miroir du dépôt` existant reste en l'état dans le Drive de Marc
(à supprimer manuellement s'il le souhaite — le moteur ne le fera jamais lui-même, §2).
