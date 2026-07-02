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
- **Ancre FIXE + offset sur ensemble immuable** *(design v2 — le design initial « curseur rétrograde
  jour le plus ancien + 1 » a été démoli par la vérification adversariale : Gmail trie les fils par
  DERNIER message ⇒ un vieux fil ravivé téléportait le curseur en arrière et perdait des PJ ; un jour
  à plus d'une page de fils ⇒ plateau infini)* : une date-ancre posée UNE seule fois (−29 j :
  `before:` est exclusif et `newer_than:30d` peut être glissant — vrai chevauchement d'un jour) fige
  la requête `has:attachment before:<ancre>` ⇒ l'APPARTENANCE à l'ensemble est stable, donc une
  pagination par offset persistant y est sûre (la leçon « pagination mouvante » interdit le mouvant,
  pas l'offset). L'offset n'avance que sur page COMPLÈTE ; plafond de PJ inédites/run + gardes à
  chaque niveau de boucle (fil/message/PJ) ; fil en erreur sauté avec journal.
- Le scan RÉCENT existant (offset 0, fenêtre 30 j) reste inchangé pour le flux vivant — et couvre le
  cas du vieux fil ravivé pendant la campagne (son nouveau message le fait entrer dans la fenêtre
  vivante, qui traite TOUTES les PJ du fil).
- **Terminaison par passes de VÉRIFICATION** (2ᵉ contre-vérification) : trois pertes silencieuses
  résiduelles (fil ravivé par un message SANS PJ — invisible du vivant —, suppression en zone déjà
  scannée qui fait glisser un fil sous l'offset, erreur transitoire sur un fil) partagent le même
  antidote : une page vide ne termine pas la campagne — si la passe a eu la moindre activité,
  l'offset repart à 0 ; « terminé » exige DEUX passes 100 % propres consécutives (3ᵉ contre-vérif :
  une suppression PENDANT la passe de vérification peut masquer un fil ; la re-passe est quasi
  gratuite — PJ indexées = métadonnées seules). Fil en erreur : compteur d'Échecs incrémenté à la
  COMPLÉTION de page seulement (un rejeu de page ne brûle pas les essais — un essai par PASSE),
  abandonné après 3 essais (la terminaison n'est jamais bloquée ; la trace reste).
- **Budget QUOTIDIEN** (3ᵉ contre-vérification) : le plafond de PJ inédites par run borne le PIC,
  pas la JOURNÉE (288 ticks × 20-30 s = 96-144 min/j > quota runtime ~90 min/j → tous les
  déclencheurs, chien de garde inclus, gelés chaque après-midi). La campagne compte ses ms réelles
  par jour (Properties) et se plafonne à 20 min/j — le flux vivant et la Phase 3 gardent leur quota.
- *Limite documentée (négligeable, compte perso)* : un mail dont la date interne est ancienne mais
  qui ARRIVE tardivement (import mbox, relève POP, redirection) peut tomber entre l'ancre et la
  fenêtre vivante après la fin de la campagne — hors périmètre.
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
  seule une requête FIGÉE (ensemble immuable) rend la reprise sûre.
- **Curseur rétrograde « jour le plus ancien traité + 1 »** — design v1, écarté après vérification
  adversariale (téléportation du curseur par fil ravivé, plateau infini sur jour dense, quota runtime).

## Conséquences
- `Gmail.gs`/`Main.gs` : second scan figé (Properties ancre + offset), garde-temps partagé, plafond/run.
- `Resume.gs` : deux sections nouvelles (actions détectées, mails à traiter).
- `Intentions.gs`/`Prefiltre.gs` : flag `important` dans le mini-check (tokens inchangés ou +N faible).
- App : vue lecture seule des intentions (roadmap #15).
