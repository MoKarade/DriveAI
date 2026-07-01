# Guide utilisateur — DriveAI (pour Marc)

> Comment t'en servir au quotidien. DriveAI range ton Google Drive tout seul ; ce guide explique
> comment l'**alimenter**, le **corriger** et **retrouver** tes documents.
> (🔜 = fonction prévue, pas encore active — cf. `docs/ROADMAP.md`.)

## En bref
DriveAI lit les **pièces jointes de tes mails** et les fichiers que tu **déposes**, les analyse
(lecture du contenu + IA), les **renomme** proprement et les **range** au bon endroit — **sans jamais
rien supprimer**.

## Déposer un document
- **Glisse-le dans le dossier « 00 · À trier »** de ton Drive → traité au prochain passage (≤ ~10 min).
- **Ou envoie-le en pièce jointe** par mail → détecté automatiquement (boîte en lecture seule).

## Où vont tes fichiers
- Dans les **domaines** (`01 · Administratif` … `08 · Perso`), sous l'**entité** (banque, école,
  employeur…), avec un **nom clair** (`AAAA-MM-JJ_Type_Émetteur`, adapté au type de doc 🔜).
- Les **doublons** → dossier **`_Doublons`** (jamais supprimés — tu le vides d'un coup quand tu veux).
- Le **code / CAO / médias bruts** → **`_Technique`** 🔜 (pour ne pas polluer tes domaines).
- Les documents **sensibles** (immigration, fiscal) sont **classés** comme le reste (décision 2026-07-01),
  mais jamais supprimés ni détachés de `04 · Immigration`.

## Corriger une erreur 🔜
- Chaque semaine, un **mail** te liste les cas incertains (émetteur/date « Inconnu ») + les **nouvelles
  entités** à valider.
- **Un clic** ouvre un **mini-formulaire** : tu choisis le bon dossier/entité → DriveAI applique
  **et retient** pour la prochaine fois (il apprend de tes corrections).

## Retrouver un document
Quatre façons, toutes soignées : **navigation** dans l'arbo · **nom** de fichier · **date** · **émetteur**.

## Suivre l'activité
- **Résumé hebdomadaire** par mail : ce qui a été rangé, le coût du mois, 🔜 l'état de santé du système.
- Onglet **`Progression`** de la Sheet : avancement d'un grand rangement en cours.

## Si quelque chose cloche
- En général : **rien à faire**, ça reprend tout seul (même après le quota quotidien).
- Au pire, tu reçois un **mail d'alerte** avec le geste exact (souvent : un clic sur `installerTrigger`).
  Détail technique : `docs/RUNBOOK.md`.
