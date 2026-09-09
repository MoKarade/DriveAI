# ADR-0051 — App v7 : le téléphone d'abord, une colonne, zéro phrase inutile

- **Statut** : accepté (2026-09-09) — en construction (C28-82, six PR)
- **Décideurs** : Marc (demande + quatre réponses sur maquettes, 2026-09-09), Claude
- **Remplace** visuellement : ADR-0013 (v3 « Salle des machines »), ADR-0019 (v4), C28-41 (v6).
  **Conserve** intégralement le socle technique et ses garde-fous : Vite/React/TS, BFF Vercel,
  lecture de la Sheet depuis le navigateur (ADR-0007), `corbeille.ts` seul autorisé à corbeiller
  (ADR-0014, tripwire CI), aucune permission nouvelle, aucune suppression nouvelle.

## 1. Problème

Marc, 2026-09-09 : « l'interface est pas du tout intuitive, trop de texte, trop de déchets,
trop moche, pas assez simple, pas assez beau — je veux une refonte visuelle et utilitaire,
parfaite pour téléphone et pour PC ».

Constaté sur captures réelles (mode mock, 390 px et 1 280 px) — pas de mémoire :

- **Le téléphone est un PC rétréci.** L'heure de synchro s'empile sur trois lignes, l'avatar sort
  de l'écran, le champ de recherche se réduit à « Rec », les noms de dossiers se cassent sur trois
  lignes. La CI ne photographiait qu'à 1 280 px : personne ne l'a vu.
- **Du texte partout.** 14 paragraphes d'explication (≥ 90 caractères), un pied de page
  « Garde-fous actifs… » sur chaque écran, une phrase sous chaque liste — 3 949 caractères de
  libellés pour cinq écrans.
- **Des chiffres qui n'aident pas.** « — $ / 10 $ » sur l'accueil, le coût LLM affiché deux fois,
  une page Moteur de huit blocs et trois jauges.
- **L'agenda s'ouvre à minuit** sur téléphone : huit heures vides avant le premier rendez-vous.
- **Une barre latérale qui ne sert qu'à l'Agenda** (mini-calendrier, « Mes agendas ») occupe
  240 px sur tous les écrans du PC.
- **Cinq icônes, quatre styles** (◐ ▦ ▤ 💬 ⚙), un thème sombre unique.

## 2. Décisions de Marc (2026-09-09, questions groupées sur maquettes)

| Question | Réponse |
|---|---|
| Ambiance | **B · « Nuit »** — sombre, nettoyé (pas la recommandation A « Papier » clair) |
| PC | **Une colonne centrée, rail à gauche** — la même app que le téléphone, plus large |
| Accueil | **Comme aujourd'hui, en plus propre** — alertes, journée, coût, classements |
| Page Moteur | **Réglages : trois chiffres + « Avancé » replié** — engrenage, jamais devant |

Hypothèses prises par défaut (annoncées, non contestées) : Atkinson Hyperlegible + IBM Plex
Mono ; un jeu d'icônes SVG au trait, plus d'emoji dans l'interface ; un seul accent (bleu),
rouge/ambre/vert réservés aux états ; FR/EN conservés ; barre latérale, mini-calendrier, lien
« ← Hub », horloge de synchro et pied de page retirés de la coquille (leur contenu vit dans
Réglages ou dans l'Agenda) ; PWA conservée ; animations courtes, aucune sous
`prefers-reduced-motion`.

## 3. Principes (appliqués à chaque écran)

1. **Une ligne = une chose, un bouton.** Ce qui demande une action est une liste ; chaque ligne
   porte au plus une action visible. Aucune phrase pour l'expliquer.
2. **L'aide vit derrière un « ? »**, jamais sous la liste. Le pied de page devient une ligne dans
   Réglages.
3. **Le téléphone d'abord.** Chaque écran est dessiné à 390 px puis élargi. Le PC reçoit la même
   app avec un rail — jamais une autre app.
4. **Quatre entrées** : Aujourd'hui · Agenda · Documents · Assistant. Réglages (ex-Moteur) est
   à part : engrenage en haut à droite sur téléphone, bas du rail sur PC.
5. **Un jeu d'icônes, une police, un accent.**
6. **Les noms de fichiers en monospace** : `2026-07-06_Devis_Centre Mécanique JF.pdf` se lit
   d'un coup d'œil — c'est la signature de DriveAI.

## 4. Plan (C28-82) — six PR, chacune livrable seule

| PR | Livre | Vérifie |
|---|---|---|
| 0 | Cet ADR ; polices auto-hébergées (`app/public/fonts`, CSP `default-src 'self'` — aucun appel à Google Fonts au runtime) ; `Icone.tsx` ; coquille `App.tsx` (barre haute + onglets bas / rail + colonne) ; suppression de `Sidebar.tsx` et `MiniCalendrier.tsx` ; « Mes agendas » en puces dans l'Agenda, « + » de création dans son en-tête ; `Moteur.tsx` → `Reglages.tsx` + carte Compte (langue, synchro, hub, déconnexion, ligne des garde-fous) ; tokens v7 dans `styles.css` (noms v6 conservés) ; **captures E2E à deux tailles** (`pc`, `tel`) | vitest · tsc · build · captures tel + pc · revue flotte |
| 1 | Accueil « plus propre » (mêmes briques, une action par ligne, zéro paragraphe) ; Réglages réduit à trois chiffres + « Avancé » replié | idem + captures avant/après |
| 2 | Documents : recherche unique (nom / contenu / IA), dossiers en liste avec compte, cadenas 04, arbre + contenu sur PC, déplacement conservé | + tests du sélecteur de recherche (pur) |
| 3 | Agenda : liste par jour sur téléphone (bande 7 jours), grille dès 7 h avec défilement sur « maintenant », filtres dans la page | + tests purs grille/liste |
| 4 | Assistant : fil plein écran, propositions Réorg en cartes Valider / Écarter dans le fil, raccourcis quand le fil est vide, « Analyser la structure » rapatrié ici | + tests d'assemblage fil ↔ propositions |
| 5 | Nettoyage : paragraphes `.explication` retirés (aide « ? »), i18n 134 → ~80 clés, GUIDE.md et captures docs, revue flotte finale | `grep` : zéro `.explication` restante hors aide |

## 5. Risques et garde-fous

- **Régression fonctionnelle silencieuse** (une commande de la v6 qui disparaît sans remplaçant).
  Parade : chaque PR liste ce qui bouge et OÙ ça revit (PR 0 : Créer → en-tête Agenda ; Mes
  agendas → puces Agenda ; langue / synchro / hub / déconnexion / garde-fous → Réglages · Compte).
- **Le téléphone reste invisible.** Parade structurelle : les captures CI passent à deux tailles
  dès PR 0 — la première chose que la refonte livre est l'œil qui manquait.
- **Polices** : auto-hébergées (latin + latin-ext, 168 Ko pour 12 fichiers, `font-display: swap`)
  parce que la CSP de `index.html` est `default-src 'self'` ; `fonts.gstatic.com` n'y entrera pas.
- **Les tests app (167) ne couvrent que la logique** (`etat`, `agenda`, `explorateur`, BFF…) :
  aucune vue n'est testée par rendu. La preuve visuelle reste la capture, la preuve
  fonctionnelle reste Marc sur son téléphone après chaque PR.

## 6. Ce qui ne change PAS

`google.ts`, `etat.ts`, `agenda.ts`, `agendasStore.ts`, `explorateur.ts`, `corbeille.ts`,
`garde-fous.ts`, tout `api/`, les scopes OAuth, le contrat hub. La refonte ne touche que ce qui
s'affiche.
