# ADR-0010 — Mails : historique complet, visibilité Phase 3, mails importants

- **Statut** : Accepté — **à implémenter** (roadmap v2, chantiers #12-#14)
- **Décideurs** : Marc, Claude · **Source** : brainstorm v2 du 2026-07-02

## Contexte

Le moteur ne classe que les PJ des mails de **moins de 30 jours** (`newer_than:30d`) : des années
de pièces jointes restent non classées. La Phase 3 (actions/RDV → Tasks/Calendar) travaille **en
silence** : Marc ne voit pas ce qu'elle crée. Et rien ne met en avant les mails qui **demandent son
attention**.

## Décisions

### 1. Classer TOUT l'historique Gmail (chantier #12)
- **Scan ancré rétrograde** (leçon « pagination sur recherche mouvante » — enfin appliquée aux PJ) :
  un curseur ABSOLU persistant (`before:<date>`) remonte l'historique par tranches, du plus récent
  au plus ancien, borné par run, jusqu'à épuisement (curseur figé « terminé »).
- Le scan RÉCENT existant (offset 0, fenêtre 30 j) reste inchangé pour le flux vivant.
- Idempotence inchangée (clé `messageId|i|nom|taille`) ; dédup MD5 inchangée (les vieilles PJ déjà
  présentes ailleurs partent en `_Doublons`). Budget : Haiku, plafonds/run, escalades cappées.

### 2. Rendre la Phase 3 VISIBLE (chantier #13)
- Section « **Actions & RDV détectés** » dans le **résumé hebdo** (liste : quoi, source, créé où).
- Onglet/même section dans l'**app web** — les données existent déjà (`Index` clés `intention|`,
  colonnes sujet/statut) : lecture seule, zéro nouvelle infra.

### 3. Mails importants (chantier #14)
- Réutilise le pipeline Phase 3 (mini-check Haiku existant) : un flag supplémentaire
  `important` (question directe à Marc, échéance, administration/officiel) → section « **À traiter** »
  du résumé hebdo avec lien vers le mail. Aucune écriture Gmail (lecture seule, §3) ; anti-bruit :
  plafond de N mails/semaine, jamais de notification immédiate (le résumé suffit — décision Marc :
  pas de spam).

## Alternatives écartées
- **Labels Gmail « important »** — impossible et non voulu : `gmail.readonly` (§3).
- **Notifications immédiates par mail** — risque de spam ; le résumé hebdo est le canal.
- **Étendre la fenêtre à 90 j “et voir”** — ne converge jamais sur l'historique (leçon pagination) ;
  le curseur ancré est la seule voie sûre.

## Conséquences
- `Gmail.gs`/`Main.gs` : second scan ancré (propriété curseur), garde-temps partagé, plafond/run.
- `Resume.gs` : deux sections nouvelles (actions détectées, mails à traiter).
- `Intentions.gs`/`Prefiltre.gs` : flag `important` dans le mini-check (tokens inchangés ou +N faible).
- App : vue lecture seule des intentions (roadmap #15).
