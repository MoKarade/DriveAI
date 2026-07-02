# ADR-0009 — Qualité du moteur : entités propres & médias bruts

- **Statut** : Accepté — **à implémenter** (roadmap v2, chantiers #10-#11)
- **Décideurs** : Marc, Claude · **Source** : brainstorm v2 du 2026-07-02 (post-roadmap v1, constats de prod)

## Contexte (constats de prod, 2026-07-02)

1. **La file d'entités est bruitée.** ~160 propositions `en_attente`, dont une large part de
   **génériques sans valeur** (« cours », « banque », « véhicule », « diplôme », « Banque/Service
   en ligne » en 6 variantes…) et de **quasi-doublons** (4 formes de « 3325 4e Avenue »). La
   validation devient une corvée ; le référentiel curé perd son sens.
2. **Les médias bruts coûtent cher pour rien.** L'export Facebook (photos aux noms numériques,
   mp4, gif) passe pièce par pièce dans OCR + LLM + escalade Sonnet — lent, coûteux, et le
   résultat (« classé au mieux » dans 08·Perso) n'apporte aucune valeur documentaire.

## Décisions

### 1. Filtre qualité à la PROPOSITION d'entité (chantier #10)
- **Une entité digne d'être proposée porte un NOM PROPRE** (marque, institution, personne, adresse,
  immatriculation) — jamais un nom commun générique. Double garde :
  (a) **blocklist** de génériques (mots seuls type « banque », « cours », « véhicule », « logement »,
  « diplôme », motifs « X/Y » descriptifs) — PURE, testée, calibrée sur la file réelle ;
  (b) **prompt LLM durci** (« entité = nom propre identifiable ; sinon null »).
- **Consolidation à la proposition** : si une variante forte existe (≥ seuil anti-variantes), on
  n'empile PAS une n-ième ligne — on incrémente la ligne existante (colonne « Vu N fois »),
  la meilleure forme restant celle proposée en premier. Marc ne voit qu'UNE ligne par entité réelle.
- **Nettoyage ONE-SHOT de la file existante** : les ~160 lignes actuelles passent le même filtre —
  les génériques évidents sont marqués `refusée` (curation de PROPOSITIONS : aucun document déplacé,
  100 % réversible en ré-éditant le Statut). Les quasi-doublons sont regroupés (meilleure forme
  gardée `en_attente`, les autres `variante de : X`).

### 2. Fast-path « média brut » (chantier #11)
- Un fichier **manifestement média personnel** est écarté vers **`_Médias`** (nouveau dossier hors
  domaines, à côté de `_Doublons`/`_Technique`) **sans LLM** : vidéo/audio/gif TOUJOURS ;
  photo (jpg/png/heic) SEULEMENT si nom non-documentaire (numérique long ≥ 10 chiffres, `IMG_`/`DSC`…)
  **ET OCR vide** (l'OCR reste tenté : un scan de passeport nommé `IMG_2734.jpg` contient du texte →
  il continue vers le LLM ; garde-fou §1 préservé).
- Déplacement seul, nom d'origine conservé (traçabilité), idempotent, borné — mêmes invariants que
  `_Technique`.

## Alternatives écartées
- **Auto-SUPPRIMER les entités génériques de la Sheet** — jamais de suppression (§2) : statut `refusée`.
- **Fast-path médias sans OCR pour les photos** — risque passeport scanné (P2.7) : l'OCR reste le juge.
- **LLM seul pour juger la qualité d'entité** — un filtre pur testé est gratuit, déterministe et
  calibrable sur la file réelle ; le prompt durci vient en complément, pas en remplacement.

## Conséquences
- `Entites.gs` : filtre + consolidation à la proposition ; fonction one-shot de curation (gatée tag).
- `Pipeline.gs`/`Router.gs` : branche `_Médias` (après doublon/technique, avant LLM pour vidéo ;
  après OCR pour photo).
- La validation dans l'app redevient courte ; le rangement Facebook s'accélère fortement.
