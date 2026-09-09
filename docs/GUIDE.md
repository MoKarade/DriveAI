# Guide utilisateur — DriveAI (pour Marc)

> DriveAI range ton Google Drive tout seul et trie tes mails. Ce guide dit comment l'alimenter,
> comment le corriger, et ce que fait chaque écran de l'app (**https://drive.hubperso.com**).
> App v7 (2026-09-09) : quatre écrans, une action par ligne, pas de blabla.

## En bref
Les **pièces jointes de tes mails** et les fichiers que tu **déposes** sont lus, renommés
(`AAAA-MM-JJ_Type_Émetteur`) et rangés dans le bon domaine — **sans jamais rien supprimer**.
Tes mails sont triés (libellés) et les fils lus sont archivés ; tes rendez-vous et tâches détectés
dans les mails sont créés dans Google Agenda / Tasks.

## Déposer un document
- Glisse-le dans **`00 · À trier`** de ton Drive → traité au passage suivant.
- Ou envoie-le en pièce jointe par mail → détecté tout seul.

## Où vont tes fichiers
- Dans les **domaines** (`01 · Administratif` … `09 · Voyages`), sous l'**entité** (banque, école,
  employeur…), avec un **nom clair**.
- Les **doublons** → `_Doublons` (jamais supprimés). Le code → `_Technique`, les médias → `_Médias`.
- `04 · Immigration` : rangé comme le reste, **jamais sorti** de son dossier.

## L'app : quatre écrans et un engrenage
| Écran | Ce que tu y fais |
|---|---|
| **Aujourd'hui** | La liste **À faire** — chaque ligne, un bouton : mail suspect → *Pas suspect* ; document à vérifier → s'ouvre dans Drive ; mail ⏰ à traiter → s'ouvre dans Gmail, *Fait* quand c'est réglé ; tâche du jour → *Fait*. Puis **Ma journée** (s'il y a un rendez-vous) et les **derniers classements**. |
| **Agenda** | Sur téléphone : la **liste** de la semaine (un point sous les jours qui ont quelque chose) ; *Grille* d'un tap. Sur PC : la semaine, ouverte à 7 h. **+** crée une tâche ou un rendez-vous ; les puces filtrent tes agendas. Une tâche cochée disparaît. |
| **Documents** | **Un champ** : nom ou contenu d'un fichier. **IA** pour poser une question (« les factures Hydro de 2025 »). Dossiers et fichiers en liste ; **+** crée un dossier ; **✥** déplace un fichier (ou glisse-le sur un dossier) ; **✨** demande à l'IA d'analyser le dossier. |
| **Assistant** | Écris ce que tu veux (« range les factures Hydro », « donne mon adresse de NAS »). Les propositions arrivent en **cartes** : *Valider* ou *Écarter* — rien n'est appliqué sans toi. |
| **Réglages** (engrenage) | L'état du moteur, trois chiffres (documents classés, mails triés, coût du mois), la fréquence des passages, la langue, la synchro, le retour au hub, la déconnexion. « Avancé » replié : campagnes en cours, quotas, erreurs des 7 derniers jours. |

Ce que l'app **ne fait jamais** : supprimer un fichier ou un mail, sortir un document de
`04 · Immigration`, appliquer une réorganisation sans ta validation. Seule exception : un **dossier
devenu vide** peut être mis à la corbeille Drive (récupérable 30 jours) — par toi, dans l'Assistant.

## Corriger une erreur de classement
Le formulaire [DriveAI — Corriger un classement](https://docs.google.com/forms/d/1gIftqqRwRs2XslhKbbmNMUTdFEqJ1AMB2H6Q0ahnc8A/viewform) :
tu nommes l'émetteur et le bon domaine → les prochains documents de cet émetteur seront bien classés.
Ou déplace le fichier toi-même (Drive ou écran Documents) : une fois le grand rangement terminé
(Réglages → Avancé), DriveAI ne le re-déplace pas.

## Si quelque chose cloche
La pastille en haut (téléphone) ou en bas du rail (PC) : vert = moteur en marche, ambre = en retard,
rouge = silencieux. Le détail est dans **Réglages → Avancé**. En général ça reprend tout seul ;
sinon `docs/RUNBOOK.md`.
