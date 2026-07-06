# ADR-0013 — App v3 : refonte complète, direction « Salle des machines » (B)

- **Statut** : Accepté — en construction (chantier #19)
- **Décideurs** : Marc (cadrage 4 réponses + choix « B » sur maquette, 2026-07-06), Claude
- **Complète** : ADR-0008 (app v1), ADR-0011 (app v2) — la v3 les remplace visuellement,
  conserve leur socle technique (Vite/React/TS, GIS, Sheets API, Vercel, PWA passe-plat).

## Contexte

Marc : « je veux retravailler l'interface beaucoup ». Cadrage explicite : refonte visuelle
complète + navigation/structure + nouvelles fonctionnalités + mobile/PWA ; desktop et mobile
à égalité ; 3 directions proposées sur maquette (A « Dossier », B « Salle des machines »,
C « Par avion ») ; contenu voulu : vue Tri Gmail, Santé & coût du moteur, recherche enrichie,
confiance visible (#17). **Choix : B.**

## Décisions

1. **Identité visuelle « Salle des machines »** — sombre d'abord (ardoise bleu nuit, jamais
   noir pur), bascule claire à construire dès le socle (tokens, pas un thème rapporté).
   Tokens de référence (validés par le validateur de palette sur la surface sombre) :
   fond `#10161f`, carte `#18202c`, trait `#232e3e`, encre `#e6ebf2`, sourdine `#8b98aa`,
   **accent UI ambre `#e8a33a`**, **marques de données `#c97f1b`**, statut ok `#3fb950` /
   attention `#d29922` / critique `#d64545`. Titres, chiffres et navigation en **mono**
   (`ui-monospace, Cascadia Code, SF Mono, Consolas`), corps en système. Étiquettes en
   capitales espacées. Chiffres `tabular-nums` partout.
2. **Structure : 5 sections** (remplace les 3 onglets) — **Aujourd'hui** (stats, activité 30 j,
   suspects, derniers tris, docs récents + confiance), **Documents** (recherche filtrée :
   domaine/entité/type/année + badge et filtre confiance — le chantier #17 est ABSORBÉ ici),
   **Mails** (suspects avec raison, fils triés, table `TriAppris` corrigeable, newsletters
   jamais lues), **Apprentissage** (corrections few-shot + curation d'entités, fusion de
   l'existant), **Santé** (heartbeat, quotas, coût LLM, campagnes, erreurs récentes, relance
   de quarantaine via l'onglet `Relances` existant).
3. **Mobile à égalité** : barre d'onglets basse (5 entrées), tuiles 2 colonnes, tables qui
   dégradent en cartes ; PWA conservée. Desktop : onglets hauts, grille 12 colonnes dense.
4. **Données** : lecture Sheet comme aujourd'hui (Index/Journal/Santé/Entités/Corrections/
   Échecs/Progression) + **TriAppris** (lecture + édition/suppression de lignes — même canal
   d'écriture Sheets API que Corrections/Relances, AUCUNE écriture Gmail/Drive depuis l'app).
   Les quotas/campagnes s'affichent depuis les signaux Sheet (Journal/Santé), pas depuis les
   Script Properties (inaccessibles à l'app).
5. **Charts** : une teinte de données (ambre) par graphique, une seule ordonnée, barres fines
   à bouts arrondis, grille discrète, dernier point accentué + étiquette directe, tooltips.
   Couleurs de statut réservées à l'état, jamais « série 4 ».
6. **Livraison par étapes** (C19-03 → C19-08, une PR par étape, CI + Vercel à chaque merge) :
   socle tokens/nav/responsive → Aujourd'hui → Mails → Documents → Santé → Apprentissage.
   Chaque étape laisse l'app UTILISABLE (pas de grand soir : les vues v2 restent branchées
   tant que leur remplaçante v3 n'est pas livrée).

## Garde-fous

- L'app reste **lecture seule sur Drive/Gmail** — ses seules écritures vont dans la Sheet
  (onglets déjà éditables : Corrections, Relances, Entités-statut, TriAppris).
- Bilingue FR/EN conservé (i18n existante) ; contraste AA sur les deux thèmes ;
  `prefers-reduced-motion` respecté.
- Budget poids : app statique, pas de lib de charts (SVG maison), pas de nouvelle dépendance
  sans nécessité démontrée.

## Références

- Maquette « trois directions » (2026-07-06) → choix B.
- Maquette haute-fidélité des 5 sections (artifact, 2026-07-06) — source de vérité visuelle
  du chantier ; les écarts d'implémentation se tranchent contre elle.
