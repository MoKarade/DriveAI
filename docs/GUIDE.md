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
  employeur…), avec un **nom clair** (`AAAA-MM-JJ_Type_Émetteur`, adapté au type de doc).
- Les **doublons** → dossier **`_Doublons`** (jamais supprimés — tu le vides d'un coup quand tu veux).
- Le **code / CAO** → **`_Technique`** ; les **médias personnels** (photos/vidéos sans texte, exports Facebook…) → **`_Médias`**, sans analyse IA (rapide et gratuit) (pour ne pas polluer tes domaines).
- Les documents **sensibles** (immigration, fiscal) sont **classés** comme le reste (décision 2026-07-01),
  mais jamais supprimés ni détachés de `04 · Immigration`.

## Corriger une erreur
Deux chemins, DriveAI **retient** dans les deux cas (il apprend de tes corrections) :
- **Le formulaire** ([DriveAI — Corriger un classement](https://docs.google.com/forms/d/1gIftqqRwRs2XslhKbbmNMUTdFEqJ1AMB2H6Q0ahnc8A/viewform), lien aussi dans le résumé hebdo) :
  tu nommes l'émetteur + le bon domaine (et l'entité si tu veux) → les **prochains** documents de cet
  émetteur seront bien classés, et l'entité nommée est **validée** (son dossier se crée tout seul).
- **L'app web, onglet Corrections** (immédiat) : tu retrouves le document, tu donnes son bon nom/dossier →
  il est **déplacé sur-le-champ** (jamais supprimé) et la correction est apprise.

## L'app web (Phase 4)
Ton poste de pilotage, en 3 onglets (login Google, rien de public) :
- **Tableau de bord** — santé du moteur, coût du mois, activité récente, nombre de documents par domaine.
- **Corrections** — ① les **entités proposées** par DriveAI se valident **en 1 clic** (le dossier se crée
  au tick suivant et les prochains documents s'y rangent) ; ② **reclasser un document** mal rangé :
  recherche par nom → nouveau nom pré-rempli → destination = un **lien Drive collé tel quel** ou une
  entité validée dans la liste → appliqué immédiatement + appris.
- **Recherche** — filtres instantanés (nom, domaine, année du document, statut) sur tout le catalogue,
  chaque résultat ouvre le fichier dans Drive ; bouton « chercher dans le contenu » = la recherche
  plein-texte native de Drive (DriveAI ne stocke jamais le contenu de tes documents).

Garde-fous embarqués : l'app **ne peut rien supprimer** (verrouillé par test), ne touche jamais à
`04 · Immigration`, et journalise chaque geste. Mise en route (une fois, ~10 min) : `docs/DEPLOIEMENT.md`
§Phase 4 — importe le repo dans Vercel (zéro config, `vercel.json` fourni) + crée le Client ID OAuth.

## Retrouver un document
Quatre façons, toutes soignées : **navigation** dans l'arbo · **nom** de fichier · **date** · **émetteur** ·
et l'onglet **Recherche** de l'app web (filtres + plein texte).

## Suivre l'activité
- **Résumé hebdomadaire** par mail : ce qui a été rangé, le coût du mois, l'état de santé du système,
  **« 📌 À traiter »** (les mails importants de la semaine — question directe, échéance, courrier
  officiel — avec lien direct) et **« 🗓️ Actions & RDV détectés »** (chaque tâche/rendez-vous que le
  moteur a créé dans Tasks/Calendar, nommément). Ces deux listes sont aussi sur le tableau de bord
  de l'app web.
- Onglet **`Progression`** de la Sheet : avancement d'un grand rangement en cours.

## Si quelque chose cloche
- En général : **rien à faire**, ça reprend tout seul (même après le quota quotidien).
- Au pire, tu reçois un **mail d'alerte** avec le geste exact (souvent : un clic sur `installerTrigger`).
  Détail technique : `docs/RUNBOOK.md`.
