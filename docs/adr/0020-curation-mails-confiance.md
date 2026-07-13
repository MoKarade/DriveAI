# ADR-0020 — Curation des mails : table de Confiance, balayage cyclique & intentions élargies

- **Statut** : Accepté (C28-19, décisions Marc 2026-07-13).
- **Décideurs** : Marc (choix produit), NotebookLM (plan technique), Claude (exécution).
- **S'appuie sur** : §2.3 (Gmail ajout-seul), C28-15 (quota partagé), C28-16 (patron demande→moteur),
  protocole §8 (audit PoC `test/audit-logique.test.js` + fonctions pures).

## Problème (mesuré, Index du 2026-07-13)

1. **Intentions trop strictes** : 7 j = 0 tâche créée, 75 « intention-ecartee » — dont « Votre
   facture est prête » et « Action requise : compte de facturation » (Marc a dû marquer à la main).
   Cause : le mini-check (Prefiltre.gs) classait ces mails « notification » et excluait
   explicitement « facture récurrente » du flag important.
2. **Mails lus jamais archivés** : débit du tri 2-11 fils/j (cible ~90) — le scan avant s'arrête au
   premier mur « déjà à jour » ; un fil LU des jours après son tri est enfoui dessous et n'est
   jamais re-trié (donc jamais archivé, la règle « archivé une fois lu » étant par ailleurs
   CONSERVÉE telle quelle — décision Marc re-confirmée).
3. **13 suspects quasi tous faux** (alertes Google, 2FA Desjardins, « Fwd: Diplôme »…) : le
   marquage part de l'heuristique OU du LLM, sans aucune mémoire « expéditeur sûr », et le ⚠ déjà
   posé se ré-hérite à vie.

## Décisions

1. **Table de Confiance (suspects)** : Marc marque un fil « Pas suspect » en 1-clic (accueil +
   Mails). L'expéditeur (adresse nue, minuscules) entre dans l'onglet `Confiance` ; le statut
   « sain » outrepasse l'heuristique, le LLM ET le libellé ⚠ déjà posé (décision PURE
   `decisionSuspect_`, auditée §8.5 sur les faux positifs réels). Le libellé ⚠ physique dans
   Gmail n'est **pas** retiré (§2.3 ajout-seul, verrou CI intact) — le système l'ignore et le fil
   suit le tri normal (archivé s'il est lu). `TriAppris` (appris) ≠ `Confiance` (clic explicite) :
   un expéditeur appris n'outrepasse PAS l'heuristique déterministe (.exe reste ⚠).
2. **Balayage cyclique du tri** : nouveau `scanCycliqueTri_` — offset persistant
   (`DriveAI_TRI_AVANT_OFFSET`) qui parcourt la fenêtre `TRI_REQUETE` page après page et repart à
   0 en fin de fenêtre : tout fil dont l'état a changé (lu ↔ non-lu) finit revisité (~30-60 min
   par tour).
3. **Intentions élargies** : « facture à payer » et « action requise sur un compte » ouvrent le
   mini-check (`action=true`, `important=true` — fil ⏰ en boîte) et sont TOUJOURS une `tache`
   Tasks dans `PROMPT_INTENTIONS` (échéance si détectable). Un reçu/paiement déjà effectué reste
   hors intentions. Anti-doublon inchangé (clés `tache|<msgId>|<hash>` existantes).

## Écarts au plan validé (documentés)

1. **Le scan avant et son mur sont CONSERVÉS** (le plan proposait de les remplacer par le
   cyclique) : sans eux, le courrier NEUF — dont les vrais phishing — perdrait sa latence ~5 min
   (leçon « scan du neuf qui s'arrête tôt »), et un balayage libre relirait TOUTE la boîte à
   chaque tick (leçon quota partagé C28-15). Le cyclique est borné à
   `TRI_CYCLIQUE_PAGES_PAR_RUN` (1 page de 20 fils/tick) — les lectures Gmail bornées dans LEUR
   unité.
2. **Aucune suppression d'Index depuis doPost** (le plan y purgeait les clés `tri|…`) : doPost
   court en CONCURRENCE du tick qui tient le verrou — une suppression de lignes pendant un run
   serait une course. `actionPasSuspect_` apprend la confiance + pose la demande
   (`DriveAI_PAS_SUSPECT`, liste additive) ; le tick la consomme SOUS SON VERROU
   (`appliquerPasSuspect_`, en tête du tri) : purge `purgerClesTriIndex_` puis RE-TRI immédiat du
   fil — l'effet « re-trié dans la minute » du plan est tenu (tick ponctuel déclenché au clic).
3. `getMessages().getFrom()` du plan corrigé (tableau) : l'adresse de référence est le dernier
   message qui ne vient PAS de Marc (même règle que le tri — sa propre réponse ne doit jamais
   entrer en Confiance).

## Méthode de test

Audit PoC §8.5 (`audit-logique.test.js`) : les 5 faux positifs réels redeviennent sains via la
Confiance (y compris ⚠ déjà posé) ; contre-épreuve : le phishing d'un expéditeur non marqué reste
⚠. `pas-suspect.test.js` : matrice `decisionSuspect_`, dédup Confiance, offsets du cyclique
(avance/retour à 0/interruption, dérivés des CONSTANTES), consommation additive, purge Index
sélective (jamais une clé documentaire), tripwires des prompts élargis. Non-régression :
tri-gmail/webapp complets. Moteur 523/523, app 151/151.

## Activation

⚠ `doPost` change : **redéployer la web app (« Nouvelle version »)** — sinon le bouton renvoie
une erreur. Aucun nouveau scope OAuth (pas de gel des déclencheurs).
