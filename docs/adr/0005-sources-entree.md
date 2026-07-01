# ADR-0005 — Sources d'entrée

- **Statut** : Accepté — **à implémenter** (roadmap #7)
- **Décideurs** : Marc, Claude · **Source** : brainstorm 2026-07-01, axe « Sources »

## Contexte

DriveAI avale aujourd'hui **2 sources** : pièces jointes **Gmail** (lecture seule, fenêtre 30 j) et
**dépôt manuel** dans `00 · À trier`. Quelles sources ajouter ?

## Décision

**Une seule nouvelle source : les fichiers PARTAGÉS avec Marc sur Drive.**

- **Traitement automatique** des partages **récents** (fenêtre glissante, comme Gmail).
- Un fichier partagé **n'appartient pas** à Marc → DriveAI en fait une **COPIE** dans son arborescence
  (comme les PJ Gmail) ; l'original reste chez la personne.

### Garde-fous (obligatoires, vu le choix « auto »)
- **Type « document » seulement** : PDF / Office / images. Ignorer les gros médias (vidéo, audio) et,
  par défaut, les fichiers Google natifs collaboratifs (Docs/Sheets de travail) — anti-bruit + anti-storage.
- **Idempotence** : clé `shared|fileId` dans l'Index → jamais copié deux fois.
- **Dédup** : si le contenu est déjà classé → `_Doublons` (fast-path P1-20).
- **Borné par run** (plafond) + **storage-aware** (le compte gratuit = 15 Go partagés).
- La **boucle de correction** hebdo (ADR-0003) rattrape les erreurs.

## Alternatives écartées
- **Photos du téléphone** — ambiguïté « photo de document » vs « photo perso » trop risquée (Marc : non).
- **Scans** — pas de scan régulier chez Marc.
- **Autres boîtes mail** — non retenu ; au besoin, une simple **redirection** vers la boîte principale
  suffit (Apps Script tourne dans un seul compte).

## Conséquences
- Nouveau collecteur `Partages.gs` (ou extension d'`Intake.gs`) : recherche Drive `sharedWithMe`,
  filtre type + récence, copie dans `00 · À trier` (ou direct dans le pipeline).
- Impact **stockage** à surveiller (copies). Aucun nouveau scope OAuth (le scope `drive` couvre déjà
  la lecture des fichiers partagés).
